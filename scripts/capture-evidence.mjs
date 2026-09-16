#!/usr/bin/env node
/**
 * Captures visual evidence across all twelve themes from Storybook.
 *
 *     node scripts/capture-evidence.mjs [storybook-origin]   # default :6017
 *
 * Drives a PRIVATE headless Chromium over raw CDP (a fresh user-data-dir under
 * /tmp, killed on exit), with no browser-automation dependency in the repo —
 * Node's built-in WebSocket speaks the DevTools protocol directly. One
 * screenshot per theme per story, written to
 * `docs/evidence/<feature>/<story>/<theme>.webp`.
 *
 * Why this file exists. The review process for this app is visual: there is
 * no test runner, and the design contract (docs/branding.md) is judged by
 * looking at the surface in every theme, because a contrast or spacing defect
 * that hides in one theme is still a defect. A hand-taken screenshot set
 * cannot be reproduced or extended; this can, and the MR evidence comes from
 * the same tool the next reviewer will run.
 *
 * The Storybook it reads has to BUILD first, and on the tree as it stands the
 * shipped `.storybook/main.ts` cannot build its preview: it sets
 * `reactDocgen: "react-docgen-typescript"` while `package.json` pins
 * `typescript ^7.0.2`, and that pair throws `Cannot read properties of
 * undefined (reading 'React')` inside the docgen parser before a single frame
 * is taken. Boot Storybook with `reactDocgen: false` in your own checkout until
 * the config on `main` moves to `"react-docgen"`. It is pixel-neutral, measured
 * rather than argued: the whole `chat-ask-options` set re-captured under it came
 * back byte-identical to the committed frames, so it changes how the preview is
 * BUILT and nothing about what is photographed (design round 3, D12).
 */

import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints, frames as frameFiles } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence");
const ARGS = process.argv.slice(2);
const flag = (name) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : null;
};
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";

/*
 * Optional narrowing, for a REMEDIATION recapture rather than a sweep.
 *
 * `--only=<substring>` limits the story list and `--themes=a,b` the palettes;
 * either one switches the run to append-mode, so the existing set is left in
 * place instead of being deleted and re-taken. A full sweep is still the
 * default and still wipes `docs/evidence`, because a partial set that silently
 * kept stale frames is the failure this whole file exists to prevent.
 *
 * The narrowing exists because a review round asks for two frames, not 474: a
 * refresh of the whole set costs half an hour and rewrites 400 frames nobody
 * reviewed, which buries the two that changed. `manifest.json`'s
 * `partialCapture` records that this happened so the next reader can tell a
 * narrowed set from a swept one.
 */
const ONLY = flag("only");
const THEME_FILTER = flag("themes")?.split(",").filter(Boolean) ?? null;
const PARTIAL = Boolean(ONLY || THEME_FILTER);

/*
 * A backend on the configured port normally fails the run, because a captured
 * frame must be a function of the tree. `--allow-backend` states that the
 * operator knows one is running and is not capturing any surface that talks to
 * it — the tool-row stories render from fixture records and never call out.
 * It is opt-in per run, and it never applies to a full sweep.
 */
const ALLOW_BACKEND = ARGS.includes("--allow-backend") && PARTIAL;

const API_URL_LINE = /^VITE_LOCAL_OPERATOR_API_URL=(.+)$/m;

/*
 * The backend the app talks to, resolved the way the renderer resolves it:
 * `.env` if present, otherwise the schema's own default. Written out here it
 * would be a second copy free to drift from the first, which is the bug this
 * is here to catch.
 */
const BACKEND_ORIGIN = (() => {
	let configured;
	try {
		const env = readFileSync(join(ROOT, ".env"), "utf8");
		configured = env.match(API_URL_LINE)?.[1].trim();
	} catch {
		// no .env, which is the schema-default case
	}
	return new URL(configured || "http://localhost:1111").origin;
})();

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const THEMES = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
];

/**
 * The stories that constitute the evidence set: story id plus the viewport it
 * is captured at.
 *
 * This list is the review surface. A story missing from it is a surface nobody
 * looks at, and round 2 caught exactly that: the set had shrunk to eight
 * stories drawn from four of fifteen story files, so the shell, the canvas,
 * agent-hub, schedules and the composer had no visual evidence at all and two
 * findings about them could not be judged. When you add a story file, add it
 * here.
 *
 * Viewports are the real shipped sizes, not whatever fits. The installer was
 * captured at 900x700 while its own story declares 1380x800 and the shipped
 * window is 1380x800, so the committed frame was a responsive fallback with
 * the brand mark clipped in half - evidence of a layout the user never sees.
 *
 * The shell is swept at four widths because two 220px rails at 800px consumed
 * 28.5% of the window before any content, and a single wide capture hides
 * exactly that class of defect.
 */
export const STORIES = [
	/*
	 * These three DECLARE their content height rather than the 900 the harness
	 * defaults to, and the reason is a trap that cost real pixels: since the
	 * transcript became its own `overflow-auto` container, the document reports
	 * the VIEWPORT height, so `max(documentElement.scrollHeight, declared)`
	 * returns the declared 900 and the capture clips the conversation mid-line -
	 * `conversation-reasoning-open` lost 2,427px including two of the three open
	 * reasoning panels it exists to evidence. The heights are the ones these
	 * surfaces were committed with (1308 / 1409 / 3327), so the frames keep the
	 * full transcript and a re-capture is a fair comparison again.
	 */
	["chat-trace--conversation", 1280, 1308],
	["chat-trace--conversation-with-reasoning", 1280, 1409],
	["chat-trace--conversation-reasoning-open", 1280, 3327],
	["chat-trace--question-callout", 1280, 900],
	["chat-trace--trace-states", 1280, 900],
	["chat-trace--security-notice-states", 1280, 900],

	/* Session incidents on their own rows — the operator's report that an error
	  row read only `session incident` with the message behind a chevron. The
	  rows are the PRODUCTION reducer's, over fourteen real persisted payloads
	  (one per category the classifier emits, plus the three harness statements
	  and a relayed `hub_message` as the bulky control), so the frame shows what
	  the row is GIVEN rather than what a hand-written record can be made to
	  say. Sized to the rows it holds (700), for the reason `working-labels`
	  is: at 900 tall it is mostly ground, which crosses `check-evidence`'s
	  uniformity ceiling. */
	["chat-canonical-notices--session-incidents", 1280, 800],
	/* The same rows in the narrow column, which is where the wrapped row's mark
	   was measured wrong (design round 1, D1): at 560 the 17 rows wrap hardest
	   and the danger markers must still form a column. Sized to its content. */
	["chat-canonical-notices--session-incidents-narrow", 560, 1220],
	/* The notice register's own length cases, which the `notice` branch's fix
	   (design round 1, D5) is judged on: a short notice, the QA Q6 boundary
	   either side of the threshold, and a bulky one. */
	["chat-canonical-notices--notice-lengths", 1280, 340],
	/*
	 * The three states a notification click can paint before the owner answers:
	 * a cached paint with its caption, the skeleton for a first-ever open, and
	 * the named state for a conversation this machine no longer has.
	 *
	 * `the-two-misses` exists because the pair a reader most needs to tell apart
	 * is "this may be behind" against "this is gone" — two sentences, two
	 * different next actions, and a frame that shows only one of them cannot be
	 * judged for whether they are distinguishable.
	 *
	 * The narrow pass is the same caption in the narrowest chat column, where the
	 * sentence is longer than the `Reconnecting` it shares a slot with.
	 */
	["chat-notification-feed-states--cached-paint", 1280, 600],
	["chat-notification-feed-states--reconciled", 1280, 600],
	/* These two are captured in a viewport SIZED TO THEM for the reason the
	   `narrow` tool-row pass is: the vanished state is three lines and a button,
	   and at 600px it is 99.45% one colour, which `check-evidence` rejects as
	   "the story painted its ground and nothing else" — its judgement, and the
	   right one. Sizing the frame to the state keeps it a picture of the state. */
	["chat-notification-feed-states--conversation-gone", 720, 200],
	["chat-notification-feed-states--the-two-misses", 760, 200],
	["chat-notification-feed-states--cached-paint-narrow", 420, 600],
	["chat-notification-feed-states--loading-first-open", 1280, 600],
	/* The caption on a transcript TALLER than the pane, which is the ordinary
	   cached paint rather than an edge (design review round 1, D1): the cache is
	   only written for a conversation this pane has already shown, and the
	   earlier five-row frame fit, so it could not show that the sentence was
	   thousands of pixels above the fold. */
	["chat-notification-feed-states--cached-paint-overflow", 1280, 600],
	/* The gone state with the cached rows a real click arrives with — the half
	   the committed empty-rows frame cannot cover (design review round 1, D2). */
	["chat-notification-feed-states--conversation-gone-with-paint", 720, 260],

	/* The composer's two refusals and the state a vanished conversation leaves
	   it in (design review round 1, D3): the transcript stories above render the
	   transcript alone, so the false "Agent is busy" placeholder and the missing
	   colour step were never in a frame. Sized to the band, not to a window. */
	["chat-composer-states--idle", 900, 160],
	["chat-composer-states--busy", 900, 160],
	["chat-composer-states--conversation-gone", 900, 160],

	/* The browser feature's own surfaces, added with the round that remediated its
	   review. This is the ONE part of the visible browser a browser tool can
	   reach: the chrome band is ordinary DOM, while the native page view under it
	   is not (U1). So these frames are the evidence for the consent band's copy
	   and attribution (D2/D3) and for the panel a refused navigation now shows
	   (D1) — and the sizes are tight to their content, because a band is short and
	   a frame that is 99% ground crosses `check-evidence`'s uniformity ceiling. */
	["browser-consent-bar--pending", 1280, 300],
	["browser-consent-bar--attributed-and-queued", 1280, 300],
	["browser-consent-bar--unnamed-requester-no-domain", 1280, 280],
	["browser-consent-bar--an-agent", 1280, 300],
	["browser-consent-bar--busy", 1280, 300],
	["browser-load-failure--connection-refused", 1280, 420],
	["browser-load-failure--name-not-resolved", 1280, 420],
	["browser-load-failure--unmapped-code", 1280, 420],
	/*
	 * 1180 rather than 900 for the populated sheet, and the number is the fix for a
	 * measured defect (review round 2, D8): the sheet is `h-full` of the VIEWPORT
	 * with its own scroller, so at 900 the panel ended at a boundary rule with the
	 * "Browsing data" section cut off inside it, while the empty frame showed that
	 * section in full. A frame that claims to show the populated sheet has to
	 * contain it. The capture floors the viewport at this number and grows it to the
	 * content, so declaring it is what makes the whole panel photographable.
	 */
	["browser-sites-sheet--populated", 1280, 1180],
	["browser-sites-sheet--empty", 1280, 760],

	/* The TUI-parity tool rows. Swept for the states that are slow or awkward
	   to reach live — an interrupted call needs a turn stopped at the right
	   moment, an MCP name needs a server connected — and captured NARROW as
	   well as wide, because the shed order under pressure is half the design. */
	["chat-tool-rows--states", 1280, 900],
	["chat-tool-rows--names-and-fallbacks", 1280, 900],
	/* The reported defect, and the only new surface this set added: a viewer that
	   joins a turn already in flight. Its rows are built by the PRODUCTION
	   reducer from wire-shaped frames, so the frame shows what the object column
	   is actually given rather than what a hand-written row can be made to say.
	   Sized to the four rows it holds, for the reason `working-labels` is. */
	["chat-tool-rows--joined-mid-turn", 1024, 340],
	/* `narrow` is a 420px column and `working-labels` is six short lines, so
	   both are captured in a viewport SIZED TO THEM rather than in the 1280x900
	   default. At the default they are mostly empty ground — and once the rows
	   tightened to the TUI's ~20px pitch they crossed `check-evidence`'s
	   uniformity ceiling, which is that guard working as designed: a frame that
	   is 99% one colour is not a picture of the app, however correct the few
	   pixels in the middle are. */
	["chat-tool-rows--narrow", 560, 276],
	["chat-tool-rows--working", 1280, 900],
	["chat-tool-rows--working-labels", 760, 300],
	/* The `write`/`edit` diff body: the expansion the TUI shows in place of the
	   arguments. Captured at the height the story declares, because the frame IS
	   the body — a viewport shorter than the content photographs a scrolled
	   corner of it and cuts the last three cases off. The 560px pass is the same
	   content under the wrap rule: the body must wrap its long lines rather than
	   grow a horizontal scrollbar inside a disclosure. */
	["chat-tool-rows--diff-body", 1280, 2110],
	/* The narrow pass is a SECOND story rather than a second width of the first:
	   under wrapping each body grows, and the honest picture of the wrap rule is
	   one you can see whole (two cases, sized to their content) rather than seven
	   cases cropped at the frame edge. */
	["chat-tool-rows--diff-body-narrow", 560, 1380],
	/* And the case neither of those can show: the body AT THE CAP in a wrapping
	   column, where the derived 740px ceiling is too short for 40 wrapped lines
	   and the `… N more diff lines` marker would scroll out of the well. Sized to
	   its own content — one row and its body — because the marker's visibility at
	   rest is the whole claim. */
	["chat-tool-rows--diff-body-narrow-wrapped-cap", 560, 830],
	/* The expanded detail: the operator's report was that it read as
	   `JSON.stringify(args)` in one bordered box with the output in a second. The
	   review question is a READING question — does the expansion read as one pane,
	   with a labelled block per argument and the result under a label — so the
	   frames are the evidence and the assertions are elsewhere (no JSON
	   punctuation reaches the pane, no envelope reaches a receipt row: see the
	   sections in `tool-row.test.mjs` and `transcript-reducer.test.mjs`, because
	   an absence cannot be photographed). Heights are the stories' own, read off
	   the rendered frame. */
	["chat-tool-rows--expanded-detail", 1280, 760],
	/* Three results side by side — a JSON object, a JSON array, and a result that
	   only looks like JSON — because the boundary between "structured" and
	   "printed verbatim" is the rule this surface can get wrong most quietly. */
	["chat-tool-rows--expanded-json-result", 1280, 760],
	/* The failed call, where the TUI keeps the arguments beside the error: a
	   failure produces no diff, so the inputs are the only account of what was
	   attempted. */
	["chat-tool-rows--expanded-failed-edit", 1280, 420],
	/* The two receipt rows on the shared ledger, with a collapsed peer row beside
	   an expanded one — the pair that shows what the disclosure is FOR. */
	["chat-tool-rows--receipt-rows", 1280, 560],
	/* The cap, which no earlier frame exercised: every pane committed before this
	   one had `scrollHeight == clientHeight`, so nothing showed that a long
	   argument list pushed the result's label off the pane and that a scroll
	   region's overflow is invisible at rest. Two viewports because the narrow
	   column wraps the same script into more rows, and the report has to be a
	   function of the content rather than of the wide layout. */
	["chat-tool-rows--expanded-overflow", 1280, 1100],
	["chat-tool-rows--expanded-overflow-narrow", 560, 1100],
	/* The same narrow story with every capped section parked at its own END, the
	   state the round-3 pages were measured at: 0.203px of the first section's last
	   line and 0.469px of the second's stay outside the box at this width, because
	   a non-composited scroller saturates on an integer offset, and the count read
	   that residue as a whole line. It is a SECOND entry for one story rather than
	   a second story because the difference is a scroll position, which is browser
	   state a story cannot set — the reason `scrollToEnd` exists above. The at-rest
	   frames stay in their own directory: the pair is the point, since the fix is
	   that the count goes QUIET here while the box does not move. */
	[
		"chat-tool-rows--expanded-overflow-narrow",
		560,
		1100,
		{
			dir: "expanded-overflow-narrow-end",
			scrollToEnd: "[data-detail-section] > div",
		},
	],
	/* The two results that hold nothing, and the row that holds nothing to
	   disclose. The third row is the readable half of the gate fix: a call whose
	   arguments are an all-empty container and which printed nothing is a STATIC
	   row here, where it used to offer a click onto an empty bordered box. */
	["chat-tool-rows--expanded-empty-result", 1280, 420],
	/* The hostile sender, built through the production `peerFields` so the frame
	   is a picture of the app's own sanitiser output rather than of a hand-built
	   sender the app cannot produce: a bidi override beside the pid, two control
	   sequences, and a name long enough to be bounded. */
	["chat-tool-rows--receipt-hostile-sender", 1280, 300],
	/* Both row KINDS in ONE run — three tool calls with a peer receipt and a wake
	   receipt between them — because every frame before it carried one kind at a
	   time, so "the receipts share the tool rows' own name column" rested on the
	   single `toolNameColumn` measurement rather than on a picture (design round 2
	   stated that gap itself). Sized to the five rows it holds with every one of
	   them opened, for the reason `working-labels` is. */
	["chat-tool-rows--mixed-run", 1280, 830],
	/* The spacing regression surfaces. `operator-spacing-cases` reproduces the
	   three runs the operator screenshotted when he reported the rows as "much
	   too wide" and "not very uniform"; `turn-boundary-and-working-line` is
	   where the hierarchy that must SURVIVE the tightening is judged. */
	["chat-tool-rows--operator-spacing-cases", 1024, 860],
	["chat-tool-rows--turn-boundary-and-working-line", 1024, 700],
	/* Where the 2px `trace` hairline applies and where it does not: a lone call,
	   a notice inside a run, and a run that opens a turn. `operator-spacing-cases`
	   above shows the pitch INSIDE a run, which a per-row margin would reproduce
	   exactly; only these three boundaries tell the two apart. */
	["chat-tool-rows--trace-gap-boundaries", 1024, 860],

	/*
	 * The run PANEL: the right pane that replaced the popover (`§ 3`), with its
	 * roster, its child reader, its plan and its MCP section.
	 *
	 * The pane is 420px wide and the chat column takes the rest, so a frame with
	 * the pane open is captured at 1280: a viewport narrower than the pane plus the
	 * column's own floor photographs the narrow layout instead of the layout these
	 * stories exist to show. `narrow-800` is the exception, captured at 800 on
	 * purpose, because it IS the floor.
	 *
	 * The two header-only frames (`trigger-idle`, `mcp-auth-required-closed`) are
	 * 460x220 for the reason the retired `header-trigger` pair was: the button and
	 * its dot are the subject, the pane is shut, and a wide viewport of an empty
	 * transcript under a trigger is mostly ground.
	 */
	["chat-run-panel--trigger-idle", 460, 220],
	/* The trigger's HOVER grounds (design review round 2, D2-1). A pointer cannot
	   be produced by a story, so the rig dispatches a real mouse move at the
	   trigger before the shutter — the same CDP input the scroll-paging harness
	   uses. The rest states are `trigger-idle` (closed, at rest) and `panel-empty`
	   (open, at rest), so the four grounds are `canvas` / `elevated` /
	   `accent-wash` / `accent-wash`, and the last one is the fix. */
	[
		"chat-run-panel--trigger-hover",
		460,
		220,
		{ hover: "[data-run-panel-trigger]" },
	],
	[
		"chat-run-panel--trigger-open-hover",
		1280,
		700,
		{ hover: "[data-run-panel-trigger]" },
	],
	["chat-run-panel--panel-empty", 1280, 700],
	["chat-run-panel--settled-history", 1280, 700],
	["chat-run-panel--roster-only", 1280, 700],
	/* The roster's MEMBERSHIP (`§ 4`): a payload carrying a child's own `bash`
	   job, the session's own `bash` job and a nested `task` row, of which only
	   the two top-level children are members. Every tool row is typed `bash` —
	   `JobType` is `Literal["bash","task"]` (`harness/jobs.py:216`) — so the
	   fixture cannot describe a tool row the runtime has no word for (round 3,
	   R3-1). Round 1's Q1/Q2 frame. */
	["chat-run-panel--roster-members", 1280, 820],
	["chat-run-panel--todos-only", 1280, 820],
	["chat-run-panel--both-in-flight", 1280, 700],
	/* The disclosure, before and after: the pair is the whole claim that every
	   child is reachable, and nine children at a cap of six is where they differ. */
	["chat-run-panel--roster-capped", 1280, 820],
	["chat-run-panel--roster-capped-expanded", 1280, 900],
	/* The plan's two frames: every phase named, against the implicit phase beside
	   a named one — which is the pair § 6.2's finding (2) is about. */
	["chat-run-panel--todos-phased", 1280, 820],
	["chat-run-panel--todos-implicit-phase", 1280, 820],
	/* The swap in both directions, through the real `ChatContent`: the same slot
	   with the canvas open and with the run panel open. */
	["chat-run-panel--swap-canvas-open", 1280, 700],
	["chat-run-panel--swap-run-open", 1280, 700],
	/* The reader. `reader-live` here is the FIXTURE-backed rendering of a running
	   child's page; the LIVE pair is a supplementary set the manifest declares
	   (`chat-run-panel-live/`), because the drill-in is a flow against a real
	   backend and no story can produce it (`§ 11.3`). */
	["chat-run-panel--reader-live", 1280, 900],
	["chat-run-panel--reader-settled", 1280, 900],
	["chat-run-panel--reader-failed", 1280, 900],
	["chat-run-panel--reader-nested", 1280, 900],
	/* A member's page whose child count is ONE: the descend control's singular
	   label and its accessible name, in the only state that can show either
	   (round 1, Q8/U1-6), beside the peer stepper for the same child. */
	["chat-run-panel--reader-child-controls", 1280, 900],
	["chat-run-panel--reader-resumed", 1280, 900],
	/* The brief, in the one state that renders it: a child whose transcript does
	   NOT already carry the instruction, so the block is the only copy rather
	   than the same sentence twice. */
	["chat-run-panel--reader-brief", 1280, 900],
	/* `§ 10.1`'s two absences, with their separate copy — the states that break,
	   and the cheapest pair in the set to take. */
	["chat-run-panel--reader-pending", 1280, 900],
	["chat-run-panel--reader-gone", 1280, 900],
	/* A row the wire left unaddressable (`session_id` null): the reader's own
	   terminal line, reached through the breadcrumb or the sibling stepper
	   because the roster does not offer the row at all. */
	["chat-run-panel--reader-unaddressed", 1280, 900],
	/* A child's own image: its row carries a digest and the reader resolves it
	   through the child-scoped attachment op (`subagents.attachment`), which the
	   story's relay stub answers with real bytes. The renderer's half of the
	   path, in a picture. */
	["chat-run-panel--reader-image", 1280, 900],
	/* A lineage of depth 3 with the pane at its 320px floor: the width the
	   breadcrumb's cap has to survive (round 2's open residual risk). */
	["chat-run-panel--reader-deep-floor", 800, 700],
	/* The MCP section, whose states a live session cannot produce on demand: an
	   expired grant, a dead process, a word from a runtime this build has not been
	   taught, and the cold payload of a session with no runtime. */
	["chat-run-panel--mcp-all-connected", 1280, 700],
	["chat-run-panel--mcp-auth-required-closed", 460, 220],
	["chat-run-panel--mcp-auth-required", 1280, 700],
	["chat-run-panel--mcp-disconnected", 1280, 700],
	["chat-run-panel--mcp-unknown-status", 1280, 700],
	["chat-run-panel--mcp-cold", 1280, 700],
	["chat-run-panel--mcp-connecting", 1280, 700],
	/* The dot's whole discipline for the MCP ledger, driven through the real
	   trigger: the two frames below are the halves a single state cannot show —
	   the acknowledgement HOLDING once the pane closes, and the re-arm after the
	   server healed and broke again. Header-only, because both end with the pane
	   shut; the story holds the shutter until the sequence has arrived. */
	["chat-run-panel--mcp-dot-ack-acknowledged", 460, 220],
	["chat-run-panel--mcp-dot-ack", 460, 220],
	/* The remedy as a CONTROL, which is the change to § 7.2 (§ 4 of the design brief). The row's own frames
	   above show it at rest (a link where the sentence used to be, and the words
	   that survive on the states this surface cannot act on); these show the four
	   states a press produces, and all four come from the FIXTURE's `operations`
	   rather than from a handler, because that is where the row reads them. */
	["chat-run-panel--mcp-grant-running", 1280, 700],
	["chat-run-panel--mcp-grant-failed", 1280, 700],
	["chat-run-panel--mcp-grant-cancelled-removed", 1280, 700],
	/* One grant per session: the second problem row's control is disabled, in
	   colour rather than opacity. */
	["chat-run-panel--mcp-grant-locked", 1280, 700],
	/* The dialog, opened by clicking the row's own link and held until it is on
	   screen. Both consequences are in the copy because both are facts the reader
	   would otherwise discover afterwards. */
	["chat-run-panel--mcp-grant-confirm", 1280, 700],
	/* The key remedy, for a server whose transport cannot complete a browser
	   sign-in: the three decisions a payload makes (a stdio `env` name, an http
	   header name with OAuth refused, nothing declared) in one frame, and the
	   popout opened by the same click convention. The fields are the payload's own
	   declared names, never a value. */
	["chat-run-panel--mcp-key-auth", 1280, 700],
	["chat-run-panel--mcp-key-popout", 1280, 700],
	/* The settled-op state, which is where a remedy can vanish: two operations the
	   backend finished earlier in the session beside servers that are problems
	   again. Round 1's finding 1 was that this path blanked the row. */
	["chat-run-panel--mcp-grant-settled", 1280, 700],
	/* § 8's 64px shape: a grant line AND the runtime's own diagnosis under it. */
	["chat-run-panel--mcp-grant-failed-diagnosis", 1280, 700],
	/* The remedy link's hover ground and its `:focus-visible` ring. The pointer is
	   the rig's own CDP input (`{ hover }`), the same mechanism the trigger's hover
	   frames use; the ring is produced by the story, since a programmatic focus is
	   not the same thing as keyboard focus. */
	[
		"chat-run-panel--mcp-remedy-hover",
		1280,
		700,
		{ hover: '[data-mcp-remedy="grant"]' },
	],
	["chat-run-panel--mcp-remedy-focus", 1280, 700],
	/* The two dialog states a click cannot reach: the write in flight, and the
	   reconnect that came back without the credential taking. Captured at the size
	   of the dialog in its window rather than at the pane's, because the dialog is
	   portal-rendered and viewport-fixed (`check-evidence`'s uniformity ceiling is
	   the other half of the number). */
	["chat-run-panel--mcp-key-saving", 900, 620],
	["chat-run-panel--mcp-key-error", 900, 620],
	/* The pane's 320px floor with the longest action line it can hold. Round 1's D5
	   measured `Sign-in cancelled` + the credential sentence + `Try again` at 369px
	   in the 375px column a 420px pane gives, so the floor is where it has to wrap
	   rather than ellipsise. 800x700 for the reason `narrow-800` uses it: the pane
	   plus the chat column's own floor. */
	["chat-run-panel--mcp-floor-320", 800, 700],
	/* The window floor, and the two gated surfaces in one frame pair. */
	["chat-run-panel--narrow-800", 800, 700],
	["chat-run-panel--capability-absent", 1280, 700],
	/* The pane's two animated glyphs with motion reduced: the running child's
	   spinner and the MCP `connecting` mark. */
	["chat-run-panel--reduced-motion", 1280, 700, { reducedMotion: true }],
	/* The JOBS section, which is the pane's third live list: two running tool rows
	   and one settled row that is on the wire and deliberately not drawn, with a
	   child above them. The pair with `jobs-only` is the difference `openJobs`
	   makes — one section and its rows, or a quiet line. */
	["chat-run-panel--jobs-in-flight", 1280, 700],
	["chat-run-panel--jobs-only", 1280, 700],
	/* The trigger's activity blip: the pane is CLOSED and a child is running, so
	   the dot is drawn in `info`. Read against `trigger-idle` (nothing to say) and
	   `panel-empty` (pane open, no activity ink) — the ink switch is the whole claim
	   and a still is the only instrument for it. */
	["chat-run-panel--trigger-activity-dot", 1280, 700],
	/*
	 * Settings > Integrations: the surface `/mcp` LANDS ON, and the four states
	 * that report was about — the deep link revealing a named server, an argument
	 * that names nothing, the section's own search, and the borrow when no
	 * conversation is open.
	 *
	 * Captured at 1000x860 rather than the 1280 default because the section is drawn
	 * on the settings page's own column (`max-w-3xl`), so a wider viewport only adds
	 * ground either side of it; 860 is tall enough that the search box, the note and
	 * every row are in frame at once, which is what the search and borrow frames are
	 * about (`check-evidence`'s uniformity ceiling is the other half of the choice).
	 */
	["settings-integrations--deep-link-hit", 1000, 860],
	["settings-integrations--deep-link-verb-hit", 1000, 860],
	/* The shadowed case, which is the one frame where the resolution RULE becomes
	   visible: with a server named `login`, `/mcp login hubspo` resolves to `login`
	   and the section says so instead of landing in silence (round-1 code review,
	   finding 4). Recorded here so nobody re-shoots the frame above expecting a
	   delta: `deep-link-verb-hit` (`reauth hubspot`) is byte-identical to
	   `deep-link-hit` by DESIGN — the verb is a token that is not a server, it is
	   dropped, and a resolution that had something else to say would be the bug. */
	["settings-integrations--deep-link-verb-shadowed", 1000, 860],
	["settings-integrations--deep-link-miss", 1000, 860],
	["settings-integrations--no-session-fallback", 1000, 860],
	["settings-integrations--filtered", 1000, 860],
	["settings-integrations--filtered-empty", 1000, 860],
	["settings-integrations--no-servers", 1000, 860],
	/*
	 * And the state this list deliberately does NOT carry, so the omission is a
	 * decision rather than an oversight: `no-sessions-at-all` renders ONE line (the
	 * section asked the roster and there is nothing to borrow), so it never clears
	 * the ≥8-element "prepared" count this file asserts before a shutter, and the
	 * paint guard below it would refuse a frame of one sentence on ground anyway.
	 * Both guards are right. The story stays for review and QA; the frame would be
	 * padding, so it is absent and this comment says why.
	 */
	/* `/usage`: the provider quota dialog, whose rules are a port of the TUI's
	   `usage_panel.py`. Swept for the states that cannot be produced on demand
	   live — an OAuth grant has to die, a provider has to go idle past its
	   cache TTL, a weekly window has to actually run out. 1100x760 is a
	   comfortable window for the `wide` dialog (max-w-3xl = 768px) with room
	   for the scrim around it, so the frame is a picture of the dialog in its
	   ground rather than of the dialog alone.

	   `narrow` is captured at 720 because the dialog is portal-rendered and
	   viewport-fixed: a wrapper div constrains nothing, so the VIEWPORT is the
	   only thing that can produce the narrow layout. The shorter states
	   (loading, empty, error, single-provider) are captured in a viewport sized
	   to them — at 1100x760 they are mostly scrim and cross
	   `check-evidence`'s uniformity ceiling, which is that guard working. */
	["chat-usage--multi-provider", 1100, 760],
	["chat-usage--percent-only", 900, 420],
	["chat-usage--remaining-balance", 900, 400],
	/* Tall enough for all three skeleton blocks: the loading body is now
	   skeleton rows shaped like the blocks that replace them, and at 360 the
	   third one was sliced through its own card border — which is the very
	   reading ("a rendering defect, not more content below") the scroll edge
	   treatment exists to prevent, reproduced in the frame meant to show it. */
	["chat-usage--loading", 900, 470],
	["chat-usage--empty", 900, 380],
	["chat-usage--query-error", 900, 400],
	["chat-usage--fetching", 1000, 560],
	["chat-usage--stale-report", 1100, 620],
	["chat-usage--unavailable-with-last-known", 1000, 480],
	["chat-usage--reauth-required", 1000, 480],
	["chat-usage--not-reported", 1000, 480],
	/* Real-account density (eleven reports, twenty-eight windows, five
	   accounts of one provider): the one story whose body overflows its scroll
	   box, so the one that evidences the fold treatment — the 20px bottom
	   fade, the `border-control` rule under the body, and their ABSENCE on
	   every state that fits. 1100x1000 is `real-data`'s own viewport, chosen
	   for the same reason: at 1000px tall the body cap `min(60vh,520px)`
	   bottoms out at the 520px constant against ~1300px of content, so the
	   fold is deep enough that a shallow overhang cannot masquerade as it.
	   The density cannot be re-derived from the backend on demand (it needs
	   live credentials at every provider), which is exactly why it is a story:
	   the sweep can always re-take this frame. */
	["chat-usage--dense", 1100, 1000],
	["chat-usage--narrow", 720, 620],
	/* The session status strip. Captured at a viewport SIZED TO THE FRAMES for
	   the same reason the tool rows are: these are short rows in a box, and at
	   1280x900 they are mostly empty ground, which crosses `check-evidence`'s
	   uniformity ceiling. The two tooltip stories need vertical room for the
	   panel to open ABOVE the trigger, which is why they are taller than the
	   content they hold. */
	["chat-session-status-strip--states", 860, 1140],
	["chat-session-status-strip--cost-states", 860, 780],
	["chat-session-status-strip--effort-states", 860, 780],
	["chat-session-status-strip--long-model-name", 860, 420],
	["chat-session-status-strip--absolute-rungs", 860, 600],
	["chat-session-status-strip--honest-unknowns", 860, 760],
	/* The 220px column is the canvas-open floor, and the width the composer's
	   button row was already over budget at. Captured narrow, because the shed
	   order under pressure is half the design. */
	["chat-session-status-strip--collapsed-column", 340, 560],
	["chat-session-status-strip--context-tooltip", 860, 400],
	["chat-session-status-strip--tooltip-honesty", 860, 400],
	["chat-session-status-strip--cost-tooltip", 860, 400],
	/*
	 * The sidebar's session-status mark, in the one place it can be photographed:
	 * the sidebar itself has no story (see the note below), so the read/unread
	 * specimen matrix is the surface that carries this mark's pixels. Added by
	 * the receipt round, whose whole visible delta is one glyph's resting state
	 * -- without a frame here, that change had no evidence anywhere.
	 */
	["chat-session-status--neighbours", 860, 600],
	/* The draft's three readings, which only exist on a session-less pane. Its
	   frames are declared here rather than left to the live app because the
	   preview op they need ships on a different branch: what a story can judge is
	   the RENDERING rule (no cost chip, an empty ring, inert labels), and that is
	   the part this set owns. The box is 900 - the composer's own width in the
	   live frames - rather than the 720 its siblings use, so the draft and the
	   populated session can be compared at one width. The tooltip story needs
	   room for the panel above the trigger. */
	["chat-session-status-strip--draft", 1000, 400],
	/*
	 * The SAME draft on a backend that can select for it. Captured beside `--draft`
	 * so the pair is a like-for-like: the affordance is the only difference, and the
	 * strip measures 92px in both, at every width this set declares, with only the
	 * chips' ink differing (review round 1, R5). The pane is 1000 wide so the wide
	 * reading and the 220px floor both fit in one board, at the same viewport the
	 * inert draft uses. The boards differ in number by design: each story carries its
	 * own empty state.
	 */
	["chat-session-status-strip--draft-actionable", 1000, 400],
	["chat-session-status-strip--draft-tooltip", 1000, 520],
	/*
	 * The same tooltip and the same chip one capability apart, plus the hover the
	 * control's affordance actually rests on: `--draft-actionable-tooltip` is the
	 * accessible name of the chip that DOES open, and
	 * `--draft-actionable-hovered` is that chip under the pointer, which the
	 * harness performs and asserts (design round 1, D1).
	 */
	["chat-session-status-strip--draft-actionable-tooltip", 1000, 520],
	[
		"chat-session-status-strip--draft-actionable-hovered",
		1000,
		400,
		{ hover: 'button[aria-label^="Model:"]' },
	],
	["chat-session-status-strip--commands-off", 1000, 300],
	/* The composer's status row: the goal and the plan, above the box.
	 *
	 * Four frames, each carrying several bands so every claim has its control
	 * beside it — the row's states in the record's own order, a goal that fits
	 * above one that truncates, the collapsed row above its expanded form, and
	 * that pair again at the column floor. A single band would be one number
	 * with nothing to compare it to.
	 *
	 * Viewports are SIZED TO THE CONTENT for the reason the strip's frames are:
	 * these are one line and a box, and at 1280x900 the frame would be almost
	 * entirely ground, which crosses `check-evidence`'s uniformity ceiling.
	 *
	 * `states` opens with the band where the row renders NOTHING: that band is
	 * the pre-change composer, so it is the "before" half of the pair whose
	 * "after" is the same frame's fourth band. 900 is the composer's own column
	 * width and 172 is the column floor with the canvas pane open — the width QA
	 * measured on the built app, not the 220 this entry used to say, and the story
	 * now derives the small-view step from its own band width so the floor's
	 * numbers are the product's (design review round 1, D3). The two stories with
	 * an expanded band are clicked open by the rig's own convention.
	 */
	["chat-composer-status-row--states", 1000, 880],
	/* Three bands now: the two goal lengths, plus the long goal beside all four
	   chips (design review round 1, D4) — the width the goal YIELDS is the change
	   and it was unmeasured, so the band prints the goal item's box against its
	   text's `clientWidth`/`scrollWidth`. */
	["chat-composer-status-row--long-goal", 1000, 560],
	["chat-composer-status-row--expanded", 1000, 500],
	["chat-composer-status-row--column-floor", 300, 620],
	/* The two ACTIVITY chips, one band per state, with the state they must not
	   render for as the last one — a session whose rows have all settled, where
	   `frontend.jobs` still holds the rows and the row says nothing about them.
	   Sized to content for the reason the four above are. */
	["chat-composer-status-row--activity-chips", 1000, 1000],
	/* The width story, and the only frame that can carry the numbers: each band
	   prints its own row height and `overflowX` into the picture, because a reader
	   of a still cannot measure the boxes in it. 900 is the composer's own column,
	   240 is `CHAT_CHIP_ICON_ONLY_PX`, and 172 is the floor QA measured on the built
	   app — the three widths at which the row behaves differently. */
	["chat-composer-status-row--activity-widths", 1000, 1000],
	/* The activity mark with motion reduced, which is the OTHER half of the paint
	   the mark's own animation cannot prove: `styles/index.css` CAPS durations at
	   0.01ms rather than cancelling anything, so the frame has to show that the
	   mark lands on a visible end state and that the shape still reads as the
	   state it stands for. A second entry with its own `dir` because the state is a
	   viewport feature, which a story cannot set. */
	[
		"chat-composer-status-row--activity-chips",
		1000,
		1000,
		{ dir: "activity-chips-reduced-motion", reducedMotion: true },
	],
	/* The 240px arrangement, which is where the row's edges differ (design review
	   round 1, D2/D5): the goal's line, then the counts as one group. Three tuples
	   of ONE story, differing only in the browser state the rig applies — at rest,
	   with a real pointer on the goal's trigger, and with the real Tab key having
	   walked to a chip. `:hover` and `:focus-visible` are both browser state, so
	   neither can be a story prop, and a story that faked the class would be a
	   picture of the fake. */
	["chat-composer-status-row--activity-stacked", 260, 320],
	[
		"chat-composer-status-row--activity-stacked",
		260,
		320,
		{ dir: "activity-stacked-hovered", hover: "[aria-expanded]" },
	],
	[
		"chat-composer-status-row--activity-stacked",
		260,
		320,
		{ dir: "activity-stacked-focused", tabTo: "[data-status-subagents]" },
	],
	/* The SECOND hover, on a count chip rather than the goal, because one frame can
	   hold one pointer: the pair is what shows that the goal's ground (the row's
	   leading chip, `-ml-1.5`) starts at the row's own edge and the stacked chips'
	   grounds start at theirs. A hovered frame carries no tooltip, which is why this
	   pair is the clean way to compare two grounds. */
	[
		"chat-composer-status-row--activity-stacked",
		260,
		320,
		{ dir: "activity-stacked-chip-hovered", hover: "[data-status-jobs]" },
	],
	/* THE MOTION PAIR, and the only frames in this repository captured with live
	   animation: the rig's default injects `animation: none !important` before every
	   shutter, so no two stills of one story could ever differ by a spin. These two
	   are the same story, the same theme and the same rig, a rotation angle apart -
	   the composer's running-state mark actually turning. They prove the mark animates
	   in the built stylesheet; they do NOT prove the mark's resting visibility under
	   reduced motion (that is the `-reduced-motion` tuple) and they are not a live
	   app: the wire is a fixture. `docs/evidence/chat-composer-status-row/README.md`
	   states both limits. */
	[
		"chat-composer-status-row--activity-mark-motion",
		1000,
		220,
		{ dir: "activity-motion-1", liveMotion: true, phaseMs: 0 },
	],
	[
		"chat-composer-status-row--activity-mark-motion",
		1000,
		220,
		{ dir: "activity-motion-2", liveMotion: true, phaseMs: 500 },
	],
	/* The two alignment surfaces. `prose-tool-alignment` is where the operator's
	   report is judged — agent prose and a ledger row sharing one left rail and
	   one right edge — and it is swept at two widths because a max-width cap
	   only binds on a wide column, so a single narrow capture would photograph
	   the defect as absent. `streaming-before-first-token` is the state that
	   used to paint a "Writing" row above the working line; its claim is an
	   ABSENCE, so it needs a frame of its own to be checkable. */
	["chat-tool-rows--prose-tool-alignment", 1024, 700],
	["chat-tool-rows--prose-tool-alignment", 1440, 900],
	["chat-tool-rows--streaming-before-first-token", 1024, 620],
	/* The cold engage: a send the app has admitted and the owner has not answered
	   yet - the operator's "I hit send and nothing happens for three seconds".
	   Captured as a PAIR with its baseline, because the claim is a difference:
	   the baseline is the same transcript with the wait line absent (what the app
	   painted before this change), and the two frames differ by one quiet line at
	   the foot. A single frame of the fixed state would not say what was wrong,
	   and a single frame of the baseline would not say what replaced it. All four
	   are swept together from design review round 1: the SMALL-VIEW wrapper is a
	   different wrapper for the same rung (the 560px `narrow` entry above is a
	   narrow column, not the small view), and `transport-down` is the rung's
	   second clear, which the story could not express while its `status` was
	   hardcoded to `live`. */
	["chat-tool-rows--admitted-send-before-first-frame", 1024, 300],
	["chat-tool-rows--admitted-send-before-first-frame-baseline", 1024, 300],
	["chat-tool-rows--admitted-send-before-first-frame-small-view", 560, 300],
	["chat-tool-rows--admitted-send-transport-down", 1024, 300],
	/* The COMPOSER half of the same claim, and the head's. Design review round 2's
	   D3: this change adds a sentence to the composer ("Waiting for the agent")
	   and nothing committed showed it, so the round could not sign the string off.
	   All four are at the rung frames' 1024 width on purpose - the two surfaces
	   are read together, and a composer photographed at another width cannot be
	   laid beside the pane it sits under. `awaiting-reply-transport-down` is the
	   state D5 is about, taken AFTER the fix: the pane has withdrawn the line for
	   a dead transport and the composer's hint goes with it, so this frame reads
	   "Ask me for help" where the pre-fix app said "Waiting for the agent". */
	["chat-message-input--idle", 1024, 300],
	["chat-message-input--awaiting-reply", 1024, 300],
	["chat-message-input--awaiting-reply-transport-down", 1024, 300],
	["chat-message-input--awaiting-answer", 1024, 300],
	/* The interrupt's own states, on the same 1024 measure as the rows above.
	   The third is the only one that SPEAKS: a stopped turn with nothing left
	   under it renders nothing at all, so the control's presence and its absence
	   are the pair a reviewer reads, and the notice is its own frame. */
	["chat-message-input--stop-control-while-streaming", 1024, 300],
	["chat-message-input--stop-control-without-capability", 1024, 300],
	["chat-message-input--interrupt-left-work-running", 1024, 300],
	/* The reservation (UX round 1's U1 / QA's Q1) at both rungs, the two shorter
	   notice branches (design round 1's N2), and the version-skew line. The
	   reservation has no ink of its own by design, so its frames are read against
	   `stop-control-while-streaming` (the same cluster, occupied) and
	   `stop-control-without-capability` (a backend that reserves nothing). */
	["chat-message-input--stop-slot-reserved", 1024, 300],
	["chat-message-input--stop-slot-reserved-small-view", 1024, 300],
	["chat-message-input--interrupt-left-children-only", 1024, 300],
	["chat-message-input--interrupt-left-jobs-only", 1024, 300],
	["chat-message-input--interrupt-unavailable-old-backend", 1024, 300],
	/* The COMMON case, which had no standing frame until design review round 1
	   (D4) asked for one: an answer mixing prose with a fenced code block, a
	   table and a list. The alignment frames above are plain paragraphs, and
	   `<pre>`/`<table>`/`<ul>` are exactly the blocks that escaped the measure
	   in two earlier rounds — so the surface the change is most about was the
	   surface the sweep could not see. Captured at 1440 because the room the
	   removed cap gives back is what the table uses.

	   The declared height MATCHES the story's own `Frame height={700}`. The
	   probe below floors the capture at the declared viewport, so declaring 900
	   against a 700px story padded the frame with 257px of empty ground that
	   no reviewer is meant to read (design review round 2, D9). */
	["chat-tool-rows--mixed-prose-code-and-tables", 1440, 800],
	/* The `ask` gate's options, which became real controls rather than an inert
	   numbered list. Swept because these states are slow and awkward to hold
	   open live — a gate ends the moment anyone answers, and eight options, a
	   wrapping label, a multi-question ask and a secret ask (no options at all)
	   are not states a live session offers on demand.

	   Each height MATCHES its story's own `Frame height`: the capture floors at
	   the declared viewport, so declaring more than the story renders pads the
	   frame with empty ground and crosses `check-evidence`'s uniformity
	   ceiling. 1024 wide is the chat column at a realistic desktop width, where
	   the 900px measure cap actually binds. */
	["chat-ask-options--options", 1024, 470],
	["chat-ask-options--single-option", 1024, 380],
	/* The app's own default window is 1380x900, which leaves this pane about
	   617px once the header and the composer band come out. Captured here rather
	   than at the story's old 820 because 820 was chosen to fit the content, and
	   a viewport sized to fit cannot show that the content does not fit (design
	   round 1, D1). */
	["chat-ask-options--many-options", 1024, 620],
	/* Two widths, because the label only wraps below ~900px: at 1024 the story
	   photographed an unwrapped label while claiming to exercise wrapping (design
	   round 1, D5). 760 was the second width and it did NOT wrap the label either —
	   the label box there measures one 19.5px line (its single-line measure is
	   ~581px against a 616px button interior) and the thing that dropped to a
	   second line was the `Recommended` mark, so the committed pair showed the
	   ordinal pinned to a wrapped MARK, not to a wrapped label (design round 2,
	   D9). 560 puts the button interior under the label's own measure, which is
	   where the property this story exists for actually happens. */
	["chat-ask-options--wrapping-labels", 1024, 620],
	["chat-ask-options--wrapping-labels", 560, 620],
	["chat-ask-options--multi-question", 1024, 450],
	["chat-ask-options--answer-in-flight", 1024, 470],
	["chat-ask-options--secret-ask", 1024, 360],
	["chat-ask-options--approval-unchanged", 1024, 360],
	["design-system-primitives--all-primitives", 1280, 1600],

	/* `/model`: the desktop model picker's FEEDBACK states, which is the
	   operator's report ("insufficient feedback on hover, click ... that the
	   model selection change has happened"). These are the states a live session
	   cannot be asked for on demand: a catalogue that never answers, a command
	   that is in flight while you look at the row you clicked, a per-provider
	   listing failure. The viewport is the dialog (max-w-xl = 576px) plus scrim
	   at the shipped window scale, and the shorter states are captured in a
	   viewport sized to them for the reason the usage states are — at 900 tall a
	   three-line spinner is mostly ground, which crosses `check-evidence`'s
	   uniformity ceiling.

	   `hovered` and `keyboard-highlight` are captured as a PAIR on purpose:
	   both reach the same row state, one by pointer and one by arrow key, so the
	   frames can be differenced to answer "can the user tell them apart?".
	   `narrow` is 560 because that is where the toolbar's persist checkbox and
	   refresh button stop fitting on one line. */
	["chat-model-picker--populated", 900, 760],
	["chat-model-picker--hovered", 900, 760],
	["chat-model-picker--keyboard-highlight", 900, 760],
	["chat-model-picker--busy", 900, 780],
	["chat-model-picker--result", 900, 820],
	["chat-model-picker--persist-checked", 900, 760],
	["chat-model-picker--refresh-pending", 900, 620],
	["chat-model-picker--loading", 900, 560],
	["chat-model-picker--empty", 900, 560],
	["chat-model-picker--partial-error", 900, 560],
	["chat-model-picker--narrow", 560, 820],

	/*
	 * `/move`: NO SWEPT ENTRY, and the absence is the honest state of this
	 * branch's evidence rather than an oversight.
	 *
	 * The five chip states and the two picker states this block used to declare
	 * were withdrawn together with their committed frames - 84 `.webp`. Two
	 * reasons, and the second is the one that decides it:
	 *
	 *  1. They were taken by driving a scripted browser (this script, over CDP),
	 *     which is not an acceptable method for this feature's visual evidence.
	 *  2. They photograph the PRE-remediation UI. The chip gained a spinner for
	 *     the in-flight state, an at-rest chevron, a fixed path column, a
	 *     measured-overflow tooltip and a new refusal/announcement path; the menu
	 *     gained a bounded scrollable body. Frames of the old pixels under these
	 *     filenames would describe a superseded control, whatever their
	 *     provenance - which is why they were deleted rather than retained with a
	 *     disclosure.
	 *
	 * The replacement frames ARE captured, and they are deliberately NOT here:
	 * `docs/evidence/chat-cwd-move-live/` is a declared supplementary set of
	 * fifteen browser-tool frames in eleven states across three themes
	 * (`localOperatorLight`, `localOperatorDark` and `dracula`) with its own
	 * README, `source` and `why` — the counts here name the set's own entry in
	 * `docs/evidence/manifest.json`, which is where they are derived from and the
	 * only place a reader should take them from (agent review round 3, R3-2). The method is the operator's own rule -
	 * page interaction and screenshots go through the Local Operator browser tool,
	 * never a scripted or downloaded engine - so the capture can neither be
	 * produced nor reproduced by this file, and adding the stories back to STORIES
	 * below would re-commit the very thing the withdrawal was about.
	 *
	 * The picker states are GONE rather than merely unphotographed, and that is a
	 * product change: `/move` no longer mounts a dialog that hosts the chip (it
	 * focuses the composer's own chip), so there is no picker left to photograph
	 * and no story file left to sweep.
	 */

	/* The band's own half of U1: the model reading painted from the user's pick
	   before the owner's frame confirms it. Two frames in one story, so the
	   pending mark is judged against the same reading at full weight. */
	["chat-session-status-strip--model-switch-pending", 860, 480],

	/* App shell, swept for the rail-width finding. */
	["shell-app-shell--agents", 1280, 800],
	["shell-app-shell--agents", 1000, 800],
	["shell-app-shell--agents", 900, 800],
	["shell-app-shell--agents", 800, 800],
	["shell-app-shell--settings-appearance", 1280, 800],
	["shell-app-shell--settings", 1280, 800],
	["shell-app-shell--agents-empty", 1280, 800],
	["shell-app-shell--rail-collapsed", 1280, 800],

	/*
	 * Settings, Application updates and info, in the state the operator reported:
	 * the app is current and the server trails, so one press of Check for updates
	 * offers the server release. The story scripts the whole answer - both
	 * channels' own events and the verdict the check returns - because the defect
	 * is the panel and the snackbar disagreeing, and it is captured on two trees
	 * (this one and a worktree at the pre-fix commit) so the pair shows the
	 * contradiction rather than arguing it. Captured from a PRODUCTION Storybook
	 * build, because the button does not check at all when import.meta.env.DEV is
	 * true; see the story's own note.
	 */
	["settings-app-updates-section--server-update-offered", 900, 460],

	/*
	 * The other half of the same story: both channels proved current, so the
	 * verdict carries the affirmation and no offer is raised. Captured here
	 * because the sentence is new copy - the removed button stories drew their
	 * own "latest version" alert from a channel event, which is a state the
	 * shipped button can no longer produce, so the sweep had no frame of the
	 * sentence the fix introduces. Not captured on a pre-fix tree: the
	 * affirmation exists only on this one.
	 */
	["settings-app-updates-section--all-current", 900, 460],

	/* Canvas: the second-largest surface, and the one with the data grids. */
	["canvas-workspace--markdown-document", 1280, 900],
	["canvas-workspace--markdown-format-menu", 1280, 900],
	["canvas-workspace--spreadsheet", 1280, 900],
	["canvas-workspace--code", 1280, 900],
	["canvas-workspace--code-focused", 1280, 900],
	["canvas-workspace--files", 1280, 900],
	/*
	 * The panel's completeness states, and the four media viewers.
	 *
	 * These are the stories the design round judges the two changes this branch
	 * added to the panel: the head that states what the scan has and has not read
	 * (`files-scanning`, `files-scan-stopped`, `files-scan-stopped-empty` - the
	 * three states the head has to answer for, including the one where it is the
	 * only thing on screen), and the one chrome idiom the four viewers now share
	 * (`pdf-viewer`, `image-viewer`, `audio-viewer`, `video-viewer`). The viewers
	 * read bytes over IPC, which the story installs a fixture for, so each frame
	 * shows a real picture rather than an "Opening…" line; the video frame is the
	 * one state the offline harness can produce, and `canvas.stories.tsx` says so
	 * at the story.
	 */
	["canvas-workspace--files-scanning", 1280, 900],
	["canvas-workspace--files-scan-stopped", 1280, 900],
	["canvas-workspace--files-scan-stopped-empty", 1280, 900],
	["canvas-workspace--pdf-viewer", 1280, 900],
	["canvas-workspace--image-viewer", 1280, 900],
	["canvas-workspace--audio-viewer", 1280, 900],
	["canvas-workspace--video-viewer", 1280, 900],
	["canvas-workspace--variables", 1280, 900],
	/* The other seven states the code-memory panel defines. They are separate
	   stories rather than one story with a knob because each is a claim about
	   what the panel SAYS when the backend answers differently - and two of them
	   (no kernel, a draft) are claims about what it does not say, which a
	   populated frame cannot show. */
	["canvas-workspace--variables-empty-with-kernel", 1280, 900],
	["canvas-workspace--variables-no-kernel", 1280, 900],
	["canvas-workspace--variables-draft", 1280, 900],
	["canvas-workspace--variables-busy", 1280, 900],
	["canvas-workspace--variables-unsupported", 1280, 900],
	["canvas-workspace--variables-backend-too-old", 1280, 900],
	/* The refusal toast, driven through the real form by the story's play
	   function: the only frame in this set whose subject is a control's
	   outcome rather than a rest state. */
	["canvas-workspace--variables-write-refused", 1280, 900],
	/* The six states remediation round 1 added, each because a round named the
	   claim it could not judge from the frames that existed (design D2/D3/D5,
	   the backend's truncation edge, and the failure branch whose copy still
	   carried the advice this PR retires). */
	["canvas-workspace--variables-backend-unreachable", 1280, 900],
	/*
	 * The panel's FIRST question failing, as distinct from the read failing:
	 * the capabilities query rejects, so the panel cannot say whether the
	 * backend is old or absent and quotes the transport (design round 2, D4).
	 */
	["canvas-workspace--variables-capabilities-unreachable", 1280, 900],
	["canvas-workspace--variables-truncated", 1280, 900],
	["canvas-workspace--variables-row-actions", 1280, 900],
	["canvas-workspace--variables-uneditable-row", 1280, 900],
	["canvas-workspace--variables-delete-confirm", 1280, 900],
	["canvas-workspace--diff-review", 1280, 900],
	["canvas-workspace--edit-prompt", 1280, 900],

	["agent-hub-page--grid", 1280, 900],
	["schedules-page--list", 1280, 900],
	["schedules-page--picker-open", 1280, 900],
	["schedules-page--row-actions-revealed", 1280, 900],
	["schedules-page--row-action-label", 1280, 900],
	["common-confirmationmodal--dangerous", 1280, 900],
	["common-updatenotification--update-available", 1280, 900],
	// The state before an install commits: the bundle is downloaded and the footer
	// that the install fix changed is on screen. It renders the component's own
	// markup now, so the frame cannot drift from it (review U16).
	["common-updatenotification--downloaded", 1280, 900],
	// The install outcomes the 0.17.0 update never showed: a refusal with its
	// remedy, and the next start admitting the install did not take.
	["common-updatenotification--install-blocked", 1280, 900],
	// The same refusal from the start-up pass, which is the other producer of it:
	// the running bundle was already broken and no update was in play, so the copy
	// has to describe that instead of an update that never happened (review R2).
	["common-updatenotification--install-blocked-at-startup", 1280, 900],
	["common-updatenotification--install-failed", 1280, 900],
	// The 2026-09-13 outcomes: an install that is STILL RUNNING when the app comes
	// back (not a failure, and the one state whose action decides whether the
	// install lives), and the failure afterwards that names the relaunch as what
	// cancelled it. Both are states the operator saw the hard way.
	["common-updatenotification--install-in-flight", 1280, 900],
	[
		"common-updatenotification--install-failed-cancelled-by-relaunch",
		1280,
		900,
	],
	// A server the app does not own, with the command that fits how it was
	// installed (the pip line the operator was shown is gone) - from both
	// producers of that state: one the app installed itself, and one it merely
	// attached to after the user started it in a terminal.
	["common-updatenotification--backend-manual-required", 1280, 900],
	[
		"common-updatenotification--backend-manual-required-existing-server",
		1280,
		900,
	],
	["common-updatenotification--backend-update-non-managed", 1280, 900],
	["command-palette-commandpalette--default", 1280, 800],
	/*
	 * Two more than the set had, and both for a reason: `--filtered` is the only
	 * frame that shows what a QUERY does to the list (the heading that changes
	 * group, the dimmed hint, the key legend replacing the scope legend), and
	 * `--settings-scope` is the only one that shows a prefix doing its job —
	 * `,theme` finds a row the settings rail calls Appearance.
	 */
	["command-palette-commandpalette--filtered", 1280, 800],
	["command-palette-commandpalette--settings-scope", 1280, 800],
	["command-palette-commandpalette--commands-scope", 1280, 800],
	["command-palette-commandpalette--no-results", 1280, 800],

	["onboarding-onboardingmodal--default", 1280, 900],
	/*
	 * `--radient-sign-in` was REMOVED, not renamed: the story went away with the
	 * Tailwind v4 landing (bb57a4080) and this list was not updated with it. The
	 * harness checks every id against the manifest before it captures anything,
	 * so ONE dead id made the whole sweep abort - `unknown story id(s):
	 * onboarding-onboardingmodal--radient-sign-in`. The frames the story used to
	 * produce are declared in `manifest.json` as a historical set rather than
	 * re-derived by a sweep that cannot reach them.
	 */
	["onboarding-onboardingmodal--create-agent", 1280, 900],
	["onboarding-onboardingmodal--congratulations", 1280, 900],

	/* 1380x800 is what the story declares and what the app window ships. */
	["installer-installercontent--default", 1380, 800],
	/* The transcript's top slot. Its whole claim is that it does not change
	   height, which is a COMPARISON between states — so the boards stack the
	   states between rules rather than showing one per frame. `app-minimum-width`
	   is captured because the wide board is what let a wrapping failure state
	   ship: the failure copy fits at 512px and wraps at the 252px the content box
	   measures at the app's own 800px minimum window. Sized to the boards. */
	["chat-older-history-slot--every-state", 900, 460],
	["chat-older-history-slot--app-minimum-width", 900, 720],
	["chat-older-history-slot--one-hidden-row", 900, 260],
	/* The transport-down branch: a failure the reader cannot answer is not
	   painted as one. Paired rows at both widths, so the comparison is in the
	   frame rather than across two of them. */
	["chat-older-history-slot--transport-down", 900, 800],

	/* The other half of the transcript's completeness: a reader who returns from
	   another conversation, in the two states the fix is about. The claim is a
	   COMPARISON — the same transcript with the rows written during the absence
	   missing, then present — so the pair is what carries it, and both are built
	   by the production reducer from wire-shaped frames (the way
	   `chat-tool-rows--joined-mid-turn` is). Sized to their own content: the
	   transcript is `overflow-auto` with `column-reverse`, so a viewport shorter
	   than the rows photographs a scrolled corner of it and cuts off the oldest
	   rows — which are exactly the ones in question. */
	["chat-reconnect-gap--gap", 1024, 480],
	["chat-reconnect-gap--restored", 1024, 560],
	/* The state the report is about: the reader returns WHILE the turn runs. The
	   restored rows carry a call that succeeded and one that failed, and the
	   turn's own liveness line and running call sit below them. Captured in the
	   two `localOperator` palettes only: the claim is about the ink/ground
	   relationship of three states the brand pair already spans, and the palette
	   floors belong to `check-themes`, not to a twelve-frame sweep of one state. */
	["chat-reconnect-gap--restored-running", 1024, 620],
	/* `/`-completion: the composer's slash popup, in both of its phases.
	   Captured from `slash-commands.stories.tsx`, which renders the PRODUCTION
	   popup from wire-shaped fixtures — the rows the backend's
	   `command-entities` route sends, shaped by the production `argumentRows`
	   and ranked by the production `matchCommands`, so a frame here is evidence
	   about a shape that really arrives rather than a hand-written list.

	   Sized to the popup plus the composer box it anchors to, at the width the
	   popup actually spans (the composer's, not the window's), because the
	   numbers column's shed order is measured against THAT width: the narrow
	   entry is a 330px composer, which is what the `@container/slash` query
	   answers. A frame taken at 1280 would photograph a layout no composer has
	   and hide the one rule this set exists to show. */
	["chat-slash-completion--command-phase", 768, 460],
	/* Two rows: `/tea` matches the primary and its alias, in registry order. */
	["chat-slash-completion--command-phase-narrowed", 768, 220],
	/* One row, found by SUBSEQUENCE — `/lgt` finds `logout` where the old
	   prefix filter found nothing. */
	["chat-slash-completion--command-phase-fuzzy", 768, 200],
	/* Six teams, one marked current: the roster the word-completion opens. */
	["chat-slash-completion--argument-phase-teams", 768, 340],
	/* And the same list narrowed by the ARGUMENT, not by the command word. */
	["chat-slash-completion--argument-phase-narrowed", 768, 200],
	/* The price/window column: `free`, `usage-based`, a three-significant-
	   figure pair, and a row nobody quoted (blank, never `free`). */
	["chat-slash-completion--argument-phase-models", 908, 320],
	/* The cold-owner empty list — "not reported yet", which is a different
	   fact from "this model has none". */
	["chat-slash-completion--argument-phase-empty", 768, 300],
	/* The shed order under pressure: numbers dropped, name kept. */
	["chat-slash-completion--argument-phase-narrow-composer", 378, 300],
	/* A command typed into a sentence, the list above the prose. */
	["chat-slash-completion--inline-mid-draft", 768, 340],
	/* The state a name pick produces: list closed, caret after the space. */
	["chat-slash-completion--name-list-completed", 768, 260],
	/* A long list: the popup keeps its own scroll at its row cap. */
	["chat-slash-completion--command-phase-scrolled", 768, 460],
	/* The SIXTH inline source and the only renderer-local one: `/theme` lists the
	   `@shared/themes` table its dialog reads. Added with the round-1 disclosure
	   (R4) so the inline set has evidence for every source it claims. */
	["chat-slash-completion--argument-phase-themes", 768, 340],
	/* A query that matches nothing while the list HAS rows — its own sentence,
	   not "not reported yet". */
	["chat-slash-completion--argument-phase-no-match", 768, 200],
	/* Loading and failure, the two transient states that had no frame (D5). */
	["chat-slash-completion--argument-phase-loading-and-error", 768, 300],
	/* The truncation HALF of the shed order at ~520px: numbers shown, name
	   giving. The 330px frame shows numbers dropped and the 908px frame shows
	   nothing squeezed, so this is the width where the question lives (D5). */
	["chat-slash-completion--argument-phase-truncating-name", 768, 680],
	/*
	 * The five read-only diagnostic panels (`/analytics`, `/session`, `/info`,
	 * `/context`, `/failovers`).
	 *
	 * One viewport family, because the panel shell is one geometry: `max-w-5xl`
	 * (1024px) plus the scrim, so 1140 is the narrowest viewport in which the
	 * dialog is its own shipped width rather than a responsive fallback. The
	 * heights are sized PER STATE, and that is the same call `/usage`'s states
	 * make: at a fixed 1100 tall, `empty`, `loading` and `gated` are mostly scrim
	 * and cross `check-evidence`'s uniformity ceiling, which is that guard
	 * working rather than a frame to argue with. `dense` is the one frame that
	 * has to overhang: it exists to show the fold rule and the 20px fade over a
	 * body that really does continue.
	 *
	 * `narrow` is 720 for the reason `/usage`'s is: the picker host is
	 * portal-rendered and viewport-fixed, so the VIEWPORT is the only thing that
	 * can produce the narrow layout. Every other entry is the dialog's own size.
	 */
	["panels-analytics--populated", 1140, 980],
	["panels-analytics--refreshing", 1140, 980],
	["panels-analytics--thirty-days", 1140, 1020],
	["panels-analytics--this-session-only", 1140, 980],
	["panels-analytics--unpriced", 1140, 980],
	["panels-analytics--partial-cost", 1140, 980],
	["panels-analytics--no-daily-rows", 1140, 980],
	["panels-analytics--unnamed-sessions", 1140, 980],
	["panels-analytics--empty", 1140, 460],
	["panels-analytics--loading", 1140, 460],
	["panels-analytics--unavailable", 1140, 400],
	["panels-analytics--dense", 1140, 1100],
	["panels-analytics--narrow", 720, 980],

	["panels-session--populated", 1140, 1000],
	["panels-session--tree-cost", 1140, 1000],
	["panels-session--tree-cost-unmeasured", 1140, 1000],
	["panels-session--no-tool-calls", 1140, 1000],
	["panels-session--zero-samples", 1140, 1000],
	["panels-session--unpriced", 1140, 1000],
	["panels-session--empty", 1140, 520],
	["panels-session--unavailable", 1140, 400],
	["panels-session--loading", 1140, 460],
	["panels-session--gated", 1140, 400],
	["panels-session--dense", 1140, 1150],
	["panels-session--narrow", 720, 1000],

	/* The settings usage chart's frame over a fixture — the live settings
	   surface needs a signed-in Radient tenant, so this is the honest half. */
	["panels-settings--usage-chart-tokens", 1140, 560],
	["panels-settings--usage-chart-credits", 1140, 560],
	["panels-info--populated", 1140, 1040],
	/* The live half null and nothing bound: the payload the desktop's own route
	   always sends, with the three unknown spellings it must render. */
	["panels-info--live-half-unmeasured", 1140, 1040],
	["panels-info--behind", 1140, 1040],
	["panels-info--never-checked", 1140, 1040],
	["panels-info--build-skew", 1140, 1040],
	["panels-info--roster-unread", 1140, 1040],
	["panels-info--no-memory", 1140, 1040],
	["panels-info--registry-unavailable", 1140, 1040],
	["panels-info--nothing-read", 1140, 1040],
	["panels-info--remote-host", 1140, 1040],
	["panels-info--mcp-settling", 1140, 1040],
	["panels-info--many-sessions", 1140, 1100],
	["panels-info--dense", 1140, 1100],
	["panels-info--unavailable", 1140, 760],
	["panels-info--loading", 1140, 460],
	["panels-info--gated", 1140, 400],
	["panels-info--narrow", 720, 1040],

	["panels-context--populated", 1140, 640],
	["panels-context--no-numbers", 1140, 640],
	["panels-context--frontend-unmeasured", 1140, 640],
	["panels-context--estimated", 1140, 640],
	["panels-context--dense", 1140, 700],
	["panels-context--breakdown-unavailable", 1140, 520],
	["panels-context--empty", 1140, 460],
	["panels-context--loading", 1140, 400],
	["panels-context--unavailable", 1140, 400],
	["panels-context--narrow", 720, 640],

	["panels-failovers--populated", 1140, 580],
	["panels-failovers--failover-in-force", 1140, 580],
	["panels-failovers--empty-chain", 1140, 620],
	["panels-failovers--no-chains", 1140, 500],
	["panels-failovers--empty", 1140, 500],
	["panels-failovers--dense", 1140, 700],
	["panels-failovers--loading", 1140, 400],
	["panels-failovers--unavailable", 1140, 400],
	["panels-failovers--narrow", 720, 580],

	/* Settings: the version row, in the five states discovery can put it in.

	   This is the surface the reported bug is ABOUT - the row that said
	   "Unavailable" (or named a different install) while the operator's daemon was
	   serving - and until now the sweep had no settings story at all, so no frame
	   could contradict it. The row's value is a string, so the evidence is the five
	   strings, one per state, and Storybook is the only instrument that can produce
	   them: `detached` needs a daemon to exit, `degraded` needs two probes to fail
	   on a live one, and neither can be asked for on demand without breaking the
	   machine the capture runs on.

	   Captured in the two `localOperator` palettes only, for the reason the
	   reconnect-gap pair above is: the claim is the ink/ground relationship of one
	   row's value, and the palette floors belong to `check-themes`, not to a
	   seventy-frame sweep of five strings.

	   Sized to the section rather than to a window, like the older-history-slot
	   entries above: the section paints ~190px (a title, a description, five info
	   rows and the updates card), and the story's own `min-h-screen` ground fills
	   whatever else the viewport has. A 760-tall frame put 95% of its pixels on one
	   colour - inside `check-evidence`'s ceiling but in the band its two nearest
	   legitimate frames (96.3-97.0%) occupy, and mostly empty page that says nothing
	   about the row. 320 leaves the whole section plus a strip of ground below it. */
	["settings-app-updates-and-info--no-bridge", 980, 320],
	["settings-app-updates-and-info--before-first-probe", 980, 320],
	["settings-app-updates-and-info--attached-to-discovered-daemon", 980, 320],
	["settings-app-updates-and-info--degraded-daemon", 980, 320],
	["settings-app-updates-and-info--detached-daemon", 980, 320],
	/* `replaced`, a live daemon whose record carries no version, and the daemon
	   this app started itself: three states in the shipped union that the first
	   round named as unphotographed, plus the suffix-and-muted-ink reading of
	   `degraded` in the same crop so the two are comparable side by side. */
	["settings-app-updates-and-info--replaced-daemon", 980, 320],
	["settings-app-updates-and-info--attached-without-version", 980, 320],
	["settings-app-updates-and-info--owned-daemon", 980, 320],
	["settings-app-updates-and-info--wedged-daemon", 980, 320],
	/* The value's tooltip, which is where the daemon's own sentence lives. Its own
	   id because `:hover` cannot be a story state: the rig moves a real pointer at
	   `[data-backend-version]` for this frame. `hoverSettleMs` is there because a
	   tooltip opens on the shared `TooltipProvider`'s 400 ms delay rather than with
	   the pointer - without it the frame is the unopened state under a name that
	   claims the tooltip. */
	[
		"settings-app-updates-and-info--value-hover",
		980,
		320,
		{ hover: "[data-backend-version]", hoverSettleMs: 900 },
	],

	/* The same section at a narrow width: the value now carries `version ·
	   address`, `InfoGrid` is `repeat(auto-fit, minmax(160px, 1fr))`, and a narrow
	   window is the only thing that proves the grid reflows rather than clipping,
	   and shows which of the row's strings wraps first. */
	["settings-app-updates-and-info-narrow--attached", 620, 360],
	["settings-app-updates-and-info-narrow--no-version", 620, 360],
	["settings-app-updates-and-info-narrow--degraded", 620, 360],

	/* The connectivity banner, the app-wide surface whose trigger condition this
	   work rewrote and which had NO frame anywhere in the tree: the neighbouring
	   rigs only asserted its absence. Each entry is one state main can publish -
	   and two of them (attached, degraded) are frames OF its absence, which is
	   the claim: a missed probe is not an outage. */
	["common-connectivity-banner--no-bridge", 1024, 300],
	["common-connectivity-banner--attached", 1024, 300],
	["common-connectivity-banner--degraded", 1024, 300],
	["common-connectivity-banner--identity-failed", 1024, 300],
	["common-connectivity-banner--no-spawn", 1024, 300],
	["common-connectivity-banner--unclaimed", 1024, 300],
	["common-connectivity-banner--stopped", 1024, 300],
	["common-connectivity-banner--wedged", 1024, 300],
];

/**
 * Clear the sweep's own output WITHOUT taking the supplementary sets with it,
 * and hand back their declarations for the manifest this run will write.
 *
 * Why this is not a plain `rmSync(OUT)`: not every frame in the tree comes
 * from this script. A surface whose claim is a click that changes STORE state,
 * or a flow against a live backend, cannot be photographed from Storybook, and
 * some of them - the chat sidebar among them - have no story at all, so a
 * blanket wipe destroys frames this script cannot re-derive. (A pointer HOVER
 * used to belong on that list and no longer does: the tuple's `hover` option
 * moves a real pointer through the input pipeline, so the trigger's hover
 * grounds are swept frames now rather than a bolted-on set.) It used to destroy
 * their manifest entry in the same pass, which was the dangerous part: the
 * frames and the count that accounted for them vanished together, the
 * arithmetic still balanced, and `check-evidence` stayed green over evidence
 * that no longer existed.
 *
 * Returning the declarations rather than re-reading them at the write site
 * keeps one definition of what "preserved" means, so the directories kept on
 * disk and the entries written into the manifest cannot drift apart.
 *
 * Two rules below are load-bearing, and both were found by attacking this
 * function rather than reading it:
 *
 * `manifest.json` is never swept. It is the only thing on disk that declares
 * which directories are irreplaceable, and the sweep does not rewrite it until
 * the whole capture finishes ~14 minutes later. Deleting it here opened a
 * window in which the preserved frames existed but nothing accounted for them,
 * so any interruption inside that window - Ctrl-C, the SIGINT/SIGTERM handler
 * at the foot of this file, an ENOSPC - left them undeclared, and the NEXT
 * sweep read no manifest, computed an empty preserve set, and destroyed them.
 * The gate then passed over the loss because the count vanished with the
 * frames. Keeping the old manifest until the new one replaces it closes that
 * window: a crashed run leaves a stale-but-honest declaration, which is a
 * state the gate can see, rather than no declaration at all.
 *
 * Preservation matches on the FIRST path segment because `readdirSync` yields
 * top-level names only, while the gate accepts a `path` of any depth. A
 * declaration of `chat-trace/hover` compared whole against `chat-trace` never
 * matched, so the sweep deleted the frames and then carried their declaration
 * into the new manifest - a gate failure whose obvious fix (drop the
 * declaration) completes the loss. Keeping the whole top-level parent is the
 * safe direction of the trade: a swept sibling under a preserved parent
 * survives a sweep that no longer captures it, and the gate reports it as an
 * unaccounted frame instead of silently losing an irreplaceable one.
 *
 * What is swept is the `.webp` FRAMES, not the directories holding them. The
 * distinction is the same one the paragraphs above are about, one level down:
 * an undeclared directory does not only hold frames this script can retake. It
 * holds the README that says how its frames were captured, hand-taken PNG
 * pairs from before this script existed, and - measured on this tree - 123
 * committed non-`.webp` files across seven surfaces, including
 * `tui-parity/OPERATOR-TUI-REFERENCE.md`, the reference the tool rows were
 * ported from. Deleting whole directories took all of that on the next sweep,
 * and the gate cannot see any of it: it counts frames. A sweep still cannot
 * leave a stale frame behind (every `.webp` outside a declared set goes), and
 * a directory emptied of its frames is removed; a file the sweep did not write
 * is not the sweep's to delete.
 */
export const clearSweptFrames = (out) => {
	const manifestPath = join(out, "manifest.json");
	const supplementary = existsSync(manifestPath)
		? (JSON.parse(readFileSync(manifestPath, "utf8")).supplementary ?? [])
		: [];
	const preserved = new Set(
		supplementary.map((set) => set.path?.split("/")[0]).filter(Boolean),
	);
	if (existsSync(out)) {
		for (const entry of readdirSync(out)) {
			if (entry === "manifest.json" || preserved.has(entry)) continue;
			sweepFramesFrom(join(out, entry));
		}
	}
	mkdirSync(out, { recursive: true });
	return supplementary;
};

/**
 * Remove the frames under `path`, and `path` itself once it holds none.
 *
 * A FILE is swept only when it is a frame; anything else was written by a hand
 * or by another tool, and `clearSweptFrames` documents why that is not the
 * sweep's to delete. A directory is swept recursively and then removed only if
 * that leaves it empty, so a surface that still carries its README keeps it
 * while its stale frames go.
 */
const sweepFramesFrom = (path) => {
	const stats = statSync(path, { throwIfNoEntry: false });
	if (!stats) return;
	if (!stats.isDirectory()) {
		if (path.endsWith(".webp")) rmSync(path, { force: true });
		return;
	}
	for (const entry of readdirSync(path)) sweepFramesFrom(join(path, entry));
	if (readdirSync(path).length === 0)
		rmSync(path, { recursive: true, force: true });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A minimal CDP client over the built-in WebSocket. The protocol is
 * JSON-RPC-ish: send {id, method, params}, receive {id, result|error} plus
 * unsolicited events. Only the three domains this script needs are used.
 */
/**
 * Whether a document that finished preparing is a story that DREW.
 *
 * Two numbers, both measured, and the reason this is a predicate rather than an
 * inline comparison: the inline version read `n - 2 >= 8`, and 8 sat above the
 * smallest thing this set legitimately paints. `chat-slash-completion--
 * argument-phase-no-match` renders a three-line popup over the composer
 * stand-in - 7 elements of its own inside a 9-element story root, once the
 * decorator's 2 (theme wrapper + toast container, counted in the page code
 * below) are subtracted. A story that draws NOTHING measures 0 after the same
 * subtraction, and that is the failure this floor exists to reject; how much a
 * drawn story paints is the paint guard's question (`assertFramePaints`), not
 * this one. At 8 the poll reported a fully rendered story as "never finished
 * preparing" for its full sixty seconds, so the frame could not be captured at
 * all - a defect that reads as a Storybook hang and sends its reader to the
 * story's source instead of to this line.
 *
 * Exported, and injected into the page verbatim through its own source text, so
 * the predicate the browser runs and the one `capture-evidence.test.mjs` pins
 * are the same function rather than two copies of one threshold. Its body must
 * therefore stay self-contained - no identifier that only exists in this
 * module - because the page evaluates it where none of them are defined; the
 * test that evaluates the source text in a bare scope is what holds that.
 */
export const storyDrew = (counted) => counted - 2 >= 7;

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

/*
 * Teardown has to survive a throw.
 *
 * Chrome used to be killed only on the success path, so any failure exited
 * with the browser still running and its profile still on disk. That was
 * survivable while the script had almost no failure modes; adding the loud
 * gates - unknown story id, theme mismatch, story did not render - made the
 * leak reachable, and one aborted run left eighteen processes and a profile
 * behind on a machine already under memory pressure. Making a script fail
 * loudly obliges you to make it fail cleanly.
 */
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		/*
		 * Retried, because `SIGKILL` above is asynchronous: Chrome's own children
		 * can still hold the profile open for a moment after it, and a bare
		 * `rmSync` then throws `ENOTEMPTY` out of the `finally` - which turns a
		 * capture that wrote every frame and its manifest into a non-zero exit
		 * with a Node stack trace, i.e. a complete run that reads as a failed one.
		 * `maxRetries` only retries the races it is documented to retry
		 * (`ENOTEMPTY`/`EBUSY`/`EPERM`); a profile that will not go is still loud,
		 * and `sweepStaleProfiles` reaps it on the next run.
		 */
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 20,
			retryDelay: 50,
		});
		dataDir = null;
	}
};

/**
 * Remove Chrome profiles left by runs that never reached `teardown`.
 *
 * `teardown` covers a clean exit and the signals we trap, but not SIGKILL -
 * and this script is routinely run under `timeout`, which sends exactly that.
 * Each abandoned profile is about 180MB in the system temp directory, nothing
 * ever collects them, and a capture is slow enough that the runs mount up:
 * four of them had quietly taken 542MB by the time a machine ran out of disk
 * mid-capture and killed the process, leaving a fifth.
 *
 * Own directories are skipped by pid, so concurrent runs do not delete each
 * other's profile out from under them.
 */
const sweepStaleProfiles = () => {
	const mine = `lo-evidence-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		if (!name.startsWith("lo-evidence-") || name === mine) continue;
		const pid = Number(name.slice("lo-evidence-".length));
		try {
			// Signal 0 tests for the process without touching it.
			process.kill(pid, 0);
			continue; // still running, so the profile is in use
		} catch {
			// no such process, so the profile is abandoned
		}
		rmSync(join(tmpdir(), name), { recursive: true, force: true });
	}
};

/**
 * Refuse to capture while a Local Operator backend is listening.
 *
 * Several surfaces call the backend on load and photograph whatever comes
 * back. With nothing on the port they render the offline state, which is what
 * every committed frame shows and what a reader of this evidence set is
 * entitled to assume they are looking at. With a real server up they render
 * that server's replies instead, and the difference is silent: the capture
 * succeeds, the manifest is honest about the commit, and sixty frames quietly
 * become pictures of one machine's backend. That happened once, on the
 * `shell-app-shell/agents` surface across all twelve themes and three
 * viewports, and the only reason it was caught is that someone measured the
 * diff instead of assuming encoder noise.
 *
 * A capture is supposed to be a function of the tree. Fail loudly here rather
 * than let the environment leak into the record.
 */
const assertBackendDown = async () => {
	const url = `${BACKEND_ORIGIN}/health`;
	try {
		await fetch(url, { signal: AbortSignal.timeout(1500) });
	} catch (error) {
		/*
		 * Refused is the state we need, and it is unambiguous: nothing is
		 * listening, so the connection fails immediately.
		 *
		 * A timeout is not the same answer. It means either a server too busy
		 * to reply inside the window or a dropped packet, and this cannot tell
		 * which - so treating it as "absent" would let the one case the guard
		 * exists to catch walk straight through it. Refuse instead, and let
		 * whoever hit it say which it was.
		 */
		if (error?.name === "TimeoutError" || error?.name === "AbortError") {
			throw new Error(
				`Timed out checking for a backend on ${BACKEND_ORIGIN}. A slow server and an absent one look the same from here, and a capture taken against a live one silently rewrites frames. Confirm the port is free and re-run.`,
			);
		}
		return;
	}
	throw new Error(
		`A Local Operator backend is answering on ${BACKEND_ORIGIN}. Captured frames would show its replies instead of the offline state every committed frame depicts. Stop it and re-run.`,
	);
};

/**
 * The frame count a PARTIAL run declares.
 *
 * Exported so `scripts/evidence-manifest.test.mjs` can bind the shipped
 * expression instead of reimplementing it. Round 2 found the test reproducing
 * this arithmetic locally, which meant reverting this file to the absorbing
 * tree-derived version left all five tests green - coverage of a copy rather
 * than of the code (R7). `check-evidence.mjs` already exports `frames` for the
 * same reason.
 *
 * The count is a DECLARATION, never a measurement of the tree: the previous
 * total plus the frames this run wrote into directories that did not exist
 * before it. Deriving it from the tree - with the same walker and exclusion
 * list `check-evidence.mjs` compares it against - makes the comparison
 * unfalsifiable and absorbs stray undeclared directories (round 1, R2).
 */
export function partialFrameCount(previous, added) {
	return (previous.frames ?? 0) + added.length;
}

/**
 * The `added*` half of `partialCapture`, which describes the last pass that ADDED
 * frames rather than the one currently running.
 *
 * The distinction is not cosmetic. `addedAt`/`addedAtHead` answer "which commit
 * do I fetch to see the frames this story was added by", so a pass that added
 * none must leave them alone - and the writer used to stamp its OWN head there
 * unconditionally, which is how they rotted: the citation then named a commit
 * that had added nothing, and the next force-push orphaned that sha while
 * `check-evidence.mjs` reported the manifest clean because it did not read the
 * field at all (round 4, R4-1). The field is now checked for reachability, so
 * the remaining job is to stop lying about WHICH pass it names.
 *
 * Exported for the same reason as `partialFrameCount`: so
 * `scripts/evidence-manifest.test.mjs` binds this decision instead of
 * reimplementing it. Returning an empty object on a zero-add pass is what makes
 * the caller's `...previous.partialCapture` spread carry the earlier values
 * forward untouched.
 */
export function partialAddedFields(
	addedFrameCount,
	addedSurfaces,
	head,
	at = new Date().toISOString(),
) {
	return addedFrameCount > 0
		? {
				addedFrames: addedFrameCount,
				addedSurfaces,
				addedAt: at,
				addedAtHead: head,
			}
		: {};
}

const main = async () => {
	sweepStaleProfiles();
	if (!ALLOW_BACKEND) await assertBackendDown();

	dataDir = join(tmpdir(), `lo-evidence-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);

	// Chrome prints the DevTools websocket on stderr.
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});

	/* The debug port is chosen by Chrome (port 0), so derive the HTTP origin
	   from the websocket URL's own authority rather than assuming a port. */
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);

	await cdp.send("Page.enable");
	await cdp.send("Network.enable");

	/*
	 * Every id in STORIES must exist before a single frame is taken.
	 *
	 * Storybook answers an unknown id with a rendered "not found" view rather
	 * than an error, and that view leaves the previous document's theme on the
	 * element - so a typo in an id surfaced as a confusing theme-mismatch
	 * failure on the FOLLOWING theme, pointing at the story system instead of
	 * at the id. Three ids in this list were wrong (they had been derived from
	 * a fixture filename rather than the story's own title) and this is what
	 * that cost. Checking the manifest first names the bad id directly.
	 */
	const stories = ONLY ? STORIES.filter(([id]) => id.includes(ONLY)) : STORIES;
	if (stories.length === 0) throw new Error(`--only=${ONLY} matched no story`);
	const themes = THEME_FILTER
		? THEMES.filter((t) => THEME_FILTER.includes(t))
		: THEMES;
	if (themes.length === 0) throw new Error("--themes matched no palette");

	const index = await fetch(`${ORIGIN}/index.json`).then((r) => r.json());
	const known = new Set(Object.keys(index.entries ?? {}));
	// Checked against the ids this run will actually visit. A narrowed refresh
	// must not be blocked by a bad id in a story it is not capturing — that is a
	// real defect in the list, but it belongs to the sweep that would take it.
	const unknown = [...new Set(stories.map(([id]) => id))].filter(
		(id) => !known.has(id),
	);
	if (unknown.length > 0) {
		throw new Error(
			`unknown story id(s): ${unknown.join(", ")}. ` +
				`Check ${ORIGIN}/index.json for the real ids.`,
		);
	}
	// A narrowed run refreshes named frames in place and must not wipe the
	// rest of the tree. A full sweep still must not take the supplementary
	// sets with it — those are live-app captures this script cannot re-derive
	// (`clearSweptFrames` is the preservation rule, not a plain `rmSync`).
	/** Every frame this run wrote, and whether it was already on disk. */
	const writtenFrames = [];
	const supplementary = PARTIAL
		? (() => {
				try {
					return (
						JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"))
							.supplementary ?? []
					);
				} catch {
					return [];
				}
			})()
		: clearSweptFrames(OUT);

	/* zustand persist key for the UI preferences store. */
	const PREFS_KEY = "ui-preferences-storage";
	let seedScript = null;
	let captured = 0;
	for (const [story, width, height, options = {}] of stories) {
		for (const theme of themes) {
			/*
			 * `prefers-reduced-motion` is a VIEWPORT state rather than a story
			 * state: the app's own cap is a media block in `styles/index.css`, so a
			 * frame that faked the reduced style would be evidence about the fake.
			 * Reset for every story, so one reduced-motion frame cannot leak its
			 * media feature into the frames captured after it.
			 */
			await cdp.send("Emulation.setEmulatedMedia", {
				features: options?.reducedMotion
					? [{ name: "prefers-reduced-motion", value: "reduce" }]
					: [],
			});
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			/*
			 * A headless page is never the focused window, so `:focus` styling
			 * paints and `:focus-visible` does not, and anything a story focuses
			 * programmatically renders as if nothing were focused at all. The
			 * `code-focused` frames were byte-identical to `code` for exactly
			 * this reason. Focus emulation makes the page believe it has the
			 * window, which is what a user's screen actually looks like.
			 */
			await cdp.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
			/*
			 * The theme is driven ONLY by the story arg.
			 *
			 * `.storybook/preview.tsx` wraps every story in one frame that reads
			 * `args.theme` and moves all three halves of the bridge together:
			 * the MUI theme object through context (MUI bakes palette values
			 * into Emotion classes as literal hexes when `createBaseTheme` runs,
			 * so it needs the object, not an attribute), `data-theme` plus the
			 * `dark` class on the document element for the Tailwind role
			 * utilities, and the preferences store for the components that read
			 * the palette from there. The arg is declared at preview level, so
			 * every story has it and none can ignore it.
			 *
			 * This used to be three mechanisms at once — seeding
			 * `ui-preferences-storage` before load, passing the arg, then poking
			 * `data-theme` and `dark` afterwards — because only eight of the
			 * fifteen story files implemented a theme decorator and the other
			 * seven rendered the default palette whatever was asked for. Two of
			 * those three could disagree, and did: the hardcoded light-theme
			 * list used by the last step had `dune` (a dark palette) in it and
			 * was missing `iceberg` (a light one), so every Dune and Iceberg
			 * frame was captured with the wrong `dark` class. One source cannot
			 * disagree with itself.
			 */
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(150);

			/*
			 * Seed the persisted preferences store before any app script runs.
			 *
			 * The theme arg drives the preview frame, but `useUiPreferencesStore`
			 * is a zustand store persisted to localStorage, and localStorage
			 * outlives the document. Components that read the theme from the
			 * store rather than from `data-theme` therefore rehydrated to
			 * whatever the previous frame left behind - the canvas surface stayed
			 * on the first theme captured while the attribute said otherwise, so
			 * every canvas frame after the first would have been named for a
			 * theme it was not showing.
			 *
			 * This runs on every new document, before app code, so the store's
			 * rehydration and the arg agree from the first paint instead of
			 * racing. It is re-registered per frame because the payload carries
			 * the theme.
			 */
			if (seedScript) {
				await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
					identifier: seedScript,
				});
			}
			({ identifier: seedScript } = await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{
					source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch {}`,
				},
			));

			/*
			 * PARK THE POINTER, then load the story.
			 *
			 * A `{ hover }` entry leaves the pointer where it stopped, and the pointer
			 * outlives the document: the next story loads with the pointer already
			 * inside whatever sits at those coordinates, so a TOOLTIP can open on a
			 * frame that never asked for one - and, worse, only sometimes, because the
			 * tooltip opens on a delay. Measured rather than theorised: the row's
			 * `degraded-daemon` frame came back with two different hashes on two runs of
			 * the same tree, and the `value-hover` entry the settings surface ends on
			 * was the only difference between them.
			 *
			 * The bottom-right corner of the requested viewport is empty in every
			 * story this file captures, and moving there before the navigation is what
			 * makes a frame a function of its own story rather than of the previous
			 * one.
			 */
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: width - 2,
				y: height - 2,
				button: "none",
				buttons: 0,
				clickCount: 0,
				modifiers: 0,
				pointerType: "mouse",
			});

			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
			});
			await sleep(900);

			/* Assert the frame really is the theme this file is about to be
			   named after, rather than trusting the navigation. A mis-named
			   evidence file is worse than a missing one.

			   Polled rather than read once: the theme is applied by a decorator
			   effect, and a heavy story - the canvas mounts ag-grid and
			   CodeMirror - can still be mounting when a single read lands. A
			   fixed sleep long enough for the slowest story would be paid by
			   all 372 frames, so wait for the condition instead of for a
			   duration. The throw still fires if it never becomes true. */
			let applied = "";
			for (let attempt = 0; attempt < 40; attempt++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: "document.documentElement.dataset.theme || ''",
				});
				applied = result.value;
				if (applied === theme) break;
				await sleep(250);
			}
			if (applied !== theme) {
				throw new Error(
					`${story} @ ${theme}: document carries theme "${applied}" after 10s`,
				);
			}

			/*
			 * Settle animations before the shutter.
			 *
			 * Entrance fades are real product behaviour, but a screenshot taken
			 * mid-fade records a half-opacity paragraph and reads as a contrast
			 * defect — which cost a full review cycle here. Removing the
			 * animation outright (rather than pausing it) is safe precisely
			 * because the system requires every animated element's RESTING state
			 * to be the visible one: `animation: none` drops the element back to
			 * its own `opacity: 1`. If this ever leaves something invisible, the
			 * animation was violating that rule and the evidence should show it.
			 */
			/*
			 * `caret-color: transparent` rides along for a different reason. The
			 * caret is not an animation, so `animation: none` never touched it:
			 * it is a blink the engine owns, on a phase this rig cannot observe
			 * or wait out, in any input that holds focus. So a frame recorded
			 * whichever half of the cycle the screenshot happened to land in,
			 * and two of the twelve edit-prompt frames carried a caret while
			 * ten did not - identical source, different pictures, churning on
			 * every recapture and burning a review round to identify.
			 *
			 * Hiding it costs nothing: the caret says the input has focus, and
			 * the focus ring already says that in a frame nobody is typing in.
			 */
			/*
			 * `{ liveMotion: true }` is the ONE exception to that rule, and it exists
			 * because exactly one claim in this repository is about motion itself: the
			 * composer's running-state mark spins (`motion-safe:animate-spin`), and with
			 * the blanket override above no pair of frames can ever show it - two
			 * shutters of one story are byte-identical by construction. A tuple that
			 * asks for live motion therefore gets no ANIMATION override, and the two
			 * tuples that take it differ in the phase the hold pins each mark to: same
			 * story, same theme, same rig, half a turn apart.
			 *
			 * TRANSITIONS ARE STILL FROZEN in that branch, and every OTHER animation
			 * is finished before the shutter, because dropping the blanket override
			 * dropped both controls: a transition or an entrance fade still in flight
			 * in one of the two frames is a second difference that no hold pins and no
			 * document declares. (Measured afterwards: freezing them changed no pixel
			 * of the pair, so nothing was in flight - the controls are prophylaxis, and
			 * the field round 3's M1' found outside the marks turned out to be the
			 * lossy encoder's response to a differing input: the same two phases
			 * captured losslessly differ in 220/228 pixels and all of them are in the
			 * marks.)
			 *
			 * It is deliberately not a general option: every other frame here WANTS the
			 * settled state (a half-faded paragraph reads as a contrast defect, and the
			 * caret blink cost a review round). A tuple that sets this is asserting "the
			 * motion is the subject", and its README entry has to say what the pair
			 * proves and what it does not.
			 */
			/*
			 * The phase hold, READ BACK - and read back AGAIN at the shutter.
			 *
			 * The hold is applied through the Web Animations API, and a re-render
			 * between the injection and the shutter would start a FRESH animation and
			 * quietly turn the pair back into a sampled one; the first version of this
			 * check ran once, several DOM reads and a rAF pair before the shutter
			 * (round 3's M1'). One function with two call sites, so the two checks
			 * cannot drift, and the failure says which one fired.
			 */
			const assertPhaseHeld = async (when) => {
				if (!options?.liveMotion || typeof options?.phaseMs !== "number") {
					return;
				}
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const row = document.querySelector('[data-composer-status-row]');
						if (!row) return 'no-row';
						const marks = [
							...row.querySelectorAll('[class~="motion-safe:animate-spin"]'),
						];
						if (marks.length === 0) return 'no-mark';
						const animations = marks.flatMap((mark) => mark.getAnimations());
						if (animations.length === 0) return 'no-animation';
						return animations
							.map((a) => a.playState + '@' + a.currentTime)
							.join(' , ');
					})()`,
				});
				const held = String(result.value);
				const wanted = `paused@${options.phaseMs}`;
				if (held.split(" , ").some((entry) => entry !== wanted)) {
					throw new Error(
						`${story} @ ${theme}: liveMotion with phaseMs=${options.phaseMs} does not hold ${when} (${held}, wanted ${wanted}). The mark is found by the class TOKEN it carries - motion-safe:animate-spin - and held through the Web Animations API, because a hold that quietly matches nothing turns this pair back into a sampled one.`,
					);
				}
			};
			if (!options?.liveMotion) {
				await cdp.send("Runtime.evaluate", {
					expression: `(() => {
						const s = document.createElement("style");
						s.textContent = "*,*::before,*::after{animation:none !important;transition:none !important}*{caret-color:transparent !important}";
						document.head.appendChild(s);
					})()`,
				});
			}
			await sleep(120);
			/* Assert the capture is of a rendered story, not Storybook's own
			   error page. A screenshot of "Configuration validation failed" is
			   indistinguishable from a real frame in a directory listing, and a
			   whole evidence set was once captured that way.

			   Emptiness is measured in ELEMENTS, not characters. A text-length
			   threshold rejected the inline-edit story, which is legitimately
			   almost wordless - a textarea whose prompt lives in a placeholder,
			   and icon buttons. Placeholders are not innerText. An unrendered
			   story has no elements; an error page has plenty of text, which is
			   what the pattern test above is for. */
			const { result: sane } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const t = document.body.innerText || "";
					if (/Configuration validation failed|no stories|Story not found/i.test(t)) return "storybook-error";
					/* Count from body, not from #storybook-root: dialogs, sheets
					   and the command palette render through a portal appended to
					   body, so a root-only count reports a fully rendered modal as
					   empty. */
					if (document.body.querySelectorAll("*").length < 8) return "empty";
					return "ok";
				})()`,
			});
			if (sane.value !== "ok") {
				throw new Error(
					`${story} @ ${theme}: story did not render (${sane.value})`,
				);
			}
			/*
			 * Wait for Storybook to finish preparing the story.
			 *
			 * Its spinner renders on a white page INSIDE an already-themed
			 * document, because the theme decorator sets the ground before the
			 * story mounts. Every other check here - theme attribute, element
			 * count, body background - therefore passes while the visible page
			 * is a spinner, which is how a frame of nothing shipped twice in a
			 * set of 396. It is intermittent, so a retry would only hide it.
			 *
			 * Measured by height, not presence: Storybook leaves all four
			 * wrappers in the DOM permanently and toggles display, so a
			 * presence test never clears and every story times out.
			 *
			 * This waits only for the loader to go. Whether what replaced it is
			 * a picture of the app is a separate question, and `check-evidence`
			 * answers it against the written file - which is also the version
			 * that tolerates a legitimate scrim over a modal, something no
			 * equality test on a ground colour can do.
			 */
			// `let`, and biome must not be allowed to talk you out of it: line
			// 620 reassigns this. A formatter once rewrote it to `const` while
			// the file was briefly unparseable - a stray backtick had ended the
			// template literal below, so the browser-side code was being read
			// as real source - and the result was committed and would have
			// thrown on the first story.
			let prepared = false;
			/*
			 * The last probe's own numbers, kept so a timeout can say WHICH gate
			 * held. Without them the failure reads as "Storybook never finished
			 * preparing" whichever of the four it was, and the reader's next move
			 * is a browser session - which is exactly how a one-element floor
			 * error survived a diagnosis as "the story never reaches a rendered
			 * state" while the story was rendering all along.
			 */
			let probe = null;
			for (let i = 0; i < 300 && !prepared; i++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const loading = [
							...document.querySelectorAll(
								".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
							),
						].some((el) => el.getBoundingClientRect().height > 0);
						/* A story that needs a moment after mount - data from a
						   stubbed query, then an interaction on the element it
						   produced - sets this on mount and clears it when the
						   frame is worth taking. Stories that never set it are
						   unaffected, so this costs nothing for the other 37
						   surfaces. */
						const pending = Boolean(
							document.documentElement.dataset.capturePending,
						);
						/* Webfonts must have resolved before the shutter.

						   Chrome paints a fallback box for a glyph whose face is
						   still loading, and against a dark ground that reads as
						   a solid filled blob exactly the size of the character
						   it replaced - a download count of "193" photographed
						   as an ellipse, a star count of "0" as a filled dot.
						   It is intermittent, it corrupts one glyph rather than
						   a frame, and it survived several rounds as a mystery
						   because a recapture usually repairs it, which is what
						   makes it look like encoder noise in a diff.

						   document.fonts.status is synchronous, so this poll can
						   read it without becoming async; fonts.ready resolving
						   is what flips it. No backticks in this comment: the
						   whole block is a template literal handed to
						   Runtime.evaluate, and one would end it here. */
						const fonts = document.fonts.status;
						/* Count the STORY's elements, wherever they live.
						   A plain body count passes on Storybook's own chrome,
						   which is how a frame of pure ground - the right colour
						   and nothing in it - got taken and then passed the paint
						   guard, since emptiness in the correct colour is still
						   the correct colour. A root-only count has the opposite
						   failure: the command palette, dialogs and sheets render
						   through a portal appended to the body and leave the
						   root empty, so it waits forever on exactly the surfaces
						   most worth photographing. Counting the root plus every
						   body child that is not Storybook's own furniture covers
						   both. */
						const root = document.getElementById("storybook-root");
						const docsRoot = document.getElementById("storybook-docs");
						const CHROME = [
							"sb-preparing-story",
							"sb-preparing-docs",
							"sb-nopreview",
							"sb-errordisplay",
						];
						/* Scripts and styles are body children too, and
						   the docs root is a permanent empty sibling of the story
						   root rather than an alternative to it - counting either
						   made the threshold cheaper than it reads, which is the
						   kind of margin that erodes without anyone noticing.

						   The body sweep's baseline is zero, but the story root's
						   is not: the preview decorator always renders a theme
						   wrapper and a toast container, so two elements are
						   present before a story draws anything. That is the 2 the
						   floor in storyDrew subtracts, and both of its numbers
						   are there rather than here so the gate this poll applies
						   is the one the test pins. */
						const INERT = ["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"];
						let n = root ? root.querySelectorAll("*").length : 0;
						if (docsRoot) n += docsRoot.querySelectorAll("*").length;
						for (const child of document.body.children) {
							if (child === root || child === docsRoot) continue;
							if (INERT.includes(child.tagName)) continue;
							if (CHROME.some((c) => child.classList.contains(c))) continue;
							n += child.querySelectorAll("*").length + 1;
						}
						return {
							drawn: !loading && !pending && fonts === "loaded" && (${storyDrew})(n),
							counted: n,
							loading,
							pending,
							fonts,
						};
					})()`,
				});
				probe = result.value ?? probe;
				prepared = probe?.drawn === true;
				if (!prepared) await sleep(200);
			}
			if (!prepared) {
				throw new Error(
					`${story} @ ${theme}: Storybook never finished preparing the story (60s). Last probe: ${JSON.stringify(probe)}. \`counted\` is the story's own elements with the decorator's two excluded, and \`drawn\` false with \`loading\`/\`pending\`/\`fonts\` clear means the element floor in \`storyDrew\` rejected it`,
				);
			}
			/*
			 * Resize to the content, then capture the viewport.
			 *
			 * `captureBeyondViewport` asks the compositor for a region it is not
			 * currently painting, and on a long page it intermittently returned
			 * unpainted white - which is what put a blank frame in the set twice
			 * on this head, once for a surface whose body background had already
			 * been confirmed correct. Making the viewport the size of the
			 * content means the capture only ever asks for pixels the renderer
			 * is actually drawing.
			 *
			 * `body.scrollHeight` is read ALONGSIDE the document element's, and
			 * it is the term that carries the answer here. Since #101 contained
			 * the document scroll, `index.css` pins `html, body { height: 100%;
			 * overflow: hidden }` - correct for an Electron shell, which is not
			 * a page - and a pinned, clipped root reports
			 * `documentElement.scrollHeight` as the VIEWPORT height no matter
			 * how tall the content is. So this probe silently became "capture
			 * one screenful": measured on `chat-trace--conversation`, the
			 * document element reports 900 while the story is really 1286 tall,
			 * and the frame came back with its last third cut off. `body` is
			 * pinned and clipped by that same rule, but `scrollHeight` on a
			 * clipped element still reports its SCROLLABLE CONTENT extent — so
			 * `body.scrollHeight` sees the overflowing Storybook root even
			 * though `body`'s own box is one viewport tall, which is what makes
			 * it the term that carries the answer (QA round 2). Do not read
			 * this as `body` being free to grow: unpinning it would not be
			 * harmless. Taking the max of both is robust in either direction
			 * rather than swapping one single point of failure for another.
			 */
			const { result: full } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, ${height})`,
			});
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: Math.min(full.value, 16384),
				deviceScaleFactor: 1,
				mobile: false,
			});
			/*
			 * A POINTER HOVER, for the frames whose claim is a hover ground.
			 *
			 * `:hover` is browser state, not story state: no story can force it, and a
			 * story that faked the class would be evidence about the fake. So the rig
			 * moves the real pointer through the input pipeline
			 * (`Input.dispatchMouseEvent`), which is what a trackpad does, and then
			 * takes the frame with the pointer still there.
			 *
			 * Dispatched AFTER the content-height resize, because the coordinates are
			 * viewport pixels read from the element itself and a resize moves the
			 * element; and BEFORE the two paint frames, so the shutter opens on the
			 * hovered state. A selector that matches nothing THROWS rather than
			 * photographing the resting state, because the two are indistinguishable
			 * in a directory listing.
			 *
			 * `modifiers`/`clickCount`/`buttons` are not optional in every Chromium
			 * build: omitting them makes the bindings layer reject the call, which a
			 * rig that ignored rejections would read as "no hover happened".
			 */
			if (options?.hover) {
				const { result: target } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const el = document.querySelector(${JSON.stringify(options.hover)});
						if (!el) return null;
						const r = el.getBoundingClientRect();
						return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
					})()`,
				});
				if (!target.value) {
					throw new Error(
						`${story} @ ${theme}: the hover selector \`${options.hover}\` matched nothing`,
					);
				}
				await cdp.send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: target.value.x,
					y: target.value.y,
					button: "none",
					buttons: 0,
					clickCount: 0,
					modifiers: 0,
					pointerType: "mouse",
				});
				/*
				 * A TOOLTIP IS NOT A `:hover` GROUND, and this is what tells the two apart.
				 *
				 * A colour step happens with the pointer; a tooltip opens on a TIMER
				 * (`TooltipProvider`'s 400 ms delay), so a frame taken on the next paint
				 * photographs the unopened state and files it under a name that claims the
				 * tooltip. An entry that names a tooltip's trigger says how long the
				 * shutter waits, which keeps the instrument the real pointer and keeps the
				 * claim honest; entries without it are unchanged, byte for byte.
				 */
				if (options?.hoverSettleMs) await sleep(options.hoverSettleMs);
			}
			/*
			 * A SCROLL POSITION, for the frame whose claim is a section's END.
			 *
			 * Like `:hover` above, this is browser state rather than story state: no
			 * story can scroll its own scroller, and a story that faked an offset
			 * would be evidence about the fake. So the rig sets each matched element to
			 * its own end before the shutter — `scrollTop = scrollHeight`, which the
			 * browser clamps to the real maximum, so the frame holds the state a reader
			 * reaches by scrolling rather than an offset this script chose.
			 *
			 * Two things THROW, for the hover's reason (the resting state and the
			 * scrolled one are indistinguishable in a directory listing): a selector
			 * that matches nothing, and a selector whose matches all sit at offset 0 —
			 * which is a resting frame filed under a name that claims an end.
			 */
			/*
			 * A KEYBOARD FOCUS RING, for the frames whose claim is one.
			 *
			 * `:focus-visible` is browser state like `:hover`, and it is stricter: a
			 * programmatic `element.focus()` does not match it in Blink unless the last
			 * interaction was the keyboard, so a story that focused a control on mount
			 * would photograph the resting state and be filed under a ring. The rig
			 * therefore presses the real Tab key (`Input.dispatchKeyEvent`) until the
			 * named element holds focus, and throws rather than photographing the
			 * unfocused state if it never does.
			 *
			 * Bounded, because a selector that matches nothing must fail loudly instead
			 * of walking every focusable in Storybook's own chrome; the walk passes
			 * through those on the way, which is what a keyboard user does too.
			 */
			if (options?.tabTo) {
				const focused = async () =>
					(
						await cdp.send("Runtime.evaluate", {
							returnByValue: true,
							expression: `document.activeElement?.matches(${JSON.stringify(options.tabTo)}) === true`,
						})
					).result.value === true;
				let reached = false;
				for (let i = 0; i < 24 && !reached; i++) {
					for (const type of ["rawKeyDown", "keyUp"]) {
						await cdp.send("Input.dispatchKeyEvent", {
							type,
							key: "Tab",
							code: "Tab",
							windowsVirtualKeyCode: 9,
							nativeVirtualKeyCode: 9,
						});
					}
					await sleep(40);
					reached = await focused();
				}
				if (!reached) {
					throw new Error(
						`${story} @ ${theme}: the tabTo selector \`${options.tabTo}\` never took focus in 24 Tab presses`,
					);
				}
			}
			if (options?.scrollToEnd) {
				const { result: scrolled } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const els = [...document.querySelectorAll(${JSON.stringify(options.scrollToEnd)})];
						for (const el of els) el.scrollTop = el.scrollHeight;
						return els.map((el) => el.scrollTop);
					})()`,
				});
				const offsets = scrolled.value ?? [];
				if (offsets.length === 0) {
					throw new Error(
						`${story} @ ${theme}: the scrollToEnd selector \`${options.scrollToEnd}\` matched nothing`,
					);
				}
				if (!offsets.some((top) => top > 0)) {
					throw new Error(
						`${story} @ ${theme}: the scrollToEnd selector \`${options.scrollToEnd}\` matched ${offsets.length} element(s) and none of them scrolls — the frame would be the resting state under a name that claims an end`,
					);
				}
			}
			/*
			 * THE PHASE HOLD RUNS HERE, at the last moment before the shutter, and
			 * round 3 is why it moved: it used to run where the story's styles are
			 * overridden, BEFORE Storybook had mounted anything, and a cold Storybook
			 * (the first story of a fresh dev server) therefore served an empty
			 * document - the hold found no row, held nothing and the pair was sampled
			 * while the check that exists to catch exactly that was reading the same
			 * empty document. A hold can only mean something once the mark exists, and
			 * this is the last point at which it does.
			 */
			if (options?.liveMotion && typeof options?.phaseMs === "number") {
				/*
				 * ...and `{ phaseMs }` HOLDS that live animation at a chosen point of its
				 * own timeline, because a phase SAMPLED from a running clock is not
				 * reproducible evidence: measured, three consecutive live captures of one
				 * story produced two distinct rotations and one repeat, so a committed
				 * pair could regenerate identical and quietly turn its own README claim
				 * false.
				 *
				 * The hold is `pause()` plus an explicit `currentTime` on the animation
				 * the mark actually carries - `getAnimations()` returns the CSSAnimation
				 * the stylesheet started - and it is MEASURED rather than argued: with it
				 * in place, three consecutive captures of both frames came back
				 * byte-identical. A stylesheet RULE cannot do it, and round 2's M1 found
				 * both halves of that in one line: the rule this option used selected
				 * `.animate-spin`, a token the mark does not have (`motion-safe:animate-spin`
				 * is), so it matched nothing; and `animation-play-state: paused` freezes
				 * wherever the rule happens to land, so even with the selector fixed the
				 * pair would have stayed sampled.
				 */
				/*
				 * The wait is load-bearing, and it is this option's own cost: with no
				 * blanket override the row's ENTRANCE fade is still in flight, and a
				 * shutter inside it renders the text at an alpha the other frame of the
				 * pair does not share — measured, the two frames then differ across every
				 * glyph on the row (491 pixels, x48-919) and the pair says nothing about
				 * the mark. Sleeping past the longest entrance (300ms in this system)
				 * leaves the ONLY live animation the mark's own spin.
				 */
				await sleep(700);
				await cdp.send("Runtime.evaluate", {
					expression: `(() => {
						/*
						 * HOLD THE SPIN AT A PHASE, through the Web Animations API rather
						 * than through a stylesheet rule. Both halves of that are round 2's
						 * M1: the rule this replaced selected ".animate-spin", which is NOT
						 * the token the mark carries - "motion-safe:animate-spin" is
						 * (run-detail-row-parts.tsx) - so a class selector matched nothing and
						 * the option silently did nothing; and a paused RULE is not a hold
						 * either, because "animation-play-state: paused" freezes at whatever
						 * moment the rule lands, so the pair stays sampled however the
						 * selector is spelled. pause() followed by an explicit currentTime says
						 * the phase outright, and re-running lands on it every time. No
						 * backticks in here: this comment lives inside a template literal.
						 */
						const row = document.querySelector('[data-composer-status-row]');
						/* EVERY mark in the row, not the first one: a band with two
						   running chips carries two, and holding one leaves the other
						   spinning freely - caught by re-running the capture and finding
						   the un-held mark had moved. */
						const marks = row
							? [...row.querySelectorAll('[class~="motion-safe:animate-spin"]')]
							: [];
						const held = new Set();
						for (const mark of marks) {
							for (const animation of mark.getAnimations()) {
								animation.pause();
								animation.currentTime = ${options.phaseMs};
								held.add(animation);
							}
						}
						/*
						 * ...and EVERY OTHER ANIMATION IS SETTLED, which is the fix
						 * for round 3's M1' and not a tidy-up: an entrance fade still
						 * in flight in ONE of the two shutters renders the row's text
						 * at an alpha the other does not share, and that is a
						 * sub-perceptual, one-sided, achromatic field across every
						 * glyph on the row - measured at 7,724 (dark) / 1,682 (light)
						 * pixels outside the two marks, with only 193/168 of them above
						 * the 8/255 the README's count used. finish() jumps an
						 * animation to the state the stylesheet settles on rather than
						 * removing it; an infinite one that cannot finish is left
						 * alone, and the marks' own spin is in the held set and is
						 * never touched here.
						 */
						for (const animation of document.getAnimations({ subtree: true })) {
							if (held.has(animation)) continue;
							try {
								animation.finish();
							} catch {
								/* an animation that never ends has no settled state */
							}
						}
						/*
						 * TRANSITIONS FROZEN, animations left live - the split this
						 * branch needs, and the one the blanket override could not
						 * express. A transition in flight is a difference between the
						 * two shutters that the hold does not pin and no document
						 * declares; the caret is the same argument as above.
						 */
						const s = document.createElement("style");
						s.textContent = "*,*::before,*::after{transition:none !important}*{caret-color:transparent !important}";
						document.head.appendChild(s);
					})()`,
				});
				await assertPhaseHeld("right after it was applied");
			}
			/* Two frames: one for the resize to lay out, one for it to paint. */
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			/*
			 * ...and the hold is read back here, at the last moment before the shutter
			 * (round 3's M1'). Everything between the injection and this line - the
			 * settle, the story-ready probe, a scroll pass, a resize, a rAF pair - is
			 * an opportunity for a re-render to hand the mark a fresh animation, and a
			 * pair that was held when it was applied and sampled when it was
			 * photographed is exactly the state three documents claimed was impossible.
			 */
			await assertPhaseHeld("at the shutter");
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 88,
			});
			/*
			 * A story captured at several widths writes one directory per width,
			 * so a sweep does not overwrite itself. Single-width stories keep the
			 * plain path, which keeps every existing frame reference valid.
			 */
			/*
			 * A story captured at several widths writes one directory per width,
			 * so a sweep does not overwrite itself. Single-width stories keep the
			 * plain path, which keeps every existing frame reference valid.
			 *
			 * An entry may name its own directory instead (`dir`), which is how a
			 * story is captured in a SECOND state — a scroll position, where the
			 * state is partial in a way the viewport cannot describe. Those entries
			 * are excluded from the width count above, or adding one would rename
			 * the frames of the state that was already there.
			 */
			const widths = STORIES.filter(
				([s, , , entryOptions]) => s === story && !entryOptions?.dir,
			);
			const leaf =
				options?.dir ??
				(widths.length > 1
					? `${story.split("--")[1]}@${width}`
					: story.split("--")[1]);
			const dir = join(OUT, story.split("--")[0], leaf);
			/*
			 * Whether this directory existed BEFORE the run, recorded before
			 * `mkdirSync` creates it.
			 *
			 * A partial run that refreshes an existing surface overwrites frames
			 * the manifest already counts; one that adds a surface writes frames
			 * it does not. Only the second may raise the declared total, and the
			 * difference is not recoverable after the fact — which is why it is
			 * captured here rather than derived from the tree later. See the
			 * manifest block at the end of this file for why deriving it from
			 * the tree is precisely the bug this replaces.
			 */
			mkdirSync(dir, { recursive: true });
			const framePath = join(dir, `${theme}.webp`);
			/*
			 * A partial run can ADD a surface as well as refresh one, and the
			 * whole-set totals have to grow with it. `writeFileSync` overwrites
			 * either way, so the only thing that tells the two apart is whether
			 * the file was there before - which is what `frames`/`surfaces`
			 * need, and what a refreshed-only count got wrong: eight new
			 * frames landed on disk while the manifest still said 474.
			 *
			 * A frame inside a DECLARED set is not the sweep's to ADD either:
			 * those sets declare their own counts, so counting theirs here
			 * would count them twice. That is why the declared-set test ORs
			 * with `existsSync` rather than narrowing it - the question this
			 * variable answers is "was this frame already accounted for", and a
			 * declared frame always was. The comparison is separator-aware
			 * because a sibling whose name merely starts with a declared set's
			 * name (`tool-rows-baseline` against `tool-rows`) is not inside it.
			 */
			const existedBefore =
				existsSync(framePath) ||
				supplementary.some((set) => {
					const declared = join(OUT, set.path);
					return dir === declared || dir.startsWith(`${declared}${sep}`);
				});
			writeFileSync(framePath, Buffer.from(data, "base64"));
			writtenFrames.push({
				surface: `${story.split("--")[0]}/${leaf}`,
				existedBefore,
			});
			/*
			 * And check it is a picture of the app before moving on.
			 *
			 * The three guards above ask whether the DOM has nodes, whether
			 * Storybook rendered an error page, and whether the document carries
			 * the right theme. A story that mounts and then sits on its own
			 * loading spinner answers yes to all three - which is how a frame of
			 * a white page with a spinner on it shipped in a set of 396. Failing
			 * here rather than at review time costs one screenshot.
			 */
			assertFramePaints(framePath, theme);
			captured++;
		}
	}

	/*
	 * A manifest, so the set can be falsified.
	 *
	 * Twice in review a claim was made about a frame while the committed set
	 * was two commits behind, and there was no way to tell from the directory
	 * which head it came from - the frames looked authoritative and were stale.
	 * Recording the commit turns "the evidence is current" from an assertion
	 * into something a reader can check with one `git log`.
	 */
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT })
		.toString()
		.trim();
	/*
	 * Source dirtiness, which means `docs/evidence` is excluded: the capture
	 * has just rewritten every frame in it, so including it would report
	 * `true` on every run and the field would carry no information at all -
	 * the same uselessness it exists to prevent. What matters to a reader is
	 * whether the CODE behind these frames was committed.
	 */
	const dirty =
		execFileSync(
			"git",
			["status", "--porcelain", "--", ".", ":(exclude)docs/evidence"],
			{ cwd: ROOT },
		)
			.toString()
			.trim().length > 0;
	/*
	 * Tree hashes, not just the head.
	 *
	 * A head SHA only answers "is this set current?" if the reader also works
	 * out which commits since then were docs-only - which is judgement, and
	 * judgement is what the manifest exists to remove. `git rev-parse HEAD:src`
	 * is the identity of the source that produced these pixels: if it matches
	 * the head under review, the frames are current no matter how many commits
	 * separate them.
	 *
	 * With one precondition, which is the field on the next line. `HEAD:src` is
	 * the COMMITTED tree, so if the capture ran over dirty or staged source it
	 * names something these frames did not come from. Read `dirtyWorkingTree`
	 * first; a tree hash from a dirty run is a hash of the wrong thing.
	 *
	 * A REBASE IS WHERE THESE STAMPS GO WRONG, and there is a test for it now.
	 * Resolving `manifest.json` by keeping upstream's top-level stamp block while
	 * the branch's own delta rewrites a neighbouring key produces a file that
	 * certifies the committed frames against somebody else's tree - and git reports
	 * no conflict, so nothing local notices; at the round-3 head both tree hashes
	 * and `surfaces` named `origin/main` while the branch's own `STORIES` list had
	 * moved nine entries (round 3, M1). `scripts/evidence-manifest.test.mjs` binds
	 * the shipped manifest's stamps against `HEAD`'s trees inside `test:desktop`,
	 * so that resolution fails CI rather than shipping, and the expected aftermath
	 * of any rebase that touches this file is a re-stamp before the suite is green.
	 */
	const treeHash = (path) =>
		execFileSync("git", ["rev-parse", `HEAD:${path}`], { cwd: ROOT })
			.toString()
			.trim();
	/*
	 * A narrowed run must not overwrite the record of the set it did not take.
	 *
	 * `frames`/`surfaces`/`themes` describe the WHOLE committed set, and a
	 * two-story refresh knows nothing about the other 470 frames — writing its
	 * own counts there would claim the set had shrunk to two. So a partial run
	 * preserves the existing totals and records what it refreshed under
	 * `partialCapture`, which is the field a reader consults to tell a narrowed
	 * set from a swept one.
	 */
	const manifestPath = join(OUT, "manifest.json");
	let previous = {};
	try {
		previous = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		// No prior manifest: a full sweep writes the first one.
	}
	const addedFrames = writtenFrames.filter((frame) => !frame.existedBefore);
	const addedSurfaces = [...new Set(addedFrames.map((frame) => frame.surface))];
	const manifest = PARTIAL
		? {
				...previous,
				head,
				/*
				 * A narrowed run that only refreshed frames leaves the totals
				 * alone; one that added a surface moves them, because otherwise
				 * the set it did not take and the frames it did add no longer
				 * add up to what is on disk.
				 */
				frames: partialFrameCount(previous, addedFrames),
				/*
				 * The STORY COUNT, recomputed rather than incremented, because
				 * `surfaces` is a claim about the whole declared set and the
				 * declared set is the table above.
				 *
				 * It used to be `previous.surfaces + addedSurfaces.length`, and
				 * that drifts the moment a narrowed run ADDS frames to a surface
				 * that already existed: `--only=chat-message-input` matched four
				 * committed stories plus three new ones and wrote 355 against the
				 * table's 351, because the four existing surfaces each gained
				 * frames they had never had (only the two `localOperator*` themes
				 * were committed for that surface). `stampFailures` compares this
				 * field against the table's own row count, so the drift is a
				 * failing suite rather than a silent one - and the fix is the
				 * same number the full sweep writes below.
				 */
				surfaces: STORIES.length,
				srcTree: treeHash("src"),
				scriptsTree: treeHash("scripts"),
				dirtyWorkingTree: dirty,
				partialCapture: {
					...(previous.partialCapture ?? {}),
					refreshedAt: new Date().toISOString(),
					refreshedAtHead: head,
					/*
					 * ACCUMULATED while the head does not move, not overwritten.
					 *
					 * A reader consults this field to find which frames moved under
					 * them, and it is the only place a narrowed set is told apart
					 * from a swept one (see the comment above). Writing the CURRENT
					 * run's totals made it describe the last command instead of the
					 * pass: a review round refreshed 26 frames over twelve surfaces
					 * as twelve per-story runs - which is the sanctioned way to
					 * narrow, because a `--only=` prefix broad enough to cover them
					 * in one run also matches stories whose frames the manifest
					 * declares elsewhere - and the field recorded the last of the
					 * twelve, `2 frames, 1 story`. `check-evidence.mjs` asserts
					 * nothing here, so the understatement passed the gate green.
					 *
					 * Keyed on the head, but by ANCESTRY rather than by equality.
					 *
					 * Equality alone closed only half the hole: a pass whose runs
					 * land either side of a commit - capture some surfaces, commit,
					 * capture the rest - reset the claim at the second commit, so
					 * the field described the last commit's runs while the round had
					 * moved more. Worse, `check-evidence.mjs` derives its denominator
					 * from the same recorded head, so the two agreed with each other
					 * and the understatement was invisible again, one level up.
					 *
					 * Carrying the total forward while the previously recorded head
					 * is an ANCESTOR of the current one keeps a multi-commit pass
					 * summing, and a head on another branch - or a rewritten history
					 * where the old commit is unreachable - is not an ancestor, so it
					 * still starts fresh instead of inheriting a stranger's totals.
					 */
					...(() => {
						const priorHead = previous.partialCapture?.refreshedAtHead;
						const sameHead =
							priorHead === head ||
							(Boolean(priorHead) &&
								(() => {
									try {
										execFileSync(
											"git",
											["merge-base", "--is-ancestor", priorHead, head],
											{ cwd: ROOT, stdio: "ignore" },
										);
										return true;
									} catch {
										// Non-zero (not an ancestor) or git cannot answer at all:
										// both mean "do not inherit", which is the safe direction.
										return false;
									}
								})());
						const priorStories = sameHead
							? (previous.partialCapture?.refreshedStories ?? [])
							: [];
						const priorThemes = sameHead
							? (previous.partialCapture?.refreshedThemes ?? [])
							: [];
						const priorSurfaces = sameHead
							? (previous.partialCapture?.addedSurfaces ?? [])
							: [];
						/*
						 * The counts are the ROUND's; the citation is this pass's only if it
						 * added something. `partialAddedFields` is the rule for the second (round
						 * 4, R4-1): it returns `{}` on a zero-add pass, so the earlier citation
						 * survives the `...previous.partialCapture` spread untouched instead of
						 * being repointed at a commit that had added nothing. Only its two citation
						 * fields are taken - the counts are `totals` below, which accumulate across
						 * this pass's commits. The verdict keys on `addedFrames.length`, THIS run's
						 * additions: keying it on the accumulated total would let a later commit of
						 * the same pass re-stamp the citation for an earlier commit's frames.
						 */
						const added = partialAddedFields(
							addedFrames.length,
							addedSurfaces,
							head,
						);
						/*
						 * A pass that added nothing leaves the WHOLE added-pass record
						 * alone, counts included. `addedFrames`/`addedSurfaces` describe
						 * the last pass that ADDED frames, so a zero-add run that reset
						 * them to 0/[] would contradict the citation written beside them -
						 * the incoherence round 4 R4-1 named, one field along from the one
						 * it fixed. `sameHead` decides whether this pass's own additions
						 * accumulate onto the previous ones.
						 */
						const totals =
							added.addedFrames === undefined
								? {}
								: {
										addedFrames:
											(sameHead
												? (previous.partialCapture?.addedFrames ?? 0)
												: 0) + addedFrames.length,
										addedSurfaces: [
											...new Set([
												...(sameHead ? priorSurfaces : []),
												...addedSurfaces,
											]),
										],
									};
						const citationFields =
							added.addedFrames === undefined
								? {}
								: { addedAt: added.addedAt, addedAtHead: added.addedAtHead };
						return {
							/*
							 * Where the pass STARTED, so the gate can measure the whole
							 * round rather than its last commit. Held across runs while
							 * the total accumulates, and re-anchored to the current head
							 * when a fresh pass begins.
							 */
							refreshedFromHead: sameHead
								? (previous.partialCapture?.refreshedFromHead ??
									previous.partialCapture?.refreshedAtHead ??
									head)
								: head,
							refreshedFrames:
								(sameHead
									? (previous.partialCapture?.refreshedFrames ?? 0)
									: 0) + captured,
							refreshedStories: [
								...new Set([...priorStories, ...stories.map(([id]) => id)]),
							],
							refreshedThemes: [...new Set([...priorThemes, ...themes])],
							...totals,
							...citationFields,
						};
					})(),
				},
			}
		: {
				head,
				srcTree: treeHash("src"),
				scriptsTree: treeHash("scripts"),
				dirtyWorkingTree: dirty,
				capturedAt: new Date().toISOString(),
				frames: captured,
				surfaces: STORIES.length,
				themes: THEMES.length,
				/*
				 * Carried over from the manifest this run replaced: the frames
				 * these entries account for were preserved above, so dropping
				 * their declaration would leave them undeclared on disk and
				 * fail the gate for whoever ran the sweep.
				 */
				...(supplementary.length > 0 ? { supplementary } : {}),
			};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

	console.log(`Captured ${captured} frames into ${OUT} at ${head.slice(0, 9)}`);
};

/*
 * Only sweep when run as a command. `clearSweptFrames` is exported so its
 * preservation rule can be exercised directly, and importing this file to
 * reach it must not launch Chrome and delete the evidence tree - the same
 * guard `check-evidence.mjs` uses for `assertFramePaints`.
 */
if (isEntryPoint(import.meta.url)) {
	/* Also covers Ctrl-C and a kill, which a try/finally alone does not. */
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, () => {
			teardown();
			process.exit(130);
		});
	}

	try {
		await main();
	} catch (err) {
		console.error(err);
		process.exitCode = 1;
	} finally {
		teardown();
	}
}
