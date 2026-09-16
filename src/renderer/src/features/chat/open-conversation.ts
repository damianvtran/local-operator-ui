import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { NavigateFunction } from "react-router-dom";

/**
 * THE ONE PLACE A SWITCH WRITES ITS URL.
 *
 * WHY THE URL MOVES WITH THE COMMIT AND NOT BEHIND THE GUARD READ. `openSession`
 * commits `activeSessionId` in the caller's own frame and validates behind that
 * commit, so by the time the read answers the view has already moved. Writing
 * `/chat/<id>` only on the read's `true` therefore leaves this window's OWN
 * address bar naming the conversation the user just LEFT for the whole round
 * trip - and `ChatPage`'s route-to-store effect reconciles the store TO the
 * route, which is right for a route that arrives from outside (a deep link,
 * Back, a legacy agent link) and wrong for a route this window is still in the
 * middle of writing. The effect re-opened the left conversation as a switch
 * NEWER than the user's own click, so the view went back to the conversation
 * they had left, and the click they made was refused its URL write
 * (`openSession` reports false for it once the reconcile has bumped the
 * generation). Reproduced deterministically by
 * `scripts/session-switch-latency.mjs --race-write` (the second click dispatched
 * at the first one's URL write) and `--race-palette` (the same window reached
 * from the command palette): both end on the FIRST-clicked conversation without
 * this function.
 *
 * WHY ALL THREE ENTRANCES SHARE THIS FILE. The sidebar row, the command palette
 * and the `/chat` slash rebind are three fingers on one switch, and the defect is
 * the DEFERRAL rather than any one finger: fixed in one place and left in the
 * others, the race moves to whichever entrance still defers. One rule, one place.
 *
 * WHAT IT DOES WITH A REFUSED READ. `openSession` rolls the store back to the
 * conversation the user came from, and the URL is put back with it in the same
 * turn, so a failure cannot leave the address bar on a chat nobody is in. The
 * restore reads the rollback target off the STORE rather than remembering the
 * previous id, which makes it idempotent under a superseded read and stops it
 * clobbering a newer click's URL. It is a `replace`: the failed target is not a
 * history entry the user can walk back into.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not cancel the superseded read:
 * `sessions.get` is a request/response op with no abort channel, so a read the
 * user has moved past is abandoned by the store's own navigation guard rather
 * than cancelled - and the stream subscription for the left conversation IS
 * disposed (`use-canonical-session`), which is the part of "clicking one
 * conversation cancels loading for others" the transport can honour. Nothing
 * here adds a second notion of "current": the truth about which switch is current
 * lives in the store, and this function owns only the URL half of it.
 */
export function openConversation(
	navigate: NavigateFunction,
	sessionId: string,
): Promise<boolean> {
	const store = useCanonicalSessionsStore.getState();
	const pending = store.openSession(sessionId);
	navigate(`/chat/${sessionId}`);
	void pending.then((ok) => {
		if (ok) return;
		const restored = useCanonicalSessionsStore.getState().activeSessionId;
		navigate(restored ? `/chat/${restored}` : "/chat", { replace: true });
	});
	return pending;
}
