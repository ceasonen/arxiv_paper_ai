import unittest
from datetime import date

from radar import merge, parse_feed

FEED = """<?xml version="1.0"?>
<rss xmlns:arxiv="http://arxiv.org/schemas/atom"
    xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <pubDate>Wed, 25 Nov 2026 00:00:00 -0500</pubDate>
    <item>
      <title>Efficient vision-language models for robot manipulation</title>
      <link>https://arxiv.org/abs/2611.01234</link>
      <guid>oai:arXiv.org:2611.01234v1</guid>
      <description>arXiv:2611.01234v1 Announce Type: new
        Abstract: We evaluate reinforcement learning. Code: https://github.com/lab/robot-model.
      </description>
      <pubDate>Wed, 25 Nov 2026 00:00:00 -0500</pubDate>
      <arxiv:announce_type>new</arxiv:announce_type>
      <category>cs.RO</category>
      <dc:creator>A. Person, B. Person</dc:creator>
    </item>
    <item>
      <title>An updated article</title>
      <link>https://arxiv.org/abs/2611.01235</link>
      <guid>oai:arXiv.org:2611.01235v2</guid>
      <description>Abstract: This is a revision.</description>
      <arxiv:announce_type>replace</arxiv:announce_type>
    </item>
    <item>
      <title>A paper from an invalid link</title>
      <link>https://example.org/abs/2611.01236</link>
      <guid>oai:arXiv.org:2611.01236v1</guid>
    </item>
  </channel>
</rss>
"""


class CatalogTest(unittest.TestCase):
    def test_public_feed_yields_typed_metadata_and_source_links(self):
        day, papers = parse_feed(FEED.encode())
        self.assertEqual(day, date(2026, 11, 25))
        self.assertEqual(len(papers), 1)
        paper = papers[0]
        self.assertEqual(paper["id"], "2611.01234")
        self.assertEqual(paper["authors"], ["A. Person", "B. Person"])
        self.assertEqual(paper["abstract"].split(".")[0], "We evaluate reinforcement learning")
        self.assertEqual(paper["code"], "https://github.com/lab/robot-model")
        self.assertIn("robotics", paper["topics"])
        self.assertIn("multimodal", paper["topics"])

    def test_daily_refresh_is_idempotent_and_keeps_first_date(self):
        day, papers = parse_feed(FEED.encode())
        initial = merge(None, day, papers)
        self.assertIs(merge(initial, day, papers), initial)
        tomorrow = date(2026, 11, 26)
        crosslist = {**papers[0], "categories": ["cs.AI"], "date": tomorrow.isoformat()}
        later = merge(initial, tomorrow, [crosslist])
        self.assertEqual(len(later["papers"]), 1)
        self.assertEqual(later["papers"][0]["date"], day.isoformat())
        self.assertEqual(later["papers"][0]["categories"], ["cs.AI", "cs.RO"])
        self.assertIs(merge(later, day, papers), later)

    def test_off_topic_and_malformed_feed_do_not_fabricate_records(self):
        _, papers = parse_feed(
            FEED.replace("A paper from an invalid link", "An unrelated math result").encode()
        )
        self.assertEqual(len(papers), 1)
        with self.assertRaises(ValueError):
            parse_feed(b"<rss><channel/></rss>")

    def test_retention_and_limit_cap_history(self):
        day, papers = parse_feed(FEED.encode())
        old = {**papers[0], "id": "2601.01234", "date": "2026-01-01"}
        current = merge({**merge(None, day, papers), "source_date": "2026-11-24", "papers": [old]}, day, papers)
        self.assertEqual([p["id"] for p in current["papers"]], ["2611.01234"])


if __name__ == "__main__":
    unittest.main()
