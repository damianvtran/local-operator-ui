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
import { statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

const OUT = resolve("artifacts/notifications-native");
const SESSION = "aaaaaaaaaaa1";
const OTHER_SESSION = "bbbbbbbbbbb2";
/*
 * THE ITEM IDS ARE THE STORE'S, NOT THIS FILE'S.
 *
 * `NotificationStore.notify` mints its own `n_` + 16 base32 characters, so a
 * literal id here could never equal what the seed returns - the equality
 * assertions that used to hold these constants failed on every run, which is
 * why the scene has never reached its foreground read. They are assigned from
 * the seed's answer below, before any selector or request is built out of them,
 * and only their SHAPE is asserted here.
 */
let TARGET = "";
let UNRELATED = "";
let RACED = "";
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
const outfile = join(OUT, "native-scene.json");

/** Resolve when `child` has exited, or when `ms` runs out. */
const exited = (child, ms) =>
	new Promise((done) => {
		if (child.exitCode !== null || child.signalCode !== null) return done();
		const timer = setTimeout(done, ms);
		child.once("exit", () => {
			clearTimeout(timer);
			done();
		});
	});

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

/**
 * One frame from the app itself, through the browser's own screenshot path.
 *
 * The driver's `capture` verb is not available here (see the `armed: false` note),
 * and the raw protocol call is the same picture without the verb's palette
 * assertions - those belong to the story rigs, not to this proof.
 */
async function screenshot(cdp, label) {
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	const path = join(OUT, `${label}.png`);
	writeFileSync(path, Buffer.from(shot.data, "base64"));
	return { path, bytes: statSync(path).size };
}

/** Whether the element's centre is inside the viewport and not covered. */
const inViewAndUncovered = (selector) =>
	`(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) return { found: false };
		const rect = element.getBoundingClientRect();
		const cx = rect.x + rect.width / 2;
		const cy = rect.y + rect.height / 2;
		const inside = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
		const top = inside ? document.elementFromPoint(cx, cy) : null;
		return {
			found: true,
			x: Math.round(cx),
			y: Math.round(cy),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
			inside,
			uncovered: Boolean(top && (top === element || element.contains(top))),
		};
	})()`;

/**
 * Hover the row (which reveals its actions) and return the centre of its own
 * Mark read control, asserting the control is on screen and uncovered.
 */
async function hoverReadControl(cdp, id) {
	const row = await cdp.evaluate(
		inViewAndUncovered(`[data-notification-row="${id}"]`),
	);
	assert.ok(row?.found, "the seeded row is not in the document");
	assert.ok(
		row.inside,
		`the seeded row is off-viewport: ${JSON.stringify(row)}`,
	);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		button: "none",
		x: row.x,
		y: row.y,
	});
	await pause(250);
	const control = await cdp.evaluate(
		inViewAndUncovered(
			`[data-notification-row="${id}"] [data-row-action="read"]`,
		),
	);
	assert.ok(control?.found, "the row drew no Mark read control");
	assert.ok(
		control.inside,
		`the Mark read control is off-viewport: ${JSON.stringify(control)}`,
	);
	assert.ok(
		control.uncovered,
		`the Mark read control is covered: ${JSON.stringify(control)}`,
	);
	return { x: control.x, y: control.y, control: control.width };
}

/**
 * The same measurement for a row deliberately left off screen: this asserts the
 * aim MISSES (the point resolves to nothing the row owns) rather than skipping
 * the control it is aiming at, so the negative arm cannot pass by doing nothing.
 */
async function aimOffScreen(cdp, id) {
	await cdp.evaluate(
		`(() => {
			/* The nearest ancestor that actually scrolls: the reel is an inner
			   scroller, so setting the document's scrollTop moves nothing. */
			let node = document.querySelector('[data-notification-row="${id}"]');
			while (node && node !== document.body) {
				const overflow = getComputedStyle(node).overflowY;
				if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
					node.scrollTop = node.scrollHeight;
					return { scrolled: node.scrollTop > 0 };
				}
				node = node.parentElement;
			}
			document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
			return { scrolled: document.scrollingElement.scrollTop > 0 };
		})()`,
	);
	await pause(400);
	const aim = await cdp.evaluate(
		`(() => {
			const row = document.querySelector('[data-notification-row="${id}"]');
			if (!row) return { found: false };
			const rect = row.getBoundingClientRect();
			const inside = rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
			// Aim where the row would be if it were scrolled to: the point is inside
			// the window, so the input is really delivered, and it lands on whatever
			// is actually there.
			const x = Math.round(Math.min(innerWidth - 1, Math.max(1, rect.x + rect.width / 2)));
			const y = Math.round(Math.min(innerHeight - 40, Math.max(40, rect.y + rect.height / 2)));
			return { found: true, inside, x, y, rowTop: Math.round(rect.top), rowBottom: Math.round(rect.bottom) };
		})()`,
	);
	assert.ok(aim?.found, "the off-screen row is not in the document");
	assert.equal(
		aim.inside,
		false,
		`the row aimed at as off-screen is still on screen: ${JSON.stringify(aim)}`,
	);
	for (const [type, button] of [
		["mouseMoved", "none"],
		["mousePressed", "left"],
		["mouseReleased", "left"],
	]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			button,
			clickCount: type === "mouseMoved" ? 0 : 1,
			x: aim.x,
			y: aim.y,
		});
	}
	return aim;
}

/** The control the onboarding door offers, already on the page. */
const ONBOARDING_SKIP = "button[data-onboarding-skip], button";

/** What the shell looks like right now, from the renderer's own answers. */
const pageState = (cdp) =>
	cdp.evaluate(
		`({ hash: location.hash, onboarding: Boolean(document.querySelector("[data-onboarding-modal]")), rows: [...document.querySelectorAll("[data-notification-row]")].map((element) => element.dataset.notificationRow) })`,
	);

/** Poll `check` until it answers true, or the budget runs out. */
async function waitFor(check, ms, gap = 250) {
	const deadline = Date.now() + ms;
	for (;;) {
		if (await check()) return true;
		if (Date.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, gap));
	}
}

/**
 * Wait for a control to exist, then answer where to press it.
 *
 * The onboarding door is the first thing the app draws and its button carries no
 * stable hook of its own in every locale, so this matches its ACCESSIBLE TEXT -
 * the same words a person reads - and reports what it found so a failure says
 * which half was missing rather than "not found".
 */
async function waitForElement(cdp, ms, selector) {
	const deadline = Date.now() + ms;
	for (;;) {
		const found = await cdp.evaluate(
			`(() => {
				const skip = [...document.querySelectorAll(${JSON.stringify(selector)})]
					.find((element) => /skip for now/i.test(element.textContent || ""));
				if (!skip) return { found: false };
				const rect = skip.getBoundingClientRect();
				const x = Math.round(rect.x + rect.width / 2);
				const y = Math.round(rect.y + rect.height / 2);
				const inside = rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
				const top = inside ? document.elementFromPoint(x, y) : null;
				return { found: true, x, y, inside, uncovered: Boolean(top && (top === skip || skip.contains(top))) };
			})()`,
		);
		if (found?.found) return found;
		if (Date.now() > deadline) return { found: false };
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

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
		TARGET = seeded.target.id;
		UNRELATED = seeded.unrelated.id;
		RACED = seeded.raced.id;
		for (const [name, id] of Object.entries({ TARGET, UNRELATED, RACED }))
			assert.match(
				String(id),
				/^n_[a-z2-7]{16}$/,
				`${name} must be an item id the store minted`,
			);
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
		/*
		 * NOT ARMED. The renderer dev driver refuses to arm in a "normal" window
		 * (`resolveDevDriverArming`, dev-driver.ts:205-209), and this scene needs a
		 * SHOWN window more than it needs the driver: main's foreground guard reads
		 * the real BrowserWindow. So the whole instrument below is the page's CDP
		 * plus real dispatched input, and the receipt is read from the store - no
		 * verb, no bridge, no capture helper.
		 */
		const handle = await api.launchApp({
			armed: false,
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

		/*
		 * ONBOARDING IS DISMISSED THROUGH ITS OWN CONTROL, WITH REAL INPUT, and it
		 * is waited for: the first version clicked a `<button>` found by text the
		 * instant the page reported ready, before the modal had rendered, so the
		 * modal stayed up and the reel behind it never mounted ('
		 * the seeded item never rendered: {"rows":[],"onboarding":true}').
		 * A `Skip for now` that is genuinely on screen is pressed where it is, which
		 * is also the gesture a person makes.
		 */
		const skip = await waitForElement(cdp, 45_000, ONBOARDING_SKIP);
		receipt.onboarding = skip;
		if (skip.found) {
			assert.ok(
				skip.inside && skip.uncovered,
				`the onboarding control is not pressable: ${JSON.stringify(skip)}`,
			);
			for (const [type, button] of [
				["mouseMoved", "none"],
				["mousePressed", "left"],
				["mouseReleased", "left"],
			])
				await cdp.send("Input.dispatchMouseEvent", {
					type,
					button,
					clickCount: type === "mouseMoved" ? 0 : 1,
					x: skip.x,
					y: skip.y,
				});
			const cleared = await waitFor(
				() => pageState(cdp).then((state) => !state.onboarding),
				15_000,
			);
			assert.ok(
				cleared,
				"the onboarding modal did not close after its own button was pressed",
			);
		}
		/* The same line the removed `navigate` verb ran: the hash router's URL. */
		await cdp.evaluate(`(window.location.hash = "#/notifications")`);

		const deadline = Date.now() + 60_000;
		let rendered = null;
		do {
			rendered = await pageState(cdp);
			if (rendered.rows.includes(TARGET)) break;
			await pause(250);
		} while (Date.now() < deadline);
		assert.ok(
			rendered.rows.includes(TARGET),
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
		await screenshot(cdp, "notifications-native-before");

		/*
		 * THE READ GESTURE IS THE ROW'S OWN CONTROL, and it takes two real inputs
		 * because the control is hover-revealed: a pointer move over the row makes
		 * `[data-row-action="read"]` visible, then a press on its centre is the
		 * gesture the product treats as "the operator marked this read". Pressing
		 * the row BODY would open the detail and commit nothing - which is what the
		 * previous version of this scene did, so its read assertion could never have
		 * passed even with a driver.
		 */
		const box = await hoverReadControl(cdp, TARGET);
		receipt.readControl = box;
		for (const type of ["mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
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
		await screenshot(cdp, "notifications-native-after");

		/*
		 * NEGATIVE CONTROL: THE SAME GESTURE AIMED AT A ROW THAT IS NOT ON SCREEN.
		 *
		 * This is what makes the instrument a measurement of the VIEW rather than of
		 * the process: the item exists, it is unread, and the input is dispatched at
		 * the coordinates its control WOULD occupy - but the reel is scrolled and the
		 * row is off-viewport, so nothing is revealed, nothing is pressed, and no
		 * receipt may appear. A harness that could mark a row read without it being
		 * visible would prove nothing about what the operator saw.
		 */
		const offScreen = await aimOffScreen(cdp, UNRELATED);
		receipt.offScreenAim = offScreen;
		await pause(5_000);
		const unrelatedAfter = readRow(config, UNRELATED);
		receipt.unrelatedAfterOffScreenAim = unrelatedAfter;
		assert.equal(
			String(unrelatedAfter.read).toLowerCase(),
			"0",
			"an item that was never on screen was marked read",
		);

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
		writeFileSync(outfile, JSON.stringify(receipt, null, 2));
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
		writeFileSync(outfile, JSON.stringify(receipt, null, 2));
		throw error;
	} finally {
		cdp?.close();
		nodeCdp?.close();
		/*
		 * THE BACKEND DIES BEFORE THE REAPER, and that order is load-bearing: the
		 * backend is a python child running under this process's `pythonChildEnv`
		 * scratch cache, and the reaper EXITS the process, whose exit hook purges
		 * that cache. With the child still alive it wrote under the purge and the
		 * hook threw `ENOTEMPTY` - a cleanup error standing in place of the scene's
		 * own failure.
		 */
		backend.kill("SIGTERM");
		await exited(backend, 5_000);
		if (backend.exitCode === null && backend.signalCode === null) {
			backend.kill("SIGKILL");
			await exited(backend, 5_000);
		}
		writeFileSync(join(OUT, "core.log"), backendLog.join(""));
		const wroteReceipt = existsSync(outfile);
		/*
		 * THE EXIT CODE IS THE VERDICT. `reapExited` ends this process, so the code
		 * it is handed is the one the harness sees. It used to be a flat 0, which
		 * turned every failure above into a GREEN CI step sitting on a receipt that
		 * said `"result": "failed"` - the false green this scene exists to prevent.
		 */
		await api.reapLiveBoots({
			code:
				receipt.result === "positive-foreground-read-confirmed" && wroteReceipt
					? 0
					: 1,
			why: "notifications native scene complete",
		});
	}
}

if (isEntryPoint(import.meta.url)) await main();
