"""Feature matrix preparation.

Preprocessing is fitted **inside each training fold**, never on the full frame.
Fitting a scaler or an imputer on all the data before cross-validation is the
most common way a project like this quietly overstates its performance.

Three transformations matter here, and each exists because of something
measured on this data rather than as routine hygiene:

* **Categorical encoding.** ``w4_region`` holds codes 2-15. Left as an integer
  a model reads region 15 as "13 more than" region 2, which is meaningless.
  Since region is the strongest single signal in the data, that mis-encoding
  is expensive, so categorical columns are one-hot encoded.

* **Log transform.** 61 of 126 numeric features have |skew| > 2, and
  ``input_oxen_owned`` reaches 39.9. Standardising a variable that skewed
  produces a column where nearly all the mass sits at one value with a few
  extreme outliers -- which a linear model or a neural net handles badly, and
  a tree ignores. So the log is applied only where it helps.

* **Scaling.** Needed by the linear model and the MLP, irrelevant to trees.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler


class FoldWinsoriser(BaseEstimator, TransformerMixin):
    """Clip extremes to percentiles **learned on the training fold only**.

    Winsorising used to happen in the feature builders, which computed the
    percentiles over all 6,770 households before any split -- so every fold's
    clipping limits were partly set by its own test rows. The effect is small
    for a percentile, but it is leakage, and leakage in the cheap places is how
    it ends up in the expensive ones.

    Clipping is applied **only to genuinely continuous columns**. A percentile
    clip on a rare binary flag deletes the flag: with 199 zeros and a single
    one, the 99th percentile is 0, so clipping maps every row to 0 and the
    signal is gone. `has_land_data` has a rare class of 0.21% and would be
    erased exactly this way.
    """

    #: Below this many distinct values a column is treated as categorical or a
    #: flag, and left alone.
    MIN_DISTINCT_FOR_CLIPPING = 10

    def __init__(self, lower_pct: float = 0.01, upper_pct: float = 0.99):
        self.lower_pct = lower_pct
        self.upper_pct = upper_pct

    def fit(self, X, y=None):
        values = np.asarray(X, dtype="float64")

        # Decide per column, on the training fold, whether clipping is safe.
        self.clip_mask_ = np.array(
            [
                len(np.unique(values[~np.isnan(values[:, j]), j]))
                >= self.MIN_DISTINCT_FOR_CLIPPING
                for j in range(values.shape[1])
            ]
        )

        self.lower_ = np.nanquantile(values, self.lower_pct, axis=0)
        self.upper_ = np.nanquantile(values, self.upper_pct, axis=0)

        # Columns that must not be clipped get limits that cannot bind.
        self.lower_[~self.clip_mask_] = -np.inf
        self.upper_[~self.clip_mask_] = np.inf
        return self

    def transform(self, X):
        values = np.asarray(X, dtype="float64").copy()
        return np.clip(values, self.lower_, self.upper_)

    def get_feature_names_out(self, input_features=None):
        return np.asarray(input_features, dtype=object)

# Columns that are categorical codes despite being stored as integers. Every
# other feature in the set is a genuine count, ratio, amount or 0/1 flag.
CATEGORICAL_COLUMNS = ("w4_region",)

SKEW_THRESHOLD = 2.0


def collapse_missing_flags(
    columns: list[str], frame: pd.DataFrame | None = None
) -> list[str]:
    """Drop ``*_was_missing`` flags that genuinely duplicate another in their block.

    Stage 5 found these perfectly collinear within a block, and dropping them
    by name alone was fine *for this data*. But missing one answer does not
    logically imply missing every answer in the block, so when `frame` is
    supplied the duplication is **verified against the values** rather than
    assumed from the prefix. A flag that differs from its block-mate is kept.

    `frame` must be training-fold data only; passing the full sample would let
    the test rows decide which columns survive.
    """
    kept, block_reference = [], {}

    for column in columns:
        if not column.endswith("_was_missing"):
            kept.append(column)
            continue

        block = column.split("_", 1)[0]
        reference = block_reference.get(block)

        if reference is None:
            block_reference[block] = column
            kept.append(column)
            continue

        if frame is None:
            continue  # name-based behaviour, retained for callers without data

        a = pd.to_numeric(frame[reference], errors="coerce")
        b = pd.to_numeric(frame[column], errors="coerce")
        if not a.equals(b):
            kept.append(column)  # carries information the reference does not

    return kept


def to_numeric_frame(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """Coerce to plain float64 -- sklearn does not accept pandas nullable types."""
    out = frame[columns].apply(pd.to_numeric, errors="coerce")
    return out.astype("float64")


def drop_degenerate(frame: pd.DataFrame) -> list[str]:
    """Columns with no usable variance on this sample."""
    keep = []
    for column in frame.columns:
        values = frame[column]
        if values.notna().sum() == 0:
            continue
        spread = values.std(skipna=True)
        if pd.isna(spread) or spread == 0:
            continue
        keep.append(column)
    return keep


def split_column_types(
    frame: pd.DataFrame, columns: list[str]
) -> tuple[list[str], list[str], list[str]]:
    """Partition into (categorical, skewed numeric, plain numeric).

    'Skewed' is decided on the training data only, and binary flags are never
    treated as skewed -- a 0/1 column with a rare positive is highly skewed by
    the formula but taking its log achieves nothing.
    """
    categorical = [c for c in columns if c in CATEGORICAL_COLUMNS]
    numeric = [c for c in columns if c not in categorical]

    skewed, plain = [], []
    for column in numeric:
        values = pd.to_numeric(frame[column], errors="coerce")
        unique = values.dropna().unique()

        is_binary = len(unique) <= 2
        # log1p needs non-negative input; a signed variable is left alone.
        non_negative = bool(values.dropna().ge(0).all())
        skew = values.skew()

        if (not is_binary) and non_negative and pd.notna(skew) and abs(skew) > SKEW_THRESHOLD:
            skewed.append(column)
        else:
            plain.append(column)

    return categorical, skewed, plain


def _log1p(values):
    """log1p with a floor at 0, so a stray negative cannot produce NaN."""
    return np.log1p(np.clip(values, 0, None))


def build_preprocessor(
    columns: list[str],
    *,
    scale: bool,
    frame: pd.DataFrame | None = None,
    encode_categorical: bool = True,
) -> ColumnTransformer:
    """Build the fold-internal preprocessing pipeline.

    `frame` is the training fold, used only to decide which columns are skewed.
    Passing it is what makes the log decision fold-local rather than global.
    """
    if frame is None or not scale:
        # Trees: no scaling, no log (both are monotone and so invisible to a
        # split), but categorical encoding still helps them isolate a region
        # in one split rather than several.
        categorical = [c for c in columns if c in CATEGORICAL_COLUMNS] if encode_categorical else []
        numeric = [c for c in columns if c not in categorical]
        transformers = [
            (
                "numeric",
                Pipeline(
                    [
                        ("winsor", FoldWinsoriser()),
                        ("impute", SimpleImputer(strategy="median")),
                    ]
                ),
                numeric,
            ),
        ]
        if categorical:
            transformers.append(
                (
                    "categorical",
                    Pipeline(
                        [
                            ("impute", SimpleImputer(strategy="most_frequent")),
                            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
                        ]
                    ),
                    categorical,
                )
            )
        return ColumnTransformer(transformers, remainder="drop")

    categorical, skewed, plain = split_column_types(frame, columns)
    if not encode_categorical:
        plain, categorical = plain + categorical, []

    transformers = [
        (
            "skewed",
            Pipeline(
                [
                    ("winsor", FoldWinsoriser()),
                    ("impute", SimpleImputer(strategy="median")),
                    ("log", FunctionTransformer(_log1p, feature_names_out="one-to-one")),
                    ("scale", StandardScaler()),
                ]
            ),
            skewed,
        ),
        (
            "plain",
            Pipeline(
                [
                    ("winsor", FoldWinsoriser()),
                    ("impute", SimpleImputer(strategy="median")),
                    ("scale", StandardScaler()),
                ]
            ),
            plain,
        ),
    ]
    if categorical:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
                    ]
                ),
                categorical,
            )
        )

    return ColumnTransformer(transformers, remainder="drop")


def prune_collinear(
    frame: pd.DataFrame, columns: list[str], threshold: float = 0.95
) -> list[str]:
    """Drop one of each near-duplicate pair, keeping the first.

    Only for the linear model: collinearity inflates coefficient variance and
    makes the signs uninterpretable, which matters because those signs are the
    cross-check on SHAP. Trees are unaffected and keep the full set.
    """
    numeric = frame[columns].apply(pd.to_numeric, errors="coerce")
    corr = numeric.corr(method="spearman").abs()

    upper = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool))
    drop = {c for c in upper.columns if (upper[c] > threshold).any()}
    return [c for c in columns if c not in drop]
