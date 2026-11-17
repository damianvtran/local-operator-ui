/**
 * The one-click fixes for a send that cannot happen, and the line that states
 * the block under the composer before any press.
 *
 * See `../send-recovery.ts` for the decision and the PostHog evidence behind
 * it. This file is only the presentation and the three presses:
 *
 * - `connect_provider` / `choose_model` open the connect dialog
 *   (`useConnectProviderStore.openConnect`). The dialog's Connected section is
 *   where a default model is chosen, so it is the one place both fixes land.
 * - `reconnect` runs `window.api.backend.reconnect()`, the same IPC the pane's
 *   status strip Retry uses, and then re-reads server health so the line clears
 *   itself when the service answers. The press holds a visible in-flight state
 *   and then states the result, because a recovery control that does not
 *   acknowledge the press is the one users press repeatedly (the D1/D9 pattern).
 */

import { useConnectProviderStore } from "@features/providers/connect-provider-store";
import { Button } from "@shared/components/ui";
import { useConnectivityStatus } from "@shared/hooks/use-connectivity-status";
import { formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { CircleAlert } from "lucide-react";
import { type FC, useCallback, useState } from "react";
import {
	type SendBlock,
	type SendRecovery,
	recoveryForBlock,
} from "../send-recovery";

/*
 * Seconds included on purpose: two presses inside one minute must not paint the
 * same sentence, or the second press reads as one that did nothing.
 */
export const CLOCK_WITH_SECONDS: Intl.DateTimeFormatOptions = {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
};

/** The words on the fix's control. */
export const recoveryLabel = (recovery: SendRecovery, busy = false): string => {
	if (recovery === "reconnect")
		return busy
			? t("ui.recovery.send.reconnecting")
			: t("ui.recovery.send.reconnect");
	if (recovery === "connect_provider")
		return t("ui.recovery.send.connect_provider");
	return t("ui.recovery.send.choose_model");
};

/** The sentence the composer shows for a block, before any press. */
export const blockSentence = (block: SendBlock): string => {
	if (block === "offline") return t("ui.recovery.composer.offline");
	if (block === "no_provider") return t("ui.recovery.composer.no_provider");
	return t("ui.recovery.composer.no_model");
};

/**
 * The press behind a fix, with its in-flight state and (for reconnect) the
 * outcome the press produced.
 */
export function useSendRecoveryAction(): {
	busy: boolean;
	outcome: string | null;
	run: (recovery: SendRecovery) => void;
} {
	const { refetchServerStatus } = useConnectivityStatus();
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<string | null>(null);
	const run = useCallback(
		(recovery: SendRecovery) => {
			if (recovery !== "reconnect") {
				useConnectProviderStore.getState().openConnect();
				return;
			}
			if (busy) return;
			setBusy(true);
			setOutcome(null);
			void (async () => {
				try {
					await window.api?.backend?.reconnect?.();
				} finally {
					const health = await refetchServerStatus();
					setBusy(false);
					/*
					 * A success clears the line by itself (the block goes away), so the
					 * outcome only needs to speak for the press that did not work.
					 */
					setOutcome(
						health?.data?.online === false
							? t("ui.recovery.send.still_offline", {
									time: formatTime(Date.now(), CLOCK_WITH_SECONDS),
								})
							: null,
					);
				}
			})();
		},
		[busy, refetchServerStatus],
	);
	return { busy, outcome, run };
}

/**
 * The presentational line, exported for stories and the focused test.
 *
 * PERSISTENT while the block holds, rather than the old five-second hint that
 * appeared only after a refused press: the user should know before pressing
 * Send. `emphasis` is the refused press (Enter, the Send control, a click into
 * the box): the line steps from dim to full ink so the press visibly lands on
 * the explanation without moving anything.
 */
export const SendBlockedLineView: FC<{
	block: SendBlock;
	emphasis?: boolean;
	busy?: boolean;
	outcome?: string | null;
	onFix: (recovery: SendRecovery) => void;
}> = ({ block, emphasis = false, busy = false, outcome = null, onFix }) => {
	useI18nLocale();
	const recovery = recoveryForBlock(block);
	return (
		<div
			data-send-blocked={block}
			data-emphasis={emphasis ? "" : undefined}
			className="flex flex-wrap items-center gap-x-2 gap-y-1"
		>
			{/*
			 * `<output>`: a status role, so a screen reader hears the block when it
			 * appears and when the sentence changes, without focus moving.
			 */}
			<output
				className={cn(
					"flex min-w-0 items-center gap-1.5 text-body-sm transition-colors duration-fast",
					emphasis ? "text-ink" : "text-ink-muted",
				)}
			>
				<CircleAlert
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0",
						block === "offline" ? "text-warning" : "text-ink-muted",
					)}
				/>
				<span>{outcome ?? blockSentence(block)}</span>
			</output>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				data-send-recovery={recovery}
				disabled={busy}
				onClick={() => onFix(recovery)}
			>
				{recoveryLabel(recovery, busy)}
			</Button>
		</div>
	);
};

/** The connected line the composer mounts. */
export const SendBlockedLine: FC<{ block: SendBlock; emphasis?: boolean }> = ({
	block,
	emphasis,
}) => {
	const { busy, outcome, run } = useSendRecoveryAction();
	return (
		<SendBlockedLineView
			block={block}
			emphasis={emphasis}
			busy={busy}
			outcome={block === "offline" ? outcome : null}
			onFix={run}
		/>
	);
};
