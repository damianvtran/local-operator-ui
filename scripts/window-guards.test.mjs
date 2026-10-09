import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The main window's host-power guards (UI security lane U-a), driven as RULES.
 *
 * `src/main/window-guards.ts` is pure by design, so the whole verdict table is
 * pinned here by execution without a window; `window-guards-electron.ts` is
 * driven against a fake `WebContents` / `Session` that records what was
 * installed, which proves the WIRING calls the rules and honours their answers.
 *
 * WHAT THESE TESTS ARE NOT: proof that Chromium enforces the sandbox or the CSP,
 * or that Electron emits `will-frame-navigate` for the cases below. That is
 * `scripts/window-guards-electron.test.mjs`, which runs a hostile document in
 * the pinned Electron binary. This file exists so a regression in the RULES is
 * caught in the 90-second desktop suite, which cannot start a window.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/window-guards";',
			'export * from "./src/main/window-guards-electron";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const guards = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const APP_FILE =
	"file:///Applications/Local%20Operator.app/out/renderer/index.html";
const APP_DEV = "http://localhost:5173";
const MINI_FILE = APP_FILE.replace("index.html", "mini.html");
const TRUSTED = [APP_FILE, MINI_FILE];

// --- the door to the OS -----------------------------------------------------

test("only http(s) and mailto: reach the OS, as the PARSED href", () => {
	const ok = (raw, expected) => {
		const v = guards.externalUrlVerdict(raw);
		assert.equal(v.allowed, true, `${raw}: ${JSON.stringify(v)}`);
		assert.equal(v.url, expected ?? raw);
	};
	ok("https://example.com/a?b=c#d");
	ok("http://127.0.0.1:1111/x");
	ok("mailto:a@example.com?subject=hi");
	// The parsed href is what is handed over, not the caller's spelling.
	ok("  https://EXAMPLE.com  ", "https://example.com/");
});

test("everything else is refused, each by a named reason", () => {
	const refused = [
		["file:///etc/passwd", /scheme file:/],
		["smb://attacker/share", /scheme smb:/],
		["javascript:alert(1)", /scheme javascript:/],
		["data:text/html,<script>1</script>", /scheme data:/],
		["vscode://file/etc/passwd", /scheme vscode:/],
		["ircs://x", /scheme ircs:/],
		["xmpp:a@b", /scheme xmpp:/],
		["https://trusted.example@attacker.test/", /credentials/],
		["https://u:p@example.com/", /credentials/],
		["mailto:a@b.c?attach=/etc/passwd", /attachment/],
		["mailto:a@b.c?subject=x&attachment=/etc/passwd", /attachment/],
		["not a url", /not a URL/],
		["", /not a string/],
		[undefined, /not a string/],
		[{ href: "https://example.com" }, /not a string/],
		[`https://example.com/${"a".repeat(20000)}`, /too long/],
	];
	for (const [raw, reason] of refused) {
		const v = guards.externalUrlVerdict(raw);
		assert.equal(
			v.allowed,
			false,
			`${String(raw).slice(0, 60)} must be refused`,
		);
		assert.match(v.reason, reason);
	}
});

test("openVettedExternal calls the OS only for an allowed URL and reports failure", async () => {
	const opened = [];
	const logs = [];
	const open = (url) => {
		opened.push(url);
	};
	assert.equal(
		await guards.openVettedExternal("https://example.com", open, (m) =>
			logs.push(m),
		),
		true,
	);
	assert.equal(
		await guards.openVettedExternal("file:///etc/passwd", open, (m) =>
			logs.push(m),
		),
		false,
	);
	assert.deepEqual(opened, ["https://example.com/"]);
	assert.match(logs.join("\n"), /refused to open externally: scheme file:/);
	// An OS-level failure resolves false (what the old IPC did: swallow and log).
	assert.equal(
		await guards.openVettedExternal(
			"https://example.com",
			() => Promise.reject(new Error("no handler")),
			(m) => logs.push(m),
		),
		false,
	);
	assert.match(logs.join("\n"), /could not open the URL: no handler/);
});

// --- window.open --------------------------------------------------------------

test("sign-in providers still get the sandboxed popup; lookalikes do not", () => {
	const auth = [
		"about:blank",
		"https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
		"https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		"https://login.live.com/oauth20_authorize.srf",
		"https://sub.accounts.google.com/x",
		"storagerelay://https/localhost?id=auth1",
		"msauth://com.local-operator/callback",
	];
	for (const url of auth)
		assert.deepEqual(guards.popupVerdict(url), { action: "auth" }, url);

	// Every one of these satisfied the substring test the old handler used.
	const lookalikes = [
		"https://accounts.google.com.attacker.test/",
		"https://attacker.test/?next=accounts.google.com",
		"https://attacker.test/storagerelay",
		"https://evilaccounts.google.com/",
		"https://microsoftonline.com.attacker.test/",
		"http://accounts.google.com/",
		"https://user:pw@accounts.google.com/",
	];
	for (const url of lookalikes) {
		const v = guards.popupVerdict(url);
		assert.notEqual(v.action, "auth", `${url} must not get an auth popup`);
	}
});

test("a non-auth window.open becomes a vetted external open or nothing", () => {
	assert.deepEqual(guards.popupVerdict("https://example.com/docs"), {
		action: "external",
		url: "https://example.com/docs",
	});
	assert.deepEqual(guards.popupVerdict("mailto:a@b.c"), {
		action: "external",
		url: "mailto:a@b.c",
	});
	for (const url of [
		"file:///etc/passwd",
		"smb://x/y",
		"javascript:alert(1)",
		"data:text/html,x",
		"ftp://example.com/",
		"",
	]) {
		const v = guards.popupVerdict(url);
		assert.equal(v.action, "deny", url);
		assert.ok(v.reason);
	}
});

/** A fake `WebContents` recording what the guards installed. */
const fakeContents = () => {
	const listeners = new Map();
	let openHandler = null;
	return {
		on: (event, fn) =>
			listeners.set(event, [...(listeners.get(event) ?? []), fn]),
		setWindowOpenHandler: (fn) => {
			openHandler = fn;
		},
		emit: (event, payload) => {
			const e = { ...payload, defaultPrevented: false };
			e.preventDefault = () => {
				e.defaultPrevented = true;
			};
			for (const fn of listeners.get(event) ?? []) fn(e);
			return e;
		},
		open: (url) => openHandler({ url }),
		listened: (event) => (listeners.get(event) ?? []).length,
	};
};

test("guardWindowOpen: auth keeps its options, external goes through the injected door, the rest is denied", async () => {
	const contents = fakeContents();
	const external = [];
	const logs = [];
	const options = { width: 800, webPreferences: { sandbox: true } };
	guards.guardWindowOpen(
		contents,
		guards.popupVerdict,
		async (url) => {
			external.push(url);
			return true;
		},
		options,
		(m) => logs.push(m),
	);
	assert.deepEqual(contents.open("https://accounts.google.com/o/oauth2/auth"), {
		action: "allow",
		overrideBrowserWindowOptions: options,
	});
	assert.deepEqual(contents.open("https://example.com/x"), { action: "deny" });
	assert.deepEqual(contents.open("file:///etc/passwd"), { action: "deny" });
	assert.deepEqual(
		contents.open("https://accounts.google.com.attacker.test/"),
		{
			action: "deny",
		},
	);
	assert.deepEqual(external, [
		"https://example.com/x",
		"https://accounts.google.com.attacker.test/",
	]);
	assert.match(logs.join("\n"), /denied window\.open: scheme file:/);
});

// --- navigation ---------------------------------------------------------------

const nav = (url, isMainFrame, trusted = TRUSTED) =>
	guards.frameNavigationVerdict({ url, isMainFrame }, trusted);

test("the main frame may only show the app's own document", () => {
	assert.equal(nav(APP_FILE, true).allowed, true);
	assert.equal(nav(`${APP_FILE}#/chat/abc`, true).allowed, true);
	assert.equal(nav(MINI_FILE, true).allowed, true);
	assert.equal(nav(`${APP_DEV}/`, true, [APP_DEV]).allowed, true);
	for (const url of [
		"https://attacker.test/",
		"http://127.0.0.1:1111/v1/static/html?path=/tmp/x.html",
		"file:///etc/passwd",
		"file:///Applications/Local%20Operator.app/out/renderer/other.html",
		"data:text/html,x",
		"about:blank",
		"javascript:alert(1)",
		"http://localhost:5174/",
	]) {
		const v = nav(url, true, [APP_FILE, APP_DEV]);
		assert.equal(v.allowed, false, `main frame -> ${url}`);
	}
});

test("a child frame may be the PDF blob or the backend's static route, nothing else", () => {
	const uuid = "53b6d933-cf85-403b-8748-8fecd8431f90";
	for (const url of [
		`blob:file:///${uuid}#toolbar=0`,
		`blob:http://localhost:5173/${uuid}`,
		"http://127.0.0.1:1111/v1/static/html?path=%2Ftmp%2Fa.html",
		"http://localhost:54321/v1/static/html?path=x",
		"http://[::1]:1111/v1/static/html?path=x",
	]) {
		assert.equal(nav(url, false, [APP_FILE, APP_DEV]).allowed, true, url);
	}
	for (const url of [
		// Round-1 S-R1/S-R4: no data:/about: allowance for a child, ever.
		"about:blank",
		"about:srcdoc",
		"data:text/html;base64,PHNjcmlwdD4=",
		"https://attacker.test/",
		"http://127.0.0.1:1111/v1/auth/token",
		"http://127.0.0.1:1111/v1/staticevil",
		"http://127.0.0.1:1111/health",
		"http://attacker.test/v1/static/html?path=x",
		"file:///etc/passwd",
		`blob:https://attacker.test/${uuid}`,
		"blob:null/x",
		"javascript:alert(1)",
		"not a url",
	]) {
		assert.equal(nav(url, false, [APP_FILE]).allowed, false, `child -> ${url}`);
	}
	// A blob minted by the dev server is not the packaged app's.
	assert.equal(
		nav(`blob:http://localhost:5173/${uuid}`, false, [APP_FILE]).allowed,
		false,
	);
});

test("guardNavigation cancels a refused navigation and lets the rest through", () => {
	const contents = fakeContents();
	const logs = [];
	guards.guardNavigation(
		contents,
		() => TRUSTED,
		(m) => logs.push(m),
	);
	// Both events, because a vetted first request can still redirect.
	assert.equal(contents.listened("will-frame-navigate"), 1);
	assert.equal(contents.listened("will-redirect"), 1);

	const blocked = contents.emit("will-frame-navigate", {
		url: "https://attacker.test/",
		isMainFrame: true,
		isSameDocument: false,
	});
	assert.equal(blocked.defaultPrevented, true);
	assert.match(
		logs.join("\n"),
		/blocked main-frame navigation to https:\/\/attacker\.test\//,
	);

	const redirected = contents.emit("will-redirect", {
		url: "http://127.0.0.1:1111/v1/auth/token",
		isMainFrame: false,
		isSameDocument: false,
	});
	assert.equal(redirected.defaultPrevented, true);

	const reload = contents.emit("will-frame-navigate", {
		url: APP_FILE,
		isMainFrame: true,
		isSameDocument: false,
	});
	assert.equal(reload.defaultPrevented, false);

	// A HashRouter change is same-document: never a destination.
	const route = contents.emit("will-frame-navigate", {
		url: `${APP_FILE}#/settings`,
		isMainFrame: true,
		isSameDocument: true,
	});
	assert.equal(route.defaultPrevented, false);
});

test("the trusted list is read at event time, not captured at install time", () => {
	const contents = fakeContents();
	let trusted = [APP_FILE];
	guards.guardNavigation(
		contents,
		() => trusted,
		() => {},
	);
	const mini = { url: MINI_FILE, isMainFrame: true, isSameDocument: false };
	assert.equal(
		contents.emit("will-frame-navigate", mini).defaultPrevented,
		true,
	);
	trusted = TRUSTED;
	assert.equal(
		contents.emit("will-frame-navigate", mini).defaultPrevented,
		false,
	);
});

// --- permissions --------------------------------------------------------------

const ask = (permission, extra = {}) =>
	guards.permissionVerdict(
		{
			permission,
			isMainFrame: true,
			requestingUrl: APP_FILE,
			...extra,
		},
		TRUSTED,
	);

test("permissions: deny by default, grant only what the app's own documents use", () => {
	assert.equal(ask("media", { mediaTypes: ["audio"] }), true);
	assert.equal(ask("media", { mediaType: "audio" }), true);
	assert.equal(ask("clipboard-sanitized-write"), true);
	assert.equal(ask("fullscreen"), true);
	assert.equal(
		guards.permissionVerdict(
			{
				permission: "media",
				mediaTypes: ["audio"],
				isMainFrame: true,
				requestingUrl: MINI_FILE,
			},
			TRUSTED,
		),
		true,
	);

	assert.equal(ask("media", { mediaTypes: ["audio", "video"] }), false);
	assert.equal(ask("media", { mediaTypes: ["video"] }), false);
	assert.equal(ask("media", { mediaTypes: [] }), false);
	assert.equal(ask("media", { mediaType: "video" }), false);
	for (const permission of [
		"clipboard-read",
		"geolocation",
		"notifications",
		"display-capture",
		"midi",
		"usb",
		"hid",
		"serial",
		"openExternal",
		"persistent-storage",
		"unknown",
		"",
	])
		assert.equal(ask(permission), false, permission);
});

test("permissions: a sub-frame or a foreign document gets nothing, even the allowed ones", () => {
	assert.equal(
		ask("media", { mediaTypes: ["audio"], isMainFrame: false }),
		false,
	);
	assert.equal(ask("clipboard-sanitized-write", { isMainFrame: false }), false);
	// The sandboxed preview presents its loopback URL (or none).
	assert.equal(
		ask("media", {
			mediaTypes: ["audio"],
			requestingUrl: "http://127.0.0.1:1111/v1/static/html?path=x",
		}),
		false,
	);
	assert.equal(ask("clipboard-sanitized-write", { requestingUrl: "" }), false);
	assert.equal(
		ask("fullscreen", { requestingUrl: "https://attacker.test/" }),
		false,
	);
});

test("guardPermissions installs BOTH handlers and answers through the rule", () => {
	let request = null;
	let check = null;
	const ses = {
		setPermissionRequestHandler: (fn) => {
			request = fn;
		},
		setPermissionCheckHandler: (fn) => {
			check = fn;
		},
	};
	const logs = [];
	guards.guardPermissions(
		ses,
		() => TRUSTED,
		(m) => logs.push(m),
	);
	assert.ok(request, "request handler");
	assert.ok(
		check,
		"check handler: one without the other leaves an auto-approve path",
	);

	const answers = [];
	const details = (extra) => ({
		isMainFrame: true,
		requestingUrl: APP_FILE,
		...extra,
	});
	request(
		{},
		"media",
		(g) => answers.push(g),
		details({ mediaTypes: ["audio"] }),
	);
	request({}, "geolocation", (g) => answers.push(g), details({}));
	request(
		{},
		"media",
		(g) => answers.push(g),
		details({ mediaTypes: ["video", "audio"] }),
	);
	assert.deepEqual(answers, [true, false, false]);
	assert.equal(
		check({}, "media", APP_FILE, details({ mediaType: "audio" })),
		true,
	);
	assert.equal(check({}, "clipboard-read", APP_FILE, details({})), false);
	// Electron calls the check with no requestingUrl during startup probes.
	assert.equal(
		check({}, "media", "", { isMainFrame: true, mediaType: "audio" }),
		false,
	);
	assert.match(logs.join("\n"), /denied permission request geolocation/);
});

// --- the preview's response policy ---------------------------------------------

test("only the backend's preview route gets the preview policy", () => {
	for (const url of [
		"http://127.0.0.1:1111/v1/static/html?path=%2Ftmp%2Fa.html",
		"http://localhost:9/v1/static/html",
	])
		assert.equal(guards.isPreviewDocumentRequest(url), true, url);
	for (const url of [
		"http://127.0.0.1:1111/v1/static/images?path=x",
		"http://127.0.0.1:1111/v1/static/html/extra",
		"https://attacker.test/v1/static/html",
		"file:///v1/static/html",
		"nonsense",
	])
		assert.equal(guards.isPreviewDocumentRequest(url), false, url);
});

test("the preview CSP closes the loopback daemon, frames, forms and <base>", () => {
	const csp = guards.PREVIEW_CSP;
	const directive = (name) =>
		csp
			.split(";")
			.map((d) => d.trim())
			.find((d) => d.startsWith(`${name} `));
	assert.equal(directive("default-src"), "default-src 'none'");
	assert.equal(directive("connect-src"), "connect-src https:");
	assert.equal(directive("form-action"), "form-action 'none'");
	assert.equal(directive("base-uri"), "base-uri 'none'");
	// A plain-http source anywhere would re-open the loopback daemon.
	assert.doesNotMatch(csp, /(^|[\s;])http:/);
	assert.doesNotMatch(csp, /127\.0\.0\.1|localhost|\*/);
	// Inline script is what generated previews are made of.
	assert.match(directive("script-src"), /'unsafe-inline'/);
	assert.equal(
		directive("frame-src"),
		undefined,
		"default-src 'none' covers frames",
	);
});

test("withPreviewPolicy ADDS to existing headers and never loosens a document's own CSP", () => {
	const bare = guards.withPreviewPolicy({ "content-type": ["text/html"] });
	assert.deepEqual(bare["Content-Security-Policy"], [guards.PREVIEW_CSP]);
	assert.deepEqual(bare["X-Content-Type-Options"], ["nosniff"]);
	assert.deepEqual(bare["content-type"], ["text/html"]);

	const own = guards.withPreviewPolicy({
		"content-security-policy": ["default-src 'self'"],
		"x-content-type-options": ["nosniff"],
	});
	// Two policies are both enforced by the browser: the result is never looser.
	assert.deepEqual(own["content-security-policy"], [
		"default-src 'self'",
		guards.PREVIEW_CSP,
	]);
	assert.equal(own["Content-Security-Policy"], undefined);
	assert.equal(own["X-Content-Type-Options"], undefined);
});

test("guardPreviewResponses rewrites only the preview route's headers", () => {
	let listener = null;
	guards.guardPreviewResponses({
		webRequest: {
			onHeadersReceived: (fn) => {
				listener = fn;
			},
		},
	});
	let answer = null;
	listener(
		{
			url: "http://127.0.0.1:1111/v1/static/html?path=x",
			responseHeaders: { a: ["b"] },
		},
		(r) => {
			answer = r;
		},
	);
	assert.deepEqual(answer.responseHeaders["Content-Security-Policy"], [
		guards.PREVIEW_CSP,
	]);
	listener(
		{ url: "http://127.0.0.1:1111/health", responseHeaders: {} },
		(r) => {
			answer = r;
		},
	);
	assert.deepEqual(answer, {}, "every other response passes untouched");
});

// --- source pins: the wiring and the sandbox attribute -------------------------

const code = (path) =>
	readFileSync(path, "utf8")
		// Pin the CODE, not the prose that explains why the code is this way.
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");

test("html-preview frames its document with allow-scripts ALONE", () => {
	const src = code(
		"src/renderer/src/features/chat/components/canvas/html-preview.tsx",
	);
	assert.match(src, /export const PREVIEW_SANDBOX = "allow-scripts";/);
	assert.match(src, /sandbox=\{PREVIEW_SANDBOX\}/);
	// No literal sandbox attribute is left beside the constant to drift from it.
	assert.doesNotMatch(src, /sandbox="/);
	for (const token of [
		"allow-same-origin",
		"allow-forms",
		"allow-popups",
		"allow-top-navigation",
		"allow-modals",
		"allow-downloads",
	])
		assert.doesNotMatch(src, new RegExp(token), token);
});

test("the main process installs every guard, before the first load", () => {
	const src = code("src/main/index.ts");
	for (const call of [
		"guardNavigation(mainWindow.webContents",
		"guardWindowOpen(",
		"guardPermissions(session.defaultSession",
		"guardPreviewResponses(session.defaultSession",
	])
		assert.ok(src.includes(call), `index.ts must call ${call}`);
	const guardAt = src.indexOf("guardNavigation(mainWindow.webContents");
	const loadAt = src.indexOf(
		"mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)",
	);
	assert.ok(
		guardAt > 0 && loadAt > guardAt,
		"the guard must precede the first load",
	);
	assert.ok(
		src.indexOf("setWindowOpenHandler") === -1,
		"the popup policy is guardWindowOpen's; a second handler here would be a second answer",
	);
});

test("shell.openExternal is reached only through the vetted door in the main window's paths", () => {
	const src = code("src/main/index.ts");
	const uses = [...src.matchAll(/shell\.openExternal\(([^)]*)\)/g)].map(
		(m) => m[1],
	);
	// The vetted door itself, and the fixed "local-operator.com" menu item.
	assert.deepEqual(uses.sort(), ['"https://local-operator.com"', "url"].sort());
	assert.match(
		src,
		/ipcMain\.handle\("open-external", async \(_, url\) => \{\s*await openExternalVetted\(url\);/,
	);
});
