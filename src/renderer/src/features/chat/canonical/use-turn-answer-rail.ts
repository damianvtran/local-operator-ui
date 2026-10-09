import { TURN_ANSWER_RAIL_KEY } from "./turn-answer-rail";
/**
 * The desktop transcript's read of `display.turn_answer_rail`.
 *
 * Same seam as `use-cross-session-hidden.ts`, for the same reasons: the key is
 * the BACKEND registry's (flat dotted, default false), it is rendered
 * generically by the Backend settings page, and this hook joins that page's OWN
 * `settings.list` query (`backendSettingsKeys.all`, imported rather than
 * respelled) so there is one fetch and one cache entry, and a save in Settings
 * repaints every open transcript in both directions. The read, the capability
 * arm and the persisted seed are `use-display-flag.ts`'s, shared with the
 * cross-session flag — one payload, two lookups.
 *
 * FAIL-CLOSED, on BOTH planes. An absent key (a backend that predates it), an
 * unanswered or failed query, and a plane that does not advertise `settings`
 * all resolve to false — no rail. The capability arm is checked BEFORE the
 * cached payload is read, and that ordering is the whole point: `enabled: false`
 * only stops the query REFETCHING, so a plane that downgrades while
 * `backendSettingsKeys.all` still holds `true` would keep painting the rail off
 * a capability the desktop no longer advertises (agent review round 1, R3; QA
 * round 1, Q-1). That rule lives in `use-display-flag.ts` now, so both flags are
 * read the same way — the sibling alignment this hook was the only holder of.
 *
 * ON IS ON FROM THE FIRST FRAME. The seed (the last answer this window saw,
 * persisted) settles the flag before the rows paint, so a reader who turned the
 * rail on gets the mark in the commit that paints the answer row. The "pending"
 * state `useDisplayFlag` can report is deliberately read as ON here: it exists
 * only while the last known value was true, and a rail dropped for the length of
 * one settings round trip would be the mark appearing late — the flicker this
 * lane removes. A row's box does not move between the two states
 * (`turnAnswerMarkClass` nets to the same prose box), so the reading is also the
 * forgiving one: a stale `on` costs a rule, never a shift.
 */
import { useDisplayFlag } from "./use-display-flag";

export function useTurnAnswerRail(): boolean {
	const { reading, available } = useDisplayFlag(TURN_ANSWER_RAIL_KEY);
	/*
	 * THE PLANE'S ANSWER OUTRANKS EVERYTHING ELSE HERE, which is the arm this
	 * hook has carried since agent review round 1 (R3) and QA round 1 (Q-1):
	 * `enabled: false` only stops the query REFETCHING, so a plane that stops
	 * advertising `settings` would otherwise keep drawing the rail off a payload
	 * it can no longer stand behind. `available` is false while the capability
	 * query is unanswered as well, which is the fail-closed direction this hook
	 * has always had (`if (!enabled) return false`).
	 */
	if (!available) return false;
	return reading !== "off";
}
