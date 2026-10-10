import { describe, expect, it } from 'vitest';
import type { Answer } from '../../src/contract';
import { renderAnswers } from '../../src/render/answers';
import { renderMeaning } from '../../src/render/meaning';

const make = (display: string, score = 1, priority = 0): Answer => {
  const answer = display.toUpperCase().replace(/[^A-Z]/g, '');
  return { answer, display, length: answer.length, score, priority, fitsPattern: null, source: priority ? 'cluebank' : 'datamuse' };
};
/** Two published answers, three associations. */
const ANSWERS = [make('seer', 1, 1), make('ezra', 1, 1), make('nahum'), make('samuel'), make('soothsayer')];

describe('length constraint', () => {
  it('shows every length when none is set', () => {
    const html = renderAnswers(ANSWERS, { query: 'x' });
    expect(html).toContain('data-answer="SEER"');
    expect(html).toContain('data-answer="SOOTHSAYER"');
    expect(html).toContain('<span class="count">2</span>');
  });

  it('keeps only answers of the chosen length and says how many of the published ones that is', () => {
    const html = renderAnswers(ANSWERS, { query: 'x' }, { lengthFilter: 4 });
    // The count is of published answers: both four-letter ones are.
    expect(html).toContain('2 of 2');
    expect(html).toContain('data-answer="SEER"');
    expect(html).toContain('data-answer="EZRA"');
    expect(html).not.toContain('data-answer="NAHUM"');
  });

  it('is strict: a length nothing matches shows no answers, and the hand-off names the length', () => {
    // The slider is a constraint the reader set, so an empty result is the honest one.
    const html = renderAnswers(ANSWERS, { query: 'x' }, { lengthFilter: 9 });
    expect(html).not.toContain('data-answer=');
    expect(html).toContain('class="handoff"');
    expect(html).toContain('9 letters');
  });
});

describe('answer rows', () => {
  it('sets the gloss beside short fill and under longer fill', () => {
    const html = renderAnswers(ANSWERS, { query: 'x' });
    expect(html).toMatch(/class="row" [^>]*data-answer="SEER"/);
    expect(html).toMatch(/class="row stack" [^>]*data-answer="NAHUM"/);
    expect(html).toMatch(/class="row stack" [^>]*data-answer="SOOTHSAYER"/);
  });

  it('numbers each tile for the flip and keeps the length in the accessible name', () => {
    const html = renderAnswers([make('seer', 1, 1)], { query: 'x' });
    expect(html).toContain('style="--i:0">S');
    expect(html).toContain('style="--i:3">R');
    expect(html).toContain('seer, 4 letters.');
  });
});

describe('answers versus related words', () => {
  it('shows published answers under Answers and associations under their own heading', () => {
    const html = renderAnswers(ANSWERS, { query: 'prophet' });
    const answers = html.indexOf('data-answer="SEER"');
    const subhead = html.indexOf('class="subhead">Related words');
    const related = html.indexOf('data-answer="NAHUM"');
    expect(answers).toBeGreaterThan(-1);
    expect(subhead).toBeGreaterThan(answers);
    expect(related).toBeGreaterThan(subhead);
    expect(html).toContain('Related words <span class="count">3</span>');
  });

  it('counts only published answers in the heading', () => {
    expect(renderAnswers(ANSWERS, { query: 'prophet' })).toContain('<span class="count">2</span>');
  });

  it('never presents an association as an answer', () => {
    const html = renderAnswers([make('gods'), make('deity')], { query: 'false god' });
    expect(html).not.toMatch(/<h2>Answers <span class="count">/);
    expect(html).toContain('Related words');
  });

  it('offers the search the reader would have typed when nothing is published', () => {
    const html = renderAnswers([make('gods')], { query: 'false god' });
    expect(html).toContain('No published answer for <b>false god</b> yet.');
    expect(html).toContain('Google “false god crossword”');
    expect(html).toContain('href="https://www.google.com/search?q=false%20god%20crossword%20clue"');
    // The hand-off sits where the answers would be, above the associations.
    expect(html.indexOf('class="handoff"')).toBeLessThan(html.indexOf('Related words'));
  });

  it('carries the selected length into the hand-off', () => {
    const html = renderAnswers([make('gods'), make('deity')], { query: 'false god' }, { lengthFilter: 4 });
    expect(html).toContain('Google “false god crossword, 4 letters”');
    expect(html).toContain('false%20god%20crossword%20clue%204%20letters');
  });

  it('hands off even when there is nothing at all, so the page is never a dead end', () => {
    const html = renderAnswers([], { query: 'sawbuck' });
    expect(html).toContain('class="handoff-btn"');
    expect(html).not.toContain('Related words');
  });

  it('keeps the provider error visible alongside the hand-off', () => {
    const html = renderAnswers([], { query: 'sawbuck' }, { error: { provider: 'Datamuse', kind: 'http', message: 'Datamuse returned 503', status: 503 } });
    expect(html).toContain('Datamuse returned 503');
    expect(html).toContain('class="handoff-btn"');
  });
});

describe('spoiler mode', () => {
  it('keeps everything below the heading behind a tap', () => {
    const html = renderAnswers(ANSWERS, { query: 'prophet' }, { hidden: true });
    expect(html).toContain('data-reveal-answers');
    expect(html).toContain('Reveal 2 answers');
    expect(html).not.toContain('data-answer=');
    expect(html).not.toContain('Related words');
  });

  it('still shows the count in the heading, which is a hint but not a spoiler', () => {
    expect(renderAnswers(ANSWERS, { query: 'prophet' }, { hidden: true })).toContain('<span class="count">2</span>');
  });

  it('names related words honestly when that is all there is to reveal', () => {
    expect(renderAnswers([make('gods')], { query: 'x' }, { hidden: true })).toContain('Reveal 1 related word<');
  });

  it('has nothing to hide when there are no answers, so the hand-off shows as normal', () => {
    const html = renderAnswers([], { query: 'sawbuck' }, { hidden: true });
    expect(html).not.toContain('data-reveal-answers');
    expect(html).toContain('class="handoff-btn"');
  });
});

describe('meaning disclosure', () => {
  const LINKS = [{ label: 'Google', url: 'https://example.com' }];
  const REF = {
    title: 'Tide',
    extract: 'Tides are the rise and fall of sea levels.',
    url: 'https://en.m.wikipedia.org/wiki/Tide',
    kind: 'standard' as const,
    source: 'wikipedia' as const,
  };
  const DEF = {
    term: 'tide',
    phonetic: '/taɪd/',
    senses: [
      { partOfSpeech: 'n.', definition: 'The periodic rise and fall of the sea.' },
      { partOfSpeech: 'n.', definition: 'A powerful surge of feeling.' },
    ],
    source: 'dictionaryapi' as const,
  };

  it('is closed unless asked otherwise', () => {
    expect(renderMeaning(DEF, REF, LINKS, 'tide')).toContain('aria-expanded="false"');
  });

  it('carries both sources in one disclosure', () => {
    const html = renderMeaning(DEF, REF, LINKS, 'tide', [], { open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="section meaning open"');
    expect(html).toContain('The periodic rise and fall of the sea.');
    expect(html).toContain('Tides are the rise and fall of sea levels.');
    expect(html).toContain('Free Dictionary API');
    expect(html).toContain('Wikipedia');
  });

  it('keeps both states in the DOM so the height can animate', () => {
    const html = renderMeaning(DEF, REF, LINKS, 'tide', [], { open: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="section meaning open"');
    // Collapsed, but present: CSS transitions the grid row, not display.
    expect(html).toContain('class="peek"');
    expect(html).toContain('The periodic rise and fall of the sea.');
  });

  it('peeks the summary when only Wikipedia has anything', () => {
    const html = renderMeaning(null, REF, LINKS, 'big apple', [], { open: false });
    expect(html).toContain('data-toggle-meaning');
    expect(html).toContain('Tides are the rise and fall of sea levels.');
  });

  it('stays one collapsed line when neither source has anything, with the links behind it', () => {
    // Meaning sits above the answers, so an empty result must cost no more
    // screen than a full one does when closed.
    const html = renderMeaning(null, null, LINKS, 'out of the country');
    expect(html).toContain('data-toggle-meaning');
    expect(html).toContain('class="peek"');
    expect(html).toContain('No dictionary entry');
    expect(html.indexOf('Search elsewhere')).toBeGreaterThan(html.indexOf('bodywrap'));
  });

  it('surfaces a provider error as the collapsed line', () => {
    const html = renderMeaning(null, null, LINKS, 'x', [{ provider: 'Free Dictionary', kind: 'timeout', message: 'Free Dictionary took longer than 8s' }]);
    expect(html).toContain('class="peek bad"');
    expect(html).toContain('took longer than 8s');
  });

  it('keeps the links inside the disclosure', () => {
    const html = renderMeaning(DEF, REF, LINKS, 'tide', [], { open: true });
    expect(html.indexOf('Search elsewhere')).toBeGreaterThan(html.indexOf('bodywrap'));
  });
});
