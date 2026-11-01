#!/usr/bin/env node
/** Disposable-CI evidence only. Reuse the real target app/preload and existing
 * stories; never patch the dependency or pretend fixture transitions are E2E.
 * This carrier branch is intentionally separate from both reviewed PR heads. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import electron from "electron";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { selectTrustedRenderer } from "./focus-proof-main-identity.mjs";
import { createFocusProofOwnedTree } from "./focus-proof-owned-tree.mjs";
import { focusProofWindowMode } from "./focus-stability-ci-policy.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const INSPECTOR_PORT = /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//;
const EXISTING_TEST_SHIM = /dom\.window\.electron\s*=\s*(\{[\s\S]*?\n\});/;
const mode = focusProofWindowMode(process.argv, process.env);
assert.equal(
	mode,
	"normal",
	"explicit disposable macOS native CI authorization required",
);
const arg = (key) => process.argv[process.argv.indexOf(key) + 1];
const root = resolve(arg("--root"));
const out = resolve(arg("--out"));
const sha = "10b07b9891d2bbc2c667c029c588bf63f87c1fce";
assert.equal(
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	sha,
);
assert.equal(
	execFileSync("git", ["diff", "--exit-code"], { cwd: root, encoding: "utf8" }),
	"",
);
mkdirSync(out, { recursive: true });
const save = (file, value) =>
	writeFileSync(join(out, file), `${JSON.stringify(value, null, 2)}\n`);
const facts = {
	source: {
		sha,
		unmergedPr: 1572,
		kind: "component-level against real TeamBridgePageView with mocked transport; not live backend E2E; unmerged10b07b9891d2bbc2c667c029c588bf63f87c1fce",
	},
	frames: [],
	failures: [],
};
const dirs = Object.fromEntries(
	["home", "config", "logs", "profile", "cwd"].map((key) => [
		key,
		join(out, key),
	]),
);
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
const env = withNotificationsOff({
	...process.env,
	HOME: dirs.home,
	LOCAL_OPERATOR_HOME: dirs.home,
	LOCAL_OPERATOR_CONFIG_DIR: dirs.config,
	LOCAL_OPERATOR_LOG_DIR: dirs.logs,
	LOCAL_OPERATOR_UI_WINDOW_MODE: mode,
	VITE_DISABLE_BACKEND_MANAGER: "true",
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:9",
	STORYBOOK_DISABLE_TELEMETRY: "1",
});
withTelemetryOff(env);
for (const key of Object.keys(env))
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
writeFileSync(
	join(dirs.cwd, ".env"),
	"VITE_DISABLE_BACKEND_MANAGER=true\nVITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:9\n",
);
const trees = [];
const sockets = [];
let refresh;
let cleanupPromise;
let appLog = "";
let storyLog = "";
let port;
let main;
let windowId;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(read, label, limit = 60000) {
	const end = Date.now() + limit;
	while (Date.now() < end) {
		const value = await read();
		if (value) return value;
		await pause(100);
	}
	throw Error(`timed out: ${label}`);
}
async function cleanup() {
	if (cleanupPromise) return cleanupPromise;
	cleanupPromise = (async () => {
		clearInterval(refresh);
		for (const socket of sockets) socket.close();
		const receipts = [];
		for (const tree of [...trees].reverse()) receipts.push(await tree.stop());
		save("teardown.json", { clean: receipts.every((r) => r.clean), receipts });
		writeFileSync(join(out, "app.log"), appLog);
		writeFileSync(join(out, "storybook.log"), storyLog);
		assert(
			receipts.every((r) => r.clean),
			"owned app/Storybook survivors",
		);
	})();
	return cleanupPromise;
}
for (const signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => {
		cleanup().finally(() => process.exit(1));
	});
async function connect(url) {
	const socket = new WebSocket(url);
	sockets.push(socket);
	await new Promise((done, fail) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", fail, { once: true });
	});
	let id = 0;
	return async (expression) => {
		const request = ++id;
		return new Promise((done, fail) => {
			const timer = setTimeout(() => finish(Error("inspector timeout")), 30000);
			function finish(error, value) {
				clearTimeout(timer);
				socket.removeEventListener("message", receive);
				if (error) fail(error);
				else done(value);
			}
			function receive(event) {
				const value = JSON.parse(event.data);
				if (value.id !== request) return;
				if (value.error || value.result?.exceptionDetails)
					finish(
						Error(JSON.stringify(value.error ?? value.result.exceptionDetails)),
					);
				else finish(null, value.result?.result?.value);
			}
			socket.addEventListener("message", receive);
			socket.send(
				JSON.stringify({
					id: request,
					method: "Runtime.evaluate",
					params: { expression, awaitPromise: true, returnByValue: true },
				}),
			);
		});
	};
}
const native = (body) =>
	main(
		`(()=>{const E=process.mainModule.require('electron');const w=E.BrowserWindow.fromId(${windowId});if(!w||w.isDestroyed())throw Error('pinned window gone');return (${body})(w,E);})()`,
	);
const js = (expression) =>
	native(
		`w=>w.webContents.executeJavaScript(${JSON.stringify(expression)},true)`,
	);
const SNAPSHOT = `(()=>{const p=window.__dependencyCapture;const rows=[...document.querySelectorAll('[data-row-key]')];return {at:Date.now(),performance:performance.now(),rowCount:rows.length,rows:rows.map(r=>({key:r.dataset.rowKey,messageId:r.dataset.messageId,delivery:r.dataset.delivery,text:r.textContent})),same:!!p.first&&rows[0]===p.first,firstConnected:p.first?.isConnected??false,spinner:!!document.querySelector('[aria-label="Loading messages"]'),finishDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Finish thread read'))?.disabled??null,viewport:{width:innerWidth,height:innerHeight},fonts:document.fonts.status,theme:document.documentElement.dataset.theme};})()`;
async function capture(label) {
	const requestedAt = Date.now();
	await js(
		"new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))",
	);
	const state = await js(SNAPSHOT);
	const bytes = Buffer.from(
		await native(
			"async w=>(await w.webContents.capturePage()).toPNG().toString('base64')",
		),
		"base64",
	);
	writeFileSync(join(out, `${label}.png`), bytes);
	facts.frames.push({
		label,
		requestedAt,
		state,
		capturedAt: Date.now(),
		sha256: createHash("sha256").update(bytes).digest("hex"),
	});
	return state;
}
const prefix = "team-bridge-optimistic-send--";
async function story(name, args = "") {
	// Separate story cases must not inherit the previous case's cleared draft.
	// This touches only the disposable CI profile, never within either transition.
	await js(
		"if(location.origin==='http://127.0.0.1:6006'){localStorage.clear();sessionStorage.clear();}",
	);
	const url = `http://127.0.0.1:6006/iframe.html?id=${prefix}${name}&viewMode=story${args ? `&args=${args}` : ""}`;
	await native(`w=>w.loadURL(${JSON.stringify(url)})`);
	const ready = await until(
		async () =>
			js(
				`(()=>{const b=document.querySelector('button[aria-label="Send"],button[aria-label="Send message"]');const c=window.__STORYBOOK_ADDONS_CHANNEL__??window.__STORYBOOK_PREVIEW__?.channel;return b&&!b.disabled&&window.electron?.ipcRenderer&&c?.emit&&document.fonts.status==='loaded'?{url:location.href,bridge:true,channel:true,styles:getComputedStyle(document.body).fontFamily,rows:document.querySelectorAll('[data-row-key]').length}:null;})()`,
			),
		`existing ${name} story/bridge/channel/styles`,
	);
	assert.equal(ready.url, url);
	assert.equal(ready.rows, 0);
	facts[name] = ready;
	await js(
		`window.__dependencyCapture={first:null,commits:[]};new MutationObserver(()=>{const p=window.__dependencyCapture;if(!p.first)p.first=document.querySelector('[data-row-key]');}).observe(document.querySelector('#storybook-root'),{subtree:true,childList:true});`,
	);
}
async function send() {
	await js(
		`(()=>{const b=document.querySelector('button[aria-label="Send"],button[aria-label="Send message"]');if(!b||b.disabled)throw Error('send not enabled');b.click();})()`,
	);
	await until(
		async () => (await js(SNAPSHOT)).rowCount === 1,
		"actual optimistic row",
	);
}
try {
	const book = spawn(
		"pnpm",
		[
			"exec",
			"storybook",
			"dev",
			"--ci",
			"--host",
			"127.0.0.1",
			"--port",
			"6006",
		],
		{ cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	trees.push(
		createFocusProofOwnedTree({
			rootPid: book.pid,
			profile: join(out, "not-a-profile-storybook"),
		}),
	);
	for (const stream of [book.stdout, book.stderr])
		stream.on("data", (chunk) => {
			storyLog = (storyLog + chunk).slice(-2000000);
		});
	refresh = setInterval(() => {
		for (const tree of trees) tree.refresh();
	}, 100);
	const index = await until(async () => {
		try {
			const r = await fetch("http://127.0.0.1:6006/index.json", {
				signal: AbortSignal.timeout(1000),
			});
			return r.ok ? r.json() : null;
		} catch {
			return null;
		}
	}, "existing story index");
	assert(index.entries[`${prefix}person-first-message-handoff`]);
	assert(index.entries[`${prefix}chief-first-message-pending`]);
	const app = spawn(
		electron,
		[
			root,
			"--inspect=0",
			"--window-mode=normal",
			`--user-data-dir=${dirs.profile}`,
			MOCK_KEYCHAIN_SWITCH,
		],
		{ cwd: dirs.cwd, env, stdio: ["ignore", "pipe", "pipe"] },
	);
	trees.push(
		createFocusProofOwnedTree({ rootPid: app.pid, profile: dirs.profile }),
	);
	for (const stream of [app.stdout, app.stderr])
		stream.on("data", (chunk) => {
			const text = String(chunk);
			port ??= INSPECTOR_PORT.exec(appLog + text)?.[1];
			appLog = (appLog + text).slice(-2000000);
		});
	await until(() => port, "actual app inspector");
	const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
	main = await connect(targets[0].webSocketDebuggerUrl);
	const expected = pathToFileURL(join(root, "out/renderer/index.html")).href;
	const selected = await until(
		async () =>
			selectTrustedRenderer(
				await main(
					"(()=>{const E=process.mainModule.require('electron');return E.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({windowId:w.id,url:w.webContents.getURL()}));})()",
				),
				expected,
			),
		"exact built target window",
	);
	windowId = selected.windowId;
	await until(() => native("w=>w.isVisible()"), "normal product presentation");
	// Storybook deliberately owns window.api; the shipping preload freezes it.
	// Keep that product guard intact and render only in this CI-native story host.
	facts.shippingBootstrap = await native(
		"w=>({windowId:w.id,contentsId:w.webContents.id,url:w.webContents.getURL(),bounds:w.getBounds()})",
	);
	const shim = readFileSync(
		join(root, "scripts/team-bridge-optimistic-send.test.mjs"),
		"utf8",
	).match(EXISTING_TEST_SHIM)?.[1];
	assert(
		shim,
		"existing test's exact Electron bridge shim must remain discoverable",
	);
	facts.source.testShimSha256 = createHash("sha256").update(shim).digest("hex");
	const created = await native(`async (w,E)=>{
	 if(!(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_OS==='macOS'&&process.env.LOCAL_OPERATOR_FOCUS_PROOF_CI==='1'))throw Error('native carrier visibility not authorized');
	 const b=w.getBounds();w.hide();const c=new E.BrowserWindow({x:b.x,y:b.y,width:b.width,height:b.height,show:false,frame:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
	 c.webContents.debugger.attach('1.3');await c.webContents.debugger.sendCommand('Page.enable');
	 await c.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:${JSON.stringify(`window.electron=${shim};`)}});
	 await c.loadURL('about:blank');c.show();c.focus();return {windowId:c.id,contentsId:c.webContents.id};}`);
	windowId = created.windowId;
	facts.native = await native(
		"w=>({windowId:w.id,contentsId:w.webContents.id,bounds:w.getBounds(),contentBounds:w.getContentBounds(),visible:w.isVisible(),focused:w.isFocused(),electron:process.versions.electron,host:'separate CI-native story window, no shipping preload; not the shipping main UI'})",
	);
	assert.equal(facts.native.contentsId, created.contentsId);
	facts.source.compiledPayloadSha256 = createHash("sha256")
		.update(readFileSync(join(root, "out/main/index.jsc")))
		.digest("hex");
	facts.source.carrierSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		encoding: "utf8",
	}).trim();
	facts.source.executedCarrierScriptSha256 = createHash("sha256")
		.update(readFileSync(fileURLToPath(import.meta.url)))
		.digest("hex");
	facts.source.electronBinary = {
		path: electron,
		sha256: createHash("sha256").update(readFileSync(electron)).digest("hex"),
	};
	facts.source.executionScope =
		"Shipping app bootstrap ran; separate inspector-created native story window hosts the frames. Compiled index.js/index.jsc digests are not a bytecode execution trace or live app-flow proof.";
	facts.source.builtMainSha256 = createHash("sha256")
		.update(readFileSync(join(root, "out/main/index.js")))
		.digest("hex");
	facts.source.rendererTree = execFileSync(
		"git",
		["rev-parse", "HEAD:src/renderer"],
		{ cwd: root, encoding: "utf8" },
	).trim();
	facts.captureCadence =
		"sequential rAF-aligned capturePage calls; not measured every-compositor-frame cadence";
	facts.source.storySha256 = createHash("sha256")
		.update(
			readFileSync(
				join(
					root,
					"src/renderer/src/features/team-bridge/team-bridge-optimistic-send.stories.tsx",
				),
			),
		)
		.digest("hex");
	await story("person-first-message-handoff");
	await capture("A-ready");
	await send();
	for (let i = 0; i < 3; i++) {
		const s = await capture(`A-loading-${i}`);
		assert.equal(s.rowCount, 1);
		assert(s.same && s.firstConnected);
		assert.equal(s.spinner, false);
		assert.equal(s.finishDisabled, false);
	}
	await js(
		"[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Finish thread read')).click()",
	);
	for (let i = 0; i < 2; i++) {
		const s = await capture(`A-settled-${i}`);
		assert.equal(s.rowCount, 1);
		assert(s.same && s.firstConnected);
		assert.equal(s.spinner, false);
	}
	const ownerArgs = { selfAccountId: "acct_other", selfName: "Other account" };
	const tenantArgs = {
		scope: "tnt_other",
		organizations: [
			{ tenantId: "tnt_other", name: "Other tenant", role: "owner", unread: 0 },
		],
	};
	facts.privacy = [];
	for (const [label, updatedArgs] of [
		["combined", { ...ownerArgs, ...tenantArgs }],
		["self-only", ownerArgs],
		["tenant-only", tenantArgs],
	]) {
		await story("chief-first-message-pending");
		await send();
		await capture(`B-${label}-pending`);
		await js(
			`(()=>{const p=window.__dependencyCapture;const root=document.querySelector('#storybook-root');p.observer=new MutationObserver(()=>p.commits.push(${SNAPSHOT}));p.observer.observe(root,{subtree:true,childList:true,characterData:true});const c=window.__STORYBOOK_ADDONS_CHANNEL__??window.__STORYBOOK_PREVIEW__.channel;c.emit('updateStoryArgs',{storyId:'${prefix}chief-first-message-pending',updatedArgs:${JSON.stringify(updatedArgs)}});})()`,
		);
		const commits = await until(async () => {
			const c = await js("window.__dependencyCapture.commits");
			return c.length ? c : null;
		}, `first ${label} DOM commit`);
		assert.equal(
			commits[0].rowCount,
			0,
			"no old row in FIRST committed DOM snapshot",
		);
		assert.equal(commits[0].firstConnected, false);
		for (let i = 0; i < 3; i++) {
			const state = await capture(`B-${label}-${i}`);
			assert.equal(state.rowCount, 0);
			assert.equal(state.firstConnected, false);
		}
		assert(
			await js(
				"!!document.querySelector('textarea') && !!document.querySelector('button[aria-label=Send],button[aria-label=\"Send message\"]')",
			),
			"privacy change did not render an error/blank page",
		);
		if (updatedArgs.scope)
			assert(
				await js("document.body.innerText.includes('Other tenant')"),
				"new tenant really displayed",
			);
		const all = await js("window.__dependencyCapture.commits");
		assert(all.every((c) => c.rowCount === 0));
		facts.privacy.push({
			label,
			updatedArgs,
			firstCommit: commits[0],
			commits: all,
		});
	}
	// Existing sibling stories supply failure/confirmed states; no transport shim.
	await story("chief-first-message-failed");
	await send();
	await until(
		() => js("!!document.querySelector('[data-delivery-failed]')"),
		"existing failed row",
	);
	await capture("error-existing-failed-story");
	await story("chief-first-message-reconciled");
	await send();
	await capture("populated-existing-confirmed-story");
	const defaultWidth = facts.native.contentBounds.width;
	await native("w=>{w.setMinimumSize(320,480);w.setContentSize(480,740);}");
	const narrow = await capture("narrow-populated");
	assert(narrow.viewport.width < defaultWidth, "actual native narrow viewport");
	await story("chief-first-message-reconciled", "theme:ayuLight");
	await until(
		() => js("document.documentElement.dataset.theme==='ayuLight'"),
		"actual existing Ayu Light palette",
	);
	await capture("nondefault-light-empty");
	await send();
	const light = await capture("nondefault-light-populated");
	assert.equal(light.theme, "ayuLight");
	facts.verdict =
		"PASS_NATIVE_EXISTING_STORY_HANDOFF_AND_FIRST_DOM_COMMIT_PRIVACY";
} catch (error) {
	facts.failures.push(String(error));
	try {
		facts.failureDom = await js(
			"({text:document.body.innerText,globals:Object.keys(window).filter(k=>k.includes('STORYBOOK')),url:location.href,bridge:!!window.electron})",
		);
		const png = Buffer.from(
			await native(
				"async w=>(await w.webContents.capturePage()).toPNG().toString('base64')",
			),
			"base64",
		);
		writeFileSync(join(out, "failure.png"), png);
	} catch {}
	process.exitCode = 1;
} finally {
	save("facts.json", facts);
	await cleanup();
}
