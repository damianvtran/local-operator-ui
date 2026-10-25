/**
 * The notifications lane's POSITIVE foreground proof, and the negative beside it.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE ONLY SHOWN-WINDOW RUN IN THE REPOSITORY.
 * `notifications.read` claims a human saw an item, so main refuses it unless the
 * REAL window is visible, unminimised and focused (`guardForegroundReceipts`).
 * Every other scene launches headless — correctly, because a test must never
 * take the operator's focus — and a headless window therefore proves only the
 * NEGATIVE half. This scene is the positive half: a genuinely shown window on a
 * CI runner's own desktop, a trusted input on a real row, main's real guard
 * letting it through, and the pinned backend's SQLite showing exactly the
 * tested revision read and nothing else.
 *
 * WHAT IT REFUSES. Not a developer machine, not a self-hosted runner, not a
 * Linux/`Xvfb` arrangement: `resolvedWindowMode` refuses anything but the
 * notifications scene on an ephemeral GitHub-hosted macOS runner, and this
 * script refuses again on its own so a direct `node` invocation cannot skip it.
 * A runner with no interactive desktop FAILS here rather than falling back to
 * headless, because a headless "success" would be a false positive.
 *
 * WHAT IT DOES NOT DO. It does not stub `isFocused`/`isVisible`, does not
 * bypass `createForegroundReceiptRequester`, does not use DOM focus as native
 * proof and does not touch a production store: HOME and the config dir are
 * throwaway, the bearer token is synthetic, and the items are seeded through the
 * pinned core's own store API.
 *
 * Inputs (all required):
 *   LOCAL_OPERATOR_CORE_BIN      the pinned core's `local-operator` executable
 *   LOCAL_OPERATOR_CORE_PYTHON   that install's python, used only to seed/read SQLite
 *   LOCAL_OPERATOR_CORE_REF      the core SHA being exercised, recorded in the receipt
 * Output: artifacts/notifications-native/ (frames, window facts, HTTP + DB readback).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

const OUT = resolve("artifacts/notifications-native");
const SESSION = "aaaaaaaaaaa1";
const OTHER_SESSION = "bbbbbbbbbbb2";
const TARGET = "n_targetitemaaaaaa";
const UNRELATED = "n_unrelatedaaaaaaa";
const RACED = "n_raceditemaaaaaa";
const _ASK = `ask:${OTHER_SESSION}:a-7f3c`;

const refuseUnlessSanctioned = () => {
	const missing = [];
	if (process.env.LOCAL_OPERATOR_UI_NATIVE_SCENE !== "notifications")
		missing.push("LOCAL_OPERATOR_UI_NATIVE_SCENE=notifications");
	if (process.env.CI !== "true") missing.push("CI=true");
	if (process.env.GITHUB_ACTIONS !== "true")
		missing.push("GITHUB_ACTIONS=true");
	if (process.env.RUNNER_ENVIRONMENT !== "github-hosted")
		missing.push("RUNNER_ENVIRONMENT=github-hosted");
	if (process.platform !== "darwin") missing.push("macOS (darwin)");
	for (const name of [
		"LOCAL_OPERATOR_CORE_BIN",
		"LOCAL_OPERATOR_CORE_PYTHON",
		"LOCAL_OPERATOR_CORE_REF",
	])
		if (!process.env[name]) missing.push(name);
	return missing;
};

/*
 * The refusal sentence, one line on stderr with no stack: it is the scene's
 * CLI verdict (pinned through both spellings by `entry-point.test.mjs`), not a
 * crash, and a stack would name the spelling it was reached through.
 */
const refusal = (missing) =>
	`notifications native scene refused: this environment cannot honestly own a foreground desktop. Missing ${missing.join(", ")}. No headless fallback is taken: headless proves only the negative half.`;

const freePort = () =>
	new Promise((done, fail) => {
		const server = createServer();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
	});

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForHealth(base, deadlineMs = 120_000) {
	const started = Date.now();
	for (;;) {
		try {
			const answer = await fetch(`${base}/health`);
			if (answer.ok) return await answer.json();
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > deadlineMs)
			throw new Error(`the pinned core never answered /health at ${base}`);
		await pause(500);
	}
}

/**
 * Seed and read through the pinned core's own store, never through a fixture.
 *
 * The environment is `pythonChildEnv`'s, like every harness python here: it
 * drops every inherited `PYTHON*` (so no ambient `PYTHONPATH` can shadow the
 * pinned core, and no inherited `PYTHONPYCACHEPREFIX` can aim bytecode at an
 * installed app - the incident `python-bytecode-cache.test.mjs` exists for) and
 * gives the child a scratch cache with bytecode writes off. The config dir is
 * the scene's isolated one, stated last so nothing inherited can replace it.
 */
function coreStore(configDir, expression) {
	return execFileSync(
		process.env.LOCAL_OPERATOR_CORE_PYTHON,
		["-c", expression],
		{
			env: pythonChildEnv({
				extra: { LOCAL_OPERATOR_CONFIG_DIR: configDir },
			}),
			encoding: "utf8",
		},
	);
}

const seed = (configDir) =>
	coreStore(
		configDir,
		[
			"import json",
			"from local_operator.notifications.store import NotificationStore",
			`store = NotificationStore(${JSON.stringify(configDir)})`,
			`def put(key, title, body, priority="normal"):`,
			`    return store.notify(${JSON.stringify(SESSION)}, key=key, title=title, body_md=body, priority=priority)`,
			`target = put("daily", "Chargeback spike on 3 merchants", "Disputes up 4.1x.", "high")`,
			`unrelated = put("nightly", "Nightly build finished", "Two flaky tests.")`,
			`raced = put("watch", "Watching merchant m_4821", "Baseline recomputed.")`,
			"print(json.dumps({",
			`    "target": {"id": target.item_id, "revision": target.revision},`,
			`    "unrelated": {"id": unrelated.item_id, "revision": unrelated.revision},`,
			`    "raced": {"id": raced.item_id, "revision": raced.revision},`,
			"}))",
		].join("\n"),
	);

const revise = (configDir, itemId) =>
	coreStore(
		configDir,
		[
			"import json",
			"from local_operator.notifications.store import NotificationStore",
			`store = NotificationStore(${JSON.stringify(configDir)})`,
			`row = store.get(${JSON.stringify(itemId)})`,
			`out = store.notify(str(row["session_id"]), key=str(row["key"]), title="Watching merchant m_4821", body_md="A new revision the operator never saw.", priority="normal")`,
			"print(json.dumps({'id': out.item_id, 'revision': out.revision}))",
		].join("\n"),
	);

const readRow = (configDir, itemId) =>
	JSON.parse(
		coreStore(
			configDir,
			[
				"import json",
				"from local_operator.notifications.store import NotificationStore",
				`store = NotificationStore(${JSON.stringify(configDir)})`,
				`print(json.dumps(store.get(${JSON.stringify(itemId)}), default=str))`,
			].join("\n"),
		),
	);

const sha256 = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

/** MAIN's own window facts: the real BrowserWindow, never a DOM approximation. */
const mainFacts = (nodeCdp) =>
	nodeCdp.evaluate(
		'(() => { const electron = process.mainModule?.require("electron") ?? globalThis.require?.("electron"); if (!electron) return null; const window = electron.BrowserWindow.getAllWindows()[0]; if (!window) return null; return { visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), title: window.getTitle() }; })()',
	);

async function main() {
	const missing = refuseUnlessSanctioned();
	if (missing.length > 0) {
		console.error(refusal(missing));
		process.exitCode = 1;
		return;
	}
	/*
	 * THE DRIVER IS IMPORTED ONLY AFTER THE DOOR OPENS. `renderer-driver.mjs`
	 * resolves the Electron runtime from the working directory at import, so a
	 * static import made every refused run die on "cannot resolve the Electron
	 * runtime" first - the refusal, which is the property this scene's gate
	 * exists for, was unreachable anywhere Electron is not installed. The same
	 * late load `asks-app-regression.mjs` uses for the same driver.
	 */
	const { rendererDriverApi: api } = await import("./renderer-driver.mjs");
	mkdirSync(OUT, { recursive: true });

	const root = join(tmpdir(), `lo-notifications-scene-${process.pid}`);
	const home = join(root, "home");
	const config = join(home, ".local-operator");
	mkdirSync(config, { recursive: true });
	const token = randomBytes(24).toString("base64url");
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;

	const backend = spawn(
		process.env.LOCAL_OPERATOR_CORE_BIN,
		["serve", "--host", "127.0.0.1", "--port", String(port)],
		{
			/*
			 * `local-operator` is the pinned core's python entry script, so it gets
			 * the same `pythonChildEnv` as `coreStore` above, and its row in
			 * `python-bytecode-cache.test.mjs` pins that.
			 */
			env: pythonChildEnv({
				extra: {
					HOME: home,
					LOCAL_OPERATOR_CONFIG_DIR: config,
					LOCAL_OPERATOR_DESKTOP_TOKEN: token,
					LOCAL_OPERATOR_UI_TELEMETRY: "off",
				},
			}),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const backendLog = [];
	backend.stdout.on("data", (chunk) => backendLog.push(chunk.toString()));
	backend.stderr.on("data", (chunk) => backendLog.push(chunk.toString()));

	let cdp = null;
	let nodeCdp = null;
	const receipt = {
		coreRef: process.env.LOCAL_OPERATOR_CORE_REF,
		scene: "notifications",
		backend: base,
		startedAt: new Date().toISOString(),
	};
	try {
		const health = await waitForHealth(base);
		receipt.backendHealth = health;

		const seeded = JSON.parse(seed(config));
		assert.equal(seeded.target.id, TARGET);
		assert.equal(seeded.unrelated.id, UNRELATED);
		assert.equal(seeded.raced.id, RACED);
		receipt.seeded = seeded;

		// The bearer is synthetic, so an unauthenticated read must be refused before
		// anything is proved about the UI's own route.
		const unauth = await fetch(`${base}/v1/desktop/notifications`);
		receipt.unauthenticated = { status: unauth.status };
		assert.equal(
			unauth.status,
			401,
			"the seeded backend must demand its bearer",
		);

		process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = token;
		const _context = api.prepareDriverContext({ apiUrl: base });
		const handle = await api.launchApp({
			armed: true,
			apiUrl: base,
			tag: "notifications-native",
			logName: "notifications-native.log",
			windowMode: "normal",
		});
		receipt.pid = handle.pid;
		receipt.compiled = {
			main: sha256(join(process.cwd(), "out/main/index.js")),
			preload: sha256(join(process.cwd(), "out/preload/index.js")),
			rendererAssets: readdirSync(join(process.cwd(), "out/renderer/assets"))
				.filter((name) => name.endsWith(".js"))
				.sort(),
		};
		await api.waitForDevtools(handle);
		cdp = await api.CdpClient.attach(handle.port, "out/renderer/index.html");
		nodeCdp = await api.CdpClient.attachNode(handle.inspectPort);
		await api.waitForPage(cdp);
		await api.waitForBridge(cdp);

		// Onboarding is skipped through its OWN control, never a CLI seed flag.
		await cdp.evaluate(`(() => {
			const skip = [...document.querySelectorAll('button,a')].find((element) => /skip for now/i.test(element.textContent || ""));
			if (skip) skip.click();
			return Boolean(skip);
		})()`);
		await api.verb(cdp, "navigate", "/notifications");

		const deadline = Date.now() + 60_000;
		let rendered = null;
		do {
			rendered = await cdp.evaluate(
				`({rows:[...document.querySelectorAll('[data-notification-row]')].map((element) => ({id: element.dataset.notificationRow, text: (element.textContent || "").slice(0, 90)})), onboarding: Boolean(document.querySelector('[data-onboarding-modal]'))})`,
			);
			if (rendered.rows.some((row) => row.id === TARGET)) break;
			await pause(250);
		} while (Date.now() < deadline);
		assert.ok(
			rendered.rows.some((row) => row.id === TARGET),
			`the seeded item never rendered: ${JSON.stringify(rendered)}`,
		);
		receipt.rendered = rendered;

		// The precondition this whole scene exists for: MAIN sees a shown, focused,
		// unminimised window. Anything else is BLOCKED, not a reason to continue.
		const before = await mainFacts(nodeCdp);
		receipt.windowBefore = before;
		assert.equal(before?.visible, true, "the runner owns no visible window");
		assert.equal(before?.minimized, false, "the window is minimised");
		assert.equal(before?.focused, true, "the window is not focused");
		await api.capture(cdp, "notifications-native-before");

		// A trusted pointer press on the real row: renderer -> preload -> main guard
		// -> the pinned backend's PATCH. Nothing here calls the bridge directly.
		const box = await cdp.evaluate(
			`(() => { const row = document.querySelector('[data-notification-row="${TARGET}"]'); if (!row) return null; const rect = row.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()`,
		);
		assert.ok(box, "the seeded row has no measurable box");
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: 1,
				x: box.x,
				y: box.y,
			});
		// The raced item is revised AFTER the render and BEFORE the read settles: it
		// must stay unread, because the operator never agreed to the new revision.
		receipt.revised = JSON.parse(revise(config, RACED));

		let target = null;
		const settleBy = Date.now() + 30_000;
		do {
			target = readRow(config, TARGET);
			if (target && String(target.read).toLowerCase() === "1") break;
			await pause(250);
		} while (Date.now() < settleBy);
		const unrelated = readRow(config, UNRELATED);
		const raced = readRow(config, RACED);
		receipt.database = { target, unrelated, raced };
		assert.equal(
			String(target.read).toLowerCase(),
			"1",
			"the trusted press did not mark the rendered revision read",
		);
		assert.equal(target.read_via, "explicit");
		assert.equal(
			Number(target.read_rev),
			seeded.target.revision,
			"a different revision was marked read than the one tested",
		);
		assert.equal(
			String(unrelated.read).toLowerCase(),
			"0",
			"unrelated row read",
		);
		assert.equal(
			Number(raced.revision),
			seeded.raced.revision + 1,
			"the raced revision did not land",
		);
		assert.equal(
			String(raced.read).toLowerCase(),
			"0",
			"the raced revision was read",
		);
		await api.capture(cdp, "notifications-native-after");

		// NEGATIVE: the same gesture on a window main can see is not foreground.
		await nodeCdp.evaluate(
			'(() => { const electron = process.mainModule?.require("electron") ?? globalThis.require?.("electron"); const window = electron.BrowserWindow.getAllWindows()[0]; window.blur(); return window.isFocused(); })()',
		);
		await pause(500);
		const hidden = await mainFacts(nodeCdp);
		receipt.windowBlurred = hidden;
		const negative = await cdp.evaluate(
			`(async () => { try { return { answer: await window.api.desktop.request({ op: "notifications.read", verb: "read", target: { items: [{ id: ${JSON.stringify(RACED)}, revision: ${seeded.raced.revision + 1} }] } }) }; } catch (error) { return { refused: true, message: String(error.message).slice(0, 200) }; } })()`,
		);
		receipt.foregroundNegative = negative;
		const racedAfter = readRow(config, RACED);
		receipt.racedAfterNegative = racedAfter;
		assert.equal(
			String(racedAfter.read).toLowerCase(),
			"0",
			"an unfocused window was allowed to mark a revision read",
		);

		receipt.result = "positive-foreground-read-confirmed";
		writeFileSync(
			join(OUT, "native-scene.json"),
			JSON.stringify(receipt, null, 2),
		);
		console.log(
			JSON.stringify({
				result: receipt.result,
				database: receipt.database,
				negative: receipt.foregroundNegative,
				window: receipt.windowBefore,
			}),
		);
	} catch (error) {
		receipt.result = "failed";
		receipt.error = String(error?.stack || error);
		receipt.backendLog = backendLog.join("").slice(-4_000);
		writeFileSync(
			join(OUT, "native-scene.json"),
			JSON.stringify(receipt, null, 2),
		);
		throw error;
	} finally {
		cdp?.close();
		nodeCdp?.close();
		await api.reapLiveBoots({
			code: 0,
			why: "bounded notifications native scene complete",
		});
		backend.kill("SIGTERM");
		await pause(1_000);
		if (!backend.killed) backend.kill("SIGKILL");
		writeFileSync(join(OUT, "core.log"), backendLog.join(""));
		assert.equal(
			existsSync(join(OUT, "native-scene.json")),
			true,
			"the scene wrote no receipt",
		);
	}
}

if (isEntryPoint(import.meta.url)) await main();
