import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The union rail's per-organization grouping, executed through esbuild so the
 * test runs the SAME TypeScript the renderer bundles - the house pattern beside
 * `team-bridge-model.test.mjs`.
 *
 * WHAT IT PINS. People, Chiefs of staff and the union's loose DMs are fed by ONE
 * account-wide conversation list plus N per-organization rosters. Three
 * decisions follow from that and each is silent when wrong: which organization
 * names a row, that one DM is one row (a person's row IS their DM, the
 * single-org invariant the union used to break), and that a failed roster hides
 * nothing but its own rows.
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-org-rosters";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const rosters = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SELF = "acct_self";

const org = (tenantId, name = tenantId) => ({
	tenantId,
	name,
	role: "member",
	unread: 0,
});

const person = (label, accountId, patch = {}) => ({
	account_id: accountId,
	kind: "human",
	display_label: label,
	role: "member",
	state: "active",
	bridge_enabled: true,
	bridge_state: "active",
	...patch,
});

const chief = (label, accountId, agentName) =>
	person(label, accountId, {
		agent: { endpoint_id: `ep_${accountId}`, name: agentName, state: "active" },
	});

const selfMember = {
	account_id: "acct_self",
	kind: "human",
	display_label: "Self",
	role: "owner",
	state: "active",
};
const humanMember = (label, accountId) => ({
	account_id: accountId,
	kind: "human",
	display_label: label,
	role: "member",
	state: "active",
});
const agentMember = (label, accountId) => ({
	account_id: accountId,
	kind: "agent",
	display_label: label,
	role: "agent",
	state: "active",
});

const dm = (id, tenantId, members, patch = {}) => ({
	id,
	tenant_id: tenantId,
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: SELF,
	last_message_at: "2026-10-19T10:00:00Z",
	latest_seq: 2,
	members,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...patch,
});

test("subheaders appear only for a union over more than one organization", () => {
	assert.equal(rosters.orgGroupsVisible(true, 2), true);
	assert.equal(rosters.orgGroupsVisible(true, 3), true);
	// One organization: nothing to disambiguate, and the shipped flat view stands.
	assert.equal(rosters.orgGroupsVisible(true, 1), false);
	assert.equal(rosters.orgGroupsVisible(true, 0), false);
	// A single-org scope is never a union, however many organizations it spans.
	assert.equal(rosters.orgGroupsVisible(false, 3), false);
});

test("groups keep the switcher's order and carry only their own rows", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_2", "Northwind"), org("tnt_1", "Minerva")],
		directories: {
			tnt_1: [person("Ada", "acct_ada")],
			tnt_2: [person("Bea", "acct_bea"), person("Cyd", "acct_cyd")],
		},
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
		directs: [],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		result.map((group) => [group.tenantId, group.name]),
		[
			["tnt_2", "Northwind"],
			["tnt_1", "Minerva"],
		],
	);
	assert.deepEqual(
		result.map((group) => group.members.map((member) => member.display_label)),
		[["Bea", "Cyd"], ["Ada"]],
	);
});

test("a person's DM is folded into their row, not listed a second time", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: { tnt_1: [selfMember, person("Ada", "acct_ada")] },
		directoryStates: { tnt_1: "ready" },
		directs: [
			dm("bcv_ada", "tnt_1", [selfMember, humanMember("Ada", "acct_ada")]),
		],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		result[0].directs.map((row) => row.id),
		["bcv_ada"],
	);
	assert.deepEqual(rosters.looseDirectsFor(result), []);
});

test("a chief's agent DM folds into the chief row", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: { tnt_1: [selfMember, chief("Ben", "acct_ben", "Aida")] },
		directoryStates: { tnt_1: "ready" },
		directs: [
			dm("bcv_agent", "tnt_1", [selfMember, agentMember("Aida", "acct_ben")]),
		],
		selfAccountId: SELF,
	});
	assert.deepEqual(rosters.looseDirectsFor(result), []);
});

test("the reader's own DM stays listed: their own row paints nothing", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: { tnt_1: [selfMember] },
		directoryStates: { tnt_1: "ready" },
		directs: [
			dm("bcv_left", "tnt_1", [selfMember, humanMember("Gone", "acct_gone")]),
		],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		rosters.looseDirectsFor(result).map((row) => row.id),
		["bcv_left"],
	);
	assert.deepEqual(
		result[0].directs.map((row) => row.id),
		["bcv_left"],
	);
});

test("a failed roster keeps its organization, its state, and its DMs", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1"), org("tnt_2")],
		directories: { tnt_1: [selfMember, person("Ada", "acct_ada")] },
		directoryStates: { tnt_1: "ready", tnt_2: "error" },
		directs: [
			dm("bcv_ada", "tnt_1", [selfMember, humanMember("Ada", "acct_ada")]),
			dm("bcv_ghost", "tnt_2", [
				selfMember,
				humanMember("Ghost", "acct_ghost"),
			]),
		],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		result.map((group) => group.state),
		["ready", "error"],
	);
	assert.deepEqual(result[1].members, []);
	assert.deepEqual(result[1].chiefs, []);
	// Nothing paints that DM, so it must stay reachable under Direct messages.
	assert.deepEqual(
		rosters.looseDirectsFor(result).map((row) => row.id),
		["bcv_ghost"],
	);
});

test("a pending roster is a loading group with nothing to draw yet", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: {},
		directoryStates: { tnt_1: "loading" },
		directs: [],
		selfAccountId: SELF,
	});
	assert.equal(result[0].state, "loading");
	assert.deepEqual(result[0].members, []);
});

test("an unstated tenant with no roster is LOADING, not an empty organization", () => {
	/*
	 * DESIGN ROUND 1, D4. An absent state with no members is a read that never
	 * answered; calling it "ready" told the reader "No one else has joined this
	 * organization yet." about a roster nobody had fetched.
	 */
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directs: [],
		selfAccountId: SELF,
	});
	assert.equal(result[0].state, "loading");
	assert.deepEqual(result[0].members, []);
});

test("an unstated tenant that HAS a roster stays ready", () => {
	// The other half of D4: a painted roster must never turn into a spinner.
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: { tnt_1: [person("Ada", "acct_ada")] },
		directs: [],
		selfAccountId: SELF,
	});
	assert.equal(result[0].state, "ready");
});

test("direct messages are split by organization, never mixed", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1"), org("tnt_2")],
		directories: {},
		directoryStates: { tnt_1: "error", tnt_2: "error" },
		directs: [
			dm("bcv_1", "tnt_1", [selfMember, humanMember("Ada", "acct_ada")]),
			dm("bcv_2", "tnt_2", [selfMember, humanMember("Bea", "acct_bea")]),
			dm("bcv_9", "tnt_9", [selfMember, humanMember("Zed", "acct_zed")]),
		],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		result.map((group) => group.directs.map((row) => row.id)),
		[["bcv_1"], ["bcv_2"]],
	);
	assert.deepEqual(
		rosters.looseDirectsFor(result).map((row) => row.id),
		["bcv_1", "bcv_2"],
	);
});

test("chiefs come from that organization's roster and skip the reader", () => {
	const result = rosters.orgRosters({
		organizations: [org("tnt_1")],
		directories: {
			tnt_1: [
				chief("Self", SELF, "Mine"),
				chief("Ben", "acct_ben", "Aida"),
				person("Ada", "acct_ada"),
			],
		},
		directoryStates: { tnt_1: "ready" },
		directs: [],
		selfAccountId: SELF,
	});
	assert.deepEqual(
		result[0].chiefs.map((row) => row.agentName),
		["Aida"],
	);
});

test("a row key names its organization, so one person is two rows", () => {
	assert.equal(rosters.orgRowKey("tnt_1", "acct_ada"), "tnt_1:acct_ada");
	assert.notEqual(
		rosters.orgRowKey("tnt_1", "acct_ada"),
		rosters.orgRowKey("tnt_2", "acct_ada"),
	);
	assert.equal(
		rosters.orgGroupHeadingId("people", "tnt_1"),
		"team-bridge-org-people-tnt_1",
	);
	assert.notEqual(
		rosters.orgGroupHeadingId("people", "tnt_1"),
		rosters.orgGroupHeadingId("chiefs", "tnt_1"),
	);
});
