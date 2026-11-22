import {
	draftBelongsToSession,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useEffect, useLayoutEffect, useRef } from "react";
import { DesktopFeedStatusProjection } from "../../../../../shared/desktop-feed-status";
import {
	advanceWorkspaceCleanup,
	confirmedWorkspaceRest,
} from "../workspace-tab-cleanup";
import { type WorkspaceTab, workspaceTarget } from "../workspace-tabs-model";

export function useWorkspaceTabCleanup(
	enabled: boolean,
	tabs: WorkspaceTab[],
	remove: (keys: ReadonlySet<string>) => void,
) {
	const liveTabs = useRef(tabs);
	const recheck = useRef<() => void>();
	useLayoutEffect(() => {
		liveTabs.current = tabs;
		recheck.current?.();
	}, [tabs]);

	useEffect(() => {
		const native = window.api?.desktop?.feed;
		if (!enabled || !native) return;
		let connected = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let clock = new Map<string, { since: number; evidence: string }>();
		const receipts = new DesktopFeedStatusProjection();
		const measure = () => {
			clearTimeout(timer);
			const state = useCanonicalSessionsStore.getState();
			const input = useConversationInputStore.getState().inputByConversation;
			const active = workspaceTarget(
				state.activeDraftKey,
				state.activeSessionId,
				state.drafts,
			);
			const trustworthy =
				connected && !state.statusUnavailable.includes("liveness");
			const { next, expired, wakeAt } = advanceWorkspaceCleanup(
				liveTabs.current,
				active,
				performance.now(),
				clock,
				(id) => {
					if (
						!trustworthy ||
						state.validatingSessionId === id ||
						state.forgotten[id] !== undefined
					)
						return;
					const row = state.sessions.find((item) => item.session_id === id);
					const receipt = receipts.get(id);
					const draft = Object.values(state.drafts).some((item) =>
						draftBelongsToSession(item, id),
					);
					// Pre-admission or recovered sends can still own their send key.
					if (
						receipt &&
						confirmedWorkspaceRest(
							row,
							receipt,
							input[id],
							draft,
							input[`send:${id}`],
						)
					) {
						return JSON.stringify([
							receipt.epoch,
							receipt.revision,
							row?.updated_at,
						]);
					}
				},
			);
			clock = next;
			if (expired.size > 0) remove(expired);
			if (Number.isFinite(wakeAt))
				timer = setTimeout(measure, Math.max(0, wakeAt - performance.now()));
		};
		recheck.current = measure;
		// Observe the app's existing main-process feed over IPC, never create a
		// session stream, post a request, or infer liveness from an old row.
		const offFrames = native.subscribe((frame) => {
			if (receipts.observe(frame)) measure();
		});
		const offState = native.watchState((status) => {
			connected = status.connected;
			if (!connected) receipts.clear();
			else if (status.sessionStatus) receipts.seed(status.sessionStatus);
			measure();
		}, true);
		const offSessions = useCanonicalSessionsStore.subscribe(
			(next, previous) => {
				if (
					next.sessions !== previous.sessions ||
					next.drafts !== previous.drafts ||
					next.activeDraftKey !== previous.activeDraftKey ||
					next.activeSessionId !== previous.activeSessionId ||
					next.validatingSessionId !== previous.validatingSessionId ||
					next.statusUnavailable !== previous.statusUnavailable ||
					next.forgotten !== previous.forgotten
				)
					measure();
			},
		);
		const offInput = useConversationInputStore.subscribe((next, previous) => {
			if (next.inputByConversation !== previous.inputByConversation) measure();
		});
		return () => {
			clearTimeout(timer);
			recheck.current = undefined;
			offState();
			offFrames();
			offSessions();
			offInput();
		};
	}, [enabled, remove]);
}
