/** Canonical sessions are the only conversation identities. Profile names stage
 * drafts; the legacy agent mapping is retained only to resolve old deep links.
 *
 * SHARED CONVENTION, NAMED THE SAME WAY AT THE TUI'S ROW-NORMALISATION POINT
 * (`SessionSidebar._unpinned_rank`) AND IN ITS `docs/design/mesh-ui.md` §1.3.1,
 * AND BY THIS SIBLING CHANGE - the sentence kept verbatim across surfaces
 * (design review round 1, D4; agent review round 1, R1):
 *
 * > Remote rows are first-class: they file into the same bins as local rows under
 * > the same ordering rule, carry a per-row indicator, and their hover reads the
 * > owning device and its network; there is no separate remote section.
 *
 * This module is the UI's half of that sentence: `settlePeerCatalogue` merges a
 * peers-inclusive answer's remote rows into this catalogue, the sidebar renders
 * them through the one row component (the reserved locality cell and its mark in
 * `features/chat/components/chat-remote-mark.tsx`, the flyout's and the
 * accessible name's one fragment in `features/chat/chat-remote.ts`), and the
 * bins that sentence names are this list's own - Running, Today, This week,
 * Older, Pinned.
 */
import {
	DesktopControlError,
	UserFacingError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
// The echo seam, not the hook itself: these are module-level functions over a
// registry of mounted transcripts, so the store never touches React state and
// the dependency stays one-way (the hook does not import this store).
import {
	discardPendingSends,
	hasPendingSend,
	movePendingSendIdentity,
	paintPendingSend,
	peekLocalEcho,
	replacePendingSendText,
	retractLocalEcho,
	settlePendingSend,
} from "@shared/hooks/use-canonical-session";
/*
 * The composer's own store, imported for the ONE return path (`returnPayload`)
 * and for `ChatDraft`'s read of what was sent. Direction is deliberate and
 * already the one this module's callers use: the composer store holds no
 * session state, so nothing here can cycle through it.
 */
import {
	type ConversationInputState,
	useConversationInputStore,
} from "@shared/store/conversation-input-store";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
	DESKTOP_REFUSAL_SENTENCE,
	type DesktopModelSelection,
	type DesktopRequest,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	isDesktopRefusalCode,
} from "../../../../shared/desktop-contract";
import {
	type CanonicalFrontendState,
	type CompletionAttention,
	type CompletionAttentionAckReceipt,
	type SessionBinding,
	type SessionCatalogueStatus,
	type SessionOpenedBy,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";
import type { LaunchTarget } from "../../../../shared/open-session";

export type CanonicalSessionRow = {
	session_id: string;
	title?: string | null;
	cwd?: string | null;
	updated_at?: number | null;
	/**
	 * When this conversation was born, in epoch SECONDS (the wire's
	 * `created_at`), or absent/non-positive when the backend could not read its
	 * birth record.
	 *
	 * Declared explicitly beside `updated_at` because this row type has an index
	 * signature: without it, every read of the "Created" basis is `unknown`
	 * where the one reader lives (`chat-list-sections.ts`'s `rowTimeMs`), which
	 * is how a renamed field would empty the basis silently.
	 */
	created_at?: number | null;
	preview?: string | null;
	attention?: CompletionAttention;
	live_state?: string;
	pending?: string | null;
	/**
	 * How many QUEUED asks this conversation has open, as the catalogue row
	 * carried it (`SessionCatalogueRow.asks_open`).
	 *
	 * Declared explicitly beside `pending` for the reason that comment gives about
	 * `pinned`: this row type has an index signature, so without a declaration
	 * every read of it is `unknown` at the one place that draws the chip. It is a
	 * SECOND state rather than a widening of `pending`, which stays the approval
	 * queue: a session with asks outstanding may be working perfectly well, and
	 * folding the two would make the rail call a working session "waiting for
	 * you" - the mislabel the design's §5 header forbids.
	 *
	 * OPTIONAL AND ABSENT TOGETHER with the wire field, for the same skew reason as
	 * the rest of the queued-ask contract: a backend without the feature never
	 * sends it, and absent and `0` are the same answer (no chip).
	 */
	asks_open?: number | null;
	active?: boolean;
	/**
	 * The backend's pin state for this conversation, as the catalogue row carried
	 * it. Declared explicitly beside `active`/`status` because this row type's
	 * index signature would otherwise type every read of it `unknown` at the one
	 * place that writes it optimistically (`setSessionPin`).
	 *
	 * The wire row's `pinned` is ALWAYS present (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts` says why that matters here): the merge below
	 * is `{...current, ...incoming}`, so an omitted key would leave this app's
	 * optimistic `true` immortal after an unpin made somewhere else - the
	 * terminal, or another window.
	 */
	pinned?: boolean;
	/**
	 * The backend's ARCHIVE state for this conversation, as the catalogue row
	 * carried it. Declared explicitly beside `active`/`status` because this row
	 * type's index signature would otherwise type every read of it `unknown` at the
	 * one place that writes it optimistically (`setSessionArchived`).
	 *
	 * The wire row's `archived` is ALWAYS present (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts` says why that matters here): the merge below is
	 * `{...current, ...incoming}`, so an omitted key would leave this app's
	 * optimistic `true` immortal after an unarchive made somewhere else.
	 */
	archived?: boolean;
	status?: SessionCatalogueStatus;
	/**
	 * The feed's stamp for `status`, as the catalogue row carried it.
	 *
	 * Declared here as well as on the wire row (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts`) because the client's row is what the two
	 * writers are ordered on, and an index signature alone would make every read of
	 * them `unknown` at the one place that compares them. Optional on both sides
	 * and absent together: no stamp means the backend has published none for this
	 * session, which is not the same as revision 0.
	 */
	status_revision?: number;
	status_epoch?: string;
	/**
	 * How many subagents this session owns that are RUNNING, and how many are
	 * waiting for capacity, as the catalogue row carried them.
	 *
	 * Declared here as well as on the wire row (`SessionCatalogueRow` in
	 * `desktop-session-contract.ts`, whose comment carries the `null` semantics)
	 * for the reason `pinned`/`archived`/`status_revision` above are: this row type
	 * has an index signature, so without a declaration here every read of these two
	 * keys is `unknown` and the next reader casts - and `row.subagents_queued === 0`
	 * over `unknown` is exactly where a `null` {"does not report"} becomes a `0`
	 * {"none"}.
	 *
	 * THE RENDERER NOW READS THESE TWO FIELDS, and anyone reading the paragraph
	 * that used to stand here ("the renderer draws no count of its own: the numbers
	 * reach the user inside `status.label`") should know why it changed rather
	 * than "fixing" the read away. `status.label` carries the counts on ONE code
	 * only - `delegating`, the rung the catalogue reaches when nothing louder is
	 * true - so on every other rung they were on the row and nowhere on screen,
	 * and a session that had finished its own turn while its children still worked
	 * read as done (the operator's report, 2026-09-29). `features/chat/
	 * chat-session-subagents.ts` is the one reader: it draws a mark and composes a
	 * sentence from these fields on the rungs `status.label` cannot speak for, and
	 * deliberately composes NOTHING on `delegating`, where the label already says
	 * it. So the label remains the counts' channel wherever it has them, and this
	 * is the channel for everywhere it does not.
	 */
	subagents_running?: number | null;
	subagents_queued?: number | null;
	binding?: SessionBinding;
	/**
	 * Who opened this conversation, when an agent rather than the operator did.
	 *
	 * Declared rather than left to the index signature below for the reason the two
	 * stamps above are: every read of an undeclared key on this type is `unknown`,
	 * and the sidebar's row draws a marker from this one. It needs no write site of
	 * its own - the catalogue map spreads the wire row's fields onto this one, so
	 * the value arrives with the read that fetched it, and a backend that sends no
	 * `opened_by` leaves it `undefined` and the marker undrawn.
	 */
	opened_by?: SessionOpenedBy | null;
	/**
	 * THE MESH'S FLAT LOCALITY FIELDS, on rows that arrived from a listing which
	 * asked for peers (`include_peers`). Declared rather than left to the index
	 * signature below for the reason `opened_by` is: every read of an undeclared
	 * key on this type is `unknown`, and the sidebar's row and its clause read
	 * all five.
	 *
	 * `locality` IS THE ONLY FIELD THAT ANSWERS "WHERE". A plain page omits it
	 * entirely (the wire sends it only on a listing that asked; see
	 * `SessionCatalogueRow`), which is why every reader treats ABSENCE as "no
	 * claim" and never as "local". `owner_device` is `""` on a local row and
	 * the holder's id on a remote one, `owner_device_name` is the display half,
	 * and `reachable`/`unreachable_reason` are the owner's answer to the poll
	 * that produced the row.
	 */
	locality?: "local" | "remote";
	owner_device?: string;
	owner_device_name?: string;
	reachable?: boolean;
	unreachable_reason?: string;
	[key: string]: unknown;
};
type BackendSessionRow = Omit<CanonicalSessionRow, "session_id"> & {
	id: string;
	name: string;
	mtime: number;
};
/**
 * A pin press the backend did not accept, and what to say about it.
 *
 * Carries the INTENT rather than the row, so the retry re-sends the same desired
 * state the user asked for and nothing else: a retry that re-read the row would
 * send whatever the catalogue says NOW, which after a merge could be the value
 * the failed press failed to change.
 */
/**
 * What this client knows about one conversation's pin, and WHEN it learned it.
 *
 * The `at` stamp is the currency that keeps two writers ordered. Without it the
 * fact outranks every later answer, so a pin made here and removed on the other
 * surface leaves the row reading pinned and the next press sends the state the
 * backend already holds - round 2's Qr2-1 with the polarity reversed, against
 * the two-way claim this work exists for. With it, an answer that SPEAKS about
 * the id (the catalogue page, the search answer) supersedes a fact older than the
 * answer's own request, while a fact written after that request survives it -
 * which is the half that stops an answer in flight across a press from undoing
 * the press. The stamp is taken when the REQUEST starts, never when its answer
 * lands: comparing arrival times would let an answer that predates a press
 * supersede it, the same defect on a shorter clock.
 */
export type PinFact = {
	pinned: boolean;
	/** The sequence this write took, which orders it against every request. */
	at: number;
	/*
	 * What a ROW needs to be drawn, carried WITH the fact (design round 4, D17; UX round 4,
	 * U14). The panel may have to draw a pinned conversation its catalogue page does not
	 * carry, and a fact that were only a boolean would leave it drawing nothing at all - a
	 * pin the terminal and the backend both hold and the app silently under-reports, which
	 * is the state the round refused. Taken from the row the press acted on, or from the
	 * seed the press carried when the store held no row.
	 */
	title?: string;
	updated_at?: number;
};

/**
 * Where this window last knew one conversation to live, and WHEN it learned it.
 *
 * WHY A FACT AND NOT ONLY THE ROW. The rows a page rebuilds are the pages' to
 * describe, but a conversation can live somewhere no PLAIN page can carry: a
 * session minted on a peer is absent from every plain listing (this store's own
 * `fetchSessions` never asks for peers - agent review F1), so the catalogue's
 * next answer replaces membership WITHOUT it and drops the freshly-stamped row
 * while the conversation is still starting. By then the create's stamp is off
 * the pane (the draft retired), so the header's device control - which reads the
 * row - falls to `On this device` over a session the peer just minted (operator
 * report, 2026-09-30; reproduced on the two-daemon rig, 2026-10-05, 231 ms after
 * the send). The fact is what holds the row against an answer that cannot speak
 * about the id.
 *
 * THE CURRENCY IS `PinFact`'S, on the same counter: the write takes the next
 * sequence when it LANDS (`settlePlacement`, and the settlement below), the
 * answers that can settle it take theirs when the REQUEST starts, and a fact
 * written after a request started is left alone - so a page already in flight
 * across a create or a move cannot undo it, and a peers-inclusive answer asked
 * for afterwards settles the fact with the wire's own pair, recency-checked.
 *
 * LOCAL PAIRS PROTECT NOTHING, on purpose: a local row's absence from a plain
 * page means what it always meant, so the drop rule stays byte-for-byte today's
 * for every conversation no fact calls remote.
 */
export type PlacementFact = {
	locality: "local" | "remote";
	owner_device: string;
	/** The sequence this write took, which orders it against every request. */
	at: number;
};

/**
 * One row of the page a held claim is adjudicated against.
 *
 * The id is what the claim is matched by; `ts` is the page's own clock and the
 * half of the verdict `complete` cannot carry — the stamp is epoch SECONDS on
 * the wire (the reducer reads `entries[0].ts` as the page's `oldestSeconds` for
 * the same reason), while a claim's `submittedAt` is the press's `Date.now()`
 * in milliseconds. `resolveHeldFromServer` is where the two are compared.
 */
export type HeldClaimPageEntry = { id: string; ts: number };

export type PinFailure = {
	sessionId: string;
	/** The desired state that was refused, not the state on screen. */
	pinned: boolean;
	/**
	 * The conversation's title as the row carried it when the user pressed, so the
	 * sentence names the row they pressed rather than one a later catalogue read
	 * has retitled or dropped.
	 */
	title: string;
	/**
	 * The backend's own sentence for the refusal, EMPTY when the failure was not
	 * one either this transport or the backend authored - a runtime exception's
	 * `message` is a stack-trace fragment, and putting it on screen states the
	 * failure in the language of the crash (`userFacingMessage` says the same
	 * thing for the same reason). Empty means the store's own sentence is the
	 * whole truth about what happened.
	 */
	detail: string;
};
/**
 * What this client knows about one conversation's archive state, and when.
 *
 * See `archiveFacts` on the state for why the stamp exists; this is the shape it
 * is stored in. Deliberately narrower than the pin's own fact: a pin has to
 * describe a conversation the page cannot carry, because pinning moves a row
 * OUT of the flat list into a section of its own and the row must still be
 * drawn. Archiving moves a row nowhere - the archived row is simply not drawn by
 * default - so a fact here needs no `title`/`updated_at` to reconstruct a row
 * from, and the one surface that must report the state without a row (the open
 * conversation's header pill) reads the boolean.
 */
export type ArchiveFact = {
	archived: boolean;
	/** The request sequence this write took, which orders it against every read. */
	at: number;
	/**
	 * Whether the write this fact was written by has been ANSWERED. False between the
	 * press and the daemon's sentence, and that window is what the offer's retirement
	 * rule has to respect.
	 *
	 * WHY A FIELD RATHER THAN A SECOND RECORD: it is the same lifecycle. The press writes
	 * the fact (optimistic, unanswered), the answer settles it (accepted) or deletes it
	 * (refused), and a read newer than both keeps the fact exactly as it stands - so the
	 * flag travels with the value it belongs to and cannot drift from it. A reader that
	 * needs to know whether the client is still WAITING asks this, and the one that does is
	 * `archive-undo.ts`'s retirement subscription.
	 *
	 * WHAT IT IS FOR, measured on the control beside the one U3 was about (agent review
	 * round 2, R2-1): the retirement rule reads this fact first, so an OPTIMISTIC fact makes
	 * the rule say "the conversation no longer holds the state the offer was taken from"
	 * before anything has been refused. The offer is therefore retired at the press, the
	 * message is dismissed - and a refusal arriving in its place is raised on the id that was
	 * just dismissed, which sonner destroys inside its own unmount window. Undo, the
	 * header's own restore control and `/unarchive` all write this route, so the gate belongs
	 * to the fact rather than to any one caller.
	 */
	answered: boolean;
};
/**
 * The undo offer a successful archive stands, and what pressing Undo would take
 * back.
 *
 * A plain record rather than a callback: every surface offers the same act -
 * unarchive THIS conversation - so the press is the panel's own call to the same
 * store action (`setSessionArchived(id, false, title)`), and the offer does not
 * have to carry a closure from whichever surface happened to make it. That is what
 * lets the offer be retired from outside the component that drew it.
 */
export type ArchiveUndoOffer = {
	sessionId: string;
	/** The name to quote, when the surface that offered it had one. */
	title?: string;
	/** The state the offer was taken from: what the press would take back. */
	archived: boolean;
	/**
	 * The write stamp this offer was raised under, so the toast surface can tell it
	 * apart from a refusal by CURRENCY rather than by kind (agent review round 3,
	 * R3-1 = UX round 3, U7). Without it the drawing preferred the refusal
	 * unconditionally, and because `archiveFailure` is only cleared for its own
	 * conversation, one refused archive meant every later successful archive's offer
	 * was never drawn.
	 */
	at: number;
};

/**
 * The conversation an archive confirmation is asking about, and the KIND of
 * surface that asked.
 *
 * IN THE STORE for the delete candidate's own reason (see `deleteCandidate`
 * below): five surfaces ask this one question - the row's hover control, the row's
 * context menu, the `⌘⇧A` chord (which presses that control), a typed `/archive`
 * and the pane header's menu item - and they reach the store from three different
 * subtrees. One candidate and one dialog is what keeps "one act, one register"
 * true after the act gained a question.
 *
 * `fromRow` IS THE SURFACE, and it is carried rather than inferred because the two
 * kinds of door want different things afterwards. A row's own press acts on a row
 * that is ABOUT to leave the list the reader is standing in, so the caret has to
 * follow it to the row that takes its place (`focusRowAfterRemoval`). The typed
 * and header doors are answered where the reader already is - the composer, or the
 * menu that shut - so the dialog's own opener restoration is the whole rule.
 */
export type ArchiveConfirmCandidate = {
	sessionId: string;
	/** True when a ROW's own control (or its menu item, or the chord) asked. */
	fromRow: boolean;
	/**
	 * True when the pane HEADER's menu item asked, so the caret goes back to that menu's
	 * trigger and nowhere else (UX round 1, U4).
	 *
	 * A SEPARATE FLAG rather than an inference from `fromRow: false`, because the typed door
	 * is also `fromRow: false` and goes back to the composer. And rather than trusting the
	 * element that held focus when the dialog opened: the header's menu item is unmounted as
	 * the menu shuts, so what `document.activeElement` was at that instant depends on the
	 * order Radix closes the menu and mounts the dialog - measured, the same press returned
	 * to the trigger in one palette's run and to a sidebar row in the other's.
	 */
	fromHeader?: boolean;
	/**
	 * The name to ask about when the store holds no row for `sessionId`.
	 *
	 * CARRIED BY THE CANDIDATE since the dialog moved to the app shell (UX round 1, U1):
	 * it used to be a prop from `ChatContent`, which owns the open conversation's
	 * title - and a dialog that has to work on EVERY route has no such parent. The two
	 * doors that can name a conversation the list is not drawing (a typed `/archive`
	 * and the header's item) know the pane's title and pass it; a row door always has
	 * a row, so it leaves this out.
	 */
	title?: string;
};

/**
 * The undo a discard stands, and the SNAPSHOT that makes it real.
 *
 * WHY THE SNAPSHOT IS THE POINT (design round 1, D1; UX round 1, U3). A discard
 * deletes the draft row AND the composer's row for its key whole — text, chips,
 * quotes and the up-arrow log — and until this type that deletion was the only
 * record of what had been there: the PR's own note ("nothing to restore from")
 * was the reason it shipped with no offer, which argued for the very loss this
 * app's two precedents refuse (an archive offers an Undo because a recoverable
 * action with no visible trace reads as a delete; conversation delete asks in a
 * dialog that names the thing). The offer is therefore built from the exact
 * entries the write is about to remove, kept in ONE value beside `drafts` so the
 * removal and its offer land in the same update — a split update would leave a
 * window in which the offer stands for a state that has not moved yet.
 *
 * ONE SLOT, REPLACED RATHER THAN STACKED: a second discard overwrites this value,
 * so only the most recent removal is recoverable, exactly as the archive keeps one
 * pressable offer at a time. `restoreDraftsUndo` consumes it on the offer's Undo
 * press; the toast that draws it (`components/undo-toasts.tsx`) clears the slot
 * when the message ends.
 *
 * THE COMPOSER ROWS ARE PART OF THE SNAPSHOT rather than re-derived, because
 * `clearAll` drops the row outright and there is no third place the payload
 * lives — the snapshot IS the payload's only surviving home between the write and
 * a restore.
 */
export type DraftsUndoOffer = {
	/** The write stamp this offer was raised under — the offer's own identity, so a retirement watch cannot take a LATER offer off the screen (the `ArchiveUndoOffer.at` rule). */
	at: number;
	/** The keys retired, in the order the write retired them. */
	keys: string[];
	/** The draft entries exactly as they stood before the delete. */
	drafts: Record<string, ChatDraft>;
	/** The composer rows exactly as they stood before `clearAll` dropped them. */
	composer: Record<string, ConversationInputState>;
};

/**
 * A conversation THIS WINDOW must not draw, and when it learned so.
 *
 * TWO WRITERS, ONE RULE. The first is a delete this window performed: dropping the
 * row from `sessions` is not enough to delete anything, because every read this
 * store issues REPLACES membership from its own answer, so a catalogue page whose
 * request started before the delete - and there is nearly always one, because the
 * page is read on mount, on focus, on visibility, on every catalogue revision and
 * by the 30 s safety poll - lands afterwards and puts the row straight back,
 * drawing a conversation the user permanently removed, clickable and re-deletable.
 * The second is the conversation's own STREAM answering not-found while the view
 * was still validating a switch onto it (`confirmSessionMissing`, which replaced
 * `openSession`'s guard read): the conversation is gone, and a pane that rolled back to a "Start a chat"
 * landing - or, after a reload, to a fresh draft bound to a dead id - explains
 * nothing about why (QA round 1, Q1). Both writers mean the same thing to every
 * reader: this id may not be drawn, it may not hydrate a transcript, and its pane
 * lands on the missing-session notice.
 *
 * THE STAMP IS THE ARCHIVE FACT'S OWN CURRENCY (`answerSeq`, taken at the WRITE,
 * compared against the sequence a read took when its REQUEST STARTED), and it is
 * what orders the record against every read in flight.
 *
 * A TOMBSTONE IS SETTLED BY A RESURRECTION, NOT BY A PAGE (agent review round 2,
 * R2-1). It used to be settled by any page that outranked it and did not carry the
 * id - which said nothing about the search answers still live, so a cached answer
 * asked before the delete drew the row again, deterministically, with no race. It
 * now goes only when a page that outranks it CARRIES the id back (something
 * recreated the conversation). A page that outranks it and does not carry the id
 * is what the tombstone predicted and changes nothing.
 *
 * A SEARCH ANSWER NEVER SETTLES IT, for the same reason: search answers are cached
 * per query for 30 s (`session-search.ts`), so one already in hand can name the id
 * long after the delete. Every join filters against this record (`searchChats`,
 * `ArchiveView.forgotten`), in the sidebar and in the command palette alike.
 *
 * The title is kept only so a surface that has to NAME the conversation after the
 * row is gone can still do so - the pane's header is the one that needs it, and
 * "Untitled chat" over a conversation the user just deleted names nothing. The
 * not-found writer has no title to give: it never read one.
 */
export type ForgottenFact = {
	/** The request sequence the delete took, which orders it against every read. */
	at: number;
	/** The conversation's name as the row held it, for a surface that must name it. */
	title?: string;
};
/**
 * An archive press the backend did not accept, and what to say about it.
 *
 * Carries the INTENT rather than the row, so a retry re-sends the same desired
 * state the user asked for and nothing else: a retry that re-read the row would
 * send whatever the catalogue says NOW, which is the value the failed press
 * failed to change.
 */
export type ArchiveFailure = {
	sessionId: string;
	/**
	 * The write stamp the refusal was raised under (see `ArchiveUndoOffer.at`): the toast
	 * surface draws whichever of its two messages is NEWER, and this is what says which
	 * that is.
	 */
	at: number;
	/** The desired state that was refused, not the state on screen. */
	archived: boolean;
	/**
	 * The conversation's title as the row carried it at the press, so the sentence
	 * names the row the user pressed rather than one a later catalogue read has
	 * retitled or dropped.
	 */
	title: string;
	/**
	 * The backend's own sentence for the refusal, EMPTY when the failure was not
	 * one either this transport or the backend authored - a runtime exception's
	 * `message` is a stack-trace fragment, and putting it on screen states the
	 * failure in the language of the crash (`userFacingMessage` says the same
	 * thing for the same reason). Empty means the store's own sentence is the
	 * whole truth about what happened.
	 */
	detail: string;
};
export type ChatDraft = {
	key: string;
	target?: ChatTarget;
	createRequestId: string;
	admissionRequestId: string;
	sessionId?: string;
	/**
	 * The mint's at-most-once key (`sessions.draft`'s `requestId`), stable per
	 * draft.
	 *
	 * WHY IT LIVES ON THE ROW. A mint registers an id on the daemon, so the
	 * retries the pane will inevitably make for one draft — a fast second
	 * keystroke before the first answer lands, a lost response — must be the SAME
	 * request for the backend's receipt to answer them with the same id. Two ids
	 * for one pane would warm two runtimes and leave a registry entry nobody can
	 * consume.
	 *
	 * Regenerated whenever the selection changes (`setDraftModel`, `setCwd`),
	 * because a receipt replays the FIRST answer: after a drop, re-asking under
	 * the old key would hand the pane back the superseded selection's draft id —
	 * the one runtime v1 deliberately does not carry across the change.
	 *
	 * Optional because rows outlive builds and arrive from storage: a row without
	 * one gets its key lazily, on the keystroke that mints.
	 */
	draftRequestId?: string;
	/**
	 * The draft id `sessions.draft` minted for this pane, or absent.
	 *
	 * The pane's runtime is warmed on THIS id and `sessions.create` adopts it on
	 * send, so the conversation is born on a runtime that is already up. It is
	 * runtime state about a daemon registry, and every one of its rules follows:
	 * NOT persisted (`partialize` strips it — a reload cannot know whether the
	 * registry survived, and a stale id would 404 the pane's own stream), cleared
	 * when the selection changes, and never a substitute for `sessionId` — the
	 * identity the panel keys on stays the draft key until the create hop sets
	 * `sessionId`.
	 */
	warmId?: string;
	/**
	 * The model the FIRST turn of this draft will be born on, or absent when the
	 * user never picked one.
	 *
	 * DRAFT state, and deliberately nothing else: it is read by the pane's
	 * `sessions.preview` (so the readings on screen are this model's) and by
	 * `sessions.create` on send (so the first turn runs on it). It is never
	 * written to the host's settings — choosing a model for one conversation must
	 * not move the machine's default — which is why it lives on the row rather
	 * than behind `settings.edit`.
	 *
	 * Absent and `null` mean the same thing to every reader here (`model == null`
	 * in both), and `null` is what the store records when a choice is cleared so
	 * that the row states the intent rather than the absence of a key.
	 */
	model?: DesktopModelSelection | null;
	/**
	 * The DEVICE this draft's conversation will be created on, when the user picked a
	 * peer from the chat header's device control (`features.peers`). Absent means this
	 * device, which is the only shape every backend has ever served.
	 *
	 * DRAFT state, like `model` above and for the same reason: choosing a machine for
	 * one conversation must not move any machine's default. The header's chip reads it
	 * to answer "where WILL this be created" before any runtime exists - the state the
	 * operator's own screenshot was in - and `sessions.create` sends the same value as
	 * the wire's `peer` (`desktop-contract.ts`).
	 *
	 * THE DIRECTORY FACT THAT RIDES WITH IT: a remote create carries an explicit `cwd`,
	 * and an EMPTY one resolves to the peer's home rather than to this project (the
	 * peer's own resolver, `relay._resolve_peer_cwd`), so a pane with a peer
	 * destination must name the directory it will use rather than implying the one on
	 * screen.
	 */
	peer?: string;
	pending?: boolean;
	error?: string;
	errorCode?: string;
	submittedText?: string;
	submittedAttachments?: string[];
	submittedImages?: ChatImage[];
	submittedMode?: "prompt" | "steer";
	/**
	 * The provenance the FIRST attempt of the current message carried (arch
	 * §4.2). Pinned beside `submittedMode` and for the same reason: the server
	 * keys its receipt on a hash of the whole body, so a retry must replay the
	 * bytes the first attempt sent - not re-derive them from a composer whose
	 * flags have moved since.
	 */
	submittedInputMode?: "typed" | "dictated" | "mixed";
	/**
	 * The reserved `input_path` slot (§4.2a): no caller sets it today, and the
	 * pin exists so the first one that does cannot get a 409 from its own retry.
	 */
	submittedInputPath?: string;
	/**
	 * When the CURRENT attempt was issued, from the press's own clock - the
	 * anchor the wait line's clock counts from.
	 *
	 * WHY THE ROW CARRIES IT RATHER THAN THE PANE. The wait this number describes
	 * starts at Enter and outlives the pane that pressed it (the identity flip
	 * remounts, a switch away and back remounts again), and the working line's
	 * own contract is that the number never restarts under the reader. A pane's
	 * own mount time cannot count from before the pane existed, and re-deriving
	 * from `pending` alone would restart the clock at every remount - so the
	 * anchor is a persisted field of the CLAIM, written in the same update that
	 * writes `pending` and `submittedText`, and read by whoever paints the line.
	 */
	submittedAt?: number;
	/**
	 * The text this request actually put on the wire, pinned at the first attempt.
	 *
	 * It is NOT always `submittedText`: the composer's `beforeAdmission` seam
	 * substitutes stored credentials and per-message context into the text before
	 * it leaves, so a replay that re-rendered would be a same-id request whose
	 * body hashes differently - which the receipt journal refuses as a conflict
	 * (409), turning a Retry into a permanent failure for a message that may well
	 * have landed. Pinned, the replay is byte-identical by construction (risk R3).
	 */
	submittedRendered?: string;
	/**
	 * Whether the notice's `Retry` is honest for `error`, as the classifier decided
	 * it (`sendFailureCopy`), recorded here because the ROW outlives the component
	 * that raised the notice.
	 *
	 * WHY THE ROW HAS TO CARRY IT. A later mount reads `error` (a sentence) and
	 * `errorCode` and has no Error in hand, so the pane used to answer the same
	 * question from "is there an error on screen" - which is true for every
	 * failure this store records, so `Retry` was hidden on exactly the arms it
	 * exists for (the unknown outcome, where the same id replays) and offered on
	 * the late-delivery arm, where pressing it duplicates the message. One
	 * decision, taken where the failure was classified, read by whoever renders.
	 */
	errorRetry?: boolean;
	/**
	 * Set once a message the PREVIOUS release held outside the composer has been
	 * moved back into it (`migrateHeldClaim`), so the move happens once however
	 * many times a pane mounts over the row.
	 */
	migratedHeld?: boolean;
	/**
	 * THE RELEASED APP'S OWN CLAIM MARKER, and the only field that identifies a row
	 * that app left behind.
	 *
	 * Nothing in this build writes it. It is read exactly once, by
	 * `migrateHeldClaim`, to answer "was this row written by the app that held a
	 * failed message OUTSIDE the composer?" - because the fields a legacy held row
	 * shares with this build's own failure rows (`submittedText`,
	 * `admissionAttempted`, a not-pending row) are the same fields, and keying the
	 * migration on those alone made it fire on every fresh failure, wipe the replay
	 * identity and hand the same message back twice. A row this build wrote carries
	 * no `heldClaimCode`, so it can never be treated as legacy - which is the
	 * property the migration needs and the one the old gate did not have.
	 */
	heldClaimCode?: string;
	/**
	 * The message a SERVER ANSWER proved did not reach the owner, kept so the
	 * transcript can state its fate after the claim that named the ambiguity has
	 * ended (§F3's `Not delivered`, §F2's last bullet).
	 *
	 * WHY A FIELD RATHER THAN THE CLAIM ITSELF. A held claim means "the owner may
	 * have admitted this before the response was lost" — an open question the
	 * composer states its own notice about while it is open. A re-subscribe
	 * answers it: the server's snapshot names every message it holds, so a claimed
	 * payload the snapshot does not name provably did not land (see
	 * `resolveHeldFromServer`). The claim then has nothing left to hold — the
	 * composer stops stating it — but the MESSAGE still has a fate to state, and
	 * the line that states it is on the message. So the claim ends and this record
	 * begins, carrying its OWN `recordId` because ending the claim mints a fresh
	 * `admissionRequestId` (the released one may still be executing on the owner,
	 * and reusing it would make the next send an idempotent replay of the old
	 * payload — this is the rotation inside `resolveHeldFromServer`).
	 *
	 * CLEARED by every path that ends the draft (`finishDraft`, `discardDraft`) —
	 * a successful send deletes the row outright, so the line's lifetime ends
	 * with the conversation moving on.
	 */
	undelivered?: {
		recordId: string;
		text: string;
		attachments: readonly string[];
	};
	/**
	 * True only once an admission request has actually been ISSUED, i.e. its
	 * outcome is genuinely unknown to us. This is what the unchanged-payload
	 * guard keys on: a send that failed BEFORE admission (session creation
	 * refused, provider unconfigured) admitted nothing, so holding the composer
	 * to that exact text would lock a conversation over a failure we know did
	 * not land. Only a request that may already be executing must be retried
	 * byte-for-byte.
	 */
	admissionAttempted?: boolean;
};
export type ChatImage = {
	data_b64: string;
	mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

/**
 * Shown when a send failed with nothing user-facing to say - a runtime
 * exception rather than a backend rejection. Stated once and shared, because
 * the page-level fallback and this one are the same sentence about the same
 * event and drifted apart when they were two literals.
 */

/**
 * The app's own sentence for a REFUSAL, and the error's own for everything else.
 *
 * WHY THIS IS NOT A BARE `userFacingMessage` CALL (measured, review round 3): the
 * translator composes the desktop transport's refusal vocabulary, and the store's
 * errors are not all refusals - a session the server does not know arrives as the
 * app's own "Unknown session." and routing it through the translator replaced it
 * with the generic fallback, which is the same class of mistake in the other
 * direction (three session-switch cases caught it). A transport refusal has a
 * `DesktopControlError`; anything else keeps the message it was given.
 */
const storeErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof DesktopControlError
		? userFacingMessage(error, fallback)
		: error instanceof Error
			? error.message
			: fallback;

/**
 * The read window's refusal, as a category.
 *
 * A send addressed to a session whose own stream has not yet delivered its
 * snapshot is refused by the store, because the commit puts the view on that
 * session before anything has confirmed it still exists. A code rather than a
 * string comparison on the copy: the sentence below is expected to be reworded,
 * and matching prose would silently stop matching.
 *
 * Two consumers read it, and neither can key off the copy. `chat-page` retires
 * the notice when the window it describes closes, the same way
 * `unresolved_attachment` retires its own on an observable condition. And the
 * composer WITHHOLDS its generic retry hint for this code: the hint is the
 * alert's "what to do" half, and "send it again" is refused by this same window
 * for exactly as long as the notice is on screen, so the sentence carries its
 * own statement of the wait instead (UX round 3, U9).
 */
export const SESSION_UNVALIDATED_CODE = "session_unvalidated";

/**
 * What a send refused by the read window says, in the composer's own row.
 *
 * This refusal used to be silent, which is a real defect and not a stylistic
 * one: the user pressed Enter and the app did nothing at all - no request, no
 * line, no explanation - for as long as the read took, and when the backend
 * was dead that was the rest of the session (UX round 2, U8). The refusal
 * itself is right; saying nothing about it was not.
 *
 * The words follow branding section 8: what happened (the message was not
 * sent), what it means (this chat is not ready for messages yet), and what to
 * do. The "what to do" half is the sentence itself rather than the composer's
 * generic "Your message is still in the composer. Send it again.", which is
 * suppressed for this code (see above).
 *
 * WHO STILL READS IT, since the click stopped issuing a guard read (agent review
 * round 2, R2-3). The chat pane no longer refuses a press inside the window: it
 * HOLDS it until the conversation's stream answers (`chat-page`'s `send`). So
 * this sentence is reached from two places only: `admitChatDraft`'s own refusal,
 * for any caller that does not hold (the store keeps the rule for every door),
 * and the pane's fallback when its stream gave up but carried no statement of
 * its own - the stream's own lost-connection sentence is preferred there, so
 * the composer and the transcript cannot disagree (design round 1, D3).
 */
export const SESSION_UNVALIDATED_MESSAGE =
	"This chat is not ready for messages yet, so the message was not sent. Sending works once it is ready.";

/**
 * A send refused because its text STARTS WITH A SLASH.
 *
 * The backend's own policy: `local_operator/server/routes/desktop_sessions.py`
 * refuses any message whose text `lstrip().startswith("/")`, because a leading
 * slash means "command" and a command travels on a different endpoint. A
 * multi-line draft the planner correctly classified as PROSE (`/usage` on line
 * one, the message on line two, caret at the end) therefore reaches the messages
 * endpoint carrying that first line and is refused there — and no amount of
 * resending can make it work: the same bytes meet the same rule forever (UX
 * round 2, U13).
 *
 * A code rather than a match on the refusal's copy, for the same reason the two
 * above are: the sentence is the transport's shared 422 string ("...invalid
 * fields."), used by refusals this does not describe, and prose is expected to
 * be reworded. The condition that identifies THIS refusal is the payload the
 * store sent, which the store holds.
 */
export const LEADING_SLASH_CODE = "leading_slash_message";

/**
 * What a send refused for its leading slash says, in the composer's own row.
 *
 * The refusal's own copy is the transport's sentence about a malformed request,
 * which names a cause the user cannot act on, and the composer's generic retry
 * hint ("Send it again") points at the one action that can never succeed here.
 * What is true is that the user's draft is still in the composer and has two
 * fixes, both in front of them — so the sentence names them (branding section 8:
 * what happened, what it means, what to do).
 */
export const LEADING_SLASH_MESSAGE =
	"A message can't start with / — that is a command. Move it below your text, or send it on its own.";

/**
 * Whether a refused send is the leading-slash policy refusal.
 *
 * Keyed on the PAYLOAD the store sent rather than on the refusal's copy: the 422
 * carries the transport's shared sentence, and matching prose would silently
 * stop matching when it is reworded. `trimStart` mirrors the backend's `lstrip`.
 * Restricted to 422 because that is the only status the policy raises — a
 * leading-slash draft that failed for some OTHER reason (a lost response, a dead
 * owner) has admitted nothing and may well succeed on a resend, so it must keep
 * the generic hint.
 *
 * A 422 that ALREADY carries a code yields to it, and this is not a nicety: the
 * leading-slash policy has no code on the wire (its `detail` is a plain string;
 * see `LEADING_SLASH_CODE`), so a coded 422 is by construction a DIFFERENT,
 * specific refusal the transport has already classified - an unknown command, an
 * invalid cwd. Letting this general rule overwrite that swapped a precise
 * diagnosis for a vague one that described a request we had not sent (round 5,
 * R13). The two conditions are complementary: the stage gate at the call site
 * says the message request failed, and this says the policy is the reason.
 *
 * The caller must still establish that the failing request WAS the message
 * request - `sessions.create` shares that try and its 422 never carried this
 * text anywhere. See the `inFlight` gate in `admitChatDraft`.
 */
export function isLeadingSlashRefusal(error: unknown, text: string): boolean {
	return (
		error instanceof DesktopControlError &&
		error.status === 422 &&
		error.code === undefined &&
		text.trimStart().startsWith("/")
	);
}

/**
 * A send refused because an attachment it was carrying could not be read.
 *
 * The refusal itself is the renderer's own (`unreadableAttachmentRefusal`), and
 * the sentence carries its own remedy, so what this code is FOR is the two
 * decisions that must not be made from the copy: the composer withholds its
 * generic "Send it again" hint for it (see `withholdsRetryHint`), and a code is
 * how that survives a rewording.
 *
 * A code rather than a fact about the message for one more reason, and it is a
 * defect this round measured (design round 4, D13): `chat-page` reads
 * `activeError = sendError || draft.error` and
 * `activeErrorCode = sendErrorCode ?? draft.errorCode`, so a refusal that leaves
 * the code UNSET here inherits whatever code the draft was last left holding -
 * an earlier leading-slash refusal, say - and the same sentence then renders
 * with the hint in one session and without it in another. Setting the code at
 * the refusal makes the alert's hint a function of the refusal instead of a
 * function of the conversation's history.
 */
export const UNREADABLE_ATTACHMENT_CODE = "attachment_read_failed";

/**
 * A send refused because the backend could not write its store: the disk is
 * full.
 *
 * WHY ONE `sqlite3.Error` HAD TO BECOME THREE ANSWERS. The backend's desktop
 * routes caught the BASE class - `sqlite3.Error` - and mapped every member of it
 * to one 503 reading "Read state is busy right now. It will catch up on its
 * own.", so lock contention, an unopenable database, a corrupted one and a full
 * volume were a single branch, and the sentence described the only one of them
 * that is transient. On 2026-09-17 this machine's boot volume hit 0 bytes free
 * at 09:56; SQLite could not allocate its journal or WAL, and a send carrying an
 * IMAGE was refused with that sentence plus this composer's own generic hint,
 * "Your message is still in the composer. Send it again." - the one action that
 * cannot help on a full disk, and the one the operator repeated. The image is
 * what crossed the threshold first because it is by far the largest write in the
 * flow: attachment bytes plus a much bigger transcript append, while a few-KB
 * text send still landed. It went away when disk space came back, which is the
 * correlation the report describes.
 *
 * A code rather than a reading of the copy, for the same reason as its siblings
 * above: the sentence is expected to be reworded, and matching prose would
 * silently stop matching. What the code decides is the one thing the copy cannot
 * carry - whether the composer's generic retry hint is TRUE.
 *
 * The SENTENCE is the BACKEND's, rendered verbatim from the error body's
 * `message` field (`desktopResult` reads `detail.code`/`detail.message` for any
 * status). Naming the volume and the remedy is a fact about the machine that only
 * the process which touched the store has, so authoring a second copy here would
 * be a second place for it to drift from the one the user is shown. The renderer
 * half of the fix is that this code SURVIVES to the alert - it is what
 * `withholdsRetryHint` below reads - and that the sentence is not replaced by a
 * generic one on the way (pinned in `scripts/canonical-chat.test.mjs`).
 *
 * The notice does NOT retire on a timer, and that is deliberate: the read
 * window's notice can, because the window it names closes on an observable
 * condition, while a full disk does not heal itself. It clears when the
 * refusal's remedy actually happened - the next send that lands (`finishDraft`)
 * - or when the user edits the draft, as every other send refusal does.
 */
export const STORE_OUT_OF_SPACE_CODE = "store_out_of_space";

/**
 * A send refused because the backend's store could not be read or written at all
 * - unopenable, corrupted, "file is not a database" - which is every
 * `sqlite3.Error` that is not contention and not a full volume.
 *
 * The remedy is NOT a retry: the same store is in the same state on the next
 * attempt, so resending the same bytes is refused for the same reason, and the
 * hint the composer would otherwise render under this sentence would be the
 * incident's own false instruction in a different costume. The sentence the user
 * reads says so and points at the machine; a code is what withholds the hint
 * that contradicts it.
 *
 * `store_busy` - the third arm, genuine lock contention - deliberately has no
 * constant in this file: it keeps the backend's existing sentence AND the
 * composer's retry hint, because there a retry is exactly the right advice. The
 * split exists so that "send it again" becomes true-for-contention and
 * false-for-a-failed-store, so nothing in the renderer changes for it.
 */
export const STORE_UNAVAILABLE_CODE = "store_unavailable";

/**
 * Whether this refusal is the STORE's own verdict on the write - the two arms
 * that are not contention.
 *
 * ONE PREDICATE FOR ONE FACT, with two consumers, because the two of them must
 * not disagree about it on one screen. The fact is what a store failure KNOWS
 * that the other refusals do not: the write did not happen. Every other refusal
 * in this list is silent about the request's fate - the transport may have lost
 * the response, the owner may have admitted it - which is why their shared held
 * claim says the outcome is "not knowable" and conditions the retry on a reply
 * arriving.
 *
 * For these two codes that sentence is simply wrong, and it is wrong in the
 * incident's own direction: it tells the operator to wait for a reply that the
 * failed write makes impossible while the transcript above shows their message
 * painted (UX round 1, U4). So the composer reads this predicate for the two
 * places the difference lands:
 *
 *   - the held line states the known fact instead of the unknowable-outcome
 *     sentence (see the alert's `storeWriteRefused` branch);
 *   - the generic retry hint is withheld, by `withholdsRetryHint` below, which
 *     is a SEPARATE question - "is the retry the remedy" - and is kept separate
 *     here: one predicate per fact, so a code can be added to either list for
 *     its own reason without silently answering the other question.
 *
 * `store_busy` is deliberately NOT a member: contention is a refusal whose
 * outcome really is unknowable, and it keeps the shared held sentence for the
 * same reason it keeps the retry hint.
 */
export function isStoreWriteRefusal(code: string | undefined): boolean {
	return code === STORE_OUT_OF_SPACE_CODE || code === STORE_UNAVAILABLE_CODE;
}

/**
 * The composer's code for an option press that did not reach the owner.
 *
 * WHY THE PRESS NEEDS A CODE AT ALL, and why it is not the transport's. An
 * option press reports through the same alert as a typed send, and that alert
 * reads `activeErrorCode = sendErrorCode ?? draft.errorCode` — so a report that
 * leaves the code unset inherits whatever failure the DRAFT was last left
 * holding (design round 4, D13, which measured the inheritance on the attachment
 * refusal). Two things then go wrong on the same screen: a stale
 * `unresolved_attachment` code puts that remedy's own buttons under a sentence
 * about an option press, and a stale code for which the retry hint is WITHHELD
 * leaves the sentence bare while the same sentence renders with the hint in
 * another session.
 *
 * It is a code of its own rather than `undefined` even though the press that
 * carries it has already failed, because the questions the composer asks of a
 * code are exactly the two that must not be answered by history: is the retry
 * the remedy (it is not — the question this press named is gone, and there is
 * nothing to press again; see `withholdsRetryHint`), and which remedies belong
 * under this sentence (none of the draft's).
 */
export const ANSWER_NOT_SENT_CODE = "answer_not_sent";

/**
 * A refused ASIDE whose question is no longer anywhere the composer can see.
 *
 * The sixth term in `withholdsRetryHint`, and the first of the two that is not a
 * send refusal: an aside ask empties the box at the press (the question left for the
 * panel), the owner refuses it, and the box at that moment holds whatever the user
 * typed SINCE. The composer's generic hint then appended "Your message is still in
 * the composer. Send it again." to a sentence about a question that is neither in
 * the box nor on screen (UX round 1, U4) - advice that is not merely redundant but
 * false, and which would have the user resend a NEW question to an exchange that
 * refused the old one.
 *
 * It is a code of its own rather than a pre-computed boolean because the composer
 * asks exactly one question of a code (is the retry the remedy; see
 * `withholdsRetryHint`), and the answer has to travel with the sentence that
 * raised it - the same argument `ANSWER_NOT_SENT_CODE` records one round earlier.
 * The refusing door sets it; the panel does not (a refusal on the panel is stated
 * on the turn beside its own question, and the sentence there is the owner's).
 */
export const ASIDE_NOT_ANSWERED_CODE = "aside_not_answered";

/**
 * A FOLLOW-UP REFUSED IN THE APP because the aside is still answering.
 *
 * The seventh term in `withholdsRetryHint`, and the only term there whose remedy IS
 * the retry - just not yet. The composer's own gate on this refusal sets it (see
 * `asideAskBlockedReason`), and without it the alert appended its generic "Your
 * message is still in the composer. Send it again." directly under a sentence
 * telling the user to wait, so one line carried two contradictory instructions
 * (UX round 2, U12; agent review round 5, R5-5; design round 3, D13). The retry is
 * refused for as long as the newest answer is in flight, which is exactly the
 * condition the sentence beside it names - so the sentence owns the timing and the
 * hint has nothing to add. That is a different reason from `ASIDE_NOT_ANSWERED_CODE`
 * one block up, which is withheld because the question has LEFT THE SCREEN: an
 * aside whose answer is still coming has not failed, and borrowing that code would
 * have made the two refusals one thing in the only place that reads them.
 *
 * The line is also retired with the state it describes rather than left standing
 * (`chat-page.tsx`, the effect keyed on the same predicate): a composer line that
 * reads "still answering" under a settled answer is U12's other half.
 */
export const ASIDE_STILL_ANSWERING_CODE = "aside_still_answering";

/**
 * Whether pressing Retry could possibly work for a refusal.
 *
 * The notice row offers `Retry` and `Clear`, and this decides whether the first
 * of those renders at all. A remedy the app will refuse again the instant it is
 * pressed is worse than no remedy: the operator's own case on 2026-09-17 - drop
 * the image that pushed the write over the threshold - was measured as an
 * instruction/refusal loop, 11 presses and 11 identical refusals (UX round 1,
 * U2).
 *
 * FIVE refusals cannot be answered by pressing again, each for its own reason.
 * The leading-slash policy refuses THIS TEXT forever; an attachment that cannot
 * be read is still unreadable on the next attempt, because the same chip is
 * still attached; a store that is out of space or unreadable is in the same
 * state on the next attempt too. The fifth is not a send refusal at all: an
 * option press that failed carries `ANSWER_NOT_SENT_CODE`, where there is no
 * text to send and the question it answered has moved on, so a Retry would name
 * a box that has nothing to do with the failure. It is in this list rather than
 * in a second one because this predicate answers one question (is Retry the
 * remedy) and that is the answer the failure owns.
 *
 * TWO OF THE THREE TERMS THIS PREDICATE USED TO CARRY ARE STILL GONE, and one came
 * back, because the sentence is the whole argument and one of them was misread.
 *
 * The retiring owner (`runtime_retiring`) has a sentence of its own that tells the user
 * to try again - "Try again in a moment" - so a press is exactly what it invites, and a
 * Retry beside an invitation to press is one instruction, not two. The third is the
 * unchanged-payload guard's code, which no longer exists: an edited resend is a NEW
 * message under a new request id and is never refused (see `admitChatDraft`).
 *
 * THE READ WINDOW IS BACK IN THE LIST (design round 11, D2), because the round that
 * dropped it read its sentence as an invitation and it is not one: "This chat isn't
 * ready yet, so your message wasn't sent." pairs with a window that answers `"failed"`
 * the moment it is asked, so a press re-refuses and re-paints the same sentence - the
 * loop this term exists to prevent, not a second instruction. Main withheld the press
 * here for exactly that reason and the reason survived the fold intact.
 *
 * `ASIDE_NOT_ANSWERED_CODE` IS THE SIXTH TERM, and it is the second here that is
 * not a send refusal either — in the same direction as `ANSWER_NOT_SENT_CODE`, and for a
 * sharper reason: an aside ask takes the question out of the box at the press, so
 * when its refusal lands the box holds whatever the user typed SINCE, and the hint
 * would point at text the refusal was never about (UX round 1, U4). Its own
 * statement is on the constant.
 *
 * `ASIDE_STILL_ANSWERING_CODE` IS THE SEVENTH, and it is the only term here whose
 * remedy IS the retry — it is merely not yet. The press it refuses is refused for
 * as long as the newest aside answer is in flight, and the sentence that replaces
 * the hint is the one that says when that ends, so the hint can only contradict it
 * (UX round 2, U12; agent review round 5, R5-5; design round 3, D13). Every other
 * term above is a refusal a resend does not fix; this one is a refusal that a
 * resend fixes LATER, and both are cases where "Send it again" is not what to do
 * now. Its own statement is on the constant.
 *
 * `runtime_busy` IS THE EIGHTH TERM (design round 1 on the answers route, D5), and
 * it arrives here for the press rather than for the send. On the SEND path the
 * refusal's own arm keeps its press - `sendFailureCopy`'s busy branch answers
 * `retry: true` literally, because there the control is the message in the box -
 * and this predicate is not consulted. On the ANSWER path the composer's only
 * retry control is Send over whatever the box holds, which is not the question
 * the press was about: the retry an option press may have is the option itself,
 * or the app's own bounded repeat `withBusyResends` has already spent. The old
 * note here argued the opposite ("the owner's own sentence asks for the press"),
 * and that argument was a reading of the backend sentence this change removes -
 * "Retrying is safe" is gone from the wire.
 *
 * One function rather than call-site comparisons, so the composer reads the rule
 * instead of listing the codes, and so `scripts/canonical-chat.test.mjs` can
 * execute it against the store that raises them.
 */
export function withholdsRetryHint(code: string | undefined): boolean {
	return (
		code === LEADING_SLASH_CODE ||
		code === UNREADABLE_ATTACHMENT_CODE ||
		code === STORE_OUT_OF_SPACE_CODE ||
		code === STORE_UNAVAILABLE_CODE ||
		code === ANSWER_NOT_SENT_CODE ||
		code === ASIDE_NOT_ANSWERED_CODE ||
		code === ASIDE_STILL_ANSWERING_CODE ||
		/*
		 * Appended rather than slotted in, so the two ordinals the aside constants state
		 * about themselves ("the sixth term", "the seventh") stay true.
		 */
		code === SESSION_UNVALIDATED_CODE ||
		/*
		 * Appended for the same reason: the eighth, and the one this predicate is
		 * consulted for only when the failure is a press (see the note above).
		 */
		code === RUNTIME_BUSY_CODE
	);
}

/**
 * Which of the three outcome classes a failed send belongs to.
 *
 * The distinction the composer acts on: whether the message provably never
 * reached the session ("not sent"), whether the app cannot say ("unknown"), or
 * whether the conversation it addressed is gone ("gone"). Only "unknown" keeps
 * the request id and the pinned payload for an idempotent replay; only "not
 * sent" and "gone" can be retried as a fresh message without any risk of two
 * rows.
 */
export type SendFailureClass = "not_sent" | "unknown" | "gone";

/**
 * A 409 the daemon answered with a sentence and no code.
 *
 * Both arms the route produces this way are refusals the app can act on or wait
 * out; which one it is, is decided by `sendFailureClass`'s caller-supplied fact
 * rather than by the text.
 */
function isCodelessConflict(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		error.status === 409 &&
		sendFailureCode(error) === undefined
	);
}

export function sendFailureClass(
	error: unknown,
	/**
	 * Whether an EARLIER attempt under this message's request id could have been
	 * admitted (`ChatDraft.admissionAttempted`). It is what tells the two 409s the
	 * daemon answers without a code apart - see `isCodelessConflict`.
	 */
	priorAttemptUnresolved = false,
): SendFailureClass {
	if (isRefusedBeforeAdmission(error)) return "not_sent";
	/*
	 * THE CODELESS 409, SPLIT IN TWO BY ONE FACT THE STORE ALREADY HOLDS.
	 *
	 * The daemon answers two quite different things with `409` and no code: a
	 * RECEIPT CONFLICT (this request id already has a receipt, so the attempt under
	 * it may well have been admitted - an unknown outcome, and the app must not
	 * pretend to know) and a REFUSAL OF THE BODY, which is what the sender-side
	 * budget ladder raises when the text has eaten the frame's room for its images
	 * (`attach_client.py`'s `OversizedRequest`, a `ValueError`, answered by the
	 * route's `raise HTTPException(409, str(error))`).
	 *
	 * QA proved the arm reachable in one step and the defect real (round 2, Q2-1):
	 * two ~3.4 MB images plus 199,000 characters, and the composer showed "Couldn't
	 * confirm your message was sent. Sending it again is safe." with Retry over a
	 * refusal the daemon had just explained - and the press re-posted the identical
	 * body for ever, which is the one thing this design exists to stop.
	 *
	 * The fact that separates them is not in the sentence and must not be read out
	 * of it (matching prose is how a rule stops matching): a receipt conflict can
	 * only exist for an id the journal has SEEN, and the store knows whether it has
	 * ever left an attempt under this id unresolved. No earlier attempt - or one the
	 * daemon answered with a stated refusal, which is what `admissionAttempted`
	 * being false means - and the only thing a 409 can be is a refusal of this body,
	 * decided before any receipt existed. That reading also cannot loop: the refusal
	 * offers no press, so the same bytes cannot be re-posted by a control.
	 */
	if (isCodelessConflict(error) && !priorAttemptUnresolved) return "not_sent";
	/*
	 * A 404 is its own class rather than a refusal: the conversation the message
	 * was addressed to does not exist, so the content is worth keeping and copying
	 * but the press cannot be repeated against it.
	 */
	if (error instanceof DesktopControlError && error.status === 404)
		return "gone";
	return "unknown";
}

/**
 * The code a caught send failure carries, if it carries one.
 *
 * The two typed readers first, then the GENERIC one, because a code is not only
 * raised by this app's own error classes: `unresolved_attachment` arrives as a
 * plain `Error` with a `code` property, and the send path has always read it that
 * way. Narrowing this to the typed classes silently dropped that code - and with
 * it the composer's decision to withhold a Retry it cannot honour - so the
 * fallback is load-bearing rather than defensive.
 */
export function sendFailureCode(error: unknown): string | undefined {
	if (error instanceof DesktopControlError) return error.code;
	if (error instanceof UserFacingError) return error.code;
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string") return code;
	}
	return undefined;
}

/**
 * The sentences this app writes for a failed send.
 *
 * ONE TABLE, so a reviewer reads the copy in one place and a test can snapshot
 * it (see `sendFailureCopy`). Each says what happened and what to do about it,
 * in that order (`docs/branding.md` § 8), and none of them uses the app's own
 * vocabulary for the send machinery: no "held", no "admission", no "owner",
 * no "request". The user's mental model is a message that did or did not leave.
 */
export const SEND_FAILURE_COPY = {
	/**
	 * Unknown outcome, the default arm.
	 *
	 * TWO CLAUSES, and the second is the UX round's finding (U7): the timeout arm
	 * told the user what the app could not establish and left them to guess whether
	 * a press was safe. It is - the same request id replays, and the owner's receipt
	 * de-duplicates it - so the sentence says so rather than leaving the safest
	 * action unstated.
	 */
	unconfirmed:
		"Couldn't confirm your message was sent. Sending it again is safe.",
	/** Unknown, and the specific fact is that nothing answered. */
	unreachable:
		"Couldn't reach Local Operator. Your message may not have been sent.",
	/** The owner took the request and is not free yet. */
	busy: "The agent is busy, so your message wasn't sent.",
	/*
	 * THE TWO ASIDE REFUSALS (fold of `origin/main` = `f9d92ac1e`, #482). The aside panel's own
	 * semantics are that PR's and are re-stated here rather than re-spelled: the sentence is the
	 * one `asideAskFailure` composes for a refused ask, and the second is `ASIDE_ASK_BUSY`
	 * verbatim, because the two surfaces that state these facts - the panel and, when it is gone,
	 * this composer - must not read as two different facts. What each row carries is the control:
	 * neither offers Retry, and the classifier says why for both (`withholdsRetryHint`).
	 */
	asideNotAnswered: "The aside was not answered.",
	asideStillAnswering:
		"The aside is still answering. Press Enter again once the answer is in.",
	/** The owner is leaving; its own advice is to come back in a moment. */
	retiring:
		"Local Operator is restarting, so your message wasn't sent. Try again in a moment.",
	/** The read window's refusal: the app has not confirmed the chat yet. */
	notReady: "This chat isn't ready yet, so your message wasn't sent.",
	/** 422 with no code the app can act on. */
	generic: "Your message wasn't sent.",
	/** 404: the conversation is gone, so only the content is salvageable. */
	gone: "This conversation no longer exists, so your message wasn't sent.",
	/**
	 * The send lock (A1/A2). A muted statement of fact rather than a failure: the
	 * text is still in the box because the press never became a send.
	 */
	sendLock: "Your last message is still sending.",
	/**
	 * The queued press (task-17, U1/U2). A press made while the conversation's
	 * read window is still open - the pane is loading its first page, or is
	 * reconnecting with no page yet - is not refused: it is HELD and delivered
	 * the moment the pane's first snapshot lands. This is the sentence that
	 * makes the wait visible; without it the press had no answer at all until
	 * the delivery (or until the stream gave up), which is the silence the UX
	 * round measured as "sending blocked". Muted, like `sendLock`: nothing
	 * failed, the message is with the app, and the delivery takes care of
	 * itself - so it takes no controls and no error register.
	 */
	queuedSend: "Your message will send as soon as the conversation is ready.",
	/** The same lock, with the question that explains it on screen. */
	gateLock: "Answer the question above first.",
	/*
	 * THE PLAIN SENTENCE IS BACK, WITH A CALLER THIS TIME (design round 9, D17). It
	 * was removed in round 4 (n2) because the `overlap` arm had stopped using it and
	 * its only remaining reader was a story rendering a state the app no longer
	 * produces. The `delivered` arm introduced by D17 is the caller it was missing:
	 * that arm is raised where the delivered text is unknown and the box has not been
	 * read, so it needs a sentence that is true whatever the box holds - which is
	 * exactly what this one was written to be. It is shorter than either
	 * box-describing sentence at every width, so no captured frame is invalidated.
	 */
	lateDelivery: "Your earlier message was delivered.",
	/*
	 * AND THE ONE THAT NAMES WHAT IS IN THE BOX (review round 2, D4). Where the
	 * delivered message HAS come out
	 * of the box (`draft-only`), the user is looking at their own unsent line under a
	 * sentence about a different message, and saying so is the difference between
	 * "the app lost my draft" and "the app kept it": measured in round 1 as the
	 * auto-clear that looked like the app losing the text (Q-4).
	 */
	lateDeliveryDraft:
		"Your earlier message was delivered. What's here now hasn't been sent.",
	/*
	 * AND THE ARM WHERE THE DELIVERED WORDS ARE STILL IN THE BOX (review round 3,
	 * D8). The prefix test cannot remove them - the user edited inside them, so no
	 * boundary between their words and the message's is knowable - and the plain
	 * sentence above says nothing about the box, so a user whose next Send carries
	 * the sentence they already sent gets no warning that it will. Their files do
	 * not travel again (the chips come out by identity), which is exactly why the
	 * copy has to carry the rest: this is the one duplicate the app cannot prevent,
	 * so it names it.
	 */
	lateDeliveryOverlap:
		"Your earlier message was delivered. Its words are still in the box, so sending again would repeat them.",
} as const;

/**
 * The sentence and register for a press the app cannot take yet, from the one
 * table: `gateLock` when the run is visibly waiting on a question, `sendLock`
 * otherwise.
 *
 * A function rather than two literals because two callers answer the same press -
 * the composer, which can see that a flight is open, and the pane, which refuses
 * one that reaches it anyway - and UX round 3 (U6) is what the drift costs: a
 * press that produced nothing on screen, which is what makes a user press again
 * over a box that by then holds both messages.
 */
export function pressLockCopy(
	/*
	 * The frontend's own field, typed from its own state so a caller cannot hand
	 * this a truthiness the pane would read differently: both the pane's two
	 * refusals and the composer's press answer from this one value.
	 */
	pendingGate: CanonicalFrontendState["pending_gate"] | undefined,
): string {
	return pendingGate ? SEND_FAILURE_COPY.gateLock : SEND_FAILURE_COPY.sendLock;
}

export const RETRY_LABEL = "Retry";
export const CLEAR_LABEL = "Clear";

/**
 * One sentence and at most two actions, for one failed send.
 *
 * `message` is only ever overridden where the sentence belongs to somebody else
 * and is already right: the backend's own refusal text (a disk that is full names
 * the volume it is full on), a pairing sentence, the budget refusal raised in the
 * composer with the sizes in it, or the unreadable-attachment refusal that names
 * the file. Those keep their words and are given this app's CONTROL SET rather
 * than rewritten - the fix this table exists for is the notice's shape and the
 * block on different messages, not the provenance of one honest sentence.
 *
 * `retry` is whether pressing Retry can work. It is false for every arm whose
 * message cannot leave as it stands (a slash-prefixed draft, a file that cannot
 * be read, a store that will not take the write) and for every arm the press
 * cannot reach again (a conversation that is gone, a pairing state, a payload
 * too large for the wire). It is true for the unknown class, where the same id
 * replays, and for the three not-sent arms whose own new sentence tells the user
 * to try again.
 *
 * AND A RETRY REBUILDS ITS PAYLOAD FROM THE BOX (QA round 3, Q3-1). After a
 * failure whose returned message was merged in front of the user's own line, the
 * press carries both lines - one message, one request id, one row, and the
 * delivered words come out of the box once the delivery is known, so this is not
 * the duplicate the change exists to remove. It is worth knowing all the same:
 * the retry is "send what the box holds", not "send what failed", which is
 * exactly why the box's contents are the user's to edit before they press it.
 */
export function sendFailureCopy(
	error: unknown,
	/**
	 * The code to classify by, when the caller has already reclassified the
	 * failure. `admitChatDraft` does exactly that for a leading-slash 422 - the
	 * transport's own code says "invalid fields", this app's says "the slash is
	 * the problem" - and it is the same code the row records, so the sentence and
	 * the code a composer branches on can never disagree (see the store's catch).
	 */
	codeOverride?: string,
	/**
	 * See `sendFailureClass`: whether an earlier attempt under this request id could
	 * have been admitted. Defaulted, so every existing caller - including the pane's
	 * own classification of a failure it caught - answers as it always did.
	 */
	priorAttemptUnresolved = false,
): {
	message: string;
	retry: boolean;
	code?: string;
} {
	const klass = sendFailureClass(error, priorAttemptUnresolved);
	const code = codeOverride ?? sendFailureCode(error);
	const fallback = userFacingMessage(error, SEND_FAILURE_COPY.generic);
	if (klass === "gone")
		return { message: SEND_FAILURE_COPY.gone, retry: false, code };
	if (klass === "not_sent") {
		if (code === RUNTIME_BUSY_CODE)
			return { message: SEND_FAILURE_COPY.busy, retry: true, code };
		if (code === RUNTIME_RETIRING_CODE)
			return { message: SEND_FAILURE_COPY.retiring, retry: true, code };
		if (code === SESSION_UNVALIDATED_CODE)
			/*
			 * `retry` is asked of the predicate rather than written as a literal: the read
			 * window is withheld there (design round 11, D2), and a second copy of that
			 * answer here is the same defect the notice had - one failure, two verdicts.
			 */
			return {
				message: SEND_FAILURE_COPY.notReady,
				retry: !withholdsRetryHint(code),
				code,
			};
		if (code === ASIDE_NOT_ANSWERED_CODE)
			return {
				message: SEND_FAILURE_COPY.asideNotAnswered,
				retry: false,
				code,
			};
		if (code === ASIDE_STILL_ANSWERING_CODE)
			return {
				message: SEND_FAILURE_COPY.asideStillAnswering,
				retry: false,
				code,
			};
		if (code === LEADING_SLASH_CODE)
			return { message: LEADING_SLASH_MESSAGE, retry: false, code };
		/*
		 * Everything else keeps the sentence the refusal itself carries: the
		 * unreadable attachment names the file, the budget refusal carries the
		 * sizes, a store refusal names the volume, and the transport's own 413/422
		 * text names the request it refused. Those sentences are already the ones
		 * this app wants, and rewriting them would only move copy away from the
		 * fact it describes.
		 */
		return { message: fallback, retry: false, code };
	}
	if (code === DESKTOP_REFUSAL_CODE.transportFailed)
		return { message: SEND_FAILURE_COPY.unreachable, retry: true, code };
	if (isDesktopRefusalCode(code))
		return { message: DESKTOP_REFUSAL_SENTENCE[code], retry: false, code };
	/*
	 * THE TRANSPORT'S DEADLINE IS THE ARM THE OPERATOR REPORTED, and this is the
	 * line that answers it. Its sentence (`desktop-contract.ts`, "The app waits up
	 * to 20 seconds for this request, and it was still running when the app stopped
	 * waiting. It may or may not have reached the server; check the result before
	 * repeating it.") is prose about the APP's patience, addressed to nobody: it was
	 * the long red sentence sitting over an empty composer. The composer says what
	 * happened to the user's message instead, and the deadline keeps its own wording
	 * for every other operation that reaches it.
	 */
	if (code === DESKTOP_DEADLINE_EXCEEDED_CODE)
		return {
			message: SEND_FAILURE_COPY.unconfirmed,
			retry: !withholdsRetryHint(code),
			code,
		};
	/*
	 * THE DAEMON'S OWN HOP FAILURE IS AN UNKNOWN OUTCOME, AND THE TABLE SAYS SO
	 * (review round 1, M8/U4/Q-3). `runtime_unreachable` is the daemon reporting
	 * that it could not establish whether the request reached the owner - the
	 * contract's own words for it, and why it is not a refusal - which is the
	 * unknown class exactly. Relaying its body instead put the machinery on screen:
	 * "Session owner is unavailable. Reconnect and reconcile before retrying." is
	 * two sentences, names the owner and a reconcile the user cannot run, and is the
	 * kind of sentence the table exists to replace. The press is offered because a
	 * same-id resend is safe (`withholdsRetryHint` is false for it), which is what the
	 * sentence's second clause promises.
	 */
	if (code === DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable)
		return { message: SEND_FAILURE_COPY.unconfirmed, retry: true, code };
	/*
	 * A CODE WITH NO SENTENCE OF THIS APP'S OWN: the backend named its own reason
	 * (`store_busy` - "Read state is busy right now. It will catch up on its own."),
	 * so its sentence is kept. Replacing it with a vaguer one of this app's would
	 * drop the only fact the user has to act on, and the code is what makes this
	 * distinguishable from a bare throw, whose text is a leaked exception.
	 */
	if (code)
		return { message: fallback, retry: !withholdsRetryHint(code), code };
	/*
	 * And the last arm: a failure with no code at all - a raw throw, or a response
	 * that never arrived. There is nothing to quote, so the app states what it knows.
	 */
	return {
		message: SEND_FAILURE_COPY.unconfirmed,
		retry: !withholdsRetryHint(code),
		code,
	};
}

/**
 * The one place a composer value becomes a send PAYLOAD.
 *
 * The unchanged-payload guard compares byte-for-byte, because a retry of a
 * request that may already be executing has to be an idempotent replay. The
 * composer meanwhile has to decide what to SAY about that guard - whether the
 * held message is on screen, whether Restore is worth offering, whether the
 * abandon control would destroy typed text. Those were two comparisons over two
 * different strings (`===` in the guard, `.trim() ===` in the composer), and a
 * whitespace-only edit fell into the gap between them: the guard refused the
 * send while the composer believed the box already held the payload, so it
 * suppressed BOTH escapes and left only the control that empties the box.
 * Trailing space, leading space and a trailing newline all reproduced it -
 * including the trailing-newline case the trim was originally written for.
 *
 * So the trim moves to the payload boundary instead of living in the copy
 * logic. Every send normalizes here, every stored `submittedText` is therefore
 * already normalized, and the composer compares normalized against normalized.
 * The guard and the copy cannot disagree about what "the same message" means,
 * because there is now only one string. Whitespace at the ends is not content
 * the owner needs preserved; the interior is untouched.
 */
export function normalizeSendText(text: string): string {
	return text.trim();
}

/**
 * The composer's whole value - reply markup included - as the ONE payload
 * string.
 *
 * `normalizeSendText` closed the gap between the guard and the copy for the
 * bare box, but the reply prefix was assembled downstream of every comparison
 * the composer makes: the box held `text` while the store stored and guarded
 * `<reply-to>…</reply-to>\n<text>`. Two strings for one payload again, and this
 * time the second one deadlocked the escape built to answer the first. Restore
 * writes the held payload back, the next send re-prefixes it into
 * `<reply-to>…</reply-to>\n<reply-to>…</reply-to>\n<text>`, the guard refuses
 * the mismatch, and the composer - now seeing its own held text in the box -
 * withdraws Restore and says "Send it again", which is false and stays false.
 *
 * So assembly lives at the boundary, above the guard rather than beside the
 * send call. The composer builds its comparison basis from the same function
 * with the same replies, so `heldInBox` asks the question the store answers.
 * Replies survive a failed send (`clearReplies` runs only once a send is
 * accepted), so the basis is stable across every retry of one claim.
 *
 * NOT idempotent over its own output, and deliberately so: the markup is
 * generated from the reply LIST, so feeding a payload back in with the same
 * list prefixes it twice. That is the invariant Restore has to honour - it
 * hands back a finished payload, so it clears the chips whose content that
 * payload already carries, leaving assembly here a no-op on the next send.
 * Normalizing after the join rather than before keeps one definition of
 * "empty" for a box whose only content is a reply.
 */
export function buildSendPayload(
	text: string,
	replies: readonly { text: string }[],
): string {
	if (replies.length === 0) return normalizeSendText(text);
	const replyContent = replies
		.map((reply) => `<reply-to>${reply.text}</reply-to>`)
		.join("\n");
	return normalizeSendText(`${replyContent}\n${text}`);
}

/**
 * Whether a draft row is the one a given conversation's send wrote.
 *
 * THREE SPELLINGS, because a conversation's draft is keyed three ways across one
 * send's life: `draft:<uuid>` before it is admitted, `<sessionId>` after the flip,
 * and `send:<sessionId>` for a conversation that was never a draft at all
 * (`draftIdentityFor`'s fallback). The `sessionId` FIELD is written only on the
 * create path - the existing-session path patches whatever row it was handed - so
 * a lookup that trusts the field alone misses the very case the held-claim
 * reconcile exists for. Measured on the driver's first after-run: the claim
 * stayed held through a live reconnect because the draft the send wrote was keyed
 * `send:<id>` and carried no `sessionId` at all.
 */
function draftBelongsToSession(draft: ChatDraft, sessionId: string): boolean {
	return (
		draft.sessionId === sessionId ||
		draft.key === sessionId ||
		draft.key === `send:${sessionId}`
	);
}

/**
 * Whether the page a held claim was adjudicated against REACHES back to the
 * claim — the half of the verdict `complete` cannot carry on its own.
 *
 * WHY IT EXISTS (issue #847). `complete` is the page's CONTINUITY
 * (`!cursor_missing`): the rows the read DID return are a continuous tail. It says
 * nothing about how far back the page goes, and a tail page is BOUNDED — so to a
 * continuity-only reader a delivered message older than that window is a message
 * the server does not have. Both pane callers (`use-canonical-session.ts`'s
 * reconnect tail read and its snapshot handler) passed `!cursor_missing` and got
 * exactly that: `undelivered` recorded for a message that had landed, repainted
 * at the tail on every mount. `draft-resolution.ts`'s sweep refuses the same
 * conclusion in its own words with `complete: false`; this is that rule stated
 * where the verdict is actually drawn, so every caller inherits it.
 *
 * THE COMPARISON. The page's oldest row must be at or before the claim's own
 * attempt time (`submittedAt`, stamped from the press's clock and persisted with
 * the claim), or the whole page is NEWER than the attempt and its silence proves
 * nothing about a message that would sit behind it. The page's oldest is
 * `entries[0]` — the wire's own order, which is also why the reducer reads
 * `entries[0]?.ts` as the page's `oldestSeconds`.
 *
 * EVERY DOUBT HOLDS THE CLAIM, and the asymmetry is the reason: a claim that
 * stays held is retry material the design already tolerates (the sidebar row, the
 * launch sweep and the manual clear are its other doors), while a wrong
 * `undelivered` states a falsehood on screen that nothing retracts. So this
 * answers `false` — no verdict — when the press anchor is missing (a claim
 * persisted before the field, or one whose press never stamped), when the page is
 * empty or its oldest row carries no usable stamp (nothing to compare), and when
 * the conversation is KNOWN to live on a peer: the anchor is this machine's clock
 * and the rows are the owner's, so a skew between the two could make a shallow
 * page look deep. An absent placement fact is not "remote" — absent means this
 * device, the reading every backend that has served one has.
 *
 * TWO SOURCES FOR "THIS CONVERSATION LIVES ELSEWHERE", and they are the pair
 * `remoteOwnedIds` reads for the same reason (agent review round 1's R1): the
 * `PlacementFact` a peers-inclusive page settled, AND the session row's own wire
 * `locality`. Reading only the fact is partial hardening: a claim on an EXISTING
 * remote conversation carries no `draft.peer`, and a plain listing never settles
 * a fact (the sidebar's poll deliberately asks for no peers), so the fact is
 * absent in exactly the window where the arm must hold. Absence of `locality` is
 * still "no claim", never "local" (`CanonicalSessionRow`) — but a row that
 * CARRIES `remote` holds the claim without waiting for the catalogue.
 */
function pageReachesClaim(
	entries: readonly HeldClaimPageEntry[],
	claim: ChatDraft,
	placement: PlacementFact | undefined,
	row: CanonicalSessionRow | undefined,
): boolean {
	if (
		claim.peer !== undefined ||
		placement?.locality === "remote" ||
		row?.locality === "remote"
	)
		return false;
	const submittedAt = claim.submittedAt;
	if (submittedAt === undefined || submittedAt <= 0) return false;
	/*
	 * The page's oldest row, in the claim's own unit: `ts` is epoch SECONDS on the
	 * wire and `submittedAt` is the press's `Date.now()`, so the multiplication is
	 * the whole of the conversion. A row without a usable stamp is the "cannot
	 * compare" case rather than an infinitely old page.
	 */
	const oldest = entries[0]?.ts;
	if (oldest === undefined || oldest <= 0) return false;
	return oldest * 1000 <= submittedAt;
}

export function draftIdentityFor(
	draftKey: string | null,
	sessionId: string | null | undefined,
): string | null {
	return draftKey ?? (sessionId ? `send:${sessionId}` : null);
}

/**
 * The draft ROW a pane's conversation actually lives on.
 *
 * WHY THE KEY ALONE IS NOT ENOUGH (UX round 2, U5): a staged draft KEEPS its
 * `draft:<uuid>` key for its whole life - the key is where the text, the claim
 * and the failure are written, and the create's answer patches only the row's
 * `sessionId` field - while `draftIdentityFor` answers
 * `activeDraftKey ?? send:<sessionId>`. The two disagree the moment a pane is
 * reached by the session's own route (the sidebar's row, a return after a
 * switch-away, a deep link): the derived key names a row nothing ever wrote, so
 * the pane renders no statement and no controls. Measured on the round-2 walk
 * and re-produced by `--scene conversation-start-away-failure`: a refusal up on
 * the row, a switch away and straight back, and the failure's whole line - the
 * sentence and both controls - gone while the row itself was still there.
 *
 * So the lookup resolves by BELONGING - the same predicate the resolution
 * writes through (`draftBelongsToSession`) - and only falls back to the derived
 * `send:<sessionId>` shape when no row owns the conversation, which is exactly
 * the live-send-that-never-staged-one case that fallback was for. Among several
 * owned rows the one CARRYING a row (a claim, a submission, a failure) wins; a
 * bare row with none of those has nothing to show anyway.
 */
export function paneDraftKey(
	draftKey: string | null,
	sessionId: string | null | undefined,
	drafts: Record<string, ChatDraft>,
): string | null {
	if (draftKey) return draftKey;
	if (!sessionId) return null;
	const owned = Object.entries(drafts).filter(([, draft]) =>
		draftBelongsToSession(draft, sessionId),
	);
	const carrying = owned.find(
		([, draft]) =>
			draft.submittedText !== undefined ||
			draft.undelivered !== undefined ||
			draft.error !== undefined ||
			draft.admissionAttempted === true ||
			draft.pending === true,
	);
	return (carrying ?? owned[0])?.[0] ?? `send:${sessionId}`;
}

/**
 * What React keys the chat panel on, and therefore what makes it remount.
 *
 * The precedence is `id ?? draftKey` and NOT the reverse, because the two name
 * the same conversation from either side of admission and the SESSION id is the
 * durable one: a pane keyed by the session is the pane the stream, the composer
 * and the echo registry all address, whether the reader reached it from the
 * sidebar or staged it as a draft.
 *
 * THE FLIP IS A REMOUNT, and that is load-bearing rather than incidental. A
 * draft learns its session id mid-send (the store patches it before the message
 * POST), so the key moves `draft:<uuid>` -> `<sessionId>` and the panel is
 * unmounted and mounted again at exactly the moment the user is waiting for the
 * message they just sent. The optimistic echo is therefore seeded into the NEW
 * panel's first frame (`seedPendingEchoes` in `use-canonical-session.ts`): the
 * delivery that follows arrives through a mount effect, one commit too late, and
 * that gap is the one that file documents at length.
 *
 * AN EARLIER REVISION OF THIS COMMENT CLAIMED THE FLIP WAS A NO-OP. It is not,
 * and the seeding above exists because of it: an answer that reads as "nothing
 * happens here" is how a reader concludes the echo registry has no draft-path
 * case to fix (review rounds 1 R6 and 2 R2-1, which is why the sentence is
 * stated rather than removed).
 *
 * The reverse direction remounts as well, and correctly: "New chat" stages a
 * draft with no session id, so `id` is undefined and the draft key wins. That IS
 * a different conversation and must not inherit the previous transcript.
 *
 * Extracted rather than inlined in the component for the same reason
 * `draftIdentityFor` was: the rule is then exercised by the store tests.
 */
export function panelIdentityFor(
	draftKey: string | null,
	sessionId: string | null | undefined,
): string | undefined {
	return sessionId ?? draftKey ?? undefined;
}

/**
 * The SESSION a chat view is showing, from the fields it derives that from.
 *
 * `chat-page.tsx` reads `draft?.sessionId` when a draft is staged and
 * `activeSessionId` otherwise - and the first term is not a detail: `stageDraft`
 * leaves `activeSessionId` at the session the reader was in, so a rule that read
 * only `activeSessionId` would answer with the OLD session id on both sides of a
 * New-chat pick. It is also the id the pane hands the panel (`sessionId={id}`),
 * so a second copy of this expression anywhere is a pane keyed on one session
 * while the panel under it reads another.
 *
 * Extracted beside `panelIdentityFor` for that rule's own reason: more than one
 * caller needs the same answer, and a rule that only exists inside one component
 * is a rule the others drift from.
 */
export function panelSessionIdOfView(
	activeDraftKey: string | null,
	draftSessionId: string | null | undefined,
	activeSessionId: string | null | undefined,
): string | undefined {
	return activeDraftKey
		? (draftSessionId ?? undefined)
		: (activeSessionId ?? undefined);
}

/**
 * The pane's own KEY - `panelIdentityFor` applied to the session id above.
 *
 * The pane keys its panel on this, which is what makes it the right answer to
 * "did the flow move the view": a surface that is not the pane (the command
 * palette's close-time restore, which yields when a pick moved the view) can ask
 * for it without keeping a second copy of the expression that computes it - and
 * a second copy is how the two sides of that comparison come to describe
 * different panes.
 */
export function panelIdentityOfView(
	activeDraftKey: string | null,
	draftSessionId: string | null | undefined,
	activeSessionId: string | null | undefined,
): string | undefined {
	return panelIdentityFor(
		activeDraftKey,
		panelSessionIdOfView(activeDraftKey, draftSessionId, activeSessionId),
	);
}

/**
 * Whether a send failed BEFORE the owner could have admitted anything.
 *
 * ONE definition, read by everything that has to act on the answer. Inside this
 * module it drives the `not_sent` class (`sendFailureClass` below, whose arm
 * decides the sentence and whether a press is offered) and the
 * `admissionAttempted` un-latch, which must not drift apart - they are two
 * answers to the same question. It is EXPORTED for the suites; no app surface
 * reads it directly, because since S4 the store's failure arm returns nothing
 * to the composer for a failure raised after the row was painted: the row is
 * the message's home (`Send again`, and the user's own `Edit` through
 * `returnPayload`), and the only payload that travels back to the box is the
 * user's deliberate one. A second copy of this predicate is how the two
 * consumers come to disagree about one failure.
 *
 * FOUR FAMILIES, and each is a refusal raised before the prompt can reach the
 * session, so the message provably does not exist on the owner.
 *
 * 1. 413 and 422, which are ours and are raised before `fetch` is even called
 *    (the reasoning is spelled out on the un-latch below).
 * 2. The read window's refusal, raised before the draft is touched.
 * 3. A `runtime_busy` 503 - the owner telling a control call to come back. The
 *    app already repeats that request under its own id (`messageWithBusyResend`),
 *    so this arm decides only what a send looks like once those repeats are
 *    spent, and the answer the owner gave is still "I did not take it".
 * 4. A `runtime_retiring` 409 - the owner is leaving (a build handover, a
 *    signalled stop, a `/move`) and refuses the turn as it latches. The
 *    sentence the far side composes for it says "The message was not admitted".
 *    INERT TODAY: that refusal arrives as a plain string `detail` with no
 *    `code`, so this term cannot fire until the backend half lands (see
 *    `RUNTIME_RETIRING_CODE` for the capture). It is kept because the answer is
 *    already right for the day the code arrives, and because dropping it would
 *    make that day a silent regression.
 *
 * WHAT MUST STAY ON THE OTHER SIDE, because the defect this class fixes has a
 * mirror image that is worse: treated as unknowable, a provably-unadmitted
 * refusal makes the app claim it cannot tell whether the message landed - and
 * treated as admitted-nothing, a genuinely-unknown outcome makes a message the
 * agent may be answering vanish and invites a duplicate send. So a bare 409
 * (receipt conflict, an attachment ladder arm), a bare 503, a `runtime_unreachable`
 * (the hop failure whose ack may have been the only thing lost), a transport
 * failure and the unchanged-payload guard all stay UNKNOWABLE, and are keyed on
 * the codes above rather than on a status or a `retryable` flag that other
 * refusals share.
 */
export function isRefusedBeforeAdmission(error: unknown): boolean {
	if (error instanceof DesktopControlError) {
		/*
		 * Ours, before `fetch`: 413 is the byte-budget guard in
		 * `src/main/desktop-transport.ts` and 422 is the `safeParse` ahead of it, so
		 * neither has a response to have been ambiguous about. 422 is also
		 * reachable from the backend (an unknown command, a malformed body) and
		 * still belongs here: a validation refusal is decided before the prompt is
		 * admitted, so no work started either way.
		 */
		if (error.status === 413 || error.status === 422) return true;
		/*
		 * The two codes the OWNER answers with, per the note above. Read as codes and
		 * not as a status or a flag: the same status carries refusals whose admission
		 * is genuinely unknown (a conflicting receipt's 409), and `retryable` is not a
		 * statement about admission in EITHER direction - the `runtime_busy` body the
		 * app does act on carries `retryable: true` while establishing that nothing was
		 * admitted, so it is neither a safe positive nor a safe negative
		 * (`RUNTIME_RETIRING_CODE` carries the captured bodies).
		 */
		return (
			error.code === RUNTIME_BUSY_CODE ||
			error.code === RUNTIME_RETIRING_CODE ||
			/*
			 * Decided in MAIN, before `fetch` is called at all: the request never
			 * left the machine, so a message the app hedged about was never sent
			 * anywhere. Keyed on the CODE rather than a status, because this
			 * ladder's other members (401/403 `pairing.refused`,
			 * `pairing.plane-closed`) do reach the daemon and say nothing about
			 * whether a message was admitted.
			 */
			error.code === DESKTOP_REFUSAL_CODE.noCredential ||
			/*
			 * The store-write refusals, whose own codes already state that the
			 * write did not happen - which is why the sentence beside them used to
			 * promise the payload was being kept for a retry it never needed.
			 */
			isStoreWriteRefusal(error.code)
		);
	}
	/*
	 * The read window's own refusal belongs in this answer, not beside it. It is
	 * raised before anything is written to the draft and before the transport is
	 * reached, so "nothing reached the owner" is exactly as true of it as of a
	 * 413 - and the composer reads this one predicate to decide whether the text
	 * goes back in the box (`false`) or the outcome is unknowable and the notice says
	 * so. A second copy of that judgement at the call site is how the
	 * two come to disagree about one refusal.
	 */
	/*
	 * And the two refusals that come from THIS side of the wire as
	 * `UserFacingError`s: the read window, which the store raises before the
	 * draft is touched, and a store-write refusal the app itself synthesised. A
	 * store write that did not happen is the same fact whichever class carries
	 * it, so it is read by the same predicate rather than by a second one.
	 */
	return (
		error instanceof UserFacingError &&
		(error.code === SESSION_UNVALIDATED_CODE ||
			error.code === UNREADABLE_ATTACHMENT_CODE ||
			isStoreWriteRefusal(error.code))
	);
}

/**
 * The composer identity a send for `key` was made under.
 *
 * The pane's own key (`panelIdentityFor`) and the composer's conversation id are
 * the same expression, which is why this is a call rather than a second rule: a
 * draft pane is keyed by its draft key until the session exists, and by the
 * session id after that.
 */
export function composerIdentityFor(
	key: string,
	sessionId: string | null | undefined,
): string {
	/*
	 * AND THE `send:` FORM NAMES ITS SESSION (review round 2, R1). A draft for an
	 * EXISTING conversation is keyed `send:<sessionId>` (`draftIdentityFor`), and
	 * the released app wrote no `sessionId` beside it - only the create branch did.
	 * Reading that key as a draft key left the id undefined, so this answered with
	 * the KEY itself, which is an identity no composer is ever keyed by: the
	 * released app's claim went to an orphan row, and the migration then cleared
	 * `submittedText`, so the message was unrecoverable and the notice's Retry
	 * pressed against an empty box.
	 */
	const named = key.startsWith("send:") ? key.slice("send:".length) : null;
	return (
		panelIdentityFor(
			key.startsWith("draft:") ? key : null,
			sessionId ?? named,
		) ?? key
	);
}

/**
 * Retire the COMPOSER's records for a send that has settled successfully, under
 * every identity the press touched.
 *
 * WHY THE PRE-SEND KEY IS IN THIS LIST, AND WHAT ITS ABSENCE COST (the
 * operator's report, 2026-09-26). The composer records what left it under the
 * identity the PANE carried at the press (`use-message-input`'s `clearOnce(true)`
 * -> `beginInFlight`), and on a staged draft that identity is the DRAFT KEY -
 * the create's answer re-keys the panel later, but the record was already
 * written. Settling only `composerIdentityFor(key, sessionId)` (the post-flip
 * identity) left the draft key's `inFlight` to survive every successful send:
 * nothing writes that key again, no pane reads it, and the store's own
 * reconciliation never touches it. At the next launch `rehydrateInputRows` folds
 * a persisted `inFlight` back into the composer (`foldReturn` -> `pendingText`),
 * which is right for a quit mid-flight and wrong here - the message HAD been
 * sent - and for a TEAM or AGENT draft the key is STABLE
 * (`draft:team:<name>`), so the next "New chat with <team>" found the old
 * message waiting in the box: "coming back to start a new chat with a team and
 * seeing the old message that I already sent populated in there".
 *
 * The failure arm already settles both identities (`admitChatDraft`'s catch, the
 * S4 boundary rule); this is the same rule for the arm that succeeds, plus the
 * move the failure arm performs. Anything the pre-send row still holds (text
 * typed during the create hop, a chip attached there) belongs to the conversation
 * that now exists, so it crosses with `returnInFlight` rather than being stranded
 * under a key no pane shows - and the message itself cannot ride that fold home,
 * because `settleInFlight` runs FIRST and clears the payload record that
 * `returnInFlight` would otherwise fold.
 */
function settleSendComposerRecords(key: string, sessionId: string): void {
	const input = useConversationInputStore.getState();
	const to = composerIdentityFor(key, sessionId);
	// `to` is `""` when a caller reaches here with no session id at all (the
	// pane's reconciliation passes `?? ""`); `panelIdentityFor` keeps the empty
	// string because `??` only answers null and undefined, and an empty identity
	// addresses no row.
	const identities = to === "" || to === key ? [key] : [key, to];
	input.settleInFlight(identities);
	/*
	 * The move is conditional on the row EXISTING: `returnInFlight` materialises
	 * an `EMPTY_ROW` for its target when neither side has one, and with the
	 * payload just settled its fold carries nothing - so a call for a row that
	 * never existed would only add an empty row to the persisted map (the
	 * operator's own store already carries 302 of them).
	 */
	if (to !== "" && to !== key && input.inputByConversation[key])
		input.returnInFlight(key, to);
}

/**
 * Move a message the PREVIOUS release held outside the composer back into it.
 *
 * The released app kept an unconfirmed message in a separate claim on the draft
 * row (`submittedText`, `submittedAttachments`) with an explicit "Restore
 * message" link, and an updated app must not strand one of those: the user would
 * have a chat whose composer says nothing about the message they typed, with no
 * link left to bring it back. The replay fields stay (they are the wire identity
 * a Retry replays under); the payload moves to the composer and the old claim
 * fields go.
 *
 * RUN FROM THE PANE, NOT FROM HYDRATION, and that is deliberate on two counts.
 * Hydration order between this store and `conversation-input-store` is an import
 * order the app does not control, so a migration that wrote into the input store
 * during one of those hydrations could be overwritten by the other. And a pane is
 * the only place with the fact the migration needs anyway: the conversation is
 * still on screen, so a row for a DELETED conversation is never resurrected into
 * a live composer (risk R6). Idempotent by the `migratedHeld` stamp, so a pane
 * that mounts twice moves it once.
 *
 * Returns whether it moved anything, for the caller that wants to know.
 */
export function migrateHeldClaim(
	key: string,
	draft: ChatDraft | undefined,
): boolean {
	if (!draft || draft.migratedHeld || draft.pending) return false;
	/*
	 * THE ROW MUST BE THE RELEASED APP'S, and this is the guard whose absence was a
	 * blocker (review round 1's B1). Everything else this migration used to test -
	 * `submittedText` present, `admissionAttempted`, not pending - is true of a
	 * FAILURE THIS BUILD JUST RECORDED, so the effect that runs it on every draft
	 * change fired on its own fresh rows: it handed the payload back a second time
	 * (doubling the text after a New-chat flip, and writing to an identity the
	 * composer does not read), then cleared `submittedText`/`submittedAttachments` -
	 * the replay identity - so the next Retry went out under the old request id with
	 * a DIFFERENT body (the receipt journal refuses that as a 409, and the app then
	 * reports an unknown outcome for ever), an edited message reused the old id, and
	 * a legacy row's payload could arrive twice.
	 *
	 * `heldClaimCode` is the released app's own claim marker and this build never
	 * writes it (see the field), which makes the test "was this row left behind by
	 * the app that held the message outside the composer" rather than "does this row
	 * look like a failure".
	 */
	/*
	 * AND A CLAIM WITH NO CODE IS STILL THE RELEASED APP'S (review round 2, R3).
	 * Keying the whole gate on `heldClaimCode` alone rejected the released app's own
	 * rows whenever the failure behind them carried no code at all - its renderer
	 * raised `DesktopControlError(null, ...)` for its own deadline and for a failed
	 * IPC - and the message stayed in `submittedText` with no reader and a Retry
	 * over an empty box.
	 *
	 * So the test is the row's SHAPE, and the field that carries it is `errorRetry`:
	 * this build writes it on every failure it records (see the catch in
	 * `admitChatDraft`, the only writer besides this function), and the released app
	 * never wrote it, because it did not exist. A row that has none, and looks like a
	 * released claim in every other way, IS one.
	 */
	/*
	 * AND `submittedRendered`, WHICH IS THE MARKER THIS BUILD WRITES WITH THE LATCH
	 * (review round 3, R2-2). `errorRetry` alone is `undefined` for every row that
	 * left this build WITHOUT reaching its catch: the pin writes `submittedText` and
	 * the latch writes `admissionAttempted` together with `submittedRendered` before
	 * the wire, and a quit before the answer is a row with no `errorRetry` at all.
	 * Treated as a released claim, it handed the payload back (harmlessly) and then
	 * cleared `submittedText` - which is what `replay` reads - while keeping the id,
	 * so the next send went out under an id the owner may already hold a receipt for
	 * and with a body the credential seam re-derived: the receipt-conflict hazard
	 * this pin exists to prevent, on the one arm whose whole point is that the app
	 * cannot tell whether the message was admitted.
	 *
	 * `submittedRendered` is absent from the released build (`v0.30.25` never wrote
	 * it), so the pair below separates the two rows: a released claim has neither
	 * field, this build's interrupted row carries the rendered pin.
	 */
	const releasedClaim =
		draft.heldClaimCode !== undefined ||
		(draft.errorRetry === undefined && draft.submittedRendered === undefined);
	if (!releasedClaim) return false;
	if (!draft.admissionAttempted || draft.submittedText === undefined)
		return false;
	const identity = composerIdentityFor(key, draft.sessionId);
	useConversationInputStore.getState().returnPayload(identity, {
		// The wrappers of any staged reply travel INSIDE this text, because the
		// released claim stored the assembled payload. Acceptable for a one-time
		// move, and it is what makes the migrated draft byte-equal to the claim:
		// pressing Retry replays it under the same request id rather than
		// becoming a second message.
		text: draft.submittedText,
		attachments: draft.submittedAttachments ?? [],
		replies: [],
	});
	useCanonicalSessionsStore.getState().updateDraft(key, {
		migratedHeld: true,
		submittedText: undefined,
		submittedAttachments: undefined,
		/*
		 * THE LEGACY SENTENCE GOES WITH THE CLAIM IT DESCRIBED. The released app
		 * wrote the transport's deadline prose ("The app waits up to 20 seconds for
		 * this request...") into `error`, and leaving it there put a sentence this
		 * app no longer produces over the returned draft - review round 1's U7/Q-7
		 * found it on the first migrated row. The payload is in the composer and its
		 * outcome is unknown, so the row states the table's sentence for that class
		 * and offers the press that answers it.
		 */
		error: SEND_FAILURE_COPY.unconfirmed,
		/*
		 * THE CLAIM'S OWN CODE, kept rather than dropped (review round 2, NIT): it is
		 * what the notice's controls are derived from, and a row that records an
		 * unknown outcome while throwing away the only fact that says WHICH unknown
		 * outcome it was is a row the next reader has to guess about.
		 */
		errorCode: draft.heldClaimCode,
		/*
		 * And the press from that code, through the same rule every other row uses
		 * (`withholdsRetryHint`), rather than the hard-wired `true` this used to write. A
		 * released claim whose code names a refusal the app can act on must not offer
		 * a Retry that meets it again.
		 */
		errorRetry: !withholdsRetryHint(draft.heldClaimCode),
		/*
		 * And the marker that makes the move once-only, whatever the row's shape: a
		 * pane that mounts twice finds `migratedHeld`, and a row written by THIS build
		 * - interrupted before its catch ran, so it carries no `errorRetry` - fails the
		 * `submittedRendered` half of the shape test above and never gets here at all
		 * (review round 3, R2-2).
		 */
		heldClaimCode: undefined,
	});
	return true;
}

/**
 * Put THIS build's failed row back on screen after a reload.
 *
 * WHY IT IS NEEDED AT ALL (S6). The registry is process state: a reload starts
 * with nothing retained, and the row the user was looking at when the send
 * failed used to come home through the COMPOSER instead (the payload was handed
 * back and the box was the message's home). S4 moved that home onto the row - and
 * a row that only exists in memory would leave the conversation silently empty
 * after a reload, with the payload no longer guaranteed to come home either. So
 * the row is re-synthesised from the draft's own claim fields, which ARE
 * persisted: the request id (`admissionRequestId`), the text the row showed when
 * it failed (`submittedRendered`, pinned before the wire - the typed payload when
 * the seam never ran), and the images it was painted with.
 *
 * THE GUARDS, one by one:
 *
 *  - `error` present AND `errorRetry` present: a failure THIS build recorded and
 *    the user has not resolved. Every path that ends a claim clears one of those
 *    (the server's later answer, a retry that landed, the user's own `Edit` on a
 *    row that provably never left), and the released app's rows carry no
 *    `errorRetry` at all - `migrateHeldClaim` above owns those.
 *  - the registry does not already hold it: in the live process the press's own
 *    paint is still there, and the server's own reconciliation
 *    (`resolveObservedPendingSends`) drops the entry the moment the durable row
 *    is observed - which is the other half of T6, and why this cannot resurrect
 *    a message the owner has answered for.
 *
 * Idempotent by construction: the first call paints, every later one sees the
 * entry and returns false. Run from the pane that is showing the conversation,
 * beside `migrateHeldClaim` - the pane is the only place with the fact that the
 * row is still on screen at all (the same R6 argument the migration carries).
 *
 * TWO SHAPES CARRY A ROW BACK, and the second one arrived with design review
 * round 1's D2: an UNRESOLVED failure (`error` + `errorRetry`, S6) and a claim
 * the server RESOLVED AS UNDELIVERED (`undelivered`, whose row is the message's
 * fate statement and its remedy). The resolved shape used to be refused here
 * because `resolveHeldFromServer` clears exactly the fields the failure arm
 * demands - `submittedText`, `error`, `errorRetry` - so a second reload after
 * the resolution painted nothing: no row, no line, and a payload that is
 * deliberately not in the composer either, which is the message surviving
 * nowhere at all. `undelivered` carries `recordId`/`text`/`attachments`, so the
 * row is re-painted under the id the durable row would carry, with the §F3 line
 * (which reads the same field) supplying the sentence and the two controls.
 */
export function resynthesisePendingSend(
	key: string,
	draft: ChatDraft | undefined,
): boolean {
	if (!draft) return false;
	const resolved = draft.undelivered;
	const submittedText = draft.submittedText;
	const failed =
		submittedText !== undefined &&
		draft.error !== undefined &&
		draft.errorRetry !== undefined;
	if (!resolved && !failed) return false;
	const identity = composerIdentityFor(key, draft.sessionId);
	if (resolved) {
		/*
		 * The RESOLVED arm: the id and the text are the resolution's own record, and
		 * there are no images to restore - `undelivered` keeps the attachment PATHS
		 * (the payload basis), not encoded bytes, and a row that showed none at paint
		 * time must not invent them. The line's controls act on the same text.
		 *
		 * PAINTED SETTLED, and the guard is membership rather than liveness: the
		 * claim's outcome is known (that is what the record IS), so this entry keeps
		 * painting the row without answering "still going out" for it - the
		 * distinction a NEXT message on the same conversation needed, because the
		 * oldest entry is the one every pending reader names (see `settled`).
		 */
		if (hasPendingSend(identity, resolved.recordId)) return false;
		/*
		 * THE REPAINT GUARD (issue #847). The registry is PROCESS state, so after a
		 * reload the membership test above is empty whatever the transcript holds,
		 * and the verdict this row carries is painted again from scratch. When the
		 * LOADED transcript already holds the record, that paint is a second row for a
		 * message that is on screen — `appendPendingUser` no-ops for an id the
		 * transcript has, so nothing doubles, but the row it would mint is held in
		 * `withTimeOrder`'s TAIL BLOCK while the record already resident keeps its
		 * canonical place, which is a tail row by another name.
		 *
		 * AND THE VERDICT IS THE WRONG FACT in the case that matters, which is the
		 * half worth a write: an OWNER record under this id (a durable row, or the
		 * owner's own `message_start`) is proof the message reached the conversation,
		 * so the `undelivered` record contradicting it is retracted here rather than
		 * left to repaint on every later mount. A LOCAL record is this app's own echo
		 * — not proof of anything — so it stops the second paint and nothing else.
		 * `unseen` is no transcript mounted (or no such record), which is the arm
		 * that must keep painting: it is the genuinely-undelivered case.
		 */
		const held = peekLocalEcho(identity, resolved.recordId);
		if (held !== "unseen") {
			if (held === "owner")
				useCanonicalSessionsStore
					.getState()
					/*
					 * `key`, not `draft.key` (agent review round 1's R5): every neighbouring line
					 * here targets the parameter, and the parameter is the map key the write
					 * actually lands on - `draft.key` only equals it by construction today.
					 */
					.retractUndelivered(key, resolved.recordId);
			return false;
		}
		paintPendingSend(identity, {
			id: resolved.recordId,
			text: resolved.text,
			images: [],
			settled: true,
			submittedAt: draft.submittedAt,
		});
		return true;
	}
	// The failure arm's own guard, repeated as a narrowing rather than trusted
	// from a boolean: `submittedText` is what the row shows when nothing was
	// pinned, and the renderer reads it below.
	if (submittedText === undefined) return false;
	const id = draft.admissionRequestId;
	if (hasPendingSend(identity, id)) return false;
	paintPendingSend(identity, {
		id,
		/*
		 * The text the ROW showed when the failure landed, not the payload basis:
		 * the seam's substitution is what the wire carried and what the row was
		 * spliced to, and it is pinned before the attempt. `submittedText` is the
		 * fallback for the classes whose failure came before the seam.
		 */
		text: draft.submittedRendered ?? submittedText,
		/* The press's clock anchor survives with the row; see `PendingSend`. */
		submittedAt: draft.submittedAt,
		// The same id shape the press's own paint used, so a later owner row for
		// this id coalesces with it rather than sitting beside it.
		images: (draft.submittedImages ?? []).map((image, index) => ({
			id: `${id}:${index}`,
			data: image.data_b64,
			attachment: null,
			mimeType: image.mime_type,
		})),
	});
	return true;
}

/**
 * Take down the row a retracted `undelivered` verdict painted, so the tail holds
 * no statement-less bubble (design review round 1's D1).
 *
 * WHY THE VERDICT IS NOT THE WHOLE FACT. `resynthesisePendingSend`'s resolved arm
 * paints the verdict as a row at the tail, as the message's home - correct while
 * the verdict stands. Retracting the verdict alone (the repaint guard's `owner`
 * arm, and the launch sweep's walk) takes the SENTENCE off that row and leaves
 * the bubble behind: on the first mount after an upgrade the pane's resynthesis
 * is synchronous and the heal is an async read, so the paint always wins the
 * race and the durable row that would replace it is behind the loaded window. The
 * reader then sees a user bubble reading as the newest message while the verdict
 * that explained it has been withdrawn.
 *
 * `retractLocalEcho` is the established act for this, and it is safe from both
 * callers: it removes the record only while it is still this app's own echo (an
 * `owner` record, the durable row, is left where it is), and it resolves the
 * registry entry either way - so a later mount's `resynthesisePendingSend` cannot
 * paint the row back. Nothing mounted means the call is just the entry's removal,
 * which is exactly right after a reload.
 */
function clearPaintedVerdictEcho(
	draftKey: string,
	sessionId: string | null | undefined,
	recordId: string,
): void {
	retractLocalEcho(composerIdentityFor(draftKey, sessionId), recordId);
}

/**
 * Whether the payload a composer holds is the one the claim was issued for.
 *
 * The retry rule's one comparison, and it is over the payload the OWNER will
 * see: the normalized text (the composer's `buildSendPayload` output, reply
 * wrappers and all) and the attachment PATHS in order.
 *
 * PATHS rather than the encoded images beside them, deliberately. Images travel
 * as re-encoded bytes, and the encoder is not promised to be byte-stable across
 * attempts - so comparing them would make a Retry that re-encoded the same file
 * report itself as a different message, and the same-id replay it is entitled to
 * would become a fresh send under a fresh id (two rows for one message). The
 * paths are the user's own list, so a changed list is genuinely a changed
 * message, which is exactly what the comparison has to detect.
 */
function payloadMatchesClaim(
	claim: ChatDraft,
	text: string,
	attachments: readonly string[],
): boolean {
	if (claim.submittedText !== text) return false;
	const claimed = claim.submittedAttachments ?? [];
	if (claimed.length !== attachments.length) return false;
	return claimed.every((path, index) => path === attachments[index]);
}

/**
 * Whether a send addressed to `sessionId` is inside the validation window.
 *
 * Extracted and exported for the same reason `draftIdentityFor` and
 * `panelIdentityFor` are: a rule that only exists inside one component is a rule
 * nothing exercises. `scripts/session-switch.test.mjs` drives a real
 * `openSession` and asserts the refusal through the store it belongs to, so a
 * regression in the gate - dropping a term, or comparing the wrong id - fails a
 * case instead of shipping.
 *
 * The window has no live term of its own here because it does not need one any
 * more: `confirmSessionLive` closes it when the session's stream proves the
 * session exists, so a second condition at the call site would be a second
 * answer to a question the store already answers (see `validatingSessionId`).
 */
export function isSessionUnvalidated(
	validatingSessionId: string | null,
	sessionId: string | null | undefined,
): boolean {
	return Boolean(sessionId) && validatingSessionId === sessionId;
}

/**
 * How many times a request that met a BUSY owner is repeated before the refusal
 * reaches its caller, and the longest single wait between two attempts.
 *
 * ONE POLICY FOR BOTH REQUESTS THAT CAN MEET IT. The send (`messageWithBusyResend`
 * below) and an answer press (`answerGateOption`/`answerGateSecret` in
 * `ask-answer.ts`) are the two control calls whose retry the daemon's own body
 * invites - `retryable: true` with `retry_after_ms` - and answering it two ways
 * would give one refusal two patience policies.
 *
 * `runtime_busy` (see `RUNTIME_BUSY_CODE`) is the daemon refusing a control call
 * in ~3 s because the session's owner is alive and not answering - mid-turn in a
 * long synchronous step, typically - and saying a resend with the same
 * `request_id` is safe. A short-lived busy owner is the common case, so the app
 * absorbs a few of those itself instead of showing the user a failure for
 * something that clears on its own: three resends at the backend's own
 * `retry_after_ms` (2 s today) is about 15 s of patience end to end, the same
 * order as the 15 s the old control bind spent waiting before it gave up, and
 * each attempt answers fast, so the whole loop never approaches the renderer's
 * own 20 s per-request deadline. Past that the refusal reaches the composer, which
 * hands the text BACK to the box rather than holding it against the transcript:
 * each attempt failed before admission, so the code is one of
 * `isRefusedBeforeAdmission`'s and the send does not latch. Holding it would
 * describe the operator's own message as one whose fate cannot be known, which is
 * the one thing this owner has just said it is not.
 *
 * THE TWO CALLERS DO NOT COST THE SAME TIME, and an earlier draft of this note
 * undercounted the press's bound (QA round 1's watch item, 2026-10-01). A send's
 * attempt answers in ~3 s (the fast verdict above), so its loop is ~15 s end to
 * end. An answer press's attempts end when the answers route spends its own
 * bounded ack budget - 16.5 s measured on the backend change for the
 * all-acks-lost arm - so the press's bound is 4 attempts x ~17.5 s + 3 waits x
 * min(retry_after_ms, 5 s) = **~76 s of silence with today's 2 s hint, ~85 s if a
 * backend asked for the cap**, held on a card whose options are disabled. The
 * waits are the loop's own real 2 s timers (`setTimeout`), not a fixture's zero:
 * the suite's fast cases zero `retry_after_ms` deliberately, and the wire value
 * is what production waits on.
 *
 * IT CANNOT COMPOUND THE RENDERER'S OWN DEADLINE, which is the one reading that
 * would make it worse. `withDeadline` (`desktop-api.ts`) races every
 * `desktopRequest` against a fresh `desktopRequestTimeoutMs` - 25 s for
 * `sessions.answer` (`DESKTOP_CONTROL_DEADLINE_MS` 20 s + margin 5 s) - so
 * "4 x 25 s + 6 s = 106 s" looks like the cap. It is not one: an attempt that
 * reaches that timeout raises `deadline_exceeded`, which this loop does not
 * catch, so it is thrown on the FIRST attempt and only refusals the ROUTE
 * authored are ever repeated. The deadline is a ceiling on a single attempt, not
 * a term in the sum.
 *
 * That is the disclosed cost of doing the repeat for the user rather than handing
 * them an instruction the app has already carried out (design round 1 on the
 * answers route, D2/D5). The copy and the registers do not change with the bound;
 * if design wants the press's patience shortened, the parameter to move is
 * `BUSY_RESENDS`, and the bound moves with it.
 *
 * The cap on one wait is there because the hint comes off the wire: a backend
 * that asked for a minute must not park a request that long with nothing on
 * screen but the pending echo.
 */
const BUSY_RESENDS = 3;
const BUSY_RESEND_MAX_WAIT_MS = 5_000;
const BUSY_RESEND_DEFAULT_WAIT_MS = 2_000;

/**
 * `run`, repeated on a `runtime_busy` refusal with the SAME request.
 *
 * The caller's request object is reused whole - same `requestId`, same text,
 * images and `mode` - because the backend's receipt is keyed on a hash of the
 * whole body (`desktop_receipts.py`): a resend that differed in any field would
 * be a 409, and one with a fresh id could deliver twice. Every other failure is
 * thrown on the first attempt, untouched, so the classification at each call
 * site sees exactly what it saw before this existed.
 *
 * AND NOTHING IS PRODUCED WHILE IT REPEATS. The caller sees either the final
 * refusal or a success, which is what makes the design round's "say nothing
 * while the app's own retry still has a chance" (arm 1a) a property of this
 * loop rather than a rule each surface has to remember.
 */
export async function withBusyResends<T>(run: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			if (
				attempt >= BUSY_RESENDS ||
				!(error instanceof DesktopControlError) ||
				error.code !== RUNTIME_BUSY_CODE
			)
				throw error;
			const wait = Math.min(
				Math.max(0, error.retryAfterMs ?? BUSY_RESEND_DEFAULT_WAIT_MS),
				BUSY_RESEND_MAX_WAIT_MS,
			);
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
	}
}

/**
 * `sessions.message`, under that policy.
 */
async function messageWithBusyResend(
	request: Extract<DesktopRequest, { op: "sessions.message" }>,
): Promise<void> {
	await withBusyResends(async () => {
		await desktopResult(request);
	});
}

/** Create and admission are intentionally separate receipts. A response lost
 * between them retains its exact IDs and payload; retry never reallocates or
 * deletes work that may already have been admitted by the owner. */
export async function admitChatDraft(
	key: string,
	input: {
		text: string;
		attachments: string[];
		images: ChatImage[];
		mode: "prompt" | "steer";
		cwd: string;
		/**
		 * How the message was produced (arch §4.2): `typed`, `dictated`, or
		 * `mixed` since the box last emptied. Carriage only.
		 */
		inputMode?: "typed" | "dictated" | "mixed";
		/**
		 * RESERVED, AND NO CALLER IN THIS TREE SETS IT (arch §4.2a): the route
		 * cascade owns the `input_path` vocabulary, and the field is pinned below
		 * beside `inputMode` so that when its first caller arrives a replay stays
		 * byte-identical instead of changing the receipt's hash.
		 */
		inputPath?: string;
	},
	sessionId?: string,
	/**
	 * Called when the optimistic row is PAINTED - i.e. when the message is
	 * actually on screen. It fires at the press now (the paint happens before
	 * `sessions.create`), passed straight to `paintPendingSend`; the composer is
	 * the only caller that has anything to do with the answer (see `PendingSend`
	 * in `use-canonical-session`).
	 */
	onEchoPainted?: () => void,
	/**
	 * The seam between "the session exists" and "the message is admitted".
	 *
	 * It exists for one caller and one reason: a CREDENTIAL handed over in a
	 * conversation's FIRST message. The composer must store the value into the
	 * session's tool environment before the message that cites it leaves, §9's
	 * whole point — but on a draft pane the session is created INSIDE this call,
	 * so before it there is genuinely nothing to store into and the store's only
	 * honest answer is "no session to reach". The most likely first use of the
	 * feature (a brand-new chat whose first message hands over an API key)
	 * therefore could not work at all, and degraded silently to the not-stored
	 * citation (UX round 1, U2; code review round 1, MINOR-4).
	 *
	 * Called with the id this call has resolved — the one it created, or the one
	 * it was handed — and BEFORE the optimistic echo and the transport, which is
	 * the only window in which the answer can still change what is sent. The
	 * returned string, when there is one, is what the echo paints and what the
	 * message carries; `undefined` keeps `input.text`.
	 *
	 * It runs after `sessions.create` and before `admissionAttempted`, so a
	 * throw here is still "nothing was admitted": the composer gets its text
	 * back rather than a held claim about a message the owner never saw.
	 */
	beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
): Promise<string | null> {
	const store = useCanonicalSessionsStore.getState();
	/*
	 * THE VALIDATION WINDOW'S GATE, and it lives here rather than at the call
	 * site because "a message may not be admitted against a session nothing has
	 * confirmed yet" is a property of admission, not of one screen's send button.
	 *
	 * The commit puts the view on the target before its stream has said whether
	 * it still exists, and `validatingSessionId` is that window (closed by the
	 * stream's first snapshot). A message admitted inside it would be addressed
	 * to a session that may be gone - so it is refused here, before the draft is
	 * latched and before the transport is reached, which is also what makes the
	 * refusal a `false` at the composer rather than a held claim (see
	 * `isRefusedBeforeAdmission`).
	 *
	 * `UserFacingError` rather than a bare `null`, deliberately. `null` is this
	 * function's answer for "the same send is already in flight" and for the
	 * unchanged-payload guard, and the composer cannot tell the three apart from
	 * it - which is exactly how this refusal stayed silent for a whole review
	 * round (UX round 2, U8). The error carries the sentence the composer shows.
	 *
	 * Only a send that NAMES a session can be refused: creating one addresses no
	 * existing target, so the create path is untouched.
	 */
	if (isSessionUnvalidated(store.validatingSessionId, sessionId))
		throw new UserFacingError(
			SESSION_UNVALIDATED_MESSAGE,
			SESSION_UNVALIDATED_CODE,
		);
	const previous = store.drafts[key];
	if (previous?.pending) return null;
	// Normalized once, here, and used for the guard, the stored claim and the
	// wire alike - see `normalizeSendText`. Comparing or sending `input.text`
	// anywhere below would reopen the gap between what the guard enforces and
	// what the composer says about it.
	const text = normalizeSendText(input.text);
	/*
	 * ONE SEND IN FLIGHT, AND ONE COMPARISON - the two facts this function's exit
	 * rests on, which is why they are stated together.
	 *
	 * ONE SEND IN FLIGHT per pane: the draft row carries the request id, and two
	 * concurrent admissions would race on it. Left as the store's own silent `null`,
	 * because the composer's send lock already reports it in words and this arm is
	 * the second press inside the same keystroke.
	 *
	 * WHAT USED TO BE HERE, AND WHY IT IS GONE. A guard compared this payload with
	 * the claim's and REFUSED any difference - which is what put a paragraph about a
	 * different message being impossible on the operator's screen, and made a
	 * composer the custodian of a message the app was holding. The protection it
	 * existed for is real and needs no block: an UNCHANGED resend must be an
	 * idempotent replay under the same request id (the owner de-duplicates by
	 * `command_id`, and the receipt journal by a hash of the whole body), while a
	 * CHANGED one is a different message - a new message by definition - and goes out
	 * under a new id. So what follows is a replay DECISION, not a refusal, and nothing
	 * the user can type is ever rejected because of what was sent before.
	 *
	 * AND THE COMPARISON IS OVER THE LAST ATTEMPT WHATEVER ITS CLASS. The old gate
	 * also required `admissionAttempted`, the latch for an UNKNOWN outcome, which
	 * meant the arms where the backend refused the request outright got a fresh
	 * request id for an unchanged re-send. That is the case the id exists to cover:
	 * the owner de-duplicates by it, and a busy owner that had in fact queued the
	 * command would answer the re-send as a SECOND message. So the payload decides
	 * (normalized text and attachment paths, in order - see `payloadMatchesClaim`),
	 * not the class: the same message replays under the id it was first issued with,
	 * and an edited one is a new message with its own.
	 */
	const replay =
		previous?.submittedText !== undefined &&
		payloadMatchesClaim(previous, text, input.attachments);
	const draft: ChatDraft = previous ?? {
		key,
		createRequestId: crypto.randomUUID(),
		admissionRequestId: crypto.randomUUID(),
	};
	/*
	 * WHAT IS PINNED ON A REPLAY, AND WHY ANY OF IT IS. `mode` reads like a
	 * delivery instruction rather than payload, and it MUST be pinned once an
	 * admission has been issued: the server keys its receipt on a sha256 of the
	 * WHOLE request body, `mode` included (desktop_receipts.py), and refuses a
	 * same-id retry whose body hashes differently with a 409 ReceiptConflict. So
	 * the lost-response case - admitted, response never arrived, session now
	 * streaming, UI recomputes busy and would say "steer" - would retry as a
	 * different body, 409 forever, and report a failure for a message that landed.
	 *
	 * An EDITED payload is a new message: it rotates the request id and takes this
	 * attempt's own values rather than the previous claim's, so the claim cannot
	 * outlive the message it described.
	 */
	const images = replay
		? (previous?.submittedImages ?? input.images)
		: input.images;
	const mode = replay ? (previous?.submittedMode ?? input.mode) : input.mode;
	/*
	 * THE SAME PINNING RULE GOVERNS `input_mode`, FOR THE SAME REASON: it is part
	 * of the body the receipt hashes, so the lost-response case must replay the
	 * value the FIRST attempt sent rather than re-derive it (a retry after the
	 * user typed again would otherwise pin a different provenance for the same
	 * request id). `input_path` rides the identical rule; it is `undefined` for
	 * every caller today.
	 */
	/*
	 * A PREVIOUS ATTEMPT IS REPLAYED VERBATIM - INCLUDING ITS ABSENCE (review
	 * round 1, n1). `previous?.submittedInputMode ?? input.inputMode` re-derived
	 * the field when the first attempt had pinned NOTHING (the capability was off,
	 * so it sent no key): a retry that carried a value would then stamp a
	 * different body for the same request id, which is the one thing the pin
	 * exists to prevent. The `??` chain is correct only for a first attempt;
	 * with a previous one, its value - present or absent - is the answer.
	 */
	const inputMode =
		replay && previous ? previous.submittedInputMode : input.inputMode;
	const inputPath =
		replay && previous ? previous.submittedInputPath : input.inputPath;
	/*
	 * And the id follows the same rule: the last attempt's id when this is the same
	 * message, a fresh one when it is not. A first send has no previous payload, so it
	 * keeps the id the draft was staged with (`stageDraft`'s own mint) - that is the id
	 * the echo is painted under and the one the owner gives the durable row, and
	 * re-minting it here would key the echo to one UUID and the request to another.
	 */
	const admissionRequestId =
		previous?.submittedText === undefined || replay
			? (previous?.admissionRequestId ?? crypto.randomUUID())
			: crypto.randomUUID();
	/*
	 * ONE PRESS, ONE ANCHOR (agent review round 2, R2-5): the same number goes on
	 * the draft row (the panes' read) and on the registry entry painted below
	 * (which survives remounts - see `PendingSend.submittedAt`), so the wait
	 * clock cannot be two clocks.
	 */
	const submittedAt = Date.now();
	store.updateDraft(key, {
		...draft,
		/*
		 * `true` only on a replay. A fresh send is a request that has not been
		 * issued yet - the latch below is what sets this flag - so leaving the
		 * previous claim's value in place would hold a claim over a message this
		 * attempt has not sent.
		 */
		admissionAttempted: replay,
		admissionRequestId,
		submittedRendered: replay ? previous?.submittedRendered : undefined,
		migratedHeld: previous?.migratedHeld,
		pending: true,
		submittedText: text,
		submittedAttachments: input.attachments,
		submittedImages: images,
		submittedMode: mode,
		submittedInputMode: inputMode,
		submittedInputPath: inputPath,
		/*
		 * The last attempt's sentence and code go with it: a retry that leaves a
		 * stale refusal on screen over a request that is now in flight reads as the
		 * failure having repeated itself, and the notice is re-raised by whatever
		 * this attempt's outcome is.
		 */
		error: undefined,
		errorCode: undefined,
		// The press's own anchor for the wait line's clock, written with the
		// claim it belongs to: see `submittedAt` for why the row carries it.
		submittedAt,
	});
	/*
	 * THE PAINT MOVES TO THE PRESS, AND THAT IS THE HALF OF THE FELT-LATENCY FIX
	 * THAT WAS STILL MISSING.
	 *
	 * The echo used to be fired after the create and the credential seam, so on a
	 * New chat the user watched an emptied composer and an empty transcript for
	 * the whole create hop (~1.15 s on a cold runtime), and the row could only
	 * reach the replacement panel through a buffered drain. Painting here instead
	 * removes both: the draft pane has registered under its own identity since
	 * its first keystroke, so the row lands SYNCHRONOUSLY with the press and
	 * `onEchoPainted` releases the composer's text in the same commit (AC2).
	 *
	 * The identity is the PANE's, not the session's, and that distinction is
	 * load-bearing: `panelIdentityFor` answers the draft key while no session
	 * exists, which is exactly the identity the draft pane is registered under,
	 * while a `send:<id>` row addresses the session itself. The re-key to the
	 * created session happens at the id's own patch point below, in the same
	 * synchronous block, so no frame between the two ever addresses an identity
	 * nobody holds.
	 *
	 * Keyed by `admissionRequestId` - the id the owner gives the durable row - so
	 * this coalesces with `message_start` instead of duplicating it. See
	 * `appendPendingUser`.
	 */
	const paintIdentity =
		panelIdentityFor(
			key.startsWith("draft:") ? key : null,
			sessionId ?? draft.sessionId,
		) ?? null;
	if (paintIdentity)
		paintPendingSend(paintIdentity, {
			id: admissionRequestId,
			submittedAt,
			text,
			// Same id shape `extractImages` gives the owner's row, so the coalesced
			// record keeps its image keys across the swap.
			images: images.map((image, index) => ({
				id: `${admissionRequestId}:${index}`,
				data: image.data_b64,
				attachment: null,
				mimeType: image.mime_type,
			})),
			onPainted: onEchoPainted,
		});
	/*
	 * Whether the message request was ISSUED - the store's own latch, read at the
	 * catch to decide whether an owner row could possibly exist. Local rather than
	 * re-read from the row there, because the row is written twice below (the pin,
	 * then the latch) and a third read at the catch is a third chance to disagree
	 * with itself.
	 */
	let attempted = replay;
	// Declared outside the try because the catch needs it to address the row:
	// `draft` is the pre-send snapshot, so reading `draft.sessionId` there would
	// miss a session this very call created and leave its row unretractable.
	let id = sessionId ?? draft.sessionId;
	/*
	 * WHICH REQUEST THE FAILURE CAME FROM, and the reason this is recorded rather
	 * than inferred at the catch.
	 *
	 * The classification below asks one question - "was the user's message
	 * refused for its leading slash?" - and only `sessions.message` can answer
	 * it. `sessions.create` shares this try because a send to a NEW conversation
	 * has to create one first, but its 422 is about the CREATE fields (`cwd`,
	 * `target`), and the draft text it would be classified against never left the
	 * renderer: the request ops were `['sessions.create']`. Classifying that
	 * failure by the draft's shape told a user whose directory was invalid to
	 * "move it below your text" - the app confidently naming the wrong cause,
	 * which is the exact class of defect U13 exists to remove, so reintroducing
	 * it on the display path we had just repaired would be worse than never
	 * having repaired it (round 5, R13).
	 *
	 * Reaching the message request is therefore the PRECONDITION of the slash
	 * classification, not the draft's shape - and this variable is the only thing
	 * that can satisfy it. It is set immediately before the request it names, so
	 * a failure raised anywhere earlier (including a create that "succeeded"
	 * without returning an id) stays on the create side by default.
	 */
	let inFlight: "sessions.create" | "sessions.message" | null = null;
	try {
		if (!id) {
			inFlight = "sessions.create";
			id =
				(await store.createSession(
					input.cwd,
					draft.target,
					draft.createRequestId,
					// The pane's own pick, or nothing at all: a draft that was never
					// picked from omits the field from the create body entirely.
					draft.model ?? null,
					// The pre-engaged runtime, when the first keystroke's mint adopted
					// one. `undefined` here is the ordinary path — an older backend, a
					// send before the mint answered — and the create then mints fresh
					// exactly as it always did.
					draft.warmId,
					// The device the pane's own control picked, if it picked one. `undefined`
					// for every draft nobody aimed at a peer, which is what keeps the body
					// of an ordinary create byte-identical to what it was before the control.
					draft.peer,
				)) ?? undefined;
			if (!id)
				throw new UserFacingError(
					useCanonicalSessionsStore.getState().error ?? "Chat could not start.",
				);
			store.updateDraft(key, { sessionId: id });
			/*
			 * THE RE-KEY RIDES THE SAME SYNCHRONOUS BLOCK as the id's own patch,
			 * and that is a requirement rather than tidiness: the panel keyed on the
			 * new id mounts on the commit that follows this block, and its first
			 * frame is seeded from the registry (`seedPendingSends`). Re-keyed after
			 * an await - or in an effect - the replacement panel would paint an
			 * empty transcript for a frame and then receive the row through the
			 * drain, which is the flash the design's J1/J2 forbid. `movePendingSendIdentity`
			 * is therefore called only from here, between the patch and anything
			 * that can await.
			 */
			if (paintIdentity) movePendingSendIdentity(paintIdentity, id);
			/*
			 * AND THE CATALOGUE IS RE-READ HERE (S5), on the create's OWN answer
			 * rather than after the send resolves. The sidebar's draft row drops the
			 * moment `sessionId` is patched on the row (`draft-rows.ts` condition 1)
			 * while the session row only arrives with a catalogue answer - and the
			 * post-send read below lives in the PANE that pressed, so a user who
			 * switched away has only the 30 s poll; between the two the conversation
			 * is in neither list. Issuing the read here makes the appearance overlap
			 * the disappearance instead of leaving a gap.
			 *
			 * ONE READ, NOT A SECOND REFRESH POLICY: `fetchSessions` coalesces
			 * concurrent catalogue reads (`coalesceSessionCatalogueRequest`), so the
			 * pane's own post-send read joins this one in the common path and costs
			 * nothing extra. The post-send read STAYS - it re-reads once the message
			 * is admitted, which is an answer this one predates.
			 */
			void store.fetchSessions();
		}
		// From here the outcome is unknowable on failure: the owner may have
		// admitted the command before the response was lost.
		// THE SEAM, before the echo and before the wire: see `beforeAdmission`.
		// `text` stays the payload IDENTITY for the guard below (it is the string
		// the composer will send again on a retry, markers and all), while
		// `rendered` is what the operator sees echoed and what the owner receives.
		/*
		 * A REPLAY DOES NOT RE-RENDER, and skips the credential seam with it. The
		 * pinned text IS the body the first attempt sent, so re-running a
		 * substitution over it could only change the body the receipt is keyed on
		 * - and the values it would substitute are already inside the message the
		 * owner has (or has not) admitted.
		 */
		/*
		 * THE SEAM RUNS WHENEVER NOTHING HAS BEEN RENDERED YET, replay or not.
		 *
		 * The pin exists so a REPLAY is byte-identical to the body the owner's
		 * receipt is keyed on - and a row created before the create hop answered has
		 * no pin, because the seam had no session to substitute into. Reading the pin
		 * alone sent the raw composer text on that retry: the credential markers went
		 * to the model verbatim ("[Credential #1, 19 chars]") and the credential was
		 * never stored into the session that the retry had just created - review round
		 * 1's M4/m5. So the pin is used when there is one, and the seam runs when
		 * there is not: nothing was rendered, so there is no body to keep identical.
		 */
		const rendered =
			replay && previous?.submittedRendered !== undefined
				? previous.submittedRendered
				: beforeAdmission
					? ((await beforeAdmission(id)) ?? text)
					: text;
		attempted = true;
		/*
		 * The rendered text is pinned in the same update that latches the attempt,
		 * so a replay has nothing left to re-derive: see the pinning note above for
		 * what a re-render costs (a same-id request whose body hashes differently,
		 * refused as a receipt conflict).
		 */
		store.updateDraft(key, {
			/*
			 * AND THE PREVIOUS FAILURE'S NOTICE GOES WITH THE ATTEMPT THAT PRODUCES IT
			 * (review round 5, m5-2). The pane renders the row's sentence when it has one
			 * (`caughtFailureNotice`), so a row still carrying an older failure's sentence
			 * would show THAT one for a throw that writes no row of its own - measured: an
			 * unrelated "not ready" refusal rendered the earlier budget sentence. Clearing
			 * it here is the store's own way of saying which attempt the sentence belongs
			 * to: the failure that follows this admission writes its own, and a remount
			 * with no attempt running is untouched.
			 */
			error: undefined,
			errorCode: undefined,
			errorRetry: undefined,
			admissionAttempted: true,
			submittedRendered: rendered,
		});
		/*
		 * THE ROW IS ALREADY ON SCREEN: it was painted at the press, and the seam's
		 * answer only ever REPLACES its text - `rendered` is the same message with
		 * its credential markers substituted, so the row's identity (the request id)
		 * and its position are unchanged (one splice, same row; risk R4). A seam
		 * that answered with the unchanged text is a no-op by construction.
		 *
		 * The old order fired the echo HERE - after the create, after the seam -
		 * which is what put the row behind the whole engage and forced the drain's
		 * buffering. Nothing about the felt-latency fix is deferred to this line
		 * any more: by the time it runs the user has been looking at their message
		 * for the create hop, and this only settles its final text.
		 */
		if (id) replacePendingSendText(id, admissionRequestId, rendered);
		inFlight = "sessions.message";
		await messageWithBusyResend({
			op: "sessions.message",
			sessionId: id,
			requestId: admissionRequestId,
			text: rendered,
			images: images.length ? images : undefined,
			mode,
			inputMode,
			inputPath,
		});
		store.finishDraft(key, id);
		// A send that landed retires every message about the send that did not.
		// `createSession` records its failure page-level and only `fetchSessions`/
		// `openSession` ever cleared it, so a successful retry left a stale "Chat
		// could not start." standing over a working conversation.
		useCanonicalSessionsStore.setState({ error: null });
		return id;
	} catch (error) {
		// One owner for one failure. `createSession` sets the page-level `error`
		// AND rethrows, so the same sentence rendered twice - once at the top of
		// the chat column and once at the composer. The composer's copy is the
		// actionable one (it sits on the text that failed and carries Retry and
		// Clear), so the send takes the message over and clears the other.
		useCanonicalSessionsStore.setState({ error: null });
		/*
		 * WHICH OF THE THREE OUTCOMES THIS IS, decided once and read by every
		 * branch below: `not_sent` (the message provably never reached the
		 * session), `unknown` (it may have, and the app cannot tell) and `gone`
		 * (the conversation is not there). See `sendFailureClass`.
		 */
		/*
		 * ONE FACT, ABOUT THE ID THIS REQUEST ACTUALLY CARRIED (review round 3,
		 * R2-1). `previous.admissionAttempted` is the PRE-SEND snapshot, and an
		 * edited payload rotates `admissionRequestId` in this same call - so read on
		 * its own it can describe an id this attempt no longer uses. Read that way, a
		 * codeless 409 on a FRESH id took the unknown branch for the sentence while the
		 * row latched `not_sent`: one failure, two classes, and the sentence "Sending
		 * it again is safe." offering a Retry that re-posted a body the daemon had just
		 * refused.
		 *
		 * `replay` is the retry rule's OWN answer about the id - a replay reuses the id
		 * it was first issued with, an edit mints a new one - so the fact below is true
		 * only for an attempt that went out under an id an earlier attempt had already
		 * used and left unresolved. That is exactly the receipt conflict the
		 * codeless-409 split exists to tell from a refusal of this body, and it is the
		 * value both classifications now read.
		 */
		const replayedAttempt = replay && previous?.admissionAttempted === true;
		const klass = sendFailureClass(error, replayedAttempt);
		// Gated on the request that actually failed: a create-stage 422 is about
		// the create fields and must keep its own diagnosis (round 5, R13).
		const leadingSlash =
			inFlight === "sessions.message" && isLeadingSlashRefusal(error, text);
		const failureCode = leadingSlash
			? LEADING_SLASH_CODE
			: sendFailureCode(error);
		// One call, so the sentence the row keeps and the control it offers cannot
		// come from two classifications of the same failure.
		const copy = sendFailureCopy(error, failureCode, replayedAttempt);
		/*
		 * DID IT LAND AFTER ALL? Only a failure with an UNKNOWN outcome can be
		 * answered this way, and only when the id the owner would have used is
		 * already painted as a row that is not ours.
		 *
		 * `peekLocalEcho` reports whether the row under that id is still this app's
		 * own optimistic echo (`local: true`, stamped by `appendPendingUser`). A
		 * user record without that flag is the OWNER's - its `message_start` or a
		 * durable history row - which means the message was admitted, the failure
		 * was the response to it, and nothing should be handed back: the send
		 * succeeded.
		 *
		 * AND AN UNKNOWN OUTCOME KEEPS THE ECHO (§F3, agent review round 4's R17).
		 * The read is `peekLocalEcho` rather than `retractLocalEcho` for exactly
		 * this arm, and the difference is the whole restore: `retractLocalEcho`
		 * REMOVES our row, which is right for a message that lives only in the
		 * composer - but an unconfirmed send must keep its `Not delivered · Send
		 * again · Edit` line on the transcript until the server's own answer
		 * resolves it (`resolveHeldFromServer`), so the row stays and the payload
		 * comes home beside it. `unseen` (no transcript mounted to hold the row)
		 * resolves the same way - nothing delivered, nothing removed - and the
		 * pane's reconciliation re-reads the verdict when a panel mounts.
		 */
		let delivered = false;
		/*
		 * THE ROW LIVES UNDER THE IDENTITY THE PAINT USED, and at the catch that is
		 * whichever identity the send has reached: the session id once the create
		 * answered (the move above put it there), the pane's own key while it has
		 * not. Reading `id` alone missed the create-stage row - the one this change
		 * newly paints - which is what `rowIdentity` is for.
		 */
		const rowIdentity = id ?? paintIdentity ?? undefined;
		if (rowIdentity && klass === "unknown") {
			/*
			 * The one question the store still asks its transcript: did the owner's own
			 * row for this id arrive anyway (the response was lost, the message landed)?
			 * `peekLocalEcho` because for an unknown outcome the row must NOT be
			 * retracted before the answer is read - the verdict and the retraction would
			 * race, and the losing order deletes a durable message.
			 */
			delivered =
				attempted && peekLocalEcho(rowIdentity, admissionRequestId) === "owner";
		}
		/*
		 * WHAT A FAILURE LEAVES ON THE ROW: the LATCH only for an unknown outcome, and
		 * the payload basis for every class.
		 *
		 * `admissionAttempted` is the fact the PANE reads - `sendUnsettledForSession`
		 * shows a send as in flight from it, and the pane's reconciliation looks for the
		 * owner's row under the id it names - so it stays exactly what it says: an
		 * admission was issued and its outcome is not known. A refusal the backend
		 * stated is not that, and does not latch.
		 *
		 * The payload fields stay because they are the COMPARISON BASIS the retry rule
		 * reads (`payloadMatchesClaim`), not a claim anybody has to release: the copy the
		 * user acts on is in the composer, and this row's copy is a fingerprint. Dropping
		 * them here would make an unchanged re-send a fresh request id, which is the one
		 * thing the owner's de-duplication needs to not happen.
		 */
		store.updateDraft(key, {
			pending: false,
			admissionAttempted: klass === "unknown" && attempted,
			errorCode: failureCode,
			/*
			 * The row's own sentence comes from the SAME table the composer renders,
			 * with the code this catch reclassified (a leading-slash 422). Recording
			 * `userFacingMessage` here instead was wrong for every unknown outcome: a
			 * raw throw or a lost response has no sentence of its own, and the generic
			 * fallback says "Your message wasn't sent." - a claim about a request the
			 * app has just said it cannot see. The row is what a remounted composer
			 * reads, so the notice must survive that remount unchanged.
			 */
			error: copy.message,
			/*
			 * And the control the sentence goes with, decided by the same call: see
			 * `errorRetry` for why the row carries it rather than the pane deriving it.
			 */
			errorRetry: copy.retry,
		});
		/*
		 * DELIVERED AFTER ALL: the send is a success, so the composer stays empty,
		 * nothing is handed back, and the draft row retires exactly as it does on the
		 * acknowledged path. The pane's reconciliation would reach the same answer a
		 * moment later from the transcript; resolving here is what saves the user a
		 * frame in which their message appeared to have failed when it had not.
		 */
		if (delivered) {
			// `delivered` is only ever set with an id in hand (the branch above), so
			// this is the compiler's need and not a second decision.
			if (id) {
				// `finishDraft` carries the whole retire now - both identities the
				// press touched (`settleSendComposerRecords`), so the extra settle
				// this arm used to perform on the post-flip identity alone is gone
				// with it.
				store.finishDraft(key, id);
				return id;
			}
			return null;
		}
		/*
		 * NO RETURN PATH FOR THE ROW CASE (S4), AND THAT IS THE BOUNDARY RULE.
		 *
		 * "A failure raised after the optimistic row was painted belongs to the row;
		 * before it, the composer." Everything that reaches this catch was raised
		 * after the paint - the paint is the first thing `admitChatDraft` does, and
		 * the failures that predate it (the send lock, the read window, planner
		 * refusals) never entered this function - so the payload does NOT come home,
		 * and the row the user is looking at carries the class's sentence and its
		 * remedies instead (`chat-page.tsx` renders them from this row; the
		 * transcript line is the existing §F3 surface, generalised from the unknown
		 * class to every one).
		 *
		 * THIS DELIBERATELY REPLACES THE PREVIOUS COMPANY LINE, #495's "a failed
		 * message comes back to the composer": for a POST-PAINT failure that was
		 * one event with two homes - the message on screen AND the same text back in
		 * the box - and the box's copy was the one that could be sent twice. The fix
		 * keeps the message where the user can see it and edits it there (`Edit`
		 * returns the payload; `Send again` replays under the same rules), and leaves
		 * the composer for the failures that were never painted - its copy for those
		 * is unchanged.
		 *
		 * What stays on the row is the payload BASIS (`submittedText` and friends,
		 * written above): a fingerprint for the unchanged-retry rule, not a claim
		 * anybody has to release.
		 */
		/*
		 * AND THE COMPOSER'S OWN RECORDS END WITH THE ATTEMPT (S4).
		 *
		 * `settleInFlight` is this store's "nothing is in flight or waiting" write, and
		 * leaving the record standing would undo the boundary rule three ways: the
		 * row-line's `Edit` calls `returnPayload`, whose guard refuses while `inFlight`
		 * is set (a control that cannot work); `rehydrateInputRows` folds a persisted
		 * `inFlight` back into the box on the next reload, which is exactly the second
		 * home this change moved the message out of; and the record would keep
		 * claiming an attempt the row is already carrying.
		 *
		 * THE MOVE ACROSS THE FLIP IS STILL OWED (U14/Q7), AND IT IS STILL MADE. On
		 * the arm that creates its session mid-send, anything the PRESSED row holds
		 * (text typed during the create hop, a chip attached there) belongs to the
		 * conversation that now exists, and dropping it stranding the user's own
		 * words under an identity no pane shows is the defect U14 measured. So the
		 * records are settled FIRST and `returnInFlight` then performs its move -
		 * with nothing left in flight, its payload fold has nothing to fold, which is
		 * what keeps the message out of the box while the user's own content still
		 * crosses (the design's "`returnInFlight` is not called" is exactly this:
		 * the payload does not come home).
		 */
		const composerTo = composerIdentityFor(key, id ?? draft.sessionId);
		const settleIds =
			paintIdentity && paintIdentity !== composerTo
				? [paintIdentity, composerTo]
				: [composerTo];
		useConversationInputStore.getState().settleInFlight(settleIds);
		if (paintIdentity && paintIdentity !== composerTo)
			useConversationInputStore
				.getState()
				.returnInFlight(paintIdentity, composerTo);
		/*
		 * AND THE REGISTRY'S OWN CLAIM ENDS WITH THE ATTEMPT (UX round 2, U5), the
		 * same statement `settleInFlight` makes directly above: a recorded failure
		 * means the send is NOT alive - `pending` goes false on the row in this same
		 * catch - so the retained entry must stop answering "still going out" the
		 * moment the sentence is stated, rather than waiting for a server read that
		 * may never conclude (an incomplete page proves nothing, and
		 * `resolveHeldFromServer` rightly refuses to conclude from one). The entry
		 * itself STAYS: it is the row's home, and `settled` is exactly the difference
		 * between "kept to paint the row" and "still in flight" (see
		 * `PendingSend.settled`).
		 *
		 * Both identities, because the claim travels: `rowIdentity` is where the row
		 * lives now (the session once the create answered, the pane's key before it),
		 * and `key` covers a draft the re-key has not reached. A settle for an
		 * identity with no entry is a no-op.
		 */
		if (rowIdentity) settlePendingSend(rowIdentity, admissionRequestId);
		if (key !== rowIdentity) settlePendingSend(key, admissionRequestId);
		throw leadingSlash
			? new DesktopControlError(
					422,
					LEADING_SLASH_MESSAGE,
					error,
					LEADING_SLASH_CODE,
				)
			: error;
	}
}

/**
 * One press of a conversation, as the read receipt's re-arm reads it.
 *
 * A RECORD OF THE PRESS, not a flag that a receipt is wanted: the reader has to
 * answer two questions with it - WHICH conversation the operator just opened,
 * and WHETHER it is a press it has already honoured - and a boolean answers
 * neither (`readAckRearm` on the state states the whole rule).
 */
export type ReadAckRearm = { sessionId: string; revision: number };

/**
 * What the read receipt is doing, as the ROW can draw it.
 *
 * Four states rather than three because the reader has to be able to tell them
 * apart, and the reason the receipt exists is that they were the same screen:
 * `pending` is the app retrying now (a contention budget, the ladder's flat
 * window), `offscreen` is the one state a press cannot repair (the completion's
 * result is not on screen, and the anchor hit test - the definition of shown -
 * refuses until it is), `unsettled` is the ladder's own ceiling, where the app
 * is no longer retrying promptly, and `remote` is the pairing's own deferral -
 * the mark lives on another device whose build predates the receipt op, so the
 * state is quiet BY CONSTRUCTION: no ladder budget, no warning, no
 * announcement, and the clause says where the mark lives and what clears it
 * (operator report, 2026-10-05; `isRemoteReceiptDeferral` reads the class, and
 * `read-ack-notice.ts` owns the words). `unsettled` and `pending` are the pair
 * an operator could not distinguish before: both kept the mark and said
 * nothing, one of them while retrying twice a second and the other once a
 * minute (UX round 1, U1).
 */
export type ReadAckNoticeKind =
	| "pending"
	| "offscreen"
	| "unsettled"
	| "remote";

/**
 * The read receipt's own observable state for one conversation.
 *
 * THE RECEIPT'S SECOND JOB. This row's mark is drawn from the backend's state,
 * and until this change the only trace of an acknowledgement that had NOT landed
 * was a `console.warn` - a developer channel - so a receipt the store had
 * refused twice a second and one it had given up retrying looked identical to a
 * row nobody had ever clicked (the operator's own report, and UX round 1's U1:
 * the mark simply stayed). This is the fact the panel draws instead.
 *
 * WHY ONE RECORD AND NOT A MAP. `useCompletionView` runs one loop per open
 * conversation, so there is one conversation a receipt can be waiting on at a
 * time; a second loop replaces the first's statement exactly as a second press
 * replaces the first's stamp (`readAckRearm` above is one record for the same
 * reason). A row that is not this conversation's renders nothing from it.
 *
 * THE LIFETIME IS THE LOOP'S, and the loop clears it on every path out -
 * settled, superseded, dependency change, unmount - because the statement is
 * "the app is trying for this completion" and it stops being true when the
 * attempt no longer exists. This is deliberately the opposite of
 * `readAckRearm`'s "not a timer" rule rather than an exception to it: that rule
 * keeps a GESTURE from being invented, and this record never claims one - it
 * reports what the app did next, which is why the toast (the reader-facing arm)
 * is fired once per budget instead of once per render, and why nothing here is
 * persisted either (`partialize` names its keys).
 */
export type ReadAckNotice = {
	sessionId: string;
	kind: ReadAckNoticeKind;
	/**
	 * Advances on every CHANGE of the pair above, so a reader can tell a new
	 * statement from the same statement seen again - the role `revision` plays for
	 * the press. The panel's toast is keyed on it, which is what keeps the give-up
	 * arm to one announcement per budget rather than one per render.
	 */
	revision: number;
	/**
	 * The refusal, for the states that carry one (`unsettled`, and the quiet
	 * `remote` deferral), exactly as the transport raised it - a FACT rather
	 * than a sentence: the panel CLASSIFIES it and composes this app's own
	 * sentence for the class at the one call site that says sentences
	 * (`features/chat/read-ack-notice.ts`) - the only place here that turns a
	 * desktop failure into words, and the only one that knows a store refusal from a
	 * refusal the store never saw. Absent for the states that are not about a
	 * refusal (`pending`, `offscreen`).
	 */
	reason?: unknown;
};

/**
 * The two axes a catalogue request may be scoped to, matching the wire's closed
 * vocabulary (`catalogueScopeKind` in `shared/desktop-contract.ts`).
 */
export type CatalogueScopeKind = "team" | "agent";

/**
 * The rows the FIRST page of an unscoped catalogue read asks for.
 *
 * 50 RATHER THAN 25, and the number is a decision rather than a tuning knob: the
 * head page must carry every ACTIVE conversation, because `Active chats` is
 * drawn from the rows the client holds and a full page that stopped short of an
 * active row would leave that section silently incomplete. The operator's own
 * sidebar counts 38 active chats, so 50 exceeds the observed population with
 * room to grow. It costs about 30 ms of per-row work over 25 (from the measured
 * 20-to-100 slope) on the one read that is now the whole cost of a refresh.
 *
 * The rows past it are not lost: they arrive from a scope page when a group is
 * expanded, or from the flat list's own tail when it is extended.
 */
export const CATALOGUE_HEAD_PAGE = 50;

/**
 * The rows one expanded group asks for at a time.
 *
 * Smaller than the head page because a group is opened on intent, one at a time,
 * and the tail past this is one press away (`Show more`). The alternative -
 * sizing it like the head - would make each disclosure a bigger read than the
 * whole first paint.
 */
export const CATALOGUE_GROUP_PAGE = 25;

/**
 * The unscoped page size this client asks for when the daemon cannot page.
 *
 * THE PRE-CHANGE REQUEST, byte for byte: against a daemon without
 * `session_catalogue_page` the app makes exactly one unscoped `limit=500` read
 * and renders exactly as it did before paging existed. It is also what the
 * consumers that genuinely need the whole catalogue (the command palette, the
 * MCP section's roster, the browser hand-over dialog) keep asking for, because
 * their question is about the set rather than about the top of it.
 */
export const LEGACY_CATALOGUE_PAGE = 500;

/**
 * The page a caller gets when it asks for "the catalogue" without naming a size.
 *
 * WHY THIS IS A FUNCTION AND NOT THE CONSTANT (round 3, QA's Q-1). The default used to
 * be `LEGACY_CATALOGUE_PAGE` on every daemon, so the most ordinary flow in the app —
 * opening a conversation, whose effect refreshes the catalogue when the conversation's
 * streaming/attention/binding marker moves — fired an unscoped
 * `limit=500&include_archived=true` read. On the operator's store that is the 2.1-4.5 s
 * answer this change exists to remove, and it also threw away the scoped membership the
 * panel had just fetched, leaving `All chats 499` where the head page had been.
 *
 * So the default follows the SAME capability every other paged surface follows: on a
 * daemon that advertises `session_catalogue_page` it is the head page, and on one that
 * does not it is the legacy read, byte for byte — the compatibility promise, kept here
 * as it is kept in the panel.
 *
 * THE FLAG IS PUBLISHED by the surface that already resolves the capability
 * (`chat-sidebar.tsx` calls `setCataloguePageable`) instead of the store reaching for it,
 * because this store is the module every desktop suite bundles to assert anything about a
 * session: importing the renderer's capability hook here would put two more modules in
 * front of every one of those suites, and the flag keeps the store's dependency list -
 * and every fixture's stub list - exactly as it was. It is fail-closed by construction:
 * `false` until a surface says otherwise, which is exactly today's request.
 *
 * AND THAT MAKES AN UNNAMED READ ROUTE-DEPENDENT, which is worth knowing when you read a
 * request log rather than this file: the sidebar publishes the flag when it resolves the
 * capability, so an app launched straight into `/mcp` or `/agents` - where no sidebar has
 * mounted - takes the legacy read until the first `/chat` visit, and every route after
 * that takes the head page. The three callers that mean the SET name it explicitly
 * (`use-palette-sources`, `mcp-management-section`, `browser-hand-over-dialog`), so the
 * difference is confined to whatever else calls this with no argument.
 */
export function cataloguePageDefault(pageable: boolean): number {
	return pageable ? CATALOGUE_HEAD_PAGE : LEGACY_CATALOGUE_PAGE;
}

/**
 * One scope's paging state (`scopes[key]` in the state, keyed
 * `${kind}:${name}`).
 *
 * `ids` is an ID LIST rather than the rows themselves, which is what keeps ONE
 * row store: `sessions` remains the only row array the sidebar, the search and
 * every other consumer reads, and this is membership metadata beside it. The
 * group's ORDER has to come from here and cannot be re-derived, because the wire
 * carries no rank - a client-side re-sort would be a second ordering authority
 * beside the server's (`chat-sections.ts` states the same rule for the sections).
 */
export type CatalogueScopeState = {
	/** The scope's rows, in the server's own order, as ids. */
	ids: string[];
	/** Non-null iff the daemon says more rows exist in this scope after `ids`. */
	nextCursor: string | null;
	/** Single flight: gates the disclosure and the `Show more` row. */
	loading: boolean;
	/** The scope read's own failure, worded by this app. */
	error: string | null;
	/**
	 * The `answerSeq` value the request took at its start.
	 *
	 * The per-scope twin of the global `if (generation !== refreshGeneration)
	 * return;` guard: an answer whose stamp is not the scope's current stamp is
	 * dropped, which is what stops a page asked for before a re-expand from
	 * overwriting the one asked for after it.
	 */
	at: number;
};

/**
 * The unscoped catalogue's own paging state.
 *
 * WHY IT IS NOT JUST A `CatalogueScopeState`. The head has one job a scope does
 * not: it SETTLES facts (`pinFacts`/`archiveFacts` are its alone - see the
 * comment in `fetchSessions`), so it has to know WHICH ids the last answer spoke
 * for. `tailIds` is that record, and it is what keeps a 30 s poll from
 * truncating a list the reader has paged further down: an answer that carries the
 * top 50 rows speaks for the top 50, not for the rows a tail extension fetched by
 * rank. The design note's `head` shape (`cursor`/`complete`/`at`) is all here;
 * `tailIds`, `loading` and `error` are added because the flat list's own tail
 * affordance needs the same three states a group's does.
 */
export type CatalogueHeadState = {
	/**
	 * The ids an EXTENSION fetched (the rows past the head page).
	 *
	 * WHY THE HEAD NEEDS AN ID LIST OF ITS OWN when a scope does not need one.
	 * A page-one answer speaks for the TOP of the catalogue and settles membership
	 * there: a row that has left the top (deleted, archived, re-ranked) must leave
	 * the list. But a reader who extended the flat list holds rows fetched by RANK,
	 * not by position, and the top-fifty answer says nothing about them - so they
	 * are held aside here and survive a page-one answer unless it reaches them.
	 * See `headAnswerRows` for what the answer does with them.
	 *
	 * Empty on the withdrawn path, where there is no cursor and so no extension -
	 * which is what keeps an older daemon's page-one answer REPLACING membership
	 * exactly as it always did.
	 */
	tailIds: string[];
	/**
	 * The ids the LAST head answer carried - the rows the head page itself owns.
	 *
	 * WHY THE HEAD NEEDS THIS when `tailIds` already names its extensions:
	 * collapsing a group drops the rows that group fetched, and a row the head page
	 * ALSO carried is not the group's to drop - the head is still drawing it. The
	 * two kinds are told apart by this list, so `clearScope` removes exactly the
	 * scope's own rows and nothing else (round 1, U5).
	 */
	pageIds: string[];
	/** The next page's cursor, or null at the end of the catalogue. */
	nextCursor: string | null;
	/**
	 * The EXTENSION frontier: the cursor the next `fetchCatalogueTail` continues
	 * from, or null once the walk reached the end.
	 *
	 * WHY IT IS NOT `nextCursor` (QA round 2, Q2). `nextCursor` is the PAGE-ONE
	 * answer's own continuation, and page one is re-read by the poll: the question
	 * "where does the tail continue from" and the question "what did the newest
	 * page-one answer say" have different answers the moment a poll lands, and
	 * reading the second for the first rewound the tail's place while the merged
	 * rows stayed - a press then re-requested a page the client already held,
	 * added nothing, and at human pace (a press every few seconds, a poll every
	 * 30 s) the list never grew.
	 *
	 * `tailStarted` guards the seeding: until an extension has been REQUESTED,
	 * page-one answers seed this value (the reader may scroll before the next
	 * poll); after that only extensions move it, so a page-one answer can neither
	 * rewind nor advance the place a press continues from.
	 */
	tailCursor: string | null;
	/** Whether an extension has ever been requested; see `tailCursor`. */
	tailStarted: boolean;
	/** True once an answer said this is the whole catalogue. */
	complete: boolean;
	/** Single flight for the tail extension. */
	loading: boolean;
	/** The tail extension's own failure. */
	error: string | null;
	/** The `answerSeq` stamp of the last answer this state took. */
	at: number;
};

/** One binding's census row, exactly as the daemon spells it. */
export type CatalogueScopeTotal = {
	kind: CatalogueScopeKind;
	name: string;
	/** Visible sessions in this scope. */
	total: number;
	/** Of those, how many the catalogue classes `active`. */
	active: number;
};

/**
 * The catalogue's per-scope census (`with_counts=true`), or null.
 *
 * THE COLLAPSED BADGE READS THIS rather than the rows the client happens to
 * hold, which is what stops a group that has 434 conversations from advertising
 * the 283 a 500-row page carried. Null when the daemon did not answer a census
 * (the capability is absent, or the request did not ask), and a group then falls
 * back to counting its own rows - which is exactly today's badge.
 */
export type CatalogueScopeCounts = {
	/** Every visible session (the flat list's own size). */
	total: number;
	active: number;
	/** Visible sessions with no attachment binding. */
	unbound: number;
	scopes: CatalogueScopeTotal[];
};

/** `${kind}:${name}` - the key `scopes` is indexed by. */
export function catalogueScopeKey(
	kind: CatalogueScopeKind,
	name: string,
): string {
	return `${kind}:${name}`;
}

/** The ids every loaded scope holds, as one set. */
export function scopeHeldIds(
	scopes: Record<string, CatalogueScopeState>,
): Set<string> {
	const held = new Set<string>();
	for (const scope of Object.values(scopes))
		for (const id of scope.ids) held.add(id);
	return held;
}

/**
 * The ids whose rows a placement fact holds against an answer that cannot carry
 * them (`PlacementFact`): the conversations this window knows live on a peer,
 * which no plain listing can speak for.
 */
export function placementHeldIds(
	facts: Record<string, PlacementFact>,
): string[] {
	const held: string[] = [];
	for (const [id, fact] of Object.entries(facts)) {
		if (fact.locality === "remote") held.push(id);
	}
	return held;
}

/**
 * The ids THIS CLIENT's own state says live on another device.
 *
 * TWO SOURCES, one rule, and they are the same pair `placementHeldIds` reads
 * plus the row's own wire fields: the placement fact a peers-inclusive page
 * settled (`PlacementFact`), and `locality` on a row that a listing carried it
 * for. Both are consulted HERE, where `placementHeldIds` needs only the first,
 * because the bulk receipt's `unknown` bucket names ids that may no longer be
 * rows at all - a fact outlives the row it was written for - and a row can
 * carry a `locality` without a fact that the settle never wrote for it.
 */
export function remoteOwnedIds(
	sessions: CanonicalSessionRow[],
	facts: Record<string, PlacementFact>,
): Set<string> {
	const ids = new Set<string>();
	for (const [id, fact] of Object.entries(facts)) {
		if (fact.locality === "remote") ids.add(id);
	}
	for (const row of sessions) {
		if (row.locality === "remote") ids.add(row.session_id);
	}
	return ids;
}

/**
 * The rows an unscoped answer OWNS: the ones no loaded scope holds.
 *
 * THIS IS THE MOST DANGEROUS DECISION IN THE PAGED CATALOGUE, which is why it is
 * a named function with its own test rather than a condition at the call site.
 * Calling `replaceSessionRows(state.sessions, page)` on a SCOPE answer would
 * delete every row outside that scope - the whole list, every group, the Pinned
 * section - because the answer only speaks for its own scope. A scope answer
 * therefore UNIONS (see `scopeAnswerRows`), and only an unscoped answer rebuilds
 * membership, and only over the rows no scope holds.
 */
export function headHeldRows(
	sessions: CanonicalSessionRow[],
	scopeIds: ReadonlySet<string>,
): CanonicalSessionRow[] {
	if (scopeIds.size === 0) return sessions;
	return sessions.filter((row) => !scopeIds.has(row.session_id));
}

/**
 * The row list a HEAD answer produces, and the tail it still holds.
 *
 * `merge` is `replaceSessionRows`: incoming wins, an absent key is not a claim.
 * It is passed in rather than imported so this stays a decision about MEMBERSHIP
 * while the store keeps the one implementation of what a row's VALUE is.
 *
 * THE ANSWER REPLACES THE HEAD'S MEMBERSHIP, which is what lets a deleted or
 * archived row leave the list, and it holds aside only the rows an EXTENSION
 * fetched (`tailIds`) - those were fetched by rank rather than by position, so a
 * page-one answer cannot speak for them. A page-one answer that replaced the
 * whole head-held set instead would truncate an extended flat list back to the
 * head page on the next 30 s poll, which is the drift insurance editing what is
 * on screen; asking the poll for every row the client holds instead is the
 * multi-second read this change exists to remove. With `tailIds` empty (the
 * withdrawn path, where there is no cursor and no extension) this is exactly the
 * pre-paging rule: the answer replaces every row no scope holds.
 *
 * A row an extension fetched that the new page now carries stops being a tail row
 * (the page speaks for it), and a tail id whose row is gone from the merged list
 * is dropped, so the set cannot accumulate ids nothing draws.
 */
export function headAnswerRows(args: {
	sessions: CanonicalSessionRow[];
	scopeIds: ReadonlySet<string>;
	tailIds: readonly string[];
	/**
	 * Rows the answer may not drop even though it does not carry them: the
	 * conversation the reader has OPEN.
	 *
	 * WHY THIS EXISTS (round 1, R3). Under an unscoped 500-row read the open
	 * conversation was in membership for free - the page was the whole catalogue in
	 * practice. A 50-row head page can stop ABOVE it: a conversation at rank 51 is
	 * neither on the page nor in an expanded group, so a poll would take the row out
	 * from under the reader who is reading it. The rule is the panel's own, the same
	 * instinct as the pinned-row protection at the call site: a conversation the app
	 * is drawing does not leave the list because a page did not carry it.
	 */
	keepIds?: readonly string[];
	page: CanonicalSessionRow[];
	merge: (
		current: CanonicalSessionRow[],
		incoming: CanonicalSessionRow[],
	) => CanonicalSessionRow[];
}): { rows: CanonicalSessionRow[]; tailIds: string[] } {
	const tail = new Set(args.tailIds);
	const keep = new Set(args.keepIds ?? []);
	const pageIds = new Set(args.page.map((row) => row.session_id));
	/*
	 * WHICH ROWS THE ANSWER DOES NOT SPEAK FOR, and there are exactly two kinds.
	 * A row a SCOPE holds belongs to that scope's answer, never to this one -
	 * dropping it here would delete an expanded group's whole page the first time a
	 * poll landed with the group open. A row an EXTENSION fetched was positioned by
	 * rank rather than by the page, so a top-of-the-catalogue answer cannot speak
	 * for it either. Every other head-held row the answer omits has left the
	 * catalogue and goes.
	 *
	 * THE SURVIVORS KEEP THE ORDER THEY HAD, which is why this filters the previous
	 * array rather than concatenating two groups: the panel draws its sections and
	 * its flat list in ARRAY ORDER, so re-bucketing them would re-file every scoped
	 * row to the end of the list under an otherwise unchanged page.
	 */
	const survivors = args.sessions.filter((row) => {
		if (pageIds.has(row.session_id)) return false;
		if (args.scopeIds.has(row.session_id)) return true;
		if (keep.has(row.session_id)) return true;
		return tail.has(row.session_id);
	});
	/*
	 * THE MERGE BASE IS EVERY HELD ROW, and that is a fix rather than a tidy-up
	 * (round 1, R1). The base was `headHeld`, which EXCLUDES every id a loaded scope
	 * holds - so a row the head page carries that an expanded group ALSO holds was
	 * merged against `undefined`, and `mergeRow`'s `heldStatusOver` had nothing to
	 * compare it against. That is precisely the race it exists for: a newer
	 * `session_status` frame for a row that happens to sit in an expanded group was
	 * overwritten by an older page reading. MEMBERSHIP is unchanged - `headHeld` plus
	 * the survivors above; what changed is only what a page row is merged AGAINST.
	 */
	const rows = args.merge(args.sessions, args.page);
	const carried = new Set(rows.map((row) => row.session_id));
	for (const row of survivors) {
		if (carried.has(row.session_id)) continue;
		carried.add(row.session_id);
		rows.push(row);
	}
	return { rows, tailIds: args.tailIds.filter((id) => carried.has(id)) };
}

/**
 * The row list a SCOPE answer produces, and the scope's id list after it.
 *
 * A UNION, never a replacement (see `headHeldRows`): the answer speaks about one
 * binding, so everything else in the store survives it untouched. Rows the store
 * does not carry are appended, which is what makes a group's rows exist at all
 * once the head page is small.
 *
 * `ids` is the SCOPE's order, and a duplicate collapses rather than being
 * re-appended: a cursor walk can re-send a row whose tier moved across the
 * boundary (the design note's accepted imperfection), and the client's merge is
 * keyed by id for exactly that reason.
 */
export function scopeAnswerRows(args: {
	sessions: CanonicalSessionRow[];
	previousIds: readonly string[];
	page: CanonicalSessionRow[];
	merge: (
		current: CanonicalSessionRow | undefined,
		incoming: CanonicalSessionRow,
	) => CanonicalSessionRow;
}): { rows: CanonicalSessionRow[]; ids: string[] } {
	const ids = [...args.previousIds];
	const known = new Set(ids);
	for (const row of args.page) {
		if (known.has(row.session_id)) continue;
		known.add(row.session_id);
		ids.push(row.session_id);
	}
	const rows = [...args.sessions];
	const at = new Map(rows.map((row, index) => [row.session_id, index]));
	for (const row of args.page) {
		const index = at.get(row.session_id);
		if (index === undefined) {
			at.set(row.session_id, rows.length);
			rows.push(row);
			continue;
		}
		rows[index] = args.merge(rows[index], row);
	}
	return { rows, ids };
}

type CanonicalSessionsState = {
	sessions: CanonicalSessionRow[];
	/**
	 * Whether this daemon advertises `session_catalogue_page`, as published by the surface
	 * that resolves the capability (`setCataloguePageable`). It sizes an unnamed catalogue
	 * read - see `cataloguePageDefault` - and is `false` until something says otherwise,
	 * which is the fail-closed direction and also exactly the request this app has always
	 * made.
	 */
	cataloguePageable: boolean;
	/**
	 * Whether this daemon advertises `session_draft_warm`, as published by the
	 * surface that resolves the capability (`setDraftWarmable`). It gates the
	 * mint a NEW chat's first keystroke would spend — see `ensureDraftWarm` — and
	 * is `false` until something says otherwise, which is the fail-closed
	 * direction and also exactly the behaviour every older daemon keeps.
	 */
	draftWarmable: boolean;
	activeSessionId: string | null;
	activeDraftKey: string | null;
	drafts: Record<string, ChatDraft>;
	/*
	 * THERE IS NO `sessionByAgent` HERE, and its absence is the fix (issue #844).
	 * It was declared, initialised to `{}` and carried through persistence, and a
	 * whole-repo search found exactly one reader (`chat-page.tsx`'s route effect)
	 * and no writer anywhere - so `/chat/<agent id>` could only ever land on the
	 * "legacy link" notice, and the palette's agent row built exactly that URL.
	 *
	 * It is REMOVED rather than populated because there is no canonical-chat
	 * binding in this model to fill it from: an agent may have many conversations,
	 * so "the" session for an agent is a question the store has no answer to. The
	 * agent entrance is a DRAFT (`stageDraft({ kind: "agent", name })`, the door
	 * the sidebar and the agent page already use), and the route effect keeps the
	 * honest sentence for genuinely old links.
	 */
	/**
	 * The session the view has moved onto that its own stream has not yet
	 * confirmed exists.
	 *
	 * A send addressed to it is refused (`SESSION_UNVALIDATED_MESSAGE`, the
	 * composer keeps the text) rather than issued at a session that may be gone.
	 * The window used to be closed by a `sessions.get` guard read issued at the
	 * click; that read is gone from the click path (see `openSession`), because
	 * it was a second facade acquire racing the stream for the same bridge
	 * locks and it held the composer shut for 2-20 s behind a busy owner.
	 *
	 * ITS BOUNDS NOW. The stream's first `snapshot` frame closes it -
	 * `confirmSessionLive`, reported by `chat-page` - and that is the same frame
	 * that paints the messages, so the transcript and a working composer arrive
	 * in one commit. A 404 on the subscription ends it the other way
	 * (`confirmSessionMissing`): the id is tombstoned and the pane lands on the
	 * missing-session notice, whose composer refuses on `conversationUnavailable`. Any other terminal stream failure
	 * leaves it open, which is right: the pane states `unavailable` and its Retry,
	 * and a send at a conversation nothing has proven reachable should not be
	 * issued. Switching away (`openSession`, `stageDraft`, `setActiveSession`)
	 * clears or replaces it.
	 *
	 * A window is opened only for a switch that MOVES the view: `openSession`
	 * returns early when the target is already active and no draft is staged. The
	 * one shape that escapes it - the active row clicked while a draft IS staged,
	 * a real move because it leaves the draft - opens a window on a session the
	 * panel is already showing, where the stream effect's `[sessionId,
	 * canonical.status]` deps do not change; `chat-page` therefore also reports
	 * a stream that is ALREADY live when the window opens (its effect reads this
	 * field too), so that shape is closed in the same commit.
	 */
	validatingSessionId: string | null;
	/**
	 * A pin press that did not survive, held until the user presses again.
	 *
	 * The optimistic write is reverted with this, and both halves are the point:
	 * a glyph left lit on a failed write is a claim about durable state the store
	 * does not hold, and a SILENT revert is the "the pin keeps un-pinning itself"
	 * report all over again. It is one record rather than a log because there is
	 * one row under the pointer: a second failure replaces the first, which is
	 * what that user is looking at.
	 */
	pinFailure: PinFailure | null;
	/**
	 * The client's own pin state for conversations its catalogue page may not hold.
	 *
	 * WHY THIS EXISTS BESIDE `sessions`. `replaceSessionRows` rebuilds the row list
	 * from the page payload alone, deliberately: the page is the authority on which
	 * conversations exist, and a row kept past it would be one the backend had
	 * deleted. But `sessions.list` is CAPPED (500 rows, reported as `truncated`),
	 * while the search answer is asked of the whole store - so a conversation the
	 * user just pinned from a search hit is in neither: its row is inserted by
	 * `setSessionPin` and then dropped by the catalogue refresh that very write
	 * triggers. The row then falls back to the cached wire hit, which reports the
	 * state the search last saw, and the next press re-sends the state already
	 * applied - QA round 2's Qr2-1, measured: wire `pinned: true`, store file
	 * holding the id, DOM row `aria-pressed="false"`, and the follow-up press
	 * sending `true` again.
	 *
	 * A pin is a fact this client wrote and the backend confirmed, so it is held
	 * here rather than inferred from a page that cannot carry it. `searchChats`
	 * renders it for a row the catalogue does not list, and the press inverts it,
	 * which is what makes the control's state and the press's direction the same
	 * fact (the round's own requirement).
	 *
	 * Cleared nowhere on purpose: it is one boolean per conversation this window
	 * has pinned, which is bounded by what the user pressed, and a row that
	 * reappears in a later page carries the wire's `pinned` over it by load order
	 * (`mergeRow`: the incoming row wins).
	 */
	pinFacts: Record<string, PinFact>;
	/**
	 * Where this window last knew each conversation to live, keyed by session id
	 * (`PlacementFact` carries why the fact exists and its currency rule).
	 * Written by `settlePlacement` - the create's peer pick and a move's receipt
	 * are its two callers - and settled by a peers-inclusive answer in
	 * `fetchSessions`. Not persisted, like `pinFacts`: it is an ordering against
	 * requests in THIS process, and a restored one would be a claim about a store
	 * the fresh process has not read.
	 */
	placementFacts: Record<string, PlacementFact>;
	/**
	 * The answer counter every fact and every request is stamped against.
	 *
	 * One monotonic sequence over every state-changing event on this client: each
	 * request takes the next value when it STARTS, and each write takes the next
	 * value when it LANDS. So `fact.at < answerSeq-of-this-request` means the
	 * answer is newer than the write and may supersede it, and the reverse order
	 * means the write is newer and the answer must not touch it (`PinFact` has the
	 * reasoning). Writes take their own value rather than reading the current one
	 * so that two writes can never share a stamp and mistake each other for
	 * themselves.
	 */
	answerSeq: number;
	/**
	 * Apply the backend's pin state to one row, optimistically.
	 *
	 * Optimistic rather than refetch-and-wait: `sessions.list` is a WHOLE
	 * catalogue read (measured at ~120 ms median for 200 rows, and the sidebar
	 * asks for 500), so a refetch per press would be visibly slower than the
	 * state change it is confirming. On success the row is reconciled with the
	 * answer's own `pinned`, so a response that disagreed would still win; on
	 * failure the row is put back and `pinFailure` says what happened.
	 *
	 * Returns whether the press stands, for a caller that wants to act on it.
	 */
	/**
	 * Pin or unpin, and INSERT the row when the store does not hold it yet.
	 *
	 * WHY the seed. A conversation reached through the search answer - a hit for a
	 * session this client's page does not list - has no row here, so a press used to
	 * write the backend and change nothing this panel could read: the sidebar kept
	 * drawing the synthesized row from the cached WIRE hit, whose `pinned` no store
	 * write updates, and the next press re-sent the state already applied (QA round 2,
	 * Qr2-1: a pin that could not be undone from the row it was made on).
	 *
	 * So the press carries enough of the row to hold it: from that moment the STORE's
	 * `pinned` is what the control renders and what the press inverts, and the wire hit
	 * is only what a conversation the store has never held is drawn from.
	 */
	beginAnswer: () => number;
	applySearchAnswer: (
		seq: number,
		hits: { id: string; pinned?: boolean; archived?: boolean }[],
	) => void;
	setSessionPin: (
		sessionId: string,
		pinned: boolean,
		seed?: { title?: string; updated_at?: number },
	) => Promise<boolean>;
	/**
	 * Which reads the daemon could not answer on the last successful session
	 * list, in the daemon's own vocabulary (`liveness`, `wakes`, `attention`), or
	 * empty when it answered every one of them.
	 *
	 * WHY it is carried rather than dropped on the floor. A swallowed liveness
	 * read publishes `active: false` for every row, and the sidebar renders that
	 * as "Nothing running right now." - a claim about the machine derived from a
	 * read that FAILED. The field is additive and optional: a daemon that
	 * predates it sends nothing, this stays empty, and every surface renders
	 * exactly as it did before it existed.
	 */
	statusUnavailable: string[];
	/**
	 * One counter, shared by every read this store issues, that orders answers
	 * against writes (see `archiveFacts`).
	 *
	 * A MONOTONIC STAMP RATHER THAN A CLOCK, for the reason `refreshGeneration`
	 * above is a stamp: a clock is comparable across two writers only if they share
	 * one, and the press and the request are already in one process, so a counter
	 * says exactly what is needed - "this read was asked about after that write" -
	 * with no skew to reason about.
	 */
	loading: boolean;
	truncated: boolean;
	/**
	 * The unscoped catalogue's own paging state (see `CatalogueHeadState`).
	 *
	 * NOT PERSISTED, like `sessions` itself: `partialize` names its keys, and a
	 * cursor restored into a fresh process would be a position in a ranking that
	 * process has not read.
	 */
	head: CatalogueHeadState;
	/**
	 * Every scope the client has expanded, keyed `${kind}:${name}`.
	 *
	 * MEMBERSHIP METADATA BESIDE `sessions`, never a second row store: the ids here
	 * say which of `sessions` belongs to which group and in what order, and the rows
	 * themselves stay in the one array every consumer already reads.
	 */
	scopes: Record<string, CatalogueScopeState>;
	/**
	 * The per-scope census a head answer carried, or null.
	 *
	 * Kept across a head answer that did not ask for one (the palette's and the
	 * hand-over dialog's wider reads do not): the census is not a claim about the
	 * page, so a page that is silent about it is not a page that denies it.
	 */
	counts: CatalogueScopeCounts | null;
	error: string | null;
	cwd: string;
	/**
	 * The write path for a DRAFT's staged directory (`DirectoryWritePath`'s
	 * `stage` kind; the composer's chip is the only caller).
	 *
	 * Changing where the first send will run changes what a runtime warmed for the
	 * old directory would have engaged, so the warm intent is dropped with it (see
	 * `ensureDraftWarm`) and the next keystroke re-arms against the new directory.
	 *
	 * EVERY draft row without a session, not just the active one: `cwd` is one
	 * value, read by whatever pane mints and whatever pane sends, while the rows
	 * outlive the pane in front of you (an agent/team-keyed row is reused by
	 * `stageDraft` when the user comes back to it). A row with a session, and a
	 * store with no draft rows at all, takes today's plain write.
	 */
	setCwd: (cwd: string) => void;
	/**
	 * What THIS CLIENT knows about one conversation's archive state, and WHEN it
	 * learned it, keyed by session id.
	 *
	 * A fact exists because the write is OPTIMISTIC: the row leaves the list the
	 * moment the user presses, and every read that follows - a search answer served
	 * from the cache, a catalogue page whose request started before the press - was
	 * asked before the backend held the new state. The `at` stamp is the currency
	 * that orders them: an answer that SPEAKS about the id (`applySearchAnswer`, or
	 * a newer page) supersedes a fact older than the answer's own request, while a
	 * fact written after that request survives it. Without the stamp the fact would
	 * outrank every later answer, so an unarchive made in the terminal would leave
	 * the conversation hidden here forever - the two-way claim this work exists for.
	 *
	 * The stamp is taken when the REQUEST STARTS, never when its answer lands:
	 * comparing arrival times would let an answer that predates a press supersede
	 * it, which is the same defect on a shorter clock.
	 */
	archiveFacts: Record<string, ArchiveFact>;
	/**
	 * The conversations THIS WINDOW must not draw, keyed by session id (see
	 * `ForgottenFact`): the ones it permanently deleted, and the ones a read proved
	 * are gone. Written by `forgetSession` (from the delete) and by
	 * `confirmSessionMissing` when a switch's own stream answers not-found.
	 *
	 * Read by three surfaces, all of them for the same reason - a delete must not be
	 * undone by an answer that predates it: the catalogue page filters its rows
	 * through it, the search joins (the sidebar's and the palette's) drop the hits
	 * that name a forgotten id (a cached answer can outlive the delete by its 30 s
	 * `staleTime`), and the pane reads it to land on the existing missing-session
	 * notice instead of a writable draft bound to an id that is gone.
	 *
	 * SETTLED BY A RESURRECTION AND NOTHING ELSE: a page that outranks the record and
	 * carries the id back (agent review round 2, R2-1).
	 */
	forgotten: Record<string, ForgottenFact>;
	/**
	 * The last archive press the backend did not accept, or null.
	 *
	 * Drawn as an ordinary toast - with a Retry - by the always-mounted
	 * `components/undo-toasts.tsx`, under the same id as the offer whose press it
	 * answers: the sentence replaces the message the press was made on, in place.
	 */
	archiveFailure: ArchiveFailure | null;
	/**
	 * The undo offer a successful archive stands, or null.
	 *
	 * IN THE STORE BECAUSE THE STORE IS WHAT SETTLES THE WRITE (design round 8,
	 * D27): the accepted departure and this value land in one update. It is drawn
	 * as an ordinary sonner toast (`components/undo-toasts.tsx`, mounted by
	 * `main.tsx` beside the global container) since the operator's request of
	 * 2026-09-27 - "we should probably just use the normal sonner toast" - with the
	 * trade design round 2's D12 measured and the operator re-accepted: a
	 * bottom-right toast can sit over the composer's Send control (x 1001..1360.5,
	 * y 789..842.5 against Send at x 1307..1339, y 803..835), which is why the offer
	 * lived in a sidebar register, and then a sidebar lane, between then and now;
	 * both registers were retired in favour of the standard one.
	 *
	 * The RETIREMENT RULE is unchanged and lives with the offer
	 * (`features/chat/archive-undo.ts`): the offer stands while the conversation
	 * still holds the state the offer was taken from, and it is retired the moment
	 * this client knows it does not.
	 */
	archiveUndo: ArchiveUndoOffer | null;
	/**
	 * The undo a discard stands, snapshot and all (`DraftsUndoOffer` above): the one
	 * slot the app-level toast reads (`components/undo-toasts.tsx`; the copy helpers
	 * are `features/chat/drafts-undo.ts`'s) and `restoreDraftsUndo` consumes.
	 */
	draftsUndo: DraftsUndoOffer | null;
	/**
	 * The bulk acknowledgement's deferral: how many of a "Mark all as read" press's
	 * marks live on a device whose build cannot answer the receipt yet, and the write
	 * stamp the raise carries (`at` - the identity check the toast surface reads, the
	 * offers' own rule).
	 *
	 * WHY IT LIVES IN THE STORE RATHER THAN THE PANEL (agent review round 2, B2 = QA
	 * round 2, Q3): the archive guard's toast discipline bans a raiser in
	 * `chat-sidebar.tsx` (`showInfoToast(` wholesale), because a message raised from
	 * the panel is a second, unmountable copy of a class the app draws from its
	 * always-mounted surface. The panel writes this slot; `components/undo-toasts.tsx`
	 * raises `markAllReadDeferredSentence` from it - once, on the non-error register
	 * (operator report, 2026-10-05: a deferral is not an error) - and clears the slot
	 * when the message ends.
	 */
	bulkReadDeferral: { count: number; at: number } | null;
	/**
	 * The freshly staged draft key a discard left the pane on, or null (UX round 2's U7).
	 *
	 * THE PANEL WRITES IT; THE TOAST READS IT (2026-09-27). It was a ref inside
	 * `chat-sidebar.tsx`, back when the offer's Undo press lived in that file too;
	 * the press now lives on the always-mounted toast surface
	 * (`components/undo-toasts.tsx`), and this is the value that lets it re-open the
	 * restored draft when the pane still shows the fresh one the discard staged -
	 * the writer and the reader can no longer share one component's memory.
	 */
	stagedByDiscard: string | null;
	/**
	 * Record - or clear - the undo offer a successful archive stands.
	 *
	 * The offer's own module owns WHEN it is retired; this is only the write.
	 */
	setArchiveUndo: (offer: ArchiveUndoOffer | null) => void;
	/**
	 * Record — or clear — the undo offer a discard stands.
	 *
	 * The write only, matching `setArchiveUndo` above; WHEN it retires is the
	 * message's own end's business (`components/undo-toasts.tsx` clears the slot
	 * when the toast ends, whichever way it ends).
	 */
	setDraftsUndo: (offer: DraftsUndoOffer | null) => void;
	/**
	 * Raise the bulk acknowledgement's deferral for `count` marks, stamped off
	 * `answerSeq` (the currency every toast surface reads).
	 *
	 * The write only, matching `setDraftsUndo` above: WHEN the slot clears is the
	 * message's own end's business (`components/undo-toasts.tsx` clears it when the
	 * toast ends, whichever way it ends).
	 */
	raiseBulkReadDeferral: (count: number) => void;
	/** Clear the bulk deferral's slot - the message's own end, or its replacement. */
	clearBulkReadDeferral: () => void;
	/**
	 * Put a standing offer's snapshot back: the draft entries and the composer rows
	 * the discard removed, in one update.
	 *
	 * A KEY THAT EXISTS AGAIN IS LEFT AS IT STANDS, and so is a composer row that
	 * holds text the reader typed since: a team/agent draft's key is STABLE
	 * (`draft:team:<name>`), so the same pane can be re-staged inside the offer's
	 * lifetime, and the newer state is exactly what an undo must not overwrite.
	 * What is skipped is skipped silently; the offer retires either way, because it
	 * was pressed.
	 */
	restoreDraftsUndo: () => void;
	/**
	 * Record — or clear — the key a discard staged in the pane's place.
	 *
	 * The write only, matching `setDraftsUndo` above: what consumes it is the undo
	 * press (`components/undo-toasts.tsx`).
	 */
	setStagedByDiscard: (key: string | null) => void;
	/**
	 * Publish whether the daemon can page, so an unnamed catalogue read can size itself.
	 *
	 * A no-op when the value has not moved: this is called from a render-adjacent effect on
	 * every capability change, and a store write per render would re-render every subscriber
	 * for nothing.
	 */
	setCataloguePageable: (pageable: boolean) => void;
	/**
	 * Publish whether the daemon can warm a new chat's draft, so the composer's
	 * keystroke can mint one. A no-op when the value has not moved, for the same
	 * reason `setCataloguePageable` is: this is called from an effect on every
	 * capability change.
	 *
	 * The false -> true transition also RE-ARMS the active draft when it already
	 * holds text (review round 1, MINOR-1): the keystroke's edge can fire before a
	 * cold-start capability read answers, and the mint would otherwise be skipped
	 * for the whole message.
	 */
	setDraftWarmable: (warmable: boolean) => void;
	/**
	 * Clear the refusal once its message's turn on the toast surface is over.
	 *
	 * THE WRITE ONLY, matching `setArchiveUndo` above rather than adding a third policy: the
	 * toast surface owns the drawing decision (which message is the newest word, and so when
	 * an older one has been superseded), and U10 is what happens when the VALUE outlives its
	 * message - the refusal was re-printed every time a newer message retired, because the
	 * message's end cleared the drawing and not the value. Nothing else reads this field:
	 * what reverts the row is the fact `setSessionArchived` already recorded, and what
	 * announces it is the control's own flip, so clearing the sentence takes no affordance
	 * with it.
	 */
	clearArchiveFailure: () => void;
	/**
	 * The conversation a danger dialog is asking about, or null.
	 *
	 * In the STORE rather than in the component that draws the dialog, because two
	 * surfaces ask the same question and must reach ONE dialog: the header's session
	 * menu, and a typed `/delete` (which is dispatched from the composer, a
	 * different subtree). A second dialog would be a second confirmation flow to
	 * keep in step with the first.
	 */
	deleteCandidate: string | null;
	/**
	 * The conversation an ARCHIVE confirmation is asking about, or null.
	 *
	 * A second candidate rather than a shared one with a `kind`: the two dialogs ask
	 * different questions with different copy and different buttons (`Archive` is not
	 * dangerous and `Delete` is), and a shared slot would let one act's confirmation
	 * be replaced by the other's while it is open.
	 */
	archiveCandidate: ArchiveConfirmCandidate | null;
	/**
	 * Stage or clear the archive confirmation. `null` closes it without asking
	 * anything, which is what every cancel path does.
	 */
	requestArchiveConfirm: (candidate: ArchiveConfirmCandidate | null) => void;
	/**
	 * Archive or unarchive one conversation: the optimistic write, its currency
	 * stamp, and the revert-and-report path when the backend refuses.
	 *
	 * `title` is only what a failure SENTENCE needs to name the row the user
	 * pressed, since a conversation this client does not list has no row to read a
	 * title off.
	 */
	setSessionArchived: (
		sessionId: string,
		archived: boolean,
		title?: string,
	) => Promise<boolean>;
	/**
	 * Delete ONE conversation, permanently. Never optimistic: the row is dropped
	 * only after the backend confirms, and the drop is recorded as a TOMBSTONE
	 * (`forgotten`) rather than as a plain removal from the array, because an answer
	 * whose request started before the delete would otherwise restore the row.
	 */
	deleteSession: (
		sessionId: string,
	) => Promise<{ ok: true } | { ok: false; detail: string; guarded: boolean }>;
	requestSessionDelete: (sessionId: string | null) => void;
	fetchSessions: (limit?: number, withCounts?: boolean) => Promise<void>;
	/**
	 * Extend the UNSCOPED list by one page, along the extension's own frontier
	 * (`head.tailCursor`, not `head.nextCursor` - see that field's note for the
	 * poll-rewind this distinction exists to prevent).
	 *
	 * The flat chat list's own tail affordance (§5.4): one container, one scope,
	 * one sentinel, so "extend" has exactly one meaning. Single flight against
	 * `head.loading`, and it does nothing when the walk has reached the end or a
	 * page is in the air.
	 */
	fetchCatalogueTail: () => Promise<void>;
	/**
	 * Discard one group's loaded page, so the next expansion re-reads the scope
	 * from its TOP.
	 *
	 * COLLAPSING A GROUP IS WHAT MAKES THE CURSOR'S ACCEPTED IMPERFECTION
	 * REPAIRABLE. A cursor is a position, not a snapshot: a row whose tier changes
	 * between two page reads can be skipped in that group's list for that
	 * expansion. Re-expanding is the remedy - it discards the ids and starts again
	 * from the scope's own first page - and this is that discard. The sidebar calls
	 * it as a group closes, which is also where it belongs on its own terms: the
	 * reader's next expansion is a fresh question, and there is no reason to answer
	 * it from a page fetched minutes ago.
	 *
	 * THE ROWS ARE NOT REMOVED from `sessions`; only membership metadata is. They
	 * become head-owned again, which is exactly what they were before the group was
	 * ever opened, and the next head answer settles them like any other row.
	 */
	clearScope: (kind: CatalogueScopeKind, name: string) => void;
	/**
	 * Read ONE group's rows - the first page on first expand, the next page when
	 * the group's `Show more` row is pressed.
	 *
	 * `cursor` is the group's `nextCursor`, or null for the scope's first page. The
	 * group pages INDEPENDENTLY: a poll, a focus and a `catalogue` frame all refresh
	 * the unscoped head only, and never re-fetch a loaded scope (re-fetching every
	 * expanded group on every frame would reproduce, per group, the amplification
	 * this change exists to remove).
	 */
	fetchScopePage: (
		kind: CatalogueScopeKind,
		name: string,
		cursor?: string | null,
		limit?: number,
	) => Promise<void>;
	createSession: (
		cwd: string,
		target?: ChatTarget,
		requestId?: string,
		/** The draft's own model pick, when it has one; omitted otherwise. */
		model?: DesktopModelSelection | null,
		/**
		 * The minted draft this conversation was warmed on, when it has one:
		 * the create adopts the id (and the already-engaged runtime) instead of
		 * minting fresh. Omitted — byte-for-byte today's request — when the
		 * pane never minted, and an id the daemon cannot resolve mints fresh
		 * rather than failing the send (see `ensureDraftWarm`).
		 */
		draftId?: string,
		/**
		 * The device to create the conversation ON, when the pane's device control
		 * picked a peer (`features.peers`). Omitted otherwise, and the request body
		 * then carries no `peer` at all - see the implementation's own note.
		 */
		peer?: string,
	) => Promise<string | null>;
	/**
	 * The turns THIS WINDOW stopped, by session id, stamped in wall-clock ms.
	 *
	 * A CLIENT-SIDE FACT, and that is the whole of its point (UX round 2, U7). When
	 * the user presses `Esc` the runtime kills the call in flight, and the tool that
	 * was running then reports a REAL failure — its process died — which the row
	 * classifies as `error` and paints in `danger` as `failed`. The backend is
	 * telling the truth about the process and the wrong thing about the turn: the
	 * user stopped it, and blaming the agent for the user's own decision is exactly
	 * what `tool-row.tsx`'s `interrupted` state exists to say. Nothing on the wire
	 * distinguishes the two, so the fact is recorded where the press happened.
	 *
	 * LIFETIME IS EXACTLY ONE TURN: written when an `interrupted` receipt arrives,
	 * cleared when the next turn begins (the same `busy` edge that retires the stop
	 * notice). It is NOT persisted — it describes a run that is over by the time the
	 * window closes, and a restored fact would reclassify a later turn's honest
	 * failure.
	 */
	stoppedTurns: Record<string, number>;
	/** Record that this window stopped a session's turn, at `at` (default: now). */
	markTurnStopped: (sessionId: string, at?: number) => void;
	/** Clear it — the next turn's arrival, or a session being left. */
	clearTurnStopped: (sessionId: string) => void;

	setActiveSession: (sessionId: string | null) => void;
	/**
	 * Close the validation window because the session's own stream proved it
	 * exists (its `snapshot` landed).
	 *
	 * The window's only positive bound now - see `validatingSessionId`. Guarded
	 * on the id, so a snapshot belonging to an abandoned target cannot vouch for
	 * the session the user is actually on.
	 */
	confirmSessionLive: (sessionId: string | null) => void;
	/**
	 * The validation window's NEGATIVE bound: the session's own stream answered
	 * 404, so the conversation is gone. Tombstones it (`forgetSession`) and closes
	 * the window, leaving the view on the target so the missing-session notice
	 * explains it - the arm `openSession`'s guard read used to take on its own
	 * not-found. Guarded on the window's id for the same reason as
	 * `confirmSessionLive`: only a switch still waiting on its proof may be told
	 * the answer, so a 404 on some later reconnect is left to the stream's own
	 * `missing` state rather than rewriting the catalogue.
	 */
	confirmSessionMissing: (sessionId: string | null) => void;
	/**
	 * The operator's own gesture: "I am looking at this conversation now".
	 *
	 * WHY IT IS A GESTURE AND NOT A TIMER. Nothing about a mount, a focus change
	 * or the passage of time says a person is reading a result, and the receipt
	 * `useCompletionView` sends is a claim that they are - so the only thing that
	 * can re-arm a receipt the retry ladder had pushed out is an act with the
	 * operator behind it. Every call to `openSession` stamps it, which is exactly
	 * the act the reported defect is about: "click into it = mark it read".
	 *
	 * WHICH OPENS STAMP IT, named rather than implied (agent review round 1, N2;
	 * UX review round 1, N1). A press is the common case and not the only one: the
	 * sidebar's row selection, the palette's selection and a scheduled row's "open
	 * in chat" all reach `openSession`, and so does the route-to-store reconcile
	 * behind a deep link, a Back, or any external `/chat/<id>` write
	 * (`chat-page.tsx`'s route effect, `open-conversation.ts`,
	 * `schedules-page.tsx`). Saying so here rather than leaving the narrower claim
	 * in place is the honest form of the rule, because what makes all of them
	 * admissible is what the stamp CANNOT do: it releases a deferral and resets a
	 * budget, and it touches no attempt gate - readiness, selection, focus and the
	 * rendered-anchor hit test are all still asked at attempt time. It cannot
	 * receipt a result nobody was shown, and every one of those paths IS this app
	 * showing the operator that conversation.
	 *
	 * ONE RECORD, not a log, for the reason `pinFailure` is one: there is one row
	 * under the pointer, and a second press replaces the first rather than
	 * queueing behind it. The `revision` is what makes two presses of the SAME row
	 * two events rather than one truthy value.
	 *
	 * Deliberately NOT persisted (`partialize` names its keys): a press that
	 * happened before a reload was honoured by the process that saw it, and a
	 * restored stamp would be a gesture this window never witnessed.
	 */
	readAckRearm: ReadAckRearm | null;
	/**
	 * Stamp one press of a conversation for the read receipt's re-arm.
	 *
	 * Called by `openSession` on EVERY open, including the open of the row the view
	 * is already on (the field above names the callers, since a press is not the
	 * only one). That re-open is a no-op for the switch itself (see the action's own
	 * comment) and the one shape the reported defect turns on: the operator's remedy
	 * for a mark that did not clear is to click the row again, and an acknowledgement
	 * whose retry had been pushed out by the shared ladder is what that click has to
	 * release.
	 */
	rearmReadAck: (sessionId: string) => void;
	/**
	 * What the read receipt is doing for one conversation, or nothing.
	 *
	 * Written by `useCompletionView` while it has a loop for that conversation, and
	 * read by the sidebar's rows - the surface the mark is on. See `ReadAckNotice`
	 * for the states, the lifetime rule and why there is exactly one record.
	 */
	readAckNotice: ReadAckNotice | null;
	/**
	 * Publish the receipt's own state for one conversation.
	 *
	 * IDENTITY-PRESERVING on an unchanged `(sessionId, kind)` pair, because the
	 * caller is a 500 ms poll: a notice that is published on every tick would
	 * re-render every row of the panel twice a second, and an operator who has left
	 * the receipt deferred wants exactly nothing to happen. A CHANGED pair (a new
	 * kind, or another conversation) advances `revision`, which is what a reader
	 * compares to tell a new statement from the same one seen again - the role
	 * `rearmReadAck`'s own revision plays for the press.
	 */
	publishReadAckNotice: (
		sessionId: string,
		kind: ReadAckNoticeKind,
		reason?: unknown,
	) => void;
	/**
	 * Withdraw the receipt's state for one conversation, if it is that one's.
	 *
	 * Guarded on the id rather than clearing unconditionally, because the writer is
	 * a loop that outlives renders and can be torn down after the view has moved
	 * on: an unconditional clear would let the receipt of an abandoned conversation
	 * delete the statement of the one the operator is looking at now.
	 */
	clearReadAckNotice: (sessionId: string) => void;
	/**
	 * Merge one machine-wide `attention` frame into its row.
	 *
	 * This is the unseen mark's ARRIVAL path. It used to be a 5 s
	 * `sessions.list` poll, which re-read a transcript-tail preview per row to
	 * learn one boolean; the feed now carries the delta as it happens, so the
	 * mark lands on the event instead of on a timer.
	 *
	 * A frame for a session the catalogue does not know is DROPPED rather than
	 * inserted: the feed's frames are live-only and the catalogue's membership is
	 * a separate question (a new session directory is what the `catalogue`
	 * invalidation exists for). Inserting here would create a row with no title,
	 * no binding and no status — a sidebar entry for something the user cannot
	 * identify.
	 */
	applyAttention: (sessionId: string, attention: CompletionAttention) => void;
	/**
	 * Merge MANY attention states in one commit, for the bulk receipt.
	 *
	 * The session id comes from each state's own `conversation_id`
	 * (`session/<id>`) rather than from a caller argument, because a bulk answer
	 * carries nothing else that names the row: the buckets are `superseded`/`unknown`
	 * ids and post-write states, and pairing them positionally with the request
	 * would make the response's order part of the contract, which it is not. A
	 * state whose conversation is not in the catalogue is DROPPED, on the same
	 * membership rule `applyAttention` above documents, and a state that merges to
	 * what the row already holds is identity-equal and re-renders nothing.
	 *
	 * One `set`, so a batch of N acknowledgements is ONE commit and one repaint:
	 * N separate `applyAttention` calls would re-render the 500-row sidebar N
	 * times for one user gesture.
	 */
	applyAttentionMany: (states: CompletionAttention[]) => void;
	/**
	 * Clear the unread marks THIS CLIENT holds, in one call.
	 *
	 * The set is enumerated from the store's own rows and is TOKEN-bound: a row
	 * is sent only when it is DRAWING an outstanding completion mark
	 * (`unreadMarkKind`) AND carries a `completion_token`, so the batch names
	 * exactly the completions this client rendered — a completion published after
	 * the render is not in it and stays unread, a mark with no token (which names
	 * no completion) is neither sent nor counted, and a row whose live state has
	 * taken it over (busy, wedged, a parked gate) is not in the batch at all:
	 * acknowledging a completion the reader was never shown would clear a mark
	 * that could then never appear, because an acknowledgement is the only thing
	 * that clears `unseen`.
	 *
	 * NOTHING IS WRITTEN LOCALLY UNTIL THE ANSWER ARRIVES. There is no optimistic
	 * clear at any point, which is what makes a failed request leave nothing to
	 * roll back, and the answer's `read` bucket is the only thing applied — a
	 * `superseded` or `unknown` row stays unread, because the backend refused it
	 * and the user's marks must not disagree with the store that owns them. The
	 * counters are returned rather than toasted here so the SURFACE decides the
	 * copy, and it can name the remainder instead of claiming everything cleared.
	 *
	 * `deferred` IS CARVED OUT OF `unknown`, not added beside it: a conversation on
	 * another device has no completion in THIS root's attention store, so its item
	 * can only answer `unknown` - the truthful bucket, and the wrong sentence, since
	 * the surface's remainder copy would report a deferral as a failure ("could not
	 * be cleared"). `deferred` therefore names the subset of `unknown` this client
	 * knows lives on another device (`remoteOwnedIds`), so the copy can say those
	 * clear when that device updates (operator report, 2026-10-05).
	 */
	markAllRead: () => Promise<{
		attempted: number;
		cleared: number;
		superseded: number;
		unknown: number;
		deferred: number;
	}>;
	/**
	 * Apply one `session_status` frame to its row, and retire a dead epoch's stamps.
	 *
	 * This is the STATUS's arrival path, the counterpart of `applyAttention`
	 * above and for the same reason: the row's status used to be delivered only by
	 * a whole-catalogue read, so an answered gate or a completed turn waited for
	 * the 30 s safety poll (or a window focus, or the chat page's own marker
	 * effect on the one row it is showing). The frame carries the backend's
	 * DERIVED pair, so nothing here derives anything — it writes the value and the
	 * stamp, and the stamp is what lets a slower list response be ordered against
	 * it rather than racing it.
	 *
	 * THIS ACTION ORDERS NOTHING, deliberately: frames arrive in publication order
	 * on one socket, which is the transport's guarantee to keep and not a fact
	 * worth re-deriving here. A frame is therefore trusted as it arrives, and the
	 * epoch gate below is not an ordering rule but a restart's bookkeeping - the
	 * only place a restart can make two counters incomparable. Adding a per-row
	 * revision comparison HERE would be a second implementation of an order the
	 * client already receives in order, and it would have to invent an answer for
	 * the gaps a socket does not promise to close.
	 *
	 * `epoch` is the emitting feed PROCESS's, and a frame carrying an epoch this
	 * store has not stamped rows with before means every row's stamp was minted by
	 * a process that is gone. Their revisions are counters from a dead run, so
	 * they are retired before the write. What that buys is stamp HYGIENE, and it is
	 * worth being precise about it, because the obvious justification is wrong: a
	 * row left holding a dead epoch's counter would NOT have pinned anything,
	 * since `heldStatusOver` requires epoch equality before it compares a single
	 * number, and a live response is stamped with the live process's epoch - so
	 * the response wins with or without this reset. What the reset prevents is a
	 * row advertising a counter that no live process will ever mint: state that
	 * reads as ordering evidence and is not, which is what a future reader would
	 * reason from. It does decide an order in one narrow case, and the decision
	 * goes the other way: a list response from the dead process that lands AFTER a
	 * frame from that same dead process is refused without the reset (correctly -
	 * it is the older of the two) and accepted with it, because the stamp it would
	 * have been compared against is gone. Taken knowingly: a dead process's answer
	 * is being superseded by a live one either way, and hygiene is the better trade
	 * against the alternative of leaving dead counters on screen.
	 *
	 * A frame for a session the catalogue does not know is DROPPED, exactly as an
	 * attention frame is: insertion would make a sidebar row with no title and no
	 * binding, and membership is the catalogue's question.
	 */
	applySessionStatus: (
		sessionId: string,
		status: SessionCatalogueStatus,
		revision: number,
		epoch: string,
	) => void;
	openSession: (sessionId: string) => Promise<boolean>;
	stageDraft: (target?: ChatTarget, fresh?: boolean) => string;
	/**
	 * Re-stage the pane's ACTIVE draft under a picked identity, carrying the
	 * box's text across the key flip. See the action's own comment for why the
	 * flip is a remount and why the text has to move with it (issue #780).
	 */
	restageDraft: (target: ChatTarget, carry?: string) => string;
	/**
	 * Switch to a draft this store already holds, by key. See the action's own
	 * comment for why this is not `stageDraft` (UX round 2, U8).
	 */
	openDraft: (key: string) => void;
	updateDraft: (key: string, patch: Partial<ChatDraft>) => void;
	/**
	 * The new-chat pane's first keystroke: mint the id its runtime is warmed on
	 * (`sessions.draft`), fire-and-forget, once the backend advertises
	 * `session_draft_warm`.
	 *
	 * Fire-and-forget BY DESIGN: nothing on the send path waits on it, and a mint
	 * that fails (or never fires) leaves the send engaging inline exactly as it
	 * always did. It no-ops when the daemon does not advertise the capability (the
	 * flag above), when the pane has no settled directory to mint against, when it
	 * already has a `warmId`, or once its session exists. The request id is the
	 * row's `draftRequestId`, so a retry replays the same mint rather than
	 * registering a second draft; the id and the request id together are dropped
	 * when the selection changes before the send.
	 */
	ensureDraftWarm: (key: string) => void;
	/**
	 * Record — or clear — the model a NEW conversation will be born on.
	 *
	 * A dedicated action rather than a bare `updateDraft("model")` because of the
	 * receipt: the server keys its at-most-once receipt on a hash of the WHOLE
	 * create body (`desktop_receipts.py`), so re-sending the same
	 * `createRequestId` with a different `model` is a 409 forever. A changed
	 * selection is therefore a changed intent, and it gets a fresh request id —
	 * scoped to the pre-session state, since once a session exists the create is
	 * already behind us and its id must stay pinned for an idempotent replay.
	 *
	 * The same change drops the draft's warm intent (`warmId`): v1 does not re-aim
	 * a runtime engaged for the previous selection, so the next keystroke mints
	 * fresh and the send (if it beats that mint) creates without a draft id.
	 */
	setDraftModel: (key: string, model: DesktopModelSelection | null) => void;
	/**
	 * Record — or clear — the DEVICE a NEW conversation will be created on.
	 *
	 * A dedicated action rather than a bare `updateDraft("peer")` for exactly the
	 * reason `setDraftModel` above gives, one field over: `peer` rides the create
	 * body (`desktop-contract.ts`), and the server keys its at-most-once receipt on a
	 * hash of that WHOLE body (`desktop_receipts.py`), so re-sending the same
	 * `createRequestId` after the destination changed is a `ReceiptConflict` forever.
	 * Two mesh refusals KEEP the claim rather than releasing it
	 * (`_CREATE_UNCONFIRMED_CODES`: `relay_unavailable`, `peer_unreachable`), and a
	 * device that answered the last read and stopped answering at send time is
	 * exactly that case — the refusal this control ships a notice for. A changed
	 * destination is a changed intent, so it gets a fresh create id. `null` means
	 * this device, and choosing this device after picking a peer is a change too.
	 */
	setDraftPeer: (key: string, peer: string | null) => void;
	finishDraft: (key: string, sessionId: string) => void;
	/**
	 * Abandon a stuck send. The retained payload is the user's own text, so the
	 * only safe owner of that decision is the user: we drop our claim that the
	 * next send must match it, and never touch the session or its transcript.
	 */
	discardDraft: (key: string) => void;
	/**
	 * Discard several drafts in ONE store update — the sidebar's "Clear all".
	 *
	 * A batch rather than a caller-side loop: each discard is its own state update,
	 * and a loop would repaint the list once per row and unmount the very control
	 * the reader pressed, mid-loop. Every key is discarded with `discardDraft`'s own
	 * semantics — including the composer-side clear — so the two doors cannot
	 * drift.
	 */
	discardDrafts: (keys: readonly string[]) => void;
	/**
	 * Resolve a held send against the server's own answer (§F2's last bullet,
	 * UX round 1's U5b).
	 *
	 * Called with the PAGE a re-subscribe returned — the snapshot's history page or
	 * the reconnect's tail read, i.e. the server's statement of what this
	 * conversation holds. A held payload the answer NAMES landed (the claim ends;
	 * the durable row coalesces with the echo by id). A held payload it does not
	 * name proves it did NOT land only when the read can actually see back to it:
	 * silence is a verdict about REACH as much as about absence, and `complete`
	 * alone is the page's CONTINUITY (`!cursor_missing`), not how far back it
	 * goes (issue #847). Either way the composer stops waiting: §F2 says the state
	 * clears from the server's acknowledgement, never from the local send, and
	 * this is the acknowledgement arriving.
	 *
	 * THE ENTRIES ARE THE PAGE'S OWN ROWS rather than a bare id list, because the
	 * verdict needs the page's oldest stamp — a caller handing over ids alone
	 * could not state how far back its read reached, which is what a
	 * continuity-only signature let both pane callers do.
	 */
	resolveHeldFromServer: (
		sessionId: string,
		entries: readonly HeldClaimPageEntry[],
		complete: boolean,
	) => void;
	/**
	 * Retract a recorded `undelivered` verdict that a later read DISPROVED.
	 *
	 * The repaint guard's one write (issue #847): when the loaded transcript
	 * already holds the owner's row under the verdict's `recordId`, the message
	 * reached the conversation and the record is a falsehood about it. Nothing
	 * else retracts one — the delivery rule above clears it only when a read NAMES
	 * the id, and the read that WROTE the verdict is exactly the read that could
	 * not see that far back.
	 */
	retractUndelivered: (draftKey: string, recordId: string) => void;
	bindSession: (legacyAgentId: string, sessionId: string) => void;
	upsertSession: (row: CanonicalSessionRow) => void;
	/**
	 * SETTLE A ROW'S PLACEMENT FROM A MOVE'S RECEIPT **OR A CREATE'S PEER PICK**
	 * (see the implementation for why the receipt and not the ask). `locality`/
	 * `owner_device` only: the placement pair is the whole of what a receipt says
	 * about the row - and the write lands the pair AND the placement fact
	 * together (`PlacementFact`), so the row and the fact cannot disagree.
	 */
	settlePlacement: (
		sessionId: string,
		placement: { locality: "local" | "remote"; owner_device: string },
	) => void;
	/**
	 * MERGE A PEERS-INCLUSIVE CATALOGUE ANSWER INTO THIS STORE: settle the
	 * placement facts it speaks about, list its REMOTE rows, and drop the remote
	 * rows whose owner answered and did not carry them.
	 *
	 * WHY THIS EXISTS BESIDE `fetchSessions`. The sidebar's own poll must never
	 * carry `include_peers` (it would dial every peer's relay on the sidebar's
	 * timer), so the federated answer arrives from its own ambient read
	 * (`features/mesh/peers-catalogue.tsx`) - and that read lands HERE rather
	 * than beside the list, so the sidebar, the bins and the row component all
	 * read ONE catalogue whose membership rules stay this module's.
	 *
	 * THE RULES, in the order they are asked:
	 *
	 *   1. SETTLEMENT. A fact this answer speaks about - the id is present, with
	 *      the wire's own pair - is rewritten with a fresh sequence, exactly as
	 *      `fetchSessions`' own settle loop does and for the same reason: a fact
	 *      written after this answer's REQUEST started (`requestedAt`, the
	 *      `beginAnswer` stamp) is left alone, so a create or a move landing
	 *      across the read cannot be undone by it. A REMOTE row and no fact is
	 *      the other half of the same rule - the answer is how this store first
	 *      learns the row, so the answer is what WRITES ITS HOLD; without one the
	 *      next plain page would drop the row it just learned (the mechanism
	 *      #837's `PlacementFact` exists for).
	 *   2. THE REMOTE ROWS ARE UPSERTED through `mergeRow`, exactly as a page's
	 *      rows are - incoming wins, an absent key is not a claim. New rows are
	 *      APPENDED in the answer's own order; the order the sidebar DRAWS is
	 *      not this array's (`mergeRemoteRowsByActivity` states that rule where
	 *      the list is built).
	 *   3. PRUNING, and only against a read that can speak: the relay
	 *      contributes NO rows for a peer that did not answer, so an absent id
	 *      proves nothing on its own. A held remote row is dropped only when
	 *      another row in this same answer proves its owner was reachable
	 *      (`reachable !== false`) while the answer still did not carry the id -
	 *      the device answered, and no longer holds that conversation. A fact
	 *      newer than the answer's request is never pruned.
	 *
	 * `pinned` ON A REMOTE ROW IS THE WIRE'S OWN ANSWER and stays as it arrives.
	 * Today that answer is `false` for every remote row, and it can be no other:
	 * the pin index is device-local and prunes ids with no local session
	 * directory (`local_operator/tui/sidebar_pins.py`), so forwarding an owner's
	 * pins is deferred - the Pinned bin draws no remote row yet, and this comment
	 * is the honest record of that rather than a defect to discover later.
	 */
	settlePeerCatalogue: (
		rows: CanonicalSessionRow[],
		/** The sequence the answer's own REQUEST took (`beginAnswer`). */
		requestedAt: number,
	) => void;
};

function mergeRow(
	current: CanonicalSessionRow | undefined,
	incoming: CanonicalSessionRow,
): CanonicalSessionRow {
	return {
		...current,
		...incoming,
		// Settled as a WHOLE, and before the guard: a spread cannot tell a stamp
		// from half of one, and `heldStatusOver` overrides this when the row's own
		// pair is the one that outranks the incoming row.
		...statusStamp(current, incoming),
		...heldStatusOver(incoming, current),
		attention: mergeCompletionAttention(
			current?.attention,
			incoming.attention,
			incoming.session_id,
		),
	};
}

/**
 * The kind of completion mark a row is DRAWING, or null when it draws none.
 *
 * THE ONE DECISION behind every "unread" word and number on the sidebar: the
 * glyph and its ink, the accessible name's `, unread`, the row's tooltip, and
 * the bulk control's count all ask this function. Two derivations of one fact
 * is precisely how the reported defect happened — the count read
 * `attention.unseen` alone while the glyph read a code as well, so a session
 * that finished a turn and then started another was counted under a control
 * whose row was drawing a spinner, and clicking it acknowledged a completion
 * nobody was ever shown (an acknowledgement is the only thing that clears
 * `unseen`, so that mark could never appear afterwards).
 *
 * IT READS `status.code`, and that is the point rather than a detail. The
 * runtime's `CatalogEntry.shows_completion_mark` (`local_operator/session/
 * catalog.py`) is the single arbiter of "does an unread completion win the
 * glyph, or does live state", and `status_code` is its stable transport
 * spelling: a parked gate publishes `approval`/`answer`, `wedged` and `busy`
 * publish themselves, and the unseen completion publishes `complete` / `error`
 * / `interrupted` only where the mark wins. A row's `status.code` therefore IS
 * that precedence, already decided by the side that owns it — re-deciding it
 * here from `live_state`/`pending`/`unseen` would be a SECOND derivation of one
 * fact, which is the drift this function exists to remove.
 *
 * `unseen` is still read, and it is not redundant: it is a LEVEL, not an edge —
 * true from the moment a turn completes until somebody READS that session,
 * because resuming does not acknowledge it — so the code alone cannot say
 * whether the mark still stands. On its own it is not enough either: that is
 * the defect.
 *
 * `error` and `interrupted` draw marks. They are the "error X indicators" a
 * reader counts, the runtime ranks them as outstanding completions
 * (`session/creation.py::session_category`), and it labels them "Unseen error"
 * / "Unseen interruption" — so they belong on the counted side even though the
 * glyph they carry is their own code's. A code this build does not know draws
 * no mark, and neither does an ABSENT status (a locally created row carries
 * none until the next catalogue read): unknown is not unread.
 */
export type UnreadMarkKind = "complete" | "error" | "interrupted";

export const unreadMarkKind = (
	row: CanonicalSessionRow,
): UnreadMarkKind | null => {
	if (row.attention?.unseen !== true) return null;
	const code = row.status?.code;
	return code === "complete" || code === "error" || code === "interrupted"
		? code
		: null;
};

/**
 * The rows a bulk acknowledgement can NAME, in the store's own terms.
 *
 * The single home of this predicate, and it lives here rather than in the
 * feature module that consumes it because the STORE'S action is the other half
 * of the fact: DESIGN §3.3 pins that "the count the control shows and the set
 * `markAllRead` sends are the same fact", and two hand-written literals are how
 * one fact becomes two — silently, and in the direction that costs the user,
 * because the number on screen would stop being the set the request carries.
 * `features/chat/mark-all-read.ts` re-exports it for the surface.
 *
 * A DRAWN MARK AND a `completion_token`, the mark half being `unreadMarkKind`:
 * the control's number is then exactly the rows a reader can see a mark on,
 * which is the property the report that produced this fix asked for — "the
 * mark as read function always reflects indicators that people are actually
 * seeing in the UI". Counting `unseen` alone reached rows whose live state had
 * taken the row over, and a mark with no token names no completion at all, so
 * the backend has nothing to match it against and would answer `unknown` for
 * it: sending that would only inflate the batch, and counting it would put a
 * number in the label that no click can honour.
 */
export const unreadAckableRows = (
	rows: CanonicalSessionRow[],
): CanonicalSessionRow[] =>
	rows.filter((row) => {
		if (unreadMarkKind(row) === null) return false;
		const token = row.attention?.completion_token;
		return typeof token === "string" && token.length > 0;
	});

/** How many rows a click would name; zero hides the control entirely. */
export const unreadAckableCount = (rows: CanonicalSessionRow[]): number =>
	unreadAckableRows(rows).length;

/**
 * Merge one attention state into the row it names, in one commit.
 *
 * Shared by the single-frame path (`applyAttention`) and the bulk receipt
 * (`applyAttentionMany`) so the three rules that decide whether a write happens
 * at all cannot drift between them: a state for a session the catalogue does not
 * hold is DROPPED rather than inserted (insertion would make a sidebar row with
 * no title and no binding, and membership is the catalogue's question — the rule
 * `applySessionStatus` states at length), the merge goes through the same
 * revision guard, and an UNCHANGED merge returns the SAME array so a beat that
 * carried nothing new re-renders nothing.
 *
 * Returning the array rather than a whole state keeps the caller's `set`
 * responsible for the state object, which is what lets the bulk path fold N rows
 * into ONE repaint instead of N.
 */
const mergeAttentionInto = (
	sessions: CanonicalSessionRow[],
	sessionId: string,
	attention: CompletionAttention,
): CanonicalSessionRow[] => {
	const index = sessions.findIndex((row) => row.session_id === sessionId);
	if (index < 0) return sessions;
	const row = sessions[index];
	const merged = mergeCompletionAttention(row.attention, attention, sessionId);
	if (merged === row.attention) return sessions;
	const next = sessions.slice();
	next[index] = { ...row, attention: merged };
	return next;
};

/**
 * The receipt's re-arm stamp, advanced by one press of a conversation.
 *
 * A COUNTER rather than a timestamp, for the same reason `answerSeq` is one: the
 * reader asks "is this a press I have NOT already honoured?", and `Date.now()`
 * answers only when two presses land in different milliseconds - which two
 * clicks of the same row, or a click and the route effect behind it, do not
 * promise. A revision that only ever moves forward answers it exactly.
 */
const rearmedReadAck = (
	current: ReadAckRearm | null,
	sessionId: string,
): ReadAckRearm => ({
	sessionId,
	revision: (current?.revision ?? 0) + 1,
});

/**
 * The stamp the merged row carries, as a PAIR or not at all.
 *
 * `status_epoch` names the process and `status_revision` is that process's counter
 * for this session, so half a stamp is not weaker evidence - it is unusable, and
 * the plain spread above would MINT it: `{...current, ...incoming}` on an
 * incoming row carrying an epoch and no revision leaves the current row's
 * revision sitting under the incoming epoch, so the row advertises
 * `(new epoch, old revision)` - an epoch that never counted that high - and the
 * guard then refuses that many of the new epoch's own list updates. That is the
 * mirror of the flap the guard exists to stop, arriving through the one path the
 * guard cannot see: it compares stamps it can read, and a minted one reads as
 * perfectly good evidence.
 *
 * Latent rather than live in the wire contract's own terms - the backend stamps
 * both keys or neither, and `SessionCatalogueRow` says they are omitted together -
 * which is exactly why it is worth holding up on this side. A complete incoming
 * stamp wins (the row it came from was read later), and a partial one contributes
 * nothing, which leaves the current row's complete pair in place under the rule
 * this merge already has for every other field: an absent key is not a claim.
 */
function statusStamp(
	current: CanonicalSessionRow | undefined,
	incoming: CanonicalSessionRow,
): Partial<CanonicalSessionRow> {
	const pair = (
		row: CanonicalSessionRow | undefined,
	): Partial<CanonicalSessionRow> | undefined =>
		typeof row?.status_revision === "number" &&
		typeof row?.status_epoch === "string"
			? { status_revision: row.status_revision, status_epoch: row.status_epoch }
			: undefined;
	return pair(incoming) ?? pair(current) ?? {};
}

/**
 * The three fields a guarded row keeps, or nothing when the incoming row wins.
 *
 * THE GUARD EXISTS BECAUSE TWO WRITERS NOW PRODUCE ONE VALUE, and one of them
 * is slow by construction: `sessions.list` is a whole-catalogue read (measured
 * at ~120 ms median for 200 rows, and the sidebar asks for 500) while a
 * `session_status` frame is a few hundred bytes. A list response computes its
 * rows BEFORE it is serialised, so the normal path is: the frame for a gate
 * answer lands first, and the list that was already in flight - deliberately
 * fired by the chat page's own marker effect on the very transition being sped
 * up - arrives afterwards carrying the PRE-answer status. Without this the
 * sidebar would show the corrected row and then flick back for one poll cycle,
 * which reads as the status being unreliable rather than late.
 *
 * The comparison only holds a value when the two stamps are COMPARABLE: the
 * same epoch (one live process's counters) and a strictly greater revision on
 * the row than on the incoming list. Everything else falls through to the
 * incoming row, and each of those cases is a real one:
 *
 * - `status_revision`/`status_epoch` absent on the incoming row: an older
 *   backend, or one that has published nothing for this session. There is
 *   nothing to order against, so the list is the only writer and wins.
 * - the epochs differ: the response was produced by the process now serving us
 *   (its epoch is the feed's, and a restart is what changes it), so its stamp
 *   block is the live one even where its revision reads lower.
 * - the incoming revision is >= the row's: the list is at least as fresh.
 * - the row holds a stamp but no status: a stamp with nothing under it cannot be
 *   the reason the list's status is refused.
 */
function heldStatusOver(
	incoming: CanonicalSessionRow,
	current: CanonicalSessionRow | undefined,
): Partial<CanonicalSessionRow> {
	const sameEpoch =
		typeof current?.status_epoch === "string" &&
		current.status_epoch === incoming.status_epoch;
	const held = current?.status_revision;
	const arrived = incoming.status_revision;
	const fresherFrame =
		current?.status !== undefined &&
		sameEpoch &&
		typeof held === "number" &&
		typeof arrived === "number" &&
		held > arrived;
	if (!fresherFrame) return {};
	return {
		status: current?.status,
		status_revision: current?.status_revision,
		status_epoch: current?.status_epoch,
	};
}
/**
 * The stamped records a read newer than `floor` still owns.
 *
 * Used for the ARCHIVE facts (`archiveFacts`), where it is the whole rule: this app
 * asks the list route for the archived rows too (`include_archived: true`), so a
 * page speaks about the archived set as a whole and a fact older than its request
 * is settled by it - absence from that page means "unarchived or gone" rather than
 * "not mentioned".
 *
 * It is deliberately NOT the rule for the delete tombstones any more, and the
 * reason is the same one `archiveFacts` does not have: the archive is a value the
 * page always speaks about, while a tombstone is an id the page can only speak
 * about by CARRYING it. A page that outranks a tombstone and does not carry the id
 * is exactly what the tombstone predicts, so it settles nothing (agent review round
 * 2, R2-1 - settling it there let a cached search answer put the deleted
 * conversation back). The tombstones are settled at the call site, by a
 * resurrection: a page that outranks the record AND carries the id.
 *
 * Returns the SAME object when nothing is dropped, so a page that settles nothing
 * does not re-render every row it carried.
 */
function factsNewerThan<T extends { at: number }>(
	facts: Record<string, T>,
	floor: number,
): Record<string, T> {
	const kept: Record<string, T> = {};
	let dropped = false;
	for (const [id, fact] of Object.entries(facts)) {
		if (fact.at < floor) {
			dropped = true;
			continue;
		}
		kept[id] = fact;
	}
	return dropped ? kept : facts;
}

/**
 * The state a delete leaves behind: the row is gone, anything this client
 * remembered about it is gone, and a TOMBSTONE is left in its place.
 *
 * The archive fact goes with the row because both describe a conversation the
 * backend no longer holds - a surviving fact would resurrect the row's state on
 * the next answer that mentioned the id (a search hit, say), which is the one
 * thing the frozen contract says a delete must not do.
 *
 * The tombstone is what makes the delete STICK against the reads in flight
 * (`ForgottenFact`): absence from the array is not a claim, because the next page
 * replaces membership wholesale.
 *
 * `activeSessionId` IS DELIBERATELY LEFT ALONE. Deleting the conversation you
 * have open must land the pane on its EXISTING missing-session state rather than
 * on a blank one, and that state is reached by the pane asking about an id the
 * daemon no longer has - which is why the tombstone is also what the pane reads
 * to know the answer before the wire gives it (`chat-content.tsx`). Clearing the
 * selection here instead would replace it with a pane that explains nothing,
 * which is the second missing-session state this change is told not to invent.
 */
function forgetSession<T extends SessionForgetState>(
	state: T,
	sessionId: string,
): Partial<T> {
	const facts = { ...state.archiveFacts };
	delete facts[sessionId];
	/*
	 * The placement fact goes with it: a conversation this window removed has
	 * nothing left to place, and a fact that outlived the row would be the
	 * resurrection the tombstones exist to prevent, one field over.
	 */
	const placements = { ...state.placementFacts };
	delete placements[sessionId];
	/*
	 * Stamped like a press, AND ADVANCING THE COUNTER, which is one decision rather
	 * than two: a write takes the sequence the next request will take, so a page
	 * asked for afterwards carries a greater value and OUTRANKS the tombstone, while
	 * a page asked for before it cannot. Outranking is not settling: under the rule
	 * this record's own docstring states (design round 2, R2-1) a page settles a
	 * tombstone only by CARRYING the id back, so what the advance buys is the
	 * RESURRECTION arm - a page that really does bring the conversation back is
	 * newer than the delete only if the delete advanced past it.
	 *
	 * THIS PARAGRAPH USED TO SAY the advance existed so the tombstone would not
	 * "outlive the very answer that proves the conversation is gone", citing three
	 * suite failures. That was the pre-R2-1 rule, and it is the opposite of what
	 * this code now wants: a tombstone that outlives a page which does not carry the
	 * id is exactly the protection a cached search answer needs (agent review round
	 * 3, R3-1). Stamping without advancing still leaves the next read at the same
	 * value (`fact.at < floor` is false), which is why the advance stays.
	 */
	const at = state.answerSeq + 1;
	return {
		sessions: state.sessions.filter((row) => row.session_id !== sessionId),
		archiveFacts: facts,
		placementFacts: placements,
		answerSeq: at,
		forgotten: {
			...state.forgotten,
			[sessionId]: {
				at,
				title:
					state.sessions.find((row) => row.session_id === sessionId)?.title ??
					undefined,
			},
		},
		deleteCandidate:
			state.deleteCandidate === sessionId ? null : state.deleteCandidate,
	} as Partial<T>;
}

type SessionForgetState = {
	sessions: CanonicalSessionRow[];
	archiveFacts: Record<string, ArchiveFact>;
	placementFacts: Record<string, PlacementFact>;
	forgotten: Record<string, ForgottenFact>;
	/** The stamp counter the tombstone's `at` is taken from (see `answerSeq`). */
	answerSeq: number;
	deleteCandidate: string | null;
};

/** Full list responses replace membership; a disappeared row is not immortal.
 * Stream updates use upsert separately and never imply a complete inventory. */
/**
 * The wire page as this store's rows.
 *
 * ONE PLACE, because three reads now pay it: the head page, the flat list's tail
 * and every group's page. The rename is not cosmetic - the wire's `name` is this
 * row's `title` and the wire's `mtime` is its `updated_at`, on the same rule
 * `BackendSessionRow` states: the row type is the UI's, and a second spelling of
 * the translation is how one of the three reads ends up sorting by `undefined`.
 */
function projectRows(raw: BackendSessionRow[]): CanonicalSessionRow[] {
	return raw.map(({ id, name, mtime, ...rest }) => ({
		...rest,
		session_id: id,
		title: name,
		updated_at: mtime,
	}));
}

/**
 * A page's rows, with the conversations this window must not draw dropped.
 *
 * THE TOMBSTONE FILTER IS NOT OPTIONAL ON A PAGED READ. `forgotten` records what
 * THIS window deleted, and a page whose request was issued before the delete can
 * still carry the id - so a read that trusted the daemon's silence would put a
 * permanently deleted conversation back on screen, clickable, opening onto the
 * missing-session notice.
 */
function answerRows(
	raw: BackendSessionRow[],
	forgotten: Record<string, ForgottenFact>,
): CanonicalSessionRow[] {
	return projectRows(raw).filter(
		(row) => forgotten[row.session_id] === undefined,
	);
}

/**
 * A cursor from an answer, or null for anything that is not a usable string.
 *
 * VALIDATED RATHER THAN TRUSTED, and it is the same habit `catalogueCountsFrom`
 * follows one function down for a different reason: the daemon is another
 * process, and a cursor is sent straight back as a query parameter. A
 * `next_cursor: ""` (a daemon whose own empty case leaked to the wire) would
 * serialise as `cursor=`, which the request schema refuses by name - so the tail
 * affordance would be offered and every press would 422. Normalising here means
 * the worst case is "no more rows offered", which is visible and honest.
 */
function normalisedCursor(raw: unknown): string | null {
	return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * The census from an answer, or null when it is absent or unusable.
 *
 * EVERY FIELD IS CHECKED, and the reason is that these numbers are PAINTED as
 * badges and counts beside groups: a census that half-parsed would put `NaN` or
 * `undefined` where a conversation count belongs, which reads as a group with no
 * chats rather than as a read this client could not use. Null means "no census",
 * and every surface then falls back to the count it can derive from the rows it
 * holds - which is exactly today's badge.
 */
export function catalogueCountsFrom(raw: unknown): CatalogueScopeCounts | null {
	if (raw === null || typeof raw !== "object") return null;
	const counts = raw as Record<string, unknown>;
	const whole = (value: unknown): number | null =>
		typeof value === "number" && Number.isFinite(value) && value >= 0
			? Math.floor(value)
			: null;
	const total = whole(counts.total);
	const active = whole(counts.active);
	const unbound = whole(counts.unbound);
	if (total === null || active === null || unbound === null) return null;
	if (!Array.isArray(counts.scopes)) return null;
	const scopes: CatalogueScopeTotal[] = [];
	for (const entry of counts.scopes) {
		if (entry === null || typeof entry !== "object") return null;
		const scope = entry as Record<string, unknown>;
		// The kind is the CLOSED vocabulary the route and the group predicate share;
		// anything else is a census for an axis this client cannot draw, so it is
		// dropped rather than stored under a key nothing looks up.
		if (scope.kind !== "team" && scope.kind !== "agent") continue;
		if (typeof scope.name !== "string" || scope.name.length === 0) continue;
		const scopeTotal = whole(scope.total);
		const scopeActive = whole(scope.active);
		if (scopeTotal === null || scopeActive === null) continue;
		scopes.push({
			kind: scope.kind,
			name: scope.name,
			total: scopeTotal,
			active: scopeActive,
		});
	}
	return { total, active, unbound, scopes };
}

export function replaceSessionRows(
	current: CanonicalSessionRow[],
	incoming: CanonicalSessionRow[],
): CanonicalSessionRow[] {
	const byId = new Map(current.map((row) => [row.session_id, row]));
	return [
		...new Map(
			incoming.map((row) => [
				row.session_id,
				mergeRow(byId.get(row.session_id), row),
			]),
		).values(),
	];
}
let refreshGeneration = 0;
/*
 * Mount, transition, poll and focus triggers can overlap while every caller reads
 * the same catalogue. Serialize those reads to preserve the store's global
 * generation ordering. Calls in flight invalidate that answer and collapse into
 * one trailing read using the most recently requested page limit.
 */
let sessionRefresh: {
	limit: number;
	/**
	 * Whether the collapsed read asks for the per-scope census.
	 *
	 * Carried beside `limit` because it is the second half of the same question:
	 * the flight resumes "the most recently requested read", and a read is its page
	 * size AND whether it wanted the counts. Collapsing them would let a caller that
	 * did not ask for a census silently determine what the resuming caller's answer
	 * carries - and the sidebar's own refresh always wants it.
	 */
	withCounts: boolean;
	invalidated: boolean;
	promise: Promise<unknown>;
} | null = null;

function coalesceSessionCatalogueRequest<T>(
	limit: number,
	withCounts: boolean,
	request: (limit: number, withCounts: boolean) => Promise<T>,
): Promise<T> {
	const active = sessionRefresh;
	if (active) {
		active.invalidated = true;
		active.limit = limit;
		active.withCounts = withCounts;
		return active.promise as Promise<T>;
	}

	const flight = {
		limit,
		withCounts,
		invalidated: false,
		promise: null as unknown as Promise<T>,
	};
	sessionRefresh = flight;
	flight.promise = (async () => {
		try {
			while (true) {
				flight.invalidated = false;
				let answer: T;
				try {
					answer = await request(flight.limit, flight.withCounts);
				} catch (error) {
					if (flight.invalidated) continue;
					throw error;
				}
				if (flight.invalidated) continue;
				// Clear synchronously with the final validity check so an invalidation
				// cannot land after the loop decides to stop and go unserved.
				if (sessionRefresh === flight) sessionRefresh = null;
				return answer;
			}
		} finally {
			if (sessionRefresh === flight) sessionRefresh = null;
		}
	})();
	return flight.promise;
}

/**
 * What main asked THIS window to open, resolved through the shared reader.
 *
 * Read from the preload's `desktop.initialSession`/`initialCatalogue`, which come
 * from THIS process's own argv (`webPreferences.additionalArguments`, set only
 * when main created the window for a notification click). It is a VALUE rather
 * than an event on purpose (B3): a recreated window rehydrates its persisted
 * `activeSessionId` and paints that conversation in the first frame, so an id
 * that arrives as a post-load IPC shows the user the wrong conversation and
 * then swaps it — which reads as a click that landed on the wrong row.
 *
 * IT RESOLVES THREE INTENTS, NOT TWO (review round 2, R2-1). "Restore", "open
 * this conversation" and "open the catalogue" are genuinely different answers,
 * and the third used to be indistinguishable from the first: both arrived as
 * `initialSession: null`, so a window created for a burst digest restored
 * whatever was last read.
 *
 * Guarded because this module is imported in contexts with no `window` (the node
 * test harness), where the answer is simply "no launch argument".
 */
function launchTarget(): LaunchTarget {
	try {
		const desktop = window.api?.desktop;
		if (!desktop) return { kind: "restore" };
		// A named conversation outranks the catalogue, the same precedence the
		// argv reader applies: naming one is the more specific instruction.
		if (desktop.initialSession) {
			return { kind: "session", sessionId: desktop.initialSession };
		}
		if (desktop.initialCatalogue) return { kind: "catalogue" };
		return { kind: "restore" };
	} catch {
		return { kind: "restore" };
	}
}

/** The launched conversation's id, or null — which includes the catalogue. */
function launchSession(): string | null {
	const target = launchTarget();
	return target.kind === "session" ? target.sessionId : null;
}
/**
 * The draft a launch with nothing to restore lands on (§H, U1/U23).
 *
 * WHY THIS EXISTS. The pane used to have an INTERMEDIATE SCREEN between launch and
 * a conversation: with no session and no draft, `chat-page.tsx` rendered a "Start a
 * chat" heading with a "New chat" button, and the composer only appeared once the
 * user pressed it. §H deletes that screen - launch lands on the empty state with
 * the composer docked and focused - which means the app has to decide, at launch,
 * that it is holding a NEW conversation rather than none.
 *
 * WHY HERE RATHER THAN IN AN EFFECT. `persist` hydrates before the first render, so
 * this is the one place a decision can be true of the first PAINTED frame; an effect
 * would paint the intermediate state (or an empty column) and correct itself after,
 * which is the flash the launch argument's own merge exists to prevent. The row it
 * builds is the same shape `stageDraft` writes, so nothing downstream can tell a
 * launched draft from a pressed one.
 *
 * IT IS A NO-OP WHEN ANYTHING IS ALREADY ACTIVE: a launch argument for a session, a
 * restored conversation, a restored draft, or the catalogue launch (which sets
 * `activeSessionId: null` deliberately) are all left exactly as the arms above and
 * the persisted state left them. Only "nothing at all" takes a new draft.
 */
export function launchDraftSeed(
	current: Pick<
		CanonicalSessionsState,
		"activeSessionId" | "activeDraftKey" | "drafts"
	>,
): Pick<CanonicalSessionsState, "activeDraftKey" | "drafts"> | null {
	if (current.activeSessionId || current.activeDraftKey) return null;
	const key = `draft:${crypto.randomUUID()}`;
	return {
		activeDraftKey: key,
		drafts: {
			...current.drafts,
			[key]: {
				key,
				createRequestId: crypto.randomUUID(),
				admissionRequestId: crypto.randomUUID(),
			},
		},
	};
}

/**
 * The launch argument OUTRANKS the persisted conversation.
 *
 * Main was asked for this conversation BY NAME, and the window exists to show
 * it; the persisted id is merely what the user last read, which on a
 * click-created window is exactly the wrong one. Overriding here rather than in
 * an effect is what makes it true of the FIRST render — a layout effect would
 * already have committed the wrong conversation to the DOM, and any effect
 * after paint is the flash this exists to prevent (B3).
 *
 * THE CATALOGUE OUTRANKS IT TOO (review round 2, R2-1). `activeSessionId: null`
 * is how this store models "no conversation selected", i.e. the list — so a
 * window main created for a burst digest must land there rather than on the
 * persisted conversation. Missing this branch is what made a windowless digest
 * click restore the last conversation instead of opening the catalogue.
 *
 * Named and exported rather than inlined in the store's `persist` options
 * because it is the rule B3 rests on: hydration is what would otherwise put the
 * persisted id back, and no test can reach that path without a browser's
 * storage. Called by `persist` exactly as before.
 */
export function mergePersistedSession(
	persisted: unknown,
	current: CanonicalSessionsState,
): CanonicalSessionsState {
	const merged = {
		...current,
		...(persisted as Partial<CanonicalSessionsState> | undefined),
	};
	const target = launchTarget();
	if (target.kind === "session") {
		return { ...merged, activeSessionId: target.sessionId };
	}
	if (target.kind === "catalogue") {
		return { ...merged, activeSessionId: null };
	}
	/*
	 * Nothing to restore and no conversation asked for: a launch holds a NEW
	 * conversation rather than none (§H). See `launchDraftSeed` for why the
	 * decision belongs in the merge and why it is a no-op in every other case.
	 */
	const seed = launchDraftSeed(merged);
	if (seed) return { ...merged, ...seed };
	return merged;
}

export const useCanonicalSessionsStore = create<CanonicalSessionsState>()(
	persist(
		(set, get) => ({
			sessions: [],
			cataloguePageable: false,
			// Fail-closed until a mounted pane resolves the capability and publishes it
			// (`setDraftWarmable`): no backend this app has ever shipped warms drafts
			// by default, and the absent flag is what keeps every older daemon on
			// today's wiring.
			draftWarmable: false,
			// Seeded from the launch argument when there is one, so the very first
			// render is already the requested conversation rather than the persisted
			// one. `merge` below holds the same line against hydration, which would
			// otherwise put the persisted id back.
			activeSessionId: launchSession(),
			activeDraftKey: null,
			drafts: {},
			validatingSessionId: null,
			pinFailure: null,
			pinFacts: {},
			answerSeq: 0,
			// Null rather than a stamp at zero: no press has been made in this window,
			// and the receipt's re-arm reads "no press" as exactly that.
			readAckRearm: null,
			// Null rather than a kind at zero, for the same reason: no loop has said
			// anything about a receipt in this window, and the rows read absence as
			// "nothing to say" rather than as a state they should draw.
			readAckNotice: null,
			loading: false,
			truncated: false,
			// No page has been read yet, so there is no window, no cursor and nothing
			// to extend. `complete: false` rather than true: a catalogue whose head has
			// never been read is not a catalogue with no tail.
			head: {
				pageIds: [],
				tailIds: [],
				nextCursor: null,
				tailCursor: null,
				tailStarted: false,
				complete: false,
				loading: false,
				error: null,
				at: 0,
			},
			scopes: {},
			counts: null,
			statusUnavailable: [],
			archiveFacts: {},
			placementFacts: {},
			forgotten: {},
			stoppedTurns: {},
			archiveFailure: null,
			archiveUndo: null,
			draftsUndo: null,
			bulkReadDeferral: null,
			stagedByDiscard: null,
			deleteCandidate: null,
			archiveCandidate: null,
			error: null,
			cwd: "~",
			/*
			 * The write path for a DRAFT's staged directory (`DirectoryWritePath`'s
			 * `stage` kind; the composer's chip is the only caller). Changing where the
			 * first send will run changes what a runtime warmed for the old directory
			 * would have engaged, so the same drop rule a model pick applies applies
			 * here: the warm intent and its receipt key go, and the next keystroke
			 * re-arms against the new directory.
			 *
			 * EVERY draft row without a session, not just the active one (review round
			 * 1's MAJOR-1). `cwd` is ONE value, read by whatever pane mints and by
			 * whatever pane sends, while the rows outlive the pane in front of you: an
			 * agent/team-keyed row (`draft:agent:<name>`) is RE-USED by `stageDraft`
			 * when the user comes back to it, so a warm left on an inactive row is a
			 * send waiting to adopt a runtime engaged for the previous directory - the
			 * exact case the spec's drop rule exists to remove ("v1 favours semantic
			 * equality with today"). A row with a session keeps today's plain write,
			 * and a store with no draft rows at all does not even rebuild the map.
			 */
			setCwd: (cwd) =>
				set((state) => {
					const rows = Object.entries(state.drafts);
					if (!rows.some(([, draft]) => !draft.sessionId)) return { cwd };
					return {
						cwd,
						drafts: Object.fromEntries(
							rows.map(([key, draft]) =>
								draft.sessionId
									? [key, draft]
									: [
											key,
											{
												...draft,
												warmId: undefined,
												draftRequestId: crypto.randomUUID(),
											},
										],
							),
						),
					};
				}),
			fetchSessions: async (
				/*
				 * AN UNNAMED SIZE IS THE HEAD PAGE ON A PAGING DAEMON (Q-1): see
				 * `cataloguePageDefault`. A caller that needs the whole set says so.
				 */
				limit = cataloguePageDefault(get().cataloguePageable),
				withCounts = false,
			) => {
				const generation = ++refreshGeneration;
				/*
				 * The page is an answer too, so it carries the same currency for BOTH
				 * writers: taken when the REQUEST starts, so a page already in flight
				 * across a press cannot supersede that press - the pin's (`PinFact`) or
				 * the archive's (`archiveFacts`).
				 */
				const answerAt = get().answerSeq + 1;
				set({ answerSeq: answerAt });
				set({ loading: true, error: null });
				try {
					const result = await coalesceSessionCatalogueRequest(
						limit,
						withCounts,
						(pageLimit, pageCounts) =>
							desktopResult<{
								sessions: BackendSessionRow[];
								truncated?: boolean;
								/**
								 * The reads the daemon could not answer, additive and optional. A
								 * daemon that sends nothing here is one that answered all of them.
								 */
								degraded?: string[];
								/**
								 * The paging four, ALL ADDITIVE AND OPTIONAL: a daemon that predates
								 * them sends none of them, and this read then behaves exactly as it
								 * did before they existed (no cursor, so nothing to extend).
								 *
								 * `next_cursor` is non-null iff more rows exist in this scope after
								 * the page - the daemon's own invariant is
								 * `(next_cursor is not None) == truncated`, so this client never
								 * derives one from the other.
								 *
								 * `cursor_missing` is NOT an error: an unusable cursor is answered
								 * with the scope's FIRST page, and this flag is what tells a client
								 * that the answer it holds replaced rather than extended. Nothing
								 * here reads it today (the tail's own id-keyed merge makes a
								 * re-read idempotent), which is why it is typed and commented
								 * rather than omitted: the next reader must not treat its absence
								 * as a promise the daemon never made.
								 */
								next_cursor?: string | null;
								cursor_missing?: boolean;
								/**
								 * The census, present only when the request asked for it. Validated
								 * before it is stored (`catalogueCountsFrom`) because the daemon
								 * is another process and a badge is a NUMBER: a census that failed
								 * to parse must leave the badge on its local count rather than
								 * paint `undefined` beside a group.
								 */
								counts?: unknown;
							}>({
								op: "sessions.list",
								limit: pageLimit,
								/*
								 * THE ARCHIVED ROWS ARE ASKED FOR AND THEN HIDDEN HERE, rather than left
								 * out by the route. The default `false` is a promise to clients that
								 * predate archiving - they must keep the list they had, and this app
								 * asks for them, so it must be the one to decide what is drawn:
								 *
								 *   - `visibleRows` partitions them out of EVERY default list, so the
								 *     surface is the one the brief asks for (Active, Previous and the
								 *     flat list all exclude them);
								 *   - the open conversation's own state is known after a reload even
								 *     when the conversation was archived elsewhere (from the terminal, or
								 *     from another window) - without this, a restored archived session
								 *     would look ordinary and offer no unarchive at all, which is
								 *     precisely the "archived with no way back" trap the design record
								 *     names in Claude desktop's behaviour;
								 *   - and a row found by the "Include archived" search can be restored
								 *     from its own control even when the hit's own page never carried it.
								 *
								 * The cost this carries, stated rather than discovered: archived rows
								 * compete for the page's 500-row cap like any other row, so a store with
								 * more than 500 conversations where most are archived can push live rows
								 * off the page. The route cannot answer both questions at once today,
								 * and the alternative - hiding the archived set from this client
								 * entirely - fails the two bullets above.
								 */
								include_archived: true,
								/*
								 * Omitted rather than sent as `false`, on the rule
								 * `sessions.search`'s own query states: the pre-change request is
								 * what an older backend must keep seeing, and the route's own
								 * default for the census is off. So the request object is
								 * byte-identical to today's when nothing asked for counts - which
								 * includes every caller but the sidebar's own refresh.
								 */
								...(pageCounts ? { with_counts: true } : {}),
							}),
					);
					if (generation !== refreshGeneration) return;
					const rows = projectRows(result.sessions);
					set((state) => {
						/*
						 * A page newer than the write settles the WHOLE pinned set, not only
						 * the rows it happens to carry.
						 *
						 * It used to keep the facts for conversations the page could not
						 * carry, because on a paged client that was the only way a pin made
						 * here stayed visible for a conversation past the page. The list
						 * route now APPENDS every pinned conversation below the newest
						 * `limit` rows, so the page speaks for the pinned set as a whole -
						 * and under that contract silence means the opposite: a conversation
						 * is absent from a newer page because it is unpinned or gone.
						 *
						 * Constraint this carries: it assumes a daemon that appends off-page
						 * pinned rows. A daemon without that increment would hide an off-page
						 * pin until it was unpinned - which is why the two halves ship as one
						 * stack and why the capability stays `session_pins: 1` on both.
						 */
						const facts = { ...state.pinFacts };
						for (const [id, fact] of Object.entries(facts)) {
							if (fact.at >= answerAt) continue;
							delete facts[id];
						}
						/*
						 * AND THE TOMBSTONES ARE SETTLED BY A RESURRECTION, NEVER BY A PAGE THAT
						 * MERELY FAILS TO CARRY THE ID (agent review round 2, R2-1).
						 *
						 * A page asked for after a delete answers complete membership, so it used
						 * to settle every tombstone it did not carry. That is the same "absence is
						 * not a claim" mistake this file keeps having to undo, one door over: the
						 * page settling the tombstone says nothing about the SEARCH ANSWERS that
						 * are still live, and one of them can be asked BEFORE the delete and
						 * answered after it (`session-search.ts` caches per query for 30 s, and the
						 * store takes no more than four page triggers). With the tombstone gone
						 * the join drew a permanently deleted conversation again - deterministically,
						 * with no race: search the row, delete it, let any page land, and the cached
						 * answer still names the id.
						 *
						 * So the tombstone goes only when the read that outranks it carries the id
						 * BACK. That is a resurrection - something recreated the conversation, so
						 * this window's record of its absence is stale and false - and it is the
						 * one read that really does speak about the id. A page that outranks the
						 * tombstone and does NOT carry the id changes nothing, because it is
						 * already what the tombstone says; keeping it is what holds the join and
						 * the pane steady against every answer already in flight.
						 *
						 * The rows are filtered through the SETTLED record, which is the arm that
						 * stops a page asked for BEFORE the delete (it carries the id, it just
						 * carries a stale membership) re-adding the row.
						 */
						const carried = new Set(rows.map((row) => row.session_id));
						let revived = false;
						const forgotten: Record<string, ForgottenFact> = {
							...state.forgotten,
						};
						for (const [id, fact] of Object.entries(forgotten)) {
							if (fact.at < answerAt && carried.has(id)) {
								delete forgotten[id];
								revived = true;
							}
						}
						const tombstones = revived ? forgotten : state.forgotten;
						const page = rows.filter(
							(row) => tombstones[row.session_id] === undefined,
						);
						/*
						 * AND THE PLACEMENT FACTS ARE SETTLED BY THE ONE KIND OF PAGE THAT CAN
						 * SPEAK ABOUT THEM. A plain listing asks for no peers, so it can never
						 * place a conversation (`PlacementFact`); a peers-inclusive answer
						 * carries `locality`/`owner_device` for the ids it lists, and is therefore
						 * the read that settles a fact - here or on another surface. Recency is
						 * `PinFact`'s rule: a fact written after this request started is left
						 * alone. The settle takes a FRESH sequence (the write half of the
						 * currency), so an answer requested BEFORE this one cannot clobber what
						 * it settled - and the sequence is only advanced when something really
						 * settled, at the return below.
						 */
						let placementFacts: Record<string, PlacementFact> | null = null;
						for (const row of page) {
							const fact = state.placementFacts[row.session_id];
							if (fact === undefined || fact.at >= answerAt) continue;
							const locality =
								row.locality === "remote"
									? "remote"
									: row.locality === "local"
										? "local"
										: null;
							if (locality === null) continue;
							placementFacts ??= { ...state.placementFacts };
							placementFacts[row.session_id] = {
								locality,
								owner_device:
									typeof row.owner_device === "string" ? row.owner_device : "",
								at: state.answerSeq + 1,
							};
						}
						/*
						 * THE ANSWER'S OWN POSITION AND ITS SIZE CLAIM, read once here because
						 * two decisions below need them and they must be the SAME reading: the
						 * state records what the answer said, and the membership rule discards
						 * the tail when the answer says the catalogue is complete. Deriving the
						 * pair twice is how a state could say "complete" while the tail was
						 * still held, or the reverse.
						 */
						const answerCursor = normalisedCursor(result.next_cursor);
						const answerComplete =
							answerCursor === null && result.truncated !== true;
						/*
						 * THE IDS THIS PAGE OWNS, recorded for `clearScope`: a group's collapse
						 * must drop the rows the GROUP fetched and keep the ones the head page
						 * also carries, and only a record of the page can tell them apart.
						 */
						const answerPageIds = page.map((row) => row.session_id);
						/*
						 * AND THE ROWS, not only the facts (review round 4, M1; QA Qr4-1).
						 * `replaceSessionRows` rebuilds membership and values from the page
						 * alone, so a page whose request STARTED before a press would hand the
						 * panel the pre-press value - the row visibly regresses under a control
						 * the reader just used - and would DROP a row the press inserted for a
						 * conversation the page cannot carry. A write newer than the page's own
						 * request outranks it, exactly as it outranks the page's facts above:
						 * the row keeps the value the write put there, and it keeps its place
						 * until a page requested AFTER the write arrives to settle it.
						 */
						const protectedRows = state.sessions.filter(
							(row) =>
								tombstones[row.session_id] === undefined &&
								(state.pinFacts[row.session_id]?.at ?? -1) >= answerAt,
						);
						/*
						 * THE HEAD ANSWER'S OWN MEMBERSHIP RULE, which is NOT "replace every row".
						 *
						 * It rebuilds the rows no loaded scope holds - the rows this answer can speak
						 * for - and leaves every scope's rows to their own answer. Calling
						 * `replaceSessionRows(state.sessions, page)` here would be correct only while
						 * nothing is expanded, and would delete an expanded group's whole page the
						 * first time the poll landed with a group open.
						 */
						const headAnswer = headAnswerRows({
							sessions: state.sessions,
							scopeIds: scopeHeldIds(state.scopes),
							/*
							 * THE OPEN CONVERSATION DOES NOT LEAVE THE LIST ON A PAGE THAT DOES NOT
							 * CARRY IT (round 1, R3). `activeSessionId` is the row the transcript pane
							 * is drawing, and a 50-row head page can stop above a conversation at rank
							 * 51 - under the unscoped read this change replaces, it could not.
							 */
							/*
							 * AND THE ROWS A PLACEMENT FACT HOLDS. A conversation minted on a
							 * peer is absent from every PLAIN page (this request asks for no
							 * peers), so without these ids the answer rebuilds membership without
							 * it and drops the row the create just stamped - and the header's
							 * device control, which reads the row (`chat-device-slot`'s `host`),
							 * then falls to `On this device` over a session the peer just minted
							 * (operator report, 2026-09-30). Only REMOTE facts hold rows: for
							 * every other conversation the answer's silence means what it always
							 * meant (`PlacementFact`).
							 */
							keepIds: [
								...(state.activeSessionId === null
									? []
									: [state.activeSessionId]),
								...placementHeldIds(state.placementFacts),
							],
							/*
							 * AN ANSWER THAT SAYS IT IS THE WHOLE CATALOGUE DISCARDS THE TAIL.
							 * `complete` means `next_cursor === null` with nothing truncated,
							 * so the page it carries IS the catalogue and every row an
							 * extension had fetched is either in it or gone - keeping them
							 * would draw conversations the answer has just denied.
							 */
							tailIds: answerComplete ? [] : state.head.tailIds,
							page,
							merge: replaceSessionRows,
						});
						let next = headAnswer.rows;
						for (const held of protectedRows) {
							const fact = state.pinFacts[held.session_id];
							const at = next.findIndex(
								(row) => row.session_id === held.session_id,
							);
							if (at === -1) next = [...next, { ...held, pinned: fact.pinned }];
							else next[at] = { ...next[at], pinned: fact.pinned };
						}
						/*
						 * AND THE ARCHIVE'S OWN SETTLING, on the same page and the same stamp,
						 * but a DIFFERENT rule about silence: this app asks the list route for
						 * the archived rows (`include_archived: true`), so the page speaks about
						 * the archived set as a whole and absence means "unarchived or gone"
						 * rather than "not mentioned" (`factsNewerThan`).
						 *
						 * THE PAGE NO LONGER WRITES THE FACT'S VALUE ONTO THE ROWS (design round 8,
						 * D27). It used to, to stop a page asked for before a press regressing the
						 * row the reader just archived - and with the two row-facing readers taking
						 * the ANSWERED view (`chat-archived.ts`'s `answeredArchiveRows` for membership,
						 * the sidebar's `archiveFactValues` for the row's drawn value), that
						 * protection is structural: a surviving fact outranks the page in both readers
						 * whatever the rows carry. What stays here is the CURRENCY, which is what
						 * settles a fact older than the request it answers.
						 */
						const archiveFactSet = factsNewerThan(state.archiveFacts, answerAt);
						const counts = catalogueCountsFrom(result.counts);
						return {
							sessions: next,
							pinFacts: facts,
							archiveFacts: archiveFactSet,
							/*
							 * The placement facts and the sequence their settle took, only when
							 * something really settled: a page that speaks about no held id
							 * leaves the state untouched (and the counter unadvanced).
							 */
							...(placementFacts === null
								? {}
								: { placementFacts, answerSeq: state.answerSeq + 1 }),
							forgotten: tombstones,
							loading: false,
							truncated: result.truncated === true,
							/*
							 * THE HEAD'S OWN PAGING STATE, taken from THIS answer.
							 *
							 * `nextCursor` is the answer's `next_cursor`, so a daemon that predates
							 * the paging parameters leaves it null and the flat list offers no tail
							 * affordance at all - which is the old-daemon path, unchanged.
							 * `complete` is decided HERE rather than `next_cursor === null`: an
							 * answer that carries no cursor because the daemon cannot page is not
							 * an answer that reached the end of the catalogue, and saying it had
							 * would let a surface promise "that is everything" about a page it
							 * only knows the size of.
							 *
							 * `at` is the same stamp the facts above are settled against, so a
							 * second page-one answer asked for after this one replaces it wholesale
							 * and a stale one cannot put an older cursor back.
							 */
							head: {
								pageIds: answerPageIds,
								tailIds: headAnswer.tailIds,
								nextCursor: answerCursor,
								/*
								 * THE EXTENSION FRONTIER, SEEDED ONCE AND THEN THE EXTENSIONS' OWN
								 * (QA round 2, Q2 - see `tailCursor`). A poll landing after an
								 * extension must not move it, or the press that follows re-requests
								 * a page the client already holds and the list stalls. An answer that
								 * says it is the WHOLE catalogue still clears it: nothing below it
								 * exists to continue to.
								 */
								tailCursor: answerComplete
									? null
									: state.head.tailStarted
										? state.head.tailCursor
										: answerCursor,
								tailStarted: state.head.tailStarted,
								complete: answerComplete,
								loading: false,
								error: null,
								at: answerAt,
							},
							/*
							 * SILENCE IS NOT A CLAIM here either: a head answer that did not ask for
							 * the census (the palette's, the hand-over dialog's, the MCP section's
							 * wider reads) leaves the last one standing. The census is a fact about
							 * the store, not about the page, so a page that is quiet about it is not
							 * a page that denies it - and the sidebar's own refresh asks every time.
							 */
							...(counts === null ? {} : { counts }),
							/*
							 * Read only from an answer that arrived: a failed read leaves the last
							 * known list in place (and says so through `error`), so the marker that
							 * belonged to those rows is the honest thing to keep beside them.
							 */
							statusUnavailable: Array.isArray(result.degraded)
								? result.degraded.filter((read) => typeof read === "string")
								: [],
						};
					});
				} catch (error) {
					if (generation === refreshGeneration)
						set({
							loading: false,
							/*
							 * THROUGH THE APP'S OWN SENTENCE, not the transport's. This stored
							 * `error.message` raw, so a daemon-authored refusal - the 503 whose
							 * prose the operator photographed - reached the sidebar and the pane
							 * as this app's diagnosis for the whole window a re-pair takes
							 * (measured at 18.3 s; UX round 2, U1). The send path already
							 * composed ours; this is the store's error value doing the same.
							 */
							error: storeErrorMessage(
								error,
								"Chats could not refresh. Retry to reconnect.",
							),
						});
				}
			},
			/*
			 * THE FLAT LIST'S TAIL: one page further down the UNSCOPED catalogue.
			 *
			 * WHY THIS ONE MAY AUTO-EXTEND ON SCROLL AND A GROUP MAY NOT. This extends
			 * the CHAT region, which is a scroller of its own with one scope in it, so
			 * "extend" has exactly one meaning. The entity region is shared by every
			 * expanded group, so a sentinel near the fold there would fire for whichever
			 * groups happen to sit at it - the load would become a function of scroll
			 * position rather than of intent, and N groups would extend together, which
			 * is the amplification this whole change removes. Groups get an explicit row
			 * instead (`fetchScopePage` below).
			 *
			 * SINGLE FLIGHT against `head.loading`, never against `refreshGeneration`:
			 * a page-one refresh landing mid-extension is not a reason to discard the
			 * rows the reader asked for. The two answers merge by id, so a refresh that
			 * also re-carries some of these rows collapses rather than duplicating, and
			 * the only cost of the race is one re-fetched page.
			 */
			fetchCatalogueTail: async () => {
				const head = get().head;
				const cursor = head.tailCursor;
				if (cursor === null || head.loading) return;
				set((state) => ({
					head: {
						...state.head,
						loading: true,
						error: null,
						/*
						 * THE ATTEMPT MARKS THE EXTENSION AS STARTED, at REQUEST time and not
						 * on success: a failed extension keeps its place (the retry continues
						 * from the same cursor), and once started, a page-one answer can no
						 * longer rewrite the frontier out from under a press.
						 */
						tailStarted: true,
						tailCursor: cursor,
					},
				}));
				try {
					const result = await desktopResult<{
						sessions: BackendSessionRow[];
						next_cursor?: string | null;
					}>({
						op: "sessions.list",
						limit: CATALOGUE_HEAD_PAGE,
						include_archived: true,
						cursor,
					});
					const page = answerRows(result.sessions, get().forgotten);
					set((state) => {
						/*
						 * A UNION KEYED BY ID, and a row the client already held is MERGED
						 * rather than skipped: a cursor page can re-send a row whose tier moved
						 * across the boundary (the accepted imperfection the design note names),
						 * and the incoming row is the newer reading of it. The head's own
						 * MEMBERSHIP is untouched - an extension adds rows below the ones it has,
						 * it does not re-rank them.
						 */
						const at = new Map(
							state.sessions.map((row, index) => [row.session_id, index]),
						);
						const sessions = [...state.sessions];
						const added: string[] = [];
						for (const row of page) {
							const index = at.get(row.session_id);
							if (index === undefined) {
								at.set(row.session_id, sessions.length);
								sessions.push(row);
								added.push(row.session_id);
								continue;
							}
							sessions[index] = mergeRow(sessions[index], row);
						}
						const nextCursor = normalisedCursor(result.next_cursor);
						return {
							sessions,
							head: {
								...state.head,
								/*
								 * THE ROWS THIS EXTENSION FETCHED ARE NOW THE TAIL, and the record
								 * of that is what a later page-one answer must not drop. A page
								 * whose rows the client already held adds nothing and records
								 * nothing, which is why this appends `added` rather than the
								 * page's ids.
								 */
								tailIds: [...state.head.tailIds, ...added],
								/*
								 * THE FRONTIER MOVES ONLY HERE. `nextCursor` is deliberately NOT
								 * written: it is the page-one answer's own continuation, and this
								 * extension has said nothing about the head page (QA round 2, Q2).
								 */
								tailCursor: nextCursor,
								// The tail reached the end only when it says so. `head.at`
								// is deliberately NOT advanced: it stamps the answer that
								// is allowed to settle FACTS, and an extension must never be
								// mistaken for one (a tail page speaks for a rank window, not
								// for the pinned or archived set).
								complete: nextCursor === null,
								loading: false,
								error: null,
							},
						};
					});
				} catch (error) {
					set((state) => ({
						head: {
							...state.head,
							loading: false,
							/*
							 * THE TAIL'S OWN ERROR, not the store's. A failed extension is a failure
							 * of one press at the bottom of the list, and putting it in the store's
							 * `error` would raise the sidebar's danger alert about the backend -
							 * a claim about the whole window that one scrolled page cannot support.
							 */
							error: storeErrorMessage(error, "Could not load more chats."),
						},
					}));
				}
			},
			/*
			 * ONE GROUP'S PAGE - the first page when its collapsed row is expanded, the
			 * next page when its own `Show more` row is pressed.
			 *
			 * EACH GROUP PAGES INDEPENDENTLY, and nothing else re-fetches it. A poll, a
			 * window focus and a `catalogue` frame all refresh the unscoped head only;
			 * re-reading every expanded group on each frame would reproduce, once per
			 * open group, the amplification this change exists to remove. What goes stale
			 * without a re-read is a group's internal ORDER (a completion re-files a row on
			 * the backend); the rows themselves stay fresh, because the per-row status feed
			 * keeps arriving and `heldStatusOver` is what carries it.
			 *
			 * A SCOPE READ DOES NOT ASK FOR THE ARCHIVED SET, and that is a rule rather
			 * than a saving: only the head answer may settle `archiveFacts` (the page that
			 * speaks for the archived set as a whole is the unscoped one), and the group
			 * rendering draws only visible rows - so an archived row in a scope answer would
			 * be bytes the panel throws away.
			 */
			fetchScopePage: async (
				kind,
				name,
				cursor = null,
				limit = CATALOGUE_GROUP_PAGE,
			) => {
				const key = catalogueScopeKey(kind, name);
				if (get().scopes[key]?.loading) return;
				const answerAt = get().answerSeq + 1;
				set({ answerSeq: answerAt });
				set((state) => ({
					scopes: {
						...state.scopes,
						[key]: {
							ids: state.scopes[key]?.ids ?? [],
							nextCursor: state.scopes[key]?.nextCursor ?? null,
							loading: true,
							error: null,
							at: answerAt,
						},
					},
				}));
				try {
					const result = await desktopResult<{
						sessions: BackendSessionRow[];
						next_cursor?: string | null;
						cursor_missing?: boolean;
					}>({
						op: "sessions.list",
						limit,
						include_archived: false,
						scope_kind: kind,
						scope_name: name,
						...(cursor === null ? {} : { cursor }),
					});
					const page = answerRows(result.sessions, get().forgotten);
					set((state) => {
						const entry = state.scopes[key];
						/*
						 * THE PER-SCOPE STAMP GUARD, the twin of the global generation guard in
						 * `fetchSessions`: an answer whose stamp is not the scope's current one
						 * was superseded by a later request for the same group (a collapse and a
						 * re-expand) and must not overwrite it.
						 */
						if (entry === undefined || entry.at !== answerAt) return {};
						/*
						 * A CURSOR THE DAEMON COULD NOT USE IS A RE-READ, NOT AN EXTENSION.
						 * `cursor_missing` means this answer is the scope's FIRST page, so
						 * appending it to the ids a failed cursor was standing on would draw the
						 * same rows twice, in an order no ranking produced.
						 */
						const extending = cursor !== null && result.cursor_missing !== true;
						const answer = scopeAnswerRows({
							sessions: state.sessions,
							previousIds: extending ? entry.ids : [],
							page,
							merge: mergeRow,
						});
						const nextCursor = normalisedCursor(result.next_cursor);
						return {
							sessions: answer.rows,
							scopes: {
								...state.scopes,
								[key]: {
									ids: answer.ids,
									nextCursor,
									loading: false,
									error: null,
									at: answerAt,
								},
							},
						};
					});
				} catch (error) {
					set((state) => {
						const entry = state.scopes[key];
						if (entry === undefined || entry.at !== answerAt) return {};
						return {
							scopes: {
								...state.scopes,
								[key]: {
									...entry,
									loading: false,
									error: storeErrorMessage(
										error,
										"Could not load this group's chats.",
									),
								},
							},
						};
					});
				}
			},
			clearScope: (kind, name) => {
				const key = catalogueScopeKey(kind, name);
				set((state) => {
					const entry = state.scopes[key];
					if (entry === undefined) return {};
					const scopes = { ...state.scopes };
					delete scopes[key];
					/*
					 * COLLAPSING A GROUP TAKES ITS ROWS OUT OF THE STORE (round 1, U5).
					 *
					 * Before this, the rows a group had fetched stayed in `sessions` after the
					 * disclosure was closed: they were no longer drawn under the group, but they
					 * were still counted in the section headings and still drawn in the flat
					 * `Previous chats` list until the next head answer happened to drop them -
					 * rows the reader had closed away, in a list they were still scrolling.
					 *
					 * WHAT IS REMOVED IS EXACTLY THE SCOPE'S OWN ROWS: the ids it fetched that
					 * the head page did NOT carry. A row the head page also carried belongs to
					 * the head, which is still drawing it.
					 */
					/*
					 * AND THE OPEN CONVERSATION (round 2, R2-1). The U5 fix above removed a
					 * group's own rows on collapse, which re-entered R3 through this door: open a
					 * conversation inside a group that sits past the head page, collapse the group,
					 * and the row the transcript pane is drawing is gone - and it does not heal,
					 * because the live-title upsert is presence-guarded and the head page is above
					 * its rank. Collapsing a group is a statement about the GROUP, never about the
					 * conversation the reader has open.
					 */
					const active = state.activeSessionId;
					const owned = new Set(entry.ids);
					const fromHeadPage = new Set(state.head.pageIds);
					const sessions = state.sessions.filter(
						(row) =>
							!owned.has(row.session_id) ||
							fromHeadPage.has(row.session_id) ||
							(active !== null && row.session_id === active),
					);
					return { scopes, sessions };
				});
			},
			setCataloguePageable: (pageable) => {
				if (get().cataloguePageable !== pageable)
					set({ cataloguePageable: pageable });
			},
			setDraftWarmable: (warmable) => {
				if (get().draftWarmable === warmable) return;
				set({ draftWarmable: warmable });
				/*
				 * RE-ARM ON ARRIVAL (review round 1, MINOR-1). On a cold start the pane's
				 * first keystroke can beat the capability query's answer, and the composer's
				 * edge fires once per message - so without this the whole first sentence
				 * silently degrades to the pre-draft wiring, which is the one case the
				 * keystroke policy exists to cover. The ACTIVE draft is the pane in view
				 * (every pane action stages it; `setActiveSession` clears it); if it already
				 * holds text and nothing has minted yet, this transition is the moment the
				 * mint becomes possible, and the call is the same silent, receipt-stable one
				 * the keystroke edge makes. A pane with no text waits for its own keystroke,
				 * exactly as before.
				 */
				if (!warmable) return;
				const key = get().activeDraftKey;
				const draft = key ? get().drafts[key] : undefined;
				if (!key || !draft || draft.sessionId || draft.warmId) return;
				const held =
					useConversationInputStore.getState().inputByConversation[key]
						?.currentInput;
				if (held) get().ensureDraftWarm(key);
			},
			setArchiveUndo: (offer) => {
				set({ archiveUndo: offer });
			},
			setDraftsUndo: (offer) => {
				set({ draftsUndo: offer });
			},
			raiseBulkReadDeferral: (count) => {
				set((state) => ({
					bulkReadDeferral: { count, at: state.answerSeq + 1 },
				}));
			},
			clearBulkReadDeferral: () => {
				set({ bulkReadDeferral: null });
			},
			setStagedByDiscard: (key) => {
				set({ stagedByDiscard: key });
			},
			restoreDraftsUndo: () =>
				set((state) => {
					const offer = state.draftsUndo;
					if (!offer) return {};
					const drafts = { ...state.drafts };
					for (const [key, entry] of Object.entries(offer.drafts)) {
						if (key in drafts) continue;
						drafts[key] = entry;
					}
					/*
					 * THE COMPOSER SIDE GOES BACK THROUGH ITS OWN STORE'S DOOR (`restoreRow`),
					 * and only where the key is not currently holding prose: `clearAll` dropped
					 * the row, so the snapshot IS the payload — text, chips, replies and the
					 * up-arrow log — and it goes back whole. A row the reader has since typed
					 * into wins over the offer, because their newer text is the state they mean.
					 */
					const input = useConversationInputStore.getState();
					for (const [key, row] of Object.entries(offer.composer)) {
						const current = input.inputByConversation[key];
						const occupied =
							(current?.currentInput ?? "").length > 0 ||
							(current?.pendingText ?? null) !== null;
						if (occupied) continue;
						input.restoreRow(key, row);
					}
					return { drafts, draftsUndo: null };
				}),
			clearArchiveFailure: () => {
				set({ archiveFailure: null });
			},
			setSessionArchived: async (sessionId, archived, title) => {
				/*
				 * STAMPED, AND A PRESS CHANGES THE INTENT RATHER THAN THE LIST (design round 8, D27).
				 * The fact is still written optimistically - it is what tells every reader where this
				 * conversation is GOING - but the press no longer patches `sessions`, and that patch was
				 * what removed the row. THE ROW CARRIES THE ANSWERED STATE, THE FACT CARRIES THE
				 * INTENDED ONE: the two row-facing readers take only answered facts (the list's one
				 * filter and the row's own drawn value, both through `chat-archived.ts`'s answered
				 * view), so a press may change what a conversation is about to be without changing
				 * what the list holds.
				 *
				 * WHY THAT IS THE FIX RATHER THAN A TIDIER SHAPE, at QA round 4's own numbers: the row's
				 * departure shortens the list's content by its own height while the box is still the
				 * band-0 one, so `scrollHeight - clientHeight` goes NEGATIVE, the browser clamps the
				 * reader's `scrollTop` to the new extent, and nothing gives it back when the row
				 * returns - the `8.5 -> 0` QA measured. The same dip exists on the SUCCESS path
				 * (`224.5` of content against a `248` box) whenever the departure and the band that
				 * answers it land in different commits, which is why the offer below is raised in the
				 * same update as the fact's settlement. Taking the departure out of the press takes the
				 * dip out of the state, which is arithmetic rather than a race a write could lose.
				 *
				 * THE PRESS'S ACKNOWLEDGEMENT IS WHAT THIS COSTS, stated rather than implied: the row the
				 * reader pressed stays drawn for the round trip - 2-4 ms on this app's own daemon, and
				 * the whole in-flight window on a stalled one, where the press reads as inert until the
				 * card lands. Design D28 records the register that should pay it (the row's own control,
				 * which the reader is already on); it is not invented here.
				 *
				 * THE ASSUMPTION THE STAMP RESTS ON IS OWED TO QA, and this is where it is
				 * written down rather than assumed silently. A press takes the sequence the
				 * NEXT request will take, so every reader that starts after it carries a
				 * stamp greater than the fact's and settles it (`factsNewerThan`). That is
				 * sound only if a read WHOSE REQUEST STARTED AFTER THIS PRESS observes the
				 * write - i.e. if the daemon applies `POST .../archive` before it answers a
				 * read issued afterwards. Over two connections and more than one worker that
				 * is the route's business, not this client's: if it does not hold, an answer
				 * can say `archived: false`, the fact is settled, and the row reappears
				 * until the next page. QA settles what the sibling route guarantees; the
				 * client's half (stamp, membership, refusal register) is what is exercised here.
				 */
				const at = get().answerSeq + 1;
				/*
				 * THE FACT THIS PRESS REPLACES, kept so a refusal can put it back (see the catch arm). With
				 * membership and the row's drawn value both read from the fact, the fact IS the client's
				 * knowledge - so deleting the press's own write without restoring what it stood for would
				 * leave a conversation the daemon holds archived reading as live (`row.archived` is the wire's
				 * value, and the wire's last word was the page BEFORE the accepted archive). Measured on this
				 * walk's refused-undo step: the row came back into a list that excludes archived rows.
				 */
				const previousFact = get().archiveFacts[sessionId] ?? null;
				const rowTitle =
					title ??
					get().sessions.find((row) => row.session_id === sessionId)?.title;
				set((state) => ({
					answerSeq: at,
					archiveFacts: {
						...state.archiveFacts,
						/* UNANSWERED until the write's own sentence arrives (`ArchiveFact.answered`). */
						[sessionId]: { archived, at, answered: false },
					},
				}));
				/*
				 * A PRESS DOES NOT RETIRE THE REFUSAL ABOUT ITS OWN CONVERSATION, and this is a
				 * correction rather than a detail: the version that shipped cleared it here, and
				 * the clear is what took the RETRY's own answer off the screen.
				 *
				 * The toast surface has ONE stable id for both of its messages (`ARCHIVE_TOAST_ID` in
				 * `components/undo-toasts.tsx`), so a refusal that follows a dismissal of that id within
				 * sonner's own unmount window is merged into the entry that is being removed and
				 * destroyed with it - measured against the installed sonner 2.0.3 in jsdom
				 * (2026-09-21): created on the dismissed id, the toast is painted at +50ms and
				 * gone by +600ms, while the same create 600ms later mounts normally. A fast
				 * daemon answers the retry in 2-4ms, which is squarely inside that window, so the
				 * clearing above left "Retry" doing nothing at all: the message was dismissed and
				 * the refusal that replaced it never mounted (UX report round 1, U3).
				 *
				 * WHAT RETIRES IT INSTEAD, in this order: a refusal that lands replaces the one on
				 * screen through the SAME id (sonner updates the mounted toast in place, which is
				 * what one-message-at-a-time means here); an accepted archive supersedes it with
				 * the offer (`offerArchiveUndo` in `archive-undo.ts`); an accepted unarchive has no
				 * successor and clears it below; and any other press leaves it alone, because the
				 * sentence describes the last answer to a press on that conversation rather than a
				 * state the newer press has already settled.
				 */
				try {
					await desktopResult<{ session_id: string; archived: boolean }>({
						op: "sessions.archive",
						sessionId,
						archived,
					});
					/*
					 * AND THE WRITE IS ANSWERED: the fact is settled, which is what retires the offer
					 * that press raised (`ArchiveFact.answered`), and the refusal it was written over is
					 * cleared in the same update - the two halves cannot be separated without leaving a
					 * window in which the offer is retired and the refusal it replaced is still the
					 * store's newest word about that conversation.
					 *
					 * AND THE OFFER IS RAISED HERE TOO, IN THIS SAME UPDATE (design round 8, D27's second
					 * clause). It used to be raised a microtask later by whichever caller pressed - the
					 * row's `.then`, the header's, `/archive`'s - i.e. in a SECOND React commit; the original
					 * rationale was row space (the departure and the band that answered it had to be one
					 * commit, and the commit between them is the one that measured `224.5` of content
					 * against a `248` box, so the browser clamped the reader). The band was retired with the
					 * lane (2026-09-27: the offer is an ordinary toast again), and the single-update
					 * property is kept on its own footing: one act, one update - the same shape the
					 * refusal's own replacement keeps below - so no commit the surface draws can hold a
					 * settlement and the message it supersedes at once. The guard is `archived === true`, which is
					 * also what keeps the unarchive path offerless: the row comes back into the list,
					 * which is its own visible trace (UX round 1, U2).
					 *
					 * AND THE REFUSAL THIS CONVERSATION'S OWN LAST PRESS LEFT IS RETIRED IN THE SAME
					 * UPDATE, for an archive as well as for an unarchive: the toast holds one message under
					 * one id, so raising the offer is what takes the refusal off the screen, and clearing it
					 * in a second update would leave a window in which the store holds neither message and
					 * the surface dismisses the toast - the create-then-destroy mechanism UX round 1, U3 is
					 * about. `archive-undo.ts` raised the offer and cleared the refusal together for exactly
					 * this reason; both are here now, and the offer's own retirement watch stays with its
					 * module (`useArchiveUndoRetirement`).
					 *
					 * Currency, like the refusal arm below: only the newest press for this conversation
					 * may settle it. An older press's acceptance is an answer about a state the newer
					 * press has already replaced.
					 */
					set((state) => {
						const fact = state.archiveFacts[sessionId];
						const superseded = fact?.at !== at;
						return {
							archiveFacts: superseded
								? state.archiveFacts
								: {
										...state.archiveFacts,
										[sessionId]: { archived, at, answered: true },
									},
							/*
							 * AN ACCEPTED ARCHIVE STANDS THE OFFER, an accepted unarchive clears it (it has no
							 * successor action) - and a SUPERSEDED settlement touches neither message, because
							 * the newer press owns both the fact and the message about it.
							 */
							archiveUndo: superseded
								? state.archiveUndo
								: archived
									? {
											sessionId,
											/* `rowTitle` is the row's own title, which the wire may answer as null. */
											title: rowTitle ?? undefined,
											archived: true,
											at,
										}
									: null,
							archiveFailure:
								state.archiveFailure?.sessionId === sessionId
									? null
									: state.archiveFailure,
						};
					});
					return true;
				} catch (error) {
					set((state) => {
						/*
						 * A REFUSED PRESS IS REVERTED ONLY IF IT IS STILL THE NEWEST WRITE for
						 * this conversation. A second press made while the first was in flight
						 * owns the row now, and reverting on the older one's failure would undo
						 * the newer press - the failure of a request the user has already moved
						 * on from is not a statement about what is on screen.
						 *
						 * THE REVERT IS THE FACT, AND RESTORING IT IS THE WHOLE OF IT (design round 8, D27): the
						 * press patched neither `sessions` nor any other row state, so a refused write puts back
						 * the fact it REPLACED - or, when there was none, leaves none. Both row-facing readers
						 * then read what they read before the press, which is the same observable claim the version
						 * that patched the row made. Deleting the fact instead would be a revert to the WIRE's
						 * value, and the wire's last word about this conversation predates the accepted write the
						 * fact was standing for: measured on the walk's refused-undo step, the row came back into
						 * a list that excludes archived rows because the client forgot it had archived it.
						 *
						 * What used to be guarded, and still is, is the REPORT: this guard returned the state
						 * untouched once, which dropped the refusal with it - so a write that really was refused
						 * was answered on screen only when no catalogue answer had settled the fact first. Measured
						 * against the real store (the fixture shape `scripts/session-archive-delete.test.mjs` uses,
						 * 2026-09-21): press, then a page whose request STARTS after the press answers before the
						 * write's rejection, and `archiveFailure` stays `null` - the press silently does nothing,
						 * the one outcome the refusal exists to prevent. The panel's list read is a 5s poll and
						 * every catalogue frame, so that ordering is ordinary rather than exotic.
						 *
						 * The message is a fact about the press (the write was refused) while the fact's own
						 * restoration is a fact about the intent, and the two have different owners: the sentence
						 * belongs to the last press that was actually answered, and a superseded press owns
						 * neither.
						 */
						const superseded = state.archiveFacts[sessionId]?.at !== at;
						const facts = { ...state.archiveFacts };
						if (!superseded) {
							/*
							 * AND WHAT GOES BACK IS AN ANSWERED FACT OR NOTHING (agent review round 5, R5-2).
							 *
							 * Restoring `previousFact` verbatim put back an UNANSWERED intent whenever the press
							 * being refused had displaced one that was still in flight - and the two row-facing
							 * readers skip unanswered facts, so the restore wrote a fact that could not be read at
							 * all. Reproduced on this suite's own fixture with two presses before either answer:
							 * press 1 (archive) is displaced by press 2 (unarchive), press 1's acceptance arrives
							 * first and bails as superseded, and press 2's refusal then restored
							 * `{archived:true, at:2, answered:false}`, leaving the client with no readable
							 * knowledge of an archive the daemon had just ACCEPTED.
							 *
							 * THE RULE: a refusal puts back the fact it replaced only when that fact had been
							 * ANSWERED. An unanswered fact is a press's INTENT, and this client cannot vouch for an
							 * intent whose own answer may already have been discarded by the currency rule beside
							 * this one - so it removes its own write instead.
							 */
							if (previousFact?.answered === true) {
								facts[sessionId] = previousFact;
							} else {
								delete facts[sessionId];
								/*
								 * AND THE CLIENT ASKS RATHER THAN KEEPING NEITHER: with that intent gone this window
								 * knows nothing about the conversation's archive state while the daemon does, so the
								 * page is read again. Without it the row reads the wire's stale value until the 5s
								 * poll - the whole of the window in which a reader would act on it. A press with no
								 * fact behind it has nothing to re-learn, so only a displaced intent asks.
								 */
								if (previousFact !== null) void get().fetchSessions();
							}
						}
						return {
							archiveFacts: superseded ? state.archiveFacts : facts,
							/*
							 * THE REFUSAL TAKES ITS OWN STAMP, AND THE COUNTER MOVES WITH IT. Both archive messages
							 * used to be stamped from the SAME counter (the refusal took `state.answerSeq` as it
							 * stood), so a refusal landing in the answer that re-raised an offer TIED with it -
							 * and a tie is exactly the state the drawing rule now resolves in the refusal's favour
							 * (see the drawn-message rule and its comment in `components/undo-toasts.tsx`). Advancing the
							 * counter here makes a refusal that lands LAST strictly newer, which is what its own
							 * sentence says it is: the last press the daemon actually answered.
							 */
							answerSeq: state.answerSeq + 1,
							archiveFailure: {
								sessionId,
								/*
								 * THE STAMP IS THE CURRENCY THE TOAST SURFACE READS (agent review round 3, R3-1). Taken from
								 * `answerSeq` at the landing: a later successful archive's offer carries a higher
								 * one, which is what lets the surface draw the newer message instead of preferring
								 * the refusal forever.
								 */
								at: state.answerSeq + 1,
								archived,
								title: rowTitle || "Untitled chat",
								/*
								 * The backend's own sentence when there is one. A transport failure
								 * that reached nothing keeps an empty detail and the sentence around
								 * it states the fact: the row did not move.
								 */
								detail:
									error instanceof DesktopControlError && error.message
										? error.message
										: "",
							},
						};
					});
					return false;
				}
			},
			deleteSession: async (sessionId) => {
				try {
					await desktopResult<{ session_id: string; deleted: boolean }>({
						op: "sessions.delete",
						sessionId,
						/* The user's own answer to the danger dialog, on the wire. */
						confirmed: true,
					});
					set((state) => forgetSession(state, sessionId));
					return { ok: true };
				} catch (error) {
					const status =
						error instanceof DesktopControlError ? error.status : null;
					const code =
						error instanceof DesktopControlError ? (error.code ?? null) : null;
					/*
					 * A 404 IS THE OUTCOME THE USER ASKED FOR, and it is not reported as a
					 * failure: the route answers it for an id this daemon does not have, so the
					 * conversation the user asked to remove is not there to remove. The row is
					 * dropped for the same reason a confirmed delete drops it - otherwise the
					 * panel would keep drawing a conversation the backend has just denied
					 * holding, and the next page would take it away anyway.
					 */
					if (status === 404) {
						set((state) => forgetSession(state, sessionId));
						return { ok: true };
					}
					/*
					 * THE TOKEN, NOT THE STATUS (agent review round 4, R4-3). 409 is one arm of
					 * the route's ladder for FOUR guards - a live session, an armed wake, unread
					 * mail, and a guard whose store could not be read - and the backend's own
					 * docstring says the split is deliberate: the code "names the condition (a
					 * client keys on it)" while the SENTENCE names the specific remedy. That arm
					 * is shared with unrelated refusals (`AttachmentUnavailable`,
					 * `ProfileRegistryUnavailable`, the generic `HTTPException(409, ...)`), so
					 * keying on the status would claim a delete guard for any of them;
					 * `DesktopControlError.code` carries `detail.code` and `session_delete_refused`
					 * is the daemon's own token for exactly this condition.
					 *
					 * So this field is named for the condition the client can see (a guard
					 * refused) rather than for a cause it cannot infer, which is what QA round 3's
					 * Q11 measured: a wake refusal used to be reported as `live` and drawn with
					 * advice about stopping a session.
					 *
					 * The backend's sentence is the one that names the guard - quoted rather than
					 * paraphrased here, because a client that re-words a guard it does not own
					 * drifts from the route the moment the route changes. Every other failure
					 * keeps whatever sentence the transport or the daemon authored.
					 */
					return {
						ok: false,
						guarded: code === "session_delete_refused",
						detail:
							error instanceof DesktopControlError && error.message
								? error.message
								: "The conversation could not be deleted.",
					};
				}
			},
			requestSessionDelete: (sessionId) => set({ deleteCandidate: sessionId }),
			requestArchiveConfirm: (candidate) =>
				set({ archiveCandidate: candidate }),
			createSession: async (
				cwd,
				target,
				requestId = crypto.randomUUID(),
				model?: DesktopModelSelection | null,
				/**
				 * The minted draft this conversation was warmed on, when the pane has
				 * one: the create adopts the id (and the already-engaged runtime)
				 * instead of minting a fresh session. Omitted — leaving the body
				 * byte-for-byte the one this op sent before drafts could be warmed —
				 * when the pane never minted, and a daemon that cannot resolve the id
				 * mints fresh rather than refusing the send.
				 */
				draftId?: string,
				/**
				 * The device to create the conversation ON, when the pane's device control
				 * picked a peer (`features.peers`; `CreateSession.peer` on the wire).
				 *
				 * OMITTED WHEN NOTHING WAS PICKED, the same omission rule as `model` and
				 * `draftId`: the body then stays byte-for-byte the one this app sent before
				 * the control existed, which is what makes the field additive for every
				 * caller and every older daemon.
				 */
				peer?: string,
			) => {
				try {
					const result = await desktopResult<{
						session_id: string;
						binding: CanonicalSessionRow["binding"];
					}>({
						op: "sessions.create",
						requestId,
						cwd,
						...(target ? { target } : {}),
						/*
						 * Omitted, not nulled, when the user picked nothing: the wire body then
						 * stays byte-identical to the one this app sent before the draft's chips
						 * could open, which is what makes the capability additive for every
						 * caller that never used it.
						 */
						...(model ? { model } : {}),
						// The same omission rule for the minted draft, and the same promise:
						// absent leaves this request byte-for-byte what it was before drafts
						// could be warmed. The draft row's own note explains the lifecycle.
						...(draftId ? { draftId } : {}),
						// And the third: a pane that never picked a device sends no `peer`, so its
						// create is exactly what it always was.
						...(peer ? { peer } : {}),
					});
					get().upsertSession({
						session_id: result.session_id,
						cwd,
						binding: result.binding,
					});
					/*
					 * A CONVERSATION BORN ON A PEER SAYS SO ON ITS ROW, and the write that says
					 * it is the SAME one a move's receipt uses (`settlePlacement` below), so
					 * the row's pair and the placement FACT behind it (`PlacementFact`) are one
					 * write rather than two that can drift: this call is the create's writer,
					 * the receipt is the move's. The fields are the wire's own - the same pair
					 * a peer-aware listing publishes (`mesh-types.ts`) - so nothing downstream
					 * learns a second vocabulary, and the fact's currency is what lets the
					 * peers reads that DO carry the id settle it.
					 *
					 * THE DEFECT THIS FEEDS: on create success the send patches `sessionId`
					 * and retires the draft, so the pane's only placement fact used to be "not
					 * a move issued here" - and the plain page fired by the create's own answer
					 * rebuilds membership without the id (a plain listing never asks for
					 * peers), dropping the row the header's device control reads and falling
					 * through to `On this device` over a conversation the peer had just minted
					 * (operator report, 2026-09-30; reproduced on the two-daemon rig,
					 * 2026-10-05, 231 ms after the send).
					 *
					 * FOR A LOCAL CREATE NOTHING IS WRITTEN AT ALL: its row is byte-for-byte
					 * what it was before this call existed, and no arm of the control consults
					 * it.
					 */
					if (peer) {
						get().settlePlacement(result.session_id, {
							locality: "remote",
							owner_device: peer,
						});
					}
					return result.session_id;
				} catch (error) {
					// Same rule as `fetchSessions` above: the app states the refusal's own
					// consequence rather than repeating the server's words (UX round 2, U1).
					set({
						error: storeErrorMessage(
							error,
							"Chat could not start. Retry with the same draft.",
						),
					});
					throw error;
				}
			},
			setActiveSession: (activeSessionId) => {
				set({
					activeSessionId,
					activeDraftKey: null,
					validatingSessionId: null,
				});
			},
			/*
			 * The stopped-turn fact's two writers (UX round 2, U7; `stoppedTurns` carries
			 * what it is for). `at` is the press's own instant rather than the receipt's,
			 * and it is what the reducer compares a tool row's `startedAt` against: a call
			 * that was ALREADY running when the user pressed stop is one the stop killed,
			 * and a call that started afterwards cannot exist because the turn ended.
			 */
			markTurnStopped: (sessionId, at = Date.now()) =>
				set((state) => ({
					stoppedTurns: { ...state.stoppedTurns, [sessionId]: at },
				})),
			clearTurnStopped: (sessionId) =>
				set((state) => {
					if (!(sessionId in state.stoppedTurns)) return state;
					const { [sessionId]: _dropped, ...rest } = state.stoppedTurns;
					return { stoppedTurns: rest };
				}),
			/**
			 * Open a draft this store ALREADY holds, by its key.
			 *
			 * WHY THIS IS NOT `stageDraft` (UX round 2, U8). `stageDraft(undefined, true)`
			 * — which is what `⌘N` calls — mints a FRESH `draft:<uuid>` key every time, and a
			 * draft pane's identity IS that key: the composer's text is persisted under it
			 * (`conversation-input-store`, `inputByConversation[draft:<uuid>]`), so pressing
			 * ⌘N with text in the box did not delete the text, it moved the window to a key
			 * nothing on screen pointed at. The text was unreachable rather than absent, and a
			 * relaunch restored a draft no route could name.
			 *
			 * So the second half of the fix is a way BACK to a key that exists, which is what
			 * the sidebar's `Draft:` rows call. There is no fresh key here, no new
			 * `createRequestId` and no re-admission: this is a navigation between two panes
			 * this store is already holding, and minting anything would be the same discard
			 * one release later.
			 *
			 * A key whose row is gone is a NO-OP rather than a blank pane: the caller can be a
			 * row rendered from persisted state a moment before a `discardDraft` lands, and
			 * switching to a key with no draft would leave `activeDraftKey` naming nothing.
			 */
			openDraft: (key) => {
				if (!get().drafts[key]) return;
				set({
					activeDraftKey: key,
					activeSessionId: null,
					validatingSessionId: null,
					error: null,
				});
			},
			/*
			 * A guard rather than an assignment: a live frame belongs to the session
			 * that streamed it, and the view may already be somewhere else. Clearing
			 * unconditionally here would let an abandoned target's own snapshot vouch
			 * for a window the user is no longer waiting in.
			 */
			confirmSessionLive: (sessionId) => {
				if (sessionId && get().validatingSessionId === sessionId)
					set({ validatingSessionId: null });
			},
			confirmSessionMissing: (sessionId) => {
				if (!sessionId || get().validatingSessionId !== sessionId) return;
				set({
					validatingSessionId: null,
					...forgetSession(get(), sessionId),
				});
			},
			rearmReadAck: (sessionId) => {
				set((state) => ({
					readAckRearm: rearmedReadAck(state.readAckRearm, sessionId),
				}));
			},
			publishReadAckNotice: (sessionId, kind, reason) => {
				set((state) => {
					const notice = state.readAckNotice;
					// Identity, not equality: the writer is a 500 ms poll, and a state that
					// re-renders every row twice a second for a statement that has not
					// changed is the cost this guard exists to avoid (see the action's doc).
					if (notice?.sessionId === sessionId && notice.kind === kind)
						return state;
					return {
						readAckNotice: {
							sessionId,
							kind,
							revision: (notice?.revision ?? 0) + 1,
							reason,
						},
					};
				});
			},
			clearReadAckNotice: (sessionId) => {
				set((state) =>
					state.readAckNotice?.sessionId === sessionId
						? { readAckNotice: null }
						: state,
				);
			},
			applyAttention: (sessionId, attention) => {
				set((state) => {
					const sessions = mergeAttentionInto(
						state.sessions,
						sessionId,
						attention,
					);
					// Identity, not equality: an unchanged merge must not re-render every
					// row of a 500-row sidebar for a beat that carried nothing new.
					return sessions === state.sessions ? state : { ...state, sessions };
				});
			},
			applyAttentionMany: (states) => {
				set((state) => {
					let sessions = state.sessions;
					for (const attention of states) {
						/*
						 * The identity is DERIVED from the state's own namespaced
						 * `conversation_id`, never taken from the caller: the bulk answer's
						 * buckets name conversations rather than positions, so pairing
						 * them with the request positionally would make the response's order
						 * part of the contract. A state whose id is not a `session/<id>`
						 * conversation, or whose session left the catalogue, is dropped by
						 * `mergeAttentionInto` — it returns the same array, and the loop
						 * carries on without a write.
						 */
						const conversationId = attention?.conversation_id;
						// The namespace is the backend's own (`session/<id>`), written as the
						// literal the rest of this tree compares against rather than
						// invented as a second constant.
						if (
							typeof conversationId !== "string" ||
							!conversationId.startsWith("session/")
						)
							continue;
						sessions = mergeAttentionInto(
							sessions,
							conversationId.slice("session/".length),
							attention,
						);
					}
					return sessions === state.sessions ? state : { ...state, sessions };
				});
			},
			markAllRead: async () => {
				/*
				 * Enumerated from the STORE rather than from the rendered list, which is
				 * what makes the control's own count and this batch the same fact: a
				 * search filter over the sidebar cannot make a visible count disagree
				 * with the set that is sent. The predicate itself is `unreadAckableRows`
				 * — the ONE home of that rule, so the surface's label and this request
				 * cannot drift apart.
				 */
				const items = unreadAckableRows(get().sessions).map((row) => ({
					sessionId: row.session_id,
					completionToken: row.attention?.completion_token as string,
				}));
				/*
				 * Nothing unread is not an empty request: `items` has a 1-item floor on
				 * the wire, and a batch of zero would clear nothing while still costing
				 * a round trip and a store write. Resolving without a request is also
				 * what keeps the caller's receipt honest — zero attempted, zero cleared.
				 */
				if (items.length === 0)
					return {
						attempted: 0,
						cleared: 0,
						superseded: 0,
						unknown: 0,
						deferred: 0,
					};
				const receipt = await desktopResult<CompletionAttentionAckReceipt>({
					op: "attention.seen",
					items,
				});
				get().applyAttentionMany(receipt.read);
				/*
				 * WHY THE UNKNOWN BUCKET IS SPLIT: see the action's own docblock above
				 * (`deferred`) - the subset of `unknown` whose ids this client's state
				 * calls remote, which the surface's copy names separately so a deferral
				 * does not read as a failure.
				 */
				const remote = remoteOwnedIds(get().sessions, get().placementFacts);
				const deferred = receipt.unknown.filter((id) => remote.has(id)).length;
				return {
					attempted: items.length,
					cleared: receipt.read.length,
					superseded: receipt.superseded.length,
					unknown: receipt.unknown.length,
					deferred,
				};
			},
			applySessionStatus: (sessionId, status, revision, epoch) => {
				set((state) => {
					const index = state.sessions.findIndex(
						(row) => row.session_id === sessionId,
					);
					/*
					 * EVERY STAMP FROM ANOTHER EPOCH IS RETIRED, not every stamp when the
					 * epoch merely moved: a row stamped with THIS epoch (a list response
					 * produced by the process now serving us, which can land before the
					 * first frame of its epoch) holds a live counter, and dropping it would
					 * hand a later, staler list the win it is being denied.
					 */
					let retired = false;
					const sessions = state.sessions.map((row) => {
						if (
							(row.status_epoch === undefined &&
								row.status_revision === undefined) ||
							row.status_epoch === epoch
						)
							return row;
						retired = true;
						// Omitted rather than set to `undefined`: "no stamp" is an absent key,
						// which is what the list merge and the wire both read.
						const {
							status_revision: _revision,
							status_epoch: _epoch,
							...rest
						} = row;
						return rest;
					});
					if (index < 0) return retired ? { ...state, sessions } : state;
					const row = sessions[index];
					// Identity, not equality: an unchanged frame must not re-render every
					// row of a 500-row sidebar for a level that carried nothing new.
					const unchanged =
						row.status?.code === status.code &&
						row.status?.label === status.label &&
						row.status_revision === revision &&
						row.status_epoch === epoch;
					if (unchanged && !retired) return state;
					if (!unchanged)
						sessions[index] = {
							...row,
							status,
							status_revision: revision,
							status_epoch: epoch,
						};
					return { ...state, sessions };
				});
			},
			openSession: async (sessionId) => {
				/*
				 * RE-SELECTING THE ROW THE VIEW IS ALREADY ON IS A NO-OP.
				 *
				 * The window below has two closing bounds and only one of them is
				 * reachable for a session that is already active: the live frame is
				 * reported by an effect keyed on the session and its stream status
				 * (`chat-page`), and neither changes when the same row is clicked again -
				 * so the frame that already arrived is never reported for the new window,
				 * and the read's latency (up to its own deadline) is the only thing that
				 * closes it. That window refuses sends and reports why, which is a refusal
				 * the user cannot act on, for a switch that moves nothing: the view, the
				 * draft and the URL are already at the target, so `true` - the answer that
				 * says the switch stands - is the right one.
				 *
				 * `activeDraftKey` is part of the condition rather than decoration: a
				 * staged draft is a different view of the same session (the sidebar does
				 * not mark the row while one is staged), so a click that leaves it is a
				 * real move and still runs the whole switch.
				 *
				 * THE PRESS STILL STAMPS THE RECEIPT'S RE-ARM on both arms, which is the one
				 * thing this action does that is NOT a no-op when the target is already
				 * active. The press is the operator's own statement that they are looking
				 * at this conversation now, and the acknowledgement of its completed result
				 * is what that statement has to release: a retry the shared ladder had
				 * pushed out (a `store_busy` refusal it did not classify, today) left the
				 * row's mark standing over a result the operator was looking at, and their
				 * only remedy - clicking the row again - was read as "nothing happened"
				 * (the reported defect). `readAckRearm` states why it is one record and not
				 * a log; `useCompletionView` is the only reader.
				 */
				if (get().activeSessionId === sessionId && !get().activeDraftKey) {
					get().rearmReadAck(sessionId);
					return true;
				}
				/*
				 * COMMIT, AND LET THE CONVERSATION'S OWN STREAM VALIDATE IT.
				 *
				 * This used to await a `sessions.get` guard read behind the commit, and
				 * that read was the gate on sending: `validatingSessionId` stayed set
				 * until it answered. It was a SECOND full facade acquire on the backend
				 * for every click (`GET /v1/desktop/sessions/{id}`), racing the stream's
				 * own acquire for the same bridge locks - 30-60 ms on a healthy owner,
				 * 4 s behind a silent one, and 17-20 s behind a control call in flight,
				 * where it hit the renderer's own deadline (the desktop load diagnosis,
				 * D-F3). The stream answers the same question with nothing extra: its
				 * first `snapshot` frame proves the session exists (`confirmSessionLive`,
				 * reported by `chat-page`), and a 404 on the subscription proves it does
				 * not (`use-canonical-session`'s `missing` arm, which the pane already
				 * renders as the one missing-session notice).
				 *
				 * What that changes, stated because each was a property of the old read:
				 *
				 * - THE WINDOW stays. A send addressed to a session nothing has confirmed
				 *   is still refused with `SESSION_UNVALIDATED_MESSAGE`; the window is
				 *   now closed by the snapshot, which is the frame that paints the
				 *   messages, so "messages on screen" and "the composer sends" land in
				 *   the same commit rather than one round trip apart.
				 * - A GONE TARGET still tombstones, from the stream instead of the read: a
				 *   404 on the subscription raises `view.missing`, and `chat-page` reports
				 *   it through `confirmSessionMissing`, which is the old not-found arm
				 *   verbatim (`forgetSession`, window closed, view left on the target).
				 *   A deep link to a deleted conversation still lands on the notice.
				 * - THERE IS NO ROLLBACK. A transient failure used to put the view back
				 *   on the outgoing conversation with a sentence; now the target pane
				 *   states it itself - the stream's own `reconnecting`/`unavailable`
				 *   notice with its Retry - which is the conversation the user asked
				 *   for, rather than the one they left. `navigationError` had no other
				 *   writer, so it goes with it.
				 * - The return value is `true`: the switch stands the moment it is made,
				 *   and nothing later can disprove it into a URL restore. It stays a
				 *   Promise so the three entrances (`open-conversation.ts`, the schedules
				 *   page and the route effect) keep their shape.
				 *
				 * The generation counter (`navigationGeneration`) goes with the read:
				 * its only reader was this action's own "is my read still current?"
				 * check, and with no read in flight there is nothing for a newer
				 * navigation to supersede. Latest-wins is now the plain `set` below.
				 */
				set({
					activeSessionId: sessionId,
					activeDraftKey: null,
					validatingSessionId: sessionId,
					error: null,
				});
				// The same stamp as the no-op arm above, for the same reason: this press is
				// the operator's statement that they are looking at this conversation now.
				get().rearmReadAck(sessionId);
				return true;
			},
			stageDraft: (target, fresh = false) => {
				const key =
					!fresh && target
						? `draft:${target.kind}:${target.name}`
						: `draft:${crypto.randomUUID()}`;
				const existing = get().drafts[key];
				set((state) => ({
					activeDraftKey: key,
					validatingSessionId: null,
					error: null,
					drafts: {
						...state.drafts,
						[key]: existing ?? {
							key,
							target,
							createRequestId: crypto.randomUUID(),
							admissionRequestId: crypto.randomUUID(),
						},
					},
				}));
				return key;
			},
			/*
			 * RE-STAGE THE PANE'S DRAFT UNDER A PICKED IDENTITY, CARRYING THE BOX'S
			 * TEXT (issue #780).
			 *
			 * The same act the sidebar's "New chat with <team>" performs through
			 * `stageDraft({kind, name})` — with one addition the picking pane forces:
			 * the user is standing ON a draft, mid-composition, and the stage flips
			 * the pane's identity (`draft:<uuid>` -> `draft:<kind>:<name>`), which is
			 * a REMOUNT. The composer reads its text from `conversation-input-store`
			 * under the NEW key, so prose left behind under the old one would vanish
			 * from the box at the exact moment the user picks their team — the text
			 * is where it was, but the pane is not (`panelIdentityFor`, "THE FLIP IS
			 * A REMOUNT").
			 *
			 * `carry` is the text the CALLER has already decided survives the
			 * gesture: the composer's pick splices the command token out and passes
			 * the rest, the dispatcher passes the tail of `/team <name> <tail>`.
			 * `undefined` (the picker dialog's pick, which never re-parses the
			 * draft) carries the box as it stands. The store does not parse drafts.
			 *
			 * The source row's text is CLEARED — a move, not a copy: leaving the
			 * old key holding a token whose command has just been consumed would
			 * resurrect it the next time that key is opened (`openDraft`). A row the
			 * stage REUSES (`draft:<kind>:<name>` already exists) keeps its own text
			 * when nothing is carried, and is overwritten only by text the user is
			 * looking at right now.
			 */
			restageDraft: (target, carry) => {
				const from = get().activeDraftKey;
				const key = get().stageDraft(target);
				const input = useConversationInputStore.getState();
				const text = carry ?? (from ? input.getCurrentInput(from) : "");
				if (text) input.setComposerText(key, text);
				if (from && from !== key) input.setComposerText(from, "");
				return key;
			},
			updateDraft: (key, patch) =>
				set((state) => {
					// A PARTIAL patch onto a row that is gone must not resurrect it.
					// This was a blind spread onto `state.drafts[key]`, so when a draft
					// was abandoned while its admission was still in flight, the settling
					// request's catch rebuilt the row from the patch alone - without
					// `key`, `createRequestId` or `admissionRequestId`. The next send
					// then went to the wire with `requestId: undefined`, which the closed
					// IPC schema rejects, and that refusal re-armed this store's own
					// unchanged-payload guard: every later send failed against a healthy
					// backend with no causal link to the click that caused it. Discard is
					// deliberate and outranks the outcome of the request it abandoned.
					//
					// The condition is identity, not existence, because this setter is
					// also the legitimate CREATE path: `admitChatDraft` opens a send for
					// an already-existing session by patching a `send:<id>` key that has
					// no row yet, and that patch carries the whole identity. So a patch
					// that can stand on its own as a draft may create one; a fragment
					// like `{pending, error}` may only ever update something already
					// there.
					const present = state.drafts[key];
					const complete =
						patch.key !== undefined &&
						patch.createRequestId !== undefined &&
						patch.admissionRequestId !== undefined;
					if (!present && !complete) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: { ...state.drafts[key], ...patch },
						},
					};
				}),
			setDraftPeer: (key, peer) =>
				set((state) => {
					/*
					 * A pick on a pane whose row is gone records nothing: the pane was
					 * discarded while the picker was open, and this must not resurrect it
					 * (the same rule `updateDraft` and `setDraftModel` state).
					 */
					const present = state.drafts[key];
					if (!present) return {};
					const next = peer ?? undefined;
					/*
					 * AN UNCHANGED DESTINATION IS NOT A CHANGE. The self row is a real press
					 * that means "this device", so without this guard a press that picked
					 * nothing new would re-mint the create id and drop a warm intent for a
					 * request that is still the same one.
					 */
					if ((present.peer ?? undefined) === next) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: {
								...present,
								peer: next,
								/*
								 * THE SAME REWRITE `setDraftModel` MAKES, on the same condition: only while
								 * there is still no session. Once one exists the create has already been
								 * made and its id must stay pinned so a replay of that request stays an
								 * idempotent replay. The admission id is NOT re-minted — it addresses the
								 * message, not the create body.
								 */
								...(present.sessionId
									? {}
									: {
											createRequestId: crypto.randomUUID(),
											/*
											 * AND THE WARM INTENT GOES WITH IT: the mint engaged a runtime on THIS
											 * device (`sessions.draft`) and v1 does not re-aim one at a peer. The
											 * mint's own request id is dropped for the reason `setDraftModel` gives:
											 * a receipt replays the FIRST answer, so re-asking under the old key
											 * would hand the pane back a draft id for the old destination.
											 */
											warmId: undefined,
											draftRequestId: crypto.randomUUID(),
										}),
							},
						},
					};
				}),
			setDraftModel: (key, model) =>
				set((state) => {
					/*
					 * A pick on a pane whose row is gone records nothing: the pane was
					 * discarded while the picker was open, and this must not resurrect it
					 * (the same rule `updateDraft` states for a partial patch).
					 */
					const present = state.drafts[key];
					if (!present) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: {
								...present,
								model,
								/*
								 * A new at-most-once key for a changed create body, and only while there
								 * is still no session: once one exists the create has already been made
								 * and its id must stay pinned so a replay of that request stays an
								 * idempotent replay rather than a second conversation. The admission id
								 * is NOT re-minted here — it addresses the message, not the model, and
								 * `admitChatDraft` owns when that becomes load-bearing.
								 */
								...(present.sessionId
									? {}
									: {
											createRequestId: crypto.randomUUID(),
											/*
											 * THE DROP RULE: a runtime warmed from THIS selection is not the one the
											 * new selection would have engaged, and v1 does not re-aim one — it
											 * drops the intent, and the next keystroke re-arms against the new
											 * selection. The mint's request id goes with it: a receipt replays
											 * the FIRST answer, so re-asking under the old key would hand the
											 * pane back the superseded selection's draft id. Regenerated even
											 * when no `warmId` was ever adopted, because a lost response can
											 * leave a receipt (and its registered draft) behind a row that
											 * never learned the id.
											 */
											warmId: undefined,
											draftRequestId: crypto.randomUUID(),
										}),
							},
						},
					};
				}),
			/*
			 * THE FIRST KEYSTROKE OF A NEW CHAT: mint the id the runtime will be
			 * warmed on.
			 *
			 * The pane has no session to warm yet, so without this the multi-second
			 * engage the first send pays sits ON the send path — the complaint this
			 * whole change answers. The mint itself engages nothing: it allocates an
			 * id and registers it for the draft allow-list (`events`/`watch`/`warm`
			 * and the create that adopts it), and the runtime is started separately
			 * by the pane's own warm once its subscription holds the bridge. That is
			 * what makes abandonment free: dropping the pane drops the bridge, and
			 * the same `_detach` that cancels a session's warm cancels this one.
			 *
			 * FIRE AND FORGET, DELIBERATELY. Nothing on the send path awaits this,
			 * the composer is never gated on it, and every failure — transport, an
			 * older daemon that slipped the flag, the fast refusal of a latched
			 * daemon — leaves the send engaging inline exactly as it always did. A
			 * speculative optimisation that could DELAY a send would be strictly
			 * worse than not warming at all.
			 *
			 * The guards, in order: the published capability (fail-closed: a daemon
			 * without the key must never see a mint call, which would spend a
			 * keystroke learning 404); a settled staged directory (the wire's own
			 * 1..4096 bound); no `warmId` yet (a drop clears it, and re-minting is
			 * the next keystroke's job, not this call's); and no `sessionId` (the
			 * create already happened — a mint now would register an id nothing
			 * will ever adopt).
			 */
			ensureDraftWarm: (key) => {
				const state = get();
				if (!state.draftWarmable) return;
				const draft = state.drafts[key];
				if (!draft || draft.sessionId || draft.warmId || !state.cwd) return;
				/*
				 * A DRAFT DESTINED FOR A PEER IS NOT WARMED HERE, and there would be nothing to
				 * warm: `sessions.draft` registers an id on THIS daemon's registry while the
				 * create that adopts it runs on the PEER (the header's control sets the pane's
				 * `peer`, and `sessions.create` sends it). Minting would spend a runtime here
				 * for a conversation that is born on another machine.
				 */
				if (draft.peer) return;
				/*
				 * A STABLE request id, generated lazily and stored BEFORE the request
				 * goes out: two keystrokes landing before the first answer must be one
				 * receipt, so the second asks the same question rather than registering
				 * a second draft. The drop rule — not this action — regenerates it when
				 * the selection changes.
				 */
				const requestId = draft.draftRequestId ?? crypto.randomUUID();
				if (!draft.draftRequestId)
					get().updateDraft(key, { draftRequestId: requestId });
				void desktopResult<{ draft_id: string }>({
					op: "sessions.draft",
					requestId,
					cwd: state.cwd,
					...(draft.target ? { target: draft.target } : {}),
					// Omitted when nothing was picked, exactly as `sessions.create` and the
					// preview omit it: the configured default is the backend's to resolve.
					...(draft.model ? { model: draft.model } : {}),
				})
					.then((result) => {
						/*
						 * Adopt the id only if this row is still the draft that asked and is
						 * still waiting for it. A discarded row is gone; a selection change
						 * regenerated the request id, so this answer names a superseded
						 * draft; a row that already has an id, or a session, is past this
						 * question. Stamping any of those would warm the wrong thing or
						 * leak an id nothing consumes.
						 */
						const row = get().drafts[key];
						if (
							row &&
							!row.warmId &&
							!row.sessionId &&
							row.draftRequestId === requestId
						)
							get().updateDraft(key, { warmId: result.draft_id });
					})
					.catch(() => {
						// Silent, precisely like the session warm: this fires from TYPING, it
						// gates nothing, and the next keystroke retries under the SAME
						// request id — so a lost response heals instead of leaking a draft.
					});
			},
			finishDraft: (key, sessionId) =>
				set((state) => {
					/*
					 * The message is on the owner, so nothing about it is in flight
					 * or waiting to be reconciled any more. Done here rather than by
					 * the caller because every path that ends a send successfully
					 * comes through this action, including the reconciler that
					 * discovers a late delivery after a restart.
					 *
					 * BOTH IDENTITIES THE PRESS TOUCHED, not only the one the pane has
					 * afterwards - `settleSendComposerRecords` carries the why (the
					 * short version: the composer's `inFlight` was written under the
					 * PRE-send key, and settling only the post-flip one left it to
					 * fold back into the box at the next launch).
					 */
					settleSendComposerRecords(key, sessionId);
					const drafts = { ...state.drafts };
					delete drafts[key];
					return {
						drafts,
						...(state.activeDraftKey === key
							? { activeDraftKey: null, activeSessionId: sessionId }
							: {}),
					};
				}),
			discardDraft: (key) =>
				set((state) => {
					/*
					 * A LIVE SEND HOP IS WITHHELD FROM THE ACTS, NOT REFUSED HERE (UX round 1's
					 * U2, remediation, 2026-09-27): the sidebar disables the discard control for
					 * a `pending` row and `Clear all` passes only the settled keys, so a press
					 * can no longer remove a row whose send then lands unread — while THIS
					 * action keeps the semantics its own record pins ("discard is deliberate
					 * and outranks the outcome of the request it abandoned", `updateDraft`'s
					 * no-resurrect guard), which a store-level refusal here would contradict:
					 * a deliberate discard of a mid-flight row is a legal write, and the guard
					 * is what makes the settling request harmless afterwards.
					 */
					const drafts = { ...state.drafts };
					/*
					 * Abandoning the message also drops any echo buffered for its
					 * session. The buffer holds the text and its images as base64
					 * until a panel mounts, and a discarded draft is the case where
					 * one may never do - so this is the user's deletion being
					 * honoured in memory, not just in the store.
					 *
					 * THE SESSION ID LIVES IN TWO PLACES DEPENDING ON HOW THE DRAFT
					 * WAS MADE, and reading only one of them made this a no-op for
					 * the commonest send. A draft staged from "New chat" is keyed
					 * `draft:<uuid>` and LEARNS its session id mid-send, so the row
					 * carries it. A send from an existing conversation is keyed
					 * `send:<sessionId>` by `draftIdentityFor` and the id is passed
					 * to `admitChatDraft` as an argument - it is never written to
					 * the row, so `drafts[key].sessionId` is undefined there and the
					 * abandoned echo survived with its text and attachments.
					 *
					 * Both shapes are read, row first: the row is authoritative when
					 * present, and the key is the fallback that covers the send path.
					 */
					const abandoned =
						drafts[key]?.sessionId ??
						(key.startsWith("send:") ? key.slice("send:".length) : undefined);
					/*
					 * THE SNAPSHOT IS READ BEFORE ANYTHING IS DROPPED, and it is what the
					 * offer restores from: the draft entry as it stood, and the composer row
					 * `clearAll` is about to delete. `composerRow` may be absent (a draft whose
					 * box never held anything); the entry is what makes an offer possible at
					 * all.
					 */
					const entry = drafts[key];
					const composerRow =
						useConversationInputStore.getState().inputByConversation[key];
					/*
					 * BOTH HOMES GO, because the entry's identity moves with the send:
					 * before the create answers it lives under the draft key, after it
					 * under the session id (`movePendingSendIdentity`), and a discard can
					 * land on either side of that hop. The raw key is named
					 * unconditionally - for a `send:<id>` row there is nothing under it -
					 * and the session id when the row carries one.
					 */
					discardPendingSends(key);
					if (abandoned && abandoned !== key) discardPendingSends(abandoned);
					delete drafts[key];
					/*
					 * AND THE COMPOSER'S OWN COPY GOES WITH THE DRAFT (the sidebar's own
					 * "clear drafts", 2026-09-26: "Each one should have a deletion on
					 * hover"). A deleted draft that kept its `inputByConversation[key]`
					 * row was still reachable in two ways: `currentInput` seeds the
					 * composer's initialiser and `pendingText` is adopted on mount — so
					 * RE-CREATING a draft under the same key (a team/agent draft's key is
					 * STABLE: `draft:team:<name>`) found the deleted draft's text waiting
					 * in the box. The row is dropped whole — text, chips, quotes and the
					 * up-arrow log — because "delete this draft" is a statement about the
					 * draft, and a half-cleared row is exactly how a deleted draft comes
					 * back.
					 */
					useConversationInputStore.getState().clearAll(key);
					/*
					 * Clear the pointer as well as the draft, the way
					 * `finishDraft` does. Deleting only the entry leaves
					 * `activeDraftKey` naming a draft that no longer exists, and
					 * every consumer reads that pointer as "a draft is being
					 * composed": the sidebar's New chat row highlights itself with
					 * `aria-current="page"` for a discarded agent draft the user
					 * never opened, and the session rows keep suppressing their own
					 * highlight. Unlike `finishDraft` there is no session to become
					 * active - a discarded draft never became one - so the selection
					 * is left where it was.
					 */
					const nextOffer = entry
						? {
								at: state.answerSeq + 1,
								keys: [key],
								drafts: { [key]: entry },
								composer: composerRow ? { [key]: composerRow } : {},
							}
						: null;
					return {
						drafts,
						/*
						 * THE OFFER IS RAISED IN THE SAME UPDATE AS THE REMOVAL (design round
						 * 1, D1): a split update would leave a commit in which the toast offers
						 * an undo for a draft that is still there - or the row is gone with
						 * nothing offering it back. `answerSeq` advances with the stamp so two
						 * raises cannot share one (`DraftsUndoOffer.at`).
						 */
						...(nextOffer
							? { answerSeq: nextOffer.at, draftsUndo: nextOffer }
							: {}),
						...(state.activeDraftKey === key ? { activeDraftKey: null } : {}),
					};
				}),
			/*
			 * THE BATCH IS THE SINGLE'S RULE APPLIED IN ONE UPDATE (the sidebar's
			 * "clear all", 2026-09-26). Why a store action rather than a caller-side
			 * loop: each single discard is its own update, and a loop would repaint
			 * the list once per row - unmounting the very control the reader pressed
			 * mid-loop - while one update repaints it once. Every key goes through
			 * `discardDraft`'s own halves (the two pending-send homes, the composer
			 * row, the pointer), spelled with the same reads so the two doors cannot
			 * drift; the keys are tested against the map this loop is BUILDING, not
			 * the one the caller rendered against, because a claim can retire between
			 * the render and the press.
			 */
			discardDrafts: (keys) =>
				set((state) => {
					const drafts = { ...state.drafts };
					let activeCleared = false;
					const removedKeys: string[] = [];
					const removedDrafts: Record<string, ChatDraft> = {};
					const removedComposer: Record<string, ConversationInputState> = {};
					for (const key of keys) {
						if (!(key in drafts)) continue;
						/*
						 * THE CALLER DECIDES WHICH KEYS MOVED (UX round 1's U2): `Clear all`
						 * passes the settled rows only (`clearableDraftRows`), so a live send
						 * hop is never handed to this action by the UI, and the count the
						 * offer prints is the count that moved. The action itself keeps
						 * `discardDraft`'s semantics for every key it is given.
						 */
						const entry = drafts[key];
						if (!entry) continue;
						const abandoned =
							entry.sessionId ??
							(key.startsWith("send:") ? key.slice("send:".length) : undefined);
						discardPendingSends(key);
						if (abandoned && abandoned !== key) discardPendingSends(abandoned);
						removedKeys.push(key);
						removedDrafts[key] = entry;
						const composerRow =
							useConversationInputStore.getState().inputByConversation[key];
						if (composerRow) removedComposer[key] = composerRow;
						delete drafts[key];
						useConversationInputStore.getState().clearAll(key);
						if (state.activeDraftKey === key) activeCleared = true;
					}
					if (removedKeys.length === 0) return {};
					const at = state.answerSeq + 1;
					return {
						drafts,
						answerSeq: at,
						draftsUndo: {
							at,
							keys: removedKeys,
							drafts: removedDrafts,
							composer: removedComposer,
						},
						...(activeCleared ? { activeDraftKey: null } : {}),
					};
				}),
			resolveHeldFromServer: (sessionId, entries, complete) =>
				set((state) => {
					/*
					 * The ids the claim is matched by, derived from the page's own rows once:
					 * the reach test below reads the stamps, every arm below reads the ids.
					 */
					const entryIds = entries.map((entry) => entry.id);
					/*
					 * THE LATE-LANDING CORRECTION, AND IT RUNS FIRST: a draft already resolved
					 * as `undelivered` whose message a LATER server answer NAMES did land after
					 * all — the one race this mechanism can lose (a read the server composed
					 * before the attempt settled could miss a message admitted in that window).
					 * The answer naming the id is proof of delivery, so the line goes. The id
					 * here is the one recorded at resolution time, which is the id the durable
					 * row carries.
					 */
					const corrected = Object.entries(state.drafts).filter(
						([, draft]) =>
							draftBelongsToSession(draft, sessionId) &&
							draft.undelivered !== undefined &&
							entryIds.includes(draft.undelivered.recordId),
					);
					let drafts = state.drafts;
					if (corrected.length > 0) {
						drafts = { ...drafts };
						for (const [key, draft] of corrected) {
							const recordId = draft.undelivered?.recordId;
							const { undelivered: _gone, ...kept } = draft;
							drafts[key] = kept;
							/*
							 * AND THE ROW THAT VERDICT PAINTED COMES DOWN WITH IT (design review
							 * round 1's D1). This is the launch sweep's retraction - the walk finds the
							 * buried row and hands the page back here - and it lands AFTER the pane has
							 * synchronously re-painted the verdict as a tail row, so without this the
							 * reader is left with a bubble whose sentence has just been withdrawn. In
							 * the update beside the `settlePendingSend` below, for the same reason
							 * that call is: the echo entry and the row are the resolution's own
							 * write, not a second pass over it.
							 */
							if (recordId !== undefined)
								clearPaintedVerdictEcho(key, draft.sessionId, recordId);
						}
					}
					/*
					 * THE ONE HELD CLAIM THIS SESSION OWNS, if any. A session can hold at most
					 * one at a time by the store's own guard (a second send is refused while
					 * the first is held), and `pending !== true` keeps an IN-FLIGHT attempt
					 * out of it: a request whose outcome is still unknown is not something a
					 * snapshot should adjudicate.
					 */
					const found = Object.entries(drafts).find(([, draft]) => {
						return (
							draftBelongsToSession(draft, sessionId) &&
							draft.admissionAttempted === true &&
							draft.pending !== true &&
							draft.submittedText !== undefined
						);
					});
					/*
					 * THE CORRECTION SURVIVES AN ABSENT CLAIM: a draft that was already
					 * resolved (the late-landing case) usually has no claim left to look
					 * for, and returning here without `drafts` would silently drop the
					 * very write this branch exists for.
					 */
					if (!found) return corrected.length > 0 ? { drafts } : {};
					const [key, draft] = found;
					const recordId = draft.admissionRequestId;
					const delivered = entryIds.includes(recordId);
					/*
					 * NOTHING IS CONCLUDED FROM AN INCOMPLETE READ: `cursor_missing` means the
					 * page does not describe a continuous tail, so its silence about this id
					 * proves nothing. Finding the id still resolves the claim — an answer that
					 * NAMES the message is proof of delivery however partial the page is.
					 */
					if (!delivered && !complete)
						return corrected.length > 0 ? { drafts } : {};
					/*
					 * AND NOTHING IS CONCLUDED FROM A PAGE THAT CANNOT SEE BACK TO THE CLAIM
					 * (issue #847). `complete` is the page's CONTINUITY, and a tail page is
					 * bounded: a delivered message older than that window is, to a
					 * continuity-only reader, a message the server does not have - which is
					 * how a delivered row came to be recorded `undelivered` and repainted at
					 * the tail on every mount. The delivery arm above is untouched: an answer
					 * that NAMES the id is proof of delivery however partial or deep the page
					 * is. This path - silence - is the one that needs the reach.
					 *
					 * A claim left held here is not lost: it is retry material by design (the
					 * sidebar row and `draft-resolution.ts`'s sweep are its other doors), and
					 * the next read that does reach it resolves it then.
					 */
					if (
						!delivered &&
						!pageReachesClaim(
							entries,
							draft,
							state.placementFacts[sessionId],
							state.sessions.find((row) => row.session_id === sessionId),
						)
					)
						return corrected.length > 0 ? { drafts } : {};
					/*
					 * The failure's own copy goes with the claim: `error`/`errorCode` are
					 * what the composer's notice states the failure FROM, and `errorRetry`
					 * is main's classifier verdict on it — a resolved claim must not leave
					 * a sentence about a send the server has now answered standing over
					 * the composer (the §F3 line is the message's own record and stays).
					 */
					const {
						admissionAttempted: _attempted,
						submittedText: _text,
						submittedAttachments: _attachments,
						submittedImages: _images,
						submittedMode: _mode,
						submittedInputMode: _inputMode,
						submittedInputPath: _inputPath,
						heldClaimCode: _claimCode,
						error: _error,
						errorCode: _errorCode,
						errorRetry: _errorRetry,
						...kept
					} = draft;
					/*
					 * AND THE CLAIM IS ANSWERED FOR THE TAB THAT NEVER RELOADS (design review
					 * round 1, D1/D2, as the re-shoot extended it): the entry stays - it is the
					 * row's home - but it is marked ANSWERED, so the very frame the
					 * resolution lands on stops answering "still going out" to the pane's
					 * latch and to any next message sent on this conversation. The identity is
					 * the session itself: the re-key moved the entry there at the create, and
					 * a live-session send was addressed by it from the press.
					 */
					if (!delivered) settlePendingSend(sessionId, recordId);
					return {
						drafts: {
							...drafts,
							[key]: {
								...kept,
								/*
								 * LANDED: nothing to record. The claim's whole question ("did this
								 * reach the owner?") is answered YES by the answer naming the
								 * request id, and the transcript reconciles itself — the durable row
								 * and the echo key on the same id.
								 *
								 * NOT FOUND on a complete read: the claim is answered NO, and the
								 * MESSAGE keeps that answer. The line lives on the message (§F3),
								 * which is why the address is kept: the claim's id dies with the
								 * claim (see the field's note), so the row that will wear the line
								 * is named here while its id is still the one the echo carries.
								 */
								...(delivered
									? {}
									: {
											undelivered: {
												recordId,
												text: _text ?? "",
												attachments: _attachments ?? [],
											},
										}),
								/*
								 * A fresh admission id with the claim: the resolved one may still be
								 * executing on the owner, and reusing it would make the next
								 * (different) message an idempotent REPLAY of the old payload — the
								 * server keys its receipt on the request id and would answer with the
								 * first attempt's result.
								 */
								admissionRequestId: crypto.randomUUID(),
							},
						},
					};
				}),
			retractUndelivered: (draftKey, recordId) => {
				const draft = get().drafts[draftKey];
				/*
				 * The id must match: the guard that calls this hands over the resolution's
				 * own `recordId`, and a row whose claim has since been answered afresh (a
				 * retry that landed, a new press) carries a record that is no longer the
				 * one this call is about.
				 */
				if (!draft || draft.undelivered?.recordId !== recordId) return;
				set((state) => {
					const { undelivered: _gone, ...kept } = state.drafts[draftKey];
					return { drafts: { ...state.drafts, [draftKey]: kept } };
				});
				/*
				 * AND THE ROW THE VERDICT ALREADY PAINTED GOES WITH IT (design review
				 * round 1's D1): the verdict and the row are one fact, so a retraction that
				 * left the row behind leaves a bubble at the tail with no statement - see
				 * `clearPaintedVerdictEcho`.
				 */
				clearPaintedVerdictEcho(draftKey, draft.sessionId, recordId);
			},
			bindSession: (_legacyAgentId, sessionId) =>
				get().setActiveSession(sessionId),
			/*
			 * The pin press, in the order the two writes have to happen: the row moves
			 * first (the feedback IS the state, and a spinner on a 24px control in a
			 * list reads as a stall), then the backend answers, then the answer is
			 * what the row holds.
			 *
			 * WHAT THE ANSWER BEING AUTHORITATIVE BUYS, given the optimistic write
			 * already put the value on screen: a backend that refused to move - the
			 * 51st pin dropping the oldest instead of this one, a store that
			 * could not write - is not something this client can predict, so the
			 * reconcile below is not a no-op check, it is the only place the row can
			 * learn it was wrong. Both directions on failure: the value goes back to
			 * what the row held BEFORE the press (read here, not derived from the
			 * incoming state, so a concurrent catalog read cannot make the revert
			 * write a third value), and `pinFailure` states it.
			 */
			/**
			 * Take the sequence for an answer that is ABOUT TO BE REQUESTED.
			 *
			 * Called by the search hook when its request starts, so the number describes
			 * the moment the question was asked rather than the moment the answer came
			 * back: an answer in flight across a press must not be able to supersede it.
			 */
			beginAnswer: () => {
				const seq = get().answerSeq + 1;
				set({ answerSeq: seq });
				return seq;
			},
			/**
			 * Apply a search answer's own pin state to the facts it speaks about.
			 *
			 * This is the supersession half of the currency rule (`PinFact`): a fact older
			 * than the request that produced this answer gives way to the answer, so a pin
			 * removed on the other surface stops reading pinned here as soon as this client
			 * asks again. A fact written AFTER the request started is left alone, and a hit
			 * that carries no `pinned` says nothing and therefore supersedes nothing.
			 *
			 * AND THE HIT'S `archived` IS READ BESIDE IT (QA round 1, Q-1): a search
			 * answer always carries both values (`SessionSearchHit`), so the archive half
			 * below applies the same supersession to the archive fact AND writes the
			 * answer's value onto the row - the two-sided move the pin arm makes, and
			 * without the second half the menu's own Archive -> search -> Unarchive round
			 * trip failed end to end.
			 */
			applySearchAnswer: (seq, hits) =>
				set((state) => {
					let facts: Record<string, PinFact> | null = null;
					/*
					 * The ROW gives way too, not only the fact. A press on a conversation the
					 * catalogue page cannot carry INSERTS a row (see `setSessionPin`), and that
					 * row carries the pressed state until something speaks about it - a fact
					 * swept away while its row kept the stale pin would leave the panel saying
					 * exactly what the review said it must not. So an answer newer than the
					 * press writes the answer's own value onto the row as well.
					 */
					let rows: typeof state.sessions | null = null;
					/*
					 * THE ARCHIVE FACTS, settled by the same answer under the same rule about
					 * silence: only the ids this answer SPEAKS about, because a search answers
					 * a question about one query and an id it does not mention is not evidence
					 * of anything - unlike the catalogue page, which asked for the archived set
					 * and can settle it whole (see the settle block in `fetchSessions`).
					 */
					let archiveFacts: Record<string, ArchiveFact> | null = null;
					for (const hit of hits) {
						/*
						 * THE ARCHIVE HALF FIRST, and OUTSIDE the pin's own guard below. A hit
						 * that describes no pin still SPEAKS about the conversation - it names an
						 * id, which is the whole of what the archive rule needs - so gating both
						 * halves on `pinned` would leave an archived fact alive through every
						 * answer that happened not to describe a pin.
						 *
						 * AND THE ROW GIVES WAY TOO, the same two-sided move the pin arm below
						 * makes (`row.pinned` at the end of it, and this is its model): the fact is
						 * settled AND the row takes the answer's own value, unless a fact NEWER
						 * than the answer outranks it - the pin arm's own currency rule. Without
						 * the row half, a conversation this client archived fell back the moment
						 * an answer settled its fact to the catalogue page written BEFORE the
						 * press: the row rejoined the widened search (`Include archived`) drawn
						 * live, and its menu offered `Archive conversation` again - so the press
						 * followed the label straight back to `archived: true` and the unarchive
						 * never happened (QA round 1, Q-1: the menu's own round trip failed).
						 */
						const archivedFact = state.archiveFacts[hit.id];
						if (archivedFact !== undefined && archivedFact.at < seq) {
							archiveFacts = archiveFacts ?? { ...state.archiveFacts };
							delete archiveFacts[hit.id];
						}
						if (
							!(archivedFact !== undefined && archivedFact.at >= seq) &&
							typeof hit.archived === "boolean" &&
							state.sessions.some(
								(row) =>
									row.session_id === hit.id && row.archived !== hit.archived,
							)
						) {
							rows = rows ?? state.sessions.map((row) => ({ ...row }));
							for (const row of rows) {
								if (row.session_id === hit.id)
									row.archived = hit.archived === true;
							}
						}
						if (typeof hit.pinned !== "boolean") continue;
						const fact = state.pinFacts[hit.id];
						if (fact !== undefined && fact.at >= seq) continue;
						if (fact !== undefined) {
							facts = facts ?? { ...state.pinFacts };
							delete facts[hit.id];
						}
						if (
							state.sessions.some(
								(row) => row.session_id === hit.id && row.pinned !== hit.pinned,
							)
						) {
							rows = rows ?? state.sessions.map((row) => ({ ...row }));
							for (const row of rows) {
								if (row.session_id === hit.id) row.pinned = hit.pinned === true;
							}
						}
					}
					if (facts === null && rows === null && archiveFacts === null)
						return {};
					return {
						...(facts === null ? {} : { pinFacts: facts }),
						...(rows === null ? {} : { sessions: rows }),
						...(archiveFacts === null ? {} : { archiveFacts }),
					};
				}),
			setSessionPin: async (sessionId, pinned, seed) => {
				const before = get().sessions.find(
					(row) => row.session_id === sessionId,
				);
				/*
				 * What this client knew BEFORE the press, which is what a refused write
				 * reverts to. The fact outranks the row's own field: for a conversation the
				 * catalogue page does not carry, the row is the cached wire hit and is not
				 * evidence, while the fact is this client's own last confirmed state. `null`
				 * rather than `false` for "no fact", because reverting must not MINT one: a
				 * row the catalogue does not carry and this window never pinned has nothing
				 * to put back.
				 */
				const factBefore = get().pinFacts[sessionId] ?? null;
				/*
				 * What the CONTROL RENDERED before the press, which is what a refused write has
				 * to put back. The row's own field wins when the store holds the row - it is
				 * what the glyph was drawn from - and the client's fact is the only witness for
				 * a conversation the catalogue page does not carry, where the row is the cached
				 * wire hit and says nothing about what was on screen.
				 */
				const held =
					before === undefined
						? (factBefore?.pinned ?? false)
						: before.pinned === true;
				/*
				 * A row the store does not hold is INSERTED from the seed rather than left
				 * absent: the map below is a no-op without it, and a press whose result the
				 * panel cannot read is the failure this exists to prevent. `updated_at` is
				 * the wire's own mtime when the hit carried one, so the row sorts where the
				 * search said it belongs rather than at the top of the list.
				 */
				const seedRow: CanonicalSessionRow | null =
					before === undefined && seed !== undefined
						? {
								session_id: sessionId,
								title: seed.title || "Untitled chat",
								updated_at: seed.updated_at,
								pinned,
							}
						: null;
				/*
				 * The stamp this write owns: a FRESH sequence, taken rather than read. Every
				 * later handler asks whether it is still the latest write for this conversation
				 * before it touches anything, and two presses in flight on one row settle in the
				 * order they were MADE (review round 4, m2). Reading the sequence instead of
				 * taking one left two presses in the same tick sharing a stamp, so neither could
				 * tell that the other had happened.
				 */
				const stamp = get().beginAnswer();
				/*
				 * What a row needs if the panel has to DRAW this conversation later: the title
				 * from the row the press acted on, or from the seed when the store held none.
				 * Carried on the fact so a held pin is never the invisible half of the set
				 * (design round 4, D17).
				 */
				const title = before?.title ?? seed?.title;
				const updated_at = before?.updated_at ?? seed?.updated_at;
				set((state) => ({
					sessions:
						seedRow === null
							? state.sessions.map((row) =>
									row.session_id === sessionId ? { ...row, pinned } : row,
								)
							: [...state.sessions, seedRow],
					// The fact as well as the row: the row can be dropped by the next
					// catalogue page (see `pinFacts`), and the fact cannot. Stamped with the
					// sequence current NOW, so an answer requested after this press supersedes
					// it and an answer requested before it does not.
					pinFacts: {
						...state.pinFacts,
						[sessionId]: { pinned, at: stamp, title, updated_at },
					},
					// A press retires the previous press's sentence: the notice is about the
					// row under the pointer, and two of them would be a log.
					pinFailure: null,
				}));
				try {
					const answer = await desktopResult<{
						session_id: string;
						pinned: boolean;
					}>({ op: "sessions.pin", sessionId, pinned });
					let settled = false;
					set((state) => {
						/*
						 * A LATER PRESS OWNS THE ROW NOW. `setSessionPin` stamps each write, and a
						 * second press on the same row replaces the fact - so an answer whose
						 * stamp is no longer the fact's belongs to a press the user has already
						 * superseded, and applying it would settle the row on the stale half of
						 * two in-flight writes (review round 4, m2).
						 */
						const current = state.pinFacts[sessionId];
						if (current === undefined || current.at !== stamp) return {};
						settled = true;
						return {
							sessions: state.sessions.map((row) =>
								row.session_id === sessionId
									? { ...row, pinned: answer.pinned === true }
									: row,
							),
							pinFacts: {
								...state.pinFacts,
								[sessionId]: {
									...current,
									pinned: answer.pinned === true,
								},
							},
						};
					});
					return settled;
				} catch (error) {
					set((state) => {
						/*
						 * A later press's write is not this call's to revert, for the same
						 * reason an earlier press's answer is not this call's to apply.
						 */
						const current = state.pinFacts[sessionId];
						if (current !== undefined && current.at !== stamp) return {};
						// The fact goes back to what it was, or goes away: a revert that MINTED
						// one would claim this window knows the state of a conversation it has
						// only just failed to write.
						const facts = { ...state.pinFacts };
						// The fact follows the row: a revert that restored a fact DISAGREEING
						// with the row it just put back would leave the two saying opposite
						// things about the same conversation. The stamp is kept where the fact
						// survived and taken fresh where a fact is minted, so a revert cannot
						// make a fact look older than the write it is about.
						if (factBefore === null && before === undefined) {
							delete facts[sessionId];
						} else {
							/*
							 * The stamp goes back with the value: the fact describes the state the
							 * control was showing again, and it must not look older than the press
							 * whose refusal it records.
							 */
							facts[sessionId] = {
								pinned: held,
								at: Math.max(factBefore?.at ?? 0, stamp),
								title: factBefore?.title ?? title,
								updated_at: factBefore?.updated_at ?? updated_at,
							};
						}
						return {
							sessions: state.sessions.map((row) =>
								row.session_id === sessionId ? { ...row, pinned: held } : row,
							),
							pinFacts: facts,
							pinFailure: {
								sessionId,
								pinned,
								title: before?.title || "this chat",
								detail: userFacingMessage(error, ""),
							},
						};
					});
					return false;
				}
			},
			upsertSession: (row) =>
				set((state) => {
					const present = state.sessions.some(
						(item) => item.session_id === row.session_id,
					);
					return {
						sessions: present
							? state.sessions.map((item) =>
									item.session_id === row.session_id
										? mergeRow(item, row)
										: item,
								)
							: [...state.sessions, row],
					};
				}),
			/*
			 * THE RECEIPT OWNS THE ROW'S PLACEMENT ONCE A MOVE LANDS (agent review F1).
			 *
			 * WHY IT HAS TO EXIST. The create stamp above is durable - the row outlives
			 * the draft AND the pane's own move record - but nothing ever rewrote it:
			 * a conversation carried home again kept its `locality: "remote"` row, and
			 * the chip stayed correct only while the move's own receipt lived in
			 * `useChatDeviceStore`. Dismiss the arrival notice (`dismissMove` drops the
			 * entry) and the chip fell through to the host arm reading the stale row -
			 * `On cloud-node-1` over a conversation that was already back on this
			 * device, with the picker re-offering a recall of a session that was home.
			 * The chain is: pick a peer, send, recall home, dismiss - every step the
			 * operator's own flow. Before this action the same chain ended on the
			 * fallback's `On this device` by accident; the create stamp turned the
			 * accident into a claim. So the move that lands writes what it knows.
			 *
			 * WHY THE RECEIPT AND NOT THE ASK. `move.deviceId` is what this window
			 * REQUESTED, and a request can be refused, held or answered long after the
			 * pane moved on - a receipt is the only statement of where the session
			 * actually lives (`TransferReceipt.locality`: "local when it landed
			 * here"). Both call sites settle only on a `moved` outcome, which is the
			 * same honesty rule `settleMove` already follows one store over.
			 *
			 * A ROW THE LIST DOES NOT CARRY IS NOT INVENTED: a receipt settles the row
			 * the pane's conversation already had, and there is nothing on this surface
			 * to correct when there is no row (a wiped list re-owns the truth from the
			 * next listing, which is where every other row fact comes from). The
			 * PLACEMENT FACT is still written in that case, because it is this window's
			 * own statement about the id rather than a row - and a fact without a row
			 * protects nothing until a listing re-owns one.
			 *
			 * AND THE ROW IS SETTLED BESIDE THE FACT (`PlacementFact`): the pair on the
			 * row is what the chip reads, but a conversation that lives on a peer is
			 * absent from every plain page, so the row alone can be dropped the moment
			 * the catalogue answers - the fact is what holds it until a read that
			 * SPEAKS about the id settles both. The create writes through this same
			 * action, so the create's stamp and a move's receipt are one writer for the
			 * one fact.
			 *
			 * AND THE NAME IS NOT WRITTEN HERE: a settle can arrive from a window that
			 * never read the peers list, so the reader keeps resolving the name it does
			 * not have (`chat-device-slot.tsx`'s `deviceNameFor`, which already prefers
			 * `owner_device_name` when a create's row carries one).
			 */
			settlePlacement: (sessionId, placement) => {
				/*
				 * THE STAMP THIS WRITE OWNS: a FRESH sequence, taken rather than read,
				 * for the reason `setSessionPin` takes one - two writes in flight on one
				 * row settle in the order they were MADE (`PlacementFact`).
				 */
				const stamp = get().beginAnswer();
				set((state) => ({
					sessions: state.sessions.map((item) =>
						item.session_id === sessionId
							? mergeRow(item, {
									session_id: sessionId,
									locality: placement.locality,
									owner_device: placement.owner_device,
								})
							: item,
					),
					/*
					 * AND THE FACT BESIDE THE ROW. The row can be dropped by the next plain
					 * page - a conversation on a peer is absent from every one of them - and
					 * the fact is what holds it (`PlacementFact` carries the whole
					 * mechanism). For a LOCAL pair the fact protects nothing by design; its
					 * only reader there is the settle that keeps the currency moving.
					 */
					placementFacts: {
						...state.placementFacts,
						[sessionId]: {
							locality: placement.locality,
							owner_device: placement.owner_device,
							at: stamp,
						},
					},
				}));
			},
			/**
			 * The peers-inclusive read's own landing (see the type's docstring for the
			 * rules and why it is not folded into `fetchSessions`).
			 */
			settlePeerCatalogue: (rows, requestedAt) => {
				set((state) => {
					/*
					 * 1. SETTLEMENT, mirroring `fetchSessions`' own loop: a fact older
					 * than the answer's request gives way to the wire's pair, and a fact
					 * written after it started is left alone. All settlements of one
					 * answer share ONE fresh sequence, exactly as that loop's do.
					 */
					const facts = { ...state.placementFacts };
					/* The ids THIS call settled, so the two write halves below can read
					 * exactly what the answer spoke about rather than re-deriving it. */
					const settledIds = new Set<string>();
					let settled = false;
					let settledAt = 0;
					for (const row of rows) {
						const locality =
							row.locality === "remote"
								? "remote"
								: row.locality === "local"
									? "local"
									: null;
						if (locality === null) continue;
						const fact = state.placementFacts[row.session_id];
						if (fact !== undefined) {
							/* A fact newer than the answer's question gives way to it; an
							 * older pair is re-settled below. */
							if (fact.at >= requestedAt) continue;
						} else if (locality !== "remote") {
							/* A local row this store never held: no fact to write - local
							 * membership is the plain page's to establish. */
							continue;
						}
						settledAt = settledAt === 0 ? state.answerSeq + 1 : settledAt;
						settledIds.add(row.session_id);
						facts[row.session_id] = {
							locality,
							owner_device:
								locality === "remote" && typeof row.owner_device === "string"
									? row.owner_device
									: "",
							at: settledAt,
						};
						settled = true;
					}
					/*
					 * 2. THE REMOTE ROWS, through the same merge a page's rows go
					 * through. Local rows in the answer are the PLAIN read's business -
					 * its page owns them and this one only ever settles facts for them -
					 * so nothing about a local row is written from here.
					 */
					const remote = rows.filter((row) => row.locality === "remote");
					let sessions = state.sessions;
					let replaced = false;
					const additions: CanonicalSessionRow[] = [];
					const at = new Map<string, number>();
					for (let index = 0; index < sessions.length; index += 1)
						at.set(sessions[index].session_id, index);
					for (const row of remote) {
						const index = at.get(row.session_id);
						if (index === undefined) {
							additions.push(row);
							continue;
						}
						if (sessions[index] !== row) {
							if (!replaced) {
								sessions = sessions.slice();
								replaced = true;
							}
							sessions[index] = mergeRow(sessions[index], row);
						}
					}
					if (additions.length > 0) sessions = [...sessions, ...additions];
					/*
					 * AND A ROW THAT MOVED HOME STOPS WEARING THE MARK in the same answer
					 * that said so: its fact settled to `local` above, and the row this
					 * store already holds is merged with the wire's own local pair
					 * (`locality: "local"`, no owner), so the sidebar's mark clears with
					 * the fact. A local id this store does NOT hold is the plain page's to
					 * add - this action never grows the catalogue with a row the federated
					 * read did not say was remote.
					 */
					for (const row of rows) {
						if (row.locality === "remote" || !settledIds.has(row.session_id))
							continue;
						const index = at.get(row.session_id);
						if (index === undefined || sessions[index] === row) continue;
						if (!replaced) {
							sessions = sessions.slice();
							replaced = true;
						}
						sessions[index] = mergeRow(sessions[index], row);
					}
					/*
					 * 3. PRUNE, ONLY AGAINST A READ THAT CAN SPEAK: the relay contributes
					 * no rows for a peer that did not answer, so a held row is dropped
					 * only when another row in this answer proves its owner reachable
					 * while the id is absent - the owner answered, and no longer holds
					 * that conversation. (An id the answer DID carry is settled above,
					 * and a fact newer than the request is never touched.)
					 */
					const answered = new Set(rows.map((row) => row.session_id));
					const spoke = new Set<string>();
					for (const row of rows) {
						if (
							row.locality === "remote" &&
							typeof row.owner_device === "string" &&
							row.owner_device !== "" &&
							row.reachable !== false
						)
							spoke.add(row.owner_device);
					}
					const pruned = new Set<string>();
					for (const [id, fact] of Object.entries(state.placementFacts)) {
						if (fact.locality !== "remote") continue;
						if (answered.has(id)) continue;
						if (fact.at >= requestedAt) continue;
						if (fact.owner_device === "" || !spoke.has(fact.owner_device))
							continue;
						pruned.add(id);
						delete facts[id];
					}
					if (pruned.size > 0)
						sessions = sessions.filter((row) => !pruned.has(row.session_id));
					if (
						!settled &&
						additions.length === 0 &&
						!replaced &&
						pruned.size === 0
					)
						return {};
					return {
						sessions,
						placementFacts: facts,
						...(settled ? { answerSeq: state.answerSeq + 1 } : {}),
					};
				});
			},
		}),
		{
			name: "canonical-sessions-storage",
			merge: mergePersistedSession,
			partialize: (state) => ({
				activeSessionId: state.activeSessionId,
				activeDraftKey: state.activeDraftKey,
				cwd: state.cwd,
				/*
				 * THE TOMBSTONES GO WITH IT, SO THE UI'S OWN GONE-STATE SURVIVES A
				 * RELOAD (QA round 2's Q1, second half).
				 *
				 * A daemon that keeps answering 200 for a conversation it has just been
				 * told to delete - which is what QA measured, and what the round sent to
				 * the backend - leaves the client nothing to read the deletion from after
				 * a reload: the stream opens, the transcript hydrates, and the pane
				 * offers a writable composer over a conversation the user removed. What
				 * THIS window did, it knows, and that is a durable fact about its own act
				 * rather than a claim about the store: persisting it is what lets the pane
				 * land on the missing-session notice on the first paint after a reload.
				 *
				 * `at` IS DELIBERATELY NOT PERSISTED, and 0 is the correct value for a
				 * restored one: the stamp orders a tombstone against reads that were in
				 * flight INSIDE one process, and a reload has none. Written as 0, any page
				 * the fresh process asks for outranks the record, so the resurrection rule
				 * still revives a conversation the store really does carry again - a
				 * restored tombstone self-heals on the first page that lists the id, while
				 * a page that omits it leaves the id hidden, which is the same rule the
				 * live process applies one second earlier.
				 */
				forgotten: Object.fromEntries(
					Object.entries(state.forgotten).map(([id, fact]) => [
						id,
						{ at: 0, title: fact.title },
					]),
				),
				drafts: Object.fromEntries(
					Object.entries(state.drafts).map(([key, draft]) => [
						key,
						{
							...draft,
							pending: false,
							/*
							 * `warmId` is the one row field that must NOT survive a reload: it
							 * names a registry entry in a daemon this process cannot make claims
							 * about, and a reload cannot know whether that daemon restarted in
							 * between. The next keystroke re-mints instead — `draftRequestId`
							 * DOES persist, so on a daemon that still holds the draft the
							 * receipt replays the SAME id, and on one that does not the mint
							 * is simply fresh. Either way the pane never carries an id it has
							 * not just proved its daemon answers for.
							 */
							warmId: undefined,
						},
					]),
				),
			}),
		},
	),
);
