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

  const label = !browserOnline
    ? "Offline"
    : apiReachable === true
      ? "Online"
      : apiReachable === false
        ? "Scoring service unavailable"
        : "Checking connection";
  const productionBuild = process.env.NODE_ENV === "production";
  const guidance = !productionBuild
    ? "Offline page caching is enabled in production builds. Assessment drafts remain on this device; scoring requires internet and is never queued."
    : controlled
      ? "Offline app support is enabled. Open the assessment once while online before field use so its page is cached. Drafts stay on this device; scoring requires internet and is never queued."
      : "Offline app support is starting. Open the assessment while online before field use so its page is cached. Drafts stay on this device; scoring requires internet and is never queued.";

  return (
    <span
      className={`offline-support ${browserOnline && apiReachable ? "online" : "offline"}`}
      role="status"
      aria-live="polite"
      title={guidance}
    >
      {label}
      <span className="offline-support-detail">
        {!productionBuild
          ? " · offline cache requires production build"
          : controlled
            ? " · offline support enabled"
            : " · offline support starting"}
      </span>
    </span>
  );
}
