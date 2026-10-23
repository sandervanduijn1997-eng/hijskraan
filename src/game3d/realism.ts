import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { EnvironmentId, TimeOfDay, Weather } from '../missions/data/types';

/**
 * Fotorealistische basis: gescande PBR-materialen en HDRI-luchten (CC0, Poly Haven), fysieke lak,
 * staal, rubber en glas. Texturen worden in wereldmaat geprojecteerd (box mapping), zodat geschaalde
 * dozen en balken nooit uitgerekte texturen krijgen.
 */

const BASE = `${import.meta.env.BASE_URL ?? '/'}assets/`;

export type SurfaceKind = 'asphalt' | 'gravel' | 'concrete' | 'mud' | 'grass' | 'blockwall' | 'corrugated' | 'steelplate';

const SURFACE_DIR: Record<SurfaceKind, { dir: string; meters: number }> = {
  asphalt: { dir: 'asphalt_02', meters: 3 },
  gravel: { dir: 'gravel_floor', meters: 2.5 },
  concrete: { dir: 'concrete_floor', meters: 2.5 },
  mud: { dir: 'brown_mud_dry', meters: 3 },
  grass: { dir: 'sparse_grass', meters: 3 },
  blockwall: { dir: 'concrete_block_wall', meters: 2.4 },
  corrugated: { dir: 'corrugated_iron_02', meters: 2 },
  steelplate: { dir: 'metal_plate', meters: 1.5 },
};

/** Ondergrond per omgeving (wat er onder de kraan ligt). */
export const GROUND_SURFACE: Record<EnvironmentId, SurfaceKind> = {
  trainingYard: 'asphalt',
  constructionSite: 'gravel',
  cityCenter: 'asphalt',
  highrise: 'gravel',
  factory: 'concrete',
  roughTerrain: 'mud',
  riverBridge: 'gravel',
  port: 'concrete',
  industrialPlant: 'asphalt',
  windFarm: 'grass',
};

/** Ondergrondtypes uit de fysica naar een gescand materiaal (met tint). */
export const GROUND_TYPE_SURFACE: Record<string, [SurfaceKind, number]> = {
  asphalt: ['asphalt', 0xffffff],
  concrete: ['concrete', 0xffffff],
  gravel: ['gravel', 0xffffff],
  sand: ['gravel', 0xe8cf9c],
  mud: ['mud', 0xb59a7e],
  grass: ['grass', 0xffffff],
  quay: ['concrete', 0xc8ccd0],
  floor: ['concrete', 0xd8dadc],
};

let enabled = true;
/** Zet gescande texturen uit (tests, lage kwaliteit). */
export function setRealism(on: boolean): void {
  enabled = on;
}
export const realismEnabled = (): boolean => enabled;

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(path: string, srgb: boolean): THREE.Texture {
  let t = texCache.get(path);
  if (!t) {
    t = loader.load(BASE + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(path, t);
  }
  return t;
}

/**
 * Laat alle textuurkaarten van een materiaal de wereldpositie gebruiken (box mapping) in plaats van
 * de UV's van de (geschaalde) eenheidsgeometrie. `meters` = afmeting van één textuurtegel.
 */
export function worldUV<T extends THREE.Material>(m: T, meters: number): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldScale = { value: 1 / meters };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWorldScale;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 wpos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            vec3 wn = abs(normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal));
          #else
            vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vec3 wn = abs(normalize(mat3(modelMatrix) * objectNormal));
          #endif
          vec2 wuv = wn.y > max(wn.x, wn.z) ? wpos.xz : (wn.x > wn.z ? wpos.zy : wpos.xy);
          wuv *= uWorldScale;
          #ifdef USE_MAP
            vMapUv = wuv;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = wuv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = wuv;
          #endif
          #ifdef USE_METALNESSMAP
            vMetalnessMapUv = wuv;
          #endif
          #ifdef USE_AOMAP
            vAoMapUv = wuv;
          #endif
        }`,
      );
  };
  m.customProgramCacheKey = () => `worldUV${meters}`;
  return m;
}

const surfCache = new Map<string, THREE.MeshStandardMaterial>();
/** Gescand oppervlak (asfalt, grind, beton, …), optioneel getint, met textuur op wereldschaal. */
export function surface(kind: SurfaceKind, tint = 0xffffff, opts: { metal?: number; normalScale?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${kind}|${tint}|${opts.metal ?? -1}|${opts.normalScale ?? 1}|${enabled}`;
  let m = surfCache.get(key);
  if (m) return m;
  const s = SURFACE_DIR[kind];
  if (!enabled) {
    m = new THREE.MeshStandardMaterial({ color: tint === 0xffffff ? 0x808080 : tint, roughness: 0.9, metalness: opts.metal ?? 0 });
  } else {
    const arm = tex(`pbr/${s.dir}/arm.jpg`, false);
    m = new THREE.MeshStandardMaterial({
      color: tint,
      map: tex(`pbr/${s.dir}/diff.jpg`, true),
      normalMap: tex(`pbr/${s.dir}/nor.jpg`, false),
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      aoMap: arm,
      aoMapIntensity: 0.8,
      roughnessMap: arm,
      metalnessMap: opts.metal !== undefined ? arm : null,
      roughness: 1,
      metalness: opts.metal ?? 0,
    });
    worldUV(m, s.meters);
  }
  surfCache.set(key, m);
  return m;
}

const physCache = new Map<string, THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial>();
/** Kraanlak: gekleurde basis met blanke laklaag en lichte slijtage via de staalplaattextuur. */
export function paint(color: number, opts: { gloss?: number; worn?: boolean } = {}): THREE.MeshPhysicalMaterial {
  const key = `paint|${color}|${opts.gloss ?? 0.6}|${opts.worn ?? true}|${enabled}`;
  let m = physCache.get(key) as THREE.MeshPhysicalMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.42,
    metalness: 0.15,
    clearcoat: opts.gloss ?? 0.6,
    clearcoatRoughness: 0.25,
  });
  if (enabled && (opts.worn ?? true)) {
    // fijne oneffenheden van plaatwerk, plus vuil en slijtage in de lak (lichte vlekken en strepen)
    m.normalMap = tex('pbr/metal_plate/nor.jpg', false);
    m.normalScale = new THREE.Vector2(0.25, 0.25);
    m.map = grimeTexture();
    m.roughnessMap = grimeRoughness();
    m.roughness = 1;
    worldUV(m, 2);
  }
  physCache.set(key, m);
  return m;
}

const simple = (key: string, make: () => THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial) => {
  let m = physCache.get(key);
  if (!m) {
    m = make();
    physCache.set(key, m);
  }
  return m;
};

/** Blank of gegalvaniseerd staal (cilinderstangen, kabelschijven, vijzels). */
export const steel = (color = 0xb9bfc6, rough = 0.3): THREE.MeshStandardMaterial =>
  simple(`steel|${color}|${rough}`, () => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough }));

/** Zwart rubber (banden, stootranden). */
export const rubber = (): THREE.MeshStandardMaterial => simple('rubber', () => new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.92, metalness: 0 }));

/** Getint ruitglas dat de lucht weerspiegelt. */
export const glass = (night = false): THREE.MeshPhysicalMaterial =>
  simple(`glass|${night}`, () => new THREE.MeshPhysicalMaterial({ color: 0x233038, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.9, emissive: night ? 0x3a2f1a : 0, emissiveIntensity: night ? 0.6 : 0 })) as THREE.MeshPhysicalMaterial;

/** Zwaar gietijzer/ballast (contragewicht), mat met plaatstructuur. */
export const ballast = (): THREE.MeshStandardMaterial => surface('steelplate', 0x5a5e63, { metal: 0.6, normalScale: 0.6 });

// ------------------------------------------------------------------ lucht en licht

export interface SkySetup {
  file: string;
  /** Sterkte van de HDRI als achtergrond en als omgevingslicht. */
  background: number;
  environment: number;
  /** Zonlicht (richtingslicht) bij deze lucht. */
  sun: number;
  sunColor: number;
  exposure: number;
}

export const SKY_FOR: Record<TimeOfDay, SkySetup> = {
  morning: { file: 'morning', background: 1, environment: 0.9, sun: 2.6, sunColor: 0xffe2bd, exposure: 0.85 },
  day: { file: 'day', background: 1, environment: 1, sun: 3.2, sunColor: 0xfff4e0, exposure: 0.8 },
  dusk: { file: 'dusk', background: 1, environment: 0.9, sun: 1.8, sunColor: 0xffb27a, exposure: 1.0 },
  overcast: { file: 'overcast', background: 1, environment: 1.1, sun: 0.5, sunColor: 0xe8eef5, exposure: 0.95 },
  night: { file: 'night', background: 1.4, environment: 1.6, sun: 0.15, sunColor: 0x9fb4ff, exposure: 1.5 },
};

export function skyFor(t: TimeOfDay, weather: Weather): SkySetup {
  if (weather === 'fog' || weather === 'rain') return { ...SKY_FOR.overcast, environment: 1, background: 0.9 };
  return SKY_FOR[t];
}

export interface LoadedSky {
  background: THREE.Texture;
  environment: THREE.Texture;
  /** Richting naar de zon (eenheidsvector) uit de helderste pixel van de HDRI. */
  sunDir: THREE.Vector3;
  /** Gemiddelde horizonkleur (voor de mist). */
  horizon: THREE.Color;
}

const skyCache = new Map<string, Promise<LoadedSky>>();

/** Laad een HDRI-lucht en maak er een omgevingslicht (PMREM) van. */
export function loadSky(renderer: THREE.WebGLRenderer, file: string): Promise<LoadedSky> {
  let p = skyCache.get(file);
  if (p) return p;
  p = new Promise<LoadedSky>((resolve, reject) => {
    const l = new RGBELoader();
    l.setDataType(THREE.FloatType);
    l.load(
      `${BASE}sky/${file}.hdr`,
      (t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        const img = t.image as unknown as { data: Float32Array; width: number; height: number };
        const { sunDir, horizon } = analyseSky(img.data, img.width, img.height);
        const pm = new THREE.PMREMGenerator(renderer);
        const env = pm.fromEquirectangular(t).texture;
        pm.dispose();
        resolve({ background: t, environment: env, sunDir, horizon });
      },
      undefined,
      reject,
    );
  });
  skyCache.set(file, p);
  return p;
}

/** Zoek de zon (helderste pixel) en de gemiddelde horizonkleur in een equirectangulaire HDR-afbeelding. */
export function analyseSky(data: Float32Array, w: number, h: number): { sunDir: THREE.Vector3; horizon: THREE.Color } {
  const ch = data.length / (w * h);
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (lum > best) {
        best = lum;
        bx = x;
        by = y;
      }
    }
  }
  // equirectangulair: u → lengtegraad, v → breedtegraad (three.js-conventie)
  const phi = (bx / w) * Math.PI * 2;
  const theta = (by / h) * Math.PI;
  const sunDir = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)).normalize();
  if (sunDir.y < 0.08) sunDir.y = 0.08;
  sunDir.normalize();
  const horizon = new THREE.Color(0, 0, 0);
  const row = Math.floor(h * 0.48);
  let n = 0;
  for (let x = 0; x < w; x += 4) {
    const i = (row * w + x) * ch;
    horizon.r += data[i];
    horizon.g += data[i + 1];
    horizon.b += data[i + 2];
    n++;
  }
  horizon.multiplyScalar(1 / n);
  const m = Math.max(horizon.r, horizon.g, horizon.b, 1e-6);
  // genormaliseerd naar een weergeefbare kleur (de mist volgt de tint, de belichting regelt de helderheid)
  horizon.multiplyScalar(0.85 / m);
  return { sunDir, horizon };
}

// ------------------------------------------------------------------ gevels

export type FacadeKind = 'office' | 'concrete' | 'brick' | 'industrial';

const FACADE: Record<FacadeKind, { wall: [number, number, number]; win: [number, number, number]; winW: number; winH: number; bay: number; floor: number }> = {
  office: { wall: [128, 134, 140], win: [38, 52, 64], winW: 0.86, winH: 0.72, bay: 3, floor: 3.4 },
  concrete: { wall: [176, 172, 164], win: [44, 54, 62], winW: 0.5, winH: 0.5, bay: 3, floor: 3 },
  brick: { wall: [142, 78, 58], win: [40, 48, 56], winW: 0.42, winH: 0.55, bay: 2.8, floor: 3 },
  industrial: { wall: [150, 156, 160], win: [60, 72, 82], winW: 0.9, winH: 0.18, bay: 6, floor: 6 },
};

const facadeCache = new Map<string, THREE.MeshStandardMaterial>();
/**
 * Gevel met ramen: kleur-, ruwheids- en lichtkaart uit één procedureel raster (4 × 4 traveeën per tegel),
 * zodat ramen de HDRI-lucht spiegelen en muren mat blijven. 's Nachts brandt een deel van de ramen.
 */
export function facade(kind: FacadeKind, night: boolean, seed = 1): THREE.MeshStandardMaterial {
  const key = `${kind}|${night}|${seed % 4}|${enabled}`;
  let m = facadeCache.get(key);
  if (m) return m;
  const f = FACADE[kind];
  if (!enabled) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(`rgb(${f.wall.join(',')})`), roughness: 0.85 });
    facadeCache.set(key, m);
    return m;
  }
  const N = 512;
  const cells = 4;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    return [c, c.getContext('2d')!] as const;
  };
  const [cd, gd] = mk();
  const [cr, gr] = mk();
  const [ce, ge] = mk();
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  // muur met lichte vlekken
  gd.fillStyle = `rgb(${f.wall.join(',')})`;
  gd.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {
    const v = (rnd() - 0.5) * 18;
    gd.fillStyle = `rgba(${f.wall.map((c) => Math.max(0, Math.min(255, c + v))).join(',')},0.35)`;
    gd.fillRect(rnd() * N, rnd() * N, 4 + rnd() * 30, 4 + rnd() * 30);
  }
  gr.fillStyle = 'rgb(225,225,225)';
  gr.fillRect(0, 0, N, N);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, N, N);
  const cw = N / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const ww = cw * f.winW;
      const wh = cw * f.winH;
      const x0 = x * cw + (cw - ww) / 2;
      const y0 = y * cw + (cw - wh) * 0.4;
      const tint = (rnd() - 0.5) * 16;
      const g = gd.createLinearGradient(0, y0, 0, y0 + wh);
      g.addColorStop(0, `rgb(${f.win.map((c) => c + 30 + tint).join(',')})`);
      g.addColorStop(1, `rgb(${f.win.map((c) => c + tint).join(',')})`);
      gd.fillStyle = g;
      gd.fillRect(x0, y0, ww, wh);
      // kozijn
      gd.strokeStyle = 'rgba(30,32,34,0.9)';
      gd.lineWidth = 3;
      gd.strokeRect(x0, y0, ww, wh);
      gr.fillStyle = 'rgb(18,18,18)';
      gr.fillRect(x0, y0, ww, wh);
      if (night && rnd() < 0.45) {
        ge.fillStyle = `rgb(${200 + rnd() * 55},${150 + rnd() * 60},${80 + rnd() * 50})`;
        ge.fillRect(x0 + 2, y0 + 2, ww - 4, wh - 4);
      }
    }
  }
  // vloerranden
  gd.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < cells; y++) gd.fillRect(0, y * cw + cw - 4, N, 4);
  const T = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  m = new THREE.MeshStandardMaterial({
    map: T(cd, true),
    roughnessMap: T(cr, false),
    roughness: 1,
    metalness: 0.05,
    emissiveMap: night ? T(ce, true) : null,
    emissive: night ? 0xffffff : 0x000000,
    emissiveIntensity: night ? 1.2 : 0,
  });
  worldUV(m, f.bay * cells);
  facadeCache.set(key, m);
  return m;
}

let grimeTex: THREE.Texture | null = null;
let grimeRough: THREE.Texture | null = null;
/** Bijna witte vuilkaart (vermenigvuldigt de lakkleur): vlekken, druipstrepen en randvuil. */
function grimeCanvas(rough: boolean): HTMLCanvasElement {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = rough ? 'rgb(105,105,105)' : 'rgb(246,244,240)';
  g.fillRect(0, 0, N, N);
  let r = 12345;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 260; i++) {
    const a = rough ? 0.08 : 0.025 + rnd() * 0.035;
    g.fillStyle = rough ? `rgba(170,170,170,${a})` : `rgba(${90 + rnd() * 40},${80 + rnd() * 30},${60 + rnd() * 30},${a})`;
    g.beginPath();
    g.ellipse(rnd() * N, rnd() * N, 2 + rnd() * 18, 2 + rnd() * 10, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // druipstrepen
  for (let i = 0; i < 70; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const h = 30 + rnd() * 160;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, rough ? 'rgba(180,180,180,0.1)' : 'rgba(80,70,55,0.07)');
    grd.addColorStop(1, 'rgba(80,70,55,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, 1 + rnd() * 3, h);
  }
  return c;
}
function grimeTexture(): THREE.Texture {
  if (!grimeTex) {
    grimeTex = new THREE.CanvasTexture(grimeCanvas(false));
    grimeTex.wrapS = grimeTex.wrapT = THREE.RepeatWrapping;
    grimeTex.colorSpace = THREE.SRGBColorSpace;
    grimeTex.anisotropy = 8;
  }
  return grimeTex;
}
function grimeRoughness(): THREE.Texture {
  if (!grimeRough) {
    grimeRough = new THREE.CanvasTexture(grimeCanvas(true));
    grimeRough.wrapS = grimeRough.wrapT = THREE.RepeatWrapping;
  }
  return grimeRough;
}
