import assert from "node:assert/strict";
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
