import assert from "node:assert/strict";
import test from "node:test";

import {dataciteBatchUrl, datacitePapers, papersMarkdown} from "../web/paper-tools.mjs";

const record = {
  id: "10.48550/arxiv.2611.34750",
  attributes: {
    titles: [{title: "Reliable *robotics* & <vision>"}],
    dates: [
      {date: "2026-11-25T17:25:17Z", dateType: "Submitted", dateInformation: "v1"},
      {date: "2026-11-26T05:43:11Z", dateType: "Submitted", dateInformation: "v2"},
    ],
    creators: [{name: "Li, Xiang", givenName: "Xiang", familyName: "Li", affiliation: [{name: "Tongji University"}]}],
    descriptions: [{descriptionType: "Abstract", description: "Multimodal robotics. Code: https://github.com/example/demo."}],
    subjects: [{subjectScheme: "arXiv", subject: "Robotics (cs.RO)"}],
  },
};

test("fetches a small, sorted batch of public arXiv DOI records", () => {
  const url = dataciteBatchUrl(2);
  assert.equal(url.origin, "https://api.datacite.org");
  assert.equal(url.searchParams.get("client-id"), "arxiv.content");
  assert.equal(url.searchParams.get("sort"), "-created");
  assert.equal(url.searchParams.get("page[number]"), "2");
  assert.equal(url.searchParams.get("page[size]"), "25");
});

test("normalizes source records and ignores other sources and categories", () => {
  const offTopic = {...record, attributes: {...record.attributes, subjects: [{subjectScheme: "arXiv", subject: "Number Theory (math.NT)"}]}};
  const result = datacitePapers([record, {...record, id: "10.1234/nope"}, offTopic], {robotics: "robotics"});
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].authors, ["Xiang Li"]);
  assert.deepEqual(result[0].affiliations, ["Tongji University"]);
  assert.deepEqual(result[0].topics, ["robotics"]);
  assert.equal(result[0].date, "2026-11-25");
  assert.equal(result[0].code, "https://github.com/example/demo");
});

test("exports the paper metadata, escaping Markdown and using trusted paper links", () => {
  const [paper] = datacitePapers([record], {});
  const markdown = papersMarkdown([paper, {...paper, id: "2611.34749", title: "另一篇", code: "javascript:alert(1)"}]);
  assert.ok(markdown.includes("Reliable \\*robotics\\* &amp; &lt;vision&gt;"));
  assert.ok(markdown.includes("Xiang Li"));
  assert.ok(markdown.includes("Tongji University"));
  assert.ok(markdown.includes("Submitted: 2026-11-25"));
  assert.ok(markdown.includes("[PDF](https://arxiv.org/pdf/2611.34750)"));
  assert.ok(markdown.includes("另一篇"));
  assert.ok(!markdown.includes("javascript:"));
});
