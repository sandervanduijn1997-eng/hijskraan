import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type State = {
  outcome: string;
  tip: { x: number; y: number; z: number };
  hook: { x: number; y: number; z: number };
  attached: string | null;
  candidate: string | null;
  tasks: string[];
  sway: number;
  paused: boolean;
  time: number;
  ropeLength: number;
  loads: { id: string; x: number; y: number; z: number; status: string }[];
  support: string;
  slew: number;
  slewCenter: { x: number; z: number };
  zones: { id: string; x: number; y: number; z: number }[];
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const slewErr = (s: State) => wrap(Math.atan2(s.zones[0].z - s.slewCenter.z, s.zones[0].x - s.slewCenter.x) - s.slew);
const radiusErr = (s: State) => Math.hypot(s.zones[0].x - s.slewCenter.x, s.zones[0].z - s.slewCenter.z) - Math.hypot(s.tip.x - s.slewCenter.x, s.tip.z - s.slewCenter.z);

const state = (page: Page) => page.evaluate(() => (window as unknown as { __crane: { state(): unknown } }).__crane.state() as State);

async function holdUntil(page: Page, key: string, pred: (s: State) => boolean, timeoutMs = 30_000): Promise<State> {
  await page.keyboard.down(key);
  const t0 = Date.now();
  let s = await state(page);
  while (!pred(s) && Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(40);
    s = await state(page);
  }
  await page.keyboard.up(key);
  return s;
}

async function waitFor(page: Page, pred: (s: State) => boolean, timeoutMs = 30_000): Promise<State> {
  const t0 = Date.now();
  let s = await state(page);
  while (!pred(s) && Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(100);
    s = await state(page);
  }
  return s;
}

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebGL|Framebuffer|GPU/i.test(m.text())) errors.push(m.text());
  });
  await page.goto('/?render=off');
  await page.getByTestId('main-menu').waitFor();
});

test('3D-weergave: rendert een niet-lege scène zonder fouten', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.getByTestId('main-menu').waitFor();
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m12', 'normal'));
  await page.waitForTimeout(4000);
  const shot = await page.locator('#game canvas').screenshot();
  // een gerenderde 3D-scène heeft veel verschillende kleuren; een leeg/zwart canvas niet
  const distinct = new Set<number>();
  for (let i = 0; i < shot.length; i += 97) distinct.add(shot[i]);
  expect(distinct.size).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('start: hoofdmenu, canvas en geen consolefouten', async ({ page }) => {
  await expect(page.locator('#game canvas')).toHaveCount(1);
  await expect(page.getByTestId('menu-career')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('carrière → planning → missie 1 start met HUD', async ({ page }) => {
  await page.getByTestId('menu-career').click();
  await page.getByTestId('mission-m01').click();
  await expect(page.getByTestId('planning')).toBeVisible();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  const s = await state(page);
  expect(s.outcome).toBe('running');
  expect(errors).toEqual([]);
});

test('missie 1 met het toetsenbord voltooien en beloning ontvangen', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m01', 'practice'));
  await page.getByTestId('hud').waitFor();
  const money0 = await page.evaluate(() => (window as unknown as { __crane: { save(): { money: number } } }).__crane.save().money);
  // haak laten zakken tot aanslaan mogelijk is
  let s = await holdUntil(page, 'KeyQ', (st) => st.candidate === 'p1');
  expect(s.candidate).toBe('p1');
  await page.keyboard.press('KeyT');
  s = await waitFor(page, (st) => st.attached === 'p1', 3000);
  expect(s.attached).toBe('p1');
  // hijsen tot ruim boven de afzetting
  s = await holdUntil(page, 'KeyE', (st) => st.loads[0].y > 4.0);
  // zwenken naar het afzetvak: welke toets welke kant op draait volgt uit een korte tik
  const s0 = await state(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  const dPos = (await state(page)).slew > s0.slew;
  const err0 = slewErr(await state(page));
  const key = err0 > 0 === dPos ? 'KeyD' : 'KeyA';
  s = await holdUntil(page, key, (st) => Math.abs(slewErr(st)) < 0.12 || Math.sign(slewErr(st)) !== Math.sign(err0));
  // fijn bijstellen met Shift, zo nodig een paar keer heen en weer (zoals een speler doet)
  await page.keyboard.down('ShiftLeft');
  for (let n = 0; n < 8; n++) {
    await page.waitForTimeout(600);
    s = await state(page);
    const e = slewErr(s);
    if (Math.abs(e) < 0.012) break;
    const k = e > 0 === dPos ? 'KeyD' : 'KeyA';
    s = await holdUntil(page, k, (st) => Math.abs(slewErr(st)) < 0.008 || Math.sign(slewErr(st)) !== Math.sign(e), 8000);
  }
  await page.keyboard.up('ShiftLeft');
  // telescoop uit tot boven de zone
  s = await holdUntil(page, 'KeyR', (st) => radiusErr(st) < 0.6);
  await page.keyboard.down('ShiftLeft');
  s = await holdUntil(page, 'KeyR', (st) => radiusErr(st) < 0.05);
  await page.keyboard.up('ShiftLeft');
  // laten uitslingeren
  s = await waitFor(page, (st) => st.sway < 0.6, 40_000);
  // vieren tot de levering is geaccepteerd
  s = await holdUntil(page, 'KeyQ', (st) => st.loads[0].y < 1.5);
  await page.keyboard.down('ShiftLeft');
  s = await holdUntil(page, 'KeyQ', (st) => st.outcome !== 'running', 30_000);
  await page.keyboard.up('ShiftLeft');
  expect(s.outcome, JSON.stringify({ slewErr: slewErr(s), radiusErr: radiusErr(s), load: s.loads[0], zone: s.zones[0], tip: s.tip, warnings: (s as unknown as { warnings: string[] }).warnings })).toBe('success');
  await expect(page.getByTestId('result-success')).toBeVisible({ timeout: 10_000 });
  const money1 = await page.evaluate(() => (window as unknown as { __crane: { save(): { money: number } } }).__crane.save().money);
  expect(money1).toBeGreaterThan(money0);
  expect(errors).toEqual([]);
});

test('pauzeren terwijl de last slingert bevriest de simulatie', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m03', 'realistic'));
  await page.getByTestId('hud').waitFor();
  await holdUntil(page, 'KeyD', () => false, 1500);
  const a = await state(page);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const b = await state(page);
  await page.waitForTimeout(1500);
  const c = await state(page);
  expect(c.paused).toBe(true);
  expect(c.time).toBe(b.time);
  expect(c.hook).toEqual(b.hook);
  expect(a.time).toBeLessThanOrEqual(b.time);
  await page.getByTestId('btn-resume').click();
  await page.waitForTimeout(500);
  const d = await state(page);
  expect(d.time).toBeGreaterThan(c.time);
});

test('opnieuw beginnen tijdens een missie zet alles terug', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m01', 'normal'));
  await page.getByTestId('hud').waitFor();
  await holdUntil(page, 'KeyQ', () => false, 1500);
  const before = await state(page);
  expect(before.ropeLength).toBeGreaterThan(7.2);
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-restart').click();
  await page.waitForTimeout(400);
  const after = await state(page);
  expect(after.time).toBeLessThan(1);
  expect(after.ropeLength).toBeCloseTo(7, 0);
  expect(errors).toEqual([]);
});

test('venster vergroten en verkleinen', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m12', 'normal'));
  await page.getByTestId('hud').waitFor();
  for (const [w, h] of [[800, 600], [1920, 1080], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const size = await page.evaluate(() => ({ w: document.querySelector('#game canvas')!.clientWidth, h: document.querySelector('#game canvas')!.clientHeight }));
    expect(size.w).toBe(w);
    expect(size.h).toBe(h);
  }
  expect(errors).toEqual([]);
});

test('beschadigd savebestand maakt de game niet onbruikbaar', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('crane-operator-heavy-lift.save', '{kapot json'));
  await page.reload();
  await page.getByTestId('main-menu').waitFor();
  await expect(page.locator('.notice')).toContainText('beschadigd');
  const money = await page.evaluate(() => (window as unknown as { __crane: { save(): { money: number } } }).__crane.save().money);
  expect(money).toBe(2000);
});

test('stempels niet uitgezet: bediening met last is geblokkeerd tot de stempels staan', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __crane: { startMission(id: string, d: string): void } }).__crane.startMission('m05', 'normal'));
  await page.getByTestId('hud').waitFor();
  let s = await state(page);
  expect(s.support).toBe('tires');
  await page.keyboard.press('KeyO');
  await page.keyboard.press('KeyP');
  s = await waitFor(page, (st) => st.support === 'outriggers', 30_000);
  expect(s.support).toBe('outriggers');
  s = await waitFor(page, (st) => st.tasks[0] === 'done', 5000);
  expect(s.tasks[0]).toBe('done');
});
