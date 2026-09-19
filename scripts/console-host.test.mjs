/**
 * Contract tests for the console host's main-process core.
 *
 * The shipped TypeScript is bundled in memory with esbuild — the same harness
 * `browser-host.test.mjs` uses — so what runs here is the code that ships, driven
 * against real filesystem state and real loopback HTTP.
 *
 * WHAT THESE TESTS ARE NOT: proof that a terminal works. The pty is a fake and the
 * window is a fake, so nothing here has ever spawned a real shell or photographed a
 * real pane. That is the host proof rig's job (`scripts/console-host-proof.mjs`),
 * and this file exists so a regression in the RULES — the caps, the byte log's
 * offsets, the grid's ownership, the failure taxonomy, the retention modes — is
 * caught without booting an app.
 *
 * The four measured facts these tests pin, each with the reason it is a test rather
 * than a comment:
 *   - the headless emulator parses ASYNCHRONOUSLY, so a read answered without
 *     `whenIdle` is a read one chunk behind (see `src/main/console/emulator.ts`);
 *   - the exec bit on `spawn-helper` is 0644 in the published tarball, so the mode
 *     is asserted and healed rather than assumed;
 *   - a hidden window's first `capturePage` can come back blank, so the capture
 *     retries exactly once;
 *   - the byte log's two numbers (a 4 MiB window under a 16 MiB ceiling) are a
 *     windowed trim, not a per-byte one.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/console/registry";',
			'export * from "./src/main/console/byte-log";',
			'export * from "./src/main/console/emulator";',
			'export * from "./src/main/console/osc133";',
			'export * from "./src/main/console/keys";',
			'export * from "./src/main/console/host";',
			'export * from "./src/main/console/history";',
			'export * from "./src/main/console/protocol";',
			'export * from "./src/main/console/dispatch";',
			'export * from "./src/main/console/pty";',
			'export * from "./src/main/console/ipc";',
			// The wire, and the record. `rpc.ts` is here so the console methods are
			// driven through the REAL endpoint — the same envelope, the same key check,
			// the same dispatch the app runs — rather than through a direct call into
			// the dispatcher.
			'export * from "./src/main/browser/protocol";',
			'export * from "./src/main/browser/rpc";',
			'export * from "./src/main/browser/state-file";',
			// The error class the refusals must be instances of, so `rpc.ts`'s
			// `instanceof` narrowing is what the tests exercise.
			'export { BrowserHostError } from "./src/main/browser/errors";',
			'export { ipcMain } from "electron";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// Only `console/ipc.ts` reaches Electron as a VALUE (`ipcMain`), and the stub
	// models exactly that plus a handler registry a test can invoke. Everything else
	// in this bundle imports Electron as types, which is erased.
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	ConsoleRegistry,
	MAX_AGENT_SURFACES_PER_SESSION,
	MAX_SURFACES_PER_APP,
	SURFACE_PREFIX,
	parseSurface,
	redactSurface,
	ByteLog,
	RETAIN_BYTES,
	CEILING_BYTES,
	createXtermEmulator,
	Osc133Scanner,
	NAMED_KEYS,
	encodeNamedKey,
	ConsoleHost,
	clampGrid,
	surfaceEnvironment,
	defaultShell,
	resolveCwd,
	wrapBracketedPaste,
	cropToWindow,
	DEFAULT_COLS,
	DEFAULT_ROWS,
	MIN_COLS,
	MAX_COLS,
	MIN_FRAME_BYTES,
	MAX_INPUT_BYTES,
	CLOSE_GRACE_MS,
	ConsoleHistory,
	fileStem,
	historyRoot,
	logPath,
	sidecarPath,
	HISTORY_FILE_MODE,
	HISTORY_DIR_MODE,
	HISTORY_ROTATE_BYTES,
	CONSOLE_METHODS,
	CONSOLE_ERROR_CODES,
	CONSOLE_COMMAND_TIMEOUTS_S,
	dispatchConsole,
	isConsoleDispatchMethod,
	METHODS,
	ERROR_CODES,
	PROTO_VERSION,
	COMMAND_TIMEOUTS_S,
	startRpcServer,
	RPC_PATH,
	KEY_HEADER,
	BrowserStateWriter,
	stateFilePath,
	BrowserHostError,
	registerConsoleIpc,
	unregisterConsoleIpc,
	CONSOLE_IPC_CHANNELS,
	CONSOLE_PUSH_CHANNELS,
	ensureSpawnHelperExecutable,
	unpackedPath,
	ipcMain,
} = mod;

const scratchDirs = [];
function scratch(prefix = "console-host-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

/** An isolated config root, so nothing here can reach the operator's own. */
function isolatedEnv(configDir, extra = {}) {
	return { ...shadowEnv(), LOCAL_OPERATOR_CONFIG_DIR: configDir, ...extra };
}

/** A stand-in for the process environment, with the two markers whose STRIPPING is
 * under test present and obviously not the app's own. */
function shadowEnv() {
	return {
		PATH: "/usr/bin:/bin",
		SHELL: "/bin/zsh",
		HOME: "/tmp/not-the-real-home",
		CMUX_WORKSPACE_ID: "workspace-that-must-not-cross",
		CMUX_SURFACE_ID: "surface-that-must-not-cross",
		LOP_SESSION_ID: "session-that-must-not-cross",
		TERM: "dumb",
	};
}

/**
 * A fake pty with the pty seam's shape.
 *
 * It records what it was asked to do and can be driven to emit, which is what makes
 * the host's rules testable without a shell: the order of the log, the record and
 * the subscribers is a property of `consume`, and a real process would only make
 * the same assertions slower and less deterministic.
 */
class FakePty {
	constructor(options) {
		this.options = options;
		this.pid = 4242 + FakePty.counted++;
		this.dataListeners = [];
		this.exitListeners = [];
		this.written = [];
		this.resizes = [];
		this.signals = [];
		/** Set by `kill` so a test can see the escalation path. */
		this.killed = false;
	}

	static counted = 0;

	onData(listener) {
		this.dataListeners.push(listener);
	}

	onExit(listener) {
		this.exitListeners.push(listener);
	}

	write(data) {
		this.written.push(data);
	}

	resize(cols, rows) {
		this.resizes.push({ cols, rows });
	}

	kill(signal = "SIGTERM") {
		this.signals.push(signal);
	}

	/** The pty emitted these bytes. */
	emit(text) {
		for (const listener of this.dataListeners) listener(text);
	}

	/** The process ended. */
	exit(code) {
		for (const listener of this.exitListeners) listener({ exitCode: code });
	}
}

function makeHost({ env = shadowEnv(), history = null, now, spawn } = {}) {
	const registry = new ConsoleRegistry();
	const spawned = [];
	const host = new ConsoleHost(registry, {
		window: () => null,
		log: () => {},
		history,
		env,
		now,
		spawn: (options) => {
			const pty = spawn ? spawn(options) : new FakePty(options);
			spawned.push({ pty, options });
			return pty;
		},
	});
	return { host, registry, spawned };
}

const ticks = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

before(() => {
	// Nothing global to set up: every test makes its own trees. The hook exists so
	// the file's teardown has a counterpart and a future fixture has one place to go.
	assert.ok(CONSOLE_METHODS.length > 0);
});

after(() => {
	for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ registry */

test("a surface handle names its host, and parses back to its slot", () => {
	const registry = new ConsoleRegistry();
	const entry = registry.create({
		sessionId: "session-1",
		origin: "agent",
		command: "zsh",
		argvTail: "",
		cwd: "/tmp",
		cols: 100,
		rows: 30,
		retain: false,
		sizing: "auto",
	});
	const handle = entry.record.surface;
	assert.match(handle, /^con:\d+:[A-Za-z0-9_-]+$/);
	const parsed = parseSurface(handle);
	assert.equal(parsed.slot, 1);
	assert.equal(`${SURFACE_PREFIX}:${parsed.slot}:${parsed.nonce}`, handle);
	// A handle that is not in the grammar is not a handle, and a redacted one never
	// reveals the whole nonce.
	assert.equal(parseSurface("ui:1:abc"), null);
	assert.equal(parseSurface("con:1"), null);
	const redacted = redactSurface(handle);
	assert.ok(redacted.endsWith("…"));
	assert.ok(!redacted.includes(parsed.nonce));
});

test("the agent cap is per session, and the app cap is app-wide", () => {
	const registry = new ConsoleRegistry();
	const create = (sessionId, origin) =>
		registry.create({
			sessionId,
			origin,
			command: "zsh",
			argvTail: "",
			cwd: "/tmp",
			cols: 100,
			rows: 30,
			retain: false,
			sizing: "auto",
		});
	for (let index = 0; index < MAX_AGENT_SURFACES_PER_SESSION; index += 1) {
		create("session-1", "agent");
	}
	assert.throws(
		() => create("session-1", "agent"),
		(error) =>
			error instanceof BrowserHostError &&
			error.code === "tab_limit" &&
			error.data.scope === "session" &&
			error.data.limit === MAX_AGENT_SURFACES_PER_SESSION,
	);
	// The same session may still hold a USER surface: the cap is about what an agent
	// fleet can open, which is the browser's own reasoning for its number.
	create("session-1", "user");
	assert.equal(
		registry.agentCount("session-1"),
		MAX_AGENT_SURFACES_PER_SESSION,
	);

	const other = new ConsoleRegistry();
	for (let index = 0; index < MAX_SURFACES_PER_APP; index += 1) {
		other.create({
			sessionId: `session-${index}`,
			origin: "user",
			command: "zsh",
			argvTail: "",
			cwd: "/tmp",
			cols: 100,
			rows: 30,
			retain: false,
			sizing: "auto",
		});
	}
	assert.throws(
		() =>
			other.create({
				sessionId: "session-late",
				origin: "user",
				command: "zsh",
				argvTail: "",
				cwd: "/tmp",
				cols: 100,
				rows: 30,
				retain: false,
				sizing: "auto",
			}),
		(error) =>
			error instanceof BrowserHostError &&
			error.code === "tab_limit" &&
			error.data.scope === "app" &&
			error.data.limit === MAX_SURFACES_PER_APP,
	);
});

test("an unknown handle is refused with the count, and another session's is not owned", () => {
	const registry = new ConsoleRegistry();
	const entry = registry.create({
		sessionId: "session-1",
		origin: "user",
		command: "zsh",
		argvTail: "",
		cwd: "/tmp",
		cols: 100,
		rows: 30,
		retain: false,
		sizing: "auto",
	});
	assert.throws(
		() => registry.require("con:99:missing"),
		(error) => error.code === "surface_unavailable" && error.data.count === 1,
	);
	assert.throws(
		() => registry.requireOwned(entry.record.surface, "session-2"),
		(error) => error.code === "surface_not_owned",
	);
	assert.equal(
		registry.requireOwned(entry.record.surface, "session-1").record.sessionId,
		"session-1",
	);
	// `find` answers null rather than raising, which is what the asynchronous paths
	// need: a pty's data can arrive after its surface was closed.
	assert.equal(registry.find("con:99:missing"), null);
	assert.equal(registry.remove("con:99:missing"), null);
});

/* ------------------------------------------------------------------ byte log */

test("the byte log keeps absolute offsets, and says when a read is short", () => {
	const log = new ByteLog({ retainBytes: 8, ceilingBytes: 16 });
	const bytes = (text) => new TextEncoder().encode(text);
	log.append(bytes("0123456789"));
	assert.equal(log.startOffset, 0);
	assert.equal(log.endOffset, 10);
	assert.equal(log.truncated, false);
	assert.equal(new TextDecoder().decode(log.read(0).bytes), "0123456789");

	log.append(bytes("abcdefghij"));
	// The window is 8 and the ceiling 16: appending 10 more crossed the ceiling, so
	// the trim dropped the oldest CHUNK (10 bytes) rather than shaving to exactly 8.
	// The retained window is therefore between the two numbers and never below the
	// window, and `truncated` is set because bytes were actually dropped.
	assert.ok(log.retainedBytes <= 16);
	assert.ok(log.retainedBytes >= 8);
	assert.equal(log.startOffset, 10);
	assert.equal(log.truncated, true);
	assert.equal(new TextDecoder().decode(log.read(0).bytes), "abcdefghij");
	// A reader that asks for bytes that are gone is told so, and still gets what
	// remains: "everything since N is gone; here is the rest" rather than an error.
	const short = log.read(5);
	assert.equal(short.truncated, true);
	assert.equal(new TextDecoder().decode(short.bytes), "abcdefghij");
	// A reader that is current is not told the log is short.
	assert.equal(log.read(20).truncated, false);

	log.clear();
	assert.equal(log.endOffset, 20);
	assert.equal(log.retainedBytes, 0);
	assert.equal(log.truncated, true);
});

test("the log's defaults are the design's numbers, and an empty append is a no-op", () => {
	assert.equal(RETAIN_BYTES, 4 * 1024 * 1024);
	assert.equal(CEILING_BYTES, 16 * 1024 * 1024);
	const log = new ByteLog();
	log.append(new Uint8Array(0));
	assert.equal(log.endOffset, 0);
	assert.equal(log.truncated, false);
	assert.throws(() => new ByteLog({ retainBytes: 8, ceilingBytes: 4 }));
});

/* ------------------------------------------------------------------ emulator */

test("the emulator parses asynchronously, which is why the seam has whenIdle", async () => {
	const emulator = createXtermEmulator({ cols: 20, rows: 4, scrollback: 100 });
	emulator.write(new TextEncoder().encode("hello \x1b[1mbold\x1b[0m"));
	// MEASURED on @xterm/headless 6.0.0: `write` queues, and the grid is stale until
	// the queue drains. A host that answered a read here would be answering from the
	// previous chunk — the staleness an agent cannot detect.
	assert.ok(
		!emulator.text("viewport").includes("hello"),
		"a read taken before the queue drains must not see the bytes just written",
	);
	await emulator.whenIdle();
	assert.equal(emulator.text("viewport").split("\n")[0], "hello bold");
});

test("the emulator's modes and cursor come from the record, and scrollback pages", async () => {
	const emulator = createXtermEmulator({ cols: 10, rows: 2, scrollback: 100 });
	emulator.write(
		new TextEncoder().encode(
			"l1\r\nl2\r\nl3\r\nl4\x1b[?2004h\x1b[?1h\x1b[?1002h",
		),
	);
	await emulator.whenIdle();
	assert.equal(emulator.text("viewport"), "l3\nl4");
	// The scrollback range is everything above the viewport, exactly as the design's
	// 13.1 states it (0..baseY), and it pages.
	assert.equal(emulator.text("scrollback"), "l1\nl2");
	assert.equal(emulator.text("scrollback", { start: 1, count: 1 }), "l2");
	assert.equal(emulator.grid.modes.bracketedPaste, true);
	assert.equal(emulator.grid.modes.applicationCursorKeys, true);
	assert.equal(emulator.grid.modes.mouseTracking, "drag");
	assert.equal(emulator.grid.cursor.y, 1);
	assert.equal(emulator.grid.lineCount, 4);

	emulator.resize(20, 5);
	assert.equal(emulator.grid.cols, 20);
	assert.equal(emulator.grid.rows, 5);
	emulator.dispose();
});

/* ------------------------------------------------------------------ OSC 133 */

test("the OSC 133 scanner reads marks, statuses and splits", () => {
	const encoder = new TextEncoder();
	const scanner = new Osc133Scanner();
	const marks = scanner.feed(
		encoder.encode(
			"\x1b]133;A\x07prompt\x1b]133;B\x07cmd\x1b]133;C\x07out\x1b]133;D;0\x07",
		),
	);
	assert.deepEqual(
		marks.map((mark) => mark.kind),
		["prompt-start", "command-start", "output-start", "command-finished"],
	);
	assert.equal(marks[3].exitCode, 0);
	// The offset points at the sequence's first byte, in the same coordinate space
	// the byte log's offsets use.
	assert.equal(marks[0].offset, 0);
	assert.equal(marks[3].offset, 36);
});

test("a mark split across two reads is still one mark, at every split point", () => {
	const encoder = new TextEncoder();
	const stream = "\x1b]133;D;42\x1b\\";
	for (let split = 0; split <= stream.length; split += 1) {
		const scanner = new Osc133Scanner();
		const first = scanner.feed(encoder.encode(stream.slice(0, split)));
		const second = scanner.feed(encoder.encode(stream.slice(split)));
		const marks = [...first, ...second];
		assert.equal(
			marks.length,
			1,
			`split at ${split} produced ${marks.length} mark(s)`,
		);
		assert.equal(marks[0].kind, "command-finished");
		assert.equal(marks[0].exitCode, 42);
	}
});

test("a spoofed mark is one mark, and a long non-133 OSC produces none", () => {
	const encoder = new TextEncoder();
	const scanner = new Osc133Scanner();
	// A program printing the sequence itself: the worst case the design states is one
	// spurious blip, and that is exactly what happens.
	assert.equal(scanner.feed(encoder.encode("\x1b]133;D;1\x07")).length, 1);
	// A different OSC that merely begins with 133; is bounded and then dropped, so
	// the scanner's memory is not a function of what a program prints.
	scanner.reset();
	assert.deepEqual(
		scanner.feed(encoder.encode(`\x1b]133;${"x".repeat(200)}\x07`)),
		[],
	);
	// An unterminated sequence produces nothing: a mark is finished, not begun.
	scanner.reset();
	assert.deepEqual(scanner.feed(encoder.encode("\x1b]133;D;7")), []);
	// A title OSC is skipped without consuming the mark after it.
	scanner.reset();
	assert.equal(
		scanner.feed(encoder.encode("\x1b]0;title\x07\x1b]133;D;7\x07")).length,
		1,
	);
});

/* ------------------------------------------------------------------ keys */

test("the named-key table follows the modes, and every accepted name encodes", () => {
	const normal = { applicationCursorKeys: false, applicationKeypad: false };
	const application = { applicationCursorKeys: true, applicationKeypad: false };
	const decode = (bytes) => new TextDecoder().decode(bytes);

	assert.equal(decode(encodeNamedKey("up", normal)), "\x1b[A");
	assert.equal(decode(encodeNamedKey("up", application)), "\x1bOA");
	assert.equal(decode(encodeNamedKey("home", application)), "\x1bOH");
	assert.equal(decode(encodeNamedKey("end", normal)), "\x1b[F");
	assert.equal(decode(encodeNamedKey("ctrl+c", normal)), "\x03");
	assert.equal(decode(encodeNamedKey("ctrl+space", normal)), "\x00");
	assert.equal(decode(encodeNamedKey("shift+tab", normal)), "\x1b[Z");
	assert.equal(decode(encodeNamedKey("f1", normal)), "\x1bOP");
	assert.equal(decode(encodeNamedKey("f5", normal)), "\x1b[15~");
	assert.equal(decode(encodeNamedKey("backspace", normal)), "\x7f");
	assert.equal(decode(encodeNamedKey("enter", normal)), "\r");
	// Anything outside the vocabulary is null, which the caller turns into the typed
	// `unknown_key` refusal that lists this very set.
	assert.equal(encodeNamedKey("page-down", normal), null);
	assert.equal(encodeNamedKey("up", normal) === null, false);
	for (const name of NAMED_KEYS) {
		assert.notEqual(
			encodeNamedKey(name, normal),
			null,
			`${name} is advertised and must encode`,
		);
	}
});

/* ------------------------------------------------------------- environment */

test("a surface's environment carries the markers and loses the multiplexer's", () => {
	const env = surfaceEnvironment({
		base: shadowEnv(),
		sessionId: "session-1",
		surface: "con:1:nonce",
	});
	assert.equal(env.TERM, "xterm-256color");
	assert.equal(env.COLORTERM, "truecolor");
	assert.equal(env.LOCAL_OPERATOR_CONSOLE_SURFACE, "con:1:nonce");
	assert.equal(env.LOCAL_OPERATOR_CONSOLE_SESSION, "session-1");
	assert.equal(env.CMUX_WORKSPACE_ID, undefined);
	assert.equal(env.CMUX_SURFACE_ID, undefined);
	assert.equal(env.LOP_SESSION_ID, undefined);
	assert.equal(env.PATH, "/usr/bin:/bin");

	// An explicit override is honoured, including a LOP_ name the default strips:
	// the strip is about what a surface INHERITS, not about what its creator asked
	// for. CMUX_ is not in that category.
	const overridden = surfaceEnvironment({
		base: shadowEnv(),
		sessionId: "session-1",
		surface: "con:1:nonce",
		overrides: {
			LOP_SESSION_ID: "explicit",
			CMUX_WORKSPACE_ID: "still-stripped",
		},
	});
	assert.equal(overridden.LOP_SESSION_ID, "explicit");
	// The override map is applied verbatim (the caller's own choice), which is the
	// documented asymmetry: only the INHERITED copy was stripped.
	assert.equal(typeof env.CMUX_WORKSPACE_ID, "undefined");
});

test("the shell and the working directory fall back to the user's own", () => {
	assert.equal(defaultShell({ SHELL: "/bin/zsh" }), "/bin/zsh");
	// A relative shell is not a shell this app execs: it would resolve against
	// whatever directory the app happens to be in.
	assert.equal(defaultShell({ SHELL: "zsh" }), "/bin/zsh");
	assert.equal(defaultShell({}), "/bin/zsh");
	assert.equal(resolveCwd("/tmp"), "/tmp");
	assert.equal(resolveCwd("relative/path"), resolveCwd(undefined));
	assert.ok(resolveCwd(undefined).startsWith("/"));
});

test("the grid clamps to the floor and the ceiling, and a rect crops to the window", () => {
	assert.deepEqual(clampGrid(100, 30), { cols: 100, rows: 30 });
	assert.deepEqual(clampGrid(10, 2), { cols: MIN_COLS, rows: 10 });
	assert.deepEqual(clampGrid(9000, 9000), { cols: MAX_COLS, rows: 200 });
	assert.deepEqual(clampGrid(Number.NaN, Number.NaN), {
		cols: DEFAULT_COLS,
		rows: DEFAULT_ROWS,
	});
	assert.equal(MIN_COLS, 40);
	assert.deepEqual(
		cropToWindow(
			{ x: 10.7, y: -4, width: 5000, height: 5000 },
			{ x: 0, y: 0, width: 800, height: 600 },
		),
		{ x: 10, y: 0, width: 790, height: 600 },
	);
	assert.equal(
		new TextDecoder().decode(
			wrapBracketedPaste(new TextEncoder().encode("hi")),
		),
		"\x1b[200~hi\x1b[201~",
	);
});

/* --------------------------------------------------------------- the host */

/** A window as far as the capture path reads it. `frames` are handed out in order,
 * so a test can reproduce the hidden window's blank-first-frame trap by putting a
 * small one first. */
function fakeWindow({ frames = [], destroyed = false, focused = false } = {}) {
	const sent = [];
	const captured = [];
	const queue = [...frames];
	return {
		isDestroyed: () => destroyed,
		isFocused: () => focused,
		getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
		webContents: {
			capturePage: async (rect) => {
				captured.push(rect);
				return queue.length > 0 ? queue.shift() : image(MIN_FRAME_BYTES + 1);
			},
			send: (channel, payload) => sent.push({ channel, payload }),
		},
		sent,
		captured,
	};
}

function image(bytes) {
	const png = Buffer.alloc(bytes);
	return { isEmpty: () => false, toPNG: () => png };
}

/** A pane's report for a box, with the cell metrics the spike measured for the DOM
 * renderer (8.425 x 16 at fontSize 14). */
function contentReport({
	x = 0,
	y = 0,
	width = 843,
	height = 480,
	cellWidth = 8.425,
	cellHeight = 16,
	visible = true,
	theme = null,
} = {}) {
	return {
		contentRect: { x, y, width, height },
		cellWidth,
		cellHeight,
		visible,
		theme,
	};
}

function hostWithWindow(options = {}) {
	const registry = new ConsoleRegistry();
	const spawned = [];
	const window = options.window ?? fakeWindow();
	const host = new ConsoleHost(registry, {
		window: () => window,
		log: options.log ?? (() => {}),
		history: options.history ?? null,
		env: options.env ?? shadowEnv(),
		now: options.now,
		spawn: (spawnOptions) => {
			const pty = new FakePty(spawnOptions);
			spawned.push({ pty, options: spawnOptions });
			return pty;
		},
		onReveal: options.onReveal,
	});
	return { host, registry, spawned, window };
}

async function createSurface(host, overrides = {}) {
	return host.create({
		sessionId: "session-1",
		origin: "agent",
		command: "/bin/zsh",
		args: [],
		...overrides,
	});
}

test("a created surface is born at the documented grid, in the user's home, with the markers set", () => {
	const { host, spawned } = hostWithWindow();
	const created = host.create({
		sessionId: "session-1",
		origin: "agent",
		command: "/bin/zsh",
		args: ["-f", "-i"],
	});
	assert.equal(created.cols, DEFAULT_COLS);
	assert.equal(created.rows, DEFAULT_ROWS);
	assert.equal(created.live, true);
	// An agent's surface is not retained by default, and is not revealed.
	assert.deepEqual(
		{ reveal: created.reveal, revealed: created.revealed },
		{ reveal: "none", revealed: false },
	);
	assert.equal(spawned.length, 1);
	const spawnOptions = spawned[0].options;
	assert.deepEqual(spawnOptions.args, ["-f", "-i"]);
	assert.ok(spawnOptions.cwd.startsWith("/"));
	assert.equal(
		spawnOptions.env.LOCAL_OPERATOR_CONSOLE_SURFACE,
		created.surface,
	);
	assert.equal(spawnOptions.env.CMUX_WORKSPACE_ID, undefined);
	assert.equal(host.list().length, 1);
	assert.equal(host.list()[0].origin, "agent");
	assert.equal(host.list()[0].agent_owned, true);
	assert.equal(host.list()[0].running, true);
	// A user's surface is retained by default (design 7.2) — asserted here because
	// the two defaults differ and a swap would only show up as a full disk.
	const user = host.create({ sessionId: "session-1", origin: "user" });
	assert.equal(
		host.state().surfaces.find((entry) => entry.surface === user.surface)
			.retain,
		true,
	);
});

test("a create whose process will not start leaves no surface behind", () => {
	const registry = new ConsoleRegistry();
	const host = new ConsoleHost(registry, {
		window: () => null,
		log: () => {},
		history: null,
		env: shadowEnv(),
		spawn: () => {
			throw new Error("posix_spawnp failed.");
		},
	});
	assert.throws(
		() => host.create({ sessionId: "session-1", origin: "agent" }),
		(error) =>
			error instanceof BrowserHostError &&
			error.code === "console_unavailable" &&
			error.data.reason === "spawn_failed" &&
			error.message.includes("posix_spawnp failed."),
	);
	// The record was written before the spawn, so the failure path has to remove it:
	// a surface that lists as running while nothing is running is the defect this
	// ordering exists to prevent.
	assert.equal(registry.count(), 0);
	assert.deepEqual(host.counts(), { total: 0, agent: 0 });
});

test("the pty's bytes reach the log, the record and the subscribers, and a read answers from the record", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const frames = [];
	const subscriber = {
		output: (frame) => frames.push(frame),
		exit: () => {},
	};
	const replay = host.subscribe(created.surface, 0, subscriber);
	assert.equal(replay.from, 0);
	assert.equal(replay.bytes.length, 0);

	spawned[0].pty.emit("hello \x1b[1mconsole\x1b[0m\r\nsecond line\r\n");
	await ticks(40);
	const read = await host.read(created.surface, "viewport");
	assert.ok(read.text.startsWith("hello console"));
	assert.ok(read.text.includes("second line"));
	assert.equal(read.cols, DEFAULT_COLS);
	assert.equal(read.live, true);
	assert.equal(read.mode, "viewport");
	// The cursor is at the start of the row after the trailing CRLF, which is what a
	// prompt would be waiting on.
	assert.deepEqual(read.cursor, { x: 0, y: 2 });
	assert.equal(read.truncated, false);

	// The push channel carries the same bytes, coalesced, keyed by surface.
	assert.equal(frames.length, 1);
	assert.equal(frames[0].surface, created.surface);
	assert.equal(frames[0].seq, 1);
	assert.equal(
		new TextDecoder().decode(frames[0].bytes),
		"hello \x1b[1mconsole\x1b[0m\r\nsecond line\r\n",
	);
	// Replay-then-stream: a subscriber that connects later gets what it missed and
	// resumes from exactly the next byte.
	const late = { output: () => {}, exit: () => {} };
	const replayed = host.subscribe(
		created.surface,
		frames[0].bytes.length,
		late,
	);
	assert.equal(replayed.from, frames[0].bytes.length);
	assert.equal(replayed.bytes.length, 0);
	spawned[0].pty.emit("third\r\n");
	await ticks(40);
	// A later read sees it, through the record rather than through the stream: the
	// subscriber's frame is a delivery, and the record is the authority.
	const later = await host.read(created.surface, "viewport");
	assert.ok(later.text.includes("third"));
	// Nothing has scrolled off a 30-row viewport yet, so the scrollback range is
	// empty and `truncated` says the byte log is complete rather than short.
	const scrollback = await host.read(created.surface, "scrollback");
	assert.equal(scrollback.text, "");
	assert.equal(scrollback.truncated, false);
});

test("the grid belongs to main: a visible rect derives it, a hidden one never does", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const pty = spawned[0].pty;

	// 843px at 8.425px per column is 100 columns; 480px at 16px per row is 30.
	host.setDisplayed(created.surface);
	host.setContentRect(created.surface, contentReport());
	assert.deepEqual(
		{
			cols: host.status(created.surface).cols,
			rows: host.status(created.surface).rows,
		},
		{ cols: 100, rows: 30 },
	);
	// Unchanged grid: no second SIGWINCH. One clamp-crossing is one resize.
	assert.equal(pty.resizes.length, 0);
	host.setContentRect(
		created.surface,
		contentReport({ width: 1200, height: 800 }),
	);
	assert.deepEqual(pty.resizes, [{ cols: 142, rows: 50 }]);

	// A pane that is not visible measures a box nobody can see: remembered for a
	// capture, never used to resize a program.
	host.setContentRect(
		created.surface,
		contentReport({ width: 400, height: 200, visible: false }),
	);
	assert.equal(pty.resizes.length, 1);
	// The pane unmounted: no resize, and the grid it had is the grid it keeps.
	host.forgetContentRect(created.surface);
	assert.equal(pty.resizes.length, 1);
	// A zero-sized cell is a divisor this code refuses to use; the IPC boundary
	// rejects it, and the host ignores one that reached it another way.
	host.setContentRect(created.surface, contentReport({ cellWidth: 0 }));
	assert.equal(pty.resizes.length, 1);
	assert.equal(host.status(created.surface).cols, 142);

	// An explicit resize is the other writer, and it is clamped by the same rule.
	const resized = host.resize(created.surface, 120, 40);
	assert.deepEqual(resized, { cols: 120, rows: 40 });
	assert.deepEqual(pty.resizes.at(-1), { cols: 120, rows: 40 });
	// Clamping on the explicit path is the HOST's safety net; the wire refuses an
	// out-of-range request instead (see the dispatch tests), because a caller that
	// asked for 10 columns should be told, not silently given 40.
	host.resize(created.surface, 10, 2);
	assert.equal(host.status(created.surface).cols, MIN_COLS);
});

test("a fixed-grid surface refuses a resize, and the pane's rect cannot move it either", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host, { sizing: "fixed" });
	host.setDisplayed(created.surface);
	host.setContentRect(created.surface, contentReport({ width: 400 }));
	assert.equal(spawned[0].pty.resizes.length, 0);
	assert.throws(
		() => host.resize(created.surface, 120, 40),
		(error) => error.code === "invalid_grid" && error.data.reason === "fixed",
	);
});

test("input is written as bytes, and paste is bracketed only when the record says so", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const pty = spawned[0].pty;
	await host.input(created.surface, { text: "ls\r" });
	assert.deepEqual(pty.written, ["ls\r"]);

	// The mode is read from the RECORD at the moment of the call, which is why this
	// is a main-side decision (design 10.5).
	pty.emit("\x1b[?2004h");
	await ticks(20);
	await host.input(created.surface, { text: "pasted", paste: true });
	assert.equal(pty.written[1], "\x1b[200~pasted\x1b[201~");
	await host.input(created.surface, { text: "typed", paste: true });
	assert.equal(pty.written[2], "\x1b[200~typed\x1b[201~");
	pty.emit("\x1b[?2004l");
	await ticks(20);
	await host.input(created.surface, { text: "plain", paste: true });
	assert.equal(pty.written[3], "plain");
	const bytes = await host.input(created.surface, {
		bytes: Uint8Array.from([3]),
	});
	assert.equal(bytes.bytes, 1);
	assert.equal(pty.written[4], "\x03");
});

test("the wire's cursor is the emulator's {x, y}, and not the tool's {row, col}", async () => {
	// §10.2 never shaped this field and §5.4 names the emulator's `{x, y}`; a
	// neighbouring PR parsed `{row, col}` and rendered "cursor: row None", which is a
	// false statement in a model-facing result whose own tests could not see it. The
	// shape is therefore asserted here rather than merely the field's presence.
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	spawned[0].pty.emit("hi");
	await ticks(30);
	const status = await host.status(created.surface);
	assert.deepEqual(Object.keys(status.cursor).sort(), ["x", "y"]);
	assert.equal(typeof status.cursor.x, "number");
	assert.equal(typeof status.cursor.y, "number");
	assert.equal(status.cursor.x, 2);
	assert.equal(status.cursor.y, 0);
	// The read carries the same shape, from the same source.
	const read = await host.read(created.surface, "viewport");
	assert.deepEqual(Object.keys(read.cursor).sort(), ["x", "y"]);
});

test("an input payload past the bound is refused before any byte reaches the pty", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const pty = spawned[0].pty;
	await assert.rejects(
		() =>
			host.input(created.surface, {
				bytes: new Uint8Array(MAX_INPUT_BYTES + 1),
			}),
		(error) =>
			error.code === "input_queue_full" &&
			error.data.accepted === 0 &&
			error.data.limit === MAX_INPUT_BYTES,
	);
	// Nothing was written: the refusal is atomic, so "accepted: 0" is the truth rather
	// than a partial write the caller cannot reason about.
	assert.deepEqual(pty.written, []);
	// The bound sits inside the RPC body cap on purpose: past it, the transport drops
	// the request and the caller sees no code at all.
	assert.ok(MAX_INPUT_BYTES * 4 <= 1 << 20);
	// A payload AT the bound is still accepted, so the bound is a bound rather than an
	// off-by-one someone will discover in use.
	const accepted = await host.input(created.surface, {
		bytes: new Uint8Array(MAX_INPUT_BYTES),
	});
	assert.equal(accepted.accepted, true);
	assert.equal(accepted.bytes, MAX_INPUT_BYTES);
});

test("keys go through the encoder, and an unknown name is refused before anything is sent", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const pty = spawned[0].pty;
	await host.keys(created.surface, ["up", "ctrl+c"]);
	assert.deepEqual(pty.written, ["\x1b[A", "\x03"]);
	pty.emit("\x1b[?1h");
	await ticks(20);
	await host.keys(created.surface, ["up"]);
	assert.equal(pty.written[2], "\x1bOA");

	const before = pty.written.length;
	await assert.rejects(
		() => host.keys(created.surface, ["page-down"]),
		(error) =>
			error.code === "unknown_key" &&
			error.data.key === "page-down" &&
			Array.isArray(error.data.accepted),
	);
	// The refusal is atomic: the valid name in the same call was not sent, because a
	// half-applied chord is a state the caller did not ask for and cannot undo.
	await assert.rejects(() => host.keys(created.surface, ["up", "nope"]), {
		code: "unknown_key",
	});
	assert.equal(pty.written.length, before);
});

test("an exited surface still reads, and answers input with the typed refusal", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	spawned[0].pty.emit("before exit\r\n");
	await ticks(20);
	spawned[0].pty.exit(3);
	await ticks(20);

	const status = host.status(created.surface);
	assert.equal(status.running, false);
	assert.equal(status.exit_code, 3);
	assert.equal(status.live, true);
	// The read still works, which is the design's "read still works" for this cell.
	const read = await host.read(created.surface, "viewport");
	assert.ok(read.text.includes("before exit"));
	assert.equal(read.live, true);
	await assert.rejects(
		() => host.input(created.surface, { text: "x" }),
		(error) => error.code === "process_exited" && error.data.exit_code === 3,
	);
	const listing = host
		.list()
		.find((entry) => entry.surface === created.surface);
	assert.equal(listing.exit_code, 3);
});

test("secure input refuses reads and captures, and the bytes in the window never reach the log", async () => {
	const dir = scratch("console-secure-");
	const history = new ConsoleHistory(historyRoot(dir));
	const { host, spawned } = hostWithWindow({ history });
	const created = await createSurface(host, { retain: true });
	const pty = spawned[0].pty;
	pty.emit("public\r\n");
	await ticks(30);
	assert.equal(host.status(created.surface).truncated, false);
	host.setDisplayed(created.surface);
	host.setContentRect(created.surface, contentReport());

	host.setSecure(created.surface, true);
	// The window's opening drops the byte log, which is why the surface now reports
	// its history as incomplete rather than pretending it is whole.
	assert.equal(host.status(created.surface).truncated, true);
	pty.emit("private\r\n");
	await ticks(30);

	await assert.rejects(
		() => host.read(created.surface, "viewport"),
		(error) => error.code === "secure_input_active",
	);
	await assert.rejects(
		() => host.screenshot(created.surface),
		(error) => error.code === "secure_input_active",
	);
	assert.equal(host.status(created.surface).secure, true);

	// WHAT WAS RETAINED, asserted on the artifact rather than on the intent: the
	// bytes a program printed while the window was open are not in the file the next
	// launch replays. This is the design's "never persist keystrokes / drop the byte
	// log for that window" checked by reading what is on disk.
	const persisted = readFileSync(
		logPath(historyRoot(dir), "session-1", created.surface),
	).toString("utf8");
	assert.ok(persisted.includes("public"));
	assert.ok(!persisted.includes("private"));

	// The residual the design states rather than hides: the RECORD still holds what a
	// person can see, because main is its only writer and a record that skipped bytes
	// would put main out of step with the pane. A read after the window closes sees
	// it, which is the boundary §11.4.4 names as advisory.
	host.setSecure(created.surface, false);
	const read = await host.read(created.surface, "viewport");
	assert.ok(read.text.includes("private"));
});

test("a capture photographs the app's own window, crop to the pane's rect, and retries once", async () => {
	// The blank first frame is the spike's measured trap: a hidden window's FIRST
	// capture came back at 9,866 B where the settled frame was 27,869 B.
	const window = fakeWindow({
		frames: [image(64), image(MIN_FRAME_BYTES + 900)],
	});
	const { host } = hostWithWindow({ window });
	const created = await createSurface(host);
	host.setDisplayed(created.surface);
	host.setContentRect(
		created.surface,
		contentReport({ x: 12, y: 20, width: 843, height: 480 }),
	);
	const shot = await host.screenshot(created.surface);
	assert.equal(shot.rendered, "displayed");
	assert.equal(shot.live, true);
	// Cropped to the pane's rect, integer-valued, and clipped to the window's own
	// content bounds: x=12 in an 800px-wide window can only be 788px of frame.
	assert.deepEqual(window.captured[0], {
		x: 12,
		y: 20,
		width: 788,
		height: 480,
	});
	assert.equal(
		window.captured.length,
		2,
		"the blank frame must trigger exactly one retry",
	);
	const png = Buffer.from(shot.image_base64, "base64");
	assert.ok(png.length >= MIN_FRAME_BYTES);

	// No pane displaying it: refused with the typed gap rather than answered with a
	// frame of something else. The offscreen capture view is PR B's (design 17.1).
	host.setDisplayed(null);
	await assert.rejects(
		() => host.screenshot(created.surface),
		(error) => error.code === "capture_unavailable",
	);
});

test("close signals, waits out the grace, and reports the exit code it caused", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const pty = spawned[0].pty;
	// A process that honours SIGTERM: the exit arrives while the close is waiting.
	const closed = host.close(created.surface, { kill: true });
	await ticks(5);
	pty.exit(143);
	assert.deepEqual(await closed, { closed: true, exit_code: 143 });
	assert.deepEqual(pty.signals, ["SIGTERM"]);
	assert.equal(host.list().length, 0);
});

test("a process that ignores SIGTERM is escalated, and the close still answers", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	const closed = host.close(created.surface, { kill: true });
	const result = await closed;
	// No exit code, because nothing reported one: the surface is closed and the call
	// answers rather than waiting out a process that is not coming back.
	assert.deepEqual(result, { closed: true });
	assert.deepEqual(spawned[0].pty.signals, ["SIGTERM", "SIGKILL"]);
	// The bound is what keeps a wedged process from holding the RPC call open.
	assert.ok(CLOSE_GRACE_MS <= 5000);
});

test("closing a running surface without killing it is refused rather than orphaning a pty", async () => {
	const { host, spawned } = hostWithWindow();
	const created = await createSurface(host);
	await assert.rejects(
		() => host.close(created.surface, { kill: false }),
		(error) => error.code === "busy" && error.data.running === true,
	);
	assert.equal(host.list().length, 1);
	assert.deepEqual(spawned[0].pty.signals, []);
	// A surface whose process ALREADY exited closes with no signal, which is where
	// `kill: false` means what it says.
	spawned[0].pty.exit(0);
	await ticks(20);
	const closed = await host.close(created.surface, { kill: false });
	assert.deepEqual(closed, { closed: true, exit_code: 0 });
	assert.deepEqual(spawned[0].pty.signals, []);
});

test("reveal: open is downgraded when the window is not focused, and never asks to raise it", async () => {
	const { host } = hostWithWindow({ window: fakeWindow({ focused: false }) });
	const created = await createSurface(host, { reveal: "open" });
	assert.equal(created.reveal, "none");
	assert.equal(created.revealed, false);

	const reveals = [];
	const focused = hostWithWindow({
		window: fakeWindow({ focused: true }),
		onReveal: (request) => reveals.push(request),
	});
	const asked = await createSurface(focused.host, { reveal: "open" });
	assert.equal(asked.reveal, "open");
	assert.equal(asked.revealed, true);
	assert.deepEqual(reveals, [
		{ surface: asked.surface, sessionId: "session-1", mode: "open" },
	]);
	// `session` is forwarded rather than resolved: whether the app is displaying that
	// session is a question only the renderer can answer.
	const forwarded = await createSurface(focused.host, { reveal: "session" });
	assert.deepEqual(reveals.at(-1).mode, "session");
	assert.equal(forwarded.revealed, true);
});

/* ----------------------------------------------------------------- history */

test("history round-trips a surface's bytes and its parameters", () => {
	const dir = scratch();
	const root = historyRoot(dir);
	const history = new ConsoleHistory(root);
	const surface = "con:1:nonce";
	const meta = {
		surface,
		session_id: "session-1",
		origin: "user",
		command: "zsh",
		argv: ["-f"],
		cwd: "/tmp",
		cols: 100,
		rows: 30,
		created_at: 1,
		last_seen_at: 2,
		exit_code: null,
		truncated: false,
	};
	history.writeMeta(meta);
	history.append(
		"session-1",
		surface,
		new TextEncoder().encode("hello\r\n"),
		meta,
	);
	const loaded = history.load("session-1", surface);
	assert.equal(new TextDecoder().decode(loaded.bytes), "hello\r\n");
	assert.deepEqual(loaded.meta, meta);
	assert.equal(history.list().length, 1);
	assert.equal(history.list("session-2").length, 0);

	// The modes are the discovery record's, asserted with `stat` rather than with
	// intent: a terminal's bytes are as private as the key that unlocks the socket.
	assert.equal(
		statSync(logPath(root, "session-1", surface)).mode & 0o777,
		HISTORY_FILE_MODE,
	);
	assert.equal(
		statSync(join(root, fileStem("session-1"))).mode & 0o777,
		HISTORY_DIR_MODE,
	);
	history.remove("session-1", surface);
	assert.equal(history.load("session-1", surface), null);
});

test("a read creates nothing, and a handle with a colon is a legal filename", () => {
	const dir = scratch();
	const root = historyRoot(dir);
	const history = new ConsoleHistory(root);
	assert.deepEqual(history.list(), []);
	assert.equal(history.load("session-1", "con:1:nonce"), null);
	// THE rule the bridge's and the UI host's state modules both state: a read is
	// pure path arithmetic, so a listing on a machine with no history leaves no
	// directory for the next launch to find.
	assert.equal(existsSync(root), false);
	assert.equal(fileStem("con:1:abc-def"), "con_1_abc-def");
});

test("a log past the rotate bound is rewritten to the retained window, and says so", () => {
	const dir = scratch();
	const root = historyRoot(dir);
	const history = new ConsoleHistory(root);
	const surface = "con:2:nonce";
	const meta = {
		surface,
		session_id: "session-1",
		origin: "user",
		command: "zsh",
		argv: [],
		cwd: "/tmp",
		cols: 100,
		rows: 30,
		created_at: 1,
		last_seen_at: 1,
		exit_code: null,
		truncated: false,
	};
	history.writeMeta(meta);
	// One append past the rotate bound, which is twice the retained window.
	const chunk = Buffer.alloc(HISTORY_ROTATE_BYTES + 1, 0x61);
	const result = history.append("session-1", surface, chunk, meta);
	assert.equal(result.rotated, true);
	assert.equal(meta.truncated, true);
	const size = statSync(logPath(root, "session-1", surface)).size;
	assert.ok(size <= RETAIN_BYTES, `the rotated file is ${size} bytes`);
	assert.ok(size > 0);
	// And the sidecar on disk carries the flag, because that is the only place it is
	// durable across a relaunch.
	assert.equal(history.load("session-1", surface).meta.truncated, true);
});

test("the history GC removes what is older than the window and counts it", () => {
	const dir = scratch();
	const root = historyRoot(dir);
	const history = new ConsoleHistory(root, { now: () => 1_800_000_000 });
	for (const session of ["old-session", "new-session"]) {
		history.writeMeta({
			surface: `con:1:${session}`,
			session_id: session,
			origin: "user",
			command: "zsh",
			argv: [],
			cwd: "/tmp",
			cols: 100,
			rows: 30,
			created_at: 1,
			last_seen_at: 1,
			exit_code: null,
			truncated: false,
		});
		history.append(
			session,
			`con:1:${session}`,
			new TextEncoder().encode("x"),
			{},
		);
	}
	// Age one session's files past the window rather than waiting 30 days for it, and
	// stamp the other with the injected clock's own now — the real mtimes are neither
	// side of a clock this test made up.
	const oldDir = join(root, fileStem("old-session"));
	const newDir = join(root, fileStem("new-session"));
	const past = (1_800_000_000 - 40 * 24 * 60 * 60) * 1000;
	const present = 1_800_000_000 * 1000;
	for (const file of ["con_1_old-session.json", "con_1_old-session.log"]) {
		utimesSync(join(oldDir, file), new Date(past), new Date(past));
	}
	for (const file of ["con_1_new-session.json", "con_1_new-session.log"]) {
		utimesSync(join(newDir, file), new Date(present), new Date(present));
	}
	const report = history.collect(30);
	assert.deepEqual(report.removedSessions, [fileStem("old-session")]);
	assert.equal(report.removedSurfaces, 1);
	assert.equal(existsSync(oldDir), false);
	assert.equal(history.list().length, 1);
});

/* ----------------------------------------------------------------- the wire */

test("the console's names are in the wire's closed lists, and its budget is total", () => {
	for (const method of CONSOLE_METHODS) {
		assert.ok(METHODS.includes(method), `${method} is in METHODS`);
		assert.equal(typeof COMMAND_TIMEOUTS_S[method], "number", method);
		assert.equal(typeof CONSOLE_COMMAND_TIMEOUTS_S[method], "number", method);
		assert.ok(isConsoleDispatchMethod(method));
	}
	for (const code of CONSOLE_ERROR_CODES) {
		assert.ok(
			ERROR_CODES.includes(code),
			`${code} is in the shared vocabulary, or the session's model drops the frame`,
		);
	}
	assert.equal(PROTO_VERSION, 1);
});

test("the dispatcher validates params at the boundary", async () => {
	const { host } = hostWithWindow();
	const created = await dispatchConsole(host, "console_create", {
		session_id: "session-1",
		cols: 120,
		rows: 40,
	});
	assert.equal(created.cols, 120);
	assert.equal(isConsoleDispatchMethod("console_create"), true);

	// An out-of-range grid is refused WITH the clamp it would have applied: a caller
	// that asked for 10 columns is told, not silently given 40.
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_resize", {
				surface: created.surface,
				cols: 10,
				rows: 40,
			}),
		(error) =>
			error.code === "invalid_grid" &&
			error.data.clamp.cols === MIN_COLS &&
			error.data.requested.cols === 10,
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_create", {
				session_id: "session-1",
				cols: 9000,
				rows: 40,
			}),
		(error) => error.code === "invalid_grid",
	);
	await assert.rejects(
		() => dispatchConsole(host, "console_status", {}),
		(error) => error.code === "surface_unavailable",
	);
	await assert.rejects(
		() => dispatchConsole(host, "console_close", { surface: 7 }),
		(error) => error.code === "surface_unavailable",
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_read", {
				surface: created.surface,
				mode: "screen",
			}),
		(error) => error.code === "internal",
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_input", {
				surface: created.surface,
				bytes: [1, 300],
			}),
		(error) => error.code === "internal",
	);
	// A call with neither text nor bytes names the reason a `secret_ref` is not
	// enough on this side: the tool resolves it before the call.
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_input", {
				surface: created.surface,
				secret_ref: "SUDO_PASSWORD",
			}),
		(error) => error.message.includes("secret_ref"),
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_create", {
				session_id: "session-1",
				env: { A: 1 },
			}),
		(error) => error.code === "internal",
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_screenshot", {
				surface: created.surface,
				format: "jpeg",
			}),
		(error) => error.code === "unsupported_method",
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_keys", {
				surface: created.surface,
				keys: [],
			}),
		(error) => error.code === "unknown_key",
	);
	await assert.rejects(
		() =>
			dispatchConsole(host, "console_secure", {
				surface: created.surface,
				on: "yes",
			}),
		(error) => error.code === "internal",
	);
	// The list is scoped to a session when asked, and answers the count with it.
	const listing = await dispatchConsole(host, "console_list", {
		session_id: "session-1",
	});
	assert.equal(listing.count, 1);
	assert.equal((await dispatchConsole(host, "console_list", {})).count, 1);
	assert.equal(
		(await dispatchConsole(host, "console_list", { session_id: "other" }))
			.count,
		0,
	);
});

/** The app's own routing, mirrored: console names to the console, everything else
 * to the browser host. `src/main/browser/index.ts` is the real one, and the rig
 * drives THAT; this copy exists so the wire cells below can run in-process. */
function routeToConsole(host, enabled = true) {
	return async (method, params) => {
		if (!isConsoleDispatchMethod(method))
			throw new Error(`not a console method: ${method}`);
		if (!enabled) {
			throw new BrowserHostError(
				"console_unavailable",
				"this app's console is not available (disabled): the kill switch is off",
				{ reason: "disabled" },
			);
		}
		return dispatchConsole(host, method, params);
	};
}

async function post(port, key, body) {
	const response = await fetch(`http://127.0.0.1:${port}${RPC_PATH}`, {
		method: "POST",
		headers: { "content-type": "application/json", [KEY_HEADER]: key },
		body: JSON.stringify(body),
	});
	return { status: response.status, body: await response.json() };
}

test("the console rides the existing endpoint: a create -> read -> resize -> close round trip over real HTTP", async () => {
	const { host, spawned } = hostWithWindow();
	const key = "console-test-key";
	const server = await startRpcServer({
		key,
		dispatch: (method, params) => routeToConsole(host)(method, params),
		capabilities: () => ({ console: true }),
	});
	try {
		const created = await post(server.port, key, {
			id: "1",
			method: "console_create",
			params: { session_id: "session-1", cols: 100, rows: 30 },
		});
		assert.equal(created.status, 200);
		assert.equal(created.body.ok, true);
		const surface = created.body.result.surface;

		spawned[0].pty.emit("ready\r\n");
		await ticks(30);
		const read = await post(server.port, key, {
			id: "2",
			method: "console_read",
			params: { surface, mode: "viewport" },
		});
		assert.equal(read.body.ok, true);
		assert.ok(read.body.result.text.includes("ready"));

		const resized = await post(server.port, key, {
			id: "3",
			method: "console_resize",
			params: { surface, cols: 120, rows: 40 },
		});
		assert.deepEqual(resized.body.result, { cols: 120, rows: 40 });
		assert.deepEqual(spawned[0].pty.resizes.at(-1), { cols: 120, rows: 40 });

		const listed = await post(server.port, key, {
			id: "4",
			method: "console_list",
			params: {},
		});
		assert.equal(listed.body.result.count, 1);
		assert.equal(listed.body.result.surfaces[0].surface, surface);

		const closed = post(server.port, key, {
			id: "5",
			method: "console_close",
			params: { surface, kill: true },
		});
		await ticks(5);
		spawned[0].pty.exit(0);
		assert.deepEqual((await closed).body.result, {
			closed: true,
			exit_code: 0,
		});

		// The four safety rules still hold for the console's methods, because they are
		// the SAME endpoint (design 10.1): a wrong key is a 401 with no detail, and a
		// missing key is the same.
		const wrongKey = await post(server.port, "not-the-key", {
			id: "6",
			method: "console_list",
			params: {},
		});
		assert.equal(wrongKey.status, 401);
		assert.deepEqual(wrongKey.body, { detail: "unauthorized" });
		// A console-namespaced name this host does not know is a TYPED version-skew
		// refusal rather than a transport status: the namespace is new, so "a client
		// newer than this app" is the expected direction, and a caller can act on a
		// code (design 10.6).
		const skew = await post(server.port, key, {
			id: "7",
			method: "console_frobnicate",
			params: {},
		});
		assert.equal(skew.status, 200);
		assert.equal(skew.body.ok, false);
		assert.equal(skew.body.error.code, "unsupported_method");
		assert.equal(skew.body.error.data.method, "console_frobnicate");
		// An unknown BROWSER method keeps its existing behaviour: the released
		// extension's expectations are the one thing a new host may not change.
		const browserTypo = await post(server.port, key, {
			id: "8",
			method: "open_tab",
			params: {},
		});
		assert.equal(browserTypo.status, 422);

		const health = await fetch(`http://127.0.0.1:${server.port}/health`);
		const healthBody = await health.json();
		assert.equal(healthBody.console, true);
		assert.equal(healthBody.host, "ui");
		assert.equal(healthBody.pid, process.pid);
	} finally {
		await server.close();
	}
});

test("with the console off, a console method is a typed refusal naming the condition", async () => {
	const { host } = hostWithWindow();
	const server = await startRpcServer({
		key: "key",
		dispatch: (method, params) => routeToConsole(host, false)(method, params),
		capabilities: () => ({ console: false }),
	});
	try {
		const refused = await post(server.port, "key", {
			id: "1",
			method: "console_list",
			params: {},
		});
		assert.equal(refused.body.ok, false);
		assert.equal(refused.body.error.code, "console_unavailable");
		assert.equal(refused.body.error.data.reason, "disabled");
		const health = await fetch(`http://127.0.0.1:${server.port}/health`);
		assert.equal((await health.json()).console, false);
	} finally {
		await server.close();
	}
});

/* ------------------------------------------------------------- renderer IPC */

test("every channel in the namespace's list is registered, and the sender is checked", async () => {
	ipcMain.reset();
	const { host } = hostWithWindow();
	const window = {
		isDestroyed: () => false,
		webContents: {
			mainFrame: { url: "file:///app/index.html" },
			send: () => {},
		},
	};
	registerConsoleIpc({
		window: () => window,
		expectedUrl: "file:///app/index.html",
		host: () => host,
		log: () => {},
	});
	for (const channel of CONSOLE_IPC_CHANNELS) {
		assert.ok(ipcMain.handlers.has(channel), `${channel} has a handler`);
	}
	// The push channels are main -> renderer, so they are NOT invoke handlers; a
	// namespace whose two directions were enumerated together could not tell an
	// unhandled request from an unhandled push.
	for (const channel of CONSOLE_PUSH_CHANNELS) {
		assert.equal(ipcMain.handlers.has(channel), false, `${channel} is a push`);
	}

	const state = await ipcMain.handlers.get("console-state")({
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame,
	});
	assert.equal(state.available, true);

	// A sender that is not this window's own main frame cannot use the namespace —
	// the same three-part check the browser's namespace makes (design 2.4).
	await assert.rejects(
		async () =>
			ipcMain.handlers.get("console-state")({
				sender: {},
				senderFrame: { url: "file:///app/index.html" },
			}),
		/cannot use the console/,
	);

	unregisterConsoleIpc();
	for (const channel of CONSOLE_IPC_CHANNELS) {
		assert.equal(ipcMain.handlers.has(channel), false);
	}
});

test("the pane's reports and the created surface are validated at the boundary", async () => {
	ipcMain.reset();
	const { host } = hostWithWindow();
	const window = {
		isDestroyed: () => false,
		webContents: {
			mainFrame: { url: "file:///app/index.html" },
			send: () => {},
		},
	};
	registerConsoleIpc({
		window: () => window,
		expectedUrl: "file:///app/index.html",
		host: () => host,
		log: () => {},
	});
	const event = {
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame,
	};
	const call = (channel, ...args) =>
		ipcMain.handlers.get(channel)(event, ...args);

	/** A refusal, from a handler that may throw synchronously or reject. The IPC
	 * handlers are synchronous (the value is computed and returned), so a validator's
	 * refusal arrives as a throw rather than a rejection, and a test that assumed
	 * one shape would pass while asserting nothing about the other. */
	async function refusalOf(action) {
		try {
			await action();
		} catch (error) {
			return error;
		}
		throw new Error("expected a refusal");
	}

	const created = await call("console-create-surface", {
		sessionId: "session-1",
	});
	assert.ok(created.surface);
	// The origin is the app's to set, not the renderer's: a renderer that could name
	// it could claim an agent's caps or a user's retention default.
	assert.equal(host.list()[0].origin, "user");
	assert.match(
		(await refusalOf(() => call("console-create-surface", {}))).message,
		/sessionId/,
	);

	host.setDisplayed(created.surface);
	await call(
		"console-content-rect",
		created.surface,
		contentReport({ width: 843, height: 480 }),
	);
	// A zero cell size is a divisor, and it is refused rather than clamped: the clamp
	// would quietly turn an infinite column count into the ceiling.
	assert.match(
		(
			await refusalOf(() =>
				call(
					"console-content-rect",
					created.surface,
					contentReport({ cellWidth: 0 }),
				),
			)
		).message,
		/cellWidth/,
	);
	assert.match(
		(
			await refusalOf(() =>
				call(
					"console-content-rect",
					created.surface,
					contentReport({ width: 0 }),
				),
			)
		).message,
		/positive size/,
	);
	assert.match(
		(
			await refusalOf(() =>
				call("console-content-rect", created.surface, { contentRect: {} }),
			)
		).message,
		/contentRect/,
	);

	await call("console-input", created.surface, "typed by hand");
	await call("console-keys", created.surface, ["up"]);
	assert.match(
		(await refusalOf(() => call("console-input", created.surface, 42))).message,
		/string/,
	);
	assert.match(
		(await refusalOf(() => call("console-keys", created.surface, "up")))
			.message,
		/list of names/,
	);
	await call("console-secure-toggle", created.surface, true);
	assert.equal(host.status(created.surface).secure, true);
	assert.match(
		(
			await refusalOf(() =>
				call("console-secure-toggle", created.surface, "on"),
			)
		).message,
		/boolean/,
	);
	await call("console-secure-toggle", created.surface, false);

	// The subscription answers the two-step in one call: what to replay, and where
	// the live frames resume from.
	const subscribed = await call("console-subscribe", created.surface, 0);
	assert.equal(subscribed.surface, created.surface);
	assert.equal(subscribed.from_byte, 0);
	assert.equal(typeof subscribed.replay_base64, "string");
	assert.equal(subscribed.truncated, false);
	await call("console-unsubscribe", created.surface);

	await call("console-close-pane");
	assert.equal(host.state().displayed_surface, null);
	await call("console-open-pane", created.surface);
	assert.equal(host.state().displayed_surface, created.surface);
	// A handle that is not a handle is refused rather than looked up.
	assert.match(
		(await refusalOf(() => call("console-open-pane", 7))).message,
		/string/,
	);
	unregisterConsoleIpc();
});

/* ------------------------------------------------------------------ record */

test("the record carries the console fields, and a record with no console says so", () => {
	const dir = scratch();
	const path = stateFilePath(dir);
	const withConsole = new BrowserStateWriter(
		path,
		() => ({
			tabs: 1,
			agentTabs: 1,
			profileDir: "/tmp/profile",
			console: true,
			consoleSurfaces: 2,
			consoleAgentSurfaces: 1,
		}),
		{ appVersion: "0.0.0-test" },
	);
	withConsole.start(1234, "session-key");
	const written = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(written.console, true);
	assert.equal(written.console_surfaces, 2);
	assert.equal(written.console_agent_surfaces, 1);
	assert.equal(written.host, "ui");
	assert.equal(written.proto, PROTO_VERSION);
	assert.equal(statSync(path).mode & 0o777, 0o600);
	withConsole.clear();

	// A facts object that knows nothing about the console publishes an honest "no
	// console" rather than an absent field: the harness's gate reads this file, and a
	// missing key must not read as an unknown state.
	const withoutConsole = new BrowserStateWriter(
		path,
		() => ({ tabs: 0, agentTabs: 0, profileDir: "" }),
		{ appVersion: "0.0.0-test" },
	);
	withoutConsole.start(1234, "session-key");
	const sparse = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(sparse.console, false);
	assert.equal(sparse.console_surfaces, 0);
	withoutConsole.clear();
	assert.equal(existsSync(path), false);
});

/* --------------------------------------------------------------- pty seam */

test("the helper's exec bit is asserted and healed, and only when it is wrong", () => {
	const root = scratch("console-pty-");
	const target = { platform: "darwin", arch: "arm64" };
	const helper = join(root, "prebuilds", "darwin-arm64", "spawn-helper");
	mkdirSync(join(root, "prebuilds", "darwin-arm64"), { recursive: true });
	writeFileSync(helper, "#!/bin/sh\n");
	chmodSync(helper, 0o644);

	// The measured state of the published tarball: 0644, which fails the first spawn
	// with `posix_spawnp failed.` and which no install step fixes.
	assert.equal(statSync(helper).mode & 0o777, 0o644);
	const healed = ensureSpawnHelperExecutable(root, target);
	assert.equal(healed.healed, true);
	assert.equal(healed.mode, 0o644);
	assert.equal(statSync(helper).mode & 0o777, 0o755);
	// Idempotent: the second check finds it right and touches nothing.
	const second = ensureSpawnHelperExecutable(root, target);
	assert.equal(second.healed, false);
	assert.equal(second.mode, 0o755);
	// An absent helper is reported rather than thrown: the runtime heals what it can
	// and the packaged-tree proof is what fails a build over a missing one.
	const missing = ensureSpawnHelperExecutable(
		scratch("console-pty-empty-"),
		target,
	);
	assert.equal(missing.path, null);
	assert.equal(missing.reason, "no helper");
	// A packaged path is probed where the bytes actually are. A mode probe that
	// ignored the rewrite would stat a file inside an archive, which cannot hold an
	// exec bit at all, and "heal" nothing.
	assert.equal(
		unpackedPath(
			"/Applications/Local Operator.app/Contents/Resources/app.asar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
		),
		"/Applications/Local Operator.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
	);
	assert.equal(
		unpackedPath("/tmp/plain/node_modules/node-pty"),
		"/tmp/plain/node_modules/node-pty",
	);
});

test("node-pty is required by NAME, because its own archive rewrite is not idempotent", () => {
	// A source-shape test, and deliberately so: the failure it prevents is invisible in
	// the dev tree and fatal in the packaged one. node-pty rewrites `app.asar` to
	// `app.asar.unpacked` inside `unixTerminal.js` before it looks for `spawn-helper`;
	// requiring it through the already-unpacked path makes that rewrite produce
	// `app.asar.unpacked.unpacked/spawn-helper`, and the first spawn dies
	// `posix_spawnp failed.` (measured on the packaged app by the proof rig's
	// `--packaged` cell). Every other layer here is blind to it, so a structural
	// assertion is what keeps a future refactor from "tidying" the load to a path.
	const source = readFileSync("src/main/console/pty.ts", "utf8");
	assert.match(source, /requireFrom\(PTY_PACKAGE\)/);
	assert.ok(
		!/requireFrom\(\s*(root|resolvePtyRoot\(\))/.test(source),
		"the load must not go through a resolved path",
	);
	assert.match(source, /const root = resolvePtyRoot\(\);/);
});

/* ---------------------------------------------------------------- retention */

test("a retained surface is replayed into a fresh record, and reads as not live", async () => {
	const dir = scratch();
	const root = historyRoot(dir);
	const history = new ConsoleHistory(root);
	const { host, spawned } = hostWithWindow({ history });
	const created = await createSurface(host, { retain: true, origin: "user" });
	spawned[0].pty.emit("history line\r\n");
	await ticks(30);
	spawned[0].pty.exit(7);
	await ticks(30);

	// A fresh host, as a relaunch would build it, restoring from the same root.
	const restored = hostWithWindow({ history });
	const loaded = history.list();
	assert.equal(loaded.length, 1);
	restored.host.restore(loaded[0].meta, loaded[0].bytes);
	const listing = restored.host.list()[0];
	// The handle survives the relaunch: it is what a caller holds.
	assert.equal(listing.surface, created.surface);
	assert.equal(listing.running, false);
	assert.equal(listing.exit_code, 7);
	assert.equal(listing.live, false);
	const read = await restored.host.read(created.surface, "viewport");
	assert.ok(read.text.includes("history line"));
	assert.equal(read.live, false);
	// A restored surface has no pty, so input is refused rather than silently
	// swallowed.
	await assert.rejects(
		() => restored.host.input(created.surface, { text: "x" }),
		(error) => error.code === "process_exited",
	);
});
