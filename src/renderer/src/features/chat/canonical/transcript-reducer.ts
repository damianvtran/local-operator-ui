/**
 * Canonical transcript reducer.
 *
 * Turns the backend's three sources of conversation truth into ONE ordered
 * list of typed records the transcript view can paint:
 *
 *   1. durable history rows (`GET /history`, and the snapshot's history page),
 *   2. the snapshot's `live_events` seed (the bounded in-flight turn a
 *      frontend that joins mid-turn would otherwise miss), and
 *   3. live `event` frames after the snapshot.
 *
 * The invariant this module exists for is the same one the TUI and the phone
 * enforce: **durable before live, and a record id is painted once.** A turn
 * that becomes durable between the snapshot and a history page must replace
 * its live counterpart, never sit beside it. That is why every record here is
 * keyed by the backend's own message id (user rows carry the request UUID, so
 * an optimistic echo and the owner's `message_start` coalesce for free).
 *
 * The reducer is deliberately pure and synchronous. Frame coalescing (one
 * animation frame per batch) happens in the stream hook; this module only
 * guarantees that applying the same frame twice is idempotent and that an
 * older replayed event can never regress a newer painted record — which is
 * the property the reconnect path depends on when it replays from a cursor.
 *
 * Records are immutable values: a delta that changes nothing returns the
 * SAME record object, and `applyEvent` returns the same state object when
 * nothing changed. The view's memoisation is only as good as that gate.
 */

import {
	type CanonicalFrontendState,
	type DesktopHistoryPage,
	epochMsFromSeconds,
} from "../../../../../shared/desktop-session-contract";
import {
	type PeerSender,
	peerFields,
	sameSender,
	wakeIsCatchup,
} from "../components/trace/receipt-row-model";
import {
	type SendDeliveryState,
	diffFromDetails,
	preferDeliveryState,
	preferDiff,
	preferDiffCounts,
} from "../components/trace/tool-row-model";
import { isHarnessChromeText } from "./harness-chrome";
import { freezeRecordDeep } from "./record-immutability";

/**
 * One image on a transcript row.
 *
 * Two sources, one shape. A LIVE event carries the bytes inline, because the
 * owner dumps events without `exclude_defaults` — so `type` and `data` are both
 * present. A DURABLE row carries only a content-addressed digest, because the
 * transcript externalises every image over 1 KiB of base64 into
 * `<config>/attachments/<digest>.bin` and strips `data` from the row. The view
 * must handle both without knowing which it came from, so exactly one of `data`
 * and `attachment` is populated and the resolver decides how to turn it into a
 * URL.
 */
export type TranscriptImage = {
	/** Stable key: `${recordId}:${index}`, indexed among IMAGE blocks only. */
	id: string;
	/** Base64 payload when the event carried it inline. Live path. */
	data: string | null;
	/** Attachment-store digest when the row referenced it. Durable path. */
	attachment: string | null;
	mimeType: string;
};

/**
 * The receipt cursor of one frame on the session stream: the owner epoch and
 * the sequence the frame was published under.
 *
 * ONE clock, and deliberately not the frontend state's `(epoch, sequence)` —
 * `use-canonical-session` checks those two independently because they are
 * different clocks. This is the one every `event` frame carries, and it is
 * stable across re-delivery: a frame replayed after a reconnect keeps its
 * original seq, which is what makes "has this row already folded this frame"
 * a decidable question (`TranscriptRecord`'s `frame` field).
 */
export type DeltaFrame = { epoch: string; seq: number };

/** The § 7 tier a record renders at, decided once here rather than per view. */
export type TranscriptRecord =
	| {
			kind: "user";
			id: string;
			ts: number;
			text: string;
			images: TranscriptImage[];
			/**
			 * This row is the app's own optimistic echo, not the owner's record of
			 * the message - it has not been confirmed by the session yet.
			 *
			 * WHY A FLAG, WHEN THE MODULE WENT OUT OF ITS WAY TO AVOID ONE. The
			 * echo's own comment says a distinct variant would break `shallowEqual`'s
			 * key-count comparison, and that is still true: this is a FIELD on the
			 * ordinary user record, so the owner's row - which never carries it -
			 * differs by key count and replaces the echo in one `upsert`. That is the
			 * point of it. A failed send has to be able to retract its OWN echo and
			 * must never remove the owner's row for the same id, because that row is
			 * proof the message was delivered: the two cases are indistinguishable by
			 * id alone, and only the echo knows which it is. Cleared by the owner's
			 * same-id row — a live `message_start` or the durable page row (which
			 * also ends the position hold; see `provisional` for why the live one
			 * does not).
			 *
			 * The cost is one extra render of the user row per send (its first
			 * update replaces a record with one more key), measured as a single
			 * commit and nothing else - no scroll or anchor move, because
			 * `working-line-model.ts` anchors on the request id, which does not
			 * change (risk R2).
			 */
			local?: boolean;
			/**
			 * The owner has stated no position for this row yet, so no clock
			 * comparison can decide its place: the echo's `ts` is this renderer's
			 * clock, every page/seed row carries the owner's, and a row landing
			 * later can exceed any cap the echo borrowed (agent review round 1,
			 * F1). Set by `appendPendingUser` on EVERY echo — over an empty
			 * transcript or a painted cache alike — and the row holds the tail
			 * position it was admitted at against the merges that carry rows
			 * (`withTimeOrder`'s tail block). Cleared only when an owner-stamped
			 * row names the same id: the durable page row replaces this record
			 * entirely. The seed route reaches only rows the seed DATES —
			 * `statedIds` gains an id under `!next.index.has(id)`
			 * (`applyLiveSeed`) — so a seed restating the echo's own id cannot
			 * clear its hold: an already-painted echo is settled only by its
			 * durable row (review round 2, N1). A live
			 * `message_start` that merely RESTATES the message clears `local`
			 * (delivery — the store's unknown-outcome arm reads exactly that) but
			 * deliberately keeps `provisional`: on a reconnect its replay folds
			 * BEFORE the snapshot's page, and ending the hold there is what put
			 * the echo above the page's pre-send rows (review round 1, F2).
			 */
			provisional?: boolean;
	  }
	| {
			kind: "assistant";
			/** Only a full durable history read certifies the actual ending. */
			complete?: boolean;
			id: string;
			ts: number;
			text: string;
			/** Still receiving deltas; the view shows the text without a cursor. */
			streaming: boolean;
			/**
			 * Viewer-clock ms when this record SETTLED, or absent while it streams.
			 *
			 * WHY THE LIVE ROW NEEDS IT: `ts` on a live assistant record is its stream
			 * START (`message_start`'s frame-arrival clock, kept through
			 * `message_end`), so a wall-clock span built from `ts` would read short by
			 * the answer's whole streaming time and then jump when the reconcile
			 * replaces the row with its durable twin, whose `ts` IS the commit
			 * instant. Stamping the settle moment closes that skew: a live span and
			 * the same span after a reload agree by construction (the runtime is
			 * local, one clock — the same assumption `compactingSince` documents).
			 *
			 * NOT set on durable rows, deliberately: a page cannot restamp a
			 * completion it did not witness, and a durable `ts` already means
			 * "commit = completion". Viewer-transient like `ts` is: superseded by the
			 * durable row with the same id exactly as `ts` is.
			 */
			settledAt?: number;
			/**
			 * What this row's text is NOT, when this viewer cannot hold the whole
			 * message. Absent means the row is the answer.
			 *
			 * A NAMED UNCERTAINTY RATHER THAN A BOOLEAN, because one sentence cannot be
			 * true of every row that is missing something and the row has to say which
			 * it is:
			 *
			 *  - `"prefix"` — the row does not start where the answer starts. SET when
			 *    the row was minted from a frame's own delta with no text of its own
			 *    (a turn joined mid-stream: the producer sends deltas only, so an empty
			 *    body says nothing about what came before). What the viewer knows is
			 *    that it holds nothing before this chunk, so the caption states
			 *    exactly that.
			 *  - `"interrupted"` — the row may have a hole in it. SET by the two paths
			 *    where a receipt lost continuity across a row that already held text:
			 *    a snapshot seed whose delta cannot be placed after what the row holds
			 *    (`applyEvent`'s `seed` option), and a gap that reached
			 *    `markLiveRecordsTruncated`. Neither the withheld frame nor the gap
			 *    says whether anything was actually lost, and the row's own earlier
			 *    text IS on screen — so the caption must claim a possible hole rather
			 *    than a missing prefix (design round 1, D2).
			 *
			 * CLEARED by the two sources that state the whole text: `message_end`, whose
			 * message is the assembled final text, and a durable history row, which is
			 * whole by construction (`durableRecord` builds every record from the
			 * journal and never sets this). The append path clears it too, on the frame
			 * that carries a non-empty body — that frame IS the running whole text, so
			 * the claim would otherwise outlive the text it qualifies.
			 *
			 * A fact about the TEXT rather than about the transport: the receipt gap that
			 * provokes it is transient, and the row says so itself rather than the pane
			 * saying it about every row.
			 */
			truncated?: "prefix" | "interrupted";
			/**
			 * The wire cursor of the last `message_update` frame folded onto this
			 * row, or absent when every frame that painted it carried none (a seed
			 * folded with no snapshot cursor in hand, a caller that folds bare
			 * events).
			 *
			 * WHY A ROW HOLDS THE STREAM'S OWN POSITION. Deltas are fragments of an
			 * ordered stream, and the frame's `(epoch, seq)` IS that order: the seq
			 * is assigned once, at publish, and a RE-DELIVERY (a receipt replay
			 * after a reconnect, a flush from a dead stream interleaved with its
			 * successor's) carries the ORIGINAL seq rather than a new one. Holding
			 * the last folded seq is what lets `message_update` refuse a frame the
			 * row has already consumed instead of appending its fragment a second
			 * time — the corruption class the operator photographed as "some chunks
			 * are not in the proper overlap/order", where a re-sent fragment lands
			 * twice in the text (and a short trailing fragment re-applied per
			 * re-delivery grows a run that was never in the message at all).
			 *
			 * THE PREMISE IS THE PRODUCER'S, CONFIRMED THERE BEFORE IT WAS RELIED ON
			 * HERE: `DesktopSessionBridge.publish` stamps `epoch`/`seq` once at
			 * publish and `events()` replays stored frames verbatim from its ring
			 * buffer (filtered by `after_seq`), so a re-delivery carries the ORIGINAL
			 * cursor; the epoch rotates only with a facade rebuild
			 * (`server/utils/desktop_sessions.py`, the local-operator repo).
			 *
			 * A STREAMING-ROW FACT, not a universal one: this field is stamped by a
			 * live turn's frames only - `message_end` and `applyHistoryPage` build
			 * their records without it - which is safe today because a settled row
			 * refuses later deltas (see `message_update`'s settled-row gate). Any
			 * path that ever re-arms a settled row must restamp or re-earn this
			 * cursor, or it silently loses the protection.
			 *
			 * Per-EPOCH, because a replaced owner restarts the numbering: the
			 * comparison is only meaningful within one epoch, and a frame from a
			 * new epoch is always accepted.
			 */
			frame?: DeltaFrame;
			/** Provider stop reason when settled: refusal/error/aborted change ink. */
			stopReason: string | null;
			error: boolean;
	  }
	| {
			kind: "tool";
			id: string;
			ts: number;
			toolCallId: string;
			toolName: string;
			/** The model's own `i` narration, when it wrote one. */
			intent: string | null;
			args: Record<string, unknown> | null;
			/**
			 * compose -> queued -> running -> done.
			 *
			 * `composing` is the model still DICTATING the arguments; `queued` is the
			 * producer's terminal dictation frame (`ToolCallComposeEvent.
			 * dictation_complete`) saying the writing stopped and the call has not
			 * started — it may wait a long while behind a sibling's execution group
			 * before it does. Both are unsettled; only `composing` claims the model is
			 * still writing, and neither has an execution clock.
			 */
			phase: "composing" | "queued" | "running" | "done";
			argumentBytes: number;
			/**
			 * The harness's own verdict that this call will NEVER run, or `null`.
			 *
			 * Set from `ToolCallComposeEvent.not_run_reason`, which is the only
			 * statement such a call ever gets: a call parked at planning (invalid
			 * arguments, an unknown tool, a duplicate id) or skipped by steering
			 * deliberately has no `tool_execution_start`/`_end` — the API server pairs
			 * tool records by id, so a synthetic start would claim the tool ran. The
			 * composing surface is therefore the only one that announced the call and
			 * the only one that can honestly settle it.
			 *
			 * It is a SEPARATE field from `isError` on purpose: the call did not fail,
			 * it was never sent to a tool, and a row that reported it as a tool result
			 * would claim an outcome that never existed. The reason is the whole
			 * content of the fact and names what stopped it.
			 */
			notRunReason: string | null;
			/**
			 * The FAULT_* class of that verdict (`not_run_kind`), or `null`.
			 *
			 * The vocabulary is the harness's own (`harness/types.py`'s FAULT_* set,
			 * produced by `loop.py`): `unknown_tool | invalid_arguments | duplicate_id |
			 * denied | gate_failed | skipped | aborted`. `null` is the no-verdict case
			 * every producer before the field, and every frame that is not the terminal
			 * never-run one, keeps - and every consumer reads it as today's behaviour.
			 *
			 * The class is what tells an INTERRUPT from a failure, and it is read here
			 * rather than sniffed from the reason text: `skipped` (steering redirected
			 * before the call ran) and `aborted` (the user stopped the turn) are the same
			 * two kinds the end events and the durable rows carry under
			 * `details.__fault`, and both settle as `interrupted` - while the planning
			 * faults (an unknown tool, invalid arguments, a duplicate id, a denied or
			 * failed gate) keep the failure treatment they already have, because those
			 * ARE failures.
			 */
			notRunKind: string | null;
			/**
			 * The call was never handed to a tool: it was parked with a verdict, or
			 * the turn died while it was still being dictated or waiting to run.
			 *
			 * A fact of its own, and NOT the same one as `notRunReason`: the verdict
			 * carries the harness's words, and a turn that dies leaves none — the TUI
			 * settles that row with the `never sent · N composed` record and no error
			 * text at all (`app.py::_retire_live_tool_cards` retires every live card
			 * through `ToolCard.mark_interrupted`, which keeps the compose record for a
			 * card that was still composing or queued). Without the flag the row has
			 * nothing to say about a call that reached no tool: a clean turn end painted
			 * it as a SUCCESS with a tick, and an abort as an interrupt of a call that
			 * had not begun.
			 */
			neverSent: boolean;
			output: string | null;
			isError: boolean;
			durationS: number | null;
			/**
			 * Wall-clock ms when the call began EXECUTING, for the running row's
			 * live clock. `null` on any settled row, which reports the duration the
			 * backend measured instead.
			 *
			 * The row needs this because `durationS` is `null` for the whole life of
			 * a running call — it only arrives on `tool_execution_end` — so a row
			 * without it renders `0s` from start to finish and a two-minute call
			 * looks identical to a two-second one. The spec makes the ticking number
			 * load-bearing (`CLOCK_INTERVAL_S = 1.0`): an empty status column says
			 * "still running", and the clock is what says for how long.
			 *
			 * It is the EXECUTION start, not the compose start, so it measures the
			 * same span the settled `durationS` reports and the number does not jump
			 * when the row settles.
			 */
			startedAt: number | null;
			/**
			 * Ms epoch when the call COMPLETED, for the fold's wall-clock span.
			 *
			 * Stamped from the viewer's own end frame as `startedAt + durationS` —
			 * the producer's two numbers, added in the producer's clock — rather
			 * than this viewer's arrival instant: the seed for a call that settled
			 * while a viewer was away replays later, and dating the completion at
			 * that arrival would extend a run's span by however long the viewer was
			 * gone. `null` on a running call, on an end frame that stated no
			 * duration, and on EVERY row restored from the durable transcript: the
			 * durable tool payload persists `duration_s` and no stamps at all, so a
			 * run restored from history carries durations it cannot turn into a
			 * span — which is why the fold's header renders nothing for such a run
			 * rather than a sum dressed as a span.
			 */
			endedAt: number | null;
			/**
			 * Screenshots the call returned. This is what makes a browser-tool
			 * capture visible: the bytes are already on the wire in
			 * `tool_execution_end`, and until now the reducer dropped them.
			 */
			images: TranscriptImage[];
			/** Lines added, from the call's own `details`. Zero means unknown. */
			added: number;
			/** Lines removed, from the call's own `details`. Zero means unknown. */
			removed: number;
			/**
			 * The unified diff the call reported, one element per line, or `null`
			 * when it reported none.
			 *
			 * `write`/`edit` results carry `details = {path, added, removed, diff}`
			 * (`_diff_details`, tools/builtin.py:4863-4888) and the expanded row
			 * paints THIS rather than the arguments, because a `write`'s arguments
			 * are the whole new file content — the same change stated a second way,
			 * at full payload length. The backend omits `diff` entirely when nothing
			 * changed (`_diff_details` returns counts alone), so `null` here is a
			 * real statement: this call reported no change, and the row falls back
			 * to its arguments.
			 *
			 * Normalised by `diffFromDetails` rather than read inline: the extraction is
			 * the ported arithmetic's rule, not the reducer's, and it tolerates a
			 * malformed or unexpected payload (and a pre-joined string, which is
			 * defensive tolerance at an untyped boundary rather than a shape any
			 * producer sends — see `tool-row-model.ts`) without taking the row down.
			 */
			diff: string[] | null;
			/**
			 * The call was still running when the turn was aborted, so it never
			 * reported an outcome of its own.
			 *
			 * Distinct from `isError` on purpose, and the TUI draws it with a third
			 * glyph for the same reason: a call the USER stopped did not fail, and
			 * reporting a deliberate interrupt as a failure blames the agent for the
			 * user's own decision.
			 */
			stopped: boolean;
			/**
			 * How a `send` call's delivery ended (`details.delivery.state`), or
			 * `null`/absent when the result states none - an old transcript, an old
			 * core, an unknown state, or any other tool.
			 *
			 * Separate from `isError` on purpose: the core flags `is_error` for
			 * `failed` alone, and `mailbox`/`unconfirmed` are settled, non-failure
			 * results the row paints amber. Optional so hand-built records (fixtures,
			 * stories) need not state it; absent reads exactly as `null`.
			 */
			delivery?: SendDeliveryState | null;
	  }
	| {
			kind: "notice";
			/** A durable completion marker, not an arbitrary renderer notice. */
			complete?: boolean;
			id: string;
			ts: number;
			text: string;
			level: "info" | "warning" | "error";
	  }
	| {
			kind: "custom";
			id: string;
			ts: number;
			customType: string;
			/** The row's rendered body, as persisted. */
			text: string;
			/**
			 * The § 7 tier this row paints at, decided here rather than in the view.
			 *
			 * A `session_incident` is the reason a turn DIED, so it is an error:
			 * the danger glyph and the danger label ink. Every other custom row is
			 * the harness telling the reader that something changed (a model switch,
			 * a recovered MCP server, a stored credential) or relaying a message,
			 * which is informational.
			 *
			 * `session_mcp_unavailable` is the row that makes the boundary worth
			 * stating, because it is one keystroke from the wrong tier. An MCP server
			 * that fails to connect, or whose OAuth grant expires, does NOT end a
			 * turn — it takes a capability away — so it rides the info tier with the
			 * other statements and never borrows the incident's danger ink. Only a
			 * `session_incident` may claim a turn died, and that claim is the
			 * harness's to make: it emits this warning under its own record type for
			 * exactly that reason.
			 */
			level: "info" | "error";
			/**
			 * What the row paints where a tool row paints its action, and it is the
			 * MESSAGE rather than the row's type name: an incident's own error text,
			 * a statement's sentence, or a bulky relayed payload's first substantive
			 * line. See `customRow` for which type says what, and why.
			 */
			headline: string;
			/**
			 * Supporting text behind the row's disclosure, or `null` when the row has
			 * said everything it has to say — an incident's suggested action and tail
			 * sentence, or a relayed payload's whole body. `null` is also what makes
			 * the row a static line rather than a trigger revealing nothing.
			 */
			detail: string | null;
			/**
			 * An incident's classification (`mcp`, `rate-limit`, `cut-off`, …), which
			 * is its label: a scanning reader gets what KIND of failure next to the
			 * failure's own words. `null` on every other custom row.
			 */
			category: string | null;
			/**
			 * The `provider/model` the incident names in its head
			 * (`[session incident (anthropic/claude-opus-5)] rate-limit: …`), which the
			 * row paints in the ledger's machine-voice `object` column.
			 *
			 * It is carried because the harness's own advice for a rate limit is "tell
			 * the user which provider hit the limit", and for an operator running
			 * several providers that is the decision-relevant half of the row.
			 * `null` when the incident names none (every no-provider `cut-off`, and
			 * every non-incident custom row).
			 */
			provider: string | null;
			attribution: "user" | "agent" | "system";
	  }
	| {
			/**
			 * An inbound cross-session message (`lop send` between live sessions).
			 *
			 * Its own kind rather than a `custom` row, because what a `custom` row
			 * paints is `details.text` and a peer delivery's `details.text` is the
			 * MODEL-FACING provenance envelope. `peerFields` is what keeps it out of
			 * the record.
			 */
			kind: "peer";
			id: string;
			ts: number;
			/** The message as the peer wrote it. Never the envelope. */
			body: string;
			/** Advisory identity of the sender; any field may be empty. */
			sender: PeerSender;
	  }
	| {
			/**
			 * A scheduled-wake delivery receipt.
			 *
			 * A RECEIPT, not a call: a wake fires with no user keystroke, and before
			 * this kind the transcript showed the agent simply starting to work with
			 * nothing recording which wake caused it (the TUI's `WakeBlock`).
			 */
			kind: "wake";
			id: string;
			ts: number;
			/**
			 * The delivery verbatim: `<envelope>\n\n<prompt>`. The headline and the
			 * prompt are DERIVED from it at paint time (`receipt-row-model`), so the
			 * state holds what arrived rather than one rendering of it.
			 */
			text: string;
	  }
	| {
			/**
			 * A queued ask's RESPONSE receipt (`ask_response`, design §2.3/§4).
			 *
			 * Its own kind rather than a `custom` row for the reason `peer` gives: a
			 * `custom` row paints `details.text`, and this row's `text` is the
			 * MODEL-FACING report (`asks/render.response_text` — the question/answer
			 * listing the model is handed). A person reading back a conversation needs
			 * the questions and what they answered, not the envelope written for a
			 * model, so the structured half is what this record keeps and the row
			 * paints.
			 *
			 * ONE KIND FOR ALL THREE STATUSES, because the backend writes them as one
			 * custom type with one id (`asks/queue._response_message`): a decline is a
			 * response-shaped fact. What differs is the sentence and the ink, and that
			 * split happens at paint time (`askStatusText`) rather than in the fold.
			 */
			kind: "ask_response";
			id: string;
			ts: number;
			askId: string;
			/** `answered` | `late` | `declined`. Read as a string, for the usual skew reason. */
			status: string;
			/**
			 * The ask's questions, as the row carried them.
			 *
			 * Carried rather than looked up: the ask itself may be long gone from the
			 * live queue (that is the point of the durable log), so a row that read the
			 * queue would paint an empty receipt for exactly the answers a user most
			 * wants to find again.
			 */
			questions: { id: string; question: string; secret?: boolean }[];
			/** The answers, keyed by question id. A secret answer is `[<key>]`. */
			answers: Record<string, string[]>;
			/**
			 * The session no longer holds a credential this row announced
			 * (`secret_lost`, design §2.4). Stated ON THE ROW as well as in the text,
			 * because a card must not say "in hand" for a key that is gone — and the
			 * card cannot read the model's sentence to find out.
			 */
			secretLost: boolean;
	  }
	| {
			/**
			 * A queued ask's TIMEOUT notice (`ask_timeout`, design §2.5/§4).
			 *
			 * It says the agent MOVED ON and that the ask is still answerable, because
			 * both halves are true and each is useless without the other: "timed out"
			 * alone reads as finished, and "you can still answer" alone hides that the
			 * agent stopped waiting. The row is the user's one record of that moment,
			 * which is why it is a receipt of its own rather than a notice line.
			 */
			kind: "ask_timeout";
			id: string;
			ts: number;
			askId: string;
			/** The wait that actually happened, in seconds, as the queue measured it. */
			waitedS: number;
			urgent: boolean;
	  }
	| {
			kind: "compaction";
			id: string;
			ts: number;
			text: string;
			/**
			 * The pass's FINGERPRINT: the `tokens_before` the pass reported, which
			 * both projections of one pass carry — the live id spells it
			 * (`compaction:<generation>:<before>:<after>`) and the durable entry has
			 * it in `payload.tokens_before`.
			 *
			 * WHY A FINGERPRINT RATHER THAN A CLOCK. The two projections are written
			 * by different clocks in a fixed order: the backend awaits
			 * `append_compaction` (ts = `time.time()`) and only then emits the settle
			 * event, and the renderer stamps the live line with `Date.now()` when it
			 * processes that frame — so the durable row is ALWAYS the older of the
			 * two, whichever arrives first (agent review round 4, R4-1: a
			 * time-ordered relation painted one pass as two rows in production). The
			 * fingerprint is the identity the pair actually shares, and it is the only
			 * key that cannot be confused by a second pass nearby.
			 *
			 * `undefined` when the pass reported no figure — an older transcript, or a
			 * row written before `tokens_before` existed. That is what the window
			 * fallback in `collapseSettledCompactions` is for.
			 */
			before?: number;
	  };

export type TranscriptState = {
	/** Ordered oldest -> newest. */
	records: TranscriptRecord[];
	/** id -> index for O(1) coalescing; rebuilt on every structural change. */
	index: Map<string, number>;
	/** Backend generation of the turn currently in flight, if any. */
	generation: number;
	/**
	 * A compaction pass is in flight, from `compaction_start` to `compaction_end`.
	 *
	 * A BOOLEAN ON THE TRANSCRIPT rather than a latch in app state, because the
	 * two facts that end it are transcript facts: the settling frame, and the
	 * replacement of the transcript the claim was made against. It is what the
	 * working line's `compacting context` rung reads; see `COMPACTING_ACTIVITY`
	 * in `working-line-model.ts` for what outranks it and why a dead transport
	 * SUPPRESSES the rung instead of clearing the flag.
	 *
	 * EVERY WAY IT IS CLEARED, enumerated because a claim that outlives its pass
	 * is a claim nobody can vouch for (review round 1, R3 asked for this list to
	 * be true rather than asserted): `compaction_end` — success, or the same
	 * frame with `success: false` — applied BEFORE that case's idempotence guard,
	 * so a replay still retires a claim it has already painted for; the pass's own
	 * DURABLE row, refused or otherwise, which is projected by `durableRecord`;
	 * `agent_start`, because a turn cannot begin under a live pass; a replaced
	 * transcript (`replaceTranscript`/`clearView` keeps it, a rebuild does not);
	 * `markLiveRecordsTruncated`, which is the gap path — the same receipt gap that
	 * used to call `dropLiveRecords`, and which withholds the claim for the same
	 * reason (`dropLiveRecords` survives for `paint-cache.ts`'s in-flight filter,
	 * where a cached streaming row could never advance); and `applyLiveSeed`, whose
	 * clear is the "a reconnect must not resurrect a claim" half.
	 *
	 * THE ONE SEQUENCE WITH NO EVENT TO KEY ON, stated rather than papered over:
	 * a pass whose `compaction_end` frame is lost with no observed receipt gap,
	 * over an idle session that never reconnects, never reads history and sends
	 * nothing, leaves the rung standing until one of those happens. There is no
	 * frame to key a retirement on — the backend emits the end once — so the
	 * honest repair is a timeout this pure reducer cannot own, or a backend
	 * replay. Neither is in this change; QA round 1 could not reproduce the
	 * sequence (the mock's pass cannot lose a single frame) and the reviewer's
	 * mutation runs cover every transition above.
	 */
	compacting: boolean;
	/**
	 * When the standing claim began, on this reader's clock, or 0 when there is
	 * none.
	 *
	 * WHY IT IS STAMPED RATHER THAN INFERRED. A durable outcome row retires the
	 * claim, and "has this reader painted the row" is a fact about the INDEX
	 * rather than about the pass: an older page merged by `load older` carries a
	 * compaction outcome the reader has never painted, and retired a pass that
	 * was still running — killing both the rung and the composer's hint mid-pass
	 * (review round 2, NEW-1). The stamp is the pass's own start, so an outcome
	 * OLDER than it is somebody else's pass and retires nothing. Both clocks are
	 * this machine's: the runtime is local, and its `ts` is the same wall clock
	 * the frame arrived on.
	 */
	compactingSince: number;
	/**
	 * Bumped by every wholesale view reset — the `/clear` contract, which paints
	 * an empty view over a session that is still on the backend.
	 *
	 * WHY A COUNTER RATHER THAN A FLAG. A scheduled read cannot ask "was the view
	 * cleared since I was scheduled" of `records.length === 0`: an empty view is
	 * also a session that has not loaded yet, and a session that was never
	 * non-empty. Comparing the epoch it captured with the epoch on the view is the
	 * only honest answer, and `/clear` inside the read's window otherwise put the
	 * cleared rows back on a screen the user had just emptied (review round 3,
	 * U11/Q7/R3-7).
	 */
	viewEpoch: number;
	/**
	 * Wall-clock ms of the last `/clear`, or `undefined` if the view has never
	 * been cleared.
	 *
	 * WHY THIS EXISTS, and it is a MEASUREMENT rather than a theory. A cleared view
	 * must admit the outcome row of the pass the read exists for and no earlier
	 * pass's. The first attempt scoped that to the READ's own instant (the command
	 * receipt), on the reasoning that a pass's row cannot be written before the
	 * receipt that started it. Measured on a real runtime, that is false for the
	 * fast path: refusing an empty conversation takes no model call, so
	 * `_record_compaction_refusal` wrote the row 24 ms BEFORE the client even held
	 * the HTTP response — and the renderer takes its `since` after receiving it, so
	 * every such refusal fell outside the scope and the pane stayed silent (QA
	 * round 7's Q15, reproduced here on a real serve rather than a mock).
	 *
	 * The clear instant is the boundary the rule actually needs: a pass whose
	 * receipt was sent after the clear writes its row after the clear, whatever the
	 * write-to-receipt gap is, and a pre-clear pass's row is before it by
	 * construction. It is deliberately NOT a tolerance window — that would be a
	 * clock guess standing in for a fact the state can hold.
	 */
	clearedAt?: number;
	/** Oldest durable id painted; the cursor for `sessions.history` paging. */
	oldestId: string | null;
	/**
	 * The instant (ms; 0 = none) of the journal entry `oldestId` names, STORED
	 * beside it rather than derived from it.
	 *
	 * WHY IT IS STORED. The cursor is a JOURNAL ENTRY id, and the entry is not
	 * necessarily a record: silent `session_spend.v1` customs never become one,
	 * and a tool result is keyed `tool:<callId>` rather than by its entry id. The
	 * cursor used to be compared by looking `oldestId` up among the records, so at
	 * 7 of the 11 page boundaries of the reported 1233-entry journal the lookup
	 * failed and a re-applied tail page replaced the cursor with its own first
	 * entry - the reader was thrown back to the newest page and every later
	 * "load earlier" asked for rows it already held. A stored instant is the
	 * comparison a tail-type read needs (`applyHistoryPage`, rule 4) and it has no
	 * lookup to fail.
	 */
	oldestTs: number;
	hasMore: boolean;
	/**
	 * Call id -> the arguments that call was made with, accumulated across every
	 * page and live event seen so far.
	 *
	 * WHY THIS OUTLIVES A PAGE. A durable tool row carries the RESULT and not the
	 * arguments: the arguments live on the paired assistant row's `tool_calls`.
	 * Those two entries are usually adjacent, so a map built per page finds them
	 * — but not always, and when it misses, the row settles with `args: null`,
	 * `summaryFromArgs` falls back to the tool name, and the row loses the object
	 * column that is its whole identity (the TUI reference: the command runs
	 * nearly the full width because it is the fact the row exists to carry).
	 *
	 * Two ways they separate, both real. A page BOUNDARY can fall between the
	 * assistant row and its results. And on reconnect the backend evicts
	 * `tool_execution_start` for any call whose `_end` survived the live-event cap
	 * (`frontend_state.py`, `LIVE_EVENT_END_ROWS_MAX`), so the seed keeps the end
	 * — which has no args — and drops the start, which is the only live carrier of
	 * them. That is what produced the run of nine identical unlabelled `bash`
	 * rows in this PR's own evidence.
	 *
	 * The data is not the limitation: `arguments` is present on 100% of
	 * `tool_calls` across 26,973 real tool rows. Only the lookup window was too
	 * narrow, so it is widened to the session rather than the page, and a later
	 * page can backfill a row an earlier one painted blank.
	 *
	 * The value is what the session knows about the call: `arguments` as above,
	 * plus `anchoredAt` — epoch ms of the frame or durable row that STATED the
	 * call, i.e. roughly when it was composed. `anchoredAt` is a POSITION, not a
	 * label: the seed can be handed a settling frame for a call made hours
	 * earlier (`tool_execution_end` carries no clock at all, and the start that
	 * did is deleted from the seed by the same fold that appends the end), and
	 * the durable row that named the call is then the only statement of WHEN it
	 * happened. See `seededClock`.
	 */
	argsByCall: Map<string, Record<string, unknown>>;
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
	records: [],
	index: new Map(),
	generation: 0,
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
	oldestId: null,
	oldestTs: 0,
	hasMore: false,
	argsByCall: new Map(),
};

/**
 * Whether a fault class names an INTERRUPT rather than a failure.
 *
 * The one rule both readings of the interrupted state share: the terminal
 * never-run frame's `not_run_kind` and an end result's `details.__fault` come
 * from one vocabulary (`harness/types.py`'s FAULT_* set), and exactly two of its
 * values mean the call was stopped rather than broken - `skipped` (steering
 * redirected before it ran) and `aborted` (the user stopped the turn). Keeping
 * the pair in one exported predicate is what stops the live path, the durable
 * path and the row's outcome ladder from ever disagreeing about which kinds they
 * recognise; a third caller added later reads it rather than restating it.
 *
 * Everything else - `execution`, the model faults, the gate outcomes, and a
 * value a future core adds - is `false`, which is today's behaviour, the safe
 * direction for a vocabulary that may grow.
 */
export function isInterruptedFault(fault: unknown): boolean {
	return fault === "skipped" || fault === "aborted";
}

/**
 * One frame's `args`, when it has any, as a plain object.
 *
 * The wire is untyped at this boundary, so anything that is not a non-array
 * object (absent, `null`, a string a provider sent in place of the object) is
 * treated as "this frame says nothing" rather than reaching `summaryFromArgs`
 * as a value whose `Object.entries` would enumerate something meaningless.
 */
function frameArgs(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * The arguments a call was made with, from whichever source still carries them.
 *
 * Three producers know them and not one of them is reliable alone:
 *
 *   1. `tool_execution_start` — the only LIVE frame that carries `args`.
 *   2. the durable assistant row's `tool_calls` — accumulated into
 *      `TranscriptState.argsByCall`, which is the only source that survives a
 *      page boundary or an evicted start.
 *   3. the settling frame itself, which carries none today but may in future
 *      (a runtime that echoes `args` on `tool_execution_end`).
 *
 * WHY A SETTLING ROW NEEDS THIS AT ALL. `tool_execution_end` is
 * `{tool_call_id, tool_name, result, duration_s, is_error}` — no `args` — and
 * it is the frame a viewer joining a turn ALREADY IN FLIGHT is handed for every
 * call that finished before it arrived: `frontend_state._fold_live_event` keeps
 * the end and drops the start it replaces (`live = [item for item in live if
 * item.get("tool_call_id") != call_id]`), and the same file caps the seed at
 * `LIVE_EVENT_END_ROWS_MAX = 100` ends. So the seed is a list of argument-less
 * ends, and a row painted from one had no object column at all: it fell through
 * to the output's first line, which for `bash` is the literal string
 * `exit code: 0`. A whole turn of rows then said nothing about what ran.
 *
 * Precedence is frame, then row, then session map. The frame wins because it is
 * the newest statement about THIS call; the map loses because it is the oldest
 * and can be stale about a re-issued id.
 */
function knownArgs(
	state: TranscriptState,
	callId: string,
	event: Record<string, unknown>,
	current: TranscriptRecord | undefined,
): Record<string, unknown> | null {
	return (
		frameArgs(event.args) ??
		(current?.kind === "tool" ? current.args : null) ??
		frameArgs(state.argsByCall.get(callId)?.arguments)
	);
}

type ContentBlock = {
	/** Absent on durable rows: the encoder drops pydantic defaults. */
	type?: string;
	text?: string;
	/** Inline base64. Live events always; durable rows only under 1 KiB. */
	data?: string;
	/** Attachment-store digest. Durable rows over 1 KiB. */
	attachment?: string;
	mime_type?: string;
};

/**
 * Whether a content block is an image, on EITHER wire shape.
 *
 * `type` cannot be the discriminant. The transcript encoder dumps with
 * `exclude_defaults=True` and `type` IS the pydantic default on both content
 * models, so it is absent from every durable row — the encoder's own comment
 * (`session/transcript.py:215-218`) says to identify an image by `data`, never
 * by `type`. A durable image block is therefore one of exactly
 * `{attachment, mime_type}` (the normal case, over the 1 KiB externalisation
 * floor) or `{data}` (under it), while a durable TEXT block is `{text}`.
 *
 * The old predicate tested `type === "image"` alone, which is true only of a
 * LIVE event — the owner dumps events without `exclude_defaults`. So
 * "N images attached" appeared while a turn was in flight and never once after
 * a reload. Verified against real transcripts on this machine: 6398 tool-role
 * and 192 user-role blocks whose keys are exactly `(attachment, mime_type)`,
 * with no `type` on any of them.
 */
function isImageBlock(block: ContentBlock | undefined): boolean {
	if (!block) return false;
	if (block.type === "image") return true;
	if (typeof block.attachment === "string" && block.attachment) return true;
	// A `data` key with no `type` is the sub-floor durable image. A text block
	// never carries `data`, so this cannot swallow one.
	return typeof block.data === "string" && block.data.length > 0;
}

/** Text of a canonical message: concatenated text blocks. */
export function messageText(message: Record<string, unknown> | undefined) {
	const content = message?.content;
	if (!Array.isArray(content)) return "";
	return (
		(content as ContentBlock[])
			// Excluded explicitly rather than by the `type` default. A typeless
			// durable image used to pass this filter and contribute `""`, which was
			// harmless only by accident; now that `isImageBlock` exists, relying on
			// that accident is a defect waiting for the first image block that also
			// carries a text key.
			.filter((block) => block && !isImageBlock(block))
			.filter((block) => (block.type ?? "text") === "text")
			.map((block) => block.text ?? "")
			.join("")
	);
}

/**
 * The image blocks of one message, as view-ready records.
 *
 * Identity is the point of the second argument. This surface repaints per
 * token and `shallowEqual` compares by reference, so a freshly built array
 * would fail the equality gate on every frame and re-render every image row of
 * the transcript per delta. `previous` is the array the record already holds:
 * when the extracted contents are identical, THAT array is returned, so the
 * record's `images` field keeps its reference and the gate holds.
 */
function extractImages(
	message: Record<string, unknown> | undefined,
	recordId: string,
	previous?: TranscriptImage[],
): TranscriptImage[] {
	const content = message?.content;
	if (!Array.isArray(content))
		return previous?.length ? previous : EMPTY_IMAGES;
	const images: TranscriptImage[] = [];
	for (const block of content as ContentBlock[]) {
		if (!isImageBlock(block)) continue;
		images.push({
			// Position among IMAGE blocks only, so a text block appearing between
			// two images cannot renumber them and remount both.
			id: `${recordId}:${images.length}`,
			data: typeof block.data === "string" && block.data ? block.data : null,
			attachment:
				typeof block.attachment === "string" && block.attachment
					? block.attachment
					: null,
			mimeType:
				typeof block.mime_type === "string" && block.mime_type
					? block.mime_type
					: "image/png",
		});
	}
	if (images.length === 0) return EMPTY_IMAGES;
	if (previous && sameImages(previous, images)) return previous;
	return images;
}

/** One shared empty array, so "no images" is always the same reference. */
const EMPTY_IMAGES: TranscriptImage[] = [];

/**
 * Never let an empty extraction replace images a record already holds.
 *
 * "This event carried no image blocks" and "this call produced no images" are
 * different claims, and only the second should be able to clear a row. The
 * reconnect seed makes the difference load-bearing: the backend strips image
 * bytes out of `live_events`, so a replayed `tool_execution_end` legitimately
 * arrives with nothing where a resolvable digest already sits.
 *
 * Returns the previous array by REFERENCE when it wins, so the identity gate in
 * `shallowEqual` still reports the record as unchanged.
 */
function preferExisting(
	next: TranscriptImage[],
	previous: TranscriptImage[],
): TranscriptImage[] {
	return next.length === 0 && previous.length > 0 ? previous : next;
}

function sameImages(a: TranscriptImage[], b: TranscriptImage[]) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (
			a[i].id !== b[i].id ||
			a[i].data !== b[i].data ||
			a[i].attachment !== b[i].attachment ||
			a[i].mimeType !== b[i].mimeType
		)
			return false;
	}
	return true;
}

function withIndex(records: TranscriptRecord[]): TranscriptState["index"] {
	const index = new Map<string, number>();
	records.forEach((record, position) => index.set(record.id, position));
	return index;
}

/**
 * Keep the FURTHEST-advanced frame cursor of the two, never a regression.
 *
 * WHY IT CAN REGRESS WITHOUT THIS. The seed fold carries the SNAPSHOT's own
 * cursor, and a snapshot can state a position BEHIND a row that live frames
 * already advanced (a re-attach whose snapshot was cut earlier). Stamping the
 * snapshot's cursor over the row's own would move the row's position backwards,
 * and then a re-delivery of a frame between the two would pass the gate and
 * append a fragment the row already consumed — the exact corruption the cursor
 * exists to refuse. So a stamp is only ever an advance: within one epoch the
 * higher seq wins, and a new epoch always wins (a replaced owner restarts the
 * stream, and the old numbering means nothing beside the new).
 */
function advancedFrame(
	current: DeltaFrame | undefined,
	incoming: DeltaFrame | undefined,
): DeltaFrame | undefined {
	if (!incoming) return current;
	if (!current || incoming.epoch !== current.epoch) return incoming;
	return incoming.seq >= current.seq ? incoming : current;
}

/**
 * The same records in TIME order, ties broken by the position each already had
 * — EXCEPT the tail block a pending send holds (below), which keeps arrival
 * order until the owner's row states where it sits.
 *
 * The rule the durable page is ordered by, shared so the live seed places a row
 * by the SAME rule rather than a second one: a row the seed dates from a real
 * clock belongs where that time belongs, and `upsert` appends an unknown id —
 * right for a row arriving now, wrong for one the seed itself dated to hours
 * ago.
 *
 * WHERE THE PAGE ALREADY USED THIS RULE, and what changed when it became shared:
 * the sort this replaced read a position from `base.records` and fell back to
 * one from the INCOMING page, so for an exact-millisecond tie between a painted
 * row and an arriving page row it compared two different index spaces (`base`
 * position against page position) and could sort the arriving row ABOVE the row
 * already on screen — the opposite of what that sort's own comment promised.
 * Reading every position from the list being sorted is what makes "an existing
 * row cannot be displaced by an arriving page row" true, so sharing the rule is
 * a deliberate, one-case behaviour change in the page merge rather than the pure
 * refactor this originally read as. A probe against the reducer at main shows
 * `a1,a2,b1,a3` where this produces `a1,a2,a3,b1`, and
 * `scripts/transcript-reducer.test.mjs` pins the order this produces.
 *
 * WHY A PENDING ECHO IS NOT SORTED BY ITS STAMP (operator report, 2026-09-26):
 * "after sending a message, additional messages will load and my message ends
 * up out of order" — the bubble above assistant content that preceded it. A
 * local echo's `ts` comes from THIS renderer's clock; every page and seed row
 * carries the owner's. While the page (or seed) is still owed nothing is
 * painted to compare against, so the echo is stamped with the client's `now`
 * and any row that lands afterwards carrying an owner stamp ahead of that
 * clock (a remote owner, a client whose clock trails — or any row the runtime
 * dates ahead of the reader) sorted BELOW the echo: the just-sent message
 * rendered above content that preceded it, and stayed there until something
 * happened to re-sort again.
 *
 * The fix is not another stamp bound (`monotonicStamp` in #534 bounds an echo
 * against rows painted AT STAMP TIME; rows landing afterwards are exactly what
 * it cannot see). While the owner has stated no position for the message, NO
 * clock comparison can decide its place — the two stamps come from different
 * clocks, and any cap the echo borrowed can be exceeded by a row that lands
 * later (agent review round 1, F1) — so the send holds a TAIL BLOCK instead:
 *
 * - `provisional` marks the row whose position the owner has not stated. It
 *   is set on EVERY echo (`appendPendingUser`), over an empty transcript or a
 *   painted cache — "transcript non-empty" was never the boundary (review
 *   round 1, F1/F3: an echo over a few cached rows, or over a notice-only
 *   transcript, faces the same unchecked clock). It is cleared only when an
 *   owner-stamped row names the id: the durable page row replaces the record
 *   and it takes its canonical place. A live `message_start` that merely
 *   RESTATES the message clears `local` (the owner has the message; the
 *   store's unknown-outcome delivery read depends on exactly that) but NOT
 *   `provisional` — on a reconnect its replay folds BEFORE the snapshot's
 *   page, and ending the hold there put the echo above the page's pre-send
 *   rows (review round 1, F2).
 * - At every merge a tail block is cut from the list being sorted: every
 *   provisional row, plus every row ADMITTED while one was pending (its
 *   position in the list is past the earliest provisional row's) that THIS
 *   merge does not state on the owner's side (`ownerIds` — a page's durable
 *   rows, a seed's stated-clock rows). Non-block rows keep the time order
 *   they always had; block rows keep arrival order; every non-block row sorts
 *   above every block row — so the queued page's pre-send rows land above the
 *   echo, and a row admitted after it (a live answer) never lands above it,
 *   whatever the two clocks say.
 *
 * WHY A BLOCK AND NOT A COMPARATOR CASE: the relations are not a total order.
 * [pre-send row dated +40s, echo, live answer dated +5s] asks for
 * pre-send < echo < answer while the stamps say answer < pre-send; any
 * pairwise rule that honours both asks closes a cycle, and an inconsistent
 * comparator leaves the result to comparison order — the one thing an order
 * may not be. Cutting the block makes the comparison total again (class
 * first, then the key the class owns), and it is the shape the single-echo
 * case already had — "after every canonical row, arrival order among several"
 * — widened from "the echoes" to "the rows the send left unresolved".
 *
 * WHAT THE BLOCK GIVES UP, stated rather than left for a reviewer to find:
 * - A replay frame for a row that will turn out to be PRE-send sits after the
 *   echo until the page states it — durable wins, and it then sorts by its
 *   own stamp; the correction arrives with the merge that owns it.
 * - A row whose durable form never arrives (a settled streaming row) keeps
 *   the arrival position it was admitted at; once no provisional row remains
 *   the block dissolves and everything sorts by stamps again.
 *
 * Ties keep the order they already had, so this can never reshuffle two rows
 * that state the same instant while the reader is looking at them. No lookup and
 * no fallback: every record's position is the one it arrives with, which is what
 * makes an unknown id unrepresentable here rather than something to default.
 */
const NO_OWNER_IDS: ReadonlySet<string> = new Set();

function withTimeOrder(
	records: TranscriptRecord[],
	/**
	 * The ids THIS merge states on the owner's side: a page's durable rows, and
	 * the rows a seed dates from a real clock. They sort above the tail block
	 * whatever the stamps say — a page whose rows postdate the send carries the
	 * echo's own row too, and until that arrives the rows it does carry are the
	 * journal in front of the send (agent review round 1, F1).
	 */
	ownerIds: ReadonlySet<string> = NO_OWNER_IDS,
): TranscriptRecord[] {
	/*
	 * `provisional` is the hold; `appendPendingUser` sets it on every echo and
	 * the owner's stamped row is what clears it. `local` deliberately does NOT
	 * participate: the live restating `message_start` clears `local` (delivery —
	 * `peekLocalEcho`'s "owner" is the store's test) while the position hold
	 * must survive it (review round 1, F2).
	 */
	const pendingEcho = (record: TranscriptRecord) =>
		record.kind === "user" && record.provisional === true;
	const positioned = records.map((record, position) => ({ record, position }));
	// The earliest admitted pending row bounds the block. `position` is the
	// index the record already held in the list being merged — admission order,
	// which no earlier merge may have re-spelled for rows past the block.
	const frontier = positioned.reduce(
		(min, entry) =>
			pendingEcho(entry.record) && entry.position < min ? entry.position : min,
		Number.POSITIVE_INFINITY,
	);
	/*
	 * Rows past the frontier were ADMITTED after the send, so they hold the
	 * tail with it unless this merge itself places them on the owner's side.
	 */
	const inTailBlock = (entry: { record: TranscriptRecord; position: number }) =>
		pendingEcho(entry.record) ||
		(entry.position > frontier && !ownerIds.has(entry.record.id));
	return positioned
		.sort((a, b) => {
			const blockA = inTailBlock(a);
			const blockB = inTailBlock(b);
			if (blockA !== blockB) return blockA ? 1 : -1;
			// Inside the block, arrival order; outside it, the time order this
			// function has always produced.
			if (blockA) return a.position - b.position;
			return a.record.ts !== b.record.ts
				? a.record.ts - b.record.ts
				: a.position - b.position;
		})
		.map((entry) => entry.record);
}

function shallowEqual(a: TranscriptRecord, b: TranscriptRecord) {
	// `Record<string, unknown>` rather than the union's own key type: the union
	// narrows `keyof` to the fields COMMON to every variant, so indexing it
	// cannot see `images` at all and the comparison below would be typed as
	// unreachable. The runtime shape is what is being compared here.
	const left = a as unknown as Record<string, unknown>;
	const right = b as unknown as Record<string, unknown>;
	const keysA = Object.keys(left);
	if (keysA.length !== Object.keys(right).length) return false;
	for (const key of keysA) {
		if (left[key] === right[key]) continue;
		// `images` is the one field that is an ARRAY, so reference equality is
		// too strict for it: two extractions of the same unchanged content are
		// equal in every way a view cares about. `extractImages` already returns
		// the previous array when it can, and this covers the paths where it
		// cannot see one — without it, a live event that rebuilt a record for an
		// unrelated reason would report the row as changed and re-render every
		// image on it, on a surface that repaints per token.
		if (key === "images") {
			const before = left[key] as TranscriptImage[] | undefined;
			const after = right[key] as TranscriptImage[] | undefined;
			if (
				Array.isArray(before) &&
				Array.isArray(after) &&
				sameImages(before, after)
			)
				continue;
		}
		// `frame` is a VALUE - the pair `(epoch, seq)` - and every fold builds a
		// fresh object for it, so reference equality would report an unchanged row
		// as changed on every seed re-apply and replace the record (and re-render
		// it), the exact cost the equality gate exists to prevent (agent review
		// round 1, finding 2: an identical seed re-applied was a `s2 !== s1`
		// replacement). Two cursors are equal exactly when the stream would treat
		// them as the same position.
		if (key === "frame") {
			const before = left[key] as DeltaFrame | undefined;
			const after = right[key] as DeltaFrame | undefined;
			if (
				before !== undefined &&
				after !== undefined &&
				before.epoch === after.epoch &&
				before.seq === after.seq
			)
				continue;
		}
		return false;
	}
	return true;
}

/**
 * Upsert one record. Returns the same state when the record is unchanged
 * (by shallow field equality), so the caller's identity gate holds.
 */
function upsert(state: TranscriptState, record: TranscriptRecord) {
	// Freeze at emit, in development only: this is the reducer's one choke point
	// for live records (every `upsert` caller, `markLiveRecordsTruncated` and
	// `appendPendingUser` included), and the frozen record is what makes a later
	// in-place write throw instead of leaving `collapseRowsKey`'s cached signature
	// stale (see `record-immutability.ts`, agent review round 2, M1r2). A no-op in
	// production and in the Node suites, whose bundles read `DEV` as false.
	freezeRecordDeep(record);
	const position = state.index.get(record.id);
	if (position !== undefined) {
		const current = state.records[position];
		if (shallowEqual(current, record)) return state;
		const records = state.records.slice();
		records[position] = record;
		return { ...state, records };
	}
	const records = [...state.records, record];
	const index = new Map(state.index);
	index.set(record.id, records.length - 1);
	return { ...state, records, index };
}

function removeMatching(
	state: TranscriptState,
	predicate: (record: TranscriptRecord) => boolean,
) {
	if (!state.records.some(predicate)) return state;
	const records = state.records.filter((record) => !predicate(record));
	return { ...state, records, index: withIndex(records) };
}

/**
 * Drop the row a compose frame announced under an index-derived placeholder.
 *
 * The promotion path REKEYS that row rather than dropping it (`supersedesRekey`,
 * which is the shape the contract names); this is the case where a second frame
 * already arrived under the call's real id, so the announcement is a duplicate
 * that the row would otherwise sit beside for the life of the turn.
 *
 * Only an ANNOUNCEMENT is retired. A placeholder row that has somehow settled is
 * left alone: it is the record of a call that reached an outcome, and deleting
 * it would erase a fact rather than a duplicate. Returns the SAME state when
 * there is nothing to retire.
 */
function supersedesRetire(
	state: TranscriptState,
	placeholderCallId: string,
): TranscriptState {
	const id = `tool:${placeholderCallId}`;
	const position = state.index.get(id);
	if (position === undefined) return state;
	const record = state.records[position];
	if (
		!(
			record.kind === "tool" &&
			(record.phase === "composing" || record.phase === "queued")
		)
	)
		return state;
	return removeMatching(state, (candidate) => candidate.id === id);
}

/**
 * REKEY the announcement row: the same row, in the same place, under the real id.
 *
 * `ToolCallComposeEvent.supersedes_tool_call_id` says this frame's id belongs to
 * the call the frames carrying the placeholder's id were announcing. Rekeying
 * rather than closing one row and opening another is what the contract asks for
 * ("lets each of those consumers rekey the row it already has instead of opening
 * a second one"), and it is what keeps the ledger's order stable: the record
 * holds its position, so the row cannot jump down the transcript at the moment
 * its identity arrives. The record handed in already carries the announcement's
 * own `ts` and byte count, so the row keeps the time and the size it was painted
 * with.
 *
 * Returns the SAME state when there is nothing to rekey — no placeholder row, or
 * one that has already settled — which is half of what makes the repeat
 * announcement a no-op (the caller's equality gate is the other half).
 */
function supersedesRekey(
	state: TranscriptState,
	placeholderCallId: string,
	record: TranscriptRecord,
): TranscriptState {
	const at = state.index.get(`tool:${placeholderCallId}`);
	if (at === undefined) return state;
	const announcing = state.records[at];
	if (
		!(
			announcing.kind === "tool" &&
			(announcing.phase === "composing" || announcing.phase === "queued")
		)
	)
		return state;
	const records = state.records.slice();
	records[at] = freezeRecordDeep(record);
	return { ...state, records, index: withIndex(records) };
}

// ---------------------------------------------------------------- durable

/** Custom transcript rows that are bookkeeping, never conversation. */
const SILENT_CUSTOM_TYPES = new Set([
	"frontend_state_checkpoint_v1",
	"session_state",
	"hub_communication",
	"wake_schedule",
	"prune",
]);

/**
 * A compaction that did NOT run: its sentence and the ink it deserves.
 *
 * The rule is the BACKEND's, not one invented here —
 * `local_operator/harness/rows.py::compaction_refused_notice` derives the tier
 * for every surface (`warning` for a DECLINE, because the context the user
 * asked to reclaim is still there; `error` for a FAILURE, because "not worth
 * it" and "I could not" are different things to the person deciding what to do
 * next), and the phone and the terminal host both render through it. A
 * renderer that picked its own ink would make one event read two ways.
 *
 * WHY THIS EXISTS AT ALL. A refusal emits NO `compaction_start` — the runtime
 * answers the routed command optimistically and the pass declines before the
 * start event (`session/runtime/serving.py::_record_compaction_refusal`, whose
 * docstring says the row "corrects the optimistic receipt") — so the pass has
 * no rung and no settling frame to paint. The durable row is the only record,
 * and listing it as bookkeeping left a manual `/compact` on a conversation with
 * nothing to compact painting NOTHING at all (UX round 1, U1; QA Q2). With the
 * dialog gone that is the surface the dialog used to occupy.
 */
function compactionOutcome(detail: string): {
	text: string;
	level: "info" | "warning" | "error";
} {
	const sentence = detail.trim() || "compaction did not run";
	/*
	 * The separator yields to the backend's own punctuation: its common detail
	 * already carries a colon ("nothing to compact: the whole conversation is ~8
	 * tokens …"), and the app opening with one too read as two nested claims
	 * (design round 2, N1). An em dash is the join, because the sentence after it
	 * is the runtime's and not this renderer's to rewrite.
	 */
	return {
		text: `Compaction did not run${sentence.includes(":") ? " — " : ": "}${sentence}`,
		level: sentence.startsWith("compaction failed") ? "error" : "warning",
	};
}

/**
 * The settled line for a pass whose OWN figures this reader still has: the live
 * `compaction_end` sentence, before and after included.
 *
 * WHY THE LIVE SENTENCE IS THE ONE THAT SURVIVES THE PAIRING. A pass is projected
 * twice — the live event, which knows `tokens_before` and `tokens_after`, and the
 * DURABLE `compaction` transcript row, which knows only `tokens_before`
 * (`Transcript.append_compaction`'s payload has no after-figure; read from the
 * backend, not inferred). The live sentence is strictly the more informative of
 * the two, so it is the one the pair keeps: the row a reader watched settle is
 * the row they keep reading, figures and all, until something reloads the view
 * without it.
 *
 * WHICH IS A LIVE-ONLY FACT, and that is parity rather than a defect. The base
 * app painted this sentence from the event, and the terminal host's own receipt
 * (`tui/session_presentation.py`) carries the figures too while only its REPLAY
 * is the bare marker sentence. A cold reload — a fresh reader with no live row to
 * pair — shows `COMPACTED_LINE`, exactly as the replay does.
 *
 * The two figures are printed as the pair when they differ and as one number when
 * they match, because a pass whose reduction rounds to the same step printing
 * `52.7k to 52.7k` reads as "compacted and changed nothing" (UX round 1, U4).
 *
 * PERSISTING the pair is a one-field backend change — `append_compaction`
 * carrying the after-figure, or the settled sentence — recorded under "not
 * addressed" in the round-3/4 remediation rather than papered over here.
 */
export function compactionSettledLine(before: number, after: number): string {
	const from = formatTokens(before);
	const to = formatTokens(after);
	return from === to
		? `Context compacted to ${to} tokens`
		: `Context compacted, ${from} to ${to} tokens`;
}

/**
 * What a pass's row says when this reader has no live sentence for it: the
 * durable row's own sentence, and the sentence a COLD reload shows.
 *
 * It is deliberately not a second opinion about the pass — a reader that never
 * saw the live line learns that the context was compacted and nothing more,
 * which is what the transcript can honestly say.
 */
export const COMPACTED_LINE = "Context compacted";

/**
 * One pass, one row: the live settled line and the durable row are two
 * projections of ONE event, so exactly one of them may be painted.
 *
 * WHY THIS SHAPE, and it replaces two rules that were both wrong. The first
 * matched each incoming durable row against the FIRST painted `compaction:` row
 * within two minutes (stateful and unordered: one live row could be spent twice).
 * The second ordered the pair by clock on the stated reasoning that "a durable row
 * is written when a pass ENDS" — which is backwards, and review round 4 measured
 * it: the backend awaits `append_compaction` (whose ts is `time.time()` at the
 * write, `session/transcript.py:809-812`) and only THEN emits the settle event
 * (`session.py:9851`), while the renderer stamps the live line with `Date.now()`
 * when it processes that frame, so the durable row is the OLDER of the two in
 * either arrival order. One pass painted two rows — bare and figured, side by
 * side, stable for a minute.
 *
 * So the pair is matched by IDENTITY first, because both projections already carry
 * one: the live id spells the pass's `tokens_before` and the durable entry has it
 * in its payload (the field the bare fallback reads for its sentence). A live line
 * takes the durable row whose `before` equals its own — one-to-one, oldest live
 * line first. A SECOND PAIRING INSIDE THE WINDOW remains for the row that carries
 * no fingerprint (an older transcript): nearest by `|Δts|` in EITHER direction,
 * claimed once. Distance is a tie-break, never the primary key.
 *
 * Still a PURE, TOTAL, IDEMPOTENT function of the record list: computed from the
 * whole list rather than patched as pages arrive, so applying the same page twice,
 * re-seeding it with `replace`, or loading it cold all produce the SAME rows, and
 * the chosen sentence is carried INTO the record so a later read cannot strip it.
 * Refusals need no rule here: the runtime writes the durable row and emits no
 * event at all (see `refreshTail`'s note), so there is no live line to collapse.
 */
/**
 * How far apart two projections of one pass may sit when the durable row carries
 * no fingerprint to match on. Wide enough for a slow disk write plus the frame's
 * round trip, narrow enough that an unrelated pass minutes later cannot be
 * claimed by it — and it is only ever a FALLBACK: the fingerprint is the key.
 */
const SETTLED_PAIRING_WINDOW_MS = 120_000;

export function collapseSettledCompactions(
	records: TranscriptRecord[],
): TranscriptRecord[] {
	type Settled = Extract<TranscriptRecord, { kind: "compaction" }>;
	const live: Settled[] = [];
	const durable: Settled[] = [];
	for (const record of records) {
		if (record.kind !== "compaction") continue;
		// Synthetic ids are the live projections (`compaction:<generation>:…`);
		// a durable row carries the transcript entry's own id.
		if (record.id.startsWith("compaction:")) live.push(record);
		else durable.push(record);
	}
	if (live.length === 0 || durable.length === 0) return records;
	const claimed = new Set<string>();
	const dropped = new Set<string>();
	/** The sentence each paired durable row keeps, keyed by its id. */
	const kept = new Map<string, string>();
	const pair = (row: Settled, candidate: Settled) => {
		claimed.add(candidate.id);
		dropped.add(row.id);
		kept.set(candidate.id, row.text);
	};
	const ordered = [...live].sort((a, b) => a.ts - b.ts);
	// Identity first: the pass's own figure, which only its durable row carries.
	for (const row of ordered) {
		if (row.before === undefined) continue;
		const match = durable.find(
			(candidate) =>
				!claimed.has(candidate.id) && candidate.before === row.before,
		);
		if (match) pair(row, match);
	}
	/*
	 * Then the window, and ONLY for a durable row that carries no figure at all.
	 *
	 * WHY THE EXCLUSION IS THE FIX, not a refinement (UX round 5, U19 = R5-3). The
	 * fallback as first written considered every unclaimed row and took the
	 * nearest, so a live line whose own durable row had not arrived yet could claim
	 * the PREVIOUS pass's row — 30 s inside the window, and the nearest candidate
	 * there was. Measured live: durable figures 25 / 3781 / 5301, and the pane read
	 * `to 3.8k` on pass 1's slot, `to 5.3k` on pass 2's, pass 3 bare — each row
	 * carrying the NEXT pass's figures, stable and wrong. A row that HAS a
	 * fingerprint says which pass it belongs to; a live line whose figure differs is
	 * a different pass, so the row is not a candidate — not a worse one.
	 *
	 * What remains is the case this existed for: an older transcript whose rows
	 * predate the field. There the pair is chosen by DISTANCE — every live/durable
	 * combination ranked globally, nearest first, each side claimed once — rather
	 * than oldest-live-first, because oldness was the old rule's reasoning and it
	 * contradicts the sentence this function states.
	 */
	const pairs: { live: Settled; durable: Settled; distance: number }[] = [];
	for (const row of ordered) {
		if (dropped.has(row.id)) continue;
		for (const candidate of durable) {
			if (candidate.before !== undefined) continue;
			const distance = Math.abs(candidate.ts - row.ts);
			if (distance > SETTLED_PAIRING_WINDOW_MS) continue;
			pairs.push({ live: row, durable: candidate, distance });
		}
	}
	pairs.sort((a, b) => a.distance - b.distance);
	for (const { live: row, durable: candidate } of pairs) {
		if (dropped.has(row.id) || claimed.has(candidate.id)) continue;
		pair(row, candidate);
	}
	if (dropped.size === 0) return records;
	return records
		.filter((record) => !dropped.has(record.id))
		.map((record) => {
			const text = kept.get(record.id);
			if (text === undefined) return record;
			if (record.kind !== "compaction" && record.kind !== "notice")
				return record;
			return text === record.text
				? record
				: freezeRecordDeep({ ...record, text });
		});
}

/**
 * The same collapse, applied to a STATE — so the live path and the page path run
 * one rule over one list instead of two callers each doing the arithmetic.
 *
 * Identity is preserved when nothing is dropped, which is what keeps the row
 * memo (and therefore the frames) stable through a read that changed nothing.
 */
function collapseRecords(state: TranscriptState): TranscriptState {
	const records = collapseSettledCompactions(state.records);
	if (records === state.records) return state;
	return { ...state, records, index: withIndex(records) };
}

/**
 * The two custom types that are receipts rather than conversation.
 *
 * Both arrive as `custom` rows whose `details.text` is model-facing markup, and
 * both have a human-facing field beside it — which is why they are projected
 * rather than painted (see `receipt-row-model`). They are matched by the wire
 * names the harness writes (`session/peer.py`, `harness/wake.py`).
 */
const PEER_MESSAGE_CUSTOM_TYPE = "peer_message";
/**
 * The two queued-ask receipt types, matched by the wire names the harness
 * writes (`harness/message_types.py`).
 *
 * Named here rather than inlined so the two rows that consume them and the
 * branch that mints them cannot drift: a typo in one string would drop the row
 * silently, which is the failure mode this constant exists to remove.
 */
const ASK_RESPONSE_CUSTOM_TYPE = "ask_response";
const ASK_TIMEOUT_CUSTOM_TYPE = "ask_timeout";
/**
 * The core's neutral closure copy (v2, 2026-09-29). A `closed` completion is a
 * disposal that caught a run which spent no provider round-trip: a receipt,
 * not a verdict. Byte-identical to `harness/rows.py::CLOSED_NOTICE_TEXT` in
 * local-operator — the two repos render the same sentence for the same record,
 * and drift between them is the divergence this feature exists to remove.
 */
const CLOSED_OUTCOME_TEXT = "Completed — runtime retired/disposed";
/*
 * The retire-for-build row's sentence (core kind `retired`, 2026-09-29; seed
 * 7e797aaaf6e7): a bound-expired build drain cut a live turn, so the row stays
 * TRUTHFUL — the turn was cut — but reads in WARNING ink, never danger: the
 * update was routine. The kept-output clause (design round 2, D1) is the one
 * fact a user who lost work needs, so it rides in both repos' constants.
 * Byte-identical to the core's
 * `harness/rows.py::RETIRED_NOTICE_TEXT`, so both repos print the same words
 * for the same record (the discipline `CLOSED_OUTCOME_TEXT` above states).
 */
const RETIRED_OUTCOME_TEXT =
	"Retired for an update — a turn was in flight and was cut; its earlier output is kept";
const WAKE_PROMPT_CUSTOM_TYPE = "wake_prompt";
/**
 * The harness's MCP-unavailable warning, which takes its own arm in `customRow`.
 *
 * Named here rather than inlined at the branch because two docblocks and the
 * row builder all refer to it, and a wire name spelled in four places is four
 * places to get it wrong. The harness writes it under its own record type rather
 * than as a `session_incident`, so that no surface has to derive the tier for an
 * event that takes a capability away without ending a turn.
 */
const MCP_UNAVAILABLE_CUSTOM_TYPE = "session_mcp_unavailable";
/**
 * Custom rows whose TEXT is the message, not a payload to disclose.
 *
 * The three types here are the harness telling the reader that something changed
 * mid-session (a model switch, a recovered MCP server, a stored credential).
 * Each is a short statement a reader has to be able to read, and the TUI paints
 * it as a wrapping line for the same reason
 * (`tui/widgets/transcript.py::NoticeBlock`).
 *
 * TWO types that are read the same way are deliberately NOT here, because a type
 * with its own path is not listed in a set it can never reach — and a member that
 * can never match is configuration a later reader will try to "fix":
 *
 * - `session_incident` takes `customRow`'s other arm before this set is read, and
 *   brings a classification and a provider with it;
 * - `session_mcp_unavailable` takes `mcpUnavailableRow`, for the reason that
 *   builder's docblock gives: its second line is the OPERATOR's remedy rather
 *   than the model's instruction, so it must not be split on the first sentence
 *   the way these three are.
 *
 * Any other custom type that reaches this branch is a RELAYED payload — a
 * `hub_message`, a job result — whose body belongs behind the disclosure:
 * measured over the operator's own store those run to 18,259 characters, and a
 * transcript that painted them inline would be unusable. They are not reduced to
 * their type name either; the row states its first substantive line and keeps
 * the body one click away.
 *
 * `peer_message` and `wake_prompt` are custom types too, but they never reach
 * this branch or this set: `durableRecord` projects each to its own kind first
 * (see the receipts branch there), because upstream's `receipt-row-model` owns
 * both rows and derives their headline and prompt at paint time. Correcting this
 * paragraph rather than the code is the point — it used to list those two among
 * the types here, and neither can arrive at this branch now, which is how the
 * next reader ends up "fixing" machinery that cannot run (round 7's R33).
 */
const INLINE_CUSTOM_TYPES = new Set([
	"session_mcp_recovery",
	"session_model_switch",
	"session_credential",
]);

/**
 * The head of a rendered incident: `[session incident (provider/model)] mcp: `.
 *
 * The category is bounded because this is a label, not a paragraph, and a
 * payload that happens to start with a bracket is not an incident.
 *
 * NO BACKTICKS IN THIS FILE'S COMMENTS: the module is handed to esbuild as a
 * bundle input and one stray delimiter in a docblock has already cost this
 * repository a build.
 */
const INCIDENT_HEAD =
	/^\[session incident(?:\s*\(([^)]*)\))?\]\s*([^:\n]{1,40}):\s*/;

/**
 * An envelope tag line: `<parent-message>`, `<peer-session-message …>`, and the
 * CLOSING form `</parent-message>`.
 *
 * Both relays put the actual message on the NEXT line, so quoting the tag alone
 * tells a reader nothing — which is what a first-line headline did for every
 * `hub_message` in the store. Closing tags matter for the same reason rather
 * than for symmetry: a relay whose body is empty is persisted as
 * `<subagent-message label=… job=…>` / blank / `</subagent-message>` (34 rows in
 * the store), and without this the row painted the closing tag as its message.
 */
const ENVELOPE_TAG = /^<\/?[a-z][a-z0-9-]*(\s[^>]*)?>$/i;

/**
 * The three lines `harness/comms.py::TO_CHILD_INSTRUCTIONS` prepends to a
 * relayed `hub_message`, normalised to one lowercase line.
 *
 * They are the channel's manners, not the message: measured over the store,
 * 411 hub rows open with the `note` line verbatim, so quoting it inline made
 * every one of those rows read the same and pushed the parent's actual words
 * behind the chevron. The instruction stays in the body — it is the first thing
 * a reader meets once they open the row, and the kind is on the label.
 */
const RELAY_INSTRUCTIONS = new Set([
	"this changes your instructions. apply it from now on, and drop work it makes pointless.",
	"answer it now with the `hub` tool — a short, direct reply — then carry on with what you were doing. do not restructure your work around the question.",
	"this is a note, not a question. no reply is needed unless it changes what you should do.",
]);

/**
 * The bracket the harness prefixes its statement texts with (`[model switch]`).
 *
 * THE `{1,32}` IS A SILENT BEHAVIOUR CHANGE ABOVE 32: a tag longer than that does
 * not strip, so the tag rides into the headline and the row re-quotes its own
 * label (`[session warning about the mcp layer] …` reads as the fact). Measured:
 * 32 inner characters strip, 33 do not. The shipped tags are 15-16 characters, so
 * the margin is wide — but the bound is what it is because the harness's own
 * labels are bounded, not because 33 is a shape anyone meant to exclude, and a
 * future head that exceeds it would move every statement row at once.
 */
const STATEMENT_TAG = /^\[[^\]]{1,32}\]\s*/;

/**
 * The prefix the harness's `format_mcp_unavailable_message` gives the reason line,
 * and the separators that end the remedy clause inside it.
 *
 * The clause is what `mcpUnavailableRow` hoists when the fact and the reason do
 * not both fit the row: everything up to and including the command the operator
 * has to run, cut before the diagnostic that follows it. Hoisted to module scope
 * for the reason the linter names (a literal inside the builder is re-created per
 * record) rather than for style.
 */
const REASON_PREFIX = "Reason:";
const REMEDY_CLAUSE_END = /[\n;,(]| [—–] /;

/*
 * The sentence scan's two conditions (round 2's R7). Module constants rather than
 * literals in the loop: they would be re-created per character otherwise, which
 * is the same reason this repository lints for it.
 */
/** A leading list marker: `1.`, `2.` — a bullet, not a sentence end. */
const LEADING_ORDINAL = /^\d+\.$/;
/** A capital, which is what an abbreviation's follower is not. */
const CAPITAL = /[A-Z]/;

/*
 * Hoisted for the reason the linter names but mostly because it is evaluated PER
 * CHARACTER: `firstSentenceEnd` walks a headline's characters, so a literal
 * inside it builds a regex object on every character of every row's text.
 */
/** Any whitespace, which is what a sentence end must be followed by. */
const WHITESPACE = /\s/;

/**
 * A headline is a summary of the row, not the row's payload — `detail` is the
 * payload. Bounded so a single-paragraph relay cannot push the ledger out of
 * its column, and cut on a word boundary so the truncation reads as one.
 */
const HEADLINE_MAX = 160;

/**
 * What a custom row paints, decided once here rather than per view.
 *
 * The defect this replaces: the view pinned every custom row to the info tier
 * and hid any row longer than 400 characters or one line behind its chevron, so
 * 946 persisted incidents rendered as the literal string `session incident` and
 * the user had to click to learn why their turn died. Level, message and
 * disclosure are properties of the RECORD, so they are set where the record is
 * built — the same reason this module already decides the § 7 tier for every
 * other kind.
 */
function customRow(
	customType: string,
	text: string,
	details: Record<string, unknown>,
): Pick<
	Extract<TranscriptRecord, { kind: "custom" }>,
	"level" | "headline" | "detail" | "category" | "provider"
> {
	if (customType === "session_incident") {
		return { level: "error", ...incidentRow(text, details) };
	}
	/*
	 * The statement's own bracket tag repeats the row's label
	 * ("session model switch: [model switch] …"), so the headline starts at
	 * the sentence — and the harness's instruction to the MODEL, which follows
	 * that sentence, is not a headline at all. A RELAYED payload keeps its
	 * whole body as the detail, because what makes it bulky is the payload
	 * itself rather than an instruction appended to a fact.
	 *
	 * `session_mcp_unavailable` is the one custom type whose text carries a line
	 * addressed to the OPERATOR instead, so it takes the arm above this comment
	 * rather than this split — see `mcpUnavailableRow`. It is deliberately not a
	 * member of the set below: a type with its own path is not listed in a set it
	 * can never reach.
	 */
	let body: Pick<
		Extract<TranscriptRecord, { kind: "custom" }>,
		"headline" | "detail"
	>;
	if (customType === MCP_UNAVAILABLE_CUSTOM_TYPE) {
		body = mcpUnavailableRow(text);
	} else if (INLINE_CUSTOM_TYPES.has(customType)) {
		body = splitStatement(text.trim().replace(STATEMENT_TAG, ""));
	} else {
		body = relayRow(text);
	}
	return { level: "info", category: null, provider: null, ...body };
}

/**
 * The harness's MCP-unavailable warning: the fact AND the operator's remedy on
 * the row, the model-directed tail behind the disclosure.
 *
 * WHY THIS IS NOT `splitStatement`. For every other statement, everything after
 * the first sentence is the harness talking to the MODEL — `This applies from now
 * on.`, `never echo, print, or write it` — which is exactly what the disclosure
 * is for. This warning is the one statement whose SECOND line is addressed to the
 * reader: `Reason: /mcp reauth <server> — sign-in expired` is the remedy, the only
 * clause on the row anyone can act on, and the harness writes it COMMAND-FIRST so
 * that clause cannot wrap away from its own command. Split at the first sentence,
 * the collapsed row would show the fact alone, which says the tools are gone and
 * nothing about what brings them back — the row the operator reported on read as
 * though the capability might return by itself (design round 1, D1). Measured on
 * the rendered row: collapsed, it sat in the same ink, pitch and label column as
 * the `session mcp recovery` row directly above it, which needs no action from
 * anyone.
 *
 * THE BOUND APPLIES TO THE FACT PLUS THE REASON, and a reason that does not fit is
 * HOISTED to its `/mcp …` clause rather than cut at its tail. WHAT A TAIL-CUT WOULD
 * TAKE IS SETTLED BY WHERE THE PRODUCER PUTS THE COMMAND, and for the family this
 * row is written for the command comes first: the auth-failure reason reaches here
 * as the remedy alone (`/mcp reauth <server> …`), composed by
 * `local_operator/mcp/manager.py::_auth_failure_text` — the one dispatcher the
 * durable notice and the live toast both go through, and the place the
 * `MCP authorization failed; ` prefix was dropped from so the command cannot wrap
 * away from its own command. For that shape a tail-cut takes the diagnostics, not
 * the remedy.
 *
 * THE CASE THE HOIST DEFENDS IS THEREFORE THE LONG LEADING CLAUSE: a transport
 * reason runs its diagnostics long BEFORE any command is named
 * (`ECONNREFUSED 127.0.0.1:8787`, retries, timeouts), and at enough of them the
 * command clears the bound — where a tail-cut would leave the row quoting a cause
 * and drop the one clause anyone can run. That shape is pinned by its own test case
 * (round 2, R5); the wording this replaced argued from the pre-alignment line, where
 * a `MCP authorization failed; ` prefix pushed the command past the bound on its
 * own. The hoist keeps the most of the reason the bound allows — the whole reason
 * up to and including the command, then the command alone — and whatever a cut
 * leaves out moves into the disclosure ahead of the tail, so nothing the harness
 * wrote is dropped. That is also what
 * the last resort owes a reader: if even the command alone will not fit beside a
 * very long server name, the composed line is bounded and the WHOLE reason goes
 * behind the disclosure, because a truncated line's disclosure is exactly the
 * place a reader is finished off rather than a repeat of what is on the row.
 *
 * The harness's own words are painted as-is; nothing is rewritten around them.
 *
 * The formatter OMITS the `Reason:` line when the reason is blank, so a two-line
 * text is the ordinary shape too, and its tail is disclosed exactly as above.
 */
function mcpUnavailableRow(
	text: string,
): Pick<Extract<TranscriptRecord, { kind: "custom" }>, "headline" | "detail"> {
	const lines = text
		.trim()
		.replace(STATEMENT_TAG, "")
		.split("\n")
		.map((line) => line.trim());
	const fact = lines[0] ?? "";
	// The fact is the formatter's first line and the reason is its second, when
	// there is one: this row is built from the shape the harness documents, not
	// from a sentence scan (`firstSentenceEnd` would split inside a server name
	// that contains ". ", and does not apply to this type).
	const reason = lines[1]?.startsWith(REASON_PREFIX) ? lines[1] : null;
	const tail = lines
		.slice(reason ? 2 : 1)
		.filter(Boolean)
		.join("\n");
	const composed = (reason ? `${fact} ${reason}` : fact).trim();
	if (composed.length <= HEADLINE_MAX) {
		return { headline: composed, detail: tail || null };
	}
	const split = reason === null ? null : remedySplit(reason);
	if (split !== null) {
		/*
		 * A reason portion is `Reason: <leading> <command>`, with either half
		 * possibly empty — a reason that opens with the command has no leading
		 * text, and one that names no command never reaches here (`null` above).
		 */
		const portion = (leading: string, command: string) =>
			`${REASON_PREFIX} ${[leading, command].filter(Boolean).join(" ")}`;
		const disclosure = (dropped: string) =>
			[dropped, tail].filter(Boolean).join("\n") || null;
		const throughCommand = `${fact} ${portion(split.leading, split.clause)}`;
		if (throughCommand.length <= HEADLINE_MAX) {
			return { headline: throughCommand, detail: disclosure(split.rest) };
		}
		const commandAlone = `${fact} ${portion("", split.clause)}`;
		if (commandAlone.length <= HEADLINE_MAX) {
			return {
				headline: commandAlone,
				detail: disclosure(
					[split.leading, split.rest].filter(Boolean).join(" "),
				),
			};
		}
	}
	return {
		headline: bounded(composed),
		detail: [reason, tail].filter(Boolean).join("\n") || null,
	};
}

/**
 * The remedy inside a `Reason:` line, in its three parts: the text before the
 * `/mcp …` command, the command itself, and what follows it — or `null` when the
 * reason names no command.
 *
 * `null` rather than a guess: the hoist exists to keep a command the row cannot
 * otherwise fit, so a reason with no command in it has nothing to hoist and
 * bounding the whole composed line is then the honest answer. The three parts are
 * returned together because they are ONE cut — recomputing the boundary from the
 * clause's text would land on the wrong occurrence if the reason repeated it.
 */
function remedySplit(
	reason: string,
): { leading: string; clause: string; rest: string } | null {
	// The prefix is this function's business rather than the caller's: `leading`
	// is what the row re-wraps after its own `Reason: `, so a caller that passed
	// the line with the prefix still in it would paint it twice.
	const body = reason.startsWith(REASON_PREFIX)
		? reason.slice(REASON_PREFIX.length)
		: reason;
	const at = body.indexOf("/mcp");
	if (at < 0) return null;
	const from = body.slice(at);
	const end = from.search(REMEDY_CLAUSE_END);
	const clause = (end < 0 ? from : from.slice(0, end)).trim();
	if (!clause) return null;
	return {
		leading: body.slice(0, at).trim(),
		clause,
		rest: (end < 0 ? "" : from.slice(end)).trim(),
	};
}

/**
 * Split a harness statement into the fact and the instruction that follows it.
 *
 * A statement is two things in one string: what changed (`You are now running as
 * X (was Y).`) and what the MODEL is to do about it (`This applies from now on.
 * Capabilities, context window, and tone may differ from the previous model; act
 * as the model you now are.`). Measured over the store, all 231 model-switch rows
 * carry that tail, and painting it inline put a 3-4 line agent-directed block in
 * a one-line ledger, on a row with nothing to disclose. The rule is the same one
 * `incidentRow` applies to an incident's head: the fact is the row, the
 * instruction is what the disclosure is for.
 */
function splitStatement(
	text: string,
): Pick<Extract<TranscriptRecord, { kind: "custom" }>, "headline" | "detail"> {
	const trimmed = text.trim();
	const at = firstSentenceEnd(trimmed);
	if (at < 0) return { headline: trimmed, detail: null };
	const detail = trimmed.slice(at).trim();
	return { headline: trimmed.slice(0, at).trim(), detail: detail || null };
}

/**
 * The index just past the first sentence's terminator, or -1 when there is none.
 *
 * Two conditions beyond "a terminator followed by whitespace", both of which
 * exist because the bare rule split real text in half (round 2's R7):
 *
 * 1. the first non-space character AFTER the terminator must be a capital, so a
 *    mid-sentence abbreviation — `e.g. the fast tier`, `(approx. 200k ctx)` — is
 *    not read as a sentence end;
 * 2. a terminator that is preceded only by digits AND opens the text is a list
 *    marker (`1. You are now running as …`), not a sentence end.
 *
 * This is deliberately not a list of abbreviations, which would be a table to
 * keep in step with English forever. When nothing qualifies there is no split at
 * all: the row paints the whole text and discloses nothing, which is the safe
 * direction — nothing is hidden from the reader.
 *
 * The whitespace requirement is what keeps versions and filenames intact
 * (`deepseek-v4.1-flash`, `march.csv`), and it is why this is a scan rather than
 * a split on the character.
 */
function firstSentenceEnd(text: string): number {
	for (let i = 0; i < text.length - 1; i++) {
		if (!".!?…".includes(text[i])) continue;
		if (!WHITESPACE.test(text[i + 1])) continue;
		if (LEADING_ORDINAL.test(text.slice(0, i + 1))) continue;
		if (!CAPITAL.test(text.slice(i + 1).trimStart()[0] ?? "")) continue;
		return i + 1;
	}
	return -1;
}

/**
 * The three facts a `session_incident` row paints.
 *
 * The MESSAGE is `details.raw` rather than the head line's remainder, and the
 * two are deliberately not interchangeable: the producer truncates the head at
 * 500 characters (`incidents.Incident.render`) and keeps the untruncated
 * original in `raw` (bounded at 1000), so the head is a rendering of the error
 * and `raw` is the error. The head's remainder is the fallback for a row
 * persisted without one, which is why the head is parsed at all.
 *
 * The DISCLOSURE is everything after the head line: the harness's suggested
 * action and its "this is why the previous turn ended" tail. Both are addressed
 * to the model — they are the reason the incident exists — so the reader's
 * message is the vendor's own words and the harness's advice is one click away.
 * A `session_incident` with no tail (there is none today, but the classifier's
 * hint is optional) discloses nothing and paints as a static line.
 */
function incidentRow(
	text: string,
	details: Record<string, unknown>,
): Pick<
	Extract<TranscriptRecord, { kind: "custom" }>,
	"headline" | "detail" | "category" | "provider"
> {
	const lines = text.split("\n");
	const head = lines[0].match(INCIDENT_HEAD);
	const raw = typeof details.raw === "string" ? details.raw.trim() : "";
	const message =
		raw ||
		(head ? lines[0].slice(head[0].length) : lines[0]).trim() ||
		text.trim();
	const tail = lines.slice(1).join("\n").trim();
	return {
		// The head's parenthetical is the `provider/model` that died, and the
		// harness's own advice for a rate limit is "tell the user which provider
		// hit the limit" — so it is a fact the row has to carry. It rides the
		// `object` column rather than the message, which is the ledger's slot for
		// a machine-voice identifier (a path, a URL, a command) and keeps the
		// vendor's own error string intact as the sentence.
		provider: (head?.[1] ?? "").trim() || null,
		category: (head?.[2] ?? "").trim() || null,
		headline: message,
		detail: tail || null,
	};
}

/**
 * A relayed payload as a row: its headline, and the body behind the disclosure.
 *
 * `detail` is `null` when the headline IS the whole payload, because a disclosure
 * that repeats what the row already says promises material it does not add — the
 * same rule the notice register needed (round 2's U14), and the one 4 of the
 * store's job results at the 2026-09-14 scan — 39 then, 42 the next day — hit
 * once the colon join consumed their two-line body
 * (U16). The comparison is on the flattened text, so it holds whether the join
 * stitched lines together or the payload was one line to begin with.
 */
function relayRow(
	text: string,
): Pick<Extract<TranscriptRecord, { kind: "custom" }>, "headline" | "detail"> {
	const headline = headlineOf(text);
	const flat = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join(" ");
	return { headline, detail: flat === headline ? null : text };
}

/**
 * The line of a relayed payload that says something, bounded to a headline.
 *
 * Two kinds of line are not the message and are stepped over:
 *
 * 1. the envelope's own tags, opening or closing — `<parent-message>`, and the
 *    `</subagent-message>` an empty relay would otherwise paint;
 * 2. the channel's fixed instruction line (see `RELAY_INSTRUCTIONS`), which is
 *    byte-identical on 411 hub rows.
 *
 * The wake-arming clause was the third kind until round 7's R33. The strip was
 * scoped to a wake row, and what changed is the row rather than the rule: a
 * `wake_prompt` record is projected to its own `wake` kind before this path can
 * be reached (see the receipts branch in `durableRecord`), so nothing this
 * function edits is a wake's own words. Instrumented at both arms they took zero
 * hits across the suite and from real wake and peer payloads, and deleting them
 * left it green — which is why they are deleted rather than left looking live.
 *
 * When nothing survives, the ENVELOPE itself is the honest headline: a relay
 * with an empty body still names its label and job id
 * (`<subagent-message label='rollover-template-fix' job='5fb25794e06c'>`), which
 * is strictly better than a stray closing token.
 *
 * One further shape left the row stating a LABEL rather than the message it
 * exists to state (round 2's U10, measured): a chosen line that ENDS in a colon
 * is a heading with its outcome on the next line — `background job 'design849'
 * failed:` / `[Errno 28] No space left on device` — so the two are joined, which
 * was 37 of the store's 39 job results at the 2026-09-14 scan (the population
 * grows as the operator works; it was 42 the next day).
 *
 * The two wake shapes that sat beside it (round 2's U10, then D8/U15) are
 * DELETED rather than disabled, and the suite is the proof: instrumented at both
 * sites they took 0 hits over 110 tests and 0 from five real wake shapes fed
 * through both the durable and the live path, while the relay control hit. A
 * `wake_prompt` payload is claimed by the receipts branch in `durableRecord`
 * before `customRow` — this function's only caller — is reached, so a wake row
 * has no custom-row headline at all and rules about one could never fire. Upstream
 * owns the row a wake now paints (`receipt-row-model`, pinned by
 * `scripts/tool-row.test.mjs`).
 *
 * `customType` went with them: every arm that read it was wake-only, so the
 * parameter would be configuration nothing consults. Adding the parameter back
 * is the signal that a caller has a per-type rule again.
 */
function headlineOf(text: string): string {
	const lines = text
		.split("\n")
		.map((candidate) => candidate.trim())
		.filter(Boolean);
	/** Whether a line is the payload's own words rather than the channel's. */
	const speaks = (line: string) =>
		!ENVELOPE_TAG.test(line) && !isRelayInstruction(line);
	const substantive = lines.find(speaks);
	const opening = lines.find(
		(line) => ENVELOPE_TAG.test(line) && !line.startsWith("</"),
	);
	let chosen = substantive ?? opening ?? text.trim();

	const at = lines.indexOf(chosen);
	if (at >= 0 && chosen.endsWith(":")) {
		const outcome = lines.slice(at + 1).find(speaks);
		if (outcome) chosen = `${chosen} ${outcome}`;
	}

	return bounded(chosen);
}

/** Whether a line is one of the channel's fixed instruction lines. */
function isRelayInstruction(line: string): boolean {
	return RELAY_INSTRUCTIONS.has(line.replace(/\s+/g, " ").trim().toLowerCase());
}

/** Cut a headline to its bound, on a word boundary so it reads as one. */
function bounded(headline: string): string {
	const trimmed = headline.trim();
	if (trimmed.length <= HEADLINE_MAX) return trimmed;
	const cut = trimmed.slice(0, HEADLINE_MAX);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The key the harness stamps on a user row it minted itself.
 *
 * IT IS THE PYTHON SIDE'S CONSTANT, SPELLED HERE BECAUSE THE RENDERER CANNOT IMPORT
 * PYTHON: `RENDERED_INJECTION_KEY` in `local_operator/compaction/cutpoint.py` (the
 * stamp is written at mint in `harness/render.py`). The marker is STRUCTURAL — a
 * field on the row's own payload — and that is why it is the PRIMARY read: it
 * cannot drift with a producer's wording, and its strict `=== true` fails safe.
 * It is not the whole contract on its own: rows written before it existed carry
 * nothing to read, and `harness-chrome.ts` mirrors core's own recogniser for the
 * goal families those rows belong to, applied only after this marker says no.
 */
const HARNESS_INJECTION_KEY = "harness_injected";

/**
 * Whether the harness minted this row, i.e. nobody typed it.
 *
 * A user row carrying the stamp is the harness's own chrome — a loop prompt, a goal
 * continuation — and the marker's own docblock on the Python side says what that
 * means for a surface: *"a row carrying it was never typed by a person, so no
 * human-facing surface may paint it as their words."* This reducer is where the
 * desktop delivers on that, for BOTH of its wire paths, because the alternative is
 * the loop's internal prompt appearing in the transcript as the user's own message.
 *
 * STRICT `=== true`, AND THE ASYMMETRY IS DELIBERATE: the producer writes a JSON
 * boolean, so anything else — an absent field, a field a newer writer renamed, a
 * string — is read as NOT injected and the row paints as it always did. Hiding a
 * row a person really typed is a worse failure than showing one they did not, and
 * this is the one direction of the test that fails safe.
 */
const isHarnessInjected = (payload: unknown): boolean => {
	if (!payload || typeof payload !== "object") return false;
	return (payload as Record<string, unknown>)[HARNESS_INJECTION_KEY] === true;
};

/**
 * Whether this session's owner runs the queued-ask engine — the mode every
 * ask-gate settle-only seam keys on (design `docs/design/ask-gate.md` §3).
 *
 * THE DESKTOP'S READ OF THE CAPABILITY PROXY, reading the presence of `asks`
 * OR `asks_open` on the frontend state:
 *
 * - a core that predates the R1 fix publishes `asks` only while the queue holds
 *   at least one row and never publishes `asks_open`; presence means "engine
 *   live, at least one outstanding ask", so an empty queue reads false and a
 *   divert's running row shows for the gate — the residual the design's §5
 *   records, on OLD CORES only;
 * - a core at the fix publishes `asks_open` (value ≥ 0, 0 included) whenever
 *   the queued engine is live, `asks` staying absent-on-empty so clients that
 *   read that field alone are untouched; presence of either field then IS the
 *   capability, and the first-ask case — a gate running on an empty queue —
 *   reads true.
 *
 * The core's own `queued_ask_engine_live` viewer arm reads the same two fields
 * for the same reason (one function, one answer on both arms; the R1 exchange
 * is in this PR's thread). Absence of BOTH is "cannot say" — a core that
 * predates the fields, or a frame whose byte bound dropped the last field —
 * and every caller keeps today's mount for it, with the settle marker still
 * dropping a divert. Never read absence as "the engine is off".
 *
 * Spelled against the fields directly rather than through `sessionAsks`
 * (`ask-queue.ts`): that module carries the desktop API surface, and this one
 * bundles standalone in `scripts/transcript-reducer.test.mjs`. `asks_open` is
 * deliberately NOT read for its count — presence is the whole fact here, and a
 * zero is as capable as a three.
 */
export function queuedAskEngineLive(
	frontend: CanonicalFrontendState | null | undefined,
): boolean {
	return (
		frontend != null && (frontend.asks != null || frontend.asks_open != null)
	);
}

/**
 * Whether a tool result's `details` mapping carries the ask gate's divert
 * marker (design §3; the core's `is_ask_gate_divert_details`).
 *
 * A diverted ask's result carries
 * `{"ask_gate": {"hidden": true, "verdict": …, "reason": …}}`, riding the
 * live `tool_execution_end` result's `details` and the durable row's
 * `payload.provider_payload.details` with one meaning: this call/result pair
 * never happened for the user. The read is deliberately TOTAL and narrow — a
 * missing, renamed or malformed marker is `false`, and a core that predates
 * the gate (which never writes one) paints exactly as it does today.
 */
function isAskGateDivertDetails(details: unknown): boolean {
	if (!details || typeof details !== "object") return false;
	const gate = (details as Record<string, unknown>).ask_gate;
	if (!gate || typeof gate !== "object") return false;
	return Boolean((gate as Record<string, unknown>).hidden);
}

/**
 * The `ask` tool's name, spelled once — a copy of the core's `_ASK_TOOL_NAME`
 * for the same reason that module copies it: only ever compared, so a rename
 * upstream shows up as a predicate that stops matching rather than as a pass.
 */
const ASK_TOOL_NAME = "ask";

/**
 * Whether a call's rows are SETTLE-ONLY on this surface (design §3 rows 2/6).
 *
 * While the queued engine is live an `ask` call gets NO live row while it is
 * being dictated or running: the forked clearance check may divert it, and the
 * design rejects a row that flashed for the gate's whole duration on every
 * surface. Its one row is created at SETTLE — the receipt for a raise, nothing
 * for a divert (the marker is read there). `queuedEngine` is the caller's mode
 * read; `false`/absent keeps today's mount, and the settle-marker drop still
 * covers that path. A never-run verdict (`not_run_reason`) is exempt at the
 * call sites: it is a TERMINAL settle of a call that never ran — no gate ran,
 * a divert is impossible — and it renders exactly as today.
 */
function isSettleOnlyAsk(
	toolName: unknown,
	queuedEngine: boolean | undefined,
): boolean {
	return queuedEngine === true && String(toolName ?? "") === ASK_TOOL_NAME;
}

function durableRecord(
	entry: DesktopHistoryPage["entries"][number],
	/**
	 * The record already painted for this id, if any. It carries TWO facts, and
	 * neither is optional:
	 *
	 * - an unchanged `images` array keeps its REFERENCE across a re-read of the
	 *   same history page — `shallowEqual` compares by `!==`, so a freshly built
	 *   array would report every replayed row as changed and re-render it;
	 * - a compaction row keeps the SENTENCE it already carries, which is the live
	 *   line the pairing moved onto it. The durable entry has no sentence of its
	 *   own to replace it with, and recomputing one would strip the figures on the
	 *   very next read — that is what makes `collapseSettledCompactions`
	 *   idempotent.
	 */
	previous?: TranscriptRecord,
): TranscriptRecord | null {
	const payload = entry.payload ?? {};
	const ts = Math.round((entry.ts ?? 0) * 1000);
	if (entry.type === "compaction") {
		/*
		 * The sentence a row already carries is KEPT. The entry has no sentence of
		 * its own — only counts — so there is nothing here for it to disagree with,
		 * and recomputing one would strip the figures the pairing put there on the
		 * very next read (review round 3, R3-1: the second application of a page was
		 * enough). This is the fact that makes `collapseSettledCompactions`
		 * idempotent, and it is stated where the recomputation would otherwise live.
		 */
		const kept =
			previous?.kind === "compaction" ? previous.text : COMPACTED_LINE;
		// The entry's own figure, which is the pass's fingerprint: `append_compaction`
		// writes `tokens_before` and no after-figure, and that one number is what lets
		// this row be paired with its live line by identity rather than by clock.
		const before = payload.tokens_before;
		return {
			kind: "compaction",
			id: entry.id,
			ts,
			text: kept,
			...(typeof before === "number" ? { before } : {}),
		};
	}
	/*
	 * The refusal's own durable row, painted rather than dropped: see
	 * `compactionOutcome` for why it is the only surface this pass has.
	 */
	if (
		entry.type === "message" &&
		payload.custom_type === "compaction_refused"
	) {
		const details = (payload.details ?? {}) as Record<string, unknown>;
		const outcome = compactionOutcome(String(details.detail ?? ""));
		return {
			kind: "notice",
			id: entry.id,
			ts,
			text: outcome.text,
			level: outcome.level,
		};
	}
	if (
		entry.type === "custom" &&
		payload.custom_type === "completion_attention"
	) {
		const details = (payload.details ?? {}) as Record<string, unknown>;
		if (typeof details.anchor === "string") {
			if (details.kind === "closed") {
				// THE NEUTRAL CLOSURE (v2, 2026-09-29): the disposal caught a run
				// that spent no provider round-trip, so the record is a receipt —
				// info ink, never danger. It keeps `complete: true` so the
				// working-line ladder retires the wait the same way an incident
				// does: a runtime that has been disposed is not still working.
				return {
					kind: "notice",
					id: details.anchor,
					ts,
					complete: true,
					text: CLOSED_OUTCOME_TEXT,
					level: "info",
				};
			}
			if (details.kind === "retired") {
				// THE RETIRE-FOR-BUILD ROW (2026-09-29): a cut for an update is
				// warning, never danger, and it keeps `complete: true` for the
				// closure's own reason above — the runtime is quitting, so the
				// working-line wait must retire beside the row.
				return {
					kind: "notice",
					id: details.anchor,
					ts,
					complete: true,
					text: RETIRED_OUTCOME_TEXT,
					level: "warning",
				};
			}
			if (details.kind === "error" || details.kind === "interrupted") {
				// Preserve the marker's durable position. Appending an old failure at
				// the current retry tail would misrepresent which outcome was viewed.
				return {
					kind: "notice",
					id: details.anchor,
					ts,
					complete: true,
					text:
						details.kind === "error" ? "Stopped with an error" : "Interrupted",
					level: details.kind === "error" ? "error" : "warning",
				};
			}
		}
	}
	if (entry.type !== "message") return null;
	const kind = String(payload.kind ?? "message");
	if (kind === "custom") {
		const customType = String(payload.custom_type ?? "");
		if (SILENT_CUSTOM_TYPES.has(customType)) return null;
		const details = (payload.details ?? {}) as Record<string, unknown>;
		// The receipts come before the generic branch, which would paint
		// `details.text` — the model-facing envelope for both of them.
		//
		// A peer row is projected from `details.body` + `details.sender`, the two
		// fields the UIs are supposed to render (the phone's fold does exactly
		// that). The envelope is parsed rather than required, because a row from an
		// older producer may carry only it; either way no envelope reaches the
		// view.
		if (customType === PEER_MESSAGE_CUSTOM_TYPE) {
			const { body, sender } = peerFields(details);
			return {
				kind: "peer",
				id: entry.id,
				ts,
				body,
				// Reused by reference when a replayed page teaches nothing new, or
				// `shallowEqual` reports this row as changed on every re-read (the same
				// bargain `extractImages` strikes for `images`).
				sender:
					previous?.kind === "peer" && sameSender(previous.sender, sender)
						? previous.sender
						: sender,
			};
		}
		// A wake receipt is the delivery verbatim; the headline and the prompt are
		// derived at paint time. The CATCH-UP is not a receipt — see
		// `wakeIsCatchup` for the two surfaces that skip it and why.
		if (customType === WAKE_PROMPT_CUSTOM_TYPE) {
			if (wakeIsCatchup(details)) return null;
			const text = String(details.text ?? "");
			if (!text.trim()) return null;
			return { kind: "wake", id: entry.id, ts, text };
		}
		if (customType === ASK_RESPONSE_CUSTOM_TYPE) {
			/*
			 * The structured half is what a person needs; `details.text` is the
			 * model-facing report (`response_text`) and is deliberately NOT painted.
			 *
			 * `answers` is rebuilt defensively rather than cast: it arrives from the
			 * transcript store, and a row that trusted its shape would throw on the
			 * whole pane for one malformed line (the reducer's standing rule for
			 * every untyped wire field).
			 */
			const rawAnswers = details.answers;
			const answers: Record<string, string[]> = {};
			if (rawAnswers && typeof rawAnswers === "object")
				for (const [key, values] of Object.entries(
					rawAnswers as Record<string, unknown>,
				))
					answers[String(key)] = Array.isArray(values)
						? values.map((value) => String(value))
						: [];
			const rawQuestions = details.questions;
			const questions = Array.isArray(rawQuestions)
				? rawQuestions.flatMap((entry) => {
						if (!entry || typeof entry !== "object") return [];
						const question = entry as Record<string, unknown>;
						return [
							{
								id: String(question.id ?? ""),
								question: String(question.question ?? ""),
								secret: question.secret === true,
							},
						];
					})
				: [];
			return {
				kind: "ask_response",
				id: entry.id,
				ts,
				askId: String(details.ask_id ?? ""),
				status: String(details.status ?? "answered"),
				questions,
				answers,
				secretLost: details.secret_lost === true,
			};
		}
		if (customType === ASK_TIMEOUT_CUSTOM_TYPE) {
			const waited = Number(details.waited_s);
			return {
				kind: "ask_timeout",
				id: entry.id,
				ts,
				askId: String(details.ask_id ?? ""),
				// A non-finite wait is reported as zero, which `askWaitedText` prints
				// as "a while" rather than rounding up to an hour the row cannot
				// substantiate - the whole reason that helper refuses to guess.
				waitedS: Number.isFinite(waited) && waited > 0 ? waited : 0,
				urgent: details.urgent === true,
			};
		}
		const text = String(details.text ?? details.detail ?? "");
		// A row with nothing to say paints nothing. `trim()` rather than a falsy
		// test, because a whitespace-only body would otherwise reach `headlineOf`
		// and produce an empty headline — which is the shape the operator reported
		// (a row that states nothing but its type name). No producer emits one
		// today; the gate is here so none can.
		if (!text.trim()) return null;
		return {
			kind: "custom",
			id: entry.id,
			ts,
			customType,
			text,
			attribution:
				(payload.attribution as "user" | "agent" | "system") ?? "system",
			...customRow(customType, text, details),
		};
	}
	const role = String(payload.role ?? "");
	if (role === "user") {
		/*
		 * A row the harness minted is dropped, not restyled.
		 *
		 * The durable path needs its own check even though the live path has one:
		 * they are different branches over different payload shapes, and a session
		 * opened fresh (or reconciled after a reattach) reads its turns back from
		 * these rows. Suppressing only the live one would leave the harness's prompt
		 * in the transcript of every session that was reloaded — the every-reopen
		 * case the marker exists for.
		 */
		if (isHarnessInjected(payload.provider_payload)) return null;
		const text = messageText(payload);
		/*
		 * THE LEGACY FALLBACK: a row written before the marker existed, or sent by
		 * an owner on an older build, carries no stamp to read — the operator's own
		 * stored transcript (2026-09-29) still held ten goal-continuation rows that
		 * painted as the user's own words. Core keeps its recogniser for exactly
		 * these rows and names it beside the marker (`docs/DESKTOP_API.md`); the
		 * check is `harness-chrome.ts`, which mirrors its goal legs. It runs only
		 * after the marker read above said no, so the structural stamp stays the
		 * primary one.
		 */
		if (isHarnessChromeText(text)) return null;
		// Harness-authored user rows (recovery notices, wake prompts) are
		// machine voice: they render as notices rather than as the person.
		if (text.startsWith("Harness recovery notice:")) {
			return { kind: "notice", id: entry.id, ts, text, level: "warning" };
		}
		return {
			kind: "user",
			id: entry.id,
			ts,
			text,
			images: extractImages(
				payload,
				entry.id,
				previous?.kind === "user" ? previous.images : undefined,
			),
		};
	}
	if (role === "assistant") {
		const toolCalls = Array.isArray(payload.tool_calls)
			? (payload.tool_calls as Record<string, unknown>[])
			: [];
		const text = messageText(payload);
		// An assistant row that only carried tool calls has no prose to show;
		// its tool rows are painted from the paired `tool` results. It still
		// occupies its id so a live echo of it coalesces instead of duplicating.
		if (!text && toolCalls.length > 0) {
			return {
				kind: "assistant",
				id: entry.id,
				ts,
				text: "",
				streaming: false,
				stopReason: String(payload.stop_reason ?? "toolUse"),
				error: false,
			};
		}
		return {
			kind: "assistant",
			id: entry.id,
			ts,
			text,
			complete: true,
			streaming: false,
			stopReason: (payload.stop_reason as string | null) ?? null,
			error: Boolean(payload.is_error),
		};
	}
	if (role === "tool") {
		const toolCallId = String(payload.tool_call_id ?? entry.id);
		const providerPayload = (payload.provider_payload ?? {}) as Record<
			string,
			unknown
		>;
		const details = (providerPayload.details ?? {}) as Record<string, unknown>;
		/*
		 * THE DIVERT DROP, DURABLE HALF (design §3 rows 6/7). A diverted ask's
		 * result row carries the hidden marker in `provider_payload.details`; the
		 * row never paints on any surface this fold feeds. THE CHILD TRAJECTORY IS
		 * WHY THIS HALF IS THE CLIENT'S: a subagent's pages are served VERBATIM by
		 * design ("fold them through the same reducer"), so the child reader's
		 * `applyHistoryPage` is the only filter a divert there will ever meet.
		 * Marker-only, per the core's own predicates: no marker, no change — and a
		 * core that predates the gate never writes one, so its rows paint exactly
		 * as they do today.
		 */
		if (isAskGateDivertDetails(details)) return null;
		/*
		 * WHETHER THE RUNTIME SAYS THE CALL WAS ABORTED RATHER THAN FAILED.
		 *
		 * The comment this variable replaces said an interrupt was "a live-only fact
		 * the transcript does not encode separately from `is_error`" - and the second
		 * half of that is not true. `details.__fault` is the runtime's own fault
		 * CLASSIFIER (`harness/types.py`'s `FAULT_KEY`; the vocabulary includes
		 * `aborted` beside `execution`, `denied` and the model faults), written at the
		 * source through `ToolResult.details` and never text-matched afterwards, and
		 * it survives into the stored message's `provider_payload` - measured on this
		 * branch's own rig session, where an Esc-killed call's durable entry reads
		 * `{"__fault": "aborted", "__synthetic": true}` (UX round 2, U15).
		 *
		 * WHY THE DURABLE ROW HAS TO READ IT. Durable rows win over the live record
		 * with the same id, so without this the reconcile this app performs after a
		 * turn REWRITES the classification the live event just made: a killed call's
		 * row painted `stopped` by the end event flipped back to `failed` in danger
		 * ink the moment the page landed (measured in the rig's own reading, and
		 * pinned by `transcript-reducer.test.mjs`'s composed-sequence case).
		 *
		 * THE TWO INTERRUPTED KINDS, and only as the ladder's "no verdict" state:
		 * `skipped` (steering redirected before the call ran) joins `aborted` (the user
		 * stopped the turn), because both name an interrupt rather than a failure -
		 * the same reading the live end event takes from the same marker, so a
		 * reloaded transcript and a live one cannot describe the one call two ways.
		 * `denied` and `gate_failed` keep their own treatment, and a genuine
		 * `execution` fault keeps the danger ink.
		 */
		const interrupted = isInterruptedFault(details.__fault);
		return {
			kind: "tool",
			// Tool records key by call id: the live start/end events for the same
			// call carry no transcript entry id, and the durable row must replace
			// the live one rather than stand beside it.
			id: `tool:${toolCallId}`,
			ts,
			toolCallId,
			toolName: String(payload.tool_name ?? ""),
			intent: null,
			args: null,
			phase: "done",
			argumentBytes: 0,
			// A row read back from the durable transcript is a call the harness
			// recorded a result for: whatever live verdict it may have carried, the
			// transcript's own account of the call wins - the kind with the reason.
			notRunReason: null,
			notRunKind: null,
			neverSent: false,
			output: messageText(payload) || null,
			/*
			 * An interrupted call did not fail, so the danger ink the raw flag would paint
			 * is cleared HERE rather than at the row's paint, for the same reason the
			 * live end event clears it: the row's `isError` is the wire's claim about
			 * how the call ended, and the runtime has already said the end was an
			 * interrupt.
			 */
			isError: interrupted ? false : Boolean(payload.is_error),
			durationS:
				typeof providerPayload.duration_s === "number"
					? providerPayload.duration_s
					: null,
			// A durable row is settled by definition: it reports the duration the
			// backend measured, never a clock of its own.
			startedAt: null,
			// And no completion stamp either: the durable tool payload carries
			// `duration_s` and no times (harness `types.py`'s tool-entry
			// provider_payload), so history rows genuinely cannot date a span.
			endedAt: null,
			// Durable tool rows carry image blocks in `content` exactly as user rows
			// do — confirmed against real transcripts: 6398 tool-role blocks with
			// keys `(attachment, mime_type)`. This is the reload half of a browser
			// screenshot; the live half arrives on `tool_execution_end`.
			images: extractImages(
				payload,
				`tool:${toolCallId}`,
				previous?.kind === "tool" ? previous.images : undefined,
			),
			// Counts and body share one guard (`preferDiffCounts`): a page row with
			// no `details` keeps what the row already showed rather than zeroing it.
			...preferDiffCounts(
				providerPayload.details,
				previous?.kind === "tool" ? previous : null,
			),
			// The durable half of the diff body, and the same identity rule the
			// images beside it follow: a replayed page that carries no `details`
			// must not blank a row the live event already filled in (the live
			// event budget drops `details` from the frame when the row exceeds its
			// share — `_bound_live_result_in_place` in frontend_state.py).
			diff: preferDiff(
				diffFromDetails(providerPayload.details),
				previous?.kind === "tool" ? previous.diff : null,
			),
			// A durable row is the authoritative record of how the call ended - and
			// when the runtime's own classifier says the end was an INTERRUPT
			// (`skipped`/`aborted`), "ended" is not "failed": the row wears the
			// ladder's no-verdict state the live end event gives the same call above
			// (`interrupted`'s note), so a reconcile cannot re-accuse a call the user
			// stopped or a steering redirect dropped. Every other end keeps `false`
			// here.
			stopped: interrupted,
			// Replay parity: the durable row carries the same `details.delivery` the
			// live end event did, so a reloaded transcript paints the state the live
			// one painted. A page row with no `details` keeps what the row held.
			delivery: preferDeliveryState(
				providerPayload.details,
				previous?.kind === "tool" ? previous.delivery : null,
			),
		};
	}
	return null;
}

/**
 * Merge a durable history page. Durable rows win over any live record with
 * the same id; the page's own order is preserved and it is placed by
 * timestamp relative to what is already painted (older pages prepend).
 */
/*
 * The cursor to re-anchor to after a page came back `cursor_missing`, or null
 * when the page needs no re-anchor.
 *
 * The backend's documented reconcile (`read_transcript_page`): a `before_id`
 * the journal cannot locate — a `/compact` replaced the file under a loaded
 * conversation — is answered with THE CURRENT TAIL plus `cursor_missing`, "so a
 * reader can dedupe by stable ID instead of getting stuck on a stale cursor".
 * The load path must then MOVE: the tail it received is already loaded, so a
 * reader that keeps the stale id asks forever for a row that is gone and the
 * affordance loads nothing, silently (operator report, 2026-09-28). The row to
 * anchor at is the page's own OLDEST — a row this journal just served, so the
 * next request can locate it and page genuinely below it. Null means "ask
 * again from where you already are", and equals-anchor guards the degenerate
 * case where re-anchoring would repeat the same request.
 */
export function reanchorAfterCursorMiss(
	page: Pick<DesktopHistoryPage, "cursor_missing" | "entries">,
	anchor: string,
): string | null {
	if (!page.cursor_missing || page.entries.length === 0) return null;
	const oldest = page.entries[0]?.id;
	if (typeof oldest !== "string" || oldest === anchor) return null;
	return oldest;
}

/** Ids the app mints itself; none of them names a journal entry. */
const NON_ENTRY_ID = /^(?:tool|compaction|local):/;

/**
 * The deepest cursor this reader still holds that the journal can serve, or null
 * when it holds none.
 *
 * WHY THE TAIL'S OWN FIRST ENTRY IS NOT ENOUGH (`reanchorAfterCursorMiss`,
 * #634). A `/compact` rewrites the journal and answers a `before_id` it can no
 * longer find with THE CURRENT TAIL. Re-anchoring to that tail's first entry
 * sends a reader who is N pages deep back to the page before the tail - a page
 * they already hold - and every click walks one already-held page forward: the
 * same stall by another door (reproduced against a real journal: `compact_file`
 * dropped 5 of its 12 page-boundary cursors). `compact_file` never removes a
 * MESSAGE entry ("entry ids, order and types are unchanged"), so the oldest
 * message-like record the reader holds is still a valid `before_id` after the
 * rewrite, and the page below it is exactly the one they have not seen.
 *
 * WHICH RECORD IDS ARE JOURNAL ENTRY IDS - the constraint that makes this a
 * function and not a `records[0]`. `user`, `assistant`, `custom`, `peer`, `wake`,
 * `compaction` and the two ask RECEIPTS (`ask_response`/`ask_timeout`) records are
 * keyed by their entry id - the receipts were missing from this list, so an
 * anchoring pass that landed on one skipped past it to a younger row (agent review
 * round 1, NIT-3). A `tool` record is
 * `tool:<toolCallId>`, a completion-marker `notice` is keyed by
 * `details.anchor`, a live compaction line is `compaction:<generation>:...`, and
 * the app's own echoes are `local:...`: none of those is an entry id, and asking
 * the backend for one only produces another `cursor_missing`.
 */
export function reanchorCandidate(
	state: Pick<TranscriptState, "records">,
): string | null {
	for (const record of state.records) {
		switch (record.kind) {
			case "user":
			case "assistant":
			case "custom":
			case "peer":
			case "wake":
			case "compaction":
			// The ask receipts are JOURNAL entries like the six above: both are keyed
			// by their own entry id, so both may anchor a page.
			case "ask_response":
			case "ask_timeout":
				break;
			default:
				continue;
		}
		if (record.kind === "user" && record.local) continue;
		if (NON_ENTRY_ID.test(record.id)) continue;
		return record.id;
	}
	return null;
}

/**
 * The load-earlier request's next move, given the page it got back.
 *
 * ONE decision point, because the two halves of it are the two ways this can
 * end: a `cursor_missing` answer is re-anchored ONCE (see
 * `reanchorAfterCursorMiss`), and a page that is STILL `cursor_missing` on the
 * retry is the honest dead end — the journal cannot serve that depth from
 * either cursor, applying the tail would report a click that loaded nothing as
 * success, and asking a third time would loop. `failed: true` is what drives
 * the slot's own failed state (agent review round 1, F1: the retry's failure
 * was unreachable — the retried page was applied and the call resolved true,
 * so a silent no-op click survived in that corner).
 *
 * `alreadyRetried` is the caller's own fact rather than derivable here: the
 * SAME miss state is a retryable answer the first time and a failure the
 * second, and only the caller knows which request it is holding.
 */
export function loadOlderStep(
	page: Pick<DesktopHistoryPage, "cursor_missing" | "entries">,
	anchor: string,
	alreadyRetried: boolean,
): { cursor: string | null; failed: boolean } {
	if (!page.cursor_missing) return { cursor: null, failed: false };
	const reanchored = reanchorAfterCursorMiss(page, anchor);
	if (!alreadyRetried && reanchored !== null) {
		return { cursor: reanchored, failed: false };
	}
	return { cursor: null, failed: true };
}

export function applyHistoryPage(
	state: TranscriptState,
	page: DesktopHistoryPage,
	options: {
		replace?: boolean;
		keepPaging?: boolean;
		/**
		 * The caller's ASSERTION that this page was fetched with
		 * `before_id = pagedBefore`, i.e. it is a CONTINUATION of the reader's
		 * walk backwards and not a tail-type read (snapshot, reconcile, refresh).
		 * Only the caller knows which it is holding - the page itself carries no
		 * cursor - and the answer decides who owns the cursor (see the cursor
		 * rules below). Absent means "a tail-type read".
		 */
		pagedBefore?: string;
	} = {},
): TranscriptState {
	/*
	 * A view the user has CLEARED is answered with THE PASS THE READ EXISTS FOR,
	 * and with nothing else. Three facts make that test exact, and each was a defect
	 * on its own:
	 *
	 * - `/clear` is view-only by contract, so a page read afterwards repaints every
	 *   row it removed (`/compact`, `/clear`, `/compact` put the conversation back —
	 *   UX round 4's U17);
	 * - the test is the EPOCH, not "is the view empty": the first read painting the
	 *   pass's own row made the view non-empty, so the second scheduled read landed
	 *   whole (round 5's R5-2/U20, bracketed in the backend's request log);
	 * - and the row set is scoped by the read's OWN instant, because "outcome rows"
	 *   includes the pre-clear passes' rows, which is what put a bare
	 *   `Context compacted` per old pass back under the new one (round 6's Q14).
	 *
	 * `keepPaging` is set by exactly one caller (the tail read), the epoch and the
	 * clear instant are written by exactly one function (`clearTranscript`), and the
	 * instant is the boundary the rule needs rather than the read's own receipt
	 * (which a fast refusal can precede — see `clearedAt`). A read that is not the
	 * tail read still repaints, which is parity with `origin/main` and deliberately
	 * unchanged.
	 */
	const clearedView = options.keepPaging === true && state.viewEpoch > 0;
	const incoming: TranscriptRecord[] = [];
	for (const entry of page.entries) {
		if (clearedView && !isCompactionOutcome(entry, state.clearedAt)) continue;
		// A tool row keys by call id, not entry id, so the prior record is looked
		// up under both. Handing it to `durableRecord` is what lets an unchanged
		// `images` array keep its reference through a replayed page.
		const previous =
			state.records[state.index.get(entry.id) ?? -1] ??
			state.records[
				state.index.get(`tool:${String(entry.payload?.tool_call_id ?? "")}`) ??
					-1
			];
		const record = durableRecord(entry, previous);
		if (record) incoming.push(freezeRecordDeep(record));
	}
	// Tool call args live on the assistant row's `tool_calls`; carry the intent
	// and args onto the tool record. The map spans the SESSION, not this page —
	// see `TranscriptState.argsByCall` for the two ways a call and its arguments
	// end up on different pages.
	let argsByCall = state.argsByCall;
	let argsChanged = false;
	for (const entry of page.entries) {
		const calls = entry.payload?.tool_calls;
		if (!Array.isArray(calls)) continue;
		// The assistant row's own instant. The call it names was composed in THAT
		// message, so this is the durable anchor a replayed settling frame for the
		// call is placed at (`seededClock`) — read here because this loop is the
		// only place the row and its calls are both in hand.
		const anchoredAt = Math.round((entry.ts ?? 0) * 1000);
		for (const call of calls as Record<string, unknown>[]) {
			if (!call || typeof call.id !== "string") continue;
			if (argsByCall.has(call.id)) continue;
			// Copy-on-write: the common replayed page teaches nothing new, and
			// rebuilding the map anyway would hand the identity gate a fresh object
			// on every poll.
			if (!argsChanged) {
				argsByCall = new Map(argsByCall);
				argsChanged = true;
			}
			argsByCall.set(call.id, { ...call, anchoredAt });
		}
	}
	for (let i = 0; i < incoming.length; i++) {
		const record = incoming[i];
		if (record.kind !== "tool") continue;
		const call = argsByCall.get(record.toolCallId);
		if (!call) continue;
		const args = (call.arguments ?? null) as Record<string, unknown> | null;
		incoming[i] = freezeRecordDeep({
			...record,
			args,
			intent: typeof args?.i === "string" ? args.i : null,
		});
	}
	// A page that taught us new arguments can complete rows painted EARLIER —
	// the reconnect case, where the row settled before its arguments arrived.
	// Only rows still missing args are touched, so an unchanged row keeps its
	// object identity and the row memo holds.
	const backfilled: TranscriptRecord[] = argsChanged
		? state.records.map((record) => {
				if (record.kind !== "tool" || record.args) return record;
				const call = argsByCall.get(record.toolCallId);
				const args = (call?.arguments ?? null) as Record<
					string,
					unknown
				> | null;
				if (!args) return record;
				return freezeRecordDeep({
					...record,
					args,
					intent: record.intent ?? (typeof args.i === "string" ? args.i : null),
				});
			})
		: state.records;

	const base = options.replace
		? EMPTY_TRANSCRIPT
		: { ...state, records: backfilled };
	const byId = new Map(base.records.map((record) => [record.id, record]));
	let changed =
		options.replace || (!options.replace && backfilled !== state.records);
	for (const record of incoming) {
		const current = byId.get(record.id);
		if (!current) {
			changed = true;
			byId.set(record.id, record);
			continue;
		}
		// Durable rows are authoritative over live projections of the same
		// message, but a durable tool row lacks the args the live start
		// carried, so keep those.
		if (current.kind === "tool" && record.kind === "tool") {
			const merged: TranscriptRecord = freezeRecordDeep({
				...record,
				args: record.args ?? current.args,
				intent: record.intent ?? current.intent,
				// A durable row has DIGESTS, a live row has BYTES, and the bytes are
				// already decoded in this renderer. Preferring the live array spares
				// the row the user is looking at a needless round trip to the
				// attachment endpoint at the exact moment the turn settles.
				images: current.images.length ? current.images : record.images,
			});
			if (!shallowEqual(current, merged)) {
				changed = true;
				byId.set(record.id, merged);
			}
			continue;
		}
		if (!shallowEqual(current, record)) {
			changed = true;
			byId.set(record.id, record);
		}
	}
	/*
	 * Whether this page carries the pass's OWN outcome — the row that says how
	 * THIS pass ended. Three conjuncts, and the middle one is the round-2 fix:
	 *
	 * - the entry is a compaction outcome at all (the pass's durable row, or the
	 *   refusal that corrects an optimistic receipt);
	 * - it is NOT OLDER than the standing claim (`compactingSince`), which is what
	 *   separates the pass being watched from a previous pass's row arriving on a
	 *   page this reader had never loaded. "Not yet painted" alone retired a live
	 *   pass from any `load older` merge, from the mentioned-files scanner's
	 *   paging, and from a first history read that landed after a live start
	 *   (NEW-1) — and the cost was both surfaces of the change going quiet
	 *   mid-pass;
	 * - it is not already painted, so a refresh replaying the same outcome is not
	 *   a second event.
	 */
	const retiresPass =
		state.compacting &&
		page.entries.some((entry) => {
			if (state.index.has(entry.id)) return false;
			if (Math.round((entry.ts ?? 0) * 1000) < state.compactingSince)
				return false;
			return (
				entry.type === "compaction" ||
				(entry.type === "message" &&
					entry.payload?.custom_type === "compaction_refused")
			);
		});
	/*
	 * THE PAGING CURSOR, decided BEFORE the no-change early return because moving
	 * it is itself a change.
	 *
	 * `first` is the page's oldest entry - the value the next "load earlier"
	 * asks from (`before_id` is exclusive). It is a JOURNAL ENTRY, not
	 * necessarily a record: a silent custom, or a tool result keyed
	 * `tool:<callId>`, is a perfectly good cursor and no record at all, so
	 * nothing here may look the cursor up among the records (that lookup is the
	 * defect this replaces - see `TranscriptState.oldestTs`).
	 *
	 * The rules, in order, keyed on what KIND of read the page was:
	 *  1. `keepPaging`: never move either (the caller's contract; it is checked
	 *     first, as it always was, and wins over everything below).
	 *  2. `replace`, or no cursor yet: the page defines the cursor and `hasMore`.
	 *  3. A CONTINUATION (`pagedBefore`) moves the cursor to `first`
	 *     UNCONDITIONALLY, even when no record changed: a page of only silent or
	 *     already-held rows still advances the reader, or the next ask repeats
	 *     the last one for ever. An EMPTY continuation cannot advance, so it is
	 *     the end (`hasMore` false) rather than a cursor to ask from again.
	 *  4. Anything else is a TAIL-TYPE read (a reconnect snapshot, the reconcile
	 *     walk, a refresh). It answers "what did I miss", not "where do I stop",
	 *     so it may only move the cursor to a STRICTLY OLDER instant than the
	 *     stored one (a genuinely wider read), and takes `has_more` only then. A
	 *     re-applied newest page used to replace the cursor with its own first
	 *     entry and flip a fully loaded conversation's `hasMore` back to true.
	 */
	const first = page.entries[0];
	const firstTs = first ? Math.round((first.ts ?? 0) * 1000) : 0;
	let oldestId = base.oldestId;
	let oldestTs = base.oldestTs;
	let hasMore = state.hasMore;
	if (options.keepPaging) {
		// Unchanged by contract, and checked FIRST as it always was: a tail read's
		// `has_more` describes the session, not this reader's position (review
		// round 3, R3-5).
	} else if (options.replace || state.oldestId === null) {
		if (first) {
			oldestId = first.id;
			oldestTs = firstTs;
		}
		hasMore = page.has_more;
	} else if (options.pagedBefore !== undefined) {
		if (first) {
			oldestId = first.id;
			oldestTs = firstTs;
			hasMore = page.has_more;
		} else {
			hasMore = false;
		}
	} else if (first && firstTs > 0 && firstTs < state.oldestTs) {
		oldestId = first.id;
		oldestTs = firstTs;
		hasMore = page.has_more;
	}
	const cursorMoved =
		oldestId !== state.oldestId || oldestTs !== state.oldestTs;
	if (!changed && !cursorMoved && state.hasMore === hasMore && !retiresPass)
		return state;

	// Durable rows first, then this page's new rows, in TIME order with ties
	// broken by the position each already had — so a page that lands out of order
	// cannot reshuffle rows the user is reading, and an arriving page row can no
	// longer tie itself ABOVE a painted one (the change `withTimeOrder` documents,
	// pinned in `transcript-reducer.test.mjs`). It is built from the merged list
	// and the index is derived from the sorted records, once, here.
	/*
	 * The collapse is applied to the MERGED list, after ordering: it is a pure
	 * function of that list, so a page applied twice, a `replace` re-seed and a
	 * cold load all end at the same rows (`collapseSettledCompactions`).
	 */
	const records = collapseSettledCompactions(
		withTimeOrder(
			[...byId.values()],
			// The rows this page states on the owner's side; the sort holds them
			// above the pending echo's tail block whatever the stamps say
			// (agent review round 1, F1).
			new Set(incoming.map((record) => record.id)),
		),
	);
	if (options.keepPaging) {
		/*
		 * A TAIL read answers "what did I miss", never "is there more behind me":
		 * the page carries no cursor, so its `has_more` describes the session
		 * rather than this reader's position, and letting it through put the "load
		 * earlier" affordance back on a transcript that already held everything —
		 * and resumed the mentioned-files scan's paging (review round 3, R3-5).
		 */
		return { ...state, records, index: withIndex(records), argsByCall };
	}
	return {
		...state,
		records,
		index: withIndex(records),
		oldestId,
		oldestTs,
		hasMore,
		// Retained even on `replace`: a reseed repaints the rows but does not
		// unlearn which arguments a call was made with, and the reseed is exactly
		// the path whose own events no longer carry them.
		argsByCall,
		/*
		 * A durable compaction outcome retires the claim its live frames would
		 * have. A REFUSAL emits no events at all (`serving.py::
		 * _record_compaction_refusal` writes this row precisely because the
		 * optimistic receipt has nothing else to correct it), so without this the
		 * claim the receipt implied would stand beside the row that contradicts
		 * it.
		 */
		compacting: retiresPass ? false : state.compacting,
		compactingSince: retiresPass ? 0 : state.compactingSince,
	};
}

// ------------------------------------------------------------------- live

type LiveEvent = { type: string; [key: string]: unknown };

/**
 * The counts that turn an argument about a stream defect into a measurement.
 *
 * WHY THESE EXIST. Two conditions in this file are reachable only from the
 * producer's behaviour, and reading the code cannot settle whether they happen
 * on a given machine: a delta arriving for a row that is already SETTLED, and a
 * snapshot seed carrying a delta for a row this viewer already painted. Both are
 * defensive paths with no colour of their own on screen.
 *
 * A counter rather than a log line, because the reader of this number is a
 * person (or an agent) looking at one long turn: the numbers are cheap to bump
 * and free to read from the dev readout the transcript pane already exposes on
 * the DOM (`canonical-transcript.tsx`, `import.meta.env.DEV`), rather than
 * shipped as behaviour under a flag nobody runs. Nothing here is read by the
 * reducer's own decisions: the counts are evidence, never input.
 */
export const streamDiagnostics = {
	/**
	 * A `message_update` met a painted, already-settled assistant row.
	 *
	 * THE MEASUREMENT the streaming audit asked for: if this stays at 0 across
	 * real turns, the reducer's settled-row gate is never the reason a message
	 * stopped updating, and the drop it performs is doing no work at all.
	 */
	settledAssistantUpdate: 0,
	/**
	 * A snapshot seed's delta was WITHHELD because the row it named already had text
	 * from before the gap (see `message_update`'s seed branch).
	 *
	 * WHAT THIS COUNTS, exactly, because a counter whose doc claims more than its
	 * increment is an instrument that lies about the thing it was added to measure
	 * (code review round 1, R1-3): one unit per row that KEPT ITS TEXT and had a
	 * delta withheld from it. The seed branch has a second outcome — a row minted by
	 * the same seed's `message_start`, which holds nothing yet and so takes the
	 * delta as its first text — and that row is marked `truncated` too; it is NOT
	 * counted here, because nothing was withheld from it. So this number answers
	 * "did a seed ever refuse to place a chunk?", and a row marked by that second
	 * outcome is the seed's ordinary "a turn is in flight" case rather than
	 * evidence about the withhold rule.
	 */
	seededDeltaWithheld: 0,
	/**
	 * A `message_update` frame was refused because the row already held a frame
	 * at or past its cursor - SAME EPOCH ONLY (the gate's own condition; a
	 * cross-epoch frame is applied by design and is deliberately not counted
	 * here).
	 *
	 * WHAT THIS COUNTS, exactly, because a counter whose doc claims more than
	 * its increment is an instrument that lies about the thing it was added to
	 * measure (the same care `seededDeltaWithheld` states, and agent review
	 * round 1, finding 4 asked for it here): every refusal the cursor gate
	 * performs. A receipt replay after a reconnect re-sends frames a healthy
	 * cursor excludes, and an interleaved flush from a dead stream can land a
	 * frame again after its successor already applied it - both used to append
	 * their fragment a second time, so this number answers "is the stream
	 * actually re-delivering frames to this viewer" by data rather than by the
	 * absence of a symptom, FOR THE HALF A CURSOR CAN DECIDE. The cross-epoch
	 * pass-through (see the gate's epoch paragraph) is not counted, so the
	 * number never claims more than the refusals it saw.
	 */
	staleUpdateFrameDropped: 0,
	/**
	 * A live message frame (`message_start`/`message_update`/`message_end`)
	 * refused because it states no USABLE id — absent, non-string, or empty.
	 *
	 * THE MEASUREMENT #671's report asked for: the guards used to test the type
	 * alone, so `id: ""` passed, and every id-less frame resolved to one record —
	 * two assistant-only deliveries overlapped into a single row whose text no
	 * producer ever wrote, and the message's durable entry painted the same text
	 * beside it as a second block. This number answers "did a frame actually
	 * arrive without an id" by data rather than by the absence of the splice,
	 * and it counts BOTH shapes the guard refuses — the empty string and the
	 * non-string it always refused — because both are the same fact: the frame
	 * cannot name the record it belongs to. `message_end` is an exception within
	 * the exception: an id-less end still ends the session's open assistant row
	 * when the state says exactly one thing it can end (the bounded fallback
	 * agreed with the condense/continuity lane, 2026-09-29), so a counted refusal
	 * there means there was NOTHING TO SETTLE — the frame named no assistant
	 * role, or the state held zero or several open assistant records — rather
	 * than the frame having been dropped against a record. The durable door's own refusal (a
	 * `history_delta` row with no id, dropped before it can be painted under
	 * "") is not counted here: it is a row, not a live frame.
	 */
	idlessFrameRefused: 0,
};

/**
 * The id a live message frame may be applied under, or null when the frame
 * states no usable one.
 *
 * AN EMPTY ID IS NOT AN ID, and admitting it is #671's splice. The live cases
 * used to test the TYPE alone (`typeof id !== "string"`), so a wire frame
 * carrying `id: ""` passed every guard, and every id-less frame — two turns of
 * an assistant-only delivery among them — resolved to the SAME record. The
 * updates then merged (`current.text + delta`), because a frame that cannot be
 * told apart from the row it names is, by the append-only contract, the same
 * message's next chunk: the block on screen held a paragraph that exists in no
 * record, and the message's durable entry — which carries the id the journal
 * gave the message, never minting one — painted the same text a second time
 * beside it.
 *
 * THE REDUCER CANNOT RECONCILE two DISTINCT non-empty ids: two identical
 * messages are legitimate, and no content comparison can tell "the same
 * message under two ids" from "two messages that read alike". The boundary is
 * therefore here, at the one value that can collide with itself: a frame that
 * names no id names no record, and it is refused exactly as a non-string id
 * always was. Nothing is lost — the durable page paints such a row under the
 * id its journal entry actually has.
 */
function liveMessageId(
	message: Record<string, unknown> | undefined,
): string | null {
	const id = message?.id;
	return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Apply one canonical AgentEvent. Idempotent: replaying an event whose
 * effect is already painted returns the same state.
 */
export function applyEvent(
	state: TranscriptState,
	event: LiveEvent,
	now = Date.now(),
	/**
	 * Where this event came from, when it is not this viewer's own live stream.
	 *
	 * `seed` marks the events a snapshot's `live_events` carries — the owner's
	 * projection of the turn in flight at the instant the snapshot was cut. They
	 * are a REPLAY of a window this viewer may have partly painted already, which
	 * changes what a delta may do to a row that is on screen (see
	 * `message_update`). Omitted on the live path and by every other caller, so the
	 * default is the live reading.
	 */
	options: {
		seed?: boolean;
		userStoppedAt?: number | null;
		/**
		 * Whether the session's owner runs the queued engine, read at apply time
		 * (`queuedAskEngineLive`). It governs the SETTLE-ONLY rule for `ask` rows
		 * (design §3 rows 2/6): `true` mounts no row while the call is in flight;
		 * absent keeps today's mount and relies on the settle marker to drop a
		 * divert. The replay fold that runs before a snapshot has no frontend to
		 * read and omits this, which is the design's own fallback.
		 */
		queuedAskEngine?: boolean;
		/**
		 * The frame this event arrived on, when the caller has one. `seed` folds
		 * bare events with no frame; the live and receipt-replay paths have the
		 * frame and pass its cursor, which is what makes a re-delivered
		 * `message_update` decidable (see `message_update`'s cursor gate).
		 */
		frame?: DeltaFrame;
	} = {},
): TranscriptState {
	const message = event.message as Record<string, unknown> | undefined;
	const incoming = options.frame;
	/*
	 * The settle-only ask mode (see the option's own doc), bound once per fold
	 * so the compose and start seams below cannot disagree about which fold
	 * they serve — and so a fold that does not carry it reads exactly as today.
	 */
	const queuedAskEngine = options.queuedAskEngine;
	switch (event.type) {
		case "agent_start": {
			const generation = Number(event.generation ?? state.generation + 1);
			if (generation === state.generation) return state;
			/*
			 * A NEW TURN is one of the ways a compaction claim stops. It cannot
			 * overlap a pass — a session running a compaction is not starting a turn
			 * — so a turn starting means any claim still standing was never retired,
			 * and retiring it here is what keeps a lost `compaction_end` from
			 * outliving the pass it described.
			 */
			return { ...state, generation, compacting: false, compactingSince: 0 };
		}
		case "compaction_start": {
			// The FIRST start of a pass owns the stamp; a replay of it is the same pass
			// and must not move the boundary forward under a row that is already old.
			if (state.compacting) return state;
			return { ...state, compacting: true, compactingSince: now };
		}
		case "agent_end": {
			const generation = Number(event.generation ?? state.generation);
			// A superseded end (older generation) must not touch the live turn.
			if (generation < state.generation) return state;
			// Anything still marked streaming at turn end is settled: the owner
			// sends message_end first, so this only catches an aborted stream.
			let next = state;
			for (const record of state.records) {
				if (record.kind === "assistant" && record.streaming) {
					/*
					 * The settle stamp rides the same sweep that clears `streaming`: a
					 * record the turn end settles (an aborted stream is the one this arm
					 * exists for) settles at the turn's own end instant, which is what
					 * the span composition reads as `settledAt ?? ts`.
					 */
					next = upsert(next, {
						...record,
						streaming: false,
						settledAt: now,
						stopReason: event.aborted ? "aborted" : record.stopReason,
					});
				}
				if (record.kind === "tool" && record.phase !== "done") {
					/*
					 * A call still RUNNING when the turn ends never reported an outcome. On
					 * an ABORT that is an interrupt, which is its own state; on a clean end
					 * it is a call whose end event was lost, and claiming success for it
					 * would be worse than claiming nothing.
					 *
					 * A row that never STARTED is a different fact, and the turn's verdict
					 * does not decide it: the call was announced, the turn died, and no tool
					 * ever received it. The TUI settles exactly these two states this way —
					 * `_retire_live_tool_cards` retires every live card, and
					 * `ToolCard.mark_interrupted` keeps the `never sent · N composed` record
					 * for a card that was still composing or queued. Without it a clean end
					 * painted a green tick on a call that never ran, and an abort blamed an
					 * interrupt on a call that had not begun. The compose record is the row's
					 * whole account of it: no duration, because nothing measured one.
					 */
					const unstarted =
						record.phase === "composing" || record.phase === "queued";
					next = upsert(next, {
						...record,
						phase: "done",
						// Settled, however it got here: the clock stops even though no
						// `_end` ever arrived to report a duration.
						startedAt: null,
						/*
						 * A row that never STARTED has no outcome the turn can grant it: no
						 * tool received the call, so there is nothing that could have
						 * succeeded. `stopped` is the ladder's "no verdict" state (`outcome`
						 * reads it after `isError`), and leaving it false here is what put a
						 * green tick on such a row at a CLEAN turn end — the tick is the
						 * ladder's default, so "no outcome" has to be said rather than left
						 * implicit. The TUI settles every live card through the same
						 * interrupted state for exactly this reason
						 * (`_retire_live_tool_cards` -> `mark_interrupted`).
						 *
						 * A row that WAS running keeps the historical mapping: an abort is an
						 * interrupt, and a clean end is a call whose end event was lost —
						 * which is a separate question from this one and is deliberately not
						 * moved here.
						 */
						stopped: Boolean(event.aborted) || unstarted,
						neverSent: record.neverSent || unstarted,
					});
				}
			}
			return next;
		}
		case "message_start": {
			const messageId = liveMessageId(message);
			if (message === undefined || messageId === null) {
				streamDiagnostics.idlessFrameRefused += 1;
				return state;
			}
			const current = state.records[state.index.get(messageId) ?? -1];
			if (message.role === "user") {
				/*
				 * The live half of the harness-chrome suppression (the durable half is in
				 * `durableRecord`, and both are needed — see its note). The message object
				 * has carried `provider_payload` on this path all along; it was simply
				 * unread for this role, which is why the desktop painted a loop's internal
				 * prompt as the user's own words.
				 */
				if (isHarnessInjected(message.provider_payload)) return state;
				/*
				 * The legacy fallback — see `durableRecord`'s note on the same check; the
				 * arms are separate code paths over separate payload shapes, so the
				 * fallback runs on both.
				 */
				const text = messageText(message);
				if (isHarnessChromeText(text)) return state;
				/*
				 * A RESTATING `message_start` FOR A ROW STILL HOLDING ITS PLACE IS NOT
				 * THE OWNER STATING WHERE IT SITS (agent review round 1, F2).
				 *
				 * `local` clears — the owner has the message, and the store's
				 * unknown-outcome arm reads exactly that (`peekLocalEcho` === "owner"
				 * is its delivered test) — but `provisional` stays, and the stamp
				 * stays OFF the client clock: on a reconnect these frames replay
				 * BEFORE the snapshot's page, and letting the swap end the hold is
				 * what sorted the echo above the page's pre-send rows. The durable
				 * row still ends the hold by replacing the record entirely.
				 */
				const keepsHold =
					current?.kind === "user" && current.provisional === true;
				return upsert(state, {
					kind: "user",
					id: messageId,
					// `monotonicStamp`, not `now`, mirrors #534's doctrine: a
					// locally-derived time may never lift the row above what is
					// already painted.
					ts: keepsHold ? monotonicStamp(state, now) : now,
					text,
					images: extractImages(
						message,
						messageId,
						current?.kind === "user" ? current.images : undefined,
					),
					...(keepsHold ? { provisional: true } : {}),
				});
			}
			if (message.role !== "assistant") return state;
			// A durable row already painted for this id outranks a replayed start.
			if (current) return state;
			return upsert(state, {
				kind: "assistant",
				id: messageId,
				ts: now,
				text: "",
				streaming: true,
				...(incoming ? { frame: incoming } : {}),
				stopReason: null,
				error: false,
			});
		}
		case "message_update": {
			const messageId = liveMessageId(message);
			if (message === undefined || messageId === null) {
				streamDiagnostics.idlessFrameRefused += 1;
				return state;
			}
			const position = state.index.get(messageId);
			const delta = String(event.delta ?? "");
			// The event's OWN text is the whole text this case may use. The
			// producer assembles `message.content` once, at the END of the call, for
			// a measured memory reason (`harness/loop.py`), so mid-stream the body is
			// empty and reading it would contribute nothing while making the code
			// look like it could rebuild the message from a frame that does not
			// carry one.
			const body = messageText(message);
			if (position === undefined) {
				/*
				 * A row this viewer never saw start, built from the frame's own text.
				 *
				 * WHY THE PREFIX IS UNKNOWN HERE, and why the row says so: the only way
				 * into this branch is an update for an id with nothing painted for it —
				 * a turn joined mid-stream, or a delta that arrived while the row was
				 * not on screen. Either way the message may well have text before this
				 * delta (the producer sends deltas ONLY, so an empty body says nothing
				 * about what came before), and a row that presented the chunk as the
				 * whole answer is what the operator reported as "the message starts
				 * mid-sentence". `truncated: "prefix"` is the honest form of the same paint:
				 * the chunk is shown, and the row states that no text of this message before
				 * this chunk reached this viewer.
				 *
				 * A producer that DOES accumulate is still handled exactly as before:
				 * a non-empty body is the running snapshot, `body + delta` is the
				 * authoritative text so far, and the row is not truncated. That is the
				 * shape the old branch was written against, and it stays correct for
				 * any producer that sends one.
				 */
				if (!body && !delta) return state;
				return upsert(state, {
					kind: "assistant",
					id: messageId,
					ts: now,
					text: body ? body + delta : delta,
					streaming: true,
					truncated: body === "" ? "prefix" : undefined,
					...(incoming ? { frame: incoming } : {}),
					stopReason: null,
					error: false,
				});
			}
			const current = state.records[position];
			if (current.kind !== "assistant") return state;
			if (!current.streaming) {
				/*
				 * A delta for a row that is already SETTLED. This is the freeze the
				 * operator reported, and the drop is kept deliberately rather than
				 * re-armed — see the counter below for why the question is answered by
				 * data instead.
				 *
				 * A settled row's text is authoritative for its id: a durable row from
				 * the journal, or `message_end`'s assembled text. Appending a later
				 * delta to it duplicates the tail in every case this condition is
				 * actually reachable in, and the message id space is per-message
				 * (`Message.id` is a fresh uuid4 per provider call) so a re-stream of a
				 * settled id is not a shape the producer emits. The alternative —
				 * re-arming to `streaming: true` — would be right only if such a
				 * re-stream existed, and would be a visible corruption (a repeated
				 * chunk) when a snapshot's page and its seed both name one message
				 * mid-turn, which IS reachable.
				 */
				streamDiagnostics.settledAssistantUpdate += 1;
				return state;
			}
			/*
			 * A FRAME THE ROW HAS ALREADY CONSUMED IS NOT APPLIED AGAIN — the cursor
			 * gate, and the fix for the re-delivery class.
			 *
			 * `frame` travels with every `event` frame and keeps its value across
			 * re-delivery, so a row whose last folded frame is at or past this one
			 * has, by the stream's own accounting, already consumed this fragment:
			 * a receipt replay after a reconnect re-sending a window the viewer
			 * already applied, or a flush from a stream that died interleaved with
			 * its successor's. Appending again is the corruption the operator
			 * photographed as "some chunks are not in the proper overlap/order" — a
			 * chunk landing twice in the text, and a short trailing fragment
			 * re-applied per re-delivery accumulating into a run that was never in
			 * the message.
			 *
			 * The comparison is per-EPOCH because a replaced owner restarts the
			 * numbering; a frame whose epoch differs is a different stream and is
			 * applied. THAT ARM IS DELIBERATE and deliberately uncounted: no
			 * ordering exists between two epochs, so a stale cross-epoch frame
			 * cannot be told from a legitimate restart replay by any fact this
			 * layer holds, and the wire has no path that constructs a stale one
			 * (a reconnect replays under the current receipt epoch, and the
			 * producer refuses a replaced epoch). Ordering across epochs, if
			 * delivery ever changes, belongs at the producer rather than in a
			 * second mechanism here. When no frame is in hand (tests call
			 * `applyEvent` directly) there is nothing to compare and the rules
			 * below decide alone, exactly as before.
			 *
			 * SEED FOLDS ARE EXEMPT (`options.seed`). Every event in one seed shares
			 * the snapshot's single cursor, so gating them against each other would
			 * refuse the seed's own sequence — its `message_start` would stamp the
			 * cursor and its own `message_update` would then be dropped as stale. The
			 * seed's window is already decided by the withhold rules immediately
			 * below, which is the older and more specific rule for exactly that
			 * question.
			 */
			if (
				options.seed !== true &&
				incoming &&
				current.frame &&
				incoming.epoch === current.frame.epoch &&
				incoming.seq <= current.frame.seq
			) {
				streamDiagnostics.staleUpdateFrameDropped += 1;
				return state;
			}
			// The cursor a row ends this case with: the last folded frame's, never
			// a regression (see `advancedFrame`). Computed once because both
			// branches below stamp it.
			const nextFrame = advancedFrame(current.frame, incoming);
			if (options.seed === true && !body) {
				/*
				 * A SEEDED DELTA-ONLY frame, against a row already on screen.
				 *
				 * The seed's update is the owner's LATEST delta at the snapshot instant,
				 * and a row that survived (a reconnect that kept its rows, see the
				 * receipt-gap path in `use-canonical-session`) already holds text from
				 * before the gap. Nothing in the frame says WHERE its delta belongs
				 * relative to that text: appending it duplicates the tail when the frame
				 * was one this viewer had already applied (the gap can swallow
				 * heartbeats and tool events while the assistant is between deltas),
				 * and skipping it leaves a hole when it was genuinely lost. Inventing
				 * text is the worse of the two, so the delta is withheld and the row is
				 * marked `truncated: "interrupted"`: what it holds is real, contiguous up to
				 * the gap, and may have a hole where the withheld chunk belonged — which is
				 * what the row's caption claims, NOT a missing prefix, because the row's own
				 * earlier text is on screen under it (design round 1, D2). `message_end`
				 * carries the assembled truth and clears the mark; the live deltas that
				 * follow the snapshot append normally.
				 *
				 * A row with NO text yet cannot duplicate anything, so the seeded delta
				 * is placed: the row was minted by this same seed's `message_start`
				 * (a mint from a delta-only frame is the branch above), and the first
				 * text to reach it is still the seed's own chunk. That row is marked
				 * `"prefix"` rather than `"interrupted"` — it holds nothing before this
				 * chunk, which is the fact its caption states — so the two outcomes of
				 * this branch carry the two claims, and the counter beside them counts the
				 * same divide (`current.text`).
				 *
				 * Only the delta-only shape is special-cased. A frame that carries a body
				 * is a running snapshot of the whole message, so the append path below is
				 * exactly right for it and is left to handle it — seeded or live alike.
				 */
				if (!current.text && !delta) return state;
				streamDiagnostics.seededDeltaWithheld += current.text ? 1 : 0;
				return upsert(state, {
					...current,
					text: current.text || delta,
					// The seed states the row as of the snapshot, so the snapshot's
					// own cursor is the position this text belongs to — advanced,
					// never regressed (see `advancedFrame`).
					...(nextFrame ? { frame: nextFrame } : {}),
					/*
					 * Which claim depends on the SAME fact the counter reads: a row that already
					 * had text had a chunk withheld from the middle of what it holds, while a
					 * row with none takes this delta as its first text and holds nothing
					 * before it — the join's own state, minted one branch up.
					 */
					truncated: current.text ? "interrupted" : "prefix",
				});
			}
			// Append-only contract: each update carries its own delta and the
			// loop only assembles `message.content` at the END of the stream, so
			// mid-stream the body is empty and the delta is all there is. When a
			// producer does send an accumulated body, `body + delta` is the
			// authoritative text and anything not longer than what is painted is
			// an older replay that must not regress the newer paint.
			// No content-based dedupe: "the the" is legitimate text and a
			// repeated single token is the common case in a token stream. The
			// ordering guarantees make it unnecessary: replay before the snapshot
			// folds into scratch state the durable page overrides, and the live
			// seed is applied once, at the snapshot, before any post-snapshot
			// event, so the same delta cannot reach a painted record twice.
			let next: string;
			if (body) {
				next = body + delta;
				if (next.length <= current.text.length) return state;
			} else {
				if (!delta) return state;
				next = current.text + delta;
			}
			return upsert(state, {
				...current,
				text: next,
				// The frame that carried this text IS the row's new position: a later
				// re-delivery of the same frame (or an interleave from the
				// predecessor stream) is refused by the gate above rather than
				// appended. Without a frame in hand the previous cursor is kept, and
				// it is only ever ADVANCED — a snapshot's older cursor cannot pull
				// the row's position backwards (see `advancedFrame`).
				...(nextFrame ? { frame: nextFrame } : {}),
				/*
				 * A frame with a body supplies the whole running text, so the row stops
				 * being missing anything and the mark goes on the SAME frame that
				 * supplies it (code review round 1, R1-2: keeping it here left the
				 * caption outliving the text it qualifies until `message_end`, which is a
				 * false claim for as long as it lasts). The delta-only frame is the
				 * shipped producer's shape and says nothing about the row's continuity,
				 * so there the mark is carried unchanged.
				 */
				truncated: body ? undefined : current.truncated,
			});
		}
		case "message_end": {
			const messageId = liveMessageId(message);
			if (message === undefined) {
				streamDiagnostics.idlessFrameRefused += 1;
				return state;
			}
			if (messageId === null) {
				/*
				 * THE BOUNDED FALLBACK, agreed with the condense/continuity lane
				 * (2026-09-29; re-bounded by the #671 round-1 review, U3): an end
				 * that cannot NAME its record still ends the turn this viewer is
				 * watching — when the state says exactly one thing it CAN end.
				 *
				 * WHY IT EXISTS: refusing every id-less end left a turn whose only end
				 * is id-less streaming for ever — and a turn that never settles never
				 * condenses, while the NEXT user row then reads as a steer and two
				 * turns merge silently. Settling is the one fact an unnamed end can
				 * still deliver.
				 *
				 * WHICH RECORD IT ENDS IS UNKNOWABLE, so the fallback settles only
				 * when EXACTLY ONE open assistant record exists. The first bound
				 * (settle the last-placed open record) guessed between concurrent
				 * streams and could settle the wrong row while stranding the other
				 * (review round 1, U3); two or more is a refusal, counted — no
				 * guessing. Zero is likewise nothing to end. This state is
				 * per-session and nothing on the frame carries a turn id to match on,
				 * so "exactly one" is the whole of the evidence an unnamed end can
				 * be settled against.
				 *
				 * NOTHING of the frame's text is written: the record settles with its
				 * own accumulated text, which is what keeps #671's no-fuse/no-double
				 * contract — two distinct records can still never become one. The
				 * frame's `tool_calls` IS consulted for the completion mark — the
				 * same rule the named path states — so a tool-call-only turn stays
				 * unmarked here too; the record's own `truncated` is kept, since
				 * settling is not the frame's assembled whole and clearing the caveat
				 * would claim a wholeness this path did not verify. The frame's outcome
				 * fields (`stop_reason`/`is_error`) are NOT adopted: an unnamed frame's
				 * outcome cannot be attributed to a record it cannot name.
				 */
				if (message.role !== "assistant") {
					streamDiagnostics.idlessFrameRefused += 1;
					return state;
				}
				let target:
					| Extract<TranscriptRecord, { kind: "assistant" }>
					| undefined;
				for (const candidate of state.records) {
					if (candidate.kind !== "assistant" || !candidate.streaming) continue;
					/*
					 * A second open assistant record makes the target a guess; bail
					 * out so the frame stays a counted refusal. (Checked before the
					 * settle below runs, so nothing is half-applied.)
					 */
					if (target !== undefined) {
						streamDiagnostics.idlessFrameRefused += 1;
						return state;
					}
					target = candidate;
				}
				if (target === undefined) {
					streamDiagnostics.idlessFrameRefused += 1;
					return state;
				}
				const frameToolCalls = Array.isArray(message.tool_calls)
					? message.tool_calls
					: [];
				const settled: TranscriptRecord = {
					...target,
					streaming: false,
					settledAt: target.settledAt ?? now,
					...(target.text || frameToolCalls.length === 0
						? { complete: true }
						: {}),
				};
				return upsert(state, settled);
			}
			if (message.role !== "assistant") return state;
			const position = state.index.get(messageId);
			const text = messageText(message);
			/*
			 * THE SETTLE INSTANT, kept when the row already settled: a replayed
			 * `message_end` (a receipt replay after a reconnect, a flush from a dead
			 * stream) must not restamp a completion — the record is replaced id-for-id,
			 * and the instant it first settled with is the one anything built on it
			 * already reads. A row arriving here settled for the first time stamps
			 * `now`, the viewer clock the span composition shares.
			 */
			const previous =
				position === undefined ? undefined : state.records[position];
			/*
			 * THE SAME COMPLETION MARK THE DURABLE READ GIVES THE SAME FACT.
			 *
			 * The `history` arm marks a text-bearing assistant answer `complete` and
			 * leaves a tool-call-only turn unmarked; a live `message_end` is the very
			 * same fact (this answer is finished) delivered by the other path, so it
			 * carries the very same mark. It is load-bearing beyond bookkeeping:
			 * `canonical-transcript.tsx` renders `data-completion-complete` from it,
			 * and the read receipt's anchor gate asks for exactly that attribute
			 * before it will acknowledge a completion (`use-completion-view.ts`).
			 * Settling without it made a completion that arrived while its
			 * conversation was open unacknowledgeable until some later re-read
			 * replaced the record with a durable one - the operator-visible "cannot
			 * be cleared until you switch away and back" (QA round 1, Q1; measured
			 * in `docs/evidence/chat-sidebar-ack-and-selection/`).
			 */
			const toolCalls = Array.isArray(message.tool_calls)
				? message.tool_calls
				: [];
			const settled: TranscriptRecord = {
				kind: "assistant",
				id: messageId,
				ts: position === undefined ? now : state.records[position].ts,
				text,
				...(text || toolCalls.length === 0 ? { complete: true } : {}),
				streaming: false,
				settledAt:
					previous?.kind === "assistant" && previous.settledAt !== undefined
						? previous.settledAt
						: now,
				stopReason: (message.stop_reason as string | null) ?? null,
				error: Boolean(message.is_error),
			};
			return upsert(state, settled);
		}
		case "history_delta": {
			// Settled rows that were never streamed here: same projection as a
			// durable page, keyed by message id.
			const rows = Array.isArray(event.messages)
				? (event.messages as Record<string, unknown>[])
				: [];
			/*
			 * A row that names no id names no record, and `String(row.id ?? "")`
			 * synthesised exactly the value every id-less row collides on: two such
			 * rows folded onto one record — the second replacing the first, or fusing
			 * with a live row that also stated none — which is #671's class arriving
			 * through the durable door (see `liveMessageId` for the whole rule).
			 * Dropped rather than painted under "", so the frame cannot manufacture a
			 * row the journal does not have; the journal's own entry carries the id
			 * the next read will paint it under.
			 */
			const identified = rows.filter((row) => String(row.id ?? "") !== "");
			const page: DesktopHistoryPage = {
				entries: identified.map((row) => ({
					id: String(row.id ?? ""),
					// The frame carries no entry time, so the reader's arrival second is
					// the only stamp it can be given here. Dating these rows needs the
					// entry `ts` on the wire — the PR's "not addressed" section names
					// this producer and the two others beside it in the runtime.
					ts: now / 1000,
					type: "message",
					payload: { kind: row.custom_type ? "custom" : "message", ...row },
				})),
				has_more: state.hasMore,
				cursor_missing: false,
			};
			// `reset` is the producer stating that this replay REPLACES the viewport
			// rather than extending it (`HistoryDeltaEvent.reset`, "a replay-changing
			// generation cannot be appended to the old viewport"), and two of the
			// three producers send the WHOLE history that way: the legacy-owner and
			// reset paths in `session/attached.py`. Merging those rows as a page
			// would paint the full transcript at the reader's arrival SECOND — after
			// every row already on screen — which is the ordering defect this module
			// exists to prevent, arriving through a different door. Honouring the
			// flag is the honest reading of the frame and costs one clause; the third
			// producer (the genuine reconnect gap) leaves `reset` false and keeps
			// merging, where the arrival stamp is the gap's own time rather than
			// hours of history mistaken for it.
			return applyHistoryPage(state, page, {
				replace: event.reset === true,
			});
		}
		case "tool_call_compose": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			/*
			 * IDENTITY PROMOTION FIRST, before anything looks a row up.
			 *
			 * ``supersedes_tool_call_id`` announces that THIS frame carries the real
			 * id of a call previously announced under an index-derived placeholder,
			 * and that the two are the SAME call. A provider that sends a call's
			 * `name` before its `id` makes the loop announce the row as
			 * `compose:{index}` while every start and end carries the real id, so a
			 * client that keys rows by tool_call_id holds TWO records for one call —
			 * and the abandoned one is painted as an interrupted call at turn end, on
			 * a call that succeeded.
			 *
			 * The TUI rekeys its card and the phone moves the row's correlation onto
			 * the real id. This port does the same thing to the record: the row the
			 * announcement left is REKEYED, not closed and reopened, so the call's row
			 * keeps its place in the ledger.
			 */
			const superseded = String(event.supersedes_tool_call_id ?? "");
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			const placeholder = superseded
				? state.records[state.index.get(`tool:${superseded}`) ?? -1]
				: undefined;
			// The row this call already has, in whichever id space holds it: the real
			// id first, because a frame that already carried it is the tighter
			// statement, then the announcement's placeholder.
			const announced =
				current?.kind === "tool"
					? current
					: placeholder?.kind === "tool"
						? placeholder
						: undefined;
			// A row that has OUTGROWN the announcement is left exactly as it is: a
			// call whose `tool_execution_start` already arrived is history on this
			// frame and present on that row, and relabelling it from a replayed
			// announcement would walk a running call back to `queued` (the phone's
			// `started` guard exists for the same reason).
			if (
				announced &&
				announced.phase !== "composing" &&
				announced.phase !== "queued"
			) {
				// The one case where a call could hold two rows: a later frame already
				// arrived under the real id, so the announcement beside it is a stale
				// duplicate and is retired. This is also what makes the promotion
				// idempotent — the announcement repeats on every later frame of the
				// call, and the contract defines the repeat to be harmless.
				return superseded && current?.kind === "tool"
					? supersedesRetire(state, superseded)
					: state;
			}
			/*
			 * The NEVER-RUN ending, and it comes FIRST — the order the TUI's handler
			 * uses, for the same reason: `not_run_reason` is a verdict, and a frame
			 * that carries one also carries `dictation_complete` (the dictation did
			 * end — it ended because nothing would receive the call). Reading the
			 * queued arm first would leave a row saying `queued` on a call that will
			 * never run, which is the lie this terminal state exists to kill.
			 *
			 * The row SETTLES IN PLACE, which is the TUI's `mark_not_run` shape: it
			 * keeps the final `argument_bytes` from THIS frame (the terminal frame is
			 * often the only one a viewer saw, so the size has to be handed over
			 * rather than inherited), takes no clock, and is terminal.
			 */
			const reason = String(event.not_run_reason ?? "").trim();
			const notRun = reason || null;
			/*
			 * The verdict's own class, which is what tells the INTERRUPTED kinds
			 * (`skipped`, `aborted`) from the planning faults. A frame from a core that
			 * predates the field states nothing, and a dictation frame never does - both
			 * read as `null` and keep today's `not-run` reading on the row.
			 */
			const kind = String(event.not_run_kind ?? "").trim() || null;
			/*
			 * THE SETTLE-ONLY ASK (design §3 rows 2/6): while the session's queued
			 * engine is live, an `ask` call gets NO live row while it is being
			 * dictated or waiting to run — the forked clearance check may divert
			 * it, and the design rejects a row that flashed for the gate's whole
			 * duration. Its one row is created at settle (the `tool_execution_end`
			 * arm: the receipt for a raise, nothing for a divert).
			 *
			 * `notRun` IS EXEMPT ON PURPOSE: a compose frame carrying a verdict is
			 * the TERMINAL settle of a call that never ran — no gate ran, a divert
			 * is impossible — and it renders exactly as today. A row that already
			 * exists in either id space (the mode became readable mid-flight)
			 * keeps today's handling — this arm suppresses the MOUNT, and the
			 * settle resolves that row either way; a superseded announcement with
			 * no row behind it is retired rather than kept.
			 */
			if (
				isSettleOnlyAsk(event.tool_name, queuedAskEngine) &&
				!notRun &&
				!announced
			) {
				return superseded ? supersedesRetire(state, superseded) : state;
			}
			// The frame's own final count, except that a zero is left alone: an
			// earlier frame that measured nothing and a frame that carries nothing
			// agree, and a terminal frame with an empty payload must not erase a size
			// a live frame already measured (`mark_not_run`'s rule).
			const statedBytes = Number(event.argument_bytes ?? 0);
			const record: TranscriptRecord = {
				kind: "tool",
				id,
				// The row's own time survives: it was ANNOUNCED then, and the identity
				// arriving now does not move it — the same reason the TUI carries the
				// card's navigation anchor over when it moves the card's id.
				ts: announced?.ts ?? now,
				toolCallId: callId,
				toolName: String(event.tool_name ?? ""),
				intent: (event.intent as string | null) ?? null,
				args: null,
				phase: notRun
					? "done"
					: event.dictation_complete === true
						? "queued"
						: "composing",
				argumentBytes:
					statedBytes > 0 ? statedBytes : (announced?.argumentBytes ?? 0),
				output: null,
				isError: false,
				durationS: null,
				// Composing is the model still dictating arguments, which is not part
				// of the call's execution time. The clock starts at `_start`, and a
				// never-run call never gets one: nothing executed, so there is no
				// interval to report and the blank column is the honest reading.
				startedAt: null,
				endedAt: null,
				images: EMPTY_IMAGES,
				added: 0,
				removed: 0,
				// Composing is the model dictating arguments: there is no RESULT yet,
				// so there is no diff. The guards above return early for any row that
				// already settled, so this cannot blank one.
				diff: null,
				stopped: false,
				notRunReason: notRun,
				// The kind rides the verdict and nothing else: no verdict, no class.
				notRunKind: notRun ? kind : null,
				// A verdict is the harness saying the call reached no tool. A call still
				// being dictated, or waiting to run, has not reached one yet either —
				// which is a state rather than a settlement, and `phase` carries it.
				neverSent: notRun !== null,
			};
			// The promotion's own case, when the announcement is the ONLY row this
			// call has: rekey it in place rather than closing it and opening another.
			if (
				superseded &&
				placeholder?.kind === "tool" &&
				current?.kind !== "tool"
			)
				return supersedesRekey(state, superseded, record);
			return upsert(
				superseded && current?.kind === "tool"
					? supersedesRetire(state, superseded)
					: state,
				record,
			);
		}
		case "tool_execution_start": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			/*
			 * A row that has ALREADY RUN is not restarted by a replayed start — but a
			 * never-run row is the exception, and it is the one the producer's
			 * terminal frames created: two calls may share an id, and then the loser is
			 * parked with a verdict while the WINNER executes. The TUI's
			 * `begin_running` revives exactly that card, clearing the error text and
			 * the error tint for "a row a never-run verdict settled on one of two
			 * calls sharing an id, whose twin then executed"; this is the same row and
			 * the same reason. A row that really ran keeps its result, which is what
			 * refusing here protects: a replay must not blank a settled row's output.
			 */
			if (
				current &&
				current.kind === "tool" &&
				current.phase === "done" &&
				!current.notRunReason
			)
				return state;
			const args = knownArgs(state, callId, event, current);
			// Remember them for the DURABLE row that will replace this one. The
			// history entry carries the result without the arguments, so without
			// this the row loses its object column the moment it settles onto a
			// page whose assistant row is not in the same page.
			const learned =
				args && !state.argsByCall.has(callId)
					? new Map(state.argsByCall).set(callId, {
							arguments: args,
							// The frame's own start when it states one, so a later replay of
							// this call's settling frame lands where the call really ran rather
							// than where that viewer happened to be looking.
							anchoredAt: epochMs(event) ?? now,
						})
					: state.argsByCall;
			const seeded =
				learned === state.argsByCall
					? state
					: { ...state, argsByCall: learned };
			/*
			 * THE SETTLE-ONLY ASK, START HALF (design §3 row 6): while the queued
			 * engine is live an ask mounts nothing here — but the args just learned
			 * above STAY learned, so the row the settle creates (a raise's receipt)
			 * still carries its object column. A row that already exists (the mode
			 * became readable mid-flight) keeps today's transition to running: this
			 * arm suppresses the MOUNT; the settle marker still drops the divert.
			 */
			if (isSettleOnlyAsk(event.tool_name, queuedAskEngine) && !current)
				return seeded;
			return upsert(seeded, {
				kind: "tool",
				id,
				ts: current?.ts ?? now,
				toolCallId: callId,
				toolName: String(event.tool_name ?? ""),
				intent:
					(event.intent as string | null) ??
					(typeof args?.i === "string" ? args.i : null),
				args,
				phase: "running",
				// A call that is running has outgrown the announcement, so any never-run
				// verdict on the row it revives is spent (the guard above lets that row
				// through for the two-calls-one-id case, and the twin's execution is the
				// fact that retires the verdict - its kind with it).
				notRunReason: null,
				notRunKind: null,
				neverSent: false,
				argumentBytes: 0,
				output: null,
				isError: false,
				durationS: null,
				// Where the running row's clock counts from, and the ONE field here that
				// may not be the caller's arrival instant: a viewer that ATTACHES to a
				// turn already in flight must resume the age the call really has, not
				// start a fresh zero beside a call that has been running for minutes
				// (the operator report this fixes: "each time I resume it says it's been
				// waiting for 0s regardless of how long").
				//
				// So the FRAME'S OWN stated clock wins, and the chain behind it is the
				// fallback rather than the rule:
				//
				//   - `epochMs(event)` is the producer's `started_at_epoch`, stamped at
				//     execution start. It is the only value in this expression that is a
				//     fact about the CALL rather than about this viewer, which is why it
				//     closes every arrival-stamping path at once — the seed applied
				//     after a snapshot already painted the row, the reconnect replay
				//     folded before that snapshot lands (both hand `applyEvent` a `now`
				//     that is the viewer's own), and an ordinary live frame. The reducer
				//     no longer depends on a caller passing the right value in an
				//     implicit parameter.
				//   - the existing value keeps a replayed `_start` (the reconnect cursor
				//     sends them again) from restarting a clock that is already running,
				//     and keeps the record identical under the equality gate.
				//   - `now` is the last resort, for a frame that states nothing.
				//
				// A stated start can never move a clock BACKWARDS — the producer stamps
				// it at execution start, so it is at or before this instant — and a
				// replay of the SAME frame states the same epoch, so the value stays put
				// rather than advancing on every replay.
				//
				// DELIBERATE ASYMMETRY, stated rather than discovered: a frame with NO
				// `started_at_epoch` (a legacy producer) still falls back to `now`
				// instead of blanking the column the way the TUI refuses to paint a
				// number it cannot justify (`tool_card.py:1437-1441`). That asymmetry
				// is kept here on purpose — this change is about resuming a clock that
				// has a real start, and a stated-nothing frame behaves exactly as it did
				// before. See the PR body for the reviewer's side of that call.
				startedAt:
					epochMs(event) ??
					(current?.kind === "tool" && current.startedAt !== null
						? current.startedAt
						: now),
				// The call has just started, so it has no completion to report yet.
				endedAt: null,
				// A running row has no outcome to report yet. It keeps whatever the
				// composing row held so a rebuild here cannot drop an array the gate
				// is comparing — and the same for a diff, which a replayed `_start`
				// must not be able to erase either.
				images: current?.kind === "tool" ? current.images : EMPTY_IMAGES,
				added: 0,
				removed: 0,
				diff: current?.kind === "tool" ? current.diff : null,
				stopped: false,
			});
		}
		case "tool_execution_end": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			const result = (event.result ?? {}) as Record<string, unknown>;
			/*
			 * THE DIVERT DROP, LIVE HALF (design §3 row 6). A result carrying the ask
			 * gate's hidden marker never paints: any row some earlier path already
			 * mounted for this call is REMOVED (the mixed-build flash the design
			 * accepts), and nothing is created when none exists. The read is
			 * marker-only and mode-independent — the same one the core's predicates
			 * and the TUI's ended seam use — which is also what keeps a core that
			 * predates the gate bit-for-bit today's behaviour: it never sends one.
			 */
			if (isAskGateDivertDetails(result.details))
				return removeRecord(state, id);
			// See `knownArgs`: the settling frame carries no arguments, and for a
			// viewer that joined a turn in flight it is the ONLY frame it has for
			// every call that finished before it arrived — so the arguments are
			// recovered from whatever does still hold them (the painted row, or the
			// session-wide map the durable assistant rows fill) rather than settling
			// the row with an empty object column.
			const args = knownArgs(state, callId, event, current);
			const base =
				current && current.kind === "tool"
					? current
					: {
							kind: "tool" as const,
							id,
							ts: now,
							toolCallId: callId,
							toolName: String(event.tool_name ?? ""),
							intent: null,
							args: null,
							phase: "done" as const,
							argumentBytes: 0,
							notRunReason: null,
							notRunKind: null,
							neverSent: false,
							output: null,
							isError: false,
							durationS: null,
							startedAt: null,
							endedAt: null,
							images: EMPTY_IMAGES,
							added: 0,
							removed: 0,
							diff: null,
							stopped: false,
						};
			// The row is settled, so this is also the last chance to LEARN the call's
			// arguments: a durable row for the same call id replaces this one when its
			// page arrives, and `applyHistoryPage` backfills that replacement from
			// this map. Guarded exactly like `tool_execution_start`, so a frame that
			// teaches nothing new leaves the map — and therefore the state —
			// identical, which is what the view's memoisation depends on.
			const learned =
				args && !state.argsByCall.has(callId)
					? new Map(state.argsByCall).set(callId, {
							arguments: args,
							// A settling frame is the LAST moment this call is dated: it carries
							// no start, so the arrival instant is all the session will ever know
							// — and it is already in hand here, which is the case this anchor
							// exists for.
							anchoredAt: epochMs(event) ?? now,
						})
					: state.argsByCall;
			const seeded =
				learned === state.argsByCall
					? state
					: { ...state, argsByCall: learned };
			const userStoppedAt = options.userStoppedAt ?? null;
			/*
			 * The event's own failure claim, ONE expression shared with the paint
			 * below, so "would this row have painted danger?" is asked in exactly
			 * one place.
			 */
			const claimsFailure = Boolean(event.is_error ?? result.is_error);
			/*
			 * THE END EVENT'S OWN FAULT CLASS. `result.details` is where the runtime's
			 * classifier writes WHY the call ended (`harness/types.py`'s `FAULT_KEY`:
			 * `aborted` when the user stopped the turn, `skipped` when a call was
			 * cancelled before it reported a result, `execution` when the tool really
			 * failed), and this is the wire's own statement - the same marker the durable
			 * row reads, so the live and reloaded projections of one call cannot disagree.
			 * `skipped` and `aborted` settle as INTERRUPTED: `isError` cleared, `stopped`
			 * set, and the duration below kept because the backend measured it.
			 *
			 * WHY BOTH THIS AND `killedByUserStop` BELOW: the client-side stop window
			 * covers the producers whose killing end event carries no marker, and the
			 * rows this viewer never saw the press for; this arm covers the converse - a
			 * viewer that never saw the press at all (a replay, a second window, a fresh
			 * attach), where the wire fact is the only statement that the call was stopped
			 * rather than broken.
			 */
			const interruptedFault = isInterruptedFault(
				(result.details as Record<string, unknown> | undefined)?.__fault,
			);
			/*
			 * WHETHER THE STOP EXPLAINS THIS END - and for every row WITHOUT a clock,
			 * not only one born by this event (the reason is the `isError` field's own
			 * comment below).
			 */
			const killedByUserStop =
				userStoppedAt !== null &&
				(typeof base.startedAt === "number"
					? base.startedAt <= userStoppedAt
					: claimsFailure);
			return upsert(seeded, {
				...base,
				args,
				phase: "done",
				// A call that REPORTED a result demonstrably ran, so a never-run verdict
				// on the row cannot outlive it. The two reach the same row only when two
				// calls share one id — the loser parked with a verdict, the winner
				// executing — and the phone clears its own `error` on the start for
				// exactly this reason. Leaving it would paint `never sent · N composed`
				// over a call's real output.
				notRunReason: null,
				notRunKind: null,
				neverSent: false,
				output: messageText(result) || null,
				/*
				 * A CALL THE USER'S OWN STOP KILLED DID NOT FAIL (UX round 2, U7; the
				 * second arm below is that round's U15).
				 *
				 * `Esc` interrupts the turn, the runtime kills the call in flight, and the
				 * process that died reports a genuine error — so the row landed on `error`
				 * and painted `failed` in `danger`: the ledger's loudest ink, blaming the
				 * agent for the user's own decision. Nothing on the wire separates "this
				 * call failed" from "this call was killed by the press three milliseconds
				 * ago", which is why the fact is the client's (`stoppedTurns` in the
				 * sessions store) and why it is consumed HERE rather than at the row's
				 * paint: this is the moment the end event arrives, so it is the one place
				 * where "was this call running when the user pressed stop?" is answerable
				 * from the record alone.
				 *
				 * THE TEST HAS TWO ARMS, AND THE SECOND SPEAKS FOR EVERY ROW WITHOUT A
				 * CLOCK - both shapes that reach it, and both measured in the rigs.
				 *
				 * ARM ONE, `startedAt <= userStoppedAt`, is precise in the direction that
				 * matters: only a call ALREADY RUNNING at the press can be the one the
				 * interrupt killed. A call that settled before the press never comes
				 * through this branch again — its end event was already consumed — so an
				 * honest failure earlier in the same turn keeps its `danger` row, and a
				 * call that started after the press cannot exist because the turn is over.
				 *
				 * ARM TWO ANSWERS THE ROWS ARM ONE HAD TO REFUSE (U15; widened to the
				 * parked call by agent review round 4's Q5, which reconciled the rig's
				 * three failing runs with UX's measurement). Two shapes reach it: the row
				 * this viewer only ever met as it SETTLED — born by the end event itself,
				 * because the start never reached it before the press — and the row it saw
				 * ANNOUNCED but never started, which is what the press actually kills on
				 * this daemon: a `[bash:N]` call PARKS at the approval gate, so no
				 * `tool_execution_start` precedes an `Esc` and the clock test has nothing
				 * to compare. Refusing them — the "a row with no clock is a guess" rule
				 * this comment used to state — is precisely the defect: the same turn then
				 * painted `failed` in danger beside its own Stopped line, blaming the
				 * agent for the user's press, and left the live layer disagreeing with the
				 * durable one, which re-projects `stopped` from the runtime's own
				 * `aborted` fault. The stop fact standing for this session is the only
				 * story that fits a row killed inside the stop window, so it is taken:
				 * between `failed` and `stopped`, "you stopped this" is the reading that
				 * does not accuse the user's own agent. That is a decision about whose
				 * in-principle guess wins (the transcript's "no clock is a guess" rule
				 * yields here), and the accepted cost is its mirror: a failure that
				 * settled BEFORE the press, whose end event only reaches a lagging
				 * viewer afterwards, rides the same window and reads `stopped`. The
				 * window is bounded rather than open — the press's receipt clears the
				 * fact on any answer that is not `interrupted`, and the next turn clears
				 * it again (`chat-page.tsx`) — and the call's real error text stays one
				 * expansion away either way.
				 *
				 * The arm also requires the event's own failure claim: the
				 * accusation it answers exists only when the row would paint danger, so
				 * a row whose event reports SUCCESS keeps that outcome — the stop
				 * fact must not overwrite a result the call demonstrably produced.
				 *
				 * `isError` is CLEARED as well as `stopped` set, because the row's outcome
				 * ladder reads `isError` first (`canonical-transcript.tsx`): leaving it
				 * true would keep the danger row this exists to remove. The output and the
				 * failure detail are untouched — the call's real error text is still one
				 * expansion away, which is what `interrupted` says: the stop is the
				 * verdict, not a cover-up.
				 *
				 * `interruptedFault` is the SECOND reading of the same question (see its own
				 * note above) and needs no client window to have been standing - the wire's
				 * fault marker classifies the row on its own.
				 */
				isError: killedByUserStop || interruptedFault ? false : claimsFailure,
				durationS:
					typeof event.duration_s === "number" ? event.duration_s : null,
				/*
				 * WHEN the call completed, kept for the fold's wall-clock span: the
				 * producer's own start plus its own measured duration, so the span is
				 * built from the producer's clock end to end and a frame replayed to a
				 * late viewer cannot date a completion that never happened then. Null
				 * when the frame states no duration or the row never carried a start —
				 * a stamp nobody measured is exactly the `0s` claim the fold refuses.
				 */
				endedAt:
					typeof event.duration_s === "number" &&
					typeof base.startedAt === "number"
						? base.startedAt + event.duration_s * 1000
						: null,
				// The call ended, so the row stops counting and reports the measured
				// duration instead. Clearing this is what makes the ticking stop.
				startedAt: null,
				// THE live screenshot path. A live event is dumped without
				// `exclude_defaults`, so `result.content` carries `{type: "image",
				// data, mime_type}` with the full base64 — a browser-tool capture is
				// renderable here with no backend round trip at all.
				//
				// An EMPTY extraction never replaces images the record already has,
				// which is the reconnect case rather than a hypothetical. A ~1.4 MB
				// base64 screenshot always blows the per-result budget in
				// `_bound_live_result_in_place` (`frontend_state.py`), and an image
				// block over its share is not emptied but REPLACED by a text
				// placeholder — so the seed for a call whose durable row already
				// resolved its digest carries no image blocks at all. Letting that
				// win would discard a resolvable digest in favour of the one frame
				// that was stripped precisely because it could not carry the bytes,
				// and the screenshot would vanish from a row that had it a moment
				// earlier. `applyHistoryPage`'s coalesce guards the same way at
				// `images: current.images.length ? current.images : record.images`.
				images: preferExisting(
					extractImages(result, id, base.images),
					base.images,
				),
				// The counters ride the same `details` object as the body below, so
				// they take the same guard: a seed end whose `details` the budget
				// stripped keeps the durable counts instead of writing 0/0 over them
				// (see `preferDiffCounts` for the measured sequence).
				...preferDiffCounts(result.details, base),
				// THE live diff path: `tool_execution_end` carries the tool RESULT, so
				// `result.details.diff` is the producer's own line list. Guarded the
				// way the images above are, and for the same measured reason — a
				// reconnect seed whose `details` were stripped by the live-event
				// budget must not blank a body the row already showed.
				diff: preferDiff(diffFromDetails(result.details), base.diff),
				// It reported an end, so whatever happened it was not interrupted —
				// UNLESS THE USER STOPPED IT (UX round 2, U7), or the WIRE's own fault
				// marker says the end was an interrupt (`interruptedFault`). The leading
				// `base.stopped` keeps the backend's own verdict on a record this upsert
				// REPLACES; dropping it would turn an abort into a success tick on the way
				// through. `killedByUserStop` is the client-side half and `interruptedFault`
				// the wire's own; `isError` is cleared beside both because the row's
				// outcome ladder reads `isError` first.
				stopped: base.stopped || killedByUserStop || interruptedFault,
				// Same absent-vs-stated guard as the diff above: a seed end whose
				// `details` the live-event budget stripped must not blank a state the
				// durable row already carried.
				delivery: preferDeliveryState(result.details, base.delivery),
			});
		}
		case "notice": {
			const text = String(event.text ?? "");
			if (!text) return state;
			// Notices carry no id; key by text + generation so a replay of the
			// same notice within the same turn does not duplicate it.
			const id = `notice:${state.generation}:${text}`;
			if (state.index.has(id)) return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: now,
				text,
				level: (event.kind as "info" | "warning" | "error") ?? "info",
			});
		}
		case "compaction_end": {
			/*
			 * A FIGURE IS PRESENT WHEN THE EVENT CARRIES ONE, including a zero: the
			 * runtime reports both figures as 0 for a pass that failed, and the durable
			 * row it wrote for that pass carries the same 0 — so the live line must
			 * carry it too, or the two projections of one pass disagree about whether
			 * they HAVE a fingerprint and one pass paints two rows (`typeof` rather
			 * than truthiness, matching `durableRecord`; review round 6, R6-1).
			 */
			const before = Number(event.tokens_before ?? 0);
			const after = Number(event.tokens_after ?? 0);
			const ok = Boolean(event.success);
			const failure = ok ? null : compactionOutcome(String(event.detail ?? ""));
			// The event's own figures, which is the sentence the pairing carries onto
			// the durable row — see `compactionSettledLine` for why this one wins and
			// `COMPACTED_LINE` for what a cold reader gets instead.
			const text = failure
				? failure.text
				: before && after
					? compactionSettledLine(before, after)
					: COMPACTED_LINE;
			// Still keyed by the pass, because it is the id a replayed end matches
			// and the id the collapse below recognises as the live projection.
			const id = `compaction:${state.generation}:${before}:${after}`;
			// The pass is over either way — success, refusal or failure — so this is
			// the clear, applied BEFORE the idempotence guard: a replayed end must
			// still retire a claim it has already painted a record for.
			const settled = state.compacting
				? { ...state, compacting: false, compactingSince: 0 }
				: state;
			if (settled.index.has(id)) return settled;
			/*
			 * A FAILURE is painted as a notice rather than as the settled line, so
			 * it can carry the tier the backend derives for it
			 * (`compactionOutcome`): the compaction record has no ink of its own, so
			 * a failed pass read in the same tone as a successful one — the one
			 * state of this feature the design round could not judge and the tone
			 * the deleted dialog did carry (design round 1, D2).
			 */
			if (failure)
				return upsert(settled, {
					kind: "notice",
					id,
					ts: now,
					text,
					level: failure.level,
				});
			/*
			 * The collapse runs BEFORE the state is returned, because the durable
			 * row may already be painted: a page read while the pass was still
			 * running carries no settled row, and the row that lands afterwards is
			 * the same event this line is projecting — so one of the two has to go,
			 * and it is the live one that goes (`collapseSettledCompactions` states
			 * the rule; it is idempotent, so running it here and in
			 * `applyHistoryPage` is the same answer twice).
			 */
			return collapseRecords(
				upsert(settled, {
					kind: "compaction",
					id,
					ts: now,
					text,
					before,
				}),
			);
		}
		case "retry_start": {
			const text = `Retrying after an error (attempt ${String(event.attempt ?? "?")})${
				event.fallback_model
					? `, falling back to ${String(event.fallback_model)}`
					: ""
			}`;
			const id = `retry:${state.generation}:${String(event.attempt ?? "")}`;
			if (state.index.has(id)) return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: now,
				text,
				level: "warning",
			});
		}
		case "subagent_end": {
			const id = `subagent:${String(event.job_id ?? "")}`;
			const status = String(event.status ?? "");
			const text = `${String(event.label ?? "Subagent")} ${status || "finished"}`;
			const current = state.records[state.index.get(id) ?? -1];
			if (current && current.kind === "notice" && current.text === text)
				return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: current?.ts ?? now,
				text,
				level: status === "failed" ? "error" : "info",
			});
		}
		default:
			return state;
	}
}

/**
 * `started_at_epoch` in epoch ms when the frame states one, else `null`.
 *
 * The producer stamps it where a call actually began (`harness/loop.py`), which
 * is the only wall clock any tool frame carries: `tool_execution_end` has none.
 * `null` rather than a defaulted instant on purpose — the tempting default is
 * the reader's own arrival dressed as the call's start, which is the fabricated
 * zero the whole `started_at_epoch` path exists to refuse.
 *
 * Thin, and deliberately so: the unit and its refusals are the shared helper's
 * (`epochMsFromSeconds`, beside the field declarations that state the unit), and
 * this names the FIELD so the reducer reads as what it is — "the frame's own
 * clock, when the frame has one". That helper is also what the working line's
 * `activity_phase_started_at` reader goes through, so the two surfaces cannot
 * come to disagree about what a stated instant is.
 */
function epochMs(event: LiveEvent): number | null {
	return epochMsFromSeconds(event.started_at_epoch);
}

/** The call id a seeded tool frame names, or `null` for any other frame. */
function seededCallId(event: LiveEvent): string | null {
	if (!event.type.startsWith("tool_")) return null;
	const callId = String(event.tool_call_id ?? "");
	return callId ? callId : null;
}

/**
 * The record id a seeded frame would paint, or `null` when it cannot be
 * attributed without folding it.
 *
 * Mirrors the two id rules `applyEvent` applies — a tool row keys by call id, a
 * message row by the message's own id — because the placement rule below has to
 * ask "would this CREATE a row" BEFORE the frame is folded.
 */
function seededRecordId(event: LiveEvent): string | null {
	const callId = seededCallId(event);
	if (callId) return `tool:${callId}`;
	const message = event.message as { id?: unknown } | undefined;
	return typeof message?.id === "string" && message.id ? message.id : null;
}

/**
 * The epoch ms a seeded row may be placed at, or `null` when the seed makes no
 * statement about WHEN the row happened.
 *
 * Two producers state a time and the backend owns both:
 *
 *   - a `tool_execution_start` carries `started_at_epoch`, so a call still
 *     running is placed at the instant it really began;
 *   - a call the transcript already holds a DURABLE statement about —
 *     `argsByCall`'s `anchoredAt`, the assistant row whose `tool_calls` named
 *     it — dates the settling frame that follows. `tool_execution_end` itself
 *     has no clock field at all, and the start that used to carry one is
 *     DELETED from the seed by the same fold that appends the end
 *     (`frontend_state._fold_live_event`), so when a result is replayed the
 *     durable row that named the call is the only honest anchor left.
 *
 * `null` is a real answer, not a missing value to be defaulted: it says the
 * seed can only claim the row arrived at the viewer now.
 */
function seededClock(event: LiveEvent, state: TranscriptState): number | null {
	const stated = epochMs(event);
	if (stated !== null) return stated;
	const callId = seededCallId(event);
	if (!callId) return null;
	const anchoredAt = state.argsByCall.get(callId)?.anchoredAt;
	// `> 0`, for the reason `epochMs` refuses a non-positive epoch rather than
	// returning one: `applyHistoryPage` anchors a call at its entry's instant, so
	// an entry whose `ts` is missing or zero would anchor every call it names at
	// EPOCH 0 — and a settling frame dated 1970 is not a weak position, it is a
	// fabricated one, sorted to the HEAD of the conversation by `withTimeOrder`
	// the moment it paints. An unusable anchor is no anchor: the frame falls back
	// to the rule a call nothing states gets (refused when the turn is over).
	return typeof anchoredAt === "number" &&
		Number.isFinite(anchoredAt) &&
		anchoredAt > 0
		? anchoredAt
		: null;
}

/**
 * Whether a seeded frame states that its call's DICTATION is over.
 *
 * Both terminal compose endings are this: a verdict (`not_run_reason`, the call
 * will never run) and a finished dictation (`dictation_complete`, the call waits
 * to start). Neither is an announcement of something being written right now —
 * which is the only thing a reader's arrival can honestly date — and neither has
 * a start or end event, because the producer deliberately synthesises none (the
 * API server pairs tool records by id, so a synthetic start would claim the tool
 * ran). They are therefore the frames the placement rule below has to tell apart
 * from an ordinary announcement, and the ones a read-back must be sized for.
 */
function finishedDictationFrame(event: LiveEvent): boolean {
	if (event.type !== "tool_call_compose") return false;
	if (
		typeof event.not_run_reason === "string" &&
		event.not_run_reason.trim().length > 0
	)
		return true;
	return event.dictation_complete === true;
}

/**
 * Whether a frame SETTLES a call, which is the one tool frame with no clock.
 *
 * `tool_execution_start` states `started_at_epoch` and a compose frame's two
 * terminal endings are `finishedDictationFrame`'s business; a settled end states
 * neither a time nor `args`, so it can only be placed by something else — the
 * seed entry the runtime stamps with the call's start (new runtimes) or the
 * durable row that named the call (`argsByCall.anchoredAt`). Both are checked
 * before this predicate, which is only reached when the frame would CREATE a row
 * and `seededClock` has already said it states no time: refusing it costs a row
 * until the read-back names it, and painting it costs a row in the wrong place
 * that says nothing ran.
 *
 * A SEPARATE PREDICATE FROM `finishedDictationFrame`, and the placement rule
 * below refuses both for ONE reason: neither class states a time, so the row
 * must wait for a source that does. Two different frame kinds reach it — a
 * settled call and a call whose dictation ended — and a single predicate covering
 * both would have to say what they have in common, which is exactly this
 * sentence rather than a type test.
 */
function settlesACall(event: LiveEvent): boolean {
	return event.type === "tool_execution_end";
}

/**
 * Seed the in-flight turn from a snapshot's `live_events`. Called after the
 * snapshot's history page has been applied so durable rows win.
 *
 * A SEEDED ROW MAY ONLY CLAIM A POSITION IT CAN JUSTIFY. The seed is defined by
 * the runtime as the bounded in-flight turn "a frontend that joins mid-turn
 * would otherwise miss", and this function is where that list becomes painted
 * rows — so this is where the claim gets checked:
 *
 *   - the list is capped at 100 SETTLED CALLS per turn
 *     (`frontend_state.LIVE_EVENT_END_ROWS_MAX`) while a single turn can run for
 *     hours (this harness's own sessions spend hours inside `wait`, and one such
 *     turn's 100 ends reached back past the 100-row page the snapshot carried);
 *     so the seed can name rows OLDER than the conversation's last row;
 *   - `frontend.streaming` is the wire's own statement that a turn is in
 *     flight, and a seed arriving with no turn in flight is not the in-flight
 *     turn it is defined as. The runtime serves exactly that: the desktop bridge
 *     hands over the follower's `frontend_state`, whose `live_events` is emptied
 *     only by a folded `agent_end`, while `refresh_from_session` republishes
 *     `streaming` from the live session and leaves the seed alone — so a viewer
 *     that attaches after a turn ended is handed that turn's seed.
 *
 * Placement therefore follows the frame's own clock where one exists, and a
 * frame that would CREATE a row and states no time is refused outright when no
 * turn is in flight: its only remaining time is the viewer's arrival, and
 * appending it paints `wait`/`hub`/`task` rows from hours earlier under a
 * conversation whose last message is the one the reader expects to be last. AND
 * A FRAME THAT SETTLES A CALL IS REFUSED EVEN WITH A TURN IN FLIGHT, for the
 * same reason the dictation rule below gives: the in-flight exemption is a claim
 * about WORK, not about time, and a call that has ENDED is not work waiting for
 * the reader. Its position belongs to the durable record — the assistant row that
 * named it dates it (`argsByCall.anchoredAt`), or the runtime states when it
 * began on the retained end — and `tool_execution_end` carries neither a clock
 * nor `args`, so with neither in hand there is nothing left but the arrival,
 * which is the fabricated position this rule exists to refuse. Appending it is
 * exactly the report this closes: opening a session while its turn runs painted
 * the OPENING turn's eight `bash` calls, an hour and several completed turns
 * earlier, under the running call, each row showing its output's first line where
 * the command belongs — the seed reaches that far back for the reason above, so
 * the injected set is a rolling window over every turn the run has taken, not
 * over this one. A frame whose record is ALREADY painted is folded onto it
 * whatever the clock, because that settles a card the reader can see without
 * moving any row — so a viewer that PAINTED the seed live (the mid-turn join this
 * seed exists for) and then lost the transport keeps those rows where they were
 * painted; the guarantee here is about a frame that would create a row, not about
 * one that finds its row on screen.
 *
 * Refusing loses nothing, but it does not return everything at once: every row
 * such a seed names is durable on the backend and the client fires a read sized
 * for exactly these unlabelled calls (`reconcileLimit`), and that read is ONE
 * tail read — bounded, so a very long turn reaches deeper than it does. Measured
 * on the session this rule was written for (`f91fbda61750`, `reconcileLimit(67)
 * = 234` entries): the read spans journal lines 1244-1477 and therefore brings
 * back the naming rows of 43 of the 67 refused calls (QA, counting only the 62
 * it could locate, measured 41 of 62), while the older ones — an 8-hour turn's
 * earliest work — come back only through the reader's own `load older`. They are
 * not lost (the page stays `has_more`), but this does not promise them at once.
 *
 * AND A FRAME WHOSE DICTATION IS OVER IS REFUSED EVEN WITH A TURN IN FLIGHT,
 * because the in-flight exemption above is a claim about WORK, not about time. A
 * live clockless announcement is admitted mid-turn because it describes a call
 * being dictated RIGHT NOW: the viewer's arrival is a wrong number but a true
 * ordering, and the alternative is a mid-turn join that shows nothing at all.
 * Both settled-dictation endings say the opposite — the model has stopped writing
 * this call, so what happens next (a wait behind a sibling's execution group, a
 * start elsewhere in the batch, or nothing at all) is not at the reader's
 * arrival — and the reported abnormality is exactly what dating them there
 * produced: one `wait` turn's four never-run calls rode the persisted seed into
 * every conversation switch as live `composing` rows stuck for the whole
 * multi-hour wait. The call's durable row is the authority and the client paints
 * it IN PLACE when the durable read reaches it — with the record's own time,
 * which is the one thing these frames cannot state; that is why a refused frame's
 * call id is also named by `seedCallsMissingLabels`, so the read is sized to
 * reach it. The read is a bounded tail read, so a call older than its bound
 * returns through the reader's own `load older` rather than at once. Refusing
 * here and refusing when no turn is in flight are one rule with one reason — the
 * frame states no time, so the row must wait for a source that does — and the
 * settled call above is the third case of that same rule, which is why both
 * predicates sit in one `else if` clause. A frame
 * whose record is ALREADY painted is still folded, whatever the clock and
 * whatever it says: that settles a row the reader can see without moving any row,
 * and it is the path that paints a verdict on the row its own announcement left
 * on screen.
 */
export function applyLiveSeed(
	state: TranscriptState,
	frontend: CanonicalFrontendState,
	now = Date.now(),
	/**
	 * The snapshot frame's own cursor, when the caller has one. Every event the
	 * seed folds is applied AT that position: the seed states the turn as of the
	 * snapshot, so a row it mints or extends has, by construction, consumed the
	 * stream up to here — which is what lets a later receipt-replay frame with an
	 * older cursor be refused rather than appended (see `message_update`'s
	 * cursor gate).
	 */
	origin: DeltaFrame | null = null,
): TranscriptState {
	let next = state;
	if (frontend.streaming && frontend.generation > next.generation) {
		next = { ...next, generation: frontend.generation };
	}
	/*
	 * A compaction claim is not CARRIED across a seed, and this is the "a
	 * reconnect must not resurrect a claim" half of its reconciliation.
	 *
	 * The seed is the authoritative statement of which live facts are still true
	 * for this viewer, and the claim is a live-only fact like any other, so the
	 * seed retires it and the loop below re-asserts it only from an event the seed
	 * actually carries. REVIEW ROUND 1 (R4) asked which that is, and the answer
	 * is NONE TODAY, checked rather than assumed:
	 * `frontend_state.py::_fold_live_event` folds exactly the agent/message/tool
	 * kinds into `live_events` — every other kind leaves the list untouched — so a
	 * `compaction_start` is not in the seed, and a reconnect during a pass drops
	 * the rung while the pass keeps running. That is the SAFE direction, and it is
	 * worth stating rather than implying a replay that does not exist: the rung
	 * names work nobody can vouch for otherwise, and the pass's own end still
	 * paints its line when it arrives. Nothing here depends on the replay; the
	 * loop keeps it so a seed that ever does carry the event lands correctly.
	 */
	if (next.compacting)
		next = { ...next, compacting: false, compactingSince: 0 };
	const inFlight = frontend.streaming === true;
	/*
	 * The settle-only mode, read from the SAME frontend this seed folds — the
	 * snapshot is where a viewer learns whether the owner runs the queued
	 * engine (`queuedAskEngineLive`), and the seed's frames then obey exactly
	 * the rules the live stream does: a composing ask mounts nothing, a marked
	 * end is dropped, a verdict frame paints.
	 */
	const queuedEngine = queuedAskEngineLive(frontend);
	/* A row was placed at a time the seed itself stated, so order by time. */
	let placed = false;
	const statedIds = new Set<string>();
	for (const data of frontend.live_events ?? []) {
		const event = data as LiveEvent;
		let clock = now;
		const id = seededRecordId(event);
		if (id !== null && !next.index.has(id)) {
			const stated = seededClock(event, next);
			if (stated !== null) {
				clock = stated;
				placed = true;
				statedIds.add(id);
			} else if (
				settlesACall(event) ||
				finishedDictationFrame(event) ||
				!inFlight
			) {
				// No time on the frame, so the only instant left is this viewer's
				// arrival: refuse it rather than paint a row at a moment that belongs to
				// the reader. The doctrine above has every reason — the turn is over, or
				// the frame says the dictation finished, which means the call's execution
				// (queued, running elsewhere, or never) is not happening here.
				continue;
			}
		}
		// `seed: true` is what tells `message_update` that this delta is a REPLAY of a
		// window this viewer may have painted already, so a row with text of its own
		// keeps it rather than having an unplaceable chunk appended (see that case).
		// The snapshot's cursor rides along so a row the seed touches records the
		// position its text belongs to.
		next = applyEvent(next, event, clock, {
			seed: true,
			queuedAskEngine: queuedEngine,
			...(origin ? { frame: origin } : {}),
		});
	}
	if (!placed) return next;
	// The rows this seed DATES from a real clock are on the owner's side of the
	// pending echo's tail block (the seed door of review round 1, F1); a
	// provisional row's own durable row is what ends its hold.
	const records = withTimeOrder(next.records, statedIds);
	return { ...next, records, index: withIndex(records) };
}

/**
 * Seed-settled calls whose painted row cannot say what ran.
 *
 * WHAT IT TAKES TO LABEL ONE: the arguments live on the paired assistant row's
 * `tool_calls`, in the durable transcript. `knownArgs` recovers them from
 * whatever the transcript already holds; this names the calls it cannot, which
 * is the set a caller can still close by reading further back into history —
 * and the set it should pay a page for, since an unlabelled row renders nothing
 * but its output.
 *
 * `labelled` is every call id the transcript IN HAND can already answer for:
 * the session-wide `argsByCall` map (filled by live starts and by every durable
 * assistant row seen so far) plus whatever page is arriving with the seed. It
 * is passed in rather than read off a `TranscriptState` because the caller
 * decides the page and the seed together, and the state it must measure against
 * is the one BEFORE that page is applied — not one this module can see.
 *
 * WHY THE CALLER SIZES ITS PAGE FROM THIS rather than using a constant: the
 * seed retains at most `LIVE_EVENT_END_ROWS_MAX` (100) settled calls, each of
 * which costs about three durable entries (its assistant row, its result and the
 * round's `session_spend.v1` row — measured, see `RECONCILE_ENTRIES_PER_CALL`),
 * so `reconcileLimit` below turns this list into a tail that usually reaches
 * every one of them in one request, and the hook's walk pages further back for
 * the rest — paying for the ACTUAL gap beats both a fixed deeper page on every
 * join and leaving the rows labelled with nothing but their output.
 *
 * Oldest first, deduplicated, and only ids the seed actually settled: a call
 * still running has its start, which carries its own arguments.
 *
 * AND SO ARE THE CALLS A SETTLED-DICTATION FRAME NAMES. A compose frame whose
 * dictation is over (`finishedDictationFrame`) is the ONE announcement of a call
 * that has no start and no end — and, after the placement rule above, no seeded
 * row either: its durable row is the authority and the row must come from a
 * read. Leaving those ids out of this list made that promise half true: the
 * durable page the caller sizes from this list would not reach them at all, so a
 * never-run verdict vanished from the ledger and a queued call appeared only
 * when its start finally arrived. Naming them costs a page the caller was going
 * to read anyway, and a call whose row cannot be found spends its own bounded
 * attempts and is dropped like any other (`labelGapCandidates`).
 */
/**
 * When each call the seed settled first RAN, in epoch ms, by call id.
 *
 * THE WALK'S ONE HONEST FLOOR, and the reason it exists: a page whose OLDEST row
 * predates an unlabelled call's own start cannot still be missing that call's
 * assistant row — where its arguments live — whatever else the journal holds. That
 * is a fact about one call rather than about the turn it sits in, which is what
 * the turn-boundary rule (`pageOpensTurn`) is: on a journal that is ONE long turn
 * there is no boundary row to meet, and a call nothing can label then cost the
 * whole journal on every open (round 2, QA Q1 / reviewer R1: 4 requests and 409
 * rows where `origin/main` reads one page).
 *
 * WHY THE DIRECTION WORKS, corrected by round 3's R9. A tool's assistant row and
 * its result row are written TOGETHER, at the end of the round they belong to:
 * over 417,999 real pairs the result's `ts` minus the assistant's is a median of
 * 13.1 µs apart — 17.2 µs across the 25,707 calls that ran longer than a minute —
 * and NEVER negative. So an assistant row sits at or after its call's own start,
 * however long the call ran, which is the one direction this floor needs: a page
 * older than the start by more than the slack has already passed the row. (The
 * earlier comment here said the row was written "at or within a second of" the
 * start, which reads as if the row could come first.) The residual 1.369 s worst
 * case in the paragraph below is the derivation's own slop — `duration_s` measured
 * from a clock a hair later than the row's write — not the writer's ordering.
 *
 * MEASURED, NOT ASSUMED. Over 418,566 real assistant/result pairs across 3,000
 * journals in `~/.local-operator/sessions` (the assistant row's `ts` minus the
 * call's own start, `ts - provider_payload.duration_s`), the assistant row is
 * never more than 1.369 s EARLIER than the start it belongs to and only ONE pair
 * in the whole set is below -1 s; the median is 0.541 s LATER, because a row is
 * written as its round is recorded rather than when the tool begins.
 * `RECONCILE_START_SLACK_MS` is five seconds against that 1.369 s, and being
 * wrong costs one page (the row falls back to its stand-in, exactly as it does on
 * `origin/main`) rather than a wrong label.
 *
 * The unit conversion is the shared `epochMsFromSeconds` — the same helper the
 * frame's own `started_at_epoch` reader uses — so the two sides cannot disagree
 * about what a stated instant is.
 */
export function seedCallStarts(
	liveEvents: readonly Record<string, unknown>[] | null | undefined,
): Map<string, number> {
	const starts = new Map<string, number>();
	for (const event of liveEvents ?? []) {
		if (!event) continue;
		const frame = event as LiveEvent;
		if (!settlesACall(frame) && !finishedDictationFrame(frame)) continue;
		const callId = String(frame.tool_call_id ?? "");
		if (!callId) continue;
		const at = epochMs(frame);
		if (at !== null) starts.set(callId, at);
	}
	return starts;
}

/**
 * The calls whose frame says they are still WAITING: a compose with no reason.
 *
 * The ONE startless kind that does not refuse the floor, and the exception is the
 * whole point (round 6, R16). A `tool_call_compose` with no `not_run_reason` is a
 * call still at a gate: the backend keeps it in the seed until its own
 * `tool_execution_start` replaces it, its assistant row is written when the round
 * closes, so NO page can name it yet — refusing the floor for it buys pages that
 * cannot end the walk (round 4's R11 measured 1 read of 325 rows becoming 2 of 429,
 * and 1 of 331 becoming 3 of 500 on the row cap).
 *
 * Every OTHER startless call does refuse the floor, which is what R16 corrected:
 * round 5's rule let only a compose that STATES a verdict block it, so a settled
 * `tool_execution_end` carrying no clock — what a producer older than v0.57.0
 * sends, or a viewer that joined after the call started sees — was skipped. That
 * call DID run and a page can label it, and leaving the floor on cost it its label.
 * The cost is stated the way it was measured, because the two heads are easy to
 * swap: `7b5ee49d` (round 5) reads 2 pages / 217 rows and leaves the call
 * unlabelled, while ITS predecessor `f1ef98c4c` reads 3 / 324 and labels it — the
 * 3-read figure belongs to the head BEFORE the regression, not to the one that
 * introduced it (round 7, R19).
 */
export function seedWaitingComposes(
	liveEvents: readonly Record<string, unknown>[] | null | undefined,
): Set<string> {
	const waiting = new Set<string>();
	for (const event of liveEvents ?? []) {
		if (!event) continue;
		const frame = event as LiveEvent;
		if (frame.type !== "tool_call_compose") continue;
		const reason = frame.not_run_reason;
		if (typeof reason === "string" && reason.trim().length > 0) continue;
		const callId = String(frame.tool_call_id ?? "");
		if (callId) waiting.add(callId);
	}
	return waiting;
}

/**
 * How much earlier than a call's own start an assistant row may be journaled.
 *
 * Five seconds against a measured worst case of 1.369 s over 418,566 real pairs
 * (see `seedCallStarts`, which states the sample and the direction). Generous on
 * purpose: a wrongly early stop costs the page a row's label and nothing else,
 * while a wrongly late one pays the journal.
 */
export const RECONCILE_START_SLACK_MS = 5_000;

/**
 * When each orphan's own result row was journaled, in epoch ms, by call id.
 *
 * THE FLOOR'S SECOND KIND OF INSTANT, and the shape round 3's R6a measured. An
 * orphan is a call nothing ever named, found because a page's boundary fell between
 * an assistant row and its own result (`pageOrphanResults`) — so its assistant row
 * is the row immediately ABOVE that result, and the result's own `ts` is the
 * instant that stands in for the call's start: the page that holds the result row
 * holds the assistant row with it, and a page whose oldest row predates the result
 * by more than the slack cannot be that page.
 *
 * Without it the floor ended the walk a page early on that shape: the seed's own
 * targets were labelled by page one, the in-flight call's recent start set the
 * floor, and the orphan — whose assistant row was one row behind the page — stayed
 * painted with its output, which is Q4's defect. `f1ef98c4c` made 2 reads and
 * labelled it; the round-3 head made 1 and did not.
 *
 * A `ts` the row does not state is left out rather than defaulted: an orphan with
 * no instant leaves the floor to the walk's other exits.
 */
export function pageOrphanResultInstants(
	entries: DesktopHistoryPage["entries"],
	orphans: Iterable<string>,
): Map<string, number> {
	const wanted = new Set(orphans);
	const instants = new Map<string, number>();
	if (wanted.size === 0) return instants;
	for (const entry of entries) {
		if (entry.payload?.role !== "tool") continue;
		const callId = entry.payload.tool_call_id;
		if (typeof callId !== "string" || !wanted.has(callId)) continue;
		const ts = entry.ts;
		if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
		instants.set(callId, Math.round(ts * 1000));
	}
	return instants;
}

/**
 * Whether a fetched page has read past every call still behind it.
 *
 * `starts` is `seedCallStarts` for the calls the walk is still looking for,
 * `orphanInstants` is `pageOrphanResultInstants` for the orphans it is still
 * chasing, and `entries` is the page it just read, whose OLDEST row is what
 * answers.
 *
 * A TARGET WITH NO STATED INSTANT REFUSES THE FLOOR unless the caller names it in
 * `startlessWaiting` as a call still waiting at a gate (`seedWaitingComposes`). Skipping EVERY
 * startless target let a co-target's instant set the floor alone and end the walk
 * before it: a `tool_call_compose` target is startless BY TYPE — the frame has no
 * clock field — so a settled call from the current round was enough to stop the
 * walk while a not-run call from an earlier one sat unlabelled behind it (measured:
 * 1 read and unlabelled against `f1ef98c4c`'s 3 reads and labelled).
 *
 * THE EXCEPTION IS ONE KIND, and R16 is why it is the exception rather than the
 * rule: a compose still WAITING at a gate cannot be labelled by any page yet, so
 * exempting it costs nothing, while every other startless call — a never-ran
 * compose WITH a reason, a blocked call, a settled end frame whose producer states
 * no clock — did run or did end, and a page may hold the row that labels it. The
 * caller narrows further with the walk's own behind set (`labelTargetsBehindIds`),
 * so a call of the round still running, newer than everything a page has named, is
 * not a target the floor is asked about (round 4's R11).
 */
export function pagePassedOldestStart(
	entries: DesktopHistoryPage["entries"],
	targets: Iterable<string>,
	starts: ReadonlyMap<string, number>,
	orphanInstants: ReadonlyMap<string, number> = new Map(),
	startlessWaiting: ReadonlySet<string> = new Set(),
): boolean {
	const oldestSeconds = entries[0]?.ts;
	if (typeof oldestSeconds !== "number" || !Number.isFinite(oldestSeconds))
		return false;
	let floor: number | null = null;
	for (const callId of targets) {
		const at = starts.get(callId);
		if (at === undefined) {
			// See the doc: every startless call refuses the floor but the kind the caller
			// names as still waiting, because no page can label that kind yet.
			if (startlessWaiting.has(callId)) continue;
			return false;
		}
		if (floor === null || at < floor) floor = at;
	}
	for (const at of orphanInstants.values()) {
		if (floor === null || at < floor) floor = at;
	}
	if (floor === null) return false;
	// The row's own unit conversion, spelled the way the rest of this file
	// converts a durable `ts` (`Math.round((entry.ts ?? 0) * 1000)`).
	const oldestMs = Math.round(oldestSeconds * 1000);
	return oldestMs <= floor - RECONCILE_START_SLACK_MS;
}

export function seedCallsMissingLabels(
	liveEvents: readonly Record<string, unknown>[] | null | undefined,
	labelled: ReadonlySet<string>,
): string[] {
	const missing: string[] = [];
	for (const event of liveEvents ?? []) {
		if (!event) continue;
		const frame = event as LiveEvent;
		if (!settlesACall(frame) && !finishedDictationFrame(frame)) continue;
		const callId = String(frame.tool_call_id ?? "");
		if (!callId || missing.includes(callId) || labelled.has(callId)) continue;
		missing.push(callId);
	}
	return missing;
}

/**
 * Which calls are still worth a read-back, and the rule that bounds them.
 *
 * ONE rule for both callers, because they answer the same question about
 * different candidate sets: the snapshot's seed names its unlabelled calls once
 * (`seedCallsMissingLabels`), and a round end re-asks about the ones that read
 * could not answer. Half of a seed is labelled by that first read; the rest
 * belong to the round still running, which only becomes durable at its own turn
 * end — so the retry is driven by those rounds and capped, or it becomes an
 * unbounded poll of the history endpoint.
 *
 * Capped PER CALL rather than per session: `maxAttempts` reads is what ONE
 * unlabelable call may cost, and the budget is spent across snapshots. Past it
 * the call has no arguments anywhere to find — a plan the harness rejected emits
 * no start and leaves no assistant row — and re-admitting it through a later
 * snapshot's seed would spend a history page per turn for the rest of the
 * conversation to learn nothing. That is why the caller keeps exhausted ids in
 * `outstanding` instead of forgetting them.
 */
export function labelGapCandidates(
	outstanding: ReadonlyMap<string, number>,
	candidateIds: Iterable<string>,
	labelled: ReadonlySet<string>,
	maxAttempts: number,
): string[] {
	const retries: string[] = [];
	const seen = new Set<string>();
	for (const callId of candidateIds) {
		if (seen.has(callId)) continue;
		seen.add(callId);
		if (labelled.has(callId)) continue;
		if ((outstanding.get(callId) ?? 0) >= maxAttempts) continue;
		retries.push(callId);
	}
	return retries;
}

/**
 * Durable journal entries to budget per unlabelled call, so the first label
 * read normally reaches the OLDEST one in a single request.
 *
 * AN ESTIMATE, MEASURED — not the seed's shape. This used to be 2 and was
 * described as exact (assistant row + tool row per call), but a real journal
 * also writes a `custom` `session_spend.v1` row per round, `session_state`
 * rows, prunes and the odd user/steering row, so the distance from the tail back
 * to a call's assistant row is not a fixed multiple. Measured read-only over
 * 1,357 real sessions under `~/.local-operator/sessions` (10,395 simulated joins:
 * seed = the turn's newest 100 calls, page = the newest 100 entries), the
 * per-missing-call depth past the page is p50 2.50, p75 2.88, p90 3.03, p95
 * 3.18, p99 4.23. At 2 one request covered 15.7% of joins; at 3.25 it covers
 * 96.4%, for a mean limit of 263 entries rather than 200. The rest is closed by
 * the goal-directed walk in `reconcileTail`, which pages back until every
 * target is labelled, so this ratio decides how many requests a join costs and
 * never whether the rows get their labels.
 *
 * The session in the report (`<session>`) needs 3.03: its turn repeats
 * assistant, tool, `session_spend.v1`, and at 2 its first read left 23 of 68
 * calls without a label.
 */
export const RECONCILE_ENTRIES_PER_CALL = 3.25;

/** The tail every reconcile asks for, and the app's ordinary history page. */
export const RECONCILE_TAIL_ENTRIES = 100;

/**
 * The backend's own ceiling for this page.
 *
 * `Query(default=100, ge=1, le=500)` on
 * `/v1/desktop/sessions/{id}/history`. Asking for more is a 422, not a bigger
 * page, so the arithmetic is clamped here rather than relying on the caller.
 */
export const RECONCILE_TAIL_MAX_ENTRIES = 500;

/**
 * The tail to read for a seed that named `missingCalls` unlabelled calls.
 *
 * Zero to fix means the ordinary tail, so the no-op case costs exactly what it
 * cost before this existed.
 */
export function reconcileLimit(missingCalls: number): number {
	if (missingCalls <= 0) return RECONCILE_TAIL_ENTRIES;
	// `ceil`: the ratio is fractional and the route takes an integer `limit`.
	return Math.min(
		RECONCILE_TAIL_MAX_ENTRIES,
		RECONCILE_TAIL_ENTRIES +
			Math.ceil(RECONCILE_ENTRIES_PER_CALL * missingCalls),
	);
}

/**
 * Which of `targets` a durable page names in an assistant row's `tool_calls`.
 *
 * The label walk's stop test: a call is labelled once the row that NAMED it is
 * in hand, because that is where its arguments live (`applyHistoryPage` copies
 * them into `argsByCall`). Pure so the hook's walk rule can be tested without a
 * transport.
 */
export function pageLabels(
	entries: DesktopHistoryPage["entries"],
	targets: ReadonlySet<string>,
): string[] {
	const found: string[] = [];
	if (targets.size === 0) return found;
	for (const entry of entries) {
		const calls = entry.payload?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const call of calls as Record<string, unknown>[]) {
			if (call && typeof call.id === "string" && targets.has(call.id))
				found.push(call.id);
		}
	}
	return found;
}

/**
 * Whether a fetched page holds the row that OPENED the turn the seed is of.
 *
 * THE ABSOLUTE FLOOR OF A LABEL WALK, and the exit a walk that cannot win needs.
 * Every call a mid-turn snapshot's seed names belongs to the turn that is in
 * flight, so its assistant row — where its arguments live — was journaled at or
 * after that turn's opening user row. Reading past the opening row therefore
 * proves the rest of the walk is looking for rows the journal does not hold, and
 * the walk descends to the row/request bound for nothing: round 1's R1 measured
 * a join during a turn's first round paging to the 500-row bound (four reads,
 * 416 rows) where main read one page. This is the condition that stops it.
 *
 * WHY A `user` ROW IS THE TURN'S OWN START, measured rather than assumed: over
 * 400 real transcripts under `~/.local-operator/sessions` (914 user rows), 0 of
 * them sit in the middle of a call's life — no row with `role: "user"` has a
 * tool result after it whose assistant row is before it. A steer or a harness
 * notice lands between rounds, never inside one, so the FIRST user row met
 * walking back from the tail is the turn's opening row. A journal that never
 * grew one (a pruned head) simply never satisfies this, and the walk keeps its
 * other exits.
 */
export function pageOpensTurn(entries: DesktopHistoryPage["entries"]): boolean {
	for (const entry of entries) if (entry.payload?.role === "user") return true;
	return false;
}

/**
 * Calls a page holds the RESULT of while no assistant row in that same page
 * names them.
 *
 * A CALL THE SEED NEVER NAMED, and the row QA round 1 called out (Q4): a page's
 * boundary can fall between an assistant row and its own result, so the page
 * begins with a tool row whose arguments are one row older than the page — and
 * because nothing in the seed names that call it was never a walk target, so the
 * row painted its output where the command belongs. That is the very defect this
 * read exists to fix, one row away from being fixed, and it is worth one page:
 * the walk turns such a call into a target and its assistant row is read next.
 *
 * `known` is every call id the caller can already account for — the seed's own
 * calls (`every`), everything a fetched page has named (`found`) and the orphans
 * already collected — so an ordinary page, whose tool rows all have their
 * assistant rows beside them, produces nothing here.
 */
export function pageOrphanResults(
	entries: DesktopHistoryPage["entries"],
	known: ReadonlySet<string>,
): string[] {
	const named = new Set(known);
	for (const entry of entries) {
		const calls = entry.payload?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const call of calls as Record<string, unknown>[]) {
			if (call && typeof call.id === "string") named.add(call.id);
		}
	}
	const orphans: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (entry.payload?.role !== "tool") continue;
		const callId = entry.payload.tool_call_id;
		if (typeof callId !== "string" || named.has(callId) || seen.has(callId))
			continue;
		seen.add(callId);
		orphans.push(callId);
	}
	return orphans;
}

/**
 * Whether the reconcile walk has read far enough to stop.
 *
 * TWO conditions, and both are required. The walk used to stop the moment a
 * fetched page CONNECTED to a painted row, which answers "is anything missing
 * between the page and the screen" — but the label gap is a different question:
 * the page has to reach back to the OLDEST unlabelled call's assistant row, and a
 * tail page connects long before that on any turn with more than a page of
 * calls. So:
 *
 *  - `connected`: some fetched page overlapped the painted rows, or nothing was
 *    painted (then no page can overlap and one page is the whole coverage);
 *  - `unlabelled`: how many target calls no fetched page has named yet.
 *
 * The walk's other exits live in the loop, because they are facts about the
 * route, the turn or the calls rather than about the goal: `!has_more`, the
 * `RECONCILE_WALK_MAX_ROWS` and `RECONCILE_WALK_MAX_REQUESTS` bounds,
 * `pageOpensTurn` (the row past which no seeded call of this turn can have its
 * assistant row) and `pagePassedOldestStart` (the instant past which the OLDEST
 * unlabelled call's own row cannot lie) — see each for which shape needs it.
 */
export function reconcileWalkDone(connected: boolean, unlabelled: number) {
	return connected && unlabelled === 0;
}

/**
 * The calls a seed names as STARTED, SETTLED or a stated verdict: the ids that
 * RETRACT an earlier announcement that the call was still waiting.
 *
 * The waiting set is per conversation and outlives the seed that filled it
 * (round 1, QA Q1), so it can only be right if every later statement about a
 * call updates it. Without this the set grew monotonically: a second pass of the
 * same conversation — or a seed that names one id twice — left a call exempt from
 * the floor that had since started and settled, so the walk stopped at the floor
 * and the call kept no label (round 7, R18, measured 2 reads of 217 rows where
 * the same shape reads 3 of 324 and labels it when the exemption is fresh).
 *
 * "Started" is `tool_execution_start`, "settled" is the one frame with no clock
 * (`settlesACall`), and a compose carrying a `not_run_reason` is the stated
 * verdict — the three ways a runtime says the call is no longer at a gate.
 */
export function seedSettledCalls(
	liveEvents: readonly Record<string, unknown>[] | null | undefined,
): Set<string> {
	const settled = new Set<string>();
	for (const event of liveEvents ?? []) {
		if (!event) continue;
		const frame = event as LiveEvent;
		const reason = frame.not_run_reason;
		const stated =
			frame.type === "tool_call_compose" &&
			typeof reason === "string" &&
			reason.trim().length > 0;
		if (
			frame.type !== "tool_execution_start" &&
			!settlesACall(frame) &&
			!stated
		)
			continue;
		const callId = String(frame.tool_call_id ?? "");
		if (callId) settled.add(callId);
	}
	return settled;
}

/**
 * How many label targets are still BEHIND everything read so far.
 *
 * `order` is the calls in journal order, oldest first — the seed's own order
 * (`seedCallsMissingLabels` over the whole seed), which holds the calls a page
 * already labelled as well as the targets. `found` is every call a durable page
 * READ FROM THE TAIL has named: the snapshot's own page and each page the walk
 * fetched. Reading is contiguous back from the tail, so once a call is found,
 * every target NEWER than it would have been inside what was read if it were
 * durable at all. Those are calls of the round still running (the round's
 * assistant row is written when the round closes), so no depth of reading finds
 * them now and the round-end retry is what labels them. Only targets OLDER than
 * the oldest found call are worth another page.
 *
 * Nothing found means nothing is known about where the targets sit, so all of
 * them count and the walk keeps reading — but only as far as the row that opened
 * the turn (`pageOpensTurn`) or the route's own bounds, never past them. Without
 * this rule a join during a round with finished calls would page to the 500-row
 * bound on every open, hunting rows that do not exist yet (round 1, R1).
 */
export function labelTargetsBehindIds(
	order: readonly string[],
	targets: ReadonlySet<string>,
	found: ReadonlySet<string>,
): string[] {
	// A target the seed no longer names was evicted from it by newer calls (a
	// round-end retry carries ids from an earlier snapshot's seed), so it is
	// older than everything in `order` and is behind whatever was read.
	const ordered = new Set(order);
	const behind: string[] = [];
	for (const id of targets)
		if (!ordered.has(id) && !found.has(id)) behind.push(id);
	for (const id of order) {
		if (found.has(id)) return behind;
		if (targets.has(id)) behind.push(id);
	}
	// No call in `order` was found: every target is still unaccounted for.
	return behind;
}

/**
 * How many label targets are still behind what has been read (`labelTargetsBehindIds`).
 *
 * Kept as a count because that is what `reconcileLimit` sizes a page from, and
 * derived from the ids so the two callers cannot come to disagree about which
 * targets are behind — round 4's R11 was a walk that used a narrower set for the
 * floor than for its own goal.
 */
export function labelTargetsBehind(
	order: readonly string[],
	targets: ReadonlySet<string>,
	found: ReadonlySet<string>,
): number {
	return labelTargetsBehindIds(order, targets, found).length;
}

/**
 * The rows a receipt gap leaves UNCERTAIN, kept and said to be uncertain.
 *
 * WHY THIS REPLACES THE DROP on the gap path. `dropLiveRecords` removes every
 * in-flight row, and on a mid-turn reconnect that is the operator-visible part of
 * the defect: the answer being written vanishes from the screen and comes back as
 * the tail the snapshot's seed carries, which is both a flicker and a silent
 * truncation. The rows are not wrong — they are all this viewer RECEIVED, and the
 * reducer's id-keyed merge already gives the snapshot's durable page authority
 * over every id it names — so the honest move is to keep them and mark the rows
 * whose continuity the gap broke.
 *
 * WHAT IS MARKED, and why exactly these: a STREAMING assistant row. Its text was
 * being written when the receipt broke, so the frames in the gap may have carried
 * deltas for it and nothing in a later frame can prove they did not. A settled
 * row is whole (a durable row, or the assembled `message_end` text) and the gap
 * cannot have taken anything from it. Tool rows are deliberately left unmarked:
 * their own last beat is re-stated by the snapshot's seed (`tool_execution_end`
 * replaces its start), so the call card is settled by the same frame that settles
 * its identity, while an assistant row has no such restatement until
 * `message_end`.
 *
 * A row already marked `"prefix"` KEEPS ITS MARK rather than being re-labelled.
 * That row's caption claims no text before its own first chunk reached this
 * viewer, which is still exactly true after a gap — the row really does not start
 * where the answer starts — and the gap adds a possible hole the caption does not
 * have to claim for the line to be honest. The one thing that would be false is
 * the other direction: saying a row's own earlier text is missing when it is on
 * screen, which is why the gap sentence is its own value (design round 1, D2).
 *
 * The in-flight compaction claim is still withheld, for the reason
 * `dropLiveRecords` gives: the pass is a live-only fact and a reconnect must not
 * inherit a claim from before the gap.
 */
export function markLiveRecordsTruncated(
	state: TranscriptState,
): TranscriptState {
	let next = state.compacting
		? { ...state, compacting: false, compactingSince: 0 }
		: state;
	for (const record of state.records) {
		if (record.kind !== "assistant" || !record.streaming) continue;
		if (record.truncated) continue;
		next = upsert(next, { ...record, truncated: "interrupted" });
	}
	return next;
}

/** View-only clear: the painted rows go, the backend history is untouched. */
export function clearTranscript(
	state: TranscriptState,
	at: number = Date.now(),
): TranscriptState {
	if (state.records.length === 0) return state;
	// `argsByCall` survives for the same reason it survives a `replace`: the
	// history this clears is still on the backend, and repainting it must not
	// lose the arguments the durable rows do not carry themselves.
	return {
		...EMPTY_TRANSCRIPT,
		generation: state.generation,
		// The in-flight pass is a BACKEND fact, not a painted one: clearing the view
		// does not stop a compaction, so the claim is carried rather than dropped —
		// which is also what the empty-transcript early return above already does.
		compacting: state.compacting,
		compactingSince: state.compactingSince,
		// The reset this counter exists for: a read scheduled against the previous
		// epoch must discard its page rather than repaint what `/clear` removed.
		viewEpoch: state.viewEpoch + 1,
		// The instant a cleared view is scoped by (see the field's own note).
		clearedAt: at,
		argsByCall: state.argsByCall,
	};
}

/**
 * Whether a durable entry is a compaction pass's own outcome row, optionally
 * scoped to the pass a read was scheduled for.
 *
 * `since` is a pass scope rather than a filter the caller re-derives: it is the
 * same instant `tailCarriesOutcome` compares against, so the row a cleared view
 * paints and the row the stop predicate is waiting for are the same pass by
 * construction. Without it, every pass's outcome row qualifies — which is how a
 * cleared view re-admitted the pre-clear ones (QA round 6, Q14).
 */
function isCompactionOutcome(
	entry: DesktopHistoryPage["entries"][number],
	clearedAt?: number,
): boolean {
	const outcome =
		entry.type === "compaction" ||
		(entry.type === "message" &&
			entry.payload?.custom_type === "compaction_refused");
	if (!outcome) return false;
	if (clearedAt === undefined) return true;
	return Math.round((entry.ts ?? 0) * 1000) >= clearedAt;
}

/** A token count as the settled line prints it: `41.0k`, `864`. */
function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Remove live-only records (no durable id) — used when a gap invalidates paint. */
/** Remove live-only records (no durable id).
 *
 * THE GAP NO LONGER CALLS THIS. A receipt gap keeps its live rows and marks the
 * streaming ones uncertain (`markLiveRecordsTruncated`) — erasing them was the
 * operator-visible half of the defect this branch fixes, because the answer being
 * written vanished and came back as the snapshot's tail. This function's one
 * remaining caller is the PAINT CACHE (`paint-cache.ts`'s in-flight filter), for
 * the reason stated there: a streaming row restored from a cache can never
 * advance, because the deltas that would advance it were consumed by the
 * previous mount.
 */
export function dropLiveRecords(state: TranscriptState): TranscriptState {
	/*
	 * The in-flight pass claim is LIVE-ONLY for the same reason those records are:
	 * a receipt gap means the app cannot see whether the pass is still running,
	 * and a reconnect must not inherit a claim from before the gap. Withheld
	 * rather than guessed — and NOT restored by the seed, which carries no
	 * `compaction_start` at all (review round 1, R4: `frontend_state.py::
	 * _fold_live_event` folds agent/message/tool kinds only), so a gap during a
	 * pass drops the rung while the pass runs on.
	 */
	const base = state.compacting
		? { ...state, compacting: false, compactingSince: 0 }
		: state;
	return removeMatching(
		base,
		(record) =>
			(record.kind === "assistant" && record.streaming) ||
			(record.kind === "tool" && record.phase !== "done"),
	);
}

/**
 * The stamp a LOCALLY-minted row may carry: `now`, or the largest `ts` already
 * painted when the client's clock is behind it.
 *
 * WHY THIS EXISTS (operator report, 2026-09-26): "when sending a user message,
 * it seems to end up in an inconsistent place within the conversation history -
 * it shows up above an older message and then corrects after some time to its
 * proper position". The mechanism is the seam between two functions that are
 * each correct alone: the local echo is stamped with the CLIENT's `Date.now()`,
 * and every merge re-sorts the whole list by `ts` (`withTimeOrder`). A session
 * whose stamps come from a clock even fractions of a second AHEAD of the
 * client's - a remote owner, or any client whose clock trails - therefore sorts
 * the fresh echo BEFORE the newest painted row, above an older message, until
 * the owner's durable row (the same id, its own stamp) replaces it: the visible
 * "corrects after some time".
 *
 * The guarantee this keeps is the one the sort states: content in time order,
 * canonical rows authoritative. It changes only WHERE a locally-minted row sits
 * among rows already painted - never before them. A tie keeps the row after the
 * one it followed, because `withTimeOrder` breaks ties by position and a freshly
 * appended row holds the tail position; and the durable row still replaces this
 * one and sorts to its own canonical place, because the two share an id.
 */
function monotonicStamp(state: TranscriptState, now: number): number {
	let ts = now;
	for (const record of state.records) {
		if (record.ts > ts) ts = record.ts;
	}
	return ts;
}

/**
 * Paint the user's own message the instant it is admitted, before the owner
 * echoes it back.
 *
 * Keyed by the ADMISSION REQUEST UUID, which is the id the owner will give the
 * durable row: the request id becomes `command_id`, then `message_id`, then
 * `Message.user(..., id=message_id)`, then the durable `TranscriptEntry` id.
 * That is what makes this an ECHO rather than a duplicate — `upsert` replaces
 * it in place the moment the real row lands, which is the property this
 * module's own header describes ("user rows carry the request UUID, so an
 * optimistic echo and the owner's `message_start` coalesce for free"). Any
 * other key — a local uuid, a timestamp, an index — paints the message twice,
 * permanently.
 *
 * The record is an ordinary `user` record with no pending flag: a distinct
 * variant would break `shallowEqual`'s key-count comparison, so the durable
 * row arriving would always count as changed and re-render.
 */
export function appendPendingUser(
	state: TranscriptState,
	id: string,
	text: string,
	images: TranscriptImage[],
	now = Date.now(),
): TranscriptState {
	// The owner's row wins over a later echo for the same id: re-echoing would
	// otherwise overwrite reconciled content with the composer's original text.
	if (state.index.has(id)) return state;
	return upsert(state, {
		kind: "user",
		id,
		ts: monotonicStamp(state, now),
		text,
		images,
		local: true,
		// Every echo holds its place until the owner states the row: "no rows
		// painted" was never the boundary (agent review round 1, F1/F3 — an
		// echo over painted rows, cached or live, faces the same unchecked
		// clock), so the hold is admission order against the merges that
		// carry rows (`withTimeOrder`'s tail block). `message_start` clears
		// `local` alone; the owner's stamped row ends the hold.
		provisional: true,
	});
}

/**
 * Remove a record only while it is still this app's own optimistic echo.
 *
 * The unknown-outcome case needs the distinction the echo's `local` flag exists
 * for: the app cannot tell from the id alone whether the row on screen is its own
 * unconfirmed echo or the owner's durable record of the same message, and the two
 * demand opposite answers - remove the first, treat the second as proof that the
 * message was delivered (see `admitChatDraft`).
 */
export function removeLocalRecord(
	state: TranscriptState,
	id: string,
): TranscriptState {
	const record = state.records[state.index.get(id) ?? -1];
	if (!record || record.kind !== "user" || !record.local) return state;
	return removeRecord(state, id);
}

/**
 * Drop one record by id, whoever painted it.
 *
 * The send path uses this for a row whose outcome is UNKNOWN, and it is safe there
 * for the reason `retractLocalEcho` exists beside it: a `local` row is this app's
 * own echo, so the message it paints is being handed back to the composer, and
 * leaving the echo would show one message twice. A durable row for the same id is
 * never removed this way - `retractLocalEcho` reports that case instead, and the
 * store treats it as delivery.
 */
export function removeRecord(
	state: TranscriptState,
	id: string,
): TranscriptState {
	return removeMatching(state, (record) => record.id === id);
}

let localNoteCounter = 0;

/** Append a renderer-local notice row (never durable, never replayed). */
export function appendLocalNote(
	state: TranscriptState,
	text: string,
	level: "info" | "warning" | "error",
	now = Date.now(),
): TranscriptState {
	localNoteCounter += 1;
	return upsert(state, {
		kind: "notice",
		id: `local:${now}:${localNoteCounter}`,
		ts: monotonicStamp(state, now),
		text,
		level,
	});
}

/**
 * Give a crash-recovered outcome a row, so it can be read at all.
 *
 * The normal settle path writes a `completion_attention` transcript entry and
 * `durableRecord` renders it. Crash recovery does not: `bootstrap_transcript`
 * republishes an `interrupted` completion from the `attention_started` journal
 * with anchor `completion-<token>`, and that entry never exists because the
 * turn that would have written it is exactly the one that died.
 *
 * Without a row carrying the anchor, the view finds nothing to hit-test and the
 * conversation stays unread forever while the user is looking straight at it —
 * self-healing only if some later turn completes, which for a finished
 * conversation may be never. The TUI already synthesizes this notice
 * (`tui/app.py::_poll_completion_attention`); this is the same guard for the
 * surface that decides what is renderable on desktop.
 *
 * `unseen` gates CREATION only. The row is itself ackable, so it acknowledges
 * itself within about half a second — and because the receipt writes only to the
 * store and never adds a transcript entry, nothing durable replaces it. Deriving
 * its continued existence from `unseen` therefore made "Interrupted" appear and
 * then vanish under the user, permanently: reopening the conversation the next
 * day showed no trace that the run was ever interrupted. It also disagreed with
 * the TUI, whose `_append_block(NoticeBlock)` survives the receipt, so the two
 * surfaces rendered different transcripts for the same conversation — the exact
 * divergence this feature exists to remove. `remembered` carries the anchors
 * already synthesized for the mounted conversation so the row's LIFETIME matches
 * the TUI's: reading an outcome marks it read, it does not delete it.
 */
export function withRecoveredOutcome(
	state: TranscriptState,
	attention:
		| {
				anchor_id?: string | null;
				kind?: string | null;
				unseen?: boolean;
				conversation_id?: string;
		  }
		| null
		| undefined,
	streaming: boolean,
	remembered?: Set<string>,
): TranscriptState {
	const anchor = attention?.anchor_id;
	const kind = attention?.kind;
	if (
		!anchor ||
		(kind !== "error" &&
			kind !== "interrupted" &&
			kind !== "closed" &&
			kind !== "retired") ||
		// Mirrors the TUI's retry guard: a historical failure must not be
		// inserted at the tail of a retry that is already running.
		streaming ||
		state.index.has(anchor) ||
		// Already read AND never shown here: the outcome was acknowledged on
		// another surface, so this conversation has no row to keep alive.
		(!attention?.unseen && !remembered?.has(anchor))
	)
		return state;
	remembered?.add(anchor);
	return upsert(state, {
		kind: "notice",
		id: anchor,
		// The recovered outcome has no timestamp of its own, so it sorts at the
		// tail where the durable rows it follows already are.
		ts: state.records.at(-1)?.ts ?? Date.now(),
		complete: true,
		text:
			kind === "closed"
				? CLOSED_OUTCOME_TEXT
				: kind === "retired"
					? RETIRED_OUTCOME_TEXT
					: kind === "error"
						? "Stopped with an error"
						: "Interrupted",
		level:
			kind === "closed"
				? "info"
				: kind === "retired"
					? "warning"
					: kind === "error"
						? "error"
						: "warning",
	});
}
