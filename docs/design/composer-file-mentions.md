# The inline file mention and its picker

Design direction for the operator's ask: the composer grows an `@` file
reference — typed `@` opens a picker over files and folders, accepting a row
inserts a literal `@src/app.py` token, and on submit each token resolves so the
file's content reaches the model. A graphical composer can do what a terminal
cannot, so the version here is **not** a raw token: a mention is rendered as a
chip **inside the composer's own text, where it sits in the sentence**, and the
picker searches with real suggestions rather than a prefix filter.

Author: designer subagent (local-operator-ui, lopdev team). Every number below
is read from a file in this tree, decoded from a captured frame, or computed
from the twelve palettes in `src/renderer/src/styles/themes.generated.css`. § 2
says which references are pixels I captured and which are text I read.

Status: **design direction, implementation not included.** The coder implements
against this document. The direction is **not rendered** — § 7 says so plainly
and gives falsifiable geometry predictions in place of an after frame.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
evidence, window modes, release mechanics), and
`docs/design/composer-suggestions.md` (the direction that fixed the composer
band this one has to live inside). Line citations are against this checkout's
tree except where a frame's own head is named.

**Docs only.** Nothing here changes product source. The coder implements; this
document is the direction.

**The backend half is in review, not landed**: `damianvtran/local-operator#1220`
(`feat/at-references`, head `af70c1b0d` when this was written). The grammar and
the limits quoted in § 1 come from that branch, and the UI half must not assume
it has merged.

---

## 1. What is there now, measured

The composer is a box on a band. A picker over it is not a new kind of object in
this app — the slash popup has been one for a while — so the numbers below are
the ones a second popup has to agree with, plus the two the chip has to be drawn
inside.

| Thing | Value | Source |
| --- | --- | --- |
| Composer box classes | `mx-auto flex w-full flex-col border border-control bg-surface`, `box-border transition-colors duration-fast ease-out-quart` | `message-input.tsx:620-622` (`COMPOSER_BOX`) |
| Box radius / padding / gap, ≥550px column | `rounded-frame` (**16px**), `p-4` (**16px**), `gap-3` (**12px**) | `message-input.tsx:2462` |
| Box radius / padding / gap, small view | `rounded-md` (**10px**), `p-2` (**8px**), `gap-2` (**8px**) | `message-input.tsx:2462` |
| Box ground | `bg-surface`; the band it sits in paints nothing of its own and inherits the column's `canvas` | `message-input.tsx:621`, `:3029-3043` |
| Box positioning context | `relative` — "the slash popup anchors above this box without shifting it" | `message-input.tsx:2464-2465` |
| Box height, ≥550px column | **≈111.7px**, derived: 32 (`p-4`) + 33.7 (field) + 12 (`gap-3`) + 32 (control row) + 2 (edge). Consistent with the **112px** the sibling direction records for a 1024px window | derived from the three rows below; `composer-suggestions.md` § 1 |
| Field classes | `w-full resize-none overflow-y-auto bg-transparent`, `text-ink outline-none placeholder:text-ink-dim`, `max-h-28 px-2 py-1.5 text-body` | `message-input.tsx:2543-2554` |
| Field line box | **21.7px** (`text-body` 14px × 1.55) | `styles/index.css:81-82` |
| Field content box | **33.7px** = 21.7 + `py-1.5` (12px); caps at `max-h-28` (**112px**) | derived; `message-input.tsx:2554` |
| Field horizontal inset | **8px** (`px-2`); **6px** (`px-1.5`) in the small view | `message-input.tsx:2553-2554` |
| Control row height | **32px** (`size-8`) at ≥550px, **28px** (`size-7`) in the small view | `message-input.tsx:2915` |
| Content measure | `CHAT_MEASURE` — full width below a 750px container, capped at **900px** above it | `chat-measure.ts:53` |
| Band horizontal inset | **24px** (`px-6`), the transcript's own `p-4` plus its 8px scrollbar gutter | `chat-measure.ts:107` |
| The band adds **no** bound | no `max-height`, no `overflow`, deliberately: any vertical clipping ancestor erases the popup | `message-input.tsx:3067-3088` |
| Popup anchor | `absolute bottom-full left-0 right-0 z-20 mb-1` — **4px** above the box, exactly the box's width | `slash-commands.tsx:846` |
| Popup shell | `overflow-hidden rounded-md border border-control bg-elevated shadow-lg` | `slash-commands.tsx:850-851` |
| Popup header / footer strip | `border-b`/`border-t border-hairline px-3 py-1 text-meta text-ink-dim` → **25.4px** = 17.4 (`text-meta` 12px × 1.45) + 8 (`py-1`) | `slash-commands.tsx:860`, `:946` |
| Popup row pitch | **36px** — `py-2` (16) plus a 20px line box, and the row region's max-height is a whole multiple of it on purpose | `slash-commands.tsx:114-123` |
| Popup visible rows | **6** (`MAX_VISIBLE_ROWS`); row region max-height = 6 × 36 = **216px** | `slash-commands.tsx:114`, `:871` |
| Popup row | `relative flex cursor-default items-baseline gap-3 px-3 py-2` | `slash-commands.tsx:899` |
| Popup selected row | `bg-accent-wash` **plus** a 2px accent bar (`before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent`), because the wash alone measures **1.000:1** against its own ground in `dune` | `slash-commands.tsx:900-911` |
| Popup row ink ladder | name `font-mono text-body-sm text-ink`; description `text-body-sm text-ink-muted`; trailing tag `text-meta text-ink-dim` | `slash-commands.tsx:959`, `:968`, `:973` |
| Popup empty state | one row, `px-3 py-2 text-body-sm text-ink-muted` ("No commands match.") | `slash-commands.tsx:874-877` |
| The popup is a **child of the box**, unportaled | `bottom-full` on the box's `relative` is the whole positioning story; the cost is that any ancestor with a vertical clipping context erases it | `message-input.tsx:2469-2489` |
| Suggestion stack below the box | `ghost` borderless chips, `rounded-sm px-2 py-1 text-body-sm text-ink-muted`, `justify-start`, 8px gap, **4** of them | `measured-suggestion-stack.tsx:118`, `:161`; `composer-suggestions.ts:110` |
| Tip row below the box | `mt-3` (12px) + `h-5` (**20px**), `text-body-sm text-ink-dim` | `message-input.tsx:2993-3002` |
| The stack's cap is **measured**, not stated | `suggestionStackCapFor(chips, stackTop, allowance)`, from the chips' own boxes, because "a cap in px cannot be aligned to a row by construction" | `suggestion-stack.ts:49-83` |
| `@` grammar (backend) | a token opens at a **boundary** `@` only; bare `@` opens the list on the cwd with `query=""`; the token may contain `/` and ends at whitespace only; `@"my file.txt"` is the quoted form; word-phase only; `user@host.com` never opens it | `sigils.py:97-178` (PR #1220) |
| `@` completion (backend) | `split_token` cuts `query` at the **last** `/` into `(dir_part, name_query)` — one directory scanned per segment, never the tree | `sigils.py:181-199` |
| What the model receives | `<operator-references>` appended to the user message, one `<reference path="…" typed="@…" lines bytes>` each; paths **relative to cwd**; >16,384 chars → head + heading outline + a real path and line range; >2 MiB → metadata only; a directory → a flat one-level listing | PR #1220 body |
| An unresolved token | **is not a reference** — byte-identical prose, sent silently; `glab mr create --assignee @me`, `user@host.com`, `a@b`, `$HOME`, `@pytest.mark` all pass through | PR #1220 body |
| The gate | deny-list (`.env`, `*.env`, `.pem`/`.key`/`.p12`, `.ssh`/`.gnupg`/`.credentials`/`.aws`/`.kube`) and anything resolving outside the workspace both force the same approval prompt `read` raises; symlinks resolve **first** | PR #1220 body |
| Resolution primitive that already exists | `probe-files(paths, cwd)` → `{input, resolved, exists, isFile, sizeBytes, mtimeMs, error}`, capped at **64** paths per call, resolving symlinks (`statSync`), distinguishing a fault from absence | `src/main/index.ts:1819-1852`; `shared/desktop-contract.ts:2138` |
| The one path rule | `~`, `~/`, and `cwd` applied **only** to a relative path, in the main process, because the renderer never guesses a home directory | `src/main/index.ts:104-123` |
| Existing file IPC | `read-file`, `read-file-bytes`, `probe-files`, `file-exists`, `directory-exists`, `select-directory`, `select-file`, `get-home-directory`, `open-file`, `save-file`, `show-item-in-folder` | `preload/index.ts:175-193`, `:551-580` |
| Directory listing IPC | **none exists.** `readdir` appears in the main process only inside update/venv/backend discovery | no match under `src/preload` or the renderer |
| How a programmatic edit writes the field | `setMessage(text)` + a `pendingCaret` ref + `field.setSelectionRange(at, at)` in a layout effect | `message-input.tsx:985-993` |
| The span-splice helper | `replaceSpan(value, start, end, replacement)`, with the separator rule worked out and documented for both directions, `""` included | `slash-token.ts:288-308` |

Two facts fall out of that table and both shape everything below.

**The picker's own budget is not free.** The popup is `bottom-full` from the
box and unportaled, so its height is spent out of the space between the box's
top edge and whatever clips — on an empty chat that is the column's
`overflow: hidden`. A second popup with a *larger* row budget would be a popup
whose top rows can be cut where the first one's are not.

**The chip has no markup to live in.** The composer's field is a plain
`<textarea>`. There is no element to put a class on, and the previous two
attempts to own that element's identity are contracts: `COMPOSER_TEXTAREA_SELECTOR`
is how the escape ladder defers to the composer by name (`composer-field.ts:25`),
and the box's focus ring is `has-[textarea:focus-visible]:…`, i.e. it is drawn
for *the field* (`message-input.tsx:639-641`). So a chip inside this text is a
rendering problem, not a styling problem — § 4 argues why that is the safe half
of the trade rather than the expensive one.

---

## 2. Visual references

**The reference surface the operator named is Codex Desktop** — the Codex app for
macOS/Windows — with **Claude Desktop** named second, and this section is ordered
to say so. 2.1 is the Codex app's own `@` menu. 2.2 is my capture of **Codex CLI
0.147.0**, kept as evidence of the *terminal grammar this harness's backend
mirrors* (PR #1220 is a TUI: the token grammar, the quoted form and the no-match
row come from the terminal) and explicitly **not** as the desktop UX to follow.
2.3-2.5 are three stills from Anthropic's own committed assets, 2.6 is Claude's
docs read as text, and 2.7 records what I could not reach and what I therefore
will not claim.

Everything here is either **CAPTURED** (a real image or a real render that I
fetched or drove, looked at and saved) or **DESCRIBED** (text from a doc or
source file, quoted, with no claim about pixels). Nothing is described as an
image I did not hold. Assets live beside this file in
`docs/design/assets/composer-file-mentions/`, whose `README.md` carries each
file's URL, size and render geometry.

### 2.1 Codex Desktop (the Codex app) — CAPTURED, and this is the surface the operator named

Two frames of the **Codex app for macOS**, each **3024x1898** — 1512pt wide at
the 2x factor a Mac display uses, which is the assumption behind every CSS-px
figure below — from OpenAI's own bug thread, `openai/codex` issue
[**#45879**](https://github.com/openai/codex/issues/45879), "Codex App: @
filename-only search shows conversations, while a directory prefix reveals the
matching file", opened **2026-09-16** and mirrored to the OpenAI developer
forum. The thread names the build it was reported against: **app 26.908.70816
(build 9275)**, bundle id `com.openai.codex`, macOS 27.0, arm64. That is what
makes them usable — a shipped build's own pixels, not a mock and not a marketing
render.

| File | What it shows |
| --- | --- |
| `ref-codex-desktop-at-file.png` (3024x1898) | A project task. The composer holds `@教案/最终版` as **plain ink — no token styling of any kind** — and directly above it, one candidate row: the spreadsheet `人工智能教学原理与算法_12次课程与助教分工_最终版.xlsx`, a green file-type icon leading, the dim directory label `教案` trailing the name. |
| `ref-codex-desktop-at-conversations.png` (3024x1898) | The same composer with `@最终版` typed into it: **eight conversation candidates** in the very same menu — the same `@`, a different resource type — the first carrying the selected fill, the list clipped at its own top edge. |

The two crops in the assets directory are **1:1** so the ink can be read at
native resolution — `ref-codex-desktop-at-file-row.png` (1500x330) and
`ref-codex-desktop-at-conversation-rows.png` (1500x600) — and the full frames are
there for the band around the composer.

**What the two frames settle.**

- **The `@` menu opens above the field, inside the composer's own column.**
  Measured at 2x: the candidate row spans `x = 743 → 2200` device px and the
  composer block below it `x = 734 → 2209`, so the row is the field's width, in
  the field's column, about **4.5 CSS px** in from the block's edge. The block's
  ground runs unbroken from above the row to the field; the only thing between
  the two is the field's own rounded top edge, a ~5 CSS px pale band measuring
  `#EDEDED`–`#F0F0F0`. There is **no panel edge and no shadow** around the menu,
  and no 4px gap of the kind a floating popup has.
- **A row is one line tall, and the active row is a filled pill.** Row pitch
  measured at **57 device px = 28.5 CSS px**; the pill is exactly one row (57
  device px) and its fill reads **`#F2F3F3`** (242/243/243 — neutral to within one
  unit) against the block's `#FEFEFE`. The leading resource-type icon measures
  **27 device px = 13.5 CSS px**.
- **A file row's parent is a dim label *trailing* the name**, not a right-aligned
  column: `…最终版.xlsx`, then after a gap `教案`, its directory. That is the
  second surface in this document whose parent column is **not** the Codex CLI's
  (2.2) — see 2.7 for why the difference is worth naming.
- **The menu is not a file picker.** Files and conversations are candidates in
  one `@` menu; the reporter's own ask is "a Files / Conversations filter or
  separate result groups". The vendor's changelog agrees in its own words
  (`learn.chatgpt.com/docs/changelog`): "**Added app and file @ mentions** in the
  automation composer" (Codex app 26.325/26.331/26.401, 2026-04-01, which also
  records "artifact cards for generated file citations"), and earlier "**Added
  skills to the @ menu** so you can insert them from the composer alongside other
  mentions" (26.318/26.319, 2026-03-19).
- **The composer's text stays plain.** `@教案/最终版` is ordinary ink in the
  field; the only chip-shaped object in either frame is the pill on a
  *candidate*. Nothing here shows an accepted mention rendered in the sentence.

**DESCRIBED — the desktop `@` grammar, quoted from the vendor's docs, with no
pixels claimed.** Read from `learn.chatgpt.com`'s own Markdown twins, whose index
is `/llms.txt` and whose condensed single file is `/docs/codex-manual.md`:

- `docs/plugins.md`, "Choose a specific plugin" (the app/web block): "Type `@` to
  invoke the plugin or one of its bundled skills explicitly."
- the manual's "Use plugins": "In ChatGPT, type `@` in the composer to choose a
  specific plugin."
- `docs/reference/commands.md`, "Start a chat with a plugin" — the closest thing
  to a *chip* the vendor documents anywhere. A plugin mention is written inline
  in composer text as a **labelled token carrying a target**:

  ```text
  [@Example](plugin://example@openai-curated) Summarize this document: https://example.com/document/123
  ```

  and it survives the `codex://new?prompt=…` deep link **URL-encoded whole**
  (`%5B%40Example%5D(plugin%3A%2F%2Fexample%40openai-curated)%20…`). So the
  documented desktop idiom for "this token is an object with a target, sitting
  in the sentence you are editing" is a *label plus a target in the text*, which
  is exactly the shape this feature wants — and the docs specify only the
  encoding, never a rendering.
- **Files are the app's other affordance, and the app says so itself.**
  `docs/app.md`, "Attach files": "You can upload or attach documents,
  presentations, spreadsheets, PDF files, images, and data exports." The
  changelog has pastes over 10,000 characters "become attachments on every
  ChatGPT plan", with "Select **Show in text field**" to move one back into the
  message. And the vendor's own committed screenshot of the ChatGPT desktop
  composer — `ref-chatgpt-composer-attachment.webp`, **1540x988**, from
  `learn.chatgpt.com/codex/get-started-with-work/comparison-spreadsheet.webp` —
  carries the placeholder **"Do anything. @ to use plugins"** under which sit a
  `+` control at the left of its control row, the model and intelligence level
  ("5.6 Medium") in that same row, and, in the message flow above, a file object
  rendered as a **card**: file icon, name, a `Spreadsheet · XLS` second line, a
  trailing `Excel ▾` open-in control (`ref-chatgpt-attachment-card.png`, 1310x110
  at 1:1). Both are true at once — this composer `@`-mentions files *and* attaches
  them — and neither is a chip in the sentence. `ref-chatgpt-plugin-directory.webp`
  (1540x1000) is the same vendor's plugin directory: the app's own window with
  macOS traffic lights and a `chatgpt.com/plugins` address field, a
  New chat / Library / Projects / Scheduled / Plugins / More sidebar, and a
  two-column list of plugin rows each with icon, name, one-line description and a
  trailing `+`. It is the *place* a `@`-mentionable plugin comes from; it is not
  a composer frame.
- **The composer's surroundings, each quoted before it is used** (the manual,
  unless noted): "Queued messages appear **above** the composer, where you can
  edit, reorder, send, or delete them"; "the goal progress row appears **above**
  the composer"; "choose a model and an intelligence level **from** the
  composer"; "In the ChatGPT desktop app, use the permissions control **beneath**
  the composer"; and in `docs/reference/commands.md`'s macOS table, "Search files
  **(Codex only)** — ⌘+P" and "Toggle file tree **(Codex only)** — ⌘+⇧+E", with
  ⌘+J, ⌃+` and ⌘+⇧+C carrying the same `Codex only` marker. The band around this
  app's composer is a stack of *its own chrome* — queue, goal, model, permission,
  file tree — which is why § 3.3's job is to add nothing to it.

**What is not here, and what I searched before saying so.** **The vendor has
committed no screenshot of the Codex app's composer with its `@` menu open.**
The only such frames I hold are the user's two above. Before asserting that I
went through: the whole `llms.txt` index and the consolidated
`docs/codex-manual.md` it points at (40,581 lines, reproducing every page in the
set); `docs/app.md`, `docs/reference/commands.md`, `docs/plugins.md` and
`docs/use-chatgpt.md` individually; the vendor's changelog; the committed artwork
under `learn.chatgpt.com/codex/get-started-with-work/`; and a web search across
release notes and the app's download/marketing pages (which returned launch
coverage and the two committed assets, no composer frame).

### 2.2 Codex CLI 0.147.0 — CAPTURED (my own capture, and evidence of the terminal grammar, not of desktop UX)

I drove the installed Codex CLI in a pty at **110x34** through a VT emulator
that keeps every cell's colour, and rendered the screen the application actually
painted to SVG and PNG. Geometry: **cell 8.7 x 18.0 px, pad 14px**, so a grid
row's cell sits at `y = 14 + 18r`. Six frames, with a plain character grid
beside each. What they settle:

- **The composer is one `›` row with no box of its own**, and the picker opens
  directly beneath it with **no border and no fill** (`ref-codex-03-at-open.png`).
- **One row of the picker is: name in primary ink, its parent in dim ink, a
  right-aligned type tag.** `File` / `Dir` in the capture; the selected row
  carries a `>` marker. The footer is
  `enter insert · esc close · ←/→ switch search modes`, with right-aligned mode
  labels where the active one is bracketed and accented (`[Filesystem Only]`).
- **The parent column is "where this thing lives", relative to the query.** The
  captured rows show it exactly: with `@src`, `src` reads `./` while `app.tsx`
  and `components` read `src/` and `button.tsx` reads `src/components/`
  (`ref-codex-05-filter.png`). A directory row's parent is therefore the
  *listing's* location, not the entry's.
- **Filtering is fuzzy, and it descends.** `@src/com` returns `components`
  (`Dir`) **and its four children** as rows, whose parent column then reads
  `src/components/` (`ref-codex-06-deeper.png`). `@src` likewise returns `src`
  plus files under it. So a matched directory contributes its children — a
  recursive-ish search, one level deep as observed.
- **The no-match state keeps the picker up.** With no match it paints one quiet
  `no matches` row and the composer does not move a pixel
  (`ref-codex-04-filesystem.png`).

That last one needs one correction to the brief that sent me looking, and it is
the correction the direction is built on. The picker does **not** hold its
height: its own footer climbs from grid row 33 to row 26 as the list shrinks
from 8 rows to one (`y` 608 → 482). What holds is the **composer**, which sits
at grid row 22 — `y = 410.0` — in all four frames that carry it. So the property
to copy is *the picker keeps its presence and never takes a row from the field*,
and the mechanism to copy is *a one-row notice instead of closing*. In this
application the second half comes free: the popup is `absolute bottom-full`, so
it is out of flow and **cannot** move the field however tall it grows. What must
be copied deliberately is the first half, because that is the half the terminal
gets wrong. PR #1220 records the TUI's own version of getting it wrong — "the
composer jumps one row when a prefix stops matching in a populated directory …
measured at **+17px** across one keystroke", because its no-match branch closes
the picker outright — and names the fix as holding a notice row. This direction
does not close the picker; `+0px`.

**One captured device does not transfer, and it is worth stating rather than
quietly dropping.** Codex CLI switches search modes on `←`/`→`. In a terminal
those keys are free at the composer; in a GUI textarea they move the caret, which
is what every user's fingers expect them to do there. § 3.2 therefore folds the
Codex CLI's three lists into one ranked list instead of giving it a mode
switcher.

**These frames are the terminal's, and the row anatomy in them is the CLI's.**
The `>` marker, the name / parent / right-aligned type tag row and the
`[Filesystem Only]` footer are Codex *CLI* furniture; the desktop app draws none
of them (2.1: a leading type icon, the name, a trailing dim directory label, a
selected fill and no marker). The frames stay in this document for one reason,
and it is not their layout: they are the only pixel evidence of *the grammar this
feature's backend mirrors* — PR #1220 is a TUI, and the boundary rule, the
whitespace-terminated token, the quoted form and the one-row no-match notice are
the terminal's. Anything below that reads "the Codex CLI" is that grammar;
anything that reads "the reference's arrangement" means this CLI's arrangement,
and § 3.2 already says where the app's own shell overrides it.

### 2.3 Claude Code, the CLI composer — CAPTURED

`ref-claude-code-demo-composer.png` — frame 400 of 414, extracted from the
project's own committed demo at
`https://raw.githubusercontent.com/anthropics/claude-code/main/demo.gif`. The
composer is a single `>` row inside one low-contrast rounded edge, with a quiet
status row (`demo (demo)`) beneath it, and **no inline token of any kind**. I
extracted the composer band at 2 fps (all 85 samples), ran OCR over every one of
them, and inspected five full frames spread across the 41-second demo: an `@`
never appears in any of it.

### 2.4 Claude Code in VS Code — CAPTURED

`ref-claude-code-vscode-composer.jpg` — the extension's interface as committed
to Claude Code's own docs (`mintcdn.com/claude-code/…/vs-code-extension-interface.jpg`,
2500x1155). Explorer, editor, and the chat panel whose composer reads
`Queue another message…` with an `Ask before editing` control and a send button.
Again: **no mention token, no chip.** (The editor tab reads `App.css @ src` —
that is VS Code's own "file at symbol" tab title, not a mention.)

### 2.5 Claude Desktop, the Code tab — CAPTURED (the pixel evidence that an accepted mention stays plain text)

`ref-claude-desktop-mention-row.png` and its 300% zoom, cropped from frame 5 of
`cross-session-messaging.mp4` in Claude Code's own docs
(`mintcdn.com/claude-code/…/whats-new/cross-session-messaging.mp4`, the
`whats-new/2026-w32` page). This is a real Claude surface rendering a real
mention:

```
›  tell weekly-digest we renamed users.name to display_name
```

`weekly-digest` is an `@` mention of another live session — the docs describe
exactly this: "when you type at least one letter after the `@`, Claude Code also
suggests your other live sessions on this machine". And it is rendered as
**plain text, in the same ink as the words around it, inside a filled row**. Not
a chip, not a token of another colour, no boundary: the crop's 37,000 pixels
hold 210 distinct colours and **every one has r = g = b**, in a frame that
carries saturated blue elsewhere.

The other Claude element captured here is the counter-example, and it is worth
one line because it is the *only* chip-shaped thing I found in a real Claude
surface: `ref-claude-desktop-agent-label.png` — the agent label
`user-profiles`, a filled saturated rectangle with inverted ink, sitting on a
pane divider. That is a **marker**, not an inline token: it is opaque, it
inverts its own text, and it lives on a rule rather than in a sentence.

### 2.6 DESCRIBED — what Anthropic's own docs say, with no pixels claimed

**Both Claude desktop affordances are documented, and neither is a chip.** Read
from `code.claude.com` and `academy.claude.com`'s own pages, quoted rather than
referenced at second hand (the Markdown twins of these pages carry no images at
all — I checked their HTML for committed screenshots and found only brand logos —
so this half of the Claude side is DESCRIBED, and no pixel claim rests on it):

- **The desktop app's composer has two ways to bring a file in, and both are
  theirs.** `docs/en/desktop` (the Code tab): "The **+** button next to the
  prompt box gives you access to file attachments, skills, connectors, and
  plugins";
  "**@mention files**: type `@` followed by a filename to add a file to the
  conversation context. Claude can then read and reference that file. @mention is
  not available in cloud or WSL sessions"; and "**Attach files**: attach images,
  PDFs, and other files to your prompt using the attachment button, or drag and
  drop files directly into the prompt." Its CLI-versus-Desktop comparison table
  then splits them by surface and by *rendering*: `@mention files` — CLI
  **"Text-based"**, Desktop "With autocomplete; local and SSH sessions only";
  `File attachments` — CLI "Not available", Desktop "Images, PDFs".
- **The non-Code desktop app uses the same two shapes.**
  `academy.claude.com/tutorials/navigating-the-claude-desktop-app`: "Under the
  message box, add a folder" for folder access, and "Start it from the plus menu
  in the message box" for a recorded skill. A `+` menu, under or in the message
  box — the same place the Code tab's `+` sits.
- `docs/en/interactive-mode`: `@` is "File path mention — Trigger file path
  autocomplete", and in cross-session sessions it also suggests your other live
  sessions "when you type at least one letter after the `@`" (v2.1.232+).
- `docs/en/common-workflows`: "Type `@` to open a path suggestion menu, then
  press Enter or Tab to accept the highlighted path and Enter again to send the
  message"; "Directory references show file listings, not contents"; "You can
  reference multiple files in a single message (for example, `@file1.js and
  @file2.js`)"; a directory reference pulls in that directory's `CLAUDE.md`.

So the desktop `@` is documented as a **path suggestion menu** whose accepted
result the docs call "Text-based" on the CLI and never describe as a chip on
either; files that are not mentioned are attachments, behind a `+`; and the word
"Text-based" is the docs' own. That agrees with every pixel above.

### 2.7 The finding: no inline chip precedent exists — and that is the honest headline

**No reachable surface — Claude's or OpenAI's, CLI or desktop — renders a file
mention as an inline chip, and the two desktop apps the operator named are part
of that negative rather than an exception to it.** I looked for one across: the
`anthropics/claude-code` repository's committed images (the only one is
`demo.gif`, whose 41 seconds I sampled at 2 fps and OCR'd); the VS Code
extension's committed docs screenshots; Claude Desktop's own committed
`whats-new` stills and videos (23 assets, 147 extracted frames, OCR'd for `@`);
the docs text for all 196 Claude Code pages, whose image inventory is 95 assets
and contains nothing named or shaped like a mention chip; and, on the OpenAI
side, the Codex app's own `@` menu (2.1), where a file candidate is a **row** —
type icon, name, trailing dim directory label — the active row is a **filled
pill**, a file elsewhere in the message flow is a **card**, and the composer's own
text stays plain ink. `claude.ai` is a **blocked origin** in this pass — the
browser tool raised its approval prompt and nobody was at a screen to grant it —
so no claim here rests on it either way.

So the direction below cannot say "chip, like Codex Desktop" or "chip, like
Claude". Three consequences, all deliberate:

1. **The inline-chip treatment is argued from `docs/branding.md`**, not from a
   borrowed illustration. § 3.1 and § 6 do that work with the contract's own
   floors, and § 7 says plainly that no after frame exists yet.
2. **The negative is informative rather than merely absent.** Every real
   surface that renders an accepted mention renders it as *text in the buffer*
   (Claude Desktop's sent row; Claude's own docs calling it "Text-based"; the
   Codex app's composer holding `@教案/最终版` as ordinary ink), and every real
   surface that renders something chip-like renders a **marker** or a **row** —
   the Codex app's selected pill and its per-row type icon, Codex CLI's `>` and
   its mode labels, Claude's `user-profiles` on its rule. The one documented
   object that *is* an inline labelled token with a target is Codex's
   `[@Example](plugin://…)` in composer text, and that is an **encoding**: the
   docs specify how it is serialised, never how it is drawn (2.1). The thing this
   application is being asked to do — an object that reads as one thing while
   remaining editable characters — has no precedent in either reference. That is
   exactly why § 3.1 spends its effort on *what the chip is derived from* rather
   than on how it is decorated.
3. **The Codex app's `@` menu is not file-only; this feature's is.** Documented
   in the changelog and visible in the frame (2.1): files, apps, conversations and
   skills are candidates in one menu, and a reporter's complaint is precisely that
   they share one list. This direction narrows to files deliberately. That is a
   *product* narrowing rather than a design one, and it belongs in the commit
   message next to the picker, so the next reader does not read the narrowing as
   an oversight and re-open the menu.

---

## 3. The recommended treatment

Three parts, one direction: **the chip is a rendering of the text and never a
thing stored beside it; the picker is the slash popup's shell with one phase and
a measured row budget; and neither of them moves the band.**

### 3.1 The chip: drawn behind the text, derived from the text

**Keep the `<textarea>`.** A `contenteditable` composer would break four
contracts at once, and each is load-bearing: `COMPOSER_TEXTAREA_SELECTOR` is how
the escape ladder defers to the composer by name and how `composerHoldsFocusUntouched`
asks whether the box holds focus (`composer-field.ts:25`, `:9-24`); the box's
focus ring is `has-[textarea:focus-visible]:outline-solid…` (`message-input.tsx:639-641`);
the field's growth cap is `max-h-28 overflow-y-auto` on the field itself
(`:2554`); and the paste-chip path reads the field's own `selectionStart`. The
app does have a rich-text editor — the canvas document (`wysiwyg-markdown-editor.tsx`,
TipTap) — and using it here would mean the composer is a document, which is a
different feature with a different review.

So the field stays a `<textarea>`, and the chip is composed of two layers:

**Layer 1, the mirror.** A `visibility: hidden` clone of the field's text inside
the box: same width, same class string, same text. It is never visible and
`aria-hidden`; its only job is to give `Range.getClientRects()` over the
grammar's token spans, so the fills can be measured from real text layout rather
than from a character-count estimate. The one structural rule, and it is the
`CHAT_MEASURE` pattern applied again: **the mirror and the field are styled by
ONE exported class constant**, so a later change to the field's type step cannot
leave the mirror behind.

**Layer 2, the fills.** Absolutely positioned, `pointer-events-none`,
`aria-hidden` divs in a sibling layer, drawn from the measured rects. One rect
per line fragment, so a token that wraps paints two fills.

| Property | Value | Why |
| --- | --- | --- |
| Fill role | **`bg-sunken`** | The app's existing recessed-small-object fill — the neutral badge, the tabs track, the table header, the skeleton bar, the avatar are all `sunken`. A reference is a thing the text pulls in from outside, so it recesses; and this is the only ground pair on `surface` that clears the perceptual aim with room to spare (§ 6). |
| Edge at rest | **none** | The fill is the boundary. See the fallback below before reaching for a line. |
| Radius | `rounded-sm` (**6px**) | Branding § 5: 6px is the control radius. The fill is 17.7px tall, so 6px is a corner and not a lozenge. |
| Fill height | **17.7px** = the 21.7px line box − 4px (2px top, 2px bottom) | 2px of inset each side leaves consecutive lines' fills **4px apart**, so a chip on line 2 cannot merge with a chip on line 1; and 17.7px still covers the field's ~16.5px glyph content box at 14px. |
| Fill width | the token run's measured width + **12px** (2 x 6px overhang) | The overhang is what makes the fill read as a container rather than as highlighting: it is wider than the glyphs at both ends. It is deliberately **6px and not 8px** — the field's own inset is `px-2` (8px) at ≥550px and `px-1.5` (6px) in the small view, so a mention at the very start of a draft paints inside the field at every size and reaches the field's inset edge with nothing to spare in the small view, never the box's own 16px padding. |
| Fill y | the line box's top + 2px | Derived from the same rect, so it is 8px below the field's top edge (its `py-1.5` plus the 2px inset). |
| Token ink | **unchanged** — the field's own `text-ink` | The glyphs are the textarea's. See § 4.2 for why that is a feature. |
| Scroll | the fill layer is translated by the field's `scrollTop` | The field is `overflow-y-auto` and caps at `max-h-28` (112px, about 5 lines). Past that the field scrolls itself, and a fill that does not scroll with it detaches from its own text. |
| Pointer | `pointer-events-none` on both layers, no `title`, no click target, no hover ground | A control inside a text field is a second interactive object inside the first, and it would owe a 3:1 boundary. The chip is text you can edit, so the pointer belongs to the field. |
| Accessibility | the field's `value` is the literal text; the chip adds nothing to the tree | A screen reader reads `@src/app.py` as the characters it is. That is the correct announcement, because that *is* the message. |

**The rule that makes it a chip: chip ⇔ the token resolves.** The decoration is
computed from the field's value on every change — a maximal span that (a) the
backend grammar recognises as an `@` token and (b) resolves to a path that
exists — and from nothing else. There is no chip object, no id, no parallel
list. Consequences, all of them wanted:

- A token typed by hand chips as soon as it is a real path. **The picker is
  never required to get a chip**: it is an accelerator over a grammar that works
  without it (PR #1220's own framing — "a phone user who types `@src/app.py`
  gets it expanded without a picker existing on that surface").
- A typo does **not** chip. It stays plain text, which is the truth: the backend
  sends an unresolved token verbatim and silently, and PR #1220 lists that
  silence as its limitation #1 — "no notices on the main submit path"; there is
  no channel back to the UI. On this surface the chip's *absence* is where that
  notice lives: the user can see, before pressing Enter, that `@src/ap.py` is
  prose rather than a reference. That is the one place the GUI can close a gap
  the terminal cannot, and it costs nothing.
- `user@host.com`, `glab mr create --assignee @me`, `$HOME` and `@pytest.mark`
  never chip, for two independent reasons: no boundary `@`, and no such path.
- The state distinctions the picker needs are all *derived*, so they cannot
  drift from what will happen at submit. § 5 gives them.

**Resolution is done by the main process, through `probe-files`.** It already
returns `exists`/`isFile`/`sizeBytes`/`mtimeMs` for up to 64 paths, it already
resolves symlinks with `statSync`, and it already applies the one path rule
including `~` and cwd-relative joining (`src/main/index.ts:117-123`,
`:1819-1852`). Nothing in the renderer may re-implement it: a second
implementation is exactly how the chip would disagree with the batch on submit
about which file `@src/app.py` names. The pass runs **only while the value holds
a grammar token** — the common token-free keystroke does no work at all — and
the spans are collected into one call behind a short debounce.

**The costed fallback, if the frame finds the fill too quiet.** One further
signal is available and it is not free: `border-hairline` on the `sunken` fill,
which is the badge's existing pair. It measures **ΔE00 4.09 at its worst**
(`localOperatorLight`), clear of the § 3 floor of 4.0 for a 1px rule — so unlike
the usual `hairline` temptation (1.30:1 on `surface`), this one is visible. Take
it only if a rendered frame shows the fill failing to group the token, and take
it as a design-round finding with the frame attached, because it puts a drawn
line on every mention in a sentence.

### 3.2 The picker: the slash popup's shell, one phase, a measured budget

**What it reuses from `SlashSuggestionsPopup`, deliberately and exactly**, so
that two popups over one field feel like one mechanism:

| Reused | Value |
| --- | --- |
| Anchor | `absolute bottom-full left-0 right-0 z-20 mb-1` on the composer box — 4px above it, exactly its width, unportaled, and therefore clipped by exactly the same ancestors as the slash popup and no others |
| Shell | `overflow-hidden rounded-md border border-control bg-elevated shadow-lg` |
| Scroller split | `overflow-hidden` on the shell, `overflow-y-auto` on the row region only, so the header and footer stay put and the region's height can be a whole multiple of the row pitch |
| Row pitch | **36px**: `px-3 py-2` with a 20px line box |
| Header / footer strip | `border-b`/`border-t border-hairline px-3 py-1 text-meta text-ink-dim`, 25.4px |
| Row anatomy | `flex items-baseline gap-3 px-3 py-2`; name `font-mono text-body-sm text-ink`; the dim long string `text-body-sm text-ink-muted`; the right-aligned short tag `text-meta text-ink-dim` |
| Selected row | the app's own: `bg-accent-wash` **plus** the 2px accent leading bar |
| Empty state | one row, `px-3 py-2 text-body-sm text-ink-muted` |
| ARIA and focus | `role="listbox"` + `role="option"` + `aria-selected`, the active row reached by `aria-activedescendant` from the textarea, which **keeps focus throughout**; `onMouseDown` `preventDefault`, act on `onClick` |
| The mouse | `onMouseEnter` sets the active row; a click picks the row under the pointer |

**What it must NOT inherit, because the two grammars differ.** `/` is a command
*at a position* — it opens at a boundary or line start, a recognised word
terminates and **claims** the rest of its line, and the caret then sits in one of
two mutually exclusive phases with a list each. `@` is a reference *anywhere* —
it opens at a boundary, may contain `/`, ends at whitespace, has no argument
phase and claims nothing. So:

- **No phase strip.** The slash popup's header names which list is up
  (`command`/`arguments`) because two lists with one geometry were
  indistinguishable (round 1 D3 / UX U3). A `@` token has one list, so nothing
  needs naming, and the header strip is free to do the job the file picker
  actually has: say **which directory** is being listed.
- **No ambiguity gate and no prefix extension.** Enter on a command row may
  *run* something, so `commandChoiceUnambiguous` + `sharedCommandPrefix` exist to
  stop a reflex second keystroke from putting the highest-blast-radius candidate
  into the buffer ready to run (`slash-contract.ts:92-172`). Writing a path has
  no blast radius, so Enter and Tab both apply the highlighted row,
  unconditionally, and there is nothing to extend to. The `chosenByHand` flag
  has no work to do either.
- **No argument phase**, so no `slashArgumentContext`, no `argumentWords`, and
  no name-list completion.

**What it must not become:** `PickerHost` (`pickers/picker-host.tsx`) is the
app's other list — a *dialog* with a search input, a form and a result strip. It
is the right shape for a `native_action` destination and the wrong shape here:
a dialog leaves the flow and takes focus, and this picker must never take focus
from the field the user is typing in. Its row vocabulary is still worth
matching: its `meta` is documented as "machine-voice trailing detail", which is
what this picker's tag and count are.

**The rows.**

```
src/components/                       <- header: the directory being listed
  components   src/             Directory
▪ button.tsx   src/components/        File   <- selected: accent wash + 2px bar
  card.tsx     src/components/        File
  dialog.tsx   src/components/        File
  enter inserts @src/components/button.tsx · esc closes          4 of 37
```

(The marker in that sketch stands in for the app's own selected-row treatment —
an accent-wash ground plus the 2px leading accent bar. It is **not** the Codex
CLI's `>` glyph; see the row below and § 9.)

| Property | Value | Why |
| --- | --- | --- |
| Header | the directory being listed, `font-mono` at the `text-meta` step, `text-ink-dim`, `truncate`, path on `title` | Drilling is disorienting without it, and the Codex CLI gives the *rows* a parent column while leaving the listing's own location implicit — which works in a terminal whose prompt shows the cwd and fails here, where the cwd chip is in the composer's control row and can be icon-only below a 240px column (`CHAT_CHIP_ICON_ONLY_PX`). |
| Name | `font-mono text-body-sm text-ink`, `shrink-0` | Same shape as the slash popup's own `/{label}`. The name is the thing being scanned. |
| Parent | `font-mono text-body-sm text-ink-muted`, `min-w-0 flex-1 truncate` | The Codex CLI's second column, at the role the slash popup already gives its long dim string (the desktop app instead *trails* the directory label after the name — 2.1 — which reads as a caption rather than a column and is not the shape this list uses). **Not** `ink-dim`: that pair measures **4.51:1** at its worst on `elevated` (`dracula`), 0.01 above the floor, and a new long string has no business starting there. |
| Tag | right-aligned, `text-meta text-ink-dim`, one word | `File` or `Directory`. Not `Dir` — the abbreviation is a terminal economy, and this app's own composer already says "Working directory". Not a lucide glyph: the row already carries two paths, and the tag answers the one question a path cannot. The **same slot** also carries `Needs approval`, which is the only place the picker can say *why* a row will ask (§ 5). |
| Column alignment | no fixed name column, plain `gap-3` | The Codex CLI pads its name column so the parent column starts at one x across rows. That pays when a search spans depths; in the common listing every row's parent is the same string, so it aligns one repeated value — and a fixed column cannot hold a long name, which is the field the user is scanning. |
| Selected row | the app's own wash + 2px accent bar; **no `>` marker** | The Codex CLI's marker exists because a terminal has no ground step worth using (the desktop app's marker is a filled row — 2.1). Adding one here would put two selection signals in one list, and the bar is already there for a measured reason (`slash-commands.tsx:900-911`: the wash alone is 1.000:1 in `dune`). |
| Footer, left | one line, read off **the active row**: `enter inserts @src/components/button.tsx` or `enter opens src/components`, then ` · esc closes` | The slash popup already reads its footer off the active row so the key and the row cannot describe different things. Here Enter means two different things depending on the row kind, which is exactly the case that footer pattern exists for. |
| Footer, right | `n of m`, `text-meta text-ink-dim`, only when the list overflows | The Codex CLI's right-aligned footer column, spent on the one fact a scrolled list cannot show: how much of it there is. |
| Visible rows | **measured**, `clamp(3, floor((boxTop − columnTop − 4 − chrome) / 36), 8)`, and the row region's max-height is that whole multiple of 36 | The row budget is not a taste call: the popup spends the space between the box's top edge and what clips, which is least on an empty chat at the app's minimum window. This is `suggestionStackCapFor`'s argument, ported — "a cap in px cannot be aligned to a row by construction" (`suggestion-stack.ts:19-27`) — with the same off-by-a-slice defect to avoid. 8 is the ceiling because the TUI's own `@` picker uses `MAX_VISIBLE_ROWS = 8` (`command_picker.py`), so the two surfaces agree; 3 is the floor so the picker is never a stub. |
| Total height at the ceiling | 2 (edge) + 25.4 (header) + 8 x 36 = 288 (region) + 25.4 (footer) = **340.8px** | Derived. At 8 rows the region is 72px taller than the slash popup's 216px, which is the one number to check on a frame at the minimum window (§ 5, "narrow window"). |
| Motion | none — no transition on the shell, no entrance | It opens instantly, like the slash popup, and branding § Motion reserves durations for things entering the screen with a reason. |

**Suggestions: three sources, one ranked list, no mode switch.** The Codex
CLI's `←`/`→` mode switcher is unavailable (2.2), and a section header per source
would make the picker a menu again. So the sources are folded into one ranking:

1. **The scope** — the entries of `cwd + dir_part`, exactly as the backend's
   `split_token` defines it: one directory, fuzzy-matched on the part after the
   last `/`. This is the primary source and it is why the picker cannot offer
   something the grammar cannot express.
2. **Recents** — paths accepted as mentions in this workspace, ranked **above**
   equal-scoring scope entries. This is evidence about this operator rather than
   a guess, and it is the reason `@` is fast in a repo you have been working in.
3. **Common** — a named, bounded pool (`README.md`, `package.json`, `AGENTS.md`,
   `src/`, `docs/`, `tests/`) contributing a **boost** to entries that exist in
   the scope, not extra rows. A boost keeps dedup structural: there is never a
   row twice, and never an entry the directory does not have.

Ranking within that: exact name, then prefix, then subsequence-fuzzy; then
directories before files at equal score; then the shorter name; then
alphabetical. Ordering must be **stable across keystrokes** — a list that
reorders on every character is unreadable — so the tiebreak chain ends in a
total order and no sort may depend on enumeration order.

**The descend rule, taken from the Codex CLI and bounded.** A directory that
matches the name query contributes its own children as rows (2.2: `@src/com` →
`components` *and* `button.tsx`). Keep it, bounded to **one level**, the children
of the **top two** matching directories, appended after the directory row that
matched. The parent column then reads `src/components/`, which is the same
information the Codex CLI shows and the reason its parent column exists. Without
a bound the picker is a tree walk on every keystroke; with it, the cost is one
listing per matched directory in the top two, which is a small constant.

**Accepting a row: two writes, one of them load-bearing.**

- A **file** row writes `@src/components/button.tsx ` — **with a trailing
  space**. The space is not cosmetic: `at_token` ends the token at whitespace, so
  the space is what closes the list and puts the caret outside the token, and it
  is the same mechanism the slash popup's completion documents for its own
  trailing space (`slash-completion.ts:33-41`). Without it, the picker would stay
  open on the token just inserted.
- A **directory** row writes `@src/components/` — **no trailing space**, keeping
  the token open so the picker stays up and drills into it. `split_token` reads
  that as `("src/components/", "")`, which is exactly the empty-query listing of
  that directory. Drilling is therefore not a mode: it is what the grammar
  already does when you type a slash.

Both writes go through `replaceSpan(value, start, end, replacement)` — the
existing pure helper, whose separator rule is already worked out for exactly the
"token that opened the buffer" case (`slash-token.ts:262-308`) — and both land
through the existing caret mechanism (`message-input.tsx:985-993`).

**One picker at a time, and it is the grammar that guarantees it.**
`slashContext` needs a boundary `/`; `at_token` needs a boundary `@`. `@src/a/b`
contains a `/` that is not preceded by whitespace, so no slash token claims it;
`/team @foo` puts the caret in the slash *argument*, and the `@`'s own token ends
at the space before it. There is no state where both lists are up, which is
fortunate because they anchor to the same 4px gap. **The implementation must not
add a rule for it** — a tiebreak written by hand is a rule that can disagree
with the grammar; § 10 keeps this as a thing to test rather than to code.

### 3.3 The band: what the picker does to what is already there

`composer-suggestions.md` fixed the band's composition top to bottom — greeting,
composer box, 12px, a 20px tip row, 24px, the suggestion stack — and that band
now ships. This feature opens *inside* the composer, so the question is not
whether the picker fits on the screen but what it does to those parts.

```
  greeting            covered by the picker while it is open — not suppressed
  ┌ picker ───────────────────────────────────────────────┐
  │ header: src/components/                               │  25.4px
  │ rows: 8 x 36px max, the region scrolls                │  288px
  │ footer: enter inserts … · esc closes      4 of 37     │  25.4px
  └───────────────────────────────────────────────────────┘
  4px                 mb-1 on the picker
  composer box        rounded-frame 16px, p-4, border-control bg-surface
  12px                mt-3
  tip row             20px, ink-dim                  (unchanged, uncovered)
  24px                mt-6
  suggestions         borderless chips               (unchanged, uncovered)
```

| Question | Answer | Why |
| --- | --- | --- |
| Where does the picker sit? | **Above the box**, `bottom-full` + `mb-1` | The anchor the slash popup already uses. It is also the only direction with room: below the box are the tip row and the suggestion stack. |
| Does the tip row yield? | **No.** It is not covered — it is *below* the box — and it keeps rotating while the picker is open | Suppressing it would change the splash's height, and the suggestion stack's cap is computed as `fixed = splash.height − stack.height` (`measured-suggestion-stack.tsx:64-66`). A row appearing and disappearing inside that subtraction re-wraps the chips and moves the band under the user's cursor on the keystroke that opened the picker. The row is suspended while a draft is held, which is the existing and sufficient rule. |
| Does the suggestion stack stay? | **Yes, untouched** — and it is not merely uncovered, it is *outside the picker's arithmetic*: the popup is `absolute`, so it contributes nothing to `splash.getBoundingClientRect().height`, and the cap's single pass keeps its inputs and its answer | The stack's invariants (`suggestion-stack.ts:49-83`) are not touched by this feature at all. That is the whole reason to anchor a popup rather than grow the band. |
| Is the greeting suppressed? | **No** | Same reason as the tip row: it is fixed composer content inside the splash, and unmounting it on the keystroke that opens the picker would move everything below it. On an empty chat the picker covers the greeting — which is what an overlay does, and the picker's own ground keeps its rows legible over it. |
| Does the band grow? | **No**, in any state | The picker is out of flow. The band's height is bit-identical with the picker open and closed, which is the falsifiable form of this claim and is checked in § 7. |
| The scroll-lockstep risk | the fill layer tracks `scrollTop`; the picker does not need to | The picker is anchored to the box, not to the caret or the token. That is the one thing the Codex CLI's arrangement cannot tell us (a terminal has no caret to track) and it is the safer of the two: a caret-anchored popup has to re-place itself on every arrow key, every wrap and every resize, and it can cover the line being typed. The Codex app's own answer is neither — it opens the menu inside the field's block (2.1) — and the anchor above the box is kept because the slash popup already owns it, not because the reference does. |

---

## 4. Why this is subtle, in structural terms

"The chip should feel like one object" is not a value a coder can implement.
Four structural facts carry it, and each is countable.

1. **The chip has no state of its own, so it cannot be out of sync.** It is
   recomputed from the field's value on every change: grammar span + resolution,
   nothing else. There is no chip object to update when the user types inside it,
   none to orphan when they delete half of it, and none to duplicate when they
   paste the same mention twice. The measurable form: **for any value, the set of
   painted fills equals the set of grammar tokens in that value that
   `probe-files` says exist**, and a test can assert that equality on strings.
2. **Nothing about the chip can move the text.** The fills are out-of-flow
   divs in a layer that is not the field. The strongest version of this, and the
   reason the design is a drawing rather than a styled span: a span with
   horizontal padding *inside the mirror* would shift the mirror's own text
   against the field's and desync every glyph after the first token. Measuring
   rects and drawing rectangles cannot do that, and the failure mode when it
   goes wrong is a missing fill — quiet and local — instead of doubled or
   displaced text in the app's primary input.
3. **The chip's grouping is one ground step and one overhang, not a boundary.**
   The chip owes the contract nothing at 3:1 because it is not a control and its
   fill is not a control's edge; what it must do is *read* as one object, which
   is a perceptual step, and § 6 measures it. Compare the sibling direction's
   argument: the suggestion chips *stopped* drawing boundaries because the
   composer box is the band's one boundary. An inline token inside that box is
   inside the one boundary that already exists.
4. **The picker adds no row to any layout and takes no row from any.** Out of
   flow, in the one direction with room, with a row budget measured from the
   space that actually exists. The +17px the terminal paid for this feature is
   `+0px` here, and that is structural rather than lucky.

### 4.1 What the atomic delete promises, and where the promise stops

The brief's question is precise: what happens when the caret is at a chip's right
edge, what a partial deletion does, and whether a chip can be split by clicking
into its middle. The answers fall out of the chip having no state:

- **Caret at the right edge, Backspace.** The whole token goes, in one keystroke
  and one undo step, through the existing `replaceSpan(value, tokenStart,
  tokenEnd, "")`. That helper's own documented separator rule applies unchanged
  and is *not* mine to re-invent: the **preceding** separator is preferred (so
  `fix @a.py now` → `fix now`, one space), and the following one is taken only
  when the token opens the buffer (`@a.py now` → `now`), which is exactly the
  case that would otherwise leave a leading space (`slash-token.ts:262-287`,
  worked there in four examples). Reusing it is also what keeps the inline slash
  gesture and the mention delete from disagreeing about what "remove a token"
  means.
- **Caret at the left edge, Delete (forward).** Same splice, the other
  direction. The promise is symmetric because the user cannot see a reason for it
  not to be, and asymmetry is a bug report waiting to happen.
- **A partial deletion.** Any *selection* that intersects the token, or a caret
  strictly inside it, deletes ordinary characters by the browser's own rules.
  The decoration is recomputed and simply stops being a chip the moment the
  remaining span is no longer a token or no longer resolves. This is not a
  degraded state to design; it is the honest one, and it is visible: the fill
  disappears as the path stops being real, which is the same fact the submit
  path acts on.
- **Clicking into the middle.** The caret lands inside the token, which per the
  grammar means the token is *active* — so the picker opens on it, filtered by
  the text left of the caret, and accepting a row rewrites the whole span
  (`replaceSpan`). Clicking into a chip cannot "split" it, because there is only
  ever one decoration per maximal token span and a span is not divisible by a
  click. If the caret ends up between two would-be chips, the grammar has
  already decided that the second `@` opens no token: `@a@b` is one unresolvable
  span and two `@`s of plain text, not two chips.
- **Where the promise stops: whitespace is ordinary text.** With
  `@a.py ` typed, the caret is *after* the space, the token is closed, and a
  Backspace deletes the space. The atomic delete applies when the caret is at the
  token's start or end — not when it is on the separator. Two keystrokes rather
  than one, and neither deletes anything the user could not see.

### 4.2 Why the field's ink is the chip's ink, and what that buys

The mirror cannot repaint the field's glyphs, so the chip's text keeps the
composer's own `text-ink`. That reads as a limitation and is actually the reason
this design is safe:

- The chip's ink is measured against its own fill by the same floors as any
  other text: `ink` on `sunken` is **9.06:1 at its worst** across the twelve
  themes (§ 6). A chip whose ink stepped down for quietness would be walking
  toward the floor for no reason.
- **Machine voice is not spent here, and does not need to be.** Branding § 4
  gives paths to monospace, and the picker spends it properly: its rows are
  `font-mono`, both columns, which is where the user is reading paths as data. A
  monospace run *inside* the field would change the run's advance widths, and
  with them the caret's position inside the token — the caret is drawn by the
  field from the field's metrics, and a mirror that renders different advances
  puts the caret in the wrong cell. Paths-in-prose get their machine voice in the
  transcript, where a reference resolves to a real file (§ 7 of the contract:
  "a trace line names the action in the user's terms and the object in
  monospace"); the composer is where the user is writing, and the chip is
  punctuation in that sentence, not a datum.
- The one distinction the fill *can* carry is the one that matters most and
  needs no words: **this reference will ask for approval** (§ 5).

---

## 5. States and edges

The brief names twelve states. Each gets the treatment, the number, and — where
the state's answer depends on the backend — the source of the fact. Items 1-4 are
the picker's own list; 5-12 are the chip; 13-15 add the edits and the window,
which the brief's list leaves implicit but the coder cannot.

### The picker's list

**1. No matches (picker).** The picker **stays open** and paints one notice row
at the shared empty-state geometry: `px-3 py-2 text-body-sm text-ink-muted`,
**36px**, `No files match "zz".` The row region's max-height collapses to that one
row (36px, not the 288px budget), and the shell shrinks with it — the composer
does not move, and not merely because the popup is out of flow: the frame that
proves it is `ref-codex-04-filesystem.png`, where the picker's footer climbs 126px
and the composer stays at `y = 410.0` (§ 2.2). Copy distinguishes this from the
next state, because PR #1220 asks for exactly that: "the fix is to hold a notice
row, which would also let the copy distinguish 'this directory is empty' from
'nothing here matches `zz`'".

**2. Empty directory.** Same geometry, different string: `This folder is
empty.` A different *fact* from state 1, so a different sentence — not a
different treatment. Both hold the picker up; neither closes it.

**3. A long list.** The region shows the measured budget (8 rows at any normal
size = **288px**, pitch 36px) and scrolls; the browser's own scrollbar is the
scroller, as in the slash popup, and the shell's `overflow-hidden` keeps the
header and footer pinned. The active row is scrolled into view with
`block: "nearest"` — never `"center"`, which would move a list that already
contains the selection. The max-height is a whole multiple of 36 so the region
never rests on a half-row slice (`slash-commands.tsx:116-123`). The footer's
right column says `4 of 37`.

**4. A deep path.** The header strip states the directory being listed
(`font-mono`, `text-meta`, `text-ink-dim`, `truncate` at 25.4px) and the full
path is its `title`. The row's parent column is relative to the listing — the
captured Codex CLI's rule, where `src` reads `./` and `button.tsx` reads
`src/components/` — so the two together always say where you are and where each
row lives. A path too long for the parent column truncates from the **right**
(`truncate`, keeping the nearest segments), because the tail is what
distinguishes siblings.

### The chip

**5. A path outside the workspace.** The chip paints with the
**needs-approval** fill: `bg-warning-wash` instead of `bg-sunken`, otherwise
identical (same 17.7px, same 6px radius, same 6px overhang, same ink, same no
edge). Rationale and numbers in § 6: the step is a **hue** step, ΔE00 **5.37**
at its worst, where a luminance ratio would be 1.06:1 and would fail — which is
the one place ΔE00's chroma axis is doing work a contrast ratio cannot
(branding § 3). The chip asserts nothing about the decision; the approval gate
stays where it is, at submit, and nothing in the composer may raise a card while
the user is typing.

**6. A deny-listed path.** The same chip as 5, and deliberately **one state
rather than two**: "this needs approval" is one fact about one gate, and two
treatments for one outcome would be two severities for one condition (the
defect branding § 9 names in the status slot). The row's tag is where the
difference can exist, because a tag can hold words: `Needs approval`.
*Source of the fact, and the honest limit:* cwd-containment is pure and the
renderer has the cwd; the deny list is backend state in `references.py`. The
renderer must **not** re-spell the pattern list — a second spelling is how the
chip and the gate would come to disagree about `.ENV`. § 10 makes this the first
open item, with the two acceptable shapes.

**7. A directory mention.** Identical chip to a file mention. A directory is a
legal reference (the backend sends a flat one-level listing), the user chose it
deliberately, and a second chip treatment would be a second kind of reference
where the backend has one. The distinction lives where it is actionable: the
picker's tag says `Directory`, and the drill contract (§ 3.2) is what makes a
directory row behave differently at the moment of choosing.

**8. A file too large to expand.** Identical chip. A 20 MB file is a perfectly
good reference — it gets metadata only over 2 MiB and a shaped head plus
outline over 16,384 chars — so there is nothing wrong to signal, and a "large
file" chip would be inventing a wart. The number to hold: the thresholds are the
backend's, and the UI may not use them as chip conditions.

**9. A symlink.** Identical chip when it resolves inside the workspace; the
needs-approval chip when it resolves outside, because the backend resolves the
link **first** and then judges the target. No symlink glyph and no separate
state: the link's resolution is the only thing that changes what happens, and
marking the link *as a link* would be marking something the model never sees.

**10. Two adjacent mentions.** The grammar makes true adjacency impossible: a
token opens only at a boundary, so `@a.py@b.py` is one unresolvable span and not
two chips. The reachable case is `@a.py @b.py`, and its rule is that **the fill
covers the token and never the separator**: each chip is its own rectangle with
its own 6px overhang, separated by the space's own advance — about 4.5px at 14px
— plus 12px of overhang, i.e. about **16.5px of clear ground between the two
fills** (the space itself is unpainted). The measurement to check on a frame is
that the fills never touch.

**11. A mention at the very start or end of the text.** Identical treatment. At
the start, the 6px overhang lands inside the field's own inset (`px-2` = 8px at
≥550px; `px-1.5` = 6px in the small view, where it reaches the inset's edge
exactly and stops) and never reaches the box's 16px padding — which is why the
overhang is 6px and not 8px. At the end, the same holds against the field's right
inset, and the caret sits **outside** the fill (the fill ends at the token's last
glyph plus overhang; the caret is drawn by the field at the token's boundary),
which is what makes the atomic Backspace read as "delete this whole thing".

**12. A mention typed by hand, without the picker.** It **does** read as a chip —
that is the rule, not an exception: the chip is derived from grammar plus
resolution, and the picker is only an accelerator (§ 3.1). And its converse is
the more valuable half of the same rule: a hand-typed path that does **not**
resolve is not a chip, so `@src/ap.py` looks like what it will be — prose, sent
verbatim, with no notice from the submit path (PR #1220's limitation #1). The
chip's presence and absence are the notice.

### The edits and the window

**13. Partial deletion / click-into-the-middle.** § 4.1. Backspace at the token's
end or Delete at its start takes the whole token (one step, one undo entry,
through `replaceSpan`); a selection that intersects it, or a caret inside it,
edits ordinary characters and the chip stops being a chip as it stops resolving;
clicking the middle puts the caret inside the token, which per the grammar
*opens the picker on it* with a query built from the text left of the caret.

**14. The picker's own loading and error states.** The first listing of a
directory is async. Reuse the slash popup's treatment rather than inventing one
— its `argument-phase-loading-and-error` frame is the committed record of what
that looks like (a loading row holding the region's height, and an error row in
the same `text-body-sm text-ink-muted` geometry). An unreadable directory is
`Could not read this folder.` plus the reason, in the app's own register
(branding § 8: what happened, what it means). Never a spinner where a row is
expected: the region holds its rows, so there is nothing to replace.

**15. Narrow window and the row budget.** The gate is the column, not the
window: below a 550px column the whole empty-chat prompt is gone, but the
**composer remains** (it is the app's primary control) and so does the picker —
at `rounded-md p-2` geometry and `px-1.5` in the field. So the row budget is
computed from the space that exists rather than assumed, per § 3.2. The two
things to check on a frame at 800x600: the picker's top edge is below the
column's top edge (nothing sliced off), and the row count has fallen from 8
rather than the shell being pushed off the bottom.

---

## 6. Twelve themes and the contrast floors

Computed from the twelve palettes in `src/renderer/src/styles/themes.generated.css`.
Worst case across the twelve, for every pairing this direction introduces:

| Pairing | Where it is used | Worst of twelve | Floor | Verdict |
| --- | --- | --- | --- | --- |
| ΔE00(`surface`, `sunken`) | the chip's fill against the composer box's own ground | **3.75** (`iceberg`) | aim ≥ 2 (§ 3) | clears with **1.75 of headroom** |
| `ink` on `sunken` | the chip's glyphs, over its own fill | **9.06:1** (`iceberg`) | 7:1 | clears |
| ΔE00(`surface`, `warning-wash`) | the needs-approval chip's fill | **5.37** (`obsidian`) | aim ≥ 2 | clears; the separation is chromatic, and the luminance ratio for the same pair is only **1.06:1**, which is why ΔE00 is the instrument |
| `ink` on `warning-wash` | the chip's glyphs on the needs-approval fill | **8.39:1** (`tokyoNight`) | 7:1 | clears |
| `border-control` on `canvas` | the picker shell's edge against what is behind it | **3.34:1** (`iceberg`) | 3:1 | clears; the same pairing the slash popup already ships |
| `ink` on `elevated` | picker row name | **7.64:1** (`tokyoNight`) | 7:1 | clears; identical triple to the slash popup's own row |
| `ink-muted` on `elevated` | picker row parent column and the right-aligned tag | **5.54:1** (`dracula`) | 4.5:1 | clears, with 1.04 of headroom |
| `ink-dim` on `elevated` | picker header and footer chrome, and the count | **4.51:1** (`dracula`) | 4.5:1 | clears by **0.01** — see below |
| ΔE00(`sunken`, `hairline`) | the costed edge fallback (§ 3.1) | **4.09** (`localOperatorLight`) | ≥ 4 for a 1px rule (§ 3) | clears, barely; hence a fallback and not the default |

Four consequences worth stating plainly.

**The chip's ground is the composer box's, and that is the number that decides
it.** The chip sits on `surface`, so the step that matters is
`surface → sunken` at **3.75**. `elevated` on `surface` would have been the
other candidate and it measures **2.15** at its worst (`iceberg`) — over the aim
of 2, but with 0.15 of headroom where `sunken` has 1.75, and `sunken` is
additionally the role the app already uses for recessed small objects. Both
directions are defensible; this one has the margin. **The pairing also depends
on the box keeping `bg-surface`**: against `canvas`, the same fill step collapses
to **1.23** in `obsidian`, because `sunken` against `canvas` is the weak step
branding § 3 already records for the loading bars. That is the pin the contract
needs (§ 10).

**The chip gets no `CONTROLS` row, and that is a statement rather than an
omission.** The control-triple loop computes `fill ? p[c.fill] : ground` and requires
`max(fillEdge, borderEdge) ≥ 3:1` (`contrast-contract.mjs:1769`). The chip's
fill is a ground step — 1.0-1.3:1 against the ground behind it — so it fails that
assertion **by design**: it is not a control, it is not the sole boundary of one,
and the composer box is still the band's one `border-control` edge, exactly as
`composer-suggestions.md` left it. What the chip needs is the other mechanism
this file already provides: a **`PERCEPTIBLE` row** for the step —
`{ name: "mention chip fill step", role: "sunken", on: ["surface"], minDeltaE: 2.0 }`,
which is that table's own shape (`contrast-contract.mjs:729`; rows are
`{name, role, on, minDeltaE}`, as its suggestion-chip entry at `:819-822` shows),
consumed at `:1802-1813`; measured worst **3.75**, a second
for the needs-approval step (`warning-wash` on `surface`, measured worst
**5.37**), and a **call-site pin** in `STRUCTURAL_CALL_SITES`
(`contrast-contract.mjs:872`; the row shape is `{what, file, must, why}` and the
match is order-sensitive and fails closed) on the fill class string, so that a
later edit to the chip's ground fails a gate instead of quietly flattening it. Two pins, not one: the fill string and the box's
`bg-surface`.

**`ink-dim` on `elevated` is a pre-existing 0.01, and I am not making it
worse or better by halves.** The picker's header and footer use the exact classes
the slash popup already uses (`text-meta text-ink-dim` on `elevated`), at 4.51:1
in `dracula`. It passes; it is already shipped in that popup's header, alias
column and trailing tags; and a file picker whose chrome differed by one ink step
from the slash popup's chrome would be a second treatment for one idea. So it
stays, it is **disclosed here**, and the recommendation is that if it is ever
moved it moves in both components in one commit. What the picker does not do is
extend the same thin margin to the **new long string**: the parent column takes
`ink-muted` (5.54), the role the slash popup's own description column already
uses.

**Nothing else moved.** No role is added to the contract, no palette is touched,
and the suggestion chips, the tip row and the band's cap are untouched by this
direction.

---

## 7. Before / after intent, and what I could not render

**Before — committed frames, not taken by me this pass.** The band is already
photographed in this repository at the head that shipped the tip row and the
borderless chips: `docs/evidence/chat-composer-band/` (its `empty-chat/`,
`column-floor/`, `long-labels/`, `draft-held/`, `small-view/` and `chip-hover/`
states across all twelve themes, plus the `before/` half at `origin/main`). The
slash popup over the same field is photographed in
`docs/evidence/chat-slash-completion/` (`command-phase`, `argument-phase-*`,
`inline-mid-draft`, `argument-phase-narrow-composer`). Neither set was re-taken
and no number in § 1 depends on a fresh run.

**After — not rendered.** I could not render the direction: a real frame of it
requires an isolated `local-operator serve` backend plus a browser harness, or
an edit to product source to add the stories, and this task is docs only. **No
after frame exists and none is claimed.** The coder renders it; the design round
then judges it against the predictions below, which is what they are for.

**Predicted geometry** (arithmetic from § 1's measured values; the token widths
are what the frame decides):

| | Before | After | Delta |
| --- | --- | --- | --- |
| Composer box, ≥550px column | 111.7px | 111.7px | **0** |
| Band height with the picker open vs closed | — | identical in every state | **0px** |
| Chip fill height | — | **17.7px** (line box 21.7 − 4) | — |
| Chip fill overhang | — | **6px** each side | — |
| Gap between two adjacent chips' fills | — | **≈16.5px** (a space at 14px, about 4.5px, plus 12px of overhang) | — |
| Picker gap to the box | — | **4px** (`mb-1`) | — |
| Picker shell at 8 rows | — | **340.8px** | — |
| Picker region, 8 rows | — | **288px**, scrolling | — |
| Picker region, no matches | — | **36px**, one notice row, picker still open | — |
| Composer position across all of those | — | unchanged | **0px** |

Four predictions to check on the frame, all falsifiable:

1. **The fills sit on their glyphs.** With a draft longer than the field's
   own 5-line cap (`max-h-28` = 112px, so the field is scrolling itself), every
   fill's left and right edges are within 1px of its token's first and last
   glyph, at the 900px measure and at a 550px column. A fill that drifts means the mirror and the
   field are not styled by the same class string (§ 3.1) — and the check is not
   "does it look right" but a readback of the fill's rect against the token's
   run measured in the field.
2. **A wrapped token paints two fills with one visual gap, 4px, between
   lines.** This is the prediction most likely to be wrong: if the rects come
   back 21.7px tall rather than the glyph box, the two fills merge into one
   rectangle with no line gap.
3. **The band is bit-identical open and closed.** Same splash height in both
   states, at 1380x872 and at 800x600. If it is not, something in the picker is
   in flow.
4. **At 800x600 the picker's top edge is inside the column**, and the row count
   has fallen below 8 rather than the shell being pushed off the bottom.

**Before/after claim the frames must carry:** the mention renders as a chip *in
the sentence* in both positions it is asked to work (mid-draft and final), the
picker opens over the composer without moving the band by a pixel, and the
no-match state holds the picker with a one-row notice where the terminal's own
version closes it and moves the field 17px.

---

## 8. Copy

Sentence case, no emoji, no jargon noun where an everyday noun works (branding
§ 8). Every string below is either a chip state that has no words, or a picker
string that names the object it is about.

**The picker's chrome.**

| Slot | String | Why |
| --- | --- | --- |
| Header | the directory being listed, e.g. `src/components/` | A path is machine voice and carries no sentence. It states where the list came from; it does not ask a question. |
| Footer, active row a file | `enter inserts @src/components/button.tsx` | Names the exact token, not the act: the user can see what Enter will write. |
| Footer, active row a directory | `enter opens src/components` | "Opens", not "inserts", because the row does something else. The difference is why this line is read off the active row. |
| Footer, escape | ` · esc closes` | One clause, appended, not a second line. The Codex CLI's `enter insert · esc close · …` shape, minus the mode labels this picker does not have. |
| Footer, right | `4 of 37` | Machine voice, three tokens, no sentence. Only when the list overflows. |
| Empty directory | `This folder is empty.` | A fact about the folder. Says nothing about matching, because nothing was searched for. |
| No matches | `No files match "zz".` | A fact about the query, with the query quoted. A different sentence because it is a different fact (PR #1220 asks for exactly this split). |
| Loading | `Reading this folder…` | One clause, `text-body-sm text-ink-muted`, holding the region's own geometry. Not a skeleton: the region has rows or it does not, and there is nothing to replace. |
| Unreadable directory | `Could not read this folder.` + the reason from the IPC | What happened, then what it means. An error that only quotes an exception is unfinished (§ 8). |
| Tag, `File` row | `File` | Type tag, right-aligned. |
| Tag, `Directory` row | `Directory` | The app's own noun for it — the composer already says "Working directory" — rather than the terminal's `Dir`. |
| Tag, gated row | `Needs approval` | The only place the picker can say why choosing this row will raise a card. Two words, and it is the row's own business. |

**The chip's words: none, on purpose.** A chip is a fill behind text the user
wrote. Giving it a label, a tooltip or a badge would be adding words to a
sentence the user is composing, and it would double the token's length in the
buffer's own visual weight. The two facts a chip carries are carried by its fill
(§ 5.5-6) and by its absence (§ 3.1).

**The recents and common pools are not copy** — they are existing filenames,
rendered as they are. A pool entry that does not exist in the directory
contributes nothing, so the picker can never show a name the user cannot choose.

---

## 9. What not to do

- **Do not make the composer a `contenteditable`** or a rich-text editor. It
  breaks the field identity the escape ladder and the focus hand-off ask for by
  name, the box's `has-[textarea:focus-visible]` ring, the field's own growth
  cap, and the paste-chip path (§ 3.1).
- **Do not style a span with padding inside the mirror.** The mirror's glyphs
  would shift against the field's from the first token onward, and the failure
  is doubled or displaced text in the app's primary input. Measure rects; draw
  rectangles.
- **Do not paint a `border-control` edge on the chip.** It is not a control, it
  is not the sole boundary of one, and it would put a 3:1 edge behind every
  mention in a sentence — the loudness the sibling direction spent a whole round
  removing from the suggestion chips.
- **Do not reach for `hairline` as the chip's edge by default.** It is the
  costed fallback and only that: 4.09 ΔE00 is at the 1px-rule floor, so it is
  visible, which is why it is a real option — but it is one drawn line per
  mention, so it needs a frame that shows the fill failing first.
- **Do not give the chip a pointer affordance.** No click target, no hover
  ground, no tooltip, no `title`. A control inside a text field is a second
  interactive object inside the first, and the pointer belongs to the field.
- **Do not store chips.** Anything that keeps a list of mention objects beside
  the text will drift from the text on the first paste, undo or IME composition,
  and the drift is invisible until submit.
- **Do not close the picker when nothing matches, and do not shrink the composer
  for it.** The terminal's own version of that defect is recorded at **+17px
  across one keystroke**; the notice row is the fix, and it is what
  `ref-codex-04-filesystem.png` shows working.
- **Do not suppress the greeting, the tip row, or the suggestion stack while the
  picker is open.** They are fixed composer content inside the splash, and the
  stack's cap is computed from that height; unmounting any of them re-wraps the
  chips and moves the band under the cursor.
- **Do not give the picker a mode switcher, a section header per source, or a
  `>` selection marker.** `←`/`→` are the caret's in a textarea; one ranked list
  is one list; and two selection signals in one list is one too many.
- **Do not add a tiebreak for "both pickers open".** The two grammars cannot
  both claim one caret; a hand-written rule is a rule that can disagree with
  them.
- **Do not re-spell the deny list in the renderer.** One spelling, in the module
  that owns it.
- **Do not build a second popup shell.** Reuse the slash popup's anchor, shell,
  strips, pitch, row inks and ARIA; the differences are the ones § 3.2 names and
  no more.
- **Do not bump any version.** Per this window's release discipline,
  `package.json` stays at the released version on the branch.

---

## 10. Open items for the coder and the review rounds

1. **Where does "needs approval" come from?** Two acceptable shapes, and one
   forbidden one. *(a)* Extend the existing probe with a boolean computed in the
   module that owns the deny list, so the composer is told a fact rather than
   given a list to re-spell — preferred, because it also covers the outside-
   workspace case in the same call. *(b)* Paint only the outside-workspace chip,
   which the renderer can derive from cwd alone, and let the deny-listed path be
   indistinguishable inline until submit. **Forbidden:** re-spelling the patterns
   in the renderer. The direction's copy for the gated row (`Needs approval`)
   needs (a); without it, drop that tag rather than guessing.
2. **Does a token with a trailing slash resolve?** The drill contract writes
   `@src/components/`. If the backend treats a trailing slash as an existing
   path, a mid-drill token is a valid reference and will chip while drilling; if
   it does not, the token is prose and chips as soon as the user names a file
   under it. Either answer is *consistent* with "chip ⇔ resolves" — this is a
   thing to confirm and record, not a thing to code around.
3. **The row budget at the minimum window.** § 3.2 derives it from the space
   between the box's top edge and the column's top edge, capped at 8 and floored
   at 3. The prediction to falsify: at 800x600 the picker is not sliced, and the
   budget falls rather than the shell moving. Confirm on a frame, not on
   arithmetic.
4. **The mirror's rect height.** Prediction 2 in § 7: whether
   `Range.getClientRects()` over a mirror span returns the line box (21.7px) or
   the glyph content box (~16.5px) decides whether the 2px line inset is applied
   in the drawing or is already in the measurement. Read it once, then fix the
   number; do not leave a magic value that only one of the two answers satisfies.
5. **The resolution debounce and its bound.** One `probe-files` call may carry
   64 paths. A value with more resolvable tokens than that cannot be fully
   decorated in one call: decide whether the excess is left undecorated (honest,
   and the submit path is unaffected) or chunked. The backend's own caps — about
   215 uniform tokens, 32,768 characters of references — are well inside 64
   *files*, so this is an edge for a pathological draft, not a normal one.
6. **Recents: where they live and what counts.** The direction needs accepted
   mentions, per workspace, bounded (a ring of about 20), persisted in the
   existing UI preferences store. Confirm the store's persistence path before
   designing around it; if it does not persist, recents start empty per launch
   and the pool's value drops — which is a reason to say so in the commit rather
   than to grow a second store.
7. **The two `PERCEPTIBLE` rows and the two call-site pins** (§ 6). Land them
   with the implementation, and say in the commit why the chip has no `CONTROLS`
   row — otherwise the next reader adds one and concludes the wrong thing from
   its failure.
8. **A design round on the rendered frames**, before merge, with the states § 5
   names: a chip mid-sentence, a chip at the start and at the end, two adjacent
   chips, a wrapped chip on a narrow column, the needs-approval chip beside a
   plain one, the picker at 8 rows and at 3, the no-match notice, and the empty
   directory. `localOperatorLight` and `localOperatorDark` at minimum
   (branding § 9.9), because the light themes are where contrast defects hide:
   the fill step's two thinnest palettes are `iceberg` **2.15** and
   `localOperatorLight` **2.25** against a `sunken` fill that carries 3.75 at
   worst, so a light-theme failure would mean the mirror drew the fill somewhere
   other than the token — not that the role is wrong.
9. **`claude.ai` is still a blocked origin for this pass** — and it is no longer
   the interesting gap. The prompt was raised and then **cancelled rather than
   granted** (the operator was away from the keyboard, so waiting on it would have
   been waiting on nobody), and no claim in § 2 rests on the Claude web composer.
   What § 2 now holds for the named reference is a *user's* frame of a shipped
   build (2.1), not the vendor's, and that is enough for the row anatomy, the
   placement and the plain-ink composer — but see 10.
10. **No frame anywhere shows an accepted mention — the state the chip argues
   about.** § 2.7's negative is honest but it is a negative about an *unseen*
   state as much as an absent one: the Codex app frame has the menu open and the
   token still plain in the field (2.1), and Claude's captured sent row is a
   session mention in a filled row rather than a file mention with a chip. If the
   chip argument is ever challenged, the cheapest evidence is one more frame of
   **the same app with a file mention accepted** — the composer either chips it or
   leaves it plain — and the app is the operator's own surface if it is installed.
   Until then § 3.1 argues from the contract, which § 7 already states.
11. **The reference's menu is multi-resource; ours is files only, and the commit
   should say so.** File and app `@` mentions, skills and conversations all share
   one menu in the reference (2.1), which is why a reporter's complaint is a
   *grouping* complaint. This direction deliberately opens on files alone. That is
   a product narrowing, not an implementation limit, and a one-line comment beside
   the picker ("files only — the reference's menu also carries apps, skills and
   conversations") is what stops the next reader treating it as an oversight.
12. **The picker's arrangement diverges from Codex Desktop, and the divergence is
   deliberate.** The app opens the menu above the field, in the field's own
   column, at the field's width, with no panel edge, no shadow and no gap (2.1);
   § 3.3 anchors the popup above the box on the slash popup's `bottom-full` +
   `mb-1`, 4px clear of it. The direction keeps its own anchor because the slash
   popup already owns it and because an out-of-flow popup cannot move the band
   (§ 3.3, § 7) — not because the reference arranges it this way. Confirm on the
   rendered frame that the two popups still read as one mechanism; if they do not,
   that is a finding for the design round (8), not a reason to move the anchor
   mid-implementation.
