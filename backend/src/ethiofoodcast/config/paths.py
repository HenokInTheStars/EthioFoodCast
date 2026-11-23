"""Filesystem layout.

Every path in the project resolves from here. Nothing else builds a path by
string concatenation, so the same code runs on Windows, macOS and Linux.
"""

from __future__ import annotations

import os
from pathlib import Path

# paths.py -> config -> ethiofoodcast -> src -> <repo root>
PROJECT_ROOT: Path = Path(__file__).resolve().parents[3]

DATA_DIR: Path = Path(os.getenv("ETHIOFOODCAST_DATA", PROJECT_ROOT / "data"))

RAW_ZIP_DIR: Path = DATA_DIR / "raw_zips"
RAW_DIR: Path = DATA_DIR / "raw"
W4_CSV_DIR: Path = RAW_DIR / "wave4"
W5_SAV_DIR: Path = RAW_DIR / "wave5_sav"
W5_CSV_DIR: Path = RAW_DIR / "wave5_csv"
W5_CODEBOOK_DIR: Path = W5_CSV_DIR / "_codebook"

INTERIM_DIR: Path = DATA_DIR / "interim"
PROCESSED_DIR: Path = DATA_DIR / "processed"

REPORTS_DIR: Path = PROJECT_ROOT / "reports"
FIGURES_DIR: Path = REPORTS_DIR / "figures"
TABLES_DIR: Path = REPORTS_DIR / "tables"

ARTIFACTS_DIR: Path = PROJECT_ROOT / "artifacts"

# Where to look for the survey archives on first run. Stage 0 copies them into
# RAW_ZIP_DIR so the repo stops depending on one machine's Downloads folder.
ZIP_SOURCE_DIR: Path = Path(
    os.getenv("ETHIOFOODCAST_ZIP_SOURCE", Path.home() / "Downloads")
)

W4_ZIP_NAME = "ETH_2018_ESS_v04_M_CSV.zip"
W5_ZIP_NAME = "ETH_2021_ESPS-W5_v03_M_SPSS.zip"

ALL_DIRS = (
    RAW_ZIP_DIR,
    W4_CSV_DIR,
    W5_SAV_DIR,
    W5_CSV_DIR,
    W5_CODEBOOK_DIR,
    INTERIM_DIR,
    PROCESSED_DIR,
    FIGURES_DIR,
    TABLES_DIR,
    ARTIFACTS_DIR,
)


def ensure_dirs() -> None:
    """Create the full data/report tree. Idempotent."""
    for directory in ALL_DIRS:
        directory.mkdir(parents=True, exist_ok=True)
