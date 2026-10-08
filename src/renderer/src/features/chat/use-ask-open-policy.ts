import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useEffect, useLayoutEffect, useRef } from "react";
import {
	type AskOpenView,
	askDismissals,
	askOpenFacts,
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
 * shell around it, and it exists to do three things the pure module cannot:
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
}): void => {
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
	 * A DRAWER THE POLICY OPENED FOR ANOTHER CONVERSATION, CARRIED ONTO ONE THE USER
	 * DISMISSED, is closed before this pane paints (rule 4; `shouldCloseCarriedDrawer`).
	 *
	 * A LAYOUT EFFECT, keyed on the conversation, because the question only exists at the
	 * moment a view begins: the drawer is mounted by `ChatContent` from the same flag in
	 * the same commit, and a passive effect would paint one frame of the dismissed
	 * conversation's asks first - the very thing being refused. The close lands before the
	 * browser paints, so there is no frame to see. A drawer the user opened by hand is
	 * never closed here: it follows them, as it always did.
	 */
	useLayoutEffect(() => {
		if (!sessionId) return;
		const live = useUiPreferencesStore.getState();
		if (
			shouldCloseCarriedDrawer({
				conversationId: sessionId,
				dismissed: askDismissals,
				sessionDrawerOpen:
					live.isAskDrawerOpen && live.askDrawerScope === "session",
				openedByPolicy: policyOpenedDrawer,
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

	useEffect(() => {
		if (!sessionId) return;
		let slot = viewRef.current;
		if (slot === null || slot.key !== sessionId) {
			slot = {
				key: sessionId,
				view: createAskOpenView(askDismissals, Date.now()),
			};
			viewRef.current = slot;
		}
		const { verdict } = slot.view.observe({
			conversationId: sessionId,
			...askOpenFacts(view, slot.view.startedAtMs),
			nowMs: Date.now(),
			composerHasText,
			/*
			 * WHERE THE KEYBOARD IS matters only to a decision, so the DOM is not touched
			 * once the view has decided - which is every frame of a live run after the
			 * first published one.
			 */
			keyboardOnDoor: !slot.view.settled && keyboardIsOnDoor(),
			drawerOpen,
			sessionDrawerOpen,
		});
		if (verdict.action === "open") {
			/*
			 * READ THE FLAG LIVE BEFORE WRITING. `drawerOpen` above is the value this render
			 * saw; the user can press the chip in the gap before this effect runs, and a
			 * second `setAskDrawerOpen(true)` over an already-open drawer would rewrite its
			 * record of the pane it borrowed the slot from (`askDrawerEvictedPane`) and credit
			 * the user's own open to the policy. Provenance is recorded only for a write that
			 * actually happens; the store subscription above clears it for every state that
			 * is not an open session drawer, so it cannot outlive the flag.
			 */
			if (!useUiPreferencesStore.getState().isAskDrawerOpen) {
				policyOpenedDrawer = true;
				setAskDrawerOpen(true, "session");
			}
		}
	}, [
		sessionId,
		view,
		composerHasText,
		drawerOpen,
		sessionDrawerOpen,
		setAskDrawerOpen,
	]);
};
