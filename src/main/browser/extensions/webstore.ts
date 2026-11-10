/**
 * Chrome Web Store page bridge (design §3C). The vendored store-page preload
 * (extensions/chrome-web-store/) installs chrome.webstorePrivate/chrome.management
 * in the store page so "Add to Chrome" renders and calls back here. Every
 * handler on these channels is OURS; electron-chrome-web-store's main process
 * is not used (design §1: prefix origin check, uninstall-any-id with an
 * unvalidated path, page-supplied manifest in the consent hook).
 *
 * Gate, applied to EVERY channel before any argument is read:
 * - the sender is a tab of the persistent browser session (not the desktop
 *   renderer, an extension window or a popup child);
 * - the sending frame IS that tab's main frame (no subframes);
 * - its origin is EXACTLY https://chromewebstore.google.com.
 * Install additionally needs a user-owned, presented, active tab in a focused
 * window (agent tabs get USER_CANCELLED) and then the native dialog.
 *
 * The page can never uninstall, disable or enable anything: those calls are
 * refused here and happen only in the desktop manager UI.
 */
import type {
	IpcMain,
	IpcMainInvokeEvent,
	Session,
	WebContents,
} from "electron";
import { t } from "../../../i18n";
import { isExtensionId } from "../../../shared/browser-extensions";
import type { StoreInstallResult } from "./manager";

export const WEBSTORE_ORIGIN = "https://chromewebstore.google.com";
/** Stable id so a re-attached host does not register the preload twice. */
export const WEB_STORE_PRELOAD_ID = "local-operator-chrome-web-store";

export interface WebStoreManager {
	installFromStore: (id: string) => Promise<StoreInstallResult>;
	storeStatus: (id: string) => "enabled" | "disabled" | "installable";
	storeList: () => { id: string; enabled: boolean; version: string }[];
}

export interface WebStoreBridgeOptions {
	session: Session;
	manager: WebStoreManager;
	/** A registry tab of this host (any owner). */
	isBrowserTab: (contents: WebContents) => boolean;
	/** User-owned, presented, active tab in a focused visible window. */
	mayInstallFrom: (contents: WebContents) => boolean;
	ipc: Pick<IpcMain, "handle" | "removeHandler">;
}

/** Exact-origin, main-frame, browser-tab check. Exported for tests. */
export function isStoreSender(
	event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
	session: Session,
	isBrowserTab: (contents: WebContents) => boolean,
): boolean {
	const frame = event.senderFrame;
	if (!frame || event.sender.session !== session) return false;
	if (frame !== event.sender.mainFrame) return false;
	let urlOrigin: string;
	try {
		urlOrigin = new URL(frame.url).origin;
	} catch {
		return false;
	}
	return (
		frame.origin === WEBSTORE_ORIGIN &&
		urlOrigin === WEBSTORE_ORIGIN &&
		isBrowserTab(event.sender)
	);
}

/** Inert answers, matching upstream's stubs so the page renders normally. */
const STUBS: Record<string, () => unknown> = {
	"chromeWebstore.completeInstall": () => "success",
	"chromeWebstore.enableAppLauncher": () => true,
	"chromeWebstore.getBrowserLogin": () => "",
	// No app_name: the vendored preload would rewrite "Chrome" in page text;
	// the store's own wording is left as is.
	"chromeWebstore.getFullChromeVersion": () => ({
		version_number: process.versions.chrome,
	}),
	"chromeWebstore.getIsLauncherEnabled": () => true,
	// MV3 only: tell the store MV2 items are not installable here.
	"chromeWebstore.getMV2DeprecationStatus": () => "soft_disable",
	"chromeWebstore.getReferrerChain": () => "EgIIAA==",
	"chromeWebstore.getStoreLogin": () => "",
	"chromeWebstore.getWebGLStatus": () => "webgl_allowed",
	// Legacy no-op in upstream; real installs go through beginInstall only.
	"chromeWebstore.install": () => "success",
	"chromeWebstore.isInIncognitoMode": () => false,
	"chromeWebstore.isPendingCustodianApproval": () => false,
	"chromeWebstore.setStoreLogin": () => true,
	"chrome.runtime.getManifest": () => ({}),
};

export const WEBSTORE_CHANNELS = [
	...Object.keys(STUBS),
	"chromeWebstore.beginInstall",
	"chromeWebstore.getExtensionStatus",
	"chrome.management.getAll",
	"chrome.management.setEnabled",
	"chrome.management.uninstall",
];

/** Map the page-claimed manifest to MV2 deprecation for DISPLAY only; the
 * install path re-checks the verified package's manifest_version. */
function pageClaimsMv2(manifestJson: unknown): boolean {
	if (typeof manifestJson !== "string" || manifestJson.length > 1_000_000)
		return false;
	try {
		const manifest = JSON.parse(manifestJson) as { manifest_version?: unknown };
		return (
			typeof manifest.manifest_version === "number" &&
			manifest.manifest_version < 3
		);
	} catch {
		return false;
	}
}

/** Registers the handlers; returns the remover (host rollback/stop calls it so a
 * restarted host can register again — ipcMain.handle throws on duplicates). */
export function registerWebStoreBridge(
	options: WebStoreBridgeOptions,
): () => void {
	const { ipc, session, manager } = options;
	const guard =
		<A extends unknown[], R>(
			handler: (event: IpcMainInvokeEvent, ...args: A) => R,
		) =>
		(event: IpcMainInvokeEvent, ...args: A): R => {
			if (!isStoreSender(event, session, options.isBrowserTab))
				throw new Error("Refused");
			return handler(event, ...args);
		};
	for (const [channel, answer] of Object.entries(STUBS))
		ipc.handle(
			channel,
			guard(() => answer()),
		);
	ipc.handle(
		"chromeWebstore.beginInstall",
		guard(async (event, details: unknown) => {
			const id = (details as { id?: unknown } | null)?.id;
			if (!isExtensionId(id)) return { result: "invalid_id" };
			// Agent-owned, background or unfocused tabs: no dialog is shown. The
			// store is told it FAILED, with a reason it displays through
			// chrome.extension.lastError (review U5b), instead of a silent
			// "cancelled" that looks like nothing happened.
			if (!options.mayInstallFrom(event.sender))
				return {
					result: "blocked_by_policy",
					message: t("ui.browser.extensions.store_install_blocked"),
				};
			const result = await manager.installFromStore(id);
			if (result === "success") {
				const frame = event.senderFrame;
				const entry = manager.storeList().find((item) => item.id === id);
				if (entry && frame && !frame.isDestroyed())
					try {
						frame.send("chrome.management.onInstalled", entry);
					} catch {
						/* Page navigated away; the button state refreshes on reload. */
					}
			}
			// No message text: the store page shows its own copy for each result.
			return { result };
		}),
	);
	ipc.handle(
		"chromeWebstore.getExtensionStatus",
		guard((_event, id: unknown, manifestJson: unknown) => {
			if (!isExtensionId(id)) return "installable";
			const status = manager.storeStatus(id);
			if (status === "installable" && pageClaimsMv2(manifestJson))
				return "deprecated_manifest_version";
			return status;
		}),
	);
	ipc.handle(
		"chrome.management.getAll",
		guard(() => manager.storeList()),
	);
	// Refused: management happens only in the desktop manager UI.
	ipc.handle(
		"chrome.management.setEnabled",
		guard(() => false),
	);
	// Refused, but said (review U6): the vendored shim reports this message as
	// chrome.extension.lastError so the store does not treat it as removed, and
	// the message points at the browser's own extensions page.
	ipc.handle(
		"chrome.management.uninstall",
		guard(() => ({
			error: t("ui.browser.extensions.store_remove_refused"),
		})),
	);
	return () => {
		for (const channel of WEBSTORE_CHANNELS) ipc.removeHandler(channel);
	};
}
