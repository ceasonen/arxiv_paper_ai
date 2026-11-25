"""Affiliations come from structured sources and survive a catalog refresh."""

import unittest
from datetime import date, timedelta

from affiliations import affiliations_from_html, from_openalex, html_candidates
from radar import merge, parse_feed
from test_catalog import FEED


class AffiliationTest(unittest.TestCase):
    def test_only_structured_author_affiliations_before_abstract_are_collected(self):
        payload = """
          <article class="ltx_document">
            <div class="ltx_authors">
              <span class="ltx_role_affiliation"><span>Affiliation: </span> Tsinghua&nbsp;University
                <sup>1</sup><span class="ltx_role_email">author@example.org</span>
              </span>
              <span class="ltx_role_affiliation">Affiliation: Tsinghua University</span>
              <span class="ltx_role_affiliation">Allen Institute for AI
                <sup>*</sup>Equal contribution</span>
            </div>
            <div class="ltx_abstract">See Harvard University.</div>
            <div class="ltx_role_affiliation">University in a footnote</div>
          </article>
        """
        self.assertEqual(affiliations_from_html(payload), ["Tsinghua University", "Allen Institute for AI"])

    def test_openalex_uses_the_exact_arxiv_doi_instead_of_a_title_guess(self):
        record = {
            "id": "https://openalex.org/W1234",
            "doi": "https://doi.org/10.1145/example",
            "locations": [{"doi": "https://doi.org/10.48550/arXiv.2611.01234"}],
            "authorships": [
                {"institutions": [{"display_name": "University of Washington"}]},
                {"institutions": [{"display_name": "University of Washington"}]},
            ],
        }
        output = from_openalex([record], {"2611.01234", "2611.01200"})
        self.assertEqual(output["2611.01234"]["affiliations"], ["University of Washington"])
        self.assertNotIn("2611.01200", output)

    def test_rescanning_preserves_enrichment_and_recent_attempts(self):
        day, papers = parse_feed(FEED.encode())
        empty = {**papers[0], "affiliation_checked": day.isoformat()}
        original = merge(None, day, papers)
        original["papers"][0].update(
            affiliations=["Tongji University"], affiliation_source="arxiv",
            affiliation_checked=day.isoformat(),
        )
        later = merge(original, day, papers)
        self.assertIs(later, original)
        self.assertEqual(html_candidates(later["papers"], day, 10), [])
        self.assertEqual(html_candidates([empty], day, 10), [])
        self.assertEqual(html_candidates([empty], day + timedelta(days=7), 10), [empty])


if __name__ == "__main__":
    unittest.main()
