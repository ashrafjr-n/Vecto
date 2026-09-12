/* Correlation is polarity (-1..+1 around a neutral 0) — a diverging color job per
   the dataviz skill: two hues + a neutral midpoint, equal steps per arm. Negative
   = info blue, positive = gold (a data-encoding use of gold, distinct from its
   sparse-UI-accent role elsewhere — see frontend.md "Correlation heatmap").

   These are the DARK steps, selected for the night surface rather than flipped
   from the light ones (the dataviz skill's rule: dark mode is chosen, not
   inverted). /analyze is entirely in the `.night` scope, so the old light ramp
   had no remaining caller and was deleted rather than kept in sync.

   Direction matters and is the reason a flip would have been wrong: on white the
   weak end is the PALEST step, on near-black it is the DARKEST. Weak correlation
   must recede toward the surface in both, which means the arms climb in opposite
   directions. Verified per arm with the skill's `validateOrdinal` against the
   panel surface #13161A — lightness monotone, every adjacent ΔL >= 0.06, hue
   spread <= 8° per arm.

   `validateOrdinal`'s fourth check — the pale end clearing 2:1 against the
   surface — FAILS here by design, at 1.45:1 (gold) and 1.30:1 (blue). Lifting
   band 0 to clear it would make "almost no correlation" one of the loudest cells
   on screen, and the shipped light ramp took the same decision (#EAF2FA is
   1.08:1 on white). The mitigation is the one the marks spec asks for: the
   heatmap separates every cell with a surface gap (`mx-0.5` + `mt-1` in
   RelationshipsTab), so a cell reads as a mark from its boundary and does not
   depend on its fill to be seen. Keep that gap if you touch the grid. */
const NEGATIVE = ["#1E2D40", "#27415E", "#38618F", "#4987BF", "#7DB2E3"];
const POSITIVE = ["#3B3321", "#5A4C2A", "#786530", "#B49849", "#DDC36D"];
const NEUTRAL  = "#2A2F37"; // a true near-zero reads as neither arm — gray, not band 0

/* Text color per band, each verified >=4.5:1 (WCAG AA normal text) against its
   own fill via the dataviz skill's contrast() checker. Worst case is 5.11:1
   (gold band 2); every other band clears 5.2:1.

   Both arms cross to dark text at band 3 — unlike the light ramp, where they
   crossed at different bands and that asymmetry needed explaining. It is not a
   copy-paste symmetry: the two arms were measured separately and happen to agree
   here. Don't collapse this to a single abs-value cutoff; re-measure if a fill
   changes. */
const INK   = "#F2F3F5"; // --color-ink in the night scope
const PAPER = "#08090C"; // --color-paper in the night scope
const NEGATIVE_TEXT = [INK, INK, INK, PAPER, PAPER];
const POSITIVE_TEXT = [INK, INK, INK, PAPER, PAPER];

function band(abs) {
  return abs < 0.2 ? 0 : abs < 0.4 ? 1 : abs < 0.6 ? 2 : abs < 0.8 ? 3 : 4;
}

export function correlationFill(r) {
  const abs = Math.abs(r);
  if (abs < 0.05) return NEUTRAL;
  return (r > 0 ? POSITIVE : NEGATIVE)[band(abs)];
}

export function correlationText(r) {
  const abs = Math.abs(r);
  if (abs < 0.05) return INK;
  return (r > 0 ? POSITIVE_TEXT : NEGATIVE_TEXT)[band(abs)];
}
