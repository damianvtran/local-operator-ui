import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The sessionless MCP read's OUTGOING payload, against the transport schema.
 *
 * WHY THIS FILE EXISTS (PR #726, QA round 1, Q-1). The live app sent
 * `{"op":"mcp.catalog","cwd":"~","sessionId":"draft:<uuid>"}` — the composer's
 * display cwd and a draft pane's synthetic session key — and the op schema
 * (`desktop-contract.ts` `mcpCatalogCwdPattern` / `sessionIdPattern`) refused
 * the parse BEFORE the wire: the read 422'd, `/mcp` drew an empty list, and
 * every fixture-staged rig passed, because a story bridge answers whatever op
 * it is handed and no schema runs there.
 *
 * The class the fixtures could not see is the class this test pins: the exact
 * op object is composed by the SHIPPED composer (`mcpCatalogRequest`) and
 * parsed by the SHIPPED schema (`desktopRequestSchema`), with the raw draft
 * pair asserted to FAIL first — so a regression that let the values through
 * raw turns this red, and the negative arm proves the test still discriminates
 * (a test that cannot fail is not evidence).
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { mcpCatalogKeys, mcpCatalogRequest, mcpTransportCwd, mcpTransportSession } from "./src/renderer/src/shared/api/local-operator/mcp-catalog";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	desktopRequestSchema,
	mcpCatalogKeys,
	mcpCatalogRequest,
	mcpTransportCwd,
	mcpTransportSession,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const parses = (payload) => desktopRequestSchema.safeParse(payload).success;

test("a draft pane's raw values are exactly what the schema refuses", () => {
	/*
	 * QA's own matrix, restated as the negative half: both draft values fail
	 * individually AND together, so \"drop one of them\" is not a fix.
	 */
	assert.equal(parses({ op: "mcp.catalog", cwd: "~" }), false);
	assert.equal(parses({ op: "mcp.catalog", sessionId: "draft:1234" }), false);
	assert.equal(
		parses({ op: "mcp.catalog", cwd: "~", sessionId: "draft:1234" }),
		false,
	);
});

test("the composer coerces the draft pane's pair into a schema-valid payload", () => {
	const payload = mcpCatalogRequest("~", "draft:1234");
	assert.equal(payload.op, "mcp.catalog");
	assert.equal(parses(payload), true);
	// Both fields are DROPPED rather than rewritten: the route defaults the cwd
	// to the user's home, and a draft pane has no session overlay to ask for.
	assert.deepEqual(payload, { op: "mcp.catalog" });
});

test("real values survive the coercion and stay on the wire", () => {
	const payload = mcpCatalogRequest("/Users/you/projects/acme", "abcdef123456");
	assert.deepEqual(payload, {
		op: "mcp.catalog",
		cwd: "/Users/you/projects/acme",
		sessionId: "abcdef123456",
	});
	assert.equal(parses(payload), true);
	// Mixed pairs keep the real half and drop the synthetic one.
	assert.deepEqual(mcpCatalogRequest("/abs", "draft:x"), {
		op: "mcp.catalog",
		cwd: "/abs",
	});
	assert.deepEqual(mcpCatalogRequest("~", "abcdef123456"), {
		op: "mcp.catalog",
		sessionId: "abcdef123456",
	});
	// Windows absolute paths are the schema's own second arm; a relative path
	// is not a cwd the backend would accept; session ids are case-sensitive.
	assert.equal(mcpTransportCwd("C:\\Users\\you"), "C:\\Users\\you");
	assert.equal(mcpTransportCwd("relative/path"), null);
	assert.equal(mcpTransportSession("ABCDEF123456"), null);
});

test("the query key is built from the same coerced pair", () => {
	/*
	 * The key and the payload must be the same two values: an unsanitised key
	 * would hold a cache entry for a document that can never be fetched, beside
	 * the entry Settings reads for the same home (Q-1's second half).
	 */
	assert.deepEqual(
		mcpCatalogKeys.catalog(
			mcpTransportCwd("~"),
			mcpTransportSession("draft:1234"),
		),
		["desktop", "mcp-catalog", "", ""],
	);
});
