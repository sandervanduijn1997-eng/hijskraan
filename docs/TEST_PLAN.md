# Testplan

## Uitvoeren

```bash
npm test             # Vitest: unit + integratie (headless, ~15 s)
npm run test:e2e     # Playwright: start dev-server op poort 5174, Chromium
npm run build        # typecheck + productiebuild
```

## Unit-tests (`tests/unit`)

| Bestand | Dekt |
|---|---|
| `physics.test.ts` | statische kabelspanning = gewicht, slingerperiode ≈ 2π√(L/g), kabel rekt niet uit, demping, rust op de grond, niet door een muur, balk op twee steunpunten |
| `cranes.test.ts` | 10 klassen + volledige configuratie, verschillende upgrades, giekgeometrie, haakpositie, draaien in z, toren- en knikarmkinematica, inverse kinematica, kabellengte en eindstanden, hydraulische aanloop, precisiemodus, LMI-blokkering, rijden alleen met ingehaalde stempels, automatische stempelprocedure, stempels niet inhalen onder last, giek niet door obstakel, capaciteit vs straal/contragewicht, hijsen zonder stempels, gedeeltelijke stempels, consistentie lastdiagram |
| `stability.test.ts` | kantellijn per zwenkhoek, K = 1 bij kantellast, 75 %-regel, slinger/ondergrond/helling verhogen K, kantelen alleen vanuit het model, interpolatie lastdiagram, belastingpercentage |
| `rules.test.ts` | botsingsdetectie (entry-rand, lijnstuk/rechthoek), doelzonevalidatie (geldig, alleen aanraken, onder het vlak, scheef, bewegend), scoreberekening (3 sterren, botsing, mislukt, onveilige snelheid, overgedimensioneerde configuratie) |
| `progress.test.ts` | save/load-rondreis, ontbrekende velden, ongeldige waarden, beschadigd bestand + reservekopie, migratie v1, vrijspelen missies/hoofdstukken, niveaus, geld en XP, herhaalfactor, huur, kopen met licentie, upgrades, onderhoud, audio zonder WebAudio |
| `missionValidation.test.ts` | 40 missies, nummering, 8×5, **elke missie geldig en haalbaar** (bereik + lastdiagram), kraan↔missie-verwijzingen, elke kraanklasse gebruikt, elke missie start stabiel zonder schade, uitdagingen en oefenscenario's |

## Integratietests (`tests/integration`, headless autopilot)

`tests/helpers/autopilot.ts` stuurt de kraan via dezelfde `CraneInput` als de speler (servo op giek/telescoop/zwenk/lier).

| Test | Scenario |
|---|---|
| complete eenvoudige hijs | missie 1 volledig: aanslaan, hijsen, verplaatsen, uitslingeren, neerzetten → succes + sterren |
| meerdere opeenvolgende lasten | missie 6: twee pallets na elkaar, met 180° zwenken |
| mislukte hijs door botsing | missie 2: container tegen keerwand (`onHit: fail`) |
| te zware last | 42 t op een 60 t-kraan: LMI vergrendelt, last komt niet los, geen kanteling |
| onveilige configuratie | AT-kraan zonder stempels: capaciteit 0, last komt niet los, waarschuwing |
| kantelen | RT-kraan op modder met zware module: kantelt (normaal) en kantelt niet (oefenen) |
| volgorde | missie 24: alleen de eerste levering is actief |
| opbouwprocedure | missie 11: bediening geblokkeerd tot de zelfopbouw klaar is |
| torenmontage: start | missie 12 begint in de hulpkraan (z = −14); alleen de voetsectie staat |
| torenmontage: volgorde | alleen het volgende deel is actief; volgorde mast → draaikrans → torenkop → tegengiek → ballast 1 → giek → ballast 2 |
| torenmontage: ballast | momentgrens wordt met de juiste volgorde nooit overschreden, met elke foute volgorde wel |
| torenmontage: overstappen en klimmen | na transportstand wordt de torenkraan bediend; klimmen blokkeert bewegingen, de haak blijft op hoogte, daarna volle capaciteit |
| torenmontage gespeeld | de missiebot speelt missie 12 (oefenen) volledig met besturingsinvoer: 9 montagehijsen in 3D, overstappen, klimmen, kubel afleveren |
| pauze | zonder stappen verandert de toestand niet |

## End-to-end (`tests/e2e/game.spec.ts`, Playwright)

1. Start: hoofdmenu, canvas, geen consolefouten.
2. Carrière → planning → missie 1 start met HUD.
3. **Missie 1 volledig met het toetsenbord** (Q, T, E, R, Shift) tot succes; saldo neemt toe.
4. Pauzeren terwijl de last slingert: tijd en haakpositie bevroren, hervatten loopt door.
5. Opnieuw beginnen tijdens een missie.
6. Venster vergroten/verkleinen (800×600, 1920×1080, 1280×720).
7. Beschadigd savebestand: melding, nieuw profiel, game bruikbaar.
8. Stempels niet uitgezet → automatische procedure → taak voltooid.

De e2e-tests draaien met `?renderer=canvas`: headless Chromium heeft alleen software-WebGL (~4 fps), de Canvas-renderer haalt daar 60 fps.

## Randgevallen

| Randgeval | Waar getest |
|---|---|
| Pauzeren terwijl een last slingert | e2e 4, integratie |
| Opnieuw starten tijdens een missie | e2e 5 |
| Savebestand met ontbrekende velden | `progress.test.ts` |
| Venster vergroten en verkleinen | e2e 6 |
| Ontbrekende asset (audio) | `progress.test.ts` (AudioEngine zonder WebAudio); er zijn geen beeldassets die kunnen ontbreken |
| Missie starten zonder vrijgespeelde kraan | carrière: kraan wordt gehuurd (`progress.test.ts`, huur); vrije oefening: vergrendelde kraan wordt geweigerd met melding (handmatig gecontroleerd) |
| Bedienen terwijl een vereiste stempel niet is uitgezet | `cranes.test.ts`, integratie (onveilige configuratie), e2e 8 |

## Handmatig gecontroleerd

Visuele controle in de browser van hoofdmenu, missies 1, 11, 12, 17, 23, 37 (alle kraanvormen), planning met lastdiagram (missie 18), HUD en waarschuwingen. Niet alle 40 missies zijn door een mens uitgespeeld; hun haalbaarheid is automatisch gevalideerd (zie ROADMAP, *Status*).
