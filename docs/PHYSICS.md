# Fysica

## Eenheden en coördinaten

- Meter, kilogram, seconde, newton, radialen (graden alleen in data en HUD).
- `x` rechts, `y` omhoog, `z` naar de kijker. Grond op `y = 0`.
- Schermschaal: 24 px/m (`PIXELS_PER_METER`), schuine projectie: diepte schuift naar rechtsboven (`render/draw.ts`).

## Simulatielus

Vaste stap `FIXED_DT = 1/60 s`, `SUBSTEPS = 8` (substap ≈ 2,1 ms). Per substap (XPBD, Müller et al. 2020):

1. Integreer externe krachten: zwaartekracht, wind (kwadratische weerstand `½ρ·CdA·v_rel·|v_rel|`), positie en hoek.
2. Los de **kabelconstraint** op.
3. Los **contacten** op (grond, statische obstakels, lasten onderling) met wrijving.
4. Leid snelheden af uit de positieverandering; pas demping toe.

De giekkop (ophangpunt) én de kabellengte worden lineair over de substappen geïnterpoleerd. Zonder die interpolatie zou een strakke kabel de last per stap met een sprong verplaatsen (gevonden en opgelost tijdens het testen: een last werd met ~10 m/s weggeslingerd).

## Kabel en haak

- Ongelijkheidsconstraint: `|ophangpunt − tip| ≤ L`. De kabel kan slap hangen maar niet langer worden dan `L`.
- **Elasticiteit**: compliance `α = 0,15 m / (nominale capaciteit · g)`, dus ca. 15 cm rek (kabel + giekdoorbuiging) bij de nominale last. Zo wordt de last geleidelijk overgenomen bij het heffen, zoals bij een echte kraan.
- **Rekdemping** langs de kabelrichting (40 /s) voorkomt dat de elastische kabel als een elastiek terugveert.
- **Spanning** = λ / h² (gemiddeld over de substappen). De lastmomentbegrenzer gebruikt deze gemeten kracht, dus dynamische pieken (slingeren, ruk bij heffen) zijn zichtbaar.
- Bij aanslaan wordt de kabellengte op de werkelijke afstand gezet: geen ruk of sprong.
- Haak alleen: eigen klein lichaam. Aangeslagen: haak + last vormen één star lichaam; het haakpunt ligt boven het geometrische midden van de last. Een excentrisch zwaartepunt (`comOffsetX`) laat de last dus realistisch schuin hangen.

## Lasten (star lichaam)

Volledig 3D (`physics/load/rigidBody.ts`): positie, oriëntatie als quaternion, hoeksnelheid als vector en een traagheidstensor van een doos met verschoven zwaartepunt (`Ixx = m(h²+d²)/12`, `Iyy = m(w²+d²)/12 + m·e²`, `Izz = m(w²+h²)/12 + m·e²`; het haakblok telt als puntmassa op het ophangpunt). Correcties gebruiken de gegeneraliseerde inverse massa `w = 1/m + (r×n)·I⁻¹_w·(r×n)` met `I⁻¹_w = R·I⁻¹·Rᵀ`; de rotatie wordt bijgewerkt met `Δq = ½·(I⁻¹_w (r×Δp))·q` en de hoeksnelheid volgt uit `Δq = q·q_prev⁻¹`. Lasten kantelen dus in elke richting, hangen scheef bij een excentrisch zwaartepunt en kunnen om de kabel gieren.

**Gieren en kabeltorsie.** De kabelparten werken als een bifilaire slinger: een verdraaide last krijgt een terugdraaimoment `k = G·s²/(4L)` (zachte hoekconstraint met compliance `1/k`), met `s²/4 = 0,16 m²`. Vieren en hijsen verschuiven de neutrale stand licht (opdraaien van de kabel). Monteurs met stuurlijnen dempen het gieren (`yawDamping` 0,35 /s).

## Slingerbeweging

Volgt volledig uit de fysica (geen animatie): traagheid, versnellen/stoppen van giek/loopkat, draaien (de tip beweegt dan ook in `z`), kabellengte (`T = 2π√(L/g)`, getest), massa en wind. Demping per moeilijkheidsgraad (`swayDamping`: oefenen 0,45, normaal 0,08, realistisch 0,02 /s) werkt alleen op de beweging **relatief** t.o.v. het ophangpunt. De HUD toont slingerhoek en verwachte richting.

## Aandrijving: optrekken en afremmen

Elke as trekt geleidelijk op tot volle snelheid, met een aanlooptijd die logaritmisch meeschaalt met de capaciteit van de kraan (kleine kraan → zware kraan): zwenken 2,5–5,5 s, giek op/neer 1,4–3 s, telescoop 1–2 s, hijsen 0,7–1,4 s, loopkat 2–3 s, rijden 2–4,5 s. Afremmen gaat 1,3× sneller. Draaisnelheden zijn realistische spelwaarden (torenkraan 4,5°/s, heavy-lift 2,5°/s).

Dit is bepalend voor het slingergedrag: de slingerhoek bij optrekken is ongeveer `atan(a/g)`. In v0.1.0 was de aanlooptijd 0,55 s voor alle assen, wat bij zwenken ~4 m/s² gaf en tot 26° slinger. Nu blijft volle-snelheid-zwenken en loslaten onder ca. 5° (regressietest in `tests/integration/swing.test.ts`).

## Kinematica (`cranes/models/kinematics.ts`)

- **Telescoop/vakwerk**: `tip_u = pivot_u + L·cos θ`, `tip_y = pivot_h + L·sin θ`; optionele hulpgiek met offsethoek.
- **Torenkraan**: tip op loopkatstraal onder de giek; zelfopbouw animeert masthoek en gieksvouw.
- **Knikarm**: keten kolom → hoofdarm (`a1`) → knikarm (`a1+a2`) + telescoop.
- Draaien: wereld `x = draaias + u·cos φ`, `z = u·sin φ`.
- Kanteling roteert de hele kraan om de voorste kantellijn.

### Diepte-positie en torenmontage

Elke kraan heeft naast `baseX` een `baseZ`; de onderwagen blijft evenwijdig aan x. Tip, segmenten, stempels en eigen botsingsvlakken worden met `baseZ` verschoven, zodat een hulpkraan naast een torenkraan kan staan. Tijdens de montage is de toren in aanbouw een set botsingsobjecten (`towerStructureColliders`): mast en draaikrans zijn landbaar (daar zetten mastsecties en torenkop op), de tegengiek is landbaar voor de ballast, de giek niet. Delen met `hold` tellen als gemonteerd als ze binnen x/y/z- en hoektolerantie aan een belaste kabel stil hangen (snelheid < 0,12 m/s). Lasten roteren alleen in het xy-vlak; dat een giek van 58 m niet om de verticale as gaat draaien, staat voor de stuurlijnen (taglines) van de monteurs.

## Botsingen

- Obstakels: 3D-dozen (AABB) met een echte diepte per soort (zie `DEPTH_BY_KIND` in `missions/runtime/buildWorld.ts`; bv. gebouw 16 m, muur 6 m, kolom 1,2 m). Lasten: georiënteerde dozen (OBB) in 3D.
- Contacten (`physics/collision/contacts.ts`): oppervlaktepunten van de last (hoeken + randen, ≤ 0,5 m uit elkaar) in een obstakel of andere last, én randpunten van het obstakel in de last. De uitstootzijde volgt uit de vorige positie (instapzijde), maar alleen als die niet veel dieper ligt dan de ondiepste zijde. Voor randen van een obstakel kiest de solver de zijde waar de last werkelijk aan ligt (zoals een scheidende as), met de lokale diepte langs een straal door de last. Correcties zijn per punt en substap begrensd (4 cm).
- Wrijving en restitutie op snelheidsniveau (Müller e.a., XPBD): per contact een tangentiële tegenimpuls begrensd door μ maal de normaalkracht (μs 0,65 bij < 5 cm/s, μk 0,45), en de normaalsnelheid na een correctie wordt teruggezet naar maximaal 10 % van de inslagsnelheid. Daardoor liggen rustende lasten echt stil en vliegen lasten niet weg na een diepe correctie.
- Impactsnelheid bij nieuw contact → schade (landingslimiet per last, kwetsbaarheid) of botsing.
- Giek/armen (lijnsegmenten met dikte) tegen obstakels: een nieuwe botsing draait de beweging terug en telt als botsing.
- De eigen onderwagen (en torenmast) is een botsingsobject; het dek is landbaar (contragewichtplateau, laadvloer).
- Kabel door een obstakel wordt gedetecteerd (waarschuwing + schade); de kabel wikkelt niet om obstakels.
- Een last die vastzit (kabelrek > 0,25 m) blokkeert bewegingen die de kabel verder zouden oprekken.

## Stabiliteit (`physics/stability/stability.ts`)

Kantelmoment rond de kantellijn van het steunvlak in de richting van de last. Steunvlak = rechthoek (stempels, banden of rupsen); kantelafstand `e(φ) = min(a/|cos φ|, b/|sin φ|)`.

```
M_kantel = F_v·(R − e) + F_h·H_tip + m_giek·g·(r_giek − e) + M_helling + M_wind
M_stabiel = g·(m_onderwagen·e + m_bovenwagen·(e + r_b) + m_contragewicht·(e + r_cg)) · ondergrondfactor
K = M_kantel / M_stabiel      (K ≥ 1 → kantelen)
```

`F_v` en `F_h` komen uit de gemeten kabelkracht en de kabelhoek: een naar buiten slingerende last verhoogt het kantelmoment. Kantelen is nooit willekeurig: boven K = 1 bouwt kanteling op; voorbij 3° is het onomkeerbaar (missie mislukt). In het oefenprofiel staat kantelen uit.

## Lastdiagram en lastmomentbegrenzer (`cranes/models/capacity.ts`)

- Toegestane last = min(structurele grens, **75 % van de kantellast**) op de actuele straal, gieklengte, contragewicht, stempelstand en zwenkhoek. Op banden extra ×0,75 (niet voor rupsen). Kranen die niet op banden mogen hijsen: 0.
- Het lastdiagram in de planning wordt uit hetzelfde model gegenereerd (in lijn met de onderwagen), dus tabel en begrenzer zijn consistent.
- De begrenzer rekent met een snel gefilterd kabelkrachtsignaal (τ = 0,04 s, en de ruwe waarde) en **vergrendelt** bij ≥ 100 % tot de belasting onder 95 % zakt. Geblokkeerd: hijsen, straal vergroten, en zwenken naar een zone met minder capaciteit. Vieren, giek op en telescoop in blijven mogelijk.
- Waarschuwing vanaf 90 %. Realistisch profiel: > 110 % gedurende 1,5 s = mislukt.
- Ondergrond: de slechtste plek onder de steunpunten bepaalt de factor (modder 0,3–0,5, zand ~0,55, grind ~0,9). Kraanmatten (upgrade) +0,25.
- Helling (`slopeDeg`) zit in het kantelmodel maar níét in het lastdiagram, net als in werkelijkheid: de machinist moet zelf marge houden.

## Structurele grens

Telescoop/vakwerk: `maxT · (r_min/R)^p · (L_min/L)^q`. Toren- en knikarmkraan: momentgrens `min(maxT, M/R)`. Torenkranen zijn verankerd (geen kantelmodel); > 140 % = constructief falen.

## Wind

Deterministische vlagen (som van sinussen), optioneel wisselend van richting, met een dwarscomponent in z. Werkt op de last (per `Cd·A`) en als extra kantelmoment op de giek.

## Validatie

Elke missie wordt automatisch gecontroleerd op bereikbaarheid (bemonsterde kraanstanden) en capaciteit per kraanoptie en configuratie (`missions/validation/validateMission.ts`).
