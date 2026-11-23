"""Additional Wave 4 frequency, adult education/work, and health features.

Definitions verified in World Bank catalog 3823 dictionaries F3/F4/F5/F10.
Experimental sidecar: do not mutate the input of an ongoing tuning run.
"""
import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import code_of, yes_no


def frequency(module=None):
    if module is None:
        module = read_module(4, cols.W4["diet_frequency"])
    item_col, consumed_col, days_col = cols.DIET_FREQUENCY_COLUMNS
    frame = module.copy()
    frame["item"] = code_of(frame[item_col])
    if frame.duplicated(["household_id", "item"]).any():
        raise ValueError("Duplicate household-food frequency rows")
    consumed = yes_no(frame[consumed_col])
    days = pd.to_numeric(frame[days_col], errors="coerce")
    days = days.where(days.between(1, 7)).mask(consumed.eq(0), 0)
    frame["days"] = days.where(consumed.notna())
    out = frame.pivot(index="household_id", columns="item", values="days")
    out = out.reindex(columns=range(1, 17))
    out.columns = [f"freq_{name}_days" for name in cols.DIET_FREQUENCY_NAMES]
    out["freq_n_unknown"] = out.isna().sum(axis=1)
    days_columns = [c for c in out if c.endswith("_days")]
    out["freq_n_groups_consumed"] = out[days_columns].gt(0).sum(axis=1).where(out.freq_n_unknown.eq(0))
    return out.reset_index()


def _person_join(roster, module):
    keys = ["household_id", "individual_id"]
    if roster.duplicated(keys).any() or module.duplicated(keys).any():
        raise ValueError("Duplicate person keys in capital features")
    return roster[keys + list(cols.CAPITAL_ROSTER.values())].merge(module, on=keys, how="left", validate="one_to_one")


def capital(roster=None, education=None, labour=None, health=None):
    if roster is None:
        roster = read_module(4, cols.W4["roster"])
    modules = {
        "education": education if education is not None else read_module(4, cols.W4["education"]),
        "labour": labour if labour is not None else read_module(4, cols.W4["labour"]),
        "health": health if health is not None else read_module(4, cols.W4["health"]),
    }
    out = pd.DataFrame(index=pd.Index(roster.household_id.unique(), name="household_id"))
    for kind, mapping in (("education", cols.CAPITAL_EDUCATION), ("labour", cols.CAPITAL_LABOUR)):
        frame = _person_join(roster, modules[kind])
        adults = pd.to_numeric(frame[cols.CAPITAL_ROSTER["age"]], errors="coerce").ge(18)
        head = code_of(frame[cols.CAPITAL_ROSTER["relation"]]).eq(1)
        for name, column in mapping.items():
            value = yes_no(frame[column])
            group = value.loc[adults].groupby(frame.loc[adults, "household_id"])
            out[f"capital_adult_{name}_share"] = group.mean()
            out[f"capital_{name}_response_share"] = value.loc[adults].notna().groupby(frame.loc[adults, "household_id"]).mean()
            if kind == "education":
                out[f"capital_head_{name}"] = value.loc[head].groupby(frame.loc[head, "household_id"]).first()
    frame = _person_join(roster, modules["health"])
    ill = yes_no(frame[cols.CAPITAL_HEALTH["ill"]])
    stopped = yes_no(frame[cols.CAPITAL_HEALTH["stopped"]]).mask(ill.eq(0), 0).where(ill.notna())
    days = pd.to_numeric(frame[cols.CAPITAL_HEALTH["days"]], errors="coerce")
    days = days.where(days.between(0, 28)).mask(stopped.eq(0), 0).where(stopped.notna())
    out["capital_ill_share"] = ill.groupby(frame.household_id).mean()
    out["capital_health_response_share"] = ill.notna().groupby(frame.household_id).mean()
    out["capital_stopped_activities_share"] = stopped.groupby(frame.household_id).mean()
    out["capital_days_lost_mean"] = days.groupby(frame.household_id).mean()
    out["capital_days_lost_max"] = days.groupby(frame.household_id).max()
    return out.reset_index()


def augment(frame):
    out = frame.copy()
    for block in (frequency(), capital()):
        out = out.merge(block, on="household_id", how="left", validate="one_to_one")
    for numerator, denominator, name in (
        ("diet_purchase_birr_7d", "hh_size", "dietx_purchase_per_person"),
        ("cons_food_annual", "adult_equivalents", "dietx_food_per_adult"),
        ("econ_total_assets", "hh_size", "capital_assets_per_person"),
    ):
        if numerator in out and denominator in out:
            out[name] = out[numerator] / out[denominator].where(out[denominator].gt(0))
    return out
