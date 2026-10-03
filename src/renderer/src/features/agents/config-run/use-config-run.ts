/**
 * The configuration run: how it starts, how it is watched, how it is stopped,
 * and what it is allowed to touch.
 *
 * THE ONE HARD CONSTRAINT, restated here because this file is where it could be
 * broken: **a send from the Agents page never enters the operator's conversation
 * and never becomes a conversation this app lists.** Three mechanisms hold it,
 * and each is a line in this file rather than a rule in prose:
 *
 *  1. the create goes through `desktopResult` DIRECTLY — never
 *     `useCanonicalSessionsStore.getState().createSession`, which `upsertSession`s
 *     the new id and would make the run a row the sidebar tracks;
 *  2. the run's id is held in `config-run-store.ts` (module scope, not persisted),
 *     so nothing about it reaches the canonical session store, the draft store or
 *     the chat route;
 *  3. the run's own transcript is READ from the server with the ordinary
 *     `useCanonicalSessionStream` — the same reader the chat pane uses — which
 *     reads and never writes a store row.
 *
 * WHAT THE BACKEND OWES THIS FILE (the sibling core change, and the reason the
 * whole surface is behind a capability key): a `purpose: "agents-config"` create
 * stamps a hidden origin, admits exactly that origin through the desktop door,
 * declares the run's tool inventory as the `agent` and `team` tools, resolves the
 * run's cwd and model itself, and enforces ONE live run per config root — a
 * second create while one is live answers 409 with the active run's id, which is
 * both the single-flight rule AND the way a fresh window re-attaches.
 */

import { interruptTurn } from "@features/chat/interrupt-turn";
import { encodeImageAttachments } from "@features/chat/utils/attachment-encode";
import {
	imageOverflowRefusal,
	unreadableAttachmentRefusal,
} from "@features/chat/utils/attachment-read";
import type { WireImage } from "@features/chat/utils/bound-image";
import {
	DesktopControlError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ReusableProfile,
	type ReusableTeam,
	invalidateAuthoring,
} from "@shared/api/local-operator/profile-hooks";
import {
	type CanonicalSessionHandle,
	useCanonicalSessionStream,
} from "@shared/hooks/use-canonical-session";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type RunResult,
	type RunTarget,
	useConfigRunStore,
} from "./config-run-store";
import {
	type CatalogueSnapshot,
	RUN_TOOL_NAMES,
	type RunToolRow,
	diffCatalogue,
	projectRunToolRow,
	snapshotCatalogue,
} from "./summary";

/**
 * Whether this app, against this backend, may start a configuration run.
 *
 * ALL FOUR KEYS, and none of them is a formality:
 * `agents_config` is the run itself; the two catalogue keys are how the results
 * are READ (a run whose results the page cannot show is a write nobody sees);
 * `session_interrupt` is how it is STOPPED, and a supervised run the operator
 * cannot cancel is not acceptable — so a backend advertising the first three and
 * not the fourth gets the structured page and no composer.
 */
export function configRunEnabled(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return (
		desktopFeatureEnabled(capabilities, "agents_config") &&
		desktopFeatureEnabled(capabilities, "session_interrupt") &&
		/*
		 * BOTH catalogue keys, `&&` rather than `||` (review round 1, m1). The
		 * settle diff reads `profiles.list` AND `teams.list` unconditionally, so a
		 * backend advertising only one of them would start runs that could never
		 * describe their own result — every run would end in "the lists could not be
		 * read". This function's own docstring, and the design note § 3.9, both say
		 * all of them; the code said otherwise.
		 */
		desktopFeatureEnabled(capabilities, "profile_catalogue") &&
		desktopFeatureEnabled(capabilities, "team_catalogue")
	);
}

/**
 * The active run's id, from the single-flight refusal.
 *
 * The backend answers a second create with 409 and the id of the run already
 * going (`{"code": ..., "message": ..., "session_id": ...}`). Reading it is what
 * makes re-attach possible after a reload, and it is read from the refusal BODY
 * rather than parsed out of the sentence: prose the backend owns may be reworded
 * in a patch release, and an id recovered by regex from a message is the mistake
 * `interrupt-turn.ts` records for the old Stop control.
 */
export function activeRunIdFromRefusal(error: unknown): string | null {
	if (!(error instanceof DesktopControlError)) return null;
	if (error.status !== 409) return null;
	const detail = error.detail as { session_id?: unknown } | undefined;
	const id = detail?.session_id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * One tool row's own words for what it is doing, when it names a definition.
 *
 * WHICH FRAMES NAME A TOOL CALL AND ITS TARGET IS A SPIKE ITEM ON THE BACKEND
 * SIDE (design consult § 8 Q4), so this projection is deliberately tolerant: it
 * reads the argument names the tool's OWN schema uses (`op`, `name` — the row's
 * arguments are the call's arguments, and `AgentParams`/`TeamParams` are what
 * produced them), and it reports nothing rather than guessing when they are
 * absent. A strip that said "Updating something" would be worse than one that
/** The elapsed time of a run, ticking only while it is live. */
function useElapsed(startedAt: number | null, live: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!startedAt || !live) return;
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, [startedAt, live]);
	return startedAt ? Math.max(0, now - startedAt) : 0;
}

export function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * What the run last SAID, from its own transcript.
 *
 * The last assistant row rather than the last row: a run that changed nothing
 * still answers, and its answer is the last thing it wrote (review round 1, U3).
 * Rows without text (a tool call, a notice) are skipped rather than returned
 * empty, so a run whose final act was a tool call still shows its sentence.
 */
export function lastAssistantText(
	records: readonly { kind: string; text?: string }[] | undefined,
): string {
	for (let index = (records?.length ?? 0) - 1; index >= 0; index -= 1) {
		const row = records?.[index];
		if (row?.kind === "assistant" && row.text?.trim()) return row.text.trim();
	}
	return "";
}

/**
 * Whether the server says a turn is running on this session, or `null` for
 * "this response did not say".
 *
 * TWO SHAPES, both read: `frontend.streaming` is what this app's own stream
 * reads, and `frontend.snapshot.streaming` is where the runtime's
 * `FrontendSessionState` keeps the flag (`session/frontend_state.py`). `null`
 * rather than `false` for an absent field, because the caller must not settle a
 * run on a response that never answered the question.
 */
export function sessionStreamingFromSnapshot(
	snapshot: unknown,
): boolean | null {
	const payload = (snapshot as { payload?: unknown } | null | undefined)
		?.payload;
	const frontend = (payload as { frontend?: unknown } | null | undefined)
		?.frontend;
	if (!frontend || typeof frontend !== "object") return null;
	const direct = (frontend as { streaming?: unknown }).streaming;
	if (typeof direct === "boolean") return direct;
	const nested = (frontend as { snapshot?: { streaming?: unknown } }).snapshot
		?.streaming;
	return typeof nested === "boolean" ? nested : null;
}

export type ConfigRunHandle = {
	enabled: boolean;
	/** Why the composer is unavailable, when it is. */
	disabledReason: string | null;
	status: ReturnType<typeof useConfigRunStore.getState>["status"];
	sessionId: string | null;
	topic: string;
	error: string | null;
	about: RunTarget | null;
	setAbout: (about: RunTarget | null) => void;
	touched: RunTarget[];
	step: string | null;
	elapsed: string;
	/** Live activity, for the Watch panel (the run's own tool rows). */
	activity: {
		verb: string;
		target: RunTarget | null;
		/** Whether this call writes the registry rather than reading it. */
		writes: boolean;
		ts: number;
	}[];
	/** The settled summary. Empty until the run settles. */
	results: RunResult[];
	/** What the run answered, so the summary can show it (U3). */
	answer: string;
	/**
	 * A refused Stop, while the run is still live (UX review round 3, U1).
	 *
	 * THE STRIP CANNOT INFER THIS FROM `status`. A refusal leaves the run in
	 * exactly the state a successful press was about to change, so the only
	 * evidence is the reason the interrupt call gave.
	 */
	stopError: string | null;
	/**
	 * The run's own canonical snapshot, for the composer's readings (§3.3.3(b)).
	 *
	 * THE PICKERS STAY OFF because no `onCommand` is passed with it: each reading
	 * renders as a label carrying the shipped `COMMANDS_OFF` sentence, which is the
	 * honest state for a run whose model and effort the backend resolves. This is a
	 * new USE of an existing strip mode, not a new prop (Q6b).
	 */
	frontend: CanonicalSessionHandle["frontend"];
	start: (
		text: string,
		about: RunTarget | null,
		/** The composer's attachment paths, carried to the wire (§3.3.4). */
		attachments?: string[],
	) => Promise<boolean>;
	stop: () => Promise<void>;
	/** Re-send a request whose message call failed, on the run it already made. */
	retry: () => Promise<void>;
	/**
	 * Whether there is anything to re-send: the request never reached the run.
	 *
	 * DISTINCT FROM `sessionId`, deliberately (agent review round 2, M-new). The
	 * id survives every failure so the run stays nameable, so the strip asks this
	 * question rather than "is there a session" — otherwise Retry appears on a
	 * settle-read failure or a dropped transport, where the request was already
	 * delivered and pressing it would run it twice.
	 */
	canRetry: boolean;
	dismiss: () => void;
	starting: boolean;
	/** True once a run has been adopted from the single-flight refusal. */
	attached: boolean;
};

export function useConfigRun(): ConfigRunHandle {
	const capabilities = useDesktopCapabilities();
	const enabled = configRunEnabled(capabilities.data);
	const client = useQueryClient();
	const store = useConfigRunStore();
	const [starting, setStarting] = useState(false);
	const [attached, setAttached] = useState(false);
	const settleLatch = useRef(false);

	const live = store.status === "running" || store.status === "stopping";
	const stream = useCanonicalSessionStream(
		store.sessionId ?? undefined,
		Boolean(store.sessionId),
	);
	/*
	 * THE RUN'S CLOSING SENTENCE, captured while its transcript is still readable.
	 * `useCanonicalSessionStream` is torn down the moment the run settles (the
	 * store drops the id), so a summary that wants to show what the run ANSWERED
	 * has to take it now — and a run that changed nothing has nothing else to
	 * show (review round 1, U3: "the run answered without changing any agent or
	 * team" was a claim with no answer under it).
	 */
	const answer = useMemo(
		() => lastAssistantText(stream.transcript?.records),
		[stream.transcript?.records],
	);
	useDesktopWatchLease(store.sessionId ?? undefined, stream.subscriptionId);

	/**
	 * The run's tool rows, in order.
	 *
	 * Read from the run's own transcript rather than from a second subscription:
	 * the transcript is already the projected, deduplicated view of the same
	 * events, and a second reader of the same stream is how two surfaces come to
	 * disagree about what happened.
	 */
	/*
	 * THE LATEST TRANSCRIPT, HELD SO THE PROBE CAN READ IT WHEN IT FIRES.
	 *
	 * WHY A REF RATHER THAN A CLOSURE (perf audit, 2026-09-30): the probe effect
	 * below used to name `stream.transcript` in its dependency list, and a
	 * streaming run produces one transcript delta per flush — so every delta tore
	 * the timers down and re-armed them. That made the 400 ms first probe mean
	 * "400 ms after the LAST delta" and let `sessions.get` fire once per delta
	 * burst instead of on its cadence, on a page whose whole job is to leave the
	 * operator's own conversation alone.
	 *
	 * The probe's question is "has this run said something yet", which is a
	 * question about the LATEST transcript, not about the copy this render
	 * happened to close over — so the ref carries the latest value and the
	 * dependency list carries only the run's lifecycle. Semantics are unchanged:
	 * the probe still settles only when the server says nothing is running AND a
	 * closing sentence exists, and the latch still guards re-entry.
	 */
	const transcriptRecords = stream.transcript?.records;
	const transcriptRecordsRef = useRef(transcriptRecords);
	useEffect(() => {
		transcriptRecordsRef.current = transcriptRecords;
	}, [transcriptRecords]);

	const activity = useMemo(() => {
		const records = stream.transcript?.records ?? [];
		return records
			.filter(
				(record): record is (typeof records)[number] & RunToolRow =>
					record.kind === "tool" && RUN_TOOL_NAMES.has(record.toolName),
			)
			.map((record) => ({
				...projectRunToolRow({
					toolName: record.toolName,
					args: (record.args ?? null) as Record<string, unknown> | null,
					phase: record.phase,
					ts: record.ts,
					isError: record.isError,
					notRunReason: record.notRunReason,
					neverSent: record.neverSent,
				}),
				ts: record.ts,
			}));
	}, [stream.transcript]);

	// The touched set accumulates as the run WRITES, so the strip can name rows the
	// operator will see in the list before the run has finished writing them - and
	// so a definition the run only READ never reaches the settle-time diff, where
	// it would have been reported as an update that changed nothing.
	useEffect(() => {
		if (!live) return;
		for (const row of activity) {
			if (row.target && row.writes) store.noteTouched(row.target);
		}
	}, [activity, live, store]);

	const step =
		live && activity.length > 0 ? activity[activity.length - 1].verb : null;
	const elapsed = formatElapsed(useElapsed(store.startedAt, live));

	/**
	 * Settle: the turn ended, so take the catalogues and say what changed.
	 *
	 * THE READS ARE DIRECT AND NOT FROM THE CACHE. The point of this settle is to
	 * be true even when the `authoring` frame never arrives (a backend without the
	 * feed, a socket that slept), so the diff cannot be taken over a cache that
	 * the missing frame is exactly what would have refreshed. Two list reads are
	 * cheap and they are the ground truth the summary claims to describe.
	 */
	const settleRun = useCallback(
		async (status: "done" | "stopped", closing = "") => {
			/*
			 * THE LATCH IS SET BEFORE THE FIRST `await`, synchronously. It used to be
			 * set after the two list reads, while the effect that calls this re-fires
			 * on every stream change and on this callback's own identity — so a second
			 * frame during the reads started a second settle: a duplicate pair of list
			 * reads and a duplicate "Configuration run finished" toast (review round
			 * 1, m2).
			 */
			if (settleLatch.current) return;
			settleLatch.current = true;
			const before = store.before as CatalogueSnapshot | null;
			let results: RunResult[] = [];
			try {
				const [profiles, teams] = await Promise.all([
					desktopResult<{ profiles: ReusableProfile[] }>({
						op: "profiles.list",
					}),
					desktopResult<{ teams: ReusableTeam[] }>({ op: "teams.list" }),
				]);
				if (before) {
					results = diffCatalogue(
						before,
						snapshotCatalogue(profiles.profiles, teams.teams),
						store.touched,
					);
				}
			} catch {
				// A failed read does not change the run's outcome; the strip says the
				// result could not be read and offers the lists' own retry.
				useConfigRunStore
					.getState()
					.fail(
						"The run finished, but the agents and teams lists could not be read to describe what changed.",
					);
				// The lists may still be stale, so the invalidation still runs.
				invalidateAuthoring(client);
				return;
			}
			/*
			 * THE UNCONDITIONAL INVALIDATION, which is half the design (the frame is the
			 * other half): whatever the feed did or did not publish, a run that has
			 * settled means these reads are stale now.
			 */
			invalidateAuthoring(client);
			useConfigRunStore.getState().settle(results, status, closing);
			if (status === "done" && results.length > 0) {
				const created = results.filter((result) => result.created).length;
				showSuccessToast(
					created > 0
						? `Configuration run finished: ${results.length} definition${results.length === 1 ? "" : "s"} changed.`
						: `Configuration run finished: ${results.length} definition${results.length === 1 ? "" : "s"} updated.`,
				);
			}
			/*
			 * The callback's identity moves with the two facts it reads OUT of the run's
			 * own state (the pre-send snapshot and the touched set), which is what makes
			 * the effect below able to name it as a dependency without settling twice:
			 * the latch is what guards re-entry, and this list is what keeps the closure
			 * honest about which snapshot it is diffing against.
			 */
		},
		[client, store.before, store.touched],
	);

	useEffect(() => {
		if (!live) return;
		if (stream.failure) {
			useConfigRunStore.getState().fail(stream.failure.statement);
			return;
		}
		/*
		 * SETTLED MEANS: a turn has ENDED and none is running. `streaming` alone is
		 * not enough (a turn that has not started yet is not streaming either) and
		 * `turnsCompleted` alone is not enough (it counts completed rounds, and the
		 * operator can follow up in the same run), so both are required, and the
		 * latch keeps one settle from firing again on every re-render.
		 */
		if (settleLatch.current) return;
		if (!stream.frontend) return;
		if (stream.frontend.streaming) return;
		if (stream.turnsCompleted === 0) return;
		void settleRun(store.status === "stopping" ? "stopped" : "done", answer);
	}, [
		live,
		answer,
		stream.failure,
		stream.frontend,
		stream.turnsCompleted,
		store.status,
		settleRun,
	]);

	/*
	 * A RUN WHOSE TURN ENDED WHILE THIS PAGE WAS AWAY (QA round 1, Q2).
	 *
	 * The effect above settles on a TRANSITION — `streaming` true, then false,
	 * with a completed round counted — and a fresh mount never sees one: the
	 * count starts at zero for a new subscription, the journal replay is not a
	 * `turn_end`, and the store is module-scope, so the run stayed "Working on
	 * your request" (and Stop stayed "Stopping…") until a reload. It contradicts
	 * the one promise Scope B makes about leaving the page.
	 *
	 * THE RECOVERY ASKS THE SERVER RATHER THAN THE STREAM, because that is where
	 * the durable truth is: `sessions.get` reports whether a turn is running
	 * (`frontend.streaming`), and the transcript this hook already reads carries
	 * the finished answer. A run is over when the server says nothing is running
	 * AND the run has said something — the second half is what keeps a turn that
	 * has not started yet (not streaming, nothing said) from settling on arrival.
	 * The read is polled only while the run is live, and a read that fails leaves
	 * the live path to settle it as before.
	 */
	useEffect(() => {
		const sessionId = store.sessionId;
		if (!live || !sessionId) return;
		let cancelled = false;
		const probe = async () => {
			if (cancelled || settleLatch.current) return;
			try {
				const snapshot = await desktopResult<unknown>({
					op: "sessions.get",
					sessionId,
				});
				if (cancelled || settleLatch.current) return;
				if (sessionStreamingFromSnapshot(snapshot) !== false) return;
				// Read at fire time, and once: the two conditions below are about the
				// same snapshot of the transcript, and a delta arriving between them
				// must not make them disagree.
				const closing = lastAssistantText(transcriptRecordsRef.current);
				if (!closing) return;
				void settleRun(
					useConfigRunStore.getState().status === "stopping"
						? "stopped"
						: "done",
					closing,
				);
			} catch {
				// The live path still owns this run; a read that failed is not a verdict.
			}
		};
		const first = setTimeout(() => void probe(), 400);
		const poll = setInterval(() => void probe(), 4_000);
		return () => {
			cancelled = true;
			clearTimeout(first);
			clearInterval(poll);
		};
	}, [live, store.sessionId, settleRun]);

	/**
	 * Send one request into the run's own session.
	 *
	 * RETURNS WHAT THE COMPOSER NEEDS TO KNOW (`SendOutcome`): `false` means the
	 * request did not reach the run and the BOX MUST KEEP IT — the attacker's text
	 * and its attachment chips are the operator's until a send the backend took
	 * returns `true` (design note §3.3.1, the seam `use-message-input.ts:182-196`
	 * already answers; M2's "the draft is spent only by an accepted send" survives
	 * here rather than in a run-store call of its own: the text is the composer's,
	 * in `useConversationInputStore`, and this hook only reports whether the send
	 * landed).
	 *
	 * `attachments` ARE CARRIED END-TO-END (M2, §3.3.4): the composer hands over the
	 * same path/data-URL list the chat's send receives, they are encoded by the
	 * chat's own encoder, and the encoded images ride `sessions.message`. The one
	 * state the note forbids is the middle one — a control that collects a payload
	 * the send then drops — so a send whose images cannot be read is REFUSED before
	 * the session is created rather than sent without them.
	 */
	const start = async (
		text: string,
		about: RunTarget | null,
		attachments: string[] = [],
	): Promise<boolean> => {
		if (starting || !text.trim()) return false;
		setStarting(true);
		setAttached(false);
		settleLatch.current = false;
		const before = snapshotCatalogue(
			client.getQueryData<ReusableProfile[]>(["desktop", "profiles"]),
			client.getQueryData<ReusableTeam[]>(["desktop", "teams"]),
		);
		/*
		 * The context sentence is composed HERE rather than by the composer, so the
		 * one place that decides what the run is told is also the one place that
		 * knows which row it is about.
		 */
		const body = about
			? `About the ${about.kind} “${about.name}”: ${text.trim()}`
			: text.trim();
		/*
		 * THE ENCODE COMES FIRST, BEFORE ANY SESSION EXISTS. A refusal here must not
		 * leave a run behind: the file is not in the message the operator thinks they
		 * are sending, and their remedy is to fix the chips — which are still in the
		 * box, because this path returns `false` below.
		 */
		const { images, unreadable, overflow } = await encodeImageAttachments(
			attachments,
			body,
		);
		const attachmentRefusal = unreadableAttachmentRefusal(unreadable);
		if (attachmentRefusal) {
			/*
			 * `fail`, NOT `failUnsent`, and the difference is the remit: `failUnsent`
			 * renders a Retry, and a retry re-sends the SAME bytes — the one answer
			 * this refusal's sentence ("replace or remove it") rules out. The strip
			 * states the refusal; the box still holds the chips, which is where the
			 * remedy lives.
			 */
			useConfigRunStore.getState().fail(attachmentRefusal);
			return false;
		}
		const overflowRefusal = imageOverflowRefusal(overflow);
		if (overflowRefusal) {
			/*
			 * The same remit as the unreadable arm above: `fail`, not `failUnsent`,
			 * because a retry re-sends the same chips and meets the same refusal.
			 */
			useConfigRunStore.getState().fail(overflowRefusal);
			return false;
		}
		try {
			let sessionId: string;
			try {
				const created = await desktopResult<{ session_id: string }>({
					op: "sessions.create",
					requestId: crypto.randomUUID(),
					/*
					 * `purpose` and NO `cwd`: the backend resolves the run's working
					 * directory itself (see the field's own note in the contract) — the
					 * renderer would have to invent a path it cannot verify exists, and a
					 * guessed path is a directory the operator never named.
					 */
					purpose: "agents-config",
				});
				sessionId = created.session_id;
			} catch (caught) {
				const active = activeRunIdFromRefusal(caught);
				if (active) {
					/*
					 * ANOTHER RUN IS ALREADY GOING (a second window, or this page after a
					 * reload). Attach to it and KEEP the text: sending it would run a
					 * request twice, and the operator's draft is theirs until they
					 * choose — the strip says "Already running" and offers Stop.
					 */
					setAttached(true);
					/*
					 * `adopt` does NOT spend the draft, and this is the path the copy names:
					 * the strip says the request was not sent and is still in the box, so the
					 * text has to still be there (review round 1, M2 / QA Q5 — the code even
					 * said "KEEP the text" while clearing it).
					 */
					store.adopt(active, text.trim(), before, images);
					return false;
				}
				throw caught;
			}
			store.adopt(sessionId, body, before, images);
			/*
			 * The prompt is a SECOND call on the same session, exactly as the design's
			 * mechanism table states: create, then message. `startedAt` is the accepted
			 * create, so the elapsed clock starts where the work does.
			 */
			await sendMessage(sessionId, body, images);
			/*
			 * NOTHING IS CLEARED HERE, and that is the M2 rule rather than an
			 * omission: the box's text is spent by the composer's own store when the
			 * send it made is accepted (review round 1, M2). The run store's `draft`
			 * copy this used to empty was rendered by nothing, so it was removed in QA
			 * round 2 (Q1).
			 */
			return true;
		} catch (caught) {
			const sessionId = useConfigRunStore.getState().sessionId;
			/*
			 * `failUnsent`, not `fail`: THIS is the one failure a Retry may act on. The
			 * create landed and the prompt did not, so the request is genuinely still
			 * outstanding — every other failure path has already delivered it (agent
			 * review round 2, M-new).
			 */
			useConfigRunStore
				.getState()
				.failUnsent(
					userFacingMessage(
						caught,
						sessionId
							? "The run was set up, but your request could not be sent. It is still in the box — send it again when the backend is reachable."
							: "The configuration run could not be started. Your request is still here.",
					),
				);
			/*
			 * STILL THE OPERATOR'S TEXT. The create may have landed and the prompt may
			 * not, so the box keeps everything it sent — the composer restores a box it
			 * has not emptied (the seam's own "put the text back" answer).
			 */
			return false;
		} finally {
			setStarting(false);
		}
	};

	/**
	 * Send one prompt to the run's own session, and nothing else.
	 *
	 * Extracted so `retry` is the SAME call a first send makes rather than a
	 * second spelling of it: the design's idempotency rule is that a retry repeats
	 * the body byte-for-byte or answers 409 (`Prompt`, `desktop_sessions.py`), and
	 * a copy of the call that drifted by a character would be a different request.
	 */
	const sendMessage = async (
		sessionId: string,
		text: string,
		images: WireImage[] = [],
	) => {
		await desktopResult<{ ok?: boolean }>({
			op: "sessions.message",
			sessionId,
			requestId: crypto.randomUUID(),
			text,
			/*
			 * `images` ONLY WHEN THERE ARE ANY. The wire's `Prompt` bounds it at eight
			 * and the encoder has already applied that bound; an empty list is left off
			 * rather than sent, so a text-only request is byte-identical to the request
			 * this page made before attachments existed (the retry rule: the same body,
			 * or a 409).
			 */
			...(images.length > 0 ? { images } : {}),
		});
	};

	/**
	 * Retry a request whose MESSAGE call failed, on the run that was already made.
	 *
	 * The store keeps the session id through that failure precisely so this is
	 * possible: without it the run was orphaned — the backend held a live run the
	 * page could neither name, stop nor finish (review round 1, M2 / UX U10, whose
	 * error strip told the operator to send it again with no Retry and no text).
	 */
	const retry = async () => {
		const state = useConfigRunStore.getState();
		/*
		 * GATED ON `unsent`, not on the id being present (agent review round 2,
		 * M-new). The id survives every failure so the run stays nameable, so
		 * "there is a session" is not the same question as "the request still needs
		 * sending" — and answering the second with the first re-ran finished work.
		 */
		if (starting || !state.unsent || !state.sessionId || !state.topic) return;
		setStarting(true);
		try {
			await sendMessage(state.sessionId, state.topic, state.images);
			/*
			 * Back to live. `adopt` is the one door that sets `running`, and the run id
			 * and topic it needs are the ones already in hand — so the retry re-arms
			 * the same run rather than starting a rival.
			 */
			store.adopt(state.sessionId, state.topic, state.before);
			settleLatch.current = false;
		} catch (caught) {
			// Still unsent: the retry did not deliver it either, so it stays retryable.
			useConfigRunStore
				.getState()
				.failUnsent(
					userFacingMessage(
						caught,
						"The request could not be sent. It is still in the box.",
					),
				);
		} finally {
			setStarting(false);
		}
	};

	const stop = async () => {
		const sessionId = useConfigRunStore.getState().sessionId;
		if (!sessionId) return;
		store.stopping();
		try {
			await interruptTurn(sessionId, crypto.randomUUID());
		} catch (caught) {
			/*
			 * A REFUSED STOP DOES NOT END THE RUN (UX review round 3, U1).
			 *
			 * This used to go through `fail`, which renders the settled error shape:
			 * Stop and the elapsed time vanished, Dismiss was the only control, and
			 * the strip claimed the run had stopped while its turn ran on. The strip
			 * owns the sentence ("the stop did not take"); this carries only what the
			 * refusal said, so the two are not welded into one string and a silent
			 * refusal still gets a truthful line.
			 */
			useConfigRunStore
				.getState()
				.stopFailed(
					userFacingMessage(caught, "The run did not acknowledge the request."),
				);
		}
	};

	const disabledReason = enabled
		? null
		: capabilities.isLoading
			? "Connecting to the backend…"
			: capabilities.error
				? "The backend could not be reached, so the composer is unavailable for now."
				: "Ask for a change needs a newer backend. Update Local Operator to configure agents by conversation.";

	return {
		enabled,
		disabledReason,
		status: store.status,
		sessionId: store.sessionId,
		frontend: stream.frontend,
		topic: store.topic,
		error: store.error,
		stopError: store.stopError,
		about: store.about,
		setAbout: store.setAbout,
		touched: store.touched,
		results: store.results,
		answer: store.answer,
		step,
		elapsed,
		activity,
		start,
		stop,
		retry,
		canRetry: store.unsent && Boolean(store.sessionId),
		dismiss: store.dismiss,
		starting,
		attached,
	};
}
