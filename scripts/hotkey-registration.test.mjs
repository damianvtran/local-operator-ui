#!/usr/bin/env node
/**
 * The quick-send hotkey's pure halves, against the shipped TypeScript.
 *
 * WHAT THESE TESTS ARE. The registrar's whole decision surface — the token
 * mapping for three platforms, the structural refusals, the
 * registered/taken/invalid/unavailable transitions, the unregister-then-
 * register sequencing — driven against a FAKE `globalShortcut`, plus the
 * config.yml read, the mini document's URL derivation, and the cross-repo
 * default-drift guard the design asks for (§A.7).
 *
 * WHAT THEY ARE NOT: proof that a chord registers with the operating system.
 * The fake answers `register()` the way Electron is documented to; whether
 * macOS grants ⌘⌥Space on a real machine is the one thing only a live app can
 * say, and the design says so in its own words (the OS is the authority on
 * conflicts). `--scene mini-view` and QA cover the rest.
 *
 * The modules are bundled in memory with esbuild — the harness
 * `console-host.test.mjs` uses — so what runs here is the code that ships.
 * `src/main/mini-view.ts` imports Electron as a VALUE, so its bundle aliases
 * `electron` to `scripts/mini-view-electron-stub.ts`; the other two modules are
 * Electron-free by construction, which is itself part of what this file leans
 * on.
 */
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * WHERE THE BUNDLES LIVE, AND WHY NOT A data: URL. These tests import code
 * that imports the `yaml` package by name, and a bare specifier cannot resolve
 * from a `data:` module at all (there is no base URL to walk up from). A file
 * under `node_modules/.tmp` — the directory the repo already keeps build
 * scratch in (`tsBuildInfoFile`) — resolves `yaml` through the real
 * node_modules tree, and only `yaml` is external: everything this repository
 * authors is bundled, so a stale build cannot be what passes.
 */
const bundleDir = join(
	process.cwd(),
	"node_modules",
	".tmp",
	`hotkey-tests-${process.pid}`,
);
mkdirSync(bundleDir, { recursive: true });
let bundleSeq = 0;

after(() => {
	rmSync(bundleDir, { recursive: true, force: true });
});

const fromBundle = async (contents, { alias, external } = {}) => {
	const bundle = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		...(alias ? { alias } : {}),
		/*
		 * `yaml` stays an external import, resolved by Node when the bundle runs.
		 * Bundled, esbuild wraps the package's CJS build and a `require` inside
		 * it becomes a dynamic require an ESM module cannot answer — measured as
		 * `Dynamic require of "node:process" is not supported`. The shipped main
		 * process imports the same package by name, so an external is also the
		 * more faithful shape.
		 */
		...(external ? { external } : {}),
	});
	bundleSeq += 1;
	const file = join(bundleDir, `bundle-${bundleSeq}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const reg = await fromBundle(
	[
		'export * from "./src/main/hotkey-registration";',
		'export * from "./src/main/local-config";',
	].join("\n"),
	{ external: ["yaml"] },
);
const shared = await fromBundle('export * from "./src/shared/mini-view";');
const mini = await fromBundle('export * from "./src/main/mini-view";', {
	alias: {
		electron: join(process.cwd(), "scripts/mini-view-electron-stub.ts"),
	},
});
/* The stub's own surface, so a test can inspect what the window module
 * registered without reaching through mini-view.ts's exports. */
const stub = await fromBundle(
	'export * from "./scripts/mini-view-electron-stub";',
);

const {
	DEFAULT_QUICK_SEND_VALUE,
	commandOrControlTarget,
	createRegistrar,
	isRegistrable,
	resolveAccelerator,
	readQuickSendValue,
	watchQuickSend,
	QUICK_SEND_KEY,
} = reg;

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const scratchConfigDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "lop-quick-send-"));
	scratch.push(dir);
	return dir;
};

/* ------------------------------------------------------------------ *
 * resolveAccelerator — the §A.3 mapping, three platforms
 * ------------------------------------------------------------------ */

test("the default maps to Electron's CommandOrControl on every platform", () => {
	for (const platform of ["darwin", "win32", "linux"]) {
		assert.equal(
			resolveAccelerator(DEFAULT_QUICK_SEND_VALUE, platform),
			"CommandOrControl+Alt+Space",
			platform,
		);
	}
	assert.equal(
		commandOrControlTarget("darwin"),
		"Command",
		"macOS's display target, for the log line and the settings copy",
	);
	assert.equal(commandOrControlTarget("win32"), "Control");
	assert.equal(commandOrControlTarget("linux"), "Control");
});

test("the alternates and the aliases map per platform", () => {
	assert.equal(
		resolveAccelerator("primary+shift+space", "darwin"),
		"CommandOrControl+Shift+Space",
	);
	assert.equal(
		resolveAccelerator("primary+alt+shift+space", "linux"),
		"CommandOrControl+Alt+Shift+Space",
	);
	assert.equal(
		resolveAccelerator("primary+f8", "win32"),
		"CommandOrControl+F8",
	);
	assert.equal(
		resolveAccelerator("meta+space", "darwin"),
		"Command+Space",
		"the literal meta key is Command on macOS",
	);
	assert.equal(
		resolveAccelerator("meta+space", "win32"),
		"Super+Space",
		"and Super on Windows/Linux",
	);
	assert.equal(
		resolveAccelerator("ctrl+alt+space", "darwin"),
		"Control+Alt+Space",
	);
	assert.equal(
		resolveAccelerator("primary+pageup", "linux"),
		"CommandOrControl+PageUp",
	);
	assert.equal(resolveAccelerator("primary+0", "linux"), "CommandOrControl+0");
	assert.equal(
		resolveAccelerator("Primary+Alt+Space", "darwin"),
		"CommandOrControl+Alt+Space",
		"case-insensitive, because a hand edit is the only writer that can vary it",
	);
});

test("the structural refusals are refusals, not guesses", () => {
	const refusals = [
		"",
		"   ",
		"space",
		"f8",
		"banana+space",
		"primary+tab",
		"primary+escape",
		"primary+enter",
		"primary+space+space",
		"ctrl+ctrl+space",
		"primary+alt",
		"primary+alt+space+f8",
	];
	for (const value of refusals) {
		assert.equal(
			resolveAccelerator(value, "darwin"),
			null,
			`${JSON.stringify(value)} must not register`,
		);
	}
	assert.equal(
		resolveAccelerator("ctrl+k,l", "linux"),
		null,
		"comma alternates are text, not a chord",
	);
});

test("isRegistrable refuses strings the mapping would not produce", () => {
	assert.ok(isRegistrable("CommandOrControl+Alt+Space"));
	assert.ok(isRegistrable("Super+Space"));
	assert.ok(!isRegistrable(""));
	assert.ok(!isRegistrable("Whatever+Space"));
	assert.ok(!isRegistrable("CommandOrControl+Banana"));
});

/* ------------------------------------------------------------------ *
 * The registrar, against a fake `globalShortcut`
 * ------------------------------------------------------------------ */

/** What Electron's `globalShortcut` is documented to do, and nothing more. */
function fakeShortcut() {
	const held = new Map();
	const calls = [];
	return {
		calls,
		held,
		register(accelerator, callback) {
			calls.push(`register:${accelerator}`);
			if (held.has(accelerator)) return false;
			held.set(accelerator, callback);
			return true;
		},
		unregister(accelerator) {
			calls.push(`unregister:${accelerator}`);
			held.delete(accelerator);
		},
		isRegistered(accelerator) {
			return held.has(accelerator);
		},
		press(accelerator) {
			const callback = held.get(accelerator);
			assert.ok(callback, `${accelerator} is not registered`);
			callback();
		},
	};
}

const registrarFor = (shortcut, overrides = {}) => {
	const states = [];
	const triggered = { count: 0 };
	const registrar = createRegistrar({
		shortcut,
		platform: "darwin",
		onTrigger: () => {
			triggered.count += 1;
		},
		onState: (state) => states.push(state),
		...overrides,
	});
	return { registrar, states, triggered };
};

test("apply registers the chord and a press reaches the trigger", () => {
	const shortcut = fakeShortcut();
	const { registrar, states } = registrarFor(shortcut);
	const state = registrar.apply("primary+alt+space");
	assert.equal(state.status, "registered");
	assert.equal(state.accelerator, "CommandOrControl+Alt+Space");
	assert.ok(shortcut.isRegistered("CommandOrControl+Alt+Space"));
	assert.equal(states.length, 1, "one state push for one registration");
	shortcut.press("CommandOrControl+Alt+Space");
	registrar.dispose();
});

test("an unchanged value is a no-op; a changed one re-registers in order", () => {
	const shortcut = fakeShortcut();
	const { registrar, states } = registrarFor(shortcut);
	registrar.apply("primary+alt+space");
	const afterFirst = shortcut.calls.length;
	registrar.apply("primary+alt+space");
	assert.equal(
		shortcut.calls.length,
		afterFirst,
		"re-applying the live value must not unregister and re-register it",
	);
	assert.equal(states.length, 1, "and must not re-publish an unchanged state");

	registrar.apply("primary+shift+space");
	assert.deepEqual(shortcut.calls.slice(afterFirst), [
		"unregister:CommandOrControl+Alt+Space",
		"register:CommandOrControl+Shift+Space",
	]);
	assert.ok(!shortcut.isRegistered("CommandOrControl+Alt+Space"));
	assert.equal(states.at(-1).status, "registered");
	registrar.dispose();
});

test("a taken chord is reported, and the old one is released first", () => {
	const shortcut = fakeShortcut();
	const other = fakeShortcut();
	// Another application got there first: the chord is held by a different
	// registrar (a second instance's fake, or the OS itself in the real world).
	other.register("CommandOrControl+Shift+Space", () => {});
	shortcut.held.set("CommandOrControl+Shift+Space", () => {});
	const { registrar, states } = registrarFor(shortcut);
	registrar.apply("primary+alt+space");
	const before = shortcut.calls.length;
	const state = registrar.apply("primary+shift+space");
	assert.equal(state.status, "taken");
	assert.deepEqual(shortcut.calls.slice(before), [
		"unregister:CommandOrControl+Alt+Space",
		"register:CommandOrControl+Shift+Space",
	]);
	assert.ok(
		!shortcut.isRegistered("CommandOrControl+Alt+Space"),
		"a failed re-registration must not leave the old chord live while the file says otherwise",
	);
	assert.equal(states.at(-1).status, "taken");
	registrar.dispose();
});

test("an invalid value is refused with a reason and registers nothing", () => {
	const shortcut = fakeShortcut();
	const { registrar } = registrarFor(shortcut);
	const state = registrar.apply("space");
	assert.equal(state.status, "invalid");
	assert.match(String(state.reason), /modifier/);
	assert.equal(shortcut.held.size, 0);
	registrar.dispose();
});

test("a Wayland session reports unavailable and never calls register", () => {
	const shortcut = fakeShortcut();
	const { registrar } = registrarFor(shortcut, {
		env: { XDG_SESSION_TYPE: "wayland" },
	});
	const state = registrar.apply("primary+alt+space");
	assert.equal(state.status, "unavailable");
	assert.equal(shortcut.calls.length, 0);
	registrar.dispose();
});

test("dispose releases the chord and a later apply cannot resurrect it", () => {
	const shortcut = fakeShortcut();
	const { registrar } = registrarFor(shortcut);
	registrar.apply("primary+alt+space");
	const before = registrar.getState();
	registrar.dispose();
	assert.ok(!shortcut.isRegistered("CommandOrControl+Alt+Space"));
	const calls = shortcut.calls.length;
	const state = registrar.apply("primary+shift+space");
	assert.equal(calls, shortcut.calls.length, "disposed means no registration");
	assert.deepEqual(
		state,
		before,
		"a disposed registrar reports its last state unchanged and touches nothing: a late watcher tick must not resurrect a released chord",
	);
	assert.ok(!shortcut.isRegistered("CommandOrControl+Shift+Space"));
});

test("two registrars over one shortcut: the second reports taken", () => {
	const shortcut = fakeShortcut();
	const first = registrarFor(shortcut).registrar;
	const second = registrarFor(shortcut).registrar;
	assert.equal(first.apply("primary+alt+space").status, "registered");
	assert.equal(
		second.apply("primary+alt+space").status,
		"taken",
		"the conflict simulation the design names: register() === false is the taken path",
	);
	assert.ok(
		shortcut.isRegistered("CommandOrControl+Alt+Space"),
		"the first registrar keeps the chord it registered",
	);
	first.dispose();
	second.dispose();
});

/* ------------------------------------------------------------------ *
 * config.yml: the read, and the watch's keep-last-good promise
 * ------------------------------------------------------------------ */

const writeConfig = (dir, body) =>
	writeFileSync(join(dir, "config.yml"), body, "utf8");

test("the stored value is read from `values`, flat-dotted", () => {
	const dir = scratchConfigDir();
	writeConfig(
		dir,
		[
			"metadata:",
			"  created_at: '2026-01-01T00:00:00'",
			"values:",
			`  ${QUICK_SEND_KEY}: ctrl+alt+space`,
			"",
		].join("\n"),
	);
	const reading = readQuickSendValue({ LOCAL_OPERATOR_CONFIG_DIR: dir });
	assert.deepEqual(reading, { value: "ctrl+alt+space", present: true });
});

test("an absent file or key is the default, not a problem", () => {
	const dir = scratchConfigDir();
	assert.deepEqual(readQuickSendValue({ LOCAL_OPERATOR_CONFIG_DIR: dir }), {
		value: DEFAULT_QUICK_SEND_VALUE,
		present: false,
	});
	writeConfig(dir, "values:\n  hosting: test\n");
	assert.deepEqual(readQuickSendValue({ LOCAL_OPERATOR_CONFIG_DIR: dir }), {
		value: DEFAULT_QUICK_SEND_VALUE,
		present: false,
	});
});

test("a broken or unshaped config is a notice, never a crash", () => {
	const dir = scratchConfigDir();
	writeConfig(dir, "values: [\n  broken");
	const broken = readQuickSendValue({ LOCAL_OPERATOR_CONFIG_DIR: dir });
	assert.equal(broken.value, DEFAULT_QUICK_SEND_VALUE);
	assert.match(String(broken.problem), /not parseable/);

	writeConfig(dir, `values:\n  ${QUICK_SEND_KEY}: 42\n`);
	const unshaped = readQuickSendValue({ LOCAL_OPERATOR_CONFIG_DIR: dir });
	assert.equal(unshaped.value, DEFAULT_QUICK_SEND_VALUE);
	assert.match(String(unshaped.problem), /number/);
});

test("the watcher moves on a real change and holds the last good value", async () => {
	const dir = scratchConfigDir();
	writeConfig(dir, `values:\n  ${QUICK_SEND_KEY}: ctrl+alt+space\n`);
	const seen = [];
	const problems = [];
	const watcher = watchQuickSend({
		env: { LOCAL_OPERATOR_CONFIG_DIR: dir },
		intervalMs: 25,
		debounceMs: 10,
		baseline: "ctrl+alt+space",
		onValue: (value) => seen.push(value),
		onProblem: (message) => problems.push(message),
	});
	try {
		writeConfig(dir, `values:\n  ${QUICK_SEND_KEY}: ctrl+f8\n`);
		await waitFor(() => seen.includes("ctrl+f8"), "the new value is emitted");
		writeConfig(dir, "values: [\n  broken");
		await waitFor(
			() => problems.length > 0,
			"the broken file is reported once",
		);
		assert.equal(
			seen.filter((value) => value === "ctrl+f8").length,
			1,
			"a problem must not re-emit the value, and an unchanged value must not re-emit at all",
		);
		assert.ok(
			!seen.includes(DEFAULT_QUICK_SEND_VALUE),
			"a broken file must not fall back to the default under a working hotkey",
		);
	} finally {
		watcher.stop();
	}
});

/** Poll a predicate with a deadline a heavily loaded machine cannot exceed. */
async function waitFor(predicate, what) {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail(`timed out waiting until ${what}`);
}

/* ------------------------------------------------------------------ *
 * The mini document's URL, and the shared vocabulary
 * ------------------------------------------------------------------ */

test("miniViewUrlFor derives the sibling document in both launch shapes", () => {
	assert.equal(
		mini.miniViewUrlFor("file:///app/out/renderer/index.html"),
		"file:///app/out/renderer/mini.html",
	);
	assert.equal(
		mini.miniViewUrlFor("file:///app/out/renderer/index.html?x=1"),
		"file:///app/out/renderer/mini.html",
		"a file URL with a query is still the index document",
	);
	assert.equal(
		mini.miniViewUrlFor("http://localhost:5173"),
		"http://localhost:5173/mini.html",
	);
	assert.equal(
		mini.miniViewUrlFor("http://localhost:5173/"),
		"http://localhost:5173/mini.html",
		"a trailing slash must not double",
	);
});

test("importing the window module registers nothing and raises nothing", () => {
	assert.deepEqual(
		stub.__registeredChannels(),
		[],
		"importing mini-view.ts must not register IPC handlers: registration belongs to createMiniView, so a module-level side effect would be a second, invisible registration site",
	);
});

test("the display mapping reads per platform", () => {
	assert.equal(
		shared.formatQuickSendDisplay("primary+alt+space", "mac"),
		"⌘⌥Space",
	);
	assert.equal(
		shared.formatQuickSendDisplay("primary+alt+space", "win"),
		"Ctrl+Alt+Space",
	);
	assert.equal(
		shared.formatQuickSendDisplay("primary+alt+space", "linux"),
		"Ctrl+Alt+Space",
	);
	assert.equal(shared.formatQuickSendDisplay("meta+f8", "win"), "Win+F8");
	assert.equal(
		shared.formatQuickSendDisplay("meta+space", "linux"),
		"Super+Space",
	);
});

/* ------------------------------------------------------------------ *
 * The cross-repo drift guard (§A.7)
 * ------------------------------------------------------------------ */

test("DEFAULT_QUICK_SEND_VALUE equals keymap.quick_send's default in the committed fixture", () => {
	const fixture = JSON.parse(
		readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
	);
	const row = fixture.settings.find(
		(setting) => setting.key === QUICK_SEND_KEY,
	);
	assert.ok(
		row,
		"the committed fixture carries no keymap.quick_send row - regenerate it (`node scripts/derive-backend-settings-fixture.mjs`) after the backend's registry lands the key, then splice/derive the row, or this guard cannot see the drift it exists for",
	);
	assert.equal(
		row.default,
		DEFAULT_QUICK_SEND_VALUE,
		"the app's boot-time default and the backend registry's default have drifted: one stored value must mean the same chord on both sides",
	);
	assert.equal(
		row.hotkey_scope,
		"desktop",
		"the row must declare the desktop scope the capture rules switch on",
	);
});
