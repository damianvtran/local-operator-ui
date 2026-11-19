import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The decision behind `LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL`.
 *
 * Why these cases. The switch exists so a rig can point the compiled app at a
 * backend it did not launch; its whole safety is that it is OPT-IN. Everything
 * below is that property made executable: nothing set means the managed path
 * unchanged (test 1), a named backend means attach (2-4), and a launch that named
 * one and cannot have it fails as a FAILURE rather than resolving to the installer
 * (5-8). The last case is the asymmetry the module documents - a lone
 * `LOCAL_OPERATOR_DESKTOP_TOKEN` is an existing rig configuration - and it is here
 * so a future "half-set is always an error" simplification breaks loudly.
 *
 * The helper is bundled in memory from the shipped TypeScript, the same way
 * `agent-shell-spawn-env.test.mjs` does, so no build step is needed and the
 * assertions are about the file that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/attach-backend";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	ATTACH_BACKEND_URL_VARIABLE,
	ATTACH_BACKEND_TOKEN_VARIABLE,
	resolveBackendAttach,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** The token every case below uses; asserted absent from every result. */
const TOKEN = "harness-token-not-a-real-credential-0123456789";

const URL_VAR = ATTACH_BACKEND_URL_VARIABLE;
const TOKEN_VAR = ATTACH_BACKEND_TOKEN_VARIABLE;

test("nothing set is the managed path, exactly as before", () => {
	assert.deepEqual(resolveBackendAttach({}), { kind: "managed" });
});

test("both set attaches to the named origin", () => {
	const decision = resolveBackendAttach({
		[URL_VAR]: "http://127.0.0.1:4711",
		[TOKEN_VAR]: TOKEN,
	});
	assert.deepEqual(decision, {
		kind: "attach",
		baseUrl: "http://127.0.0.1:4711",
	});
});

test("a trailing slash or a stray space normalises to the same origin", () => {
	for (const spelling of [
		"http://127.0.0.1:4711/",
		"  http://127.0.0.1:4711  ",
		"http://127.0.0.1:4711",
	]) {
		assert.deepEqual(
			resolveBackendAttach({ [URL_VAR]: spelling, [TOKEN_VAR]: TOKEN }),
			{
				kind: "attach",
				baseUrl: "http://127.0.0.1:4711",
			},
		);
	}
});

test("the decision never carries the token value", () => {
	for (const env of [
		{ [URL_VAR]: "http://127.0.0.1:4711", [TOKEN_VAR]: TOKEN },
		{ [URL_VAR]: "http://127.0.0.1:4711" },
		{ [URL_VAR]: "not a url", [TOKEN_VAR]: TOKEN },
		{ [TOKEN_VAR]: TOKEN },
	]) {
		const serialised = JSON.stringify(resolveBackendAttach(env));
		assert.equal(
			serialised.includes(TOKEN),
			false,
			`the decision must not carry the credential: ${serialised}`,
		);
	}
});

test("a URL with no token is a clear failure, not a partial attach", () => {
	const decision = resolveBackendAttach({ [URL_VAR]: "http://127.0.0.1:4711" });
	assert.equal(decision.kind, "incomplete");
	assert.equal(decision.reason, "token-missing");
	assert.match(decision.detail, new RegExp(TOKEN_VAR));
});

test("a whitespace token is no token", () => {
	const decision = resolveBackendAttach({
		[URL_VAR]: "http://127.0.0.1:4711",
		[TOKEN_VAR]: "   ",
	});
	assert.equal(decision.kind, "incomplete");
	assert.equal(decision.reason, "token-missing");
});

test("an unusable URL is refused rather than guessed at", () => {
	const cases = [
		["not a url", "not a URL"],
		["ftp://127.0.0.1:4711", "must be http or https"],
		["http://127.0.0.1:4711/v1/desktop", "must be an origin"],
		["http://127.0.0.1:4711/?x=1", "must be an origin"],
	];
	for (const [spelling, expected] of cases) {
		const decision = resolveBackendAttach({
			[URL_VAR]: spelling,
			[TOKEN_VAR]: TOKEN,
		});
		assert.equal(decision.kind, "incomplete", spelling);
		assert.equal(decision.reason, "url-invalid", spelling);
		assert.match(decision.detail, new RegExp(expected), spelling);
	}
});

test("a lone desktop token stays the managed path: it is an existing rig configuration", () => {
	// `scripts/renderer-driver.mjs` and `scripts/sidebar-layout-scene.mjs` launch
	// an externally paired app with the token and no URL at all. Reading that as
	// half an attach pair would refuse every one of those launches.
	assert.deepEqual(resolveBackendAttach({ [TOKEN_VAR]: TOKEN }), {
		kind: "managed",
	});
});

test("an empty URL is absent, not invalid", () => {
	assert.deepEqual(
		resolveBackendAttach({ [URL_VAR]: "", [TOKEN_VAR]: TOKEN }),
		{ kind: "managed" },
	);
});

/*
 * The two-map split (review round 1, MINOR-1). The URL is judged on the launch
 * environment and the credential on the environment the manager will read it
 * from, so presence and value cannot come from different files. Both directions
 * are asserted: a credential that only a folded `.env` supplies is NOT a false
 * refusal, and a credential the app will not actually read is not a false pass.
 */

const LAUNCH = { [URL_VAR]: "http://127.0.0.1:4711" };

test("the credential is judged against the environment the app reads it from", () => {
	const decision = resolveBackendAttach(LAUNCH, { [TOKEN_VAR]: TOKEN });
	assert.deepEqual(decision, {
		kind: "attach",
		baseUrl: "http://127.0.0.1:4711",
	});
});

test("a token in the launch environment alone is not a credential the app can use", () => {
	// The manager takes the value from the credential map; a presence check that
	// read the launch map would start an attach it cannot authenticate.
	const decision = resolveBackendAttach(LAUNCH, {});
	assert.equal(decision.kind, "incomplete");
	assert.equal(decision.reason, "token-missing");
});
