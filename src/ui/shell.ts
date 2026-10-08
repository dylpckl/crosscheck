/**
 * App bar plus a bottom sheet. There is no navigation: the solver is the app,
 * and settings and about live together in the sheet. Diagnostics is the one
 * separate view, reached from a link inside the sheet.
 */
export type ViewId = 'solver' | 'diagnostics';

export const DONATE_URL = 'https://paypal.me/askdyl';
export const REPO_URL = 'https://github.com/dylpckl/crosscheck';
export const AUTHOR_URL = 'https://www.dylansmith.dev';
export const COMMIT = __APP_COMMIT__;

export interface Shell {
  root: HTMLElement;
  views: Record<ViewId, HTMLElement>;
  /** Content container inside the sheet; filled by mountSheet. */
  sheetBody: HTMLElement;
  show(id: ViewId): void;
  openSheet(open: boolean): void;
  toast(msg: string, action?: { label: string; onClick: () => void }): void;
}

const COG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.6 1.6 0 0 0 15 19.4a1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.09A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.09A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.51 1z"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

export function mountShell(app: HTMLElement): Shell {
  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="backBtn" aria-label="Back to solver" hidden>${BACK}</button>
      <h1 id="title">Crosscheck</h1>
      <button class="iconbtn tint" id="cogBtn" aria-label="Settings and about" aria-controls="sheet" aria-expanded="false">${COG}</button>
    </header>
    <main class="view" id="view-solver"></main>
    <main class="view" id="view-diagnostics" hidden></main>
    <div class="scrim" id="scrim"></div>
    <section class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Settings and about" hidden>
      <div class="sheet-top" id="sheetTop">
        <button class="grab" id="grab" aria-label="Close" tabindex="-1"><i></i></button>
        <button class="sheet-x" id="sheetX" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet-body" id="sheetBody"></div>
    </section>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`;

  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const scrim = $('scrim'), sheet = $('sheet'), cogBtn = $<HTMLButtonElement>('cogBtn'), backBtn = $<HTMLButtonElement>('backBtn');
  const views: Record<ViewId, HTMLElement> = { solver: $('view-solver'), diagnostics: $('view-diagnostics') };

  function openSheet(open: boolean) {
    // `hidden` keeps it out of the tab order while closed; the class animates it.
    if (open) sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.toggle('open', open));
    scrim.classList.toggle('open', open);
    cogBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('locked', open);
    if (open) sheet.querySelector<HTMLElement>('button, a')?.focus();
    else {
      cogBtn.focus();
      setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 260);
    }
  }

  function show(id: ViewId) {
    views.solver.hidden = id !== 'solver';
    views.diagnostics.hidden = id !== 'diagnostics';
    backBtn.hidden = id === 'solver';
    cogBtn.hidden = id !== 'solver';
    $('title').textContent = id === 'solver' ? 'Crosscheck' : 'API status';
    const want = id === 'solver' ? location.pathname + location.search : '#diagnostics';
    if (id === 'solver' ? location.hash : location.hash !== '#diagnostics') history.replaceState(null, '', want);
    window.scrollTo({ top: 0 });
    views[id].dispatchEvent(new CustomEvent('view:show'));
  }

  cogBtn.addEventListener('click', () => openSheet(!sheet.classList.contains('open')));
  backBtn.addEventListener('click', () => show('solver'));
  scrim.addEventListener('click', () => openSheet(false));
  $('sheetX').addEventListener('click', () => openSheet(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) openSheet(false);
  });

  // Drag the handle down to dismiss. A short flick counts as much as a long
  // pull, so the gesture works without committing to a full swipe.
  const DISMISS_PX = 90, FLICK_PX = 30, FLICK_MS = 260;
  const top = $('sheetTop');
  let dragging = false, startY = 0, startAt = 0, dy = 0;

  top.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startAt = performance.now(); dy = 0;
    sheet.style.transition = 'none';
    top.setPointerCapture(e.pointerId);
  });
  top.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / 400));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    scrim.style.opacity = '';
    const flick = dy > FLICK_PX && performance.now() - startAt < FLICK_MS;
    if (dy > DISMISS_PX || flick) openSheet(false);
    else if (dy <= 5) openSheet(false); // a tap on the handle still closes
  };
  top.addEventListener('pointerup', endDrag);
  top.addEventListener('pointercancel', endDrag);

  let toastTimer: number | undefined;
  const toastEl = $('toast');

  return {
    root: app,
    views,
    sheetBody: $('sheetBody'),
    show,
    openSheet,
    toast(msg, action) {
      toastEl.innerHTML = '';
      toastEl.append(msg);
      toastEl.classList.toggle('action', Boolean(action));
      if (action) {
        const b = document.createElement('button');
        b.textContent = action.label;
        b.addEventListener('click', () => { action.onClick(); toastEl.classList.remove('show'); });
        toastEl.append(b);
      }
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), action ? 8000 : 1600);
    },
  };
}
