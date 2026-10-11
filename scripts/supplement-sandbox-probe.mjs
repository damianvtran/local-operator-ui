/**
 * The supplement frame's sandbox, MEASURED in headless Chrome: every escape the
 * design's security posture names (memo §4.1/§4.2), attempted from inside a
 * mounted frame exactly as the app mounts one — `<iframe sandbox="allow-scripts"
 * src="data:text/html;base64,…">` with core's own assembled document (its
 * `<meta http-equiv="Content-Security-Policy">` intact), a scripted
 * theme/ping/resize wire, and the parent's own accounting (load count, message
 * shape rules).
 *
 * WHAT IT IS FOR. The contract's claims are all "the frame cannot …": reach the
 * app (no same-origin, no bridge), reach the network, reach files, navigate the
 * top frame, open windows, keep the frame alive when hostile. A test that asserts
 * the ATTRIBUTE proves nothing about the browser, and the sandbox attribute is
 * half the boundary (the document's own CSP is the other half). This rig drives
 * the real thing and reports what happened per attempt, from inside the frame
 * where possible and from the driver where the frame cannot speak (a hung
 * context, a popup, a request to the target origin).
 *
 * RUN: `node scripts/supplement-sandbox-probe.mjs` — prints one line per
 * attempt and exits non-zero when any attempt SUCCEEDS at what it must not.
 * Headless only, `--use-mock-keychain` (`chrome-keychain.mjs`), a scratch
 * profile, no window, everything reaped by exact pid before it returns.
 *
 * WHY NOT STORYBOOK HERE: this rig measures the SEPARATE, LOWER boundary —
 * Chrome's own enforcement of the mount. The app-level halves that need the app
 * (Electron's one-shot navigation permit, the second-`load` teardown, the
 * watchdog) are `supplement-frame.tsx`'s own logic; its story set photographs
 * the teardown states, and `scripts/supplement-model.test.mjs` pins the wire.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { withMockKeychain } from "./chrome-keychain.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// --- the documents ----------------------------------------------------------

/*
 * The fixture module is TypeScript, so it is bundled the way the model test
 * bundles the model (esbuild, in-memory) rather than regex-parsed: a source
 * read would break on the formatter's quote choices, and the bytes under test
 * must be the file's own.
 */
const fixtureBundle = await build({
	stdin: {
		contents:
			'export { SUPPLEMENT_STORY_POPULATED_DOCUMENT } from "./src/renderer/src/features/chat/canonical/supplement-document-fixtures";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { SUPPLEMENT_STORY_POPULATED_DOCUMENT: populated } = await import(
	`data:text/javascript;base64,${Buffer.from(fixtureBundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The hostile document: it attempts every escape and reports outcomes over the
 * one channel that exists (postMessage). `parent` messages carry no nonce —
 * the HOST page here is the probe's own, and it records whatever arrives; the
 * app's own accept rule is pinned by the model test, not re-implemented.
 */
const HOSTILE = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<title>hostile</title></head><body>
<form id="f" action="/form" method="post"><input name="x" value="1"></form>
<a id="dl" href="/download" download="x.txt">d</a>
<script>
const TARGET = new URLSearchParams(location.search || "").get("target") || "";
const say = (name, outcome) => parent.postMessage({ t: "report", name, outcome }, "*");
const attempt = (name, fn) => { let r; try { r = fn(); } catch (e) { say(name, "refused: " + (e && e.name ? e.name : "throw")); return; } say(name, "returned: " + String(r).slice(0, 120)); };
say("boot", "script-ran");
attempt("parent-dom", () => parent.document.body ? "READ" : "null");
attempt("top-dom", () => top.document.body ? "READ" : "null");
attempt("top-location-write", () => { top.location.href = "http://127.0.0.1:1/top"; return "assigned"; });
attempt("popup", () => { const w = window.open("http://127.0.0.1:1/popup"); return w ? "OPENED" : "null"; });
attempt("cookie", () => { const c = document.cookie; return c === "" ? "empty" : "READ:" + c; });
attempt("localStorage", () => { localStorage.setItem("x", "1"); return "WROTE"; });
attempt("bridge", () => { const d = window.api && window.api.desktop; return d ? "PRESENT" : "absent"; });
say("fetch-loopback", "pending");
fetch(TARGET + "/fetch").then(
	(r) => say("fetch-loopback", "RESOLVED:" + r.status),
	(e) => say("fetch-loopback", "refused: " + e.name),
);
say("xhr-loopback", "pending");
try {
	const x = new XMLHttpRequest(); x.open("GET", TARGET + "/xhr", true); x.send();
	x.onerror = () => say("xhr-loopback", "refused: error event");
	x.onload = () => say("xhr-loopback", "RESOLVED:" + x.status);
} catch (e) { say("xhr-loopback", "refused: " + e.name); }
attempt("beacon", () => navigator.sendBeacon(TARGET + "/beacon") ? "SENT" : "false");
attempt("websocket", () => { const w = new WebSocket(TARGET.replace("http", "ws") + "/ws"); w.onerror = () => say("websocket", "refused: error event"); return "constructed"; });
attempt("img-loopback", () => { const i = new Image(); i.src = TARGET + "/img"; i.onerror = () => say("img-loopback", "refused: error event"); i.onload = () => say("img-loopback", "LOADED"); return "assigned"; });
attempt("file-fetch", () => { fetch("file:///etc/passwd").then(() => say("file-fetch", "RESOLVED"), (e) => say("file-fetch", "refused: " + e.name)); return "attempted"; });
attempt("dynamic-import", () => { import(TARGET + "/import.js").then(() => say("dynamic-import", "RESOLVED"), (e) => say("dynamic-import", "refused: " + e.name)); return "attempted"; });
attempt("form-submit", () => { document.getElementById("f").submit(); return "submitted"; });
attempt("download-click", () => { document.getElementById("dl").click(); return "clicked"; });
attempt("self-navigate", () => { setTimeout(() => { location.href = TARGET + "/self-nav"; }, 150); return "scheduled"; });
attempt("meta-refresh", () => { const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0.3; url=" + TARGET + "/meta"; document.head.appendChild(m); return "inserted"; });
attempt("blob-self-nav", () => { const u = URL.createObjectURL(new Blob(["<!doctype html><p>blob</p>"], { type: "text/html" })); setTimeout(() => { location.href = u; }, 200); return "scheduled"; });
attempt("clipboard-write", () => { navigator.clipboard.writeText("probe").then(() => say("clipboard-write", "WROTE"), (e) => say("clipboard-write", "refused: " + (e && e.name))); return "attempted"; });
attempt("clipboard-read", () => { navigator.clipboard.readText().then(() => say("clipboard-read", "READ"), (e) => say("clipboard-read", "refused: " + (e && e.name))); return "attempted"; });
attempt("fullscreen", () => { document.documentElement.requestFullscreen().then(() => say("fullscreen", "entered"), (e) => say("fullscreen", "refused: " + (e && e.name))); return "attempted"; });
say("resize", "posted");
parent.postMessage({ lo: "supplement", v: 1, t: "resize", h: 222 }, "*");
parent.postMessage({ lo: "supplement", v: 1, t: "ready" }, "*");
</script></body></html>`;

/**
 * The theme document: the REAL assembled fixture (core's own bytes, its CSP and
 * prelude included). The host pushes a theme WITHOUT a nonce first (must not
 * bind), then with one; the driver reads the frame's computed custom property
 * over CDP to prove the tokens landed, and the host counts `load` events to
 * prove the re-ink is not a reload.
 */
const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>supplement sandbox probe</title>
<style>html,body{margin:0;background:#ffffff}iframe{display:block;border:0}</style>
</head><body>
<iframe id="hostile" sandbox="allow-scripts"></iframe>
<iframe id="themed" sandbox="allow-scripts"></iframe>
<script>
window.__probe = { reports: [], loads: { hostile: 0, themed: 0 }, posts: [] };
addEventListener("message", (e) => {
	window.__probe.reports.push({ from: e.source === document.getElementById("hostile").contentWindow ? "hostile" : e.source === document.getElementById("themed").contentWindow ? "themed" : "other", data: e.data });
});
const params = new URLSearchParams(location.search);
const hostile = document.getElementById("hostile");
const themed = document.getElementById("themed");
hostile.addEventListener("load", () => { window.__probe.loads.hostile += 1; });
themed.addEventListener("load", () => {
	window.__probe.loads.themed += 1;
	const n = window.__probe.loads.themed;
	if (n === 1) {
		// The app's FIRST push, nonce and all: the prelude applies it and the
		// nonce it binds is what every state-moving message it posts later must
		// echo (the host-side rule the model test pins).
		themed.contentWindow.postMessage({ lo: "supplement-host", t: "theme", mode: "dark", vars: { "--lo-canvas": "#000000" }, nonce: "n-probe" }, "*");
	}
});
	window.__mount = (hostileHtml, themedHtml) => {
	hostile.src = "data:text/html;base64," + btoa(unescape(encodeURIComponent(hostileHtml)));
	themed.src = "data:text/html;base64," + btoa(unescape(encodeURIComponent(themedHtml)));
};
window.__getFrameUrl = (id) => document.getElementById(id).src.slice(0, 40);
</script></body></html>`;

// --- the two origins --------------------------------------------------------

/** Requests the target origin saw; any entry here from the hostile doc is a leak. */
const targetSeen = [];
const target = createServer((req, res) => {
	targetSeen.push(req.url);
	res.writeHead(200, { "content-type": "text/plain" });
	res.end("ok");
});
await new Promise((r) => target.listen(0, "127.0.0.1", r));
const targetOrigin = `http://127.0.0.1:${target.address().port}`;

/* The hostile document is compiled with its target baked in (a data: URL cannot
   carry a query string the document can read without a base URL). */
const hostileHtml = HOSTILE.replace(
	'new URLSearchParams(location.search || "").get("target") || ""',
	JSON.stringify(targetOrigin),
);

const mainSeen = [];
const page = createServer((req, res) => {
	mainSeen.push(req.url);
	if (req.url.startsWith("/host")) {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(HOST_PAGE);
		return;
	}
	res.writeHead(404, { "content-type": "text/plain" });
	res.end("no");
});
await new Promise((r) => page.listen(0, "127.0.0.1", r));
const pageOrigin = `http://127.0.0.1:${page.address().port}`;

// --- the browser ------------------------------------------------------------

const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dataDir = mkdtempSync(join(tmpdir(), "supplement-probe-"));
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
	{ stdio: ["ignore", "ignore", "pipe"] },
);

class Cdp {
	#ws;
	#id = 0;
	#pending = new Map();
	#listeners = new Map();
	constructor(ws) {
		this.#ws = ws;
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== undefined) {
				const entry = this.#pending.get(message.id);
				if (entry) {
					this.#pending.delete(message.id);
					message.error
						? entry.reject(new Error(message.error.message))
						: entry.resolve(message.result);
				}
				return;
			}
			for (const fn of this.#listeners.get(message.method) ?? [])
				fn(message.params, message.sessionId);
		});
	}
	send(method, params = {}, sessionId = undefined) {
		const id = ++this.#id;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#ws.send(
				JSON.stringify({
					id,
					method,
					params,
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	}
	on(method, fn) {
		if (!this.#listeners.has(method)) this.#listeners.set(method, []);
		this.#listeners.get(method).push(fn);
	}
}

/** Chrome prints the DevTools websocket on stderr; this is its shape. */
const DEBUG_WS_RE = /ws:\/\/[^\s]+/;

const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(() => reject(new Error("no debug port")), 30_000);
	chrome.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(DEBUG_WS_RE);
		if (m) {
			clearTimeout(t);
			resolve(m[0]);
		}
	});
	chrome.on("exit", (code) => reject(new Error(`chrome exited (${code})`)));
});
const { host } = new URL(wsUrl);
const list = await fetch(`http://${host}/json`).then((r) => r.json());
const pageTarget = list.find((t) => t.type === "page");
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve, { once: true });
	ws.addEventListener("error", reject, { once: true });
});
const cdp = new Cdp(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
/*
 * OUT-OF-PROCESS FRAMES ARE THEIR OWN TARGETS. A sandboxed `data:` frame on a
 * cross-site document does not report its execution contexts to the page's
 * session, so the theme assertions (which read the FRAME's computed custom
 * properties) need the flat auto-attach: each attached target's own Runtime
 * domain, and every context recorded WITH the session that can evaluate in it.
 */
await cdp.send("Target.setAutoAttach", {
	autoAttach: true,
	waitForDebuggerOnStart: false,
	flatten: true,
});
const contexts = [];
const recordContext = ({ context }, sessionId) => {
	contexts.push({ origin: context.origin, id: context.id, sessionId });
};
cdp.on("Runtime.executionContextCreated", recordContext);
cdp.on("Target.attachedToTarget", ({ sessionId }) =>
	cdp.send("Runtime.enable", {}, sessionId),
);
cdp.on("Page.windowOpen", (params) => {
	mainSeen.push(`windowOpen:${params.url}`);
});

const evaluate = async (expression, contextId, sessionId) => {
	const result = await cdp.send(
		"Runtime.evaluate",
		{
			expression,
			awaitPromise: true,
			returnByValue: true,
			...(contextId ? { contextId } : {}),
		},
		sessionId,
	);
	if (result.exceptionDetails) {
		return `throw:${result.exceptionDetails.text}`;
	}
	return result.result.value;
};

// --- the run ----------------------------------------------------------------

const fail = [];
const record = (name, actual, expectation, ok) => {
	const line = `${ok ? "PASS" : "FAIL"}  ${name}: ${actual}`;
	console.log(line);
	if (!ok) fail.push(`${name}: ${actual} (expected ${expectation})`);
};

try {
	await cdp.send("Page.navigate", { url: `${pageOrigin}/host` });
	await new Promise((r) => setTimeout(r, 600));
	await evaluate(
		`window.__mount(${JSON.stringify(hostileHtml)}, ${JSON.stringify(populated)})`,
	);
	// The hostile doc schedules its self-navigation at +150 ms and the meta
	// refresh at +300 ms; give both time to hit whatever they will.
	await new Promise((r) => setTimeout(r, 2500));

	const probe = await evaluate("window.__probe");
	const reports = probe.reports
		.filter((r) => r.from === "hostile" && r.data?.t === "report")
		.map((r) => [r.data.name, r.data.outcome]);
	const byName = new Map(reports);
	const themedReports = probe.reports.filter((r) => r.from === "themed");

	// The channel itself: the hostile script ran and spoke (proves the wire).
	record(
		"script-runs",
		byName.get("boot") ?? "no report",
		"script-ran",
		byName.get("boot") === "script-ran",
	);

	// Origin isolation: no DOM, no cookie store, no storage, no bridge.
	record(
		"parent-dom",
		byName.get("parent-dom"),
		"refused",
		/refused/.test(byName.get("parent-dom") ?? ""),
	);
	record(
		"top-dom",
		byName.get("top-dom"),
		"refused",
		/refused/.test(byName.get("top-dom") ?? ""),
	);
	record(
		"cookie",
		byName.get("cookie"),
		"refused or empty (an opaque origin has no cookie store)",
		/refused|empty/.test(byName.get("cookie") ?? ""),
	);
	record(
		"localStorage",
		byName.get("localStorage"),
		"refused",
		/refused/.test(byName.get("localStorage") ?? ""),
	);
	record(
		"bridge-absent",
		byName.get("bridge"),
		"absent",
		/absent/.test(byName.get("bridge") ?? ""),
	);

	// Navigation and popups: the sandbox's own tokens.
	record(
		"top-navigation",
		byName.get("top-location-write"),
		"refused",
		/refused/.test(byName.get("top-location-write") ?? ""),
	);
	record(
		"popup",
		byName.get("popup"),
		"null",
		byName.get("popup") === "returned: null",
	);
	record(
		"form-submit",
		`${byName.get("form-submit")}; target=${targetSeen.includes("/form")}`,
		"no request",
		!targetSeen.includes("/form"),
	);
	const downloadClicked = byName.get("download-click") === "returned: clicked";
	record(
		"download",
		`clicked=${downloadClicked}, target-saw=${targetSeen.includes("/download")}`,
		"no request",
		!targetSeen.includes("/download"),
	);

	/*
	 * ROUND-1 R1'S THREE FURTHER ATTEMPTS (the ones the probe's 28 did not
	 * cover): a `blob:` self-navigation (the scheme the main-process verdict
	 * refuses outright), and the two permissions a graphic has no use for
	 * (clipboard, fullscreen) — an opaque origin must be GRANTED NEITHER.
	 * The blob attempt is read at the frame (the navigation either commits or
	 * refuses) and cross-checked against the target and the host's load
	 * counter; the permissions are read from their own promises.
	 */
	const blobUrl = String(byName.get("blob-self-nav") ?? "");
	record(
		"blob-self-nav",
		`${blobUrl}; loads=${probe.loads.hostile + probe.loads.themed}`,
		"no navigation",
		probe.loads.hostile + probe.loads.themed === 2,
	);
	record(
		"clipboard-write",
		byName.get("clipboard-write"),
		"refused",
		/refused/.test(byName.get("clipboard-write") ?? ""),
	);
	record(
		"clipboard-read",
		byName.get("clipboard-read"),
		"refused",
		/refused/.test(byName.get("clipboard-read") ?? ""),
	);
	record(
		"fullscreen",
		byName.get("fullscreen"),
		"refused",
		/refused/.test(byName.get("fullscreen") ?? ""),
	);

	// The network: the document's own CSP closes it, and the target saw nothing.
	const noRequest = (path) => !targetSeen.includes(path);
	record(
		"fetch",
		byName.get("fetch-loopback"),
		"refused",
		/refused/.test(byName.get("fetch-loopback") ?? ""),
	);
	record(
		"xhr",
		byName.get("xhr-loopback"),
		"refused",
		/refused/.test(byName.get("xhr-loopback") ?? ""),
	);
	// `sendBeacon` AND `WebSocket` are measured at the TARGET rather than by a
	// return value: Chrome's CSP refuses the request after both calls have already
	// returned (a queued beacon answers `true`; a socket object exists before its
	// error event), so the honest reading is that no request ever arrived.
	record(
		"beacon",
		`${byName.get("beacon")}; target=${targetSeen.includes("/beacon")}`,
		"no request",
		noRequest("/beacon"),
	);
	record(
		"websocket",
		`${byName.get("websocket")}; target=${targetSeen.includes("/ws")}`,
		"no request",
		noRequest("/ws"),
	);
	record(
		"img",
		`${byName.get("img-loopback")}; target=${targetSeen.includes("/img")}`,
		"no request",
		noRequest("/img"),
	);
	record(
		"dynamic-import",
		byName.get("dynamic-import"),
		"refused",
		/refused/.test(byName.get("dynamic-import") ?? ""),
	);
	record(
		"file-fetch",
		byName.get("file-fetch"),
		"refused",
		/refused/.test(byName.get("file-fetch") ?? ""),
	);
	record(
		"top-navigation-request",
		`target=${targetSeen.includes("/top")}`,
		"no request",
		noRequest("/top"),
	);
	// EVERY request that reached the target, inspected: the only ones allowed to
	// be there are the frame's OWN navigations (the self-nav and meta-refresh
	// attempts), which the app guards at its two higher layers rather than here.
	const unexpected = targetSeen.filter(
		(p) => p !== "/self-nav" && p !== "/meta",
	);
	record(
		"target-origin-saw-nothing-else",
		JSON.stringify(targetSeen),
		"only /self-nav and/or /meta",
		unexpected.length === 0,
	);

	// The wire: the frame's one accepted shape reached the parent, and the
	// frame's self-navigation/refresh attempts were made (what happens to them
	// is the parent-guard story below).
	record(
		"resize-posted",
		byName.get("resize"),
		"posted",
		byName.get("resize") === "posted",
	);
	record(
		"host-load-count-lower-bound",
		String(probe.loads.hostile),
		">= 1",
		probe.loads.hostile >= 1,
	);
	record(
		"self-navigation-attempted",
		byName.get("self-navigate"),
		"scheduled",
		byName.get("self-navigate") === "returned: scheduled",
	);
	/*
	 * MEASURED, and it is the reason the app guards both ends: in a bare page
	 * with no parent `frame-src` a sandboxed frame's own navigation REACHES the
	 * request (the sandbox covers navigation of other contexts, not the frame's
	 * own `location`), so no browser-level token here substitutes for the app's
	 * two guards: main's one-shot mount permit and the component's second-`load`
	 * teardown. This line records which half the browser gives rather than
	 * asserting the app's claim from the wrong layer.
	 */
	console.log(
		`NOTE  self-navigation in a bare page: target saw /self-nav=${targetSeen.includes("/self-nav")} /meta=${targetSeen.includes("/meta")} (the app's parent page sets frame-src data:, and main permits exactly one mount)`,
	);

	/*
	 * The theme channel on the REAL document: the first push (nonce carried) inks
	 * the tokens and marks the document ready; a second push re-inks WITHOUT a
	 * reload; and every state-moving message the frame posts back echoes the
	 * nonce the push bound.
	 *
	 * The context is found by LANDMARK, not by origin: two sandboxed frames both
	 * report origin `"null"`, so an origin-keyed lookup would read whichever was
	 * last and could report the hostile frame's empty tokens. The populated
	 * fixture always carries its chart host `#c`; the hostile document never
	 * does.
	 */
	let themedSession = undefined;
	let themedContextId = null;
	for (const context of contexts) {
		/*
		 * Chrome serialises a sandboxed frame's opaque origin as `"null"` on the
		 * page session and as `"://"` on the frame's own attached session, so both
		 * spellings are admitted and the LANDMARK decides.
		 */
		if (context.origin !== "null" && context.origin !== "://") continue;
		let isThemed = false;
		try {
			isThemed = await evaluate(
				`!!document.getElementById("c")`,
				context.id,
				context.sessionId,
			);
		} catch {
			// A context that has gone away between the event and this read says
			// nothing about the frame's identity: skip it.
			continue;
		}
		if (isThemed === true) {
			themedContextId = context.id;
			themedSession = context.sessionId;
		}
	}
	const tokenFirst = await evaluate(
		`getComputedStyle(document.documentElement).getPropertyValue("--lo-canvas").trim()`,
		themedContextId,
		themedSession,
	);
	const readyFirst = await evaluate(
		`document.documentElement.getAttribute("data-ready")`,
		themedContextId,
		themedSession,
	);
	record(
		"theme-first-push-applies",
		`token=${tokenFirst} ready=${readyFirst === null ? "unset" : "set"}`,
		"#000000 + ready set",
		tokenFirst === "#000000" && readyFirst !== null,
	);
	const nonceEchoed = themedReports.some(
		(r) =>
			r.data &&
			(r.data.t === "resize" || r.data.t === "pong") &&
			r.data.n === "n-probe",
	);
	record(
		"nonce-echoed-on-state-messages",
		themedReports.map((r) => r.data?.t).join(",") || "no reports",
		"resize/pong carrying n-probe",
		nonceEchoed,
	);
	await evaluate(
		`document.getElementById("themed").contentWindow.postMessage({ lo: "supplement-host", t: "theme", mode: "light", vars: { "--lo-canvas": "#abcdef" }, nonce: "n-probe" }, "*")`,
	);
	await new Promise((r) => setTimeout(r, 400));
	const tokenSecond = await evaluate(
		`getComputedStyle(document.documentElement).getPropertyValue("--lo-canvas").trim()`,
		themedContextId,
		themedSession,
	);
	const themedLoads = (await evaluate("window.__probe.loads.themed")) ?? 0;
	record(
		"theme-reink-second-push",
		`token=${tokenSecond}`,
		"#abcdef",
		tokenSecond === "#abcdef",
	);
	record(
		"theme-reink-no-reload",
		`loads=${themedLoads}`,
		"1",
		themedLoads === 1,
	);
} finally {
	// Reap by exact pid, then the profile.
	chrome.kill("SIGTERM");
	await new Promise((r) => chrome.once("exit", r));
	rmSync(dataDir, { recursive: true, force: true });
	target.close();
	page.close();
}

if (fail.length > 0) {
	console.error(`\nFAILED ATTEMPTS:\n${fail.join("\n")}`);
	process.exit(1);
}
console.log("\nAll attempts refused or observed as expected.");
