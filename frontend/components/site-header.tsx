"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { DensityToggle, ModeSwitch } from "@/components/mode-switch";

/**
 * Site header: brand, five top-level destinations (three of them menus), and a
 * Display menu for the reading mode and text size. On narrow screens everything
 * collapses into one grouped list behind a Menu button.
 *
 * Links are plain <a> elements, not next/link: full page loads keep the service
 * worker's page cache (offline field use) working exactly as before.
 */
type NavLink = { href: string; label: string; description?: string };
type NavEntry = NavLink | { label: string; children: NavLink[] };

export const NAV: NavEntry[] = [
  { href: "/", label: "Overview" },
  {
    label: "Assess",
    children: [
      { href: "/assess", label: "One household", description: "A short interview, scored on the spot" },
      { href: "/batch", label: "A list of households", description: "Upload a CSV, get a ranked list back" },
    ],
  },
  { href: "/plan", label: "Plan" },
  {
    label: "Insights",
    children: [
      { href: "/situation", label: "Risk overview", description: "How scores are spread, by region and profile" },
      { href: "/spatial", label: "Regional map", description: "Risk and food insecurity by region" },
      { href: "/segments", label: "Household profiles", description: "Five kinds of farming household" },
      { href: "/areas", label: "Survey areas", description: "The 427 areas and how reliable their names are" },
    ],
  },
  {
    label: "About",
    children: [
      { href: "/method", label: "How it works", description: "The model, its accuracy and its limits" },
      { href: "/knowledge", label: "Knowledge centre", description: "Articles, questions and answers, further reading" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setOpenMenu(null);
  }, [pathname]);

  // Close an open menu on Escape or a click elsewhere.
  useEffect(() => {
    if (!openMenu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }
    function onPointer(event: PointerEvent) {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setOpenMenu(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [openMenu]);

  return (
    <header className="site-header" ref={headerRef}>
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
          aria-expanded={mobileOpen}
          aria-controls="site-nav"
          onClick={() => setMobileOpen((value) => !value)}
        >
          <span className="nav-toggle-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Menu
        </button>

        <nav id="site-nav" className={mobileOpen ? "site-nav open" : "site-nav"} aria-label="Main">
          <ul className="nav-list">
            {NAV.map((entry) => {
              if ("href" in entry) {
                const active = isActive(pathname, entry.href);
                return (
                  <li key={entry.label}>
                    <a
                      href={entry.href}
                      className={active ? "nav-link active" : "nav-link"}
                      aria-current={active ? "page" : undefined}
                    >
                      {entry.label}
                    </a>
                  </li>
                );
              }
              const active = entry.children.some((child) => isActive(pathname, child.href));
              const open = openMenu === entry.label;
              const menuId = `menu-${entry.label.toLowerCase()}`;
              return (
                <li key={entry.label} className="nav-group">
                  <button
                    type="button"
                    className={`nav-link nav-trigger${active ? " active" : ""}`}
                    aria-expanded={open}
                    aria-controls={menuId}
                    onClick={() => setOpenMenu(open ? null : entry.label)}
                  >
                    {entry.label}
                    <span className="nav-caret" aria-hidden="true" />
                  </button>
                  <ul id={menuId} className={open ? "nav-menu open" : "nav-menu"}>
                    {entry.children.map((child) => {
                      const childActive = isActive(pathname, child.href);
                      return (
                        <li key={child.href}>
                          <a
                            href={child.href}
                            className={childActive ? "active" : undefined}
                            aria-current={childActive ? "page" : undefined}
                          >
                            <span className="nav-menu-label">{child.label}</span>
                            {child.description ? (
                              <span className="nav-menu-description">{child.description}</span>
                            ) : null}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>

          <div className="nav-group display-group">
            <button
              type="button"
              className={`nav-link nav-trigger display-trigger${openMenu === "display" ? " open" : ""}`}
              aria-expanded={openMenu === "display"}
              aria-controls="menu-display"
              onClick={() => setOpenMenu(openMenu === "display" ? null : "display")}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path
                  d="M3 5h9M15 5h2M3 10h3M9 10h8M3 15h7M13 15h4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle cx="13.5" cy="5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="7.5" cy="10" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="11.5" cy="15" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              Display
            </button>
            <div id="menu-display" className={openMenu === "display" ? "nav-menu display-menu open" : "nav-menu display-menu"}>
              <p className="display-label">Detail</p>
              <ModeSwitch />
              <p className="display-label">Text size</p>
              <DensityToggle />
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
