import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	TYPING_BACKOFF_MS,
	TYPING_DEFAULT_RESEND_MS,
	TYPING_IDLE_MS,
	boundedInterval,
	useTeamBridgeShareTypingStore,
} from "./team-bridge-typing-model";

/**
 * Where a composer's typing would land. `threadRootId` set means the thread
 * pane's composer: the hint is scoped to that thread, exactly like the reply.
 */
export type TypingTarget = {
	conversationId: string;
	tenantId: string;
	/** The captured account; both writes are owner-guarded with it. */
	accountId: string;
	threadRootId?: string | null;
};

export type TypingEmitterApi = Pick<
	typeof TeamBridgeApi,
	"typingSet" | "typingClear"
>;

export type TypingEmitterHandlers = {
	/** Call from the field's real `onChange` with the new text. Nothing else starts it. */
	onInput: (text: string) => void;
	onFocus: () => void;
	onBlur: () => void;
	/** A send (or schedule) was accepted: stop now, do not wait for the idle timer. */
	onSent: () => void;
};

/**
 * Codes after which the emitter stays quiet for the rest of this renderer
 * session: the backend's hub predates the route (`outdated_hub`), so every
 * further PUT would be refused the same way. Module state on purpose - it is
 * a property of the paired backend, not of one composer.
 */
let emitterOutdated = false;
/** `Date.now()` before which no PUT leaves, after a 429/503. Shared for the same reason. */
let emitterBackoffUntil = 0;

/** Test seam: forget the session-wide refusals between cases. */
export function resetTypingEmitterSessionForTests() {
	emitterOutdated = false;
	emitterBackoffUntil = 0;
}

const targetKey = (target: TypingTarget | null) =>
	target
		? JSON.stringify([
				target.conversationId,
				target.tenantId,
				target.accountId,
				target.threadRootId ?? null,
			])
		: "";

/**
 * The sender half of typing indicators (design §6, "Sender hook").
 *
 * THE STATE MACHINE, and each rule is an acceptance criterion:
 *   - It starts ONLY on a user input event with non-empty trimmed text. A draft
 *     restored from storage, a conversation switch or a programmatic clear never
 *     reaches `onInput`, so it never reports typing (IME composition input
 *     arrives as `onChange` and counts).
 *   - While active it PUTs on start and then every `resend_after_ms` (server
 *     cadence, 3 s), never faster: a restart within one interval of the last PUT
 *     waits out the remainder rather than doubling the rate.
 *   - It sends DELETE, once, when it has an active PUT and: 5 s pass with no
 *     keystroke, the text becomes empty (by input OR by the host clearing it),
 *     the field blurs, the window goes hidden, the target changes (conversation
 *     or thread switch), the composer unmounts, or a send is accepted.
 *   - `target: null` (capability off, new-DM draft with no conversation yet,
 *     a read-only pane) and `share_typing === false` send nothing at all.
 *   - A failed PUT or DELETE is dropped silently - no retry, no toast. The
 *     hub's 8 s TTL is the safety net for a lost stop.
 *
 * `text` is the field's CURRENT value, read only to stop on a programmatic
 * clear; a non-empty `text` never starts anything.
 */
export function useTeamBridgeTypingEmitter(
	target: TypingTarget | null,
	text: string,
	api: TypingEmitterApi = TeamBridgeApi,
): TypingEmitterHandlers {
	const key = targetKey(target);
	const targetRef = useRef(target);
	targetRef.current = target;
	const apiRef = useRef(api);
	apiRef.current = api;
	const shareTyping = useTeamBridgeShareTypingStore(
		(state) => state.shareTyping,
	);
	const shareRef = useRef(shareTyping);
	shareRef.current = shareTyping;

	const state = useRef({
		/** The target the live PUT was issued for; the DELETE must name the same one. */
		active: null as TypingTarget | null,
		/** A PUT for `active` has left; only then does a stop owe a DELETE. */
		sent: false,
		focused: false,
		lastPutAt: Number.NEGATIVE_INFINITY,
		resendMs: TYPING_DEFAULT_RESEND_MS,
		resendTimer: null as ReturnType<typeof setTimeout> | null,
		idleTimer: null as ReturnType<typeof setTimeout> | null,
	});

	const clearTimers = useCallback(() => {
		const s = state.current;
		if (s.resendTimer !== null) clearTimeout(s.resendTimer);
		if (s.idleTimer !== null) clearTimeout(s.idleTimer);
		s.resendTimer = null;
		s.idleTimer = null;
	}, []);

	const stop = useCallback(() => {
		const s = state.current;
		clearTimers();
		const active = s.active;
		const sent = s.sent;
		s.active = null;
		s.sent = false;
		// Only a session whose PUT actually left has hub state to remove.
		if (!active || !sent) return;
		void apiRef.current.typingClear(active).catch(() => {
			// Dropped on purpose: the hub expires the entry within its TTL.
		});
	}, [clearTimers]);

	const put = useCallback(() => {
		const s = state.current;
		const active = s.active;
		if (!active) return;
		s.sent = true;
		s.lastPutAt = Date.now();
		apiRef.current.typingSet(active).then(
			(answer) => {
				if ("shared" in answer) {
					// lop refused locally: the preference is off. Learn it and go quiet;
					// nothing reached the hub, so there is nothing to DELETE.
					useTeamBridgeShareTypingStore.getState().setShareTyping(false);
					if (s.active === active) {
						clearTimers();
						s.active = null;
						s.sent = false;
					}
					return;
				}
				s.resendMs = boundedInterval(
					answer.resend_after_ms,
					TYPING_DEFAULT_RESEND_MS,
				);
			},
			(error: {
				code?: string;
				status?: number | null;
				retryAfterMs?: number;
			}) => {
				if (error?.code === "outdated_hub") emitterOutdated = true;
				else if (error?.status === 429 || error?.status === 503)
					emitterBackoffUntil =
						Date.now() + (error.retryAfterMs ?? TYPING_BACKOFF_MS);
				else return;
				if (s.active === active) {
					clearTimers();
					s.active = null;
					s.sent = false;
				}
			},
		);
	}, [clearTimers]);

	/** The resend tick: one PUT per interval while the session stays active. */
	const scheduleResend = useCallback(
		(delay: number) => {
			const s = state.current;
			if (s.resendTimer !== null) clearTimeout(s.resendTimer);
			s.resendTimer = setTimeout(() => {
				s.resendTimer = null;
				if (!s.active) return;
				put();
				scheduleResend(s.resendMs);
			}, delay);
		},
		[put],
	);

	const onInput = useCallback(
		(value: string) => {
			const s = state.current;
			const current = targetRef.current;
			if (value.trim() === "") {
				stop();
				return;
			}
			// Input implies focus even if the focus event was missed (a field
			// focused before this hook's target existed).
			s.focused = true;
			if (
				!current ||
				shareRef.current === false ||
				emitterOutdated ||
				Date.now() < emitterBackoffUntil ||
				(typeof document !== "undefined" &&
					document.visibilityState === "hidden")
			)
				return;
			if (s.idleTimer !== null) clearTimeout(s.idleTimer);
			s.idleTimer = setTimeout(() => {
				s.idleTimer = null;
				stop();
			}, TYPING_IDLE_MS);
			if (s.active) return;
			s.active = current;
			const sinceLast = Date.now() - s.lastPutAt;
			if (sinceLast >= s.resendMs) {
				put();
				scheduleResend(s.resendMs);
			} else {
				// A restart inside one interval waits out the remainder: the hub sees
				// at most one PUT per `resend_after_ms`, whatever the stop/start churn.
				scheduleResend(s.resendMs - sinceLast);
			}
		},
		[put, scheduleResend, stop],
	);

	const onFocus = useCallback(() => {
		state.current.focused = true;
	}, []);
	const onBlur = useCallback(() => {
		state.current.focused = false;
		stop();
	}, [stop]);
	const onSent = useCallback(() => stop(), [stop]);

	// A host-side clear (send retiring the text, a schedule, discard) is not an
	// input event, but an empty field is never "typing".
	useEffect(() => {
		if (text.trim() === "") stop();
	}, [text, stop]);

	// Target switch and unmount: stop the session that belonged to the OLD target.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the identity trigger; the cleanup reads the active target from the ref.
	useEffect(() => stop, [key, stop]);

	// The preference turned off mid-session: stop now rather than at idle.
	useEffect(() => {
		if (shareTyping === false) stop();
	}, [shareTyping, stop]);

	// A hidden window is not typing, whatever the field still holds.
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onVisibility = () => {
			if (document.visibilityState === "hidden") stop();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [stop]);

	return useMemo(
		() => ({ onInput, onFocus, onBlur, onSent }),
		[onInput, onFocus, onBlur, onSent],
	);
}
