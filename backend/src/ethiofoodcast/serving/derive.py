"""Summary inputs computed from the questions a person can actually answer.

The model was trained on summaries such as the reduced Coping Strategies
Index or "number of Yes answers". Nobody can answer those directly, so a form
asks the underlying questions and this module computes the summaries with
the same rules that were used to build the training data. A value the caller supplied explicitly is never
overwritten, and a summary is only computed when every input it needs is
present -- exactly as in training, where a partial response stayed missing.
"""
from __future__ import annotations

import math

COPING = ("prior_fi_cope_less_preferred", "prior_fi_cope_limit_variety", "prior_fi_cope_limit_portion",
          "prior_fi_cope_fewer_meals", "prior_fi_cope_restrict_adult", "prior_fi_cope_borrow_food",
          "prior_fi_cope_no_food", "prior_fi_cope_whole_day")
SEVERE = ("prior_fi_cope_no_food", "prior_fi_cope_whole_day")
# Published reduced Coping Strategies Index (rCSI) weights.
RCSI_WEIGHTS = {"prior_fi_cope_less_preferred": 1, "prior_fi_cope_borrow_food": 2, "prior_fi_cope_limit_portion": 1,
                "prior_fi_cope_restrict_adult": 3, "prior_fi_cope_fewer_meals": 1}
FOOD_ITEMS = ("prior_fi_s8q01", "prior_fi_s8q04", "prior_fi_s8q06")
MEMBERS = ("n_children", "n_elderly", "n_working_age")
DIET_GROUPS = ("diet_cereals", "diet_pulses_nuts", "diet_seeds", "diet_vegetables", "diet_fruit",
               "diet_roots", "diet_meat_fish", "diet_dairy", "diet_eggs")

# derived field -> the answered fields it is computed from
DERIVED = {
    "prior_fi_any": FOOD_ITEMS,
    "prior_fi_score": FOOD_ITEMS,
    "prior_fi_rcsi": tuple(RCSI_WEIGHTS),
    "prior_fi_coping_days": COPING,
    "prior_fi_coping_breadth": COPING,
    "prior_fi_coping_max": COPING,
    "prior_fi_coping_severe_days": SEVERE,
    "prior_fi_coping_severe_any": SEVERE,
    "prior_fi_days": ("prior_fi_cope_less_preferred",),   # legacy name for the same question
    "prior_fi_has_child_meals": ("prior_fi_meals_child",),
    "dependency_ratio": MEMBERS,
    "diet_n_groups": DIET_GROUPS,
}

# ---- Wubetie et al. factors, 2018/19 FCS and the CARI-inspired proxy (model v2).
# Each rule is the same one used to build these inputs for training.
FOOD_ITEM_FIELDS = tuple(f"fcs_item_{i}" for i in range(1, 17))          # ESS sect6b1 food_id 1-16
FCS_GROUPS = {"staples": (2.0, (1, 2, 3, 4, 16)), "pulses": (3.0, (6,)), "vegetables": (1.0, (7,)),
              "fruit": (1.0, (8,)), "meat_fish_eggs": (4.0, (9, 10, 11, 12)), "milk": (4.0, (14,)),
              "sugar": (0.5, (5,)), "oil": (0.5, (13,))}                   # item 15 (condiments) weighs 0
FCS_WUBETIE_CUTS = (35.5, 49.0)       # wub_fcs_level: Wubetie et al. 2023, Ethiopian diets
FCS_WFP_ADJUSTED_CUTS = (28.0, 42.0)  # CARI-inspired proxy only: WFP adjusted thresholds
WATER_IMPROVED = {1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15}
WATER_UNIMPROVED = {7, 9, 16}
SANITATION_IMPROVED = {1, 2, 3, 6, 9, 11, 13}
SANITATION_UNIMPROVED = {4, 5, 7, 8, 10, 12, 14, 15}
# TLU weights per question (FAO tropical livestock units: bulls/oxen/cows 0.7, steers/heifers 0.5, calves 0.2,
# goats/sheep 0.1, camels 1.0, poultry 0.01, horses 0.8, mules/donkeys 0.7, bees 0).
LIVESTOCK_TLU = {"q_cattle_adult": 0.7, "q_cattle_young": 0.5, "q_calves": 0.2, "q_sheep_goats": 0.1,
                 "q_camels": 1.0, "q_poultry": 0.01, "q_horses": 0.8, "q_donkeys_mules": 0.7, "q_bee_colonies": 0.0}
DERIVED.update({
    "wub_fcs": FOOD_ITEM_FIELDS,
    "wub_fcs_level": FOOD_ITEM_FIELDS,
    "wub_cari_current_status": FOOD_ITEM_FIELDS + tuple(RCSI_WEIGHTS),
    "wub_fes_points": ("cons_food_share",),
    "wub_cari": FOOD_ITEM_FIELDS + tuple(RCSI_WEIGHTS) + ("cons_food_share", "wub_lcs_level"),
    "wub_adult_literacy_share": ("q_adults_literate", "n_working_age", "n_elderly"),
    "wub_share_ill_4wk": ("q_members_ill", "hh_size"),
    "wub_any_ill_4wk": ("q_members_ill",),
    "wub_water_improved": ("q_water_source",),
    "wub_water_improved_dry": ("q_water_source", "q_water_source_dry"),
    "wub_sanitation_improved": ("q_toilet_type",),
    "wub_open_defecation": ("q_toilet_type",),
    "livestock_tlu": tuple(LIVESTOCK_TLU),
    "livestock_any": tuple(LIVESTOCK_TLU),
    "land_area_per_person": ("land_total_area", "hh_size"),
})

# ---- Agricultural form (model v3, agri14). Herd counts by animal group, as a worker asks them.
# Training summed cattle (bulls, oxen, cows, steers, heifers, calves), goats+sheep and
# poultry. TLU from these groups uses fixed FAO-style weights; cattle 0.6 is a herd average of
# 0.7 (adult) / 0.5 (young) / 0.2 (calves). Not fitted to the data. Horses, donkeys, mules and camels
# are not asked, so for households that own them TLU is an under-estimate (correlation with the
# training TLU 0.94; the end-to-end accuracy check is in the model's verification).
HERD_TLU = {"livestock_cattle": 0.6, "livestock_small_ruminants": 0.1, "livestock_poultry": 0.01}
HERD_OPTIONAL_TLU = {"livestock_equines": 0.7, "livestock_camels": 1.0}   # used when supplied
DERIVED.update({
    "hh_size": MEMBERS,                                   # training: roster count = the three groups' sum
    "livestock_tlu_per_person": tuple(HERD_TLU) + MEMBERS,
})


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def derive(household: dict) -> dict:
    """Return a copy with every computable summary filled in; answers are untouched."""
    if not isinstance(household, dict):
        return household
    out = dict(household)
    value = {k: _number(v) for k, v in household.items()}

    def have(fields):
        return all(value.get(f) is not None for f in fields)

    def put(name, result):
        if value.get(name) is None and result is not None:
            out[name] = result

    food = [value.get(f) for f in FOOD_ITEMS]
    if any(v == 1 for v in food):
        put("prior_fi_any", 1.0)                  # a Yes is definitive whatever else is missing
    elif have(FOOD_ITEMS):
        put("prior_fi_any", 0.0)
    if have(FOOD_ITEMS):
        put("prior_fi_score", float(sum(v == 1 for v in food)))

    if have(RCSI_WEIGHTS):
        put("prior_fi_rcsi", float(sum(value[f] * w for f, w in RCSI_WEIGHTS.items())))
    if have(COPING):
        days = [value[f] for f in COPING]
        put("prior_fi_coping_days", float(sum(days)))
        put("prior_fi_coping_breadth", float(sum(d > 0 for d in days)))
        put("prior_fi_coping_max", float(max(days)))
    if have(SEVERE):
        put("prior_fi_coping_severe_days", float(sum(value[f] for f in SEVERE)))
        put("prior_fi_coping_severe_any", float(any(value[f] > 0 for f in SEVERE)))
    if have(("prior_fi_cope_less_preferred",)):
        put("prior_fi_days", value["prior_fi_cope_less_preferred"])
    if have(("prior_fi_meals_child",)):
        put("prior_fi_has_child_meals", 1.0)
    if have(MEMBERS):
        put("hh_size", float(sum(value[m] for m in MEMBERS)))
    if have(MEMBERS) and value["n_working_age"] > 0:   # training left it missing with no working-age member
        put("dependency_ratio", (value["n_children"] + value["n_elderly"]) / value["n_working_age"])
    if have(DIET_GROUPS):
        put("diet_n_groups", float(sum(value[f] == 1 for f in DIET_GROUPS)))
    return _derive_v2(out)


def _ladder(code, good, bad):
    return 1.0 if code in good else 0.0 if code in bad else None


def _derive_v2(out: dict) -> dict:
    """Model-v2 inputs; a no-op when none of their questions are present."""
    value = {k: _number(v) for k, v in out.items()}

    def put(name, result):
        if value.get(name) is None and result is not None:
            out[name] = result
            value[name] = result

    if all(value.get(f) is not None for f in FOOD_ITEM_FIELDS):
        fcs = 0.0
        for weight, items in FCS_GROUPS.values():
            fcs += weight * min(7.0, sum(value[f"fcs_item_{i}"] for i in items))
        put("wub_fcs", fcs)
        put("wub_fcs_level", 2.0 if fcs <= FCS_WUBETIE_CUTS[0] else 1.0 if fcs <= FCS_WUBETIE_CUTS[1] else 0.0)
    share = value.get("cons_food_share")
    if share is None and value.get("cons_food_annual") is not None and value.get("cons_total_annual"):
        share = value["cons_food_annual"] / value["cons_total_annual"]
    if share is not None:
        put("wub_fes_points", 1.0 if share < .50 else 2.0 if share < .65 else 3.0 if share < .75 else 4.0)
    if value.get("wub_fcs") is not None and value.get("prior_fi_rcsi") is not None:
        fcs = value["wub_fcs"]
        status = 4.0 if fcs <= FCS_WFP_ADJUSTED_CUTS[0] else 3.0 if fcs <= FCS_WFP_ADJUSTED_CUTS[1] else 1.0
        if status == 1.0 and value["prior_fi_rcsi"] >= 4:
            status = 2.0
        put("wub_cari_current_status", status)
    if all(value.get(f) is not None for f in ("wub_cari_current_status", "wub_lcs_level", "wub_fes_points")):
        coping = (value["wub_lcs_level"] + value["wub_fes_points"]) / 2
        put("wub_cari", float(math.floor((value["wub_cari_current_status"] + coping) / 2 + 0.5)))
    adults = None if value.get("n_working_age") is None or value.get("n_elderly") is None else value["n_working_age"] + value["n_elderly"]
    if value.get("q_adults_literate") is not None and adults:
        put("wub_adult_literacy_share", value["q_adults_literate"] / adults)
    if value.get("q_members_ill") is not None:
        put("wub_any_ill_4wk", 1.0 if value["q_members_ill"] > 0 else 0.0)
        if value.get("hh_size"):
            put("wub_share_ill_4wk", value["q_members_ill"] / value["hh_size"])
    if value.get("q_water_source") is not None:
        rainy = int(value["q_water_source"])
        put("wub_water_improved", _ladder(rainy, WATER_IMPROVED, WATER_UNIMPROVED))
        dry = int(value["q_water_source_dry"]) if value.get("q_water_source_dry") is not None else rainy
        put("wub_water_improved_dry", _ladder(dry, WATER_IMPROVED, WATER_UNIMPROVED))
    if value.get("q_toilet_type") is not None:
        toilet = int(value["q_toilet_type"])
        put("wub_sanitation_improved", _ladder(toilet, SANITATION_IMPROVED, SANITATION_UNIMPROVED))
        known = SANITATION_IMPROVED | SANITATION_UNIMPROVED
        put("wub_open_defecation", 1.0 if toilet == 15 else 0.0 if toilet in known else None)
    if all(value.get(f) is not None for f in LIVESTOCK_TLU):
        put("livestock_tlu", sum(value[f] * w for f, w in LIVESTOCK_TLU.items()))
        put("livestock_any", 1.0 if sum(value[f] for f in LIVESTOCK_TLU) > 0 else 0.0)
    if all(value.get(f) is not None for f in HERD_TLU):
        put("livestock_tlu", sum(value[f] * w for f, w in HERD_TLU.items())
            + sum((value.get(f) or 0.0) * w for f, w in HERD_OPTIONAL_TLU.items()))
    if value.get("land_total_area") is not None and value.get("hh_size"):
        put("land_area_per_person", value["land_total_area"] / value["hh_size"])
    if value.get("livestock_tlu") is not None and value.get("hh_size"):
        put("livestock_tlu_per_person", value["livestock_tlu"] / value["hh_size"])
    return out


def answered(household: dict) -> list[str]:
    """Fields the person actually answered (not blank), excluding location metadata."""
    return [k for k, v in household.items() if k not in ("area_id",) and _number(v) is not None]


# Questions with hard logical limits. The schema's observed-range check allows a
# small tolerance, which suits measurements but not "days in the past 7 days".
WHOLE_NUMBER_LIMITS = {**{f: (0, 7) for f in COPING}, **{f: (0, 7) for f in FOOD_ITEM_FIELDS},
                       **{f: (0, 1000) for f in LIVESTOCK_TLU}, **{f: (0, 5000) for f in HERD_TLU},
                       **{m: (0, 30) for m in MEMBERS}, "q_members_ill": (0, 30), "q_adults_literate": (0, 30),
                       "prior_fi_meals_adult": (0, 10), "prior_fi_meals_child": (0, 10),
                       "diet_n_groups": (0, 9)}


def consistency_problems(household: dict) -> list[str]:
    """Answers that cannot all be true at once; empty when the household is coherent."""
    v = {k: _number(x) for k, x in household.items()}
    problems = []
    for field, (low, high) in WHOLE_NUMBER_LIMITS.items():
        x = v.get(field)
        if x is not None and (x != int(x) or not low <= x <= high):
            problems.append(f"{field}: {x:g} must be a whole number from {low} to {high}")
    size = v.get("hh_size")
    members = [v.get(m) for m in MEMBERS]
    if size is not None and sum(m or 0 for m in members) > size:
        problems.append(f"children + elderly + working-age members ({sum(m or 0 for m in members):g}) "
                        f"cannot exceed household size ({size:g})")
    if size is not None and v.get("n_holders") is not None and v["n_holders"] > size:
        problems.append("people holding farmland cannot exceed household size")
    if None not in (v.get("econ_n_asset_types"), v.get("econ_total_assets")) and v["econ_n_asset_types"] > v["econ_total_assets"]:
        problems.append("types of household items cannot exceed the total number of items")
    if None not in (v.get("cons_food_annual"), v.get("cons_total_annual")) and v["cons_food_annual"] > v["cons_total_annual"]:
        problems.append("yearly food spending cannot exceed total yearly spending")
    shares = [v.get(f) for f in ("diet_purchased_item_fraction", "diet_own_item_fraction", "diet_gift_item_fraction")]
    if sum(x or 0 for x in shares) > 1.001:
        problems.append("shares of food bought, home-grown and received as gifts cannot add up to more than 1")
    adults = None if v.get("n_working_age") is None or v.get("n_elderly") is None else v["n_working_age"] + v["n_elderly"]
    if v.get("q_adults_literate") is not None and adults is not None and v["q_adults_literate"] > adults:
        problems.append(f"adults who can read and write ({v['q_adults_literate']:g}) cannot exceed the adults in the household ({adults:g})")
    if v.get("q_members_ill") is not None and size is not None and v["q_members_ill"] > size:
        problems.append("members who were ill cannot exceed household size")
    groups_yes = sum(v.get(f) == 1 for f in DIET_GROUPS)
    if v.get("diet_n_groups") is not None and v["diet_n_groups"] < groups_yes:
        problems.append(f"food groups eaten ({v['diet_n_groups']:g}) is fewer than the {groups_yes} groups answered Yes")
    return problems
