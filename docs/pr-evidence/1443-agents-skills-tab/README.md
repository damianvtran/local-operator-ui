# Agents page: the read-only Skills tab (PR #1443)

Rendered frames of the new **Skills** tab on the Agents page, in both brand
themes (`localOperatorLight` and `localOperatorDark`), as `docs/branding.md`
§ 9 item 9 asks. Every frame comes from the **built app at the PR head
`53693426d6`**, driven in headless Electron against a real `lop serve`. It covers
loading, the two empty states, error, populated, details, and the three
Retry-focus states the review rounds fixed (R5-1, the theft case).

**Which head the frames are of.** They were captured at `53693426d6`. A later
rebase onto a newer `main` moved only the branch's base: that commit is
`4af76f3f2d` on the rebased branch, with the same diff against its base, so
every frame is still a picture of the reviewed Skills-tab code. The frames were
not re-captured after the rebase.

Files are named `<state>-<theme>-<width>.png`. Frames are 2x device pixels
(`2760x1800` is a 1380x900 CSS viewport, `1600x1800` is 800x900).

## Frames

Each row comes in both themes. The **DOM reading** column is what the page said
when the frame was taken, read from the page itself (`frames.json` holds the full
per-frame record). Every reading was the same in the two themes apart from
`data-theme`.

| State | Files | What it shows | DOM reading at capture |
| --- | --- | --- | --- |
| Loading | `loading-*-1380.png` | The first list read is held for 7 s in the core tap. The roster shows six skeleton blocks, the tab reads `Skills` with no count, and the details pane is empty (no "Select a skill" prompt while loading). | rows 0, skeleton blocks 6, tab `Skills` |
| Empty: no skills | `empty-none-*-1380.png` | The core answers with `skills: []`, a real response whose list the tap empties. The roster reads "No skills found yet." and the tab reads `Skills 0`. | `data-skills-empty=none`, rows 0, tab `Skills 0` |
| Empty: no match | `empty-no-match-*-1380.png` | The real list is loaded and the search box holds `qqqq zzzz` (typed with key events). The roster reads `No skill matches "qqqq zzzz".` and the clear (x) control shows. Focus is in the search box, so it draws its focus ring. | `data-skills-empty=no-match`, rows 0, focus INPUT `Search skills by name or description` |
| Error | `error-*-1380.png` | The first read fails and nothing is cached: the page was reloaded with the tap returning 500. The pane shows "Skills could not be read", the server's sentence ("qa injected failure", which is the tap's own 500 body), the reassurance line and an enabled **Retry**. The tab has no count because nothing was ever read. | alerts 1, Retry `enabled:Retry`, tab `Skills` |
| Populated | `populated-*-1380.png`, `populated-*-800.png` | 25 seeded skills from five sources: Built-in ×14, Local ×4, Other tool ×4, Agent Hub ×2, Project ×1. `hub-linked` is the hub row with a state mark: **"Update failed"** in the danger ink with its warning glyph, then "· Downloaded — subscribed" (truncated by the row width). The 800 px frame is the same list at the narrow layout. | rows 25, tab `Skills 25`, `hub-linked` mark `Update failed`, focus `<body>` |
| Details | `details-*-1380.png` | `local-refs` opened with Enter on its row: header and source, Description, the SKILL.md body, **4 reference files** with sizes (`big.md` 3 KB, `data.json` 11 bytes, `long.txt` 2 KB, `notes.md` 100 bytes), Identity (form and fingerprint) and Where it lives. Focus stays on the row (`skill-row-local-refs`, the U3 behaviour). | `data-skill=local-refs`, files 4 |
| 6a: retry under way | `retry-a-under-way-*-1380.png` | Focus is on Retry and Enter is pressed. The tap holds each failing attempt 2 s, and the frame is taken 0.5 s into the press: the button reads **"Retrying…"** and is disabled. Focus is on `<body>`, because a disabled button cannot hold focus. | Retry `disabled:Retrying…`, focus BODY |
| 6b: settled, failed | `retry-b-settled-failed-focus-retry-*-1380.png` | The same retry has settled and failed (tap `500,500`, i.e. the attempt and its one automatic retry). Focus is **handed back to Retry** and its focus ring is drawn. | Retry `enabled:Retry`, focus BUTTON `Retry` inAlert true |
| 6c: theft case, during | `retry-c-search-during-*-1380.png` | Retry is pressed from the keyboard, then a real mouse click (CDP `Input.dispatchMouseEvent` at the box's centre) lands in the search box 150 ms later, while the retry is still in flight. The search box has focus and draws its ring; Retry is disabled. | Retry `disabled:Retrying…`, focus INPUT `Search skills…` |
| 6c: theft case, after the failed settle | `retry-c-search-after-settle-*-1380.png` | Taken 1.5 s after the same retry settled and failed (tap `500,500`, settle 4.46–4.47 s after the press). **Focus is still in the search box.** Retry is enabled again but was not given focus. This is the R5-1 fix: before `3730327976` the failed settle moved focus back to Retry. | Retry `enabled:Retry`, focus INPUT `Search skills…` |

The three Retry frames come from a **cached** list. The list loaded, went stale
(`staleTime` 10 s), and then a background read failed. That is why their tabs
read `Skills 25` while the error pane is up and the roster body is hidden. The
first-load error frame has no cache, and its tab reads `Skills`.

## How they were captured

- **Build.** A detached worktree of `53693426d6` with `pnpm-lock.yaml`
  `cmp`-identical to the primary checkout, so `node_modules` is the primary
  checkout's tree linked in and nothing was installed. It was built with
  `electron-vite build`, with dummy OAuth `VITE_*` ids,
  `VITE_DISABLE_BACKEND_MANAGER=true` and
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:46250`. The URL is baked into the
  renderer once, as checked in the build output. The worktree and its `out/`
  were removed afterwards.
- **Core.** The real `lop serve` from `git archive` of local-operator
  `origin/main` (`0c36e7a84a3`), run from an extracted temp tree with an isolated
  `HOME` and `LOCAL_OPERATOR_CONFIG_DIR`, `env -i` (no `CMUX_*`) and loopback
  46250. A pass-through ASGI tap logs every request. On `GET /v1/desktop/skills`
  only, it can delay the response, fail it with a 500, or empty its `skills`
  list. The skills are real files written into the scratch home. The hub links
  were written through the production `write_baseline` path.
- **The hub mark.** The rig first set `hub-linked` to `available` through the
  production status store. The core's own update check then ran against the
  seed's unreachable test hub (`hub.example.test`) and recorded
  `state: failed, error_class: hub-item-missing`. That is the state
  `GET /v1/desktop/hub/updates` returned, and the frames show it. So the mark on
  screen was produced by the core, not written by hand.
- **App.** Headless Electron only: `--window-mode=headless --use-mock-keychain`,
  absolute app path, a scratch `--user-data-dir`,
  `LOCAL_OPERATOR_UI_TELEMETRY=off`, and an environment built from scratch. One
  boot per theme, run one after the other, never two at once. Frames were taken
  with CDP `Page.captureScreenshot`. Nothing raises or focuses the window: there
  is no `bringToFront`, `activateTarget` or `window.focus()`.
- **Theme selection.** The renderer's persisted preference is the zustand blob
  `ui-preferences-storage` in localStorage (`version 4`, `state.themeName`),
  which is what a relaunch reads. The driver set `themeName` there and reloaded
  the page. `ThemeProvider` then published the theme, and the page confirmed it:
  `data-theme="localOperatorLight"`, no `.dark` class and body ground
  `rgb(242, 237, 227)`; or `data-theme="localOperatorDark"`, `.dark` present and
  `rgb(34, 32, 28)`. The Settings picker was not used.
- **Window glass pinned off.** Glass defaults to on (80%) on macOS. A headless
  window has no desktop behind it, so with glass on the app's grounds are
  painted at an alpha over nothing, and every frame comes out as the same grey
  wash in either theme. A first dark pass with glass on was discarded for that
  reason. Each boot's user-data dir was seeded with a `window-glass.json`
  recording an **explicit** `enabled: false`, and the launch log confirms
  `[window-glass] launch gate … enabled=false`. These frames therefore show the
  opaque palette. The glass-on look is not covered here.
- **Memory.**
  - The build ran under `scripts/run_bounded.py --memory-mb 3900` and peaked at
    2,939,191,296 B. It does not fit the 1500 MiB default.
  - The two node drivers ran under `--memory-mb 1500` and peaked at 434 MB and
    438 MB.
  - The Electron groups peaked at 903 MB (dark) and 997 MB (light), summed over
    each process group.
  - Both boots were reaped by exact process group (`leftover: []`). Afterwards
    no core, Electron or driver process remained, and ports 46250, 46651 and
    46652 refused connections.

## Notes from the light frames

All figures below were computed from pixels sampled in these PNGs. They are not
token contrasts, and they include antialiasing.

- **Focus rings hold in light.** On Retry and on the search box, the ring
  (`rgb(55, 117, 71)`) measures 5.07:1 against the roster ground and 4.73:1
  against the details ground. In dark the same rings measure 7.02 and 7.67.
- **The "Update failed" mark holds in light.** Its reddest glyph pixel against
  the row ground measures 5.57:1 (5.60 in dark).
- **The skeleton is close to invisible in both themes, slightly more so in
  light.** Block against roster ground measures 1.08:1 in light and 1.11:1 in
  dark. The blocks are `aria-hidden` placeholders, so they are not under the
  3:1 non-text floor. Also, `RosterSkeleton` is the shared one from
  `detail-parts.tsx` that the Agents roster already uses, so this PR did not
  introduce it. Recorded because the loading frame shows it.
- **"Retrying…" is faint in both themes.** The most-contrasting text pixel
  against the button fill measures 2.43:1 in light and 2.49:1 in dark. A
  disabled control is exempt from the text floor, and the frame shows the label
  is still readable. Recorded, not raised as a defect.
- Beyond these, nothing in the light frames clips, overlaps or disappears where
  the dark frames do not. The `hub-linked` second line truncates at the row
  width ("Downloaded — subs…") in both themes and at both widths.

## Not covered

- The window-glass look (see above), the macOS native window path, and any
  palette other than the two brand themes.
- The theft case on the **details** pane's hook instance. These frames show the
  list instance. QA round 6 measured both instances by `activeElement`.
- In the details frame the roster is scrolled so that `big-body`'s name sits
  above the fold. This is because Enter on the focused `local-refs` row scrolls
  that row into view. It is how the app behaved, not an edit.
