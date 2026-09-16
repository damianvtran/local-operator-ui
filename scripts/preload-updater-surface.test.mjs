import assert from "node:assert/strict";
import {
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/*
 * The preload's updater bridge: what it EXPOSES, and every fixture that claims to
 * mirror it.
 *
 * Two findings from review round 1, one cause - the bridge and its copies had no
 * test that bound them together.
 *
 * R1-4: `src/preload/index.ts` gained `onBackendUpdateError`, which is the half of
 * the reported hang's fix that was actually missing (the channel had no subscriber
 * because no bridge method existed). Nothing exercised it: the renderer suites
 * supply their OWN bridge (`updater.onBackendUpdateError = updater.on(...)`), so
 * deleting the method from the preload left every suite green while the shipped
 * panel threw at mount in the real app. The cases below load the REAL preload
 * against a stub `ipcRenderer`, so the method is asserted where it lives rather
 * than through a caller that could paper over it.
 *
 * R1-1: the same method broke every FIXTURE that mounts the panel. `update-
 * notification.tsx` subscribes in its mount effect with no guard, so a story or
 * evidence harness whose hand-written `window.api.updater` stub predates the
 * method throws `TypeError: ... is not a function` inside a passive effect - the
 * surface never paints, and nothing notices, because no gate renders a story and
 * `pnpm check-evidence` verifies the frames already committed rather than
 * re-driving the stories that produced them. Three rigs and two stories in this
 * tree were in exactly that state when it was found.
 *
 * So the second half of this file is a property, not a list: EVERY fixture that
 * installs a `window.api.updater` stub must carry the whole method set the preload
 * exposes. A list would have to be remembered whenever a fixture is added - which
 * is the failure being fixed - so the fixtures are DISCOVERED from the tree, and
 * the surface they are compared against is read from the loaded preload rather
 * than retyped here.
 *
 * What the discovery rule is, precisely, and what it deliberately leaves out:
 *
 *  - discovered: a file under `src/`, `scripts/` or `docs/evidence/` that assigns
 *    the bridge (`api.updater = {`, `api.updater ??= {`) or mounts one inside an
 *    api object literal (`window.api = { updater, ... }`, `api: { updater, ... }`).
 *    Those are the fixtures - the things a person or an agent wrote a FAKE bridge
 *    into so a surface could render outside Electron.
 *  - not discovered: `src/preload/**` (the definition itself) and `src/main/**`
 *    (the producers, which send on channels rather than subscribing to them). A
 *    test that drives the shipped component through its OWN bridge is discovered
 *    too, and belongs in the set: it is a mirror of the bridge like any other, and
 *    the panel's subscriptions are wired to it by hand.
 *  - the check is a NAME check, not an execution: a fixture may build its stub as
 *    an object literal (`onBackendUpdateError: unsub`) or as a name list
 *    (`for (const name of ["onBackendUpdateError"])`), and both shapes are in the
 *    tree, so a name must appear as an object key, an assignment target, or a
 *    quoted string entry. A name that appears ONLY in a comment would satisfy this
 *    and not the component; that is the limit of a static check, and it is why the
 *    loaded-preload cases above exist alongside it.
 */

const ROOT = process.cwd();

/* ------------------------------------------------------- the bridge, for real */

/**
 * A stub `ipcRenderer`, which is the only thing the preload needs from Electron.
 *
 * `on`/`removeListener` keep the same handler identity the preload passed, which
 * is what lets a case assert that the returned unsubscribe removes THE listener
 * rather than merely answering a call - the defect class this whole area had was a
 * bridge method that looked present and did not wire anything.
 */
const listeners = new Map();
const removed = [];
const registered = [];
const ipcRenderer = {
	invoke: async () => undefined,
	send: () => {},
	on: (channel, handler) => {
		const set = listeners.get(channel) ?? new Set();
		set.add(handler);
		listeners.set(channel, set);
		registered.push({ channel, handler });
		return ipcRenderer;
	},
	removeListener: (channel, handler) => {
		removed.push({ channel, handler });
		listeners.get(channel)?.delete(handler);
		return ipcRenderer;
	},
	removeAllListeners: (channel) => {
		listeners.delete(channel);
		return ipcRenderer;
	},
	once: (channel, handler) => ipcRenderer.on(channel, handler),
};

/** Deliver an event to every handler registered on a channel. */
const deliver = (channel, ...args) => {
	for (const handler of [...(listeners.get(channel) ?? [])])
		handler(null, ...args);
};

globalThis.__loPreloadIpcRenderer = ipcRenderer;
/*
 * `contextIsolated: true` is the branch the app actually takes (see the preload's
 * tail), and it is the branch that exposes `api` through `contextBridge` - which
 * is where this test reads the surface from. The other branch writes to a global
 * `window`, which a node process does not have.
 */
process.contextIsolated = true;

const bundlePath = join(ROOT, "scripts", "_preload-surface.bundle.mjs");
const bundle = await build({
	stdin: {
		contents: 'import "./src/preload/index";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, (args) => ({
					path: args.path,
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						export const ipcRenderer = globalThis.__loPreloadIpcRenderer;
						export const contextBridge = {
							exposeInMainWorld: (key, value) => {
								globalThis.__loPreloadExposed ??= {};
								globalThis.__loPreloadExposed[key] = value;
							},
						};
						export const webFrame = {
							insertCSS: () => "",
							removeInsertedCSS: () => {},
							setZoomFactor: () => {},
							setVisualZoomLevelLimits: async () => {},
						};
						export default { ipcRenderer, contextBridge, webFrame };
					`,
				}));
			},
		},
	],
});
/*
 * Written to a real file rather than imported from a `data:` URL, for the reason
 * the sibling suites state: a `data:` URL has no base for a relative resolution,
 * and a failure inside the bundle then reports as a wall of base64.
 */
writeFileSync(bundlePath, bundle.outputFiles[0].text);
await import(`${bundlePath}?v=${Date.now()}`);
unlinkSync(bundlePath);

const api = globalThis.__loPreloadExposed?.api;
assert.ok(
	api?.updater,
	"the preload must expose `api.updater` through contextBridge",
);

/** The method set the preload actually exposes, which is what fixtures must carry. */
const UPDATER_SURFACE = Object.keys(api.updater).sort();

/* ------------------------------------------------- the method, driven for real */

test("the preload exposes the whole updater surface, method by method", () => {
	for (const name of UPDATER_SURFACE) {
		assert.equal(
			typeof api.updater[name],
			"function",
			`api.updater.${name} must be a function`,
		);
	}
	/*
	 * Named rather than counted: this is the method whose absence from the preload
	 * left `backend-update-error` with no reader at all (review R1-4), and the one
	 * the fixtures below were missing (R1-1).
	 */
	assert.ok(
		UPDATER_SURFACE.includes("onBackendUpdateError"),
		`the preload must expose onBackendUpdateError; it exposes ${UPDATER_SURFACE.join(", ")}`,
	);
});

test("backend-update-error reaches the callback and the unsubscribe removes it", () => {
	const seen = [];
	const unsubscribe = api.updater.onBackendUpdateError((report) =>
		seen.push(report),
	);

	// The channel name is the contract with the main process, so it is asserted
	// rather than inferred from a round trip through the same name.
	assert.ok(
		registered.some(({ channel }) => channel === "backend-update-error"),
		`the subscription must be on \`backend-update-error\`; got ${registered.map(({ channel }) => channel).join(", ")}`,
	);
	assert.equal(
		typeof unsubscribe,
		"function",
		"the subscription must return its own unsubscribe, which every caller uses on unmount",
	);

	/*
	 * The payload is forwarded whole, phase included: the renderer reads the phase
	 * to decide the surface, so a bridge that unwrapped the message would put every
	 * report back to being judged by timing (review R2-1).
	 */
	const report = {
		message: "The server update failed to install.",
		phase: "update",
	};
	deliver("backend-update-error", report);
	assert.deepEqual(seen, [report]);

	const [entry] = registered.filter(
		({ channel }) => channel === "backend-update-error",
	);
	unsubscribe();
	assert.deepEqual(
		removed.map(({ channel }) => channel),
		["backend-update-error"],
		"unsubscribing must remove the listener, not merely be callable",
	);
	assert.equal(
		removed[0].handler,
		entry.handler,
		"the handler removed must be the one that was registered",
	);

	deliver("backend-update-error", {
		message: "A second failure nobody is listening for",
		phase: "update",
	});
	assert.deepEqual(
		seen,
		[report],
		"a removed listener must not be called again",
	);
});

test("the main process sends the channel the preload subscribes to", () => {
	/*
	 * Both ends spelled out, because a rename on one side is silent in this suite
	 * (each half's own tests use its own literal) and shows up as a renderer that
	 * never hears about a failure. `update-service.ts` is read rather than
	 * imported: importing it needs an Electron fixture for a single string.
	 */
	const service = readFileSync(
		join(ROOT, "src/main/update-service.ts"),
		"utf8",
	);
	assert.match(
		service,
		/"backend-update-error"/,
		"src/main/update-service.ts must send on `backend-update-error`",
	);
});

/* ------------------------------------------- every fixture that mirrors the bridge */

/** Extensions the fixtures are written in. `docs/evidence` holds `.mjs` rigs. */
const FIXTURE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".jsx"];
const FIXTURE_ROOTS = ["src", "scripts", "docs/evidence"];

/** A stub installed ON the bridge: `api.updater = {` or `api.updater ??= {`. */
const ASSIGNS_THE_BRIDGE = /api\.updater\s*(\?\?=|=)/;
/** A stub installed INSIDE one: `window.api = { updater, ... }`. */
const MOUNTS_THE_BRIDGE = /api\s*[:=]\s*\{[^}]{0,400}?\bupdater\b/s;

/** Where a method name has to appear to count as wired.
 *
 * Four shapes, because all four are in the tree: an object key (`name:`), a
 * method shorthand (`name(options) {`), an assignment (`updater.name = ...`),
 * and a quoted string in one of the name LISTS the evidence rigs build their stub
 * from. A call site also matches the shorthand form - which is why the fixtures
 * are filtered first, so a file is only asked this question once it has been
 * established that it installs a stub.
 */
const wired = (name) => new RegExp(`(?:\\b${name}\\s*[:(=]|["']${name}["'])`);

/** Files the sweep must not ask about: the definition, and the channel producers. */
const NOT_A_FIXTURE = [
	join(ROOT, "src", "preload"),
	join(ROOT, "src", "main"),
	/*
	 * And THIS file, which describes the stub shapes in prose - `api.updater = {`
	 * and `api.updater ??= {` appear above as examples, so the discovery rule finds
	 * it and then (correctly) reports it as a fixture with no methods in it. A
	 * scratch copy of the tree would hit the same thing in any file that documents
	 * the pattern, and the honest fix is to name the one file that is this check.
	 */
	fileURLToPath(import.meta.url),
];

function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (FIXTURE_EXTENSIONS.some((extension) => path.endsWith(extension)))
			out.push(path);
	}
	return out;
}

const fixtures = FIXTURE_ROOTS.flatMap((root) => walk(join(ROOT, root)))
	.filter((path) => !NOT_A_FIXTURE.some((skip) => path.startsWith(skip)))
	.filter((path) => {
		const source = readFileSync(path, "utf8");
		return ASSIGNS_THE_BRIDGE.test(source) || MOUNTS_THE_BRIDGE.test(source);
	});

test("every fixture that installs an updater stub carries the preload's whole surface", () => {
	/*
	 * A guard on the guard: an empty or shrunken set would make every assertion
	 * below pass vacuously, which is how a fixture sweep stops being one.
	 */
	assert.ok(
		fixtures.length >= 8,
		`expected the tree's updater fixtures; found ${fixtures.length} - the discovery rule is looking in the wrong place`,
	);

	const incomplete = [];
	for (const path of fixtures) {
		const source = readFileSync(path, "utf8");
		const missing = UPDATER_SURFACE.filter((name) => !wired(name).test(source));
		if (missing.length > 0) incomplete.push({ path, missing });
	}

	assert.deepEqual(
		incomplete.map(
			({ path, missing }) => `${relative(ROOT, path)}: ${missing.join(", ")}`,
		),
		[],
		"a fixture whose updater stub omits a method the preload exposes throws inside the mounted component's effect, and nothing in CI or `pnpm check-evidence` re-drives it - so the fixture has to carry all of them",
	);
});
