import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * RFC v2.4 Amendment A, client half: the switcher's two groups and the
 * opening rule. Executed through esbuild so the test runs the SAME TypeScript
 * the renderer bundles - the house pattern of `team-bridge-scope-preference.test.mjs`.
 *
 * WHAT IS PINNED, AND WHY HERE.
 * - "All organizations" merges private orgs only: a community never lands in
 *   the Organizations group or its unread total, even when an untyped boundary
 *   casts one into the organization array.
 * - Invitation, session and valid durable picks precede the cold default.
 *   Only a clearly eligible Team org wins a cold multi-org open.
 * - The session store: `sessionStorage`-shaped, per account, separate key from
 *   the durable preference, so a restart (an empty session store) reapplies the
 *   rule.
 */
const bundle = await build({
	stdin: {
		contents: [
			`export * from "./src/renderer/src/features/team-bridge/team-bridge-scope-preference";`,
			`export { organizationOptions, teamBridgeSwitcherGroups, TEAM_BRIDGE_COMMUNITY_SEARCH_THRESHOLD } from "./src/renderer/src/features/team-bridge/team-bridge-model";`,
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ALL = "all";
const org = (tenantId, extra = {}) => ({
	tenantId,
	name: tenantId,
	role: "member",
	unread: 0,
	...extra,
});
const community = (communityId, unread = 0) => ({
	kind: "community",
	communityId,
	name: communityId,
	unread,
});
const minerva = org("tnt_minerva", {
	name: "Minerva",
	role: "owner",
	unread: 9,
});
const acme = org("tnt_acme", { name: "Acme Labs", unread: 3 });
const loc = community("cmty_local_operator", 4);
const priv = (scope) => ({ kind: "private", scope });
const cmty = (communityId) => ({ kind: "community", communityId });

/* ---------------------------------------------------------------- grouping */

test("communities are their own group; All organizations sums private orgs only", () => {
	const groups = m.teamBridgeSwitcherGroups({
		organizations: [minerva, acme],
		communities: [loc],
		communitiesEnabled: true,
	});
	assert.deepEqual(
		groups.organizations.map((row) => row.tenantId),
		["tnt_minerva", "tnt_acme"],
	);
	assert.equal(groups.organizationsUnread, 12, "D21: 9 + 3, never + 4");
	assert.deepEqual(
		groups.communities.map((row) => row.communityId),
		["cmty_local_operator"],
	);
	assert.equal(groups.showCommunities, true);
	assert.equal(groups.searchCommunities, false);
});

test("a community cast into the organization array never joins the merged group", () => {
	const smuggled = { ...org("cmty_x", { unread: 50 }), kind: "community" };
	const groups = m.teamBridgeSwitcherGroups({
		organizations: [minerva, smuggled],
		communities: [],
		communitiesEnabled: false,
	});
	assert.deepEqual(
		groups.organizations.map((row) => row.tenantId),
		["tnt_minerva"],
	);
	assert.equal(groups.organizationsUnread, 9);
});

test("the Communities group is hidden only with none joined AND the flag off", () => {
	const view = (communities, communitiesEnabled) =>
		m.teamBridgeSwitcherGroups({
			organizations: [minerva],
			communities,
			communitiesEnabled,
		}).showCommunities;
	assert.equal(view([], false), false, "dark: menu is the pre-Amendment one");
	assert.equal(view([], true), true, "flag on: Browse with nothing joined");
	assert.equal(
		view([loc], false),
		true,
		"joined stays visible if flag flips off",
	);
	assert.equal(view([loc], true), true);
});

test("more than six joined communities brings search; the query filters by name", () => {
	const names = [
		"Local Operator Community",
		"Rust Agents Guild",
		"Prompt Engineers",
		"Open Data Commons",
		"Homelab Builders",
		"Indie SaaS Founders",
		"LLM Evals Working Group",
		"Agents in Production",
	];
	const joined = names.map((name, index) => ({
		...community(`cmty_${index}`),
		name,
	}));
	assert.equal(m.TEAM_BRIDGE_COMMUNITY_SEARCH_THRESHOLD, 6);
	const six = m.teamBridgeSwitcherGroups({
		organizations: [],
		communities: joined.slice(0, 6),
		communitiesEnabled: true,
	});
	assert.equal(six.searchCommunities, false, "exactly six: no search");
	const eight = m.teamBridgeSwitcherGroups({
		organizations: [],
		communities: joined,
		communitiesEnabled: true,
		query: "  AGENT ",
	});
	assert.equal(eight.searchCommunities, true);
	assert.deepEqual(
		eight.communities.map((row) => row.name),
		["Rust Agents Guild", "Agents in Production"],
	);
	const none = m.teamBridgeSwitcherGroups({
		organizations: [],
		communities: joined,
		communitiesEnabled: true,
		query: "zzz",
	});
	assert.equal(none.communities.length, 0);
	assert.equal(
		none.searchCommunities,
		true,
		"the field never vanishes mid-typing",
	);
});

/* ------------------------------------------------------- default selection */

const resolve = (input) => m.resolveDefaultSelection(input);

const knownTeam = { ...minerva, openingEligible: true };
const knownHome = { ...acme, openingEligible: false };

test("no organizations and no communities: nothing to decide yet", () => {
	assert.equal(resolve({ organizations: [] }), null);
});

test("one private org opens on it, with or without a community joined", () => {
	assert.deepEqual(resolve({ organizations: [acme] }), priv("tnt_acme"));
	assert.deepEqual(
		resolve({ organizations: [acme], communities: [loc] }),
		priv("tnt_acme"),
	);
});

test("cold start prefers the eligible team over the account home", () => {
	assert.deepEqual(
		resolve({ organizations: [knownHome, knownTeam], stored: "tnt_gone" }),
		priv("tnt_minerva"),
	);
});

test("cold start uses All when Team eligibility is tied, incomplete or absent", () => {
	for (const other of [acme, { ...acme, openingEligible: true }]) {
		assert.deepEqual(resolve({ organizations: [other, knownTeam] }), priv(ALL));
	}
	assert.deepEqual(resolve({ organizations: [knownHome, acme] }), priv(ALL));
});

test("status owns cold-open hints and cannot gain targets from memberships", () => {
	const membership = (tenant_id, status, planStatus) => ({
		tenant_id,
		tenant_name: tenant_id,
		role: "member",
		status,
		plan: { status: planStatus },
	});
	const memberships = [
		membership("tnt_acme", "active", "active"),
		membership("tnt_minerva", "active", "past_due"),
		membership("tnt_missing", "active", "active"),
		membership("tnt_disabled", "disabled", "active"),
	];
	const status = [
		{ tenant_id: "tnt_acme", eligible: false },
		{ tenant_id: "tnt_disabled", eligible: false },
		{ tenant_id: "tnt_minerva", eligible: true },
	];
	const orgs = m.organizationOptions(memberships, [], status);
	assert.deepEqual(
		orgs.map((row) => row.tenantId),
		["tnt_acme", "tnt_disabled", "tnt_minerva"],
	);
	assert.deepEqual(resolve({ organizations: orgs }), priv("tnt_minerva"));
	assert.deepEqual(
		resolve({ organizations: m.organizationOptions(memberships, [], []) }),
		null,
		"an empty authoritative list is not permission to fall back",
	);
	assert.deepEqual(
		resolve({
			organizations: m.organizationOptions(
				memberships,
				[],
				[status[0], status[1]],
			),
		}),
		priv(ALL),
		"no absent membership can become the preferred Team org",
	);
});

test("legacy status uses known plans from active memberships only", () => {
	const membership = (tenant_id, status, plan) => ({
		tenant_id,
		tenant_name: tenant_id,
		role: "member",
		status,
		plan,
	});
	const team = membership("tnt_minerva", "active", { status: "past_due" });
	const home = membership("tnt_acme", "active", { status: "none" });
	const disabled = membership("tnt_disabled", "disabled", { status: "active" });
	for (const plan of ["past_due", "active"]) {
		const orgs = m.organizationOptions([
			home,
			{ ...team, plan: { status: plan } },
			disabled,
		]);
		assert.deepEqual(
			orgs.map((row) => row.tenantId),
			["tnt_acme", "tnt_minerva"],
		);
		assert.deepEqual(resolve({ organizations: orgs }), priv("tnt_minerva"));
	}
	for (const plan of [undefined, { status: "unknown" }]) {
		const orgs = m.organizationOptions([{ ...home, plan }, team, disabled]);
		assert.deepEqual(resolve({ organizations: orgs }), priv(ALL));
	}
});

test("a pending private invitation outranks the default org and a joined community", () => {
	const invited = { ...acme, invited: true };
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, invited],
			communities: [loc],
			stored: "tnt_minerva",
		}),
		priv("tnt_acme"),
	);
	assert.deepEqual(
		resolve({ organizations: [invited], communities: [loc] }),
		priv("tnt_acme"),
		"D22: invited-only account with a community still opens on the invitation",
	);
});

test("a community is the default only with no private org and no invitation", () => {
	assert.deepEqual(
		resolve({ organizations: [], communities: [loc, community("cmty_b")] }),
		cmty("cmty_local_operator"),
	);
	assert.deepEqual(
		resolve({ organizations: [knownTeam, knownHome], communities: [loc] }),
		priv("tnt_minerva"),
		"a clear Team org still precedes a community",
	);
});

test("a pending invitation outranks this app session's scope (RFC §3 order; review m1)", () => {
	const invited = { ...acme, invited: true };
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, invited],
			session: priv(ALL),
		}),
		priv("tnt_acme"),
		"an invitation arriving mid-session is shown, not hidden behind the earlier scope",
	);
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, invited],
			communities: [loc],
			session: cmty("cmty_local_operator"),
		}),
		priv("tnt_acme"),
		"nor behind a community the reader switched to",
	);
});

test("this app session's scope outranks the default org while still valid", () => {
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, knownHome],
			session: priv(ALL),
		}),
		priv(ALL),
		"the reader moved to the union this session; leaving and returning keeps it",
	);
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, knownHome],
			communities: [loc],
			session: cmty("cmty_local_operator"),
		}),
		cmty("cmty_local_operator"),
		"a community switch lasts until the reader switches back or restarts",
	);
});

test("a session scope that is no longer valid falls through to the launch rule", () => {
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, knownHome],
			session: priv("tnt_gone"),
		}),
		priv("tnt_minerva"),
	);
	assert.deepEqual(
		resolve({
			organizations: [knownTeam, knownHome],
			session: cmty("cmty_left"),
		}),
		priv("tnt_minerva"),
	);
	assert.deepEqual(
		resolve({ organizations: [minerva], session: priv(ALL) }),
		priv("tnt_minerva"),
		"a session union is meaningless once only one org remains",
	);
});

test("a restart with an empty session store honors the valid durable pick", () => {
	const session = fakeStorage();
	for (const stored of ["tnt_acme", ALL]) {
		assert.equal(
			m.resolveOpeningScope({
				organizations: [knownTeam, knownHome],
				stored,
				session: m.readSessionScope(session, "acct-1"),
				chosen: false,
				current: stored,
			}),
			stored,
		);
	}
});

/* ------------------------------------------------------ opening scope page */

test("resolveOpeningScope: deep link and an on-page pick still outrank everything", () => {
	const base = {
		organizations: [minerva, acme],
		session: ALL,
		current: "tnt_acme",
	};
	assert.equal(
		m.resolveOpeningScope({ ...base, requestedTenant: "tnt_x", chosen: false }),
		"tnt_x",
	);
	assert.equal(m.resolveOpeningScope({ ...base, chosen: true }), "tnt_acme");
	assert.equal(m.resolveOpeningScope({ ...base, chosen: false }), ALL);
});

test("resolveOpeningScope: a remembered union survives a pending organization list", () => {
	assert.equal(
		m.resolveOpeningScope({
			organizations: [],
			session: ALL,
			chosen: false,
			current: ALL,
			snapshotRows: [{ tenant_id: "tnt_minerva" }],
		}),
		ALL,
	);
});

/* ------------------------------------- the default-org hold (review M1/m2) */

test("openingDefaultHeld: several orgs and memberships unsettled hold the opening", () => {
	const base = {
		organizationCount: 2,
		membershipsSettled: false,
		chosen: false,
	};
	assert.equal(m.openingDefaultHeld(base), true);
	assert.equal(
		m.openingDefaultHeld({ ...base, membershipsSettled: true }),
		false,
		"answered (or failed) memberships settle it",
	);
	assert.equal(
		m.openingDefaultHeld({ ...base, organizationCount: 1 }),
		false,
		"one org is the answer whatever the default: tb-instant-open is untouched",
	);
	assert.equal(m.openingDefaultHeld({ ...base, organizationCount: 0 }), false);
	assert.equal(m.openingDefaultHeld({ ...base, chosen: true }), false);
	assert.equal(
		m.openingDefaultHeld({ ...base, requestedTenant: "tnt_acme" }),
		false,
	);
	assert.equal(
		m.openingDefaultHeld({ ...base, session: "tnt_acme" }),
		false,
		"a session scope outranks the default, so waiting would buy nothing",
	);
});

test("openingOrganizationCount: the list when known, else the snapshot's tenants", () => {
	assert.equal(m.openingOrganizationCount([minerva, acme], []), 2);
	assert.equal(
		m.openingOrganizationCount(
			[],
			[
				{ tenant_id: "tnt_minerva" },
				{ tenant_id: "tnt_acme" },
				{ tenant_id: "tnt_acme" },
			],
		),
		2,
		"a two-tenant snapshot proves a multi-org account before the status answers",
	);
	assert.equal(m.openingOrganizationCount([], [{ tenant_id: "tnt_acme" }]), 1);
	assert.equal(m.openingOrganizationCount([], undefined), 0);
});

test("resolveOpeningScope: a held opening keeps the seed and decides nothing", () => {
	assert.equal(
		m.resolveOpeningScope({
			organizations: [minerva, acme],
			stored: "tnt_acme",
			chosen: false,
			current: "tnt_acme",
			defaultPending: true,
		}),
		"tnt_acme",
	);
	assert.equal(
		m.resolveOpeningScope({
			organizations: [minerva, acme],
			requestedTenant: "tnt_x",
			chosen: false,
			current: "tnt_acme",
			defaultPending: true,
		}),
		"tnt_x",
		"a deep link is never held",
	);
});

/*
 * The cold launch the review reproduced (M1), driven through the same three
 * page decisions in order: is the opening held, what scope does it resolve
 * to, and is that answer recorded. The page paints its gate loading state
 * while held (pinned in the page-source test below), so the only scopes that
 * ever reach the screen or `sessionStorage` are the ones this walk records.
 */
function coldLaunch({ stored, phases }) {
	const session = fakeStorage();
	let scope = stored ?? ALL; // the page's synchronous seed on a restart
	const painted = [];
	for (const phase of phases) {
		const organizationCount = m.openingOrganizationCount(
			phase.organizations,
			phase.snapshotRows,
		);
		const sessionScope = m.readSessionScope(session, "acct-1");
		const held = m.openingDefaultHeld({
			organizationCount,
			membershipsSettled: phase.memberships !== "loading",
			chosen: false,
			session: sessionScope,
		});
		if (held) {
			painted.push("held");
			continue;
		}
		scope = m.resolveOpeningScope({
			organizations: phase.organizations,
			stored,
			session: sessionScope,
			chosen: false,
			current: scope,
			snapshotRows: phase.snapshotRows,
		});
		painted.push(scope);
		if (
			m.shouldRecordSessionScope({
				organizationCount,
				membershipsFailed: phase.memberships === "failed",
				chosen: false,
			})
		)
			m.writeSessionScope(session, "acct-1", scope);
	}
	return { painted, session: m.readSessionScope(session, "acct-1") };
}

test("cold launch, hub tenants before memberships: never paints or records yesterday's pick (M1, m2)", () => {
	const snapshotRows = [
		{ tenant_id: "tnt_minerva" },
		{ tenant_id: "tnt_acme" },
	];
	const run = coldLaunch({
		stored: "tnt_gone",
		phases: [
			// before the status gate: only the watcher's two-tenant snapshot
			{ organizations: [], snapshotRows, memberships: "loading" },
			// status answered with hub tenants; memberships still in flight
			{ organizations: [minerva, acme], snapshotRows, memberships: "loading" },
			// memberships answered: Minerva is home
			{
				organizations: [knownTeam, knownHome],
				snapshotRows,
				memberships: "ok",
			},
		],
	});
	assert.deepEqual(run.painted, ["held", "held", "tnt_minerva"]);
	assert.equal(
		run.session,
		"tnt_minerva",
		"only the decided scope is recorded",
	);
});

test("memberships fail: fall back now, record nothing, and let the default win later (M1)", () => {
	const session = fakeStorage();
	const failed = {
		organizationCount: 2,
		membershipsFailed: true,
		chosen: false,
	};
	assert.equal(m.shouldRecordSessionScope(failed), false);
	assert.equal(
		m.shouldRecordSessionScope({ ...failed, chosen: true }),
		true,
		"a scope the reader picked is theirs, memberships or not",
	);
	assert.equal(
		m.shouldRecordSessionScope({ ...failed, organizationCount: 1 }),
		true,
	);
	const run = coldLaunch({
		stored: "tnt_gone",
		phases: [
			{ organizations: [minerva, acme], memberships: "loading" },
			{ organizations: [minerva, acme], memberships: "failed" },
		],
	});
	assert.deepEqual(run.painted, ["held", ALL], "the fallback still opens");
	assert.equal(run.session, undefined, "and is not this session's scope");
	// A later visit (or a retry that answers) in the same app session.
	assert.equal(
		m.resolveOpeningScope({
			organizations: [knownTeam, knownHome],
			stored: "tnt_gone",
			session: m.readSessionScope(session, "acct-1"),
			chosen: false,
			current: "tnt_acme",
		}),
		"tnt_minerva",
	);
});

test("one org: no hold, the snapshot paints at once (tb-instant-open kept)", () => {
	const run = coldLaunch({
		stored: "tnt_acme",
		phases: [
			{
				organizations: [],
				snapshotRows: [{ tenant_id: "tnt_acme" }],
				memberships: "loading",
			},
		],
	});
	assert.deepEqual(run.painted, ["tnt_acme"]);
});

/* --------------------------------------------------------- session storage */

function fakeStorage(initial) {
	const map = new Map(
		initial === undefined
			? []
			: [[m.SESSION_SCOPE_KEY, JSON.stringify(initial)]],
	);
	return {
		map,
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => void map.set(key, String(value)),
	};
}

test("the session scope is per account, on its own key, and tolerant of junk", () => {
	assert.notEqual(m.SESSION_SCOPE_KEY, m.SCOPE_PREFERENCE_KEY);
	const storage = fakeStorage({ "acct-2": "tnt_2" });
	m.writeSessionScope(storage, "acct-1", "tnt_1");
	m.writeSessionScope(storage, "acct-3", ALL);
	assert.equal(m.readSessionScope(storage, "acct-1"), "tnt_1");
	assert.equal(m.readSessionScope(storage, "acct-2"), "tnt_2");
	assert.equal(m.readSessionScope(storage, "acct-3"), ALL);
	assert.equal(storage.map.has(m.SCOPE_PREFERENCE_KEY), false);
	const junk = {
		getItem: () => "{not json",
		setItem: () => {
			throw new Error("quota");
		},
	};
	assert.equal(m.readSessionScope(junk, "acct-1"), undefined);
	assert.doesNotThrow(() => m.writeSessionScope(junk, "acct-1", "tnt_1"));
});

// The held page paints its gate state, never the seed (review M1, QA Q1).
const HELD_GATE =
	/gatePending=\{\s*\(gatePending && !cachedPaint\) \|\|\s*openingHeld \|\|/;
test("the page feeds the session scope and authoritative organizations to both opening reads", async () => {
	const page = await readFile(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	const calls = page.split("resolveOpeningScope({").slice(1);
	assert.equal(calls.length, 2, "the settle check and the adoption effect");
	for (const call of calls) {
		const args = call.slice(0, call.indexOf("})"));
		assert.ok(args.includes("session: sessionScope"));
		assert.ok(args.includes("organizations,"));
	}
	assert.ok(!page.includes("membership.is_home"));
	assert.ok(page.includes("writeSessionScope(storage, accountId, scope)"));
	// Review M1/m2: both opening reads are held together, the held page paints
	// its gate loading state (never the seed), and the write waits on both
	// the decision and `shouldRecordSessionScope`.
	for (const call of calls) {
		const args = call.slice(0, call.indexOf("})"));
		assert.ok(args.includes("defaultPending: openingHeld"));
	}
	assert.ok(
		page.includes(
			"const scopeDecided = scopeSettled && !organizationsPending && !openingHeld;",
		),
	);
	assert.match(page, HELD_GATE);
	// QA round 1, Q1/Q2: the opening is corrected during render (never by a
	// post-paint effect), and no cursor is advanced before the scope is decided.
	assert.ok(page.includes("if (openingMoving) setScope(openingScope);"));
	assert.ok(page.includes("if (!scopeDecided) return;"));
	assert.ok(
		page.includes(
			"if (!scopeDecided || !recordSessionScope || !accountId) return;",
		),
	);
});
