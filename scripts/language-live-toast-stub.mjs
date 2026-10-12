/*
 * `toast-manager` as a counter, for `language-live-updates.test.mjs`.
 *
 * WHY A STUB AND NOT THE TOAST LIBRARY. The facts under test are the SHAPE of
 * one reaction: which frames refetch the capabilities chain, which ones toast,
 * and how a redelivery or the app's own write is kept quiet. The toast is a
 * sonner call with no DOM contract worth asserting through, so the call itself
 * is captured and everything else stays the real module's (`export *` keeps
 * every other member intact, and explicit exports win over the star).
 */
export * from "../src/renderer/src/shared/utils/toast-manager";

/** Every `showInfoToast` call, in order. */
export const toastCalls = [];

export function showInfoToast(message, options) {
	toastCalls.push({ message: String(message), options });
	return toastCalls.length;
}
