"""Wave 4 seven-day diet features; no quantities summed across unlike units.

Definitions: https://microdata.worldbank.org/index.php/catalog/3823/data-dictionary/F9
Group mappings are descriptive, not FAO-calibrated dietary diversity scores.
Unknown answers remain unknown. Absent expected items cannot imply non-consumption.
"""

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, yes_no


def build(module=None):
    if module is None:
        module = read_module(4, cols.W4["diet"])
    frame = module.copy()
    frame["item"] = code_of(frame[cols.DIET_ITEM])
    if frame.duplicated(["household_id", "item"]).any():
        raise ValueError("Duplicate household-food records in diet module")
    frame["consumed"] = yes_no(frame[cols.DIET_CONSUMED])
    nutritious = sorted({code for codes in cols.DIET_GROUPS.values() for code in codes})
    matrix = frame.pivot(index="household_id", columns="item", values="consumed")
    matrix = matrix.reindex(columns=nutritious).astype("Float64")
    out = pd.DataFrame(index=matrix.index)
    out["diet_n_items_unknown"] = matrix.isna().sum(axis=1)
    out["diet_n_items"] = matrix.sum(axis=1, min_count=len(nutritious))
    for group, codes in cols.DIET_GROUPS.items():
        block = matrix[list(codes)]
        flag = block.max(axis=1).where(block.notna().all(axis=1))
        flag = flag.mask(block.eq(1).any(axis=1), 1)
        out[f"diet_{group}"] = flag
    group_names = [f"diet_{name}" for name in cols.DIET_GROUPS]
    out["diet_n_groups"] = out[group_names].sum(axis=1, min_count=len(group_names))

    # Source presence needs only a positive quantity, regardless of its unit.
    # Ratios describe item counts among observed answers, not quantity shares.
    food = frame.loc[frame.item.isin(nutritious)].copy()
    for source, column in cols.DIET_SOURCES.items():
        quantity = pd.to_numeric(food[column], errors="coerce")
        valid = quantity.where(quantity.ge(0))
        flag = valid.gt(0).astype("Float64").where(valid.notna())
        flag = flag.mask(food.consumed.eq(0), 0)
        flag = flag.where(food.consumed.notna())
        grouped = flag.groupby(food.household_id)
        out[f"diet_{source}_item_fraction"] = grouped.mean()
        out[f"diet_{source}_n_observed"] = grouped.count()

    spend = pd.to_numeric(food[cols.DIET_SPENDING], errors="coerce")
    spend = spend.where(spend.ge(0)).mask(food.consumed.eq(0), 0)
    purchased = pd.to_numeric(food[cols.DIET_SOURCES["purchased"]], errors="coerce")
    spend = spend.mask(purchased.eq(0) & food.consumed.notna(), 0)
    spend = spend.where(food.consumed.notna())
    grouped = spend.groupby(food.household_id)
    out["diet_purchase_birr_7d"] = grouped.sum(min_count=len(nutritious))
    out["diet_spending_n_observed"] = grouped.count()
    return out.reset_index()
