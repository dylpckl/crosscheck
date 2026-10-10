import { describe, expect, it } from 'vitest';
import { renderHistory } from '../../src/render/history';

const PHONE = { lengths: [3, 4, 5, 6, 7, 8], letters: false };
const WIDE = { lengths: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], letters: true };
const at = Date.now();

describe('recent pills', () => {
  it('shows a stored length only where the slider can reach it', () => {
    const list = [{ query: 'scud', pattern: 'S?????????E', at }];
    expect(renderHistory(list, PHONE)).not.toContain('<code>');
    expect(renderHistory(list, PHONE)).not.toContain('data-len');
    expect(renderHistory(list, WIDE)).toContain('<code>11</code>');
    expect(renderHistory(list, WIDE)).toContain('data-len="11"');
  });

  it('shows letters only where there is a box to hold them', () => {
    const list = [{ query: 'tide', letters: 'TD', at }];
    expect(renderHistory(list, PHONE)).not.toContain('<code>');
    expect(renderHistory(list, WIDE)).toContain('<code>TD</code>');
  });

  it('keeps the pattern on the pill for setQuery to reduce, whatever it shows', () => {
    const html = renderHistory([{ query: 'scud', pattern: 'SC?D?', at }], PHONE);
    expect(html).toContain('data-p="SC?D?"');
    expect(html).toContain('<code>5</code>');
    expect(html).toContain('aria-label="scud, 5 letters"');
  });
});
