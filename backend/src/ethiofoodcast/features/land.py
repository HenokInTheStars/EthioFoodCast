"""Land holdings and field characteristics.

Sources: ``sect3_pp_w4`` (fields, 19,339 rows) and ``sect10b_hh_w4`` (parcels).
Confirmed from the Wave 5 codebook: ``s3q02a`` field area as reported by the
holder, ``s3q08`` GPS-measured area, ``s3q17`` irrigated this season.
"""

from __future__ import annotations

import pandas as pd

from ..config import columns as cols
from ..data.loaders import read_module
from .base import frame_from, safe_ratio, yes_no


def build() -> pd.DataFrame:
    fields = read_module(4, cols.W4["pp_fields"])
    by_household = fields["household_id"]

    # Prefer the GPS measurement where it exists; fall back to the holder's
    # estimate. GPS is the more reliable of the two but is not always recorded.
    reported = pd.to_numeric(fields.get("s3q02a"), errors="coerce")
    gps = pd.to_numeric(fields.get("s3q08"), errors="coerce")
    area = gps.where(gps.notna() & (gps > 0), reported)
    # LSMS unit conversions produce implausible extremes, but clipping them
    # here would learn the limits from the whole sample. Done per fold instead.

    total_area = area.groupby(by_household).sum(min_count=1)
    n_fields = by_household.value_counts().sort_index()
    mean_field = area.groupby(by_household).mean()

    series = {
        "land_total_area": total_area,
        "land_n_fields": n_fields,
        "land_mean_field_area": mean_field,
        # Fragmentation: many small fields is a different kind of holding from
        # one large one of the same total area.
        "land_fragmentation": safe_ratio(n_fields.astype("Float64"), total_area),
        "land_area_sd": area.groupby(by_household).std(),
    }

    if "s3q17" in fields.columns:
        irrigated = yes_no(fields["s3q17"])
        series["land_any_irrigated"] = irrigated.groupby(by_household).max()
        series["land_share_irrigated"] = irrigated.groupby(by_household).mean()

    for column, name in (("s3q25", "manure"), ("s3q26", "compost")):
        if column in fields.columns:
            flags = yes_no(fields[column])
            series[f"land_any_{name}"] = flags.groupby(by_household).max()
            series[f"land_share_{name}"] = flags.groupby(by_household).mean()

    frame = frame_from(series)

    parcels = read_module(4, cols.W4["parcels"])
    n_parcels = parcels["household_id"].value_counts().sort_index()
    n_parcels.index.name = "household_id"
    frame = frame.merge(
        n_parcels.rename("land_n_parcels").reset_index(), on="household_id", how="left"
    )
    return frame
