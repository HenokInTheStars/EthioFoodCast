import { num } from "@/lib/format";

/**
 * FactorBars -- what moved the score, with the honesty built in.
 *
 * Two display modes from the brief's lens table: Field shows the top three in
 * plain words, Review shows all of them with the raw measurement. In both cases
 * the header carries "sensitivities, not causes; they do not sum", because a bar
 * chart is a strong implicit claim of additivity and these are not additive.
 *
 * Bar length is |contribution|, which is a change in probability, so it is
 * bounded and comparable. Direction is stated in words as well as by side,
 * since "increases risk" pointing left is a puzzle in print.
 */

export type Factor = {
  feature: string;
  source_field: string;
  contribution: number;
  direction: string;
};

export function FactorBars({
  factors,
  limit,
  showSource = false,
}: {
  factors: Factor[];
  /** Field lens passes 3; Review passes everything it was given. */
  limit?: number;
  /** Show the raw source_field name. Field lens hides it. */
  showSource?: boolean;
}) {
  const shown = typeof limit === "number" ? factors.slice(0, limit) : factors;
  const max = shown.reduce((biggest, factor) => Math.max(biggest, Math.abs(factor.contribution)), 0);

  if (shown.length === 0) {
    return <p className="small faint">No single answer moved this score more than the rest.</p>;
  }

  return (
    <div className="factors">
      <p className="small faint">
        What moved the score, not causes. They do not add up to the score.
      </p>
      <ul className="bars">
        {shown.map((factor) => (
          <li key={`${factor.source_field}-${factor.direction}`}>
            <span className="factor-name">
              {factor.feature}
              {showSource && factor.source_field !== factor.feature ? (
                <span className="faint"> {factor.source_field}</span>
              ) : null}
            </span>
            <span className="track" aria-hidden="true">
              <span
                className={`fill ${factor.direction === "increases risk" ? "up" : "down"}`}
                style={{ width: `${max > 0 ? (Math.abs(factor.contribution) / max) * 100 : 0}%` }}
              />
            </span>
            <span className="tabular small">
              {num(factor.contribution, 3)} · {factor.direction}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
