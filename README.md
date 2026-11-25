# Paper Radar

A daily catalog for AI research. Search new arXiv papers by title or abstract, filter by author, institution, topic, or date, save a local reading list, and open the original PDFs.

**Live site:** https://ceasonen.github.io/arxiv_paper_ai/

## Local use

Requires Python 3.11 or newer. The updater uses the standard library.

```sh
python3 radar.py update
python3 -m http.server 8000 --bind 127.0.0.1 --directory web
```

Open http://127.0.0.1:8000. To download an individual paper for personal use:

```sh
python3 radar.py download 2611.33158
```

The website links directly to arXiv for PDFs. The reading list stays in browser storage and can export a text file of original PDF links.

## Updates

The GitHub Actions workflow runs daily at 11:23 UTC (19:23 Beijing time). It fetches a combined [arXiv RSS feed](https://info.arxiv.org/help/rss.html), deduplicates records by arXiv identifier, and preserves the previous catalog if fetching or parsing fails. An unpublished or unchanged batch can leave the displayed release date unchanged.

The latest release offers new and cross-listed papers discovered by topic keyword rules. The archive grows as the workflow runs, retaining up to 45 days or the newest 1,800 papers. arXiv RSS exposes the current batch rather than a full historical feed. Code links are shown when an abstract contains a GitHub repository URL.

Author names come from arXiv RSS. The separate author and institution filters can be combined with topic and date. Each filter matches a field on the paper, so an institution may belong to a different coauthor. The site shows how many archived papers currently have affiliations.

Affiliations come from explicit fields in arXiv HTML front matter or OpenAlex works matched by the exact arXiv DOI. The workflow checks up to ten arXiv HTML pages per run, at least 15 seconds apart, and stops reading at the abstract or at 96 KiB. Set an optional `OPENALEX_API_KEY` Actions secret to raise the OpenAlex lookup batch budget. The catalog remains usable when enrichment is unavailable. To try enrichment locally, run `python3 radar.py update --affiliation-limit 1`.

The `paper-data` branch stores the rolling catalog. Actions builds and publishes the static website. On a fork, select **GitHub Actions** as the Pages source and run **Refresh and deploy Paper Radar** once. The archived catalog and the static deployment contain only public descriptive metadata. See [arXiv's API terms](https://info.arxiv.org/help/api/tou.html).

## Tests

```sh
python3 -m unittest discover -s tests -v
```

The interface adapts the [Tabler v1.7.5 Job Listing template](https://preview.tabler.io/job-listing.html). The upstream stylesheet and [MIT license](web/vendor/tabler/LICENSE.tabler.txt) are included with the website.

Inspired by [LLM arXiv Daily](https://github.com/xuchen-li/llm-arxiv-daily).
