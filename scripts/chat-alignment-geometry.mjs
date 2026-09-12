#!/usr/bin/env node
/**
 * Measures the transcript's horizontal geometry from the live DOM.
 *
 *     node scripts/chat-alignment-geometry.mjs [storybook-origin] [--json]
 *
 * The operator's report about agent prose being "not the same width in the
 * view as the tool calls" is a claim about EDGES, and a screenshot cannot
 * settle it: a 40px inset and a 140px one look equally plausible in a still,
 * and the reviewer has no way to check the paragraph describing them. So the
 * numbers come from `getBoundingClientRect` in the same rendered state the
 * evidence frames are taken from, and this file is the command that produces
 * them — a reviewer re-runs it rather than trusting a table someone typed.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` (fresh user-data-dir under /tmp, killed on exit, no
 * browser-automation dependency added to the repo). Duplicating that driver
 * here rather than importing it is the smaller evil: that file's loop is built
 * around writing one webp per theme per story, and threading a "measure
 * instead of shoot" mode through it would complicate the evidence sweep — the
 * one script in this repo that must stay boring — for the benefit of a probe.
 *
 * What it reports per story, all in CSS pixels at the stated viewport:
 *
 *  - `prose`    the agent answer's rendered box (`.lo-markdown` under
 *               `.lo-measured`), which is the block the cap and the centring
 *               act on.
 *  - `toolRow`  the ledger row's box, the reference edge prose must match.
 *  - `glyph`    the tool icon column, the leftmost ink on a ledger row.
 *  - `content`  the row content box both of them live in — the
 *               `MessageContainer` interior, i.e. after the 40px avatar
 *               gutter. This is the box a correctly-aligned answer fills.
 *
 * `leftDelta` is prose.left - toolRow.left and `rightDelta` is
 * toolRow.right - prose.right. Both are zero when the two registers share an
 * edge; before this change they were 20 and 265 at 1024, which is the defect.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The states the two defects live in, with the viewport each is judged at.
 *
 * The viewports match `capture-evidence.mjs`'s entries for the same stories,
 * so a number here and a frame there describe one layout rather than two. The
 * cap only BINDS on a column wider than ~550px, so measuring the defect at a
 * narrow viewport would report it as absent.
 */
const STORIES = [
	["chat-tool-rows--prose-tool-alignment", 1024, 620],
	["chat-tool-rows--turn-boundary-and-working-line", 1024, 620],
	["chat-tool-rows--streaming-before-first-token", 1024, 620],
	/* The wide case, where a max-width cap leaves the most room on the table
	   and the asymmetry the operator saw is largest. */
	["chat-tool-rows--prose-tool-alignment", 1440, 900],
];

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
		rmSync(dataDir, { recursive: true, force: true });
		dataDir = null;
	}
};

/**
 * The measurement, evaluated in the page.
 *
 * Written as a string handed to `Runtime.evaluate` rather than as a function
 * serialised across, so what runs in the browser is exactly what is read here.
 * No backticks below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), width: round(r.width) };
	};

	/* Every transcript on the page: the spacing story mounts three. */
	const transcripts = [...document.querySelectorAll("[data-lo-canonical-transcript]")];
	const out = [];
	for (const scope of transcripts) {
		/* The agent answer.
		   Selected as "a rendered markdown root that is not inside the user
		   bubble", NOT by the measure class: the whole point of the change is
		   that agent prose no longer carries .lo-measured, so keying on it would
		   silently report the fixed state as having no prose at all. The user
		   bubble is the only .lo-markdown inside a rounded frame. */
		const proseEl = [...scope.querySelectorAll(".lo-markdown")].find(
			(el) => !el.closest(".rounded-frame"),
		);
		/* The ledger row. Tailwind writes the container class literally, so this
		   is the row root rather than a span inside it. */
		const toolEl = scope.querySelector('[class*="toolrow"]');
		/* Leftmost ink on that row: the tool icon's own column. */
		const glyphEl = toolEl ? toolEl.querySelector(".size-3\\\\.5") : null;
		/* The box both registers live in - MessageContainer's interior, i.e.
		   inside the 40px avatar gutter. Measured from the prose row when there
		   is one, else from the tool row, since they share the container. */
		const anchor = proseEl ?? toolEl;
		const containerEl = anchor
			? anchor.closest("[class*='pl-10']") ?? anchor.parentElement
			: null;
		let content = null;
		if (containerEl) {
			const r = containerEl.getBoundingClientRect();
			const cs = getComputedStyle(containerEl);
			content = {
				left: round(r.left + Number.parseFloat(cs.paddingLeft)),
				right: round(r.right - Number.parseFloat(cs.paddingRight)),
				gutterPx: round(Number.parseFloat(cs.paddingLeft)),
			};
		}

		const prose = box(proseEl);
		const toolRow = box(toolEl);
		out.push({
			prose,
			toolRow,
			glyph: box(glyphEl),
			content,
			/* The two numbers the report is about. */
			leftDelta: prose && toolRow ? round(prose.left - toolRow.left) : null,
			rightDelta: prose && toolRow ? round(toolRow.right - prose.right) : null,
			/* Does the transcript paint a "Writing" row? Defect 2's assertion,
			   read from rendered text rather than from the record list. */
			writingRow: [...scope.querySelectorAll("span")].some(
				(el) => el.textContent.trim() === "Writing",
			),
			/* The working line must still be present while the model is thinking:
			   removing the row must not remove the liveness signal. */
			workingLine: (() => {
				const el = scope.querySelector("[data-lo-working-line]");
				return el ? el.innerText.replace(/\\s+/g, " ").trim() : null;
			})(),
			proseText: proseEl ? proseEl.innerText.slice(0, 48) : null,
		});
	}
	return out;
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-geometry-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(CHROME, [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]);

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
	for (const [story, width, height] of STORIES) {
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
		/* Fonts decide `ch`, and `ch` decided the cap that is being removed, so a
		   measurement taken against the fallback face would be a number about
		   this machine rather than about the product. */
		for (let i = 0; i < 60; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `document.fonts.status === "loaded" && !!document.querySelector("[data-lo-canonical-transcript]")`,
			});
			if (result.value) break;
			await sleep(150);
		}
		await sleep(400);
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: PROBE,
		});
		if (!Array.isArray(result.value) || result.value.length === 0) {
			throw new Error(
				`${story} @ ${width}x${height}: no transcript rendered ${JSON.stringify(result)}`,
			);
		}
		results.push({
			story,
			viewport: `${width}x${height}`,
			frames: result.value,
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const { story, viewport, frames } of results) {
		console.log(`\n${story}  @ ${viewport}  (${ORIGIN})`);
		frames.forEach((f, i) => {
			const label = f.proseText
				? `"${f.proseText.split("\n")[0]}"`
				: "(no prose)";
			console.log(`  frame ${i}  ${label}`);
			if (f.content)
				console.log(
					`    content box   left=${f.content.left}  right=${f.content.right}  gutter=${f.content.gutterPx}`,
				);
			if (f.toolRow)
				console.log(
					`    tool row      left=${f.toolRow.left}  right=${f.toolRow.right}  width=${f.toolRow.width}`,
				);
			if (f.glyph)
				console.log(
					`    glyph column  left=${f.glyph.left}  right=${f.glyph.right}  width=${f.glyph.width}`,
				);
			if (f.prose)
				console.log(
					`    agent prose   left=${f.prose.left}  right=${f.prose.right}  width=${f.prose.width}`,
				);
			if (f.leftDelta !== null)
				console.log(
					`    DELTA         left=${f.leftDelta}  right=${f.rightDelta}`,
				);
			console.log(
				`    writingRow=${f.writingRow}  workingLine=${f.workingLine === null ? "none" : `"${f.workingLine}"`}`,
			);
		});
	}
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

main()
	.then(() => teardown())
	.catch((error) => {
		teardown();
		console.error(error);
		process.exit(1);
	});
