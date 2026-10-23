import type { CounterweightOption, CraneConfig, CraneGameBalance, UpgradeId } from '../config/types';
import type { UpgradeEffects } from '../config/upgrades';
import { upgradeEffects } from '../config/upgrades';

/** Kraanconfiguratie met toegepaste upgrades — de enige bron voor runtime-waarden. */
export interface ResolvedCrane {
  cfg: CraneConfig;
  gb: CraneGameBalance;
  counterweights: CounterweightOption[];
  boomOptions: number[];
  jibOptions: number[];
  effects: UpgradeEffects;
  upgrades: UpgradeId[];
}

export function resolveCrane(cfg: CraneConfig, upgrades: readonly UpgradeId[] = []): ResolvedCrane {
  const installed = upgrades.filter((u) => cfg.upgrades.includes(u));
  const fx = upgradeEffects(installed);
  const gb: CraneGameBalance = { ...cfg.gameBalance };
  let boomOptions = gb.boomOptions ? [...gb.boomOptions] : [];
  if (fx.boomExtension) {
    if (cfg.kind === 'telescopic') gb.boomMax += 4;
    else if (cfg.kind === 'lattice' && boomOptions.length) {
      boomOptions = [...boomOptions, boomOptions[boomOptions.length - 1] + 12];
      gb.boomMax = boomOptions[boomOptions.length - 1];
    } else if (cfg.kind === 'knuckle' && gb.knuckleTeleMax) gb.knuckleTeleMax += 1.5;
  }
  gb.hoistSpeed *= fx.hoistSpeed;
  gb.slewSpeedDeg *= fx.slewSpeed;
  gb.trolleySpeed *= fx.trolleySpeed;
  gb.outriggerTime *= fx.setupFactor;
  gb.setupTime *= fx.setupFactor;
  gb.fuelRate *= fx.fuelFactor;
  const counterweights = [...gb.counterweights];
  if (fx.extraCounterweight && counterweights.length > 0 && !gb.anchored) {
    const last = counterweights[counterweights.length - 1];
    const extra = Math.round(last.massT * 1.25 * 10) / 10;
    counterweights.push({ label: `${extra} t (upgrade)`, massT: extra, radius: last.radius });
  }
  return {
    cfg,
    gb,
    counterweights,
    boomOptions,
    jibOptions: gb.jibOptions ? [...gb.jibOptions] : [0],
    effects: fx,
    upgrades: installed,
  };
}
