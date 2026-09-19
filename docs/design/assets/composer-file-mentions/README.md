# Reference images — the file-mention picker and the inline mention

Provenance for the files beside
[`../../composer-file-mentions.md`](../../composer-file-mentions.md). Five
groups: frames of **Codex Desktop** (1) and of **Codex CLI 0.147.0** (2, each
with a plain character grid beside it so a reader can check its columns without
OCR), stills from OpenAI's and Anthropic's own committed artwork (3-4), and what
is deliberately absent (5). Every file here was opened and looked at before it
was saved.

## 1. Codex Desktop (the Codex app) — CAPTURED, from a user's bug report

| File | What it shows | Source URL | Size |
| --- | --- | --- | --- |
| `ref-codex-desktop-at-file.png` | The Codex app, a project task, composer holding `@教案/最终版` as plain ink with one **file** candidate row above it: a green spreadsheet icon, `人工智能教学原理与算法_12次课程与助教分工_最终版.xlsx`, and the dim directory label `教案` trailing the name. | see below | 3024x1898 |
| `ref-codex-desktop-at-conversations.png` | The same app and composer with `@最终版`: **eight conversation candidates** in the same menu, the first carrying the selected fill, the list clipped at its own top edge. | see below | 3024x1898 |
| `ref-codex-desktop-at-file-row.png` | The first frame's candidate row + composer band, **cropped 1:1** (ImageMagick `-crop 1500x330+560+1530`), so the ink and the pill can be read at native resolution. | crop of the first | 1500x330 |
| `ref-codex-desktop-at-conversation-rows.png` | The second frame's candidate list, **cropped 1:1** (`-crop 1500x600+560+1280`). | crop of the second | 1500x600 |

**Source.** Both full frames are attached to OpenAI's own bug thread,
[`openai/codex` issue #45879](https://github.com/openai/codex/issues/45879)
("Codex App: @ filename-only search shows conversations, while a directory prefix
reveals the matching file", opened 2026-09-16; the two images are in comment
`5692995595` as GitHub user-attachments), and mirrored on the OpenAI developer
forum at
`https://community.openai.com/t/macos-codex-app-filename-search-shows-only-conversations-directory-prefix-reveals-the-file/1398013`,
which is where I fetched them from:

| File | Fetched from |
| --- | --- |
| `ref-codex-desktop-at-file.png` | `https://us1.discourse-cdn.com/openai1/original/4X/9/f/7/9f7ca1c65e342df6ca4589f6727d7b131dee09e9.png` |
| `ref-codex-desktop-at-conversations.png` | `https://us1.discourse-cdn.com/openai1/original/4X/6/3/c/63c11df59dda0d24024664d1f9fb433743a1a76e.png` |

Both were downloaded with a browser `User-Agent` and the forum as referer; the
CDN answers `403` to a bare request.

**The frames are of a shipped build, and the thread names it**: app
**26.908.70816 (build 9275)**, bundle id `com.openai.codex`, macOS 27.0, arm64.
They are a *user's* screenshots rather than the vendor's, which is worth stating
plainly — see § 5.

**Render geometry**, because numbers in the design document are read off these
frames: both are **3024x1898**, i.e. 1512pt at the 2x factor a Mac display uses,
which is the assumption behind every CSS-px figure here (**device px ÷ 2 = CSS
px**). Measured on the frames: candidate row pitch **57 px = 28.5
CSS px**; the leading type icon **27 px = 13.5 CSS px**; the selected pill's fill
**`#F2F3F3`** against the block's **`#FEFEFE`**; the field's rounded top edge
between menu and field a ~5 CSS px pale band of **`#EDEDED`–`#F0F0F0`** (and that
edge is the only thing between them — the menu has no panel edge and no shadow);
the candidate row spans `x = 743 → 2200` against the block's `734 → 2209`.

## 2. Codex CLI 0.147.0 — CAPTURED, my own capture

`ref-codex-01-composer.png` … `ref-codex-06-deeper.png`, with a matching
`.txt` beside each holding the plain character grid of that frame.

Driven in a real pty at **110x34** through a VT emulator that keeps per-cell
colour, then rendered to SVG and PNG. The rig is `/tmp/mention-ux-ref/shoot.py`
(throwaway, not committed): `pty.fork` + `pyte.Screen`, `TERM=xterm-256color`,
`COLUMNS=110`, `LINES=34`, `NO_COLOR` removed, one `SIGWINCH` via `TIOCSWINSZ`
so the application paints at the size it is told it has. Keys are fed on a
timer; the frame is dumped after each settle.

Render geometry, because every number in the design document that is quoted off
these frames depends on it: **cell 8.7 x 18.0 px, pad 14 px**, so the image is
`110 * 8.7 + 28 = 985` wide and `34 * 18 + 28 = 640` tall, and grid row `r`
has its baseline cell at `y = 14 + 18r`. That is what makes "the composer row
did not move" a measurement rather than an impression: the composer's cell is
grid row 22, `y = 410.0`, in all four frames that carry it.

| File | What it shows |
| --- | --- |
| `ref-codex-01-composer.png` | A trust-hooks dialog. Kept only because it is the boot state the later frames come from; it carries no mention UI. |
| `ref-codex-02-dismiss.png` | The composer with **no picker open**: a single `›` row with the placeholder `Summarize recent commits` and, one blank row below it, the composer's own status row (`gpt-5.6-sol default · /private/tmp/…`). Its composer sits at grid row 28 rather than 22, and that is **not** a picker moving it: the update banner above the composer is gone in this frame, so the whole screen has re-flowed. This frame is therefore evidence about the *closed* state's shape (a `›` row with a status row under it), and is not comparable with 03-06 for position. |
| `ref-codex-03-at-open.png` | Bare `@` typed. The picker is up with **8 rows**, no border and no fill, each row a name in primary ink, a description in dim ink and a right-aligned `Plugin` tag; the selected row carries a `>` marker; the footer is `enter insert · esc close · ←/→ switch search modes` with right-aligned mode labels where the active one is bracketed and accented (`[All Results]`). |
| `ref-codex-04-filesystem.png` | The `no matches` state: the picker is still **open** and paints one quiet row, `no matches`, at grid row 24 — the composer is still at row 22. This is the frame the direction's "hold a row, never close" rule is copied from. |
| `ref-codex-05-filter.png` | `@src`: fuzzy matching, and a mixed list — `src` (`Dir`, parent `./`), `app.tsx` (`File`, parent `src/`), `components` (`Dir`, parent `src/`), then three files whose parent column reads `src/components/`. So the parent column is relative to the listing, and the search descends into a matched directory. |
| `ref-codex-06-deeper.png` | `@src/com`: `components` (`Dir`, `src/`) and its four children (`File`, `src/components/`). The filtered list is 4 rows and the footer has moved up with it. |

Frames 03-06 are the ones the design direction cites. Two of them together
settle the height question that frame 04 alone cannot: the picker's own box
**does** shrink when the list shrinks (its footer is at grid row 33 in
`03`, row 31 in `05`, row 29 in `06` and row 26 in `04`), and the **composer
never moves** (row 22 in all four). The property worth copying is therefore
"the picker keeps its presence and never takes a row from the field", not
"the picker keeps its height".

## 3. ChatGPT desktop — the vendor's own committed stills

| File | What it shows | Source URL | Size |
| --- | --- | --- | --- |
| `ref-chatgpt-plugin-directory.webp` | The plugin directory: the app's own window with macOS traffic lights and a `chatgpt.com/plugins` address field, a New chat / Library / Projects / Scheduled / Plugins / More sidebar, and a two-column list of plugin rows each with icon, name, one-line description and a trailing `+`. The place a `@`-mentionable plugin comes from — **not** a composer frame. | `https://learn.chatgpt.com/codex/get-started-with-work/plugins.webp` | 1540x1000 |
| `ref-chatgpt-composer-attachment.webp` | ChatGPT Work, whole frame. The composer's placeholder is **`Do anything. @ to use plugins`**; its control row holds a `+` on the left and the model/intelligence control (`5.6 Medium`) on the right; and a file object in the message flow is rendered as a **card** (icon, name, `Spreadsheet · XLS`, trailing `Excel ▾`). | `https://learn.chatgpt.com/codex/get-started-with-work/comparison-spreadsheet.webp` | 1540x988 |
| `ref-chatgpt-composer-band.png` | The composer band at 1:1 (`-crop 1310x185+20+795`), so the placeholder copy is legible. Reads **grayscale** because the band it crops is achromatic. | crop of the above | 1310x185 |
| `ref-chatgpt-attachment-card.png` | The file card at 1:1 (`-crop 1310x110+20+365`). | crop of the above | 1310x110 |

## 4. Claude surfaces — CAPTURED stills, fetched from the projects' own assets

| File | What it is | Source URL | Origin |
| --- | --- | --- | --- |
| `ref-claude-code-demo-composer.png` | Frame 400 of 414, extracted from the project's own committed demo. The CLI composer as a single `>` row inside one low-contrast edge, with a quiet status row (`demo (demo)`) beneath it. 1552x992. | `https://raw.githubusercontent.com/anthropics/claude-code/main/demo.gif` | anthropics/claude-code, `README.md` |
| `ref-claude-code-vscode-composer.jpg` | The VS Code extension's interface as committed to the docs: explorer, editor, and the chat panel whose composer reads `Queue another message…`. 2500x1155. | `https://mintcdn.com/claude-code/-YhHHmtSxwr7W8gy/images/vs-code-extension-interface.jpg` | Claude Code docs, `vs-code` |
| `ref-claude-desktop-mention-row.png` | A **sent** `@` mention in the Claude Desktop app's Code tab, cropped to the user row at 1:1 (740x50): `tell weekly-digest we renamed users.name to display_name`. | `https://mintcdn.com/claude-code/N3yEaTYPXMXFrF6k/images/whats-new/cross-session-messaging.mp4`, frame 5 at 1 fps | Claude Code docs, `whats-new/2026-w32` |
| `ref-claude-desktop-mention-row-zoom.png` | The same crop at 300%, for the ink comparison. | as above | as above |
| `ref-claude-desktop-agent-label.png` | The other Claude element captured here: the agent label `user-profiles` sitting on a pane divider — a filled, saturated rectangle with inverted ink. 300x60 at 400%. | as above | as above |

The mention row's provenance claim is checkable rather than asserted: every
pixel of the cropped row is achromatic. Read back at 8-bit with ImageMagick's
pixel dump, the crop's 37,000 pixels hold **210 distinct colours and every one
of them has r = g = b** (the dozen largest: `#262626`, `#373737`, `#383838`,
`#363636`, `#282828`, `#343434`, `#393939`, `#333333`, `#2B2B2B`, `#292929`,
`#3A3A3A`, `#323232`, `#303030`, `#313131`), in a frame that carries saturated
blue elsewhere. So the mention is not a token of another colour — it is **the
words around it**, in a filled row rather than a chip.

## 5. What is not here

**No pixel anywhere in this set shows a file mention rendered as an inline
chip** — not in Claude's surfaces, and not in the Codex app's own `@` menu, whose
file candidate is a *row* (leading type icon, name, trailing dim directory label),
whose selected row is a filled pill, and whose composer text stays plain ink. Nor
is there an image of an **accepted** mention in either desktop app: the Codex
frames have the menu open and the token still plain in the field, and Claude's
captured sent row is a *session* mention in a filled row rather than a file
mention with a chip. That is a finding, not a gap, and § 2.7 of the design
document states it in full: the inline-chip treatment cannot claim either
desktop app as precedent, and the direction argues it from `docs/branding.md`
instead.

**The vendor has committed no screenshot of the Codex app's composer with its
`@` menu open.** The two such frames here are a user's, from the bug thread
above; § 2.1 of the document names everything that was searched before that was
asserted.

Nothing was captured from `claude.ai` or from `claude.com/docs`: the browser
tool's origin approval for `claude.ai` was raised and *not* granted during this
pass (the operator was away from the keyboard), so that origin is **BLOCKED**
here and no claim in the document rests on it. `raw.githubusercontent.com`,
`code.claude.com` and `mintcdn.com` were reachable, which is why every Claude
fetch above comes from Anthropic's own committed assets. On the Claude side the
desktop composer is therefore **DESCRIBED from the docs, not captured**:
`code.claude.com/docs/en/desktop` documents the `+` attachment button and
`@mention files`, `academy.claude.com` documents the `+` menu and the folder
added under the message box, and neither page (nor its HTML twin) carries a
screenshot of the composer — only brand logos. The other OpenAI-domain assets
searched (docs artwork directories, the changelog, the app download/marketing
pages) yielded no composer-mention frame either.

No image here is a mock of the recommended direction. The direction is not
rendered; § 7 of the document says so and gives the geometry predictions
instead.
