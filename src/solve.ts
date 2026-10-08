import type { Answer, Definition, ProviderError, Reference, SolveRequest, SolveResult } from './contract';
import { toProviderError } from './http';
import { parsePattern } from './pattern';
import { findPublished } from './providers/cluebank';
import { findClued } from './providers/crosswordese';
import { datamuse } from './providers/datamuse';
import { dictionaryapi } from './providers/dictionaryapi';
import { applyGlosses, findGlosses } from './providers/glosses';
import { buildLinks } from './providers/links';
import { wikipedia } from './providers/wikipedia';
import { wiktionary } from './providers/wiktionary';
import { capAnswers, mergeAnswers, rankAnswers } from './rank';
import { getCached, putCached } from './store';

export interface BuildError {
  error: string;
}

/** Normalize raw input into a SolveRequest, or a user-facing validation error. */
export function buildRequest(rawQuery: string, rawPattern = ''): SolveRequest | BuildError {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (!query) return { error: 'Type a word or phrase first' };
  if (query.length > 120) return { error: 'Keep it under 120 characters' };
  const c = parsePattern(rawPattern);
  if (c.error) return { error: c.error };
  const req: SolveRequest = { query };
  if (c.pattern) req.pattern = c.pattern;
  if (c.length) req.length = c.length;
  if (c.letters) req.letters = c.letters;
  return req;
}

export function isBuildError(x: SolveRequest | BuildError): x is BuildError {
  return 'error' in x;
}

/** Partial results arrive as each provider settles; `done` fires once with the final assembled result. */
export interface SolveEvents {
  answers?: (a: Answer[]) => void;
  definition?: (d: Definition | null) => void;
  reference?: (r: Reference | null) => void;
  done: (r: SolveResult) => void;
}

/**
 * Definition: both dictionaries in parallel. Free Dictionary is preferred
 * (phonetics, audio) but it stalls often, so Wiktionary runs alongside and
 * fills in the moment Free Dictionary fails or comes back empty. An error
 * is only recorded when it cost us a definition.
 */
async function fetchDefinition(req: SolveRequest, signal: AbortSignal, errors: ProviderError[]): Promise<Definition | null> {
  const [primary, fallback] = await Promise.allSettled([dictionaryapi.fetch(req, signal), wiktionary.fetch(req, signal)]);
  if (primary.status === 'fulfilled' && primary.value) return primary.value;
  if (fallback.status === 'fulfilled' && fallback.value) return fallback.value;
  if (primary.status === 'rejected') errors.push(toProviderError(dictionaryapi.name, primary.reason));
  if (fallback.status === 'rejected') errors.push(toProviderError(wiktionary.name, fallback.reason));
  return null;
}

/**
 * Three sources, in descending order of how much they actually know about
 * the clue in front of them.
 *
 * The clue bank is a record of what published puzzles have used for this
 * exact clue, which is as close to an answer as the app gets; it is local
 * but lazily loaded, so it lands a beat after the corpus. The crosswordese
 * corpus knows convention for the short recurring fill, and is instant.
 * Datamuse knows association across the whole language but nothing about
 * convention, and costs a round trip.
 *
 * They are merged rather than raced, so a Datamuse failure still leaves the
 * local answers standing — which is why its rejection is recorded here
 * rather than propagated.
 */
async function fetchAnswers(
  req: SolveRequest,
  signal: AbortSignal,
  errors: ProviderError[],
  on: SolveEvents,
): Promise<Answer[]> {
  const local = findClued(req);
  if (local.length) on.answers?.(capAnswers(local));

  // The bank resolves off disk, so it is worth painting again before the
  // network answers arrive rather than making the reader wait for Datamuse.
  const published = await findPublished(req);
  if (published.length) on.answers?.(capAnswers(rankAnswers(mergeAnswers([...published, ...local]), req)));

  // The published answers are known now, so their definitions are looked up
  // alongside Datamuse instead of after it.
  const glosses = findGlosses(mergeAnswers([...published, ...local]), signal);

  let remote: Answer[] = [];
  try {
    remote = await datamuse.fetch(req, signal);
  } catch (e) {
    errors.push(toProviderError(datamuse.name, e));
  }
  const merged = capAnswers(rankAnswers(mergeAnswers([...published, ...local, ...remote]), req));
  on.answers?.(merged);

  // Datamuse often defines these words itself; looked-up glosses only fill what is still missing.
  const glossed = applyGlosses(merged, await glosses);
  if (glossed !== merged) on.answers?.(glossed);
  return glossed;
}

export async function solve(req: SolveRequest, signal: AbortSignal, on: SolveEvents): Promise<SolveResult> {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const cachedRaw = getCached(req, { allowStale: offline });
  const cached =
    cachedRaw && { ...cachedRaw, request: req, answers: capAnswers(rankAnswers(mergeAnswers(cachedRaw.answers), req)) };
  if (cached) {
    on.answers?.(cached.answers);
    on.definition?.(cached.definition);
    on.reference?.(cached.reference);
    on.done(cached);
    return cached;
  }

  const errors: ProviderError[] = [];
  const [answers, definition, reference] = await Promise.all([
    fetchAnswers(req, signal, errors, on),
    fetchDefinition(req, signal, errors).then((d) => (on.definition?.(d), d)),
    wikipedia.fetch(req, signal).then(
      (r) => (on.reference?.(r), r),
      (e) => (errors.push(toProviderError(wikipedia.name, e)), on.reference?.(null), null),
    ),
  ]);

  const result: SolveResult = {
    request: req,
    answers,
    definition,
    reference,
    links: buildLinks(req.query, reference !== null),
    errors,
    fetchedAt: Date.now(),
    fromCache: false,
  };
  // Only cache results that actually came back; an all-errors result would poison the cache.
  if (!signal.aborted && errors.length === 0) putCached(req, result);
  on.done(result);
  return result;
}
