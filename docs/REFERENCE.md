# Referentie-export

Fase 0 van [UNREAL_PLAN.md](UNREAL_PLAN.md): de TypeScript-versie legt vast hoe de game zich gedraagt, zodat de C++-port in Unreal daartegen getest kan worden.

```bash
npm run export:reference                     # alles (enkele minuten)
npm run export:reference -- data,units,career # zonder missies (seconden)
npm run export:reference -- missions m01,m05 # alleen deze missies
```

De uitvoer staat in `reference/` en wordt niet gecommit, behalve `reference/manifest.json`. Dat manifest bevat een hash van de broncode (`sourceHash`) en per bestand een hash van de JSON-inhoud. Twee exports van dezelfde code geven hetzelfde manifest; verandert het manifest zonder codewijziging, dan is de simulatie niet meer deterministisch.

## Getallen

- Doubles staan als kortste exacte decimale weergave in JSON (zoals `JSON.stringify`); een correcte C++-parser leest ze bit voor bit terug.
- `"Infinity"`, `"-Infinity"` en `"NaN"` staan als string.
- Velden die in TypeScript `undefined` zijn, ontbreken.
- `.json.gz` is gewone gzip; de hash in het manifest is over de uitgepakte JSON.

## Bestanden

### `data/` — speldata

| Bestand | Inhoud |
|---|---|
| `cranes.json` | `CRANES`: alle kraanconfiguraties |
| `upgrades.json` | `UPGRADES` |
| `loads.json` | `LOADS` |
| `missions.json` | `chapters` en `missions`, ná `spreadAround` en `withStory` (precies wat de game speelt) |
| `challenges.json` | per uitdaging de definitie en de gegenereerde missie. De beoordeling (`rate`) is code per `kind`; uitkomsten staan in de missiesporen |
| `difficulties.json`, `economy.json` | moeilijkheidsprofielen, offertes en vaste bedrijfswaarden |
| `i18n.json` | `nlKeys` (alle bronteksten), `en` en `de` |

### `units/` — functietabellen en fysicascenario's

Hiermee test je de port per module, lang voordat de hele simulatie draait.

| Bestand | Inhoud | Vergelijken |
|---|---|---|
| `cranes.json.gz` | per kraan: `resolveCrane` (zonder en met alle upgrades), 64 steekproefstanden met `computeGeometry`, capaciteit, stabiliteitsmassa's, LMI, doorbuiging; lastdiagrammen per contragewicht en ondersteuning met opzoekingen; `solveBoomIK` voor telescoopkranen | relatief 1e-9 |
| `stability.json` | `computeStability`, `tippingDistance`, `tippingLoadT`, `padLoadsT`, `allowedPressure`, `bearingArea` | relatief 1e-9 |
| `powertrain.json` | hydrauliekvraag, pomp, toerental, drukken | relatief 1e-9 |
| `wind.json` | `sampleWind` voor elke windinstelling uit de missies, 60 s | relatief 1e-9 |
| `physics-scenarios.json.gz` | 8 korte scenario's met `PhysicsWorld`: per stap positie, quaternion, snelheden, kabelkracht | zie hieronder |
| `career.json.gz` | 400 willekeurige savebestanden met missie, kraan, score, offerte en afloop → `computePayout`, `applyMissionResult`, `settleJob`/`applySettlement`, offertekansen, kopen/upgraden/repareren (met het savebestand ná elke mutatie), ontgrendelingen, `nextMission`, `levelFor`; `upgradePrice`, `formatMoney`; 200 beoordelingen (`rate`) per uitdaging | exact |

Alle steekproeven komen uit een vaste pseudo-random reeks; een nieuwe export trekt dezelfde waarden.

De fysicascenario's staan per stap (1/60 s, 8 substappen). Vrij hangende scenario's (`pendulum-3d`, `torsion`, `eccentric-hang`, `lift-off`) moeten tot het einde binnen 1e-6 m blijven. Scenario's met veel contact (`ledge-tip`, `corner-slide`, `drop`) zijn gevoeliger; daar telt de eindtoestand binnen enkele centimeters.

### `missions/` — missiesporen

Eén bestand per run: `normal/<missie>` voor alle missies, `realistic/<missie>` voor m01, m05 en m09, `challenge/<uitdaging>`.

```
options        kraan, contragewicht, giek- en jib-optie (de missie zelf staat in data/)
recording      steps; inputs als [stap, ...inputKeys] (alleen bij wijziging); actions (aanslaan, LMI, matten, stempels)
checkpoints    volledige toestand elke 60 stappen, plus begin en einde
final          outcome, failReason, score, metrics, challengeRate
```

De C++-kant maakt een simulatie met dezelfde opties, voert per stap eerst de `actions` met die stap uit en dan de invoer die op dat moment geldt (zoals `replayStep`), en vergelijkt bij elk controlepunt.

De export speelt elke opname zelf ook opnieuw af in een verse `Simulation` en stopt als de controlepunten niet exact gelijk zijn. Elk spoor is dus aantoonbaar reproduceerbaar uit opname en opties.

**Hoe streng vergelijken.** Over een hele missie lopen minieme verschillen (een andere implementatie van `sin` of `cos`) op door slingeren en contacten. Daarom:

1. De eerste 10 s strikt (relatief 1e-6).
2. Daarna drift rapporteren: hoe ver liggen haak en lasten uit elkaar.
3. Eindoordeel op de afloop: zelfde `outcome`, zelfde aantal sterren, lasten op dezelfde plek binnen de tolerantie van hun zone.

Wil je bit voor bit gelijk blijven, gebruik dan in C++ dezelfde wiskundebibliotheek als V8 (fdlibm-afgeleid) in plaats van de MSVC-CRT. De C++-port doet dat en is nu op alle 82 sporen bit voor bit gelijk.

Eén uitzondering: `Math.pow` is in V8 géén fdlibm maar de pow van het platform-CRT, en die verschilt per OS en zelfs per CRT-variant in het laatste bit. Gebruik in de simulatie daarom `detPow` uit `src/utils/math.ts` (`exp(y·ln x)`, beide fdlibm) en nooit `Math.pow` of `**`.

## Bekende afwijkingen in de referentie

- **`ledge-tip`**: een last van 800 kg die over een rand hangt, krijgt binnen 0,3 s ca. 3,8 m/s zijwaarts in x én z, terwijl hij nog boven zijn starthoogte is. Dat is energie uit het contactmodel, geen fysica. Eerst trouw porten (zodat de vergelijking klopt), daarna in beide versies oplossen.
- **Niet elke run slaagt.** Van de 82 runs slagen er 72 (export van 2 november 2026). De bot speelt zonder kraanmatten en met beperkte precisie:

  | Run | Afloop |
  |---|---|
  | normal/m09, challenge/ch-fuel | stempel zakt 30 cm weg in grind (geen matten) |
  | normal/m54 | stempel zakt weg in modder na 5 s |
  | normal/m14, m33, m34 | te veel schade |
  | normal/m53 | vastgelopen tot de limiet van 30 min |
  | realistic/m01 | vastgelopen tot de limiet van 30 min |
  | realistic/m05, m09 | te veel schade |

  Deze sporen zijn wel deterministisch en juist nuttig: de port moet op hetzelfde moment om dezelfde reden falen. De volledige lijst met uitkomsten staat in `summary` in het manifest.
