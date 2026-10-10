import { esc } from './util';

/** A clue and a word, so the two things the app does are both one tap away. */
const EXAMPLES = ['old testament prophet', 'tide'];

/**
 * A line of welcome above the face-down board. The board is the empty state;
 * this only says what to do with it, and only until there is any history,
 * since recent searches do the same job better once they exist. Desktop,
 * which has room to speak for itself, hides it.
 */
export function renderEmpty(showExamples: boolean): string {
  if (!showExamples) return '';
  return `<div class="intro">
    <p>Type a clue or a word. It gets solved as a crossword clue and defined as a word, in one go.</p>
    <div class="examples"><span class="eyebrow">Try one</span>${EXAMPLES.map(
      (e) => `<button type="button" data-example="${esc(e)}">${esc(e)}</button>`,
    ).join('')}</div>
  </div>`;
}
