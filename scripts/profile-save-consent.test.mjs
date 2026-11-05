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
			export { createProfileRevertLatch } from "./src/renderer/src/features/chat/canonical/profile-revert-latch";
			export {
				readProfileRevertStatus,
				profileRevertStatusCache,
				profileRevertPressAllowed,
				profileRevertAuthority,
				profileRevertStatusSchema,
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

test("a payload's revert_verified flag is evidence, never the authority to press", () => {
	/*
	 * R2: a persisted tool output can be replayed by a reload, a restored transcript
	 * or an agent that wrote it. The parser therefore reports the descriptor and the
	 * flag separately, and its own view is UNAVAILABLE — only the surface, which
	 * knows the running backend and the gate identity, may raise it.
	 */
	const flagged = callOf({
		disclosure: disclosure(),
		state: "applied",
		revert: revertDescriptor,
		revert_verified: true,
	});
	assert.ok(flagged?.descriptor, "the descriptor is still reported");
	assert.equal(flagged.revertVerifiedByProducer, true);
	assert.equal(flagged.view.revert.state, "unavailable");
	assert.equal(flagged.view.revert.enabled, false);

	const unflagged = callOf({
		disclosure: disclosure(),
		revert: revertDescriptor,
	});
	assert.ok(unflagged?.descriptor);
	assert.equal(flagged.revertVerifiedByProducer !== undefined, true);
	assert.equal(unflagged.revertVerifiedByProducer, false);
	assert.equal(unflagged.view.revert.state, "unavailable");

	// A string "yes" is not a boolean claim.
	assert.equal(
		callOf({
			disclosure: disclosure(),
			revert: revertDescriptor,
			revert_verified: "yes",
		})?.revertVerifiedByProducer,
		false,
	);

	// The authority itself lives in the transcript: pinned where it is decided.
	const transcript = source(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	assert.match(
		transcript,
		/const revertStatus = useProfileRevertStatus\(/,
		"the live status seam is read",
	);
	assert.doesNotMatch(
		transcript,
		/revertRegistered/,
		"no second authority survives beside the seam",
	);
	assert.match(transcript, /namesThisRecord/);
	assert.match(transcript, /scope\?\.sessionId &&[\s\S]{0,40}approvalEpoch/);
});

test("an uncertain outcome is unconfirmed and never re-enables; a stale refusal is stale", () => {
	/*
	 * R3/Q1, reproduced against the shipped resolver: the old code painted "The
	 * revert did not go through" and re-offered the control for a send that may
	 * have landed.
	 */
	const uncertain = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "unconfirmed" },
	});
	assert.equal(uncertain.state, "unconfirmed");
	assert.equal(uncertain.enabled, false);
	assert.notEqual(uncertain.note, null);
	assert.match(uncertain.note, /may not have gone through/i);

	const stale = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false, state: "expired" },
	});
	assert.equal(stale.state, "stale");
	assert.equal(stale.enabled, false);

	// A genuine refusal that is NOT about the window is the failed state, and only
	// that one re-offers the press.
	const refused = api.profileRevertView(revertDescriptor, {
		outcome: { approved: false },
	});
	assert.equal(refused.state, "failed");
	assert.equal(refused.enabled, true);
});

test("two presses in the same batch dispatch one answer", () => {
	/*
	 * QA Q2: React state only guards after a re-render, so two same-batch presses
	 * both read the pre-render value and both sent an identical answer. The latch is
	 * written synchronously, before the request is built.
	 */
	const latch = api.createProfileRevertLatch();
	assert.equal(
		latch.claim("ra_5b81"),
		true,
		"the first press claims the action",
	);
	assert.equal(
		latch.claim("ra_5b81"),
		false,
		"the second press in the same batch does not",
	);
	assert.equal(latch.has("ra_5b81"), true);
	assert.equal(
		latch.claim("ra_other"),
		true,
		"a different action is its own claim",
	);
	assert.equal(latch.claim(""), false, "an empty action id is never claimed");

	const hook = source(
		"src/renderer/src/features/chat/canonical/use-profile-revert.ts",
	);
	const hookAt = hook.indexOf("profileRevertLatch.claim(descriptor.action_id)");
	const dispatchAt = hook.indexOf("void desktopResult({");
	assert.ok(hookAt > 0, "the hook claims through the latch");
	assert.ok(
		dispatchAt > hookAt,
		"the claim is taken before the request is built",
	);
	const authorityAt = hook.indexOf('status?.status !== "available"');
	assert.ok(
		authorityAt > 0 && authorityAt < hookAt,
		"no authority sends nothing at all",
	);
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

	// The same receipt WITHOUT lines still does not claim the diff is empty.
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
	/*
	 * Parent's policy-visibility rule: effort/tools/class/delegate live inside the
	 * `tags` image, so the readable sentence must come from the backend's `diff`
	 * lines. The renderer must not parse tag strings to describe a permission
	 * change, and must not reduce a policy change to a bare 'tags' row when the
	 * backend authored lines.
	 */
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
	// No before/after row is invented for a receipt, and no row re-states 'tags' as
	// if the change were cosmetic: the backend's own lines are the body.
	assert.deepEqual(call.view.fields, []);
	assert.deepEqual(call.view.diffLines, diff);
	assert.deepEqual(call.view.changedFieldNames, ["tags"]);
	assert.equal(call.view.state, "saved");
	// The renderer holds no second policy vocabulary: the card module never reads a
	// tag string to describe a class/effort/tools change.
	const card = source(
		"src/renderer/src/features/mesh/profile-consent-card.tsx",
	);
	assert.doesNotMatch(card, /split\(":"\)|startsWith\("class"\)|parseTags/);
});

test("a replayed legacy descriptor never produces a revert control", () => {
	// The old tool answer carries `revert: {action_id?...}`-less legacy shapes; the
	// one the backend actually wrote was `{profile_revert: {schema, kind, ...}}`
	// replaced later by `{revert_id, ...}`. Whatever a persisted output claims, a
	// verified descriptor is what the shared strict schema demands.
	for (const replayed of [
		{ action_id: "ra_5b81" },
		{ revert_id: "ra_5b81", label: "Revert" },
		{ revert_id: "ra_5b81", label: "Revert", profile_name: "Researcher" },
		{ action_id: "ra_5b81", label: "Revert", profile_kind: "agent" },
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
				revert: replayed,
			},
		});
		assert.ok(call, "the record still renders");
		assert.equal(call.descriptor, null, JSON.stringify(replayed));
		assert.equal(call.view.revert.enabled, false);
		assert.equal(call.view.revert.descriptor, null);
	}
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

test("a verified descriptor with no gate identity is disabled with a reason", () => {
	const transcript = source(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	// The arm that must never exist: a disabled control whose note is null.
	assert.match(transcript, /const pressable = Boolean\(/);
	assert.match(transcript, /: profileRevertUnavailable\(\)/);
	assert.match(transcript, /pressable && descriptor/);
});

/* ------------------------------------------- the live status seam (R2) */

const identity = {
	action_id: "ra_5b81",
	receipt_id: "rc_71bd",
	profile_kind: "agent",
	profile_name: "Researcher",
};

test("the status seam answers unavailable until core ships the read", async () => {
	const answer = await api.readProfileRevertStatus(identity);
	assert.equal(answer.status, "unavailable");
	assert.equal(answer.reason, api.PROFILE_REVERT_STATUS_UNVERIFIABLE);
	// Closed on both sides: a malformed identity is refused by name, never guessed.
	for (const bad of [
		{ ...identity, action_id: "../other" },
		{ ...identity, action_id: "" },
		{ ...identity, profile_kind: "machine" },
		{ ...identity, extra: true },
	]) {
		const refused = await api.readProfileRevertStatus(bad);
		assert.equal(refused.status, "unavailable", JSON.stringify(bad));
	}
	// The seam invents no route: no path or op name appears in the module.
	const seam = source(
		"src/renderer/src/features/chat/canonical/profile-revert-status.ts",
	);
	assert.doesNotMatch(seam, /\/v1\/desktop|op:\s*"|fetch\(/);
	assert.match(seam, /TODO\(profile-revert-status contract point\)/);
});

test("only a live available answer permits a press; nothing else does", () => {
	for (const [status, state, enabled] of [
		["available", "available", true],
		["pending", "pending", false],
		["succeeded", "saved", false],
		["stale", "stale", false],
		["failed", "failed", false],
		["unavailable", "unavailable", false],
	]) {
		const resolved = api.profileRevertAuthority({ status });
		assert.deepEqual(resolved, { state, enabled }, status);
		assert.equal(
			api.profileRevertPressAllowed({ status }),
			status === "available",
		);
		// The payload's own flags cannot reach this decision: it takes the answer.
		assert.equal(api.profileRevertAuthority(null).enabled, false);
	}
	// An uncertain activation is PENDING, never failed-and-enabled.
	assert.deepEqual(api.profileRevertAuthority({ status: "pending" }), {
		state: "pending",
		enabled: false,
	});
});

test("a cached completion makes a duplicate press write nothing", () => {
	api.profileRevertStatusCache.clear();
	assert.equal(api.profileRevertStatusCache.read("ra_5b81"), null);
	api.profileRevertStatusCache.remember("ra_5b81", { status: "succeeded" });
	const cached = api.profileRevertStatusCache.read("ra_5b81");
	assert.equal(cached?.status, "succeeded");
	// The press's own guard: a remembered answer stops the write before it is built.
	assert.equal(api.profileRevertPressAllowed(cached), false);
	const hook = source(
		"src/renderer/src/features/chat/canonical/use-profile-revert.ts",
	);
	assert.match(
		hook,
		/if \(profileRevertStatusCache\.read\(descriptor\.action_id\)\) return;/,
	);
	// And an unreadable answer is not remembered as a fact.
	api.profileRevertStatusCache.remember("ra_5b81", { status: "nonsense" });
	assert.equal(
		api.profileRevertStatusCache.read("ra_5b81")?.status,
		"succeeded",
	);
	// The hook records an in-flight press as pending, and an uncertain failure is
	// NOT remembered as a completion.
	assert.match(
		hook,
		/profileRevertStatusCache\.remember\(descriptor\.action_id, \{\s*status: "pending"/,
	);
	assert.match(hook, /if \(state === "stale"\)/);
	api.profileRevertStatusCache.clear();
});
