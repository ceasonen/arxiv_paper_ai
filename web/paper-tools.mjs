export const idPattern = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})$/;
export const codeLinkPattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
export const officialLink = (kind, id) => `https://arxiv.org/${kind}/${id}`;

const categories = ["cs.AI", "cs.CL", "cs.CV", "cs.LG", "cs.RO", "cs.DC"];
const clean = (text) => typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";

export function dataciteBatchUrl(page) {
  const url = new URL("https://api.datacite.org/dois");
  url.search = new URLSearchParams({
    "client-id": "arxiv.content",
    query: `subjects.subject:(${categories.map((category) => `"${category}"`).join(" OR ")})`,
    sort: "-created",
    "page[number]": page,
    "page[size]": 25,
    "fields[dois]": "titles,creators,dates,subjects,descriptions",
  }).toString();
  return url;
}

export function datacitePapers(records, topicPatterns) {
  const matchers = Object.entries(topicPatterns).map(([key, pattern]) => [key, new RegExp(`\\b(?:${pattern})\\b`, "i")]);
  const papers = [];
  for (const record of records) {
    const id = /^10\.48550\/arxiv\.(.+)$/i.exec(record?.id)?.[1];
    if (!id || !idPattern.test(id) || !record.attributes) continue;

    const {titles = [], descriptions = [], dates = [], subjects = [], creators = []} = record.attributes;
    const title = clean(titles[0]?.title);
    const abstract = clean(descriptions.find((item) => item.descriptionType === "Abstract")?.description).slice(0, 5500);
    const submitted = dates.find((item) => item.dateType === "Submitted" && item.dateInformation === "v1");
    const date = submitted?.date?.slice(0, 10);
    const paperCategories = [...new Set(subjects
      .filter((item) => item.subjectScheme === "arXiv")
      .map((item) => /\(([^()]+)\)$/.exec(item.subject)?.[1])
      .filter(Boolean))];
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !paperCategories.some((category) => categories.includes(category))) continue;

    const authors = creators.map((author) => clean([author.givenName, author.familyName].filter(Boolean).join(" ")) || clean(author.name)).filter(Boolean);
    const affiliations = [...new Set(creators.flatMap((author) => (author.affiliation || [])
      .map((affiliation) => clean(affiliation.name ?? affiliation))).filter(Boolean))];
    const topics = matchers.filter(([, pattern]) => pattern.test(title + " " + abstract)).map(([key]) => key);
    const code = abstract.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/i)?.[0].replace(/\.+$/, "") || null;
    papers.push({id, title, abstract, authors, date, dateKind: "submission", categories: paperCategories, topics, affiliations, code});
  }
  return papers;
}

const escapeMarkdown = (value) => clean(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replace(/[\\`*_\[\]~]/g, "\\$&");

export function papersMarkdown(papers) {
  const lines = ["# Paper Radar", "", `${papers.length} ${papers.length === 1 ? "paper" : "papers"}`, ""];
  for (const paper of papers) {
    lines.push(`## ${escapeMarkdown(paper.title)}`, "");
    if (paper.authors.length) lines.push(`- Authors: ${paper.authors.map(escapeMarkdown).join(", ")}`);
    lines.push(`- ${paper.dateKind === "submission" ? "Submitted" : "arXiv announcement"}: ${paper.date}`);
    if (paper.categories.length) lines.push(`- Categories: ${paper.categories.map(escapeMarkdown).join(", ")}`);
    const affiliations = (paper.affiliations || []).filter((name) => typeof name === "string");
    if (affiliations.length) lines.push(`- Affiliations: ${affiliations.map(escapeMarkdown).join("; ")}`);
    const links = [`[arXiv](${officialLink("abs", paper.id)})`, `[PDF](${officialLink("pdf", paper.id)})`];
    if (codeLinkPattern.test(paper.code)) links.push(`[Code](${paper.code})`);
    lines.push(`- Links: ${links.join(" · ")}`, "");
    if (paper.abstract) lines.push(`**Abstract:** ${escapeMarkdown(paper.abstract)}`, "");
  }
  return lines.join("\n");
}
