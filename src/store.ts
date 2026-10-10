import type { CacheEntry, HistoryEntry, SolveRequest, SolveResult } from './contract';

const HISTORY_KEY = 'clues.history.v1';
const CACHE_KEY = 'clues.cache.v1';
const SETTINGS_KEY = 'clues.settings.v1';
export const HISTORY_MAX = 50;
export const CACHE_MAX = 200;
export const CACHE_TTL_MS = 7 * 86400 * 1000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode: fine, we just don't persist */
  }
}

export function cacheKey(req: SolveRequest): string {
  return `${req.query.toLowerCase()}|${req.pattern ?? ''}|${req.length ?? ''}`;
}

// ---- history ----
export function getHistory(): HistoryEntry[] {
  return read<HistoryEntry[]>(HISTORY_KEY, []);
}
export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = getHistory().filter((h) => !(h.query === entry.query && (h.pattern ?? '') === (entry.pattern ?? '')));
  list.unshift(entry);
  list.length = Math.min(list.length, HISTORY_MAX);
  write(HISTORY_KEY, list);
  return list;
}
export function clearHistory(): void {
  write(HISTORY_KEY, []);
}

// ---- result cache (LRU by recency of write) ----
export function getCached(req: SolveRequest, { allowStale = false } = {}): SolveResult | null {
  const key = cacheKey(req);
  const entries = read<CacheEntry[]>(CACHE_KEY, []);
  const hit = entries.find((e) => e.key === key);
  if (!hit) return null;
  if (!allowStale && hit.expiresAt < Date.now()) return null;
  return { ...hit.result, fromCache: true };
}
export function putCached(req: SolveRequest, result: SolveResult): void {
  const key = cacheKey(req);
  const entries = read<CacheEntry[]>(CACHE_KEY, []).filter((e) => e.key !== key);
  entries.unshift({ key, result: { ...result, fromCache: false }, expiresAt: Date.now() + CACHE_TTL_MS });
  entries.length = Math.min(entries.length, CACHE_MAX);
  write(CACHE_KEY, entries);
}
export function clearCache(): void {
  write(CACHE_KEY, []);
}

// ---- settings ----
export type Theme = 'system' | 'light' | 'dark';
/**
 * Search as you type is not a setting: it is on everywhere. The local
 * sources make it cheap, and a toggle for it outlived its reason once phones
 * got the same layout as desktop. The search box sits at the top, no longer
 * a choice either. Old stored keys for both are ignored.
 */
export interface Settings {
  theme: Theme;
  /**
   * Spoiler mode: keep the answers behind a tap so a lookup can be read for
   * its meaning first. Off by default — answers are what most searches want.
   */
  hideAnswers: boolean;
}
export const DEFAULT_SETTINGS: Settings = { theme: 'system', hideAnswers: false };
export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}
export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write(SETTINGS_KEY, next);
  return next;
}
