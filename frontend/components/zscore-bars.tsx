import { num } from "@/lib/format";

/**
 * ZScoreBars -- the five cluster profiles as z-scores, per the brief.
 *
 * Raw means are not comparable across a field like `cons_per_adult_eq` (thousands
 * of birr) and `land_any_irrigated` (0 or 1). The artifact already carries `z`,
 * the standardised distance from the population mean, so the bars are comparable
 * and the raw value is shown as text beside its name for the reader who wants it.
 *
 * Diverging from a centre line, so a negative bar reads "below average" without a
 * colour: on the ramp, red/green would imply good and bad, and a cluster is
 * neither.
 */

const FIELD_LABELS: Record<string, string> = {
  land_total_area: "Land area",
  livestock_tlu: "Livestock (TLU)",
  crop_diversity: "Crop diversity",
  land_any_irrigated: "Any irrigated land",
  geo_dist_market: "Distance to market",
  geo_rain_anomaly_2019: "Rain anomaly 2019",
  dependency_ratio: "Dependency ratio",
  cons_per_adult_eq: "Consumption per adult",
  diet_n_groups: "Diet food groups",
  econ_n_asset_types: "Asset types owned",
};

const UNITS: Record<string, string> = {
  land_total_area: "ha",
  livestock_tlu: "TLU",
  crop_diversity: "crops",
  land_any_irrigated: "0/1",
  geo_dist_market: "km",
  geo_rain_anomaly_2019: "sd",
  dependency_ratio: "",
  cons_per_adult_eq: "birr",
  diet_n_groups: "groups",
  econ_n_asset_types: "types",
};

const MAX_Z = 1.2;

export function ZScoreBars({
  z,
  profile,
}: {
  z: Record<string, number>;
  profile?: Record<string, number>;
}) {
  const keys = Object.keys(z);
  if (keys.length === 0) return <p className="small faint">No profile recorded for this cluster.</p>;

  return (
    <ul className="zbars">
      {keys.map((key) => {
        const value = z[key] ?? 0;
        const width = Math.min(50, (Math.abs(value) / MAX_Z) * 50);
        const unit = UNITS[key] ?? "";
        const raw = profile && typeof profile[key] === "number" ? `${num(profile[key], 1)}${unit ? ` ${unit}` : ""}` : null;
        return (
          <li key={key}>
            <span className="zbar-name small">
              {FIELD_LABELS[key] ?? key}
              {raw ? <span className="faint"> · {raw}</span> : null}
            </span>
            <span className="zbar-track">
              <span className="zbar-axis" aria-hidden="true" />
              <span
                className={`zbar-fill ${value >= 0 ? "up" : "down"}`}
                style={{
                  width: `${width}%`,
                  [value >= 0 ? "left" : "right"]: "50%",
                }}
              />
            </span>
            <span className="tabular small">{value >= 0 ? "+" : "−"}{num(Math.abs(value), 2)}</span>
          </li>
        );
      })}
    </ul>
  );
}
