#!/usr/bin/env node
/**
 * Measure the app frame before and after the composer's plan chip is pressed.
 *
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=<token> LOCAL_OPERATOR_CONFIG_DIR=<isolated> \
 *       node scripts/run-panel-reveal-proof.mjs --session=<12 hex> \
 *       [--backend=http://127.0.0.1:1111] [--width=1380] [--height=900] \
 *       [--theme=<ThemeName>] [--out=<dir>]
 *
 * Why this is a committed script rather than a throwaway rig: the claim it
 * checks - "pressing the plan chip moves the pane's own reading position and
 * nothing else" - is a claim about a RUNNING application and about boxes that no
 * unit test can lay out. `scrollIntoView` walks every scrolling box up to the
 * viewport, so the defect it replaces was invisible to the DOM and visible only
 * as geometry in the real window: at 1024x673 the chat column's slot row scrolled
 * 108px sideways, at 800x600 221px, because the run pane does not fit beside the
 * column at those widths. A green typecheck cannot see any of that.
 *
 * How it drives the app: the BUILT app (`pnpm build`), in `headless` window mode
 * (never shown, never focused - the operator's rule for every agent-driven run),
 * over raw CDP with Node's built-in WebSocket. No browser-automation dependency
 * is installed for this. The press is a real `Input.dispatchMouseEvent` at the
 * chip's painted centre after asking the page who owns that point, not a
 * synthetic `element.click()`, so a chip that is painted but not hit-testable
 * fails here rather than passing.
 *
 * What it needs around it: a backend the app is paired with, holding a session
 * that has a plan (`scripts/seed-plan-session.mjs` writes one into an isolated
 * config dir) and a provider credential, because the app opens its first-run
 * onboarding modal over an unconfigured backend and a modal swallows the press.
 * Read the README beside the frames for the three commands that stand that up.
 *
 * The token is read from the environment and never printed, logged or written
 * into the report.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The `--key=value` prefix, hoisted so parsing argv builds no regex per entry. */
const ARG_PREFIX = /^--/;

const args = new Map(
	process.argv
		.slice(2)
		.filter((arg) => arg.startsWith("--"))
		.map((arg) => {
			const [key, ...rest] = arg.replace(ARG_PREFIX, "").split("=");
			return [key, rest.join("=")];
		}),
);

const SESSION = args.get("session") ?? "";
const BACKEND = args.get("backend") ?? "http://127.0.0.1:1111";
const WIDTH = Number(args.get("width") ?? 1380);
const HEIGHT = Number(args.get("height") ?? 900);
const THEME = args.get("theme") ?? "";
const OUT = resolve(args.get("out") ?? "out/run-panel-reveal");
const REPO = resolve(args.get("repo") ?? ".");
const PORT = Number(args.get("port") ?? 9451);

const TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? "";
if (!SESSION || !TOKEN) {
	console.error(
		"usage: LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/run-panel-reveal-proof.mjs --session=<id> [--backend=…] [--width=…] [--height=…] [--theme=…] [--out=…]",
	);
	process.exit(1);
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

/*
 * Every box in the chain, not a ranked subset: the point of the measurement is
 * that the mover is a box NOBODY would have named, so the script cannot decide
 * in advance which ancestors are worth reading.
 */
const MEASURE = `(() => {
	const box = (node) => {
		const style = getComputedStyle(node);
		const rect = node.getBoundingClientRect();
		return {
			name: node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + "|" + String(node.className || "").split(" ").slice(0, 3).join("."),
			overflowY: style.overflowY,
			overflowX: style.overflowX,
			scrollTop: node.scrollTop,
			scrollLeft: node.scrollLeft,
			verticalOverflow: node.scrollHeight - node.clientHeight,
			horizontalOverflow: node.scrollWidth - node.clientWidth,
			top: Math.round(rect.top * 100) / 100,
			left: Math.round(rect.left * 100) / 100,
		};
	};
	const chain = (root) => {
		const rows = [];
		for (let node = root; node; node = node.parentElement) rows.push(box(node));
		return rows;
	};
	const todos = (() => {
		const pane = document.querySelector("[data-run-panel-pane]");
		if (!pane) return null;
		for (const section of pane.querySelectorAll("section")) {
			if (/^To-dos/.test(section.textContent.trim())) return section;
		}
		return null;
	})();
	const chip = document.querySelector("[data-status-plan]");
	const seen = new Set();
	const scrollBoxes = [];
	for (const root of [chip, todos]) {
		for (let node = root; node; node = node.parentElement) {
			if (seen.has(node)) continue;
			seen.add(node);
			scrollBoxes.push(box(node));
		}
	}
	const surfaces = {};
	const add = (name, node) => {
		if (!node) {
			surfaces[name] = null;
			return;
		}
		const rect = node.getBoundingClientRect();
		surfaces[name] = {
			top: Math.round(rect.top * 100) / 100,
			left: Math.round(rect.left * 100) / 100,
			width: Math.round(rect.width * 100) / 100,
			height: Math.round(rect.height * 100) / 100,
		};
	};
	add("iconRailAndList", document.querySelector("nav.group"));
	add("chatList", document.querySelector('nav[aria-label="Chats"]'));
	add("chatColumn", document.querySelector('div[class*="@container/chatcol"]'));
	add("transcript", document.querySelector("[data-lo-canonical-transcript]"));
	add("composerBand", document.querySelector("[data-lo-composer-band]"));
	add("runPane", document.querySelector("[data-run-panel-pane]"));
	add("todosSection", todos);
	return {
		viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
		paneOpen: Boolean(document.querySelector("[data-run-panel-pane]")),
		dialog: Boolean(document.querySelector("div[role='dialog']")),
		documentScrollTop: document.documentElement.scrollTop,
		bodyScrollTop: document.body.scrollTop,
		scrollBoxes,
		surfaces,
	};
})()`;

const app = await (async () => {
	/*
	 * A port somebody else is already holding is the one start-up failure that
	 * looks exactly like a slow launch: the window comes up, `/json/list` answers,
	 * and the page target this script waits for never appears because the port
	 * belongs to another process. Name it here rather than waiting 60s for it.
	 */
	try {
		const busy = await fetch(`http://127.0.0.1:${PORT}/json/version`);
		if (busy.ok)
			throw new Error(
				`port ${PORT} already has a devtools endpoint; pass --port=<free port>`,
			);
	} catch (error) {
		if (error instanceof Error && error.message.includes("already has"))
			throw error;
		// Nothing listening: the normal case.
	}
	const profile = mkdtempSync(join(tmpdir(), "lo-reveal-proof-"));
	const child = spawn(
		"npx",
		[
			"electron",
			".",
			`--remote-debugging-port=${PORT}`,
			`--user-data-dir=${profile}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
		],
		{
			cwd: REPO,
			env: {
				...process.env,
				LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
				// The QA gate's rule: an inherited cmux id let a headless run rename
				// the operator's real workspaces.
				CMUX_WORKSPACE_ID: undefined,
				CMUX_SURFACE_ID: undefined,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	child.unref();
	const log = [];
	child.stdout.on("data", (chunk) => log.push(String(chunk)));
	child.stderr.on("data", (chunk) => log.push(String(chunk)));

	let target = null;
	for (let attempt = 0; attempt < 120 && !target; attempt++) {
		await wait(500);
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${PORT}/json/list`)
			).json();
			target =
				list.find(
					(entry) => entry.type === "page" && entry.url.startsWith("file://"),
				) ?? null;
		} catch {
			// The endpoint is not up yet.
		}
	}
	if (!target)
		throw new Error(
			`no app page target after 60s:\n${log.join("").slice(-2000)}`,
		);

	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.addEventListener("open", resolveOpen, { once: true });
		socket.addEventListener("error", rejectOpen, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolveIt, rejectIt } = pending.get(message.id);
		pending.delete(message.id);
		message.error
			? rejectIt(new Error(JSON.stringify(message.error)))
			: resolveIt(message.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolveIt, rejectIt) => {
			const id = ++nextId;
			pending.set(id, { resolveIt, rejectIt });
			socket.send(JSON.stringify({ id, method, params }));
		});
	await send("Page.enable");
	await send("Runtime.enable");

	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ?? "evaluate failed",
			);
		return result.result.value;
	};
	const clientPoint = async (selector) =>
		evaluate(`(() => {
			const node = document.querySelector(${JSON.stringify(selector)});
			if (!node) return null;
			const rect = node.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()`);
	const click = async (selector) => {
		const point = await clientPoint(selector);
		if (!point) return false;
		await send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: point.x,
			y: point.y,
		});
		for (const type of ["mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			});
		}
		return true;
	};
	const screenshot = async (path) => {
		const shot = await send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		writeFileSync(path, Buffer.from(shot.data, "base64"));
	};
	// A headless window cannot be focused, so a key event is dropped without it.
	await send("Emulation.setFocusEmulationEnabled", { enabled: true });
	return { child, send, evaluate, click, screenshot, log, socket };
})();

const outDir = join(OUT, `press-${WIDTH}x${HEIGHT}`);
mkdirSync(outDir, { recursive: true });
const theme = THEME || "default";

try {
	if (THEME) {
		/*
		 * The app's own persisted preference, written the way the app writes it,
		 * so a frame is of the theme the app itself paints.
		 */
		await app.evaluate(`(() => {
			const key = "ui-preferences-storage";
			const current = JSON.parse(localStorage.getItem(key) ?? "{}");
			current.state = { ...(current.state ?? {}), themeName: ${JSON.stringify(THEME)} };
			localStorage.setItem(key, JSON.stringify(current));
		})()`);
	}
	await app.send("Page.navigate", {
		url: `file://${join(REPO, "out", "renderer", "index.html")}#/chat/${SESSION}`,
	});
	await wait(10000);

	/*
	 * Warm the session the way the composer does on its first keystroke. The
	 * plan does not reach the renderer until a runtime is engaged, and a proof
	 * should not need a synthetic keystroke to make its own subject exist.
	 *
	 * The engage is ASYNC and the plan arrives over the canonical stream a moment
	 * after it, so this polls for the chip and asks again rather than racing a
	 * fixed sleep: a cold engage under load measured longer than the 9s this used
	 * to wait, and the failure it produced ("the session has no plan chip") named
	 * the fixture instead of the race. Asking twice costs one round trip when the
	 * runtime was already engaged, which is the normal case for a re-run.
	 */
	const warm = () =>
		fetch(`${BACKEND}/v1/desktop/sessions/${SESSION}/warm`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				"Content-Type": "application/json",
			},
			body: "{}",
		}).catch(() => {});
	for (let attempt = 0; attempt < 8; attempt++) {
		await warm();
		for (let tick = 0; tick < 10; tick++) {
			await wait(1500);
			if (
				await app.evaluate(
					`Boolean(document.querySelector("[data-status-plan]"))`,
				)
			)
				break;
		}
		if (
			await app.evaluate(
				`Boolean(document.querySelector("[data-status-plan]"))`,
			)
		)
			break;
	}

	if (
		await app.evaluate(`Boolean(document.querySelector("div[role='dialog']"))`)
	)
		throw new Error(
			"the app is showing a modal (unconfigured backend); the press would be swallowed",
		);
	if (
		!(await app.evaluate(
			`Boolean(document.querySelector("[data-status-plan]"))`,
		))
	)
		throw new Error(
			"the session has no plan chip: seed a session with a To-dos plan",
		);

	// A known closed pane, so the press is the whole change. The pane's own close
	// control first; Escape is the ladder's own rung for a window too narrow for
	// the chrome to be on screen (measured at 800x600), and it needs the press's
	// target to be `body`, hence the blur.
	for (let attempt = 0; attempt < 3; attempt++) {
		if (
			!(await app.evaluate(
				`Boolean(document.querySelector("[data-run-panel-pane]"))`,
			))
		)
			break;
		if (!(await app.click('[aria-label="Close run details"]'))) {
			await app.evaluate(
				"document.activeElement instanceof HTMLElement && document.activeElement.blur()",
			);
			for (const type of ["keyDown", "keyUp"])
				await app.send("Input.dispatchKeyEvent", {
					type,
					key: "Escape",
					code: "Escape",
					windowsVirtualKeyCode: 27,
					nativeVirtualKeyCode: 27,
				});
		}
		await wait(700);
	}
	if (
		await app.evaluate(
			`Boolean(document.querySelector("[data-run-panel-pane]"))`,
		)
	)
		throw new Error("could not close the pane before the press");

	const before = await app.evaluate(MEASURE);
	await app.screenshot(join(outDir, `${theme}-before.png`));

	const chip = await app.evaluate(`(() => {
		const node = document.querySelector("[data-status-plan]");
		const rect = node.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const at = document.elementFromPoint(x, y);
		return {
			label: node.getAttribute("aria-label"),
			x,
			y,
			hit: at === node || node.contains(at),
			owner: at ? at.tagName.toLowerCase() + "." + String(at.className || "").split(" ")[0] : null,
		};
	})()`);
	if (!chip.hit)
		throw new Error(
			`the plan chip is not hit-testable at its centre: ${chip.owner} owns it`,
		);

	await app.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: chip.x,
		y: chip.y,
	});
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", {
			type,
			x: chip.x,
			y: chip.y,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	}
	await wait(500);
	await app.evaluate(
		"new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300))))",
	);
	const after = await app.evaluate(MEASURE);
	await app.screenshot(join(outDir, `${theme}-after.png`));

	const movers = [];
	const names = new Set(after.scrollBoxes.map((row) => row.name));
	for (const name of names) {
		const first = before.scrollBoxes.find((row) => row.name === name);
		const second = after.scrollBoxes.find((row) => row.name === name);
		if (!second) continue;
		if (
			second.scrollTop !== (first?.scrollTop ?? 0) ||
			second.scrollLeft !== (first?.scrollLeft ?? 0)
		)
			movers.push({
				name,
				scrollTop: [first?.scrollTop ?? 0, second.scrollTop],
				scrollLeft: [first?.scrollLeft ?? 0, second.scrollLeft],
			});
	}
	const report = {
		session: SESSION,
		backend: BACKEND,
		viewport: before.viewport,
		press: chip.label,
		paneOpen: [before.paneOpen, after.paneOpen],
		movers,
		before,
		after,
	};
	writeFileSync(join(outDir, `${theme}.json`), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify(
			{
				viewport: before.viewport,
				press: chip.label,
				paneOpen: [before.paneOpen, after.paneOpen],
				movers,
			},
			null,
			2,
		),
	);
	console.log(`frames and readings in ${outDir}`);
} finally {
	app.socket.close();
	app.child.kill("SIGTERM");
	/*
	 * WAIT for the exit before returning. A run that leaves the app holding its
	 * devtools port makes the NEXT run fail with "no app page target", which reads
	 * as a slow launch rather than as the collision it is (measured: two of three
	 * consecutive sizes failed that way). SIGKILL is the backstop for an app that
	 * ignores the term.
	 */
	for (let attempt = 0; attempt < 20 && app.child.exitCode === null; attempt++)
		await wait(250);
	if (app.child.exitCode === null) {
		app.child.kill("SIGKILL");
		await wait(500);
	}
	/*
	 * The child's pipes keep this process alive on their own: a CLI that spawned
	 * Electron with `stdio: ["ignore", "pipe", "pipe"]` and only killed it waits
	 * forever for streams nobody will close, which is a hang AFTER the whole
	 * measurement is already on disk (measured: the work finished at 10:40 and the
	 * process was still alive when the run was timed out). Destroy them and exit
	 * on the result the run already has.
	 */
	app.child.stdout?.destroy();
	app.child.stderr?.destroy();
	app.child.unref();
}
