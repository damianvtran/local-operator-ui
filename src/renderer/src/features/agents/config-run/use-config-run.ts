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
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
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
		(desktopFeatureEnabled(capabilities, "profile_catalogue") ||
			desktopFeatureEnabled(capabilities, "team_catalogue"))
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
 * only shows the elapsed time.
 */
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

export type ConfigRunHandle = {
	enabled: boolean;
	/** Why the composer is unavailable, when it is. */
	disabledReason: string | null;
	status: ReturnType<typeof useConfigRunStore.getState>["status"];
	sessionId: string | null;
	topic: string;
	error: string | null;
	draft: string;
	setDraft: (draft: string) => void;
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
	start: (text: string, about: RunTarget | null) => Promise<void>;
	stop: () => Promise<void>;
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
	useDesktopWatchLease(store.sessionId ?? undefined, stream.subscriptionId);

	/**
	 * The run's tool rows, in order.
	 *
	 * Read from the run's own transcript rather than from a second subscription:
	 * the transcript is already the projected, deduplicated view of the same
	 * events, and a second reader of the same stream is how two surfaces come to
	 * disagree about what happened.
	 */
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
		async (status: "done" | "stopped") => {
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
			useConfigRunStore.getState().settle(results, status);
			settleLatch.current = true;
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
		void settleRun(store.status === "stopping" ? "stopped" : "done");
	}, [
		live,
		stream.failure,
		stream.frontend,
		stream.turnsCompleted,
		store.status,
		settleRun,
	]);

	const start = async (text: string, about: RunTarget | null) => {
		if (starting || !text.trim()) return;
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
					store.adopt(active, text.trim(), before);
					return;
				}
				throw caught;
			}
			store.adopt(sessionId, body, before);
			/*
			 * The prompt is a SECOND call on the same session, exactly as the design's
			 * mechanism table states: create, then message. `startedAt` is the accepted
			 * create, so the elapsed clock starts where the work does.
			 */
			await desktopResult<{ ok?: boolean }>({
				op: "sessions.message",
				sessionId,
				requestId: crypto.randomUUID(),
				text: body,
			});
		} catch (caught) {
			useConfigRunStore
				.getState()
				.fail(
					userFacingMessage(
						caught,
						"The configuration run could not be started. Your request is still here.",
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
			useConfigRunStore
				.getState()
				.fail(
					userFacingMessage(
						caught,
						"The configuration run could not be stopped.",
					),
				);
		}
	};

	const disabledReason = enabled
		? null
		: capabilities.isLoading
			? "Connecting to the backend…"
			: "Ask for a change needs a newer backend. Update Local Operator to configure agents by conversation.";

	return {
		enabled,
		disabledReason,
		status: store.status,
		sessionId: store.sessionId,
		topic: store.topic,
		error: store.error,
		draft: store.draft,
		setDraft: store.setDraft,
		about: store.about,
		setAbout: store.setAbout,
		touched: store.touched,
		results: store.results,
		step,
		elapsed,
		activity,
		start,
		stop,
		dismiss: store.dismiss,
		starting,
		attached,
	};
}
