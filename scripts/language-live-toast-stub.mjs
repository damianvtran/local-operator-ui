/*
 * `toast-manager` as a counter, for `language-live-updates.test.mjs`.
 *
 * WHY A STUB AND NOT THE TOAST LIBRARY. The facts under test are the SHAPE of
 * one reaction: which frames refetch the capabilities chain, which ones toast,
 * and how a redelivery or the app's own write is kept quiet. The toast is a
 * sonner call with no DOM contract worth asserting through, so the call itself
 * is captured and everything else stays the real module's (`export *` keeps
 * every other member intact, and explicit exports win over the star).
 *
 * NOW ALSO COUNTS ERRORS, for `language-dialog-applies-on-pick.test.mjs`: a
 * language write that rejects AFTER the palette dialog closed has no surface
 * left to render its refusal in, so the dialog announces it through
 * `showErrorToast`, and that call is the only observable evidence.
 */
export * from "../src/renderer/src/shared/utils/toast-manager";

/** Every `showInfoToast` call, in order. */
export const infoCalls = [];

/* Kept under the original name: `language-live-updates.test.mjs` reads it. */
export const toastCalls = infoCalls;

/** Every `showErrorToast` call, in order. */
export const errorCalls = [];

export function showInfoToast(message, options) {
	infoCalls.push({ message: String(message), options });
	return infoCalls.length;
}

export function showErrorToast(message, options) {
	errorCalls.push({ message: String(message), options });
	return errorCalls.length;
}
