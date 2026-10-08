import type { Definition, DefinitionProvider, Sense } from '../contract';
import { fetchJson, NotFound } from '../http';
import { abbrev, MAX_SENSES } from './dictionaryapi';

export interface WiktionaryResponse {
  en?: { partOfSpeech?: string; definitions?: { definition?: string; examples?: string[] }[] }[];
}

export const NAME = 'Wiktionary';
export const USER_AGENT = 'crosscheck (https://github.com/dylpckl/crosscheck)';

export function buildUrl(query: string): string {
  return `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(query.replace(/ /g, '_'))}`;
}

/**
 * Wiktionary entries are case-sensitive: "Big Apple" exists, "big apple" 404s.
 * Returns the title-cased variant to retry with, or null when it's the same.
 */
export function titleCased(query: string): string | null {
  const cased = query.replace(/\S+/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  return cased === query ? null : cased;
}

export function stripHtml(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function mapDefinition(res: WiktionaryResponse, query: string): Definition | null {
  const senses: Sense[] = [];
  for (const block of res.en ?? []) {
    for (const d of block.definitions ?? []) {
      const text = d.definition ? stripHtml(d.definition) : '';
      if (!text) continue;
      const ex = d.examples?.[0] ? stripHtml(d.examples[0]) : undefined;
      senses.push({ partOfSpeech: abbrev(block.partOfSpeech), definition: text, example: ex || undefined });
      if (senses.length >= MAX_SENSES) break;
    }
    if (senses.length >= MAX_SENSES) break;
  }
  if (!senses.length) return null;
  return {
    term: query,
    senses,
    source: 'wiktionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(query.replace(/ /g, '_'))}`,
  };
}

export const wiktionary: DefinitionProvider = {
  name: NAME,
  async fetch(req, signal) {
    const attempt = async (query: string) => {
      const res = await fetchJson<WiktionaryResponse>(NAME, buildUrl(query), signal, {
        headers: { 'Api-User-Agent': USER_AGENT },
      });
      return mapDefinition(res, query);
    };
    try {
      return await attempt(req.query);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    }
    const cased = titleCased(req.query);
    if (!cased) return null;
    try {
      return await attempt(cased);
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  },
};
