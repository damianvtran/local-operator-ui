/**
 * The goal judge's stall vocabulary: the wire's reasons, and the stable codes a
 * surface decides by.
 *
 * WHY THIS MODULE EXISTS. `goal_judge.reason` is a PROTOCOL value written by the
 * Python backend (`local_operator/session/goal_judge.py`), not copy. The desktop
 * needs to tell its two bounds apart — the breaker (`STALLED_BREAKER_REASON`,
 * consecutive unreadable verdicts) and the continuation cap (`STALLED_CAP_REASON`,
 * the auto-continuation budget) — because they are different next moves, and
 * `session/goal_judge.py` carries the warning a surface owes the user here: a
 * goal reported with the other bound's cause *"would send the user looking for a
 * provider problem that does not exist"*.
 *
 * The extraction of the renderer's copy into catalogues made that comparison
 * fragile for the first time: `composer-status-row.tsx` mirrored these phrases as
 * catalogue values, so translating them turned the equality and the prefix test
 * false in every non-English locale, and both specific stall notes degraded to
 * the generic fallback (chat audit Z3). The classification therefore lives here,
 * over the wire's own English spellings, and is NEVER routed through `t()`: a
 * translated catalogue must not be able to change what the product decides, only
 * what it says. The sentences themselves stay in the renderer and are keyed copy
 * there.
 *
 * A MIRROR, not an import: one half of this feature is a Python package and the
 * other a TypeScript renderer, so no mechanism keeps one constant from being read
 * as the other. What holds them together is this comment and the test that pins
 * both sentences (`scripts/composer-tabs.test.mjs`) — the same discipline the
 * session contract's closed-vocabulary fields are read under.
 *
 * THE CAP IS MATCHED BY SHAPE rather than by literal, and that is the one place
 * this mirror is looser than the breaker's. The breaker's reason is a fixed
 * phrase; the cap's is an f-string over the budget (`stopped after 12
 * continuations`), so a literal here would silently downgrade the cap's sentence
 * to the fallback the day the backend moves that number — a copy regression with
 * no test to catch it, since a pin on `stopped after 12 continuations` would stay
 * green while the product moved. Head and tail are both required, so a reason
 * that merely mentions continuations is not claimed to be the cap.
 */

/** `goal_judge.STALLED_BREAKER_REASON` — the breaker's fixed phrase. */
export const GOAL_JUDGE_STALLED_BREAKER_REASON = "judge could not decide";

/** The fixed head of `goal_judge.STALLED_CAP_REASON` (`stopped after <n> continuations`). */
export const GOAL_JUDGE_STALLED_CAP_REASON_HEAD = "stopped after ";

/** The cap reason's fixed tail, after the budget count. */
export const GOAL_JUDGE_STALLED_CAP_REASON_TAIL = " continuations";

/**
 * The cause a stall belongs to, as a code rather than as copy.
 *
 * `unnamed` is not an error: `goal_judge.reason` is an open reader over a value
 * a newer backend may write, and a cause this build cannot name still has to be
 * announced (silence makes a stopped goal read exactly like a waiting one).
 */
export type GoalJudgeStallCode =
	| "judge_could_not_decide"
	| "continuation_cap"
	| "unnamed";

/**
 * A classified stall. `count` is present only for the cap, and is `null` when the
 * reason has the cap's head and tail but no readable count between them — a
 * shape the backend does not publish today, and one the row names without echoing
 * an unparsed middle into the transcript.
 */
export type GoalJudgeStall =
	| { code: "judge_could_not_decide" }
	| { code: "continuation_cap"; count: string | null }
	| { code: "unnamed" };

/*
 * Digits only: the backend's budget is an int, and anything else is not a count a
 * surface may print as one. Top-level for `lint/performance/useTopLevelRegex`.
 */
const CAP_COUNT = /^\d+$/;

/**
 * Classify the reason the judge published.
 *
 * Trims first: the wire's reason may carry whitespace, and the exact phrase is
 * the contract rather than the padding around it.
 */
export function goalJudgeStall(reason: string | undefined): GoalJudgeStall {
	const named = (reason ?? "").trim();
	if (named === GOAL_JUDGE_STALLED_BREAKER_REASON) {
		return { code: "judge_could_not_decide" };
	}
	if (
		named.startsWith(GOAL_JUDGE_STALLED_CAP_REASON_HEAD) &&
		named.endsWith(GOAL_JUDGE_STALLED_CAP_REASON_TAIL)
	) {
		const count = named.slice(
			GOAL_JUDGE_STALLED_CAP_REASON_HEAD.length,
			named.length - GOAL_JUDGE_STALLED_CAP_REASON_TAIL.length,
		);
		return {
			code: "continuation_cap",
			count: CAP_COUNT.test(count) ? count : null,
		};
	}
	return { code: "unnamed" };
}
