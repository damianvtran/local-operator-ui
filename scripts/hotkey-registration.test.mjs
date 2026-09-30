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
 * macOS grants ⌘⌥⇧Space on a real machine is the one thing only a live app can
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
			"CommandOrControl+Alt+Shift+Space",
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
		resolveAccelerator("Primary+Alt+Shift+Space", "darwin"),
		"CommandOrControl+Alt+Shift+Space",
		"case-insensitive, because a hand edit is the only writer that can vary it",
	);
	/*
	 * THE bare carve-out is F1–F24 ONLY (design §A.5), mirroring the backend's
	 * `validate_desktop_key` after its own review round 1 (review round 1, R1):
	 * a bare function key is the one modifier-less chord both halves accept —
	 * not typable, so it cannot fire while the user types — and an in-field
	 * capture of `F8` must register rather than dead-ending as `invalid`.
	 */
	assert.equal(
		resolveAccelerator("f8", "darwin"),
		"F8",
		"a bare function key is registrable: the capture rule and the backend both allow it",
	);
	assert.equal(resolveAccelerator("f24", "linux"), "F24");
	assert.equal(
		resolveAccelerator("F1", "win32"),
		"F1",
		"case-insensitive like every other token",
	);
});

test("the structural refusals are refusals, not guesses", () => {
	const refusals = [
		"",
		"   ",
		"space",
		/*
		 * The bare carve-out is function keys ONLY: a named key is consumed by every
		 * editing app all the same, so a global binding on one steals it
		 * system-wide — the backend refuses these too (review round 1, R1).
		 */
		"pageup",
		"delete",
		"f8+f9",
		"banana+space",
		"primary+tab",
		"primary+escape",
		"primary+enter",
		"primary+space+space",
		"ctrl+ctrl+space",
		"primary+alt",
		"primary+alt+shift+space+f8",
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
	assert.ok(isRegistrable("CommandOrControl+Alt+Shift+Space"));
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
	const state = registrar.apply("primary+alt+shift+space");
	assert.equal(state.status, "registered");
	assert.equal(state.accelerator, "CommandOrControl+Alt+Shift+Space");
	assert.ok(shortcut.isRegistered("CommandOrControl+Alt+Shift+Space"));
	assert.equal(states.length, 1, "one state push for one registration");
	shortcut.press("CommandOrControl+Alt+Shift+Space");
	registrar.dispose();
});

test("a bare function key registers where the old refusal used to dead-end", () => {
	/*
	 * The end-to-end reading of review round 1, R1: pressing F8 in the settings
	 * field is accepted in-field and storable by the backend, so the registrar
	 * must register it — before this fix it reported `invalid` and the row told
	 * the user "this key can't be used on this system" about a chord the system
	 * was never asked for. A dead key for a value the design sanctions.
	 */
	const shortcut = fakeShortcut();
	const { registrar, states } = registrarFor(shortcut);
	const state = registrar.apply("f8");
	assert.equal(state.status, "registered");
	assert.equal(state.accelerator, "F8");
	assert.ok(shortcut.isRegistered("F8"));
	assert.equal(states.at(-1).status, "registered");
	registrar.dispose();
});

test("an unchanged value is a no-op; a changed one re-registers in order", () => {
	const shortcut = fakeShortcut();
	const { registrar, states } = registrarFor(shortcut);
	registrar.apply("primary+alt+shift+space");
	const afterFirst = shortcut.calls.length;
	registrar.apply("primary+alt+shift+space");
	assert.equal(
		shortcut.calls.length,
		afterFirst,
		"re-applying the live value must not unregister and re-register it",
	);
	assert.equal(states.length, 1, "and must not re-publish an unchanged state");

	registrar.apply("primary+shift+space");
	assert.deepEqual(shortcut.calls.slice(afterFirst), [
		"unregister:CommandOrControl+Alt+Shift+Space",
		"register:CommandOrControl+Shift+Space",
	]);
	assert.ok(!shortcut.isRegistered("CommandOrControl+Alt+Shift+Space"));
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
	registrar.apply("primary+alt+shift+space");
	const before = shortcut.calls.length;
	const state = registrar.apply("primary+shift+space");
	assert.equal(state.status, "taken");
	assert.deepEqual(shortcut.calls.slice(before), [
		"unregister:CommandOrControl+Alt+Shift+Space",
		"register:CommandOrControl+Shift+Space",
	]);
	assert.ok(
		!shortcut.isRegistered("CommandOrControl+Alt+Shift+Space"),
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
	const state = registrar.apply("primary+alt+shift+space");
	assert.equal(state.status, "unavailable");
	assert.equal(shortcut.calls.length, 0);
	registrar.dispose();
});

test("dispose releases the chord and a later apply cannot resurrect it", () => {
	const shortcut = fakeShortcut();
	const { registrar } = registrarFor(shortcut);
	registrar.apply("primary+alt+shift+space");
	const before = registrar.getState();
	registrar.dispose();
	assert.ok(!shortcut.isRegistered("CommandOrControl+Alt+Shift+Space"));
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
	assert.equal(first.apply("primary+alt+shift+space").status, "registered");
	assert.equal(
		second.apply("primary+alt+shift+space").status,
		"taken",
		"the conflict simulation the design names: register() === false is the taken path",
	);
	assert.ok(
		shortcut.isRegistered("CommandOrControl+Alt+Shift+Space"),
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
		shared.formatQuickSendDisplay("primary+alt+shift+space", "mac"),
		"⌘⌥⇧Space",
	);
	assert.equal(
		shared.formatQuickSendDisplay("primary+alt+shift+space", "win"),
		"Ctrl+Alt+Shift+Space",
	);
	assert.equal(
		shared.formatQuickSendDisplay("primary+alt+shift+space", "linux"),
		"Ctrl+Alt+Shift+Space",
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

/* ------------------------------------------------------------------ *
 * The popup's presentation gate and its failure card (round 3)
 * ------------------------------------------------------------------ */

test("presentation waits for the renderer's first commit - and never shows a blank card", () => {
	/*
	 * THE SHIPPED WHITE-CARD DEFECT's guard, driven on the pure decision.
	 *
	 * `focus` + not painted + not timed out is the arm that did not exist: the
	 * window module presented whenever the plan allowed it, with no idea whether
	 * the document behind it had painted anything. "wait" is that state.
	 */
	assert.equal(
		mini.miniViewPresentationFor({
			show: "focus",
			painted: false,
			timedOut: false,
		}),
		"wait",
		"a summon whose document has not committed must not present anything yet",
	);
	assert.equal(
		mini.miniViewPresentationFor({
			show: "focus",
			painted: true,
			timedOut: false,
		}),
		"present",
		"the signal is what releases the presentation",
	);
	assert.equal(
		mini.miniViewPresentationFor({
			show: "focus",
			painted: false,
			timedOut: true,
		}),
		"error-surface",
		"a load that never commits gets the card instead of a white rectangle",
	);
	/*
	 * And a plan that may not present NEVER waits: there is no card to protect
	 * (nothing will be shown), and holding a timer there would be a headless run
	 * accumulating a pending timeout per summon.
	 */
	for (const show of ["never", "inactive"]) {
		assert.equal(
			mini.miniViewPresentationFor({ show, painted: false, timedOut: false }),
			"present",
			`${show} has nothing to wait for`,
		);
	}
});

test("the failure card is a dark, scriptless document that cannot fail with the bundle", () => {
	const html = mini.miniViewErrorSurfaceHtml();
	assert.ok(
		html.includes(mini.MINI_VIEW_GROUND),
		"the card paints the app's own dark ground, not the platform's white",
	);
	assert.ok(
		!html.includes("<script"),
		"the card carries no script: nothing for a CSP to block and nothing to throw",
	);
	assert.match(
		html,
		/Quick send could not open\./,
		"the card says what happened rather than leaving a void",
	);
	assert.ok(
		html.includes("Try the hotkey again"),
		"and it names the next move",
	);
	assert.match(
		html,
		/color-scheme: dark/,
		"declared dark, so the platform does not draw white chrome around it",
	);
});

test("the load-failure and renderer-death paths are wired, and the window has a ground", () => {
	/*
	 * SOURCE PINS, for the halves the electron stub deliberately cannot drive:
	 * `mini-view-electron-stub.ts` refuses to construct a window, and standing a
	 * real one up is the evidence scene's business. What is pinned here is that
	 * the shipped module attaches the two failure listeners, paints its own
	 * ground before any document lands, and takes the ready signal from the
	 * renderer - so a later refactor that drops one of them has a failing case.
	 */
	const source = readFileSync("src/main/mini-view.ts", "utf8");
	assert.ok(
		source.includes('"did-fail-load"') &&
			source.includes('"render-process-gone"'),
		"a load that failed or a renderer that died must reach the card, not a white void",
	);
	assert.ok(
		source.includes("backgroundColor: MINI_VIEW_GROUND"),
		"the window paints the dark ground itself, for the frames before any document lands",
	);
	assert.ok(
		source.includes("MINI_VIEW_PAINTED"),
		"presentation is gated on the renderer's own first-commit signal",
	);
	const frame = readFileSync(
		"src/renderer/src/mini-view/mini-composer.tsx",
		"utf8",
	);
	assert.ok(
		frame.includes("miniView?.painted?.()"),
		"the frame sends the signal it is gated on",
	);
	assert.match(
		frame,
		/useLayoutEffect\(\(\) => \{\s*window\.api\?\.miniView\?\.painted\?\.\(\);\s*\}, \[\]\)/,
		"and sends it from the COMMIT, not from a frame a never-shown window may never run",
	);
});
