import comparisonData from "@/data/artifacts/comparison.json";
import performanceData from "@/data/artifacts/performance.json";
import intakeData from "@/data/artifacts/intake_evaluation.json";
import { ProvenanceChip } from "@/components/provenance-chip";
import { int, num, pct } from "@/lib/format";

/**
 * /method -- what the model is, how it was measured, and where it fails.
 *
 * Two honesty constraints, both forced by the artifacts rather than chosen:
 *
 * 1. The brief names three figures for this page, but no PNG is exported into
 *    `frontend/data/`, so nothing here points at a missing image. The confusion
 *    matrix is counted from the tn/fp/fn/tp the artifact does carry rather than
 *    back-computed from a rate.
 * 2. The diet-focused benchmark scores 0.7971 against the deployed form's
 *    0.7844. That is stated plainly, with the artifact's own note that the
 *    1.3-point gap is not statistically significant (p = 0.12). A method page
 *    that quietly sorted the table to put the deployed model first would be the
 *    least trustworthy page in the product.
 */

export const metadata = { title: "EthioFoodCast â€” method" };

const comparison = comparisonData as {
  models: {
    key: string;
    label: string;
    family: string;
    accuracy_mean: number;
    roc_auc_mean: number;
    precision_mean: number;
    recall_mean: number;
    accuracy_sd: number;
  }[];
  target_accuracy: number;
  protocol: string;
};

const performance = performanceData as {
  model: string;
  training: { households: number };
  holdout_seed0: {
    accuracy: number;
    precision: number;
    recall: number;
    roc_auc: number;
    brier: number;
    n: number;
    positive_rate: number;
    tn: number;
    fp: number;
    fn: number;
    tp: number;
    precision_at_25pct: number;
    recall_at_precision_70: number;
  };
  five_split: {
    accuracy_mean: number;
    accuracy_sd: number;
    roc_auc_mean: number;
    pr_auc_mean: number;
    recall_mean: number;
    precision_mean: number;
  };
  answers: string[];
  min_answers: number;
  threshold: number;
  baseline_rate: number;
};

const intake = intakeData as {
  households: number;
  threshold: number;
  note: string;
  selection: string;
  missing_note: string;
  missing: {
    missing_rate: number;
    scored_share: number;
    accuracy: number;
    recall: number;
    roc_auc: number;
  }[];
  forms: {
    key: string;
    form: string;
    family: string;
    questions: number;
    deployed: boolean;
    accuracy: number;
    min_accuracy: number;
    split_accuracy: number[];
    recall: number;
    roc_auc: number;
  }[];
};

export default function MethodPage() {
  const holdout = performance.holdout_seed0;
  const total = holdout.tn + holdout.fp + holdout.fn + holdout.tp;
  const deployed = intake.forms.find((form) => form.deployed);
  const best = intake.forms.reduce((top, form) => (form.accuracy > top.accuracy ? form : top));

  return (
    <>
      <h1>How it works</h1>
      <p className="muted">
        EthioFoodCast uses a graph neural network: a model that learns from a household&apos;s own answers and
        also from patterns in its survey area and the areas around it. Five of these models are trained and their
        scores averaged. They learned from {int(performance.training.households)} farming households surveyed in
        2018/19 and were tested on households they had never seen, against what actually happened to those
        households in 2021/22.
      </p>

      <h2>Right and wrong calls on the test households</h2>
      <p className="small muted">
        {int(total)} test households, with households scoring above {num(performance.threshold, 2)} flagged for a
        visit.
      </p>
      <table className="confusion">
        <thead>
          <tr>
            <th />
            <th>Actually food insecure</th>
            <th>Actually food secure</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Flagged by the model</th>
            <td className="tabular strong">{int(holdout.tp)} correctly flagged</td>
            <td className="tabular">{int(holdout.fp)} flagged unnecessarily</td>
          </tr>
          <tr>
            <th scope="row">Not flagged</th>
            <td className="tabular">{int(holdout.fn)} missed</td>
            <td className="tabular">{int(holdout.tn)} correctly not flagged</td>
          </tr>
        </tbody>
      </table>
      <p className="small faint">
        {int(holdout.fn)} food-insecure households were missed and {int(holdout.fp)} food-secure
        households were flagged. Those errors pull in opposite directions: a miss means a household in
        need is not visited, a false positive means a field team spends a visit where there was
        nothing to find.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>How accurate it is</h2>
      <div className="grid">
        <div className="card">
          <h3>Accuracy</h3>
          <div className="stat">{pct(holdout.accuracy, 1)}</div>
          <div className="small faint">against a {pct(performance.baseline_rate, 1)} baseline</div>
        </div>
        <div className="card">
          <h3>Precision</h3>
          <div className="stat">{pct(holdout.precision, 1)}</div>
          <div className="small faint">of those flagged, the share actually insecure</div>
        </div>
        <div className="card">
          <h3>Recall</h3>
          <div className="stat">{pct(holdout.recall, 1)}</div>
          <div className="small faint">of the insecure, the share caught</div>
        </div>
        <div className="card">
          <h3>ROC AUC</h3>
          <div className="stat">{num(holdout.roc_auc, 3)}</div>
          <div className="small faint">how well it ranks likely cases above unlikely ones (1.0 is perfect, 0.5 is guessing)</div>
        </div>
      </div>
      <p className="small faint">
        Averaged over five independent tests: accuracy {pct(performance.five_split.accuracy_mean, 1)} (give or
        take {pct(performance.five_split.accuracy_sd, 1)}), ROC AUC {num(performance.five_split.roc_auc_mean, 2)},
        precision {pct(performance.five_split.precision_mean, 1)}, recall{" "}
        {pct(performance.five_split.recall_mean, 1)}.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Compared with other approaches</h2>
      <p className="small muted">
        Four kinds of model, all trained and tested the same way on the same five splits of the data.
      </p>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Type</th>
            <th>Accuracy (mean)</th>
            <th>ROC AUC</th>
            <th>Precision</th>
            <th>Recall</th>
          </tr>
        </thead>
        <tbody>
          {comparison.models.map((model) => (
            <tr key={model.key} className={model.key === "gcn_plus_ensemble" ? "deployed" : undefined}>
              <td>
                {model.label}
                {model.key === "gcn_plus_ensemble" ? <span className="tag ok">in use</span> : null}
              </td>
              <td className="faint small">{model.family}</td>
              <td className="tabular">{num(model.accuracy_mean, 3)}</td>
              <td className="tabular">{num(model.roc_auc_mean, 3)}</td>
              <td className="tabular">{num(model.precision_mean, 3)}</td>
              <td className="tabular">{num(model.recall_mean, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small faint">
        Results vary by about {pct(performance.five_split.accuracy_sd, 1)} from one test to the next, so differences
        smaller than about {pct(performance.five_split.accuracy_sd * 2, 1)} are within that noise: the top two
        approaches are effectively tied.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Choosing the questions</h2>
      <p className="small muted">
        Shorter and longer interviews were each tested with their own model. The rule, fixed before seeing the
        results, was at least 75% accuracy in every test and nearly as many food-insecure households found as the
        best alternative. The 14-question farming interview was chosen: it finds more food-insecure households than
        the 10-question version, and the diet-based interview&apos;s small edge was not statistically meaningful.
      </p>
      <table>
        <thead>
          <tr>
            <th>Form</th>
            <th>Questions</th>
            <th>Accuracy</th>
            <th>Worst test</th>
            <th>Recall</th>
            <th>ROC AUC</th>
          </tr>
        </thead>
        <tbody>
          {intake.forms.map((form) => (
            <tr key={form.key} className={form.deployed ? "deployed" : undefined}>
              <td>
                {form.form}
                {form.deployed ? <span className="tag ok">in use</span> : null}
              </td>
              <td className="tabular">{form.questions}</td>
              <td className="tabular">{num(form.accuracy, 4)}</td>
              <td className="tabular">{num(form.min_accuracy, 4)}</td>
              <td className="tabular">{num(form.recall, 4)}</td>
              <td className="tabular">{num(form.roc_auc, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small faint">
        The {deployed?.questions}-question interview in use scores {pct(deployed?.accuracy ?? 0, 1)} against{" "}
        {pct(best.accuracy, 1)} for the best interview tested.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>What happens to unanswered questions</h2>
      <p className="small muted">
        To test incomplete interviews, answers were randomly left blank at different rates. The app calculates
        household size and livestock totals itself and needs at least {performance.min_answers} of the{" "}
        {performance.answers.length} answers.
      </p>
      <table>
        <thead>
          <tr>
            <th>Answers left Unknown</th>
            <th>Households still scored</th>
            <th>Accuracy</th>
            <th>Recall</th>
          </tr>
        </thead>
        <tbody>
          {intake.missing.map((row) => (
            <tr key={row.missing_rate}>
              <td className="tabular">{pct(row.missing_rate, 0)}</td>
              <td className="tabular">{pct(row.scored_share, 1)}</td>
              <td className="tabular">{num(row.accuracy, 4)}</td>
              <td className="tabular">{num(row.recall, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small faint">
        A blank answer is estimated by the model, never read as zero, so a partly completed interview still gets a
        score, with less behind it.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Limits</h2>
      <ul className="plain">
        <li className="small">
          The model was built for farming households and the {performance.answers.length}-question interview; it
          has not been tested on other households or other questions.
        </li>
        <li className="small">
          The survey area has the biggest single effect on a score, so choosing the wrong area, or an area whose
          name is only approximate, matters.
        </li>
        <li className="small">
          Two of the eleven regions were not surveyed in 2021/22 and two more had too few households, so there
          is no usable evidence for four of the eleven.
        </li>
        <li className="small">
          The data is from 2018/19 to 2021/22. Conditions change; scores describe past patterns, not today.
        </li>
      </ul>

      <p className="footnote small">
        <ProvenanceChip
          source="performance.json + comparison.json + intake_evaluation.json"
          protocol={comparison.protocol}
          note="No figures are embedded: the exported artifact set carries the numbers but not the plots, so nothing here links to a missing image."
        />
      </p>
    </>
  );
}
