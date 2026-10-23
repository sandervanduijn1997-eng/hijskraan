import './ui/styles.css';
import { Host3D, webglAvailable } from './game3d/host';
import { browserStorage, loadGame } from './save/saveSystem';
import { App } from './ui/app';

/**
 * Opstart: Three.js rendert de 3D low-poly wereld (WebGL), de DOM-laag (#ui) toont HUD en menu's.
 * Gameplay, fysica, rendering, UI, audio, data en opslag zijn gescheiden modules.
 */
const container = document.getElementById('game')!;
if (!webglAvailable()) {
  container.innerHTML = '<div style="padding:2em;color:#fff;font-family:sans-serif">Deze game vereist WebGL. Schakel hardwareversnelling in of gebruik een recente browser.</div>';
} else {
  const storage = browserStorage();
  const host = new Host3D(container, loadGame(storage).data.settings.graphics);
  const app = new App(host, storage);
  (window as unknown as { __crane: unknown }).__crane = { ...app.debugApi(), renderer: 'webgl3d', quality: () => host.quality, fps: () => Math.round(host.fps), res: () => host.res, host };
  app.startDemo();
  app.showMainMenu();
}

// Voorkom dat de pagina scrolt met spatie/pijltjes.
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code) && (e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault();
});
