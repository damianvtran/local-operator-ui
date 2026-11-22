import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import {
	draftBelongsToSession,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	composerHasUnsentPayload,
	useConversationInputStore,
} from "@shared/store/conversation-input-store";
import { useLayoutEffect, useRef } from "react";
import {
	DESKTOP_SESSION_PAGE_LIMIT,
	type DesktopResponse,
	bulkReceiptSessionIdPattern,
} from "../../../../../shared/desktop-contract";
import { desktopFeedEpochAfterFrame } from "../../../../../shared/desktop-feed-status";
import {
	WORKSPACE_INACTIVE_MS,
	workspaceRestRevisions,
	workspaceRowCanRest,
} from "../workspace-tab-cleanup";
import {
	type WorkspaceTab,
	sameWorkspaceTarget,
	workspaceTarget,
} from "../workspace-tabs-model";

type Candidate = {
	key: string;
	proof: "needed" | "unproved" | { revision: string; due: number };
};

export function useWorkspaceTabCleanup(
	enabled: boolean,
	tabs: WorkspaceTab[],
	remove: (keys: ReadonlySet<string>, stillCurrent: () => boolean) => void,
) {
	const liveTabs = useRef(tabs);
	const recheck = useRef<() => void>();
	useLayoutEffect(() => {
		liveTabs.current = tabs;
		recheck.current?.();
	}, [tabs]);

	useLayoutEffect(() => {
		const native = window.api?.desktop?.feed;
		if (!enabled || !native) return;
		let connected = false;
		let epoch: string | undefined;
		let canSeedFromWatch = true;
		let generation = 0;
		let disposed = false;
		let scheduled = false;
		let inFlight = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Local tab eligibility and clock only, never catalogue membership. The
		// query cannot select rows outside the page; a miss just keeps the tab.
		const candidates = new Map<string, Candidate>();

		async function checkBatch(
			ids: Set<string>,
			requestEpoch: string,
			requestGeneration: number,
		) {
			const stillCurrent = () => !disposed && generation === requestGeneration;
			try {
				let response: DesktopResponse | null = null;
				try {
					response = await desktopRequest({
						op: "sessions.list",
						limit: DESKTOP_SESSION_PAGE_LIMIT,
						workspace_rest_id: [...ids],
					});
				} catch {
					// Transport failure is an unproved observation, not a retry trigger.
				}
				if (!stillCurrent()) return;
				const revisions = workspaceRestRevisions(response, ids, requestEpoch);
				const expired = new Set<string>();
				const now = performance.now();
				for (const id of ids) {
					const candidate = candidates.get(id);
					if (!candidate) continue;
					const prior = candidate.proof;
					const revision = revisions.get(id);
					candidate.proof = "unproved";
					if (revision === undefined) continue;
					// A previously armed candidate only enters this batch once due.
					// A different opaque token starts a new full interval, not a close.
					if (typeof prior === "object" && prior.revision === revision)
						expired.add(candidate.key);
					else candidate.proof = { revision, due: now + WORKSPACE_INACTIVE_MS };
				}
				if (expired.size) remove(expired, stillCurrent);
			} finally {
				inFlight = false;
				plan();
			}
		}

		function plan() {
			if (disposed || scheduled) return;
			scheduled = true;
			// Store updates and feed frames can describe the same transition. Queue
			// one batch and let the pending request settle before starting another.
			queueMicrotask(() => {
				scheduled = false;
				clearTimeout(timer);
				if (disposed || inFlight || !connected || !epoch) return;
				const now = performance.now();
				const ids = new Set<string>();
				let wakeAt = Number.POSITIVE_INFINITY;
				for (const [id, { proof }] of candidates) {
					if (
						proof === "needed" ||
						(typeof proof === "object" && proof.due <= now)
					)
						ids.add(id);
					else if (typeof proof === "object")
						wakeAt = Math.min(wakeAt, proof.due);
				}
				if (ids.size) {
					inFlight = true;
					void checkBatch(ids, epoch, generation);
				} else if (Number.isFinite(wakeAt))
					timer = setTimeout(plan, wakeAt - now);
			});
		}

		function syncCandidates() {
			const state = useCanonicalSessionsStore.getState();
			const input = useConversationInputStore.getState().inputByConversation;
			const active = workspaceTarget(
				state.activeDraftKey,
				state.activeSessionId,
				state.drafts,
			);
			const desired = new Map<string, string>();
			if (connected && epoch && !state.statusUnavailable.includes("liveness")) {
				for (const tab of liveTabs.current) {
					const { id } = tab.target;
					if (
						tab.target.kind !== "session" ||
						tab.pinned ||
						sameWorkspaceTarget(active, tab.target) ||
						!bulkReceiptSessionIdPattern.test(id) ||
						state.validatingSessionId === id ||
						state.forgotten[id] !== undefined ||
						!workspaceRowCanRest(
							state.sessions.find((row) => row.session_id === id),
						) ||
						Object.values(state.drafts).some((draft) =>
							draftBelongsToSession(draft, id),
						) ||
						composerHasUnsentPayload(input[id]) ||
						// Pre-admission or recovered sends can still own their send key.
						composerHasUnsentPayload(input[`send:${id}`])
					)
						continue;
					desired.set(id, tab.key);
				}
			}
			// Select deterministically, so dragging tabs cannot invalidate evidence.
			const ids = [...desired.keys()]
				.sort()
				.slice(0, DESKTOP_SESSION_PAGE_LIMIT);
			const bounded = new Set(ids);
			let changed = false;
			for (const [id, { key }] of candidates) {
				if (!bounded.has(id) || desired.get(id) !== key) {
					candidates.delete(id);
					changed = true;
				}
			}
			for (const id of ids) {
				const key = desired.get(id);
				if (key !== undefined && !candidates.has(id)) {
					candidates.set(id, { key, proof: "needed" });
					changed = true;
				}
			}
			if (changed) {
				// Invalidate even if membership later changes right back while in flight.
				generation++;
				plan();
			}
		}

		function reset(nextEpoch: string | undefined) {
			epoch = nextEpoch;
			generation++;
			candidates.clear();
			syncCandidates();
			plan();
		}

		recheck.current = syncCandidates;
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
					syncCandidates();
			},
		);
		const offInput = useConversationInputStore.subscribe((next, previous) => {
			if (next.inputByConversation !== previous.inputByConversation)
				syncCandidates();
		});
		// Observe the existing relay. Status frames can invalidate a clock, but
		// no headline (including a baseline) can arm it or prove expiry.
		const offFrames = native.subscribe((frame) => {
			const next = desktopFeedEpochAfterFrame(epoch, frame);
			if (frame.type === "open" || frame.type === "gap" || epoch !== next) {
				canSeedFromWatch = false;
				reset(next);
			} else if (frame.type === "session_status") {
				const candidate = candidates.get(frame.session_id);
				if (!candidate) return;
				candidate.proof = "needed";
				generation++;
				plan();
			}
		});
		const offState = native.watchState((status) => {
			connected = status.connected;
			if (!connected) {
				canSeedFromWatch = false;
				reset(undefined);
			} else if (canSeedFromWatch && status.workspaceEpoch) {
				canSeedFromWatch = false;
				reset(status.workspaceEpoch);
			} else syncCandidates();
		}, true);
		return () => {
			disposed = true;
			clearTimeout(timer);
			recheck.current = undefined;
			offState();
			offFrames();
			offSessions();
			offInput();
		};
	}, [enabled, remove]);
}
