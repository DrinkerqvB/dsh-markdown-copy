# dsh-markdown-copy

在 DSH Web 会话里用鼠标选中对话内容并按 `Ctrl+C`（或右键菜单“复制”）时，把选区还原成 **Markdown 源码**写入剪贴板。

DSH 的消息本来就是由 Markdown 渲染出来的：标题、列表、代码块（含语言）、GFM 表格、粗体/斜体/删除线、链接、KaTeX 公式等信息都保留在 DOM 里。本插件在浏览器 `copy` 事件（捕获阶段）里读取选区，遍历选中的 DOM 片段重新生成 Markdown，然后覆盖 `text/plain`。粘贴到编辑器或笔记里得到的是可继续编辑的 Markdown，而不是渲染后的纯文本。

## 行为

- 只处理选区完全落在对话流 `[data-chat-flow]` 内的复制操作。
- 输入框、多行编辑框、可编辑区域里的复制不受影响。
- 选区可跨多条消息，按文档顺序输出。
- 内置的“复制”按钮保持原样（DSH 自带的复制按钮输出的已经是 Markdown 源码）。

## 转换规则

| DOM | Markdown |
| --- | --- |
| `h1`–`h6` | `#` … `######` |
| `p`、块级容器 | 段落，之间空一行 |
| `ul` / `ol` / 嵌套列表 | `- ` / `1. `，嵌套缩进 2 空格，任务列表输出 `[x]` / `[ ]` |
| `blockquote` | 每行加 `> ` |
| `pre` / `.md-code-block` | 围栏代码块，语言取自代码块 banner 的语言标签 |
| `table` | GFM 表格，按单元格 `textAlign` 输出对齐行 |
| `strong` / `em` / `del` | `**` / `*` / `~~` |
| `code` | 反引号，按内容自适应围栏长度 |
| `a` / `img` | `[text](href)` / `![alt](src)` |
| `.katex` / `.katex-display` | `$…$` / `$$…$$`，TeX 取自 KaTeX 的 `application/x-tex` 注解 |
| `hr`、`br` | `---`、换行 |
| `[data-clock]` 操作行、代码块 banner | 跳过 |

## 安装

```bash
dsh plugin add https://github.com/DrinkerqvB/dsh-markdown-copy
```

安装到桌面客户端后刷新会话页面即可生效，无需重启。

## 开发

```bash
node build.mjs                        # 由 src/copy-markdown.js 生成 client.js
cd test && npm install && node serialize.test.mjs
```

`src/copy-markdown.js` 是纯函数脚本（无 import），`build.mjs` 会把它内联进 `client.js`（Client bundle 的 `window.__ModuleLoader__.load` 包装）。测试在 jsdom 里直接加载源码和 `client.js`，不依赖其他构建步骤。提交前请运行 `node build.mjs` 重新生成 `client.js`。

## 已知限制

输出是从渲染后的 DOM 重建的，因此渲染阶段已被消耗的转义反斜杠（例如正文里字面量的 `\*`）不会还原。得到的是语义等价的 Markdown，而不是与模型原文逐字节一致的内容；正文中的普通文字、结构、表格、代码和公式不受影响。

## English

Copies the selected DSH conversation content as **Markdown source** when you select text with the mouse and press `Ctrl+C` (or use the context-menu copy).

DSH renders messages from Markdown: headings, lists, code blocks (with language), GFM tables, bold/italic/strikethrough, links and KaTeX math are all preserved in the DOM. The plugin listens for the browser `copy` event in the capture phase, keeps the event only when the whole selection lives inside the conversation flow (`[data-chat-flow]`), serializes the cloned selection back into Markdown and replaces `text/plain`. Pasting into an editor or note app yields editable Markdown instead of rendered plain text.

- Selections that start or end outside the conversation flow, and copies inside inputs, textareas or contenteditable regions, are left untouched.
- Selections spanning several messages are emitted in document order.
- The built-in per-message copy button is untouched: it already writes Markdown.

Install with `dsh plugin add https://github.com/DrinkerqvB/dsh-markdown-copy`.

Reconstruction works from the rendered DOM, so escape backslashes already consumed by rendering (for example a literal `\*`) are not restored; the output is equivalent Markdown, not byte-exact source.

## License

[MIT](LICENSE)
