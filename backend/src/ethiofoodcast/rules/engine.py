"""Deterministic vulnerability -> support-category rules.

Kept entirely separate from the model. The model produces a ranked
probability; this engine produces assessment prompts. Conflating the two would
let a statistical association be read as a diagnosed cause, which Stage 8's
finding (geography carries 46.9% of attribution) makes actively misleading.
"""

from __future__ import annotations

import operator
from pathlib import Path

import yaml

OPERATORS = {
    ">": operator.gt, ">=": operator.ge,
    "<": operator.lt, "<=": operator.le,
    "==": operator.eq, "!=": operator.ne,
}

RULES_PATH = Path(__file__).with_name("recommendations.yaml")


def load_rules(path: Path | None = None) -> dict:
    with open(path or RULES_PATH, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def evaluate(household: dict, rules: dict | None = None) -> list[dict]:
    """Return every support category triggered by this household's values.

    A rule whose feature is absent simply does not fire -- a missing answer is
    not evidence of the condition, and inventing a default would manufacture
    recommendations.
    """
    rules = rules or load_rules()
    triggered = []

    for rule in rules.get("rules", []):
        condition = rule["when"]
        value = household.get(condition["feature"])
        if value is None:
            continue

        try:
            matched = OPERATORS[condition["operator"]](float(value), float(condition["value"]))
        except (TypeError, ValueError):
            continue

        if matched:
            triggered.append(
                {
                    "id": rule["id"],
                    "category": rule["category"],
                    "prompt": rule["prompt"],
                    "triggered_by": condition["feature"],
                    "value": float(value),
                }
            )

    return triggered
