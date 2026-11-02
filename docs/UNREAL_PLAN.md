# Plan: Heavy Lift naar Unreal Engine 5

Opgesteld 2 november 2026, op basis van een selectie van 88 verbeterpunten (codes zoals `F1` verwijzen naar die lijst).

## Uitgangspunten

- **De rekenkern blijft eigen code.** De TypeScript-simulatie (`physics/`, `sim/`, `cranes/`, `missions/`, `economy/`, `career/`, samen ca. 10.800 regels) wordt geport naar een pure C++-module zonder Unreal-afhankelijkheden. Chaos wordt alleen gebruikt voor zaken die niet deterministisch hoeven: destructie, puin, losse objecten op de bouwplaats.
- **De TypeScript-versie is de gouden referentie.** Elk scenario dat in TS draait, draait ook in C++; de sporen (positie last, kabelspanning, stabiliteit, LMI-uitslag per stap) worden binnen een tolerantie vergeleken. Pas als die test groen is, wordt het TS-gedrag losgelaten of bewust verbeterd.
- **Deterministisch blijven.** Vaste tick (120 Hz, XPBD-substappen), geen framerate-afhankelijkheid. Dat houdt herhalingen, de missiebot, ongevalsonderzoek (`G9`) en later eventueel co-op mogelijk.
- **Data uit de huidige game.** Kranen, lasten, missies en vertalingen worden uit de TS-data geëxporteerd naar JSON en in Unreal als DataTables/DataAssets ingelezen.
- **Fictieve merken** blijven (geen `K1`). Hero-modellen worden ontworpen naar de referentiemodellen, zonder logo's of merknamen.

## Ook nodig, al stond het niet in de selectie

Unreal als doel (`E1`) is niet te halen zonder deze punten; ze zitten daarom in fase 0 en 1:

| Code | Waarom onmisbaar |
|---|---|
| E3 Rekenkern als C++-bibliotheek | Zonder port geen simulatie in Unreal |
| E4 TS-kern als gouden referentie | Enige manier om te bewijzen dat de port klopt |
| E5 Vaste fysicatick | Kabelparten, segmentkabel en flexibele giek vragen een hogere tick |
| E6 Data-gedreven content | 73 missies en 11 kranen met de hand overzetten is foutgevoelig |
| P1 Vertical slice | Beslismoment voordat het grote werk begint |

Aanrader, niet onmisbaar: **Q7 testen met echte machinisten** bij elke fasepoort, en **E8 streaming** als de open carrière (`G3`) en stad met verkeer (`W2`) groot worden. Zonder E8 worden bouwplaatsen losse levels op een regiokaart, wat prima werkt.

Bewust niet gekozen en daarmee buiten scope: samen spelen en mods (S), Steam en marketing (P, E11), echte audio-opnames (A1), VR en motion (B6, B7). De deterministische opzet houdt co-op later open.

## Architectuur

```
Unreal-project HeavyLift
├── Plugins/CraneSim/            pure C++ (geen UObject): physics, sim, cranes, missions, economy
│   └── Tests/                   gouden sporen uit TS, Unreal Automation + losse gtest-runner
├── Source/HeavyLift/            game: actors, componenten, input, UI (UMG), save
│   ├── Sim bridge               CraneSim-state → actors, interpolatie tussen ticks
│   ├── Rope rendering           instanced segmenten + staalkabel-shader (V3)
│   └── Input                    Enhanced Input + RawInput voor HID-joysticks (B2, B3)
├── Content/                     Megascans/Fab-assets, hero-kranen, levels per bouwplaats
└── Tools/                       TS-exporter (data + gouden sporen), missiebot-runner
```

Audio: FMOD (gratis indie-licentie, goede Unreal-plugin) voor `A2`; MetaSounds is het alternatief zonder licentie.

## Fasen

Elke fase eindigt met een poort: een speelbare build en een controleerbaar criterium.

### Fase 0 — Fundament

| Code | Werk |
|---|---|
| — | Unreal 5 + Visual Studio 2022 installeren, nieuw repo `hijskraan-unreal` met Git LFS |
| E3, E4, E5 | Physics- en sim-kern porten naar C++; gouden sporen uit TS exporteren en vergelijken |
| E6 | Exporter voor kranen, lasten, missies, vertalingen → DataTables |
| E7 | Bestaande saves (v2-JSON uit localStorage) importeren |
| Q5, Q4 | Build en tests op een self-hosted runner, crashrapportage |
| Q1 | Missiebot draait headless tegen de C++-kern |

**Poort:** alle 73 missies valideren in C++, de bot haalt dezelfde resultaten als in TS, gouden sporen binnen tolerantie.

### Fase 1 — Vertical slice: één kraan, één bouwplaats

| Code | Werk |
|---|---|
| E1, V1 | Art direction en één fotorealistische bouwplaats (Megascans, Lumen) |
| — | Hero-kraan Vectra AT 60 (bestaande hero-details als basis) |
| F1, F2, F3, F4 | Kabelparten en inscheren, segmentkabel, trommel, torsie |
| V3 | Staalkabel-shader |
| B1, B2, B3, B8 | Cabine met instrumenten, ISO/SAE, simhardware, kraancamera's |
| A2, A3, A5 | FMOD, cabine tegenover buiten, LMI-signalen |
| V7 | Dag-nachtcyclus |
| Q2 | Prestatiebudget (doel: 60 fps op een RTX 2080 op hoog) |

**Poort:** missies 1–5 speelbaar in Unreal, een machinist zegt dat de kabel en de cabine kloppen.

### Fase 2 — De kraan als constructie

| Code | Werk |
|---|---|
| F5, F7, F6 | Flexibele giek, echte kanteling met loskomende stempels, bezwijken |
| F8, F13, F14 | Bodem in lagen, hydraulisch gedrag, rem en lier |
| F11, F12, F15 | Flexibele lasten, windveld met turbulentie, stabiel stapelen |
| F17 | Validatie tegen lastdiagrammen en praktijkdata |
| V9, G9 | Destructie (Chaos) en ongevalsonderzoek met replaydata |
| G8 | Professional-moeilijkheid |

**Poort:** een omvaller ontstaat alleen uit de fysica, niet uit een regel; een reconstructie laat zien waarom.

### Fase 3 — Machinepark

| Code | Werk |
|---|---|
| K2 | Hero-modellen voor alle kraantypen (artistwerk of ingekochte basis) |
| K3, K4, K5 | Ballast monteren, vakwerkgiek opbouwen, superlift en derrick |
| K6, K7, K8 | Wip- en torenkraan opbouwen, klimmende torenkraan, bovenloopkranen |
| K9, K10, F9 | Laadkraan, verreiker en spinkraan, rupskraan rijdt met last |
| K11, K12 | Onderhoud en keuring, configurator |
| B4, B9, B10 | Afstandsbediening, opstartprocedures, haptiek |

**Poort:** elk kraantype doorloopt opbouw → hijs → afbouw zonder knip.

### Fase 4 — Werkcyclus en wereld

| Code | Werk |
|---|---|
| G1, G2 | Volledige opdrachtcyclus en hijsplan-tool |
| K13, F10 | Transportkonvooi en rijfysica op de weg |
| W2, W3, W7 | Stad met verkeer, ondergrondse infra, krappe binnensteden |
| W6 | Meerdere kranen met anti-botsing |
| V4, V5, A6 | Bouwvoortgang zichtbaar, mocap-animaties (Fab-pakketten), reactieve ambiance |
| V6, W4, V8 | Volledig weer, seizoenen, slijtage en vuil |
| E9, E10, V12 | LOD/HLOD/instancing, DLSS en FSR, nieuwe HUD |

**Poort:** één opdracht van aanvraag tot factuur in een binnenstad met verkeer, op 60 fps.

### Fase 5 — Carrière en content

| Code | Werk |
|---|---|
| G3, G4, G5 | Open carrière, personeel, vloot kopen/leasen/tweedehands |
| G7, G13, G14 | Certificering, opleidingstraject, verhaalcampagne |
| G12 | Scenario-editor |
| M1–M12 | Windturbine, prefab, blind hijsen, reactorvat, spoorwissel, haven, berging, evenementen, sloop, glas, drie kranen, hoogspanning |
| F16 | Water en drijvende lasten (voor M6) |
| B11 | Spraakbediening marifoon |
| Q3, Q6 | Telemetrie naar backend, toegankelijkheid |

**Poort:** de volledige carrière is uitspeelbaar; de missiebot valideert alle missies.

## Omvang

Van de 88 punten zijn er 22 groot (L), 1 extra groot (XL: hero-modellen), ca. 44 middel (M) en ca. 21 klein (S). Met de vuistregels L = 3 maanden, M = 3 weken, S = enkele dagen is dat **ruim 100 mensmaanden**: met een team van 6 tot 8 mensen anderhalf à twee jaar.

| Soort werk | Wie |
|---|---|
| C++-kern, fysica, gameplaycode, tests, tools, data, UI-logica | Claude + jij |
| Hero-kranen, cabines, bouwplaatsen, mensen | 3D-artists, of Megascans/Fab als basis |
| Mocap, stemopnames | Ingekochte pakketten of uitbesteed |
| Validatie, speeltests | Echte machinisten, kraanverhuurder |

Fase 0 en het code-deel van fase 1 en 2 zijn haalbaar met Claude als programmeur. Vanaf fase 3 bepaalt artcapaciteit het tempo.

## Werkplek

Gecontroleerd op 2 november 2026:

- Unreal Engine en Visual Studio zijn **nog niet geïnstalleerd**.
- GPU: RTX 2080, voldoende voor Lumen en Nanite op middel/hoog. DLSS-upscaling werkt; frame generation alleen via FSR.
- 32 GB RAM: werkbaar, 64 GB is prettiger bij grote levels.
- C: heeft maar 17 GB vrij. Unreal (ca. 60–100 GB) en de Derived Data Cache op F: of J: zetten; Visual Studio heeft op C: toch ca. 10 GB nodig.
- Git LFS 3.7 is aanwezig.

## Eerste stappen

1. Jij: Epic Games Launcher + Unreal 5 (nieuwste 5.x) en Visual Studio 2022 met de workload "Game development with C++" installeren.
2. Claude, kan nu al: TS-exporter voor data en gouden sporen in deze repo (`scripts/`), zodat de referentie vastligt vóór de port.
3. Claude: repo `hijskraan-unreal` met de `CraneSim`-plugin en de eerste geporte module (kabel + star lichaam) tegen de gouden sporen.
