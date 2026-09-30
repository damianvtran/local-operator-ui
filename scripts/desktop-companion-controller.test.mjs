import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs, {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import sharp from "sharp";

// Run the actual controller with Electron and timers replaced.
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const bundle = buildSync({
	entryPoints: [join(root, "src/main/desktop-companion.ts")],
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	external: ["electron"],
}).outputFiles[0].text;

const UNAVAILABLE_CHARACTER = /no longer available/;
const SAVE_FAILED = /could not be saved/;
const IMPORT_FAILED = /Could not save/;

const ok = (result) => ({ status: 200, body: { result } });

function fixture(t, { headless = true, preferences = {} } = {}) {
	const directory = mkdtempSync(join(tmpdir(), "companion-controller-"));
	const preferencesPath = join(directory, "preferences.json");
	if (preferences)
		writeFileSync(
			preferencesPath,
			JSON.stringify({ enabled: true, ...preferences }),
		);
	const handlers = new Map();
	const ipcMain = new EventEmitter();
	ipcMain.handle = (name, handler) => handlers.set(name, handler);
	ipcMain.removeHandler = (name) => handlers.delete(name);
	const timeouts = new Map();
	const intervals = new Map();
	let timerId = 0;
	let now = 0;
	const windows = [];
	const menus = [];
	const Menu = {
		buildFromTemplate: (template) => {
			const menu = {
				template,
				popup(options) {
					this.popupOptions = options;
				},
			};
			menus.push(menu);
			return menu;
		},
	};
	let cursor = { x: 400, y: 400 };
	let workArea = { x: 0, y: 0, width: 1920, height: 1080 };
	const screen = new EventEmitter();
	screen.getPrimaryDisplay = screen.getDisplayMatching = () => ({
		workArea,
	});
	screen.getCursorScreenPoint = () => cursor;
	class FakeWindow extends EventEmitter {
		constructor(options) {
			super();
			this.options = options;
			this.position = [options.x, options.y];
			this.size = { width: options.width, height: options.height };
			this.destroyed = false;
			this.hidden = true;
			this.presentations = [];
			this.messages = [];
			this.boundsChanges = 0;
			this.webContents = new EventEmitter();
			this.zoomFactor = options.webPreferences.zoomFactor;
			this.webContents.getZoomFactor = () => this.zoomFactor;
			this.webContents.setZoomFactor = (factor) => {
				this.zoomFactor = factor;
			};
			this.webContents.mainFrame = { url: "" };
			this.webContents.send = (...message) => this.messages.push(message);
			this.webContents.setWindowOpenHandler = (handler) => {
				this.popup = handler;
			};
			windows.push(this);
		}
		loadURL(url) {
			this.webContents.mainFrame.url = url;
			return Promise.resolve();
		}
		isDestroyed() {
			return this.destroyed;
		}
		isMinimized() {
			return false;
		}
		hide() {
			this.hidden = true;
		}
		setVisibleOnAllWorkspaces(...args) {
			this.workspaces = args;
		}
		setIgnoreMouseEvents(value) {
			this.ignoresMouse = value;
		}
		setPosition(x, y) {
			assert.ok(Number.isFinite(x) && Number.isFinite(y));
			this.position = [x, y];
		}
		getPosition() {
			return this.position;
		}
		getBounds() {
			return { x: this.position[0], y: this.position[1], ...this.size };
		}
		setBounds({ x, y, width, height }) {
			this.boundsChanges++;
			assert.ok([x, y, width, height].every(Number.isFinite));
			this.setPosition(x, y);
			this.size = { width, height };
		}
		destroy() {
			if (this.destroyed) return;
			this.destroyed = true;
			this.emit("closed");
		}
		showInactive() {
			this.hidden = false;
			this.presentations.push("inactive");
		}
		show() {
			this.hidden = false;
			this.presentations.push("show");
		}
		focus() {
			this.presentations.push("focus");
		}
	}
	const module = { exports: {} };
	runInNewContext(bundle, {
		module,
		exports: module.exports,
		require: (name) =>
			name === "electron"
				? { ipcMain, BrowserWindow: FakeWindow, screen, Menu }
				: require(name),
		process,
		console,
		Buffer,
		Date: class extends Date {
			static now() {
				return now;
			}
		},
		setTimeout: (callback, delay = 0) => {
			const id = ++timerId;
			timeouts.set(id, { callback, due: now + delay });
			return id;
		},
		clearTimeout: (id) => timeouts.delete(id),
		setInterval: (fn) => {
			const id = ++timerId;
			intervals.set(id, fn);
			return id;
		},
		clearInterval: (id) => intervals.delete(id),
	});
	const requests = [];
	const desktopRequests = [];
	let admitted = false;
	const opened = [];
	const visibility = [];
	let settingsChanges = 0;
	let publishingBroken = false;
	const writtenChoices = [];
	const companion = new module.exports.DesktopCompanion({
		url: "file:///test/companion.html",
		preload: "/test/companion.js",
		preferencesPath,
		skinsDirectory: join(directory, "skins"),
		headless,
		cwd: directory,
		requestDesktop: async (input) => {
			desktopRequests.push(input);
			if (input.op === "capabilities")
				return ok({ desktop_available: true, features: { aida: 1 } });
			if (input.op === "aida.status")
				return ok({ enabled: true, session_id: "012345abcdef", paused: true });
			if (input.op === "sessions.create")
				return ok({ session_id: "012345abcdef" });
			if (input.op === "sessions.message") {
				admitted = true;
				return ok({ status: "admitted", command_id: input.requestId });
			}
			assert.equal(input.op, "sessions.get");
			return ok({
				session_id: input.sessionId,
				payload: {
					frontend: {
						snapshot: {
							session_id: input.sessionId,
							streaming: admitted,
							pending_gate: null,
							epoch: "test-owner",
							generation: admitted ? 1 : 0,
						},
					},
					history: { entries: [] },
				},
			});
		},
		readCatalogue: () =>
			new Promise((resolve, reject) => requests.push({ resolve, reject })),
		openChat: (id) => opened.push(id),
		visibilityChanged: (enabled) => visibility.push(enabled),
		appearanceChanged: () => {},
		settingsChanged: () => {
			if (publishingBroken) throw new Error("Fixture closed renderer");
			settingsChanges++;
			writtenChoices.push(JSON.parse(readFileSync(preferencesPath, "utf8")));
		},
		report: () => {},
	});
	t.after(() => {
		companion.dispose();
		rmSync(directory, { recursive: true, force: true });
	});
	const trusted = (window = windows.at(-1)) => ({
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame,
	});
	const flush = async () => {
		for (const [id, { callback }] of [...timeouts]) {
			timeouts.delete(id);
			callback();
		}
		await settle();
	};
	const advance = async (milliseconds) => {
		const target = now + milliseconds;
		for (;;) {
			const next = [...timeouts].sort((a, b) => a[1].due - b[1].due)[0];
			if (!next || next[1].due > target) break;
			now = next[1].due;
			timeouts.delete(next[0]);
			next[1].callback();
			await settle();
		}
		now = target;
	};
	return {
		companion,
		preferencesPath,
		libraryPath: join(directory, "skins"),
		windows,
		menus,
		handlers,
		ipcMain,
		screen,
		requests,
		desktopRequests,
		opened,
		visibility,
		settingsChanges: () => settingsChanges,
		writtenChoices,
		breakPublishing: () => {
			publishingBroken = true;
		},
		breakPersistence: () => rmSync(directory, { recursive: true, force: true }),
		blockPreferenceWrites: () => mkdirSync(`${preferencesPath}.tmp`),
		unblockPreferenceWrites: () =>
			rmSync(`${preferencesPath}.tmp`, { recursive: true, force: true }),
		intervals,
		timeouts,
		flush,
		advance,
		elapse: (milliseconds) => {
			now += milliseconds;
		},
		catalogue: async (code, id) => {
			await flush();
			requests.shift().resolve(catalogue(code, id));
			await settle();
		},
		preferences: () => JSON.parse(readFileSync(preferencesPath, "utf8")),
		trusted,
		state: () => handlers.get("companion:get-state")(trusted()),
		chat: () => handlers.get("companion:get-chat")(trusted()),
		chatMenu: (event = trusted(), position = { x: 120, y: 64 }) =>
			handlers.get("companion:chat-menu")(event, position),
		send: (text, event = trusted()) =>
			handlers.get("companion:send")(event, text),
		action: (action, value, event = trusted()) =>
			ipcMain.emit("companion:action", event, action, value),
		cursor: (point) => {
			cursor = point;
		},
		workArea: (area) => {
			workArea = area;
		},
	};
}

function catalogue(code, id = "session-a") {
	return ok({
		sessions: [{ id, status: { code }, attention: { unseen: true } }],
		degraded: [],
	});
}

function drag(f, dx = -40, dy = -80, finish = "end") {
	f.cursor({ x: 400, y: 400 });
	f.action("drag", "start");
	f.cursor({ x: 400 + dx, y: 400 + dy });
	f.action("drag", "move");
	if (finish === "blur") f.windows[0].emit("blur");
	else if (finish === "menu") f.action("menu");
	else f.action("drag", finish);
}

function motion(window) {
	return window.messages
		.filter(([channel]) => channel === "companion:motion")
		.map(([, phase]) => phase);
}

test("headless companion never presents or changes desktop workspaces", async (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	window.emit("ready-to-show");
	assert.equal(window.options.show, false);
	assert.equal(window.options.focusable, false);
	assert.equal(window.options.webPreferences.backgroundThrottling, false);
	assert.equal(window.options.webPreferences.zoomMode, "isolated");
	assert.equal(window.options.webPreferences.zoomFactor, 1);
	assert.deepEqual(window.presentations, []);
	assert.equal(window.workspaces, undefined);
	f.action("menu");
	assert.equal(await f.chatMenu(), false);
	assert.deepEqual(f.menus, []);
	f.action("open");
	assert.equal(f.chat().open, true);
	assert.deepEqual(window.presentations, []);
	await settle();
	assert.deepEqual(
		f.desktopRequests.map((request) => request.op),
		["capabilities", "aida.status", "sessions.get"],
	);
});

test("visible companion presents once without focus and accepts the first click", (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	window.emit("ready-to-show");
	window.emit("ready-to-show");
	assert.deepEqual(window.presentations, ["inactive"]);
	assert.equal(window.options.acceptFirstMouse, true);
	assert.equal(window.options.focusable, true);
	assert.equal(window.options.webPreferences.backgroundThrottling, true);
	assert.equal(window.options.alwaysOnTop, true);
	assert.equal(window.workspaces[1].skipTransformProcessType, true);
	assert.equal(window.options.type, undefined);
});

test("re-show restores the selected character when bootstrap finished while hidden", async (t) => {
	const f = fixture(t, { preferences: { character: "inky" } });
	const window = f.windows[0];
	await f.catalogue("answer");
	f.companion.setEnabled(false);
	for (const channel of ["get-state", "get-appearance", "get-chat"])
		assert.equal(f.handlers.get(`companion:${channel}`)(f.trusted()), null);
	window.emit("ready-to-show");
	window.messages.length = 0;
	f.companion.setEnabled(true);
	assert.deepEqual(
		window.messages.map(([channel]) => channel),
		["companion:appearance", "companion:state", "companion:chat"],
	);
	assert.equal(window.messages[0][1].id, "inky");
	assert.equal(window.messages[1][1].notifications[0].kind, "answer");
	assert.deepEqual(window.messages[2][1], f.chat());
	assert.equal(window.messages[2][1].open, false);
	assert.equal(f.windows.length, 1);
	assert.deepEqual(window.presentations, []);
});

test("IPC requires this companion's exact top-level document and rejects malformed actions", async (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	assert.equal(window.options.webPreferences.sandbox, true);
	assert.equal(window.options.webPreferences.nodeIntegration, false);
	assert.equal(window.options.webPreferences.contextIsolation, true);
	assert.equal(window.popup().action, "deny");
	for (const channel of ["will-navigate", "will-attach-webview"]) {
		let prevented = false;
		window.webContents.emit(channel, {
			preventDefault: () => {
				prevented = true;
			},
		});
		assert.equal(prevented, true);
	}
	for (const event of [
		{ sender: {}, senderFrame: window.webContents.mainFrame },
		{
			sender: window.webContents,
			senderFrame: { url: "file:///test/companion.html" },
		},
		{ sender: window.webContents, senderFrame: null },
	]) {
		for (const action of ["open", "open-task", "expand-chat", "hide"])
			f.action(action, undefined, event);
		for (const channel of ["get-state", "get-appearance", "get-chat"])
			assert.equal(f.handlers.get(`companion:${channel}`)(event), null);
		assert.equal(await f.send("Should not send", event), false);
		assert.equal(await f.chatMenu(event), false);
	}
	window.webContents.mainFrame.url = "https://example.invalid/";
	f.action("open");
	assert.equal(f.handlers.get("companion:get-state")(f.trusted()), null);
	assert.equal(f.handlers.get("companion:get-chat")(f.trusted()), null);
	assert.equal(await f.send("Should not send"), false);
	window.webContents.mainFrame.url = "file:///test/companion.html";
	const position = [...window.position];
	for (const value of [
		"__proto__",
		"constructor",
		"toString",
		"noSuchArrow",
		null,
		{},
		42,
	]) {
		assert.doesNotThrow(() => f.action("nudge", value));
	}
	f.action("interactive", "true");
	f.action("drag", "unexpected");
	f.action("unknown-action", "open");
	assert.equal(f.companion.enabled, true);
	assert.equal(window.ignoresMouse, true);
	assert.deepEqual(window.position, position);
	assert.deepEqual(f.opened, []);
	assert.equal(await f.send("Chat is collapsed"), false);
	assert.deepEqual(f.desktopRequests, []);
	f.action("open");
	await settle();
	const reads = [...f.desktopRequests];
	assert.equal(f.chat().open, true);
	assert.deepEqual(f.opened, []);
	for (const value of [null, {}, 42, ["text"]])
		assert.equal(await f.send(value), false);
	assert.deepEqual(f.desktopRequests, reads);
});

test("unrelated feed frames skip catalogue and chat reads while session changes and the safety poll still refresh", async (t) => {
	const f = fixture(t);
	await f.catalogue("idle");
	f.action("open");
	await settle();
	const reads = [...f.desktopRequests];
	for (const type of ["heartbeat", "authoring"]) {
		f.companion.refresh({ type });
		await f.flush();
		assert.equal(f.requests.length, 0);
	}
	assert.deepEqual(f.desktopRequests, reads);
	for (const type of [
		"open",
		"gap",
		"catalogue",
		"session_status",
		"attention",
		"notification",
	]) {
		f.companion.refresh({ type });
		await f.flush();
		assert.equal(f.requests.length, 1, type);
		f.requests.shift().resolve(catalogue("answer"));
		await settle();
		assert.equal(f.state().notifications[0].kind, "answer");
	}
	assert.equal(f.intervals.size, 1);
	for (const poll of f.intervals.values()) poll();
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.requests.shift().resolve({ status: 503 });
	await settle();
	assert.equal(f.state().mood, "offline");
	f.companion.refresh();
	await f.catalogue("idle");
	assert.equal(f.state().mood, "idle");
	f.companion.setEnabled(false);
	f.companion.refresh({ type: "notification" });
	await f.flush();
	assert.equal(f.requests.length, 0);
	assert.equal(f.intervals.size, 0);
});

test("the conversation menu cancels quietly and explicitly returns to the shared chief", async (t) => {
	const f = fixture(t, { headless: false });
	assert.equal(await f.chatMenu(), false, "collapsed chat has no menu");
	f.action("open");
	await settle();
	const before = JSON.stringify(f.chat());
	const requestCount = f.desktopRequests.length;
	let choice = f.chatMenu();
	let menu = f.menus.at(-1);
	assert.deepEqual(
		Array.from(menu.template, (item) => item.label),
		["Chief of staff", "New chat"],
	);
	assert.equal(menu.template[0].enabled, false);
	assert.ok(menu.template.every((item) => !item.type));
	assert.equal(menu.popupOptions.x, 120);
	assert.equal(menu.popupOptions.y, 64);
	menu.popupOptions.callback();
	assert.equal(await choice, false);
	assert.equal(JSON.stringify(f.chat()), before);
	assert.equal(f.desktopRequests.length, requestCount);
	choice = f.chatMenu();
	menu = f.menus.at(-1);
	menu.template[1].click();
	menu.popupOptions.callback();
	assert.equal(await choice, true);
	assert.equal(f.chat().snapshot.destination, undefined);
	assert.equal(f.desktopRequests.length, requestCount, "New chat is lazy");
	choice = f.chatMenu();
	menu = f.menus.at(-1);
	assert.equal(menu.template[0].enabled, true);
	menu.template[0].click();
	menu.popupOptions.callback();
	assert.equal(await choice, true);
	await settle();
	assert.equal(f.chat().snapshot.destination, "chief-of-staff");
	assert.equal(f.chat().snapshot.sessionId, "012345abcdef");
	assert.equal(
		f.desktopRequests.some(
			(call) => call.op === "aida.control" || call.op === "sessions.create",
		),
		false,
	);
});

test("a conversation menu cannot switch after sending begins or its window closes", async (t) => {
	for (const block of ["send", "collapse", "hide"]) {
		const f = fixture(t, { headless: false });
		f.action("open");
		await settle();
		const choice = f.chatMenu();
		const menu = f.menus.at(-1);
		if (block === "send") assert.equal(await f.send("Keep my turn"), true);
		else f.action(block === "hide" ? "hide" : "collapse-chat");
		menu.template[1].click();
		menu.popupOptions.callback();
		assert.equal(await choice, false);
		if (block !== "hide") {
			assert.equal(f.chat().snapshot.destination, "chief-of-staff");
			assert.equal(await f.chatMenu(), false);
		}
	}
});

test("catalogue reads coalesce and serialize, then reject responses from a disabled generation", async (t) => {
	const f = fixture(t);
	f.companion.refresh();
	f.companion.refresh();
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.companion.refresh();
	f.companion.refresh();
	assert.equal(f.timeouts.size, 0);
	f.requests.shift().resolve(catalogue("busy"));
	await settle();
	assert.equal(f.state().mood, "working");
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.companion.setEnabled(false);
	f.companion.setEnabled(true);
	f.requests.shift().resolve(catalogue("complete", "old-session"));
	await settle();
	assert.equal(
		f.windows
			.at(-1)
			.messages.some((message) => message[1]?.sessionId === "old-session"),
		false,
	);
	await f.flush();
	assert.equal(f.requests.length, 1);
	f.requests.shift().resolve(catalogue("approval", "new-session"));
	await settle();
	assert.equal(f.state().sessionId, "new-session");
	f.companion.refresh();
	await f.flush();
	f.requests.shift().reject(new Error("Connection lost"));
	await settle();
	assert.equal(f.state().mood, "offline");
	assert.equal(f.state().sessionId, null);
});

test("dragging moves and saves; clicks and small jitters never open chat", async (t) => {
	const f = fixture(t);
	await f.catalogue("busy");
	const window = f.windows[0];
	const [x, y] = window.position;
	f.action("drag", "start");
	f.action("interactive", false);
	assert.equal(window.ignoresMouse, false);
	f.cursor({ x: 360, y: 350 });
	f.action("drag", "move");
	f.action("drag", "end");
	assert.deepEqual(window.position, [x - 40, y - 50]);
	assert.deepEqual(f.preferences().position, { x: x - 40, y: y - 50 });
	assert.equal(f.chat().open, false);
	f.action("drag", "start");
	f.cursor({ x: 363, y: 352 });
	f.action("drag", "move");
	f.action("drag", "end");
	assert.equal(f.chat().open, false);
	assert.deepEqual(window.position, [x - 40, y - 50]);
	assert.deepEqual(f.desktopRequests, []);
	f.action("collapse-chat");
	f.action("drag", "start");
	window.emit("blur");
	f.action("drag", "end");
	assert.equal(f.chat().open, false);
	f.action("interactive", false);
	assert.equal(window.ignoresMouse, true);
	f.action("interactive", true);
	assert.equal(window.ignoresMouse, false);
	f.action("nudge", "ArrowLeft");
	assert.equal(window.position[0], x - 64);
});

test("a released drag falls, bounces and saves its settled position without focus", async (t) => {
	const f = fixture(t, { headless: false });
	await f.flush();
	const window = f.windows[0];
	window.emit("ready-to-show");
	f.action("reduced-motion", false);
	drag(f);
	const [x, y] = window.position;
	const released = f.preferences().position;
	assert.deepEqual(motion(window), ["falling"]);
	f.action("drag", "cancel"); // Lost pointer capture follows a normal release.
	await f.advance(130);
	assert.ok(window.position[1] > y && window.position[1] < y + 24);
	assert.deepEqual(f.preferences().position, released);
	await f.advance(130);
	assert.deepEqual(window.position, [x, y + 48]);
	assert.deepEqual(motion(window), ["falling", "landing"]);
	await f.advance(70);
	assert.ok(window.position[1] >= y + 43 && window.position[1] < y + 48);
	await f.advance(70);
	assert.deepEqual(window.position, [x, y + 48]);
	await f.advance(379);
	assert.deepEqual(motion(window), ["falling", "landing"]);
	await f.advance(1);
	assert.deepEqual(motion(window), ["falling", "landing", "rest"]);
	assert.deepEqual(f.preferences().position, { x, y: y + 48 });
	assert.equal(f.timeouts.size, 0);
	assert.deepEqual(window.presentations, ["inactive"]);
	assert.equal(f.chat().open, false);
});

test("drop is opt-in to trusted motion preference and requires a real release", async (t) => {
	for (const preference of [undefined, true, "false", null, "foreign"]) {
		const f = fixture(t);
		await f.flush();
		if (preference === "foreign")
			f.action("reduced-motion", false, { sender: {}, senderFrame: null });
		else f.action("reduced-motion", preference);
		drag(f);
		const window = f.windows[0];
		const position = [...window.position];
		await f.advance(1000);
		assert.deepEqual(window.position, position);
		assert.deepEqual(motion(window), []);
		assert.equal(f.timeouts.size, 0);
	}
	for (const finish of ["click", "jitter", "cancel", "blur", "menu"]) {
		const f = fixture(t);
		await f.flush();
		f.action("reduced-motion", false);
		if (finish === "click") drag(f, 0, 0);
		else if (finish === "jitter") drag(f, 3, 2);
		else drag(f, -40, -80, finish);
		f.action("drag", "end");
		await f.advance(1000);
		assert.deepEqual(motion(f.windows[0]), [], finish);
		assert.equal(f.timeouts.size, 0, finish);
	}
});

test("drop respects the display floor and elapsed time after a delayed frame", async (t) => {
	const f = fixture(t);
	await f.flush();
	const window = f.windows[0];
	f.action("reduced-motion", false);
	f.workArea({ x: -1920, y: -100, width: 1920, height: 1080 });
	f.screen.emit("display-metrics-changed");
	window.setPosition(-200, 834); // Ten pixels above this display's floor.
	drag(f, -40, 0);
	const x = window.position[0];
	f.elapse(900);
	await f.flush();
	assert.deepEqual(window.position, [x, 844]);
	assert.deepEqual(f.preferences().position, { x, y: 844 });
	assert.deepEqual(motion(window), ["falling", "landing", "rest"]);
	drag(f, -40, 0);
	assert.equal(f.timeouts.size, 0);
	assert.deepEqual(motion(window), ["falling", "landing", "rest"]);
});

test("interruptions freeze and persist a drop, including already queued frames", async (t) => {
	for (const interruption of [
		"drag",
		"hide",
		"dispose",
		"display",
		"nudge",
		"menu",
		"chat-size",
		"reduced-motion",
		"blur",
		"close",
	]) {
		const f = fixture(t);
		await f.flush();
		const window = f.windows[0];
		if (interruption === "chat-size") f.action("open");
		f.action("reduced-motion", false);
		drag(f);
		await f.advance(128);
		const staleFrame = [...f.timeouts.values()][0].callback;
		if (interruption === "dispose") f.companion.dispose();
		else if (interruption === "display")
			f.screen.emit("display-metrics-changed");
		else if (interruption === "blur") window.emit("blur");
		else if (interruption === "close") window.destroy();
		else {
			const values = {
				drag: "start",
				nudge: "ArrowLeft",
				"chat-size": 250,
				"reduced-motion": true,
			};
			f.action(interruption, values[interruption]);
		}
		const position = [...window.position];
		staleFrame();
		await f.advance(1000);
		assert.deepEqual(window.position, position, interruption);
		assert.deepEqual(
			f.preferences().position,
			{
				x: position[0] + window.size.width - 132,
				y: position[1] + window.size.height - 136,
			},
			interruption,
		);
		assert.equal(f.timeouts.size, 0, interruption);
		if (interruption !== "close")
			assert.equal(motion(window).at(-1), "rest", interruption);
		assert.deepEqual(window.presentations, [], interruption);
	}
});

test("inline chat preserves its lower-right anchor through collapse and dragging", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	const before = window.getBounds();
	f.action("open");
	const expanded = window.getBounds();
	assert.deepEqual(window.size, { width: 316, height: 194 });
	assert.equal(expanded.x + expanded.width, before.x + before.width);
	assert.equal(expanded.y + expanded.height, before.y + before.height);
	assert.deepEqual(f.preferences().position, { x: before.x, y: before.y });
	f.action("nudge", "ArrowLeft");
	f.action("nudge", "ArrowUp");
	f.action("collapse-chat");
	assert.deepEqual(window.getBounds(), {
		...before,
		x: before.x - 24,
		y: before.y - 24,
	});
	assert.equal(f.chat().open, false);
	assert.deepEqual(f.preferences().position, {
		x: before.x - 24,
		y: before.y - 24,
	});
});

test("clamped chat expansion and reply resizing restore the intended pet position at every corner", (t) => {
	for (const position of [
		{ x: 0, y: 0 },
		{ x: 1788, y: 0 },
		{ x: 0, y: 944 },
		{ x: 1788, y: 944 },
	]) {
		const f = fixture(t, { preferences: { position } });
		const window = f.windows[0];
		const before = window.getBounds();
		for (const close of ["collapse-chat", "hide"]) {
			f.action("open");
			for (const height of [330, 194, 360]) {
				f.action("chat-size", height);
				const bounds = window.getBounds();
				assert.ok(bounds.x >= 0 && bounds.y >= 0);
				assert.ok(bounds.x + bounds.width <= 1920);
				assert.ok(bounds.y + bounds.height <= 1080);
				assert.deepEqual(f.preferences().position, position);
			}
			f.action(close);
			assert.deepEqual(window.getBounds(), before);
			assert.deepEqual(f.preferences().position, position);
		}
	}
});

test("only actual movement replaces a clamped chat's intended anchor", (t) => {
	const f = fixture(t, { preferences: { position: { x: 0, y: 0 } } });
	const window = f.windows[0];
	f.action("open");
	f.action("nudge", "ArrowLeft");
	f.action("nudge", "ArrowUp");
	drag(f, 3, 2);
	f.action("collapse-chat");
	assert.deepEqual(window.position, [0, 0]);
	f.action("open");
	f.action("nudge", "ArrowRight");
	f.action("chat-size", 330);
	f.action("collapse-chat");
	assert.deepEqual(window.position, [208, 58]);
	assert.deepEqual(f.preferences().position, { x: 208, y: 58 });
	f.action("open");
	drag(f, 40, 50);
	f.action("collapse-chat");
	assert.deepEqual(window.position, [248, 244]);
	assert.deepEqual(f.preferences().position, { x: 248, y: 244 });
});

test("chat layout stays within a changed display work area", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	const before = window.getBounds();
	f.action("open");
	f.action("chat-size", 360);
	f.workArea({ x: -260, y: -80, width: 260, height: 240 });
	f.screen.emit("display-metrics-changed");
	assert.deepEqual(window.getBounds(), {
		x: -211,
		y: -80,
		width: 211,
		height: 240,
	});
	assert.ok(window.size.width / window.zoomFactor >= 316);
	assert.ok(window.size.height / window.zoomFactor >= 360);
	f.action("collapse-chat");
	assert.deepEqual(window.getBounds(), {
		x: -132,
		y: 24,
		width: 132,
		height: 136,
	});
	f.workArea({ x: 0, y: 0, width: 1920, height: 1080 });
	f.screen.emit("display-metrics-changed");
	assert.deepEqual(window.getBounds(), before);
	assert.deepEqual(f.preferences().position, { x: before.x, y: before.y });
});

test("launching without the saved monitor retains its anchor until display-added restores it", (t) => {
	const intended = { x: 2000, y: 20 };
	const f = fixture(t, { preferences: { position: intended } });
	assert.deepEqual(f.windows[0].position, [1788, 20]);
	assert.deepEqual(f.preferences().position, intended);
	f.action("open");
	f.action("chat-size", 330);
	f.action("collapse-chat");
	assert.deepEqual(f.windows[0].position, [1788, 20]);
	assert.deepEqual(f.preferences().position, intended);
	const restarted = fixture(t, { preferences: f.preferences() });
	for (const instance of [f, restarted]) {
		const window = instance.windows[0];
		instance.action("open");
		const changes = window.boundsChanges;
		instance.workArea({ x: 1920, y: 0, width: 1920, height: 1080 });
		instance.screen.emit("display-added");
		assert.equal(window.boundsChanges, changes + 1);
		assert.equal(window.position[0], 1920);
		instance.action("collapse-chat");
		assert.deepEqual(window.position, [intended.x, intended.y]);
		assert.deepEqual(instance.preferences().position, intended);
		instance.workArea({ x: 0, y: 0, width: 1920, height: 1080 });
		instance.screen.emit("display-removed");
		assert.deepEqual(window.position, [1788, 20]);
		assert.deepEqual(instance.preferences().position, intended);
		instance.workArea({ x: 1920, y: 0, width: 1920, height: 1080 });
		instance.screen.emit("display-added");
		assert.deepEqual(window.position, [intended.x, intended.y]);
	}
});

test("chat close and work-area changes end a drag before its stale cursor can move the pet", (t) => {
	for (const interruption of ["collapse-chat", "display"]) {
		const f = fixture(t, { preferences: { position: { x: 0, y: 0 } } });
		const window = f.windows[0];
		f.action("open");
		f.action("drag", "start");
		f.cursor({ x: 430, y: 440 });
		f.action("drag", "move");
		if (interruption === "display") {
			f.workArea({ x: -900, y: -80, width: 900, height: 700 });
			f.screen.emit("display-metrics-changed");
		} else f.action(interruption);
		const before = window.getBounds();
		f.cursor({ x: 900, y: 900 });
		f.action("drag", "move");
		f.action("drag", "end");
		assert.deepEqual(window.getBounds(), before);
		assert.deepEqual(f.preferences().position, { x: 214, y: 98 });
	}
});

test("companion zoom scales native bounds, keeps its intended anchor and stops at its limits", (t) => {
	const f = fixture(t, { preferences: { position: { x: 0, y: 0 } } });
	const window = f.windows[0];
	const before = window.getBounds();
	for (let index = 0; index < 20; index++)
		assert.equal(f.companion.changeZoom(window, "in"), true);
	assert.equal(window.zoomFactor, 1.6);
	assert.deepEqual(window.size, { width: 212, height: 218 });
	f.action("open");
	f.action("chat-size", 330);
	assert.deepEqual(window.size, { width: 506, height: 528 });
	assert.ok(window.size.width / window.zoomFactor >= 316);
	assert.equal(window.size.height / window.zoomFactor, 330);
	f.action("collapse-chat");
	f.companion.changeZoom(window, "reset");
	assert.deepEqual(window.getBounds(), before);
	for (let index = 0; index < 20; index++)
		f.companion.changeZoom(window, "out");
	assert.equal(window.zoomFactor, 0.8);
	assert.deepEqual(window.size, { width: 106, height: 109 });
	f.action("open");
	assert.deepEqual(window.size, { width: 253, height: 264 });
	f.action("collapse-chat");
	f.companion.changeZoom(window, "reset");
	assert.deepEqual(window.getBounds(), before);
	assert.deepEqual(f.preferences().position, { x: before.x, y: before.y });
	assert.deepEqual(window.presentations, []);
});

test("moving a zoomed companion establishes an anchor that survives reset and chat resizing", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	f.companion.changeZoom(window, "in");
	f.action("open");
	drag(f, -40, -50);
	const moved = window.getBounds();
	const intended = {
		x: moved.x + moved.width - 132,
		y: moved.y + moved.height - 136,
	};
	f.action("chat-size", 330);
	f.action("collapse-chat");
	f.companion.changeZoom(window, "reset");
	assert.deepEqual(window.position, [intended.x, intended.y]);
	assert.deepEqual(f.preferences().position, intended);
});

test("companion zoom commands only handle this window and each shortcut's key-down", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	assert.equal(f.companion.changeZoom({}, "in"), false);
	const input = (key, extra = {}) => {
		let prevented = false;
		window.webContents.emit(
			"before-input-event",
			{
				preventDefault: () => {
					prevented = true;
				},
			},
			{ type: "keyDown", meta: true, key, ...extra },
		);
		return prevented;
	};
	assert.equal(input("="), true);
	assert.equal(window.zoomFactor, 1.1);
	assert.equal(input("=", { type: "keyUp" }), false);
	assert.equal(input("=", { meta: false }), false);
	assert.equal(input("x"), false);
	assert.equal(window.zoomFactor, 1.1);
	assert.equal(input("+", { meta: false, control: true }), true);
	assert.equal(window.zoomFactor, 1.2);
	assert.equal(input("-"), true);
	assert.equal(window.zoomFactor, 1.1);
	assert.equal(input("o"), true);
	assert.equal(window.zoomFactor, 1);
	f.companion.setEnabled(false);
	assert.equal(f.companion.changeZoom(window, "in"), false);
	assert.equal(input("="), false);
});

test("intrinsic chat height accepts only trusted finite values and preserves its anchor", (t) => {
	const f = fixture(t);
	const window = f.windows[0];
	assert.deepEqual(window.size, { width: 132, height: 136 });
	f.action("chat-size", 360);
	assert.equal(window.boundsChanges, 0);
	f.action("open");
	const before = window.getBounds();
	const count = window.boundsChanges;
	for (const value of [
		null,
		undefined,
		{},
		[],
		"360",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	])
		f.action("chat-size", value);
	f.action("chat-size", 300, {
		sender: {},
		senderFrame: window.webContents.mainFrame,
	});
	f.action("chat-size", 194);
	assert.equal(window.boundsChanges, count);
	f.action("chat-size", 250.2);
	assert.equal(window.size.height, 251);
	assert.equal(window.boundsChanges, count + 1);
	assert.equal(
		window.position[1] + window.size.height,
		before.y + before.height,
	);
	f.action("chat-size", 250.9);
	assert.equal(window.boundsChanges, count + 1);
	f.action("chat-size", Number.MAX_VALUE);
	assert.equal(window.size.height, 360);
	f.action("chat-size", -100);
	assert.equal(window.size.height, 194);
	f.action("collapse-chat");
	const collapsed = window.getBounds();
	f.action("chat-size", 360);
	assert.deepEqual(window.getBounds(), collapsed);
	assert.deepEqual(window.presentations, []);
});

test("reply resizing waits for dragging to finish, cancel, blur or open a menu", (t) => {
	for (const finish of ["end", "cancel", "blur", "menu"]) {
		const f = fixture(t);
		const window = f.windows[0];
		f.action("open");
		const before = window.getBounds();
		const changes = window.boundsChanges;
		f.action("drag", "start");
		f.action("chat-size", 300);
		f.action("chat-size", 320);
		assert.deepEqual(window.getBounds(), before, finish);
		assert.equal(window.boundsChanges, changes, finish);
		f.cursor({ x: 360, y: 350 });
		f.action("drag", "move");
		assert.deepEqual(window.getBounds(), {
			...before,
			x: before.x - 40,
			y: before.y - 50,
		});
		if (finish === "blur") window.emit("blur");
		else if (finish === "menu") f.action("menu");
		else f.action("drag", finish);
		const after = window.getBounds();
		assert.equal(after.height, 320, finish);
		assert.equal(after.x, before.x - 40, finish);
		assert.equal(after.y + after.height, before.y + before.height - 50, finish);
		assert.equal(window.boundsChanges, changes + 1, finish);
		f.cursor({ x: 300, y: 300 });
		f.action("drag", "move");
		f.action("drag", "end");
		assert.deepEqual(window.getBounds(), after, finish);
		assert.equal(window.boundsChanges, changes + 1, finish);
		assert.deepEqual(window.presentations, [], finish);
	}
});

test("native menu stays scoped, cancels drag, and exposes character and hide controls", async (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	window.emit("ready-to-show");
	f.action("menu", undefined, {
		sender: {},
		senderFrame: window.webContents.mainFrame,
	});
	assert.equal(f.menus.length, 0);
	f.action("drag", "start");
	f.action("menu");
	f.action("drag", "end");
	assert.equal(f.chat().open, false);
	assert.deepEqual(window.presentations, ["inactive"]);
	const menu = f.menus[0];
	assert.equal(menu.popupOptions.window, window);
	assert.equal(
		menu.template.find((item) => item.label === "Open task in app").enabled,
		false,
	);
	const characters = menu.template.find(
		(item) => item.label === "Character",
	).submenu;
	assert.equal(characters.filter((item) => item.checked).length, 1);
	assert.ok(characters.find((item) => item.label === "Add character…"));
	characters.find((item) => item.label === "Pixel").click();
	assert.equal(f.preferences().character, "pixel");
	await f.catalogue("busy", "222222222222");
	f.action("menu");
	const refreshed = f.menus.at(-1);
	const openTask = refreshed.template.find(
		(item) => item.label === "Open task in app",
	);
	assert.equal(openTask.enabled, true);
	openTask.click();
	assert.deepEqual(f.opened, ["222222222222"]);
	refreshed.template.find((item) => item.label === "Chat").click();
	assert.equal(f.chat().open, true);
	refreshed.template.find((item) => item.label === "Hide companion").click();
	assert.equal(f.companion.enabled, false);
	assert.equal(window.hidden, true);
	assert.equal(window.destroyed, false);
	const menusBeforeHide = f.menus.length;
	f.action("menu");
	assert.equal(f.menus.length, menusBeforeHide);
});

test("notifications include other agents and open the selected task without consuming its receipt", async (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	window.emit("ready-to-show");
	await f.flush();
	f.requests.shift().resolve(
		ok({
			sessions: [
				{ id: "running", name: "Working elsewhere", status: { code: "busy" } },
				{
					id: "done",
					name: "Draft complete",
					status: { code: "complete" },
					attention: { unseen: true },
				},
				{ id: "ask", name: "Choose a date", status: { code: "answer" } },
				{ id: "approve", name: "Review changes", status: { code: "approval" } },
			],
		}),
	);
	await settle();
	assert.equal(f.state().notifications.length, 3);
	assert.deepEqual(window.presentations, ["inactive"]);
	assert.deepEqual(f.opened, []);
	f.action("notifications", undefined, {
		sender: {},
		senderFrame: window.webContents.mainFrame,
	});
	assert.equal(f.menus.length, 0);
	f.action("notifications");
	const picker = f.menus.at(-1);
	assert.deepEqual(
		Array.from(picker.template, (item) => item.label),
		[
			"Choose a date — Has a question",
			"Review changes — Needs approval",
			"Draft complete — Finished",
		],
	);
	f.action("open");
	await settle();
	const reads = [...f.desktopRequests];
	assert.equal(f.chat().open, true);
	picker.template[1].click();
	assert.deepEqual(f.opened, ["approve"]);
	assert.equal(f.chat().open, false);
	assert.equal(f.state().notifications.length, 3);
	assert.deepEqual(f.desktopRequests, reads);
	f.action("menu");
	assert.equal(
		f.menus.at(-1).template.find((item) => item.label === "Notifications (3)")
			.submenu.length,
		3,
	);
	f.companion.refresh();
	await f.catalogue("idle", "approve");
	picker.template[0].click();
	assert.deepEqual(
		f.opened,
		["approve"],
		"a vanished notification cannot open another task",
	);
	f.action("notifications");
	assert.equal(f.state().notifications.length, 0);
});

test("a single notification opens directly and a hidden companion never opens a picker", async (t) => {
	const f = fixture(t);
	await f.catalogue("approval", "needs-you");
	f.action("notifications");
	assert.deepEqual(f.opened, ["needs-you"]);
	assert.deepEqual(f.menus, []);
	f.companion.refresh();
	await f.flush();
	f.requests.shift().resolve(
		ok({
			sessions: [
				{ id: "one", status: { code: "answer" } },
				{ id: "two", status: { code: "approval" } },
			],
		}),
	);
	await settle();
	f.action("notifications");
	assert.deepEqual(f.opened, ["needs-you"]);
	assert.deepEqual(f.menus, []);
	f.companion.setEnabled(false);
	f.action("notifications");
	assert.deepEqual(f.opened, ["needs-you"]);
});

test("the companion menu keeps practical actions without exposing hidden games", (t) => {
	const f = fixture(t, { headless: false });
	f.action("menu");
	assert.deepEqual(
		Array.from(f.menus.at(-1).template, (item) => item.label ?? item.type),
		["Chat", "Open task in app", "Character", "separator", "Hide companion"],
	);
	assert.equal(f.chat().open, false);
	assert.deepEqual(f.windows[0].presentations, []);
});

test("Inky selection persists and remains protected as a built-in character", (t) => {
	const f = fixture(t);
	f.companion.characterMenu.find((item) => item.label === "Inky").click();
	assert.equal(f.preferences().character, "inky");
	assert.equal(
		f.handlers.get("companion:get-appearance")(f.trusted()).id,
		"inky",
	);
	assert.equal(f.windows[0].messages.at(-1)[1].id, "inky");
	const restarted = fixture(t, { preferences: f.preferences() });
	assert.equal(restarted.companion.appearance.id, "inky");
	const menu = restarted.companion.characterMenu;
	assert.equal(menu.filter((item) => item.checked).length, 1);
	assert.equal(menu.find((item) => item.label === "Inky").checked, true);
	assert.equal(
		menu.some((item) =>
			["Replace artwork…", "Remove character"].includes(item.label),
		),
		false,
	);
	restarted.companion.removeCharacter("inky");
	assert.equal(restarted.companion.appearance.id, "inky");
	assert.throws(
		() =>
			restarted.companion.importCharacter(
				join(root, "src/renderer/src/assets/companions/sprout.webp"),
				"inky",
			),
		{ message: "Choose a custom companion to replace." },
	);
});

test("custom artwork can be replaced and removed through the shared character menu", async (t) => {
	const f = fixture(t);
	const source = mkdtempSync(join(tmpdir(), "companion-artwork-"));
	t.after(() => rmSync(source, { recursive: true, force: true }));
	const art = (name) => join(source, `${name}.png`);
	for (const [name, background] of [
		["first", "red"],
		["replacement", "blue"],
	]) {
		await sharp({ create: { width: 2, height: 2, channels: 4, background } })
			.png()
			.toFile(art(name));
	}
	f.companion.importCharacter(art("first"));
	const first = f.companion.appearance.id;
	assert.ok(
		f.companion.characterMenu.find((item) => item.label === "Replace artwork…"),
	);
	f.companion.importCharacter(art("replacement"), first);
	const replaced = f.companion.appearance.id;
	assert.notEqual(first, replaced);
	assert.equal(f.companion.characters.length, 5);
	assert.equal(f.preferences().character, replaced);
	const remove = f.companion.characterMenu.find(
		(item) => item.label === "Remove character",
	);
	f.blockPreferenceWrites();
	assert.throws(() => f.companion.removeCharacter(replaced), SAVE_FAILED);
	assert.equal(f.companion.appearance.id, replaced);
	assert.equal(f.companion.characters.length, 5);
	f.unblockPreferenceWrites();
	remove.click();
	assert.equal(f.companion.appearance.id, "sprout");
	assert.equal(f.preferences().character, "sprout");
	assert.equal(f.companion.characters.length, 4);
	assert.equal(
		f.companion.characterMenu.some((item) => item.label === "Remove character"),
		false,
	);
});

for (const replacement of ["new", "same", "existing", "full library"]) {
	test(`failed preference save preserves artwork when replacing with ${replacement} artwork`, async (t) => {
		const f = fixture(t);
		const source = mkdtempSync(join(tmpdir(), "companion-replacement-"));
		t.after(() => rmSync(source, { recursive: true, force: true }));
		const image = await sharp({
			create: { width: 2, height: 2, channels: 4, background: "red" },
		})
			.png()
			.toBuffer();
		const originalPath = join(source, "original.png");
		const replacementPath = join(source, "replacement.png");
		writeFileSync(originalPath, image);
		writeFileSync(replacementPath, image);
		f.companion.importCharacter(originalPath);
		const original = f.companion.appearance;
		if (replacement === "existing")
			f.companion.importCharacter(replacementPath);
		if (replacement === "full library") {
			for (let i = 1; i < 64; i++) {
				const path = join(source, `pet-${i}.png`);
				writeFileSync(path, image);
				f.companion.importCharacter(path);
			}
		}
		f.companion.selectCharacter(original.id);
		const choices = f.companion.characters;
		const files = readdirSync(f.libraryPath);
		const saved = readFileSync(join(f.libraryPath, `${original.id}.json`));
		f.blockPreferenceWrites();
		const path = replacement === "same" ? originalPath : replacementPath;
		assert.throws(
			() => f.companion.importCharacter(path, original.id),
			SAVE_FAILED,
		);
		assert.equal(f.preferences().character, original.id);
		assert.deepEqual(f.companion.appearance, original);
		assert.deepEqual(f.companion.characters, choices);
		assert.deepEqual(readdirSync(f.libraryPath), files);
		assert.deepEqual(
			readFileSync(join(f.libraryPath, `${original.id}.json`)),
			saved,
		);
		assert.deepEqual(
			structuredClone(f.companion.settings.characters).map(({ id, name }) => ({
				id,
				name,
			})),
			structuredClone(choices),
		);
		f.unblockPreferenceWrites();
		f.companion.importCharacter(path, original.id);
		assert.equal(f.preferences().character, f.companion.appearance.id);
		assert.equal(
			f.companion.characters.length,
			choices.length - (replacement === "existing" ? 1 : 0),
		);
	});
}

for (const rollbackFails of [false, true]) {
	test(`failed old-artwork removal keeps a valid selection when preference rollback ${rollbackFails ? "fails" : "succeeds"}`, async (t) => {
		const f = fixture(t);
		const source = mkdtempSync(join(tmpdir(), "companion-replacement-"));
		t.after(() => rmSync(source, { recursive: true, force: true }));
		const image = await sharp({
			create: { width: 2, height: 2, channels: 4, background: "red" },
		})
			.png()
			.toBuffer();
		const originalPath = join(source, "original.png");
		const replacementPath = join(source, "replacement.png");
		writeFileSync(originalPath, image);
		writeFileSync(replacementPath, image);
		f.companion.importCharacter(originalPath);
		const original = f.companion.appearance;
		const stored = join(f.libraryPath, `${original.id}.json`);
		const unlink = fs.unlinkSync;
		t.mock.method(fs, "unlinkSync", (path) => {
			if (path === stored) {
				if (rollbackFails) f.blockPreferenceWrites();
				throw new Error("Fixture cannot remove original artwork");
			}
			return unlink(path);
		});
		assert.throws(
			() => f.companion.importCharacter(replacementPath, original.id),
			IMPORT_FAILED,
		);
		const selected = f.companion.appearance;
		assert.equal(f.preferences().character, selected.id);
		assert.equal(
			JSON.parse(
				readFileSync(join(f.libraryPath, `${selected.id}.json`), "utf8"),
			).name,
			selected.name,
		);
		assert.equal(JSON.parse(readFileSync(stored, "utf8")).name, original.name);
		if (rollbackFails) {
			assert.notEqual(selected.id, original.id);
			assert.equal(f.companion.characters.length, 6);
		} else {
			assert.deepEqual(selected, original);
			assert.equal(f.companion.characters.length, 5);
		}
	});
}

test("hiding retains the renderer but stops polling, rejects IPC and defeats a late ready event", async (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	const collapsed = window.getBounds();
	f.action("open");
	await settle();
	const reads = [...f.desktopRequests];
	f.action("hide");
	assert.equal(window.destroyed, false);
	assert.equal(window.hidden, true);
	assert.equal(f.preferences().enabled, false);
	assert.equal(f.intervals.size, 0);
	assert.equal(f.timeouts.size, 0);
	const presentations = [...window.presentations];
	window.emit("ready-to-show");
	f.action("open");
	f.action("open-task");
	assert.equal(f.chat(), null);
	assert.equal(await f.send("Hidden pane cannot send"), false);
	assert.deepEqual(window.presentations, presentations);
	assert.deepEqual(f.opened, []);
	assert.deepEqual(f.desktopRequests, reads);
	f.companion.setEnabled(true);
	assert.equal(f.windows.length, 1);
	assert.equal(window.hidden, false);
	assert.deepEqual(window.getBounds(), collapsed);
	assert.equal(f.chat().open, false);
	assert.equal(f.intervals.size, 1);
	assert.deepEqual(window.presentations, [...presentations, "inactive"]);
	f.companion.setEnabled(true);
	assert.equal(f.intervals.size, 1);
	assert.deepEqual(window.presentations, [...presentations, "inactive"]);
});

test("fleet changes never retarget inline chat or focus the window", async (t) => {
	const f = fixture(t, { headless: false });
	const window = f.windows[0];
	window.emit("ready-to-show");
	await f.catalogue("busy", "111111111111");
	assert.deepEqual(window.presentations, ["inactive"]);
	f.action("open");
	assert.deepEqual(window.presentations, ["inactive", "show", "focus"]);
	await settle();
	assert.equal(f.chat().snapshot.sessionId, "012345abcdef");
	assert.equal(await f.send("Hello from the pet"), true);
	assert.equal(f.chat().snapshot.sessionId, "012345abcdef");
	f.companion.refresh();
	await f.catalogue("approval", "222222222222");
	assert.equal(f.chat().snapshot.sessionId, "012345abcdef");
	assert.deepEqual(window.presentations, ["inactive", "show", "focus"]);
	f.action("open-task");
	f.action("expand-chat");
	assert.deepEqual(f.opened, ["222222222222", "012345abcdef"]);
	assert.equal(f.chat().open, false);
	f.action("collapse-chat");
	f.action("open");
	await settle();
	assert.equal(f.chat().snapshot.sessionId, "012345abcdef");
	assert.equal(
		f.desktopRequests.filter((request) => request.op === "sessions.create")
			.length,
		0,
	);
});

test("native close disables the companion, cancels polling and persists the menu state", (t) => {
	const f = fixture(t);
	const oldWindow = f.windows[0];
	assert.equal(f.intervals.size, 1);
	assert.equal(f.timeouts.size, 1);
	f.action("open");
	f.windows[0].destroy();
	assert.equal(f.companion.enabled, false);
	assert.equal(f.preferences().enabled, false);
	assert.equal(f.visibility.at(-1), false);
	assert.equal(f.intervals.size, 0);
	assert.equal(f.timeouts.size, 0);
	f.companion.refresh();
	assert.equal(f.timeouts.size, 0);
	f.companion.setEnabled(true);
	assert.equal(f.windows.length, 2);
	assert.equal(f.intervals.size, 1);
	assert.equal(f.chat().open, false);
	f.action("hide", undefined, f.trusted(oldWindow));
	assert.equal(f.companion.enabled, true);
	assert.equal(
		f.handlers.get("companion:get-chat")(f.trusted(oldWindow)),
		null,
	);
});

test("disposal unregisters IPC and display observers without disabling the next launch", (t) => {
	const f = fixture(t);
	assert.equal(f.screen.listenerCount("display-added"), 1);
	f.companion.dispose();
	assert.equal(f.windows[0].destroyed, true);
	assert.equal(f.preferences().enabled, true);
	assert.equal(f.handlers.size, 0);
	assert.equal(f.ipcMain.listenerCount("companion:action"), 0);
	assert.equal(f.screen.listenerCount("display-added"), 0);
	assert.equal(f.screen.listenerCount("display-removed"), 0);
	assert.equal(f.screen.listenerCount("display-metrics-changed"), 0);
	assert.equal(f.intervals.size, 0);
	assert.equal(f.timeouts.size, 0);
});

test("fresh installs stay off until an explicit choice, and settings do not start agents", (t) => {
	const f = fixture(t, { preferences: null });
	assert.equal(f.companion.enabled, false);
	assert.equal(f.preferences().introduced, false);
	assert.equal(f.windows.length, 0);
	assert.equal(f.intervals.size, 0);
	f.companion.updateSettings({ character: "inky" });
	assert.equal(f.preferences().introduced, true);
	assert.equal(f.companion.settings.character, "inky");
	assert.equal(f.windows.length, 0);
	f.companion.updateSettings({ enabled: true });
	assert.equal(f.windows.length, 1);
	assert.equal(f.intervals.size, 1);
	assert.equal(f.companion.enabled, true);
	assert.deepEqual(f.desktopRequests, []);
	f.companion.updateSettings({ enabled: false });
	assert.equal(f.intervals.size, 0);
	assert.equal(f.windows[0].hidden, true);
	assert.ok(f.settingsChanges() >= 4);
	const restarted = fixture(t, { preferences: f.preferences() });
	assert.equal(restarted.windows.length, 0);
	assert.equal(restarted.companion.settings.character, "inky");
	assert.equal(restarted.companion.settings.introduced, true);
});

test("declining introduction stays hidden and invalid characters cannot partially enable", (t) => {
	const f = fixture(t, { preferences: null });
	f.companion.updateSettings({ introduced: true });
	assert.equal(f.companion.settings.introduced, true);
	assert.equal(f.windows.length, 0);
	assert.throws(
		() => f.companion.updateSettings({ enabled: true, character: "missing" }),
		UNAVAILABLE_CHARACTER,
	);
	assert.equal(f.companion.enabled, false);
	assert.equal(f.windows.length, 0);
});

test("a combined choice persists together and a failed write leaves the invitation and window unchanged", (t) => {
	const f = fixture(t, { preferences: null });
	f.companion.updateSettings({
		enabled: true,
		character: "inky",
		introduced: true,
	});
	assert.ok(
		f.writtenChoices
			.slice(1)
			.every(
				(choice) =>
					choice.enabled && choice.introduced && choice.character === "inky",
			),
	);
	const broken = fixture(t, { preferences: null });
	const before = structuredClone(broken.companion.settings);
	const writes = broken.settingsChanges();
	broken.breakPersistence();
	assert.throws(
		() =>
			broken.companion.updateSettings({
				enabled: true,
				character: "inky",
				introduced: true,
			}),
		SAVE_FAILED,
	);
	assert.deepEqual(structuredClone(broken.companion.settings), before);
	assert.equal(broken.settingsChanges(), writes);
	assert.equal(broken.windows.length, 0);
});

test("closed settings renderers cannot roll back persisted choices and movement does not republish previews", (t) => {
	const f = fixture(t);
	const changes = f.settingsChanges();
	f.action("nudge", "ArrowLeft");
	assert.equal(f.settingsChanges(), changes);
	f.breakPublishing();
	f.companion.updateSettings({ enabled: false, character: "inky" });
	assert.equal(f.preferences().enabled, false);
	assert.equal(f.companion.settings.enabled, false);
	assert.equal(f.preferences().character, "inky");
	assert.equal(f.companion.settings.character, "inky");
});

test("keyboard conversation menus validate and anchor within the zoomed companion window", async (t) => {
	const f = fixture(t, { headless: false });
	f.action("open");
	await settle();
	for (const position of [
		null,
		[],
		{},
		{ x: "10", y: 10 },
		{ x: Number.NaN, y: 10 },
		{ x: 10, y: Number.POSITIVE_INFINITY },
	]) {
		assert.equal(await f.chatMenu(f.trusted(), position), false);
	}
	assert.equal(f.menus.length, 0);
	const window = f.windows[0];
	f.companion.changeZoom(window, "in");
	const choice = f.chatMenu(f.trusted(), { x: 120, y: 64 });
	let menu = f.menus.at(-1);
	assert.equal(menu.popupOptions.x, Math.round(120 * window.zoomFactor));
	assert.equal(menu.popupOptions.y, Math.round(64 * window.zoomFactor));
	menu.popupOptions.callback();
	assert.equal(await choice, false);
	f.workArea({ x: 0, y: 0, width: 260, height: 240 });
	f.companion.changeZoom(window, "in");
	assert.ok(window.zoomFactor < 1);
	const compact = f.chatMenu(f.trusted(), { x: 120, y: 64 });
	menu = f.menus.at(-1);
	assert.equal(menu.popupOptions.x, Math.round(120 * window.zoomFactor));
	assert.equal(menu.popupOptions.y, Math.round(64 * window.zoomFactor));
	menu.popupOptions.callback();
	assert.equal(await compact, false);
	const clamped = f.chatMenu(f.trusted(), { x: -10, y: Number.MAX_VALUE });
	menu = f.menus.at(-1);
	assert.equal(menu.popupOptions.x, 0);
	assert.equal(menu.popupOptions.y, window.getBounds().height - 1);
	menu.popupOptions.callback();
	assert.equal(await clamped, false);
});
