import {
  getNumericValues,
  mean, medianSorted, stdDev, quantileSorted,
  skewness as computeSkewness, kurtosis as computeKurtosis,
  buildHistogram, valueFrequencies,
} from "../helpers.js";

export function getStatistics(data, numericCols) {
  return numericCols.map(col => {
    const vals = getNumericValues(data, col);
    if (!vals.length) return { col, empty: true };

    // Sorted ONCE. q1, q3, the median, the min and the max all read from it.
    const sorted = [...vals].sort((a, b) => a - b);
    const q1     = quantileSorted(sorted, 0.25);
    const q3     = quantileSorted(sorted, 0.75);
    const iqr    = q3 - q1;
    const m      = mean(vals);
    const med    = medianSorted(sorted);
    const std    = stdDev(vals);

    // FIX #2: real bias-corrected moment skewness + excess kurtosis (scipy-matching)
    const skewness = Math.round(computeSkewness(vals) * 100) / 100;
    const kurtosis = Math.round(computeKurtosis(vals) * 100) / 100;
    const absSkew  = Math.abs(skewness);
    const skewnessLabel =
      absSkew < 0.5 ? "Symmetric" :
      absSkew <= 1  ? "Moderate"  : "High";

    const lowerFence  = q1 - 1.5 * iqr;
    const upperFence  = q3 + 1.5 * iqr;

    // FIX #4: Skip IQR outlier detection for discrete/count features.
    // When unique values ≤ 10, IQR classifies a huge fraction as "outliers"
    // because the distribution is heavily concentrated at a few integers.
    const uniqueVals  = [...new Set(vals)];
    const isDiscrete  = uniqueVals.length <= 10;
    const outliers    = isDiscrete
      ? []
      : vals.filter(v => v < lowerFence || v > upperFence);

    const min     = sorted[0];
    const max     = sorted[sorted.length - 1];

    // FIX P7: use shared buildHistogram helper
    const bins = buildHistogram(vals);

    return {
      col,
      mean:         Math.round(m * 100) / 100,
      median:       Math.round(med * 100) / 100,
      min:          Math.round(min * 100) / 100,
      max:          Math.round(max * 100) / 100,
      std:          Math.round(std * 100) / 100,
      q1:           Math.round(q1 * 100) / 100,
      q3:           Math.round(q3 * 100) / 100,
      iqr:          Math.round(iqr * 100) / 100,
      skewness,
      kurtosis,
      skewnessLabel,
      outlierCount: outliers.length,
      lowerFence:   Math.round(lowerFence * 100) / 100,
      upperFence:   Math.round(upperFence * 100) / 100,
      count:        vals.length,
      histogram:    bins,
      isConstant:   min === max,
    };
  });
}

/* ══════════════════════════════════════════
   VISUALIZATIONS
   FIX #5: Same constant column guard
══════════════════════════════════════════ */
export function getVisualizations(data, columns, numericCols, categoricalCols, statistics = []) {
  const result = [];

  /* The numeric branch used to recompute, field for field, everything
     getStatistics had just produced for the same columns: another
     getNumericValues() array, another three sorts through quantile()/median(),
     another buildHistogram(), another Set of the values, another skewness pass.
     Two implementations of one calculation, 5.2s of the 35s on a 386k-row file,
     and free to disagree — getStatistics labelled skew from a rounded value while
     this branch labelled it from an unrounded one, so the Statistics tab and the
     Visualizations tab could describe the same column differently.

     It reads the statistics rows now. Nothing here is measured twice. */
  const statByCol = new Map(statistics.map(s => [s.col, s]));

  numericCols.forEach(col => {
    const stat = statByCol.get(col);
    if (!stat || stat.empty) return;

    const skewLabel =
      stat.isConstant       ? "constant — all values are identical" :
      stat.skewness >  0.5  ? "right-skewed (tail toward higher values)" :
      stat.skewness < -0.5  ? "left-skewed (tail toward lower values)" :
                              "approximately symmetric";

    result.push({
      col,
      type:       "numeric",
      histogram:  stat.histogram,
      isConstant: stat.isConstant,
      boxplot: {
        min:          stat.min,
        max:          stat.max,
        q1:           stat.q1,
        q3:           stat.q3,
        median:       stat.median,
        lowerFence:   stat.lowerFence,
        upperFence:   stat.upperFence,
        outlierCount: stat.outlierCount,
      },
      insight: `Distribution is ${skewLabel}.${stat.outlierCount > 0 ? ` ${stat.outlierCount} outlier${stat.outlierCount > 1 ? "s" : ""} detected.` : " No outliers detected."}`,
    });
  });

  categoricalCols.forEach(col => {
    // Grouped by the canonical key, labelled with an original spelling, missing
    // tokens excluded (FIX Group B) — one shared rule, in valueFrequencies().
    const levels      = valueFrequencies(data, col);
    const total       = levels.reduce((sum, l) => sum + l.count, 0);
    const uniqueCount = levels.length;
    const sorted      = levels.slice(0, 10).map(({ value, count }) => ({
      value,
      count,
      pct: Math.round((count / total) * 1000) / 10,
    }));

    const topValue = sorted[0];
    const insight  = topValue
      ? `"${topValue.value}" is the most frequent value at ${topValue.pct}%. ${uniqueCount} unique categories total.`
      : "No data available.";

    /* uniqueCount and the top level's share are FIELDS now, not just words in a
       sentence. Type-aware advice has to know how many levels a column has and
       whether any of them is common — parsing that back out of `insight` would
       be absurd. */
    result.push({
      col, type: "categorical", data: sorted, uniqueCount,
      topPct: topValue?.pct ?? 0,
      insight,
    });
  });

  return result;
}