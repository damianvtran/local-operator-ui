import type { HubDirectionStatus } from "@shared/api/local-operator/hub-links";
import { t } from "@shared/i18n";

/**
 * Translate service codes at the point of use. No raw exception or private body
 * belongs in a collapsed tooltip. Unknown code/state degrades to explanatory
 * detail, never a green success or an inferred permission to publish.
 */
export function hubReasonText(
	reason: string | null | undefined,
	/** The sentence for an unknown code; defaults to the cause-neutral pause. */
	fallback?: string,
): string {
	switch (reason?.split("/")[0]) {
		case "unsupported-precondition":
			return t("ui.hub.status.unsupported");
		case "baseline-unknown":
			return t("ui.hub.status.baseline_unknown");
		/*
		 * The publish preview refuses this alias because an UNOWNED local skill
		 * already holds it, not because two sources diverged - so it must not
		 * borrow the merge-lineage sentence below. Name the local collision and
		 * the choice it leaves the user (the existing local_exists copy).
		 */
		case "alias-occupied":
			return t("ui.hub.skills.local_exists");
		case "mixed-lineage":
		case "origin-conflict":
			return t("ui.hub.status.mixed_lineage");
		case "no-credential":
			return t("ui.hub.status.no_credential");
		case "access-lost":
		case "unauthorized":
		case "forbidden":
			return t("ui.hub.status.access_lost");
		case "provider-error":
			return t("ui.hub.status.provider_error");
		case "model-unavailable":
			return t("ui.hub.status.model_unavailable");
		case "merge-refused":
		case "concurrent-edit":
		case "local-concurrent-edit":
		case "remote-revision-changed":
			return t("ui.hub.status.conflict");
		case "prompt-too-long":
		case "skill-too-large":
			return t("ui.hub.status.too_large");
		case "skill-validation":
			return t("ui.hub.status.skill_validation");
		case "unsafe-publication":
			return t("ui.hub.status.unsafe_publication");
		/*
		 * UX U3' (design D18): a transport failure is NOT a paused action - the
		 * row's own line says a retry is scheduled - so it gets its own sentence
		 * rather than the cause-neutral default.
		 */
		case "hub-error":
		case "transport":
			return t("ui.hub.status.transport_error");
		default:
			return fallback ?? t("ui.hub.status.other_error");
	}
}

/**
 * Why an incoming update failed, as one sentence.
 *
 * The service's own `safe_message` wins: it is core's scrubbed, bounded,
 * human-readable reason for THIS failure (core is adding one for transport
 * failures that today persist only a class). Without it the class is translated;
 * an unknown class says plainly that no reason was recorded rather than "This
 * action is paused.", which is false for a failed pull.
 */
export function hubFailureReasonText(status: HubDirectionStatus): string {
	/*
	 * Core's stored sentence is a lower-case clause ("could not reach the hub: the
	 * connection timed out", "the hub refused the request (HTTP 500: ...)" from
	 * core #3095), so it is framed rather than shown bare. It is server prose and
	 * stays untranslated; the frame around it is ours.
	 */
	const stated = status.safe_message?.trim();
	if (stated)
		return t("ui.hub.links.incoming_failed_reason", { reason: stated });
	return hubReasonText(
		status.error_class,
		t("ui.hub.links.incoming_failed_no_reason"),
	);
}

export function hubDirectionStateText(status: HubDirectionStatus): string {
	switch (status.state) {
		case "idle":
			return t(
				status.last_checked_at
					? "ui.hub.status.idle"
					: "ui.hub.status.not_checked",
			);
		case "checking":
			return t("ui.hub.status.checking");
		case "available":
			return t("ui.hub.status.available");
		case "merging":
			return t("ui.hub.status.merging");
		case "applying":
			return t("ui.hub.status.applying");
		case "pushing":
			return t("ui.hub.status.pushing");
		case "retry-wait":
			return t("ui.hub.status.retry_wait");
		case "needs-review":
			return t("ui.hub.status.needs_review");
		case "failed":
			return t("ui.hub.status.failed");
		case "missing":
			return t("ui.hub.status.missing");
		default:
			// UX U3: the raw `{state}` token and the nonexistent "link details"
			// action both leaked here. Degrade to a sentence that names no token and
			// offers no action the surface does not have; the real code rides the
			// reason text (`hubReasonText`) where one exists.
			return t("ui.hub.status.other_error");
	}
}

/*
 * Core's remedy for an org operation with no Radient sign-in (radient_credentials
 * in core: "... Run `lop login radient`."). It arrives as a 401 with a bare string
 * detail and NO code, so the transport files it under the desktop plane's own
 * `pairing.refused` ("This app's credential ... was refused") - the wrong fact.
 * The plane's 401 says "Desktop authorization is required." and never names the
 * login command, so the command is the discriminator.
 */
const RADIENT_SIGN_IN_REMEDY = /lop login radient/i;

/**
 * Whether a failed hub action was refused for want of a Radient sign-in.
 *
 * Read STRUCTURALLY (an Error with a numeric `status`), not by `instanceof
 * DesktopControlError`: this is a copy module that unit suites load bare, and the
 * transport module it would have to import builds the app's configuration at
 * import time.
 */
export function isRadientSignInRefusal(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const status = (error as { status?: unknown }).status;
	return (
		(status === 401 || status === 403) &&
		RADIENT_SIGN_IN_REMEDY.test(error.message)
	);
}

/**
 * The sentence for a failed link action, in this app's vocabulary.
 *
 * WHY: the popover used to show one sentence for every failure - "The Incoming
 * update for <uuid> at Source unavailable did not complete" - which named the
 * item by its id, spliced an unknown source in, and dropped core's actual remedy
 * (sign in). Order: an upgrade refusal states its own fix; a sign-in refusal says
 * where to sign in (Settings, not the CLI command core names); anything else gets
 * the caller's sentence. Server prose for other errors is NOT echoed: a 404's
 * detail names the item by id again.
 */
export function hubLinkFailureText(
	error: unknown,
	fallback: string,
	/** `HubMutationUpgradeRequired`, passed in for the same import reason. */
	upgradeRequired?: abstract new (...args: never[]) => Error,
): string {
	if (upgradeRequired && error instanceof upgradeRequired) return error.message;
	if (isRadientSignInRefusal(error)) return t("ui.hub.links.sign_in_required");
	return fallback;
}
