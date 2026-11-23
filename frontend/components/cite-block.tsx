"use client";

/**
 * "Cite this work": a ready-to-copy citation and BibTeX entry. The website's
 * address is read in the browser, so the citation names whichever deployment
 * the visitor is using.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { apaCitation, bibtexCitation, citation } from "@/lib/citation";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or clipboard access refused: fall back to a hidden selection.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      className="cite-copy"
      onClick={async () => setState((await copyText(text)) ? "copied" : "failed")}
      aria-label={state === "idle" ? label : undefined}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </button>
  );
}

export function CiteBlock() {
  const [url, setUrl] = useState<string>();
  const [accessed, setAccessed] = useState<string>();
  useEffect(() => {
    setUrl(window.location.origin);
    setAccessed(new Date().toISOString().slice(0, 10));
  }, []);

  const apa = apaCitation(url);
  const bibtex = bibtexCitation(url, accessed);
  const [before, after] = apa.split(citation.title);

  return (
    <div className="cite-card">
      <div className="cite-row">
        <p className="cite-text">
          {before}
          <cite>{citation.title}</cite>
          {after}
        </p>
        <CopyButton text={apa} label="Copy citation" />
      </div>
      <details className="cite-bibtex">
        <summary>BibTeX</summary>
        <div className="cite-row">
          <pre>
            <code>{bibtex}</code>
          </pre>
          <CopyButton text={bibtex} label="Copy BibTeX" />
        </div>
      </details>
      <p className="cite-foot">
        Using the survey data as well? Cite the surveys as their producers request; the exact references are in{" "}
        <Link href="/knowledge/sources-and-citation#how-to-cite-ethiofoodcast">Data sources and how to cite</Link>.
      </p>
    </div>
  );
}
