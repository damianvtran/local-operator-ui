import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PROFILE-SAVE CONSENT SURFACE, DRIVEN THROUGH ITS REAL MODULES.
 *
 * WHAT THIS FILE IS FOR. The card states a proposal the reader is asked to sign,
 * so the things that can go wrong are statements rather than layout:
 *
 *   - a value the wire did not carry must never be invented (empty vs missing);
 *   - the transport must never carry a hand-built command, only the reviewed
 *     operation and the two echoed digests, and it must be a STRICT body;
 *   - the generic `/approve` must be unreachable for a profile row;
 *   - the revert control must be offered ONLY from a verified descriptor, must
 *     latch while a press is in flight, and must never enable a duplicate;
 *   - the absent descriptor is the kill-switch: no control, and no enabled state.
 *
 * WHAT IT CANNOT PROVE. That a live backend serves these rows — `profile_save` is
 * removed from production registration pending a C5 decision, so nothing here is
 * an end-to-end approval. Layout and focus order are the design round's and the
 * native probe's business, not jsdom's.
 *
 * HOW IT IS DRIVEN. Both modules are bundled from the shipped TS with the same
 * `@shared` alias the sibling harnesses use (esbuild cannot read tsconfig paths),
 * then called. Values below are fixtures in the frozen v1 shapes.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/shared/profile-consent";
			export * from "./src/renderer/src/features/mesh/mesh-approvals";
			export * from "./src/renderer/src/features/mesh/mesh-profile-approval";
			export { profileSaveCall } from "./src/renderer/src/features/chat/components/trace/profile-save-card-model";
			export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";
			export { setLocale } from "./src/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});

const api = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
api.setLocale("en");

const digest = `sha256:${"a".repeat(64)}`;
const requestDigest = `sha256:${"b".repeat(64)}`;

const agentImage = (over = {}) => ({
	id: "ag_researcher",
	name: "Researcher",
	label: "Research agent",
	description: "Reads papers and keeps the notes.",
	tags: ["research"],
	categories: ["analysis"],
	model: "anthropic/claude-opus-5-5",
	instructions: "Read sources before summarising.",
	...over,
});

const disclosure = (over = {}) => ({
	version: 1,
	operation: "profile_save",
	approval_id: "ap_dem1234",
	profile_kind: "agent",
	scope: "global",
	profile_operation: "update",
	target_id: "ag_researcher",
	profile_name: "Researcher",
	session_id: "s_9f2c",
	tool_call_id: "tc_4a1b",
	receipt_id: "rc_71bd",
	changed_fields: ["model", "instructions"],
	before: agentImage({
		model: "anthropic/claude-sonnet-5",
		instructions: "Summarise.",
	}),
	after: agentImage(),
	base_commitment: digest,
	after_commitment: digest,
	expires_at: 1_900_000_000,
	signing_principal: "operator-key",
	...over,
});

const typedBlock = (over = {}) => ({
	action: "approve-operation",
	operation: "profile_save",
	request_digest: requestDigest,
	disclosure_digest: digest,
	disclosure: disclosure(),
	signable_here: true,
	refusal: "",
	refusal_message: "",
	apply_outcome: null,
	...over,
});

const row = (over = {}) => ({
	approvalId: "ap_dem1234",
	state: "requested",
	kind: "profile",
	expiresAt: 1_900_000_000,
	where: {
		deviceId: "",
		name: "",
		host: "",
		user: "",
		transport: "",
		hostKeyFp: "",
	},
	what: {
		connect: false,
		install: false,
		anchor: false,
		networkId: "",
		role: "",
		unattended: false,
		grants: [],
	},
	requestedBy: { surface: "", sessionId: "", deviceId: "" },
	...over,
});

/*
 * THE WIRE SHAPE `GET /v1/desktop/approvals` answers with, which is what the
 * normaliser reads: snake_case, `typed_approval`, and no camelCase anywhere. A
 * fixture in the normalised shape would prove the parser agrees with itself.
 */
const wire = (over = {}) => ({
	approval_id: "ap_dem1234",
	state: "requested",
	kind: "profile_save",
	expires_at: 1_900_000_000,
	what: {},
	requested_by: { surface: "desktop", session_id: "s_9f2c", device_id: "dv_1" },
	device: { host: "studio-mini", user: "damian" },
	...over,
});

const revertDescriptor = {
	schema: 1,
	kind: "profile_revert",
	action_id: "ra_5b81",
	label: "Revert",
	profile_kind: "agent",
	profile_name: "Researcher",
	receipt_id: "rc_71bd",
};

/* ------------------------------------------------------------- transport */

test("the typed decision carries the reviewed operation and both digests, strictly", () => {
	for (const [op, route] of [
		["approvals.approveOperation", "approve-operation"],
		["approvals.applyOperation", "apply-operation"],
	]) {
		const request = {
			op,
			approvalId: "ap_dem1234",
			operation: "profile_save",
			requestDigest,
			disclosureDigest: digest,
		};
		const parsed = api.desktopRequestSchema.safeParse(request);
		assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
		const endpoint = api.desktopEndpoint(parsed.data);
		assert.equal(endpoint.path, `/v1/desktop/approvals/ap_dem1234/${route}`);
		assert.equal(endpoint.method, "POST");
		// EXACTLY the acknowledgment model's three keys and no others: the server
		// is `extra: forbid`, so a fourth key is a 422 rather than a stray field.
		assert.deepEqual(endpoint.body, {
			operation: "profile_save",
			request_digest: requestDigest,
			disclosure_digest: digest,
		});
		for (const invalid of [
			{ ...request, operation: "rm_rf" },
			{ ...request, requestDigest: "sha256:beef" },
			{ ...request, disclosureDigest: digest.toUpperCase() },
			{ ...request, command: "anything" },
			{ ...request, approvalId: "../other" },
			{ ...request, remember: true },
		]) {
			assert.equal(
				api.desktopRequestSchema.safeParse(invalid).success,
				false,
				JSON.stringify(invalid),
			);
		}
	}
});

test("a profile row reaches the typed route and never the bodiless approve", () => {
	const profileRow = {
		...api.approvalRows([wire({ typed_approval: typedBlock() })])[0],
	};
	assert.equal(profileRow.kind, "profile");
	const capabilities = { profileApprovals: true };
	const approve = api.approvalDecisionRequest(
		profileRow,
		"approve",
		capabilities,
	);
	assert.equal(approve?.op, "approvals.approveOperation");
	assert.equal(approve?.operation, "profile_save");
	assert.equal(approve?.requestDigest, requestDigest);
	assert.equal(approve?.disclosureDigest, digest);
	// A deny is still the ordinary bodiless write, and stays available.
	assert.equal(
		api.approvalDecisionRequest(profileRow, "deny", capabilities)?.op,
		"approvals.deny",
	);
	// Without the capability there is no typed route to take: nothing is built,
	// so an older backend cannot be POSTed a body it has no route for.
	assert.equal(api.approvalDecisionRequest(profileRow, "approve", {}), null);
});

test("a typed block this build cannot parse keeps the kind and offers nothing", () => {
	const [unparsed] = api.approvalRows([
		wire({ typed_approval: typedBlock({ disclosure: { nope: true } }) }),
	]);
	assert.equal(unparsed.kind, "profile");
	assert.equal(unparsed.profile, undefined);
	const capabilities = { profileApprovals: true };
	assert.equal(api.canApproveApproval(unparsed, capabilities), false);
	assert.equal(
		api.approvalDecisionRequest(unparsed, "approve", capabilities),
		null,
	);
});

test("a row whose record kind says profile is a profile row even with no typed block", () => {
	const [legacy] = api.approvalRows([wire()]);
	assert.equal(legacy.kind, "profile");
	assert.equal(legacy.profile, undefined);
});

/* ------------------------------------------------------- the disclosure */

test("the disclosure is closed: an unknown key or a missing one is refused", () => {
	assert.equal(api.profileDisclosure(disclosure())?.profile_name, "Researcher");
	assert.equal(
		api.profileDisclosure({ ...disclosure(), command: "rm -rf /" }),
		null,
	);
	assert.equal(
		api.profileDisclosure({ ...disclosure(), profile_operation: "delete" }),
		null,
	);
	const { signing_principal, ...missing } = disclosure();
	assert.equal(api.profileDisclosure(missing), null);
	// A malformed digest is refused rather than carried to the server.
	assert.equal(
		api.profileDisclosure({ ...disclosure(), after_commitment: "sha256:x" }),
		null,
	);
	assert.notEqual(signing_principal, undefined);
});

test("changed fields are the disclosure's own, and missing never becomes a placeholder", () => {
	const parsed = api.profileDisclosure(
		disclosure({
			changed_fields: ["model", "instructions", "not_a_column", "label"],
			before: agentImage({ model: null, instructions: "Summarise." }),
			after: agentImage({
				model: "anthropic/claude-opus-5-5",
				label: "Research agent",
				instructions: "Read sources first.",
			}),
		}),
	);
	assert.ok(parsed);
	const rows = api.profileFieldRows(parsed);
	const byField = Object.fromEntries(rows.map((entry) => [entry.field, entry]));
	// `model` was explicitly reset then set again: the two sides are the facts.
	assert.equal(byField.model.before.presence, "unset");
	assert.equal(byField.model.after.presence, "set");
	// An unknown key is dropped, never rendered as an empty pair.
	assert.equal(byField.not_a_column, undefined);
	// An unchanged column is not part of "what changes".
	assert.equal(byField.label, undefined);
	assert.equal(byField.instructions.before.presence, "set");
	assert.equal(byField.instructions.after.presence, "set");
});

test("a column the wire did not carry reads absent, not empty", () => {
	// Destructured rather than deleted: the fixture simply never carries the column.
	const { model: _omitted, ...before } = agentImage();
	const parsed = api.profileDisclosure(
		disclosure({ changed_fields: ["model"], before }),
	);
	assert.ok(parsed);
	const [model] = api.profileFieldRows(parsed);
	assert.equal(model.before.presence, "absent");
	assert.equal(model.before.text, "");
	assert.equal(model.after.presence, "set");
});

/* ---------------------------------------------------------- the revert */

test("the revert control is offered only from a verified, well-formed descriptor", () => {
	const verified = api.profileRevertState({
		descriptor: revertDescriptor,
		descriptorVerified: true,
	});
	assert.deepEqual(verified, { state: "available", enabled: true });

	// A payload this build could parse, but that no runtime verified: refused.
	assert.deepEqual(
		api.profileRevertState({
			descriptor: revertDescriptor,
			descriptorVerified: false,
		}),
		{ state: "unavailable", enabled: false },
	);
	// A well-formed payload with an extra field is not the backend's descriptor.
	assert.equal(
		api.profileRevertState({
			descriptor: { ...revertDescriptor, command: "revert" },
			descriptorVerified: true,
		}).enabled,
		false,
	);
	// A model-authored shape is not a descriptor at all.
	assert.equal(
		api.profileRevertState({
			descriptor: { kind: "profile_revert", action_id: "ra_5b81" },
			descriptorVerified: true,
		}).state,
		"unavailable",
	);
});

test("the revert latches, settles, and never enables a duplicate", () => {
	const base = { descriptor: revertDescriptor, descriptorVerified: true };
	assert.deepEqual(api.profileRevertState({ ...base, submitted: true }), {
		state: "pending",
		enabled: false,
	});
	// An answered action id is settled before the in-flight arm is considered, so
	// a stale render cannot re-enable a second press.
	assert.deepEqual(
		api.profileRevertState({ ...base, submitted: true, alreadyAnswered: true }),
		{ state: "saved", enabled: false },
	);
	assert.deepEqual(
		api.profileRevertState({
			...base,
			outcome: { approved: true, state: "connected" },
		}),
		{ state: "saved", enabled: false },
	);
	assert.deepEqual(
		api.profileRevertState({ ...base, outcome: { approved: false } }),
		{ state: "failed", enabled: true },
	);
	assert.deepEqual(
		api.profileRevertState({
			...base,
			outcome: { approved: true, state: "expired" },
		}),
		{ state: "stale", enabled: false },
	);
	// Rebuilt after a restart with no verified reconstruction: unavailable, and
	// it says so rather than drawing a dead button.
	assert.deepEqual(api.profileRevertState({ ...base, reconstructed: true }), {
		state: "unavailable",
		enabled: false,
	});
});

test("the revert dispatch is an ordinary approval answer on the originating session", () => {
	assert.deepEqual(
		api.profileRevertAnswer({
			descriptor: revertDescriptor,
			sessionId: "s_9f2c",
			ownerEpoch: "e_1",
			state: "available",
		}),
		{
			sessionId: "s_9f2c",
			ownerEpoch: "e_1",
			requestId: "ra_5b81",
			approved: true,
		},
	);
	// Nothing is answered from a state that is not offered, from a descriptor
	// that is not the backend's, or with no session to answer on.
	assert.equal(
		api.profileRevertAnswer({
			descriptor: revertDescriptor,
			sessionId: "s_9f2c",
			state: "pending",
		}),
		null,
	);
	assert.equal(
		api.profileRevertAnswer({
			descriptor: { ...revertDescriptor, label: "" },
			sessionId: "s_9f2c",
			state: "available",
		}),
		null,
	);
	assert.equal(
		api.profileRevertAnswer({
			descriptor: revertDescriptor,
			sessionId: null,
			state: "available",
		}),
		null,
	);
});

test("an absent descriptor is the kill-switch: the control has no view of its own", () => {
	const unavailable = api.profileRevertUnavailable();
	assert.equal(unavailable.state, "unavailable");
	assert.equal(unavailable.enabled, false);
	assert.equal(unavailable.descriptor, null);
	assert.ok(unavailable.note, "the reason must be stated, not implied");
	assert.deepEqual(api.profileRevertView(null), unavailable);
});

/* ------------------------------------------------------------- the card */

test("the card states the proposal from the disclosure, and nothing when it has none", () => {
	const view = api.profileCardView(row({ profile: typedBlock() }), {
		profileApprovals: true,
		canApprove: true,
	});
	assert.equal(view.kind, "agent");
	assert.equal(view.name, "Researcher");
	assert.equal(view.operation, "update");
	assert.equal(view.scope, "global");
	assert.deepEqual(
		view.fields.map((entry) => entry.field),
		["model", "instructions"],
	);
	assert.equal(view.canApprove, true);
	assert.equal(view.unavailableReason, null);
	assert.equal(view.revert.state, "unavailable");

	// No typed block: the record is still stated, and nothing may be signed.
	const opaque = api.profileCardView(row(), { profileApprovals: true });
	assert.equal(opaque.kind, null);
	assert.equal(opaque.name, "");
	assert.deepEqual(opaque.fields, []);
	assert.equal(opaque.canApprove, false);
	assert.ok(opaque.unavailableReason);

	// The backend does not advertise the kind: same card, different honest reason.
	const off = api.profileCardView(row({ profile: typedBlock() }), {});
	assert.equal(off.canApprove, false);
	assert.ok(off.unavailableReason);
	assert.notEqual(off.unavailableReason, opaque.unavailableReason);
});

test("approved is not saved, and a settled record offers no verb", () => {
	const approved = api.profileCardView(
		row({ profile: typedBlock(), state: "approved" }),
		{
			profileApprovals: true,
			canRetryApply: true,
		},
	);
	assert.equal(approved.state, "approved_not_saved");
	const saved = api.profileCardView(
		row({ profile: typedBlock(), state: "connected" }),
		{
			profileApprovals: true,
		},
	);
	assert.equal(saved.state, "saved");
	const denied = api.profileCardView(
		row({ profile: typedBlock(), state: "denied" }),
		{
			profileApprovals: true,
		},
	);
	assert.equal(denied.state, "denied");
	assert.equal(denied.unavailableReason, null);
});

test("a queued receipt is waiting, not saved", () => {
	assert.equal(
		api.profileQueuedReceipt({
			status: "queued",
			approval_id: "ap_dem1234",
			request_digest: requestDigest,
			expires_at: 1_900_000_000,
			receipt_id: "rc_71bd",
			profile_kind: "agent",
			profile_name: "Researcher",
			scope: "global",
		})?.profile_name,
		"Researcher",
	);
	assert.equal(
		api.profileQueuedReceipt({ status: "saved", approval_id: "ap_dem1234" }),
		null,
	);
	const view = api.profileReceiptView({
		status: "queued",
		approval_id: "ap_dem1234",
		request_digest: requestDigest,
		expires_at: 1_900_000_000,
		receipt_id: "rc_71bd",
		profile_kind: "agent",
		profile_name: "Researcher",
		scope: "global",
	});
	assert.equal(view.state, "waiting");
	assert.equal(view.canApprove, false);
	assert.equal(view.revert.state, "unavailable");
});

/* ------------------------------------------------------- the surfaces */

const source = (path) => readFileSync(path, "utf8");

/* The source pins' patterns, hoisted: a literal inside an assertion is recompiled per call. */
const PROFILE_VIEW = /const profile =[\s\S]{0,200}profileCardView\(row/;
const PROFILE_CARD_RENDER = /<ProfileConsentCard view=\{profile\} \/>/;
const PROFILE_CAPABILITY = /profileApprovals=\{profileApprovals\}/;
const PROFILE_FEATURE_KEY = /"profile_approvals"/;
const REVERT_KILL_SWITCH = /revert\.descriptor !== null \|\| onRevert/;
const REVERT_DISABLED = /disabled=\{revertDisabled\}/;
const REVERT_DESCRIBED_BY =
	/aria-describedby=\{revert\.note \? revertNoteId : undefined\}/;

test("the inbox renders the profile card for a profile row and passes the capability", () => {
	const tray = source("src/renderer/src/features/mesh/mesh-approvals-tray.tsx");
	assert.match(tray, PROFILE_VIEW);
	assert.match(tray, PROFILE_CARD_RENDER);
	assert.match(tray, PROFILE_CAPABILITY);
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(page, PROFILE_FEATURE_KEY);
});

test("the card draws no revert control without a verified descriptor", () => {
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	// The kill-switch, in one expression: no descriptor and no handler = no control.
	assert.match(card, REVERT_KILL_SWITCH);
	assert.match(card, REVERT_DISABLED);
	assert.match(card, REVERT_DESCRIBED_BY);
});

/* --------------------------------------------- the transcript saved card */

/*
 * THE TRANSCRIPT'S OWN PARSER, on the strings a tool row actually holds.
 *
 * The interesting failures are not layout: they are a payload this build cannot
 * bound being described anyway, and a revert offered on a descriptor nobody
 * verified. Both are assertions here, and every legacy answer must fall through
 * to the ordinary row.
 */
const toolOutput = (value) =>
	typeof value === "string" ? value : JSON.stringify(value);

const callOf = (value, toolName = "profile_save") =>
	api.profileSaveCall({ toolName, output: toolOutput(value) });

test("a transcript answer this build cannot bound keeps today's row", () => {
	assert.equal(callOf("Saved the profile."), null);
	assert.equal(callOf(""), null);
	assert.equal(callOf("{ not json"), null);
	assert.equal(callOf({ hello: "world" }), null);
	// A disclosure with a key this shape never carries is refused, not half-read.
	assert.equal(callOf(disclosure({ extra_field: "surprise" })), null);
	// An envelope that grew a key is refused whole.
	assert.equal(callOf({ disclosure: disclosure(), surprise: true }), null);
	// Another tool's answer is not this card's business even when it parses.
	assert.equal(callOf(disclosure(), "bash"), null);
});

test("the saved card states the profile, the scope, the operation and the diff", () => {
	const call = callOf({ disclosure: disclosure(), state: "applied" });
	assert.ok(call);
	assert.equal(call.view.name, "Researcher");
	assert.equal(call.view.kind, "agent");
	assert.equal(call.view.scope, "global");
	assert.equal(call.view.operation, "update");
	assert.equal(call.view.state, "saved");
	assert.deepEqual(
		call.view.fields.map((entry) => entry.field),
		["model", "instructions"],
	);
	assert.equal(call.descriptor, null);
	assert.equal(call.view.revert.state, "unavailable");
});

test("the revert is offered only when the backend verified the descriptor", () => {
	const unverified = callOf({
		disclosure: disclosure(),
		revert: revertDescriptor,
	});
	assert.ok(unverified);
	assert.equal(unverified.descriptor, null);
	assert.equal(unverified.view.revert.state, "unavailable");
	assert.equal(unverified.view.revert.enabled, false);

	const wrongFlag = callOf({
		disclosure: disclosure(),
		revert: revertDescriptor,
		revert_verified: "yes",
	});
	assert.equal(wrongFlag?.descriptor, null);

	const verified = callOf({
		disclosure: disclosure(),
		state: "applied",
		revert: revertDescriptor,
		revert_verified: true,
	});
	assert.ok(verified?.descriptor);
	assert.equal(verified.view.revert.state, "available");
	assert.equal(verified.view.revert.enabled, true);
});

test("a queued receipt names the profile and claims no diff", () => {
	const call = callOf({
		status: "queued",
		approval_id: "ap_dem1234",
		request_digest: requestDigest,
		expires_at: 1_900_000_000,
		receipt_id: "rc_71bd",
		profile_kind: "agent",
		profile_name: "Researcher",
		scope: "global",
	});
	assert.ok(call);
	assert.equal(call.view.state, "waiting");
	assert.equal(call.view.name, "Researcher");
	assert.deepEqual(call.view.fields, []);
	assert.equal(call.descriptor, null);
});

test("an unknown state word reads as still waiting, never as saved", () => {
	for (const state of ["applied_ish", "", "SAVED_ISH"]) {
		const call = callOf({ disclosure: disclosure(), state });
		assert.equal(call?.view.state, "waiting", state);
	}
});

test("the transcript rows the card replaces keep their hooks unconditional", () => {
	const transcript = source(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	// The parse and the answer hook are declared with the other hooks, above every
	// early return; a branch that skipped them would be a hook-order bug.
	const hookAt = transcript.indexOf(
		"const revertAnswer = useProfileRevertAnswer();",
	);
	const firstReturn = transcript.indexOf("if (flagged !== null");
	assert.ok(
		hookAt > 0 && firstReturn > hookAt,
		"hook declared before the first branch",
	);
	assert.match(transcript, /if \(profileCall\) \{/);
	assert.match(transcript, /approvalEpoch=\{frontend\?\.epoch \?\? null\}/);
});
