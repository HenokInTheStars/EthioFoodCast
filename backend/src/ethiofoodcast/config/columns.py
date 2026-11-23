"""Survey module names and question codes.

Every literal column code in the project lives in this file. Nothing elsewhere
writes 's8q01' or 'ls_s8_1q01' inline, so when a code turns out to mean
something different there is exactly one place to fix it.
"""

from __future__ import annotations

# --- Wave 4 modules (CSV) ----------------------------------------------
W4 = {
    "cover_hh": "sect_cover_hh_w4",
    "cover_pp": "sect_cover_pp_w4",
    "cover_ph": "sect_cover_ph_w4",
    "cover_ls": "sect_cover_ls_w4",
    "roster": "sect1_hh_w4",
    "education": "sect2_hh_w4",
    "health": "sect3_hh_w4",
    "labour": "sect4_hh_w4",
    "food_security": "sect8_hh_w4",
    "shocks": "sect9_hh_w4",
    "land_a": "sect10a_hh_w4",
    "parcels": "sect10b_hh_w4",
    # Verified against the Wave 5 question text, NOT inferred from the section
    # numbering: sect12a is the non-farm ENTERPRISE block ("has HH owned a
    # non-agricultural business?"), while sect15a is the CREDIT block ("did the
    # household borrow at least 150 Birr?"). The two are easy to transpose.
    "nonfarm": "sect12a_hh_w4",
    "other_income": "sect13_hh_w4_v2",
    "assistance": "sect14_hh_w4",
    "credit": "sect15a_hh_w4",
    "assets": "sect11_hh_w4",
    "consumption": "cons_agg_w4",
    "diet": "sect6a_hh_w4",
    "diet_frequency": "sect6b1_hh_w4",
    "geovars": "ETH_HouseholdGeovariables_Y4",
    # agriculture, keyed on holder_id
    "pp_parcels": "sect2_pp_w4",
    "pp_fields": "sect3_pp_w4",
    "pp_crops": "sect4_pp_w4",
    "pp_seed": "sect5_pp_w4",
    "pp_extension": "sect7_pp_w4",
    "ph_crops": "sect9_ph_w4",
    "ph_sales": "sect11_ph_w4",
    "livestock_1": "sect8_1_ls_w4",
    "livestock_2": "sect8_2_ls_w4",
    "livestock_3": "sect8_3_ls_w4",
    "livestock_4": "sect8_4_ls_w4",
}

# Wave 4 seven-day food consumption. Verified against catalog 3823/F9.
DIET_ITEM = "item_cd"
DIET_CONSUMED = "s6aq01"
DIET_SPENDING = "s6aq04"
DIET_SOURCES = {"purchased": "s6aq03a", "own": "s6aq05a", "gift": "s6aq06a"}
DIET_FREQUENCY_COLUMNS = ("food_id", "s6bq01", "s6bq02")
DIET_FREQUENCY_NAMES = (
    "teff", "other_cereal", "roots", "pasta", "sweets", "pulses_nuts_seeds",
    "vegetables", "fruit", "red_meat", "poultry", "eggs", "fish", "fats",
    "dairy", "condiments_beverages", "kocho_bula",
)
CAPITAL_EDUCATION = {"literate": "s2q03", "ever_school": "s2q04"}
CAPITAL_LABOUR = {"farm": "s4q05", "business": "s4q08", "casual": "s4q10", "paid": "s4q12"}
CAPITAL_HEALTH = {"ill": "s3q05", "stopped": "s3q07", "days": "s3q08"}
CAPITAL_ROSTER = {"age": "s1q03a", "relation": "s1q01"}
# Descriptive groups, not a calibrated HDDS/FCS score. Codes follow W4 labels.
DIET_GROUPS = {
    "cereals": tuple(range(101, 110)) + (901, 902, 903),
    "pulses_nuts": tuple(range(201, 212)),
    "seeds": tuple(range(301, 306)),
    "vegetables": tuple(range(401, 409)),
    "fruit": tuple(range(501, 507)),
    "roots": tuple(range(601, 611)),
    "meat_fish": (701, 702, 703, 704),
    "dairy": (705, 706),
    "eggs": (709,),
}

# --- Wave 5 modules (SPSS, converted to CSV at Stage 1a) ---------------
W5 = {
    "cover_hh": "sect_cover_hh_w5",
    "cover_pp": "sect_cover_pp_w5",
    "cover_ls": "sect_cover_ls_w5",
    "roster": "sect1_hh_w5",
    "food_security": "sect8_hh_w5",  # the FIES outcome module
    "shocks": "sect9_hh_w5",
    "land_a": "sect10a_hh_w5",
    "consumption": "cons_agg_w5",
    "geovars": "eth_householdgeovariables_y5",
}

# --- Wave 5 FIES items (the prediction target) -------------------------
# Confirmed present in sect8_hh_w5.sav by reading the SPSS dictionary.
FIES_ITEMS = {
    "s8q01": "worried about not having enough food",
    "s8q02": "unable to eat healthy/nutritious food",
    "s8q03": "ate only a few kinds of food",
    "s8q04": "had to skip a meal",
    "s8q05": "ate less than the household thought it should",
    "s8q06": "went without eating for a whole day",
    "s8q07": "ran out of food",
    "s8q08": "was hungry but did not eat",
}

# Frequency follow-ups for the severe items
FIES_FREQUENCY_ITEMS = ("s8q06a", "s8q07a", "s8q08a")

# The primary target: material food-access restriction. Deliberately excludes
# s8q01 (worry) and s8q02 (diet quality), which register concern rather than a
# restriction on food actually eaten.
FIES_SEVERE_ITEMS = ("s8q03", "s8q04", "s8q05", "s8q06", "s8q07", "s8q08")

# --- Wave 4 prior food-security history --------------------------------
# Wave 4 section 8 is a coping/food-security module with a different shape to
# the Wave 5 FIES block; the exact item semantics are confirmed against the
# Wave 5 codebook sidecars during Stage 2 rather than assumed here.
W4_FOOD_SECURITY_ITEMS = ("s8q01", "s8q04", "s8q06")

# The eight Coping Strategy Index items: "number of days in the last 7 the
# household had to ...", each 0-7, answered by all 6,770 households. Labels
# are from the official DDI codebook for catalogue 3823, not inferred from
# the section numbering -- s8q02a is "rely on less preferred foods", the
# MILDEST item, and an earlier version of the feature builder read it as
# "days without enough food".
W4_COPING_ITEMS = {
    "less_preferred": "s8q02a",   # rely on less preferred foods
    "limit_variety": "s8q02b",    # limit the variety of foods eaten
    "limit_portion": "s8q02c",    # limit portion size at meal-times
    "fewer_meals": "s8q02d",      # reduce number of meals eaten in a day
    "restrict_adult": "s8q02e",   # restrict consumption by adults
    "borrow_food": "s8q02f",      # borrow food or rely on help
    "no_food": "s8q02g",          # no food of any kind in the household
    "whole_day": "s8q02h",        # go a whole day and night without eating
}

# Published weights for the reduced Coping Strategy Index. Using the standard
# weights keeps the score comparable with the food-security literature; the
# remaining three items are summarised separately rather than invented into
# the rCSI.
RCSI_WEIGHTS = {
    "less_preferred": 1,
    "borrow_food": 2,
    "limit_portion": 1,
    "restrict_adult": 3,
    "fewer_meals": 1,
}

# Meals per day. Code 99 on the child item means "no people in the age group".
W4_MEALS = {"adult": "s8q03a", "child": "s8q03b"}
