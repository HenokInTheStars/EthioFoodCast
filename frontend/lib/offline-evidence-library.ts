import type { PDFDocumentProxy } from "pdfjs-dist";

export type EvidencePage = {
  pageNumber: number | null;
  text: string;
};

export type OfflineEvidenceDocument = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storedBytes: number;
  publicationDate: string | null;
  addedAt: string;
  pinned: boolean;
  pages: EvidencePage[];
  file: Blob;
};

export type LibraryEstimate = {
  usage: number | null;
  quota: number | null;
};

export type ImportPlan = {
  canFit: boolean;
  documentsToRemove: OfflineEvidenceDocument[];
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export const LIBRARY_LIMIT_BYTES = 300 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_TEXT_BYTES = 3 * 1024 * 1024;
const DATABASE_NAME = "ethiofoodcast-evidence";
const STORE_NAME = "documents";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support offline document storage."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage is blocked by another open tab."));
  });
}

export async function listOfflineDocuments(): Promise<OfflineEvidenceDocument[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as OfflineEvidenceDocument[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read offline documents."));
    });
  } finally {
    database.close();
  }
}

export async function planDocumentImport(
  document: OfflineEvidenceDocument,
): Promise<ImportPlan> {
  const existing = await listOfflineDocuments();
  let bytesAfterImport = existing.reduce((total, item) => total + item.storedBytes, 0)
    + document.storedBytes;
  const documentsToRemove: OfflineEvidenceDocument[] = [];
  const removable = existing
    .filter((item) => !item.pinned)
    .sort((a, b) => {
      const dateA = a.publicationDate || a.addedAt.slice(0, 10);
      const dateB = b.publicationDate || b.addedAt.slice(0, 10);
      return dateA.localeCompare(dateB) || a.addedAt.localeCompare(b.addedAt);
    });

  for (const candidate of removable) {
    if (bytesAfterImport <= LIBRARY_LIMIT_BYTES) break;
    documentsToRemove.push(candidate);
    bytesAfterImport -= candidate.storedBytes;
  }

  return { canFit: bytesAfterImport <= LIBRARY_LIMIT_BYTES, documentsToRemove };
}

export async function commitDocumentImport(
  document: OfflineEvidenceDocument,
): Promise<OfflineEvidenceDocument[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      const removed: OfflineEvidenceDocument[] = [];
      let failure: Error | null = null;

      request.onsuccess = () => {
        const existing = request.result as OfflineEvidenceDocument[];
        let bytesAfterImport = existing.reduce((total, item) => total + item.storedBytes, 0)
          + document.storedBytes;
        const removable = existing
          .filter((item) => !item.pinned)
          .sort((a, b) => {
            const dateA = a.publicationDate || a.addedAt.slice(0, 10);
            const dateB = b.publicationDate || b.addedAt.slice(0, 10);
            return dateA.localeCompare(dateB) || a.addedAt.localeCompare(b.addedAt);
          });

        while (bytesAfterImport > LIBRARY_LIMIT_BYTES && removable.length > 0) {
          const oldest = removable.shift();
          if (!oldest) break;
          removed.push(oldest);
          bytesAfterImport -= oldest.storedBytes;
        }

        if (bytesAfterImport > LIBRARY_LIMIT_BYTES) {
          failure = new Error("Pinned documents leave too little room. Unpin or remove a document before importing.");
          transaction.abort();
          return;
        }

        for (const oldDocument of removed) store.delete(oldDocument.id);
        store.put(document);
      };
      request.onerror = () => {
        failure = request.error ?? new Error("Could not check offline storage before importing.");
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(removed);
      transaction.onerror = () => reject(failure ?? transaction.error ?? new Error("Could not save the offline document."));
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Offline document import was cancelled."));
    });
  } finally {
    database.close();
  }
}

export async function updateDocumentPin(id: string, pinned: boolean): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const document = request.result as OfflineEvidenceDocument | undefined;
        if (!document) {
          transaction.abort();
          return;
        }
        store.put({ ...document, pinned });
      };
      request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not update document pin."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not update document pin."));
    });
  } finally {
    database.close();
  }
}

export async function removeOfflineDocument(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove offline document."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not remove offline document."));
    });
  } finally {
    database.close();
  }
}

export async function estimateBrowserStorage(): Promise<LibraryEstimate> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  const estimate = await navigator.storage.estimate();
  return {
    usage: typeof estimate.usage === "number" ? estimate.usage : null,
    quota: typeof estimate.quota === "number" ? estimate.quota : null,
  };
}

export async function prepareLocalDocument(
  file: File,
  publicationDate: string,
): Promise<OfflineEvidenceDocument> {
  if (file.size === 0) throw new Error("The selected file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files must be 25 MB or smaller.");

  const extension = file.name.split(".").pop()?.toLocaleLowerCase();
  const isPdf = file.type === "application/pdf" || extension === "pdf";
  const isText = file.type.startsWith("text/") || extension === "txt" || extension === "md";
  if (!isPdf && !isText) throw new Error("Choose a PDF, TXT, or Markdown file.");

  const pages = isPdf ? await extractPdfText(file) : await extractTextFile(file);
  const extractedBytes = new TextEncoder().encode(JSON.stringify(pages)).byteLength;
  if (extractedBytes > MAX_EXTRACTED_TEXT_BYTES) {
    throw new Error("Extracted text exceeds the 3 MB per-document limit.");
  }

  const normalizedDate = publicationDate && /^\d{4}-\d{2}-\d{2}$/.test(publicationDate)
    ? publicationDate
    : null;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: isPdf ? "application/pdf" : "text/plain",
    sizeBytes: file.size,
    storedBytes: file.size + extractedBytes,
    publicationDate: normalizedDate,
    addedAt: now,
    pinned: false,
    pages,
    file,
  };
}

async function extractPdfText(file: File): Promise<EvidencePage[]> {
  const pdfjs: PdfJsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDFs must have ${MAX_PDF_PAGES} pages or fewer.`);
    }
    const pages: EvidencePage[] = [];
    let extractedBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => "str" in item && typeof item.str === "string")
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        extractedBytes += new TextEncoder().encode(text).byteLength;
        if (extractedBytes > MAX_EXTRACTED_TEXT_BYTES) {
          throw new Error("Extracted text exceeds the 3 MB per-document limit.");
        }
        pages.push({ pageNumber, text });
      }
      page.cleanup();
    }
    if (pages.length === 0) {
      throw new Error("No selectable text was found. Scanned PDFs need OCR before they can be searched.");
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function extractTextFile(file: File): Promise<EvidencePage[]> {
  const text = (await file.text()).replace(/\u0000/g, "").trim();
  if (!text) throw new Error("No searchable text was found in the file.");
  return [{ pageNumber: null, text }];
}

export function searchOfflineDocuments(
  documents: OfflineEvidenceDocument[],
  query: string,
) {
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length > 1);
  if (terms.length === 0) return [];

  return documents.flatMap((document) => document.pages.map((page) => {
    const content = page.text.toLocaleLowerCase();
    const score = terms.reduce(
      (total, term) => total + Math.min(content.split(term).length - 1, 5),
      0,
    );
    if (score === 0) return null;
    const firstMatch = Math.max(0, content.indexOf(terms.find((term) => content.includes(term)) ?? ""));
    const start = Math.max(0, firstMatch - 160);
    const snippet = page.text.slice(start, start + 500);
    return {
      id: `${document.id}:${page.pageNumber ?? "text"}`,
      documentName: document.name,
      pageNumber: page.pageNumber,
      citation: page.pageNumber ? `${document.name}, p. ${page.pageNumber}` : document.name,
      snippet: `${start > 0 ? "…" : ""}${snippet}${start + 500 < page.text.length ? "…" : ""}`,
      score,
    };
  }))
    .filter((result): result is NonNullable<typeof result> => result !== null)
    .sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation))
    .slice(0, 10);
}
