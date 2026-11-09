/* Native half of extension-native-proof.mjs. Exercises the ACTUAL product
 * ExtensionManager + adapter binding + TabRegistry on real Electron: legacy-layout
 * migration, verified restore, MV3 worker readiness, hidden popup frames, a
 * worker-requested tab, disable/restore and remove. Not whole-desktop-renderer
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
	output({ result: "FAIL", phase, category: error?.name ?? "Error" });
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
		const hooks = {
			window: parent,
			show: "never",
			backgroundThrottling: false,
			root: extensionsRoot,
			confirmInstall: async () => {
				throw new Error("Proof must not open a consent dialog");
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
				workerTabs.push({ origin: new URL(url).origin, active });
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
			const opened = await manager.openPopup(ID);
			const windows = BrowserWindow.getAllWindows().map((window) => ({
				visible: window.isVisible(),
				official: isOfficialPage(window.webContents.getURL()),
				registeredUserTab: !!registry.byWebContentsId(window.webContents.id),
			}));
			output({ cycle, opened, windows });
			if (
				!opened ||
				windows.some((window) => window.visible) ||
				!windows.some((window) => window.official)
			)
				throw new Error("Hidden extension popup contract failed");
			if (cycle === 0) {
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
				const removed = await manager.uninstall(ID);
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
