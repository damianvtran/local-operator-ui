/**
 * The display flags the transcript must already know when it paints its first
 * contentful commit, and the window-local seed that lets it.
 *
 * WHY THIS EXISTS. Row visibility (`display.hide_cross_session`) and the elected
 * answer's rail (`display.turn_answer_rail`) both hang off the BACKEND settings
 * registry, and that read used to start when the transcript mounted — the same
 * moment as the history page, against rows a snapshot had already begun to
 * paint. Two flickers followed from that, both of them the class this project
 * exists to remove (first-paint audit, F10):
 *
 * - with `hide_cross_session` on, a peer receipt or a `send` row painted with
 *   the page and was REMOVED a commit later, once the answer landed;
 * - with `turn_answer_rail` on, the answer row's mark appeared late — and it
 *   moves that row's own box (`-ml-[13px] border-l pl-3`), so the late
 *   resolution was a layout change under the reader, not just chrome.
 *
 * THE SEED IS THE LAST ANSWER, KEPT. Every answer to `settings.list` this
 * window sees writes the flags below to `localStorage`, and the next window
 * reads them synchronously — so the first render already knows what the
 * operator set, rather than discovering it a round trip after the rows.
 *
 * WHAT THE SEED IS NOT. It is not a second source of truth: an answer always
 * outranks it (`readFlagValue` is asked first, and only an unresolved read
 * falls back). It is not consulted at all on a plane that does not advertise
 * `settings`, because a backend that predates the key has no opinion the seed
 * could honestly stand in for (the frozen fail-closed rule: nothing is hidden).
 * And it is not a cache of the whole registry: only the keys the transcript
 * reads are persisted, which is kilobytes rather than the ~106 KB payload the
 * registry itself ships.
 *
 * SWITCHING BACKENDS IS THE ONE SKEW IT CANNOT SEE. The settings query is keyed
 * `["desktop", "settings"]` with no backend dimension, so a seed written
 * against one daemon is read against whatever daemon this window is paired to
 * next. The value is a display preference, the window it is wrong for is one
 * render, and the alternative — a backend identity the registry does not carry
 * — would be a second identity to keep true. Recorded rather than solved.
 */

import { TURN_ANSWER_RAIL_KEY } from "./turn-answer-rail";

/**
 * Where the seed lives, in the app's own layout-choice key style
 * (`projects-view`, `chat-sidebar-disclosures`).
 *
 * A PLAIN NAME, NOT A VERSIONED ONE, and the shape is why: the store is a flat
 * `{registryKey: value}` map, so a later window reading an older key set simply
 * finds nothing under the keys it asks about — the fail-closed direction —
 * rather than having to migrate a shape it has never seen.
 */
export const DISPLAY_SEED_STORAGE_KEY = "display-settings";

/** The registry key that hides cross-session traffic; spelled once, here. */
export const HIDE_CROSS_SESSION_KEY = "display.hide_cross_session";

/**
 * The keys this seed persists, and therefore the only values it may serve.
 *
 * A LIST rather than "persist whatever the payload held", for two reasons that
 * point the same way: the registry row set grows with the backend (a persisted
 * copy would drift into a second, silently stale settings store), and this file
 * sits on the transcript's first render, so what it reads should be exactly
 * what the transcript's own flags need.
 */
export const DISPLAY_SEEDED_KEYS: readonly string[] = [
	HIDE_CROSS_SESSION_KEY,
	TURN_ANSWER_RAIL_KEY,
];

/** The persisted flags: registry key -> the value last seen for it. */
export type DisplaySeed = Readonly<Record<string, unknown>>;

/**
 * What a display flag reads as, for the surfaces that paint before its answer.
 *
 * - `on` / `off` are answers (an answer, the seed standing in for one).
 * - `pending` is the ONE state the seed alone cannot settle: the flag was last
 *   known TRUE and the answer that could contradict it has not arrived. It is
 *   the state the transcript holds its records in, because painting a row the
 *   last known setting says is hidden and then removing it is the flicker this
 *   file exists to remove. It is never produced from a last-known FALSE: an
 *   operator who has the option off pays nothing for the answer.
 */
export type DisplayFlagReading = "on" | "off" | "pending";

/** A registry row, as much of it as this module reads. */
type SettingRow = { key: string; value?: unknown };

/**
 * The seed, read synchronously and defensively.
 *
 * A missing store, a locked store, a value another build wrote: every one of
 * them resolves to "no seed", which is the direction that paints everything.
 * The same guarded read `readBoardWindow` and `readProjectsView` apply, for the
 * same reason — this runs inside a first render, where a throw is a blank pane.
 */
export function readDisplaySeed(): DisplaySeed {
	try {
		const raw = localStorage.getItem(DISPLAY_SEED_STORAGE_KEY);
		if (raw === null) return {};
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object") return {};
		const seed: Record<string, unknown> = {};
		for (const key of DISPLAY_SEEDED_KEYS) {
			/*
			 * `hasOwnProperty.call` rather than `Object.hasOwn`: the renderer's lib
			 * target predates ES2022 (TS2550), and OWN rather than `in` so a value
			 * another build wrote under a prototype key cannot be read as ours.
			 */
			if (Object.prototype.hasOwnProperty.call(parsed, key)) {
				seed[key] = (parsed as Record<string, unknown>)[key];
			}
		}
		return seed;
	} catch {
		/* No store, or a value that is not ours: the honest answer is "none". */
		return {};
	}
}

/**
 * Persist the flags from a `settings.list` answer.
 *
 * Called for EVERY answer (the write is idempotent), so whichever surface
 * caused the read — this transcript's own query, the Settings page's, a save
 * that refetched — the seed follows. A write that fails changes nothing: the
 * window keeps working from the answer it already has, and only the NEXT
 * window's first render loses the head start.
 */
export function writeDisplaySeed(
	settings: ReadonlyArray<SettingRow> | null | undefined,
): void {
	if (!settings) return;
	try {
		const seed: Record<string, unknown> = {};
		for (const key of DISPLAY_SEEDED_KEYS) {
			const row = settings.find((entry) => entry.key === key);
			/*
			 * `undefined` is written as a MISSING key rather than as null: the
			 * reading rule below is `=== true`, so an absent key and a null one
			 * resolve the same way, and keeping the store's shape to what the
			 * backend actually stated makes it readable by hand.
			 */
			if (row) seed[key] = row.value ?? null;
		}
		localStorage.setItem(DISPLAY_SEED_STORAGE_KEY, JSON.stringify(seed));
	} catch {
		/* Storage unavailable: the seed is an optimisation, never a requirement. */
	}
}

/**
 * The value one key reads as in a `settings.list` payload, or undefined when the
 * payload does not carry that key at all.
 *
 * A strict `=== true` comparison rather than a truthiness cast, exactly as the
 * hooks read it before this module existed: `value` is `unknown` on the wire,
 * and only the boolean `true` a flag registers may hide a row or draw a rail —
 * any other value is a backend this app does not understand, and the safe
 * reading of that is "show everything".
 */
export function readFlagValue(
	settings: ReadonlyArray<SettingRow> | null | undefined,
	key: string,
): boolean | undefined {
	const row = settings?.find((entry) => entry.key === key);
	if (!row) return undefined;
	return row.value === true;
}

/** The seed's own answer to the same question, or undefined when it is silent. */
export function seededFlag(
	seed: DisplaySeed,
	key: string,
): boolean | undefined {
	if (!Object.prototype.hasOwnProperty.call(seed, key)) return undefined;
	return seed[key] === true;
}

/**
 * Resolve one flag for a surface that is about to paint.
 *
 * The order is the whole rule, and each step is a different question:
 *
 * 1. `available === false` — the plane does not advertise `settings`, so there
 *    is no answer to wait for and the seed has nothing to stand in for. Off
 *    (fail-closed; the contract every reader of these keys already states).
 * 2. an answer exists — it wins, in both directions. This is what makes the
 *    seed a head start rather than a second truth.
 * 3. no answer, and one is still owed, and the seed says ON — `pending`: the
 *    caller may withhold what the flag governs for this window, because
 *    painting it and taking it back is the flicker being removed.
 * 4. otherwise — the seed's own value, or off. An owed answer for a flag that
 *    was last known OFF is NOT pending: that operator paints now and, if the
 *    far side has changed the value since, follows it in one later commit.
 */
export function displayFlagReading(input: {
	/** The answer's value, or undefined while no answer is in hand. */
	answer: boolean | undefined;
	/** The persisted last-known value, or undefined when nothing was seeded. */
	seed: boolean | undefined;
	/** True while this plane owes an answer that could still arrive. */
	owed: boolean;
}): DisplayFlagReading {
	if (input.answer !== undefined) return input.answer ? "on" : "off";
	if (input.owed && input.seed === true) return "pending";
	return input.seed === true ? "on" : "off";
}
