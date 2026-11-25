"""Build a small, rolling catalog from arXiv's public announcement feed."""

import argparse
import json
import re
import shutil
import sys
import tempfile
import time
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import NotRequired, TypedDict
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from affiliations import enrich

FEED_URL = "https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.CV+cs.LG+cs.RO+cs.DC"
USER_AGENT = "PaperRadar/1.0 (+https://ceasonen.github.io/arxiv_paper_ai/)"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"
DC_NS = "{http://purl.org/dc/elements/1.1/}"
ID_PATTERN = re.compile(r"(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*/\d{7})")
CODE_PATTERN = re.compile(r"https://github\.com/([\w-]+/[\w.-]+)", re.IGNORECASE)
TOPICS = {
    "multimodal": ("Multimodal AI", r"multi[- ]?modal|vision[- ]language|visual question answering|mllms?|vlms?"),
    "llm": ("Language models", r"large language models?|llms?|reasoning models?|language model agents?"),
    "generation": ("Image / video generation", r"(?:image|video|visual)[- ](?:generation|editing|synthesis)|text[- ]to[- ](?:image|video)|diffusion models?|world models?"),
    "robotics": ("Robotics & embodied AI", r"robot(?:ics|ic|s)?|embodied (?:ai|agents?|intelligence)|vision[- ]language[- ]action|dexterous manipulation"),
    "rl": ("Reinforcement learning", r"reinforcement learning|policy optimization|rlhf|offline rl|reward modeling|\bppo\b|\bgrpo\b"),
    "systems": ("AI systems", r"model compression|(?:knowledge )?distillation|quantization|mixture[- ]of[- ]experts|speculative decoding|inference serving|kv[- ]cache|distributed training|gpu kernels?"),
}


class Paper(TypedDict):
    id: str
    title: str
    authors: list[str]
    abstract: str
    date: str
    categories: list[str]
    topics: list[str]
    code: str | None
    affiliations: NotRequired[list[str]]
    affiliation_source: NotRequired[str]
    affiliation_url: NotRequired[str]
    affiliation_checked: NotRequired[str]


class Catalog(TypedDict):
    schema: int
    source_date: str
    topics: dict[str, str]
    papers: list[Paper]


def clean(text: str | None) -> str:
    return " ".join((text or "").split())


def parse_feed(payload: bytes) -> tuple[date, list[Paper]]:
    # RSS is supplied by arXiv. No DTDs or custom entities are needed.
    if b"<!doctype" in payload.lower() or b"<!entity" in payload.lower():
        raise ValueError("Unexpected XML declarations in arXiv RSS")
    channel = ET.fromstring(payload).find("channel")
    if channel is None:
        raise ValueError("arXiv did not return an RSS channel")
    day = parsedate_to_datetime(channel.findtext("pubDate", "")).date()
    items = channel.findall("item")
    if not items:
        raise ValueError("arXiv returned no announcement entries")
    papers: list[Paper] = []
    for item in items:
        if item.findtext(ARXIV_NS + "announce_type", "") not in {"new", "cross", "cross-list"}:
            continue
        link = urlsplit(item.findtext("link", ""))
        paper_id = link.path.removeprefix("/abs/")
        paper_id = re.sub(r"v\d+$", "", paper_id)
        if link.scheme not in {"http", "https"} or link.netloc != "arxiv.org" or not ID_PATTERN.fullmatch(paper_id):
            continue
        title = clean(item.findtext("title"))
        description = clean(item.findtext("description"))
        _, sep, abstract = description.partition("Abstract:")
        abstract = (abstract.strip() if sep else description)[:5500]
        if not title or not abstract:
            continue
        categories = sorted({clean(element.text) for element in item.findall("category") if clean(element.text)})
        authors = [name.strip() for name in clean(item.findtext(DC_NS + "creator")).split(",") if name.strip()]
        topics = [
            key for key, (_, pattern) in TOPICS.items()
            if re.search(rf"\b(?:{pattern})\b", f"{title} {abstract}", re.IGNORECASE)
        ]
        if not topics:
            continue
        code = CODE_PATTERN.search(abstract)
        papers.append({
            "id": paper_id, "title": title, "authors": authors, "abstract": abstract,
            "date": parsedate_to_datetime(item.findtext("pubDate") or channel.findtext("pubDate", "")).date().isoformat(),
            "categories": categories, "topics": topics,
            "code": f"https://github.com/{code.group(1).rstrip('.')}" if code else None,
        })
    if not papers:
        raise ValueError("No relevant papers found. Keeping the existing catalog.")
    return day, papers


def merge(previous: Catalog | None, day: date, fresh: list[Paper]) -> Catalog:
    if previous is not None and day.isoformat() < previous["source_date"]:
        return previous
    by_id: dict[str, Paper] = {paper["id"]: paper for paper in (previous["papers"] if previous else [])}
    for paper in fresh:
        prior = by_id.get(paper["id"])
        by_id[paper["id"]] = paper if prior is None else {
            **prior,
            **paper,
            "date": min(prior["date"], paper["date"]),
            "categories": sorted(set(prior["categories"]) | set(paper["categories"])),
        }
    cutoff = (day - timedelta(days=44)).isoformat()
    kept = sorted(
        (paper for paper in by_id.values() if paper["date"] >= cutoff),
        key=lambda paper: (paper["date"], paper["id"]),
        reverse=True,
    )[:1800]
    result: Catalog = {
        "schema": 1, "source_date": day.isoformat(),
        "topics": {key: label for key, (label, _) in TOPICS.items()},
        "papers": kept,
    }
    return previous if previous == result else result


def fetch_feed() -> bytes:
    for attempt in range(3):
        try:
            request = Request(FEED_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml"})
            with urlopen(request, timeout=30) as response:
                data = response.read(8_000_001)
                if len(data) > 8_000_000:
                    raise ValueError("arXiv RSS exceeds the configured 8 MB limit")
                return data
        except (URLError, TimeoutError) as exc:
            if attempt == 2 or (isinstance(exc, HTTPError) and exc.code not in {408, 429, 500, 502, 503, 504}):
                raise
            delay = exc.headers.get("Retry-After", "") if isinstance(exc, HTTPError) else ""
            if delay.isdecimal():
                if int(delay) > 60:
                    raise
                time.sleep(max(4, int(delay)))
            else:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError("arXiv RSS could not be retrieved")


def update(output: Path, feed: Path | None = None, affiliation_limit: int = 0) -> None:
    old = json.loads(output.read_text()) if output.is_file() else None
    day, papers = parse_feed(feed.read_bytes() if feed else fetch_feed())
    new = merge(old, day, papers)
    if affiliation_limit:
        new = {**new, "papers": enrich(new["papers"], date.today(), affiliation_limit, USER_AGENT)}
    if new != old:
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=output.parent, delete=False, mode="w", encoding="utf-8") as temporary:
            temp_path = Path(temporary.name)
            try:
                json.dump(new, temporary, ensure_ascii=False, separators=(",", ":"))
                temporary.write("\n")
                temporary.close()
                temp_path.replace(output)
            finally:
                temp_path.unlink(missing_ok=True)
    covered = sum(bool(paper.get('affiliations')) for paper in new['papers'])
    print(f"{new['source_date']}: {len(papers)} matching feed entries; "
          f"{len(new['papers'])} archived, {covered} with affiliations.")


def download(paper_id: str, directory: Path) -> None:
    """Save one explicitly selected paper for personal use."""
    if not ID_PATTERN.fullmatch(paper_id):
        raise ValueError("Pass an unversioned arXiv identifier, for example 2611.01234")
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f"{paper_id.replace('/', '-')}.pdf"
    if output.exists():
        print(output)
        return
    request = Request(f"https://arxiv.org/pdf/{paper_id}", headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=45) as response:
        first = response.read(5)
        if first != b"%PDF-":
            raise ValueError("arXiv did not return a PDF")
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
            temp_path = Path(temporary.name)
            try:
                temporary.write(first)
                shutil.copyfileobj(response, temporary)
                temporary.close()
                temp_path.replace(output)
            finally:
                temp_path.unlink(missing_ok=True)
    print(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    refresh = commands.add_parser("update", help="Refresh the catalog from arXiv RSS")
    refresh.add_argument("--output", type=Path, default=Path("web/data/catalog.json"))
    refresh.add_argument("--feed", type=Path, help="Use a local RSS document")
    refresh.add_argument("--affiliation-limit", type=int, default=0, choices=range(13),
                         help="Enrich affiliations and set the maximum number of arXiv HTML checks")
    pdf = commands.add_parser("download", help="Download one selected PDF for personal use")
    pdf.add_argument("id")
    pdf.add_argument("--directory", type=Path, default=Path("papers"))
    args = parser.parse_args()
    try:
        if args.command == "update":
            update(args.output, args.feed, args.affiliation_limit)
        else:
            download(args.id, args.directory)
    except (OSError, ValueError, ET.ParseError) as exc:
        print(f"Paper Radar: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
