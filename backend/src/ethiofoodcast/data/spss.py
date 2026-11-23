"""SPSS -> CSV conversion (Stage 1a).

Wave 5 ships as .sav. Converting once up front means everything downstream
reads CSV, but a naive dump would throw away what .sav gives us for free: the
variable labels, the value labels and the declared user-missing ranges. Those
are written beside each CSV as codebook sidecars, and are later used to
validate the Wave 4 decode, where the same question appears in both waves.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ..config import paths
from ..config.constants import ID_COLUMNS
from .ids import assert_ids_intact, normalise_ids


@dataclass
class ConversionResult:
    module: str
    rows: int
    columns: int
    checks: dict[str, bool] = field(default_factory=dict)
    note: str = ""

    @property
    def passed(self) -> bool:
        return all(self.checks.values())


def _write_codebook(meta, module: str, out_dir: Path) -> None:
    """Persist variable labels, value labels and missing ranges."""
    out_dir.mkdir(parents=True, exist_ok=True)

    variables = pd.DataFrame(
        {
            "column": list(meta.column_names),
            "label": [
                meta.column_names_to_labels.get(c, "") for c in meta.column_names
            ],
        }
    )
    variables.to_csv(out_dir / f"{module}__variables.csv", index=False)

    value_rows = [
        {"column": column, "code": code, "label": label}
        for column, mapping in (meta.variable_value_labels or {}).items()
        for code, label in mapping.items()
    ]
    pd.DataFrame(
        value_rows or [], columns=["column", "code", "label"]
    ).to_csv(out_dir / f"{module}__values.csv", index=False)

    missing_rows = [
        {"column": column, "lo": entry.get("lo"), "hi": entry.get("hi")}
        for column, ranges in (getattr(meta, "missing_ranges", None) or {}).items()
        for entry in ranges
    ]
    pd.DataFrame(
        missing_rows or [], columns=["column", "lo", "hi"]
    ).to_csv(out_dir / f"{module}__missing.csv", index=False)


def convert_one(
    sav_path: Path,
    csv_dir: Path,
    codebook_dir: Path,
    *,
    force: bool = False,
) -> ConversionResult:
    """Convert a single .sav to CSV and verify the result.

    Reads with ``apply_value_formats=False`` so the CSV holds numeric codes;
    the labels live in the sidecars instead. Applying formats would bake label
    strings into the data and turn numerics into categoricals.
    """
    import pyreadstat  # imported lazily so Stage 0 can report a clean message

    module = sav_path.stem
    csv_path = csv_dir / f"{module}.csv"

    if csv_path.exists() and not force:
        if csv_path.stat().st_mtime >= sav_path.stat().st_mtime:
            frame = pd.read_csv(csv_path, nrows=0)
            return ConversionResult(
                module=module,
                rows=-1,
                columns=len(frame.columns),
                checks={"skipped_up_to_date": True},
                note="up to date, skipped",
            )

    frame, meta = pyreadstat.read_sav(str(sav_path), apply_value_formats=False)

    source_rows, source_cols = frame.shape
    numeric_means_before = frame.select_dtypes("number").mean(numeric_only=True)

    # Ids must become strings BEFORE they are written, or the zeros are gone.
    frame = normalise_ids(frame)

    csv_dir.mkdir(parents=True, exist_ok=True)
    frame.to_csv(csv_path, index=False, encoding="utf-8", na_rep="")
    _write_codebook(meta, module, codebook_dir)

    # --- verification: re-read from disk and compare to the source ---
    id_present = [c for c in ID_COLUMNS if c in frame.columns]
    reread = pd.read_csv(
        csv_path, dtype={c: "string" for c in id_present}, low_memory=False
    )

    checks = {
        "row_count": len(reread) == source_rows,
        "column_count": len(reread.columns) == source_cols,
    }

    if "household_id" in reread.columns:
        try:
            assert_ids_intact(reread, "household_id")
            checks["id_integrity"] = reread["household_id"].astype("string").equals(
                frame["household_id"].astype("string")
            )
        except ValueError:
            checks["id_integrity"] = False
    else:
        checks["id_integrity"] = True  # module is not household-keyed

    numeric_means_after = reread.select_dtypes("number").mean(numeric_only=True)
    shared = numeric_means_before.index.intersection(numeric_means_after.index)
    before_means = numeric_means_before[shared]
    after_means = numeric_means_after[shared]

    # An entirely empty column has a NaN mean on both sides. `NaN <= tol` is
    # False, so comparing naively flags a faithful conversion as broken --
    # both-NaN is agreement, not disagreement.
    both_empty = before_means.isna() & after_means.isna()
    within_tolerance = (before_means - after_means).abs().le(
        1e-6 * before_means.abs().clip(lower=1.0)
    )
    checks["numeric_fidelity"] = bool((within_tolerance | both_empty).all())

    return ConversionResult(
        module=module, rows=source_rows, columns=source_cols, checks=checks
    )


def convert_all(
    sav_dir: Path | None = None,
    csv_dir: Path | None = None,
    codebook_dir: Path | None = None,
    *,
    force: bool = False,
) -> pd.DataFrame:
    """Convert every .sav in `sav_dir`; return the verification report."""
    sav_dir = sav_dir or paths.W5_SAV_DIR
    csv_dir = csv_dir or paths.W5_CSV_DIR
    codebook_dir = codebook_dir or paths.W5_CODEBOOK_DIR

    sav_files = sorted(sav_dir.rglob("*.sav"))
    if not sav_files:
        raise FileNotFoundError(f"no .sav files under {sav_dir}")

    results = [
        convert_one(p, csv_dir, codebook_dir, force=force) for p in sav_files
    ]

    return pd.DataFrame(
        [
            {
                "module": r.module,
                "rows": r.rows,
                "columns": r.columns,
                "passed": r.passed,
                "note": r.note,
                **{f"check_{k}": v for k, v in r.checks.items()},
            }
            for r in results
        ]
    )
