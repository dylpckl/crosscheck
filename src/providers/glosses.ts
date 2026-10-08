import type { Answer } from '../contract';
import { fetchJson } from '../http';
import { toGrid } from '../pattern';
import type { DatamuseWord } from './datamuse';

const BASE = 'https://api.datamuse.com/words';
const NAME = 'Datamuse';
/** Published answers are few and lead the list; this caps the extra requests per solve. */
export const MAX_LOOKUPS = 8;

/** Answer (grid form) → its definition, or null when Datamuse has none. Lives for the session. */
const memo = new Map<string, string | null>();

/** The first definition Datamuse gives for exactly this answer, or null. Exported for tests. */
export function pickGloss(rows: DatamuseWord[], answer: string): string | null {
  const row = rows.find((r) => toGrid(r.word ?? '') === answer && r.defs?.length);
  return row?.defs?.[0]?.split('\t').pop()?.trim() || null;
}

async function lookup(a: Answer, signal: AbortSignal): Promise<string | null> {
  if (memo.has(a.answer)) return memo.get(a.answer)!;
  try {
    const rows = await fetchJson<DatamuseWord[]>(NAME, `${BASE}?sp=${encodeURIComponent(a.display)}&md=d&max=1`, signal);
    const gloss = pickGloss(rows, a.answer);
    memo.set(a.answer, gloss);
    return gloss;
  } catch {
    // A missing gloss leaves the row as tiles alone, which is fine; never fail the solve over it.
    return null;
  }
}

/**
 * Clue bank hits arrive as bare answers. They are the strongest evidence the
 * app has, so they are the rows most worth explaining: look up a definition
 * for each published answer that has none. Returns the same array when
 * nothing changed, so callers can skip a repaint.
 */
export async function fillGlosses(answers: Answer[], signal: AbortSignal): Promise<Answer[]> {
  const missing = answers.filter((a) => !a.gloss && (a.priority ?? 0) >= 1).slice(0, MAX_LOOKUPS);
  if (!missing.length) return answers;
  const found = new Map<string, string>();
  await Promise.all(
    missing.map(async (a) => {
      const g = await lookup(a, signal);
      if (g) found.set(a.answer, g);
    }),
  );
  if (!found.size) return answers;
  return answers.map((a) => (found.has(a.answer) ? { ...a, gloss: found.get(a.answer) } : a));
}

/** For tests. */
export function clearGlossMemo(): void {
  memo.clear();
}
