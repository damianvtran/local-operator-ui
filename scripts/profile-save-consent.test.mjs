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
			export * from "./src/renderer/src/features/mesh/profile-action-golden";
			export { profileSaveCall } from "./src/renderer/src/features/chat/components/trace/profile-save-card-model";
			export { createProfileRevertLatch } from "./src/renderer/src/features/chat/canonical/profile-revert-latch";
			export {
				readProfileRevertStatus,
				runProfileRevertPress,
				profileRevertOutcome,
				profileRevertStatusCache,
				profileRevertPressAllowed,
				profileRevertAuthority,
				profileRevertStatusSchema,
				readProfileRevertStatusFromTransport,
				PROFILE_REVERT_STATUS_UNVERIFIABLE,
			} from "./src/renderer/src/features/chat/canonical/profile-revert-status";
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
	action_id: "prv_abcdefghijklmnopqrstuvwxyz012345",
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

test("the descriptor is the backend's exact shape, and legacy hints are not it", () => {
	const ok = api.profileRevertDescriptor({
		schema: 1,
		kind: "profile_revert",
		action_id: revertDescriptor.action_id,
		label: "Revert",
		profile_kind: "agent",
		profile_name: "Researcher",
		receipt_id: "rc_71bd",
	});
	assert.ok(ok);
	// A prefix and EXACTLY 32 URL-safe characters: a legacy short id is refused.
	for (const bad of [
		{ ...revertDescriptor, action_id: "ra_5b81" },
		{ ...revertDescriptor, action_id: "prv_short" },
		// A same-length tail behind a different prefix is not the frozen mint.
		{ ...revertDescriptor, action_id: "xyz_abcdefghijklmnopqrstuvwxyz012345" },
		{ ...revertDescriptor, action_id: "ap_abcdefghijklmnopqrstuvwxyz012345" },
		{ ...revertDescriptor, action_id: "rv_abcdefghijklmnopqrstuvwxyz012345" },
		// A tail one character short or long is an id core never mints.
		{ ...revertDescriptor, action_id: "prv_abcdefghijklmnopqrstuvwxyz01234" },
		{ ...revertDescriptor, action_id: "prv_abcdefghijklmnopqrstuvwxyz0123456" },
		{ ...revertDescriptor, schema: 2 },
		{ ...revertDescriptor, kind: "revert" },
		{ ...revertDescriptor, extra: true },
		// The legacy text hint an old applied card carries is NOT a descriptor.
		{ op: "revert", backup_id: "bk_1" },
	]) {
		assert.equal(api.profileRevertDescriptor(bad), null, JSON.stringify(bad));
	}
});

test("the state machine: offered, latched, settled, stale, failed, unconfirmed", () => {
	const base = { descriptor: revertDescriptor, descriptorVerified: true };
	assert.deepEqual(api.profileRevertState(base), {
		state: "available",
		enabled: true,
	});
	// Unverified or malformed descriptors offer nothing at all.
	assert.equal(
		api.profileRevertState({ ...base, descriptorVerified: false }).enabled,
		false,
	);
	assert.equal(
		api.profileRevertState({
			...base,
			descriptor: { ...revertDescriptor, label: "" },
		}).state,
		"unavailable",
	);
	// In flight, then settled, then a spent action id.
	assert.deepEqual(api.profileRevertState({ ...base, submitted: true }), {
		state: "pending",
		enabled: false,
	});
	assert.deepEqual(api.profileRevertState({ ...base, alreadyAnswered: true }), {
		state: "saved",
		enabled: false,
	});
	// An uncertain send is its own state and never re-enables.
	const uncertain = api.profileRevertState({
		...base,
		outcome: { approved: false, state: "unconfirmed" },
	});
	assert.deepEqual(uncertain, { state: "unconfirmed", enabled: false });
	// A refusal that positively names the window is stale.
	assert.equal(
		api.profileRevertState({
			...base,
			outcome: { approved: false, state: "expired" },
		}).state,
		"stale",
	);
	/*
	 * A refusal is failed AND DISABLED (QA Q2.1). It used to stay enabled, which is
	 * the arm that let a reader press a duplicate revert the instant the backend
	 * refused one; a known end is not an invitation.
	 */
	assert.deepEqual(
		api.profileRevertState({ ...base, outcome: { approved: false } }),
		{ state: "failed", enabled: false },
	);
});

test("the revert answer is the gate answer, with no remember field", () => {
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
			requestId: revertDescriptor.action_id,
			approved: true,
		},
	);
	// Nothing is answered from a state that is not offered, or with no session.
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
			descriptor: revertDescriptor,
			sessionId: null,
			state: "available",
		}),
		null,
	);
});

test("an absent descriptor is the kill-switch: the control has no view of its own", () => {
	const unavailable = api.profileRevertView(null);
	assert.equal(unavailable.state, "unavailable");
	assert.equal(unavailable.enabled, false);
	assert.equal(unavailable.descriptor, null);
	assert.ok(unavailable.note, "the reason must be stated, not implied");
	assert.deepEqual(api.profileRevertView(null), unavailable);
	assert.equal(api.profileRevertUnavailable().enabled, false);
	assert.ok(api.profileRevertUnavailable().note);
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
		{ profileApprovals: true, canRetryApply: true },
	);
	assert.equal(approved.state, "approved_not_saved");
	const saved = api.profileCardView(
		row({ profile: typedBlock(), state: "connected" }),
		{ profileApprovals: true },
	);
	assert.equal(saved.state, "saved");
});

/* ------------------------------------------------------- the surfaces */

const source = (path) => readFileSync(path, "utf8");

const PROFILE_CARD_RENDER = /<ProfileConsentCard view=\{profile\} \/>/;
const PROFILE_CAPABILITY = /profileApprovals=\{profileApprovals\}/;
const PROFILE_FEATURE_KEY = /"profile_approvals"/;
const NO_TAG_PARSING = /split\(":"\)|startsWith\("class"\)|parseTags/;
const CARD_COLUMN_BEFORE = /profile_column_before/;
const CARD_COLUMN_AFTER = /profile_column_after/;
const CARD_OLD_COLUMNS = /profile_saved_value|profile_new_value/;
const CARD_REASON_DESCRIBED =
	/aria-describedby=\{revertReason \? revertNoteId : undefined\}/;
const CARD_REASON_TEXT = /\{revertReason\}/;
const CARD_NO_HANDLER_KEY = /profile_revert_no_handler/;
const CARD_UNKNOWN_REASON_KEY = /profile_revert_reason_unknown/;
/*
 * The control renders ONLY when the view carries one (review R2.4): no descriptor
 * means no Revert at all, not a disabled one. The internal gates stay tested by the
 * reason/no-handler cases above.
 */
const CARD_CLUSTER = /\{revert && \(/;
const CARD_NO_TITLE_REASON = /title=\{revert/;
const SEAM_READ = /const revertStatus = useProfileRevertStatus\(/;
const NO_SECOND_AUTHORITY = /revertRegistered/;
const SEAM_NESTED = /profile_action/;
const SEAM_CALL = /sessions\.profileActionStatus/;
const SEAM_TODO_LIVE = /NO LIVE CLAIM/;
const TRAY_PROFILE_VIEW = /const profile =[\s\S]{0,200}profileCardView\(row/;
const CARD_DISABLED = /disabled=\{revertDisabled\}/;
const CONTRACT_STATUS_ROUTE = /profile-action-status/;
const CONTRACT_TOOL_CALL = /tool_call_id: request\.toolCallId/;
const NO_SESSION_IN_BODY = /session_id/;

test("the inbox renders the profile card for a profile row and passes the capability", () => {
	const tray = source("src/renderer/src/features/mesh/mesh-approvals-tray.tsx");
	assert.match(tray, TRAY_PROFILE_VIEW);
	assert.match(tray, PROFILE_CARD_RENDER);
	assert.match(tray, PROFILE_CAPABILITY);
	const page = source("src/renderer/src/features/mesh/mesh-page.tsx");
	assert.match(page, PROFILE_FEATURE_KEY);
});

test("the card draws no revert control without a descriptor or a reason", () => {
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	assert.match(card, CARD_CLUSTER);
	assert.match(card, CARD_DISABLED);
	assert.match(card, CARD_REASON_DESCRIBED);
});

test("a disabled revert always carries a reason, never a blank control", () => {
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	assert.match(card, CARD_REASON_DESCRIBED);
	assert.match(card, CARD_REASON_TEXT);
	assert.match(card, CARD_NO_HANDLER_KEY);
	assert.match(card, CARD_UNKNOWN_REASON_KEY);
	assert.doesNotMatch(card, CARD_NO_TITLE_REASON);
});

/* --------------------------------------------- the transcript saved card */

const toolOutput = (value) =>
	typeof value === "string" ? value : JSON.stringify(value);

const callOf = (value, toolName = "profile_save", details = null) =>
	api.profileSaveCall({
		toolName,
		output: toolOutput(value),
		details,
	});

test("a transcript answer this build cannot bound keeps today's row", () => {
	assert.equal(callOf("Saved the profile."), null);
	assert.equal(callOf(""), null);
	assert.equal(callOf("{ not json"), null);
	assert.equal(callOf({ hello: "world" }), null);
	assert.equal(callOf(disclosure({ extra_field: "surprise" })), null);
	assert.equal(callOf({ disclosure: disclosure(), surprise: true }), null);
	assert.equal(callOf(disclosure(), "bash"), null);
});

test("the saved card states the profile, the scope, the operation and the diff", () => {
	const call = callOf({ disclosure: disclosure(), state: "applied" });
	assert.ok(call);
	assert.equal(call.view.name, "Researcher");
	assert.equal(call.view.state, "saved");
	assert.deepEqual(
		call.view.fields.map((entry) => entry.field),
		["model", "instructions"],
	);
	assert.equal(call.descriptor, null);
	assert.equal(call.view.revert.state, "unavailable");
});

test("a persisted revert_verified flag is evidence, never the authority to press", () => {
	const flagged = callOf({
		disclosure: disclosure(),
		state: "applied",
		profile_action: revertDescriptor,
		revert_verified: true,
	});
	assert.ok(flagged?.descriptor, "the descriptor is still reported");
	assert.equal(flagged.revertVerifiedByProducer, true);
	// The card's own view is UNAVAILABLE: only the live status read may raise it.
	assert.equal(flagged.view.revert.state, "unavailable");
	assert.equal(flagged.view.revert.enabled, false);

	const unflagged = callOf({
		disclosure: disclosure(),
		profile_action: revertDescriptor,
	});
	assert.equal(unflagged?.revertVerifiedByProducer, false);
	assert.equal(unflagged?.view.revert.state, "unavailable");

	const transcript = source(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	assert.match(transcript, SEAM_READ, "the live status seam is read");
	assert.doesNotMatch(transcript, NO_SECOND_AUTHORITY);
	assert.match(
		source(
			"src/renderer/src/features/chat/components/trace/profile-save-card-model.ts",
		),
		SEAM_NESTED,
	);
});

test("a replayed legacy revert hint never produces a revert control", () => {
	for (const replayed of [
		{ op: "revert", backup_id: "bk_1" },
		{ action_id: "ra_5b81" },
		{ schema: 1, kind: "profile_revert" },
	]) {
		const call = api.profileSaveCall({
			toolName: "profile_save",
			output: "",
			details: {
				status: "applied",
				profile_kind: "agent",
				profile_name: "Researcher",
				scope: "global",
				fields: ["model"],
				diff: ["Model: a → b"],
				/* The legacy home: still parsed as a record, never as a descriptor. */
				revert: replayed,
			},
		});
		assert.ok(call, "the record still renders");
		assert.equal(call.descriptor, null, JSON.stringify(replayed));
		/*
		 * R2.4: no descriptor means NO control. A greyed-out Revert beside a legacy
		 * text hint was a control the record could never honour.
		 */
		assert.equal(call.view.revert, undefined, JSON.stringify(replayed));
	}
});

/* ---------------------------------------------------- the receipt's diff */

test("a queued receipt WITH a diff renders the backend's lines, and never 'no changes'", () => {
	const details = {
		status: "queued",
		fields: ["model", "instructions"],
		diff: [
			"Model: anthropic/claude-sonnet-5 → anthropic/claude-opus-5-5",
			"Instructions: 1 line added",
		],
		approval_id: "ap_dem1234",
		request_digest: requestDigest,
		expires_at: 1_900_000_000,
		receipt_id: "rc_71bd",
		profile_kind: "agent",
		profile_name: "Researcher",
		scope: "global",
	};
	const call = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details,
	});
	assert.ok(call, "a receipt in details is a bound answer");
	assert.deepEqual(call.view.diffLines, details.diff);
	assert.deepEqual(call.view.changedFieldNames, ["model", "instructions"]);
	assert.equal(call.view.changesIncluded, true);
	assert.deepEqual(call.view.fields, []);
	assert.equal(call.view.state, "waiting");

	const bare = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: { ...details, fields: undefined, diff: undefined },
	});
	assert.ok(bare);
	assert.equal(bare.view.changesIncluded, false);
	assert.equal(bare.view.diffLines.length, 0);
});

test("a policy-only change is stated in the backend's own words, not re-derived here", () => {
	const diff = [
		"Capabilities: class standard → elevated",
		"Effort: med → hi",
		"Tools: +web, -shell",
		"Delegate: off → on",
	];
	const call = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: {
			status: "applied",
			profile_kind: "agent",
			profile_name: "Researcher",
			scope: "global",
			fields: ["tags"],
			diff,
		},
	});
	assert.ok(call);
	assert.deepEqual(call.view.fields, []);
	assert.deepEqual(call.view.diffLines, diff);
	assert.deepEqual(call.view.changedFieldNames, ["tags"]);
	assert.equal(call.view.state, "saved");
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	assert.doesNotMatch(card, NO_TAG_PARSING);
});

/* ------------------------------------------- the live status seam (R2) */

const identity = {
	action_id: revertDescriptor.action_id,
	receipt_id: "rc_71bd",
	profile_kind: "agent",
	profile_name: "Researcher",
	tool_call_id: "tc_4a1b",
};

const statusAnswer = (state) => ({ action_id: identity.action_id, state });

test("the status read is fail-closed: only a clean answer for THIS action counts", async () => {
	// A fresh available answer, for this action, is the one thing that enables.
	assert.deepEqual(
		await api.readProfileRevertStatus("s_9f2c", identity, async () =>
			statusAnswer("available"),
		),
		statusAnswer("available"),
	);
	// Every other shape is a refusal: extra fields, an unknown state, another id,
	// a throwing transport, a malformed identity, and no session at all.
	for (const payload of [
		{ ...statusAnswer("available"), extra: true },
		{ action_id: identity.action_id, state: "granted" },
		{ action_id: "rv_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", state: "available" },
		{ action_id: identity.action_id },
	]) {
		assert.equal(
			(
				await api.readProfileRevertStatus(
					"s_9f2c",
					identity,
					async () => payload,
				)
			).state,
			"unavailable",
			JSON.stringify(payload),
		);
	}
	assert.equal(
		(
			await api.readProfileRevertStatus("s_9f2c", identity, async () => {
				throw new Error("dropped");
			})
		).state,
		"unavailable",
	);
	for (const bad of [
		{ ...identity, action_id: "../other" },
		{ ...identity, tool_call_id: "" },
		{ ...identity, profile_kind: "machine" },
		{ ...identity, extra: true },
	]) {
		assert.equal(
			(
				await api.readProfileRevertStatus("s_9f2c", bad, async () =>
					statusAnswer("available"),
				)
			).state,
			"unavailable",
			JSON.stringify(bad),
		);
	}
	assert.equal(
		(
			await api.readProfileRevertStatus(null, identity, async () =>
				statusAnswer("available"),
			)
		).state,
		"unavailable",
	);
});

test("only a live available answer permits a press; each state renders its own", () => {
	for (const [state, expected, enabled] of [
		["available", "available", true],
		["pending", "pending", false],
		["succeeded", "saved", false],
		["stale", "stale", false],
		["failed", "failed", false],
		["unavailable", "unavailable", false],
	]) {
		const answer = statusAnswer(state);
		assert.deepEqual(
			api.profileRevertAuthority(answer),
			{ state: expected, enabled },
			state,
		);
		assert.equal(api.profileRevertPressAllowed(answer), state === "available");
	}
	assert.equal(api.profileRevertAuthority(null).enabled, false);
});

test("a press writes once, and a cached completion writes nothing at all", async () => {
	api.profileRevertStatusCache.clear();
	const writes = [];
	const write = async (request) => {
		writes.push(request);
		return {};
	};
	const available = statusAnswer("available");
	/*
	 * R2.1: a press reads the live status BEFORE it writes (authority may have
	 * expired) and once more after (to learn what happened); the second answer is
	 * what the card shows.
	 */
	const sequence = (states) => {
		const seen = [];
		let reads = 0;
		return {
			seen,
			read: async () => {
				const next = states[reads] ?? "pending";
				reads += 1;
				seen.push("read");
				return statusAnswer(next);
			},
		};
	};
	const first = sequence(["available", "succeeded"]);
	const done = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: available,
		identity,
		write: async (request) => {
			first.seen.push("write");
			writes.push(request);
			return {};
		},
		readStatus: first.read,
	});
	assert.equal(writes.length, 1);
	assert.deepEqual(
		first.seen,
		["read", "write", "read"],
		"one read authorises the write, one read reports its outcome",
	);
	assert.equal(done.state, "succeeded");

	// A second press on the cached completion: still one write in total.
	const again = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: available,
		identity,
		write,
		readStatus: async () => statusAnswer("succeeded"),
	});
	assert.equal(writes.length, 1, "a completed action writes nothing again");
	assert.equal(again.state, "succeeded");

	// No live permission: no write.
	api.profileRevertStatusCache.clear();
	writes.length = 0;
	await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: null,
		identity,
		write,
		readStatus: async () => statusAnswer("succeeded"),
	});
	assert.equal(writes.length, 0, "no status, no write");
	api.profileRevertStatusCache.clear();
});

test("a dropped activation stays pending and reconciles with a fresh read", async () => {
	api.profileRevertStatusCache.clear();
	let reads = 0;
	const answer = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: statusAnswer("available"),
		identity,
		write: async () => {
			throw new Error("timeout");
		},
		readStatus: async () => {
			reads += 1;
			// The write is authorised by the first read and contradicted by the
			// second: the activation landed nowhere we can see.
			return statusAnswer(reads === 1 ? "available" : "pending");
		},
	});
	assert.equal(
		reads,
		2,
		"one read authorises, the second reconciles the uncertain answer",
	);
	assert.equal(answer.state, "pending");
	// Never failed, and the control is not re-offered.
	assert.deepEqual(api.profileRevertAuthority(answer), {
		state: "pending",
		enabled: false,
	});

	// A read that cannot answer leaves it pending too, not failed.
	api.profileRevertStatusCache.clear();
	const unreconciled = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: statusAnswer("available"),
		identity,
		write: async () => {
			throw new Error("timeout");
		},
		readStatus: (() => {
			let n = 0;
			return async () => {
				n += 1;
				if (n === 1) return statusAnswer("available");
				throw new Error("dropped");
			};
		})(),
	});
	assert.equal(unreconciled.state, "pending");
	api.profileRevertStatusCache.clear();
});

test("the app's own transport call is the allowlisted, session-scoped op", () => {
	const contract = source("src/shared/desktop-contract.ts");
	assert.match(contract, SEAM_CALL);
	assert.match(contract, CONTRACT_STATUS_ROUTE);
	assert.match(contract, CONTRACT_TOOL_CALL);
	// The session comes from the transport, never from this op's body.
	const opBlock = contract.slice(
		contract.indexOf('case "sessions.profileActionStatus"'),
		contract.indexOf('case "sessions.answer"'),
	);
	assert.ok(opBlock.length > 0);
	assert.doesNotMatch(opBlock, NO_SESSION_IN_BODY);
	const seam = source(
		"src/renderer/src/features/chat/canonical/profile-revert-status.ts",
	);
	assert.match(seam, SEAM_TODO_LIVE);
	assert.match(seam, /sessions\.profileActionStatus/);
});

/* --------------------------------- outcomes, columns and disabled reasons */

test("every lifecycle state states its outcome in words, and only saved says saved", () => {
	const rows = {
		waiting: "requested",
		approved_not_saved: "approved",
		saved: "connected",
		denied: "denied",
		expired: "expired",
		stopped: "failed",
	};
	for (const [expected, store] of Object.entries(rows)) {
		const view = api.profileCardView(
			row({ profile: typedBlock(), state: store }),
			{ profileApprovals: true },
		);
		assert.equal(view.state, expected, store);
		assert.ok(view.stateNote, `every state carries a sentence: ${expected}`);
		if (expected !== "saved")
			assert.notEqual(view.stateNote, "Saved", expected);
	}
	const unknown = api.profileCardView(
		row({ profile: typedBlock(), state: "weird" }),
		{ profileApprovals: true },
	);
	assert.equal(unknown.state, "unknown");
	assert.ok(unknown.stateNote);
});

test("the diff's columns are a neutral comparison, and the outcome is separate", () => {
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	assert.match(card, CARD_COLUMN_BEFORE);
	assert.match(card, CARD_COLUMN_AFTER);
	assert.doesNotMatch(card, CARD_OLD_COLUMNS);
	for (const loc of ["en", "fr", "es", "zh-CN", "ru", "vi", "ur", "hi"]) {
		const catalogue = JSON.parse(
			source(`src/i18n/catalogues/${loc}/ui.mesh.json`),
		);
		assert.equal(
			catalogue["ui.mesh.mesh_approvals.profile_saved_value"],
			undefined,
			loc,
		);
		assert.equal(
			catalogue["ui.mesh.mesh_approvals.profile_new_value"],
			undefined,
			loc,
		);
		assert.ok(catalogue["ui.mesh.mesh_approvals.profile_column_before"], loc);
		assert.ok(catalogue["ui.mesh.mesh_approvals.profile_column_after"], loc);
		for (const state of [
			"waiting",
			"saved",
			"approved_not_saved",
			"denied",
			"expired",
			"stopped",
			"unknown",
		])
			assert.ok(
				catalogue[`ui.mesh.mesh_approvals.profile_outcome_${state}`],
				`${loc}/${state}`,
			);
	}
});

test("the roster diff moves whenever an authored member field moves", () => {
	const team = (members) => ({
		id: "tm_launch",
		name: "Launch team",
		label: "Launch",
		description: "Carries a launch to its release gate.",
		manager: "Researcher",
		members,
		aliases: ["launch-crew"],
		instructions: "Follow the release runbook.",
		project: "Launch",
	});
	const rosterFrom = (beforeMember, afterMember) =>
		api.profileFieldRows(
			api.profileDisclosure(
				disclosure({
					profile_kind: "team",
					changed_fields: ["members"],
					before: team([beforeMember]),
					after: team([afterMember]),
				}),
			),
		);
	const roster = (member) => rosterFrom({ role: "reviewer", count: 2 }, member);
	for (const member of [
		{ role: "reviewer", count: 3 },
		{ role: "reviewer", count: 2, kind: "team" },
		{ role: "reviewer", count: 2, tier: "hi" },
		{ role: "reviewer", count: 2, effort: "auto" },
		{ role: "auditor", count: 2 },
		{ role: "reviewer", count: 2, saver: true },
	]) {
		const rows = roster(member);
		assert.equal(
			rows.length,
			1,
			`${JSON.stringify(member)} must produce a row`,
		);
		assert.equal(rows[0].field, "members");
		assert.notEqual(
			rows[0].before.text,
			rows[0].after.text,
			`${JSON.stringify(member)} must move the text`,
		);
	}
	// An omitted count IS the model's default of one, so it is not a change beside
	// an explicit 1 in either direction.
	assert.deepEqual(
		rosterFrom({ role: "reviewer" }, { role: "reviewer", count: 1 }),
		[],
	);
});

/* ------------------------------- the golden wire artifact, and round-2 gates */

test("the golden artifact is the one vendored here, and a real row still binds", () => {
	/*
	 * FIXTURE PARITY (parent acceptance): a fixture that stops matching the shipped
	 * parser, or drifts from the exported artifact, fails HERE rather than in a story
	 * nobody reran. The provenance is asserted so a re-vendored artifact is a
	 * deliberate, visible change.
	 */
	assert.equal(
		api.PROFILE_ACTION_GOLDEN_META.source_sha,
		"b4f879399b577764de1939e955457d71aecbe1b9",
	);
	const row = api.GOLDEN_APPROVAL_ROWS[0];
	const typed = api.profileTypedApproval(row.typed_approval);
	assert.ok(typed, "the real typed block must parse");
	/*
	 * THE LEGACY LABEL IS WHAT THE DAEMON SENDS (`desktop_approval.py:382`); the
	 * operation is the selector. Keying on the label refused every real row.
	 */
	assert.equal(typed.action, "approve-credential");
	assert.equal(
		typed.disclosure.profile_name,
		row.typed_approval.disclosure.profile_name,
	);

	const parsed = api.approvalRows({ approvals: [row] });
	assert.equal(parsed.length, 1);
	assert.equal(
		parsed[0].kind,
		"profile",
		"a real row must recognise as a profile row",
	);
	const view = api.profileCardView(parsed[0], {
		profileApprovals: true,
		canApprove: true,
	});
	assert.ok(view.fields.length > 0, "the positive card renders its field rows");
	assert.equal(view.name, row.typed_approval.disclosure.profile_name);
	assert.equal(view.unavailableReason, null);
});

test("a saved ToolResult renders the saved card with its diff and a disabled revert", () => {
	const saved = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: api.GOLDEN_SAVED_AGENT_TOOL_RESULT.details,
	});
	assert.ok(saved, "the real applied details must parse");
	assert.equal(saved.state, "saved");
	assert.equal(saved.view.state, "saved");
	assert.ok(saved.view.diffLines.length > 0, "the backend's diff lines render");
	assert.equal(saved.view.changesIncluded, true);
	assert.equal(saved.descriptor.profile_kind, "agent");
	// A descriptor alone never enables the control: only a live `available` may.
	assert.equal(saved.view.revert.state, "unavailable");
	assert.equal(saved.view.revert.enabled, false);

	const team = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: api.GOLDEN_SAVED_TEAM_TOOL_RESULT.details,
	});
	assert.equal(team.descriptor.profile_kind, "team");
	assert.equal(team.view.state, "saved");
});

test("a queued receipt renders the backend's own lines, not an invented diff", () => {
	const queued = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: api.GOLDEN_QUEUED_TOOL_RESULT.details,
	});
	assert.ok(queued, "the real queued details must parse");
	assert.equal(queued.view.state, "waiting");
	assert.deepEqual(
		queued.view.diffLines,
		api.GOLDEN_QUEUED_TOOL_RESULT.details.diff,
		"verbatim, never re-derived",
	);
	// A queued proposal has nothing to revert and carries no descriptor.
	assert.equal(queued.descriptor, null);
	assert.equal(queued.view.revert, undefined);
});

test("the status answer is read from the real ACK frame, and a string detail is refused", async () => {
	const actionId = api.GOLDEN_LIVE_ACTION_ACK.agent.available.detail.action_id;
	const bound = { ...identity, action_id: actionId, tool_call_id: "tc_4a1b" };
	const answer = await api.readProfileRevertStatus(
		"s_9f2c",
		bound,
		async () => {
			return api.GOLDEN_LIVE_ACTION_ACK.agent.available;
		},
	);
	assert.equal(answer.state, "available");

	// A STRINGIFIED detail is a refusal, never a payload to parse.
	const stringified = await api.readProfileRevertStatus(
		"s_9f2c",
		bound,
		async () => ({
			op: "ack",
			req: 1,
			detail: JSON.stringify(api.GOLDEN_LIVE_ACTION_ACK.agent.available.detail),
		}),
	);
	assert.equal(stringified.state, "unavailable");

	// Extra keys inside `detail` are a refusal, not a richer answer.
	const extended = await api.readProfileRevertStatus(
		"s_9f2c",
		bound,
		async () => ({
			op: "ack",
			req: 1,
			detail: {
				...api.GOLDEN_LIVE_ACTION_ACK.agent.available.detail,
				inverse: "restore",
			},
		}),
	);
	assert.equal(extended.state, "unavailable");

	// An unknown state word refuses.
	const unknown = await api.readProfileRevertStatus(
		"s_9f2c",
		bound,
		async () => ({
			op: "ack",
			req: 1,
			detail: { action_id: actionId, state: "done" },
		}),
	);
	assert.equal(unknown.state, "unavailable");
});

test("the cache is keyed on the whole identity, so no other row inherits authority", () => {
	api.profileRevertStatusCache.clear();
	const available = { action_id: identity.action_id, state: "available" };
	api.profileRevertStatusCache.remember("s_9f2c", identity, available, "read");
	assert.equal(
		api.profileRevertStatusCache.read("s_9f2c", identity)?.state,
		"available",
	);
	// A different session, or a different row's call, gets nothing.
	assert.equal(api.profileRevertStatusCache.read("s_other", identity), null);
	assert.equal(
		api.profileRevertStatusCache.read("s_9f2c", {
			...identity,
			tool_call_id: "tc_other",
		}),
		null,
	);
	assert.equal(
		api.profileRevertStatusCache.read("s_9f2c", {
			...identity,
			receipt_id: "rc_other",
		}),
		null,
	);
	api.profileRevertStatusCache.clear();
});

test("an explicit saver:false is a roster change beside an inherited one", () => {
	const roster = (members) => ({
		id: "tm_launch",
		name: "Launch team",
		label: "Launch",
		description: "Carries a launch to its release gate.",
		manager: "Researcher",
		members,
		aliases: ["launch-crew"],
		instructions: "Follow the release runbook.",
		project: "Launch",
	});
	const disclosureOf = (before, after) =>
		api.profileDisclosure({
			version: 1,
			operation: "profile_save",
			approval_id: "ap_demo1234",
			profile_kind: "team",
			scope: "global",
			profile_operation: "update",
			target_id: "tm_launch",
			profile_name: "Launch team",
			session_id: "s_9f2c",
			tool_call_id: "tc_4a1b",
			receipt_id: "rc_71bd",
			changed_fields: ["members"],
			before,
			after,
			base_commitment: `sha256:${"a".repeat(64)}`,
			after_commitment: `sha256:${"a".repeat(64)}`,
			expires_at: 1_900_000_000,
			signing_principal: "operator-key",
		});
	// Inherited -> explicitly off is a CHANGE, and must produce a row (R2.3).
	const moved = api.profileFieldRows(
		disclosureOf(
			roster([{ role: "reviewer" }]),
			roster([{ role: "reviewer", saver: false }]),
		),
	);
	assert.equal(moved.length, 1, "inherit -> explicit off must produce a row");
	assert.notEqual(moved[0].before.text, moved[0].after.text);
	// Absent and explicit null both inherit, so nothing moved.
	assert.deepEqual(
		api.profileFieldRows(
			disclosureOf(
				roster([{ role: "reviewer" }]),
				roster([{ role: "reviewer", saver: null }]),
			),
		),
		[],
	);
});

test("a present-but-empty diff is not the same fact as an absent one", () => {
	const withEmpty = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: {
			...api.GOLDEN_QUEUED_TOOL_RESULT.details,
			fields: [],
			diff: [],
		},
	});
	assert.equal(withEmpty.view.changesIncluded, true);
	assert.deepEqual(withEmpty.view.diffLines, []);

	const withoutDiff = api.profileSaveCall({
		toolName: "profile_save",
		output: "",
		details: {
			status: "queued",
			profile_kind: "agent",
			profile_name: "Researcher",
			scope: "global",
		},
	});
	assert.equal(withoutDiff.view.changesIncluded, false);
	assert.deepEqual(withoutDiff.view.diffLines, []);
});

test("a cached available is not a completion: the press still writes and re-reads", async () => {
	api.profileRevertStatusCache.clear();
	// The defect (review R2.1 / QA Q2.2): a remembered `available` short-circuited the
	// press to `succeeded` with zero writes and zero reads - a completion it had never
	// performed and could never have known.
	api.profileRevertStatusCache.remember(
		"s_9f2c",
		identity,
		{ action_id: identity.action_id, state: "available" },
		"read",
	);
	let reads = 0;
	const writes = [];
	const answer = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: { action_id: identity.action_id, state: "available" },
		identity,
		write: async (request) => {
			writes.push(request);
			return {};
		},
		readStatus: async () => {
			reads += 1;
			return {
				action_id: identity.action_id,
				state: reads === 1 ? "available" : "succeeded",
			};
		},
	});
	assert.equal(
		writes.length,
		1,
		"a cached available must not suppress the write",
	);
	assert.equal(reads, 2, "one read authorises, one reports the outcome");
	// The outcome is the LIVE answer, never the cache's word.
	assert.equal(answer.state, "succeeded");
	api.profileRevertStatusCache.clear();
});

test("no rendered path shows failed beside an enabled revert", () => {
	// QA Q2.1, at the view the card actually renders.
	const refused = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "failed" },
	});
	assert.equal(refused.state, "failed");
	assert.equal(refused.enabled, false);
	assert.ok(refused.note, "a disabled control still states why");
	// A stale refusal keeps its own state, also disabled.
	const stale = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "stale" },
	});
	assert.equal(stale.state, "stale");
	assert.equal(stale.enabled, false);
});

/* --------------------------------- round 4: "we do not know" and cache provenance */

test("an uncertain activation renders unconfirmed, never 'did not go through'", async () => {
	api.profileRevertStatusCache.clear();
	/*
	 * THE EXACT PATH QA TRACED. A press whose write throws and whose reconcile cannot
	 * answer resolves `pending`; the hook maps that through `profileRevertOutcome`, and
	 * the shipped `profileRevertView` is what the reader sees. It used to say "the
	 * revert did not go through" - a claim nobody can make, because the write may have
	 * landed (QA Q1).
	 */
	const answer = await api.runProfileRevertPress({
		descriptor: revertDescriptor,
		sessionId: "s_9f2c",
		epoch: "e_1",
		status: { action_id: identity.action_id, state: "available" },
		identity,
		write: async () => {
			throw new Error("dropped");
		},
		readStatus: (() => {
			let n = 0;
			return async () => {
				n += 1;
				if (n === 1)
					return { action_id: identity.action_id, state: "available" };
				throw new Error("dropped");
			};
		})(),
	});
	assert.equal(answer.state, "pending");

	const outcome = api.profileRevertOutcome(answer);
	assert.equal(
		outcome.approved,
		false,
		"an uncertain press is not an approval",
	);
	const view = api.profileRevertView(revertDescriptor, { outcome });
	assert.equal(view.state, "unconfirmed");
	assert.equal(view.enabled, false);
	const catalogue = JSON.parse(source("src/i18n/catalogues/en/ui.mesh.json"));
	assert.equal(
		view.note,
		catalogue["ui.mesh.mesh_approvals.profile_revert_unconfirmed"],
		"unknown, in the copy that says unknown",
	);
	assert.notEqual(
		view.note,
		catalogue["ui.mesh.mesh_approvals.profile_revert_failed"],
	);

	// The other spelling of "we do not know" reaches the same state.
	const spelled = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "unconfirmed" },
	});
	assert.equal(spelled.state, "unconfirmed");
	// A DEFIANT refusal stays failed, and says so.
	const failed = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "rejected" },
	});
	assert.equal(failed.state, "failed");
	api.profileRevertStatusCache.clear();
});

test("only a cache entry with read provenance can skip the press", () => {
	api.profileRevertStatusSchema; // keep the import shape explicit
	api.profileRevertStatusCache.clear();
	const succeeded = { action_id: identity.action_id, state: "succeeded" };

	// (a) A completion recorded by anything but a read is NOT evidence: the press
	// must re-read rather than report a completion nobody observed.
	api.profileRevertStatusCache.remember("s_9f2c", identity, succeeded, "press");
	assert.equal(
		api.profileRevertStatusCache.read("s_9f2c", identity)?.state,
		"succeeded",
	);
	assert.equal(
		api.profileRevertStatusCache.readCompletion("s_9f2c", identity),
		null,
		"no read, no completion",
	);

	// (b) A read for this exact identity IS evidence: no second write.
	api.profileRevertStatusCache.remember("s_9f2c", identity, succeeded, "read");
	assert.deepEqual(
		api.profileRevertStatusCache.readCompletion("s_9f2c", identity),
		succeeded,
	);
	// ...but only for this identity.
	assert.equal(
		api.profileRevertStatusCache.readCompletion("s_9f2c", {
			...identity,
			tool_call_id: "tc_other",
		}),
		null,
	);
	api.profileRevertStatusCache.clear();
});
