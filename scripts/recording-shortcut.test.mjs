import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const bundleDir = join(
	ROOT,
	"node_modules",
	".tmp",
	`recording-${process.pid}`,
);
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/shared/recording-shortcut";',
			'export * from "./src/main/recording-shortcut";',
			'export * from "./src/main/local-config";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["yaml"],
});
const bundlePath = join(bundleDir, "recording.mjs");
const { mkdirSync } = await import("node:fs");
mkdirSync(bundleDir, { recursive: true });
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	DEFAULT_START_RECORDING_VALUE,
	RecordingShortcutCoordinator,
	watchLocalConfig,
	recordingShortcutLabel,
	recordingShortcutMatches,
} = await import(pathToFileURL(bundlePath).href);
const temp = mkdtempSync(join(tmpdir(), "recording-shortcut-"));
const env = { LOCAL_OPERATOR_CONFIG_DIR: temp };
const configPath = join(temp, "config.yml");
const press = (overrides = {}) => ({
	key: "s",
	control: false,
	meta: false,
	alt: false,
	shift: false,
	type: "keyDown",
	isAutoRepeat: false,
	...overrides,
});
const matches = (value, overrides = {}, platform = "darwin") =>
	recordingShortcutMatches(value, press(overrides), platform);
after(() => {
	rmSync(temp, { recursive: true, force: true });
	rmSync(bundleDir, { recursive: true, force: true });
});

test("the default preserves Cmd/Ctrl+Shift+S and rejects nearby chords", () => {
	assert.equal(DEFAULT_START_RECORDING_VALUE, "primary+shift+s");
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ meta: true, shift: true }),
			"darwin",
		),
		true,
	);
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ control: true, shift: true }),
			"linux",
		),
		true,
	);
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ meta: true, shift: true, key: "S" }),
			"darwin",
		),
		true,
	);
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ control: true, shift: true }),
			"darwin",
		),
		true,
		"the legacy Cmd/Ctrl+Shift+S default must keep accepting Control on macOS",
	);
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ control: true, meta: true, shift: true }),
			"darwin",
		),
		false,
		"primary accepts either physical modifier, not both at once",
	);
	assert.equal(
		recordingShortcutMatches(
			DEFAULT_START_RECORDING_VALUE,
			press({ meta: true, shift: true }),
			"linux",
		),
		false,
	);
	for (const input of [
		press({ meta: true }),
		press({ meta: true, shift: true, alt: true }),
		press({ shift: true }),

		press({ meta: true, shift: true, key: "p" }),
	]) {
		assert.equal(
			recordingShortcutMatches(DEFAULT_START_RECORDING_VALUE, input),
			false,
		);
	}
});

test("a saved rebind moves the native door and the old chord is inert", () => {
	const rebound = "primary+alt+r";
	assert.equal(matches(rebound, { meta: true, alt: true, key: "r" }), true);
	assert.equal(
		matches(rebound, { control: true, alt: true, key: "r" }, "linux"),
		true,
	);
	assert.equal(
		matches(rebound, { control: true, alt: true, key: "r" }),
		true,
		"the same Ctrl+Opt+R press that capture canonicalizes must dispatch",
	);
	assert.equal(matches(rebound, { meta: true, shift: true }), false);
	assert.equal(matches(rebound, { meta: true, key: "r" }), false);
});

test("literal modifiers, named keys, digits and function keys match exactly", () => {
	assert.equal(
		matches("ctrl+alt+delete", { control: true, alt: true, key: "Delete" }),
		true,
	);
	assert.equal(
		matches("ctrl+alt+delete", { meta: true, alt: true, key: "Delete" }),
		false,
	);
	assert.equal(
		matches("primary+ctrl+alt+delete", {
			control: true,
			meta: true,
			alt: true,
			key: "Delete",
		}),
		true,
	);
	assert.equal(
		matches(
			"primary+ctrl+alt+delete",
			{ control: true, meta: true, alt: true, key: "Delete" },
			"linux",
		),
		false,
	);
	assert.equal(
		matches(
			"primary+ctrl+alt+delete",
			{ control: true, alt: true, key: "Delete" },
			"linux",
		),
		true,
	);
	assert.equal(
		matches("meta+shift+7", { meta: true, shift: true, key: "7" }, "linux"),
		true,
	);
	assert.equal(matches("primary+up", { meta: true, key: "ArrowUp" }), true);
	assert.equal(
		matches("primary+space", { control: true, key: " " }, "linux"),
		true,
	);
	assert.equal(
		matches(
			"primary+meta+space",
			{ control: true, meta: true, key: " " },
			"linux",
		),
		true,
	);
	assert.equal(
		matches("primary+meta+space", { meta: true, key: " " }, "linux"),
		false,
	);
	assert.equal(matches("primary+meta+space", { meta: true, key: " " }), true);
	assert.equal(
		matches("primary+meta+space", { control: true, meta: true, key: " " }),
		false,
	);
	assert.equal(
		matches("shift+s", { shift: true }),
		true,
		"a valid backend Shift+S binding must dispatch",
	);
	assert.equal(matches("f8", { key: "F8" }), true);
	assert.equal(matches("f8", { key: "F8", shift: true }), false);
});

test("only one non-repeating keyDown can toggle", () => {
	assert.equal(
		matches(DEFAULT_START_RECORDING_VALUE, {
			meta: true,
			shift: true,
			type: "keyUp",
		}),
		false,
	);
	assert.equal(
		matches(DEFAULT_START_RECORDING_VALUE, {
			meta: true,
			shift: true,
			isAutoRepeat: true,
		}),
		false,
	);
	assert.equal(
		matches("shift+shift", { shift: true, key: "Shift" }),
		false,
		"a modifier cannot occupy the key position",
	);
	assert.equal(
		matches("bogus+s", { meta: true, shift: true }),
		false,
		"unknown modifiers fail closed",
	);
});

test("config reads cache default, saved and invalid states without per-key disk reads", () => {
	const binding = new RecordingShortcutCoordinator(env);
	assert.equal(binding.matches(press({ meta: true, shift: true })), true);
	writeFileSync(
		configPath,
		"values:\n  keymap.start_recording: primary+alt+r\n",
	);
	binding.refresh(env);
	assert.equal(
		binding.matches(press({ meta: true, alt: true, key: "r" })),
		true,
	);
	assert.equal(binding.matches(press({ meta: true, shift: true })), false);
	// The key path must use the cached value, not reread a changed file.
	writeFileSync(
		configPath,
		"values:\n  keymap.start_recording: primary+shift+s\n",
	);
	assert.equal(
		binding.matches(press({ meta: true, alt: true, key: "r" })),
		true,
	);
	binding.refresh(env);
	assert.equal(binding.matches(press({ meta: true, shift: true })), true);
	writeFileSync(
		configPath,
		"values:\n  keymap.start_recording: [not, a, chord]\n",
	);
	binding.refresh(env);
	assert.equal(binding.matches(press({ meta: true, shift: true })), true);
	writeFileSync(configPath, "values: [broken\n");
	binding.refresh(env);
	assert.equal(binding.matches(press({ meta: true, shift: true })), true);
	assert.equal(binding.getState().value, "primary+shift+s");
});

test("negative control: another action's saved chord never starts recording", () => {
	const binding = new RecordingShortcutCoordinator(env);
	writeFileSync(configPath, "values:\n  keymap.push_to_talk: primary+alt+r\n");
	binding.refresh(env);
	assert.equal(
		binding.matches(press({ meta: true, alt: true, key: "r" })),
		false,
	);
	assert.equal(binding.matches(press({ meta: true, shift: true })), true);
});

test("claims admit edits and resets, reject stale revisions, and clear shadow state", () => {
	writeFileSync(configPath, "values:\n  keymap.start_recording: primary+j\n");
	const problems = [];
	const binding = new RecordingShortcutCoordinator(env, "darwin", (message) =>
		problems.push(message),
	);
	assert.equal(
		binding.setClaims(2, [{ chord: "primary+j", label: "Console" }]),
		true,
	);
	assert.equal(
		binding.setClaims(1, [{ chord: "primary+p", label: "Palette" }]),
		false,
	);
	assert.equal(
		binding.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "meta+j",
		}).status,
		409,
	);
	assert.equal(
		binding.admit({ op: "settings.reset", key: "keymap.start_recording" }),
		null,
	);
	binding.setClaims(5, [{ chord: "primary+shift+s", label: "Panel" }]);
	assert.equal(
		binding.admit({ op: "settings.reset", key: "keymap.start_recording" })
			.status,
		409,
	);
	binding.setClaims(6, [{ chord: "primary+j", label: "Console" }]);
	assert.equal(
		binding.admit({
			op: "settings.edit",
			key: "keymap.quick_send",
			value: "meta+j",
		}),
		null,
	);
	assert.equal(binding.matches(press({ meta: true, key: "j" })), false);
	assert.equal(binding.getState().shadowedBy, "Console");
	binding.setClaims(7, [{ chord: "primary+p", label: "Palette" }]);
	assert.equal(binding.getState().shadowedBy, undefined);
	binding.setClaims(8, [{ chord: "primary+j", label: "Console" }]);
	binding.getState();
	assert.ok(
		problems.filter((message) => message.includes("inactive")).length >= 2,
	);
	binding.clearClaims();
	assert.equal(binding.getState().shadowedBy, undefined);
});

test("pending claims and invalid shapes fail closed", () => {
	const binding = new RecordingShortcutCoordinator(env);
	binding.markPending("primary+shift+s");
	assert.equal(
		binding.admit({ op: "settings.reset", key: "keymap.start_recording" }),
		null,
	);
	assert.equal(binding.getState().pending, "primary+shift+s");
	binding.markPending();
	assert.equal(binding.getState().pending, undefined);
	assert.equal(binding.setClaims(1, [{ chord: "raw", label: "bad" }]), false);
});

test("Option-transformed keys recover physical codes without breaking layouts", () => {
	assert.equal(
		matches("primary+alt+r", { key: "®", code: "KeyR", alt: true, meta: true }),
		true,
	);
	assert.equal(
		matches("primary+q", { key: "q", code: "KeyA", meta: true }),
		true,
	);
	assert.equal(
		matches("primary+a", { key: "q", code: "KeyA", meta: true }),
		false,
	);
});

test("primary and literal ctrl/meta remain exact per platform", () => {
	assert.equal(matches("primary+meta+s", { meta: true, shift: false }), true);
	assert.equal(matches("primary+meta+s", { meta: true, control: false }), true);
	assert.equal(matches("primary+meta+s", { meta: true, control: true }), false);
	assert.equal(
		matches("primary+meta+s", { meta: true, control: false, key: "s" }),
		true,
	);
	assert.equal(matches("primary+ctrl+s", { control: true }, "linux"), true);
	assert.equal(
		matches("primary+ctrl+s", { control: true, meta: true }, "linux"),
		false,
	);
	assert.equal(
		matches("primary+ctrl+s", { control: true, meta: true }, "darwin"),
		true,
	);
});

test("independent watcher observes changes without hotkeys and stops cleanly", async () => {
	writeFileSync(
		configPath,
		"values:\n  keymap.start_recording: primary+alt+r\n",
	);
	let reads = 0;
	const binding = new RecordingShortcutCoordinator(env);
	const original = binding.refresh.bind(binding);
	binding.refresh = () => {
		reads += 1;
		original();
	};
	const watcher = watchLocalConfig({
		env,
		intervalMs: 10,
		debounceMs: 1,
		onConfigChange: () => binding.refresh(),
		onProblem: (message) => assert.fail(message),
	});
	try {
		writeFileSync(
			configPath,
			"values:\n  keymap.start_recording: primary+alt+x\n",
		);
		for (let attempt = 0; attempt < 50 && reads === 0; attempt += 1)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.ok(reads > 0);
		assert.equal(binding.getState().value, "primary+alt+x");
	} finally {
		watcher.stop();
	}
	const stoppedReads = reads;
	writeFileSync(
		configPath,
		"values:\n  keymap.start_recording: primary+alt+z\n",
	);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(reads, stoppedReads);
});

test("an explicit platform host keeps literal modifiers exact without a global process", async () => {
	const browserBundle = await build({
		stdin: {
			contents: 'export * from "./src/shared/recording-shortcut";',
			resolveDir: ROOT,
		},
		bundle: true,
		format: "cjs",
		platform: "browser",
		write: false,
	});
	const source = browserBundle.outputFiles[0].text;
	const module = { exports: {} };
	const context = vm.createContext({
		navigator: { platform: "MacIntel" },
		module,
		exports: module.exports,
		process: { platform: "darwin" },
		// The bundle owns its source and must not need either CommonJS require
		// or a Node process. vm.runInNewContext is available without VM flags.
		require: () => {
			throw new Error("the shared grammar must not require a Node-only import");
		},
	});
	vm.runInNewContext(source, context);
	assert.equal(
		module.exports.canonicalRecordingChord("meta+shift+s"),
		"meta+shift+s",
	);
	assert.equal(
		module.exports.canonicalRecordingChord("primary+shift+s"),
		"primary+shift+s",
	);
	assert.equal(
		module.exports.recordingShortcutMatches("primary+shift+s", {
			type: "keyDown",
			key: "s",
			meta: true,
			shift: true,
		}),
		true,
	);
	// The browser fallback is a separate host: no Node global exists, and the
	// navigator must still dispatch the default Mac chord. Checking this with
	// an explicit platform argument would bypass the behavior under test.
	// Assign undefined rather than deleting: this changes the VM host's global
	// binding for the fallback probe without a lint-forbidden delete operation.
	context.process = undefined;
	assert.equal(vm.runInNewContext("globalThis.process", context), undefined);
	assert.equal(
		module.exports.recordingShortcutMatches("primary+shift+s", {
			type: "keyDown",
			key: "s",
			meta: true,
			shift: true,
		}),
		true,
	);
});

test("labels follow the effective saved chord on every platform", () => {
	assert.equal(recordingShortcutLabel(undefined, "mac"), "⌘⇧S");
	assert.equal(recordingShortcutLabel(undefined, "linux"), "Ctrl+Shift+S");
	assert.equal(recordingShortcutLabel("primary+alt+r", "win"), "Ctrl+Alt+R");
	assert.equal(recordingShortcutLabel("primary+alt+r", "mac"), "⌘⌥R");
	assert.equal(recordingShortcutLabel("", "linux"), "Ctrl+Shift+S");
});

test("primary conflicts cover literal Ctrl and Meta in both directions", () => {
	const binding = new RecordingShortcutCoordinator(env, "darwin");
	writeFileSync(configPath, "values:\n  keymap.start_recording: ctrl+s\n");
	binding.refresh(env);
	assert.equal(
		binding.setClaims(1, [{ chord: "primary+s", label: "Console" }]),
		true,
	);
	assert.equal(
		binding.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "meta+s",
		}).status,
		409,
	);
	assert.equal(binding.getState().shadowedBy, "Console");
	binding.setClaims(2, []);
	writeFileSync(configPath, "values:\n  keymap.start_recording: primary+s\n");
	binding.refresh(env);
	assert.equal(
		binding.setClaims(3, [{ chord: "ctrl+s", label: "Console" }]),
		true,
	);
	assert.equal(
		binding.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "primary+s",
		}).status,
		409,
	);
	binding.setClaims(4, []);
	assert.equal(
		binding.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "primary+s",
		}),
		null,
	);
	assert.equal(
		binding.setClaims(5, [{ chord: "primary+s", label: "Panel" }]),
		true,
	);
	assert.equal(
		binding.admit({ op: "settings.reset", key: "keymap.start_recording" }),
		null,
	);
	assert.equal(
		binding.setClaims(6, [{ chord: "primary+shift+s", label: "Panel" }]),
		true,
	);
	assert.equal(
		binding.admit({ op: "settings.reset", key: "keymap.start_recording" })
			.status,
		409,
	);
	const linux = new RecordingShortcutCoordinator(env, "linux");
	assert.equal(
		linux.setClaims(1, [{ chord: "primary+s", label: "Console" }]),
		true,
	);
	assert.equal(
		linux.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "ctrl+s",
		}).status,
		409,
	);
	assert.equal(
		linux.admit({
			op: "settings.edit",
			key: "keymap.start_recording",
			value: "meta+s",
		}),
		null,
	);
});

test("the untrusted IPC claim boundary rejects malformed containers and members", () => {
	const binding = new RecordingShortcutCoordinator(env);
	for (const claims of [
		null,
		{},
		[null],
		[42],
		[{ chord: "primary+s" }],
		[{ chord: 1, label: "Console" }],
		Array.from({ length: 129 }, () => ({
			chord: "primary+s",
			label: "Console",
		})),
	]) {
		assert.doesNotThrow(() => binding.setClaims(1, claims));
		assert.equal(binding.setClaims(1, claims), false);
	}
	assert.equal(binding.setClaims(Number.NaN, []), false);
	assert.equal(binding.setClaims(Number.MAX_SAFE_INTEGER + 1, []), false);
});

test("duplicate file signals publish one effective config change", async () => {
	const config = join(temp, "config.yml");
	writeFileSync(config, "values:\n  keymap.start_recording: ctrl+alt+r\n");
	let revisions = 0;
	const binding = new RecordingShortcutCoordinator(env);
	const watcher = watchLocalConfig({
		env,
		intervalMs: 10,
		debounceMs: 1,
		onConfigChange: () => {
			revisions += 1;
			binding.refresh(env);
		},
		onProblem: (message) => assert.fail(message),
	});
	try {
		// The first filesystem event starts the watcher; it is not emitted from
		// the constructor. Poll for that actual event rather than assuming a
		// fixed wall-clock delay on a busy CI host.
		for (let attempt = 0; attempt < 100 && revisions === 0; attempt += 1)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(revisions, 1);
		const before = revisions;
		writeFileSync(config, "values:\n  keymap.start_recording: ctrl+alt+t\n");
		for (let attempt = 0; attempt < 100 && revisions === before; attempt += 1)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(revisions, before + 1, "watchFile and directory watch dedupe");
		utimesSync(config, new Date(), new Date());
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(revisions, before + 1, "mtime-only touch has no revision");
	} finally {
		watcher.stop();
	}
});

test("wiring retains the main door and excludes only the owned reserved chord", () => {
	const main = readFileSync(join(ROOT, "src/main/index.ts"), "utf8");
	assert.match(main, /recordingShortcut\.matches\(input\)/);
	assert.match(main, /webContents\.send\("start-speech-to-text"\)/);
	assert.doesNotMatch(main, /Start speech to text: Cmd\/Ctrl/);
	const registry = readFileSync(
		join(ROOT, "src/renderer/src/shared/keymap/keymap-registry.ts"),
		"utf8",
	);
	assert.doesNotMatch(registry, /speech\.toggle/);
});
