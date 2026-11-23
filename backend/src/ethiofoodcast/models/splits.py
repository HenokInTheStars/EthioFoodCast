"""Cross-validation that is aware of the target domain.

Two rules, both load-bearing:

1. **Grouped by enumeration area.** Households in one EA share rainfall,
   markets, prices and often the same shock. A random split puts neighbours on
   both sides of the fold boundary and inflates every metric.

2. **Training is wide; scoring is agricultural.** The model may learn from all
   matched households, but every score -- tuning, calibration, threshold and
   the reported result -- is computed on agricultural households only. Tuning
   on the full 4,849 would optimise partly for a population the system does
   not serve.

Held-out EAs are removed *entirely*, non-agricultural households included, so
the model never trains on a neighbour of one of its own test households.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from ..config.constants import RANDOM_SEED


def stratification_key(frame: pd.DataFrame, target: str) -> pd.Series:
    """Stratify on outcome x agricultural status.

    Not on rural/urban: every agricultural household is rural, so that variable
    is constant where it matters and would add nothing.
    """
    outcome = frame[target].fillna(-1).astype(int).astype(str)
    return outcome + "_" + frame["is_agricultural"].astype(int).astype(str)


def outer_folds(
    frame: pd.DataFrame, target: str, n_splits: int = 5
) -> list[tuple[np.ndarray, np.ndarray]]:
    """EA-grouped, stratified outer folds over the wide sample."""
    splitter = StratifiedGroupKFold(
        n_splits=n_splits, shuffle=True, random_state=RANDOM_SEED
    )
    return list(
        splitter.split(frame, stratification_key(frame, target), groups=frame["ea_id"])
    )


def inner_folds(
    frame: pd.DataFrame, target: str, n_splits: int = 5
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Inner folds for calibration and threshold choice, same rules."""
    n_groups = frame["ea_id"].nunique()
    n_splits = max(2, min(n_splits, n_groups))
    splitter = StratifiedGroupKFold(
        n_splits=n_splits, shuffle=True, random_state=RANDOM_SEED + 1
    )
    return list(
        splitter.split(frame, stratification_key(frame, target), groups=frame["ea_id"])
    )


def assert_no_ea_overlap(train: pd.DataFrame, test: pd.DataFrame) -> None:
    shared = set(train["ea_id"]) & set(test["ea_id"])
    if shared:
        raise ValueError(f"{len(shared)} enumeration area(s) appear in both splits")
