/* Dynamisch Speelsterkte Systeem (DSS) — de rekenregels van de KNLTB.
 *
 * Bron: "DSS uitgebreide uitleg", tennis.nl
 *   winstkans : P = 1 / (1 + e^(q · (R_eigen − R_tegenstander)))
 *   mutatie   : ΔR = K · (P − uitslag)          uitslag: 1 = winst, 0 = verlies
 *   dubbel    : teamrating = Θ · R1 + Θ · R2, beide partners krijgen ΔR
 *
 * Let op: een LAGERE rating is sterker. Winst levert dus een negatieve
 * mutatie op — je zakt richting de 1.
 *
 * Gecontroleerd tegen het rekenvoorbeeld uit de PDF:
 *   Victor 6,0000 wint van Pieter 6,5000
 *   -> P = 0,7134 ; Victor 5,9212 ; Pieter 6,5788   (PDF: 0,71 / 5,9210 / 6,5790)
 */

const DSS = (() => {
  "use strict";

  const Q_SINGLE = 1.824;
  const Q_DOUBLE = 2.012;
  const K = 0.275; // grootst mogelijke mutatie
  const THETA = 0.5; // gewicht per partner in het dubbel

  /** Kans dat de speler/het team met rating `self` wint van `opp`. */
  function winProb(self, opp, q) {
    return 1 / (1 + Math.exp(q * (self - opp)));
  }

  /** Teamrating: enkel = de speler zelf, dubbel = het gemiddelde. */
  function teamRating(ratings) {
    if (ratings.length === 1) return ratings[0];
    return THETA * ratings[0] + THETA * ratings[1];
  }

  /**
   * Rekent een wedstrijd door.
   * @param {number[]} teamA 1 of 2 ratings
   * @param {number[]} teamB 1 of 2 ratings
   * @returns winstkansen en de mutatie per uitkomst, per kant.
   *          Elke speler in een team krijgt dezelfde mutatie.
   */
  function match(teamA, teamB) {
    const isDouble = teamA.length > 1 || teamB.length > 1;
    const q = isDouble ? Q_DOUBLE : Q_SINGLE;

    const ra = teamRating(teamA);
    const rb = teamRating(teamB);

    const pa = winProb(ra, rb, q);
    const pb = 1 - pa;

    return {
      isDouble,
      q,
      ratingA: ra,
      ratingB: rb,
      a: { prob: pa, onWin: K * (pa - 1), onLoss: K * pa },
      b: { prob: pb, onWin: K * (pb - 1), onLoss: K * pb },
    };
  }

  return {
    Q_SINGLE, Q_DOUBLE, K, THETA,
    winProb, teamRating, match,
  };
})();

if (typeof module !== "undefined") module.exports = DSS;
