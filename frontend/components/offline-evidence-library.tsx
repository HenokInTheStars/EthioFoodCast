"use client";

import { useEffect, useMemo, useState } from "react";

import {
  commitDocumentImport,
  estimateBrowserStorage,
  LIBRARY_LIMIT_BYTES,
  listOfflineDocuments,
  MAX_FILE_BYTES,
  planDocumentImport,
  prepareLocalDocument,
  removeOfflineDocument,
  searchOfflineDocuments,
  updateDocumentPin,
  type ImportPlan,
  type LibraryEstimate,
  type OfflineEvidenceDocument,
} from "@/lib/offline-evidence-library";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected storage error occurred.";
}

export function OfflineEvidenceLibrary() {
  const [documents, setDocuments] = useState<OfflineEvidenceDocument[]>([]);
  const [estimate, setEstimate] = useState<LibraryEstimate>({ usage: null, quota: null });
  const [query, setQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [publicationDate, setPublicationDate] = useState("");
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    document: OfflineEvidenceDocument;
    plan: ImportPlan;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [storageError, setStorageError] = useState("");

  async function refreshLibrary() {
    const storedDocuments = await listOfflineDocuments();
    setDocuments(storedDocuments.sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
    try {
      setEstimate(await estimateBrowserStorage());
      setStorageError("");
    } catch (error) {
      setEstimate({ usage: null, quota: null });
      setStorageError(`Could not estimate browser storage: ${errorMessage(error)}`);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadLibrary() {
      try {
        const storedDocuments = await listOfflineDocuments();
        if (!active) return;
        setDocuments(storedDocuments.sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
      } catch (error) {
        if (active) setStorageError(errorMessage(error));
        return;
      }

      try {
        const currentEstimate = await estimateBrowserStorage();
        if (active) setEstimate(currentEstimate);
      } catch (error) {
        if (active) {
          setEstimate({ usage: null, quota: null });
          setStorageError(`Could not estimate browser storage: ${errorMessage(error)}`);
        }
      }
    }
    void loadLibrary();
    return () => {
      active = false;
    };
  }, []);

  const results = useMemo(
    () => searchOfflineDocuments(documents, query),
    [documents, query],
  );
  const libraryBytes = documents.reduce((total, document) => total + document.storedBytes, 0);
  const pinnedCount = documents.filter((document) => document.pinned).length;
  const quotaPressure = estimate.usage !== null && estimate.quota !== null
    && estimate.quota > 0 && estimate.usage / estimate.quota >= 0.8;

  async function importSelectedFile() {
    if (!selectedFile || !rightsAccepted) return;
    setWorking(true);
    setStatus("Reading the file locally…");
    setPendingImport(null);
    try {
      const document = await prepareLocalDocument(selectedFile, publicationDate);
      const plan = await planDocumentImport(document);
      if (!plan.canFit) {
        setStatus("Import blocked: pinned documents leave too little room. Unpin or remove one first.");
      } else if (plan.documentsToRemove.length > 0) {
        setPendingImport({ document, plan });
        setStatus("");
      } else {
        await commitDocumentImport(document);
        await refreshLibrary();
        setSelectedFile(null);
        setPublicationDate("");
        setRightsAccepted(false);
        setStatus(`${document.name} was saved in this browser for offline search.`);
      }
    } catch (error) {
      setStatus(`Import failed: ${errorMessage(error)}`);
    } finally {
      setWorking(false);
    }
  }

  async function confirmPrunedImport() {
    if (!pendingImport) return;
    setWorking(true);
    try {
      const removed = await commitDocumentImport(pendingImport.document);
      await refreshLibrary();
      setSelectedFile(null);
      setPublicationDate("");
      setRightsAccepted(false);
      setPendingImport(null);
      setStatus(
        removed.length
          ? `Saved ${pendingImport.document.name}; removed ${removed.length} older unpinned document${removed.length === 1 ? "" : "s"} to stay within the 300 MB limit.`
          : `${pendingImport.document.name} was saved in this browser for offline search.`,
      );
    } catch (error) {
      setStatus(`Import failed: ${errorMessage(error)}`);
    } finally {
      setWorking(false);
    }
  }

  async function togglePin(document: OfflineEvidenceDocument) {
    setWorking(true);
    try {
      await updateDocumentPin(document.id, !document.pinned);
      await refreshLibrary();
      setStatus(document.pinned ? `${document.name} is now unpinned.` : `${document.name} is pinned and protected from automatic pruning.`);
    } catch (error) {
      setStatus(`Could not update pin: ${errorMessage(error)}`);
    } finally {
      setWorking(false);
    }
  }

  async function deleteDocument(document: OfflineEvidenceDocument) {
    if (!window.confirm(`Remove "${document.name}" from this browser's offline library?`)) return;
    setWorking(true);
    try {
      await removeOfflineDocument(document.id);
      await refreshLibrary();
      setStatus(`${document.name} was removed from this browser.`);
    } catch (error) {
      setStatus(`Could not remove document: ${errorMessage(error)}`);
    } finally {
      setWorking(false);
    }
  }

  function downloadDocument(document: OfflineEvidenceDocument) {
    const url = URL.createObjectURL(document.file);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="offline-library" aria-labelledby="offline-library-heading">
      <div className="readiness-heading">
        <span className="tag">This browser only</span>
        <h3 id="offline-library-heading">Offline document library</h3>
      </div>
      <p className="small muted">
        Import PDF, TXT, or Markdown files for local storage and search. Files and extracted text
        stay in this browser and are never uploaded. Add only material you have permission to store.
        Scanned PDFs without selectable text are not searchable; OCR is not included.
      </p>

      <div className="library-storage" aria-live="polite">
        <strong>{formatBytes(libraryBytes)} of 300 MB used</strong>
        <span>{documents.length} documents · {pinnedCount} pinned</span>
        {estimate.usage !== null && estimate.quota !== null ? (
          <span>
            Browser storage estimate: {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}
          </span>
        ) : (
          <span>Browser quota estimate is unavailable.</span>
        )}
      </div>

      {libraryBytes >= LIBRARY_LIMIT_BYTES * 0.8 || quotaPressure ? (
        <p className="library-warning" role="status">
          Storage is getting full. New imports may remove the oldest unpinned documents by
          publication date; pinned documents are protected. Review the removal list before confirming.
        </p>
      ) : null}
      {storageError ? <p className="library-error" role="alert">{storageError}</p> : null}

      <form
        className="library-import"
        onSubmit={(event) => {
          event.preventDefault();
          void importSelectedFile();
        }}
      >
        <label>
          Document file
          <input
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            onChange={(event) => {
              setSelectedFile(event.target.files?.[0] ?? null);
              setPendingImport(null);
              setStatus("");
            }}
          />
        </label>
        <label>
          Publication date (used to choose the oldest documents for pruning)
          <input
            type="date"
            value={publicationDate}
            onChange={(event) => setPublicationDate(event.target.value)}
          />
        </label>
        <label className="library-consent">
          <input
            type="checkbox"
            checked={rightsAccepted}
            onChange={(event) => setRightsAccepted(event.target.checked)}
          />
          I have permission or rights to store and search this document offline.
        </label>
        <button
          className="button"
          type="submit"
          disabled={!selectedFile || !rightsAccepted || working}
        >
          {working ? "Preparing…" : "Import to offline library"}
        </button>
        <span className="small faint">Maximum file size: {formatBytes(MAX_FILE_BYTES)}.</span>
      </form>

      {pendingImport ? (
        <div className="library-warning" role="alert">
          <p>
            To stay under the 300 MB limit, importing <strong>{pendingImport.document.name}</strong>{" "}
            will remove these older unpinned documents:
          </p>
          <ul>
            {pendingImport.plan.documentsToRemove.map((document) => (
              <li key={document.id}>
                {document.name} — {document.publicationDate || "publication date not set"}
              </li>
            ))}
          </ul>
          <button className="button" type="button" disabled={working} onClick={() => void confirmPrunedImport()}>
            Confirm import and remove listed documents
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={working}
            onClick={() => setPendingImport(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {status ? <p className="library-status" role="status">{status}</p> : null}

      <label className="local-evidence-query">
        Search offline documents
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search saved reports and notes"
        />
      </label>
      <p className="small faint" aria-live="polite">
        {query.trim()
          ? `${results.length} matching page${results.length === 1 ? "" : "s"}.`
          : "Search results cite the PDF page when available."}
      </p>
      {results.length > 0 ? (
        <div className="local-evidence-results">
          {results.map((result) => (
            <article className="card local-evidence-result" key={result.id}>
              <p className="small faint">{result.citation}</p>
              <p className="local-evidence-content">{result.snippet}</p>
            </article>
          ))}
        </div>
      ) : null}

      <ul className="offline-document-list" aria-label="Saved offline documents">
        {documents.map((document) => (
          <li className="offline-document" key={document.id}>
            <div>
              <strong>{document.name}</strong>
              <span className="small faint">
                {formatBytes(document.sizeBytes)} · {document.publicationDate || "publication date not set"}
                {document.pinned ? " · pinned" : ""}
              </span>
            </div>
            <div className="offline-document-actions">
              <button className="button button-secondary" type="button" onClick={() => downloadDocument(document)}>
                Download copy
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => void togglePin(document)}
              >
                {document.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => void deleteDocument(document)}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {documents.length === 0 && !storageError ? (
        <p className="small faint">No documents are saved in this browser yet.</p>
      ) : null}
    </section>
  );
}
