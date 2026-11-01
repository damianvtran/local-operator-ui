import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the renderer dev driver's opt-in.
 *
 * Why these cases: the driver exists so an agent can drive the real renderer
 * (see `docs/agent-driver.md`), and the property that makes it safe to ship in
 * the app is that a launch which did not ask for it is inert — no channel
 * registered, no bridge in the renderer, nothing to reach. That is a property of
 * `resolveDevDriverArming`, so it is asserted here in process: the module imports
 * nothing from Electron, exactly as `window-mode.ts` does not, which is what
 * makes a decision that normally needs a whole app testable in milliseconds.
 *
 * The real boot is measured too, by `node scripts/renderer-driver.mjs
 * --gate-check`: an unarmed launch must paint normally, expose no
 * `window.__loDevDriver`, and have main refuse `dev-driver-capture` with
 * Electron's own "No handler registered". This file cannot see any of that, and
 * does not pretend to — it pins the decision those boot assertions depend on.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `window-mode.test.mjs` does, so these stay tests of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/dev-driver";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DEV_DRIVER_ARG,
	DEV_DRIVER_CAPTURE,
	DEV_DRIVER_ENV,
	DEV_DRIVER_FACTS,
	DEV_DRIVER_OUT_ENV,
	DEV_DRIVER_WORLD_KEY,
	describeDevDriverArming,
	devDriverArgument,
	headlessExerciserAllowed,
	readDevDriverArgument,
	resolveDevDriverArming,
	observationMode,
	validTranscriptObservation,
	TRANSCRIPT_OBSERVE_ENV,
	TRANSCRIPT_OBSERVE_LIMITS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const OUT = "/tmp/lo-dev-driver-frames";

/** The launch a person makes: no opt-in in the environment, an ordinary window. */
const normalLaunch = {
	env: {},
	windowMode: "normal",
};

test("a launch that did not ask for the driver is inert, and says nothing", () => {
	const arming = resolveDevDriverArming(normalLaunch);
	assert.equal(arming.armed, false);
	assert.equal(arming.outDir, null);
	// No problems, because nothing was set: the banner stays silent in a normal
	// launch rather than explaining a feature the operator did not invoke.
	assert.deepEqual(arming.problems, []);
	assert.equal(describeDevDriverArming(arming), null);
});

test("nothing arms the driver without the opt-in, in any window mode", () => {
	// The fail-closed claim, as a matrix rather than as one case. The signature
	// carries no argv at all now — the opt-in is ONE environment variable, and
	// `resolveDevDriverArming` cannot see a command line to be talked into by —
	// but this states the property for every input it CAN see.
	for (const windowMode of ["normal", "headless", "inactive"]) {
		for (const env of [
			{},
			{ [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "", [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "   ", [DEV_DRIVER_OUT_ENV]: OUT },
			{ [DEV_DRIVER_ENV]: "0", [DEV_DRIVER_OUT_ENV]: OUT },
		]) {
			const arming = resolveDevDriverArming({ env, windowMode });
			assert.equal(
				arming.armed,
				false,
				`armed with env=${JSON.stringify(env)} mode=${windowMode}`,
			);
		}
	}
});

test("a typo is refused loudly rather than ignored", () => {
	for (const value of ["yes", "on", "0", "false", "TRUEISH", "1 "]) {
		const arming = resolveDevDriverArming({
			...normalLaunch,
			env: { [DEV_DRIVER_ENV]: value, [DEV_DRIVER_OUT_ENV]: OUT },
			windowMode: "headless",
		});
		// "1 " trims to the accepted value, so it arms; everything else is refused
		// with a problem naming what IS accepted. Either way the value is never
		// silently obeyed.
		if (value.trim() === "1") {
			assert.equal(arming.armed, true, `${value} should arm`);
			continue;
		}
		assert.equal(arming.armed, false, `${value} must not arm`);
		assert.match(arming.problems.join(" "), /not an opt-in/);
		assert.match(arming.problems.join(" "), /1, true/);
	}
});

test("the opt-in alone does not arm: a frames directory is required", () => {
	for (const out of [undefined, "", "relative/frames", "./frames"]) {
		const arming = resolveDevDriverArming({
			...normalLaunch,
			env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: out },
			windowMode: "headless",
		});
		assert.equal(arming.armed, false, `armed with out=${String(out)}`);
		assert.match(arming.problems.join(" "), /absolute frames directory/);
		// The refusal is printed: a driver run that silently has no bridge reads
		// exactly like a harness bug.
		assert.match(String(describeDevDriverArming(arming)), /not armed/);
	}
});

test("the driver never arms behind a window that could be raised", () => {
	const arming = resolveDevDriverArming({
		...normalLaunch,
		env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT },
	});
	assert.equal(arming.armed, false);
	assert.match(arming.problems.join(" "), /window-mode=headless/);
});

test("headless and inactive arm, and the banner names the frames directory", () => {
	for (const [source, env] of [
		["1", { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT }],
		["true", { [DEV_DRIVER_ENV]: "true", [DEV_DRIVER_OUT_ENV]: OUT }],
		["TRUE", { [DEV_DRIVER_ENV]: "TRUE", [DEV_DRIVER_OUT_ENV]: OUT }],
	]) {
		for (const windowMode of ["headless", "inactive"]) {
			const arming = resolveDevDriverArming({ env, windowMode });
			assert.equal(arming.armed, true, `${source} should arm in ${windowMode}`);
			assert.equal(arming.outDir, OUT);
			assert.deepEqual(arming.problems, []);
			assert.equal(
				describeDevDriverArming(arming),
				`[dev-driver] ARMED; frames are written to ${OUT}`,
			);
		}
	}
});

test("the mini-view exerciser is the armed headless launch and nothing else", () => {
	/*
	 * M-B1's gate (quick-send design §I.3): the app's OWN mini window exists in a
	 * headless run only when the dev driver is armed, so a rig can exercise the
	 * send path the desktop plane's frame gate otherwise refuses. Every other
	 * combination — a normal launch, an unarmed run, or an armed `inactive` run
	 * (visible by design) — must not create one, and nothing here can register a
	 * chord: registration stays `hotkeysAllowed`'s, asserted in window-mode's
	 * suite.
	 */
	const armed = resolveDevDriverArming({
		env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT },
		windowMode: "headless",
	});
	assert.ok(armed.armed);
	assert.equal(
		headlessExerciserAllowed({ arming: armed, windowMode: "headless" }),
		true,
	);
	assert.equal(
		headlessExerciserAllowed({ arming: armed, windowMode: "inactive" }),
		false,
		"an inactive launch is visible by design; no exerciser window may ride it",
	);
	assert.equal(
		headlessExerciserAllowed({ arming: armed, windowMode: "normal" }),
		false,
	);
	const unarmed = resolveDevDriverArming({ env: {}, windowMode: "headless" });
	assert.equal(unarmed.armed, false);
	assert.equal(
		headlessExerciserAllowed({ arming: unarmed, windowMode: "headless" }),
		false,
		"no opt-in, no window: an ordinary rig-shaped run stays the app it was",
	);
});

test("the preload's argument round-trips, and unintelligible is the same as absent", () => {
	const argv = [
		"/Applications/Local Operator.app/Contents/MacOS/Local Operator",
	];
	assert.equal(devDriverArgument(OUT), `${DEV_DRIVER_ARG}=${OUT}`);
	assert.deepEqual(readDevDriverArgument([...argv, devDriverArgument(OUT)]), {
		outDir: OUT,
	});
	for (const argvCase of [
		argv,
		[...argv, DEV_DRIVER_ARG],
		[...argv, `${DEV_DRIVER_ARG}=`],
		[...argv, `${DEV_DRIVER_ARG}=relative`],
		[...argv, `--something-else=${OUT}`],
	]) {
		assert.equal(
			readDevDriverArgument(argvCase),
			null,
			`argv ${JSON.stringify(argvCase)} must not yield a frames directory`,
		);
	}
});

test("the channel and world names are pinned, because a boot assertion greps them", () => {
	// `scripts/renderer-driver.mjs --gate-check` asserts Electron's own refusal
	// text for the capture channel, and the world key is what the renderer's
	// install module looks for. A rename that skipped this file would leave the
	// harness asserting a channel nothing registers any more — and passing.
	assert.equal(DEV_DRIVER_CAPTURE, "dev-driver-capture");
	assert.equal(DEV_DRIVER_FACTS, "dev-driver-facts");
	assert.equal(DEV_DRIVER_WORLD_KEY, "__loDevDriver");
	assert.equal(DEV_DRIVER_ARG, "--lo-dev-driver");
	assert.equal(DEV_DRIVER_ENV, "LOCAL_OPERATOR_UI_DEV_DRIVER");
	assert.equal(DEV_DRIVER_OUT_ENV, "LOCAL_OPERATOR_UI_DEV_DRIVER_OUT");
});

test("nothing in main registers a dev-driver channel outside the armed branch", () => {
	/*
	 * A structural guard, in the spirit of `window-mode.test.mjs`'s "no other
	 * file raises a window": the channels may only be registered by
	 * `registerDevDriverIPC`, and `index.ts` may only call it behind the arming
	 * decision. A future edit that registered a handler unconditionally would
	 * leave every other test in this file passing while a normal launch carried
	 * a reachable capture channel.
	 */
	const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8");
	const call = main.indexOf("registerDevDriverIPC({");
	assert.notEqual(
		call,
		-1,
		"index.ts no longer registers the dev driver at all",
	);
	const guard = main.lastIndexOf("if (devDriverArming.armed", call);
	assert.notEqual(
		guard,
		-1,
		"registerDevDriverIPC is not behind the arming decision",
	);
	assert.ok(
		call - guard < 200,
		"the arming check and the registration drifted apart; re-read the guard",
	);
	assert.match(
		main.slice(guard, call),
		/if \(devDriverArming\.armed && devDriverArming\.outDir\)/,
		"the registration is not the armed branch's",
	);

	const ipc = readFileSync(
		join(process.cwd(), "src/main/dev-driver-ipc.ts"),
		"utf8",
	);
	// Two established channels plus the separately gated observation seat;
	// any further channel still requires an explicit authority review.
	assert.equal(
		(ipc.match(/ipcMain\.handle\(/g) ?? []).length,
		3,
		"dev-driver-ipc.ts registers a channel count this file does not expect",
	);
	assert.ok(ipc.includes("if (options.observationOnly) installObservation();"));
	assert.ok(main.includes("observationOnly: devDriverObservation"));
	const preload = readFileSync(
		join(process.cwd(), "src/preload/index.ts"),
		"utf8",
	);
	assert.match(
		preload,
		/installDevDriverBridge\(\);/,
		"the preload no longer tries to install the bridge",
	);
});

/*
 * R1: the opt-in is a fact about the LAUNCH, so it is resolved from an
 * environment snapshot taken before this repository's own `.env` is folded in.
 *
 * `src/main/backend/config.ts` runs dotenv with `override: true` at import time,
 * so from that line onward `process.env` is "the launch, with a file at the cwd
 * folded in, and the file wins" — and reading the opt-in from it meant a
 * gitignored `.env` could arm a control surface on a trusted process and beat an
 * explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` typed at the shell.
 *
 * These two cases are source assertions rather than imports, because the fold
 * happens at import time in a module that reaches Electron and cannot be loaded
 * in a bare `node --test` process. The property itself is measured on REAL boots
 * by `node scripts/renderer-driver.mjs --gate-check`, which now boots four
 * inert launches — nothing set anywhere, a cwd `.env` carrying the opt-in, and
 * that same file carrying it while the environment says `=0` — and asserts no
 * bridge, no channel, no frame and no banner in each. What is pinned here is the
 * wiring those boots depend on, because a refactor that moved the read back to
 * `process.env` would leave every other test in this file passing.
 */
test("the launch environment is snapshotted before the .env is folded in", () => {
	/*
	 * The snapshot itself lives in `./launch-env` — it has to, because `logger.ts`
	 * reads a launch fact and cannot import `config.ts` back without a cycle — so
	 * this case asserts the two halves of the ordering rather than one statement's
	 * position: `config.ts` imports the snapshot module STATICALLY (a dependency is
	 * evaluated before the importing module's body, so the copy is taken before the
	 * fold in that body), and the module it imports is a leaf that imports nothing.
	 */
	const config = readFileSync(
		join(process.cwd(), "src/main/backend/config.ts"),
		"utf8",
	);
	const snapshotImport = config.indexOf('from "./launch-env"');
	const fold = config.indexOf("dotenvConfig({");
	assert.notEqual(
		snapshotImport,
		-1,
		"backend/config.ts no longer imports the launch snapshot",
	);
	assert.notEqual(
		fold,
		-1,
		"backend/config.ts no longer calls dotenvConfig; re-read this test",
	);
	assert.ok(
		snapshotImport < fold,
		"the .env fold comes before the snapshot import, so the snapshot is not a record of the launch",
	);
	assert.match(
		config,
		/export \{ launchEnv \};/,
		"backend/config.ts no longer re-exports launchEnv, which is where the launch facts are resolved from",
	);

	const snapshot = readFileSync(
		join(process.cwd(), "src/main/backend/launch-env.ts"),
		"utf8",
	);
	assert.doesNotMatch(
		snapshot,
		/^import /m,
		"the snapshot module must stay a leaf: an import in it is how it stops being evaluated before the fold",
	);
	/*
	 * A copy, not a live view: `process.env` is mutated by the dotenv call in
	 * `config.ts`, and a snapshot that kept referring to it would carry the file's
	 * values anyway.
	 */
	assert.match(
		snapshot,
		/export const launchEnv: Record<string, string \| undefined> = \{\s*\.\.\.process\.env,?\s*\}/,
		"launchEnv is not a copy of process.env",
	);
});

test("both launch facts are resolved from that snapshot, not the folded process.env", () => {
	const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8");
	for (const resolver of [
		"resolveWindowLaunchPlan({",
		"resolveDevDriverArming({",
	]) {
		const at = main.indexOf(resolver);
		assert.notEqual(at, -1, `index.ts no longer calls ${resolver}`);
		assert.match(
			main.slice(at, at + 400),
			/\n\tenv: launchEnv,/,
			`${resolver} must read launchEnv: a cwd .env must not be able to arm the driver or set a window mode that raises a window`,
		);
	}
	assert.doesNotMatch(
		main,
		/env: process\.env,/,
		"a launch fact is resolved from process.env again, which is the folded one",
	);
});

/* Numeric-only observer gate: no app boot, capture, input or page interaction. */
const observationSample = () => ({
	seq: 0,
	documentGeneration: 0,
	generation: 0,
	t: 0,
	phase: "preload-start",
	late: false,
	rootCount: 0,
	viewport: [1280, 900, 1],
	scroll: [0, 0],
	rows: [],
});
test("transcript observation requires both main driver arming and its separate exact opt-in", () => {
	for (const windowMode of ["normal", "headless", "inactive"]) {
		const armed = resolveDevDriverArming({
			env: { [DEV_DRIVER_ENV]: "1", [DEV_DRIVER_OUT_ENV]: OUT },
			windowMode,
		});
		assert.equal(
			observationMode(armed, { [TRANSCRIPT_OBSERVE_ENV]: "1" }),
			windowMode !== "normal",
		);
		assert.equal(observationMode(armed, {}), false);
		assert.equal(
			observationMode(armed, { [TRANSCRIPT_OBSERVE_ENV]: "true" }),
			false,
		);
	}
	assert.equal(
		observationMode(resolveDevDriverArming(normalLaunch), {
			[TRANSCRIPT_OBSERVE_ENV]: "1",
		}),
		false,
	);
});
test("observation DTO rejects text, selectors, unknown fields and excessive geometry", () => {
	assert.equal(validTranscriptObservation(observationSample()), true);
	for (const changed of [
		{ text: "private" },
		{ selector: "body" },
		{ script: "1+1" },
		{ url: "https://example.invalid" },
		{ seq: TRANSCRIPT_OBSERVE_LIMITS.samples },
		{ documentGeneration: 1 },
		{ generation: -1 },
		{ t: Number.POSITIVE_INFINITY },
		{ phase: "click" },
		{ viewport: [1280, 900, 9] },
		{ rootCount: 65 },
		{ scroll: [0, Number.NaN] },
		{ rows: Array.from({ length: 65 }, () => ({})) },
	])
		assert.equal(
			validTranscriptObservation({ ...observationSample(), ...changed }),
			false,
		);
	const row = {
		ordinal: 0,
		row: [0, 0, 100, 200],
		body: [0, 0, 100, 174],
		control: null,
		clientHeight: 174,
		scrollHeight: 1200,
		maxHeight: 174,
		expanded: null,
	};
	assert.equal(
		validTranscriptObservation({ ...observationSample(), rows: [row] }),
		true,
	);
	assert.equal(
		validTranscriptObservation({ ...observationSample(), rows: [row, row] }),
		false,
	);
	assert.equal(
		validTranscriptObservation({
			...observationSample(),
			rows: [{ ...row, text: "private" }],
		}),
		false,
	);
	assert.equal(
		validTranscriptObservation({
			...observationSample(),
			rows: [{ ...row, row: [0, 0, -1, 10] }],
		}),
		false,
	);
});
test("private preload branch precedes creation/exposure of the general scene bridge", () => {
	const preload = readFileSync("src/preload/dev-driver.ts", "utf8");
	const branch = preload.indexOf(
		"if (process.argv.includes(TRANSCRIPT_OBSERVE_ARG))",
	);
	assert.ok(branch > preload.indexOf("if (!armed) return false"));
	assert.ok(branch < preload.indexOf("const scenes = new Map"));
	assert.ok(
		preload
			.slice(branch, preload.indexOf("const scenes = new Map"))
			.includes("return true"),
	);
	assert.ok(
		!preload
			.slice(preload.indexOf("function installTranscriptObservation"))
			.includes("exposeInMainWorld"),
	);
});

/*
 * Inert Electron stub, not an app boot. This executes the SHIPPED handlers;
 * native pixels, initial paint and real preload ordering still require native QA.
 * The trusted-document predicate's established tests remain authoritative; this
 * seam makes URL/sender identity outcomes explicit without another Electron.
 */
const ELECTRON_FIXTURE_MODULE = /^electron$/;
const TRANSPORT_FIXTURE_MODULE = /^\.\/desktop-transport$/;
const ALL_FIXTURE_MODULES = /.*/;
const ipcBundle = await build({
	stdin: {
		contents:
			'export { registerDevDriverIPC } from "./src/main/dev-driver-ipc";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "inert-observation-electron",
			setup(builder) {
				builder.onResolve({ filter: ELECTRON_FIXTURE_MODULE }, () => ({
					path: "electron",
					namespace: "observation-fixture",
				}));
				builder.onResolve({ filter: TRANSPORT_FIXTURE_MODULE }, () => ({
					path: "transport",
					namespace: "observation-fixture",
				}));
				builder.onLoad(
					{ filter: ALL_FIXTURE_MODULES, namespace: "observation-fixture" },
					(args) => ({
						contents:
							args.path === "electron"
								? "export const ipcMain={handle:(name,fn)=>globalThis.__loObservationHandles.set(name,fn)};"
								: "export const trustedDesktopFrame=(url,expected)=>url===expected;",
					}),
				);
			},
		},
	],
});
const { registerDevDriverIPC } = await import(
	`data:text/javascript;base64,${Buffer.from(ipcBundle.outputFiles[0].text).toString("base64")}`
);
const OBSERVATION_CHANNEL = "dev-driver-transcript-observation";
const FIXTURE_URL = "file:///fixture/index.html";
const tickObservation = () => new Promise((done) => setImmediate(done));
function observationDriver(
	t,
	{
		enabled = true,
		occupiedReceipt = false,
		viewport = { width: 400, height: 300, devicePixelRatio: 1 },
	} = {},
) {
	const handles = new Map();
	globalThis.__loObservationHandles = handles;
	const out = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"lo-observation-",
		),
	);
	if (occupiedReceipt)
		writeFileSync(join(out, "transcript-observation.jsonl"), "PRIOR-RECEIPT");
	const contents = new EventEmitter();
	let captureCount = 0;
	Object.assign(contents, {
		mainFrame: { url: FIXTURE_URL },
		isDestroyed: () => false,
		executeJavaScript: async () => viewport,
		capturePage: async () => {
			captureCount++;
			return {
				getSize: () => ({ width: 400, height: 300 }),
				toPNG: () => Buffer.from("UNIT-FIXTURE-NOT-PNG"),
			};
		},
	});
	const owner = {
		webContents: contents,
		isDestroyed: () => false,
		getTitle: () => "fixture-secret-title",
		getContentBounds: () => ({ width: 400, height: 300 }),
		getBounds: () => ({ width: 400, height: 328 }),
		isVisible: () => false,
		isFocused: () => false,
		isMinimized: () => false,
	};
	let current = owner;
	registerDevDriverIPC({
		window: () => current,
		expectedUrl: FIXTURE_URL,
		outDir: out,
		identity: {
			windowMode: "headless",
			appVersion: "fixture",
			platform: "unit",
		},
		observationOnly: enabled,
	});
	t.after(() => {
		contents.emit("destroyed");
		handles.clear();
	});
	const event = { sender: contents, senderFrame: contents.mainFrame };
	// Equivalent to the existing generic preload invoke forwarding: channel
	// names are not restricted by absence of the private __loDevDriver bridge.
	const invoke = async (channel, ...args) => {
		const handler = handles.get(channel);
		if (!handler) throw new Error(`No handler registered for '${channel}'`);
		return handler(event, ...args);
	};
	const send = (sample) => handles.get(OBSERVATION_CHANNEL)(event, sample);
	const arm = () => {
		send(observationSample());
		send({ ...observationSample(), seq: 1, t: 1, phase: "observer-installed" });
		send({
			...observationSample(),
			seq: 2,
			t: 2,
			phase: "transcript-detected",
		});
	};
	const row = {
		ordinal: 0,
		row: [0, 0, 100, 264],
		body: [0, 0, 100, 174],
		control: [0, 174, 100, 30],
		clientHeight: 174,
		scrollHeight: 1200,
		maxHeight: 174,
		expanded: false,
	};
	const layout = (seq, time = seq * 16) => ({
		...observationSample(),
		seq,
		t: time,
		phase: "layout",
		rootCount: 1,
		rows: [row],
	});
	return {
		handles,
		event,
		contents,
		owner,
		send,
		invoke,
		arm,
		layout,
		out,
		captures: () => captureCount,
		replace: () => {
			current = { ...owner, webContents: new EventEmitter() };
		},
	};
}
test("observation handler is absent outside explicit mode; shared facts/capture contracts remain", async (t) => {
	const d = observationDriver(t, { enabled: false });
	assert.equal(d.handles.has(OBSERVATION_CHANNEL), false);
	const facts = d.handles.get(DEV_DRIVER_FACTS)(d.event);
	assert.equal(facts.title, "fixture-secret-title");
	assert.deepEqual(facts.contentBounds, { width: 400, height: 300 });
	const result = await d.handles.get(DEV_DRIVER_CAPTURE)(d.event, "contract");
	assert.deepEqual(
		Object.keys(result).sort(),
		["label", "path", "bytes", "pixels", "viewport"].sort(),
	);
	assert.equal(result.label, "contract");
	await assert.rejects(d.handles.get(DEV_DRIVER_CAPTURE)(d.event, "../bad"));
});
test("observation repeats owner/main-frame/URL authorization and refuses missing startup", (t) => {
	const d = observationDriver(t);
	const handler = d.handles.get(OBSERVATION_CHANNEL);
	for (const event of [
		{ ...d.event, sender: {} },
		{ ...d.event, senderFrame: { url: FIXTURE_URL } },
	])
		assert.throws(() => handler(event, observationSample()));
	d.contents.mainFrame.url = "https://untrusted.invalid";
	assert.throws(() => handler(d.event, observationSample()));
	d.contents.mainFrame.url = FIXTURE_URL;
	assert.throws(() =>
		d.send({ ...observationSample(), seq: 1, phase: "layout" }),
	);
	d.arm();
	assert.throws(() => d.send({ ...d.layout(3), text: "private" }));
});
test("stale generation/sequence, oversize and rate excess are refused without UI mutation", (t) => {
	const d = observationDriver(t);
	d.arm();
	d.send(d.layout(3));
	assert.throws(() => d.send(d.layout(3)));
	assert.throws(() => d.send({ ...d.layout(4), generation: 2 }));
	assert.throws(() => d.send(d.layout(4, 49)));
	assert.throws(() =>
		d.send({
			...d.layout(4),
			rows: Array.from({ length: 65 }, () => d.layout(4).rows[0]),
		}),
	);
});
test("serial capture attempts stop at three and receipts exclude title/text", async (t) => {
	const d = observationDriver(t);
	d.arm();
	for (let seq = 3; seq < 9; seq++) {
		d.send(d.layout(seq));
		await tickObservation();
	}
	assert.equal(d.captures(), 3);
	const evidence = readFileSync(
		join(d.out, "transcript-observation.jsonl"),
		"utf8",
	);
	assert.equal(evidence.includes("fixture-secret-title"), false);
	assert.equal(evidence.includes("UNIT-FIXTURE-NOT-PNG"), false);
	d.contents.emit("did-start-navigation", {}, "file:///next.html", false, true);
	assert.throws(() => d.send(d.layout(9)));
});
test("preallocation pixel guard refuses a large viewport before capturePage", async (t) => {
	const d = observationDriver(t, {
		viewport: { width: 5000, height: 5000, devicePixelRatio: 1 },
	});
	d.arm();
	d.send(d.layout(3));
	await tickObservation();
	assert.equal(d.captures(), 0);
	assert.ok(
		readFileSync(join(d.out, "transcript-observation.jsonl"), "utf8").includes(
			"capture-refused",
		),
	);
});

test("document lifetime expiration refuses samples even before the timer callback runs", (t) => {
	const original = globalThis.performance;
	let now = 0;
	Object.defineProperty(globalThis, "performance", {
		configurable: true,
		value: { now: () => now },
	});
	t.after(() =>
		Object.defineProperty(globalThis, "performance", {
			configurable: true,
			value: original,
		}),
	);
	const d = observationDriver(t);
	d.arm();
	now = TRANSCRIPT_OBSERVE_LIMITS.ttlMs + 1;
	assert.throws(() => d.send(d.layout(3)));
});
test("destroy and replacement cannot re-arm an old observation document", (t) => {
	const destroyed = observationDriver(t);
	destroyed.arm();
	destroyed.contents.emit("destroyed");
	assert.throws(() => destroyed.send(destroyed.layout(3)));
	const replaced = observationDriver(t);
	replaced.arm();
	replaced.replace();
	assert.throws(() => replaced.send(replaced.layout(3)));
});

const MISSING_LEGACY_HANDLER = /No handler registered/;
test("legacy bypass regression: generic invoke cannot overwrite an automatic observation PNG before expiry or after revocation", async (t) => {
	const d = observationDriver(t);
	d.arm();
	d.send(d.layout(3));
	await tickObservation();
	const png = join(d.out, "observation-0.png");
	const before = readFileSync(png);
	const count = d.captures();
	await assert.rejects(
		d.invoke(DEV_DRIVER_CAPTURE, "observation-0").then((result) => {
			t.diagnostic(
				`UNEXPECTED legacy capture completed; captures=${d.captures()}`,
			);
			return result;
		}),
		MISSING_LEGACY_HANDLER,
	);
	assert.deepEqual(readFileSync(png), before);
	assert.equal(d.captures(), count);
	d.contents.emit("did-start-navigation", {}, "file:///next.html", false, true);
	await assert.rejects(
		d.invoke(DEV_DRIVER_CAPTURE, "observation-0"),
		MISSING_LEGACY_HANDLER,
	);
	await assert.rejects(d.invoke(DEV_DRIVER_FACTS), MISSING_LEGACY_HANDLER);
	assert.deepEqual(readFileSync(png), before);
	assert.equal(d.captures(), count);
});
test("legacy bypass regression: generic invoke cannot expose title/output metadata in observation mode", async (t) => {
	const d = observationDriver(t);
	await assert.rejects(
		d.invoke(DEV_DRIVER_FACTS).then((result) => {
			t.diagnostic(
				`UNEXPECTED legacy facts exposed keys: ${Object.keys(result).join(",")}`,
			);
			return result;
		}),
		MISSING_LEGACY_HANDLER,
	);
	assert.equal(d.handles.has(DEV_DRIVER_CAPTURE), false);
});
test("legacy bypass regression: refused receipt path does not leave legacy capability behind", async (t) => {
	const d = observationDriver(t, { occupiedReceipt: true });
	assert.equal(d.handles.has(OBSERVATION_CHANNEL), false);
	await assert.rejects(
		d.invoke(DEV_DRIVER_CAPTURE, "observation-0"),
		MISSING_LEGACY_HANDLER,
	);
	await assert.rejects(d.invoke(DEV_DRIVER_FACTS), MISSING_LEGACY_HANDLER);
	assert.equal(d.captures(), 0);
	assert.equal(
		readFileSync(join(d.out, "transcript-observation.jsonl"), "utf8"),
		"PRIOR-RECEIPT",
	);
});
