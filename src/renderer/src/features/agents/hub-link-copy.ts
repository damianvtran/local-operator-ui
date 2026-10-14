import type { HubDirectionStatus } from "@shared/api/local-operator/hub-links";
import { t } from "@shared/i18n";

/**
 * Translate service codes at the point of use. No raw exception or private body
 * belongs in a collapsed tooltip. Unknown code/state degrades to explanatory
 * detail, never a green success or an inferred permission to publish.
 */
export function hubReasonText(reason: string | null | undefined): string {
	switch (reason?.split("/")[0]) {
		case "unsupported-precondition":
			return t("ui.hub.status.unsupported");
		case "baseline-unknown":
			return t("ui.hub.status.baseline_unknown");
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
		default:
			return t("ui.hub.status.other_error");
	}
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
			return t("ui.hub.status.unknown", { state: status.state });
	}
}
