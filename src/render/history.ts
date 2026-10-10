import type { HistoryEntry } from '../contract';
import { parsePattern } from '../pattern';
import { esc } from './util';

export interface HistoryOpts {
  /** Lengths the layout's slider can show; a stored length outside them is not applied, so it is not shown. */
  lengths: readonly number[];
}

/**
 * Recent searches, under the answers: a row of pills that scrolls sideways on
 * a phone and wraps on a wide screen. Where they were, under the input, they
 * outranked the answers; at the bottom they are there when a search is done.
 *
 * A pill shows only what tapping it will apply. A positional pattern is kept
 * in the entry for setQuery to reduce, but it reads as its length and its
 * known letters here, since that is what the controls can hold.
 */
export function renderHistory(list: HistoryEntry[], opts: HistoryOpts): string {
  if (!list.length) return '';
  return `<section class="section recent-sec"><h2>Recent</h2><div class="recent" role="group" aria-label="Recent searches">${list
    .slice(0, 12)
    .map((h) => {
      const c = parsePattern(h.pattern ?? '');
      const length = h.length ?? c.length;
      const shownLength = length && opts.lengths.includes(length) ? length : undefined;
      const known = c.pattern ? [...new Set(c.pattern.replace(/\?/g, ''))].join('') : (h.letters ?? '');
      const shownLetters = known;
      const tags = [shownLength ? `<code>${shownLength}</code>` : '', shownLetters ? `<code>${esc(shownLetters)}</code>` : ''].join('');
      const name = [esc(h.query), shownLength ? `${shownLength} letters` : '', shownLetters ? `with ${shownLetters.split('').join(' ')}` : ''].filter(Boolean).join(', ');
      return `<button type="button" data-q="${esc(h.query)}" data-p="${esc(h.pattern ?? h.letters ?? '')}"${shownLength ? ` data-len="${shownLength}"` : ''} aria-label="${name}">${esc(h.query)}${tags}</button>`;
    })
    .join('')}</div></section>`;
}
