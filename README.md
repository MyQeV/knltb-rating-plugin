# KNLTB Rating Inline

Chrome-/Brave-extensie die de KNLTB **enkel- en dubbelrating** direct achter spelersnamen
zet op `mijnknltb.toernooi.nl` — zodat je niet meer per speler hoeft door te klikken.

> Onofficieel hobbyproject. Niet gelieerd aan, of goedgekeurd door, de KNLTB of
> Tournament Software. De extensie leest alleen pagina's die je zelf al kunt zien
> als je bent ingelogd; er wordt niets naar een externe server gestuurd.

## Installeren (Brave én Chrome, zelfde stappen)

1. Download `knltb-rating.zip` van de [laatste release](https://github.com/MyQeV/knltb-rating-plugin/releases/latest)
   en pak die uit naar een map die je laat staan (bv. `C:\Users\<jij>\extensies\knltb-rating`).
2. Ga naar `brave://extensions` (of `chrome://extensions`).
3. Zet rechtsboven **Developer mode / Ontwikkelaarsmodus** aan.
4. Klik **Load unpacked / Uitgepakte extensie laden** en kies de uitgepakte map.
5. Open een toernooipagina op `mijnknltb.toernooi.nl` waar spelersnamen op staan.

## Over de login

Je hoeft nergens een wachtwoord in te vullen. De extensie draait *in jouw browser* en haalt
de profielpagina's op met `fetch(..., {credentials: "include"})`. Daardoor gaat je bestaande
sessiecookie automatisch mee — precies alsof je zelf op de link klikt. Zolang jij ingelogd
bent op mijnknltb, werkt de extensie. Ben je uitgelogd, dan toont de badge `login`.

## Wat je ziet

Achter elke spelersnaam komt een badge: `E 6,31 · D 5,87`
(E = enkel, D = dubbel). Hover erover voor details.

- grijs `…` = bezig met ophalen
- geel = rating geraden (labels niet herkend) — check even of het klopt
- rood `–` = geen rating gevonden op het profiel
- rood `login` = je bent niet ingelogd

## Instellingen

Klik op het extensie-icoon: aan/uit, enkel/dubbel tonen, max. spelers per pagina,
cacheduur (standaard 7 dagen), cache legen, pagina opnieuw scannen.

## Ontwikkelen

```
npm install
npm test
```

De tests draaien in Node met jsdom tegen vaste stukjes HTML van de site; er is geen
login voor nodig. Alleen `layout.test.js` meet in een echte browser en heeft daarvoor
`playwright` met een Chromium nodig — zonder die wordt hij overgeslagen.

Namen, clubs en nummers van andere spelers in de testdata zijn verzonnen; alleen de
auteur staat er met eigen gegevens in.

`npm run pack` maakt `knltb-rating.zip` uit de laatste commit — dat bestand hoort bij
een [release](https://github.com/MyQeV/knltb-rating-plugin/releases), niet in de repo.

## Problemen melden

Open een [issue](https://github.com/MyQeV/knltb-rating-plugin/issues). De knop
**Diagnose** in de popup verzamelt wat er op de pagina gevonden is; die uitvoer bevat
spelersnamen en je eigen profiel-id, dus haal weg wat je niet wilt delen.

## Nog te doen

- head-to-head calculator: twee spelers kiezen en de nieuwe rating berekenen
  (KNLTB publiceert de formule niet; die moeten we afleiden of overnemen van
  de officiële rekentool)

## Licentie

[MIT](LICENSE)
