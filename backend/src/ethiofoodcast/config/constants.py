"""Project-wide constants.

The random seed lives here and is threaded through every split and model so
results are reproducible.
"""

from __future__ import annotations

RANDOM_SEED = 42

# --- Identifier columns -------------------------------------------------
# These must survive every load, write and re-read as strings. Ethiopian
# household ids carry leading zeros ('010101088800910007'); letting pandas or
# pyreadstat infer them as numeric destroys the W4 <-> W5 join.
ID_COLUMNS = (
    "household_id",
    "holder_id",
    "individual_id",
    "ea_id",
    "parcel_id",
    "field_id",
    "crop_id",
    "seed_id",
    "harvestedcrop_id",
)

# Every Wave 4 and Wave 5 household_id is exactly 18 characters. holder_id is
# household_id + a holder suffix, and the suffix length is NOT fixed: 2,938 of
# the 2,939 Wave 4 holders use 2 digits (20 chars total) and one uses 3 (21).
# So household_id is taken as the first 18 characters, never by stripping a
# suffix of assumed length. Verified: holder_id starts with household_id for
# 100% of rows.
HOUSEHOLD_ID_LENGTH = 18

# Expected shapes, verified from the archives. Stage 0/1 assert against these
# so a corrupted or substituted download is caught immediately rather than
# producing a quietly wrong sample.
EXPECTED = {
    "w4_households": 6770,
    "w4_ag_holders": 2939,
    "w4_ag_households": 2899,
    "w5_households": 4959,
    "w5_ag_holders": 2110,
}

# --- Survey design ------------------------------------------------------
REGION_COLUMN = "saq01"
RURAL_URBAN_COLUMN = "saq14"
EA_COLUMN = "ea_id"

W4_WEIGHT = "pw_w4"
W5_WEIGHT = "pw_w5"

# saq14 coding in the ESS cover files. These are read as int64, not strings --
# only the columns listed in ID_COLUMNS are forced to string, and saq14/saq01
# are ordinary numeric codes. Comparing against "1" silently matches nothing.
RURAL_CODE = 1
URBAN_CODE = 2
