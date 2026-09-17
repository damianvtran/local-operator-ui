#!/usr/bin/env node
/**
 * Measures what the sidebar's scroll containers do while a row re-files itself.
 *
 *     node scripts/sidebar-resort-geometry.mjs [storybook-origin] [--json] [--assert]
 *
 * WHY THIS EXISTS RATHER THAN A TABLE IN THE PULL REQUEST. The claim is about
 * MOTION: a row's slot changes, and the question is what the scroll container
 * does about the rows around it while that happens. A still cannot answer it -
 * two frames of the same list, scrolled differently and shot a second apart,
 * look equally plausible - and the number that does answer it is `scrollTop`,
 * which is exactly the thing a screenshot does not carry. So the numbers come
 * from the live DOM, sampled while the story's own play function runs, and this
 * file is the command that produces them: a reviewer re-runs it against a
 * worktree rather than trusting a table someone typed.
 *
 * TWO CONTAINERS, FOUND FROM TWO KINDS OF ROW. The sidebar draws session rows
 * twice: in the list panel (`All chats` / the Active and Previous bands) and,
 * nested, under the agent or team an expanded entity owns - and BOTH draw from
 * the same catalogue array in the same order, so a completion's order-key change
 * moves a nested row exactly as it moves a list row. The first version of this
 * rig found "the chat list's scroll container" by walking up from the first
 * `[data-chat-row]` carrying a title, which is not an identity: an entity's own
 * name button carries `data-chat-row` too and is truncated the same way, so one
 * fixture change away from rendering an entity it would have measured the ENTITY
 * region and printed its numbers under the list's label, while missing the region
 * it actually belongs to (review round 1, R3 and R1). Rows are now typed:
 * `[data-tour-tag="chat-session-row"]` is a session, `[data-child]` is one drawn
 * under an entity, and the two scrollers are found by walking up from ONE OF
 * EACH. The entity region is reported whenever a story renders one.
 *
 * ONE MOVE, NOT A NET HORIZON. A re-file is measured from the sample immediately
 * BEFORE the order change to the first sample at or after it, per move. The first
 * version compared the pre-change sample with the SETTLING sample at the end of
 * the run, which is a net reading over a 5 s horizon: a story that re-files twice
 * cancels (the acknowledged round trip ends where it started, so the row that
 * moved most was reported as `null` and the whole first move was invisible to the
 * assertion), and a container positioned so the drag would clamp reports 0 px and
 * passes (review round 1, R2). Every move is now its own measurement, and each
 * one states the ROOM it had on both sides: a drag is only visible to this
 * instrument while both the room above and the room below the viewport exceed the
 * row's travel, so a move that could only have been clamped is reported BLIND
 * rather than passing.
 *
 * WHAT THE KEYBOARD STORY ADDS. `overflow-anchor: none` holds a reader who is
 * somewhere else in the list, and the row that holds KEYBOARD FOCUS is the one
 * case where a container that holds its position leaves the cursor off screen -
 * so the sidebar follows that one row, by the minimum. `--keyboard` dispatch (the
 * `completion-keyboard-refile` entry below) presses ArrowDown once the re-file has
 * been seen and asserts the two things that matter: the traversal moves the
 * viewport by at most one row pitch, and the focused row is the SAME row before
 * and after the re-file and inside the panel. The check that the key actually
 * landed is part of the assertion, so a build where the key never reached the
 * sidebar reports a failure rather than a comfortable zero. What that story's
 * re-file itself does is NOT asserted to be zero: following the cursor is the fix,
 * and the rule only follows a row that was inside the panel before the change and
 * outside after it (round 2: U1 kept, U5 excluded).
 *
 * WHAT IT MEASURES, per story, in CSS pixels at the viewport `capture-evidence`
 * frames the same story at where there is a frame (the entry is read from that
 * file, so a number here and a frame there describe ONE layout rather than two):
 *
 *  - `scroller`    a container, with its `overflow-anchor`, its client and
 *                  content heights, and the largest `scrollTop` it will hold.
 *  - `timeline`    one sample every 25 ms: the rows in DOM order and each row's
 *                  `top`, plus that `scrollTop`. An intermediate ORDER, or an
 *                  interpolated `top` (a row whose `top` is neither its before
 *                  nor its after value), would show up here as a sample that is
 *                  one of those - the "no bouncing" half of the claim.
 *  - `moves`       every order change, with the viewport travel it produced, the
 *                  row travel it was paired with, and the room it had to move in.
 *  - `focus`       where keyboard focus was at each move, and (for the keyboard
 *                  story) what the traversal did to the viewport.
 *
 * Stories that no frame exists for carry their own viewport and say so in the
 * output: a measurement-only story is a measuring fixture, not a picture, and
 * `docs/evidence/` carries frames for the five states the pull request added.
 *
 * `--assert` turns the pinned properties into an exit code: a container that holds
 * its position across a re-file must do so EXACTLY (0.5 px, not one row pitch -
 * see the assertion's own note for why the pitch allowance let the smallest drag
 * pass), a move that could have been clamped is BLIND rather than OK, and the
 * keyboard traversal may not jump the list by more than one pitch. It also asserts
 * what the hold's own clearance exists for (round 3, R3-4 / D4): that a ring IS
 * painted on the focused row at the key, and that none of it is clipped - the rig
 * enables focus emulation before the first story, because a headless page that is
 * not focused does not compute a `:focus-visible` treatment at all and every ring
 * reading without it is a zero that means nothing. It is not wired
 * into a gate - the stories need Storybook - so it is a falsifier a reviewer (or
 * the next agent changing this container) runs by hand.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs`, `chat-alignment-geometry.mjs` and
 * `composer-band-geometry.mjs` (fresh user-data-dir under /tmp, killed on exit,
 * no browser-automation dependency added to the repo). Duplicating the driver a
 * fourth time is the same smaller evil the second file argues: `capture-
 * evidence.mjs`'s loop is built around writing one webp per theme per story, and
 * a "measure instead of shoot" mode threaded through the evidence sweep - the
 * one script in this repo that must stay boring - is the worse trade.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");
const ASSERT = ARGS.includes("--assert");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.slice("--only=".length);

/**
 * The stories whose claim is about a container's geometry, and which container
 * each one is about.
 *
 * `container` names which of the two scrollers the story's claim is measured on:
 * `list` for the panel the operator's report was about, `entity` for the region
 * above it, whose entities own nested session rows that re-file on the same
 * event. `keyboard` marks the story where the cursor is ON the row that re-files,
 * which is the one case the container is allowed to follow it - so its own
 * re-file travel is NOT asserted to be zero, and what is asserted is that the
 * traversal afterwards moves the viewport by at most one pitch.
 */
const STORIES = [
	// The pair the frames carry: the list x the containment question.
	{
		id: "chat-sidebar-status-feed--completion-reordered",
		container: "list",
	},
	{
		id: "chat-sidebar-status-feed--completion-reordered-offscreen",
		container: "list",
	},
	// The round trip, whose first move the net reading could not see (R2).
	{
		id: "chat-sidebar-status-feed--completion-acknowledged",
		container: "list",
	},
	/*
	 * MEASUREMENT-ONLY STORIES, no viewport in `capture-evidence`'s sweep and no
	 * frames in `docs/evidence`: each exists because a claim cannot be measured
	 * anywhere else, and each states its own viewport rather than borrowing a
	 * frame's layout it does not have.
	 */
	{
		id: "chat-sidebar-status-feed--completion-reordered-nested",
		container: "entity",
		viewport: [780, 660],
	},
	{
		id: "chat-sidebar-status-feed--completion-acknowledged-offscreen",
		container: "list",
		viewport: [780, 660],
	},
	{
		id: "chat-sidebar-status-feed--completion-keyboard-refile",
		container: "list",
		keyboard: true,
		viewport: [780, 660],
	},
	/*
	 * THE GATE'S TWO EDGES, as a pair (round 3, U6 / D3). Both put a CURSOR on the
	 * row that re-files and then move the reader's own scroll, and the only
	 * difference between them is whether that row was still partly on screen when
	 * the change landed:
	 *
	 *  - `reader-scrolled-away` is the NEGATIVE, and it is measured by the ordinary
	 *    rule below: the record says the row was already off screen before the
	 *    change, so the container holds its position exactly (U5, D2).
	 *  - `cursor-partly-clipped` is the POSITIVE the two-state record got wrong: a
	 *    row the reader could still SEE, taken the rest of the way out by the
	 *    re-file, so the container has to follow it (U6, D3). `followsCursor` says
	 *    that this story's claim IS the correction firing, which is the one thing the
	 *    hold assertion must not demand of it.
	 */
	{
		id: "chat-sidebar-status-feed--completion-reader-scrolled-away",
		container: "list",
		viewport: [780, 660],
	},
	{
		id: "chat-sidebar-status-feed--completion-cursor-partly-clipped",
		container: "list",
		followsCursor: true,
		viewport: [780, 660],
	},
];

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome prints the DevTools websocket on stderr, once, when it is listening. */
const DEBUG_PORT_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

/** How long to sample. The play function's own waits are 300 ms each. */
const HORIZON_MS = 6000;
/** Sampling period, and the resolution every transition is reported at. */
const SAMPLE_MS = 25;
/**
 * How long to wait after the re-file is seen before pressing the arrow key.
 *
 * The correction the keyboard story is about lands in the same commit as the
 * order change (a layout effect), so the repaint and the corrected `scrollTop`
 * are both in the frame the order change is first sampled in - this is a settle
 * margin for the store's own follow-up react-query render, not a wait for the
 * thing under test.
 */
const KEY_AFTER_REFILE_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
			/*
			 * The page's own errors, under `RIG_DEBUG`. A story whose play function
			 * threw (`expandEntity` not finding its disclosure, a row that was not
			 * there to focus) otherwise looks exactly like a story that measured a
			 * container nothing moved in: the rig samples a page that is sitting
			 * still, and reports zero.
			 */
			if (process.env.RIG_DEBUG && msg.method === "Runtime.exceptionThrown")
				console.error(
					"page error:",
					msg.params?.exceptionDetails?.exception?.description ??
						msg.params?.exceptionDetails?.text,
				);
			if (process.env.RIG_DEBUG && msg.method === "Runtime.consoleAPICalled")
				console.error(
					"page console:",
					msg.params?.args?.map((a) => a.value ?? a.description).join(" "),
				);
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

let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		/*
		 * `maxRetries` because SIGKILL returns before the kernel has finished
		 * reaping the process, and Chrome's profile keeps being written to for a
		 * few milliseconds after that - long enough that a plain recursive remove
		 * loses the race and throws ENOTEMPTY, turning a successful measurement
		 * into a non-zero exit. `force` alone does not cover it: that suppresses
		 * a missing path, not a directory that is still filling up.
		 */
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

/**
 * One sample, evaluated in the page.
 *
 * Written as a string handed to `Runtime.evaluate` rather than as a serialised
 * function, so what runs in the browser is exactly what is read here. No
 * backticks below: the whole thing is a template literal.
 *
 * Rows are TYPED here rather than found by the shape of their text. A session row
 * is `[data-tour-tag="chat-session-row"]`; the list draws it without `data-child`
 * and an expanded entity draws the same row with it. `[data-chat-row]` alone is
 * what the entity's own name button also carries, so "the first `[data-chat-row]`
 * with a truncated title" is a walk away from measuring the wrong container - the
 * defect review round 1 filed as R3, and the reason the entity region was missing
 * from this rig at all (R1).
 *
 * A scroller is found by WALKING UP from a row rather than by a class string,
 * because the class is what the change this rig measures edits: a probe keyed on
 * `overflow-y-auto` would stop finding the container the moment the container
 * stopped being the thing under test, and report "no scroller" for a tree that has
 * one. The walk takes the nearest ancestor that scrolls whether or not it
 * currently overflows: a short roster that fits its panel has a `scrollTop` of 0
 * and no drag to show, and asking the walk to also prove overflow made it report
 * "no scroller" for exactly that story - a state change the rig then could not see
 * at all.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const label = (el) => (el.querySelector("span.min-w-0")?.textContent ?? "").trim();
	const SESSION = '[data-tour-tag="chat-session-row"]';
	const listSessions = [...document.querySelectorAll(SESSION + ":not([data-child])")];
	const nestedSessions = [...document.querySelectorAll(SESSION + "[data-child]")];
	const scrollerOf = (el) => {
		let node = el ? el.parentElement : null;
		while (node && node !== document.body) {
			const cs = getComputedStyle(node);
			if (cs.overflowY === "auto" || cs.overflowY === "scroll") return node;
			node = node.parentElement;
		}
		return null;
	};
	const measure = (container) => {
		if (!container) return null;
		const cs = getComputedStyle(container);
		const box = container.getBoundingClientRect();
		const rows = [...container.querySelectorAll("[data-chat-row]")];
		return {
			overflowAnchor: cs.overflowAnchor,
			clientHeight: container.clientHeight,
			scrollHeight: container.scrollHeight,
			scrollTop: round(container.scrollTop),
			maxScrollTop: container.scrollHeight - container.clientHeight,
			viewTop: round(box.top),
			viewBottom: round(box.bottom),
			classList: container.className,
			rows: rows.map((el, i) => {
				const r = el.getBoundingClientRect();
				const glyph = el.querySelector("svg");
				return {
					index: i,
					title: label(el),
					top: round(r.top),
					height: round(r.height),
					visible: r.bottom > box.top + 1 && r.top < box.bottom - 1,
					glyph: glyph
						? glyph.getAttribute("class")?.split(" ").slice(0, 2).join(" ")
						: null,
				};
			}),
		};
	};
	const listScroller = scrollerOf(listSessions[0]);
	/*
	 * The entity REGION is found from an entity's own row, not from a nested one:
	 * an entity is closed until someone opens it, so a walk that needed a nested
	 * row would find no container at all in the state the story starts in - and the
	 * entity region exists, overflows and is scrolled before any child is drawn.
	 */
	const entityRegion = document.querySelector("[data-entity-name]");
	const entityScroller = scrollerOf(entityRegion ?? nestedSessions[0]);
	const active =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;
	return {
		ready: Boolean(listScroller || entityScroller),
		pageHeight: Math.max(
			document.documentElement.scrollHeight,
			document.body.scrollHeight,
		),
		list: measure(listScroller),
		entity: measure(entityScroller),
		/*
		 * Where the keyboard cursor is, in the terms the claim is made in: the row
		 * it is on, whether that row is inside each container, and whether the
		 * container is showing it. The ring's pixels need a focused WINDOW (this is
		 * headless), but the identity, the position and the containment are the
		 * functional half and are all readable here.
		 */
		focus: (() => {
			if (!active || !active.hasAttribute("data-chat-row")) return null;
			/*
			 * Where keyboard focus is, in the terms the claim is made in: the row it is
			 * on, whether that row is inside each container, and whether the container
			 * is showing it.
			 *
			 * THE RING IS PART OF THIS READING NOW (round 3, R3-4 / D4). The rule that
			 * holds the cursor's row leaves the row's own ring band as clearance, and
			 * nothing in this repo measured whether that ring was whole - the band
			 * reading rested on a scratch harness in another stream. The band is read the
			 * way the app reads it (the row's own computed outline-width plus
			 * outline-offset, 0 whenever no ring is painted), and ringClippedPx is how
			 * much of it sits above the container's clip box, so a row whose ring has a
			 * segment shaved off fails the keyboard assertion below rather than passing
			 * as a number nobody checked.
			 *
			 * A page that is not FOCUSED computes outline-style none for a
			 * :focus-visible treatment, so this reading is only meaningful with
			 * Emulation.setFocusEmulationEnabled - set once, before the first story -
			 * and the assertion requires a painted ring, which is what keeps a
			 * band-of-zero from passing as a whole ring.
			 */
			const scroller = listScroller?.contains(active)
				? listScroller
				: entityScroller?.contains(active)
					? entityScroller
					: null;
			const cs = getComputedStyle(active);
			const band =
				cs.outlineStyle === "none"
					? 0
					: (Number.parseFloat(cs.outlineWidth) || 0) +
						(Number.parseFloat(cs.outlineOffset) || 0);
			const rowBox = active.getBoundingClientRect();
			const clipTop = scroller
				? scroller.getBoundingClientRect().top + scroller.clientTop
				: null;
			const ringTop = rowBox.top - band;
			return {
				title: label(active),
				top: round(rowBox.top),
				inList: Boolean(listScroller && listScroller.contains(active)),
				inEntity: Boolean(
					entityScroller && entityScroller.contains(active),
				),
				/*
				 * The row's containment in its own container, computed the way the APP
				 * computes it (sidebar-focus-hold.ts): a padding-box clip, and three
				 * states rather than a boolean. Carrying the same three names here is what
				 * makes these cells legible against the rule - the rig can say the cursor's
				 * row was partly on screen before the change and inside after it, which
				 * is the claim U6/D3 is about and not something a top reading states.
				 */
				visibility: (() => {
					if (!scroller || clipTop === null) return null;
					const clipBottom = clipTop + scroller.clientHeight;
					if (
						rowBox.bottom <= clipTop ||
						rowBox.top >= clipBottom
					)
						return "outside";
					return rowBox.top >= clipTop && rowBox.bottom <= clipBottom
						? "inside"
						: "partly";
				})(),
				ring: {
					outlineStyle: cs.outlineStyle,
					band: round(band),
					clipTop: clipTop === null ? null : round(clipTop),
					ringTop: round(ringTop),
					clearancePx: clipTop === null ? null : round(rowBox.top - clipTop),
					ringClippedPx:
						clipTop === null ? null : round(Math.max(0, clipTop - ringTop)),
				},
			};
		})(),
	};
})()`;

/** One decimal, the resolution every number this rig reports is read at. */
const round = (n) => Math.round(n * 10) / 10;

const main = async () => {
	const { STORIES: frameStories } = await import("./capture-evidence.mjs");
	/**
	 * The viewport a story must be measured at.
	 *
	 * A story the sweep frames is measured at the FRAME's viewport - read from the
	 * capturer itself rather than restated here, so a number in this output and the
	 * picture beside it describe one layout. A measurement-only story states its own
	 * and is measured declared-then-grown exactly as the capturer would, because a
	 * fixture is not a frame and borrowing a frame's height would be a number about
	 * a picture that does not exist.
	 */
	const viewportFor = (story) => {
		const entry = frameStories.find(([id]) => id === story.id);
		if (entry) return { width: entry[1], height: entry[2], framed: true };
		if (story.viewport)
			return {
				width: story.viewport[0],
				height: story.viewport[1],
				framed: false,
			};
		throw new Error(
			`${story.id} is neither in capture-evidence's STORIES nor given a viewport here, so there is no layout to measure it at`,
		);
	};
	const stories = ONLY
		? STORIES.filter((story) => story.id.includes(ONLY))
		: STORIES;

	dataDir = join(tmpdir(), `lo-sidebar-resort-${process.pid}`);
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
	await cdp.send("Runtime.enable");
	/*
	 * A HEADLESS PAGE IS NEVER FOCUSED, SO ITS `:focus-visible` TREATMENT IS NOT
	 * COMPUTED AT ALL.
	 *
	 * Measured on this branch's keyboard story, both ways: without this call the row
	 * the story focuses reports `outline-style: none` (band 0, nothing painted), and
	 * with it `2px solid` at a `2px` offset (band 4) - which is the same number the
	 * app-side cells read. That matters twice over: the ring reading below is
	 * vacuous without it, and the APP's own correction reads the same computed style
	 * (`ringBand`), so an unfocused page would have this rig measuring the
	 * mouse-focus landing (flush at the clip edge) while reporting it as the
	 * keyboard one.
	 */
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

	const index = await fetch(`${ORIGIN}/index.json`).then((r) => r.json());
	const known = new Set(Object.keys(index.entries ?? {}));

	const results = [];
	for (const story of stories) {
		const { width, height, framed } = viewportFor(story);
		if (!known.has(story.id)) {
			throw new Error(
				`unknown story id ${story.id}. Check ${ORIGIN}/index.json - the ids come from the story's own title.`,
			);
		}
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story.id}&viewMode=story&args=theme:localOperatorDark`,
		});
		/*
		 * Match the layout the FRAME is shot at, before the transition runs.
		 *
		 * `capture-evidence.mjs` grows the viewport to
		 * `max(documentElement.scrollHeight, body.scrollHeight, declared)` before
		 * it opens the shutter, and this surface's page height is driven by the
		 * caption column beside the sidebar - so a story declared at 1120 is shot
		 * at 1573, where the `max-h-[45%]` list panel is a bigger share of a bigger
		 * number and the scroll container has a different amount of room. Measuring
		 * at the declared height would report numbers about a layout the frame does
		 * not show, which is the one thing a geometry rig may not do.
		 *
		 * Early rather than at the end, and that is the whole trick: the play
		 * function sets the scroll position and then re-files the row, so the
		 * resize has to land BEFORE both of those for the transition sampled below
		 * to be the one the frame carries. The roster is complete well before
		 * either, so the resize is waited for on the ROW COUNT rather than on a
		 * clock, and a story whose list never arrives fails by name.
		 */
		/*
		 * Rows that CARRY A TITLE, not just rows. The panel's own chrome (All
		 * chats, New chat, the band headings) is in the container from the first
		 * paint, so a settle waited on for "some row count" is satisfied before a
		 * single session has arrived - and the transition this rig measures would
		 * then be sampled against an empty list.
		 */
		const rowsNow = (sample) =>
			(sample?.[story.container]?.rows ?? []).filter((row) => row.title).length;
		/*
		 * A COLD SERVER'S FIRST STORY WAITS ON A COMPILE SIGNAL, AND BOTH PHASES ARE
		 * COUNTED IN SAMPLES RATHER THAN IN MILLISECONDS (round 2 N2, raised again in
		 * round 3 as R3-3).
		 *
		 * Two budgets rather than one, because the two failure states want opposite
		 * answers. A storybook that has just started COMPILES a story on demand, so the
		 * story has not mounted: the page is not `ready`, no container is in the DOM, and
		 * the only thing that helps is waiting longer - a run against a fresh server at
		 * load average ~300 died here twice in review round 3, the second time on a story
		 * that had already failed once, so "a second run usually settles" is advice
		 * nobody should have to take. A page that IS ready and never settles its row
		 * count is a different defect - the story re-renders, or it renders no titled
		 * rows - and reporting that as a mount failure sends the reader to the wrong
		 * thing.
		 *
		 * SAMPLES AND NOT MILLISECONDS, deliberately: each sample is a CDP round trip
		 * through a page that is competing with sibling worktrees, so on a loaded host a
		 * sample can take a second rather than 25 ms - a wall-clock budget therefore
		 * SHRINKS when the host is busy, which is the opposite of what a settle timeout is
		 * for. Counted in samples, the budget stretches with the load; the wall-clock
		 * ceiling is only a backstop so a wedged page cannot hang a reviewer's run
		 * forever, and a run that reaches it says the elapsed time it waited.
		 *
		 * The row count is read off the container's own rows and filtered to the ones
		 * that carry a title: the panel's chrome (band headings, the search field) is in
		 * the container from the first paint, so waiting on "some row count" would be
		 * satisfied before a single session arrived - and the transition this rig
		 * measures would then be sampled against an empty list.
		 */
		const MOUNT_SAMPLES = 600;
		const SETTLE_SAMPLES = 600;
		const CEILING_MS = 900_000;
		const startedAt = Date.now();
		let samples = 0;
		let stable = 0;
		let seen = 0;
		let everReady = false;
		let resized = null;
		for (;;) {
			samples += 1;
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const count = rowsNow(result.value);
			everReady = everReady || Boolean(result.value?.ready);
			if (process.env.RIG_DEBUG)
				console.error(
					"settle",
					`${Date.now() - startedAt} ms`,
					`samples=${samples}`,
					"rows=",
					JSON.stringify(count),
					"ready=",
					result.value?.ready,
				);
			stable = count > 1 && count === seen ? stable + 1 : 0;
			seen = count;
			if (stable >= 3) {
				const { result: full } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, ${height})`,
				});
				resized = Math.min(full.value, 16384);
				await cdp.send("Emulation.setDeviceMetricsOverride", {
					width,
					height: resized,
					deviceScaleFactor: 1,
					mobile: false,
				});
				break;
			}
			const waited = Date.now() - startedAt;
			if (samples > (everReady ? SETTLE_SAMPLES : MOUNT_SAMPLES)) break;
			if (waited > CEILING_MS) break;
			await sleep(SAMPLE_MS);
		}
		if (resized === null) {
			const waited = Math.round((Date.now() - startedAt) / 1000);
			/*
			 * The two states are named in the failure rather than described, because what
			 * a reader does next differs: a page that never mounted is waited on, a page
			 * that mounted and kept changing is looked at.
			 */
			const why = everReady
				? `The page mounted and then kept changing the rows (${samples} samples), so this is not a cold server: wait for the story to stop re-rendering, or look at what it is rendering - the rig reports a row count it never saw settle rather than a number it could not match.`
				: `The page never mounted a container at all in ${samples} samples, which is a storybook still compiling this story on demand - re-run it, and if a second run also stalls at the same story, start the server and let it finish its first compile before measuring.`;
			throw new Error(
				`${story.id}: the ${story.container} container never settled on a row count after ${waited} s of sampling (last count ${seen}, mounted: ${everReady}). ${why}`,
			);
		}
		/*
		 * Sample from the moment the story mounts, because the transition this
		 * measures is INSIDE the story's own play function: waiting for a settled
		 * page first would photograph the answer and never see the move. A sample
		 * whose container is not there yet is dropped rather than reported as a
		 * zero - `ready` is the container, not the page.
		 */
		const timeline = [];
		let keyAt = null;
		let keyed = false;
		let refileSeenAt = null;
		let previousOrder = null;
		const started = Date.now();
		while (Date.now() - started < HORIZON_MS) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const value = result.value;
			const container = value?.[story.container];
			if (value?.ready && container) {
				const order = container.rows.map((r) => r.title).join("|");
				/*
				 * The key is pressed onto the row the cursor is on, ONCE, a settle
				 * margin after the re-file the story performs. It is dispatched
				 * through CDP rather than as a synthetic page event so what runs is
				 * the app's own handler under a trusted key event - and the
				 * assertion below checks that the traversal actually happened, so a
				 * key that never landed cannot be read as a comfortable zero.
				 */
				if (story.keyboard && !keyed && refileSeenAt !== null) {
					if (Date.now() - refileSeenAt >= KEY_AFTER_REFILE_MS) {
						keyed = true;
						keyAt = Date.now() - started;
						const key = {
							key: "ArrowDown",
							code: "ArrowDown",
							windowsVirtualKeyCode: 40,
							nativeVirtualKeyCode: 40,
						};
						await cdp.send("Input.dispatchKeyEvent", {
							type: "rawKeyDown",
							...key,
						});
						await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
					}
				}
				/*
				 * The key is pressed a settle margin after the LAST order change seen,
				 * not the first: a story whose roster is delivered in two frames briefly
				 * passes through an order that is neither the pre-move nor the settled
				 * one, and a key dispatched against that transient state would measure a
				 * list mid-flight rather than the state the story is about.
				 */
				if (story.keyboard && previousOrder !== null && order !== previousOrder)
					refileSeenAt = Date.now() - started;
				previousOrder = order;
				timeline.push({ t: Date.now() - started, ...value, order });
			}
			await sleep(SAMPLE_MS);
		}
		if (timeline.length === 0) {
			throw new Error(
				`${story.id}: no ${story.container} scroll container was ever found. The story did not render its rows, or the walk in PROBE stopped matching the tree it is measuring.`,
			);
		}
		/*
		 * BOTH CONTAINERS ARE MEASURED ON EVERY STORY, and only the story's own is
		 * asserted. Two reasons, and the second is the finding this rework answers:
		 * a story that renders entities has two scrollers taking the SAME order-key
		 * event, so reporting one and staying silent about the other is how the entity
		 * region went unmeasured in the first place (R1); and a container's own pitch
		 * is read from its own layout rather than from one global number the two
		 * disagree about.
		 */
		const containers = ["list", "entity"];
		const settledOf = (key) => timeline.at(-1)[key];
		const orderOf = (container) => container.rows.map((r) => r.title).join("|");
		/** One row's pitch, read off that container's own settled layout. */
		const pitchOf = (container) => {
			if (!container) return null;
			const tops = container.rows.map((r) => r.top).sort((a, b) => a - b);
			const gaps = tops.slice(1).map((top, i) => round(top - tops[i]));
			const usual = gaps.filter((gap) => gap > 1).sort((a, b) => a - b);
			return usual.length ? usual[Math.floor(usual.length / 2)] : null;
		};
		/*
		 * Every order change in one container, measured from the sample immediately
		 * BEFORE it to the FIRST sample at or after it - per MOVE, not across the
		 * run. A net reading over the horizon lets a second move cancel the first
		 * (the acknowledged round trip ends where it started, so the row that moved
		 * most read as `null` and its drag was invisible to the assertion), and it
		 * cannot say which of the moves it measured (review round 1, R2).
		 */
		const movesFor = (key) => {
			const settled = settledOf(key);
			if (!settled) return [];
			const pitch = pitchOf(settled);
			const out = [];
			for (let i = 1; i < timeline.length; i++) {
				const previous = timeline[i - 1][key];
				const sample = timeline[i][key];
				if (!previous || !sample) continue;
				if (orderOf(sample) === orderOf(previous)) continue;
				const beforeOrder = previous.rows.map((row) => row.title);
				const afterOrder = sample.rows.map((row) => row.title);
				/*
				 * The re-filing row, read from where it STARTS and where it ENDS rather
				 * than assumed: it is the row whose slot changed most, because every row
				 * between its old and new positions shifts by one as a side effect. A row
				 * present on one side only is a membership change, not a re-file, and is
				 * reported without a travel rather than with a guessed one.
				 */
				const mover =
					beforeOrder.length === afterOrder.length
						? beforeOrder.reduce((found, title) => {
								const from = beforeOrder.indexOf(title);
								const to = afterOrder.indexOf(title);
								if (to < 0) return found;
								if (
									found &&
									Math.abs(found.to - found.from) >= Math.abs(to - from)
								)
									return found;
								return { title, from, to };
							}, null)
						: null;
				const rowTravelPx =
					mover && pitch
						? round(Math.abs(mover.to - mover.from) * pitch)
						: null;
				const roomAbovePx = round(previous.scrollTop);
				const roomBelowPx = round(settled.maxScrollTop - previous.scrollTop);
				out.push({
					container: key,
					t: timeline[i].t,
					scrollTop: sample.scrollTop,
					beforeScrollTop: previous.scrollTop,
					viewportTravel: round(sample.scrollTop - previous.scrollTop),
					order: afterOrder,
					beforeOrder,
					ink: sample.rows.map((row) => row.glyph),
					focus: timeline[i].focus,
					beforeFocus: timeline[i - 1].focus,
					mover,
					rowTravelPx,
					roomAbovePx,
					roomBelowPx,
					/*
					 * A drag is only visible to this instrument while the viewport had the ROOM
					 * to move by the row's travel on both sides of its position: a move from a
					 * container already at one end could only have been clamped, and reporting
					 * its 0 px as a pass is the wrong answer this instrument used to accept.
					 * A container that cannot scroll at all is the one vacuous case - there is
					 * no viewport for a drag to move - and it is not blind.
					 */
					blind:
						settled.maxScrollTop > 0 &&
						rowTravelPx !== null &&
						(roomAbovePx < rowTravelPx || roomBelowPx < rowTravelPx),
				});
			}
			return out;
		};
		const moves = Object.fromEntries(
			containers.map((key) => [key, movesFor(key)]),
		);
		const subjectMoves = moves[story.container];
		/*
		 * The traversal the keyboard story is about: from the sample just before the
		 * key to the settled one. Reported as a delta rather than folded into the
		 * moves above, because the row that holds the cursor is the one case the
		 * container is ALLOWED to follow - what it may not do is jump the list when
		 * the cursor moves on to its neighbour.
		 */
		let keyStep = null;
		if (story.keyboard && keyAt !== null) {
			const beforeKey = [...timeline].reverse().find((s) => s.t <= keyAt);
			const afterKey = timeline.at(-1);
			const container = afterKey[story.container];
			keyStep = {
				at: keyAt,
				fromTitle: beforeKey?.focus?.title ?? null,
				toTitle: afterKey?.focus?.title ?? null,
				scrollTopBefore: beforeKey?.[story.container].scrollTop ?? null,
				scrollTopAfter: container.scrollTop,
				travel: round(
					container.scrollTop - (beforeKey?.[story.container].scrollTop ?? 0),
				),
				/*
				 * The cursor must still be INSIDE the panel when the key is pressed,
				 * which is what makes a one-pitch traversal the whole cost: the
				 * neighbouring row is already on screen. Without the row held in the
				 * panel this is false, and it is the state the operator's report is
				 * about rather than something the traversal produced.
				 */
				insidePanelAtKey: Boolean(
					beforeKey?.[story.container].rows.some(
						(row) => row.title === beforeKey.focus?.title && row.visible,
					),
				),
				/*
				 * The ring the correction existed to uncover, read at the same sample - so
				 * the clearance and the clipping are the numbers of the frame the key is
				 * pressed in rather than of the settled end state.
				 */
				ringAtKey: beforeKey?.focus?.ring ?? null,
			};
		}
		const focusedAtRefile = subjectMoves.map((move) => ({
			t: move.t,
			title: move.focus?.title ?? null,
			inContainer: Boolean(
				story.container === "list" ? move.focus?.inList : move.focus?.inEntity,
			),
		}));
		results.push({
			story: story.id,
			container: story.container,
			keyboard: Boolean(story.keyboard),
			followsCursor: Boolean(story.followsCursor),
			framed,
			viewport: `${width}x${height}`,
			declaredHeight: height,
			shotHeight: resized,
			pageHeight: Math.max(...timeline.map((sample) => sample.pageHeight)),
			scrollers: Object.fromEntries(
				containers.map((key) => [key, settledOf(key)]),
			),
			samples: timeline.length,
			moves,
			subjectMoves,
			keyStep,
			focusedAtRefile,
			pitch: pitchOf(settledOf(story.container)),
			/*
			 * TRANSIENT ORDERS: an order seen after the first move that is neither the
			 * settled one nor one side of a move - a position a reader would see the
			 * list pass through and not stay in, which is the "no intermediate
			 * geometry" half of the claim. Counted from the first move ONWARDS,
			 * because a fixture assembling itself (rows arriving, an entity opening)
			 * walks through intermediate orders legitimately and before the transition
			 * this rig samples is even due. The first version counted those and read
			 * as a bounce on stories that had none.
			 */
			transientOrders: (() => {
				const settledOrder = orderOf(timeline.at(-1)[story.container]);
				const known = new Set([settledOrder]);
				for (const move of subjectMoves) {
					known.add(move.order.join("|"));
					known.add((move.beforeOrder ?? []).join("|"));
				}
				const first = subjectMoves.length
					? subjectMoves[0].t
					: Number.POSITIVE_INFINITY;
				return timeline.filter(
					(sample) =>
						sample.t >= first &&
						sample[story.container] &&
						!known.has(orderOf(sample[story.container])),
				).length;
			})(),
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
	} else {
		for (const result of results) {
			const container =
				result.container === "entity" ? "entity region" : "chat list";
			console.log(
				`\n${result.story}  @ ${result.viewport}  (${ORIGIN})  [claim measured on the ${container}]`,
			);
			console.log(
				`  frames          ${result.framed ? "swept, measured at its own frame's viewport" : "none - a measuring fixture, no committed set"}`,
			);
			console.log(
				`  samples         ${result.samples} over ${HORIZON_MS} ms (${SAMPLE_MS} ms apart)`,
			);
			console.log(
				`  viewport        declared ${result.declaredHeight} px, measured and sampled at ${result.shotHeight} px; page reports ${result.pageHeight} px`,
			);
			for (const key of ["list", "entity"]) {
				const scroller = result.scrollers[key];
				if (!scroller) continue;
				const pitch =
					result.pitch && result.container === key ? result.pitch : null;
				console.log(
					`  ${key === "entity" ? "entity region" : "list scroller"}  overflow-anchor=${scroller.overflowAnchor}  client=${scroller.clientHeight}  content=${scroller.scrollHeight}  maxScrollTop=${scroller.maxScrollTop}  rows=${scroller.rows.length}${pitch === null ? "" : `  pitch=${pitch}`}`,
				);
			}
			for (const key of ["list", "entity"]) {
				for (const move of result.moves[key]) {
					const subject =
						key !== result.container
							? " (the story's own container is the other one)"
							: result.keyboard
								? " (the container following the row the CURSOR is on - this story's claim is the traversal below, not a zero here)"
								: "";
					console.log(
						`  move ${key} t=${String(move.t).padStart(4)} ms  scrollTop ${move.beforeScrollTop} -> ${move.scrollTop}  (${move.viewportTravel} px of viewport travel against ${move.rowTravelPx} px of row travel)${subject}`,
					);
					if (move.mover)
						console.log(
							`    re-filed      "${move.mover.title}"  index ${move.mover.from} -> ${move.mover.to}`,
						);
					console.log(
						`    room          ${move.roomAbovePx} px above / ${move.roomBelowPx} px below${
							move.blind && key === result.container && !result.keyboard
								? "  -> BLIND: the drag could have been clamped"
								: move.blind && key === result.container
									? "  (blind, but this move is not asserted: this story's claim is the traversal below)"
									: move.blind
										? "  (blind, but this is not the story's own container - reported, not asserted)"
										: ""
						}`,
					);
					console.log(
						`    focus         ${move.beforeFocus?.title ?? "(none)"} -> ${move.focus?.title ?? "(none)"}${move.focus?.inList || move.focus?.inEntity ? " (inside a container)" : ""}`,
					);
					if (move.focus)
						console.log(
							`    cursor row    ${move.beforeFocus?.visibility ?? "(no reading)"} -> ${move.focus?.visibility ?? "(no reading)"} in its container`,
						);
				}
			}
			console.log(
				`  transient        ${result.transientOrders} sample(s) in an order that is neither a settled nor a move's own - the "no intermediate geometry" half of the claim`,
			);
			if (result.keyStep) {
				const step = result.keyStep;
				console.log(
					`  ArrowDown t=${step.at} ms  focus ${step.fromTitle} -> ${step.toTitle}  scrollTop ${step.scrollTopBefore} -> ${step.scrollTopAfter}  (${step.travel} px)`,
				);
				console.log(
					`  at the key      the focused row was visible in the panel: ${step.insidePanelAtKey}`,
				);
				console.log(
					`  ring at the key ${step.ringAtKey?.outlineStyle} band ${step.ringAtKey?.band} px; the row's box sits ${step.ringAtKey?.clearancePx} px past the clip edge at ${step.ringAtKey?.clipTop}; ring clipped by ${step.ringAtKey?.ringClippedPx} px`,
				);
			}
		}
	}
	/*
	 * The hold is asserted EXACTLY, and the tolerance is no longer one pitch.
	 *
	 * The first version allowed `pitch + 0.5` on the reasoning that a container
	 * holding its `scrollTop` still redraws the rows below the mover one pitch lower
	 * relative to the viewport. The metric is `scrollTop`, not a row's position, so
	 * that reasoning does not reach it: with the declaration present the hold is 0 px
	 * in every story, and the allowance let the SMALLEST drag the app can produce - a
	 * one-slot re-file, whose row travel is exactly one pitch and whose drag is the
	 * same pitch - read as "held its position" (review round 2, R2-3). A container
	 * that cannot scroll at all is still vacuous rather than blind (it has no viewport
	 * to drag).
	 *
	 * The KEYBOARD story is the one exception, and it is judged on its own claim: the
	 * cursor is ON the row that re-files, so the container is allowed to follow it
	 * there (that is the fix) - the pitch is the bound on the travel of the arrow press
	 * that follows (`step.travel`), not on the re-file. Its own move is not asserted
	 * here at all: what may not happen is a JUMP when the cursor moves on.
	 */
	if (ASSERT) {
		const failures = [];
		/** The keyboard traversal's allowance: the browser's own scroll-into-view of
		 * the neighbour the cursor moved to is bounded by one row pitch. */
		const HOLD_PX = 0.5;
		for (const result of results) {
			const keyLimit = result.pitch === null ? HOLD_PX : result.pitch + 0.5;
			if (result.keyboard) {
				const step = result.keyStep;
				if (!step) {
					failures.push(
						`FAIL ${result.story}: the keyboard story never got a traversal step, so its claim was not measured.`,
					);
					continue;
				}
				if (step.fromTitle === step.toTitle)
					failures.push(
						`FAIL ${result.story}: the ArrowDown did not move focus (still ${step.toTitle}), so the traversal this story asserts was never exercised - the key did not reach the sidebar.`,
					);
				if (!step.insidePanelAtKey)
					failures.push(
						`FAIL ${result.story}: the cursor was NOT inside the panel when the arrow key was pressed, so a jump on the next press is the state the capture starts from rather than what the traversal produced.`,
					);
				/*
				 * The ring the hold exists to uncover, and the clearance that is supposed
				 * to keep it whole (round 3, R3-4 / D4 - the code review's finding and the
				 * design stream's D4 are one defect, so they are one check here).
				 *
				 * Two failures rather than one, because they are different defects: a row
				 * with NO ring painted means this cell measured nothing at all (a
				 * `:focus-visible` treatment does not compute on a page that is not focused,
				 * so the absence is an instrument failure and it has to be loud), while a
				 * CLIPPED ring is D1's own symptom - the ring's outer edge landing above the
				 * container's clip box, which is a pixel the reader loses.
				 *
				 * The clearance the correction aims at is EXACT - the row's own band, not the
				 * band plus a margin - so `clearancePx` is printed beside this check rather
				 * than asserted at a value: a future +1 px of slack would show up there as a
				 * visible gap, and a shaved pixel shows up here as a failure. That is the
				 * contract this rig now measures; the module comment states that exactness is
				 * the intent.
				 */
				if (!step.ringAtKey || step.ringAtKey.outlineStyle === "none")
					failures.push(
						`FAIL ${result.story}: the focused row painted no ring at the key (outline-style ${step.ringAtKey?.outlineStyle ?? "(no reading)"}), so this cell cannot say whether the hold leaves the ring whole. The rig enables focus emulation before the first story; without it a headless page never matches :focus-visible and every ring reading here is a zero that means nothing.`,
					);
				else if ((step.ringAtKey.ringClippedPx ?? 0) > 0)
					failures.push(
						`FAIL ${result.story}: the focused row's ring is clipped by ${step.ringAtKey.ringClippedPx} px at the key (ringTop ${step.ringAtKey.ringTop} against clipTop ${step.ringAtKey.clipTop}, band ${step.ringAtKey.band}) - the hold is supposed to leave the ring's own band inside the clip box, and a shaved ring is the defect the clearance exists to prevent.`,
					);
				if (Math.abs(step.travel) > keyLimit)
					failures.push(
						`FAIL ${result.story}: the arrow key after the re-file moved the viewport ${step.travel} px (limit: one ${result.pitch} px row). The container follows the row the cursor is on across a re-file; it may not jump when the cursor moves on.`,
					);
				/*
				 * And the row the cursor was on is the SAME row after the re-file, still
				 * inside the container. This is the half of U1 that says the cursor was not
				 * stranded and not transferred to a different conversation: the row's node
				 * is the session, so a transfer would silently retarget `Enter`.
				 */
				const strayed = result.focusedAtRefile.filter(
					(entry) => entry.title !== step.fromTitle || !entry.inContainer,
				);
				if (strayed.length > 0)
					failures.push(
						`FAIL ${result.story}: the re-file left the cursor on ${strayed.map((e) => `${e.title ?? "(nothing)"}${e.inContainer ? "" : " (outside the container)"}`).join(", ")} rather than on "${step.fromTitle}" inside it - focus was stranded or transferred.`,
					);
				continue;
			}
			/*
			 * A story whose own claim IS the correction firing (round 3, U6/D3): the
			 * cursor's row was still PARTLY on screen when the re-file took it out, so the
			 * container has to follow it - which is the one thing the hold assertion below
			 * must not demand. Three properties, because each rules out a different way of
			 * passing for the wrong reason: the row really was partly visible before the
			 * change (or the cell is measuring the state next to it), the correction really
			 * ran (a zero here is the defect), and it was the MINIMUM - bounded by the row's
			 * own travel plus its ring band - with the row INSIDE at the settle rather than
			 * merely closer to the panel.
			 */
			if (result.followsCursor) {
				for (const move of result.subjectMoves) {
					const band = move.focus?.ring?.band ?? 0;
					if (move.beforeFocus?.visibility !== "partly")
						failures.push(
							`FAIL ${result.story}: the cursor's row was ${move.beforeFocus?.visibility ?? "(no reading)"} in its container before the change rather than PARTLY - this story's claim is the row the reader could still see, so at this position it is measuring the neighbouring state instead.`,
						);
					else if (move.viewportTravel === 0)
						failures.push(
							`FAIL ${result.story}: the re-file took the cursor's row out of the panel and the container did not follow it (0 px) - that is the stranding U6/D3 filed, a focused row the reader cannot see.`,
						);
					else if (
						Math.abs(move.viewportTravel) >
						(move.rowTravelPx ?? 0) + band + 0.5
					)
						failures.push(
							`FAIL ${result.story}: the container followed the cursor by ${move.viewportTravel} px for ${move.rowTravelPx} px of row travel (bound: the travel plus the row's own ${band} px ring band) - the correction is the minimum that brings the row back, not a jump past it.`,
						);
					if (move.focus?.visibility !== "inside")
						failures.push(
							`FAIL ${result.story}: the cursor's row ends ${move.focus?.visibility ?? "(no reading)"} in its container rather than INSIDE, so the correction did not bring it back into the panel.`,
						);
				}
				continue;
			}
			for (const move of result.subjectMoves) {
				if (Math.abs(move.viewportTravel) > HOLD_PX) {
					failures.push(
						`FAIL ${result.story}: the viewport moved ${move.viewportTravel} px while a row re-filed (limit: ${HOLD_PX} px - the container holds its scroll position exactly). The container should hold its scroll position - see chat-sidebar.tsx's note on overflow-anchor.`,
					);
					continue;
				}
				if (move.blind)
					failures.push(
						`BLIND ${result.story}: this move reports ${move.viewportTravel} px, but the container had only ${move.roomAbovePx} px above and ${move.roomBelowPx} px below against ${move.rowTravelPx} px of row travel - a drag could have been clamped away and this reading cannot certify the container held its position. Re-position the story rather than reading this as a pass.`,
					);
			}
		}
		for (const failure of failures) console.error(failure);
		if (failures.length > 0) process.exitCode = 1;
		else {
			const followNote = results.some((result) => result.followsCursor)
				? " The cursor-follow cell is judged on its own claim instead: the re-file DID move the container, by no more than the row's own travel plus its ring band, and the cursor's row is inside the panel at the settle."
				: "";
			console.log(
				`\nOK: every measured move held its scroll position exactly (within 0.5 px), every move had the room to show a drag, and the keyboard traversal did not jump the list.${followNote}`,
			);
		}
	}
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

if (isEntryPoint(import.meta.url)) {
	main()
		.then(() => teardown())
		.catch((error) => {
			teardown();
			console.error(error);
			process.exit(1);
		});
}

export { PROBE, STORIES };
