"use client";

import { useEffect, useState } from "react";
import { useConnectivity } from "@/lib/connectivity";

export function OfflineSupport() {
  const [controlled, setControlled] = useState(false);
  const { browserOnline, apiReachable } = useConnectivity();

  useEffect(() => {
    function updateController() {
      setControlled(Boolean(navigator.serviceWorker?.controller));
    }

    updateController();

    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }

    let controlled = Boolean(navigator.serviceWorker.controller);
    function onControllerChange() {
      updateController();
      if (!controlled) {
        controlled = true;
        window.location.reload();
      }
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/service-worker.js")
      .then(async () => {
        await navigator.serviceWorker.ready;
        updateController();
      })
      .catch((error: unknown) => {
        console.error("Offline support could not be enabled.", error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  // Silent while everything works; a banner only when the connection is lost.
  if (browserOnline && apiReachable !== false) return null;

  const productionBuild = process.env.NODE_ENV === "production";
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <strong>{browserOnline ? "Scoring service unavailable." : "You are offline."}</strong>{" "}
      Pages you have opened still work and answers stay on this device. Scoring needs a connection and is never
      queued.{productionBuild && !controlled ? " Offline support is still starting." : ""}
    </div>
  );
}
