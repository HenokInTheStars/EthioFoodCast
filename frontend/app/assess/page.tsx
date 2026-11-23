import Link from "next/link";

import { AssessForm } from "./assess-form";
import { clientApiUrl, getAreas, getMeta, getSchema, serverApiUrl } from "@/lib/api";
import { int } from "@/lib/format";

export const metadata = { title: "Assess a household \u2014 EthioFoodCast" };

/**
 * The interview. Rendered per request, never prerendered: the question set and
 * the survey areas come from the running model, and a build must not need one.
 *
 * The failure branch is a page a field worker can act on, not an exception:
 * it names the URL that was tried and the two ways to start it.
 */
export const dynamic = "force-dynamic";

export default async function AssessPage() {
  const base = serverApiUrl();

  try {
    const [schema, meta, areas] = await Promise.all([getSchema(false, base), getMeta(base), getAreas(base)]);

    return (
      <>
        <h1>Assess a household</h1>
        <p className="muted">
          A short interview: the survey area, then{" "}
          {int(Object.values(schema).reduce((total, group) => total + group.length, 0))} questions in{" "}
          {int(Object.keys(schema).length)} steps. Leave a question as Unknown if it was not asked or not known; it
          is never read as zero.
        </p>
        <AssessForm schema={schema} meta={meta} areas={areas} apiBase={clientApiUrl()} />
      </>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <>
        <h1>Assess a household</h1>
        <div className="error">
          <p>
            <strong>The scoring service is not reachable, so the interview cannot be loaded.</strong>
          </p>
          <p className="small">
            Tried <code>{base}</code>. {message}
          </p>
          <p className="small">
            Start it with <code>docker compose up</code>, or on this machine with{" "}
            <code>start_api.bat</code>. Then reload this page.
          </p>
        </div>
        <p className="small muted">
          The <Link href="/">overview</Link> reads from build artifacts and works without the service.
        </p>
      </>
    );
  }
}
