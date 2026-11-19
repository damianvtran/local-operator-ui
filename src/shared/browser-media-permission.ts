/**
 * The camera/microphone prompt's wire shape, shared by main (which raises it and
 * owns every decision) and the renderer (which paints it in the browser chrome).
 *
 * Policy, persistence and the human-only invariant live in
 * `src/main/browser/media-permissions.ts`; this file is only what both sides must
 * agree on, so the renderer imports no main-process module.
 */

/** The two capture devices a page can ask for. Electron's request details name
 * them `audio`/`video`; the copy says microphone/camera. */
export type MediaKind = "audio" | "video";

/** What the user can answer. `dismiss` is the close button: it denies THIS
 * request and remembers nothing, so the site may ask again on its next attempt. */
export type MediaPermissionDecision = "allow" | "block" | "dismiss";

/** A page is waiting for the user's answer. Every field is main's fact: `origin`
 * is the requesting frame's browser-side origin (never page text), and `id` is a
 * host-minted random identity a decision must echo, so a click on a superseded
 * prompt is refused. */
export interface MediaPermissionPromptView {
	kind: "prompt";
	tabId: number;
	id: string;
	/** `scheme://host[:port]` of the site asking. */
	origin: string;
	kinds: MediaKind[];
	/** Who owns the tab, as the registry records it. An allow on an agent-owned
	 * tab is NOT remembered (see `media-permissions.ts`), and the copy says so. */
	ownerKind: "user" | "agent";
	at: number;
}

/** The user allowed the site, but macOS has this app's camera/microphone access
 * turned off, so the request was denied. The only fix lives in System Settings. */
export interface MediaPermissionSystemBlockedView {
	kind: "system-blocked";
	tabId: number;
	id: string;
	origin: string;
	/** The devices macOS refused (a subset of what was asked for). */
	kinds: MediaKind[];
	at: number;
}

/**
 * The site asked again for a device the user had BLOCKED for it, on a user-owned
 * tab, so the request was denied without a prompt. Shown so a Block is never a
 * silent dead end (review U2): the user sees why the page's button did nothing
 * and can Allow right where it failed, without the destructive "Forget this
 * site" (which also clears cookies). The request itself is already answered
 * `false`; an Allow here changes the remembered answer, and the page's next
 * attempt is granted. Dismissing it hides it for this tab until it navigates.
 */
export interface MediaPermissionBlockedView {
	kind: "blocked";
	tabId: number;
	id: string;
	origin: string;
	/** The blocked devices the denied request(s) named. */
	kinds: MediaKind[];
	at: number;
}

export type MediaPermissionView =
	| MediaPermissionPromptView
	| MediaPermissionSystemBlockedView
	| MediaPermissionBlockedView;

export function isMediaPermissionDecision(
	value: unknown,
): value is MediaPermissionDecision {
	return value === "allow" || value === "block" || value === "dismiss";
}

/** The select arm the copy keys on, so one message covers all three requests. */
export function mediaKindsLabel(
	kinds: readonly MediaKind[],
): "audio" | "video" | "both" {
	const audio = kinds.includes("audio");
	const video = kinds.includes("video");
	if (audio && video) return "both";
	return video ? "video" : "audio";
}
