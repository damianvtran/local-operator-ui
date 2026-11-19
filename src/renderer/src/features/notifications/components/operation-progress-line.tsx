import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import type { OperationProgress } from "../notification-operations";

/**
 * The three-way receipt for a bulk read, dismiss or Undo: how many rows the
 * server confirmed, how many it explicitly skipped, and how many never got a
 * conclusive answer. It exists because the alternative — a toast that says
 * "Dismissed" and stops there — is a claim the client cannot make when it only
 * sent tokens for part of the queue or lost a response mid-batch (R3/Q3).
 *
 * Extracted from the page so the line can be rendered and signed off from a
 * seeded story: its wording is the only place a partial result becomes visible,
 * and a state that only appears after a racing write or a dropped connection is
 * not something a reviewer can summon by hand.
 */
export const OperationProgressLine: FC<{ progress: OperationProgress }> = ({
	progress,
}) => {
	useI18nLocale();
	return (
		<output
			className="shrink-0 px-6 py-1 text-meta text-ink-muted"
			data-notification-operation=""
		>
			{t("ui.notifications.operation.progress", progress)}
		</output>
	);
};
