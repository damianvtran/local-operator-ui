/**
 * Contract tests for the console PANE's rules: the theme's role mapping, the
 * listing's narrowing and recall, and the completion ladder's decisions.
 *
 * The shipped TypeScript is bundled in memory with esbuild — the harness
 * `console-host.test.mjs` and `browser-host.test.mjs` use — so what runs here is
 * the code that ships.
 *
 * WHAT THESE TESTS ARE NOT: proof that a terminal works. No pty is spawned, no
 * frame is rendered, no window exists. The pane's rendered truth is the design
 * round's frames and the live-app rig; this file exists so a regression in the
 * RULES is caught without booting an app, and the three it pins are the ones whose
 * failure would be silent:
 *
 *   - the ANSI table is pinned to the contract's own copy, so the two cannot drift
 *     into disagreeing about what colour a program gets;
 *   - every theme value is a ROLE, not a hex, and an unresolved role is omitted
 *     rather than guessed;
 *   - the completion ladder's two suppressions (a repeat mark, and a process exit
 *     immediately after the shell's own mark) hold, because both are the
 *     difference between one banner and two.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/themes/terminal-theme";',
			'export * from "./src/renderer/src/features/console/model/console-surfaces";',
			'export * from "./src/main/console/completion";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		// The completion module imports the namespace's channel list from `./ipc`,
		// which imports Electron. The suite's stub is what every other main-process
		// bundle uses for the same reason.
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
	logLevel: "silent",
});

const module_ = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	TERMINAL_THEME_ROLES,
	TERMINAL_ANSI_SLOTS,
	readTerminalTheme,
	missingTerminalRoles,
	measureCell,
	kebabRole,
	readConsoleSnapshot,
	surfacesForSession,
	pickActiveSurface,
	surfaceTitle,
	consoleCompletionHooks,
} = module_;

/**
 * The contract's own copy of the ANSI table, parsed out of
 * `scripts/contrast-contract.mjs`.
 *
 * WHY PARSED RATHER THAN IMPORTED: that file is a CLI that asserts over every
 * palette as it loads, so importing it would run the whole gate inside a unit
 * test. Reading the table's own text is the same shape `palette-source.mjs` uses
 * for the palettes, and the assertion is the thing that matters: two copies of one
 * mapping that disagree are indistinguishable from two copies that are both right,
 * right up until one is edited.
 */
const contractAnsi = () => {
	const source = readFileSync(
		join(process.cwd(), "scripts/contrast-contract.mjs"),
		"utf8",
	);
	const start = source.indexOf("const TERMINAL_ANSI = [");
	assert.ok(start !== -1, "the contract still declares TERMINAL_ANSI");
	const body = source.slice(start, source.indexOf("];", start));
	const rows = [...body.matchAll(/\["(\w+)",\s*"(\w+)"\]/g)].map((match) => ({
		slot: match[1],
		role: match[2],
	}));
	assert.equal(rows.length, 16, "the contract's table still has 16 slots");
	return rows;
};

test("the terminal's ANSI table is the contract's table, slot for slot", () => {
	const fromModule = TERMINAL_ANSI_SLOTS.map((slot) => ({
		slot,
		role: TERMINAL_THEME_ROLES[slot],
	}));
	assert.deepEqual(
		fromModule,
		contractAnsi(),
		"terminal-theme.ts and contrast-contract.mjs disagree about a slot; one of them is now wrong",
	);
});

test("every colour the terminal is handed is a role, never a hex", () => {
	for (const [key, role] of Object.entries(TERMINAL_THEME_ROLES)) {
		assert.ok(
			typeof role === "string" && /^[a-z][A-Za-z]*$/.test(role),
			`${key} must name a palette role, got ${JSON.stringify(role)}`,
		);
		assert.ok(
			!/^#/.test(role),
			`${key} is a literal colour, which no palette author can see and check-themes cannot measure`,
		);
	}
	// The four gated semantics, on the slots design 9.1 names, and the two greys
	// where the contract's own INKS floors apply.
	assert.equal(TERMINAL_THEME_ROLES.red, "danger");
	assert.equal(TERMINAL_THEME_ROLES.green, "success");
	assert.equal(TERMINAL_THEME_ROLES.yellow, "warning");
	assert.equal(TERMINAL_THEME_ROLES.blue, "info");
	assert.equal(TERMINAL_THEME_ROLES.background, "sunken");
	assert.equal(TERMINAL_THEME_ROLES.foreground, "ink");
	assert.equal(TERMINAL_THEME_ROLES.cursor, "accent");
	assert.equal(TERMINAL_THEME_ROLES.selectionBackground, "accentWash");
	// Design 9.2's honest gap, stated as a fact rather than a hope: the six
	// chromatic slots resolve to four roles, so two pairs ARE the same colour.
	assert.equal(TERMINAL_THEME_ROLES.cyan, TERMINAL_THEME_ROLES.blue);
	assert.equal(TERMINAL_THEME_ROLES.magenta, TERMINAL_THEME_ROLES.red);
});

test("the theme resolves roles through the document, and omits what is missing", () => {
	const roles = {
		"--color-sunken": "#101010",
		"--color-ink": "#f0f0f0",
		"--color-accent": "#4488ff",
		"--color-accent-wash": "#20242c",
		"--color-surface": "#181818",
		"--color-ink-muted": "#c0c0c0",
		"--color-ink-dim": "#9a9a9a",
		"--color-danger": "#ff5555",
		"--color-success": "#55ff88",
		"--color-warning": "#ffcc55",
		"--color-info": "#55ccff",
	};
	const previous = globalThis.getComputedStyle;
	globalThis.getComputedStyle = () => ({
		getPropertyValue: (name) => roles[name] ?? "",
	});
	try {
		const theme = readTerminalTheme({});
		assert.equal(theme.background, "#101010");
		assert.equal(theme.foreground, "#f0f0f0");
		assert.equal(theme.cursor, "#4488ff");
		assert.equal(theme.cursorAccent, "#181818");
		assert.equal(theme.red, "#ff5555");
		assert.equal(theme.brightBlack, "#c0c0c0");
		assert.deepEqual(missingTerminalRoles({}), []);
		/*
		 * AND AN UNRESOLVED ROLE IS OMITTED. xterm keeps its own default for a key
		 * it is not given, which shows up in a frame as one unthemed cell rather
		 * than as a crash or — worse — as a `var()` string that xterm's colour
		 * parser drops silently for the WHOLE palette.
		 */
		roles["--color-danger"] = "var(--lo-danger)";
		assert.equal(readTerminalTheme({}).red, undefined);
		// Four slots ride `danger`, which is the mapping's own shape: one unresolved
		// role is four unthemed slots, not one.
		assert.deepEqual(missingTerminalRoles({}), [
			"red",
			"magenta",
			"brightRed",
			"brightMagenta",
		]);
	} finally {
		globalThis.getComputedStyle = previous;
	}
});

test("kebabRole spells the one difference between a role and its variable", () => {
	assert.equal(kebabRole("accentWash"), "accent-wash");
	assert.equal(kebabRole("inkMuted"), "ink-muted");
	assert.equal(kebabRole("sunken"), "sunken");
});

test("a cell measurement without a DOM is the ratio, not an exception", () => {
	const cell = measureCell("monospace", 13);
	assert.ok(cell.cellWidth > 0 && cell.cellHeight > 0);
	assert.equal(cell.cellHeight, 13 * 1.2);
});

const listing = (overrides = {}) => ({
	surface: "con:1:7f3a",
	session_id: "session-1f4c",
	origin: "user",
	command: "zsh",
	argv_tail: "",
	cwd: "~/workspace",
	cols: 100,
	rows: 30,
	running: true,
	exit_code: null,
	last_activity: 100,
	live: true,
	agent_owned: false,
	secure: false,
	retain: true,
	displayed: false,
	last_mark: null,
	...overrides,
});

test("a listing without a surface id is not a surface", () => {
	const snapshot = readConsoleSnapshot({
		available: true,
		total: 3,
		agent: 0,
		displayed_surface: "con:1:7f3a",
		surfaces: [listing(), { command: "zsh" }, "not a listing"],
	});
	assert.equal(snapshot.surfaces.length, 1);
	assert.equal(snapshot.surfaces[0].surface, "con:1:7f3a");
	assert.equal(snapshot.displayedSurface, "con:1:7f3a");
	// An answer that does not say the console is running is not evidence that it is.
	assert.equal(readConsoleSnapshot(undefined).available, false);
	assert.equal(readConsoleSnapshot({ surfaces: [listing()] }).available, false);
});

test("the pane's lens recalls a surface, and falls back to the most recent", () => {
	const mine = surfacesForSession(
		readConsoleSnapshot({
			available: true,
			surfaces: [
				listing({ surface: "con:1:aaaa", last_activity: 100 }),
				listing({ surface: "con:2:bbbb", last_activity: 300 }),
				listing({
					surface: "con:3:cccc",
					session_id: "session-other",
					last_activity: 900,
				}),
			],
		}),
		"session-1f4c",
	);
	assert.deepEqual(
		mine.map((s) => s.surface),
		["con:2:bbbb", "con:1:aaaa"],
		"another session's surface must not appear, and the newest comes first",
	);
	const snapshot = readConsoleSnapshot({
		available: true,
		surfaces: [
			listing({ surface: "con:1:aaaa", last_activity: 100 }),
			listing({ surface: "con:2:bbbb", last_activity: 300 }),
		],
	});
	// 1. the stored lens, while it is still this session's;
	assert.equal(
		pickActiveSurface(snapshot, "session-1f4c", "con:1:aaaa")?.surface,
		"con:1:aaaa",
	);
	// 2. otherwise the most recent of this session's;
	assert.equal(
		pickActiveSurface(snapshot, "session-1f4c", "con:9:gone")?.surface,
		"con:2:bbbb",
	);
	// 3. and nothing at all on a draft, which is the empty state.
	assert.equal(pickActiveSurface(snapshot, null, null), null);
	assert.equal(
		pickActiveSurface(
			readConsoleSnapshot({ available: true }),
			"session-1f4c",
			null,
		),
		null,
	);
	assert.equal(surfaceTitle({ command: "npm", argvTail: "run dev" }), "npm");
	assert.equal(surfaceTitle({ command: "", argvTail: "zsh -l" }), "zsh");
	assert.equal(
		surfaceTitle({ command: "", argvTail: "", surface: "con:1:7f3a" }),
		"con:1:7f3a",
	);
});

/** A notifier that records what it was asked to raise. */
const recorder = () => {
	const notices = [];
	return {
		notices,
		consoleCompletion: (notice) => notices.push(notice),
	};
};

const completionFixture = ({ displayed = null } = {}) => {
	const records = new Map([
		["con:1:7f3a", { record: { sessionId: "session-1f4c", command: "zsh" } }],
	]);
	const notifier = recorder();
	const logged = [];
	const hooks = consoleCompletionHooks({
		host: () => ({ state: () => ({ displayed_surface: displayed }) }),
		registry: { find: (surface) => records.get(surface) ?? undefined },
		notifier: () => notifier,
		log: (message) => logged.push(message),
	});
	/*
	 * NO WINDOW IN THIS FIXTURE, deliberately. The state push is not the completion
	 * seam's: `console/index.ts` sends it through the host's ONE pusher
	 * (`broadcastConsoleState`, wired as `onChanged`) so a mark cannot produce two
	 * copies of the same frame, and `onChanged` fires for a mark and an exit as well.
	 * What is asserted here is therefore what this module owes — the banners and their
	 * suppressions — and the push is exercised where it lives, by the live rig
	 * (`scripts/console-host-proof.mjs`).
	 */
	return { hooks, notifier, logged };
};

test("a command mark banners once", () => {
	const { hooks, notifier } = completionFixture();
	hooks.onMark("con:1:7f3a", {
		kind: "command-finished",
		exitCode: 0,
		offset: 120,
	});
	assert.equal(notifier.notices.length, 1);
	assert.equal(notifier.notices[0].surface, "con:1:7f3a");
	assert.equal(notifier.notices[0].exitCode, 0);
	assert.equal(notifier.notices[0].surfaceName, "zsh");
	assert.equal(notifier.notices[0].sessionId, "session-1f4c");
	assert.equal(notifier.notices[0].displayed, false, "no pane is showing it");

	// The OTHER three marks are the shell's prompt and command boundaries: they are
	// not completions and must not banner.
	hooks.onMark("con:1:7f3a", {
		kind: "prompt-start",
		exitCode: null,
		offset: 200,
	});
	hooks.onMark("con:1:7f3a", {
		kind: "command-start",
		exitCode: null,
		offset: 210,
	});
	hooks.onMark("con:1:7f3a", {
		kind: "output-start",
		exitCode: null,
		offset: 220,
	});
	assert.equal(notifier.notices.length, 1);
});

test("a process exit banners with its own key, and never twice", () => {
	const { hooks, notifier } = completionFixture();
	hooks.onExit({
		surface: "con:1:7f3a",
		sessionId: "session-1f4c",
		exitCode: 0,
	});
	hooks.onExit({
		surface: "con:1:7f3a",
		sessionId: "session-1f4c",
		exitCode: 0,
	});
	assert.equal(notifier.notices.length, 2);
	assert.notEqual(
		notifier.notices[0].key,
		notifier.notices[1].key,
		"two exits are two completions, even with the same code — the key is the counter, not the code",
	);
});

test("a shell that exits from its own prompt is ONE completion, not two", () => {
	const { hooks, notifier, logged } = completionFixture();
	hooks.onMark("con:1:7f3a", {
		kind: "command-finished",
		exitCode: 0,
		offset: 120,
	});
	hooks.onExit({
		surface: "con:1:7f3a",
		sessionId: "session-1f4c",
		exitCode: 0,
	});
	assert.equal(
		notifier.notices.length,
		1,
		"the mark and the exit are one event",
	);
	assert.ok(
		logged.some((line) => line.includes("one banner, not two")),
		"the suppression is stated in the log rather than silent",
	);
});

test("a mark's own offset is what makes two commands two banners", () => {
	const { hooks, notifier } = completionFixture();
	hooks.onMark("con:1:7f3a", {
		kind: "command-finished",
		exitCode: 0,
		offset: 120,
	});
	hooks.onMark("con:1:7f3a", {
		kind: "command-finished",
		exitCode: 0,
		offset: 640,
	});
	assert.equal(notifier.notices.length, 2);
	assert.notEqual(notifier.notices[0].key, notifier.notices[1].key);
});

test("a mark for a surface the host no longer has banners nothing", () => {
	const { hooks, notifier } = completionFixture();
	hooks.onMark("con:9:gone", {
		kind: "command-finished",
		exitCode: 1,
		offset: 10,
	});
	assert.equal(notifier.notices.length, 0);
	/*
	 * AND NO PUSH IS ASSERTED HERE, which is the point of the single-pusher wiring:
	 * the renderer still learns about the change, but through the host's own
	 * `onChanged` (and therefore `broadcastConsoleState`) rather than through a second
	 * frame this module would have to keep in step. The live rig asserts the push's
	 * effect end to end.
	 */
});
