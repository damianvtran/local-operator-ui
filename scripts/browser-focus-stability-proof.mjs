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
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import sharp from "sharp";
import { createFocusProofOwnedTree } from "./focus-proof-owned-tree.mjs";
import { focusProofWindowMode } from "./focus-stability-ci-policy.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

// Resolve the authorization before side effects; headless remains the default.
const windowMode = focusProofWindowMode(process.argv, process.env);
const nativeCi = windowMode === "inactive";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
assert(outArg >= 0 && process.argv[outArg + 1], "--out is required");
const out = resolve(process.argv[outArg + 1]);
mkdirSync(out, { recursive: true });
const save = (name, data) =>
	writeFileSync(join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sockets = [];
let child;
let ownedTree;
let inventoryTimer;
let cleanupPromise;
let exited = false;
let log = "";
const facts = { samples: [], events: [], failures: [] };
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
	child = spawn(
		electron,
		[
			root,
			"--inspect=0",
			"--remote-debugging-port=0",
			`--window-mode=${windowMode}`,
			`--user-data-dir=${dirs.profile}`,
			"--use-mock-keychain",
		],
		{ env, cwd: dirs.cwd, stdio: ["ignore", "pipe", "pipe"] },
	);
	ownedTree = createFocusProofOwnedTree({
		rootPid: child.pid,
		profile: dirs.profile,
	});
	inventoryTimer = setInterval(() => ownedTree.refresh(), 100);
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
	await until(
		() =>
			evaluate(
				main,
				`(() => { try { const E = process.mainModule.require('electron'); return E.BrowserWindow.getAllWindows().some(w => /index.html/.test(w.webContents.getURL())); } catch { return false; } })()`,
			),
		"built main window",
	);
	const owner = await connect(
		(
			await target(
				renderPort,
				(t) => t.type === "page" && /index.html/.test(t.url),
			)
		).webSocketDebuggerUrl,
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
				if(globalThis.__focusProof.disableFocusEmulation && args[0]==='Emulation.setFocusEmulationEnabled') {
					args[1]={...args[1],enabled:false};
					point('CONTROL-disable-focus-emulation',c);
				}
				point('before-cdp:'+args[0],c);
				return send(...args).then(result=>{point('after-cdp:'+args[0],c);return result;},error=>{point('error-cdp:'+args[0],c);throw error;});
			};
		};
		E.webContents.getAllWebContents().forEach(arm);
		E.app.on('web-contents-created', (_e,c) => arm(c));
		const w = E.BrowserWindow.getAllWindows()[0];
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
						if(globalThis.__focusProof.detachBackground && name==='setVisible' && values[0]===false && (!globalThis.__focusProof.detachTarget || globalThis.__focusProof.detachTarget===v.webContents.id)) {
							globalThis.__focusProof.detachTarget=v.webContents.id;
							globalThis.__focusProof.detachedView=v;
							if(w.contentView.children.includes(v)) w.contentView.removeChildView(v);
							point('CONTROL-detached-after-size',v.webContents);
						}
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
			w.showInactive();
			if (!w.isFocused()) {
				E.app.focus({steal:true});
				w.focus();
				globalThis.__focusProof.ciActivationUsed=true;
			}
		}
		w.webContents.focus();
		return true;
	})()`,
	);
	const sample = async (label) => {
		const native = await evaluate(
			main,
			`(() => { const E = process.mainModule.require('electron'); const w = E.BrowserWindow.getAllWindows()[0]; return { visible:w.isVisible(), focusable:w.isFocusable(), windowFocused:w.isFocused(), ownerId:w.webContents.id, ownerFocused:w.webContents.isFocused(), focused:E.webContents.getFocusedWebContents()?.id ?? null, views:w.contentView.children.map(v => ({id:v.webContents?.id, visible:v.getVisible(), focused:v.webContents?.isFocused()})), events:globalThis.__focusProof.events,ciActivationUsed:globalThis.__focusProof.ciActivationUsed??false }; })()`,
		);
		const dom = await evaluate(
			owner,
			"({ hash:location.hash, hasFocus:document.hasFocus(), active:document.activeElement?.outerHTML.slice(0,350), value:document.activeElement?.value, selection:[document.activeElement?.selectionStart,document.activeElement?.selectionEnd] })",
		);
		const result = { label, native, dom };
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
			"(async()=>{const E=process.mainModule.require('electron');return (await E.BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64');})()",
		);
		writeFileSync(join(out, `${label}.png`), Buffer.from(data, "base64"));
	};
	const osKey = async (label) => {
		if (!nativeCi) return { label, status: "BLOCKED_NOT_DISPOSABLE_CI" };
		const readCaret = () =>
			evaluate(
				owner,
				"({id:document.activeElement?.id,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd})",
			);
		const before = await readCaret();
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
			before,
			after,
			expected,
			permissionError,
			deliveredToShell:
				permissionError === null &&
				after.value === expected &&
				after.id === before.id,
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
	await evaluate(owner, `location.hash='#/browser'`);
	await until(
		() =>
			evaluate(
				owner,
				`!!document.querySelector('[data-tour-tag="browser-tab-strip"]') && !!window.api?.browser`,
			),
		"browser route",
	);
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const url = `http://127.0.0.1:${server.address().port}/`;
	const access = await rpc("request_access", {
		url,
		requester: "session:focus-proof",
	});
	if (access.state !== "allowed") {
		await evaluate(
			owner,
			`(async () => { const s=await window.api.browser.state(); const e=s.pendingConsent.find(e=>e.origin===${JSON.stringify(new URL(url).origin)}); if(!e) throw Error('missing consent'); await window.api.browser.respondToConsent(e.entryId,'site'); return true; })()`,
		);
	}
	// Establish an intentional presented page, then later create a second tab via
	// the AGENT RPC while an unrelated UI input holds the caret.
	await evaluate(
		owner,
		`(async () => { await window.api.browser.newTab(null); const s=await window.api.browser.state(); await window.api.browser.navigate(${JSON.stringify(url)},s.activeTabId); return true; })()`,
	);
	await target(renderPort, (t) => t.url === url);
	// The address row is a real product input. Opening it exercises the native
	// overlay lifecycle before repeated no-op layout passes, the known RED seam.
	await evaluate(
		owner,
		`document.querySelector('[data-tour-tag="browser-address"]')?.focus()`,
	);
	await sleep(600);
	await sample("address-open");
	// Focus the renderer's real command palette with its keyboard shortcut.
	await owner("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "k",
		code: "KeyK",
		modifiers: 4,
	});
	await owner("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "k",
		code: "KeyK",
		modifiers: 4,
	});
	await sleep(300);
	await sample("palette-before-background");
	if (nativeCi) {
		// Simulate the user's deliberate return to the shell input after opening
		// the palette. Hiding a previously focused native page can leave Electron's
		// focused-WebContents getter null even while the palette has a DOM caret.
		// This is SETUP ONLY: never restore native focus during background actions.
		await evaluate(
			main,
			"process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.focus(); true",
		);
		await evaluate(
			owner,
			"document.querySelector('#command-palette-input').focus(); true",
		);
	}
	await owner("Input.insertText", { text: "focusproof" });
	await evaluate(
		owner,
		"document.querySelector('#command-palette-input').setSelectionRange(2,6); true",
	);
	await sleep(1000);
	const osBaseline = await osKey("positive-baseline");
	if (nativeCi)
		assert.equal(
			osBaseline.deliveredToShell,
			true,
			`BLOCKED_OS_KEY_INSTRUMENT: ${JSON.stringify(osBaseline)}`,
		);
	await evaluate(
		owner,
		"document.querySelector('#command-palette-input').setSelectionRange(2,6);true",
	);
	const negativeControl = await sample("no-background-negative-control");
	if (nativeCi) {
		assert.equal(
			negativeControl.native.windowFocused,
			true,
			"negative control must establish native window focus",
		);
		assert.equal(
			negativeControl.native.ownerFocused,
			true,
			"negative control must establish native owner focus",
		);
		assert.equal(
			negativeControl.native.focused,
			negativeControl.native.ownerId,
			"native owner getter must agree before dispatch",
		);
		assert.match(
			negativeControl.dom.active ?? "",
			/command-palette-input/,
			"real palette input must own the DOM caret",
		);
	}
	await captureShell("attached-before");
	const backgroundUrl = `${url}?background=1`;
	const opened = await rpc("open", {
		url: backgroundUrl,
		requester: "session:focus-proof",
	});
	await sample("agent-open-and-load");
	await rpc("read", { tab: opened.tab });
	await sample("background-first-read-attach");
	await rpc("type", {
		tab: opened.tab,
		selector: "#field",
		text: "background typing",
	});
	await sample("background-type");
	await rpc("click", { tab: opened.tab, selector: "#button" });
	await sample("background-click");
	await rpc("screenshot", { tab: opened.tab });
	await sample("background-screenshot");
	await rpc("goto", { tab: opened.tab, url: `${backgroundUrl}&navigation=1` });
	await sample("background-navigation");
	// Dispatch through Electron's ACTUAL focused-WebContents getter, not a
	// hardcoded owner target. This proves the native receiver selection, not an
	// OS/physical keyboard route; no accessibility permission is requested.
	await captureShell("attached-after");
	await osKey("after-original-background-actions");
	facts.routedKey = await evaluate(
		main,
		`(() => {const E=process.mainModule.require('electron');const c=E.webContents.getFocusedWebContents();if(c)c.sendInputEvent({type:'char',keyCode:'z'});return {receiver:c?.id??null,physicalOsKey:false};})()`,
	);
	facts.routedKey.ownerAfter = await evaluate(
		owner,
		"({active:document.activeElement?.id,value:document.activeElement?.value,selection:[document.activeElement?.selectionStart,document.activeElement?.selectionEnd]})",
	);
	await rpc("close", { tab: opened.tab });
	if (nativeCi) {
		// Independent hypothesis trial on the SAME app: the only variable for the
		// fresh background target is focus emulation. Establish its owner once,
		// before dispatch, never as a reaction to the background page's events.
		await evaluate(
			main,
			"globalThis.__focusProof.disableFocusEmulation=true; process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.focus(); true",
		);
		const controlBefore = await sample("control-no-emulation-baseline");
		assert.equal(controlBefore.native.ownerFocused, true);
		const controlTab = await rpc("open", {
			url: `${url}?no-emulation=1`,
			requester: "session:focus-proof",
		});
		const controlAfter = await sample("control-no-emulation-open");
		facts.noEmulationControl = {
			beforeOwner: controlBefore.native.ownerFocused,
			afterOwner: controlAfter.native.ownerFocused,
			focused: controlAfter.native.focused,
		};
		await rpc("close", { tab: controlTab.tab });
		await evaluate(
			main,
			"globalThis.__focusProof.disableFocusEmulation=false; globalThis.__focusProof.detachBackground=true; process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.focus(); true",
		);
		const detachedOsBaseline = await osKey("detached-positive-baseline");
		assert.equal(
			detachedOsBaseline.deliveredToShell,
			true,
			`BLOCKED_DETACHED_OS_BASELINE: ${JSON.stringify(detachedOsBaseline)}`,
		);
		const detachedBefore = await sample("control-detached-baseline");
		await captureShell("detached-before");
		assert.equal(detachedBefore.native.ownerFocused, true);
		const detachedTab = await rpc("open", {
			url: `${url}?detached=1`,
			requester: "session:focus-proof",
		});
		const detachedAfter = await sample("control-detached-open");
		facts.detachedControl = {
			beforeOwner: detachedBefore.native.ownerFocused,
			afterOwner: detachedAfter.native.ownerFocused,
		};
		const geometry = () =>
			evaluate(
				main,
				`(async()=>{const c=process.mainModule.require('electron').webContents.fromId(globalThis.__focusProof.detachTarget);return await c.executeJavaScript('({width:innerWidth,height:innerHeight,hits:document.elementsFromPoint(10,10).map(e=>e.id),value:document.querySelector("#field").value,clicked:document.body.dataset.clicked})');})()`,
			);
		facts.detachedControl.geometry = await geometry();
		assert.equal(facts.detachedControl.geometry.width, 1280);
		assert.equal(facts.detachedControl.geometry.height, 720);
		assert.ok(facts.detachedControl.geometry.hits.includes("field"));
		facts.detachedControl.type = await rpc("type", {
			tab: detachedTab.tab,
			selector: "#field",
			text: "detached typing",
		});
		await rpc("click", { tab: detachedTab.tab, selector: "#button" });
		facts.detachedControl.interacted = await geometry();
		assert.equal(facts.detachedControl.interacted.value, "detached typing");
		assert.equal(facts.detachedControl.interacted.clicked, "yes");
		const detachedShot = await rpc("screenshot", { tab: detachedTab.tab });
		const png = Buffer.from(detachedShot.data, "base64");
		writeFileSync(join(out, "detached-control.png"), png);
		const metadata = await sharp(png).metadata();
		const stats = await sharp(png).stats();
		facts.detachedControl.screenshot = {
			width: metadata.width,
			height: metadata.height,
			nonblank: stats.channels.some((c) => c.max > c.min),
		};
		assert.equal(metadata.width, 1280);
		assert.equal(metadata.height, 720);
		assert.equal(facts.detachedControl.screenshot.nonblank, true);
		await sample("control-detached-actions");
		await captureShell("detached-after");
		const detachedOsAfter = await osKey("after-detached-background-actions");
		assert.equal(
			detachedOsAfter.deliveredToShell,
			true,
			`detached boundary did not preserve actual OS key route: ${JSON.stringify(detachedOsAfter)}`,
		);
		// Explicit user presentation, then route exit: migrate the SAME view, not
		// a reload/replacement. This is a diagnostic proposed-parenting trial only.
		await owner("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
		});
		await owner("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
		});
		await until(
			() =>
				evaluate(owner, "!document.querySelector('#command-palette-input')"),
			"palette closes for intentional presentation",
		);
		await evaluate(
			owner,
			`window.api.browser.activateTab(${Number(detachedTab.tab.split(":")[1])})`,
		);
		await evaluate(
			main,
			"const proof=globalThis.__focusProof; const w=process.mainModule.require('electron').BrowserWindow.getAllWindows()[0];w.contentView.addChildView(proof.detachedView);true",
		);
		await until(
			() => evaluate(main, "globalThis.__focusProof.detachedView.getVisible()"),
			"explicit presentation shows same view",
		);
		await sample("control-detached-presented");
		await evaluate(owner, "location.hash='#/chat'; true");
		await until(
			() =>
				evaluate(
					main,
					"!process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.includes(globalThis.__focusProof.detachedView)",
				),
			"route exit detaches view",
		);
		await evaluate(
			main,
			"process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.focus();true",
		);
		await sample("control-detached-route-exit-baseline");
		await rpc("goto", { tab: detachedTab.tab, url: `${url}?detached=2` });
		const afterRoute = await sample("control-detached-route-exit-navigation");
		facts.detachedControl.afterRouteOwner = afterRoute.native.ownerFocused;
		facts.detachedControl.afterRouteGeometry = await geometry();
		await rpc("close", { tab: detachedTab.tab });
	}
	// Record, don't fabricate success from a dormant instrument. A headless
	// window may never acquire a native first responder; that is BLOCKED proof,
	// not a pass for user-visible caret stability.
	facts.nativeOwnerObserved = facts.samples.some((s) => s.native.ownerFocused);
	facts.backgroundChanges = facts.samples
		.filter(
			(s) =>
				s.label.startsWith("background-") || s.label === "agent-open-and-load",
		)
		.map((s) => ({
			stage: s.label,
			nativeOwnerLost: !s.native.ownerFocused,
			windowLost: !s.native.windowFocused,
			domOwnerChanged: s.dom.active !== negativeControl.dom.active,
			valueChanged: s.dom.value !== negativeControl.dom.value,
			selectionChanged:
				JSON.stringify(s.dom.selection) !==
				JSON.stringify(negativeControl.dom.selection),
		}));
	facts.verdict = !facts.nativeOwnerObserved
		? "BLOCKED_NO_NATIVE_OWNER_IN_HEADLESS_WINDOW"
		: facts.backgroundChanges.some(
					(s) =>
						s.nativeOwnerLost ||
						s.windowLost ||
						s.domOwnerChanged ||
						s.valueChanged ||
						s.selectionChanged,
				)
			? "REPRO_FOCUS_OR_CARET_CHANGED_BY_BACKGROUND_ACTIVITY"
			: "PALETTE_NATIVE_OWNER_PRESERVED_IN_THIS_RUN";
	save("facts.json", facts);
} catch (error) {
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
		if (!tree.clean) process.exitCode = 1;
		writeFileSync(join(out, "app.log"), log);
		save("teardown.json", { pid: child?.pid, exited, ...tree });
		server.close();
	})();
	return cleanupPromise;
}
