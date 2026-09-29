import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	Checkpoint,
	CheckpointManifest,
	CheckpointWarmAnswer,
	DesktopRequest,
} from "../../../../../shared/desktop-contract";
import { CHECKPOINT_WARM_MAX_IDS } from "../../../../../shared/desktop-contract";
import { checkpointPendingIds } from "./checkpoint-model";

/**
 * The checkpoint rail's data half: one manifest read, a bounded naming warm,
 * and the short poll that waits for requested names (design D2/D5/D10).
 *
 * ## What the three moving parts are for
 *
 * - The manifest is read once per conversation and re-read on demand; a cold
 *   or stale index answers `building` in well under a second (the scan runs in
 *   the backend's background), so the hook never waits on a scan and the rail
 *   paints ticks from whatever the last answer held.
 * - `warm` is the user gesture's spend — hover names one tick, the rail-open
 *   arm names the backend's default selection (the request omits `ids`/`limit`
 *   so the backend's own bound is the only copy of that number; sending a
 *   limit here would be a second copy that drifts). It is fire-and-forget: a
 *   failure is decoration lost, never a user-facing error (D2: "every failure
 *   resolves to None").
 * - The poll runs ONLY while something the reader asked for is still pending,
 *   at 1.5 s for ~45 s, and then the fallback text stands (D2's ceiling is
 *   about how long a card may say "Generating name…", not a retry policy).
 *
 * ## Degrading without the op
 *
 * The rail is pure decoration over a transcript that works without it: an
 * installed backend that predates `sessions.checkpoints` answers the 404/422
 * it answers for any unknown route, and this hook turns ANY initial load
 * failure into `state: "error"` — which renders nothing — plus ONE warn per
 * failure class per conversation (the manifest read and a naming warm fail
 * with different sentences because they are different facts, and the latch
 * is per sentence). Logging once matters: without the latch a poll would
 * repeat the same failure every 1.5 s. The op has no capability key of its
 * own, deliberately: a missing key and an old backend are the same fact to
 * this hook, and the hook already has that fact when the request fails.
 *
 * A failure AFTER a manifest exists is treated differently, and the difference
 * is what the reader is looking at: the last answer keeps painting and the
 * poll stops. Flipping to `error` there would blank a rail the reader is
 * using, and a poll failure is transient by construction.
 *
 * Wired where the transcript mounts it: `canonical-transcript.tsx` gives the
 * rail this hook's `checkpoints`/`building`, wires `onJump` to the jump
 * primitive (`reveal-record.ts`) and `onHover` to `warm` — one id per card
 * open, the intent delay having already filtered fly-overs.
 */

/** One poll interval and the ceiling a poll episode may not outlive (D2). */
export const CHECKPOINT_POLL_INTERVAL_MS = 1500;
export const CHECKPOINT_POLL_CEILING_MS = 45_000;

export type CheckpointsState = "idle" | "loading" | "ready" | "error";

export type UseCheckpointsResult = {
	state: CheckpointsState;
	/** The index is being (re)built from a previous answer; §D5's building. */
	building: boolean;
	checkpoints: Checkpoint[];
	/** Name the given checkpoints (or the backend's default selection). */
	warm: (ids?: string[]) => void;
	/** Re-read the manifest now (a poll calls the same path). */
	refresh: () => void;
};

/** A stable empty answer, so consumers memoising on `checkpoints` are calm. */
const NO_CHECKPOINTS: Checkpoint[] = [];

/** What one load may be: the first answer for a conversation, or a refresh. */
type LoadMode = "initial" | "refresh";

export function useCheckpoints(sessionId: string): UseCheckpointsResult {
	const [state, setState] = useState<CheckpointsState>("idle");
	const [manifest, setManifest] = useState<CheckpointManifest | null>(null);

	/*
	 * One counter is the whole session guard: every conversation takes the next
	 * epoch, every load captures it, and an answer whose epoch is stale is
	 * dropped rather than applied to a conversation it was not asked about —
	 * the same discipline `loadOlder` documents for a page that resolves into a
	 * transcript no longer on screen.
	 */
	const sessionRef = useRef(sessionId);
	const epochRef = useRef(0);
	const inFlightEpoch = useRef<number | null>(null);
	/** Ids a warm took ownership of and the manifest has not settled yet. */
	const pendingIds = useRef<Set<string>>(new Set());
	const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Stamped when a poll EPISODE is armed; cleared when it ends. */
	const pollDeadline = useRef<number | null>(null);
	/**
	 * Warn lines this conversation has already printed, keyed by message.
	 *
	 * A latch per SENTENCE rather than one boolean, because the two failures
	 * this hook can see are different facts: the manifest read failing hides
	 * the rail, while a warm failing costs only a decoration — and a single
	 * latch would either silence the second fact or let a poll repeat the
	 * first every 1.5 s.
	 */
	const loggedMessages = useRef(new Set<string>());

	const stopPoll = useCallback(() => {
		if (pollTimer.current !== null) {
			clearTimeout(pollTimer.current);
			pollTimer.current = null;
		}
		pollDeadline.current = null;
	}, []);

	const logOnce = useCallback((message: string, error: unknown) => {
		if (loggedMessages.current.has(message)) return;
		loggedMessages.current.add(message);
		console.warn(message, error);
	}, []);

	/*
	 * The load and the poll are mutually recursive by design: a load that finds
	 * pending ids schedules the poll, and the poll calls the load. They live
	 * behind refs so neither has to name the other in a dependency array — the
	 * pair cannot be ordered to satisfy both read-before-declare and a stable
	 * identity, and the ref assignment right after each definition keeps them
	 * current every render.
	 */
	const loadRef = useRef<(epoch: number, mode: LoadMode) => Promise<void>>(
		async () => {},
	);
	const schedulePollRef = useRef<(epoch: number) => void>(() => {});

	const load = useCallback(
		async (epoch: number, mode: LoadMode) => {
			// A load stamped for a conversation that is gone, or for an epoch
			// whose answer already landed, is not this one's to serve.
			if (epoch !== epochRef.current) return;
			if (inFlightEpoch.current === epoch) return;
			inFlightEpoch.current = epoch;
			try {
				const next = await desktopResult<CheckpointManifest>({
					op: "sessions.checkpoints",
					sessionId: sessionRef.current,
				});
				if (epoch !== epochRef.current) return;
				setManifest(next);
				setState("ready");
				if (pendingIds.current.size > 0) {
					pendingIds.current = new Set(
						checkpointPendingIds(next, pendingIds.current),
					);
				}
				if (pendingIds.current.size > 0) schedulePollRef.current(epoch);
			} catch (error) {
				if (epoch !== epochRef.current) return;
				logOnce(
					"checkpoints are unavailable for this conversation; the rail stays hidden:",
					error,
				);
				stopPoll();
				if (mode === "initial") {
					setManifest(null);
					setState("error");
				}
			} finally {
				if (inFlightEpoch.current === epoch) inFlightEpoch.current = null;
			}
		},
		[logOnce, stopPoll],
	);
	loadRef.current = load;

	/**
	 * Arm the next poll, if one is not already armed.
	 *
	 * The deadline belongs to the EPISODE, not the interval: it is stamped when
	 * the first poll of an episode is armed and survives the interval churn, so
	 * "~45 s" is 45 seconds of polling rather than 45 seconds per tick. When it
	 * passes, the pending set is emptied — the cards show their fallback text
	 * and a later gesture may ask again.
	 */
	const schedulePoll = useCallback((epoch: number) => {
		if (epoch !== epochRef.current) return;
		if (pollTimer.current !== null) return;
		const deadline =
			pollDeadline.current ?? Date.now() + CHECKPOINT_POLL_CEILING_MS;
		pollDeadline.current = deadline;
		pollTimer.current = setTimeout(() => {
			pollTimer.current = null;
			if (epoch !== epochRef.current) return;
			if (pendingIds.current.size === 0) {
				pollDeadline.current = null;
				return;
			}
			if (Date.now() >= deadline) {
				pendingIds.current = new Set();
				pollDeadline.current = null;
				return;
			}
			void loadRef.current(epoch, "refresh").then(() => {
				if (epoch !== epochRef.current) return;
				if (pendingIds.current.size > 0) schedulePollRef.current(epoch);
			});
		}, CHECKPOINT_POLL_INTERVAL_MS);
	}, []);
	schedulePollRef.current = schedulePoll;

	const refresh = useCallback(() => {
		if (!sessionRef.current) return;
		void load(epochRef.current, "refresh");
	}, [load]);

	/**
	 * Buy names for checkpoints, fire-and-forget (D2/D9).
	 *
	 * With ids: the hover gesture's arm, clamped to the wire's bound so a
	 * caller cannot earn a schema refusal with a count it computed itself.
	 * Without: the rail-open arm — both fields omitted, so the backend's own
	 * default selection applies. A failure is logged once per conversation and
	 * otherwise dropped: the tick still jumps, the card still shows its
	 * fallback text, and nothing about the transcript changes.
	 */
	const warm = useCallback(
		(ids?: string[]) => {
			const session = sessionRef.current;
			if (!session) return;
			const epoch = epochRef.current;
			const request: DesktopRequest =
				ids && ids.length > 0
					? {
							op: "sessions.checkpoints.warm",
							sessionId: session,
							ids: ids.slice(0, CHECKPOINT_WARM_MAX_IDS),
						}
					: { op: "sessions.checkpoints.warm", sessionId: session };
			void (async () => {
				try {
					const answer = await desktopResult<CheckpointWarmAnswer>(request);
					if (epoch !== epochRef.current) return;
					for (const id of answer.pending) pendingIds.current.add(id);
					if (pendingIds.current.size > 0) schedulePollRef.current(epoch);
				} catch (error) {
					if (epoch !== epochRef.current) return;
					logOnce(
						"checkpoint naming is unavailable; the cards keep their fallback text:",
						error,
					);
				}
			})();
		},
		[logOnce],
	);

	useEffect(() => {
		sessionRef.current = sessionId;
		epochRef.current += 1;
		const epoch = epochRef.current;
		inFlightEpoch.current = null;
		pendingIds.current = new Set();
		stopPoll();
		loggedMessages.current = new Set();
		setManifest(null);
		if (!sessionId) {
			setState("idle");
			return;
		}
		setState("loading");
		void load(epoch, "initial");
		return () => {
			/*
			 * A read in flight at unmount must not apply its answer or re-arm a
			 * poll episode (review round 1, M1: the cleanup stopped the loop but an
			 * in-flight manifest read resolving after unmount fell through its
			 * guard unchanged and the re-arm started a fresh episode for a
			 * conversation no longer on screen). Bumping the epoch is the latch
			 * every guard in this file already reads — `load`, `warm` and the
			 * poll's callback all stand down on `epoch !== epochRef.current` — so
			 * the same counter the effect installs at mount also releases the
			 * episode at unmount, and a session SWITCH still starts a fresh one
			 * (the next effect run bumps again).
			 */
			epochRef.current += 1;
			stopPoll();
		};
	}, [sessionId, load, stopPoll]);

	const building =
		manifest !== null &&
		(manifest.index.state === "building" || manifest.index.state === "stale");

	return {
		state,
		building,
		checkpoints: manifest?.checkpoints ?? NO_CHECKPOINTS,
		warm,
		refresh,
	};
}
