import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Answer } from '../../src/contract';
import { clearGlossMemo, fillGlosses, MAX_LOOKUPS, pickGloss } from '../../src/providers/glosses';

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

describe('pickGloss', () => {
  it('takes the first definition of the exact word, without its part-of-speech prefix', () => {
    const rows = [{ word: 'neap', defs: ['n\tless than average tide', 'adj\tother'] }];
    expect(pickGloss(rows, 'NEAP')).toBe('less than average tide');
  });
  it('ignores other words and rows without definitions', () => {
    expect(pickGloss([{ word: 'neaps', defs: ['n\tx'] }, { word: 'neap' }], 'NEAP')).toBeNull();
  });
});

describe('fillGlosses', () => {
  beforeEach(() => clearGlossMemo());

  it('looks up published answers that have no gloss, and only those', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const word = new URL(String(input)).searchParams.get('sp')!;
      return json([{ word, defs: [`n\tdefinition of ${word}`] }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const answers = [bare('NEAP'), { ...bare('EBB'), gloss: 'kept' }, bare('FLOW', 0)];
    const out = await fillGlosses(answers, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.map((a) => a.gloss)).toEqual(['definition of neap', 'kept', undefined]);
  });

  it('caps the lookups and remembers results for the session', async () => {
    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetchMock);
    const answers = 'ABCDEFGHIJKL'.split('').map((c) => bare(c.repeat(3)));
    await fillGlosses(answers, new AbortController().signal);
    await fillGlosses(answers, new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_LOOKUPS);
  });

  it('returns the same array when nothing was found or the lookup failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    const answers = [bare('NEAP')];
    expect(await fillGlosses(answers, new AbortController().signal)).toBe(answers);
  });
});
