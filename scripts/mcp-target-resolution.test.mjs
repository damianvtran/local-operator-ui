import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * `/mcp <argument>` — what the deep link resolves to, and what it says when it
 * resolves to nothing.
 *
 * The argument arrives as one opaque string (`picker-registry.tsx` builds
 * `/settings?section=integrations&mcp=<encoded argument>` and
 * `slash-dispatch.ts` navigates BEFORE any backend call, so nothing validates
 * it), and the surface used to compare the whole string against a server name.
 * The operator's own remedy line, `/mcp reauth hubspot`, therefore matched
 * nothing and the reveal effect returned in SILENCE.
 *
 * The rule this pins is resolution against the LOADED list rather than against
 * the backend's subcommand vocabulary: the renderer holds no copy of
 * `MCP_SUBCOMMANDS`, and `docs/desktop-controls.md` forbids authoring one. The
 * verb is simply a token that is not a server name.
 *
 * The module is a React component file, and it is bundled as one: the rule being
 * pinned is the one the shipped component calls, not a copy of it.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { resolveMcpServerTarget, newestRosterRow } from "./src/renderer/src/features/settings/components/mcp-management-section";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	// The component tree imports styles from its story, not from itself; this
	// keeps a CSS import from failing the bundle if one is added beside it.
	loader: { ".css": "empty" },
});
const { resolveMcpServerTarget, newestRosterRow } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The configured names, as the section has them: whatever the read returned. */
const NAMES = ["cloudflare", "hubspot", "notion", "slack"];

test("an exact server name resolves to itself", () => {
	assert.deepEqual(resolveMcpServerTarget("hubspot", NAMES), {
		kind: "matched",
		name: "hubspot",
		unresolved: null,
	});
	// Padding is not part of the name.
	assert.deepEqual(resolveMcpServerTarget("  hubspot  ", NAMES), {
		kind: "matched",
		name: "hubspot",
		unresolved: null,
	});
});

test("the operator's own remedy line resolves to the server it names", () => {
	// `MCP_SUBCOMMANDS = ("list","add","remove","login","logout","reauth")` on the
	// backend; the renderer knows none of them and does not need to.
	for (const argument of [
		"reauth hubspot",
		"login notion",
		"list slack",
		"reauth  hubspot",
	]) {
		assert.deepEqual(
			resolveMcpServerTarget(argument, NAMES),
			{
				kind: "matched",
				name: argument.trim().split(/\s+/).pop(),
				// The LAST token IS the match, so nothing is left unexplained and the
				// section says nothing beyond revealing the row.
				unresolved: null,
			},
			argument,
		);
	}
});

test("the LAST token that is a configured server wins", () => {
	// The last token is itself a configured name, so it is the resolution and there
	// is nothing to explain.
	assert.deepEqual(resolveMcpServerTarget("hubspot notion", NAMES), {
		kind: "matched",
		name: "notion",
		unresolved: null,
	});
	// A verb after the name is a token that is not a server, so the name before it
	// still resolves — the rule is "last configured token", not "last token" — and
	// the argument now CARRIES the token it could not use, so the section can state
	// which server it landed on.
	assert.deepEqual(resolveMcpServerTarget("hubspot reauth", NAMES), {
		kind: "matched",
		name: "hubspot",
		unresolved: "reauth",
	});
});

/**
 * The residual the rule cannot fix, and the reason the match says what it did.
 *
 * With a server named `login`, `/mcp login hubspo` (a typo) matches `login` and
 * would reveal an unrelated row in silence (code review round 1, finding 4). No verb
 * list may exist in this renderer, so the honest fix is on the statement side: the
 * match that needed a token other than the last one reports the last one back.
 */
test("a server named like a verb cannot masquerade as the intended target in silence", () => {
	const names = [...NAMES, "login"];
	assert.deepEqual(resolveMcpServerTarget("login hubspo", names), {
		kind: "matched",
		name: "login",
		unresolved: "hubspo",
	});
	// And when the intended server IS configured, the same argument resolves cleanly
	// with nothing to explain — which is the operator's own `reauth hubspot` case.
	assert.deepEqual(resolveMcpServerTarget("login hubspot", names), {
		kind: "matched",
		name: "hubspot",
		unresolved: null,
	});
});

test("an argument that names nothing is a stated miss, not a silent no-op", () => {
	assert.deepEqual(resolveMcpServerTarget("reauth hubspo", NAMES), {
		kind: "miss",
		asked: "reauth hubspo",
	});
	assert.deepEqual(resolveMcpServerTarget("nosuchserver", NAMES), {
		kind: "miss",
		asked: "nosuchserver",
	});
	// Names are matched exactly: the deep link is generated from the list, so a
	// case-folded match would resolve a name no row carries.
	assert.deepEqual(resolveMcpServerTarget("Hubspot", NAMES), {
		kind: "miss",
		asked: "Hubspot",
	});
	// An empty list cannot match anything, and says so about the argument.
	assert.deepEqual(resolveMcpServerTarget("hubspot", []), {
		kind: "miss",
		asked: "hubspot",
	});
});

test("no argument is no line at all", () => {
	assert.equal(resolveMcpServerTarget(undefined, NAMES), null);
	assert.equal(resolveMcpServerTarget("", NAMES), null);
	assert.equal(resolveMcpServerTarget("   ", NAMES), null);
});

test("the borrowed conversation is the newest roster row", () => {
	const rows = [
		{ session_id: "aaaaaaaaaaaa", title: "older", updated_at: 100 },
		{ session_id: "bbbbbbbbbbbb", title: "newest", updated_at: 300 },
		{ session_id: "cccccccccccc", title: null, updated_at: 200 },
	];
	assert.equal(newestRosterRow(rows)?.session_id, "bbbbbbbbbbbb");
	// No timestamps at all: the roster's own order is the answer, because the
	// backend lists newest first and an untimestamped row is not a reason to
	// borrow an older one.
	assert.equal(newestRosterRow([{ session_id: "first" }, { session_id: "second" }])?.session_id, "first");
	assert.equal(newestRosterRow([]), null);
});
