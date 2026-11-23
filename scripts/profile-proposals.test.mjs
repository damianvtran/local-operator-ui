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
test("pending-approval derivation: one list behind the nav badge, tab counts and row marks", () => {
	// The operator's case (2026-11-21): one TEAM proposal, viewed from the Agents
	// tab. Every count the page draws must agree with the nav badge's number.
	const data = m.profileProposalListSchema.parse({
		proposals: [
			proposal({ id: "t1", created_at: 10 }),
			proposal({ id: "t2", created_at: 30, state: "stale", stale: true }),
			proposal({ id: "a1", kind: "agent", name: "scout", created_at: 20 }),
			proposal({ id: "s1", kind: "skill", name: "research", created_at: 5 }),
			proposal({ id: "done", kind: "agent", name: "scout", state: "accepted" }),
			proposal({ id: "gone", kind: "skill", name: "x", state: "superseded" }),
		],
		// Core's per-record map disagrees on purpose: the page must not read it.
		counts: { team: { lopdev: 9 } },
	});
	const ids = m.pendingProposals(data).map((p) => p.id);
	assert.deepEqual(
		ids,
		["t2", "a1", "t1", "s1"],
		"newest first, stale kept, terminal dropped",
	);
	const byKind = m.pendingProposalCountsByKind(data);
	assert.deepEqual(byKind, { agent: 1, team: 2, skill: 1 });
	assert.equal(
		byKind.agent + byKind.team + byKind.skill,
		m.totalPendingProposals(data),
		"tab counts sum to the nav badge",
	);
	const teams = m.pendingProposalsByRecord(data, "team");
	assert.deepEqual([...teams.keys()], ["lopdev"]);
	assert.deepEqual(
		teams.get("lopdev").map((p) => p.id),
		["t2", "t1"],
		"a row opens its newest proposal",
	);
	assert.equal(
		m.pendingProposalsByRecord(data, "agent").get("scout").length,
		1,
	);
	assert.equal(m.pendingProposalsByRecord(data, "skill").has("x"), false);
	assert.equal(m.pendingProposalsByRecord(data, "agent").has("lopdev"), false);
	// No data (capability off, or not read yet) is zero everywhere, never a throw.
	assert.deepEqual(m.pendingProposals(undefined), []);
	assert.deepEqual(m.pendingProposalCountsByKind(undefined), {
		agent: 0,
		team: 0,
		skill: 0,
	});
	assert.equal(m.pendingProposalsByRecord(undefined, "team").size, 0);
	assert.equal(m.isAwaitingDecision(proposal({ state: "expired" })), false);
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

test("proposed-new rows: pending/stale creates for unknown names only, one per name (F4/U-F4)", () => {
	const row = (over) => ({
		id: "pp_0123456789abcdef",
		kind: "agent",
		name: "fresh",
		operation: "create",
		fields: [],
		state: "pending",
		stale: false,
		origin: { trust: "agent" },
		...over,
	});
	const list = {
		proposals: [
			row({ created_at: 1 }),
			row({ id: "pp_1111111111111111", created_at: 2 }),
			row({ name: "existing" }),
			row({ name: "updated", operation: "update" }),
			row({ name: "gone", state: "rejected" }),
			row({ name: "old", state: "expired" }),
			row({ name: "stalled", state: "stale", stale: true }),
			row({ name: "crew", kind: "team" }),
		],
		counts: {},
	};
	const agents = m.proposedNewProfiles(list, "agent", ["existing", "updated"]);
	assert.deepEqual(
		agents.map((p) => [p.name, p.id]),
		[
			["fresh", "pp_1111111111111111"],
			["stalled", "pp_0123456789abcdef"],
		],
	);
	assert.deepEqual(
		m.proposedNewProfiles(list, "team", []).map((p) => p.name),
		["crew"],
	);
	assert.deepEqual(m.proposedNewProfiles(undefined, "agent", []), []);
});
test("proposedNewProfiles: a skill create the library lacks is new; one it lists is not (PR #2026 R2/U1)", () => {
	// The Skills pane renders the review panel instead of SkillDetail's load
	// error exactly when this returns the selected name.
	const skill = (over) => ({
		id: "pp_2222222222222222",
		kind: "skill",
		name: "research-brief",
		operation: "create",
		fields: [],
		state: "pending",
		stale: false,
		origin: { trust: "agent" },
		...over,
	});
	const list = {
		proposals: [
			skill({}),
			skill({ id: "pp_3333333333333333", name: "installed" }),
			skill({ id: "pp_4444444444444444", name: "edit", operation: "update" }),
			skill({ id: "pp_5555555555555555", name: "agentish", kind: "agent" }),
		],
		counts: {},
	};
	assert.deepEqual(
		m
			.proposedNewProfiles(list, "skill", ["installed", "edit"])
			.map((p) => p.name),
		["research-brief"],
	);
});
