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

Positie (3D), hoek (in het xy-vlak), massa en traagheidsmoment `I = m(w²+h²)/12 + m·e²`. Rotatie volgt uit de gegeneraliseerde inverse massa `w = 1/m + (r×n)²/I` bij kabel- en contactcorrecties: lange lasten kantelen bij een stoot aan één kant, brede panelen vangen meer wind (`Cd·A` per lasttype). Gieren (rotatie om de verticale as) wordt niet gesimuleerd: aangenomen wordt dat de last met geleidelijnen (taglines) in het vlak wordt gehouden.

## Slingerbeweging

Volgt volledig uit de fysica (geen animatie): traagheid, versnellen/stoppen van giek/loopkat, draaien (de tip beweegt dan ook in `z`), kabellengte (`T = 2π√(L/g)`, getest), massa en wind. Demping per moeilijkheidsgraad (`swayDamping`: oefenen 0,45, normaal 0,08, realistisch 0,02 /s) werkt alleen op de beweging **relatief** t.o.v. het ophangpunt. De HUD toont slingerhoek en verwachte richting.

## Kinematica (`cranes/models/kinematics.ts`)

- **Telescoop/vakwerk**: `tip_u = pivot_u + L·cos θ`, `tip_y = pivot_h + L·sin θ`; optionele hulpgiek met offsethoek.
- **Torenkraan**: tip op loopkatstraal onder de giek; zelfopbouw animeert masthoek en gieksvouw.
- **Knikarm**: keten kolom → hoofdarm (`a1`) → knikarm (`a1+a2`) + telescoop.
- Draaien: wereld `x = draaias + u·cos φ`, `z = u·sin φ`.
- Kanteling roteert de hele kraan om de voorste kantellijn.

## Botsingen

- Obstakels: AABB's in xy met een z-bereik. Lasten: georiënteerde dozen.
- Contacten: hoekpunten van de last in een obstakel én hoekpunten van het obstakel in de last (zodat een balk op twee smalle steunpunten kan rusten). De entry-rand wordt bepaald uit de vorige positie, waardoor een last niet door dunne platen schiet.
- Zijwaarts (in z) een obstakel in zwenken wordt in z teruggeduwd.
- Wrijving: XPBD statisch/dynamisch (μs 0,65, μk 0,45).
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
