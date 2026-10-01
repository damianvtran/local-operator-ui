#!/usr/bin/env node
/**
 * The create-success drive: pick a peer in a new chat, send, and read the chip.
 *
 * WHAT THIS EXISTS FOR. The operator's report (2026-09-30): "He selected the
 * remote device in the new-chat window. Sent a test probe ('what OS are you on')
 * expecting the node's OS. On hitting enter, the device selection reverted to
 * local." The defect is a VALUE the unit suite can hold (`panePlacement` falling
 * through to `{kind:"local"}` once the draft stops existing) but the claim the
 * report makes is about the app: the chip must keep saying `On <device>` after
 * the send, and a second send must not move it back.
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
 * THE ENDPOINT IS THIS SET'S OWN (`server.mjs`), disclosed in the README: the two
 * mesh reads, the catalogue, the create, the message and a minimal session
 * stream are fixtures in the wire's own shape, because the installed daemon
 * predates the `peer` admission on `sessions.create` and would refuse the path
 * before anything could be measured. Everything else - the transport, the store,
 * the chip, the create flow - is the shipped code.
 *
 * THE TWO ARMS. `--expect-chip` is REQUIRED, because this rig runs twice: once
 * on the base tree, where the chip is expected to read `On this device` after
 * the send (the defect, reproduced), and once on the fixed tree, where it must
 * read `On cloud-node-1`. Each run states its own expectation and asserts it;
 * the pair of readings is what the set's README tables.
 *
 * AND THE ALIGNMENT HALF, from the same rig: `--expect-aligned` asserts that the
 * chip's TEXT baseline sits on the identity pair's (each read from its label's
 * own font, because the two families' line boxes differ inside the same 20px
 * control while the eye reads baselines), and `--experiments` - run on the base
 * arm only - applies, measures and reverts the live DOM probes the fix's
 * carrier span was chosen from; the table lives in `chat-header-device.tsx`'s
 * carrier comment.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * The frame decoder, from its one home in this tree (the sweep's own): a scan
 * of the committed pixels is a READING, and it must decode the same bytes a
 * reviewer's tool would.
 */
import sharp from "sharp";
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
	? join(process.env.LOCAL_OPERATOR_SCRATCHPAD, "chat-device-persist")
	: join(RIG, "run");
const BACKEND_PORT = 24323;

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? fallback : argv[at + 1];
};
const ARM = flag("arm", "run");
const EXPECT_CHIP = flag("expect-chip", "");
const EXPECT_ALIGNED = argv.includes("--expect-aligned");
const EXPERIMENTS = argv.includes("--experiments");
/*
 * ROUND 2's OWN FLAGS.
 *
 * `--peer-name` is the fixture device's label for this run (the server reads
 * it too): the narrow variant photographs the truncating chip, so the name it
 * truncates must be long enough to do so.
 *
 * `--expect-ring` reads the focus ring's FOUR edges out of the captured
 * pixels: `closed` (the fixed state) or `open-bottom` (the defect the design
 * round measured - top and side strokes present, the bottom stroke cut away
 * by the title line's clip). Each arm asserts its own reading, so the pair
 * cannot pass by both being loose.
 *
 * `--expect-below-clip` reads the fill/ring ink that must (or must not) paint
 * BELOW the title line's old clip edge: `inked` on the fixed tree, `none` on
 * the review head - the two numeric halves of design D1.
 *
 * `--expect-recall-dismissed` is the F1 chain's own reading: after the recall
 * settles and its arrival notice is dismissed, what the chip says. The review
 * head reads `On <peer>` (the stale mark resurrected); the fixed tree reads
 * `On this device`.
 *
 * `--short` stops after `after-send` (the light and narrow variants), and
 * `--palette` wears one named palette for the whole run.
 */
const PEER_NAME = flag("peer-name", "cloud-node-1");
const EXPECT_RING = flag("expect-ring", "");
const EXPECT_BELOW_CLIP = flag("expect-below-clip", "");
const EXPECT_RECALL_DISMISSED = flag("expect-recall-dismissed", "");
const EXPECT_LOCAL = flag("expect-local", "On this device");
const PALETTE = flag("palette", "");
const SHORT = argv.includes("--short");
const [WIN_W, WIN_H] = flag("window-size", "1380x900").split("x").map(Number);
if (!EXPECT_CHIP) {
	console.error(
		"--expect-chip <substring> is required: each arm states what it expects the chip to read",
	);
	process.exit(2);
}

const RUN = join(OUT, ARM, "run");
const WIRE = join(OUT, ARM, "wire.jsonl");
const FRAMES = join(OUT, ARM);
const HOLD = join(RUN, "hold-transfer");

const report = {
	arm: ARM,
	expectChip: EXPECT_CHIP,
	steps: [],
	errors: [],
	console: [],
};
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

/** A real Enter, in the composer's own handler's spelling. */
async function pressEnter(cdp) {
	for (const [type, text] of [
		["keyDown", "\r"],
		["keyUp", undefined],
	]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			...(text === undefined ? {} : { text, unmodifiedText: text }),
		});
	}
}

/** The app-wide `⌘N` (CDP's Meta bit; the renderer-driver's own chord). */
async function pressNewChat(cdp) {
	for (const [type, text] of [
		["keyDown", undefined],
		["keyUp", undefined],
	]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "n",
			code: "KeyN",
			modifiers: 4,
			windowsVirtualKeyCode: 78,
			nativeVirtualKeyCode: 78,
			...(text === undefined ? {} : { text }),
		});
	}
}

/* -------------------------------------------------------------- readings --- */

/** The chip, as a reader and a screen reader get it. */
const CHIP = `(() => {
	const chip = document.querySelector("[data-device-chip]");
	return chip ? { label: (chip.textContent || "").trim(), aria: chip.getAttribute("aria-label") || "" } : null;
})()`;

/**
 * The header row's own geometry, for the alignment claim: the device chip and
 * the two identity chips, each with its box and its label ink's box.
 *
 * `label` is the chip's own text span (`span.truncate`); the ink box is what
 * "baseline" is measurable from without painting knowledge - two chips whose
 * label boxes agree on top AND bottom are on one line.
 */
const HEADER = `(() => {
	/*
	 * The text BASELINE, from the same font the box renders in: a range/canvas
	 * measure gives the font's own ascent, so label.top + ascent is where the
	 * text sits. The row stands its items on one baseline, and the two chip
	 * families have different line boxes in the same 20px control (mono vs
	 * sans), so this - not the box top - is what the eye reads as "one line".
	 */
	const baselineOf = (label) => {
		if (!label) return null;
		const r = label.getBoundingClientRect();
		const ctx = document.createElement("canvas").getContext("2d");
		ctx.font = getComputedStyle(label).font;
		const m = ctx.measureText("x");
		return Math.round((r.top + m.fontBoundingBoxAscent) * 100) / 100;
	};
	const read = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const label = el.querySelector("span.truncate") ?? (el.childElementCount === 0 ? el : null);
		const lr = label ? label.getBoundingClientRect() : null;
		return {
			x: Math.round(r.x * 100) / 100,
			y: Math.round(r.y * 100) / 100,
			w: Math.round(r.width * 100) / 100,
			h: Math.round(r.height * 100) / 100,
			bottom: Math.round(r.bottom * 100) / 100,
			label: lr ? { top: Math.round(lr.y * 100) / 100, bottom: Math.round(lr.bottom * 100) / 100 } : null,
			baseline: baselineOf(label),
			text: (el.textContent || "").trim().slice(0, 60),
		};
	};
	return {
		chip: read(document.querySelector("[data-device-chip]")),
		agent: read(document.querySelector('[data-header-identity="agent"]')),
		team: read(document.querySelector('[data-header-identity="team"]')),
		title: read(document.querySelector("[data-header-title]")),
	};
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

/** The theme the document is wearing, for the frame's own name and palette. */
const themeOf = (cdp) =>
	cdp.eval(`document.documentElement.dataset.theme || "localOperatorDark"`);

/** A real Escape, the picker popover's own way out. */
async function pressEscape(cdp) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
}

/**
 * The chip's box, the title line's clip box and the painted ring/fill colours,
 * read live - the frame scan below compares pixels to these numbers, so a
 * re-titled row or a re-toned ring fails loudly instead of scanning nothing.
 * `fill` is the colour `:hover` is painting INTO the chip at the moment of the
 * read (the drive moves the real pointer first), and `rowClip` carries
 * `overflow-clip-margin` so the review head's absence of it is on the record.
 */
const CLIPINFO = `(() => {
	const chip = document.querySelector("[data-device-chip]");
	const rect = (el) => {
		if (!el) return null;
		const b = el.getBoundingClientRect();
		return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
	};
	/*
	 * THE CLIPPING ANCESTOR, walked to rather than guessed: the first ancestor
	 * whose computed overflow is not 'visible' is the box whose edge cut the
	 * ring before this round's fix (the title line, 'overflow-clip').
	 */
	const clipOf = (el) => {
		let cur = el ? el.parentElement : null;
		while (cur && cur !== document.body) {
			if (getComputedStyle(cur).overflow !== "visible") return cur;
			cur = cur.parentElement;
		}
		return null;
	};
	const rgb = (s) => {
		const m = /rgba?\\(([^)]+)\\)/.exec(s || "");
		if (!m) return null;
		const p = m[1].split(",").map(Number);
		return { r: p[0], g: p[1], b: p[2] };
	};
	const cs = chip ? getComputedStyle(chip) : null;
	const clipRow = clipOf(chip);
	const rcs = clipRow ? getComputedStyle(clipRow) : null;
	return {
		chip: rect(chip),
		clipRow: clipRow
			? {
					rect: rect(clipRow),
					overflow: rcs.overflow,
					clipMargin: rcs.overflowClipMargin || "",
				}
			: null,
		outline: cs ? { color: rgb(cs.outlineColor), width: cs.outlineWidth, offset: cs.outlineOffset } : null,
		fill: cs ? rgb(cs.backgroundColor) : null,
	};
})()`;

/**
 * WHAT THE CAPTURED PIXELS SAY about the defect and its fix (design D1).
 *
 * Decodes one frame and counts, inside the chip's own box:
 * `edges.{top,left,right}` - accent-coloured pixels in the inset ring's three
 * bands that were never in question; `edges.bottom` - the same band at the
 * box's bottom, which the review head's clip cuts away; and `belowClip.newInk`
 * - pixels BELOW the title line's own bottom edge (the old clip line) that are
 * not the page background, i.e. the fill and ring the fix restored: on the
 * review head nothing paints there, on the fixed tree the chip's last two
 * pixels do. The background is sampled beside the chip in the same rows, so
 * the reading is invariant to the palette.
 */
async function scanChipEdges(file, info) {
	const { data, info: meta } = await sharp(file)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const at = (x, y) => {
		const i = (y * meta.width + x) * meta.channels;
		return { r: data[i], g: data[i + 1], b: data[i + 2] };
	};
	const near = (px, c, tol) =>
		!c ||
		Math.abs(px.r - c.r) + Math.abs(px.g - c.g) + Math.abs(px.b - c.b) <= tol;
	const count = (box, pred) => {
		let n = 0;
		for (
			let y = Math.max(0, Math.floor(box.y0));
			y < Math.min(meta.height, Math.ceil(box.y1));
			y++
		)
			for (
				let x = Math.max(0, Math.floor(box.x0));
				x < Math.min(meta.width, Math.ceil(box.x1));
				x++
			)
				if (pred(at(x, y))) n++;
		return n;
	};
	const c = info.chip;
	if (!c) return null;
	const accent = info.outline?.color ?? null;
	const bg = at(
		Math.max(0, Math.floor(c.x) - 20),
		Math.min(meta.height - 1, Math.floor(c.bottom - 1)),
	);
	return {
		edges: {
			top: count(
				{ x0: c.x + 4, x1: c.right - 4, y0: c.y + 0.5, y1: c.y + 2.6 },
				(p) => near(p, accent, 170),
			),
			left: count(
				{ x0: c.x + 0.5, x1: c.x + 2.6, y0: c.y + 4, y1: c.bottom - 4 },
				(p) => near(p, accent, 170),
			),
			right: count(
				{
					x0: c.right - 2.6,
					x1: c.right - 0.5,
					y0: c.y + 4,
					y1: c.bottom - 4,
				},
				(p) => near(p, accent, 170),
			),
			bottom: count(
				{
					x0: c.x + 4,
					x1: c.right - 4,
					y0: c.bottom - 1.5,
					y1: c.bottom - 0.4,
				},
				(p) => near(p, accent, 170),
			),
		},
		belowClip: {
			/*
			 * THE CHIP'S OWN LAST TWO PIXELS - the band the clip cut before the fix
			 * (the clip line sits exactly 2.2px above the chip's bottom, which is the
			 * alignment fix's own delta; the box, not the mis-detectable row, defines
			 * the band). `newInk` counts pixels there that are not the page
			 * background: the restored ring stroke and fill on the fixed tree, zero
			 * on the review head.
			 */
			newInk: count(
				{
					x0: c.x + 4,
					x1: c.right - 4,
					y0: c.bottom - 2.2,
					y1: c.bottom - 0.2,
				},
				(p) => !near(p, bg, 30),
			),
			bg,
		},
		fillReachesBottom: count(
			{ x0: c.x + 6, x1: c.right - 6, y0: c.bottom - 1.5, y1: c.bottom - 0.4 },
			/*
			 * "NOT THE PAGE BACKGROUND", not "matches the fill token": the hover
			 * wash may carry alpha, and the painted pixels would then never equal the
			 * computed rgba - what the band must show is the chip's own ink rather
			 * than the page, which is exactly what this samples beside the chip.
			 */
			(p) => !near(p, bg, 30),
		),
	};
}

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

/**
 * The settled chip: two equal readings in a row AND at least one admitted
 * message on the wire, so the reading is of the state the send produced rather
 * than of a frame in between.
 */
async function settleChip(cdp, { messagesAtLeast, timeout = 20_000 }) {
	const deadline = Date.now() + timeout;
	let last = null;
	let stable = 0;
	while (Date.now() < deadline) {
		const sent = wire().filter((call) =>
			/\/v1\/desktop\/sessions\/[^/]+\/messages$/.test(call.path ?? ""),
		).length;
		const chip = await cdp.eval(CHIP);
		const label = chip?.label ?? null;
		if (sent >= messagesAtLeast && label !== null && label === last)
			stable += 1;
		else stable = 0;
		last = label;
		if (stable >= 2) return chip;
		await sleep(450);
	}
	return cdp.eval(CHIP);
}

/* ------------------------------------------------------------------ main --- */

async function main() {
	/*
	 * A FRESH ARM DIRECTORY EVERY TIME (the boot state, the wire and the report).
	 * The first draft of this rig reused it across runs, and the app restored the
	 * PREVIOUS run's persisted session and state from the same user-data and
	 * config roots - so the second run booted into a live conversation on
	 * `f47ac10b58cc` (a pick then opened the move dialog) instead of the
	 * new-chat state this scene is about. `FRAMES` IS NOT WIPED since round 2:
	 * the light and narrow runs of the fixed tree write ADDITIONAL frames into
	 * the same shape (`<state>/<theme>.webp`), and a wipe would take the dark
	 * run's frames with it.
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
			RIG_HOLD_FILE: HOLD,
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
	mkdirSync(join(OUT, ARM), { recursive: true });
	// main's transport reads `.env` from process.cwd() with dotenv override.
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
		/*
		 * The manager stays disabled for the sibling rig's own measured reason: a
		 * run whose endpoint failed to start must not have the app's Backend
		 * Service Manager spawn a real backend from the operator's install.
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
		 * THE RUN'S PALETTE, when one was asked for (design D4: the light variant).
		 * Written the way the app's own theme switch writes it - `data-theme` on the
		 * document root, the attribute every rule in `themes.generated.css` keys on -
		 * and VERIFIED by the painted canvas variable below and, at capture time, by
		 * the repository's own frame predicate, which fails a frame whose dominant
		 * colours are not the palette its filename claims.
		 */
		if (PALETTE) {
			await cdp.eval(
				`document.documentElement.dataset.theme = ${JSON.stringify(PALETTE)}`,
			);
			await cdp.waitFor(
				`document.documentElement.dataset.theme === ${JSON.stringify(PALETTE)}`,
				{ label: "the palette attribute", timeout: 10_000 },
			);
			await sleep(600);
			step("palette", {
				theme: await themeOf(cdp),
				canvas: await cdp.eval(
					`getComputedStyle(document.documentElement).getPropertyValue("--lo-canvas").trim()`,
				),
			});
		}
		await sleep(1200);

		/*
		 * THE NEW CHAT, the operator's own starting point. A fresh window seeds a
		 * draft (`launchDraftSeed`); if the route did not land there, `⌘N` is the
		 * app's own way in (the press `--scene new-chat` proves).
		 */
		const hasChip = await cdp.eval(
			`Boolean(document.querySelector("[data-device-chip]"))`,
		);
		if (!hasChip) {
			await pressNewChat(cdp);
			await cdp
				.waitFor(`document.querySelector("[data-device-chip]")`, {
					label: "the device chip after ⌘N",
					timeout: 60_000,
				})
				.catch(() => {});
		}
		await cdp.waitFor(`document.querySelector("[data-device-chip]")`, {
			label: "the device chip",
			timeout: 60_000,
		});
		await sleep(1000);
		report.steps.push({
			name: "diagnostics",
			hash: await cdp.eval("location.hash"),
			body: await cdp.eval("(document.body.innerText || '').slice(0, 800)"),
		});

		/* -- the draft, before any pick: `New on this device` ------------------- */
		step("chip:draft-local", await cdp.eval(CHIP));

		/* -- the pick: the chip, the picker, the peer's row --------------------- */
		await clickAt(cdp, "[data-device-chip]");
		await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
			label: "the picker",
			timeout: 30_000,
		});
		await sleep(500);
		step(
			"picker",
			await cdp.eval(`(() => {
				const panel = document.querySelector("[data-device-picker]");
				return [...panel.querySelectorAll("[data-device-row]")].map((row) => ({
					state: row.getAttribute("data-device-row"),
					text: (row.textContent || "").trim().slice(0, 120),
				}));
			})()`),
		);
		const row = await clickAt(
			cdp,
			'[data-device-row="candidate"]',
			"cloud-node-1",
		);
		step("pressed-row", { text: row.text });
		await cdp.waitFor(
			`(document.querySelector("[data-device-chip]")?.textContent || "").includes("cloud-node-1")`,
			{ label: "the chip naming the picked peer", timeout: 30_000 },
		);
		await sleep(700);
		step("chip:draft-peer", await cdp.eval(CHIP));
		step("geometry:draft-peer", await cdp.eval(HEADER));
		/*
		 * THE RING IS THE POINT OF THIS STATE (design review round 2, D1). The pick
		 * leaves focus back on the chip, so the capture below is a FOCUSED control -
		 * asserted, not assumed, and focused by the DOM if the pick left it elsewhere
		 * (disclosed in the README when that happens: the ring's presence is the
		 * claim, not how focus arrived).
		 */
		const focused = await cdp.eval(
			`document.activeElement === document.querySelector("[data-device-chip]")`,
		);
		if (!focused) {
			await cdp.eval(`document.querySelector("[data-device-chip]").focus()`);
			await sleep(200);
		}
		step("focus:draft-peer", {
			focusedByPick: focused,
			focusedNow: await cdp.eval(
				`document.activeElement === document.querySelector("[data-device-chip]")`,
			),
		});
		const clipInfo = await cdp.eval(CLIPINFO);
		step("clip:draft-peer", clipInfo);
		const draftPeerFrame = await shutter(cdp, "draft-peer");
		const ring = await scanChipEdges(draftPeerFrame, clipInfo);
		report.ring = ring;
		step("ring:draft-peer", ring);
		if (EXPECT_RING === "closed") {
			check(
				"the focus ring's four edges are painted",
				ring.edges.top >= 40 &&
					ring.edges.left >= 12 &&
					ring.edges.right >= 12 &&
					ring.edges.bottom >= 80,
				JSON.stringify(ring.edges),
			);
		}
		if (EXPECT_RING === "open-bottom") {
			check(
				"the focus ring's bottom edge is cut away (the defect, reproduced)",
				ring.edges.top >= 40 &&
					ring.edges.left >= 12 &&
					ring.edges.right >= 12 &&
					ring.edges.bottom <= 20,
				JSON.stringify(ring.edges),
			);
		}
		if (EXPECT_BELOW_CLIP === "inked") {
			check(
				"the chip's fill and ring paint below the old clip line",
				ring.belowClip.newInk >= 100,
				JSON.stringify(ring.belowClip),
			);
		}
		if (EXPECT_BELOW_CLIP === "none") {
			check(
				"nothing paints below the old clip line (the defect's own reading)",
				ring.belowClip.newInk <= 40,
				JSON.stringify(ring.belowClip),
			);
		}
		/*
		 * THE HOVER FILL, same box, real pointer: `:hover` engaged with a moved
		 * mouse (never a click - a click would open the picker and change the
		 * state under the shutter). The fill colour the frame scan compares to is
		 * read live while the pointer is on the control.
		 */
		{
			const box = await cdp.eval(`(() => {
				const el = document.querySelector("[data-device-chip]");
				const r = el.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			})()`);
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: box.x,
				y: box.y,
				button: "none",
				buttons: 0,
			});
			await sleep(350);
		}
		const hoverInfo = await cdp.eval(CLIPINFO);
		step("clip:draft-peer-hover", {
			fill: hoverInfo.fill,
			clipMargin: hoverInfo.clipRow?.clipMargin ?? null,
		});
		const hoverFrame = await shutter(cdp, "draft-peer-hover");
		const hoverScan = await scanChipEdges(hoverFrame, hoverInfo);
		report.hover = hoverScan;
		step("ring:draft-peer-hover", hoverScan);
		if (EXPECT_BELOW_CLIP === "inked") {
			check(
				"the hover fill reaches the chip's own bottom edge",
				hoverScan.fillReachesBottom >= 50,
				JSON.stringify({ fillReachesBottom: hoverScan.fillReachesBottom }),
			);
		}
		if (EXPECT_BELOW_CLIP === "none") {
			check(
				"the hover fill is cut before the chip's own bottom edge (the defect)",
				hoverScan.fillReachesBottom <= 20,
				JSON.stringify({ fillReachesBottom: hoverScan.fillReachesBottom }),
			);
		}

		/* -- the send: the operator's own probe --------------------------------- */
		await clickAt(cdp, '[data-tour-tag="chat-input-textarea"] textarea');
		await cdp.send("Input.insertText", { text: "what OS are you on" });
		await sleep(400);
		await pressEnter(cdp);
		// The create can take a beat; wait for it on the wire before settling.
		{
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
				const created = wire().some(
					(call) =>
						call.path === "/v1/desktop/sessions" && call.method === "POST",
				);
				if (created) break;
				await sleep(300);
			}
		}
		const chipAfterSend = await settleChip(cdp, { messagesAtLeast: 1 });
		report.chips = report.chips ?? {};
		report.chips["after-send"] = chipAfterSend;
		step("chip:after-send", chipAfterSend);
		step("geometry:after-send", await cdp.eval(HEADER));
		await shutter(cdp, "after-send");
		check(
			`after-send chip reads "${EXPECT_CHIP}"`,
			Boolean(chipAfterSend?.label?.includes(EXPECT_CHIP)),
			`label: ${JSON.stringify(chipAfterSend?.label)} aria: ${JSON.stringify(chipAfterSend?.aria)}`,
		);

		/* -- the second send: the acceptance's "does not revert" ---------------- */
		await clickAt(cdp, '[data-tour-tag="chat-input-textarea"] textarea');
		await cdp.send("Input.insertText", { text: "and the disk free?" });
		await sleep(400);
		await pressEnter(cdp);
		{
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
				const sent = wire().filter((call) =>
					/\/v1\/desktop\/sessions\/[^/]+\/messages$/.test(call.path ?? ""),
				).length;
				if (sent >= 2) break;
				await sleep(300);
			}
		}
		const chipSecond = await settleChip(cdp, { messagesAtLeast: 2 });
		report.chips["second-send"] = chipSecond;
		step("chip:second-send", chipSecond);
		const geometrySecond = await cdp.eval(HEADER);
		step("geometry:second-send", geometrySecond);
		await shutter(cdp, "second-send");
		check(
			`second-send chip reads "${EXPECT_CHIP}"`,
			Boolean(chipSecond?.label?.includes(EXPECT_CHIP)),
			`label: ${JSON.stringify(chipSecond?.label)}`,
		);

		/*
		 * THE ALIGNMENT CLAIM's own frame and reading: the header row, cropped to
		 * the band the chips live in, plus the geometry the README tables. The
		 * chips' own boxes are the reading; the crop is the picture.
		 */
		const band = await cdp.eval(`(() => {
			const el = document.querySelector('[data-tour-tag="chat-header"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.max(0, r.x), y: Math.max(0, r.y - 4), width: r.width, height: r.height + 8 };
		})()`);
		if (band) await shutter(cdp, "header-row", { clip: band });
		step("geometry:header-row", { clip: band, reading: geometrySecond });

		/* The alignment assertion, only where the fix is expected to hold. */
		if (EXPECT_ALIGNED) {
			const chip = geometrySecond.chip;
			for (const kind of ["agent", "team"]) {
				const other = geometrySecond[kind];
				/*
				 * THE BASELINE IS THE CLAIM: the row stands its items on one text
				 * baseline, and the two chip families have different line boxes inside
				 * the same 20px control (mono vs sans), so equal BOX TOPS would put the
				 * two texts on different lines. What the eye reads is where the text
				 * sits, so that is what this checks - with the box delta printed beside
				 * it as the reading it is.
				 */
				const baselineDelta =
					chip?.baseline != null && other?.baseline != null
						? Math.round((chip.baseline - other.baseline) * 100) / 100
						: null;
				check(
					`header chip's text baseline is flush with the ${kind} chip's`,
					baselineDelta !== null && Math.abs(baselineDelta) <= 1,
					`baseline delta ${baselineDelta} (chip ${chip?.baseline}, ${kind} ${other?.baseline})`,
				);
				const boxDelta =
					chip && other ? Math.round((chip.y - other.y) * 100) / 100 : null;
				step(`box-delta:${kind}`, {
					boxTop: boxDelta,
					note: "the box delta the two families' font metrics leave; the baseline above is the claim",
				});
			}
		}

		/*
		 * THE F1 CHAIN, driven end to end (agent review round 1): the conversation
		 * created on the peer is RECALLED home - the picker's own "this device" row
		 * through the confirmation - the transfer is HELD so the in-flight state is
		 * photographable, released so the receipt lands, and then the arrival notice
		 * is DISMISSED, which is the step that used to leave the chip claiming the
		 * peer over a conversation already home. `--expect-recall-dismissed` is the
		 * reading each arm asserts (review head: `On <peer>`, the defect this round
		 * fixes; fixed tree: `On this device`).
		 */
		if (!SHORT) {
			await clickAt(cdp, "[data-device-chip]");
			await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
				label: "the picker on a live remote conversation",
				timeout: 30_000,
			});
			await sleep(500);
			step(
				"picker-recall",
				await cdp.eval(`(() => {
					const panel = document.querySelector("[data-device-picker]");
					return [...panel.querySelectorAll("[data-device-row]")].map((row) => ({
						state: row.getAttribute("data-device-row"),
						text: (row.textContent || "").trim().slice(0, 120),
					}));
				})()`),
			);
			const recallRow = await clickAt(cdp, "[data-device-row]", "this device");
			step("pressed-recall-row", { text: recallRow.text });
			await cdp.waitFor(
				`[...document.querySelectorAll('[role="dialog"] button')].some((b) => /Recall/.test(b.textContent || ""))`,
				{ label: "the confirmation's recall verb", timeout: 15_000 },
			);
			await clickAt(cdp, '[role="dialog"] button', "Recall");
			{
				const deadline = Date.now() + 30_000;
				while (Date.now() < deadline) {
					if (wire().some((call) => /\/transfer$/.test(call.path ?? ""))) break;
					await sleep(200);
				}
			}
			await cdp.waitFor(
				`document.querySelector("[data-device-chip]").getAttribute("aria-busy") === "true"`,
				{ label: "the chip in flight", timeout: 15_000 },
			);
			await sleep(500);
			step("chip:recall-moving", await cdp.eval(CHIP));
			await shutter(cdp, "recall-moving");
			/* The hold releases HERE: the endpoint's answer waits for this file. */
			writeFileSync(HOLD, "release\n");
			await cdp.waitFor(
				`(() => {
					const chip = document.querySelector("[data-device-chip]");
					return chip && (chip.textContent || "").includes("On this device");
				})()`,
				{ label: "the receipt's landing", timeout: 30_000 },
			);
			await sleep(800);
			step("chip:recall-settled", await cdp.eval(CHIP));
			await shutter(cdp, "recall-settled");
			await clickAt(cdp, "button", "Dismiss");
			await sleep(900);
			const dismissed = await cdp.eval(CHIP);
			report.chips["recall-dismissed"] = dismissed;
			step("chip:recall-dismissed", dismissed);
			await shutter(cdp, "recall-dismissed");
			if (EXPECT_RECALL_DISMISSED) {
				check(
					`recall-dismissed chip reads "${EXPECT_RECALL_DISMISSED}"`,
					Boolean(dismissed?.label?.includes(EXPECT_RECALL_DISMISSED)),
					`label: ${JSON.stringify(dismissed?.label)}`,
				);
			}
			/*
			 * THE PICKER'S OWN RE-READ, for the record: where it now says the
			 * conversation lives (the review's second claim about the same chain).
			 */
			await clickAt(cdp, "[data-device-chip]");
			await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
				label: "the picker after the recall",
				timeout: 15_000,
			});
			await sleep(400);
			step(
				"picker-after-recall",
				await cdp.eval(`(() => {
					const panel = document.querySelector("[data-device-picker]");
					return [...panel.querySelectorAll("[data-device-row]")].map((row) => ({
						state: row.getAttribute("data-device-row"),
						text: (row.textContent || "").trim().slice(0, 120),
					}));
				})()`),
			);
			await pressEscape(cdp);
			await sleep(400);

			/*
			 * THE PLAIN LOCAL LIVE CHAT (design D3): a second conversation, created
			 * here with no pick at all - the state most users see, and the one whose
			 * carrier geometry the fix also moves. The stub mints unique ids (QA
			 * N1), so this row cannot collide with the recalled one.
			 */
			await pressNewChat(cdp);
			await cdp.waitFor(`document.querySelector("[data-device-chip]")`, {
				label: "the chip on the second chat",
				timeout: 30_000,
			});
			await sleep(800);
			await clickAt(cdp, '[data-tour-tag="chat-input-textarea"] textarea');
			await cdp.send("Input.insertText", { text: "a local probe" });
			await sleep(400);
			await pressEnter(cdp);
			{
				const deadline = Date.now() + 30_000;
				while (Date.now() < deadline) {
					const creates = wire().filter(
						(call) =>
							call.path === "/v1/desktop/sessions" && call.method === "POST",
					).length;
					if (creates >= 2) break;
					await sleep(300);
				}
			}
			const localChip = await settleChip(cdp, { messagesAtLeast: 3 });
			report.chips["local-live"] = localChip;
			step("chip:local-live", localChip);
			await shutter(cdp, "local-live");
			check(
				`local-live chip reads "${EXPECT_LOCAL}"`,
				Boolean(localChip?.label?.includes(EXPECT_LOCAL)),
				`label: ${JSON.stringify(localChip?.label)}`,
			);
		}

		/* AND THE WINDOW IS NEVER SHOWN, which is the claim the mode exists for. */
		step("window", {
			...(await cdp.eval(
				`({ focused: document.hasFocus(), painted: document.querySelectorAll("*").length > 0 })`,
			)),
			/*
			 * THE WINDOW'S OWN STATE, from the mode's log line rather than from the
			 * page's `hasFocus()`: a headless window that has received CDP input can
			 * have the document flagged active while the OS WINDOW stays unshown and
			 * unfocused, and the claim this set lives under is about the window. Both
			 * readings are printed; the mode's line is the one the disclosure cites.
			 */
			modeLine:
				/visible=\S+ focused=\S+[^\n]*/.exec(logs.join(""))?.[0] ?? null,
		});

		/*
		 * THE MECHANISM PROBES, live: why the chip sits where it sits. Run with
		 * `--experiments`, and only ever on the arm whose geometry is the QUESTION
		 * (the base tree): each mutation is applied to the real running app, measured
		 * by the same HEADER reader, and reverted before the next, so the candidate
		 * FIX is chosen from evidence rather than from a theory about flex baselines.
		 */
		if (EXPERIMENTS) {
			step(
				"style-facts",
				await cdp.eval(`(() => {
					const chip = document.querySelector("[data-device-chip]");
					const agent = document.querySelector('[data-header-identity="agent"]');
					const wrap = document.querySelector("[data-header-identity-controls]");
					const row = wrap ? wrap.parentElement : chip ? chip.parentElement : null;
					const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
					return {
						row: row
							? { tag: row.tagName, cls: String(row.className).slice(0, 140), alignItems: cs(row, "alignItems"), height: row.getBoundingClientRect().height }
							: null,
						chip: chip
							? { first: chip.firstElementChild?.tagName, alignSelf: cs(chip, "alignSelf"), alignItems: cs(chip, "alignItems"), display: cs(chip, "display") }
							: null,
						wrap: wrap
							? { display: cs(wrap, "display"), alignSelf: cs(wrap, "alignSelf"), height: wrap.getBoundingClientRect().height }
							: null,
						agent: agent ? { alignSelf: cs(agent, "alignSelf"), display: cs(agent, "display") } : null,
					};
				})()`),
			);
			const experiment = async (label, mutate, revert) => {
				await cdp.eval(mutate);
				await sleep(450);
				const reading = await cdp.eval(HEADER);
				step(`experiment:${label}`, {
					chipY: reading.chip?.y ?? null,
					agentY: reading.agent?.y ?? null,
					chipBaseline: reading.chip?.baseline ?? null,
					agentBaseline: reading.agent?.baseline ?? null,
					baselineDelta:
						reading.chip?.baseline != null && reading.agent?.baseline != null
							? Math.round(
									(reading.chip.baseline - reading.agent.baseline) * 100,
								) / 100
							: null,
				});
				await cdp.eval(revert);
				await sleep(250);
			};
			await experiment(
				"chip-align-self-center",
				`document.querySelector("[data-device-chip]").style.alignSelf = "center"`,
				`document.querySelector("[data-device-chip]").style.alignSelf = ""`,
			);
			await experiment(
				"agent-align-self-center",
				`document.querySelector('[data-header-identity="agent"]').style.alignSelf = "center"`,
				`document.querySelector('[data-header-identity="agent"]').style.alignSelf = ""`,
			);
			await experiment(
				"chip-zwsp-first-child",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const t = document.createTextNode("\u200b");
					c.insertBefore(t, c.firstChild);
					return true;
				})()`,
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					if (c.firstChild && c.firstChild.nodeType === 3) c.removeChild(c.firstChild);
					return true;
				})()`,
			);
			await experiment(
				"chip-nbsp-inline-block-shim",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const s = document.createElement("span");
					s.setAttribute("data-rig-shim", "");
					s.style.display = "inline-block";
					s.style.width = "0";
					s.textContent = "\u00a0";
					c.insertBefore(s, c.firstChild);
					return true;
				})()`,
				`(() => {
					const s = document.querySelector("[data-rig-shim]");
					if (s) s.remove();
					return true;
				})()`,
			);
			await experiment(
				"chip-span-zwsp",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const s = document.createElement("span");
					s.setAttribute("data-rig-shim", "");
					s.textContent = "\u200b";
					c.insertBefore(s, c.firstChild);
					return true;
				})()`,
				`(() => {
					const s = document.querySelector("[data-rig-shim]");
					if (s) s.remove();
					return true;
				})()`,
			);
			await experiment(
				"chip-span-zwsp-mono-font",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const a = document.querySelector('[data-header-identity="agent"] span.truncate') ?? document.querySelector('[data-header-identity="agent"]');
					const s = document.createElement("span");
					s.setAttribute("data-rig-shim", "");
					s.style.font = getComputedStyle(a).font;
					s.textContent = "\u200b";
					c.insertBefore(s, c.firstChild);
					return true;
				})()`,
				`(() => {
					const s = document.querySelector("[data-rig-shim]");
					if (s) s.remove();
					return true;
				})()`,
			);
			await experiment(
				"chip-shim-height-14",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const s = document.createElement("span");
					s.setAttribute("data-rig-shim", "");
					s.style.display = "inline-block";
					s.style.width = "0";
					s.style.height = "14px";
					c.insertBefore(s, c.firstChild);
					return true;
				})()`,
				`(() => {
					const s = document.querySelector("[data-rig-shim]");
					if (s) s.remove();
					return true;
				})()`,
			);
			await experiment(
				"chip-shim-height-13",
				`(() => {
					const c = document.querySelector("[data-device-chip]");
					const s = document.createElement("span");
					s.setAttribute("data-rig-shim", "");
					s.style.display = "inline-block";
					s.style.width = "0";
					s.style.height = "13px";
					c.insertBefore(s, c.firstChild);
					return true;
				})()`,
				`(() => {
					const s = document.querySelector("[data-rig-shim]");
					if (s) s.remove();
					return true;
				})()`,
			);
			step("style-facts-after", { note: "all mutations reverted" });
		}

		const creates = wire().filter(
			(call) => call.path === "/v1/desktop/sessions" && call.method === "POST",
		);
		const transfer = wire().find((call) => /\/transfer$/.test(call.path ?? ""));
		step("wire", {
			creates: creates.length,
			createPeer: creates[0]?.body?.peer ?? null,
			localCreatePeer: creates[1]?.body?.peer ?? null,
			transfer: transfer
				? { to: transfer.body?.to ?? null, keep: transfer.body?.keep ?? null }
				: null,
			messages: wire().filter((call) =>
				/\/v1\/desktop\/sessions\/[^/]+\/messages$/.test(call.path ?? ""),
			).length,
			watches: wire().filter((call) => /\/watch$/.test(call.path ?? "")).length,
		});
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
		const chips = (report.chips ?? {})["after-send"];
		console.log(
			`\n[report] arm=${ARM} steps=${report.steps.length} errors=${report.errors.length}` +
				` chip-after-send=${JSON.stringify(chips?.label ?? null)} -> ${join(OUT, ARM, "report.json")}`,
		);
		process.exit(report.errors.length ? 1 : 0);
	}
}

main();
