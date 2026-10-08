/**
 * Driver for the asks-open-by-default frames: the four-state matrix, before and after,
 * read off the running renderer over raw CDP.
 *
 *   node drive-open.mjs --after http://localhost:5391 \
 *        --scratch <rig scratch> --out <scratch out>          # one arm per invocation
 *
 * (`--before <url>` for the other arm, on a rig stood up again for it - see "THE TWO ARMS"
 * below for why the two flags are refused together. Each invocation writes `run-<arm>.json`
 * and `<arm>/state-*` under `--out`, so the two arms land side by side in one directory.)
 *
 * ONE private headless Chrome (the repository's `chrome-keychain` switch applied) serves
 * the whole run, and EACH CASE GETS ITS OWN BROWSER CONTEXT inside it. The context is the
 * point: the policy keeps its dismissal record in the page's memory, and the composer's
 * draft and the window's pane flags live in localStorage, so a case that shared a profile
 * with the one before it would inherit its dismissals and its panes and photograph a
 * state nobody drove. A context is in-memory storage with no profile copy, so the run
 * pays for one Chrome rather than one per case.
 *
 * THE TWO ARMS ARE THE SAME DRIVER OVER THE SAME KIND OF BACKEND, NEVER THE SAME ONE:
 * ONE ARM PER INVOCATION, EACH ON A RIG STOOD UP FOR IT. `--before` serves the base the
 * branch sits on and `--after` serves the branch, and the only thing that is meant to
 * differ between a before frame and an after frame is the renderer tree - which holds
 * only if both arms start from the same backend state. Run back to back on ONE rig they
 * do not: the `before` arm's `s5` sends a chat message into conversation A, and the
 * `after` arm's frames of A are then taken over a transcript that already holds that
 * exchange. Measured when this set's final frames were taken: an after arm driven second
 * over one rig read `transcriptLines: 15` where a fresh rig reads 10, and its `s2` frame of
 * A (the one frame looked at) carried a second user bubble and a reply that the fresh-rig
 * frame did not. So the driver REFUSES both flags at once (see the check below), and
 * `rig-up.sh` is run once per arm; it wipes and restarts the whole rig, so the second arm
 * starts as clean as the first.
 *
 * WHAT EACH CASE READS, because a frame alone is a claim the pixels may not carry:
 * `PROBE` (drawer / slot / chip / composer placeholder / who has focus), the focus tap
 * (what held focus when the drawer first appeared, and whether any focus event ever landed
 * inside it), and the frame sampler (one mark per animation frame: how long the open
 * took, whether the drawer ever painted without rows, and how far the composer moved).
 *
 * THE CASES (see the set's README for the matrix they fill):
 *   s1  no asks on open            conversation B   live queue, nothing in it
 *   s2  pending on open            conversation A   one queued ask, older than the view
 *   s2l the same, light palette    conversation A   (frame lands beside the dark one)
 *   s3  all addressed on open      conversation C   one ask, answered
 *   s4  dismissed while pending    conversation D   close with the X, then a queue refresh,
 *                                                   a re-render, a NEW ask, and a switch
 *                                                   away and back - the drawer stays shut; a
 *                                                   RELOAD (a fresh page lifetime) may open it
 *   s5  send a normal message      conversation A   from the main composer, with the
 *                                                   drawer up: it goes out as chat and
 *                                                   leaves the ask pending
 *   s6  composer holds a draft     conversation A   a restored draft keeps the view closed
 *   s7  carried flag               D -> A -> D      the drawer the policy opened for A is
 *                                                   not carried onto dismissed D
 *   s8  arrival, then a new view   B                an ask that arrives while B is open does
 *                                                   not open it; a NEW view of B (now pending
 *                                                   on open, never dismissed) opens it once
 *   s11 no queued-ask engine      E                the unsupported / unpublished shape: no
 *                                                   chip, no drawer, nothing opened
 *   s9  a narrow window            A                1024x768 and the app's 800x600 floor, both
 *                                                   arms
 *   s9c the same windows, old tree A                CONTROL: the drawer opened by the user's own
 *                                                   press, to read what docking costs without
 *                                                   the policy
 *   s14 a durable pane holds       A                the canvas is the user's pane; the policy
 *       the slot                                    borrows the slot and the close hands it back
 *   s13 the Other row              A                auto-open does not focus the Other field; the
 *                                                   user's press does; a close over typed text
 *                                                   is a dismissal, a refresh keeps it shut, and
 *                                                   the user's own press on the chip reopens it
 *                                                   with the typed text still in the field
 *   s12 Escape in the composer    A                the lane's existing claim closes the drawer;
 *                                                   on the new tree that close is a dismissal
 *   s10 close with the X           A                where the keyboard lands, both arms
 *   s15 the record names its asks  F -> C -> F      a close over TWO asks, then ONE is answered
 *                                                   while the user is away: the dismissal holds
 *                                                   (the other is still outstanding). Then the
 *                                                   rest is answered AND a new batch queued
 *                                                   while away: the record is gone and the new
 *                                                   view opens, with no "seen empty" frame in
 *                                                   between
 *   s16 a list the wire cut short  G -> C -> G      eight long asks, so the core's text budget
 *                                                   ships a seven-row PREFIX beside a tally of
 *                                                   eight: the close cannot name every ask it
 *                                                   waved off, so it holds even when the asks
 *                                                   that remain are ids it never saw, and is
 *                                                   forgotten only by a complete frame with
 *                                                   NOTHING outstanding
 *
 * Every wait is on an element or an event, never a bare sleep standing in for one; the
 * only fixed delays are the SETTLE beats before a reading that claims "still closed",
 * which are the claim: a drawer that opens late is a drawer this reading must outlast.
 *
 * The Chrome is reaped by exact pid on exit, its profile is removed, and the run lists any
 * process still holding that profile path (there should be none).
 */
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";
import { pinnedEvidenceEnv } from "../../../../scripts/evidence-tz.mjs";

/* ------------------------------------------------------------------ arguments ---- */

const argv = process.argv.slice(2);
const flag = (name) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? null : (argv[at + 1] ?? "");
};
const AFTER = flag("after");
const BEFORE = flag("before");
const SCRATCH = flag("scratch");
const OUT = flag("out");
const ONLY = (flag("only") ?? "").split(",").filter(Boolean);
const EXPLORE = argv.includes("--explore");
if ((!AFTER && !BEFORE) || !SCRATCH || (!OUT && !EXPLORE)) {
	console.error(
		"usage: drive-open.mjs (--after <url> | --before <url>) --scratch <rig scratch> --out <dir> [--only s2,s5] [--explore]",
	);
	process.exit(2);
}
if (AFTER && BEFORE) {
	/*
	 * A REFUSAL, NOT A WARNING: a run that photographs both arms over one backend produces
	 * a complete-looking pair whose only defect is that the second arm saw the first arm's
	 * chat message (the header note has the measured readings), and nothing in the frames
	 * says so. Stand the rig up once per arm instead - the README's commands are exactly that.
	 */
	console.error(
		"drive-open.mjs: ONE ARM PER INVOCATION. The before arm's s5 sends a message into conversation A, so an after arm run on the same backend photographs a transcript the before arm already wrote. Run rig-up.sh, drive ONE arm, run rig-down.sh, then do the other arm on a freshly started rig.",
	);
	process.exit(2);
}

const SESSION = {
	A: "aaaa11112222",
	B: "bbbb11112222",
	C: "cccc11112222",
	D: "dddd11112222",
	E: "eeee11112222",
	F: "ffff11112222",
	G: "abcd11112222",
};
const TITLE = {
	A: "Deploy checklist",
	B: "Notes",
	C: "Invoice export",
	D: "Release notes",
	E: "Legacy runtime",
	F: "Staging rollout",
	G: "Backlog triage",
};
/*
 * THE TEXTAREA ITSELF, and only it. #864's driver used a three-way alternative here, and
 * `querySelector` returns the first match of ANY alternative in document order - which is
 * the wrapper that carries the tour tag, a div with no `value` and no placeholder. The
 * reading this set needs from the composer (what it says, what it holds) lives on the
 * textarea, so a wrapper hit would report `null` for both and look like a finding.
 */
const COMPOSER = 'textarea[aria-label="Message"]';
const DRAWER = '[data-ask-drawer="session"]';
const CHIP = "[data-lo-ask-item-toggle]";
const CLOSE = '[aria-label="Close asks"]';
/** The ids of the ask rows the drawer is painting right now: the asks the frame NAMED. */
const askRowIdsSource = () =>
	[...document.querySelectorAll("[data-lo-ask-row]")].map((row) =>
		row.getAttribute("data-lo-ask-row"),
	);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Chrome announces its own debug port on stderr; module scope so the listener does not rebuild it per chunk. */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first-run seed: without it the app boots into the onboarding modal. */
const ONBOARDING_SEED =
	'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}';

/* --------------------------------------------------------- page-side functions ---- */
/*
 * Written as functions and serialised with `.toString()` rather than as template
 * strings: a regex or an escape inside a template literal needs double escaping and
 * fails silently when it is wrong, while a real function is parsed by the same tooling
 * as the rest of this file. They reference nothing outside themselves.
 */

/** What the page says right now. */
const probeSource = () => {
	const q = (selector) => document.querySelector(selector);
	const count = (selector) => document.querySelectorAll(selector).length;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			x: Math.round(r.x),
			y: Math.round(r.y),
			w: Math.round(r.width),
			h: Math.round(r.height),
		};
	};
	const composer = q('textarea[aria-label="Message"]');
	const chip = q("[data-lo-ask-item-toggle]");
	const active = document.activeElement;
	return {
		hash: location.hash,
		zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		viewport: { w: innerWidth, h: innerHeight },
		overflowX:
			document.documentElement.scrollWidth >
			document.documentElement.clientWidth,
		nav: rect(q("nav")),
		drawer: count('[data-ask-drawer="session"]'),
		closeAsks: count('[aria-label="Close asks"]'),
		rows: [...document.querySelectorAll("[data-lo-ask-row]")].map((row) =>
			row.getAttribute("data-lo-ask-status"),
		),
		slot: rect(q('[data-tour-tag="ask-drawer-slot"]')),
		chip: chip
			? {
					expanded: chip.getAttribute("aria-expanded"),
					text: chip.innerText.replace(/\s+/g, " ").trim().slice(0, 90),
				}
			: null,
		headerTrigger: count('[data-tour-tag="ask-pane-trigger"]'),
		composer: composer
			? {
					...rect(composer),
					placeholder: composer.getAttribute("placeholder"),
					value: composer.value,
				}
			: null,
		active: active
			? {
					tag: active.tagName,
					label: active.getAttribute("aria-label"),
					inDrawer: Boolean(active.closest("[data-lo-ask-surfaces]")),
				}
			: null,
		scope: q("[data-ask-drawer] [data-ask-scope]")?.textContent ?? null,
		canvas: count('[data-tour-tag="canvas-container"]'),
		other: {
			row: count("[data-ask-option-other]"),
			field: count("textarea[data-ask-other]"),
			fieldValue: q("textarea[data-ask-other]")?.value ?? null,
			fieldFocused:
				document.activeElement?.matches?.("textarea[data-ask-other]") === true,
		},
	};
};

/** Installed before the app boots: what held focus when the drawer FIRST appeared. */
const tapSource = () => {
	const describe = (el) =>
		el?.tagName
			? {
					tag: el.tagName,
					label: el.getAttribute("aria-label"),
					inDrawer: Boolean(el.closest("[data-lo-ask-surfaces]")),
					composer: el.matches('textarea[aria-label="Message"]'),
				}
			: null;
	const tap = {
		t0: performance.now(),
		drawerSeenAtMs: null,
		activeAtDrawer: null,
		focusLog: [],
		focusIntoDrawer: 0,
	};
	window.__tap = tap;
	new MutationObserver(() => {
		if (
			tap.drawerSeenAtMs === null &&
			document.querySelector("[data-ask-drawer]")
		) {
			tap.drawerSeenAtMs = Math.round(performance.now() - tap.t0);
			tap.activeAtDrawer = describe(document.activeElement);
		}
	}).observe(document, { childList: true, subtree: true });
	document.addEventListener(
		"focusin",
		(event) => {
			const d = describe(event.target);
			tap.focusLog.push({ t: Math.round(performance.now() - tap.t0), ...d });
			if (d?.inDrawer) tap.focusIntoDrawer += 1;
		},
		true,
	);
};

/** One mark per animation frame for `durationMs`: the frame-accurate record of a change. */
const samplerSource = (durationMs) => {
	const S = { t0: performance.now(), marks: [] };
	window.__timeline = S;
	const q = (selector) => document.querySelector(selector);
	const tick = () => {
		const c = q('textarea[aria-label="Message"]');
		const r = c ? c.getBoundingClientRect() : null;
		S.marks.push({
			t: Math.round(performance.now() - S.t0),
			hash: location.hash.slice(-12),
			drawer: Boolean(q("[data-ask-drawer]")),
			surface: Boolean(q("[data-lo-ask-surfaces]")),
			slot: Boolean(q('[data-tour-tag="ask-drawer-slot"]')),
			rows: document.querySelectorAll("[data-lo-ask-row]").length,
			chip: Boolean(q("[data-lo-ask-item-toggle]")),
			composer: r ? { x: Math.round(r.left), w: Math.round(r.width) } : null,
		});
		if (performance.now() - S.t0 < durationMs) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};

/** The sidebar row for a conversation, scrolled into view and hit-tested at its centre. */
const rowSource = (title) => {
	const norm = (text) => text.replace(/\s+/g, " ").trim();
	const matches = [...document.querySelectorAll("nav button")].filter((b) =>
		norm(b.innerText).includes(title),
	);
	if (matches.length === 0) return null;
	matches.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length);
	const button = matches[0];
	button.scrollIntoView({ block: "center" });
	const r = button.getBoundingClientRect();
	const x = Math.round(r.left + r.width / 2);
	const y = Math.round(r.top + r.height / 2);
	const hit = document.elementFromPoint(x, y);
	return {
		x,
		y,
		text: norm(button.innerText).slice(0, 100),
		hittable: Boolean(hit && (button === hit || button.contains(hit))),
	};
};

/** The generic "press this selector" target: rect plus a hit test at its centre. */
const targetSource = (selector) => {
	const el = document.querySelector(selector);
	if (!el) return null;
	el.scrollIntoView({ block: "center" });
	const r = el.getBoundingClientRect();
	const x = Math.round(r.left + r.width / 2);
	const y = Math.round(r.top + r.height / 2);
	const hit = document.elementFromPoint(x, y);
	return {
		x,
		y,
		hittable: Boolean(hit && (el === hit || el.contains(hit))),
	};
};

/* ------------------------------------------------------------------ one Chrome ---- */

const profile = mkdtempSync(
	join(process.env.RIG_TMP ?? tmpdir(), "ask-open-chrome-"),
);
/*
 * THE ZONE IS PINNED (`scripts/evidence-tz.mjs`, America/New_York): these frames print
 * the transcript's clock time, and a frame in the host's own zone diffs against a
 * re-shoot elsewhere as a fake rendering change. The page reports the zone it ran in
 * (`probe.zone`), so the claim is read back rather than trusted.
 */
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${profile}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
	{ env: pinnedEvidenceEnv(process.env) },
);
let chromeExited = false;
chrome.on("exit", () => {
	chromeExited = true;
});
const wsUrl = await new Promise((resolve, reject) => {
	let buffer = "";
	const timer = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
	chrome.stderr.on("data", (chunk) => {
		buffer += chunk.toString();
		const match = buffer.match(DEVTOOLS_URL);
		if (match) {
			clearTimeout(timer);
			resolve(match[1]);
		}
	});
});
const browser = new WebSocket(wsUrl);
await new Promise((resolve) => {
	browser.onopen = resolve;
});
let nextId = 1;
const pending = new Map();
browser.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
const raw = (method, params, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		browser.send(
			JSON.stringify({
				id,
				method,
				params: params ?? {},
				...(sessionId ? { sessionId } : {}),
			}),
		);
	});

/* ------------------------------------------------------------------- one page ---- */

/**
 * A page in a fresh browser context, with the injected readers armed BEFORE the app
 * boots. Everything a case needs hangs off the returned object.
 */
async function openPage(
	arm,
	{
		sampler = false,
		storage = {},
		viewport = { width: 1380, height: 900 },
		theme = "localOperatorDark",
	} = {},
) {
	const { browserContextId } = await raw("Target.createBrowserContext", {});
	const { targetId } = await raw("Target.createTarget", {
		url: "about:blank",
		browserContextId,
	});
	const { sessionId } = await raw("Target.attachToTarget", {
		targetId,
		flatten: true,
	});
	const send = (method, params = {}) => raw(method, params, sessionId);
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: viewport.width,
		height: viewport.height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	const arm_ = (source) =>
		send("Page.addScriptToEvaluateOnNewDocument", { source });
	await arm_(ONBOARDING_SEED);
	await arm_(`(${tapSource.toString()})()`);
	if (sampler) await arm_(`(${samplerSource.toString()})(${sampler})`);
	/*
	 * Dark is the app's default, so it is NOT seeded: the dark frames are what a first-run
	 * user sees. Light is seeded the way the other live sets seed it
	 * (`row-states-refined`), through the preferences store's own key. The frame's file
	 * name IS its palette: the evidence guard judges a frame against the palette its stem
	 * names, so a mis-seeded theme fails the guard rather than passing as the wrong one.
	 */
	if (theme !== "localOperatorDark") {
		await arm_(
			`try { localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch (error) {}`,
		);
	}
	for (const [key, value] of Object.entries(storage)) {
		await arm_(
			`try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}); } catch (error) {}`,
		);
	}

	const page = {
		arm,
		theme,
		send,
		async evaluate(expression) {
			const res = await send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (res.exceptionDetails) {
				throw new Error(
					res.exceptionDetails.exception?.description ?? "page error",
				);
			}
			return res.result.value;
		},
		call(fn, ...fnArgs) {
			return page.evaluate(`(${fn.toString()})(...${JSON.stringify(fnArgs)})`);
		},
		async waitFor(expression, label, timeoutMs = 20_000) {
			const start = Date.now();
			for (;;) {
				if (await page.evaluate(expression)) return true;
				if (Date.now() - start > timeoutMs) {
					throw new Error(`timed out waiting for ${label}`);
				}
				await wait(120);
			}
		},
		async navigate(url) {
			await send("Page.navigate", { url });
		},
		probe: () => page.call(probeSource),
		async click(x, y) {
			for (const [type, extra] of [
				["mouseMoved", { button: "none" }],
				["mousePressed", { button: "left", clickCount: 1 }],
				["mouseReleased", { button: "left", clickCount: 1 }],
			]) {
				await send("Input.dispatchMouseEvent", { type, x, y, ...extra });
			}
		},
		/** Press a selector the way a user does: scroll to it, hit-test its centre, click. */
		async press(selector, label = selector) {
			const target = await page.call(targetSource, selector);
			if (!target) throw new Error(`no ${label} on the page`);
			if (!target.hittable)
				throw new Error(`${label} is not hittable at its centre`);
			await page.click(target.x, target.y);
		},
		/** Press a sidebar conversation row (the way a user switches conversations). */
		async pressRow(key) {
			const row = await page.call(rowSource, TITLE[key]);
			if (!row) throw new Error(`no sidebar row for ${TITLE[key]}`);
			if (!row.hittable)
				throw new Error(`the ${TITLE[key]} row is not hittable`);
			await wait(300);
			const settled = await page.call(rowSource, TITLE[key]);
			await page.click(settled.x, settled.y);
			await page.waitFor(
				`location.hash.includes(${JSON.stringify(SESSION[key])})`,
				`the switch to ${TITLE[key]}`,
			);
		},
		async type(text) {
			await send("Input.insertText", { text });
		},
		async key(name, code, vk, text) {
			await send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key: name,
				code,
				windowsVirtualKeyCode: vk,
				...(text ? { text, unmodifiedText: text } : {}),
			});
			await send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key: name,
				code,
				windowsVirtualKeyCode: vk,
			});
		},
		async shot(state) {
			const { data } = await send("Page.captureScreenshot", { format: "png" });
			const dir = join(OUT, arm, state);
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${theme}.webp`);
			await sharp(Buffer.from(data, "base64"))
				.webp({ quality: 92 })
				.toFile(file);
			return `${arm}/${state}/${theme}.webp`;
		},
		async startSampler(ms) {
			await page.call(samplerSource, ms);
		},
		tap: () => page.evaluate("window.__tap"),
		async timeline() {
			return summariseTimeline(
				(await page.evaluate(
					"window.__timeline ? window.__timeline.marks : []",
				)) ?? [],
			);
		},
		async close() {
			try {
				await raw("Target.disposeBrowserContext", { browserContextId });
			} catch {
				/* the page may already be gone */
			}
		},
	};
	return page;
}

/**
 * The sampler's marks, reduced to what a reader needs: the frames at which something
 * visible CHANGED, and the three numbers the policy has to keep small.
 */
function summariseTimeline(marks) {
	const key = (m) =>
		JSON.stringify([
			m.hash,
			m.drawer,
			m.surface,
			m.slot,
			m.rows,
			m.chip,
			m.composer,
		]);
	const transitions = [];
	let last = null;
	for (const mark of marks) {
		if (key(mark) !== last) transitions.push(mark);
		last = key(mark);
	}
	const withDrawer = marks.filter((m) => m.drawer);
	const composers = marks.filter((m) => m.composer);
	return {
		frames: marks.length,
		framesWithDrawer: withDrawer.length,
		framesWithSlot: marks.filter((m) => m.slot).length,
		firstDrawerAtMs: withDrawer[0]?.t ?? null,
		firstDrawerRows: withDrawer[0]?.rows ?? null,
		framesWithDrawerAndNoRows: withDrawer.filter((m) => m.rows === 0).length,
		composerFirst: composers[0]?.composer ?? null,
		composerSettled: composers.at(-1)?.composer ?? null,
		transitions: transitions.slice(0, 24),
	};
}

/* ------------------------------------------------------------ rig side channel ---- */

let commandSeq = 0;
/** Send one command to an owner process and wait for its answer (see serve-open.py). */
async function command(key, body) {
	const dir = join(SCRATCH, "cmd", SESSION[key]);
	mkdirSync(dir, { recursive: true });
	commandSeq += 1;
	const name = `${String(commandSeq).padStart(4, "0")}`;
	writeFileSync(join(dir, `${name}.tmp`), JSON.stringify(body));
	renameSync(join(dir, `${name}.tmp`), join(dir, `${name}.json`));
	const done = join(dir, `${name}.done.json`);
	for (let i = 0; i < 150; i += 1) {
		if (existsSync(done)) {
			const result = JSON.parse(readFileSync(done, "utf8"));
			rmSync(done, { force: true });
			if (!result.ok)
				throw new Error(`owner refused ${body.op}: ${result.error}`);
			return result;
		}
		await wait(100);
	}
	throw new Error(`owner ${SESSION[key]} never answered ${body.op}`);
}

/** The ask log's event kinds and the transcript's text, read from disk: the side effects. */
function backendReading(key, needle) {
	const dir = join(SCRATCH, "config", "sessions", SESSION[key]);
	const lines = (file) =>
		existsSync(join(dir, file))
			? readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean)
			: [];
	const kinds = lines("asks.jsonl").map((line) => {
		try {
			return JSON.parse(line).kind ?? "?";
		} catch {
			return "unparsed";
		}
	});
	const transcript = lines("transcript.jsonl");
	return {
		askEventKinds: kinds,
		transcriptLines: transcript.length,
		transcriptHasMessage: needle
			? transcript.some((line) => line.includes(needle))
			: null,
	};
}

/* ------------------------------------------------------------------- the cases ---- */

const SETTLE = 2500;
const ready = async (page) => {
	await page.waitFor(
		`document.querySelector(${JSON.stringify(COMPOSER)}) !== null`,
		"the composer",
	);
};
const open = async (page, arm, key) => {
	await page.navigate(
		`${arm === "before" ? BEFORE : AFTER}/#/chat/${SESSION[key]}`,
	);
	await ready(page);
	await page.waitFor(
		`location.hash.includes(${JSON.stringify(SESSION[key])})`,
		`the ${TITLE[key]} route`,
	);
};
/*
 * THE SAME TEXT ON BOTH ARMS. An earlier cut of this driver labelled it with the arm, and
 * that put "(before arm)" into the transcript of the frame it was being compared with;
 * each arm now runs against a freshly seeded rig (see the README's commands), so the two
 * frames differ by the renderer tree and nothing else.
 */
const MESSAGE = () =>
	"Carry on with the rest of the checklist - I will answer the question shortly.";
const DRAFT = "half a thought about the rollout window";

/**
 * The pending-on-open state in a window narrower than the default one, on BOTH arms: the
 * old tree shows the closed chip at that width and the new one shows the drawer the policy
 * opened, so the pair reads what an auto-open costs a small window. 800x600 is the app's
 * own declared floor (`WINDOW_MIN_WIDTH` x `WINDOW_MIN_HEIGHT`, `src/main/window-mode.ts`).
 */
const narrowCase = (name, width, height) => ({
	name,
	title: `pending on open in a ${width}x${height} window`,
	arms: ["before", "after"],
	viewport: { width, height },
	async run(page, arm) {
		await open(page, arm, "A");
		await page.waitFor(
			`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
			"the chip",
		);
		if (arm === "after") {
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the auto-opened drawer",
				15_000,
			);
			await wait(900);
		} else {
			await wait(SETTLE);
		}
		return {
			probe: await page.probe(),
			frame: await page.shot(`state-${name.slice(1)}-${width}`),
		};
	},
});

const CASES = [
	{
		name: "s1",
		title: "no asks on open",
		arms: ["before", "after"],
		async run(page, arm) {
			await open(page, arm, "B");
			await wait(SETTLE);
			const probe = await page.probe();
			return { probe, frame: await page.shot("state-1-no-asks") };
		},
	},
	{
		name: "s2",
		title: "pending on open",
		arms: ["before", "after"],
		sampler: 6000,
		async run(page, arm) {
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
				await wait(900);
			} else {
				await wait(SETTLE);
			}
			const probe = await page.probe();
			const frame = await page.shot("state-2-pending-on-open");
			await wait(3500);
			return {
				probe,
				frame,
				tap: await page.tap(),
				timeline: await page.timeline(),
			};
		},
	},
	{
		name: "s2l",
		title: "pending on open, light palette",
		arms: ["before", "after"],
		theme: "localOperatorLight",
		async run(page, arm) {
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
				await wait(900);
			} else {
				await wait(SETTLE);
			}
			return {
				probe: await page.probe(),
				// The same directory as the dark frame: one directory per surface, one file
				// per palette, which is the repository's layout.
				frame: await page.shot("state-2-pending-on-open"),
			};
		},
	},
	{
		name: "s3",
		title: "all addressed on open",
		arms: ["before", "after"],
		async run(page, arm) {
			await open(page, arm, "C");
			await wait(SETTLE);
			const probe = await page.probe();
			return { probe, frame: await page.shot("state-3-all-addressed") };
		},
	},
	{
		name: "s4",
		title: "dismissed while pending",
		arms: ["after"],
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "D");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the auto-opened drawer",
				15_000,
			);
			await wait(900);
			readings.opened = await page.probe();

			// 1. The user closes it with the chrome's X while the ask is pending.
			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"the drawer closing",
			);
			await wait(900);
			readings.dismissed = await page.probe();
			readings.frameDismissed = await page.shot("state-4a-dismissed");

			// 2. A queue REFRESH with no change in content: a new frame, the same asks.
			await command("D", { op: "publish" });
			await wait(SETTLE);
			readings.afterRefresh = await page.probe();

			// 3. RE-RENDERS: the composer's own state flips under the page (a character in,
			//    a character out), which re-runs the hook with a changed fact.
			await page.press(COMPOSER, "the composer");
			await page.type("x");
			await wait(400);
			await page.key("Backspace", "Backspace", 8);
			await wait(SETTLE);
			readings.afterReRender = await page.probe();

			// 4. A NEW ask arrives (well past the arrival skew, so both the decided-view rule
			//    and the created-after-the-view rule agree it is an arrival).
			await command("D", {
				op: "enqueue",
				question_id: "region",
				question: "Which region should the release notes go out to?",
				options: ["us-east", "eu-west"],
			});
			await wait(3000);
			readings.afterArrival = await page.probe();
			readings.frameArrival = await page.shot("state-4b-new-ask-arrived");

			// 5. SWITCH AWAY AND BACK: a new view of the same conversation.
			await page.pressRow("B");
			await wait(1500);
			readings.awayOnB = await page.probe();
			await page.startSampler(4500);
			await page.pressRow("D");
			await wait(SETTLE + 1500);
			readings.backOnD = await page.probe();
			readings.switchBackTimeline = await page.timeline();
			readings.frameSwitchBack = await page.shot("state-4c-switched-back");

			// 6. A FRESH PAGE LIFETIME. The dismissal record is module memory, so a reload (the
			//    page's version of an app restart) is allowed to open the drawer again: rule 4
			//    asks for respect within a lifetime, not for a mute that outlives it. The
			//    document's own `timeOrigin` before and after proves the page really restarted
			//    rather than the case reading a document that never reloaded.
			readings.timeOriginBefore = await page.evaluate("performance.timeOrigin");
			await page.send("Page.reload", {});
			await page.waitFor(
				`performance.timeOrigin !== ${readings.timeOriginBefore}`,
				"the document to restart",
			);
			await ready(page);
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer after a reload",
				15_000,
			);
			await wait(900);
			readings.timeOriginAfter = await page.evaluate("performance.timeOrigin");
			readings.afterReload = await page.probe();
			readings.frameReload = await page.shot("state-4d-reload-opens-again");
			return readings;
		},
	},
	{
		name: "s5",
		title: "send a normal message with the drawer up",
		arms: ["before", "after"],
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
			} else {
				// The before tree never opens it: the user's own press on the chip is the door,
				// so this arm is the CONTROL for "a drawer the user opened behaves the same".
				await wait(SETTLE);
				await page.press(CHIP, "the asks chip");
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the drawer opened by the chip",
				);
			}
			await wait(900);
			readings.drawerUp = await page.probe();

			const text = MESSAGE();
			await page.press(COMPOSER, "the composer");
			await page.type(text);
			await wait(300);
			readings.typed = await page.probe();
			await page.key("Enter", "Enter", 13, "\r");
			await page.waitFor(
				`document.body.innerText.includes(${JSON.stringify(text.slice(0, 40))})`,
				"the sent message in the transcript",
			);
			await page.waitFor(
				`document.body.innerText.includes("Noted. I will carry on")`,
				"the assistant's reply",
				30_000,
			);
			await wait(1200);
			readings.sent = await page.probe();
			readings.frame = await page.shot("state-5-send-normal-message");
			readings.backend = backendReading("A", text.slice(0, 40));
			readings.records = (await command("A", { op: "records" })).records;
			return readings;
		},
	},
	{
		name: "s6",
		title: "composer holds a draft on open",
		arms: ["after"],
		storage: {
			"conversation-input-store": {
				state: {
					inputByConversation: {
						[SESSION.A]: {
							currentInput: DRAFT,
							submittedMessages: [],
							currentHistoryIndex: null,
							replies: [],
							attachments: [],
						},
					},
				},
				version: 0,
			},
		},
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			await wait(SETTLE + 1000);
			readings.withDraft = await page.probe();
			readings.frame = await page.shot("state-6-composer-has-draft");

			// THE LATCH: clear the box. The view decided on open, so it stays shut.
			await page.press(COMPOSER, "the composer");
			await page.evaluate(
				`(() => { const el = document.querySelector(${JSON.stringify(COMPOSER)}); el.select(); return true; })()`,
			);
			await page.key("Backspace", "Backspace", 8);
			await wait(SETTLE);
			readings.afterClear = await page.probe();
			return readings;
		},
	},
	{
		name: "s7",
		title:
			"the drawer the policy opened is not carried onto a dismissed conversation",
		arms: ["after"],
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "D");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer on D",
				15_000,
			);
			await wait(900);
			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"D's drawer closing",
			);
			await wait(600);

			// Go to A: never dismissed in this page, so the policy opens it for A.
			await page.pressRow("A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer on A",
				15_000,
			);
			await wait(900);
			readings.onA = await page.probe();

			// Back to D: the flag is up, carried from A. D was dismissed.
			await page.startSampler(4500);
			await page.pressRow("D");
			await wait(SETTLE + 1500);
			readings.backOnD = await page.probe();
			readings.timeline = await page.timeline();
			readings.frame = await page.shot("state-7-carried-closed");
			return readings;
		},
	},
	{
		name: "s8",
		title:
			"an ask that arrives while the conversation is open does not open it; a new view of it does",
		arms: ["after"],
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "B");
			await wait(SETTLE);
			readings.opened = await page.probe();

			// The agent raises its first question while the user is watching: an ARRIVAL.
			await command("B", {
				op: "enqueue",
				question_id: "audience",
				question: "Who should receive the notes from the review call?",
				options: ["The team", "Only me"],
			});
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip for the arrived ask",
				15_000,
			);
			await wait(3000);
			readings.afterArrival = await page.probe();
			readings.frameArrival = await page.shot("state-8a-arrival-stays-closed");

			// A NEW VIEW of the same conversation: the ask now pre-dates it, so it is
			// pending on open, and B was never dismissed, so the policy opens it once.
			await page.pressRow("C");
			await wait(1500);
			readings.awayOnC = await page.probe();
			await page.pressRow("B");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer on the new view of B",
				15_000,
			);
			await wait(900);
			readings.newView = await page.probe();
			readings.frameNewView = await page.shot("state-8b-new-view-opens");
			return readings;
		},
	},
	{
		name: "s11",
		title:
			"a runtime with no queued-ask engine (unsupported / unpublished): nothing to open",
		arms: ["before", "after"],
		async run(page, arm) {
			await open(page, arm, "E");
			await wait(SETTLE + 1500);
			const probe = await page.probe();
			return { probe, frame: await page.shot("state-11-no-engine") };
		},
	},
	narrowCase("s9a", 1024, 768),
	narrowCase("s9b", 800, 600),
	{
		name: "s9c",
		title:
			"CONTROL: the old tree at 1024x768 and 800x600, the drawer opened by the user's own press on the chip",
		arms: ["before"],
		async run(_page, arm) {
			/*
			 * ONE FRESH BROWSER CONTEXT PER WIDTH, and the press is OBSERVED rather than
			 * waited for. A first cut reused one page across both widths and threw when the
			 * drawer did not appear, which made "the old tree cannot open the drawer at the
			 * floor width" and "my harness left a stale page" the same red line. A reading
			 * that can be either is not a reading, so each width gets its own page and the
			 * outcome of the press is recorded at three instants whatever it is.
			 */
			const readings = {};
			for (const [label, width, height] of [
				["w1024", 1024, 768],
				["w800", 800, 600],
			]) {
				const own = await openPage(arm, { viewport: { width, height } });
				try {
					await open(own, arm, "A");
					await own.waitFor(
						`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
						"the chip",
					);
					await wait(SETTLE);
					readings[`${label}Closed`] = await own.probe();
					await own.press(CHIP, "the asks chip");
					await wait(150);
					readings[`${label}At150ms`] = await own.probe();
					await wait(450);
					readings[`${label}At600ms`] = await own.probe();
					await wait(2000);
					readings[`${label}Open`] = await own.probe();
					readings[`${label}Frame`] = await own.shot(
						`state-9c-${label}-user-press`,
					);
				} finally {
					await own.close();
				}
			}
			return readings;
		},
	},
	{
		name: "s12",
		title:
			"Escape pressed in the composer with the drawer up: the lane's existing claim collapses the drawer, and it counts as a dismissal",
		arms: ["before", "after"],
		async run(page, arm) {
			/*
			 * NOT A CHANGE THIS SET MAKES, a measurement of one it makes reachable. The window
			 * listener in `chat-page.tsx` claims Escape for the drawer WHILE THE DRAWER IS OPEN
			 * (it must: the composer is exempt from the interrupt ladder's own Escape owner, so
			 * without the claim the same press would stop the running turn while the drawer
			 * stayed up). Before this change that claim was armed only by a user who had opened
			 * the drawer on purpose; the open policy arms it on every conversation that lands
			 * with a pending ask. So the first Escape in the box now closes the drawer and the
			 * SECOND is the one that reaches the ladder. Recorded here so the design/UX round
			 * judges it with a reading rather than a paragraph.
			 */
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
			} else {
				await wait(SETTLE);
				await page.press(CHIP, "the asks chip");
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the drawer opened by the chip",
				);
			}
			await wait(900);
			await page.press(COMPOSER, "the composer");
			await wait(300);
			readings.beforeEscape = await page.probe();
			await page.key("Escape", "Escape", 27);
			await wait(900);
			readings.afterEscape = await page.probe();
			if (arm === "after") {
				// An Escape close is a dismissal: a queue refresh must not bring it back.
				await command("A", { op: "publish" });
				await wait(SETTLE);
				readings.afterRefresh = await page.probe();
			}
			return readings;
		},
	},
	{
		name: "s13",
		title:
			"the Other row: auto-open takes no focus into it, the user's press does, and a closed drawer is not re-opened over typed text",
		arms: ["after"],
		async run(page, arm) {
			/*
			 * THE INTERACTION BETWEEN THIS CHANGE AND THE ASK CARD'S OTHER ROW, measured. The card
			 * keeps its typed text in the card's own draft (`canonical.askDrafts`), a different
			 * cell from the composer's (`inputByConversation`) which the policy's no-focus-theft
			 * guard reads. So four facts, each of which a regression could break:
			 *   1. the auto-opened drawer shows the Other row and does NOT focus its field;
			 *   2. pressing the row is the user's own act: it focuses the field;
			 *   3. typing there does not make the composer "hold text", and the user's close
			 *      afterwards is respected (a dismissal) exactly as any other close;
			 *   4. a queue refresh after that close does not re-open it over the typed text.
			 */
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the auto-opened drawer",
				15_000,
			);
			await wait(900);
			readings.opened = await page.probe();
			readings.frameOpened = await page.shot("state-13a-other-row-present");

			await page.press("[data-ask-option-other]", "the Other row");
			await wait(500);
			readings.afterRowPress = await page.probe();
			await page.type("Roll out to the canary ring first");
			await wait(400);
			readings.typed = await page.probe();
			readings.frameTyped = await page.shot("state-13b-other-typed");

			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"the drawer closing",
			);
			await wait(600);
			readings.closedOverText = await page.probe();
			await command("A", { op: "publish" });
			await wait(SETTLE);
			readings.afterRefresh = await page.probe();

			/*
			 * THE USER'S OWN DOOR AFTER A DISMISSAL. Respecting a dismissal is "the policy does
			 * not re-open it", never "the user may not": pressing the chip must open the drawer
			 * on this dismissed conversation, and the card seeds its Other field from the draft
			 * (`ask-panel.tsx`'s `AskOther`), so the text typed before the close is still there.
			 */
			await page.press(CHIP, "the asks chip");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer reopened by the user's press",
			);
			await wait(900);
			readings.reopenedByChip = await page.probe();
			readings.frameReopened = await page.shot(
				"state-13c-reopened-by-the-user",
			);
			return readings;
		},
	},
	{
		name: "s14",
		title:
			"a durable pane (the canvas) holds the slot: the policy borrows it, and the close gives it back",
		arms: ["before", "after"],
		/*
		 * The canvas flag is PERSISTED (`persistedUiPreferences` keeps the four durable
		 * panes and drops only the drawer's own), so seeding it is the same state a user
		 * who left the canvas open last session starts from.
		 */
		storage: {
			"ui-preferences-storage": {
				state: { isCanvasOpen: true },
				version: 1,
			},
		},
		async run(page, arm) {
			/*
			 * THE JUDGMENT CALL THIS MEASURES: auto-open BORROWS the slot from a durable pane,
			 * exactly as a press on the chip does, instead of yielding to it. Yielding would make
			 * the feature a no-op for precisely the user who keeps a pane open; borrowing means
			 * that user's pane is replaced on arrival and handed back by the close. The old tree
			 * keeps the canvas up and the chip collapsed, which is the "before" half.
			 */
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
			} else {
				await wait(SETTLE);
			}
			await wait(900);
			readings.arrived = await page.probe();
			readings.frame = await page.shot("state-14-canvas-holds-the-slot");
			if (arm === "after") {
				await page.press(CLOSE, "the Close asks control");
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
					"the drawer closing",
				);
				await wait(900);
				readings.afterClose = await page.probe();
				readings.frameAfterClose = await page.shot(
					"state-14b-canvas-handed-back",
				);
			}
			return readings;
		},
	},
	{
		name: "s10",
		title: "closing the drawer with its X: where the keyboard lands",
		arms: ["before", "after"],
		async run(page, arm) {
			const readings = {};
			await open(page, arm, "A");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(CHIP)}) !== null`,
				"the chip",
			);
			if (arm === "after") {
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the auto-opened drawer",
					15_000,
				);
			} else {
				// The old tree never opens it, so the press on the chip is the way in.
				await wait(SETTLE);
				await page.press(CHIP, "the asks chip");
				await page.waitFor(
					`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
					"the drawer opened by the chip",
				);
			}
			await wait(900);
			readings.open = await page.probe();
			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"the drawer closing",
			);
			await wait(600);
			readings.closed = await page.probe();
			return readings;
		},
	},
	{
		name: "s15",
		title:
			"the dismissal names the asks it waved off: a partial resolve holds, a refill while away opens",
		arms: ["after"],
		async run(page, arm) {
			const readings = {};
			/*
			 * A SECOND outstanding ask on F before any view of it exists, so the close below
			 * waves off TWO asks and a partial resolve is possible at all. Both pre-date the
			 * page, so both are "pending on open".
			 */
			await command("F", {
				op: "enqueue",
				question_id: "region",
				question: "Which region should the staging rollout start in?",
				options: ["us-east", "eu-west"],
			});
			const start = (await command("F", { op: "records" })).records;
			readings.recordsAtStart = start;
			const first = start.find((row) =>
				row.question_ids.includes("deploy-target"),
			);
			const second = start.find((row) => row.question_ids.includes("region"));
			if (!first || !second) throw new Error("F did not hold both asks");

			await open(page, arm, "F");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the auto-opened drawer on F",
				15_000,
			);
			await wait(900);
			readings.opened = await page.probe();
			readings.namedAtOpen = await page.call(askRowIdsSource);

			// 1. The user closes it over TWO outstanding asks: both are waved off.
			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"the drawer closing",
			);
			await wait(900);
			readings.dismissedOverTwo = await page.probe();
			readings.frameDismissed = await page.shot("state-15a-dismissed-over-two");

			// 2. E1. While the user is on another conversation ONE of the two is answered.
			await page.pressRow("C");
			await wait(1500);
			await command("F", {
				op: "answer",
				ask_id: first.ask_id,
				answers: { "deploy-target": ["Staging"] },
			});
			await page.startSampler(4500);
			await page.pressRow("F");
			await wait(SETTLE + 1500);
			readings.afterPartialResolve = await page.probe();
			readings.partialTimeline = await page.timeline();
			readings.framePartial = await page.shot(
				"state-15b-partial-resolve-holds",
			);

			// 3. E2/E3. The user leaves again; the OTHER ask is answered AND a new batch is
			//    queued while they are away, so no frame the page sees ever shows F empty.
			await page.pressRow("C");
			await wait(1500);
			await command("F", {
				op: "answer",
				ask_id: second.ask_id,
				answers: { region: ["us-east"] },
			});
			await command("F", {
				op: "enqueue",
				question_id: "window",
				question: "Which maintenance window should the rollout use?",
				options: ["Tonight", "This weekend"],
			});
			await page.pressRow("F");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer for the new batch on F",
				15_000,
			);
			await wait(900);
			readings.afterRefill = await page.probe();
			readings.namedAfterRefill = await page.call(askRowIdsSource);
			readings.frameRefill = await page.shot("state-15c-refill-opens");
			readings.recordsAtEnd = (await command("F", { op: "records" })).records;
			return readings;
		},
	},
	{
		name: "s16",
		title:
			"a list the wire could not carry whole: the dismissal holds until a complete frame shows nothing outstanding",
		arms: ["after"],
		async run(page, arm) {
			const readings = {};
			/*
			 * EIGHT asks of about nine hundred characters each, queued before any view exists.
			 * The queue's own cap is eight open asks, and the core's text budget for the ask
			 * field is six thousand characters with the head row exempt, so the wire ships a
			 * PREFIX (seven rows, `asks_truncated`) beside a tally of eight. Derived from the
			 * shipped `ask_wire` + `bound_ask_rows` rather than assumed: the README quotes the
			 * run. What the page then shows is the proof that the prefix reached it.
			 */
			const body =
				"The migration has reached a point where the next step cannot be undone, so I want your decision before I go on. The batch touches the customer ledger, the invoice archive and the audit trail in one transaction, and the rollback window closes once it commits. ";
			/*
			 * NINE HUNDRED CHARACTERS EXACTLY, because the budget arithmetic is the point:
			 * a row's charge is its question plus its option labels (about 910 here), the head
			 * row is exempt, so the tail spends 6 x 910 = 5,460 of the 6,000 and the seventh
			 * would take it to 6,370 - seven rows ride. At 811 characters (the first cut of
			 * this case) seven tail rows cost 5,747, all eight fit, and there was no prefix to
			 * photograph; the guard below is what caught that instead of a frame that claimed one.
			 */
			const text = (n) =>
				`Batch ${n} of 8: should I commit it? ${body.repeat(Math.ceil(900 / body.length))}`.slice(
					0,
					900,
				);
			for (let i = 1; i <= 8; i += 1) {
				await command("G", {
					op: "enqueue",
					question_id: `batch-${i}`,
					question: text(i),
					options: ["Commit", "Skip"],
				});
			}
			const byId = new Map(
				(await command("G", { op: "records" })).records.map((row) => [
					row.ask_id,
					row,
				]),
			);
			readings.askCountAtStart = byId.size;

			await open(page, arm, "G");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the auto-opened drawer on G",
				15_000,
			);
			await wait(1200);
			readings.opened = await page.probe();
			const named = await page.call(askRowIdsSource);
			readings.named = named;
			readings.frameTruncated = await page.shot(
				"state-16a-truncated-prefix-opens",
			);
			const unnamed = [...byId.keys()].filter((id) => !named.includes(id));
			readings.unnamed = unnamed;
			if (named.length === 0 || unnamed.length === 0)
				throw new Error(
					`expected a prefix: ${named.length} rows named, ${unnamed.length} left out`,
				);

			// 1. The close waves off the SEVEN asks it could name; the eighth was never shown.
			await page.press(CLOSE, "the Close asks control");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) === null`,
				"the drawer closing",
			);
			await wait(900);
			readings.dismissed = await page.probe();

			// 2. While away, every ask the user SAW is answered. The one that remains is an id
			//    the record never held - and the record cannot tell it from one it waved off.
			await page.pressRow("C");
			await wait(1500);
			for (const id of named) {
				const questionId = byId.get(id).question_ids[0];
				await command("G", {
					op: "answer",
					ask_id: id,
					answers: { [questionId]: ["Commit"] },
				});
			}
			await page.startSampler(4500);
			await page.pressRow("G");
			await wait(SETTLE + 1500);
			readings.afterNamedAnswered = await page.probe();
			readings.holdTimeline = await page.timeline();
			readings.frameHolds = await page.shot("state-16b-unknown-list-holds");

			// 3. The last one is answered with the view open: a COMPLETE frame with nothing
			//    outstanding, which is the one observation that settles an unknown list.
			for (const id of unnamed) {
				const questionId = byId.get(id).question_ids[0];
				await command("G", {
					op: "answer",
					ask_id: id,
					answers: { [questionId]: ["Commit"] },
				});
			}
			await wait(SETTLE);
			readings.afterAllAnswered = await page.probe();

			// 4. A new batch, and a NEW view of G: the record is gone, so it opens.
			await command("G", {
				op: "enqueue",
				question_id: "followup",
				question: "Batch 9 is ready: should I go ahead with it?",
				options: ["Commit", "Skip"],
			});
			await page.pressRow("C");
			await wait(1500);
			await page.pressRow("G");
			await page.waitFor(
				`document.querySelector(${JSON.stringify(DRAWER)}) !== null`,
				"the drawer for the new batch on G",
				15_000,
			);
			await wait(900);
			readings.afterNewBatch = await page.probe();
			readings.frameNewBatch = await page.shot(
				"state-16c-complete-empty-frame-then-new-batch-opens",
			);
			return readings;
		},
	},
];

/* ----------------------------------------------------------------------- run ---- */

/*
 * RUN ORDER IS NOT ID ORDER, and the reason is shared state. Every case photographs one
 * backend (seven owner processes), and some cases WRITE to it: s4 queues a second ask on
 * D, s5 sends a message into A's transcript, s8 queues an ask on B. A frame taken after a
 * writer has run would picture a queue or a transcript that the state it names does not
 * have (the first cut of this set did exactly that: the old tree's sent message sat in
 * the new tree's frame). So the read-only cases run first and the writers last, and each
 * arm runs against a rig started fresh for it (the README's commands), which keeps one
 * arm's writes out of the other's frames.
 */
const RUN_ORDER = [
	"s1",
	"s2",
	"s2l",
	"s3",
	"s11",
	"s6",
	"s7",
	"s9a",
	"s9b",
	"s9c",
	"s12",
	"s13",
	"s14",
	"s10",
	"s4",
	"s5",
	"s8",
	"s15",
	"s16",
];
for (const testCase of CASES) {
	if (!RUN_ORDER.includes(testCase.name)) {
		throw new Error(`case ${testCase.name} is missing from RUN_ORDER`);
	}
}
CASES.sort((a, b) => RUN_ORDER.indexOf(a.name) - RUN_ORDER.indexOf(b.name));

const report = {
	arms: {},
	notes: {
		after: AFTER,
		before: BEFORE,
		viewport: "1380x900 @1x, one headless Chrome, one browser context per case",
	},
};

try {
	if (EXPLORE) {
		const exploreArm = AFTER ? "after" : "before";
		const page = await openPage(exploreArm);
		const out = {};
		for (const key of ["A", "B", "C", "D", "E"]) {
			await open(page, exploreArm, key);
			await wait(SETTLE);
			out[key] = await page.probe();
		}
		out.sidebarButtons = await page.evaluate(
			`[...document.querySelectorAll("nav button")].map((b) => b.innerText.replace(/\\s+/g, " ").trim().slice(0, 80))`,
		);
		report.explore = out;
		await page.close();
	} else {
		mkdirSync(OUT, { recursive: true });
		const arms = ["before", "after"].filter((arm) =>
			arm === "before" ? BEFORE : AFTER,
		);
		for (const arm of arms) {
			report.arms[arm] = {};
			for (const testCase of CASES) {
				if (!testCase.arms.includes(arm)) continue;
				if (ONLY.length > 0 && !ONLY.includes(testCase.name)) continue;
				const page = await openPage(arm, {
					sampler: testCase.sampler ?? false,
					storage: testCase.storage ?? {},
					viewport: testCase.viewport,
					theme: testCase.theme,
				});
				const started = Date.now();
				try {
					const result = await testCase.run(page, arm);
					report.arms[arm][testCase.name] = {
						title: testCase.title,
						ok: true,
						ms: Date.now() - started,
						...result,
					};
				} catch (error) {
					report.arms[arm][testCase.name] = {
						title: testCase.title,
						ok: false,
						error: String(error?.stack ?? error),
					};
					try {
						report.arms[arm][testCase.name].probe = await page.probe();
						report.arms[arm][testCase.name].failureFrame = await page.shot(
							`failure-${testCase.name}`,
						);
					} catch {
						/* the page may be gone; the error above is the record */
					}
				} finally {
					await page.close();
				}
			}
			if (arm === "before" || arm === "after") {
				writeFileSync(
					join(OUT, `run-${arm}.json`),
					`${JSON.stringify({ arm, origin: arm === "before" ? BEFORE : AFTER, cases: report.arms[arm] }, null, 2)}\n`,
				);
			}
		}
	}
} catch (error) {
	report.fatal = String(error?.stack ?? error);
} finally {
	console.log(JSON.stringify(report, null, 2));
	try {
		await raw("Browser.close");
	} catch {
		/* already gone */
	}
	if (!chromeExited) chrome.kill();
	await wait(800);
	rmSync(profile, { recursive: true, force: true });
	/*
	 * Survivors, by the profile path this run created (never by program name): Chrome's
	 * helper processes carry the same --user-data-dir, so a leaked one is visible here.
	 */
	const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
	const leaked = ps.stdout
		.split("\n")
		.filter((line) => line.includes(profile) && !line.includes("ps -axo"));
	console.error(
		leaked.length === 0
			? `reaped: no process holds ${profile}`
			: `LEAKED ${leaked.length} process(es) holding ${profile}:\n${leaked.join("\n")}`,
	);
}
