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
      <h1>What the model is, and how well it does</h1>
      <p className="muted">{performance.model}</p>

      <h2>Confusion matrix on the held-out set</h2>
      <p className="small muted">
        {int(total)} held-out households, flag threshold {num(performance.threshold, 3)}. Counted from
        the artifact, not back-computed from a rate.
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
            <td className="tabular strong">{int(holdout.tp)} true positive</td>
            <td className="tabular">{int(holdout.fp)} false positive</td>
          </tr>
          <tr>
            <th scope="row">Not flagged</th>
            <td className="tabular">{int(holdout.fn)} false negative</td>
            <td className="tabular">{int(holdout.tn)} true negative</td>
          </tr>
        </tbody>
      </table>
      <p className="small faint">
        {int(holdout.fn)} food-insecure households were missed and {int(holdout.fp)} food-secure
        households were flagged. Those errors pull in opposite directions: a miss means a household in
        need is not visited, a false positive means a field team spends a visit where there was
        nothing to find.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Held-out metrics</h2>
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
          <div className="small faint">ranking quality, independent of threshold</div>
        </div>
      </div>
      <p className="small faint">
        Five-split means: accuracy {num(performance.five_split.accuracy_mean, 3)} (sd{" "}
        {num(performance.five_split.accuracy_sd, 3)}), ROC AUC{" "}
        {num(performance.five_split.roc_auc_mean, 3)}, precision{" "}
        {num(performance.five_split.precision_mean, 3)}, recall{" "}
        {num(performance.five_split.recall_mean, 3)}. Brier {num(holdout.brier, 3)}.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Against the other families</h2>
      <p className="small muted">{comparison.protocol}</p>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Family</th>
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
                {model.key === "gcn_plus_ensemble" ? <span className="tag ok">deployed</span> : null}
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
        Target accuracy {num(comparison.target_accuracy, 2)}. Seed-to-seed spread is roughly plus or
        minus {num(performance.five_split.accuracy_sd, 3)}, so differences smaller than about{" "}
        {num(performance.five_split.accuracy_sd * 2, 3)} are inside the noise and the ordering of the
        top two should not be read as decisive.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Which questions were asked</h2>
      <p className="small muted">{intake.note}</p>
      <p className="small notice">{intake.selection}</p>
      <table>
        <thead>
          <tr>
            <th>Form</th>
            <th>Questions</th>
            <th>Accuracy</th>
            <th>Worst split</th>
            <th>Recall</th>
            <th>ROC AUC</th>
          </tr>
        </thead>
        <tbody>
          {intake.forms.map((form) => (
            <tr key={form.key} className={form.deployed ? "deployed" : undefined}>
              <td>
                {form.form}
                {form.deployed ? <span className="tag ok">deployed</span> : null}
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
        Each form has its own separately trained graph model, so a shorter form is not this form with
        questions removed, which is why the comparison is reported here rather than offered as a
        toggle. The deployed {deployed?.questions}-question form scores{" "}
        {num(deployed?.accuracy ?? 0, 4)} against {num(best.accuracy, 4)} for the best form measured.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>What happens to unanswered questions</h2>
      <p className="small muted">{intake.missing_note}</p>
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
        An unanswered question is imputed, never read as zero, so a partly filled questionnaire
        produces a weaker score rather than a refusal, and {performance.min_answers} of{" "}
        {performance.answers.length} answers is the floor.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Caveats</h2>
      <ul className="plain">
        <li className="small">
          The deployed form is the {performance.answers.length}-question graph form and{" "}
          {performance.min_answers} answers are enough to score. Any documentation describing a
          75-feature ExtraTrees model does not describe this one.
        </li>
        <li className="small">
          The surveyed area supplies graph context and carries the largest single share of
          sensitivity, so an area name that was inferred rather than verified affects the score.
        </li>
        <li className="small">
          Two of the eleven regions were not surveyed in the wave these households come from, and two
          more had too few households to report, so the model has no usable evidence in four of the
          eleven.
        </li>
        <li className="small">
          This is a prioritisation instrument. A score is a lead for a human assessment, never an
          eligibility decision.
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
