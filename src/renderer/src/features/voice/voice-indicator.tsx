/**
 * SESSION VOICE'S TWO PASSIVE MARKS (`docs/design/session-voice.md`).
 *
 * - `VoiceRowMarker`: the sidebar row's "voice on" mark, drawn on exactly the row
 *   whose session holds the machine-wide slot. Because the slot has one holder,
 *   at most one row in the panel carries it, and a switch moves it - which is
 *   how "enabling B turns A off" is visible without opening A.
 * - `VoicePhase`: the header's word for where this window's exchange is
 *   (listening / sending / working / speaking / error), beside the toggle, on the
 *   session that holds the slot only - and, while idle there, the hold hint.
 *
 * Both render nothing when `features.voice` is absent. Ink, not controls: the
 * row marker is `aria-hidden` with an `sr-only` sentence, the row idiom
 * `chat-sidebar.tsx` uses for its other marks.
 */

import { resolvePushToTalkBinding } from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AudioLines } from "lucide-react";
import type { FC } from "react";
import { useVoiceCapability } from "./use-voice-status";
import { type VoicePhase as Phase, useVoiceStore } from "./voice-store";

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
	listening: "ui.chat.voice.phase_listening",
	sending: "ui.chat.voice.phase_sending",
	working: "ui.chat.voice.phase_working",
	speaking: "ui.chat.voice.phase_speaking",
	error: "ui.chat.voice.phase_error",
} as const satisfies Record<Exclude<Phase, "idle">, string>;

export const VoicePhase: FC<{ sessionId: string | undefined }> = ({
	sessionId,
}) => {
	useI18nLocale();
	const enabled = useVoiceCapability();
	const holds = useVoiceStore((s) => s.active?.session_id === sessionId);
	const cardPending = useVoiceStore((s) =>
		sessionId ? Boolean(s.cardPending[sessionId]) : false,
	);
	const phase = useVoiceStore((s) =>
		s.phaseSessionId === sessionId ? s.phase : "idle",
	);
	if (!enabled || !sessionId || (!holds && phase === "idle")) return null;
	/*
	 * IDLE ON THE HOLDER TEACHES THE KEY (design round 1, D1). Voice on with
	 * nothing happening is exactly when a reader needs to know how to talk, and
	 * the key is the user's own binding (`keymap.push_to_talk`), resolved the way
	 * the composer's tooltip resolves it - never a hard-coded name.
	 */
	if (phase === "idle") {
		/*
		 * A CARD ON SCREEN REPLACES THE HOLD HINT (design round 2, D7): holding the
		 * key would be refused - at an approval or a blocking ask alike (R3-m2) - so
		 * the line says what to do instead, in the same quiet style: it is guidance,
		 * not an alarm; the card itself is the alarm.
		 */
		return (
			<span
				data-voice-phase="idle"
				data-voice-hint={cardPending ? "card" : "hold"}
				className="shrink-0 whitespace-nowrap text-meta text-ink-dim"
			>
				{cardPending
					? t("ui.chat.voice.card_pending")
					: t("ui.chat.voice.hold_hint", {
							key: resolvePushToTalkBinding().label,
						})}
			</span>
		);
	}
	return (
		<output
			data-voice-phase={phase}
			className={cn(
				"shrink-0 whitespace-nowrap text-meta",
				phase === "error" ? "text-danger" : "text-ink-muted",
			)}
		>
			{t(PHASE_KEY[phase])}
		</output>
	);
};
