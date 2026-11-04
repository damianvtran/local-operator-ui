/**
 * The Team Bridge trial empty state's pure rules (teams-trial DESIGN.md §9 Lane F).
 *
 * WHY A SEPARATE MODEL. The page decides which of five states to show from three
 * reads (the Bridge status, the trial eligibility, and the account's sign-in), and
 * that decision is the part reviewers need to trust: "never offer a trial to an
 * account already on Teams" and "never call an older server's refusal an error".
 * Keeping it pure lets the node tests pin each arm without a renderer.
 *
 * WHERE THE TRUTH LIVES. agent-server decides eligibility and computes the trial
 * window from `now` on every read (D2); this file only maps those answers onto
 * screens. The end date shown is always the server's instant.
 */

/** What the no-organization branch of the Team Bridge page shows. */
export type TrialEmptyView =
	| { kind: "checking" }
	/** The server, the build or the flag offers no trial: keep the page as it was. */
	| { kind: "unchanged" }
	| {
			kind: "eligible";
			tenantId: string;
			tenantName: string;
			endsAt: string;
			termsVersion: string;
			termsUrl: string;
	  }
	| {
			kind: "ineligible";
			reason: IneligibleReason;
			subscribeUrl: string;
			/** Whether this viewer may subscribe, so whether Subscribe is offered. */
			canSubscribe: boolean;
	  };

/** The ineligible reasons with their own sentence; anything else reads `other`. */
export type IneligibleReason =
	| "trial_used"
	| "former_subscriber"
	| "not_owner"
	| "email_unverified"
	| "other";

const OWN_SENTENCE = new Set<IneligibleReason>([
	"trial_used",
	"former_subscriber",
	"not_owner",
	"email_unverified",
]);

/**
 * The console page a Subscribe link opens. Pinned rather than taken from the
 * eligibility body: a link the user follows to pay must not be steerable by an
 * upstream response (the console's `TEAM_TRIAL_TERMS_URL` makes the same call
 * for the Terms link). §3 names exactly this URL.
 */
export const TEAMS_SUBSCRIBE_URL =
	"https://console.radienthq.com/dashboard/team";

/** The Terms the checkbox links to; pinned for the same reason. */
export const TERMS_URL = "https://radienthq.com/terms";

/** `src=lop` tags the console visit for analytics only (§8's URL contract). */
export function subscribeUrlFor(tenantId?: string | null): string {
	const url = new URL(TEAMS_SUBSCRIBE_URL);
	if (tenantId) url.searchParams.set("tenant", tenantId);
	url.searchParams.set("src", "lop");
	return url.toString();
}

export type TrialEligibilityRead = {
	eligible: boolean;
	reason: string | null;
	tenant_id: string;
	tenant_name: string;
	would_end_at: string;
	terms_version: string;
};

/**
 * The no-organization branch's view.
 *
 * Signed out never reaches here: the page's own gate answers `signed_out` first
 * and keeps its "Sign in to Radient" panel (operator spec 1), because the
 * eligibility read spends a bearer a signed-out viewer does not have.
 *
 * - A pending read is `checking`, a quiet placeholder rather than a flash of the
 *   old plan-required copy that the answer would immediately replace.
 * - `unavailable` (an older backend, an agent-server without the routes, the flag
 *   off, or any failed read) keeps the page UNCHANGED: a trial that cannot be
 *   offered must never become an error on a page that worked before.
 * - `already_on_team` and `trial_active` also keep the page unchanged: the user
 *   is on Teams, and the Bridge's own states describe that.
 * - `not_available` is the server's own "the trial is off": unchanged as well,
 *   so flipping the flag off is invisible rather than a new refusal screen.
 */
export function trialEmptyView(input: {
	pending: boolean;
	unavailable: boolean;
	eligibility: TrialEligibilityRead | null | undefined;
	/**
	 * The account's own membership rows, when read. Optional so a failed or
	 * absent memberships read never blocks the trial: the server stays the
	 * authority, and these rows only REMOVE an offer, never add one.
	 */
	memberships?: readonly TrialMembershipRow[] | null;
}): TrialEmptyView {
	if (input.unavailable) return { kind: "unchanged" };
	// R1-4: surface A also covers an active member of a PAID org whose Bridge is
	// killed or scope-excluded, while eligibility judges only the home tenant and
	// can answer `eligible`. Offering that person a trial is wrong, so a live
	// team membership keeps the page as it was. A server-side `already_on_team`
	// for any membership would be the fuller fix; this is the renderer's half.
	if (memberOfTeamOrg(input.memberships)) return { kind: "unchanged" };
	if (input.pending || !input.eligibility) return { kind: "checking" };
	const e = input.eligibility;
	// A body without the §3 shape is not an answer: an older or misrouted
	// backend that replies 200 with something else must leave the page as it was,
	// not become an "ineligible" screen built from undefined fields.
	if (typeof e.eligible !== "boolean" || typeof e.tenant_id !== "string")
		return { kind: "unchanged" };
	if (e.eligible)
		return {
			kind: "eligible",
			tenantId: e.tenant_id,
			tenantName: e.tenant_name,
			endsAt: e.would_end_at,
			termsVersion: e.terms_version,
			termsUrl: TERMS_URL,
		};
	switch (e.reason) {
		case "already_on_team":
		case "trial_active":
		case "not_available":
			return { kind: "unchanged" };
		default: {
			const reason = (
				OWN_SENTENCE.has(e.reason as IneligibleReason) ? e.reason : "other"
			) as IneligibleReason;
			return {
				kind: "ineligible",
				reason,
				subscribeUrl: subscribeUrlFor(e.tenant_id),
				// C3: the server's `not_owner` gate covers STARTING a trial only;
				// owners and admins can both subscribe (the console's
				// `isBillingManager`), so an admin keeps the button. A plain member
				// does not: the sentence already names who can act.
				canSubscribe:
					reason !== "not_owner" ||
					canSubscribeIn(input.memberships, e.tenant_id),
			};
		}
	}
}

/** The fields of a `memberships.list` row these rules read. */
export type TrialMembershipRow = {
	tenant_id: string;
	role: string;
	status: "active" | "pending" | "disabled";
	plan?: { status: string } | null;
};

/**
 * Whether the account is an ACTIVE member of an organization whose plan
 * entitles team features (`active` or `past_due`, the same pair agent-server's
 * `planStatusEntitlesOrgAccess` admits).
 */
export function memberOfTeamOrg(
	memberships: readonly TrialMembershipRow[] | null | undefined,
): boolean {
	return (memberships ?? []).some(
		(m) =>
			m.status === "active" &&
			(m.plan?.status === "active" || m.plan?.status === "past_due"),
	);
}

/**
 * Whether the viewer may subscribe for `tenantId`: an ACTIVE owner or admin
 * there. A disabled member (the trial end disables every non-owner) cannot.
 */
export function canSubscribeIn(
	memberships: readonly TrialMembershipRow[] | null | undefined,
	tenantId: string | null | undefined,
): boolean {
	const row = (memberships ?? []).find((m) => m.tenant_id === tenantId);
	return (
		row?.status === "active" && (row.role === "owner" || row.role === "admin")
	);
}

/**
 * Who the paused note speaks to. `billing` (owner or admin) gets "subscribe to
 * continue" with the Subscribe button; `member` gets who can act and no button,
 * because the console would refuse them the purchase. X3: a member the trial end
 * DISABLED still reads the status, so the note reaches them too.
 *
 * An unread or failed memberships read answers `billing`, round 1's behaviour:
 * the console still decides who can pay, and guessing `member` would hide the
 * button from the owner the note is mostly for.
 */
export function trialNoteAudience(
	memberships: readonly TrialMembershipRow[] | null | undefined,
	tenantId: string | null | undefined,
): "billing" | "member" {
	if (!memberships) return "billing";
	const row = memberships.find((m) => m.tenant_id === tenantId);
	if (!row) return "billing";
	return canSubscribeIn(memberships, tenantId) ? "billing" : "member";
}

/**
 * The page wiring the trial owns, as predicates so a test can pin them (R1-3).
 * The trial panel replaces ONLY the plan-required panel; `signed_out`, `off`,
 * `off_local`, `update_required` and `unavailable` keep the page's own panels.
 */
export function trialReplacesPanel(eligibility: string | null | undefined) {
	return eligibility === "plan_required";
}

/** An ended trial is read-only on top of the hub's own `read_only` and guard. */
export function teamBridgeReadOnly(input: {
	statusReadOnly: boolean;
	ownerGuard: boolean;
	trialPaused: boolean;
}): boolean {
	return input.statusReadOnly || !input.ownerGuard || input.trialPaused;
}

/**
 * The paused fact for the page: the date the trial ended, when the selected
 * organization's trial is over and no paid plan took over (§3's status `ended`).
 * `converted`, `active` and `none` are not paused.
 */
export function pausedEndedAt(
	status:
		| { state: string; trial_end: string | null; ended_at: string | null }
		| null
		| undefined,
): string | null {
	if (!status || status.state !== "ended") return null;
	return status.ended_at ?? status.trial_end ?? null;
}

/** The trial's end while it is live, for the "Trial active until" note. */
export function activeUntil(
	status: { state: string; trial_end: string | null } | null | undefined,
): string | null {
	if (!status || status.state !== "active") return null;
	return status.trial_end ?? null;
}

/**
 * "Thursday, December 3, 2026" in the reader's own language: the operator asked
 * for the full weekday date (a person deciding whether to start a trial needs the
 * day it ends, not "Dec 3"), and the console renders the same components. Unlike
 * the console, which writes English, this app is localized, so the date follows
 * the interface locale instead of being pinned to `en-US`. The time zone is the
 * viewer's own (the instant is exact; the day it falls on is the reader's), and
 * is injectable for tests.
 */
export function formatTrialDate(
	value: string | null | undefined,
	locale: string,
	timeZone?: string,
): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(locale, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		...(timeZone ? { timeZone } : {}),
	}).format(date);
}

/** §3: `org_name` is optional, 1–80 characters after trim. */
export const TRIAL_ORG_NAME_MAX = 80;

/** Whether the dialog may submit: the Terms box ticked and a sendable name. */
export function canStartTrial(input: {
	termsAccepted: boolean;
	orgName: string;
	pending: boolean;
}): boolean {
	if (!input.termsAccepted || input.pending) return false;
	return input.orgName.trim().length <= TRIAL_ORG_NAME_MAX;
}

/**
 * The start request for ONE press of "Start free trial", with a fresh id.
 *
 * WHY A FRESH ID PER PRESS (R1-1). The core proxy wraps the start in its
 * receipt store keyed by `request_id`; when the upstream refuses (429, 403,
 * 503) that claim is left without a result, and the store refuses every later
 * call with the same id ("outcome is indeterminate", or "different input" once
 * the name changes). Reusing an id after a refusal therefore made every retry
 * fail until the dialog was reopened. A press is never retried with an old id:
 * the double-submit guard is the disabled button while one is in flight, and a
 * lost response is answered by agent-server's own 200 replay of the caller's
 * live trial, so a second consent cannot be recorded.
 */
export function trialStartRequest(
	input: {
		tenantId: string;
		termsVersion: string;
		orgName: string;
		defaultOrgName: string;
	},
	mintId: () => string,
): {
	tenantId: string;
	termsVersion: string;
	orgName?: string;
	requestId: string;
} {
	return {
		tenantId: input.tenantId,
		termsVersion: input.termsVersion,
		orgName:
			input.orgName.trim() === input.defaultOrgName ? undefined : input.orgName,
		requestId: mintId(),
	};
}

/** Which inline sentence a refused start shows. */
export type TrialStartFailure =
	| "terms_outdated"
	| "not_eligible"
	| "rate_limited"
	| "generic";

export function trialStartFailure(code: string | null): TrialStartFailure {
	switch (code) {
		case "terms_outdated":
		case "terms_required":
			return "terms_outdated";
		case "trial_not_eligible":
		case "not_a_member":
		case "insufficient_role":
			return "not_eligible";
		case "rate_limited":
			return "rate_limited";
		default:
			return "generic";
	}
}
