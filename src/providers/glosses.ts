import type { Answer } from '../contract';
import { fetchJson } from '../http';
import { toGrid } from '../pattern';
import { BASE, NAME, parseDef, type DatamuseWord } from './datamuse';

/** Published answers are few and lead the list; this caps the extra requests per solve. */
export const MAX_LOOKUPS = 8;

export interface Gloss {
  text: string;
  pos?: string;
}

/** Answer (grid form) → its definition, or null when Datamuse has none. Lives for the session. */
const memo = new Map<string, Gloss | null>();

/** The first definition Datamuse gives for exactly this answer, or null. Exported for tests. */
export function pickGloss(rows: DatamuseWord[], answer: string): Gloss | null {
  const row = rows.find((r) => toGrid(r.word ?? '') === answer && r.defs?.length);
  const { text, pos } = parseDef(row?.defs?.[0]);
  return text ? { text, pos } : null;
}

async function lookup(a: Answer, signal: AbortSignal): Promise<Gloss | null> {
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
 * for each published answer that has none. Runs alongside Datamuse rather
 * than after it, so it adds no time to a solve that Datamuse doesn't.
 */
export async function findGlosses(answers: Answer[], signal: AbortSignal): Promise<Map<string, Gloss>> {
  const missing = answers.filter((a) => !a.gloss && (a.priority ?? 0) >= 1).slice(0, MAX_LOOKUPS);
  const found = new Map<string, Gloss>();
  await Promise.all(
    missing.map(async (a) => {
      const g = await lookup(a, signal);
      if (g) found.set(a.answer, g);
    }),
  );
  return found;
}

/**
 * Fill in looked-up glosses where an answer still has none. Returns the same
 * array when nothing changed, so callers can skip a repaint.
 */
export function applyGlosses(answers: Answer[], glosses: Map<string, Gloss>): Answer[] {
  if (!answers.some((a) => !a.gloss && glosses.has(a.answer))) return answers;
  return answers.map((a) => {
    const g = !a.gloss && glosses.get(a.answer);
    return g ? { ...a, gloss: g.text, partOfSpeech: a.partOfSpeech ?? (g.pos ? [g.pos] : undefined) } : a;
  });
}

/** For tests. */
export function clearGlossMemo(): void {
  memo.clear();
}
