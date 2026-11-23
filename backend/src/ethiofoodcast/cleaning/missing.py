"""Missing-data policy.

The rule this module exists to enforce: **"does not apply", "genuine zero" and
"did not answer" are three different facts and must stay distinguishable.**

    | Case                          | Value            | Flags                        |
    |-------------------------------|------------------|------------------------------|
    | Non-agricultural household    | 0 / neutral      | has_<block>_data = 0         |
    | Farmer reporting a real zero  | 0                | has_<block>_data = 1         |
    | Farmer who did not answer     | imputed in-fold  | has_<block>_data = 1,        |
    |                               |                  | <col>_was_missing = 1        |

Collapsing these into a single NaN would teach the model about *who was asked
which questions* rather than about food insecurity, which is the exact shortcut
the wide-training design has to guard against.
"""

from __future__ import annotations

import pandas as pd

NOT_APPLICABLE = "Not applicable"  # the question was never put to this household
UNKNOWN = "Unknown"  # it was asked, and not answered


def add_block_availability(
    frame: pd.DataFrame, block: str, available: pd.Series
) -> pd.DataFrame:
    """Add ``has_<block>_data``, marking whom the block's questions applied to."""
    out = frame.copy()
    out[f"has_{block}_data"] = available.astype(int)
    return out


def encode_structural(
    frame: pd.DataFrame,
    columns: list[str],
    applies: pd.Series,
    *,
    block: str,
    fill_value: float = 0.0,
) -> pd.DataFrame:
    """Fill structurally-absent numeric cells and flag genuine non-response.

    ``applies`` is True for households the block's questions were put to. For
    everyone else the value is structurally absent, filled with `fill_value`,
    and identified by ``has_<block>_data == 0`` rather than by a null.

    Within the households it does apply to, a null is a real non-response and
    gets its own ``<col>_was_missing`` flag. Imputation is deliberately not done
    here: it must be fitted inside the CV fold, not on the full frame.
    """
    out = add_block_availability(frame, block, applies)

    for column in columns:
        if column not in out.columns:
            continue
        out[f"{column}_was_missing"] = (out[column].isna() & applies).astype(int)
        out[column] = out[column].where(applies, fill_value)

    return out


def encode_structural_categorical(
    frame: pd.DataFrame, columns: list[str], applies: pd.Series
) -> pd.DataFrame:
    """Two distinct levels for categoricals: 'Not applicable' vs 'Unknown'.

    Merging them is the same error as merging the numeric cases — it discards
    the difference between a question that was never asked and one that was
    asked and dodged.
    """
    out = frame.copy()
    for column in columns:
        if column not in out.columns:
            continue
        series = out[column].astype("object")
        out[column] = series.where(~series.isna(), UNKNOWN).where(applies, NOT_APPLICABLE)
    return out


def null_report(frame: pd.DataFrame, *, exclude: tuple[str, ...] = ()) -> pd.DataFrame:
    """Per-column null counts and rates, sorted worst first."""
    columns = [c for c in frame.columns if c not in exclude]
    counts = frame[columns].isna().sum()

    report = pd.DataFrame(
        {
            "column": counts.index,
            "n_missing": counts.to_numpy(),
            "pct_missing": (100 * counts / len(frame)).round(2).to_numpy(),
            "dtype": [str(frame[c].dtype) for c in counts.index],
        }
    )
    return report.sort_values("pct_missing", ascending=False).reset_index(drop=True)


def columns_over_threshold(
    frame: pd.DataFrame, threshold_pct: float = 40.0, *, exclude: tuple[str, ...] = ()
) -> list[str]:
    """Columns missing more than `threshold_pct`, candidates for dropping.

    Structural absence must be encoded (via `encode_structural`) *before* this
    runs. Otherwise every agricultural column would exceed the threshold the
    moment non-farming households enter the sample, and the whole agricultural
    feature set would be discarded.
    """
    report = null_report(frame, exclude=exclude)
    return report.loc[report["pct_missing"] > threshold_pct, "column"].tolist()
