import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Presentation-only proof: these controls cannot prove server admission, CAS,
// scheduling, native interaction, or rendered geometry. Independent QA owns those.
const bundled = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/hub-publication"; export * from "./src/renderer/src/features/agents/definition-editor-identity"; export * from "./src/renderer/src/features/agents/hub-link-view"; export * from "./src/renderer/src/features/agents/hub-preview-binding"; export * from "./src/renderer/src/features/agents/hub-link-adapter"; export * from "./src/renderer/src/shared/api/local-operator/hub-links"; export {desktopRequestSchema,desktopEndpoint,desktopRequestDeadlineMs} from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	/*
	 * The adapter now imports a VALUE (`baselineIsKnown`) from `@shared/...`, not
	 * only types, so the alias has to resolve — a type-only import was previously
	 * elided and never needed it. Same alias the sibling hub suites use.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const {
	initialSkillPreviewMatches,
	publicationPolicyAcknowledged,
	profileEditorIdentity,
	teamEditorIdentity,
	hubLinkMark,
	hubAutoPushGate,
	hubAutoPushLine,
	hubPreviewMatches,
	hubLinkView,
	linksForLocalItem,
	desktopRequestSchema,
	desktopEndpoint,
	desktopRequestDeadlineMs,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const direction = (over = {}) => ({
	state: "idle",
	effective: true,
	reason: null,
	retryable: false,
	canApply: false,
	lastSuccess: null,
	modelUsed: null,
	operationId: null,
	...over,
});
const link = (over = {}) => ({
	id: "synthetic-link",
	kind: "agent",
	localId: "synthetic-local",
	name: "coder",
	source: { visibility: "public", address: "https://hub.invalid/v1" },
	policy: { subscribe: true, autoPush: false, revision: "synthetic-revision" },
	canEnableAutoPush: false,
	autoPushUnavailableReason: null,
	canEditPolicy: true,
	pull: direction(),
	push: direction(),
	...over,
});

test("healthy linked agent/team/skill keeps a discoverable policy action", () => {
	for (const kind of ["agent", "team", "skill"])
		assert.deepEqual(hubLinkMark(link({ kind })), {
			kind: "healthy",
			direction: "pull",
			action: "policy",
		});
});

test("manual safe available applies when subscription is off", () => {
	assert.equal(
		hubLinkMark(
			link({
				policy: { subscribe: false, autoPush: false, revision: "r" },
				pull: direction({ state: "available", canApply: true }),
			}),
		).action,
		"apply",
	);
});

test("available without service safety admission opens review", () => {
	assert.equal(
		hubLinkMark(link({ pull: direction({ state: "available" }) })).action,
		"detail",
	);
});

test("paused outgoing preference outranks incoming activity, without changing policy", () => {
	const fixture = link({
		policy: { subscribe: false, autoPush: true, revision: "r" },
		pull: direction({ state: "merging" }),
		push: direction({ effective: false, reason: "mixed-lineage" }),
	});
	assert.deepEqual(hubLinkMark(fixture), {
		kind: "review",
		direction: "push",
		action: "detail",
	});
	assert.equal(fixture.policy.autoPush, true);
});

test("retry is directional and only offered when service admits it", () => {
	assert.deepEqual(
		hubLinkMark(
			link({
				policy: { subscribe: true, autoPush: true, revision: "r" },
				push: direction({ state: "failed", retryable: true }),
			}),
		),
		{ kind: "failed", direction: "push", action: "retry" },
	);
	assert.equal(
		hubLinkMark(link({ push: direction({ state: "failed" }) })).action,
		"detail",
	);
});

test("unknown future state cannot become healthy, apply, or automatic write", () => {
	assert.deepEqual(
		hubLinkMark(link({ push: direction({ state: "future-state" }) })),
		{ kind: "review", direction: "push", action: "detail" },
	);
});

test("transient success retains policy entry and direction", () => {
	assert.deepEqual(
		hubLinkMark(link({ push: direction({ state: "published" }) })),
		{ kind: "applied", direction: "push", action: "policy" },
	);
});

const policy = (over = {}) => ({
	op: "hub.policy",
	requestId: "00000000-0000-4000-8000-000000000001",
	linkId: "link/with space",
	expectedPolicyRevision: "opaque-r1",
	subscribe: false,
	...over,
});
test("skill membership ops name their own routes and share the pull's deadline", () => {
	const requestId = "00000000-0000-4000-8000-000000000001";
	const pull = desktopRequestSchema.parse({
		op: "hub.skillPull",
		requestId,
		hubId: "skill-release-notes",
		hubSource: "https://hub.example/v1",
		visibility: "public",
		tenantId: null,
		localAlias: "release-notes",
	});
	const subscribe = desktopRequestSchema.parse({
		op: "hub.skillSubscribe",
		requestId,
		hubId: "skill-release-notes",
		hubSource: "https://hub.example/v1",
		visibility: "public",
		tenantId: null,
		localAlias: "release-notes",
	});
	assert.deepEqual(desktopEndpoint(subscribe), {
		path: "/v1/desktop/hub/skills/subscribe",
		method: "POST",
		body: {
			request_id: requestId,
			hub_id: "skill-release-notes",
			hub_source: "https://hub.example/v1",
			visibility: "public",
			tenant_id: null,
			local_alias: "release-notes",
		},
	});
	assert.equal(
		desktopRequestDeadlineMs(subscribe),
		desktopRequestDeadlineMs(pull),
		"linking without content costs the same round trip as a pull",
	);
	const unpull = desktopRequestSchema.parse({
		op: "hub.skillUnpull",
		requestId,
		linkId: "link/with space",
	});
	assert.deepEqual(desktopEndpoint(unpull), {
		path: "/v1/desktop/hub/skills/unpull",
		method: "POST",
		body: { request_id: requestId, link_id: "link/with space" },
	});
	assert.equal(
		desktopRequestDeadlineMs(unpull),
		desktopRequestDeadlineMs(pull),
	);
});
test("skill membership refuses a mismatched scope pair before transport", () => {
	const base = {
		op: "hub.skillSubscribe",
		requestId: "00000000-0000-4000-8000-000000000001",
		hubId: "skill-release-notes",
		hubSource: "https://hub.example/v1",
		localAlias: "release-notes",
	};
	assert.equal(
		desktopRequestSchema.safeParse({
			...base,
			visibility: "public",
			tenantId: "org-minerva",
		}).success,
		false,
		"a public subscribe may not name a tenant",
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			...base,
			visibility: "org",
			tenantId: null,
		}).success,
		false,
		"an org subscribe must name its tenant",
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			...base,
			visibility: "public",
			tenantId: null,
			subscribe: true,
		}).success,
		false,
		"a subscribe carries no install policy: it is subscribe-on by definition",
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "hub.skillUnpull",
			requestId: base.requestId,
			linkId: "link-1",
			hubId: "skill-release-notes",
		}).success,
		false,
		"unpull addresses the local link only",
	);
});
test("full inventory supports skills without altering legacy pending route", () => {
	assert.equal(
		desktopEndpoint(
			desktopRequestSchema.parse({ op: "hub.links", kind: "skill" }),
		).path,
		"/v1/desktop/hub/links?kind=skill",
	);
	assert.equal(
		desktopEndpoint(desktopRequestSchema.parse({ op: "hub.updates" })).path,
		"/v1/desktop/hub/updates",
	);
});
test("policy transports captured revision and only the changed independent flag", () => {
	const endpoint = desktopEndpoint(desktopRequestSchema.parse(policy()));
	assert.equal(endpoint.method, "PATCH");
	assert.equal(endpoint.path, "/v1/desktop/hub/links/link%2Fwith%20space");
	assert.deepEqual(endpoint.body, {
		request_id: "00000000-0000-4000-8000-000000000001",
		expected_policy_revision: "opaque-r1",
		subscribe: false,
	});
});
test("policy fails closed before transport for missing revision, coercion or grant-only write", () => {
	for (const input of [
		policy({ expectedPolicyRevision: "" }),
		policy({ subscribe: "false" }),
		policy({ subscribe: undefined, confirmPublicEgress: true }),
		policy({ tenantId: "other-org" }),
	])
		assert.equal(desktopRequestSchema.safeParse(input).success, false);
});
test("outbound consent never implicitly changes subscription", () => {
	const endpoint = desktopEndpoint(
		desktopRequestSchema.parse(
			policy({
				subscribe: undefined,
				autoPush: true,
				confirmPublicEgress: true,
			}),
		),
	);
	assert.deepEqual(endpoint.body, {
		request_id: "00000000-0000-4000-8000-000000000001",
		expected_policy_revision: "opaque-r1",
		auto_push: true,
		confirm_public_egress: true,
	});
});

const rawLink = (over = {}) => ({
	link_id: "synthetic-link",
	kind: "skill",
	local_id: "local-1",
	name: "example",
	hub_id: "remote-1",
	hub_source: "https://hub.invalid/api/v1",
	visibility: "org",
	tenant_id: "tenant-1",
	tenant_name: "Acme",
	policy: { subscribe: true, auto_push: false, revision: "policy-1" },
	eligibility: { can_auto_push: true, reason: null },
	baseline_state: "known",
	remote_revision: '"opaque-etag-1"',
	auto_will_apply: false,
	auto_will_push: false,
	pull: {
		...direction(),
		classification: "remote-only",
		last_checked_at: null,
		last_success_at: null,
		error_class: null,
		model_used: null,
		operation_id: null,
	},
	push: {
		...direction(),
		classification: null,
		last_checked_at: null,
		last_success_at: null,
		error_class: null,
		model_used: null,
		operation_id: null,
	},
	...over,
});
const preview = (over = {}) => ({
	preview_receipt: "opaque-receipt",
	link_id: "synthetic-link",
	direction: "push",
	hub_source: "https://hub.invalid/api/v1",
	visibility: "org",
	tenant_id: "tenant-1",
	local_fingerprint: "local-hash",
	expected_policy_revision: "policy-1",
	expected_remote_revision: '"opaque-etag-1"',
	proposal_fingerprint: "proposal-hash",
	expires_at: "2030-01-01T00:00:00Z",
	proposal: { kind: "skill", fields: {} },
	warnings: [],
	can_confirm: true,
	reason: null,
	...over,
});
test("preview visible binding accepts same opaque identity but expires and changes fail closed", () => {
	const now = Date.parse("2026-10-13T00:00:00Z");
	assert.equal(hubPreviewMatches(preview(), rawLink(), now), true);
	for (const over of [
		{ link_id: "other" },
		{ hub_source: "https://other.invalid/v1" },
		{ visibility: "public", tenant_id: null },
		{ expected_policy_revision: "other" },
		{ expected_remote_revision: '"new-etag"' },
		{ can_confirm: false },
		{ expires_at: "invalid" },
		{ expires_at: "2020-01-01T00:00:00Z" },
		{ preview_receipt: "" },
	])
		assert.equal(hubPreviewMatches(preview(over), rawLink(), now), false);
});
test("source adapter never guesses Public for unavailable organization", () => {
	assert.equal(
		hubLinkView(rawLink({ tenant_name: null })).source.visibility,
		"unavailable",
	);
	assert.equal(
		hubLinkView(rawLink({ tenant_name: null })).canEnableAutoPush,
		false,
	);
	assert.equal(
		hubLinkView(rawLink({ remote_revision: null })).canEnableAutoPush,
		false,
	);
});
test("immutable local ID never falls back to an alias belonging to another copy", () => {
	const inventory = {
		links: [rawLink(), rawLink({ local_id: "local-2", link_id: "link-2" })],
	};
	assert.equal(
		linksForLocalItem(inventory, "skill", "not-found", "example").length,
		0,
	);
	assert.deepEqual(
		linksForLocalItem(inventory, "skill", "local-2", "renamed").map(
			(x) => x.link_id,
		),
		["link-2"],
	);
});
test("stable retry names direction and cannot also select another named copy", () => {
	const request = {
		op: "hub.retry",
		requestId: "00000000-0000-4000-8000-000000000001",
		linkId: "synthetic-link",
		direction: "push",
	};
	assert.deepEqual(desktopEndpoint(desktopRequestSchema.parse(request)).body, {
		request_id: request.requestId,
		link_id: "synthetic-link",
		direction: "push",
	});
	for (const over of [
		{ direction: undefined },
		{ kind: "agent", name: "other-copy" },
	])
		assert.equal(
			desktopRequestSchema.safeParse({ ...request, ...over }).success,
			false,
		);
});
test("manual publish cannot confirm unseen proposal or treat dry-run as consent", () => {
	const request = {
		op: "hub.push",
		requestId: "00000000-0000-4000-8000-000000000001",
		linkId: "synthetic-link",
		direction: "push",
	};
	for (const over of [
		{ dryRun: false },
		{ dryRun: false, previewReceipt: "receipt" },
		{ dryRun: true, confirmPublish: true },
		{
			dryRun: false,
			previewReceipt: "receipt",
			confirmPublish: true,
			tenantId: "other-org",
		},
	])
		assert.equal(
			desktopRequestSchema.safeParse({ ...request, ...over }).success,
			false,
		);
	const endpoint = desktopEndpoint(
		desktopRequestSchema.parse({
			...request,
			dryRun: false,
			previewReceipt: "receipt",
			confirmPublish: true,
		}),
	);
	assert.equal(endpoint.body.preview_receipt, "receipt");
	assert.equal(endpoint.body.confirm_publish, true);
	assert.equal(endpoint.path, "/v1/desktop/hub/updates/push");
});

test("incoming viewed result requires receipt + explicit confirm and cannot share dry-run", () => {
	const base = {
		op: "hub.apply",
		requestId: "00000000-0000-4000-8000-000000000001",
		linkId: "synthetic-link",
		direction: "pull",
	};
	for (const over of [
		{ confirmApply: true },
		{ previewReceipt: "receipt" },
		{ previewReceipt: "receipt", confirmApply: true, dryRun: true },
	])
		assert.equal(
			desktopRequestSchema.safeParse({ ...base, ...over }).success,
			false,
		);
	const endpoint = desktopEndpoint(
		desktopRequestSchema.parse({
			...base,
			previewReceipt: "receipt",
			confirmApply: true,
			prefer: "local",
			acknowledgeUnknownBaseline: true,
		}),
	);
	assert.equal(endpoint.body.preview_receipt, "receipt");
	assert.equal(endpoint.body.confirm_apply, true);
	assert.equal(endpoint.body.prefer, "local");
	assert.equal(endpoint.body.acknowledge_unknown_baseline, true);
});
test("inbound old-server nullable revision remains bound to remote hash and source", () => {
	const incoming = {
		...preview(),
		direction: "pull",
		expected_remote_revision: null,
		remote_fingerprint: "remote-hash",
		choices: {
			prefer: "local",
			acknowledge_unknown_baseline: true,
			replace: null,
			confirm_replace: false,
		},
	};
	const target = rawLink({ remote_revision: null });
	assert.equal(
		hubPreviewMatches(incoming, target, Date.parse("2026-10-13T00:00:00Z")),
		true,
	);
	assert.equal(
		hubPreviewMatches(
			{ ...incoming, remote_fingerprint: "" },
			target,
			Date.parse("2026-10-13T00:00:00Z"),
		),
		false,
	);
});

test("same immutable editor survives changed fetched bytes but another source does not", () => {
	const profile = { name: "same-name", source: "custom", agent_id: null };
	assert.equal(
		profileEditorIdentity(profile),
		profileEditorIdentity({ ...profile, instructions: "background merge" }),
	);
	assert.notEqual(
		profileEditorIdentity(profile),
		profileEditorIdentity({ ...profile, source: "builtin" }),
	);
	assert.notEqual(
		profileEditorIdentity({ ...profile, agent_id: "id-1" }),
		profileEditorIdentity({ ...profile, agent_id: "id-2" }),
	);
	assert.equal(
		profileEditorIdentity({ ...profile, agent_id: "id-1" }),
		profileEditorIdentity({ ...profile, name: "renamed", agent_id: "id-1" }),
	);
	const team = { name: "same-name", id: "team-1" };
	assert.equal(
		teamEditorIdentity(team),
		teamEditorIdentity({ ...team, description: "background merge" }),
	);
	assert.notEqual(
		teamEditorIdentity(team),
		teamEditorIdentity({ ...team, id: "team-2" }),
	);
});

test("OFF outbound retry cannot infer future-write consent from an operation ID", () => {
	const mark = hubLinkMark(
		link({
			policy: { subscribe: false, autoPush: false, revision: "r" },
			push: direction({
				state: "failed",
				retryable: true,
				operationId: "prior-operation",
			}),
		}),
	);
	assert.deepEqual(mark, {
		kind: "review",
		direction: "push",
		action: "detail",
	});
});

test("initial skill confirmation binds source alias scope flags expiry and full proposal", () => {
	const draft = {
		sourceSkill: "authored",
		localAlias: "public-copy",
		visibility: "public",
		tenantId: null,
		subscribe: true,
		autoPush: false,
		confirmPublicEgress: false,
	};
	const preview = {
		kind: "skill",
		direction: "push",
		publication: "create",
		can_confirm: true,
		preview_receipt: "viewed",
		source_skill: "authored",
		local_alias: "public-copy",
		visibility: "public",
		tenant_id: null,
		local_fingerprint: "local",
		draft_fingerprint: "draft",
		proposal_fingerprint: "proposal",
		expires_at: "2030-01-01T00:00:00Z",
		policy: { subscribe: true, auto_push: false, confirm_public_egress: false },
		proposal: {
			kind: "skill",
			fields: {
				document_version: 1,
				name: "authored",
				description: "description",
				files: [{ path: "SKILL.md", content: "reviewed full body" }],
			},
		},
	};
	assert.equal(initialSkillPreviewMatches(preview, draft, 0), true);
	for (const changed of [
		{ sourceSkill: "another" },
		{ localAlias: "org-copy" },
		{ visibility: "org", tenantId: "org-one" },
		{ subscribe: false },
		{ autoPush: true },
		{ confirmPublicEgress: true },
	])
		assert.equal(
			initialSkillPreviewMatches(preview, { ...draft, ...changed }, 0),
			false,
		);
	for (const changed of [
		{ can_confirm: false },
		{ direction: "pull" },
		{ publication: "update" },
		{ expires_at: "invalid" },
		{ expires_at: "1970-01-01T00:00:00Z" },
		{ proposal: { kind: "agent", fields: { document_version: 1 } } },
	])
		assert.equal(
			initialSkillPreviewMatches({ ...preview, ...changed }, draft, 0),
			false,
		);
});

test("remote success and pending receipts do not acknowledge stored policies", () => {
	const confirmed = rawLink();
	const complete = {
		link: confirmed,
		local_link_receipt: {
			state: "complete",
			operation_id: "operation",
			link_id: confirmed.link_id,
			safe_message: null,
		},
	};
	assert.equal(publicationPolicyAcknowledged(complete), true);
	assert.equal(
		publicationPolicyAcknowledged({ ...complete, link: null }),
		false,
	);
	assert.equal(
		publicationPolicyAcknowledged({
			...complete,
			local_link_receipt: {
				...complete.local_link_receipt,
				state: "pending-reconciliation",
			},
		}),
		false,
	);
	assert.equal(
		publicationPolicyAcknowledged({
			...complete,
			local_link_receipt: {
				...complete.local_link_receipt,
				link_id: "another-link",
			},
		}),
		false,
	);
	assert.equal(
		publicationPolicyAcknowledged({
			...complete,
			link: { ...confirmed, policy: { ...confirmed.policy, revision: "" } },
		}),
		false,
	);
	assert.equal(
		publicationPolicyAcknowledged({ publication: { accepted_document: {} } }),
		false,
	);
});

test("initial transports preserve exact echo arms and reject guessed scope or consent", () => {
	const base = {
		op: "hub.skillPublish",
		requestId: "11111111-1111-4111-8111-111111111111",
		sourceSkill: "authored",
		localAlias: "public-copy",
		visibility: "public",
		tenantId: null,
		subscribe: true,
		autoPush: false,
		confirmPublicEgress: false,
		dryRun: true,
	};
	assert.equal(desktopRequestSchema.safeParse(base).success, true);
	const preview = desktopEndpoint(base);
	assert.equal(preview.path, "/v1/desktop/hub/skills/publish");
	assert.equal(preview.body.source_skill, "authored");
	assert.equal(preview.body.local_alias, "public-copy");
	assert.equal(preview.body.subscribe, true);
	assert.equal(preview.body.auto_push, false);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, tenantId: "org-one" }).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, dryRun: false }).success,
		false,
	);
	const confirmed = {
		...base,
		dryRun: false,
		previewReceipt: "viewed-token",
		confirmPublish: true,
	};
	assert.equal(desktopRequestSchema.safeParse(confirmed).success, true);
	assert.equal(desktopEndpoint(confirmed).body.preview_receipt, "viewed-token");
	const initial = {
		op: "agent.publish",
		agentId: "local",
		requestId: "22222222-2222-4222-8222-222222222222",
		subscribe: false,
		autoPush: false,
		confirmPublicEgress: false,
	};
	assert.equal(desktopRequestSchema.safeParse(initial).success, true);
	assert.deepEqual(desktopEndpoint(initial).body, {
		document: {},
		request_id: "22222222-2222-4222-8222-222222222222",
		subscribe: false,
		auto_push: false,
		confirm_public_egress: false,
	});
	assert.equal(
		desktopRequestSchema.safeParse({ ...initial, requestId: undefined })
			.success,
		false,
	);
	const team = {
		op: "team.publish",
		teamId: "local",
		requestId: "33333333-3333-4333-8333-333333333333",
		visibility: "org",
		tenantId: "org-one",
		subscribe: true,
		autoPush: false,
		confirmPublicEgress: false,
	};
	assert.equal(desktopRequestSchema.safeParse(team).success, true);
	assert.equal(
		desktopEndpoint(team).path,
		"/v1/teams/local/publish?visibility=org&tenant_id=org-one",
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...team, visibility: undefined }).success,
		false,
	);
});

const skillsDraftPins = {
	scopeKey: /key=\{`skills:\$\{scope\}`\}/,
	privateLoss: /!scopeIsAvailable && view !== "skills"/,
	keptForm:
		/<HubSkillPublication[\s\S]*?enabled=\{supported && accessible && signedIn\}/,
	inventoryDependency: /\[[^\]]*installed\.data[^\]]*\]/,
	destination: /destinationRef\.current === destination/,
	scopedQuery: /scope\.visibility,[\s\S]*?scope\.tenantId/,
	requestId: /requestId: input.requestId/,
	operation: /operation|request\.current/,
};

test("Skills draft mount and scope authority do not depend on inventory bytes", async () => {
	const { readFileSync } = await import("node:fs");
	const read = (path) => readFileSync(path, "utf8");
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	const library = read(
		"src/renderer/src/features/agent-hub/components/hub-skills-library.tsx",
	);
	const publication = read(
		"src/renderer/src/features/agent-hub/components/hub-skill-publication.tsx",
	);
	const hook = read(
		"src/renderer/src/features/agent-hub/hooks/use-hub-skills.ts",
	);
	assert.match(page, skillsDraftPins.scopeKey);
	assert.match(page, skillsDraftPins.privateLoss);
	assert.match(library, skillsDraftPins.keptForm);
	assert.doesNotMatch(publication, skillsDraftPins.inventoryDependency);
	assert.match(publication, skillsDraftPins.destination);
	assert.match(hook, skillsDraftPins.scopedQuery);
	assert.match(hook, skillsDraftPins.requestId);
	assert.match(publication, skillsDraftPins.operation);
});

const casUuid = "44444444-4444-4444-8444-444444444444";

test("definition CAS echoes the opaque revision beside the fields, never inside them", () => {
	const base = {
		op: "profiles.update",
		name: "coder",
		requestId: casUuid,
		fields: { description: "d" },
	};
	// Absent/null = the legacy unconditional write: no revision key on the wire.
	for (const rev of [undefined, null]) {
		const body = desktopEndpoint(
			desktopRequestSchema.parse({ ...base, expectedDefinitionRevision: rev }),
		).body;
		assert.equal("expected_definition_revision" in body, false);
		assert.equal(body.description, "d");
	}
	// A supplied opaque token travels BESIDE the fields, not nested in them.
	const body = desktopEndpoint(
		desktopRequestSchema.parse({
			...base,
			expectedDefinitionRevision: "rev-abc",
		}),
	).body;
	assert.equal(body.expected_definition_revision, "rev-abc");
	assert.equal(body.fields, undefined);
	assert.deepEqual(body.description, "d");
	// Strict: a typo must be refused rather than silently dropping CAS protection.
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, expecteddefinitionrevision: "x" })
			.success,
		false,
	);
});

test("team definition CAS mirrors the profile arm", () => {
	const base = {
		op: "teams.update",
		name: "squad",
		requestId: casUuid,
		fields: { description: "d" },
	};
	assert.equal(desktopRequestSchema.safeParse(base).success, true);
	assert.equal(
		desktopEndpoint(
			desktopRequestSchema.parse({
				...base,
				expectedDefinitionRevision: "rev-1",
			}),
		).body.expected_definition_revision,
		"rev-1",
	);
	assert.equal(
		desktopEndpoint(desktopRequestSchema.parse(base)).body
			.expected_definition_revision,
		undefined,
	);
});

test("source resolution requires the full stated destination and refuses guessed scope", () => {
	const base = {
		op: "hub.apply",
		requestId: casUuid,
		kind: "agent",
		name: "legacy",
		resolveSource: true,
		hubSource: "https://hub.invalid/api/v1",
		acknowledgeUnknownBaseline: true,
	};
	// Public: paired null tenant, composed on the existing apply route.
	const pub = desktopEndpoint(
		desktopRequestSchema.parse({
			...base,
			visibility: "public",
			tenantId: null,
		}),
	);
	assert.equal(pub.path, "/v1/desktop/hub/updates/apply");
	assert.equal(pub.body.resolve_source, true);
	assert.equal(pub.body.hub_source, "https://hub.invalid/api/v1");
	assert.equal(pub.body.visibility, "public");
	assert.equal(pub.body.tenant_id, null);
	// Org: non-null tenant.
	assert.equal(
		desktopRequestSchema.safeParse({
			...base,
			visibility: "org",
			tenantId: "org-one",
		}).success,
		true,
	);
	// Half-stated destinations and a missing acknowledgement are refused BEFORE the wire.
	for (const bad of [
		{ ...base, visibility: "public", tenantId: "org-one" },
		{ ...base, visibility: "org", tenantId: null },
		{ ...base, visibility: "org" },
		{ ...base, visibility: "public" },
		{
			...base,
			visibility: "public",
			tenantId: null,
			acknowledgeUnknownBaseline: false,
		},
	])
		assert.equal(
			desktopRequestSchema.safeParse(bad).success,
			false,
			JSON.stringify(bad),
		);
});

test("source-resolution baseline field tracks core's emitted key and literals", async () => {
	const { readFileSync } = await import("node:fs");
	const links = readFileSync(
		"src/renderer/src/shared/api/local-operator/hub-links.ts",
		"utf8",
	);
	// Core renamed the response key to `baseline_state` (desktop_hub.py:246-258 at
	// head 323a55a40) and its real literals are "adopt"/"adopt-unknown". The old
	// receipt shorthand "adopted" is emitted by no path and must not appear in the
	// declaration (prose may name it as the retired shorthand).
	const code = links.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	assert.match(code, /baseline_state: "adopt" \| "adopt-unknown";/);
	assert.doesNotMatch(code, /"adopted"/);
	assert.doesNotMatch(code, /baseline: "/);
});

test("a PUBLIC no-grant link requires consent, not unavailability; every other refusal stays", () => {
	const wire = (over = {}, elig = {}) => ({
		visibility: "public",
		tenant_name: null,
		remote_revision: "r1",
		eligibility: {
			can_auto_push: false,
			reason: "unsafe-publication",
			...elig,
		},
		...over,
	});
	// The E2E-caught case: public + unsafe-publication must let the consent dialog
	// send its confirm_public_egress patch.
	assert.deepEqual(hubAutoPushGate(wire()), {
		unavailable: false,
		requiresConsent: true,
	});
	// Every EARLIER core gate still refuses, public or not.
	for (const reason of [
		"unsupported-precondition",
		"baseline-unknown",
		"mixed-lineage",
		null,
		"something-new",
	])
		assert.equal(
			hubAutoPushGate(wire({}, { reason })).unavailable,
			true,
			`public + ${reason} stays unavailable`,
		);
	// unsafe-publication cannot apply to an org link: stays refused.
	assert.equal(
		hubAutoPushGate(wire({ visibility: "org", tenant_name: "Minerva" }))
			.unavailable,
		true,
	);
	// No remote revision never enables, even with the carve-out.
	assert.equal(
		hubAutoPushGate(wire({ remote_revision: null })).unavailable,
		true,
	);
	// An org link missing its verified tenant name never enables.
	assert.equal(
		hubAutoPushGate(
			wire(
				{ visibility: "org", tenant_name: null },
				{ can_auto_push: true, reason: null },
			),
		).unavailable,
		true,
	);
	// An already-eligible link is available and needs no carve-out.
	assert.deepEqual(
		hubAutoPushGate(wire({}, { can_auto_push: true, reason: null })),
		{ unavailable: false, requiresConsent: false },
	);
});

test("the auto-push line follows EFFECTIVE state: the carve-out never hides a pause", () => {
	const wire = (on, elig = {}, over = {}) => ({
		visibility: "public",
		tenant_name: null,
		remote_revision: "r1",
		policy: { auto_push: on },
		eligibility: {
			can_auto_push: false,
			reason: "unsafe-publication",
			...elig,
		},
		...over,
	});
	// ON + public + unsafe-publication (missing/stale grant): paused WITH reason.
	assert.equal(hubAutoPushLine(wire(true)), "paused");
	// ON + any other refusal: paused.
	for (const reason of [
		"unsupported-precondition",
		"baseline-unknown",
		"mixed-lineage",
	])
		assert.equal(hubAutoPushLine(wire(true, { reason })), "paused", reason);
	// OFF + public + unsafe-publication: consent is reachable, no unavailable line.
	assert.equal(hubAutoPushLine(wire(false)), "none");
	// OFF + other refusal: the control is genuinely unavailable.
	assert.equal(
		hubAutoPushLine(wire(false, { reason: "baseline-unknown" })),
		"unavailable",
	);
	// ON + eligible: nothing to explain.
	assert.equal(
		hubAutoPushLine(wire(true, { can_auto_push: true, reason: null })),
		"none",
	);
});

test("the adapter's canEnableAutoPush is the shared gate, so a public no-grant link can start consent", () => {
	const view = hubLinkView(
		rawLink({
			visibility: "public",
			tenant_name: null,
			remote_revision: "r1",
			eligibility: { can_auto_push: false, reason: "unsafe-publication" },
		}),
	);
	assert.equal(view.canEnableAutoPush, true);
	assert.equal(
		hubLinkView(
			rawLink({
				visibility: "public",
				remote_revision: "r1",
				eligibility: { can_auto_push: false, reason: "baseline-unknown" },
			}),
		).canEnableAutoPush,
		false,
	);
});
