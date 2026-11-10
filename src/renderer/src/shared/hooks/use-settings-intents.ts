/*
 * THE SETTINGS-INTENT CLIENT: submit, retry, dismiss, hydrate, prefetch.
 *
 * WHY THIS EXISTS. Behind `features.settings_intents` a model/effort/fast/cwd
 * pick no longer waits on the session's runtime: the renderer paints the pick,
 * POSTs it, and the server applies it in the background with retries
 * (design 2026-11-09 §2f). That makes the pickers open and close instantly, and
 * lets the user change one conversation, move to the next and change that one
 * too, while each change keeps applying - across a conversation switch and an
 * app restart, because the server holds it on disk.
 *
 * The submit/retry/dismiss functions are PLAIN functions over the store rather
 * than hooks: a pick is fired from a dialog that closes in the same tick, and a
 * chip's Retry lives in a strip that may unmount before the reply lands. Neither
 * may depend on a mounted component to see its own answer through.
 *
 * WITHOUT THE CAPABILITY nothing here runs: every caller checks
 * `useSettingsIntentsEnabled()` first and keeps today's `sessions.command` path
 * byte for byte.
 */
import {
	DesktopControlError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { t } from "@shared/i18n";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useRecentDirectoriesStore } from "@shared/store/recent-directories-store";
import {
	type MirroredIntent,
	type MirroredSlots,
	dismissReachesServer,
	intentOverride,
	intentWriteMark,
	newlyAppliedCwds,
	submitFailure,
} from "@shared/store/settings-intents";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
	SettingsIntentKind,
	SettingsIntentSubmitResult,
	SettingsIntentsListResult,
} from "../../../../shared/desktop-contract";
import type { DesktopModelCatalogue } from "../../../../shared/desktop-control-contract";
import type { CanonicalModel } from "../../../../shared/desktop-session-contract";

const NO_SLOTS: MirroredSlots = Object.freeze({});

/** Whether the backend owns settings changes durably (`settings_intents >= 1`). */
export function useSettingsIntentsEnabled(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "settings_intents");
}

/** One session's mirrored slots (stable empty object when none). */
export function useSessionSettingsIntents(
	sessionId: string | null | undefined,
): MirroredSlots {
	return useCanonicalSessionsStore((state) =>
		sessionId ? (state.settingsIntents[sessionId] ?? NO_SLOTS) : NO_SLOTS,
	);
}

/**
 * Paint a pick and POST it. Resolves once the reply is folded in (or the
 * failure recorded); never throws - a failure is a `failed` slot with a
 * Retry, which is the one place the user reads it.
 */
export async function submitSettingsIntent(
	sessionId: string,
	pick: { kind: SettingsIntentKind; value: string | boolean; effort?: string },
): Promise<void> {
	const store = useCanonicalSessionsStore.getState();
	const requestId = uuidv4();
	store.paintSettingsIntent(sessionId, { ...pick, requestId });
	try {
		const reply = await desktopResult<SettingsIntentSubmitResult>({
			op: "settingsIntents.submit",
			sessionId,
			requestId,
			kind: pick.kind,
			value: pick.value,
			...(pick.effort !== undefined ? { effort: pick.effort } : {}),
		});
		useCanonicalSessionsStore
			.getState()
			.applySettingsIntentSlots(
				sessionId,
				reply.intents ?? { [pick.kind]: reply.intent },
			);
	} catch (error) {
		const control = error instanceof DesktopControlError ? error : null;
		useCanonicalSessionsStore.getState().failSettingsIntent(
			sessionId,
			pick.kind,
			requestId,
			submitFailure({
				status: control?.status ?? null,
				code: control?.code,
				message: userFacingMessage(
					error,
					t("ui.chat.settings_intents.reason_unknown"),
				),
			}),
		);
	}
}

/** Retry = the same value under a NEW request id (there is no retry route). */
export function retrySettingsIntent(
	sessionId: string,
	intent: MirroredIntent,
): Promise<void> {
	return submitSettingsIntent(sessionId, {
		kind: intent.kind,
		value: intent.value,
		...(typeof intent.effort === "string" && intent.effort
			? { effort: intent.effort }
			: {}),
	});
}

/**
 * Dismiss a failed slot or cancel a pending/waiting one. The mirror drops it at
 * once; a slot the server holds is DELETEd by generation, and a 409 (a newer
 * pick replaced it) re-reads that session so the newer slot shows again.
 *
 * A LOCAL slot whose POST failed ambiguously (5xx or no answer) may still
 * exist on the server under the generation the server chose, not the one the
 * mirror guessed (code review round 1, M3). So its request id is looked up in
 * a fresh read and, if the server stored it, that exact generation is
 * DELETEd - the server stops applying it and no later frame revives the chip.
 * A 4xx-refused local slot never reached storage and is only dropped here.
 */
export async function dismissSettingsIntent(
	sessionId: string,
	intent: MirroredIntent,
): Promise<void> {
	useCanonicalSessionsStore
		.getState()
		.removeSettingsIntent(sessionId, intent.kind, intent.generation);
	if (!dismissReachesServer(intent)) return;
	let generation = intent.generation;
	if (intent.local) {
		try {
			const listed = await desktopResult<SettingsIntentsListResult>({
				op: "settingsIntents.list",
				sessionId,
			});
			const stored = listed.intents?.[sessionId]?.[intent.kind];
			if (!stored || stored.request_id !== intent.request_id) return;
			generation = stored.generation;
		} catch {
			// Unknown either way: the next baseline shows the slot if it exists,
			// and the user can dismiss it again then.
			return;
		}
	}
	try {
		await desktopResult<unknown>({
			op: "settingsIntents.dismiss",
			sessionId,
			kind: intent.kind,
			generation,
		});
	} catch {
		await hydrateSettingsIntents(sessionId);
	}
}

/** Re-read the server's slots (all sessions, or one). Fails quietly. */
export async function hydrateSettingsIntents(sessionId?: string) {
	// Taken BEFORE the read leaves: a frame or reply folded in while it is in
	// flight is newer than its snapshot and must survive its prune (M1).
	const mark = intentWriteMark();
	try {
		const listed = await desktopResult<SettingsIntentsListResult>({
			op: "settingsIntents.list",
			...(sessionId ? { sessionId } : {}),
		});
		useCanonicalSessionsStore
			.getState()
			.hydrateSettingsIntents(listed.intents ?? {}, sessionId, mark);
	} catch {
		// A missed baseline is repaired by the next reconnect's read; the mirror
		// keeps what it had rather than claiming the server holds nothing.
	}
}

/**
 * The model picker's FIRST read, warmed before anyone opens it.
 *
 * `ModelPicker` opens on exactly this key (`live: false`, `usable`), and shows
 * its Loading body only when that key has no data - so a warm entry is what
 * makes the dialog paint a list on the first frame. 60 s matches the picker's
 * own `staleTime`, so a prefetch never refetches something the picker would
 * still serve.
 */
export const PICKER_CATALOGUE_KEY = [
	...desktopKeys.catalogue,
	false,
	"usable",
] as const;

export function prefetchPickerCatalogue(queryClient: QueryClient) {
	return queryClient.prefetchQuery({
		queryKey: PICKER_CATALOGUE_KEY,
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live: false,
				scope: "usable",
			}),
		staleTime: 60_000,
	});
}

/**
 * Mounted ONCE (app root): hydrate the mirror at boot and on every feed
 * (re)connect, and warm the picker catalogue. Frames themselves are applied in
 * `useDesktopFeed`'s handler; this hook owns only the baselines.
 */
export function useSettingsIntentsSync(): void {
	const enabled = useSettingsIntentsEnabled();
	const feed = useDesktopFeed();
	const queryClient = useQueryClient();
	// `connected` flips true on the first connect and on every reconnect; the
	// GET is the baseline for frames that were missed while it was down (frames
	// are live-only). Without the feed, the mount-time read is the only one.
	useEffect(() => {
		if (!enabled) return;
		if (feed.available && !feed.connected) return;
		void hydrateSettingsIntents();
	}, [enabled, feed.available, feed.connected]);
	useEffect(() => {
		if (!enabled) return;
		void prefetchPickerCatalogue(queryClient);
	}, [enabled, queryClient]);
	/*
	 * A cwd move that lands in the background still belongs in the recents menu
	 * (code review round 1, M2): the old path added it when its receipt settled,
	 * and nothing on the intent path does unless this watcher does. Mounted once
	 * here so every way a slot turns `applied` - frame, baseline - is seen.
	 */
	useEffect(() => {
		if (!enabled) return;
		return useCanonicalSessionsStore.subscribe((state, prev) => {
			for (const dir of newlyAppliedCwds(
				prev.settingsIntents,
				state.settingsIntents,
			))
				useRecentDirectoriesStore.getState().addRecentDirectory(dir);
		});
	}, [enabled]);
}

/** Session mount: re-warm the picker catalogue (no-op while still fresh). */
export function usePickerCataloguePrefetch(
	sessionId: string | null | undefined,
): void {
	const enabled = useSettingsIntentsEnabled();
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!enabled || !sessionId) return;
		void prefetchPickerCatalogue(queryClient);
	}, [enabled, sessionId, queryClient]);
}

/**
 * A `provider/model` selector's display name, from the warmed picker
 * catalogue when it holds the row, else the bare model id. Subscribes to the
 * same key the prefetch fills, so a label that arrives later repaints.
 */
export function useModelDescriber(
	enabled: boolean,
): (selector: string) => string {
	const catalogue = useQuery({
		queryKey: PICKER_CATALOGUE_KEY,
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live: false,
				scope: "usable",
			}),
		staleTime: 60_000,
		enabled,
	});
	const rows = catalogue.data?.models;
	return useCallback(
		(selector: string) => {
			const row = rows?.find(
				(candidate) =>
					(candidate.selector ||
						`${candidate.provider}/${candidate.model_id}`) === selector,
			);
			if (row?.label) return row.label;
			const slash = selector.indexOf("/");
			return slash >= 0 ? selector.slice(slash + 1) : selector;
		},
		[rows],
	);
}

/**
 * The model a pending/applying/queued model intent targets, shaped like the
 * handle's `pendingModel` paint so the band draws it the same way.
 */
export function intentPendingModel(
	slots: MirroredSlots,
	describeModel: (selector: string) => string,
): CanonicalModel | null {
	const selector = intentOverride(slots).model;
	if (!selector) return null;
	const slash = selector.indexOf("/");
	if (slash <= 0) return null;
	return {
		provider: selector.slice(0, slash),
		model_id: selector.slice(slash + 1),
		display_name: describeModel(selector),
	};
}
