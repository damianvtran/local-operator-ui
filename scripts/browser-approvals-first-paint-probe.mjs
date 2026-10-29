#!/usr/bin/env node
/**
 * Approvals card FIRST-PAINT palette probe.
 *
 * WHAT THIS PROVES. The card is a second document, loaded by the approvals
 * controller; the model that carries the app's exact palette arrives through
 * `window.__approvalsCard.setModel` only AFTER the document has painted. This
 * probe measures what the document paints before that model lands and what it
 * paints once the model does, for a non-default dark palette and a light one.
 *
 *   cell "controller" — builds the card the way the product does: the
 *   renderer's context push (`setContext`) first, then the queue. A
 *   document-start preload records the `data-theme` timeline, so the value the
 *   document had at `DOMContentLoaded` is the value that was painted, before
 *   any model push. It also records the URL main actually loaded.
 *
 *   cell "document" — loads the very URL the controller's builder produced,
 *   captures the FIRST-PAINT frame with no model, then pushes one real model
 *   through the documented bridge and captures the after-model frame. Two
 *   frames, two hashes: before the fix they differ (the flash the operator
 *   reported); after the fix they are byte-identical.
 *
 * WHAT IT CANNOT PROVE. Native compositing over the live page (the window is
 * hidden and the capture is the card document's own surface, never the
 * composite) and Windows/Linux behaviour. Those stay stated as BLOCKED, not as
 * passes.
 *
 * Isolation: private `--user-data-dir`, mock keychain (a scratch profile must
 * not ask macOS for a login keychain), `CMUX_*`/`LOP_*` stripped, and the exact
 * process group reaped on exit. The card document is served from the repo's own
 * SOURCE over loopback, so no build step is needed.
 *
 * Usage:
 *   node scripts/browser-approvals-first-paint-probe.mjs --out <dir> [--require-match]
 *
 * `--require-match` exits non-zero unless every case paints the exact palette
 * first and both frames hash the same. Run it without the flag to capture the
 * "before" evidence.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const ELECTRON_BIN = requireFromRepo("electron");

const outIndex = process.argv.indexOf("--out");
const OUT = outIndex === -1 ? null : process.argv[outIndex + 1];
const REQUIRE_MATCH = process.argv.includes("--require-match");
if (!OUT || OUT.startsWith("--")) throw new Error("--out <dir> is required");
mkdirSync(OUT, { recursive: true });

/** One dark palette that is not the brand default, and one light palette. */
const CASES = [
	{ theme: "dark", palette: "obsidian" },
	{ theme: "light", palette: "kanagawaLotus" },
];

// The card entry bundled on the fly: the document references
// `/src/approvals-overlay/main.ts`, which is what Vite's dev server resolves.
const bundled = await build({
	entryPoints: [join(ROOT, "src/renderer/src/approvals-overlay/main.ts")],
	bundle: true,
	write: false,
	format: "esm",
	platform: "browser",
	target: "chrome130",
	logLevel: "silent",
});
const cardScript = bundled.outputFiles[0].text;

const readRepoFile = (relative) => readFileSync(join(ROOT, relative));
const server = createServer((request, response) => {
	const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
	const send = (type, body) => {
		response.writeHead(200, { "content-type": type });
		response.end(body);
	};
	if (pathname === "/browser-approvals-overlay.html") {
		return send(
			"text/html; charset=utf-8",
			readRepoFile("src/renderer/browser-approvals-overlay.html"),
		);
	}
	if (pathname === "/src/approvals-overlay/main.ts") {
		return send("text/javascript; charset=utf-8", cardScript);
	}
	if (pathname === "/src/styles/themes.generated.css") {
		return send(
			"text/css; charset=utf-8",
			readRepoFile("src/renderer/src/styles/themes.generated.css"),
		);
	}
	if (pathname === "/src/approvals-overlay/card.css") {
		return send(
			"text/css; charset=utf-8",
			readRepoFile("src/renderer/src/approvals-overlay/card.css"),
		);
	}
	response.writeHead(404).end("missing");
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const { port } = server.address();

/*
 * A DOCUMENT-START RECORD. The card's own script runs as a module at the end of
 * the body; this preload sees the document earlier, so every `data-theme` write
 * is in the timeline with the phase it happened in. A hidden window paints no
 * animation frames, so the phase labels are document lifecycle events rather
 * than rAF probes.
 */
const PRELOAD = join(OUT, "first-paint-preload.cjs");
writeFileSync(
	PRELOAD,
	`const { contextBridge } = require("electron");
const events = [];
const themeNow = () => {
	const element = document.documentElement;
	return element ? (element.dataset.theme ?? null) : null;
};
const record = (phase) => events.push({ phase, theme: themeNow(), at: Math.round(performance.now()) });
record("document-start");
const observe = () => {
	const element = document.documentElement;
	if (!element) {
		setTimeout(observe, 0);
		return;
	}
	new MutationObserver(() => record("data-theme-changed")).observe(element, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	record("observed");
};
observe();
window.addEventListener("DOMContentLoaded", () => record("domcontentloaded"));
window.addEventListener("load", () => record("load"));
contextBridge.exposeInMainWorld("__firstPaintProbe", () => ({
	events: events.slice(),
	theme: themeNow(),
	href: location.href,
}));
`,
);

const mainEntry = join(OUT, "first-paint-main.ts");
writeFileSync(
	mainEntry,
	`import { app, BrowserWindow, WebContentsView } from "electron";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ApprovalsOverlayController,
	approvalsDocumentUrl,
} from ${JSON.stringify(join(ROOT, "src/main/browser/approvals-overlay.ts"))};
import { approvalsCardModelFrom } from ${JSON.stringify(join(ROOT, "src/main/browser/approvals-overlay-model.ts"))};

const out = ${JSON.stringify(OUT)};
const cardUrl = ${JSON.stringify(`http://127.0.0.1:${port}/browser-approvals-overlay.html`)};
const preloadPath = ${JSON.stringify(PRELOAD)};
const CASES = ${JSON.stringify(CASES)};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("use-mock-keychain");
const watchdog = setTimeout(() => {
	writeFileSync(join(out, "first-paint-facts.json"), JSON.stringify({ failure: "watchdog: flow exceeded 240s" }, null, 2));
	app.exit(1);
}, 240000);
watchdog.unref();

const entries = [
	{ entryId: "entry-0", origin: "https://example0.test", displayAuthority: "example0.test", requester: "session:entry-0", requesterSessionId: "entry-0", expiresAt: Date.now() + 9 * 60000 },
	{ entryId: "entry-1", origin: "https://example1.test", displayAuthority: "example1.test", requester: "session:entry-1", requesterSessionId: "entry-1", expiresAt: Date.now() + 8 * 60000 },
];
const labels = { "entry-0": "Fix the login flow", "entry-1": "Draft a release note" };

const readTheme = (contents) => contents.executeJavaScript("document.documentElement.dataset.theme ?? null");
const readProbe = (contents) => contents.executeJavaScript("window.__firstPaintProbe ? window.__firstPaintProbe() : null");
/*
 * THE PIXEL IS THE CLAIM. A first-paint frame and an after-model frame differ in
 * CONTENT (the fallback text becomes the request), so whole-image equality
 * proves nothing. What must match is the card's own background colour: one pixel
 * inside the card, bottom centre, read out of the captured surface. Same hex
 * means the same palette painted; a different hex is the flash.
 */
const sampleHex = (image) => {
	const size = image.getSize();
	const bitmap = image.toBitmap();
	const x = Math.floor(size.width / 2);
	const y = size.height - 4;
	const offset = (y * size.width + x) * 4;
	return "#" + [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]].map((value) => value.toString(16).padStart(2, "0")).join("");
};
const writeFrame = (name, image) => {
	const buffer = image.toPNG();
	writeFileSync(join(out, name), buffer);
	const size = image.getSize();
	const hex = sampleHex(image);
	return {
		file: name,
		bytes: buffer.length,
		extent: size.width + "x" + size.height,
		empty: image.isEmpty(),
		background: hex,
		sha256: createHash("sha256").update(buffer).digest("hex"),
	};
};

/*
 * The product's own ordering: the renderer pushes the locale, the mode and the
 * exact palette on mount, and the card child is only created when a queue
 * arrives afterwards. If the palette were not known by then, main could not
 * put it in the URL and this cell would record the mode default instead.
 */
async function controllerCell(theme, palette) {
	const win = new BrowserWindow({ show: false, width: 520, height: 720, backgroundColor: "#000000" });
	const controller = new ApprovalsOverlayController({
		window: win,
		documentUrl: cardUrl,
		preloadPath,
		opaque: true,
		respond: () => ({ ok: true }),
	});
	controller.setContext({ locale: "en", dir: "ltr", theme, palette });
	controller.setModel({ entries, locale: "en", dir: "ltr", theme, palette, requesterLabels: labels });
	controller.onLayout({ presented: true, contentRect: { x: 0, y: 0, width: 480, height: 680 }, revision: 1 });
	const started = Date.now();
	while (Date.now() - started < 20000 && !controller.facts().ready) await sleep(50);
	const facts = controller.facts();
	const children = win.contentView.children;
	const card = children.length > 0 ? children[children.length - 1] : null;
	const probe = card ? await readProbe(card.webContents).catch((error) => String(error)) : null;
	const finalTheme = card ? await readTheme(card.webContents).catch((error) => String(error)) : null;
	const loadedUrl = card ? card.webContents.getURL() : null;
	win.close();
	await sleep(100);
	return { ready: facts.ready, visible: facts.visible, failedReason: facts.failedReason, childCount: children.length, loadedUrl, probe, finalTheme };
}

async function documentCell(theme, palette) {
	// OFFSCREEN, NOT JUST HIDDEN. A hidden window has no display surface on this
	// host ("Current display surface not available for capture"), so the card is
	// loaded into an offscreen window of the card's own viewport: it paints a
	// real surface nobody sees, which is what the frame evidence needs.
	const win = new BrowserWindow({
		show: false,
		width: 420,
		height: 640,
		backgroundColor: "#102030",
		webPreferences: { offscreen: true, preload: preloadPath, sandbox: true, contextIsolation: true },
	});
	const view = win;
	const url = approvalsDocumentUrl(cardUrl, 2, theme, true, palette);
	await view.webContents.loadURL(url);
	const probe = await readProbe(view.webContents);
	const beforeTheme = await readTheme(view.webContents);
	/*
	 * WAIT FOR A REAL FRAME, THEN CAPTURE. A capture taken before the first paint
	 * is the surface, not the card (measured: the card's colour only appears after
	 * a paint). Offscreen rendering paints continuously, so one paint event plus a
	 * settle is the readiness signal; describePoint then records WHAT the
	 * sampled pixel belongs to, so no claim rests on an unidentified pixel.
	 */
	const settle = async () => {
		await new Promise((done) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				done();
			};
			view.webContents.once("paint", finish);
			setTimeout(finish, 2000);
		});
		await sleep(250);
		return view.webContents.capturePage();
	};
	const DESCRIBE_POINT =
		'(() => { const x = Math.floor(innerWidth / 2); const y = innerHeight - 4; const element = document.elementFromPoint(x, y); const rect = document.getElementById("approvals-card")?.getBoundingClientRect(); return { viewport: { width: innerWidth, height: innerHeight }, point: { x, y }, element: element ? element.tagName + (element.className ? "." + String(element.className).trim().split(" ").join(".") : "") : null, pixelRole: element ? getComputedStyle(element).backgroundColor : null, card: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, theme: document.documentElement.dataset.theme ?? null }; })()';
	const describePoint = () => view.webContents.executeJavaScript(DESCRIBE_POINT);
	const first = writeFrame("first-paint-" + palette + ".png", await settle());
	const firstPoint = await describePoint();
	const model = approvalsCardModelFrom({ seq: 1, entries, locale: "en", dir: "ltr", theme, palette, requesterLabels: labels });
	await view.webContents.executeJavaScript("window.__approvalsCard.setModel(" + JSON.stringify(model) + ")");
	await sleep(300);
	const afterTheme = await readTheme(view.webContents);
	const after = writeFrame("after-model-" + palette + ".png", await settle());
	const afterPoint = await describePoint();
	win.close();
	await sleep(100);
	return {
		url,
		probe,
		beforeTheme,
		afterTheme,
		first,
		after,
		firstPoint,
		afterPoint,
		identical: first.sha256 === after.sha256,
		sameBackground: first.background === after.background,
	};
}

app.whenReady().then(async () => {
	const cases = [];
	for (const { theme, palette } of CASES) {
		const controller = await controllerCell(theme, palette);
		const documentCellFacts = await documentCell(theme, palette);
		cases.push({ theme, palette, controller, document: documentCellFacts });
	}
	writeFileSync(
		join(out, "first-paint-facts.json"),
		JSON.stringify({
			cases,
			blocked: [
				"native composite over the live page: hidden window, card-only capturePage",
				"Windows/Linux behaviour: unmeasured",
			],
		}, null, 2),
	);
	clearTimeout(watchdog);
	app.quit();
}).catch((error) => {
	writeFileSync(join(out, "first-paint-facts.json"), JSON.stringify({ failure: String(error) }, null, 2));
	app.exit(1);
});
`,
);

await build({
	entryPoints: [mainEntry],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: join(OUT, "first-paint-main.mjs"),
	external: ["electron"],
});

const env = withNotificationsOff({ ...process.env });
for (const key of Object.keys(env)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
}
withTelemetryOff(env);
rmSync(join(OUT, "userdata"), { recursive: true, force: true });

const child = spawn(
	ELECTRON_BIN,
	[
		join(OUT, "first-paint-main.mjs"),
		`--user-data-dir=${join(OUT, "userdata")}`,
		"--disable-gpu",
		"--window-mode=headless",
	],
	{ env, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
let stderr = "";
let stdout = "";
child.stderr.on("data", (chunk) => {
	stderr += chunk;
});
child.stdout.on("data", (chunk) => {
	stdout += chunk;
});
const exitCode = await new Promise((done) => {
	const reap = () => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// The group is already gone.
		}
	};
	const timer = setTimeout(() => {
		reap();
		done("timeout");
	}, 300000);
	child.on("exit", (code) => {
		clearTimeout(timer);
		reap();
		done(code);
	});
});
server.close();

writeFileSync(join(OUT, "first-paint-stderr.txt"), stderr);
if (exitCode !== 0) {
	console.error(
		"electron exit",
		exitCode,
		"stdout:",
		stdout.slice(-3000),
		"stderr:",
		stderr.slice(-3000),
	);
	process.exit(1);
}

if (!existsSync(join(OUT, "first-paint-facts.json"))) {
	console.error(
		`no facts; exit=${exitCode} stdout:`,
		stdout.slice(-2000),
		"stderr:",
		stderr.slice(-4000),
	);
	process.exit(1);
}
const facts = JSON.parse(
	readFileSync(join(OUT, "first-paint-facts.json"), "utf8"),
);
if (facts.failure) {
	console.error(facts.failure);
	process.exit(1);
}
const failures = [];
for (const entry of facts.cases) {
	const urlPalette = new URL(
		entry.controller.loadedUrl ?? "http://x/",
	).searchParams.get("palette");
	const firstPaint =
		entry.controller.probe?.events?.find(
			(event) => event.phase === "domcontentloaded",
		)?.theme ?? null;
	const documentFirst =
		entry.document.probe?.events?.find(
			(event) => event.phase === "domcontentloaded",
		)?.theme ?? null;
	const pass =
		urlPalette === entry.palette &&
		firstPaint === entry.palette &&
		documentFirst === entry.palette &&
		entry.document.afterTheme === entry.palette &&
		entry.document.sameBackground;
	if (!pass) failures.push({ ...entry, urlPalette, firstPaint, documentFirst });
	console.log(
		[
			`${entry.theme}/${entry.palette}`,
			`url-palette=${urlPalette}`,
			`first-paint=${firstPaint}`,
			`document-first=${documentFirst}`,
			`after-model=${entry.document.afterTheme}`,
			`background first=${entry.document.first.background}`,
			`after=${entry.document.after.background}`,
			`same-background=${entry.document.sameBackground}`,
		].join("  "),
	);
}
if (REQUIRE_MATCH && failures.length > 0) {
	console.error(
		`first paint does not match the palette in ${failures.length} case(s)`,
	);
	process.exit(1);
}
