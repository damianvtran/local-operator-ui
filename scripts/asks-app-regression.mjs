/* Permanent assembled-app evidence producer, run by the EXISTING macOS NPX job.
 * Local source tests never invoke main(). Both cases use stock Electron/main,
 * preload, renderer, HTTP transport, ChatLayout handlers and real store writers.
 * Only the backend's synthetic HTTP data is a fixture; no injected UI/bridge.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ASK_SESSION_IDS, startAsksAppFixture } from "./asks-app-fixture.mjs";
import { isEntryPoint } from "./entry-point.mjs";
const execute = promisify(execFile);
export const ASKS_CONTROL = "2461cfa3f3beaa1124727a9de93dfe01c4381b0d";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function expectedRailClose(kind) {
	assert(["control", "candidate"].includes(kind));
	return kind === "control";
}
function files(root) {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		return readdirSync(root, { withFileTypes: true })
			.find((x) => x.name === name)
			.isDirectory()
			? files(path)
			: [path];
	});
}
async function prepareControl(root, output) {
	// Real historical source, not a callback mutation. Main/preload/config can be
	// reused only when the source identities agree. Missing source stops dispatch.
	for (const part of [
		"src/main",
		"src/preload",
		"electron.vite.config.js",
		"pnpm-lock.yaml",
	])
		assert.equal(
			git("rev-parse", `${ASKS_CONTROL}:${part}`),
			git("rev-parse", `HEAD:${part}`),
			`control reuse mismatch ${part}`,
		);
	const tar = join(output, "control-source.tar");
	execFileSync("git", [
		"archive",
		"--format=tar",
		`--output=${tar}`,
		ASKS_CONTROL,
		"src",
		"scripts",
		"resources",
		"build",
		"i18n",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"electron.vite.config.js",
		"tsconfig.node.json",
		"tsconfig.app.json",
		"tsconfig.web.json",
		"tsconfig.json",
	]);
	mkdirSync(root);
	execFileSync("tar", ["-xf", tar, "-C", root]);
	symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
	for (const part of ["main", "preload"])
		cpSync(join("out", part), join(root, "out", part), { recursive: true });
	const code =
		"import {resolveConfig} from 'electron-vite';import {build} from 'vite';const c=await resolveConfig({},'build','production');await build(c.config.renderer);";
	await execute(process.execPath, ["--input-type=module", "-e", code], {
		cwd: root,
		env: { ...process.env, LOCAL_OPERATOR_UI_NO_BYTECODE: "true" },
		timeout: 120000,
		maxBuffer: 4 * 1024 * 1024,
	});
	return {
		commit: ASKS_CONTROL,
		srcTree: git("rev-parse", `${ASKS_CONTROL}:src`),
		mainPreloadReuse: "byte-identical source/config/lock",
		rendererOutputs: Object.fromEntries(
			files(join(root, "out/renderer")).map((p) => [
				p.slice(root.length + 1),
				sha(readFileSync(p)),
			]),
		),
	};
}
/**
 * Wait for the renderer to be READY for a verb: painted, with the dev-driver
 * bridge answering, on whichever driver tree this run imported.
 *
 * The candidate tree exports both waits and they are preferred; the pinned
 * historical control tree carries the same two functions INTERNALLY without
 * exporting them (verified at 2461cfa3: `waitForPage` at 1761, `waitForBridge`
 * at 1777, neither on the facade), so there the equivalent polls are repeated.
 * What the scene needs - a mounted page whose `__loDevDriver` answers `verbs()`
 * with `hello` - is the same requirement on both trees.
 */
async function waitForSceneReady(cdp, api, timeoutMs = 90_000) {
	if (
		typeof api?.waitForPage === "function" &&
		typeof api?.waitForBridge === "function"
	) {
		await api.waitForPage(cdp);
		await api.waitForBridge(cdp);
		return;
	}
	const started = Date.now();
	for (;;) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount), verbs: typeof window.__loDevDriver?.verbs === 'function' ? window.__loDevDriver.verbs() : null })",
			)
			.catch(() => null);
		if (
			state?.ready === "complete" &&
			state.mounted &&
			Array.isArray(state.verbs) &&
			state.verbs.includes("hello")
		)
			return;
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the renderer never registered the dev driver verbs (last: ${JSON.stringify(state)})`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

/**
 * Wait for the app's own debugging port to ANSWER, whatever driver tree this run
 * imported.
 *
 * The candidate tree exports `waitForDevtools` on `rendererDriverApi` and is
 * preferred when present, so the shared implementation stays the one caller
 * contract. The control leg imports a pinned historical driver whose facade does
 * not carry it; there the equivalent bounded poll is repeated, because the
 * requirement is about the PORT being ready and not about which revision of the
 * driver is on disk.
 */
async function waitForDevtoolsPort(handle, api, timeoutMs = 60_000) {
	if (typeof api?.waitForDevtools === "function") {
		await api.waitForDevtools(handle, timeoutMs);
		return;
	}
	const started = Date.now();
	for (;;) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${handle.port}/json/version`,
			);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

async function runCase(kind, root, output, records) {
	process.chdir(root);
	process.argv.push(
		"--backend",
		"http://127.0.0.1:8080",
		"--backend-records",
		records,
		"--out",
		output,
	);
	const { rendererDriverApi: api } = await import(
		pathToFileURL(join(root, "scripts/renderer-driver.mjs"))
	);
	let cdp;
	let rc = 1;
	const frames = [];
	const failures = [];
	for (const name of ["SIGTERM", "SIGINT"])
		process.once(
			name,
			() => void api.reapLiveBoots({ code: 143, why: `CI ${name}` }),
		);
	const save = () =>
		writeFileSync(
			join(output, "measurements.json"),
			JSON.stringify({ kind, frames, failures }, null, 2),
		);
	async function wait(expression) {
		for (let i = 0; i < 150; i++) {
			if (await cdp.evaluate(expression)) return;
			await pause(100);
		}
		throw Error(`Unsettled real UI: ${expression}`);
	}
	async function press(selector) {
		await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		const point = await cdp.evaluate(
			`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('unpainted pointer target');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
		);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
				...point,
			});
	}
	async function pressEscape() {
		for (const type of ["keyDown", "keyUp"])
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
	}
	async function facts() {
		return {
			state: await api.verb(cdp, "state"),
			dom: await cdp.evaluate(
				`({ask:!!document.querySelector('[data-ask-drawer]'),focus:document.activeElement?.outerHTML.slice(0,400),focusedConnected:!!document.activeElement?.isConnected,panes:[...document.querySelectorAll('[data-ask-drawer],[data-tour-tag="browser-pane"]')].map(e=>({ask:e.hasAttribute('data-ask-drawer'),rect:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),text:document.body.innerText.slice(-1800)})`,
			),
		};
	}
	async function frame(label) {
		const first = await api.capture(cdp, `${kind}-${label}-first`, {
			assertPalette: false,
		});
		const firstFacts = await facts();
		await pause(180);
		const settled = await api.capture(cdp, `${kind}-${label}-settled`, {
			assertPalette: false,
		});
		const measured = await facts();
		for (const pane of measured.dom.panes)
			assert(
				pane.scrollWidth <= pane.clientWidth + 1,
				`${label} horizontal overflow`,
			);
		frames.push({ label, first, settled, firstFacts, ...measured });
		save();
		return measured;
	}
	async function fixtureMode(mode) {
		const response = await fetch("http://127.0.0.1:8080/__fixture/state", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ mode }),
		});
		assert.equal(response.status, 200);
	}
	async function session(index) {
		await wait(
			'document.querySelectorAll("[data-tour-tag=chat-session-row]").length===2',
		);
		await cdp.evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-tour-tag="chat-session-row"]')].find(e=>e.textContent.includes('Synthetic CI session ${index + 1}'));if(!e)throw Error('seeded session row missing');e.setAttribute('data-ci-session','${index}')})()`,
		);
		await press(`[data-ci-session="${index}"]`);
		await wait(
			`window.__loDevDriver.call('state').then(x=>x.activeSessionId===${JSON.stringify(ASK_SESSION_IDS[index])})`,
		);
	}
	async function browser() {
		if ((await facts()).dom.ask) await pressEscape();
		if (!(await facts()).state.browserPaneOpen)
			await press('[data-panel-rail-item="browser"]');
		assert.equal((await facts()).state.browserPaneOpen, true);
	}
	async function asks() {
		await press('[data-panel-rail-item="ask"]');
		await wait('!!document.querySelector("[data-ask-drawer]")');
	}
	async function closed(label, expected) {
		await wait('!document.querySelector("[data-ask-drawer]")');
		const x = await frame(label);
		assert.equal(
			x.state.browserPaneOpen,
			expected,
			`${kind} ${label} wrong restore policy`,
		);
		assert.equal(x.dom.focusedConnected, true);
		return x;
	}
	try {
		api.prepareDriverContext({ apiUrl: "http://127.0.0.1:8080" });
		const app = await api.launchApp({
			armed: true,
			apiUrl: "http://127.0.0.1:8080",
			tag: `asks-ci-${kind}`,
		});
		writeFileSync(
			join(output, "owned-app.json"),
			JSON.stringify({ pid: app.pid, inspector: app.inspectPort }),
		);
		/*
		 * The debugging endpoint answers `/json/version` before the app has a
		 * window, and `CdpClient.attach` then waits for the page TARGET - so the
		 * endpoint wait comes first, as it does at every other caller in the shared
		 * driver. Attaching straight after `launchApp` is the defect CI caught: the
		 * port was not listening yet, `fetch` REJECTED, and the rejection escaped
		 * the attach loop as a bare `TypeError: fetch failed`.
		 *
		 * WHY THIS IS NOT JUST `api.waitForDevtools`. This case runs against TWO
		 * driver trees: the candidate one from the checkout, and - in the control
		 * leg - the PINNED HISTORICAL tree unpacked from `control-source.tar`,
		 * which is imported from `root/scripts/renderer-driver.mjs` below. That
		 * historical facade exports six keys and no wait (2461cfa3), so calling
		 * the newer surface directly would make the control leg throw for a reason
		 * unrelated to the app. The wait is therefore resolved through the api when
		 * the tree offers it and otherwise repeated here, and what the control leg
		 * needs - a port that is listening before anybody attaches - holds either
		 * way. Same bounded poll, same 60s ceiling, same message.
		 */
		await waitForDevtoolsPort(app, api);
		cdp = await api.CdpClient.attach(app.port, "out/renderer/index.html");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source:
				'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));',
		});
		await cdp.send("Page.reload", { ignoreCache: false });
		/*
		 * The page paint and the bridge registration, in the order every scene in
		 * the shared driver uses them. Waiting on `Boolean(window.__loDevDriver)`
		 * instead - which is what this did - is satisfied the moment the object
		 * EXISTS, before it has registered a single verb, and the first
		 * `api.verb(cdp, "navigate", …)` then failed with "no dev driver verb
		 * navigate (have: none yet)". Both waits go through the same api-else-poll
		 * resolution as the port wait above, because the control leg imports the
		 * pinned historical facade, which does not export them either.
		 */
		await waitForSceneReady(cdp, api);
		const windowFacts = await cdp.evaluate("window.__loDevDriver.facts()");
		assert.equal(windowFacts.visible, false);
		assert.equal(windowFacts.focused, false);
		await api.verb(cdp, "navigate", "/chat");
		/*
		 * The conversation is opened by PRESSING THE ROW, not by a disclosure press
		 * first. `[data-tour-tag="chat-all-chats"]` was pressed here unguarded and
		 * that selector has NO home in `src/` at either this head or the pinned
		 * control one (the shared driver's own comment at its `--backend` scene says
		 * so, and `git grep` over `src` in both trees finds nothing), so the press
		 * waited fifteen seconds for an element the app never draws and the whole
		 * case died with `Unsettled real UI: Boolean(document.querySelector(
		 * "[data-tour-tag=\"chat-all-chats\"]"))` - measured on run 38846903646.
		 *
		 * `session()` below is the shape the driver's own scenes use instead: wait
		 * for the seeded row, mark it, press that. The rail this scene is about is
		 * on every route and needs no conversation at all.
		 */
		await session(0);
		await frame("session-loading");
		await fixtureMode("populated");
		await wait('Boolean(document.querySelector("[data-panel-rail-item=ask]"))');
		if ((await facts()).dom.ask) await pressEscape();
		await browser();
		await frame("before-browser");
		await asks();
		await frame("populated-asks");
		await press('[data-panel-rail-item="ask"]');
		await closed("rail-close", expectedRailClose(kind));
		await session(1);
		await session(0);
		assert.equal(
			(await facts()).state.browserPaneOpen,
			expectedRailClose(kind),
		);
		await frame("session-a-b-a");
		if (kind === "candidate") {
			await browser();
			await asks();
			await press('[data-tour-tag="close-asks-button"]');
			await closed("x-close", false);
			await browser();
			await asks();
			await pressEscape();
			await closed("escape-give-back", true);
			await asks();
			await cdp.evaluate(
				`(()=>{const h=document.querySelector('[data-tour-tag="chat-header"]');const e=[...h.querySelectorAll('button')].find(e=>e.getAttribute('aria-haspopup')==='menu');if(!e)throw Error('real header menu unavailable');e.setAttribute('data-ci-menu','')})()`,
			);
			await press("[data-ci-menu]");
			await cdp.evaluate(
				`(()=>{const e=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Close asks');if(!e)throw Error('real Close asks menu item absent');e.setAttribute('data-ci-close-asks','')})()`,
			);
			await frame("header-menu");
			await press("[data-ci-close-asks]");
			await closed("menu-close", false);
			await browser();
			await asks();
			await press('[data-status-asks][aria-expanded="true"]');
			await closed("chip-close", false);
			await session(1);
			await frame("empty-session-queue");
			await session(0);
			await fixtureMode("error");
			await wait(
				"/reconnect|connection|retry|unavailable|could not/i.test(document.body.innerText)",
			);
			await frame("connection-error");
		}
		frames.push({
			label: "acceptance",
			verdict: "PASS",
			coverage:
				"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		});
		save();
		rc = 0;
	} catch (error) {
		failures.push(error.stack);
		save();
	} finally {
		cdp?.close();
		await api.reapLiveBoots({
			code: rc,
			why: "CI asks real-app case complete",
		});
	}
}
async function main() {
	if (process.argv.includes("--case")) {
		const i = process.argv.indexOf("--case");
		const kind = process.argv[i + 1];
		const needed = ["ASKS_APP_ROOT", "ASKS_OUTPUT", "ASKS_RECORDS"];
		const missing = needed.filter((name) => !process.env[name]);
		if (!["control", "candidate"].includes(kind) || missing.length > 0) {
			console.error(
				`asks-app-regression: --case needs control|candidate and ${needed.join(", ")} (missing ${missing.join(", ") || "none"})`,
			);
			process.exitCode = 1;
			return;
		}
		return runCase(
			kind,
			process.env.ASKS_APP_ROOT,
			process.env.ASKS_OUTPUT,
			process.env.ASKS_RECORDS,
		);
	}
	assert.equal(
		process.platform,
		"darwin",
		"Existing macOS NPX leg owns native execution; no Linux sandbox waiver",
	);
	assert(
		process.env.CI,
		"Native regression producer runs in normal CI only; source unit tests import exports",
	);
	const output = resolve("artifacts/asks-app");
	mkdirSync(output, { recursive: true });
	const scratch = join(tmpdir(), `asks-app-ci-${process.pid}`);
	mkdirSync(scratch);
	const token = randomBytes(24).toString("hex");
	const fixture = await startAsksAppFixture({ root: scratch, token });
	for (const entry of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		assert(existsSync(entry), `Production build missing ${entry}`);
	const manifest = {
		format: 1,
		requestedHead: process.env.QA_REQUESTED_HEAD,
		checkout: git("rev-parse", "HEAD"),
		sourceTree: git("rev-parse", "HEAD:src"),
		scriptsTree: git("rev-parse", "HEAD:scripts"),
		productionOutputs: Object.fromEntries(
			files(resolve("out")).map((p) => [
				p.slice(resolve("out").length + 1),
				sha(readFileSync(p)),
			]),
		),
		control: ASKS_CONTROL,
		captures: [],
		physical1106:
			"NOT COVERED: capturePage excludes sibling native WebContentsView/compositor",
		fixture: "owned loopback HTTP; no bridge or UI replacements",
	};
	let primaryError = null;
	try {
		manifest.controlIdentity = await prepareControl(
			join(scratch, "control-app"),
			output,
		);
		const controlArchive = join(output, "control-source.tar");
		manifest.controlSourceArchive = {
			path: "control-source.tar",
			sha256: sha(readFileSync(controlArchive)),
		};
		for (const kind of ["control", "candidate"]) {
			fixture.setMode("loading");
			const root =
				kind === "control" ? join(scratch, "control-app") : process.cwd();
			const dir = join(output, kind);
			mkdirSync(dir);
			await execute(
				process.execPath,
				[fileURLToPath(import.meta.url), "--case", kind],
				{
					cwd: root,
					env: {
						...process.env,
						LOCAL_OPERATOR_DESKTOP_TOKEN: token,
						LOCAL_OPERATOR_CONFIG_DIR: scratch,
						LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
						LOCAL_OPERATOR_UI_TELEMETRY: "off",
						ASKS_APP_ROOT: root,
						ASKS_OUTPUT: dir,
						ASKS_RECORDS: fixture.records,
					},
					timeout: 150000,
					maxBuffer: 4 * 1024 * 1024,
				},
			);
			const measured = JSON.parse(
				readFileSync(join(dir, "measurements.json"), "utf8"),
			);
			assert(measured.frames.some((x) => x.verdict === "PASS"));
			manifest.captures.push({
				kind,
				files: files(dir).map((p) => ({
					path: p.slice(output.length + 1),
					sha256: sha(readFileSync(p)),
				})),
			});
		}
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		manifest.requests = fixture.requests;
		writeFileSync(
			join(output, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);
		/*
		 * THE CLOSE COMES BEFORE THE TRAFFIC ASSERTIONS, and that ordering is the
		 * fix for a measured hang rather than a tidiness preference. The assertions
		 * used to sit ahead of it, so the first one that threw skipped
		 * `fixture.close()` entirely: the fixture's HTTP listener stayed open, the
		 * child producer was left holding it, and the CI step ran on with nothing
		 * to do until GitHub killed it at its own 8-minute ceiling (measured on run
		 * 38844071896: the assertion failed at 03:30:46, the step was killed at
		 * 03:37:55, and `node` was then reaped as an orphan). A failed assertion is
		 * a verdict; a leaked listener is an outage that hides it.
		 *
		 * The assertions also do not run over a run that ALREADY failed: a second
		 * message about traffic says nothing the first failure did not, and burying
		 * a real failure under a derived one is the pattern this suite exists to
		 * remove.
		 */
		await fixture.close();
		if (primaryError === null) assertTrafficAllowed(fixture.requests);
	}
}

/**
 * Every request this run made of the fixture, against what the fixture is
 * allowed to have served.
 *
 * Reads only, plus the two modelled POSTs: `/watch`, the push subscription the
 * fixture answers, and `/__fixture/state`, its own control door. The Radient
 * proxy (`POST /v1/desktop/radient`) is a POST the app legitimately makes for its
 * quota notice and the fixture answers for the READ operations only, so it is
 * admitted here as a read door - the forbidden-write pattern below is what keeps
 * the turn and answer routes shut, and it is checked first.
 */
function assertTrafficAllowed(requests) {
	const forbidden =
		/\/(send|answer|answers|interrupt|steer|messages|turns)(\/|$|\?)/;
	for (const request of requests) {
		assert(
			!forbidden.test(request.path),
			`fixture traffic reached a forbidden write: ${request.method} ${request.path}`,
		);
		const allowedPost = [
			"/watch",
			"/__fixture/state",
			"/v1/desktop/radient",
		].some((suffix) => request.path.endsWith(suffix));
		assert(
			request.method === "GET" || allowedPost,
			`fixture traffic used an unmodelled method: ${request.method} ${request.path}`,
		);
		const openRead =
			request.path === "/health" || request.path === "/v1/capabilities";
		assert(
			request.authenticated || openRead,
			`fixture traffic was unauthenticated outside the open reads: ${request.path}`,
		);
	}
}
if (isEntryPoint(import.meta.url))
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
