/**
 * `src/shared/backend-startup.ts`: the start-up failure classifier, the bounded
 * stderr tail and the "Copy diagnostics" text (PostHog D2).
 *
 * The classifier's inputs are the machine's own words, so each arm is pinned
 * with the literal text the platform writes: Python's errno lines, Winsock's
 * messages, NTSTATUS exit codes as Node reports them on Windows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/shared/backend-startup.ts"],
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("classifies each failure from the evidence a real start leaves", () => {
	const c = mod.classifyStartupFailure;
	const cases = [
		[
			{ stderrTail: "OSError: [Errno 98] Address already in use", exitCode: 1 },
			"port_in_use",
		],
		[
			{ stderrTail: "OSError: [Errno 48] Address already in use", exitCode: 1 },
			"port_in_use",
		],
		[
			{
				stderrTail:
					"OSError: [WinError 10048] Only one usage of each socket address (protocol/network address/port) is normally permitted",
				exitCode: 1,
			},
			"port_in_use",
		],
		[
			{
				stderrTail:
					"PermissionError: [WinError 10013] An attempt was made to access a socket in a way forbidden by its access permissions",
				exitCode: 1,
			},
			"port_forbidden",
		],
		[{ spawnErrorCode: "EACCES" }, "executable_blocked"],
		[{ spawnErrorCode: "EPERM" }, "executable_blocked"],
		[{ spawnErrorCode: "ENOENT" }, "executable_missing"],
		// 0xC0000022 STATUS_ACCESS_DENIED, unsigned and signed as Node may report it.
		[{ exitCode: 3221225506 }, "executable_blocked"],
		[{ exitCode: 3221225506 - 4294967296 }, "executable_blocked"],
		[
			{
				exitCode: 1,
				stderrTail:
					"Operation did not complete successfully because the file contains a virus or potentially unwanted software.",
			},
			"executable_blocked",
		],
		// 0xC0000135 STATUS_DLL_NOT_FOUND
		[{ exitCode: 3221225781 }, "executable_missing"],
		[
			{
				exitCode: 1,
				stderrTail:
					"Traceback (most recent call last):\n  File \"x\"\nModuleNotFoundError: No module named 'foo'\n",
			},
			"crashed",
		],
		[{ timedOut: true, stderrTail: "INFO: loading\n" }, "timed_out"],
		[{ exitCode: 7 }, "exited"],
		[{ signal: "SIGKILL" }, "exited"],
		[{}, "unknown"],
	];
	for (const [input, expected] of cases) {
		assert.equal(c(input), expected, JSON.stringify(input));
	}
	// A port conflict wins over the traceback that carries it.
	assert.equal(
		c({
			exitCode: 1,
			stderrTail:
				"Traceback (most recent call last):\nOSError: [Errno 98] Address already in use",
		}),
		"port_in_use",
	);
	for (const value of mod.BACKEND_STARTUP_CATEGORIES)
		assert.equal(typeof value, "string");
});

test("the stderr tail keeps the most recent characters within its bound", () => {
	let tail = "";
	for (let i = 0; i < 2000; i++)
		tail = mod.appendStderrTail(tail, `line ${i}\n`);
	assert.equal(tail.length, mod.STDERR_TAIL_CHARS);
	assert.ok(tail.endsWith("line 1999\n"), "the newest line survives");
	assert.ok(!tail.includes("line 1\n"), "the oldest is evicted");
});

test("diagnostics carry what the machine said, and say when nothing was recorded", () => {
	const text = mod.startupDiagnosticsText(
		{
			phase: "failed",
			startedAt: Date.UTC(2026, 10, 17, 12, 0, 0),
			budgetMs: 30_000,
			attempt: 2,
			failure: {
				category: "port_forbidden",
				exitCode: 1,
				signal: null,
				spawnErrorCode: null,
				stderrTail: "PermissionError: [WinError 10013]\n",
				message: "The server process ended before it answered.",
			},
		},
		{ appVersion: "0.58.0", platform: "win32", state: "detached", url: null },
	);
	assert.match(text, /app: 0\.58\.0/);
	assert.match(text, /platform: win32/);
	assert.match(
		text,
		/start: failed, attempt 2, budget 30 s, started 2026-11-17T12:00:00\.000Z/,
	);
	assert.match(text, /category: port_forbidden/);
	assert.match(text, /exit code: 1/);
	assert.match(
		text,
		/stderr \(last lines\):\nPermissionError: \[WinError 10013\]$/,
	);
	assert.match(
		mod.startupDiagnosticsText(null, {}),
		/no start-up recorded by this app session/,
	);
});

/*
 * Review round 1, R1: the diagnostics are pasted into help requests, and the
 * stderr tail is the server's own output - a logged key, bearer header or
 * token must not reach the clipboard.
 */
test("diagnostics mask credential-shaped text and keep the evidence", () => {
	const secretHex = "a".repeat(32) + "0123456789abcdef".repeat(2);
	const stderr = [
		"Traceback (most recent call last):",
		"  headers={'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'}",
		"  OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234",
		'  {"token": "tok_live_12345678"}',
		`  desktop token ${secretHex}`,
		"  password: hunter22",
		"ValueError: bad config",
	].join("\n");
	const text = mod.startupDiagnosticsText(
		{
			phase: "failed",
			startedAt: 0,
			budgetMs: 30_000,
			attempt: 1,
			settledAt: 1000,
			failure: {
				category: "crashed",
				exitCode: 1,
				signal: null,
				spawnErrorCode: null,
				stderrTail: stderr,
				message: "The server process ended before it answered.",
			},
		},
		{ appVersion: "1.2.3", platform: "win32 x64" },
	);
	for (const leaked of [
		"eyJhbGciOiJIUzI1NiJ9",
		"sk-proj-abcdefghijklmnop1234",
		"tok_live_12345678",
		secretHex,
		"hunter22",
	])
		assert.ok(!text.includes(leaked), `masked: ${leaked}`);
	assert.match(text, /ValueError: bad config/, "the error itself survives");
	assert.match(text, /category: crashed/);
	assert.match(text, /app: 1\.2\.3/);
});

test("a failure after ready is labelled as such in the diagnostics (U2)", () => {
	const text = mod.startupDiagnosticsText(
		{
			phase: "failed",
			startedAt: 0,
			budgetMs: 30_000,
			attempt: 1,
			settledAt: 1_200_000,
			failure: {
				category: "exited",
				exitCode: 3,
				signal: null,
				spawnErrorCode: null,
				stderrTail: "",
				message: "The server stopped unexpectedly with exit code 3.",
				afterReady: true,
			},
		},
		{},
	);
	assert.match(text, /stopped after a successful start: yes/);
});
