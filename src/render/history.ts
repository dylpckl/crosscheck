import type { HistoryEntry } from '../contract';
import { esc } from './util';

export function renderHistory(list: HistoryEntry[]): string {
  if (!list.length) return '';
  return `<div class="recent" role="group" aria-label="Recent searches">${list
    .slice(0, 12)
    .map(
      (h) =>
        `<button type="button" data-q="${esc(h.query)}" data-p="${esc(h.pattern ?? h.letters ?? '')}"${h.length && !h.pattern ? ` data-len="${h.length}"` : ''}>${esc(h.query)}${
          h.pattern || h.letters ? `<code>${esc(h.pattern ?? h.letters ?? '')}</code>` : ''
        }</button>`,
    )
    .join('')}</div>`;
}
