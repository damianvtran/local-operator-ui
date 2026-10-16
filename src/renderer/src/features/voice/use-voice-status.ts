/**
 * THE ONE READ OF SESSION VOICE'S SLOT, shared by the toggle, the sidebar marker
 * and the controller (`docs/design/session-voice.md`).
 *
 * Gated on `features.voice`: absent, no request is made and every reader sees
 * `enabled: false`, which hides every voice surface rather than disabling it.
 *
 * Three channels feed the store's `active`, and the most recent wins: this GET
 * (on mount, focus and the poll the query keeps), a control POST's answer, and
 * the machine feed's `voice` frame (`useVoiceFeed`, mounted once by the
 * controller). The feed is what turns A's marker off in every window the moment B
 * is enabled anywhere; the GET is the floor when the feed is down.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
	DesktopVoiceControlResult,
	DesktopVoiceState,
} from "../../../../shared/desktop-control-contract";
import { useVoiceStore, voiceSessionOf } from "./voice-store";

export const voiceKeys = {
	status: ["desktop", "voice"] as const,
};

/** Whether this backend serves session voice at all. */
export function useVoiceCapability(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "voice", 1);
}

export type VoiceStatus = {
	/** The backend serves voice (`features.voice`). */
	enabled: boolean;
	/** The session holding the slot, or null. */
	activeSessionId: string | null;
	/** The last full read, for the paths' availability. */
	state: DesktopVoiceState | undefined;
	/** Whether the server can speak at all; without it enabling is refused (409). */
	canSpeak: boolean;
};

export function useVoiceStatus(): VoiceStatus {
	const enabled = useVoiceCapability();
	const setActive = useVoiceStore((s) => s.setActive);
	const active = useVoiceStore((s) => s.active);
	const query = useQuery({
		queryKey: voiceKeys.status,
		queryFn: () => desktopResult<DesktopVoiceState>({ op: "voice.status" }),
		enabled,
		staleTime: 15_000,
		refetchInterval: 60_000,
	});
	const data = query.data;
	useEffect(() => {
		if (data) setActive(data.active);
	}, [data, setActive]);
	return {
		enabled,
		activeSessionId: enabled ? voiceSessionOf(active ?? data?.active) : null,
		state: data,
		canSpeak: data?.tts.available ?? true,
	};
}

/**
 * Enable or disable voice on one session, through the route. The answer is the
 * slot's new value and is written to the store at once, so the toggle and the
 * marker move without waiting for the feed frame (which then agrees).
 */
export async function controlVoice(
	action: "enable" | "disable",
	sessionId: string,
): Promise<DesktopVoiceControlResult> {
	const store = useVoiceStore.getState();
	store.setPending(true);
	try {
		const result = await desktopResult<DesktopVoiceControlResult>({
			op: "voice.control",
			action,
			sessionId,
		});
		store.setActive(result.active);
		store.setReplaced(result.replaced);
		return result;
	} finally {
		useVoiceStore.getState().setPending(false);
	}
}
