/*
 * THE RENDERER'S MIRROR OF THE SERVER'S SETTINGS INTENTS - pure transitions.
 *
 * WHY THIS EXISTS. A model/effort/fast/cwd change used to live in the mounted
 * picker (`pendingModel` was `useState`, the cwd move a per-hook `Map`), so it
 * died with a conversation switch, blocked the next pick while the runtime was
 * busy, and retried only `runtime_busy`. Behind `features.settings_intents` the
 * SERVER owns the change: `POST .../settings-intents` writes it to disk and an
 * applier retries it against the runtime in the background, across a restart of
 * either process (design 2026-11-09 §2a-c). This module is what the renderer
 * holds of that: a NON-PERSISTED mirror, hydrated from `GET` at boot and on
 * every feed reconnect, updated by `POST` replies and `settings_intent` frames,
 * plus the one optimistic slot a pick paints before its reply lands.
 *
 * CONSTRAINTS every transition keeps (and `scripts/settings-intents-store.test.mjs`
 * pins):
 * - Keyed by session and kind. A value for ANOTHER session or kind is never
 *   touched (the rule `PendingMove`'s transitions in `move-session.ts` keep for
 *   the cwd chip, generalised to four kinds).
 * - LAST-WINS by `generation`. The server bumps it per pick; an older slot - a
 *   late POST reply, a frame from before the newest pick - never replaces a
 *   newer one. Within one generation `updated_at` orders the state walk.
 * - A LOCAL slot (painted before the POST answered) is only replaced by the
 *   server's slot for the SAME request, or by a strictly newer generation; a
 *   prune (`null`) or a hydrate that does not list it never erases it. That is
 *   what keeps a pick visible through the reply's round trip.
 * - Every transition returns the SAME object when nothing changed, so the
 *   store can skip a commit (the sidebar re-renders off this slice).
 *
 * Nothing here talks to the network or to React; the store
 * (`canonical-sessions-store.ts`) and the hooks (`use-settings-intents.ts`)
 * call these.
 */
import type {
	SettingsIntent,
	SettingsIntentError,
	SettingsIntentKind,
	SettingsIntentSlots,
	SettingsIntentState,
} from "../../../../shared/desktop-contract";

/** A mirrored slot; `local` marks a pick whose POST has not answered yet. */
export type MirroredIntent = SettingsIntent & { local?: true };

export type MirroredSlots = Partial<Record<SettingsIntentKind, MirroredIntent>>;

/** Every session's slots. Sessions with no slot are absent, not empty. */
export type SettingsIntentsMirror = Readonly<Record<string, MirroredSlots>>;

export const EMPTY_SETTINGS_INTENTS: SettingsIntentsMirror = Object.freeze({});

/** Fixed display/apply order, the server's (model+effort -> fast -> cwd). */
export const SETTINGS_INTENT_KINDS: readonly SettingsIntentKind[] = [
	"model",
	"effort",
	"fast",
	"cwd",
];

const IN_FLIGHT: ReadonlySet<SettingsIntentState> = new Set([
	"pending",
	"applying",
	"queued_next_step",
	"waiting_idle",
]);

/** Still being worked on by the server (or not yet sent): a chip is live. */
export function intentInFlight(intent: SettingsIntent | null | undefined) {
	return Boolean(intent && IN_FLIGHT.has(intent.state));
}

/**
 * Whether `incoming` (a server slot) should replace `held`.
 *
 * Generation first, because it is the server's own coalescing counter. A local
 * slot guessed its generation (`held + 1`), so a server slot with the same
 * number but a different request is ANOTHER client's pick that raced ours: ours
 * stays until its own reply says where it really landed.
 */
export function slotOutranks(
	incoming: SettingsIntent,
	held: MirroredIntent | undefined,
): boolean {
	if (!held) return true;
	if (incoming.request_id === held.request_id) {
		if (held.local) return true;
		return (
			incoming.generation > held.generation ||
			(incoming.generation === held.generation &&
				!updatedBefore(incoming, held))
		);
	}
	if (incoming.generation !== held.generation)
		return incoming.generation > held.generation;
	if (held.local) return false;
	return !updatedBefore(incoming, held);
}

function updatedBefore(a: SettingsIntent, b: SettingsIntent): boolean {
	if (!a.updated_at || !b.updated_at) return false;
	return Date.parse(a.updated_at) < Date.parse(b.updated_at);
}

/*
 * WHEN EACH MIRRORED SLOT WAS WRITTEN, as a local write sequence (code review
 * round 1, M1). A `GET` baseline is a snapshot taken when the request LEFT; a
 * frame or POST reply processed while it was in flight is newer than the
 * snapshot, so the baseline must not prune it just because the snapshot did
 * not list it yet. A counter rather than `updated_at`: the server's clock and
 * the renderer's need not agree, and only the ORDER of local writes matters.
 * A `WeakMap` keyed by the (immutable) slot object, so the mark rides the
 * exact object the mirror holds, vanishes with it, and never appears in the
 * slot's own fields (tests and `sameSlot` compare those).
 */
let writeSeq = 0;
const writtenAt = new WeakMap<MirroredIntent, number>();

function markWritten<T extends MirroredIntent>(intent: T): T {
	writtenAt.set(intent, ++writeSeq);
	return intent;
}

/**
 * The current write mark. Take it before a `GET` leaves and hand it to
 * `hydrateIntents`: any slot written after it survives that baseline's prune.
 */
export function intentWriteMark(): number {
	return writeSeq;
}

function sameSlot(a: SettingsIntent, b: SettingsIntent): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function withSlots(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	slots: MirroredSlots,
): SettingsIntentsMirror {
	const next = { ...mirror };
	if (Object.keys(slots).length === 0) delete next[sessionId];
	else next[sessionId] = slots;
	return next;
}

/**
 * One slot moved (a `settings_intent` frame, or one slot of a reply).
 * `intent: null` is a prune: it removes a server slot but never a local pick.
 */
export function applyIntentFrame(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	kind: SettingsIntentKind,
	intent: SettingsIntent | null,
): SettingsIntentsMirror {
	const slots = mirror[sessionId] ?? {};
	const held = slots[kind];
	if (intent === null) {
		if (!held || held.local) return mirror;
		const { [kind]: _pruned, ...rest } = slots;
		return withSlots(mirror, sessionId, rest);
	}
	if (intent.kind !== kind || !slotOutranks(intent, held)) return mirror;
	// The same slot delivered again - every mounted feed hook receives each
	// frame, and a POST reply repeats what a frame already said - is a no-op, so
	// the store can skip the commit and the sidebar does not re-render.
	if (held && !held.local && sameSlot(intent, held)) return mirror;
	return withSlots(mirror, sessionId, {
		...slots,
		[kind]: markWritten(intent),
	});
}

/**
 * A session's full slot set from the server. With `pruneUpTo` (a `GET`
 * baseline's write mark), kinds the server no longer lists are pruned unless
 * they are an unanswered local pick or were written after the mark. Without
 * it (a POST reply) nothing is pruned: a reply taken before another kind's
 * newer pick reached the server, but processed after it, would otherwise
 * delete that newer slot (code review round 1, M1). Listed slots still go
 * through `applyIntentFrame`'s last-wins guard, so an older listed slot
 * never replaces a newer held one either way; removals are left to frames
 * and the next baseline.
 */
export function applySessionSlots(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	server: SettingsIntentSlots,
	pruneUpTo?: number,
): SettingsIntentsMirror {
	let next = mirror;
	for (const kind of SETTINGS_INTENT_KINDS) {
		const listed = server[kind];
		if (listed) {
			next = applyIntentFrame(next, sessionId, kind, listed);
			continue;
		}
		if (pruneUpTo === undefined) continue;
		const held = next[sessionId]?.[kind];
		if (held && (writtenAt.get(held) ?? 0) > pruneUpTo) continue;
		next = applyIntentFrame(next, sessionId, kind, null);
	}
	return next;
}

/**
 * The `GET /v1/desktop/settings-intents` baseline. `scope` names the one
 * session a `?session_id=` read covered; without it every session the mirror
 * holds is reconciled, so a slot pruned during a feed outage goes too.
 * `mark` is `intentWriteMark()` taken when the request left; omitted, the
 * snapshot is treated as current (every unlisted server slot is pruned).
 */
export function hydrateIntents(
	mirror: SettingsIntentsMirror,
	listed: Record<string, SettingsIntentSlots>,
	scope?: string,
	mark: number = Number.POSITIVE_INFINITY,
): SettingsIntentsMirror {
	const sessions = scope
		? [scope]
		: [...new Set([...Object.keys(mirror), ...Object.keys(listed)])];
	let next = mirror;
	for (const sessionId of sessions) {
		next = applySessionSlots(next, sessionId, listed[sessionId] ?? {}, mark);
	}
	return next;
}

/**
 * The optimistic paint, made before the POST leaves: the chip and the band show
 * the new value at once, and the generation guess makes any older reply lose.
 */
export function paintIntent(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	pick: {
		kind: SettingsIntentKind;
		value: string | boolean;
		requestId: string;
		effort?: string;
	},
	now: number = Date.now(),
): SettingsIntentsMirror {
	const slots = mirror[sessionId] ?? {};
	const held = slots[pick.kind];
	const stamp = new Date(now).toISOString();
	const intent: MirroredIntent = {
		kind: pick.kind,
		value: pick.value,
		effort: pick.effort ?? null,
		request_id: pick.requestId,
		generation: (held?.generation ?? 0) + 1,
		base: held?.base ?? null,
		state: "pending",
		attempts: 0,
		created_at: stamp,
		updated_at: stamp,
		error: null,
		local: true,
	};
	return withSlots(mirror, sessionId, { ...slots, [pick.kind]: intent });
}

/**
 * The POST itself failed (a 422 refusal, a 404, or no answer at all). Keyed by
 * request id, so a failure of a pick the user has since replaced does nothing.
 * The slot stays, `failed`, so the chip can offer Retry; it is still `local`
 * because the server never stored it.
 */
export function failLocalIntent(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	kind: SettingsIntentKind,
	requestId: string,
	error: SettingsIntentError,
	now: number = Date.now(),
): SettingsIntentsMirror {
	const slots = mirror[sessionId];
	const held = slots?.[kind];
	if (!slots || !held || held.request_id !== requestId) return mirror;
	return withSlots(mirror, sessionId, {
		...slots,
		[kind]: {
			...held,
			state: "failed",
			error,
			updated_at: new Date(now).toISOString(),
		},
	});
}

/**
 * Drop a slot the user dismissed (or cancelled). Keyed by generation for the
 * same reason the DELETE route is: a newer pick that replaced the slot under
 * the user's click is not what they dismissed.
 */
export function removeIntent(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	kind: SettingsIntentKind,
	generation: number,
): SettingsIntentsMirror {
	const slots = mirror[sessionId];
	const held = slots?.[kind];
	if (!slots || !held || held.generation !== generation) return mirror;
	const { [kind]: _removed, ...rest } = slots;
	return withSlots(mirror, sessionId, rest);
}

/**
 * What the band paints in place of the frame while a change is on its way:
 * the TARGET value while the slot is pending/applying/queued. `waiting_idle`
 * (cwd) and terminal states paint nothing - the old value is still in force.
 */
export function intentOverride(slots: MirroredSlots | undefined): {
	model: string | null;
	effort: string | null;
	fast: boolean | null;
	cwd: string | null;
} {
	const live = (kind: SettingsIntentKind) => {
		const slot = slots?.[kind];
		return slot &&
			(slot.state === "pending" ||
				slot.state === "applying" ||
				slot.state === "queued_next_step")
			? slot
			: null;
	};
	const model = live("model");
	const effort = live("effort");
	const fast = live("fast");
	const cwd = live("cwd");
	return {
		model: typeof model?.value === "string" ? model.value : null,
		effort:
			typeof effort?.value === "string"
				? effort.value
				: typeof model?.effort === "string" && model.effort
					? model.effort
					: null,
		fast: typeof fast?.value === "boolean" ? fast.value : null,
		cwd: typeof cwd?.value === "string" ? cwd.value : null,
	};
}

/** The sidebar row's dot: a warning beats a spinner; nothing when idle. */
export function intentIndicator(
	slots: MirroredSlots | undefined,
): "failed" | "applying" | null {
	if (!slots) return null;
	let applying = false;
	for (const kind of SETTINGS_INTENT_KINDS) {
		const slot = slots[kind];
		if (slot?.state === "failed") return "failed";
		if (intentInFlight(slot)) applying = true;
	}
	return applying ? "applying" : null;
}

/**
 * The ONE slot the sidebar dot speaks for: the first failed one, else the
 * first in flight, in kind order (the same precedence as `intentIndicator`).
 * Returned by reference from the mirror, so a store selector over it
 * re-renders a row only when that slot moves. Its chip sentence becomes the
 * dot's tooltip (UX U4): "Couldn't switch to X: <reason>" tells a user who
 * moved on which change failed, where "A settings change failed" did not.
 */
export function indicatorIntent(
	slots: MirroredSlots | undefined,
): MirroredIntent | null {
	if (!slots) return null;
	let live: MirroredIntent | null = null;
	for (const kind of SETTINGS_INTENT_KINDS) {
		const slot = slots[kind];
		if (slot?.state === "failed") return slot;
		if (!live && slot && intentInFlight(slot)) live = slot;
	}
	return live;
}

/** The slots a chip renders for, in the fixed kind order. */
export function chipIntents(
	slots: MirroredSlots | undefined,
): MirroredIntent[] {
	if (!slots) return [];
	const out: MirroredIntent[] = [];
	for (const kind of SETTINGS_INTENT_KINDS) {
		const slot = slots[kind];
		if (slot && (intentInFlight(slot) || slot.state === "failed"))
			out.push(slot);
	}
	return out;
}

/**
 * Classify a failed POST into the slot's error shape. A transport failure (no
 * status) is retryable - the server never saw the pick; a 4xx refusal is not.
 */
export function submitFailure(error: {
	status?: number | null;
	code?: string;
	message?: string;
}): SettingsIntentError {
	const status = error.status ?? null;
	return {
		code: error.code ?? (status === null ? "runtime_unreachable" : "refused"),
		message: error.message ?? "",
		retryable: status === null || status >= 500,
	};
}

/**
 * The directories a cwd slot newly reached `applied` with, between two mirror
 * states (code review round 1, M2). The old move path added a directory to the
 * recents menu when its receipt settled; under the capability the move lands
 * in the background, so the app-root sync watches the mirror for the moment a
 * cwd slot turns `applied` and records the SERVER's absolute path then. Pure,
 * so the same slot seen twice (a frame, then a baseline) yields it once.
 */
export function newlyAppliedCwds(
	prev: SettingsIntentsMirror,
	next: SettingsIntentsMirror,
): string[] {
	if (prev === next) return [];
	const out: string[] = [];
	for (const [sessionId, slots] of Object.entries(next)) {
		const slot = slots.cwd;
		if (slot?.state !== "applied" || typeof slot.value !== "string") continue;
		const before = prev[sessionId]?.cwd;
		if (before?.state === "applied" && before.request_id === slot.request_id)
			continue;
		out.push(slot.value);
	}
	return out;
}

/**
 * Whether dismissing this slot must also reach the server (code review round
 * 1, M3). A server-held slot is DELETEd by generation. A LOCAL slot whose POST
 * failed retryably (5xx, or no answer) is ambiguous: the server may have
 * stored the pick before the failure, and then it would keep applying a change
 * the user dismissed and its frames would bring the chip back. Only a local
 * slot the server definitely refused (4xx) is safe to drop locally.
 */
export function dismissReachesServer(intent: MirroredIntent): boolean {
	if (!intent.local) return true;
	return intent.state === "failed" && intent.error?.retryable === true;
}

/*
 * Request ids whose SUPERSEDED transcript note was already written (code
 * review round 1, N1). Module-level, not a pane ref: a superseded slot can
 * still be in the mirror when the pane remounts (the user switched
 * conversations before the prune frame), and a per-instance set wrote the
 * note again. It grows by one id per superseded pick - a pick another surface
 * overtook - so it stays small for a renderer's lifetime without a cap.
 */
const notedSuperseded = new Set<string>();

/** True the first time a superseded request id is seen; false on repeats. */
export function noteSupersededOnce(requestId: string): boolean {
	if (notedSuperseded.has(requestId)) return false;
	notedSuperseded.add(requestId);
	return true;
}
