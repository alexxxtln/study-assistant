// JSON in localStorage for per-browser state (open blocks, threads, scroll).
// localStorage can be unavailable (private window, blocked site data); then
// the page simply starts fresh.
function loadState(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveState(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const escapeHtml = text => text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

// ---- Dialogs in the app's style: showAlert, askConfirm, askText ----
// One <dialog> serves all three. Each returns a promise: askConfirm gives
// true or false, askText the typed text or null; Esc and cancel say no.
// With choices ([{ value, label }]) it asks to pick one and gives its value or null.

function openAppDialog({ title, text = "", input = null, choices = null, ok = "ok", cancel = true, danger = false }) {
  const dialog = document.getElementById("app-dialog");
  const field = document.getElementById("ad-input");
  const picker = document.getElementById("ad-select");
  const okButton = document.getElementById("ad-ok");
  const cancelButton = document.getElementById("ad-cancel");
  const asks = input !== null || choices !== null;   // an answer, not just yes or no

  document.getElementById("ad-title").textContent = title;
  const textBox = document.getElementById("ad-text");
  textBox.textContent = text;
  textBox.hidden = !text;
  field.hidden = input === null;
  field.value = input ?? "";
  picker.hidden = choices === null;
  picker.innerHTML = (choices ?? [])
    .map(c => `<option value="${escapeHtml(String(c.value))}">${escapeHtml(c.label)}</option>`).join("");
  cancelButton.hidden = !cancel;
  okButton.textContent = ok;
  okButton.className = danger ? "danger-btn" : "primary";

  return new Promise(resolve => {
    const finish = value => {
      dialog.close();
      resolve(value);
    };
    okButton.onclick = () => finish(!asks ? true : choices !== null ? picker.value : field.value);
    cancelButton.onclick = () => finish(asks ? null : false);
    // Esc closes a <dialog> by itself; this makes it answer "no" first.
    dialog.oncancel = event => {
      event.preventDefault();
      cancelButton.onclick();
    };
    field.onkeydown = event => {
      if (event.key === "Enter") okButton.onclick();
    };
    dialog.showModal();
    if (input !== null) field.select();
    else if (choices !== null) picker.focus();
    else okButton.focus();
  });
}

// The first paragraph is the title, the rest the text under it.
const splitMessage = message => {
  const [title, ...rest] = String(message).split("\n\n");
  return { title, text: rest.join("\n\n") };
};

// "failed: <reason>" from the server becomes a titled error.
function showAlert(message) {
  const failed = String(message).match(/^failed(?: to [^:]+)?: ([\s\S]*)$/);
  return openAppDialog(failed
    ? { title: "Something went wrong", text: failed[1], cancel: false }
    : { ...splitMessage(message), cancel: false });
}

const askConfirm = (message, { ok = "ok", danger = false } = {}) =>
  openAppDialog({ ...splitMessage(message), ok, danger });

const askText = (title, value = "", ok = "save") =>
  openAppDialog({ title, input: value, ok });

// count(1, "topic") → "1 topic", count(3, "topic") → "3 topics"
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ICONS = {
  rename: `<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>`,
  delete: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  edit: `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z"/>`,
  regenerate: `<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>`,
  note: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  ask: `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>`,
  outdent: `<path d="M21 5H11"/><path d="M21 12H11"/><path d="M21 19H11"/><path d="m7 8-4 4 4 4"/>`,
  close: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
};

// [3, 4, 5, 9] → "p. 3–5, 9". With a limit, only the first ranges and "+N"
// for the rest: a topic spread over a long lecture had 30 of them.
function pageRanges(pages, limit = Infinity) {
  if (!pages?.length) return "";
  const ranges = [];
  pages.forEach(p => {
    const last = ranges[ranges.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else ranges.push([p, p]);
  });
  const shown = ranges.slice(0, limit).map(([a, b]) => a === b ? a : `${a}–${b}`).join(", ");
  return `p. ${shown}${ranges.length > limit ? ` +${ranges.length - limit}` : ""}`;
}

const icon = name => `<svg class="ico" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

const iconButton = (name, label, onclick, extra = "") =>
  `<button class="icon-btn ${extra}" title="${label}" aria-label="${label}" onclick="${onclick}">${icon(name)}</button>`;

const renderWithPages = (text, pageSource) =>
  // \s, not a plain space: models sometimes write "[page 9]" with a narrow no-break space.
  renderAnswer(text).replace(/\[page\s*(\d+)\]/g, (match, page) => {
    const sourceId = pageSource[page];
    if (!sourceId) return match;
    return `<span class="page-link" onclick="openPdf(${sourceId}, ${page})">[page ${page}]</span>`;
  });

// PDF extraction turns ↔ into "→←", and the model sometimes writes |= for ⊨.
const normalizeSymbols = text => text
  .replace(/→\s?←/g, "↔")
  .replace(/(^|\s)\|=(?=\s)/g, "$1⊨");

// LaTeX the model writes: $$…$$ and \[…\] as blocks, \(…\) inline.
const MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g;

// Lets KaTeX draw the LaTeX left in the text. The text was escaped before it
// became HTML, and KaTeX builds its own markup, so this adds no raw model HTML.
function renderMath(el) {
  if (!window.renderMathInElement) return;
  renderMathInElement(el, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
    strict: "ignore",
  });
  // Next frame: a panel is drawn hidden and shown right after, widths are 0 until then.
  requestAnimationFrame(() => markWideFormulas(el));
}

// A formula inside a line cannot wrap. One wider than its line gets its own
// sideways-scrolling box instead of running out of the panel; the rest stay
// inline as they are, so their alignment with the text does not change.
function markWideFormulas(el) {
  el.querySelectorAll(".katex").forEach(formula => {
    if (formula.closest(".katex-display")) return;
    const line = formula.parentElement.closest("p, li, td, th, blockquote, div");
    if (line && formula.offsetWidth > line.clientWidth) formula.classList.add("katex-wide");
  });
}

// `formula` → formula chip, **term** → bold, _x_ → italic.
const renderInline = line => line
  .replace(/`([^`]+)`/g, '<code class="f">$1</code>')
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<i>$2</i>")
  .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, "$1<i>$2</i>")
  // The model breaks lines inside table cells with <br>; it arrives escaped,
  // and this one tag is let through.
  .replace(/&lt;br\s*\/?&gt;/gi, "<br>");

// | a | b |  rows → <table>; the second row "|---|---|" marks the first as the header.
function renderTable(rows) {
  const isSeparator = row => row.includes("-") && /^\|?[\s:|-]+\|?$/.test(row);
  const cells = row => row.replace(/^\||\|$/g, "").split("|").map(c => renderInline(c.trim()));
  const hasHead = rows.length > 1 && isSeparator(rows[1]);
  const head = hasHead ? `<thead><tr>${cells(rows[0]).map(c => `<th>${c}</th>`).join("")}</tr></thead>` : "";
  const body = rows.slice(hasHead ? 2 : 0).filter(r => !isSeparator(r))
    .map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="md-table-wrap"><table class="md-table">${head}<tbody>${body}</tbody></table></div>`;
}

// Escapes first, then builds the HTML by hand, line by line: headings, rules,
// tables, quotes, lists and paragraphs. Blank lines between list items keep
// the list going; an indented line after an item continues that item.
const CALLOUT = /^\s*(?:\*\*)?(intuition|example|watch out):(?:\*\*)?\s*(.*)$/i;

const renderAnswer = text => {
  const html = [];
  let items = [];
  let listType = "ul";
  let listStart = 1;
  let lines = [];
  let callout = null;
  let quote = [];
  let table = [];

  const flush = () => {
    if (items.length) {
      // The printed number of the first item: "2." after an interrupting paragraph stays 2.
      const start = listType === "ol" && listStart !== 1 ? ` start="${listStart}"` : "";
      html.push(`<${listType}${start}>${items.map(i => `<li>${renderInline(i)}</li>`).join("")}</${listType}>`);
    }
    if (quote.length) html.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
    if (table.length) html.push(renderTable(table));
    const body = lines.map(renderInline).join("<br>");
    if (lines.length && callout) {
      html.push(`<div class="callout callout-${callout.kind}"><span class="callout-label">${callout.label}</span>${body}</div>`);
    } else if (lines.length) {
      html.push(`<p>${body}</p>`);
    }
    items = [];
    lines = [];
    quote = [];
    table = [];
    callout = null;
  };

  // Math is cut out first so list, bold and symbol rules never touch it, and
  // put back on one line so KaTeX finds it in a single text node.
  const math = [];
  const plain = text.replace(MATH, m => {
    math.push(m.replace(/\s*\n\s*/g, " "));
    return `\u0000${math.length - 1}\u0000`;
  });

  escapeHtml(normalizeSymbols(plain)).split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/);
    const quoted = trimmed.match(/^&gt;\s?(.*)$/);   // ">" is already escaped here

    if (!trimmed) {
      if (lines.length || quote.length || table.length) flush();
    } else if (heading) {
      flush();
      // # and ## → h3, ### → h4, deeper → h5: inside a panel h1/h2 would be too loud
      const level = Math.min(5, Math.max(3, heading[1].length + 1));
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      html.push("<hr>");
    } else if (/^\|.*\|$/.test(trimmed)) {
      if (!table.length) flush();
      table.push(trimmed);
    } else if (quoted) {
      if (!quote.length) flush();
      quote.push(quoted[1]);
    } else if (item) {
      const type = item[1] ? "ol" : "ul";
      if (lines.length || quote.length || table.length || (items.length && type !== listType)) flush();
      if (!items.length) {
        listType = type;
        listStart = item[1] ? Number(item[1]) : 1;
      }
      items.push(item[2]);
    } else if (items.length && /^\s{2,}/.test(line)) {
      items[items.length - 1] += `<br>${trimmed}`;
    } else if (CALLOUT.test(line)) {
      // "Intuition: ...", "Example: ...", "Watch out: ..." start a tutor callout.
      const [, label, rest] = line.match(CALLOUT);
      flush();
      callout = { label: label.replace(/^./, c => c.toUpperCase()), kind: label.toLowerCase().replace(" ", "-") };
      if (rest) lines.push(rest);
    } else {
      if (items.length || quote.length || table.length) flush();
      lines.push(line);
    }
  });
  flush();

  return html.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => escapeHtml(math[i]));
};

function revealField(boxId, fieldId) {
  const box = document.getElementById(boxId);
  box.hidden = !box.hidden;
  if (!box.hidden) document.getElementById(fieldId).focus();
}

// Hides an upload row and forgets the chosen file; "+ upload" opens it again.
function closeUpload(boxId) {
  const box = document.getElementById(boxId);
  box.querySelector("input[type=file]").value = "";
  box.hidden = true;
}

// A topic has at most one panel on the whole page, created under the row that
// was clicked. The same topic can sit in several blocks; one panel per row
// gave two elements the id panel-217, getElementById found the first one,
// and a saved note showed up in the other block.
async function togglePanel(topicId, blockId, from = null) {
  const row = from?.closest("[data-topic-row]");
  const existing = document.getElementById(`panel-${topicId}`);

  // A click on the row whose panel is open closes it.
  if (existing && (!row || existing.previousElementSibling === row)) {
    closePanel(topicId);
    return;
  }
  if (!row) return;

  openPanelAfter(row, topicId);
  await renderPanel(topicId, blockId);
}

// Puts an empty panel for the topic right after the given element, closing it elsewhere.
function openPanelAfter(anchor, topicId) {
  document.getElementById(`panel-${topicId}`)?.remove();
  forgetHighlights(topicId);
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = `panel-${topicId}`;
  panel.style.display = "none";
  anchor.insertAdjacentElement("afterend", panel);
}

function closePanel(topicId) {
  document.getElementById(`panel-${topicId}`)?.remove();
  forgetHighlights(topicId);
  paintUnclear();
  forgetOpenPanel(topicId);
}

// Closes every open topic panel and question list of Focus; the blocks stay unfolded.
function collapseAll() {
  hideNoteTip();
  document.querySelectorAll(".focus-questions").forEach(list => list.remove());
  document.querySelectorAll(".panel").forEach(panel => closePanel(Number(panel.id.replace("panel-", ""))));
}

// Fills the panel with fresh data and shows it. Called to open a panel, and on
// an open one to redraw it in place (reopenPanel).
async function renderPanel(topicId, blockId) {
  const panel = document.getElementById(`panel-${topicId}`);
  if (!panel) return;

  const topic = await fetch(`/topics/${topicId}`).then(r => r.json());
  panel.dataset.blockId = blockId;
  topic.unclear.forEach(u => {
    openUnclear[u.struggle_id] = { ...u, topicId, blockId, subjectId: topic.subject_id };
  });

  // Answers saved before the thread kept a "saved" mark: recognise them by their text.
  const noteTexts = new Set(topic.notes.map(n => n.text));
  const unmarked = (threads[topicId] || []).filter(t => !t.saved && noteTexts.has(t.answer.trim()));
  unmarked.forEach(t => { t.saved = true; });
  if (unmarked.length) saveThreads();

  const pageSource = {};
  topic.chunks.forEach(c => {
    pageSource[c.page] = c.source_id;
    sourceNames[c.source_id] = c.filename;
  });

  const summaryBlock = topic.summary
    ? `<div class="summary-wrap">
         <div class="summary rich" id="summary-${topicId}" data-raw="${escapeHtml(topic.summary)}">${renderWithPages(topic.summary, pageSource)}</div>
         <div class="summary-bar">
           <span>${topic.summary_origin === "manual" ? "edited by me" : "generated"}</span>
           ${iconButton("edit", "edit summary", `editSummary(${topicId}, ${blockId})`)}
           ${iconButton("regenerate", "regenerate summary", `makeSummary(${topicId}, ${blockId})`)}
         </div>
       </div>`
    : `<div class="summary-wrap">
         <div class="summary-bar">
           <button class="magic" onclick="makeSummary(${topicId}, ${blockId})">generate summary</button>
           <span id="summary-status-${topicId}"></span>
         </div>
       </div>`;

  const notes = topic.notes.length
    ? topic.notes.map(n => `
        <div class="note" id="note-item-${n.note_id}" data-raw="${escapeHtml(n.text)}">
          <div class="note-head">
            ${n.kind === "ai_answer"
              ? `<span class="note-kind assistant">assistant</span>`
              : `<span class="note-kind me">me</span>`}
            ${n.revisit ? `<span class="note-revisit">still shaky</span>` : ""}
            ${iconButton("edit", "edit note", `editNote(${n.note_id}, ${topicId}, ${blockId})`)}
            ${iconButton("delete", "delete note", `deleteNote(${n.note_id}, ${topicId}, ${blockId})`, "danger")}
          </div>
          ${n.anchor ? `<div class="note-anchor">on “${renderAnswer(n.anchor)}”</div>` : ""}
          <div class="rich" id="note-body-${n.note_id}">${renderWithPages(n.text, pageSource)}</div>
        </div>`).join("")
    : `<div class="note-empty">no notes yet</div>`;

  const unclearBlock = topic.unclear.length
    ? `<div class="unclear-list">
         <div class="unclear-head">Unclear (${topic.unclear.length})</div>
         ${topic.unclear.map(u => `
           <div class="unclear-item" id="unclear-item-${u.struggle_id}">
             <div class="unclear-quote rich">${renderAnswer(u.text)}</div>
             ${u.comment ? `<div class="unclear-comment">${escapeHtml(u.comment)}</div>` : ""}
             <div class="unclear-actions">
               <button class="ghost" onclick="askAboutUnclear(${u.struggle_id})">ask</button>
               <button class="ghost" onclick="startResolve(${u.struggle_id})">✓ got it</button>
               ${iconButton("delete", "marked by mistake", `deleteUnclear(${u.struggle_id})`, "danger")}
             </div>
           </div>`).join("")}
       </div>`
    : "";

  panel.innerHTML = `
    ${summaryBlock}
    ${unclearBlock}
    <div class="notes">${notes}</div>
    <div class="panel-actions">
      <button class="chip chip-note" title="write a note" onclick="revealField('note-${topicId}', 'draft-${topicId}')">${icon("note")}note</button>
      <button class="chip chip-ask" title="ask about this topic" onclick="revealField('ask-${topicId}', 'q-${topicId}')">${icon("ask")}ask</button>
    </div>
    <div class="reveal" id="note-${topicId}" hidden>
      <textarea id="draft-${topicId}" rows="3" placeholder="in your own words... (ctrl+enter to save, esc to cancel)"
                onkeydown="if (event.key === 'Enter' && event.ctrlKey) saveNote(${topicId}, ${blockId})"></textarea>
      <div class="edit-actions">
        <button class="primary" onclick="saveNote(${topicId}, ${blockId})">save</button>
        ${iconButton("close", "cancel (esc)", `cancelNote(${topicId})`, "cancel")}
      </div>
    </div>
    <div class="reveal" id="ask-${topicId}" ${threads[topicId]?.length || pendingQuestions[topicId] ? "" : "hidden"}>
      <div class="answer" id="answer-${topicId}">${renderThread(topicId, blockId)}</div>
      <div class="ask-row">
        <input id="q-${topicId}" placeholder="${threads[topicId]?.length ? "ask a follow-up..." : "ask about this topic..."}"
               onkeydown="if (event.key === 'Enter') askTopic(${topicId}, ${topic.subject_id}, ${blockId})">
        <button class="primary" onclick="askTopic(${topicId}, ${topic.subject_id}, ${blockId})">ask</button>
        ${iconButton("close", "cancel (esc)", `cancelAsk(${topicId})`, "cancel")}
      </div>
      <button class="ghost exam-small" id="new-thread-${topicId}" ${threads[topicId]?.length ? "" : "hidden"}
              onclick="newThread(${topicId}, ${blockId})">new thread</button>
    </div>`;

  renderMath(panel);
  panel.style.display = "block";
  rememberOpenPanel(panel, topicId, blockId);

  // After KaTeX: the quotes are found in the drawn text, formulas included.
  highlightUnclear(topicId, panel, topic.unclear);
  highlightAnnotations(topicId, blockId, panel, topic.notes);
  const badge = document.getElementById(`unclear-${topicId}`);
  if (badge) {
    badge.textContent = `?${topic.unclear.length}`;
    badge.hidden = !topic.unclear.length;
  }
}

// ---- Unclear places -------------------------------------------------------
// A marked place is stored as the quoted text. To find it again, a rendered
// block is read as text in which every KaTeX formula counts as its LaTeX
// source "\(...\)", the same way the quote was taken from the selection.

const openUnclear = {};            // struggle id → { text, comment, topicId, blockId, subjectId }
const unclearSpots = new Map();    // topic id → [{ range, unclear }] painted in its open panel

function textSegments(container) {
  const segments = [];
  let text = "";
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.nodeValue;
      segments.push({ node, start, end: text.length, atomic: false });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.classList.contains("katex")) {
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
        const start = text.length;
        text += `\\(${tex}\\)`;
        segments.push({ node, start, end: text.length, atomic: true });
      } else {
        node.childNodes.forEach(walk);
      }
    }
  };
  walk(container);
  return { text, segments };
}

// A selection edge inside a formula snaps to the whole formula.
function pointToIndex({ segments }, node, offset, isEnd) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const formula = element?.closest(".katex");
  if (formula) {
    const seg = segments.find(s => s.node === formula);
    if (seg) return isEnd ? seg.end : seg.start;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = segments.find(s => s.node === node);
    return seg ? seg.start + offset : null;
  }
  // The edge sits between child elements: the start of the text after it,
  // or the end of the last text inside.
  const child = node.childNodes[offset];
  if (child) {
    const seg = segments.find(s => child === s.node || child.contains(s.node));
    if (seg) return seg.start;
  }
  const inside = segments.filter(s => node.contains(s.node));
  return inside.length ? inside[inside.length - 1].end : null;
}

function quoteFromRange(container, range) {
  const layout = textSegments(container);
  const start = pointToIndex(layout, range.startContainer, range.startOffset, false);
  const end = pointToIndex(layout, range.endContainer, range.endOffset, true);
  if (start === null || end === null || end <= start) return null;
  return layout.text.slice(start, end).trim();
}

function rangeForQuote(container, quote) {
  const layout = textSegments(container);
  const index = layout.text.indexOf(quote);
  if (index < 0) return null;

  const end = index + quote.length;
  const first = layout.segments.find(s => s.start <= index && index < s.end);
  const last = layout.segments.find(s => s.start < end && end <= s.end);
  if (!first || !last) return null;

  const range = document.createRange();
  if (first.atomic) range.setStartBefore(first.node); else range.setStart(first.node, index - first.start);
  if (last.atomic) range.setEndAfter(last.node); else range.setEnd(last.node, end - last.start);
  return range;
}

// CSS Custom Highlight API: paints ranges without changing the HTML, so KaTeX
// markup stays intact. Browsers without it still get the list, just no underline.
// Paints both kinds of marked text: unclear places and notes on the text.
function paintUnclear() {
  if (!window.CSS?.highlights || typeof Highlight === "undefined") return;
  CSS.highlights.set("unclear", new Highlight(...[...unclearSpots.values()].flat().map(s => s.range)));
  CSS.highlights.set("annotated", new Highlight(...[...annotationSpots.values()].flat().map(s => s.range)));
}

function forgetHighlights(topicId) {
  unclearSpots.delete(topicId);
  annotationSpots.delete(topicId);
}

function highlightUnclear(topicId, panel, items) {
  const containers = [...panel.querySelectorAll(".summary, .note .rich")];
  const spots = items.map(u => {
    const range = containers.map(c => rangeForQuote(c, u.text)).find(Boolean);
    return range && { range, unclear: u };
  }).filter(Boolean);
  unclearSpots.set(topicId, spots);
  paintUnclear();
}

// ---- Notes on the text: a dotted underline, the note pops up under the mouse ----
// A painted highlight is not an element and gets no mouse events, so the page
// checks on every mouse move whether the pointer is over a noted range.

const annotationSpots = new Map();   // topic id → [{ range, note, topicId, blockId }]

function highlightAnnotations(topicId, blockId, panel, notes) {
  const containers = [...panel.querySelectorAll(".summary, .note .rich")];
  const spots = notes.filter(n => n.anchor).map(note => {
    const range = containers.map(c => rangeForQuote(c, note.anchor)).find(Boolean);
    return range && { range, note, topicId, blockId };
  }).filter(Boolean);
  annotationSpots.set(topicId, spots);
  paintUnclear();
}

// Notes are checked first: on text that is both, the note shows.
function spotAt(x, y) {
  for (const spotMap of [annotationSpots, unclearSpots]) {
    for (const spots of spotMap.values()) {
      for (const spot of spots) {
        for (const rect of spot.range.getClientRects()) {
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { spot, rect };
        }
      }
    }
  }
  return null;
}

let tipSpot = null;          // the spot shown: { note } for a note, { unclear } for an unclear place
let tipPinned = false;       // editing or confirming: the tip stays put
let tipHideTimer = null;

const spotKey = spot => spot.note ? `note-${spot.note.note_id}` : `unclear-${spot.unclear.struggle_id}`;

function showNoteTip(spot, rect) {
  const tip = document.getElementById("note-tip");
  if (!tipSpot || spotKey(tipSpot) !== spotKey(spot) || tip.hidden) {
    tipSpot = spot;
    tip.classList.toggle("unclear", !spot.note);
    if (spot.note) {
      const n = spot.note;
      tip.innerHTML = `
        <div class="rich note-tip-text">${renderAnswer(n.text)}</div>
        <div class="note-tip-actions">
          <label class="mark-revisit-inline">
            <input type="checkbox" ${n.revisit ? "checked" : ""} onchange="setNoteRevisit(this.checked)"> still shaky
          </label>
          ${iconButton("edit", "edit note", "editNoteTip()")}
          ${iconButton("delete", "delete note", "deleteNoteTip()", "danger")}
        </div>`;
    } else {
      // The same actions as in the "Unclear" list of the panel.
      const u = spot.unclear;
      tip.innerHTML = `
        <div class="note-tip-text ${u.comment ? "" : "tip-faint"}">${u.comment ? escapeHtml(u.comment) : "marked as unclear"}</div>
        <div class="note-tip-actions">
          <button class="ghost" onclick="hideNoteTip(); askAboutUnclear(${u.struggle_id})">ask</button>
          <button class="ghost" onclick="resolveFromTip(${u.struggle_id})">✓ got it</button>
          ${iconButton("delete", "marked by mistake", `tipPinned = true; deleteUnclear(${u.struggle_id}).finally(hideNoteTip)`, "danger")}
        </div>`;
    }
    renderMath(tip);
    tip.hidden = false;
  }
  // under the hovered line, kept inside the window
  tip.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - tip.offsetHeight - 8)}px`;
  tip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8))}px`;
}

function hideNoteTip() {
  document.getElementById("note-tip").hidden = true;
  tipSpot = null;
  tipPinned = false;
}

document.addEventListener("mousemove", event => {
  if (tipPinned || !(annotationSpots.size || unclearSpots.size)) return;
  const tip = document.getElementById("note-tip");
  // moving onto the tip keeps it open, so its buttons can be reached
  if (!tip.hidden && tip.contains(event.target)) {
    clearTimeout(tipHideTimer);
    return;
  }
  const hit = spotAt(event.clientX, event.clientY);
  if (hit) {
    clearTimeout(tipHideTimer);
    showNoteTip(hit.spot, hit.rect);
  } else if (!tip.hidden) {
    clearTimeout(tipHideTimer);
    tipHideTimer = setTimeout(hideNoteTip, 350);
  }
});

async function patchNote(noteId, body) {
  const response = await fetch(`/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
  }
  return response.ok;
}

// "got it" from the tip opens the same explain-it field in the panel's list.
function resolveFromTip(struggleId) {
  hideNoteTip();
  const item = document.getElementById(`unclear-item-${struggleId}`);
  if (item?.querySelector(".unclear-actions")) startResolve(struggleId);
  item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function setNoteRevisit(checked) {
  const { note, topicId, blockId } = tipSpot;
  if (await patchNote(note.note_id, { revisit: checked })) {
    hideNoteTip();
    await reopenPanel(topicId, blockId);
  }
}

function editNoteTip() {
  tipPinned = true;
  const tip = document.getElementById("note-tip");
  tip.innerHTML = `
    <textarea class="summary-edit" id="note-tip-edit" rows="4">${escapeHtml(tipSpot.note.text)}</textarea>
    <div class="edit-actions">
      <button class="primary" onclick="saveNoteTip()">save</button>
      <button class="ghost" onclick="hideNoteTip()">cancel</button>
    </div>`;
  document.getElementById("note-tip-edit").focus();
}

async function saveNoteTip() {
  const text = document.getElementById("note-tip-edit").value.trim();
  if (!text) return;
  const { note, topicId, blockId } = tipSpot;
  if (await patchNote(note.note_id, { text })) {
    hideNoteTip();
    await reopenPanel(topicId, blockId);
  }
}

async function deleteNoteTip() {
  tipPinned = true;   // the confirm dialog moves the mouse away
  const { note, topicId, blockId } = tipSpot;
  hideNoteTip();
  await deleteNote(note.note_id, topicId, blockId);
}

// ---- Marking: select text in a summary or note, a small popover appears ----

let pendingMark = null;

function hideMarkPopover() {
  document.getElementById("mark-popover").hidden = true;
  pendingMark = null;
}

document.addEventListener("mouseup", event => {
  const popover = document.getElementById("mark-popover");
  if (popover.contains(event.target)) return;

  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) return hideMarkPopover();

  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const element = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
  const container = element?.closest(".summary, .note .rich");
  const panel = container?.closest(".panel");
  if (!panel) return hideMarkPopover();

  const quote = quoteFromRange(container, range);
  if (!quote || quote.length < 2) return hideMarkPopover();

  pendingMark = {
    topicId: Number(panel.id.replace("panel-", "")),
    blockId: Number(panel.dataset.blockId),
    quote,
  };

  // position: fixed, so viewport coordinates from the selection can be used as they are
  const rect = range.getBoundingClientRect();
  popover.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 140)}px`;
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
  document.getElementById("mark-comment").value = "";
  document.getElementById("mark-revisit").checked = false;
  setMarkMode("unclear");
  popover.hidden = false;
});

function setMarkMode(mode) {
  const popover = document.getElementById("mark-popover");
  popover.dataset.mode = mode;
  const note = mode === "note";
  document.getElementById("mark-comment").placeholder = note ? "your note on this spot" : "what exactly? (optional)";
  document.getElementById("mark-save").textContent = note ? "save note" : "mark";
  if (note) document.getElementById("mark-comment").focus();
}

// Esc in an edit field does what its cancel button does; every edit field
// shares its parent with its row of buttons.
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const cancel = event.target.matches?.("textarea, input")
    && event.target.parentElement.querySelector(
      ":scope > .edit-actions :is(button.ghost, .cancel), :scope > :is(button.ghost, .cancel)");
  if (cancel) cancel.click();
  else hideMarkPopover();
});

async function saveMark() {
  if (!pendingMark) return;
  const { topicId, blockId, quote } = pendingMark;
  const comment = document.getElementById("mark-comment").value.trim();
  const asNote = document.getElementById("mark-popover").dataset.mode === "note";
  if (asNote && !comment) {
    document.getElementById("mark-comment").focus();
    return;
  }

  // A note goes to the notes with the quote as its anchor; "don't get it" to the unclear places.
  const response = asNote
    ? await fetch(`/topics/${topicId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: comment, kind: "own_explanation", anchor: quote,
          revisit: document.getElementById("mark-revisit").checked,
        }),
      })
    : await fetch(`/topics/${topicId}/struggles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quote, comment: comment || null }),
      });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }

  hideMarkPopover();
  window.getSelection().removeAllRanges();
  await reopenPanel(topicId, blockId);
}

// ---- Actions in the "Unclear" list ----

function askAboutUnclear(struggleId) {
  const u = openUnclear[struggleId];
  const box = document.getElementById(`ask-${u.topicId}`);
  box.hidden = false;
  document.getElementById(`q-${u.topicId}`).value =
    `Explain in simple words: "${u.text}"` + (u.comment ? ` — ${u.comment}` : "");
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  askTopic(u.topicId, u.subjectId, u.blockId);
}

function startResolve(struggleId) {
  const u = openUnclear[struggleId];
  document.querySelector(`#unclear-item-${struggleId} .unclear-actions`).outerHTML = `
    <div class="unclear-resolve">
      <textarea id="resolve-${struggleId}" rows="2"
                placeholder="explain it in your own words — it stays as a note on this spot (optional)"></textarea>
      <label class="mark-revisit-inline"><input type="checkbox" id="resolve-revisit-${struggleId}"> still shaky</label>
      <div class="edit-actions">
        <button class="primary" onclick="resolveUnclear(${struggleId})">done</button>
        <button class="ghost" onclick="reopenPanel(${u.topicId}, ${u.blockId})">cancel</button>
      </div>
    </div>`;
  document.getElementById(`resolve-${struggleId}`).focus();
}

async function resolveUnclear(struggleId) {
  const u = openUnclear[struggleId];
  const explanation = document.getElementById(`resolve-${struggleId}`).value.trim();

  const response = await fetch(`/struggles/${struggleId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      explanation: explanation || null,
      revisit: document.getElementById(`resolve-revisit-${struggleId}`).checked,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }
  await reopenPanel(u.topicId, u.blockId);
}

async function deleteUnclear(struggleId) {
  const u = openUnclear[struggleId];
  if (!await askConfirm("Remove this mark?\n\nIf you've understood it, use “✓ got it” instead.", { ok: "remove", danger: true })) return;
  await fetch(`/struggles/${struggleId}`, { method: "DELETE" });
  await reopenPanel(u.topicId, u.blockId);
}

async function saveNote(topicId, blockId) {
  const draft = document.getElementById(`draft-${topicId}`);
  const text = draft.value.trim();
  if (!text) return;

  const response = await fetch(`/topics/${topicId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, kind: "own_explanation" }),
  }).catch(() => null);
  // On a failure the draft stays in the field, so nothing typed is lost.
  if (!response?.ok) {
    const error = response ? await response.json().catch(() => ({})) : {};
    showAlert(`failed: ${error.detail ?? (response ? response.status : "the server is not reachable")}`);
    return;
  }

  draft.value = "";
  await reopenPanel(topicId, blockId);
}

// Hides the ask box; the thread stays and shows again on "ask".
function cancelAsk(topicId) {
  document.getElementById(`q-${topicId}`).value = "";
  document.getElementById(`ask-${topicId}`).hidden = true;
}

function cancelNote(topicId) {
  document.getElementById(`draft-${topicId}`).value = "";
  document.getElementById(`note-${topicId}`).hidden = true;
}

// ---- Ask: a conversation per topic, like a chat thread ----
// Each follow-up is sent with the earlier turns, so the assistant builds on
// them. Threads are kept in localStorage and survive a page reload.

const THREADS_KEY = "study-assistant:threads";
const MAX_SAVED_TURNS = 8;
const threads = loadState(THREADS_KEY, {});   // topic id → [{ question, answer, pages, truncated }]
const pendingQuestions = {};                  // topic id → question waiting for its answer

function saveThreads() {
  saveState(THREADS_KEY, threads);
}

function renderThread(topicId, blockId) {
  const turns = (threads[topicId] || []).map((t, i) => `
    <div class="turn">
      <div class="turn-q">${escapeHtml(t.question)}</div>
      <div class="answer-text rich" id="answer-text-${topicId}-${i}">${renderWithPages(t.answer, t.pages || {})}</div>
      <div class="answer-meta">
        ${t.truncated ? `<span class="progress failed">the answer was cut off · </span>` : ""}pages ${Object.keys(t.pages || {}).join(", ")}
      </div>
      <div class="edit-actions">
        ${t.saved
          // Saved once: no buttons, so the same answer is not saved twice.
          ? `<span class="answer-saved">✓ saved as note</span>`
          : `<button class="exam-small" onclick="editAnswer(${topicId}, ${blockId}, ${i}, this)">edit</button>
             <button class="exam-small" onclick="saveAnswer(${topicId}, ${blockId}, ${i}, this)">save as note</button>`}
        ${iconButton("delete", "remove this question and answer from the thread", `removeTurn(${topicId}, ${blockId}, ${i})`, "danger")}
      </div>
    </div>`).join("");

  const pending = pendingQuestions[topicId];
  const waiting = pending
    ? `<div class="turn"><div class="turn-q">${escapeHtml(pending)}</div><div class="answer-meta">thinking...</div></div>`
    : "";
  return turns + waiting;
}

function showThread(topicId, blockId) {
  const target = document.getElementById(`answer-${topicId}`);
  if (!target) return;
  target.innerHTML = renderThread(topicId, blockId);
  renderMath(target);
  const reset = document.getElementById(`new-thread-${topicId}`);
  if (reset) reset.hidden = !(threads[topicId] || []).length;
}

// Only the browser's copy of the conversation; a note saved from it stays.
function removeTurn(topicId, blockId, index) {
  threads[topicId].splice(index, 1);
  if (!threads[topicId].length) delete threads[topicId];
  saveThreads();
  showThread(topicId, blockId);
}

function newThread(topicId, blockId) {
  delete threads[topicId];
  saveThreads();
  showThread(topicId, blockId);
}

async function askTopic(topicId, subjectId, blockId) {
  const input = document.getElementById(`q-${topicId}`);
  const question = input.value.trim();
  if (!question || pendingQuestions[topicId]) return;

  const history = (threads[topicId] || []).map(t => ({ question: t.question, answer: t.answer }));
  pendingQuestions[topicId] = question;
  input.value = "";
  showThread(topicId, blockId);

  let response;
  try {
    response = await fetch(`/subjects/${subjectId}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, limit: 5, history }),
    });
  } catch {
    response = null;
  }
  delete pendingQuestions[topicId];

  if (!response || !response.ok) {
    // A crash answers with plain text, not JSON; without the catch the page
    // would stay on "thinking..." forever.
    const error = response ? await response.json().catch(() => ({})) : {};
    const detail = !response ? "the server is not reachable"
      : typeof error.detail === "string" ? error.detail : `server error ${response.status}`;
    showThread(topicId, blockId);
    document.getElementById(`answer-${topicId}`)
      ?.insertAdjacentHTML("beforeend", `<div class="answer-meta progress failed">failed: ${escapeHtml(detail)}</div>`);
    const field = document.getElementById(`q-${topicId}`);
    if (field) field.value = question;   // give the question back to try again
    return;
  }

  const data = await response.json();
  const pages = {};
  data.sources.forEach(s => { pages[s.page] = pages[s.page] ?? s.source_id; sourceNames[s.source_id] = s.filename; });

  threads[topicId] = [...(threads[topicId] || []), { question, answer: data.answer, pages, truncated: data.truncated }]
    .slice(-MAX_SAVED_TURNS);
  saveThreads();
  showThread(topicId, blockId);
}

// The edit is a draft until it is saved as a note; cancel redraws the thread and drops it.
function editAnswer(topicId, blockId, index, button) {
  const turn = threads[topicId][index];
  document.getElementById(`answer-text-${topicId}-${index}`).outerHTML =
    `<textarea class="summary-edit" id="answer-edit-${topicId}-${index}" rows="10"
               onkeydown="if (event.key === 'Escape') { event.stopPropagation(); showThread(${topicId}, ${blockId}); }">${escapeHtml(turn.answer)}</textarea>`;
  button.outerHTML = `<button class="exam-small" onclick="showThread(${topicId}, ${blockId})">cancel</button>`;
  document.getElementById(`answer-edit-${topicId}-${index}`).focus();
}

async function saveAnswer(topicId, blockId, index, button) {
  const turn = threads[topicId][index];
  const edited = document.getElementById(`answer-edit-${topicId}-${index}`);
  const text = edited ? edited.value.trim() : turn.answer;
  if (!text || turn.saved) return;

  // Disabled right away, so a second click while the request runs saves nothing.
  if (button) {
    button.disabled = true;
    button.textContent = "saving...";
  }

  const response = await fetch(`/topics/${topicId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, kind: "ai_answer" }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    if (button) {
      button.disabled = false;
      button.textContent = "save as note";
    }
    return;
  }

  turn.saved = true;
  saveThreads();
  await reopenPanel(topicId, blockId);
}

// Redraws an open panel in place. It used to close and reopen it, and while
// it was closed the page got shorter and the browser jumped up.
async function reopenPanel(topicId, blockId) {
  const main = document.querySelector(".main");
  const scroll = main.scrollTop;
  await renderPanel(topicId, blockId);
  main.scrollTop = scroll;
}

async function deleteNote(noteId, topicId, blockId) {
  if (!await askConfirm("Delete this note?", { ok: "delete", danger: true })) return;

  const response = await fetch(`/notes/${noteId}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  await reopenPanel(topicId, blockId);
}

function editNote(noteId, topicId, blockId) {
  const raw = document.getElementById(`note-item-${noteId}`).dataset.raw;
  document.getElementById(`note-body-${noteId}`).outerHTML = `
    <textarea class="summary-edit" id="note-edit-${noteId}" rows="8">${escapeHtml(raw)}</textarea>
    <div class="edit-actions">
      <button class="primary" onclick="saveNoteEdit(${noteId}, ${topicId}, ${blockId})">save</button>
      <button class="ghost" onclick="reopenPanel(${topicId}, ${blockId})">cancel</button>
    </div>`;
}

async function saveNoteEdit(noteId, topicId, blockId) {
  const text = document.getElementById(`note-edit-${noteId}`).value.trim();
  if (!text) return;

  const response = await fetch(`/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }

  await reopenPanel(topicId, blockId);
}

// Kept from the last /subjects call, so the exam line can read the selected subject.
let subjectList = [];

// ---- Semesters: the subjects page shows one semester; the newest is the default ----

let semesterList = [];
const SEMESTER_KEY = "study-assistant:semester";

function currentSemesterId() {
  const saved = Number(loadState(SEMESTER_KEY, null));
  return semesterList.some(s => s.id === saved) ? saved : semesterList.at(-1)?.id ?? null;
}

function selectSemester(semesterId) {
  saveState(SEMESTER_KEY, Number(semesterId));
}

async function loadSubjects() {
  [subjectList, semesterList] = await Promise.all([
    fetch("/subjects").then(r => r.json()),
    fetch("/semesters").then(r => r.json()),
  ]);

  const semesterSelect = document.getElementById("semester");
  semesterSelect.innerHTML = semesterList
    .map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  semesterSelect.onchange = () => {
    selectSemester(semesterSelect.value);
    showHome();
  };

  document.getElementById("subject").onchange = event => openSubject(event.target.value);
  route();
}

// The subject picker lists the subjects of the open subject's semester.
function fillSubjectPicker(semesterId) {
  document.getElementById("subject").innerHTML = subjectList
    .filter(s => s.semester_id === semesterId)
    .map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

// ---- Pages: the subjects list (#) and one subject (#subject-5) ----
// The address says which page is open, so a reload stays on it and the
// browser's back button goes from a subject to the list.

function openSubject(subjectId) {
  location.hash = `subject-${subjectId}`;   // hashchange calls route()
}

window.addEventListener("hashchange", route);

function route() {
  const id = location.hash.match(/^#subject-(\d+)$/)?.[1];
  const subject = subjectList.find(s => String(s.id) === id);
  document.getElementById("home").hidden = Boolean(subject);
  document.getElementById("subject-page").hidden = !subject;
  if (subject) showSubject(subject.id);
  else showHome();
}

function showSubject(subjectId) {
  const subject = subjectList.find(s => s.id === subjectId);
  // Back on the subjects page, the semester of this subject is the one shown.
  selectSemester(subject.semester_id);
  fillSubjectPicker(subject.semester_id);
  document.getElementById("subject").value = subjectId;
  renderExam();
  // restoreScroll only acts on the first load: blocks and panels are open by then.
  loadView(subjectId).then(restoreScroll);
}

// Upcoming exams first, the nearest on top; then subjects without a date; past exams last.
async function showHome() {
  // A scroll position kept from a subject means nothing here.
  scrollRestored = true;
  document.querySelector(".main").scrollTop = 0;
  // Fresh counts: topics marked known inside a subject change the progress.
  subjectList = await fetch("/subjects").then(r => r.json());

  const semesterId = currentSemesterId();
  document.getElementById("semester").value = semesterId ?? "";
  document.getElementById("add-subject").hidden = semesterId === null;
  if (semesterId === null) {
    document.getElementById("subject-cards").innerHTML =
      `<p class="empty">no semesters yet — create one with + semester</p>`;
    return;
  }

  const order = s => {
    const info = examInfo(s);
    return info.days === null ? [1, 0] : info.days >= 0 ? [0, info.days] : [2, -info.days];
  };
  const sorted = subjectList.filter(s => s.semester_id === semesterId).sort((a, b) => {
    const [ga, da] = order(a), [gb, db] = order(b);
    return ga - gb || da - db;
  });

  document.getElementById("subject-cards").innerHTML = sorted.map(s => {
    const info = examInfo(s);
    const days = info.days === null ? `<span class="exam-none">no exam date</span>`
      : info.days > 0 ? `<span class="exam-${info.level}"><b>${info.days}</b>${info.days === 1 ? "day" : "days"}</span>`
      : info.days === 0 ? `<span class="exam-today"><b>today</b></span>`
      : `<span class="exam-past">done</span>`;
    const pct = n => (s.topics ? (n / s.topics) * 100 : 0);
    return `
      <button class="subject-card" onclick="openSubject(${s.id})">
        <span class="card-main">
          <span class="card-name">${escapeHtml(s.name)}</span>
          <span class="card-sub">${info.label ? `exam ${info.label} · ` : ""}${s.topics ? `${s.known}/${s.topics} topics known` : "no materials yet"}${s.review ? ` · ${s.review} to review` : ""}</span>
          <span class="card-bar"><span class="seg-known" style="width: ${pct(s.known)}%"></span><span class="seg-review" style="width: ${pct(s.review)}%"></span></span>
        </span>
        <span class="card-days">${days}</span>
      </button>`;
  }).join("") || `<p class="empty">no subjects yet — create one with + subject</p>`;
}

function toggleMenu(event, menuId) {
  // Without this the click would reach the document listener below and close the menu again.
  event.stopPropagation();
  const menu = document.getElementById(menuId);
  menu.hidden = !menu.hidden;
}

// Any click elsewhere on the page closes the menus.
document.addEventListener("click", () => {
  document.querySelectorAll(".menu").forEach(menu => { menu.hidden = true; });
});

async function addSemester() {
  const name = await askText("New semester, e.g. Semester 4", "", "create");
  if (!name || !name.trim()) return;

  const response = await fetch("/semesters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  selectSemester((await response.json()).id);
  history.replaceState(null, "", location.pathname);
  await loadSubjects();
}

async function renameSemester() {
  const semester = semesterList.find(s => s.id === currentSemesterId());
  if (!semester) return;

  const name = await askText("Rename semester", semester.name);
  if (!name || !name.trim() || name.trim() === semester.name) return;

  const response = await fetch(`/semesters/${semester.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  await loadSubjects();
}

async function openDeleteSemester() {
  const semesterId = currentSemesterId();
  if (semesterId === null) return;
  const impact = await fetch(`/semesters/${semesterId}/delete-preview`).then(r => r.json());
  openDeleteDialog("semester", impact.name,
    `${count(impact.subjects, "subject")} · ${count(impact.files, "file")} · ` +
    `${count(impact.topics, "topic")} · ${count(impact.notes, "note")}`,
    async () => {
      const response = await fetch(`/semesters/${semesterId}`, { method: "DELETE" });
      if (!response.ok) return response;
      history.replaceState(null, "", location.pathname);
      await loadSubjects();
      return response;
    });
}

async function moveSubject() {
  const subject = currentSubject();
  if (!subject) return;
  const others = semesterList.filter(s => s.id !== subject.semester_id);
  if (!others.length) {
    showAlert("There is no other semester yet\n\nCreate one with + semester on the subjects page.");
    return;
  }

  const target = await openAppDialog({
    title: `Move “${subject.name}” to`,
    choices: others.map(s => ({ value: s.id, label: s.name })),
    ok: "move",
  });
  if (!target) return;

  const response = await fetch(`/subjects/${subject.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ semester_id: Number(target) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  await loadSubjects();
}

async function renameSubject() {
  const subject = currentSubject();
  if (!subject) return;

  const name = await askText("Rename subject", subject.name);
  if (!name || !name.trim() || name.trim() === subject.name) return;

  const response = await fetch(`/subjects/${subject.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }
  await loadSubjects();
}

async function openDeleteSubject() {
  const subject = currentSubject();
  if (!subject) return;

  const impact = await fetch(`/subjects/${subject.id}/delete-preview`).then(r => r.json());
  openDeleteDialog("subject", impact.name,
    `${count(impact.blocks, "block")} · ${count(impact.files, "file")} · ` +
    `${count(impact.topics, "topic")} · ${count(impact.notes, "note")}`,
    async () => {
      const response = await fetch(`/subjects/${subject.id}`, { method: "DELETE" });
      if (!response.ok) return response;
      // The deleted subject's page is gone: back to the list, without a history entry to it.
      history.replaceState(null, "", location.pathname);
      await loadSubjects();
      return response;
    });
}

// The delete dialog for a subject or a semester. remove() does the deleting and
// returns the response; the dialog shows its error or closes.
function openDeleteDialog(kind, name, counts, remove) {
  const dialog = document.getElementById("delete-subject");
  dialog.querySelectorAll(".ds-kind").forEach(el => { el.textContent = kind; });
  document.getElementById("ds-name").textContent = name;
  document.getElementById("ds-counts").textContent = counts;

  // The delete button only unlocks once the typed name matches exactly.
  const input = document.getElementById("ds-input");
  const confirmButton = document.getElementById("ds-confirm");
  input.value = "";
  confirmButton.disabled = true;
  input.oninput = () => {
    confirmButton.disabled = input.value.trim() !== name;
  };
  confirmButton.onclick = async () => {
    confirmButton.disabled = true;
    const response = await remove();
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showAlert(`failed: ${error.detail ?? response.status}`);
      confirmButton.disabled = false;
      return;
    }
    dialog.close();
  };

  dialog.showModal();
  input.focus();
}

function currentSubject() {
  const id = document.getElementById("subject").value;
  return subjectList.find(s => String(s.id) === id);
}

// "2027-01-28" as a local date. new Date("2027-01-28") would mean midnight in UTC,
// which in Germany shifts the day count by one in the first hours of a day.
function parseDay(text) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(day) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // round, not floor: a day around a clock change is 23 or 25 hours long
  return Math.round((day - today) / 86400000);
}

// Days to the exam, its date as text and how urgent it is (the colour class);
// days is null when the subject has no exam date.
function examInfo(subject) {
  if (!subject.exam_date) return { days: null, label: "", level: "none" };
  const day = parseDay(subject.exam_date);
  const days = daysUntil(day);
  const label = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const level = days < 0 ? "past" : days === 0 ? "today" : days <= 7 ? "soon" : days <= 30 ? "month" : "far";
  return { days, label, level };
}

function renderExam() {
  const box = document.getElementById("exam");
  const subject = currentSubject();
  if (!subject) {
    box.innerHTML = "";
    return;
  }
  if (!subject.exam_date) {
    box.innerHTML = `<button class="exam-line exam-none" onclick="editExam()">+ exam date</button>`;
    return;
  }

  const { days, label, level } = examInfo(subject);
  const text = days > 0 ? `Exam · ${label} · in ${days} ${days === 1 ? "day" : "days"}`
    : days === 0 ? "Exam today"
    : `Exam was on ${label}`;

  box.innerHTML = `<button class="exam-line exam-${level}" title="change exam date" onclick="editExam()">◷ ${text}</button>`;
}

function editExam() {
  const subject = currentSubject();
  document.getElementById("exam").innerHTML = `
    <span class="exam-edit">
      ◷ <input type="date" id="exam-input" value="${subject.exam_date || ""}">
      <button class="primary" onclick="saveExam()">save</button>
      <button class="ghost" onclick="renderExam()">cancel</button>
      ${subject.exam_date ? `<button class="ghost" onclick="saveExam(null)">remove date</button>` : ""}
    </span>`;
  document.getElementById("exam-input").focus();
}

// saveExam() takes the date from the field; saveExam(null) removes it.
async function saveExam(value) {
  const subject = currentSubject();
  const examDate = value === null ? null : document.getElementById("exam-input").value || null;

  const response = await fetch(`/subjects/${subject.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exam_date: examDate }),
  });

  if (!response.ok) {
    const error = await response.json();
    // FastAPI sends a list of problems for an invalid value, a plain string otherwise
    showAlert(`failed: ${typeof error.detail === "string" ? error.detail : "invalid date"}`);
    return;
  }

  const updated = await response.json();
  subject.exam_date = updated.exam_date;
  renderExam();
}


// ---- Views: Blocks (by week) and Focus (what to study next) ----
// Only the active view is drawn. Both use the same topic panels with ids like
// panel-38, and two copies on the page would make those ids ambiguous.

const VIEW_KEY = "study-assistant:view";
// Each view has a tab tab-<view>, a container with id <view> and a loader.
const VIEWS = {
  blocks: subjectId => loadBlocks(subjectId),
  focus: subjectId => loadFocus(subjectId),
  exams: subjectId => loadExams(subjectId),
  homework: subjectId => loadHomework(subjectId),
};
let currentView = (() => {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved in VIEWS ? saved : "blocks";
  } catch { return "blocks"; }
})();

function setView(view) {
  currentView = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  const subjectId = document.getElementById("subject").value;
  if (subjectId) loadView(subjectId);
}

function loadView(subjectId) {
  for (const view of Object.keys(VIEWS)) {
    const active = view === currentView;
    document.getElementById(`tab-${view}`).classList.toggle("active", active);
    const container = document.getElementById(view);
    container.hidden = !active;
    if (!active) container.innerHTML = "";
  }

  // The panels of the view being left disappear, so do their highlights.
  unclearSpots.clear();
  annotationSpots.clear();
  paintUnclear();

  return VIEWS[currentView](subjectId);
}

// Why a topic is high in Focus: one small label per signal that counts. Each
// opens what is behind it: exam questions and homework tasks unfold under the
// row; review, unclear places and shaky notes live in the topic's panel.
function focusReasons(t, blockId) {
  const questions = (kind, cls, label) =>
    `<button class="why ${cls}" title="show them" onclick="toggleTopicQuestions(${t.id}, '${kind}', this)">${label}</button>`;
  const panel = (cls, label) =>
    `<button class="why ${cls}" title="open the topic" onclick="togglePanel(${t.id}, ${blockId}, this)">${label}</button>`;
  return [
    t.finals ? questions("final", "why-exam", `★ ${t.finals} final`) : "",
    t.tests ? questions("short", "why-exam", `☆ ${count(t.tests, "test")}`) : "",
    t.unclear ? panel("why-unclear", `?${t.unclear} unclear`) : "",
    t.status === "review" ? panel("why-review", "review") : "",
    t.homework ? questions("homework", "why-technique", `✎ ${t.homework} homework`) : "",
    t.revisit ? panel("why-revisit", `${t.revisit} still shaky`) : "",
  ].join("");
}

const QUESTION_LABELS = { final: "★ final", short: "☆ test", homework: "✎ homework" };

// The questions or tasks of one kind linked to a topic, as analyse wrote them,
// under its row. Another chip swaps them; the same chip again closes them.
async function toggleTopicQuestions(topicId, kind, chip) {
  const row = chip.closest("[data-topic-row]");
  const existing = document.getElementById(`fq-${topicId}`);
  existing?.remove();
  if (existing?.dataset.kind === kind) return;

  const questions = (await fetch(`/topics/${topicId}/questions`).then(r => r.json()))
    .filter(q => q.kind === kind);
  const slot = document.createElement("div");
  slot.className = "focus-questions";
  slot.id = `fq-${topicId}`;
  slot.dataset.kind = kind;
  slot.innerHTML = questions.map(questionCard).join("") || `<p class="empty">nothing linked any more</p>`;

  // After the topic's panel when it is open, so a click on the title still closes the panel.
  const panel = document.getElementById(`panel-${topicId}`);
  (panel?.previousElementSibling === row ? panel : row).insertAdjacentElement("afterend", slot);
  renderMath(slot);
}

// One exam question or homework task as analyse wrote it: { kind, source_id,
// filename, number, page, text }. The PDF page is only a small button aside.
function questionCard(q) {
  sourceNames[q.source_id] = q.filename;
  return `
    <div class="fq">
      <div class="fq-head">
        <span class="why ${q.kind === "homework" ? "why-technique" : "why-exam"}">${QUESTION_LABELS[q.kind]}</span>
        <span>${escapeHtml(fileTitle(q.filename))} · ${q.kind === "homework" ? "T" : "Q"}${escapeHtml(q.number ?? "?")}</span>
        ${q.page ? `<button class="icon-btn" title="the original page in the PDF" onclick="openPdf(${q.source_id}, ${q.page})">⎙</button>` : ""}
      </div>
      <div class="rich fq-text">${renderAnswer(q.text)}</div>
    </div>`;
}

// Blocks folded in Focus; they all start unfolded and a fold is remembered.
const FOLDED_FOCUS_KEY = "study-assistant:folded-focus";
const foldedFocus = new Set(loadState(FOLDED_FOCUS_KEY, []));

async function loadFocus(subjectId) {
  const blocks = await fetch(`/subjects/${subjectId}/focus`).then(r => r.json());
  const target = document.getElementById("focus");

  if (!blocks.length) {
    target.innerHTML = `<p class="empty">no topics yet — upload a lecture in Blocks</p>`;
    return;
  }

  // The same row parts and panel as in Blocks, so clicking a title opens the usual panel.
  const row = (t, blockId, rank) => `
    <div class="focus-row" data-topic-row="${t.id}">
      <span class="focus-rank">${rank ?? ""}</span>
      <span class="dot dot-${t.status}" title="${t.status}" onclick="cycleStatus(${t.id}, '${t.status}', ${blockId})"></span>
      <span class="topic-title" id="title-${t.id}" onclick="togglePanel(${t.id}, ${blockId}, this)">${escapeHtml(t.title)}</span>
      <span class="focus-why" title="priority ${t.priority}">${focusReasons(t, blockId)}</span>
    </div>`;

  target.innerHTML = blocks.map(b => {
    const folded = foldedFocus.has(b.block_id);
    return `
    <section class="focus-block">
      <div class="focus-head" onclick="toggleFocusBlock(${b.block_id})">
        <span class="block-name"><span class="arrow" id="focus-arrow-${b.block_id}">${folded ? "▸" : "▾"}</span>${escapeHtml(b.name)}</span>
        <span class="block-meta">${count(b.study.length + b.known.length, "topic")} · ${b.known.length} known</span>
      </div>
      <div id="focus-body-${b.block_id}" ${folded ? "hidden" : ""}>
        ${b.study.map((t, i) => row(t, b.block_id, i + 1)).join("")
          || `<p class="empty focus-done">everything here is known ✓</p>`}
        ${b.known.length ? `
          <button class="ghost focus-known-toggle" onclick="toggleKnown(this)">known (${b.known.length}) ▸</button>
          <div class="focus-known" hidden>${b.known.map(t => row(t, b.block_id, null)).join("")}</div>` : ""}
      </div>
    </section>`;
  }).join("");
}

function toggleFocusBlock(blockId) {
  const body = document.getElementById(`focus-body-${blockId}`);
  body.hidden = !body.hidden;
  document.getElementById(`focus-arrow-${blockId}`).textContent = body.hidden ? "▸" : "▾";
  if (body.hidden) foldedFocus.add(blockId);
  else foldedFocus.delete(blockId);
  saveState(FOLDED_FOCUS_KEY, [...foldedFocus]);
}

function toggleKnown(button) {
  const list = button.nextElementSibling;
  list.hidden = !list.hidden;
  button.textContent = button.textContent.replace(/[▸▾]/, list.hidden ? "▸" : "▾");
}

// ---- Exams view: final exam and short tests, each analysed into questions ----

const EXAM_SECTIONS = [
  { kind: "final", title: "Final exam", icon: "★", empty: "no final exam yet" },
  { kind: "short", title: "Short tests", icon: "☆", empty: "no short tests yet" },
];

const openExams = new Set();     // source ids whose question list is unfolded
const examPollers = new Set();   // job ids already being watched
let examTopicOptions = "";       // <optgroup>s for the "+ link topic" picker

const fileTitle = filename => filename.replace(/\.pdf$/i, "");

// Every upload takes a PDF or photos; several photos become one PDF, in the order picked.
const UPLOAD_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const UPLOAD_HINT = "a PDF, or photos (PNG, JPEG) — several photos become one file";
// Blocks also keep code and Markdown, shown as they are (the server's TEXT_EXTENSIONS).
const CODE_ACCEPT = ".py,.java,.kt,.scala,.c,.h,.cpp,.hpp,.cc,.cs,.go,.rs,.js,.ts,.rb,.php,.swift," +
  ".hs,.ml,.r,.m,.jl,.sql,.sh,.md,.txt,.tex,.json,.yaml,.yml,.csv";
// "Chapter 8: Multivariate calculus" → "Chapter 8"
const shortBlockName = name => (name || "").split(":")[0];

// Only the name shown in the app; ".pdf" is added back by the server.
async function renameSource(sourceId) {
  const current = fileTitle(sourceNames[sourceId] || "");
  const name = await askText("Rename file", current);
  if (!name || !name.trim() || name.trim() === current) return;

  const response = await fetch(`/sources/${sourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: name.trim() }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  await refresh(null);
}

async function loadExams(subjectId) {
  const [exams, focus] = await Promise.all([
    fetch(`/subjects/${subjectId}/exams`).then(r => r.json()),
    fetch(`/subjects/${subjectId}/focus`).then(r => r.json()),
  ]);

  examTopicOptions = topicOptions(focus);

  const target = document.getElementById("exams");
  target.innerHTML = EXAM_SECTIONS.map(s => renderExamSection(s, exams.filter(e => e.kind === s.kind))).join("")
    + renderMostAsked(exams);
  renderMath(target);

  // An analysis started before a reload keeps being watched.
  exams.filter(e => e.analysis?.status === "running").forEach(e => watchExamJob(e.analysis.job_id, e.source_id));
}

// ---- Foldable sections of Exams and Homework; a fold is remembered ----

const FOLDED_SECTIONS_KEY = "study-assistant:folded-sections";
const foldedSections = new Set(loadState(FOLDED_SECTIONS_KEY, []));

// The actions sit in the head; using one ("+ upload") unfolds the section, since what it shows is inside.
function foldableSection(key, title, actions, body) {
  const folded = foldedSections.has(key);
  return `
    <section class="exam-section">
      <div class="exam-section-head foldable" onclick="toggleSection('${key}')">
        <span class="exam-section-title"><span class="arrow" id="sec-arrow-${key}">${folded ? "▸" : "▾"}</span>${title}</span>
        <span onclick="event.stopPropagation(); if (foldedSections.has('${key}')) toggleSection('${key}')">${actions}</span>
      </div>
      <div id="sec-body-${key}" ${folded ? "hidden" : ""}>${body}</div>
    </section>`;
}

function toggleSection(key) {
  const body = document.getElementById(`sec-body-${key}`);
  body.hidden = !body.hidden;
  document.getElementById(`sec-arrow-${key}`).textContent = body.hidden ? "▸" : "▾";
  if (body.hidden) foldedSections.add(key);
  else foldedSections.delete(key);
  saveState(FOLDED_SECTIONS_KEY, [...foldedSections]);
}

// Focus already lists every topic grouped by block, which is what the "+ link topic" picker needs.
const topicOptions = focus => focus.map(b => `
  <optgroup label="${escapeHtml(b.name)}">
    ${[...b.study, ...b.known].map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("")}
  </optgroup>`).join("");

// ---- Homework view: homework belongs to blocks, so it is listed block by block ----
// Files are uploaded here or in the block itself; analyse and topic links work as for exams.

async function loadHomework(subjectId) {
  const [blocks, focus] = await Promise.all([
    fetch(`/subjects/${subjectId}/homework`).then(r => r.json()),
    fetch(`/subjects/${subjectId}/focus`).then(r => r.json()),
  ]);
  examTopicOptions = topicOptions(focus);

  const target = document.getElementById("homework");
  if (!blocks.length) {
    target.innerHTML = `<p class="empty">no blocks yet — homework goes into a block</p>`;
    return;
  }

  target.innerHTML = blocks.map(b => foldableSection(
    `hw-${b.block_id}`,
    `✎ ${escapeHtml(b.name)}`,
    `<button class="ghost" onclick="revealField('hw-upload-${b.block_id}', 'hw-file-${b.block_id}')">+ upload</button>`,
    `<div class="upload" id="hw-upload-${b.block_id}" hidden>
       <input type="file" id="hw-file-${b.block_id}" accept="${UPLOAD_ACCEPT}" multiple title="${UPLOAD_HINT}">
       <button onclick="uploadHomework(${b.block_id})">upload</button>
       ${iconButton("close", "close (esc)", `closeUpload('hw-upload-${b.block_id}')`, "cancel")}
       <span class="progress" id="hw-progress-${b.block_id}"></span>
     </div>
     ${b.files.map(f => renderExamFile(f, "✎")).join("") || `<p class="empty exam-empty">no homework yet</p>`}`,
  )).join("");
  renderMath(target);

  // An analysis started before a reload keeps being watched.
  blocks.flatMap(b => b.files).filter(f => f.analysis?.status === "running")
    .forEach(f => watchExamJob(f.analysis.job_id, f.source_id));
}

// Stored in the block like a homework uploaded there.
async function uploadHomework(blockId) {
  const input = document.getElementById(`hw-file-${blockId}`);
  const progress = document.getElementById(`hw-progress-${blockId}`);
  if (!input.files.length) {
    progress.textContent = "pick a file first";
    return;
  }

  const form = new FormData();
  [...input.files].forEach(file => form.append("file", file));
  form.append("source_type", "homework");
  progress.className = "progress";
  progress.textContent = "uploading...";

  const response = await fetch(`/blocks/${blockId}/upload`, { method: "POST", body: form });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    progress.className = "progress failed";
    progress.textContent = typeof error.detail === "string" ? error.detail : "upload failed";
    return;
  }
  await loadHomework(document.getElementById("subject").value);
}

function renderExamSection({ kind, title, icon, empty }, exams) {
  return foldableSection(
    `exam-${kind}`,
    `${icon} ${title}`,
    `<button class="ghost" onclick="revealField('exam-upload-${kind}', 'exam-file-${kind}')">+ upload</button>`,
    `<div class="upload" id="exam-upload-${kind}" hidden>
       <input type="file" id="exam-file-${kind}" accept="${UPLOAD_ACCEPT}" multiple title="${UPLOAD_HINT}">
       <button onclick="uploadExam('${kind}')">upload</button>
       ${iconButton("close", "close (esc)", `closeUpload('exam-upload-${kind}')`, "cancel")}
       <span class="progress" id="exam-progress-${kind}"></span>
     </div>
     ${exams.map(e => renderExamFile(e, icon)).join("") || `<p class="empty exam-empty">${empty}</p>`}`,
  );
}

function examStateHtml(e) {
  const a = e.analysis;
  if (a?.status === "running") {
    return `<span class="progress">analysing… ${escapeHtml(a.stage || "")}</span>`;
  }
  if (a?.status === "failed") {
    return `<span class="progress failed" title="${escapeHtml(a.message || "")}">analysis failed</span>
            <button class="ghost exam-small" onclick="analyseExam(${e.source_id})">retry</button>`;
  }
  if (a?.status === "done") {
    const open = openExams.has(e.source_id);
    return `<button class="ghost exam-small exam-count" onclick="toggleExam(${e.source_id})">✦ ${count(e.questions.length, "question")} ${open ? "▾" : "▸"}</button>
            ${iconButton("regenerate", "analyse again", `analyseExam(${e.source_id}, true)`)}`;
  }
  return `<button class="magic exam-small" onclick="analyseExam(${e.source_id})">analyse</button>`;
}

// The name unfolds the analysed questions; the PDF is the ⎙ button (and the name before analysis).
function renderExamFile(e, icon) {
  sourceNames[e.source_id] = e.filename;
  const analysed = e.analysis?.status === "done";
  return `
    <div class="exam-file">
      <span class="exam-icon">${icon}</span>
      <button class="exam-name" title="${escapeHtml(e.filename)}"
              onclick="${analysed ? `toggleExam(${e.source_id})` : `openPdf(${e.source_id}, 1)`}">${escapeHtml(fileTitle(e.filename))}</button>
      <span class="exam-state" id="exam-state-${e.source_id}">${examStateHtml(e)}</span>
      <button class="icon-btn" title="open the PDF" aria-label="open the PDF" onclick="openPdf(${e.source_id}, 1)">⎙</button>
      ${iconButton("rename", "rename", `renameSource(${e.source_id})`)}
      ${iconButton("delete", "delete file", `deleteSource(${e.source_id}, null)`, "danger")}
    </div>
    <div class="exam-questions" id="exam-q-${e.source_id}" ${openExams.has(e.source_id) ? "" : "hidden"}>
      ${e.questions.map((q, i) => renderExamQuestion(e, q, i)).join("")
        || (e.analysis?.status === "done" ? `<p class="empty exam-empty">no questions found</p>` : "")}
    </div>`;
}

function renderExamQuestion(exam, q, index) {
  const topics = q.topics.map(t => `
    <span class="q-topic q-${t.origin}">
      <button class="q-topic-open" title="${t.origin === "manual" ? "linked by you" : "linked by analyse"}"
              onclick="openExamTopic(${t.topic_id}, ${t.block_id ?? "null"}, ${q.question_id})">
        → ${escapeHtml(t.title)}<span class="q-topic-block"> · ${escapeHtml(shortBlockName(t.block_name))}</span>
      </button>
      <button class="q-unlink" title="not this topic" onclick="unlinkExamTopic(${q.question_id}, ${t.topic_id})">×</button>
    </span>`).join("");

  return `
    <div class="exam-q">
      <div class="exam-q-head">
        <span class="exam-q-num">${exam.kind === "homework" ? "T" : "Q"}${escapeHtml(q.number ?? String(index + 1))}</span>
        <div class="exam-q-text rich">${renderAnswer(q.text)}</div>
        ${q.page ? `<button class="icon-btn" title="original question in the PDF" onclick="openPdf(${exam.source_id}, ${q.page})">⎙</button>` : ""}
      </div>
      <div class="exam-q-topics">
        ${topics || `<span class="q-none">no topic</span>`}
        <select class="q-link" onchange="linkExamTopic(${q.question_id}, this)">
          <option value="">+ link topic</option>${examTopicOptions}
        </select>
      </div>
      <div class="exam-q-panel" id="exam-q-panel-${q.question_id}"></div>
    </div>`;
}

// The questions behind the "Most asked" rows, by question id, for showing them under a row.
const mostAskedQuestions = new Map();

// Topics counted over all analysed questions, final exam weighted like in Focus.
function renderMostAsked(exams) {
  const stats = new Map();
  mostAskedQuestions.clear();
  for (const e of exams) {
    for (const q of e.questions) {
      mostAskedQuestions.set(q.question_id, { ...q, kind: e.kind, source_id: e.source_id, filename: e.filename });
      for (const t of q.topics) {
        const s = stats.get(t.topic_id) ?? { id: t.topic_id, title: t.title, finals: 0, tests: 0, refs: [] };
        s[e.kind === "final" ? "finals" : "tests"] += 1;
        s.refs.push({ questionId: q.question_id, label: `${fileTitle(e.filename)} Q${q.number ?? "?"}` });
        stats.set(t.topic_id, s);
      }
    }
  }
  if (!stats.size) return "";

  // The counts show all of a topic's questions, a reference just that one.
  const rows = [...stats.values()]
    .sort((a, b) => (b.finals * 3 + b.tests * 2) - (a.finals * 3 + a.tests * 2))
    .slice(0, 15)
    .map(s => {
      const all = s.refs.map(r => r.questionId).join(",");
      return `
      <div class="most-row" id="most-${s.id}">
        <span class="most-title">${escapeHtml(s.title)}</span>
        <span class="most-counts">
          ${s.finals ? `<button class="why why-exam" onclick="toggleMostAsked(${s.id}, '${all}')">★ ${s.finals} final</button>` : ""}
          ${s.tests ? `<button class="why why-exam" onclick="toggleMostAsked(${s.id}, '${all}')">☆ ${count(s.tests, "test")}</button>` : ""}
        </span>
        <span class="most-refs">${s.refs.map(r =>
          `<button class="most-ref" onclick="toggleMostAsked(${s.id}, '${r.questionId}')">${escapeHtml(r.label)}</button>`).join("")}</span>
      </div>`;
    }).join("");

  return foldableSection("most-asked", "Most asked", "", rows);
}

// Shows the given questions (ids joined by commas) under the topic's row; the same click again closes them.
function toggleMostAsked(topicId, ids) {
  const existing = document.getElementById(`ma-${topicId}`);
  existing?.remove();
  if (existing?.dataset.ids === ids) return;

  const slot = document.createElement("div");
  slot.className = "focus-questions";
  slot.id = `ma-${topicId}`;
  slot.dataset.ids = ids;
  slot.innerHTML = ids.split(",").map(id => mostAskedQuestions.get(Number(id))).filter(Boolean)
    .map(questionCard).join("");
  document.getElementById(`most-${topicId}`).insertAdjacentElement("afterend", slot);
  renderMath(slot);
}

function toggleExam(sourceId) {
  const list = document.getElementById(`exam-q-${sourceId}`);
  list.hidden = !list.hidden;
  if (list.hidden) openExams.delete(sourceId); else openExams.add(sourceId);
  const button = document.querySelector(`#exam-state-${sourceId} .exam-count`);
  if (button) button.textContent = button.textContent.replace(/[▸▾]/, list.hidden ? "▸" : "▾");
}

async function uploadExam(kind) {
  const subjectId = document.getElementById("subject").value;
  const input = document.getElementById(`exam-file-${kind}`);
  const progress = document.getElementById(`exam-progress-${kind}`);
  if (!input.files.length) {
    progress.textContent = "pick a file first";
    return;
  }

  const form = new FormData();
  [...input.files].forEach(file => form.append("file", file));
  form.append("kind", kind);
  progress.className = "progress";
  progress.textContent = "uploading...";

  const response = await fetch(`/subjects/${subjectId}/exams`, { method: "POST", body: form });
  if (!response.ok) {
    const error = await response.json();
    progress.className = "progress failed";
    progress.textContent = typeof error.detail === "string" ? error.detail : "upload failed";
    return;
  }
  await loadExams(subjectId);
}

async function analyseExam(sourceId, again = false) {
  if (again && !await askConfirm("Analyse this file again?\n\nIts questions and topic links will be replaced. " +
                                 "Topics you linked by hand are kept for questions with the same number.",
                                 { ok: "analyse again" })) return;

  const response = await fetch(`/sources/${sourceId}/analyse`, { method: "POST" });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }
  const { job_id } = await response.json();
  document.getElementById(`exam-state-${sourceId}`).innerHTML = `<span class="progress">analysing…</span>`;
  watchExamJob(job_id, sourceId);
}

// Polls the analysis job: the label shows the page being read, the view reloads at the end.
async function watchExamJob(jobId, sourceId) {
  if (examPollers.has(jobId)) return;
  examPollers.add(jobId);

  const subjectId = document.getElementById("subject").value;
  while (true) {
    await sleep(4000);
    const job = await fetch(`/jobs/${jobId}`).then(r => r.json());
    if (job.status !== "running") break;
    const state = document.getElementById(`exam-state-${sourceId}`);
    if (state) state.innerHTML = `<span class="progress">analysing… ${escapeHtml(job.stage || "")}</span>`;
  }

  examPollers.delete(jobId);
  openExams.add(sourceId);
  // Exams and Homework both show analysed files; the one open is redrawn.
  if ((currentView === "exams" || currentView === "homework")
      && document.getElementById("subject").value === subjectId) {
    await loadView(subjectId);
  }
}

// A topic panel opens under the question. The same topic can sit under several
// questions, but a panel id must be unique, so an open copy elsewhere moves here.
function openExamTopic(topicId, blockId, questionId) {
  const slot = document.getElementById(`exam-q-panel-${questionId}`);
  const existing = document.getElementById(`panel-${topicId}`);
  if (existing && slot.contains(existing)) {
    closePanel(topicId);
    return;
  }
  // One panel per question slot, and one per topic on the page.
  slot.querySelectorAll(".panel").forEach(p => closePanel(Number(p.id.replace("panel-", ""))));
  existing?.remove();
  forgetHighlights(topicId);
  paintUnclear();

  slot.innerHTML = `<div class="panel" id="panel-${topicId}" style="display: none"></div>`;
  renderPanel(topicId, blockId);
}

async function linkExamTopic(questionId, select) {
  if (!select.value) return;
  const response = await fetch(`/exam-questions/${questionId}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic_id: Number(select.value) }),
  });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
  }
  await loadView(document.getElementById("subject").value);
}

async function unlinkExamTopic(questionId, topicId) {
  await fetch(`/exam-questions/${questionId}/topics/${topicId}`, { method: "DELETE" });
  await loadView(document.getElementById("subject").value);
}

async function loadBlocks(subjectId) {
  const blocks = await fetch(`/subjects/${subjectId}/blocks`).then(r => r.json());
  const target = document.getElementById("blocks");

  if (!blocks.length) {
    target.innerHTML = `<p class="empty">no blocks yet</p>`;
    return;
  }

  target.innerHTML = blocks.map(b => {
    const total = b.topics || 1;
    const pct = n => (n / total) * 100;

    return `
      <div class="block">
        <div class="block-head" onclick="toggleBlock(${b.block_id})">
            <span class="block-name"><span class="arrow" id="arrow-${b.block_id}">▸</span>${escapeHtml(b.name)}</span>
            <span class="block-meta">${b.topics} topics<span class="formula-progress" id="job-${b.block_id}">${b.job ? ` · ${escapeHtml(b.job.stage)}...` : ""}</span><span class="formula-progress" id="formulas-${b.block_id}">${formulaLabel(b)}</span></span>
            <span class="block-actions">
              ${iconButton("rename", "rename block", `event.stopPropagation(); renameBlock(${b.block_id})`)}
              ${iconButton("delete", "delete block", `event.stopPropagation(); deleteBlock(${b.block_id})`, "danger")}
            </span>
        </div>
        <div class="bar-track">
          <div class="bar">
            <div class="seg-new"    style="width: ${pct(b.status.new)}%"></div>
            <div class="seg-known"  style="width: ${pct(b.status.known)}%"></div>
            <div class="seg-review" style="width: ${pct(b.status.review)}%"></div>
          </div>
        </div>
        <div class="topics" id="topics-${b.block_id}"></div>
      </div>`;
  }).join("");

  watchFormulas(subjectId, blocks);
  // Lectures still processing after a reload: the folded block shows the stage and
  // redraws when they are done, without unfolding.
  blocks.filter(b => b.job).forEach(b => watchJob(b.job.job_id, b.block_id, false));

  // Redrawing collapsed every block; reopen the ones that were open. Ids from
  // another subject are not on the page any more and are forgotten.
  await Promise.all([...openBlocks].map(id =>
    document.getElementById(`topics-${id}`) ? toggleBlock(id) : openBlocks.delete(id)));
  saveOpenBlocks();
}

// ---- Page state kept across redraws and reloads: open blocks, open topic panels, scroll ----

const OPEN_BLOCKS_KEY = "study-assistant:open-blocks";
const OPEN_PANELS_KEY = "study-assistant:open-panels";
const SCROLL_KEY = "study-assistant:scroll";

// Block ids that are unfolded, so a redraw or a reload can bring them back.
const openBlocks = new Set(loadState(OPEN_BLOCKS_KEY, []));
// topic id → block id of topic panels open in Blocks (Focus and Exams start closed)
const openPanels = loadState(OPEN_PANELS_KEY, {});

function saveOpenBlocks() {
  saveState(OPEN_BLOCKS_KEY, [...openBlocks]);
}

function rememberOpenPanel(panel, topicId, blockId) {
  if (!panel.closest("#blocks")) return;
  openPanels[topicId] = blockId;
  saveState(OPEN_PANELS_KEY, openPanels);
}

function forgetOpenPanel(topicId) {
  if (!(topicId in openPanels)) return;
  delete openPanels[topicId];
  saveState(OPEN_PANELS_KEY, openPanels);
}

let scrollRestored = false;

// Once, after the first page load has drawn everything that was open.
function restoreScroll() {
  if (scrollRestored) return;
  scrollRestored = true;
  document.querySelector(".main").scrollTop = loadState(SCROLL_KEY, 0);
}

// Shown only while the background worker still has pages of this block to re-read (formulas, pictures).
const formulaLabel = b =>
  b.formulas && b.formulas.done < b.formulas.pages ? ` · reading slides ${b.formulas.done}/${b.formulas.pages}` : "";

let formulaTimer = null;

// Updates just the progress labels, so open blocks and panels stay as they are.
function watchFormulas(subjectId, blocks) {
  clearTimeout(formulaTimer);
  if (!blocks.some(b => formulaLabel(b))) return;

  formulaTimer = setTimeout(async () => {
    if (document.getElementById("subject").value !== String(subjectId)) return;
    const fresh = await fetch(`/subjects/${subjectId}/blocks`).then(r => r.json());
    fresh.forEach(b => {
      const label = document.getElementById(`formulas-${b.block_id}`);
      if (label) label.textContent = formulaLabel(b);
    });
    watchFormulas(subjectId, fresh);
  }, 60000);
}

const NEXT_STATUS = { new: "known", known: "review", review: "new" };

async function toggleBlock(blockId) {
  const box = document.getElementById(`topics-${blockId}`);
  const arrow = document.getElementById(`arrow-${blockId}`);

  if (box.innerHTML) {
    box.innerHTML = "";
    arrow.textContent = "▸";
    openBlocks.delete(blockId);
    saveOpenBlocks();
    return;
  }
  openBlocks.add(blockId);
  saveOpenBlocks();

  const [topics, files] = await Promise.all([
    fetch(`/blocks/${blockId}/topics`).then(r => r.json()),
    fetch(`/blocks/${blockId}/files`).then(r => r.json()),
  ]);

  // A lecture still processing after a page reload: keep showing its progress.
  // Homework jobs are analyses, watched on the Homework page, not lecture processing.
  files.filter(f => f.job?.status === "running" && f.type !== "homework")
    .forEach(f => watchJob(f.job.job_id, blockId));
  const upload = uploads[blockId];

  const row = (t, isChild, awayFrom) => `
    <div class="topic ${isChild ? "child" : ""}" draggable="true" data-topic-row="${t.id}"
         ondragstart="startTopicDrag(event, ${t.id})" ondragend="endTopicDrag()"
         ondragover="dragOverTarget(event)" ondragleave="dragLeaveTarget(event)"
         ondrop="dropTopic(event, ${isChild ? t.parent_id : t.id}, ${blockId})"
         data-drop-label="${isChild ? "drop here into this group" : "drop here as a subtopic"}">
      <span class="dot dot-${t.status}" title="${t.status}" onclick="cycleStatus(${t.id}, '${t.status}', ${blockId})"></span>
      <span class="topic-title" id="title-${t.id}" onclick="togglePanel(${t.id}, ${blockId}, this)">${escapeHtml(t.title)}</span>
      ${awayFrom ? `<span class="topic-parent" title="subtopic of ${escapeHtml(awayFrom)}">under ${escapeHtml(awayFrom)}</span>` : ""}
      <span class="unclear-badge" id="unclear-${t.id}" title="unclear places" ${t.unclear ? "" : "hidden"}>?${t.unclear || 0}</span>
      <span class="topic-weight">
        <span class="pages-short">${pageRanges(t.pages, 3)}</span>
        ${pageRanges(t.pages, 3) !== pageRanges(t.pages) ? `<span class="pages-full">${pageRanges(t.pages)}</span>` : ""}
      </span>
      <span class="topic-actions">
        ${isChild ? iconButton("outdent", "make it a top-level topic", `makeRoot(${t.id}, ${blockId})`) : ""}
        ${iconButton("rename", "rename", `renameTopic(${t.id}, ${blockId})`)}
        ${iconButton("delete", "delete", `deleteTopic(${t.id}, ${blockId})`, "danger")}
      </span>
    </div>`;

  // Hidden behind "+ upload" once the block has files; open in an empty block
  // and while an upload of this block is in progress.
  const uploadRow = `
    <div class="upload" id="upload-${blockId}" ${files.length && !upload ? "hidden" : ""}>
      <input type="file" id="file-${blockId}" accept="${UPLOAD_ACCEPT},${CODE_ACCEPT}" multiple
             title="${UPLOAD_HINT}; or one code or Markdown file to view">
      <select id="type-${blockId}">
        <option value="lecture">lecture</option>
        <option value="homework">homework</option>
        <option value="concept">concept</option>
        <option value="my_solution">my solution</option>
        <option value="other">other</option>
      </select>
      <button onclick="uploadFile(${blockId})">upload</button>
      ${iconButton("close", "close (esc)", `closeUpload('upload-${blockId}')`, "cancel")}
      <span class="${upload?.failed ? "progress failed" : "progress"}" id="progress-${blockId}">${escapeHtml(upload?.text ?? "")}</span>
    </div>`;

  const missing = topics.filter(t => t.has_summary === false).length;
  const bulkRow = `
    <div class="bulk">
      <button class="magic" id="bulk-btn-${blockId}" onclick="summarizeBlock(${blockId})" ${missing ? "" : "disabled"}>
        ${bulkSummaries[blockId] ? "stop" : missing ? `generate summaries (${missing} missing)` : "all topics have summaries"}
      </button>
      <span class="progress" id="bulk-${blockId}"></span>
    </div>`;

  const rootZone = `
    <div class="drop-root"
         ondragover="dragOverTarget(event)" ondragleave="dragLeaveTarget(event)"
         ondrop="dropTopic(event, null, ${blockId})">drop here to make it a top-level topic</div>`;

  box.innerHTML = renderMaterials(files, blockId) + uploadRow + bulkRow + orderTopics(topics)
    .map(({ topic, isChild, awayFrom }) => row(topic, isChild, awayFrom))
    .join("") + rootZone;

  arrow.textContent = "▾";

  // Topic panels that were open in this block before a redraw or a reload.
  await Promise.all(Object.entries(openPanels)
    .filter(([topicId, panelBlock]) => panelBlock === blockId)
    .map(([topicId]) => {
      const row = box.querySelector(`[data-topic-row="${topicId}"]`);
      if (!row) return null;
      openPanelAfter(row, Number(topicId));
      return renderPanel(Number(topicId), blockId);
    }));
}

// One row per file type, in this order; empty rows are not shown.
const MATERIAL_ROWS = [
  { type: "lecture", label: "Lecture", icon: "▤" },
  { type: "concept", label: "Concept", icon: "◇" },
  { type: "homework", label: "Homework", icon: "✎" },
  { type: "my_solution", label: "Mine", icon: "✍" },
  { type: "past_exam", label: "Exam", icon: "★" },
  { type: "other", label: "Other", icon: "•" },
];
const MATERIALS_VISIBLE = 5;

function renderMaterials(files, blockId) {
  const rows = MATERIAL_ROWS.map(({ type, label, icon }) => {
    const ofType = files.filter(f => f.type === type);
    if (!ofType.length) return "";

    const chips = ofType.map((f, i) => {
      sourceNames[f.source_id] = f.filename;
      const name = escapeHtml(f.filename.replace(/\.pdf$/i, ""));
      return `
        <span class="chip-file chip-${type}" ${i >= MATERIALS_VISIBLE ? "hidden" : ""}>
          <button class="chip-open" title="${escapeHtml(f.filename)}" ${f.has_pdf || f.has_text ? "" : "disabled"}
                  onclick="${f.has_text ? `openText(${f.source_id})` : `openPdf(${f.source_id}, 1)`}">
            <span class="chip-icon">${icon}</span><span class="chip-name">${name}</span>
          </button>
          <button class="chip-delete" title="delete file" aria-label="delete file"
                  onclick="deleteSource(${f.source_id}, ${blockId})">×</button>
        </span>`;
    }).join("");

    const hiddenCount = ofType.length - MATERIALS_VISIBLE;
    const more = hiddenCount > 0
      ? `<button class="chip-more" onclick="showAllMaterials(this)">+${hiddenCount}</button>`
      : "";

    return `
      <div class="materials-row">
        <span class="materials-label">${label}</span>${chips}${more}
      </div>`;
  }).join("");

  return `
    <div class="materials">
      <div class="materials-head">
        <span class="materials-title">Materials</span>
        <button class="ghost" onclick="revealField('upload-${blockId}', 'file-${blockId}')">+ upload</button>
      </div>
      ${rows}
    </div>`;
}

async function deleteSource(sourceId, blockId) {
  const impact = await fetch(`/sources/${sourceId}/delete-preview`).then(r => r.json());

  let message = `Delete file “${impact.filename}”?`;
  if (impact.topics) {
    message += `\n\nTopics that exist only in this file will be deleted too: ${impact.topics}`;
    if (impact.notes) message += `, with ${count(impact.notes, "note")}`;
    message += ".";
  }
  if (!await askConfirm(message, { ok: "delete", danger: true })) return;

  const response = await fetch(`/sources/${sourceId}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return;
  }

  // Topic counts and progress bars change too, so the whole block list is redrawn.
  await refresh(blockId);
}

function showAllMaterials(button) {
  button.parentElement.querySelectorAll(".chip-file[hidden]").forEach(chip => { chip.hidden = false; });
  button.remove();
}

// Lays topics out in page order. A group (top-level topic plus its subtopics)
// starts at its earliest page, so a parent rises to its earliest subtopic.
// A subtopic stays under its parent until another top-level topic comes first
// by page; after that it sits at its own page, marked with its parent's title.
function orderTopics(topics) {
  const byId = Object.fromEntries(topics.map(t => [t.id, t]));
  const isRoot = t => t.parent_id === null || !byId[t.parent_id];
  const page = t => t.first_page ?? Infinity;

  // The seen set guards against a parent cycle in the data.
  const rootOf = t => {
    const seen = new Set();
    while (!isRoot(t) && !seen.has(t.id)) {
      seen.add(t.id);
      t = byId[t.parent_id];
    }
    return t;
  };

  const groupStart = {};
  topics.forEach(t => {
    const root = rootOf(t);
    groupStart[root.id] = Math.min(groupStart[root.id] ?? Infinity, page(t));
  });

  // [own position, group position, top-level first]. On equal pages a subtopic
  // of an earlier group comes before a new top-level topic.
  const key = t => {
    const group = groupStart[rootOf(t).id];
    return isRoot(t) ? [group, group, 0] : [page(t), group, 1];
  };

  const ordered = topics
    .map(t => ({ t, k: key(t) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) {
        if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1;
      }
      return 0;
    })
    .map(x => x.t);

  let current = null;
  return ordered.map(topic => {
    if (isRoot(topic)) {
      current = topic;
      return { topic, isChild: false, awayFrom: null };
    }
    const underParent = current !== null && topic.parent_id === current.id;
    return { topic, isChild: true, awayFrom: underParent ? null : byId[topic.parent_id].title };
  });
}

// Running bulk generations by block id; setting `stop` ends the loop after the current topic.
const bulkSummaries = {};

// The block can be collapsed and reopened while this runs, so look the elements up every time.
function setBulkStatus(blockId, text, failed = false) {
  const status = document.getElementById(`bulk-${blockId}`);
  if (!status) return;
  status.className = failed ? "progress failed" : "progress";
  status.textContent = text;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function summarizeBlock(blockId) {
  if (bulkSummaries[blockId]) {
    bulkSummaries[blockId].stop = true;
    setBulkStatus(blockId, "stopping after the current topic...");
    return;
  }

  const run = { stop: false };
  bulkSummaries[blockId] = run;
  const button = document.getElementById(`bulk-btn-${blockId}`);
  if (button) button.textContent = "stop";

  const topics = await fetch(`/blocks/${blockId}/topics`).then(r => r.json());
  const todo = orderTopics(topics).map(x => x.topic).filter(t => t.has_summary === false);
  let written = 0;
  const failed = [];

  for (const [i, topic] of todo.entries()) {
    if (run.stop) break;
    setBulkStatus(blockId, `${i + 1} / ${todo.length} · ${topic.title}`);

    // Retries the same topic while Groq says the rate limit is reached.
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`/topics/${topic.id}/summary`, { method: "POST" });

      if (response.status === 429 && attempt <= 5 && !run.stop) {
        const wait = Number(response.headers.get("Retry-After")) || 20 * attempt;
        setBulkStatus(blockId, `${i + 1} / ${todo.length} · rate limit, waiting ${Math.ceil(wait)}s...`);
        await sleep(wait * 1000);
        continue;
      }

      if (response.ok) written++;
      else failed.push(topic.title);
      break;
    }
  }

  delete bulkSummaries[blockId];
  const stopped = run.stop ? "stopped · " : "";
  const tail = failed.length ? ` · failed: ${failed.join(", ")}` : "";
  setBulkStatus(blockId, `${stopped}${written} written${tail}`, failed.length > 0);

  const left = todo.length - written;
  const again = document.getElementById(`bulk-btn-${blockId}`);
  if (again) {
    again.textContent = left ? `generate summaries (${left} missing)` : "all topics have summaries";
    again.disabled = !left;
  }
}

async function patchTopic(topicId, body) {
  const response = await fetch(`/topics/${topicId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed: ${error.detail}`);
    return false;
  }
  return true;
}

// Custom type so files dragged in from the desktop are not treated as topics.
const TOPIC_DRAG_TYPE = "application/x-topic-id";

function startTopicDrag(event, topicId) {
  event.dataTransfer.setData(TOPIC_DRAG_TYPE, String(topicId));
  event.dataTransfer.effectAllowed = "move";
  event.currentTarget.classList.add("dragging");
  // Changing layout synchronously in dragstart can cancel the drag in Chrome.
  setTimeout(() => document.body.classList.add("dragging-topic"));
}

function endTopicDrag() {
  document.body.classList.remove("dragging-topic");
  document.querySelectorAll(".dragging, .drop-target")
    .forEach(el => el.classList.remove("dragging", "drop-target"));
}

function dragOverTarget(event) {
  if (!event.dataTransfer.types.includes(TOPIC_DRAG_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drop-target");
}

function dragLeaveTarget(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove("drop-target");
}

async function dropTopic(event, parentId, blockId) {
  event.preventDefault();
  const topicId = Number(event.dataTransfer.getData(TOPIC_DRAG_TYPE));
  endTopicDrag();
  if (!topicId || topicId === parentId) return;

  // A drop is easy to make by accident, so it is confirmed first.
  const title = id => document.getElementById(`title-${id}`)?.textContent ?? "this topic";
  const question = parentId == null
    ? `Make “${title(topicId)}” a top-level topic?`
    : `Move “${title(topicId)}” under “${title(parentId)}”?`;
  if (!await askConfirm(question, { ok: "move" })) return;

  if (await patchTopic(topicId, { parent_id: parentId })) {
    await refresh(blockId);
  }
}

async function makeRoot(topicId, blockId) {
  const title = document.getElementById(`title-${topicId}`)?.textContent ?? "this topic";
  if (!await askConfirm(`Make “${title}” a top-level topic?`, { ok: "move" })) return;
  if (await patchTopic(topicId, { parent_id: null })) {
    await refresh(blockId);
  }
}

async function refresh(blockId) {
  const select = document.getElementById("subject");
  // A status change or a deleted topic in Focus or Exams redraws that view, not the blocks.
  if (currentView !== "blocks") return loadView(select.value);
  // loadBlocks reopens every block in openBlocks, this one included.
  if (blockId != null) {
    openBlocks.add(blockId);
    saveOpenBlocks();
  }
  await loadBlocks(select.value);
}

async function cycleStatus(topicId, current, blockId) {
  if (await patchTopic(topicId, { status: NEXT_STATUS[current] })) {
    await refresh(blockId);
  }
}

async function renameTopic(topicId, blockId) {
  const current = document.getElementById(`title-${topicId}`).textContent;
  const title = await askText("Rename topic", current);

  if (!title || title === current) return;
  if (await patchTopic(topicId, { title })) {
    await refresh(blockId);
  }
}

async function deleteTopic(topicId, blockId) {
  const title = document.getElementById(`title-${topicId}`).textContent;
  if (!await askConfirm(`Delete topic “${title}”?`, { ok: "delete", danger: true })) return;

  await fetch(`/topics/${topicId}`, { method: "DELETE" });
  await refresh(blockId);
}

async function addSubject() {
  const name = await askText("New subject", "", "create");
  if (!name || !name.trim()) return;

  const response = await fetch("/subjects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // into the semester shown on the subjects page
    body: JSON.stringify({ name: name.trim(), semester_id: currentSemesterId() }),
  });

  if (!response.ok) {
    showAlert("failed: the subject could not be created");
    return;
  }

  // pushState does not fire hashchange; loadSubjects routes once the list has the new subject.
  const subject = await response.json();
  history.pushState(null, "", `#subject-${subject.id}`);
  await loadSubjects();
}

async function addBlock() {
  const subjectId = document.getElementById("subject").value;
  if (!subjectId) return;

  const name = await askText("New block, e.g. Lecture 3 — Heaps", "", "create");
  if (!name || !name.trim()) return;

  const response = await fetch(`/subjects/${subjectId}/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });

  if (!response.ok) {
    const error = await response.json();
    showAlert(`failed to create block: ${error.detail}`);
    return;
  }

  // A new block is only visible in Blocks, so switch there.
  setView("blocks");
}

async function renameBlock(blockId) {
  const current = document.querySelector(`#arrow-${blockId}`).parentElement.lastChild.textContent;
  const name = await askText("Rename block", current);
  if (!name || !name.trim() || name.trim() === current) return;

  const response = await fetch(`/blocks/${blockId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  await refresh(null);   // null: a folded block stays folded
}

// Says what goes with the block before deleting it: files, topics only it has, their notes.
async function deleteBlock(blockId) {
  const impact = await fetch(`/blocks/${blockId}/delete-preview`).then(r => r.json());
  const what = impact.files
    ? `\n\nThis deletes ${count(impact.files, "file")}, ${count(impact.topics, "topic")} and ${count(impact.notes, "note")}.`
    : "";
  if (!await askConfirm(`Delete the block “${impact.name}”?${what}`, { ok: "delete", danger: true })) return;

  const response = await fetch(`/blocks/${blockId}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    showAlert(`failed: ${error.detail ?? response.status}`);
    return;
  }
  openBlocks.delete(blockId);
  saveOpenBlocks();
  await refresh(null);
}

async function uploadFile(blockId) {
  const input = document.getElementById(`file-${blockId}`);
  const type = document.getElementById(`type-${blockId}`).value;

  if (!input.files.length) {
    setUploadStatus(blockId, "pick a file first");
    return;
  }

  const form = new FormData();
  [...input.files].forEach(file => form.append("file", file));
  form.append("source_type", type);
  input.value = "";
  setUploadStatus(blockId, "uploading...");

  const response = await fetch(`/blocks/${blockId}/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const error = await response.json();
    setUploadStatus(blockId, typeof error.detail === "string" ? error.detail : "upload failed", true);
    return;
  }

  const result = await response.json();

  // Only lectures get a processing job; other files are just stored.
  if (result.job_id === null) {
    setUploadStatus(blockId, "saved");
    await refresh(blockId);
    delete uploads[blockId];
    return;
  }

  setUploadStatus(blockId, `${result.chunks} chunks (${result.weak_chunks} weak) — processing...`);
  watchJob(result.job_id, blockId);
}

// Upload progress lives here, not in the page element: a block can be redrawn
// (another upload finishes, a new block is added) while its upload is still
// running, and a redraw replaces the element. The label is looked up by id on
// every update and redrawn from this state.
const uploads = {};              // block id → { text, failed }
const watchedJobs = new Set();   // job ids with a watchJob loop already running

function setUploadStatus(blockId, text, failed = false) {
  uploads[blockId] = { text, failed };
  const label = document.getElementById(`progress-${blockId}`);
  if (label) {
    label.className = failed ? "progress failed" : "progress";
    label.textContent = text;
  }
  const row = document.getElementById(`upload-${blockId}`);
  if (row) row.hidden = false;
  const head = document.getElementById(`job-${blockId}`);
  if (head) head.textContent = failed ? " · failed" : ` · ${text}`;
}

// reopen: unfold the block when done (an upload made here), or only redraw (found after a reload).
async function watchJob(jobId, blockId, reopen = true) {
  if (watchedJobs.has(jobId)) return;
  watchedJobs.add(jobId);

  let job;
  while (true) {
    job = await fetch(`/jobs/${jobId}`).then(r => r.json());
    if (job.status !== "running") break;
    setUploadStatus(blockId, `${job.stage}...`);
    await sleep(3000);
  }
  watchedJobs.delete(jobId);

  if (job.status === "failed") {
    setUploadStatus(blockId, `failed: ${job.message}`, true);
    return;
  }

  setUploadStatus(blockId, "done");
  await refresh(reopen ? blockId : null);
  delete uploads[blockId];
}
async function makeSummary(topicId, blockId) {
  const status = document.getElementById(`summary-status-${topicId}`);
  if (status) status.textContent = "writing...";

  const response = await fetch(`/topics/${topicId}/summary`, { method: "POST" });

  if (!response.ok) {
    const error = await response.json();
    if (status) status.textContent = `failed: ${error.detail}`;
    return;
  }

  const result = await response.json();
  if (!result.saved) {
    showAlert("you edited this summary by hand, so it was not overwritten");
    return;
  }

  await reopenPanel(topicId, blockId);
}

function editSummary(topicId, blockId) {
  const box = document.getElementById(`summary-${topicId}`);
  const current = box.dataset.raw;

  box.outerHTML = `
    <textarea class="summary-edit" id="edit-${topicId}" rows="10">${escapeHtml(current)}</textarea>
    <div class="edit-actions">
      <button class="primary" onclick="saveSummary(${topicId}, ${blockId})">save summary</button>
      <button class="ghost" onclick="reopenPanel(${topicId}, ${blockId})">cancel</button>
    </div>`;
  document.getElementById(`edit-${topicId}`).focus();
}

async function saveSummary(topicId, blockId) {
  const text = document.getElementById(`edit-${topicId}`).value;

  const ok = await patchTopic(topicId, { summary: text });
  if (ok) await reopenPanel(topicId, blockId);
}
const sourceNames = {};

// The viewer on the right shows either a PDF (in the frame) or a text file (in text-view).
function showViewer(name, asText) {
  document.getElementById("viewer-name").textContent = name;
  document.getElementById("pdf-frame").hidden = asText;
  document.getElementById("text-view").hidden = !asText;
  document.getElementById("viewer").classList.add("open");
  document.getElementById("divider").classList.add("open");
}

function openPdf(sourceId, page) {
  const frame = document.getElementById("pdf-frame");
  frame.src = `/sources/${sourceId}/pdf?t=${Date.now()}#page=${page}`;
  showViewer(sourceNames[sourceId] || "", false);
}

// Markdown is drawn like a summary, formulas included; code is highlighted.
// highlight.js guesses the language from the extension, or from the code.
async function openText(sourceId) {
  const response = await fetch(`/sources/${sourceId}/text`);
  if (!response.ok) {
    showAlert(`failed: ${(await response.json().catch(() => ({}))).detail ?? response.status}`);
    return;
  }
  const { filename, text } = await response.json();
  const view = document.getElementById("text-view");
  const extension = filename.split(".").pop().toLowerCase();

  if (extension === "md") {
    view.innerHTML = `<div class="rich">${renderAnswer(text)}</div>`;
    renderMath(view);
  } else {
    view.innerHTML = `<pre><code>${escapeHtml(text)}</code></pre>`;
    const code = view.querySelector("code");
    if (window.hljs?.getLanguage(extension)) code.classList.add(`language-${extension}`);
    if (window.hljs && extension !== "txt") hljs.highlightElement(code);
  }
  view.scrollTop = 0;
  document.getElementById("pdf-frame").src = "";
  showViewer(filename, true);
}

function closeViewer() {
  document.getElementById("viewer").classList.remove("open");
  document.getElementById("divider").classList.remove("open");
  document.getElementById("pdf-frame").src = "";
  document.getElementById("text-view").innerHTML = "";
}

document.getElementById("divider").onmousedown = event => {
  event.preventDefault();

  const move = e => {
    const percent = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    if (percent > 15 && percent < 85) {
      document.getElementById("viewer").style.width = `${percent}%`;
    }
  };

  const stop = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", stop);
  };

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", stop);
};
// The scroll position is saved shortly after scrolling stops, for the next reload.
let scrollSaveTimer = null;
document.querySelector(".main").addEventListener("scroll", event => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => saveState(SCROLL_KEY, event.target.scrollTop), 200);
});

loadSubjects();
