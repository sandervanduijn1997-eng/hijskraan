import Phaser from 'phaser';
import './ui/styles.css';
import { WorldScene } from './game/scenes/WorldScene';
import { browserStorage } from './save/saveSystem';
import { App } from './ui/app';

/**
 * Opstart: Phaser rendert de wereld (canvas/WebGL), de DOM-laag (#ui) toont HUD en menu's.
 * Gameplay, fysica, rendering, UI, audio, data en opslag zijn gescheiden modules.
 *
 * Renderer: WebGL waar mogelijk. Faalt WebGL bij het opstarten (sommige GPU's/virtuele omgevingen),
 * dan start de game automatisch opnieuw met de Canvas-renderer. Forceren kan met ?renderer=canvas.
 */
const RENDERER_KEY = 'crane-operator-heavy-lift.renderer';

function preferredRenderer(): number {
  const q = new URLSearchParams(location.search).get('renderer');
  if (q === 'canvas') return Phaser.CANVAS;
  if (q === 'webgl') return Phaser.WEBGL;
  try {
    if (localStorage.getItem(RENDERER_KEY) === 'canvas') return Phaser.CANVAS;
  } catch {
    /* opslag niet beschikbaar */
  }
  return Phaser.AUTO;
}

function boot(type: number): void {
  let started = false;
  const container = document.getElementById('game')!;
  container.innerHTML = '';
  const onError = (e: ErrorEvent) => {
    if (started || type === Phaser.CANVAS) return;
    if (/framebuffer|webgl|shader/i.test(String(e.message))) {
      e.preventDefault();
      window.removeEventListener('error', onError);
      try {
        localStorage.setItem(RENDERER_KEY, 'canvas');
      } catch {
        /* negeren */
      }
      try {
        game.destroy(true);
      } catch {
        /* negeren */
      }
      boot(Phaser.CANVAS);
    }
  };
  window.addEventListener('error', onError);
  const game = new Phaser.Game({
    type,
    parent: 'game',
    transparent: true,
    antialias: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    fps: { target: 60, smoothStep: true },
    input: { keyboard: false, gamepad: false },
    render: { powerPreference: 'high-performance' },
    scene: [],
    banner: false,
  });
  game.events.once('ready', () => {
    started = true;
    game.scene.add('world', WorldScene, false);
    window.removeEventListener('error', onError);
    const app = new App(game, browserStorage());
    (window as unknown as { __crane: unknown }).__crane = { ...app.debugApi(), renderer: game.renderer.type === Phaser.CANVAS ? 'canvas' : 'webgl' };
    app.startDemo();
    app.showMainMenu();
    if (game.renderer.type === Phaser.WEBGL && !new URLSearchParams(location.search).has('renderer')) watchPerformance();
  });
}

/** Valt WebGL zonder hardwareversnelling erg traag uit, schakel dan eenmalig over op Canvas. */
function watchPerformance(): void {
  let frames = 0;
  const start = performance.now();
  const tick = () => {
    frames++;
    const el = performance.now() - start;
    if (el < 3000) {
      requestAnimationFrame(tick);
      return;
    }
    if (frames / (el / 1000) < 20 && document.visibilityState === 'visible') {
      try {
        localStorage.setItem(RENDERER_KEY, 'canvas');
        location.reload();
      } catch {
        /* geen opslag: blijf op WebGL */
      }
    }
  };
  requestAnimationFrame(tick);
}

boot(preferredRenderer());

// Voorkom dat de pagina scrolt met spatie/pijltjes.
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code) && (e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault();
});
