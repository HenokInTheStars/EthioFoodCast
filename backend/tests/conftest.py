"""Make ``src/`` importable during tests without installing the package."""

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
SRC = APP_ROOT / "src"
for path in (APP_ROOT, SRC):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
