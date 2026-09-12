#!/usr/bin/env node
/**
 * Capture the write/edit diff body from a REAL durable transcript.
 *
 *     node scripts/diff-body-evidence.mjs [--session=<id>] [--anchor=<row id>]
 *         [--before=4] [--after=4] [--themes=a,b] [--store=<dir>] [--port=5198]
 *
 * Why this exists alongside `chat-tool-rows--diff-body`. That story renders a
 * `TranscriptRecord` this repository built, so it proves the component. This
 * one starts where the app starts: `<store>/<session>/transcript.jsonl` is the
 * durable transcript `read_transcript_page` reads, and its rows are what
 * `/v1/desktop/sessions/{id}/history` serialises onto the wire
 * (`server/utils/desktop_sessions.py` — `[json.loads(row.to_json()) for row in
 * page.entries]`). A frame from here proves the whole chain: the durable row's
 * own encoding, `applyHistoryPage`'s extraction of
 * `provider_payload.details.diff`, the identity gate, the args-drop rule and
 * the painting.
 *
 * No backend and no Electron are required — the durable bytes are read from
 * disk and handed to the shipped reducer. What that does NOT prove is written
 * down in `docs/evidence/write-edit-diff/README.md`: there is no HTTP round
 * trip here, and the live `tool_execution_end` path is covered by
 * `scripts/transcript-reducer.test.mjs` rather than by a frame.
 *
 * The payload is never committed. It is written to a temp file, served to the
 * harness by `diff-body-evidence.vite.mjs`, and deleted on the way out: a frame
 * is evidence, but somebody's conversation is not a repository fixture.
 */

import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertFramePaints } from "./check-evidence.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** Chrome prints the DevTools websocket on stderr; this is how it is found. */
const DEBUG_PORT = /ws:\/\/[^:]+:(\d+)\//;

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

/*
 * The default is one real conversation on this machine: a run of consecutive
 * `edit` rows whose diffs are 197, 58 and 14 lines, so ONE frame carries the
 * three shapes that matter — a body the producer capped at 200 with its own
 * trailing `…`, a body longer than the 40-line display cap with the overflow
 * marker under it, and a short body shown whole. Reproducing on another machine
 * means naming a session of your own: `--session=<id> --anchor=<row id>`.
 */
const STORE = flag("store", join(homedir(), ".local-operator", "sessions"));
const SESSION = flag("session", "03fc7a26484a");
const ANCHOR = flag("anchor", "b3988cb0846b492086447e1626c5ee8c");
const BEFORE = Number(flag("before", "4"));
const AFTER = Number(flag("after", "4"));
const THEMES = flag("themes", "localOperatorDark,localOperatorLight").split(
	",",
);
const PORT = Number(flag("port", "5198"));
const OUT = join(ROOT, "docs", "evidence", "write-edit-diff");

/** The window of real rows around the anchor, as a `HistoryPage`. */
function readPage() {
	const path = join(STORE, SESSION, "transcript.jsonl");
	const rows = readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line));
	const index = rows.findIndex((row) => row.id === ANCHOR);
	if (index < 0) throw new Error(`${ANCHOR} is not a row of ${SESSION}`);
	const window = rows.slice(Math.max(0, index - BEFORE), index + AFTER + 1);
	// The rows ARE the wire entries: `read_transcript_page` serialises the same
	// stored records, so nothing is reshaped on the way to the reducer.
	return { entries: window, has_more: false, cursor_missing: false };
}

async function waitFor(url, attempts = 120) {
	for (let i = 0; i < attempts; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error(`${url} never came up`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A private headless Chrome over raw CDP, the same shape the capture uses. */
async function launchChrome(profile) {
	const chrome = spawn(CHROME, [
		"--headless=new",
		"--no-first-run",
		"--no-default-browser-check",
		"--remote-debugging-port=0",
		`--user-data-dir=${profile}`,
		"--disable-gpu",
		"--hide-scrollbars=false",
		"about:blank",
	]);
	const port = await new Promise((resolvePort, reject) => {
		chrome.stderr.on("data", (chunk) => {
			const match = DEBUG_PORT.exec(String(chunk));
			if (match) resolvePort(match[1]);
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
		setTimeout(() => reject(new Error("Chrome reported no debug port")), 20000);
	});
	const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = list.find((target) => target.type === "page");
	let nextId = 1;
	const pending = new Map();
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolve: done, reject } = pending.get(message.id);
		pending.delete(message.id);
		message.error
			? reject(new Error(JSON.stringify(message.error)))
			: done(message.result);
	};
	await new Promise((opened) => {
		ws.onopen = opened;
	});
	const send = (method, params = {}) =>
		new Promise((done, reject) => {
			const id = nextId++;
			pending.set(id, { resolve: done, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { chrome, send };
}

async function main() {
	const page = readPage();
	const payloadDir = mkdtempSync(join(tmpdir(), "diff-body-"));
	const payloadPath = join(payloadDir, "page.json");
	writeFileSync(payloadPath, JSON.stringify(page));
	const profile = mkdtempSync(join(tmpdir(), "diff-body-chrome-"));
	/** Assigned below; declared here so `teardown` can always reach it. */
	let chrome = null;
	console.log(
		`real payload: session ${SESSION}, ${page.entries.length} rows around ${ANCHOR.slice(0, 8)}`,
	);

	const vite = spawn(
		"pnpm",
		["vite", "--config", "scripts/diff-body-evidence.vite.mjs"],
		{
			cwd: ROOT,
			env: {
				...process.env,
				DIFF_BODY_PAYLOAD: payloadPath,
				DIFF_BODY_PORT: String(PORT),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let viteLog = "";
	const collect = (chunk) => {
		viteLog += chunk;
	};
	vite.stdout.on("data", collect);
	vite.stderr.on("data", collect);

	const teardown = () => {
		vite.kill("SIGKILL");
		/* And the browser: its stderr is piped for the debug-port handshake,
		   which is a live handle on the event loop — without this the driver
		   prints its last line and then hangs forever instead of exiting. */
		chrome?.kill("SIGKILL");
		try {
			rmSync(profile, { recursive: true, force: true });
			rmSync(payloadDir, { recursive: true, force: true });
		} catch {
			// Chrome/rsync may still hold a handle; the paths are in /tmp.
		}
	};
	process.on("SIGINT", () => {
		teardown();
		process.exit(130);
	});

	try {
		await waitFor(`http://localhost:${PORT}/diff-body-evidence.html`);
		const launched = await launchChrome(profile);
		chrome = launched.chrome;
		const send = launched.send;
		await send("Page.enable");
		await send("Runtime.enable");

		for (const theme of THEMES) {
			await send("Emulation.setDeviceMetricsOverride", {
				width: 1280,
				height: 1400,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Page.navigate", {
				url: `http://localhost:${PORT}/diff-body-evidence.html?theme=${theme}`,
			});
			/* Wait for the harness's own readiness flag: it is set after the real
			   page has been folded by the reducer, the rows opened and the frame
			   measured, so nothing below races a half-rendered transcript. */
			let measured = null;
			for (let attempt = 0; attempt < 120; attempt++) {
				const { result } = await send("Runtime.evaluate", {
					returnByValue: true,
					expression: "window.__diffEvidence || null",
				});
				if (result.value) {
					measured = result.value;
					break;
				}
				await sleep(250);
			}
			if (!measured)
				throw new Error(`${theme}: the harness never reported ready`);

			/*
			 * Size the viewport to the FRAME, not to the document.
			 *
			 * The app's own stylesheet pins `html, body { height: 100%; overflow:
			 * hidden }` (that is what stops a portaled toast scrolling the whole
			 * window), so on this page `documentElement.scrollHeight` reports the
			 * WINDOW — 1400 — no matter how tall the transcript inside it is. The
			 * first version captured that number and produced a 1400px frame
			 * showing three real diff bodies with the third cut off mid-line. The
			 * harness publishes the height ITS frame measured once its content
			 * stopped growing; resizing the viewport to it lets `height: 100%`
			 * resolve to the same number and the content lands whole.
			 */
			await send("Emulation.setDeviceMetricsOverride", {
				width: 1280,
				height: Math.min(measured.height, 16384),
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			const { data } = await send("Page.captureScreenshot", {
				format: "webp",
				quality: 88,
			});
			const dir = join(OUT, "real-durable-diff-rows");
			mkdirSync(dir, { recursive: true });
			const framePath = join(dir, `${theme}.webp`);
			writeFileSync(framePath, Buffer.from(data, "base64"));
			assertFramePaints(framePath, theme);

			const theme_ = await send("Runtime.evaluate", {
				returnByValue: true,
				expression: "document.documentElement.dataset.theme",
			});
			if (theme_.result.value !== theme)
				throw new Error(`frame named ${theme} carries ${theme_.result.value}`);
			console.log(
				`${theme}: ${measured.rows} rows, ${measured.bodies} diff bodies, ` +
					`markers [${measured.markers.join(" | ")}], ` +
					`first line ${JSON.stringify(measured.firstLine.trim())}, ` +
					`frame ${measured.height}px`,
			);
			/*
			 * The wrap claim, measured rather than eyeballed: a body that
			 * overflows horizontally would report scrollWidth > clientWidth and
			 * is CLIPPED by `overflow-x-hidden`, so the number is the whole
			 * difference between "wraps" and "silently cuts the line's tail".
			 */
			for (const box of measured.boxes) {
				if (box.scrollWidth > box.clientWidth + 1)
					throw new Error(
						`${theme}: a diff body overflows horizontally (${box.scrollWidth} > ${box.clientWidth})`,
					);
			}
		}
		console.log(`frames in ${join(OUT, "real-durable-diff-rows")}`);
	} catch (error) {
		teardown();
		console.error(viteLog.split("\n").slice(-8).join("\n"));
		throw error;
	}
	teardown();
}

await main();
