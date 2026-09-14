/**
 * The run panel: the right pane's live view over a session's delegated work.
 *
 * Named re-exports rather than `export *`, matching the primitive layer's own
 * barrel: a star re-export defeats tree-shaking.
 */

export {
	accumulateSeen,
	acknowledgeMcpWhileShown,
	acknowledgeWhileOpen,
	BRIEF_PREVIEW_LINES,
	childStateLabel,
	deriveMcpServers,
	deriveRunDetails,
	foldBrief,
	hasLiveChildClock,
	hasRunDetails,
	hasUnseenFailure,
	hasUnseenMcpProblem,
	LABEL_SEAM,
	mcpErrorTexts,
	mcpProblemNames,
	mcpServersAreCold,
	NOTHING_SEEN,
	onScreenFailures,
	OPEN_CHILD_STATUSES,
	OPEN_TODO_STATUSES,
	panelSlice,
	reconcileLaunchTurns,
	retimeRunDetails,
	runDetailTriggerLabel,
	SUBAGENT_ROW_CAP,
	subagentTally,
	TODO_ITEM_CAP,
	todoClause,
	todoTally,
	unseenFailures,
	unseenMcpProblems,
	visibleFailures,
	visibleSubagents,
	visibleTodoPhases,
} from "./run-detail-model";
export type {
	ChildStatus,
	McpServerRow,
	McpStatus,
	RunDetails,
	RunDetailsInput,
	SeenFailures,
	SeenMcpProblems,
	SubagentRow,
	TodoItemStatus,
	TodoItemView,
	TodoPhaseView,
} from "./run-detail-model";
export { RunChildReader } from "./run-child-reader";
export type { RunChildReaderProps } from "./run-child-reader";
export { RunDetailMcp } from "./run-detail-mcp";
export { RunDetailSubagents } from "./run-detail-subagents";
export { RunDetailTodos } from "./run-detail-todos";
export { RunDetailsPanel } from "./run-details-panel";
export type { RunDetailsPanelProps } from "./run-details-panel";
export { RunPanel } from "./run-panel";
export type { RunPanelProps } from "./run-panel";
export { RunDetailsTrigger } from "./run-details-trigger";
export type { RunDetailsTriggerProps } from "./run-details-trigger";
export { useRunPanelMcpServers } from "./use-mcp-servers";
