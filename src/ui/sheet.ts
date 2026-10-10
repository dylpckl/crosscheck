/**
 * The one sheet: settings on top, about and links below. Replaces the old
 * Settings and About views, so nothing here is more than a tap and a scroll away.
 */
import { clearCache, clearHistory, getSettings, saveSettings, type SearchPosition, type Theme } from '../store';
import { desk } from './layout';
import { AUTHOR_URL, COMMIT, DONATE_URL, REPO_URL, type Shell } from './shell';

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark-system', theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

const GITHUB_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.84c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>';
const SITE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>';
const COFFEE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>';

export function mountSheet(shell: Shell, onChange: () => void) {
  const view = shell.sheetBody;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getSettings().theme));

  function render() {
    const s = getSettings();
    view.innerHTML = `
      <h2 class="sheet-head">Settings</h2>
      <div class="setting"><div class="text"><div class="label">Theme</div><div class="sub">System follows your phone.</div></div>
        <div class="seg" role="group" aria-label="Theme">${(['system', 'light', 'dark'] as Theme[])
          .map((t) => `<button data-theme="${t}" aria-pressed="${s.theme === t}">${t[0]!.toUpperCase() + t.slice(1)}</button>`)
          .join('')}</div></div>
      <div class="setting mobile-only"><div class="text"><div class="label">Search box</div><div class="sub">${
        s.searchPosition === 'top' ? 'Under the app bar.' : 'Docked at the bottom, in thumb reach.'
      }</div></div>
        <div class="seg" role="group" aria-label="Search box position">${(['top', 'bottom'] as SearchPosition[])
          .map((p) => `<button data-pos="${p}" aria-pressed="${s.searchPosition === p}">${p === 'top' ? 'Top' : 'Bottom'}</button>`)
          .join('')}</div></div>
      <div class="setting"><div class="text"><div class="label">Hide answers</div><div class="sub">Read the meaning first; tap to reveal the answers.</div></div>
        <button class="switch" role="switch" aria-checked="${s.hideAnswers}" data-key="hideAnswers" aria-label="Hide answers until revealed"></button></div>
      <div class="setting"><div class="text"><div class="label">Recent searches</div><div class="sub">Stored only on this device.</div></div>
        <button class="btn danger" data-action="clearHistory">Clear</button></div>
      <div class="setting"><div class="text"><div class="label">Cached results</div><div class="sub">Lets past lookups work offline.</div></div>
        <button class="btn danger" data-action="clearCache">Clear</button></div>

      <div class="sheet-about">
        <div class="name">Crosscheck</div>
        <p>Answers from a bank of published clues, a crosswordese corpus and Datamuse. Definitions from the Free Dictionary API and Wiktionary. Summaries from Wikipedia.</p>
        <div class="chips">
          <a class="primary" href="${DONATE_URL}" target="_blank" rel="noopener">${COFFEE_ICON}Buy me a coffee</a>
          <a href="${REPO_URL}" target="_blank" rel="noopener">${GITHUB_ICON}GitHub</a>
          <a href="${AUTHOR_URL}" target="_blank" rel="noopener">${SITE_ICON}dylansmith.dev</a>
        </div>
        <div class="build">
          <a href="${REPO_URL}/commit/${COMMIT}" target="_blank" rel="noopener">Build ${COMMIT}</a>
          · <button type="button" class="linkish" data-action="diagnostics">Check data sources</button>
        </div>
      </div>`;
  }

  view.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.theme) { applyTheme(saveSettings({ theme: t.dataset.theme as Theme }).theme); render(); }
    else if (t.dataset.pos) { saveSettings({ searchPosition: t.dataset.pos as SearchPosition }); render(); onChange(); }
    else if (t.dataset.key === 'hideAnswers') { saveSettings({ hideAnswers: !getSettings().hideAnswers }); render(); onChange(); }
    else if (t.dataset.action === 'clearHistory') { clearHistory(); onChange(); shell.toast('Recent searches cleared'); }
    else if (t.dataset.action === 'clearCache') { clearCache(); shell.toast('Cached results cleared'); }
    else if (t.dataset.action === 'diagnostics') { shell.openSheet(false); shell.show('diagnostics'); }
  });

  desk.addEventListener('change', render);
  render();
}
