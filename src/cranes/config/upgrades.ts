import type { CraneConfig, UpgradeId } from './types';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  /** Basisprijs; de werkelijke prijs schaalt met de aankoopprijs van de kraan. */
  basePrice: number;
  priceFactor: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  hoistSpeed: { id: 'hoistSpeed', name: 'Snellere hijslier', description: 'Hijs- en viersnelheid +20 %.', basePrice: 400, priceFactor: 0.06 },
  precisionControls: { id: 'precisionControls', name: 'Proportionele besturing', description: 'Zachtere aanloop en een fijnere precisiemodus (15 % i.p.v. 25 %).', basePrice: 350, priceFactor: 0.05 },
  counterweightPlus: { id: 'counterweightPlus', name: 'Extra contragewicht', description: 'Voegt een zwaardere contragewichtconfiguratie toe (+25 % van het maximum).', basePrice: 600, priceFactor: 0.08 },
  boomExtension: { id: 'boomExtension', name: 'Giekverlenging', description: 'Telescoop +4 m, of een extra vakwerksectie (+12 m).', basePrice: 700, priceFactor: 0.09 },
  stabilityMonitor: { id: 'stabilityMonitor', name: 'Stabiliteitsmonitor', description: 'Toont de kantelmarge en de capaciteit op de verwachte straal in de HUD.', basePrice: 300, priceFactor: 0.03 },
  efficientEngine: { id: 'efficientEngine', name: 'Zuinige motor', description: 'Brandstofverbruik −25 %.', basePrice: 350, priceFactor: 0.04 },
  fastSetup: { id: 'fastSetup', name: 'Snelle opstelling', description: 'Stempel-, opbouw- en montagetijd −40 %.', basePrice: 300, priceFactor: 0.04 },
  advancedWarnings: { id: 'advancedWarnings', name: 'Botsingsradar', description: 'Waarschuwt vooraf voor naderende obstakels en voorspelt de slingerrichting.', basePrice: 350, priceFactor: 0.03 },
  slewSpeed: { id: 'slewSpeed', name: 'Snellere zwenkaandrijving', description: 'Draaisnelheid +20 %.', basePrice: 300, priceFactor: 0.04 },
  trolleySpeed: { id: 'trolleySpeed', name: 'Snellere loopkat', description: 'Loopkatsnelheid +25 %.', basePrice: 300, priceFactor: 0.04 },
  groundMats: { id: 'groundMats', name: 'Kraanmatten', description: 'Grotere stempelplaten: ondergrondfactor +0,25 (max. 1,0).', basePrice: 450, priceFactor: 0.04 },
  antiSwayAssist: { id: 'antiSwayAssist', name: 'Slingerassistent', description: 'Ondersteunt de machinist met lichte extra slingerdemping. De fysica blijft actief.', basePrice: 500, priceFactor: 0.05 },
};

export function upgradePrice(crane: CraneConfig, id: UpgradeId): number {
  const u = UPGRADES[id];
  return Math.round((u.basePrice + crane.economy.buyPrice * u.priceFactor) / 50) * 50;
}

/** Afgeleide modifiers op basis van geïnstalleerde upgrades. */
export interface UpgradeEffects {
  hoistSpeed: number;
  slewSpeed: number;
  trolleySpeed: number;
  precisionFactor: number;
  rampFactor: number;
  extraCounterweight: boolean;
  boomExtension: boolean;
  stabilityMonitor: boolean;
  fuelFactor: number;
  setupFactor: number;
  advancedWarnings: boolean;
  groundBonus: number;
  extraSwayDamping: number;
}

export function upgradeEffects(installed: readonly UpgradeId[]): UpgradeEffects {
  const has = (id: UpgradeId) => installed.includes(id);
  return {
    hoistSpeed: has('hoistSpeed') ? 1.2 : 1,
    slewSpeed: has('slewSpeed') ? 1.2 : 1,
    trolleySpeed: has('trolleySpeed') ? 1.25 : 1,
    precisionFactor: has('precisionControls') ? 0.15 : 0.25,
    rampFactor: has('precisionControls') ? 0.7 : 1,
    extraCounterweight: has('counterweightPlus'),
    boomExtension: has('boomExtension'),
    stabilityMonitor: has('stabilityMonitor'),
    fuelFactor: has('efficientEngine') ? 0.75 : 1,
    setupFactor: has('fastSetup') ? 0.6 : 1,
    advancedWarnings: has('advancedWarnings'),
    groundBonus: has('groundMats') ? 0.25 : 0,
    extraSwayDamping: has('antiSwayAssist') ? 0.08 : 0,
  };
}
