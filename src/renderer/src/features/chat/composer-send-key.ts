/**
 * The composer's send key, and which delivery mode it selects.
 *
 * WHY ONE PREDICATE. Four Enter sites in this tree decided "is this a send?"
 * with their own inline test — `message-input.tsx`'s credential capture, its
 * send-refused arm and its planner arm, and `use-message-input.ts`'s
 * `handleKeyDown`, which carried no IME test at all. The fourth is the defect
 * this module exists to close: a CJK/IME Enter that commits a composition
 * submitted the message mid-composition. One function now answers at all four
 * sites, so a fifth decision cannot drift from the other four again.
 *
 * WHAT IT RETURNS. `null` means "not a send key, do whatever today does with
 * this press" (insert a newline, walk history, nothing). A non-null result
 * means "this press sends", and its `delivery` names the mode the press
 * selects: a bound chord's mode, or `null` for plain Enter, which means "the
 * page's default mode" (the `delivery.busy_default` row, read at send time).
 * Plain Enter is never a chord — `chordFromEvent` cannot spell it — so the two
 * arms cannot both fire on it; the chord is checked first anyway, because a
 * MODIFIED Enter is both an Enter and (once S4 binds one) a chord, and the
 * chord's mode is the one the user asked for.
 *
 * THE EMPTY MAP. S2 ships this predicate with an empty chord-bindings map:
 * every send key is plain Enter and resolves to the default. S4 adds the three
 * recorder rows (`keymap.send_*`) and fills the map from the renderer's
 * stored bindings; this file does not change for that. Bindings are keyed by
 * CANONICAL chord (`primary+enter`), the grammar `chordFromEvent` returns, so
 * the map is a direct lookup rather than a translation.
 *
 * THE TYPE SEMANTICS. `steer` is the default mode's value and today's
 * behaviour, not a separate "mode field" the page invents: the page still
 * computes `mode: turnAlive ? "steer" : "prompt"` exactly as before, and
 * `delivery` rides the body only on top of a busy send (see
 * `resolveBusyDelivery`). An idle send ignores `delivery` entirely, so a chord
 * pressed while idle sends a normal prompt, exactly as Enter does today.
 */

import { chordFromEvent } from "@shared/keymap/chord-capture";

/** How a message sent while the session is busy reaches the running turn. */
export type DeliveryMode = "steer" | "queue" | "both";

/**
 * The one settings row this slice reads. The key is neutral between surfaces
 * by design (architect D1): the same row the TUI edits is the row the desktop
 * sends from.
 */
export const BUSY_DELIVERY_SETTING_KEY = "delivery.busy_default";

/** The capability key the busy-delivery wire field is gated on. */
export const BUSY_DELIVERY_FEATURE = "busy_delivery";

/**
 * The composer's chord bindings: canonical chord to the mode that chord
 * selects. Empty in S2 (see the module note); S4 fills it from the renderer's
 * stored `keymap.send_*` bindings.
 */
export type SendChordBindings = ReadonlyMap<string, DeliveryMode>;

/** The empty bindings S2 passes at every site. */
export const NO_SEND_CHORDS: SendChordBindings = new Map();

/**
 * What a composer key handler reads off a key event. Structural, so a test
 * can build one without a DOM; React's `KeyboardEvent` unwraps to it at
 * each call site (`nativeEvent.isComposing` beside the event's own flags).
 */
export type ComposerKeyEvent = {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	isComposing: boolean;
};

/**
 * A send key press, as the composer acts on it: the press sends, and
 * `delivery` is the mode the press selects — `null` when the press is plain
 * Enter and the page's default mode applies.
 */
export type SendKey = {
	delivery: DeliveryMode | null;
};

/**
 * Whether this press is a send key, and which mode it selects.
 *
 * `(Enter, no shift) OR chord match`, AND not composing — architect D10.
 * Shift+Enter is a newline, never a send, even when a chord names it; an IME
 * composition is never a send, on any arm. A modified Enter with no matching
 * binding still sends: it is an Enter with no shift, which is exactly the
 * behaviour the composer shipped before this predicate existed (today's
 * Ctrl/Cmd+Enter sends), so nothing about that press changes in S2.
 */
export function sendKeyOf(
	event: ComposerKeyEvent,
	bindings: SendChordBindings,
): SendKey | null {
	if (event.isComposing) return null;
	/*
	 * The chord the press spells, looked up once for both arms: a MODIFIED
	 * Enter is both an Enter and (once S4 binds one) a chord, and the chord's
	 * mode is the one the user asked for. `chordFromEvent` returns `null` for
	 * every chord it cannot spell, including bare Enter, so a plain press
	 * never takes the chord arm.
	 */
	const chord = chordFromEvent({
		key: event.key,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
	});
	const chordMode = chord === null ? undefined : bindings.get(chord);
	if (event.key === "Enter" && !event.shiftKey)
		return { delivery: chordMode ?? null };
	/* A chord need not BE Enter: the match is on the chord the press spells. */
	return chordMode === undefined ? null : { delivery: chordMode };
}

/**
 * The default mode for a send, read from the settings query's payload.
 *
 * The shared query (`desktopKeys.settings`) carries every registry row; this
 * is the one row a busy send resolves against. Unloaded, absent, or a value
 * the registry no longer binds all read `steer` — today's behaviour — so a
 * backend without the row can never turn a send into an unknown mode. The
 * valid set is spelled here rather than trusted from the wire: a hand-edited
 * value must degrade to `steer`, never to a body the backend refuses.
 */
export function busyDefaultFromSettings(
	settings: readonly { key: string; value: unknown }[] | undefined,
): DeliveryMode {
	const value = settings?.find(
		(row) => row.key === BUSY_DELIVERY_SETTING_KEY,
	)?.value;
	return value === "queue" || value === "both" ? value : "steer";
}

/**
 * The delivery value that rides the `sessions.message` body, or `undefined`
 * for the legacy body.
 *
 * Architect D11: `delivery` rides only when the session is busy
 * (`turnAlive`), the resolved mode is not `steer` (absent already means
 * steer), and the backend advertises `features.busy_delivery`. Anything else
 * sends the legacy body — an idle send ignores delivery entirely, and a
 * `steer` send needs no key. A resolved `queue`/`both` without the feature
 * is a REFUSAL, not a downgrade: the caller must not call this with it
 * falling back to `steer`, and `refuseBusyDelivery` is the notice for it.
 */
export function resolveBusyDelivery(input: {
	/** The press's chord mode, or `null` for plain Enter. */
	chordDelivery: DeliveryMode | null;
	/** The default mode from `delivery.busy_default` (see above). */
	defaultMode: DeliveryMode;
	/** Whether the session is busy (`turnAlive`). */
	busy: boolean;
	/** Whether `features.busy_delivery` is advertised. */
	busyDeliverySupported: boolean;
}): DeliveryMode | undefined {
	if (!input.busy) return undefined;
	const resolved = input.chordDelivery ?? input.defaultMode;
	if (resolved === "steer") return undefined;
	if (!input.busyDeliverySupported) return undefined;
	return resolved;
}

/**
 * Whether the resolved mode must be refused rather than sent.
 *
 * The D11 half `resolveBusyDelivery` deliberately does not fold in: a
 * busy send whose resolved mode is `queue`/`both` while the backend cannot
 * honour it is refused with the keyed notice and the draft kept — never sent
 * as steer, which would claim the user meant the mode the backend happens to
 * support. Idle sends and `steer` never refuse.
 */
export function mustRefuseBusyDelivery(input: {
	chordDelivery: DeliveryMode | null;
	defaultMode: DeliveryMode;
	busy: boolean;
	busyDeliverySupported: boolean;
}): boolean {
	if (!input.busy || input.busyDeliverySupported) return false;
	const resolved = input.chordDelivery ?? input.defaultMode;
	return resolved !== "steer";
}

/** The refusal's code, so the notice survives the machinery that retires lock answers. */
export const BUSY_DELIVERY_UNSUPPORTED_CODE = "busy_delivery_unsupported";
