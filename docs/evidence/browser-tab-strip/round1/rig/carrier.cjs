// Scratch observation only: no focus/visibility overrides, no product-source patch.
// The real owning-window/frame/URL authorization and primitive handlers run intact.
const E = require("electron");
const rawHandle = E.ipcMain.handle.bind(E.ipcMain);
const rects = [];
E.ipcMain.handle = (channel, handler) =>
	rawHandle(
		channel,
		channel === "browser-set-content-rect"
			? (event, ...args) => {
					const result = handler(event, ...args);
					rects.push(args[0]);
					return result;
				}
			: handler,
	);
const ownWindow = () =>
	E.BrowserWindow.getAllWindows().find(
		(w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"),
	);
globalThis.__b = {
	facts() {
		return {
			userData: E.app.getPath("userData"),
			appPath: E.app.getAppPath(),
			focusedWindow: E.BrowserWindow.getFocusedWindow()?.id ?? null,
			windows: E.BrowserWindow.getAllWindows().map((w) => ({
				id: w.id,
				visible: w.isVisible(),
				focused: w.isFocused(),
				bounds: w.getContentBounds(),
				url: w.webContents.getURL(),
			})),
		};
	},
	bounds() {
		const w = ownWindow(),
			registered = rects.at(-1);
		const candidates = w.contentView.children
			.filter((v) => v.webContents && v.webContents !== w.webContents)
			.map((v) => ({
				id: v.webContents.id,
				url: v.webContents.getURL(),
				bounds: v.getBounds(),
				visible: typeof v.getVisible === "function" ? v.getVisible() : null,
			}));
		const active =
			registered &&
			candidates.find((c) =>
				["x", "y", "width", "height"].every(
					(k) => Math.abs(c.bounds[k] - registered[k]) <= 1,
				),
			);
		if (!active) throw Error("no actual native view matches registered rect");
		return {
			registered,
			actual: active.bounds,
			visible: active.visible,
			contentsId: active.id,
			appZoom: w.webContents.getZoomFactor(),
		};
	},
	resize(width, height) {
		const w = ownWindow();
		w.setContentSize(width, height);
		return w.getContentBounds();
	},
	menus() {
		const rows = [];
		const walk = (m) => {
			for (const i of m.items) {
				if (i.accelerator)
					rows.push({ id: i.id, role: i.role, accelerator: i.accelerator });
				if (i.submenu) walk(i.submenu);
			}
		};
		walk(E.Menu.getApplicationMenu());
		return rows;
	},
	async senderNegatives() {
		const w = ownWindow(),
			guest = E.webContents
				.getAllWebContents()
				.find(
					(c) =>
						!c.isDestroyed() &&
						c !== w.webContents &&
						c.getURL().startsWith("http://127.0.0.1:"),
				);
		if (!guest) throw Error("no real fixture guest");
		const out = [];
		for (const [channel, args] of [
			["browser-reorder-tabs", [[1]]],
			["browser-tab-action", [1, "reload"]],
		]) {
			const h = E.ipcMain._invokeHandlers.get(channel);
			try {
				await h({ sender: guest, senderFrame: guest.mainFrame }, ...args);
				out.push({ channel, refused: false });
			} catch (e) {
				out.push({ channel, refused: true, message: e.message });
			}
		}
		return out;
	},
};
// Observation only: forward original inputs/promises; no focus/visibility override.
const loads = [],
	actions = [];
E.app.on("web-contents-created", (_event, c) => {
	const original = c.loadURL.bind(c);
	c.loadURL = (url, ...args) => {
		const row = {
			contentsId: c.id,
			url,
			startedAt: Date.now(),
			status: "pending",
		};
		loads.push(row);
		return original(url, ...args).then(
			(value) => {
				row.status = "completed";
				row.settledAt = Date.now();
				return value;
			},
			(error) => {
				row.status = "failed";
				row.code = error.code;
				row.settledAt = Date.now();
				throw error;
			},
		);
	};
});
const actionHandle = E.ipcMain.handle.bind(E.ipcMain);
E.ipcMain.handle = (channel, handler) =>
	actionHandle(
		channel,
		channel === "browser-tab-action"
			? (event, ...args) => {
					const row = {
						sourceId: args[0],
						action: args[1],
						startedAt: Date.now(),
						status: "pending",
						before: __b.snapshot(),
						loadsBefore: loads.length,
					};
					actions.push(row);
					return Promise.resolve()
						.then(() => handler(event, ...args))
						.then(
							(outcome) => {
								row.status = "settled";
								row.outcome = outcome;
								row.after = __b.snapshot();
								row.loads = loads.slice(row.loadsBefore);
								row.settledAt = Date.now();
								return outcome;
							},
							(error) => {
								row.status = "rejected";
								row.message = error.message;
								row.settledAt = Date.now();
								throw error;
							},
						);
				}
			: handler,
	);
__b.actions = actions;
__b.loads = loads;
__b.snapshot = () => {
	const w = ownWindow(),
		h = E.ipcMain._invokeHandlers.get("browser-state");
	const s = h({ sender: w.webContents, senderFrame: w.webContents.mainFrame });
	return {
		activeTabId: s.activeTabId,
		tabs: s.tabs.map((t) => ({
			tabId: t.tabId,
			owner: t.owner,
			sessionId: t.sessionId,
			handedOver: t.handedOver,
			url: t.url,
			title: t.title,
			failed: t.failed,
			active: t.active,
		})),
	};
};

require("/Users/damian/local-operator-ui/.worktrees/browser-tab-strip/out/main/index.js");
