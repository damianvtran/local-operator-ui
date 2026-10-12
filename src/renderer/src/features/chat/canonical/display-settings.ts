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
 * SWITCHING BACKENDS IS THE ONE SKEW IT CANNOT SEE, and the review's R4 is
 * right that "one render" was optimistic for the FILTER (agent review round 1,
 * R4). The settings query is keyed `["desktop", "settings"]` with no backend
 * dimension, so a seed written against one daemon is read against whatever
 * daemon this window is paired to next — and the window it is wrong for lasts
 * until an answer lands, which for a failing read is the query's own retry
 * window, not a frame.
 *
 * WHAT BOUNDS IT NOW, and why not a key: the two answers that say anything
 * truthful about this window's backend both drop the seed outright — a plane
 * that ANSWERS `denied`, and a plane that cannot be asked at all (`failed`) —
 * and any successful registry read replaces it with the answer, in both
 * directions. What does NOT drop it is a read that FAILS: a failed read resolves
 * to the seed's own reading, exactly as a spent hold budget does, because the
 * alternative (treating a failure as "show everything") re-opens the very class
 * this lane removes — the rows appear, and a later successful read removes them
 * again. That leaves a re-pair to a backend whose registry read keeps failing as
 * the one window this memory is wrong for, and the review's R4 is right to name
 * it; the window is bounded by whichever of those two plane answers comes first,
 * and it is not bounded by a clock, because the memory is meant to outlive opens.
 * The alternative (keying the memory) has nothing truthful to key on: the wire's
 * only backend-shaped field is `desktop_contract`, a VERSION, which two daemons
 * can share and one daemon changes on upgrade — an identity that is neither
 * unique nor stable is worse than a recorded bound. Recorded, and bounded by
 * the plane's own answers, rather than keyed.
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
 * - `on` / `off` are answers (an answer, or the seed standing in for one).
 * - `pending` is the ONE state the seed alone cannot settle: the flag was last
 *   known TRUE and the answer that could contradict it has not arrived. It is
 *   the state the transcript holds its records in, because painting a row the
 *   last known setting says is hidden and then removing it is the flicker this
 *   file exists to remove. It is never produced from a last-known FALSE: an
 *   operator who has the option off pays nothing for the answer.
 *
 * `pending` HAS A BUDGET (`DISPLAY_HOLD_BUDGET_MS`) and the rule below takes the
 * fact that it is spent: an answer that never arrives must not leave the pane
 * withheld forever, and the seed's own reading is the safe way out — see
 * `displayFlagReading`.
 */
export type DisplayFlagReading = "on" | "off" | "pending";

/**
 * How long the `pending` hold may last before the seed's own reading paints.
 *
 * WHAT BOUNDS IT, MEASURED. The registry read answers in 8-16 ms on a quiet host
 * and answered in 103 ms in the worst pass of this lane's own bench (host load
 * 200, 100-row registry), and the page it is racing lands 90-160 ms into an
 * open. 150 ms is the slowest answer this lane has measured plus half again, and
 * it keeps the worst-case first contentful frame inside the operator's 300 ms
 * target for every shape measured so far.
 *
 * WHY IT MUST EXIST AT ALL. Without it the hold lasts as long as the query does,
 * and the query inherits the app's retry: transport deadline 20 s, renderer
 * timeout 25 s, one retry 1 s apart (agent review round 1, R1 — 51 s of a BLANK
 * transcript, with no rows, no working line and no placeholder, since the hold
 * is not the pane's loading arm). The hold is worth a few tens of milliseconds
 * and never worth a second.
 */
export const DISPLAY_HOLD_BUDGET_MS = 150;

/**
 * What the PLANE (the backend this window is paired to) has said about the
 * settings registry.
 *
 * FOUR STATES BECAUSE THREE WOULD MERGE TWO DIFFERENT FACTS (agent review round
 * 1, R2): "no answer yet" and "answered denied" are not the same, and collapsing
 * them made the rail's mark appear a commit after the rows whenever the
 * capability answer landed late. `denied` and `failed` are the fail-closed pair
 * (the plane has no registry, or cannot be asked); `unknown` still owes an
 * answer, so the seed may stand in for it.
 */
export type DisplayPlane = "unknown" | "denied" | "available" | "failed";

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
 * 1. an answer exists — it wins, in both directions. This is what makes the seed
 *    a head start rather than a second truth.
 * 2. the plane is `denied` or `failed` — off. A backend that does not advertise
 *    the registry has no opinion a seed could honestly stand in for, and neither
 *    has one that cannot be asked; both are the fail-closed direction every
 *    reader of these keys already stated, and both are exactly what a tree
 *    without this module does.
 * 3. no answer, one is still owed, the seed says ON, and the hold's budget is
 *    not spent — `pending`: the caller may withhold what the flag governs for
 *    this window, because painting it and taking it back is the flicker being
 *    removed.
 * 4. otherwise — the seed's own value, or off. Three cases land here and all
 *    three want the same thing: the hold's budget is spent (the answer is late;
 *    painting the last-known reading is safe for the FILTER, since a later `off`
 *    can only ADD rows back, never take one away), the read has FAILED (the same
 *    reasoning — dropping to "show everything" would re-open the removal class on
 *    the read that succeeds afterwards), and the flag was last known OFF (that
 *    operator paints now and follows a changed value in one later commit).
 */
export function displayFlagReading(input: {
	/** The answer's value, or undefined while no answer is in hand. */
	answer: boolean | undefined;
	/** The persisted last-known value, or undefined when nothing was seeded. */
	seed: boolean | undefined;
	/** What the plane has said about the registry. */
	plane: DisplayPlane;
	/** True while this plane owes an answer that could still arrive. */
	owed: boolean;
	/** True once the hold's budget is spent (`DISPLAY_HOLD_BUDGET_MS`). */
	holdSpent: boolean;
}): DisplayFlagReading {
	if (input.answer !== undefined) return input.answer ? "on" : "off";
	if (input.plane === "denied" || input.plane === "failed") return "off";
	if (input.owed && !input.holdSpent && input.seed === true) return "pending";
	return input.seed === true ? "on" : "off";
}
