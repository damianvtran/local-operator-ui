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

test("shared diagnostics contain only the structured allowlist (R6, Q8)", () => {
	const text = mod.startupDiagnosticsText(
		{
			phase: "failed",
			startedAt: Date.UTC(2026, 10, 17, 12, 0, 0),
			budgetMs: 30_000,
			attempt: 2,
			failure: {
				category: "port_forbidden",
				exitCode: 1,
				signal: "signal-private-marker",
				spawnErrorCode: "spawn-private-marker",
				stderrTail: "PermissionError: /Users/path-private-marker/serve",
				message: "Contact email-private-marker@example.invalid",
			},
		},
		{
			appVersion: "0.58.0",
			platform: "win32",
			arch: "x64",
			state: "detached",
			url: "https://example.invalid/url-private-marker",
			detail: "detail-private-marker",
		},
	);
	assert.ok(!text.includes("private-marker"), "no free-form source is shared");
	assert.equal(
		text,
		[
			"Local Operator start-up diagnostics",
			"app: 0.58.0",
			"platform: win32 x64",
			"connection: detached",
			"start: failed, attempt 2, budget 30 s",
			"category: port_forbidden",
			"exit code: 1",
		].join("\n"),
	);
	assert.match(
		mod.startupDiagnosticsText(null, {}),
		/no start-up recorded by this app session/,
	);
});

test("shared diagnostics reject malformed runtime values without coercing them", () => {
	const marker = "runtime-private-marker";
	const text = mod.startupDiagnosticsText(
		{
			phase: [marker],
			startedAt: Number.NaN,
			budgetMs: Number.POSITIVE_INFINITY,
			attempt: marker,
			failure: { category: marker, exitCode: marker, afterReady: marker },
		},
		{
			appVersion: `0.58.0+${marker}`,
			platform: marker,
			arch: marker,
			state: marker,
		},
	);
	assert.equal(
		text,
		[
			"Local Operator start-up diagnostics",
			"app: unknown",
			"platform: unknown",
			"connection: unknown",
			"start: unknown, attempt unknown, budget unknown",
			"category: unknown",
		].join("\n"),
	);
});

test("local stderr masks known credentials but keeps the surrounding error (Q8)", () => {
	const hex = "a".repeat(24); // Shorter than the unrelated opaque hex scrub.
	const basic = "syntheticBasic";
	const authValue = "fixture-authority-value";
	const authority = ["syntheticLogin", authValue].join(":");
	const address = `https://${authority}@example.invalid/`;
	const queryValue = "fixture-query-value";
	const cases = [
		[`Authorization: bearer ${hex}`, hex],
		[`Authorization: bAsIc ${basic}`, basic],
		['password: "two words syntheticQuoted"', "syntheticQuoted"],
		[String.raw`passwd='two \'words syntheticSingle'`, "syntheticSingle"],
		[address, "syntheticLogin"],
		[address, authValue],
		['{"token": "syntheticJson"}', "syntheticJson"],
		["OPENAI_API_KEY=syntheticAssigned", "syntheticAssigned"],
		[`${["?token", queryValue].join("=")}&mode=test`, queryValue],
		[`desktop token ${"f1".repeat(32)}`, "f1".repeat(32)],
	];
	for (const [input, sentinel] of cases) {
		assert.ok(input.includes(sentinel), "the control contains the marker");
		const text = mod.redactSecrets(`${input}\nValueError: bad config`);
		assert.ok(
			!text.includes(sentinel),
			`credential marker survived: ${sentinel}`,
		);
		assert.ok(text.endsWith("\nValueError: bad config"));
	}
	assert.equal(
		mod.redactSecrets('password: "two words syntheticQuoted"; ok'),
		"password: [redacted]; ok",
	);
	assert.equal(
		mod.redactSecrets(`Authorization: bearer ${hex}`),
		"Authorization: bearer [redacted]",
	);
	assert.equal(
		mod.redactSecrets(address),
		"https://[redacted]@example.invalid/",
	);
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
