/**
 * Invoke the app's own About action, in the app's own main process.
 *
 * Why the Node inspector rather than a click. The About panel is raised by the
 * app menu, and every other way to reach that item needs something this rig may
 * not have: `System Events` needs Accessibility permission and reports nothing
 * for a background process, and a real menu click means activating the app,
 * which is the exact interruption the window modes exist to prevent. Launching
 * with `--inspect` puts the MAIN process on a loopback port this rig owns, so
 * the item's handler can be called directly - the same code path the menu runs,
 * with no window-server input at all.
 *
 * What it reports is the state the panel decision is made from and the state it
 * must not change: the resolved identity the panel would show, whether the app
 * is the active application before and after, and how many windows the app has
 * on screen at each of those points. The window server's own census, the
 * frontmost application and the panel's pixels are read by `run.sh` instead,
 * because those are facts about the session rather than about the app.
 *
 *   node drive.mjs <inspectPort> <scratch> <mode> <appPid> <route>
 *
 * `<route>` is how the About action is invoked, and the two rigs need different
 * answers:
 *
 *   `action` - call the menu item's OWN click handler, and refuse to run against
 *     an item that still carries Electron's `about` role. A role's action is
 *     AppKit's `orderFrontStandardAboutPanel:`, which no handler of ours can
 *     intercept: a tree whose About item is still a role has nothing for this
 *     rig to measure, and saying so is the honest outcome rather than calling a
 *     stand-in and reporting it as the app's behaviour.
 *   `panel` - raise the panel the item raises. For an item with its own handler
 *     that is that handler; for a tree whose item is still the ROLE it is
 *     `app.showAboutPanel()`, which is the call the role makes - so the base
 *     tree's identity can be photographed without inventing a different surface.
 */
const [port, scratch, mode, appPid, route = "action"] = process.argv.slice(2);
if (!port || !scratch || !mode || !appPid) {
	console.error("usage: drive.mjs <inspectPort> <scratch> <mode> <appPid> [action|panel]");
	process.exit(2);
}

/** The inspector's own answer for "which target", read once. */
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets[0];
if (!target?.webSocketDebuggerUrl) {
	console.error("FAIL: no inspector target on the port this rig owns");
	process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let next = 1;

socket.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	const settle = pending.get(message.id);
	if (settle) {
		pending.delete(message.id);
		settle(message);
	}
});

await new Promise((resolve, reject) => {
	const timer = setTimeout(
		() => reject(new Error("the inspector socket never opened")),
		15_000,
	);
	socket.addEventListener("open", () => {
		clearTimeout(timer);
		resolve();
	});
	socket.addEventListener("error", (error) => {
		clearTimeout(timer);
		reject(new Error(`inspector socket error: ${error.message ?? error}`));
	});
});

const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = next++;
		// Every call is bounded: an inspector that stops answering must fail this
		// run rather than hang it, so a rig cannot sit on the operator's machine
		// holding a scratch profile open.
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`${method} did not answer within 15s`));
		}, 15_000);
		pending.set(id, (message) => {
			clearTimeout(timer);
			resolve(message);
		});
		socket.send(JSON.stringify({ id, method, params }));
	});

await send("Runtime.enable");

const evaluate = async (expression) => {
	const reply = await send("Runtime.evaluate", {
		expression,
		includeCommandLineAPI: true,
		returnByValue: true,
		awaitPromise: true,
	});
	const result = reply.result;
	if (result?.exceptionDetails) {
		throw new Error(
			`main-process evaluation threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
		);
	}
	return result?.result?.value;
};

/**
 * Wait for the app to be far enough along that the menu exists.
 *
 * Why this is a wait rather than a sleep with a hoped-for length: an invocation
 * that lands before the window's first present is DROPPED, not deferred.
 * Measured on the base tree: the action raised the panel when it ran against a
 * ready window and produced nothing at all when the same action ran a second or
 * so after the inspector came up - which reads in the census exactly like a
 * suppressed panel. A rig that cannot tell "the app did not raise it" from "the
 * app had not started yet" is not measuring the gate.
 */
const waitFor = async (label, expression, timeoutMs = 60_000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(expression)) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error(`FAIL: the app never reached "${label}" within ${timeoutMs}ms`);
	process.exit(1);
};

await waitFor(
	"a ready app with its first window",
	`(() => { const { app, BrowserWindow } = require("electron"); return app.isReady() && BrowserWindow.getAllWindows().length > 0; })()`,
);
// The window is created before it is presented, and the panel is ordered front
// against the presented window, so the settle is part of the readiness above.
await new Promise((resolve) => setTimeout(resolve, 2_500));

/**
 * The facts the decision is made from, and the identity the panel would show.
 *
 * Read in the app's own words rather than inferred: `app.getName()` is what the
 * menu label is built from, `app.getVersion()` is what the version line would
 * say, and `process.versions.electron` is the identity the panel fell back to
 * for an unpackaged run.
 */
const probe = `(() => {
	const { app, BrowserWindow, Menu } = require("electron");
	const about = [];
	const walk = (items, trail) => {
		for (const item of items ?? []) {
			const label = trail ? trail + " > " + item.label : item.label;
			if (item.role === "about" || /^about/i.test(item.label ?? ""))
				about.push(label + " [role=" + (item.role ?? "none") + "] click=" + typeof item.click);
			if (item.submenu) walk(item.submenu.items, label);
		}
	};
	walk(Menu.getApplicationMenu()?.items ?? [], "");
	return {
		appName: app.getName(),
		appVersion: app.getVersion(),
		electronVersion: process.versions.electron,
		isPackaged: app.isPackaged,
		isActive: app.isActive(),
		aboutItems: about,
		windows: BrowserWindow.getAllWindows().map((w) => ({
			visible: w.isVisible(),
			focused: w.isFocused(),
			focusable: w.isFocusable(),
			size: w.getSize(),
		})),
	};
})()`;

const before = await evaluate(probe);
console.log(`== app identity (its own answer): name=${before.appName} version=${before.appVersion} electron=${before.electronVersion} packaged=${before.isPackaged}`);
console.log(`== About menu entries: ${before.aboutItems.join(" | ") || "(none)"}`);
console.log(`== active before the action: ${before.isActive}; windows: ${JSON.stringify(before.windows)}`);

if (before.aboutItems.length === 0) {
	console.error("FAIL: the application menu has no About entry to invoke");
	process.exit(1);
}

/**
 * The invocation. `Menu.getApplicationMenu()` holds the same item objects the
 * native menu does, so an item with a handler of its own can be called directly,
 * and the report always says which route ran so a reader knows what produced the
 * panel.
 */
const invoked = await evaluate(`(() => {
	const { app, Menu } = require("electron");
	const found = [];
	const walk = (items, trail) => {
		for (const item of items ?? []) {
			const label = trail ? trail + " > " + item.label : item.label;
			if (item.role === "about" || /^about/i.test(item.label ?? ""))
				found.push({ item, label });
			if (item.submenu) walk(item.submenu.items, label);
		}
	};
	walk(Menu.getApplicationMenu()?.items ?? [], "");
	const entry = found[0];
	if (!entry) return { invoked: null, route: null, reason: "no About entry" };
	const own = typeof entry.item.click === "function" && !entry.item.role;
	if (${JSON.stringify(route)} === "action") {
		if (!own)
			return { invoked: entry.label, route: "none", reason: "the entry is role=" + (entry.item.role ?? "none") + ", so its action is AppKit's own and no handler of the app's can intercept it" };
		entry.item.click();
		return { invoked: entry.label, route: "the item's own click handler", reason: "called" };
	}
	if (own) {
		entry.item.click();
		return { invoked: entry.label, route: "the item's own click handler", reason: "called" };
	}
	// The role's action, through the call it makes.
	app.showAboutPanel();
	return { invoked: entry.label, route: "app.showAboutPanel() (role=" + (entry.item.role ?? "none") + ")", reason: "the item is AppKit's own action, so the panel is raised through the call that action makes" };
})()`);
console.log(`== invoked: ${invoked.invoked ?? "(none)"} via ${invoked.route ?? "(nothing)"} - ${invoked.reason}`);

if (invoked.route === "none") {
	console.error("FAIL: nothing was invoked, so this run measured nothing");
	process.exit(1);
}

// The panel is ordered front asynchronously, and the app's own activation is
// what that can change, so the read happens after it has settled.
await new Promise((resolve) => setTimeout(resolve, 2_000));

const after = await evaluate(probe);
console.log(`== active after the action: ${after.isActive}; windows: ${JSON.stringify(after.windows)}`);
console.log(`== driver: mode=${mode} appPid=${appPid} scratch=${scratch}`);
socket.close();
