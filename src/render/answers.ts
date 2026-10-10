import type { Answer, ProviderError, SolveRequest } from '../contract';
import { googleClueUrl } from '../providers/links';
import { esc, extIcon } from './util';

/** Lengths of the blank rows on the empty board: a few plausible shapes of fill. */
const BLANK_ROWS = [4, 5, 3, 6];

/**
 * The board before there is anything on it: answer rows with their tiles
 * face down. Results turn them over (see the flip in ui/solver.ts).
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
   * Show only answers of this length. The slider is a constraint the reader
   * set, so it applies strictly: a length with no answers shows none, and
   * the hand-off names the length, rather than quietly showing every length.
   */
  lengthFilter?: number | null;
  /**
   * Spoiler mode: keep everything below the heading behind a tap. Nothing to
   * hide (no answers at all) renders as normal — a hand-off is not a spoiler.
   */
  hidden?: boolean;
}

/**
 * A published answer is one with evidence behind it: a clue bank hit, or a
 * verbatim stock clue in the corpus. Everything else is association, and is
 * shown as such — under its own heading, never as an answer.
 */
const isPublished = (a: Answer) => (a.priority ?? 0) >= 1;

export function renderAnswers(answers: Answer[], req: SolveRequest, opts: AnswersOpts = {}): string {
  const active = opts.lengthFilter ?? null;
  const filtered = active ? answers.filter((a) => a.length === active) : answers;
  const published = filtered.filter(isPublished);
  const related = filtered.filter((a) => !isPublished(a));
  const allPublished = answers.filter(isPublished);

  // The heading is for screen readers: the cards speak for themselves on screen, but the count and the cache note are worth hearing.
  const label = active ? `${published.length} of ${allPublished.length}` : countLabel(allPublished, req);
  const head = `<h2>Answers ${allPublished.length ? `<span class="count">${label}</span>` : ''}${opts.fromCache ? '<span class="pill">Cached</span>' : ''}</h2>`;

  // Spoiler mode hides what would show: with a length set, that is the answers of that length, and none means the hand-off shows as normal.
  if (opts.hidden && filtered.length) {
    const n = published.length || filtered.length;
    return `<section class="section" id="sec-answers">${head}<div class="spoiler">
      <button type="button" class="reveal-btn" data-reveal-answers>Reveal ${n} ${published.length ? 'answer' : 'related word'}${n === 1 ? '' : 's'}</button>
    </div></section>`;
  }

  const error = opts.error && !answers.length ? `<div class="notice bad">${esc(opts.error.message)}.</div>` : '';
  const main = published.length
    ? `<div class="answers published">${published.map((a, i) => row(a, req, i)).join('')}</div>`
    : handoff(req.query, active);
  const rest = related.length
    ? `<h3 class="subhead">Related words <span class="count">${related.length}</span></h3>
       <div class="answers">${related.map((a, i) => row(a, req, published.length + i)).join('')}</div>`
    : '';
  return `<section class="section" id="sec-answers">${head}${error}${main}${rest}</section>`;
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

/** With no length set, the count; with letters, how many answers hold all of them. A length set is labelled by the caller. */
function countLabel(answers: Answer[], req: SolveRequest): string {
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
    <span class="tiles${a.length >= 9 ? ' long' : ''}">${tiles}</span>
    ${a.gloss ? `<span class="gloss">${pos ? `<span class="pos">${esc(pos)}.</span>` : ''}${esc(a.gloss)}</span>` : ''}
  </button>`;
}
