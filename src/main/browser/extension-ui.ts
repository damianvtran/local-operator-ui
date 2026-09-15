import {
	BrowserWindow,
	type BrowserWindow as OwnerWindow,
	type Session,
	dialog,
} from "electron";
import { presentWindow } from "../window-raise";
import { BrowserExtensionManager } from "./extensions";

/** Extension pages share the browser profile, never the application's preload or
 * default session. A popup is opt-in from the trusted chrome; on that popup,
 * window-open and cross-origin navigation are denied rather than becoming a
 * second ungoverned browser. Scoped deliberately to the popup we open: Electron
 * exposes no `chrome.windows` (the capability matrix's `not available` row), so
 * there is no other extension-created window to deny. Headless mode still never
 * presents a native window. */
export function createBrowserExtensionManager(options: {
	window: OwnerWindow;
	session: Session;
	dir: string;
	windowShow: "focus" | "inactive" | "never";
}): BrowserExtensionManager {
	const popups = new Map<string, BrowserWindow>();
	return new BrowserExtensionManager({
		dir: options.dir,
		runtime: options.session.extensions,
		chooseDirectory: async () => {
			const selection = await dialog.showOpenDialog(options.window, {
				title: "Choose an unpacked extension directory",
				buttonLabel: "Review extension",
				properties: ["openDirectory"],
			});
			return selection.canceled ? null : (selection.filePaths[0] ?? null);
		},
		confirm: async (extension) => {
			const result = await dialog.showMessageBox(options.window, {
				type: "warning",
				title: "Trust this unpacked extension?",
				message: `Enable ${extension.name} ${extension.version}?`,
				/*
				 * ONE BLOCK PER KIND OF CONTENT (design round 1, D2). The alert's `detail`
				 * renders as secondary text, so the boundary between "what it asks for"
				 * and "what will not work here" was carried by a blank line alone — and
				 * that boundary is what the decision turns on. The two lists lead with a
				 * label; the path already had one, and the trust paragraph stays unlabelled
				 * because it is the consequence statement rather than a list.
				 *
				 * The labels are NOT a claim about macOS rendering: this string is only
				 * ever seen in a native `dialog.showMessageBox`, which no headless run can
				 * photograph (the harness stubs it), so what is pinned here is the string
				 * and not the paint. `scripts/browser-extensions-proof.mjs` records it, and
				 * asserts the access lines are still in it.
				 */
				detail: [
					`Trusted source directory: ${extension.path}`,
					"Only enable code you trust. Extensions can read or change matching pages in the shared browser profile, including signed-in pages, independently of agent site approvals. Changes to files in this directory are trusted; keep it in a stable location you control.",
					`Access requested:\n${extension.permissions.join("\n") || "None declared."}`,
					...(extension.warnings.length > 0
						? [`Compatibility:\n${extension.warnings.join("\n")}`]
						: []),
				].join("\n\n"),
				buttons: ["Cancel", "Trust and enable"],
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});
			return result.response === 1;
		},
		openPopup: async (id, path, name) => {
			popups.get(id)?.close();
			const url = new URL(path, `chrome-extension://${id}/`);
			if (url.protocol !== "chrome-extension:" || url.hostname !== id)
				throw new Error("The popup must belong to this extension.");
			const popup = new BrowserWindow({
				parent: options.window,
				title: `${name} — extension`,
				width: 420,
				height: 560,
				show: false,
				autoHideMenuBar: true,
				webPreferences: {
					session: options.session,
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
					webSecurity: true,
					webviewTag: false,
				},
			});
			popups.set(id, popup);
			popup.on("closed", () => {
				if (popups.get(id) === popup) popups.delete(id);
			});
			// The popup is the only extension window that exists: with `chrome.windows`
			// absent there is nothing else for `window.open` to reach, so this denial is
			// the whole of the constraint rather than a hook on a general one.
			popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			const refuseForeign = (
				event: Electron.Event,
				destination: string,
			): void => {
				try {
					const target = new URL(destination);
					if (target.protocol === "chrome-extension:" && target.hostname === id)
						return;
				} catch {
					/* Invalid URLs are also refused. */
				}
				event.preventDefault();
			};
			popup.webContents.on("will-navigate", refuseForeign);
			popup.webContents.on("will-redirect", refuseForeign);
			popup.webContents.on("will-attach-webview", (event) =>
				event.preventDefault(),
			);
			try {
				await popup.loadURL(url.href);
				presentWindow(
					popup,
					options.windowShow === "never" ? "never" : "inactive",
				);
			} catch (error) {
				popup.close();
				throw error;
			}
		},
		closePopup: (id) => popups.get(id)?.close(),
	});
}
