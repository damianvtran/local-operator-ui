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

/**
 * The states, at every width.
 *
 * WHAT WIDENED IN REVIEW ROUND 1, AND WHY. The rig was written for one arm - the
 * unknown-outcome sentence over a returned draft - and the round's findings were
 * about the OTHER arms: the design round found the two "too large" frames showing
 * a sentence the app never produces (D3), the delivered frame keeping a chip that
 * suggests the file went (D4), and the copy sweep photographing an idle composer
 * with no notice at all (D5). The set now renders every arm the copy table
 * produces, from the same shipped composer, at the same three widths - so "each
 * arm is one sentence and at most the two controls the table allows" is a claim
 * this rig reads off the DOM for every row of the table rather than for one.
 */
const CASES = [
	{
		column: 892,
		states: [
			"idle",
			"notice",
			"unreachable",
			"too-large",
			"too-long",
			"gone",
			"muted",
			"edited-idle",
			"delivered",
		],
	},
	{
		column: 472,
		states: [
			"idle",
			"notice",
			"unreachable",
			"too-large",
			"too-long",
			"gone",
			"muted",
			"edited-idle",
			"delivered",
		],
	},
	{
		column: 172,
		states: [
			"idle",
			"notice",
			"unreachable",
			"too-large",
			"too-long",
			"gone",
			"muted",
			"edited-idle",
			"delivered",
		],
	},
];

/**
 * The two states that render NO notice: the baselines the others are compared
 * against. `edited-idle` is the baseline for the late-confirmation arm, because it
 * holds a different draft (the user's edit) - so comparing it against `idle` would
 * measure the draft rather than the notice.
 */
const BASELINE_STATES = new Set(["idle", "edited-idle"]);

/*
 * WHICH STATE EACH NOTICE IS COMPARED AGAINST, and why a comparison is possible
 * at all. The composer's band is bottom-anchored, so the box is pinned by its
 * bottom edge and anything added ABOVE it grows upward into the transcript -
 * which is the invariant, and it needs a baseline holding the SAME draft with no
 * notice to be a statement about the notice rather than about the draft. `idle`
 * is that baseline, and it stages the same returned text and the same chip.
 */
const BORDER_BASELINE = {
	notice: "idle",
	unreachable: "idle",
	"too-large": "idle",
	"too-long": "idle",
	gone: "idle",
	muted: "idle",
	delivered: "edited-idle",
};

/**
 * WHAT EACH ARM MUST OFFER, and it is the table's own column rather than a
 * preference: `retry` is true only where pressing it can work (the unknown
 * outcomes, whose replay the owner de-duplicates) and false everywhere the
 * message cannot leave as it stands or the conversation is gone.
 */
const ARM_CONTROLS = {
	notice: { register: "danger", controls: ["Retry", "Clear"] },
	unreachable: { register: "danger", controls: ["Retry", "Clear"] },
	"too-large": { register: "danger", controls: ["Clear"] },
	"too-long": { register: "danger", controls: ["Clear"] },
	gone: { register: "danger", controls: ["Clear"] },
	muted: { register: "muted", controls: [] },
	delivered: { register: "muted", controls: [] },
};

/** A phrase each arm's sentence must carry, so a frame is the copy it claims. */
const ARM_PHRASE = {
	notice: "couldn't confirm",
	unreachable: "couldn't reach local operator",
	"too-large": "too large",
	"too-long": "characters",
	gone: "no longer exists",
	muted: "still sending",
	delivered: "delivered",
};

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
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), height: round(r.height), width: round(r.width) };
	};
	const textarea = document.querySelector("textarea");
	/*
	 * The composer's own box: walked up from the textarea to the first ancestor
	 * that draws a border, which is the boundary every other number here is read
	 * against.
	 */
	let box = textarea;
	while (box && getComputedStyle(box).borderTopWidth === "0px") box = box.parentElement;
	const notice = document.querySelector('[role="alert"]');
	const form = textarea ? textarea.closest("form") : null;
	const send = [...document.querySelectorAll("button")].find((b) => b.type === "submit");
	/*
	 * What the notice renders, as opposed to what it is fed: the SENTENCE count is
	 * the shape claim (one sentence, not a paragraph), the controls are the
	 * remedy claim (at most Retry and Clear), and the register is the ink claim (a
	 * muted notice is a fact rather than a failure).
	 */
	const paragraphs = notice ? notice.querySelectorAll("p").length : 0;
	return {
		theme: document.documentElement.dataset.theme,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		noticePresent: !!notice,
		notice: rect(notice),
		noticeParagraphs: paragraphs,
		noticeControls: notice
			? [...notice.querySelectorAll("button")].map((b) => b.textContent.trim())
			: [],
		/*
		 * The weight each control is drawn at. The design round's D2 is a claim
		 * about the two controls being hard to tell apart (the two ink roles they
		 * used measure 1.05-1.11 apart in five of the twelve themes), and the fix is
		 * a WEIGHT difference rather than a second colour rule - so the measurement
		 * is the computed font weight, which is the same in every theme by
		 * construction and is what a reviewer can check here.
		 */
		noticeControlWeights: notice
			? [...notice.querySelectorAll("button")].map((b) => ({
					label: b.textContent.trim(),
					weight: getComputedStyle(b).fontWeight,
				}))
			: [],
		noticeRegister: notice
			? notice.querySelector(".text-danger")
				? "danger"
				: notice.querySelector(".text-ink-muted")
					? "muted"
					: "none"
			: "none",
		noticeText: notice
			? (notice.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 200)
			: null,
		/*
		 * Source prose that reached the DOM. A JSX comment written as a bare block
		 * between two elements is a text node and renders: this harness's own first
		 * version shipped that way, adding 224px of the comment describing the fix
		 * to the block it was fixing.
		 */
		strayText: notice
			? [...notice.childNodes]
					.filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0)
					.map((n) => n.textContent.trim().slice(0, 60))
			: [],
		textarea: rect(textarea),
		boxTop: box ? round(box.getBoundingClientRect().top) : null,
		boxBottom: box ? round(box.getBoundingClientRect().bottom) : null,
		form: rect(form),
		send: rect(send),
		// The tiles in the chip row: the returned file is part of the state under
		// test, and it is also what makes the box taller, so it is measured.
		chips: [...document.querySelectorAll("button")].filter((b) =>
			/remove attachment/i.test(b.getAttribute("aria-label") ?? ""),
		).length,
		draft: textarea ? textarea.value : null,
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
/**
 * The assertions, stated once so the report can name the finding each number
 * answers. `measurement` is one probe result, `idle` the same column's baseline
 * with the same draft and no notice.
 */
const assertions = (measurement, idle, column) => {
	const failures = [];
	const fail = (message) => failures.push(`${column}px: ${message}`);
	if (!measurement.noticePresent) return [`no notice rendered at ${column}px`];
	/*
	 * THE SHAPE: one sentence, at most the two controls the copy table allows. The
	 * screen the operator reported was the transport's twenty-second paragraph over
	 * an empty composer with two links under it; a frame that cannot fail this
	 * cannot prove the replacement.
	 */
	if (measurement.noticeParagraphs !== 1)
		fail(
			`the notice renders ${measurement.noticeParagraphs} sentence blocks; the table gives one, and a second block is the paragraph the operator reported`,
		);
	/*
	 * THE CONTROLS, arm by arm, from the table's own column (`ARM_CONTROLS`). This
	 * replaced "at most two" and "none if muted" with the set each arm must offer:
	 * the round's B3 was that Retry was missing on the arms it exists for and
	 * present on the one where it duplicates, so an assertion that only counts
	 * controls cannot fail the way that defect did.
	 */
	const expected = ARM_CONTROLS[measurement.state];
	if (expected) {
		const actual = measurement.noticeControls;
		if (actual.join("+") !== expected.controls.join("+"))
			fail(
				`the notice offers ${JSON.stringify(actual)} where this arm's row of the table gives ${JSON.stringify(expected.controls)}`,
			);
		if (measurement.noticeRegister !== expected.register)
			fail(
				`the notice is drawn as ${measurement.noticeRegister} where this arm is ${expected.register}`,
			);
		/*
		 * And the sentence is the arm's own: a phrase from the copy table, on the
		 * rendered text. The exact strings are pinned by the unit suite
		 * (`composer-send-failure.test.mjs`); what this adds is that the frame
		 * shows the sentence the arm is named for.
		 */
		const phrase = ARM_PHRASE[measurement.state];
		if (phrase && !(measurement.noticeText ?? "").toLowerCase().includes(phrase))
			fail(
				`the notice's own words do not carry "${phrase}": ${JSON.stringify(measurement.noticeText)}`,
			);
		/*
		 * D2: where an arm offers both controls, Retry is the weightier of the two -
		 * a weight difference and not a second ink rule, because the two ink roles
		 * the controls used are 1.05-1.11 apart in five of the twelve themes.
		 */
		const weights = Object.fromEntries(
			measurement.noticeControlWeights.map((c) => [c.label, Number(c.weight)]),
		);
		if (
			expected.controls.length === 2 &&
			!(weights.Retry > weights.Clear)
		)
			fail(
				`Retry (${weights.Retry}) is not weightier than Clear (${weights.Clear}), so the primary of the two is not distinguishable in a theme whose two ink roles are close`,
			);
	}
	/*
	 * And no jargon, on ANY arm: the words the operator's screen carried are the
	 * app's own vocabulary for machinery the user does not have (the `held` /
	 * `admission` / `owner` family), and the copy table's test asserts them absent
	 * from the strings while this asserts them absent from the PIXELS.
	 */
	for (const jargon of ["held", "admission", "owner", "request id"]) {
		if ((measurement.noticeText ?? "").toLowerCase().includes(jargon))
			fail(
				`the notice says "${jargon}", which is the app's word for its own machinery: ${JSON.stringify(measurement.noticeText)}`,
			);
	}
	if (measurement.state === "notice" && measurement.noticeRegister !== "danger")
		fail(
			`the failure notice is drawn as ${measurement.noticeRegister}, so a message the app could not confirm is the least visible line on the screen`,
		);
	if (measurement.strayText.length > 0)
		fail(
			`the notice renders ${measurement.strayText.length} stray text node(s), i.e. source prose shown to the user: ${JSON.stringify(measurement.strayText)}`,
		);
	/*
	 * THE POSITION: the notice is above the box rather than under it, which is the
	 * one arrangement where a sentence of any length costs the user nothing.
	 */
	if (
		measurement.notice.bottom > measurement.textarea.top + 0.5 ||
		measurement.notice.top > measurement.textarea.top
	)
		fail(
			`the notice is not above the box (notice ${measurement.notice.top}..${measurement.notice.bottom}, box top ${measurement.textarea.top})`,
		);
	/*
	 * THE INVARIANT THE WHOLE ARRANGEMENT EXISTS FOR, and the number this rig is
	 * for: with the same draft, a notice appearing must not move the line the user
	 * is typing or the composer's own bottom edge. The band is bottom-anchored, so
	 * the notice grows upward into the transcript instead.
	 */
	if (idle) {
		if (Math.abs(idle.textarea.top - measurement.textarea.top) > 1)
			fail(
				`the line the user is typing moved from ${idle.textarea.top} to ${measurement.textarea.top} when the notice rendered; it must not move at all`,
			);
		if (Math.abs((idle.boxBottom ?? 0) - (measurement.boxBottom ?? 0)) > 1)
			fail(
				`the composer's bottom edge moved from ${idle.boxBottom} to ${measurement.boxBottom} when the notice rendered`,
			);
	}
	/*
	 * And the control the notice's own sentence names stays on screen: the failure
	 * the old capped region produced was a remedy scrolled out of the window.
	 */
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
						if (!${JSON.stringify(["idle", "edited-idle"])}.includes(${JSON.stringify(state)}) && !document.querySelector('[role="alert"]')) return false;
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
			/*
			 * SETTLED MEANS A STABLE BOX, not two animation frames.
			 *
			 * The draft's line COUNT decides the textarea's height, and the box is
			 * bottom-anchored, so a wrap that changes after the first paint moves the
			 * very line this rig measures. Measured once: the late-confirmation frame
			 * at 172px differed from its own baseline by one wrapped line (29px) on one
			 * run and not the next, which is a flake in the instrument rather than a
			 * finding about the composer. The gate below reads the height until two
			 * consecutive readings agree, so what is measured is a laid-out page.
			 */
			let settled = null;
			for (let i = 0; i < 20; i++) {
				await cdp.send("Runtime.evaluate", {
					awaitPromise: true,
					expression:
						"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
				});
				const { result: frame } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression:
						'(() => { const t = document.querySelector("textarea"); return t ? Math.round(t.getBoundingClientRect().height * 10) / 10 : null; })()',
				});
				if (frame.value !== null && frame.value === settled) break;
				settled = frame.value;
				await sleep(200);
			}
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
		if (BASELINE_STATES.has(measurement.state)) continue;
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
			"column  state    notice(top..bottom h)   sentences  controls          register  chips  box-top  box-bottom  box-top delta  send-bottom/window",
		);
		for (const m of measurements) {
			const idle = measurements.find(
				(candidate) =>
					candidate.column === m.column && candidate.state === "idle",
			);
			/*
			 * Against the ARM'S OWN baseline, not always `idle`: the late-confirmation
			 * frame holds a different draft, so a delta against `idle` reports the
			 * DRAFT's own line count as though the notice had moved the box (measured:
			 * a correctly-behaving frame printed 29). The assertions always compared
			 * the right pair; this is the printed column agreeing with them.
			 */
			const baselineState =
				BORDER_BASELINE[m.state] ?? (BASELINE_STATES.has(m.state) ? null : "idle");
			const baseline = baselineState
				? measurements.find(
						(candidate) =>
							candidate.column === m.column && candidate.state === baselineState,
					)
				: null;
			const delta =
				baseline?.textarea && m.textarea
					? Math.round((m.textarea.top - baseline.textarea.top) * 10) / 10
					: 0;
			console.log(
				[
					String(m.column).padStart(6),
					m.state.padEnd(8),
					(m.noticePresent
						? `${m.notice.top}..${m.notice.bottom} h${m.notice.height}`
						: "-"
					).padEnd(23),
					String(m.noticeParagraphs).padEnd(10),
					(m.noticeControls.length
						? m.noticeControls
								.map(
									(label) =>
										`${label}@${
											m.noticeControlWeights.find((c) => c.label === label)
												?.weight ?? "?"
										}`,
								)
								.join("+")
						: "-"
					).padEnd(24),
					String(m.noticeRegister).padEnd(9),
					String(m.chips).padEnd(6),
					String(m.boxTop).padEnd(8),
					String(m.boxBottom).padEnd(11),
					String(delta).padEnd(13),
					m.send ? `${m.send.bottom}/${m.viewport.height}` : "-",
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
