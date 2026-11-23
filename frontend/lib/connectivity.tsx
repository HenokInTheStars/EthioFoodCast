"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Connectivity = {
  browserOnline: boolean;
  apiReachable: boolean | null;
  connected: boolean;
};

const ConnectivityContext = createContext<Connectivity>({
  browserOnline: true,
  apiReachable: null,
  connected: false,
});

export function ConnectivityProvider({
  apiBase,
  children,
}: {
  apiBase: string;
  children: ReactNode;
}) {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    let currentCheck: AbortController | null = null;

    async function checkApi() {
      if (!navigator.onLine) {
        setBrowserOnline(false);
        setApiReachable(false);
        return;
      }
      setBrowserOnline(true);
      currentCheck?.abort();
      const controller = new AbortController();
      currentCheck = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${apiBase}/api/health`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        const healthy =
          response.ok &&
          body !== null &&
          typeof body === "object" &&
          "status" in body &&
          body.status === "ok";
        if (active) setApiReachable(healthy);
      } catch {
        if (active) setApiReachable(false);
      } finally {
        window.clearTimeout(timeout);
        if (currentCheck === controller) currentCheck = null;
      }
    }

    function handleOffline() {
      setBrowserOnline(false);
      setApiReachable(false);
      currentCheck?.abort();
    }

    function handleOnline() {
      setBrowserOnline(true);
      void checkApi();
    }

    void checkApi();
    const interval = window.setInterval(() => void checkApi(), 15000);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      currentCheck?.abort();
    };
  }, [apiBase]);

  const value = useMemo(
    () => ({ browserOnline, apiReachable, connected: browserOnline && apiReachable === true }),
    [browserOnline, apiReachable],
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity(): Connectivity {
  return useContext(ConnectivityContext);
}
