import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/* Named auth grammar rejects ambiguous/unknown targets; no last-token guesses. */

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
		"auth slack",
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

test("unknown verbs and extra targets cannot select a configured token", () => {
	for (const asked of ["hubspot notion", "hubspot reauth", "future hubspot", "login hubspot notion"]) {
		assert.deepEqual(resolveMcpServerTarget(asked, NAMES), {kind: "miss", asked});
	}
});

test("a typo cannot target a server named like a verb", () => {
	const names = [...NAMES, "login"];
	assert.deepEqual(resolveMcpServerTarget("login hubspo", names), {kind: "miss", asked: "login hubspo"});
	assert.deepEqual(resolveMcpServerTarget("login hubspot", names), {kind: "matched", name: "hubspot", unresolved: null});
	assert.deepEqual(resolveMcpServerTarget("login", names), {kind: "matched", name: "login", unresolved: null});
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
