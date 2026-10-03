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
 *  - `prose`    the agent answer's rendered box: the `.lo-markdown` root that
 *               is NOT inside the user bubble, which is the block the cap and
 *               the centring used to act on. Deliberately not keyed on
 *               `.lo-measured` — see the selector comment further down, where
 *               the same distinction decides what the probe queries.
 *  - `toolRow`  the ledger row's box, the reference edge prose must match.
 *  - `glyph`    the tool icon column, the leftmost ink on a ledger row.
 *  - `content`  the row content box both of them live in — the
 *               `MessageContainer` interior, i.e. after the 40px avatar
 *               gutter. This is the box a correctly-aligned answer fills.
 *
 * `leftDelta` is prose.left - toolRow.left and `rightDelta` is
 * toolRow.right - prose.right. Both are zero when the two registers share an
 * edge; before this change they were 156.6 and 156.6 at 1024, which is the
 * defect. The same figure on both edges is what `margin-inline: auto` plus a
 * cap must produce — the centring splits the 313px the cap gives up evenly —
 * and the derivation is in the reading-measure comment in `markdown.css`,
 * which is the single place those numbers are argued.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

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
 *
 * AN ENTRY'S FOURTH ELEMENT IS ITS OPTIONS, and each option exists because a
 * claim needed it:
 *
 *  - `hover` is a selector the run moves a REAL pointer onto between the two
 *    measurements, so the idle and revealed boxes can be compared per story -
 *    the operator's 2026-10-01 no-shift claim ("the caption must NOT move
 *    when the buttons appear, and check the stamp too") is exactly a delta
 *    between those two states, and a frame cannot settle it.
 *  - `label` names the state in the printout when the story id alone would be
 *    ambiguous (a second width, a hover pass).
 *  - `ready` overrides the element the run waits for: transcript stories
 *    render `[data-lo-canonical-transcript]`, while the fold stories render
 *    the fold and no transcript.
 */
const STORIES = [
	["chat-tool-rows--prose-tool-alignment", 1024, 620],
	["chat-tool-rows--turn-boundary-and-working-line", 1024, 620],
	["chat-tool-rows--streaming-before-first-token", 1024, 620],
	/* The wide case, where a max-width cap leaves the most room on the table
	   and the asymmetry the operator saw is largest. */
	["chat-tool-rows--prose-tool-alignment", 1440, 900],
	/*
	 * THE ANSWER ACTION ROW'S OWN RAIL (#695), which is the one claim in that
	 * change a still cannot settle: the row sits at the ANSWER'S left edge, and
	 * "the same edge" is a number rather than an impression - a 0px and a 4px
	 * inset look equally plausible in a frame.
	 *
	 * THE FOOT LINE'S REARRANGEMENT (operator direction, 2026-10-01). The
	 * closing line has three reportable edges per state - the caption's, the
	 * actions' and the stamp's - and the operator's state is the one that
	 * paints all three at once: a turn that compacted mid-run keeps its foot
	 * (`compacted-run`), so the caption and the action row share the line. The
	 * hover entry moves a real pointer onto the answer (the group-hover
	 * reveal); the pair shows the caption and the stamp NOT moving while the
	 * buttons arrive, and `rest`/`bar-suppressed` keep the no-caption shapes
	 * measured the way they always were.
	 */
	["chat-canonical-message-actions--rest", 1024, 560],
	["chat-canonical-message-actions--bar-suppressed", 1024, 640],
	[
		"chat-canonical-message-actions--compacted-run",
		1024,
		640,
		{
			hover: '[data-record-id="a1"]',
			label: "chat-canonical-message-actions--compacted-run",
		},
	],
	/*
	 * THE FOLD SUMMARY LINE, AT BOTH WIDTHS (operator report, 2026-10-01): the
	 * standard column as one capped line, and the 640px window where that line
	 * WRAPS - the count line's box, its line count and its height are the
	 * numbers the frames' claim rides on.
	 */
	["chat-trace-fold--many-types", 1280, 130, { ready: "[data-fold-summary]" }],
	[
		"chat-trace-fold--many-types",
		640,
		130,
		{
			ready: "[data-fold-summary]",
			label: "chat-trace-fold--many-types (640px)",
		},
	],
	/*
	 * THE LONG KIND AS A KEPT UNIT, AT THE NARROWEST CELL (design round 1's D1
	 * ask, shot in round 2's remediation as D3 (with QA's Q-r2-3). This is the
	 * reading that says the units' guarantee holds where it matters: the summary's
	 * box and the row's last right edge at 420 with
	 * `1 workspace_get_gmail_thread_content` painted as a unit rather than folded
	 * into the tail - the only state where that token is visible at all.
	 */
	[
		"chat-trace-fold--many-types-kept",
		420,
		130,
		{
			ready: "[data-fold-summary]",
			label: "chat-trace-fold--many-types-kept (420px)",
		},
	],
	/*
	 * THE SMALL VIEW'S OWN TWO CELLS (design round 1, D2): the caption + controls
	 * line at `isSmallView`, where the rail is 32 rather than 107 - and the same
	 * window with the user turn on screen, so the user row's rail there is measured
	 * rather than inferred from the 1024px reading. Both name a story that PAINTS
	 * the small view (`isSmallView` is a prop, not a window width: the first cut of
	 * this entry pointed at the 1024px story at a 420px viewport and measured the
	 * wide layout clipped, which is the mistake this note exists to prevent).
	 */
	[
		"chat-canonical-message-actions--compacted-run-small",
		420,
		640,
		{
			label: "chat-canonical-message-actions--compacted-run-small (420px)",
			ready: "[data-lo-answer-actions]",
		},
	],
	[
		"chat-canonical-message-actions--narrow",
		420,
		620,
		{
			label: "chat-canonical-message-actions--narrow (420px)",
			ready: "[data-lo-user-actions]",
		},
	],
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
		/*
		 * `maxRetries` because SIGKILL returns before the kernel has finished
		 * reaping the process, and Chrome's profile keeps being written to for a
		 * few milliseconds after that — long enough that a plain recursive remove
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
		/*
		 * The answer's action row (#695): the toolbar's own box, its first button,
		 * and the stamp at the line's far end.
		 *
		 * 'actionsOffset' IS NOT A RAIL CLAIM, and reading it as one is the mistake
		 * this field's name now prevents (agent review round 1, R1-2): it is the
		 * distance from the prose's left edge to where the right cluster begins,
		 * and the 2026-10-01 rearrangement moves it to the far end by design
		 * ('726.6' where it used to be '0'). The rail claim is the CAPTION's -
		 * 'line.caption.left' against 'prose.left', two fields up - because a
		 * caption is the row's only left-anchored element.
		 */
		const actionsEl = scope.querySelector("[data-lo-answer-actions]");
		const actions = box(actionsEl);
		const firstButton = box(
			actionsEl ? actionsEl.querySelector("button") : null,
		);
		const actionsBox = actions
			? {
					toolbar: actions,
					firstButton,
					buttons: actionsEl.querySelectorAll("button").length,
					/*
					 * The row's wrapper is the line's first RIGHT-CLUSTER box since the
					 * 2026-10-01 rearrangement ('ml-auto flex shrink-0', inside
					 * 'canonical-transcript.tsx'): it is what pushes the buttons (and
					 * the stamp after them) to the far end, so its left edge is where
					 * the cluster begins.
					 */
					wrapper: box(actionsEl.parentElement ?? null),
					restInk: (() => {
						const b = actionsEl.querySelector("button");
						return b ? getComputedStyle(b).color : null;
					})(),
					actionsOffset: prose ? round(actions.left - prose.left) : null,
				}
			: null;
		/*
		 * THE USER TURN'S OWN ROW (design round 1, D2), which no frame in any set
		 * showed: 'Copy' alone, mounted from the user turn's column under the bubble
		 * rather than on a transcript line, so its rail is the BUBBLE's right edge
		 * and not the content's left. The operator's note asked about this surface
		 * explicitly, and a comment cannot settle a rail claim - so the bubble, the
		 * row and the delta between them are numbers here.
		 */
		const userActionsEl = scope.querySelector("[data-lo-user-actions]");
		const userRow = box(userActionsEl);
		const userBubble = box(
			userActionsEl ? userActionsEl.previousElementSibling : null,
		);
		const userActions =
			userRow && userActionsEl
				? {
						...userRow,
						firstButton: box(userActionsEl.querySelector("button")),
						buttons: userActionsEl.querySelectorAll("button").length,
						/*
						 * The toolbar's labels are the cheap proof that the USER row is Copy
						 * alone: a 'Speak aloud' appearing here would be a different row.
						 */
						labels: [...userActionsEl.querySelectorAll("button")].map((b) =>
							(b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
						),
						bubble: userBubble,
						bubbleDelta: userBubble
							? round(userBubble.right - userRow.right)
							: null,
					}
				: null;

		out.push({
			prose,
			toolRow,
			glyph: box(glyphEl),
			content,
			actions: actionsBox,
			userActions,
			line: (() => {
				/*
				 * The foot line the row rides: its box and height are what the
				 * accepted ~+20px per finished turn is a claim about. The anchor
				 * walks through the actions' own wrapper (see above) so the line
				 * resolves in both arrangements.
				 */
				const wrapper = actionsEl ? actionsEl.parentElement : null;
				const el =
					wrapper && String(wrapper.className).includes("ml-auto")
						? wrapper.parentElement
						: wrapper;
				const b = box(el);
				if (!b || !el) return null;
				/*
				 * The caption ('Worked for 1m 12s'): the line's first direct span
				 * whose text starts with the caption's own word. It is the edge the
				 * operator's report is about - it must sit on the content's left
				 * rail whatever the actions do - and it is only present on turns
				 * that keep their foot (a bar'd turn states the numbers itself).
				 */
				const caption = [...el.querySelectorAll(":scope > span")].find(
					(s) => (s.textContent ?? "").trimStart().startsWith("Worked"),
				);
				return {
					...b,
					height: round(el.getBoundingClientRect().height),
					caption: box(caption ?? null),
					captionHeight: caption
						? round(caption.getBoundingClientRect().height)
						: null,
					captionText: caption
						? (caption.textContent ?? "").trim().slice(0, 28)
						: null,
					stampLeft: (() => {
						const stamp = el.querySelector("time, [data-lo-turn-stamp]");
						const sb = box(stamp ?? null);
						return sb ? sb.left : null;
					})(),
				};
			})(),
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
	/*
	 * The fold header's count line ('data-fold-summary', 'trace-fold.tsx'), for
	 * the stories that render a fold and no transcript. 'lines' is the height
	 * read as line boxes: 1 for a line that fits, more once it wraps - the
	 * number the wrap fix's claim is about.
	 */
	const foldEl = document.querySelector("[data-fold-summary]");
	const fold = (() => {
		if (!foldEl) return null;
		const r = foldEl.getBoundingClientRect();
		const cs = getComputedStyle(foldEl);
		const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
		return {
			left: round(r.left),
			right: round(r.right),
			width: round(r.width),
			height: round(r.height),
			lineHeight: round(lh),
			lines: Math.max(1, Math.round(r.height / lh)),
			text: (foldEl.textContent ?? "").trim(),
			/*
			 * THE LINE THAT HOLDS IT, and its last child's right edge: the wrap
			 * claim is 'the line wraps rather than overflowing the container', and
			 * these two numbers are what 'overflowing' would look like - a last
			 * child ending past the line's own right edge.
			 */
			line: (() => {
				const parent = foldEl.parentElement;
				if (!parent) return null;
				const pr = parent.getBoundingClientRect();
				const kids = [...parent.children];
				const last = kids[kids.length - 1];
				return {
					left: round(pr.left),
					right: round(pr.right),
					width: round(pr.width),
					lastRight: last ? round(last.getBoundingClientRect().right) : null,
				};
			})(),
		};
	})();
	return { transcripts: out, fold };
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-geometry-${process.pid}`);
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
	for (const [story, width, height, options = {}] of STORIES) {
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
		 * Wait for the story to be MEASURABLE, which is three separate
		 * conditions and not one.
		 *
		 * Storybook's own "preparing" wrapper has to be gone: it renders inside an
		 * otherwise-ready document, so the transcript query below can pass while
		 * the visible page is still a loader. Fonts have to have resolved, because
		 * `ch` resolves against the loaded face and the cap this change removes
		 * was expressed in `ch` — a measurement taken against the fallback would
		 * be a number about this machine rather than about the product. And the
		 * transcript itself has to be in the DOM.
		 *
		 * Polled rather than slept on: a fixed delay long enough for a cold start
		 * is paid by every story, and a delay short enough to be cheap is the one
		 * that intermittently reports "no transcript rendered" for a story that
		 * renders perfectly well.
		 */
		let ready = false;
		for (let i = 0; i < 120 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector(${JSON.stringify(options.ready ?? "[data-lo-canonical-transcript]")});
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			throw new Error(
				`${story} @ ${width}x${height}: story never became measurable`,
			);
		}
		/* One settled frame after layout, so the rects are post-reflow. */
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});
		/*
		 * ONE PASS PER STATE. `measure` reads the probe and pushes the reading
		 * under the state's name; the idle pass always runs, and a story with a
		 * `hover` option runs a second pass after a REAL pointer move onto the
		 * selector (the same input path `capture-evidence.mjs`'s hover entries
		 * use), settled past the reveal's own transition.
		 */
		const measure = async (state, label) => {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const value = result.value;
			const hasTranscripts = (value?.transcripts?.length ?? 0) > 0;
			if (!hasTranscripts && (value?.fold ?? null) === null) {
				throw new Error(
					`${story} @ ${width}x${height}: nothing measurable rendered ${JSON.stringify(result)}`,
				);
			}
			results.push({
				story: label,
				state,
				viewport: `${width}x${height}`,
				frames: value.transcripts ?? [],
				fold: value.fold ?? null,
			});
		};
		await measure("idle", options.label ?? story);
		if (options.hover) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const el = document.querySelector(${JSON.stringify(options.hover)});
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
				})()`,
			});
			const point = result.value;
			if (!point) {
				throw new Error(
					`${story} @ ${width}x${height}: hover selector matched nothing: ${options.hover}`,
				);
			}
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: point.x,
				y: point.y,
			});
			/* Past the reveal's 150ms opacity transition, so both states settle. */
			await sleep(300);
			await measure("hover", `${options.label ?? story} (hover)`);
		}
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const { story, state, viewport, frames, fold } of results) {
		console.log(`\n${story}  [${state}]  @ ${viewport}  (${ORIGIN})`);
		if (fold) {
			console.log(
				`  fold summary  left=${fold.left}  right=${fold.right}  width=${fold.width}  height=${fold.height}  lines=${fold.lines} (lh ${fold.lineHeight})`,
			);
			if (fold.line)
				console.log(
					`    line        left=${fold.line.left}  right=${fold.line.right}  width=${fold.line.width}  lastRight=${fold.line.lastRight}`,
				);
			console.log(`    text        "${fold.text}"`);
		}
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
			if (f.line) {
				console.log(
					`    foot line     left=${f.line.left}  right=${f.line.right}  height=${f.line.height}`,
				);
				console.log(
					`    caption       ${f.line.caption ? `left=${f.line.caption.left}  right=${f.line.caption.right}  "${f.line.captionText}"` : "none on this line"}`,
				);
				console.log(`    stamp         left=${f.line.stampLeft}`);
			}
			if (f.actions) {
				console.log(
					`    actions       wrapper.left=${f.actions.wrapper?.left ?? "?"}  toolbar.left=${f.actions.toolbar.left}  firstButton.left=${f.actions.firstButton?.left ?? "?"}  buttons=${f.actions.buttons}  actionsOffset=${f.actions.actionsOffset}`,
				);
			}
			if (f.userActions) {
				console.log(
					`    user row      left=${f.userActions.left}  right=${f.userActions.right}  firstButton.left=${f.userActions.firstButton?.left ?? "?"}  buttons=${f.userActions.buttons} [${f.userActions.labels.join(", ")}]  bubble.right=${f.userActions.bubble?.right ?? "?"}  bubbleDelta=${f.userActions.bubbleDelta ?? "?"}`,
				);
			}
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
