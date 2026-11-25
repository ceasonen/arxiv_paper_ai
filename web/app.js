const select = (id) => document.getElementById(id);
const PAGE_SIZE = 14;
const STORAGE_KEY = "paper-radar-reading-list";
const idPattern = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})$/;
const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const formatDate = (date) => dateFormat.format(new Date(`${date}T00:00:00Z`));
const officialLink = (kind, id) => `https://arxiv.org/${kind}/${id}`;

const catalogContainer = select("entries");
const query = select("search");
const release = select("release");
const more = select("more");
const exportButton = select("export");
const topicButtons = select("topics");
let catalog;
let mode = "all";
let topic = "";
let visibleCount = PAGE_SIZE;
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

function matchingPapers() {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sourcePapers().filter((paper) => {
    const matchesDate = mode === "saved" || release.value === "all"
      || paper.date === (release.value === "latest" ? catalog.source_date : release.value);
    if (!matchesDate || (topic && !paper.topics.includes(topic))) return false;
    if (!words.length) return true;
    const index = [paper.id, paper.title, paper.abstract, ...paper.authors, ...paper.categories].join(" ").toLowerCase();
    return words.every((word) => index.includes(word));
  });
}

function displayPaper(paper) {
  const card = select("paper-template").content.firstElementChild.cloneNode(true);
  const field = (name) => card.querySelector(`[data-paper="${name}"]`);
  const time = field("meta").querySelector("time");
  time.textContent = formatDate(paper.date);
  time.dateTime = paper.date;
  const categories = field("categories");
  categories.textContent = paper.categories.slice(0, 3).join(" · ");
  categories.hidden = paper.categories.length === 0;

  field("title").append(link(paper.title, officialLink("abs", paper.id), "text-reset"));
  const authorLine = paper.authors.slice(0, 3).join(", ")
    + (paper.authors.length > 3 ? ` +${paper.authors.length - 3} more` : "");
  field("authors").textContent = authorLine || "Authors listed on arXiv";
  const titleTopic = catalog.topics[topic] || catalog.topics[paper.topics[0]];
  if (titleTopic) field("topics").append(element("span", "badge bg-blue-lt", titleTopic));

  const actions = field("links");
  actions.append(link("PDF", officialLink("pdf", paper.id), "btn btn-sm btn-outline-primary"));
  if (typeof paper.code === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(paper.code)) {
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
  release.disabled = mode === "saved";
  catalogContainer.replaceChildren(...items.slice(0, visibleCount).map(displayPaper));
  if (!items.length) {
    let text = "No papers match these filters.";
    if (mode === "saved" && !saved.size) text = "Your reading list is empty. Save a paper to find it here.";
    if (mode === "all" && release.value === "latest" && !topic && !query.value.trim()) {
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
  query.value = "";
  resetAndRender();
}));
topicButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic]");
  if (!button) return;
  topic = button.dataset.topic;
  resetAndRender();
});
query.addEventListener("input", resetAndRender);
release.addEventListener("change", resetAndRender);
more.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  render();
});
exportButton.addEventListener("click", () => {
  const links = Array.from(saved.keys(), (id) => officialLink("pdf", id)).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([links], {type: "text/plain"}));
  const anchor = element("a");
  anchor.href = url;
  anchor.download = "paper-radar-pdfs.txt";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
} catch {
  catalog = undefined;
  select("source-date").textContent = "Unavailable";
  select("result-count").textContent = "The catalog could not be loaded.";
  const hint = element("p", "alert alert-warning mb-0", "Refresh the page, or browse directly on ");
  hint.append(link("arXiv", "https://arxiv.org/list/cs.AI/recent"), ".");
  catalogContainer.replaceChildren(hint);
}
