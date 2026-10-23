# Architectuur

## Technische keuzes

| Onderdeel | Keuze | Reden |
|---|---|---|
| Taal | TypeScript 5.9 (strict) | Typeveiligheid voor data (kranen, missies) en fysica |
| Weergave | Three.js 0.170 (WebGL) | Volledig 3D low-poly met flat shading, schaduwen en mist. Vervangt het eerdere 2D-zijaanzicht (Phaser) |
| Build | Vite 7 | Snel, eenvoudige config; Vite 8 was te recent |
| Fysica | Eigen XPBD-simulatie | Volledige controle over kabelconstraints, deterministisch, headless testbaar; een generieke physics-engine modelleert een ongelijkheidskabel + stabiliteitsmodel niet beter |
| UI | DOM-overlay (geen framework) | Scherpe tekst, toegankelijke formulieren, eenvoudig herschalen; de wereld blijft in canvas/WebGL |
| Tests | Vitest 3 + Playwright 1.63 | Unit/integratie in Node, e2e in Chromium |
| Audio | WebAudio, procedureel | Geen assets nodig, geen licentieproblemen, faalt veilig |

## Lagen

```
          ┌──────────────────────── UI (DOM) ─────────────────────────┐
          │ App: menu's, carrière, planning, vloot, instellingen       │
          │ Hud: leest Simulation per frame (alleen tekst die wijzigt)  │
          └──────────────▲────────────────────────────▲───────────────┘
                         │ hooks (onFrame/onEvents)    │ save/economy/career
          ┌──────────────┴──────── game3d (Three.js) ──┴───────────────┐
          │ World3D: vaste tijdstap, invoer → sim.step, scène bijwerken │
          │ craneModel, worldModel, loadModel, effects3d, cameraRig     │
          └──────────────▲─────────────────────────────────────────────┘
                         │ CraneInput (bron-onafhankelijk)
          ┌──────────────┴──────── sim (pure TS) ──────────────────────┐
          │ Simulation: crane controller + PhysicsWorld + missieregels │
          │ scoring, warnings, placement-validatie, events              │
          └───────▲───────────────────────▲─────────────────────────────┘
                  │                       │
     cranes/ (config, kinematica,   physics/ (rope, rigid body, contacts,
     capaciteit, controller)          stability, wind, ground, world)
```

- **`physics/`** en **`sim/`** importeren niets uit Three.js of de DOM. Daardoor draaien alle fysica-, missie- en integratietests headless in Node.
- **Data** (kranen, lasten, missies) staat uitsluitend in `cranes/config` en `missions/data`; er staan geen missies verspreid door de code.
- **Rendering** leest de simulatie maar schrijft er nooit in.
- **Invoer** loopt via `InputManager` → `CraneInput` (assen −1..1). Een gamepad-bron kan via `addAxisSource()` dezelfde structuur vullen.

## Tijdstap en interpolatie

`World3D.frame` verzamelt framedelta (max 0,25 s) en voert vaste stappen van 1/60 s uit (max 6 per frame). Elke stap heeft 8 XPBD-substappen. Valt er meer tijd weg, dan wordt die gecontroleerd gedropt (slow motion, nooit teleport). De renderer interpoleert lasten, haak en giekkop tussen de vorige en huidige stap.

## Opslag

`save/saveSystem.ts`: geversioneerd JSON-formaat (`SAVE_VERSION = 2`) in `localStorage`, met migraties per versie en `sanitizeSave()` dat elk veld valideert en ontbrekende/ongeldige velden vervangt. Een onleesbaar bestand wordt als reservekopie bewaard en de game start met een nieuw profiel. Zonder localStorage valt de game terug op geheugenopslag.

## Assets

Er worden **geen externe of commerciële assets** gebruikt:

| Asset | Hoe gemaakt |
|---|---|
| Kranen (10 typen) | Procedurele low-poly 3D-modellen in `game3d/craneModel.ts` (vakwerk, telescoopsecties, wielen, rupsen, stempels, cilinders, zwaailicht) |
| Lasten (20+ stijlen) | `game3d/loadModel.ts` |
| Obstakels/gebouwen | `game3d/worldModel.ts` → `buildObstacle` per stijl, met dezelfde diepte als de fysica |
| Omgevingen (10) | `game3d/worldModel.ts`: seeded procedurele stad, gebouwen in aanbouw, bewegende bouwkranen, bomen, windturbines, hallen, water, luchtkoepel |
| Effecten | InstancedMesh-deeltjespool (`game3d/effects3d.ts`) |
| Audio | `audio/audioEngine.ts` (motor, hydrauliek, lier, wind, omgeving, waarschuwingen, UI, ambient-muziek) |
| Iconen/favicon | Inline SVG |

## Debug-/testhaak

`window.__crane` geeft lees- en starttoegang voor e2e-tests en debugging (`state()`, `startMission(id)`, `save()`, `validate()`).
