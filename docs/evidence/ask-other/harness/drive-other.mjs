/**
 * The `ask-other` matrix, driven through the SHIPPED renderer of one or more trees
 * against a real daemon (see `serve-other.py`), with ONE reused headless Chrome.
 *
 *   node drive-other.mjs <out-dir> <label>,<origin>,<scratch> [<label>,<origin>,<scratch> ...]
 *                        [--only=a,b,f] [--audit=<path to design-qa's dom_audit.mjs>]
 *
 * A label is `before` (the unfixed tree: the Other row must be ABSENT), `after` (the
 * branch: it must be PRESENT, and a run that cannot find it fails rather than
 * photographing a card that is not the subject), or `r0`/`r1` (the round-1 head and its
 * remediation - BOTH carry the row, and the pair is read as a delta of the same steps).
 * Each run takes the SAME steps in the SAME order, so a frame pair differs by the tree
 * and nothing else.
 *
 * WHAT IS REAL: the page is the app's own `index.html` and `main.tsx`; every press is a
 * CDP mouse event at the element's measured centre (hit-tested first, so a press that
 * would land on something else fails instead of passing); Enter and Escape are real key
 * events; text goes in through `Input.insertText`, which fires the same `beforeinput` /
 * `input` events as typing and is what an IME or a paste produces; and what happened
 * AFTERWARDS is read from the daemon, not from the page: the append-only `asks.jsonl`,
 * the provider-call record, and the history route.
 *
 * WHAT IS NOT: the Electron IPC/preload channel and a packaged native window (the
 * renderer is served for a browser and talks to `/__desktop`, the route the transport
 * validator and the answer op run on), and the model (a recording stub that answers in
 * one line and never calls a tool).
 *
 * HYGIENE: one Chrome for the whole invocation, through the repo's mock-keychain helper
 * (a headless Chrome with no keychain asks macOS to create one); it is closed through
 * the browser's own `Browser.close`, killed by EXACT pid if that fails, and its profile
 * directory is removed. A secret field's value is never read back into the report.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const args = process.argv.slice(2);
const flag = (name) =>
	args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith("--"));
const OUT = positional[0];
const RUNS = positional.slice(1).map((spec) => {
	const [label, origin, scratch] = spec.split(",");
	if (!label || !origin || !scratch)
		throw new Error(`bad run spec ${JSON.stringify(spec)}`);
	/*
	 * WHICH ARMS CARRY THE `Other` ROW: `after` against the unfixed `before`, and BOTH
	 * of the round-1 pair (`r0`, the head, and `r1`, its remediation) - the r0/r1 delta
	 * is how the row behaves, not whether it exists, so either arm missing it still
	 * fails loudly.
	 */
	return {
		label,
		origin,
		scratch,
		expectOther: label.startsWith("after") || label.startsWith("r"),
	};
});
if (!OUT || RUNS.length === 0)
	throw new Error(
		"usage: drive-other.mjs <out-dir> <label>,<origin>,<scratch> ...",
	);
const ONLY = flag("only")?.split(",");
const AUDIT = flag("audit");
const THEME_FLAG = flag("theme");
const THEME = THEME_FLAG ?? "localOperatorDark";
const TRACE_NET = args.includes("--net");

const SESSION_A = "aaaa11112222";
const SESSION_C = "cccc11112222";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;
/** The scheme and host of a request URL, stripped from the trace so rows read as paths. */
const ORIGIN_PREFIX = /^https?:\/\/[^/]+/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ the browser ---- */

const dataDir = mkdtempSync(join(tmpdir(), "ask-other-rig-"));
const chrome = spawn(
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
let chromeExited = false;
chrome.on("exit", () => {
	chromeExited = true;
});

const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
	chrome.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(DEVTOOLS_URL);
		if (m) {
			clearTimeout(t);
			resolve(m[1]);
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

/*
 * ONE BROWSER, A FRESH TAB PER NAVIGATION - and the reason is a measured artifact of
 * this rig, not a taste. The renderer is served to a browser over plain HTTP/1.1 (the
 * real app talks IPC), and Chrome allows SIX connections per origin. Every page load
 * opens event streams for the sessions it watches, and a tab that is navigated rather
 * than replaced kept enough of them open that by the fifth load a fresh `fetch` from
 * the page sat unanswered for 8 s while the SAME request from this Node process
 * answered in 11 ms (the daemon and the proxy were fine; the browser's own pool was
 * full). Closing the tab tears its sockets down, so each navigation gets a new one.
 * The BROWSER is still launched once for the whole invocation, as the rig hygiene
 * rule requires: this is a tab, not a Chrome.
 */
let currentTarget = null;
let attached = null;
const send = (method, params = {}) => raw(method, params, attached.sessionId);

async function openTab() {
	if (currentTarget) {
		try {
			await raw("Target.closeTarget", { targetId: currentTarget.targetId });
		} catch {
			/* already gone */
		}
	}
	currentTarget = await raw("Target.createTarget", { url: "about:blank" });
	attached = await raw("Target.attachToTarget", {
		targetId: currentTarget.targetId,
		flatten: true,
	});
	await send("Page.enable");
	await send("Runtime.enable");
	if (TRACE_NET) await send("Network.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1380,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	/*
	 * The default palette needs no seed: the app opens on `localOperatorDark`. A
	 * `--theme=` run seeds the PERSISTED preference before any app script runs - the
	 * same key and shape `scripts/capture-evidence.mjs` seeds - because the app reads
	 * its palette from that store, and a flag that only renamed the output file would
	 * photograph one palette under another's name. It is NOT seeded on the default run
	 * on purpose: rewriting the store on every document would also reset what a
	 * previous load left behind (the drawer's open flag, which `openDrawer` reads), so
	 * the default run stays byte-for-byte the run the committed Dark frames came from.
	 */
	const prefsSeed = THEME_FLAG
		? ` localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(THEME)} }, version: 0 }));`
		: "";
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source: `try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); ${prefsSeed} } catch (error) {}`,
	});
}

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(
			res.exceptionDetails.exception?.description ?? "page error",
		);
	return res.result.value;
}

async function waitFor(expression, label, timeoutMs = 20_000) {
	const start = Date.now();
	for (;;) {
		const value = await evaluate(expression);
		if (value) return value;
		if (Date.now() - start > timeoutMs)
			throw new Error(`timed out waiting for ${label}`);
		await wait(120);
	}
}

async function until(fn, label, timeoutMs = 20_000) {
	const start = Date.now();
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() - start > timeoutMs)
			throw new Error(`timed out waiting for ${label}`);
		await wait(120);
	}
}

/* ---------------------------------------------------------------- input and aim ---- */

/**
 * The centre of an element, hit-tested: a press whose centre lands on something else
 * (an overlay, a sibling that grew) fails here instead of silently pressing the wrong
 * thing. `scrollIntoView` first, because the drawer scrolls inside its own pane.
 */
const aim = (selector, text) => `(() => {
	const sel = ${JSON.stringify(selector)};
	const want = ${JSON.stringify(text ?? null)};
	const nodes = [...document.querySelectorAll(sel)];
	const el = want === null
		? nodes[0]
		: nodes.find((n) => {
				const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
				// A leading "~" asks for a substring: the blocking card's buttons carry an
				// ordinal and a badge around the label, so an exact match would never hit.
				return want.startsWith("~") ? t.includes(want.slice(1)) : t === want;
			});
	if (!el) return null;
	el.scrollIntoView({ block: "nearest", inline: "nearest" });
	const r = el.getBoundingClientRect();
	const x = r.left + r.width / 2;
	const y = r.top + r.height / 2;
	const hit = document.elementFromPoint(x, y);
	return {
		x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height),
		hit: Boolean(hit && (el === hit || el.contains(hit))),
		hitTag: hit ? hit.tagName + "." + String(hit.className).slice(0, 40) : null,
		disabled: Boolean(el.disabled),
	};
})()`;

async function press(selector, text) {
	const where = await evaluate(aim(selector, text));
	if (!where) throw new Error(`nothing to press: ${selector} ${text ?? ""}`);
	if (!where.hit)
		throw new Error(
			`press would land on ${where.hitTag}, not ${selector} ${text ?? ""}`,
		);
	for (const [type, extra] of [
		["mouseMoved", { button: "none" }],
		["mousePressed", { button: "left", clickCount: 1 }],
		["mouseReleased", { button: "left", clickCount: 1 }],
	])
		await send("Input.dispatchMouseEvent", {
			type,
			x: where.x,
			y: where.y,
			...extra,
		});
	await wait(180);
	return where;
}

const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function key(name, modifiers = []) {
	const mask = modifiers.reduce((sum, m) => sum | MODS[m], 0);
	const codes = {
		Enter: { vk: 13, native: 36, text: "\r" },
		Escape: { vk: 27, native: 53, text: undefined },
		Backspace: { vk: 8, native: 51, text: undefined },
	};
	const spec = codes[name];
	await send("Input.dispatchKeyEvent", {
		type: spec.text ? "keyDown" : "rawKeyDown",
		key: name,
		code: name,
		windowsVirtualKeyCode: spec.vk,
		nativeVirtualKeyCode: spec.native,
		modifiers: mask,
		...(spec.text ? { text: spec.text } : {}),
	});
	await send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: name,
		code: name,
		windowsVirtualKeyCode: spec.vk,
		nativeVirtualKeyCode: spec.native,
		modifiers: mask,
	});
	await wait(180);
}

async function insert(text) {
	await send("Input.insertText", { text });
	await wait(180);
}

/* --------------------------------------------------------------------- readings ---- */

const PROBE = `(() => {
	const q = (s, r = document) => r.querySelector(s);
	const all = (s, r = document) => [...r.querySelectorAll(s)];
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
	};
	const text = (el) => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : null);
	const drawer = q("[data-ask-drawer]");
	const composer = q('textarea[aria-label="Message"]');
	const active = document.activeElement;
	const scope = drawer || document;
	const buttonNamed = (name) => {
		const el = all("button", scope).find((b) => text(b) === name);
		return el ? { disabled: el.disabled, box: box(el) } : null;
	};
	const scrollers = drawer
		? [drawer, ...all("*", drawer)]
				.filter((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY))
				.map((el) => ({
					cls: String(el.className).slice(0, 60),
					scrollHeight: el.scrollHeight,
					clientHeight: el.clientHeight,
					scrolls: el.scrollHeight > el.clientHeight + 1,
				}))
		: [];
	const questions = all("[data-lo-ask-question]", scope).map((block) => {
		const secret = q("input[data-ask-secret]", block);
		const field = q("textarea[data-ask-other]", block);
		const bare = all("input", block).find((i) => !i.hasAttribute("data-ask-secret"));
		const other = q("[data-ask-option-other]", block);
		return {
			id: block.getAttribute("data-lo-ask-question"),
			box: box(block),
			prompt: box(q("p", block)),
			options: all("[data-ask-option]", block).map((b) => ({
				label: b.getAttribute("data-ask-option"),
				role: b.getAttribute("role"),
				pressed: b.getAttribute("aria-pressed"),
				checked: b.getAttribute("aria-checked"),
				box: box(b),
			})),
			otherRow: other
				? {
						role: other.getAttribute("role"),
						pressed: other.getAttribute("aria-pressed"),
						checked: other.getAttribute("aria-checked"),
						text: text(other),
						box: box(other),
						minTarget: Math.min(other.getBoundingClientRect().width, other.getBoundingClientRect().height),
					}
				: null,
			otherField: field
				? {
						box: box(field),
						focused: field === active,
						valueLength: field.value.length,
						value: field.value,
						/*
						 * Where the caret stands after a restore (round 1, UX U1): a bare focus
						 * puts a textarea's caret at offset 0, so text inserted right after lands
						 * IN FRONT of the restored answer. Numbers, because a still cannot show
						 * which side of the text the caret sat on.
						 */
						selectionStart: field.selectionStart,
						selectionEnd: field.selectionEnd,
						rows: field.rows,
						placeholder: field.getAttribute("placeholder"),
						ariaLabel: field.getAttribute("aria-label"),
						disabled: field.disabled,
					}
				: null,
			secretField: secret
				? { type: secret.type, valueLength: secret.value.length, box: box(secret), placeholder: secret.getAttribute("placeholder"), focused: secret === active }
				: null,
			bareInput: bare
				? { type: bare.type, box: box(bare), placeholder: bare.getAttribute("placeholder"), valueLength: bare.value.length }
				: null,
		};
	});
	return {
		hash: location.hash,
		composer: composer
			? { placeholder: composer.getAttribute("placeholder"), valueLength: composer.value.length, focused: composer === active, box: box(composer) }
			: null,
		drawer: drawer ? { box: box(drawer) } : null,
		scrollers,
		active: active ? { tag: active.tagName, attr: active.getAttribute("data-ask-option") || active.getAttribute("data-ask-other") || active.getAttribute("aria-label") } : null,
		buttons: { send: buttonNamed("Send answer"), update: buttonNamed("Update answer"), change: buttonNamed("Change answer"), decline: buttonNamed("Decline"), cancel: buttonNamed("Cancel") },
		rows: all("[data-lo-ask-row]", scope).map((row) => ({ id: row.getAttribute("data-lo-ask-row"), text: (text(row) || "").slice(0, 220) })),
		questions,
	};
})()`;

const probe = () => evaluate(PROBE);

/** The audit's own in-page function, lifted verbatim from the design-qa script. */
async function audit(root) {
	if (!AUDIT) return null;
	const src = readFileSync(AUDIT, "utf8");
	const start = src.indexOf("function inPageAudit(opts) {");
	const end = src.indexOf("// runner", start);
	if (start < 0 || end < 0)
		throw new Error("could not lift inPageAudit from dom_audit.mjs");
	const body = src.slice(start, src.lastIndexOf("// ---", end));
	const out = await evaluate(
		`(${body})(${JSON.stringify({ rootSel: root, grid: 4, doSpacing: false })})`,
	);
	return {
		scanned: out.stats?.scanned,
		findings: (out.findings ?? []).map((f) => ({
			check: f.check,
			severity: f.severity,
			message: f.message,
			selector: f.selector,
			text: f.text,
			rect: f.rect,
		})),
	};
}

/* ---------------------------------------------------------------- the daemon ---- */

const sessionDir = (run, sid) => join(run.scratch, "config", "sessions", sid);
const readLines = (file) =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		: [];
const askEvents = (run, askId) =>
	readLines(join(sessionDir(run, SESSION_A), "asks.jsonl"))
		.filter((e) => e.ask_id === askId)
		.map((e) => ({ kind: e.kind, at: e.at, by: e.by, answers: e.answers }));
const providerCalls = (run, sid = SESSION_A) =>
	readLines(join(run.scratch, `provider-calls-${sid}.jsonl`));
const trigger = (run, name) =>
	writeFileSync(join(run.scratch, "triggers", name), "");
const untrigger = (run, name) =>
	rmSync(join(run.scratch, "triggers", name), { force: true });

async function enqueue(run, name) {
	const receipt = join(run.scratch, "triggers", `enqueued-${name}.json`);
	rmSync(receipt, { force: true });
	trigger(run, `enqueue-${name}`);
	await until(() => existsSync(receipt), `the receipt for ${name}`, 20_000);
	const parsed = JSON.parse(readFileSync(receipt, "utf8"));
	if (!parsed.ok) throw new Error(`enqueue ${name} refused: ${parsed.error}`);
	return parsed.details.ask_id;
}

const settledKind = (run, askId, kind) => () =>
	askEvents(run, askId).some((e) => e.kind === kind);

/* ----------------------------------------------------------------------- frames ---- */

const report = { runs: {}, chromePid: chrome.pid, theme: THEME };

/**
 * What the page's network looked like at the moment a wait timed out: the streams still
 * open, the POSTs still unanswered, and how long a FRESH request takes from the same
 * page. It exists to tell a slow PRODUCT from a slow RIG - a press whose request left the
 * page and never came back is one or the other, and the frame cannot say which.
 */
let stallOrigin = null;
async function diagnoseStall() {
	const rows = [...netTrace.values()];
	const openStreams = rows.filter(
		(r) => r.url.includes("/stream") && !r.finishedAt && !r.failed,
	).length;
	const freshRequest = await evaluate(`(async () => {
		const t = performance.now();
		try {
			await Promise.race([
				fetch("/__desktop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "capabilities" }) }),
				new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 8000 ms")), 8000)),
			]);
			return Math.round(performance.now() - t) + " ms";
		} catch (error) {
			return String(error.message);
		}
	})()`);
	// The SAME request, from this Node process instead of the page. If the page's fetch
	// above hung and this one answers, the saturation is the BROWSER's (HTTP/1.1 allows
	// six connections per origin and every open event stream holds one for good); if both
	// hang, the dev proxy or the daemon is the thing that stalled.
	const outsideBrowser = await new Promise((resolve) => {
		const started = Date.now();
		const target = new URL(`${stallOrigin}/__desktop`);
		const request = httpRequest(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname,
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: stallOrigin },
				timeout: 8000,
			},
			(response) => {
				response.resume();
				response.on("end", () =>
					resolve(`${response.statusCode} in ${Date.now() - started} ms`),
				);
			},
		);
		request.on("timeout", () => {
			request.destroy();
			resolve("no answer in 8000 ms");
		});
		request.on("error", (error) => resolve(`error: ${error.message}`));
		request.end(JSON.stringify({ op: "capabilities" }));
	});
	return { openStreams, freshRequest, outsideBrowser };
}

/**
 * `--net`: every `/__desktop` request the page makes, stamped with the wall clock when
 * it LEFT the page, when its response arrived and when it finished. It exists for the
 * one question a frame cannot answer - "was a press slow in the product, or in the
 * rig?" - and is off by default so a committed run's report stays small.
 */
const netTrace = new Map();
function traceNetwork() {
	if (!TRACE_NET) return;
	browser.addEventListener("message", (event) => {
		const msg = JSON.parse(event.data);
		if (!msg.method?.startsWith("Network.")) return;
		const p = msg.params ?? {};
		if (
			msg.method === "Network.requestWillBeSent" &&
			p.request?.url.includes("__desktop")
		) {
			netTrace.set(p.requestId, {
				method: p.request.method,
				url: p.request.url.replace(ORIGIN_PREFIX, "").slice(0, 90),
				sentAt: Date.now(),
				body: (p.request.postData ?? "").slice(0, 100),
			});
		} else if (netTrace.has(p.requestId)) {
			const row = netTrace.get(p.requestId);
			if (msg.method === "Network.responseReceived") {
				row.responseAt = Date.now();
				row.status = p.response?.status;
			}
			if (msg.method === "Network.loadingFinished") row.finishedAt = Date.now();
			if (msg.method === "Network.loadingFailed") row.failed = p.errorText;
		}
	});
}

async function shot(run, state, { clip } = {}) {
	const { data } = await send("Page.captureScreenshot", {
		format: "png",
		...(clip ? { clip: { ...clip, scale: 2 } } : {}),
	});
	const dir = join(OUT, run.label, state);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${THEME}.webp`);
	await sharp(Buffer.from(data, "base64")).webp({ quality: 92 }).toFile(file);
	run.record.frames[state] = file.slice(OUT.length + 1);
	return file;
}

/** A 2x crop of the drawer's own pane, for the states where the detail is the point. */
async function paneClip() {
	const b = await evaluate(
		`(() => { const el = document.querySelector("[data-ask-drawer]"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
	);
	return b;
}

/** A 2x crop of one element's own box, with a little air for a focus ring. */
async function elementClip(selector) {
	const b = await evaluate(
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; })()`,
	);
	return b;
}

/**
 * The name a BROWSER computes for a node, from its own accessibility tree - not
 * from `textContent`. The D8/U6 finding lives exactly in the difference: two spans
 * with a margin and no space between them make both read `OtherType your answer`,
 * and only the AX tree says which one a screen reader gets.
 */
async function axName(selector) {
	await send("Accessibility.enable");
	const { root } = await send("DOM.getDocument", { depth: 0 });
	const { nodeId } = await send("DOM.querySelector", {
		nodeId: root.nodeId,
		selector,
	});
	if (!nodeId) return { role: null, name: null, missing: true };
	const { nodes } = await send("Accessibility.getPartialAXTree", {
		nodeId,
		fetchRelatives: false,
	});
	const node = nodes?.[0] ?? null;
	return { role: node?.role?.value ?? null, name: node?.name?.value ?? null };
}

/**
 * The text runs assistive tech receives under a node: child text nodes joined,
 * `aria-hidden="true"` subtrees skipped. The D2 separator is hidden from the tree,
 * so this is the visible readout MINUS the dot - the string D9 and agent round 2
 * predicted fuses `...traffic)` with `Other`.
 */
async function announcedText(selector) {
	return evaluate(`(() => {
		const root = document.querySelector(${JSON.stringify(selector)});
		if (!root) return null;
		let out = "";
		const walk = (node) => {
			for (const child of node.childNodes) {
				if (child.nodeType === 3) { out += child.textContent; continue; }
				if (child.nodeType !== 1) continue;
				if (child.getAttribute("aria-hidden") === "true") continue;
				walk(child);
			}
		};
		walk(root);
		return out;
	})()`);
}

/* -------------------------------------------------------------------- the steps ---- */

async function navigate(run, hash) {
	await openTab();
	await send("Page.navigate", { url: `${run.origin}/${hash}` });
	await waitFor(
		`document.querySelector('textarea[aria-label="Message"]') !== null`,
		"the app shell",
		60_000,
	);
	await wait(500);
}

async function openDrawer(run) {
	await navigate(run, `#/chat/${SESSION_A}`);
	await waitFor(
		`document.querySelector('[data-lo-ask-item-toggle]') !== null`,
		"the ask chip",
	);
	// The chip TOGGLES: a drawer a previous load left open (persisted state) would be
	// closed by this press, so it is only pressed when no drawer is up.
	const already = await evaluate(
		`document.querySelector('[data-ask-drawer="session"]') !== null`,
	);
	if (!already) await press("[data-lo-ask-item-toggle]");
	await waitFor(
		`document.querySelector('[data-ask-drawer="session"]') !== null`,
		"the drawer",
	);
	await wait(700);
}

const otherSelector = "[data-ask-option-other]";
const questionSel = (id) => `[data-lo-ask-question=${JSON.stringify(id)}]`;
/**
 * A selector scoped to ONE ask's card. Every press goes through it: the drawer lists
 * every outstanding ask, so an unscoped `[data-ask-option-other]` after a step that
 * failed half-way would press an OLDER card's row and the frame would photograph the
 * wrong thing while every assertion still passed.
 */
const inAsk = (askId, selector) =>
	`[data-lo-ask-row=${JSON.stringify(askId)}] ${selector}`;

/** Whether the Other row is present, held against what the label says it must be. */
async function checkOther(run, qid, state, expected = run.expectOther) {
	const present = await evaluate(
		`document.querySelector(${JSON.stringify(`${questionSel(qid)} ${otherSelector}`)}) !== null`,
	);
	run.record.otherPresent[`${state}:${qid}`] = present;
	if (expected && !present)
		throw new Error(
			`${run.label}: the Other row is missing from ${qid} at ${state}`,
		);
	if (!expected && present)
		throw new Error(
			`${run.label}: an Other row is present on ${qid} at ${state}`,
		);
	return present;
}

async function sendAnswer(run, askId) {
	await press(
		`[data-lo-ask-row=${JSON.stringify(askId)}] button`,
		"Send answer",
	);
	await until(
		settledKind(run, askId, "answered"),
		"the answer to reach the log",
		20_000,
	);
	await wait(900);
}

const STEPS = [];
const step = (id, title, fn) => STEPS.push({ id, title, fn });

/* a. single-select, an option picked and sent */
step("a", "single-select: an option picked and sent", async (run) => {
	const askId = await enqueue(run, "deploy-target");
	await openDrawer(run);
	await checkOther(run, "deploy-target", "a1");
	run.record.probes.a1 = await probe();
	await shot(run, "a1-card");
	await shot(run, "a1-card-pane", { clip: await paneClip() });
	await press(inAsk(askId, "[data-ask-option='Production']"));
	run.record.probes.a2 = await probe();
	await shot(run, "a2-option-picked");
	await sendAnswer(run, askId);
	run.record.probes.a3 = await probe();
	await shot(run, "a3-sent");
	run.record.log.a = askEvents(run, askId);
});

/* b + h. single-select Other: selected-empty, typed, sent */
step("b", "single-select: Other (empty, typed, sent)", async (run) => {
	const askId = await enqueue(run, "region");
	await openDrawer(run);
	await checkOther(run, "region", "b1");
	run.record.probes.b1 = await probe();
	await shot(run, "b1-card");
	await shot(run, "b1-card-pane", { clip: await paneClip() });
	if (!run.expectOther) {
		// There is no Other to press. Clear the queue the way a user without one would.
		await press(`[data-lo-ask-row=${JSON.stringify(askId)}] button`, "Decline");
		await until(settledKind(run, askId, "declined"), "the decline", 20_000);
		run.record.log.b = askEvents(run, askId);
		return;
	}
	await press(inAsk(askId, otherSelector));
	await wait(400);
	run.record.probes.h1 = await probe();
	await shot(run, "h1-other-selected-empty");
	await shot(run, "h1-other-selected-empty-pane", { clip: await paneClip() });
	run.record.audits.h1 = await audit("[data-ask-drawer]");
	// Whitespace is not an answer either.
	await insert("   ");
	run.record.probes.h2 = await probe();
	for (let i = 0; i < 3; i += 1) await key("Backspace");
	await insert("ap-southeast-2 (Sydney)");
	run.record.probes.b2 = await probe();
	await shot(run, "b2-other-typed");
	await shot(run, "b2-other-typed-pane", { clip: await paneClip() });
	await sendAnswer(run, askId);
	run.record.probes.b3 = await probe();
	await shot(run, "b3-sent");
	run.record.log.b = askEvents(run, askId);
});

/* c. multi-select: ticks plus Other */
step("c", "multi-select: options plus Other", async (run) => {
	const askId = await enqueue(run, "checks");
	await openDrawer(run);
	await checkOther(run, "checks", "c1");
	await press(inAsk(askId, "[data-ask-option='Unit tests']"));
	await press(inAsk(askId, "[data-ask-option='Smoke tests']"));
	run.record.probes.c1 = await probe();
	await shot(run, "c1-ticked");
	await shot(run, "c1-ticked-pane", { clip: await paneClip() });
	if (run.expectOther) {
		await press(inAsk(askId, otherSelector));
		await wait(400);
		await insert("Load tests");
		run.record.probes.c2 = await probe();
		await shot(run, "c2-other-added");
		await shot(run, "c2-other-added-pane", { clip: await paneClip() });
		run.record.audits.c2 = await audit("[data-ask-drawer]");
	}
	await sendAnswer(run, askId);
	await shot(run, "c3-sent");
	run.record.log.c = askEvents(run, askId);
});

/* d. free-text-only (a shape core's tool cannot emit today; see serve-other.py) */
step("d", "free-text-only question", async (run) => {
	const askId = await enqueue(run, "release-name");
	await openDrawer(run);
	run.record.probes.d1 = await probe();
	await shot(run, "d1-card");
	await shot(run, "d1-card-pane", { clip: await paneClip() });
	const fieldSel = inAsk(
		askId,
		`${questionSel("release-name")} textarea, ${questionSel("release-name")} input`,
	);
	await press(fieldSel);
	await insert("Aurora");
	run.record.probes.d2 = await probe();
	await shot(run, "d2-typed");
	run.record.audits.d2 = await audit("[data-ask-drawer]");
	// The keyboard path, for real. On the branch Enter in the field is `Send answer`; the
	// bare single-line input it replaced had no Enter handler at all, so on the unfixed
	// tree it does nothing. That difference is RECORDED rather than assumed, and the
	// step then finishes the way a user of the old card had to: the button.
	await key("Enter");
	await wait(1500);
	run.record.probes.d2enter = {
		answeredByEnter: settledKind(run, askId, "answered")(),
	};
	if (!run.record.probes.d2enter.answeredByEnter) {
		await press(inAsk(askId, "button"), "Send answer");
		await until(settledKind(run, askId, "answered"), "the answer", 20_000);
	}
	await wait(900);
	await shot(run, "d3-sent");
	run.record.log.d = askEvents(run, askId);
});

/* e. secret question: the masked field only */
step("e", "secret question: no Other row", async (run) => {
	const askId = await enqueue(run, "deploy_key");
	await openDrawer(run);
	// ABSENT IN BOTH TREES, and asserted as such: the masked field is a secret
	// question's whole free-form entry, and a plain box beside a credential is the
	// failure to avoid.
	await checkOther(run, "deploy_key", "e1", false);
	run.record.probes.e1 = await probe();
	await shot(run, "e1-card");
	await press(
		inAsk(askId, `${questionSel("deploy_key")} input[data-ask-secret]`),
	);
	await insert("not-a-real-credential-0000");
	run.record.probes.e2 = await probe();
	await shot(run, "e2-masked");
	await shot(run, "e2-masked-pane", { clip: await paneClip() });
	run.record.audits.e2 = await audit("[data-ask-drawer]");
	// Cleared by declining: the rig never sends a credential, real or otherwise.
	await press(`[data-lo-ask-row=${JSON.stringify(askId)}] button`, "Decline");
	try {
		await until(settledKind(run, askId, "declined"), "the decline", 20_000);
	} catch (error) {
		run.record.stall = await diagnoseStall();
		throw error;
	}
	run.record.log.e = askEvents(run, askId);
});

/* f. the main composer, while the drawer is open */
step("f", "composer send while the drawer is open", async (run) => {
	const askId = await enqueue(run, "rotate");
	await openDrawer(run);
	const callsBefore = providerCalls(run).length;
	run.record.probes.f1 = await probe();
	await shot(run, "f1-drawer-open");
	await press('textarea[aria-label="Message"]');
	const message =
		"Before you rotate them: are the staging keys shared with prod?";
	await insert(message);
	run.record.probes.f2 = await probe();
	await shot(run, "f2-typed-in-composer");
	await key("Enter");
	// Whichever tree this is, give the daemon time to act on what it was sent.
	await wait(3500);
	run.record.probes.f3 = await probe();
	await shot(run, "f3-after-send");
	run.record.log.f = askEvents(run, askId);
	run.record.f4 = {
		askStillOpenInTheUi: await evaluate(
			`document.querySelector(${JSON.stringify(inAsk(askId, "[data-ask-option]"))}) !== null`,
		),
	};
	run.record.providerCalls.f = providerCalls(run)
		.slice(callsBefore)
		.map((c) => ({
			call: c.call,
			user_tail: c.user_tail.map((t) => t.slice(0, 160)),
		}));
	// The history route, through the same /__desktop door the app uses.
	/*
	 * THE HISTORY ROUTE, through the same `/__desktop` door the app uses (a same-origin
	 * fetch from the page, so the dev proxy's origin gate is satisfied honestly). Each
	 * entry is `{ type, payload: { role, content: [{ text }] } }`; the reading returns
	 * the ROLE and the TEXT of every entry that carries the typed message, plus the
	 * transcript's tail, so "the user message is present as a plain user message" is read
	 * off the daemon's record and not inferred from the page.
	 */
	run.record.history.f = await evaluate(`(async () => {
		const res = await fetch("/__desktop", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "sessions.history", sessionId: ${JSON.stringify(SESSION_A)}, limit: 200 }),
		});
		const envelope = await res.json();
		const entries = envelope?.body?.result?.entries ?? [];
		const textOf = (e) => (e?.payload?.content ?? []).map((c) => c?.text ?? "").join("");
		const needle = ${JSON.stringify(message)};
		const carrying = entries
			.filter((e) => textOf(e).includes(needle))
			.map((e) => ({ type: e.type, role: e.payload?.role ?? null, custom_type: e.payload?.custom_type ?? null, text: textOf(e).slice(0, 120) }));
		return {
			status: envelope?.status ?? res.status,
			entries: entries.length,
			carryingTheMessage: carrying,
			tail: entries.slice(-4).map((e) => ({ type: e.type, role: e.payload?.role ?? null, custom_type: e.payload?.custom_type ?? null, text: textOf(e).slice(0, 80) })),
		};
	})()`);
	// Leave the queue like for like for the steps after this one: the unfixed tree
	// swallowed the message AS the answer (the ask is already settled), the branch left
	// it pending, so the branch's ask is declined by a real press on the card.
	if (
		!settledKind(run, askId, "answered")() &&
		!settledKind(run, askId, "declined")()
	) {
		await press(inAsk(askId, "button"), "Decline");
		await until(settledKind(run, askId, "declined"), "the decline", 20_000);
	}
});

/* g1. the legacy BLOCKING ask, on its own session */
step("g1", "legacy blocking ask card", async (run) => {
	await navigate(run, `#/chat/${SESSION_C}`);
	await wait(1500);
	trigger(run, "arm-gate");
	await waitFor(
		`document.querySelector('fieldset[aria-label="Answer options"]') !== null`,
		"the blocking card",
		40_000,
	);
	await wait(700);
	run.record.probes.g1 = await evaluate(`(() => {
		const f = document.querySelector('fieldset[aria-label="Answer options"]');
		const buttons = [...f.querySelectorAll("button")];
		return {
			options: buttons.map((b) => (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70)),
			otherRows: document.querySelectorAll("[data-ask-option-other]").length,
			composerPlaceholder: document.querySelector('textarea[aria-label="Message"]')?.getAttribute("placeholder") ?? null,
		};
	})()`);
	await shot(run, "g1-blocking-card");
	await press(
		'fieldset[aria-label="Answer options"] button',
		"~Popup is not open",
	);
	await until(
		() => existsSync(join(run.scratch, "gate-answer.json")),
		"the gate's answer",
		20_000,
	);
	run.record.log.g1 = JSON.parse(
		readFileSync(join(run.scratch, "gate-answer.json"), "utf8"),
	);
	await wait(600);
	await shot(run, "g1-blocking-answered");
});

/*
 * g2. change-before-delivery, the regression neighbour.
 *
 * THE SAME FLOW IN BOTH TREES (an option, sent; `Change answer`; a different option;
 * `Update answer`), so the pair is a comparison of the tree and nothing else. The
 * delivery is held (see `serve-other.py`, item 4) so the answered-but-undelivered
 * window is on screen long enough to press in. g2x then exercises the NEW row inside
 * that same window, in the branch only.
 *
 * `capture: false` runs the same presses without this flow's own frames - the
 * round-2 row set needs the held window's readout, not five more stills - and
 * `afterUpdate` measures inside the window before the `finally` lifts the hold.
 */
async function changeFlow(
	run,
	name,
	id,
	{ viaOther, afterUpdate, capture = true },
) {
	// The hold is lifted in `finally`: a step that throws inside it must not leave the
	// marker behind for the next step to inherit (the first full run did exactly that,
	// and every later ask then sat undelivered with its controls disabled).
	trigger(run, "hold-delivery");
	let askId = null;
	try {
		askId = await enqueue(run, name);
		await openDrawer(run);
		await press(inAsk(askId, "[data-ask-option='Staging']"));
		await sendAnswer(run, askId);
		run.record.probes[`${id}a`] = await probe();
		if (capture) await shot(run, `${id}a-answered-undelivered`);
		await press(inAsk(askId, "button"), "Change answer");
		await wait(500);
		if (viaOther) await checkOther(run, name, `${id}b`);
		run.record.probes[`${id}b`] = await probe();
		if (capture) {
			await shot(run, `${id}b-change-form`);
			await shot(run, `${id}b-change-form-pane`, { clip: await paneClip() });
		}
		if (viaOther) {
			await press(inAsk(askId, otherSelector));
			await wait(400);
			await insert("Canary (5% of traffic)");
		} else {
			await press(inAsk(askId, "[data-ask-option='Production']"));
		}
		run.record.probes[`${id}c`] = await probe();
		if (capture) {
			await shot(run, `${id}c-change-edited`);
			await shot(run, `${id}c-change-edited-pane`, { clip: await paneClip() });
		}
		await press(inAsk(askId, "button"), "Update answer");
		await until(
			settledKind(run, askId, "revised"),
			"the revision to reach the log",
			20_000,
		);
		await wait(700);
		if (capture) await shot(run, `${id}d-updated`);
		// Runs INSIDE the held window (the `finally` below lifts the hold after), which
		// is where the answered readout is on screen.
		if (afterUpdate) await afterUpdate(askId);
	} finally {
		untrigger(run, "hold-delivery");
	}
	await wait(2500);
	run.record.log[id] = askEvents(run, askId);
}

step("g2", "change before delivery (option to option, both trees)", (run) =>
	changeFlow(run, "change", "g2", { viaOther: false }),
);

step(
	"g2x",
	"change before delivery through Other (branch only)",
	async (run) => {
		if (!run.expectOther) return;
		await changeFlow(run, "change-other", "g2x", { viaOther: true });
	},
);

/* i. the caret after a restored Other (round 1, UX U1) and the one prompt (D4) */
step(
	"i",
	"single-select: Other restored, where the caret lands",
	async (run) => {
		if (!run.expectOther) return;
		const askId = await enqueue(run, "region");
		await openDrawer(run);
		await checkOther(run, "region", "i1");
		run.record.probes.i1 = await probe();
		await shot(run, "i1-card");
		await shot(run, "i1-card-pane", { clip: await paneClip() });
		await press(inAsk(askId, otherSelector));
		await insert("eu-central");
		run.record.probes.i2 = await probe();
		await shot(run, "i2-typed");
		// A single-select option press CLOSES Other and keeps the text; pressing Other
		// again restores it. Where the caret lands in the restored text is the U1 delta:
		// at offset 0 on r0 (the next keystrokes PREPEND, and `No` became `NoNo, thanks`),
		// after the text on r1.
		await press(inAsk(askId, "[data-ask-option='us-east']"));
		await press(inAsk(askId, otherSelector));
		await wait(400);
		run.record.probes.i3 = await probe();
		await shot(run, "i3-restored");
		await shot(run, "i3-restored-pane", { clip: await paneClip() });
		await insert(" (canary)");
		run.record.probes.i4 = await probe();
		await shot(run, "i4-continued");
		await press(inAsk(askId, "button"), "Send answer");
		await until(settledKind(run, askId, "answered"), "the answer", 20_000);
		await wait(900);
		await shot(run, "i5-sent");
		run.record.log.i = askEvents(run, askId);
	},
);

/* j. multi-select: an Other selected but EMPTY (round 1, design D1) */
step("j", "multi-select: Other empty beside a tick", async (run) => {
	if (!run.expectOther) return;
	const askId = await enqueue(run, "checks");
	await openDrawer(run);
	await press(inAsk(askId, "[data-ask-option='Unit tests']"));
	await press(inAsk(askId, otherSelector));
	await wait(400);
	run.record.probes.j1 = await probe();
	await shot(run, "j1-other-empty");
	await shot(run, "j1-other-empty-pane", { clip: await paneClip() });
	// Unticking Other is the way to send the tick alone; the tick survives the fold.
	await press(inAsk(askId, otherSelector));
	await wait(300);
	run.record.probes.j2 = await probe();
	await shot(run, "j2-other-unticked");
	await press(inAsk(askId, "button"), "Send answer");
	await until(settledKind(run, askId, "answered"), "the answer", 20_000);
	await wait(900);
	await shot(run, "j3-sent");
	run.record.log.j = askEvents(run, askId);
});

/* k. the answered readout's Other tag (round 1, design D2) */
step("k", "the answered readout's Other tag", async (run) => {
	if (!run.expectOther) return;
	await changeFlow(run, "change-other", "k", { viaOther: true });
});

/* m. the row's fresh still and accessible name, and the announced readout
 * (round 2, design D8 / UX U6, plus the announced-readout re-measure). */
step(
	"m",
	"the Other row's still, its accessible name and the announced readout",
	async (run) => {
		if (!run.expectOther) return;
		const askId = await enqueue(run, "region");
		await openDrawer(run);
		await checkOther(run, "region", "m1");
		await wait(400);
		run.record.probes.m1 = await probe();
		run.record.ax ??= {};
		run.record.ax.m1Row = await axName(inAsk(askId, otherSelector));
		await shot(run, "m1-row-pane", {
			clip: await elementClip(inAsk(askId, otherSelector)),
		});
		await press(`[data-lo-ask-row=${JSON.stringify(askId)}] button`, "Decline");
		await until(settledKind(run, askId, "declined"), "the decline", 20_000);
		await wait(600);
		// The readout's announced text is measured inside the answered-but-undelivered
		// window `changeFlow` holds open; `capture: false` keeps that flow's own frames
		// out of this set.
		await changeFlow(run, "change-other", "m2", {
			viaOther: true,
			capture: false,
			afterUpdate: async (changeAskId) => {
				const card = `[data-lo-ask-row=${JSON.stringify(changeAskId)}]`;
				run.record.announced = {
					readoutAnnounced: await announcedText(card),
					readoutVisible: await evaluate(
						`(() => { const el = document.querySelector(${JSON.stringify(card)}); return el ? el.textContent : null; })()`,
					),
				};
				await shot(run, "m2-readout", { clip: await paneClip() });
			},
		});
		run.record.log.m = askEvents(run, askId);
	},
);

/* ------------------------------------------------------------------------ main ---- */

try {
	await openTab();
	traceNetwork();
	for (const run of RUNS) {
		stallOrigin = run.origin;
		run.record = {
			label: run.label,
			origin: run.origin,
			frames: {},
			probes: {},
			audits: {},
			log: {},
			otherPresent: {},
			providerCalls: {},
			history: {},
			errors: [],
		};
		report.runs[run.label] = run.record;
		// A warm-up load: the first request to a Vite tree optimises dependencies and can
		// reload the page once, which must not land in the middle of the first step.
		await navigate(run, `#/chat/${SESSION_A}`);
		await wait(2500);
		for (const s of STEPS) {
			if (ONLY && !ONLY.includes(s.id)) continue;
			try {
				await s.fn(run);
				run.record.log[`step-${s.id}`] = "ok";
			} catch (error) {
				run.record.errors.push({
					step: s.id,
					error: String(error?.stack ?? error),
				});
				try {
					await shot(run, `failure-${s.id}`);
				} catch {
					/* the page may be gone; the error above is the record */
				}
			}
		}
		if (TRACE_NET) {
			run.record.net = [...netTrace.values()]
				.filter((row) => !row.url.includes("/stream"))
				.map((row) => ({
					...row,
					sentToResponseMs: row.responseAt ? row.responseAt - row.sentAt : null,
				}));
			netTrace.clear();
		}
		writeFileSync(
			join(OUT, `run-${run.label}.json`),
			`${JSON.stringify(run.record, null, 2)}\n`,
		);
	}
	report.ok = RUNS.every((r) => r.record.errors.length === 0);
} catch (error) {
	report.ok = false;
	report.error = String(error?.stack ?? error);
} finally {
	console.log(
		JSON.stringify(
			{
				ok: report.ok,
				error: report.error ?? null,
				chromePid: report.chromePid,
				runs: Object.fromEntries(
					Object.entries(report.runs).map(([k, v]) => [
						k,
						{
							frames: Object.keys(v.frames).length,
							errors: v.errors.map(
								(e) => `${e.step}: ${e.error.split("\n")[0]}`,
							),
						},
					]),
				),
			},
			null,
			2,
		),
	);
	try {
		await raw("Browser.close");
	} catch {
		/* already gone */
	}
	// Closed through the browser first, killed by EXACT pid only if it did not go, and
	// the profile removed only once the process has actually exited: Chrome writes into
	// its profile while it shuts down, and removing the directory under it fails with
	// ENOTEMPTY and leaves the directory behind (measured on this rig's first runs).
	for (let i = 0; i < 20 && !chromeExited; i += 1) await wait(250);
	if (!chromeExited) chrome.kill();
	for (let i = 0; i < 20 && !chromeExited; i += 1) await wait(250);
	rmSync(dataDir, {
		recursive: true,
		force: true,
		maxRetries: 8,
		retryDelay: 250,
	});
}
