/**
 * SESSION VOICE'S PASSIVE MARKS (the backend's `docs/design/qwen-voice.md`).
 *
 * - `VoiceRowMarker`: the sidebar row's "voice on" mark, drawn on exactly the row
 *   whose session holds the machine-wide slot. Because the slot has one holder,
 *   at most one row carries it, and a switch moves it.
 * - `VoicePhase`: the header's word for where voice is on the session that holds
 *   the slot - starting, listening, working, error - from the slot, main's rig
 *   status and this window's exchange (`voicePhaseOf`). While the slot is held
 *   and the rig is STOPPED (the app was relaunched with voice still on; main
 *   never loads the models by itself), it offers "Start voice", which asks main
 *   to start the rig (`voice.qwen.start`).
 *
 * Both render nothing when `features.voice` is absent. Ink, not controls, except
 * the one start action.
 */

import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AudioLines } from "lucide-react";
import type { FC } from "react";
import { startQwenRig } from "./qwen-voice-controller";
import { useVoiceCapability } from "./use-voice-status";
import { useVoiceStore, voicePhaseOf } from "./voice-store";

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
	error: "ui.chat.voice.phase_error",
} as const;

export const VoicePhase: FC<{ sessionId: string | undefined }> = ({
	sessionId,
}) => {
	useI18nLocale();
	const enabled = useVoiceCapability();
	const holds = useVoiceStore((s) => s.active?.session_id === sessionId);
	const phase = useVoiceStore((s) => voicePhaseOf(s, sessionId));
	const rig = useVoiceStore((s) => s.rig);
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
	 * A CARD ON SCREEN REPLACES "Listening": words spoken now are refused (V13),
	 * so the line says what to do instead. Guidance, not an alarm: the card
	 * itself is the alarm.
	 */
	if (phase === "listening" && cardPending) {
		return (
			<span
				data-voice-phase="listening"
				data-voice-hint="card"
				className="shrink-0 whitespace-nowrap text-meta text-ink-dim"
			>
				{t("ui.chat.voice.card_pending")}
			</span>
		);
	}
	return (
		<output
			data-voice-phase={phase}
			title={phase === "error" ? (rig?.reason ?? undefined) : undefined}
			className={cn(
				"shrink-0 whitespace-nowrap text-meta",
				phase === "error" ? "text-danger" : "text-ink-muted",
			)}
		>
			{t(PHASE_KEY[phase])}
		</output>
	);
};
