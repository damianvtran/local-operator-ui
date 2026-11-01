#!/usr/bin/env node
/**
 * Opt-in native focus diagnostic, intended for an isolated macOS CI runner.
 * Loads the BUILT app, not a replacement BrowserWindow. Main-inspector readings
 * distinguish a DOM caret from the native WebContents first responder; emulating
 * page focus would hide precisely the distinction under investigation, so this
 * run does not emulate focus. Default runs remain hidden. Explicitly armed
 * disposable macOS CI may show/activate its OWN window to establish a native
 * first responder; this mode fails closed before spawn anywhere else.
 *
 * Usage: node scripts/browser-focus-stability-proof.mjs --out /absolute/evidence
 * Local native runs remain subject to the repository's resource/safety holds.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import electron from "electron";
import sharp from "sharp";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { selectTrustedRenderer } from "./focus-proof-main-identity.mjs";
import { createFocusProofOwnedTree } from "./focus-proof-owned-tree.mjs";
import { focusProofWindowMode } from "./focus-stability-ci-policy.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

// Resolve the authorization before side effects; headless remains the default.
const windowMode = focusProofWindowMode(process.argv, process.env);
const nativeCi = windowMode === "normal";
// The instrumented carrier is not the application under test. Pin that source.
assert(nativeCi, "seed trace requires explicitly armed disposable native CI");
const traceOnly = true;
assert(
	process.env.LOCAL_OPERATOR_FOCUS_PROOF_APP_ROOT,
	"explicit app root required",
);
const root = resolve(process.env.LOCAL_OPERATOR_FOCUS_PROOF_APP_ROOT);
assert.equal(
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	"699486b673ec6fc08c51a16af8aa397db59d6b91",
);
const expectedRendererUrl = pathToFileURL(
	join(root, "out/renderer/index.html"),
).href;
const outArg = process.argv.indexOf("--out");
assert(outArg >= 0 && process.argv[outArg + 1], "--out is required");
const out = resolve(process.argv[outArg + 1]);
mkdirSync(out, { recursive: true });
const save = (name, data) =>
	writeFileSync(join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sockets = [];
let child;
let fixtureChild;
let fixtureTree;
let fixtureLog = "";
let owner;
let mainWindowId;
let mainContentsId;
let ownedTree;
let inventoryTimer;
let cleanupPromise;
let seedTraceActive = false;
let exited = false;
let log = "";
const facts = { samples: [], events: [], failures: [], diagnosticOnly: true };
facts.carrierIdentity = {
	head: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
		encoding: "utf8",
	}).trim(),
	scriptSha256: createHash("sha256")
		.update(readFileSync(fileURLToPath(import.meta.url)))
		.digest("hex"),
	appRoot: root,
	scope: "SEED TRACE ONLY, NOT FOCUS ACCEPTANCE",
};

// Observation only: no value/accessor/focus/selection mutation in either probe.
// This CI-only carrier records synthetic seed keys, never an operator session.
function rendererSeedProbe(selector) {
	const pinned = globalThis.__focusAcceptanceField;
	const ids = new WeakMap();
	let serial = 0;
	const id = (x) => {
		if (!x) return null;
		if (!ids.has(x)) ids.set(x, ++serial);
		return ids.get(x);
	};
	const node = (x) =>
		x
			? {
					objectId: id(x),
					tag: x.tagName ?? x.nodeName,
					value: x.value ?? null,
					start: x.selectionStart ?? null,
					end: x.selectionEnd ?? null,
					connected: x.isConnected ?? null,
				}
			: null;
	const state = () => ({
		at: Date.now(),
		performance: performance.now(),
		hasFocus: document.hasFocus(),
		visibility: document.visibilityState,
		pinned: node(pinned),
		current: node(document.querySelector(selector)),
		active: node(document.activeElement),
		same: document.activeElement === pinned,
	});
	const data = {
		startedAt: Date.now(),
		selector,
		initial: state(),
		events: [],
		samples: [],
	};
	const add = (array, item) => {
		if (array.length < 2000) array.push(item);
	};
	const types = [
		"keydown",
		"keyup",
		"beforeinput",
		"input",
		"change",
		"focusin",
		"focusout",
		"selectionchange",
		"compositionstart",
		"compositionend",
	];
	const listener = (e) => {
		add(data.events, {
			kind: e.type,
			trusted: e.isTrusted,
			key: e.key ?? null,
			code: e.code ?? null,
			data: e.data ?? null,
			inputType: e.inputType ?? null,
			defaultPrevented: e.defaultPrevented,
			metaKey: e.metaKey ?? null,
			ctrlKey: e.ctrlKey ?? null,
			altKey: e.altKey ?? null,
			shiftKey: e.shiftKey ?? null,
			metaState: e.getModifierState?.("Meta") ?? null,
			isComposing: e.isComposing ?? null,
			target: node(e.target),
			state: state(),
		});
		queueMicrotask(() =>
			add(data.events, { kind: `after-${e.type}`, state: state() }),
		);
	};
	for (const type of types) document.addEventListener(type, listener, true);
	const timer = setInterval(
		() => add(data.samples, { kind: "interval", ...state() }),
		10,
	);
	let frame;
	const tick = () => {
		add(data.samples, { kind: "animation-frame", ...state() });
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	globalThis.__focusSeedDOM = {
		state,
		stop: () => {
			clearInterval(timer);
			cancelAnimationFrame(frame);
			for (const type of types)
				document.removeEventListener(type, listener, true);
			data.final = state();
			return data;
		},
	};
	return data.initial;
}
function nativeSeedProbe(windowId) {
	const E = process.mainModule.require("electron");
	const w = E.BrowserWindow.fromId(windowId);
	const data = { startedAt: Date.now(), windowId, events: [], samples: [] };
	const listeners = [];
	const add = (array, item) => {
		if (array.length < 2000) array.push(item);
	};
	const listen = (target, type, fn) => {
		target.on(type, fn);
		listeners.push([target, type, fn]);
	};
	for (const c of E.webContents.getAllWebContents()) {
		listen(c, "before-input-event", (_event, input) =>
			add(data.events, {
				at: Date.now(),
				kind: "before-input-event",
				contentsId: c.id,
				input: {
					type: input.type,
					key: input.key,
					code: input.code,
					modifiers: input.modifiers,
					control: input.control,
					meta: input.meta,
					alt: input.alt,
					shift: input.shift,
					isAutoRepeat: input.isAutoRepeat,
				},
			}),
		);
		for (const type of ["focus", "blur"])
			listen(c, type, () =>
				add(data.events, { at: Date.now(), kind: type, contentsId: c.id }),
			);
	}
	for (const type of ["focus", "blur"])
		listen(w, type, () =>
			add(data.events, { at: Date.now(), kind: `window-${type}`, windowId }),
		);
	const snapshot = () => {
		const focused = E.webContents.getFocusedWebContents();
		return {
			at: Date.now(),
			focused: focused?.id ?? null,
			windowGone: w.isDestroyed(),
			windowFocused: !w.isDestroyed() && w.isFocused(),
			ownerFocused: !w.isDestroyed() && w.webContents.isFocused(),
			children: w.isDestroyed()
				? null
				: w.contentView.children.map((v) => ({
						id: v.webContents?.id,
						visible: v.getVisible(),
					})),
		};
	};
	data.initial = snapshot();
	const timer = setInterval(() => add(data.samples, snapshot()), 10);
	globalThis.__focusSeedNative = {
		stop: () => {
			clearInterval(timer);
			for (const [target, type, fn] of listeners)
				target.removeListener(type, fn);
			data.final = snapshot();
			return data;
		},
	};
	return data.initial;
}
async function collectSeedTrace() {
	if (!seedTraceActive) return;
	seedTraceActive = false;
	facts.seedTrace = {
		dom: await evaluate(owner, "globalThis.__focusSeedDOM.stop()"),
		native: await evaluate(main, "globalThis.__focusSeedNative.stop()"),
	};
	save("seed-trace.json", facts.seedTrace);
}

const server = createServer((_req, response) => {
	response.setHeader("content-type", "text/html");
	response.end(
		`<!doctype html><title>Focus fixture</title><input id="field"><button id="button" onclick="document.body.dataset.clicked='yes'">Action</button>`,
	);
});

async function until(read, label, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const result = await read();
		if (result) return result;
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${label}`);
}
async function connect(url) {
	const socket = new WebSocket(url);
	sockets.push(socket);
	await new Promise((done, reject) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let id = 0;
	return async (method, params = {}) => {
		const requestId = ++id;
		return new Promise((done, reject) => {
			const timer = setTimeout(
				() => finish(new Error(`${method} timed out`)),
				15000,
			);
			const receive = (message) => {
				const payload = JSON.parse(message.data);
				if (payload.id !== requestId) return;
				finish(
					payload.error ? new Error(JSON.stringify(payload.error)) : null,
					payload.result,
				);
			};
			const finish = (error, result) => {
				clearTimeout(timer);
				socket.removeEventListener("message", receive);
				if (error) reject(error);
				else done(result);
			};
			socket.addEventListener("message", receive);
			socket.send(JSON.stringify({ id: requestId, method, params }));
		});
	};
}
async function evaluate(send, expression) {
	const result = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails)
		throw new Error(JSON.stringify(result.exceptionDetails));
	return result.result?.value;
}
async function target(port, predicate) {
	return until(async () => {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			return (await response.json()).find(predicate);
		} catch {
			return null;
		}
	}, "debug target");
}
let main;
for (const [name, code] of [
	["SIGINT", 130],
	["SIGTERM", 143],
]) {
	process.once(name, () => {
		void cleanup().finally(() => process.exit(code));
	});
}
try {
	const identity = {
		head: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
		sourceDiff: execFileSync("git", ["diff", "--", "src"], {
			cwd: root,
			encoding: "utf8",
		}),
		compiled: Object.fromEntries(
			[
				"out/main/index.js",
				"out/main/index.jsc",
				"out/renderer/index.html",
			].map((path) => [
				path,
				createHash("sha256")
					.update(readFileSync(join(root, path)))
					.digest("hex"),
			]),
		),
	};
	assert.equal(
		identity.sourceDiff,
		"",
		"commit source before compiling/dispatching proof",
	);
	save("build-identity.json", identity);
	const dirs = Object.fromEntries(
		["home", "config", "logs", "profile", "cwd"].map((name) => [
			name,
			join(out, name),
		]),
	);
	for (const path of Object.values(dirs)) mkdirSync(path, { recursive: true });
	writeFileSync(
		join(dirs.cwd, ".env"),
		"VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:9\nVITE_DISABLE_BACKEND_MANAGER=true\n",
	);
	const env = withNotificationsOff({
		...process.env,
		HOME: dirs.home,
		LOCAL_OPERATOR_CONFIG_DIR: dirs.config,
		LOCAL_OPERATOR_LOG_DIR: dirs.logs,
		LOCAL_OPERATOR_UI_WINDOW_MODE: windowMode,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env))
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	// The real chat route intentionally withholds its composer without
	// session_catalogue >= 2. Reuse the repository's existing claim/capability
	// fixture, rather than bypassing the UI gate or mounting a fake input.
	const reservation = createServer();
	await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
	const fixturePort = reservation.address().port;
	await new Promise((done) => reservation.close(done));
	const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
	fixtureChild = spawn(
		process.execPath,
		[
			join(root, "docs/evidence/session-archive/harness/stub-daemon.mjs"),
			"--port",
			String(fixturePort),
			"--records",
			join(dirs.config, "run/serve"),
		],
		{ env, cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	fixtureChild.stdout.on("data", (chunk) => {
		fixtureLog += chunk;
	});
	fixtureChild.stderr.on("data", (chunk) => {
		fixtureLog += chunk;
	});
	fixtureTree = createFocusProofOwnedTree({
		rootPid: fixtureChild.pid,
		profile: join(out, "not-a-profile-fixture"),
	});
	await until(async () => {
		try {
			return (
				await fetch(`${fixtureUrl}/health`, {
					signal: AbortSignal.timeout(1000),
				})
			).ok;
		} catch {
			return false;
		}
	}, "existing daemon fixture health");
	const capabilityResponse = await fetch(`${fixtureUrl}/v1/capabilities`);
	const fixtureCapabilities = await capabilityResponse.json();
	assert.equal(
		fixtureCapabilities.result?.features?.session_catalogue,
		2,
		"real composer fixture must advertise catalogue v2",
	);
	facts.composerPrerequisite = {
		fixture: "docs/evidence/session-archive/harness/stub-daemon.mjs",
		url: fixtureUrl,
		sessionCatalogue: fixtureCapabilities.result.features.session_catalogue,
		liveSessionUpdates: false,
	};
	writeFileSync(
		join(dirs.cwd, ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=${fixtureUrl}\nVITE_DISABLE_BACKEND_MANAGER=true\n`,
	);
	env.VITE_LOCAL_OPERATOR_API_URL = fixtureUrl;
	child = spawn(
		electron,
		[
			root,
			"--inspect=0",
			"--remote-debugging-port=0",
			`--window-mode=${windowMode}`,
			`--user-data-dir=${dirs.profile}`,
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd: dirs.cwd, stdio: ["ignore", "pipe", "pipe"] },
	);
	ownedTree = createFocusProofOwnedTree({
		rootPid: child.pid,
		profile: dirs.profile,
	});
	inventoryTimer = setInterval(() => {
		ownedTree.refresh();
		fixtureTree.refresh();
	}, 100);
	child.on("exit", () => {
		exited = true;
	});
	child.stdout.on("data", (chunk) => {
		log += chunk;
	});
	child.stderr.on("data", (chunk) => {
		log += chunk;
	});
	const mainPort = await until(
		() => /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)?.[1],
		"main inspector",
	);
	const renderPort = await until(
		() => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)?.[1],
		"renderer inspector",
	);
	main = await connect(
		(await target(mainPort, (t) => t.type === "node")).webSocketDebuggerUrl,
	);
	const pinned = await until(async () => {
		const candidates = await evaluate(
			main,
			"(()=>{try{const E=process.mainModule.require('electron');return E.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({windowId:w.id,webContentsId:w.webContents.id,url:w.webContents.getURL()}));}catch{return [];}})()",
		);
		return selectTrustedRenderer(candidates, expectedRendererUrl);
	}, "unique exact built main window");
	mainWindowId = pinned.windowId;
	mainContentsId = pinned.webContentsId;
	const nonce = randomUUID();
	await evaluate(
		main,
		`process.mainModule.require('electron').webContents.fromId(${mainContentsId}).executeJavaScript(${JSON.stringify(`globalThis.__focusProofPinnedNonce=${JSON.stringify(nonce)};true`)})`,
	);
	const rendererTarget = await until(async () => {
		let candidates;
		try {
			candidates = await (
				await fetch(`http://127.0.0.1:${renderPort}/json/list`, {
					signal: AbortSignal.timeout(5000),
				})
			).json();
		} catch {
			return null;
		}
		return selectTrustedRenderer(
			candidates.filter((t) => t.type === "page"),
			expectedRendererUrl,
		);
	}, "unique exact built renderer target");
	owner = await connect(rendererTarget.webSocketDebuggerUrl);
	assert.equal(
		await evaluate(owner, "globalThis.__focusProofPinnedNonce"),
		nonce,
		"native and renderer observations must share the same pinned WebContents",
	);
	facts.mainIdentity = {
		...pinned,
		expectedRendererUrl,
		rendererTargetId: rendererTarget.id,
		nonceVerified: true,
		windowMode,
	};
	identity.mainIdentity = facts.mainIdentity;
	identity.electron = await evaluate(main, "process.versions.electron");
	save("build-identity.json", identity);
	// URL assignment precedes Electron ready-to-show. Wait for the product's
	// normal presentation path; focusing a still-hidden window is not a valid
	// native-owner precondition, and the probe must never force a substitute show.
	if (nativeCi)
		await until(
			() =>
				evaluate(
					main,
					`process.mainModule.require('electron').BrowserWindow.fromId(${mainWindowId}).isVisible()`,
				),
			"product normal window ready-to-show",
		);
	await evaluate(
		main,
		`(() => {
		const E = process.mainModule.require('electron');
		globalThis.__focusProof = { events: [], attachments: [] };
		const arm = c => {
			for (const type of ['focus','blur','did-start-loading','did-finish-load']) c.on(type, () => globalThis.__focusProof.events.push({type, id:c.id, at:Date.now()}));
			const attach=c.debugger.attach.bind(c.debugger);
			c.debugger.attach=(...args)=>{point('before-debugger-attach',c);const result=attach(...args);point('after-debugger-attach',c);return result;};
			const send=c.debugger.sendCommand.bind(c.debugger);
			c.debugger.sendCommand=(...args)=>{
				point('before-cdp:'+args[0],c);
				return send(...args).then(result=>{point('after-cdp:'+args[0],c);return result;},error=>{point('error-cdp:'+args[0],c);throw error;});
			};
		};
		E.webContents.getAllWebContents().forEach(arm);
		E.app.on('web-contents-created', (_e,c) => arm(c));
		const w = E.BrowserWindow.fromId(${mainWindowId});
		const point=(stage,c)=>globalThis.__focusProof.events.push({stage,id:c?.id,at:Date.now(),ownerFocused:w.webContents.isFocused(),focused:E.webContents.getFocusedWebContents()?.id??null});
		const add=w.contentView.addChildView.bind(w.contentView);
		w.contentView.addChildView=(v,...args)=>{
			point('before-add',v.webContents);
			const result=add(v,...args);
			point('after-add',v.webContents);
			if(!v.__focusWrapped){
				v.__focusWrapped=true;
				for(const name of ['setBounds','setVisible']){
					const original=v[name].bind(v);
					v[name]=(...values)=>{
						const r=original(...values);point(name+':'+JSON.stringify(values),v.webContents);
						return r;
					};
				}
			}
			return result;
		};
		// WebContents focus stays inside this window; activation is separately
		// armed and rechecked INSIDE Electron, on disposable macOS CI only.
		if (${nativeCi}) {
			if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS' || process.env.CI !== 'true' || process.env.LOCAL_OPERATOR_FOCUS_PROOF_CI !== '1') throw Error('CI native owner authorization missing inside Electron');
			if (!w.isFocused()) {
				E.app.focus({steal:true});
				w.focus();
				globalThis.__focusProof.ciActivationUsed=true;
			}
		}
		return true;
	})()`,
	);
	const sample = async (label) => {
		const native = await evaluate(
			main,
			`(() => { const E = process.mainModule.require('electron'); const w = E.BrowserWindow.fromId(${mainWindowId}); return { visible:w.isVisible(), focusable:w.isFocusable(), windowFocused:w.isFocused(), windowId:w.id,url:w.webContents.getURL(),ownerId:w.webContents.id, ownerFocused:w.webContents.isFocused(), focused:E.webContents.getFocusedWebContents()?.id ?? null, views:w.contentView.children.map(v => ({id:v.webContents?.id,url:v.webContents?.getURL(),visible:v.getVisible(),focused:v.webContents?.isFocused()})), inventory:E.webContents.getAllWebContents().map(c=>({id:c.id,url:c.getURL(),type:c.getType(),parents:E.BrowserWindow.getAllWindows().filter(owner=>owner.contentView.children.some(v=>v.webContents?.id===c.id)).map(owner=>owner.id)})), events:globalThis.__focusProof.events,ciActivationUsed:globalThis.__focusProof.ciActivationUsed??false }; })()`,
		);
		const dom = await evaluate(
			owner,
			"({ hash:location.hash, hasFocus:document.hasFocus(), active:document.activeElement?.outerHTML.slice(0,350), value:document.activeElement?.value, selection:[document.activeElement?.selectionStart,document.activeElement?.selectionEnd] })",
		);
		assert.ok(
			native.views.every((view) => view.visible),
			`unpresented native browser children cannot remain attached: ${JSON.stringify(native.views)}`,
		);
		assert.equal(
			native.ownerId,
			mainContentsId,
			"native owner identity must remain pinned",
		);
		assert.ok(
			selectTrustedRenderer([native], expectedRendererUrl),
			"pinned app URL may only change its hash route",
		);
		assert.equal(
			await evaluate(owner, "globalThis.__focusProofPinnedNonce"),
			nonce,
			"renderer observation cannot drift to another target",
		);
		const result = { label, native, dom, at: Date.now() };
		facts.samples.push(result);
		assert.equal(
			native.visible,
			nativeCi,
			"visibility must match explicitly authorized mode",
		);
		assert.equal(
			native.focusable,
			nativeCi,
			"focusability must match explicitly authorized mode",
		);
		console.log(JSON.stringify(result));
		return result;
	};
	const captureShell = async (label) => {
		const data = await evaluate(
			main,
			`(async()=>{const E=process.mainModule.require('electron');return (await E.BrowserWindow.fromId(${mainWindowId}).webContents.capturePage()).toPNG().toString('base64');})()`,
		);
		writeFileSync(join(out, `${label}.png`), Buffer.from(data, "base64"));
	};
	const osKey = async (label) => {
		if (!nativeCi) return { label, status: "BLOCKED_NOT_DISPOSABLE_CI" };
		const readCaret = () =>
			evaluate(
				owner,
				"({id:document.activeElement?.id,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd,same:document.activeElement===globalThis.__focusAcceptanceField,connected:globalThis.__focusAcceptanceField?.isConnected})",
			);
		const before = await readCaret();
		const startedAt = Date.now();
		let permissionError = null;
		try {
			execFileSync(
				"/usr/bin/osascript",
				["-e", 'tell application "System Events" to keystroke "q"'],
				{ encoding: "utf8", timeout: 5000 },
			);
		} catch (error) {
			permissionError = String(error);
		}
		await sleep(250);
		const after = await readCaret();
		const expected =
			typeof before.value === "string"
				? `${before.value.slice(0, before.start)}q${before.value.slice(before.end)}`
				: null;
		const result = {
			label,
			startedAt,
			finishedAt: Date.now(),
			before,
			after,
			expected,
			permissionError,
			deliveredToShell:
				permissionError === null &&
				after.value === expected &&
				after.id === before.id &&
				after.same === true &&
				after.connected === true,
		};
		facts.osKeys ??= [];
		facts.osKeys.push(result);
		return result;
	};
	await sample("startup");
	const state = await until(() => {
		try {
			return JSON.parse(
				readFileSync(join(out, "config/run/ui-browser/host.json"), "utf8"),
			);
		} catch {
			return null;
		}
	}, "browser host state");
	const rpc = async (method, params) => {
		const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Bridge-Key": state.session_key,
			},
			body: JSON.stringify({ id: `focus-${method}`, method, params }),
			signal: AbortSignal.timeout(20000),
		});
		const result = await response.json();
		assert.equal(result.ok, true, `${method}: ${JSON.stringify(result)}`);
		return result.result;
	};
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const url = `http://127.0.0.1:${server.address().port}/`;
	const access = await rpc("request_access", {
		url,
		requester: "session:focus-proof",
	});
	if (access.state !== "allowed")
		await evaluate(
			owner,
			`(async()=>{const s=await window.api.browser.state();const e=s.pendingConsent.find(e=>e.origin===${JSON.stringify(new URL(url).origin)});if(!e)throw Error('missing consent');await window.api.browser.respondToConsent(e.entryId,'site');return true;})()`,
		);
	assert.equal(
		nativeCi,
		true,
		"final acceptance requires explicitly authorized disposable macOS CI",
	);
	const os = (body) =>
		execFileSync(
			"/usr/bin/osascript",
			["-e", `tell application "System Events" to ${body}`],
			{ encoding: "utf8", timeout: 5000 },
		);
	// Use the product's real keyboard doors. System Events `click at` can
	// perform an AX action without delivering a Chromium pointer event; a native
	// keyboard focus walk is observable and needs no additional mouse carrier.
	const visiblePoint = async (selector) =>
		evaluate(
			owner,
			`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.readOnly)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.x,y:r.y}:null;})()`,
		);
	const focusShell = async (selector) => {
		await until(() => visiblePoint(selector), `visible ${selector}`);
		for (let step = 0; step < 80; step++) {
			if (
				await evaluate(
					owner,
					`!!document.activeElement?.matches(${JSON.stringify(selector)})`,
				)
			)
				return;
			os("key code 48");
			await sleep(75);
		}
		throw Error(`real Tab traversal did not reach ${selector}`);
	};
	const openPalette = async () => {
		os('keystroke "p" using {command down}');
		await until(
			() =>
				evaluate(owner, "document.activeElement?.id==='command-palette-input'"),
			"actual CmdP opens and focuses palette",
		);
	};
	const navigate = async (route) => {
		if ((await evaluate(owner, "location.hash")) === `#/${route}`) return;
		if (
			!(await evaluate(
				main,
				`process.mainModule.require('electron').BrowserWindow.fromId(${mainWindowId}).webContents.isFocused()`,
			))
		) {
			// A real browser user's CmdL moves to the address row through the shipped
			// native chord route; never request owner.focus from the inspector.
			os('keystroke "l" using {command down}');
			await sleep(200);
		}
		await openPalette();
		os('keystroke "a" using {command down}');
		os(`keystroke "${route}"`);
		await until(
			() => evaluate(owner, `!!document.getElementById('page-${route}')`),
			`palette route ${route}`,
		);
		for (let step = 0; step < 40; step++) {
			const options = await evaluate(
				owner,
				"[...document.querySelectorAll('#command-palette-results [role=option]')].map(e=>({id:e.id,selected:e.getAttribute('aria-selected')==='true'}))",
			);
			const target = options.findIndex((e) => e.id === `page-${route}`);
			const active = options.findIndex((e) => e.selected);
			assert.ok(target >= 0, `route option disappeared: ${route}`);
			if (active === target) break;
			os(`key code ${active > target ? 126 : 125}`);
			await sleep(75);
		}
		assert.equal(
			await evaluate(
				owner,
				`document.querySelector('#command-palette-results [aria-selected=true]')?.id`,
			),
			`page-${route}`,
		);
		os("key code 36");
		await until(
			() =>
				evaluate(
					owner,
					`location.hash.split('?')[0]===${JSON.stringify(`#/${route}`)}&&!document.querySelector('#command-palette-input')`,
				),
			`actual palette navigates ${route}`,
		);
	};
	const caret = () =>
		evaluate(
			owner,
			"({same:document.activeElement===globalThis.__focusAcceptanceField,connected:globalThis.__focusAcceptanceField?.isConnected,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd})",
		);
	const fieldCase = async (name, selector) => {
		await focusShell(selector);
		await evaluate(
			owner,
			`globalThis.__focusAcceptanceField=document.querySelector(${JSON.stringify(selector)});true`,
		);
		seedTraceActive = true;
		facts.seedDOMInitial = await evaluate(
			owner,
			`(${rendererSeedProbe.toString()})(${JSON.stringify(selector)})`,
		);
		facts.seedNativeInitial = await evaluate(
			main,
			`(${nativeSeedProbe.toString()})(${mainWindowId})`,
		);
		const pre = await sample(`${name}-seed-pre`);
		assert.equal(
			pre.native.ownerFocused,
			true,
			"native main WC owns keyboard before seed",
		);
		// Detached/emulated WCs can also report focus: the accepted 9/9 OS-key
		// run already returned WC4 here. Keep the getter as an observation; the
		// all-WC before-input trace, not this non-unique getter, shows routing.
		facts.seedGlobalFocusGetter = {
			observed: pre.native.focused,
			mainContentsId,
		};
		assert.equal(
			pre.native.windowFocused,
			true,
			"native window focused before seed",
		);
		assert.equal(
			await evaluate(owner, "document.hasFocus()"),
			true,
			"document focus before seed",
		);
		facts.seedCommandStartedAt = Date.now();
		os('keystroke "a" using {command down}');
		os('keystroke "focusproof"');
		facts.seedCommandFinishedAt = Date.now();
		facts.seedImmediate = await caret();
		await sleep(200);
		facts.seedExpected = "focusproof";
		facts.seedActual = await caret();
		assert.equal(
			facts.seedActual.value,
			facts.seedExpected,
			"STRICT seed precondition before positive q",
		);
		await evaluate(
			owner,
			"globalThis.__focusAcceptanceField.setSelectionRange(2,6);true",
		);
		const positive = await osKey(`${name}-positive-baseline`);
		assert.equal(
			positive.deliveredToShell,
			true,
			`actual OS key baseline failed: ${JSON.stringify(positive)}`,
		);
		await evaluate(
			owner,
			"globalThis.__focusAcceptanceField.setSelectionRange(2,6);true",
		);
		const before = await caret();
		assert.equal(before.same, true);
		assert.equal(before.connected, true);
		assert.deepEqual([before.start, before.end], [2, 6]);
		if (traceOnly) {
			await collectSeedTrace();
			await captureShell("seed-trace-composer");
			facts.seedCase = { name, before };
			return null;
		}
		const baseline = await sample(`${name}-baseline`);
		assert.equal(baseline.native.ownerFocused, true);
		await captureShell(`${name}-before`);
		const check = async (stage) => {
			const after = await caret();
			const reading = await sample(`${name}-${stage}`);
			assert.deepEqual(after, before, `${name} caret changed during ${stage}`);
			assert.equal(
				reading.native.ownerFocused,
				true,
				`${name} native owner lost during ${stage}`,
			);
		};
		const caseUrl = `${url}?case=${name}`;
		const opened = await rpc("open", {
			url: caseUrl,
			requester: "session:focus-proof",
		});
		await check("agent-open");
		await rpc("read", { tab: opened.tab });
		await check("read");
		await rpc("type", {
			tab: opened.tab,
			selector: "#field",
			text: "background typing",
		});
		await check("type");
		await rpc("click", { tab: opened.tab, selector: "#button" });
		await check("click");
		const shot = await rpc("screenshot", { tab: opened.tab });
		await check("capture");
		const png = Buffer.from(shot.data, "base64");
		const metadata = await sharp(png).metadata();
		const stats = await sharp(png).stats();
		assert.equal(metadata.width, 1280);
		assert.equal(metadata.height, 720);
		assert.ok(stats.channels.some((c) => c.max > c.min));
		writeFileSync(join(out, `${name}-background.png`), png);
		await rpc("goto", { tab: opened.tab, url: `${caseUrl}&nav=1` });
		await check("navigation");
		// More real host layout/broadcast churn, without claiming live canonical
		// session-daemon coverage: that renderer path is unchanged by this fix.
		for (let tick = 0; tick < 3; tick++) {
			await rpc("open", { tab: opened.tab, requester: "session:focus-proof" });
			await check(`broadcast-${tick}`);
		}
		await captureShell(`${name}-after`);
		const actual = await osKey(`${name}-after-background`);
		assert.equal(
			actual.deliveredToShell,
			true,
			`actual OS key lost after background activity: ${JSON.stringify(actual)}`,
		);
		const page = await evaluate(
			main,
			`(async()=>{const E=process.mainModule.require('electron');const c=E.webContents.getAllWebContents().find(c=>c.getURL()===${JSON.stringify(`${caseUrl}&nav=1`)});return {id:c.id,geometry:await c.executeJavaScript('({width:innerWidth,height:innerHeight,hits:document.elementsFromPoint(10,10).map(e=>e.id)})')};})()`,
		);
		assert.equal(page.geometry.width, 1280);
		assert.equal(page.geometry.height, 720);
		assert.ok(page.geometry.hits.includes("field"));
		facts.cases ??= [];
		facts.cases.push({
			name,
			before,
			after: actual.after,
			tabId: Number(opened.tab.split(":")[1]),
			webContentsId: page.id,
			geometry: page.geometry,
			osKeyDelivered: true,
		});
		return { opened, page };
	};

	await navigate("chat");
	await fieldCase("composer", '[data-tour-tag="chat-input-textarea"] textarea');
	if (traceOnly) {
		facts.verdict = "DIAGNOSTIC_ONLY_COMPLETE_SEED_AND_POSITIVE_Q";
		save("facts.json", facts);
	} else {
		await openPalette();
		await until(() => visiblePoint("#command-palette-input"), "palette open");
		const paletteCase = await fieldCase("palette", "#command-palette-input");
		os("key code 53");
		await until(
			() =>
				evaluate(owner, "!document.querySelector('#command-palette-input')"),
			"real Escape closes palette",
		);
		const escaped = await sample("palette-escape");
		assert.equal(escaped.native.ownerFocused, true);
		assert.equal(
			await evaluate(
				owner,
				"document.activeElement!==document.body&&document.activeElement?.isConnected",
			),
			true,
			"Escape restores an intentional shell focus owner",
		);
		await captureShell("palette-escape");
		// Settings is deliberately unavailable in this existing capability fixture.
		// Use a different REAL input already present in the live sidebar instead of
		// manufacturing settings data or substituting another composer/palette.
		await navigate("chat");
		await focusShell("[data-sidebar-search]");
		os("key code 49");
		await fieldCase(
			"sidebar-filter",
			'input[aria-label="Search chats and agents"]',
		);

		// Ownership transfer is a real renderer IPC on a still-unpresented page.
		// Its controls use a synthetic session; no daemon/session state is fabricated.
		const ownershipBefore = await sample("ownership-before");
		await evaluate(
			owner,
			`window.api.browser.handOver(${Number(paletteCase.opened.tab.split(":")[1])},'session:focus-proof-adopter')`,
		);
		const ownershipAfter = await sample("ownership-after");
		assert.equal(
			ownershipAfter.native.ownerFocused,
			ownershipBefore.native.ownerFocused,
		);
		const ownershipKey = await osKey("ownership-transfer-key");
		assert.equal(ownershipKey.deliveredToShell, true);

		await navigate("browser");
		const tabId = Number(paletteCase.opened.tab.split(":")[1]);
		await focusShell('[data-tour-tag="browser-tab-strip"] [role="tab"]');
		// Digit shortcuts follow the rendered session groups, not registry insertion
		// order. The actual focused strip is the keyboard's owner (the ownership
		// transfer above moves one tab into another group without changing API order).
		const tabOrder = await evaluate(
			owner,
			"(()=>{const strip=document.activeElement.closest('[data-tour-tag=browser-tab-strip]');if(!strip)throw Error('keyboard is not in the live tab strip');return [...strip.querySelectorAll('[data-tab-id] [role=tab]')].map(e=>Number(e.closest('[data-tab-id]').dataset.tabId));})()",
		);
		assert.equal(
			new Set(tabOrder).size,
			tabOrder.length,
			"rendered tab IDs must be unique",
		);
		facts.renderedTabOrder = tabOrder;
		const targetOrdinal = tabOrder.indexOf(tabId) + 1;
		assert.ok(targetOrdinal > 0 && targetOrdinal < 10);
		os(`keystroke "${targetOrdinal}" using {command down}`);
		await until(
			() =>
				evaluate(
					main,
					`process.mainModule.require('electron').BrowserWindow.fromId(${mainWindowId}).contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id}&&v.getVisible())`,
				),
			"user presents same view",
		);
		const pageCaret = () =>
			evaluate(
				main,
				`process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id}).executeJavaScript('({active:document.activeElement?.id,value:document.querySelector("#field").value,start:document.querySelector("#field").selectionStart,end:document.querySelector("#field").selectionEnd})')`,
			);
		const visibleNativeDocument = (filename) => {
			const expected = pathToFileURL(join(root, "out/renderer", filename)).href;
			return evaluate(
				main,
				`(()=>{const E=process.mainModule.require('electron');const views=E.BrowserWindow.fromId(${mainWindowId}).contentView.children.filter(v=>{if(!v.webContents||!v.getVisible())return false;const u=new URL(v.webContents.getURL());u.search='';u.hash='';return u.href===${JSON.stringify(expected)};});if(views.length>1)throw Error('ambiguous native overlay document');return views[0]?{id:views[0].webContents.id,url:views[0].webContents.getURL(),bounds:views[0].getBounds()}:null;})()`,
			);
		};
		// The shipped keyboard door returns native ownership to the page. It is
		// intentionally available only under the real user's normal launch policy.
		os('keystroke "l" using {command down}');
		await until(
			() =>
				evaluate(
					owner,
					"document.activeElement?.matches('[data-tour-tag=browser-address]')",
				),
			"actual CmdL focuses address row",
		);
		os('keystroke "a" using {command down}');
		os('keystroke "localhost"');
		const addressPopup = await until(
			() => visibleNativeDocument("browser-address-overlay-list.html"),
			"real native address suggestion presentation",
		);
		const addressBefore = await evaluate(owner, "document.activeElement.value");
		assert.equal(addressBefore, "localhost");
		os('keystroke "q"');
		await sleep(200);
		assert.equal(
			await evaluate(owner, "document.activeElement.value"),
			"localhostq",
			"native address popout must not take actual OS typing from its field",
		);
		facts.addressPopup = addressPopup;
		const addressPng = await evaluate(
			main,
			`(async()=>{return (await process.mainModule.require('electron').webContents.fromId(${addressPopup.id}).capturePage()).toPNG().toString('base64');})()`,
		);
		writeFileSync(
			join(out, "intentional-native-address.png"),
			Buffer.from(addressPng, "base64"),
		);
		await sample("native-address-typing");
		os("key code 53");
		await until(
			() =>
				evaluate(
					main,
					`process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id}).isFocused()`,
				),
			"actual Escape returns native browser focus",
		);
		for (let step = 0; step < 6; step++) {
			if (
				await evaluate(
					main,
					`process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id}).executeJavaScript('document.activeElement?.id===\"field\"')`,
				)
			)
				break;
			os("key code 48");
			await sleep(100);
		}
		assert.equal(
			await evaluate(
				main,
				`process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id}).executeJavaScript('document.activeElement?.id===\"field\"')`,
			),
			true,
			"real Tab traversal reaches the presented page input",
		);
		os('keystroke "human"');
		await sleep(200);
		assert.equal(
			(await pageCaret()).value,
			"human",
			"actual OS typing reaches explicitly presented browser page",
		);
		await captureShell("intentional-browser-present");
		await sample("intentional-browser-present");
		const presentedPng = await evaluate(
			main,
			`(async()=>{const c=process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id});return (await c.capturePage()).toPNG().toString('base64');})()`,
		);
		writeFileSync(
			join(out, "intentional-browser-page.png"),
			Buffer.from(presentedPng, "base64"),
		);
		const pageKey = async (label, text) => {
			const before = await pageCaret();
			const startedAt = Date.now();
			const expected =
				before.value.slice(0, before.start) +
				text +
				before.value.slice(before.end);
			os(`keystroke "${text}"`);
			await sleep(200);
			const after = await pageCaret();
			facts.pageKeys ??= [];
			facts.pageKeys.push({
				label,
				startedAt,
				finishedAt: Date.now(),
				before,
				after,
				expected,
			});
			assert.equal(
				after.value,
				expected,
				`${label}: actual OS key must reach the original browser input`,
			);
			assert.equal(after.active, "field");
		};
		const approvalUrl = `http://localhost:${server.address().port}/?approval-native=1`;
		const approval = await rpc("request_access", {
			url: approvalUrl,
			requester: "session:focus-proof",
		});
		assert.equal(
			approval.state,
			"pending",
			"distinct fixture origin must exercise real native approval arrival",
		);
		const card = () => visibleNativeDocument("browser-approvals-overlay.html");
		await until(card, "ready native approval auto-presentation");
		await pageKey("approval-auto-present-unfocused", "r");
		await sample("approval-auto-present-unfocused");
		os('keystroke "l" using {command down}');
		await focusShell('[data-tour-tag="browser-approvals"]');
		os("key code 49");
		await until(
			() =>
				evaluate(
					owner,
					"window.api.browser.state().then(s=>s.approvalsCard.open)",
				),
			"user opens native approval via shield",
		);
		const focusedCard = await until(async () => {
			const current = await card();
			if (!current) return null;
			return (await evaluate(
				main,
				`process.mainModule.require('electron').webContents.fromId(${current.id}).isFocused()`,
			))
				? current
				: null;
		}, "explicit native approval focus");
		facts.approvalCard = focusedCard;
		const cardPng = await evaluate(
			main,
			`(async()=>{return (await process.mainModule.require('electron').webContents.fromId(${focusedCard.id}).capturePage()).toPNG().toString('base64');})()`,
		);
		writeFileSync(
			join(out, "intentional-native-approval.png"),
			Buffer.from(cardPng, "base64"),
		);
		os("key code 53");
		await until(
			() =>
				evaluate(
					owner,
					"window.api.browser.state().then(s=>!s.approvalsCard.open)",
				),
			"actual Escape dismisses native approval",
		);
		await pageKey("approval-escape-restores-page", "s");
		await sample("approval-escape-restores-page");
		// Dispose only this synthetic request after the actual user dismissal. The
		// decision IPC is fixture cleanup, not a focus operation or substitute gesture.
		await evaluate(
			owner,
			`(async()=>{const state=await window.api.browser.state();const entry=state.pendingConsent.find(e=>e.origin===${JSON.stringify(new URL(approvalUrl).origin)});if(entry)await window.api.browser.respondToConsent(entry.entryId,'deny');return true;})()`,
		);
		const retainedPageValue = (await pageCaret()).value;
		// Switch away and back through actual tab controls; the same page state is
		// retained, and no inspector addChildView/focus restoration participates.
		const otherId = facts.cases[0].tabId;
		const otherOrdinal = tabOrder.indexOf(otherId) + 1;
		os(`keystroke "${otherOrdinal}" using {command down}`);
		await until(
			() =>
				evaluate(
					owner,
					`window.api.browser.state().then(s=>s.activeTabId===${otherId})`,
				),
			"actual browser tab switch",
		);
		os(`keystroke "${targetOrdinal}" using {command down}`);
		await until(
			() =>
				evaluate(
					owner,
					`window.api.browser.state().then(s=>s.activeTabId===${tabId})`,
				),
			"actual browser tab return",
		);
		assert.equal((await pageCaret()).value, retainedPageValue);
		await navigate("chat");
		await until(
			() =>
				evaluate(
					main,
					`!process.mainModule.require('electron').BrowserWindow.fromId(${mainWindowId}).contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id})`,
				),
			"route exit detaches browser page",
		);
		await navigate("browser");
		await until(
			() =>
				evaluate(
					main,
					`process.mainModule.require('electron').BrowserWindow.fromId(${mainWindowId}).contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id}&&v.getVisible())`,
				),
			"route return presents same native view",
		);
		assert.equal(
			(await pageCaret()).value,
			retainedPageValue,
			"route return preserves same WebContents and document",
		);
		await navigate("chat");
		await fieldCase(
			"composer-after-route",
			'[data-tour-tag="chat-input-textarea"] textarea',
		);
		facts.intentionalHandoffs = {
			physicalBrowserTyping: true,
			sameWebContentsId: paletteCase.page.id,
			tabSwitchStatePreserved: true,
			routeReturnStatePreserved: true,
			modalEscape: true,
			approvalAutoPresentPreservesTyping: true,
			approvalShieldEscapeRestoresPage: true,
			ownershipTransferWhileUnpresented: true,
		};
		facts.nativeCanonicalSessionUpdates =
			"NOT_EXERCISED: no live daemon; session renderer sources unchanged; component rerender regression supplied separately";
		facts.verdict = "PASS_SHIPPED_NATIVE_PARENT_BOUNDARY_AND_ACTUAL_OS_KEYS";
		save("facts.json", facts);
	}
} catch (error) {
	if (seedTraceActive)
		try {
			await collectSeedTrace();
		} catch (traceError) {
			facts.seedTraceCollectionError = String(traceError);
		}
	// Preserve the REAL failed prerequisite/route before teardown. A missing
	// selector without a frame/DOM cannot distinguish a gate from a bad locator.
	if (owner && main) {
		try {
			save(
				"failure-dom.json",
				await evaluate(
					owner,
					"({hash:location.hash,ready:document.readyState,text:document.body.innerText.slice(0,12000),inputs:[...document.querySelectorAll('input,textarea,button')].slice(0,100).map(e=>({html:e.outerHTML.slice(0,400),rect:e.getBoundingClientRect().toJSON()}))})",
				),
			);
			const frame = await evaluate(
				main,
				`(async()=>{const E=process.mainModule.require('electron');return (await E.BrowserWindow.fromId(${mainWindowId}).webContents.capturePage()).toPNG().toString('base64');})()`,
			);
			writeFileSync(
				join(out, "failure-frame.png"),
				Buffer.from(frame, "base64"),
			);
		} catch (captureError) {
			facts.failureCaptureError = String(captureError);
		}
	}
	facts.failures.push(String(error));
	save("facts.json", facts);
	console.error(error);
	process.exitCode = 1;
} finally {
	await cleanup();
}

function cleanup() {
	cleanupPromise ??= (async () => {
		// The same cleanup runs after normal completion, failure and interruption,
		// even when the root has exited. Inspector clients must disconnect first.
		if (main && !exited)
			await evaluate(
				main,
				"process.mainModule.require('electron').app.quit(); true",
			).catch(() => {});
		for (const socket of sockets) socket.close();
		if (child && !exited)
			await until(() => exited, "app quit", 3000).catch(() => {});
		clearInterval(inventoryTimer);
		const tree = ownedTree
			? await ownedTree.stop()
			: { clean: !child, owned: [], survivors: [] };
		const fixture = fixtureTree
			? await fixtureTree.stop()
			: { clean: !fixtureChild, owned: [], survivors: [] };
		if (!tree.clean || !fixture.clean) process.exitCode = 1;
		writeFileSync(join(out, "app.log"), log);
		writeFileSync(join(out, "fixture.log"), fixtureLog);
		save("teardown.json", {
			pid: child?.pid,
			exited,
			...tree,
			fixture,
			clean: tree.clean && fixture.clean,
		});
		server.close();
	})();
	return cleanupPromise;
}
