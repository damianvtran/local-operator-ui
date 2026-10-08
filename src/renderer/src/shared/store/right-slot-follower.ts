/**
 * The right slot's per-conversation memory, bound to the conversations store
 * (issue #894).
 *
 * THE PROBLEM THIS CLOSES. The four durable right-slot flags are the live
 * projection of ONE conversation's memory, and something has to move them when
 * the active conversation moves. That something cannot live in a component: the
 * conversation identity changes inside `useCanonicalSessionsStore`'s own
 * actions (`setActiveSession`, `openSession`, `stageDraft`, and the admission
 * that patches a draft's `sessionId`), and a React effect would bind one commit
 * AFTER the switch — a frame of the previous conversation's panel over the new
 * transcript's first paint, which is the visible defect the issue reports in its
 * own right.
 *
 * THE INSTALL IS MODULE-SCOPE AND IDEMPOTENT, the shape
 * `shared/store/conversation-input-sync.ts` established for the same reason: the
 * subscriber must outlive every render, so it is installed by the document entry
 * (`main.tsx`) rather than by a component. `localStorage` hydration is
 * synchronous, so the store is already holding the reader's memory when the
 * install runs — the first bind is before the first render.
 *
 * WHY THE KEY IS `panelIdentityOfView` AND NOT A SECOND EXPRESSION. The pane the
 * slot is bound to must be the pane the chat surface keys on
 * (`chat-page.tsx`'s `identity`, which `chat-content` uses as the mount key for
 * these panes), or the two sides come to describe different conversations. That
 * expression is `panelIdentityFor(draftKey, panelSessionIdOfView(...))`, and
 * `panelIdentityOfView` is it, named, in the store that owns the rule — so this
 * module reads it rather than restating it. The tempting shorthand
 * `panelIdentityFor(activeDraftKey, draftSessionId ?? activeSessionId)` is NOT
 * the same thing and is wrong here: `stageDraft` leaves `activeSessionId` at the
 * conversation the reader came from, so that shorthand answers the PREVIOUS
 * session's id for a fresh draft — it would bind a New-chat draft to the memory
 * of the conversation it was staged from, and a panel opened while drafting
 * would overwrite that conversation's entry (both refuted by this feature's own
 * cells: the fresh draft must open empty, and a draft's entry must be carried,
 * not duplicated, at admission).
 */

import {
	panelIdentityOfView,
	useCanonicalSessionsStore,
} from "./canonical-sessions-store";
import { isDraftMemoryKey, memoryPruneKeys } from "./right-slot-memory";
import { useUiPreferencesStore } from "./ui-preferences-store";

/**
 * The key the slot consults for one conversation state, or null for "bound, no
 * conversation" (a route with no session and no draft).
 *
 * Pure and exported so the rule is exercisable without the stores: this is the
 * identity the panes are keyed on, asked of the same three fields chat-page
 * derives it from.
 */
export function rightSlotKeyForView(input: {
	activeDraftKey: string | null;
	draftSessionId: string | undefined;
	activeSessionId: string | null | undefined;
}): string | null {
	return (
		panelIdentityOfView(
			input.activeDraftKey,
			input.draftSessionId,
			input.activeSessionId,
		) ?? null
	);
}

/**
 * What a key change carries, when it is an ADMISSION.
 *
 * A draft learns its session id mid-send (the create's answer patches the row),
 * and that is the one flip where the memory has to travel WITH the identity:
 * the entry the user made while drafting belongs to the conversation that draft
 * just became, and dropping it would close a panel the user opened — the
 * close-then-open frame the decision record refuses. Every other change is a
 * plain switch, and the destination's own entry (or its absence) is the whole
 * answer.
 *
 * `undefined` rather than null for the no-carry case, because that is the
 * optional field `bindRightSlotKey` reads.
 */
export function admittedFromFor(
	previousKey: string | null,
	key: string | null,
): string | undefined {
	if (previousKey === null || key === null) return undefined;
	if (!isDraftMemoryKey(previousKey)) return undefined;
	if (isDraftMemoryKey(key)) return undefined;
	return previousKey;
}

/** Whether this document's follower is already subscribed. */
let installed = false;

/** The key this install last bound, so a subscriber pass can be a no-op. */
let boundKey: string | null | undefined;

/**
 * Drop the memory of conversations the conversations store has declared gone.
 *
 * Guarded on an actual change: `persist` serialises the whole preferences blob
 * after every `set`, and this runs on every conversation-store mutation, so an
 * unconditional write would rewrite `localStorage` on each stream tick.
 */
function prune(
	sessions: ReturnType<typeof useCanonicalSessionsStore.getState>,
): void {
	const drop = memoryPruneKeys({
		forgotten: sessions.forgotten,
		archiveFacts: sessions.archiveFacts,
	});
	if (drop.size === 0) return;
	const { rightSlotMemory } = useUiPreferencesStore.getState();
	if (!rightSlotMemory.some(([key]) => drop.has(key))) return;
	useUiPreferencesStore.setState({
		rightSlotMemory: rightSlotMemory.filter(([key]) => !drop.has(key)),
	});
}

function follow(
	sessions: ReturnType<typeof useCanonicalSessionsStore.getState>,
): void {
	const key = rightSlotKeyForView({
		activeDraftKey: sessions.activeDraftKey,
		draftSessionId: sessions.activeDraftKey
			? sessions.drafts[sessions.activeDraftKey]?.sessionId
			: undefined,
		activeSessionId: sessions.activeSessionId,
	});
	if (key !== boundKey) {
		const admittedFrom =
			boundKey === undefined ? undefined : admittedFromFor(boundKey, key);
		useUiPreferencesStore
			.getState()
			.bindRightSlotKey(key, admittedFrom ? { admittedFrom } : undefined);
		boundKey = key;
	}
	prune(sessions);
}

/**
 * Install the follower for this document. Safe to call more than once.
 *
 * The first pass runs immediately rather than waiting for a change: a launch
 * that restores a conversation must project its memory before the first render,
 * and no store mutation may happen in between.
 */
export function installRightSlotMemoryFollower(): void {
	if (installed) return;
	installed = true;
	useCanonicalSessionsStore.subscribe(() =>
		follow(useCanonicalSessionsStore.getState()),
	);
	follow(useCanonicalSessionsStore.getState());
}
