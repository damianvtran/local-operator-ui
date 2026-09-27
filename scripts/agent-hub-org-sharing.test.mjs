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
 * 3. THE ENTITLEMENT RULE MATCHES THE SERVER'S. `orgAccess` is asserted against
 *    the matrix §3.2/§3.3 describe — including the two rows a reader is most
 *    likely to get wrong: a `past_due` plan ENTITLES (full access during dunning,
 *    §3.1), and an owner keeps access with no plan at all.
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
	assert.match(proxy, /\.\.\.\(args\.teamId \? \{ team_id: args\.teamId \} : \{\}\),?/);
});

test("the publish and team ops are in the desktop request union", () => {
	const contract = read("src/shared/desktop-contract.ts");
	assert.match(contract, /op: z\.literal\("team\.pull"\)/);
	assert.match(contract, /op: z\.literal\("agent\.publish"\)[\s\S]{0,400}visibility/);
	assert.match(
		contract,
		/op: z\.literal\("agent\.republish"\)[\s\S]{0,600}tenantId/,
	);
});

/* ------------------------------------------------------- 2. the target path */

const contractBundle = await build({
	stdin: {
		contents: `
			export { desktopEndpoint } from "./src/shared/desktop-contract";
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
const { desktopEndpoint } = contractModule;

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
	assert.equal(org.path, "/v1/agents/agent-1/publish?visibility=org&tenant_id=org-9");

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
const { orgAccess, usableOrgs, planBlockedOrgs, orgRefusalFromError } = accessModule;

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
	// An owner keeps the workspace in every plan state (§3.2).
	assert.equal(
		orgAccess(membership({ role: "owner", plan: { status: "none", seats: null } })),
		"available",
	);
	assert.equal(
		orgAccess(membership({ role: "owner", plan: { status: "canceled", seats: 1 } })),
		"available",
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

	const rows = [
		membership({ tenant_id: "a" }),
		membership({ tenant_id: "b", plan: { status: "none", seats: null } }),
		membership({ tenant_id: "c", status: "disabled" }),
		membership({ tenant_id: "d", role: "owner", plan: { status: "none", seats: null } }),
	];
	assert.deepEqual(
		usableOrgs(rows).map((row) => row.tenant_id),
		["a", "d"],
	);
	assert.deepEqual(
		planBlockedOrgs(rows).map((row) => row.tenant_id),
		["b"],
		"only a plan-blocked org is offered disabled; a disabled membership is not offered at all",
	);
});

/* ------------------------------------------- 4. the org list is its own read */

const mountBundle = await build({
	stdin: {
		contents: `
			export { orgAgentKeys, publicAgentKeys, usePublicAgentsQuery } from "./src/renderer/src/features/agent-hub/hooks/use-public-agents-query";
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

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
	assert.ok(Error_, "the desktop control error must be importable for this test");

	assert.equal(classify(new Error_("403", "x", undefined, "team_plan_required")), "plan");
	assert.equal(classify(new Error_("403", "x", undefined, "not_a_member")), "no_access");
	assert.equal(
		classify(new Error_("403", "x", undefined, "insufficient_role")),
		"no_access",
	);
	// An outage, a refused credential and a transport failure all keep the
	// surface's own failure treatment: reading any of them as "no access" would
	// render a backend that is not running as an organization that revoked access.
	assert.equal(classify(new Error_("502", "x", undefined, "radient_upstream_failed")), null);
	assert.equal(classify(new Error_("401", "x", undefined, "radient_credential_refused")), null);
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
		detail: { code: "insufficient_role", message: "x", details: { required: "admin" } },
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
	assert.match(details, /\{isOrgRow && <OrgOriginBadge orgName=\{orgName\} \/>\}/);
});

test("the hub page scopes its read and renders the org states", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	// The scope decides the read, and it does so in ONE place.
	assert.match(page, /tenantId: orgScopeId,/);
	assert.match(page, /\{selectableOrgs\.length > 0 && \(/);
	assert.match(page, /data-testid="agent-hub-scope"/);
	// "no access" is a state of the surface, not the outage panel.
	assert.match(page, /data-testid="agent-hub-org-no-access"/);
	assert.match(page, /const orgRefusal = activeOrg \? orgRefusalFromError\(error\) : null/);
	assert.match(page, /!isColdLoading && error && !orgRefusal/);
	// The roster is the org scope's, and it is mounted only there.
	assert.match(page, /\{activeOrg && \(\s*<OrgTeamsList/);
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
		/\{org\.tenant_name \|\| "Organization"\} — upgrade needed/,
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
