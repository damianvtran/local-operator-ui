/**
 * Speculatively engage a session's runtime before the user sends to it.
 *
 * WHY THIS EXISTS. A cold `sessions.message` spends ~1.15 s inside the request
 * spawning `local_operator.session.runtime.process`, dialling it and waiting
 * for its welcome ack, because nothing on the desktop/HTTP surface engaged a
 * runtime first. The TUI never pays that: it engages eagerly and off the
 * critical path (`_engage_runtime_eagerly` on mount, `_warm_runtime_for_draft`
 * on the first composer keystroke, both latched). `sessions.warm` is the HTTP
 * twin of that background engage, and this hook is the policy that decides
 * when to fire it.
 *
 * THE TRIGGER IS THE FIRST KEYSTROKE INTO AN EMPTY BOX, NOT MOUNT. One warm is
 * one runtime process at roughly 283 MB. A TUI process is one session so it can
 * afford to warm on mount; the desktop sidebar makes session-switching a BROWSE
 * action, and mount-warming would spawn a runtime for every row the user
 * clicked through. Typing is the first unambiguous statement of intent to send.
 *
 * NO DEBOUNCE, BY DESIGN. The latch already collapses N keystrokes to one
 * request, so a timer would be a second mechanism doing the latch's job while
 * delaying the warm by exactly the interval that matters most — the head start
 * is the entire product.
 *
 * THE LATCH RE-ARMS ON REMOUNT, ALSO BY DESIGN. An unused runtime is reaped by
 * the residency drain a few seconds after this window stops being its
 * interactive viewer, so navigating away and back genuinely needs a new warm.
 *
 * CALL THIS ONLY FROM INSIDE THE MOUNTED, SUBSCRIBED `SessionPanel`. This is a
 * correctness precondition, not a style preference, and violating it is silent:
 *
 * The desktop bridge is reference-counted. It detaches when its last user
 * releases, and detaching CANCELS an in-flight warm so a spawn cannot outlive
 * the facade it was started against. The warm REQUEST is itself a user - so a
 * warm issued while nothing else holds the bridge is cancelled the moment its
 * own HTTP response returns, the engage never completes, and the next send pays
 * the full cold cost exactly as it did before. Measured against the warm-op
 * backend: 1634 ms with no subscription held, versus 225 ms (p50, n=10) with
 * the panel's subscription open, against a 1333 ms control.
 *
 * `SessionPanel` holds `useCanonicalSessionStream`'s subscription for as long
 * as it is mounted, and the composer that calls this lives inside it - so the
 * bridge is held across the engage by construction. Hoisting this call to
 * `ChatPage`, to a module-level latch, or to the draft store would produce a
 * warm that looks like it works and buys nothing at all.
 *
 * THE DEGRADED CASE IS EXACTLY TODAY'S BEHAVIOUR, NEVER WORSE. If the warm is
 * cancelled, fails, or never fires, the send engages inline as it always has.
 * Nothing on the send path waits on warm state, and the composer is never
 * gated on it: a speculative optimisation that could DELAY a send would be a
 * strictly worse trade than not warming at all.
 */

import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import { useCallback, useEffect, useRef } from "react";

/**
 * The capability version that publishes `POST /v1/desktop/sessions/{id}/warm`.
 *
 * Gating matters more than the error swallow below: the bundled venv and an
 * external dev backend both genuinely lag the app, and an ungated call would
 * spend a round trip per composer per session learning 404 forever.
 */
export const WARM_SESSION_CATALOGUE_VERSION = 3;

export function useWarmSession(
	sessionId: string | undefined,
	capabilities: DesktopCapabilities | null | undefined,
): () => void {
	// Keyed by session rather than a bare boolean so one mounted panel that
	// somehow sees two sessions cannot spend the first one's latch on the
	// second — and so the latch means "this session is warmed", which is the
	// claim it is actually making.
	const warmed = useRef<string | null>(null);
	const enabled = desktopFeatureEnabled(
		capabilities,
		"session_catalogue",
		WARM_SESSION_CATALOGUE_VERSION,
	);

	return useCallback(() => {
		if (!enabled || !sessionId) return;
		if (warmed.current === sessionId) return;
		// Latched BEFORE the request, because this counts intent, not success: a
		// warm that fails must not re-fire on the next keystroke, since the send
		// that follows engages again through the same path and reports properly.
		warmed.current = sessionId;
		void desktopResult({ op: "sessions.warm", sessionId }).catch(() => {
			// A warm failure teaches the user nothing they can act on, and this
			// fires from TYPING — surfacing it would make a speculative
			// optimisation produce an error banner mid-word. The backend answers
			// 200 even when the engage itself fails; what reaches here is
			// transport-level, an older backend that slipped the gate, or the fast
			// `runtime_busy` 503 for a live owner that is not answering. None of
			// them gates the composer - the send engages through its own path and
			// owns the busy resend (`admitChatDraft`) - and the latch above keeps a
			// busy owner from being re-warmed on every keystroke. Mirrors the TUI's
			// silent speculative engage.
		});
	}, [enabled, sessionId]);
}

/**
 * The draft twin of the hook above: engage a NEW chat's runtime before its
 * session exists, through the id `sessions.draft` minted.
 *
 * WHY A SEPARATE HOOK RATHER THAN A BRANCH. The trigger and the ordering are
 * different facts from a session's warm, and each is a correctness rule:
 *
 *  - THE MINT IS THE KEYSTROKE'S, NOT THIS HOOK'S. The id this warms does not
 *    exist until the pane's first keystroke asks for it (`ensureDraftWarm` in
 *    the store); this hook's whole job starts once that id lands on the draft
 *    row. Mount-warming is still forbidden for `useWarmSession`'s reason —
 *    someone clicking through panes must not spawn runtimes — and a draft pane
 *    nobody typed into has nothing to warm AND nothing to warm it with.
 *
 *  - THE WARM WAITS FOR THE SUBSCRIPTION, WHICH IS A PRECONDITION RATHER THAN
 *    POLITENESS. A warm whose only bridge user is its own request is cancelled
 *    the instant the request returns (`_detach`), so firing it before the
 *    pane's stream has opened buys precisely nothing — measured at 1634 ms
 *    with no subscription against 225 ms with one. `SessionPanel` opens the
 *    stream for the draft id as soon as the mint lands, so in practice this
 *    fires a beat after the first keystroke; on a slow answer it fires the
 *    moment the stream opens instead, which is still ahead of the send.
 *
 *  - THE LATCH IS PER DRAFT ID, AND RE-ARMS ON REMOUNT, both deliberately. A
 *    drop (the selection changed) replaces the id, so the next id warms; an
 *    unambiguous remount is a new visit whose runtime the residency drain has
 *    already reaped, exactly as `useWarmSession` documents. Within one mount,
 *    a stream restart does not re-warm — the backend's own lease loop is the
 *    retry net for as long as the pane holds a lease.
 *
 * THE DEGRADED CASE IS EXACTLY TODAY'S BEHAVIOUR. No capability, no id, no
 * subscription, a failed warm — nothing here gates the composer or the send;
 * the send engages inline as it always has. The backend answers 200 even when
 * the engage itself fails, and what reaches the catch is transport-level or an
 * older daemon that slipped the gate: none of it is the user's to act on, from
 * a hook that fires mid-word.
 */
export function useDraftWarmSession(
	draftId: string | undefined,
	subscriptionId: string | null,
	capabilities: DesktopCapabilities | null | undefined,
): void {
	const warmed = useRef<string | null>(null);
	const enabled = desktopFeatureEnabled(capabilities, "session_draft_warm");

	useEffect(() => {
		if (!enabled || !draftId || !subscriptionId) return;
		if (warmed.current === draftId) return;
		// Latched BEFORE the request, for `useWarmSession`'s own reason: this
		// counts intent, not success — a warm that fails must not re-fire on the
		// next stream frame, and the lease loop below the renderer owns retries.
		warmed.current = draftId;
		void desktopResult({ op: "sessions.warm", sessionId: draftId }).catch(
			() => {
				// Swallowed for the same reason the session warm swallows: a
				// speculative optimisation that surfaced its own failure would put an
				// error banner over a pane the user is happily typing in.
			},
		);
	}, [enabled, draftId, subscriptionId]);
}
