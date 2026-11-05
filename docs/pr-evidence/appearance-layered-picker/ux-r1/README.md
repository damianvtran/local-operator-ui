# PR 1682 — UX review round 1 evidence

Reviewer: ux-reviewer. Began on anthropic/claude-opus-5-5; provider quota caused fallback to openai/gpt-6.1-sol during the accent walkthrough. No profile/model configuration was changed.

Scope: `74fc5810621..aa44a50e7a6`. Current PR head at report time: `63837f8c9cd`; `git diff --exit-code aa44a50e7a6 origin/pr1682 -- src/renderer/src .storybook src/shared` returned 0. Only non-English catalogues and i18n audit/receipt files changed after the reviewed code head.

## Scope and intent

Layered appearance picker, PR B: Theme → Contrast overlay → Accent. Review the five presets, fine slider, borrowed/custom accents (add, edit/rename/remove, 12-cap), per-mode independence and reset paths. Advanced per-role editor/import/export/OKLCH area picker and retuning default palettes are out of scope. Known deviations: narrow chips, live contrast tier announcement and Recent colours.

Spec sources: designer.md supplied by the design session and ARCHITECT.md supplied by the architecture session. No designer frames-b-r1 folder was present at the supplied session-local location or the two discovered custom-themes spec directories.

## Harness and limits (do not mistake this for built-app evidence)

- Own worktree `.worktrees/ux1682-r1`, exact code head above. Shared dependency tree, no installs. Manifest/lock differ from shared checkout (notably Electron 45 vs 44); no install was run, so no claim of native Electron fidelity.
- Polled existing Storybook listener for the requested 40 minutes; it remained. Started only one owned Storybook instance at a time afterward. Other pre-existing servers were not killed.
- Storybook dev only, `NODE_OPTIONS=--max-old-space-size=512`. Startup repeatedly exceeded 768 MiB; whole-gallery startup also exceeded 1200/1450 MiB. Review-local `.storybook-ux` reduced the story glob to appearance-layers, theme-selector and the diagnostic story; warm-cache retry at 1450 MiB survived (~100–152 MiB settled). This exceeds the brief's 768 MiB command ceiling and is disclosed, not a claimed compliant run.
- No build: active+wired+compressed memory measured ~30.5 GB, exceeding the <26 GB gate.
- Initial shipped `LayersStandard` story does NOT mount the real ThemeProvider: `.storybook/preview.tsx` uses fixed `getTheme(theme)` + `applyThemeToDocument(theme)` only. At slider -100/-50/0/50/100 the document canvas remained #1d1b17. Therefore those frames cannot validate composed theme changes. Added uncommitted review-only story, copied in `harness/`, mounting shipped AppearanceLayers+ThemeSelector inside the app's real ThemeProvider. All subsequent composition results below are from that diagnostic story. No product component was edited.
- Harness browser only. Manager URL used initially; DOM read limitations on the iframe led to a deliberately watched bare-iframe pass (contrary to the manager-only URL guidance), with no observed reload loop. No alternate browser engine. Host later lost the surface; opened a replacement only after tools returned 'no browser surface open'. No concurrent owned tabs.
- Browser tool has no pointer drag/right-click primitives. Slider drag used native value setter + input events, pointerdown/up, rAF; context menu opening used a synthetic bubbling contextmenu event at the actual swatch. Subsequent menu clicks were browser tool clicks. These are handler-level interactions, not physical mouse/OS proof. Native drag and eyedropper selection remain unverified. Shift+F10 was a browser keypress; diagnostic key listener logged the actual key reaching the focused custom swatch.

## Actual checks and results

### Deterministic checks

- Dead-end scan: `rg -n 'href="#"|to="#"|onClick=\{\(\) => \{\}\}'` on the four changed picker components: zero matches.
- copy_scan on accent-row.tsx, contrast-control.tsx, English appearance catalogue: `scanned 3 files, 308 candidate strings; 0 findings`.
- `node scripts/check-contrast-presets.mjs`: rc 0, 107.9 s. `Contrast presets hold: 4 presets x 59 palettes, all reached uncapped and in order.` No duplicate full suite run.

### Contrast

- Keyboard End=100; PageDown=50; ArrowLeft=45, then 40 (no snap); PageDown=0; PageDown=-50; Home=-100; PageUp=-50; ArrowRight=-45. Off-preset chip says 'Gentle (adjusted)' / 'Strong (adjusted)', none selected.
- Real-provider Local Operator Dark grounds: Soft #32302E; Gentle #282521; Standard #1d1b17; Strong #191713; High #16130E. Measured via browser styles on html --color-canvas.
- Obsidian High: canvas #111112, ink #FEFEFE. Soft: #303031 / #FAFAFA. Standard: #1A1A1B / #FAFAFA.
- Scripted 60-frame +100→-100: max frame interval 32 ms, median 8 ms, final -100; one 558 ms long task at release/compose. 30→44 landed 50 (snap); max 11 ms, median 8 ms, no long tasks. -100→0 max 85 ms, median 7 ms, no long tasks. This does not prove native pointer dragging is jank-free.
- Long-task attribution on a fresh Tokyo Night: theme click 114 ms, cold Home 308 ms, cold End 84 ms, warm Home no long task. Cold compose blocks on release; no assertion that 1.25 s keypress tool duration is app latency (plain-button Tab negative control also 1.25 s).

### Accent

- Borrow Dune orange on Tokyo Night: painted accent #FF8C38; switch Dracula: #FF8F3F and Dune orange still checked. Selection persists; legibility solve can move the colour.
- + → Hex #2563EB → blur: readout 'Text on this accent: 5.2 to 1'. Hue/Lightness arrows changed draft to #3864ED. Re-paste #2563EB → Add produces custom swatch and 'Adjusted for legibility on this theme'.
- Invalid #GGG → Add leaves dialog open, last valid swatch intact, helper 'Enter a hex colour like #1A2B3C.' (06-invalid.png).
- Tab sequence in picker: Hue → Lightness → Hex → eyedropper → Cancel → Add → Hue. Escape closes but `:focus` has zero matches; next Tab starts at the document's first focusable element, not +.
- Eyedropper exposed with proper accessible name; click + Escape closed the picker too. No selected-colour/OS cancellation proof claimed.
- Add until 12: 12 custom radios, visible explanation 'Up to 12 of your accents are kept. Adding another replaces the oldest.' Add 13th #CCDDEE: still 12, oldest #2563EB absent (07-limit12.png).
- Context-menu Remove works and removes the swatch. Rename and Edit colour are dead ends: menu visible before, click item, zero dialog and zero textbox afterward, repeated. Negative control + opens a named colour dialog. Menu opener was diagnostic contextmenu, not a physical right click; same shipped Radix onSelect and controlled Popover were exercised (08/09 pair).
- Keyboard Shift+F10 on focused custom radio: console `UXKEY F10 shift=true target=Your accent #2563EB`; zero menus. Code trace: AccentRow onKeyDown handles arrows/Home/End only; installed Radix context-menu Trigger has onContextMenu but no onKeyDown.

### Mode/reset

- Dark Dracula Soft + custom #2563EB: contrast -100, canvas #2F3038, painted accent #9EA4FF.
- Light Paper High + same custom: +100, #F3EBD8, #0F5ADE.
- Switching back/forth restores each. Dark 'Use theme accent' resets only dark; custom list remains global.

## Findings

- U1 MAJOR: custom accent management is not operable as promised. Rename/Edit close without opening their form. Keyboard Shift+F10 also has no menu path. Source: accent-row.tsx 302–317 onSelect setPicker, controlled Popover 327–332 clears on close, PopoverContent 369 onward. Resolve menu-close → popover-open focus ordering and provide tested keyboard menu activation. Before/after: 08/09.
- U2 MINOR: picker Escape/Cancel does not restore focus to +. Popover uses PopoverAnchor, not a focus-return trigger; no close autofocus handler. Restore focus to the actual opener, including the custom swatch for edit/rename.
- U3 MINOR: duplicate Contrast heading and duplicate Reset when nonzero. AppearanceLayerControls supplies a LayerHeading then ContrastControl supplies another heading/reset. 03-high and 08 show the duplicate. Keep one named section and one reset tab stop.
- U4 MINOR: borrowed palette accent persists but Theme header has no override reminder. AccentOverrideNotice returns null unless kind=custom, contrary to the spec's reminder when an overlay is active. Support palette (and theme-alt as appropriate) with source label + Use theme accent, to explain why Dracula is orange while selecting themes.

## Verdict

NOT TERMINAL: U1 blocks the promised rename/edit flow. Other findings can be included in the same remediation wave or explicitly deferred. Required follow-up proof: real app or repaired Storybook wiring; pointer/native drag; actual eyedropper; mini-view/approvals/Mermaid/CodeMirror/first paint are not covered by this UX story walkthrough. No native/full-app sign-off implied.
