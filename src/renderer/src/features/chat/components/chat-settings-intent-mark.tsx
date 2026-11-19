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
 * WHERE IT SITS (design D4). It is drawn INSIDE the row's fixed locality cell,
 * absolutely positioned, so it never takes width of its own: a dot appearing
 * or settling does not shift the title (it shifted 18 px when it was a flex
 * item, row by row through a burst of picks). A local row's cell is empty, so
 * the dot sits in its centre; a remote row's cell holds the locality mark, so
 * the dot rides its corner as a badge.
 *
 * WHAT IT SAYS (UX U4). The tooltip and accessible name are the slot's own
 * chip sentence - "Couldn't switch to X: <reason>" - so a failure on a
 * conversation the user left names which change failed; the generic row
 * sentence is only the fallback for a slot with nothing to describe.
 *
 * Reads one slot reference off the store per row, so a slot moving on one
 * session re-renders that row and no other.
 */
import { settingsIntentChipText } from "@features/chat/session-status/settings-intent-chips";
import { useHomeDirectory } from "@shared/hooks/use-home-directory";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	type MirroredIntent,
	indicatorIntent,
} from "@shared/store/settings-intents";
import { formatDirectory } from "@shared/utils/path-utils";
import type { FC } from "react";

export type SettingsIntentMarkState = "applying" | "failed" | null;

/** The dot itself, separated from the store so stories can pin each state. */
export const SettingsIntentDot: FC<{
	state: SettingsIntentMarkState;
	/** The slot's chip sentence; the generic row sentence when absent. */
	description?: string;
	/** Badge on an occupied locality cell (remote row) rather than its centre. */
	corner?: boolean;
}> = ({ state, description, corner = false }) => {
	useI18nLocale();
	if (state === null) return null;
	const label =
		description ||
		(state === "failed"
			? t("ui.chat.settings_intents.row_failed")
			: t("ui.chat.settings_intents.row_applying"));
	return (
		<span
			data-settings-intent-mark={state}
			role="img"
			aria-label={label}
			title={label}
			className={cn(
				"absolute flex items-center justify-center",
				corner ? "-end-0.5 -top-0.5 size-2" : "inset-0",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"block size-1.5 rounded-full",
					// A surface ring keeps the badge legible over the locality mark.
					corner && "ring-1 ring-surface",
					// `lo-intent-pulse` dips to 0.75, not `animate-pulse`'s 0.5, so the
					// trough keeps 3:1 non-text contrast (design D5; styles/index.css).
					state === "failed" ? "bg-warning" : "lo-intent-pulse bg-ink-dim",
				)}
			/>
		</span>
	);
};

export const ChatSettingsIntentMark: FC<{
	sessionId: string;
	corner?: boolean;
}> = ({ sessionId, corner }) => {
	const intent = useCanonicalSessionsStore((store) =>
		indicatorIntent(store.settingsIntents[sessionId]),
	);
	const home = useHomeDirectory();
	if (!intent) return null;
	return (
		<SettingsIntentDot
			state={intent.state === "failed" ? "failed" : "applying"}
			description={describe(intent, home)}
			corner={corner}
		/>
	);
};

function describe(intent: MirroredIntent, home: string | null): string {
	return settingsIntentChipText(intent, undefined, (dir) =>
		formatDirectory(dir, home),
	);
}
