#!/usr/bin/env node
/**
 * The mini view's dictation rides the SHARED speech stack (#633): the
 * registration pair, the one dispatch, the release semantics, and the wire
 * half of the input-mode stamp.
 *
 * WHAT THIS FILE DRIVES. `use-speech-to-text-manager.ts` is the app's one
 * dictation dispatch: a surface registers a `{start, stop}` pair and the
 * manager owns the binding, the timing and the abort. The mini view's
 * controller (`mini-dictation.ts`) presents exactly that pair, and this file
 * drives the REAL manager against the REAL controller in node — the only fakes
 * are the microphone and the transcription relay, never the machinery:
 *
 *   1. registration {start, stop}: the pair the composer registers is what the
 *      manager's capture dispatch invokes, and the mini installs NO listener of
 *      its own — a created controller contributes zero window listeners, which
 *      is the "one stack, no parallel path" half;
 *   2. release semantics (the frozen contract): a release that beats
 *      `getUserMedia` ends the take the moment it exists (never an orphan
 *      recording), a release before the minimum clip is discarded after the
 *      fact, a kept release goes to `transcribing` and transcribes through the
 *      shared client exactly once, and an abort (a second key, the abort door)
 *      discards with no request at all;
 *   3. the stamp's wire half at the desktop contract's own body builder:
 *      capability off keeps the legacy body (`input_mode` absent, the field an
 *      older harness's `extra="forbid"` would refuse), capability on carries
 *      the exact `typed | dictated | mixed` value. The derivation itself —
 *      including the `mixed` case — is pinned in `mini-view-contract.test.mjs`.
 *
 * WHAT THEY ARE NOT: a real microphone or a real daemon (the mini rig drives
 * those; the deferred `getUserMedia` here exists so the release-before-start
 * timing is deterministic), and not the React call site itself — this host has
 * no renderer, so the composer's registration and coordination lines are
 * pinned by source below (the same shape the window-mode scans use for their
 * unreachable halves).
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * The patterns the bundler plugin and the source pins match on, hoisted to
 * module scope the way this tree's lint wants every regex that is not a
 * one-shot (useTopLevelRegex).
 */
const SHARED_PREFIX = /^@shared\//;
const TRANSCRIPTION_API_IMPORT =
	/^@shared\/api\/local-operator\/transcription-api$/;
const API_CONFIG_IMPORT = /^@shared\/config\/api-config$/;
const SHIM_NAMESPACE_ANY = /.*/;
const COMPOSER_SHARED_IMPORT =
	/from "@shared\/hooks\/use-speech-to-text-manager"/;
const COMPOSER_REGISTRATION = /useSpeechToTextManager\(\s*"mini-view"/;
const COMPOSER_PRIORITY = /SpeechToTextPriority\.MESSAGE_INPUT/;
const COMPOSER_COORDINATION =
	/setDictationActive\("mini-view", dictation === "recording"\)/;
const CONTROLLER_LISTENER = /addEventListener/;
const CONTROLLER_FORK = /new SpeechToTextManager/;

/* ---------------------------------------------------------------- *
 * The window stand-in, before anything importable is imported
 * ---------------------------------------------------------------- */

/*
 * The manager's listeners, recorded the way the DOM would deliver them —
 * `capture` normalised, because which phase a listener lands in is half of
 * what "one dispatch" means. `electron.ipcRenderer` accepts the subscription
 * the manager installs for the main-process toggle and never fires it: that
 * door belongs to the main window, and it is not this file's subject.
 */
const listeners = [];
globalThis.window = {
	addEventListener: (type, fn, options) => {
		listeners.push({
			type,
			fn,
			capture: options === true || options?.capture === true,
		});
	},
	removeEventListener: (type, fn) => {
		const index = listeners.findIndex((l) => l.type === type && l.fn === fn);
		if (index !== -1) listeners.splice(index, 1);
	},
	electron: {
		ipcRenderer: { on: () => {}, removeListener: () => {} },
	},
};

/*
 * The microphone: a delegating `getUserMedia` whose promise every test swaps
 * (`mic.next`), so the one interesting ordering — a release that lands while
 * the stream is still resolving — is a fact of the test, not a race.
 */
const mic = { next: null, calls: 0 };
const fakeStream = () => ({ getTracks: () => [{ stop: () => {} }] });
Object.defineProperty(globalThis, "navigator", {
	value: {
		platform: "MacIntel",
		mediaDevices: {
			getUserMedia: (constraints) => {
				mic.calls += 1;
				return mic.next(constraints);
			},
		},
	},
	configurable: true,
});

/*
 * The recorder: enough of the real machine's shape for the controller's own
 * calls, with `onstop` delivered as a microtask (the real one fires after
 * `stop` returns, which is what makes the discard paths interesting).
 */
const recorders = [];
class FakeMediaRecorder {
	constructor(stream) {
		this.stream = stream;
		this.state = "inactive";
		this.started = false;
		this.ondataavailable = null;
		this.onstop = null;
		recorders.push(this);
	}
	start() {
		this.state = "recording";
		this.started = true;
	}
	stop() {
		if (this.state === "inactive") return;
		this.state = "inactive";
		queueMicrotask(() => {
			this.ondataavailable?.({
				data: new Blob(["0123456789"], { type: "audio/webm" }),
			});
			this.onstop?.();
		});
	}
}
globalThis.MediaRecorder = FakeMediaRecorder;

/* ---------------------------------------------------------------- *
 * The bundles: shipped modules, with only mic + relay shimmed
 * ---------------------------------------------------------------- */

const bundleDir = join(
	process.cwd(),
	"node_modules",
	".tmp",
	`mini-view-dictation-${process.pid}`,
);
mkdirSync(bundleDir, { recursive: true });
after(() => {
	rmSync(bundleDir, { recursive: true, force: true });
});

const SHARED_ROOT = join(process.cwd(), "src", "renderer", "src", "shared");

/** Every relay call this run made, so "no parallel path" is countable. */
const transcriptionCalls = [];

const shimPlugin = {
	name: "mini-dictation-shims",
	setup(builder) {
		/*
		 * The two seams into the outside world are replaced, and NOTHING else:
		 * `transcription-api` becomes a recorder of relay calls that answers a
		 * deterministic transcript, `api-config` becomes a constant base URL.
		 * Everything else the controller imports — the failure-sentence module
		 * included — is the shipped code.
		 */
		builder.onResolve({ filter: TRANSCRIPTION_API_IMPORT }, () => ({
			path: "transcription-shim",
			namespace: "mini-shim",
		}));
		builder.onResolve({ filter: API_CONFIG_IMPORT }, () => ({
			path: "api-config-shim",
			namespace: "mini-shim",
		}));
		builder.onResolve({ filter: SHARED_PREFIX }, (args) => {
			/*
			 * A plugin-returned path is loaded as-is, so the extension the bare
			 * import implies is probed here; only `.ts` and `.tsx` are needed for
			 * the two modules this controller reaches (the failure sentences, and
			 * anything a future import beside them).
			 */
			const base = join(SHARED_ROOT, args.path.slice("@shared/".length));
			for (const extension of [".ts", ".tsx"]) {
				if (existsSync(base + extension)) return { path: base + extension };
			}
			return { path: base };
		});
		builder.onLoad(
			{ filter: SHIM_NAMESPACE_ANY, namespace: "mini-shim" },
			(args) => {
				if (args.path === "transcription-shim") {
					return {
						contents: `
					export const TranscriptionApi = {
						createTranscription: async (baseUrl, params) => {
							globalThis.__miniDictationCalls.push({ baseUrl, params });
							return {
								result: {
									text: "transcript from the shim",
									provider: "shim",
									status: "ok",
								},
							};
						},
					};`,
						loader: "js",
					};
				}
				return {
					contents:
						'export const apiConfig = { baseUrl: "http://127.0.0.1:0", radientBaseUrl: "", radientClientId: "" };',
					loader: "js",
				};
			},
		);
	},
};

const bundle = await build({
	stdin: {
		contents: `
			export { createMiniDictation } from "./src/renderer/src/mini-view/mini-dictation";
			export { SpeechToTextManager, SpeechToTextPriority, resolvePushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	plugins: [shimPlugin],
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundleFile = join(bundleDir, "mini-view-dictation.mjs");
writeFileSync(bundleFile, bundle.outputFiles[0].text);

const contractBundle = await build({
	stdin: {
		contents:
			'export { desktopEndpoint } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const contractFile = join(bundleDir, "desktop-contract.mjs");
writeFileSync(contractFile, contractBundle.outputFiles[0].text);

globalThis.__miniDictationCalls = transcriptionCalls;
const {
	createMiniDictation,
	SpeechToTextManager,
	SpeechToTextPriority,
	resolvePushToTalkBinding,
} = await import(pathToFileURL(bundleFile).href);
const { desktopEndpoint } = await import(pathToFileURL(contractFile).href);

/* ---------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------- */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A keydown the manager can consume, with the DOM bits it reads. */
const keyEvent = (key, code) => ({
	key,
	code,
	isComposing: false,
	repeat: false,
	defaultPrevented: false,
	preventDefault() {
		this.defaultPrevented = true;
	},
});

const ptt = resolvePushToTalkBinding();

/** The controller with its callbacks recorded, as the composer creates it. */
const createTake = () => {
	const events = { states: [], results: [], errors: [] };
	const controller = createMiniDictation({
		onState: (next) => events.states.push(next),
		onResult: (text) => events.results.push(text),
		onError: (sentence) => events.errors.push(sentence),
	});
	return { controller, events };
};

/**
 * A fresh manager with the mini's registration, and only ITS listeners driven
 * (each registration installs its own capture listener; leaving an older one
 * in the array would route a later test's presses into the previous manager).
 */
const newManager = (handler, isActive = () => true) => {
	listeners.length = 0;
	const manager = new SpeechToTextManager();
	manager.register(
		"mini-view",
		SpeechToTextPriority.MESSAGE_INPUT,
		handler,
		isActive,
	);
	const keydown = listeners.find((l) => l.type === "keydown" && l.capture)?.fn;
	const keyup = listeners.find((l) => l.type === "keyup" && !l.capture)?.fn;
	assert.ok(keydown, "the manager installs its capture-phase keydown");
	assert.ok(keyup, "and the keyup that releases the hold");
	return { manager, keydown, keyup };
};

/** The pair the composer hands the manager, over a real controller. */
const pairFor = (controller, delivered) => ({
	start: () => {
		delivered?.push("start");
		void controller.start();
	},
	stop: (reason) => {
		delivered?.push(`stop:${reason ?? "release"}`);
		controller.stop(reason);
	},
});

/* ---------------------------------------------------------------- *
 * Registration + dispatch, the one stack
 * ---------------------------------------------------------------- */

test("registration: {start, stop} is the pair, and the manager's dispatch is the only door", async () => {
	listeners.length = 0;
	transcriptionCalls.length = 0;
	const { controller, events } = createTake();
	/*
	 * THE "NO PARALLEL PATH" HALF, first: creating the controller installs no
	 * window listener at all. The dispatch is not the mini's — it is the shared
	 * manager's, and the mini reaches it only through the registration below.
	 */
	assert.equal(
		listeners.length,
		0,
		"a created mini controller contributes zero window listeners",
	);

	const delivered = [];
	const pair = pairFor(controller, delivered);
	assert.equal(typeof pair.start, "function");
	assert.equal(typeof pair.stop, "function");

	mic.next = async () => fakeStream();
	const { keydown, keyup } = newManager(pair);
	keydown(keyEvent("Alt", ptt.code));
	await flush();
	await flush();
	assert.deepEqual(
		delivered[0],
		"start",
		"the manager's engage dispatches the registered start",
	);
	assert.ok(
		events.states.includes("recording"),
		"and the controller is actually recording, not merely told to",
	);
	keyup(keyEvent("Alt", ptt.code));
	assert.equal(
		delivered[1],
		"stop:release",
		"keyup delivers the release reason verbatim",
	);
	await flush();
	await flush();
	/*
	 * This release arrived in the minimum-clip window, so the take is discarded
	 * (rule 2) — no request went out, which is also the proof that the release
	 * reached the CONTROLLER's own settle path and not some second one.
	 */
	assert.equal(events.states.includes("transcribing"), false);
	assert.equal(transcriptionCalls.length, 0);
	assert.equal(events.results.length, 0);
});

test("a release that beats getUserMedia ends the take the moment it exists", async () => {
	transcriptionCalls.length = 0;
	recorders.length = 0;
	const { controller, events } = createTake();
	let releaseGum = null;
	mic.next = () =>
		new Promise((resolve) => {
			releaseGum = resolve;
		});
	const { keydown, keyup } = newManager(pairFor(controller));
	keydown(keyEvent("Alt", ptt.code));
	await flush(); // the controller is inside getUserMedia now
	keyup(keyEvent("Alt", ptt.code)); // the release lands inside the window
	releaseGum(fakeStream());
	await flush();
	await flush();
	assert.equal(
		controller.state,
		"idle",
		"the take ended as soon as the recorder existed — never an orphan recording",
	);
	assert.equal(events.states.includes("transcribing"), false);
	assert.equal(transcriptionCalls.length, 0);
	assert.equal(recorders.length, 1);
	assert.equal(recorders[0].started, true);
	assert.equal(recorders[0].state, "inactive");
});

test("a kept release transcribes through the shared client, once", async () => {
	transcriptionCalls.length = 0;
	recorders.length = 0;
	const { controller, events } = createTake();
	mic.next = async () => fakeStream();
	const { keydown, keyup } = newManager(pairFor(controller));
	keydown(keyEvent("Alt", ptt.code));
	await flush();
	await flush();
	assert.ok(events.states.includes("recording"));
	await sleep(300); // past MIN_DICTATION_CLIP_MS
	keyup(keyEvent("Alt", ptt.code));
	assert.ok(
		events.states.includes("transcribing"),
		"the busy state goes up with the stop, not with the response",
	);
	await flush();
	await flush();
	await flush();
	assert.equal(transcriptionCalls.length, 1, "one take, one request");
	assert.equal(transcriptionCalls[0].params.file.name, "recording.webm");
	assert.deepEqual(events.results, ["transcript from the shim"]);
	assert.equal(controller.state, "idle");
	assert.equal(events.errors.length, 0);
});

test("an abort discards: the second key, and the cancel door", async () => {
	transcriptionCalls.length = 0;
	/* The second key lands mid-hold: the manager aborts, no request goes out. */
	const a = createTake();
	mic.next = async () => fakeStream();
	const first = newManager(pairFor(a.controller));
	first.keydown(keyEvent("Alt", ptt.code));
	await flush();
	await flush();
	await sleep(300);
	/*
	 * ESCAPE IS THE ONE SECOND KEY THE MANAGER CLAIMS: it preventDefaults the
	 * press (its QA-round-1 rung-4 contract), and that flag is exactly what the
	 * mini composer consults before its own Escape handling — so this assertion
	 * is the manager's half of the review-round-1 M2 fix, driven on the real
	 * dispatcher.
	 */
	const escClaim = keyEvent("Escape", "Escape");
	first.keydown(escClaim);
	assert.equal(
		escClaim.defaultPrevented,
		true,
		"the manager claims an Escape that aborts a hold",
	);
	await flush();
	await flush();
	assert.equal(a.controller.state, "idle");
	assert.equal(transcriptionCalls.length, 0);
	assert.equal(a.events.results.length, 0);

	/*
	 * A NON-ESCAPE second key aborts WITHOUT claiming: the bare modifier grew
	 * into a combination, and only the rung-4 key is held back from the layers
	 * below (the composer's own Escape handling must still see an unclaimed
	 * press when the key is not Escape — covered by the source pin's siblings,
	 * and here for the abort itself).
	 */
	const c = createTake();
	mic.next = async () => fakeStream();
	const third = newManager(pairFor(c.controller));
	third.keydown(keyEvent("Alt", ptt.code));
	await flush();
	await flush();
	await sleep(300);
	const other = keyEvent("j", "KeyJ");
	third.keydown(other);
	await flush();
	assert.equal(c.controller.state, "idle");
	assert.equal(other.defaultPrevented, false);
	assert.equal(transcriptionCalls.length, 0);

	/* And the controller's own abort door behaves identically. */
	const b = createTake();
	mic.next = async () => fakeStream();
	const second = newManager(pairFor(b.controller));
	second.keydown(keyEvent("Alt", ptt.code));
	await flush();
	await flush();
	await sleep(300);
	b.controller.cancel();
	await flush();
	await flush();
	assert.equal(b.controller.state, "idle");
	assert.equal(transcriptionCalls.length, 0);
	assert.equal(b.events.results.length, 0);
});

/* ---------------------------------------------------------------- *
 * The stamp's wire half
 * ---------------------------------------------------------------- */

test("the wire body: the legacy shape when off, the exact stamp when on", () => {
	const bodyFor = (inputMode) =>
		desktopEndpoint({
			op: "sessions.message",
			sessionId: "11111111-1111-1111-1111-111111111111",
			requestId: "r-mini-1",
			text: "hello",
			images: [],
			mode: "prompt",
			inputMode,
		}).body;
	const legacy = bodyFor(undefined);
	assert.equal(
		Object.hasOwn(legacy, "input_mode"),
		false,
		"feature off: the key is ABSENT, not present-and-empty",
	);
	for (const value of ["typed", "dictated", "mixed"]) {
		assert.equal(bodyFor(value).input_mode, value);
	}
});

/* ---------------------------------------------------------------- *
 * The composer's own half (source pins — no renderer on this host)
 * ---------------------------------------------------------------- */

test("the composer registers into the shared manager and keeps the presence", () => {
	/*
	 * The React call site cannot mount here (no renderer host), so its two
	 * lines are pinned as the shipped bytes: the registration into the shared
	 * module — not a local copy — and the dictation-active coordination. The
	 * controller's side of the same contract is driven for real above.
	 */
	const composer = readFileSync(
		join(process.cwd(), "src/renderer/src/mini-view/mini-composer.tsx"),
		"utf8",
	);
	assert.match(
		composer,
		COMPOSER_SHARED_IMPORT,
		"the registration comes from the shared module, not a second stack",
	);
	assert.match(composer, COMPOSER_REGISTRATION);
	assert.match(composer, COMPOSER_PRIORITY);
	assert.match(composer, COMPOSER_COORDINATION);
	const dictation = readFileSync(
		join(process.cwd(), "src/renderer/src/mini-view/mini-dictation.ts"),
		"utf8",
	);
	assert.doesNotMatch(
		dictation,
		CONTROLLER_LISTENER,
		"the controller installs no dispatch of its own",
	);
	assert.doesNotMatch(
		dictation,
		CONTROLLER_FORK,
		"and it never forks the stack",
	);
});
