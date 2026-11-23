"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/brand-mark";

/**
 * Site header: brand, primary navigation with the current page marked, and a
 * menu button that collapses the navigation on narrow screens.
 *
 * Links are plain <a> elements, not next/link: full page loads keep the service
 * worker's page cache (offline field use) working exactly as before.
 */
export const NAV = [
  { href: "/", label: "Overview" },
  { href: "/assess", label: "Assess" },
  { href: "/batch", label: "Batch" },
  { href: "/plan", label: "Plan" },
  { href: "/situation", label: "Situation" },
  { href: "/segments", label: "Profiles" },
  { href: "/areas", label: "Areas" },
  { href: "/spatial", label: "Map" },
  { href: "/copilot", label: "Evidence" },
  { href: "/method", label: "Method" },
];

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="brand" aria-label="EthioFoodCast, overview">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">EthioFoodCast</span>
            <span className="brand-tagline">Household food-security forecasting · Ethiopia</span>
          </span>
        </a>

        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav-toggle-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Menu
        </button>

        <nav id="site-nav" className={open ? "site-nav open" : "site-nav"} aria-label="Main">
          {NAV.map((entry) => {
            const active = entry.href === "/" ? pathname === "/" : pathname.startsWith(entry.href);
            return (
              <a
                key={entry.href}
                href={entry.href}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {entry.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
