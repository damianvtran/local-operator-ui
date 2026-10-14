import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Presentation-only proof: these controls cannot prove server admission, CAS,
// scheduling, native interaction, or rendered geometry. Independent QA owns those.
const bundled = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/definition-editor-identity"; export * from "./src/renderer/src/features/agents/hub-link-view"; export * from "./src/renderer/src/features/agents/hub-preview-binding"; export * from "./src/renderer/src/features/agents/hub-link-adapter"; export * from "./src/renderer/src/shared/api/local-operator/hub-links"; export {desktopRequestSchema,desktopEndpoint} from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
});
const {
	profileEditorIdentity,
	teamEditorIdentity,
	hubLinkMark,
	hubPreviewMatches,
	hubLinkView,
	linksForLocalItem,
	desktopRequestSchema,
	desktopEndpoint,
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
			link({ push: direction({ state: "failed", retryable: true }) }),
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
