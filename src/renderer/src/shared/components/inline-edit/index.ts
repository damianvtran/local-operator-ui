/**
 * The inline-edit module: the implementation of the per-field editing contract
 * in `docs/design/agents-inplace-shared-composer.md` § 2 (PR #725), shared by
 * every surface that edits a catalogue record in place.
 *
 * The current consumer is the projects detail page
 * (`features/projects/components/project-editors.tsx`); the intended next
 * consumer is the agents/teams lane named in the same note's Scope A, which is
 * why nothing here imports a feature: every hook and component is mounted by
 * props, and the machine is testable in Node
 * (`scripts/projects-inline-edit.test.mjs`).
 *
 * Named re-exports rather than `export *`, the barrel rule the UI primitive
 * layer states: a star export defeats tree-shaking.
 */
export {
	INLINE_EDIT_GROUP,
	InlineEditControls,
} from "./inline-edit-controls";
export type {
	InlineEditControlsProps,
	InlineEditSlotHandle,
} from "./inline-edit-controls";
export {
	InlineEditFeedback,
	INLINE_EDIT_CONFLICT_SENTENCE,
	INLINE_EDIT_KEEP_MINE,
	INLINE_EDIT_USE_THEIRS,
} from "./inline-edit-feedback";
export type {
	InlineEditFeedbackHandle,
	InlineEditFeedbackProps,
} from "./inline-edit-feedback";
export {
	inlineEditAcceptSends,
	inlineEditDirty,
	inlineEditEditorShown,
	inlineEditKeyAction,
	inlineEditReseed,
} from "./inline-edit-model";
export type {
	InlineEditKeyAction,
	InlineEditPhase,
	InlineEditReseed,
} from "./inline-edit-model";
export { InlineEditPane } from "./inline-edit-pane";
export { useInlineEdit } from "./use-inline-edit";
export type {
	InlineEditApi,
	InlineEditLabels,
	InlineEditOptions,
} from "./use-inline-edit";
