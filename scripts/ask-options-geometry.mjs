#!/usr/bin/env node
/**
 * Measures the ask dock's option rows, and insists they do not intersect.
 *
 *     node scripts/ask-options-geometry.mjs [storybook-origin] [--json]
 *
 * THE CLAIM THIS EXISTS FOR is a claim about pixels, and it is the one issue
 * #762 was filed on: an option whose description wraps to a second line must
 * make its ROW taller, or the next row's ordinal and label land on top of the
 * description — and with a full nine-option list the collisions cascade until
 * the first option's label row is unreadable. A frame shows the overprint but
 * cannot say by how much, and a row that is 12px too short looks, in a still,
 * exactly like a row that is right — so the numbers come from
 * `getBoundingClientRect` in the same rendered state the evidence frames are
 * taken from, and this file is the command that produces them: a reviewer
 * re-runs it rather than trusting a table.
 *
 * WHAT IT REPORTS, per story and theme, all in CSS pixels:
 *
 *  - `row`         each option row's box, top to bottom.
 *  - `body`        the label column's box and its bottom edge against the
 *                  row's — `body.bottom > row.bottom` is the row failing to
 *                  include the wrapped description, i.e. the #762 defect.
 *  - `overprint`   each column's bottom against the NEXT row's top; a positive
 *                  number is the wrapped description painting into the box of
 *                  the row below it, which is what the reporter's screenshot
 *                  shows (the row boxes themselves do not intersect pre-fix —
 *                  it is the CONTENT that overflows a too-short box).
 *  - `ordinal`     the keycap's box, and its centre against the label's own
 *                  FIRST line box. The box is built from the label's computed
 *                  line-height rather than from a Range rect: a Range rect is
 *                  the inline box from font metrics (measured 16px) while the
 *                  keycap has to match the leaded line box (19.5px).
 *
 * AND IT JUDGES, IT DOES NOT ONLY PRINT, for the reason
 * `header-cluster-geometry.mjs` states: a table nobody compares against
 * anything exits 0. Four properties are asserted on every state, and any
 * failure exits non-zero naming the rows:
 *
 *  1. every row's box CONTAINS its label column (the #762 regression itself);
 *  2. no row's column overprints the next row's box (the same defect, seen
 *     from the row below);
 *  3. no two option row boxes intersect;
 *  4. every ordinal sits on the label column's first line — its own line box
 *     matches that line's, and its centre is inside it.
 *
 * THE PIN'S OWN PROOF is a pair of runs, not a green one: this command FAILS
 * on the pre-fix component (`items-baseline` on the row) and passes after, and
 * both runs ride with the PR that fixes #762. The `wrapped-density` story it
 * measures exists in `ask-options.stories.tsx` for exactly that pair.
 *
 * Raw CDP against a private headless Chrome, the same approach as
 * `capture-evidence.mjs`, `credential-chip-geometry.mjs` and
 * `chat-alignment-geometry.mjs` (fresh user-data-dir under /tmp, the
 * mock-keychain switch `./chrome-keychain.mjs` owns so no prompt can reach the
 * operator's screen, killed on exit, no browser-automation dependency added to
 * the repo). The driver is duplicated rather than imported for the reason the
 * alignment rig states: the sweep writes one webp per theme per story, and
 * threading a "measure instead of shoot" mode through it would complicate the
 * one script in this repo that must stay boring.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6018";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The states measured, and what each is for. Every viewport matches the
 * capture entry `scripts/capture-evidence.mjs` sweeps for the same story, so a
 * number here and a frame there describe one layout rather than two.
 *
 *  - `wrapped-density` is THE PIN: nine options, every description wrapping.
 *  - `wrapping-labels` is the same question one step milder — two options,
 *    both label and description long enough to wrap.
 *  - `many-options` is the DENSITY CONTROL: eight options with single-line
 *    descriptions. It is the rung that must stay clean at head - not a state
 *    the defect spares, since it fails pre-fix too (23 findings per theme:
 *    eight rows at 44.75px against 57px, the same flex compression, because
 *    the list is over the 380px cap as well). It is the case a fix that
 *    over-corrected (e.g. a row height pinned to something arbitrary) would
 *    visibly move.
 */
const STATES = [
	["chat-ask-options--wrapped-density", 1024, 620, 9],
	["chat-ask-options--wrapping-labels", 1024, 620, 2],
	["chat-ask-options--many-options", 1024, 620, 8],
];

/**
 * The two brand palettes. The geometry is type-driven rather than theme-driven,
 * but these are the two palettes every frame in this repository's evidence sets
 * is taken at, and a measurement is cheap here where a sweep of all twelve
 * would not be.
 */
const THEMES = ["localOperatorLight", "localOperatorDark"];

/** Sub-pixel tolerance: layout rounds to 1/64 px and rects to 2 decimal places. */
const TOL = 0.5;

/** Chrome's own line naming the debugging endpoint, at the top level because
 * `useTopLevelRegex` is a lint rule here and a literal built per call is the
 * shape it exists to stop. */
const DEBUG_PORT = /DevTools listening on (ws:\/\/[^\s]+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
		// Retried: `SIGKILL` returns before the kernel reaps the process and
		// Chrome's profile keeps being written for a few milliseconds after it,
		// which turns a successful measurement into an ENOTEMPTY out of the
		// `finally` — a complete run that reads as a failed one.
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
 * The measurement, evaluated in the page. A string handed to
 * `Runtime.evaluate` rather than a function serialised across, so what runs in
 * the browser is exactly what is read here. No backticks below: the whole
 * thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 100) / 100;
	const box = (r) => ({
		top: round(r.top),
		bottom: round(r.bottom),
		left: round(r.left),
		right: round(r.right),
		width: round(r.width),
		height: round(r.height),
	});
	const rows = [...document.querySelectorAll("button[data-ask-option]")];
	if (rows.length === 0) return { error: "no option rows rendered" };
	const entries = rows.map((row, index) => {
		const body = row.lastElementChild;
		const bodyRect = body ? body.getBoundingClientRect() : null;
		const labelRow = body ? body.firstElementChild : null;
		const label = labelRow ? labelRow.firstElementChild : null;
		/*
		 * The label's own FIRST line box: its top is the column's top (the label
		 * opens the column) and its height is the label's OWN computed line-height
		 * (text-body-sm at its own leading). The rect is built from those two
		 * numbers rather than from a one-character Range, because a Range rect in
		 * Chrome is the inline box from font metrics (measured 16px here) while the
		 * box the keycap has to match is the leaded line box - the keycap's own
		 * line box is asserted against this number, so the choice is load-bearing.
		 */
		let firstLine = null;
		let labelLineHeight = null;
		const textNode = label ? label.firstChild : null;
		if (bodyRect && label && textNode && textNode.nodeType === 3) {
			const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
			if (Number.isFinite(lineHeight)) {
				labelLineHeight = round(lineHeight);
				firstLine = {
					top: round(bodyRect.top),
					bottom: round(bodyRect.top + lineHeight),
					left: round(bodyRect.left),
					right: round(bodyRect.right),
					width: round(bodyRect.width),
					height: round(lineHeight),
				};
			}
		}
		const ordinal = row.firstElementChild;
		return {
			index: index + 1,
			row: box(row.getBoundingClientRect()),
			body: bodyRect ? box(bodyRect) : null,
			ordinal: ordinal ? box(ordinal.getBoundingClientRect()) : null,
			/*
			 * Rows past nine carry an EMPTY spacer in the ordinal column (the app's
			 * own honesty rule - a tenth key cannot be pressed), so there is no
			 * numeral to place. The spacer is still measured so the column widths
			 * line up in the report.
			 */
			ordinalIsSpacer: index >= 9,
			description:
				body && body.lastElementChild && body.lastElementChild !== labelRow
					? box(body.lastElementChild.getBoundingClientRect())
					: null,
			firstLine,
			labelLineHeight,
		};
	});
	return { count: rows.length, entries };
})()`;

/**
 * Judge one probe result, and return the findings rather than printing them so
 * the caller decides how a failure is reported.
 */
const judge = ({ count, entries }, expected) => {
	const failures = [];
	if (count !== expected) {
		failures.push(`expected ${expected} option rows, measured ${count}`);
	}
	for (const e of entries) {
		if (!e.body) {
			failures.push(`row ${e.index}: no label column`);
			continue;
		}
		if (e.body.bottom > e.row.bottom + TOL) {
			failures.push(
				`row ${e.index}: the label column ends at ${e.body.bottom} but the row box ends at ${e.row.bottom} — the row does not include its wrapped description (${round2(e.body.bottom - e.row.bottom)}px of overprint)`,
			);
		}
		if (
			e.body.left < e.row.left - TOL ||
			e.body.right > e.row.right + TOL ||
			e.body.top < e.row.top - TOL
		) {
			failures.push(
				`row ${e.index}: the label column (${JSON.stringify(e.body)}) is not inside its row (${JSON.stringify(e.row)})`,
			);
		}
	}
	/*
	 * AND THE OVERPRINT ITSELF, row against next row: the defect #762 is about is
	 * the wrapped description of one row painting into the box of the next, so
	 * each column's own bottom is checked against the next row's top. That is NOT
	 * the same question as "do the row boxes intersect" below - pre-fix they do
	 * not, because it is the CONTENT that overflows a too-short box - and it is
	 * the one the reporter's screenshot shows.
	 */
	for (let i = 0; i + 1 < entries.length; i++) {
		const a = entries[i];
		const b = entries[i + 1];
		if (a.body && b.row && a.body.bottom > b.row.top + TOL) {
			failures.push(
				`rows ${i + 1} and ${i + 2}: the label column of row ${i + 1} overprints row ${i + 2} (column ends at ${a.body.bottom}, the next row starts at ${b.row.top} — ${round2(a.body.bottom - b.row.top)}px of overprint)`,
			);
		}
	}
	for (let i = 0; i < entries.length; i++) {
		for (let j = i + 1; j < entries.length; j++) {
			const a = entries[i].row;
			const b = entries[j].row;
			const overlaps =
				a.left < b.right - TOL &&
				b.left < a.right - TOL &&
				a.top < b.bottom - TOL &&
				b.top < a.bottom - TOL;
			if (overlaps) {
				failures.push(
					`rows ${i + 1} and ${j + 1} intersect: row ${i + 1} spans ${a.top}..${a.bottom}, row ${j + 1} starts at ${b.top} (${round2(a.bottom - b.top)}px of overlap)`,
				);
			}
		}
	}
	for (const e of entries) {
		if (!e.ordinal || !e.firstLine || e.ordinalIsSpacer) continue;
		const centre = (e.ordinal.top + e.ordinal.bottom) / 2;
		if (centre < e.firstLine.top - 1 || centre > e.firstLine.bottom + 1) {
			failures.push(
				`row ${e.index}: the ordinal centres at ${round2(centre)} against the label's first line ${e.firstLine.top}..${e.firstLine.bottom} — the keycap left the first line`,
			);
		}
		/*
		 * And the keycap's line box IS the label's first line box — the other half
		 * of the fix. If the ordinal's `leading` derivation ever stops applying
		 * (a className that no longer compiles, a moved type token), the numeral
		 * drops ~2px without leaving the vertical centre window above; this
		 * measures the box itself rather than its position.
		 */
		const ordinalBox = e.ordinal.bottom - e.ordinal.top;
		const firstLineBox =
			e.labelLineHeight ??
			(e.firstLine ? e.firstLine.bottom - e.firstLine.top : null);
		if (firstLineBox !== null && Math.abs(ordinalBox - firstLineBox) > 1) {
			failures.push(
				`row ${e.index}: the ordinal's line box is ${round2(ordinalBox)}px against the label's first line box ${round2(firstLineBox)}px — the keycap's leading no longer matches the label's first line`,
			);
		}
	}
	return failures;
};

const round2 = (n) => Math.round(n * 100) / 100;

const main = async () => {
	dataDir = join(tmpdir(), `lo-ask-options-geometry-${process.pid}`);
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
			const m = buf.match(DEBUG_PORT);
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

	const results = [];
	const allFailures = [];
	for (const [story, width, height, expected] of STATES) {
		for (const theme of THEMES) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
			});
			/*
			 * Ready means three things and not one, for the reason the sibling
			 * rigs give: Storybook's "preparing" wrapper can sit inside an
			 * otherwise-ready document, fonts decide what the glyphs measure, and
			 * the rows themselves have to be in the DOM — every expected row of
			 * them, because a probe that measured three rows of nine would report
			 * a clean intersection while the story it names was not on screen.
			 */
			let ready = false;
			for (let i = 0; i < 160 && !ready; i++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const loading = [...document.querySelectorAll(
							".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
						)].some((el) => el.getBoundingClientRect().height > 0);
						if (loading) return false;
						if (document.fonts.status !== "loaded") return false;
						return document.querySelectorAll("button[data-ask-option]").length >= ${expected};
					})()`,
				});
				ready = result.value === true;
				if (!ready) await sleep(250);
			}
			if (!ready) {
				throw new Error(
					`${story} @ ${width}x${height} (${theme}): fewer than ${expected} option rows ever rendered`,
				);
			}
			/* One settled frame after layout, so the rects are post-reflow. */
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			if (result.value?.error) {
				throw new Error(
					`${story} @ ${width}x${height} (${theme}): ${result.value.error}`,
				);
			}
			const failures = judge(result.value, expected);
			allFailures.push(
				...failures.map(
					(f) => `${story} @ ${width}x${height} (${theme}): ${f}`,
				),
			);
			results.push({
				story,
				viewport: `${width}x${height}`,
				theme,
				...result.value,
				failures,
			});
		}
	}

	if (AS_JSON) {
		console.log(
			JSON.stringify(
				{ origin: ORIGIN, results, failures: allFailures },
				null,
				2,
			),
		);
		if (allFailures.length > 0) {
			throw new Error(`${allFailures.length} finding(s); see the JSON above`);
		}
		return;
	}

	for (const entry of results) {
		console.log(
			`\n${entry.story}  @ ${entry.viewport}  (${entry.theme}; ${ORIGIN})`,
		);
		console.log(
			"  #   row top..bottom      h      body bottom   fits   gap-to-next   ordinal centre",
		);
		entry.entries.forEach((e, i) => {
			const next = entry.entries[i + 1];
			const gap = next ? round2(next.row.top - e.row.bottom) : null;
			const fits = e.body && e.body.bottom <= e.row.bottom + TOL ? "yes" : "NO";
			const centre =
				e.ordinal && !e.ordinalIsSpacer
					? round2((e.ordinal.top + e.ordinal.bottom) / 2)
					: "—";
			console.log(
				`  ${String(e.index).padStart(2)}  ${String(e.row.top).padStart(7)}..${String(e.row.bottom).padEnd(9)}` +
					`${String(e.row.height).padStart(6)}  ${String(e.body?.bottom).padStart(12)}` +
					`   ${fits.padEnd(5)}  ${String(gap ?? "—").padStart(11)}   ${String(centre).padStart(13)}`,
			);
		});
		const overprints = entry.failures.filter((f) =>
			f.includes("overprints row"),
		).length;
		const intersections = entry.failures.filter((f) =>
			f.includes("intersect"),
		).length;
		console.log(
			entry.failures.length === 0
				? `  PASS — ${entry.count} rows, no overprint, no intersections, every row contains its column`
				: `  FAIL — ${entry.failures.length} finding(s): ${overprints} overprint(s), ${intersections} intersection(s), ${entry.failures.length - overprints - intersections} other`,
		);
	}

	if (allFailures.length > 0) {
		throw new Error(
			`${allFailures.length} finding(s):\n${allFailures.map((f) => `  - ${f}`).join("\n")}`,
		);
	}
	console.log(
		"\nAll measured states pass. (#762: every row box holds its wrapped description — no compression, no overprint.)",
	);
};

main()
	.then(() => {
		teardown();
	})
	.catch((error) => {
		teardown();
		console.error(error.message);
		process.exit(1);
	});
