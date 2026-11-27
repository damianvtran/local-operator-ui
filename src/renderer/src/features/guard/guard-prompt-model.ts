/**
 * The Guard consent prompt as a pure view model: what the card says, which
 * choices it offers, and the ONE request each choice may send.
 *
 * WHY A MODEL AND NOT JSX LOGIC. The disclosure is the whole point of a consent
 * card, and the RFC fixes its words (§15.4' C4). Keeping the composition here -
 * no React, no query client - lets one test pin the exact lines for every reason
 * and scope combination, and lets Storybook, the dialog and the tests read the
 * same function so the three cannot disagree about what a member was shown.
 * The terminal's `prompt_lines` (`tui/widgets/guard_view.py`) is the reference
 * behaviour: same scope order, same visibility sentence rule, same buttons.
 *
 * WHO MAY ANSWER. A `Share` request exists only when the host itself says it
 * may sign this card (`signable_here`) AND the typed block parses AND both
 * digests are echoable AND the disclosure names this very record. Anything less
 * yields `shareRequest: null` and the dialog draws no Share control: an
 * optimistic missing field must never enable a grant. The request is built here
 * and nowhere else; it is never reachable from the generic approve flow, an
 * auto-approval mode or a list-level "approve all" (RFC §5.9 negatives).
 */

import { t } from "@shared/i18n";
import type { DesktopRequest } from "../../../../shared/desktop-contract";
import {
	GUARD_CONSENT_OPERATION,
	GUARD_SCOPE_ORDER,
	type GuardConsentDisclosure,
	type GuardScope,
} from "../../../../shared/guard-consent";
import type { MeshApprovalRow } from "../mesh/mesh-approvals";

/** `sha256:<64 hex>` - the exact pattern the host's closed body model accepts. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type GuardScopeLine = { scope: GuardScope; text: string };

export type GuardPromptView = {
	approvalId: string;
	tenant: string;
	/** The org's display name, verbatim and untrusted: render inside `<bdi>`. */
	org: string;
	widening: boolean;
	title: string;
	reasonLine: string;
	wouldSend: string;
	scopeLines: GuardScopeLine[];
	neverSent: string;
	visibility: string;
	background: string;
	/** The non-sharing choice; focus starts here (RFC §5.2.3). */
	noLabel: string;
	laterLabel: string;
	yesLabel: string;
	/** `null` unless the host says it may sign this exact card. */
	shareRequest: DesktopRequest | null;
	/** Always available: a decline is the safe direction and never signs. */
	declineRequest: DesktopRequest;
};

/** The scope's short label, for the `widened` reason's "<scopes>" list. */
function scopeLabel(scope: GuardScope): string {
	switch (scope) {
		case "decisions":
			return t("ui.guard.scope_label_decisions");
		case "posture":
			return t("ui.guard.scope_label_posture");
		case "task_time":
			return t("ui.guard.scope_label_task_time");
		case "review_cycles":
			return t("ui.guard.scope_label_review_cycles");
		case "reports":
			return t("ui.guard.scope_label_reports");
		case "trace_detail":
			return t("ui.guard.scope_label_trace_detail");
		case "admin_share":
			return t("ui.guard.scope_label_admin_share");
	}
}

/** The scope's full disclosure line (RFC §15.4' C4), org interpolated where it names one. */
function scopeLine(scope: GuardScope, org: string): string {
	switch (scope) {
		case "decisions":
			return t("ui.guard.scope_decisions");
		case "posture":
			return t("ui.guard.scope_posture");
		case "task_time":
			return t("ui.guard.scope_task_time");
		case "review_cycles":
			return t("ui.guard.scope_review_cycles");
		case "reports":
			return t("ui.guard.scope_reports", { org });
		case "trace_detail":
			return t("ui.guard.scope_trace_detail");
		case "admin_share":
			return t("ui.guard.scope_admin_share", { org });
	}
}

function reasonLine(
	reason: GuardConsentDisclosure["reason"],
	org: string,
	scopes: string,
): string {
	switch (reason) {
		case "new_org":
			return t("ui.guard.prompt_reason_new_org", { org });
		case "widened":
			return t("ui.guard.prompt_reason_widened", { org, scopes });
		case "reactivated":
			return t("ui.guard.prompt_reason_reactivated", { org });
		case "plan_gap":
			return t("ui.guard.prompt_reason_plan_gap", { org });
		case "new_device":
			return t("ui.guard.prompt_reason_new_device");
		case "rejoined":
			return t("ui.guard.prompt_reason_rejoined", { org });
	}
}

/**
 * The visibility sentence is chosen by what the org OFFERS (`grant_scopes`), not
 * by what this prompt asks: a widening that adds only `task_time` still tells a
 * member who is sharing `admin_share` that admins can see their own timing.
 */
function visibilityLine(offered: ReadonlySet<GuardScope>): string {
	const posture = offered.has("posture");
	const share = offered.has("admin_share");
	if (posture && share)
		return t("ui.guard.prompt_visibility_admin_share_posture");
	if (share) return t("ui.guard.prompt_visibility_admin_share");
	if (posture) return t("ui.guard.prompt_visibility_posture");
	return t("ui.guard.prompt_visibility");
}

/**
 * The typed accept request, or `null` when this row cannot send one.
 *
 * THE TWO DIGESTS ARE ECHOED FROM THE ROW, never rebuilt: the host recomputes
 * both from the record on disk and refuses a mismatch before it signs, so a
 * value computed here would bind bytes the host never served. The body has no
 * scope field - the accept is all-or-nothing by the host's own closed model.
 */
export function guardShareRequest(row: MeshApprovalRow): DesktopRequest | null {
	const typed = row.guard;
	if (row.kind !== "guard" || row.state !== "requested" || !typed) return null;
	const disclosure = typed.disclosure;
	if (typed.signable_here !== true || !disclosure) return null;
	if (disclosure.operation !== GUARD_CONSENT_OPERATION) return null;
	// A disclosure for another record is a stale or forged render, not this card.
	if (disclosure.approval_id !== row.approvalId) return null;
	const disclosureDigest = typed.disclosure_digest;
	if (
		!disclosureDigest ||
		!DIGEST.test(typed.request_digest) ||
		!DIGEST.test(disclosureDigest)
	)
		return null;
	return {
		op: "approvals.approveOperation",
		approvalId: row.approvalId,
		operation: GUARD_CONSENT_OPERATION,
		requestDigest: typed.request_digest,
		disclosureDigest,
	};
}

/**
 * The prompt view for a guard row, or `null` when the row carries no parseable
 * disclosure (an opaque card draws no disclosure rather than an invented one).
 */
export function guardPromptView(row: MeshApprovalRow): GuardPromptView | null {
	const disclosure = row.guard?.disclosure;
	if (row.kind !== "guard" || !disclosure) return null;
	const org = disclosure.org_display_name;
	const asked = new Set<GuardScope>(disclosure.asked_scopes);
	const ordered = GUARD_SCOPE_ORDER.filter((scope) => asked.has(scope));
	const widening = disclosure.reason === "widened";
	const labels = ordered.map(scopeLabel).join(", ");
	return {
		approvalId: row.approvalId,
		tenant: disclosure.tenant,
		org,
		widening,
		title: t("ui.guard.prompt_title", { org }),
		reasonLine: reasonLine(disclosure.reason, org, labels),
		wouldSend: t("ui.guard.prompt_would_send"),
		scopeLines: ordered.map((scope) => ({
			scope,
			text: scopeLine(scope, org),
		})),
		neverSent: t("ui.guard.prompt_never_sent"),
		visibility: visibilityLine(new Set<GuardScope>(disclosure.grant_scopes)),
		background: t("ui.guard.prompt_background"),
		noLabel: widening
			? t("ui.guard.button_keep_current")
			: t("ui.guard.button_dont_share"),
		laterLabel: t("ui.guard.button_decide_later"),
		yesLabel: widening
			? t("ui.guard.button_share_new")
			: t("ui.guard.button_share"),
		shareRequest: guardShareRequest(row),
		declineRequest: { op: "approvals.deny", approvalId: row.approvalId },
	};
}

/**
 * The prompts a person can review, oldest first: waiting (`requested`) guard
 * cards whose disclosure parsed. An opaque card (no parseable disclosure) is not
 * counted or listed - this surface has nothing honest to show for it, and the
 * terminal's /guard still answers it.
 */
export function guardWaitingViews(
	rows: readonly MeshApprovalRow[],
): GuardPromptView[] {
	const views: GuardPromptView[] = [];
	for (const row of rows) {
		if (row.kind !== "guard" || row.state !== "requested") continue;
		const view = guardPromptView(row);
		if (view) views.push(view);
	}
	return views;
}
