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
 * THE MAP IS THE STORED BINDINGS. S2 shipped this predicate with an empty
 * chord-bindings map, so every send key was plain Enter resolving to the
 * default. S4 adds the three recorder rows (`keymap.send_*`) and fills the
 * map from the renderer's stored bindings; `sendChordBindings` is the one
 * builder, so all four Enter sites answer from the same stored chords.
 * Bindings are keyed by CANONICAL chord (`primary+enter`), the grammar
 * `chordFromEvent` returns, so the map is a direct lookup rather than a
 * translation.
 *
 * THE TYPE SEMANTICS. `steer` is the default mode's value and today's
 * behaviour, not a separate "mode field" the page invents: the page still
 * computes `mode: turnAlive ? "steer" : "prompt"` exactly as before, and
 * `delivery` rides the body only on top of a busy send (see
 * `resolveBusyDelivery`). An idle send ignores `delivery` entirely, so a chord
 * pressed while idle sends a normal prompt, exactly as Enter does today.
 */

import { chordFromEvent } from "@shared/keymap/chord-capture";
import { effectiveChord } from "@shared/keymap/keymap-chord";
import {
	SEND_ACTION_IDS as REGISTRY_SEND_IDS,
	SEND_MODES,
	type SendActionId,
	type ShortcutBindings,
} from "@shared/keymap/keymap-registry";

/** How a message sent while the session is busy reaches the running turn. */
export type DeliveryMode = "steer" | "queue" | "both";

/*
 * THE SEND IDS NAME THE BACKEND'S ROWS (D5). The registry's `SEND_ACTION_IDS`
 * are `composer.send_*`; the backend serves `keymap.send_*`; the chord is
 * stored per surface and never crosses — only the id string is shared, and
 * the tail of the shared id is the mode. The mode table below re-spells that
 * tail once, beside the predicate that answers it, rather than reaching
 * across the seam a second way.
 */
export const SEND_ACTION_IDS = REGISTRY_SEND_IDS;

/** Each send id's delivery mode: the id tail IS the mode (see above). */
export const SEND_MODE_BY_ID: Readonly<Record<SendActionId, DeliveryMode>> =
	SEND_MODES as Record<SendActionId, DeliveryMode>;

/**
 * The predicate's binding argument, built from the renderer's stored
 * `shortcutBindings` through the registry's effective-chord reader. The
 * effective chord keeps the sanitizer's decision (a hand-edited blob cannot arm
 * a chord capture would refuse), and the id's tail is the mode — so a stored
 * `primary+enter` on `composer.send_queue` answers `queue`, and an unbound
 * send row answers nothing.
 */
export function sendChordBindings(
	bindings: ShortcutBindings | undefined,
): SendChordBindings {
	const map = new Map<string, DeliveryMode>();
	for (const id of SEND_ACTION_IDS) {
		const chord = effectiveChord(id, bindings);
		const mode = SEND_MODE_BY_ID[id];
		if (mode === undefined) continue;
		/*
		 * `effectiveChord` reads the binding the sanitizer kept: a `null`
		 * (deliberate no-chord) and an absent row both answer nothing, so the
		 * bare lookup is the honest one — an unbound send row is simply absent
		 * from the map, and the press falls through to the default mode.
		 */
		if (chord !== null && !map.has(chord)) {
			map.set(chord, mode);
		}
	}
	return map;
}

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
 * selects. Built from the renderer's stored `keymap.send_*` bindings by
 * `sendChordBindings` above.
 */
export type SendChordBindings = ReadonlyMap<string, DeliveryMode>;

/**
 * An empty chord map: every press resolves through the default mode.
 * The test suite's "nothing bound" fixture; the live Enter sites pass the
 * bindings the settings rows stored instead.
 */
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
	 * Shift+Enter is the newline, never a send, even when a send chord names
	 * `primary+shift+enter`: the recorder refuses that spelling for every row
	 * (D7), so a binding that named it could only be a hand edit, and a hand
	 * edit must not turn the composer's newline into a send. The chord below
	 * is still spelled for the no-shift arm.
	 */
	if (event.key === "Enter" && event.shiftKey) return null;
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
