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
	return withSlots(mirror, sessionId, { ...slots, [kind]: intent });
}

/**
 * A session's full slot set from the server (a POST reply's `intents`, or one
 * session of a `GET`). Kinds the server no longer lists are pruned unless they
 * are an unanswered local pick.
 */
export function applySessionSlots(
	mirror: SettingsIntentsMirror,
	sessionId: string,
	server: SettingsIntentSlots,
): SettingsIntentsMirror {
	let next = mirror;
	for (const kind of SETTINGS_INTENT_KINDS) {
		next = applyIntentFrame(next, sessionId, kind, server[kind] ?? null);
	}
	return next;
}

/**
 * The `GET /v1/desktop/settings-intents` baseline. `scope` names the one
 * session a `?session_id=` read covered; without it every session the mirror
 * holds is reconciled, so a slot pruned during a feed outage goes too.
 */
export function hydrateIntents(
	mirror: SettingsIntentsMirror,
	listed: Record<string, SettingsIntentSlots>,
	scope?: string,
): SettingsIntentsMirror {
	const sessions = scope
		? [scope]
		: [...new Set([...Object.keys(mirror), ...Object.keys(listed)])];
	let next = mirror;
	for (const sessionId of sessions) {
		next = applySessionSlots(next, sessionId, listed[sessionId] ?? {});
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
