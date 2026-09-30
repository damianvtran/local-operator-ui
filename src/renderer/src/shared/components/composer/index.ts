/**
 * The shared composer (bootstrap lift, slice 1 of the mini quick-send work).
 *
 * `MessageInput` is the chat's own composer assembly, carved out of
 * `features/chat` so documents other than the chat shell - the mini view's
 * frame, the projects row - can mount the real control. It renders its own box,
 * field and satellites; a host supplies the conversation identity, the send
 * binding, and the seams documented on `MessageInputProps` (the credential
 * invalidation callback, the credential probe answer, the dictation-state
 * callback, the placeholder override). Nothing here reaches for the app shell:
 * no router, no feed, no QueryClient, no canonical transcript.
 */
export {
	composerHoldsFocusUntouched,
	MessageInput,
} from "./message-input";
export type {
	ComposerSendError,
	MessageInputHandle,
	MessageInputProps,
} from "./message-input";
