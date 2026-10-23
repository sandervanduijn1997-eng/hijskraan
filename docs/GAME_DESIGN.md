# Game design

## Kern

De speler begint als junior machinist met een compacte all-terrain kraan en groeit via acht hoofdstukken (zeven carrièrefasen) naar heavy-lift-specialist. De kern is altijd dezelfde, eerlijke vaardigheid: stabiel opstellen, de last beheersen, binnen het lastdiagram blijven en precies neerzetten.

## Kranen

| Kraan (fictief) | Klasse | Referentie | Kenmerk in de game |
|---|---|---|---|
| Vectra AT 500-8 | Grote all-terrain | Liebherr LTM 1500-8.1 | 5 contragewichtopties, lange telescoop, trage opstelling |
| Vectra AT 60-3 | Compacte all-terrain | Grove GMK3060L | Leerkraan, snelle stempels |
| Terrax RT 80 | Rough-terrain | Tadano GR-serie | Rijdt goed in modder, mag beperkt op banden hijsen |
| Kodo TC 25 | Truckkraan | XCMG QY-serie | Snel, licht, leveringen |
| Maxon LC 300 | Vakwerk-rupskraan | Liebherr LR-serie | Giekmontage (B), rijden met ≤ 50 % last |
| Potera SE 32 | Zelfopbouwende torenkraan | Potain Igo-serie | 4-fasige zelfopbouw (stempels, ballast, mast, giek) |
| Potera TC 160 | Torenkraan | Potain MD-serie | 52 m hoog, 60 m giek, loopkat, verankerd |
| Maxon HL 600 | Heavy-lift rupskraan | Manitowoc MLC-serie | Gieken tot 108 m, hulpgiek, contragewicht tot 500 t |
| Falkon KB 22 | Kniktelescopische autolaadkraan | Palfinger PK-serie | Hoofdarm + knikarm + telescoop, reikt achter obstakels |
| Vectra CD 15 | Pick-and-carry | Grove carry-deck | Rijdt met last, voor hallen |

Elke kraan heeft een eigen configuratieobject (`cranes/config/cranes.ts`) met alle velden uit de specificatie; spelwaarden staan in `gameBalance`, publieke kopcijfers alleen ter oriëntatie in `reference`.

## Missies

40 missies in 8 hoofdstukken, als data in `missions/data/chapters*.ts`. Elke missie heeft: briefing, leerdoel, bedieningshint, kraanopties, startconfiguratie, lasten, zones (positie-, hoek- en dieptetolerantie), obstakels, ondergrond, taken, wind, optionele tijdslimiet, richttijd, maximale schade, eisen, planningsopties en beloning.

Taaktypen: `deliver` (last in zone), `drive` (werkpositie bereiken), `outriggers`, `setup` (zelfopbouw/giekmontage), `stow` (transportstand). Leveringen mogen in willekeurige volgorde tenzij `ordered`. Effecten: een geplaatste contragewichtplaat wordt gemonteerd en verhoogt de stabiliteit (missie 27).

**Een levering telt alleen als** de last binnen de tolerantie op het juiste vlak staat (niet erboven hangend, niet eronder), recht is, op een geldig oppervlak steunt, stilstaat en de kabel ontlast is — 1,5 s aaneengesloten.

Bijzondere missies: 11 (zelfopbouw), 19 (diepte-uitlijning tussen leidingen), 21–22 (opstelplaats en draagkracht kiezen), 23 (giekmontage), 24 (volgorde + transportstand), 25 (helling + damwand naast de stempels), 27 (contragewicht monteren), 30/39/40 (zelf hijsplan kiezen: kraan, giek, contragewicht), 37 (gondel op 80 m), 38–39 (de AT-kraan is bewust ongeschikt: de planning laat dat zien).

## Moeilijkheidsgraden

| | Oefenen | Normaal | Realistisch |
|---|---|---|---|
| Slingerdemping | hoog | gemiddeld | minimaal |
| Wind | ×0,5 | ×1 | ×1,2 |
| Kantelen | uit | aan | aan |
| Schade | ×0,5 | ×1 | ×1,25 |
| Tijdslimiet | nee | ja | ja |
| Overbelasting > 110 % | — | waarschuwing | mislukt |
| Hijsen zonder vereiste stempels | strafpunten | strafpunten | mislukt |

## Score (0–3 sterren)

Gewogen: veiligheid 25 %, precisie 20 %, tijd 10 %, slingering 10 %, botsingen 10 %, schade 10 %, configuratiekeuze 7,5 %, efficiëntie (brandstof) 7,5 %. **De tijdscore wordt vermenigvuldigd met de veiligheidsscore**: snel maar onveilig levert niets op. Drie sterren vereisen ≥ 85 punten, geen botsingen, < 3 % schade, veiligheid ≥ 85 en slinger ≤ 6°. Configuratie scoort het best bij 70–92 % benutting.

## Economie

- Start: €2.000 en de AT 60-3.
- Beloning × sterrenfactor (0,9 / 1,0 / 1,2). Herhalen levert 35 % op (geen grind-noodzaak; de carrière is in één doorgang ruim betaalbaar).
- Kranen die je niet bezit worden gehuurd; de huur gaat van de beloning af, dus een missie is nooit geblokkeerd door gebrek aan geld.
- Kopen vereist de juiste licentie. Eigen kranen slijten per missie; onderhoud herstelt de conditie (lage conditie = tot 20 % trager).
- Upgrades per kraan verschillend (12 typen): ze verbeteren snelheid, bediening, contragewicht, gieklengte, monitoring, brandstof, opstellen, waarschuwingen, ondergrond of slingerassistentie — de basisfysica blijft altijd actief.

## Carrièreprogressie

Hoofdstuk N opent na de laatste missie van hoofdstuk N−1 én de vereiste licentie. Licenties: basis (5), toren (15), industrie (20), terrein (25), zwaar (30), specialist (35), eindcertificaat + heritage-uitvoering (40).

## Overige modi

- **Vrije oefening**: kraan, last, omgeving, wind (0–20 m/s), zwaartekracht (1,6–15 m/s²) en moeilijkheid kiezen; geen timer.
- **Uitdagingen** (6): snelste veilige hijs, minimale slingering, perfecte landing, geen enkele botsing, minimaal brandstofverbruik, beperkte werkruimte. Records worden opgeslagen.

## HUD

Missie en taken met afvinken, timer, opbouwvoortgang · saldo, XP/niveau, wind · lastmomentbegrenzer (gewicht, toegestaan, giekhoek/-lengte, straal, haakhoogte, kabellengte, contragewicht, belastingbalk met 90 %-markering, kantelmoment) · plattegrond (bovenaanzicht met z-diepte), slingerindicator met richting, stempelstatus per poot, ondergrond · maximaal twee waarschuwingen tegelijk met prioriteit en hysterese · contextprompt (aanslaan/afkoppelen) · toetsenoverzicht voor het actuele kraantype.
