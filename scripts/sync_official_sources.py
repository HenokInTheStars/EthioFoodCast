"""Sync metadata from explicitly configured official publisher listings.

No article bodies, feed excerpts, attachments, or PDFs are persisted. Full-text
ingestion stays disabled until reuse rights are verified per source.
"""
from __future__ import annotations

from html.parser import HTMLParser
import json
import os
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
SOURCE_CONFIG = ROOT / "config" / "evidence_sources.json"
OUTPUT_PATH = ROOT / "backend" / "artifacts" / "public_evidence" / "source_metadata.json"
MAX_FEED_BYTES = 5 * 1024 * 1024
MAX_ITEMS_PER_SOURCE = 100
TIMEOUT_SECONDS = 20
USER_AGENT = "EthioFoodCast-EvidenceIndexer/1.0 (metadata only)"
ETHIOPIC = re.compile(r"[\u1200-\u137f]")


class SameHostRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed_host: str) -> None:
        super().__init__()
        self.allowed_host = allowed_host

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        if _safe_url(new_url, self.allowed_host) is None:
            raise ValueError("feed redirected outside its configured HTTPS host")
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def _tag_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(element: ET.Element, names: set[str]) -> str | None:
    for child in element.iter():
        if child is element or _tag_name(child.tag) not in names:
            continue
        text = "".join(child.itertext()).strip()
        if text:
            return text
    return None


def _safe_url(value: str | None, allowed_host: str) -> str | None:
    if not value:
        return None
    try:
        parsed = urlparse(value.strip())
        port = parsed.port
    except ValueError:
        return None
    if (parsed.scheme != "https" or parsed.hostname != allowed_host
            or parsed.username is not None or parsed.password is not None or port is not None):
        return None
    return value.strip()


def _published_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, OverflowError):
            return None


def _date_from_title(title: str) -> tuple[str, str | None]:
    match = re.search(r"\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b", title)
    if not match:
        return title.strip(), None
    parsed = None
    for date_format in ("%d %B %Y", "%d %b %Y"):
        try:
            parsed = datetime.strptime(match.group(), date_format).replace(tzinfo=timezone.utc)
            break
        except ValueError:
            continue
    if parsed is None:
        return title.strip(), None
    clean_title = title[:match.start()].rstrip(" :-–—")
    return clean_title, parsed.isoformat()


class ListingLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._anchor: dict | None = None
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._anchor = dict(attrs)
            self._anchor["text"] = []

    def handle_data(self, data: str) -> None:
        if self._anchor is not None:
            self._anchor["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor is not None:
            title = " ".join(" ".join(self._anchor["text"]).split())
            href = self._anchor.get("href")
            if href and title:
                self.links.append((href, title))
            self._anchor = None


def parse_feed(xml_bytes: bytes, source: dict, retrieved_at: str) -> dict:
    """Return citation metadata only; deliberately ignore all article content."""
    if b"<!doctype" in xml_bytes.lower() or b"<!entity" in xml_bytes.lower():
        raise ValueError(f"{source['id']}: DTD and entity declarations are not accepted")

    root = ET.fromstring(xml_bytes)
    entries = [element for element in root.iter() if _tag_name(element.tag) in {"item", "entry"}]
    items = []
    seen_urls = set()

    for entry in entries:
        title = _child_text(entry, {"title"})
        link = _child_text(entry, {"link"})
        if link is None:
            link_element = next(
                (child for child in entry if _tag_name(child.tag) == "link"),
                None,
            )
            if link_element is not None:
                link = link_element.attrib.get("href")

        safe_link = _safe_url(link, source["allowed_host"])
        if not title or not safe_link or safe_link in seen_urls:
            continue

        published = _child_text(entry, {"pubdate", "published", "updated", "date"})
        items.append({
            "id": safe_link,
            "title": title[:300],
            "url": safe_link,
            "published_at": _published_date(published),
            "language": "am" if ETHIOPIC.search(title) else "en",
            "content_type": source.get("content_type", "Update"),
        })
        seen_urls.add(safe_link)
        if len(items) >= MAX_ITEMS_PER_SOURCE:
            break

    items.sort(key=lambda item: item["published_at"] or "", reverse=True)
    return {
        "id": source["id"],
        "name": source["name"],
        "publisher_url": source["publisher_url"],
        "content_type": source.get("content_type", "Update"),
        "feed_url": source["feed_url"],
        "reuse_terms_url": source.get("reuse_terms_url"),
        "rights_notes": source.get("rights_notes"),
        "rights_status": source["rights_status"],
        "external_ai_policy": source.get("external_ai_policy", "blocked"),
        "offline_content_policy": source["offline_content_policy"],
        "retrieved_at": retrieved_at,
        "items": items,
    }


def parse_html_listing(html_bytes: bytes, source: dict, retrieved_at: str) -> dict:
    """Extract titles, dates, and approved links; never persist page content."""
    parser = ListingLinkParser()
    parser.feed(html_bytes.decode("utf-8", errors="replace"))
    parser.close()
    items = []
    seen_urls = set()
    path_prefix = source["item_path_prefix"]
    listing_path = urlparse(source["listing_url"]).path.rstrip("/")

    for href, raw_title in parser.links:
        try:
            absolute_url = urljoin(source["listing_url"], href)
        except ValueError:
            continue
        safe_link = _safe_url(
            absolute_url,
            source["allowed_host"],
        )
        if not safe_link:
            continue
        parsed_link = urlparse(safe_link)
        if (not parsed_link.path.startswith(path_prefix)
                or parsed_link.path.rstrip("/") == listing_path or safe_link in seen_urls):
            continue

        title, published_at = _date_from_title(raw_title)
        if not title:
            continue
        items.append({
            "id": safe_link,
            "title": title[:300],
            "url": safe_link,
            "published_at": published_at,
            "language": "am" if ETHIOPIC.search(title) else "en",
            "content_type": source["content_type"],
        })
        seen_urls.add(safe_link)
        if len(items) >= MAX_ITEMS_PER_SOURCE:
            break

    items.sort(key=lambda item: item["published_at"] or "", reverse=True)
    return {
        "id": source["id"],
        "name": source["name"],
        "publisher_url": source["publisher_url"],
        "content_type": source["content_type"],
        "listing_url": source["listing_url"],
        "reuse_terms_url": source.get("reuse_terms_url"),
        "rights_notes": source.get("rights_notes"),
        "rights_status": source["rights_status"],
        "external_ai_policy": source.get("external_ai_policy", "blocked"),
        "offline_content_policy": source["offline_content_policy"],
        "retrieved_at": retrieved_at,
        "items": items,
    }


def fetch_feed(source: dict) -> bytes:
    feed_url = _safe_url(source["feed_url"], source["allowed_host"])
    if not feed_url:
        raise ValueError(f"{source['id']}: feed URL is outside its configured HTTPS host")

    request = urllib.request.Request(
        feed_url,
        headers={"Accept": "application/rss+xml, application/atom+xml, application/xml",
                 "User-Agent": USER_AGENT},
    )
    opener = urllib.request.build_opener(
        SameHostRedirectHandler(source["allowed_host"]),
    )
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        if _safe_url(response.geturl(), source["allowed_host"]) is None:
            raise ValueError(f"{source['id']}: feed redirected outside its configured host")
        content_type = response.headers.get_content_type()
        if content_type not in {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml"}:
            raise ValueError(f"{source['id']}: unexpected feed content type {content_type}")
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise ValueError(f"{source['id']}: feed exceeds {MAX_FEED_BYTES} bytes")
    return body


def fetch_html_listing(source: dict) -> bytes:
    listing_url = _safe_url(source["listing_url"], source["allowed_host"])
    if not listing_url:
        raise ValueError(f"{source['id']}: listing URL is outside its configured HTTPS host")

    request = urllib.request.Request(
        listing_url,
        headers={"Accept": "text/html", "User-Agent": USER_AGENT},
    )
    opener = urllib.request.build_opener(
        SameHostRedirectHandler(source["allowed_host"]),
    )
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        if _safe_url(response.geturl(), source["allowed_host"]) is None:
            raise ValueError(f"{source['id']}: listing redirected outside its configured host")
        content_type = response.headers.get_content_type()
        if content_type != "text/html":
            raise ValueError(f"{source['id']}: unexpected listing content type {content_type}")
        body = response.read(MAX_FEED_BYTES + 1)
    if len(body) > MAX_FEED_BYTES:
        raise ValueError(f"{source['id']}: listing exceeds {MAX_FEED_BYTES} bytes")
    return body


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
            suffix=".tmp",
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(data, temporary, ensure_ascii=False, indent=2)
            temporary.write("\n")
        os.replace(temporary_path, path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def sync_sources() -> dict:
    sources = json.loads(SOURCE_CONFIG.read_text(encoding="utf-8"))
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"{SOURCE_CONFIG} must contain a non-empty source list")

    retrieved_at = datetime.now(timezone.utc).isoformat()
    synced_sources = []
    for source in sources:
        if source.get("type", "rss") == "rss":
            body = fetch_feed(source)
            synced_sources.append(parse_feed(body, source, retrieved_at))
        elif source["type"] == "html_listing":
            body = fetch_html_listing(source)
            synced_sources.append(parse_html_listing(body, source, retrieved_at))
        else:
            raise ValueError(f"{source['id']}: unsupported source type {source['type']}")

    result = {"retrieved_at": retrieved_at, "sources": synced_sources}
    write_atomic(OUTPUT_PATH, result)
    return result


if __name__ == "__main__":
    synced = sync_sources()
    for source in synced["sources"]:
        print(
            f"{source['name']}: {len(source['items'])} metadata records; "
            f"rights={source['rights_status']}; no document content stored"
        )
    print(f"Metadata written to {OUTPUT_PATH}")
