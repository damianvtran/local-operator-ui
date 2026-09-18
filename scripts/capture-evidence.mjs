#!/usr/bin/env node
/**
 * Captures visual evidence from Storybook, one frame per story per theme in
 * the sweep's theme list below.
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
import { loadPalettes } from "./palette-source.mjs";

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
 *
 * UNDER `--only`, `--themes` MAY NAME ANY PALETTE IN THE REGISTRY, not only the
 * twelve in the sweep's list below. The list is a bounded representative set
 * (see its own note for the arithmetic), so a narrowed run is the only way to
 * photograph one surface in the other forty-seven themes without paying the
 * sweep's multiplication — which is what `docs/evidence/settings-appearance/`
 * is, the appearance picker in all fifty-nine. A full sweep still intersects
 * with the list, because a stray id must not silently widen a run that writes
 * `manifest.themes`. Ids are checked against the palettes on disk rather than
 * trusted: a frame named after a theme the app does not have is worse than a
 * missing one, and `--themes=typo` would otherwise write `typo.webp`.
 */
const ONLY = flag("only");

/**
 * `--dirs=a,b` narrows the sweep to the STATES a set writes, by their directory.
 *
 * `--only=` matches a story id, and a set's states all live on ONE story - 21
 * entries of `chat-canonical-links--detected-targets` write 21 different
 * directories - so a per-state narrowing is not expressible with a prefix. That
 * matters for a reason beyond tidiness (2026-09-17): a long run on a loaded
 * machine died silently three times, and a run that is narrowed to one or two
 * states costs minutes when that happens instead of the whole set. The directory
 * an entry writes is the one the run itself computes (`entryOptions?.dir ??
 * <story leaf>`), so this reads the same expression rather than a second opinion
 * about what an entry is called.
 */
const DIR_FILTER = flag("dirs")?.split(",").filter(Boolean) ?? null;

/**
 * The keys this rig can press, and the codes Chromium's bindings require beside
 * the key NAME.
 *
 * `windowsVirtualKeyCode`/`nativeVirtualKeyCode` are not optional: a
 * `dispatchKeyEvent` without them is rejected at the bindings layer, and a rig
 * that ignored the rejection would file a resting frame under a key its claim
 * says was pressed - the same trap the mouse options in this file document.
 */
const KEY_CODES = {
	Escape: { code: "Escape", keyCode: 27 },
	Tab: { code: "Tab", keyCode: 9 },
};

/*
 * Selectors the round-1 image-expand tuples drive, named once because two of them
 * are the same button seen from a pointer and from the keyboard.
 */
const IMAGE_EXPAND_PICTURE = 'button[title^="Click to expand"]';
const IMAGE_EXPAND_FILE_ACTIONS = 'button[aria-label="File actions"]';
const THEME_FILTER = flag("themes")?.split(",").filter(Boolean) ?? null;
const PARTIAL = Boolean(ONLY || THEME_FILTER || DIR_FILTER);

/** Every palette id the registry has, read the one way the gates read them. */
const PALETTE_IDS = new Set(loadPalettes().map(({ id }) => id));

/*
 * A backend on the configured port normally fails the run, because a captured
 * frame must be a function of the tree. `--allow-backend` states that the
 * operator knows one is running and is not capturing any surface that talks to
 * it — the tool-row stories render from fixture records and never call out.
 * It is opt-in per run, and it never applies to a full sweep.
 */
const ALLOW_BACKEND = ARGS.includes("--allow-backend") && PARTIAL;

const API_URL_LINE = /^VITE_LOCAL_OPERATOR_API_URL=(.+)$/m;

/**
 * The line Chrome prints on stderr once its debug port is up.
 *
 * Hoisted out of the `stderr.on("data")` handler it is used in, which is the
 * rule `lint/performance/useTopLevelRegex` states: a literal inside a callback
 * is re-created on every chunk, and this handler is fed every line Chrome
 * writes during boot.
 */
const DEBUG_PORT_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

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

/*
 * THE SWEEP'S THEME LIST IS A DELIBERATELY BOUNDED SET, NOT "every theme the
 * app ships".
 *
 * Every story below is captured once per theme, so this list multiplies the
 * whole evidence set. It held the twelve palettes this app shipped, and it still
 * holds them: those twelve are painted on every surface in this file, which is
 * what makes a frame comparable with the ones committed before it, and they
 * span both modes and the two brand ramps. The registry now carries
 * fifty-nine, so a full sweep is a 59/12 multiple of the swept set: from the
 * **4,925** frames committed today — `find docs/evidence -name '*.webp' | wc -l`
 * and `git ls-files docs/evidence | grep -c '\.webp$'`, both 4,925 at this head —
 * holding **196 MB** on disk — `du -sh docs/evidence`, the filesystem figure
 * rather than the 133.9 MiB the files' own bytes sum to — of which **4,184**
 * stand outside the 64 declared supplementary sets, to roughly **24,000 frames
 * and ~950 MB**. A run goes from about half an hour to several — on a box that
 * several other worktrees are working in at the same time.
 *
 * Re-derive those three numbers from the tree this note ships in rather than
 * carrying them forward, and name the commands. Two earlier revisions of this
 * note got that wrong in the same way, one fold apart: 4,379 / 167 MB / 3,762 and
 * a projection of ~21,000 (review round 1, M-2; QA round 1, Q-1 — the same
 * defect, found twice), then 4,851 / 195 MB / 4,110, which was the second fold's
 * triple and, worse, attributed 4,110 to `manifest.json`'s own `frames` while the
 * manifest carried 4,184 (round 2, M-1). The rule that keeps it right is not
 * "update the number" but "update the number AND the record it points at, from
 * the tree you are committing": 4,184 is the manifest's `frames` at this head,
 * 4,925 is what both count commands return, and the 741 difference is the frames
 * inside the declared sets. The conclusion survives all three corrections: a full
 * sweep is roughly five times this set and close to a gigabyte of WebP. The
 * twelve stay the spine because the
 * forty-seven they do not cover are covered where it matters rather than
 * silently dropped:
 *
 *   - `pnpm check-themes` asserts every contrast floor over ALL fifty-nine
 *     palettes, because the contract reads the palette directory rather than
 *     this list;
 *   - `docs/evidence/settings-appearance/` carries the appearance picker in all
 *     fifty-nine, once, because that is the surface a palette port is judged on;
 *   - any other theme can be captured on demand, with no code change, through
 *     `--themes=<a,b,…>` (a comma-separated `ThemeName` list — intersected with
 *     this literal for a sweep, and free of it under `--only`, which is how a
 *     single surface is captured in the whole registry).
 *
 * So a frame in `localOperatorDark` is a picture of every surface in the app,
 * and a frame in `catppuccinMocha` is one command away rather than free by
 * default. Growing this list is a decision about the evidence budget rather
 * than about coverage, which is why it is written down here instead of implied.
 */
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
/**
 * The by-session section, for `scrollTo` (see the note in the list below).
 *
 * Spelled once: six entries park the body on it, and a selector copied six
 * times is a selector that will be updated five times.
 *
 * SINGLE-quoted attribute value on purpose. This string is interpolated into
 * `Runtime.evaluate` through `JSON.stringify`, and the result is then placed in
 * a template literal in this file: `\"` inside a JSON string is a plain `"` by
 * the time the page parses it, so a double-quoted attribute value closes the
 * selector's own string and the whole expression becomes a syntax error that
 * surfaces as `scrollTo` matching nothing. Single quotes need no escaping and
 * survive both hops.
 */
export const SESSION_SECTION =
	"[data-panel-body] section:has(input[aria-label='Search sessions'])";

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
	 * The transcript's own Quote control, which is raised by a HIGHLIGHT of a turn
	 * rather than by the pointer over it (the operator's report: the button "should
	 * only show up when highlighting a section, not just on hover", and it should
	 * sit "above the highlighted frame and not at the edge of the whole message
	 * block"). The states below are the ones the change is judged on, and every
	 * one of them needs a GESTURE - the control is absent from the DOM until a
	 * highlight exists - which is what the rig's `select` option is for: a real
	 * drag, a real click elsewhere, a real Shift+ArrowLeft walk followed by real
	 * Tab presses.
	 *
	 * `hover-no-highlight` is the FIRST of the asks and the only one that is an
	 * absence: the pointer is on the same row the resting frame shows, and nothing
	 * is raised. Its before half (`../chat-canonical-quote-before/`) is the same
	 * entry on a tree whose control is hover-revealed, so the pair is a difference
	 * in what the pointer does rather than two descriptions of it.
	 *
	 * `highlight-mid-turn`, `highlight-across-turns` (one control, anchored at the
	 * turn the highlight BEGINS in), `highlight-then-press` (the press stages the
	 * highlight and answers it: the composer's chip is in the frame, the highlight
	 * and the control are gone) and `highlight-dismissed` (the same highlight after
	 * a click into the composer) are the second and third asks.
	 * `keyboard-highlight-focused` is the pointer-free path: the highlight is a
	 * caret and a Shift+click extended by N Shift+ArrowLeft presses, and the Tab
	 * walk that follows lands on the control, which is what a keyboard reader has
	 * to be able to do. Every one of those is captured in the twelve themes,
	 * because the control floats over prose in all of them.
	 *
	 * `selection-at-pane-top` is the FLIP, on the tall fixture and at the pane's
	 * own scroll position: the highlight's first line is at the pane's top edge,
	 * where there is no room above it, so the control goes below the highlight
	 * instead of hanging over the pane. It is a second story because it needs a
	 * transcript taller than its pane, and it is sized to that pane rather than to
	 * the 900 default for the reason `notice-lengths` is.
	 *
	 * `selection-at-pane-top-across-turns` is the same flip with the highlight
	 * LEAVING its turn, which is the configuration the round-1 defect lived in (code
	 * review M1, UX U9, QA Q27: the control walked 40px down the pane per re-measuring
	 * event, and in one trace painted over the selection it was quoting). The flip's
	 * anchor is the highlight's own last line, so the state that proves it is a
	 * highlight whose last line is NOT in the turn that owns the control - and no
	 * frame in the set showed one until here.
	 *
	 * `highlight-hover` is the control under the pointer, which is design round 1's
	 * D3: the `accent-wash`/`accent` pair is a colour step that no resting frame can
	 * show, and neither is the tooltip. The pointer goes ON the control after the
	 * gesture - see `select.hover` - and the frame carries both.
	 *
	 * EVERY ENTRY THAT CAN IS PINNED TO THE STRING IT SELECTS (`expectText`), which
	 * is design round 1's D4: `fromChar`/`toChar` are offsets into the RENDERED text
	 * node while a reader counts the markdown source, so the mid-turn entry's band
	 * begins one character into `tenant_id` rather than at its 't'. The product is
	 * right - the composer's chip carries exactly what was selected - and the entry
	 * now says which string that is instead of leaving the frame to be misread. The
	 * offsets are deliberately left where they are: moving one would re-render every
	 * after frame in the set and invalidate the before/after pairs' pixel table for a
	 * nit. An entry with a gesture that changes the selection afterwards
	 * (`extendArrows`) pins nothing, because the string it ends on is not the one its
	 * endpoints describe.
	 */
	["chat-canonical-quote--sent-turn-quote", 1024, 640],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{ hover: '[data-record-id="a1"]', dir: "hover-no-highlight" },
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="a1"] p',
				fromChar: 20,
				toChar: 72,
				expectText: "enant_id was null, and the new column is not null.",
			},
			dir: "highlight-mid-turn",
		},
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="a1"] p',
				fromChar: 20,
				toChar: 72,
				expectText: "enant_id was null, and the new column is not null.",
				hover: "[data-lo-quote-toolkit]",
				hoverSettleMs: 1500,
				tooltip: true,
			},
			dir: "highlight-hover",
		},
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="u1"] p:last-of-type',
				fromChar: 4,
				to: '[data-record-id="a1"] p',
				toChar: 40,
				expectText:
					"did it fail there?\n\nBecause that row's tenant_id was null, a",
			},
			dir: "highlight-across-turns",
		},
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="a1"] p',
				fromChar: 20,
				toChar: 72,
				expectText: "enant_id was null, and the new column is not null.",
				dismiss: "textarea",
			},
			dir: "highlight-dismissed",
		},
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="a1"] p',
				fromChar: 20,
				toChar: 72,
				expectText: "enant_id was null, and the new column is not null.",
				press: true,
			},
			dir: "highlight-then-press",
		},
	],
	[
		"chat-canonical-quote--sent-turn-quote",
		1024,
		640,
		{
			select: {
				from: '[data-record-id="a1"] p',
				fromChar: 40,
				toChar: 92,
				keyboard: true,
				extendArrows: 8,
			},
			tabTo: "[data-lo-quote-toolkit] button",
			dir: "keyboard-highlight-focused",
		},
	],
	["chat-canonical-quote--scrolled-to-oldest-turn", 1024, 540],
	[
		"chat-canonical-quote--scrolled-to-oldest-turn",
		1024,
		540,
		{
			select: {
				from: '[data-record-id="u1"] p:last-of-type',
				fromChar: 0,
				toChar: 40,
				expectText: "The migration failed on the second row. ",
				scrollAfter: '[data-record-id="u1"] p:last-of-type',
			},
			dir: "selection-at-pane-top",
		},
	],
	[
		"chat-canonical-quote--scrolled-to-oldest-turn",
		1024,
		540,
		{
			select: {
				from: '[data-record-id="u1"] p:last-of-type',
				fromChar: 0,
				to: '[data-record-id="a1"] p',
				toChar: 40,
				expectText:
					"The migration failed on the second row. Why?\n\nBecause that row's tenant_id was null, a",
				scrollAfter: '[data-record-id="u1"] p:last-of-type',
			},
			dir: "selection-at-pane-top-across-turns",
		},
	],
	/*
	 * The user card's own width, which is the measure since 2026-09-16.
	 *
	 * The operator's report was a card holding a wide attachment with its text
	 * centred inside it, and the three stories here are the three routes to a card
	 * wider than its prose: a reply quote, an attachment, and — the majority
	 * shape, and the one the round that fixed this did not photograph — a long
	 * turn with neither. What each frame has to show is one thing: the prose's
	 * left edge and the card's inner left edge are the SAME line, at every
	 * paragraph and at the attachment.
	 *
	 * 1024x620 is the PANE these are judged at, which is where the measure sits at
	 * its 900px cap and the card at 675px; the story file's header carries the DOM
	 * read behind both numbers. The before half is a declared supplementary set
	 * (`../chat-canonical-user-card-measure-before/`) — the same three stories on
	 * the same rig, with the three rendering files at the branch's base in the
	 * working tree and nothing else moved, so the pair differs in the measure
	 * alone. Both halves were re-shot at the rebased head on 2026-09-17, so the
	 * base named there is the rebase's own fork point (`562bc5837`), not the
	 * pre-rebase `962f43350`.
	 */
	["chat-canonical-user-card-measure--reported-shape", 1024, 620],
	["chat-canonical-user-card-measure--wide-attachment", 1024, 620],
	["chat-canonical-user-card-measure--long-text-only", 1024, 620],
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

	/* The composer's missing colour step, and the state a vanished conversation
	   leaves it in (design review round 1, D3): the transcript stories above
	   render the transcript alone, so a composer that refuses input over a
	   conversation this machine no longer has was never in a frame.

	   ONE ROW, NOT THE BAND'S THREE. The two other states this region used to
	   name, `idle` and `awaiting-reply`, are already swept by the composer's own
	   set at its 1024x300 measure, and that is the only measure that fits them:
	   the story's `Frame` is a FIXED 1024px column, so a second capture at the
	   band's old 900 would be the same state twice AND clipped - 124px of the
	   column, the box's right border and the send control, off the edge, with the
	   frame itself coming out 900x213 rather than the tuple's 160 because the
	   story's own height governs. The gone state is what the band uniquely
	   carried, so it is swept at the same 1024x300 as its siblings, and the three
	   read together.

	   THESE IDS FOLLOW THE STORY, NOT THE OTHER WAY ROUND. The rows were written
	   against `Chat/Composer states`, a title that never existed on `main`:
	   `7550bf1ae` ADDED `message-input.stories.tsx` already titled `Chat/Message
	   input`, and the ids were born dangling 316 commits LATER in `cb0d55dc6`'s
	   rebase resolution - the commit whose own note says the `Busy` and second
	   `Idle` stories were deliberately NOT re-added. So the old ids named stories
	   that no longer existed, and a full sweep aborted at the unknown-id check
	   until now. Not "every sweep": that check validates only the ids a run will
	   VISIT, so a narrowed `--only=` run naming other stories was never blocked.

	   The band's middle frame has NO successor here, and that is worth saying
	   rather than pointing at the nearest story. `Busy` passed `isLoading` with a
	   non-null `currentJobId`, so it photographed `Agent is busy` with the field
	   DISABLED; `chat-message-input--awaiting-reply` photographs a different state
	   (`awaitingReply`, no load: `Waiting for the agent`, box live). Dropping it
	   loses no reachable state: `isBusy` needs a non-null `currentJobId` and every
	   call site passes null (`chat-page.tsx:1931`, `chat-content.tsx:1128`), which
	   is exactly why `cb0d55dc6` refused to re-add the story - a frame of it would
	   photograph a state no user can be in. */
	["chat-message-input--conversation-gone", 1024, 300],

	/* The browser feature's own surfaces, added with the round that remediated its
	   review. This is the ONE part of the visible browser a browser tool can
	   reach: the chrome band is ordinary DOM, while the native page view under it
	   is not (U1). So these frames are the evidence for the consent band's copy
	   and attribution (D2/D3) and for the panel a refused navigation now shows
	   (D1) — and the sizes are tight to their content, because a band is short and
	   a frame that is 99% ground crosses `check-evidence`'s uniformity ceiling. */
	["browser-consent-bar--pending", 1280, 300],
	["browser-consent-bar--attributed-and-queued", 1280, 360],
	["browser-consent-bar--unnamed-requester-no-domain", 1280, 300],
	["browser-consent-bar--an-agent", 1280, 300],
	["browser-consent-bar--busy", 1280, 300],
	/* The PRESSED state of the same card: `busy` alone renders the trailing cue, so
	   this story presses a control through `play` and is the only frame that can show
	   the cue MOVED (design round 3, D12; review round 3, MAJOR on evidence). */
	["browser-consent-bar--busy-pressed", 1280, 300],
	/* The queued band's own states, which the round that built the queue added: the
	   numbered chips (the operator's "numbered badge callout"), the third request
	   selected rather than the first, and the two ways a request leaves without an
	   answer. */
	["browser-consent-bar--three-waiting", 1280, 360],
	["browser-consent-bar--expired-and-withdrawn", 1280, 140],
	/* The Approvals control's badge: none, one, three. Sized to the bar plus the
	   padding the badge needs, because the badge sits half outside the control's
	   own box and a tight frame would clip the number the frame exists to show. */
	["browser-url-bar--no-badge", 1280, 120],
	["browser-url-bar--one-waiting", 1280, 120],
	["browser-url-bar--three-waiting", 1280, 120],
	// Two digits: the state that makes the badge's geometry load-bearing, because a
	// 24px pill at the control's inner corner is where "inside the surface" stopped
	// being free (design round 2, D3 asked for this specimen by name).
	["browser-url-bar--two-digits", 1280, 120],
	/* The strip's grammar and its chips. Tight to the strip plus a slice of ground
	   under it: the active tab's notch is the 1px of `canvas` that makes the tab
	   continuous with the page, and a frame that stopped at the strip's rule could
	   not show it. `actions-expanded` is taller by exactly the row the strip grows
	   when a row's actions open in the band. */
	["browser-tab-strip--one", 1280, 140],
	["browser-tab-strip--many", 1280, 140],
	["browser-tab-strip--overflowing", 1280, 140],
	["browser-tab-strip--waiting", 1280, 140],
	["browser-tab-strip--agent-and-waiting", 1280, 140],
	["browser-tab-strip--failed", 1280, 140],
	["browser-tab-strip--restored", 1280, 140],
	// THE WORST-CASE ROWS (review round 6). Four and five chips, one story each
	// because only one tab can be active and the active row pays 68px for the cluster
	// that sits in flow on it. They are here rather than only in the stories file
	// because a state no capture renders is a state the design stream cannot judge -
	// which is how both of round 6's majors stayed invisible.
	["browser-tab-strip--worst-case", 1280, 140],
	["browser-tab-strip--worst-case-widest", 1280, 140],
	["browser-tab-strip--actions-expanded", 1280, 260],
	/* The pin's band list and a row's band with the four bulk closes (design R4 fix 2,
	   R5). `pinned-list` is declared taller by the list's own bounded height
	   (`max-h-36` plus the header row), and `actions-expanded-batch` by the same row
	   height the other expanded band uses. */
	["browser-tab-strip--actions-expanded-batch", 1280, 360],
	/*
	 * THE TWO EXPANDED BANDS ARE TALLER SINCE THE ROUND-2 RULING (D7): the band is a
	 * column now, one item per row, so the batch's seven rows are 196px of buttons
	 * plus the hairline and the heading row - 241px of band where the wrapping row
	 * took 28. The declared heights are sized to the band the story actually draws, so
	 * `Copy URL` (the last item) is inside the frame rather than below it, which is the
	 * item D7 is about.
	 */
	/* THE GROUPING AND THE CHIP CAP (design R3, R4 - the conversation-browser
	   change). `grouped` is three conversations plus the unattributed run at the
	   route's own 1280; `grouped-overflow` is 20 tabs over 6 conversations at
	   1160px, which is the scale R3's arithmetic is about and the state open
	   question 3 says to revisit if the labels start crowding the tabs;
	   `chips-collapsed` is the five-state row at the PANE's 640, where the cap is
	   what stands between a legible title and a clipped one - the pane's width
	   rather than the route's, because that is the tier the cap was argued for. */
	["browser-tab-strip--grouped", 1280, 140],
	["browser-tab-strip--grouped-overflow", 1280, 140],
	["browser-tab-strip--chips-collapsed", 640, 140],
	/* The pinned control's list, open, in the band: the frame §12.1 asked for, where the
	   question is whether a page behind it can occlude it. Captured at the pane's 640
	   for the same reason `chips-collapsed` is - that is where the control appears. */
	["browser-tab-strip--overflow-list", 640, 280],
	/* The dock, which replaced the Sites sheet. It is a full-height in-flow panel,
	   so the declared height is the panel's; `narrow` is captured in a 560px
	   viewport because the dock's own width classes are the product's (`w-80` below
	   a 1280px surface), and forcing it narrow in a wide viewport would photograph a
	   width the product never renders. */
	["browser-approvals-dock--waiting", 1280, 720],
	["browser-approvals-dock--approved", 1280, 720],
	["browser-approvals-dock--denied", 1280, 720],
	["browser-approvals-dock--empty", 1280, 720],
	["browser-approvals-dock--narrow", 560, 720],
	/*
	 * THE CONVERSATION MARK (design R2), in the states the sidebar can put it in. Nine
	 * of them because the mark is small and its states differ by one glyph, one count or
	 * one badge: a frame that showed two of them would leave a reviewer guessing at the
	 * other seven. EVERY ONE OF THEM RENDERS THE MARK IN A ROW, and `on-both-grounds` is
	 * the pair that matters most: the mark is never seen alone, the badge's ring paints
	 * `canvas` on whatever ground the row owns, and the two grounds sit on opposite sides
	 * of the panel's own step. (The harness's element floor is the mechanical half of the
	 * same decision - a lone 24px control is not a drawn surface.)
	 */
	["browser-conversation-mark--nothing-open", 320, 64],
	["browser-conversation-mark--has-tabs", 320, 64],
	["browser-conversation-mark--loading", 320, 64],
	["browser-conversation-mark--one-approval", 320, 64],
	["browser-conversation-mark--three-approvals", 320, 64],
	["browser-conversation-mark--many-approvals", 320, 64],
	["browser-conversation-mark--everything", 320, 64],
	["browser-conversation-mark--focused", 320, 64],
	["browser-conversation-mark--on-both-grounds", 320, 128],
	/*
	 * THE TWO ADDED BY REVIEW ROUND 1. `trailing-statement` is D8's coverage gap: the
	 * design justifies the reserved slot with a 28px cost per title, and no frame put the
	 * mark in a row that already spends width on `· Not sent yet`. `slot-cost` is D2/A4's
	 * before/after pair: the same row in the base tree's shape (no slot at all) and on
	 * this branch's, with the two measured title widths printed in the frame so the cost
	 * is read rather than argued.
	 */
	["browser-conversation-mark--trailing-statement", 320, 64],
	["browser-conversation-mark--slot-cost", 320, 128],
	["browser-load-failure--connection-refused", 1280, 420],
	["browser-load-failure--name-not-resolved", 1280, 420],
	["browser-load-failure--unmapped-code", 1280, 420],

	/*
	 * The conversation-scoped pane (`docs/design/browser-approval-ux.md` §7),
	 * captured at the PANE's own width rather than at 1280: an evidence frame of a
	 * pane should be the pane, so the viewport is the box the user sees — 640, the
	 * design's default, and 480, the divider's floor. The heights are the frames'
	 * own, two of them tight to their content: `scope-empty` and the three header
	 * rows are mostly ground by nature, and a taller box would cross
	 * `check-evidence`'s uniformity ceiling photographing the emptiest state this
	 * feature has. The header rows are 84 = the 56px bar plus the 28px caption that
	 * carries the reported rectangle.
	 */
	["browser-pane--this-conversation", 640, 460],
	["browser-pane--all-tabs", 640, 460],
	/*
	 * `scope-empty` is at the SAME size as the populated frames rather than tight to
	 * its own content (design round 2, D9): the finding is a comparison - the strip,
	 * and therefore the page area below it, stepping as a tab appears - so the pair
	 * has to be photographed in the same box or the two captions are not comparable.
	 * It is less empty than it was, so the uniformity ceiling the old height existed
	 * for is no longer the constraint.
	 */
	["browser-pane--scope-empty", 640, 460],
	["browser-pane--show-all-tabs", 640, 460],
	["browser-pane--one-tab", 640, 460],
	["browser-pane--with-approval", 640, 720],
	["browser-pane--narrow-minimum", 480, 460],
	["browser-pane--route-for-comparison", 1240, 780],
	["browser-pane--trigger-no-approval", 560, 84],
	["browser-pane--trigger-one-approval", 560, 84],
	["browser-pane--trigger-three-approvals", 560, 84],
	/*
	 * The COMPOSED pair (design round 1, D6; review round 1, F1), which is the only
	 * place the pane's own frame meets a chat column: the seam, the divider, the width
	 * the conversation keeps and the header's trigger cluster in its real place. Both
	 * halves of the before/after are here rather than only the after, because "the
	 * conversation narrows rather than being covered" is a claim about a DIFFERENCE.
	 *
	 * 1380 is the design's own composition width (`branding.md`'s reference capture
	 * size) and the pane's 640 leaves ~740 for the column, which is where the three
	 * header controls and a two-tab strip are all legible at 1:1.
	 */
	["browser-pane--composed-with-pane", 1380, 900],
	["browser-pane--composed-trigger-only", 1380, 900],
	/* The dock - the only state that paints the tray's header row - and so the frames in
	 * which the pane's own `1 approval for this conversation` exists (review round 1,
	 * F2). ONE approval, and the count matters: the dock fixtures put a single request
	 * in the pane's scope, so the header row's sentence counts that one. Photographed at
	 * the pane's default width and at its 480 floor. */
	["browser-pane--pane-dock-open", 640, 720],
	["browser-pane--pane-dock-narrow", 480, 720],
	/* The floor WITH tabs, which `narrow-minimum` cannot answer because it has none. */
	["browser-pane--narrow-with-tabs", 480, 460],
	/* A draft: no session, so the switch's conversation side is disabled rather than
	 * silently meaning All tabs (design round 1, D3). */
	["browser-pane--draft-conversation", 640, 460],
	/* Before the first read lands (spec 7.4). */
	["browser-pane--pane-loading", 640, 460],
	/* The badge at its cap (design round 1, D5). */
	["browser-pane--trigger-at-cap", 560, 84],
	/*
	 * The chat header's whole action cluster, which is one control more than the
	 * trigger frames above carry: the run trigger, the browser button and the canvas
	 * button together, at the five spacing states the reservation is judged in.
	 *
	 * Its own surface rather than three more entries here, because these frames are
	 * the pair a fix to the CLUSTER is reviewed against - `chat-header-cluster/` is
	 * the fixed tree and `chat-header-cluster/before/` is the same stories rendered
	 * by `origin/main`'s `chat-header.tsx` (see that set's declared source in the
	 * manifest) - and a pair needs its own directory to be re-captured into.
	 *
	 * 560x84 is the size the trigger frames use, so a reviewer can put these beside
	 * those. `no-approval` is the operator's own state: no badge drawn, and the
	 * asymmetry visible as 8px against 12px before the fix.
	 */
	["chat-header-cluster--no-approval", 560, 84],
	["chat-header-cluster--one-approval", 560, 84],
	["chat-header-cluster--at-cap", 560, 84],
	["chat-header-cluster--trigger-dot", 560, 84],
	/* The badge drawn with the canvas button unmounted: the reservation's room is
	   owed for the box that button owns, so this state must stay at the 8px step. */
	["chat-header-cluster--canvas-open-badge", 560, 84],
	/*
	 * The strip's own arithmetic at the pane's width, and the route's strip at the
	 * same tab count (design round 1, D1's remainder; QA round 1, Q2). The pair is
	 * the claim: four tabs fit a 640 pane whole and six do not, and where they do not
	 * the pinned control carries the count of what is missing - including on the
	 * route, where the same six tabs fit and the control is therefore absent.
	 */
	["browser-pane--pane-overflow-count", 640, 460],
	["browser-pane--narrow-overflow-count", 480, 460],

	/* The TUI-parity tool rows. Swept for the states that are slow or awkward
	   to reach live — an interrupted call needs a turn stopped at the right
	   moment, an MCP name needs a server connected — and captured NARROW as
	   well as wide, because the shed order under pressure is half the design. */
	/* The canonical rows that CARRY the pictures, which no frame held before this
	   round: `CanonicalImage` was exercised only through the shared component's own
	   story, never through the tool row that mounts it, and a row with two images
	   (the `Screenshot 1`/`2` labels) was rendered nowhere at all (QA round 1, Q-3).
	   `user-attachments` is the other call site and the other label family. */
	["chat-tool-rows--screenshots", 1280, 900],
	["chat-tool-rows--screenshots-two", 1280, 900],
	["chat-tool-rows--user-attachments", 1280, 900],
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
	/*
	 * The compaction pass, before and after. The BEFORE frame is the change
	 * itself: `/compact` used to be answered by a modal dialog, and the pass was
	 * invisible in the transcript; the rung is now the only liveness statement
	 * the surface makes about it, and the AFTER frame is what replaces the dialog
	 * once the pass settles (the reducer's own info line, with the token counts).
	 * Sized to the two rows and the rung, for the reason `working-labels` is: at
	 * 900 tall the frame is mostly ground and `check-evidence`'s uniformity
	 * ceiling rejects it.
	 */
	["chat-tool-rows--compacting-rung", 1280, 300],
	["chat-tool-rows--compacting-settled", 1280, 300],
	["chat-tool-rows--compacting-settled-unchanged", 1280, 300],
	/* The third ending, and the one the dialog used to own: a pass that did
	   NOT run. Added by the round that gave the refusal a row. */
	["chat-tool-rows--compacting-refused", 1280, 300],
	["chat-tool-rows--working-labels", 760, 300],
	/* The operator's own report, in the two arms a resumed pane can be in: a
	   model call the band can only date from the producer's folded phase, and a
	   running batch the row and the band both date from its oldest card. Sized
	   to its content — a taller viewport is mostly ground, which is the
	   uniformity ceiling this list keeps running into. */
	["chat-tool-rows--resumed-running-clock", 1280, 400],
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
	/* The two EXITS from a reader, which are the one kind of state this set can
	   photograph and a keyboard walk could not: the press moves the TREE.
	   `back-to-roster` is where the defect was and is the after half of the pair
	   whose before half is `docs/evidence/run-panel-back-before/` (a supplementary
	   set, declared in the manifest, captured from `origin/main`'s own
	   `run-panel.tsx` with this story). `back-pop` is the rule that did NOT change -
	   one level up while there is a level to pop - and `close-from-reader` is the
	   control that still closes the pane, from the same state, in the same bar.
	   All three drive themselves; see the stories' own note for why the rig cannot
	   press one control after another. */
	["chat-run-panel--back-to-roster", 1280, 900],
	["chat-run-panel--back-pop", 1280, 900],
	["chat-run-panel--close-from-reader", 1280, 900],

	/* A conversation image, expanded. The operator's report was that a `read` row's
	   screenshot could not be read at the ceiling the transcript gives a picture,
	   and that on a canonical row clicking one did nothing at all. Three states:
	   `in-thread` is what the press acts on, `expanded` is the overlay with the app
	   still visible behind its scrim, and `expanded-small-image` is the SIZE RULE —
	   a 240x180 picture offered nearly the whole viewport stays 240x180, where a
	   fit-to-viewport rule would smear it. That last frame is sized to itself for
	   the reason the notification states are: the scrim covers the whole viewport,
	   so at 1280x900 the frame would be one colour over `check-evidence`'s
	   uniformity ceiling and a picture of nothing. `expanded` and
	   `expanded-small-image` reach the overlay by pressing the picture; `in-thread`
	   is the at-rest state that press acts on, and the story's own note says so.
	   (Review round 3, R3-5: this said "the first three", which counted the state
	   the press acts on among the states the press produces.) */
	["chat-image-expand--in-thread", 1280, 900],
	["chat-image-expand--expanded", 1280, 900, { press: IMAGE_EXPAND_PICTURE }],
	[
		"chat-image-expand--expanded-small-image",
		640,
		420,
		{ press: IMAGE_EXPAND_PICTURE },
	],
	/* THE ROUND-1 REVIEW'S SETS (design D1-3/D1-4/D1-5, review R1-1, UX U1-1, QA
	   Q-3/Q-5), and why each is a tuple rather than a story. `expanded-small-window`
	   is the STORY `expanded` at the smallest shape the app enforces (800x760, the
	   floor UX round 1 measured on the built app) — the same surface, one window
	   smaller. The two new aspect stories photograph what design D1-3 could only
	   reach by arithmetic: a picture at the viewport's own aspect, whose corner lands
	   as close to the close button as the geometry allows, and the phone-aspect
	   capture the same file's sizing note names as a real input. `expanded-failed`
	   carries its own latch — the story withholds the shutter until the failure copy
	   is painted, so a frame of an overlay whose picture merely had not decoded yet
	   cannot ship. `legacy` is ONE story the rig drives FOUR ways, because the four
	   frames are one surface in four states: at rest, under a real pointer, focused
	   by real Tab presses, and then ACTIVATED by Enter, whose capture fails if the
	   menu's items never appear — the keyboard half of review R1-1, in the engine
	   the finding is about. */
	[
		"chat-image-expand--expanded-near-viewport",
		1280,
		900,
		{ press: IMAGE_EXPAND_PICTURE },
	],
	[
		"chat-image-expand--expanded-portrait",
		1280,
		900,
		{ press: IMAGE_EXPAND_PICTURE },
	],
	/* NOT press-driven, and that is the state's own reason rather than an oversight:
	   the transcript's copy of a picture that failed to decode is `BrokenAttachment`
	   and not a button, so no press can reach this overlay — the story mounts it and
	   holds the shutter until the failure copy paints. Its close button therefore
	   carries the same `:focus-visible` artifact the other five no longer do; the
	   README names it per frame rather than leaving a reader to guess. */
	["chat-image-expand--expanded-failed", 1280, 900],
	[
		"chat-image-expand--expanded",
		800,
		760,
		{ dir: "expanded-small-window", press: IMAGE_EXPAND_PICTURE },
	],
	["chat-image-expand--legacy", 1280, 900],
	[
		"chat-image-expand--legacy",
		1280,
		900,
		/*
		 * `hoverSettleMs` because the reveal is a real transition, not a class
		 * swap: the control fades in over `duration-fast`, so the shutter waits for
		 * the fade instead of trusting that it landed after it. On this machine the
		 * frame came out complete either way — the trigger's brightest pixel reads
		 * `inkMuted` (measured 179,175,170 against the palette's `#b5afa2`), which is
		 * the ghost glyph at full opacity — and the wait is kept so a slower machine
		 * cannot photograph a half-faded control.
		 */
		{ dir: "legacy-hovered", hover: IMAGE_EXPAND_PICTURE, hoverSettleMs: 400 },
	],
	[
		"chat-image-expand--legacy",
		1280,
		900,
		{ dir: "legacy-tabbed", tabTo: IMAGE_EXPAND_FILE_ACTIONS },
	],
	[
		"chat-image-expand--legacy",
		1280,
		900,
		{
			dir: "legacy-tabbed-open",
			tabTo: IMAGE_EXPAND_FILE_ACTIONS,
			pressKey: { key: "Enter", reveals: '[role="menu"]' },
		},
	],
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
	/* The Wakes section (`docs/composer-wakes.md`) — the pane's fifth, and the one
	   surface that answers "is this session armed, and what will it fire". One band
	   is a schedule alone (the state nothing in the app could show before), one the
	   three cadences published OUT of due order (the ordering claim, which a fixture
	   in due order would hide), one the cap and its marker at a full scheduler's
	   nine schedules, one a prompt longer than its row, one the pane's 320px floor
	   where the due label is the longest first line any section draws, and one the
	   pair with the plan that most real sessions are in. */
	["chat-run-panel--wakes-only", 1280, 700],
	["chat-run-panel--wakes-recurring", 1280, 820],
	["chat-run-panel--wakes-many", 1280, 820],
	["chat-run-panel--wake-long-message", 1280, 700],
	["chat-run-panel--wakes-and-plan", 1280, 820],
	["chat-run-panel--wakes-floor-320", 1280, 700],
	/* The trigger's activity blip: the pane is CLOSED and a child is running, so
	   the dot is drawn in `info`. Read against `trigger-idle` (nothing to say) and
	   `panel-empty` (pane open, no activity ink) — the ink switch is the whole claim
	   and a still is the only instrument for it. */
	["chat-run-panel--trigger-activity-dot", 1280, 700],
	/*
	 * Settings > Appearance: the theme picker, in the settings page's own 896px
	 * column — the surface a palette port is judged on, and the only story that
	 * renders the whole theme set at once (fifty-nine tiles, forty-one under
	 * `Dark` and eighteen under `Light`).
	 *
	 * Captured at the picker's own height rather than the 900 default: the frame
	 * IS the grid, and a viewport that clips the light group cannot answer the
	 * question the tiles exist for — whether fifty-nine palettes read as a set
	 * you can take in at a glance. The rendered column measures 1200.8px at this
	 * width; 1420 is that plus the ground the pair shares with the before frames
	 * in `docs/evidence/settings-appearance-before/`, which are taken at the
	 * same viewport so the two are a like-for-like comparison.
	 */
	["settings-appearance--gallery", 1000, 1420],
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
	 * Backend settings: the whole registry — 102 keys in 19 sections — which had no
	 * frame, no story and no fixture in this set until the redesign. The four states
	 * that matter most are arrival (nothing touched), all-expanded (the long scroll
	 * the complaint is about), filtered (a search that force-opens the sections it
	 * lands in and says how many rows it found) and one-section-open (a header's
	 * own geometry).
	 *
	 * 1380x900 is the app's default window and 1000x900 the step below where the
	 * settings rail collapses to its icon column, so both are swept for the
	 * arrival state; 620x900 is deliberately NARROWER than the row's own 560px
	 * column breakpoint, because the rows stack on the COLUMN and a viewport that
	 * never crosses it would photograph the layout that already worked.
	 *
	 * `all-expanded` declares 1700 rather than 900: with the advanced tier held
	 * back, every section open is ~1500px of registry, and a 900px frame of it
	 * would be a picture of the first 14 rows. `changed-rows` is the configured
	 * fixture — off-default rows, changed dots, `Use default` — and the other
	 * three are the states a reader reaches by searching, by a deep link and by a
	 * gate that is switched off.
	 *
	 * `dirty`, `saving` and `save-failed` are the SAVE MODEL, which is the half of
	 * this redesign that had no frame at all: eleven stories and 144 frames showed
	 * no draft, so "saving is no longer silent" was unit-test-only evidence (design
	 * round 1, D3). All three drive the registry's one `cascade` row through a
	 * stubbed transport that hangs and then refuses, because the cascade is also
	 * the row that used to keep claiming unsaved after a save that had landed
	 * (review round 1, M1; QA round 1, Q3) — the frame and the fix are about the
	 * same row.
	 */
	["settings-backend--arrival", 1380, 900],
	["settings-backend--arrival", 1000, 900],
	["settings-backend--all-expanded", 1380, 1700],
	["settings-backend--collapsed", 1380, 900],
	["settings-backend--one-section-open", 1380, 900],
	["settings-backend--filtered", 1380, 900],
	["settings-backend--no-results", 1380, 900],
	["settings-backend--changed-rows", 1380, 900],
	["settings-backend--read-only-and-redacted", 1380, 900],
	["settings-backend--gated-children", 1380, 900],
	["settings-backend--deep-link", 1380, 900],
	/*
	 * The registry's provider and model rows, which are the operator's report.
	 *
	 * `provider-model-rows` is the five rows at rest — `hosting` and `model_name`
	 * from the configured fixture, a placeholder on the three subagent tiers —
	 * and the two `*-list-open` frames are the feature itself: the WHOLE login
	 * registry with its credential state shown, and the model list narrowed by
	 * the hosting beside it (with the field's own stored value rescued into its
	 * own group, which is the state the configured fixture is in by itself).
	 * `catalogue-deferred` and `catalogue-unknown-credentials` are the two
	 * degradations: a per-provider failure, which is a note over a list that
	 * still has rows, and an unreadable credential store, where nothing may be
	 * badged.
	 *
	 * `provider-model-rows` is also the BEFORE frame's counterpart in
	 * `docs/evidence/settings-model-combobox/`, which carries the driver pair
	 * from the real app; these frames are the same states under a stubbed
	 * transport, which is what makes them reproducible across twelve themes.
	 */
	["settings-backend--provider-model-rows", 1380, 900],
	["settings-backend--hosting-list-open", 1380, 900],
	/*
	 * The same open list at the narrowest window the product can render
	 * (`WINDOW_MIN_WIDTH` 800, so the settings column is ~688px by the arithmetic
	 * the section's own stories record). The design checklist asks for exactly
	 * this frame - a popover anchored to a 384px field must not overflow the
	 * window - and the only narrow frame before it was a 620px column, which is
	 * below the app's own minimum (design round 1, D5.2).
	 */
	["settings-backend--hosting-list-open", 800, 900],
	["settings-backend--model-list-open", 1380, 900],
	["settings-backend--catalogue-partial", 1380, 900],
	["settings-backend--catalogue-in-flight", 1380, 900],
	["settings-backend--catalogue-unknown-credentials", 1380, 900],
	["settings-backend--dirty", 1380, 900],
	["settings-backend--saving", 1380, 900],
	["settings-backend--save-failed", 1380, 900],
	["settings-backend--narrow", 620, 900],
	/*
	 * And the control those rows are built on, which had never been photographed
	 * in ANY theme or state before this change — its own story was in no row of
	 * this table since it was written. It arrives in `ui/` with the frames it
	 * never had, including the one that is the whole feature: the list OPEN.
	 *
	 * `open-grouped` is the whole registry as the component sees it, headings and
	 * all; `open-filtered` is a query narrowing model rows by their selector;
	 * `no-matches` is the message that must not read as an error; and
	 * `unknown-value` is a stored value no listing contains, which must render
	 * rather than blank — with the clear affordance, which only exists on a field
	 * that is set.
	 */
	["settings-model-combobox--labelled", 560, 240],
	["settings-model-combobox--chrome-less", 560, 200],
	["settings-model-combobox--open-grouped", 560, 420],
	["settings-model-combobox--open-filtered", 560, 420],
	["settings-model-combobox--no-matches", 560, 300],
	["settings-model-combobox--unknown-value", 560, 240],
	["settings-model-combobox--active-row", 560, 460],
	["settings-model-combobox--loading", 560, 240],
	["settings-model-combobox--scoped-notice", 560, 300],
	["settings-model-combobox--unresolved-scope", 560, 300],
	["settings-model-combobox--disabled", 560, 240],
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
	 * The sidebar's session-status mark, in the one place it can be photographed
	 * as a specimen: the read/unread matrix, every code beside its own name (see
	 * the note below for why the live sidebar frames are not a substitute). Added
	 * by the receipt round, whose whole visible delta is one glyph's resting state
	 * -- without a frame here, that change had no evidence anywhere.
	 *
	 * Still the specimen frame now that the sidebar HAS a story: the matrix covers
	 * every code twice at one size, where `chat-sidebar-status-feed--*` below shows
	 * three of them in their own rows, which is what a transition needs and not what
	 * a vocabulary needs.
	 */
	["chat-session-status--neighbours", 860, 600],
	/*
	 * The conversation sidebar's row status, delivered by the machine-wide feed
	 * rather than by a catalogue read. THREE frames, and the pair they are half of
	 * is the claim: `chat-sidebar-status-feed-baseline/` is the same story captured
	 * from unmodified `origin/main`, where the frame type is unknown to the renderer
	 * and is ignored - so the branch's frame moves the row and the pre-change tree's
	 * does not. The width is the sidebar's own 360px column plus the readout that
	 * names the value under the pixels; the height holds three rows and the caption.
	 * Before this, the sidebar had no story at all and its frames came from live
	 * captures (`new-chat-row/`, `sidebar-new-chat/`), which cannot produce a
	 * before/after pair of one transition on two trees.
	 */
	["chat-sidebar-status-feed--gate-answered", 780, 560],
	["chat-sidebar-status-feed--gate-parked", 780, 560],
	["chat-sidebar-status-feed--completion-unseen", 780, 560],
	/*
	 * A row re-filing INSIDE its section (local-operator #1224's renderer half).
	 * Five states rather than five transitions: the same four-row roster once with
	 * the completed row still in the working band (`completion-in-place`, which IS
	 * the operator's report) and once with it leading the list after the catalogue
	 * frame and the reordered read (`completion-reordered`), a completed block that
	 * is already two rows deep, the same row re-filing again when the completion is
	 * READ, and the overflowing list, where the viewport rather than the row is the
	 * subject. The last one is taller on purpose: the panel is a window onto a list
	 * it cannot hold, which is the state the scroll container is asked about, and
	 * the height is the one its own content produces so the rig measures the layout
	 * the frame is shot at rather than a shorter one beside it.
	 */
	["chat-sidebar-status-feed--completion-in-place", 780, 660],
	["chat-sidebar-status-feed--completion-reordered", 780, 660],
	["chat-sidebar-status-feed--completion-second-in-band", 780, 660],
	["chat-sidebar-status-feed--completion-acknowledged", 780, 660],
	["chat-sidebar-status-feed--completion-reordered-offscreen", 780, 660],
	/*
	 * The sidebar's CURRENT ROW, and the caps beside it on that row.
	 *
	 * Two surfaces, and both are the row the reader is on: a conversation row
	 * wearing the selection ground, and the New chat row wearing it with its `⌘`
	 * and `N` caps on top — the one state where the caps used to need a
	 * caller-supplied outline to be visible at all, because the cap's fill and
	 * the row's ground were the same `sunken` role. The box is the panel's own
	 * column plus the caption that names the state, the same shape its sibling
	 * above uses.
	 *
	 * `scripts/chat-sidebar-selection.test.mjs` resolves the class expressions
	 * this pair is about, and a green assertion there says the merge is right —
	 * not that the panel READS as marked, which is what a frame is for. The
	 * before halves are `chat-sidebar-current-row-baseline/` (unmodified
	 * `origin/main`, same story, same viewports) for the ground and
	 * `command-palette-commandpalette-baseline/` for the caps on the palette's
	 * own footer, which was the other spelling of a key.
	 */
	["chat-sidebar-current-row--selected-row", 780, 560],
	["chat-sidebar-current-row--new-chat-row-current", 780, 560],
	/*
	 * The two arrangements where the mark is drawn on an ink no other state here
	 * reaches, added in round 2's remediation (design round 1, D5; QA's N3 and
	 * N6): a row carrying a `· lopdev` BINDING inside a current row — `ink-muted`
	 * on `highlight`, the ink the floors are measured for, and the case in the
	 * operator's own screenshot — and a NESTED row under its agent, which is the
	 * one place the mark is drawn at the row's own inset inside a disclosure.
	 * Before these two, every fixture row was unbound and top-level, so both were
	 * assertions in `pnpm check-themes` and in no frame at all.
	 */
	["chat-sidebar-current-row--bound-row-current", 780, 560],
	["chat-sidebar-current-row--nested-row-current", 780, 560],
	/*
	 * The SAME story with a real pointer on the neighbour row ABOVE the current
	 * one, because the pair it produces is a state a still at rest cannot hold:
	 * a hover is browser state, so the rig moves a real pointer through the input
	 * pipeline (`hover`, the option the trigger-hover frames already use) and
	 * shuts the shutter with the pointer still there.
	 *
	 * `data-chat-row:has(+ [data-chat-row][aria-current="page"])` is the row
	 * immediately BEFORE the current one — the story's roster is newest-first and
	 * its third row is the selected conversation, so this lands on "Migrate the
	 * deploy script" while "Quarterly revenue model" is current. That is the pair
	 * design round 1's D1 is measured on and the one a reader needs to judge the
	 * hierarchy: the current row paints `highlight` and the row under the pointer
	 * paints `elevated`, and whether the persistent mark still outranks the
	 * transient one is a fact about two grounds side by side in one frame.
	 *
	 * An entry of its own with a `dir` rather than a second plain tuple: a plain
	 * tuple for this story would write into `selected-row/` and overwrite the
	 * resting frame already committed there (the leaf is derived from the story
	 * id when no `dir` is given). Same arrangement as the activity-stacked hover
	 * pair above.
	 */
	[
		"chat-sidebar-current-row--selected-row",
		780,
		560,
		{
			dir: "selected-row-neighbour-hovered",
			hover: '[data-chat-row]:has(+ [data-chat-row][aria-current="page"])',
		},
	],
	/*
	 * The SETTINGS RAIL's current section, which is the other `surface` panel that
	 * paints this role and the one two earlier rounds stated as a gap: the shipped
	 * `settings-appearance` story sets `capturePending` and never clears it offline,
	 * so the sweep waited out its bound there and every row after it went stale. The
	 * story renders the rail component directly instead, which needs no bridge and
	 * no store, so the surface is photographed rather than described.
	 *
	 * 1280 wide rather than its siblings' 780: `SettingsSidebar` switches between its
	 * labelled and its 48px icon-only layouts at `(min-width: 1040px)`, and the
	 * labelled one is the surface whose current row has to carry text on the ground.
	 */
	["chat-sidebar-current-row--settings-rail", 1280, 760],
	/*
	 * The same rail with the pointer on the row ABOVE the current one, which is the
	 * pair the chat panel's own neighbour frame exists for: whether the persistent
	 * mark still out-ranks the transient one is a fact about two grounds side by side
	 * in ONE frame. The rail's rows are `li`s wrapping their own button, so the
	 * selector addresses the neighbouring `li` and lands the pointer on the button
	 * inside it; `aria-current="page"` is the rail's own marking of its current row.
	 *
	 * A NESTED state's neighbour is not in this list on purpose: the row above a
	 * nested current row is its agent's entity row, which is not `elevated` — the
	 * entities own their own hover — so a pointer there measures a different pair.
	 */
	[
		"chat-sidebar-current-row--settings-rail",
		1280,
		760,
		{
			dir: "settings-rail-neighbour-hovered",
			hover: 'li:has(+ li > button[aria-current="page"]) > button',
		},
	],
	/*
	 * The current row with the KEYBOARD on it, which is the one arrangement where
	 * two outline rules meet on one box: the row's `highlight` ground plus the
	 * app's `focus-visible` ring drawn around it. Design round 2's N3 asked for it
	 * and it has never been photographed; round 3's N4 kept it open. Shot on the
	 * ten themes the design named (the six pinned plus the four re-authored
	 * values), where a mark paid on the cast is the thing most worth looking at.
	 *
	 * 780x560 like its siblings: the ring is drawn OUTSIDE the row's box, so the
	 * frame has to include the margin it sits in.
	 */
	[
		"chat-sidebar-current-row--focused-row-current",
		780,
		560,
		{ tabTo: '[data-chat-row][aria-current="page"]' },
	],
	/*
	 * The two-swatch wash frame (design round 3, D3), labelled in the picture as a
	 * colour-only frame rather than a screen: this rig's states cannot co-shoot a
	 * current row and an `accentWash` element, and the claim is about the distance
	 * between two grounds rather than about a layout. Narrower than its siblings
	 * because there is no panel to fit - a caption and two blocks.
	 */
	["chat-sidebar-current-row--wash-swatches", 780, 260],
	/* The marks on the rows, at the panel's own width: two conversations with a browser
	   doing something and a third with none, which is the control case. */
	["chat-sidebar-status-feed--browser-marks", 780, 560],
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
	/* The MIXED open set, which is the ordinary shape of a large delegation rather
	   than an edge (`DEFAULT_MAX_RUNNING_JOBS = 15` parks the rows a fan-out cannot
	   run), and the state no committed frame showed — which is why the sentence that
	   counted parked rows as running survived four review streams (design review
	   round 2, D6). Three bands: the fan-out QA measured live, the same rule through
	   the jobs list, and a uniform set as the control. */
	["chat-composer-status-row--activity-mixed", 1000, 1000],
	/* The width story, and the only frame that can carry the numbers: each band
	   prints its own row height and `overflowX` into the picture, because a reader
	   of a still cannot measure the boxes in it. 900 is the composer's own column,
	   240 is `CHAT_CHIP_ICON_ONLY_PX`, and 172 is the floor QA measured on the built
	   app — the three widths at which the row behaves differently. */
	["chat-composer-status-row--activity-widths", 1000, 1000],
	/* The wake chip (`docs/composer-wakes.md`): one band per claim, with the count
	   GATE's own control as the fourth — the same plan and activity with no wakes,
	   where the chip's absence has to be legible as an absence. The fifth band is
	   the row at its widest, all five chips on one line. */
	["chat-composer-status-row--wake-chip", 1000, 1000],
	/* The width story with the FOURTH count chip, whose numbers are printed into the
	   frames because a reader of a still cannot measure the boxes in it. It carries
	   the same three widths as `activity-widths` plus 220, the column floor the wake
	   change was specified against. */
	["chat-composer-status-row--wake-widths", 1000, 1200],
	/* THE DISMISS AFFORDANCES and the loop chip (this change): the two RESTING states
	   only.

	   There were five more tuples here - `goal-clear-hovered`, `goal-clear-focused`,
	   `goal-clear-dismiss-focused`, `loop-clear-hovered` and `loop-clear-focused` -
	   and they are DELETED rather than fixed, because they were a claim of work that
	   never ran and five directories exist nowhere in the repository (agent review
	   round 1's MINOR 3, design review's D2). The obstacle is not laziness: this
	   machine's operator policy forbids a screenshot produced by a scripted browser
	   engine, so the rig cannot take them, and the browser tool has no hover verb, so
	   the `{ hover }` half of two of them could not be taken even at the tool.
	   What covers those states instead is `docs/evidence/composer-status-clear/`,
	   whose frames were taken through the FOCUS path in the operator's browser and
	   whose README says exactly that - including that no `:hover` frame exists and
	   that the hover paint is therefore unverified by pixels, while the class string
	   both activators share is asserted as two equal SETS in
	   `scripts/composer-tabs.test.mjs`.

	   The two tuples below remain because the rig CAN take them, and the swept set
	   owes them: they are the same two stories' resting states. */
	["chat-composer-status-row--goal-clear", 1000, 760],
	["chat-composer-status-row--loop-chip", 1000, 1000],
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
	/* The fold with main's #223 (c17da5d4b): main appended its ACTIVITY entries at
	   this same point in the list while this branch appended the composer band's,
	   so the two sides are UNIONED rather than picked - every entry from both sides
	   present exactly once, in main's order for main's ten entries, with this
	   branch's six `chat-composer-band` entries appended after them. Nothing is
	   dropped, reordered within either side, or shadowed. `--long-goal` above keeps
	   MAIN's geometry (1000x560): #223 changed that band's height and this branch
	   never touched the entry, so there is no branch intent to preserve it against. */
	/*
	 * The composer band's empty-chat state: the suggestion sample, the ambient
	 * tip row, and the chips' new weight.
	 *
	 * `empty-chat` is the app's default layout, where the chat column IS the
	 * window, so the story's column is the viewport and the shared measure caps
	 * at 900px - the frame the design record's prediction 1 is about (whether
	 * the opening four take one row). `column-floor` renders the band at 550px
	 * inside an 830x572 viewport: the narrowest window whose chat column is still
	 * 550px, which is NOT the app's own minimum window (800x600, where the column
	 * is 300px and the whole prompt is absent - that is `small-view`'s case) and
	 * it is the only frame in which the band's height cap can bind (prediction 2).
	 * `small-view` is one step below the floor, where the whole prompt - the tip
	 * row included - is absent by width alone.
	 *
	 * `draft-held` and `reduced-motion` are the tip's two clock states: the one
	 * whose clock is suspended by a draft, and the one that does not rotate at
	 * all. `draft-held` doubles as the chips' DISABLED frame - a press while the
	 * box holds a draft would replace the user's sentence - and `long-labels` is
	 * the pool's longest four, which is the worst wrap a later sample can draw.
	 *
	 * `chip-hover` is the state the set's own README used to list as missing: one
	 * chip under the real pointer, which is the only state where a borderless
	 * control's control-ness has to hold (design round 1, N3). `dir` keeps it out
	 * of the width count so `empty-chat` keeps its plain path.
	 */
	["chat-composer-band--empty-chat", 1380, 872],
	["chat-composer-band--column-floor", 830, 572],
	["chat-composer-band--small-view", 830, 572],
	["chat-composer-band--long-labels", 900, 572],
	["chat-composer-band--draft-held", 1380, 872],
	["chat-composer-band--reduced-motion", 1380, 872, { reducedMotion: true }],
	/*
	 * AND THE CAPTURE OPEN ON THE SAME BAND (UX round 4, U16). The band centres
	 * its group only while the transcript is empty, and that is exactly the state
	 * in which the sentence above the box used to move the whole group by half
	 * its height - the movement live `origin/main` does not have. The two frames
	 * are the pair: `empty-chat` with no sentence, this one with the capture open.
	 */
	["chat-composer-band--empty-chat-credential", 1380, 872],
	[
		"chat-composer-band--empty-chat",
		1380,
		872,
		{ hover: "[data-lo-suggestion-stack] button", dir: "chip-hover" },
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
	/* The turn stamps, and the two surfaces the operator named: the date and time
	   under a user turn, and the same inside a tool call the reader has opened.
	   The wide pass carries all four shapes of the formatter in one frame (today,
	   `Yesterday`, a dated stamp from this year and one from last year) plus the
	   CLEAR - a call with nothing to disclose, which is a line with no stamp. The
	   420px pass is the NARROW COLUMN rather than the small view (the bubble takes
	   the comfortable `max-w-[75%]` there; the small view is pictured by
	   `admitted-send-before-first-frame-small-view`), and it is worth a frame
	   because the transcript is a different shape at that width - not because the
	   stamp's edge could be confused with another one: a user row is
	   `flex w-full justify-end` with no right inset, so the bubble's right edge IS
	   the row content box's right edge, at every width (review round 1, R2/D3).
	   Both are clipped to their content: the stamps are 12px captions, so a tall
	   frame is almost entirely ground and `check-evidence`'s uniformity ceiling
	   rejects it as a frame that is not a picture of anything. */
	["chat-tool-rows--turn-timestamps", 1024, 760],
	["chat-tool-rows--turn-timestamps-narrow", 420, 500],
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
	/* THE INLINE CREDENTIAL CAPTURE, one frame per state the operator can be in
	   (design §1-§10), on the composer's own 1024 measure so they read beside the
	   rows above. Every one of them is driven by REAL KEYSTROKES in its play
	   function - `userEvent.type` dispatches the same keydowns a person does -
	   so the mask, the mint and the Escape restore are exercised by the frames
	   rather than photographed from a prop that fakes the state, and each play
	   fails loudly rather than releasing the shutter if its state did not
	   arrive. `escaped` is the one CREDENTIAL state where the canary is ON SCREEN,
	   and that is the point of it: it is the only exit that leaves a secret in the
	   composer, and it is there because the operator asked for it with Esc. That is
	   also why the draft store is cleared between frames: the escaped plaintext is
	   PERSISTED (design §6), so without the clear the six states captured after it
	   restored it and were photographed holding a secret they have nothing to do
	   with (design round 2, D1). */
	["chat-message-input--credential-armed", 1024, 300],
	["chat-message-input--credential-masked", 1024, 300],
	["chat-message-input--credential-pill-mid-prose", 1024, 300],
	["chat-message-input--credential-pill-at-line-start", 1024, 300],
	/*
	 * THE MARKER NOTHING BACKS (design round 4, D3). The state is a restored
	 * draft's: the marker text is persisted (§6) and the payload map is a ref, so
	 * a reload paints a citation nothing holds - in the NOT-STORED register, which
	 * round 3 gave a dashed edge (design round 4, D2) so its meaning survives its
	 * hue. The row above is its pair: the same characters, the same position, and
	 * a live payload.
	 */
	["chat-message-input--credential-pill-unbacked", 1024, 300],
	["chat-message-input--credential-escaped", 1024, 300],
	/* THE TWO SURFACES ROUND 3 FOUND UNPHOTOGRAPHED (design D3, D4), and the
	   reason the round-2 "the row grows by at most 7.5px" bound was wrong: the
	   five states above render on a bare 1024px column with no working-directory
	   chip and no readings strip, so no frame showed the sentence beside the two
	   neighbours whose widths decided whether it wrapped - and none paired
	   `isSmallView` with the capture at all, though the small-view rung is where
	   the bound measured 11px. `masked-session-pane` carries the chip and the
	   readings with the sentence; `masked-small-view` is the shipped compact rung
	   (a 440px column) with the capture open, at the same 300px height so the two
	   read beside the states above. */
	["chat-message-input--credential-masked-session-pane", 1024, 300],
	["chat-message-input--credential-masked-small-view", 440, 300],
	["chat-message-input--interrupt-left-work-running", 1024, 300],
	/* The SETTLED idle row (UX round 1's U1 / QA's Q1, and the operator's report
	   that the first fix left a standing gap) at both rungs, the two shorter notice
	   branches (design round 1's N2), and the version-skew line. The slot is now
	   held for a grace window after a turn ends and is empty once the row has
	   settled, so these two frames are the pair that shows the reservation is GONE
	   at idle - read against `stop-control-while-streaming` (the same cluster,
	   occupied) and `stop-control-without-capability` (a backend that could never
	   hold it). The grace window itself is measured in the real app and framed under
	   `interrupt-live/`. */
	["chat-message-input--stop-slot-settled", 1024, 300],
	["chat-message-input--stop-slot-settled-small-view", 1024, 300],
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

	/*
	 * App shell, swept for the rail-width finding.
	 *
	 * AND WHY THE `settings-appearance` ROW SITS AFTER THE FOUR `agents` ROWS.
	 * Position in this list is REACHABILITY, not presentation: an offline sweep
	 * visits these rows in order, and `shell-app-shell--settings-appearance` is
	 * the row that never clears — it holds `documentElement.dataset.capturePending`
	 * because the offline settings page never renders the Appearance switch the
	 * story waits for, so the readiness probe throws at its 60s bound, and the
	 * story loop has no per-story catch to survive a throw. The sweep therefore
	 * ENDS there and every row after it is a surface no future sweep can refresh:
	 * the four `agents` rows alone are 48 frames at twelve themes, plus
	 * `settings`, `agents-empty` and `rail-collapsed`. `manifest.json`'s
	 * `keycapsCapture.blocked` records the same measurement, and
	 * `docs/evidence/chat-sidebar-current-row/README.md` states it as a gap.
	 *
	 * That is why this row is not moved earlier for tidiness: the move reads as
	 * an ordering preference and is in fact a silent shrink of the reachable set,
	 * and no gate can see it — `check-evidence` validates committed frames against
	 * their stamps, and an aborted sweep never reaches the manifest write, so the
	 * frames that stop being re-captured go stale with nothing to report it.
	 * Giving those rows up is a decision for the set's README and the commit
	 * message, not a side effect of where a tuple sits.
	 */
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
	 * is the panel and the snackbar disagreeing.
	 *
	 * ONE TREE, NOT TWO (design round 2, D3). This comment used to say the pair was
	 * captured on two trees, "this one and a worktree at the pre-fix commit". It is
	 * not, and the set contains no pre-fix-tree capture: every frame here is a frame
	 * of THIS build, and the `before-the-fix` half is the same build rendering the
	 * verdict `origin/main` produced for this machine's readings - the producer's
	 * answer quoted, which is what `before-the-fix/`'s own section in this set's
	 * README says and why a panel-copy change moves that half too. The stale sentence
	 * was left by the round that rewrote that README for the same finding.
	 *
	 * Captured from a PRODUCTION Storybook build, because the button does not check
	 * at all when import.meta.env.DEV is true; see the story's own note.
	 */
	[
		"settings-app-updates-section--server-update-offered",
		900,
		/*
		 * 572, WITH EVERY OTHER STATE OF THIS SURFACE, and it is the app's own
		 * MINIMUM window rather than a convenient frame: `WINDOW_MIN_HEIGHT = 600`
		 * minus the 28px of chrome the renderer does not own. This set used to be
		 * captured at two heights - 460 here and 900x620 for the states the
		 * serving-install change added - so the baseline could not be laid beside the
		 * states it has to be told apart from: the pane's geometry differs, and in the
		 * 460 frames all four version columns and the whole button label are visible
		 * where the new ones have the card over them (design round 1, D2). One height
		 * for the whole surface makes the comparison the states exist for possible,
		 * and 572 is the one that also carries the supported worst case (D1).
		 */
		572,
	],

	/*
	 * The other half of the same story: both channels proved current, so the
	 * verdict carries the affirmation and no offer is raised. Captured here
	 * because the sentence is new copy - the removed button stories drew their
	 * own "latest version" alert from a channel event, which is a state the
	 * shipped button can no longer produce, so the sweep had no frame of the
	 * sentence the fix introduces. Not captured on a pre-fix tree: the
	 * affirmation exists only on this one.
	 */
	["settings-app-updates-section--all-current", 900, 572],

	/*
	 * THE OPERATOR'S OWN MACHINE, and the pair no existing frame covers: an
	 * app-managed server three releases behind its published release, reported as
	 * up to date.
	 *
	 * `before-the-fix` is the verdict origin/main reached for this machine's state
	 * (the whole check affirmed, while the same pane's Server version row printed
	 * the older daemon it was talking to), and `server-behind-serving-install` is
	 * what the check answers for the same state now: an offer naming the SERVING
	 * install, no affirmation, and no package-manager command for an install no
	 * package manager owns.
	 *
	 * Both are captured from the SAME production build, because the difference
	 * between them is the verdict the main process produces rather than anything
	 * the renderer decides - the story scripts the producer's own answer, and the
	 * two answers are quoted with their log lines on the pull request. There is
	 * therefore no pre-fix tree to capture the first one on: the payload is a
	 * value here, not a function of the tree.
	 */
	[
		"settings-app-updates-section--before-the-fix",
		900,
		/*
		 * THE APP'S MINIMUM WINDOW, like every other state here (design round 1, D1
		 * and D2). Measured rather than guessed: this entry was 620 because at 460 the
		 * pane's own fixed panel clipped the Details block - the line that names the
		 * install the check judged - and a frame whose subject is the copy has to
		 * include the copy. 620 was the one height at which the CARD happened to fit,
		 * which turned the knob on the capture instead of on the card: at 572 the
		 * unbounded card ran 53px past the window with no scroll container to reach the
		 * tail, and the committed frame could not show that because it was never taken
		 * there. The card is bounded to the viewport now (see `UpdateContainer`), so
		 * the worst case fits the frame as a closed card.
		 */
		572,
	],
	["settings-app-updates-section--server-behind-serving-install", 900, 572],
	["settings-app-updates-section--serving-server-behind-install", 900, 572],

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

	/*
	 * The publish dialog, in every state its rewrite introduced (agent-hub
	 * contract §6.2/§6.3): the consent copy that now says what is published, the
	 * blocked-field list that disables submit, and each refusal with its own
	 * headline, action and register. Six of the ten are reached by PRESSING the
	 * consent box and Publish — a treatment rendered from a prop would not be
	 * evidence that the flow reaches it.
	 *
	 * 980x860: the dialog at its own `sm` step (max-w-xl) plus the page it is
	 * centred in. Declared rather than measured for the reason every entry here
	 * is — a frame whose height depends on which refusal is showing is a frame a
	 * reviewer cannot diff against the next round's.
	 */
	["agents-publish-dialog--default", 980, 860],
	["agents-publish-dialog--pre-validation-blocked", 980, 860],
	["agents-publish-dialog--name-taken", 980, 860],
	["agents-publish-dialog--name-taken-by-you", 980, 860],
	["agents-publish-dialog--name-claim-in-flight", 980, 860],
	["agents-publish-dialog--reserved-builtin", 980, 860],
	["agents-publish-dialog--reserved-builtin-refusal", 980, 860],
	["agents-publish-dialog--moderation-rejected", 980, 860],
	["agents-publish-dialog--moderation-unavailable", 980, 860],
	["agents-publish-dialog--published", 980, 860],
	["agents-publish-dialog--update-listing", 980, 860],
	/*
	 * The pull's four outcomes, each one real toast from the real hook against a
	 * stubbed transport, held open with `toastDuration: Infinity` because an
	 * auto-closed toast is a frame that cannot be reproduced. Sized tight to the
	 * caption plus the toast: a taller viewport is mostly ground, which
	 * `check-evidence` rejects as a story that painted nothing.
	 */
	["agents-pull-outcomes--downloaded", 980, 420],
	["agents-pull-outcomes--adjusted-name", 980, 420],
	["agents-pull-outcomes--already-held", 980, 420],
	["agents-pull-outcomes--refused", 980, 420],
	["agents-pull-outcomes--refused-prose", 980, 420],
	/*
	 * The Schedules page, re-shot whole when the page was harmonized onto the
	 * wake primitive: its rows are conversations-with-wakes now, so every
	 * frame the surface had was a picture of a page that no longer exists. The
	 * four that were already here are kept - `list` is still the populated list,
	 * `picker-open` is still the date-time field, and the two row-action frames
	 * still hold an icon-only control's accessible name - and the states the
	 * design round names are added beside them, because a frame set that covers
	 * one state of a page with five is how a state ships unrendered.
	 */
	["schedules-page--list", 1280, 900],
	["schedules-page--list-narrow", 1280, 900],
	["schedules-page--empty", 1280, 900],
	["schedules-page--loading", 1280, 900],
	["schedules-page--load-error", 1280, 900],
	/*
	 * The pair to `load-error`, and the reason it needs its own story: the
	 * marker that says the rows on screen are the last list that LOADED cannot
	 * appear where there are no rows, so a set that stops at the total failure
	 * cannot photograph the state a user meets when the daemon goes away under an
	 * open page.
	 */
	["schedules-page--stale-rows", 1280, 900],
	["schedules-page--one-wake", 1280, 900],
	["schedules-page--three-wakes", 1280, 900],
	["schedules-page--parked", 1280, 900],
	["schedules-page--spent", 1280, 900],
	["schedules-page--read-error", 1280, 900],
	["schedules-page--supervisor-down", 1280, 900],
	["schedules-page--legacy-only", 1280, 900],
	["schedules-page--cancel-confirm", 1280, 900],
	["schedules-page--create-dialog", 1280, 900],
	["schedules-page--create-dialog-existing", 1280, 900],
	["schedules-page--create-dialog-no-conversations", 1280, 900],
	["schedules-page--create-dialog-every", 1280, 900],
	/* The repeat floor, refused inline: the one refusal the dialog owns rather
	   than letting the transport answer for it with its generic sentence. */
	["schedules-page--create-dialog-repeat-floor", 1280, 900],
	["schedules-page--create-dialog-ceiling", 1280, 900],
	["schedules-page--edit-wake", 1280, 900],
	/* The editor after a REPEAT-only change: the path the old re-anchor sentence
	   was false on, and the dirty `Save` the old dialog enabled with nothing to
	   save. */
	["schedules-page--edit-wake-repeat-only", 1280, 900],
	["schedules-page--picker-open", 1280, 900],
	["schedules-page--row-actions-revealed", 1280, 900],
	["schedules-page--row-action-label", 1280, 900],
	["common-confirmationmodal--dangerous", 1280, 900],
	/* The operator's own alert, over the screen they were working on: their
	   update-service.log holds this exact transport code at 09:03:12 on
	   2026-09-16, reported from a silent background check on a machine with
	   continuous internet. The story renders the shipped alert and holds it open
	   (the app gives it six seconds, which a still cannot catch); the wiring is
	   scripts/update-affirmation.test.mjs. */
	["common-updatenotification--error-state", 1280, 900],
	/*
	 * The same alert for the WRAPPED feed failure, which is the shape the copy's
	 * prefix rule is about (design round 1, D1 asked for exactly this frame): the
	 * sentence must stand alone, with the machine's words subordinate rather than
	 * welded to the front of it.
	 */
	["common-updatenotification--error-state-wrapped", 1280, 900],
	/*
	 * The retry IN FLIGHT, which no frame showed: the card used to unmount the moment
	 * it was pressed, so "a check is running" and "the problem is fixed" looked the
	 * same for the app's 1 s + 3 s ladder (design round 2, D13; UX U7). The pressed
	 * control is what says which one it is.
	 */
	["common-updatenotification--error-state-retrying", 1280, 900],
	/*
	 * A DOWNLOAD-stage failure: the copy names the surface that owns the retry rather
	 * than the box it is not in, and no control is offered for a stage a check cannot
	 * answer (design round 2, D9; UX U9).
	 */
	["common-updatenotification--error-state-download", 1280, 900],
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
	/*
	 * The two states the operator's own report produced (2026-09-15), and neither
	 * had a frame anywhere in this set: the panel he was STUCK ON ("Updating
	 * server", which no story could reach without pressing the shipped control,
	 * because the state exists only while the invoked update is running), and the
	 * FAILURE that replaced it, which the branch announced with a toast in the
	 * opposite corner and a retry that was off the screen (design round 1, D1/D2).
	 * The failure frames are the ones the design round re-judges; the in-flight pair
	 * is their before-half.
	 */
	["common-updatenotification--backend-update-in-flight", 1280, 900],
	["common-updatenotification--backend-update-failed", 1280, 900],
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
	/* The transcript's ENDING when a finished conversation is read with the
	   runtime's own stale `live_events` seed folded in — the operator's report:
	   `wait`/`hub`/`task`/`bash` rows from the previous morning painted UNDER the
	   final assistant message. Both orders are built by the SHIPPED reducer from
	   the real journal of session `f91fbda61750`
	   (`scripts/fixtures/stale-seed-order.json`): `Before` runs the pre-fix fold
	   (`applyEvent` per seed event at the reader's arrival) and `After` runs
	   `applyLiveSeed` with the snapshot's own `streaming: false`. They are one
	   tree's frames rather than a base/head pair, because a pair from two trees
	   cannot be re-captured once the base moves; `README.md` in the set says so
	   where the images live.

	   All four declare 800 as a VIEWPORT FLOOR, not as the delivered size: the
	   story pins the transcript pane to the reader's own 685px and the harness
	   floors its viewport at the document height, so the committed frames are the
	   pane plus the caption (the harness delivers them at whatever that measures).
	   The pin is the point — a transcript story with no fixed height grows its
	   viewport to its content, and the `Arrival` state then paints the answer 48%
	   down a 3058px frame instead of out of the pane, which the frame's own caption
	   would be contradicting. `Arrival` is the unreduced seed; `Seam` narrows it to
	   the newest twelve unlabelled calls so the answer and what sits under it fit
	   one frame together. */
	["chat-stale-seed-order--before-arrival", 1280, 800],
	["chat-stale-seed-order--after-arrival", 1280, 800],
	["chat-stale-seed-order--before-seam", 1280, 800],
	["chat-stale-seed-order--after-seam", 1280, 800],
	/* The phantom compose rows: the four rows the operator photographed stuck at
	   the bottom of a conversation waiting on subagents — `hub composing 2.0 KB`
	   and three `wait composing` rows, all of them calls the harness NEVER RAN.
	   Built by the SHIPPED reducer from the real snapshot's frames
	   (`scripts/fixtures/phantom-compose-rows.json`), and the states are the
	   contract's endings rather than a montage: `arrival` is the seed as it
	   arrives, `settled`/`settled-open` the verdict on the row its own
	   announcement left, `settled-empty` a call that composed nothing,
	   `queued`/`queued-seeded` the dictation ending with and without a row on
	   screen to settle, and `durable-twin`/`durable-twin-open` the case where the
	   transcript's own row is loaded.

	   THE `before` HALF IS NOT THIS TABLE'S, and that is the point of it: those
	   frames are the same states rendered by the BASE tree
	   (`phantom-compose-rows-before.stories.tsx`, deliberately not listed here),
	   captured in a worktree at the base commit and moved under
	   `chat-phantom-compose-rows/before/`, which `manifest.json` declares as a
	   supplementary set with its own `source`. A `before` captured from this tree
	   photographs the fix — the first pass of this set did exactly that, and
	   agent review round 1 caught it by folding the committed fixture through the
	   real pre-fix reducer and finding the fields identical and the order not.
	   `README.md` in the set carries the recipe.

	   `settled-narrow` is captured at 420px because the fixed summary is eleven
	   characters longer than the composing one it replaced, so the shed order
	   under width pressure is part of what this change has to show. */
	["chat-phantom-compose-rows--after-arrival", 1280, 800],
	["chat-phantom-compose-rows--after-settled", 1280, 800],
	["chat-phantom-compose-rows--after-settled-open", 1280, 800],
	["chat-phantom-compose-rows--after-settled-empty", 1280, 800],
	["chat-phantom-compose-rows--after-settled-narrow", 420, 800],
	["chat-phantom-compose-rows--after-queued", 1280, 800],
	["chat-phantom-compose-rows--after-queued-seeded", 1280, 800],
	["chat-phantom-compose-rows--after-turn-death", 1280, 800],
	["chat-phantom-compose-rows--after-durable-twin", 1280, 800],
	["chat-phantom-compose-rows--after-durable-twin-open", 1280, 800],
	/* The SAME CLASS while the turn is LIVE, which the pair above deliberately does
	   not cover: its fixture is a finished turn (`streaming: false`), where a
	   clockless frame that would create a row is refused. With a turn in flight
	   the fold this change replaces painted it at the reader's arrival instead, and
	   the operator's report is that state — opening session `c1c7072b735c` mid-turn
	   painted the OPENING turn's eight `bash` calls, an hour earlier, under the
	   running `wait`, each showing its output's first line where the command
	   belongs. The `After` frames are built by the SHIPPED reducer from the real
	   journal and the real snapshot seed of that session (`scripts/fixtures/
	   trace-order.json`, harvested by `scripts/harvest-trace-order-fixture.mjs`);
	   the `Before` frames by a story-local re-implementation of the pre-fix fold,
	   because the state they are evidence about no longer exists in the shipped
	   code and a pair shot from two trees cannot be re-captured once the base
	   moves. `Report` folds the eight calls the report proves — the page at that
	   moment names none of them (`page_names_ghosts: []`) — over the in-flight
	   frame; `Live` folds the unmodified harvest — 100 retained ends, 59 of them
	   naming a call the page cannot label. The pane is pinned here for the same
	   reason as the pair above, and the arrival stamp is derived from the
	   snapshot's own in-flight call so the frames do not move between captures. */
	["chat-trace-order-while-live--before-report", 1280, 800],
	["chat-trace-order-while-live--after-report", 1280, 800],
	["chat-trace-order-while-live--before-live", 1280, 800],
	["chat-trace-order-while-live--after-live", 1280, 800],
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
	/*
	 * THE COMPOSER'S `@` MENTION LAYER: the chip drawn behind the sentence, and the
	 * picker over it.
	 *
	 * A narrowed surface of its own rather than entries appended to a neighbouring
	 * set, because the claim is new rather than a re-take of an old one. The band's
	 * own measure is the app's default window (1380x872), so every chip frame is
	 * read at the width the app ships; `wrapped-mention` narrows the COLUMN to
	 * 420px inside that viewport, which is the frame the fill's per-line-fragment
	 * behaviour is read from, and `picker-rows` is captured TWICE because the row
	 * budget is a claim about two frames: 1380x768 for the ceiling and 768x520 for
	 * the floor, where the region must show fewer rows rather than push the shell
	 * off the bottom.
	 *
	 * `quoted-mention` is design round 1's D2 and review round 2's own note: the
	 * quoted form `@"my file.txt"` paints ONE fill over a space, which is the shape a
	 * merged pair used to have, so it is the pair to `adjacent-mentions` and the last
	 * state on this surface that was argued rather than photographed.
	 *
	 * `before-no-mentions` is the pair's other half on purpose: it is the same
	 * sentence with the same file named as prose, which is what `origin/main` paints
	 * for it, so a reader can compare the feature rather than two of its states.
	 */
	["chat-mention-chips--before-no-mentions", 1380, 872],
	["chat-mention-chips--mention-at-rest", 1380, 872],
	["chat-mention-chips--mentions-at-the-edges", 1380, 872],
	["chat-mention-chips--adjacent-mentions", 1380, 872],
	["chat-mention-chips--quoted-mention", 1380, 872],
	["chat-mention-chips--unresolved-stays-prose", 1380, 872],
	["chat-mention-chips--chip-needs-approval", 1380, 872],
	["chat-mention-chips--caret-inside-token", 1380, 872],
	["chat-mention-chips--wrapped-mention", 1380, 872],
	/*
	 * The four surfaces this remediation added, each a state a finding named:
	 * `harness-cannot-expand` is the state every release carries today (no
	 * `references` capability, so no list and no chip), `small-view-520` is the
	 * field's 6px inset that decided the overhang, `scrolled-draft` is the fill
	 * layer travelling with the field's own scroll, and `atomic-delete` is the one
	 * chip promise that is not a drawing.
	 */
	["chat-mention-chips--harness-cannot-expand", 1380, 872],
	["chat-mention-chips--small-view-mention", 1380, 872],
	["chat-mention-chips--scrolled-draft", 1380, 872],
	["chat-mention-chips--atomic-delete", 1380, 872],
	["chat-mention-chips--no-rows-enter", 1380, 768],
	["chat-mention-chips--picker-open", 1380, 768],
	["chat-mention-chips--picker-drilled", 1380, 768],
	["chat-mention-chips--picker-descend", 1380, 768],
	["chat-mention-chips--picker-no-match", 1380, 768],
	["chat-mention-chips--picker-empty-folder", 1380, 768],
	["chat-mention-chips--picker-unreadable", 1380, 768],
	["chat-mention-chips--picker-many-rows", 1380, 768],
	/*
	 * The design's own narrow case, 800x600, as its open item 3 asks: the picker's
	 * top edge must be inside the column and the row count must have FALLEN rather
	 * than the shell being pushed off the bottom. The same story twice is the
	 * comparison — the budget is a claim about two frames, not about the formula.
	 */
	["chat-mention-chips--picker-many-rows", 800, 600, { dir: "budget-800x600" }],
	/*
	 * And the ceiling, at the band's own window: the budget's other end. The
	 * formula clamps at eight rows whatever the room, so a frame at 1380x872 is
	 * what shows the ceiling rather than the room — three frames of one story, for
	 * the three answers 4, 7 and 8.
	 */
	[
		"chat-mention-chips--picker-many-rows",
		1380,
		872,
		{ dir: "ceiling-1380x872" },
	],
	/*
	 * And the FLOOR the design's open item 3 names, which no frame had shown
	 * (design round 1, D7): at this window the room above the anchor buys exactly the
	 * three rows `atRowBudget` clamps at — a taller window is four or more and a
	 * shorter one overflows the window's own top edge, because the floor holds the
	 * region at three rows whatever the room — so a reader can see the clamp bind,
	 * rather than read it as a branch in a pure function.
	 */
	["chat-mention-chips--picker-many-rows", 768, 520, { dir: "floor-768x520" }],
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
	/* The mid-draft state round-1 D1 judged AND the state the fix puts in its
	   place, as the two cases of one board — the after-picture is absence, and a
	   lone composer story counts five elements against this rig's floor of nine,
	   so a board is the only shape that can carry it (round 2, D5). Then the
	   `/compact` row a reader meets when they type `/comp`. */
	["chat-slash-completion--inline-mid-draft-pair", 768, 640],
	["chat-slash-completion--compact-row", 768, 340],
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
	/* The session-free panel: `/analytics` with no conversation in front of the
	   user, so the `This session only` check is absent and the scope still reads
	   `all sessions`. Paired with `populated`, which carries the check.

	   `dir` is named on BOTH session-free entries because this story is now swept
	   at two widths: the capturer derives a leaf from the story name, and with two
	   widths it would silently move the committed `session-free` frames to
	   `session-free@1140`. */
	["panels-analytics--session-free", 1140, 980, { dir: "session-free" }],
	/* The same state at 720px, which is the width § 11's narrow row asks for and
	   the one no committed frame carried in this state (design round 1, D4):
	   `panels-analytics--narrow` is the SESSION-ful story, so "the removed scope
	   cluster does not shift the surviving controls" had no frame for the state
	   this change adds. The toolbar's groups keep their boxes at 720 too, which is
	   what the frame is for. */
	["panels-analytics--session-free", 720, 980, { dir: "session-free-narrow" }],
	/*
	 * The same payload with the pointer ON THE BAR, which is what this change is
	 * about: recharts' own cursor for a `BarChart` is a full-height rectangle over
	 * the category band, so before this branch the frame under the pointer showed
	 * the whole COLUMN highlighted and the bar the question was about unchanged.
	 * The story adds nothing (`panels-analytics--populated-hover`), because
	 * `:hover` cannot be a story state; the rig's own CDP input is what puts the
	 * pointer there. `hoverSettleMs` is the tooltip's 400 ms open delay — without
	 * it the frame is the resting state under a name that claims a hover.
	 */
	[
		"panels-analytics--populated-hover",
		1140,
		980,
		{
			hover: ".recharts-bar-rectangle .recharts-rectangle",
			hoverSettleMs: 900,
		},
	],
	/*
	 * The same hover on a bar of a few pixels: review round 1 (D7) found every
	 * hover frame pointing at the shortest NON-zero bar, which is still 834k of a
	 * 1.9M peak, so "is the step findable on a thin bar" had no frame. The story
	 * puts a 60k day first and the same selector lands on it.
	 */
	[
		"panels-analytics--populated-hover-shallow",
		1140,
		980,
		{
			hover: ".recharts-bar-rectangle .recharts-rectangle",
			hoverSettleMs: 900,
		},
	],
	["panels-analytics--refreshing", 1140, 980],
	["panels-analytics--thirty-days", 1140, 1020],
	["panels-analytics--this-session-only", 1140, 980],
	["panels-analytics--unpriced", 1140, 980],
	["panels-analytics--partial-cost", 1140, 980],
	["panels-analytics--no-daily-rows", 1140, 980],
	["panels-analytics--unnamed-sessions", 1140, 980],
	/*
	 * The same state with the panel body parked at its END, which is the only way
	 * the By-session table's rows are in the picture at all: review round 1 (D6)
	 * found this story's frame byte-identical to `populated` in ten of twelve
	 * themes, because the distinguishing rows (the hex ids) sit below a body fold
	 * that is capped at `min(76vh, 760px)` — so a taller VIEWPORT does not reach
	 * them, it only adds margin. The scroll position is browser state no story can
	 * set, which is what `scrollToEnd` is for; the at-rest frame stays in its own
	 * directory, as did `chat-tool-rows--expanded-overflow-narrow-end`.
	 */
	[
		"panels-analytics--unnamed-sessions",
		1140,
		980,
		{
			dir: "unnamed-sessions-end",
			scrollToEnd: "[data-panel-body]",
		},
	],
	["panels-analytics--empty", 1140, 460],
	["panels-analytics--loading", 1140, 460],
	["panels-analytics--unavailable", 1140, 400],
	["panels-analytics--dense", 1140, 1100],
	["panels-analytics--narrow", 720, 980],

	/*
	 * THE BY-SESSION TABLE'S OWN STATES: paging, sorting, search, the filter.
	 *
	 * Two viewports are used for one reason, and it is a property of the host
	 * rather than of any of these stories: the panel body is capped at
	 * `min(76vh, 760px)` (`picker-host.tsx`), the section sits below the stat grid
	 * and the chart, and the section is taller than that cap — so NO single frame
	 * holds the strip, the twenty rows, the legend and the pager at once.
	 *
	 * Both halves of the section are therefore photographed, and the parking is
	 * the rig's rather than a story's:
	 *
	 * - the AT-REST entry parks the body on the section's TOP through
	 *   `scrollTo`, which is where the strip, the match line and the header row's
	 *   chevrons are;
	 * - the `-end` entry parks it at the body's own end through `scrollToEnd`,
	 *   which is where the legend and the pager are.
	 *
	 * Leaving the at-rest half to a `play` that clicks a control and lets the
	 * browser scroll the focused element into view is what review round 1 caught
	 * (M2/D2/D3): two committed directories were captioned with a subject no pixel
	 * contained, because a side effect is not a guarantee — the same story with a
	 * different `play` would have silently shown the panel's top instead.
	 *
	 * `session-narrow-720` is parked the same way: at 720 the claim is the strip
	 * itself, and the strip is below the fold at rest.
	 *
	 * The claims these frames CANNOT carry are asserted in each story's own
	 * `play` — `aria-sort` on the header cell, the `tbody tr` count, the live
	 * region's text and where focus is after a page turn — and the plays are
	 * scoped to the by-session table's own accessible name, because the panel body
	 * holds two tables. The model's rules are the node suite's
	 * (`scripts/analytics-session-table.test.mjs`).
	 */
	[
		"panels-analytics--populated",
		1140,
		980,
		{ dir: "populated-end", scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--dense",
		1140,
		1100,
		{ dir: "dense-end", scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-paginated",
		1140,
		980,
		{ scrollTo: SESSION_SECTION },
	],
	[
		"panels-analytics--session-paginated",
		1140,
		980,
		{ dir: "session-paginated-end", scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-page-two",
		1140,
		980,
		{ scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-last-page",
		1140,
		980,
		{ scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-sorted-by-cost",
		1140,
		980,
		{ scrollTo: SESSION_SECTION },
	],
	[
		"panels-analytics--session-sorted-by-cost",
		1140,
		980,
		{ dir: "session-sorted-by-cost-end", scrollToEnd: "[data-panel-body]" },
	],
	/* The label column ascending: the order AND the chevron are at the section's
	   top, so this one frame carries both halves of the claim. */
	[
		"panels-analytics--session-sorted-by-session",
		1140,
		980,
		{ scrollTo: SESSION_SECTION },
	],
	/* The query stories are parked on the section because the match line lives in
	   the strip. The empty state is the exception: the strip stays and the table
	   does not, so the whole thing is shorter than the panel's other content and
	   needs no parking. */
	[
		"panels-analytics--session-search-match",
		1140,
		980,
		{ scrollTo: SESSION_SECTION },
	],
	["panels-analytics--session-search-empty", 1140, 980],
	[
		"panels-analytics--session-top-level-only",
		1140,
		980,
		{ scrollTo: SESSION_SECTION },
	],
	[
		"panels-analytics--session-top-level-only",
		1140,
		980,
		{ dir: "session-top-level-only-end", scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-scale-30-d",
		1140,
		1020,
		{ scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-analytics--session-narrow-720",
		720,
		980,
		{ scrollTo: SESSION_SECTION },
	],

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
	/* The session-free panel: `/info` with no conversation in front of the user,
	   which is the state the panel is now readable in. No "This conversation"
	   section, and its description naming the sessions section instead. Paired
	   with `populated` and `live-half-unmeasured`, which must be untouched.

	   `dir` on both session-free entries for the same reason `/analytics`'s carry
	   it: the story is swept at two widths now, and the derived leaf would move the
	   committed frames to `session-free@1140` otherwise. */
	["panels-info--session-free", 1140, 1040, { dir: "session-free" }],
	["panels-info--populated", 1140, 1040],
	/*
	 * THE TWO FRAMES THAT CARRY THIS CHANGE'S CENTRAL CLAIM (design round 1, D3).
	 *
	 * Every other entry in this family is taken at the TOP of a body that folds at
	 * `min(76vh, 760px)`, and the block this change removes sat at in-body
	 * y 1427..1650 — 750px below the fold in BOTH states. Measured, the
	 * `session-free`/`populated` pair differs inside exactly one band (y 127..139,
	 * the description line) with a stray pixel in four themes, so "no `This
	 * conversation` heading and no empty notice where it stood" rested on the
	 * reader taking the author's word for it. Only a scroll can reach that region —
	 * a taller viewport cannot, it adds margin below a body that is capped — which
	 * is what `scrollToEnd` exists for, in the shape
	 * `panels-analytics--unnamed-sessions` already uses and states the reason for.
	 * Paired, because the claim is about the DIFFERENCE between the two states: the
	 * session-free end shows the block gone and the 32px section rhythm unbroken,
	 * the populated end shows the block present in the same place at the same
	 * rhythm.
	 */
	[
		"panels-info--session-free",
		1140,
		1040,
		{ dir: "session-free-end", scrollToEnd: "[data-panel-body]" },
	],
	[
		"panels-info--populated",
		1140,
		1040,
		{ dir: "populated-end", scrollToEnd: "[data-panel-body]" },
	],
	/* The same state at 720px (design round 1, D4): `/info`'s narrow frame is the
	   session-ful story, so the narrow half of "the removed blocks do not shift the
	   surviving ones" had no frame in the state this change adds. The install card
	   grid's 2+1 reflow and the section rhythm are what this is read for. */
	["panels-info--session-free", 720, 1040, { dir: "session-free-narrow" }],
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
	/* The fleet answer's honesty states, which is where this section can lie:
	   the `≥` bound, the `—` refusal, the measured zero with a queue beside it,
	   the earned `none running`, the wedged split, and the registry that could
	   not be scanned at all. */
	["panels-info--fleet-all-reporting", 1140, 1040],
	["panels-info--fleet-one-does-not-report", 1140, 1040],
	["panels-info--fleet-nobody-reports", 1140, 1040],
	["panels-info--fleet-queued-only", 1140, 1040],
	["panels-info--fleet-all-idle", 1140, 1040],
	["panels-info--fleet-wedged", 1140, 1040],
	["panels-info--fleet-unavailable", 1140, 1040],
	/* The section in SITU, with the sessions section above it: the only frame that
	   can answer whether it belongs to this panel. */
	["panels-info--fleet-neighbours", 1140, 1040],
	/* 720px, and the state whose note carries two clauses - the width and the
	   wrap the other frames cannot show. */
	["panels-info--fleet-narrow", 720, 1040],
	/* The one frame whose note WRAPS at the capture width: what D5's non-breaking
	   separator is for, photographed rather than only asserted. */
	["panels-info--fleet-note-wraps", 1140, 1040],
	/* The sixth refusal: a probe that FAILED is an unknown, never a zero - the
	   field-level spelling, and beside it the block-level one. */
	["panels-info--fleet-probes-failed", 1140, 1040],
	["panels-info--fleet-agents-unread", 1140, 1040],
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
	["common-connectivity-banner--unattachable", 1024, 300],
	/* The machine-offline claim itself, and the one state the internet banner may
	   paint: a negative reading that has held across the grace and been confirmed
	   by a second one. Its companion - the same reading BEFORE the grace, which
	   paints nothing - has no frame on purpose: a still of an absent banner cannot
	   be told from a story that never mounted (the trap `attached` documents), so
	   the rule is pinned by its own cases instead. */
	["common-connectivity-banner--internet-offline-confirmed", 1024, 420],

	/*
	 * The transcript's LINK affordances (`link-targets.stories.tsx`), and the two
	 * pointer states among them are the ones nothing else can photograph.
	 *
	 * The REVEALED toolbar is browser state: a story `play` cannot produce a real
	 * pointer, so these entries pass the rig's own `{ hover }` - CDP
	 * `Input.dispatchMouseEvent` through the input pipeline, the same mechanism the
	 * trigger-hover frames use - and the toolbar is raised by the shipped
	 * `pointerover` handler reacting to it.
	 *
	 * `DetectedTargets` is the resting half and carries the eight admission shapes
	 * in one frame (a `~` path, the operator's own report; a backticked path; a
	 * `file://` URL; a bare https URL that remark-gfm already linked, which must not
	 * be linked twice; a path in a table cell; a directory; a path that is not
	 * there; and one long enough to wrap). There is NO `main`-side before half for it,
	 * and there cannot be: the story file is ADDED by this branch, so no frame of it
	 * exists on `main` at all. What the set does have is the story's own RESTING
	 * state - the same text with no pointer on it and no highlight in it - and the
	 * change it is the "before" of is "the previous behaviour was no anchor at
	 * all", which round 1 (review M5) corrected in this file and in the design doc.
	 *
	 * `hover-file` is the file case (Copy, Open, Open folder); `hover-url` is the
	 * URL case, which is the already-captured-by-markdown case and offers no Open
	 * folder; `hover-directory` is the matrix's one deliberate omission; and
	 * `hover-missing` is the state that replaced a press which silently did
	 * nothing, so what it shows is a SENTENCE rather than a disabled button.
	 *
	 * The narrow pass is its own entry rather than a second width of the same one:
	 * a long path in a 420px column wraps, and where the toolbar lands for a
	 * wrapped link is exactly what it is for.
	 */
	["chat-canonical-links--detected-targets", 1024, 720],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="file"]',
			hoverSettleMs: 400,
			dir: "hover-file",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="url"]',
			hoverSettleMs: 400,
			dir: "hover-url",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover:
				'[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
			hoverSettleMs: 400,
			dir: "hover-directory",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-target^="/tmp/lo-link-missing/"]',
			hoverSettleMs: 400,
			dir: "hover-missing",
		},
	],
	["chat-canonical-links--detected-targets-narrow", 420, 900],
	/*
	 * The states round 1's design round had to take with its OWN rig, committed here
	 * through this one so they are swept, re-checkable and ASSERTED rather than
	 * described (design D3). Each pairs its frame with the claim that produced it,
	 * because each is a claim a still cannot carry on its own:
	 *
	 *  - `hover-prose` is the pointer on the turn's PROSE, in a paragraph that also
	 *    holds links: nothing is raised at all (the turn's Quote control is raised by
	 *    a highlight and nothing else), and a selector on the paragraph could not
	 *    express that, so the pointer is aimed at a text RUN.
	 *  - `hover-same-turn-second-link` is design D1 itself: two links in ONE turn,
	 *    the second hovered while the strip is already up. `expectAnchored` requires
	 *    the strip to sit 8px from the SECOND link's own box and to name it, which is
	 *    the assertion that fails on the pre-remediation tree (the rect stayed on the
	 *    first link's line while the contents followed the second).
	 *  - `hover-toolbar-button` and `copy-pressed` are the strip's own states: its
	 *    button under the pointer (one colour step, no transform) and its `Copy`
	 *    after a real press (`Copied`). Both need a pointer that ARRIVES at a control
	 *    which does not exist until a link has been hovered, which is what the chain
	 *    is for.
	 *  - `escape-dismisses` is UX U2 in a real browser: a hover-raised strip, focus
	 *    wherever the reader left it, one real Escape - and the strip must be GONE.
	 *  - `selection-link-and-prose` and `selection-two-links` are the two spanning
	 *    highlights, and their gesture is STATEMENT rather than a drag: both have an
	 *    endpoint inside a link, and a headless Chromium drag whose endpoint is inside
	 *    an anchor produces no highlight at all (measured in round 1, UX U4 - and
	 *    still true on this branch with `draggable={false}`). Their stories build a
	 *    real `Selection` through the DOM's own API, which is the same instrument the
	 *    committed `selection-in-link` frames use, and the claim here is about the
	 *    RESULT: the turn's control is the only one raised, and no link toolbar
	 *    mounts. The drag-versus-script limit is stated in the set's README.
	 *  - `hover-narrow` lands the strip for a WRAPPED link in the narrow column.
	 */
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hoverText: "is gone, and",
			hoverSettleMs: 500,
			dir: "hover-prose",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hoverChain: [
				'[data-record-id="a1"] a[data-lo-target^="/tmp/lo-link-missing/"]',
				'[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
			],
			hoverChainSettleMs: 500,
			dir: "hover-same-turn-second-link",
			expectAnchored: {
				on: '[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
			},
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hoverChain: [
				'[data-record-id="a1"] a[data-lo-kind="file"]',
				'[data-lo-link-toolbar] button[aria-label="Open"]',
			],
			hoverChainSettleMs: 900,
			dir: "hover-toolbar-button",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hoverChain: [
				'[data-record-id="a1"] a[data-lo-kind="file"]',
				'[data-lo-link-toolbar] button[aria-label="Copy path"]',
			],
			hoverChainSettleMs: 500,
			press: '[data-lo-link-toolbar] button[aria-label="Copy path"]',
			pressSettleMs: 400,
			dir: "copy-pressed",
			expectAttribute: {
				selector: '[data-lo-link-toolbar] button[aria-label="Copied"]',
				name: "aria-label",
				equals: "Copied",
			},
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="file"]',
			hoverSettleMs: 500,
			keys: [{ key: "Escape", settleMs: 300 }],
			dir: "escape-dismisses",
			expectGone: "[data-lo-link-toolbar]",
		},
	],
	[
		"chat-canonical-links--selection-spanning",
		1024,
		720,
		{
			dir: "selection-link-and-prose",
			expectPresent: "[data-lo-quote-toolkit]",
			expectGone: "[data-lo-link-toolbar]",
		},
	],
	[
		"chat-canonical-links--selection-across-links",
		1024,
		720,
		{
			dir: "selection-two-links",
			expectPresent: "[data-lo-quote-toolkit]",
			expectGone: "[data-lo-link-toolbar]",
		},
	],
	[
		"chat-canonical-links--detected-targets-narrow",
		420,
		900,
		{
			hover: '[data-record-id="a1"] a[data-lo-target$="with-annotations.xlsx"]',
			hoverSettleMs: 500,
			dir: "hover-narrow",
		},
	],
	/*
	 * THE PATH A MOUSE ACTUALLY MAKES (round 2, design D1 - the BLOCKER).
	 *
	 * Every entry above moves the pointer by TELEPORT: one `mouseMoved` at an
	 * element's centre. A deliberate move delivers a stream of positions, and the
	 * intermediate ones cross the 8px clearance between the link's own box and the
	 * toolbar's - which belongs to the row's WRAPPER, so the old `pointerover`
	 * handler cleared the subject there and the strip unmounted before the pointer
	 * could reach a button. The committed `hover-toolbar-button` and `copy-pressed`
	 * frames were therefore showing a state under a gesture the reader could not
	 * make. These four entries are that gesture, and each one is an ASSERTION rather
	 * than a scene: `hoverPath`'s `expectKept` fails on a tree where the corridor is
	 * missing.
	 *
	 *  - `hover-gap-crossing`: the pointer crosses from the anchor ONTO its first
	 *    button in two samples 16ms apart and BACK onto the anchor - both steps a
	 *    mouse makes, and the one that was lost at step 1 on the pre-remediation
	 *    tree (design D1's own measurement).
	 *  - `hover-gap-long`: the same arrival in four samples, which is the spacing a
	 *    slower hand produces and the case that was lost at step 2.
	 *  - `hover-gap-fine`: a sample every PIXEL at 8ms, from a link placed BELOW its
	 *    toolbar (the mid-paragraph directory link), so both placements are covered:
	 *    this is the path that was lost on the first pixel off the anchor's own box.
	 *  - `hover-gap-leave`: the same arrival, and then the pointer moving on out to
	 *    the prose beside the link - where the strip must go. That is the other half
	 *    of the claim, and without it "keep the subject" could be satisfied by never
	 *    dismissing at all.
	 */
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="file"]',
			hoverSettleMs: 400,
			hoverPath: {
				from: '[data-record-id="a1"] a[data-lo-kind="file"]',
				stepSettleMs: 16,
				legs: [
					{
						to: '[data-lo-link-toolbar] button[aria-label="Copy path"]',
						samples: 2,
						expectKept: {
							on: '[data-record-id="a1"] a[data-lo-kind="file"]',
						},
					},
					{
						to: '[data-record-id="a1"] a[data-lo-kind="file"]',
						samples: 2,
						expectKept: {
							on: '[data-record-id="a1"] a[data-lo-kind="file"]',
						},
					},
				],
			},
			hoverChainSettleMs: 500,
			dir: "hover-gap-crossing",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="file"]',
			hoverSettleMs: 400,
			hoverPath: {
				from: '[data-record-id="a1"] a[data-lo-kind="file"]',
				stepSettleMs: 16,
				legs: [
					{
						to: '[data-lo-link-toolbar] button[aria-label="Open"]',
						samples: 4,
						expectKept: {
							on: '[data-record-id="a1"] a[data-lo-kind="file"]',
						},
					},
				],
			},
			hoverChainSettleMs: 500,
			dir: "hover-gap-long",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover:
				'[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
			hoverSettleMs: 400,
			hoverPath: {
				from: '[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
				stepSettleMs: 8,
				legs: [
					{
						to: '[data-lo-link-toolbar] button[aria-label="Open"]',
						stepPx: 1,
						expectKept: {
							on: '[data-record-id="a1"] a[data-lo-target$="opoint-renewal-2026-09-17"]',
						},
					},
				],
			},
			hoverChainSettleMs: 500,
			dir: "hover-gap-fine",
		},
	],
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-kind="file"]',
			hoverSettleMs: 400,
			hoverPath: {
				from: '[data-record-id="a1"] a[data-lo-kind="file"]',
				stepSettleMs: 16,
				legs: [
					{
						to: '[data-lo-link-toolbar] button[aria-label="Copy path"]',
						samples: 3,
						expectKept: {
							on: '[data-record-id="a1"] a[data-lo-kind="file"]',
						},
					},
					{
						text: "is gone, and",
						samples: 3,
						expectKept: false,
					},
				],
			},
			hoverChainSettleMs: 500,
			dir: "hover-gap-leave",
		},
	],
	/*
	 * A TABLE-CELL anchor (round 2, design D4): the same-line and wrapped cases are
	 * above, and neither shows what the placement does inside a bounded container.
	 * Measured at this head: the cell link's box is `[255,544,612,561]`, the table
	 * ends at 573, and the strip (`[255,569,353,601]`) therefore hangs 28px out of
	 * the table over the paragraph below. § 5 records that cost beside the rule;
	 * this frame is the picture it is recorded from.
	 */
	[
		"chat-canonical-links--detected-targets",
		1024,
		720,
		{
			hover: '[data-record-id="a1"] a[data-lo-target$="summary.pdf"]',
			hoverSettleMs: 500,
			dir: "hover-cell",
		},
	],
	/*
	 * THE SCRIPTED-HIGHLIGHT STATES, and the gesture behind each one is stated rather
	 * than implied - because it is NOT a gesture a reader can make (round 2, UX U4).
	 *
	 * Round 1 believed `draggable={false}` had made "a highlight wholly inside a
	 * link" reachable with a mouse. It did not: measured in a windowed build with
	 * focus emulated, and re-measured on the story surface at this head, a drag, a
	 * double-click, a triple-click and a click+Shift+click that begin and end inside
	 * one anchor all leave `getSelection()` empty and fire no `selectstart` - while
	 * the same instrument selects in the prose beside it, and selects THROUGH the
	 * link from the prose. What `draggable={false}` removes is the browser's own
	 * LINK DRAG; it does not make the link's own text selectable, and no page-side
	 * code can.
	 *
	 * So these frames are built by the story through the DOM's `Selection` API
	 * (`highlightLink`), which is a legitimate instrument for photographing a state
	 * the COMPONENT must handle - the toolbar's `Quote`-leading layout, and what a
	 * press on it stages - but not evidence that a reader can produce that state.
	 * The set's README says so in the same words, and the design doc's § 5 states
	 * the consequence: `Quote` is offered on the HOVER state too, so the affordance
	 * does not depend on a selection the browser will not make.
	 */
	["chat-canonical-links--selection-in-link", 1024, 720],
	/* The press that follows, with the composer in frame: what the toolbar stages is
	   the link's own text, on the same `conversationId` the chip reads. Also a
	   scripted `Selection`, and also not reachable with a pointer. */
	["chat-canonical-links--selection-in-link-staged", 1024, 820],
	["chat-slash-highlight--command-alone", 900, 240],
	["chat-slash-highlight--start-name-instruction", 900, 240],
	["chat-slash-highlight--seeded-name-instruction", 900, 330],
	["chat-slash-highlight--name-instruction-multiline", 900, 330],
	["chat-slash-highlight--unknown-word", 900, 240],
	["chat-slash-highlight--unknown-word-picking", 900, 390],
	["chat-slash-highlight--prose-leading-command-word", 900, 240],
	["chat-slash-highlight--mid-sentence-token", 900, 240],
	["chat-slash-highlight--disabled-and-placeholder", 900, 460],
	["chat-slash-highlight--clipped-boundary", 900, 240],
	["chat-slash-highlight--geometry", 1000, 2600],
	["chat-slash-highlight--scrolled-parity", 1000, 1000],
];

/**
 * Clear the sweep's own output WITHOUT taking the supplementary sets with it,
 * and hand back their declarations for the manifest this run will write.
 *
 * Why this is not a plain `rmSync(OUT)`: not every frame in the tree comes
 * from this script. A surface whose claim is a click that changes STORE state,
 * or a flow against a live backend, cannot be photographed from Storybook, and
 * several of them - the sidebar's own live frames (`new-chat-row/`,
 * `sidebar-new-chat/`, `session-status-live/`) among them - are captures of the
 * RUNNING app rather than of a story, so a blanket wipe destroys frames this
 * script cannot re-derive. (A pointer HOVER used to belong on that list and no
 * longer does: the tuple's `hover` option
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
		/*
		 * Unsolicited events are KEPT rather than dropped, and this is load
		 * bearing: the play guard reads `Runtime.consoleAPICalled` (see the
		 * pre-shutter check), and an event dropped here is a story whose play
		 * threw, photographed anyway - which is the defect the guard exists to
		 * remove. Bounded, because a sweep runs for forty minutes.
		 */
		this.events = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method) {
				this.events.push(msg);
				if (this.events.length > 400) this.events.splice(0, 200);
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

/*
 * The largest pid `process.kill` accepts. No real `process.pid` exceeds it, so
 * a suffix above it is not a profile this script could have created.
 */
const MAX_PID = 2_147_483_647;

/*
 * The whole shape of the name this script gives its Chrome profile in the shared
 * temp directory. Hoisted out of `profileOwnerPid` for the same reason
 * `DEBUG_PORT_LINE` is hoisted out of its handler, and so the rule the sweep
 * matches on has one place to be read from.
 */
const PROFILE_DIR_NAME = /^lo-evidence-(\d+)$/;

/**
 * The pid a Chrome profile directory name belongs to, or `null` if `name` is
 * not one of our profiles.
 *
 * A profile is only ever named by this script's own creation site -
 * `join(tmpdir(), `lo-evidence-${process.pid}`)`, in `main` below - so the
 * whole of the shape is that literal, a decimal pid and nothing else. Every
 * other name in the shared temp directory belongs to somebody else, and the
 * point of returning `null` rather than a pid is that "not ours" then has to
 * be stated by the name itself: there is no way to sweep a directory by
 * forgetting a check.
 *
 * The range check is NOT redundant with the `\d+` above, and this is the half of
 * the rule that is easiest to drop as belt-and-braces. A suffix long enough to
 * overflow a double is still all digits, so `\d+` alone admits it, and
 * `process.kill` answers a pid that is not an integer in range with a throw
 * instead of a signal - measured on node 26.5.0:
 *
 *     process.kill(NaN, 0)           -> TypeError ERR_INVALID_ARG_TYPE
 *     process.kill(1e20, 0)          -> TypeError ERR_INVALID_ARG_TYPE
 *     process.kill(2147483648, 0)    -> TypeError ERR_INVALID_ARG_TYPE
 *     process.kill(2_147_483_647, 0) -> Error ESRCH
 *     process.kill(0, 0)             -> no throw, and it tests no process
 *
 * Every one of the first three was reaching the bare `catch` in the sweep below
 * and being read as "no such process", which is the deletion this rule exists to
 * stop. `MAX_PID` is exactly where node stops accepting a pid, so
 * `lo-evidence-2147483648` - all digits, and above any pid a kernel hands out -
 * is refused before the `kill` rather than answering a `TypeError` that reads as
 * a death certificate.
 *
 * `pid > 0` is load-bearing for the same reason, and its job is smaller than it
 * looks: `kill(0, 0)` does not throw, because to POSIX pid 0 means "the whole
 * process group" rather than "no such process", so a `lo-evidence-0` directory
 * would otherwise be read as a profile that is still in use. It is kept either
 * way - the sweep would `continue` on it - and what the guard buys is the honest
 * answer ("not ours") instead of a false one ("in use"), which is the whole
 * claim this predicate makes.
 */
export const profileOwnerPid = (name) => {
	const match = PROFILE_DIR_NAME.exec(name);
	if (match === null) return null;
	const pid = Number(match[1]);
	return Number.isInteger(pid) && pid > 0 && pid <= MAX_PID ? pid : null;
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
 *
 * The candidate test is `profileOwnerPid`, and that is a correction rather
 * than a flourish: this loop used to take any name starting with
 * `lo-evidence-`. That prefix is not specific enough to be a profile.
 * `evidence-manifest.test.mjs` builds its synthetic evidence tree in the same
 * shared temp directory as `mkdtempSync(join(tmpdir(), "lo-evidence-manifest-"))`
 * - named deliberately, so that a leaked one is identifiable - and it starts
 * with exactly that prefix.
 * `Number("manifest-XXXXXX")` is `NaN`, `process.kill(NaN, 0)` throws a
 * `TypeError`, and the bare `catch` below read a throw that was never about a
 * process as "no such process, so the profile is abandoned" and deleted a LIVE
 * tree out from under a test that was walking it. It presented as flakiness
 * rather than as a deletion - that file's six `countsMean` cells share one
 * module-scope scratch root, and the five of them that walk it fail together
 * with an `ENOENT` on it while the sixth returns early without touching the
 * tree (review round 1, F1) - which is the worst shape a bug in here can take
 * on a machine running several lanes at once.
 *
 * What this does NOT close, in the same breath (review round 1): the `catch`
 * below still reads ANY throw from `kill` as "abandoned", so this narrows the
 * class of names that can reach it rather than making the throw unambiguous.
 * For a name that is now well-formed, only two throws are left: `ESRCH`, which
 * is the intended "gone, reap it", and `EPERM`, the decoded pid being alive and
 * owned by somebody else - and `EPERM` still converges on the deletion. That
 * second one is out of reach here for a structural reason rather than a lucky
 * one: `os.tmpdir()` is per-user, this loop walks only its own temp directory,
 * and a name in it was written by a process of this user, so the profile being
 * deleted cannot be a live one this user does not own. On a host with a SHARED
 * `/tmp` and a second user running this script it could be, and
 * `lo-evidence-1` is the measured demonstration that `EPERM` is an answer this
 * code path currently reads as a death certificate.
 *
 * The follow-up that would close it - reap only on `e.code === "ESRCH"`, and
 * warn or rethrow on anything else - is deliberately not bundled here: it
 * changes what a capture does with a live-but-unreadable profile, which is a
 * different decision from this fix and would want its own review rather than a
 * ride on this one.
 *
 * Exported for the same reason `clearSweptFrames` is: the name-to-pid rule and
 * the reap have to be exercisable against a synthetic temp root, without a
 * capture and without Chrome.
 */
export const sweepStaleProfiles = () => {
	const mine = `lo-evidence-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		/*
		 * Only a name that decodes to the pid this script names its own profile
		 * after is a candidate for reaping. A name that does not decode is not a
		 * profile, so it is not this sweep's to delete.
		 */
		const pid = name === mine ? null : profileOwnerPid(name);
		if (pid === null) continue;
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
			const m = buf.match(DEBUG_PORT_LINE);
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
	 * `Runtime.enable` is here for the EVENTS rather than for `Runtime.evaluate`,
	 * which works without it: the play guard below reads the console, and the
	 * console is only delivered once this domain is on.
	 */
	await cdp.send("Runtime.enable");

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
	/*
	 * The directory an entry writes, read the same way the manifest's own
	 * `refreshedStories` list reads it: the entry's `dir`, or the story's leaf.
	 */
	const dirOf = ([id, , , entryOptions]) => {
		const cut = id.indexOf("--");
		return entryOptions?.dir ?? (cut === -1 ? id : id.slice(cut + 2));
	};
	const stories = STORIES.filter(
		(entry) =>
			(!ONLY || entry[0].includes(ONLY)) &&
			(!DIR_FILTER || DIR_FILTER.includes(dirOf(entry))),
	);
	if (stories.length === 0) {
		throw new Error(
			`--only=${ONLY ?? ""} --dirs=${DIR_FILTER?.join(",") ?? ""} matched no story`,
		);
	}
	const wanted = DIR_FILTER ? new Set(DIR_FILTER) : null;
	if (wanted) {
		const matched = new Set(stories.map(dirOf));
		const missing = [...wanted].filter((dir) => !matched.has(dir));
		if (missing.length > 0) {
			throw new Error(`--dirs matched no entry for: ${missing.join(", ")}`);
		}
	}
	/*
	 * A narrowed run may reach past the sweep's list (see the flag block at the
	 * top of this file) — and then the ids have to be real ones, because the id
	 * becomes both the `args=theme:` the preview reads and the frame's file
	 * name. A full sweep still intersects with the list, so an id the sweep does
	 * not carry cannot widen it.
	 */
	const unknownPalettes = (THEME_FILTER ?? []).filter(
		(id) => !PALETTE_IDS.has(id),
	);
	if (ONLY && unknownPalettes.length > 0) {
		throw new Error(
			`unknown theme id(s): ${unknownPalettes.join(", ")}. The ids are the \`id\` fields in src/renderer/src/shared/themes/palettes/.`,
		);
	}
	const themes = THEME_FILTER
		? ONLY
			? THEME_FILTER.filter((id) => PALETTE_IDS.has(id))
			: THEMES.filter((t) => THEME_FILTER.includes(t))
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
	/*
	 * THE DRAFT STORE IS CLEARED FOR EVERY FRAME, and this is a correctness rule
	 * rather than tidiness. `conversation-input-store` is zustand's `persist`, so
	 * it outlives the document — and the credential stories TYPE into a composer
	 * keyed `story`, one of them (the Esc restore) leaving a live canary in the
	 * persisted draft on purpose. The NEXT story that mounts a composer for the
	 * same conversation therefore restored that canary and was photographed
	 * holding it: six states, seventy-two frames, beginning with
	 * `interrupt-left-work-running`, all of them pictures of a composer the story
	 * never asked for (design round 2, D1). The mechanism is §6's own decision to
	 * persist the Esc-restored characters, so the fix is not a code change: each
	 * frame now starts from the draft state its own story declares, the same way
	 * each frame already starts from its own theme.
	 *
	 * Nothing is lost by it: a story that needs a draft seeds one itself, in its
	 * own play function (the composer-band and quote stories do exactly that,
	 * after this script has run), which is the only honest way to photograph a
	 * restored draft anyway.
	 */
	const DRAFT_KEY = "conversation-input-store";
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
					source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); localStorage.removeItem(${JSON.stringify(DRAFT_KEY)}); } catch {}`,
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

			/*
			 * The console buffer is per STORY, cleared here rather than read with a
			 * timestamp filter, because everything before this line belongs to the
			 * previous document. See the pre-shutter play guard for what it is for.
			 */
			cdp.events.length = 0;

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
				/*
				 * `*:not(textarea)` on the caret, and the exception is the whole point of
				 * the composer's frames: the field there keeps its OWN caret so the
				 * capture can read it, which is how the highlight's caret guard is
				 * measured at all (the mirror paints over a transparent textarea, so
				 * "the caret is still the app's" is a claim about a colour that a
				 * blanket `caret-color: transparent` would have answered for us).
				 * A field that cannot be typed into is not what these frames are of.
				 */
				await cdp.send("Runtime.evaluate", {
					expression: `(() => {
						const s = document.createElement("style");
						s.textContent = "*,*::before,*::after{animation:none !important;transition:none !important}*:not(textarea){caret-color:transparent !important}";
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
			/*
			 * A REAL POINTER PRESS, for the frames whose claim is the state a MOUSE
			 * user gets — and it runs BEFORE the readiness probe, unlike the other
			 * interactions.
			 *
			 * Why the order matters: the probe is what enforces a story's
			 * `data-capture-pending` latch, so a press that produces the state the
			 * latch waits for has to happen first or the two deadlock — a story that
			 * holds the shutter until the EXPANDED picture decodes can never clear it
			 * while nothing has pressed the picture. Hover, selection and key presses
			 * stay after the probe because they change how an already-ready state
			 * looks; a press here is part of ARRIVING at the state, which is why the
			 * element lookup below waits for the selector instead of demanding it.
			 *
			 * `press: <selector>` moves the pointer to the element's centre and sends
			 * `mousePressed` + `mouseReleased` there, so the click arrives through the
			 * input pipeline rather than through a script call. That distinction is the
			 * whole reason this exists (design round 2, D2-4): a programmatic
			 * `element.click()` is treated as keyboard-ish by Blink for
			 * `:focus-visible`, so an overlay opened that way photographs the close
			 * button wearing a focus ring a mouse user never sees. Every overlay frame
			 * in the image-expand set used to carry one; the five press-reachable
			 * tuples press instead. A selector that matches nothing THROWS, for the
			 * same reason `hover`'s does: a rig that cannot find its target must fail
			 * rather than photograph the resting state under a name that claims
			 * otherwise.
			 *
			 * `pressSettleMs` is for a target whose open state is animated; the
			 * stories' own `data-capture-pending` latch is what holds the shutter until
			 * the overlay's picture has decoded, which is a different job.
			 */
			/**
			 * One pointer move, through the same input pipeline the hover above uses.
			 *
			 * Hoisted because two options below need it more than once - the chain and
			 * the press - so a second copy of the dispatch (with its own opinion about
			 * `modifiers`/`buttons`) cannot drift from this one.
			 */
			/**
			 * Evaluate until the expression answers something, or fail after a bounded wait.
			 *
			 * WHY A WAIT AND NOT A THROW. `press` has always retried (`for (let i = 0; i
			 * < 100 && !target.value; i++)`); the moves did not, so a story that had not
			 * finished painting - which is the normal shape on a loaded machine - ended
			 * the whole sweep with "the selector matched nothing". Measured 2026-09-17 at
			 * load ~200: `hover-same-turn-second-link` failed on a selector that four
			 * earlier entries in the SAME run had already matched, i.e. the story was
			 * simply not painted yet. A frame that cannot be taken is worth ten seconds
			 * before it is worth a failed sweep, and the message still names the
			 * selector when the wait runs out.
			 */
			const evaluateUntil = async (expression, what) => {
				for (let attempt = 0; attempt < 50; attempt++) {
					const { result } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression,
					});
					if (result.value) return result.value;
					await sleep(200);
				}
				throw new Error(
					`${story} @ ${theme}: ${what} matched nothing after 10s`,
				);
			};

			const movePointerTo = async (selector, what) => {
				const target = {
					value: await evaluateUntil(
						`(() => {
						const el = document.querySelector(${JSON.stringify(selector)});
						if (!el) return null;
						const r = el.getBoundingClientRect();
						return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
					})()`,
						`the ${what} selector \`${selector}\``,
					),
				};
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
				return target.value;
			};

			/*
			 * A POINTER ON A TEXT RUN, for the frame whose claim is the turn's own
			 * PROSE rather than a link inside it.
			 *
			 * No selector can name a text node, and the paragraph holding the run holds
			 * links too - so hovering the paragraph's own centre would photograph a
			 * link's toolbar under a name that says prose. `hoverText` finds the FIRST
			 * text node containing the substring that is not inside an anchor or a
			 * button, builds a `Range` over it and hovers the middle of its first line
			 * box, which is what a reader's pointer does. A substring that matches
			 * nothing outside a link THROWS rather than photographing the resting state
			 * under a hovered name.
			 */
			if (options?.hoverText) {
				const target = {
					value: await evaluateUntil(
						`(() => {
						const wanted = ${JSON.stringify(options.hoverText)};
						const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
						for (let node = walker.nextNode(); node; node = walker.nextNode()) {
							const at = node.data.indexOf(wanted);
							if (at === -1) continue;
							if (node.parentElement?.closest("a,button")) continue;
							const range = document.createRange();
							range.setStart(node, at);
							range.setEnd(node, at + wanted.length);
							const rect = range.getClientRects()[0];
							if (!rect) continue;
							return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
						}
						return null;
					})()`,
						`no text run matching ${JSON.stringify(options.hoverText)} outside a link or a button`,
					),
				};
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
				if (options?.hoverSettleMs) await sleep(options.hoverSettleMs);
			}

			/*
			 * A CHAIN OF POINTER MOVES, for the states whose claim is what happens when
			 * the subject CHANGES under an already-mounted control.
			 *
			 * The strip is rendered at a stable position inside its row, so pointing at
			 * a second link in the SAME turn re-renders it rather than re-mounting it,
			 * and nothing fires the measure on its own. Round 1 measured the result
			 * (design D1): contents and accessible name followed the second link while
			 * the RECT stayed where the first link's had been, so the strip floated over
			 * a target it was not about. A single `hover` cannot reach that state - it
			 * moves the pointer once, from wherever it was - which is why this is its own
			 * option.
			 *
			 * The steps are real `mouseMoved` dispatches, so the browser sees a pointer
			 * ARRIVING at each element and the `pointerout`/`pointerover` pair a reader
			 * would produce. `hoverChainSettleMs` is the dwell between steps: the reveal
			 * has a deliberate delay of its own, so a chain that skipped the wait would
			 * photograph the state before the strip moved and file it under the state
			 * after.
			 */
			if (options?.hoverChain) {
				for (const [index, selector] of options.hoverChain.entries()) {
					await movePointerTo(selector, `hoverChain[${index}]`);
					await sleep(options.hoverChainSettleMs ?? 400);
				}
			}

			/*
			 * A POINTER PATH WITH INTERMEDIATE SAMPLES, which is the ONE gesture the
			 * options above cannot make.
			 *
			 * `movePointerTo` dispatches a single `mouseMoved` at an element's centre, so
			 * every entry above moves the pointer by TELEPORT: one boundary crossing,
			 * no sample in between. A reader's mouse does not - a deliberate move
			 * delivers a stream of positions, and it is exactly those positions that
			 * round 2 (design D1, the BLOCKER) found the strip cannot survive: the
			 * toolbar sits 8px clear of the anchor's box, that clearance belongs to the
			 * row's WRAPPER rather than to the turn, and a pointerover on the wrapper
			 * cleared the subject - so `Copy`/`Open`/`Open folder` were reachable only
			 * by a gesture no mouse makes, and the `hover-toolbar-button`/
			 * `copy-pressed` frames showed a state a reader could not produce.
			 *
			 * `legs` is a list of moves, each starting from where the last one ended:
			 * `to` is a selector, or `text` for a run of prose outside any link (the
			 * same search `hoverText` does), and the samples between here and there are
			 * spaced by the GREATER of `samples` equal steps and `stepPx`, so a path can
			 * be stated the way a reader's move is ("1px at a time") or the way a test
			 * is ("four steps"). `expectKept` turns the leg into a CLAIM rather than a
			 * scene: the raised strip must still be up afterwards, and must name the
			 * target of `expectKept.on` when that is given - which is false on the
			 * pre-remediation tree for every path whose samples cross the gap, so the
			 * entry is a regression test and not a photograph.
			 */
			if (options?.hoverPath) {
				const { legs, stepSettleMs = 16 } = options.hoverPath;
				const pointFor = async (leg, index) => {
					if (leg.text) {
						return evaluateUntil(
							`(() => {
								const wanted = ${JSON.stringify(leg.text)};
								const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
								for (let node = walker.nextNode(); node; node = walker.nextNode()) {
									const at = node.data.indexOf(wanted);
									if (at === -1) continue;
									if (node.parentElement?.closest("a,button")) continue;
									const range = document.createRange();
									range.setStart(node, at);
									range.setEnd(node, at + wanted.length);
									const rect = range.getClientRects()[0];
									if (!rect) continue;
									return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
								}
								return null;
							})()`,
							`hoverPath leg ${index} matches no prose run`,
						);
					}
					return evaluateUntil(
						`(() => {
							const el = document.querySelector(${JSON.stringify(leg.to)});
							if (!el) return null;
							const r = el.getBoundingClientRect();
							return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
						})()`,
						`hoverPath leg ${index} selector \`${leg.to}\``,
					);
				};
				const move = async (x, y) => {
					await cdp.send("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						x: Math.round(x),
						y: Math.round(y),
						button: "none",
						buttons: 0,
						clickCount: 0,
						modifiers: 0,
						pointerType: "mouse",
					});
					await sleep(stepSettleMs);
				};
				const from = await movePointerTo(
					options.hoverPath.from,
					"hoverPath.from",
				);
				let at = from;
				for (const [index, leg] of legs.entries()) {
					const to = await pointFor(leg, index);
					const distance = Math.hypot(to.x - at.x, to.y - at.y);
					const count = Math.max(
						leg.samples ?? 1,
						leg.stepPx ? Math.ceil(distance / leg.stepPx) : 1,
					);
					for (let step = 1; step <= count; step++) {
						await move(
							at.x + ((to.x - at.x) * step) / count,
							at.y + ((to.y - at.y) * step) / count,
						);
					}
					at = to;
					if (leg.expectKept === undefined) continue;
					const { result: seen } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const strip = document.querySelector("[data-lo-link-toolbar]");
							const on = ${JSON.stringify(leg.expectKept.on ?? null)};
							const anchor = on ? document.querySelector(on) : null;
							return {
								strip: strip ? strip.getAttribute("aria-label") : null,
								target: anchor ? anchor.getAttribute("data-lo-target") : null,
							};
						})()`,
					});
					if (leg.expectKept && !seen.value.strip) {
						throw new Error(
							`${story} @ ${theme}: leg ${index} (${count} samples to ${leg.to ?? leg.text}) lost the strip - a pointer path a mouse can make must reach the buttons (design D1)`,
						);
					}
					if (!leg.expectKept && seen.value.strip) {
						throw new Error(
							`${story} @ ${theme}: leg ${index} left \`${seen.value.strip}\` up after the pointer moved onto ${JSON.stringify(leg.text ?? leg.to)} - leaving the link must dismiss`,
						);
					}
					const named = String(seen.value.target ?? "")
						.split("/")
						.pop();
					if (
						leg.expectKept &&
						named &&
						!String(seen.value.strip).includes(named)
					) {
						throw new Error(
							`${story} @ ${theme}: leg ${index} kept a strip for \`${seen.value.strip}\`, not ${named}`,
						);
					}
				}
			}

			if (options?.press) {
				let target = { value: null };
				for (let i = 0; i < 100 && !target.value; i++) {
					const { result } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const el = document.querySelector(${JSON.stringify(options.press)});
							if (!el) return null;
							const r = el.getBoundingClientRect();
							if (r.width === 0 || r.height === 0) return null;
							return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
						})()`,
					});
					target = result;
					if (!target.value) await sleep(150);
				}
				if (!target.value) {
					throw new Error(
						`${story} @ ${theme}: the press selector \`${options.press}\` never appeared (15s) - a press that finds nothing must fail rather than photograph the resting state under a name that claims otherwise`,
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
				await cdp.send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x: target.value.x,
					y: target.value.y,
					button: "left",
					buttons: 1,
					clickCount: 1,
					modifiers: 0,
					pointerType: "mouse",
				});
				await cdp.send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x: target.value.x,
					y: target.value.y,
					button: "left",
					buttons: 0,
					clickCount: 1,
					modifiers: 0,
					pointerType: "mouse",
				});
				if (options?.pressSettleMs) await sleep(options.pressSettleMs);
			}
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
						/* A story whose play function threw, or a story that failed to
						   render. sb-show-errordisplay is the class Storybook puts on the
						   BODY to show its error display (the element is always present and
						   display none otherwise), so the body's class list is the signal;
						   the element's own height is checked as well because it costs
						   nothing. A phase that threw does NOT set this - see the
						   pre-shutter play guard, which reads the console instead. */
						const errorDisplay = document.querySelector(".sb-errordisplay");
						const errored =
							document.body.classList.contains("sb-show-errordisplay") ||
							Boolean(
								errorDisplay && errorDisplay.getBoundingClientRect().height > 0,
							);
						return {
							drawn: !errored && !loading && !pending && fonts === "loaded" && (${storyDrew})(n),
							counted: n,
							errored,
							errorText: errored
								? (errorDisplay.innerText || "").trim().replace(/\s+/g, " ").slice(0, 300)
								: null,
							loading,
							pending,
							fonts,
						};
					})()`,
				});
				probe = result.value ?? probe;
				if (probe?.errored) {
					throw new Error(
						`${story} @ ${theme}: the story did not RENDER — Storybook is showing its error display: ${probe.errorText}. A frame over a story that failed to render is evidence of a state nobody chose. (A play function that threw is caught separately, at the shutter: it does not show this display.)`,
					);
				}
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
			 * A REAL HIGHLIGHT, for the frames whose claim is a selection-driven
			 * control.
			 *
			 * `select: { from, to?, fromChar?, toChar?, keyboard?, extendArrows?,
			 * dismiss?, scrollAfter? }` highlights the text of `from` (its whole text by
			 * default), or the run from `from` to `to` when the highlight spans two
			 * turns, through the browser's own input pipeline: a real `mouseMoved`, a
			 * real `mousedown`, real `mouseMoved` steps and a real `mouseup`, between the
			 * two points the range's own client rects report. Nothing here writes
			 * `selection.addRange()` - a scripted selection would be evidence about the
			 * script, which is the reason `:hover` cannot be a story state either - and a
			 * `play` function cannot dispatch a gesture at all.
			 *
			 * `keyboard: true` makes the highlight WITHOUT a drag, which is a different
			 * path through the same component: a real click puts a caret at the start of
			 * the run and a real Shift+click extends from it, so the highlight is made by
			 * a keyboard modifier rather than by a pointer sweep. `extendArrows: N` then
			 * presses Shift+ArrowLeft N times on top of whichever gesture ran, and
			 * asserts the highlight grew by exactly N - the arrows extend a highlight
			 * that exists, and cannot extend a bare caret in a non-editable document
			 * (that is caret browsing, a browser mode this app cannot turn on).
			 *
			 * `scrollAfter: "<selector>"` scrolls that element to the top of its own
			 * scroller AFTER the highlight exists, for the states that are a POSITION
			 * rather than a content difference - a highlight on the pane's top edge,
			 * where the placement this rig is photographing has to flip. It runs after
			 * the gesture rather than before it for a measured reason: a drag at the
			 * pane's top edge makes the browser autoscroll the pane under the pointer,
			 * which moves the text under the release point. The scroll is programmatic
			 * and the highlight is not: the claim is where the control goes, not the
			 * wheel that got the reader there.
			 *
			 * `dismiss: "<selector>"` clicks that element after the highlight, through
			 * the same pipeline, for the frames whose claim is that the control GOES
			 * AWAY. `press: true` is the other exit: a real click ON the control the
			 * highlight raised, after which the highlight must be answered and the
			 * control gone - the composer's chip in the same frame is what says a quote
			 * was staged rather than nothing at all.
			 *
			 * Four things THROW, for the hover's reason - a frame filed under a name that
			 * claims a highlight is indistinguishable in a directory listing from one
			 * that claims nothing: a selector that matched nothing, a range with no
			 * client rects, a gesture that produced no highlight (or an arrow walk that
			 * changed the highlight by some other number of characters than it claims),
			 * and a dismiss that left a control the reader could still press. What is
			 * deliberately NOT asserted is that a control IS present: this same entry is
			 * the before half of a before/after pair, and the tree it was captured from
			 * reveals its control on hover.
			 */
			if (options?.select) {
				const select = options.select;
				const spec = {
					from: select.from,
					to: select.to ?? select.from,
					fromChar: select.fromChar ?? null,
					toChar: select.toChar ?? null,
				};
				/*
				 * The two POINTS the gesture runs between, read from the range's own client
				 * rects: the first line's start and the last line's end, inset by a pixel so
				 * each lands on ink rather than on a glyph boundary. Calculated in the page
				 * rather than guessed from a box, because a highlight's ends are text
				 * positions and only the DOM knows where those are.
				 */
				const readGeometry = async () =>
					(
						await cdp.send("Runtime.evaluate", {
							returnByValue: true,
							expression: `(() => {
						const spec = ${JSON.stringify(spec)};
						const pointAt = (selector, offset) => {
							const host = document.querySelector(selector);
							if (!host) return { missing: selector };
							const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
							const nodes = [];
							let at = 0;
							for (let node = walker.nextNode(); node; node = walker.nextNode()) {
								nodes.push({ node: node, start: at, end: at + node.data.length });
								at += node.data.length;
							}
							if (nodes.length === 0) return { empty: selector };
							const wanted = offset === null ? at : offset;
							for (const entry of nodes) {
								if (wanted <= entry.end) {
									return { node: entry.node, offset: Math.max(0, wanted - entry.start) };
								}
							}
							const last = nodes[nodes.length - 1];
							return { node: last.node, offset: last.node.data.length };
						};
						const start = pointAt(spec.from, spec.fromChar);
						const end = pointAt(spec.to, spec.toChar);
						if (start.missing || end.missing) {
							return { missing: start.missing || end.missing };
						}
						if (start.empty || end.empty) {
							return { empty: start.empty || end.empty };
						}
						const range = document.createRange();
						range.setStart(start.node, start.offset);
						range.setEnd(end.node, end.offset);
						const rects = Array.from(range.getClientRects());
						if (rects.length === 0) return { rectless: true };
						const first = rects[0];
						const last = rects[rects.length - 1];
						return {
							start: {
								x: Math.round(first.left + 1),
								y: Math.round(first.top + first.height / 2),
							},
							end: {
								x: Math.round(last.right - 1),
								y: Math.round(last.bottom - last.height / 2),
							},
							text: range.toString(),
						};
					})()`,
						})
					).result.value;
				/*
				 * THE PANE HAS TO STOP MOVING BEFORE THE GESTURE, and how long that takes
				 * is not this rig's to guess: a programmatic scroll is a demand the
				 * transcript's own paging policy answers, and its answer can move content
				 * again after it looks settled. Measured: a row scrolled under the pointer
				 * shifted one slot (45px) after the first read, which put the drag's release
				 * point on the transcript's "Start of conversation" caption one row above
				 * the turn the entry names - a highlight that every other check here passed.
				 * So the point is sampled until two consecutive reads agree, and the
				 * endpoints are asserted after the gesture as well (see `anchored`).
				 */
				let box = await readGeometry();
				for (let attempt = 0; attempt < 10; attempt++) {
					await sleep(200);
					const next = await readGeometry();
					if (
						next?.start &&
						box?.start &&
						next.start.x === box.start.x &&
						next.start.y === box.start.y &&
						next.end.x === box.end.x &&
						next.end.y === box.end.y
					) {
						box = next;
						break;
					}
					box = next;
				}
				if (!box?.start || !box?.end) {
					throw new Error(
						`${story} @ ${theme}: the select range could not be built - ${JSON.stringify(box)}`,
					);
				}
				const mouse = (type, x, y, buttons) =>
					cdp.send("Input.dispatchMouseEvent", {
						type,
						x,
						y,
						button: "left",
						buttons,
						clickCount: 1,
						modifiers: 0,
						pointerType: "mouse",
					});
				if (select.keyboard) {
					/*
					 * THE KEYBOARD'S OWN HIGHLIGHT, which is a caret and a
					 * MODIFIER-CLICK rather than a drag. A real click puts the caret at the
					 * start of the run - the click is what makes the caret exist at all, and
					 * a scripted `setStart` would be this rig selecting rather than the
					 * browser - and a real Shift+click extends from it to the other end.
					 *
					 * WHY NOT Shift+Arrows FROM THE CARET, which is what this branch did
					 * first. Measured on the running surface: Chromium will not extend a
					 * BARE caret with Shift+Arrow in a non-editable document - the click
					 * leaves `ranges: 1` and an empty string, and 26 Shift+ArrowLeft presses
					 * leave it empty (that is caret browsing, F7, a browser mode this app
					 * cannot turn on). What the arrows DO do is extend a highlight that
					 * already exists, which `extendArrows` below drives and asserts.
					 */
					await mouse("mousePressed", box.start.x, box.start.y, 1);
					await mouse("mouseReleased", box.start.x, box.start.y, 0);
					await sleep(60);
					for (const type of ["mousePressed", "mouseReleased"]) {
						await cdp.send("Input.dispatchMouseEvent", {
							type,
							x: box.end.x,
							y: box.end.y,
							button: "left",
							buttons: type === "mousePressed" ? 1 : 0,
							clickCount: 1,
							// Shift, so the press EXTENDS the caret's selection rather than
							// dropping a new one.
							modifiers: 8,
							pointerType: "mouse",
						});
					}
					await sleep(120);
				} else {
					await cdp.send("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						x: box.start.x,
						y: box.start.y,
						button: "none",
						buttons: 0,
						clickCount: 0,
						modifiers: 0,
						pointerType: "mouse",
					});
					await mouse("mousePressed", box.start.x, box.start.y, 1);
					/* Stepped rather than teleported: a selection follows the pointer, and
					   a single move to the end is a drag that never crossed the text. */
					const steps = 8;
					for (let i = 1; i <= steps; i++) {
						await mouse(
							"mouseMoved",
							Math.round(box.start.x + ((box.end.x - box.start.x) * i) / steps),
							Math.round(box.start.y + ((box.end.y - box.start.y) * i) / steps),
							1,
						);
						await sleep(12);
					}
					await mouse("mouseReleased", box.end.x, box.end.y, 0);
					await sleep(60);
				}
				/*
				 * `extendArrows: N` is the ARROWS half of the same keyboard claim, and it
				 * is applied on top of whichever gesture made the highlight: N real
				 * Shift+ArrowLeft presses, and an assertion that the highlight grew by
				 * exactly N. A highlight that did not move and one that moved are the same
				 * picture, so the number is the evidence rather than the frame.
				 */
				const beforeArrows = select.extendArrows
					? await cdp
							.send("Runtime.evaluate", {
								returnByValue: true,
								expression: `(() => {
									const selection = window.getSelection();
									return selection ? selection.toString().length : 0;
								})()`,
							})
							.then((r) => r.result.value)
					: 0;
				for (let i = 0; i < (select.extendArrows ?? 0); i++) {
					for (const type of ["rawKeyDown", "keyUp"]) {
						await cdp.send("Input.dispatchKeyEvent", {
							type,
							key: "ArrowLeft",
							code: "ArrowLeft",
							windowsVirtualKeyCode: 37,
							nativeVirtualKeyCode: 37,
							modifiers: 8,
						});
					}
				}
				if (select.extendArrows) await sleep(120);
				/*
				 * `scrollAfter` IS THE SCROLL, AND IT RUNS AFTER THE HIGHLIGHT - the
				 * order is the whole point. A drag made at the pane's own top edge
				 * makes the BROWSER autoscroll the pane under the pointer: measured on
				 * this surface, 73px of autoscroll during a single drag, which moved
				 * the text under the release point and landed the highlight on the
				 * transcript's "Start of conversation" caption one row above the turn
				 * the entry names. So a highlight that has to end up on the pane's top
				 * edge is made where the pointer is safe and then scrolled there - which
				 * is also what the frame is about: the control follows the highlight it
				 * belongs to, and flips below it when the scroll leaves no room above.
				 */
				if (select.scrollAfter) {
					const { result: scrolled } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const host = document.querySelector(${JSON.stringify(select.scrollAfter)});
							if (!host) return false;
							host.scrollIntoView({ block: "start" });
							return true;
						})()`,
					});
					if (!scrolled.value) {
						throw new Error(
							`${story} @ ${theme}: the scrollAfter selector \`${select.scrollAfter}\` matched nothing`,
						);
					}
					await sleep(400);
				}
				/*
				 * THE GESTURE IS CHECKED BEFORE THE SHUTTER, because a frame filed under a
				 * name that claims a highlight is indistinguishable from one that claims
				 * nothing. Both dispatch paths are asserted against the page's own
				 * `Selection`, which is what the component reads.
				 */
				const { result: held } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const selection = window.getSelection();
						const host = (selector) => document.querySelector(selector);
						return {
							text: selection ? selection.toString() : "",
							ranges: selection ? selection.rangeCount : 0,
							/**
							 * WHERE THE HIGHLIGHT'S OWN ENDPOINTS ARE, which is the
							 * assertion that makes this a picture of the state it names.
							 * A gesture is dispatched at coordinates, and a pane that
							 * moves between the measurement and the press puts those
							 * coordinates on different TEXT - measured: a row scrolled
							 * under the pointer landed the drag on the transcript's
							 * "Start of conversation" caption, one row above the turn the
							 * entry names, and every other check here passed. Non-empty
							 * text is not enough; the endpoints have to be in the
							 * elements the entry asked for.
							 */
							anchored: Boolean(
								selection?.anchorNode &&
									host(${JSON.stringify(select.from)})?.contains(selection.anchorNode),
							),
							ended: Boolean(
								selection?.focusNode &&
									host(${JSON.stringify(select.to ?? select.from)})?.contains(
										selection.focusNode,
									),
							),
						};
					})()`,
				});
				const selected = held.value?.ranges > 0 ? held.value.text : "";
				if (selected.trim().length === 0) {
					throw new Error(
						`${story} @ ${theme}: the ${select.keyboard ? "caret + Shift+click" : "drag"} gesture over \`${select.from}\` produced no highlight`,
					);
				}
				if (!held.value?.anchored || !held.value?.ended) {
					throw new Error(
						`${story} @ ${theme}: the highlight is not the run this entry names - anchored in \`${select.from}\`: ${held.value?.anchored}, ended in \`${select.to ?? select.from}\`: ${held.value?.ended}, text "${selected.slice(0, 40)}"`,
					);
				}
				if (
					select.extendArrows &&
					selected.length !== beforeArrows + select.extendArrows
				) {
					throw new Error(
						`${story} @ ${theme}: ${select.extendArrows} Shift+ArrowLeft presses took the highlight from ${beforeArrows} to ${selected.length} characters, so the frame is not the walk it claims`,
					);
				}
				/*
				 * THE STRING, where the entry names one (design round 1, D4).
				 *
				 * The endpoint assertions above ask whether the highlight's ends lie in
				 * the ELEMENTS the entry names; they cannot ask whether the span between
				 * them is the one the entry is talking about, and the two came apart:
				 * `fromChar`/`toChar` are offsets into the RENDERED text node, while a
				 * reader counting characters would count the markdown source - so the
				 * mid-turn entry named character 20 of "Because that row's `tenant_id`..."
				 * and the band it photographed began one character in, on the 'e' of
				 * `tenant_id`, with the 't' left outside it. Nothing is wrong with the
				 * product; the entry simply did not say that, and a frame is supposed to
				 * be a claim a reader can check. An entry that names the string cannot be
				 * misread that way, and this is the assertion that holds it: the reader's
				 * own range's text, not a copy of it.
				 */
				if (select.expectText !== undefined && selected !== select.expectText) {
					throw new Error(
						`${story} @ ${theme}: the gesture selected ${JSON.stringify(selected)}, but the entry says it selects ${JSON.stringify(select.expectText)} - the frame would carry a span other than the one it names`,
					);
				}
				/*
				 * `dismiss` is the OTHER half of the same claim: a click somewhere else,
				 * through the same input pipeline, and then a check that the control is
				 * gone. The check is about being OPERABLE rather than about the DOM node,
				 * so it holds on both halves of a before/after pair - what must not survive
				 * the click is a control the reader could still press.
				 */
				if (select.dismiss) {
					const { result: target } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const el = document.querySelector(${JSON.stringify(select.dismiss)});
							if (!el) return null;
							const r = el.getBoundingClientRect();
							return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
						})()`,
					});
					if (!target.value) {
						throw new Error(
							`${story} @ ${theme}: the dismiss selector \`${select.dismiss}\` matched nothing`,
						);
					}
					await mouse("mousePressed", target.value.x, target.value.y, 1);
					await mouse("mouseReleased", target.value.x, target.value.y, 0);
					await sleep(120);
					const { result: survivors } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `Array.from(
							document.querySelectorAll("[data-lo-quote-toolkit]"),
					).filter((el) => {
							const style = getComputedStyle(el);
							return (
								style.visibility !== "hidden" &&
								style.opacity !== "0" &&
								style.display !== "none" &&
								el.getClientRects().length > 0
							);
						}).length`,
					});
					if (survivors.value > 0) {
						throw new Error(
							`${story} @ ${theme}: the control is still painted after the dismiss click - the frame would claim a state it is not in`,
						);
					}
				}
				/*
				 * `press: true` is the PRESS, and it is the one frame that shows what the
				 * highlight is FOR: a real click on the control the highlight raised, and
				 * then a check that the highlight has been answered - the composer's chip
				 * is in the frame, and the highlight and the control are gone, which is the
				 * operator's third ask ("when deselecting it also goes away, etc instead of
				 * sticking around") on the path that stages a quote.
				 */
				if (select.press) {
					const { result: target } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const el = document.querySelector("[data-lo-quote-toolkit] button");
							if (!el) return null;
							const r = el.getBoundingClientRect();
							return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
						})()`,
					});
					if (!target.value) {
						throw new Error(
							`${story} @ ${theme}: the press asked for the control and no control was on screen`,
						);
					}
					await mouse("mousePressed", target.value.x, target.value.y, 1);
					await mouse("mouseReleased", target.value.x, target.value.y, 0);
					await sleep(200);
					const { result: answered } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const selection = window.getSelection();
							return {
								text: selection ? selection.toString() : "",
								controls: Array.from(
									document.querySelectorAll("[data-lo-quote-toolkit]"),
								).filter((el) => {
									const style = getComputedStyle(el);
									return (
										style.visibility !== "hidden" &&
										style.opacity !== "0" &&
										style.display !== "none" &&
										el.getClientRects().length > 0
									);
								}).length,
							};
						})()`,
					});
					if ((answered.value?.text ?? "").length > 0) {
						throw new Error(
							`${story} @ ${theme}: the press left the highlight lit - the press must answer the highlight it staged`,
						);
					}
					if (answered.value?.controls > 0) {
						throw new Error(
							`${story} @ ${theme}: the control is still painted after the press`,
						);
					}
				}
				/*
				 * A POINTER ON THE CONTROL ITSELF, for the frames whose claim is its own
				 * hover (design round 1, D3: the control's `accent-wash`/`accent` grounds and
				 * its radius nesting were in no frame in the set, and neither was the
				 * tooltip as a reader sees it).
				 *
				 * IT RUNS AFTER THE GESTURE, which is why it is not the top-level `hover`
				 * option: that one runs before the select block, and this control does not
				 * EXIST until a highlight raises it - a selector that matches nothing there
				 * would throw, correctly, because the state it names is not reachable yet.
				 *
				 * `:hover` is browser state like every other hover in this file, so the
				 * pointer is moved through the input pipeline and left there. The wait is
				 * the tooltip's own delay (Radix opens after ~700ms), and `tooltip: true`
				 * makes the frame's claim checkable rather than merely likely: the frame
				 * that shows a tooltip says so, and a run where it had not opened throws.
				 */
				if (select.hover) {
					const { result: target } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => {
							const el = document.querySelector(${JSON.stringify(select.hover)});
							if (!el) return null;
							const r = el.getBoundingClientRect();
							return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
						})()`,
					});
					if (!target.value) {
						throw new Error(
							`${story} @ ${theme}: the hover selector \`${select.hover}\` matched nothing after the gesture`,
						);
					}
					await mouse("mouseMoved", target.value.x, target.value.y, 0);
					await sleep(select.hoverSettleMs ?? 900);
					const { result: hovered } = await cdp.send("Runtime.evaluate", {
						returnByValue: true,
						expression: `(() => ({
							hover: document.querySelector(${JSON.stringify(select.hover)})?.matches(":hover") === true,
							tooltip: Array.from(document.querySelectorAll('[role="tooltip"]')).filter((el) => {
								const style = getComputedStyle(el);
								return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.5 && el.getClientRects().length > 0;
							}).length,
						}))()`,
					});
					if (!hovered.value?.hover) {
						throw new Error(
							`${story} @ ${theme}: the pointer is on \`${select.hover}\` but the element does not match :hover, so the frame would be a resting control filed under a hover`,
						);
					}
					if (select.tooltip && !(hovered.value?.tooltip > 0)) {
						throw new Error(
							`${story} @ ${theme}: the entry claims the tooltip, and none is painted after ${select.hoverSettleMs ?? 900}ms of hover`,
						);
					}
				}
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
			/*
			 * A KEY PRESS on whatever holds focus, for the frames whose claim is not
			 * only that a control is REACHABLE by keyboard but that reaching it DOES
			 * something. `tabTo` above lands the focus; a focus ring in a still proves
			 * that and nothing about activation, so this presses a key on the focused
			 * element through the input pipeline and requires `reveals` to match
			 * afterwards — a press that opened nothing fails the capture instead of
			 * shipping an unchanged surface under a name that claims an activation.
			 *
			 * Both edges are sent, because a Radix menu trigger opens on the DOWN
			 * edge of Enter and a caller sending only the up edge would be testing a
			 * key the product ignores — the same reason the desktop suite's
			 * `pressEscape` twin sends `keydown`.
			 *
			 * Deliberately not a general key-press API: it exists so one frame in this
			 * repository can carry "reached by keyboard AND opened by keyboard".
			 */
			if (options?.pressKey) {
				const { key, reveals } = options.pressKey;
				const code = key === "Enter" ? 13 : key === " " ? 32 : null;
				if (code === null) {
					throw new Error(
						`${story} @ ${theme}: pressKey only knows Enter and Space, got \`${key}\``,
					);
				}
				for (const type of ["rawKeyDown", "keyUp"]) {
					await cdp.send("Input.dispatchKeyEvent", {
						type,
						key,
						code: key === " " ? "Space" : key,
						windowsVirtualKeyCode: code,
						nativeVirtualKeyCode: code,
					});
				}
				if (reveals) {
					const shown = async () =>
						(
							await cdp.send("Runtime.evaluate", {
								returnByValue: true,
								expression: `document.querySelectorAll(${JSON.stringify(reveals)}).length`,
							})
						).result.value > 0;
					let visible = false;
					for (let i = 0; i < 20 && !visible; i++) {
						await sleep(50);
						visible = await shown();
					}
					if (!visible) {
						throw new Error(
							`${story} @ ${theme}: pressing ${key} did not reveal \`${reveals}\` — the frame would be the resting state under a name that claims an activation`,
						);
					}
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
			 * `scrollTo` is `scrollToEnd`'s counterpart, and it exists because the
			 * at-rest frame of a section that sits BELOW the panel's own content is
			 * not the section: the panel body's scroll position is browser state no
			 * story can set, so a frame that is not parked shows the stat grid and
			 * the chart whatever the story's name says (review round 1, M2/D2/D3,
			 * where two committed directories were captioned with a subject no pixel
			 * contained).
			 *
			 * It parks the named element at the TOP of the nearest scrollable
			 * ancestor, and it FAILS rather than falling back: a scroll that did not
			 * land is the same defect as the side effect this replaces — the frame is
			 * captioned with a state it does not hold — and the only way to notice is
			 * to measure the offset rather than trust the assignment. The tolerance
			 * is a pixel, for sub-pixel layout.
			 *
			 * It is deliberately NOT a `play` doing `scrollIntoView`: the browser's
			 * scroll of a focused element is a side effect of whatever the play
			 * happens to click, so it is neither guaranteed nor stable, and a play
			 * that stopped focusing a control would silently degrade the frame.
			 */
			if (options?.scrollTo) {
				/*
				 * `result` then `result.value`: `Runtime.evaluate` answers with a
				 * RemoteObject, and a reader that destructured the whole envelope
				 * as the value saw `ok` undefined on every entry - which is a
				 * failure that LOOKS like a selector that matched nothing.
				 */
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const el = document.querySelector(${JSON.stringify(options.scrollTo)});
						if (!el) return { ok: false, why: "matched nothing" };
						let scroller = el.parentElement;
						while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
							scroller = scroller.parentElement;
						}
						if (!scroller) return { ok: false, why: "no scrollable ancestor" };
						const delta = () => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
						const before = scroller.scrollTop;
						scroller.scrollTop = before + delta();
						return { ok: true, before, after: scroller.scrollTop, offset: Math.round(delta()) };
					})()`,
				});
				const parked = result?.value;
				if (!parked?.ok) {
					throw new Error(
						`${story} @ ${theme}: the scrollTo selector \`${options.scrollTo}\` ${parked?.why ?? "failed"} — a frame that is not parked shows whatever the body happens to be showing, under a name that claims otherwise`,
					);
				}
				if (Math.abs(parked.offset) > 1) {
					throw new Error(
						`${story} @ ${theme}: after parking \`${options.scrollTo}\` its top is still ${parked.offset}px from the scroller's top (scrollTop ${parked.before} -> ${parked.after}) — it cannot be scrolled that far, so the frame would not be the state its name claims`,
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
						 * declares; the caret is the same argument as above, including
						 * its :not(textarea) scope (no backticks in here: this block is inside a template literal).
						 */
						const s = document.createElement("style");
						s.textContent = "*,*::before,*::after{transition:none !important}*:not(textarea){caret-color:transparent !important}";
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
			/*
			 * A STORY WHOSE PLAY THREW IS NOT EVIDENCE, so the frame is not taken.
			 *
			 * Why this is the console rather than the DOM, which was the obvious
			 * first move and does not work: Storybook shows its error display only
			 * for a story that failed to RENDER (it does that by putting
			 * `sb-show-errordisplay` on the body, and the element is present and
			 * `display: none` otherwise). A phase that threw - an `expect` inside a
			 * `play` - is reported to the manager and to the CONSOLE, and
			 * `window.__STORYBOOK_PREVIEW__.currentRender.phase` reads `finished`
			 * either way, so the console error is the one signal a frame's producer
			 * can see. It is also the signal QA read to find seven of the nine
			 * by-session plays red at the shipping head while this rig photographed
			 * them cleanly (QA round 1, Q-1: `sb-errordisplay` was on this file's
			 * CHROME list, i.e. Storybook furniture to EXCLUDE from the count).
			 *
			 * The three signatures are the three ways a play throws: an assertion
			 * (`@storybook/test`'s `expect` throws `AssertionError`), a pointer
			 * interaction user-event refused, and a query that found nothing. A play
			 * that threw something else - a `TypeError` in its own body - is NOT
			 * caught here, which is the limit of reading the console rather than
			 * hooking Storybook's channel; it is stated rather than implied.
			 */
			const playFailure = cdp.events
				.filter(
					(event) =>
						event.method === "Runtime.consoleAPICalled" &&
						event.params.type === "error",
				)
				.map((event) =>
					event.params.args
						.map((arg) => arg.value ?? arg.description ?? "")
						.join(" "),
				)
				.find((text) =>
					/^(AssertionError|TestingLibraryElementError)|Unable to perform pointer interaction/.test(
						text,
					),
				);
			if (playFailure) {
				throw new Error(
					`${story} @ ${theme}: the story's play function THREW — ${playFailure.split("\n")[0].slice(0, 200)}. The story's own assertions rejected the state this frame would have photographed, so the frame is not taken and the sweep stops here. Run the story in Storybook to see it fail.`,
				);
			}
			/*
			 * KEYS through the input pipeline, for the claims that are a KEYBOARD
			 * interaction rather than a visual state - `keys: [{ key: "Escape" }]`.
			 */
			if (options?.keys) {
				for (const spec of options.keys) {
					const codes = KEY_CODES[spec.key];
					if (!codes) {
						throw new Error(`${story} @ ${theme}: no keyCode for ${spec.key}`);
					}
					for (const type of ["keyDown", "keyUp"]) {
						await cdp.send("Input.dispatchKeyEvent", {
							type,
							key: spec.key,
							code: codes.code,
							windowsVirtualKeyCode: codes.keyCode,
							nativeVirtualKeyCode: codes.keyCode,
							modifiers: spec.shiftKey ? 8 : 0,
						});
					}
					await sleep(spec.settleMs ?? 120);
				}
			}
			/*
			 * WHAT THE GESTURES ABOVE MUST HAVE PRODUCED, asserted rather than
			 * photographed.
			 *
			 * The frame is what a design round LOOKS at; these are what make the entry
			 * FALSIFIABLE in a sweep, which is the difference between evidence and a
			 * picture. All three are the shape round 1's findings needed and no still
			 * could settle on its own:
			 *
			 *   `expectAnchored: { on, gap? }` - the raised link toolbar's box must sit
			 *   `gap` (default 8) px from the box of THAT selector, on whichever side the
			 *   placement chose, and its accessible name must name that element's own
			 *   target. This is design D1's regression: hovering one link and then another
			 *   in the SAME turn must leave the strip anchored to the SECOND.
			 *
			 *   `expectGone` / `expectPresent` - selectors that must match nothing / must
			 *   match something. This is UX U2 (`escape-dismisses`: one real Escape and
			 *   the strip is gone) and the spanning-highlight rule (`selection-*`: the
			 *   TURN's control is the only one raised).
			 *
			 *   `expectAttribute: { selector, name, equals? | includes? }` - the press
			 *   produced the state the frame is named for (`copy-pressed` -> `Copied`).
			 */
			if (options?.expectAnchored) {
				const claim = options.expectAnchored;
				const { result: measured } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const strip = document.querySelector("[data-lo-link-toolbar]");
						const anchor = document.querySelector(${JSON.stringify(claim.on)});
						if (!strip || !anchor) return { strip: Boolean(strip), anchor: Boolean(anchor) };
						const s = strip.getBoundingClientRect();
						const a = anchor.getBoundingClientRect();
						return {
							strip: true,
							anchor: true,
							target: anchor.getAttribute("data-lo-target"),
							label: strip.getAttribute("aria-label"),
							above: Math.round(a.top - s.bottom),
							below: Math.round(s.top - a.bottom),
						};
					})()`,
				});
				const seen = measured.value;
				const gap = claim.gap ?? 8;
				if (!seen?.strip || !seen?.anchor) {
					throw new Error(
						`${story} @ ${theme}: expectAnchored needs a raised strip and \`${claim.on}\` on screen; saw ${JSON.stringify(seen)}`,
					);
				}
				if (seen.above !== gap && seen.below !== gap) {
					throw new Error(
						`${story} @ ${theme}: the strip is ${seen.above}px above / ${seen.below}px below \`${claim.on}\`, not ${gap}px - the placement did not follow its subject (design D1)`,
					);
				}
				const name = String(seen.target ?? "")
					.split("/")
					.pop();
				if (name && !String(seen.label ?? "").includes(name)) {
					throw new Error(
						`${story} @ ${theme}: the strip is anchored to \`${claim.on}\` but names \`${seen.label}\`, not ${name}`,
					);
				}
			}

			if (options?.expectGone || options?.expectPresent) {
				const gone = [options.expectGone].flat().filter(Boolean);
				const present = [options.expectPresent].flat().filter(Boolean);
				const { result: seen } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => ({
						gone: ${JSON.stringify(gone)}.filter((s) => document.querySelector(s) !== null),
						missing: ${JSON.stringify(present)}.filter((s) => document.querySelector(s) === null),
					}))()`,
				});
				if (seen.value?.gone?.length) {
					throw new Error(
						`${story} @ ${theme}: ${seen.value.gone.join(", ")} is still on screen - this frame claims it is not`,
					);
				}
				if (seen.value?.missing?.length) {
					throw new Error(
						`${story} @ ${theme}: ${seen.value.missing.join(", ")} is not on screen - this frame claims it is`,
					);
				}
			}

			if (options?.expectAttribute) {
				const claim = options.expectAttribute;
				const { result: read } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `document.querySelector(${JSON.stringify(claim.selector)})?.getAttribute(${JSON.stringify(claim.name)}) ?? null`,
				});
				const value = String(read.value ?? "");
				const ok =
					claim.equals !== undefined
						? value === claim.equals
						: value.includes(claim.includes ?? "");
				if (!ok) {
					throw new Error(
						`${story} @ ${theme}: \`${claim.selector}\` carries ${claim.name}=${JSON.stringify(value)}, which does not satisfy ${JSON.stringify(claim.equals ?? `includes ${claim.includes}`)} - the press did not produce the state this frame is named for`,
					);
				}
			}

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
	/*
	 * A FOLD'S RESOLVER READS THIS BLOCK. When `main` and this branch have both
	 * rewritten this file, the merge is a PER-FIELD decision and NOT "keep main's
	 * record" - and per FIELD rather than per entry, for the same reason: a union
	 * taken at entry granularity silently replaces an authored field inside an
	 * entry both sides have, which is how this branch's `why` clauses on two
	 * `supplementary` entries vanished on the ninth fold (review round 8, R8-2).
	 *
	 *   1. `head`, `headNote` and the `partialCapture` fields that DESCRIBE a pass
	 *      - `refreshedAt`, `refreshedAtHead`, `refreshedFromHead`, `addedAt`,
	 *      `addedAtHead`, `addedFrames`, `note`, `passScopeNote` and every
	 *      per-pass `*Note` - are THIS branch's. Main's values name main's pass,
	 *      and taking them sends a verifier to a tree that does not carry this
	 *      branch's frames (rounds 4, 5 and 6 each found that, the third time
	 *      inside the round that had just fixed it).
	 *   2. The fields that LIST what both sides touched - `supplementary`'s
	 *      ENTRIES, and `refreshedStories`, `refreshedThemes`, `addedSurfaces` -
	 *      are the UNION of the two sides' entries or values, because the merged
	 *      tree carries both and either side's list alone would claim a pass that
	 *      did not run in it.
	 *   3. INSIDE a `supplementary` entry that exists on both sides, this pass's
	 *      AUTHORED keys - `why`, `capturedAt`, `capturedAtHead` and any note -
	 *      are KEPT and only the listings are unioned. An entry is a record this
	 *      branch wrote, not a listing, and taking main's whole entry loses
	 *      exactly the field a reader follows the rule to find.
	 *   4. `refreshedFrames` is RE-DERIVED against `HEAD` rather than added up,
	 *      and `frames`, `surfaces`, `themes`, `countsMean`, `srcTree` and
	 *      `scriptsTree` are re-derived from the merged tree and taken from
	 *      neither side. `countsMean` is in this group because it restates
	 *      `frames`/`surfaces` - its prose says what each field counts and where
	 *      to read it, and carries no number of its own for a fold to falsify.
	 *      The stamps in group (4) - `srcTree` and `scriptsTree` - are derived
	 *      from the MERGED tree, which means AFTER the merge commit exists.
	 *      Deriving them while the merge is still uncommitted asks
	 *      `git rev-parse HEAD:src` and gets the PRE-merge head's trees: real
	 *      trees, so nothing looks wrong in the diff, just not this one's. Fold 11
	 *      shipped exactly that to `main` and the desktop suite's own stamp test
	 *      caught it. Fold 10 was stale from the OTHER side one commit earlier for
	 *      the same underlying reason: `a5d81f0af`'s manifest declared
	 *      `7072b9d21`/`3e32dcbe4`, which are its second parent `013aad424`'s
	 *      (then-main's) trees, against the merged tree's `aca12e400`/`311c0b6a2`,
	 *      and the correction came only in the follow-up `3fdee3e53`. The class is
	 *      therefore "a merge resolution that does not re-derive at the commit it
	 *      produces", and it reaches a shipping branch when nothing re-derives
	 *      before that merge lands.
	 *      Two things follow for a change that also touches `scripts/`, and only
	 *      one of them is about this file: the `scripts` stamp cannot include the
	 *      edit until the edit is COMMITTED (`HEAD:scripts` does not see a working
	 *      -tree change), so a value written before that commit describes a tree
	 *      that is not the one it rides in; and the `--amend` after writing the
	 *      values in keeps the value and the tree it names inside ONE commit -
	 *      the amendment moves `docs/` only, so the value stays true.
	 *   5. And NO FIELD THAT SPELLS OUT WHAT A CITATION NAMES is carried from
	 *      main's side under any name: main's manifest still has
	 *      `refreshedAtHeadNote`, the spelling this branch deleted, and carrying
	 *      main's keys this branch lacks re-introduces it.
	 *
	 * The gate cannot catch a `head` that names the wrong tree, and BOTH halves of
	 * what it does ask are worth naming so this is auditable rather than a summary:
	 * `citationFailures` asks whether the sha RESOLVES, and
	 * `citationAncestryFailures` asks whether it is an ANCESTOR OF `HEAD` - named by
	 * symbol rather than by line, since a line number is one more thing a later pass
	 * has to keep true. Main's own commit satisfies both, which is exactly why
	 * the gate could not see the round-6 defect; neither half asks whether the tree
	 * a citation names carries the frames this record declares. The same rule is
	 * stated for readers in the manifest's `citationConvention`.
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
								...new Set([
									...priorStories,
									/*
									 * THE DIRECTORY, not the story id, and the difference is not
									 * cosmetic. A story captured in a SECOND state names its own `dir`
									 * (see the STORIES header), so one story can write several
									 * directories - and `check-evidence.mjs` reads this list as
									 * DIRECTORIES (`<surface>--<leaf>`), asking of each frame a pass
									 * rewrote whether some entry names the directory it sits in. One
									 * bare story id can only name one of them, which is measured:
									 * the quote set's six `dir` states left five directories
									 * unclaimed and failed `pnpm test:desktop`'s stamp test.
									 *
									 * The `@<width>` suffix is deliberately NOT carried: a story swept
									 * at several widths writes `leaf@800`, `leaf@1024`, ... and the
									 * gate normalises the suffix away when it reads a frame's
									 * directory, so the entry has to be the un-suffixed form for the
									 * same reason - one entry then names every width's directory.
									 */
									...stories.map(([id, , , entryOptions]) => {
										const cut = id.indexOf("--");
										const surface = cut === -1 ? id : id.slice(0, cut);
										const leaf = entryOptions?.dir ?? id.slice(cut + 2);
										return `${surface}--${leaf}`;
									}),
								]),
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
