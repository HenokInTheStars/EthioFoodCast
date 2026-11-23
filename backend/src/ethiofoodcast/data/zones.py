"""Assign households to admin-2 zones, for joining zone-level shock data.

Households carry displacement-modified coordinates (``lat_mod``/``lon_mod``):
LSMS shifts rural points by up to 5km, and a 1% subset by up to 10km, so a
household near a zone border can land in the wrong zone. That is a known,
measurable error rather than a reason not to do the join -- ``border_risk``
reports how many points sit close enough to a boundary for the displacement
to have moved them across it.

Coordinates never become model features. They are used here only to look up
which zone's rainfall, prices and conflict apply, exactly as ``geo.py``
already uses them for distances.

Uses shapely alone rather than geopandas: one small dependency, and the
point-in-polygon test is the whole requirement.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pandas as pd
from shapely.geometry import shape
from shapely.prepared import prep
from shapely.strtree import STRtree

# Rural displacement is up to 5km. A point within that of a boundary could
# have originated on the other side of it.
DISPLACEMENT_KM = 5.0
KM_PER_DEGREE = 111.32


def load_zones(archive: Path, layer: str = "eth_admin2.geojson") -> list[dict]:
    """Admin-2 polygons with their pcodes, from the OCHA boundary archive."""
    with zipfile.ZipFile(archive) as z:
        raw = json.loads(z.read(layer).decode("utf-8"))

    zones = []
    for feature in raw["features"]:
        props = feature["properties"]
        pcode = props.get("adm2_pcode")
        if not pcode or feature.get("geometry") is None:
            continue
        zones.append(
            {
                "pcode": pcode,
                "zone_name": props.get("adm2_name"),
                "region_name": props.get("adm1_name"),
                "geometry": shape(feature["geometry"]),
            }
        )
    return zones


def assign(points: pd.DataFrame, zones: list[dict]) -> pd.DataFrame:
    """Point-in-polygon lookup.

    ``points`` needs ``lat`` and ``lon`` columns; the index is preserved.
    Returns pcode, zone name, and whether the point is close enough to a
    boundary that coordinate displacement could have misplaced it.
    """
    from shapely.geometry import Point

    geometries = [z["geometry"] for z in zones]
    tree = STRtree(geometries)
    prepared = [prep(g) for g in geometries]
    # Boundaries as lines, so distance-to-edge is measured rather than
    # distance-to-polygon (which is zero anywhere inside).
    boundaries = [g.boundary for g in geometries]
    tolerance = DISPLACEMENT_KM / KM_PER_DEGREE

    out = []
    for idx, lat, lon in zip(points.index, points["lat"], points["lon"]):
        if pd.isna(lat) or pd.isna(lon):
            out.append((idx, None, None, None, None))
            continue

        point = Point(float(lon), float(lat))
        hit = None
        for candidate in tree.query(point):
            if prepared[candidate].contains(point):
                hit = int(candidate)
                break

        if hit is None:
            # Outside every polygon: coastline/border rounding, or a point
            # displaced beyond the national boundary. Snap to the nearest
            # zone but mark it, rather than silently dropping the household.
            nearest = tree.nearest(point)
            hit = int(nearest)
            near_border = True
        else:
            near_border = bool(boundaries[hit].distance(point) < tolerance)

        z = zones[hit]
        out.append((idx, z["pcode"], z["zone_name"], z["region_name"], near_border))

    return pd.DataFrame(
        out, columns=["index", "adm2_pcode", "zone_name", "zone_region", "near_border"]
    ).set_index("index")


def border_risk(assigned: pd.DataFrame) -> dict:
    """How much of the sample the displacement could have misassigned."""
    total = int(assigned["adm2_pcode"].notna().sum())
    near = int(assigned["near_border"].fillna(False).sum())
    return {
        "assigned": total,
        "unassigned": int(assigned["adm2_pcode"].isna().sum()),
        "within_5km_of_a_border": near,
        "pct_at_risk": round(100 * near / total, 1) if total else 0.0,
        "distinct_zones": int(assigned["adm2_pcode"].nunique()),
    }
