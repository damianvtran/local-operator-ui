import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge in the command palette (operator, 2026-11-04: "make team bridge
 * and the various channels, groups, DMs, etc available through the command
 * palette/search function").
 *
 * THREE LAYERS, ALL THROUGH THE SHIPPED MODULES:
 *  - the SOURCE MAPPING (`palette-team-bridge.ts`): which rows the rail's data
 *    becomes, what each is called, and the address each opens;
 *  - the RANKING (`palette-search.ts`): "team bridge" finds Team Bridge rather
 *    than the agent whose tags spelled "bridge" loosely, exact and prefix names
 *    lead, and the `bridge`/`tb` scope words narrow to the group;
 *  - the HOOK (`use-palette-team-bridge.ts`), mounted in jsdom against a stub
 *    transport: the capability gate, the fail-closed paths, and that typing
 *    costs no request.
 * Nothing here reaches a daemon; the rendered rows are the Storybook story's.
 */

const scratch = mkdtempSync(join(tmpdir(), "palette-team-bridge-"));
const apiFixturePath = join(scratch, "team-bridge-api-fixture.mjs");
const membershipsFixturePath = join(scratch, "memberships-fixture.mjs");
const bundlePath = new URL(
	`./_palette-team-bridge-${process.pid}.mjs`,
	import.meta.url,
);
after(() => {
	try {
		unlinkSync(bundlePath);
	} catch {
		/* already gone */
	}
});

/* The transport: mutable answers, and a call log the gate assertions read. */
writeFileSync(
	apiFixturePath,
	`
export const fixture = {
	status: null,
	conversations: { conversations: [] },
	directories: {},
	failList: false,
	calls: { status: 0, conversations: 0, directory: [] },
};
export const requireBridgeWriteAccount = (accountId) => accountId;
export const TeamBridgeApi = {
	async status() {
		fixture.calls.status += 1;
		return fixture.status;
	},
	async listConversations() {
		fixture.calls.conversations += 1;
		if (fixture.failList) throw new Error("bridge list refused");
		return fixture.conversations;
	},
	async directory(tenantId) {
		fixture.calls.directory.push(tenantId);
		return { members: fixture.directories[tenantId] ?? [] };
	},
	async unread() {
		return { total: 0, organizations: [] };
	},
};
`,
);
writeFileSync(
	membershipsFixturePath,
	"export function useMembershipsQuery() { return { memberships: [] }; }",
);

const bundled = await build({
	stdin: {
		contents: `
			export { paletteTeamBridgeItems } from "./src/renderer/src/features/command-palette/palette-team-bridge";
			export { usePaletteTeamBridge, teamBridgeDestinationItem } from "./src/renderer/src/features/command-palette/use-palette-team-bridge";
			export { searchPalette, parsePaletteQuery, WORD_ONLY_SCOPES, SCOPE_LEGEND } from "./src/renderer/src/features/command-palette/palette-search";
			export { teamBridgeTargetFromSearch, teamBridgeTargetPath } from "./src/renderer/src/features/team-bridge/team-bridge-deep-link";
			export { teamBridgeOpenPath } from "./src/shared/team-bridge-notify";
			export { fixture } from "@shared/api/local-operator/team-bridge-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	write: false,
	alias: {
		"@shared/api/local-operator/team-bridge-api": apiFixturePath,
		"@features/agent-hub/hooks/use-memberships-query": membershipsFixturePath,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
writeFileSync(bundlePath, bundled.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath.pathname).href);
const { fixture } = api;

/* ------------------------------------------------------------------ *
 * Fixtures: two organizations, one rail each
 * ------------------------------------------------------------------ */

const SELF = "acct_self";
const participant = (accountId, kind, label) => ({
	account_id: accountId,
	kind,
	display_label: label,
	role: "member",
	state: "active",
});
const conversation = (overrides) => ({
	tenant_id: "tnt_minerva",
	kind: "channel",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: SELF,
	last_message_at: "2026-11-04T10:00:00Z",
	latest_seq: 3,
	last_read_seq: 3,
	unread_count: 0,
	muted: false,
	notify: "all",
	members: [participant(SELF, "human", "Damian Tran")],
	...overrides,
});
const person = (accountId, label, extra = {}) => ({
	account_id: accountId,
	display_label: label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...extra,
});

const ORGS = [
	{ tenantId: "tnt_minerva", name: "Minerva", role: "member", unread: 0 },
	{
		tenantId: "tnt_pergamon",
		name: "Pergamon Labs",
		role: "member",
		unread: 0,
	},
];
const CONVERSATIONS = [
	conversation({ id: "c_general", name: "general", builtin: "general" }),
	conversation({
		id: "c_retention",
		name: "retention-analysis",
		unread_count: 4,
		topic: "audit log retention",
	}),
	conversation({
		id: "c_muted",
		name: "random",
		unread_count: 9,
		notify: "mute",
	}),
	conversation({ id: "c_group", kind: "group", name: "Launch crew" }),
	conversation({
		id: "c_dm_ola",
		kind: "dm",
		unread_count: 2,
		members: [
			participant(SELF, "human", "Damian Tran"),
			participant("acct_ola", "human", "Ola Fagbemi"),
		],
	}),
	conversation({
		id: "c_dm_gone",
		kind: "dm",
		members: [
			participant(SELF, "human", "Damian Tran"),
			participant("acct_left", "human", "Sam Left"),
		],
	}),
	conversation({ id: "c_archived", name: "old-launch", status: "archived" }),
	conversation({
		id: "c_pergamon_general",
		tenant_id: "tnt_pergamon",
		name: "general",
		builtin: "general",
	}),
	conversation({
		id: "c_orphan_org",
		tenant_id: "tnt_unknown",
		name: "secret",
	}),
];
const DIRECTORIES = {
	tnt_minerva: [
		person(SELF, "Damian Tran"),
		person("acct_ola", "Ola Fagbemi", {
			agent: { endpoint_id: "ep_ola", name: "Aida", state: "active" },
		}),
		person("acct_ben", "Ben Tran", {
			agent: { endpoint_id: "ep_ben", name: "", state: "active" },
		}),
		person("acct_off", "Off Person", {
			bridge_enabled: false,
			bridge_state: "none",
		}),
	],
};
const CHIEF_LABELS = {
	named: (agent, owner) => `${agent} (${owner})`,
	unnamed: (owner) => `${owner}'s chief of staff`,
};
const rows = (overrides = {}) =>
	api.paletteTeamBridgeItems({
		conversations: CONVERSATIONS,
		directories: DIRECTORIES,
		organizations: ORGS,
		selfAccountId: SELF,
		chiefLabels: CHIEF_LABELS,
		...overrides,
	});
const byId = (items) => new Map(items.map((item) => [item.id, item]));

/* ------------------------------------------------------------------ *
 * Source mapping
 * ------------------------------------------------------------------ */

test("the rail's rows become palette rows, in the rail's order, per organization", () => {
	const items = rows();
	assert.deepEqual(
		items.map((item) => item.name),
		[
			// Minerva: built-in channel first, then channels, then groups (railSections)
			"general",
			"retention-analysis",
			"random",
			"Launch crew",
			// People: self and the bridge-off person with no DM are inert, so absent
			"Ola Fagbemi",
			"Ben Tran",
			// Chiefs of staff, owner-disambiguated (#1643)
			"Aida (Ola Fagbemi)",
			"Ben Tran's chief of staff",
			// The DM no person row paints (a member who left)
			"Sam Left",
			// Pergamon Labs
			"general",
		],
	);
	assert.ok(
		items.every(
			(item) => item.group === "teamBridge" && item.kind === "bridge",
		),
	);
});

test("archived conversations and organizations the hub does not list are not offered", () => {
	const ids = (items) => items.map((item) => item.id);
	const all = ids(rows());
	assert.ok(!all.some((id) => id.includes("c_archived")));
	assert.ok(!all.some((id) => id.includes("c_orphan_org")));
	// No organization list yet: nothing can be placed, so nothing is offered.
	assert.deepEqual(rows({ organizations: [] }), []);
});

test("each row opens its own rail target through the deep-link builder", () => {
	const map = byId(rows());
	assert.equal(
		map.get("bridge-conversation-tnt_minerva-c_retention").target.path,
		"/team-bridge?tenant=tnt_minerva&conversation=c_retention",
	);
	// A person opens their ROW (DM or draft), never a create-on-click.
	assert.equal(
		map.get("bridge-person-tnt_minerva-acct_ola").target.path,
		"/team-bridge?tenant=tnt_minerva&person=acct_ola",
	);
	assert.equal(
		map.get("bridge-chief-tnt_minerva-acct_ola").target.path,
		"/team-bridge?tenant=tnt_minerva&chief=acct_ola",
	);
	for (const item of rows()) assert.equal(item.target.type, "bridge");
});

test("a conversation link is byte-identical to a notification click's", () => {
	const owner = { accountId: SELF };
	assert.equal(
		api.teamBridgeTargetPath({
			tenantId: "tnt_minerva",
			target: { type: "conversation", id: "c_general" },
		}),
		api.teamBridgeOpenPath({
			owner,
			tenantId: "tnt_minerva",
			conversationId: "c_general",
		}),
	);
});

test("the deep-link parser round-trips and refuses ambiguous addresses", () => {
	for (const target of [
		{ type: "conversation", id: "c_1" },
		{ type: "person", accountId: "acct_1" },
		{ type: "chief", accountId: "acct_1" },
	]) {
		const path = api.teamBridgeTargetPath({ tenantId: "tnt_1", target });
		const params = new URLSearchParams(path.split("?")[1]);
		assert.deepEqual(api.teamBridgeTargetFromSearch(params), {
			tenantId: "tnt_1",
			target,
		});
	}
	assert.equal(
		api.teamBridgeTargetFromSearch(new URLSearchParams("person=acct_1")),
		null,
		"a row without its organization names nothing",
	);
	assert.equal(
		api.teamBridgeTargetFromSearch(
			new URLSearchParams("tenant=t&conversation=c&person=p"),
		),
		null,
		"two row parameters name no single row",
	);
});

test("unread is the rail's: unmuted counts only, the shared view outranking the list row", () => {
	const map = byId(rows());
	assert.equal(
		map.get("bridge-conversation-tnt_minerva-c_retention").attention,
		4,
	);
	assert.equal(
		map.get("bridge-conversation-tnt_minerva-c_muted").attention,
		undefined,
		"a muted count is a total, not an attention mark",
	);
	// A person row carries their DM's count.
	assert.equal(map.get("bridge-person-tnt_minerva-acct_ola").attention, 2);
	const patched = byId(
		rows({ unreadOf: (_, id) => (id === "c_retention" ? 0 : undefined) }),
	);
	assert.equal(
		patched.get("bridge-conversation-tnt_minerva-c_retention").attention,
		undefined,
		"a read cursor the shared view already applied clears the mark",
	);
});

test("the organization is secondary text only when the reader is in more than one", () => {
	const two = byId(rows());
	assert.equal(
		two.get("bridge-conversation-tnt_pergamon-c_pergamon_general").hint,
		"Channel · Pergamon Labs",
	);
	const one = byId(rows({ organizations: [ORGS[0]] }));
	assert.equal(
		one.get("bridge-conversation-tnt_minerva-c_general").hint,
		"Channel",
	);
	assert.equal(
		one.get("bridge-person-tnt_minerva-acct_ola").hint,
		"Direct message",
	);
	assert.equal(
		one.get("bridge-chief-tnt_minerva-acct_ola").hint,
		"Chief of staff",
	);
});

test("a roster that has not loaded still leaves its DMs reachable by their own name", () => {
	const items = rows({ directories: {} });
	const names = items.map((item) => item.name);
	assert.ok(
		names.includes("Ola Fagbemi"),
		"the DM row stands in for the person",
	);
	assert.ok(!items.some((item) => item.id.startsWith("bridge-person-")));
});

/* ------------------------------------------------------------------ *
 * Ranking and scope
 * ------------------------------------------------------------------ */

/*
 * The roster row the operator's screenshot showed: an agent whose TAGS hold
 * "role", "tools:read,glob,grep,list_variables,read_variable,bash,todo" and
 * "delegate:yes" (the manager agent's real tag set).
 */
const MANAGER = {
	id: "agent-chat-manager",
	kind: "agent",
	group: "agents",
	name: "manager",
	hint: "Agent chat",
	icon: "agents",
	keywords: [
		"role",
		"tools:read,glob,grep,list_variables,read_variable,bash,todo",
		"delegate:yes",
	],
	target: { type: "draft", kind: "agent", name: "manager" },
};
const pool = () => [api.teamBridgeDestinationItem(7), MANAGER, ...rows()];
const top = (raw) => {
	const outcome = api.searchPalette({ items: pool(), raw });
	return outcome.sections.flatMap((section) =>
		section.items.map((match) => match.item.name),
	);
};

test('"team bridge" is a product name, not the agent scope plus "bridge" (the reported bug)', () => {
	assert.deepEqual(api.parsePaletteQuery("team bridge"), {
		scope: null,
		terms: "team bridge",
	});
	assert.deepEqual(api.parsePaletteQuery("Team Bridge general"), {
		scope: null,
		terms: "Team Bridge general",
	});
	// The scope word still works for everything else (#849).
	assert.equal(api.parsePaletteQuery("team delivery").scope, "agent");
	assert.equal(top("team bridge")[0], "Team Bridge");
});

test("a match must live inside ONE keyword: manager's tags no longer spell bridge", () => {
	const outcome = api.searchPalette({ items: [MANAGER], raw: "bridge" });
	assert.equal(outcome.total, 0);
	// Its own words still find it.
	assert.equal(
		api.searchPalette({ items: [MANAGER], raw: "delegate" }).total,
		1,
	);
});

test('"bridge" and "tb" lead with the destination', () => {
	assert.equal(top("bridge")[0], "Team Bridge");
	assert.equal(top("tb")[0], "Team Bridge");
});

test("exact and prefix name matches lead the Team Bridge section", () => {
	assert.equal(top("retention")[0], "retention-analysis");
	assert.equal(top("ola")[0], "Ola Fagbemi");
	assert.ok(
		top("ola").includes("Aida (Ola Fagbemi)"),
		"the owner's chief, by owner name",
	);
	assert.equal(top("aida")[0], "Aida (Ola Fagbemi)");
	assert.equal(top("launch")[0], "Launch crew");
});

test("the bridge scope words narrow to the Team Bridge group alone", () => {
	assert.deepEqual(api.parsePaletteQuery("tb ola"), {
		scope: "bridge",
		terms: "ola",
	});
	assert.equal(api.parsePaletteQuery("bridge general").scope, "bridge");
	const outcome = api.searchPalette({ items: pool(), raw: "tb general" });
	assert.deepEqual(
		outcome.sections.map((section) => section.group),
		["teamBridge"],
	);
	// A bare word is still a search for it (SCOPE_WORDS' "only when something follows").
	assert.equal(api.parsePaletteQuery("bridge").scope, null);
	// Word-only: the footer legend (the glyph table) is unchanged.
	assert.ok(!api.SCOPE_LEGEND.some((entry) => entry.scope === "bridge"));
	assert.equal(
		api.WORD_ONLY_SCOPES.find((entry) => entry.scope === "bridge").label,
		"Team Bridge",
	);
});

test("bridge rows stay out of the other scopes", () => {
	for (const raw of ["#general", "@general", ">general", ",general"]) {
		const outcome = api.searchPalette({ items: pool(), raw });
		assert.ok(
			!outcome.sections.some((section) => section.group === "teamBridge"),
			`${raw} must not answer with bridge rows`,
		);
	}
});

/* ------------------------------------------------------------------ *
 * The hook: capability gate, fail-closed, no per-keystroke fetch
 * ------------------------------------------------------------------ */

const READY_STATUS = {
	account_id: SELF,
	state: "ready",
	read_only: false,
	local: { enabled: true },
	status: {
		tenants: [{ tenant_id: "tnt_minerva", tenant_name: "Minerva" }],
	},
};

/*
 * Wait in REAL time, not in microtask ticks. The reads go through the auth fence
 * (`readForBridgeAccount`) and react-query's scheduler, so how many ticks a
 * read needs before its request is issued depends on the host: CI's shard
 * measured zero status calls after ten ticks where a local run had one. A
 * read-count assertion must therefore wait for the client to go quiet, and a
 * "made no request" assertion must have given the request a real window to
 * appear in. Quiet = nothing fetching across three consecutive 20 ms looks,
 * after at least 100 ms; bounded at 5 s so a stuck read fails rather than hangs.
 */
const settle = async (client) => {
	const started = Date.now();
	let quiet = 0;
	while (Date.now() - started < 5_000) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
		quiet = client.isFetching() === 0 ? quiet + 1 : 0;
		if (quiet >= 3 && Date.now() - started >= 100) return;
	}
	throw new Error("the palette's Team Bridge reads never settled");
};

const mount = async ({
	features = {
		team_bridge_conversations: 1,
		team_bridge_conversation_owner_guard: 1,
	},
	signedIn = true,
	status = READY_STATUS,
	failList = false,
	open = true,
} = {}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = { window: globalThis.window, document: globalThis.document };
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	fixture.status = status;
	fixture.failList = failList;
	fixture.conversations = { conversations: CONVERSATIONS };
	fixture.directories = DIRECTORIES;
	fixture.calls = { status: 0, conversations: 0, directory: [] };
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 1_000 } },
	});
	if (signedIn)
		client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
	client.setQueryDefaults(["desktop", "capabilities"], {
		staleTime: Number.POSITIVE_INFINITY,
	});
	client.setQueryData(["desktop", "capabilities"], {
		desktop_available: true,
		features,
	});
	const results = [];
	let props = { open, wantsRows: true, destinationOrder: 7 };
	const Probe = () => {
		results.push(api.usePaletteTeamBridge(props));
		return null;
	};
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	const render = () =>
		act(async () =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(Probe),
				),
			),
		);
	await render();
	await settle(client);
	return {
		results,
		latest: () => results[results.length - 1],
		rerender: async (next) => {
			props = { ...props, ...next };
			await render();
			await settle(client);
		},
		teardown: async () => {
			await act(async () => root.unmount());
			client.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

test("capability off: no destination, no rows, and not one request", async () => {
	const view = await mount({ features: {} });
	try {
		assert.equal(view.latest().destination, null);
		assert.deepEqual(view.latest().rows, []);
		assert.deepEqual(fixture.calls, {
			status: 0,
			conversations: 0,
			directory: [],
		});
	} finally {
		await view.teardown();
	}
});

test("route on but the owner guard absent: the destination only, no reads", async () => {
	const view = await mount({ features: { team_bridge_conversations: 1 } });
	try {
		assert.equal(view.latest().destination?.name, "Team Bridge");
		assert.deepEqual(view.latest().rows, []);
		assert.equal(fixture.calls.conversations, 0);
	} finally {
		await view.teardown();
	}
});

test("signed out: the destination, no conversation reads", async () => {
	const view = await mount({ signedIn: false });
	try {
		assert.ok(view.latest().destination);
		assert.deepEqual(view.latest().rows, []);
		assert.equal(fixture.calls.conversations, 0);
	} finally {
		await view.teardown();
	}
});

test("a status the page would gate (plan required) offers no rows", async () => {
	const view = await mount({
		status: { ...READY_STATUS, surface_state: "A" },
	});
	try {
		assert.deepEqual(view.latest().rows, []);
		assert.equal(fixture.calls.conversations, 0);
	} finally {
		await view.teardown();
	}
});

test("a failed list read fails closed and quietly: no rows, no throw", async () => {
	const view = await mount({ failList: true });
	try {
		assert.equal(fixture.calls.conversations, 1);
		assert.deepEqual(view.latest().rows, []);
		assert.ok(
			view.latest().destination,
			"the destination still opens the page",
		);
	} finally {
		await view.teardown();
	}
});

test("a closed palette makes no reads", async () => {
	const view = await mount({ open: false });
	try {
		assert.equal(fixture.calls.status, 0);
		assert.equal(fixture.calls.conversations, 0);
	} finally {
		await view.teardown();
	}
});

test("opening prefetches once; typing re-renders from the cache with no new request", async () => {
	const view = await mount();
	try {
		assert.equal(fixture.calls.status, 1);
		assert.equal(fixture.calls.conversations, 1);
		assert.deepEqual(fixture.calls.directory, ["tnt_minerva"]);
		assert.ok(
			view.latest().rows.some((row) => row.name === "retention-analysis"),
		);
		// Keystrokes change only the text the rows are matched against.
		for (let i = 0; i < 5; i += 1) await view.rerender({ destinationOrder: 7 });
		assert.equal(fixture.calls.conversations, 1);
		assert.equal(fixture.calls.status, 1);
		assert.deepEqual(fixture.calls.directory, ["tnt_minerva"]);
		// A scope that excludes the group draws no rows but keeps the cache warm.
		await view.rerender({ wantsRows: false });
		assert.deepEqual(view.latest().rows, []);
		assert.equal(fixture.calls.conversations, 1);
	} finally {
		await view.teardown();
	}
});
