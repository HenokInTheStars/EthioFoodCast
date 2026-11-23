import profilesData from "@/data/artifacts/cluster_profiles.json";
import clustersData from "@/data/artifacts/clusters.json";
import riskByClusterData from "@/data/artifacts/risk_distribution.json";
import { ZScoreBars } from "@/components/zscore-bars";
import { ProvenanceChip } from "@/components/provenance-chip";
import { int, num, pct } from "@/lib/format";

/**
 * /segments -- the five profiles, as z-scores.
 *
 * The component layer absorbs a real inconsistency the brief warns about:
 * `clusters.json` uses `name_` with a trailing underscore, `cluster_profiles.json`
 * uses `name`. Both are read here and joined on the numeric `cluster` id, so the
 * quirk is contained in one place instead of leaking into every screen.
 *
 * Raw means are not comparable across fields measured in hectares, birr and
 * 0/1 flags, so the bars are standardised. The raw value is printed beside the
 * name for a reader who wants it.
 */

export const metadata = { title: "EthioFoodCast — profiles" };

const profiles = profilesData as {
  cluster: number;
  name: string;
  n: number;
  pct: number;
  food_insecure_rate: number;
  profile: Record<string, number>;
  z: Record<string, number>;
}[];

const clusters = clustersData as { cluster: number; name_: string; n: number; pct: number }[];

const riskByCluster = (riskByClusterData as {
  by_cluster: { cluster: string; n: number; mean_risk: number; flagged_share: number }[];
}).by_cluster;

export default function SegmentsPage() {
  const riskByName = new Map(riskByCluster.map((row) => [row.cluster, row]));
  const total = profiles.reduce((sum, row) => sum + row.n, 0);

  return (
    <>
      <h1>Five profiles of agricultural household</h1>
      <p className="muted">
        The model groups households, and the groups are descriptive rather than causal: they are what
        a clustering of the surveyed variables produced, not types that exist in the world. A
        household&rsquo;s profile never changes its score, only how it is described.
      </p>

      <div className="grid" style={{ marginBottom: "var(--rhythm)" }}>
        <div className="card">
          <h3>Profiles</h3>
          <div className="stat">{profiles.length}</div>
          <div className="small faint">from {int(total)} clustered households</div>
        </div>
        <div className="card">
          <h3>Largest profile</h3>
          <div className="stat">{Math.round(Math.max(...profiles.map((row) => row.pct)))}%</div>
          <div className="small faint">of all clustered households</div>
        </div>
        <div className="card">
          <h3>Highest observed insecurity</h3>
          <div className="stat">{pct(Math.max(...profiles.map((row) => row.food_insecure_rate)))}</div>
          <div className="small faint">in the profile at the top of that range</div>
        </div>
      </div>

      {profiles.map((profile) => {
        const risk = riskByName.get(profile.name);
        // `clusters.json` spells the name with a trailing underscore; joined on id.
        const clusterRow = clusters.find((row) => row.cluster === profile.cluster);
        return (
          <section className="card segment" key={profile.cluster}>
            <header className="segment-head">
              <h2>{profile.name}</h2>
              <p className="small faint">
                {int(profile.n)} households · {num(profile.pct, 1)}% of the clustered set
                {clusterRow && clusterRow.name_ !== profile.name ? ` · also recorded as “${clusterRow.name_}”` : ""}
              </p>
            </header>

            <div className="segment-stats">
              <span>
                <strong className="tabular">{pct(profile.food_insecure_rate)}</strong>{" "}
                <span className="small faint">observed food insecure</span>
              </span>
              {risk ? (
                <span>
                  <strong className="tabular">{num(risk.mean_risk, 2)}</strong>{" "}
                  <span className="small faint">mean model score</span>
                </span>
              ) : null}
              {risk ? (
                <span>
                  <strong className="tabular">{pct(risk.flagged_share)}</strong>{" "}
                  <span className="small faint">flagged for follow-up</span>
                </span>
              ) : null}
            </div>

            <h3>How this profile differs from the average household</h3>
            <p className="small faint">
              Standardised distance from the population mean (a z-score). Bars left of the line are
              below average; the printed value is the raw measurement.
            </p>
            <ZScoreBars z={profile.z} profile={profile.profile} />
          </section>
        );
      })}

      <p className="footnote small">
        <ProvenanceChip
          source="cluster_profiles.json"
          protocol="Clustering fit on the survey variables, then described on held-out households. z-scores are standardised distances from the population mean."
          note="Profile membership does not enter the score. It is a description produced alongside it."
        />
      </p>
    </>
  );
}
