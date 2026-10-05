#!/usr/bin/env node
/**
 * The sidebar-remote drive: remote rows in the sidebar's own bins, and the
 * sidebar's poll kept peer-free.
 *
 * WHAT THIS EXISTS FOR. The operator's report (2026-10-05): "make sure remote
 * sessions on the connected network(s) show up under Running, Today, Pinned,
 * This Week, etc - it should be listed seamlessly together with local sessions
 * but just have an icon/indicator ... and on hover it will read out which
 * remote device and network that session is on." The mechanism the fix rests on
 * is one ambient peers-inclusive read whose rows merge into the canonical
 * catalogue, while the sidebar's own poll must never carry `include_peers`. Both
 * halves are wire facts, and the row half is a pixel fact: neither is visible
 * from a unit test, so both are measured here.
 *
 * THE TWO ARMS. `--arm before` runs on the base tree, where the three remote
 * rows exist only in the federated answer and the sidebar lists the two local
 * rows and nothing else; `--arm after` runs on the fixed tree, where all five
 * are listed, the peer's rows carry the locality mark and their hover reads the
 * device and the network. Each arm asserts its own readings, so the pair cannot
 * pass by both being loose.
 *
 * THE INSTRUMENT is the repository's own, wired the way `docs/agent-driver.md`
 * describes: the BUILT app (its own Electron, `out/main/index.js`) in
 * `--window-mode=headless` (never shown, never focused), driven with real input
 * over the DevTools protocol, and photographed with `Page.captureScreenshot` -
 * every frame is the app photographing itself; no `screencapture`, no browser
 * engine, no Playwright. Isolation mirrors the sibling rigs: scratch HOME,
 * profile, config and log roots, the CMUX_* and LOP_* families stripped, the
 * mock-keychain switch taken from its one home (`scripts/chrome-keychain.mjs`),
 * and every process reaped by exact pid.
 *
 * THE ENDPOINT IS THIS SET'S OWN (`server.mjs`), disclosed in the README: the
 * catalogue BOTH ways, the two mesh reads and a minimal session stream are
 * fixtures in the wire's own shape. Everything else - the transport, the store,
 * the merge, the mark, the hover - is the shipped code.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * The single-frame predicate, so a frame that is not a picture of the app fails
 * the RUN that took it rather than a reviewer a week later.
 */
import { assertFramePaints } from "../../../../scripts/check-evidence.mjs";
/*
 * The switch is taken from its one home, never typed - the sibling rigs' rule,
 * and `chrome-keychain.test.mjs` scans for the literal.
 */
import { MOCK_KEYCHAIN_SWITCH } from "../../../../scripts/chrome-keychain.mjs";

const RIG = dirname(fileURLToPath(import.meta.url));
const WT = resolve(RIG, "../../../..");
const OUT = process.env.LOCAL_OPERATOR_SCRATCHPAD
	? join(process.env.LOCAL_OPERATOR_SCRATCHPAD, "sidebar-remote")
	: join(RIG, "run");
const BACKEND_PORT = 24325;

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? fallback : argv[at + 1];
};
const ARM = flag("arm", "after");
if (ARM !== "before" && ARM !== "after") {
	console.error("--arm must be before|after");
	process.exit(2);
}
const PEER_NAME = flag("peer-name", "cloud-node-1");
const NETWORK_NAME = flag("network-name", "damian-mesh");
const [WIN_W, WIN_H] = flag("window-size", "1380x900").split("x").map(Number);

const RUN = join(OUT, ARM, "run");
const WIRE = join(OUT, ARM, "wire.jsonl");
const FRAMES = join(OUT, ARM);

const report = { arm: ARM, peerName: PEER_NAME, steps: [], errors: [] };
const step = (name, data) => {
	report.steps.push({ name, ...data });
	console.log(`[step] ${name}: ${JSON.stringify(data)}`);
};
const fail = (name, error) => {
	report.errors.push({ name, error: String(error) });
	console.log(`[error] ${name}: ${error}`);
};
const check = (name, ok, detail) => {
	if (ok) step(`check:${name}`, { ok: true, detail });
	else fail(name, detail ?? "failed");
	return ok;
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
}

/* ---------------------------------------------------------------- input ---- */

/** One real pointer press into the centre of a selector's first match (or the
 * first whose text contains `text`), the sibling rigs' own shape. */
async function clickAt(cdp, selector, text = null) {
	const box = await cdp.eval(`(() => {
		const want = ${JSON.stringify(text)};
		const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
		const el = want === null ? all[0] : all.find((n) => (n.textContent || "").includes(want));
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || "").trim().slice(0, 80) };
	})()`);
	if (!box)
		throw new Error(
			`no element for ${selector}${text ? ` containing ${text}` : ""}`,
		);
	for (const [type, buttons] of [
		["mouseMoved", 0],
		["mousePressed", 1],
		["mouseReleased", 0],
	]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: box.x,
			y: box.y,
			button: type === "mouseMoved" ? "none" : "left",
			buttons,
			clickCount: type === "mouseMoved" ? 0 : 1,
		});
	}
	return box;
}

/** A pointer move onto a selector's first match, held there (no press). */
async function hoverAt(cdp, selector, text = null) {
	const box = await cdp.eval(`(() => {
		const want = ${JSON.stringify(text)};
		const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
		const el = want === null ? all[0] : all.find((n) => (n.textContent || "").includes(want));
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width * 0.4, y: r.y + r.height / 2 };
	})()`);
	if (!box) throw new Error(`no element to hover for ${selector}`);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: box.x,
		y: box.y,
		button: "none",
		buttons: 0,
	});
	return box;
}

/** The pointer parked on neutral chrome (the title lane), for frames where no
 * flyout may stand. */
async function parkPointer(cdp) {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 1100,
		y: 8,
		button: "none",
		buttons: 0,
	});
}

/* -------------------------------------------------------------- readings --- */

/**
 * The sidebar's drawn list, read in one trip: each `[data-chat-section]` with
 * its key and its rows' titles and boxes, plus the mark count.
 *
 * `data-chat-section` is the marker the panel's sections carry and the one the
 * evidence rigs scope by; a row's bin is therefore the section it is a
 * descendant of, not a geometric inference.
 */
const SIDEBAR = `(() => {
	const sections = [...document.querySelectorAll("[data-chat-section]")].map((section) => ({
		key: section.dataset.chatSection,
		rows: [...section.querySelectorAll("[data-chat-row]")].map((row) => ({
			title: (row.querySelector("[data-session-title]")?.textContent || "").trim(),
			y: Math.round(row.getBoundingClientRect().y),
		})),
	}));
	return {
		sections,
		rows: [...document.querySelectorAll("[data-chat-row]")].map((row) => ({
			text: (row.textContent || "").trim().slice(0, 120),
		})),
		markCount: document.querySelectorAll("[data-remote-mark]").length,
		region: (() => {
			const el = document.querySelector('[data-chat-region="sidebar"]') ?? document.querySelector('[data-sidebar-region="chats"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
		})(),
	};
})()`;

/** The chip, as a reader gets it. */
const CHIP = `(() => {
	const chip = document.querySelector("[data-device-chip]");
	return chip ? { label: (chip.textContent || "").trim() } : null;
})()`;

/** The open tooltip's text, when one stands. */
const TOOLTIP = `(() => {
	const tips = [...document.querySelectorAll('[role="tooltip"]')];
	return tips.map((t) => (t.textContent || "").trim()).filter(Boolean);
})()`;

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

/** The theme the document is wearing, for the frame's own name. */
const themeOf = (cdp) =>
	cdp.eval(`document.documentElement.dataset.theme || "localOperatorDark"`);

/**
 * A frame from the app itself, written where the committed set lays its own out
 * (`<arm>/<state>/<theme>.webp`) and judged by the repository's single-frame
 * predicate before the run may continue.
 */
async function shutter(cdp, state, { clip = null } = {}) {
	const theme = await themeOf(cdp);
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 90,
		...(clip ? { clip: { ...clip, scale: 1 } } : {}),
	});
	const dir = join(FRAMES, state);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${theme}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	await assertFramePaints(file, theme);
	console.log(`[frame] ${state} -> ${file}`);
	return file;
}

const LOCAL_TITLES = ["Local: renderer notes", "Local: release checklist"];
const REMOTE_TITLES = [
	"Remote: deployment notes",
	"Remote: camera rig sync",
	"Remote: weekly digest",
];

/** Two equal consecutive readings of the list's titles, so a frame is not taken
 * mid-settle. */
async function settleList(cdp, predicate, { timeout = 30_000 } = {}) {
	const deadline = Date.now() + timeout;
	let last = null;
	let stable = 0;
	while (Date.now() < deadline) {
		const read = await cdp.eval(SIDEBAR);
		const titles = read.sections
			.flatMap((s) => s.rows.map((r) => r.title))
			.join("|");
		const ok = predicate(read);
		if (ok && titles === last) stable += 1;
		else stable = 0;
		last = titles;
		if (ok && stable >= 2) return read;
		await sleep(450);
	}
	return cdp.eval(SIDEBAR);
}

/* ------------------------------------------------------------------ main --- */

async function main() {
	/*
	 * A FRESH ARM DIRECTORY EVERY TIME (the boot state, the wire and the report):
	 * the app restores persisted state from these roots, and a second run that
	 * reused them would boot into the previous pass's world. `FRAMES` is NOT
	 * wiped for the same reason the sibling rig keeps it: a variant run writes
	 * ADDITIONAL frames into the same shape.
	 */
	for (const stale of [
		RUN,
		join(OUT, ARM, "config"),
		WIRE,
		join(OUT, ARM, "report.json"),
		join(OUT, ARM, "app.log"),
	])
		rmSync(stale, { recursive: true, force: true });
	mkdirSync(join(OUT, ARM), { recursive: true });
	const endpoint = spawn(process.execPath, [join(RIG, "server.mjs")], {
		env: {
			...process.env,
			RIG_WIRE: WIRE,
			RIG_PORT: String(BACKEND_PORT),
			RIG_PEER_NAME: PEER_NAME,
			RIG_NETWORK_NAME: NETWORK_NAME,
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
	/*
	 * THE RIG'S OWN ADDRESS, written where main's transport reads it: `.env` from
	 * the process's cwd with `dotenv` override (`config.ts`), which is why the
	 * app is spawned with `cwd: RUN/cwd` below and not the worktree's own.
	 */
	writeFileSync(
		join(RUN, "cwd", ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${BACKEND_PORT}\n`,
	);

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
		LOCAL_OPERATOR_CONFIG_DIR: join(OUT, ARM, "config"),
		LOCAL_OPERATOR_LOG_DIR: join(RUN, "logs"),
		LOCAL_OPERATOR_DESKTOP_TOKEN: "[redacted]",
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		/* The manager stays disabled for the sibling rig's own measured reason: a
		 * run whose endpoint failed to start must not have the app's Backend
		 * Service Manager spawn a real backend from the operator's install. */
		VITE_DISABLE_BACKEND_MANAGER: "true",
		TERM: "xterm-256color",
		LANG: "en_US.UTF-8",
	};
	const app = spawn(
		electron,
		[
			WT,
			"--window-mode=headless",
			`--window-size=${WIN_W}x${WIN_H}`,
			`--user-data-dir=${join(RUN, "userdata")}`,
			`--remote-debugging-port=${cdpPort}`,
			MOCK_KEYCHAIN_SWITCH,
		],
		{ cwd: join(RUN, "cwd"), env, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logs = [];
	app.stdout.on("data", (b) => logs.push(b.toString()));
	app.stderr.on("data", (b) => logs.push(b.toString()));
	step("boot", { pid: app.pid, cdpPort, electron, arm: ARM });

	let cdp = null;
	let ws = null;
	const reap = () => {
		for (const pid of [app.pid, endpoint.pid]) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {}
		}
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
				report.console = report.console ?? [];
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
		 * THE HEADLESS WINDOW STANDS IN FOR A USER BEING PRESENT: React Query's
		 * `refetchInterval` pauses on an unfocused page, and the ambient read's own
		 * cadence is one of the things this pass measures. Best-effort: an Electron
		 * without the command still gets the one-shot read and the arm says so
		 * through its cadence check rather than failing here.
		 */
		try {
			await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		} catch {}
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: WIN_W,
			height: WIN_H,
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

		/*
		 * THE LIST SETTLES BEFORE ANY READING. `predicate` is the arm's own
		 * expectation of the list - presence for `after`, absence-of-remote for
		 * `before` - held until two consecutive equal title readings agree.
		 */
		const wantsRemote = ARM === "after";
		await cdp.waitFor(
			`document.querySelectorAll("[data-chat-row]").length >= 2`,
			{ label: "the sidebar's first rows" },
		);
		const sidebar = await settleList(
			cdp,
			(read) => {
				const titles = read.sections
					.flatMap((s) => s.rows.map((r) => r.title))
					.join("|");
				const hasRemote = REMOTE_TITLES.every((t) => titles.includes(t));
				return wantsRemote ? hasRemote : !titles.includes("Remote:");
			},
			{ timeout: wantsRemote ? 45_000 : 20_000 },
		);
		const flatTitles = sidebar.sections
			.flatMap((s) => s.rows.map((r) => r.title))
			.join("|");
		step("sidebar-list", {
			sections: sidebar.sections.map((s) => ({
				key: s.key,
				rows: s.rows.map((r) => r.title),
			})),
			markCount: sidebar.markCount,
		});

		/*
		 * THE ARM'S OWN READING OF THE ROWS.
		 *
		 * `before`: the local rows are there and every remote title is absent -
		 * the operator's exact case, "the sidebar lists only local rows" - and no
		 * locality mark is drawn anywhere.
		 */
		if (ARM === "before") {
			for (const title of LOCAL_TITLES)
				check(`before:local "${title}" listed`, flatTitles.includes(title));
			for (const title of REMOTE_TITLES)
				check(
					`before:remote "${title}" absent`,
					!flatTitles.includes(title),
					"the federated answer carries it and this arm's build cannot list it",
				);
			check(
				"before:no locality mark",
				sidebar.markCount === 0,
				`[data-remote-mark] count ${sidebar.markCount}`,
			);
		} else {
			for (const title of [...LOCAL_TITLES, ...REMOTE_TITLES])
				check(`after:"${title}" listed`, flatTitles.includes(title));
			check(
				"after:three locality marks",
				sidebar.markCount === 3,
				`[data-remote-mark] count ${sidebar.markCount}`,
			);
			const binOf = (title) =>
				sidebar.sections.find((s) => s.rows.some((r) => r.title === title))
					?.key ?? null;
			check(
				"after:bin running",
				binOf(REMOTE_TITLES[1]) === "running",
				`got ${binOf(REMOTE_TITLES[1])}`,
			);
			check(
				"after:bin today (remote)",
				binOf(REMOTE_TITLES[0]) === "today",
				`got ${binOf(REMOTE_TITLES[0])}`,
			);
			check(
				"after:bin week (remote)",
				binOf(REMOTE_TITLES[2]) === "week",
				`got ${binOf(REMOTE_TITLES[2])}`,
			);
			check(
				"after:bin today (local)",
				binOf(LOCAL_TITLES[0]) === "today",
				`got ${binOf(LOCAL_TITLES[0])}`,
			);
			check(
				"after:bin week (local)",
				binOf(LOCAL_TITLES[1]) === "week",
				`got ${binOf(LOCAL_TITLES[1])}`,
			);
			check(
				"after:no separate remote section",
				!sidebar.sections.some((s) =>
					(s.key ?? "").toLowerCase().includes("remote"),
				),
				"the sections are the one list's own: running/today/week/older(/pinned)",
			);

			/*
			 * THE HOLD, OBSERVED ACROSS THE PLAIN POLL. The store's own suite pins
			 * this mechanism in isolation; here it is the assembled app: the
			 * sidebar's catalogue poll keeps running and carries NO `include_peers`,
			 * so the remote rows on screen survive by the HOLD the federated answer
			 * wrote - an unheld row is dropped by the next plain page, the exact
			 * mechanism #837 documents - and the ambient read comes back on its own
			 * ~30 s clock rather than once a window (the cadence this change's
			 * design rests on).
			 */
			const federatedReads = () =>
				wire().filter(
					(call) =>
						String(call.path ?? "").includes("include_peers=true") &&
						call.method === "GET",
				);
			const plainReads = () =>
				wire().filter(
					(call) =>
						String(call.path ?? "").startsWith("/v1/desktop/sessions?") &&
						!String(call.path).includes("include_peers") &&
						call.method === "GET",
				);
			const firstFederated = federatedReads().length;
			const plainsBefore = plainReads().length;
			const holdDeadline = Date.now() + 45_000;
			while (
				federatedReads().length <= firstFederated &&
				Date.now() < holdDeadline
			)
				await sleep(1_000);
			const reads = federatedReads();
			check(
				"after:the ambient read returns on its own clock",
				reads.length > firstFederated,
				`federated reads ${firstFederated} -> ${reads.length}`,
			);
			if (reads.length > 1)
				step("after:cadence", {
					firstAt: reads[0].at,
					secondAt: reads[1].at,
					intervalMs: reads[1].at - reads[0].at,
				});
			const plainsAfter = plainReads().length;
			check(
				"after:a plain poll ran between the federated reads",
				plainsAfter > plainsBefore,
				`plain reads ${plainsBefore} -> ${plainsAfter}`,
			);
			const held = await cdp.eval(SIDEBAR);
			const heldTitles = held.sections
				.flatMap((section) => section.rows.map((row) => row.title))
				.join("|");
			check(
				"after:remote rows survive the plain pages",
				REMOTE_TITLES.every((title) => heldTitles.includes(title)),
				`post-poll list ${heldTitles}`,
			);
		}

		await parkPointer(cdp);
		await sleep(300);
		await shutter(cdp, "sidebar");
		if (sidebar.region)
			await shutter(cdp, "sidebar-detail", {
				clip: {
					x: sidebar.region.x,
					y: Math.max(0, sidebar.region.y),
					width: sidebar.region.width,
					height: Math.min(WIN_H - Math.max(0, sidebar.region.y), 620),
				},
			});

		if (ARM === "after") {
			/*
			 * THE HOVER. The row's flyout is the app's one pointer channel
			 * (design D7 replaced the native `title`), and it must read the device
			 * AND the network.
			 */
			await hoverAt(cdp, "[data-chat-row]", REMOTE_TITLES[0]);
			let tips = [];
			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				tips = await cdp.eval(TOOLTIP);
				if (tips.some((t) => t.includes("cloud-node-1"))) break;
				await sleep(300);
			}
			const wanted = `on ${PEER_NAME} (${NETWORK_NAME})`;
			check(
				"after:hover sentence",
				tips.some((t) => t.includes(wanted)),
				`tooltips ${JSON.stringify(tips)} wanted "${wanted}"`,
			);
			await shutter(cdp, "hover");

			/*
			 * THE OPERATOR'S CASE, END TO END: opening the remote conversation from
			 * the sidebar's own row leaves the header chip reading `On <peer>` while
			 * the row it was opened from stays in its bin.
			 */
			await clickAt(cdp, "[data-chat-row]", REMOTE_TITLES[0]);
			await cdp.waitFor(`location.hash.includes("bbbbbbbbbb01")`, {
				label: "the remote conversation's route",
				timeout: 20_000,
			});
			await cdp.waitFor(
				`(() => { const c = document.querySelector("[data-device-chip]"); return c && c.textContent.includes(${JSON.stringify(PEER_NAME)}); })()`,
				{ label: "the device chip names the peer", timeout: 20_000 },
			);
			const chip = await cdp.eval(CHIP);
			check(
				"after:open chip",
				Boolean(chip?.label.includes(PEER_NAME)),
				`chip ${JSON.stringify(chip)}`,
			);
			const afterOpen = await cdp.eval(SIDEBAR);
			check(
				"after:open row still listed",
				afterOpen.sections
					.flatMap((s) => s.rows.map((r) => r.title))
					.includes(REMOTE_TITLES[0]),
				"the row the chip describes is still in its bin",
			);
			await parkPointer(cdp);
			await sleep(300);
			await shutter(cdp, "open");
		}

		/*
		 * THE WIRE, AND THE COUNTER-EVIDENCE.
		 *
		 * `include_peers` may arrive ONLY as the ambient read's own shape
		 * (`limit=200`); the sidebar's catalogue polls (`limit=500`, this
		 * daemon's unscoped read) must carry NO `include_peers`, on either arm -
		 * the constraint the fix is not allowed to break. The counts and the
		 * span are printed so a reader can see the poll really ran.
		 */
		const calls = wire();
		const sessionReads = calls.filter(
			(c) =>
				String(c.path ?? "").startsWith("/v1/desktop/sessions?") &&
				c.method === "GET",
		);
		const federated = sessionReads.filter((c) =>
			String(c.path).includes("include_peers=true"),
		);
		const plain = sessionReads.filter(
			(c) => !String(c.path).includes("include_peers"),
		);
		const foreign = federated.filter(
			(c) => !String(c.path).includes("limit=200"),
		);
		step("wire", {
			sessionReads: sessionReads.length,
			federated: federated.length,
			plain: plain.length,
			federatedWithForeignLimit: foreign.length,
			plainFirstAt: plain[0]?.at ?? null,
			plainLastAt: plain.at(-1)?.at ?? null,
		});
		check(
			ARM === "after" ? "wire:federated read ran" : "wire:no federated read",
			ARM === "after" ? federated.length >= 1 : federated.length === 0,
			`federated requests ${federated.length}`,
		);
		check(
			"wire:every federated read is the ambient 200-row one",
			foreign.length === 0,
			`federated rows with a foreign limit ${foreign.length}`,
		);
		check(
			"wire:the plain poll never carries include_peers",
			plain.length >= 2,
			`plain catalogue polls ${plain.length}; none carry include_peers by construction of this filter`,
		);
	} catch (error) {
		fail("scene", error);
		try {
			if (cdp)
				step(
					"diagnostics-on-failure",
					await cdp.eval(`(() => ({
						hash: location.hash,
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
		/* And the kernel-level sweep of anything the polite signal left behind. */
		for (const pid of [app.pid, endpoint.pid]) {
			try {
				process.kill(pid, 0);
				process.kill(pid, "SIGKILL");
			} catch {}
		}
		writeFileSync(
			join(OUT, ARM, "report.json"),
			JSON.stringify(report, null, 1),
		);
		writeFileSync(join(OUT, ARM, "app.log"), logs.join(""));
		console.log(
			`\n[report] arm=${ARM} steps=${report.steps.length} errors=${report.errors.length}`,
		);
		process.exit(report.errors.length ? 1 : 0);
	}
}

await main();
