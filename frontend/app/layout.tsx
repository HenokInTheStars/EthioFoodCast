import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import "./globals.css";
import { ApiStatus } from "@/components/api-status";
import { ModeSwitch } from "@/components/mode-switch";
import { DensityToggle } from "@/components/mode-switch";
import { OfflineSupport } from "@/components/offline-support";
import { ConnectivityProvider } from "@/lib/connectivity";
import { clientApiUrl } from "@/lib/api";
import { LensProvider } from "@/lib/lens";
import distribution from "@/data/artifacts/risk_distribution.json";
import { int, pct } from "@/lib/format";

export const metadata: Metadata = {
  title: "EthioFoodCast",
  description:
    "Decision support for prioritising food-security outreach in Ethiopia. Descriptive risk scores from the 14-question agricultural form; not eligibility determinations.",
  manifest: "/manifest.webmanifest",
};

/**
 * The six routes, in the order a reader moves through them: what the situation
 * is, who to act on, how to score a single household, how to score a list, what
 * the profiles are, which areas they refer to, and how the model was measured.
 */
const NAV = [
  { href: "/situation", label: "Situation" },
  { href: "/plan", label: "Plan" },
  { href: "/assess", label: "Assess" },
  { href: "/batch", label: "Batch" },
  { href: "/segments", label: "Profiles" },
  { href: "/areas", label: "Areas" },
  { href: "/spatial", label: "Spatial" },
  { href: "/copilot", label: "Evidence" },
  { href: "/method", label: "Method" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConnectivityProvider apiBase={clientApiUrl()}>
          <LensProvider>
            <header className="chrome">
              <div className="topbar">
                <Link href="/" className="brand">
                  EthioFoodCast
                </Link>
                <nav aria-label="Sections">
                  {NAV.map((entry) => (
                    <a key={entry.href} href={entry.href}>
                      {entry.label}
                    </a>
                  ))}
                </nav>
                <ApiStatus />
                <OfflineSupport />
              </div>
            </header>

            <main className="page">
              <div className="toolbar">
                <ModeSwitch />
                <DensityToggle />
              </div>
              {children}
            </main>
          </LensProvider>
        </ConnectivityProvider>

        <footer className="chrome">
          <div className="topbar">
            <p className="small" style={{ margin: 0, maxWidth: "none" }}>
              Baseline: <strong>{pct(distribution.observed_rate)}</strong> of the{" "}
              <strong>{int(distribution.n_households)}</strong> held-out agricultural households were
              food-insecure in 2021/22. A score is descriptive, and is not an eligibility decision.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
