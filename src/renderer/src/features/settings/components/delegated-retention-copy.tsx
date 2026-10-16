import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
/**
 * The plain-language explainer under the "Delegated work" group's title.
 *
 * WHY THE DESKTOP WRITES THIS ITSELF. The registry's section description is one
 * long sentence written for a terminal footer; here it would be the whole of the
 * explanation for a policy that DELETES data by default, in a single unbroken
 * paragraph. Three short lines answer the three questions a reader has - what is
 * removed, what is kept, and when - and one more says what the first launch will
 * feel like. The facts are the backend's (`delegated_retention.py`, rules 1-6);
 * only the layout is ours, and `scripts/retention-duration.test.mjs` pins the
 * section name this replaces so a rename cannot leave the registry's version
 * showing beside it.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. Forks (`/fork`) are NOT listed as removed:
 * the backend treats a fork as the reader's own conversation
 * (`resume.USER_ORIGINS`), so a sentence naming them would promise a deletion
 * that never happens. There is also no pull-request registry in the harness, so
 * "linked to an open PR" is not offered as a protection.
 */

import type { FC } from "react";

const Line: FC<{ term: string; children: React.ReactNode }> = ({
	term,
	children,
}) => {
	useI18nLocale();
	return (
		<p className="text-meta text-ink-dim">
			<span className="font-medium text-ink-muted">{term}</span> {children}
		</p>
	);
};

export const DelegatedRetentionCopy: FC = () => {
	useI18nLocale();
	return (
		<div
			data-delegated-retention-copy=""
			className="flex flex-col gap-1 px-1 pb-2"
		>
			<Line
				term={t("ui.settings.configuration.delegated_retention_copy.removed")}
			>
				{t(
					"ui.settings.configuration.delegated_retention_copy.sessions_started_by_subagents_agent_shells_and_background_runs_su",
				)}{" "}
				<code className="font-mono">
					{
						"lop exec" /* Machine command example; preserve exact shell syntax. */
					}
				</code>
				{t(
					"ui.settings.configuration.delegated_retention_copy.never_your_own_conversations_or_the_workstreams_in_your_sidebar",
				)}
			</Line>
			<Line term={t("ui.settings.configuration.delegated_retention_copy.kept")}>
				{t(
					"ui.settings.configuration.delegated_retention_copy.anything_running_or_waiting_anything_whose_parent_conversation_wa",
				)}
			</Line>
			<Line term={t("ui.settings.configuration.delegated_retention_copy.when")}>
				{t(
					"ui.settings.configuration.delegated_retention_copy.after_the_time_below_with_no_activity_checked_when_the_app_starts",
				)}
			</Line>
		</div>
	);
};
