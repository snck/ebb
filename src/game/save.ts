import { Progress, newProgress } from '../sim/world';
import type { Settings } from './input';

export interface SaveData {
  v: 1;
  progress: Progress;
  settings: Settings;
  tut: { moved: boolean; attacked: boolean; dodged: boolean; healed: boolean; slowmoShown: boolean };
  deathsBy: Record<string, number>;
}

const KEY = 'ebb.save.v1';
export const defaultSettings = (): Settings => ({ scale: 1, swap: false, haptics: true, volume: 0.9, music: 0.6 });
export const freshSave = (): SaveData => ({
  v: 1, progress: newProgress(), settings: defaultSettings(),
  tut: { moved: false, attacked: false, dodged: false, healed: false, slowmoShown: false }, deathsBy: {},
});

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1) return null;
    const f = freshSave();
    return { ...f, ...d, progress: { ...f.progress, ...d.progress }, settings: { ...f.settings, ...d.settings }, tut: { ...f.tut, ...d.tut }, deathsBy: d.deathsBy ?? {} };
  } catch { return null; }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage full or private mode: play on */ }
}

export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
