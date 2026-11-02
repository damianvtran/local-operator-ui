import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { PaneError } from "./detail-parts";

/**
 * A detail read owns its presentation, not the backend's English fallback prose.
 * Match the server's stable category; a 404 alone may also mean an unavailable
 * route, and must not be relabelled as a removed definition. Older servers sent
 * the same sentence without an envelope, so recognize that exact legacy value
 * only when no category was declared. Unknown refusals retain their diagnosis.
 */
export function MissingDefinitionError({
	name,
	error,
	onRetry,
	retrying,
}: {
	name: string;
	error: unknown;
	onRetry: () => void;
	retrying: boolean;
}) {
	useI18nLocale();
	const missing =
		error instanceof DesktopControlError &&
		(error.code === "wire.errors.desktop.requested_not_found" ||
			(!error.code &&
				error.status === 404 &&
				// i18n: ignore Exact legacy wire sentinel, never rendered as copy
				error.message ===
					"Requested session, profile, team or subscription not found"));
	return (
		<PaneError
			title={t("ui.agents.detail.read_state.failed_title", { name })}
			what={
				missing
					? t("ui.agents.detail.read_state.not_found")
					: error instanceof Error
						? error.message
						: t("ui.agents.detail.read_state.request_failed")
			}
			meaning={t("ui.agents.detail.read_state.failed_meaning")}
			retryLabel={t("ui.agents.detail.read_state.retry")}
			retryingLabel={t("ui.agents.detail.read_state.retrying")}
			onRetry={onRetry}
			retrying={retrying}
		/>
	);
}
