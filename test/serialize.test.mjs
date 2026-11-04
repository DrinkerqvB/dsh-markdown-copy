import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../src/copy-markdown.js", import.meta.url), "utf8");
const serializeSelectionMarkdown = new Function(
  source + "\nreturn serializeSelectionMarkdown;"
)();

const clientSource = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

function domWith(html) {
  return new JSDOM(
    `<!doctype html><html><body><div data-chat-flow=""><div class="column">${html}</div></div></body></html>`
  );
}

function serializeAll(dom) {
  const { document } = dom.window;
  const container = document.querySelector(".column");
  const range = document.createRange();
  range.selectNodeContents(container);
  return serializeSelectionMarkdown(range);
}

function serializeRange(dom, mutate) {
  const { document } = dom.window;
  const range = document.createRange();
  mutate(range, document);
  return serializeSelectionMarkdown(range);
}

test("headings, paragraphs and inline markup", () => {
  const dom = domWith(`
    <h2>标题</h2>
    <p>Hello <strong>bold</strong>, <em>em</em> and <code>inline code</code>.</p>
    <p>Second <del>gone</del> line.</p>
  `);
  assert.equal(
    serializeAll(dom),
    ["## 标题", "", "Hello **bold**, *em* and `inline code`.", "", "Second ~~gone~~ line."].join("\n")
  );
});

test("nested and ordered lists", () => {
  const dom = domWith(`
    <ul>
      <li>alpha</li>
      <li>beta<ul><li>nested</li></ul></li>
    </ul>
    <ol start="3"><li>three</li><li>four</li></ol>
  `);
  assert.equal(
    serializeAll(dom),
    ["- alpha", "- beta", "  - nested", "", "3. three", "4. four"].join("\n")
  );
});

test("task list", () => {
  const dom = domWith(`
    <ul class="contains-task-list">
      <li class="task-list-item"><input type="checkbox" checked disabled>done</li>
      <li class="task-list-item"><input type="checkbox" disabled>todo</li>
    </ul>
  `);
  assert.equal(serializeAll(dom), ["- [x] done", "- [ ] todo"].join("\n"));
});

test("fenced code block with language banner", () => {
  const dom = domWith(`
    <div class="md-code-block" data-line-numbers data-code-wrap>
      <div data-code-block-banner>
        <div class="infostring">js</div>
        <div class="action"><button>复制</button></div>
      </div>
      <div data-code-block-content>
        <pre><code><span class="line"><span>const x = 1;</span>
</span><span class="line"><span>console.log(x);</span>
</span></code></pre>
      </div>
    </div>
  `);
  assert.equal(
    serializeAll(dom),
    ["```js", "const x = 1;", "console.log(x);", "```"].join("\n")
  );
});

test("code fence grows when the code contains backticks", () => {
  const dom = domWith(`<pre><code>A fence: \`\`\`</code></pre>`);
  assert.equal(serializeAll(dom), ["````", "A fence: ```", "````"].join("\n"));
});

test("card toolbar language becomes the fence info string", () => {
  const dom = domWith(`
    <div class="md-code-block" data-line-numbers data-code-wrap>
      <div class="_header_1pq26_10" data-code-block-banner>
        <div class="_heading_1pq26_23">
          <span class="_language_1pq26_30">python</span>
        </div>
        <div class="_actions_1pq26_43"><button aria-label="复制"><svg></svg></button></div>
      </div>
      <div data-code-block-content>
        <pre><code><span class="line">print(1)</span>
</code></pre>
      </div>
    </div>
  `);
  assert.equal(serializeAll(dom), ["```python", "print(1)", "```"].join("\n"));
});

test("localized code label is not used as a fence language", () => {
  const dom = domWith(`
    <div class="md-code-block">
      <div data-code-block-banner>
        <div class="_heading_1pq26_23"><span class="_language_1pq26_30">代码</span></div>
      </div>
      <div data-code-block-content><pre><code><span class="line">x</span>
</code></pre></div>
    </div>
  `);
  assert.equal(serializeAll(dom), ["```", "x", "```"].join("\n"));
});

test("links and images", () => {
  const dom = domWith(`
    <p>See <a href="https://example.com/a">the docs</a>.</p>
    <p><img src="/tmp/a.png" alt="plot"></p>
  `);
  assert.equal(
    serializeAll(dom),
    ["See [the docs](https://example.com/a).", "", "![plot](/tmp/a.png)"].join("\n")
  );
});

test("blockquote", () => {
  const dom = domWith(`
    <blockquote><p>quote <strong>bold</strong></p><ul><li>item</li></ul></blockquote>
  `);
  assert.equal(serializeAll(dom), ["> quote **bold**", ">", "> - item"].join("\n"));
});

test("horizontal rules survive", () => {
  const dom = domWith(`
    <p>above</p>
    <hr>
    <p>below</p>
  `);
  assert.equal(serializeAll(dom), ["above", "", "---", "", "below"].join("\n"));
});

test("gfm table", () => {
  const dom = domWith(`
    <table>
      <thead><tr><th>a</th><th>b</th></tr></thead>
      <tbody><tr><td>1</td><td>2 | 3</td></tr></tbody>
    </table>
  `);
  assert.equal(serializeAll(dom), ["| a | b |", "| --- | --- |", "| 1 | 2 \\| 3 |"].join("\n"));
});

test("gfm table alignment comes from cell styles", () => {
  const dom = domWith(`
    <table>
      <thead><tr>
        <th style="text-align: left">a</th>
        <th style="text-align: center">b</th>
        <th style="text-align: right">c</th>
      </tr></thead>
      <tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody>
    </table>
  `);
  assert.equal(
    serializeAll(dom),
    ["| a | b | c |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"].join("\n")
  );
});

test("katex annotations become TeX", () => {
  const dom = domWith(`
    <p>formula <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span> end</p>
    <span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">ab</span></span></span>
  `);
  assert.equal(serializeAll(dom), ["formula $x^2$ end", "", "$$\\frac{a}{b}$$"].join("\n"));
});

test("message action rows are ignored", () => {
  const dom = domWith(`
    <div class="turn-tail">
      <div class="markdown"><p>answer</p></div>
      <div class="actions" data-clock="end">
        <span class="timeEnd">12:34</span>
        <button aria-label="copy"><svg></svg></button>
      </div>
    </div>
  `);
  const { document } = dom.window;
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(".turn-tail"));
  assert.equal(serializeSelectionMarkdown(range), "answer");
});

test("partial selection keeps only the selected words", () => {
  const dom = domWith(`<p>Hello world</p>`);
  const markdown = serializeRange(dom, (range, document) => {
    const text = document.querySelector("p").firstChild;
    range.setStart(text, 6);
    range.setEnd(text, 11);
  });
  assert.equal(markdown, "world");
});

test("selection across messages keeps block order", () => {
  const dom = domWith(`
    <div class="row"><div class="markdown"><p>first</p></div></div>
    <div class="row"><div class="markdown"><p>second</p></div></div>
  `);
  assert.equal(serializeAll(dom), ["first", "", "second"].join("\n"));
});

test("copy listener converts chat selections and leaves other selections alone", () => {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <p id="outside">outside text</p>
      <div data-chat-flow=""><div class="column"><div class="markdown"><p>Hello <strong>world</strong></p></div></div></div>
    </body></html>`,
    { runScripts: "outside-only" }
  );
  const { window } = dom;
  const { document } = window;

  let definition;
  window.__ModuleLoader__ = { load(value) { definition = value; } };
  window.eval(clientSource);
  assert.equal(definition.id, packageJson.name);
  const plugin = definition.factory(() => {
    throw new Error("the client bundle must not require() anything");
  });
  plugin.apply({ effect(run) { return run(); } });

  function copySelection(select) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    select(selection);
    const event = new window.Event("copy", { bubbles: true, cancelable: true });
    const data = {};
    event.clipboardData = { setData(type, value) { data[type] = value; } };
    document.dispatchEvent(event);
    return { data, prevented: event.defaultPrevented };
  }

  const selected = copySelection((selection) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".markdown p"));
    selection.addRange(range);
  });
  assert.equal(selected.data["text/plain"], "Hello **world**");
  assert.equal(selected.prevented, true);

  const outside = copySelection((selection) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#outside"));
    selection.addRange(range);
  });
  assert.equal(outside.prevented, false);
  assert.deepEqual(outside.data, {});

  const collapsed = copySelection((selection) => {
    const range = document.createRange();
    const text = document.querySelector(".markdown p").firstChild;
    range.setStart(text, 2);
    range.collapse(true);
    selection.addRange(range);
  });
  assert.equal(collapsed.prevented, false);
});
