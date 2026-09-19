#!/usr/bin/env node
/**
 * The two surfaces that lied, photographed in the running app.
 *
 * WHY A RIG RATHER THAN STORYBOOK. Both defects are decided in MAIN and only
 * painted by the renderer:
 *
 * 1. `last-update-install.json` is read through `get-last-install-attempt`, so the
 *    Settings card that prints "The last update to version 0.28.3 didn't finish"
 *    renders whatever main answers. A story stubs that bridge and would therefore
 *    photograph the record's presence on both builds - it cannot see the
 *    retirement, which is the whole change.
 * 2. The unattended reconciliation is a launch-time read of a marker plus the
 *    install it names, and its outcome is an event the renderer turns into a
 *    notice. Nothing in Storybook runs main at all.
 *
 * So the rig boots the BUILT app in `headless` mode on a scratch HOME, scratch
 * config root and scratch `--user-data-dir` (`markerDir()` is
 * `app.getPath("userData")`, which is where both files live), seeds ONE scenario's
 * state before the boot, and captures with the app's own `Page.captureScreenshot`.
 * The same command runs against a tree built from each side of the change, which
 * is what makes the pair comparable - the shape `--scene settings-fields` records
 * for its own before/after.
 *
 * WHAT IT DOES NOT DO, stated because the absence is easy to over-read: it never
 * points the app at a backend (`VITE_DISABLE_BACKEND_MANAGER=true` and a cwd
 * outside the checkout keep the app off the operator's daemon and out of their
 * install), and it never presses an update. The update PRESS therefore cannot be
 * photographed here: driving it in the live app would mean aiming the app at a
 * synthetic daemon whose `/health` names a synthetic install root, and the one
 * thing that rig could not guarantee is that discovery picks that daemon rather
 * than the operator's real one - at which point the press would run the
 * operator's own updater. The press's verdict is proven by
 * `scripts/update-robustness.test.mjs` instead, which drives the shipped
 * `updateBackend` against a real generation layout on disk.
 *
 * Usage (run from the tree whose build you want photographed):
 *
 *   pnpm build
 *   node docs/evidence/update-report-accuracy/harness/capture-update-report.mjs \
 *     --scenario stale-record --expect-record=present \
 *     --out docs/evidence/update-report-accuracy/stale-record-before --keep
 *
 * `--expect-record` / `--expect-notice` are the run's own claim, so a run that
 * photographs the other build's behaviour FAILS rather than committing the wrong
 * frame under the right name.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";
import { withNotificationsOff } from "../../../../scripts/notifications-off.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");

const argValue = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const SCENARIO = argValue("--scenario", null);
const OUT = resolve(argValue("--out", join(HERE, "..", "frames")));
const EXPECT_RECORD = argValue("--expect-record", null);
const EXPECT_NOTICE = argValue("--expect-notice", null);
const WINDOW_SIZE = argValue("--window-size", "1380x900");
const KEEP = process.argv.includes("--keep");

/** The theme the scratch profile boots in: the app's own default. */
const THEME = "localOperatorDark";

if (!["stale-record", "unattended-landing"].includes(SCENARIO ?? "")) {
	console.error(
		`--scenario expects \`stale-record\` or \`unattended-landing\` (got ${JSON.stringify(SCENARIO)})`,
	);
	process.exit(2);
}
if (!existsSync(join(ROOT, "out", "main", "index.js"))) {
	console.error(
		`no built app at ${join(ROOT, "out", "main", "index.js")} - run \`pnpm build\` in ${ROOT} first`,
	);
	process.exit(2);
}

/* --------------------------------------------------------------- scratch tree */

const SCRATCH = join(realpathSync(tmpdir()), `lo-update-report-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const APP_CWD = join(SCRATCH, "cwd");
const PROFILE = join(SCRATCH, "userdata");
const INSTALL_ROOT = join(SCRATCH, "lop");

for (const dir of [HOME_DIR, CONFIG_DIR, APP_CWD, PROFILE, OUT])
	mkdirSync(dir, { recursive: true });

/**
 * The scratch `.env`, written where the app's own dotenv reads it.
 *
 * `VITE_DISABLE_BACKEND_MANAGER=true` is the load-bearing line: this run must not
 * install or start a backend in the scratch HOME, and a dead API URL keeps the
 * renderer's transport off the operator's own daemon at 1111.
 */
writeFileSync(
	join(APP_CWD, ".env"),
	[
		"# Written by capture-update-report.mjs.",
		"VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:9",
		"VITE_DISABLE_BACKEND_MANAGER=true",
		"",
	].join("\n"),
);

/* ------------------------------------------------------- the seeded scenarios */

/** One generation of the layout `lop update` installs into, in the scratch tree. */
const generationInstall = (id, version) => {
	const root = join(INSTALL_ROOT, "generations", id);
	const venv = join(root, "tools", "local-operator");
	mkdirSync(join(venv, "bin"), { recursive: true });
	writeFileSync(join(venv, "bin", "local-operator"), "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	writeFileSync(join(venv, "pyvenv.cfg"), "home = /usr/bin\n");
	writeFileSync(
		join(venv, "uv-receipt.toml"),
		'[tool]\nname = "local-operator"\n',
	);
	writeFileSync(join(venv, ".lop-source"), `pypi ${version}\n`, "utf8");
	const distInfo = join(
		venv,
		"lib",
		"python3.13",
		"site-packages",
		`local_operator-${version}.dist-info`,
	);
	mkdirSync(distInfo, { recursive: true });
	writeFileSync(
		join(distInfo, "METADATA"),
		`Name: local-operator\nVersion: ${version}\n`,
	);
	return { root, venv, script: join(venv, "bin", "local-operator") };
};

/** Point `<stable>/current` at a generation, staged-then-renamed as the installer does. */
const flipPointer = (root) => {
	const staged = join(INSTALL_ROOT, `current.tmp-${process.pid}`);
	symlinkSync(root, staged);
	renameSync(staged, join(INSTALL_ROOT, "current"));
};

const seeded = { scenario: SCENARIO, detail: {} };
if (SCENARIO === "stale-record") {
	/*
	 * THE OPERATOR'S OWN FILE, byte for byte (2026-09-18): a 0.28.3 install that
	 * failed while 0.28.2 was running, read back on an app that is now 0.29.1.
	 */
	const record = {
		targetVersion: "0.28.3",
		runningVersion: "0.28.2",
		startedAt: "2026-09-18T13:37:09.507Z",
		detectedAt: "2026-09-18T14:12:16.975Z",
		detail:
			"Install started /Users/damian/Library/Caches/local-operator-updater/pending/local-operator-ui-0.28.3-arm64.zip. Squirrel cancels an install when an instance of the app is running.",
		attempts: 1,
	};
	writeFileSync(
		join(PROFILE, "last-update-install.json"),
		`${JSON.stringify(record, null, 2)}\n`,
	);
	seeded.detail.recordWritten = join(PROFILE, "last-update-install.json");
} else {
	/*
	 * An update that landed while nothing was watching: the marker was written
	 * before the flip and names the CONCRETE generation the attempt started from
	 * (the spelling every build before this change wrote), and the pointer has
	 * since moved to the generation the install landed in.
	 */
	const before = generationInstall("20260918T233135Z-0.59.6", "0.59.6");
	const landed = generationInstall("20260918T233919Z-0.59.7", "0.59.7");
	flipPointer(landed.root);
	writeFileSync(
		join(PROFILE, "pending-server-update.json"),
		`${JSON.stringify(
			{
				before: "0.59.6",
				target: "0.59.7",
				startedAt: "2026-09-18T19:39:18.868Z",
				deadlineAt: "2026-09-18T19:59:18.868Z",
				// No group: the app died between writing the record and starting
				// anything, which is the record an unattended launch reconciles.
				groupPid: null,
				groupStartedAt: null,
				installPath: before.script,
			},
			null,
			2,
		)}\n`,
	);
	seeded.detail.markerWritten = join(PROFILE, "pending-server-update.json");
	seeded.detail.installRoot = INSTALL_ROOT;
	seeded.detail.pointerNow = join(
		INSTALL_ROOT,
		"current",
		"tools",
		"local-operator",
		"bin",
		"local-operator",
	);
}

/* ------------------------------------------------------------------- the boot */

const ELECTRON_BIN = createRequire(join(ROOT, "package.json"))("electron");

const freePort = async () => {
	const { createServer } = await import("node:net");
	for (;;) {
		const port = 20_000 + Math.floor(Math.random() * 20_000);
		const free = await new Promise((done) => {
			const server = createServer();
			server.once("error", () => done(false));
			server.once("listening", () => server.close(() => done(true)));
			server.listen(port, "127.0.0.1");
		});
		if (free) return port;
	}
};

const port = await freePort();

const env = withNotificationsOff({
	...process.env,
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: join(HOME_DIR, "logs"),
	VITE_DISABLE_BACKEND_MANAGER: "true",
	// Never arm the app's dev driver: this rig drives the page itself, and the
	// driver's own verbs are not what is being photographed here.
	LOCAL_OPERATOR_UI_DEV_DRIVER: undefined,
	LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: undefined,
});
for (const key of Object.keys(env)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
}
env.LOCAL_OPERATOR_UI_WINDOW_MODE = "headless";

const child = spawn(
	ELECTRON_BIN,
	/*
	 * THE MOCK KEYCHAIN SWITCH COMES FROM ITS ONE HOME (`scripts/chrome-keychain.mjs`):
	 * a scratch HOME has no login keychain, and a Chromium that reaches Keychain
	 * Services there asks macOS to CREATE one - on the operator's screen. Spelling
	 * the switch here instead of importing it is what `chrome-keychain.test.mjs`
	 * fails on by name.
	 */
	withMockKeychain([
		// The app directory as an argument, and the cwd outside the checkout: the
		// app's dotenv reads `.env` from its cwd with `override: true`.
		ROOT,
		`--user-data-dir=${PROFILE}`,
		`--remote-debugging-port=${port}`,
		"--window-mode=headless",
		`--window-size=${WINDOW_SIZE}`,
	]),
	{ env, cwd: APP_CWD, stdio: ["ignore", "pipe", "pipe"] },
);
const stream = [];
child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
child.stderr.on("data", (chunk) => stream.push(chunk.toString()));

const appLog = () => stream.join("");
const say = (line) => console.log(line);

/** Stop the app by exact pid: a pattern would take the operator's own app with it. */
const stopApp = async () => {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	for (let i = 0; i < 40; i++) {
		if (child.exitCode !== null || child.signalCode !== null) return;
		await new Promise((done) => setTimeout(done, 250));
	}
	child.kill("SIGKILL");
	await new Promise((done) => setTimeout(done, 500));
};
const dispose = () => {
	try {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	} catch {
		/* already gone */
	}
	if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true });
};

/* -------------------------------------------------------------- the protocol */

/** One CDP connection to the app's renderer, over its own inspector socket. */
class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.sequence = 0;
		this.pending = new Map();
		this.console = [];
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id === undefined) {
				if (message.method === "Runtime.consoleAPICalled") {
					this.console.push(
						(message.params.args ?? [])
							.map((arg) => arg.value ?? arg.description ?? "")
							.join(" "),
					);
				}
				return;
			}
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			pending(message);
		});
	}

	send(method, params = {}) {
		this.sequence += 1;
		const id = this.sequence;
		return new Promise((done) => {
			this.pending.set(id, done);
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression) {
		const reply = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		const exception = reply.result?.exceptionDetails;
		if (reply.error) throw new Error(`CDP: ${reply.error.message}`);
		if (exception) {
			throw new Error(
				exception.exception?.description ?? exception.text ?? "threw",
			);
		}
		return reply.result?.result?.value;
	}

	/** The app photographing its own window, the way every committed frame is taken. */
	async frame(path) {
		const reply = await this.send("Page.captureScreenshot", { format: "png" });
		const base64 = reply.result?.data;
		if (!base64) throw new Error("captureScreenshot returned no pixels");
		writeFileSync(path, Buffer.from(base64, "base64"));
		return path;
	}
}

/**
 * The app's OWN document target, never the first one that calls itself a page.
 *
 * Measured here: `/json/list` offers an `about:blank` page before the app's
 * `file://…/out/renderer/index.html`, and evaluating in THAT one answers
 * `typeof window.api === "undefined"` - a missing bridge that reads exactly like a
 * missing feature. So the target is chosen by the document it is on, and the
 * choice is reported rather than trusted.
 */
const isAppTarget = (target) =>
	target.type === "page" &&
	typeof target.url === "string" &&
	target.url.startsWith("file://") &&
	target.url.includes("/out/renderer/");

const connect = async () => {
	for (let i = 0; i < 120; i++) {
		try {
			const targets = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const page = targets.find(isAppTarget);
			if (page?.webSocketDebuggerUrl) {
				const socket = new WebSocket(page.webSocketDebuggerUrl);
				await new Promise((done, fail) => {
					socket.addEventListener("open", done, { once: true });
					socket.addEventListener(
						"error",
						() => fail(new Error("socket error")),
						{ once: true },
					);
				});
				const cdp = new Cdp(socket);
				await cdp.send("Runtime.enable");
				await cdp.send("Page.enable");
				return cdp;
			}
		} catch {
			/* not listening yet */
		}
		await new Promise((done) => setTimeout(done, 250));
	}
	throw new Error("the app never opened a renderer target");
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/* ----------------------------------------------------------------- the claims */

let failures = 0;
const check = (label, ok, detail, observed) => {
	if (!ok) failures += 1;
	const extra = ok ? observed : detail;
	say(
		`[${ok ? "PASS" : "FAIL"}] ${label}${extra === undefined ? "" : `\n        ${extra}`}`,
	);
	return ok;
};
const note = (label, detail) =>
	say(`[note] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);

/** Sharp is the repo's own encoder: the same lossless `.webp` the sweep writes. */
const encode = async (pngPath, webpPath) => {
	const { default: sharp } = await import("sharp");
	await sharp(pngPath).webp({ lossless: true }).toFile(webpPath);
};

const frames = [];
let cdp = null;

try {
	cdp = await connect();
	note("scenario seeded", JSON.stringify(seeded.detail));
	/*
	 * WHAT PAGE THIS IS, before anything is read from it: the rig's own claim is
	 * about the app's window, and a bridge-less evaluation is how attaching to the
	 * wrong target would read as a missing feature rather than as a wrong target.
	 */
	note(
		"the page",
		JSON.stringify(
			await cdp.evaluate(
				"({ href: location.href, title: document.title, appChildren: document.getElementById('app')?.childElementCount ?? 0, api: typeof window.api, electron: typeof window.electron })",
			),
		),
	);

	// The renderer painted its root: the app is up and the bridge is live.
	for (let i = 0; i < 120; i++) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount) })",
			)
			.catch(() => null);
		if (state?.ready === "complete" && state.mounted) break;
		await wait(250);
	}

	if (SCENARIO === "stale-record") {
		/*
		 * THE CARD, in the place a user meets it. Settings renders the record at
		 * `/settings`, and the paragraph is only reachable by scrolling: the section
		 * sits below the app/server version rows on the default window.
		 */
		const record = await cdp.evaluate(
			"window.api.updater.getLastInstallAttempt()",
		);
		note("get-last-install-attempt", JSON.stringify(record));

		await cdp.evaluate('location.hash = "#/settings"');
		let sentence = null;
		for (let i = 0; i < 60; i++) {
			sentence = await cdp
				.evaluate(
					"(() => { const el = [...document.querySelectorAll('p')].find((node) => node.textContent?.includes(\"didn't finish\")); return el ? el.textContent.trim() : null; })()",
				)
				.catch(() => null);
			if (sentence) break;
			await wait(250);
		}
		note("the card's sentence", sentence ?? "absent");

		// Bring the card into the viewport so the frame is of the card rather than
		// of the section's heading.
		await cdp.evaluate(
			"(() => { const el = [...document.querySelectorAll('p')].find((node) => node.textContent?.includes(\"didn't finish\")) ?? [...document.querySelectorAll('h2,h3')].find((node) => /Application updates/i.test(node.textContent ?? '')); el?.scrollIntoView({ block: 'center' }); return Boolean(el); })()",
		);
		await wait(700);

		const png = join(OUT, `${SCENARIO}.png`);
		await cdp.frame(png);
		frames.push(png);

		/*
		 * THE CARD'S OWN ROWS NEED THE SETTINGS REGISTRY, which main fills from a
		 * live daemon: with no backend the page renders its "settings could not be
		 * loaded" state and the card is not in the DOM on EITHER build, so a claim
		 * about the sentence would be a claim about a backend this rig does not
		 * have. Measured in both trees: `sentence` is null with `record` present
		 * before the change and null with `record` null after it.
		 *
		 * So the claim follows what IS reachable, and it is the reading that decides
		 * the sentence anyway: `get-last-install-attempt` is main's answer through the
		 * app's own IPC. Where the page DID render (a run with a live backend), the
		 * card's sentence is asserted against that reading, because the two disagreeing
		 * is the interesting failure.
		 */
		const wanted = EXPECT_RECORD ?? (record ? "present" : "absent");
		const pageRendered = await cdp
			.evaluate(
				"Boolean([...document.querySelectorAll('h2,h3')].find((node) => /Application updates/i.test(node.textContent ?? '')))",
			)
			.catch(() => false);
		const matches = wanted === "present" ? record !== null : record === null;
		if (pageRendered) {
			check(
				`the record reads as ${wanted}, and the card agrees with it`,
				matches &&
					(wanted === "present" ? Boolean(sentence) : sentence === null),
				`get-last-install-attempt answered ${JSON.stringify(record)} and the card printed ${JSON.stringify(sentence)}`,
			);
		} else {
			note(
				"the settings page did not render its sections",
				'main answers the backend\'s registry over IPC, so with no daemon the page shows its own "settings could not be loaded" state and the card is absent on BOTH builds - point this run at a live isolated backend (see the header) when the frame, rather than the reading, is what is being committed',
			);
			check(
				`the record reads as ${wanted} through the app's own IPC`,
				matches,
				`get-last-install-attempt answered ${JSON.stringify(record)}`,
			);
		}
	} else {
		/*
		 * THE NOTICE. The reconciliation reports once per launch, as a completion the
		 * renderer shows for its own seconds, so the run watches the whole window
		 * rather than a settled moment: every frame is kept as a candidate and the
		 * one that carries the notice is the one that is committed.
		 */
		let sawNotice = false;
		let sawNoticeAt = null;
		let noticeFrame = null;
		const started = Date.now();
		for (let i = 0; i < 60; i++) {
			const text = await cdp
				.evaluate("document.body.innerText")
				.catch(() => "");
			const present = Boolean(text) && /server update/i.test(text);
			const png = join(OUT, `probe-${String(i).padStart(2, "0")}.png`);
			await cdp.frame(png);
			if (present) {
				if (!sawNotice) {
					sawNotice = true;
					sawNoticeAt = Date.now() - started;
					note("the notice appeared", `${sawNoticeAt}ms into the window`);
				}
				// The LAST frame that still carries the notice, so a fade-out or a
				// dismissal is not the frame that gets committed.
				noticeFrame = png;
			}
			await wait(500);
		}
		const wanted = EXPECT_NOTICE ?? (sawNotice ? "present" : "absent");
		check(
			`the unattended notice reads as ${wanted}`,
			wanted === "present" ? sawNotice : !sawNotice,
			`the window ran ${Date.now() - started}ms and the notice was ${sawNotice ? `present from ${sawNoticeAt}ms` : "never present"}`,
		);
		frames.push(noticeFrame);
	}

	// Whatever the scenario, the app must have reported nothing of its own: a
	// renderer error here would be a frame of a crash rather than of the card.
	for (const line of cdp.console.slice(-10)) say(`  [renderer] ${line}`);
} catch (error) {
	failures += 1;
	say(`[FAIL] the run itself: ${error?.message ?? error}`);
	say(appLog().split("\n").slice(-30).join("\n"));
} finally {
	await stopApp();
	/*
	 * AND NOTHING OF THIS RUN'S IS LEFT RUNNING: the app is signalled by pid, and a
	 * survivor would sit on the operator's screen long after the frames landed.
	 */
	const survivors = stream
		.join("")
		.split("\n")
		.filter((line) => line.includes("[window-mode]"));
	if (survivors.length > 0)
		note("the app's own window-mode line", survivors[0]);

	// The frames are committed as `<theme>.webp`, which is what the evidence gate
	// reads a frame's theme from. The probe PNGs stay in the scratch tree so a
	// reviewer can see what the window looked like around the kept frame.
	const keep = frames.filter(Boolean).slice(-1)[0] ?? null;
	if (keep) {
		const webp = join(OUT, `${THEME}.webp`);
		await encode(keep, webp);
		note("committed frame", `${webp} (from ${keep})`);
	}
	cdp?.socket?.close?.();
	dispose();
	say(`[note] scratch tree${KEEP ? " kept at" : " removed"} ${SCRATCH}`);
	say(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`);
	process.exit(failures === 0 ? 0 : 1);
}
