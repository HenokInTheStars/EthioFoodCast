import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";

import "./globals.css";
import { ApiStatus } from "@/components/api-status";
import { BrandMark } from "@/components/brand-mark";
import { DensityToggle, ModeSwitch } from "@/components/mode-switch";
import { OfflineSupport } from "@/components/offline-support";
import { SiteHeader } from "@/components/site-header";
import { ConnectivityProvider } from "@/lib/connectivity";
import { clientApiUrl } from "@/lib/api";
import { LensProvider } from "@/lib/lens";
import distribution from "@/data/artifacts/risk_distribution.json";
import { int, pct } from "@/lib/format";

// Self-hosted at build time by next/font: no request to Google from the
// browser, and the files are cached with the app for offline field use.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ["ethiopic"], variable: "--font-ethiopic", display: "swap" });

export const metadata: Metadata = {
  title: "EthioFoodCast",
  description:
    "Decision support for prioritising food-security outreach in Ethiopia. Descriptive risk scores from the 14-question agricultural form; not eligibility determinations.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b2a45",
};

const FOOTER_LINKS = [
  {
    heading: "Use",
    links: [
      { href: "/assess", label: "Assess a household" },
      { href: "/batch", label: "Score a list" },
      { href: "/plan", label: "Plan assessments" },
    ],
  },
  {
    heading: "Explore",
    links: [
      { href: "/situation", label: "Situation" },
      { href: "/segments", label: "Household profiles" },
      { href: "/areas", label: "Survey areas" },
      { href: "/spatial", label: "Regional map" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/method", label: "Method and evaluation" },
      { href: "/copilot", label: "Evidence desk" },
    ],
  },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${ethiopic.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ConnectivityProvider apiBase={clientApiUrl()}>
          <LensProvider>
            <SiteHeader />

            <div className="utility-bar">
              <div className="utility-inner">
                <div className="utility-status">
                  <ApiStatus />
                  <OfflineSupport />
                </div>
                <div className="utility-controls">
                  <span className="utility-label" id="view-label">
                    View
                  </span>
                  <ModeSwitch />
                  <span className="utility-label" id="text-label">
                    Text
                  </span>
                  <DensityToggle />
                </div>
              </div>
            </div>

            <main className="page" id="main">
              {children}
            </main>
          </LensProvider>
        </ConnectivityProvider>

        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-about">
              <a href="/" className="footer-brand">
                <BrandMark size={28} />
                <span>EthioFoodCast</span>
              </a>
              <p>
                Decision support for prioritising household food-security follow-up in Ethiopia. Scores rank
                households for a human assessment; they are not eligibility decisions.
              </p>
            </div>
            {FOOTER_LINKS.map((group) => (
              <nav key={group.heading} className="footer-links" aria-label={group.heading}>
                <h2>{group.heading}</h2>
                <ul>
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href}>{link.label}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <div className="site-footer-base">
            <p>
              Baseline: <strong>{pct(distribution.observed_rate)}</strong> of the{" "}
              <strong>{int(distribution.n_households)}</strong> held-out agricultural households were food-insecure
              in 2021/22. A score is descriptive, not a calibrated probability or an eligibility decision.
            </p>
            <p>
              Data: Ethiopia Socioeconomic Survey 2018/19 and Ethiopia Socioeconomic Panel Survey 2021/22. An
              independent research tool; not an official product of any government or agency.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
