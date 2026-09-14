#!/usr/bin/env node
/** Main-process Node inspector only: no renderer/page CDP, browser engine,
 * altered fuses, app-update.yml patches, re-signing, or quarantine bypass.
 * A missing native capability is BLOCKED, never a surrogate PASS.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { finalContainerChecks, finalMetadataChecks, privatePythonSeedCheck } from "./python-artifact-layout.mjs";
import { spawnRunner, runChecks, bundledPythonCheck, bundledBytecodeCheck } from "./verify-macos-artifacts.mjs";
const execute = promisify(execFile);
const evidence = resolve("signed-update-evidence"); mkdirSync(evidence, { recursive: true });
const rows = [];
function record(surface, verdict, actual) { rows.push({ surface, verdict, actual }); writeFileSync(join(evidence, "matrix.json"), JSON.stringify(rows, null, 2)); console.log(`${verdict} ${surface}: ${actual}`); }
function blocked(message) { record("Exact signed update", "BLOCKED", message); throw Object.assign(new Error(message), { blocked: true }); }
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const candidateDir = resolve(arg("--candidate-dir"));
const tag = arg("--incumbent-tag");
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve("electron-builder"));
const { load } = createRequire(builder.resolve("app-builder-lib"))("js-yaml");
const owned = [];
let feed;
let inspector;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function command(program, args) {
	try { const result = await execute(program, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }); appendFileSync(join(evidence, "commands.log"), `${program} ${JSON.stringify(args)}\n${result.stdout}${result.stderr}\nexit=0\n`); return result.stdout; }
	catch (error) { appendFileSync(join(evidence, "commands.log"), `${program} ${JSON.stringify(args)}\n${error.stdout ?? ""}${error.stderr ?? ""}\nexit=${error.code}\n`); throw error; }
}
async function until(work, timeout = 60_000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await work(); if (value) return value; await delay(250); } throw new Error("Timed out waiting for owned update operation"); }
async function inspectorAt(port) {
	let target;
	try { target = await until(async () => { try { const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) }); return (await response.json()).find((target) => target.type === "node"); } catch { return null; } }, 20_000); }
	catch { blocked("The unmodified signed incumbent did not expose a standard main-process Node inspector. No fuses or signatures were changed."); }
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
	let next = 0; const pending = new Map();
	socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const call = pending.get(message.id); if (call) { pending.delete(message.id); message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result); } });
	return {
		close: () => socket.close(),
		async evaluate(expression) {
			const id = ++next;
			const response = await Promise.race([new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } })); }), delay(30_000).then(() => { throw new Error("Main inspector evaluation timed out"); })]);
			if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
			return response.result?.value;
		},
	};
}
async function download(url, path) { const response = await fetch(url); if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`); writeFileSync(path, Buffer.from(await response.arrayBuffer())); }
function safeEnv(extra = {}) { return { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: homedir(), LANG: "en_US.UTF-8", TERM: "xterm-256color", TMPDIR: tmpdir(), ...extra }; }
function startOwned(executable, args, label, env = safeEnv()) { const log = createWriteStream(join(evidence, `${label}.log`)); const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] }); child.stdout.pipe(log); child.stderr.pipe(log); owned.push(child); return child; }

try {
	if (process.platform !== "darwin" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") blocked("This proof may run only on a fresh GitHub-hosted macOS VM, never a user's machine or self-hosted runner");
	if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Incumbent must be an exact release tag");
	// BLOCKED rather than FAIL: a VM that carries signing or API credentials is
	// misconfigured, and calling that a product failure would send a reader to the
	// candidate's code. Nothing below this line runs when it fires.
	if (["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID", "CSC_CONTENT", "CSC_KEY_PASSWORD", "GH_TOKEN", "GITHUB_TOKEN"].some((name) => process.env[name])) blocked("Signing/API credentials reached the test VM. The exact-update job must have no secrets.");
	try { await command("/bin/launchctl", ["print", `gui/${process.getuid()}`]); } catch { blocked("The hosted runner lacks a native GUI launchd session; Squirrel/native relaunch cannot be validated here"); }
	const support = join(homedir(), "Library", "Application Support", "Local Operator");
	if (existsSync(support) || existsSync(join(homedir(), ".local-operator"))) blocked("Runner home is not pristine; refusing to overwrite pre-existing application state");
	const scratch = mkdtempSync(join(tmpdir(), "signed-update-"));
	mkdirSync(support, { recursive: true });
	const sentinel = join(support, "synthetic-user-data.txt"); writeFileSync(sentinel, "signed-update synthetic user data\n");
	const dataHash = createHash("sha256").update(readFileSync(sentinel)).digest("hex");
	const artifacts = readdirSync(candidateDir).filter((name) => /\.(zip|dmg)$/.test(name)).map((name) => join(candidateDir, name));
	const metadataResults = finalMetadataChecks(candidateDir, artifacts);
	assert.ok(metadataResults.length && metadataResults.every((row) => row.passed), JSON.stringify(metadataResults));
	const candidateZip = artifacts.find((path) => path.endsWith(`-${process.arch}.zip`));
	assert.ok(candidateZip, "No candidate ZIP for runner architecture");
	for (const path of artifacts) {
		const results = finalContainerChecks(path, { run: spawnRunner, checkApp: (app) => [...runChecks({ appPath: app, dmgPath: null, run: spawnRunner }), bundledPythonCheck(app), bundledBytecodeCheck(app), privatePythonSeedCheck(app)] });
		assert.ok(results.every((row) => row.passed), JSON.stringify(results));
	}
	record("Delivered candidate ZIP/DMG", "PASS", "Every architecture verified after extraction/copy-out; exact metadata hashes and sizes match");
	const release = await (await fetch(`https://api.github.com/repos/damianvtran/local-operator-ui/releases/tags/${tag}`)).json();
	const releaseMetadata = release.assets?.find((asset) => asset.name === "latest-mac.yml");
	if (!releaseMetadata) blocked("The exact incumbent release has no published macOS metadata");
	const metadataPath = join(scratch, "incumbent.yml"); await download(releaseMetadata.browser_download_url, metadataPath);
	const oldMetadata = load(readFileSync(metadataPath, "utf8"));
	const oldEntry = oldMetadata.files.find((file) => file.url.endsWith(`-${process.arch}.zip`));
	const oldAsset = release.assets.find((asset) => asset.name === oldEntry?.url);
	if (!oldAsset) blocked("The exact incumbent release has no native-architecture ZIP");
	const oldZip = join(scratch, "incumbent.zip"); await download(oldAsset.browser_download_url, oldZip);
	const oldBytes = readFileSync(oldZip);
	assert.equal(createHash("sha512").update(oldBytes).digest("base64"), oldEntry.sha512); assert.equal(oldBytes.length, oldEntry.size);
	const install = join(scratch, "install"); mkdirSync(install);
	await command("/usr/bin/ditto", ["-x", "-k", oldZip, install]);
	const app = join(install, "Local Operator.app");
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	await command("/usr/sbin/spctl", ["-a", "-t", "exec", "-vvv", app]);
	const executable = join(app, "Contents", "MacOS", "Local Operator");
	const legacyPython = join(app, "Contents", "Resources", process.arch === "arm64" ? "python_aarch64" : "python", "bin", "python3");
	const legacy = join(support, "local-operator-venv");
	await execute(legacyPython, ["-B", "-m", "venv", "--without-pip", legacy], { env: safeEnv({ PYTHONDONTWRITEBYTECODE: "1", PYTHONPYCACHEPREFIX: join(scratch, "old-bytecode") }), timeout: 60_000 });
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	record("Incumbent identity", "PASS", `${tag}: published ZIP hash verified; original Developer ID signature unchanged after synthetic legacy venv setup`);
	const trigger = join(scratch, "after-swap");
	const pendingScript = `import os,sys,time\nwhile not os.path.exists(${JSON.stringify(trigger)}): time.sleep(.1)\nsys.dont_write_bytecode=False\nimport webbrowser\n`;
	const oldConsumer = startOwned(join(legacy, "bin", "python"), ["-B", "-c", pendingScript], "old-consumer-across-swap");
	const port = 19473;
	const incumbent = startOwned(executable, [`--inspect=127.0.0.1:${port}`], "incumbent", safeEnv({ VITE_DISABLE_BACKEND_MANAGER: "true", LOCAL_OPERATOR_UI_WINDOW_MODE: "headless" }));
	inspector = await inspectorAt(port);
	let capability;
	try { capability = await inspector.evaluate(`(()=>{const r=process.mainModule.require.bind(process.mainModule); const u=r('electron-updater').autoUpdater; globalThis.__signedUpdateProbe={updater:u,state:'idle'}; return {version:r('electron').app.getVersion(), supported:'autoRunAppAfterInstall' in u, packaged:r('electron').app.isPackaged};})()`); }
	catch { blocked("The exact incumbent main process does not expose its existing electron-updater singleton through standard Node inspection"); }
	if (!capability.packaged || !capability.supported) blocked("Incumbent does not support autoRunAppAfterInstall=false; swap-before-relaunch cannot be observed without altering the app");
	assert.equal(capability.version, tag.slice(1));
	feed = createServer((request, response) => {
		const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1));
		if (basename(name) !== name || !existsSync(join(candidateDir, name))) { response.writeHead(404).end(); return; }
		response.writeHead(200).end(readFileSync(join(candidateDir, name)));
	});
	await new Promise((done) => feed.listen(0, "127.0.0.1", done));
	const feedUrl = `http://127.0.0.1:${feed.address().port}`;
	await inspector.evaluate(`(()=>{const p=globalThis.__signedUpdateProbe,u=p.updater;u.autoDownload=false;u.autoInstallOnAppQuit=false;u.autoRunAppAfterInstall=false;u.setFeedURL({provider:'generic',url:${JSON.stringify(feedUrl)}});u.on('error',e=>{p.state='error';p.error=String(e)});u.on('update-downloaded',()=>p.state='downloaded');u.checkForUpdates().then(()=>u.downloadUpdate()).catch(e=>{p.state='error';p.error=String(e)});return true})()`);
	await until(async () => { const state = await inspector.evaluate(`({state:globalThis.__signedUpdateProbe.state,error:globalThis.__signedUpdateProbe.error})`); if (state.state === "error") throw new Error(state.error); return state.state === "downloaded"; }, 180_000);
	const candidateMetadata = load(readFileSync(join(candidateDir, "latest-mac.yml"), "utf8"));
	assert.notEqual(candidateMetadata.version, capability.version);
	await inspector.evaluate(`setTimeout(()=>globalThis.__signedUpdateProbe.updater.quitAndInstall(false,false),100);true`);
	inspector.close(); inspector = null;
	await until(async () => { try { return (await execute("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents", "Info.plist")])).stdout.trim() === candidateMetadata.version; } catch { return false; } }, 240_000);
	assert.notEqual(incumbent.exitCode, null, "Incumbent must have quit during replacement");
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	assert.equal(privatePythonSeedCheck(app).passed, true);
	writeFileSync(trigger, "go");
	await until(() => oldConsumer.exitCode !== null);
	assert.notEqual(oldConsumer.exitCode, 0, "A stale process must not import through legacy bundle paths");
	for (const flag of ["-E", "-I"]) {
		try { await execute(join(legacy, "bin", "python"), [flag, "-c", "import webbrowser"], { env: safeEnv(), timeout: 10_000 }); throw new Error("Legacy interpreter unexpectedly survived the namespace swap"); }
		catch (error) { if (error.code !== "ENOENT" && !(typeof error.code === "number" && error.code !== 0)) throw error; }
	}
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	record("Swap before candidate launch", "PASS", "Incumbent updater installed exact candidate; stale running/new -E/-I consumers fail closed; candidate remains signed");
	const candidate = startOwned(executable, [`--inspect=127.0.0.1:${port}`], "candidate", safeEnv({ LOCAL_OPERATOR_UI_WINDOW_MODE: "headless" }));
	inspector = await inspectorAt(port);
	await until(async () => { const path = join(support, "managed-python", "packaged", "selected-environment.json"); return existsSync(path) && JSON.parse(readFileSync(path, "utf8")); }, 600_000);
	await until(async () => { try { return (await fetch("http://127.0.0.1:1111/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; } }, 120_000);
	assert.equal(createHash("sha256").update(readFileSync(sentinel)).digest("hex"), dataHash);
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	await inspector.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),100);true"); inspector.close(); inspector = null;
	await until(() => candidate.exitCode !== null);
	const second = startOwned(executable, [`--inspect=127.0.0.1:${port}`], "second-launch", safeEnv({ LOCAL_OPERATOR_UI_WINDOW_MODE: "headless" }));
	inspector = await inspectorAt(port);
	assert.equal(await inspector.evaluate("process.mainModule.require('electron').app.getVersion()"), candidateMetadata.version);
	await until(async () => { try { return (await fetch("http://127.0.0.1:1111/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; } }, 120_000);
	assert.equal(createHash("sha256").update(readFileSync(sentinel)).digest("hex"), dataHash);
	await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	await inspector.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),100);true"); inspector.close(); inspector = null;
	await until(() => second.exitCode !== null);
	record("Candidate first and second launch", "PASS", "Real backend healthy, selected external runtime reused, synthetic data unchanged, signatures valid");
	const shipIt = join(homedir(), "Library", "Caches", "com.local-operator.ShipIt");
	if (existsSync(shipIt)) for (const name of readdirSync(shipIt).filter((name) => name.endsWith(".log"))) writeFileSync(join(evidence, name), readFileSync(join(shipIt, name)));
} catch (error) {
	if (!error.blocked) record("Exact signed update", "FAIL", error.stack ?? String(error));
	process.exitCode = error.blocked ? 2 : 1;
} finally {
	inspector?.close(); feed?.close();
	// Only children created by this test, on its disposable VM. Never ps/pkill,
	// launchd sweeps, foreign-service cleanup or deletion of user directories.
	for (const child of owned) if (child.exitCode === null) child.kill("SIGTERM");
}
