/**
 * The trace hierarchy, per docs/branding.md § 7.
 *
 * One import site for everything a chat surface needs to show agent work:
 * the question affordance, the trace line and group, the one disclosure
 * idiom, the reasoning disclosure, and the retrospective security notice.
 */

export { AgentQuestion } from "./agent-question";
export type { AgentQuestionProps } from "./agent-question";
export { AgentReasoning } from "./agent-reasoning";
export type { AgentReasoningProps } from "./agent-reasoning";
export { Disclosure } from "./disclosure";
export type { DisclosureProps } from "./disclosure";
export { SecurityNotice } from "./security-notice";
export type { SecurityNoticeProps } from "./security-notice";
export { TraceGroup } from "./trace-group";
export type { TraceGroupProps } from "./trace-group";
export { TraceLine } from "./trace-line";
export type { TraceLineProps } from "./trace-line";
export { getTraceLabel } from "./trace-labels";
export type { TraceLabel } from "./trace-labels";
