/**
 * THE SESSION HEADER'S VOICE TOGGLE (`docs/design/session-voice.md`, V3/V12).
 *
 * One press asks the server to put the machine-wide voice slot on THIS session,
 * or take it off. Enabling here while another session holds the slot is the
 * switch: the server swaps atomically and answers `replaced`, so the toggle's
 * label names the conversation that will lose it before the press, and a notice
 * names it after.
 *
 * Absent (not disabled) when the backend does not advertise `features.voice` or
 * the pane has no session yet (a draft has nothing to enable). Disabled-by-colour
 * only while the server says it cannot speak, with the server's own reason in the
 * label - a press that can only answer `409 voice_unavailable` is not offered.
 *
 * ONE GLYPH, TWO STATES (design round 1, D2). `AudioLines` in both: the composer
 * owns the microphone glyph for dictation, and a second mic in the header read as
 * a second dictation control. Off rests at `ink-muted` like the ghost buttons
 * beside it; on is `accent` on `accent-wash`, driven by `aria-pressed` so the
 * drawn state and the announced state are one attribute. The pair is asserted in
 * `scripts/contrast-contract.mjs` ("voice toggle (pressed)").
 */

import {
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { Button } from "@shared/components/ui/button";
import { resolvePushToTalkBinding } from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { AudioLines } from "lucide-react";
import type { FC } from "react";
import { controlVoice, useVoiceStatus } from "./use-voice-status";
import { useVoiceStore } from "./voice-store";

/** A conversation's display title, for the switch's label and notice. */
export function voiceSessionTitle(sessionId: string | null): string {
	if (!sessionId) return t("ui.chat.voice.untitled");
	const row = useCanonicalSessionsStore
		.getState()
		.sessions.find((session) => session.session_id === sessionId);
	const title = row?.title?.trim();
	return title ? title : t("ui.chat.voice.untitled");
}

export const VoiceToggle: FC<{ sessionId: string | undefined }> = ({
	sessionId,
}) => {
	useI18nLocale();
	const status = useVoiceStatus();
	const pending = useVoiceStore((s) => s.pending);
	// The provider's client, so the answer lands in the entry this tree reads.
	const client = useQueryClient();
	if (!status.enabled || !sessionId) return null;
	const on = status.activeSessionId === sessionId;
	const holder = status.activeSessionId;
	const unavailable = !on && !status.canSpeak;
	const label = on
		? t("ui.chat.voice.toggle_off_hint", {
				key: resolvePushToTalkBinding().label,
			})
		: unavailable
			? /*
				 * THE SERVER'S REASON ALONE (design round 2, D9): it is already a whole
				 * sentence saying voice cannot speak, and a "Voice is unavailable:"
				 * prefix in front of it said the same thing twice.
				 */
				status.state?.tts.reason?.trim() ||
				t("ui.chat.voice.toggle_unavailable_generic")
			: holder
				? t("ui.chat.voice.toggle_switch", { title: voiceSessionTitle(holder) })
				: t("ui.chat.voice.toggle_on");

	const press = async () => {
		if (pending || unavailable) return;
		try {
			const result = await controlVoice(
				on ? "disable" : "enable",
				sessionId,
				client,
			);
			if (!on && result.replaced && result.replaced !== sessionId) {
				showInfoToast(
					t("ui.chat.voice.switched_from", {
						title: voiceSessionTitle(result.replaced),
					}),
				);
			}
		} catch (error) {
			const reason = userFacingMessage(
				error,
				error instanceof DesktopControlError ? error.message : "",
			);
			showErrorToast(
				t(on ? "ui.chat.voice.disable_failed" : "ui.chat.voice.enable_failed", {
					reason,
				}),
			);
		}
	};

	return (
		<Button
			variant="ghost"
			size="icon"
			data-voice-toggle={on ? "on" : "off"}
			aria-pressed={on}
			aria-label={label}
			title={label}
			aria-disabled={pending || unavailable || undefined}
			aria-busy={pending || undefined}
			onClick={() => void press()}
			className={cn(
				/*
				 * THE PRESSED STATE HAS ITS OWN GROUND (design round 2, D6). Plain
				 * `accent-wash` is also the ghost variant's HOVER fill, so a pressed
				 * toggle and a hovered off one were the same picture. The pressed fill
				 * is the outline variant's pressed mix (`button.tsx`), and pressed+hover
				 * steps one rung further toward `accent` with `ink` as the glyph -
				 * `accent` on the deeper mix falls under 3:1 in two palettes, `ink`
				 * clears 4.5:1 in all. Both pairs are asserted in
				 * `scripts/contrast-contract.mjs` ("voice toggle (pressed[, hovered])").
				 */
				"aria-pressed:bg-[color-mix(in_oklab,var(--color-accent-wash)_80%,var(--color-accent))] aria-pressed:text-accent",
				"aria-pressed:hover:bg-[color-mix(in_oklab,var(--color-accent-wash)_70%,var(--color-accent))] aria-pressed:hover:text-ink",
				// Hover must not lift it: the ghost's `hover:text-ink` read as "pressable".
				unavailable &&
					"text-ink-disabled hover:bg-transparent hover:text-ink-disabled",
			)}
		>
			<AudioLines aria-hidden="true" />
		</Button>
	);
};
