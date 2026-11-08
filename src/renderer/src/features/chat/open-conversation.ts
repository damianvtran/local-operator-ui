import { prewarmSessionStream } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { getCurrentPath } from "@shared/utils/path-utils";
import type { NavigateFunction } from "react-router-dom";
import { type OpenEntrance, openTrace, watchSendable } from "./open-trace";

/**
 * A SWITCH'S URL IS WRITTEN HERE, WITH ITS COMMIT.
 *
 * WHAT "A SWITCH" MEANS, AND WHAT IS OUTSIDE IT. This owns the URL write of the
 * three entrances that MOVE THE VIEW ONTO A CONVERSATION: the sidebar's rows, the
 * command palette's conversation rows and the `/chat` slash rebind. It is not
 * every URL that names a chat - `chat-page.tsx`'s send path re-points the URL once
 * a draft's session has materialised, and the Schedules and Projects rows write
 * `/chat/<session id>` for somewhere the user is being SENT TO. The palette is on
 * THIS side of the split rather than that one: its conversation rows are
 * `{ type: "session" }` targets that call this rule, so the palette builds no
 * `/chat/<id>` URL of its own. Those are URL-first: they write the route and let the
 * effect open it, so none of them can defer a write behind a read and none carries
 * the defect this file exists for. What is checked by `session-switch.test.mjs` is
 * not "no other file writes a chat URL" - it is that no `/chat/<id>` write in the
 * renderer is a switch the arms have not met, with every site listed and its reason
 * given.
 *
 * THE AGENT ENTRANCES ARE NOT AMONG THEM ANY MORE (issues #844/#849), and this
 * paragraph used to name them: `app.tsx`'s create-agent landing, the agents
 * sidebar's "Chat with agent", the legacy agents page's Chat button, the agent-hub
 * download landing and the palette's agent row all wrote `/chat/<agent id>`. That
 * route has no non-session fallback (the store's `sessionByAgent` map had a reader
 * and no writer), so each of them read as a broken legacy link. They stage a DRAFT
 * now - `stageDraft({ kind, name })` then `/chat` - which is not a switch onto an
 * existing conversation and so is deliberately not a caller of this rule.
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
/**
 * Starts the conversation-open trace (`open-trace.ts`) for a switch to
 * `sessionId`, and its store-observed `sendable` stage.
 *
 * Observation only: it reads the store and never writes it. A press on the row
 * the view is already on starts nothing, mirroring `openSession`'s own no-op
 * arm - nothing loads, so there is nothing to time, and a trace there would
 * only end as a timeout. Shared by `openConversation` and the native entrance
 * (`app.tsx`), which switches through `setActiveSession` rather than here.
 */
export function beginOpenTrace(
	sessionId: string,
	entrance: OpenEntrance,
): number | null {
	const state = useCanonicalSessionsStore.getState();
	if (state.activeSessionId === sessionId && !state.activeDraftKey) return null;
	const traceId = openTrace.begin(sessionId, entrance);
	watchSendable(
		openTrace,
		traceId,
		() => useCanonicalSessionsStore.getState(),
		useCanonicalSessionsStore.subscribe,
	);
	return traceId;
}

export function openConversation(
	navigate: NavigateFunction,
	sessionId: string,
	/**
	 * Which entrance asked, for the open trace only. Optional so the many
	 * callers keep their shape; the sidebar names itself because it is the
	 * entrance the latency report is about.
	 */
	entrance: OpenEntrance = "open",
): Promise<boolean> {
	// Before the store write, so the trace's zero is the click.
	const traceId = beginOpenTrace(sessionId, entrance);
	if (traceId !== null) {
		/*
		 * THE REQUEST LEAVES HERE - in the click's own task, before the store write
		 * and before React renders anything.
		 *
		 * The pane opens its own subscription from a passive effect, and that flush
		 * is queued behind whatever else the renderer is doing. Measured on the
		 * operator's app (2026-11-08, 21 switches): the click's React commit landed
		 * 38-400 ms after the click, and the subscription request 209-16,584 ms
		 * after it, while the daemon answered in 190-400 ms whenever it arrived -
		 * the switch spent its seconds with nothing in flight. Asking here takes the
		 * request off that queue; the pane adopts the connection when it commits
		 * (`subscribeDesktopStream`), and paints nothing itself.
		 *
		 * The `request` stage is noted from HERE when a prewarm goes out, so the
		 * trace line reports when the desktop plane was actually asked rather than
		 * when the subscription was finally built.
		 */
		prewarmSessionStream(sessionId);
		openTrace.note(sessionId, "request", traceId);
	}
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
