/*
 * ENGLISH VIEW OF THE WORKING LINE, FOR THE SUITES THAT PIN ITS ENGLISH.
 *
 * `deriveWorkingLine` and `deriveChildWorkingLine` no longer return a sentence:
 * their `activity` is a rung plus arguments (`WorkingActivity`), and the words
 * come from `workingActivityText` at render, in the active language. The suites
 * that assert the line's exact English (`tool-row`, `working-line-clock`,
 * `tool-compose-lifecycle`, `run-detail-model`) keep asserting the SAME literals
 * by reading the derived state through this shim, so the English pins now prove
 * the whole new path (ladder -> catalogue key -> `t()`) instead of a constant.
 * Nothing here is a second source of copy: it only calls the shipped resolver.
 *
 * `scripts/i18n/canonical-transcript-copy.test.mjs` is the suite that asserts the
 * structured value itself and the live language switch.
 */
import { workingActivityText } from "../src/renderer/src/features/chat/canonical/working-line-copy";
import type {
	WorkingActivity,
	WorkingLineState,
} from "../src/renderer/src/features/chat/canonical/working-line-model";

export const english = (activity: WorkingActivity): string =>
	workingActivityText(activity);

export const englishState = (
	state: WorkingLineState | null,
): (Omit<WorkingLineState, "activity"> & { activity: string }) | null =>
	state === null
		? null
		: { ...state, activity: workingActivityText(state.activity) };
