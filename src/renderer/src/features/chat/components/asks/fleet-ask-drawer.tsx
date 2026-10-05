/**
 * The FLEET asks drawer: every conversation's queue, in the canvas family's
 * second scope.
 *
 * ## Why it is a component and not a prop on the drawer's mount
 *
 * The scope is not only a label. A session-scoped drawer answers the conversation
 * it is mounted beside - its `onAnswer` is that session's, its lock is that
 * session's, and its rows were delivered on that session's own frame. The fleet
 * drawer has NONE of that: its rows come from the aggregate route, and every
 * answer has to be ADDRESSED at the conversation the row came from. That is a
 * different dependency set rather than a different string, so it is a different
 * component handing the SAME `AskDrawer` its own data and doors - which is what
 * keeps one container serving two contexts (design note §4.4) instead of a second
 * drawer being written for the second queue.
 *
 * ## How an answer finds the right conversation (the correctness heart)
 *
 * `fleetAskSessionFor(rows, askId)` reads `session_id` off the very row the panel
 * painted, by the `ask_id` the press already carries - so the surface and the
 * answer cannot disagree about which card was pressed, and the answer is posted to
 * the row's OWN session rather than to whichever conversation happens to be open.
 * Nothing here keys on display text: the label the reader sees (the sessions
 * catalogue's title for the row's `session_id`, see `fleet-ask-drawer.tsx`'s own
 * label block and `fleetAskConversationLabels`) is a rendering of the row, never
 * the identity used to answer it.
 *
 * ## The composer does not answer here, and that is deliberate
 *
 * §5.0's routing invariant ("while the answer surface is expanded the composer
 * answers the ask") is a property of a surface mounted BESIDE a composer. This one
 * is not: it lives in the shell's right slot, over whatever route is up, and there
 * is no single session whose composer it could be. So the fleet panel answers
 * in-panel, through the cards' own controls, and `chat-page.tsx` holds the other
 * half of that rule by reading the scope before entering ask mode. A fleet
 * question can therefore never be answered by typing into an unrelated
 * conversation's composer - the exact misroute the scope split exists to prevent.
 *
 * ## One lock, per panel
 *
 * The session lane's lock is per session and that is the wrong granularity here:
 * these rows belong to many sessions at once. What has to hold is the panel's own
 * promise - one answer in flight from THIS surface at a time - so the lock is the
 * panel's, and the per-session one-answer rule still lives where it always did,
 * on the session's own lock and on the backend's ask log.
 *
 * ## Escape, and the door that opens this pane
 *
 * The pane is opened from the conversation header's asks trigger, which is not
 * inside the drawer, so the drawer's own `onKeyDown` never sees a press made on the
 * trigger and the lane's other Escape claim (`chat-page.tsx`) is session-scoped and
 * stands down here. This component therefore claims Escape at the WINDOW while it is
 * mounted, the shape `canvas/index.tsx` and the run panel already take; the drawer
 * in turn accepts either door at entry, so focus lands inside the pane and Escape
 * is consumed even before the pointer moves. Both halves were missing on the first
 * cut, and their absence was not cosmetic: the press fell through to the app's
 * interrupt rung and stopped the agent's running turn (UX round 1, U1 / agent
 * review round 1, F1).
 *
 * ## A receipt, because the row vanishes
 *
 * Answering here settles a row that lives in another conversation, so the card
 * leaves the list when the answer lands and the only trace of the act would be that
 * absence. `settle` posts a toast naming the conversation the answer went to - the
 * fact this surface alone knows - rather than an in-pane line the drawer's own
 * layout (one scroller, no footer, design D1) has nowhere to put.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type AnswerOutcome,
	answerQueuedAsk,
	createSendLock,
	declineQueuedAsk,
	reviseQueuedAsk,
} from "../../ask-answer";
import type { AskDraft, AskOutcome, AskPresentation } from "../../ask-queue";
import { askRefusalIsOwner, askRefusalSentence } from "../../ask-queue";
import {
	FLEET_ASKS_QUERY_KEY,
	fleetAskConversationLabels,
	fleetAskSessionFor,
	useFleetAsks,
} from "../../fleet-asks";
import { pressLandsOnOverlay } from "../../keyboard-scopes";
import { AskDrawer } from "./ask-drawer";

/** No drafts, as one stable object: a fresh `{}` per render would re-key every card. */
const EMPTY_ASK_DRAFTS: Record<string, AskDraft> = {};

/** One ask's in-flight/refused/last-change record, as the drawer and the panel read it. */
type AskOutcomes = Record<string, AskOutcome | undefined>;

export const FleetAskDrawer = ({ onClose }: { onClose: () => void }) => {
	const { rows, frontend } = useFleetAsks();
	const { client } = useOptionalQueryClient();
	const lock = useRef(createSendLock()).current;
	const [drafts, setDrafts] =
		useState<Record<string, AskDraft>>(EMPTY_ASK_DRAFTS);
	const [outcomes, setOutcomes] = useState<AskOutcomes>({});
	const [answering, setAnswering] = useState(false);
	/*
	 * WHICH CONVERSATION EACH CARD IS ABOUT: the same name the sessions list gives
	 * it. The catalogue is the list's own source (`CanonicalSessionsStore`), joined
	 * here on `session_id` so the label and the row cannot disagree about a
	 * conversation's name - and resolved over the whole visible set, so two cards
	 * that would print one name are disambiguated instead of looking identical
	 * (see `fleetAskConversationLabels`).
	 */
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const titles = useMemo(() => {
		const byId = new Map<string, string>();
		for (const session of sessions) {
			const title = session.title;
			if (typeof title === "string" && title.trim().length > 0) {
				byId.set(session.session_id, title);
			}
		}
		return byId;
	}, [sessions]);
	const labels = useMemo(
		() => fleetAskConversationLabels(rows ?? [], (id) => titles.get(id)),
		[rows, titles],
	);
	const conversationOf = useCallback(
		(row: AskPresentation) => labels.get(row.ask.ask_id) ?? null,
		[labels],
	);

	/**
	 * THE REFRESH IS NOT OPTIONAL AFTER A SETTLE. The poll is the badge's heartbeat,
	 * not this list's: ten seconds of a card still showing a question the user just
	 * answered reads as a failure. The invalidation drops the ONE document both the
	 * badge and this list read (`FLEET_ASKS_QUERY_KEY`), so the count and the rows
	 * move together rather than one of them lagging the other.
	 */
	const refresh = useCallback(() => {
		void client.invalidateQueries({ queryKey: FLEET_ASKS_QUERY_KEY });
	}, [client]);

	/*
	 * ESCAPE CLOSES THE FLEET PANE FROM ANYWHERE WHILE IT IS OPEN - the shape the
	 * canvas and the run panel already take, and one this pane was missing.
	 *
	 * WHY A WINDOW LISTENER AND NOT ONLY THE SECTION'S `onKeyDown`. The session
	 * scope is protected by `chat-page.tsx`'s listener, which is gated on the
	 * session scope (`askExpanded`) and therefore stands down for this pane; the
	 * fleet pane had only a React handler on its own `section`, and a React event
	 * only bubbles from a node INSIDE that section. The door is the header trigger, so
	 * before this an Escape pressed after opening the pane from the header reached
	 * nothing in the lane - and fell to the app's interrupt rung, stopping the
	 * agent's running turn (UX round 1, U1 / agent review round 1, F1). Focus now
	 * enters the pane (the drawer's entry move accepts either door), which covers
	 * the common walk; this covers the press from ANYWHERE, including a click back
	 * onto the transcript or the header while the pane stays open.
	 *
	 * THE GUARDS ARE THE CANVAS'S, deliberately: `defaultPrevented` (a surface that
	 * already claimed the press keeps it - a React handler runs ahead of this
	 * listener and `preventDefault`s, which is why the section's handler and this
	 * one cannot both fire) and `pressLandsOnOverlay` (an open dialog, menu or
	 * listbox owns its own Escape). `preventDefault` here is the whole claim: the
	 * interrupt ladder stands down on it, so the running turn is left alone.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.isComposing === true) return;
			if (event.defaultPrevented === true) return;
			if (pressLandsOnOverlay(event.target)) return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	/*
	 * THE RECEIPT. A fleet answer is composed while the user is looking at a panel
	 * over somebody else's conversation, and the row they pressed VANISHES when the
	 * answer lands - so without this the only trace of the act is an absence, and a
	 * reader who pressed the wrong card has nothing telling them what happened or
	 * where it went (UX round 1, U5). The toast names the conversation the answer
	 * was posted to, which is the fact the user needs and the one this surface alone
	 * knows; it is the app's own transient lane, so it costs the pane no layout (the
	 * drawer has one scroller and no footer on purpose - design D1's fix).
	 */
	const receipt = useCallback(
		(verb: string, askId: string) => {
			const name = labels.get(askId);
			showSuccessToast(name ? `${verb} ${name}` : verb);
		},
		[labels],
	);

	const settle = useCallback(
		(askId: string, outcome: AnswerOutcome, verb: string, changed = false) => {
			/*
			 * ONLY THE OWNER'S OWN REFUSAL CLOSES §10's CHANGE DOOR (agent review round 2,
			 * minor). A transport failure's sentence still lands in the row (the reader is
			 * told what happened to the press), but `refusedByOwner` stays false so the
			 * card keeps its door and a second press is possible once the wire answers -
			 * the outcome record is never cleared, so latching the door shut on a failure
			 * would withdraw the affordance for the life of the pane.
			 */
			const refusal =
				outcome.status === "failed"
					? {
							refused: askRefusalSentence(outcome.error),
							refusedByOwner: askRefusalIsOwner(outcome.error),
						}
					: { refused: null };
			setOutcomes((current) => ({
				...current,
				[askId]: {
					sending: false,
					...refusal,
					/*
					 * The revision's own receipt (`AskOutcome`'s note): the wire cannot mark an
					 * accepted change, so this surface records it — and the row leaves this pane
					 * on the `refresh()` below, which is why the receipt has to exist before the
					 * card it belonged to is gone.
					 */
					...(changed ? { changed: true } : {}),
				},
			}));
			if (outcome.status !== "sent") return;
			receipt(verb, askId);
			refresh();
		},
		[receipt, refresh],
	);

	const onAnswer = useCallback(
		(askId: string, answers: Record<string, string[]>) => {
			const sessionId = fleetAskSessionFor(rows ?? [], askId);
			if (!sessionId || lock.held) return;
			setAnswering(true);
			setOutcomes((current) => ({
				...current,
				[askId]: { sending: true, refused: null },
			}));
			void (async () => {
				let outcome: AnswerOutcome;
				try {
					outcome = await answerQueuedAsk(
						{ taskId: askId, answers, sessionId, lock },
						(request) => desktopResult(request),
					);
				} finally {
					setAnswering(false);
				}
				settle(askId, outcome, "Answer sent to");
			})();
		},
		[lock, rows, settle],
	);

	/*
	 * THE CHANGE DOOR (design §10, #1936), and the FLEET is exactly the case §10 has in
	 * mind: the ask may belong to another conversation, and a revision is accepted from
	 * ANY surface while the answer is undelivered. The body is the same whole-ask map the
	 * answer door sends, plus the intent — addressed by ask id, to the session the ask
	 * names (`fleetAskSessionFor`), never to the conversation the user happens to be in.
	 *
	 * A refusal is NOT a failed receipt: the delivered sentence is the expected outcome of
	 * a change that lost its window, so it lands in the row's own outcome line rather than
	 * as a toast (the `settle` shape every other refusal here takes).
	 */
	const onRevise = useCallback(
		(askId: string, answers: Record<string, string[]>) => {
			const sessionId = fleetAskSessionFor(rows ?? [], askId);
			if (!sessionId || lock.held) return;
			setAnswering(true);
			setOutcomes((current) => ({
				...current,
				[askId]: { sending: true, refused: null },
			}));
			void (async () => {
				let outcome: AnswerOutcome;
				try {
					outcome = await reviseQueuedAsk(
						{ taskId: askId, answers, sessionId, lock },
						(request) => desktopResult(request),
					);
				} finally {
					setAnswering(false);
				}
				settle(askId, outcome, "Answer changed for", true);
			})();
		},
		[lock, rows, settle],
	);

	const onDecline = useCallback(
		(askId: string) => {
			const sessionId = fleetAskSessionFor(rows ?? [], askId);
			if (!sessionId || lock.held) return;
			setAnswering(true);
			setOutcomes((current) => ({
				...current,
				[askId]: { sending: true, refused: null },
			}));
			void (async () => {
				let outcome: AnswerOutcome;
				try {
					outcome = await declineQueuedAsk(
						{ taskId: askId, sessionId, lock },
						(request) => desktopResult(request),
					);
				} finally {
					setAnswering(false);
				}
				settle(askId, outcome, "Declined the ask in");
			})();
		},
		[lock, rows, settle],
	);

	const onDraftChange = useCallback((askId: string, next: AskDraft) => {
		setDrafts((current) => ({ ...current, [askId]: next }));
	}, []);

	return (
		<AskDrawer
			frontend={frontend}
			scope="fleet"
			onClose={onClose}
			onAnswer={onAnswer}
			onDecline={onDecline}
			onRevise={onRevise}
			answering={answering}
			outcomes={outcomes}
			drafts={drafts}
			onDraftChange={onDraftChange}
			conversationOf={conversationOf}
		/>
	);
};
