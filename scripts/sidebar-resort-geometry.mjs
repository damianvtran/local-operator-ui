#!/usr/bin/env node
/**
 * Measures what the sidebar's LIST does while a row re-files itself.
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
 * WHAT IT MEASURES, per story, in CSS pixels at the viewport `capture-evidence`
 * frames the same story at (the entry is read from that file, so a number here
 * and a frame there describe ONE layout rather than two):
 *
 *  - `scroller`    the chat list's own scroll container - the one the operator's
 *                  report is about - with its `overflow-anchor`, its client and
 *                  content heights, and the largest `scrollTop` it will hold.
 *  - `timeline`    one sample every 25 ms: the rows in DOM order and each row's
 *                  `top`, plus that `scrollTop`. An intermediate ORDER, or an
 *                  interpolated `top` (a row whose `top` is neither its before
 *                  nor its after value), would show up here as a sample that is
 *                  one of those - the "no bouncing" half of the claim.
 *  - `transitions` every sample whose order or `scrollTop` differs from the one
 *                  before it, with the time it was seen at.
 *  - `travel`      the number the report is about: how far `scrollTop` moved
 *                  across the re-file, beside the row pitch and how many rows
 *                  the re-filing row travelled. Chrome's scroll anchoring pins
 *                  an in-view row and pays for it by moving the viewport by the
 *                  travel; `overflow-anchor: none` on the container is what makes
 *                  the second term zero, and this is the pair that says which
 *                  state the tree is in.
 *
 * `--assert` turns the pinned property into an exit code: the viewport may move
 * by at most ONE row pitch across a re-file. It is not wired into a gate - the
 * stories need Storybook - so it is a falsifier a reviewer (or the next agent
 * changing this container) runs by hand.
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
 * The stories whose claim is about the list's own geometry.
 *
 * One pair, and the pair is the point: the same completion photographed in a
 * list that FITS its panel and in one that overflows it. The first is what the
 * operator sees when the sidebar is quiet, and it is where "the row changed
 * slot" is the whole story; the second is the state the report is really about,
 * because it is the only one where the scroll container has anything to decide.
 */
const STORIES = [
	"chat-sidebar-status-feed--completion-reordered",
	"chat-sidebar-status-feed--completion-reordered-offscreen",
	"chat-sidebar-status-feed--completion-acknowledged",
];

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome prints the DevTools websocket on stderr, once, when it is listening. */
const DEBUG_PORT_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

/** How long to sample. The play function's own waits are 300 ms each. */
const HORIZON_MS = 5000;
/** Sampling period, and the resolution every transition is reported at. */
const SAMPLE_MS = 25;

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
 * The list's scroll container is found by WALKING UP from a session row rather
 * than by a class string, because the class is what this change edits: a probe
 * keyed on `overflow-y-auto` would stop finding the container the moment the
 * container stopped being the thing under test, and report "no scroller" for a
 * tree that has one. `[data-chat-row]` is the row identity the sidebar's own
 * keyboard walk uses, and the first row carrying a session title is the list's.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rows = [...document.querySelectorAll("[data-chat-row]")].filter(
		(el) => (el.querySelector("span.min-w-0")?.textContent ?? "").trim().length > 0,
	);
	/* The chat list's own scroll container: the nearest ancestor of a session
	   row that scrolls. The entity region above it scrolls too, so the walk
	   starts from the LIST's rows and not from the panel's first child. */
	const scroller = (() => {
		let node = rows[0] ? rows[0].parentElement : null;
		while (node && node !== document.body) {
			const cs = getComputedStyle(node);
			/* The first scroll container ABOVE the rows, whether or not it currently
			   overflows: a short roster that fits its panel has a scrollTop of 0 and
			   no drag to show, and asking this walk to also prove overflow made it
			   report "no scroller" for exactly that story - a state change the rig
			   then could not see at all. */
			if (cs.overflowY === "auto" || cs.overflowY === "scroll") return node;
			node = node.parentElement;
		}
		return null;
	})();
	if (!scroller) return { ready: false };
	const cs = getComputedStyle(scroller);
	const box = scroller.getBoundingClientRect();
	return {
		ready: true,
		/* The height capture-evidence.mjs resizes the viewport to before it shoots
		   (it takes the max of both roots' scrollHeight and the declared height), so
		   a story declared at this height is captured at the layout it was measured
		   in rather than at a taller one the resize would produce. */
		pageHeight: Math.max(
			document.documentElement.scrollHeight,
			document.body.scrollHeight,
		),
		scroller: {
			overflowAnchor: cs.overflowAnchor,
			clientHeight: scroller.clientHeight,
			scrollHeight: scroller.scrollHeight,
			scrollTop: round(scroller.scrollTop),
			maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
			viewTop: round(box.top),
			viewBottom: round(box.bottom),
			classList: scroller.className,
		},
		rows: rows.map((el, i) => {
			const r = el.getBoundingClientRect();
			const title = el.querySelector("span.min-w-0")?.textContent ?? "";
			const glyph = el.querySelector("svg");
			return {
				index: i,
				title: title.trim(),
				top: round(r.top),
				height: round(r.height),
				visible: r.bottom > box.top + 1 && r.top < box.bottom - 1,
				glyph: glyph ? glyph.getAttribute("class")?.split(" ").slice(0, 2).join(" ") : null,
			};
		}),
	};
})()`;

/** The sample's own identity, for change detection: order plus scrollTop. */
const stateKey = (sample) =>
	`${sample.scroller.scrollTop}|${sample.rows.map((r) => r.title).join(" | ")}`;

/** One decimal, the resolution every number this rig reports is read at. */
const round = (n) => Math.round(n * 10) / 10;

const main = async () => {
	const { STORIES: frameStories } = await import("./capture-evidence.mjs");
	const viewportFor = (story) => {
		const entry = frameStories.find(([id]) => id === story);
		// A story the sweep does not frame has no frame's layout to match, and
		// measuring it at a guessed size would be a number about this rig.
		if (!entry)
			throw new Error(`${story} is not in capture-evidence's STORIES`);
		return { width: entry[1], height: entry[2] };
	};
	const stories = ONLY
		? STORIES.filter((story) => story.includes(ONLY))
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

	const index = await fetch(`${ORIGIN}/index.json`).then((r) => r.json());
	const known = new Set(Object.keys(index.entries ?? {}));

	const results = [];
	for (const story of stories) {
		if (!known.has(story)) {
			throw new Error(
				`unknown story id ${story}. Check ${ORIGIN}/index.json - the ids come from the story's own title.`,
			);
		}
		const { width, height } = viewportFor(story);
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:localOperatorDark`,
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
		let stable = 0;
		let seen = 0;
		let resized = null;
		for (let i = 0; i < 60; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const count = result.value?.rows?.length ?? 0;
			if (process.env.RIG_DEBUG)
				console.error(
					"settle",
					i,
					"rows=",
					JSON.stringify(result.value?.rows?.length),
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
			await sleep(SAMPLE_MS);
		}
		if (resized === null) {
			throw new Error(
				`${story}: the list never settled on a row count, so the viewport could not be matched to the frame's. The story rendered no rows, or it kept changing them.`,
			);
		}
		/*
		 * Sample from the moment the story mounts, because the transition this
		 * measures is INSIDE the story's own play function: waiting for a settled
		 * page first would photograph the answer and never see the move. A sample
		 * whose scroller is not there yet is dropped rather than reported as a
		 * zero - `ready` is the container, not the page.
		 */
		const timeline = [];
		const started = Date.now();
		while (Date.now() - started < HORIZON_MS) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			if (result.value?.ready) {
				timeline.push({ t: Date.now() - started, ...result.value });
			}
			await sleep(SAMPLE_MS);
		}
		if (timeline.length === 0) {
			throw new Error(
				`${story}: no chat-list scroll container was ever found. The story did not render its rows, or the walk in PROBE stopped matching the tree it is measuring.`,
			);
		}
		/*
		 * The timeline, reduced to the changes. A sample is kept as a TRANSITION when
		 * either term moved, because the two are the claim: the order (did the row
		 * re-file) and `scrollTop` (did the viewport follow it).
		 */
		const transitions = [];
		let previousKey = null;
		for (const sample of timeline) {
			const key = stateKey(sample);
			if (key !== previousKey) {
				transitions.push({
					t: sample.t,
					scrollTop: sample.scroller.scrollTop,
					order: sample.rows.map((r) => r.title),
					ink: sample.rows.map((r) => r.glyph),
				});
			}
			previousKey = key;
		}
		const settled = timeline.at(-1);
		/*
		 * The re-file is the first sample whose row ORDER differs from the one before
		 * it - not from the run's first sample, because the story scrolls the panel
		 * before it delivers anything and that is not the transition being measured.
		 */
		const refileIndex = timeline.findIndex(
			(sample, index) =>
				index > 0 &&
				sample.rows.map((r) => r.title).join("|") !==
					timeline[index - 1].rows.map((r) => r.title).join("|"),
		);
		const before = refileIndex > 0 ? timeline[refileIndex - 1] : timeline[0];
		const after = settled;
		const order = (sample) => sample.rows.map((r) => r.title);
		const settledOrder = order(after).join("|");
		/*
		 * The other two halves of "no bouncing or jittering": a sample whose ORDER is
		 * neither the before nor the after one (a row passing through a position it
		 * does not end in), and a `scrollTop` that is neither the before nor the
		 * after one (the viewport part-way through a drag). Both are reported rather
		 * than asserted here - `--assert` pins the second, and the first is read off
		 * the transitions above.
		 */
		const intermediateOrders = timeline
			.filter((sample, index) => {
				if (index < refileIndex) return false;
				const seen = order(sample).join("|");
				return seen !== settledOrder && seen !== order(before).join("|");
			})
			.map((sample) => ({ t: sample.t, order: order(sample) }));
		const pitch = (() => {
			const tops = settled.rows.map((r) => r.top).sort((a, b) => a - b);
			const gaps = tops.slice(1).map((top, i) => round(top - tops[i]));
			const usual = gaps.filter((gap) => gap > 1).sort((a, b) => a - b);
			return usual.length ? usual[Math.floor(usual.length / 2)] : null;
		})();
		/*
		 * The re-filing row's travel, in rows, read from where it STARTS and where it
		 * ENDS rather than assumed: the story's roster decides both, and a rig that
		 * hard-coded "three rows" would keep reporting three for a roster that moved.
		 */
		const mover = (() => {
			const beforeOrder = order(before);
			const afterOrder = order(after);
			if (beforeOrder.length !== afterOrder.length) return null;
			/* The row that moved FURTHEST, not the first index where the two orders
			   differ: the re-filing row is the one whose slot changed most, and every
			   row between its old and new positions shifts by one as a side effect. */
			let found = null;
			for (const title of beforeOrder) {
				const from = beforeOrder.indexOf(title);
				const to = afterOrder.indexOf(title);
				if (to < 0) return null;
				const moved = Math.abs(to - from);
				if (moved > (found ? Math.abs(found.to - found.from) : 0)) {
					found = { title, from, to };
				}
			}
			return found;
		})();
		results.push({
			story,
			viewport: `${width}x${height}`,
			declaredHeight: height,
			shotHeight: resized,
			pageHeight: Math.max(...timeline.map((sample) => sample.pageHeight)),
			scroller: settled.scroller,
			samples: timeline.length,
			transitions,
			before: { t: before.t, scrollTop: before.scroller.scrollTop },
			after: { t: after.t, scrollTop: after.scroller.scrollTop },
			intermediateOrders,
			pitch,
			mover,
			/* The number the report is about: how far the viewport moved across the
			   re-file, against how far the row itself went. */
			viewportTravel: round(
				after.scroller.scrollTop - before.scroller.scrollTop,
			),
			rowTravelPx:
				mover && pitch ? round(Math.abs(mover.from - mover.to) * pitch) : null,
			roomBelowPx: round(
				settled.scroller.maxScrollTop - before.scroller.scrollTop,
			),
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
	} else {
		for (const result of results) {
			console.log(`\n${result.story}  @ ${result.viewport}  (${ORIGIN})`);
			const s = result.scroller;
			console.log(
				`  scroller        overflow-anchor=${s.overflowAnchor}  client=${s.clientHeight}  content=${s.scrollHeight}  maxScrollTop=${s.maxScrollTop}`,
			);
			console.log(
				`  samples         ${result.samples} over ${HORIZON_MS} ms (${SAMPLE_MS} ms apart)`,
			);
			console.log(
				`  viewport        declared ${result.declaredHeight} px, measured and sampled at ${result.shotHeight} px (what capture-evidence shoots at); page reports ${result.pageHeight} px`,
			);
			for (const transition of result.transitions) {
				console.log(
					`  t=${String(transition.t).padStart(4)} ms  scrollTop=${transition.scrollTop}  ${transition.order.join(" | ")}`,
				);
			}
			console.log(`  pitch           ${result.pitch} px per row`);
			if (result.mover) {
				console.log(
					`  re-filed        "${result.mover.title}"  index ${result.mover.from} -> ${result.mover.to}  (${result.rowTravelPx} px of travel)`,
				);
			}
			console.log(
				`  viewport        scrollTop ${result.before.scrollTop} (t=${result.before.t} ms) -> ${result.after.scrollTop} (t=${result.after.t} ms)`,
			);
			console.log(
				`  VIEWPORT TRAVEL ${result.viewportTravel} px across the re-file, against ${result.rowTravelPx} px of row travel`,
			);
			console.log(
				`  room below      ${result.roomBelowPx} px of content under the viewport (a drag is unclamped only while this exceeds the travel)`,
			);
			if (result.intermediateOrders.length > 0) {
				console.log(
					`  INTERMEDIATE ORDERS ${result.intermediateOrders.length} sample(s), first at t=${result.intermediateOrders[0].t} ms - a position that is neither the first nor the settled one. A story that re-files TWICE (the completion, and then the read receipt) shows its first move here by design; for the one-move stories this is a sample in a position no frame carries.`,
				);
			}
		}
	}
	/*
	 * The assertion is deliberately one row and not zero. A list that re-files a
	 * row redraws the rows below it in their new positions, and a container that
	 * holds its `scrollTop` still shifts them by one pitch relative to the
	 * viewport - that is the re-file being visible, not a defect. What the
	 * anchoring drag does is pay for the WHOLE travel instead, which is what this
	 * rejects.
	 */
	if (ASSERT) {
		const failures = results.filter(
			(result) =>
				result.pitch !== null &&
				Math.abs(result.viewportTravel) > result.pitch + 0.5,
		);
		for (const failure of failures) {
			console.error(
				`FAIL ${failure.story}: the viewport moved ${failure.viewportTravel} px while the row re-filed (limit: one ${failure.pitch} px row). The list container should hold its scroll position - see chat-sidebar.tsx's note on overflow-anchor.`,
			);
		}
		if (failures.length > 0) process.exitCode = 1;
		else
			console.log("\nOK: the viewport held its position across every re-file.");
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

export { PROBE, stateKey, STORIES };
