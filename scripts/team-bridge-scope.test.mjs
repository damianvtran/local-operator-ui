import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The multi-organization scope model, executed through esbuild so the test runs
 * the SAME TypeScript the renderer bundles — the house pattern beside
 * `team-bridge-model.test.mjs`.
 *
 * These are the decisions the page renders from props: which organization the
 * switcher names, how memberships join the one account aggregate, the merged
 * view's order and chips, and which rows a scope may show at all. No DOM and no
 * backend: a regression here is a pure function change.
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-model";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const membership = (tenantId, name, role = "member", status = "active") => ({
	tenant_id: tenantId,
	tenant_name: name,
	role,
	status,
	is_home: false,
	plan: {},
});

const conversation = (id, tenantId, lastMessageAt) => ({
	id,
	tenant_id: tenantId,
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: lastMessageAt,
	latest_seq: 0,
	members: [],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
});

const organizations = model.organizationOptions(
	[
		membership("tnt_1", "Minerva", "owner"),
		membership("tnt_2", "Northwind Collective"),
		membership("tnt_3", "Pending Org", "member", "pending"),
	],
	[
		{ tenant_id: "tnt_1", unread: 5 },
		{ tenant_id: "tnt_2", unread: 4 },
	],
);

test("the trigger names the scoped organization, or nothing for all", () => {
	assert.equal(
		model.organizationForScope(organizations, "tnt_1")?.name,
		"Minerva",
	);
	assert.equal(
		model.organizationForScope(organizations, "tnt_2")?.role,
		"member",
	);
	assert.equal(
		model.organizationForScope(organizations, model.TEAM_BRIDGE_ALL_SCOPE),
		null,
	);
});

test("a single-membership account starts in its only organization", () => {
	assert.equal(
		model.preferredScope(
			[organizations[0]],
			model.TEAM_BRIDGE_ALL_SCOPE,
			false,
		),
		"tnt_1",
	);
	// Several organizations, or a reader who chose All themselves, keep All.
	assert.equal(
		model.preferredScope(organizations, model.TEAM_BRIDGE_ALL_SCOPE, false),
		model.TEAM_BRIDGE_ALL_SCOPE,
	);
	assert.equal(
		model.preferredScope([organizations[0]], model.TEAM_BRIDGE_ALL_SCOPE, true),
		model.TEAM_BRIDGE_ALL_SCOPE,
	);
});

test("only active memberships become switcher rows", () => {
	assert.deepEqual(
		organizations.map((row) => row.tenantId),
		["tnt_1", "tnt_2"],
	);
});

test("per-org counts come from the account aggregate, zero when absent", () => {
	assert.deepEqual(
		organizations.map((row) => row.unread),
		[5, 4],
	);
	assert.equal(
		model.organizationOptions([membership("tnt_9", "Quiet")])[0].unread,
		0,
	);
});

test("an organization missing from the memberships read has no chip", () => {
	assert.equal(
		model.conversationOrganizationName(
			conversation("bcv_2", "tnt_2", "2026-10-18T10:00:00Z"),
			organizations,
		),
		"Northwind Collective",
	);
	assert.equal(
		model.conversationOrganizationName(
			conversation("bcv_x", "tnt_unknown", "2026-10-18T10:00:00Z"),
			organizations,
		),
		null,
	);
});

test("the merged view orders rows across organizations, newest first", () => {
	const ordered = model.mergedConversationOrder([
		conversation("bcv_old", "tnt_1", "2026-10-17T09:00:00Z"),
		conversation("bcv_new", "tnt_2", "2026-10-18T11:00:00Z"),
		conversation("bcv_mid", "tnt_1", "2026-10-18T08:00:00Z"),
	]);
	assert.deepEqual(
		ordered.map((row) => row.id),
		["bcv_new", "bcv_mid", "bcv_old"],
	);
});

test("equal instants break ties by id so rows do not swap between renders", () => {
	const same = "2026-10-18T10:00:00Z";
	const ordered = model.mergedConversationOrder([
		conversation("bcv_b", "tnt_1", same),
		conversation("bcv_a", "tnt_2", same),
	]);
	assert.deepEqual(
		ordered.map((row) => row.id),
		["bcv_a", "bcv_b"],
	);
});

test("the merged view withholds a row whose organization it cannot name", () => {
	const rows = [
		conversation("bcv_1", "tnt_1", "2026-10-18T10:00:00Z"),
		conversation("bcv_x", "tnt_unknown", "2026-10-18T12:00:00Z"),
	];
	assert.deepEqual(
		model
			.visibleConversationRows(rows, model.TEAM_BRIDGE_ALL_SCOPE, organizations)
			.map((row) => row.id),
		["bcv_1"],
	);
	// A single-organization scope keeps the server's rows as they arrived; the
	// tenant itself is the label there.
	assert.deepEqual(
		model
			.visibleConversationRows(rows, "tnt_1", organizations)
			.map((row) => row.id),
		["bcv_1", "bcv_x"],
	);
});

test("every merged row still names exactly one tenant", () => {
	const rows = model.visibleConversationRows(
		[
			conversation("bcv_1", "tnt_1", "2026-10-18T10:00:00Z"),
			conversation("bcv_2", "tnt_2", "2026-10-18T11:00:00Z"),
		],
		model.TEAM_BRIDGE_ALL_SCOPE,
		organizations,
	);
	assert.deepEqual(
		rows.map((row) => [row.id, row.tenant_id]),
		[
			["bcv_2", "tnt_2"],
			["bcv_1", "tnt_1"],
		],
	);
});

test("the account aggregate's total is the badge without conversation rows", () => {
	assert.equal(model.badgeTotal({ total: 9 }), 9);
	assert.equal(
		model.badgeTotal({
			total: 0,
			conversations: [
				{ muted: false, unread_count: 4 },
				{ muted: true, unread_count: 7 },
			],
		}),
		4,
	);
	// A zero total beside non-zero org rows is the same race the per-conversation
	// fallback covers; the badge must not undercount the aggregate either.
	assert.equal(
		model.badgeTotal({
			total: 0,
			organizations: [{ unread: 3 }, { unread: 2 }],
		}),
		5,
	);
});
