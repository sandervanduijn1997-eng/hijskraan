# Architectuur

## Technische keuzes

| Onderdeel | Keuze | Reden |
|---|---|---|
| Taal | TypeScript 5.9 (strict) | Typeveiligheid voor data (kranen, missies) en fysica |
| Engine | Phaser 3.90 (laatste 3.x) | Gevraagd; stabiel en bekend. Phaser 4 is nieuwer maar API-wijzigingen zijn een onnodig risico |
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
          ┌──────────────┴──────── game (Phaser) ──────┴───────────────┐
          │ WorldScene: vaste tijdstap, invoer → sim.step, rendering    │
          │ render/*: achtergrond, kraan, wereld, effecten  camera/*    │
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

- **`physics/`** en **`sim/`** importeren niets uit Phaser of de DOM. Daardoor draaien alle fysica-, missie- en integratietests headless in Node.
- **Data** (kranen, lasten, missies) staat uitsluitend in `cranes/config` en `missions/data`; er staan geen missies verspreid door de code.
- **Rendering** leest de simulatie maar schrijft er nooit in.
- **Invoer** loopt via `InputManager` → `CraneInput` (assen −1..1). Een gamepad-bron kan via `addAxisSource()` dezelfde structuur vullen.

## Tijdstap en interpolatie

`WorldScene.update` verzamelt framedelta (max 0,25 s) en voert vaste stappen van 1/60 s uit (max 6 per frame). Elke stap heeft 8 XPBD-substappen. Valt er meer tijd weg, dan wordt die gecontroleerd gedropt (slow motion, nooit teleport). De renderer interpoleert lasten, haak en giekkop tussen de vorige en huidige stap.

## Opslag

`save/saveSystem.ts`: geversioneerd JSON-formaat (`SAVE_VERSION = 2`) in `localStorage`, met migraties per versie en `sanitizeSave()` dat elk veld valideert en ontbrekende/ongeldige velden vervangt. Een onleesbaar bestand wordt als reservekopie bewaard en de game start met een nieuw profiel. Zonder localStorage valt de game terug op geheugenopslag.

## Assets

Er worden **geen externe of commerciële assets** gebruikt:

| Asset | Hoe gemaakt |
|---|---|
| Kranen (10 typen) | Procedurele low-poly geometrie in `render/craneRenderer.ts` (schuine 3D-projectie, facetten, vakwerk, wielen, rupsen, cilinders, zwaailichten) |
| Lasten (20+ stijlen) | `render/worldRenderer.ts` → `drawLoad` |
| Obstakels/gebouwen | `drawObstacle` per stijl (baksteen, glas, casco, steiger, tank, schip, jacket, …) |
| Achtergronden (10 omgevingen) | `render/background.ts`: seeded procedurele skyline, industrie, bouwkranen, bomen, rook, laswerk, wolken, regen |
| Effecten | Deeltjespool (`render/effects.ts`) |
| Audio | `audio/audioEngine.ts` (motor, hydrauliek, lier, wind, omgeving, waarschuwingen, UI, ambient-muziek) |
| Iconen/favicon | Inline SVG |

## Debug-/testhaak

`window.__crane` geeft lees- en starttoegang voor e2e-tests en debugging (`state()`, `startMission(id)`, `save()`, `validate()`).
