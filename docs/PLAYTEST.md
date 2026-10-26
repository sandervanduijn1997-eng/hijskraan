# Speeltest — protocol

Doel: meten waar nieuwe spelers vastlopen en laten toetsen door een echte kraanmachinist wat niet klopt.
Deelnemers: vijf spelers die de game nooit speelden, en minstens één machinist (mobiele kraan, liefst ook toren).

## Voorbereiding

1. Instellingen → Speeltest → **Wissen** (schone meetdata per deelnemer).
2. Nieuw savebestand: in de browser de sitegegevens wissen, of een privévenster gebruiken.
3. Geluid aan, signaalgever op *gesproken*, moeilijkheid *Normaal*.
4. Gebruik een controller én een toetsenbord, wissel per deelnemer.

## Sessie (± 45 min per speler)

| Stap | Wat | Begeleider |
| --- | --- | --- |
| 1 | Carrière → missie 1 (les met instructeur) | Niets uitleggen. Noteer elke vraag en elk moment van twijfel. |
| 2 | Missies 2–4 | Alleen helpen na 3 minuten vastzitten; noteer waar. |
| 3 | Missie 7 (stalen balken, zelf aanslaan) | Let op de keuze van stroppen en hijspunten. |
| 4 | Vragenlijst (hieronder) | |
| 5 | Instellingen → Speeltest → **Exporteren**, bestand hernoemen naar `speler-N.json` | |

Hardop denken aanmoedigen. Geen hints geven, wel vragen “wat verwacht je nu?”.

## Vragen aan de speler (1–5 en een zin toelichting)

- Begreep je bij de eerste hijs wat je moest doen?
- Voelde de last zwaar en echt aan?
- Was duidelijk waarom je iets niet mocht (begrenzer, stempels, aanslag)?
- Wat was het meest frustrerende moment?
- Zou je verder spelen? Waarom wel of niet?

## Machinist (na eigen sessie van ± 30 min, vrij spelen op Realistisch)

- Bediening: snelheid, vertraging, fijnregeling, motortoerental — wat klopt niet?
- Slingeren en kabel: gedrag bij starten en stoppen, uitslingeren, slappe kabel.
- Lastmomentbegrenzer en instelprocedure: volgorde en termen zoals in een echte cabine?
- Aanslaan: keuze van gereedschap, stropshoeken, werklasten — realistisch?
- Signaalgever: zijn de commando’s en de woorden zoals op de bouwplaats?
- Wat zou een leerling hier echt van leren, en wat leert hij verkeerd?

## Uitwerking

Voeg de JSON-bestanden samen en kijk per missie naar `summary`:

- `success` / `tries` — slagingspercentage (doel missie 1: 4 van 5 zonder hulp).
- `medianTime` en `phases` — welke fase het langst duurt.
- `quits` — waar spelers stoppen of herstarten (`les:<stap>` = stap in de les).
- `topWarnings` — welke fouten het vaakst voorkomen.

Verslag: knelpunten op volgorde van impact, met de opmerkingen van de machinist erbij, en per knelpunt een voorstel.
