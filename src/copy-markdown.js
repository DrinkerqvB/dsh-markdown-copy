/*
 * dsh-markdown-copy: DOM selection -> Markdown source.
 *
 * The DSH chat view renders assistant messages from their Markdown source, so
 * the rendered DOM keeps everything needed to rebuild the source structure:
 * semantic block elements, KaTeX annotations (the original TeX) and code
 * blocks that carry their language.  This module walks whatever the browser
 * selected inside `[data-chat-flow]` and renders a Markdown document from it.
 *
 * Kept as a plain script on purpose: build.mjs inlines it into client.js, and
 * the test suite evaluates it with jsdom without a bundler.
 */

var BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CAPTION", "CENTER", "DD",
  "DETAILS", "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
  "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP",
  "HR", "LI", "MAIN", "MENU", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY",
  "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
]);

var SKIP_TAGS = new Set([
  "AUDIO", "CANVAS", "EMBED", "IFRAME", "MAP", "NOSCRIPT", "OBJECT", "OPTION",
  "SCRIPT", "SELECT", "STYLE", "SVG", "TEMPLATE", "TEXTAREA", "VIDEO"
]);

/**
 * Render a selected DOM range as Markdown source.
 *
 * @param {Range} range
 * @returns {string}
 */
function serializeSelectionMarkdown(range) {
  var state = { codes: [] };
  var body = renderFlow(range.cloneContents(), state);
  var markdown = tidyMarkdown(body);
  return markdown.replace(/\u0000CODE(\d+)\u0000/g, function (match, index) {
    return state.codes[Number(index)] || "";
  });
}

/* ------------------------------------------------------------------------- */
/* block layout                                                              */
/* ------------------------------------------------------------------------- */

function renderFlow(parent, state) {
  var out = "";
  var inline = "";

  function flushInline() {
    var text = inline.trim();
    if (text) out += text + "\n\n";
    inline = "";
  }

  var nodes = parent.childNodes || [];
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    if (node.nodeType === 1) {
      if (shouldSkipElement(node)) continue;
      if (isBlockElement(node)) {
        flushInline();
        out += renderBlock(node, state);
        continue;
      }
    }
    inline += renderInlineNode(node, state);
  }
  flushInline();
  return out;
}

function isBlockElement(element) {
  if (BLOCK_TAGS.has(element.tagName)) return true;
  return hasClass(element, "md-code-block") || hasClass(element, "katex-display");
}

function renderBlock(element, state) {
  var tag = element.tagName;

  if (hasClass(element, "md-code-block")) {
    return renderCodeBlock(element, state);
  }
  if (hasClass(element, "katex-display")) {
    return renderMath(element) + "\n\n";
  }

  if (
    tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "MAIN" ||
    tag === "ASIDE" || tag === "HEADER" || tag === "FOOTER" || tag === "FIGURE" ||
    tag === "FIGCAPTION" || tag === "DETAILS" || tag === "SUMMARY" || tag === "CENTER" ||
    tag === "DL" || tag === "FORM" || tag === "FIELDSET" || tag === "NAV" || tag === "MENU"
  ) {
    return renderFlow(element, state);
  }

  switch (tag) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      var text = renderInlineChildren(element, state).trim();
      if (!text) return "";
      return repeat("#", Number(tag.charAt(1))) + " " + text + "\n\n";
    }
    case "P":
      return renderParagraph(element, state);
    case "UL":
    case "OL":
      return renderList(element, state);
    case "LI":
      return renderListItem(element, null, state);
    case "BLOCKQUOTE":
      return renderBlockquote(element, state);
    case "PRE":
      return renderPre(element, state);
    case "TABLE":
      return renderTable(element, state);
    case "THEAD":
    case "TBODY":
    case "TFOOT": {
      var lines = "";
      for (var tr = 0; tr < element.children.length; tr += 1) {
        lines += renderTableRow(element.children[tr], state);
      }
      return lines;
    }
    case "TR":
      return renderTableRow(element, state);
    case "TD":
    case "TH":
      return renderInlineChildren(element, state).trim() + "\n\n";
    case "HR":
      return "---\n\n";
    case "DD":
    case "DT": {
      var term = renderInlineChildren(element, state).trim();
      return term ? term + "\n\n" : "";
    }
    default:
      return renderFlow(element, state);
  }
}

function renderParagraph(element, state) {
  // A paragraph that holds nothing but display math is the block form of a
  // `$$…$$` expression; anything else keeps its surrounding inline text.
  if (onlyDisplayMath(element)) {
    return renderMath(element.firstElementChild) + "\n\n";
  }
  var text = renderInlineChildren(element, state).trim();
  if (!text) return "";
  return text + "\n\n";
}

function onlyDisplayMath(element) {
  var mathElement = null;
  for (var i = 0; i < element.childNodes.length; i += 1) {
    var child = element.childNodes[i];
    if (child.nodeType === 3) {
      if ((child.data || "").trim()) return false;
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (!hasClass(child, "katex-display") || mathElement) return false;
    mathElement = child;
  }
  return mathElement;
}

function renderBlockquote(element, state) {
  var inner = renderFlow(element, state).replace(/\n+$/, "");
  if (!inner) return "";
  var lines = inner.split("\n");
  for (var i = 0; i < lines.length; i += 1) {
    lines[i] = lines[i] ? "> " + lines[i] : ">";
  }
  return lines.join("\n") + "\n\n";
}

/* ------------------------------------------------------------------------- */
/* lists                                                                     */
/* ------------------------------------------------------------------------- */

function renderList(element, state) {
  var ordered = element.tagName === "OL";
  var start = ordered ? Number.parseInt(element.getAttribute("start") || "1", 10) : 1;
  if (!Number.isFinite(start)) start = 1;

  var items = [];
  for (var i = 0; i < element.children.length; i += 1) {
    if (element.children[i].tagName === "LI") items.push(element.children[i]);
  }
  if (items.length === 0) return renderFlow(element, state);

  var out = "";
  for (var index = 0; index < items.length; index += 1) {
    out += renderListItem(items[index], ordered ? start + index : null, state);
  }
  return out + "\n";
}

function renderListItem(item, number, state) {
  var depth = state.listDepth || 0;
  var indent = repeat("  ", depth);
  var marker = number === null ? "-" : number + ".";

  var inline = "";
  var blocks = [];
  var nested = [];
  for (var i = 0; i < item.childNodes.length; i += 1) {
    var child = item.childNodes[i];
    if (child.nodeType === 1) {
      if (shouldSkipElement(child)) continue;
      if (child.tagName === "UL" || child.tagName === "OL") {
        nested.push(child);
        continue;
      }
      if (isBlockElement(child)) {
        blocks.push(child);
        continue;
      }
    }
    inline += renderInlineNode(child, state);
  }

  var body = inline.trim();
  for (var b = 0; b < blocks.length; b += 1) {
    var block = renderBlock(blocks[b], state).trim();
    if (block) body += (body ? "\n" : "") + block;
  }
  if (!body) return "";

  if (hasClass(item, "task-list-item")) {
    var box = item.querySelector('input[type="checkbox"]');
    var checked = box ? box.checked || box.hasAttribute("checked") : false;
    body = (checked ? "[x] " : "[ ] ") + body;
  }

  var lines = body.split("\n");
  var out = indent + marker + " " + lines[0] + "\n";
  for (var line = 1; line < lines.length; line += 1) {
    if (lines[line].trim() === "") out += "\n";
    else out += indent + "  " + lines[line] + "\n";
  }

  for (var n = 0; n < nested.length; n += 1) {
    var nestedState = { codes: state.codes, listDepth: depth + 1 };
    var nestedText = renderList(nested[n], nestedState).replace(/\n+$/, "");
    if (nestedText) out += nestedText + "\n";
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* code                                                                      */
/* ------------------------------------------------------------------------- */

function renderCodeBlock(element, state) {
  var banner = element.querySelector("[data-code-block-banner]");
  var language = codeBlockLanguage(banner);

  var pre = element.querySelector("pre");
  if (pre) {
    var code = pre.querySelector("code") || pre;
    return renderCodeFence(collectCodeText(code), language || codeLanguage(code), state);
  }

  var content = element.querySelector("[data-code-block-content]") || element;
  return renderCodeFence((content.textContent || "").trim(), language, state);
}

function codeBlockLanguage(banner) {
  if (!banner) return "";
  // The chat view renders the card toolbar variant, whose language lives in a
  // hashed `_language_*` span; the plain variant uses `.infostring`.
  var candidates = banner.querySelectorAll(".infostring, [class*='language']");
  for (var i = 0; i < candidates.length; i += 1) {
    var text = (candidates[i].textContent || "").trim();
    if (!text) continue;
    // The toolbar falls back to a localized "Code" label when the fence has no
    // language; that label must not become the fence info string.
    if (/^(code|代码|text|plaintext|plain)$/i.test(text)) return "";
    if (/^[\w#+.-]{1,24}$/.test(text)) return text;
    return "";
  }
  return "";
}

function renderPre(element, state) {
  var code = element.querySelector("code") || element;
  return renderCodeFence(collectCodeText(code), codeLanguage(code) || codeLanguage(element), state);
}

function renderCodeFence(text, language, state) {
  var value = (text || "").replace(/\n+$/, "");
  var fence = "`".repeat(fenceLength(value));
  var block = fence + (language || "") + "\n" + value + "\n" + fence;
  var index = state.codes.push(block) - 1;
  return "\u0000CODE" + index + "\u0000\n\n";
}

function collectCodeText(code) {
  var lines = [];
  for (var i = 0; i < code.children.length; i += 1) {
    var child = code.children[i];
    if (child.tagName === "SPAN" && hasClass(child, "line")) lines.push(child);
  }
  if (lines.length > 0) {
    var text = [];
    for (var l = 0; l < lines.length; l += 1) {
      text.push((lines[l].textContent || "").replace(/\n+$/, ""));
    }
    return text.join("\n");
  }
  return code.textContent || "";
}

function fenceLength(text) {
  var runs = text.match(/`+/g);
  var max = 0;
  if (runs) {
    for (var i = 0; i < runs.length; i += 1) {
      if (runs[i].length > max) max = runs[i].length;
    }
  }
  return Math.max(3, max + 1);
}

function codeLanguage(element) {
  var className = typeof element.className === "string" ? element.className : "";
  var match = /(?:^|\s)(?:language|lang)-([\w#+.-]+)/.exec(className);
  return match ? match[1] : "";
}

/* ------------------------------------------------------------------------- */
/* tables                                                                    */
/* ------------------------------------------------------------------------- */

function renderTable(table, state) {
  var rows = [];
  var rowElements = table.querySelectorAll("tr");
  for (var i = 0; i < rowElements.length; i += 1) {
    rows.push(collectTableRow(rowElements[i], state));
  }
  if (rows.length === 0) return "";

  var width = 0;
  for (var r = 0; r < rows.length; r += 1) {
    if (rows[r].cells.length > width) width = rows[r].cells.length;
  }
  if (width === 0) return "";

  var header = padRow(rows[0].cells, width, "");
  var separators = padRow(rows[0].separators, width, "---");
  var out = tableLine(header) + "\n" + tableLine(separators) + "\n";
  for (var body = 1; body < rows.length; body += 1) {
    out += tableLine(padRow(rows[body].cells, width, "")) + "\n";
  }
  return out + "\n";
}

function renderTableRow(row, state) {
  var collected = collectTableRow(row, state);
  if (collected.cells.length === 0) return "";
  return tableLine(collected.cells) + "\n";
}

function collectTableRow(row, state) {
  var cells = [];
  var separators = [];
  for (var i = 0; i < row.children.length; i += 1) {
    var cell = row.children[i];
    if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
    var text = renderInlineChildren(cell, state)
      .replace(/\s*\n\s*/g, " ")
      .trim()
      .replace(/\|/g, "\\|");
    cells.push(text);
    var align = cell.style ? cell.style.textAlign : "";
    separators.push(align === "center" ? ":---:" : align === "right" ? "---:" : align === "left" ? ":---" : "---");
  }
  return { cells: cells, separators: separators };
}

function padRow(row, width, filler) {
  var padded = row.slice();
  while (padded.length < width) padded.push(filler);
  return padded;
}

function tableLine(cells) {
  return "| " + cells.join(" | ") + " |";
}

/* ------------------------------------------------------------------------- */
/* inline                                                                    */
/* ------------------------------------------------------------------------- */

function renderInlineChildren(element, state) {
  var out = "";
  for (var i = 0; i < element.childNodes.length; i += 1) {
    out += renderInlineNode(element.childNodes[i], state);
  }
  return out;
}

function renderInlineNode(node, state) {
  if (!node) return "";
  if (node.nodeType === 3) return normalizeText(node.data || "");
  if (node.nodeType !== 1) return "";

  var element = node;
  if (shouldSkipElement(element)) return "";

  if (
    hasClass(element, "katex") ||
    hasClass(element, "katex-display") ||
    hasClass(element, "katex-error")
  ) {
    return renderMath(element);
  }

  var tag = element.tagName;
  if (tag === "BR") return "\n";
  if (tag === "IMG") return renderImage(element);
  if (tag === "INPUT") return "";
  if (tag === "CODE") return renderInlineCode(element);
  if (tag === "A") return renderLink(element, state);

  if (tag === "STRONG" || tag === "B") return wrapInline(renderInlineChildren(element, state), "**");
  if (tag === "EM" || tag === "I") return wrapInline(renderInlineChildren(element, state), "*");
  if (tag === "DEL" || tag === "S" || tag === "STRIKE") {
    return wrapInline(renderInlineChildren(element, state), "~~");
  }

  return renderInlineChildren(element, state);
}

function renderInlineCode(element) {
  var text = (element.textContent || "").replace(/\s*\n\s*/g, " ");
  if (!text) return "";
  var fence = "`".repeat(inlineFenceLength(text));
  var pad = /^`|`$|^\s|\s$/.test(text) ? " " : "";
  return fence + pad + text + pad + fence;
}

function inlineFenceLength(text) {
  var runs = text.match(/`+/g);
  var max = 0;
  if (runs) {
    for (var i = 0; i < runs.length; i += 1) {
      if (runs[i].length > max) max = runs[i].length;
    }
  }
  return max + 1;
}

function renderLink(element, state) {
  var text = renderInlineChildren(element, state).trim();
  var href = element.getAttribute("href") || "";
  if (!href || /^javascript:/i.test(href)) return text;
  var label = text || href;
  var target = /[\s()<>]/.test(href) ? "<" + href.replace(/>/g, "%3E") + ">" : href;
  return "[" + label + "](" + target + ")";
}

function renderImage(element) {
  var alt = element.getAttribute("alt") || "";
  var source = element.getAttribute("src") || "";
  if (!source) return alt;
  var target = /[\s()<>]/.test(source) ? "<" + source + ">" : source;
  return "![" + alt + "](" + target + ")";
}

function renderMath(element) {
  if (hasClass(element, "katex-error")) {
    var raw = (element.textContent || "").trim();
    return raw ? "$" + raw + "$" : "";
  }
  var annotation = element.querySelector('annotation[encoding="application/x-tex"]');
  var tex = annotation ? (annotation.textContent || "") : "";
  if (!tex.trim()) {
    var own = element.getAttribute("data-tex");
    tex = own || "";
  }
  tex = tex.trim();
  if (!tex) return "";
  var display =
    hasClass(element, "katex-display") ||
    !!element.querySelector(".katex-display") ||
    !!element.querySelector(".katex-display > .katex");
  return display ? "$$" + tex + "$$" : "$" + tex + "$";
}

function wrapInline(text, marker) {
  var trimmed = text.trim();
  if (!trimmed) return text;
  return marker + trimmed + marker;
}

/* ------------------------------------------------------------------------- */
/* helpers                                                                   */
/* ------------------------------------------------------------------------- */

function shouldSkipElement(element) {
  if (!element || element.nodeType !== 1) return false;
  if (SKIP_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute("data-clock")) return true;
  if (element.hasAttribute("data-code-block-banner")) return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  return false;
}

function hasClass(element, name) {
  return !!(element.classList && element.classList.contains(name));
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

function repeat(text, count) {
  var out = "";
  for (var i = 0; i < count; i += 1) out += text;
  return out;
}

function tidyMarkdown(markdown) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}
