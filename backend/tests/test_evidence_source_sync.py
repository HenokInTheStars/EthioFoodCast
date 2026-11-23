from scripts.sync_official_sources import parse_feed, parse_html_listing


SOURCE = {
    "id": "moa-ethiopia",
    "name": "FDRE Ministry of Agriculture",
    "content_type": "Update",
    "publisher_url": "https://www.moa.gov.et/",
    "feed_url": "https://www.moa.gov.et/feed/",
    "allowed_host": "www.moa.gov.et",
    "rights_status": "unverified",
    "external_ai_policy": "blocked",
    "offline_content_policy": "metadata_only",
}


def test_rss_sync_keeps_citation_metadata_but_not_feed_content():
    feed = b"""<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Official report title</title>
          <link>https://www.moa.gov.et/reports/one/</link>
          <pubDate>Mon, 19 Oct 2026 13:44:08 +0000</pubDate>
          <description>This excerpt must not be stored.</description>
          <content:encoded xmlns:content="urn:test"><![CDATA[Full article body]]></content:encoded>
        </item>
        <item>
          <title>External link</title>
          <link>https://example.org/not-approved/</link>
        </item>
      </channel>
    </rss>"""

    result = parse_feed(feed, SOURCE, "2026-10-20T00:00:00+00:00")

    assert result["rights_status"] == "unverified"
    assert result["external_ai_policy"] == "blocked"
    assert len(result["items"]) == 1
    assert result["items"][0]["title"] == "Official report title"
    assert result["items"][0]["url"] == "https://www.moa.gov.et/reports/one/"
    assert result["items"][0]["published_at"] == "2026-10-19T13:44:08+00:00"
    assert not {"description", "content", "pdf_url"} & result["items"][0].keys()
    assert "Full article body" not in str(result)


def test_atom_sync_accepts_only_https_links_on_approved_host():
    feed = """<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>የምርት ዘገባ</title>
        <link href="https://www.moa.gov.et/news/two/"/>
        <updated>2026-10-19T12:00:00Z</updated>
      </entry>
      <entry>
        <title>Unencrypted link</title>
        <link href="http://www.moa.gov.et/news/three/"/>
      </entry>
    </feed>"""
    feed = feed.encode("utf-8")

    result = parse_feed(feed, SOURCE, "2026-10-20T00:00:00+00:00")

    assert len(result["items"]) == 1
    assert result["items"][0]["language"] == "am"
    assert result["items"][0]["published_at"] == "2026-10-19T12:00:00+00:00"


def test_feed_with_entity_declarations_is_rejected():
    feed = b"""<!DOCTYPE rss [<!ENTITY x "unsafe">]>
    <rss><channel><item><title>&x;</title></item></channel></rss>"""

    try:
        parse_feed(feed, SOURCE, "2026-10-20T00:00:00+00:00")
    except ValueError as error:
        assert "DTD and entity" in str(error)
    else:
        raise AssertionError("DTD feed should be rejected")


def test_html_listing_keeps_only_approved_links_and_metadata():
    source = {
        "id": "wfp-ethiopia",
        "name": "World Food Programme — Ethiopia publications",
        "content_type": "Publication",
        "publisher_url": "https://www.wfp.org/countries/ethiopia",
        "listing_url": "https://www.wfp.org/countries/ethiopia",
        "item_path_prefix": "/publications/",
        "allowed_host": "www.wfp.org",
        "reuse_terms_url": "https://cdn.wfp.org/legal/terms",
        "rights_status": "conditional",
        "rights_notes": "Personal non-commercial use only.",
        "external_ai_policy": "blocked",
        "offline_content_policy": "metadata_only",
    }
    listing = """<!doctype html>
    <article>
      <a href="/publications/annual-country-reports-ethiopia">
        Annual Country Reports - Ethiopia 27 March 2025
      </a>
      <p>This page body must not be persisted.</p>
    </article>
    <a href="https://example.org/publications/unsafe">External report</a>
    <a href="/stories/not-a-publication">Story</a>""".encode()

    result = parse_html_listing(listing, source, "2026-10-20T00:00:00+00:00")

    assert len(result["items"]) == 1
    assert result["items"][0] == {
        "id": "https://www.wfp.org/publications/annual-country-reports-ethiopia",
        "title": "Annual Country Reports - Ethiopia",
        "url": "https://www.wfp.org/publications/annual-country-reports-ethiopia",
        "published_at": "2025-03-27T00:00:00+00:00",
        "language": "en",
        "content_type": "Publication",
    }
    assert "This page body" not in str(result)
    assert result["rights_status"] == "conditional"
    assert result["external_ai_policy"] == "blocked"
    assert result["reuse_terms_url"] == "https://cdn.wfp.org/legal/terms"
    assert result["rights_notes"] == "Personal non-commercial use only."


def test_html_listing_rejects_credentials_and_nonstandard_ports():
    source = {
        "id": "fao-ethiopia-news",
        "name": "FAO Ethiopia news",
        "content_type": "News",
        "publisher_url": "https://www.fao.org/ethiopia/news/en/",
        "listing_url": "https://www.fao.org/ethiopia/news/en/",
        "item_path_prefix": "/ethiopia/news/",
        "allowed_host": "www.fao.org",
        "rights_status": "unverified",
        "offline_content_policy": "metadata_only",
    }
    listing = """<a href="/ethiopia/news/en">News</a>
    <a href="https://user@www.fao.org/ethiopia/news/detail/one">Credential URL</a>
    <a href="https://www.fao.org:8443/ethiopia/news/detail/two">Nonstandard port</a>
    <a href="https://www.fao.org/ethiopia/news/detail/three">FAO news</a>""".encode()

    result = parse_html_listing(listing, source, "2026-10-20T00:00:00+00:00")

    assert [item["title"] for item in result["items"]] == ["FAO news"]
    assert result["items"][0]["content_type"] == "News"
