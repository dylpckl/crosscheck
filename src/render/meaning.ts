import type { Definition, ProviderError, Reference, SearchLink } from '../contract';
import { linkRow } from './links';
import { esc } from './util';

const SHOWN = 2;
const SOURCE_LABEL = { dictionaryapi: 'Free Dictionary API', wiktionary: 'Wiktionary', datamuse: 'Datamuse' } as const;
const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

export function skeletonMeaning(): string {
  return `<section class="section meaning" id="sec-meaning"><h2>Meaning</h2><div class="sk short"></div></section>`;
}

/**
 * Desktop: Meaning holds its column from the start, so nothing shifts when a
 * definition lands. Until then the card is blank, matching the face-down board.
 */
export function renderBlankMeaning(): string {
  return `<section class="section meaning open blankmeaning" id="sec-meaning" aria-hidden="true"><h2>Meaning</h2>
    <div class="bodywrap"><div class="inner"><div class="panel"><i class="bar w40"></i><i class="bar"></i><i class="bar w80"></i><i class="bar w60"></i></div></div></div></section>`;
}

export interface MeaningOpts {
  /** Expanded shows the cards; collapsed shows one line you can tap open. */
  open?: boolean;
}

/** Closed unless asked otherwise: answers are what the search was for. */

/**
 * Meaning gathers everything that answers "what is this": the dictionary entry,
 * the Wikipedia summary, and the links out. They come from different sources —
 * each says which — but they answer the same question, so they share one
 * disclosure.
 *
 * Both states are always in the DOM. The closed one is collapsed to zero height
 * by a grid row transition, which is what lets the open and close animate in CSS
 * with no height measuring.
 */
export function renderMeaning(
  d: Definition | null,
  r: Reference | null,
  links: SearchLink[],
  query: string,
  errors: ProviderError[] = [],
  opts: MeaningOpts = {},
): string {
  const open = opts.open === true;
  if (!d && !r) {
    // Nothing to define, but the section keeps the same shape: one line
    // collapsed, the links behind it. Meaning sits above the answers, so it
    // has to cost the same single line whether or not a definition came back.
    const err = errors.find((e) => e.provider === 'Free Dictionary' || e.provider === 'Wiktionary');
    const msg = err ? `${esc(err.message)}.` : `No dictionary entry for “${esc(query)}”. Phrases often don't have one.`;
    return `<section class="section meaning${open ? ' open' : ''}" id="sec-meaning">
    <h2><button type="button" class="disclosure" data-toggle-meaning aria-expanded="${open}" aria-controls="meaning-body">Meaning${CHEVRON}</button></h2>
    <div class="peekwrap"><div class="inner"><button type="button" class="peek${err ? ' bad' : ''}" data-toggle-meaning tabindex="${open ? -1 : 0}">${msg}</button></div></div>
    <div class="bodywrap" id="meaning-body"><div class="inner"><div class="panel">${linkRow(links)}</div></div></div></section>`;
  }
  return `<section class="section meaning${open ? ' open' : ''}" id="sec-meaning">
    <h2><button type="button" class="disclosure" data-toggle-meaning aria-expanded="${open}" aria-controls="meaning-body">Meaning${
      r?.kind === 'disambiguation' ? '<span class="pill">Several meanings</span>' : ''
    }${CHEVRON}</button></h2>
    <div class="peekwrap"><div class="inner"><button type="button" class="peek" data-toggle-meaning tabindex="${open ? -1 : 0}">${peek(d, r)}</button></div></div>
    <div class="bodywrap" id="meaning-body"><div class="inner"><div class="panel">
      ${d ? definitionCard(d) : ''}
      ${r ? referenceCard(r) : ''}
      ${linkRow(links)}
    </div></div></div></section>`;
}

/** One line for the collapsed state: the definition if there is one, else the summary. */
function peek(d: Definition | null, r: Reference | null): string {
  if (d) {
    const first = d.senses[0];
    return `${esc(d.term)}${first ? ` <span class="pos">${esc(first.partOfSpeech ?? '')}</span>${esc(first.definition)}` : ''}`;
  }
  return r ? `${esc(r.title)} <span class="pos">wiki</span>${esc(r.extract)}` : '';
}

function definitionCard(d: Definition): string {
  const extra = Math.max(0, d.senses.length - SHOWN);
  const senses = d.senses
    .map(
      (s, i) => `<li class="${i >= SHOWN ? 'more' : ''}"><span class="pos">${esc(s.partOfSpeech ?? '')}</span><span>${esc(s.definition)}${
        s.example ? `<span class="ex">“${esc(s.example)}”</span>` : ''
      }</span></li>`,
    )
    .join('');
  return `<div class="block">
    <div class="head"><span class="term">${esc(d.term)}</span>${d.phonetic ? `<span class="ipa">${esc(d.phonetic)}</span>` : ''}
      ${d.audioUrl ? `<button class="play" type="button" aria-label="Play pronunciation" data-audio="${esc(d.audioUrl)}"><svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg></button>` : ''}
    </div>
    <ul class="senses">${senses}</ul>
    ${extra ? `<button type="button" class="toggle" data-expand><span class="when-closed">⌄ ${extra} more sense${extra > 1 ? 's' : ''}</span><span class="when-open">⌃ Fewer senses</span></button>` : ''}
    <div class="src">${SOURCE_LABEL[d.source]}${d.sourceUrl ? ` · <a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ''}</div>
  </div>`;
}

function referenceCard(r: Reference): string {
  return `<a class="block about${r.thumbnailUrl ? '' : ' nothumb'}" href="${esc(r.url)}" target="_blank" rel="noopener">
    ${r.thumbnailUrl ? `<span class="thumb"><img src="${esc(r.thumbnailUrl)}" alt="" loading="lazy" onerror="this.closest('.about').classList.add('nothumb');this.parentElement.remove()"></span>` : ''}
    <span><span class="title">${esc(r.title)} <span class="ext">Wikipedia ↗</span></span><span class="extract">${esc(r.extract)}</span></span>
  </a>`;
}
