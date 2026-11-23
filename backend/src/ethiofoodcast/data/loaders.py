"""Module readers.

After Stage 1a both waves are CSV, so there is one reader for everything:
``read_module(wave, name)``. The SPSS path exists only inside the conversion
step; no analysis code touches a .sav file.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from ..config import paths
from ..config.constants import ID_COLUMNS
from .ids import normalise_ids

_WAVE_DIRS = {4: paths.W4_CSV_DIR, 5: paths.W5_CSV_DIR}


def _id_dtypes(columns: list[str]) -> dict[str, str]:
    """Force every known id column to string at read time."""
    return {c: "string" for c in columns if c in ID_COLUMNS}


def read_csv_safe(path: Path, **kwargs) -> pd.DataFrame:
    """Read a CSV with id columns preserved as zero-padded strings.

    Peeks at the header first so ``dtype`` can be set per column — reading the
    whole frame and casting afterwards would be too late, because pandas has
    already turned '010101...' into a float by then.
    """
    header = pd.read_csv(path, nrows=0)
    dtypes = _id_dtypes(list(header.columns))
    frame = pd.read_csv(
        path, dtype=dtypes, keep_default_na=True, low_memory=False, **kwargs
    )
    return normalise_ids(frame)


def read_module(wave: int, name: str, **kwargs) -> pd.DataFrame:
    """Read one survey module by logical name, e.g. ``read_module(5, 'sect8_hh_w5')``."""
    directory = _WAVE_DIRS.get(wave)
    if directory is None:
        raise ValueError(f"wave must be 4 or 5, got {wave!r}")

    path = directory / f"{name}.csv"
    if not path.exists():
        available = sorted(p.stem for p in directory.glob("*.csv"))
        raise FileNotFoundError(
            f"{path} not found. {len(available)} modules available in {directory}; "
            f"did Stage 1a run? e.g. {available[:5]}"
        )
    return read_csv_safe(path, **kwargs)


def read_from_zip(zip_path: Path, member: str, **kwargs) -> pd.DataFrame:
    """Read a CSV directly out of an archive, used by Stage 0's smoke test."""
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(member) as handle:
            header = pd.read_csv(handle, nrows=0)
        with archive.open(member) as handle:
            frame = pd.read_csv(
                handle,
                dtype=_id_dtypes(list(header.columns)),
                low_memory=False,
                **kwargs,
            )
    return normalise_ids(frame)


def list_modules(wave: int) -> list[str]:
    """Names of the converted CSV modules available for a wave."""
    directory = _WAVE_DIRS[wave]
    return sorted(p.stem for p in directory.glob("*.csv"))
