import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The Team Bridge trial empty state's decisions (teams-trial §9 Lane F).
 *
 * Pins the parts a reviewer has to trust without a renderer: which screen each
 * eligibility answer gets (never a trial for an account already on Teams, never
 * an error for a server without the trial), the paused/active facts, the
 * consent gate on the dialog's button, and the refusal-code mapping. Same house
 * pattern as the other team-bridge tests: esbuild bundles the SHIPPED
 * TypeScript.
 */
async function load(entry) {
	const out = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "neutral",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
}

const model = await load(
	"./src/renderer/src/features/team-bridge-trial/team-bridge-trial-model",
);

const ELIGIBLE = {
	eligible: true,
	reason: null,
	tenant_id: "ten_home",
	tenant_name: "Ada's Organization",
	would_end_at: "2026-12-03T14:05:00Z",
	terms_version: "2026-07-29",
};

test("an eligible account gets the trial, with the server's end date and terms", () => {
	const view = model.trialEmptyView({
		pending: false,
		unavailable: false,
		eligibility: ELIGIBLE,
	});
	assert.deepEqual(view, {
		kind: "eligible",
		tenantId: "ten_home",
		tenantName: "Ada's Organization",
		endsAt: "2026-12-03T14:05:00Z",
		termsVersion: "2026-07-29",
		// Pinned, never the response's: the body cannot steer the Terms link.
		termsUrl: "https://radienthq.com/terms",
	});
});

test("a pending read is a quiet check, not a flash of the old panel", () => {
	assert.equal(
		model.trialEmptyView({
			pending: true,
			unavailable: false,
			eligibility: null,
		}).kind,
		"checking",
	);
});

test("a server or build without the trial leaves the page unchanged", () => {
	assert.equal(
		model.trialEmptyView({
			pending: false,
			unavailable: true,
			eligibility: null,
		}).kind,
		"unchanged",
	);
});

for (const reason of ["already_on_team", "trial_active", "not_available"]) {
	test(`${reason}: no trial and no refusal screen (the page stays as it was)`, () => {
		assert.equal(
			model.trialEmptyView({
				pending: false,
				unavailable: false,
				eligibility: { ...ELIGIBLE, eligible: false, reason },
			}).kind,
			"unchanged",
		);
	});
}

for (const [reason, expected] of [
	["trial_used", "trial_used"],
	["former_subscriber", "former_subscriber"],
	["not_owner", "not_owner"],
	["email_unverified", "email_unverified"],
	["email_disposable", "other"],
	["rate_limited", "other"],
	["a_future_reason", "other"],
]) {
	test(`ineligible ${reason} offers Subscribe, never a trial button`, () => {
		const view = model.trialEmptyView({
			pending: false,
			unavailable: false,
			eligibility: { ...ELIGIBLE, eligible: false, reason },
		});
		assert.equal(view.kind, "ineligible");
		assert.equal(view.reason, expected);
		// Without membership rows only `not_owner` withholds the button.
		assert.equal(view.canSubscribe, expected !== "not_owner");
		assert.equal(
			view.subscribeUrl,
			"https://console.radienthq.com/dashboard/team?tenant=ten_home&src=lop",
		);
	});
}

test("paused only on an ended trial; converted, active and none are not paused", () => {
	const at = "2026-12-03T14:05:00Z";
	assert.equal(
		model.pausedEndedAt({ state: "ended", trial_end: at, ended_at: at }),
		at,
	);
	assert.equal(
		model.pausedEndedAt({ state: "ended", trial_end: at, ended_at: null }),
		at,
	);
	for (const state of ["converted", "active", "none"])
		assert.equal(
			model.pausedEndedAt({ state, trial_end: at, ended_at: at }),
			null,
		);
	assert.equal(model.pausedEndedAt(null), null);
	assert.equal(model.activeUntil({ state: "active", trial_end: at }), at);
	assert.equal(model.activeUntil({ state: "ended", trial_end: at }), null);
});

test("the end date is the full weekday date in the reader's locale and zone", () => {
	const at = "2026-12-03T14:05:00Z";
	// Measured independently: 2026-12-03 is a Thursday (design §5).
	assert.equal(
		model.formatTrialDate(at, "en", "UTC"),
		"Thursday, December 3, 2026",
	);
	assert.equal(model.formatTrialDate(at, "fr", "UTC"), "jeudi 3 décembre 2026");
	// The day it falls on is the reader's: late UTC is already Friday in Tokyo.
	assert.equal(
		model.formatTrialDate("2026-12-03T20:00:00Z", "en", "Asia/Tokyo"),
		"Friday, December 4, 2026",
	);
	assert.equal(model.formatTrialDate("not a date", "en"), null);
	assert.equal(model.formatTrialDate(null, "en"), null);
});

test("the start button needs the Terms ticked, a sendable name and no press in flight", () => {
	const ok = { termsAccepted: true, orgName: "Acme", pending: false };
	assert.equal(model.canStartTrial(ok), true);
	assert.equal(model.canStartTrial({ ...ok, termsAccepted: false }), false);
	assert.equal(model.canStartTrial({ ...ok, pending: true }), false);
	assert.equal(model.canStartTrial({ ...ok, orgName: "x".repeat(81) }), false);
	// Blank is allowed: it means "keep the current name" and is not sent.
	assert.equal(model.canStartTrial({ ...ok, orgName: "   " }), true);
});

test("refusal codes map to the sentence the user can act on", () => {
	assert.equal(model.trialStartFailure("terms_outdated"), "terms_outdated");
	assert.equal(model.trialStartFailure("terms_required"), "terms_outdated");
	assert.equal(model.trialStartFailure("trial_not_eligible"), "not_eligible");
	assert.equal(model.trialStartFailure("not_a_member"), "not_eligible");
	assert.equal(model.trialStartFailure("rate_limited"), "rate_limited");
	assert.equal(model.trialStartFailure("radient_upstream_failed"), "generic");
	assert.equal(model.trialStartFailure(null), "generic");
});

const row = (over) => ({
	tenant_id: "ten_home",
	role: "member",
	status: "active",
	plan: { status: "none" },
	...over,
});

test("C3: not_owner keeps Subscribe for an active admin or owner, never for a member", () => {
	const view = (memberships) =>
		model.trialEmptyView({
			pending: false,
			unavailable: false,
			eligibility: { ...ELIGIBLE, eligible: false, reason: "not_owner" },
			memberships,
		});
	assert.equal(view([row({ role: "admin" })]).canSubscribe, true);
	assert.equal(view([row({ role: "owner" })]).canSubscribe, true);
	assert.equal(view([row({ role: "member" })]).canSubscribe, false);
	// A disabled admin cannot buy: the console refuses non-active rows.
	assert.equal(
		view([row({ role: "admin", status: "disabled" })]).canSubscribe,
		false,
	);
	// An admin elsewhere is not an admin here.
	assert.equal(
		view([row({ role: "admin", tenant_id: "ten_other" })]).canSubscribe,
		false,
	);
	assert.equal(view(null).canSubscribe, false);
});

test("R1-4: an active member of a paid org is never offered a trial", () => {
	const view = (memberships) =>
		model.trialEmptyView({
			pending: false,
			unavailable: false,
			eligibility: ELIGIBLE,
			memberships,
		}).kind;
	for (const status of ["active", "past_due"])
		assert.equal(
			view([row({ tenant_id: "ten_paid", plan: { status } })]),
			"unchanged",
		);
	// Not entitling: a canceled plan, or a disabled/pending row of a paid org.
	assert.equal(
		view([row({ tenant_id: "ten_paid", plan: { status: "canceled" } })]),
		"eligible",
	);
	assert.equal(
		view([
			row({
				tenant_id: "ten_paid",
				status: "disabled",
				plan: { status: "active" },
			}),
		]),
		"eligible",
	);
	// A failed or absent memberships read never blocks the offer.
	assert.equal(view(null), "eligible");
	assert.equal(view(undefined), "eligible");
});

test("R1-2/X3: the paused note names who can act for a member, and keeps Subscribe for billing roles", () => {
	const aud = model.trialNoteAudience;
	assert.equal(aud([row({ role: "owner" })], "ten_home"), "billing");
	assert.equal(aud([row({ role: "admin" })], "ten_home"), "billing");
	assert.equal(aud([row({ role: "member" })], "ten_home"), "member");
	// The trial end disables every non-owner, admins included.
	assert.equal(
		aud([row({ role: "admin", status: "disabled" })], "ten_home"),
		"member",
	);
	assert.equal(aud([row({ status: "disabled" })], "ten_home"), "member");
	// No read, or no row for that org: round 1's behaviour (the console decides).
	assert.equal(aud(null, "ten_home"), "billing");
	assert.equal(aud([row({ tenant_id: "ten_other" })], "ten_home"), "billing");
});

test("R1-1: every press mints a fresh request id, so a refusal never poisons a retry", () => {
	let n = 0;
	const mint = () => `req-${++n}`;
	const input = {
		tenantId: "ten_home",
		termsVersion: "2026-07-29",
		orgName: "Ada's Organization",
		defaultOrgName: "Ada's Organization",
	};
	const first = model.trialStartRequest(input, mint);
	// The same answer pressed again after a 429: a new id, not the refused one.
	const retry = model.trialStartRequest(input, mint);
	assert.notEqual(first.requestId, retry.requestId);
	// The unchanged default name is not sent ("keep the current name").
	assert.equal(first.orgName, undefined);
	const renamed = model.trialStartRequest({ ...input, orgName: "Acme" }, mint);
	assert.equal(renamed.orgName, "Acme");
	assert.equal(
		new Set([first, retry, renamed].map((r) => r.requestId)).size,
		3,
	);
});

test("R1-3: the trial replaces only the plan-required panel, and paused folds into readOnly", () => {
	assert.equal(model.trialReplacesPanel("plan_required"), true);
	for (const other of [
		"signed_out",
		"off",
		"off_local",
		"update_required",
		"unavailable",
		null,
		undefined,
	])
		assert.equal(model.trialReplacesPanel(other), false, String(other));
	const ro = (statusReadOnly, ownerGuard, trialPaused) =>
		model.teamBridgeReadOnly({ statusReadOnly, ownerGuard, trialPaused });
	assert.equal(ro(false, true, false), false);
	assert.equal(ro(false, true, true), true);
	assert.equal(ro(true, true, false), true);
	assert.equal(ro(false, false, false), true);
});

// The page-wiring pins (R1-3), at module scope for biome's useTopLevelRegex.
const GATE_ROUTES_THROUGH_PREDICATE =
	/if \(trialReplacesPanel\(eligibility\) && noOrgPanel\) return noOrgPanel;\n\tif \(eligibility\) return <TeamBridgeEligibilityPanel reason=\{eligibility\} \/>;/;
const OLD_INLINE_GATE = /eligibility === "plan_required" && noOrgPanel/;
const READ_ONLY_ROUTES_THROUGH_PREDICATE =
	/const readOnly = teamBridgeReadOnly\(\{\n\t\tstatusReadOnly: status\.data\?\.read_only === true,\n\t\townerGuard,\n\t\ttrialPaused: trialNote\.paused,\n\t\}\);/;
const PAUSED_EXPLAINS_READ_ONLY = /readOnlyExplained=\{trialNote\.paused\}/;

test("R1-3: the page routes its gate and readOnly through those predicates", () => {
	// A source pin, the house pattern (team-bridge-composer-ring.test.mjs): the
	// predicates above prove nothing if the page stops calling them.
	const page = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(page, GATE_ROUTES_THROUGH_PREDICATE);
	assert.doesNotMatch(page, OLD_INLINE_GATE);
	assert.match(page, READ_ONLY_ROUTES_THROUGH_PREDICATE);
	assert.match(page, PAUSED_EXPLAINS_READ_ONLY);
});

test("a 200 without the eligibility shape keeps the page unchanged", () => {
	for (const body of [
		{ memberships: [] },
		{ eligible: "yes", tenant_id: "t" },
		{ eligible: true },
	])
		assert.equal(
			model.trialEmptyView({
				pending: false,
				unavailable: false,
				eligibility: body,
			}).kind,
			"unchanged",
		);
});

/*
 * Q5 (QA round 1): the LIVE wire after a trial ends, as captured in
 * qa-evidence m9-lop-bridge-LM / m9-lop-ended-L2: a READY surface A with
 * `tenant_id: null` and every org row `eligible:false`, plus the runtime's
 * additive `trial_ended` marker (core #3386 over agent-server #296).
 */
const contract = await load("./src/shared/agent-messages-contract");
const ENDED_WIRE = {
	capability: 1,
	state: "ready",
	account_id: "acc_member",
	tenant_id: null,
	surface_state: "A",
	visibility: {
		settings: false,
		inbox: false,
		account_door: false,
		onboarding: false,
	},
	update_required: false,
	local: { enabled: false, onboarding: "", session: "" },
	status: {
		api_version: "1",
		available: false,
		tenants: [
			{ tenant_id: "ten_home", eligible: false, endpoint: null },
			{
				tenant_id: "ten_trial",
				eligible: false,
				endpoint: null,
				trial_ended_at: "2026-11-02T09:30:00Z",
			},
		],
	},
	consent: null,
	error: null,
	state_note: null,
	read_only: false,
	trial_ended: {
		tenant_id: "ten_trial",
		trial_ended_at: "2026-11-02T09:30:00Z",
	},
};

test("Q5: the ended-trial wire (A, tenant_id null, marker) names the paused org", () => {
	const parsed = contract.agentMessagesStatusSchema.parse(ENDED_WIRE);
	assert.deepEqual(parsed.trial_ended, {
		tenant_id: "ten_trial",
		trial_ended_at: "2026-11-02T09:30:00Z",
	});
	assert.deepEqual(model.trialEndedOrg(parsed), {
		tenantId: "ten_trial",
		endedAt: "2026-11-02T09:30:00Z",
	});
	// The disabled member reads the member audience for THAT org, not billing.
	const memberships = [
		{ tenant_id: "ten_home", role: "owner", status: "active" },
		{ tenant_id: "ten_trial", role: "member", status: "disabled" },
	];
	assert.equal(model.trialNoteAudience(memberships, "ten_trial"), "member");
	// The owner keeps Subscribe.
	assert.equal(
		model.trialNoteAudience(
			[{ tenant_id: "ten_trial", role: "owner", status: "active" }],
			"ten_trial",
		),
		"billing",
	);
});

test("Q5: no marker, a malformed marker, or a non-A letter offers no paused band", () => {
	const { trial_ended: _drop, ...older } = ENDED_WIRE;
	// An older runtime: the page keeps today's on-ramp reading.
	assert.equal(
		model.trialEndedOrg(contract.agentMessagesStatusSchema.parse(older)),
		null,
	);
	// A malformed block degrades to null without failing the status read.
	const malformed = contract.agentMessagesStatusSchema.parse({
		...ENDED_WIRE,
		trial_ended: { tenant_id: 7 },
	});
	assert.equal(malformed.trial_ended, null);
	assert.equal(model.trialEndedOrg(malformed), null);
	for (const surface_state of ["B", "C", "D", "E", "F", "G", null])
		assert.equal(
			model.trialEndedOrg({ ...ENDED_WIRE, surface_state }),
			null,
			String(surface_state),
		);
	assert.equal(
		model.trialEndedOrg({ ...ENDED_WIRE, state: "signed_out" }),
		null,
	);
});

const ENDED_ORG_REPLACES_ONRAMP =
	/noOrgPanel=\{\n\t+trialEnded \? \(\n\t+<TeamBridgeTrialEndedPanel\n\t+tenantId=\{trialEnded\.tenantId\}\n\t+endedAt=\{trialEnded\.endedAt\}\n\t+\/>\n\t+\) : \(\n\t+<TeamBridgeTrialEmpty/;
const ENDED_ORG_FROM_STATUS =
	/const trialEnded = trialEndedOrg\(status\.data\);/;

test("Q5: the page mounts the paused band, never the trial on-ramp, for an ended org", () => {
	// A source pin (house pattern): the predicate proves nothing if the page
	// stops routing the no-org branch through it.
	const page = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		"utf8",
	);
	assert.match(page, ENDED_ORG_FROM_STATUS);
	assert.match(page, ENDED_ORG_REPLACES_ONRAMP);
});
