/*
 * SONNER, AS AN INSTRUMENT.
 *
 * `showWarningToast` is a module function that calls `toast.warning(message,
 * options)`, so the only place a suite can read the refusal toast's OPTIONS (the
 * `classNames.content` that has to reach Sonner's `[data-content]`, D1) and the
 * NODE its copy is built into (D2/D3) is this call. The recording is an array on
 * `globalThis`, so a case reads what the module under test handed over without
 * importing it - and nothing here renders, exactly as Sonner does in a document
 * with no `Toaster`.
 */
if (globalThis.__sonnerCalls === undefined) globalThis.__sonnerCalls = [];
const calls = globalThis.__sonnerCalls;
const record = (level) => (message, options) => {
	calls.push({ level, message, options });
	return `toast-${calls.length}`;
};
export const toast = {
	warning: record("warning"),
	success: record("success"),
	error: record("error"),
	info: record("info"),
	message: record("message"),
	dismiss: () => {},
	custom: record("custom"),
	loading: record("loading"),
	promise: () => {},
};
export default toast;
