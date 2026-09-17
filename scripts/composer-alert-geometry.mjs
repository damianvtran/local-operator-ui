#!/usr/bin/env node
/**
 * Measures — and asserts — the composer's alert region's geometry at a narrow
 * column, from the live DOM.
 *
 *     node scripts/composer-alert-geometry.mjs [--json] [--out=<dir>]
 *
 * Why this file exists. Design round 4's D12 is a claim about what SURVIVES the
 * alert's own cap: its PROSE block renders `max-h-[7.5rem]` with
 * `overflow-y-auto`, the cap is load-bearing (it is what keeps the composer's top
 * border and the send control on screen, measured at CSS y=540 at 892px in the
 * 1-line, 3-line and 4-line states alike), and it is therefore the ORDER of the
 * block's children that decides what a user can read without discovering a thin
 * internal scrollbar. At the column the canvas pane leaves at a 1440px window,
 * the block was 388px of content in a 120px window: the muted notice's seven
 * wrapped lines filled the window on their own and the sentence naming the file
 * that failed — and the remedy for it — began at offset 144, entirely below the
 * fold. UX round 1's U3 then found the cap's other edge: the remedy CONTROLS
 * were the next child after the state, so a long enough alert scrolled them out
 * of the window too, and the region was measured at the app's own minimum window
 * with both controls ~90px below the visible area. They now live outside the cap,
 * and the assertions below check that structure as well as the order.
 *
 * A number is the only instrument for that claim, and it has to come from a real
 * render: a still shows the symptom and cannot be checked against the sentence
 * describing it, and a unit test cannot lay out `max-h` at all. So this drives
 * `scripts/composer-alert-geometry.html` — the SHIPPED `MessageInput` in the
 * state D12 is about, at a chosen column width — over raw CDP against a private
 * headless Chrome, the same approach as `capture-evidence.mjs` and
 * `chat-alignment-geometry.mjs`: a fresh user-data-dir under /tmp, killed on
 * exit, and no browser-automation dependency added to the repo. The page is
 * built and served by `vite` in-process over `composer-alert-geometry.vite.mjs`.
 *
 * The widths are the three the round was measured at: 892 (the column at a
 * 1440px window with the sidebars, where the region grew from one sentence to
 * two), 472 (both sentences present and the block already 152px in a 120px
 * window) and 172 (a 1440px window with the canvas pane open — the narrowest
 * width reachable in the app, since drag-to-resize is not something the browser
 * tool can do). The assertions are stated in `assertions` below; each one names
 * the finding it pins, and every measurement is printed whether it passes or
 * not, because the numbers are what a reviewer reads.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes("--json");
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(tmpdir(), "composer-alert-geometry");
const PORT = Number(flag("port") ?? 5429);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** The window the app was measured in: 1440x817 CSS, the designer's frame. */
const VIEWPORT = { width: 1440, height: 817 };

/**
 * The columns, and the states each is measured in.
 *
 * `split` is the two-sentence state: the unreadable-attachment refusal with a
 * split adoption under it. `unreadable` is the one-sentence state the cap was
 * written for, and `idle` is the baseline the composer's own border is compared
 * against at every width.
 */
const ONLY = flag("only");

const CASES = [
	{ column: 892, states: ["idle", "unreadable", "split"] },
	{ column: 472, states: ["idle", "unreadable", "split"] },
	{ column: 172, states: ["idle", "unreadable", "split"] },
];

/*
 * WHICH STATES THE BORDER INVARIANT CAN BE MEASURED BETWEEN.
 *
 * The composer's border is the ALERT's budget, not the draft's: the band is
 * bottom-anchored, so the region grows upward into the transcript. A draft that
 * is itself taller (the `split` state carries a chip row and restored text)
 * lifts the border on its own, which is the composer behaving correctly and has
 * nothing to do with the region. So the comparison is `idle` against a state
 * with the SAME draft and a different alert: `unreadable`, which holds the one
 * sentence the cap was written for, and which at 172px is long enough to hit the
 * cap itself.
 */
const BORDER_BASELINE = { unreadable: "idle" };

const THEME = flag("theme") ?? "localOperatorDark";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		/*
		 * Page-side console output and uncaught exceptions, kept for the failure
		 * message: a module that evaluates and then throws inside a React render
		 * leaves an empty document and no JS error in this process, so the only
		 * place that failure exists is the page's own console.
		 */
		this.log = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method === "Runtime.exceptionThrown") {
				this.log.push(
					msg.params.exceptionDetails.exception?.description ??
						msg.params.exceptionDetails.text,
				);
			} else if (msg.method === "Runtime.consoleAPICalled") {
				this.log.push(
					`${msg.params.type}: ${msg.params.args
						.map((a) => a.description ?? a.value ?? a.type)
						.join(" ")}`,
				);
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
 * The measurement, evaluated in the page.
 *
 * Read off the DOM rather than off any of the app's own abstractions: the
 * question is what a person looking at these pixels can read, so the region's
 * own client box is the window and each child's rect is the content. The failure
 * is identified by the class the composer gives it (`font-medium` is the alert's
 * ranking device — see its own note on why weight and an icon, not hue), and the
 * muted context by `text-ink-muted`, so neither identification depends on the
 * copy, which is expected to be reworded.
 *
 * No backticks below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		const r = el.getBoundingClientRect();
		return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), height: round(r.height) };
	};
	/*
	 * The composer's own box first, because it is measured in EVERY state
	 * including the ones with no alert at all: the cap's invariant is that this
	 * edge and the send control do not move when the region fills, and an
	 * invariant needs the baseline it is compared against. The box is found by
	 * walking up from the textarea to the first ancestor that draws a border,
	 * which is the boundary control the region is aligned to.
	 */
	const textarea = document.querySelector("textarea");
	let box = textarea;
	while (box && getComputedStyle(box).borderTopWidth === "0px") box = box.parentElement;
	const region = document.querySelector('[role="alert"]');
	const base = {
		present: !!region,
		theme: document.documentElement.dataset.theme,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		composerBoxTop: box ? round(box.getBoundingClientRect().top) : null,
		send: null,
		region: null,
		children: [],
		controls: null,
		failureText: null,
		failureIndex: null,
		failureVisibleLines: null,
		failureLines: null,
		failureWholeVisible: null,
		noticeIndex: null,
		// The tiles in the composer's chip row, by the control each one carries.
		// Part of the state under test: the split this harness renders exists only
		// because the row already holds a file of the user's own.
		chips: [...document.querySelectorAll("button")].filter((b) =>
			/remove attachment/i.test(b.getAttribute("aria-label") ?? ""),
		).length,
	};
	if (!region) return base;
	const rr = region.getBoundingClientRect();
	const regionStyle = getComputedStyle(region);
	/*
	 * WHICH ELEMENT IS THE WINDOW, read off the layout rather than named: the
	 * region's capped PROSE block is its child that scrolls (UX round 1, U3 moved
	 * the cap one level in so the remedy controls could sit outside it). Everything
	 * this file used to measure against the region - how many lines of the failure
	 * are visible, how much content there is - is a question about THAT box, and
	 * the region's own box is now prose plus the pinned controls.
	 */
	const capped = [...region.children].find(
		(el) => getComputedStyle(el).overflowY === "auto",
	) ?? region;
	const cr = capped.getBoundingClientRect();
	const cappedStyle = getComputedStyle(capped);
	const regionBox = {
		top: round(cr.top),
		bottom: round(cr.bottom),
		height: round(cr.height),
		clientHeight: capped.clientHeight,
		scrollHeight: capped.scrollHeight,
		scrollTop: capped.scrollTop,
		overflowY: cappedStyle.overflowY,
		/*
		 * The region's own box as well: the controls' claim is about THIS one - they
		 * are pinned inside the region and outside its scroll box, so their rect has
		 * to be inside the region's.
		 */
		regionTop: round(rr.top),
		regionBottom: round(rr.bottom),
		regionHeight: round(rr.height),
		regionOverflowY: regionStyle.overflowY,
		/*
		 * Text nodes that are not whitespace, as text. JSX has no comment syntax
		 * of its own: a block comment written between two elements is TEXT, not a
		 * comment, and it renders as prose inside this region. A stray one is
		 * invisible to any test that reads the source marker order - this file
		 * passed its own unit test on the very build where the region carried
		 * 224px of the comment describing the fix. Checked at both levels now, since
		 * the prose block is where the copy lives and the region is where the stray
		 * comment was written.
		 */
		strayText: [region, capped]
			.flatMap((root) => [...root.childNodes])
			.filter((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
			.map((n) => n.textContent.trim().slice(0, 60)),
	};
	const children = [...capped.children].map((el, index) => {
		const cs = getComputedStyle(el);
		return {
			index,
			tag: el.tagName.toLowerCase(),
			muted: el.className.includes("text-ink-muted"),
			ranked: el.className.includes("font-medium"),
			text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(),
			...rect(el),
			lineHeight: round(Number.parseFloat(cs.lineHeight) || 0),
		};
	});
	const failure = children.find((c) => c.ranked) ?? null;
	const notice = children.find((c) => c.muted && !c.ranked) ?? null;
	/*
	 * THE CONTROLS, and the U3 claim about them: they are the region's children
	 * that are NOT the scrolling block. The insideCapped flag re-asks the question the
	 * probe would otherwise assume - if a later edit puts them back under the cap,
	 * this says so instead of photographing the consequence.
	 */
	const controlsEl = [...region.children].find((el) => el !== capped) ?? null;
	const controls = controlsEl
		? {
				...rect(controlsEl),
				buttons: controlsEl.querySelectorAll("button").length,
				insideCapped: capped.contains(controlsEl),
				visible: controlsEl.getBoundingClientRect().height > 0,
			}
		: null;
	if (failure) {
		const lineHeight = failure.lineHeight || 20;
		const lines = Math.max(1, Math.round(failure.height / lineHeight));
		failure.lines = lines;
		/*
		 * How much of the actionable sentence is INSIDE the capped block's visible
		 * window, in lines. This is the number D12 is about: pre-fix the block
		 * showed 0 of 12 at the narrowest reachable width.
		 */
		failure.visibleLines = Math.max(
			0,
			Math.min(lines, Math.floor((regionBox.bottom - failure.top) / lineHeight + 0.001)),
		);
		failure.wholeVisible =
			failure.top >= regionBox.top - 0.5 && failure.bottom <= regionBox.bottom + 0.5;
	}
	const send = [...document.querySelectorAll("button")].find((b) =>
		/send/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
	);
	return {
		...base,
		region: regionBox,
		children,
		controls,
		failureText: failure ? failure.text : null,
		failureIndex: failure ? failure.index : null,
		failureVisibleLines: failure ? failure.visibleLines : null,
		failureLines: failure ? failure.lines : null,
		failureWholeVisible: failure ? failure.wholeVisible : null,
		noticeIndex: notice ? notice.index : null,
		chips: [...document.querySelectorAll("button")].filter((b) =>
			/remove attachment/i.test(b.getAttribute("aria-label") ?? ""),
		).length,
		composerBoxTop: box ? round(box.getBoundingClientRect().top) : null,
		send: send ? rect(send) : null,
	};
})()`;

let vite = null;
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (vite) {
		vite.kill("SIGKILL");
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		// Same race `chat-alignment-geometry.mjs` documents: SIGKILL returns
		// before the profile stops being written to, so a plain recursive remove
		// can throw ENOTEMPTY and turn a successful measurement into a failure.
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const startVite = async () => {
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(ROOT, "scripts/composer-alert-geometry.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1, while the driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, COMPOSER_ALERT_PORT: String(PORT) } },
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			const res = await fetch(`${ORIGIN}/composer-alert-geometry.html`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("the harness page never came up");
};

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-composer-alert-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
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
	await cdp.send("Runtime.enable");
	return cdp;
};

/**
 * The assertions, stated once so the report can name the finding each number
 * answers. `measurement` is one probe result, `idle` the same column's baseline.
 */
const assertions = (measurement, idle, column) => {
	const failures = [];
	if (!measurement.present) return [`no alert region rendered at ${column}px`];
	const fail = (message) => failures.push(`${column}px: ${message}`);
	/*
	 * Nothing in this region may be prose that came from the SOURCE. A JSX
	 * comment written as a bare block between two elements is a text node, and it
	 * renders: this harness's own first version shipped that way, adding 224px of
	 * the comment describing the fix to the block it was fixing. The source-order
	 * unit test cannot see it — the markers are still in the order it asserts.
	 */
	if (measurement.region.strayText.length > 0)
		fail(
			`the region renders ${measurement.region.strayText.length} stray text node(s), i.e. source prose shown to the user: ${JSON.stringify(measurement.region.strayText)}`,
		);
	/*
	 * D12, first half: the actionable sentence is the FIRST thing in the window.
	 * The block is capped, so DOM order is the priority order.
	 */
	if (measurement.failureIndex !== 0)
		fail(
			`the failure is child ${measurement.failureIndex} of the capped block, so the cap can show context above it (D12)`,
		);
	if (
		measurement.noticeIndex !== null &&
		measurement.noticeIndex < measurement.failureIndex
	)
		fail(
			`the muted context (child ${measurement.noticeIndex}) renders above the failure (D12)`,
		);
	/*
	 * U3: the remedy is OUTSIDE the cap, and that is the whole finding.
	 *
	 * At the app's own minimum window (800x568, which it clamps to) the region used
	 * to be 236px of copy in a 120px window with both controls ~90px below the
	 * visible area and no cue that the region scrolled - the operator saw a failure
	 * and no way out of it. The fix is structural rather than a taller cap (raising
	 * it moves the composer's top border and can take Send off screen), so what is
	 * asserted here is the structure: whatever element holds the controls is not a
	 * descendant of the element that scrolls, and it is inside the region's own
	 * box.
	 */
	if (measurement.controls) {
		if (measurement.controls.insideCapped)
			fail(
				"the remedy controls are inside the scrolling prose block, so a long alert scrolls them out of the window (UX round 1, U3)",
			);
		if (measurement.region.regionOverflowY === "auto")
			fail(
				"the alert REGION scrolls as a whole, so nothing in it can be pinned (UX round 1, U3): the cap belongs to the prose block",
			);
		if (
			measurement.controls.top < measurement.region.regionTop - 0.5 ||
			measurement.controls.bottom > measurement.region.regionBottom + 0.5
		)
			fail(
				`the controls are not inside the region's own box: ${measurement.controls.top}..${measurement.controls.bottom} against ${measurement.region.regionTop}..${measurement.region.regionBottom}`,
			);
		if (measurement.controls.bottom > measurement.viewport.height)
			fail(
				`the remedy controls are off screen: their bottom is ${measurement.controls.bottom} in a ${measurement.viewport.height}px window (UX round 1, U3)`,
			);
	}
	/*
	 * D12, second half: at the NARROWEST reachable width the failure's first line
	 * is inside the visible window, not below the fold. This is the finding's own
	 * measurement — pre-fix, the refusal began at offset 144 in a 120px window.
	 */
	if ((measurement.failureVisibleLines ?? 0) < 1)
		fail(
			`not one line of the failure is visible: it starts at offset ${measurement.children[measurement.failureIndex]?.top - measurement.region.top} of a ${measurement.region.clientHeight}px window (D12)`,
		);
	/*
	 * The cap's own invariant, and the reason "raise the cap" is not an answer:
	 * with the same draft, the composer's top border does not move when the alert
	 * renders - however much the region holds, up to its cap - so the send
	 * control cannot be pushed off the window. `baseline` is null in the states
	 * where no such comparison exists (see `BORDER_BASELINE`).
	 */
	if (
		idle?.composerBoxTop != null &&
		measurement.composerBoxTop != null &&
		Math.abs(idle.composerBoxTop - measurement.composerBoxTop) > 0.5
	)
		fail(
			`the composer's top border moved from ${idle.composerBoxTop} to ${measurement.composerBoxTop} when the alert rendered`,
		);
	if (measurement.send && measurement.send.bottom > measurement.viewport.height)
		fail(
			`the send control is off screen: its bottom is ${measurement.send.bottom} in a ${measurement.viewport.height}px window`,
		);
	return failures;
};

const main = async () => {
	await startVite();
	const cdp = await startChrome();
	mkdirSync(OUT, { recursive: true });

	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: VIEWPORT.width,
		height: VIEWPORT.height,
		deviceScaleFactor: 2,
		mobile: false,
	});

	const measurements = [];
	const problems = [];
	for (const { column, states } of CASES) {
		for (const state of states) {
			if (ONLY && !`${column}-${state}`.includes(ONLY)) continue;
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/composer-alert-geometry.html?w=${column}&state=${state}&theme=${THEME}`,
			});
			/*
			 * Ready is three conditions, not one: the composer's own region is in
			 * the DOM (absent for `idle`, where the box is the sentinel instead),
			 * the font faces are loaded — the block's height is line-count times
			 * line-height, and a fallback face measures a different number — and
			 * the column has observed its width, which is what turns `isSmallView`
			 * on at 472 and 172.
			 */
			let ready = false;
			for (let i = 0; i < 240 && !ready; i++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						if (document.fonts.status !== "loaded") return false;
						if (!document.querySelector("textarea")) return false;
						if (${JSON.stringify(state)} !== "idle" && !document.querySelector('[role="alert"]')) return false;
						const column = document.querySelector("[data-lo-geometry-column]");
						return !!column && column.getBoundingClientRect().width > 0;
					})()`,
				});
				ready = result.value === true;
				if (!ready) await sleep(250);
			}
			if (!ready) {
				/*
				 * The page failing to mount and the page mounting slowly are
				 * different failures, and a bare timeout reports neither. So the
				 * throw carries what the document actually holds: the harness is a
				 * dev-server page, and the usual cause is a module that threw while
				 * the driver was still waiting for pixels.
				 */
				const { result: diagnostic } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					awaitPromise: true,
					expression: `(async () => ({
						url: location.href,
						fonts: document.fonts.status,
						textarea: !!document.querySelector("textarea"),
						column: !!document.querySelector("[data-lo-geometry-column]"),
						importError: await import("/composer-alert-geometry.tsx").then(
							() => null,
							(e) => String(e && e.message ? e.message : e),
						),
					}))()`,
				});
				throw new Error(
					`${column}px/${state}: never became measurable — ${JSON.stringify(diagnostic.value)}${cdp.log.length > 0 ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
				);
			}
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			if (!result.value)
				throw new Error(`${column}px/${state}: no measurement returned`);
			measurements.push({ column, state, ...result.value });

			const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(
				join(OUT, `${column}-${state}.png`),
				Buffer.from(shot.data, "base64"),
			);
		}
	}

	for (const measurement of measurements) {
		/*
		 * `idle` renders no alert region by definition: it is the baseline the
		 * composer's own border is compared against, and nothing else. Its
		 * numbers are still printed, because the border is a comparison.
		 */
		if (measurement.state === "idle") continue;
		const baseline = BORDER_BASELINE[measurement.state]
			? measurements.find(
					(m) =>
						m.column === measurement.column &&
						m.state === BORDER_BASELINE[measurement.state],
				)
			: null;
		for (const problem of assertions(measurement, baseline, measurement.column))
			problems.push(`${problem} [state ${measurement.state}]`);
	}

	const report = {
		origin: ORIGIN,
		theme: THEME,
		viewport: VIEWPORT,
		out: OUT,
		measurements,
	};
	if (AS_JSON) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(
			`\ncomposer alert geometry — ${THEME}, ${VIEWPORT.width}x${VIEWPORT.height} CSS\n`,
		);
		console.log(
			"column  state       block(client/scroll)  failure  visible/total  notice  chips  box-top  send-bottom",
		);
		for (const m of measurements) {
			console.log(
				[
					String(m.column).padStart(6),
					m.state.padEnd(11),
					m.present
						? `${m.region.clientHeight}/${m.region.scrollHeight}`.padEnd(21)
						: "-".padEnd(21),
					m.present ? String(m.failureIndex) : "-",
					m.present ? `${m.failureVisibleLines}/${m.failureLines}` : "-",
					m.noticeIndex === null ? "-" : String(m.noticeIndex),
					String(m.chips),
					String(m.composerBoxTop),
					m.send ? String(m.send.bottom) : "-",
				].join("  "),
			);
		}
		console.log(`\nframes: ${OUT}`);
	}

	if (problems.length > 0) {
		console.error(`\n${problems.length} assertion(s) failed:`);
		for (const p of problems) console.error(`  - ${p}`);
		teardown();
		process.exit(1);
	}
	teardown();
	console.log("\nall assertions passed");
};

process.on("exit", teardown);
process.on("SIGINT", () => {
	teardown();
	process.exit(130);
});

await main();
