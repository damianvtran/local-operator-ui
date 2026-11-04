/**
 * The Radient Team free trial, through the desktop's Radient proxy.
 *
 * WHY THIS FILE EXISTS. The Team Bridge page offers a calm empty-state trial to
 * an account that belongs to no Team organization (teams-trial DESIGN.md §3,
 * §9 Lane F). Every call goes through `POST /v1/desktop/radient`, so the
 * backend spends the stored Radient bearer and the renderer never holds one,
 * exactly like every other Radient op. The three ops are a three-way contract
 * with `desktop_radient.py` (local-operator PR #3386) and the closed
 * `operation` enum in `shared/desktop-contract.ts`:
 *
 *   team_trial.eligibility {}                  -> GET  /v1/team-trial/eligibility
 *   team_trial.start       {tenant_id,payload} -> POST /v1/tenants/{id}/team-trial
 *   team_trial.status      {tenant_id}         -> GET  /v1/tenants/{id}/team-trial
 *
 * `source: "lop"` is NOT sent from here: the backend pins it, so a renderer
 * cannot misreport where a trial came from.
 *
 * The shapes mirror §3 (and the console's `src/lib/team-trial.ts`, user-console
 * PR #51) so an upstream contract change is a type error rather than a blank
 * page. An OLDER backend refuses an unknown op with a masked 422, and an
 * agent-server that predates the trial answers 404; both read as "no trial
 * offered", never as an error the user has to read (`trialUnavailable`).
 */
import { radientProxy } from "@shared/api/radient/proxy";
import { DesktopControlError } from "./desktop-api";

/** The live trial block (§3 start response and the eligibility `trial` field). */
export type TeamTrialBlock = {
	state: "active" | "ended";
	trial_start: string;
	trial_end: string;
	days_left: number;
};

/** `GET /v1/team-trial/eligibility` (§3). */
export type TeamTrialEligibility = {
	eligible: boolean;
	reason: string | null;
	tenant_id: string;
	tenant_name: string;
	trial_days: number;
	would_end_at: string;
	terms_version: string;
	terms_url: string;
	subscribe_url: string;
	/** The caller's own trial, when one exists; `null` when none ever started. */
	trial?: TeamTrialBlock | null;
};

/** `GET /v1/tenants/:id/team-trial` (§3). */
export type TeamTrialStatus = {
	state: "none" | "active" | "ended" | "converted";
	trial_start: string | null;
	trial_end: string | null;
	days_left: number | null;
	ended_at: string | null;
	entitlement_source: "paid" | "internal" | "trial" | "none";
};

/** `POST /v1/tenants/:id/team-trial` 200/201 (§3). */
export type TeamTrialStartResult = {
	trial: TeamTrialBlock;
	tenant: { id: string; name: string };
};

export type TeamTrialStartInput = {
	tenantId: string;
	termsVersion: string;
	/** Omitted when blank: "keep the current name" is what absence means upstream. */
	orgName?: string;
	/**
	 * One id per press of "Start free trial", reused by nothing else: the
	 * backend's receipt makes a lost response replay the stored answer instead
	 * of recording consent twice.
	 */
	requestId: string;
};

export const teamTrialApi = {
	eligibility(): Promise<TeamTrialEligibility> {
		return radientProxy<TeamTrialEligibility>({
			operation: "team_trial.eligibility",
		});
	},
	status(tenantId: string): Promise<TeamTrialStatus> {
		return radientProxy<TeamTrialStatus>({
			operation: "team_trial.status",
			tenantId,
		});
	},
	start(input: TeamTrialStartInput): Promise<TeamTrialStartResult> {
		const orgName = input.orgName?.trim();
		return radientProxy<TeamTrialStartResult>({
			operation: "team_trial.start",
			tenantId: input.tenantId,
			requestId: input.requestId,
			payload: {
				terms_version: input.termsVersion,
				// Literally `true`: the checkbox is required, and the backend
				// refuses anything that is not the boolean.
				terms_accepted: true,
				...(orgName ? { org_name: orgName } : {}),
			},
		});
	},
};

/**
 * Whether a refusal means "this build or this server has no trial" rather than
 * a failure: an older desktop backend's masked 422 for the unknown op, or an
 * agent-server without the routes (404, passed through). The page then shows
 * nothing new, which is the page it showed before this feature.
 */
export function trialUnavailable(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		(error.status === 404 || error.status === 422)
	);
}

/** The carried refusal code (`trial_not_eligible`, `terms_outdated`, ...), if any. */
export function trialRefusalCode(error: unknown): string | null {
	return error instanceof DesktopControlError && typeof error.code === "string"
		? error.code
		: null;
}
