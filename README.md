# CRANE OPERATOR: HEAVY LIFT

Een 3D low-poly hijskraansimulator in de browser (Three.js). Tien kraanklassen, veertig carrièremissies, een eigen deterministische XPBD-fysica voor kabel en last, een stabiliteitsmodel met lastdiagrammen, carrière, economie, upgrades, uitdagingen, vrije oefening, procedurele audio en lokale opslag.

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

Toetsen lopen op: kort tikken geeft 15 % snelheid, vasthouden loopt in ca. 1 s op naar vol (instelbaar in Instellingen → Analoge bediening).

**Controller** (standaardindeling, bijv. Xbox/PlayStation): linkerstick = draaien en giek op/neer (torenkraan: loopkat), rechterstick = hijsen/vieren en telescoop (knikarm: knikarm), triggers = rijden, RB = precisie, LB = opbouw (vasthouden), A = aanslaan, X = stempels automatisch, Y = camera, B = overzicht, Start = pauze, D-pad = zoom. Dode zone, responscurve en een omgekeerde hijsas zijn instelbaar.

**L** = lastmomentbegrenzer instellen (opstelling, contragewicht, schijvenstel, hulpgiek). Op Normaal en Realistisch hijst de kraan pas na het instellen; een verkeerde invoer geeft een verkeerd lastdiagram en telt als veiligheidsovertreding.

**T** = aanslaan. Op Normaal en Realistisch kies je zelf het hijsgereedschap (rondstroppen met kleurcode, kettingen klasse 8 of een hijsbalk), het aantal sprongen, de stroplengte en de hijspunten. Het paneel toont de stropshoek en de belasting per sprong (G / n·cos α; een 4-sprong draagt als 3). Te korte stroppen (meer dan 60°) of te licht gereedschap zijn een overtreding; boven de breukgrens breekt de strop en valt de last. Hijspunten in het midden van een excentrische last laten hem scheef hangen.

**M** = kraanmatten wisselen (alleen met de vijzels omhoog): geen, standaard of groot; de maat groeit mee met de kraan. Per stempel wordt de bodemdruk berekend uit het gewicht en de ligging van het zwaartepunt; boven de toelaatbare druk van de ondergrond zakt de stempel weg (op Normaal en Realistisch is 30 cm het einde van de hijs). De giek buigt door onder last en trilt na bij een ruk of bij het neerzetten.

**Opdrachten en bedrijf.** Missies liggen rondom de kraan: ophaalpunt en afzetplek liggen niet meer op één lijn, dus elke hijs vraagt zwenken. Elke opdracht komt van een opdrachtgever met een deadline (te laat = boete), en vanaf hoofdstuk 2 gebeurt er onderweg iets: een windvlaag, een afzetplek die nog niet vrij is, of een opdrachtgever die de last ergens anders wil. In de planning kies je de standplaats van de kraan, de kraanmatten, je offerte (scherp, marktprijs of hoog, met kans op gunning) en of je je verzekert. Na afloop volgt een afrekening: aanneemsom, huur, matten, premie, schade, boetes en per vijf opdrachten de vaste lasten van je vloot. Je reputatie bepaalt je kansen en je prijs. Torenkranen bouw je één keer op (missie 12); daarna staat de kraan er, en zelf opnieuw opbouwen geeft +50 % XP.

**Gevolgen en nabespreking.** Een zware botsing of een last boven mensen legt het werk stil: de kraan staat 20 s stil, een inspecteur maakt een rapport en de kosten gaan van je opdracht af. Lasten en obstakels tonen zichtbare schade. Na elke opdracht krijg je één concrete tip en het moment waarop het misging, met een herhaling (tijdlijn met belasting, slinger en fouten; spoelen, 0,5–4× snelheid, vrije camera met de muis).

De bouwplaats leeft: bouwvakkers lopen en werken buiten de afgezette draaicirkel, een vrachtwagen rijdt aan en af (en wacht als er een last boven de rijstrook hangt). Mensen lopen weg onder een naderende last; draai je een last toch boven iemand, dan roept de signaalgever 'Stop!' en telt dat als veiligheidsovertreding. Op Realistisch wordt het werk dan stilgelegd.

Algemeen: **V** camera volgen/cabine · **Shift** precisie · **T** aanslaan/afkoppelen · **O** stempelmodus (W/S schuiven, E/Q vijzels, 1–4 kiezen, 0 = alle) · **P** automatische stempelprocedure · **B** (vasthouden) opbouwprocedure · **Spatie** pauze · **Esc** menu · **+/−/muiswiel** zoom · **Tab** overzicht · **C** camera herstellen · **H** claxon · **F1** bedieningsoverzicht.

## Weergave

Volledig 3D low-poly met Three.js (WebGL): belichting, schaduwen, mist en een vrij draaibare camera.

- **Camera**: linkermuisknop slepen = draaien, rechtermuisknop slepen = verschuiven, muiswiel = zoomen, dubbelklik of **C** = herstellen, **Tab** = overzicht, **V** = volgcamera/cabinezicht.
- `?quality=low`: geen schaduwen, lagere resolutie (voor zwakke GPU's).
- `?render=off`: alleen voor tests — simulatie en UI lopen, er wordt niet getekend.

## Projectstructuur

```
src/
  physics/      kabel, star lichaam, botsingen, stabiliteit, wind, ondergrond, XPBD-wereld
  cranes/       configuraties (10 kranen, upgrades), kinematica, capaciteit/lastdiagram, besturing
  missions/     missiedata (40 + uitdagingen + oefening), runtime (wereldopbouw, score), validatie
  sim/          Simulation: koppelt kraan, fysica, missieregels, waarschuwingen en meetwaarden
  game3d/       Three.js: host/renderer, 3D-sessie, kraanmodellen, wereld, lasten, camera, effecten
  game/         invoer en kleurpaletten
  ui/           DOM-HUD, menu's, planning, resultaten, vloot, instellingen
  career/ economy/ save/ audio/ utils/
tests/          unit, integratie (headless autopilot), e2e (Playwright)
docs/           architectuur, fysica, game design, testplan, roadmap
```

Documentatie: [Architectuur](docs/ARCHITECTURE.md) · [Fysica](docs/PHYSICS.md) · [Game design](docs/GAME_DESIGN.md) · [Testplan](docs/TEST_PLAN.md) · [Roadmap](docs/ROADMAP.md)

## Status en bekende beperkingen

Zie [docs/ROADMAP.md](docs/ROADMAP.md) voor het eerlijke oordeel en de bekende beperkingen, en [docs/roadmap.html](docs/roadmap.html) voor de kritische review met werkpakketten om uit te kiezen.
