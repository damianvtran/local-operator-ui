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
				"({id:document.activeElement?.id,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd,same:document.activeElement===globalThis.__focusAcceptanceField,connected:globalThis.__focusAcceptanceField?.isConnected})",
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
	const visiblePoint = async (selector) =>
		evaluate(
			owner,
			`(() => {const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;});if(!el)return null;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
		);
	const clickShell = async (selector) => {
		const point = await until(
			() => visiblePoint(selector),
			`visible ${selector}`,
		);
		const bounds = await evaluate(
			main,
			"process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getContentBounds()",
		);
		os(
			`click at {${Math.round(bounds.x + point.x)},${Math.round(bounds.y + point.y)}}`,
		);
		await sleep(200);
	};
	const navigate = async (route) => {
		if ((await evaluate(owner, "location.hash")) === `#/${route}`) return;
		const selector = `[data-tour-tag="nav-item-${route}"]`;
		if (!(await visiblePoint(selector)))
			await clickShell('[data-tour-tag="nav-item-more"]');
		await clickShell(selector);
		await until(
			() => evaluate(owner, `location.hash===${JSON.stringify(`#/${route}`)}`),
			`user navigation ${route}`,
		);
	};
	const caret = () =>
		evaluate(
			owner,
			"({same:document.activeElement===globalThis.__focusAcceptanceField,connected:globalThis.__focusAcceptanceField?.isConnected,value:document.activeElement?.value,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd})",
		);
	const fieldCase = async (name, selector) => {
		await clickShell(selector);
		await evaluate(
			owner,
			`globalThis.__focusAcceptanceField=document.querySelector(${JSON.stringify(selector)});true`,
		);
		os('keystroke "a" using {command down}');
		os('keystroke "focusproof"');
		await sleep(200);
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
	await clickShell("[data-command-palette-trigger]");
	await until(() => visiblePoint("#command-palette-input"), "palette open");
	const paletteCase = await fieldCase("palette", "#command-palette-input");
	os("key code 53");
	await until(
		() => evaluate(owner, "!document.querySelector('#command-palette-input')"),
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
	await navigate("settings");
	await fieldCase("settings-search", 'input[role="combobox"]');

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
	await clickShell(`[data-tab-id="${tabId}"] [role="tab"]`);
	await until(
		() =>
			evaluate(
				main,
				`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id}&&v.getVisible())`,
			),
		"user presents same view",
	);
	const pageCaret = () =>
		evaluate(
			main,
			`process.mainModule.require('electron').webContents.fromId(${paletteCase.page.id}).executeJavaScript('({value:document.querySelector("#field").value,start:document.querySelector("#field").selectionStart,end:document.querySelector("#field").selectionEnd})')`,
		);
	const point = await evaluate(
		main,
		`(async()=>{const E=process.mainModule.require('electron');const w=E.BrowserWindow.getAllWindows()[0];const v=w.contentView.children.find(v=>v.webContents?.id===${paletteCase.page.id});const r=await v.webContents.executeJavaScript('(()=>{const r=document.querySelector("#field").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');return {window:w.getContentBounds(),view:v.getBounds(),point:r};})()`,
	);
	os(
		`click at {${Math.round(point.window.x + point.view.x + point.point.x)},${Math.round(point.window.y + point.view.y + point.point.y)}}`,
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
	// Switch away and back through actual tab controls; the same page state is
	// retained, and no inspector addChildView/focus restoration participates.
	const otherId = facts.cases[0].tabId;
	await clickShell(`[data-tab-id="${otherId}"] [role="tab"]`);
	await clickShell(`[data-tab-id="${tabId}"] [role="tab"]`);
	assert.equal((await pageCaret()).value, "human");
	await navigate("chat");
	await until(
		() =>
			evaluate(
				main,
				`!process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id})`,
			),
		"route exit detaches browser page",
	);
	await navigate("browser");
	await clickShell(`[data-tab-id="${tabId}"] [role="tab"]`);
	await until(
		() =>
			evaluate(
				main,
				`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].contentView.children.some(v=>v.webContents?.id===${paletteCase.page.id}&&v.getVisible())`,
			),
		"route return presents same native view",
	);
	assert.equal(
		(await pageCaret()).value,
		"human",
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
		ownershipTransferWhileUnpresented: true,
	};
	facts.nativeCanonicalSessionUpdates =
		"NOT_EXERCISED: no live daemon; session renderer sources unchanged; component rerender regression supplied separately";
	facts.verdict = "PASS_SHIPPED_NATIVE_PARENT_BOUNDARY_AND_ACTUAL_OS_KEYS";
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
