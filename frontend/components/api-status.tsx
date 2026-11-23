"use client";

/**
 * Backend reachability, shown in the chrome.
 *
 * Deliberately a client component: the landing page is statically prerendered
 * at build time (including inside `docker build`, where no API is running), so
 * the health check must not run during the build. It runs in the browser
 * instead, against NEXT_PUBLIC_API_URL.
 */
import { clientApiUrl } from "@/lib/api";
import { useConnectivity } from "@/lib/connectivity";

export function ApiStatus() {
  const { apiReachable } = useConnectivity();

  const label =
    apiReachable === true
      ? "Scoring service connected"
      : apiReachable === false
        ? "Scoring service unreachable"
        : "Checking scoring service";

  const state = apiReachable === true ? "ok" : apiReachable === false ? "down" : "pending";

  return (
    <span className="api-status" title={`${label} — ${clientApiUrl()}`} role="status">
      <span className={`status-dot ${state}`} aria-hidden="true" />
      {label}
    </span>
  );
}
