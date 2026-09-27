#!/usr/bin/env node
/**
 * Measure the Mesh canvas under a scripted twenty seconds of interaction.
 *
 *     node scripts/mesh-canvas-bench.mjs                     # the 5-device scene
 *     node scripts/mesh-canvas-bench.mjs --scene=n20 --size=1024x768
 *     node scripts/mesh-canvas-bench.mjs --breach=layout-read   # the self-check
 *
 * WHAT THIS IS FOR, and what it is not. The plan's pass bar is three numbers -
 * p95 frame time during pan/zoom, the worst frame during a drag, and
 * pointer-to-visual latency - and this is the command that produces them. **The bar
 * is a TARGET (RAIL/INP), not a measurement of this app**: nothing in this repository
 * has ever measured the Mesh canvas before this file existed, so there is no
 * baseline to compare against and a run that passes is a run that is inside a
 * published budget, not a run that is fast for its own sake. The comparison that
 * DOES exist is in the same run: the same scripted interaction against the VIEWER
 * theme with the canvas replaced by the list view, which separates the canvas's cost
 * from the data's.
 *
 * IT DRIVES THE SHIPPED APP. `pnpm build`, then the built bundle in Electron, headless
 * over CDP - not a Vite page and not Storybook, because the cost this measures is the
 * cost of the thing that ships (the same reason `capture-evidence.mjs` photographs
 * the real preview rather than a mock). The mesh itself is SYNTHETIC and injected
 * through the daemon the app dials: a stub answers the desktop plane's routes from
 * generated fixtures, so S=20 and forty-sessions-per-device are reachable with no
 * second machine, no second install and no network. The app, the canvas, the drag and
 * the React tree are the real ones; only the wire is a fixture.
 *
 * THE THREE INSTRUMENTS, and why they are three rather than one:
 *
 *   1. **`long-animation-frame`** (a `PerformanceObserver`) gives frame time and the
 *      worst frame's BLOCKING duration. This is the browser's own verdict on the
 *      frame, not a stopwatch around a callback, so a frame that was late because of
 *      a style recalc or a long task is charged to the frame either way.
 *   2. **pointer-to-visual latency** is measured from the `pointermove`'s own
 *      timestamp to the next frame that actually painted the new transform (two
 *      `requestAnimationFrame` callbacks, the second of which is after the commit).
 *      It is the number the input contract cares about and it cannot be derived from
 *      frame time.
 *   3. **THE STRUCTURAL INVARIANTS**, which can fail where a timing number cannot:
 *      a deep-equal poll causes ZERO DOM mutation; the DOM node count stays bounded
 *      by `devices × constant + networks`; and a pan writes the transform ONCE per
 *      animation frame. These are properties, not timings, and they are the ones that
 *      should gate a change - the backend's own rule is to prefer a structural
 *      invariant to a numeric one.
 *
 * WHY A BREACH CAN BE INJECTED (`--breach=`), AND WHAT EACH ONE MEASURABLY DID. An
 * instrument that cannot report a breach is an instrument nobody has seen work, and
 * this fleet has already lost a round to a guard that could not fail. Measured on this
 * host, 2026-09-27, scene `s5`:
 *
 *   - `--breach=double-write` (a second write to the world layer's style per frame)
 *     FAILS the one-write-per-input-event invariant: 333 writes over 146 dispatched
 *     moves, against 157 writes over 158 moves clean. The run exits 1.
 *   - `--breach=busy-frame` (40 ms burned per 100 ms) moves pointer-to-visual p95 from
 *     17.4 ms to 52 ms - a three-fold move that still sits UNDER the 100 ms bar, which
 *     is worth knowing before anyone reads a passing latency number as headroom.
 *   - `--breach=layout-read` (a forced synchronous layout per move) did NOT move any of
 *     the three numbers: 10.1 ms / 0 ms / 17.6 ms against a clean 10.1 / 0 / 17.4. It is
 *     kept as a NEGATIVE CONTROL - a transform write is composited and has no layout to
 *     force - because a bench whose every fault moved every number would not be
 *     evidence that the numbers mean anything.
 *
 * EVERY RUN THAT STOPS EARLY IS A FAILURE, not a quiet pass: the scripted seconds
 * and the number of frames are asserted against the plan before anything is
 * reported, because "0 frames" would otherwise render as a beautiful p95.
 *
 * SCRATCH, ADMISSION AND REAPING: the profile, the scratch config root and the
 * daemon's records live under `$LOCAL_OPERATOR_SCRATCHPAD` (never `/tmp`, which this
 * fleet shares between sessions and which macOS reaps under a live run), the daemon
 * binds loopback on an ephemeral port, and the Electron tree is killed by EXACT PID
 * on every exit path - including a signal - so a bench that throws leaves no window
 * and no process behind.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/** The one route the bench lets the app WRITE to, hoisted so the pattern is compiled
 * once rather than per request (`eslint`'s own rule, and this daemon answers a poll). */
const TRANSFER_PATH = /^\/v1\/desktop\/sessions\/[^/]+\/transfer$/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

/** Which topology the stub serves, and how long the scripted interaction runs. */
const SCENE = flag("scene", "s5");
const SECONDS = Number(flag("seconds", "20"));
const SIZE = flag("size", "1380x900");
/** The injected fault, for proving the instrument can fail. */
const BREACH = flag("breach", null);
const JSON_OUT = flag("json", null);
/**
 * Where the run's scratch lives. `$LOCAL_OPERATOR_SCRATCHPAD` is this session's own
 * directory; the fallback keeps the script runnable outside the harness (a person's
 * terminal) without ever landing in `/tmp`.
 */
const SCRATCH = resolve(
	flag(
		"scratch",
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				join(ROOT, ".mesh-bench-scratch"),
			`run-${process.pid}`,
		),
	),
);

/* ------------------------------------------------------------------ fixtures */

/**
 * The device ids, network ids and session ids the fixtures are built from.
 *
 * SYNTHETIC AND STABLE: the bench compares two runs (clean and breached, or two
 * scenes) and a random id would make every diff a new diff. They are also, on
 * purpose, not shaped like the operator's own (`d_` + hex): a bench that leaked into
 * a real mesh's logs would be recognisable as a bench.
 */
const SELF = `d_${"a".repeat(32)}`;
const NET_HOME = `n_${"1".repeat(24)}`;
const NET_LAB = `n_${"2".repeat(24)}`;
const peerId = (index) => `d_${index.toString(16).padStart(2, "0").repeat(16)}`;

/** How many devices each scene draws, and how many conversations each device holds. */
const SCENES = {
	/** Today's real state: this device alone in one network. */
	s1: { peers: 0, sessionsPerDevice: 2, networks: 1 },
	/** The design target. */
	s5: { peers: 4, sessionsPerDevice: 6, networks: 2 },
	/** The layered layout's named ceiling. */
	n20: { peers: 19, sessionsPerDevice: 3, networks: 2 },
	/** The chip-overflow case, sized against the real session store's shape. */
	busy40: { peers: 4, sessionsPerDevice: 40, networks: 2 },
};

function fixtures(scene) {
	const shape = SCENES[scene];
	if (!shape) throw new Error(`unknown scene: ${scene}`);
	const peers = Array.from({ length: shape.peers }, (_, index) => {
		const id = peerId(index + 1);
		return {
			device_id: id,
			name: `bench-device-${index + 1}`,
			reachable: index % 7 !== 3,
			unreachable_reason: index % 7 === 3 ? "no route to it" : "",
			last_seen_at: Math.floor(Date.now() / 1000) - 60 * (index + 1),
			session_count: shape.sessionsPerDevice,
			rtt_ms: null,
		};
	});
	const networks = Array.from({ length: shape.networks }, (_, index) => {
		const networkId = index === 0 ? NET_HOME : NET_LAB;
		const members = [
			{
				device_id: SELF,
				name: "bench-mac",
				role: "admin",
				capabilities: ["sessions", "transfer"],
				active: true,
				suspect: false,
				endpoints: ["127.0.0.1:4097"],
				last_seen_at: null,
				reachable: true,
				reason: "",
			},
			...peers
				.filter((_, position) => position % shape.networks === index)
				.map((peer) => ({
					device_id: peer.device_id,
					name: peer.name,
					role: "drive",
					capabilities: ["sessions", "transfer"],
					active: true,
					suspect: false,
					endpoints: ["127.0.0.1:4098"],
					last_seen_at: peer.last_seen_at,
					reachable: peer.reachable,
					reason: peer.unreachable_reason,
				})),
		];
		return {
			network_id: networkId,
			name: index === 0 ? "bench-mesh" : "bench-lab",
			epoch: 3,
			trust: "active",
			members,
		};
	});
	const sessions = [];
	let counter = 0;
	const row = (name, locality, owner, live) => ({
		id: (counter++).toString(16).padStart(12, "0"),
		name,
		mtime: Math.floor(Date.now() / 1000) - counter * 60,
		preview: "",
		pinned: false,
		archived: false,
		live_state: live,
		locality,
		owner_device: owner,
		owner_device_name: owner ? `bench-device-${owner}` : "",
		reachable: true,
		unreachable_reason: "",
		placement: null,
		origin: null,
		last_synced_at: null,
	});
	for (let index = 0; index < shape.sessionsPerDevice; index += 1) {
		sessions.push(
			row(
				`bench chat ${index}`,
				"local",
				"",
				index % 5 === 0 ? "attached" : "idle",
			),
		);
	}
	for (const peer of peers) {
		for (let index = 0; index < shape.sessionsPerDevice; index += 1) {
			sessions.push(
				row(
					`${peer.name} chat ${index}`,
					"remote",
					peer.device_id,
					index % 4 === 0 ? "busy" : "idle",
				),
			);
		}
	}
	return {
		self: SELF,
		capabilities: {
			desktop_contract: 1,
			desktop_available: true,
			desktop_auth: "bearer",
			features: { peers: 1, session_transfer: 1 },
		},
		peers: { peers, self_device_id: SELF, degraded: [] },
		networks: { networks, self_device_id: SELF },
		sessions: { sessions, degraded: [], truncated: false },
		shape,
	};
}

/* ------------------------------------------------------------- the stub daemon */

/**
 * A stand-in for `lop serve`, so the app dials a mesh this run invented.
 *
 * IT IS A RESPONDER, NOT A BACKEND: no store, no turns, no transcript. What it must
 * be is PROVABLE - the app's discovery admits a record only when the process
 * answering at its address proves it is that same process, by reporting the record's
 * `instance_id` at `/health` - so this answers with the id it wrote, and every op it
 * has no answer for is refused by name rather than answered with something plausible.
 * A stub that answered an unknown op with `{}` would turn "the app asked something
 * unexpected" into a silent empty state, which is the failure this file must not have.
 */
function startStub(fixture, recordsDir) {
	const instanceId = randomUUID();
	const token = `bench-${randomUUID()}`;
	let claims = 0;
	const unknown = [];
	const seen = new Map();

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const path = url.pathname;
		seen.set(
			path + (url.search || ""),
			(seen.get(path + (url.search || "")) ?? 0) + 1,
		);
		const send = (status, body) => {
			const text = JSON.stringify(body);
			response.writeHead(status, {
				"content-type": "application/json",
				"content-length": Buffer.byteLength(text),
			});
			response.end(text);
		};
		if (path === "/health") {
			/*
			 * THE IDENTITY ANSWER, in the envelope the app's discovery parses: it reads
			 * `result.instance_id`, and a bare top-level `instance_id` is refused as an
			 * older build that cannot prove who it is
			 * (`discovery.ts::readIdentity`). Getting this wrong is not cosmetic - the
			 * record is rejected as `not-a-daemon`, the app falls through to its baked
			 * URL, and the bench measures an offline app's empty state.
			 */
			return send(200, {
				result: {
					instance_id: instanceId,
					pid: process.pid,
					version: "bench",
					prefix: "",
					install_kind: "bench",
				},
			});
		}
		if (path === "/v1/capabilities")
			return send(200, { result: fixture.capabilities });
		if (path === "/v1/desktop/claim") {
			claims += 1;
			return send(200, { result: { token, desktop: true } });
		}
		// Every desktop read the Mesh tab issues. `include_peers` is not inspected:
		// this daemon serves ONE device set, so the flag cannot change the answer -
		// and a fixture that re-derived its rows per flag would be a second thing the
		// bench measures by accident.
		if (path === "/v1/desktop/peers")
			return send(200, { result: fixture.peers });
		if (path === "/v1/desktop/networks")
			return send(200, { result: fixture.networks });
		if (path === "/v1/desktop/sessions")
			return send(200, { result: fixture.sessions });
		if (TRANSFER_PATH.test(path)) {
			return send(200, {
				result: {
					locality: "remote",
					owner_device: "d_bench",
					source_retired: false,
					session_id: "0".repeat(12),
					new_session_id: "1".repeat(12),
					mode: "keep",
					phases: [],
				},
			});
		}
		unknown.push(path);
		return send(503, {
			detail: {
				code: "bench_stub_unknown_op",
				message: `the bench's stub has no answer for ${path}`,
			},
		});
	});

	return new Promise((resolve_, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			/*
			 * THE RECORD THE APP DISCOVERS US BY, with the fields `ServeRecord` declares.
			 * `claim_key` is what the app exchanges at `/v1/desktop/claim`; `cpu`-style
			 * extras would be ignored, so nothing is invented beyond the declared shape.
			 */
			const record = {
				pid: process.pid,
				host: "127.0.0.1",
				port,
				instance_id: instanceId,
				version: "bench",
				source_ref: "bench",
				prefix: "",
				install_kind: "bench",
				desktop: true,
				claim_key: token,
				started_at: Math.floor(Date.now() / 1000),
				heartbeat_at: Math.floor(Date.now() / 1000),
			};
			mkdirSync(recordsDir, { recursive: true, mode: 0o700 });
			const beat = () =>
				writeFileSync(
					join(recordsDir, `${process.pid}.json`),
					JSON.stringify(record),
					{ mode: 0o600 },
				);
			beat();
			/*
			 * THE HEARTBEAT IS NOT OPTIONAL. Discovery calls a record WEDGED once its
			 * heartbeat is older than 45 s (`HEARTBEAT_TIMEOUT_MS`) even while its pid is
			 * alive - measured on a run whose setup took a minute: `pid ... is alive but
			 * its heartbeat is 52s old`. A stub that wrote its record once would be
			 * discoverable for the first 45 seconds of a run and invisible after, which is
			 * a bench that measures different things depending on how long it took to
			 * start.
			 */
			const timer = setInterval(() => {
				record.heartbeat_at = Math.floor(Date.now() / 1000);
				beat();
			}, 5_000);
			timer.unref();
			resolve_({
				port,
				token,
				instanceId,
				claims: () => claims,
				unknown: () => unknown,
				seen: () => [...seen.entries()],
				close: () =>
					new Promise((done) => {
						clearInterval(timer);
						server.close(() => done());
					}),
			});
		});
	});
}

/* --------------------------------------------------------------- the launcher */

/**
 * The app, headless, at an exact size, dialling this run's stub.
 *
 * THREE THINGS ARE LOAD-BEARING, and each of them is a way an agent run has gone
 * wrong on this machine:
 *
 *   - `--window-mode=headless` is NAMED rather than inferred. A launch with a scratch
 *     profile resolves to headless anyway, but a rig that relies on the inference is
 *     one switch away from putting a window on the operator's screen.
 *   - `--user-data-dir` is under `$LOCAL_OPERATOR_SCRATCHPAD`, so the run cannot read
 *     or write the operator's own profile, cookies or window state.
 *   - `LOCAL_OPERATOR_CONFIG_DIR` points at this run's scratch root, so the daemon
 *     record it discovers is the stub's and never a real `lop serve`'s. Without it a
 *     run on this machine would attach to the operator's LIVE mesh and measure four
 *     devices while believing it was measuring twenty.
 *
 * THE PID IS KEPT so the whole tree can be reaped by exact pid: a killed Electron can
 * leave helpers behind, and this fleet has already learned what an orphaned renderer
 * costs.
 */
function launchApp({ port, scratch, size }) {
	const [width, height] = size.split("x").map((value) => Number(value));
	const child = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules", "electron", "cli.js"),
			".",
			"--window-mode=headless",
			`--window-size=${width}x${height}`,
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${join(scratch, "profile")}`,
			/*
			 * THE SWITCH COMES FROM THE ONE MODULE THAT SPELLS IT. Chromium's store under a
			 * scratch profile tries to create a login keychain and asks the operator for one
			 * (`scripts/chrome-keychain.mjs` documents the measurement); typing the flag here
			 * would be a second spelling of it, which `scripts/chrome-keychain.test.mjs`
			 * refuses by name.
			 */
			MOCK_KEYCHAIN_SWITCH,
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				LOCAL_OPERATOR_CONFIG_DIR: join(scratch, "config"),
				LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
				LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
				LOCAL_OPERATOR_UI_TELEMETRY: "off",
				// The app's own store must not be reached at all: a bench is not a user.
				ELECTRON_ENABLE_LOGGING: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		},
	);
	const log = [];
	child.stdout.on("data", (chunk) => log.push(String(chunk)));
	child.stderr.on("data", (chunk) => log.push(String(chunk)));
	return { child, log: () => log.join("") };
}

/**
 * Widen the packaged page's `connect-src` by ONE loopback port: this run's stub.
 *
 * WHY THIS IS NECESSARY RATHER THAN CONVENIENT. The app ships a fixed CSP allowlist
 * for the backend it talks to (`http://localhost:1111`, `http://127.0.0.1:1111`, and
 * the 8080 pair). On this machine both of those ports are held by real Local Operator
 * processes, so a bench that had to use one would be measuring whatever those daemons
 * answer - and the renderer's own `/v1/credentials` fetch fails a CSP check against
 * any other port, which is measured rather than assumed (`Fetch API cannot load
 * http://127.0.0.1:<ephemeral>/v1/credentials. Refused to connect because it violates
 * the document's Content Security Policy`, in the app log of the first successful
 * pairing run).
 *
 * SO THE BENCH EDITS ITS OWN BUILD ARTIFACT, and says so: `out/` is not the repository,
 * the edit is one loopback origin added to one directive of one file, and every run
 * rebuilds `out/` (or re-applies this patch idempotently). Nothing else about the page
 * changes, and the alternative - a bench that only works on a machine where 1111 is
 * free - is not a bench the next person can run.
 */
function allowStubOrigin(stubPort) {
	const file = join(ROOT, "out", "renderer", "index.html");
	const html = readFileSync(file, "utf8");
	const origin = `http://127.0.0.1:${stubPort}`;
	if (html.includes(origin)) return false;
	const pattern = /(connect-src[^;"]*)/;
	const match = pattern.exec(html);
	if (!match)
		throw new Error("the packaged page carries no connect-src to widen");
	writeFileSync(
		file,
		html.replace(
			pattern,
			`${match[1]} ${origin} ${origin.replace("127.0.0.1", "localhost")}`,
		),
	);
	return true;
}

/** The DevTools endpoint of the app's own renderer, once it is listening. */
async function waitForTarget(port, timeoutMs = 60_000) {
	const started = Date.now();
	let lastProblem = "no attempt yet";
	while (Date.now() - started < timeoutMs) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			/*
			 * THE APP'S OWN WINDOW, not merely the first page target. This app hosts MORE
			 * than one WebContents - an agent browser tab and a console surface are pages
			 * too - and a bench attached to one of those would drive a document with no
			 * application root (`#root` absent), which is exactly how the first pairing run
			 * reported a blank page while the app was alive and had claimed its daemon. The
			 * packaged renderer is the target whose URL is the built `index.html`.
			 */
			const pages = list.filter(
				(target) => target.type === "page" && target.webSocketDebuggerUrl,
			);
			const app =
				pages.find((target) =>
					/renderer\/index\.html/.test(target.url ?? ""),
				) ?? pages.find((target) => (target.url ?? "").startsWith("file://"));
			if (app) return app;
			lastProblem = `no application target yet (${pages.length} page targets: ${pages
				.map((target) => target.url)
				.join(", ")})`;
		} catch (error) {
			lastProblem = String(error?.cause?.code ?? error);
		}
		await new Promise((done) => setTimeout(done, 250));
	}
	throw new Error(`the renderer never exposed a page target: ${lastProblem}`);
}

/** A minimal CDP client over the platform's own WebSocket, with no dependency. */
async function cdp(port) {
	const target = await waitForTarget(port);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map();
	let nextId = 0;
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
		else waiter.resolve(message.result);
	});
	await new Promise((done, fail) => {
		socket.addEventListener("open", () => done(), { once: true });
		socket.addEventListener(
			"error",
			() => fail(new Error("CDP socket failed")),
			{
				once: true,
			},
		);
	});
	const send = (method, params = {}) =>
		new Promise((resolve_, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve: resolve_, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				`in-page evaluation threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
			);
		}
		return result.result?.value;
	};
	return { send, evaluate, close: () => socket.close() };
}

/* --------------------------------------------------- the page-side instruments */

/**
 * What the bench installs INSIDE the page, as one script.
 *
 * IT IS INSTALLED FROM THE BENCH AND NEVER FROM THE APP. A counter compiled into the
 * renderer would be a test hook in shipped code - and it would be measuring itself,
 * because the counter's own writes are the thing it counts. Everything here rides on
 * the platform's observers instead: `long-animation-frame` for the frames, a
 * `MutationObserver` for the DOM (mutations and the one style write per frame are the
 * same mechanism, told apart by which node they hit), and a `pointermove` timestamp
 * for pointer-to-visual.
 */
const INSTRUMENT = `(() => {
	const world = document.querySelector("[data-mesh-world]");
	const canvas = document.querySelector("[data-mesh-canvas]");
	if (!world || !canvas) return { ok: false, reason: "the canvas is not mounted" };
	const bench = {
		frames: [],
		latencies: [],
		worldStyleWrites: 0,
		canvasMutations: 0,
		installedAt: performance.now(),
	};
	window.__meshBench = bench;

	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				bench.frames.push({
					start: entry.startTime,
					duration: entry.duration,
					blocking: entry.blockingDuration ?? entry.duration,
				});
			}
		});
		observer.observe({ type: "long-animation-frame", buffered: true });
		bench.frameObserver = true;
	} catch (error) {
		bench.frameObserver = String(error);
	}

	const mutations = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") {
				if (record.target === world) bench.worldStyleWrites += 1;
				else bench.canvasMutations += 1;
				continue;
			}
			bench.canvasMutations += 1;
		}
	});
	mutations.observe(canvas, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});

	/*
	 * POINTER-TO-VISUAL, from the event's own timestamp to the second animation frame
	 * after it: the first rAF runs BEFORE the frame that carries the new transform, so
	 * measuring at the first would report the time to the last painted frame. The
	 * listener is capture-phase on the document so it sees the move whatever the
	 * canvas's own handlers do with it.
	 */
	document.addEventListener(
		"pointermove",
		(event) => {
			const at = event.timeStamp;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					bench.latencies.push(performance.now() - at);
				});
			});
		},
		true,
	);

	/*
	 * EVERY ANIMATION FRAME, COUNTED. The one-write-per-frame invariant needs a
	 * denominator: the long-animation-frame observer reports only the frames judged
	 * LONG, so a run whose pan wrote the transform twice per frame would look perfect
	 * by those entries alone. This tick counter is that denominator, and it is read
	 * from the same page, in the same phase windows, as the write counter.
	 */
	bench.rafTicks = 0;
	bench.frameDeltas = [];
	let last = performance.now();
	const tick = (now) => {
		bench.rafTicks += 1;
		bench.frameDeltas.push({ at: now, delta: now - last });
		last = now;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return { ok: true, frames: bench.frameObserver === true };
})()`;

/** The injected faults, each one a property the instrument is supposed to notice. */
const BREACH_SCRIPTS = {
	/**
	 * A forced synchronous layout on every pointer move: the classic way a smooth pan
	 * becomes a janky one, and it must move POINTER-TO-VISUAL without needing a single
	 * dropped frame.
	 */
	"layout-read": `(() => {
		const world = document.querySelector("[data-mesh-world]");
		document.addEventListener("pointermove", () => {
			// The read is the point: reading a layout property after a write in the same
			// frame forces the browser to flush style and layout before it answers.
			void world.offsetHeight;
		}, true);
		return "layout-read installed";
	})()`,
	/** Forty milliseconds burned inside the page on every hundred: a busy frame. */
	"busy-frame": `(() => {
		window.__benchBusy = setInterval(() => {
			const until = performance.now() + 40;
			while (performance.now() < until) { /* burn */ }
		}, 100);
		return "busy-frame installed";
	})()`,
	/**
	 * A SECOND write to the world layer's style per frame, which is the mutation the
	 * one-write-per-frame invariant exists to catch.
	 */
	"double-write": `(() => {
		const world = document.querySelector("[data-mesh-world]");
		window.__benchDouble = setInterval(() => {
			requestAnimationFrame(() => {
				world.style.willChange = world.style.willChange === "transform" ? "auto" : "transform";
			});
		}, 16);
		return "double-write installed";
	})()`,
};

/* ----------------------------------------------------------- the scripted input */

/**
 * Dispatch one real mouse event through the browser's input pipeline.
 *
 * `Input.dispatchMouseEvent` RATHER THAN A SYNTHETIC `PointerEvent` FROM THE PAGE,
 * and the difference is the measurement: a page-dispatched event is trusted-but-fake
 * and never enters the browser's input queue, so the frame it lands on is the frame
 * the script happened to be running in - which is exactly the cost this bench is
 * trying to see. These events are delivered the way a person's are: queued,
 * coalesced, and timestamped by the compositor.
 */
async function mouse(send, type, x, y, extra = {}) {
	await send("Input.dispatchMouseEvent", {
		type,
		x: Math.round(x),
		y: Math.round(y),
		button: "left",
		buttons: type === "mouseReleased" ? 0 : 1,
		clickCount: 1,
		pointerType: "mouse",
		...extra,
	});
}

async function wheel(send, x, y, deltaY) {
	await send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: Math.round(x),
		y: Math.round(y),
		deltaX: 0,
		deltaY,
		pointerType: "mouse",
	});
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The canvas box and the interaction anchors, read from the page once. */
async function anchors(evaluate) {
	return await evaluate(`(() => {
		const canvas = document.querySelector("[data-mesh-canvas]");
		if (!canvas) return null;
		const box = canvas.getBoundingClientRect();
		/* A point of EMPTY GROUND: the pan starts only when the target is the canvas
		 * itself, so the bench searches for one instead of assuming a corner that a
		 * node may be sitting on at the size under test. */
		let ground = null;
		for (let gx = box.left + 8; gx < box.right - 8 && !ground; gx += 24) {
			for (let gy = box.bottom - 8; gy > box.top + 8; gy -= 24) {
				const hit = document.elementFromPoint(gx, gy);
				if (hit === canvas) { ground = { x: gx, y: gy }; break; }
			}
		}
		const chips = [...document.querySelectorAll("[data-mesh-session]")]
			.map((chip) => {
				const rect = chip.getBoundingClientRect();
				const device = chip.closest("[data-mesh-device]");
				return {
					id: chip.getAttribute("data-mesh-session"),
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
					device: device ? device.getAttribute("data-mesh-device") : null,
				};
			});
		const devices = [...document.querySelectorAll("[data-mesh-device]")].map((node) => {
			const rect = node.getBoundingClientRect();
			return {
				id: node.getAttribute("data-mesh-device"),
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2,
			};
		});
		return { box: { left: box.left, top: box.top, width: box.width, height: box.height }, ground, chips, devices };
	})()`);
}

/**
 * Pan, zoom and drag, continuously, for the scripted seconds.
 *
 * THE PHASES ARE SEPARATED ON PURPOSE: a single number cannot say whether the cost
 * is the transform write, the node render, the edge re-path or the drag's own target
 * resolution, and the plan's rule is to attribute the phases rather than average
 * them away. Every phase dispatches on a real cadence (a move every ~8 ms, i.e. a
 * 120 Hz pointer) and every phase checks that it CHANGED something: a "drag" that
 * never moved a node would produce beautiful latency numbers for a gesture nobody
 * performed, which is the failure mode this bench exists to refuse.
 */
async function runInteraction(send, evaluate, seconds) {
	const marks = (
		label,
	) => `(() => { window.__meshBench.phase = ${JSON.stringify(label)}; return {
		at: performance.now(),
		world: document.querySelector("[data-mesh-world]").style.transform,
		writes: window.__meshBench.worldStyleWrites,
		rafTicks: window.__meshBench.rafTicks ?? 0,
	}; })()`;

	const after = (label) => `(() => {
		const bench = window.__meshBench;
		return {
			label: ${JSON.stringify(label)},
			at: performance.now(),
			world: document.querySelector("[data-mesh-world]").style.transform,
			worldStyleWrites: bench.worldStyleWrites,
			canvasMutations: bench.canvasMutations,
			rafTicks: bench.rafTicks ?? 0,
		};
	})()`;

	/**
	 * Attach a phase's own DELTAS to the cumulative counters the page reports.
	 *
	 * The counters are cumulative from install time, so the pan's write count read at the
	 * end of the pan includes everything written before it - which is how a double-write
	 * fault measured 355 writes over 428 frames and still passed an invariant that allowed
	 * `frames + 4`. The comparison the invariant wants is WRITES PER INPUT EVENT, and that
	 * is a delta.
	 */
	const phase = (label, mark, rest) => ({
		...rest,
		at: mark.at,
		label,
		phaseWrites: rest.worldStyleWrites - mark.writes,
		phaseFrames: rest.rafTicks - mark.rafTicks,
	});

	const find = await anchors(evaluate);
	if (!find || !find.ground) {
		throw new Error(
			"no empty ground on the canvas: the pan has nowhere to start",
		);
	}
	const phases = [];
	const thirdOf = seconds / 3;

	/* -- pan: press empty ground and sweep the pointer across the canvas ---------- */
	/*
	 * THE PHASE'S WINDOW STARTS AT ITS MARK, not at its end. Recording `at` from the
	 * trailing measurement shifted every window by one phase - the drag's window began
	 * after the drag had finished, so a run reported "0 samples during the drag" while
	 * its own phase line said 214 input events had been dispatched. The mark's stamp is
	 * the start, the `after()` call supplies the end state, and both are kept.
	 */
	const panMark = await evaluate(marks("pan"));
	await mouse(send, "mousePressed", find.ground.x, find.ground.y);
	const panStart = Date.now();
	let step = 0;
	while ((Date.now() - panStart) / 1000 < thirdOf) {
		const t = (Date.now() - panStart) / 1000;
		const x = find.ground.x + Math.sin(t * 1.6) * (find.box.width / 4);
		const y =
			find.ground.y - Math.abs(Math.sin(t * 1.1)) * (find.box.height / 5);
		await mouse(send, "mouseMoved", x, y);
		step += 1;
		await sleep(8);
	}
	await mouse(send, "mouseReleased", find.ground.x, find.ground.y);
	phases.push(
		phase("pan", panMark, { ...(await evaluate(after("pan"))), steps: step }),
	);

	/* -- zoom: a wheel at two anchors, which also exercises the pointer invariant -- */
	const zoomMark = await evaluate(marks("zoom"));
	const zoomStart = Date.now();
	let wheelSteps = 0;
	while ((Date.now() - zoomStart) / 1000 < thirdOf) {
		const inward = Math.sin((Date.now() - zoomStart) / 900) > 0;
		await wheel(
			send,
			find.box.left + find.box.width * 0.35,
			find.box.top + find.box.height * 0.4,
			inward ? -60 : 60,
		);
		wheelSteps += 1;
		await sleep(16);
	}
	phases.push(
		phase("zoom", zoomMark, {
			...(await evaluate(after("zoom"))),
			steps: wheelSteps,
		}),
	);

	/*
	 * RESET THE VIEW BEFORE THE DRAG (`0` is the plan's own binding), so the drag's
	 * actors are on screen at ANY scripted duration rather than only when the pan
	 * happens to have carried the world back near where it started. A drag is the one
	 * phase that needs a visible chip and a visible destination, and a viewer who has
	 * just panned somewhere unhelpful does the same thing before dragging.
	 */
		/*
		 * THE CANVAS OWNS THE KEY HANDLER (`tabIndex={0}` on the canvas itself), so a
		 * synthetic key press must be aimed at it: dispatched at the body it reaches
		 * nothing, which is how a run measured `scale(3)` and five off-screen chips after
		 * asking for a reset.
		 */
		await evaluate(
			`document.querySelector("[data-mesh-canvas]")?.focus?.() ?? null`,
		);
	for (const type of ["keyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			key: "0",
			code: "Digit0",
			windowsVirtualKeyCode: 48,
			nativeVirtualKeyCode: 48,
			text: type === "keyDown" ? "0" : undefined,
		});
	}
	await sleep(150);

	/* -- drag: a session chip lifted off a device and carried to another ---------- */
	/*
	 * THE DRAG'S ACTORS ARE PICKED BY REACHABILITY, NOT BY ORDER. Panning and zooming
	 * move the world under the pointer, so a chip chosen from the node list can be off
	 * screen or covered by the lane behind it - and the press then lands on something
	 * that is not the chip, which is a phase that measured a gesture nobody made.
	 * Measured: the drag lifted on a nine-second run and not on a twenty-second one,
	 * the only difference being how far the pan had carried the world.
	 *
	 * The test is the BROWSER's own: `elementFromPoint` at the actor's centre, which is
	 * exactly what the press will hit.
	 */
	const pick = async () =>
		await evaluate(`(() => {
			const idAt = (x, y, attribute) => {
				const node = document.elementFromPoint(x, y)?.closest("[" + attribute + "]");
				return node ? node.getAttribute(attribute) : null;
			};
			const chips = [...document.querySelectorAll("[data-mesh-session]")]
				.map((chip) => {
					const rect = chip.getBoundingClientRect();
					return {
						id: chip.getAttribute("data-mesh-session"),
						x: rect.left + rect.width / 2,
						y: rect.top + rect.height / 2,
						device: chip.closest("[data-mesh-device]")?.getAttribute("data-mesh-device") ?? null,
					};
				})
				.filter((chip) => idAt(chip.x, chip.y, "data-mesh-session") === chip.id);
			const devices = [...document.querySelectorAll("[data-mesh-device]")]
				.map((node) => {
					const rect = node.getBoundingClientRect();
					return {
						id: node.getAttribute("data-mesh-device"),
						x: rect.left + rect.width / 2,
						y: rect.top + rect.height / 2,
					};
				})
				.filter((device) => idAt(device.x, device.y, "data-mesh-device") === device.id);
			for (const chip of chips) {
				const target = devices.find((device) => device.id !== chip.device);
				if (target) return { chip, target };
			}
			return null;
		})()`);
	let actors = await pick();
	if (!actors) {
		/*
		 * NOTHING REACHABLE: put the view back where the fit put it - `0` is the plan's
		 * own reset binding - and pick again. This is the one place the bench presses a
		 * key, and it is stated rather than hidden: without it, a run whose pan carried
		 * every chip off screen would report a drag it never made.
		 */
		/*
		 * THE CANVAS OWNS THE KEY HANDLER (`tabIndex={0}` on the canvas itself), so a
		 * synthetic key press must be aimed at it: dispatched at the body it reaches
		 * nothing, which is how a run measured `scale(3)` and five off-screen chips after
		 * asking for a reset.
		 */
		await evaluate(
			`document.querySelector("[data-mesh-canvas]")?.focus?.() ?? null`,
		);
		for (const type of ["keyDown", "keyUp"]) {
			await send("Input.dispatchKeyEvent", {
				type,
				key: "0",
				code: "Digit0",
				windowsVirtualKeyCode: 48,
				nativeVirtualKeyCode: 48,
				text: type === "keyDown" ? "0" : undefined,
			});
		}
		await sleep(150);
		actors = await pick();
	}
	if (!actors) {
		/*
		 * THE REFUSAL CARRIES ITS OWN DIAGNOSIS. "No visible chip" is not actionable: the
		 * difference between a chip behind an overlay, a chip outside the viewport and a
		 * transform that never reset is one query, and the next reader should not have to
		 * add it.
		 */
		const why = await evaluate(`(() => {
			const canvas = document.querySelector("[data-mesh-canvas]");
			const chips = [...document.querySelectorAll("[data-mesh-session]")];
			const devices = [...document.querySelectorAll("[data-mesh-device]")];
			const box = canvas?.getBoundingClientRect();
			const chipAt = chips[0]?.getBoundingClientRect();
			return {
				chips: chips.length,
				devices: devices.length,
				transform: document.querySelector("[data-mesh-world]")?.style.transform ?? null,
				canvas: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null,
				firstChip: chipAt ? [Math.round(chipAt.left), Math.round(chipAt.top), Math.round(chipAt.width), Math.round(chipAt.height)] : null,
				hit: chipAt
					? (() => {
							const found = document.elementFromPoint(chipAt.left + chipAt.width / 2, chipAt.top + chipAt.height / 2);
							return found ? found.tagName + "." + (found.className ?? "").toString().slice(0, 60) : "nothing";
						})()
					: null,
			};
		})()`);
		throw new Error(
			`the drag's actors are not reachable: ${JSON.stringify(why)}`,
		);
	}
	const chip = actors.chip;
	const target = actors.target;
	const dragMark = await evaluate(marks("drag"));
	/*
	 * A HOVER, THEN A PRESS, THEN A BEAT. A real pointer arrives at the chip before it
	 * presses it, and the app's own hit-testing (and the browser's) settles the element
	 * under the point on that move; pressing straight from wherever the pan left the
	 * pointer was the shape that lifted nothing on two of four runs, at both three and
	 * twenty seconds.
	 */
	await mouse(send, "mouseMoved", chip.x, chip.y);
	await sleep(30);
	await mouse(send, "mousePressed", chip.x, chip.y);
	await sleep(30);
	const dragStart = Date.now();
	let dragSteps = 0;
	let lifted = false;
	while ((Date.now() - dragStart) / 1000 < thirdOf) {
		const t = Math.min(1, (Date.now() - dragStart) / 1000 / thirdOf);
		const x = chip.x + (target.x - chip.x) * t;
		const y = chip.y + (target.y - chip.y) * t + Math.sin(t * Math.PI) * 12;
		await mouse(send, "mouseMoved", x, y);
		if (
			!lifted &&
			(await evaluate(`Boolean(document.querySelector("[data-mesh-ghost]"))`))
		) {
			lifted = true;
		}
		dragSteps += 1;
		await sleep(8);
	}
	await mouse(send, "mouseReleased", target.x, target.y);
	phases.push(
		phase("drag", dragMark, {
			...(await evaluate(after("drag"))),
			steps: dragSteps,
			lifted,
			chip: chip.id,
			target: target.id,
			/*
			 * WHAT WAS UNDER THE POINTER WHEN THE DRAG ENDED. A drag can fail to lift for
			 * reasons a frame cannot show - the chip's centre covered by another element, a
			 * coordinate that landed on the lane behind it - and the answer is one
			 * `elementFromPoint` away. Without it, `chip lifted=false` is a mystery; with it,
			 * the next reader knows whether the bench missed the chip or the app missed the
			 * gesture.
			 */
			under: await evaluate(`(() => {
				const found = document.elementFromPoint(${Math.round(target.x)}, ${Math.round(target.y)});
				const node = found?.closest("[data-mesh-session], [data-mesh-device]");
				return node ? node.getAttribute("data-mesh-session") ?? node.getAttribute("data-mesh-device") : found?.tagName ?? "nothing";
			})()`),
		}),
	);

	return { phases, anchors: find };
}

/* ------------------------------------------------------------------ the numbers */

/** The p-th percentile of a sample, by nearest rank. Never an average. */
function percentile(values, p) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	);
	return sorted[Math.max(0, rank)];
}

const round = (value) =>
	value === null ? null : Math.round(value * 100) / 100;

/** The structural invariants, which are properties rather than timings. */
async function invariants({ evaluate, stub, phases, devices, nodes }) {
	const results = [];

	/* 1. A DEEP-EQUAL POLL CAUSES ZERO DOM MUTATION. The stub answers the same bytes
	 *    every time, so React Query's structural sharing hands the SAME object back -
	 *    and a poll that cannot be told from the previous one must not touch the DOM.
	 *    The poll is the app's own 30 s cadence (the mesh reads' `MESH_POLL_MS`), so
	 *    this waits for the stub to SEE a second `peers` request rather than firing
	 *    one itself: an injected refetch would be this script's event, not the app's. */
	const before = await evaluate(`(() => {
		const bench = window.__meshBench;
		bench.canvasMutations = 0;
		bench.children = document.querySelectorAll("[data-mesh-world] *").length;
		return { mutations: bench.canvasMutations, children: bench.children };
	})()`);
	const peersRequests = () =>
		stub.seen().find(([path]) => path === "/v1/desktop/peers")?.[1] ?? 0;
	const beforeCount = peersRequests();
	const deadline = Date.now() + 40_000;
	while (peersRequests() === beforeCount && Date.now() < deadline)
		await sleep(500);
	const polled = peersRequests() > beforeCount;
	// One settle beat after the poll's answer lands, so the assertion covers the paint
	// that followed it rather than the window before React had re-rendered.
	await sleep(1200);
	const afterPoll = await evaluate(`(() => {
		const bench = window.__meshBench;
		return { mutations: bench.canvasMutations, children: document.querySelectorAll("[data-mesh-world] *").length };
	})()`);
	results.push({
		name: "a deep-equal poll mutates nothing",
		ok: polled && afterPoll.mutations === 0,
		detail: `${polled ? "" : "NO POLL OBSERVED; "}mutations ${afterPoll.mutations}, world children ${before.children} -> ${afterPoll.children}`,
	});

	/* 2. THE DOM STAYS BOUNDED. The session store on this machine holds 12,363
	 *    directories; a node that rendered them all would make the DOM a function of
	 *    that store. The bound is `devices × a constant + networks`, and the constant
	 *    is published with the measurement so a later change to a node's markup has to
	 *    move THIS number deliberately rather than exceed it silently. */
	const bound = devices * 40 + nodes * 10 + 200;
	results.push({
		name: "the DOM is bounded by devices, not by the session store",
		ok: afterPoll.children <= bound,
		detail: `${afterPoll.children} elements in the world layer, bound ${bound} (${devices} devices)`,
	});

	/* 3. ONE STYLE WRITE PER INPUT EVENT, which is the strongest form of "one style write
	 *    per animation frame" that input can produce: a pan writes the transform only in
	 *    the frames an input event arrived in, so the count is compared against the
	 *    EVENTS rather than against the frame total. The slack is the coalescing
	 *    boundary - a move that lands after a frame's write is applied in the next frame,
	 *    still one write each.
	 *
	 *    THIS FORM IS THE ONE THAT CAN FAIL. As a comparison against the frame total
	 *    (`frames + 4`) a real double-write measured 355 writes over 428 frames and
	 *    passed; the same fault is 355 writes over 136 moves, and the run below is what
	 *    turns that into a FAIL. */
	const pan = phases.find((phase) => phase.label === "pan");
	const writes = pan.phaseWrites;
	const events = pan.steps;
	results.push({
		name: "a pan writes the transform once per input event",
		ok: events > 0 && writes <= events + 2,
		detail: `${writes} style writes over ${events} dispatched moves (and ${pan.phaseFrames} frames) in the pan phase`,
	});

	/* 4. THE INTERACTION ACTUALLY HAPPENED. Every number above is meaningless if the
	 *    script panned nothing, so the phases' own world transforms are compared: a
	 *    screen that never moved is a bench that measured its own silence. */
	const panned =
		pan.world !== phases.find((phase) => phase.label === "zoom").world;
	const dragged =
		phases.find((phase) => phase.label === "drag")?.lifted === true;
	results.push({
		name: "the scripted gesture moved the world, and the drag lifted a chip",
		ok: panned && dragged,
		detail: `panned=${panned}, chip lifted=${dragged}`,
	});

	return results;
}

/* ------------------------------------------------------------------ the report */

/**
 * The three numbers, the invariants, and the bar they are compared against.
 *
 * THE BAR IS PRINTED WITH THE NUMBERS, always, and labelled for what it is: a
 * RAIL/INP target rather than a measurement of this app. A report that printed a p95
 * and no target would invite the next reader to invent one, and a report that printed
 * a target without saying where it came from would read as a promise this repository
 * has never measured.
 */
function buildReport({
	scene,
	size,
	seconds,
	phases,
	bench,
	checks,
	breach,
	stub,
}) {
	const byPhase = new Map();
	for (const phase of phases) byPhase.set(phase.label, phase);
	const deltasIn = (label) => {
		const phase = byPhase.get(label);
		if (!phase) return [];
		const next = phases[phases.indexOf(phase) + 1];
		const to = next ? next.at : Number.POSITIVE_INFINITY;
		return bench.frameDeltas
			.filter((frame) => frame.at >= phase.at && frame.at < to)
			.map((frame) => frame.delta);
	};
	const framesIn = (label) => {
		const phase = byPhase.get(label);
		if (!phase) return [];
		const next = phases[phases.indexOf(phase) + 1];
		const to = next ? next.at : Number.POSITIVE_INFINITY;
		return bench.frames.filter(
			(frame) => frame.start >= phase.at && frame.start < to,
		);
	};

	const panZoom = [...deltasIn("pan"), ...deltasIn("zoom")];
	const dragDeltas = deltasIn("drag");
	const dragFrames = framesIn("drag");
	const worstBlocking = Math.max(
		0,
		...dragFrames.map((frame) => frame.blocking ?? frame.duration),
	);
	const p95Frame = percentile(panZoom, 95);
	const p95Latency = percentile(bench.latencies, 95);

	const targets = [
		{
			name: "p95 frame time during pan/zoom",
			value: p95Frame,
			bar: 16.7,
			unit: "ms",
			ok: p95Frame !== null && p95Frame <= 16.7,
		},
		{
			name: "worst frame blocking during a drag",
			value: worstBlocking,
			bar: 50,
			unit: "ms",
			ok: worstBlocking <= 50,
		},
		{
			name: "pointer-to-visual (p95)",
			value: p95Latency,
			bar: 100,
			unit: "ms",
			ok: p95Latency !== null && p95Latency <= 100,
		},
	];

	const lines = [];
	lines.push(
		`mesh canvas bench: scene ${scene}, ${size}, ${seconds}s of pan + zoom + drag`,
	);
	lines.push(
		`  samples: ${panZoom.length} frames in pan/zoom, ${dragDeltas.length} in the drag, ${bench.latencies.length} pointer-to-visual`,
	);
	lines.push(
		`  long frames (>50 ms): ${bench.frames.length} in the whole run, ${dragFrames.length} during the drag`,
	);
	lines.push(
		`  load average at report time: ${loadavg()
			.map((n) => n.toFixed(2))
			.join(" ")}`,
	);
	lines.push("");
	for (const target of targets) {
		lines.push(
			`  ${target.ok ? "PASS" : "FAIL"}  ${target.name}: ${round(target.value)} ${target.unit} (bar ${target.bar} ${target.unit})`,
		);
	}
	lines.push("");
	lines.push("  targets are RAIL/INP budgets, not measurements of this app");
	lines.push("");
	for (const check of checks) {
		lines.push(
			`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`,
		);
	}
	lines.push("");
	for (const phase of phases) {
		lines.push(
			`  phase ${phase.label}: ${phase.steps} input events, transform ${phase.world ? "changed" : "UNCHANGED"}`,
		);
	}
	if (breach) lines.push(`  INJECTED BREACH: ${breach}`);
	if (stub.unknown().length > 0) {
		lines.push(
			`  the stub refused ${stub.unknown().length} unmodelled op(s): ${[...new Set(stub.unknown())].join(", ")}`,
		);
	}
	return {
		lines,
		targets,
		ok:
			targets.every((target) => target.ok) && checks.every((check) => check.ok),
	};
}

/* --------------------------------------------------------------------- the run */

/** A loopback port nothing is using, so the bench never fights another session. */
async function freePort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await new Promise((done) => server.close(() => done()));
	return port;
}

async function waitForMesh(evaluate, timeoutMs = 60_000) {
	const started = Date.now();
	let lastProblem = "nothing yet";
	let navigations = 0;
	while (Date.now() - started < timeoutMs) {
		/*
		 * THE HASH IS SET ON EVERY POLL, not once. The app resolves its initial route
		 * AFTER mount and lands on `/chat`; a single assignment made before that
		 * resolution is simply overwritten, which is how the first run drove a live app
		 * that stayed on the chat route while the bench waited for a canvas. Once the
		 * app's own routing has settled, the same assignment sticks.
		 */
		navigations += 1;
		await evaluate(`(() => {
			if (window.location.hash !== "#/mesh") {
				window.location.hash = "#/mesh";
			}
			/* After a few tries the Router is plainly not listening to the hash: press
			 * the rail row instead, which is the path a reader takes. */
			if (${navigations} > 6) {
				const rail = document.querySelector('a[href="#/mesh"]') ??
					[...document.querySelectorAll("button, a")].find((node) =>
						(node.textContent ?? "").trim() === "Mesh");
				if (rail) rail.click();
			}
			return true;
		})()`);
		const state = await evaluate(`(() => ({
			canvas: Boolean(document.querySelector("[data-mesh-canvas]")),
			devices: document.querySelectorAll("[data-mesh-device]").length,
			chips: document.querySelectorAll("[data-mesh-session]").length,
			hash: window.location.hash,
			root: document.getElementById("root")?.childElementCount ?? -1,
			body: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
		}))()`);
		if (state.canvas && state.devices > 0) return state;
		lastProblem = JSON.stringify(state);
		await sleep(500);
	}
	throw new Error(`the Mesh tab never mounted: ${lastProblem}`);
}

async function main() {
	const load = loadavg()
		.map((value) => value.toFixed(2))
		.join(" ");
	const scratch = SCRATCH;
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	const records = join(scratch, "config", "run", "serve");
	const fixture = fixtures(SCENE);
	const stub = await startStub(fixture, records);
	const cdpPort = await freePort();
	let app = null;
	let client = null;
	/**
	 * Reap by EXACT PID, plus the whole process group, on every exit path, and WAIT for
	 * the process to be gone before returning.
	 *
	 * The wait is not politeness: the scratch removal that follows it failed with
	 * `ENOTEMPTY` while a killed-but-not-yet-dead Electron was still flushing files into
	 * `--user-data-dir`, so a run that had measured everything reported a teardown error
	 * instead of its numbers.
	 */
	const reap = async () => {
		if (client) {
			try {
				client.socket.close();
			} catch {
				// already gone
			}
		}
		if (app?.child?.pid) {
			for (const signal of ["SIGTERM", "SIGKILL"]) {
				try {
					process.kill(-app.child.pid, signal);
				} catch {
					// no group, or already dead
				}
				try {
					process.kill(app.child.pid, signal);
				} catch {
					// already dead
				}
			}
			await new Promise((done) => {
				if (app.child.exitCode !== null || app.child.signalCode !== null) {
					done();
					return;
				}
				const timer = setTimeout(done, 5_000);
				app.child.once("exit", () => {
					clearTimeout(timer);
					done();
				});
			});
		}
	};
	process.once("SIGINT", () => {
		void reap();
		process.exit(130);
	});

	try {
		/*
		 * THE STUB'S ORIGIN GOES INTO THE PACKAGED PAGE'S CSP FIRST, or the renderer's
		 * own fetches against it are refused before the app can render - see
		 * `allowStubOrigin` for the measurement that made this necessary.
		 */
		allowStubOrigin(stub.port);
		app = launchApp({ port: cdpPort, scratch, size: SIZE });
		client = await cdp(cdpPort);
		await client.send("Runtime.enable");
		await client.send("Page.enable");
		let mounted;
		try {
			mounted = await waitForMesh(client.evaluate);
		} catch (error) {
			/*
			 * A FAILED MOUNT IS DIAGNOSED WITH THE APP'S OWN WORDS. The renderer's console
			 * and the main process's log are the only place a pairing refusal, a missing
			 * capability or a crash is stated, and a rig that reports "the tab never
			 * mounted" without them costs the next person the same hunt this one cost.
			 */
			const interesting =
				/desktop|discovery|mesh|capabilit|claim|Error|error|fail/i;
			const tail = app
				.log()
				.split("\n")
				.filter((line) => interesting.test(line))
				.slice(-30)
				.join("\n");
			throw new Error(
				`${error.message}\n--- app log (lines about the desktop plane) ---\n${tail}`,
			);
		}
		const installed = await client.evaluate(INSTRUMENT);
		if (!installed.ok)
			throw new Error(
				`the instrument did not install: ${JSON.stringify(installed)}`,
			);
		if (BREACH) {
			const script = BREACH_SCRIPTS[BREACH];
			if (!script) {
				throw new Error(
					`unknown --breach=${BREACH}; known faults are ${Object.keys(BREACH_SCRIPTS).join(", ")}`,
				);
			}
			await client.evaluate(script);
		}
		// One beat for the fixture's first paint to settle before the scripted seconds
		// start: the bench measures the interaction, not the mount.
		await sleep(500);
		const interaction = await runInteraction(
			client.send,
			client.evaluate,
			SECONDS,
		);
		const bench = await client.evaluate(`(() => {
			const held = window.__meshBench;
			return {
				frames: held.frames,
				latencies: held.latencies,
				frameDeltas: held.frameDeltas,
				worldStyleWrites: held.worldStyleWrites,
				canvasMutations: held.canvasMutations,
				rafTicks: held.rafTicks,
			};
		})()`);
		const checks = await invariants({
			evaluate: client.evaluate,
			stub,
			phases: interaction.phases,
			devices: mounted.devices,
			nodes: fixture.shape.networks,
		});
		/*
		 * THE RUN MUST HAVE BEEN A RUN. A bench that stopped early - a page that
		 * navigated, a stub that died, a script that threw halfway - otherwise reports
		 * a beautiful percentile over four frames, which is the "exit 0 with nothing
		 * measured" failure this repository bans outright.
		 */
		const scripted = SECONDS * 60;
		const enoughFrames = bench.frameDeltas.length >= scripted * 0.5;
		const enoughLatencies = bench.latencies.length >= 60;
		const completed = enoughFrames && enoughLatencies;
		const report = buildReport({
			scene: SCENE,
			size: SIZE,
			seconds: SECONDS,
			phases: interaction.phases,
			bench,
			checks: [
				{
					name: "the scripted seconds and frames all arrived",
					ok: completed,
					detail: `${bench.frameDeltas.length} frames and ${bench.latencies.length} pointer-to-visual samples over ${SECONDS}s (need >= ${Math.round(scripted * 0.5)} and >= 60)`,
				},
				...checks,
			],
			breach: BREACH,
			stub,
		});
		console.log(report.lines.join("\n"));
		if (JSON_OUT) {
			writeFileSync(
				resolve(JSON_OUT),
				JSON.stringify(
					{
						scene: SCENE,
						size: SIZE,
						seconds: SECONDS,
						breach: BREACH,
						load,
						targets: report.targets,
						checks: report.ok,
						phases: interaction.phases.map(({ label, steps, world, at }) => ({
							label,
							steps,
							world,
							at,
						})),
						bench: {
							frameDeltas: bench.frameDeltas,
							latencies: bench.latencies,
							longFrames: bench.frames,
							worldStyleWrites: bench.worldStyleWrites,
							canvasMutations: bench.canvasMutations,
							rafTicks: bench.rafTicks,
						},
						stub: {
							claims: stub.claims(),
							unknown: stub.unknown(),
							seen: stub.seen(),
							port: stub.port,
						},
					},
					null,
					2,
				),
			);
		}
		return report.ok ? 0 : 1;
	} finally {
		await reap();
		await stub.close();
		if (!ARGS.includes("--keep"))
			rmSync(scratch, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 200,
			});
	}
}

if (isEntryPoint(import.meta.url)) {
	main()
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(`mesh-canvas-bench: ${error?.stack ?? error}`);
			process.exit(2);
		});
}

export {
	BREACH_SCRIPTS,
	buildReport,
	fixtures,
	percentile,
	runInteraction,
	startStub,
};
