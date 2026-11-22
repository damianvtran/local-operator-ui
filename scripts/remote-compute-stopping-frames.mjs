#!/usr/bin/env node
/**
 * The round-4 frames and the DOM readings that go with them: the stopping card,
 * the picker opened through the control's own door, and an unknown token in the
 * runs-dialog row.
 *
 *     node scripts/with-storybook.mjs -- node scripts/remote-compute-stopping-frames.mjs
 *
 * WHY A PURPOSE-BUILT RIG RATHER THAN A SWEEP. Two of the three claims are DOM
 * READS, not pictures: a frame can show a button that looks disabled and cannot
 * say `disabled === true`, and it cannot say `aria-expanded="true"` at all. Design
 * round 4 (D15) is about a control's state and QA round 4's Q-1 is about a panel
 * that stayed shut, so each frame here is taken with the reading that falsifies
 * its claim, in the same pass, from the same document.
 *
 * Raw CDP against a private headless Chrome, the same launch discipline as
 * `chat-measure-evidence.mjs` and `capture-evidence.mjs` (fresh user-data-dir, the
 * mock-keychain switch, killed on exit). The Chrome driver is duplicated rather
 * than imported for the reason those files record.
 *
 * A FAILED READING EXITS NON-ZERO: this is proof, and the frames are only written
 * once the reading they are evidence for holds.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "pr-evidence", "remote-compute-device-row");
const ARGS = process.argv.slice(2);
/* `with-storybook.mjs` hands its own port to the command it wraps, so the origin
 * is read from there when no argument names one. */
const ORIGIN =
	ARGS.find((a) => !a.startsWith("--")) ??
	process.env.STORYBOOK_ORIGIN ??
	"http://localhost:6017";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The cases, each with the reading that is its claim.
 *
 * `clip` names the element the frame is taken of; `none` means the viewport, which
 * is what the picker frame needs - Radix portals the menu to `document.body`, so
 * a clip of the story root would photograph a header with a hole in it where the
 * panel is.
 */
const CASES = [
	{
		frame: "card-stopping",
		story: "chat-remote-compute--card-stopping",
		clip: "[data-remote-run-card]",
		size: [700, 260],
		read: `(() => {
			const card = document.querySelector("[data-remote-run-card]");
			const status = document.querySelector("[data-remote-run-status]");
			const button = document.querySelector("[data-remote-run-cancel]");
			if (!card || !status || !button) return null;
			return {
				phase: card.getAttribute("data-remote-run-card"),
				token: status.getAttribute("data-remote-run-status"),
				word: status.textContent,
				mono: status.className.includes("font-mono"),
				clock: !!document.querySelector("[data-remote-run-elapsed]"),
				amount: document.querySelector("[data-remote-run-amount]")?.getAttribute("data-remote-run-amount") ?? null,
				label: button.textContent,
				disabled: button.disabled,
			};
		})()`,
		expect: (r) => [
			["phase in flight", r.phase === "in-flight"],
			["word is the app's", r.word === "Cancelling…"],
			["not mono", r.mono === false],
			["clock still running", r.clock === true],
			["hold still shown", r.amount === "held"],
			["label kept", r.label === "Cancel"],
			["Cancel disabled", r.disabled === true],
		],
	},
	{
		/*
		 * A READING WITHOUT A FRAME. This is the control for the disabled state - a
		 * running run's Cancel is enabled - and a second picture of the card that
		 * already has one committed would replace an approved frame with a slightly
		 * different clip for no claim of its own.
		 */
		frame: "card-running",
		capture: false,
		story: "chat-remote-compute--card-running",
		size: [700, 260],
		read: `(() => {
			const status = document.querySelector("[data-remote-run-status]");
			const button = document.querySelector("[data-remote-run-cancel]");
			if (!status || !button) return null;
			return { word: status.textContent, disabled: button.disabled };
		})()`,
		expect: (r) => [
			["control: Running", r.word === "Running"],
			["control: Cancel enabled", r.disabled === false],
		],
	},
	{
		frame: "pane-cwd-without-row-cwd-open",
		story: "chat-remote-compute--pane-cwd-without-row-cwd",
		clip: null,
		size: [1080, 460],
		read: `(() => {
			const chip = document.querySelector("[data-device-chip]");
			if (!chip) return null;
			return {
				expanded: chip.getAttribute("aria-expanded"),
				rows: document.querySelectorAll("[data-device-row]").length,
			};
		})()`,
		expect: (r) => [
			["control exists", r !== null],
			["aria-expanded true", r?.expanded === "true"],
			["the menu has rows", r?.rows > 0],
		],
	},
	{
		frame: "runs-unknown-token",
		story: "chat-remote-compute--runs-unknown-token",
		clip: "[data-radient-runs]",
		size: [600, 420],
		read: `(() => {
			const rows = [...document.querySelectorAll("[data-radient-run-row]")];
			if (rows.length < 2) return null;
			const token = (row) => {
				const el = [...row.querySelectorAll("span")].find(
					(node) => node.textContent === "error" || node.textContent === "Running",
				);
				return el
					? { word: el.textContent, mono: getComputedStyle(el).fontFamily.includes("Geist Mono") }
					: null;
			};
			return { error: token(rows[1]), running: token(rows[0]), rows: rows.length };
		})()`,
		expect: (r) => [
			["two rows", r?.rows === 2],
			["the unknown token reads mono", r?.error?.mono === true],
			["the known word does not", r?.running?.mono === false],
		],
	},
];

const THEMES = [
	["localOperatorDark", "dark"],
	["localOperatorLight", "light"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Hoisted rather than inline in the launch promise: a regex literal rebuilt on
   every data event is the shape the scripts lint refuses. */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

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
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const launch = async () => {
	dataDir = join(tmpdir(), `lo-rc-round4-${process.pid}`);
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
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
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
	return cdp;
};

const waitForStory = async (cdp, label) => {
	for (let i = 0; i < 160; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				const busy = [...document.querySelectorAll(
					".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader, .sb-show-errordisplay",
				)].some((el) => el.getBoundingClientRect().height > 0);
				if (busy) return false;
				if (document.fonts.status !== "loaded") return false;
				return !!document.querySelector("[data-remote-run-card], [data-device-chip], [data-radient-runs]");
			})()`,
		});
		if (result.value === true) return;
		await sleep(250);
	}
	throw new Error(`${label}: story never became measurable`);
};

const evaluate = async (cdp, expression) => {
	const { result } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression,
	});
	return result.value;
};

const main = async () => {
	const cdp = await launch();
	const failures = [];
	for (const entry of CASES) {
		for (const [theme, suffix] of THEMES) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: entry.size[0],
				height: entry.size[1],
				deviceScaleFactor: 1,
				mobile: false,
			});
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${entry.story}&viewMode=story&args=theme:${theme};locale:en`,
			});
			await waitForStory(cdp, `${entry.frame} @ ${theme}`);
			/* Two paint frames, so the shutter opens on the settled layout. */
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			const reading = await evaluate(cdp, entry.read);
			const checks = entry.expect(reading);
			for (const [what, ok] of checks) {
				if (!ok) failures.push(`${entry.frame} @ ${theme}: ${what}`);
			}
			const params = { format: "png" };
			if (entry.clip) {
				const box = await evaluate(
					cdp,
					`(() => {
						const el = document.querySelector(${JSON.stringify(entry.clip)});
						if (!el) return null;
						const r = el.getBoundingClientRect();
						return { x: r.left, y: r.top, width: r.width, height: r.height };
					})()`,
				);
				if (!box) throw new Error(`${entry.frame}: no ${entry.clip} to clip`);
				/* The element's own box plus the 8px the card's ground carries, so the
				 * frame's edge is the surface's edge rather than a cut through it. */
				params.clip = {
					x: Math.max(0, box.x - 8),
					y: Math.max(0, box.y - 8),
					width: box.width + 16,
					height: box.height + 16,
					scale: 1,
				};
			}
			if (entry.capture !== false) {
				const { data } = await cdp.send("Page.captureScreenshot", params);
				const file = join(OUT, `${entry.frame}-${suffix}.png`);
				mkdirSync(OUT, { recursive: true });
				writeFileSync(file, Buffer.from(data, "base64"));
				await assertFramePaints(file, theme);
				console.log(
					`${entry.frame}-${suffix}  ${entry.story} @ ${entry.size.join("x")}`,
				);
			} else {
				console.log(`${entry.frame}  ${entry.story} (reading only)`);
			}
			console.log(`  ${JSON.stringify(reading)}`);
			for (const [what, ok] of checks)
				console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
		}
	}
	if (failures.length) {
		throw new Error(`round-4 readings failed:\n  ${failures.join("\n  ")}`);
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
