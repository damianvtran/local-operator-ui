/**
 * SESSION VOICE'S ONE PASSIVE MARK ON THE SIDEBAR (the backend's
 * `docs/design/qwen-voice.md`).
 *
 * `VoiceRowMarker` is the sidebar row's "voice on" mark, drawn on exactly the row
 * whose session holds the machine-wide slot. Because the slot has one holder, at
 * most one row carries it, and a switch moves it.
 *
 * THE HEADER'S PHASE WORD USED TO LIVE HERE TOO (`VoicePhase`). It moved into the
 * composer's strip (design spec `voice-composer/SPEC.md`): the phase describes the
 * box the person is typing into, and two surfaces saying it could disagree - most
 * visibly on a narrow window, where the header's word and the strip's chip were
 * the same sentence in two places. `features/voice/voice-composer.tsx` owns the
 * strip, its precedence rules and the reason an error shows.
 *
 * Renders nothing when `features.voice` is absent or the row does not hold the
 * slot. Ink, not a control.
 */

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { AudioLines } from "lucide-react";
import type { FC } from "react";
import { useVoiceCapability } from "./use-voice-status";
import { useVoiceStore } from "./voice-store";

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
