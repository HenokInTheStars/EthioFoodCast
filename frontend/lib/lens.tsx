"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * The three lenses from FRONTEND_DESIGN.md.
 *
 * One system, three emphases: the same predict() result is presented for a
 * field assessor with a printed card, a desk officer with a rank table, and a
 * reviewer who wants the calibration and the provenance. A lens never changes
 * which data exists -- only how much of it is visible by default.
 */

export type Lens = "field" | "desk" | "review";

export const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: "field", label: "Field", hint: "Printed card, plain words, fewest details" },
  { id: "desk", label: "Desk", hint: "Rank table, capacity, CSV" },
  { id: "review", label: "Review", hint: "Full factors, calibration, provenance" },
];

export const LENS_KEY = "efc.lens";

type LensValue = {
  lens: Lens;
  setLens: (next: Lens) => void;
  /** The desk lens wants the densest table rhythm. */
  compact: boolean;
};

const LensContext = createContext<LensValue>({
  lens: "field",
  setLens: () => {},
  compact: false,
});

export function LensProvider({
  children,
  initial = "field",
  bridge = true,
}: {
  children: ReactNode;
  initial?: Lens;
  bridge?: boolean;
}) {
  const [lens, setLensState] = useState<Lens>(initial);

  // Restore the reader's last choice after mount. Reading during render would
  // make the server and client markup disagree.
  useEffect(() => {
    const stored = window.localStorage.getItem(LENS_KEY);
    if (stored && LENSES.some((entry) => entry.id === stored)) setLens(stored as Lens);
  }, []);

  // Mirror onto <html> so CSS can scale density for the whole shell.
  useEffect(() => {
    if (bridge) document.documentElement.dataset.lens = lens;
  }, [lens, bridge]);

  const setLens = useCallback((next: Lens) => {
    setLensState(next);
    window.localStorage.setItem(LENS_KEY, next);
  }, []);

  const value = useMemo<LensValue>(
    () => ({ lens, setLens, compact: lens === "desk" }),
    [lens, setLens],
  );

  return <LensContext.Provider value={value}>{children}</LensContext.Provider>;
}

export function useLens(): LensValue {
  return useContext(LensContext);
}
