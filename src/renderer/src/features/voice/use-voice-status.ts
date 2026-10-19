/**
 * THE ONE READ OF SESSION VOICE'S SLOT, shared by the toggle, the sidebar marker
 * and the controller (the backend's `docs/design/qwen-voice.md`).
 *
 * Gated on `features.voice`: absent, no request is made and every reader sees
 * `enabled: false`, which hides every voice surface rather than disabling it.
 *
 * ONE SOURCE OF TRUTH: THE QUERY CACHE (QA round 1, Q2). Three channels move
 * the slot - this GET, a control POST's answer, and the machine feed's `voice`
 * frame - and all three now write the SAME `["desktop", "voice"]` cache entry
 * (`applyVoiceActive`); the store's `active` is only ever written from that
 * entry. The earlier shape kept the store as a second copy and re-applied the
 * cached GET into it on every remount, so a view that remounted after a switch
 * painted the PREVIOUS holder as on until the poll came round (~25 s, 3/3).
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { queryClient as appQueryClient } from "@shared/api/query-client";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
	DesktopVoiceActive,
	DesktopVoiceControlResult,
	DesktopVoiceState,
} from "../../../../shared/desktop-control-contract";
import { useVoiceSwitch } from "./use-voice-switch";
import { useVoiceStore, voiceSessionOf } from "./voice-store";

export const voiceKeys = {
	status: ["desktop", "voice"] as const,
};

/** Whether this backend serves session voice at all. */
export function useVoiceCapability(): boolean {
	const capabilities = useDesktopCapabilities();
	// Two halves, both required: the daemon serves voice AND the person turned it
	// on in this app (default off).
	const switchedOn = useVoiceSwitch();
	return switchedOn && desktopFeatureEnabled(capabilities.data, "voice", 1);
}

/**
 * Write a slot value the server stated into the one cache entry, and mirror it
 * into the store. A value with no cached read to merge into (the feed beat the
 * first GET) is mirrored and the read is invalidated, so the GET that follows
 * brings the settings with it rather than a half-built entry.
 */
export function applyVoiceActive(
	active: DesktopVoiceActive,
	client: QueryClient = appQueryClient,
): void {
	/*
	 * A read already in flight was answered from the slot BEFORE this change; let
	 * it land afterwards and it would put the old holder back. Cancelled, not
	 * awaited: `setQueryData` below is the newer fact either way.
	 */
	void client.cancelQueries({ queryKey: voiceKeys.status });
	const cached = client.getQueryData<DesktopVoiceState>(voiceKeys.status);
	if (cached) {
		client.setQueryData<DesktopVoiceState>(voiceKeys.status, {
			...cached,
			active,
		});
	} else {
		void client.invalidateQueries({ queryKey: voiceKeys.status });
	}
	useVoiceStore.getState().setActive(active);
}

export type VoiceStatus = {
	/** The backend serves voice (`features.voice`). */
	enabled: boolean;
	/** The session holding the slot, or null. */
	activeSessionId: string | null;
	/** The last full read. */
	state: DesktopVoiceState | undefined;
};

export function useVoiceStatus(): VoiceStatus {
	const enabled = useVoiceCapability();
	const setActive = useVoiceStore((s) => s.setActive);
	const query = useQuery({
		queryKey: voiceKeys.status,
		queryFn: () => desktopResult<DesktopVoiceState>({ op: "voice.status" }),
		enabled,
		staleTime: 15_000,
		refetchInterval: 60_000,
	});
	const data = query.data;
	/*
	 * The store follows the cache, never the reverse. `data` changes identity
	 * only when the entry is written - a fetch, `applyVoiceActive` - so a remount
	 * re-applies the CURRENT entry, which every channel has kept current.
	 */
	useEffect(() => {
		if (data) setActive(data.active);
	}, [data, setActive]);
	return {
		enabled,
		activeSessionId: enabled ? voiceSessionOf(data?.active) : null,
		state: data,
	};
}

/**
 * Enable or disable voice on one session, through the route. The answer is the
 * slot's new value and goes into the one cache entry at once, so the toggle and
 * the marker move without waiting for the feed frame (which then agrees).
 */
export async function controlVoice(
	action: "enable" | "disable",
	sessionId: string,
	client: QueryClient = appQueryClient,
): Promise<DesktopVoiceControlResult> {
	const store = useVoiceStore.getState();
	const before = store.rig;
	store.setPending(true);
	/*
	 * THE FIRST FRAME OF AN ENABLE IS "STARTING VOICE" (design round 1, D2): the
	 * slot arrives from the route in ~84 ms while the rig's own status is still the
	 * last one this window had - a stale `error`, or "stopped" after a restart - so
	 * the strip painted that for up to a second before main said `starting`. The
	 * press IS a request to start, so the optimistic frame is the neutral word the
	 * person just asked for; main's status replaces it as soon as it speaks.
	 */
	if (
		action === "enable" &&
		before?.rig !== "ready" &&
		before?.rig !== "starting"
	) {
		store.setRig({ ...(before ?? { webui_url: null }), rig: "starting" });
	}
	try {
		const result = await desktopResult<DesktopVoiceControlResult>({
			op: "voice.control",
			action,
			sessionId,
		});
		applyVoiceActive(result.active, client);
		store.setReplaced(result.replaced);
		return result;
	} catch (error) {
		// The route refused: the optimistic starting frame was never true.
		if (action === "enable" && before !== undefined) store.setRig(before);
		throw error;
	} finally {
		useVoiceStore.getState().setPending(false);
	}
}
