#!/usr/bin/env node
/**
 * Captures - and asserts - the composer's alert for a send the backend's STORE
 * refused, for each arm of the store-failure ladder.
 *
 *     node scripts/store-refusal-evidence.mjs [--json] [--out=<dir>] [--only=<substr>]
 *
 * Why this file exists. On 2026-09-17 the host volume reached 0 bytes free, the
 * backend's store could not write, and the desktop routes answered that with the
 * one 503 they had for every `sqlite3.Error` - lock contention, an unopenable
 * database, a corrupt one and a full disk alike - reading "Read state is busy
 * right now. It will catch up on its own." The composer relayed that sentence and
 * appended its own generic hint, "Your message is still in the composer. Send it
 * again.", which is the one instruction that cannot help when the disk is full.
 * The operator retried, with an image attached, repeatedly.
 *
 * The repair is a split: `store_busy` (503, genuinely transient - retry is right),
 * `store_out_of_space` (507, name the disk and free space) and `store_unavailable`
 * (500, retrying will not help). The renderer's half is that each code reaches the
 * composer and `withholdsRetryHint` withholds the hint for the two the hint is
 * false for.
 *
 * A green unit test cannot show that, and neither can a screenshot alone: the
 * claim is a DIFFERENCE between three runs of the same pipeline with the same box,
 * where the only thing that moves is the code. So this drives
 * `scripts/store-refusal-evidence.html` - the SHIPPED `MessageInput` mounted on
 * what the app's own transport, `desktopResult`, `admitChatDraft` and
 * `withholdsRetryHint` produced - over raw CDP against a private headless Chrome,
 * the same approach as `composer-alert-geometry.mjs` and `capture-evidence.mjs`:
 * a fresh user-data-dir under /tmp, killed on exit, and no browser-automation
 * dependency added to the repo. The page is built and served by `vite` in-process
 * over `store-refusal-evidence.vite.mjs`.
 *
 * What it does NOT prove: the Electron IPC hop (this page takes the transport's
 * real `/__desktop` HTTP path, `window.api.desktop` deliberately absent), the
 * packaged build, any theme other than the one named, and any screen-reader
 * behaviour (the `role="alert"` is present in the DOM, which is not the same as
 * hearing it). The BACKEND's own error ladder is the sibling PR's subject; what
 * is substituted here is its verdict, at the HTTP boundary.
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
const OUT = flag("out") ?? join(ROOT, "docs/evidence/store-refusal-alert");
const PORT = Number(flag("port") ?? 5431);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ONLY = flag("only");
const THEME = flag("theme") ?? "localOperatorDark";

/** The window and column the composer's own frames are measured in. */
const VIEWPORT = { width: 1440, height: 817 };
const COLUMN = 892;

/**
 * The three arms, each with what the pipeline must produce and what the user
 * must read.
 *
 * `hint` is the claim: the busy arm keeps the "Send it again." half because a
 * retry there is genuinely the remedy, and the two store arms do not, because
 * resending the same bytes meets the same store in the same state.
 */
const CASES = [
	{
		name: "store_busy",
		case: "busy",
		status: 503,
		code: "store_busy",
		message: "Read state is busy right now. It will catch up on its own.",
		hint: true,
	},
	{
		name: "store_out_of_space",
		case: "out-of-space",
		status: 507,
		code: "store_out_of_space",
		message:
			"There is not enough space on this disk to save your message. Free up space, then send it again.",
		hint: false,
	},
	{
		name: "store_unavailable",
		case: "unavailable",
		status: 500,
		code: "store_unavailable",
		message:
			"This chat's stored state could not be read or written. Retrying will not help; check this machine's storage and its logs.",
		hint: false,
	},
];

const RETRY_HINT = "Your message is still in the composer. Send it again.";

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

/**
 * What the page is asked to report, in one call.
 *
 * Read off the DOM rather than off the harness's own record: the question is what
 * a person looking at these pixels can read, so the alert's TEXT is taken from
 * the rendered region, and the box's own value is read so "the hint was withheld"
 * cannot be confused with "the hint had nothing to attach to" - the composer gates
 * it on the box holding something.
 */
const PROBE = `(() => {
	const region = document.querySelector('[role="alert"]');
	const textarea = document.querySelector("textarea");
	return {
		regionPresent: !!region,
		alertText: region ? (region.textContent || "").replace(/\\s+/g, " ").trim() : null,
		boxValue: textarea ? textarea.value : null,
		theme: document.documentElement.dataset.theme,
		fonts: document.fonts.status,
		evidence: window.__storeRefusalEvidence ?? null,
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
		// Same race `composer-alert-geometry.mjs` documents: SIGKILL returns before
		// the profile stops being written to, so a plain recursive remove can throw
		// ENOTEMPTY and turn a successful capture into a failure.
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
			join(ROOT, "scripts/store-refusal-evidence.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1 while this driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, STORE_REFUSAL_PORT: String(PORT) } },
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			const res = await fetch(`${ORIGIN}/store-refusal-evidence.html`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("the harness page never came up");
};

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-store-refusal-${process.pid}`);
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
 * The assertions, stated once so the report can name the claim each one answers.
 */
const assertions = (probe, expected) => {
	const failures = [];
	const fail = (message) => failures.push(message);
	const evidence = probe.evidence ?? {};

	if (!probe.regionPresent)
		fail("no alert region rendered at all, so the refusal reached no composer");
	if (!evidence.code)
		fail(
			`the refusal carried no code (evidence: ${JSON.stringify(evidence)}), so the alert's hint is decided by whatever code the row was last left holding`,
		);
	if (evidence.code !== expected.code)
		fail(`the code is ${evidence.code}, expected ${expected.code}`);
	if (evidence.status !== expected.status)
		fail(
			`the refusal arrived as ${evidence.status}, expected ${expected.status}`,
		);
	if (evidence.message !== expected.message)
		fail(
			`the sentence the composer holds is not the backend's own: ${JSON.stringify(evidence.message)}`,
		);
	if (evidence.withholdRetryHint !== !expected.hint)
		fail(
			`withholdRetryHint is ${evidence.withholdRetryHint}, expected ${!expected.hint} for ${expected.code}`,
		);
	/*
	 * The box, asserted because every claim about the hint is conditional on it:
	 * the alert only appends "Send it again." when the composer holds something the
	 * store would accept, so a frame shot over an empty box would show no hint for
	 * a reason that has nothing to do with the code.
	 */
	if (!probe.boxValue || probe.boxValue.trim() === "")
		fail(
			"the composer's box is empty, so the hint's own condition was never met and its absence proves nothing",
		);
	// The rendered sentence, not the pipeline's record of it: a withheld hint that
	// is absent because the sentence itself was dropped looks identical in a still.
	if (probe.alertText === null) fail("the alert region holds no text");
	else {
		if (!probe.alertText.includes(expected.message))
			fail(
				`the alert does not render the backend's sentence verbatim: ${JSON.stringify(probe.alertText)}`,
			);
		const hasHint = probe.alertText.includes(RETRY_HINT);
		if (hasHint !== expected.hint)
			fail(
				expected.hint
					? `the retry hint is missing from ${expected.code}, where a resend is the remedy: ${JSON.stringify(probe.alertText)}`
					: `the retry hint is rendered for ${expected.code}, which a resend cannot answer: ${JSON.stringify(probe.alertText)}`,
			);
	}
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

	const records = [];
	const problems = [];
	for (const expected of CASES) {
		if (ONLY && !`${expected.name}${expected.case}`.includes(ONLY)) continue;
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/store-refusal-evidence.html?case=${expected.case}&w=${COLUMN}&theme=${THEME}`,
		});
		/*
		 * Ready is three conditions, not one: the font faces are loaded (the
		 * sentence's height is a line count times a line-height, and a fallback
		 * face measures a different one), the composer's own textarea exists, and
		 * the page has recorded the alert it painted.
		 */
		let ready = false;
		for (let i = 0; i < 240 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					if (document.fonts.status !== "loaded") return false;
					if (!document.querySelector("textarea")) return false;
					if (!window.__storeRefusalEvidence) return false;
					return window.__storeRefusalEvidence.alertText !== undefined;
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			/*
			 * A page that never mounted and a page mounting slowly are different
			 * failures, and a bare timeout reports neither, so the throw carries what
			 * the document actually holds.
			 */
			const { result: diagnostic } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				awaitPromise: true,
				expression: `(async () => ({
					url: location.href,
					fonts: document.fonts.status,
					textarea: !!document.querySelector("textarea"),
					alert: !!document.querySelector('[role="alert"]'),
					evidence: window.__storeRefusalEvidence ?? null,
					importError: await import("/store-refusal-evidence.tsx").then(
						() => null,
						(e) => String(e && e.message ? e.message : e),
					),
				}))()`,
			});
			throw new Error(
				`${expected.case}: never became measurable - ${JSON.stringify(
					diagnostic.value,
				)}${cdp.log.length > 0 ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
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
			throw new Error(`${expected.case}: no probe value returned`);
		const probe = result.value;
		const failures = assertions(probe, expected);
		records.push({
			case: expected.case,
			name: expected.name,
			expected,
			...probe,
			failures,
		});
		for (const failure of failures)
			problems.push(`${expected.case}: ${failure}`);

		const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
		writeFileSync(
			join(OUT, `${expected.case}.png`),
			Buffer.from(shot.data, "base64"),
		);
	}

	writeFileSync(
		join(OUT, "readings.json"),
		`${JSON.stringify({ capturedAt: new Date().toISOString(), theme: THEME, viewport: VIEWPORT, column: COLUMN, cases: records }, null, 2)}\n`,
	);

	const report = records.map((record) => ({
		case: record.case,
		expectedCode: record.expected.code,
		status: record.evidence?.status,
		code: record.evidence?.code,
		withholdRetryHint: record.evidence?.withholdRetryHint,
		alertText: record.alertText,
		failures: record.failures,
	}));

	teardown();

	if (AS_JSON) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		for (const row of report) {
			process.stdout.write(
				`${row.failures.length === 0 ? "PASS" : "FAIL"} ${row.case}: ${row.status}/${row.code} withholdRetryHint=${row.withholdRetryHint}\n  ${row.alertText}\n`,
			);
		}
	}
	if (problems.length > 0) {
		for (const problem of problems) process.stderr.write(`FAIL ${problem}\n`);
		process.exitCode = 1;
	}
};

await main();
