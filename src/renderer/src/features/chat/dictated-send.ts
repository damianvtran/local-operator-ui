import { joinTranscript } from "@shared/hooks/use-message-input";
import {
	panelIdentityFor,
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { dismissToast, showWarningToast } from "@shared/utils/toast-manager";
/**
 * A DICTATED SEND THAT OUTLIVES THE COMPOSER IT STARTED IN.
 *
 * The operator's report: "you use the voice to text transcription and when it's
 * transcribing after you hit the immediate send and switch to another session it
 * actually doesn't send it and stores it in the input box."
 *
 * WHY THAT HAPPENS. The chat page remounts its panel per conversation
 * (`panelMountKeyFor`), so a switch after the press destroys the composer whose
 * send was armed. The transcript then resolved on a dead instance: the words went
 * into the ORIGIN's draft row (`appendToDraft` -> `setCurrentInput(origin, ...)`)
 * and the effect that sends them (`ready-to-submit`) never ran on that tree, so
 * nothing was posted and the dictation sat in the origin's box waiting for the
 * user to notice. Nothing about that is a transcription fault; it is a send whose
 * ownership was a component's lifetime.
 *
 * THE SEND IS BOUND TO THE CONVERSATION IT STARTED IN, not to a mount. This
 * module is the record that says so: `intents` holds one live dictated send per
 * origin conversation, and `deliverers` holds the last composer that could post
 * for that origin. The dead instance's `deliverAway` closure stays registered
 * (nothing removes it on unmount) because it closes over the page's own `send` -
 * the stable function that addresses a session by id and knows nothing about
 * which pane is on screen.
 *
 * WHAT IT GUARANTEES, and each clause is a defect this file exists for:
 *
 *   - the dictation is NEVER written into another conversation's box. Every write
 *     here names the origin, through `setComposerText` (the app-side writer, which
 *     bumps `textRevision` so a remounted box adopts it);
 *   - the words reach the origin's draft BEFORE any send is attempted, so every
 *     later failure degrades to "the text is in that chat's draft" rather than to
 *     a lost dictation;
 *   - a failure is never silent. `refused` carries the class and the copy the
 *     page's own notice renders, and a persistent toast names the chat when the
 *     reader is looking at another one.
 *
 * NOT PERSISTED, deliberately. An intent describes a request in flight in this
 * renderer; a reload has no take, no burst and no deliverer, so restoring one
 * would restore a promise nobody can keep.
 */
import { createElement } from "react";
import { create } from "zustand";
import { t } from "../../../../i18n/messages";
import { openConversation } from "./open-conversation";

/** How far the press has got. `delivering` covers every await after the write. */
export type DictatedSendStage = "awaiting-take" | "transcribing" | "delivering";

/**
 * WHY A DICTATED SEND ENDED WITHOUT POSTING.
 *
 * One value per sentence, because the page states the reason to the reader and a
 * taxonomy decided at the refusal site is the only place that knows it: the
 * composer knows which of its own gates refused, the page knows whether the
 * origin is still opening, and this module knows whether the draft was edited
 * while the words were in flight.
 *
 * `transcription` is the arm with no send at all (the take could not be turned
 * into words), and `origin-gone` is the new-chat arm whose draft no longer
 * exists - the one case where the dictated text really is gone and the copy says
 * so instead of promising it is safe somewhere.
 */
export type DictatedRefusalReason =
	| "edited"
	| "command"
	| "gate"
	| "secret"
	| "no-model"
	| "unavailable"
	| "not-ready"
	| "origin-gone"
	| "transcription";

/** One live dictated send, keyed by the conversation it belongs to. */
export type DictatedIntent = {
	id: string;
	/** The composer identity the press happened in: a session id or `draft:<uuid>`. */
	originId: string;
	/** The box's text at the press, so "did the user edit while away?" is answerable. */
	draftAtPress: string;
	/** The composer instance that pressed - the ONLY one that may show its own take. */
	owner: string;
	stage: DictatedSendStage;
	/**
	 * Frozen when the words land: `mixed` when the box had typed text or the user
	 * typed during the take, `dictated` otherwise. Frozen rather than recomputed
	 * because the composer that would recompute it is gone by then, and a replay
	 * pins whichever value the first attempt carried.
	 */
	inputMode?: "dictated" | "mixed";
};

export type DictatedRefusal = {
	reason: DictatedRefusalReason;
	/** The conversation as the reader knows it: the sidebar's own label for it. */
	title: string;
	/**
	 * A sentence somebody else already wrote and that is more specific than this
	 * module can be - the page's own refusal (an unvalidated session's stream
	 * sentence, the budget's sizes). When present it is what the reader sees.
	 */
	sentence?: string;
};

/** What a deliverer answers: `true` posted, a reason otherwise. */
export type DeliverOutcome = true | DictatedRefusalReason;

export type DeliverFn = (
	text: string,
	options: {
		inputMode?: "dictated" | "mixed";
		/**
		 * THE CONVERSATION THE WORDS BELONG TO, stated rather than inferred.
		 *
		 * The composer that delivers may have been re-pointed at another conversation
		 * since the press (a host that keeps one box mounted and moves the prop), and
		 * its own `conversationId` then names the WRONG row - the exact defect this
		 * feature exists to remove, one layer down. The record knows the origin, so
		 * the record says it.
		 */
		originId?: string;
	},
) => Promise<DeliverOutcome>;

type DictatedSendState = {
	intents: Record<string, DictatedIntent>;
	refused: Record<string, DictatedRefusal>;
};

export const useDictatedSendStore = create<DictatedSendState>()(() => ({
	intents: {},
	refused: {},
}));

/**
 * The last composer per origin that could post for it.
 *
 * A holder object rather than the bare function so the registration is a field
 * write on an object that survives the registering component: the map itself is
 * never iterated while React renders, and a remounted composer overwrites the
 * entry rather than appending a second one.
 */
const deliverers = new Map<string, { current: DeliverFn }>();

/*
 * THE TOAST ACTION'S ROUTER, registered by the page that owns one. A toast is
 * raised from a module function (the deliverer may run inside a dead component's
 * continuation), so it cannot call `useNavigate`; the page hands its navigate
 * over instead. Absent in a host with no router, where the action is withheld
 * rather than rendered dead.
 */
let navigateTo: Parameters<typeof openConversation>[0] | null = null;

export function setDictatedSendNavigate(
	navigate: Parameters<typeof openConversation>[0] | null,
): void {
	navigateTo = navigate;
}

/** One toast id per origin, so a second refusal replaces the first rather than stacking. */
export function dictatedToastId(originId: string): string {
	return `dictated-away:${originId}`; // i18n: ignore toast identity, never rendered copy
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

/*
 * THE REASON CLAUSES, one key each. Kept here rather than at each refusal site so
 * the taxonomy and the copy cannot drift: a new reason is a compile error in this
 * table, which is the only place the sentence is assembled.
 *
 * `origin-gone` and `transcription` are deliberately NOT clauses: both need a
 * sentence that does not promise the text is waiting in a draft, because in both
 * the text is gone. Folding them in here is how the app would end up telling the
 * reader their dictation is safe in a chat that no longer exists.
 */
type ReasonedRefusal = Exclude<
	DictatedRefusalReason,
	"origin-gone" | "transcription"
>;

function reasonText(reason: ReasonedRefusal): string {
	switch (reason) {
		case "edited":
			return t("ui.chat.composer.dictated_away.reason_edited");
		case "command":
			return t("ui.chat.composer.dictated_away.reason_command");
		case "gate":
			return t("ui.chat.composer.dictated_away.reason_gate");
		case "secret":
			return t("ui.chat.composer.dictated_away.reason_secret");
		case "no-model":
			return t("ui.chat.composer.dictated_away.reason_no_model");
		case "unavailable":
			return t("ui.chat.composer.dictated_away.reason_unavailable");
		case "not-ready":
			return t("ui.chat.composer.dictated_away.reason_not_ready");
	}
}

/**
 * The composer notice's sentence, for the refusal the page is about to state.
 *
 * A refusal that carries its own sentence keeps it - the page wrote it and it is
 * the one the reader's other failures speak in.
 */
export function dictatedRefusalSentence(refusal: DictatedRefusal): string {
	if (refusal.sentence) return refusal.sentence;
	if (refusal.reason === "transcription")
		return t("ui.chat.composer.dictated_away.transcription_failed", {
			title: refusal.title,
		});
	if (refusal.reason === "origin-gone")
		return t("ui.chat.composer.dictated_away.origin_gone", {
			title: refusal.title,
		});
	return t("ui.chat.composer.dictated_away.not_sent", {
		title: refusal.title,
		reason: reasonText(refusal.reason),
	});
}

/**
 * The same refusal, for a surface that shows the chat's name on its own line -
 * the toast. `title` is rendered above this sentence, truncated to the toast's
 * width, so the sentence does not repeat it.
 */
function dictatedRefusalBody(refusal: DictatedRefusal): string {
	if (refusal.sentence) return refusal.sentence;
	if (refusal.reason === "transcription")
		return t("ui.chat.composer.dictated_away.transcription_failed_body");
	if (refusal.reason === "origin-gone")
		return t("ui.chat.composer.dictated_away.origin_gone_body");
	return t("ui.chat.composer.dictated_away.not_sent_body", {
		reason: reasonText(refusal.reason),
	});
}

/* ------------------------------------------------------------------ */
/* The conversation the reader is looking at                           */
/* ------------------------------------------------------------------ */

/**
 * The identity of the conversation on screen, by the page's own rule
 * (`panelIdentityFor` over the view's session id), so "is the view on the origin?"
 * and the page's own keying cannot disagree.
 */
function viewIdentity(): string | undefined {
	const state = useCanonicalSessionsStore.getState();
	const draft = state.activeDraftKey
		? state.drafts[state.activeDraftKey]
		: undefined;
	return panelIdentityFor(
		state.activeDraftKey,
		panelSessionIdOfView(
			state.activeDraftKey,
			draft?.sessionId,
			state.activeSessionId,
		),
	);
}

/** How the reader knows this conversation: its title, its target's name, or a label. */
function titleForOrigin(originId: string): string {
	const state = useCanonicalSessionsStore.getState();
	const title = state.sessions
		.find((row) => row.session_id === originId)
		?.title?.trim();
	if (title) return title;
	const target = state.drafts[originId]?.target?.name?.trim();
	if (target) return target;
	return originId.startsWith("draft:")
		? t("ui.chat.composer.dictated_away.draft_label")
		: t("ui.chat.composer.dictated_away.untitled_chat");
}

/* ------------------------------------------------------------------ */
/* Refusal surfacing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Record a refusal and, when the reader is NOT looking at the origin, say it out
 * loud where they are.
 *
 * The page's notice covers a reader who is in the chat (now, or when they come
 * back to it) - it is the one surface that can hold a sentence and the text in
 * the same frame. A reader who has moved on sees nothing of that pane, so the
 * persistent toast is the only honest channel left; it is dismissed by the origin
 * pane's own effect when they open it, which is also when the notice takes over.
 *
 * Never carries the dictated text: it is the reader's speech, and the point of
 * the sentence is that the words are somewhere else.
 */
function recordRefusal(
	originId: string,
	reason: DictatedRefusalReason,
	sentence?: string,
): void {
	const refusal: DictatedRefusal = {
		reason,
		title: titleForOrigin(originId),
		...(sentence ? { sentence } : {}),
	};
	useDictatedSendStore.setState((state) => ({
		refused: { ...state.refused, [originId]: refusal },
	}));
	if (viewIdentity() === originId) return;
	const canOpen = navigateTo !== null && !originId.startsWith("draft:");
	showWarningToast(
		/*
		 * TWO LINES, because they answer different questions: WHICH chat (a title
		 * longer than the toast is truncated rather than wrapped over three lines)
		 * and WHY nothing was sent. One string would either repeat the name or
		 * lose it to truncation. A node rather than a string, which is why
		 * `showWarningToast` takes one now.
		 */
		createElement(
			"div",
			{ className: "flex min-w-0 flex-col gap-0.5" },
			createElement(
				"span",
				{ key: "title", className: "truncate font-medium" },
				refusal.title,
			),
			createElement("span", { key: "body" }, dictatedRefusalBody(refusal)),
		),
		{
			id: dictatedToastId(originId),
			duration: Number.POSITIVE_INFINITY,
			closeButton: true,
			...(canOpen && navigateTo
				? {
						action: {
							label: t("ui.chat.composer.dictated_away.open_chat"),
							onClick: () => {
								if (navigateTo) void openConversation(navigateTo, originId);
							},
						},
					}
				: {}),
		},
	);
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

function intentFor(id: string): DictatedIntent | undefined {
	return Object.values(useDictatedSendStore.getState().intents).find(
		(intent) => intent.id === id,
	);
}

function patchIntent(id: string, patch: Partial<DictatedIntent>): void {
	useDictatedSendStore.setState((state) => {
		const entry = Object.entries(state.intents).find(
			([, intent]) => intent.id === id,
		);
		if (!entry) return state;
		return {
			intents: {
				...state.intents,
				[entry[0]]: { ...entry[1], ...patch },
			},
		};
	});
}

export const dictatedSends = {
	/** The intent a conversation holds, for a composer's busy face. */
	intentForOrigin(originId: string): DictatedIntent | undefined {
		return useDictatedSendStore.getState().intents[originId];
	},

	/** Whether this conversation already owns a dictated send (registration gate). */
	has(originId: string): boolean {
		return useDictatedSendStore.getState().intents[originId] !== undefined;
	},

	/**
	 * Arm a dictated send for `originId`.
	 *
	 * `null` when one is already live for that conversation: a second press is
	 * refused rather than queued, because two bursts writing one box would race
	 * each other's joins and the second transcript has no box to land in.
	 */
	begin(
		originId: string,
		options: { draftAtPress: string; owner: string },
	): string | null {
		const state = useDictatedSendStore.getState();
		if (state.intents[originId]) return null;
		const id = crypto.randomUUID();
		useDictatedSendStore.setState((current) => ({
			intents: {
				...current.intents,
				[originId]: {
					id,
					originId,
					draftAtPress: options.draftAtPress,
					owner: options.owner,
					stage: "awaiting-take",
				},
			},
		}));
		return id;
	},

	/** The press ended without a send (a discarded take, a completed stay send). */
	end(id: string): void {
		useDictatedSendStore.setState((state) => {
			const entry = Object.entries(state.intents).find(
				([, intent]) => intent.id === id,
			);
			if (!entry) return state;
			const intents = { ...state.intents };
			delete intents[entry[0]];
			return { intents };
		});
	},

	/** The take is on the wire: the busy face applies to every composer of this origin. */
	markTranscribing(id: string): void {
		patchIntent(id, { stage: "transcribing" });
	},

	/** The page refused a send it was asked to make for an origin it is not showing. */
	refuseAway(
		originId: string,
		reason: DictatedRefusalReason,
		sentence?: string,
	): void {
		recordRefusal(originId, reason, sentence);
	},

	clearRefusal(originId: string): void {
		useDictatedSendStore.setState((state) => {
			if (!state.refused[originId]) return state;
			const refused = { ...state.refused };
			delete refused[originId];
			return { refused };
		});
	},

	/**
	 * The words landed on a composer that is gone: put them in the origin's draft
	 * and ask that origin's sender to post them.
	 *
	 * THE WRITE COMES FIRST, and that ordering is the whole safety argument: from
	 * the line below onward every outcome (a refusal, a throw, a dead network)
	 * degrades to "the text sits in the origin's draft" instead of to silence.
	 *
	 * The intact check is the stay path's own rule, applied to a box nobody is
	 * watching: if the origin's draft is no longer exactly what the press captured,
	 * the user has edited it since, and appending would send words they never
	 * joined. The transcript is merged instead and nothing is posted.
	 */
	async deliverAway(
		id: string,
		transcript: string,
		inputMode?: "dictated" | "mixed",
	): Promise<void> {
		const intent = intentFor(id);
		if (!intent) return;
		const box = useConversationInputStore.getState();
		if (
			intent.originId.startsWith("draft:") &&
			!useCanonicalSessionsStore.getState().drafts[intent.originId]
		) {
			recordRefusal(intent.originId, "origin-gone");
			dictatedSends.end(id);
			return;
		}
		const current = box.getCurrentInput(intent.originId);
		if (current !== intent.draftAtPress) {
			box.setComposerText(intent.originId, joinTranscript(current, transcript));
			recordRefusal(intent.originId, "edited");
			dictatedSends.end(id);
			return;
		}
		const text = joinTranscript(intent.draftAtPress, transcript);
		box.setComposerText(intent.originId, text);
		patchIntent(id, { stage: "delivering", inputMode });
		const holder = deliverers.get(intent.originId);
		if (!holder) {
			recordRefusal(intent.originId, "unavailable");
			dictatedSends.end(id);
			return;
		}
		/*
		 * THE REFUSAL THE DELIVERER (or the page behind it) WROTE WINS: it names the
		 * arm - a slash command, a pending gate, an unvalidated session - and this
		 * module can only see "not posted". The identity check is what keeps that
		 * rule honest without a timestamp: a refusal recorded DURING this await is
		 * the one that belongs to it.
		 */
		const before = useDictatedSendStore.getState().refused[intent.originId];
		let outcome: DeliverOutcome = "unavailable";
		try {
			outcome = await holder.current(text, {
				inputMode,
				originId: intent.originId,
			});
		} catch {
			outcome = "unavailable";
		}
		if (outcome === true) {
			dictatedSends.end(id);
			return;
		}
		if (useDictatedSendStore.getState().refused[intent.originId] === before)
			recordRefusal(intent.originId, outcome);
		dictatedSends.end(id);
	},

	/**
	 * The take could not be turned into words. No send happened and none can: the
	 * recording was never kept on this path (there is no composer to offer it
	 * back), so the sentence says that rather than offering a Retry that would
	 * have no bytes.
	 */
	failAway(id: string, reason: DictatedRefusalReason): void {
		const intent = intentFor(id);
		if (!intent) return;
		recordRefusal(intent.originId, reason);
		dictatedSends.end(id);
	},

	/**
	 * Point a conversation at the composer that can post for it.
	 *
	 * Called from a layout effect on every render, so the entry is always the
	 * FRESHEST closure (the one holding this render's gates); never called on
	 * unmount, because a dead instance's closure is still the only thing that can
	 * reach the page's send and the next mount overwrites it anyway.
	 */
	register(originId: string, deliver: DeliverFn): void {
		const existing = deliverers.get(originId);
		if (existing) existing.current = deliver;
		else deliverers.set(originId, { current: deliver });
	},
};

/** Test hook: the map is module state and a suite must be able to start clean. */
export function resetDictatedSendsForTests(): void {
	deliverers.clear();
	useDictatedSendStore.setState({ intents: {}, refused: {} });
}

/** The toast a refusal raised for a chat the reader is not in (page dismissal). */
export function dismissDictatedToast(originId: string): void {
	dismissToast(dictatedToastId(originId));
}
