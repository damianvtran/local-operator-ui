import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * One `mcp.list` document, one shape, two consumers.
 *
 * This pins the defect `shared/api/local-operator/mcp-list.ts` was extracted to
 * close: `["desktop","mcp",sessionId]` was one React Query key with two query
 * functions caching DIFFERENT shapes. The run panel cached the transport
 * envelope (`return await desktopResult<McpListPayload>(…)`) and read
 * `query.data?.data?.servers`; the Settings section cached `result.data` and
 * read `listQuery.data?.servers`. Whichever queryFn wrote last decided what the
 * other read, and because the panel polls every 15 s while a chat is open it was
 * nearly always the last writer — so Settings read `undefined` inside its own
 * 10 s `staleTime` and rendered "No MCP servers configured yet. Add one below."
 * with servers configured.
 *
 * Two halves, and they prove different things:
 *
 * 1. EXECUTION. `fetchMcpList` is run against the route's real envelope shape
 *    over a stubbed desktop transport, and the value a second unwrap would leave
 *    is measured: reading `.servers` off an envelope yields nothing, which is
 *    exactly what Settings did to a panel-written entry. The same assertion is
 *    what fails if the shared fetch ever unwraps twice.
 * 2. SOURCE. Both consumers take their key and their document from the shared
 *    module and neither performs a second unwrap of its own. This is the half
 *    that keeps the bug from returning through a NEW caller, which no execution
 *    test can see: the brief's risk 2 is a future consumer inventing a third
 *    shape, and a third shape is a fact about the sources.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/mcp-list";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const { fetchMcpList, mcpKeys, mcpListOperations, mcpListServers } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

/**
 * The transport, stubbed at the seam the renderer really uses.
 *
 * `desktop-api.desktopRequest` prefers `window.api.desktop.request` (the preload
 * bridge) and falls back to `fetch("/__desktop")`, so installing the bridge is
 * what makes this a run of the product's own request path rather than of a
 * re-implementation of it.
 */
/**
 * Every TypeScript source under a directory.
 *
 * Hand-rolled rather than a glob dependency: this test's own bundle step pulls
 * esbuild and nothing else, and the walk is over a few hundred files — the point is
 * that the claim is made over the WHOLE renderer rather than over two named files,
 * so a third reader of the op cannot slip past it.
 */
const rendererSources = (root) => {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
		}
	};
	walk(root);
	return out;
};

const installBridge = (request) => {
	const page = globalThis;
	page.window = page.window ?? {};
	page.window.api = {
		desktop: {
			request: async (sent) => {
				request(sent);
				return {
					status: 200,
					// Lifecycle routes wrap their result as `{data, replayed?}`.
					body: { result: { data: DOCUMENT, replayed: false } },
				};
			},
		},
	};
};

/** `GET /v1/desktop/sessions/{id}/mcp` for a session with two servers. */
const DOCUMENT = {
	servers: [
		{
			name: "hubspot",
			source: "~/.local-operator/mcp.json",
			owned_scope: "global",
			status: "auth-required",
			transport: "http",
		},
		{
			name: "notion",
			source: "~/.local-operator/mcp.json",
			owned_scope: "project",
			status: "connected",
			tool_count: 24,
		},
	],
	operations: [
		{
			id: "op-1",
			name: "hubspot",
			action: "reauth",
			status: "running",
			created_at: 1_700_000_000,
			credential_removed: false,
		},
	],
};

test("fetchMcpList returns the document, not the envelope around it", async () => {
	const sent = [];
	installBridge((request) => sent.push(request));

	const state = await fetchMcpList("session-1");

	assert.deepEqual(sent, [{ op: "mcp.list", sessionId: "session-1" }]);
	assert.deepEqual(state, DOCUMENT);
	assert.deepEqual(
		mcpListServers(state).map((server) => server.name),
		["hubspot", "notion"],
	);
	assert.deepEqual(
		mcpListOperations(state).map((operation) => operation.id),
		["op-1"],
	);
});

test("the envelope a second unwrap would read carries no servers", () => {
	/*
	 * The exact value the OLD Settings read produced on a panel-written entry:
	 * `listQuery.data?.servers` where `data` is the transport envelope. It is
	 * `undefined` for a populated payload, which is the empty-list render, and
	 * this assertion is what breaks if `fetchMcpList` ever returns the envelope.
	 */
	const envelope = { data: DOCUMENT, replayed: false };
	assert.deepEqual(mcpListServers(envelope), []);
	assert.deepEqual(mcpListOperations(envelope), []);
	// And the document itself is what the panel used to skip past.
	assert.equal(mcpListServers(DOCUMENT).length, 2);
});

test("one key for one document, with no session in it to drift", () => {
	assert.deepEqual(mcpKeys.list("session-1"), [
		"desktop",
		"mcp",
		"session-1",
	]);
	// Invalidation callers pass the session id, so the key must be a function of
	// it and nothing else.
	assert.notDeepEqual(mcpKeys.list("a"), mcpKeys.list("b"));
});

test("both consumers read the shared module, and neither unwraps again", () => {
	const panel = readFileSync(
		"src/renderer/src/features/chat/components/run-details/use-mcp-servers.ts",
		"utf8",
	);
	const settings = readFileSync(
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
		"utf8",
	);

	for (const [label, source] of [
		["the run panel", panel],
		["the settings section", settings],
	]) {
		assert.match(
			source,
			/from "@shared\/api\/local-operator\/mcp-list"/,
			`${label} must take the mcp.list key and fetch from the shared module`,
		);
		assert.doesNotMatch(
			source,
			/\.data\?\.data\?\.servers|\?\.data\?\.servers/,
			`${label} must not unwrap the mcp.list envelope a second time`,
		);
		assert.doesNotMatch(
			source,
			/result\) => result\.data,?\s*\)/,
			`${label} must not cache its own shape under the shared key`,
		);
	}

	// The panel reads the document's fields, which is the level the shared fetch
	// settles on.
	assert.match(panel, /query\.data\?\.servers/);
	assert.match(settings, /mcpListServers\(listQuery\.data\)/);

	// And the key is not restated anywhere: one module owns it, so a third
	// consumer cannot invent a shape this test does not see.
	assert.doesNotMatch(settings, /export const mcpKeys/);

	/*
	 * The sharpest form of the same claim, over the whole renderer rather than over
	 * the two files named above: `op: "mcp.list"` appears in ONE place. The header of
	 * this file describes the risk as a THIRD consumer, and a test that names two
	 * files cannot see one arrive — this can, wherever it lands (code review round 1,
	 * nit 8). A file that needs the list takes `fetchMcpList`/`mcpKeys` from the
	 * module; a file that spells the op itself is about to cache a shape of its own
	 * under the same key, which is exactly the defect this branch fixes.
	 */
	const offenders = [];
	for (const file of rendererSources("src/renderer/src")) {
		if (file.endsWith("shared/api/local-operator/mcp-list.ts")) continue;
		if (/op:\s*["']mcp\.list["']/.test(readFileSync(file, "utf8"))) {
			offenders.push(file);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		"only mcp-list.ts may spell the mcp.list op: every other reader would cache a second shape under the shared key",
	);
});
