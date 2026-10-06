/**
 * The org-sharing desktop slice (local-operator-ui PR H, design §8.4/§4.7).
 *
 *     node --test scripts/agent-hub-org-sharing.test.mjs
 *
 * Five claims, each with the instrument that can falsify it.
 *
 * 1. THE THREE-WAY CONTRACT HOLDS. The four organization operations are a
 *    contract between three lists in two repositories: the renderer's
 *    `RadientOperation` union, the `radient.request` control enum in
 *    `desktop-contract.ts` (what actually validates the request the renderer
 *    sends), and the local server's `RadientRequest` Literal plus its
 *    `endpoint()` mapping in `local-operator`. An op present in the renderer and
 *    absent from the contract is a request that never leaves the renderer; one
 *    present in both and absent upstream is a 422. This file asserts the two
 *    lists it can see, and pins `team_id` as the field `org_team.get` needs.
 *
 * 2. THE TARGET RIDES THE QUERY, AND ONLY FOR AN ORG. `desktopEndpoint` is the
 *    one place a request's path is composed, so it is the one place a target can
 *    be lost: the org pair must appear on the publish and republish routes, and
 *    NO query at all must appear when there is no target, because the local
 *    route refuses a half-specified one rather than falling back.
 *
 * 3. THE ENTITLEMENT RULE IS THE PLAN, FOR EVERY RANK. `orgAccess` is asserted
 *    against the matrix §3.2/§3.3 describe — including the two rows a reader is
 *    most likely to get wrong: a `past_due` plan ENTITLES (full access during
 *    dunning, §3.1), and the OWNER EXEMPTION IS NOT HERE. It belongs to the
 *    publish path; the READ gate the merged server answers does not carry it
 *    (measured: a plan-lapsed org read is refused `team_plan_required` for its
 *    owner, QA round 1 QE-5), so a selector that offered an owner their plan-less
 *    tenant would offer a scope whose first read is a refusal. This is the
 *    manager's ruling on agent review round 1's M1, and it is what keeps a
 *    plan-less PERSONAL workspace out of both org surfaces: a home tenant is an
 *    organization like any other, so it is offered on plan terms, not on role.
 *
 * 4. THE ORG LIST IS A DIFFERENT READ, NOT A FILTER. Mounted against a real
 *    QueryClient, the shipped list hook registers the ORG key when it is given a
 *    tenant and the PUBLIC key when it is not, and the request it issues is
 *    `org_agents.list` carrying that tenant. Two scopes sharing one cache entry
 *    would let a page that flipped its scope render the other scope's records
 *    under the new scope's label.
 *
 * 5. A REFUSAL IS NOT AN OUTAGE, AND THE PROSE SAYS WHICH. The three frozen org
 *    codes classify as a state of the surface rather than a failure, and each has
 *    a treatment — the plan one with a retry, the membership ones with none,
 *    because the remedy is somebody else's.
 *
 * 6. THE WIRE SHAPES ARE PINNED, NOT REMEMBERED. Two of them cost a round:
 *    `invalid_name` is a BOOLEAN FLAG (not a name — reading it with `.trim()`
 *    threw on every successful pull and dropped the toast, QA round 1 Q-1), and
 *    a half-specified publication target must be REFUSED rather than composed as
 *    a public publication (security round 1, S-1). Both are asserted against the
 *    shipped functions.
 *
 * 7. THE ORG SURFACE IS GATED ON THE BACKEND'S OWN CAPABILITY. A backend that
 *    predates the four operations answers a masked 422, so the reads are not
 *    attempted and the sentence names the update rather than a retry (M2).
 *
 * WHAT IT DOES NOT PROVE: that the local server answers any of this (its own
 * suite and PR G's carry that), or that any of it renders (the frames do). The
 * mount below is jsdom, not a browser: it proves which key a query registers and
 * which operation it issues, and nothing about pixels.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const read = (path) => readFileSync(path, "utf8");

const ORG_OPS = [
	"memberships.list",
	"org_agents.list",
	"org_team.get",
	"org_teams.list",
];
/** The op names as `proxy.ts` spells them in its union, still quoted. */
const quoted = (op) => new RegExp(`"${op.replace(".", "\\.")}"`);
const FOCUS_REFETCH_IS_OFF = /refetchOnWindowFocus: false/;

/* ------------------------------------------------------------- 1. contract */

test("every organization operation is named in both closed vocabularies", () => {
	const proxy = read("src/renderer/src/shared/api/radient/proxy.ts");
	const contract = read("src/shared/desktop-contract.ts");
	for (const op of ORG_OPS) {
		assert.match(
			proxy,
			quoted(op),
			`${op} is missing from the renderer's RadientOperation union`,
		);
		assert.match(
			contract,
			quoted(op),
			`${op} is missing from the radient.request control enum, so the schema refuses it before a socket opens`,
		);
	}
	// `org_team.get` addresses a published document, and the contract has to
	// carry the field the operation names it with.
	assert.match(contract, /team_id: id\.optional\(\)/);
	assert.match(proxy, /teamId\?: string/);
	assert.match(
		proxy,
		/\.\.\.\(args\.teamId \? \{ team_id: args\.teamId \} : \{\}\),?/,
	);
});

test("the publish and team ops are in the desktop request union", () => {
	const contract = read("src/shared/desktop-contract.ts");
	assert.match(contract, /op: z\.literal\("team\.pull"\)/);
	assert.match(
		contract,
		/op: z\.literal\("agent\.publish"\)[\s\S]{0,2500}visibility/,
	);
	assert.match(
		contract,
		/op: z\.literal\("agent\.republish"\)[\s\S]{0,2500}tenantId/,
	);
});

/* ------------------------------------------------------- 2. the target path */

const contractBundle = await build({
	stdin: {
		contents: `
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".css": "empty" },
});
const contractModule = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);
const { desktopEndpoint, desktopRequestSchema } = contractModule;

test("an org target rides the publish query; no target sends no query", () => {
	const bare = desktopEndpoint({ op: "agent.publish", agentId: "agent-1" });
	assert.equal(bare.path, "/v1/agents/agent-1/publish");
	assert.equal(bare.method, "POST");

	const org = desktopEndpoint({
		op: "agent.publish",
		agentId: "agent-1",
		visibility: "org",
		tenantId: "org-9",
	});
	assert.equal(
		org.path,
		"/v1/agents/agent-1/publish?visibility=org&tenant_id=org-9",
	);

	const republish = desktopEndpoint({
		op: "agent.republish",
		agentId: "agent-1",
		hubAgentId: "hub-1",
		visibility: "org",
		tenantId: "org-9",
	});
	assert.equal(
		republish.path,
		"/v1/agents/agent-1/publish?visibility=org&tenant_id=org-9",
	);
	assert.equal(republish.method, "PUT");
	assert.equal(republish.body.hub_agent_id, "hub-1");
});

test("the team pull names the document, and the tenant only when known", () => {
	const bare = desktopEndpoint({ op: "team.pull", teamId: "team-7" });
	assert.equal(bare.path, "/v1/teams/pull/team-7");
	assert.equal(bare.method, "GET");
	const withTenant = desktopEndpoint({
		op: "team.pull",
		teamId: "team-7",
		tenantId: "org-9",
	});
	assert.equal(withTenant.path, "/v1/teams/pull/team-7?tenant_id=org-9");
});

/* --------------------------------------------------- 3. the entitlement rule */

const accessBundle = await build({
	stdin: {
		contents: `export { orgAccess, usableOrgs, planBlockedOrgs, orgRefusalFromError } from "./src/renderer/src/features/agent-hub/org-access";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	loader: { ".css": "empty" },
	/*
	 * The module imports the desktop control error type for its refusal
	 * classifier, and the renderer's `@shared` alias is what resolves it — the
	 * same aliasing the hub's own test file carries, and the reason a bare
	 * resolveDir is not enough here.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const accessModule = await import(
	`data:text/javascript;base64,${Buffer.from(accessBundle.outputFiles[0].text).toString("base64")}`
);
const { orgAccess, usableOrgs, planBlockedOrgs } = accessModule;

const membership = (over = {}) => ({
	tenant_id: "org-1",
	tenant_name: "Minerva",
	role: "member",
	status: "active",
	is_home: false,
	plan: { status: "active", seats: 3 },
	...over,
});

test("the membership matrix matches the server's own rule", () => {
	assert.equal(orgAccess(membership()), "available");
	// `past_due` entitles: §3.1 gives it full access during dunning.
	assert.equal(
		orgAccess(membership({ plan: { status: "past_due", seats: 3 } })),
		"available",
	);
	/*
	 * THE RANK DOES NOT ENTITLE (M1). The owner exemption lives on the publish
	 * path, and the read gate the surfaces lead to does not carry it — so an owner
	 * of a plan-less tenant is the picker's disabled row like anybody else, and
	 * their personal workspace stays out of the scope selector.
	 */
	assert.equal(
		orgAccess(
			membership({ role: "owner", plan: { status: "none", seats: null } }),
		),
		"plan_inactive",
	);
	assert.equal(
		orgAccess(
			membership({ role: "owner", plan: { status: "canceled", seats: 1 } }),
		),
		"plan_inactive",
	);
	// A member whose plan lapsed is the picker's disabled row.
	assert.equal(
		orgAccess(membership({ plan: { status: "none", seats: null } })),
		"plan_inactive",
	);
	assert.equal(
		orgAccess(membership({ plan: { status: "canceled", seats: 1 } })),
		"plan_inactive",
	);
	// A membership that is not active grants nothing, whatever the plan says.
	assert.equal(orgAccess(membership({ status: "pending" })), "no_access");
	assert.equal(orgAccess(membership({ status: "disabled" })), "no_access");
});

/*
 * THE TWO PINS THE MANAGER ASKED FOR, in the shape every user's account actually
 * has: a HOME tenant (the personal workspace, `is_home: true`) that may or may
 * not carry a Team plan. Nothing reads `is_home`; the plan decides.
 */
test("a plan-active home tenant is offered, and a plan-less one is not", () => {
	const homeWithPlan = membership({
		tenant_id: "home",
		tenant_name: "Minerva",
		role: "owner",
		is_home: true,
		plan: { status: "active", seats: 8 },
	});
	const homeWithoutPlan = membership({
		tenant_id: "personal",
		tenant_name: "Dana's workspace",
		role: "owner",
		is_home: true,
		plan: { status: "none", seats: null },
	});
	const shared = membership({ tenant_id: "shared" });

	assert.deepEqual(
		usableOrgs([homeWithPlan, homeWithoutPlan, shared]).map(
			(row) => row.tenant_id,
		),
		["home", "shared"],
		"a home tenant is an organization: the PLAN is what offers it",
	);
	assert.deepEqual(
		planBlockedOrgs([homeWithPlan, homeWithoutPlan, shared]).map(
			(row) => row.tenant_id,
		),
		["personal"],
		"a plan-less personal workspace is offered DISABLED, never as a target",
	);

	const rows = [
		membership({ tenant_id: "a" }),
		membership({ tenant_id: "b", plan: { status: "none", seats: null } }),
		membership({ tenant_id: "c", status: "disabled" }),
		membership({
			tenant_id: "d",
			role: "owner",
			plan: { status: "none", seats: null },
		}),
	];
	assert.deepEqual(
		usableOrgs(rows).map((row) => row.tenant_id),
		["a"],
	);
	assert.deepEqual(
		planBlockedOrgs(rows).map((row) => row.tenant_id),
		["b", "d"],
		"only a plan-blocked org is offered disabled; a disabled membership is not offered at all",
	);
});

/* ------------------------------------------- 4. the org list is its own read */

const mountBundle = await build({
	stdin: {
		contents: `
			export { agentListScopeOfKey, orgAgentKeys, publicAgentKeys, usePublicAgentsQuery } from "./src/renderer/src/features/agent-hub/hooks/use-public-agents-query";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const mountPath = new URL(`./_org-sharing-${process.pid}.mjs`, import.meta.url);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

const mountListHook = async (filters) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = { window: globalThis.window, document: globalThis.document };
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const requests = [];
	dom.window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return {
					status: 200,
					body: {
						result: {
							data: {
								msg: "Agents listed successfully",
								result: {
									page: 1,
									per_page: 12,
									total_pages: 1,
									total_records: 0,
									records: [],
								},
							},
						},
					},
				};
			},
		},
	};

	const { orgAgentKeys, publicAgentKeys, usePublicAgentsQuery } = await import(
		mountPath.href
	);
	const { QueryClient, QueryClientProvider } = await import(mountPath.href);
	const { createRoot } = await import("react-dom/client");

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const Probe = () => {
		usePublicAgentsQuery(filters);
		return null;
	};
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(Probe),
			),
		);
	});
	return {
		orgAgentKeys,
		publicAgentKeys,
		queryClient,
		requests,
		teardown: async () => {
			await act(async () => root.unmount());
			queryClient.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const FILTERS = {
	page: 1,
	perPage: 12,
	categories: undefined,
	name: undefined,
	description: undefined,
	sort: "download_count",
	order: "desc",
};

test("the list hook reads the org route and keys it separately when given a tenant", async () => {
	const mounted = await mountListHook({ ...FILTERS, tenantId: "org-9" });
	try {
		const registered = mounted.queryClient.getQueryCache().getAll();
		assert.equal(registered.length, 1);
		assert.deepEqual(
			registered[0].queryKey,
			mounted.orgAgentKeys.list("org-9", FILTERS),
			"the org scope keys itself with the org builder",
		);
		assert.notDeepEqual(
			registered[0].queryKey,
			mounted.publicAgentKeys.list(FILTERS),
			"an org read must not share a cache entry with the public hub",
		);
		const operation = mounted.requests.at(-1)?.control;
		assert.equal(operation?.operation, "org_agents.list");
		assert.equal(operation?.tenant_id, "org-9");
	} finally {
		await mounted.teardown();
	}
});

test("the list hook is the public read when it is not given a tenant", async () => {
	const mounted = await mountListHook(FILTERS);
	try {
		const registered = mounted.queryClient.getQueryCache().getAll();
		assert.deepEqual(
			registered[0].queryKey,
			mounted.publicAgentKeys.list(FILTERS),
		);
		assert.equal(mounted.requests.at(-1)?.control?.operation, "agents.list");
	} finally {
		await mounted.teardown();
	}
});

test("the org list is not fetched on window focus, like the hub's", () => {
	const list = read(
		"src/renderer/src/features/agent-hub/hooks/use-public-agents-query.ts",
	);
	assert.match(list, FOCUS_REFETCH_IS_OFF);
});

/* ------------------------------------------- 5. a refusal is not an outage */

test("the frozen org codes classify as a state, and nothing else does", async () => {
	/*
	 * The classifier lives in a renderer module that imports the desktop control
	 * error TYPE, so it is read through its own bundle — one that carries the
	 * renderer's alias, the same way every other harness in this tree does.
	 */
	const classifyBundle = await build({
		stdin: {
			contents: `
				export { orgRefusalFromError } from "./src/renderer/src/features/agent-hub/org-access";
				export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		loader: { ".css": "empty" },
		alias: {
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(classifyBundle.outputFiles[0].text).toString("base64")}`
	);
	const classify = mod.orgRefusalFromError;
	const Error_ = mod.DesktopControlError;
	assert.ok(
		Error_,
		"the desktop control error must be importable for this test",
	);

	assert.equal(
		classify(new Error_("403", "x", undefined, "team_plan_required")),
		"plan",
	);
	assert.equal(
		classify(new Error_("403", "x", undefined, "not_a_member")),
		"no_access",
	);
	assert.equal(
		classify(new Error_("403", "x", undefined, "insufficient_role")),
		"no_access",
	);
	// An outage, a refused credential and a transport failure all keep the
	// surface's own failure treatment: reading any of them as "no access" would
	// render a backend that is not running as an organization that revoked access.
	assert.equal(
		classify(new Error_("502", "x", undefined, "radient_upstream_failed")),
		null,
	);
	assert.equal(
		classify(new Error_("401", "x", undefined, "radient_credential_refused")),
		null,
	);
	assert.equal(classify(new Error_("503", "x")), null);
	assert.equal(classify(null), null);
	assert.equal(classify("not_a_member"), null);
});

test("every org refusal has a treatment, and only the plan one offers a retry", async () => {
	const bundle = await build({
		stdin: {
			contents: `
				export { publicationTreatment } from "./src/renderer/src/features/agents/utils/publication-failure";
				export { publicationErrorFromBody } from "./src/renderer/src/shared/api/local-operator/publication-errors";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		loader: { ".css": "empty" },
		alias: {
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	const { publicationTreatment, publicationErrorFromBody } = mod;

	for (const [code, expected] of [
		["team_plan_required", ["retry"]],
		["not_a_member", []],
		["insufficient_role", []],
		["team_not_found", ["refresh-hub"]],
	]) {
		// The codes are now in the typed set: a coded refusal supersedes the prose.
		const error = publicationErrorFromBody(403, {
			detail: { code, message: "refused" },
		});
		assert.ok(error, `${code} must be a TYPED refusal, not prose`);
		assert.equal(error.code, code);
		const treatment = publicationTreatment(
			{ code: error.code, message: error.message, details: error.details },
			{ name: "Inbox triage", hubAgentId: null },
		);
		assert.ok(treatment.headline.length > 0, `${code} needs a headline`);
		assert.ok(treatment.body.length > 0, `${code} needs a body`);
		assert.deepEqual(
			[...treatment.actions],
			expected,
			`${code}'s next step is the one the design's remedy names`,
		);
	}

	// The rank the hub named is quoted rather than restated: this app does not
	// hold the membership matrix.
	const role = publicationErrorFromBody(403, {
		detail: {
			code: "insufficient_role",
			message: "x",
			details: { required: "admin" },
		},
	});
	const roleTreatment = publicationTreatment(
		{ code: role.code, message: role.message, details: role.details },
		{ name: "a", hubAgentId: null },
	);
	assert.match(roleTreatment.body, /admin/);
});

/* --------------------------------------------- 6. the surfaces' own wiring */

/*
 * What a frame can SHOW is a card with no heart on it; what a frame cannot show
 * is that the control is absent because the row is an org row rather than
 * because the viewer is signed out, the read failed, or a later change deleted
 * it. These anchors pin the DECISION, and the frames below show the result.
 */
test("the surfaces hide the public-only affordances for an org row", () => {
	const card = read(
		"src/renderer/src/features/agent-hub/components/agent-card.tsx",
	);
	assert.match(card, /const isOrgRow = agent\.visibility === "org"/);
	assert.match(card, /isOrgRow && <OrgOriginBadge orgName=\{orgName\} \/>/);
	assert.match(
		card,
		/\{!isOrgRow && \(\s*<>[\s\S]*?<Tooltip content=\{likeTooltip\}>/,
		"the like control is not rendered for an org row",
	);
	// The rendered page is what a frame-less check can ask, and "org" is the one
	// state that must not be readable as "signed out".
	assert.match(card, /\? "org"/);

	const details = read(
		"src/renderer/src/features/agent-hub/agent-details-page.tsx",
	);
	assert.match(
		details,
		/\{!isOrgRow && <CommentsSection agentId=\{agent\.id\} \/>\}/,
		"the comment thread is public-only and is not rendered for an org row",
	);
	assert.match(
		details,
		/\{isOwner && !isOrgRow && \(/,
		"delisting an org row goes through the org route, which this app does not expose",
	);
	assert.match(
		details,
		/agentIds: agentId && !isOrgRow \? \[agentId\] : \[\]/,
		"the viewer-state read is not issued for an org row",
	);
	assert.match(
		details,
		/\{isOrgRow && <OrgOriginBadge orgName=\{orgName\} \/>\}/,
	);
});

test("the hub page scopes its read and renders the org states", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	// The scope decides the read, and it does so in ONE place.
	assert.match(page, /tenantId: orgScopeId,/);
	// The scope control is chips, shown only when an organization exists to switch to.
	assert.match(page, /\{selectableOrgs\.length > 0 && \(/);
	assert.match(page, /data-testid="agent-hub-scope"/);
	assert.match(page, /aria-pressed=\{scope === value\}/);
	// "no access" is a state of the surface, not the outage panel.
	assert.match(page, /data-testid="agent-hub-org-no-access"/);
	assert.match(
		page,
		/const orgRefusal = activeOrg \? orgRefusalFromError\(error\) : null/,
	);
	assert.match(page, /!isColdLoading && error && !orgRefusal/);
	// The Teams view is mounted ONCE and serves BOTH scopes: the organization's
	// roster inside an org, the public catalogue outside one. The explanatory
	// notice the public scope used to render is gone with the premise it stated.
	assert.equal(
		page.split("<OrgTeamsList").length - 1,
		1,
		"one mount of the roster",
	);
	assert.equal(
		page.split("<PublicTeamsLibrary").length - 1,
		1,
		"one mount of the public catalogue",
	);
	assert.match(page, /view === "teams" &&\s*\(activeOrg \?/);
	assert.doesNotMatch(page, /PublicTeamsNotice/);
});

test("the publish dialog offers the org target and disables a plan-blocked one", () => {
	const dialog = read(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
	);
	assert.match(dialog, /data-testid="publish-target"/);
	assert.match(
		dialog,
		/\{blockedTargets\.map\(\(org\) => \(/,
		"a plan-blocked org is listed rather than omitted, so its absence is not silent",
	);
	assert.match(
		dialog,
		/\{org\.tenant_name \|\| "Organization"\} \(upgrade needed\)/,
		"the blocked item carries the reason in its own label",
	);
	assert.match(
		dialog,
		/target: targetIsOrg\s*\?\s*\{ visibility: "org", tenantId: targetTenant \}\s*:\s*undefined,/,
		"the target reaches the transport, and no target means the public hub",
	);
	// An org target never carries the remembered PUBLIC listing id.
	assert.match(dialog, /options\?\.asNewListing \|\| targetIsOrg/);
});

/*
 * C1: the dialog's CHROME follows the target, like its body already did.
 *
 * The defect was one line above the control that corrected it: with an
 * organization selected, a title and a receipt still said "the Agent hub" and the
 * submit button said "Update listing" on a press that always CREATES a new org
 * document. A frame cannot see this without reading the words, so it is pinned
 * here.
 */
test("the dialog's title and submit label describe the selected target", () => {
	const dialog = read(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
	);
	assert.match(
		dialog,
		/published\.orgName\s*\?\s*`Published "\$\{agentName\}" to \$\{published\.orgName\}`/,
		"the receipt names the organization, not the hub",
	);
	assert.match(
		dialog,
		/targetIsOrg\s*\?\s*`Publish "\$\{agentName\}" to \$\{targetDisplayName\}\?`/,
		"the pre-submit title names the organization",
	);
	assert.match(
		dialog,
		/listing && !targetIsOrg/,
		"`Update listing` is only true of a PUBLIC listing, because an org publication is always new",
	);
});

/*
 * M2 and m1: the two sentences beside NO picker.
 *
 * A retry cannot make a backend that predates the operations answer them, and a
 * failed read is not "you have no organizations" — two facts a reader about to
 * publish needs told apart, which is why both are states of the surface rather
 * than an absent control.
 */
test("the dialog says why there is no picker, and names the right remedy", () => {
	const dialog = read(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
	);
	assert.match(dialog, /data-testid="publish-target-unavailable"/);
	assert.match(dialog, /data-testid="publish-target-failed"/);
	assert.match(
		dialog,
		/enabled: open && isAuthenticated && orgReady/,
		"the read is not attempted against a backend that cannot answer it",
	);
	// The capability arm comes BEFORE the failed arm: a pre-G backend's read
	// failure IS the masked 422, and the retry it would otherwise be offered
	// cannot work.
	const unavailable = dialog.indexOf(
		'data-testid="publish-target-unavailable"',
	);
	const failed = dialog.indexOf('data-testid="publish-target-failed"');
	assert.ok(
		unavailable > 0 && failed > unavailable,
		"the capability sentence is the one a pre-G backend gets",
	);
});

/* ------------------------------------ 7. the org surface is capability-gated */

test("a backend without the org capability is told to update, not to retry", async () => {
	const bundle = await build({
		stdin: {
			contents: `
				export { orgSurfaceNotice, orgSurfaceReady } from "./src/renderer/src/features/agent-hub/org-surface-gate";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		loader: { ".css": "empty" },
		alias: {
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	const { orgSurfaceNotice, orgSurfaceReady } = mod;

	assert.equal(orgSurfaceReady("enabled"), true);
	assert.equal(orgSurfaceReady("below-version"), false);
	assert.equal(orgSurfaceReady("unpaired"), false);
	// No answer yet: a surface must not assert either cause before main replies.
	assert.equal(orgSurfaceReady("unknown"), false);

	assert.equal(orgSurfaceNotice("enabled", null), null);
	assert.equal(orgSurfaceNotice("unknown", null), null);
	assert.match(
		orgSurfaceNotice("below-version", null),
		/Update the backend and try again\.$/,
		"the remedy for a backend that predates the operations is the update",
	);
	assert.doesNotMatch(
		orgSurfaceNotice("below-version", null),
		/try again in a moment/,
		"a retry cannot make a pre-G backend answer these routes",
	);
	// An unpaired backend keeps the house pairing sentence, which is not this
	// surface's to author.
	assert.match(orgSurfaceNotice("unpaired", "unpaired"), /not paired/);
});

/*
 * The capability must be in the UNION, not only in the payload: `Record<string,
 * number>` would accept any typo, and a surface that gated on a misspelled key
 * would gate on `undefined` and hide itself silently.
 */
test("the org capability key is a typed member of the feature union", () => {
	const hooks = read(
		"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
	);
	assert.match(hooks, /\| "radient_org"/);
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	assert.match(
		page,
		/desktopFeatureState\(capabilities\.data, "radient_org"\)/,
	);
	assert.match(page, /enabled: orgSurfaceReady\(orgState\)/);
});

/* ------------------------- 8. the wire shapes, pinned (Q-1, S-1, m2, D1, D2) */

/*
 * S-1: a HALF publication target is refused at BOTH boundaries.
 *
 * The defect was fail-open on the one field where that is a disclosure: each half
 * parsed on its own, and the path composer dropped the unpaired half — so
 * `{visibility: "org"}` alone became a plain `/publish`, a PUBLIC publication
 * with no error anywhere. The schema is what the renderer meets; the composer is
 * what a cast could still reach.
 */
test("a half-specified publication target is refused, not read as the public hub", () => {
	for (const op of ["agent.publish", "agent.republish"]) {
		const base =
			op === "agent.publish"
				? { agentId: "a" }
				: { agentId: "a", hubAgentId: "h" };
		const visibilityOnly = desktopRequestSchema.safeParse({
			op,
			...base,
			visibility: "org",
		});
		assert.equal(
			visibilityOnly.success,
			false,
			`${op} with no tenantId must not parse: it would publish publicly`,
		);
		const tenantOnly = desktopRequestSchema.safeParse({
			op,
			...base,
			tenantId: "org-9",
		});
		assert.equal(
			tenantOnly.success,
			false,
			`${op} with no visibility must not parse`,
		);
		const paired = desktopRequestSchema.safeParse({
			op,
			...base,
			visibility: "org",
			tenantId: "org-9",
		});
		assert.equal(paired.success, true, `${op} must accept the full pair`);
		const neither = desktopRequestSchema.safeParse({
			op,
			...base,
		});
		assert.equal(neither.success, true, `${op} must still mean the public hub`);
	}

	// The composer refuses the same pair rather than composing a public request.
	assert.throws(
		() =>
			desktopEndpoint({ op: "agent.publish", agentId: "a", visibility: "org" }),
		/half/,
	);
	assert.throws(
		() => desktopEndpoint({ op: "agent.publish", agentId: "a", tenantId: "t" }),
		/half/,
	);
	assert.equal(
		desktopEndpoint({ op: "agent.publish", agentId: "a" }).path,
		"/v1/agents/a/publish",
		"no target still composes the public route, which is what every caller did before",
	);
});

/*
 * Q-1: `invalid_name` is a BOOLEAN, and the sentence is derived locally.
 *
 * The first revision read it as the offending NAME and called `.trim()` on it. The
 * route sends a flag (local-operator `teams.py`), so every successful pull threw a
 * TypeError inside the success handler: the pull landed and the UI said it failed.
 * The booleans below are the SHAPE that broke it; the string case is the
 * regression guard for a shape nothing sends, because a crash is not an
 * acceptable answer to an unexpected one either.
 */
const pullBundle = await build({
	stdin: {
		contents: `
			export { describePulledTeam } from "./src/renderer/src/features/agent-hub/team-pull-report";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const pullPath = new URL(
	`./_org-sharing-pull-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(pullPath, pullBundle.outputFiles[0].text);
after(async () => {
	await unlink(pullPath).catch(() => {});
});
const { describePulledTeam } = await import(pullPath.href);

test("a pulled team's report reads `invalid_name` as the boolean the wire sends", () => {
	// The exact shape that threw: a boolean flag with no rename to report.
	const plain = describePulledTeam({
		id: "t",
		name: "Incident response",
		renamed_from: undefined,
		invalid_name: false,
	});
	assert.equal(plain.level, "success");
	assert.match(plain.message, /Pulled team "Incident response"\./);

	// `true` with the published name on `renamed_from`: the spelling was adjusted,
	// and the name to quote is the published one because the flag carries none.
	const adjusted = describePulledTeam({
		id: "t",
		name: "Incident response",
		renamed_from: "incident/response",
		invalid_name: true,
	});
	assert.equal(adjusted.level, "warning");
	assert.match(adjusted.message, /"incident\/response" is not usable locally/);
	// No em dash in the sentence (copy review round 1, C3).
	assert.doesNotMatch(adjusted.message, /—/);

	// A pure collision: a rename, reported as a success.
	const renamed = describePulledTeam({
		id: "t",
		name: "Incident response 2",
		renamed_from: "Incident response",
		invalid_name: false,
	});
	assert.equal(renamed.level, "success");
	assert.match(
		renamed.message,
		/you already have a team called "Incident response"/,
	);
	assert.doesNotMatch(renamed.message, /—/);

	// The regression guard: a shape nothing sends must not throw either.
	assert.doesNotThrow(() =>
		describePulledTeam({
			id: "t",
			name: "Anything",
			renamed_from: "Anything else",
			invalid_name: "some-name",
		}),
	);
	assert.doesNotThrow(() => describePulledTeam(undefined, "Requested"));
	assert.equal(
		describePulledTeam(undefined, "Requested").message,
		'Pulled team "Requested".',
	);
});

/*
 * m2: the placeholder does NOT cross a scope flip.
 *
 * Kept records are what stops the grid emptying on a page change, and they are
 * also what would render the PUBLIC scope's cards under "Showing: <org>" for one
 * latency — the failure the two key prefixes exist to prevent. The scope is read
 * from the key, so the two key builders and the predicate cannot disagree.
 */
test("held records never cross a scope flip", async () => {
	const mounted = await mountListHook({ ...FILTERS, tenantId: "org-9" });
	try {
		const { agentListScopeOfKey } = await import(mountPath.href);
		assert.equal(
			agentListScopeOfKey(mounted.orgAgentKeys.list("org-9", FILTERS)),
			"org-9",
		);
		assert.equal(
			agentListScopeOfKey(mounted.publicAgentKeys.list(FILTERS)),
			null,
			"the public list's scope is null, so an org scope can never match it",
		);
		assert.equal(agentListScopeOfKey(undefined), null);

		const list = read(
			"src/renderer/src/features/agent-hub/hooks/use-public-agents-query.ts",
		);
		assert.match(
			list,
			/placeholderData: \(previousData, previousQuery\) =>\s*agentListScopeOfKey\(previousQuery\?\.queryKey\) === \(tenantId \?\? null\)/,
			"the placeholder is decided by the SCOPE, not by recency",
		);
		assert.doesNotMatch(
			list,
			/placeholderData: keepPreviousData/,
			"the unscoped placeholder is what carried the other scope's records",
		);
	} finally {
		await mounted.teardown();
	}
});

/*
 * D1 and D2, and the two nits whose fix is a wiring rather than a sentence.
 *
 * These are SOURCE anchors on purpose: what a frame shows is an amber panel; what
 * it cannot show is that the same code renders `danger` two sections over, or that
 * the retry's own edge clears the 3:1 floor in the other 57 palettes. The
 * measurements are the design round's; the decisions are pinned here.
 */
test("both refusal sections agree on severity, and both retries are filled controls", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	// D2: a refusal is a `warning` on BOTH sections; `danger` is the generic arm.
	assert.match(roster, /variant=\{refusal \? "warning" : "danger"\}/);
	// D1: the retry is a filled control, the shape `update-error-alert` moved to.
	assert.match(
		page,
		/variant="primary"\s*\n\s*size="sm"\s*\n\s*onClick=\{\(\) => void refetch\(\)\}/,
	);
	assert.match(
		roster,
		/variant="primary"\s*\n\s*size="sm"\s*\n\s*onClick=\{\(\) => void refetch\(\)\}/,
	);
	assert.doesNotMatch(
		page.split('data-testid="agent-hub-org-no-access"')[1]?.slice(0, 1200) ??
			"",
		/variant="outline"/,
		"the refusal retry is not an outlined control",
	);
	/*
	 * C6, REVISED by design round 1's N3: the roster's skeleton is `aria-hidden`
	 * and carries no sentence of its own, because the page's `aria-live` status
	 * line already says "Loading teams…" above it - the state is announced once, by
	 * the region that then reports the count.
	 */
	assert.doesNotMatch(roster, /sr-only">Loading teams…/);
	// The skeleton is three rows of the settled row's own box (`org-teams-summary.test.mjs`).
	assert.match(
		roster,
		/aria-hidden="true"\s+className="flex flex-col divide-y divide-hairline"\s+data-testid="org-teams-loading"/,
	);
	assert.match(page, /statusSentence = "Loading teams…"/);
});

test("the roster renders a coded pull refusal through the shared treatment", () => {
	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	// n1: `team_not_found`'s `refresh-hub` arm used to be a row nobody could reach.
	assert.match(roster, /publicationTreatment\(/);
	assert.match(roster, /PUBLICATION_ACTION_LABEL\[action\]/);
	assert.match(roster, /onClick=\{\(\) => void refetch\(\)\}/);
	// One label table for every surface that renders a treatment.
	const failure = read(
		"src/renderer/src/features/agents/utils/publication-failure.ts",
	);
	assert.match(failure, /export const PUBLICATION_ACTION_LABEL/);
	const dialog = read(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
	);
	assert.doesNotMatch(
		dialog,
		/const ACTION_LABEL: Record<PublicationAction, string>/,
		"the dialog no longer owns a second copy of the labels",
	);
});

test("the details page reads memberships only for an org row", () => {
	const details = read(
		"src/renderer/src/features/agent-hub/agent-details-page.tsx",
	);
	// n2: the answer is consumed only for an org row, so a public row does not
	// spend a read on it.
	assert.match(details, /useMembershipsQuery\(\{ enabled: isOrgRow \}\)/);
});

test("the plan remedy names the Team plan and the console", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	const failure = read(
		"src/renderer/src/features/agents/utils/publication-failure.ts",
	);
	// C2: one spelling of the plan across the surface.
	for (const source of [page, roster, failure]) {
		assert.doesNotMatch(source, /active team plan/);
	}
	// C5: plan activation happens in the console, and the sentence says so.
	assert.match(page, /can activate it in the Radient console/);
	assert.match(roster, /can activate it in the Radient console/);
	assert.match(
		failure,
		/activate it in the Radient console, then publish again/,
	);
	// C4: the plural branch reads as a plural. It lives in the DIALOG, beside the
	// picker it explains.
	const dialog = read(
		"src/renderer/src/features/agents/components/upload-agent-dialog.tsx",
	);
	assert.match(dialog, /any of the organizations marked above/);
	assert.doesNotMatch(dialog, /An owner of the organizations marked above/);
});

/*
 * THE REAL RESPONSES, THROUGH THE SHIPPED HOOK, ONTO THE TOAST.
 *
 * Captured 2026-09-27 from the merged local server (`local-operator` @ 5bba6a917,
 * the app served over a real socket) against a stub hub on loopback — the rig is
 * `qa-evidence/loui-H/qa-round2/rig_org_pull.py`. These two bodies are verbatim
 * from the 17:57 run, whose raw output is `qa-round2/rig-output.txt`; the earlier
 * 17:40 run of the same rig produced the same shapes with different row ids and
 * `created_date`, which is the only field pair that differs between them (agent
 * review round 2, N-1). The two names are the two branches: one the local rule
 * can hold, one it must rewrite.
 *
 * The mount is the point: `describePulledTeam` alone proves the SENTENCE, and the
 * defect Q-1 was in the DISPATCH — a success handler that threw before any toast
 * was asked for. So the shipped hook is mounted with a recording stub in the
 * toast manager's place, and the assertion is that a toast was asked for at all,
 * at the level the wire's own flag selects.
 */
const CAPTURED_PULL = {
	validName: {
		status: 200,
		message: "Team pulled from Radient successfully",
		result: {
			id: "b365d427-4e28-4dbd-97a8-e6734eab0558",
			name: "Inbox-Triage",
			created_date: "2026-09-27T17:40:30.527277Z",
			description: "A published team.",
			manager: "adverse-media-desk",
			members: [{ role: "researcher", count: 2, kind: "agent" }],
			instructions: "Screen, then report.",
			project: "Onboarding",
			renamed_from: null,
			invalid_name: false,
		},
	},
	invalidName: {
		status: 200,
		message: "Team pulled from Radient successfully",
		result: {
			id: "77f1c266-04ef-41a5-9952-f01e3c0c7fba",
			name: "Feature-Release-Crew",
			created_date: "2026-09-27T17:40:31.928391Z",
			description: "A published team.",
			manager: "adverse-media-desk",
			members: [{ role: "researcher", count: 2, kind: "agent" }],
			instructions: "Screen, then report.",
			project: "Onboarding",
			renamed_from: "Feature Release Crew",
			invalid_name: true,
		},
	},
};

const toastStubPath = new URL(
	`./_org-sharing-toasts-${process.pid}.mjs`,
	import.meta.url,
);
/*
 * The SECOND dependency replaced, and for the same reason the reporter was moved
 * out of this hook: `@shared/config` builds the app's environment at module scope
 * and throws in a bare node import (measured: "Failed to load configuration").
 * The hook reads `apiConfig.baseUrl` and nothing else from it.
 */
const configStubPath = new URL(
	`./_org-sharing-config-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	configStubPath,
	`export const apiConfig = { baseUrl: "http://127.0.0.1:1" };
	export const config = {};`,
);
after(async () => {
	await unlink(configStubPath).catch(() => {});
});
await writeFile(
	toastStubPath,
	`export const shown = [];
	export const showSuccessToast = (message) => { shown.push(["success", message]); return 0; };
	export const showWarningToast = (message) => { shown.push(["warning", message]); return 0; };
	export const showErrorToast = () => 0;
	export const showInfoToast = () => 0;
	export const showLoadingToast = () => 0;
	export const dismissToast = () => {};
	`,
);
after(async () => {
	await unlink(toastStubPath).catch(() => {});
});

const hookBundle = await build({
	stdin: {
		contents: `
			export { useTeamPullMutation } from "./src/renderer/src/features/agent-hub/hooks/use-team-pull-mutation";
			export { shown } from "@shared/utils/toast-manager";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		// The one dependency replaced: the hook asks the toast manager, and this
		// records the ask instead of rendering it.
		"@shared/utils/toast-manager": toastStubPath.pathname,
		"@shared/config": configStubPath.pathname,
	},
	write: false,
});
const hookPath = new URL(
	`./_org-sharing-hook-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(hookPath, hookBundle.outputFiles[0].text);
after(async () => {
	await unlink(hookPath).catch(() => {});
});

const mountPull = async (body) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = { window: globalThis.window, document: globalThis.document };
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	dom.window.api = {
		desktop: {
			// The transport hands the route's CRUDResponse through verbatim, which
			// is what `desktopControlResponse` re-serialises into a `Response` and
			// what the hook's `data.result` reads the document out of.
			request: async () => ({ status: 200, body }),
		},
	};

	const mod = await import(hookPath.href);
	// The stub's array is module state: it survives a remount in one process.
	mod.shown.length = 0;
	const { QueryClient, QueryClientProvider } = await import(hookPath.href);
	const { createRoot } = await import("react-dom/client");
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			/*
			 * `gcTime: 0`, and it is load-bearing: a mutation's cache entry schedules
			 * its own five-minute GC timer when its observer unsubscribes at unmount,
			 * and `clear()` does not reach that timer the way it reaches a query's -
			 * `QueryCache.remove` destroys the query, `MutationCache.clear` only
			 * empties the map. Left at the default, this file's process sat past its
			 * last assertion until killed, and CI stalled Desktop Tests to its
			 * SIGTERM (4m32s-5m18s; no test-failure annotation). Zero keeps the
			 * mounted mutation's data while an observer is attached and drops it the
			 * moment the tree unmounts, which is all a test wants.
			 */
			mutations: { retry: false, gcTime: 0 },
		},
	});
	let mutation;
	const Probe = () => {
		mutation = mod.useTeamPullMutation();
		return null;
	};
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(Probe),
			),
		);
	});
	await act(async () => {
		await mutation.mutateAsync({
			teamId: "team-qa-1",
			tenantId: "org-a",
			name: "Inbox-Triage",
		});
	});
	return {
		shown: mod.shown,
		error: mutation.error,
		teardown: async () => {
			await act(async () => root.unmount());
			queryClient.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

test("the shipped pull hook toasts the real responses and crashes on neither", async () => {
	for (const [label, body] of Object.entries(CAPTURED_PULL)) {
		const mounted = await mountPull(body);
		try {
			assert.equal(
				mounted.error,
				null,
				`${label}: the success handler must not throw (Q-1 was a TypeError here)`,
			);
			assert.equal(mounted.shown.length, 1, `${label}: exactly one statement`);
			const [level, message] = mounted.shown[0];
			if (body.result.invalid_name === true) {
				assert.equal(level, "warning", `${label}: a rewritten name is news`);
				assert.match(message, /Feature Release Crew/);
				assert.match(message, /Feature-Release-Crew/);
			} else {
				assert.equal(
					level,
					"success",
					`${label}: an unchanged name is a success`,
				);
				assert.match(message, /Inbox-Triage/);
			}
		} finally {
			await mounted.teardown();
		}
	}
});

/* ------------------------------- 9. the convergence round's small corrections */

/*
 * C7 (copy round 2): a table shared by two surfaces has to say which one speaks.
 *
 * The roster renders `publicationTreatment` for a PULL, and three of its bodies
 * were authored for a publication — "Nothing was published", "then publish
 * again". The context's `surface` selects the voice, and these are the arms the
 * copy round named.
 */
test("the treatment speaks the puller's verbs when the roster asks", async () => {
	const bundle = await build({
		stdin: {
			contents: `
				export { publicationTreatment } from "./src/renderer/src/features/agents/utils/publication-failure";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		loader: { ".css": "empty" },
		alias: {
			"@shared": `${process.cwd()}/src/renderer/src/shared`,
			"@features": `${process.cwd()}/src/renderer/src/features`,
		},
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	const { publicationTreatment } = mod;
	const pull = { name: "Inbox-Triage", hubAgentId: null, surface: "pull" };
	const publish = { name: "Inbox-Triage", hubAgentId: null };

	for (const code of [
		"team_plan_required",
		"hub_unauthorized",
		"not_a_member",
	]) {
		const pulled = publicationTreatment(
			{ code, message: "", details: {} },
			pull,
		);
		const published = publicationTreatment(
			{ code, message: "", details: {} },
			publish,
		);
		assert.doesNotMatch(
			pulled.body,
			/publish/,
			`${code} must not tell a puller to publish`,
		);
		assert.match(pulled.body, /pull/, `${code}: the pull arm names the act`);
		assert.match(
			published.body,
			/publish/,
			`${code}: the dialog's own arm is unchanged`,
		);
	}

	// The unnamed-subject fallback follows the surface too: a pull's subject is a
	// team, not an agent.
	const unnamed = publicationTreatment(
		{ code: "insufficient_role", message: "", details: { required: "admin" } },
		{ name: "", hubAgentId: null, surface: "pull" },
	);
	assert.match(unnamed.body, /admin/);
	assert.match(unnamed.body, /pull again/);

	// Absent `surface` is exactly the publish voice: every caller before the
	// roster read this table.
	const absent = publicationTreatment(
		{ code: "hub_unauthorized", message: "", details: {} },
		{ name: "x", hubAgentId: null },
	);
	assert.equal(
		absent.body,
		"Nothing was published. Sign in to Radient again to replace the credential the hub refused, then publish again.",
	);
});

/*
 * R-2 and C8 (agent + copy round 2): one action, one act.
 *
 * The roster maps each honoured action to the act it names — a retry re-pulls the
 * SAME team, a refresh reads the roster, a sign-in opens the shared credential
 * panel — and renders nothing for an action it cannot honour. `refetch` for every
 * action was the defect: "Sign in again" reloaded a list.
 */
test("the roster honours its actions, and renders no others", () => {
	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	assert.match(
		roster,
		/const ROSTER_ACTIONS: readonly PublicationAction\[\] = \[/,
	);
	for (const action of ["refresh-hub", "retry", "sign-in"]) {
		assert.match(roster, new RegExp(`"${action}"`));
	}
	assert.match(
		roster,
		/case "retry":\s*\n\s*handlePull\(team\);/,
		"a retry re-pulls the team the refusal is about",
	);
	assert.match(
		roster,
		/case "refresh-hub":\s*\n\s*void refetch\(\);/,
		"a refresh re-reads the roster",
	);
	assert.match(
		roster,
		/case "sign-in":\s*\n\s*setReauthenticating\(true\);/,
		"a sign-in opens the credential panel rather than reloading the list",
	);
	// The control is the SHARED one the dialog uses, not a second sign-in path.
	assert.match(roster, /<RadientAuthButtons/);
	assert.match(roster, /data-testid="org-team-pull-reauth"/);
	// And the filter is what keeps a publish-only remedy off the row.
	assert.match(
		roster,
		/\.filter\(\(action\) => ROSTER_ACTIONS\.includes\(action\)\)/,
	);
	// The pull asks for the pull voice.
	assert.match(roster, /surface: "pull"/);
});

/*
 * S-2 (security round 2): the second boundary agrees with the query composer
 * about what "a tenant is present" means.
 *
 * `!== undefined` read `""` as present while the composition read it as absent:
 * the assert passed and the query was dropped — the same silent public
 * publication S-1 closed for the undefined half.
 */
test("a falsy-but-defined tenantId is refused at both boundaries", () => {
	const falsy = { visibility: "org", tenantId: "" };
	assert.throws(
		() => desktopEndpoint({ op: "agent.publish", agentId: "a", ...falsy }),
		/half/,
		"an empty tenantId must throw rather than compose a public publication",
	);
	assert.throws(
		() =>
			desktopEndpoint({
				op: "agent.republish",
				agentId: "a",
				hubAgentId: "h",
				...falsy,
			}),
		/half/,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "agent.publish",
			agentId: "a",
			...falsy,
		}).success,
		false,
		"the schema refuses it too — one predicate, both boundaries",
	);
});

/*
 * D5 (design round 2): the org capability notice wears its family's register.
 */
test("the org capability notice is a warning, like its four siblings", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	const notice = page.split('data-testid="agent-hub-org-unavailable"')[0];
	assert.match(
		notice.slice(-400),
		/variant="warning"/,
		"the notice that says 'update the backend' is a warning, as its siblings are",
	);
	// The refusals directly below it carry the same register for the same reason.
	assert.match(
		page,
		/variant=\{orgRefusal \? "warning" : "danger"\}|orgRefusal[\s\S]{0,120}variant="warning"/,
	);
});

/*
 * The TWO teams reads are separate questions with separate keys, and each is
 * issued by exactly the scope that can answer it: `org_teams.list` per org-scope
 * entry (the page's count observer and the roster's observer share a key), and
 * the hub's anonymous public listing for the public catalogue (§11 O-7's premise
 * recorded the opposite, which is what this change fixes). Source-anchored for
 * the wiring; the request counts are measured off a rendered page by
 * `scripts/hub-round-trips.mjs`.
 */
test("each scope reads its own team list, and neither reads the other's", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	assert.match(page, /useOrgTeamsQuery\(\{ tenantId: orgScopeId \}\)/);
	assert.equal(page.split("useOrgTeamsQuery(").length - 1, 1);
	const hook = read(
		"src/renderer/src/features/agent-hub/hooks/use-org-teams-query.ts",
	);
	assert.match(hook, /enabled: enabled && !!tenantId/);
	// The public catalogue is a DIFFERENT read: the org route names a tenant and
	// there is none outside an organization, so the library mounts the public
	// hook, which asks the hub directly and anonymously.
	const library = read(
		"src/renderer/src/features/agent-hub/components/public-teams-library.tsx",
	);
	assert.match(library, /usePublicTeamsQuery\(/);
	assert.doesNotMatch(library, /useOrgTeamsQuery|listOrgTeams/);
	const publicHook = read(
		"src/renderer/src/features/agent-hub/hooks/use-public-teams-query.ts",
	);
	assert.match(publicHook, /listPublicTeams\(/);
	assert.match(publicHook, /getPublicTeam\(/);
});

test("the status sentence names the scope, and the pager keeps its labels", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	assert.match(page, /"in the public hub"/);
	assert.match(page, /`shared with \$\{orgName \?\? "this organization"\}`/);
	assert.match(page, /data-testid="agent-hub-status"/);
	const pager = read(
		"src/renderer/src/features/agent-hub/components/hub-pager.tsx",
	);
	assert.match(pager, /aria-label="Previous page"/);
	assert.match(pager, /aria-label="Next page"/);
	assert.match(pager, /min-h-13/);
	// The sidebar's stepper is not the hub's footer any more, and is untouched.
	assert.doesNotMatch(page, /import \{ CompactPagination \}/);
});

test("the author line drops the email fallback", () => {
	const details = read(
		"src/renderer/src/features/agent-hub/agent-details-page.tsx",
	);
	assert.doesNotMatch(details, /No email/);
	assert.match(details, /agent\.account_metadata\?\.email\s*\?/);
});

/*
 * THE PREMISE THIS CHANGE REMOVES, pinned so it cannot come back (2026-10-05).
 *
 * The public Teams view used to be a notice reading "The public hub lists agents
 * only" in six states, mounted wherever the scope was public. The hub does serve
 * a public team listing, the view now reads it, and no surface may say otherwise.
 */
test("no surface still says the public hub lists agents only", async () => {
	const { readdirSync } = await import("node:fs");
	const feature = "src/renderer/src/features/agent-hub";
	const walk = (dir) =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
			entry.isDirectory()
				? walk(`${dir}/${entry.name}`)
				: [`${dir}/${entry.name}`],
		);
	const files = walk(feature).filter((path) => /\.(ts|tsx)$/.test(path));
	assert.equal(
		files.length > 20,
		true,
		`the walk reached the feature (${files.length} files)`,
	);
	/*
	 * The EXACT sentence the notice rendered, capital T: prose may quote the
	 * removed copy in lower case (this file does, and so do the library's and the
	 * stories' own comments), but no surface may RENDER it again.
	 */
	for (const path of files) {
		assert.doesNotMatch(
			read(path),
			/The public hub lists agents only/,
			`${path} still carries the org-only framing`,
		);
	}
	const page = read(`${feature}/agent-hub-page.tsx`);
	assert.match(page, /<PublicTeamsLibrary/);
	assert.doesNotMatch(page, /PublicTeamsNotice/);
	// The library STATES what the catalogue is and that pulling is the act this
	// surface owns, which is the copy the notice's premise had replaced.
	const library = read(`${feature}/components/public-teams-library.tsx`);
	assert.match(library, /Public teams are published to the hub/);
	assert.match(library, /agent-hub-public-teams-search/);
});

test("the pager and the roster hand focus to a surviving control", () => {
	const pager = read(
		"src/renderer/src/features/agent-hub/components/hub-pager.tsx",
	);
	assert.match(pager, /handOffRef\.current = "previous"/);
	assert.match(pager, /handOffRef\.current = "next"/);
	const roster = read(
		"src/renderer/src/features/agent-hub/components/org-teams-list.tsx",
	);
	assert.match(roster, /refocusTeamId/);
	// The alert is not wider than its panel: `Alert` is `w-full`, so the margin
	// needs `w-auto` or it is 100% + 32px.
	assert.match(roster, /className="m-4 w-auto"/);
});

/*
 * The hub's evidence set is COMPLETE (agent review round 1, M2).
 *
 * Two frames of `load-failed` (`obsidian`, `synth`) were left at the base tree's
 * layout after a sweep died mid-run, and nothing noticed: the manifest's frame
 * count is arithmetic over the tree, so it cannot see a stale blob, and
 * `check-evidence` had deferred. This pins the part a directory listing CAN
 * know - every registered `agent-hub-page--<state>` row has a directory holding
 * one frame per sweep theme, and no directory exists that the table does not
 * declare. Freshness of a blob's pixels is what the re-shoot commit and its
 * message are for; a missing or orphaned frame is what this catches.
 */
test("every agent-hub-page state holds one frame per sweep theme", async () => {
	const { readdirSync, existsSync } = await import("node:fs");
	const table = read("scripts/capture-evidence.mjs");
	const registered = [
		...table.matchAll(/^\t\["agent-hub-page--([a-z0-9-]+)",/gm),
	].map((match) => match[1]);
	assert.ok(registered.length >= 27, "the table registers the hub's states");
	const root = "docs/evidence/agent-hub-page";
	const onDisk = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	assert.deepEqual(
		onDisk.filter((dir) => !registered.includes(dir)).sort(),
		[],
		"no frame directory is orphaned from the capture table",
	);
	for (const state of registered) {
		assert.ok(existsSync(`${root}/${state}`), `${state} has a directory`);
		const frames = readdirSync(`${root}/${state}`).filter((file) =>
			file.endsWith(".webp"),
		);
		assert.equal(frames.length, 12, `${state} holds one frame per theme`);
	}
});
