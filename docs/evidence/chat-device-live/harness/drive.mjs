#!/usr/bin/env node
/**
 * The round-2 drive: a pick on a LIVE conversation, end to end, on the BUILT app.
 *
 * WHAT THIS EXISTS FOR. QA round 2's blocker was a value, not a shape: the live pick
 * composed its plan from the row's DISPLAY NAME, so the transfer carried
 * `to: "build-box"` - a name where the route resolves a device id - and every surface
 * downstream of the receipt then degraded (the in-flight chip read "Moving to this
 * device", and the `gone` surface a completed move should paint was unreachable).
 * The model suite cannot see that: `movePair` is correct for whatever destination its
 * caller states. So this boots the built tree in `--window-mode=headless` (never
 * shown, never focused), drives it with REAL input over the DevTools protocol, and
 * reads back the bytes the app's own transport posted, plus the chip and the notice
 * the receipt produced.
 *
 * ISOLATION mirrors the round-1 wire rig and `scripts/renderer-driver.mjs`: scratch
 * HOME/user-data/log roots, the CMUX_* and LOP_* families stripped, a cwd outside the
 * checkout carrying the `.env` the app's transport reads, the mock-keychain switch (a
 * scratch HOME has no keychain, and Chromium asks macOS to create one without it),
 * and SIGTERM then SIGKILL to the exact pid on the way out.
 *
 * THE ENDPOINT IS THIS LANE'S OWN (`server.mjs`), disclosed in the report: the three
 * mesh reads and the transfer route are fixtures in the wire's own shape, because the
 * installed daemon predates the `peer` admission and refuses the path before anything
 * can be measured. Everything else - the transport, the picker, the confirmation, the
 * receipt handling - is the shipped code.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";

/*
 * THE SWITCH IS TAKEN FROM ITS ONE HOME, never typed: `chrome-keychain.test.mjs` scans
 * `scripts/`, `bin/` and every evidence harness for the literal, because a rig that
 * spells it by hand drifts the day the switch it needs is something else. This rig
 * launches Electron rather than Chrome, so it is not a launch site the helper wraps -
 * but it still passes the switch, and it passes the constant.
 */
import { MOCK_KEYCHAIN_SWITCH } from "../../../../scripts/chrome-keychain.mjs";

import { fileURLToPath } from "node:url";

/**
 * The rig's own directory, and the checkout it drives: FOUR levels up, because
 * this file lives at `docs/evidence/chat-device-live/harness/`. It read three
 * while the rig was written at `docs/evidence/chat-device-live/` and the move
 * into `harness/` did not lengthen the walk, so `WT` resolved to `docs/` and
 * every run died on `docs/node_modules/electron`. The round-3 re-shoot (QA Q3-2)
 * is the first run to take this path; the frames the set shipped were taken
 * before the move, by the rig at its old depth. Lengthening the walk is what
 * makes the committed rig runnable again.
 */
const RIG = dirname(fileURLToPath(import.meta.url));
const WT = resolve(RIG, "../../../..");
/*
 * RUN ARTIFACTS GO TO SCRATCH, never into the committed tree: `wire.jsonl`,
 * `report.json`, the app's own profile and the two frames are this run's, and a
 * reader who re-runs the rig should not have to clean up after it. The session's
 * scratchpad is the harness's own convention for exactly this; a rig run without one
 * writes beside itself under `run/`, which is `.gitignore`d nowhere and must not be
 * committed.
 */
const OUT = process.env.LOCAL_OPERATOR_SCRATCHPAD
	? join(process.env.LOCAL_OPERATOR_SCRATCHPAD, "chat-device-live")
	: join(RIG, "run");
const BACKEND_PORT = 24321;
const RUN = join(OUT, "run");
const WIRE = join(OUT, "wire.jsonl");
/** The gate the endpoint waits on: written once the in-flight frame is on disk. */
const RELEASE = join(OUT, "release");

const report = { steps: [], errors: [], console: [] };
const step = (name, data) => {
	report.steps.push({ name, ...data });
	console.log(`[step] ${name}: ${JSON.stringify(data)}`);
};
const fail = (name, error) => {
	report.errors.push({ name, error: String(error) });
	console.log(`[error] ${name}: ${error}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
	new Promise((res, rej) => {
		const srv = createServer();
		srv.on("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => res(port));
		});
	});

async function waitForCdp(port, ms = 90_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const page =
				list.find(
					(t) =>
						t.type === "page" &&
						t.webSocketDebuggerUrl &&
						String(t.url).includes("index.html"),
				) ?? null;
			if (page) return page;
		} catch {}
		await sleep(400);
	}
	throw new Error(`CDP target never appeared on ${port}`);
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.handlers = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id && this.pending.has(msg.id)) {
				const { res, rej } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
			} else if (msg.method) {
				for (const h of this.handlers) h(msg);
			}
		});
	}
	on(fn) {
		this.handlers.push(fn);
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => {
			this.pending.set(id, { res, rej });
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					rej(new Error(`${method} timed out`));
				}
			}, 60_000);
		});
	}
	async eval(expression) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (r.exceptionDetails)
			throw new Error(
				`page: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`,
			);
		return r.result?.value;
	}
	async waitFor(expression, { timeout = 30_000, label = expression } = {}) {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			try {
				if (await this.eval(`!!(${expression})`)) return true;
			} catch {}
			await sleep(250);
		}
		throw new Error(`waitFor timed out: ${label}`);
	}
	async rectFor(selector, text = null) {
		return this.eval(`(() => {
			const want = ${JSON.stringify(text)};
			const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
			const el = want === null ? all[0] : all.find((n) => (n.textContent || "").includes(want));
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: (el.textContent || "").trim().slice(0, 120) };
		})()`);
	}
	async click(selector, text = null) {
		const box = await this.rectFor(selector, text);
		if (!box)
			throw new Error(
				`no element for ${selector}${text ? ` containing ${text}` : ""}`,
			);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await this.send("Input.dispatchMouseEvent", {
				type,
				x: box.x,
				y: box.y,
				button: "left",
				clickCount: 1,
			});
		}
		return box;
	}
}

const wire = () => {
	try {
		return readFileSync(WIRE, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
};

/** The chip, as a reader and a screen reader get it. */
const CHIP = `(() => {
	const chip = document.querySelector("[data-device-chip]");
	return chip ? { label: (chip.textContent || "").trim(), aria: chip.getAttribute("aria-label") || "" } : null;
})()`;

/** The notice under the header, and the picker's own rows when it is open. */
const NOTICE = `(() => {
	const node = document.querySelector('[data-device-notice="moved"]');
	if (!node) return null;
	return { text: (node.textContent || "").trim().slice(0, 400) };
})()`;

const PICKER = `(() => {
	const panel = document.querySelector("[data-device-picker]");
	if (!panel) return null;
	return {
		heading: (panel.querySelector("h2, [role=heading]")?.textContent || "").trim().slice(0, 60),
		rows: [...panel.querySelectorAll("[data-device-row]")].map((row) => ({
			state: row.getAttribute("data-device-row"),
			text: (row.textContent || "").trim().slice(0, 140),
		})),
		footer: (panel.querySelector("[data-device-footer]")?.textContent || "").trim().slice(0, 240) || null,
	};
})()`;

const DIALOG = `(() => {
	const dialog = document.querySelector('[role="dialog"]');
	if (!dialog) return null;
	return {
		title: (dialog.querySelector("h2, [id^=radix]")?.textContent || "").trim().slice(0, 80),
		text: (dialog.textContent || "").trim().slice(0, 500),
		buttons: [...dialog.querySelectorAll("button")].map((b) => ({
			text: (b.textContent || "").trim().slice(0, 60),
			disabled: b.disabled,
		})),
	};
})()`;

/** The composer's hold strip, as the page composed it. */
const HOLD = `(() => {
	const strip = document.querySelector("[data-device-hold]");
	return strip ? { sentence: (strip.textContent || "").trim().slice(0, 300) } : null;
})()`;

/**
 * A frame from the APP itself.
 *
 * `Page.captureScreenshot` is the renderer photographing its own window - the
 * instrument `scripts/renderer-driver.mjs` uses through `webContents.capturePage()`,
 * and the only one that can photograph a surface Storybook cannot mount (the composer
 * reads the preload seam, so a story over it renders Storybook's error display). The
 * PNG goes through `sharp` - the sweep's own dependency, borrowed from the worktree -
 * so the committed frame is a `.webp` like every other frame in the set.
 */
async function shutter(cdp, name) {
	const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
	const require = createRequire(import.meta.url);
	const sharp = require(join(WT, "node_modules", "sharp"));
	const out = join(OUT, "frames");
	mkdirSync(out, { recursive: true });
	const file = join(out, `${name}.webp`);
	await sharp(Buffer.from(data, "base64")).webp({ quality: 90 }).toFile(file);
	console.log(`[frame] ${name} -> ${file}`);
	return file;
}

async function main() {
	// The endpoint first: the app's first read is its capabilities, and a socket that
	// is not listening yet is a boot the rig reads as "no desktop plane".
	const endpoint = spawn(process.execPath, [join(RIG, "server.mjs")], {
		env: {
			...process.env,
			RIG_WIRE: WIRE,
			RIG_PORT: String(BACKEND_PORT),
			RIG_HOLD_FILE: RELEASE,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	endpoint.stdout.on("data", (b) =>
		console.log(`[endpoint] ${b.toString().trim()}`),
	);
	endpoint.stderr.on("data", (b) =>
		console.log(`[endpoint:err] ${b.toString().trim()}`),
	);
	await sleep(600);

	const cdpPort = await freePort();
	for (const d of ["home", "logs", "cwd", "userdata"])
		mkdirSync(join(RUN, d), { recursive: true });
	mkdirSync(OUT, { recursive: true });
	// main's transport reads `.env` from process.cwd() with dotenv override.
	writeFileSync(
		join(RUN, "cwd", ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${BACKEND_PORT}\n`,
	);
	writeFileSync(join(OUT, "daemon.token"), "rig-token-not-a-secret\n");

	const require = createRequire(import.meta.url);
	const electron = require(join(WT, "node_modules", "electron"));
	const cleanEnv = { ...process.env };
	for (const key of Object.keys(cleanEnv)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete cleanEnv[key];
	}
	const env = {
		...cleanEnv,
		PATH: process.env.PATH,
		HOME: join(RUN, "home"),
		LOCAL_OPERATOR_CONFIG_DIR: join(OUT, "config"),
		LOCAL_OPERATOR_LOG_DIR: join(RUN, "logs"),
		LOCAL_OPERATOR_DESKTOP_TOKEN: "rig-token-not-a-secret",
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		/*
		 * THE MANAGER STAYS DISABLED, and the day this guard was added is the receipt:
		 * a run of this rig whose endpoint never started (a stale spawn path in a
		 * copy) had the app's own Backend Service Manager probe its default port and
		 * SPAWN a real backend from the operator's Application Support install, which
		 * then served the operator's real sessions into a rig that promises a fixture
		 * world. The spawn env is the one place this is interceptable at runtime
		 * (`src/main/backend/config.ts` reads `process.env`), and with the plane
		 * answering from `server.mjs` the manager has nothing to do anyway.
		 */
		VITE_DISABLE_BACKEND_MANAGER: "true",
		TERM: "xterm-256color",
		LANG: "en_US.UTF-8",
	};
	const app = spawn(
		electron,
		[
			WT,
			"--window-mode=headless",
			`--user-data-dir=${join(RUN, "userdata")}`,
			`--remote-debugging-port=${cdpPort}`,
			MOCK_KEYCHAIN_SWITCH,
		],
		{ cwd: join(RUN, "cwd"), env, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logs = [];
	app.stdout.on("data", (b) => logs.push(b.toString()));
	app.stderr.on("data", (b) => logs.push(b.toString()));
	step("boot", { pid: app.pid, cdpPort, electron });

	let cdp = null;
	let ws = null;
	const reap = () => {
		try {
			process.kill(app.pid, "SIGTERM");
		} catch {}
		try {
			process.kill(endpoint.pid, "SIGTERM");
		} catch {}
	};
	try {
		const target = await waitForCdp(cdpPort);
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => {
			ws.addEventListener("open", res, { once: true });
			ws.addEventListener("error", rej, { once: true });
		});
		cdp = new Cdp(ws);
		cdp.on((msg) => {
			if (
				msg.method === "Runtime.consoleAPICalled" &&
				msg.params.type === "error"
			) {
				report.console.push(
					msg.params.args
						.map((a) => a.value ?? a.description ?? a.type)
						.join(" ")
						.slice(0, 300),
				);
			}
		});
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Log.enable");
		/*
		 * ONE VIEWPORT FOR THE WHOLE WALK, set through the same instrument the driver
		 * uses, so the two committed frames are the same size as each other and as the
		 * rest of this set's app captures.
		 */
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1100,
			height: 760,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.waitFor('document.querySelectorAll("button").length > 5', {
			label: "the app's first paint",
			timeout: 90_000,
		});
		const skipped = await cdp.eval(`(() => {
			const buttons = [...document.querySelectorAll("button")];
			const skip = buttons.find((b) => (b.textContent || "").trim().startsWith("Skip for now"));
			if (!skip) return "no onboarding";
			skip.click();
			return "skipped onboarding";
		})()`);
		step("onboarding", { outcome: skipped });
		await sleep(1200);
		/*
		 * WHAT THE APP ACTUALLY PAINTED, before anything is pressed: the walk below reads
		 * the catalogue's own row, and a rig that assumes a label instead of reading one
		 * spends its first run learning the app's copy by timing out.
		 */
		step(
			"diagnostics",
			await cdp.eval(`(() => ({
			hash: location.hash,
			rows: [...document.querySelectorAll("[data-chat-row]")].map((r) => (r.textContent || "").trim().slice(0, 80)),
			buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim().slice(0, 40)).slice(0, 40),
			body: (document.body.innerText || "").slice(0, 1200),
		}))()`),
		);

		/*
		 * THE LIVE CONVERSATION, opened the way a user opens one: the catalogue the
		 * endpoint answered renders as the sidebar's own row, and the row is pressed.
		 * No hash is written by this rig - the route is the app's.
		 */
		await cdp.waitFor(
			`[...document.querySelectorAll("button, [data-chat-row]")].some((n) => (n.textContent || "").includes("QA round 2, live arm"))`,
			{ label: "the session row", timeout: 60_000 },
		);
		const opened = await cdp.click(
			"button, [data-chat-row]",
			"QA round 2, live arm",
		);
		step("opened", { row: opened?.text });
		await cdp.waitFor(`document.querySelector("[data-device-chip]")`, {
			label: "the device chip",
			timeout: 60_000,
		});
		await sleep(1500);
		step("chip-before", await cdp.eval(CHIP));

		const catalogBefore = wire().filter(
			(call) =>
				call.path.startsWith("/v1/desktop/sessions") && call.method === "GET",
		).length;

		/* THE PICK: the chip, the row, and the confirmation the design requires. */
		await cdp.click("[data-device-chip]");
		await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
			label: "the picker",
			timeout: 30_000,
		});
		await sleep(500);
		step("picker-before", await cdp.eval(PICKER));
		const row = await cdp.click('[data-device-row="candidate"]', "build-box");
		step("pressed-row", { row: row?.text });
		await cdp.waitFor(`document.querySelector('[role="dialog"]')`, {
			label: "the confirmation",
			timeout: 30_000,
		});
		await sleep(400);
		const dialog = await cdp.eval(DIALOG);
		step("dialog", dialog);
		const confirm = (dialog?.buttons ?? []).find(
			(button) => !/cancel/i.test(button.text) && button.text,
		);
		if (!confirm) throw new Error("the confirmation drew no verb to press");
		await cdp.click('[role="dialog"] button', confirm.text);
		step("confirmed", { button: confirm.text });

		/*
		 * THE MOVE IN FLIGHT, WHICH IS THE ONLY WINDOW §2.4'S STRIP EXISTS IN: the
		 * endpoint is holding its answer until this rig releases it, so the state below
		 * is the app's real one - the composer is the app's own, and the strip is
		 * composed into it by the page (agent review R2-3's missing frame).
		 */
		await cdp.waitFor(`document.querySelector("[data-device-hold]")`, {
			label: "the composer's hold strip",
			timeout: 30_000,
		});
		await sleep(600);
		step("hold", await cdp.eval(HOLD));
		await shutter(cdp, "held");
		writeFileSync(RELEASE, `released ${new Date().toISOString()}\n`);

		/* THE OUTCOME: the receipt's own surface, and the chip it moves. */
		await cdp.waitFor(
			`document.querySelector('[data-device-notice="moved"]')`,
			{
				label: "the arrival notice",
				timeout: 60_000,
			},
		);
		await sleep(1200);
		step("chip-after", await cdp.eval(CHIP));
		step("notice", await cdp.eval(NOTICE));
		await cdp.click("[data-device-chip]");
		await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
			label: "the picker again",
			timeout: 30_000,
		});
		await sleep(500);
		step("picker-after", await cdp.eval(PICKER));
		await shutter(cdp, "gone");
		step("wire", {
			transfers: wire().filter((call) => call.path.endsWith("/transfer")),
			readsAfter: wire().length - catalogBefore,
		});

		/* AND THE WINDOW IS NEVER SHOWN, which is the claim the mode exists for. */
		const surfaces = await cdp.eval(`(() => {
			const visible = [...document.querySelectorAll("*")].length;
			return { painted: visible > 0, focused: document.hasFocus() };
		})()`);
		step("window", surfaces);
	} catch (error) {
		fail("scene", error);
		try {
			if (cdp)
				step(
					"diagnostics-on-failure",
					await cdp.eval(`(() => ({
						hash: location.hash,
						rows: [...document.querySelectorAll("[data-chat-row]")].map((r) => (r.textContent || "").trim().slice(0, 80)),
						body: (document.body.innerText || "").slice(0, 1500),
					}))()`),
				);
		} catch {}
	} finally {
		try {
			ws?.close();
		} catch {}
		reap();
		await sleep(2500);
		writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
		writeFileSync(join(OUT, "app.log"), logs.join(""));
		console.log(
			`\n[report] steps=${report.steps.length} errors=${report.errors.length} -> ${join(OUT, "report.json")}`,
		);
		process.exit(report.errors.length ? 1 : 0);
	}
}

main();
