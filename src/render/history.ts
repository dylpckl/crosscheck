import type { HistoryEntry } from '../contract';
import { esc } from './util';

/**
 * Recent searches, under the answers: a row of pills that scrolls sideways on
 * a phone and wraps on a wide screen. Where they were, under the input, they
 * outranked the answers; at the bottom they are there when a search is done.
 */
export function renderHistory(list: HistoryEntry[]): string {
  if (!list.length) return '';
  return `<section class="section recent-sec"><h2>Recent</h2><div class="recent" role="group" aria-label="Recent searches">${list
    .slice(0, 12)
    .map(
      (h) =>
        `<button type="button" data-q="${esc(h.query)}" data-p="${esc(h.pattern ?? h.letters ?? '')}"${h.length && !h.pattern ? ` data-len="${h.length}"` : ''}>${esc(h.query)}${
          h.pattern || h.letters ? `<code>${esc(h.pattern ?? h.letters ?? '')}</code>` : ''
        }</button>`,
    )
    .join('')}</div></section>`;
}
