import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Answer } from '../../src/contract';
import { parseDef } from '../../src/providers/datamuse';
import { applyGlosses, clearGlossMemo, findGlosses, MAX_LOOKUPS, pickGloss } from '../../src/providers/glosses';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const bare = (answer: string, priority = 1): Answer => ({
  answer,
  display: answer.toLowerCase(),
  length: answer.length,
  score: 1,
  priority,
  fitsPattern: null,
  source: 'cluebank',
});

describe('parseDef', () => {
  it('splits the part of speech from the text', () => {
    expect(parseDef('n\tless than average tide')).toEqual({ pos: 'n', text: 'less than average tide' });
  });
  it('keeps a definition with no part of speech whole', () => {
    expect(parseDef('just text')).toEqual({ pos: undefined, text: 'just text' });
    expect(parseDef(undefined)).toEqual({});
  });
});

describe('pickGloss', () => {
  it('takes the first definition of the exact word', () => {
    const rows = [{ word: 'neap', defs: ['n\tless than average tide', 'adj\tother'] }];
    expect(pickGloss(rows, 'NEAP')).toEqual({ text: 'less than average tide', pos: 'n' });
  });
  it('ignores other words and rows without definitions', () => {
    expect(pickGloss([{ word: 'neaps', defs: ['n\tx'] }, { word: 'neap' }], 'NEAP')).toBeNull();
  });
});

describe('findGlosses', () => {
  beforeEach(() => clearGlossMemo());

  it('looks up published answers that have no gloss, and only those', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const word = new URL(String(input)).searchParams.get('sp')!;
      return json([{ word, defs: [`n\tdefinition of ${word}`] }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const found = await findGlosses([bare('NEAP'), { ...bare('EBB'), gloss: 'kept' }, bare('FLOW', 0)], new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...found.entries()]).toEqual([['NEAP', { text: 'definition of neap', pos: 'n' }]]);
  });

  it('caps the lookups and remembers results for the session', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const answers = 'ABCDEFGHIJKL'.split('').map((c) => bare(c.repeat(3)));
    await findGlosses(answers, new AbortController().signal);
    await findGlosses(answers, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_LOOKUPS);
  });

  it('treats a failed lookup as no gloss', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    expect((await findGlosses([bare('NEAP')], new AbortController().signal)).size).toBe(0);
  });
});

describe('applyGlosses', () => {
  const found = new Map([['NEAP', { text: 'less than average tide', pos: 'n' }]]);

  it('fills a missing gloss and its part of speech', () => {
    const [a] = applyGlosses([bare('NEAP')], found);
    expect(a!.gloss).toBe('less than average tide');
    expect(a!.partOfSpeech).toEqual(['n']);
  });
  it('never overwrites a gloss, and returns the same array when nothing changes', () => {
    const answers = [{ ...bare('NEAP'), gloss: 'stock clue' }];
    expect(applyGlosses(answers, found)).toBe(answers);
  });
});
