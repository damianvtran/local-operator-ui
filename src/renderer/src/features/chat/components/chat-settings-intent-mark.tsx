/*
 * THE SIDEBAR ROW'S SETTINGS-INTENT DOT (`features.settings_intents`).
 *
 * A model/effort/cwd change keeps applying after the user has moved to another
 * conversation - that is the point of a durable intent - so the row is where
 * they can still see it: a small pulsing dot while the server is applying it,
 * a warning dot once it failed (the chip with Retry is on that conversation's
 * composer). It draws NOTHING when the session holds no live or failed slot,
 * which is always the case without the capability, so a backend that does not
 * advertise it renders exactly today's row.
 *
 * Reads one primitive off the store per row (`"applying" | "failed" | null`),
 * so a slot moving on one session re-renders that row and no other.
 */
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { intentIndicator } from "@shared/store/settings-intents";
import type { FC } from "react";

export type SettingsIntentMarkState = "applying" | "failed" | null;

/** The dot itself, separated from the store so stories can pin each state. */
export const SettingsIntentDot: FC<{ state: SettingsIntentMarkState }> = ({
	state,
}) => {
	useI18nLocale();
	if (state === null) return null;
	const label =
		state === "failed"
			? t("ui.chat.settings_intents.row_failed")
			: t("ui.chat.settings_intents.row_applying");
	return (
		<span
			data-settings-intent-mark={state}
			role="img"
			aria-label={label}
			title={label}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<span
				aria-hidden="true"
				className={cn(
					"block size-1.5 rounded-full",
					state === "failed"
						? "bg-warning"
						: "bg-ink-dim motion-safe:animate-pulse",
				)}
			/>
		</span>
	);
};

export const ChatSettingsIntentMark: FC<{ sessionId: string }> = ({
	sessionId,
}) => {
	const state = useCanonicalSessionsStore((store) =>
		intentIndicator(store.settingsIntents[sessionId]),
	);
	return <SettingsIntentDot state={state} />;
};
