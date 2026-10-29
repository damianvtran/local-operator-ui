import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import type { AgentMessagesRefusal } from "../../../../shared/agent-messages-contract";

const REFUSAL_CONTROLS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Refusal copy is server-authored text, never HTML, markdown or an exception.
 *
 * Its own module because the settings suite must exercise THIS mapper: while
 * it lived beside the hooks, the suite stubbed the whole hook module and
 * silently replaced the mapper with a raw-error passthrough, so a leak of
 * exception text would have passed.
 */
export function agentMessagesRefusal(error: unknown): AgentMessagesRefusal {
	const plain = (value: string) =>
		value.replace(REFUSAL_CONTROLS, "").slice(0, 1024);
	if (error instanceof DesktopControlError) {
		const body =
			typeof error.detail === "object" && error.detail !== null
				? (error.detail as { details?: { field?: unknown; rule?: unknown } })
				: null;
		const details = body?.details;
		return {
			code: error.code ?? "desktop_refused",
			message: plain(error.message),
			...(typeof details?.field === "string" && typeof details.rule === "string"
				? {
						details: { field: plain(details.field), rule: plain(details.rule) },
					}
				: {}),
		};
	}
	return {
		code: "client_unavailable",
		message: t("ui.agentMessages.dialog.failure"),
	};
}
