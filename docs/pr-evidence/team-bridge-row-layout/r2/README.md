# PR #1457 — design round 2

Captured from d204a698fb9d508fab4447da79fea97a6e8d0431, 2026-10-28.

## Provenance

A story-scoped static Storybook build reused the app's stylesheet, preview, theme provider and exported page fixtures. Node heap was capped at 1024 MB. No full Storybook build, browser-engine install or Electron launch was performed. Screenshots came exclusively from the harness browser tool, one owned tab. The page was constrained to a 1088×640 CSS-pixel flex frame inside a 1280×720 tab; source screenshots at DPR 2 were cropped to 2176×1280 device pixels, without resizing.

Scratch-only build transform made the threads/reactions hold constants query-controlled for the inspection boards. Default query leaves both holds false. Only the thread-pane image used `r2threads=open`; reactions remained false. This does NOT enable either feature in the PR or shipped product. The page's default capabilities also remain unknown unless the thread inspection story explicitly supplies `threadsCapabilityState: enabled`.

## Retained and visually inspected frames

- `01-empty-dm-1088-light.png`: empty DM, profile card closed; mark and name share their left edge.
- `02-empty-dm-trigger-focus-1088-light.png`: scratch story called `.focus()` on the avatar. **Not keyboard-focus-visible proof**: this image does not demonstrate a focus ring. D4 remains open.
- `03-populated-hover-shipped-1088-light.png`: shipped holds closed, card closed. The hover fill is a capture-only CSS mirror of the production `hover:bg-row-hover` rule, as in the repository's HoveredMessageRow story, not a trusted-pointer hover test. No action toolbar is enabled.
- `05-rail-invitation-1088-light.png` and `05-rail-invitation-1088-dark.png`: invitation entry from main's #1446 in the page rail. Badge styling was not changed or reviewed.
- `06-thread-pane-long-reply-after-HOLDS-FLIPPED-1088-light.png`: thread pane containing a 240-character token, long URL, long unbroken code line and 12-column table. Scratch threads hold open, reactions closed. The settled scroll position shows the long reply and its horizontal code/table scroll boxes within the right pane. This is an after frame only, not red/green reproduction.

## Failed or incomplete captures — no claims made

The browser host repeatedly failed its bounded health check as load remained around 40–50 and swap nearly full. Some navigation failures left the previous page on screen. Those stale-page captures were identified by inspecting their pixels and hashes and were excluded, not relabelled as successful dark or alternate-state evidence.

An emulated-before board did not restore the table wrapper (computed display remained block); that attempted capture was excluded. There is no valid thread before frame, no measured before/after overflow reproduction, and no new dark empty-DM/hover/thread frame. The earlier committed dark empty-DM and settled-picker frames were read again but are not current-head captures.

No cold-open/progressive-fill/consecutive picker frames, short-height keyboard-focus frame, or cold-open 200 ms timing were obtained. No loading/error matrix or other palette/size axes were revalidated. These remain the already-accepted D1–D4 capture follow-ups and QA's existing pending timing condition; this round does not waive them.

## Measurable checks

- `token_audit.py` on page, message list, thread pane and emoji picker: 4 files, 0 colours, 9 font sizes, 0 spacings, 0 radii; no anomalies.
- `contrast_pairs.py` using solid label/background pixels from the fresh invitation rail frames: light #4d4941 on #f7f5ef = 8.21:1; dark #c1bcb1 on #2a2722 = 7.86:1; 2 pairs, 0 below AA 4.5.
- Browser styles on empty-DM board: frame 1088×640; avatar trigger x=308, width=56; name x=308 (0 px horizontal delta). The initial non-flex frame was corrected before the retained captures; this horizontal measurement is not a vertical-position assertion.
- `dom_audit.mjs` not run: it launches a scripted browser, disallowed while the harness browser tool is available. No equivalent complete DOM audit is claimed. Browser geometry reads and actual frames supply only the targeted checks above.

The source worktree is retained for the parent agent's merge-from-main work at their explicit request. Static output is session scratch, not committed. No product source changed during this review.
