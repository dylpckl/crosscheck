import type { Answer, ProviderError, SolveRequest } from '../contract';
import { googleClueUrl } from '../providers/links';
import { esc, extIcon } from './util';

export function skeletonAnswers(): string {
  return `<section class="section" id="sec-answers"><h2>Answers</h2>
    <div class="sk"></div><div class="sk short"></div><div class="sk"></div><div class="sk short"></div><div class="sk"></div><div class="sk short"></div>
  </section>`;
}

/** Lengths of the blank rows on the empty desktop board: a few plausible shapes of fill. */
const BLANK_ROWS = [4, 5, 3, 6];

/**
 * The desktop board before there is anything on it: answer rows with their
 * tiles face down. Results turn them over (see AnswersOpts.flip).
 */
export function renderBlankAnswers(): string {
  return `<section class="section blankrows" id="sec-answers" aria-hidden="true"><div class="answers">${BLANK_ROWS.map(
    (n) => `<div class="row"><span class="tiles">${'<span class="tile"></span>'.repeat(n)}</span><span class="gloss"><i class="bar"></i></span></div>`,
  ).join('')}</div></section>`;
}

export interface AnswersOpts {
  fromCache?: boolean;
  error?: ProviderError;
  /**
   * Show only answers of this length. A view-time filter over answers already
   * fetched, so it costs no request; a length with no answers is ignored.
   */
  lengthFilter?: number | null;
  /**
   * Spoiler mode: keep everything below the heading behind a tap. Lengths
   * are hints too, so the filter row hides with the rows. Nothing to hide
   * (no answers at all) renders as normal — a hand-off is not a spoiler.
   */
  hidden?: boolean;
  /**
   * Apply lengthFilter even when no answer has that length. The desktop
   * slider is a constraint the reader set, so an empty result is the honest
   * answer; the mobile chips are picked from lengths present, so they never
   * need it.
   */
  strictLength?: boolean;
}

/** Lengths present in the answers, ascending, with how many of each. */
export function lengthCounts(answers: Answer[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const a of answers) counts.set(a.length, (counts.get(a.length) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * A published answer is one with evidence behind it: a clue bank hit, or a
 * verbatim stock clue in the corpus. Everything else is association, and is
 * shown as such — under its own heading, never as an answer.
 */
const isPublished = (a: Answer) => (a.priority ?? 0) >= 1;

export function renderAnswers(answers: Answer[], req: SolveRequest, opts: AnswersOpts = {}): string {
  const counts = lengthCounts(answers);
  // Ignore a filter nothing matches, so a stale selection can't empty the list.
  const active = opts.strictLength || counts.some(([n]) => n === opts.lengthFilter) ? opts.lengthFilter ?? null : null;
  const filtered = active ? answers.filter((a) => a.length === active) : answers;
  const published = filtered.filter(isPublished);
  const related = filtered.filter((a) => !isPublished(a));
  const allPublished = answers.filter(isPublished);

  const label = active ? `${published.length} of ${allPublished.length}` : countLabel(allPublished, req);
  const head = `<h2>Answers ${allPublished.length ? `<span class="count">${label}</span>` : ''}${opts.fromCache ? '<span class="pill">Cached</span>' : ''}</h2>`;

  if (opts.hidden && answers.length) {
    const n = allPublished.length || answers.length;
    return `<section class="section" id="sec-answers">${head}<div class="spoiler">
      <button type="button" class="reveal-btn" data-reveal-answers>Reveal ${n} ${allPublished.length ? 'answer' : 'related word'}${n === 1 ? '' : 's'}</button>
    </div></section>`;
  }

  // One length is no choice, so the row only earns its space with two or more.
  // Counts live in the label rather than on screen: two bare numbers side by
  // side read as one ambiguous pair. "All" is the filter's visible off switch.
  const chips = counts.length > 1
    ? `<div class="lenrow"><span class="lenlabel">Length</span><div class="lens"><div class="lensbar" role="group" aria-label="Filter by length">
        <button type="button" data-len="0" aria-pressed="${active === null}">All</button>${counts
          .map(([n, k]) => `<button type="button" data-len="${n}" aria-pressed="${n === active}" aria-label="${n} letters, ${k} answer${k === 1 ? '' : 's'}">${n}</button>`)
          .join('')}</div></div></div>`
    : '';

  const error = opts.error && !answers.length ? `<div class="notice bad">${esc(opts.error.message)}.</div>` : '';
  const main = published.length
    ? `<div class="answers published">${published.map((a, i) => row(a, req, i)).join('')}</div>`
    : handoff(req.query, active);
  const rest = related.length
    ? `<h3 class="subhead">Related words <span class="count">${related.length}</span></h3>
       <div class="answers">${related.map((a, i) => row(a, req, published.length + i)).join('')}</div>`
    : '';
  return `<section class="section" id="sec-answers">${head}${chips}${error}${main}${rest}</section>`;
}

/**
 * The exit the reader was going to take anyway — the search they would type
 * by hand — offered where the answer would have been, rather than found after
 * scrolling past a disappointment. With a length selected it is the search
 * they would type second, so that goes in too.
 */
function handoff(query: string, length: number | null): string {
  const shown = `${query} crossword${length ? `, ${length} letters` : ''}`;
  return `<div class="handoff">
    <p>No published answer for <b>${esc(query)}</b> yet.</p>
    <a class="handoff-btn" href="${esc(googleClueUrl(query, length))}" target="_blank" rel="noopener">Google “${esc(shown)}”${extIcon}</a>
  </div>`;
}

function countLabel(answers: Answer[], req: SolveRequest): string {
  if (req.pattern || req.length) return `${answers.filter((a) => a.fitsPattern === true).length} of ${answers.length} fit`;
  if (req.letters) {
    const all = answers.filter((a) => a.letterHits === req.letters!.length).length;
    return `${all} of ${answers.length} have ${req.letters.split('').join(' ')}`;
  }
  return String(answers.length);
}

function row(a: Answer, req: SolveRequest, ri = 0): string {
  const words = a.display.split(/\s+/);
  let idx = 0;
  const tiles = words
    .map((w, wi) => {
      const letters = w
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .split('')
        .map((ch) => {
          const hit = req.pattern ? req.pattern[idx] === ch : Boolean(req.letters?.includes(ch));
          idx++;
          return `<span class="tile${hit ? ' hit' : ''}" style="--i:${idx - 1}">${ch}</span>`;
        })
        .join('');
      return letters + (wi < words.length - 1 ? '<span class="gap"></span>' : '');
    })
    .join('');
  const pos = a.partOfSpeech?.[0];
  return `<button class="row${a.fitsPattern === false ? ' dim' : ''}" style="view-transition-name:a-${a.answer};--r:${ri}" data-answer="${a.answer}" data-display="${esc(a.display)}"
      aria-label="${esc(a.display)}, ${a.length} letters. Tap to copy, hold to look up.">
    <span class="tiles${a.length >= 9 ? ' long' : ''}">${tiles}<span class="len">${a.length}</span></span>
    ${a.gloss ? `<span class="gloss">${pos ? `<span class="pos">${esc(pos)}.</span>` : ''}${esc(a.gloss)}</span>` : ''}
  </button>`;
}
