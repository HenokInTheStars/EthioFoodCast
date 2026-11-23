"""Public entry point for Python and Streamlit clients.

UI code only needs imports from this module.
"""
import sys
from pathlib import Path

_SRC = str(Path(__file__).resolve().parent / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from ethiofoodcast.serving.api import ArtifactsMissing, Service
from ethiofoodcast.serving.bundle import IncompatibleEnvironment
from ethiofoodcast.contracts.validation import InvalidHousehold

__all__ = [
    "Service",
    "ArtifactsMissing",
    "IncompatibleEnvironment",
    "InvalidHousehold",
]
