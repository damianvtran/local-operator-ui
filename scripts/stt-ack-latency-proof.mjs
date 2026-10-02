/**
 * stt-ack-latency-proof.mjs - the click-path instrument for the composer
 * mic's press-to-recording path.
 *
 * WHAT IT MEASURES, and why in-page. The operator report was "the STT button
 * sometimes lags on click - no immediate loading/preparing indication". The
 * observable question is the timeline from the CLICK to each visible change,
 * so every timestamp below is the page's own `performance.now()`, stamped by
 * listeners installed AFTER boot (window capture phase, so they run before
 * the app's own handlers for the same event) and by a `MutationObserver`
 * (commit-level, so a starved renderer cannot hide a commit behind a frame
 * gap):
 *
 *   input.click -> gum.called -> gum.resolved -> recorder.start ->
 *   first DOM commit of the acknowledgment -> the frame that paints it
 *
 * The click itself goes through CDP's `Input.dispatchMouseEvent` (trusted
 * input, the browser's own pipeline). Bridge and fetch calls are stamped
 * between the click and the acquisition so "are the provider gates a
 * blocking round-trip on click" is answerable from the record rather than
 * from reading code.
 *
 * THE APP IS THE BUILT ONE, launched by its own Electron in
 * `--window-mode=headless` (never shown, never focused), against an ISOLATED
 * backend the caller starts - scratch HOME/config/logs/profile, its own
 * bearer - with Chromium's synthetic capture device
 * (`--use-fake-device-for-media-stream`) so every press lands on a live
 * control deterministically. Every process this rig starts is reaped by pid
 * on exit, and the window is never raised.
 *
 * WHAT IT CANNOT SEE, stated rather than implied:
 *
 *   - macOS TCC. The fake capture device bypasses the OS microphone grant, so
 *     the permission PROMPT is not in any number here; the acquisition work
 *     after the grant is. A real first-use prompt adds its own time on top.
 *   - the waveform's pixels; frames are `Page.captureScreenshot` (webp q88)
 *     into <out>/frames/<name>.webp, labelled by the state read taken beside
 *     each capture (`shot.*` in the record), because a capture under load is
 *     not instantaneous.
 *
 * The record lands in `<out>/stt-ack.json` (`app.log` beside it). The
 * committed set `docs/evidence/stt-instant-ack/` is two runs of this rig -
 * `stt-ack-before.json` from the base tree (no acknowledgment) and
 * `stt-ack-after.json`/`stt-ack-after-timing.json` from the branch's tree -
 * and its README carries the numbers, the commands, and how the frames were
 * arranged into the sweep's `<stem>/<theme>.webp` shape.
 *
 * HOW TO RUN IT (the isolated backend, verbatim from the set's README):
 *
 *   env -u XPC_FLAGS HOME="$SP/backend/home" \
 *     LOCAL_OPERATOR_CONFIG_DIR="$SP/backend/config" \
 *     LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat $SP/backend/token)" \
 *     RADIENT_API_BASE_URL=http://127.0.0.1:8799 \
 *     <local-operator>/.venv/bin/local-operator serve --host 127.0.0.1 --port 11877 --yolo
 *   # then: seed `RADIENT_API_KEY` in that config (the mic gates on it):
 *   curl -X PATCH -H "Authorization: Bearer $(cat $SP/backend/token)" \
 *     -H 'Content-Type: application/json' \
 *     http://127.0.0.1:11877/v1/credentials -d '{"key":"RADIENT_API_KEY","value":"placeholder"}'
 *   # build the app against the backend (`.env`: VITE_LOCAL_OPERATOR_API_URL=...; pnpm build)
 *   LO_ACK_REPO=<worktree> LO_ACK_BACKEND=http://127.0.0.1:11877 \
 *     LO_ACK_TOKEN=$(cat $SP/backend/token) node scripts/stt-ack-latency-proof.mjs <out-dir> [clicks]
 *
 * Env: LO_ACK_SHOTS=off runs numbers-only (no captures; the capture requests
 * compete with the acquisition under heavy load); LO_ACK_PROBE=1 runs two
 * bare getUserMedia calls and exits (a mic-health probe with no UI involved,
 * which is how a 127 s cold acquisition under swap exhaustion was told apart
 * from a UI defect); LO_ACK_LABEL names the run in the record; LO_ACK_THEME
 * (localOperatorDark | localOperatorLight) is the palette this run photographs;
 * LO_ACK_HOLD_MS holds the acquisition open so the pending state can be
 * photographed - and VOIDS this run's numbers, which is why it is recorded;
 * LO_ACK_WINDOW_SIZE (`WxH`, default 1380x900) is the window the run opens, for
 * the narrow-width pass (the app clamps to its own 800x600 floor).
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createProbe } from "node:net";
import { join } from "node:path";

const OUT = process.argv[2];
if (!OUT)
	throw new Error("usage: stt-ack-latency-proof.mjs <out-dir> [clicks]");
const CLICKS = Number(process.argv[3] ?? 7);
const REPO = process.env.LO_ACK_REPO ?? process.cwd();
const BACKEND = process.env.LO_ACK_BACKEND ?? "http://127.0.0.1:11877";
const TOKEN = process.env.LO_ACK_TOKEN ?? "";
if (!TOKEN) throw new Error("LO_ACK_TOKEN is required");
/*
 * THE THEME THIS RUN PHOTOGRAPHS (design round 1, D4 / UX round 1, U5): one
 * theme per run, the driver's own rule - the palette is a document-root
 * attribute, so the pair of frames a visual round asks for is two runs.
 */
const THEME = process.env.LO_ACK_THEME ?? null;
/*
 * A CAPTURE HOLD, IN MS, AND IT INVALIDATES THIS RUN'S NUMBERS. The
 * acknowledgment is on screen for as long as the acquisition takes, which on a
 * warm cycle is a handful of milliseconds - long enough to measure, too short
 * to photograph without racing it. With this set the rig wraps `getUserMedia`
 * in the page to wait that long before touching the real one, so the pending
 * state stands still for the frames; every timing figure a run with it set
 * produces describes the hold, NOT the app. The numbers come from runs that
 * leave it unset, which is also why they are recorded beside it.
 */
const HOLD_MS = Number(process.env.LO_ACK_HOLD_MS ?? 0);
/*
 * THE WINDOW THIS RUN PHOTOGRAPHS, `WxH` (round 2 follow-up). The committed pair
 * was taken at 1380x900 only, and the shipped acknowledgment is a `shrink-0`
 * caption inside a `flex-nowrap` control row - the shape that gives way last, so
 * "the press costs the composer 0 px" is a claim about ONE width until a second
 * one is measured. It is an env var rather than a constant for that reason; the
 * app clamps a request below its own `WINDOW_MIN_WIDTH`/`HEIGHT` floor (800x600,
 * `src/main/window-mode.ts`), so the floor is what a narrower request lands on.
 */
const WINDOW_SIZE = process.env.LO_ACK_WINDOW_SIZE ?? "1380x900";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The repo's own kill switches, imported beside the rig so a run and the app
 * cannot drift on what "off" means. */
const { withNotificationsOff } = await import("./notifications-off.mjs");
const { withTelemetryOff } = await import("./telemetry-off.mjs");

const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const USER_DATA = join(OUT, "user-data");
const LOG_DIR = join(OUT, "logs");
const FRAMES = join(OUT, "frames");
for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, LOG_DIR, FRAMES])
	rmSync(dir, { recursive: true, force: true });
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, FRAMES])
	mkdirSync(dir, { recursive: true });

const freePort = async () => {
	for (;;) {
		const candidate = 9200 + Math.floor(Math.random() * 600);
		const free = await new Promise((resolve) => {
			const probe = createProbe();
			probe.on("error", () => resolve(false));
			probe.listen(candidate, "127.0.0.1", () =>
				probe.close(() => resolve(true)),
			);
		});
		if (free) return candidate;
	}
};
const cdpPort = await freePort();

/* Strip the ambient markers a run must never inherit (CMUX_* once let a
 * headless test rename the operator's real workspaces; NODE_TEST_CONTEXT
 * makes a nested `node --test` silently run nothing - see AGENTS.md). */
const childEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) =>
			!key.startsWith("CMUX_") &&
			!key.startsWith("LOP_") &&
			key !== "NODE_TEST_CONTEXT",
	),
);
const spawnEnv = withNotificationsOff({
	...childEnv,
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	VITE_DISABLE_BACKEND_MANAGER: "true",
	VITE_LOCAL_OPERATOR_API_URL: BACKEND,
	LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
});
withTelemetryOff(spawnEnv);

const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${USER_DATA}`,
		"--window-mode=headless",
		`--window-size=${WINDOW_SIZE}`,
		"--use-fake-device-for-media-stream",
	],
	{
		env: spawnEnv,
		cwd: REPO,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	},
);
const appLog = [];
app.stdout.on("data", (d) => appLog.push(`${d}`));
app.stderr.on("data", (d) => appLog.push(`${d}`));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: resolve(message.result);
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
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
			);
		return result.result.value;
	}
	async shot(name) {
		const { data } = await this.send("Page.captureScreenshot", {
			format: "webp",
			quality: 88,
		});
		writeFileSync(join(FRAMES, `${name}.webp`), Buffer.from(data, "base64"));
		return name;
	}
}

const report = {
	theme: THEME,
	holdMs: HOLD_MS,
	/* The size ASKED FOR; `viewport` below is the one the page reports, which is
	 * what a clamped or scaled request makes worth recording both. */
	windowSize: WINDOW_SIZE,
	rig: { label: process.env.LO_ACK_LABEL ?? "run", cdpPort },
	cycles: [],
};
const record = (key, value) => {
	report[key] = value;
	console.error(`[record] ${key}: ${JSON.stringify(value)}`);
};

const finish = async (cdp, code) => {
	if (report.viewport === undefined && cdp) {
		report.viewport = await cdp
			.evaluate(
				"JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})",
			)
			.catch(() => null);
	}
	try {
		if (cdp) cdp.ws.close();
	} catch {}
	writeFileSync(
		join(OUT, "stt-ack.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	writeFileSync(join(OUT, "app.log"), appLog.join(""));
	try {
		process.kill(-app.pid, "SIGKILL");
	} catch {
		try {
			app.kill("SIGKILL");
		} catch {}
	}
	try {
		execFileSync("pkill", ["-f", `user-data-dir=${USER_DATA}`], {
			stdio: "ignore",
		});
	} catch {}
	process.exit(code ?? 0);
};

const target = async () => {
	try {
		const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
		const list = await response.json();
		const pages = list.filter(
			(entry) => entry.type === "page" && entry.url !== "about:blank",
		);
		return (
			pages.find((entry) => entry.url.endsWith("renderer/index.html")) ??
			pages[0] ??
			null
		);
	} catch {
		return null;
	}
};

const api = async (method, path, body) => {
	const response = await fetch(`${BACKEND}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed = null;
	try {
		parsed = JSON.parse(text);
	} catch {}
	return { status: response.status, parsed, text: text.slice(0, 400) };
};
const result = (reply) =>
	reply.parsed?.result ?? reply.parsed?.data ?? reply.parsed;

let cdp = null;
try {
	/* wait for the renderer target */
	let page = null;
	const bootDeadline = Date.now() + 120_000;
	while (Date.now() < bootDeadline && !page) {
		page = await target();
		if (!page) await sleep(500);
	}
	if (!page)
		throw new Error(`no renderer target appeared:\n${appLog.join("")}`);

	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve);
		ws.addEventListener("error", reject);
	});
	cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

	/* bridge */
	const bridgeDeadline = Date.now() + 30_000;
	let bridged = false;
	while (Date.now() < bridgeDeadline && !bridged) {
		bridged = await cdp
			.evaluate(`typeof window.api?.desktop?.request === "function"`)
			.catch(() => false);
		if (!bridged) await sleep(500);
	}
	if (!bridged)
		throw new Error(`the preload bridge never appeared:\n${appLog.join("")}`);

	/* first-run pin, then reload into a settled app */
	await cdp.evaluate(`(() => {
		localStorage.setItem(
			"onboarding-storage",
			JSON.stringify({
				state: { isModalComplete: true, isTourComplete: true, currentStep: 0 },
				version: 0,
			}),
		);
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(4000);

	const settledDeadline = Date.now() + 60_000;
	let settled = false;
	while (Date.now() < settledDeadline && !settled) {
		settled = await cdp
			.evaluate(
				`typeof window.api?.desktop?.request === "function" && !document.querySelector('[role="dialog"]')`,
			)
			.catch(() => false);
		if (!settled) await sleep(500);
	}
	if (!settled)
		throw new Error("first-run setup never cleared off the composer");

	/* capabilities through the bridge */
	const capabilities = JSON.parse(
		(await cdp.evaluate(
			`(async () => {
				const r = await window.api.desktop.request({ op: "capabilities" });
				return JSON.stringify(r.body?.result ?? r);
			})()`,
		)) ?? "null",
	);
	record(
		"capabilities.desktop_available",
		capabilities?.desktop_available ?? null,
	);
	if (!capabilities?.desktop_available)
		throw new Error("the app is not paired with the backend");

	/* a chat session on the backend, then the app on its route */
	const created = result(
		await api("POST", "/v1/desktop/sessions", {
			request_id: crypto.randomUUID(),
			cwd: OUT,
		}),
	);
	const sessionId = created?.session_id;
	if (!sessionId)
		throw new Error(`no session could be created: ${JSON.stringify(created)}`);
	await cdp.evaluate(`location.hash = "#/chat/${sessionId}"; true`);
	const TEXTAREA = 'textarea[aria-label="Message"]';
	let ready = false;
	const readyDeadline = Date.now() + 30_000;
	while (Date.now() < readyDeadline && !ready) {
		ready = await cdp.evaluate(
			`document.querySelector('${TEXTAREA}') !== null`,
		);
		if (!ready) await sleep(300);
	}
	if (!ready) throw new Error("the composer never appeared");
	await sleep(900);

	/* --- the palette this run photographs ---------------------------------- */
	if (THEME) {
		await cdp.evaluate(
			`(() => { document.documentElement.dataset.theme = ${JSON.stringify(THEME)}; return true; })()`,
		);
		await sleep(300);
	}
	record("palette", {
		asked: THEME,
		applied: await cdp.evaluate(
			"document.documentElement.dataset.theme ?? null",
		),
		/* The composer's own ground, read rather than assumed: a light run whose
		 * ground is the dark one would be the frame check lying about itself. */
		composerGround: await cdp.evaluate(
			"(() => { const el = document.querySelector('[data-lo-composer-measure]'); return el ? getComputedStyle(el).backgroundColor : null; })()",
		),
		documentGround: await cdp.evaluate(
			"getComputedStyle(document.body).backgroundColor",
		),
	});
	/* --- the instrument ---------------------------------------------------- */
	const instrument = `(() => {
		const m = (window.__m = window.__m || { events: [], cycle: null, cycles: [], seq: 0 });
		if (m.installed) return "already";
		m.installed = true;
		const now = () => performance.now();
		const push = (name, data) => m.events.push({ seq: ++m.seq, name, t: now(), data: data === undefined ? null : data });
		const MIC = '[aria-label="Start recording"]';
		const isMic = (t) => !!(t && t.closest && t.closest(MIC));
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
			window.addEventListener(type, (e) => { if (isMic(e.target)) push("input." + type, { trusted: e.isTrusted }); }, true);
		}
		window.addEventListener("keydown", (e) => { if (e.key === "Escape") push("input.Escape", null); }, true);

		if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
			const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
			navigator.mediaDevices.getUserMedia = async (constraints) => {
				push("gum.called", { constraints: JSON.stringify(constraints) });
				/* The capture hold (see LO_ACK_HOLD_MS): inside the wrapper, so
				 * the pending state the check above stamps is the REAL one. */
				if (${HOLD_MS} > 0) { push("gum.held", { ms: ${HOLD_MS} }); await new Promise((r) => setTimeout(r, ${HOLD_MS})); }
				try {
					const stream = await orig(constraints);
					push("gum.resolved", { tracks: stream.getTracks().length });
					return stream;
				} catch (err) {
					push("gum.rejected", { name: err && err.name });
					throw err;
				}
			};
			m.gumWrapped = true;
		}
		if (window.MediaRecorder) {
			const MR = window.MediaRecorder;
			const origStart = MR.prototype.start;
			MR.prototype.start = function (...args) { push("recorder.start", null); return origStart.apply(this, args); };
			m.mrWrapped = true;
		}
		try {
			if (window.api && window.api.desktop && window.api.desktop.request) {
				const orig = window.api.desktop.request.bind(window.api.desktop);
				window.api.desktop.request = (...args) => { push("bridge.request", { op: args[0] && args[0].op }); return orig(...args); };
				m.bridgeWrapped = true;
			}
		} catch {}
		try {
			const origFetch = window.fetch.bind(window);
			window.fetch = (...args) => {
				const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
				push("fetch", { url: String(url).slice(0, 140) });
				return origFetch(...args);
			};
			m.fetchWrapped = true;
		} catch {}

		const read = () => ({
			mic: !!document.querySelector(MIC),
			confirm: !!document.querySelector('[aria-label="Confirm recording"]'),
			cancel: !!document.querySelector('[aria-label="Cancel recording"]'),
			indicator: !!document.querySelector('[data-recording-indicator]'),
			preparing: !!document.querySelector('[data-preparing-indicator]'),
			micBusy: (document.querySelector(MIC) && document.querySelector(MIC).getAttribute("aria-busy")) === "true",
			transcribing: !!document.querySelector('[data-transcribing-indicator]'),
		});
		m.read = read;
		/*
		 * THE GEOMETRY, IN THE DOCUMENT THAT OWNS IT (design round 1, D2). The
		 * card is bottom-pinned, so what "the composer moved" means is its TOP
		 * edge and its height - plus the control's own rect, which is what says
		 * whether the acknowledgment displaced the row it was added to.
		 */
		m.geom = () => {
			const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 }; };
			const measure = document.querySelector('[data-lo-composer-measure]');
			const mic = document.querySelector(MIC);
			const ring = mic ? mic.querySelector('span[class*="animate-spin"]') : null;
			const style = ring ? getComputedStyle(ring) : null;
			return {
				box: box(measure),
				mic: box(mic),
				indicator: box(document.querySelector('[data-preparing-indicator]')),
				lane: box(document.querySelector('[data-recording-indicator]')),
				ring: style ? { w: box(ring).w, h: box(ring).h, track: style.borderRightColor, quadrant: style.borderTopColor, ground: getComputedStyle(mic).backgroundColor } : null,
			};
		};
		m.mark = () => m.events.length;
		m.arm = (i) => {
			const c = { i, t0: null, markIndex: m.events.length, ack: null, ackPaint: null, flip: null, flipPaint: null, sampleFirst: null, mutAck: null, mutFlip: null };
			m.cycle = c;
			return i;
		};
		/*
		 * COMMIT-LEVEL STAMPS (the rAF loop samples at frame cadence and starves
		 * under load): the observer fires in the mutation microtask right after
		 * React commits, so mutAck/mutFlip are the DOM's own commit times even when
		 * no frame renders for a while.
		 */
		const commitStamp = () => {
			const c = m.cycle;
			if (!c) return;
			if (c.t0 === null) {
				const lastClick = [...m.events].reverse().find((e) => e.name === "input.click" || e.name === "input.pointerdown");
				if (lastClick && lastClick.seq > c.markIndex) c.t0 = lastClick.t;
			}
			if (c.t0 === null) return;
			const s = read();
			const ackNow = s.preparing || s.micBusy || !s.mic || s.confirm || s.cancel || s.indicator;
			if (ackNow && c.mutAck === null) c.mutAck = now();
			if ((s.confirm || s.cancel || s.indicator) && c.mutFlip === null) c.mutFlip = now();
		};
		m.observer = new MutationObserver(commitStamp);
		m.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
		const loop = () => {
			const c = m.cycle;
			if (c && c.closed !== true) {
				const s = read();
				if (c.t0 === null) {
					const lastClick = [...m.events].reverse().find((e) => e.name === "input.click" || e.name === "input.pointerdown");
					if (lastClick && lastClick.seq > c.markIndex) c.t0 = lastClick.t;
				}
				if (c.t0 !== null) {
					const preparing = s.preparing || s.micBusy;
					const recording = s.confirm || s.cancel || s.indicator;
					const micGone = !s.mic;
					const ackNow = preparing || micGone || recording;
					if (ackNow && c.ack === null) {
						c.ack = now(); c.ackKind = preparing ? "preparing" : (micGone ? "mic-gone" : "recording");
						requestAnimationFrame(() => requestAnimationFrame(() => { if (c.ackPaint === null) c.ackPaint = now(); }));
					}
					if (recording && c.flip === null) {
						c.flip = now();
						requestAnimationFrame(() => requestAnimationFrame(() => { if (c.flipPaint === null) c.flipPaint = now(); }));
					}
					if (c.sampleFirst === null && now() - c.t0 > 0) c.sampleFirst = { t: now(), ...s };
				}
			}
			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
		return "installed";
	})()`;
	await cdp.evaluate(instrument);
	const wired = await cdp.evaluate(
		"JSON.stringify({gum: __m.gumWrapped, mr: __m.mrWrapped, bridge: __m.bridgeWrapped, fetch: __m.fetchWrapped})",
	);
	record("instrument", JSON.parse(wired));

	const readState = async () =>
		JSON.parse(await cdp.evaluate("JSON.stringify(window.__m.read())"));
	const warnState = async (label) =>
		record(`state.${label}`, await readState());

	/*
	 * A WARM-UP CALL, AND IT IS NOT PART OF ANY NUMBER (`LO_ACK_WARMUP=1`). The
	 * FIRST `getUserMedia` in a fresh profile is the cold one - measured 0.8 s to
	 * 9 s on this fleet, and over two minutes under swap exhaustion - and the
	 * frame runs are deliberately short-lived: a warm-up primes the device path
	 * so a capture run's OWN acquisition is the warm one (milliseconds), which is
	 * what lets a capture finish inside the windows this host leaves a rig. The
	 * runs that MEASURE the acquisition leave it off, so the cold number they
	 * report is a real first-use one.
	 */
	if (process.env.LO_ACK_WARMUP === "1") {
		record(
			"warmup.ms",
			await cdp.evaluate(
				`(async () => { const t0 = performance.now(); try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); for (const t of s.getTracks()) t.stop(); return Math.round(performance.now() - t0); } catch (e) { return "failed: " + String(e && e.name); } })()`,
			),
		);
	}

	/* The mic must be enabled for the true path. */
	let micReady = false;
	const micDeadline = Date.now() + 45_000;
	while (Date.now() < micDeadline && !micReady) {
		const disabled = await cdp.evaluate(
			`(() => { const el = document.querySelector('[aria-label="Start recording"]'); return el ? el.disabled : null; })()`,
		);
		if (disabled === false) micReady = true;
		else await sleep(400);
	}
	record("mic.enabled", micReady);
	report.micDisabledSample = await cdp.evaluate(
		`(() => { const el = document.querySelector('[aria-label="Start recording"]'); return el ? el.disabled : "absent"; })()`,
	);
	if (!micReady) {
		await warnState("micNeverEnabled");
		throw new Error(
			"the mic never enabled; the five gates never passed - cannot click the real path",
		);
	}

	/* idle frame */
	record(
		"geom.rest",
		JSON.parse(await cdp.evaluate("JSON.stringify(window.__m.geom())")),
	);
	await cdp.shot("00-idle");

	const clickMic = async () => {
		const aim = await cdp.evaluate(`(() => {
			const el = document.querySelector('[aria-label="Start recording"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			const owner = document.elementFromPoint(x, y);
			return JSON.stringify({ x, y, ok: owner === el || el.contains(owner) });
		})()`);
		if (!aim) return { ok: false };
		const point = JSON.parse(aim);
		if (!point.ok) return { ok: false, point };
		for (const type of ["mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				button: "left",
				clickCount: 1,
			});
		return { ok: true, point };
	};
	const pressEsc = async () => {
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 53,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 53,
		});
	};
	const waitFlip = async (budgetMs) => {
		const until = Date.now() + budgetMs;
		while (Date.now() < until) {
			const flip = await cdp.evaluate(
				"window.__m.cycle && window.__m.cycle.flip !== null",
			);
			if (flip) return true;
			await sleep(20);
		}
		return false;
	};
	const waitIdle = async (budgetMs) => {
		const until = Date.now() + budgetMs;
		while (Date.now() < until) {
			const s = await readState();
			if (
				s.mic &&
				!s.confirm &&
				!s.cancel &&
				!s.indicator &&
				!s.preparing &&
				!s.transcribing
			)
				return true;
			await sleep(60);
		}
		return false;
	};

	/* --- the click cycles --------------------------------------------------- */
	for (let i = 1; i <= CLICKS; i += 1) {
		const idle = await waitIdle(15_000);
		if (!idle) {
			record(`cycle${i}.neverIdle`, await readState());
			break;
		}
		await cdp.evaluate(`window.__m.arm(${i})`);
		const SHOTS = process.env.LO_ACK_SHOTS !== "off";
		const shots = !SHOTS
			? []
			: i === 1
				? [
						{ delay: 40, name: `c${i}-just-after-click` },
						{ delay: 150, name: `c${i}-post-click-150ms` },
						{ delay: 300, name: `c${i}-post-click-300ms` },
						{ delay: 600, name: `c${i}-post-click-600ms` },
						{ delay: 1200, name: `c${i}-post-click-1200ms` },
					]
				: i === 2
					? [{ delay: 80, name: `c${i}-post-click-80ms` }]
					: [];
		const click = await clickMic();
		if (!click.ok) {
			record(`cycle${i}.clickFailed`, click);
			break;
		}
		/*
		 * The shot delays are deltas from the CLICK (page clock), not from this
		 * loop's entry: clickMic() itself costs a few CDP round trips under load,
		 * so a sleep-after-return lands hundreds of ms late (measured: the "40 ms"
		 * shot of run 1 completed at +306 ms).
		 */
		let t0Page = null;
		for (let k = 0; k < 40 && t0Page === null; k += 1) {
			t0Page = await cdp.evaluate("window.__m.cycle && window.__m.cycle.t0");
			if (t0Page === null) await sleep(5);
		}
		for (const shot of shots) {
			if (t0Page !== null) {
				const pageNow = await cdp.evaluate("performance.now()");
				const remaining = shot.delay - (pageNow - t0Page);
				if (remaining > 0) await sleep(remaining);
			}
			/*
			 * The capture is not instantaneous under fleet load, so a frame is
			 * labelled by the page clock at request time and by the state read
			 * immediately before AND after it: a frame whose two reads disagree
			 * is ambiguous and says so.
			 */
			const atMs = await cdp.evaluate("performance.now()");
			const beforeState = await readState();
			const geomBefore = JSON.parse(
				await cdp.evaluate("JSON.stringify(window.__m.geom())"),
			);
			await cdp.shot(shot.name);
			record(`shot.${shot.name}`, {
				atMs,
				stateBefore: beforeState,
				geomBefore,
				stateAfter: await readState(),
			});
		}
		const flipped = await waitFlip(i === 1 ? 180_000 : 15_000);
		/* let the paint callbacks (double-rAF) land before the cycle read */
		await sleep(150);
		const cycle = JSON.parse(
			await cdp.evaluate("JSON.stringify(window.__m.cycle)"),
		);
		const marks = JSON.parse(
			await cdp.evaluate(
				`JSON.stringify(window.__m.events.slice(${cycle.markIndex}))`,
			),
		);
		const t0 = cycle.t0;
		const first = (name) => {
			const e = marks.find((m) => m.name === name && m.t >= (t0 ?? 0));
			return e ? Math.round((e.t - t0) * 10) / 10 : null;
		};
		const series = (name) =>
			marks
				.filter((m) => m.name === name)
				.map((m) => Math.round((m.t - t0) * 10) / 10);
		const cycleRecord = {
			i,
			cold: i === 1,
			flipped,
			t0: t0 === null ? null : Math.round(t0 * 10) / 10,
			clickToGumCalledMs: t0 === null ? null : first("gum.called"),
			gumResolveMs:
				t0 === null
					? null
					: (() => {
							const c = marks.find((m) => m.name === "gum.called");
							const r = marks.find((m) => m.name === "gum.resolved");
							return c && r ? Math.round((r.t - c.t) * 10) / 10 : null;
						})(),
			gumRejected: series("gum.rejected"),
			resolvedToRecorderStartMs: (() => {
				const r = marks.find((m) => m.name === "gum.resolved");
				const s = marks.find((m) => m.name === "recorder.start");
				return r && s ? Math.round((s.t - r.t) * 10) / 10 : null;
			})(),
			recorderStartToFlipMs:
				cycle.flip === null
					? null
					: Math.round(
							(cycle.flip -
								(marks.find((m) => m.name === "recorder.start")?.t ??
									cycle.flip)) *
								10,
						) / 10,
			clickToAckMs:
				cycle.ack === null || t0 === null
					? null
					: Math.round((cycle.ack - t0) * 10) / 10,
			ackCommitMs:
				cycle.mutAck === null || t0 === null
					? null
					: Math.round((cycle.mutAck - t0) * 10) / 10,
			flipCommitMs:
				cycle.mutFlip === null || t0 === null
					? null
					: Math.round((cycle.mutFlip - t0) * 10) / 10,
			ackKind: cycle.ackKind ?? null,
			clickToAckPaintMs:
				cycle.ackPaint === null || t0 === null
					? null
					: Math.round((cycle.ackPaint - t0) * 10) / 10,
			clickToFlipMs:
				cycle.flip === null || t0 === null
					? null
					: Math.round((cycle.flip - t0) * 10) / 10,
			clickToFlipPaintMs:
				cycle.flipPaint === null || t0 === null
					? null
					: Math.round((cycle.flipPaint - t0) * 10) / 10,
			bridgeCallsBeforeGum: (() => {
				const g = marks.find((m) => m.name === "gum.called");
				return g
					? marks
							.filter(
								(m) =>
									m.name === "bridge.request" && m.t <= g.t && m.t >= (t0 ?? 0),
							)
							.map((m) => m.data?.op)
					: [];
			})(),
			fetchBeforeGum: (() => {
				const g = marks.find((m) => m.name === "gum.called");
				return g
					? marks
							.filter(
								(m) => m.name === "fetch" && m.t <= g.t && m.t >= (t0 ?? 0),
							)
							.map((m) => m.data?.url)
					: [];
			})(),
		};
		cycleRecord.holdMs = HOLD_MS;
		report.cycles.push(cycleRecord);
		console.error(`[cycle ${i}] ${JSON.stringify(cycleRecord)}`);
		/* paint settle before the recording frame */
		if (flipped && i === 1) {
			await sleep(650);
			record(
				`cycle${i}.geomRecording`,
				JSON.parse(await cdp.evaluate("JSON.stringify(window.__m.geom())")),
			);
			await cdp.shot(`c${i}-recording`);
		}
		/* cancel the take and let the composer come back */
		if (flipped) await pressEsc();
		await sleep(150);
		const back = await waitIdle(10_000);
		if (!back) {
			record(`cycle${i}.didNotReturnIdle`, await readState());
			await pressEsc();
			await sleep(500);
		}
	}
	if (process.env.LO_ACK_PROBE === "1") {
		/* A mic-health probe with NO click path and NO instrument interplay:
		 * two bare getUserMedia calls in the app's own renderer. */
		for (let round = 1; round <= 2; round += 1) {
			const raw = await cdp.evaluate(`(async () => {
				const t0 = performance.now();
				try {
					const s = await navigator.mediaDevices.getUserMedia({ audio: true });
					const ms = Math.round(performance.now() - t0);
					for (const t of s.getTracks()) t.stop();
					return JSON.stringify({ ok: true, ms });
				} catch (e) {
					return JSON.stringify({ ok: false, name: String(e && e.name), ms: Math.round(performance.now() - t0) });
				}
			})()`);
			record(`probe.round${round}`, JSON.parse(raw));
			console.error(`[probe ${round}] ${raw}`);
		}
		await finish(cdp, 0);
		process.exit(0);
	}

	await cdp.evaluate(
		"window.__m.cycle && (window.__m.cycle.closed = true); true",
	);

	await finish(cdp, 0);
} catch (error) {
	const message = error?.stack ?? String(error);
	record("error", message);
	console.error(message);
	await finish(cdp, 1);
}
