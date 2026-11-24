"""Write the HTTP API's OpenAPI document to openapi.json at the repository root.

A reference copy of the API's endpoints and fields:

    npm --prefix frontend run openapi:dump

Importing the API builds the Service, so run it with the backend requirements
installed (for example the repository-root .venv).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "openapi.json"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.api_server import app  # noqa: E402  (needs ROOT on sys.path)


def main() -> None:
    OUTPUT_PATH.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
