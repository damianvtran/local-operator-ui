import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
// Bundle TS, then evaluate with this file's dependency resolver; no temporary
// package tree, HOME, daemon or real account configuration is involved.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/api/local-operator/profile-proposals";',
			'export {desktopEndpoint,desktopRequestSchema} from "./src/shared/desktop-contract";',
			'export {meshRowsWithoutProfileProposals} from "./src/renderer/src/features/mesh/mesh-approvals";',
			'export {profileQueuedReceipt} from "./src/shared/profile-consent";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "cjs",
	platform: "node",
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
	define: { "import.meta.env": "{}" },
	loader: { ".css": "empty" },
	packages: "external",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@renderer": "./src/renderer/src",
	},
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	module,
	module.exports,
);
const m = module.exports;
const id = "pp_0123456789abcdef";
const requestId = "00000000-0000-4000-8000-000000000001";
const proposal = (over = {}) => ({
	id,
	kind: "team",
	name: "lopdev",
	operation: "update",
	fields: ["instructions"],
	state: "pending",
	stale: false,
	origin: { trust: "agent", session_id: "synthetic" },
	...over,
});
test("four operations compose exact §4 routes/bodies and refuse unsafe ids", () => {
	for (const [op, extra, path, method, body] of [
		["list", {}, "?state=pending", "GET", undefined],
		["get", { proposalId: id }, `/${id}`, "GET", undefined],
		[
			"accept",
			{
				proposalId: id,
				requestId,
				after: { delegate: true, tools: null, tags: { class: "reactive" } },
			},
			`/${id}/accept`,
			"POST",
			{
				request_id: requestId,
				after: { delegate: true, tools: null, tags: { class: "reactive" } },
			},
		],
		[
			"reject",
			{ proposalId: id, requestId, note: "No" },
			`/${id}/reject`,
			"POST",
			{ request_id: requestId, note: "No" },
		],
	]) {
		const ask = m.desktopRequestSchema.parse({
			op: `profileProposals.${op}`,
			...extra,
		});
		assert.deepEqual(m.desktopEndpoint(ask), {
			path: `/v1/desktop/profile-proposals${path}`,
			method,
			...(body ? { body } : {}),
		});
	}
	assert.equal(
		m.desktopRequestSchema.safeParse({
			op: "profileProposals.get",
			proposalId: "../../bad",
		}).success,
		false,
	);
	assert.equal(
		m.desktopRequestSchema.safeParse({
			op: "profileProposals.accept",
			proposalId: id,
			requestId,
			command: "apply",
		}).success,
		false,
	);
});
test("badges include stale pending proposals, ignore terminal states, and support supplied skills", () => {
	const data = m.profileProposalListSchema.parse({
		proposals: [
			proposal(),
			proposal({ id: "other", state: "stale", stale: true }),
			proposal({ state: "accepted" }),
			proposal({ kind: "skill", name: "research" }),
		],
		counts: { agent: {}, team: { lopdev: 2 } },
	});
	assert.equal(m.totalPendingProposals(data), 3);
	assert.equal(m.pendingProposalCount(data, "team", "lopdev"), 2);
	assert.equal(m.pendingProposalCount(data, "skill", "research"), 1);
	assert.equal(m.proposalsFor(data, "team", "lopdev").length, 2);
	assert.equal(m.totalPendingProposals(undefined), 0);
});
test("Edit-then-accept sends only changed proposal fields, parses list and JSON without losing false/null", () => {
	const changes = [
		{ field: "instructions", format: "text", after_text: "old" },
		{ field: "tools", format: "list", after_text: "read" },
		{ field: "delegate", format: "json", after_text: "true" },
		{ field: "policy", format: "json", after_text: "{}" },
	];
	assert.deepEqual(
		m.editedAfterBody(changes, {
			instructions: "new",
			tools: "read\nwrite\n",
			delegate: "false",
			policy: "null",
			intruder: "not allowed",
		}),
		{
			instructions: "new",
			tools: ["read", "write"],
			delegate: false,
			policy: null,
		},
	);
	assert.equal(m.editedAfterBody(changes, {}), undefined);
	assert.throws(
		() => m.editedAfterBody(changes, { policy: "bad json" }),
		SyntaxError,
	);
});
test("Mesh drops profile rows only with new capability; ordinary approvals survive", () => {
	const rows = [
		{ kind: "profile", id: "a" },
		{ kind: "device", id: "b" },
		{ kind: "credential", id: "c" },
	];
	assert.equal(m.meshRowsWithoutProfileProposals(rows, false), rows);
	assert.deepEqual(
		m.meshRowsWithoutProfileProposals(rows, true).map((r) => r.id),
		["b", "c"],
	);
});
test("proposed receipt is bounded, deep link preserves name/proposal without injection", () => {
	const receipt = {
		status: "proposed",
		proposal_id: id,
		profile_kind: "team",
		profile_name: "lopdev",
		scope: "global",
		fields: ["instructions"],
		diff: ["+New instructions"],
	};
	assert.ok(m.profileQueuedReceipt(receipt));
	assert.equal(m.profileQueuedReceipt({ ...receipt, shell: "apply" }), null);
	const url = new URL(
		m.proposalReviewPath("team", "a & b", id),
		"http://local/",
	);
	assert.equal(url.searchParams.get("name"), "a & b");
	assert.equal(url.searchParams.get("proposal"), id);
});
