import {
	BrowserWindow,
	type BrowserWindow as OwnerWindow,
	type Session,
	dialog,
} from "electron";
import { presentWindow } from "../window-raise";
import { BrowserExtensionManager } from "./extensions";

/** Extension pages share the browser profile, never the application's preload or
 * default session. A popup is opt-in from the trusted chrome; extension-created
 * windows and cross-origin navigation are denied rather than becoming a second
 * ungoverned browser. Headless mode still never presents a native window. */
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
				detail: [
					`Trusted source directory: ${extension.path}`,
					"Only enable code you trust. Extensions can read or change matching pages in the shared browser profile, including signed-in pages, independently of agent site approvals. Changes to files in this directory are trusted; keep it in a stable location you control.",
					`Manifest access requests:\n${extension.permissions.join("\n") || "None declared."}`,
					...extension.warnings,
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
