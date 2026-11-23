/**
 * SufficiencyMeter -- "11/14, 9 needed".
 *
 * The model was trained to accept an incomplete questionnaire: an unanswered
 * question is imputed, never treated as zero. So the reader must always be able
 * to see how much of the form the score actually had, because that is what
 * bounds how much the score means. Field lens shows the meter prominently;
 * Desk hides it (every row in the held-out list is complete); Review adds the
 * provenance of the minimum.
 */

export function SufficiencyMeter({
  supplied,
  needed,
  expected,
  showProvenance = false,
}: {
  supplied: number;
  needed: number;
  expected: number;
  showProvenance?: boolean;
}) {
  const sufficient = supplied >= needed;
  const pct = expected > 0 ? Math.min(100, (supplied / expected) * 100) : 0;
  const neededPct = expected > 0 ? Math.min(100, (needed / expected) * 100) : 0;

  return (
    <div className={sufficient ? "sufficiency ok" : "sufficiency short"}>
      <div className="meter">
        <strong className="tabular">
          {supplied}/{expected}
        </strong>
        <span className="track" aria-hidden="true">
          <span className="fill" style={{ width: `${pct}%` }} />
          <span className="needed-mark" style={{ left: `${neededPct}%` }} />
        </span>
        <span className="small">{needed} needed</span>
      </div>
      <p className="small faint">
        {sufficient
          ? "Enough answers to score. Every extra answer means less for the model to estimate."
          : `Too few answers to score. At least ${needed} of ${expected} are needed; blank answers are estimated, never read as zero.`}
      </p>
      {showProvenance ? (
        <p className="small faint">
          The minimum of {needed} was fixed in advance from how the model was tested, not chosen per
          household.
        </p>
      ) : null}
    </div>
  );
}
