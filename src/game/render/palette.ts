import type { EnvironmentId, TimeOfDay } from '../../missions/data/types';

export interface SkyPalette {
  top: string;
  bottom: string;
  haze: number;
  sun: number;
  light: number;
}

export const SKIES: Record<TimeOfDay, SkyPalette> = {
  morning: { top: '#6f9fcf', bottom: '#f3c99a', haze: 0xe8c8a6, sun: 0xffe2a8, light: 0.95 },
  day: { top: '#4f8fd6', bottom: '#cfe4f4', haze: 0xc9dbe8, sun: 0xfff6d5, light: 1.0 },
  dusk: { top: '#2f3f6e', bottom: '#f08a5d', haze: 0xd98a6a, sun: 0xffb36b, light: 0.8 },
  overcast: { top: '#7d8794', bottom: '#c3c9cf', haze: 0xb7bdc4, sun: 0xdde2e6, light: 0.85 },
  night: { top: '#0b1224', bottom: '#2b3550', haze: 0x343e58, sun: 0xb8c6ff, light: 0.55 },
};

export interface EnvPalette {
  label: string;
  far: number;
  mid: number;
  near: number;
  ground: number;
  groundTop: number;
  accent: number;
  /** Indoor (fabriekshal) — geen lucht maar een hal. */
  indoor: boolean;
  water: boolean;
}

export const ENVIRONMENTS: Record<EnvironmentId, EnvPalette> = {
  trainingYard: { label: 'Oefenterrein', far: 0x8fa6b8, mid: 0x6f7f8c, near: 0x55606a, ground: 0x5a5d61, groundTop: 0x77797c, accent: 0xf2b705, indoor: false, water: false },
  constructionSite: { label: 'Bouwplaats', far: 0x91a3b3, mid: 0x707b85, near: 0x5d5148, ground: 0x6b5a48, groundTop: 0x8a7458, accent: 0xf2b705, indoor: false, water: false },
  cityCenter: { label: 'Binnenstad', far: 0x8a9db0, mid: 0x6a7886, near: 0x4f5964, ground: 0x48494c, groundTop: 0x5f6064, accent: 0xe74c3c, indoor: false, water: false },
  highrise: { label: 'Hoogbouwproject', far: 0x8ea3b9, mid: 0x6b7c8e, near: 0x515d6a, ground: 0x5d564e, groundTop: 0x7a7064, accent: 0xf0c419, indoor: false, water: false },
  factory: { label: 'Fabriekshal', far: 0x3d434a, mid: 0x4a5058, near: 0x575e66, ground: 0x6d7378, groundTop: 0x868c91, accent: 0xf2b705, indoor: true, water: false },
  roughTerrain: { label: 'Ruw terrein', far: 0x7f9a8a, mid: 0x5f7a5c, near: 0x4d5f43, ground: 0x5b4a36, groundTop: 0x75603f, accent: 0xe9a21b, indoor: false, water: false },
  riverBridge: { label: 'Rivierkruising', far: 0x86a0a6, mid: 0x5d7b6a, near: 0x4b6450, ground: 0x6a604f, groundTop: 0x857862, accent: 0xf2b705, indoor: false, water: true },
  port: { label: 'Haven', far: 0x7d93a6, mid: 0x5a6a7a, near: 0x45525e, ground: 0x55595e, groundTop: 0x6f7378, accent: 0xd35400, indoor: false, water: true },
  industrialPlant: { label: 'Industrieterrein', far: 0x8796a3, mid: 0x67727c, near: 0x525a62, ground: 0x585a5c, groundTop: 0x707274, accent: 0xe67e22, indoor: false, water: false },
  windFarm: { label: 'Windpark', far: 0x93b0c2, mid: 0x6f9178, near: 0x587a5c, ground: 0x5d6b47, groundTop: 0x7a8a58, accent: 0xf4f6f7, indoor: false, water: false },
};

export const GROUND_COLORS: Record<string, number> = {
  asphalt: 0x4a4c50,
  concrete: 0x8c8f92,
  gravel: 0x7a7266,
  sand: 0xc2a46e,
  mud: 0x4f3d2a,
  grass: 0x5a7a3e,
  quay: 0x6a6e73,
  floor: 0x7d8388,
};
