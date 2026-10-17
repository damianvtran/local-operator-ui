#!/usr/bin/env node
/**
 * Drives the read-receipt skew page and captures one state per run.
 *
 *     node docs/evidence/read-ack-skew/harness/readack-skew.mjs \
 *         --state=before|after [--theme=<name>] [--out=<dir>]
 *
 * The approach is `scripts/toast-close-geometry.mjs`'s, and for the same
 * reasons: raw CDP against a private headless Chrome (`withMockKeychain`, a
 * fresh user-data-dir, killed on exit by exact pid), a vite dev server from the
 * WORKTREE the script is run in - so `--state=before` against the unmodified
 * checkout renders the unmodified modules, and `--state=after` against the
 * fixed one renders the fix - and PNG output, deliberately: `check-evidence`'s
 * frame walker counts `.webp` only, so a hand-driven set cannot be mistaken for
 * frames a sweep produced.
 *
 * What each state waits for before capturing: the readout panel has been
 * written (`#readout[data-ok="true"]`), and for `before`, the toast has mounted
 * (`[data-sonner-toast][data-mounted="true"]`) - the card is the defect's whole
 * point, and a capture that raced the mount would photograph an empty corner.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "../../../.."));
const ARGS = process.argv.slice(2);
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const STATE = flag("state") ?? "after";
const THEME = flag("theme") ?? "localOperatorDark";
const OUT =
	flag("out") ?? join(ROOT, "docs/evidence/read-ack-skew/frames");
const PORT = Number(flag("port") ?? 5447);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: 1000, height: 780 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		this.log = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve: res, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
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
		return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
	}
	async eval(expression) {
		const { result } = await this.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
		});
		return result.value;
	}
}

let vite = null;
let chrome = null;
let dataDir = null;

const stopAll = async () => {
	for (const child of [vite, chrome]) {
		try {
			if (child && child.pid) process.kill(child.pid, "SIGTERM");
		} catch {}
	}
	/*
	 * WAIT for Chrome's exit before removing its profile: the rm racing the
	 * shutdown is how a ~50 KB stub survived per run (the QA round's hygiene
	 * note). SIGKILL after 2 s in case the browser is wedged, one beat for the
	 * kill to land, then the sweep.
	 */
	if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
		await Promise.race([
			new Promise((resolve) => chrome.once("exit", resolve)),
			sleep(2000).then(() => {
				try {
					process.kill(chrome.pid, "SIGKILL");
				} catch {}
			}),
		]);
		await sleep(200);
	}
	try {
		if (dataDir) rmSync(dataDir, { recursive: true, force: true });
	} catch {}
};

try {
	mkdirSync(OUT, { recursive: true });

	/** The vite dev server, from THIS worktree, serving the harness page. */
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(import.meta.dirname, "readack-skew.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, READACK_SKEW_PORT: String(PORT) } },
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(`${ORIGIN}/readack-skew.html`)).ok) break;
		} catch {}
		await sleep(500);
		if (i === 239) throw new Error("the harness page never came up");
	}

	/** The private headless Chrome, mock keychain, ephemeral profile. */
	dataDir = join(tmpdir(), `lo-readack-skew-${process.pid}`);
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
	const wsUrl = await new Promise((res, rej) => {
		let buf = "";
		const t = setTimeout(() => rej(new Error("Chrome did not report a debug port")), 30_000);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
				res(m[1]);
			}
		});
		chrome.on("exit", (code) => rej(new Error(`Chrome exited early (${code})`)));
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.addEventListener("open", res, { once: true });
		ws.addEventListener("error", rej, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: VIEWPORT.width,
		height: VIEWPORT.height,
		deviceScaleFactor: 2,
		mobile: false,
	});

	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/readack-skew.html?state=${STATE}&theme=${THEME}`,
	});
	const wantToast = STATE === "before";
	const ready = async () =>
		cdp.eval(`(() => {
			if (document.fonts.status !== "loaded") return false;
			const readout = document.getElementById("readout");
			if (!readout || readout.getAttribute("data-ok") !== "true") return false;
			if (${wantToast}) {
				const toast = document.querySelector("[data-sonner-toast]");
				if (!toast || toast.getAttribute("data-mounted") !== "true") return false;
			}
			return true;
		})()`);
	let ok = false;
	for (let i = 0; i < 240 && !ok; i++) {
		ok = (await ready()) === true;
		if (!ok) await sleep(250);
	}
	if (!ok) {
		throw new Error(
			`the ${STATE} state never became ready; page log: ${cdp.log.slice(-5).join(" | ")}`,
		);
	}
	await sleep(400);

	const readoutText = await cdp.eval("document.getElementById('readout').textContent");
	const toasts = await cdp.eval(
		`(() => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.textContent || "").replace(/\\\\s+/g, " ").trim()))()`,
	);

	const label = `readack-skew-${STATE}`;
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${label}.png`), Buffer.from(shot.data, "base64"));
	writeFileSync(
		join(OUT, `${label}.readout.json`),
		`${JSON.stringify({ state: STATE, theme: THEME, toasts, readout: JSON.parse(readoutText) }, null, 2)}\n`,
	);
	console.log(`captured ${join(OUT, `${label}.png`)}`);
	console.log(`toasts: ${JSON.stringify(toasts)}`);
} finally {
	await stopAll();
}
