/**
 * The one-click fixes for a send that cannot happen, the line that states the
 * block under the composer before any press, and the failed-send row's view.
 *
 * See `../send-recovery.ts` for the decision and the PostHog evidence behind
 * it. This file is only the presentation and the four presses:
 *
 * - `connect_provider` opens the connect dialog
 *   (`useConnectProviderStore.openConnect`).
 * - `choose_model` opens the composer's model picker when the caller can
 *   (`onChooseModel`; UX round 1, U3), and the connect dialog otherwise, whose
 *   Connected section is where a default model is chosen.
 * - `use_local` makes the local runtime the conversation already picked a model
 *   on the default for chats (`../../providers/local-default.ts`; UX round 1, U1).
 * - `reconnect` runs `window.api.backend.reconnect()`, the same IPC the pane's
 *   status strip Retry uses, and then re-reads server health so the line clears
 *   itself when the service answers. The press holds a visible in-flight state
 *   and then states the result, because a recovery control that does not
 *   acknowledge the press is the one users press repeatedly (the D1/D9 pattern).
 */

import { useConnectProviderStore } from "@features/providers/connect-provider-store";
import { useMakeLocalDefault } from "@features/providers/local-default";
import { brandOf } from "@features/providers/provider-catalog";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui";
import { readServerHealthNow } from "@shared/hooks/use-connectivity-status";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { CircleAlert } from "lucide-react";
import { type FC, useCallback, useRef, useState } from "react";
import {
	type SendBlock,
	type SendRecovery,
	keepsSendAgain,
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

/*
 * THE PERCEPTION FLOOR the local check uses (`provider-detail.tsx`), for the
 * same reason: the reconnect IPC fails in 10-18 ms when the service is down (QA
 * round 1, Q2, measured with a MutationObserver), so "Reconnecting…" never
 * painted and the press looked ignored. Only fast answers are lengthened.
 */
const RECONNECT_FLOOR_MS = 400;

/**
 * The local runtime a conversation's chosen model is on, when it is one: the
 * fact `local_not_default` and `use_local` need (UX round 1, U1).
 */
export type LocalSelection = {
	provider: string;
	model_id: string;
	brand: string;
};

/** The words on the fix's control. */
export const recoveryLabel = (
	recovery: SendRecovery,
	busy = false,
	brand = "",
): string => {
	if (recovery === "reconnect")
		return busy
			? t("ui.recovery.send.reconnecting")
			: t("ui.recovery.send.reconnect");
	if (recovery === "use_local")
		return busy
			? t("ui.recovery.local.using_for_chats", { brand })
			: t("ui.recovery.local.use_for_chats", { brand });
	if (recovery === "connect_provider")
		return t("ui.recovery.send.connect_provider");
	return t("ui.recovery.send.choose_model");
};

/** The sentence the composer shows for a block, before any press. */
export const blockSentence = (block: SendBlock, brand = ""): string => {
	if (block === "offline") return t("ui.recovery.composer.offline");
	if (block === "no_provider") return t("ui.recovery.composer.no_provider");
	if (block === "local_not_default")
		return t("ui.recovery.composer.local_not_default", { brand });
	return t("ui.recovery.composer.no_model");
};

/**
 * One reconnect press, start to stated result. Pure apart from its injected
 * effects, so the focused test drives the real sequence (QA round 1, Q2).
 *
 * Returns the outcome sentence when the service is STILL not answering, and
 * `null` when it answers (the block, or the row's reason, clears by itself).
 *
 * NEVER SILENT (agent review round 1, M2): a rejected reconnect IPC is caught and
 * health is still read, and a health read that itself throws is treated as
 * "still not answering" - the press always ends in a stated state.
 */
export async function reconnectOutcome(deps: {
	reconnect?: () => Promise<unknown>;
	readHealth: () => Promise<{ online: boolean } | undefined>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	floorMs?: number;
}): Promise<string | null> {
	const now = deps.now ?? Date.now;
	const sleep =
		deps.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const started = now();
	try {
		await deps.reconnect?.();
	} catch {
		// Stated below by the health read; a failed re-dial is not an answer.
	}
	let online = false;
	try {
		online = (await deps.readHealth())?.online !== false;
	} catch {
		online = false;
	}
	const remaining = (deps.floorMs ?? RECONNECT_FLOOR_MS) - (now() - started);
	if (remaining > 0) await sleep(remaining);
	return online
		? null
		: t("ui.recovery.send.still_offline", {
				time: formatTime(now(), CLOCK_WITH_SECONDS),
			});
}

/**
 * Which local runtime a conversation's chosen model is on, from the census the
 * chat already holds (`useDesktopProviders`, 30 s stale time: no poll). `null`
 * for a hosted model, no selection, or a census not read yet.
 */
export function useLocalSelection(
	selection: { provider?: string; model_id?: string } | null | undefined,
	enabled: boolean,
): LocalSelection | null {
	const census = useDesktopProviders(enabled);
	if (!enabled || !selection?.provider || !selection.model_id) return null;
	const row = census.data?.find((entry) => entry.id === selection.provider);
	if (!row?.local) return null;
	return {
		provider: row.id,
		model_id: selection.model_id,
		brand: brandOf(row),
	};
}

/**
 * The press behind a fix, with its in-flight state and the outcome the press
 * produced (a reconnect that found the service still down, a default write the
 * settings registry refused).
 */
export function useSendRecoveryAction(
	options: {
		local?: LocalSelection | null;
		/** Opens a model picker; returns false when there is none to open. */
		onChooseModel?: () => boolean;
	} = {},
): {
	busy: boolean;
	outcome: string | null;
	run: (recovery: SendRecovery) => void;
} {
	/*
	 * Optional, not `useQueryClient()`: this hook sits under the shared composer,
	 * which must mount with no `QueryClientProvider` (the mini view). Without one,
	 * the reconnect's health read is an explicit `fetchQuery` on the inert
	 * fallback - a direct read whose answer this press consumes itself, never a
	 * cached query anything else observes.
	 */
	const { client: queryClient } = useOptionalQueryClient();
	const makeDefault = useMakeLocalDefault();
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<string | null>(null);
	/* The one-press lock, a ref so two presses in one tick cannot both start. */
	const inFlight = useRef(false);
	const { local, onChooseModel } = options;
	const run = useCallback(
		(recovery: SendRecovery) => {
			if (recovery === "connect_provider") {
				useConnectProviderStore.getState().openConnect();
				return;
			}
			if (recovery === "choose_model") {
				if (!onChooseModel?.())
					useConnectProviderStore.getState().openConnect();
				return;
			}
			if (inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			setOutcome(null);
			void (async () => {
				try {
					if (recovery === "use_local") {
						if (!local) return;
						const ok = await makeDefault.run(local);
						if (!ok)
							setOutcome(
								t("ui.recovery.send.use_local_failed", { brand: local.brand }),
							);
						return;
					}
					setOutcome(
						await reconnectOutcome({
							reconnect: async () => window.api?.backend?.reconnect?.(),
							readHealth: () => readServerHealthNow(queryClient),
						}),
					);
				} finally {
					inFlight.current = false;
					setBusy(false);
				}
			})();
		},
		[local, makeDefault, onChooseModel, queryClient],
	);
	return { busy, outcome, run };
}

/*
 * The in-flight state of a fix control (design round 1, D1): the label IS the
 * status a press gets, so it keeps the body's muted ink (8.37:1 measured) rather
 * than the disabled palette (2.65:1), and the press is refused with
 * `aria-disabled`/`aria-busy` and an early return instead of `disabled`.
 */
const BUSY_CONTROL = "cursor-progress text-ink-muted";

/**
 * The presentational line, exported for stories and the focused test.
 *
 * PERSISTENT while the block holds, rather than the old five-second hint that
 * appeared only after a refused press: the user should know before pressing
 * Send. `emphasis` is the refused press (Enter, the Send control, a click into
 * the box): the line steps from dim to full ink so the press visibly lands on
 * the explanation without moving anything.
 *
 * `cue` (design round 1, D5): a count of refused presses. Each new value
 * re-keys the fix control, which replays its one-shot `lo-refused-cue` ring, so
 * the second and fifth refused Enter each give a new signal rather than only
 * the first. Reduced motion keeps the ink step and drops the ring (index.css).
 */
export const SendBlockedLineView: FC<{
	block: SendBlock;
	emphasis?: boolean;
	cue?: number;
	busy?: boolean;
	outcome?: string | null;
	brand?: string;
	onFix: (recovery: SendRecovery) => void;
}> = ({
	block,
	emphasis = false,
	cue = 0,
	busy = false,
	outcome = null,
	brand = "",
	onFix,
}) => {
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
				<span>{outcome ?? blockSentence(block, brand)}</span>
			</output>
			<Button
				key={cue}
				type="button"
				variant={recovery === "use_local" ? "primary" : "secondary"}
				size="sm"
				data-send-recovery={recovery}
				data-cue={cue > 0 ? cue : undefined}
				aria-disabled={busy || undefined}
				aria-busy={busy || undefined}
				className={cn(cue > 0 && "lo-refused-cue", busy && BUSY_CONTROL)}
				onClick={() => {
					if (!busy) onFix(recovery);
				}}
			>
				{recoveryLabel(recovery, busy, brand)}
			</Button>
		</div>
	);
};

/** The connected line the composer mounts. */
export const SendBlockedLine: FC<{
	block: SendBlock;
	emphasis?: boolean;
	cue?: number;
	local?: LocalSelection | null;
	onChooseModel?: () => boolean;
}> = ({ block, emphasis, cue, local, onChooseModel }) => {
	const { busy, outcome, run } = useSendRecoveryAction({
		local,
		onChooseModel,
	});
	return (
		<SendBlockedLineView
			block={block}
			emphasis={emphasis}
			cue={cue}
			busy={busy}
			outcome={
				block === "offline" || block === "local_not_default" ? outcome : null
			}
			brand={local?.brand}
			onFix={run}
		/>
	);
};

/**
 * What a failed row SAYS, given its fix (agent review round 1, M4; QA Q2).
 *
 * - A press that produced a result states it (a reconnect that found the
 *   service still down), in the row it was pressed in, as the composer does.
 * - When the live block REPLACES Send again, the store's "…sending it again is
 *   safe" would contradict the controls beside it, so the block's own sentence
 *   is shown instead.
 * - Otherwise the store's sentence, which for a configuration cause is already
 *   this app's own (R1).
 */
export function undeliveredSentence(input: {
	message?: string;
	recovery: SendRecovery | null;
	block: SendBlock | null;
	outcome?: string | null;
	brand?: string;
}): string {
	if (input.outcome) return input.outcome;
	if (input.block && !keepsSendAgain(input.recovery))
		return blockSentence(input.block, input.brand);
	return input.message ?? t("ui.chat.canonical.transcript.not_delivered");
}

/**
 * §F3's line under a message that did not go out, presentational: exported so
 * stories and the focused test render every state without the live reads.
 * `UndeliveredLine` (canonical-transcript.tsx) composes it.
 */
export const UndeliveredLineView: FC<{
	sentence: string;
	recovery: SendRecovery | null;
	offerSendAgain: boolean;
	retryDisabled?: boolean;
	busy?: boolean;
	brand?: string;
	onFix: (recovery: SendRecovery) => void;
	onSendAgain: () => void;
	onEdit: () => void;
}> = ({
	sentence,
	recovery,
	offerSendAgain,
	retryDisabled = false,
	busy = false,
	brand = "",
	onFix,
	onSendAgain,
	onEdit,
}) => {
	useI18nLocale();
	return (
		<div
			data-undelivered
			className={cn(
				"flex w-full items-center justify-end gap-3 text-danger text-meta",
			)}
		>
			{/*
			 * `<output>` so a reconnect's stated result is announced where it was
			 * pressed, without moving focus.
			 */}
			<output data-undelivered-sentence="" className="flex items-center gap-1">
				<CircleAlert aria-hidden="true" className={cn("size-3.5 shrink-0")} />
				{sentence}
			</output>
			{recovery !== null && (
				<button
					type="button"
					data-undelivered-recovery={recovery}
					aria-disabled={busy || undefined}
					aria-busy={busy || undefined}
					className={cn(
						"shrink-0 whitespace-nowrap",
						busy ? BUSY_CONTROL : "cursor-pointer font-medium underline",
					)}
					onClick={() => {
						if (!busy) onFix(recovery);
					}}
				>
					{recoveryLabel(recovery, busy, brand)}
				</button>
			)}
			{offerSendAgain && (
				<button
					type="button"
					/*
					 * DIMMED, NOT GONE, while the composer holds this payload (UX round
					 * 1, U4): the row keeps its statement and both controls, and the
					 * box's own Send is the live affordance for this message until the
					 * text changes. `aria-disabled` rather than `disabled` - see the
					 * `UndeliveredTurn.retryDisabled` note.
					 */
					aria-disabled={retryDisabled || undefined}
					className={cn(
						"shrink-0 whitespace-nowrap",
						retryDisabled ? "text-ink-muted" : "cursor-pointer underline",
					)}
					onClick={(event) => {
						if (retryDisabled) {
							event.preventDefault();
							return;
						}
						onSendAgain();
					}}
				>
					{t("ui.chat.canonical.transcript.send_again")}
				</button>
			)}
			<button
				type="button"
				className={cn("shrink-0 cursor-pointer whitespace-nowrap underline")}
				onClick={onEdit}
			>
				{t("ui.chat.canonical.transcript.edit")}
			</button>
		</div>
	);
};
