import type { Answer, SolveResult, SolveRequest } from '../contract';
import { parsePattern } from '../pattern';
import { renderAnswers, renderBlankAnswers } from '../render/answers';
import { renderEmpty } from '../render/empty';
import { renderHistory } from '../render/history';
import { renderBlankMeaning, renderMeaning } from '../render/meaning';
import { rankAnswers } from '../rank';
import { buildRequest, isBuildError, solve } from '../solve';
import { getHistory, getSettings, pushHistory } from '../store';
import { buildLinks } from '../providers/links';
import { desk } from './layout';
import type { Shell } from './shell';

export interface Solver {
  setQuery(q: string, pattern?: string, submit?: boolean, length?: number): void;
  refreshHistory(): void;
  /** Re-read settings that affect the solver view (result order). */
  applySettings(): void;
}

/**
 * Lengths the slider offers after "Any". Wide screens get the full crossword
 * range. Phones stop at 8: in the shipped clue bank, 3 to 8 letters covers
 * 94% of published answers, and seven stops across a phone-width track is
 * what a thumb can land on; the long tail is better served by the hand-off.
 */
const LENGTHS_WIDE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const LENGTHS_PHONE = [3, 4, 5, 6, 7, 8];
const lengths = () => (desk.matches ? LENGTHS_WIDE : LENGTHS_PHONE);

export function mountSolver(view: HTMLElement, shell: Shell): Solver {
  view.innerHTML = `
    <div class="searchbar">
      <div class="querybar" id="querybar">
      <span class="ctl-label" aria-hidden="true">Clue</span>
      <form class="search" id="form" autocomplete="off">
        <label class="field" id="field">
          <span class="sr">Clue</span>
          <input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="Word or phrase" autofocus>
          <button type="button" class="clear" id="clear" aria-label="Clear" hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
          </button>
        </label>
        <button class="go" type="submit" aria-label="Solve">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        </button>
      </form>
      <div class="form-error" id="formError" hidden></div>
      </div>
      <!-- Length and letters as separate controls under the clue. There is no
           positional-pattern input: the parser still understands one arriving
           from history or a link (see setQuery), but only its length, and on
           wide screens its known letters, can be shown, so only those apply.
           Letters show on wide screens only; the slider is on every layout,
           its track and ticks built from lengths() in setLength. -->
      <div class="controls">
        <label class="lenctl">
          <span class="ctl-head"><span class="ctl-label">Length</span><span class="lenval" id="lenval">Any length</span></span>
          <input id="len" type="range" min="0" max="${lengths().length}" step="1" value="0" aria-valuetext="Any length">
          <span class="ticks" id="ticks" aria-hidden="true"></span>
        </label>
        <div class="letctl">
          <span class="ctl-label" id="letters-label">Letters you have</span>
          <div class="tagbox" id="tagbox">
            <span class="tags" id="tags"></span>
            <input id="tagin" type="text" placeholder="Type a letter" aria-labelledby="letters-label" autocapitalize="characters" autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>
    </div>
    <div id="out"></div>
    <div id="recent"></div>`;

  const $ = <T extends HTMLElement>(id: string) => view.querySelector<T>(`#${id}`)!;
  const q = $<HTMLInputElement>('q'), out = $('out'), form = $<HTMLFormElement>('form');
  const formError = $('formError'), clearBtn = $('clear');
  const len = $<HTMLInputElement>('len'), ticks = $('ticks'), tagin = $<HTMLInputElement>('tagin'), field = $('field');
  const sections = { meaning: '', answers: '' };

  /** The slider's exact length (null = any), and on wide screens the letters already known, in any order. */
  let sliderLength: number | null = null;
  let deskLetters = '';

  /**
   * Letters can change while a search is in flight. Results arriving for the
   * same fetch are re-ranked against the letters as they stand now, so a
   * letter typed mid-search is not lost when the result lands.
   */
  function restrain(req: SolveRequest, answers: Answer[]): { req: SolveRequest; answers: Answer[] } {
    const now = request();
    if (isBuildError(now) || !sameFetch(now, req)) return { req, answers };
    return { req: now, answers: rankAnswers(answers, now) };
  }

  /** Whether two requests fetch the same thing; letters are view-time only, so they don't count. */
  const sameFetch = (a: SolveRequest, b: SolveRequest) => a.query === b.query && a.pattern === b.pattern && a.length === b.length;

  /**
   * The request as the inputs stand. The visible controls are the whole
   * constraint, so nothing can apply that the reader can't see.
   */
  function request(): ReturnType<typeof buildRequest> {
    const built = buildRequest(q.value);
    if (isBuildError(built)) return built;
    if (sliderLength) built.length = sliderLength;
    if (deskLetters) built.letters = deskLetters;
    return built;
  }

  /**
   * Wrap a re-render so the browser tweens between the old and new lists.
   * View Transitions do the work; where they're missing, or motion is not
   * wanted, the change simply applies at once.
   */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function withTransition(fn: () => void) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (reduceMotion.matches || !doc.startViewTransition) { fn(); return; }
    doc.startViewTransition(fn);
  }

  let ctl: AbortController | null = null;
  let current: SolveResult | null = null;
  /**
   * Answers as they stand before every provider has settled. Meaning waits on
   * a dictionary that can take eight seconds to time out, so `current` is not
   * set until well after the answers are on screen — and the length filter
   * has to work in that gap, not sit dead until the slowest provider gives up.
   */
  let live: { req: SolveRequest; answers: Answer[] } | null = null;
  let liveTimer: number | undefined;

  /**
   * Whether the Meaning section is open. Closed by default on every search:
   * answers are what was asked for, and the definition is one tap away when
   * it's wanted. Sections keep a fixed order, so nothing reflows as results land.
   */
  let meaningOpen = false;
  /** On desktop, Meaning has its own column and is always open. */
  const meaningShown = () => meaningOpen || desk.matches;
  /** Spoiler mode: whether this search's answers have been tapped open. */
  let revealed = false;

  function paint() {
    // Meaning first: collapsed, it is one line, so answers still start at the
    // top of the screen — and it never has to be scrolled past a long list to
    // be found. Spoiler mode builds on the same order.
    const body = sections.meaning + sections.answers;
    if (!body) resetFlip(true);
    // Nothing to show is a face-down board, with a line of welcome until there is any history to stand in for it.
    out.innerHTML = body || renderEmpty(getHistory().length === 0) + renderBlankMeaning() + renderBlankAnswers();
  }
  /**
   * Swap one section in place. Rebuilding the whole of `out` for a change to
   * one section throws away the other's DOM mid-interaction — a definition
   * landing would tear out the answer list under the reader's thumb.
   */
  function paintSection(id: string, html: string) {
    const el = out.querySelector(id);
    if (el) el.outerHTML = html;
    else paint();
  }
  /**
   * Turning the board over. The local corpus, the clue bank and Datamuse land
   * a beat apart, so the first answers of a search wait GATHER_MS for the
   * rest to catch up and turn over in one wave. Repaints during a flip wait
   * for it to finish, since rebuilding the tiles mid-turn would restart them;
   * answers that arrive later turn over on their own, rows already face up
   * stay put.
   */
  const GATHER_MS = 250;
  const FLIP_MS = 1300;
  /** This search started from the blank board, so its answers turn over as they arrive. */
  let flipSearch = false;
  /** Whether the first answers of a flipping search have had their gather window yet. */
  let gathered = false;
  let flipUntil = 0;
  let flipTimer: number | undefined;
  function resetFlip(on: boolean) {
    clearTimeout(flipTimer);
    flipSearch = on;
    gathered = false;
    flipUntil = 0;
  }
  function paintAnswers() {
    if (flipSearch && !gathered) {
      gathered = true;
      flipUntil = Date.now() + GATHER_MS;
    }
    const wait = flipUntil - Date.now();
    if (wait > 0) {
      clearTimeout(flipTimer);
      flipTimer = window.setTimeout(paintAnswers, wait);
      return;
    }
    const before = new Set([...out.querySelectorAll<HTMLElement>('#sec-answers .row[data-answer]')].map((r) => r.dataset.answer));
    paintSection('#sec-answers', sections.answers);
    if (!flipSearch) return;
    const sec = out.querySelector('#sec-answers');
    const rows = [...(sec?.querySelectorAll<HTMLElement>('.row[data-answer]') ?? [])];
    if (!sec || !rows.some((r) => !before.has(r.dataset.answer))) return;
    sec.classList.add('flip');
    rows.forEach((r) => r.classList.toggle('shown', before.has(r.dataset.answer)));
    flipUntil = Date.now() + FLIP_MS;
  }
  const paintMeaningSection = () => paintSection('#sec-meaning', sections.meaning);
  /** Re-render every section, in place. */
  function repaintAll() {
    if (!current) return;
    renderSections();
    paintMeaningSection();
    paintAnswers();
  }
  /**
   * Renders from the finished result when there is one, the partial otherwise.
   * The slider is a standing constraint: it is never dropped because a partial
   * result has nothing of that length yet, and a length with no answers shows
   * as none rather than as every length.
   */
  function renderAnswersSection() {
    const hidden = getSettings().hideAnswers && !revealed;
    if (current) {
      const r = current;
      sections.answers = renderAnswers(r.answers, r.request, {
        fromCache: r.fromCache,
        error: r.errors.find((e) => e.provider === 'Datamuse'),
        lengthFilter: sliderLength,
        hidden,
      });
    } else if (live) {
      sections.answers = renderAnswers(live.answers, live.req, { lengthFilter: sliderLength, hidden });
    }
  }
  function renderSections() {
    if (current) {
      const r = current, req = r.request;
      sections.meaning = renderMeaning(r.definition, r.reference, r.links, req.query, r.errors, { open: meaningShown() });
    }
    renderAnswersSection();
  }

  /** Toggling only flips a class, so the CSS height transition can run. */
  function toggleMeaning() {
    if (desk.matches) return;
    meaningOpen = !meaningOpen;
    const sec = out.querySelector('#sec-meaning');
    sec?.classList.toggle('open', meaningOpen);
    sec?.querySelector('.disclosure')?.setAttribute('aria-expanded', String(meaningOpen));
    sec?.querySelector('.peek')?.setAttribute('tabindex', meaningOpen ? '-1' : '0');
    renderSections();
  }

  function applySettings() {
    repaintAll();
  }
  /** Empty input means no results: drop them rather than leave a stale answer set. */
  function clearResults() {
    ctl?.abort();
    ctl = null;
    clearTimeout(liveTimer);
    clearTimeout(historyTimer);
    current = null;
    live = null;
    revealed = false;
    sections.meaning = '';
    sections.answers = '';
    formError.hidden = true;
    paint();
  }

  /** Recent pills show only the constraints this layout can honour: a length on its slider, letters on wide screens. */
  function refreshHistory() {
    $('recent').innerHTML = renderHistory(getHistory(), { lengths: lengths(), letters: desk.matches });
  }

  /** Letters changed: re-rank what we have instantly. Length changed: refetch. */
  function onConstraintInput() {
    const built = request();
    if (isBuildError(built)) return;
    // What the controls act on: the finished result, else the partial, else (null) a search still in flight.
    const inFlight = Boolean(ctl && !ctl.signal.aborted);
    const base = current?.request ?? live?.req ?? (inFlight ? null : undefined);
    if (base === undefined) return;
    clearTimeout(liveTimer);
    if (base && sameFetch(built, base)) {
      if (current) {
        current = { ...current, request: built, answers: rankAnswers(current.answers, built) };
        repaintAll();
      } else if (live) {
        // Still loading: re-rank what has arrived; the finished result picks the letters up via restrain().
        live = { req: built, answers: rankAnswers(live.answers, built) };
        renderAnswersSection();
        paintAnswers();
      }
    } else {
      // Length or pattern changed: refetch, mid-search or not, so the results match the controls.
      liveTimer = window.setTimeout(() => run(true), desk.matches ? 250 : 500);
    }
  }

  /**
   * Searches fired by typing are provisional: "tid" on the way to "tide" is
   * not a search anyone made. They reach history only once the input has
   * rested on them; a submitted search goes in at once.
   */
  let historyTimer: number | undefined;

  /** Loading placeholders: the face-down board, on every layout. */
  function placeholders() {
    sections.meaning = renderBlankMeaning();
    sections.answers = renderBlankAnswers();
  }

  async function run(fromTyping = false) {
    const built = request();
    if (isBuildError(built)) {
      formError.textContent = built.error;
      formError.hidden = false;
      return;
    }
    formError.hidden = true;
    const req: SolveRequest = built;
    ctl?.abort();
    clearTimeout(historyTimer);
    ctl = new AbortController();
    const mine = ctl;
    revealed = false;
    // Typing over results already on screen keeps them until the new ones
    // land, rather than turning the board face down on every pause.
    const keep = fromTyping && Boolean(current || live);
    current = null;
    live = null;
    meaningOpen = false;
    resetFlip(!keep);
    if (!keep) {
      placeholders();
      paint();
    }

    // The two halves of Meaning land separately; keep both and redraw the pair.
    let liveDef: Parameters<typeof renderMeaning>[0] = null;
    let liveRef: Parameters<typeof renderMeaning>[1] = null;
    const paintMeaning = () => {
      sections.meaning = renderMeaning(liveDef, liveRef, buildLinks(req.query, liveRef !== null), req.query, [], { open: meaningShown() });
      paintMeaningSection();
    };
    if (!desk.matches) window.scrollTo({ top: 0, behavior: 'smooth' });

    const result = await solve(req, mine.signal, {
      answers: (a) => {
        if (mine.signal.aborted) return;
        live = restrain(req, a);
        renderAnswersSection();
        paintAnswers();
      },
      definition: (d) => {
        if (mine.signal.aborted) return;
        liveDef = d;
        paintMeaning();
      },
      reference: (r) => {
        if (mine.signal.aborted) return;
        liveRef = r;
        paintMeaning();
      },
      done: (r) => {
        if (mine.signal.aborted) return;
        const now = restrain(r.request, r.answers);
        current = { ...r, request: now.req, answers: now.answers };
        repaintAll();
      },
    });
    if (mine.signal.aborted) return;
    const record = () => {
      const length = req.pattern ? undefined : req.length;
      pushHistory({ query: req.query, pattern: req.pattern, letters: req.letters, length, at: Date.now(), topAnswer: result.answers[0]?.answer });
      refreshHistory();
    };
    if (fromTyping) historyTimer = window.setTimeout(record, 2000);
    else record();
  }

  // ---- events ----
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(liveTimer);
    // Blurring drops the phone keyboard so results have the screen; on desktop it would just lose the caret.
    if (!desk.matches) q.blur();
    run();
  });
  /** A long clue steps the serif input down a size on a phone, so more of it stays in view. */
  const fitClue = () => field.classList.toggle('longq', q.value.length > 14);
  q.addEventListener('input', () => {
    clearBtn.hidden = !q.value;
    fitClue();
    if (!q.value.trim()) { clearResults(); return; }
    // Search as you type, on every layout. The whole search waits out a short pause, longer on a phone where typing is slower.
    if (navigator.onLine && q.value.trim().length >= 3) {
      clearTimeout(liveTimer);
      liveTimer = window.setTimeout(() => run(true), desk.matches ? 250 : 450);
    }
  });

  // ---- constraints ----
  function setLength(n: number | null) {
    const stops = lengths();
    // Only lengths this layout's slider can show; anything else (say ?p=20 in a link) means any length.
    if (n !== null && !stops.includes(n)) n = null;
    sliderLength = n;
    // Track and tick labels come from the same list, so they cannot drift apart across layouts.
    len.max = String(stops.length);
    if (ticks.childElementCount !== stops.length + 1) ticks.innerHTML = `<span>Any</span>${stops.map((s) => `<span>${s}</span>`).join('')}`;
    len.value = String(n === null ? 0 : stops.indexOf(n) + 1);
    const label = n === null ? 'Any length' : `${n} letters`;
    $('lenval').textContent = label;
    len.setAttribute('aria-valuetext', label);
    ticks.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i === Number(len.value)));
  }
  len.addEventListener('input', () => {
    setLength(lengths()[Number(len.value) - 1] ?? null);
    // Filter what is on screen now; onConstraintInput refetches for the new length after a pause.
    // With nothing searched yet there is nothing to filter, and the blank board stays as it is.
    if (current || live) {
      renderAnswersSection();
      paintAnswers();
    }
    onConstraintInput();
  });

  function setLetters(letters: string) {
    deskLetters = letters;
    $('tags').innerHTML = [...letters]
      .map((c) => `<span class="tag">${c}<button type="button" data-untag="${c}" aria-label="Remove ${c}">×</button></span>`)
      .join('');
  }
  /** Letters only re-rank and highlight, so they apply instantly with no fetch. */
  function changeLetters(letters: string) {
    setLetters(letters);
    onConstraintInput();
  }
  tagin.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      const c = e.key.toUpperCase();
      if (!deskLetters.includes(c)) changeLetters(deskLetters + c);
    } else if (e.key === 'Backspace' && !tagin.value && deskLetters) {
      e.preventDefault();
      changeLetters(deskLetters.slice(0, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // Paste, autocorrect and on-screen keyboards arrive as input rather than keydown.
  tagin.addEventListener('input', () => {
    const add = [...new Set(tagin.value.toUpperCase().replace(/[^A-Z]/g, ''))].filter((c) => !deskLetters.includes(c));
    tagin.value = '';
    if (add.length) changeLetters(deskLetters + add.join(''));
  });
  $('tagbox').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-untag]');
    if (b) changeLetters(deskLetters.replace(b.dataset.untag!, ''));
    tagin.focus();
  });

  desk.addEventListener('change', () => {
    // The letters box vanishes below the breakpoint, and the slider shortens;
    // don't leave a constraint applied that the controls no longer show.
    const before = sliderLength;
    const hadLetters = Boolean(deskLetters);
    setLength(sliderLength);
    if (!desk.matches && hadLetters) setLetters('');
    if (before !== sliderLength || (!desk.matches && hadLetters)) onConstraintInput();
    refreshHistory();
    applySettings();
  });
  clearBtn.addEventListener('click', () => {
    q.value = '';
    clearBtn.hidden = true;
    fitClue();
    clearResults();
    q.focus();
  });

  // tap = copy, hold = chain lookup
  let holdTimer: number | undefined, held = false;
  out.addEventListener('pointerdown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    // Blank rows on the face-down board have nothing to copy or look up.
    if (!row?.dataset.answer) return;
    held = false;
    holdTimer = window.setTimeout(() => {
      held = true;
      setQuery(row.dataset.display!, '', true);
      shell.toast(`Looking up “${row.dataset.display}”`);
    }, 520);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) out.addEventListener(ev, () => clearTimeout(holdTimer));
  out.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest('.row')) e.preventDefault(); });
  out.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.row');
    if (row?.dataset.answer) {
      if (held) return;
      navigator.clipboard?.writeText(row.dataset.answer!).then(
        () => shell.toast(`Copied ${row.dataset.answer}`),
        () => shell.toast(row.dataset.answer!),
      );
      return;
    }
    if (t.closest('[data-toggle-meaning]')) { toggleMeaning(); return; }
    if (t.closest('[data-reveal-answers]')) { revealed = true; renderAnswersSection(); withTransition(paintAnswers); return; }
    const eg = t.closest<HTMLElement>('[data-example]');
    if (eg) { setQuery(eg.dataset.example!, '', true); return; }
    const play = t.closest<HTMLElement>('[data-audio]');
    if (play) { new Audio(play.dataset.audio).play().catch(() => shell.toast("Couldn't play audio")); return; }
    if (t.closest('[data-expand]')) t.closest('.block')?.classList.toggle('expanded');
  });
  $('recent').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-q]');
    if (b) setQuery(b.dataset.q!, b.dataset.p ?? '', true, b.dataset.len ? Number(b.dataset.len) : undefined);
  });

  function setQuery(query: string, pattern = '', submit = false, length?: number) {
    q.value = query;
    clearBtn.hidden = !query;
    fitClue();
    // There is no pattern input, so a constraint lands in the controls that own each part.
    // A positional pattern becomes its length and its known letters, since positions can't
    // show; on a phone, which has no letters box either, only the length survives.
    const c = parsePattern(pattern);
    const known = c.pattern ? [...new Set(c.pattern.replace(/\?/g, ''))].join('') : (c.letters ?? '');
    setLength(length ?? c.length ?? null);
    setLetters(desk.matches ? known : '');
    if (submit) run();
  }

  setLength(null);
  refreshHistory();
  applySettings();
  paint();
  return { setQuery, refreshHistory, applySettings };
}
