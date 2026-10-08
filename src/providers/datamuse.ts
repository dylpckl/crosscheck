import type { Answer, AnswerProvider, SolveRequest } from '../contract';
import { fetchJson } from '../http';
import { toDatamuseSp, toGrid } from '../pattern';
import { rankAnswers } from '../rank';

export interface DatamuseWord {
  word: string;
  score?: number;
  tags?: string[];
  defs?: string[];
}

export const BASE = 'https://api.datamuse.com/words';
/** Datamuse mixes internal markers (f:1.2, results_type:…) into tags; only these are parts of speech. */
const POS_TAGS = new Set(['n', 'v', 'adj', 'adv', 'prop', 'u']);
/**
 * Datamuse's own admission of defeat. When it has no real associations for a
 * query it pads the response with words whose dictionary text merely contains
 * the query, and tags them so. For "sawbuck" that produced SCAW, "(Cornwall)
 * an elder tree" — shown as an answer, that reads as the app being broken.
 * An empty list is more honest than a padded one.
 */
const BACKFILL = /^results_type:backfill/;
export const NAME = 'Datamuse';

/** A Datamuse definition is "pos\ttext"; split it into its parts. */
export function parseDef(def?: string): { pos?: string; text?: string } {
  if (!def) return {};
  const tab = def.indexOf('\t');
  const text = (tab < 0 ? def : def.slice(tab + 1)).trim();
  const pos = tab < 0 ? '' : def.slice(0, tab).trim();
  return { pos: pos || undefined, text: text || undefined };
}

export function buildUrls(req: SolveRequest): string[] {
  const ml = encodeURIComponent(req.query);
  const urls = [`${BASE}?ml=${ml}&md=dpf&max=200`];
  const sp = toDatamuseSp(req);
  if (sp) urls.push(`${BASE}?ml=${ml}&sp=${encodeURIComponent(sp)}&md=dpf&max=60`);
  return urls;
}

/** Pure mapper from raw Datamuse rows to contract Answers. Exported for tests. */
export function mapAnswers(rows: DatamuseWord[], req: SolveRequest): Answer[] {
  const max = rows.reduce((m, r) => Math.max(m, r.score ?? 0), 0) || 1;
  const seen = new Map<string, Answer>();
  for (const r of rows) {
    if (!r.word) continue;
    if (r.tags?.some((t) => BACKFILL.test(t))) continue;
    const answer = toGrid(r.word);
    if (!answer) continue;
    const tags = (r.tags ?? []).filter((t) => POS_TAGS.has(t));
    const def = parseDef(r.defs?.[0]).text;
    const candidate: Answer = {
      answer,
      display: r.word,
      length: answer.length,
      score: Math.min(1, (r.score ?? 0) / max),
      rawScore: r.score,
      fitsPattern: null,
      gloss: def || undefined,
      partOfSpeech: tags.length ? tags : undefined,
      source: 'datamuse',
    };
    const prev = seen.get(answer);
    if (!prev || candidate.score > prev.score) seen.set(answer, { ...candidate, gloss: candidate.gloss ?? prev?.gloss });
  }
  // A generous provider-level guard only. The orchestrator merges this with
  // the local corpus and applies the display cap, so trimming hard here
  // would throw away short fill before the length filter ever sees it.
  return rankAnswers([...seen.values()], req).slice(0, 120);
}

export const datamuse: AnswerProvider = {
  name: NAME,
  async fetch(req, signal) {
    const results = await Promise.all(buildUrls(req).map((u) => fetchJson<DatamuseWord[]>(NAME, u, signal)));
    return mapAnswers(results.flat(), req);
  },
};
