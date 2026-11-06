/**
 * Team Bridge @-mentions. Everything mention-specific lives in this folder so
 * the composer, the thread pane and the message list each carry a small,
 * clearly delimited mount (see `mention-field.tsx`).
 */
export { TeamBridgeMentionProvider } from "./mention-source";
export {
	MentionField,
	MentionNotice,
	useComposerMentions,
} from "./mention-field";
export type { MentionWireRow } from "./tokens";
