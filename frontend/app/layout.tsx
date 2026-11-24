import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";

import "./globals.css";
import { BrandMark } from "@/components/brand-mark";
import { FooterTeam } from "@/components/footer-team";
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

// The public address, for absolute links in link previews. Vercel provides its
// production domain; NEXT_PUBLIC_SITE_URL overrides it (for example a custom domain).
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
  ?? "https://ethio-food-cast.vercel.app";

const description =
  "Ranks Ethiopian farming households by their risk of food insecurity so field teams know whom to visit first. "
  + "A graph neural network trained on World Bank survey data, with plain-language explanations and cited AI answers.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "EthioFoodCast", template: "%s — EthioFoodCast" },
  description,
  applicationName: "EthioFoodCast",
  authors: [{ name: "Henok Solomon" }, { name: "Niyat Debesay" }, { name: "Amina Aman" }],
  openGraph: {
    type: "website",
    siteName: "EthioFoodCast",
    title: "EthioFoodCast — household food-security forecasting for Ethiopia",
    description,
    locale: "en_GB",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "EthioFoodCast logo with key results" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EthioFoodCast — household food-security forecasting for Ethiopia",
    description,
    images: ["/og-image.png"],
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
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
      { href: "/situation", label: "Risk overview" },
      { href: "/segments", label: "Household profiles" },
      { href: "/areas", label: "Survey areas" },
      { href: "/spatial", label: "Regional map" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/method", label: "How it works" },
      { href: "/knowledge", label: "Knowledge centre" },
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

            <OfflineSupport />
            <main className="page" id="main">
              {children}
            </main>
          </LensProvider>
        </ConnectivityProvider>

        <footer className="site-footer">
          <div className="site-footer-inner">
            <div className="footer-about">
              <Link href="/" className="footer-brand">
                <BrandMark size={28} />
                <span>EthioFoodCast</span>
              </Link>
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
          <FooterTeam />
          <div className="site-footer-base">
            <p>
              Baseline: <strong>{pct(distribution.observed_rate)}</strong> of the{" "}
              <strong>{int(distribution.n_households)}</strong> test households were food insecure in 2021/22. A score
              ranks households for a visit; it is not a certainty or an eligibility decision.
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
