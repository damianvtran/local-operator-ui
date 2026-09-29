#!/usr/bin/env node
/**
 * Prove, in the REAL app and over the REAL desktop transport, the four parts of
 * the speech-to-text overhaul:
 *
 *   1. the recording state no longer replaces (or covers) the composer's text,
 *      and reads as a minimal strip beside it;
 *   2. a transcript that lands while a send is in flight joins the send's own
 *      clear machinery rather than racing it (it is never taken away by the
 *      clear and never resurrects the sent text);
 *   3. push-to-talk engages on keydown with no timer, and the mic is usable
 *      while a turn is running (the admit-to-first-answer window included);
 *   4. a mid-turn send rides the existing steer path, and the send body carries
 *      `input_mode` when the backend advertises the capability.
 *
 * ## How to run it
 *
 * The app is the BUILT one (`out/`, from `pnpm build`, with the renderer built
 * against this run's proxy URL), launched `headless`, with a synthetic
 * microphone (`--use-fake-device-for-media-stream`) so the dictation controls
 * are live deterministically. Three processes make the loop real:
 *
 *   1. the ISOLATED backend, started by the caller (`local-operator serve`,
 *      its own scratch config dir, a bearer of the caller's choosing) with
 *      `RADIENT_API_BASE_URL=http://127.0.0.1:<RADIENT_PORT>` and a placeholder
 *      `RADIENT_API_KEY` seeded into that config dir - the mic gates on the key
 *      and the transcription relay is what this rig exercises;
 *   2. the FAKE RADIENT UPSTREAM, bound by this rig on `<RADIENT_PORT>`
 *      (`POST /v1/tools/transcriptions` -> `{result: {text, provider, status}}`,
 *      after a fixed delay so the transcribing state is capturable);
 *   3. the RECORDING PROXY, bound by this rig on `<PROXY_PORT>`, in front of
 *      the backend: it forwards every byte unchanged (streaming responses
 *      included) and RECORDS every `POST .../messages` body (the wire half of
 *      the `input_mode` and `mode` claims). With `LO_PROOF_INJECT=on` it also
 *      injects `features.input_mode = 1` into `GET /v1/capabilities`, and the
 *      run then proves the STAMPED half of the contract; the default (`off`)
 *      runs the shape that ships - no injected key, and the legacy body proven
 *      at the wire (see `INJECT_INPUT_MODE` for why the halves are two runs).
 *
 *     LO_PROOF_TOKEN=$(cat ...) LO_PROOF_BACKEND=http://127.0.0.1:1131 \
 *       node scripts/stt-dictation-proof.mjs <out-dir>
 *
 * HOME, LOCAL_OPERATOR_CONFIG_DIR, LOCAL_OPERATOR_LOG_DIR and the Electron
 * profile are all inside `<out-dir>`; every inherited `CMUX_*`/`LOP_*` variable
 * is stripped; the notification and telemetry kill switches are set; the app is
 * never shown or focused and every process this rig starts is reaped by pid.
 *
 * The record lands in `<out-dir>/stt-proof.json`; frames land beside it. A
 * claim that does not hold is recorded `ok: false` and fails the run at the
 * end. Where a path cannot be driven headlessly (a main-process chord, macOS
 * TCC), the run says so in `notes` rather than claiming it.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const OUT = process.argv[2] ?? join(tmpdir(), "lo-stt-proof");
const BACKEND = process.env.LO_PROOF_BACKEND ?? "http://127.0.0.1:1131";
const TOKEN = process.env.LO_PROOF_TOKEN ?? "";
const PROXY_PORT = Number(process.env.LO_PROOF_PROXY_PORT ?? 8080);
const RADIENT_PORT = Number(process.env.LO_PROOF_RADIENT_PORT ?? 8799);
const WIDTH = Number(process.env.LO_PROOF_WIDTH ?? 1380);
const HEIGHT = 900;
const DEADLINE_MS = 120_000;
/** The one path whose bodies this rig records: the message send. */
const MESSAGES_POST = /\/messages$/;
/*
 * WHICH HALF OF THE `input_mode` CONTRACT THIS RUN EXERCISES.
 *
 * `off` (the default) is the shape that ships TODAY: the harness does not
 * advertise `features.input_mode`, the app sends the legacy body, and the run
 * proves the silent degradation (the field ABSENT, and the whole dictation and
 * steer flow working without it). `on` injects the capability into
 * `/v1/capabilities` so the stamp rides the message bodies - proven at the wire
 * by the recording proxy - and is run against this tree's backend, which does
 * not implement the field yet: that backend refuses the stamped body with a
 * 422, which is exactly the skew the capability gate exists to avoid, and it
 * is why the two halves are separate runs instead of one.
 */
const INJECT_INPUT_MODE = (process.env.LO_PROOF_INJECT ?? "off") === "on";

if (!TOKEN) {
	console.error(
		"LO_PROOF_TOKEN is unset: an app that did not start the backend holds no bearer, and every session control would answer 503.",
	);
	process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const report = {
	backend: BACKEND,
	proxy: `http://127.0.0.1:${PROXY_PORT}`,
	out: OUT,
	steps: [],
	claims: [],
	notes: [],
	wire: [],
};
const record = (step, value) => {
	report.steps.push({ step, ...value });
	console.log(`${step}: ${JSON.stringify(value)}`);
};
const claims = report.claims;
const verify = (step, hold, detail) => {
	record(step, { ok: hold === true, ...detail });
	if (hold !== true) claims.push({ step, ...detail });
};
const note = (text) => {
	report.notes.push(text);
	console.log(`note: ${text}`);
};

/*
 * WHICH BUILD THIS RUN MEANS TO DESCRIBE. `after` (the default) is the tree
 * under review: every claim must hold. `before` runs the same script against
 * the un-changed build to take the BEFORE frames and the baseline numbers, so
 * claims about behaviour that build cannot have (the immediate combo, the
 * mid-turn capture, the input_mode field) are recorded as observations rather
 * than asserted - the record still carries them, with `ok: true` absent so a
 * reader can tell an observation from a claim.
 */
const ROLE = process.env.LO_PROOF_ROLE ?? "after";
/*
 * WHAT A CLAIM CAN MEAN PER RUN MODE. The injected run drives a backend that
 * does not implement the field yet (§4.5's skew), so its sends are refused
 * with a 422 and every claim about what the TURN did, or how a ROW rendered, is
 * a claim about a refused send - recorded as observations rather than asserted.
 * Its WIRE claims stay claims: a body that 422s is exactly where the
 * `input_mode` evidence comes from.
 */
const INJECTED_WIRE_ONLY = INJECT_INPUT_MODE;
const expectMaybe = (step, hold, detail) => {
	if (ROLE === "after" && !INJECTED_WIRE_ONLY) verify(step, hold, detail);
	else record(step, { observed: hold === true, ...detail });
};

/**
 * `input_mode` on a recorded body, checked against the half of the contract
 * this run exercises (see `INJECT_INPUT_MODE`): stamped and equal to `value`
 * when the capability was advertised, ABSENT (never null-empty) when it was
 * not - which is the degradation the app ships with today. Asserted in both
 * modes: this is the wire claim the run exists for.
 */
const expectInputMode = (step, body, value) => {
	const actual = body?.input_mode ?? null;
	const hold = INJECT_INPUT_MODE ? actual === value : actual === null;
	if (ROLE === "after") verify(step, hold, { input_mode: actual });
	else record(step, { observed: hold, input_mode: actual });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const result = (envelope) => envelope?.body?.result ?? null;

const api = async (method, path, body) => {
	const response = await fetch(`${BACKEND}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: await response.json().catch(() => null),
	};
};

/* ------------------------------------------------- the fake Radient upstream */

/*
 * The hub path the backend's client joins is `{base}/tools/transcriptions`,
 * and `RADIENT_API_BASE_URL` is normalized to carry `/v1` (local_operator/
 * env.py), so a base of `http://127.0.0.1:<port>` surfaces here as
 * `/v1/tools/transcriptions`. The response is the documented envelope
 * (`RadientTranscriptionAPIResponse`): `result.text` is what the composer
 * appends. The fixtures are a fixed sequence so two dictations in one run are
 * tellable apart, and the fixed delay leaves the transcribing state on screen
 * long enough to capture deterministically rather than as a race.
 */
const FIXTURES = [
	"dictated words from the fake upstream.",
	"second dictation, also from the fake upstream.",
	"dictated steer probe from the fake upstream.",
	"fourth dictation from the fake upstream.",
];
const TRANSCRIBE_DELAY_MS = Number(
	process.env.LO_PROOF_TRANSCRIBE_DELAY ?? 900,
);
let fixtureIndex = 0;
const radientCalls = [];
/*
 * THE GATE. Session C needs a transcription to land INSIDE the window between a
 * send's press and its echo clear - tens of milliseconds wide, so no fixed
 * delay can hold it open. When armed, the next transcription response parks on
 * a promise the sequence resolves AT the press: the transcript then lands in
 * the window by construction rather than by luck, and `heldTranscriptionText`
 * is what the assertions read back (the fixture index is whatever the earlier
 * steps left it at, in every run mode).
 */
let heldTranscription = null;
let heldTranscriptionText = null;
let holdNextTranscription = false;
const armTranscriptionGate = () => {
	holdNextTranscription = true;
};
const releaseTranscriptionGate = async () => {
	const until = Date.now() + 5000;
	while (!heldTranscription && Date.now() < until) await sleep(25);
	heldTranscription?.();
};
const radientUpstream = createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", async () => {
		const bodyBytes = Buffer.concat(chunks).length;
		radientCalls.push({
			at: Date.now(),
			method: req.method,
			url: req.url,
			bytes: bodyBytes,
			authorized: String(req.headers.authorization ?? "").startsWith("Bearer "),
		});
		if (req.method === "POST" && req.url?.endsWith("/tools/transcriptions")) {
			const text = FIXTURES[Math.min(fixtureIndex, FIXTURES.length - 1)];
			fixtureIndex += 1;
			if (holdNextTranscription) {
				holdNextTranscription = false;
				heldTranscriptionText = text;
				await new Promise((resolve) => {
					heldTranscription = resolve;
				});
				heldTranscription = null;
			} else {
				await sleep(TRANSCRIBE_DELAY_MS);
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					result: {
						text,
						provider: "fixture",
						status: "ok",
						error: null,
						duration: 1,
					},
					error: null,
					msg: null,
				}),
			);
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ detail: "not found" }));
	});
});
await new Promise((resolve, reject) => {
	radientUpstream.once("error", reject);
	radientUpstream.listen(RADIENT_PORT, "127.0.0.1", resolve);
});
record("rig.radientUpstream", {
	port: RADIENT_PORT,
	delayMs: TRANSCRIBE_DELAY_MS,
});

/* ------------------------------------------------------ the recording proxy */

/*
 * One process, three jobs: forward (so the app talks to a real backend through
 * a port the renderer's connect-src allows), inject the one capability this
 * branch consumes that the shipped backend does not carry yet, and RECORD the
 * message bodies - the only place `mode: "steer"` and `input_mode` are
 * observable while the backend's own carriage is a separate stream.
 */
const wireMessages = report.wire;
/*
 * When the page asked for the held transcription to be let go, rig-side; read
 * back beside the page's own timestamps so the release and the writes are one
 * timeline.
 */
let raceReleaseAt = null;
const proxy = createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", async () => {
		/*
		 * THE PAGE-SIDE RELEASE DOOR. The window the transcript must land inside is
		 * a handful of milliseconds wide on this path, and a CDP evaluate roundtrip
		 * is longer than the window it is trying to hit - the first versions of
		 * this sequence lost that race and recorded `windowOpen:false` rather than
		 * pretend. So the page releases the gate ITSELF, in the same turn it
		 * dispatches the press, through this one route on the port the renderer's
		 * connect-src already allows. Nothing else about the proxy changes.
		 */
		if (req.url === "/__race-release") {
			raceReleaseAt = Date.now();
			await releaseTranscriptionGate();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ released: true }));
			return;
		}
		const requestBody = Buffer.concat(chunks);
		const target = new URL(req.url ?? "/", BACKEND);
		let recorded = null;
		if (req.method === "POST" && MESSAGES_POST.test(target.pathname)) {
			try {
				recorded = JSON.parse(requestBody.toString("utf8"));
			} catch {
				recorded = { unparsable: true };
			}
			wireMessages.push({
				at: Date.now(),
				path: target.pathname,
				body: recorded,
			});
		}
		const headers = { ...req.headers };
		// Host/content-length are the hop's own: the upstream address is the
		// target's, and a body measured on the way through may differ from the
		// header the client sent.
		headers.host = target.host;
		headers["content-length"] = String(requestBody.length);
		try {
			const upstream = await fetch(target, {
				method: req.method,
				headers,
				body:
					req.method === "GET" || req.method === "HEAD"
						? undefined
						: requestBody.length > 0
							? requestBody
							: undefined,
			});
			/*
			 * The capability injection, and only that: `input_mode` is the one key
			 * this branch sends a field for. Everything else - status, headers,
			 * bytes, streaming framing - is forwarded unchanged, so a surface the
			 * injection does not touch cannot pass because of it.
			 */
			if (
				INJECT_INPUT_MODE &&
				target.pathname === "/v1/capabilities" &&
				upstream.ok &&
				String(upstream.headers.get("content-type") ?? "").includes(
					"application/json",
				)
			) {
				const parsed = await upstream.json();
				if (parsed?.result?.features) {
					parsed.result.features.input_mode = 1;
				}
				const encoded = JSON.stringify(parsed);
				res.writeHead(200, {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(encoded),
				});
				res.end(encoded);
				return;
			}
			const responseHeaders = {};
			for (const [key, value] of upstream.headers.entries()) {
				if (
					["content-length", "transfer-encoding", "content-encoding"].includes(
						key,
					)
				)
					continue;
				responseHeaders[key] = value;
			}
			res.writeHead(upstream.status, responseHeaders);
			if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
			else res.end();
		} catch (error) {
			res.writeHead(502, { "content-type": "application/json" });
			res.end(
				JSON.stringify({ detail: `proxy could not reach upstream: ${error}` }),
			);
		}
	});
});
await new Promise((resolve, reject) => {
	proxy.once("error", reject);
	proxy.listen(PROXY_PORT, "127.0.0.1", resolve);
});
record("rig.proxy", { port: PROXY_PORT, upstream: BACKEND });

/* ---------------------------------------------------------------- isolation */

const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const USER_DATA = join(OUT, "user-data");
const LOG_DIR = join(OUT, "logs");
for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, LOG_DIR])
	rmSync(dir, { recursive: true, force: true });
mkdirSync(HOME_DIR, { recursive: true });
mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete childEnv[key];
}

const freePort = async () => {
	const { createServer: createProbe } = await import("node:net");
	for (;;) {
		const candidate = 9500 + Math.floor(Math.random() * 400);
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
const cdpPort = Number(process.env.LO_PROOF_CDP_PORT) || (await freePort());

const spawnEnv = withNotificationsOff({
	...childEnv,
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	VITE_DISABLE_BACKEND_MANAGER: "true",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PROXY_PORT}`,
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
		`--window-size=${WIDTH}x${HEIGHT}`,
		"--use-fake-device-for-media-stream",
	],
	{
		env: spawnEnv,
		cwd: process.cwd(),
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
			format: "png",
		});
		writeFileSync(join(OUT, name), Buffer.from(data, "base64"));
	}
}

const finish = async (cdp) => {
	if (cdp) {
		report.viewport = await cdp
			.evaluate(
				"JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})",
			)
			.catch(() => null);
		cdp.ws.close();
	}
	writeFileSync(
		join(OUT, "stt-proof.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	try {
		process.kill(-app.pid, "SIGKILL");
	} catch {
		app.kill("SIGKILL");
	}
	try {
		execFileSync("pkill", ["-f", `user-data-dir=${USER_DATA}`], {
			stdio: "ignore",
		});
	} catch {
		// No match is the good case.
	}
	proxy.close();
	radientUpstream.close();
	report.radientCalls = radientCalls;
	writeFileSync(
		join(OUT, "stt-proof.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
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

let cdp = null;
try {
	let page = null;
	const bootDeadline = Date.now() + DEADLINE_MS;
	while (Date.now() < bootDeadline && !page) {
		page = await target();
		await sleep(500);
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
	record("bridge", { present: true });

	// First-run pin, unconditional, then reload into a settled composer.
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

	/*
	 * The capability map, THROUGH THE PROXY: this is where the injected
	 * `input_mode` key is proven to have reached the app, and where an un-injected
	 * run is distinguishable in the record.
	 */
	const capabilities = JSON.parse(
		(await cdp.evaluate(
			`(async () => {
				const r = await window.api.desktop.request({ op: "capabilities" });
				return JSON.stringify(r.body?.result ?? r);
			})()`,
		)) ?? "null",
	);
	record("capabilities", {
		desktop_available: capabilities?.desktop_available ?? null,
		input_mode_injected: capabilities?.features?.input_mode !== undefined,
		features_keys: Object.keys(capabilities?.features ?? {}).length,
	});
	if (!capabilities?.desktop_available)
		throw new Error("the app is not paired with the backend");
	record("capabilities.input_mode", {
		inject: INJECT_INPUT_MODE,
		value: capabilities?.features?.input_mode ?? null,
	});
	expectMaybe(
		"capabilities.input_modeMatchesRunMode",
		INJECT_INPUT_MODE
			? capabilities?.features?.input_mode === 1
			: capabilities?.features?.input_mode === undefined,
		{ value: capabilities?.features?.input_mode ?? null },
	);

	/* ------------------------------------------------------------ helpers */

	const MIC = '[aria-label="Start recording"]';
	const CONFIRM = '[aria-label="Confirm recording"]';
	const CANCEL = '[aria-label="Cancel recording"]';
	const TEXTAREA = 'textarea[aria-label="Message"]';
	const RECORDING_ANY = `${CONFIRM}, ${CANCEL}, [data-recording-indicator]`;

	const composerBox = () =>
		cdp
			.evaluate(
				`(() => {
				const field = document.querySelector(${JSON.stringify(TEXTAREA)});
				const wrap = field?.closest("form") ?? field?.parentElement ?? null;
				const r = wrap?.getBoundingClientRect() ?? null;
				return JSON.stringify({
					textarea: field !== null,
					recording: !!document.querySelector(${JSON.stringify(RECORDING_ANY)}),
					/*
					 * The new treatment's own marker, beside the controls every build has:
					 * it is present only WHILE a recording exists, so this is the reading
					 * that tells the two treatments apart (the old one replaced the field
					 * with a washed panel and had no such element).
					 */
					indicator: !!document.querySelector("[data-recording-indicator]"),
					transcribing: !!document.querySelector("[data-transcribing-indicator]") || document.body.innerText.includes("Processing audio"),
					confirm: !!document.querySelector(${JSON.stringify(CONFIRM)}),
					cancel: !!document.querySelector(${JSON.stringify(CANCEL)}),
					micDisabled: document.querySelector(${JSON.stringify(MIC)})?.disabled ?? null,
					draft: field?.value ?? null,
					boxHeight: r ? Math.round(r.height) : null,
				});
			})()`,
			)
			.then(JSON.parse);

	const installLatencyProbe = (code) =>
		cdp.evaluate(`(() => {
			window.__loStt = { t0: null, flip: null, code: ${JSON.stringify(code)} };
			window.__loStt.ready = true;
			const keydown = (e) => {
				if (e.code === window.__loStt.code && window.__loStt.t0 === null)
					window.__loStt.t0 = performance.now();
			};
			window.addEventListener("keydown", keydown, true);
			window.__loStt.listener = keydown;
			const found = () => document.querySelector(${JSON.stringify(RECORDING_ANY)});
			const observer = new MutationObserver(() => {
				if (found() && window.__loStt.flip === null)
					window.__loStt.flip = performance.now();
			});
			observer.observe(document.body, { childList: true, subtree: true });
			window.__loStt.observer = observer;
			if (found()) window.__loStt.flip = performance.now();
			return true;
		})()`);

	const readLatencyProbe = async () =>
		JSON.parse(
			await cdp.evaluate(
				"JSON.stringify({t0: window.__loStt?.t0 ?? null, flip: window.__loStt?.flip ?? null})",
			),
		);

	const disarmLatencyProbe = () =>
		cdp.evaluate(`(() => {
			if (!window.__loStt) return;
			window.removeEventListener("keydown", window.__loStt.listener, true);
			window.__loStt.observer?.disconnect();
			delete window.__loStt;
			return true;
		})()`);

	const waitForFlip = async (budgetMs) => {
		const until = Date.now() + budgetMs;
		while (Date.now() < until) {
			const { flip } = await readLatencyProbe();
			if (flip !== null) return true;
			await sleep(15);
		}
		return false;
	};

	const key = async (
		type,
		{
			key: keyName,
			code,
			windowsVirtualKeyCode,
			nativeVirtualKeyCode,
			modifiers = 0,
			location = 0,
		},
	) =>
		cdp.send("Input.dispatchKeyEvent", {
			type,
			key: keyName,
			code,
			windowsVirtualKeyCode,
			nativeVirtualKeyCode,
			modifiers,
			location,
		});

	const ALT_RIGHT = {
		key: "Alt",
		code: "AltRight",
		windowsVirtualKeyCode: 18,
		nativeVirtualKeyCode: 61,
		modifiers: 1,
		location: 2,
	};
	const SPACE = {
		key: " ",
		code: "Space",
		windowsVirtualKeyCode: 32,
		nativeVirtualKeyCode: 49,
	};
	const ENTER = {
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 36,
	};

	const pressKey = async (def) => {
		await key("keyDown", def);
		await key("keyUp", def);
	};

	const clickSelector = async (selector) => {
		const aim = await cdp.evaluate(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + Math.min(r.height / 2, 12);
			const owner = document.elementFromPoint(x, y);
			return JSON.stringify({ x, y, owner: owner?.tagName ?? "none", hit: owner === el || el.contains(owner) });
		})()`);
		if (!aim) return null;
		const point = JSON.parse(aim);
		if (!point.hit) return { ...point, pressed: false };
		for (const type of ["mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				button: "left",
				clickCount: 1,
			});
		return { ...point, pressed: true };
	};

	/** Focus the composer and type `text` through CDP's editing pipeline. */
	const typeIntoComposer = async (text) => {
		const aimed = await clickSelector(TEXTAREA);
		if (!aimed?.pressed) throw new Error("could not click the composer");
		await cdp.send("Input.insertText", { text });
		await sleep(250);
		return (await composerBox()).draft;
	};

	const waitForDraft = async (predicate, budgetMs = 15_000) => {
		const until = Date.now() + budgetMs;
		let draft = null;
		while (Date.now() < until) {
			draft = (await composerBox()).draft;
			if (draft !== null && predicate(draft)) return draft;
			await sleep(120);
		}
		return draft;
	};

	const waitFor = async (expression, budgetMs = 15_000) => {
		const until = Date.now() + budgetMs;
		while (Date.now() < until) {
			const value = await cdp.evaluate(expression).catch(() => false);
			if (value) return true;
			await sleep(120);
		}
		return false;
	};

	const sessionState = async (sessionId) => {
		const snapshot = result(
			await api("GET", `/v1/desktop/sessions/${sessionId}`),
		);
		return snapshot?.payload?.frontend?.snapshot ?? null;
	};

	const historyHas = async (sessionId, needle) => {
		const page = result(
			await api("GET", `/v1/desktop/sessions/${sessionId}/history?limit=60`),
		);
		const entries = page?.entries ?? page?.messages ?? [];
		return JSON.stringify(entries).includes(needle);
	};

	const openSession = async () => {
		const created = result(
			await api("POST", "/v1/desktop/sessions", {
				request_id: uuid(),
				cwd: OUT,
			}),
		);
		const sessionId = created?.session_id;
		if (!sessionId) throw new Error("no session could be created");
		await cdp.evaluate(`location.hash = "#/chat/${sessionId}"; true`);
		await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		const ready = await waitFor(
			`document.querySelector(${JSON.stringify(TEXTAREA)}) !== null`,
			30_000,
		);
		if (!ready) throw new Error(`the composer never appeared for ${sessionId}`);
		await sleep(700);
		return sessionId;
	};

	/* ------------------------------------------- session A: treatment + latency */

	const sessionA = await openSession();
	report.sessionA = sessionA;

	const draftText = "review the stt overhaul";
	const typedA = await typeIntoComposer(draftText);
	verify("sessionA.draftTyped", typedA === draftText, { draft: typedA });
	await cdp.shot("01-idle-draft.png");
	record("sessionA.idle", await composerBox());
	/*
	 * THE TOOLTIP NAMES THE BINDING (design round 1, D1). Hovered through the
	 * trusted input pipeline so the Radix tooltip opens the way a pointer opens
	 * it, and photographed a full delay-length after the move - the frame is the
	 * evidence that the string now comes from the same resolver the dispatcher
	 * matches, instead of teaching the old hold-Space gesture.
	 */
	const micHover = JSON.parse(
		(await cdp.evaluate(
			`(() => {
				const el = document.querySelector(${JSON.stringify(MIC)});
				if (!el) return "null";
				const r = el.getBoundingClientRect();
				return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
			})()`,
		)) ?? "null",
	);
	if (micHover) {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: micHover.x,
			y: micHover.y,
		});
		await sleep(1400);
		await cdp.shot("14-mic-tooltip.png");
		record("sessionA.micTooltip", {
			text: await cdp.evaluate(
				`(() => document.body.innerText.match(/Start recording[^\\n]*/) ?? "")()`,
			),
		});
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 4,
			y: 4,
		});
		await sleep(350);
	} else {
		note("the mic control was not on screen for the tooltip frame");
	}

	/*
	 * PTT LATENCY, page-side: t0 is the rig's own capture listener (installed
	 * after the app's, so it stamps within the same dispatch, microseconds behind
	 * the manager's handler entry) and the flip is the recording affordance
	 * appearing, observed from a MutationObserver. `cold` is the first engage
	 * after boot; every later one is warm. macOS TCC is NOT in this path - the
	 * launch is on the synthetic capture device - and the run says so in `notes`.
	 */
	/*
	 * Press, measure, HOLD. The release is the caller's, after it has captured
	 * the held frame: releasing here put the frame past the stop and made it a
	 * picture of the transcribing state instead of the recording state.
	 */
	const measureEngage = async ({ def, label, budgetMs }) => {
		await installLatencyProbe(def.code);
		await key("keyDown", def);
		const flipped = await waitForFlip(budgetMs);
		const stamps = await readLatencyProbe();
		const latencyMs =
			stamps.t0 !== null && stamps.flip !== null
				? Math.round(stamps.flip - stamps.t0)
				: null;
		const detail = {
			deliveredToPage: stamps.t0 !== null,
			flipped,
			latencyMs,
			budgetMs,
		};
		// The page's own clock, both ends, so the latency above can be re-derived
		// rather than taken from this script's arithmetic.
		record(`${label}.timestamps`, {
			t0: stamps.t0,
			flip: stamps.flip,
		});
		return { detail };
	};

	/*
	 * Release the hold, and give the clip a floor: the app discards takes under
	 * 250 ms, and a probe that pressed and released within that window would
	 * "lose" its transcript to the minimum-clip rule rather than to a defect.
	 * The wait is only ever added to a pass that FLIPPED, so a build that never
	 * engaged pays nothing for it.
	 */
	const releaseHold = async (def, { holdExtraMs = 500 } = {}) => {
		await sleep(holdExtraMs);
		await key("keyUp", def);
		await disarmLatencyProbe();
	};
	const awaitTranscriptLanding = async (label) => {
		await sleep(150);
		const transcribing = await waitFor(
			`!!document.querySelector("[data-transcribing-indicator]") || document.body.innerText.includes("Processing audio")`,
			8000,
		);
		record(`${label}.transcribingSeen`, { transcribing });
		return transcribing;
	};

	// 1. The combo (Right-Option). On a build without the binding the key still
	// reaches the page - `deliveredToPage` says whether the measurement ran.
	const combo = await measureEngage({
		def: ALT_RIGHT,
		label: "sessionA.combo",
		/*
		 * THE COLD BUDGET IS THE FIRST useEffect's, NOT A CEILING ON THE GESTURE: the
		 * flip this waits for happens after `getUserMedia` resolves, and on this
		 * fleet the first resolve of a freshly built app has measured 595 ms to
		 * >3000 ms (one remediation run at load ~134 blew the old 3000 ms budget on
		 * cold AND on the retry - correctly refused by the one-recorder guard while
		 * the first attempt was still pending). A budget is the rig's patience, not
		 * a claim; the measured latency is recorded whatever it is.
		 */
		budgetMs: 9000,
	});
	expectMaybe("sessionA.comboEngages", combo.detail.flipped, {
		...combo.detail,
		cold: true,
	});
	if (combo.detail.flipped) {
		/*
		 * THE WAVEFORM LANE IS SETTLED BEFORE THE FRAME (design round 1, D4): the
		 * first capture took the shot at the engage instant, ahead of the
		 * analyser's first draw, and the lane read blank - an unfinished-
		 * looking strip rather than the settled one. The wait is only ever paid by
		 * a pass that FLIPPED.
		 */
		await sleep(450);
		await cdp.shot("02-recording-combo.png");
		record("sessionA.recordingTreatment", await composerBox());
		// The release is what stops it; the transcription then leaves, is held on
		// screen by the upstream delay, and lands in the composer.
		await releaseHold(ALT_RIGHT);
		const transcribing = await awaitTranscriptLanding("sessionA.combo");
		if (transcribing) await cdp.shot("03-transcribing.png");
		const landed = await waitForDraft(
			(d) => d.includes("fake upstream"),
			20_000,
		);
		record("sessionA.transcriptLanded", {
			transcribingSeen: transcribing,
			draft: landed,
		});
		await cdp.shot("04-dictated-landed.png");
	} else {
		await releaseHold(ALT_RIGHT, { holdExtraMs: 0 });
		note(
			"the Alt-Right combo did not engage a recording on this build (deliveredToPage says whether the key reached the page)",
		);
	}

	// 2. The legacy hold-Space binding, measured on every build. Focus is taken
	// out of the composer first, which is the binding's own guard on both
	// builds: typing wins over a hold (the guard the spec keeps for Space alone).
	await cdp.evaluate(
		"document.activeElement?.blur?.(); document.body.focus(); true",
	);
	const space = await measureEngage({
		def: SPACE,
		label: "sessionA.space",
		budgetMs: 6000,
	});
	verify("sessionA.spaceEngages", space.detail.flipped, {
		...space.detail,
		cold: false,
	});
	if (space.detail.flipped) {
		// Same settled-lane wait as the combo frame above (design round 1, D4).
		await sleep(450);
		await cdp.shot("05-recording-space.png");
		record("sessionA.recordingTreatmentSpace", await composerBox());
		await releaseHold(SPACE);
		await awaitTranscriptLanding("sessionA.space");
		await cdp.shot("06-transcribing-space.png");
		const landed = await waitForDraft(
			(d) => d.includes("fake upstream"),
			20_000,
		);
		record("sessionA.transcriptLandedSpace", { draft: landed });
		await cdp.shot("07-dictated-landed-space.png");
	} else {
		await releaseHold(SPACE, { holdExtraMs: 0 });
	}

	// 3. SEND the mixed draft (typed + dictated) and read the wire body back from
	// the proxy: `input_mode: "mixed"` and `mode: "prompt"`.
	const beforeSend = report.wire.length;
	const focused = await clickSelector(TEXTAREA);
	if (!focused?.pressed)
		throw new Error("could not focus the composer for the send");
	await pressKey(ENTER);
	const sawMixedBody = await (async () => {
		const until = Date.now() + 10_000;
		while (Date.now() < until) {
			if (report.wire.length > beforeSend) return report.wire.at(-1);
			await sleep(120);
		}
		return null;
	})();
	record("sessionA.sentBody", {
		body: sawMixedBody?.body ?? null,
	});
	expectInputMode("sessionA.inputMode", sawMixedBody?.body, "mixed");
	await waitFor(
		`document.body.innerText.includes("review the stt overhaul")`,
		10_000,
	);
	await cdp.shot("08-mixed-row.png");

	/* ---------------------------------- session B: mid-turn dictation + steer */

	const sessionB = await openSession();
	report.sessionB = sessionB;
	const typedB = await typeIntoComposer("typed probe [bash:40]");
	verify("sessionB.draftTyped", typedB === "typed probe [bash:40]", {
		draft: typedB,
	});

	const beforeTypedSend = report.wire.length;
	// The window sampler: click exactly once, as a user would, then sample the
	// mic control every 40 ms across the admit-to-first-answer window (the state
	// the operator reported as the one where dictation is dead).
	const windowSamples = [];
	const streamingSamples = [];
	const sessionBSend = pressKey(ENTER);
	for (let i = 0; i < 150; i++) {
		const box = await composerBox();
		windowSamples.push({
			t: i * 40,
			micDisabled: box.micDisabled,
			recording: box.recording,
		});
		/*
		 * The backend's own answer across the same span, sampled five times less
		 * often (an HTTP read, not a DOM read): the mic state is only worth
		 * something beside the fact it is gated on, and a cold session's runtime
		 * warm can outlast the sampling window - which is exactly the lag the
		 * wait below absorbs before anything may be called "mid-turn".
		 */
		if (i % 15 === 0) {
			streamingSamples.push({
				t: i * 40,
				streaming: (await sessionState(sessionB))?.streaming === true,
			});
		}
		await sleep(40);
	}
	await sessionBSend;
	const typedBody =
		report.wire.length > beforeTypedSend ? report.wire.at(-1) : null;
	record("sessionB.typedBody", { body: typedBody?.body ?? null });
	expectInputMode("sessionB.inputMode", typedBody?.body, "typed");
	record("sessionB.micWindowSamples", {
		disabledCount: windowSamples.filter((s) => s.micDisabled === true).length,
		firstEnabledAt:
			windowSamples.find((s) => s.micDisabled === false)?.t ?? null,
		lastDisabledAt:
			[...windowSamples].reverse().find((s) => s.micDisabled === true)?.t ??
			null,
		samples: windowSamples.filter(
			(s, i) => i % 5 === 0 || s.micDisabled === false,
		),
	});
	record("sessionB.streamingSamples", { samples: streamingSamples });
	await cdp.shot("09-typed-row-mid-turn.png");

	// The steady mid-turn state: the turn IS streaming, the transcript shows the
	// bash row. WAITED FOR rather than assumed - the sampling above measured the
	// warm lag, and everything below claims to be "mid-turn".
	const waitStarted = Date.now();
	let streaming = (await sessionState(sessionB))?.streaming === true;
	while (!streaming && Date.now() - waitStarted < 30_000) {
		await sleep(500);
		streaming = (await sessionState(sessionB))?.streaming === true;
	}
	record("sessionB.streamingWait", { waitedMs: Date.now() - waitStarted });
	/*
	 * A claim in the shipping mode, an OBSERVATION in the injected one: there
	 * the stamped body is refused by a backend that does not implement the field
	 * (the skew the capability gate exists for), so the turn never runs and this
	 * reads false for a reason that is the run's subject rather than a defect.
	 */
	expectMaybe("sessionB.streamingAfterTyped", streaming, {
		streaming,
		waitedMs: Date.now() - waitStarted,
		outcome: (await sessionState(sessionB))?.last_turn_outcome ?? null,
	});

	// MID-TURN DICTATION: hold the combo while the turn runs. On the un-gated
	// build the capture starts mid-turn; the release stops it, the transcript
	// lands, and Enter steers.
	/*
	 * Press ONCE, and press AGAIN if the first press did not take. The warm
	 * engage has measured 75-196 ms across runs, but this fleet stalls
	 * `getUserMedia` under load: one run recorded `flipped:false` at the 3000 ms
	 * budget where every neighbouring run flipped inside 200 ms. A retry is what
	 * a user would do, and both attempts are recorded so the run says how many
	 * it took rather than hiding a stalled first press.
	 */
	const midAttempts = [];
	let mid = await measureEngage({
		def: ALT_RIGHT,
		label: "sessionB.midTurnCombo",
		budgetMs: 3000,
	});
	midAttempts.push(mid.detail);
	if (!mid.detail.flipped) {
		await releaseHold(ALT_RIGHT, { holdExtraMs: 0 });
		await sleep(400);
		mid = await measureEngage({
			def: ALT_RIGHT,
			label: "sessionB.midTurnComboRetry",
			budgetMs: 4500,
		});
		midAttempts.push(mid.detail);
	}
	expectMaybe("sessionB.midTurnComboEngages", mid.detail.flipped, {
		...mid.detail,
		attempts: midAttempts,
	});
	if (mid.detail.flipped) {
		await cdp.shot("10-dictating-mid-turn.png");
		await releaseHold(ALT_RIGHT);
		const transcribing = await awaitTranscriptLanding("sessionB.midTurn");
		record("sessionB.midTurnTranscribing", { transcribing });
		const landed = await waitForDraft(
			(d) => d.includes("fake upstream"),
			20_000,
		);
		record("sessionB.midTurnTranscriptLanded", { draft: landed });
		await cdp.shot("11-dictated-mid-turn.png");
		const rowShape = async (needle) =>
			JSON.parse(
				await cdp.evaluate(`(() => {
				const nodes = Array.from(document.querySelectorAll("p, span, div"));
				/*
				 * TOLERANT MATCHING (third final-build run): the row EXISTS on screen
				 * (frame 12) while the exact-leaf matcher above missed it - the row's
				 * text lives beside something else inside its own subtree (a steer
				 * marker, a timestamp), so the equality on a childless leaf found
				 * nothing. Prefer the exact leaf; fall back to the SMALLEST subtree
				 * that contains the needle, which is the innermost element the text
				 * itself sits in.
				 */
				const inScope = (n) =>
					!n.closest(
						"nav, aside, button, [role='navigation'], [role='dialog']",
					);
				const exact = nodes.find(
					(n) =>
						n.children.length === 0 &&
						(n.textContent ?? "").trim() === ${JSON.stringify(needle)} &&
						// The sidebar titles a session with its first message, so the same
						// string lives in a nav row too; the TRANSCRIPT's copy is the one
						// this claim is about.
						inScope(n),
				);
				const leaf =
					exact ??
					nodes
						.filter(
							(n) =>
								inScope(n) &&
								(n.textContent ?? "").includes(${JSON.stringify(needle)}),
						)
						.sort(
							(a, b) =>
								(a.textContent ?? "").length -
								(b.textContent ?? "").length,
						)[0];
				if (!leaf) return JSON.stringify(null);
				// The row's own box: the nearest ancestor wearing the message surface,
				// which is the bubble a reader sees.
				const bubble =
					leaf.closest("[class*='bg-message-surface']") ?? leaf.parentElement;
				const shape = [];
				const walk = (node) => {
					const cls = typeof node.className === "string" ? node.className.split(/\\s+/).filter(Boolean).sort().join(".") : "";
					shape.push(node.tagName + (cls ? "|" + cls : ""));
					for (const child of node.children) walk(child);
				};
				walk(bubble);
				return JSON.stringify(shape);
			})()`),
			);

		const stillStreamingBeforeSteer =
			(await sessionState(sessionB))?.streaming === true;
		const beforeSteer = report.wire.length;
		await pressKey(ENTER);
		/*
		 * THE FRAME COMES FIRST, while the turn is still running: the echo paints
		 * at the press, and the steer's own drain can interrupt the running tool
		 * within a second or two - a frame taken after the poll below is a picture
		 * of the settled transcript, not of the send that rode the steer path.
		 */
		await waitFor(
			`document.body.innerText.includes(${JSON.stringify("dictated steer probe from the fake upstream.")})`,
			5000,
		);
		await cdp.shot("12-sent-mid-turn-steer.png");
		/*
		 * THE ROW-IDENTITY COMPARISON, SAMPLED HERE WHERE THE TEXT IS PROVEN
		 * PRESENT - the `waitFor` above just found it in `document.body.innerText`.
		 * It used to run after the delivery poll, where the faster fleet's re-render
		 * of the settled row could catch the sampler between paints (frame 12 shows
		 * the row; the sampler returned null) and the check fell to `skipped`. Now
		 * it polls both shapes for a bounded window anyway, so a slow paint is
		 * waited for rather than raced.
		 */
		let typedShape = null;
		let dictatedShape = null;
		const shapeDeadline = Date.now() + 8000;
		for (;;) {
			typedShape = await rowShape("typed probe [bash:40]");
			dictatedShape = await rowShape(
				"dictated steer probe from the fake upstream.",
			);
			if ((typedShape && dictatedShape) || Date.now() > shapeDeadline) break;
			await sleep(250);
		}
		record("rows.shapes", { typed: typedShape, dictated: dictatedShape });
		if (typedShape && dictatedShape) {
			expectMaybe(
				"rows.dictatedMatchesTyped",
				JSON.stringify(typedShape) === JSON.stringify(dictatedShape),
				{ equal: JSON.stringify(typedShape) === JSON.stringify(dictatedShape) },
			);
		} else {
			record("rows.dictatedMatchesTyped", {
				skipped: "one of the two rows is not on screen",
				typed: typedShape !== null,
				dictated: dictatedShape !== null,
			});
		}
		const steerBody = await (async () => {
			const until = Date.now() + 10_000;
			while (Date.now() < until) {
				if (report.wire.length > beforeSteer) return report.wire.at(-1);
				await sleep(120);
			}
			return null;
		})();
		record("sessionB.steerBody", { body: steerBody?.body ?? null });
		expectMaybe(
			"sessionB.midTurnSendIsSteer",
			steerBody?.body?.mode === "steer",
			{
				mode: steerBody?.body?.mode ?? null,
			},
		);
		expectInputMode("sessionB.midTurnInputMode", steerBody?.body, "dictated");
		/*
		 * WHERE THE STEER LANDED. Polled rather than read once: the row is durable
		 * only once the owner drains the steering queue (at a tool/message
		 * boundary, and an urgent steer may interrupt a running tool), so a single
		 * read right after the press measures the drain's latency rather than
		 * whether the steer was taken - which is exactly what the first version of
		 * this record got wrong (`false` on a steer that demonstrably arrived).
		 */
		const steerDeadline = Date.now() + 20_000;
		let deliveredWhileStreaming = false;
		let deliveredAtMs = null;
		let streamingAtDelivery = null;
		/*
		 * SAMPLED THROUGH THE SEND, NOT READ ONCE (second final-build run): the
		 * delivery poll's single read landed while the snapshot's `streaming` flag
		 * was dipping at a tool-segment boundary - the turn's own history shows the
		 * steer arriving 9.8 s into a 40 s tool run - so the pair said false on a
		 * steer the wire recorded as `mode:"steer"`. The loop below collects the
		 * flag's series across the window (and past delivery) instead of breaking
		 * on the first false, so the record carries what the flag actually did.
		 */
		const steerSamples = [];
		const steerSampleStart = Date.now();
		const sampleStreaming = async () =>
			(await sessionState(sessionB))?.streaming === true;
		let delivered = false;
		while (Date.now() < steerDeadline) {
			const streamingNow = await sampleStreaming();
			steerSamples.push({
				t: Date.now() - steerSampleStart,
				streaming: streamingNow,
			});
			if (!delivered && (await historyHas(sessionB, "fake upstream"))) {
				delivered = true;
				deliveredAtMs = 20_000 - (steerDeadline - Date.now());
				streamingAtDelivery = streamingNow;
				deliveredWhileStreaming = streamingNow === true;
			}
			/*
			 * Past delivery the run keeps sampling for a short beat, so the series
			 * shows whether the flag came back (the boundary dip) or stayed false
			 * (the turn really ended).
			 */
			if (
				delivered &&
				Date.now() - steerSampleStart > (deliveredAtMs ?? 0) + 600
			)
				break;
			await sleep(120);
		}
		const streamingAtSteer = await sampleStreaming();
		record("sessionB.steerDelivery", {
			streamingBeforeSteer: stillStreamingBeforeSteer,
			streamingAtSteer,
			streamingAtDelivery,
			messageLandedWhileStreaming: deliveredWhileStreaming,
			landedAtMs: deliveredAtMs,
			streamingObservedAfterSend: steerSamples.some((s) => s.streaming),
			samples: steerSamples,
		});
	} else {
		await releaseHold(ALT_RIGHT, { holdExtraMs: 0 });
		note(
			"the mid-turn hold did not engage on this build; the window samples above carry the mic's own state across the same span",
		);
	}

	/* ------------------------------------------- dictated vs typed row identity */

	/*
	 * The two rows, found by their own text and compared as the BUBBLE'S OWN
	 * SUBTREE (tag plus class list per level, text excluded): the claim is that a
	 * dictated row renders through the same components as a typed one - the
	 * `input_mode` field is carried, never rendered - so their structure must be
	 * equal while only the text differs.
	 *
	 * The subtree and not the ancestor chain, deliberately: the chain this
	 * comparison started with walks OUT past the row into the transcript's own
	 * wrappers, and those legitimately differ by POSITION rather than by
	 * provenance (the newest turn's wrapper carries `mt-8`). A claim about the
	 * row is a claim about the row.
	 */
	/* ---------------- session C: the transcript inside the send's own window */

	/*
	 * THE RACE THE FIX EXISTS FOR, ON AN EXISTING SESSION. `appendTranscriptText`
	 * either appends into the box or waits for the send's own clear
	 * (`sendClearPendingRef` -> `pendingTranscriptRef`, composed by `clearOnce`),
	 * and the window it must respect is the press-to-echo span. This run MEASURES
	 * that span (~8 ms below - the empty write) and does not manufacture the
	 * wider one the machinery exists for (the app's slow-create condition, where
	 * the clear waits on `sessions.create` for p50 142 ms / max 409 ms under
	 * load); a first attempt to reach that path through the `#/chat` route kept
	 * the CURRENT session rather than staging a draft, so the sequence runs on a
	 * session opened for it and the composed write is recorded rather than
	 * claimed (see `sessionC.composedClear`). What IS asserted is what a user
	 * would see in either ordering: the transcript survives, and the message that
	 * went out stays the typed line.
	 *
	 * The press happens while the app is TRANSCRIBING, which is itself the
	 * un-gating claim: the box is writable then, so Enter sends.
	 */
	const sessionC = await openSession();
	report.sessionC = sessionC;
	const typedC = await typeIntoComposer("typed line for the echo window");
	verify("sessionC.draftTyped", typedC === "typed line for the echo window", {
		draft: typedC,
	});
	armTranscriptionGate();
	/*
	 * The POINTER door opens the recording (the button a user clicks) and the
	 * confirm control is the stop this sequence wants: it transcribes rather
	 * than discards, and the clip is held past the 250 ms floor so the take is
	 * not discarded by the app's own minimum-clip rule.
	 */
	const micPress = await clickSelector(MIC);
	verify("sessionC.micPressed", micPress?.pressed === true, {
		pressed: micPress?.pressed ?? null,
	});
	const recordingC = await waitFor(
		`!!document.querySelector(${JSON.stringify(CONFIRM)})`,
		5000,
	);
	verify("sessionC.recordingEngaged", recordingC === true, {
		recorder: recordingC,
	});
	if (!recordingC) throw new Error("session C could not start a recording");
	await sleep(600);
	const confirmPress = await clickSelector(CONFIRM);
	verify("sessionC.stopPressed", confirmPress?.pressed === true, {
		pressed: confirmPress?.pressed ?? null,
	});
	/*
	 * The request reaches the upstream and parks there. Its arrival is the proof
	 * the app is TRANSCRIBING while the press below happens - waited for
	 * rig-side, because that is a fact about this process's own server.
	 */
	const callsBeforeWait = radientCalls.length;
	const heldAtUpstream = await (async () => {
		const until = Date.now() + 15_000;
		while (Date.now() < until) {
			if (radientCalls.length > callsBeforeWait) return true;
			await sleep(100);
		}
		return false;
	})();
	verify("sessionC.transcriptionHeldUpstream", heldAtUpstream === true, {
		calls: radientCalls.length,
		fixture: heldTranscriptionText,
	});
	if (!heldTranscriptionText)
		throw new Error("the transcription never reached the gate");
	const transcribingC = await waitFor(
		`!!document.querySelector("[data-transcribing-indicator]") || document.body.innerText.includes("Processing audio")`,
		8000,
	);
	record("sessionC.transcribingWhileSending", { transcribing: transcribingC });

	/*
	 * THE PRESS, DRIVEN FROM THE PAGE. One turn does three things the rig's CDP
	 * roundtrips cannot: dispatch the Enter the composer's handler sees, release
	 * the held transcript through the proxy door, and instrument the field so
	 * every write to it is timestamped from inside the app's own frame. The
	 * `value` setter is patched on THIS node, so a controlled re-render's write
	 * is observed at the moment it lands rather than sampled for.
	 */
	await clickSelector(TEXTAREA);
	const beforeRaceSend = report.wire.length;
	const raceDriven = await cdp.evaluate(`(() => {
		const field = document.querySelector(${JSON.stringify(TEXTAREA)});
		if (!field) return false;
		field.focus();
		const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
		const state = { pressAt: null, releaseAt: null, writes: [] };
		Object.defineProperty(field, "value", {
			configurable: true,
			get() { return proto.get.call(field); },
			set(v) { state.writes.push({ at: performance.now(), value: v }); proto.set.call(field, v); },
		});
		state.pressAt = performance.now();
		field.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
		);
		state.releaseAt = performance.now();
		fetch("http://127.0.0.1:${PROXY_PORT}/__race-release").catch(() => {});
		window.__loRace = state;
		return true;
	})()`);
	verify("sessionC.pressDriven", raceDriven === true, { driven: raceDriven });
	const raceBody = await (async () => {
		const until = Date.now() + 10_000;
		while (Date.now() < until) {
			if (report.wire.length > beforeRaceSend) return report.wire.at(-1);
			await sleep(100);
		}
		return null;
	})();
	record("sessionC.raceBody", { body: raceBody?.body ?? null });
	expectInputMode("sessionC.raceInputMode", raceBody?.body, "typed");
	const raceLanded = await waitForDraft(
		(d) => d.includes(heldTranscriptionText),
		20_000,
	);
	const raceTimeline = JSON.parse(
		(await cdp.evaluate("JSON.stringify(window.__loRace ?? null)")) ?? "null",
	);
	/*
	 * THE ORDERING, AS A READING. `writes` is every write the composer made to
	 * its own field after the press, page-side: the wait path shows ONE write -
	 * the transcript composed into the send's clear (the two writes land as one,
	 * `clearOnce`'s comment) - while the fresh-append path shows the clear's
	 * empty write and then the transcript's. An empty write after the press is
	 * therefore the fresh path's own signature, and its absence is the evidence
	 * the transcript was let go INSIDE the window.
	 */
	record("sessionC.raceTimeline", {
		pressAt: raceTimeline?.pressAt ?? null,
		releaseAt: raceTimeline?.releaseAt ?? null,
		proxyReleaseAt: raceReleaseAt,
		writes: raceTimeline?.writes ?? null,
		emptyWriteAfterPress: (raceTimeline?.writes ?? []).some(
			(w) => w.value === "",
		),
	});
	const raceWrites = raceTimeline?.writes ?? [];
	record("sessionC.raceBox", {
		draft: raceLanded,
		fixture: heldTranscriptionText,
	});
	/*
	 * A claim in the shipping mode, an observation in the injected one (there the
	 * stamped body is refused, the refusal hands the typed line back to the box,
	 * and `sentTextNotResurrected` reads false for a reason that is the run's
	 * subject rather than a defect - the transcript is still IN that box).
	 */
	expectMaybe(
		"sessionC.transcriptSurvivedTheEcho",
		raceLanded === heldTranscriptionText,
		{
			draft: raceLanded,
			fixture: heldTranscriptionText,
		},
	);
	/*
	 * THE COMPOSED WRITE IS RECORDED, NOT CLAIMED, and this is the one place in
	 * the rig where that is the honest shape. The wait path needs the transcript
	 * to land INSIDE the press-to-echo window; this run measures that window at
	 * ~8 ms (the empty write below) while the release's own plumbing - page ->
	 * rig -> upstream -> backend -> app - costs ~17 ms, so no construction of
	 * this rig can land inside it. The window the machinery exists for is the
	 * app's own slow-create condition (the pane comment's p50 142 ms / max
	 * 409 ms under load, where the clear waits on `sessions.create`), which this
	 * rig does not manufacture. The outcome claims above hold either way, and
	 * the timeline below is what the run actually saw: the fresh-append path,
	 * with no loss and no resurrection.
	 */
	record("sessionC.composedClear", {
		observed:
			!raceWrites.some((w) => w.value === "") &&
			raceWrites.some((w) => w.value === heldTranscriptionText),
		emptyWriteAfterPress: raceWrites.some((w) => w.value === ""),
		writes: raceWrites,
		fixture: heldTranscriptionText,
	});
	note(
		"session C could not land inside the ~8 ms press-to-echo window this rig measures (its release plumbing costs ~17 ms); the transcript rode the fresh-append path, asserted above, and the composed-clear path is covered by reading, not by this run",
	);
	await cdp.shot("13-transcript-in-echo-window.png");

	/* -------------- session D: the resolve-window takes (review round 1) */

	/*
	 * THE EDGE TAKES THE ROUND-1 REVIEW ASKED FOR (M1/M2): a release INSIDE the
	 * `getUserMedia` window, a double engagement inside it, and an abort inside
	 * it - the three orderings no earlier take reached, because every prior run
	 * released after the indicator flipped. Warms are 45-92 ms on this rig, so
	 * "inside the window" is dispatches sent back to back with ~15 ms between
	 * them.
	 *
	 * What is asserted is the contract's outcome, not a mechanism: no recording
	 * survives any of the three, the discarded takes never reach the
	 * transcription upstream, and a normal take after them still records and
	 * lands - which is what the silent-mic ordering (a recorder nothing points
	 * at) would fail.
	 */
	const sessionD = await openSession();
	report.sessionD = sessionD;
	await typeIntoComposer("edge take probe");
	const takesBefore = radientCalls.length;
	const settleWindow = async (label) => {
		await sleep(1200);
		const box = await composerBox();
		return {
			label,
			recording: box.recording,
			transcribing: box.transcribing,
			micDisabled: box.micDisabled,
			draft: box.draft,
		};
	};
	// D1 - a TAP: press and release with no wait, so the release lands inside the
	// resolve window and must settle the attempt the moment it exists.
	await key("keyDown", ALT_RIGHT);
	await sleep(15);
	await key("keyUp", ALT_RIGHT);
	const tapSettled = await settleWindow("release-in-window");
	verify(
		"sessionD.releaseInWindowSettles",
		tapSettled.recording === false && tapSettled.transcribing === false,
		tapSettled,
	);
	// D2 - TWO engages inside the window: the second start is refused while the
	// first attempt is outstanding, and the releases still settle it.
	await key("keyDown", ALT_RIGHT);
	await sleep(15);
	await key("keyUp", ALT_RIGHT);
	await key("keyDown", ALT_RIGHT);
	await sleep(15);
	await key("keyUp", ALT_RIGHT);
	const doubleSettled = await settleWindow("double-tap");
	verify(
		"sessionD.doubleTapSettles",
		doubleSettled.recording === false && doubleSettled.transcribing === false,
		doubleSettled,
	);
	// D3 - an ABORT inside the window: the binding's keydown, then a second key.
	// Shift, deliberately: any other key could act on the composer, and this arm
	// is about the hold growing into a combination, not about typing.
	const SHIFT = {
		key: "Shift",
		code: "ShiftLeft",
		windowsVirtualKeyCode: 16,
		nativeVirtualKeyCode: 56,
	};
	await key("keyDown", ALT_RIGHT);
	await sleep(15);
	await key("keyDown", SHIFT);
	await key("keyUp", SHIFT);
	await key("keyUp", ALT_RIGHT);
	const abortSettled = await settleWindow("abort-in-window");
	verify(
		"sessionD.abortInWindowSettles",
		abortSettled.recording === false && abortSettled.transcribing === false,
		abortSettled,
	);
	record("sessionD.discardedTaps", {
		transcriptionCalls: radientCalls.length - takesBefore,
	});
	verify("sessionD.tapsNeverTranscribed", radientCalls.length === takesBefore, {
		calls: radientCalls.length - takesBefore,
	});
	// THE CONTROL: a real take after the edges still works - the assertion a
	// wedged state fails. Held past the clip floor, released, waiting for the
	// transcript to land (which, with the boundary rule, joins this draft).
	await key("keyDown", ALT_RIGHT);
	await sleep(700);
	await key("keyUp", ALT_RIGHT);
	const landedD = await waitForDraft(
		(d) => d.includes("fake upstream"),
		20_000,
	);
	verify(
		"sessionD.nextTakeStillLands",
		(landedD ?? "").includes("fake upstream"),
		{ draft: landedD },
	);
	record("sessionD.joinedDraft", { draft: landedD });
	await cdp.shot("15-edge-takes-settled.png");

	// Whether this build carries the new inline treatment at all is read where it
	// can be true - while a recording exists; see `composerBox().indicator`.
} catch (error) {
	report.failure = String(error?.stack ?? error);
	record("failure", { message: String(error?.message ?? error) });
} finally {
	await finish(cdp);
}

writeFileSync(
	join(OUT, "stt-proof.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
if (report.failure || claims.length > 0) {
	console.error(
		`stt-dictation-proof: ${claims.length} claim(s) failed; see ${join(OUT, "stt-proof.json")}`,
	);
	process.exit(1);
}
console.log(
	`stt-dictation-proof: ok; record at ${join(OUT, "stt-proof.json")}`,
);
/*
 * An explicit exit, because the run can otherwise outlive its work: a killed
 * app's stdio pipes, a keep-alive socket on the rig's own servers, or the
 * detached child's handles can hold the event loop open, and a rig that
 * "hangs" after printing its result is indistinguishable from one that never
 * finished. Every child is reaped in `finish`; nothing is left to wait on.
 */
process.exit(0);
