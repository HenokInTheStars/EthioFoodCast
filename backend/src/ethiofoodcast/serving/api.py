"""The interface a Streamlit app consumes.

Streamlit runs Python in-process, so this is a module the app imports, not a
REST service -- an HTTP hop between two halves of the same process buys
nothing and adds a failure mode. Every function here returns plain dicts,
lists and DataFrames that a page can render directly.

The contract, in one line: **the app never recomputes anything.** It collects
inputs, calls a function, and displays what comes back. All feature
engineering, preprocessing, scoring, segmentation and rule evaluation happen
behind these functions, using the same code path as training.

Typical use::

    import streamlit as st
    from ethiofoodcast.serving import api

    @st.cache_resource
    def service():
        return api.Service()

    svc = service()
    form = svc.input_schema(short_form=True)      # build widgets from this
    result = svc.predict(collected_values)        # score one household
    st.metric("Risk", f"{result['probability']:.0%}", result['risk_band'])

If a page needs a REST boundary later (a non-Python frontend, say), wrap these
same functions in FastAPI -- the signatures are already JSON-shaped.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

from ..config import paths
from ..export.privacy import CAVEATS
from .bundle import RISK_BANDS, ModelBundle, load
from .derive import DERIVED, answered, consistency_problems, derive
from ..contracts.validation import MIN_FIELDS_FOR_BAND, InvalidHousehold

UI_DIR = paths.ARTIFACTS_DIR / "ui"
GRAPH_UI_DIR = paths.ARTIFACTS_DIR / "ui_graph"
BUNDLE_PATH = paths.ARTIFACTS_DIR / "model_bundle.joblib"
SCHEMA_PATH = paths.ARTIFACTS_DIR / "feature_schema.json"


class ArtifactsMissing(RuntimeError):
    """Raised with a usable instruction rather than a bare FileNotFoundError."""


def _read_json(path: Path):
    if not path.exists():
        raise ArtifactsMissing(
            f"{path.name} not found in {path.parent}. The model and dashboard files "
            "ship with the repository; restore them with: git checkout -- backend/artifacts"
        )
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


class Service:
    """Everything a Streamlit page needs, loaded once.

    Wrap construction in ``@st.cache_resource`` so the model is deserialised
    once per server rather than on every widget interaction.
    """

    def __init__(self, bundle_path: Path | None = None):
        path = bundle_path or BUNDLE_PATH
        if not path.exists():
            raise ArtifactsMissing(
                f"{path.name} not found in {path.parent}. The model and dashboard files "
                "ship with the repository; restore them with: git checkout -- backend/artifacts"
            )
        self.bundle: ModelBundle = load(path)
        # Prefer the schema carried inside the bundle: reading the global file
        # let a custom model path be validated against a different model's
        # ranges and codes.
        self._schema = getattr(self.bundle, "schema", None) or _read_json(SCHEMA_PATH)
        self.graph = None
        graph_path = path.parent / "graph_serving.joblib"
        if bundle_path is None and graph_path.exists():
            import joblib
            self.graph = joblib.load(graph_path)

    # ---------------------------------------------------------------- inputs

    def input_schema(self, short_form: bool = False) -> dict[str, list[dict]]:
        """Form specification, grouped, ready to build widgets from.

        ``short_form=True`` returns only the ~15 highest-SHAP fields. A real
        intake form cannot ask 74 questions, and the model tolerates missing
        inputs -- they are imputed exactly as they were during training.
        """
        fields = [f for f in self._schema if f["required"]] if short_form else self._schema

        grouped: dict[str, list[dict]] = {}
        for field in fields:
            grouped.setdefault(field["group"], []).append(field)
        return grouped

    def defaults(self, short_form: bool = False) -> dict[str, float]:
        """Median value for every field, for pre-filling a form."""
        fields = [f for f in self._schema if f["required"]] if short_form else self._schema
        return {f["name"]: f["median_default"] for f in fields}

    # --------------------------------------------------------------- scoring

    def predict(self, household: dict) -> dict:
        """Score one household.

        Unsupplied fields are imputed. The result carries its own caveats;
        display them alongside the number, not behind a link.
        """
        if not isinstance(household, dict):
            return self.bundle.predict(household)       # raises InvalidHousehold
        problems = consistency_problems(household)
        if problems:
            raise InvalidHousehold(self._readable("; ".join(problems)))
        # Which model scores this request: the graph model when a survey area is given,
        # otherwise the legacy ExtraTrees bundle. Each is judged against its OWN schema.
        area = household.get("area_id")
        use_graph = self.graph is not None and area is not None and not (isinstance(area, str) and not area.strip())
        schema = {f["name"]: f for f in (self.graph.schema if use_graph else self._schema)}
        set_aside = []
        if use_graph:
            # Answers that are real survey questions but not inputs of this (form-specific) model are
            # set aside with a warning instead of rejected, so older forms keep working. Typos -- names
            # that are no known question at all -- still reach validation and are rejected there.
            recognised = {f["name"] for f in self._schema} | {c for srcs in DERIVED.values() for c in srcs} | set(DERIVED)
            set_aside = sorted(k for k in household if k not in schema and k != "area_id" and k in recognised)
            household = {k: v for k, v in household.items() if k not in set_aside}
        # Sufficiency counts only questions answered about the household. Region and the farming
        # flag are set by the form, and calculated summaries add no information, so neither counts.
        n_answered = sum(1 for k in answered(household)
                         if k in schema and schema[k].get("used_for", "model") in ("model", "question")
                         and k not in ("w4_region", "is_agricultural"))
        # A form-specific model states how many of its own answers it was validated with.
        minimum = int(self.graph.metadata.get("min_answers", MIN_FIELDS_FOR_BAND)) if use_graph else MIN_FIELDS_FOR_BAND
        original = household
        if n_answered >= minimum:
            # Summaries (coping score, dependency ratio, food groups...) are computed from the
            # underlying answers exactly as in training; keep only those this model knows.
            household = {k: v for k, v in derive(household).items() if k in household or k in schema}
        try:
            if self.graph is not None:
                known = set(schema)
                result = self.graph.predict(household, self.bundle, original=original,
                                            derive_fn=lambda h: {k: v for k, v in derive(h).items() if k in h or k in known})
            else:
                result = self.bundle.predict(household)
        except InvalidHousehold as error:
            # Name each field the way the form labels it, not by its schema name.
            raise InvalidHousehold(self._readable(str(error))) from error
        if n_answered < minimum and result.get("probability") is not None:
            # Only this check blocks the estimate (the model's own check counted region or summaries).
            result.update(probability=None, risk_band="Insufficient data", sufficient_data=False,
                          flagged=False, top_factors=[], recommendations=[])
            result["warnings"] = list(result.get("warnings", [])) + [
                f"only {n_answered} question(s) answered about the household itself; at least "
                f"{minimum} are needed for an estimate. Region and calculated summaries do not count."]
        if set_aside:
            labels = self.field_labels()
            result["warnings"] = list(result.get("warnings", [])) + [
                f"{len(set_aside)} answer(s) are not used by this model and were set aside: "
                + ", ".join(labels.get(k, k) for k in set_aside[:8]) + ("..." if len(set_aside) > 8 else "")]
        # Reported as questions answered about the household, not model inputs.
        result["n_predictive_supplied"] = n_answered
        # `feature` is display text (the documented contract); graph factors arrive
        # with the schema name in it, so give them the form's label. `source_field`
        # keeps the schema name for joining. The legacy no-area response is unchanged.
        if use_graph:
            labels = self.field_labels()
            for factor in result.get("top_factors") or []:
                if factor.get("feature") == factor.get("source_field"):
                    factor["feature"] = labels.get(factor["source_field"], factor["feature"])
        return result

    def _readable(self, message: str) -> str:
        """Replace a leading schema field name in each '; '-separated problem with its label."""
        labels = self.field_labels()
        parts = []
        for part in message.split("; "):
            field, sep, rest = part.partition(":")
            parts.append(f"{labels[field]}:{rest}" if sep and field in labels else part)
        return "; ".join(parts)

    def areas(self) -> list[dict]:
        """Supported surveyed areas; send the opaque `id` as optional area_id.

        Each area also carries readable names from artifacts/ui_graph/area_names.json:
        region_name, zone, woreda and whether each name is verified against the
        survey's own zone/woreda codes. `label` is the woreda-level display name
        ("(approx.)" when unverified). Names only -- no coordinates are served.
        """
        if self.graph is None:
            return []
        path = GRAPH_UI_DIR / "area_names.json"
        names = _read_json(path)["areas"] if path.exists() else {}
        out = []
        for index, area in enumerate(self.graph.areas):
            record = dict(area)
            record["survey_label"] = area["label"]            # the original "Survey area NNN"
            record.update(names.get(area["id"], {}))
            record["index"] = index
            out.append(record)
        return out

    @staticmethod
    def area_names_summary() -> dict:
        """How reliable the zone/woreda names are (verification against survey codes)."""
        path = GRAPH_UI_DIR / "area_names.json"
        return _read_json(path)["summary"] if path.exists() else {}

    def graph_performance(self) -> dict:
        """Graph-specific evidence stored with the model (metrics, five-split summary)."""
        return dict(self.graph.performance) if self.graph is not None else {}

    def graph_input_schema(self) -> dict[str, list[dict]]:
        """Optional full graph form; existing input_schema() is unchanged."""
        grouped = {}
        for field in self.graph.schema if self.graph is not None else []:
            grouped.setdefault(field["group"], []).append(dict(field))
        return grouped

    # ---- intake form -------------------------------------------------------
    # Questions a field worker asks, in interview order. The short form is the 16-question
    # interview measured on held-out households (Methodology page); the full form adds the
    # rest of the interview, the farm profile and, marked as such, spending from records.
    SHORT_FORM = ("prior_fi_s8q01", "prior_fi_s8q04", "prior_fi_s8q06", "prior_fi_cope_less_preferred",
                  "econ_n_asset_types", "econ_total_assets", "diet_n_items", "diet_cereals", "diet_pulses_nuts",
                  "diet_seeds", "diet_vegetables", "diet_fruit", "diet_roots", "diet_meat_fish", "diet_dairy", "diet_eggs")
    # Never asked: survey bookkeeping counts, shares a worker cannot estimate, statistician-computed
    # scales, and map/satellite measurements (left unknown; the model imputes them as in training).
    NOT_ASKED = {"diet_n_items_unknown", "diet_purchased_n_observed", "diet_own_n_observed", "diet_gift_n_observed",
                 "diet_spending_n_observed", "diet_purchased_item_fraction", "diet_own_item_fraction",
                 "diet_gift_item_fraction", "adult_equivalents"}
    GROUP_OF = {"n_holders": "Household", "n_children": "Household", "n_elderly": "Household",
                "n_working_age": "Household", "share_female": "Household", "hh_size": "Household",
                "head_age": "Household", "head_is_male": "Household", "dependency_ratio": "Household",
                "cons_total_annual": "Spending (from records, optional)", "cons_per_adult_eq": "Spending (from records, optional)",
                "cons_food_annual": "Spending (from records, optional)", "cons_quintile": "Spending (from records, optional)",
                "cons_food_share": "Spending (from records, optional)"}
    GROUP_ORDER = ("Household", "Land and crops", "Livestock", "Livelihood and income", "Food-security history",
                   "Diet and food consumption", "Spending (from records, optional)")

    @classmethod
    def group_for(cls, name: str, default: str) -> str:
        """Interview section of a question: household, land and crops, livestock, livelihood..."""
        if name in cls.GROUP_OF:
            return cls.GROUP_OF[name]
        if name.startswith(("land_", "crop_", "harvest_")):
            return "Land and crops"
        if name.startswith(("livestock_", "q_cattle", "q_calves", "q_sheep", "q_camels", "q_poultry", "q_horses",
                            "q_donkeys", "q_bee")):
            return "Livestock"
        if name.startswith("econ_"):
            return "Livelihood and income"
        return "Other" if default in ("Farm profile (segmentation only)", "Farm") else default

    def form_answers(self) -> tuple[str, ...]:
        """The questions the deployed model was trained and validated on (its 'short form')."""
        if self.graph is not None and self.graph.metadata.get("answers"):
            return tuple(self.graph.metadata["answers"])
        return self.SHORT_FORM

    def graph_form(self, short: bool = True) -> dict[str, list[dict]]:
        """Questions a person can answer, grouped in interview order.

        Left out: region/farming flag (set by the location step), summaries the
        backend calculates (derive.DERIVED) when their questions exist in this
        model's schema, NOT_ASKED fields, and location data (geo_*, soil,
        agro-ecology), which stay unknown or are filled from the survey area.
        """
        by_name = {f["name"]: f for f in (self.graph.schema if self.graph is not None else self._schema)}
        # Summaries (ratios, scores, counts) are never asked. The backend calculates them when their
        # questions are in this model's schema; otherwise they stay Unknown (segment/rules only).
        # Exception: a summary the model was trained to take as a direct answer (required).
        calculated = {k for k in DERIVED if not by_name.get(k, {}).get("required")}
        location = {n for n in by_name if n.startswith(("geo_", "wub_soil_", "wub_aez_", "wub_dist_border"))}
        skip = calculated | location | self.NOT_ASKED | {"w4_region", "is_agricultural"}
        names = [n for n in self.form_answers() if n in by_name] if short else list(by_name)
        grouped: dict[str, list[dict]] = {}
        for name in names:
            if name in skip:
                continue
            record = dict(by_name[name])
            record["group"] = self.group_for(name, record["group"])
            grouped.setdefault(record["group"], []).append(record)
        order = {g: i for i, g in enumerate(self.GROUP_ORDER)}
        return dict(sorted(grouped.items(), key=lambda kv: order.get(kv[0], len(order))))

    @staticmethod
    def derived_fields() -> dict[str, list[str]]:
        """Summary field -> the answered fields it is computed from."""
        return {k: list(v) for k, v in DERIVED.items()}

    # -------------------------------------------------- graph (GCN) dashboard
    #
    # Built from seed-0 HELD-OUT agricultural households scored by the deployed
    # GCN ensemble, so every figure is out-of-sample for this model. These files
    # contain aggregates and an anonymised household list only.

    @staticmethod
    def graph_comparison() -> dict:
        """Four model families (neural, bagging, boosting, baseline) under one protocol."""
        return _read_json(GRAPH_UI_DIR / "comparison.json")

    @staticmethod
    def graph_regional_summary() -> list[dict]:
        """Per-region GCN risk for the map; cells under 25 households are suppressed."""
        return _read_json(GRAPH_UI_DIR / "regional_summary.json")

    @staticmethod
    def graph_risk_distribution() -> dict:
        return _read_json(GRAPH_UI_DIR / "risk_distribution.json")

    @staticmethod
    def graph_drivers() -> dict:
        """GCN occlusion drivers by field and by domain (model behaviour, not causes)."""
        return _read_json(GRAPH_UI_DIR / "drivers.json")

    @staticmethod
    def graph_dashboard_performance() -> dict:
        return _read_json(GRAPH_UI_DIR / "performance.json")

    def graph_scored_households(self) -> pd.DataFrame:
        """Anonymised held-out planning list: surrogate id, region, area, risk, segment, factors.

        The list was built with "Survey area NNN" labels; readable zone/woreda names are
        substituted here (area_label), and the zone is added for filtering.
        """
        frame = pd.DataFrame(_read_json(GRAPH_UI_DIR / "scored_households.json"))
        by_survey_label = {a["survey_label"]: a for a in self.areas()}
        frame["zone"] = frame["area_label"].map(lambda label: by_survey_label.get(label, {}).get("zone"))
        frame["area_label"] = frame["area_label"].map(lambda label: by_survey_label.get(label, {}).get("label", label))
        return frame

    @staticmethod
    def graph_intake_evaluation() -> dict:
        """Held-out accuracy when only realistic intake questions are answered."""
        return _read_json(GRAPH_UI_DIR / "intake_evaluation.json")

    @staticmethod
    def cluster_profiles() -> list[dict]:
        """Segment profiles: raw means and z-scores of the segmentation variables."""
        return _read_json(GRAPH_UI_DIR / "cluster_profiles.json")

    @staticmethod
    def regions() -> list[dict]:
        """Survey region codes (w4_region) and names; SNNP uses its 2018 boundary."""
        return _read_json(GRAPH_UI_DIR / "regions.json")

    @staticmethod
    def field_labels() -> dict[str, str]:
        """Human-readable labels for schema fields and factor names."""
        return _read_json(GRAPH_UI_DIR / "field_labels.json")

    @staticmethod
    def field_help() -> dict[str, str]:
        """One or two plain-language sentences per field: the question, units and how to answer."""
        return _read_json(GRAPH_UI_DIR / "field_help.json")

    def predict_batch(self, frame: pd.DataFrame) -> pd.DataFrame:
        """Score an uploaded table, one row per household.

        Predictors and everything else are separated **at the frame level**
        before validation. A real upload carries identifiers, reference codes
        and free-text notes whose names cannot be anticipated by an allowlist,
        and rejecting the whole file because of an extra column made the batch
        path unusable. Unrecognised columns are carried through untouched and
        never scored.

        Returns the input with probability, band, cluster and rule count
        appended, sorted by risk -- the order an assessment list wants.
        """
        known = {entry["name"] for entry in self._schema}
        if self.graph is not None:
            known.add("area_id")
            known.update(entry["name"] for entry in self.graph.schema)
        predictors = [c for c in frame.columns if c in known]
        passthrough = [c for c in frame.columns if c not in known]

        if passthrough:
            # Announced, not silent: a mistyped feature name looks exactly
            # like a notes column, and the caller should see which is which.
            self.last_passthrough_columns = passthrough

        results = [
            self.predict(row.to_dict())
            for _, row in frame[predictors].iterrows()
        ]

        out = frame.copy()
        out["probability"] = [r["probability"] for r in results]
        out["risk_band"] = [r["risk_band"] for r in results]
        out["cluster"] = [
            (r["cluster"] or {}).get("name", "unknown") for r in results
        ]
        out["n_recommendations"] = [len(r["recommendations"]) for r in results]
        return out.sort_values("probability", ascending=False).reset_index(drop=True)

    def explain(self, household: dict, top_n: int = 6) -> list[dict]:
        """Per-household contributing factors, strongest first."""
        return self.predict(household)["top_factors"][:top_n]

    # -------------------------------------------------------------- planning

    def capacity_plan(self, scored: pd.DataFrame, capacity: int) -> dict:
        """Who to visit when only `capacity` assessments are possible.

        This is the question the system exists to answer, so it is a
        first-class function rather than something the page infers.

        Three things it does not assume: that the caller sorted the table,
        that every row has a probability, and that a benchmark measured at one
        coverage applies at another.
        """
        # Rows without a probability cannot be ranked. Including them put an
        # unscored household on an assessment list.
        unscored = scored[scored["probability"].isna()]
        rankable = (
            scored[scored["probability"].notna()]
            # Sorting here rather than trusting the caller: `predict_batch`
            # sorts, but a hand-built frame does not, and the unsorted case
            # silently returned the lowest-risk households.
            .sort_values("probability", ascending=False)
            .reset_index(drop=True)
        )

        capacity = max(0, min(int(capacity), len(rankable)))
        selected = rankable.head(capacity)
        coverage = capacity / len(rankable) if len(rankable) else 0.0

        plan = {
            "capacity": capacity,
            "n_households": len(scored),
            "n_rankable": len(rankable),
            "n_unscored": len(unscored),
            "unscored": unscored,
            "coverage_pct": round(100 * coverage, 1),
            "selected": selected,
            "mean_risk_selected": round(float(selected["probability"].mean()), 3)
            if capacity
            else None,
        }

        # There is no validated precision-at-capacity curve, only a single
        # historical figure measured at the top 25% on past data. Calling it
        # "expected precision" implied a forecast for this list; it is not
        # one, at any coverage, so it is named for what it is.
        benchmark = self.performance().get("precision_at_25pct")
        plan["historical_precision_at_25pct"] = benchmark
        plan["precision_note"] = (
            f"{benchmark:.0%} of the top quarter were food insecure in past "
            f"evaluation. This request covers {100 * coverage:.0f}%. That "
            "figure is a historical benchmark at one coverage level, not a "
            "prediction for this list -- precision falls as coverage widens, "
            "and no validated precision-at-capacity curve has been measured."
        ) if benchmark else "no measured benchmark available"

        # Always present. A key that appears only in one branch makes every
        # caller a conditional, and the app crashed with KeyError the first
        # time a clean upload had nothing to exclude.
        plan["note"] = (
            f"{len(unscored)} household(s) supplied too little information to "
            "rank and are excluded from the plan, not ranked last."
            if len(unscored)
            else "All households had enough information to be ranked."
        )
        return plan

    # ------------------------------------------------------------- dashboard

    # Dashboard methods under their original names. They describe the deployed
    # graph model (held-out households), the same data as the graph_* methods.

    def risk_distribution(self) -> dict:
        return self.graph_risk_distribution()

    def regional_summary(self) -> pd.DataFrame:
        """Region-level aggregates. Cells under 25 households are suppressed."""
        return pd.DataFrame(self.graph_regional_summary())

    @staticmethod
    def clusters() -> pd.DataFrame:
        """Vulnerability segments of the segmentation model (shared by both models)."""
        return pd.DataFrame(_read_json(UI_DIR / "clusters.json"))

    def global_drivers(self) -> pd.DataFrame:
        """Share of prediction sensitivity by section -- what the model keys on overall."""
        return pd.DataFrame(self.graph_drivers()["domains"])

    def performance(self) -> dict:
        """Held-out metrics of the deployed graph model, flat, plus the five-split summary."""
        dashboard = self.graph_dashboard_performance()
        five = dashboard["five_split"]
        return {**dashboard["holdout_seed0"], "model": dashboard["model"], "threshold": dashboard["threshold"],
                "five_split": five, "evaluation_complete": len(five["seed_accuracy"]) == 5,
                "folds_used": len(five["seed_accuracy"]),
                "evaluation": ("Five systematic within-area 75/25 splits; settings and threshold chosen on validation "
                               "households, each test split scored once. holdout metrics are the exported seed-0 model.")}

    def scored_households(self) -> pd.DataFrame:
        """Pre-scored held-out sample, anonymised. Surrogate ids only, no coordinates."""
        return self.graph_scored_households()

    # ----------------------------------------------------------------- meta

    def version(self) -> dict:
        return self.bundle.version()

    def graph_version(self) -> dict:
        """Identity of the model that scores requests carrying an area_id."""
        return dict(self.graph.metadata) if self.graph is not None else self.bundle.version()

    @staticmethod
    def caveats() -> list[str]:
        """Limitations that must appear wherever a number is displayed."""
        return CAVEATS

    @staticmethod
    def risk_bands() -> list[dict]:
        return [
            {"label": label, "lower": low, "upper": min(high, 1.0)}
            for low, high, label in RISK_BANDS
        ]


@lru_cache(maxsize=1)
def get_service() -> Service:
    """Process-wide singleton, for apps not using ``st.cache_resource``."""
    return Service()
