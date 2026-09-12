/**
 * The run-details surface: one header button that opens a popover over the
 * session's subagent roster and its to-do plan.
 *
 * Named re-exports rather than `export *`, matching the primitive layer's own
 * barrel: a star re-export defeats tree-shaking.
 */

export {
	accumulateSeen,
	acknowledgedOnClose,
	acknowledgedOnOpen,
	childStateLabel,
	deriveRunDetails,
	hasLiveChildClock,
	hasRunDetails,
	hasUnseenFailure,
	NOTHING_SEEN,
	onScreenFailures,
	OPEN_CHILD_STATUSES,
	OPEN_TODO_STATUSES,
	panelSlice,
	retimeRunDetails,
	runDetailTriggerLabel,
	SUBAGENT_ROW_CAP,
	subagentTally,
	TODO_ITEM_CAP,
	todoTally,
	unseenFailures,
	visibleFailures,
	visibleSubagents,
	visibleTodoPhases,
} from "./run-detail-model";
export type {
	ChildStatus,
	RunDetails,
	RunDetailsInput,
	SeenFailures,
	SubagentRow,
	TodoItemStatus,
	TodoItemView,
	TodoPhaseView,
} from "./run-detail-model";
export { RunDetailSubagents } from "./run-detail-subagents";
export { RunDetailTodos } from "./run-detail-todos";
export { RunDetailsPanel } from "./run-details-panel";
export type { RunDetailsPanelProps } from "./run-details-panel";
export { RunDetailsTrigger } from "./run-details-trigger";
export type { RunDetailsTriggerProps } from "./run-details-trigger";
