import {codeLinkPattern, dataciteBatchUrl, datacitePapers, idPattern, officialLink, papersMarkdown} from "./paper-tools.mjs";

const select = (id) => document.getElementById(id);
const PAGE_SIZE = 14;
const STORAGE_KEY = "paper-radar-reading-list";
const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const formatDate = (date) => dateFormat.format(new Date(`${date}T00:00:00Z`));

const catalogContainer = select("entries");
const query = select("search");
const release = select("release");
const authorSearch = select("author-search");
const institutionSearch = select("institution-search");
const clearFilters = select("clear-filters");
const searchInputs = [query, authorSearch, institutionSearch];
const institutionAliases = new Map(Object.entries({
  "同济大学": "Tongji University",
  "清华大学": "Tsinghua University",
  "北京大学": "Peking University",
  "浙江大学": "Zhejiang University",
  "上海交通大学": "Shanghai Jiao Tong University",
  "复旦大学": "Fudan University",
  "中国科学院": "Chinese Academy of Sciences",
  "中国科学院自动化研究所": "Institute of Automation Chinese Academy of Sciences",
  "香港科技大学": "Hong Kong University of Science and Technology",
  "香港科技大学 广州": "Hong Kong University of Science and Technology Guangzhou",
  "香港科技大学广州": "Hong Kong University of Science and Technology Guangzhou",
  "港科广": "Hong Kong University of Science and Technology Guangzhou",
  "新加坡国立大学": "National University of Singapore",
  "mit": "Massachusetts Institute of Technology",
  "nus": "National University of Singapore",
  "hkust gz": "Hong Kong University of Science and Technology Guangzhou",
  "sjtu": "Shanghai Jiao Tong University",
  "zju": "Zhejiang University",
}));
const more = select("more");
const exportButton = select("export");
const markdownButton = select("markdown");
const fetchButton = select("fetch-more");
const fetchStatus = select("fetch-status");
const topicButtons = select("topics");
let catalog;
let mode = "all";
let topic = "";
let visibleCount = PAGE_SIZE;
let nextBatch = 1;
let saved = readSaved();

function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Map(Array.isArray(raw) ? raw.filter((p) => idPattern.test(p?.[0])).slice(0, 500) : []);
  } catch {
    return new Map();
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(label, href, className) {
  const anchor = element("a", className, label);
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function setPressed(button, pressed) {
  button.classList.toggle("active", pressed);
  button.setAttribute("aria-pressed", String(pressed));
}

function renderTopics() {
  const choices = [["", "All topics"], ...Object.entries(catalog.topics)];
  topicButtons.replaceChildren(...choices.map(([value, label]) => {
    const button = element("button", "list-group-item list-group-item-action", label);
    button.type = "button";
    button.dataset.topic = value;
    setPressed(button, topic === value);
    return button;
  }));
}

function validPaper(paper) {
  return idPattern.test(paper?.id) && typeof paper.title === "string"
    && typeof paper.abstract === "string" && /^\d{4}-\d{2}-\d{2}$/.test(paper.date)
    && Array.isArray(paper.authors) && Array.isArray(paper.categories) && Array.isArray(paper.topics)
    && [paper.authors, paper.categories, paper.topics].every((field) => field.every((x) => typeof x === "string"));
}

function sourcePapers() {
  if (mode === "all") return catalog.papers;
  return Array.from(saved.entries(), ([id, paper]) => catalog.papersById.get(id) || paper).filter(validPaper);
}

function normalized(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function matchesName(value, tokens) {
  const words = normalized(value).split(" ");
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function affiliations(paper) {
  return Array.isArray(paper.affiliations) ? paper.affiliations.filter((name) => typeof name === "string") : [];
}

function nameTokens(value, aliases) {
  const input = normalized(value);
  return normalized(aliases?.get(input) || input).split(" ").filter(Boolean);
}

function matchingPapers() {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const author = nameTokens(authorSearch.value);
  const institution = nameTokens(institutionSearch.value, institutionAliases);
  return sourcePapers().filter((paper) => {
    const fetched = paper.dateKind === "submission";
    const matchesDate = mode === "saved" || release.value === "all"
      || (release.value === "fetched" ? fetched
        : !fetched && paper.date === (release.value === "latest" ? catalog.source_date : release.value));
    if (!matchesDate || (topic && !paper.topics.includes(topic))) return false;
    if (author.length && !paper.authors.some((name) => matchesName(name, author))) return false;
    if (institution.length && !affiliations(paper).some((name) => matchesName(name, institution))) return false;
    if (!words.length) return true;
    const index = [paper.id, paper.title, paper.abstract, ...paper.authors, ...paper.categories].join(" ").toLowerCase();
    return words.every((word) => index.includes(word));
  });
}

function filterButton(name, input) {
  const button = element("button", "btn btn-sm btn-link p-0 text-start text-wrap", name);
  button.type = "button";
  button.setAttribute("aria-label", `Filter by ${input === authorSearch ? "author" : "institution"}: ${name}`);
  button.addEventListener("click", () => {
    input.value = name;
    resetAndRender();
    input.focus({preventScroll: true});
  });
  return button;
}

function displayPaper(paper) {
  const card = select("paper-template").content.firstElementChild.cloneNode(true);
  const field = (name) => card.querySelector(`[data-paper="${name}"]`);
  const time = field("meta").querySelector("time");
  time.textContent = (paper.dateKind === "submission" ? "Submitted " : "") + formatDate(paper.date);
  time.dateTime = paper.date;
  const categories = field("categories");
  categories.textContent = paper.categories.slice(0, 3).join(" · ");
  categories.hidden = paper.categories.length === 0;

  field("title").append(link(paper.title, officialLink("abs", paper.id), "text-reset"));
  const authorLine = field("authors");
  if (!paper.authors.length) authorLine.textContent = "Authors listed on arXiv";
  const showAuthors = (limit) => {
    authorLine.replaceChildren();
    paper.authors.slice(0, limit).forEach((name, index) => {
      if (index) authorLine.append(", ");
      authorLine.append(filterButton(name, authorSearch));
    });
    if (paper.authors.length > limit) {
      const moreAuthors = element("button", "btn btn-sm btn-link p-0 ms-1", `+${paper.authors.length - limit} more`);
      moreAuthors.type = "button";
      moreAuthors.addEventListener("click", () => {
        showAuthors(paper.authors.length);
        authorLine.querySelectorAll("button")[limit]?.focus();
      });
      authorLine.append(moreAuthors);
    }
  };
  if (paper.authors.length) showAuthors(3);
  const names = affiliations(paper);
  const institutionLine = field("affiliations");
  if (names.length) {
    institutionLine.hidden = false;
    institutionLine.append(element("span", "text-secondary", "Affiliations: "));
    names.forEach((name, index) => {
      if (index) institutionLine.append(" · ");
      institutionLine.append(filterButton(name, institutionSearch));
    });
    const provenance = paper.affiliation_source === "arxiv" ? officialLink("html", paper.id) : paper.affiliation_url;
    if (provenance && /^https:\/\/(?:arxiv\.org\/html\/[^?#]+|openalex\.org\/W\d+)$/.test(provenance)) {
      institutionLine.append(" ", link("Source", provenance, "link-secondary ms-1"));
    }
  }
  const titleTopic = catalog.topics[topic] || catalog.topics[paper.topics[0]];
  if (titleTopic) field("topics").append(element("span", "badge bg-blue-lt", titleTopic));

  const actions = field("links");
  actions.append(link("PDF", officialLink("pdf", paper.id), "btn btn-sm btn-outline-primary"));
  if (codeLinkPattern.test(paper.code)) {
    actions.append(link("Code", paper.code, "btn btn-sm btn-outline-secondary"));
  }

  const abstract = card.querySelector(".abstract");
  abstract.textContent = paper.abstract;
  abstract.id = "abstract-" + paper.id;
  const abstractButton = field("abstract-toggle");
  abstractButton.setAttribute("aria-controls", abstract.id);
  abstractButton.addEventListener("click", () => {
    abstract.hidden = !abstract.hidden;
    abstractButton.setAttribute("aria-expanded", String(!abstract.hidden));
    abstractButton.textContent = abstract.hidden ? "Abstract" : "Hide abstract";
  });

  const save = card.querySelector(".save");
  save.setAttribute("aria-label", "Save " + paper.title);
  const updateSave = () => {
    const isSaved = saved.has(paper.id);
    save.textContent = isSaved ? "Saved" : "Save";
    save.setAttribute("aria-pressed", String(isSaved));
    save.classList.toggle("btn-primary", isSaved);
    save.classList.toggle("btn-outline-primary", !isSaved);
  };
  updateSave();
  save.addEventListener("click", () => {
    if (saved.has(paper.id)) saved.delete(paper.id);
    else saved.set(paper.id, paper);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(saved.entries()).slice(-500)));
    } catch { /* Reading list still works for this visit. */ }
    select("saved-count").textContent = saved.size;
    updateSave();
    if (mode === "saved") {
      render();
      document.querySelector('[data-mode="saved"]').focus();
    }
  });

  return card;
}

function render() {
  const items = matchingPapers();
  document.querySelectorAll("[data-mode]").forEach((b) => setPressed(b, b.dataset.mode === mode));
  topicButtons.querySelectorAll("[data-topic]").forEach((b) => setPressed(b, b.dataset.topic === topic));
  select("heading").textContent = mode === "saved" ? "Reading list" : "Browse papers";
  select("saved-count").textContent = saved.size;
  select("result-count").textContent = `${items.length.toLocaleString()} ${items.length === 1 ? "paper" : "papers"}`;
  exportButton.hidden = mode !== "saved" || saved.size === 0;
  markdownButton.disabled = items.length === 0;
  release.disabled = mode === "saved";
  clearFilters.hidden = !topic && !searchInputs.some((input) => input.value.trim())
    && release.value === "latest";
  catalogContainer.replaceChildren(...items.slice(0, visibleCount).map(displayPaper));
  if (!items.length) {
    let text = "No papers match these filters.";
    if (mode === "saved" && !saved.size) text = "Your reading list is empty. Save a paper to find it here.";
    if (mode === "all" && release.value === "latest") {
      text = "No matching papers in the latest release. Choose All releases to browse the archive.";
    }
    catalogContainer.append(element("p", "alert alert-info mb-0", text));
  }
  more.hidden = items.length <= visibleCount;
}

function resetAndRender() {
  visibleCount = PAGE_SIZE;
  if (catalog) render();
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.mode;
  topic = "";
  searchInputs.forEach((input) => { input.value = ""; });
  resetAndRender();
}));
topicButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  topic = button.dataset.topic;
  resetAndRender();
});
searchInputs.forEach((input) => input.addEventListener("input", resetAndRender));
release.addEventListener("change", resetAndRender);
clearFilters.addEventListener("click", () => {
  topic = "";
  release.value = "latest";
  searchInputs.forEach((input) => { input.value = ""; });
  select("author-options").replaceChildren();
  resetAndRender();
  query.focus();
});
authorSearch.addEventListener("input", () => {
  const terms = nameTokens(authorSearch.value);
  const names = authorSearch.value.trim().length >= 2
    ? (catalog?.authorNames || []).filter((name) => matchesName(name, terms)).slice(0, 8)
    : [];
  select("author-options").replaceChildren(...names.map((name) => new Option(name, name)));
});
more.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  render();
});
function downloadText(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type: type + ";charset=utf-8"}));
  const anchor = element("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportButton.addEventListener("click", () => {
  const links = Array.from(saved.keys(), (id) => officialLink("pdf", id)).join("\n") + "\n";
  downloadText(links, "paper-radar-pdfs.txt", "text/plain");
});
markdownButton.addEventListener("click", () => {
  const papers = matchingPapers();
  if (papers.length) downloadText(papersMarkdown(papers), "paper-radar.md", "text/markdown");
});

fetchButton.addEventListener("click", async () => {
  fetchButton.disabled = true;
  fetchStatus.hidden = false;
  fetchStatus.textContent = "Fetching arXiv records from DataCite…";
  try {
    const response = await fetch(dataciteBatchUrl(nextBatch), {signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error("DataCite request failed");
    const batch = await response.json();
    if (!Array.isArray(batch.data)) throw new Error("Invalid DataCite response");
    const added = [];
    for (const paper of datacitePapers(batch.data, catalog.topic_patterns || {}).filter(validPaper)) {
      if (catalog.papersById.has(paper.id)) continue;
      catalog.papersById.set(paper.id, paper);
      added.push(paper);
    }
    if (added.length) {
      catalog.papers = [...catalog.papers, ...added].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      indexNames();
      mode = "all";
      const fetchedOption = release.querySelector('[value="fetched"]');
      fetchedOption.hidden = false;
      fetchedOption.disabled = false;
      release.value = "fetched";
      resetAndRender();
    }
    nextBatch = batch.links?.next ? nextBatch + 1 : null;
    fetchStatus.textContent = added.length
      ? `Added ${added.length} ${added.length === 1 ? "paper" : "papers"} to this session from DataCite.`
      : nextBatch ? "No new papers in this batch. Fetch again for the next batch." : "No more papers in this feed.";
  } catch {
    fetchStatus.textContent = "DataCite is temporarily unavailable. Try again in a moment.";
  } finally {
    fetchButton.disabled = nextBatch === null;
  }
});

const desktop = matchMedia("(min-width: 768px)");
const topicFilters = select("topic-filters");
topicFilters.open = desktop.matches;
desktop.addEventListener("change", (event) => { topicFilters.open = event.matches; });

try {
  const response = await fetch("./data/catalog.json", {cache: "no-cache"});
  if (!response.ok) throw new Error("Catalog request failed");
  catalog = await response.json();
  if (catalog.schema !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(catalog.source_date)
      || !catalog.topics || !Array.isArray(catalog.papers)) throw new Error("Invalid catalog");
  catalog.papers = catalog.papers.filter(validPaper);
  catalog.papersById = new Map(catalog.papers.map((p) => [p.id, p]));
  indexNames();
  select("source-date").textContent = formatDate(catalog.source_date);
  select("source-date").dateTime = catalog.source_date;
  select("digest-count").hidden = false;
  select("digest-count").textContent = `${catalog.papers.length.toLocaleString()} papers in archive`;
  const dates = [...new Set(catalog.papers.map((p) => p.date))].sort().reverse();
  for (const date of dates) {
    if (date === catalog.source_date) continue;
    release.add(new Option(formatDate(date), date));
  }
  renderTopics();
  render();
  fetchButton.disabled = false;
} catch {
  catalog = undefined;
  select("source-date").textContent = "Unavailable";
  select("result-count").textContent = "The catalog could not be loaded.";
  const hint = element("p", "alert alert-warning mb-0", "Refresh the page, or browse directly on ");
  hint.append(link("arXiv", "https://arxiv.org/list/cs.AI/recent"), ".");
  catalogContainer.replaceChildren(hint);
}

function indexNames() {
  catalog.authorNames = [...new Set(catalog.papers.flatMap((paper) => paper.authors))]
    .sort((a, b) => a.localeCompare(b));
  const names = [...new Set(catalog.papers.flatMap(affiliations))].sort((a, b) => a.localeCompare(b));
  select("institution-options").replaceChildren(...names.map((name) => new Option(name, name)));
  const covered = catalog.papers.filter((paper) => affiliations(paper).length).length;
  select("affiliation-coverage").textContent = `Affiliations indexed for ${covered.toLocaleString()} of ${catalog.papers.length.toLocaleString()} papers in the catalog and this session.`;
}
