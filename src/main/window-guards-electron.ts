/**
 * The Electron half of `window-guards.ts`: it attaches the pure rules to a real
 * window and its session, and owns no policy of its own.
 *
 * It is a separate file so that the pure module stays importable by the node
 * test suite without an `electron` runtime. What this file does is exactly the
 * wiring, and `scripts/window-guards-electron.test.mjs` exercises it inside a
 * real Electron against a hostile document.
 */
import type {
	BrowserWindowConstructorOptions,
	Session,
	WebContents,
} from "electron";
import {
	type PopupVerdict,
	frameNavigationVerdict,
	isPreviewDocumentRequest,
	permissionVerdict,
	withPreviewPolicy,
} from "./window-guards";

type Log = (message: string) => void;

/**
 * Refuse navigations of the main window's contents that are not the app's own
 * document (main frame) or one of its two real framings (child frames).
 *
 * `will-frame-navigate` fires for the main frame as well as subframes (verified
 * on Electron 44.3.0, scripts/window-guards-electron.test.mjs: the child-frame
 * `location=` case and the main-frame `location=` case are both observed here),
 * and `will-redirect` covers a server-side hop that a vetted first request
 * takes. `will-navigate` is deliberately NOT also listened for: it is the
 * main-frame-only subset of `will-frame-navigate`, so a second listener would be
 * a second answer to one question.
 *
 * `trustedUrls` is a thunk because the mini view's document is created after
 * this window, and a list captured at construction would miss it.
 */
export function guardNavigation(
	contents: WebContents,
	trustedUrls: () => readonly string[],
	log: Log,
): void {
	const onNavigation = (event: {
		url: string;
		isMainFrame: boolean;
		isSameDocument: boolean;
		preventDefault: () => void;
	}): void => {
		// Fragment and history-API changes (the HashRouter) replace no document.
		if (event.isSameDocument) return;
		const verdict = frameNavigationVerdict(
			{ url: event.url, isMainFrame: event.isMainFrame },
			trustedUrls(),
		);
		if (verdict.allowed) return;
		event.preventDefault();
		log(
			`[window-guard] blocked ${event.isMainFrame ? "main-frame" : "child-frame"} navigation to ${event.url.slice(0, 200)}: ${verdict.reason}`,
		);
	};
	contents.on("will-frame-navigate", onNavigation);
	contents.on("will-redirect", onNavigation);
}

/**
 * Install the `window.open` policy. `authWindowOptions` is the popup's
 * unchanged window configuration, supplied by the caller so this file does not
 * restate it.
 */
export function guardWindowOpen(
	contents: WebContents,
	decide: (url: string) => PopupVerdict,
	openExternal: (url: string) => Promise<boolean>,
	authWindowOptions: BrowserWindowConstructorOptions,
	log: Log,
): void {
	contents.setWindowOpenHandler((details) => {
		const verdict = decide(details.url);
		if (verdict.action === "auth") {
			return {
				action: "allow",
				overrideBrowserWindowOptions: authWindowOptions,
			};
		}
		if (verdict.action === "external") {
			void openExternal(verdict.url);
		} else {
			log(`[window-guard] denied window.open: ${verdict.reason}`);
		}
		return { action: "deny" };
	});
}

/**
 * Deny-by-default permissions on `ses`, both handlers: Electron documents that
 * most web APIs run a permission CHECK and then a REQUEST if the check is
 * denied, so one handler without the other leaves a path that auto-approves
 * (the same pairing `browser/profile.ts` installs for the driven browser's
 * partition).
 */
export function guardPermissions(
	ses: Session,
	trustedUrls: () => readonly string[],
	log: Log,
): void {
	ses.setPermissionRequestHandler(
		(_contents, permission, callback, details) => {
			const granted = permissionVerdict(
				{
					permission,
					mediaTypes:
						"mediaTypes" in details ? (details.mediaTypes ?? []) : undefined,
					isMainFrame: details.isMainFrame,
					requestingUrl: details.requestingUrl,
				},
				trustedUrls(),
			);
			if (!granted)
				log(
					`[window-guard] denied permission request ${permission} from ${details.requestingUrl.slice(0, 200)}`,
				);
			callback(granted);
		},
	);
	ses.setPermissionCheckHandler((_contents, permission, _origin, details) =>
		permissionVerdict(
			{
				permission,
				mediaType: details.mediaType,
				isMainFrame: details.isMainFrame,
				requestingUrl: details.requestingUrl ?? "",
			},
			trustedUrls(),
		),
	);
}

/**
 * Put the preview policy on every response for the backend's HTML preview route.
 *
 * `webRequest.onHeadersReceived` has one listener per session, so this must be
 * the only caller on the session it is given.
 */
export function guardPreviewResponses(ses: Session): void {
	ses.webRequest.onHeadersReceived((details, callback) => {
		if (!isPreviewDocumentRequest(details.url)) {
			callback({});
			return;
		}
		callback({
			responseHeaders: withPreviewPolicy(
				(details.responseHeaders ?? {}) as Record<string, string[]>,
			),
		});
	});
}
