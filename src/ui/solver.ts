import type { Answer, SolveResult, SolveRequest } from '../contract';
import { parsePattern } from '../pattern';
import { renderAnswers, renderBlankAnswers, skeletonAnswers } from '../render/answers';
import { renderEmpty } from '../render/empty';
import { renderHistory } from '../render/history';
import { renderBlankMeaning, renderMeaning, skeletonMeaning } from '../render/meaning';
import { esc } from '../render/util';
import { rankAnswers } from '../rank';
import { buildRequest, isBuildError, solve } from '../solve';
import { getHistory, getSettings, pushHistory } from '../store';
import { buildLinks } from '../providers/links';
import type { Shell } from './shell';

export interface Solver {
  setQuery(q: string, pattern?: string, submit?: boolean): void;
  refreshHistory(): void;
  /** Re-read settings that affect the solver view (result order). */
  applySettings(): void;
}

/** Lengths the desktop slider offers after "Any". */
const LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
/** Wide screens get the two-column layout, always-open meaning, and search as you type. */
const desk = matchMedia('(min-width: 1024px)');

export function mountSolver(view: HTMLElement, shell: Shell): Solver {
  view.innerHTML = `
    <div class="searchbar">
      <div class="querybar" id="querybar">
      <span class="ctl-label desk-only" aria-hidden="true">Clue</span>
      <form class="search" id="form" autocomplete="off">
        <label class="field">
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
      <!-- Letters/pattern input, parked: hidden in the UI while the idea is
           reconsidered. The parser, ranking and highlighting all still work,
           so removing this attribute brings it back. -->
      <div class="constraints" hidden>
        <label class="pattern">
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1" y="1" width="4" height="4"/><rect x="7" y="1" width="4" height="4"/><rect x="1" y="7" width="4" height="4"/><rect x="7" y="7" width="4" height="4"/></svg>
          <input id="p" type="text" placeholder="Letters you have" aria-label="Letters you have, or a ? pattern" maxlength="30" autocapitalize="characters" autocomplete="off" spellcheck="false">
          <button type="button" class="clear" id="pclear" aria-label="Clear letters" hidden>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
          </button>
        </label>
        <span class="hint" id="phint"></span>
      </div>
      <!-- Desktop only: length and letters as separate controls beside the
           big clue input. Both feed the same request fields the parked
           pattern input above would. -->
      <div class="desk-controls">
        <label class="lenctl">
          <span class="ctl-head"><span class="ctl-label">Length</span><span class="lenval" id="lenval">Any length</span></span>
          <input id="len" type="range" min="0" max="${LENGTHS.length}" step="1" value="0" aria-valuetext="Any length">
          <span class="ticks" id="ticks" aria-hidden="true"><span class="on">Any</span>${LENGTHS.map((n) => `<span>${n}</span>`).join('')}</span>
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
    <div id="recent"></div>
    <div id="out"></div>`;

  const $ = <T extends HTMLElement>(id: string) => view.querySelector<T>(`#${id}`)!;
  const q = $<HTMLInputElement>('q'), p = $<HTMLInputElement>('p'), out = $('out'), form = $<HTMLFormElement>('form');
  const phint = $('phint'), formError = $('formError'), clearBtn = $('clear'), pclear = $<HTMLButtonElement>('pclear');
  const len = $<HTMLInputElement>('len'), tagin = $<HTMLInputElement>('tagin');
  const sections = { meaning: '', answers: '' };

  /** Desktop constraints: an exact length (null = any) and the letters already known, in any order. */
  let deskLength: number | null = null;
  let deskLetters = '';

  /**
   * Letters can change while a search is in flight. Results arriving for the
   * same fetch are re-ranked against the letters as they stand now, so a
   * letter typed mid-search is not lost when the result lands.
   */
  function restrain(req: SolveRequest, answers: Answer[]): { req: SolveRequest; answers: Answer[] } {
    const now = request();
    if (isBuildError(now) || now.query !== req.query || now.pattern !== req.pattern || now.length !== req.length) return { req, answers };
    return { req: now, answers: rankAnswers(answers, now) };
  }

  /** The request as the inputs stand, desktop constraints included. */
  function request(): ReturnType<typeof buildRequest> {
    const built = buildRequest(q.value, p.value);
    if (isBuildError(built)) return built;
    if (deskLength && !built.pattern) built.length = deskLength;
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
  /** Length segment selection. View-only, reset on each new search. */
  let lengthFilter: number | null = null;
  /** Spoiler mode: whether this search's answers have been tapped open. */
  let revealed = false;

  /**
   * Desktop shows the board face down while there is nothing on it, and the
   * first answers to land turn its tiles over. Set whenever the blank board
   * goes up; cleared once a result has flipped in.
   */
  let flipNext = false;

  function paint() {
    // Meaning first: collapsed, it is one line, so answers still start at the
    // top of the screen — and it never has to be scrolled past a long list to
    // be found. Spoiler mode builds on the same order.
    const body = sections.meaning + sections.answers;
    if (!body && desk.matches) flipNext = true;
    out.innerHTML = body || (desk.matches ? renderBlankMeaning() + renderBlankAnswers() : renderEmpty(getHistory().length === 0));
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
  let flipStarted = false;
  /** This search started from the blank board, so its answers turn over as they arrive. */
  let flipSearch = false;
  let flipUntil = 0;
  let flipTimer: number | undefined;
  function paintAnswers() {
    if (flipStarted) {
      flipStarted = false;
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
   * Hold the chosen length across a repaint, but drop it if the new answers
   * have nothing of that length — a filter matching nothing reads as a bug.
   */
  function keepLengthFilter(answers: Answer[]): number | null {
    if (lengthFilter !== null && !answers.some((a) => a.length === lengthFilter)) lengthFilter = null;
    return lengthFilter;
  }
  /** Whether this render should turn the tiles over; true once per blank board. */
  function takeFlip(): boolean {
    const f = flipNext;
    flipNext = false;
    if (f) flipStarted = flipSearch = true;
    return f;
  }
  /** Renders from the finished result when there is one, the partial otherwise. */
  function renderAnswersSection() {
    const hidden = getSettings().hideAnswers && !revealed;
    if (current) {
      const r = current;
      sections.answers = renderAnswers(r.answers, r.request, {
        fromCache: r.fromCache,
        error: r.errors.find((e) => e.provider === 'Datamuse'),
        lengthFilter: keepLengthFilter(r.answers),
        hidden,
        flip: takeFlip(),
      });
    } else if (live) {
      sections.answers = renderAnswers(live.answers, live.req, { lengthFilter: keepLengthFilter(live.answers), hidden, flip: takeFlip() });
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
    // The bottom dock is a phone affordance; the desktop layout keeps the input in its column.
    document.body.classList.toggle('search-bottom', getSettings().searchPosition === 'bottom' && !desk.matches);
    repaintAll();
  }
  /** Empty input means no results: drop them rather than leave a stale answer set. */
  function clearResults() {
    ctl?.abort();
    ctl = null;
    clearTimeout(liveTimer);
    clearTimeout(historyTimer);
    clearTimeout(flipTimer);
    flipUntil = 0;
    flipSearch = false;
    current = null;
    live = null;
    lengthFilter = deskLength;
    revealed = false;
    sections.meaning = '';
    sections.answers = '';
    formError.hidden = true;
    paint();
  }

  function refreshHistory() {
    $('recent').innerHTML = renderHistory(getHistory());
  }

  function updateHint() {
    const c = parsePattern(p.value);
    pclear.hidden = !p.value;
    phint.classList.toggle('err', Boolean(c.error));
    phint.innerHTML = c.error
      ? esc(c.error)
      : c.pattern
        ? `<b>${c.length}</b> letters, by position`
        : c.length
          ? `<b>${c.length}</b> letters long`
          : c.letters
            ? 'any order · use ? for positions'
            : '';
  }

  /** Letters changed: re-rank what we have instantly. Pattern/length changed: refetch. */
  function onConstraintInput() {
    updateHint();
    if (!current && live) {
      // Still loading: re-rank what has arrived; the finished result picks the letters up via restrain().
      live = restrain(live.req, live.answers);
      renderAnswersSection();
      paintAnswers();
    }
    if (!current) return;
    const built = request();
    if (isBuildError(built)) return;
    const sameFetch = built.query === current.request.query && built.pattern === current.request.pattern && built.length === current.request.length;
    clearTimeout(liveTimer);
    if (sameFetch) {
      current = { ...current, request: built, answers: rankAnswers(current.answers, built) };
      repaintAll();
    } else {
      liveTimer = window.setTimeout(() => run(true), desk.matches ? 250 : 500);
    }
  }

  /**
   * Searches fired by typing are provisional: "tid" on the way to "tide" is
   * not a search anyone made. They reach history only once the input has
   * rested on them; a submitted search goes in at once.
   */
  let historyTimer: number | undefined;

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
    lengthFilter = deskLength;
    revealed = false;
    // Typing over results already on screen keeps them until the new ones
    // land, rather than flashing skeletons on every pause.
    const keep = fromTyping && Boolean(current || live);
    flipSearch = false;
    current = null;
    live = null;
    meaningOpen = false;
    if (!keep) {
      sections.meaning = desk.matches ? renderBlankMeaning() : skeletonMeaning();
      sections.answers = desk.matches ? renderBlankAnswers() : skeletonAnswers();
      flipNext = desk.matches;
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
      pushHistory({ query: req.query, pattern: req.pattern, letters: req.letters, at: Date.now(), topAnswer: result.answers[0]?.answer });
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
  q.addEventListener('input', () => {
    clearBtn.hidden = !q.value;
    if (!q.value.trim()) { clearResults(); return; }
    // Desktop always searches as you type: the local sources answer instantly, and only the network calls wait out the pause.
    if ((getSettings().liveSearch || desk.matches) && navigator.onLine && q.value.trim().length >= 3) {
      clearTimeout(liveTimer);
      liveTimer = window.setTimeout(() => run(true), desk.matches ? 250 : 450);
    }
  });

  // ---- desktop constraints ----
  function setLength(n: number | null) {
    deskLength = n;
    len.value = String(n === null ? 0 : LENGTHS.indexOf(n) + 1);
    const label = n === null ? 'Any length' : `${n} letters`;
    $('lenval').textContent = label;
    len.setAttribute('aria-valuetext', label);
    $('ticks').querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i === Number(len.value)));
  }
  len.addEventListener('input', () => {
    setLength(LENGTHS[Number(len.value) - 1] ?? null);
    // Filter what is on screen now; onConstraintInput refetches for the new length after a pause.
    lengthFilter = deskLength;
    renderAnswersSection();
    paintAnswers();
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
    // The desktop controls vanish below the breakpoint; don't leave their constraints applied invisibly.
    if (!desk.matches && (deskLength || deskLetters)) {
      setLength(null);
      setLetters('');
      lengthFilter = null;
      onConstraintInput();
    }
    applySettings();
    if (!current && !live) paint();
  });
  clearBtn.addEventListener('click', () => {
    q.value = '';
    clearBtn.hidden = true;
    clearResults();
    q.focus();
  });
  pclear.addEventListener('click', () => { p.value = ''; onConstraintInput(); p.focus(); });
  p.addEventListener('input', onConstraintInput);
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); } });

  // tap = copy, hold = chain lookup
  let holdTimer: number | undefined, held = false;
  out.addEventListener('pointerdown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (!row) return;
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
    if (row) {
      if (held) return;
      navigator.clipboard?.writeText(row.dataset.answer!).then(
        () => shell.toast(`Copied ${row.dataset.answer}`),
        () => shell.toast(row.dataset.answer!),
      );
      return;
    }
    if (t.closest('[data-toggle-meaning]')) { toggleMeaning(); return; }
    if (t.closest('[data-reveal-answers]')) { revealed = true; renderAnswersSection(); withTransition(paintAnswers); return; }
    const len = t.closest<HTMLElement>('[data-len]');
    if (len) {
      const n = Number(len.dataset.len);
      lengthFilter = n === 0 || lengthFilter === n ? null : n;
      renderAnswersSection();
      withTransition(paintAnswers);
      return;
    }
    const eg = t.closest<HTMLElement>('[data-example]');
    if (eg) { setQuery(eg.dataset.example!, '', true); return; }
    const play = t.closest<HTMLElement>('[data-audio]');
    if (play) { new Audio(play.dataset.audio).play().catch(() => shell.toast("Couldn't play audio")); return; }
    if (t.closest('[data-expand]')) t.closest('.block')?.classList.toggle('expanded');
  });
  $('recent').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-q]');
    if (b) setQuery(b.dataset.q!, b.dataset.p ?? '', true);
  });

  function setQuery(query: string, pattern = '', submit = false) {
    q.value = query;
    clearBtn.hidden = !query;
    // History stores one constraint string; on desktop it lands in the controls that own each part.
    const c = parsePattern(pattern);
    if (desk.matches && !c.pattern) {
      p.value = '';
      setLength(c.length ?? null);
      setLetters(c.letters ?? '');
    } else {
      p.value = pattern;
    }
    updateHint();
    if (submit) run();
  }

  refreshHistory();
  updateHint();
  applySettings();
  paint();
  return { setQuery, refreshHistory, applySettings };
}
