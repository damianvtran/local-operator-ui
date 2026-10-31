import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

/*
 * tb-instant-open: the scope the page opens in, BEFORE the organization list
 * exists. The shell watcher's cached rows name their own organization, which is
 * what lets a single-organization account paint its rail before the eligibility
 * gate answers instead of waiting behind a full-screen spinner.
 */
test("the watcher's own rows decide the scope before the organization list", () => {
	const rows = [
		conversation("bcv_1", "tnt_1", "2026-10-18T10:00:00Z"),
		conversation("bcv_2", "tnt_1", "2026-10-18T11:00:00Z"),
	];
	assert.equal(
		model.preferredScope([], model.TEAM_BRIDGE_ALL_SCOPE, false, rows),
		"tnt_1",
	);
	// Rows naming more than one organization say nothing about a single scope, so
	// the merged view holds until the organization list answers.
	assert.equal(
		model.preferredScope([], model.TEAM_BRIDGE_ALL_SCOPE, false, [
			...rows,
			conversation("bcv_3", "tnt_2", "2026-10-18T12:00:00Z"),
		]),
		model.TEAM_BRIDGE_ALL_SCOPE,
	);
	// The organization list is the stronger statement and supersedes the snapshot:
	// several organizations put the page back on the merged view, one adopts its own.
	assert.equal(
		model.preferredScope(organizations, "tnt_1", false, rows),
		model.TEAM_BRIDGE_ALL_SCOPE,
	);
	assert.equal(
		model.preferredScope([organizations[1]], "tnt_1", false, rows),
		"tnt_2",
	);
	// And a scope the reader chose outranks both.
	assert.equal(model.preferredScope([], "tnt_2", true, rows), "tnt_2");
	assert.equal(
		model.preferredScope([], model.TEAM_BRIDGE_ALL_SCOPE, false),
		model.TEAM_BRIDGE_ALL_SCOPE,
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

/*
 * F6 on #1314: the merged filter and the labels come from the HUB's tenant list
 * (bridge status `status.tenants[]`), not Radient memberships. The memberships
 * read can lack a tenant the hub serves; filtering by it emptied the rail.
 */
test("the hub's tenant list, not memberships, decides which merged rows show", () => {
	const hubTenants = [
		{
			tenant_id: "tnt_1",
			tenant_name: "Minerva",
			eligible: true,
			endpoint: null,
		},
		{
			tenant_id: "tnt_2",
			tenant_name: "Northwind Collective",
			eligible: true,
			endpoint: null,
		},
	];
	const memberships = [membership("tnt_1", "Minerva", "owner")];
	const rows = [
		conversation("bcv_1", "tnt_1", "2026-10-18T10:00:00Z"),
		conversation("bcv_2", "tnt_2", "2026-10-18T11:00:00Z"),
		conversation("bcv_3", "tnt_3", "2026-10-18T12:00:00Z"),
	];

	// The old filter, reproduced: memberships alone drop the hub's tnt_2 row.
	const membershipOnly = model.organizationOptions(memberships);
	assert.deepEqual(
		model
			.visibleConversationRows(
				rows,
				model.TEAM_BRIDGE_ALL_SCOPE,
				membershipOnly,
			)
			.map((row) => row.id),
		["bcv_1"],
	);

	const fromHub = model.organizationOptions(memberships, [], hubTenants);
	assert.deepEqual(
		fromHub.map((org) => [org.tenantId, org.name, org.role]),
		[
			["tnt_1", "Minerva", "owner"],
			["tnt_2", "Northwind Collective", ""],
		],
	);
	// Merged: both hub tenants show; tnt_3, which the hub does not list, stays
	// hidden.
	assert.deepEqual(
		model
			.visibleConversationRows(rows, model.TEAM_BRIDGE_ALL_SCOPE, fromHub)
			.map((row) => row.id),
		["bcv_2", "bcv_1"],
	);
	// The per-org scope keeps its existing behaviour: the server's rows as sent.
	assert.deepEqual(
		model
			.visibleConversationRows([rows[1]], "tnt_2", fromHub)
			.map((row) => row.id),
		["bcv_2"],
	);
	assert.equal(
		model.organizationForScope(fromHub, "tnt_2")?.name,
		"Northwind Collective",
	);
	assert.equal(
		model.conversationOrganizationName(rows[1], fromHub),
		"Northwind Collective",
	);
	assert.equal(model.conversationOrganizationName(rows[2], fromHub), null);
});

test("a hub tenant is named by the hub, then the membership, then its id", () => {
	const orgs = model.organizationOptions(
		[
			membership("tnt_1", "Minerva (membership)"),
			membership("tnt_2", "Northwind"),
		],
		[{ tenant_id: "tnt_2", unread: 4 }],
		[
			{
				tenant_id: "tnt_1",
				tenant_name: "Minerva",
				eligible: true,
				endpoint: null,
			},
			{ tenant_id: "tnt_2", eligible: true, endpoint: null },
			{ tenant_id: "tnt_9", tenant_name: "  ", eligible: true, endpoint: null },
			{
				tenant_id: "tnt_9",
				tenant_name: "Duplicate",
				eligible: true,
				endpoint: null,
			},
		],
	);
	assert.deepEqual(
		orgs.map((org) => [org.tenantId, org.name, org.unread]),
		[
			["tnt_1", "Minerva", 0],
			["tnt_2", "Northwind", 4],
			["tnt_9", "tnt_9", 0],
		],
	);
});

test("without a hub tenant list, active memberships remain the source", () => {
	assert.deepEqual(
		model
			.organizationOptions([membership("tnt_1", "Minerva")], [], null)
			.map((org) => org.tenantId),
		["tnt_1"],
	);
});

/*
 * #1322 round 1 m2: the container's half of F6. The page reads the hub list
 * through `hubTenantList` and decides the merged rail's loading/error through
 * `organizationsReadState`; reverting either to memberships would pass the
 * view test above, so both decisions are asserted here and the page is held
 * to calling them.
 */
test("the hub list is read from the status payload, absent stays null", () => {
	const tenants = [{ tenant_id: "tnt_2", eligible: true, endpoint: null }];
	assert.deepEqual(model.hubTenantList({ status: { tenants } }), tenants);
	// Null, not [], is what keeps memberships as the fallback source.
	assert.equal(model.hubTenantList({ status: null }), null);
	assert.equal(model.hubTenantList(undefined), null);
});

test("memberships hold or fail the merged rail only without a hub list", () => {
	const loading = { isLoading: true, isError: false };
	const failed = { isLoading: false, isError: true };
	const hub = [{ tenant_id: "tnt_2" }];
	assert.deepEqual(model.organizationsReadState(hub, loading), {
		pending: false,
		failed: false,
	});
	assert.deepEqual(model.organizationsReadState(hub, failed), {
		pending: false,
		failed: false,
	});
	assert.deepEqual(model.organizationsReadState(null, loading), {
		pending: true,
		failed: false,
	});
	assert.deepEqual(model.organizationsReadState(null, failed), {
		pending: false,
		failed: true,
	});
});

test("the page wires the hub list into the organizations and the rail state", () => {
	const source = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(source, /const hubTenants = hubTenantList\(status\.data\);/);
	assert.match(
		source,
		/organizationOptions\(\s*memberships\.memberships,\s*unread\.data\?\.organizations,\s*hubTenants,\s*\)/,
	);
	assert.match(source, /organizationsReadState\(hubTenants, memberships\)/);
	// The rail and the switcher read the derived state, never memberships raw.
	assert.match(source, /mergedView && organizationsPending/);
	assert.match(source, /mergedView && organizationsFailed/);
	assert.doesNotMatch(source, /mergedView && memberships\.is(Loading|Error)/);
	assert.doesNotMatch(source, /membershipsLoading=\{memberships\.isLoading\}/);
	assert.doesNotMatch(source, /organizationsFailed=\{memberships\.isError\}/);
});

/*
 * #1322 round 1 m1: a notification banner names its org from the account
 * aggregate's `tenant_name`, which the watcher already holds, before
 * memberships.
 */
test("the notification watcher names orgs from the unread aggregate first", () => {
	const aggregate = [
		{ tenant_id: "tnt_2", tenant_name: "Northwind", unread: 3, eligible: true },
		{ tenant_id: "tnt_1", tenant_name: "", unread: 1, eligible: true },
	];
	const orgs = model.organizationOptions(
		[membership("tnt_1", "Minerva")],
		aggregate,
		aggregate,
	);
	assert.deepEqual(
		orgs.map((org) => [org.tenantId, org.name, org.unread]),
		[
			["tnt_2", "Northwind", 3],
			["tnt_1", "Minerva", 1],
		],
	);
	const source = readFileSync(
		"src/renderer/src/features/team-bridge/use-team-bridge-notifications.ts",
		"utf8",
	);
	assert.match(
		source,
		/organizationOptions\(\s*membershipsData\?\.memberships \?\? \[\],\s*accountUnread\.data\.organizations,\s*accountUnread\.data\.organizations \?\? null,\s*\)/,
	);
});

test("a cast membership with no name does not throw", () => {
	const orgs = model.organizationOptions(
		[{ tenant_id: "tnt_1", role: "member", status: "active" }],
		[],
		[{ tenant_id: "tnt_1", tenant_name: "" }],
	);
	assert.equal(orgs[0].name, "tnt_1");
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

/*
 * `badgeTotal` IS TEST-ONLY (agent review round 1, m4). It is the
 * pre-one-source formula: the badge now reads the merged view
 * (`teamBridgeUnreadView`), so a production caller would be a second way to
 * answer "what is the badge number", and the old split arithmetic is exactly
 * what let the badge and a row disagree. The arithmetic itself is still pinned
 * below for the deletion follow-up; this pin keeps it out of production.
 *
 * References are matched on COMMENT-STRIPPED source, so prose about the legacy
 * helper (like this note) is not an offender, while an import, a call or a
 * re-export is.
 */
test("no production module outside the model mentions badgeTotal", () => {
	const MODEL = "src/renderer/src/features/team-bridge/team-bridge-model.ts";
	const offenders = [];
	for (const entry of readdirSync("src", { recursive: true })) {
		const path = `src/${entry}`;
		if (path === MODEL || !/\.(ts|tsx)$/.test(path)) continue;
		const source = readFileSync(path, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		if (/\bbadgeTotal\b/.test(source)) offenders.push(path);
	}
	assert.deepEqual(offenders, [], "badgeTotal must not reach production code");
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
