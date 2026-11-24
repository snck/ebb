import './style.css';
import { App } from './game/app';

new App(document.getElementById('root')!);

// Offline / installable: cache the built game after the first load (no network needed afterwards).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
if (new URLSearchParams(location.search).has('fps')) (window as any).__debugFps = true;
