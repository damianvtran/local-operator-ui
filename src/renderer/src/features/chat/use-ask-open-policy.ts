import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	type AskOpenView,
	askDismissals,
	askOpenAnnouncement,
	askOpenFacts,
	askOutstandingReading,
	createAskOpenView,
	shouldCloseCarriedDrawer,
} from "./ask-open-policy";
import {
	ASK_HEADER_ITEM_SELECTOR,
	ASK_ITEM_SELECTOR,
	type AskQueueView,
} from "./ask-queue";

/**
 * Whether the keyboard is on one of the drawer's two DOORS right now: the composer
 * chip or the conversation header's asks trigger. The same two selectors the drawer's
 * entry move reads (`ask-drawer.tsx`), so "a door has focus" means one thing in both
 * places. `matches` is guarded because the active element can be a non-element.
 */
const keyboardIsOnDoor = (): boolean => {
	const active = document.activeElement;
	return (
		active !== null &&
		typeof active.matches === "function" &&
		(active.matches(ASK_ITEM_SELECTOR) ||
			active.matches(ASK_HEADER_ITEM_SELECTOR))
	);
};

/**
 * Whether the session drawer that is open RIGHT NOW was opened by this policy, as
 * opposed to the user's own press.
 *
 * The store keeps one flag (`isAskDrawerOpen`) and cannot say who wrote it, and the
 * flag deliberately follows the user between conversations. That is the one place the
 * per-view contract can leak: dismiss A, arrive at B (the policy opens the drawer for
 * B), go back to A, and the CARRIED flag shows A's drawer again - a drawer the policy
 * never re-opened but the user dismissed (`shouldCloseCarriedDrawer` has the full
 * argument). Closing it needs the provenance, and provenance is only knowable here, at
 * the one place that writes a policy open.
 *
 * MODULE STATE BECAUSE ITS LIFETIME IS THE FLAG'S, not a mount's: the open outlives the
 * pane that wrote it (that is the whole point), so a ref on the hook would be gone by
 * the time it is needed. It is cleared by a store subscription rather than by whichever
 * pane happens to be mounted, because the flag can be closed or handed to the fleet
 * pane while no chat pane exists to see it (a settings route), and a stale `true` would
 * then credit the policy with a drawer the user opened later by hand.
 */
let policyOpenedDrawer = false;
useUiPreferencesStore.subscribe((state) => {
	if (!(state.isAskDrawerOpen && state.askDrawerScope === "session")) {
		policyOpenedDrawer = false;
	}
});

/**
 * Opens the asks drawer BY ITSELF when a conversation with pending asks is opened.
 *
 * The decision is `ask-open-policy.ts`'s (read its module note for the six rules, the
 * "existed before the view" test and the bounded wait). This hook is the thin React
 * shell around it, and it exists to do five things the pure module cannot:
 *
 *  1. OWN THE VIEW'S LIFETIME. A view is one mount of a conversation's pane, and this
 *     hook is mounted by `ChatContent`, which sits under `SessionPanel key={identity}`,
 *     so switching conversations unmounts it and coming back mounts a NEW one - which
 *     is what makes a dismissal survive a switch (the record is the page's
 *     `askDismissals`, outside any mount) while the "once" resets.
 *  2. READ THE LIVE FACTS the module takes as inputs: the store's drawer flags, whether
 *     the composer holds text, where the keyboard is, and the clock.
 *  3. APPLY THE VERDICT through the store's ONE writer, `setAskDrawerOpen`, so an
 *     auto-open goes through the same slot claim as a press on the chip - including
 *     the borrow of a durable pane, which the close gives back.
 *  4. CLOSE WHAT MUST NOT BE CARRIED when a view BEGINS over an open drawer it did not
 *     ask for (`shouldCloseCarriedDrawer`): a dismissed conversation's, or one whose
 *     landing frame proves nothing is outstanding. The mount frame is judged before the
 *     browser paints, and the frame that lands later is judged too - the same predicate
 *     both times, so the two halves cannot drift.
 *  5. RETURN THE LIVE REGION'S SENTENCE. The `<output aria-live="polite">` that tells a
 *     reader who cannot see the drawer (design review round 1, D1) must be mounted
 *     BEFORE it has text, so this hook returns the one sentence a POLICY open speaks
 *     (`askOpenAnnouncement`) and the call site renders it in an always-mounted region;
 *     a chip press and a refresh write nothing, and any close clears it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never focuses anything, because it has no
 * element to focus and the drawer does not move focus on a mount that no door opened
 * (`ask-drawer.tsx`'s entry move reads `openedByDoor`, and the policy declines to open
 * while the keyboard is on a door, so it never reads as one). It never writes the
 * dismissal record from a close handler: the record is made by observing the flag's
 * open -> closed edge, which catches every writer of that flag at once. And it never
 * touches the composer: the box keeps its ordinary placeholder and its ordinary send
 * while the drawer is up (the composer-to-ask routing is gone, and nothing here
 * brings it back).
 *
 * ONE ARGUMENT PER KEY THE STORES ARE ADDRESSED BY, and they are different things:
 * `sessionId` is the backend conversation (what a dismissal is remembered against and
 * what `AskQueueView` describes), `composerId` is the composer's own key
 * (`ChatContent`'s `conversationId`, equal to `sessionId` for a live pane and the
 * draft key before the session exists). A draft has no `sessionId`, so the policy
 * waits on it forever and does nothing, which is the contract's "no conversation".
 */
export const useAskOpenPolicy = ({
	sessionId,
	composerId,
	view,
}: {
	sessionId: string | undefined;
	composerId: string | undefined;
	view: AskQueueView;
}): string => {
	/*
	 * THE LIVE REGION'S SENTENCE (design review round 1, D1): "" until a POLICY open
	 * writes it, cleared when the drawer closes. It is RETURNED rather than rendered
	 * here because the region must be mounted BEFORE it has text - a region that mounts
	 * together with its content is frequently not announced - so the call site keeps one
	 * `<output aria-live="polite">` in its tree and only its CONTENT changes.
	 */
	const [announcement, setAnnouncement] = useState("");
	const drawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	const sessionDrawerOpen = useUiPreferencesStore(
		(s) => s.isAskDrawerOpen && s.askDrawerScope === "session",
	);
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	/*
	 * A BOOLEAN SELECTOR, so a keystroke re-renders this only when the answer flips
	 * (empty -> text, text -> empty), not on every character. `pendingText` counts: it is
	 * a returned message waiting to be adopted into the box, and it is the user's words.
	 */
	const composerHasText = useConversationInputStore((s) => {
		const row = composerId ? s.inputByConversation[composerId] : undefined;
		return (
			(row?.currentInput ?? "").trim() !== "" ||
			(row?.pendingText ?? "").trim() !== ""
		);
	});

	/*
	 * A DRAWER THE POLICY OPENED FOR ANOTHER CONVERSATION IS NOT CARRIED ONTO A VIEW THAT
	 * WOULD NOT HAVE IT OPEN, and this is where the view BEGINS: carried onto one the
	 * user dismissed (rule 4), or onto one whose mount frame already proves nothing is
	 * outstanding (rule 3's settled queue - U3, agent review round 1).
	 * `shouldCloseCarriedDrawer` states both arms.
	 *
	 * A LAYOUT EFFECT, keyed on the conversation, because the question only exists at the
	 * moment a view begins: the drawer is mounted by `ChatContent` from the same flag in
	 * the same commit, and a passive effect would paint one frame of the dismissed
	 * conversation's asks first - the very thing being refused. The close lands before the
	 * browser paints, so there is no frame to see. A drawer the user opened by hand is
	 * never closed here: it follows them, as it always did.
	 *
	 * "DISMISSED" HERE IS THE RECORD AS IT STANDS AT MOUNT, and a pane mounts with an unread
	 * frame (the stream starts at `frontend: null`), which settles nothing: a held record
	 * therefore closes the carried drawer even when it is about to prove stale. That is the
	 * safe order. The passive effect below reconciles the record against the frame the
	 * moment it lands, and a record that proves stale (the waved-off asks resolved while the
	 * user was away, a new batch queued) opens the drawer for that batch like any other
	 * pending-on-open view - one closed beat, which is also how a cold open of any other
	 * conversation reads - while a record that still holds keeps it shut.
	 *
	 * THE MOUNT FRAME IS HANDED IN AS THE LANDING READING, so a pane that mounts with a
	 * frame already RESOLVED (a story, a rig, a cached frame) closes a carried drawer over
	 * a SETTLED queue before the browser paints, and the record is settled against that
	 * frame first: closing a carried drawer over a record the same frame is about to prove
	 * stale would shut the very drawer the view then opens. An unread frame settles nothing
	 * (`reconcile`) and proves nothing (the second arm fails closed), so for the app's
	 * ordinary mount this line changes no verdict - the passive effect below completes
	 * the same judgement when the frame lands (see `wasDecided` there).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per view, at its start, on the frame that view mounted with; every later frame is the passive effect's
	useLayoutEffect(() => {
		if (!sessionId) return;
		askDismissals.reconcile(sessionId, askOutstandingReading(view));
		const live = useUiPreferencesStore.getState();
		if (
			shouldCloseCarriedDrawer({
				conversationId: sessionId,
				dismissed: askDismissals,
				sessionDrawerOpen:
					live.isAskDrawerOpen && live.askDrawerScope === "session",
				openedByPolicy: policyOpenedDrawer,
				landing: askOutstandingReading(view),
			})
		) {
			live.setAskDrawerOpen(false, "session");
		}
	}, [sessionId]);

	/*
	 * The view lives in a ref, created in the effect and keyed by the conversation, so
	 * that the simulated unmount/mount StrictMode runs in development finds the SAME
	 * view (a state initializer would be discarded and rebuilt, and the second build
	 * would be a fresh "once"). A change of `sessionId` under one mount is not expected
	 * (the pane is keyed by it) but is handled as a new view rather than trusted.
	 */
	const viewRef = useRef<{ key: string; view: AskOpenView } | null>(null);

	/*
	 * THE DRAWER FLAGS ARE READ LIVE IN THE EFFECT, and the render's own copies below are only
	 * its triggers. The layout effect above can close a carried drawer AFTER this render read
	 * the flag, so the render's value is stale by exactly that close: observed as written, the
	 * next render would look like the USER closing the drawer, which over a frame that has not
	 * answered spends the view's one decision (`before-decision`), and the frame that lands a
	 * moment later - the one that may prove the record stale and open the drawer for a fresh
	 * batch - would arrive to a view that had already decided. The close the policy performs
	 * on its own behalf must never be read as the user's.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `drawerOpen` and `sessionDrawerOpen` are the re-run triggers; the body reads the same flags live from the store
	useEffect(() => {
		if (!sessionId) return;
		const flags = useUiPreferencesStore.getState();
		const liveDrawerOpen = flags.isAskDrawerOpen;
		const liveSessionDrawerOpen =
			flags.isAskDrawerOpen && flags.askDrawerScope === "session";
		let slot = viewRef.current;
		if (slot === null || slot.key !== sessionId) {
			slot = {
				key: sessionId,
				view: createAskOpenView(askDismissals, Date.now()),
			};
			viewRef.current = slot;
		}
		/*
		 * `wasDecided` IS READ BEFORE `observe` SETTLES THE VIEW, because the carried close
		 * below is part of a view's BEGINNING, not a live watcher: a drawer a view opened
		 * itself survives its queue settling (a settled row is history, #864), so the close
		 * must not fire once the view has taken its own decision - turning the live settle
		 * into a close would be Q1's behaviour change smuggled in as a side effect.
		 */
		const wasDecided = slot.view.settled;
		const facts = askOpenFacts(view, slot.view.startedAtMs);
		const { verdict } = slot.view.observe({
			conversationId: sessionId,
			...facts,
			nowMs: Date.now(),
			composerHasText,
			/*
			 * WHERE THE KEYBOARD IS matters only to a decision, so the DOM is not touched
			 * once the view has decided - which is every frame of a live run after the
			 * first published one.
			 */
			keyboardOnDoor: !wasDecided && keyboardIsOnDoor(),
			drawerOpen: liveDrawerOpen,
			sessionDrawerOpen: liveSessionDrawerOpen,
		});
		if (verdict.action === "open") {
			/*
			 * THE WRITE IS UNCONDITIONAL BECAUSE THE DECISION ALREADY WAS. `observe` refuses
			 * to open over an up drawer (`drawer-open`), reading the same flag this effect
			 * read live a few lines above, and nothing writes the store in between - so the
			 * second "read the flag before writing" guard that used to sit here could never
			 * fire and no test could pin it (agent review round 1, M1). Provenance is
			 * recorded only for the write that actually happens; the store subscription
			 * above clears it for every state that is not an open session drawer, so it
			 * cannot outlive the flag.
			 */
			policyOpenedDrawer = true;
			setAskDrawerOpen(true, "session");
			/*
			 * AND THE OPEN SPEAKS, exactly when it is the policy's own (design review round
			 * 1, D1). The reader who pressed a door did that themselves and hears nothing;
			 * a queue refresh writes nothing; one sentence per policy open, and the effect
			 * below clears it on close so a later open re-announces.
			 */
			setAnnouncement(askOpenAnnouncement(view));
		} else if (
			!wasDecided &&
			shouldCloseCarriedDrawer({
				conversationId: sessionId,
				dismissed: askDismissals,
				sessionDrawerOpen: liveSessionDrawerOpen,
				openedByPolicy: policyOpenedDrawer,
				landing: {
					outstandingIds: facts.outstandingIds,
					listComplete: facts.listComplete,
				},
			})
		) {
			/*
			 * THE PASSIVE HALF OF THE LAYOUT RULE, for the app's ordinary mount whose first
			 * frames are unread: the frame that lands and proves NOTHING is outstanding (or
			 * the dismissed landing the mount frame could not settle) closes the carried
			 * drawer here. The close is the policy's own, and the close watch reads it as
			 * what it is - the frame it lands on has nothing to show, which is
			 * `nothing-to-show`, never a dismissal - so the record and the latch are left
			 * exactly as the frame above set them.
			 */
			flags.setAskDrawerOpen(false, "session");
		}
	}, [
		sessionId,
		view,
		composerHasText,
		drawerOpen,
		sessionDrawerOpen,
		setAskDrawerOpen,
	]);

	/*
	 * CLEARED ON THE OPEN -> CLOSED TRANSITION, so a later policy open re-announces (an
	 * unchanged sentence is not re-spoken, which is exactly what the clear is for) and a
	 * stale sentence cannot describe a surface that is down. This is about the FLAG,
	 * not the door: every close clears it, including the policy's own carried close and
	 * the drawer's #864 auto-close over an emptied queue. The TRANSITION, not the
	 * closed state: the commit that OPENS the drawer renders with the flag still false
	 * (the write lands in that commit's effect), and an effect keyed on "is it closed"
	 * would wipe the sentence the open wrote in the same flush.
	 */
	const drawerWasOpen = useRef(sessionDrawerOpen);
	useEffect(() => {
		if (drawerWasOpen.current && !sessionDrawerOpen) setAnnouncement("");
		drawerWasOpen.current = sessionDrawerOpen;
	}, [sessionDrawerOpen]);

	return announcement;
};
