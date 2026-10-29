import { t } from "@shared/i18n";
import {
	type AgentMessagesAllowlistEntry,
	type AgentMessagesAllowlistPut,
	type AgentMessagesRefusal,
	type AgentMessagesSettingsResult,
	type AgentMessagesStatus,
	agentMessagesServedConsent,
} from "../../../../shared/agent-messages-contract";

/**
 * The Settings section's decisions, kept out of the component so the test lane
 * can pin them without a DOM. Nothing here reads React or the wire.
 */

export type AgentMessagesSettingsAvailability =
	| "absent"
	| "visible"
	| "dark"
	| "error";

const VISIBLE_SURFACE_STATES: ReadonlySet<string> = new Set([
	"B",
	"C",
	"D",
	"E",
	"F",
]);

/**
 * Whether Settings (and its rail item) exists at all (RFC §5.6).
 *
 * Absence is the default, deliberately: a status this client cannot interpret,
 * a signed-out account, an outdated app, or a capability this build does not
 * speak all render nothing — no rail row, no skeleton, no placeholder. The two
 * exceptions are the dark-launch state (an explicit "not available yet" panel
 * is the operator's required launch surface) and a read that failed AFTER the
 * section was already observable, which is shown as a retryable error rather
 * than yanked from under the reader.
 */
export function agentMessagesSettingsAvailability(input: {
	status: AgentMessagesStatus | null;
	refused: boolean;
	everVisible: boolean;
	/**
	 * A forced status refresh blanks `status` while the read is in flight. The
	 * section has already drawn its own authoritative settings read, so a reader
	 * mid-action keeps the surface instead of watching it vanish and re-mount.
	 */
	checking?: boolean;
}): AgentMessagesSettingsAvailability {
	const { status, refused, everVisible, checking = false } = input;
	if (!status) {
		if (checking && everVisible) return "visible";
		return refused && everVisible ? "error" : "absent";
	}
	if (status.update_required) return "absent";
	if (status.state === "signed_out") return "absent";
	// The status route renders the dark launch as `unavailable`, but SO DO
	// transport and destination failures. Only the launch code is the launch
	// state; any other unavailable error is a real fault the reader can retry.
	if (status.state === "unavailable") {
		if (status.error?.code === "messaging_unavailable") return "dark";
		return everVisible ? "error" : "absent";
	}
	if (status.surface_state === "G") {
		// G is the launch state when the server names it (or says nothing more);
		// any OTHER failure carried on G is a real, retryable error.
		return status.error === null ||
			status.error?.code === "messaging_unavailable"
			? "dark"
			: "error";
	}
	if (status.capability < 1) return "absent";
	if (status.state !== "ready") return "absent";
	if (!status.visibility.settings) return "absent";
	if (status.surface_state && VISIBLE_SURFACE_STATES.has(status.surface_state))
		return "visible";
	return "absent";
}

export type AgentMessagesSettingsState = "B" | "C" | "D" | "E" | "F";

/**
 * Whether the page mounts the whole section (heading included).
 *
 * Absent is the default and mounts NOTHING (RFC §5.6): a heading over an empty
 * body is an up-sell the ineligible reader must not see, and it flashed on
 * every Settings open before this predicate existed. The error state still
 * mounts a retry surface even when the held status was cleared by the failure.
 */
export function agentMessagesSectionMounted(
	availability: AgentMessagesSettingsAvailability,
	_status: AgentMessagesStatus | null,
): boolean {
	/*
	 * A non-absent answer mounts the SHELL even while a read is in flight with
	 * no held status: pressing Retry after a failure, or switching accounts,
	 * must not blank the heading and the retry surface for the duration of the
	 * check (round-2 R2-2). The page chooses the body: status -> section,
	 * outstanding refusal -> retry Alert, otherwise a skeleton.
	 */
	return availability !== "absent";
}

/**
 * The state letter the body renders, from the settings read plus the status.
 *
 * The endpoint is the authority on C/D/E (the settings read is fresher than
 * the status snapshot); F is kept from the status because it is the one letter
 * that describes an organization kill with a retained endpoint, and no
 * endpoint field states who turned it off.
 */
export function agentMessagesSettingsState(
	status: AgentMessagesStatus,
	settings: AgentMessagesSettingsResult,
): AgentMessagesSettingsState {
	if (status.surface_state === "F") return "F";
	const endpoint = settings.endpoint;
	if (!endpoint) return "B";
	if (endpoint.state === "paused") return "D";
	if (endpoint.state === "disabled") return "E";
	return "C";
}

/** The runtime's hold code for "open your chief of staff once" (#2777). */
export const OPEN_CHIEF_OF_STAFF_HOLD = "open_chief_of_staff";

/**
 * The chief-of-staff delivery hold this section should announce, or null.
 *
 * WHY: under consent v1 the runtime will not wake a designated chief of staff
 * that has never been used, so incoming Team Bridge messages wait silently
 * until the owner opens that session once. The status read carries the count;
 * this decides whether there is anything to say and where "Open" goes.
 *
 * Null for an older runtime (no field), for nothing waiting (count 0 or
 * `null`), and for a hold code this build has no copy for: a sentence about
 * the chief of staff must never describe a different hold. The session id is
 * the runtime's own designation answer; the local preference is the fallback
 * for a hold that names none. With neither, the notice still renders, without
 * a button and with copy that says where to find the conversation instead
 * (design D2): an instruction the reader cannot act on is a dead end.
 */
export function agentMessagesChiefOfStaffHold(
	status: AgentMessagesStatus | null,
): { count: number; sessionId: string | null } | null {
	const hold = status?.delivery_hold;
	if (!hold || hold.code !== OPEN_CHIEF_OF_STAFF_HOLD || hold.count <= 0)
		return null;
	const sessionId = hold.session || status?.local.session || null;
	return { count: hold.count, sessionId };
}

/** The served consent text a surface must render verbatim, or null. */
export function agentMessagesSettingsConsent(status: AgentMessagesStatus) {
	return agentMessagesServedConsent(status);
}

export type AllowlistDirection = "send" | "receive";
export type AllowlistMode = "class_default" | "listed_only";
export type AllowlistEntryKind = "endpoint" | "account";

/**
 * A row in the editor's draft. `key` is local and stable so React keeps row
 * identity across a removal; the WIRE's target carries no key.
 */
export type AllowlistDraftEntry = {
	key: string;
	direction: AllowlistDirection;
	effect: "allow" | "deny";
	kind: AllowlistEntryKind;
	id: string;
};

/** A target's read shape names its kind; older payloads only name the id. */
export function allowlistTargetKind(entry: AgentMessagesAllowlistEntry): {
	kind: AllowlistEntryKind;
	id: string;
} {
	// DERIVED from the id, never from `kind`: the schema now refuses a
	// disagreement, and a derivation cannot be the code path that reintroduces
	// the mismatch the refine exists to stop.
	if (entry.target.endpoint_id)
		return { kind: "endpoint", id: entry.target.endpoint_id };
	return { kind: "account", id: entry.target.account_id ?? "" };
}

export function allowlistDraft(
	entries: readonly AgentMessagesAllowlistEntry[],
): AllowlistDraftEntry[] {
	return entries.map((entry, index) => {
		const target = allowlistTargetKind(entry);
		return {
			key: `${entry.direction}:${entry.effect}:${target.kind}:${target.id}:${index}`,
			direction: entry.direction,
			effect: entry.effect,
			kind: target.kind,
			id: target.id,
		};
	});
}

/**
 * The bounded replace-set (RFC §6.1/§9).
 *
 * A class-default direction keeps only its deny rows: choosing "Anyone in my
 * organization" IS the absence of allow entries, which is how `allowlist_view`
 * reads the default back. Deny rows survive every level because blocking is a
 * separate statement from who may reach you by default.
 */
export function allowlistReplaceSet(
	entries: readonly AllowlistDraftEntry[],
	modes: Record<AllowlistDirection, AllowlistMode>,
): AgentMessagesAllowlistPut["entries"] {
	const kept = entries.filter(
		(entry) =>
			entry.effect === "deny" || modes[entry.direction] === "listed_only",
	);
	return kept
		.map((entry) => ({
			direction: entry.direction,
			effect: entry.effect,
			target:
				entry.kind === "endpoint"
					? { endpoint_id: entry.id }
					: { account_id: entry.id },
		}))
		.sort(
			(a, b) =>
				a.direction.localeCompare(b.direction) ||
				a.effect.localeCompare(b.effect) ||
				JSON.stringify(a.target).localeCompare(JSON.stringify(b.target)),
		);
}

/** Stable comparison basis for "unchanged"; ordering never matters. */
export function allowlistSignature(
	entries: AgentMessagesAllowlistPut["entries"],
): string {
	return JSON.stringify(entries);
}

export type AllowlistSaveGate =
	| { disabled: false }
	| { disabled: true; reason: "unchanged" | "saving" | "needs_entry" };

/** The Save state, INCLUDING the refusal to save an empty listed-only list. */
export function allowlistSaveGate(input: {
	entries: readonly AllowlistDraftEntry[];
	modes: Record<AllowlistDirection, AllowlistMode>;
	savedSignature: string;
	saving: boolean;
}): AllowlistSaveGate {
	if (input.saving) return { disabled: true, reason: "saving" };
	const needsEntry = (["send", "receive"] as const).some(
		(direction) =>
			input.modes[direction] === "listed_only" &&
			!input.entries.some(
				(entry) => entry.direction === direction && entry.effect === "allow",
			),
	);
	if (needsEntry) return { disabled: true, reason: "needs_entry" };
	const next = allowlistSignature(
		allowlistReplaceSet(input.entries, input.modes),
	);
	if (next === input.savedSignature)
		return { disabled: true, reason: "unchanged" };
	return { disabled: false };
}

/** A wire identifier: non-empty, <=128 characters, no whitespace/control. */
export const ALLOWLIST_IDENTIFIER_PATTERN = /^[^\s\p{Cc}]{1,128}$/u;

export function allowlistIdentifierError(value: string): string | null {
	if (value === "")
		return t("ui.agentMessages.settings.allowlist.identifier_empty");
	if (value.length > 128)
		return t("ui.agentMessages.settings.allowlist.identifier_long");
	if (!ALLOWLIST_IDENTIFIER_PATTERN.test(value))
		return t("ui.agentMessages.settings.allowlist.identifier_invalid");
	return null;
}

/**
 * Refusal copy for the section's writes. The server's sentence is used only
 * when this client has no specific advice for the code; a raw exception never
 * reaches the reader.
 */
export function settingsRefusalSentence(refusal: AgentMessagesRefusal): string {
	switch (refusal.code) {
		case "bridge_signin_required":
			return t("ui.agentMessages.settings.refusal.sign_in");
		case "bridge_not_available":
			return t("ui.agentMessages.settings.refusal.not_available");
		case "bridge_disabled":
			return t("ui.agentMessages.settings.refusal.disabled");
		case "rate_limited":
			return t("ui.agentMessages.settings.refusal.rate_limited");
		case "invalid_request":
			return t("ui.agentMessages.settings.refusal.invalid_request");
		case "consent_version_unknown":
			return t("ui.agentMessages.settings.consent.changed");
		case "messaging_unavailable":
			return t("ui.agentMessages.settings.dark.body");
		default:
			return refusal.message || t("ui.agentMessages.settings.refusal.generic");
	}
}
