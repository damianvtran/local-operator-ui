import type {
	BrowserWindowConstructorOptions,
	Session,
	WebContents,
} from "electron";
/**
 * The Electron half of `window-guards.ts`: it attaches the pure rules to a real
 * window and its session, and owns no policy of its own.
 *
 * It is a separate file so that the pure module stays importable by the node
 * test suite without an `electron` runtime. What this file does is exactly the
 * wiring, and `scripts/window-guards-electron.test.mjs` exercises it inside a
 * real Electron against a hostile document.
 */
import type { ExternalOpenOutcome } from "../shared/desktop-contract";
import {
	type PopupVerdict,
	type Verdict,
	downloadVerdict,
	frameNavigationVerdict,
	isStaticServeRequest,
	permissionVerdict,
	popupNavigationVerdict,
	withPreviewPolicy,
} from "./window-guards";

type Log = (message: string) => void;

/** One navigation event, as Electron hands it to the listeners below. */
interface NavigationEvent {
	url: string;
	isMainFrame: boolean;
	isSameDocument: boolean;
	preventDefault: () => void;
}

/**
 * Install a navigation verdict on `contents`: `decide` answers for one URL and
 * a refusal cancels the navigation, with the reason logged. `will-frame-
 * navigate` fires for the main frame as well as subframes (verified on
 * Electron 44.3.0, scripts/window-guards-electron.test.mjs: the child-frame
 * `location=` case and the main-frame `location=` case are both observed
 * there), and `will-redirect` covers a server-side hop that a vetted first
 * request takes; `will-navigate` is deliberately NOT also listened for (it is
 * the main-frame-only subset, so a second listener would be a second answer to
 * one question).
 */
function installNavigationVerdict(
	contents: WebContents,
	decide: (url: string, isMainFrame: boolean) => Verdict,
	log: Log,
): void {
	const onNavigation = (event: NavigationEvent): void => {
		// Fragment and history-API changes (the HashRouter) replace no document.
		if (event.isSameDocument) return;
		const verdict = decide(event.url, event.isMainFrame);
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
 * Refuse navigations of the main window's contents that are not the app's own
 * document (main frame) or one of its two real framings (child frames); see
 * `frameNavigationVerdict` for the rules.
 *
 * `trustedUrls` is a thunk because the mini view's document is created after
 * this window, and a list captured at construction would miss it.
 */
export function guardNavigation(
	contents: WebContents,
	trustedUrls: () => readonly string[],
	log: Log,
): void {
	installNavigationVerdict(
		contents,
		(url, isMainFrame) =>
			frameNavigationVerdict({ url, isMainFrame }, trustedUrls()),
		log,
	);
}

/**
 * Install the `window.open` policy: auth URLs get the sandboxed popup (whose
 * own webContents is guarded at creation, below), every other URL is
 * scheme-gated before the injected OS door or denied. `authWindowOptions` is
 * the popup's window configuration, supplied by the caller so this file does
 * not restate it.
 *
 * `notifyRefused` is the half a refusal owes a person (round-2 R-4): a click
 * that ends in `deny`, or an external open the OS could not take, has no
 * caller to answer - it left through `window.open`, not an IPC - so the app
 * pushes the refusal to the renderer that clicked. The test fakes pass none.
 */
export function guardWindowOpen(
	contents: WebContents,
	decide: (url: string) => PopupVerdict,
	openExternal: (url: string) => Promise<ExternalOpenOutcome>,
	authWindowOptions: BrowserWindowConstructorOptions,
	log: Log,
	notifyRefused?: (url: string, reason: string) => void,
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
			/*
			 * The outcome is not dropped: an OS-level failure is the same "a press
			 * that did nothing" the refusal toast exists for.
			 */
			void openExternal(verdict.url).then((outcome) => {
				if (!outcome.ok) notifyRefused?.(verdict.url, outcome.reason);
			});
		} else {
			log(`[window-guard] denied window.open: ${verdict.reason}`);
			notifyRefused?.(details.url, verdict.reason);
		}
		return { action: "deny" };
	});
	/*
	 * The popup's own webContents exists only once the window is created, so the
	 * auth branch's window gets its navigation guard here (security review S-2).
	 * Nothing else can reach this hook: every non-auth window.open is denied
	 * above, and the hook runs on the opener's contents, which is the only place
	 * a popup can come from.
	 */
	contents.on("did-create-window", (window) => {
		guardPopupNavigation(window.webContents, log);
	});
}

/**
 * The popup half of the navigation guard (security review S-2): a created
 * sign-in window may travel only the hosts and relay schemes its door was
 * vetted against, and may not open windows of its own - no flow this door
 * serves opens a second window, and an unguarded descendant is exactly how
 * this class re-opens.
 */
export function guardPopupNavigation(contents: WebContents, log: Log): void {
	installNavigationVerdict(contents, (url) => popupNavigationVerdict(url), log);
	contents.setWindowOpenHandler(() => {
		log("[window-guard] denied window.open from the sign-in popup");
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
 * Put the preview policy on every response of the backend's static serve
 * family (`isStaticServeRequest`: decoded prefix, any port). The HTML preview
 * is the member that gets framed; every sibling inherits the same policy so
 * none can serve a scriptable document without the CSP (security review S-1).
 *
 * `webRequest.onHeadersReceived` has one listener per session, so this must be
 * the only caller on the session it is given.
 */
export function guardPreviewResponses(ses: Session): void {
	ses.webRequest.onHeadersReceived((details, callback) => {
		if (!isStaticServeRequest(details.url)) {
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

/**
 * The app session's download policy (security review S-4): deny by default,
 * allow only the app's own export blobs (`downloadVerdict`'s rules). The
 * `webContents` is the contents that STARTED the download; its current URL is
 * the only initiator fact a `will-download` listener receives.
 */
export function guardDownloads(
	ses: Session,
	trustedUrls: () => readonly string[],
	log: Log,
): void {
	ses.on("will-download", (event, item, webContents) => {
		const verdict = downloadVerdict(
			item.getURL(),
			webContents?.getURL() ?? "",
			trustedUrls(),
		);
		if (verdict.allowed) return;
		event.preventDefault();
		log(
			`[window-guard] blocked a download from ${item.getURL().slice(0, 200)}: ${verdict.reason}`,
		);
	});
}
