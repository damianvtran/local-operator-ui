job 1dc65f28394c (tui-toolrow-spec) [completed] model=anthropic/claude-opus-5
I could not write the file — this scout role has no write/edit/bash tool (only read, glob, grep, web). The full spec is below; it is ready to paste verbatim into `~/local-operator-ui/docs/evidence/tui-parity/tool-row-spec.md`.

---

# TUI tool-row parity spec — collapsed row + working indicator

Source of truth: `~/local-operator/local_operator/tui/widgets/tool_card.py`, `.../tui/glyphs.py`, `.../tui/widgets/transcript.py` (`WorkingBlock`), `.../tui/bindings.py`, `.../tui/theme.py`, `.../tui/local_operator.tcss`.

## 1. Glyph table (verbatim)

Two tables, one lookup (`glyphs.tool_icon`, glyphs.py:247-264). Lookup is `tool_name.strip().lower()`; exact builtin → `mcp__` prefix → default.

**Nerd table** (`NERD_TOOL_ICONS`, glyphs.py:82-112), used only when `nerd_icons_enabled()`:

| tool | codepoint | nerd name |
|---|---|---|
| bash | `\uf120` | nf-fa-terminal |
| read | `\uf15c` | nf-fa-file_text |
| write | `\uf040` | nf-fa-pencil |
| edit | `\uf044` | nf-fa-pencil_square_o |
| glob | `\uf115` | nf-fa-folder_open_o |
| grep | `\uf002` | nf-fa-search |
| todo | `\uf0ae` | nf-fa-tasks |
| wake | `\uf017` | nf-fa-clock_o |
| list_variables | `\uf0ca` | nf-fa-list_ul |
| read_variable | `\uf02b` | nf-fa-tag |
| browser | `\uf0ac` | nf-fa-globe |
| web_search | `\uf0ac` | nf-fa-globe |
| web_fetch | `\uf019` | nf-fa-download |
| task | `\uf0c0` | nf-fa-users |
| agent | `\uf0c0` | nf-fa-users |
| send | `\uf1d8` | nf-fa-paper_plane |
| peer | `\uf01c` | nf-fa-inbox (receipt row, not a tool) |

Fallbacks: `NERD_ICON_MCP = "\uf1e6"` (nf-fa-plug, any `mcp__*`), `NERD_ICON_DEFAULT = "\uf0ad"` (nf-fa-wrench, unknown tool). glyphs.py:116-118.

**Plain table** (`PLAIN_TOOL_ICONS`, glyphs.py:123-149) — the degraded/portable set:

| tool | glyph |
|---|---|
| bash | `$` |
| read | `≡` |
| write | `+` |
| edit | `±` |
| glob | `*` |
| grep | `/` |
| todo | `▪` |
| wake | `○` |
| list_variables | `=` |
| read_variable | `=` |
| browser | `@` |
| web_search | `?` |
| web_fetch | `↓` (U+2193) |
| task | `»` |
| agent | `»` |
| send | `→` (U+2192) |
| peer | `←` (U+2190) |

Plain fallbacks: `PLAIN_ICON_MCP = "◆"`, `PLAIN_ICON_DEFAULT = "▸"` (glyphs.py:152-156).

Notes for the port:
- **`eval`, `hub`, `ask`, `team` are NOT in either table** — they take the default (wrench / `▸`). The operator's `🔧 team` row is exactly that default wrench; `>_ bash` is nf-fa-terminal and `📄 read` is nf-fa-file_text rendered in a Nerd font.
- Icon is exactly **one cell**, enforced at import via `rich.cells.cell_len` (`_single_cell`, glyphs.py:159-188); a 2-cell glyph is replaced by its plain counterpart.
- Web port: use the semantic *category* icon set of your choice, but keep one icon per tool name with the same read/mutate/exec/meta grouping, and keep the fallback distinct (wrench) from the MCP mark (plug).

**Name column text** comes from `glyphs.display_name` (glyphs.py:267+): builtins pass through; `mcp__<server>_<tool>` is stripped to just the call (`mcp__linear_create_issue` → `create_issue`).

## 2. Row anatomy — segment order, separators, budgets

`ToolCard._build_row` (tool_card.py:2051-2240). Arithmetic runs on `width = max(card_width - 2, 10)` (tool_card.py:2069) — the "1-cell inner padding each side" is a **budget reservation**, not literal leading spaces; the icon is painted at the card's column 0.

Left→right:

```
<icon><space><name padded to name_col><space>[you: ]<summary>…<pad>[<slot> ]<diff runs><outcome glyph ><duration rjust(5)>
```

1. **icon** + one space (`icon + " "`, tool_card.py:2216) — 2 cells.
2. **tool name**, `truncate_cells(display_name, name_col)` then right-padded with spaces to `name_col` (tool_card.py:2110-2111). `name_col = min(transcript.tool_name_col, name_budget)`.
   - `TOOL_NAME_COL = 8` floor, `TOOL_NAME_COL_MAX = 24` ceiling (transcript.py:242-243). The transcript grows the shared column to the longest `display_name` on screen (`TranscriptView.tool_name_col`, transcript.py:3330-3362), but only when the card's inner width ≥ `NAME_GROWTH_MIN_ROW = 70` (tool_card.py:228, 2037-2049). Composing rows and `never sent` rows do not contribute (`contributes_name`, tool_card.py:2242-2253).
3. **one space** separator (`tool.row.dim`).
4. **`you: ` chip** — only when `user_run` (bang-mode, user-typed command). Literal string `"you: "` (5 cells), painted *inside* the summary budget so the truncation ladder keeps it ahead of the command (tool_card.py:2163-2172, 2219-2222). Dropped only when `chip_cells >= budget`.
5. **summary** — `truncate_cells(self._summary, budget)` (§3, §7).
6. **one right-aligned tail**, minimum 1 pad cell (`" " * max(1, width - used - tail_cells)`, tool_card.py:2234). The slot and status share this single pad, so both are stable columns.
7. **hint slot**, then one space, then
8. **status runs**: `[+N ][-N ]` then `[reason ]` then `<glyph> ` then `duration.rjust(5)`.

Order inside the status segment is `diff + core` (tool_card.py:2340) — diff counters ride **in front of** the outcome glyph. `DURATION_COL = 5` (tool_card.py:232), right-justified, so the glyph lands on the same cell whether the tool took `0.4s` or `12.3s`.

Exact glyphs (tool_card.py:122-128):
- `ICON_SUCCESS = "✓"`, `ICON_ERROR = "✗"`, `ICON_INTERRUPTED = "⊘"`
- `EXPAND_HINT = "⟨expand⟩"`, `COLLAPSE_HINT = "⟨collapse⟩"`
- `NO_OUTPUT_NOTICE = "⟨no output⟩"`, `RUNNING_NOTICE = "⟨still running⟩"`, terse `⟨∅⟩` / `⟨⋯⟩` (tool_card.py:140-159)

Per-state status shape (`_status_runs`, tool_card.py:2286-2340):

| state | status segment |
|---|---|
| `waiting` | `waiting` (dropped entirely if `cap < 7`); no glyph, no duration |
| `composing` | **empty** — nothing has run; the dictation clock rides in the summary |
| `running` | `"  "` + `format_duration(int(elapsed)).rjust(5)` — two blanks stand in for `<glyph> ` so the number lands in the column the ✓ will use. **No glyph.** Replayed running rows (`_started is None`) render nothing at all |
| `success` | `[diff] "✓ " + duration` |
| `error` | `[diff] ["<msg> "] "✗ " + duration` |
| `interrupted` | `[diff] ["interrupted "] "⊘ " + duration` |

Reference rows (module docstring, tool_card.py:11-14):
```
 bash     pytest -q                                     ✓  0.4s
 edit     tui/theme.py                           +12 -3 ✓  0.1s
 bash     false                          exit status 1 ✗  0.2s
 grep     needle                           interrupted ⊘  5.0s
```

**Hint slot visibility** (tool_card.py:2128-2149): shown only if `can_expand()` AND (`tool_name == "web_search"` OR the card is a fetch card OR hovered OR focused). Search/fetch disclosures stay visible at rest because their sources are the primary result. It is taken only if `remaining - (len(offer)+1) >= _SUMMARY_FLOOR (16)`. Label flips `⟨expand⟩` ↔ `⟨collapse⟩`. When the row *cannot* expand and the user activated it, the same slot carries a one-shot notice instead (§8).

## 3. Argument summary derivation (`_summary_from_args`, tool_card.py:492-515)

```
IDENTITY_ARGS = {command, path, file_path, url, pattern, query, name, target, message}   # tool_card.py:309-321
```

Rules, in order:
1. If `tool_name == "send"` → `_send_summary(args)` (below), falling back to the tool name.
2. Otherwise collect `_scalar_text(value)` for every arg whose **key is in `IDENTITY_ARGS`**, in argument order, dropping empties.
3. If that list is empty, collect `_scalar_text(value)` for **all** args in argument order (unknown/MCP tools).
4. Take the **first two** entries and join with a single space: `" ".join(parts[:2])`.
5. If the result is empty, the summary is the tool name itself.

`_scalar_text` (tool_card.py:442-448): `str` → `compact_path(value.strip())` with newlines replaced by spaces then stripped; `int/float/bool` → `str(value)`; anything else → `""` (dropped).

`compact_path` (tool_card.py:420-439): only rewrites a **whole-token absolute path** (`startswith("/")` and contains no space). `cwd + "/"` prefix → relative remainder; else `$HOME + "/"` prefix → `~/…`; else unchanged.

`_send_summary` (tool_card.py:451-489): `" · ".join([mode, who, message])` — delivery-mode marker **leads** (from `tools.builtin.peer_send_mode_label`), then target (`peer_send_target_label`, `"?"` if empty), then the message body preview with no cap of its own.

The summary is sanitised with `strip_control_sequences` at construction (tool_card.py:884) and **rebuilt from the execution's args** in `begin_running` (tool_card.py:1370) — it is never the model's `intent` (that goes to the working line only).

Composing rows override the summary: `"composing… {facts}"` where `facts = "{bytes} · {clock}"` or just `{clock}` when no bytes yet (`_render_composing`, tool_card.py:1210-1231). Bytes format `_format_bytes` (tool_card.py:324-335): `812 B` / `12.4 KB` / `1.2 MB`.
Interrupted-while-composing rewrites it to `"never sent · {size} composed"` where size is `_format_bytes(...)` or the word `nothing` (tool_card.py:1046-1058).

## 4. Duration formatting

Two formatters, deliberately different.

**Settled rows** (`_outcome_runs`, tool_card.py:2376-2396):
- `self._duration is None` (replayed row) → `" " * 5` (blank, column stays aligned).
- `elapsed < 10` → `f"{elapsed:.1f}s"` → `2.9s`, `0.0s`
- `10 <= elapsed < 60` → `f"{elapsed:.0f}s"` → `34s`
- `elapsed >= 60` → `format_duration(elapsed)`
- then `.rjust(5)`.

**Running rows and everything else** — `format_duration(seconds)` (tool_card.py:338-387), integer seconds, **bounded at 6 cells over its whole domain**:
- `< 60s` → `{n}s` (sub-second → `0s`)
- `< 1h` → `{m}m{s}s`, or `{m}m` when secs == 0
- `< 1d` → `{h}h{m}m`, or `{h}h` when minutes == 0
- `< 100d` → `{d}d{h}h`, or `{d}d` when hours == 0
- `> 99d` → literal `100d+`

Widest strings: `59m59s`, `23h59m`, `99d23h`.

## 5. Diff counters

`_diff_counts(details)` (tool_card.py:567-583): reads `details["added"]` and `details["removed"]`. A value is counted only if it is an `int` **and not a `bool`** and `> 0`; anything else (missing, malformed, negative, `True`) becomes `0`.

`_diff_runs` (tool_card.py:2342-2349) emits, in order:
- `f"+{added} "` in `tool.status.diff_added` when `added > 0`
- `f"-{removed} "` in `tool.status.diff_removed` when `removed > 0`

Note the **trailing space inside each run**. Counters are **never** rendered as `+0` / `-0` — an unknown count renders nothing.

Dropped when:
- the state is `waiting`, `composing`, or `running` (those branches return before diff is considered);
- `cap` (= `max(8, width // 3)`) bites: if `core_cells + diff_cells > cap`, `_status_runs` returns `core` alone (tool_card.py:2338-2339). Diff is always the first thing shed — "how a write went is core, how much it wrote is meta".
- `_clamp_runs(runs, width - 3)` (tool_card.py:2074, 779-799) trims from the **tail** as the final one-line guarantee.

## 6. Colour roles per state

The TUI names elements (`bindings.py`) that resolve to semantic tokens (`theme.py`). Map to the UI's role vocabulary as noted.

**Row background (elevation is a background step, never a border — `local_operator.tcss:330-436`):**

| state | CSS class | ground token | dark hex | UI role suggestion |
|---|---|---|---|---|
| base / settled success / interrupted / waiting | `ToolCard` | `$lo-surface` | `#1e1a14` | `bg-surface` |
| running (`tool-running`) | `.tool-running` | `$lo-raised` | `#272219` | `bg-elevated` |
| failed (`tool-error`) | `.tool-error` | `$lo-tint-danger` | `#2c1a16` | `bg-danger-wash` |
| hover (wins over state tints) | `:hover` | `$lo-overlay` | `#302a20` | hovered-row ground |
| focus (wins over hover) | `:focus` | `$lo-tint-select` | `#16221a` | selected-row ground |

There is **no CSS rule for `tool-success`, `tool-interrupted`, or `tool-waiting`** — those classes are added but carry no ground, so they render on plain `surface`. Verified: no match for `tool-success|tool-interrupted` in `local_operator.tcss`.

Collapsed height is **pinned to 1 row** (`height: 1`); `.tool-expanded` relaxes to `height: auto`. Optional comfortable density adds `height: 2; padding: 1 0 0 0` (top only). No border anywhere. `pointer: pointer` on the whole row.

**Ink per span** (`bindings.py:452-723`; token → dark hex from `theme.py:27-56`):

| element | token | dark hex | when |
|---|---|---|---|
| `tool.row.icon_running` | `accent` | `#38c96a` | icon while `running`/`composing` |
| `tool.row.icon_settled` | `dim` | `#837c6d` | (declared; in practice a settled icon reuses `name_style` — tool_card.py:2215) |
| `tool.row.name_running` | `string` | `#57c785` | name while `running`/`composing` |
| `tool.row.name_read` | `tool-read` ← `signal` | `#6ea8d8` | settled: read/glob/grep/web_fetch/web_search/browser/list_variables/read_variable |
| `tool.row.name_mutate` | `tool-mutate` ← `muted` | `#b5afa2` | settled: write/edit |
| `tool.row.name_exec` | `tool-exec` ← `muted` | `#b5afa2` | settled: bash/eval |
| `tool.row.name_meta` | `tool-meta` ← `label` | `#b48cd6` | settled: task/agent/hub/todo/send/wake/ask |
| `tool.row.name_settled` | `muted` | `#b5afa2` | settled, uncategorised (MCP, unknown) |
| `tool.row.summary_running` | `muted` | `#b5afa2` | summary while live |
| `tool.row.summary_settled` | `dim` | `#837c6d` | summary settled |
| `tool.row.chip_running` | `dim` | `#837c6d` | `you: ` while live |
| `tool.row.chip_settled` | `muted` | `#b5afa2` | `you: ` settled (brighter than the summary beside it) |
| `tool.row.dim` (separators/pad) | `dim` | `#837c6d` | |
| `tool.row.slot_offer` | `dim` | `#837c6d` | `⟨expand⟩`/`⟨collapse⟩` |
| `tool.row.slot_notice` | `muted` | `#b5afa2` | `⟨no output⟩`/`⟨still running⟩` — one step brighter than the offer |
| `tool.status.running_duration` | `dim` on `raised` | `#837c6d` | running duration, and the `waiting` label |
| `tool.status.diff_added` | `success` | `#57c785` | `+N` |
| `tool.status.diff_removed` | `danger` | `#ef8078` | `-N` |
| `tool.status.success_glyph` | `success` | `#57c785` | `✓` only |
| `tool.status.error_glyph` | `danger` | `#ef8078` | `✗` **and** the error message |
| `tool.status.interrupted` | `dim` | `#837c6d` | `⊘` and the word `interrupted` — deliberately no hue |
| `tool.status.duration` | `dim` | `#837c6d` | settled duration, in **all** outcome states |

Two contracts to preserve in the port:
- **The glyph carries the outcome, the duration stays `dim`** in every state. `✓ 0.4s` is *not* all-green.
- **The three glyphs must be distinguishable with no colour at all.** Tint is a second channel, never the only one.

Category taxonomy source: `_TOOL_CATEGORY` (tool_card.py:178-198), looked up case-insensitively via `_category_element` (tool_card.py:201-215). Any tool not listed → `tool.row.name_settled`. Liveness outranks identity: a running row never shows a category hue.

**Expansion inks** (bindings.py:452-524): `tool.live.header` = `accent` on `raised`; `tool.live.dim` = `dim`; `tool.args.label` = `label` (#b48cd6), `tool.args.value` = `fg`, `tool.args.dim` = `dim`; `tool.output.dim` = `dim`, `tool.output.error` = `danger` on `tint-danger`; `tool.search.title` = `fg` **bold**, `tool.search.url` = `signal`, `tool.search.snippet` = `muted`, `tool.search.dim` = `dim`; `tool.fetch.signal` = `signal`, `tool.fetch.snippet` = `muted`, `tool.fetch.dim` = `dim`, `tool.fetch.error` = danger; `tool.diff.added` = `success`, `tool.diff.removed` = `danger`, `tool.diff.hunk` = `muted`, `tool.diff.context` = `dim`.

## 7. Truncation / shed priority as the row narrows

All widths measured with `rich.cells.cell_len` (one width model). `truncate_cells(text, width, ellipsis="…")` (tool_card.py:390-417) rstrips before appending the ellipsis so a cut never lands as `word …`.

Budgets, in evaluation order (tool_card.py:2069-2202):

```
width        = max(card_width - 2, 10)
status_cap   = max(8, width // 3)
status_runs  = clamp(_status_runs(status_cap), width - 3)
name_budget  = width - (2 + status_cells + 2)
prefix_cells = 2 + name_col + 1
remaining    = max(0, width - prefix_cells - status_cells - 2)
slot_cells   = len(slot) + 1  (0 when no slot)
budget       = max(0, remaining - slot_cells)   # summary budget, chip comes out of it
```

Shed ladder, first to go first:

1. **Diff counters** — dropped whole when `core + diff > status_cap`.
2. **`⟨expand⟩` hint** — taken only if it leaves `_SUMMARY_FLOOR = 16` cells of summary.
3. **The failure reason** — an *error message* truncates (`internal error: worker di…`) because it is content; the constant word `interrupted` is **all-or-nothing** (dropped whole below the width that holds it, so a stop can never be confused with a truncated failure). A reason reduced to a bare `…` is dropped entirely (tool_card.py:2431-2444).
4. **Terse status** — if `name_budget < 2` in `error`/`interrupted`, re-run `_status_runs(terse=True)` which drops the reason so the tool NAME survives (tool_card.py:2086-2095).
5. **The name column** shrinks (cell-truncated) before the row overflows.
6. **Last rung**: if `name_budget < 2` still, the row degrades to `icon + pad + status` — the outcome column always survives (tool_card.py:2096-2107).
7. **The notice slot does NOT participate.** It outranks the summary and walks `NOTICE_LADDER` — full phrase → `⟨∅⟩`/`⟨⋯⟩` — taking the first rung that fits `remaining`, never being dropped for the summary's sake (tool_card.py:2142-2148).
8. Composing rows only: the label `composing… ` sheds **whole** before the facts are truncated, triggered by `width < _label_min_width()` (a constant, so it can only flip once — tool_card.py:2173-2191, 2260-2284).
9. Final hard clamp: `_clamp_runs(runs, width - 3)` trims styled runs from the tail (tool_card.py:779-799).

## 8. Expansion behaviour

**Trigger** (`ExpandableActionBlock`, transcript.py:667-777): the whole row is the click target (`on_click` → `activate()`) *and* a focus stop. Key bindings `enter` and `space` → `activate`; `up`/`down` walk to the previous/next action row. Toggling adds/removes the CSS class `tool-expanded` (`EXPANDED_CLASS`, tool_card.py:849) and asks the transcript to refresh the adjacent gap.

**`can_expand()`** (tool_card.py:1530-1551) = `bool(_output) or bool(_diff) or state == "running"`. A settled call that printed nothing is **not** expandable, even though it has arguments.

**Inert activation**: flashes a notice in the hint slot for `NOTICE_SECONDS = 2.0` — `⟨still running⟩` when `state == "composing"`, else `⟨no output⟩` (tool_card.py:1568-1592). Any expand/collapse, or losing focus, clears it.

**Auto-open**: `open_on_settle()` — set implicitly for `user_run` (bang-mode) rows; the card opens itself the moment it settles, consumed once (tool_card.py:1067-1098).

**Body selection** (`_build_content`, tool_card.py:1719-1761), in order:
1. `state == "running"` → arguments block **then** live block.
2. `state == "success"` and a diff exists → **diff alone** (arguments would restate the same change).
3. `web_search` with output → arguments + structured search body.
4. fetch card with output → arguments + fetch body.
5. any output → arguments + plain output body.
6. otherwise → arguments only.

All bodies indent `OUTPUT_INDENT = 2` and use `line_width = max(1, width - 2 - OUTPUT_INDENT)`.

- **Arguments block** (`_append_input_body`, tool_card.py:1817-1866): one labelled block per key. Key is control-stripped and truncated to 24 cells; head is `f"{key}: "`. The value **wraps** (`wrap_cells`) rather than truncating — the whole point of the expansion. Capped at `INPUT_MAX_LINES = 12` rows per argument, overflow announced as `… N more line(s)` in dim. Head painted in `tool.args.label`, body in `tool.args.value`.
- **Live block** (`_append_live_body`, tool_card.py:1763-1815): header `"⋯ running"`, plus `" · {format_duration}"` when the start time is known, plus `" · no output yet"` when nothing has streamed. Then, if lines were dropped, a marker row: `… earlier output not shown` (payload was sliced) or `… N earlier line(s)`. Then the **tail** of the buffer, `LIVE_MAX_LINES = 20` lines, each truncated to width. Ingest is bounded to the last `LIVE_INGEST_CHARS = 64 * 1024` chars of each snapshot; bash re-sends the whole accumulated output every 500 ms, so the payload **replaces** the buffer, never appends (tool_card.py:1411-1463).
- **Output block** (tool_card.py:1868-1887): the **head** of the result, one line per row, `EXPAND_MAX_LINES = 40`, overflow `… N more line(s)`. Whole block in `danger` ink when the state is `error`.
- **Search body** (tool_card.py:1889-1915): line-classified — `http(s)://…` → `signal`; `^\d….\s` (numbered title) → `fg` bold; `Provider:`/`Sources:` → `dim`; everything else → `muted`. Structured rows are built from `details["sources"]` (`_search_result_output`, tool_card.py:586-613): `Provider: {provider} ({auth_mode})`, `Sources:`, then per source `N. {title}` / `   {url}` / `   {snippet}` (snippet capped at `SEARCH_EXPANDED_SNIPPET_CHARS = 360` with a trailing `…`), closing with `Ask Operator to web_fetch result N (or \`read <url>\`) for the full page.`
- **Fetch body** (tool_card.py:1917-1986, header rows at 631-697): applies to `web_fetch` and to a `read` whose `details` carry both `render_method` and `final_url` (`_is_fetch_details`). Header rows, in order: an optional `⚠ HTTP {status} {reason} — error/block page, not page content.` (danger ink) when `details["http_error"]` or a non-2xx status; `Fetched: {url}[  (final: {final})][  ·  {status} · {ctype} · cache {miss|hit}]` with **URLs lifted to `signal` and the labels/metadata left dim** (token-wise painting, `_append_fetched_row`); `Rendered: {method} · {N} lines · {2.4 MB}` in dim; optional `sparse/JS-gated — try \`browser\` for the full page.` in `signal`. Then a blank line, then the rendered preview with the model-facing header block stripped (`_strip_fetch_header`) so fields are not printed twice. Body lines default to `muted`.
- **Diff body** (tool_card.py:1988-2035): the nameless `---`/`+++` header pair is stripped **positionally** (only if lines 0 and 1 are exactly those). Then per line, colour by leading char only: `@` → `muted`, `+` → `success`, `-` → `danger`, else `dim`. `EXPAND_MAX_LINES = 40`, overflow `… N more diff line(s)`.

## 9. Thinking / working indicator

**Widget**: `WorkingBlock(TranscriptBlock)` — `~/local-operator/local_operator/tui/widgets/transcript.py:2410-2686`. CSS class `working-block`. It is **the ONE aggregate indicator** (D25): never a per-row spinner. Pinned to the foot of the transcript by `TranscriptView.pin_tail`, mounted at turn start, removed at turn end. `SPACING_TRANSIENT = True` — it takes one blank row above it.

**Rendered line** (`_paint`, tool_card 2625-2684):

```
"  " (SPINE_INDENT=2) + <spinner glyph> + " " + <activity label> + "  " + <clock, ≤6 cells>
```

- **Spinner frames**: `_SPINNER = ("⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷")` (transcript.py:2469) — the same tuple as `terminal_title.SPINNER_FRAMES` (terminal_title.py:97), used by the status band, session picker and subagent view. Braille, plain Unicode, one cell, **no accent spent** — motion, not colour, says alive. Frame index = `int(frame_ms // _SPIN_MS) % 8` with `_SPIN_MS = 80` (12.5 fps). The operator's screenshot shows `⠿`, which is the terminal's rendering of one of these frames — the source set is the eight above.
- **Repaint cadence**: `_FRAME_MS = 33` (30 fps, shimmer sweep) when `animation.motion_enabled()`; `_STATIC_FRAME_MS = 1000` when shimmer is off **or the terminal is blurred**. In the static state the spinner is **frozen on frame 0 (`⣾`)** and only the clock moves, repainting only when the second changes.
- **Label**: the current activity, never the word "working". Default `DEFAULT_ACTIVITY = ACTIVITY_THINKING = "thinking"` (harness/intent.py:298, transcript.py:2407). Other values are derived from real events: `ACTIVITY_RESPONDING = "responding"`; per-tool `tool_activity(display, intent)` = the model's sanitised intent, else `f"running {display}"`; batches `batch_activity` = the single phrase, else `f"running {len(phrases)} tools"` (harness/intent.py:310-340). **No trailing ellipsis** — the clock says it is ongoing. The label is `truncate_cells`'d, never wrapped: `width = max(size.width - SPINE_INDENT - 2 - _CLOCK_COL, 8)`.
- **Ink**: label and clock both `dim` (`#837c6d`) when static; when animated the label rides `shimmer_text(label, frame_ms)`, a 30 fps accent-crested sweep across the label only. The head glyph is always `dim`.
- **Clock**: `_CLOCK_COL = 8` reserved cells — literally `"  "` + `truncate_cells(format_duration(now - phase_started), 6)`. Same `format_duration` as the tool row, so `6s`, `1m57s`, `2h5m`. **It times the current PHASE, not the turn**: the clock restarts only when `set_activity(activity, phase)` sees a *different phase*, not merely a different label (transcript.py:2519-2539), so a batch shedding calls does not keep resetting to `0s`. The clock is shown from the first frame.
- **One row, always** — the label is clipped, and `set_content(line, layout=False)` so a shimmer frame is a repaint, never a reflow.

**Interaction with a running tool row**: they are deliberately different facts and must not restate each other.
- The tool row shows the **arguments** (what actually ran) and its own execution duration; the working line shows the model's **intent/kind of work** and the phase age. The card never renders `intent`; the working line reads it from the card (tool_card.py:919-924).
- A running tool row shows **no outcome glyph** — the empty status column is what says "still running" — but it **does** show a live duration at 1 Hz (`CLOCK_INTERVAL_S = 1.0`, tool_card.py:296; `_status_runs` running branch, tool_card.py:2305-2331).
- A running row's *liveness colour* is the accent icon plus the `raised` ground; there is no per-row animation (D26: a still frame must read "live" without motion).
- The working line sits **below** the last tool card, indented 2 cells; the tool card is flush at the transcript gutter.

### Port checklist for `local-operator-ui`

- One `cn(...)`-wrapped row component, grid/flex with a fixed name column (8ch floor, 24ch ceiling, grown to the longest visible name only when the row is wide) and a right-aligned status cluster with a fixed 5ch duration slot so glyphs stay in one column.
- Colours by role only: running ground `bg-elevated`, failed ground `danger-wash`, settled ground `bg-surface`, hover ground, focus ground; icon accent while running; name `success`-ish while running then category ink; summary `text-ink-muted` while running then `text-ink-dim`; `✓` success, `✗` danger, `⊘` `text-ink-dim`; duration always `text-ink-dim`.
- Keep glyph-only outcome legibility (no colour-only signalling), keep the empty-status-means-running rule, and keep the shed order: diff → hint → reason → name.
- One aggregate working line at the foot with the eight braille frames at 80 ms, label + two spaces + phase clock, and no per-message spinner.