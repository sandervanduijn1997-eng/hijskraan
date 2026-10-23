# CRANE OPERATOR: HEAVY LIFT

Een 2D/2.5D low-poly hijskraansimulator in de browser. Tien kraanklassen, veertig carrièremissies, een eigen deterministische XPBD-fysica voor kabel en last, een stabiliteitsmodel met lastdiagrammen, carrière, economie, upgrades, uitdagingen, vrije oefening, procedurele audio en lokale opslag.

> Alle machinenamen zijn fictief. De referentiemodellen (Liebherr, Grove, Tadano, XCMG, Potain, Manitowoc, Palfinger) worden alleen als visuele en functionele referentie gebruikt. Technische waarden in de game zijn **spelwaarden** (`gameBalance`), geen fabrikantgegevens.

## Vereisten

- Node.js **20 of nieuwer** (getest met Node 24.22 LTS) en npm
- Een moderne browser (Chrome, Edge, Firefox, Safari)

## Installeren en starten

```bash
npm install
npm run dev          # ontwikkelserver op http://localhost:5173
npm run build        # typecheck + productiebuild naar dist/
npm run preview      # productiebuild lokaal serveren (poort 4173)
```

## Tests

```bash
npm test                 # unit- en integratietests (Vitest)
npm run validate:missions # alleen de validatie van alle 40 missies
npx playwright install chromium   # eenmalig
npm run test:e2e         # end-to-end-tests (Playwright, start zelf een dev-server op poort 5174)
```

Zie [docs/TEST_PLAN.md](docs/TEST_PLAN.md) voor wat er wordt getest.

## Bediening (standaard, aanpasbaar in Instellingen)

| Toets | Telescoop-/rupskraan | Torenkraan | Knikarmkraan |
|---|---|---|---|
| W / S | giek op / neer | loopkat uit / in | hoofdarm op / neer |
| A / D | draaien | draaien | kolom draaien |
| Q / E | vieren / hijsen | vieren / hijsen | lier vieren / hijsen |
| R / F | telescoop uit / in | — | telescoopsegmenten |
| I / K | — | — | knikarm op / neer |
| ← / → | rijden | — | rijden |

Algemeen: **Shift** precisie · **T** aanslaan/afkoppelen · **O** stempelmodus (W/S schuiven, E/Q vijzels, 1–4 kiezen, 0 = alle) · **P** automatische stempelprocedure · **B** (vasthouden) opbouwprocedure · **Spatie** pauze · **Esc** menu · **+/−/muiswiel** zoom · **Tab** overzicht · **C** camera herstellen · **H** claxon · **F1** bedieningsoverzicht.

## Renderer

De game gebruikt WebGL waar mogelijk. Als WebGL niet start of zonder hardwareversnelling traag is (< 20 fps), schakelt de game eenmalig automatisch over op de Canvas-renderer. Forceren kan met `?renderer=canvas` of `?renderer=webgl`.

## Projectstructuur

```
src/
  physics/      kabel, star lichaam, botsingen, stabiliteit, wind, ondergrond, XPBD-wereld
  cranes/       configuraties (10 kranen, upgrades), kinematica, capaciteit/lastdiagram, besturing
  missions/     missiedata (40 + uitdagingen + oefening), runtime (wereldopbouw, score), validatie
  sim/          Simulation: koppelt kraan, fysica, missieregels, waarschuwingen en meetwaarden
  game/         Phaser-scene, camera, invoer, rendering (achtergrond, kraan, wereld, effecten)
  ui/           DOM-HUD, menu's, planning, resultaten, vloot, instellingen
  career/ economy/ save/ audio/ utils/
tests/          unit, integratie (headless autopilot), e2e (Playwright)
docs/           architectuur, fysica, game design, testplan, roadmap
```

Documentatie: [Architectuur](docs/ARCHITECTURE.md) · [Fysica](docs/PHYSICS.md) · [Game design](docs/GAME_DESIGN.md) · [Testplan](docs/TEST_PLAN.md) · [Roadmap](docs/ROADMAP.md)

## Status en bekende beperkingen

Zie de sectie *Status* in [docs/ROADMAP.md](docs/ROADMAP.md) voor een eerlijk overzicht van wat werkt, wat getest is en wat nog ontbreekt.
