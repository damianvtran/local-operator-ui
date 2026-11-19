/* Native half of extension-native-proof.mjs. Exercises the ACTUAL product
 * ExtensionManager + adapter binding + TabRegistry on real Electron: legacy-layout
 * migration, verified restore, MV3 worker readiness, hidden popup frames, a
 * worker-requested tab, disable/restore and remove; round 2 adds the zero-
 * account toolbar activation (runtime popup "" → action.onClicked → welcome
 * USER tab, captured as a frame) and a consented reinstall whose
 * runtime.onInstalled is dispatched exactly once (not again on restart). The
 * reinstall's network download is served from the same verified local CRX;
 * everything after the fetch is the product path. Not whole-desktop-renderer
 * QA and not a passkey assertion. No vault access, visible windows or native
 * host grants; popup text is reduced to a "Loading" boolean + length. */
const { app, session, BrowserWindow, WebContentsView } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.env.EXTENSION_PROOF_ROOT;
const profile = path.join(root, "user-data");
const uiDiagnostic = process.env.EXTENSION_UI_DIAGNOSTIC === "1";
let phase = "bootstrap";
const output = (data) => console.log(JSON.stringify(data));
const fail = (error) => {
	output({
		result: "FAIL",
		phase,
		category: error?.name ?? "Error",
		// Our own thrown messages only (no page text reaches an Error here).
		message: String(error?.message ?? "").slice(0, 200),
		at: String(error?.stack ?? "")
			.split("\n")
			.slice(1, 3)
			.map((line) => line.trim().replace(/\(.*\//, "("))
			.join(" | "),
	});
	app.exit(1);
};
// Fail closed instead of Electron's default native error dialog/warning-only
// unhandled rejection. The outer runner reaps the entire owned process group.
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
app.setPath("userData", profile);
app.setPath("sessionData", path.join(root, "session-data"));
app.dock?.hide();
app.on("window-all-closed", () => {});
const mark = (next) => {
	phase = next;
	output({ phase });
};
app
	.whenReady()
	.then(async () => {
		const bundle = process.env.EXTENSION_PROOF_BUNDLE;
		const hash = async (file) =>
			crypto
				.createHash("sha256")
				.update(await fs.readFile(file))
				.digest("hex");
		output({
			electron: process.versions.electron,
			sourceBundleSha256: await hash(bundle),
			adapterSha256: await hash(require.resolve("electron-chrome-extensions")),
			preloadSha256: await hash(
				require.resolve("electron-chrome-extensions/preload"),
			),
		});
		const {
			ExtensionManager,
			extensionsAdapter,
			TabRegistry,
			extensionIdOfUrl,
		} = require(bundle);
		const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
		const isOfficialPage = (url) => extensionIdOfUrl(url) === ID;
		const ses = session.fromPartition("persist:extension-native-proof");
		ses.setPermissionRequestHandler((_contents, _permission, callback) =>
			callback(false),
		);
		ses.setPermissionCheckHandler(() => false);
		if (uiDiagnostic) {
			const safeMessage = (message) =>
				String(message)
					.replace(/(?:https?|chrome-extension):\/\/[^\s\"'<>\)]+/g, (raw) => {
						try {
							const url = new URL(raw);
							return `${url.protocol}//${url.host}/[URL omitted]`;
						} catch {
							return "[URL omitted]";
						}
					})
					.replace(/\{[\s\S]*\}/g, "{payload omitted}");
			const apiNames = new Set();
			const reportError = (source, details) => {
				const message = String(details.message);
				if (
					/^LOP_API_(?:CALL|UNAVAILABLE|TRACE_UNAVAILABLE) [A-Za-z.]+$/.test(
						message,
					)
				) {
					if (!apiNames.has(message)) {
						apiNames.add(message);
						output({ diagnosticApi: { source, name: message } });
					}
					return;
				}
				if (details.level !== 3 && details.level !== "error") return;
				output({
					diagnosticError: { source, message: safeMessage(details.message) },
				});
			};
			ses.serviceWorkers.on("console-message", (_event, details) =>
				reportError("official-worker", details),
			);
			app.on("web-contents-created", (_event, contents) => {
				if (contents.session !== ses) return;
				contents.on("console-message", (details) =>
					reportError("official-ui", details),
				);
			});
		}
		const parent = new BrowserWindow({
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		const binding = extensionsAdapter(ses);
		// Count onInstalled dispatches at the router (U1b): the product sends it
		// there; a count of exactly 1 across install + restart is the claim.
		const router = binding.adapter.ctx.router;
		const sendEvent = router.sendEvent.bind(router);
		let installedEvents = 0;
		router.sendEvent = (extensionId, name, ...args) => {
			if (name === "runtime.onInstalled" && extensionId === ID) {
				installedEvents++;
				output({ onInstalledDispatched: args[0] });
			}
			return sendEvent(extensionId, name, ...args);
		};
		if (uiDiagnostic)
			ses.registerPreloadScript({
				type: "frame",
				filePath: path.join(__dirname, "extension-api-diagnostic-preload.cjs"),
			});
		const views = new Map();
		const registry = new TabRegistry(
			(_options, id) => {
				const view = new WebContentsView({
					webPreferences: {
						session: ses,
						contextIsolation: true,
						nodeIntegration: false,
						sandbox: true,
					},
				});
				parent.contentView.addChildView(view);
				view.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
				view.setVisible(false);
				views.set(id, view);
				binding.adapter.addTab(view.webContents, parent);
				return view;
			},
			(id) => {
				const view = views.get(id);
				if (!view) return;
				// Exact production releaseView ordering: close contents, then detach child.
				mark("web-contents-close");
				if (!view.webContents.isDestroyed()) view.webContents.close();
				mark("remove-child-view");
				parent.contentView.removeChildView(view);
				views.delete(id);
				mark("view-released");
			},
			() => {},
			({ activeTabId }) => {
				const record = activeTabId === null ? null : registry.get(activeTabId);
				if (record) binding.adapter.selectTab(record.view.webContents);
			},
		);
		// Seed the UNRELEASED single-vendor layout so the manager's migration runs
		// natively. enabled.json is SYNTHETIC fixture consent, not a user grant.
		const extensionsRoot = path.join(profile, "browser-extensions");
		const legacy = path.join(extensionsRoot, "1password");
		await fs.mkdir(legacy, { recursive: true, mode: 0o700 });
		await fs.copyFile(
			path.join(root, "official.crx"),
			path.join(legacy, "official.crx"),
		);
		await fs.writeFile(
			path.join(legacy, "enabled.json"),
			JSON.stringify({ enabled: true }),
			{ mode: 0o600 },
		);
		const workerTabs = [];
		let consentAnswer = null;
		const hooks = {
			window: parent,
			show: "never",
			backgroundThrottling: false,
			root: extensionsRoot,
			// Only the reinstall phase answers (synthetic "Add", as for Remove).
			confirmInstall: async () => {
				if (consentAnswer === null)
					throw new Error("Proof must not open a consent dialog");
				return consentAnswer;
			},
			// The synthetic removal answer stands in for the native dialog's "Remove".
			confirmRemove: async () => true,
			changed() {},
			mayPresentExtensionPopup: () => false,
			workerStartupMeasured: (result) =>
				output({ boundedEngineInterval: result }),
			// Product behaviour: a worker-requested tab is a BACKGROUND user tab.
			createTab: async (url, active) => {
				const record = registry.create({ owner: "user", activate: active });
				// Scheme + path only: review U1 expects 1Password's install-time
				// welcome page (chrome-extension://…/app/app.html) to arrive here.
				const parsed = new URL(url);
				workerTabs.push({
					scheme: parsed.protocol,
					path: parsed.pathname,
					active,
					tabId: record.tabId,
				});
				void record.view.webContents.loadURL(url).catch(() => {});
				return record.view.webContents;
			},
			activeTab: () => registry.activeTab?.view.webContents ?? null,
			selectTab: (contents) => {
				const record = registry.byWebContentsId(contents.id);
				if (record?.owner === "user") registry.activate(record.tabId);
			},
			removeTab: (contents) => {
				const record = registry.byWebContentsId(contents.id);
				if (record?.owner === "user") registry.destroy(record.tabId);
			},
		};
		const timings = [];
		const firstUserTab = registry.create({ owner: "user" });
		await firstUserTab.view.webContents.loadURL("about:blank");
		for (let cycle = 0; cycle < (uiDiagnostic ? 1 : 2); cycle++) {
			const manager = new ExtensionManager(ses, hooks, binding);
			mark(`restore-${cycle}`);
			const start = performance.now();
			await manager.restore();
			timings.push(Math.round(performance.now() - start));
			const [row] = manager.list();
			const running = Object.values(ses.serviceWorkers.getAllRunning()).map(
				(worker) => worker.scope,
			);
			const stateFile = JSON.parse(
				await fs.readFile(path.join(extensionsRoot, "state.json"), "utf8"),
			);
			const legacyGone = await fs.access(legacy).then(
				() => false,
				() => true,
			);
			output({
				cycle,
				row: row && {
					id: row.id,
					name: row.name,
					version: row.version,
					status: row.status,
					error: row.error,
					hasPopup: row.hasPopup,
					hasOptions: row.hasOptions,
					allSites: row.allSites,
				},
				restoreMs: timings[cycle],
				runningWorkerScopes: running,
				migrated: !!stateFile.extensions[ID],
				legacyGone,
				workerTabs,
			});
			if (
				row?.status !== "enabled" ||
				!running.includes(`chrome-extension://${ID}/`)
			)
				throw new Error("Extension worker is not running");
			mark(`popup-${cycle}`);
			// What Chrome would open for the user's active tab right now. With no
			// account, 1Password has called action.setPopup({popup: ""}).
			// A user presses the toolbar well after start-up; the worker settles
			// its account state (and the popup) asynchronously, so wait for that
			// state, bounded, rather than racing the worker's first seconds.
			const popupOf = () =>
				binding.adapter.api.browserAction.getPopupUrl(
					ID,
					registry.activeTab.view.webContents.id,
				) ?? "";
			const settleBy = Date.now() + 20_000;
			while (popupOf() && Date.now() < settleBy)
				await new Promise((yes) => setTimeout(yes, 200));
			const runtimePopup = popupOf();
			const tabsBefore = workerTabs.length;
			const opened = await manager.openPopup(ID);
			// onClicked → the worker's tabs.create is asynchronous; bounded wait.
			const deadline = Date.now() + 15_000;
			while (
				!runtimePopup &&
				workerTabs.length === tabsBefore &&
				Date.now() < deadline
			)
				await new Promise((yes) => setTimeout(yes, 100));
			const windows = BrowserWindow.getAllWindows().map((window) => ({
				visible: window.isVisible(),
				official: isOfficialPage(window.webContents.getURL()),
				registeredUserTab: !!registry.byWebContentsId(window.webContents.id),
			}));
			const clickedTabs = workerTabs.slice(tabsBefore);
			output({
				cycle,
				opened,
				runtimePopupEmpty: !runtimePopup,
				windows,
				toolbarTabs: clickedTabs,
			});
			if (!opened || windows.some((window) => window.visible))
				throw new Error("Hidden extension popup contract failed");
			if (!runtimePopup) {
				// U1a: zero accounts → onClicked → the welcome page as a SELECTED
				// user tab (it answers the user's own press), no popup window.
				const welcome = clickedTabs.find(
					(tab) =>
						tab.scheme === "chrome-extension:" && tab.path === "/app/app.html",
				);
				if (!welcome?.active || windows.some((window) => window.official))
					throw new Error("Toolbar activation did not open the welcome tab");
				if (cycle === 0) {
					const record = registry.get(welcome.tabId);
					const view = views.get(welcome.tabId);
					// The parent stays hidden (show:false); the child view paints for
					// capture only, then is hidden again.
					await new Promise((yes) => setTimeout(yes, 4000));
					view.setVisible(true);
					await new Promise((yes) => setTimeout(yes, 500));
					const file = path.join(
						process.env.EXTENSION_EVIDENCE_ROOT ?? root,
						"welcome-tab.png",
					);
					await fs.writeFile(
						file,
						(await record.view.webContents.capturePage()).toPNG(),
					);
					view.setVisible(false);
					const text = await record.view.webContents
						.executeJavaScript("document.body ? document.body.innerText : ''")
						.catch(() => "");
					output({
						welcomeFrame: file,
						welcomeUrlPath: new URL(record.view.webContents.getURL()).pathname,
						welcomeTextLength: text.length,
						parentVisible: parent.isVisible(),
					});
				}
			} else if (!windows.some((window) => window.official))
				throw new Error("Hidden extension popup contract failed");
			if (cycle === 0 && runtimePopup) {
				const official = BrowserWindow.getAllWindows().find((window) =>
					isOfficialPage(window.webContents.getURL()),
				);
				const uiStarted = performance.now();
				// Fixed schedule: does the popup leave "Loading…" (clients.matchAll fix)?
				const frames = uiDiagnostic
					? [0, 5000, 15000, 30000, 60000, 90000]
					: [0, 5000, 15000];
				for (const frame of frames) {
					await new Promise((yes) =>
						setTimeout(
							yes,
							Math.max(0, frame - (performance.now() - uiStarted)),
						),
					);
					const file = path.join(
						process.env.EXTENSION_EVIDENCE_ROOT ?? root,
						`popup-${frame}ms.png`,
					);
					await fs.writeFile(
						file,
						(await official.webContents.capturePage()).toPNG(),
					);
					const text = await official.webContents
						.executeJavaScript("document.body ? document.body.innerText : ''")
						.catch(() => "");
					output({
						popupFrame: file,
						elapsedMs: Math.round(performance.now() - uiStarted),
						loadingText: /loading/i.test(text),
						textLength: text.length,
					});
				}
			}
			if (cycle === 1) {
				mark("disable");
				const disabled = await manager.setEnabled(ID, false);
				const afterDisable = manager.list()[0];
				const crxKept = await fs
					.access(path.join(extensionsRoot, ID, "official.crx"))
					.then(
						() => true,
						() => false,
					);
				await manager.restore();
				output({
					disabled,
					afterDisable: afterDisable.status,
					restored: manager.list()[0].status,
					crxKept,
					loaded: !!ses.extensions.getExtension(ID),
				});
				if (
					!disabled ||
					afterDisable.status !== "disabled" ||
					manager.list()[0].status !== "disabled" ||
					!crxKept ||
					ses.extensions.getExtension(ID)
				)
					throw new Error("Disable did not persist");
				mark("remove");
				// QA Q1: the extension's chrome.storage value store must go too.
				const settings = path.join(
					ses.storagePath ?? "",
					"Local Extension Settings",
					ID,
				);
				const settingsBefore = await fs.access(settings).then(
					() => true,
					() => false,
				);
				const removed = await manager.uninstall(ID);
				const settingsAfter = await fs.access(settings).then(
					() => true,
					() => false,
				);
				output({
					storageSettings: { before: settingsBefore, after: settingsAfter },
				});
				if (settingsAfter) throw new Error("chrome.storage survived Remove");
				const dirGone = await fs.access(path.join(extensionsRoot, ID)).then(
					() => false,
					() => true,
				);
				const state = JSON.parse(
					await fs.readFile(path.join(extensionsRoot, "state.json"), "utf8"),
				);
				output({
					removed,
					dirGone,
					stateEntries: Object.keys(state.extensions).length,
					list: manager.list().length,
				});
				if (!removed || !dirGone || Object.keys(state.extensions).length)
					throw new Error("Remove did not clear");
				// U1b: a consented reinstall owes exactly one onInstalled.
				mark("reinstall");
				const crx = await fs.readFile(path.join(root, "official.crx"));
				const realFetch = globalThis.fetch;
				globalThis.fetch = async () => new Response(crx);
				consentAnswer = true;
				const before = installedEvents;
				const tabsBefore = workerTabs.length;
				const installed = await manager.installFromStore(ID);
				globalThis.fetch = realFetch;
				consentAnswer = null;
				const until = Date.now() + 20_000;
				while (installedEvents === before && Date.now() < until)
					await new Promise((yes) => setTimeout(yes, 100));
				// Give the worker time to answer onInstalled with its welcome tab.
				await new Promise((yes) => setTimeout(yes, 5000));
				const saved = JSON.parse(
					await fs.readFile(path.join(extensionsRoot, "state.json"), "utf8"),
				);
				output({
					installed,
					onInstalledCount: installedEvents - before,
					installEventCleared: saved.extensions[ID]?.installEvent === undefined,
					installTabs: workerTabs.slice(tabsBefore),
				});
				if (
					installed !== "success" ||
					installedEvents - before !== 1 ||
					saved.extensions[ID]?.installEvent !== undefined
				)
					throw new Error("onInstalled was not delivered exactly once");
				mark("reinstall-restart");
				await manager.dispose();
				const again = new ExtensionManager(ses, hooks, binding);
				await again.restore();
				await new Promise((yes) => setTimeout(yes, 3000));
				output({
					restartStatus: again.list()[0]?.status,
					onInstalledTotalAfterRestart: installedEvents - before,
				});
				if (installedEvents - before !== 1)
					throw new Error("onInstalled re-fired on restart");
				await again.dispose();
				continue;
			}
			mark(`manager-dispose-${cycle}`);
			await manager.dispose();
		}
		mark("registry-destroy-all");
		registry.destroyAll();
		mark("registry-destroyed");
		mark("parent-close");
		parent.close();
		mark("parent-closed");
		mark("app-exit-zero");
		process.stdout.write(
			`${JSON.stringify({ result: uiDiagnostic ? "UI_DIAGNOSTIC_CAPTURED" : "PASS", timingsMs: timings, visibleWindows: BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length })}\n`,
			() => app.exit(0),
		);
	})
	.catch(fail);
