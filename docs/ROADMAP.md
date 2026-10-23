# Roadmap

De roadmap is een kritische greenlight-review vanuit een simulatiestudio, met werkpakketten om uit te kiezen: [docs/roadmap.html](roadmap.html).

## Oordeel (23 oktober 2026)

Nog geen greenlight voor productie. De rekenkern (stabiliteit, lastdiagram, deterministische simulatie, tests) is sterk, en het beeld is fors verbeterd. Maar het fundament past nog niet bij een geloofwaardige kraansimulator:

- lasten draaien maar om één as en botsingen zijn 2,5D;
- de bediening is digitaal, zonder controller of fijn doseren;
- de kabel is een dunne lijn;
- hydrauliek en motor zijn niet gemodelleerd;
- aanslaan is één toets;
- missies liggen op één lijn;
- geluid en weer zijn dun.

## Fasen

0. **Fundament** — 3D-lastfysica, 3D-botsingen, analoge besturing, hydrauliek, kabel met dikte.
1. **Vertical slice** — aanslaan als vaardigheid, signaalgever, nieuw geluid, dieptehulp, cabine-HUD, LMI-instelling, levende bouwplaats, hero-model, geregisseerde eerste hijs, speeltest met een echte machinist.
2. **Alpha** — doorbuiging van de giek, bodemdruk, missies herontworpen voor 3D, torenmontage één keer, economie, gevolgen, nabespreking.
3. **Beta** — alle kranen op hero-niveau, weer en nacht, tandemhijs, toegankelijkheid, Engels en Duits, kwaliteitsbewaking.
4. **Release en daarna** — Steam, open carrière, samen spelen, VR.

## Bekende beperkingen

- Niet alle missies door een mens uitgespeeld; haalbaarheid is automatisch gevalideerd en door de missiebot gecontroleerd.
- De missiebot loopt op Normaal vast bij het precies neerzetten met de torenkraan (servo slingert mee).
- Kraanmodellen zijn procedureel; de referentiewaarden zijn spelwaarden.
