/**
 * SESSION VOICE'S PASSIVE MARKS (the backend's `docs/design/qwen-voice.md`).
 *
 * - `VoiceRowMarker`: the sidebar row's "voice on" mark, drawn on exactly the row
 *   whose session holds the machine-wide slot. Because the slot has one holder,
 *   at most one row carries it, and a switch moves it.
 * - `VoicePhase`: the header's word for where voice is on the session that holds
 *   the slot - starting, ready-but-unheard (with "Open voice page"), listening,
 *   working, error (with its reason and "Try again") - from the slot, main's rig
 *   status and this window's exchange (`voicePhaseOf`). While the slot is held
 *   and the rig is STOPPED (the app was relaunched with voice still on; main
 *   never loads the models by itself), it offers "Start voice", which asks main
 *   to start the rig (`voice.qwen.start`).
 *
 * Both render nothing when `features.voice` is absent. Ink, not controls, except
 * the start, open-page and try-again actions.
 */

import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { AudioLines } from "lucide-react";
import type { FC } from "react";
import type { QwenVoiceStatus } from "../../../../shared/desktop-contract";
import { startQwenRig } from "./qwen-voice-controller";
import { useVoiceCapability } from "./use-voice-status";
import {
	type VoiceExchangeError,
	useVoiceStore,
	voicePhaseOf,
} from "./voice-store";

export const VoiceRowMarker: FC<{ sessionId: string }> = ({ sessionId }) => {
	useI18nLocale();
	const enabled = useVoiceCapability();
	const on = useVoiceStore((s) => s.active?.session_id === sessionId);
	if (!enabled || !on) return null;
	return (
		<>
			<AudioLines
				aria-hidden="true"
				data-voice-marker=""
				className="ml-1 size-3.5 shrink-0 text-accent"
			/>
			<span className="sr-only">, {t("ui.chat.voice.marker")}</span>
		</>
	);
};

const PHASE_KEY = {
	starting: "ui.chat.voice.phase_starting",
	listening: "ui.chat.voice.phase_listening",
	working: "ui.chat.voice.phase_working",
} as const;

/** A small text action beside the phase word, the "Start voice" shape. */
const PhaseAction: FC<{
	phase: string;
	label: string;
	onPress: () => void;
}> = ({ phase, label, onPress }) => (
	<Button
		variant="ghost"
		size="sm"
		data-voice-action={phase}
		onClick={onPress}
		className="shrink-0 text-meta"
	>
		{label}
	</Button>
);

/**
 * The reason an error shows as visible text. A RIG error wins (U9) and shows
 * main's own sentence for a start failure - "Port 8765 is in use; ...",
 * "Voice rig not found at ..." - because the cause is what Ben can act on
 * (design round 2, D10; UX U8); the generic line is only the fallback for a
 * status that carries none.
 */
function errorReason(
	rig: QwenVoiceStatus | undefined,
	exchange: VoiceExchangeError | undefined,
): string {
	if (rig?.rig === "error") {
		if (rig.cause === "unexpected_exit") return t("ui.chat.voice.error_exited");
		const reason = rig.reason?.trim();
		return reason
			? reason.charAt(0).toUpperCase() + reason.slice(1)
			: t("ui.chat.voice.error_start_failed");
	}
	if (exchange === "not_sent") return t("ui.chat.voice.error_not_sent");
	return t("ui.chat.voice.error_start_failed");
}

export const VoicePhase: FC<{ sessionId: string | undefined }> = ({
	sessionId,
}) => {
	useI18nLocale();
	const enabled = useVoiceCapability();
	const holds = useVoiceStore((s) => s.active?.session_id === sessionId);
	const phase = useVoiceStore((s) => voicePhaseOf(s, sessionId));
	const rig = useVoiceStore((s) => s.rig);
	const exchangeReason = useVoiceStore((s) =>
		s.exchange?.sessionId === sessionId ? s.exchange?.reason : undefined,
	);
	const cardPending = useVoiceStore((s) =>
		sessionId ? Boolean(s.cardPending[sessionId]) : false,
	);
	if (!enabled || !sessionId || !holds) return null;
	if (rig?.rig === "stopped") {
		return (
			<Button
				variant="ghost"
				size="sm"
				data-voice-phase="stopped"
				onClick={() => void startQwenRig()}
				className="shrink-0 text-meta"
			>
				{t("ui.chat.voice.start_rig")}
			</Button>
		);
	}
	if (phase === "off") return null;
	/*
	 * A CARD ON SCREEN REPLACES "Listening" AND "Working": words spoken now are
	 * refused (V13), so the line says what to do instead. "Working" too, because
	 * the usual way a card appears is a turn voice itself started, which holds
	 * the phase at working until it ends. Guidance, not an alarm: the card
	 * itself is the alarm, so the hint is the phase word's own ink.
	 */
	if ((phase === "listening" || phase === "working") && cardPending) {
		return (
			<span
				data-voice-phase="listening"
				data-voice-hint="card"
				className="shrink-0 whitespace-nowrap text-meta text-ink-muted"
			>
				{t("ui.chat.voice.card_pending_short")}
			</span>
		);
	}
	/*
	 * READY, BUT NOTHING CAN HEAR (round 1, D2/U2): the rig is up and no voice
	 * page is connected - Ben closed the tab, or never pressed "Enable voice".
	 * Saying "Listening" here was the lie; the action opens the page again.
	 */
	if (phase === "unheard") {
		return (
			<span
				data-voice-phase="unheard"
				className="flex shrink-0 items-center gap-1 whitespace-nowrap text-meta text-ink-muted"
			>
				{t("ui.chat.voice.phase_unheard")}
				<PhaseAction
					phase="open"
					label={t("ui.chat.voice.open_page")}
					onPress={() => void startQwenRig()}
				/>
			</span>
		);
	}
	/*
	 * AN ERROR SAYS WHY, IN TEXT (round 1, D5/U3): a tooltip is not read by
	 * anyone who does not hover. A rig error offers "Try again", which restarts
	 * the rig; an exchange error (one take not sent) clears on the next take, so
	 * it names what happened and offers nothing to restart.
	 *
	 * THE REASON YIELDS FIRST (design round 2, D9). A cause such as "Voice rig
	 * not found at /Users/..." is long, and the header's title block is
	 * `flex-1 basis-0`, so it only ever gets what the trailing cluster leaves:
	 * an uncapped reason (and, measured, even one capped at 40% of the row)
	 * took the title to 0px at an 800px window. So the reason's width is what
	 * the header row (`chathdr`'s container width) has left after 41rem: the
	 * room the title, the agent/team/device chips and the trailing controls
	 * need. Below 3rem of it (a header row under 44rem, an ~800px window) the
	 * reason is hidden rather than drawn as a one-letter stub - measured "V."
	 * at 800px - and "Voice error" plus "Try again" stand alone with the full
	 * text in the tooltip. On a wide window the reason shows, truncating.
	 */
	if (phase === "error") {
		return (
			<output
				data-voice-phase="error"
				title={rig?.reason ?? undefined}
				className="flex min-w-0 shrink items-center gap-1 text-meta"
			>
				<span className="shrink-0 whitespace-nowrap text-danger">
					{t("ui.chat.voice.phase_error")}
				</span>
				<span
					data-voice-reason=""
					className="min-w-0 max-w-[max(0px,calc(100cqw-41rem))] truncate text-ink-muted @max-[44rem]/chathdr:hidden"
				>
					{errorReason(rig, exchangeReason)}
				</span>
				{rig?.rig !== "error" && exchangeReason ? null : (
					<PhaseAction
						phase="retry"
						label={t("ui.chat.voice.try_again")}
						onPress={() => void startQwenRig()}
					/>
				)}
			</output>
		);
	}
	return (
		<output
			data-voice-phase={phase}
			className="shrink-0 whitespace-nowrap text-meta text-ink-muted"
		>
			{t(PHASE_KEY[phase])}
		</output>
	);
};
