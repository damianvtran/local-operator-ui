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
 * Nothing here keys on display text: the label the reader sees (`cwd`'s basename)
 * is a rendering of the row, never the identity used to answer it.
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
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useCallback, useRef, useState } from "react";
import {
	type AnswerOutcome,
	answerQueuedAsk,
	createSendLock,
	declineQueuedAsk,
} from "../../ask-answer";
import type { AskDraft } from "../../ask-queue";
import { askRefusalSentence } from "../../ask-queue";
import {
	FLEET_ASKS_QUERY_KEY,
	fleetAskSessionFor,
	useFleetAsks,
} from "../../fleet-asks";
import { AskDrawer } from "./ask-drawer";

/** No drafts, as one stable object: a fresh `{}` per render would re-key every card. */
const EMPTY_ASK_DRAFTS: Record<string, AskDraft> = {};

/** One ask's in-flight/refused record, as the drawer and the panel read it. */
type AskOutcomes = Record<
	string,
	{ sending: boolean; refused: string | null } | undefined
>;

export const FleetAskDrawer = ({ onClose }: { onClose: () => void }) => {
	const { rows, frontend } = useFleetAsks();
	const { client } = useOptionalQueryClient();
	const lock = useRef(createSendLock()).current;
	const [drafts, setDrafts] =
		useState<Record<string, AskDraft>>(EMPTY_ASK_DRAFTS);
	const [outcomes, setOutcomes] = useState<AskOutcomes>({});
	const [answering, setAnswering] = useState(false);

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

	const settle = useCallback(
		(askId: string, outcome: AnswerOutcome) => {
			setOutcomes((current) => ({
				...current,
				[askId]: {
					sending: false,
					refused:
						outcome.status === "failed"
							? askRefusalSentence(outcome.error)
							: null,
				},
			}));
			if (outcome.status === "sent") refresh();
		},
		[refresh],
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
				settle(askId, outcome);
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
				settle(askId, outcome);
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
			answering={answering}
			outcomes={outcomes}
			drafts={drafts}
			onDraftChange={onDraftChange}
		/>
	);
};
