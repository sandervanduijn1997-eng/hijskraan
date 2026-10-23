# Roadmap

## Status v0.1.0 (eerste release)

### Werkt en is getest

| Definitie van gereed | Status |
|---|---|
| 1. Schone installatie | ✅ `npm install` (5 dependencies) |
| 2. Ontwikkelserver | ✅ `npm run dev` |
| 3. Productiebuild | ✅ `npm run build` (typecheck + Vite) |
| 4. Speelbaar hoofdmenu | ✅ live demo-kraan op de achtergrond |
| 5. Minimaal één kraan volledig bestuurbaar | ✅ alle 10 kraanklassen bestuurbaar |
| 6. Kabel, haak en last reageren fysisch | ✅ XPBD, slingerperiode getest |
| 7. Missie voltooien met beloning | ✅ missie 1 door Playwright met het toetsenbord uitgespeeld |
| 8. Overige negen kraanklassen speelbaar | ✅ telescoop, vakwerk (met montage), toren (met zelfopbouw), knikarm, pick-and-carry |
| 9. 40 missies als data en valideerbaar | ✅ `validateMission` |
| 10. 40 missies met speelbare configuratie, doelen en voorwaarden | ✅ automatisch gevalideerd op bereik en lastdiagram; zie beperkingen |
| 11. Carrièrevoortgang en opslag | ✅ versiebeheer, validatie, migratie, reservekopie |
| 12. HUD en instellingen | ✅ incl. toetsen herdefiniëren, audio, camera, deeltjes |
| 13. Belangrijkste tests slagen | ✅ 115 unit/integratie + 8 e2e |
| 14. Geen bekende blokkerende fouten | ✅ geen bekend |
| 15. README met installatie en start | ✅ |

### Eerlijke beperkingen

- **Niet alle missies door een mens uitgespeeld.** Alle 40 zijn automatisch gecontroleerd (bereikbaarheid via bemonsterde kraanstanden, capaciteit per configuratie, startopstelling zonder overlap of schade). Missies 1 en 6 zijn headless volledig door de autopilot uitgevoerd en missie 1 via het toetsenbord in de browser. Balans (tijdslimieten, toleranties, wind) in de latere hoofdstukken heeft nog speeltesten nodig.
- **Gieren van lasten** wordt niet gesimuleerd (aanname: taglines). Rotatie alleen in het zijaanzicht.
- **Kabel** detecteert contact met obstakels, maar wikkelt er niet omheen en loopt niet over randen.
- **Obstakels** zijn rechthoeken (AABB) met een diepte; geen schuine of ronde vormen. Water (rivier/haven) is visueel; de bodem is vlak.
- **Torenkranen** zijn verankerd (geen kantelmodel, wel een structurele grens); er is geen weathervaning of wind-stopprocedure.
- **Referentiespecificaties** zijn afgeronde, publiek gecommuniceerde kopcijfers en niet geverifieerd tegen officiële lastdiagrammen. Alle lastdiagrammen zijn afgeleid uit het spelmodel.
- **Controller-ondersteuning** is architectonisch voorbereid (`InputManager.addAxisSource`), maar nog niet gebouwd.
- **Desktopdistributie** (Electron/Tauri) is nog niet ingericht.
- **Muziek** is een eenvoudige generatieve ambient-laag; geluiden zijn synthetisch.
- **Renderer**: zonder GPU-versnelling valt de game automatisch terug op Canvas (60 fps headless gemeten). Op een echte GPU is WebGL niet afzonderlijk geprofileerd.
- **Lokalisatie**: alleen Nederlands.

---

## v0.2 — Speeltest & balans (kort)

- Speeltestronde over alle 40 missies; tijdslimieten, toleranties en windwaarden afstellen op basis van gemeten tijden.
- Autopilot-integratietests uitbreiden naar elk kraantype (toren, knikarm, rups, pick-and-carry) en alle hoofdstukeinden.
- Missiehints per fase (contextueel, bijv. "laat eerst uitslingeren").
- Replay/ghost van de beste poging per missie (de simulatie is deterministisch, dus invoer opnemen volstaat).
- Prestatieprofilering op WebGL met echte GPU; culling van obstakels buiten beeld bij grote scènes.
- Toegankelijkheid: kleurenblindvriendelijke belastingbalken, schaalbare UI-tekst, volledig bedienbare menu's met toetsenbord.

## v0.3 — Besturing & presentatie

- **Gamepad/joystick** (Xbox/PlayStation, later twin-stick kraanstoel-layout) via de bestaande assenbron.
- Analoge besturing met instelbare gevoeligheid en dode zone; proportionele hydrauliek op analoge invoer.
- Cabineweergave (eerste persoon, vereenvoudigd) en een tweede camera boven de last.
- Dag-nachtcyclus binnen missies, onweer met verplichte stop (wind > limiet), werklampen.
- Rijkere geluiden: Doppler, dieseltypes per kraan, signaalgever via portofoon ("zakken… stop").

## v0.4 — Diepere simulatie

- Multi-fall-reeving met lieropwikkeling en kabeltrommel; tweede lier (hulphaak) voor kantelen van lasten.
- **Tandemhijs** met twee kranen (lastverdeling, synchronisatie, belasting per kraan).
- Lastgieren (yaw) met taglines als bedienbaar element.
- Kabel die over randen loopt en kan haken; kabelslijtage.
- Ondergrond met wegzakkende stempels (bodemdruk per stempel, kraanmatten als plaatsbaar object).
- Torenkraan: weathervaning (vrij zwenken bij storm), klimmen van de mast, verankering aan het gebouw.
- Luffing-jib-torenkraan en super-lift (derrick-mast) voor de heavy-lift rupskraan.
- Echte rijfysica voor rupsen en banden op hellingen; transport van kraanonderdelen per vrachtwagen.

## v0.5 — Bedrijf & carrière

- Bedrijfsmodus: offertes uitbrengen op opdrachten, planning van meerdere kranen per week, personeel (signaalgevers, riggers).
- Dynamische opdrachtengenerator (procedurele bouwplaatsen, op basis van de missiebouwstenen en de validator).
- Kraanmarkt (tweedehands, conditie, restwaarde), leningen, verzekering en boetes bij schade.
- Certificeringsexamens als aparte proeven met inspecteur.
- Prestaties/achievements en statistieken per kraan.

## v0.6 — Platformen & community

- Desktopbuilds via **Tauri** (klein, native venster, savebestanden in de gebruikersmap) of Electron.
- Steam-integratie (achievements, cloud saves) als er een publicatieroute komt.
- **Missie-editor** in de game: obstakels, zones en lasten plaatsen met live validatie; delen als JSON.
- Uitdagingen met online ranglijsten (alleen veilige, gevalideerde runs tellen).
- Lokalisatie: Engels en Duits als eerste extra talen (alle teksten zitten al in data/UI-modules).

## Lange termijn

- Volledige 3D-weergave (bijv. Three.js of Babylon.js) bovenop dezelfde simulatiekern — die is al 3D (x, y, z) en onafhankelijk van de renderer.
- VR-cabine.
- Multiplayer: kraanmachinist + signaalgever (spraak/handgebaren), of twee machinisten bij een tandemhijs.
- Educatieve modus voor opleidingen, met uitleg van lastdiagrammen en hijsplannen, en exporteerbare rapporten.

## Technische schuld / onderhoud

- `ui/app.ts` is groot; opsplitsen in afzonderlijke schermmodules (`ui/menus/*`) zodra er meer schermen bijkomen.
- Renderers delen veel tekenhelpers; een kleine scene-graph met dieptesortering zou de volgorde van kraandelen robuuster maken.
- Missiedata naar JSON-schema met runtime-validatie bij het laden (nodig voor de editor en mods).
