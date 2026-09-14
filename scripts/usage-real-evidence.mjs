#!/usr/bin/env node
/**
 * Capture ONE frame of the shipped `/usage` view against REAL provider data.
 *
 *     pnpm vite --config scripts/usage-real-evidence.vite.mjs   # in one shell
 *     node scripts/usage-real-evidence.mjs                      # then this
 *
 * Why this exists. Every other frame under `docs/evidence/chat-usage/` renders
 * fixtures from a story, which is the only way to photograph a dead OAuth grant
 * or an exhausted weekly window on demand. What a fixture cannot answer is
 * whether the shipped view renders the shape the backend ACTUALLY sends — a
 * port can agree with its own fixtures and still be wrong about the wire. This
 * fetches a real cached report from the local backend and renders the shipped
 * component against it.
 *
 * The credential. `GET /v1/desktop/usage` needs the desktop bearer, which the
 * running server process carries in its environment. It is read from there,
 * held in memory for exactly one request, and NEVER printed, logged, written to
 * disk, or passed to the browser — the page receives the response body only.
 *
 * The redaction. A real report's `identity` fields are account emails and API
 * key fragments. They are replaced before injection, because a committed
 * evidence frame is public. Nothing else is altered: the numbers, windows,
 * tiers, units, staleness and ordering are the backend's own, which is the
 * whole point of the frame.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence", "chat-usage", "real-data");
const HARNESS = "http://localhost:5201/usage-real-evidence.html";
const BACKEND = "http://localhost:1111";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const THEMES = ["localOperatorDark", "localOperatorLight"];
const WIDTH = 1100;
const HEIGHT = 1000;

/**
 * The desktop bearer, read from the running server's own environment.
 *
 * `ps eww` is the only place this token exists that does not require being the
 * server. It is returned, used once, and never rendered anywhere.
 */
/**
 * Every desktop bearer visible on the port, newest-looking first.
 *
 * More than one process can hold :1111 and they need not agree: a running
 * Electron app and a separately started `local-operator serve` each carry their
 * own `LOCAL_OPERATOR_DESKTOP_TOKEN`, and only the one that actually minted the
 * listening server's auth is accepted. Which is which cannot be told from the
 * process list, so the caller tries them against the endpoint rather than
 * guessing — a wrong guess is a 401 that looks like a broken harness.
 */
const desktopTokens = () => {
	const pids = execFileSync("lsof", ["-ti", "tcp:1111"])
		.toString()
		.trim()
		.split("\n")
		.filter(Boolean);
	if (pids.length === 0) throw new Error("No backend listening on :1111");
	const tokens = [];
	for (const pid of pids) {
		let env = "";
		try {
			env = execFileSync("ps", ["eww", "-p", pid]).toString();
		} catch {
			continue; // the process went away between listing and reading
		}
		const token = env
			.split(/\s+/)
			.find((entry) => entry.startsWith("LOCAL_OPERATOR_DESKTOP_TOKEN="));
		if (token) tokens.push(token.slice("LOCAL_OPERATOR_DESKTOP_TOKEN=".length));
	}
	if (tokens.length === 0)
		throw new Error(
			"No process listening on :1111 carries LOCAL_OPERATOR_DESKTOP_TOKEN in its environment",
		);
	return tokens;
};

/**
 * The usage report: fetched from the live backend, or replayed from a response
 * saved by an earlier run of this script (`--payload=<file>`).
 *
 * The replay path exists because the backend's usage cache is emptied whenever
 * it restarts, and repopulating it means probing every signed-in provider's
 * rate-limited endpoint. A frame is evidence about the RENDERER, so a response
 * the backend genuinely produced is as good a witness an hour later as it was
 * when it landed — provided it is a real response and is labelled as a replay,
 * which the README records. It is never a fixture: nothing here fabricates a
 * field, and a hand-written file would fail the shape assertions below.
 */
const fetchReport = async () => {
	const replay = process.argv
		.find((arg) => arg.startsWith("--payload="))
		?.slice("--payload=".length);
	if (replay) {
		const saved = JSON.parse(readFileSync(replay, "utf8"));
		const payload = saved.result ?? saved;
		if (!Array.isArray(payload?.reports))
			throw new Error(`${replay} does not hold a /v1/desktop/usage response`);
		console.log(`Replaying a saved real response from ${replay}`);
		return payload;
	}
	let last = 0;
	for (const token of desktopTokens()) {
		const response = await fetch(
			`${BACKEND}/v1/desktop/usage?live=false&refresh=false`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		if (response.ok) return (await response.json()).result;
		last = response.status;
	}
	throw new Error(
		`No visible desktop bearer was accepted for /v1/desktop/usage (last status ${last})`,
	);
};

/**
 * Replace an account identity with a shape-preserving stand-in.
 *
 * Shape-preserving because the identity's LENGTH is part of what the frame is
 * evidence about: it shares the heading row with the provider name and the
 * binding window, and a redaction shorter than the real string would photograph
 * a layout no user has.
 */
const redact = (identity, index) => {
	if (identity === null) return null;
	if (identity.includes("@")) return `account-${index + 1}@example.com`;
	// A key fragment like `sk-or-…f3a1`: keep the prefix and the ellipsis form.
	const head = identity.slice(0, Math.min(6, identity.length));
	return `${head}…${String(index + 1).padStart(4, "0")}`;
};

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
		/* Chrome writes into its profile as it dies, so a single `rm` races it and
		   fails ENOTEMPTY — which would mask the run's real outcome. */
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
				break;
			} catch {
				// still being written; the next attempt is after the process is gone
			}
		}
		dataDir = null;
	}
};

const main = async () => {
	const payload = await fetchReport();
	payload.reports = payload.reports.map((report, index) => ({
		...report,
		identity: redact(report.identity, index),
	}));
	console.log(
		`Real report: ${payload.reports.length} providers, ` +
			`${payload.reports.reduce((n, r) => n + r.limits.length, 0)} windows, source=${payload.source}`,
	);

	dataDir = join(tmpdir(), `lo-usage-real-${process.pid}`);
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
	const ws = new WebSocket(
		list.find((t) => t.type === "page").webSocketDebuggerUrl,
	);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");

	mkdirSync(OUT, { recursive: true });
	/* The injected script is REPLACED per theme, not merely re-added: scripts
	   registered with `addScriptToEvaluateOnNewDocument` accumulate and run in
	   registration order, so the second theme's document kept being painted by
	   the first theme's script and the theme guard below caught it. */
	let seedScript = null;
	for (const theme of THEMES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: WIDTH,
			height: HEIGHT,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		/* Via `about:blank`, because navigating to the URL already loaded is a
		   no-op in CDP: the second theme's frame was otherwise captured from the
		   first theme's still-mounted document. */
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(150);
		/* The payload and the theme are installed BEFORE any app script runs, so
		   the harness reads them on its first render rather than after a flash of
		   the wrong ground. The clock is pinned to the response's own server
		   stamp, which is what the ages and countdowns are measured from. */
		if (seedScript) {
			await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
				identifier: seedScript,
			});
		}
		({ identifier: seedScript } = await cdp.send(
			"Page.addScriptToEvaluateOnNewDocument",
			{
				/* ONLY the payload. This runs before the parser has produced a
				   `documentElement`, so touching the theme here throws — and the
				   throw aborted the rest of the script, which is why the harness
				   saw no payload and rendered nothing. The theme is applied from
				   the poll below, after the document exists. */
				source: `window.__USAGE_FIXTURE__ = ${JSON.stringify({ payload, now: payload.fetched_at })};`,
			},
		));
		await cdp.send("Page.navigate", { url: HARNESS });
		/* Polled rather than read once: Vite compiles the harness's TSX on first
		   request, so the first navigation can still be in flight well past any
		   fixed sleep short enough to be worth paying on the second theme. */
		let applied = "";
		for (let attempt = 0; attempt < 60; attempt++) {
			/* Applied AFTER the parser has run, not only from the on-new-document
			   script: the harness's own `<html data-theme=…>` markup is parsed
			   after that script and would overwrite it, which pinned every frame
			   to the attribute in the file regardless of the theme requested. */
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const el = document.documentElement;
					el.dataset.theme = ${JSON.stringify(theme)};
					el.classList.toggle("dark", ${JSON.stringify(theme.endsWith("Dark"))});
					/* Readiness is measured by the dialog's presence anywhere in the
					   document, not by the mount node's children: the dialog renders
					   through a Radix portal appended to body, so the mount node
					   stays empty however well the view mounted. */
					return document.querySelector("[role=dialog]")
						? el.dataset.theme
						: "";
				})()`,
			});
			applied = result.value;
			if (applied === theme) break;
			await sleep(250);
		}
		if (applied !== theme)
			throw new Error(`document carries theme "${applied}" after 15s`);
		/* Same guard the sweep uses: a page that mounted nothing must not be
		   written out as a frame. */
		const { result: sane } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `document.body.querySelectorAll("*").length >= 8`,
		});
		if (!sane.value) {
			/* A harness that mounted nothing has almost always thrown, and the
			   throw is the actual diagnosis — reporting only "did not render"
			   sends the next person to the screenshot instead of the stack. */
			const { result: why } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: "window.__HARNESS_ERROR__ || document.body.innerText || ''",
			});
			throw new Error(`harness did not render: ${why.value || "(no output)"}`);
		}
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression: `document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`,
		});
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "webp",
			quality: 88,
		});
		const framePath = join(OUT, `${theme}.webp`);
		writeFileSync(framePath, Buffer.from(data, "base64"));
		assertFramePaints(framePath, theme);
		console.log(`wrote ${framePath}`);
	}
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		teardown();
		process.exit(130);
	});
}
try {
	await main();
} catch (err) {
	console.error(err);
	process.exitCode = 1;
} finally {
	teardown();
}
