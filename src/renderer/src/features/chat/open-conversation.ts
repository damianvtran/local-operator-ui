import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { getCurrentPath } from "@shared/utils/path-utils";
import type { NavigateFunction } from "react-router-dom";

/**
 * A SWITCH'S URL IS WRITTEN HERE, WITH ITS COMMIT.
 *
 * WHAT "A SWITCH" MEANS, AND WHAT IS OUTSIDE IT. This owns the URL write of the
 * three entrances that MOVE THE VIEW ONTO A CONVERSATION: the sidebar's rows, the
 * command palette and the `/chat` slash rebind. It is not every URL that names a
 * chat - `chat-page.tsx`'s send path re-points the URL once a draft's session has
 * materialised, and `app.tsx`, `agents-sidebar.tsx`, `legacy-agents-page.tsx`,
 * `use-download-agent-mutation.ts` and `onboarding-modal.tsx` write `/chat/<id>`
 * for somewhere the user is being SENT TO. Those are URL-first: they write the
 * route and let the effect open it, so none of them can defer a write behind a
 * read and none carries the defect this file exists for. What is checked by
 * `session-switch.test.mjs` is not "no other file writes a chat URL" - it is that
 * no `/chat/<id>` write in the renderer is a switch the arms have not met, with
 * every site listed and its reason given.
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
	const written = `/chat/${sessionId}`;
	navigate(written);
	void pending.then((ok) => {
		if (ok) return;
		/*
		 * ONLY WHILE THIS CALL'S OWN WRITE IS STILL THE ROUTE.
		 *
		 * The refusal can arrive after the user has moved on WITHOUT this switch being
		 * the thing that was superseded. `openSession` reports `false` for any newer
		 * intent, and staging a draft is one: `stageDraft` bumps the same
		 * `navigationGeneration` counter (`canonical-sessions-store.ts`) that a switch
		 * does while leaving `activeSessionId` alone, so a restore derived from
		 * `activeSessionId` writes `/chat/<the session the user LEFT>` over the user's
		 * `/chat` - and `ChatPage`'s route-to-store effect then reads that stale route
		 * as an instruction and re-opens it, clearing the draft. Measured: click a row,
		 * press New chat while its `sessions.get` is in flight (the window is the whole
		 * read - 25-32 s on the machine in the report), and the user's New chat is
		 * silently undone. The same restore pulls a user out of Settings when a read
		 * for a deleted session finally answers.
		 *
		 * So the bound is "is my own write still the URL", read from the URL rather
		 * than from the router (`getCurrentPath` reads the hash `navigate` writes
		 * synchronously; the router's `useLocation` mirror lags it by a render, which is
		 * the lag this whole file is about). If anything moved - a newer switch, a
		 * staged draft, a route out of chat entirely - the failure is not this call's to
		 * report and the route is not this call's to repair.
		 */
		if (getCurrentPath() !== written) return;
		const state = useCanonicalSessionsStore.getState();
		/*
		 * A staged draft is the view here, so `/chat` is where the user is, however the
		 * route came to name a session (`stage()` writes `/chat` with the draft in the
		 * same gesture; a caller that stages without writing would otherwise get the
		 * session URL). The draft key is read from the store, which owns it.
		 */
		if (state.activeDraftKey) {
			navigate("/chat", { replace: true });
			return;
		}
		const restored = state.activeSessionId;
		navigate(restored ? `/chat/${restored}` : "/chat", { replace: true });
	});
	return pending;
}
