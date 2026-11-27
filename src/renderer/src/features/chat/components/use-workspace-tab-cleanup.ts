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
import { DRAFT_CONSOLE_OWNER } from "../../../../../shared/console-owner";
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
	due: number;
	revision?: string;
};

type DraftClock = { id: string; due: number };

function draftConsoleIsEmpty(state: unknown): boolean {
	if (typeof state !== "object" || state === null) return false;
	const { available, reason, surfaces } = state as Record<string, unknown>;
	// A pane fallback can look empty when its read failed. Only main's explicit
	// scoped listing (or a deliberately disabled host) can clear this veto.
	return (
		Array.isArray(surfaces) &&
		surfaces.length === 0 &&
		(available === true || (available === false && reason === "disabled"))
	);
}

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
		let inFlightIds: ReadonlySet<string> | undefined;
		let draftCheckInFlight = false;
		let consoleGeneration = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const consoleApi = window.api?.console;
		// A catalogue row may veto, but only an opted-in Core receipt can arm
		// a conversation's clock. The query cannot select rows outside the page.
		const candidates = new Map<string, Candidate>();
		const draftClocks = new Map<string, DraftClock>();

		async function checkDrafts(due: Map<string, DraftClock>) {
			const consoleAtRequest = consoleGeneration;
			const stillCurrent = () =>
				!disposed && consoleAtRequest === consoleGeneration;
			try {
				let empty = false;
				try {
					empty = draftConsoleIsEmpty(
						await consoleApi?.state(DRAFT_CONSOLE_OWNER),
					);
				} catch {
					// A failed read can't distinguish an empty draft from a live shell.
				}
				if (disposed) return;
				const expired = new Set<string>();
				const nextCheck = performance.now() + WORKSPACE_INACTIVE_MS;
				for (const [key, clock] of due) {
					// Dropping and rearming a clock marks even transient ineligibility
					// while the console read was outstanding (selection, send, input).
					if (draftClocks.get(key) !== clock) continue;
					if (empty && stillCurrent()) expired.add(key);
					clock.due = nextCheck;
				}
				if (expired.size) remove(expired, stillCurrent);
			} finally {
				draftCheckInFlight = false;
				plan();
			}
		}

		function invalidateCandidate(id: string) {
			// Only named IDs can invalidate this proof read. Waiting tabs still
			// reset their own clocks without replaying someone else's capped batch.
			if (inFlightIds?.has(id)) generation++;
		}

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
					// Transport failure has the same authority as a page miss: none.
				}
				if (!stillCurrent()) return;
				const revisions = workspaceRestRevisions(response, ids, requestEpoch);
				const expired = new Set<string>();
				const now = performance.now();
				for (const id of ids) {
					const candidate = candidates.get(id);
					if (!candidate) continue;
					const revision = revisions.get(id);
					if (revision !== undefined && candidate.revision === revision)
						expired.add(candidate.key);
					// A missing proof breaks the chain but not the clock: the next
					// ordinary sweep can recover even if no feed or store event arrives.
					candidate.revision = revision;
					candidate.due = now + WORKSPACE_INACTIVE_MS;
				}
				if (expired.size) remove(expired, stillCurrent);
			} finally {
				inFlightIds = undefined;
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
				if (disposed) return;
				const now = performance.now();
				let wakeAt = Number.POSITIVE_INFINITY;
				if (!draftCheckInFlight && draftClocks.size) {
					const due = new Map<string, DraftClock>();
					for (const [key, clock] of draftClocks) {
						if (clock.due <= now) due.set(key, clock);
						else wakeAt = Math.min(wakeAt, clock.due);
					}
					if (due.size) {
						draftCheckInFlight = true;
						void checkDrafts(due);
					}
				}
				if (!inFlightIds && connected && epoch) {
					const due: Array<[string, number]> = [];
					for (const [id, candidate] of candidates) {
						if (candidate.due <= now) due.push([id, candidate.due]);
						else wakeAt = Math.min(wakeAt, candidate.due);
					}
					if (due.length) {
						// Cap requests, not candidates. Older deadlines go first, so
						// page misses on retry or newly opened tabs cannot keep a
						// waiting tab out. Ties don't depend on strip order.
						due.sort(
							([a, deadlineA], [b, deadlineB]) =>
								deadlineA - deadlineB || a.localeCompare(b),
						);
						const ids = new Set(
							due.slice(0, DESKTOP_SESSION_PAGE_LIMIT).map(([id]) => id),
						);
						inFlightIds = ids;
						void checkBatch(ids, epoch, generation);
					}
				}
				if (Number.isFinite(wakeAt)) timer = setTimeout(plan, wakeAt - now);
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
			const eligibleDrafts = new Map<string, string>();
			const canProbeSessions =
				connected && epoch && !state.statusUnavailable.includes("liveness");
			for (const tab of liveTabs.current) {
				const { id } = tab.target;
				if (
					tab.pinned ||
					sameWorkspaceTarget(active, tab.target) ||
					composerHasUnsentPayload(input[id]) ||
					// Pre-admission or recovered sends can still own their send key.
					composerHasUnsentPayload(input[`send:${id}`])
				)
					continue;
				if (tab.target.kind === "draft") {
					const draft = state.drafts[id];
					// The canonical row owns create/admission even before the tab
					// catches up to a sessionId. A warm or recoverable send is work.
					if (
						draft &&
						state.activeDraftKey !== id &&
						!draft.sessionId &&
						!draft.warmId &&
						!draft.pending &&
						!draft.admissionAttempted &&
						!draft.error &&
						!draft.undelivered &&
						!draft.submittedText &&
						!draft.submittedAttachments?.length &&
						!draft.submittedImages?.length &&
						!draft.submittedFiles?.length
					)
						eligibleDrafts.set(tab.key, id);
					continue;
				}
				if (
					!canProbeSessions ||
					!bulkReceiptSessionIdPattern.test(id) ||
					state.validatingSessionId === id ||
					state.forgotten[id] !== undefined ||
					state.placementFacts[id]?.locality === "remote" ||
					Object.values(state.drafts).some((draft) =>
						draftBelongsToSession(draft, id),
					)
				)
					continue;
				const row = state.sessions.find((row) => row.session_id === id);
				if (row && !workspaceRowCanRest(row)) continue;
				desired.set(id, tab.key);
			}
			let draftChanged = false;
			for (const [key, clock] of draftClocks) {
				if (eligibleDrafts.get(key) !== clock.id) {
					draftClocks.delete(key);
					draftChanged = true;
				}
			}
			for (const [key, id] of eligibleDrafts) {
				if (!draftClocks.has(key)) {
					draftClocks.set(key, {
						id,
						due: performance.now() + WORKSPACE_INACTIVE_MS,
					});
					draftChanged = true;
				}
			}
			if (draftChanged) plan();
			let changed = false;
			for (const [id, { key }] of candidates) {
				if (desired.get(id) !== key) {
					candidates.delete(id);
					// Fence even transient vetoes that revert during the read.
					invalidateCandidate(id);
					changed = true;
				}
			}
			const now = performance.now();
			for (const [id, key] of desired) {
				if (!candidates.has(id)) {
					candidates.set(id, { key, due: now });
					changed = true;
				}
			}
			if (changed) plan();
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
					next.placementFacts !== previous.placementFacts ||
					next.forgotten !== previous.forgotten
				)
					syncCandidates();
			},
		);
		const offInput = useConversationInputStore.subscribe((next, previous) => {
			if (next.inputByConversation !== previous.inputByConversation)
				syncCandidates();
		});
		// Every draft shares a pending console owner. Any main-side listing
		// change during the expiry read makes that reading insufficient.
		const offConsole = consoleApi?.onStateChanged(() => {
			consoleGeneration++;
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
				candidate.revision = undefined;
				candidate.due = performance.now();
				invalidateCandidate(frame.session_id);
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
			offConsole?.();
			offSessions();
			offInput();
		};
	}, [enabled, remove]);
}
