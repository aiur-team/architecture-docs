/* Changelog client — the one browser-side consumer of #doc-history.
   Compares the baked history window with a single localStorage marker and adds
   a transient change bar plus section/nav dots for versions the reader has not
   acknowledged.  No import, export, global, network, timer, or observer.  The
   marker is convenience state only: missing, blocked, or corrupt storage must
   never stop the document from working, so every failure returns silently. */

function runHistory() {
  const block = document.getElementById("doc-history");
  if (!block) return;

  let history = null;
  try {
    history = JSON.parse(block.textContent);
  } catch (error) {
    return;
  }
  if (!isValidHistory(history)) return;

  const main = document.querySelector("main");
  if (!main) return;

  const key = "read:" + history.doc;
  const head = history.head;

  let stored = null;
  try {
    stored = localStorage.getItem(key);
  } catch (error) {
    return;
  }

  if (stored === null) {
    try {
      localStorage.setItem(key, head);
    } catch (error) {
      /* Remain visually first-visit; the next load may retry. */
    }
    return;
  }
  if (typeof stored !== "string") return;
  if (stored === head) return;

  let since = history.versions;
  for (let i = 1; i < history.versions.length; i += 1) {
    if (history.versions[i].sha === stored) {
      since = history.versions.slice(0, i);
      break;
    }
  }

  const current = resolveCurrentSections(since);
  const marked = [];
  for (const entry of current) {
    entry.section.classList.add("history-changed");
    marked.push(entry.section);
    if (entry.link) {
      entry.link.classList.add("history-changed");
      marked.push(entry.link);
    }
  }

  const bar = buildBar(since.length, current, function () {
    try {
      localStorage.setItem(key, head);
    } catch (error) {
      return;
    }
    bar.remove();
    for (const element of marked) element.classList.remove("history-changed");
  });
  main.prepend(bar);
}

/* ---- defensive input gate ---------------------------------------------- */

const IDENT = /^[a-z0-9][a-z0-9._-]*$/;
const SHA = /^[0-9a-f]{7}$/;
const TOP_KEYS = ["doc", "head", "versions"];
const VERSION_KEYS = ["author", "changed", "date", "sha", "subject", "url"];
const CHANGE_KEYS = ["add", "clipped", "del", "file", "id", "patch"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (keys[i] !== expected[i]) return false;
  }
  return true;
}

function isIdentifier(value) {
  return typeof value === "string" && IDENT.test(value) && value !== "." && value !== "..";
}

function isValidHistory(history) {
  if (!isRecord(history) || !hasExactKeys(history, TOP_KEYS)) return false;
  if (!isIdentifier(history.doc)) return false;
  if (typeof history.head !== "string" || !SHA.test(history.head)) return false;
  const versions = history.versions;
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 12) return false;

  const seen = new Set();
  let total = 0;
  for (let i = 0; i < versions.length; i += 1) {
    const version = versions[i];
    if (!isRecord(version) || !hasExactKeys(version, VERSION_KEYS)) return false;
    if (typeof version.sha !== "string" || !SHA.test(version.sha)) return false;
    if (seen.has(version.sha)) return false;
    seen.add(version.sha);
    const changed = version.changed;
    if (!Array.isArray(changed) || changed.length > 256) return false;
    total += changed.length;
    if (total > 256) return false;
    for (let j = 0; j < changed.length; j += 1) {
      const change = changed[j];
      if (!isRecord(change) || !hasExactKeys(change, CHANGE_KEYS)) return false;
      if (!isIdentifier(change.id)) return false;
    }
  }
  return versions[0].sha === history.head;
}

/* ---- current-section resolution ---------------------------------------- */

function resolveCurrentSections(since) {
  const ids = new Set();
  for (const version of since) {
    for (const change of version.changed) {
      ids.add(change.id);
    }
  }

  const navLinks = document.querySelectorAll("nav.jump a");
  const linksByTarget = new Map();
  for (const link of navLinks) {
    if (link instanceof HTMLAnchorElement && !linksByTarget.has(link.getAttribute("href"))) {
      linksByTarget.set(link.getAttribute("href"), link);
    }
  }

  const current = [];
  for (const id of ids) {
    const section = document.getElementById(id);
    if (!(section instanceof HTMLElement) || section.tagName !== "SECTION" || section.id !== id) continue;
    const details = section.querySelector("details.sec");
    if (!details) continue;

    const link = linksByTarget.get("#" + id) ?? null;

    const labelNode = section.querySelector(".sec-label");
    let label = labelNode ? labelNode.textContent.trim() : "";
    if (!label && link) label = link.textContent.trim();
    if (!label) label = id;

    current.push({ id: id, section: section, details: details, link: link, label: label });
  }
  return current;
}

/* ---- change bar --------------------------------------------------------- */

function buildBar(count, current, onMarkRead) {
  const bar = document.createElement("aside");
  bar.classList.add("history-changebar");
  bar.setAttribute("aria-label", "Document updates");

  const text = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = String(count);
  text.appendChild(strong);
  text.appendChild(document.createTextNode(count === 1 ? " update since you last read this" : " updates since you last read this"));

  for (let i = 0; i < current.length; i += 1) {
    const entry = current[i];
    text.appendChild(document.createTextNode(i === 0 ? ": " : ", "));
    const link = document.createElement("a");
    link.setAttribute("href", "#" + entry.id);
    link.textContent = entry.label;
    link.addEventListener("click", function () {
      entry.details.open = true;
    });
    text.appendChild(link);
  }
  bar.appendChild(text);

  const button = document.createElement("button");
  button.setAttribute("type", "button");
  button.textContent = "Mark as read";
  button.addEventListener("click", onMarkRead);
  bar.appendChild(button);

  return bar;
}

runHistory();
