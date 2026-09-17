/**
 * The session commands the composer's status row and the destination pickers BOTH
 * send, and the one predicate they both read the loop's state with.
 *
 * WHY THIS MODULE EXISTS (agent review round 1, MINOR 1 — and the review that
 * found it was right for a reason bigger than tidiness). The same two operations
 * were spelled twice in one app: the row cleared the goal with `goal --clear`
 * while the picker cleared it with `goal clear`, and the loop was stopped with
 * `loop --stop` in the row and `loop cancel` in the picker. Two spellings for one
 * operation is how an app comes to depend on a vocabulary half its callers do not
 * send — and the flags the row sent were read by every released backend as
 * CONTENT, not as a verb (`docs/composer-status-tabs.md` § 12.4 states the
 * evidence: `goal --clear` SET the standing goal to the literal `--clear`, and
 * `loop --stop` started a judge-gated loop toward `--stop`).
 *
 * So the spellings live here, once, and both callers import them:
 *
 * - every spelling below is one a RELEASED backend already honours. The desktop
 *   command route ends in `route_shared_slash` → the runtime's own `_goal_slash`
 *   and `_loop_slash`, and those accept `clear|none|reset` and `stop|cancel|abort`
 *   verbatim (verified in `local-operator` at `main` and at the released `v0.56.4`
 *   tag: `_cmd_goal` and `_goal_slash` both list `("clear", "none", "reset")`, and
 *   `_cmd_loop` lists `("stop", "cancel", "abort")`);
 * - no `--`-prefixed form is sent from this app at all, which is the point: the app
 *   can attach to a backend it does not own, there is no capability signal for a
 *   slash ARGUMENT, and a backend that does not know a flag does not refuse it —
 *   it reads it as the value the command takes. A UI may only send what every
 *   installed backend already understands.
 *
 * `loopIsRunning` is here for the same reason, one level down: the row and the
 * `LoopPicker` both have to decide whether the loop can be STOPPED, and the two
 * had separate copies of the predicate (the picker's inline at its own `running`,
 * the row's exported `loopIsRunning`). Two copies of a truth table are two answers
 * waiting to disagree about a loop the user can see is moving.
 */

import type { DesktopLoopState } from "../../../../../shared/desktop-control-contract";

/** The value `goal` takes to unset the standing goal (`/goal clear`). */
export const GOAL_CLEAR_ARGS = "clear";

/** The value `loop` takes to cancel the running loop (`/loop stop`). */
export const LOOP_STOP_ARGS = "stop";

/**
 * Whether the wire's loop is MOVING — the whole of the row's affordance rule and
 * the picker's Cancel gate.
 *
 * The two words are the wire's own (`DesktopLoopState.status`), and anything that
 * is not one of them is read as SETTLED, deliberately: a status this build cannot
 * read (`interrupted`, `failed` and the rest of the wire's set are all real
 * settled states) is not claimed to be moving, and offering `Stop` on a status
 * this build cannot read would offer a control whose claim the caller cannot
 * check. The backend gates its own "owner restarted" rule on the same pair
 * (`local_operator/session/frontend_state.py`).
 */
export const loopIsRunning = (status: DesktopLoopState["status"]): boolean =>
	status === "running" || status === "judging";
