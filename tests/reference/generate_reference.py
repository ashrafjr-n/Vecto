#!/usr/bin/env python3
"""
generate_reference.py — GOLD-STANDARD reference values for the JS analysis engine.

Loads each fixture CSV in tests/reference/datasets/, computes the statistics the
JS engine (src/components/utils/core/) is expected to match, and writes them to
tests/reference/expected.json.

------------------------------------------------------------------------------
AUDIT: exactly which pandas/scipy call each metric maps to, and the ddof/method.
------------------------------------------------------------------------------
Per numeric column (NaNs dropped first via Series.dropna()):

  mean      -> Series.mean()                         (arithmetic mean)
  median    -> Series.median()                       (50th pct, linear)
  min       -> Series.min()
  max       -> Series.max()
  variance  -> Series.var(ddof=1)                    SAMPLE variance (ddof=1)
  std       -> Series.std(ddof=1)                    SAMPLE std  (ddof=1, = sqrt(var))
  q1        -> numpy.percentile(x, 25, method="linear")   type-7 / numpy default
  q3        -> numpy.percentile(x, 75, method="linear")   type-7 / numpy default
              (pandas Series.quantile() default interpolation="linear" is identical)
  skewness  -> scipy.stats.skew(x, bias=False)
              => moment-based g1, BIAS-CORRECTED sample skewness
                 (multiplies g1 by sqrt(n(n-1))/(n-2))
  kurtosis  -> scipy.stats.kurtosis(x, bias=False, fisher=True)
              => EXCESS kurtosis (normal -> 0), BIAS-CORRECTED sample estimator

Correlations (clean_numeric.csv):
  pearson r -> DataFrame.corr(method="pearson")      pairwise Pearson r

Missing counts (missing_variants.csv):
  A cell is MISSING iff, after str.strip(), it is "" (covers empty string and
  whitespace-only) OR one of: NA, N/A, NaN, null, None, ?.
  The file is read with keep_default_na=False, dtype=str so pandas does NOT
  silently convert any of these tokens itself — we count them explicitly.
------------------------------------------------------------------------------
"""

import json
import os
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "datasets")
OUT = os.path.join(HERE, "expected.json")

# Tokens treated as missing (after stripping whitespace). "" also catches
# whitespace-only cells because we strip first.
MISSING_TOKENS = {"", "NA", "N/A", "NaN", "null", "None", "?"}


def is_missing(cell: str) -> bool:
    return cell.strip() in MISSING_TOKENS


def numeric_column_stats(series: pd.Series) -> dict:
    """Gold-standard stats for one numeric column (NaNs dropped)."""
    x = series.dropna().to_numpy(dtype=float)
    n = int(x.size)
    return {
        "n": n,
        "mean": float(np.mean(x)),
        "median": float(np.median(x)),
        "min": float(np.min(x)),
        "max": float(np.max(x)),
        "variance": float(pd.Series(x).var(ddof=1)),        # sample, ddof=1
        "std": float(pd.Series(x).std(ddof=1)),             # sample, ddof=1
        "q1": float(np.percentile(x, 25, method="linear")), # type-7
        "q3": float(np.percentile(x, 75, method="linear")), # type-7
        "skewness": float(stats.skew(x, bias=False)),        # bias-corrected g1
        "kurtosis": float(stats.kurtosis(x, bias=False, fisher=True)),  # excess
    }


def numeric_stats_for_file(path: str) -> dict:
    df = pd.read_csv(path)
    num = df.select_dtypes(include=[np.number])
    return {col: numeric_column_stats(num[col]) for col in num.columns}


def missing_counts_for_file(path: str) -> dict:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    return {
        col: int(df[col].map(is_missing).sum())
        for col in df.columns
    }


# Declared design intent for roles_missing.csv — the role the JS engine SHOULD
# assign to each column once missing tokens are stripped. This is a fixture-author
# expectation (not something pandas computes), asserted by the later role test.
ROLES_MISSING_EXPECTED_ROLE = {
    "bin_col": "binary",
    "cat_col": "categorical",
    "num_col": "numeric",
    "id_col": "identifier",
}


def _is_numeric_token(cell: str) -> bool:
    """True iff a non-missing cell parses as a finite number."""
    try:
        float(cell)
        return True
    except ValueError:
        return False


def roles_missing_reference(path: str) -> dict:
    """Per-column gold numbers for roles_missing.csv, read as raw strings so the
    missing tokens are visible (keep_default_na=False, dtype=str).

    missing_count / true_distinct / numeric_count are COMPUTED from the CSV.
    numeric_count is only recorded for the numeric-role column (null elsewhere,
    where a numeric parse count is not the relevant signal). expected_role is the
    INTENDED design label, hardcoded in ROLES_MISSING_EXPECTED_ROLE."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    out = {}
    for col in df.columns:
        cells = df[col].tolist()
        present = [c for c in cells if not is_missing(c)]  # non-missing raw values
        role = ROLES_MISSING_EXPECTED_ROLE[col]
        numeric_count = (
            int(sum(_is_numeric_token(c) for c in present))
            if role == "numeric" else None
        )
        out[col] = {
            "missing_count": int(sum(is_missing(c) for c in cells)),
            "true_distinct": len(set(present)),                 # distinct non-missing
            "numeric_count": numeric_count,
            "expected_role": role,                              # INTENDED (not computed)
        }
    return out


def correlations_for_file(path: str) -> dict:
    df = pd.read_csv(path)
    num = df.select_dtypes(include=[np.number])
    corr = num.corr(method="pearson")
    out = {}
    for a, b in combinations(num.columns, 2):
        out[f"{a}__{b}"] = float(corr.loc[a, b])
    return out


def eta_correlation(values, labels):
    """Correlation ratio η between a numeric array and its category labels.
      η² = SS_between / SS_total
      SS_between = Σ_g n_g (mean_g − mean_overall)²
      SS_total   = Σ_i (x_i − mean_overall)²
      η = sqrt(η²), range [0, 1].
    values/labels are already paired & missing-free."""
    values = np.asarray(values, dtype=float)
    grand = values.mean()
    ss_total = float(((values - grand) ** 2).sum())
    if ss_total == 0:
        return 0.0
    ss_between = 0.0
    for g in set(labels):
        gv = values[[lab == g for lab in labels]]
        if gv.size == 0:
            continue
        ss_between += gv.size * (gv.mean() - grand) ** 2
    eta_sq = ss_between / ss_total
    return float(np.sqrt(eta_sq))


def eta_numeric_cat_reference(path: str):
    """η of each numeric column vs the categorical 'grp', excluding missing on
    BOTH sides. Labels normalized (lower+strip) to match the JS engine grouping.
    Returns (etas dict, group_means dict) for eyeballing."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    etas, group_means = {}, {}
    for col in ("val", "noise"):
        pairs = []
        for raw_lab, raw_val in zip(df["grp"], df[col]):
            if is_missing(raw_lab) or is_missing(raw_val):
                continue
            pairs.append((raw_lab.strip().lower(), float(raw_val)))
        labels = [p[0] for p in pairs]
        values = [p[1] for p in pairs]
        etas[col] = eta_correlation(values, labels)
        gm = {}
        for lab in sorted(set(labels)):
            gv = [v for l, v in pairs if l == lab]
            gm[lab] = {"n": len(gv), "mean": round(float(np.mean(gv)), 4)}
        group_means[col] = gm
    return etas, group_means


def monotonic_reference(path: str) -> dict:
    """Stage 7 — Spearman, and the p-values that make a coefficient reportable.

      pearson_r / pearson_p -> scipy.stats.pearsonr(...)  (two-sided)
      spearman_rho          -> scipy.stats.spearmanr(...) (average ranks on ties)
      chi2_sf               -> scipy.stats.chi2.sf(chi2, df)

    The point of the fixture is the `exponential` column: perfectly monotonic in
    x and strongly non-linear, so Pearson understates it while Spearman does not.
    """
    df = pd.read_csv(path)
    pairs = [("x", "linear"), ("x", "exponential"), ("x", "noise"),
             ("linear", "exponential"), ("linear", "noise")]
    out = {"pairs": {}, "chi2_sf": {}}
    for a, b in pairs:
        pr = stats.pearsonr(df[a], df[b])
        sr = stats.spearmanr(df[a], df[b])
        out["pairs"][f"{a}|{b}"] = {
            "pearson_r":    float(pr.statistic),
            "pearson_p":    float(pr.pvalue),
            "spearman_rho": float(sr.statistic),
            "n":            int(len(df)),
        }
    # chi-square upper tail, across a spread of statistics and dof
    for chi2 in (0.5, 3.84, 10.0, 50.0):
        for dof in (1, 2, 5, 20):
            out["chi2_sf"][f"{chi2}|{dof}"] = float(stats.chi2.sf(chi2, dof))
    return out


def medcouple(x) -> float:
    """Medcouple (Brys, Hubert & Struyf 2004) — the robust skewness the adjusted
    boxplot is built on. A numpy transcription of statsmodels'
    stattools._medcouple_1d (statsmodels is not a dependency here), including its
    kernel for pairs tied AT the median: -1 above the anti-diagonal, 0 on it, +1
    below. Exact O(n^2); every fixture column is far below the JS sampling cap."""
    y = np.sort(np.asarray(x, dtype=float))
    n = y.shape[0]
    mf = (y[n // 2 - 1] + y[n // 2]) / 2 if n % 2 == 0 else y[(n - 1) // 2]
    z = y - mf
    lower = z[z <= 0.0]
    upper = z[z >= 0.0][:, None]
    standardization = upper - lower
    is_zero = np.logical_and(lower == 0.0, upper == 0.0)
    standardization[is_zero] = np.inf
    h = (upper + lower) / standardization
    num_ties = int(np.sum(lower == 0.0))
    if num_ties:
        replacements = np.ones((num_ties, num_ties)) - np.eye(num_ties)
        replacements -= 2 * np.triu(replacements)
        h[:num_ties, -num_ties:] = np.fliplr(replacements)
    return float(np.median(h))


def outliers_reference(path: str) -> dict:
    """Skew-adjusted boxplot fences (Hubert & Vandervieren 2008):
         MC >= 0: [Q1 - 1.5 e^(-4 MC) IQR,  Q3 + 1.5 e^(3 MC) IQR]
         MC <  0: [Q1 - 1.5 e^(-3 MC) IQR,  Q3 + 1.5 e^(4 MC) IQR]
    Quartiles are numpy linear (type 7), as everywhere else in this harness.
    outlier_count counts values strictly outside the fences."""
    df = pd.read_csv(path)
    out = {}
    for col in df.columns:
        x = df[col].dropna().to_numpy(dtype=float)
        q1, q3 = np.percentile(x, 25), np.percentile(x, 75)
        iqr = q3 - q1
        mc = medcouple(x)
        if mc >= 0:
            lo, hi = q1 - 1.5 * np.exp(-4 * mc) * iqr, q3 + 1.5 * np.exp(3 * mc) * iqr
        else:
            lo, hi = q1 - 1.5 * np.exp(-3 * mc) * iqr, q3 + 1.5 * np.exp(4 * mc) * iqr
        out[col] = {
            "medcouple": mc,
            "lower_fence": float(lo),
            "upper_fence": float(hi),
            "outlier_count": int(np.sum((x < lo) | (x > hi))),
            "tukey_outlier_count": int(np.sum((x < q1 - 1.5 * iqr) | (x > q3 + 1.5 * iqr))),
        }
    return out


def rank_eta_reference(path: str) -> dict:
    """Rank-based η (stage 10e): Kruskal-Wallis H with scipy's tie correction, its
    chi-square p-value, and the bias-corrected effect size η²_H = (H - k + 1)/(n - k)
    (Tomczak & Tomczak 2014), reported as sqrt(max(0, η²_H)) on η's 0-1 scale."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    out = {}
    for g in ("grp", "many"):
        for v in ("val", "noise"):
            labels = df[g].str.strip().str.lower()
            values = df[v].astype(float)
            groups = [values[labels == lab].to_numpy() for lab in sorted(labels.unique())]
            H, p = stats.kruskal(*groups)
            n, k = len(values), len(groups)
            out[f"{g}|{v}"] = {"H": float(H), "p": float(p), "n": n, "k": k,
                               "rank_eta": float(np.sqrt(max(0.0, (H - k + 1) / (n - k)))),
                               "raw_eta": eta_correlation(values.tolist(), labels.tolist())}
    return out


def odds_ratio_reference(path: str) -> dict:
    """Odds ratio for a rare binary feature against a binary outcome (item 27):
    the sample OR, its Wald 95% interval on the log scale, and lift.

    Haldane-Anscombe: 0.5 is added to every cell ONLY when some cell is zero —
    unconditional correction would shrink every estimate toward 1. statsmodels
    (Table2x2) would give the same numbers but is deliberately not installed, so
    this is written out from the definitions, as the medcouple reference is."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    y = df["outcome"].astype(int).to_numpy()
    out = {}
    for col in df.columns:
        if col == "outcome":
            continue
        x = df[col].astype(int).to_numpy()
        a = int(((x == 1) & (y == 1)).sum())
        b = int(((x == 1) & (y == 0)).sum())
        c = int(((x == 0) & (y == 1)).sum())
        d = int(((x == 0) & (y == 0)).sum())
        corrected = 0 in (a, b, c, d)
        k = 0.5 if corrected else 0.0
        A, B, C, D = a + k, b + k, c + k, d + k
        orv = (A * D) / (B * C)
        se = np.sqrt(1 / A + 1 / B + 1 / C + 1 / D)
        z = 1.959963984540054
        n = a + b + c + d
        base = (a + c) / n
        out[col] = {
            "a": a, "b": b, "c": c, "d": d,
            "corrected": bool(corrected),
            "odds_ratio": float(orv),
            "ci_low": float(np.exp(np.log(orv) - z * se)),
            "ci_high": float(np.exp(np.log(orv) + z * se)),
            "lift": float((a / (a + b)) / base),
            "n": n,
            "exposed_rows": a + b,
            "minority_share": float(min(a + b, c + d) / n),
        }
    return out


def main():
    expected = {}

    # odds_ratio.csv — odds ratio, Wald CI and lift for rare binary features (item 27)
    expected["odds_ratio"] = {"columns": odds_ratio_reference(os.path.join(DATA, "odds_ratio.csv"))}

    # rank_eta.csv — Kruskal-Wallis H / p and the rank-based η (stage 10e)
    expected["rank_eta"] = {"pairs": rank_eta_reference(os.path.join(DATA, "rank_eta.csv"))}

    # outliers.csv — medcouple and the skew-adjusted fences (stage 10d)
    expected["outliers"] = {"columns": outliers_reference(os.path.join(DATA, "outliers.csv"))}

    # a. clean_numeric.csv — numeric stats + all pairwise Pearson r
    expected["clean_numeric"] = {
        "columns": numeric_stats_for_file(os.path.join(DATA, "clean_numeric.csv")),
        "correlations": correlations_for_file(os.path.join(DATA, "clean_numeric.csv")),
    }

    # b. missing_variants.csv — per-column missing counts
    expected["missing_variants"] = {
        "missing_counts": missing_counts_for_file(
            os.path.join(DATA, "missing_variants.csv")
        ),
    }

    # c. mixed_types.csv — numeric stats (measurement, record_id, flag)
    expected["mixed_types"] = {
        "columns": numeric_stats_for_file(os.path.join(DATA, "mixed_types.csv")),
    }

    # d. skew_kurt.csv — numeric stats (skew/kurtosis are the point of interest)
    expected["skew_kurt"] = {
        "columns": numeric_stats_for_file(os.path.join(DATA, "skew_kurt.csv")),
    }

    # f. eta_numeric_cat.csv — correlation ratio η, numeric feature vs categorical 'grp'
    eta_vals, eta_group_means = eta_numeric_cat_reference(
        os.path.join(DATA, "eta_numeric_cat.csv")
    )
    expected["eta_numeric_cat"] = {
        "_note": "η (correlation ratio) of each numeric col vs categorical 'grp', "
                 "missing excluded on both sides, labels lower+stripped. COMPUTED.",
        "eta":         eta_vals,
        "group_means": eta_group_means,
    }

    # e. roles_missing.csv — role-detection targets w/ missing tokens in typed cols
    expected["roles_missing"] = {
        "_note": (
            "missing_count, true_distinct, numeric_count are COMPUTED by "
            "pandas/scipy (objective reference). expected_role is INTENDED by "
            "fixture design (what detectColumnRoles SHOULD output) — it is "
            "asserted, not computed."
        ),
        "columns": roles_missing_reference(os.path.join(DATA, "roles_missing.csv")),
    }

    # g. monotonic.csv — stage 7: Spearman vs Pearson, and p-values
    expected["monotonic"] = {
        "_note": "Spearman rho, Pearson r and their two-sided p-values, plus "
                 "chi2 survival-function values. All COMPUTED by scipy.",
        **monotonic_reference(os.path.join(DATA, "monotonic.csv")),
    }

    with open(OUT, "w") as f:
        json.dump(expected, f, indent=2, sort_keys=True)
        f.write("\n")

    # ---- human-readable summary ----
    print(f"Reference written to {OUT}\n")
    print(f"pandas {pd.__version__} | numpy {np.__version__} | scipy {stats.__name__ and __import__('scipy').__version__}\n")

    def print_cols(name, cols):
        print(f"[{name}]")
        for col, m in cols.items():
            print(
                f"  {col:<12} n={m['n']:<3} mean={m['mean']:.4f} "
                f"std={m['std']:.4f} var={m['variance']:.4f} "
                f"median={m['median']:.4f} Q1={m['q1']:.4f} Q3={m['q3']:.4f} "
                f"skew={m['skewness']:.4f} kurt={m['kurtosis']:.4f}"
            )

    print_cols("clean_numeric", expected["clean_numeric"]["columns"])
    print("  correlations:")
    for k, v in expected["clean_numeric"]["correlations"].items():
        print(f"    {k:<16} r={v:.6f}")
    print()

    print("[missing_variants] missing counts per column:")
    for col, c in expected["missing_variants"]["missing_counts"].items():
        print(f"  {col:<8} = {c}")
    print()

    print_cols("mixed_types", expected["mixed_types"]["columns"])
    print()
    print_cols("skew_kurt", expected["skew_kurt"]["columns"])
    print()

    print("[roles_missing] role-detection targets (missing tokens in typed cols):")
    for col, m in expected["roles_missing"]["columns"].items():
        print(
            f"  {col:<8} missing={m['missing_count']} "
            f"true_distinct={m['true_distinct']} numeric_count={m['numeric_count']} "
            f"expected_role={m['expected_role']}"
        )
    print()

    print("[eta_numeric_cat] correlation ratio η vs categorical 'grp':")
    for col in ("val", "noise"):
        print(f"  {col:<6} η = {expected['eta_numeric_cat']['eta'][col]:.6f}")
        gm = expected["eta_numeric_cat"]["group_means"][col]
        means_str = ", ".join(f"{g}(n={d['n']})={d['mean']}" for g, d in gm.items())
        print(f"         group means: {means_str}")


if __name__ == "__main__":
    main()
