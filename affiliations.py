"""Collect paper-level affiliations from explicit scholarly metadata."""

import codecs
import json
import os
import re
import sys
import time
from datetime import date, timedelta
from html.parser import HTMLParser
from http.client import HTTPException
from typing import TYPE_CHECKING
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from radar import Paper

AFFILIATION_CLASSES = {"ltx_role_affiliation", "ltx_role_institution", "ltx_affiliation"}
AUTHOR_CLASSES = {"ltx_authors", "ltx_creator", "ltx_role_author"}
IGNORED_CLASSES = {"ltx_role_email", "ltx_role_url", "ltx_note", "ltx_tag"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
ARXIV_DOI = "10.48550/arxiv."
HTML_DELAY = 15
HTML_BYTE_LIMIT = 98_304


def clean_affiliation(value: str) -> str:
    value = " ".join(value.split())
    value = re.sub(r"^(?:Affiliation|Institution)\s*:\s*", "", value, flags=re.I)
    value = re.split(r"\b(?:equal contribution|corresponding authors?|work done while)\b", value, maxsplit=1, flags=re.I)[0]
    value = value.strip(" ,.;:*†‡")
    if len(value) < 2 or len(value) > 180 or "@" in value or "://" in value:
        return ""
    return value


def unique(values: list[str]) -> list[str]:
    labels: dict[str, str] = {}
    for value in values:
        if label := clean_affiliation(value):
            labels.setdefault(label.casefold(), label)
    return list(labels.values())


class AuthorFrontMatter(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, set[str]]] = []
        self.start: int | None = None
        self.parts: list[str] = []
        self.institutions: list[str] = []
        self.finished = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.finished:
            return
        props = dict(attrs)
        classes = set((props.get("class") or "").split())
        if "ltx_abstract" in classes:
            self.finished = True
            return
        if tag == "meta" and props.get("name") == "citation_author_institution":
            self.institutions.append(props.get("content") or "")
        if tag in VOID_TAGS:
            if tag == "br" and self.start is not None:
                self.parts.append(" ")
            return
        self.stack.append((tag, classes))
        if self.start is None and classes & AFFILIATION_CLASSES:
            if any(scope & AUTHOR_CLASSES for _, scope in self.stack[:-1]):
                self.start = len(self.stack) - 1

    def handle_endtag(self, tag: str) -> None:
        if self.finished:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if self.start is not None and i <= self.start:
                    self.institutions.append("".join(self.parts))
                    self.parts.clear()
                    self.start = None
                del self.stack[i:]
                return

    def handle_data(self, data: str) -> None:
        if self.start is not None and not self.finished:
            if not any(tag in {"sup", "script", "style"} or classes & IGNORED_CLASSES
                       for tag, classes in self.stack[self.start:]):
                self.parts.append(data)


def affiliations_from_html(payload: str) -> list[str]:
    parser = AuthorFrontMatter()
    parser.feed(payload)
    parser.close()
    return unique(parser.institutions)


def from_openalex(works: list[dict], ids: set[str]) -> dict[str, dict]:
    enriched = {}
    for work in works:
        work_id = work.get("id") or ""
        if not re.fullmatch(r"https://openalex\.org/W\d+", work_id):
            continue
        dois = [work.get("doi"), *(location.get("doi") for location in work.get("locations") or [])]
        names = unique([
            inst["display_name"] for author in work.get("authorships") or []
            for inst in author.get("institutions") or []
            if isinstance(inst.get("display_name"), str)
        ])
        if not names:
            continue
        for doi in filter(None, dois):
            key = doi.lower().removeprefix("https://doi.org/")
            if key.startswith(ARXIV_DOI) and (paper_id := key[len(ARXIV_DOI):]) in ids:
                enriched.setdefault(paper_id, {
                    "affiliations": names, "affiliation_source": "openalex", "affiliation_url": work_id,
                })
    return enriched


def html_candidates(papers: list["Paper"], day: date, limit: int) -> list["Paper"]:
    cutoff = (day - timedelta(days=6)).isoformat()
    pending = [paper for paper in papers if not paper.get("affiliations") and (
        not paper.get("affiliation_checked") or paper["affiliation_checked"] <= cutoff
    )]
    pending.sort(key=lambda paper: paper.get("affiliation_checked", ""))
    return pending[:limit]


def fetch_openalex(ids: list[str], user_agent: str, api_key: str | None) -> dict[str, dict]:
    query = urlencode({
        "filter": "doi:" + "|".join(ARXIV_DOI + paper_id for paper_id in ids),
        "per_page": len(ids),
        "select": "id,doi,locations,authorships",
    })
    headers = {"User-Agent": user_agent, "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    with urlopen(Request("https://api.openalex.org/works?" + query, headers=headers), timeout=16) as response:
        body = response.read(1_500_001)
    if len(body) > 1_500_000:
        raise ValueError("OpenAlex response exceeds 1.5 MB")
    return from_openalex(json.loads(body)["results"], set(ids))


def fetch_html(paper_id: str, user_agent: str) -> list[str]:
    parser = AuthorFrontMatter()
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    request = Request(f"https://arxiv.org/html/{paper_id}", headers={"User-Agent": user_agent, "Accept": "text/html"})
    try:
        with urlopen(request, timeout=12) as response:
            location = urlsplit(response.geturl())
            if location.hostname != "arxiv.org" or not location.path.startswith("/html/"):
                return []
            limit = HTML_BYTE_LIMIT
            while limit and not parser.finished:
                data = response.read1(min(4096, limit))
                if not data:
                    break
                limit -= len(data)
                parser.feed(decoder.decode(data))
    except HTTPError as error:
        if error.code in {404, 410}:
            return []
        raise
    return unique(parser.institutions)


def enrich(papers: list["Paper"], day: date, limit: int, user_agent: str) -> list["Paper"]:
    if not limit:
        return papers
    indexed = {paper["id"]: {**paper} for paper in papers}
    unfilled = [paper["id"] for paper in papers if not paper.get("affiliations")]
    key = os.environ.get("OPENALEX_API_KEY") or None
    budget = 240 if key else 80
    for start in range(0, min(len(unfilled), budget), 80):
        try:
            matches = fetch_openalex(unfilled[start:start + 80], user_agent, key)
        except (OSError, HTTPException, ValueError, KeyError, TypeError) as error:
            code = f"HTTP {error.code}" if isinstance(error, HTTPError) else type(error).__name__
            print(f"Affiliations: OpenAlex unavailable ({code}); keeping known institutions.", file=sys.stderr)
            break
        for paper_id, patch in matches.items():
            indexed[paper_id].update(patch)
    candidates = html_candidates(list(indexed.values()), day, limit)
    for index, paper in enumerate(candidates):
        if index:
            time.sleep(HTML_DELAY)
        try:
            names = fetch_html(paper["id"], user_agent)
        except (OSError, HTTPException) as error:
            code = f"HTTP {error.code}" if isinstance(error, HTTPError) else type(error).__name__
            print(f"Affiliations: arXiv HTML stopped early ({code}); keeping known institutions.", file=sys.stderr)
            break
        paper["affiliation_checked"] = day.isoformat()
        if names:
            paper["affiliations"] = names
            paper["affiliation_source"] = "arxiv"
    return list(indexed.values())
