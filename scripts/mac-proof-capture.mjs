#!/usr/bin/env node
/**
 * One-command rendered proof of the REAL app on a Mac, with no human step.
 *
 * WHY THIS EXISTS. The operator asked agents to "extend test harnesses as needed
 * to be able to test without my involvement". Every existing capture path
 * photographs the app from inside (`capturePage()`, CDP), which cannot see macOS
 * vibrancy: the blurred desktop behind a glass window is composited by the window
 * server, not painted by the page. The only capture that carries it is a
 * window-server capture of a SHOWN window, `screencapture -x -o -l <windowid>`.
 * This script makes that capture safe to run on the operator's own desktop:
 *
 *   - it execs the bundle's binary DIRECTLY (never `open`, which drops the env and
 *     hands the request to his running instance) with a scratch `--user-data-dir`,
 *     scratch HOME / config / log dirs, Chromium's mock keychain
 *     (`MOCK_KEYCHAIN_SWITCH`, `./chrome-keychain.mjs`), and
 *     `--window-mode=inactive` (shown with `showInactive()`: never activated, never
 *     focused - AGENTS.md "Running the app without taking the operator's focus");
 *   - the app's own S1 step runner (`src/main/dev-driver-script.ts`) drives the
 *     shipped dev-driver verbs from a JSON step list and prints one `SHUTTER` line
 *     per frame naming the CGWindowID; this script answers each with one
 *     window-only capture and an ack file. No CDP, no focus, no activation;
 *   - the backend is reached only through the app's existing ATTACH seam, so the
 *     instance can never spawn, install, claim or adopt a daemon. By default the
 *     harness starts its OWN `lop serve` on a scratch config root (`--backend
 *     isolated`), so nothing of the operator's is read at all;
 *   - everything it started is reaped by exact process group plus a
 *     profile-matched pid backstop (`./app-tree-teardown.mjs`); a leak fails the run.
 *
 * `docs/mac-proof-capture.md` is the operator-facing recipe; `--help` lists every
 * flag; `--negative-control` runs the refusal cases against these same guards.
 *
 * CONSTRAINTS that shape the code below:
 *   - Node built-ins only. The Mac runs it from any checkout, with no
 *     node_modules and no build (`--app-zip` photographs a downloaded release),
 *     and nothing here may need an install.
 *   - The desktop token is a credential. It travels ONLY in a child's environment:
 *     never argv, never stdout, never the receipt, never a file this script writes.
 *   - Refuse, don't fake (AGENTS.md "What a capture may claim"): every guard
 *     refuses before anything is spawned, and a step that failed ends the run
 *     before any frame can claim its state.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import os from "node:os";
import {
	basename,
	delimiter,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import {
	NOTIFICATION_ID,
	SEED_SCENARIOS,
	generateSeed,
	loadSeedSpec,
	seedExpectations,
	seedRowsProblem,
} from "./mac-proof-seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Exit codes: 0 frames captured; 1 run failed; 2 refused before spawning; 3 BLOCKED. */
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, REFUSED: 2, BLOCKED: 3 });

/** A refusal carries its exit code so `main` can print and exit uniformly. */
export class Refusal extends Error {
	constructor(message, code = EXIT.REFUSED) {
		super(message);
		this.code = code;
	}
}

/*
 * ---------------------------------------------------------------------------
 * Names derived from package.json, so a rename cannot silently weaken the
 * operator-root guard (design risk 9; the test pins the current values).
 * ---------------------------------------------------------------------------
 */
export function appNames(packageJsonPath = join(HERE, "..", "package.json")) {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	return { productName: pkg.productName, name: pkg.name };
}

/** The port the operator's own daemon listens on. Never an isolated backend's. */
export const OPERATOR_PORT = 1111;

/*
 * What a window-server frame may claim, until the Mac measurement in AGENTS.md
 * ("Capturing the frame") lands: the method is the one that CAN carry real
 * vibrancy, not yet shown to on this rig. Every place a frame is labelled
 * (receipt, frame entry, dry-run plan) uses this one string so it cannot drift
 * from the doc (review r1 R1-6, QA r1 Q4-3).
 */
export const SCREENCAPTURE_METHOD =
	"screencapture -l (real vibrancy, pending Mac measurement)";

/**
 * What a capturePage frame is (design D5): the app's own `capturePage()` keeps
 * the window's alpha, so glass regions are translucent RGBA. Viewers
 * composite that over white, so dark
 * frames look mid-grey and contrast reads falsely low (designer's frame review
 * of #1907, alpha 0.59-0.77 on glass). The bytes stay as
 * captured; the receipt says so on the run and on every frame.
 */
export const CAPTUREPAGE_METHOD =
	"capturePage: no vibrancy claim; RGBA with translucent glass; do not judge contrast from this mode";

export const SCENES = Object.freeze([
	"conversation",
	"files",
	"canvas",
	// One picture from --session's Files view opened in the canvas (--preview-file).
	"file-preview",
	"library",
	"notifications",
	// #1902: the asks drawer of --session, opened on its suggested-command ask.
	"asks",
	// #1907: one notification's details page (/notifications/<--notification-id>).
	"notification-detail",
	// #1907: the same item's details INSIDE --session's drawer (Updates tab).
	"update-detail",
	// The harness's ONE write: --session's Files row -> "Download to this
	// device", landed by the rig's backend inside the rig (see
	// downloadSceneSteps). --backend-config-root only.
	"download",
]);
/** The `file-preview` scene's default row: the picture 79's remote session holds. */
export const PREVIEW_FILE_DEFAULT = "image-1.png";
/*
 * A plain file name, because it is interpolated into CSS attribute selectors
 * (`[title*="/<name>"]`, `img[alt="<name>"]`): a quote, backslash, slash or
 * control character would change the selector rather than name a file.
 */
const PREVIEW_FILE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

export function previewFileProblem(name) {
	return typeof name === "string" && PREVIEW_FILE.test(name)
		? null
		: `--preview-file must be a plain file name (letters, digits, . _ - and space; got ${JSON.stringify(name)})`;
}

/** The file the download scene takes when --download-file is not given (the authorised fixture). */
export const DOWNLOAD_FILE_DEFAULT = "notes.md";
export const THEMES = Object.freeze({
	dark: "localOperatorDark",
	light: "localOperatorLight",
});
const SESSION_ID = /^[a-f0-9]{12}$/;
/** A library row id, as core's route pins it (desktop_library.py:62 `AssetID`). */
const LIBRARY_ASSET_ID = /^la_[0-9a-f]{16}$/;

/*
 * ---------------------------------------------------------------------------
 * Paths: the operator's roots, and the one comparison every guard uses.
 * ---------------------------------------------------------------------------
 */

/**
 * Every directory that belongs to the operator's own app or daemon.
 *
 * Computed for BOTH `os.userInfo().homedir` (what macOS NSHomeDirectory answers,
 * which ignores `$HOME`) and `$HOME`, because a rig that redirected HOME must
 * still recognise the real roots. Both platforms' userData layouts are listed on
 * every platform: a guard that branched on the OS would be untested on the Mac
 * where it matters.
 *
 * Linux userData follows `$XDG_CONFIG_HOME` when it is set (Electron's
 * `appData`), the same rule `operatorDesktopTokenPath` uses, so that location is
 * an operator root too (QA r1 Q1-2); `~/.config` stays listed regardless.
 */
export function operatorRoots({
	homes = [os.userInfo().homedir, process.env.HOME],
	names = appNames(),
	xdgConfigHome = process.env.XDG_CONFIG_HOME,
} = {}) {
	const appDirs = [...new Set([names.productName, names.name, "Electron"])];
	const roots = [];
	for (const home of new Set(homes.filter((h) => h && isAbsolute(h)))) {
		for (const dir of appDirs) {
			roots.push(join(home, "Library", "Application Support", dir));
			roots.push(join(home, ".config", dir));
		}
		roots.push(join(home, ".local-operator"));
	}
	if (xdgConfigHome && isAbsolute(xdgConfigHome))
		for (const dir of appDirs) roots.push(join(xdgConfigHome, dir));
	return [...new Set(roots)];
}

/**
 * realpath that also works for a path that does not exist yet: resolve the
 * nearest existing ancestor and append the rest. Comparing realpaths (never
 * strings) is what defeats a symlink whose target lands in an operator root.
 *
 * A DANGLING symlink (its target does not exist yet) makes realpath fail on the
 * link itself, and walking up past it would compare the link's own location
 * instead of where a later `mkdir` would land (QA r1 Q1-1: a link into a
 * not-yet-created `~/.config/Local Operator` passed). So a component that
 * `lstat`s as a symlink is followed with `readlink` and the target resolved in
 * its place; `depth` bounds a link cycle (ELOOP), the kernel's own limit.
 */
export function physical(path, depth = 0) {
	let head = resolve(path);
	const tail = [];
	for (;;) {
		try {
			return join(realpathSync(head), ...[...tail].reverse());
		} catch {}
		let target = null;
		try {
			if (lstatSync(head).isSymbolicLink()) target = readlinkSync(head);
		} catch {}
		if (target !== null && depth < 40)
			return physical(
				join(resolve(dirname(head), target), ...[...tail].reverse()),
				depth + 1,
			);
		const parent = dirname(head);
		if (parent === head) return resolve(path);
		tail.push(basename(head));
		head = parent;
	}
}

/**
 * The form two physical paths are COMPARED in. macOS's default APFS volume is
 * case-insensitive and Node's JS `realpathSync` keeps the caller's spelling, so
 * `…/application support/local operator` is the operator's profile there even
 * though the strings differ (review r1 R1-3). On darwin the comparison folds
 * case and Unicode normalisation (HFS+/APFS hand back NFD names); elsewhere it
 * is exact, because Linux filesystems are case-sensitive and folding there
 * would refuse paths that are genuinely different. `platform` is injectable so
 * the Linux test suite exercises the darwin rule.
 */
export function comparablePath(path, platform = process.platform) {
	return platform === "darwin" ? path.normalize("NFC").toLowerCase() : path;
}

function within(child, parent) {
	if (child === parent) return true;
	return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

/**
 * Agent scratchpads live at `~/.local-operator/sessions/<id>/scratchpad`, inside
 * the daemon's root but owned by the agent session, and they are where this
 * harness's rig and output belong by the repo's own scratch rule. They are the
 * ONE carve-out, and only for rig/profile/out - never for a backend config root.
 */
function insideScratchpad(path, root) {
	if (basename(root) !== ".local-operator") return false;
	const rel = relative(root, path).split(sep);
	return rel.length >= 3 && rel[0] === "sessions" && rel[2] === "scratchpad";
}

/**
 * Refuse a path that equals, sits inside, or contains an operator root.
 * Returns the refusal sentence, or null when the path is clear.
 */
export function operatorPathProblem(
	label,
	path,
	roots,
	{ allowScratchpad = true, platform = process.platform } = {},
) {
	if (!isAbsolute(path))
		return `${label} must be an absolute path (got ${path})`;
	const real = physical(path);
	const realKey = comparablePath(real, platform);
	for (const root of roots) {
		const realRoot = physical(root);
		const rootKey = comparablePath(realRoot, platform);
		if (within(realKey, rootKey)) {
			if (allowScratchpad && insideScratchpad(realKey, rootKey)) continue;
			return `${label} ${path} resolves to ${real}, which is the operator's ${realRoot} or inside it`;
		}
		if (within(rootKey, realKey))
			return `${label} ${path} resolves to ${real}, which contains the operator's ${realRoot}`;
	}
	return null;
}

/*
 * ---------------------------------------------------------------------------
 * Guards that refuse before anything is spawned.
 * ---------------------------------------------------------------------------
 */

/** Only `inactive` (window-server capture) or `headless` (capturePage only). */
export function windowModeProblem(mode) {
	if (mode === "inactive" || mode === "headless") return null;
	return `--window-mode ${JSON.stringify(mode)} is refused: only inactive (screencapture) or headless (capturepage) run here, never normal`;
}

/** The capture mode decides which window mode is legal. */
export function captureModeProblem(capture, mode) {
	if (capture !== "screencapture" && capture !== "capturepage")
		return `--capture must be screencapture or capturepage (got ${capture})`;
	if (capture === "screencapture" && mode !== "inactive")
		return "--capture screencapture needs --window-mode inactive (a hidden window has nothing for the window server to photograph)";
	if (capture === "screencapture" && process.platform !== "darwin")
		return "--capture screencapture exists only on macOS; use --capture capturepage (no vibrancy claim) elsewhere";
	return null;
}

/** Minimal XML plist reader for the two keys we need; no `plutil`, so Linux tests run it. */
export function readPlistString(xml, key) {
	const match = xml.match(
		new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`),
	);
	return match ? match[1] : null;
}

/**
 * The app path: absolute, a realpath'd `.app` bundle with an Info.plist naming
 * an executable that exists. A bare binary is refused: the bundle is what makes
 * the launch the shipped app rather than whatever binary was handed in.
 */
export function resolveAppBundle(appPath) {
	if (!appPath)
		throw new Refusal(
			"--app or --app-zip is required (an absolute path to a .app bundle, or to a release .zip)",
		);
	if (!isAbsolute(appPath))
		throw new Refusal(`--app must be an absolute path (got ${appPath})`);
	let real;
	try {
		real = realpathSync(appPath);
	} catch {
		throw new Refusal(`--app ${appPath} does not exist`);
	}
	if (!real.endsWith(".app") || !statSync(real).isDirectory())
		throw new Refusal(`--app must be a .app bundle directory (got ${real})`);
	const plist = join(real, "Contents", "Info.plist");
	if (!existsSync(plist))
		throw new Refusal(`--app ${real} has no Contents/Info.plist`);
	const xml = readFileSync(plist, "utf8");
	const executable = readPlistString(xml, "CFBundleExecutable");
	if (!executable || executable.includes("/"))
		throw new Refusal(`${plist} names no usable CFBundleExecutable`);
	const binary = join(real, "Contents", "MacOS", executable);
	if (!existsSync(binary))
		throw new Refusal(`the bundle's executable ${binary} does not exist`);
	return {
		path: appPath,
		realpath: real,
		executable: binary,
		version: readPlistString(xml, "CFBundleShortVersionString"),
		// `installed` only for the copy in /Applications; anything else (an
		// `electron-builder --dir` bundle of a PR branch) is a build of this tree.
		kind: real.startsWith("/Applications/") ? "installed" : "built",
	};
}

/*
 * ---------------------------------------------------------------------------
 * --app-zip: a RELEASE build, downloaded, extracted into the rig.
 *
 * WHY. The Mac leg must not build: a local `pnpm run pack` on a loaded Mac
 * (load ~120 measured on the requesting run) is the wrong shape, and a fresh
 * worktree has no node_modules to build with. Releases already ship the signed
 * `local-operator-ui-<ver>-<arch>.zip` electron-builder makes (a top-level
 * `.app`), so the Mac only downloads one and this extracts it into
 * `<rig>/app/`: never `/Applications`, never the operator's copy, removed after
 * a clean reap unless `--keep-rig`. Every `--app` guard then runs on the
 * extracted bundle, which is just another `.app` path.
 *
 * Extraction is `/usr/bin/ditto -x -k` on darwin (what electron-builder's own
 * `ditto -c -k` zips are made for: it restores the framework symlinks and
 * modes a code signature covers). Elsewhere - the Linux fake-tree tests only -
 * it is `unzip` from PATH, refused when absent; no hand-rolled zip reader, so
 * there is no second extraction semantics to keep in step.
 * ---------------------------------------------------------------------------
 */

/** The zip path itself: absolute, `.zip`, an existing regular file. */
export function appZipProblem(zipPath) {
	if (!isAbsolute(zipPath))
		return `--app-zip must be an absolute path (got ${zipPath})`;
	if (!zipPath.endsWith(".zip"))
		return `--app-zip must name a .zip file (got ${zipPath})`;
	let stat;
	try {
		stat = statSync(zipPath);
	} catch {
		return `--app-zip ${zipPath} does not exist`;
	}
	if (!stat.isFile())
		return `--app-zip must be a regular file (got ${zipPath})`;
	return null;
}

/** sha256 of a file in 1 MiB chunks: a release zip is ~180 MB (v0.57.3 arm64: 179,290,789 B), never one buffer. */
export function fileSha256(path) {
	const hash = createHash("sha256");
	const fd = openSync(path, "r");
	try {
		const chunk = Buffer.alloc(1 << 20);
		for (;;) {
			const n = readSync(fd, chunk, 0, chunk.length, null);
			if (n === 0) break;
			hash.update(chunk.subarray(0, n));
		}
	} finally {
		closeSync(fd);
	}
	return hash.digest("hex");
}

/** The ONE top-level `.app` directory of an extracted zip; 0 or >1 is refused. */
export function bundleInExtracted(dir) {
	const apps = readdirSync(dir).filter(
		(name) => name.endsWith(".app") && lstatSync(join(dir, name)).isDirectory(),
	);
	if (apps.length !== 1)
		throw new Refusal(
			`--app-zip must hold exactly one .app at its top level (found ${apps.length}${apps.length ? `: ${apps.join(", ")}` : ""})`,
		);
	return join(dir, apps[0]);
}

/**
 * Unpacked-size ceiling for `--app-zip` (#1936 QA r3 Q3-3). MEASURED: the
 * v0.57.3 arm64 release zip's central directory (read by HTTP range, 2026-11-16)
 * lists 2,356 entries totalling 427,528,786 B unpacked (the "~407 MB" codesign
 * hashes, in MiB) from a 179,290,789 B zip. 2 GiB is ~5x that: room for a few
 * releases of growth, while a zip bomb or a wrong file still stops before it
 * fills the disk the rig shares with everything else.
 */
export const APP_ZIP_UNPACKED_CAP_BYTES = 2 * 1024 ** 3;

/** An entry name a zip extractor could write outside its destination with. */
const UNSAFE_ZIP_NAME = /^(?:[\\/]|[A-Za-z]:)|(?:^|[\\/])\.\.(?:[\\/]|$)/;
/** zipinfo `-Zt`'s summary: `2356 files, 427528786 bytes uncompressed, ...`. */
const ZIPINFO_TOTALS = /(\d+) files?, (\d+) bytes uncompressed/;

/**
 * Read the zip's listing BEFORE anything is extracted (#1936 QA r3 Q3-2/Q3-3):
 * `ditto` and `unzip` differ in how they treat a `..` or absolute entry name
 * (unzip strips with a warning, ditto's handling is undocumented), so neither
 * extractor's semantics is relied on - any such entry refuses the zip, and so
 * does a listed unpacked total over the cap. Info-ZIP's `unzip -Z` (zipinfo) is
 * on every Mac at /usr/bin/unzip. A name holding a newline splits into two
 * listed lines, which can only ADD a refused segment, never hide one. The
 * listed sizes are the central directory's claim; a zip that lies about them
 * fails the extractor's own size/CRC checks.
 */
export function appZipListingProblem(
	zip,
	{
		platform = process.platform,
		timeoutMs,
		capBytes = APP_ZIP_UNPACKED_CAP_BYTES,
	},
) {
	const unzip =
		platform === "darwin" ? "/usr/bin/unzip" : resolveOnPath("unzip");
	if (!unzip)
		return "--app-zip needs `unzip` on PATH to list the zip before extracting it";
	const run = (args) =>
		spawnSync(unzip, args, {
			encoding: "utf8",
			timeout: Math.max(1000, timeoutMs),
			stdio: ["ignore", "pipe", "pipe"],
			env: cLocaleEnv(),
			maxBuffer: 64 * 1024 * 1024,
		});
	const names = run(["-Z1", zip]);
	if (names.status !== 0)
		return `could not list --app-zip: ${(names.error?.message ?? names.stderr ?? "").trim().slice(0, 400) || `exit ${names.status ?? names.signal}`}`;
	const unsafe = names.stdout
		.split("\n")
		.filter((name) => UNSAFE_ZIP_NAME.test(name));
	if (unsafe.length > 0)
		return `--app-zip holds ${unsafe.length} entr${unsafe.length === 1 ? "y" : "ies"} with an absolute path or a .. segment (${unsafe
			.slice(0, 3)
			.map((n) => JSON.stringify(n))
			.join(", ")}); refused before extraction`;
	const totals = run(["-Zt", zip]);
	const m = (totals.stdout ?? "").match(ZIPINFO_TOTALS);
	if (totals.status !== 0 || !m)
		return `could not read --app-zip's unpacked size: ${(totals.stderr ?? totals.stdout ?? "").trim().slice(0, 400)}`;
	if (Number(m[2]) > capBytes)
		return `--app-zip unpacks to ${m[2]} B, over the ${capBytes} B cap (a real release is ~428 MB); refused before extraction`;
	return null;
}

/** Extract with the platform's tool; `timeoutMs` is what is left of --timeout. */
export function extractAppZip(
	zip,
	dest,
	{ platform = process.platform, timeoutMs },
) {
	let command;
	let argv;
	if (platform === "darwin") {
		command = "/usr/bin/ditto";
		argv = ["-x", "-k", zip, dest];
	} else {
		command = resolveOnPath("unzip");
		if (!command)
			throw new Refusal(
				"--app-zip needs `unzip` on PATH on this platform (darwin uses /usr/bin/ditto)",
			);
		argv = ["-q", zip, "-d", dest];
	}
	const listed = appZipListingProblem(zip, { platform, timeoutMs });
	if (listed) throw new Refusal(listed);
	mkdirSync(dest, { recursive: true });
	const result = spawnSync(command, argv, {
		encoding: "utf8",
		timeout: Math.max(1000, timeoutMs),
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0)
		throw new Refusal(
			`could not extract --app-zip with ${command}: ${(result.error?.message ?? result.stderr ?? "").trim().slice(0, 400) || `exit ${result.status ?? result.signal}`}`,
		);
}

/**
 * The informational codesign's own bound (review r3 R3-2). It hashes ~407 MB
 * (`--deep`) on a Mac measured at load ~120, and used to get the WHOLE remaining
 * --timeout, so a check that gates nothing could end the capture. NO MAC TIMING
 * EXISTS YET: 60 s is the reviewer's figure, not a measured bound. It is safe
 * to be wrong in one direction only, which is why it is acceptable unmeasured:
 * a timeout records `timedOut: true` and costs only that information, never a
 * frame or a verdict. `durationMs` is recorded on every run so the first Mac
 * receipts give the distribution to set it from.
 */
export const CODESIGN_CAP_MS = 60_000;

/**
 * `codesign --verify --deep --strict`, recorded for the reviewer and never
 * gating: verify reads the bundle and its embedded signature only (no keychain,
 * so no prompt), and an unsigned or ad-hoc PR artifact is still a frame of that
 * artifact. Not run off darwin. Bounded by the smaller of what is left of
 * --timeout and `CODESIGN_CAP_MS`.
 */
export function codesignVerdict(
	appPath,
	{ platform = process.platform, timeoutMs, capMs = CODESIGN_CAP_MS },
) {
	if (platform !== "darwin") return { ran: false, reason: "not darwin" };
	const bound = Math.max(1000, Math.min(timeoutMs, capMs));
	const started = Date.now();
	const result = spawnSync(
		"/usr/bin/codesign",
		["--verify", "--deep", "--strict", appPath],
		{
			encoding: "utf8",
			timeout: bound,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	return {
		ran: true,
		valid: result.status === 0,
		status: result.status,
		durationMs: Date.now() - started,
		boundMs: bound,
		timedOut: result.error?.code === "ETIMEDOUT",
		detail: (result.error?.message ?? result.stderr ?? "").trim().slice(0, 600),
	};
}

/**
 * Every path the launch reads must resolve INSIDE the extracted bundle (review
 * r3 R3-1, QA r3 Q3-1). Only the top-level `.app` was lstat-checked, so a zip
 * whose `X.app/Contents` was a symlink to another bundle ran THAT bundle's
 * binary under `kind: "release-zip"` and a rig path in the receipt. Not a
 * privilege boundary (launching any zip runs its code); a labelling one: the
 * receipt must name the bytes that ran, so such a zip is refused.
 */
export function extractedContainmentProblem(app, dest) {
	const inside = (child, parent) =>
		child === parent || child.startsWith(`${parent}${sep}`);
	let root;
	let bundle;
	try {
		root = realpathSync(dest);
		bundle = realpathSync(app.realpath);
	} catch (error) {
		return `the extracted bundle does not resolve (${error.message})`;
	}
	if (!inside(bundle, root))
		return `--app-zip's bundle resolves outside ${root} (${bundle}); refused`;
	for (const [what, path] of [
		["Info.plist", join(app.realpath, "Contents", "Info.plist")],
		["executable", app.executable],
	]) {
		let real;
		try {
			real = realpathSync(path);
		} catch (error) {
			return `--app-zip's ${what} ${path} does not resolve (${error.message})`;
		}
		if (!inside(real, bundle))
			return `--app-zip's ${what} resolves outside the extracted bundle (${path} -> ${real}); refused: the receipt would name a binary that did not run`;
	}
	return null;
}

/**
 * Every symlink in the extracted tree must resolve inside it (review r1 R1-3).
 * `extractedContainmentProblem` checks the two paths the launch names; Electron
 * also loads `Contents/Resources/app.asar` and `Contents/Frameworks/*`, and a
 * link from either into another installed app would run THAT code under
 * `kind: "release-zip"`. One walk, never following a link (lstat), resolving
 * each with realpath. A dangling link is refused too: it cannot be shown to
 * stay inside. The real release passes: its 20 links (4 framework
 * `Versions/Current -> A`, 10 framework top-level `-> Versions/Current/...`,
 * 6 python-runtime-seed `python3 -> python3.14`-style) are all relative and
 * all inside the bundle (v0.57.3 arm64 central directory, read 2026-11-16).
 */
export function extractedSymlinkProblem(dest) {
	let root;
	try {
		root = realpathSync(dest);
	} catch (error) {
		return `the extracted tree does not resolve (${error.message})`;
	}
	const inside = (child) => child === root || child.startsWith(`${root}${sep}`);
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop();
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				let real;
				try {
					real = realpathSync(path);
				} catch (error) {
					return `--app-zip's symlink ${path} does not resolve (${error.code ?? error.message}); refused: it cannot be shown to stay inside the extracted tree`;
				}
				if (!inside(real))
					return `--app-zip's symlink ${path} resolves outside the extracted tree (-> ${real}); refused: the receipt would name code that did not run`;
			} else if (entry.isDirectory()) stack.push(path);
		}
	}
	return null;
}

/** `com.apple.quarantine` on `path`: `{value}` (null = absent) or `{unreadable}`. */
export function readQuarantine(path) {
	const result = spawnSync(
		"/usr/bin/xattr",
		["-p", "com.apple.quarantine", path],
		{ encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] },
	);
	if (result.error || result.status === null)
		return { unreadable: result.error?.message ?? "timed out" };
	return { value: result.status === 0 ? result.stdout.trim() || "set" : null };
}

/**
 * Refuse a quarantined zip or bundle (review r3 R3-3). `ditto -x -k` carries
 * `com.apple.quarantine` from a BROWSER-downloaded zip onto every extracted
 * file, and launching that puts Gatekeeper's first-open dialog on the
 * operator's screen: a window and a human step, the two things this harness
 * exists to avoid. `gh release download` and curl do not set it. Refused, not
 * cleared: stripping the attribute is the operator's call about that file.
 * Unreadable refuses too (unknown is not clean). darwin only.
 */
export function quarantineProblem(
	path,
	{ platform = process.platform, read = readQuarantine } = {},
) {
	if (platform !== "darwin") return null;
	const found = read(path);
	if (found.unreadable)
		return `could not read com.apple.quarantine on ${path} (${found.unreadable}); refused rather than risk Gatekeeper's first-open dialog`;
	if (found.value)
		return `${path} carries com.apple.quarantine (${found.value}), as a browser download does; launching it would show Gatekeeper's first-open dialog. Download it with \`gh release download\` or curl (docs/mac-proof-capture.md), or clear it yourself: xattr -d com.apple.quarantine <zip>`;
	return null;
}

/**
 * Extract `--app-zip` into `<rig>/app` and resolve the bundle through the same
 * guards as `--app`, plus the operator-root check on the extracted path, the
 * containment and quarantine checks, and a hash of the bytes as extracted.
 */
export function releaseZipApp(
	zipInfo,
	rig,
	{
		roots,
		timeoutMs,
		platform = process.platform,
		quarantine = readQuarantine,
	},
) {
	const dest = join(rig, "app");
	// Hashed HERE, right before extraction (review r3 R3-5): preflight's hash is
	// of a file that could be replaced before `ditto` reads it, and the receipt
	// must name the zip that ran. A change in between is refused, not relabelled.
	const sha256 = fileSha256(zipInfo.path);
	if (zipInfo.sha256 && sha256 !== zipInfo.sha256)
		throw new Refusal(
			`--app-zip changed between preflight and extraction (sha256 ${zipInfo.sha256} -> ${sha256}); refused`,
		);
	extractAppZip(zipInfo.path, dest, { platform, timeoutMs });
	const bundle = bundleInExtracted(dest);
	const problem = operatorPathProblem("--app-zip bundle", bundle, roots);
	if (problem) throw new Refusal(problem);
	const app = resolveAppBundle(bundle);
	const escaped =
		extractedContainmentProblem(app, dest) ?? extractedSymlinkProblem(dest);
	if (escaped) throw new Refusal(escaped);
	const quarantined = quarantineProblem(app.realpath, {
		platform,
		read: quarantine,
	});
	if (quarantined) throw new Refusal(quarantined);
	return {
		...app,
		kind: "release-zip",
		zip: { ...zipInfo, sha256, hashedAt: "extraction" },
		codesign: codesignVerdict(app.realpath, { platform, timeoutMs }),
	};
}

/**
 * A build without the S1 step runner (any release before it shipped) prints
 * `[window-mode]` and maybe `[dev-driver] ARMED`, then sits idle until
 * --timeout. Detect it inside the SAME startup window the `[window-mode]`
 * check already uses: a build WITH S1 prints `[dev-driver-script] ARMED` from
 * main-module load (`src/main/index.ts`, top level), before `app.whenReady`
 * prints `[window-mode]`, so it always lands inside that window.
 */
export const STARTUP_WINDOW_MS = 20_000;

/*
 * WHY A WINDOW WAIT BEFORE THE FIRST SCENE (79's first default-mode Mac run,
 * installed 0.59.2, harness 00e18cd6: `the window is not visible at the shutter
 * (SHUTTER label=conversation-dark media=window:7139:0 visible=false
 * focused=false ...)`, 0 frames, every DOM step ok).
 *
 * The harness passes `--open-session`, and a window created to show a specific
 * conversation HOLDS its first present (src/main/index.ts:1252,
 * `holdPresentUntilConversation`) until the renderer reports that conversation
 * is up, or `CONVERSATION_PAINT_FALLBACK_MS = 3_000` (src/main/index.ts:2347)
 * after the window was created. The readiness steps finish inside that hold, so
 * the first SHUTTER reported `window.isVisible()` false (`windowFacts`,
 * src/main/index.ts:1775) and the guard below rightly refused it.
 *
 * The app has no shutter-free probe verb for its window facts (the shipped verbs
 * are DEV_DRIVER_SCRIPT_VERBS in src/main/dev-driver-script.ts, and `state`'s
 * `visibilityState` is not `isVisible()`), and the step list is read once at
 * launch, so the harness cannot poll mid-run. It therefore spends ONE bounded,
 * honest wait in the app's own runner before the first scene: a `waitFor` on a
 * selector that never matches (`:not(*)`), marked optional so its expected
 * timeout reads `skipped (optional)` instead of failing the run. Nothing here
 * shows, focuses or activates the window - the app presents it on its own
 * schedule - and the per-SHUTTER `visible=true` / `focused=false` guard is
 * unchanged: a window still hidden after the wait fails the run naming the wait.
 *
 * 6 s default = 2x the 3 s fallback bound, which is a code constant (not a
 * measured distribution); 15 s max keeps the wait well inside --timeout (180 s
 * default) and the app's 300 s script cap. 0 disables it (the pre-fix behaviour).
 * capturepage runs are headless and never visible, so they get no wait.
 */
export const WINDOW_WAIT_DEFAULT_S = 6;
export const WINDOW_WAIT_MAX_S = 15;
/** Matches no element, ever: the wait step can only end by its own bound. */
export const WINDOW_WAIT_SELECTOR = ":not(*)";

/** The runner step that spends the window wait, or null when none is due. */
export function windowWaitStep({ capture, windowWaitS }) {
	if (capture !== "screencapture" || !(windowWaitS > 0)) return null;
	const ms = Math.round(windowWaitS * 1000);
	return {
		verb: "waitFor",
		payload: { selector: WINDOW_WAIT_SELECTOR, timeoutMs: ms },
		// Above the verb's own bound, so the step ends by the verb's timeout
		// (100 ms polls in install.ts `waitFor`), not the runner's.
		timeoutMs: ms + 5000,
		optional: true,
	};
}
export function startupProblem(state, elapsedMs) {
	if (elapsedMs <= STARTUP_WINDOW_MS) return null;
	if (!state.windowModeLine)
		return `the app printed no [window-mode] line within ${STARTUP_WINDOW_MS / 1000} s`;
	if (!state.scriptArmed)
		return `no [dev-driver-script] ARMED line within ${STARTUP_WINDOW_MS / 1000} s: this build predates the step runner (S1). An --app-zip must come from a release that contains S1-S3 (the first release after PR #1936 merged); an --app build must be of a branch that contains them`;
	return null;
}

/** `http:` loopback origin only; isolated backends never use the operator's port. */
export function backendUrlProblem(url, { isolated }) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return `backend URL ${url} is not a URL`;
	}
	if (parsed.protocol !== "http:")
		return `backend URL must be http: (got ${parsed.protocol})`;
	if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
		return `backend URL must be loopback (got ${parsed.hostname})`;
	if (parsed.username || parsed.password)
		return "backend URL must carry no credentials";
	if (parsed.pathname !== "/" || parsed.search || parsed.hash)
		return "backend URL must be an origin with no path, query or fragment";
	if (!parsed.port) return "backend URL must name a port";
	if (isolated && Number(parsed.port) === OPERATOR_PORT)
		return `an isolated backend never uses port ${OPERATOR_PORT} (the operator's daemon)`;
	return null;
}

/**
 * Credential material a seed template must not carry, as path-segment rules.
 * Derived from the core config root's layout (`~/.local-operator`, core
 * @ ~/local-operator): `secrets/` and `vault/` (secret stores), `credentials*`
 * (provider credentials; also `network/credentials`), `identity` (mesh device
 * identity, `network/identity`), `auth.db*` and `auth*.json` (auth store and
 * OAuth caches), `account.json` (Radient account), `create-keys.json` (mesh
 * create keys), `mcp_oauth*` (MCP OAuth refresh state), any `*token*` (the
 * desktop token among them), and key files (`*.key`, `*.pem`, `.env`). A
 * template is SYNTHETIC by contract; a match means someone pointed it at a real
 * profile, and the run refuses rather than copy a credential into a rig.
 */
export const CREDENTIAL_SEGMENTS = Object.freeze([
	/^secrets$/i,
	/^vault$/i,
	/^credentials/i,
	/^identity/i,
	/^auth.*\.json$/i,
	/^auth\.db/i,
	/^account\.json$/i,
	/^create-keys\.json$/i,
	/^mcp_oauth/i,
	/token/i,
	/\.key$/i,
	/\.pem$/i,
	/^\.env/i,
]);

/** Every relative path under `dir` whose segment matches a credential rule. Symlinks refuse too. */
export function credentialMaterial(dir) {
	const found = [];
	const walk = (abs, rel) => {
		for (const entry of readdirSync(abs)) {
			const childAbs = join(abs, entry);
			const childRel = rel ? `${rel}/${entry}` : entry;
			const stat = lstatSync(childAbs);
			if (stat.isSymbolicLink()) {
				found.push(`${childRel} (symlink)`);
				continue;
			}
			if (CREDENTIAL_SEGMENTS.some((rule) => rule.test(entry))) {
				found.push(childRel);
				continue;
			}
			if (stat.isDirectory()) walk(childAbs, childRel);
		}
	};
	walk(dir, "");
	return found;
}

/*
 * ---------------------------------------------------------------------------
 * Attach mode: the token comes from the daemon's own serve record.
 * ---------------------------------------------------------------------------
 */

/** The exact BLOCKED sentence for an app-spawned (env-governed) daemon (design §1.3). */
export function envGovernedBlockedMessage(port) {
	return [
		`BLOCKED: the daemon on :${port} is governed by the desktop app's env token`,
		'(its serve record publishes claim_key "", core server/registry.py:498).',
		"Its only copy is in the operator's profile (desktop-token,",
		"src/main/backend/backend-service.ts:241/4391), which this harness will not read.",
		"Restart the daemon as `lop serve`, use --backend isolated or --backend-config-root,",
		"or, with the operator's explicit approval, --token-from-operator-profile.",
	].join(" ");
}

/**
 * Pick the record for `port` and return its claim key. Never claims: an
 * unclaimed daemon is refused because the only way to use it would be a claim,
 * which is a one-way, durable change to the operator's plane.
 *
 * `isAlive(pid)` is injected so tests can model a dead record.
 */
export function selectServeRecord(records, port, isAlive = pidAlive) {
	const forPort = records.filter(
		(record) =>
			Number(record?.port) === Number(port) && isAlive(Number(record?.pid)),
	);
	if (forPort.length === 0)
		return {
			kind: "refused",
			message: `no live serve record for port ${port}; is a daemon running there?`,
		};
	const record = forPort[0];
	if (record.desktop !== true)
		return {
			kind: "refused",
			message: `the daemon on :${port} has not been claimed by a desktop app (desktop=false); this harness never claims a plane`,
		};
	if (typeof record.claim_key !== "string" || record.claim_key === "")
		return { kind: "blocked", message: envGovernedBlockedMessage(port) };
	return { kind: "token", token: record.claim_key, pid: Number(record.pid) };
}

export function readServeRecords(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => {
			try {
				return {
					...JSON.parse(readFileSync(join(dir, name), "utf8")),
					_file: name,
				};
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

export function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/** The app's own userData path for the operator's profile (backend-service.ts:241/4391). */
export function operatorDesktopTokenPath({
	home = os.userInfo().homedir,
	platform = process.platform,
	names = appNames(),
} = {}) {
	const base =
		platform === "darwin"
			? join(home, "Library", "Application Support")
			: process.env.XDG_CONFIG_HOME || join(home, ".config");
	return join(base, names.productName, "desktop-token");
}

/*
 * ---------------------------------------------------------------------------
 * Argument parsing.
 * ---------------------------------------------------------------------------
 */

export const USAGE = `node scripts/mac-proof-capture.mjs (--app <abs .app> | --app-zip <abs .zip>) --out <abs dir> [options]

Captures every --scene x --theme of the real app in ONE inactive launch.

  --app <abs path>             the .app bundle (installed or electron-builder --dir build)
  --app-zip <abs path>         instead of --app: a release local-operator-ui-<ver>-<arch>.zip,
                               extracted into <rig>/app (ditto on darwin, unzip elsewhere);
                               needs a release that contains the step runner (S1-S3)
  --keep-rig                   keep the extracted --app-zip bundle after the run (default:
                               removed once the reap is clean)
  --out <abs dir>              where frames + receipt.json go (outside any operator root)
  --session <12 hex>           conversation to open (--open-session); needed by files/canvas
  --scene <name>               repeatable: ${SCENES.join(", ")} (default: conversation)
  --theme dark,light           themes to capture, comma separated (default: dark,light)
  --capture <mode>             screencapture (darwin default, "real vibrancy, pending Mac measurement") |
                               capturepage (elsewhere, "no vibrancy claim")
  --window-mode <mode>         inactive (default for screencapture) | headless (capturepage only)
  --size WxH                   window size (default 1380x900)
  --window-wait <s>            screencapture only: bounded wait before the first scene so the
                               app's conversation-paint hold (3 s) releases the window first
                               (default ${WINDOW_WAIT_DEFAULT_S}, max ${WINDOW_WAIT_MAX_S}, 0 = none); it never shows or focuses it
  --timeout <s>                whole-run bound from harness start (default 180, max 290);
                               the reap runs after it. SIGKILL cannot be caught: run this
                               as a background job or with a caller timeout >= --timeout + 60
  --rig-root <abs dir>         where the scratch rig is made (default $LOCAL_OPERATOR_SCRATCHPAD or tmp)

Backend (the app only ever ATTACHES; it never spawns, installs or claims):
  --backend isolated           DEFAULT. Start our own \`lop serve\` on a free loopback port
                               (never ${OPERATOR_PORT}) with a scratch HOME/config root and a
                               token minted here; reaped by exact process group.
    --lop <abs path>           the lop executable (default: \`lop\` on PATH, made absolute)
    --seed-config <abs dir>    copy a SYNTHETIC config-root template in first (refused if it
                               carries credential material)
    --seed <scenario>          instead of --seed-config: generate one of ${SEED_SCENARIOS.join(", ")}
                               (scripts/mac-proof-seed.mjs) into the rig just before serve
                               starts, copy it in the same way, and BLOCK (exit 3) unless the
                               daemon reads the seeded rows back. Defaults --session (and
                               --notification-id) to the seed's own ids
  --notification-id <n_...>    the item the notification-detail and update-detail scenes open
  --preview-file <name>        the --session Files row the file-preview scene shows in the canvas
                               (default ${PREVIEW_FILE_DEFAULT}); the receipt proves it is a PEER row
  --download-file <name>       --scene download (config-root only, one --theme): the Files row
                               to download (default ${DOWNLOAD_FILE_DEFAULT}); one per run
  --manifest <abs json>        --scene download: {files:[{filename,bytes,sha256}]}; the landed
                               file must match the --download-file entry (refused if absent)
  --check-operator-downloads   --scene download, OFF by default: also compare a names-only listing
                               of the operator's real ~/Downloads before/after (exit 3 if it cannot
                               be listed). Off because on macOS that listing can raise a TCC
                               "Files and Folders" prompt; containment is proven by destination
  --backend-config-root <dir>  as isolated, but serve runs on this durable config root the
                               operator prepared (e.g. a rig device joined to the mesh).
                               Refused if it is ~/.local-operator or inside it, if another
                               process already runs on it, or if <root>/config.yml has no
                               network.port (or 4097, the operator's relay). Starts the rig's
                               relay (\`lop network serve --port <network.port>\`) first,
                               then \`lop serve\`, then waits for --session as a remote row.
    --backend-home <abs dir>   HOME for those lop processes (default <dirname(root)>/home;
                               never the operator's real home)
    --peer-wait <s>            bound on waiting for the remote row (default 120)
  --backend attach --backend-url http://127.0.0.1:<port>
                               attach to a running daemon; the token is read ONLY from that
                               daemon's serve-record claim_key. An app-spawned (env-governed)
                               daemon is BLOCKED; an unclaimed one is refused (never claimed).
    --serve-record-dir <dir>   where to read serve records (default ~/.local-operator/run/serve)
    --token-from-operator-profile
                               OFF by default. NEEDS THE OPERATOR'S EXPLICIT APPROVAL: reads the
                               0600 desktop-token from the operator's app profile straight into
                               the app's environment (never printed, written or logged).

  --dry-run                    print plan, argv and env (token redacted); spawn nothing
  --negative-control           run every refusal case against the real guards; exit 0 only if
                               all refuse
  --help`;

export function parseArgs(argv) {
	const opts = {
		app: null,
		appZip: null,
		keepRig: false,
		out: null,
		session: null,
		scenes: [],
		themes: ["dark", "light"],
		capture: process.platform === "darwin" ? "screencapture" : "capturepage",
		windowMode: null,
		size: "1380x900",
		windowWaitS: WINDOW_WAIT_DEFAULT_S,
		timeoutS: 180,
		rigRoot: null,
		backend: "isolated",
		backendUrl: null,
		backendConfigRoot: null,
		backendHome: null,
		peerWaitS: 120,
		lop: null,
		seedConfig: null,
		seed: null,
		notificationId: null,
		previewFile: PREVIEW_FILE_DEFAULT,
		downloadFile: null,
		manifest: null,
		checkOperatorDownloads: false,
		serveRecordDir: null,
		tokenFromOperatorProfile: false,
		dryRun: false,
		negativeControl: false,
		help: false,
	};
	const value = (i, flag) => {
		const v = argv[i + 1];
		if (v === undefined || v.startsWith("--"))
			throw new Refusal(`${flag} needs a value`);
		return v;
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const eq = arg.indexOf("=");
		const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
		const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : null;
		const take = () => {
			if (inline !== null) return inline;
			const v = value(i, flag);
			i++;
			return v;
		};
		switch (flag) {
			case "--app":
				opts.app = take();
				break;
			case "--app-zip":
				opts.appZip = take();
				break;
			case "--keep-rig":
				opts.keepRig = true;
				break;
			case "--out":
				opts.out = take();
				break;
			case "--session":
				opts.session = take();
				break;
			case "--scene":
				opts.scenes.push(take());
				break;
			case "--theme":
			case "--themes":
				opts.themes = take()
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);
				break;
			case "--capture":
				opts.capture = take();
				break;
			case "--window-mode":
				opts.windowMode = take();
				break;
			case "--size":
				opts.size = take();
				break;
			case "--window-wait":
				opts.windowWaitS = Number(take());
				break;
			case "--timeout":
				opts.timeoutS = Number(take());
				break;
			case "--rig-root":
				opts.rigRoot = take();
				break;
			case "--backend":
				opts.backend = take();
				break;
			case "--backend-url":
				opts.backendUrl = take();
				break;
			case "--backend-config-root":
				opts.backendConfigRoot = take();
				break;
			case "--backend-home":
				opts.backendHome = take();
				break;
			case "--peer-wait":
				opts.peerWaitS = Number(take());
				break;
			case "--lop":
				opts.lop = take();
				break;
			case "--seed-config":
				opts.seedConfig = take();
				break;
			case "--seed":
				opts.seed = take();
				break;
			case "--notification-id":
				opts.notificationId = take();
				break;
			case "--preview-file":
				opts.previewFile = take();
				break;
			case "--serve-record-dir":
				opts.serveRecordDir = take();
				break;
			case "--download-file":
				// One file per run: the authorisation covers one, never both.
				if (opts.downloadFile !== null)
					throw new Refusal(
						"--download-file is given more than once (one file per run)",
					);
				opts.downloadFile = take();
				break;
			case "--manifest":
				opts.manifest = take();
				break;
			case "--check-operator-downloads":
				opts.checkOperatorDownloads = true;
				break;
			case "--token-from-operator-profile":
				opts.tokenFromOperatorProfile = true;
				break;
			case "--dry-run":
				opts.dryRun = true;
				break;
			case "--negative-control":
				opts.negativeControl = true;
				break;
			case "--help":
			case "-h":
				opts.help = true;
				break;
			default:
				throw new Refusal(`unknown argument ${arg}`);
		}
	}
	if (opts.scenes.length === 0) opts.scenes = ["conversation"];
	if (opts.backendConfigRoot && opts.backend === "isolated")
		opts.backend = "config-root";
	opts.windowMode ??= opts.capture === "capturepage" ? "headless" : "inactive";
	applySeedDefaults(opts);
	return opts;
}

/**
 * A --seed names the conversation and item it staged, so the scenes that need
 * them default to the seed's own ids: a mistyped --session would otherwise open
 * a conversation that does not exist and photograph its empty state. An explicit
 * flag still wins (and the post-start check reads the SEED's rows either way).
 * An unknown scenario is left for `validateOptions` to refuse.
 */
function applySeedDefaults(opts) {
	if (opts.seed === null || !SEED_SCENARIOS.includes(opts.seed)) return;
	const spec = loadSeedSpec(opts.seed);
	opts.session ??= spec.session.id;
	if (spec.detailId) opts.notificationId ??= spec.detailId;
}

/**
 * The download scene's flag refusals (the harness's one write; see
 * downloadSceneSteps). Before anything else of the run can be spawned:
 * - config-root only: `attach` would land the file in the operator's real
 *   ~/Downloads (its daemon runs as the operator), `isolated` has no peer;
 * - one theme: the file lands once. A second theme's press would reach a
 *   backend that reuses the identical file (`created: false`), so the app
 *   shows its "already downloaded" success toast (remote-file-transfer.tsx,
 *   ui.canvas.files.remoteAlreadyDownloaded), not a second download - that
 *   frame would show a different toast from the first, and land nothing;
 * - --download-file / --manifest only with the scene, and a plain file name.
 */
function downloadOptionsProblem(opts) {
	const download = opts.scenes.includes("download");
	if (!download) {
		if (
			opts.downloadFile !== null ||
			opts.manifest !== null ||
			opts.checkOperatorDownloads
		)
			throw new Refusal(
				"--download-file, --manifest and --check-operator-downloads apply only to --scene download",
			);
		return;
	}
	if (opts.backend !== "config-root")
		throw new Refusal(
			opts.backend === "attach"
				? "--scene download refuses --backend attach: that daemon runs as the operator, so the file would land in the operator's real ~/Downloads; use --backend-config-root (the rig's own HOME)"
				: `--scene download needs --backend-config-root (the download route lands a PEER's row, and only that mode's HOME keeps it inside the rig; got --backend ${opts.backend})`,
		);
	if (opts.themes.length !== 1)
		throw new Refusal(
			'--scene download takes exactly one --theme (it downloads once; a second theme would show the app\'s "already downloaded" toast for the reused file, not a download)',
		);
	const nameProblem = downloadFileProblem(
		opts.downloadFile ?? DOWNLOAD_FILE_DEFAULT,
	);
	if (nameProblem) throw new Refusal(nameProblem);
}

/** Every refusal that needs no filesystem state beyond the flags themselves. */
/** --peer-wait was given explicitly (its default must not trip the mode check). */
function argvHasPeerWait(opts) {
	return opts.peerWaitS !== 120;
}

export function validateOptions(opts) {
	// First (QA r1 Q1-1): a valid --seed supplies --session, so with an unknown
	// one the scene prerequisites below would name the knock-on ("needs
	// --session") instead of the cause.
	if (opts.seed !== null && !SEED_SCENARIOS.includes(opts.seed))
		throw new Refusal(
			`unknown --seed ${opts.seed} (have: ${SEED_SCENARIOS.join(", ")})`,
		);
	for (const scene of opts.scenes)
		if (!SCENES.includes(scene))
			throw new Refusal(
				`unknown --scene ${scene} (have: ${SCENES.join(", ")})`,
			);
	if (new Set(opts.scenes).size !== opts.scenes.length)
		throw new Refusal("a --scene is repeated");
	if (opts.app !== null && opts.appZip !== null)
		throw new Refusal("--app and --app-zip are mutually exclusive");
	if (opts.themes.length === 0) throw new Refusal("--theme names no theme");
	// Own properties only: `theme in THEMES` accepted `constructor` and other
	// prototype keys (review r1 R1-7). A repeat is refused here, before launch,
	// rather than by the app's duplicate-label check after a window is up.
	for (const theme of opts.themes)
		if (!Object.hasOwn(THEMES, theme))
			throw new Refusal(`unknown --theme ${theme} (have: dark, light)`);
	if (new Set(opts.themes).size !== opts.themes.length)
		throw new Refusal("a --theme is repeated");
	if (opts.session !== null && !SESSION_ID.test(opts.session))
		throw new Refusal(
			`--session must be 12 lowercase hex characters (got ${opts.session})`,
		);
	if (
		opts.session === null &&
		opts.scenes.some(
			(s) =>
				s === "files" ||
				s === "canvas" ||
				s === "file-preview" ||
				s === "asks" ||
				s === "update-detail" ||
				s === "download",
		)
	)
		throw new Refusal(
			"the files, canvas, file-preview, asks, download and update-detail scenes need --session (the canvas, the asks and the drawer's updates belong to a conversation)",
		);
	if (opts.scenes.includes("file-preview")) {
		const problem = previewFileProblem(opts.previewFile);
		if (problem) throw new Refusal(problem);
	}
	downloadOptionsProblem(opts);
	if (opts.seed !== null && opts.seedConfig !== null)
		throw new Refusal(
			"--seed and --seed-config are alternatives (one generates the template, the other copies yours)",
		);
	if (opts.seed !== null && opts.backend !== "isolated")
		throw new Refusal(
			"--seed applies only to the isolated backend (it writes the rig's own scratch config root)",
		);
	if (
		opts.notificationId !== null &&
		!NOTIFICATION_ID.test(opts.notificationId)
	)
		throw new Refusal(
			`--notification-id must be n_ + 16 of [a-z2-7] (core desktop_notifications.py:69; got ${opts.notificationId})`,
		);
	if (
		opts.notificationId === null &&
		opts.scenes.some(
			(s) => s === "notification-detail" || s === "update-detail",
		)
	)
		throw new Refusal(
			"the notification-detail and update-detail scenes need --notification-id (or --seed notification-details)",
		);
	const mode = windowModeProblem(opts.windowMode);
	if (mode) throw new Refusal(mode);
	const capture = captureModeProblem(opts.capture, opts.windowMode);
	if (capture) throw new Refusal(capture);
	if (!/^\d{3,4}x\d{3,4}$/.test(opts.size))
		throw new Refusal(`--size must be WxH (got ${opts.size})`);
	if (
		!Number.isFinite(opts.windowWaitS) ||
		opts.windowWaitS < 0 ||
		opts.windowWaitS > WINDOW_WAIT_MAX_S
	)
		throw new Refusal(
			`--window-wait must be between 0 and ${WINDOW_WAIT_MAX_S} seconds (got ${opts.windowWaitS})`,
		);
	if (
		!Number.isFinite(opts.timeoutS) ||
		opts.timeoutS <= 0 ||
		opts.timeoutS > 290
	)
		// Below the app's own 300 s script cap, so the harness always gives up first.
		throw new Refusal("--timeout must be between 1 and 290 seconds");
	if (!["isolated", "attach", "config-root"].includes(opts.backend))
		throw new Refusal(
			`--backend must be isolated, attach or config-root (got ${opts.backend})`,
		);
	// Without this, `join(null, "config.yml")` surfaced later as a TypeError
	// worded like a refusal (review r1 R1-8).
	if (opts.backend === "config-root" && !opts.backendConfigRoot)
		throw new Refusal(
			"--backend config-root needs --backend-config-root <abs dir> (the durable root the operator prepared)",
		);
	if (opts.backend === "attach") {
		if (!opts.backendUrl)
			throw new Refusal("--backend attach needs --backend-url");
		const problem = backendUrlProblem(opts.backendUrl, { isolated: false });
		if (problem) throw new Refusal(problem);
		if (opts.seedConfig || opts.lop || opts.backendConfigRoot)
			throw new Refusal(
				"--seed-config, --lop and --backend-config-root do not apply to --backend attach",
			);
	} else {
		if (opts.backendUrl)
			throw new Refusal("--backend-url applies only to --backend attach");
		if (opts.tokenFromOperatorProfile)
			throw new Refusal(
				"--token-from-operator-profile is valid only with --backend attach",
			);
		if (opts.serveRecordDir)
			throw new Refusal("--serve-record-dir applies only to --backend attach");
	}
	if (
		opts.backend !== "config-root" &&
		(opts.backendHome || argvHasPeerWait(opts))
	)
		throw new Refusal(
			"--backend-home and --peer-wait apply only to --backend-config-root",
		);
	if (
		!Number.isFinite(opts.peerWaitS) ||
		opts.peerWaitS <= 0 ||
		opts.peerWaitS > 600
	)
		throw new Refusal("--peer-wait must be between 1 and 600 seconds");
	if (opts.backend === "config-root" && opts.seedConfig)
		throw new Refusal(
			"--seed-config cannot be combined with --backend-config-root (that root is durable and the operator's to prepare)",
		);
	for (const [flag, path] of [
		["--app-zip", opts.appZip],
		["--out", opts.out],
		["--rig-root", opts.rigRoot],
		["--lop", opts.lop],
		["--seed-config", opts.seedConfig],
		["--backend-config-root", opts.backendConfigRoot],
		["--backend-home", opts.backendHome],
		["--serve-record-dir", opts.serveRecordDir],
		["--manifest", opts.manifest],
	])
		if (path !== null && !isAbsolute(path))
			throw new Refusal(`${flag} must be an absolute path (got ${path})`);
	if (!opts.out) throw new Refusal("--out is required (an absolute directory)");
}

/*
 * ---------------------------------------------------------------------------
 * The plan: steps, environment and argv. Pure, so --dry-run and the tests see
 * exactly what a real run would spawn.
 * ---------------------------------------------------------------------------
 */

/**
 * The positive "this scene is on screen" selector for the scenes that are only
 * a route. WHY (run #1907, measured): with no wait after `navigate`, the
 * `notifications` shutter fired while the previous scene's detail pane was
 * still painted - `notifications-light.png` had the same sha256 (cbbbcdc5...) as
 * `notification-detail-light.png`. `navigate` only waits for the hash route,
 * not for React to repaint, so each scene waits for markup that exists ONLY in
 * its target state.
 *
 * CONSTRAINT: the installed app may be an older release, so these use only the
 * shipped `waitFor` (selector + timeoutMs; `document.querySelector`, renderer
 * dev-driver/install.ts at v0.59.2) and attributes present at v0.59.2:
 * - notifications: the page (`data-notifications-page`) WITHOUT a detail pane
 *   inside it (`data-notification-detail`, notification-detail.tsx), holding
 *   either the loaded list (`data-notifications-list`) or its empty state
 *   (`data-notifications-empty`) - so neither the skeleton nor a detail frame
 *   can take the shot. The "Select a notification" placeholder has no stable
 *   attribute at v0.59.2, so it is not used.
 * - library: the RESULTS, settled - not the header. The header
 *   (`data-library-header`, library-page.tsx:834) paints with the route, before
 *   the listing answers, so it proved the route and nothing about the rows.
 *   `[data-library-results]` (library-page.tsx:1019) carries
 *   `aria-busy={listing.isLoading || listing.isFetching}` (:1021), and its only
 *   loading content is `LibraryGridSkeleton` (`data-library-skeleton`,
 *   library-card.tsx:521/543); while the catalogue is still indexing the header
 *   shows `data-library-building` (:1002). So the wait is: results not busy, no
 *   skeleton, no building line - which leaves exactly the settled faces: cards
 *   (`data-library-card-id`), the empty state, or the listing error. A timeout
 *   means the library never settled in 20 s and the run fails with no frame;
 *   it never means "photograph the skeleton".
 */
export const SCENE_READY = Object.freeze({
	// `:not(:has(... [data-notification-open]))` too (design D7): #1907's
	// notifications-dark still had the previous scene's row lit as open while
	// the pane already showed the empty placeholder - mid-transition.
	notifications:
		"[data-notifications-page]:not(:has([data-notification-detail], [data-notification-open])) :is([data-notifications-list], [data-notifications-empty])",
	library:
		'[data-library-page]:not(:has([data-library-building], [data-library-skeleton])) [data-library-results][aria-busy="false"]',
});

/*
 * The canvas's Files view, SETTLED (79's be9379d8 Mac run: `files-light.png`
 * was shuttered on "Loading session files..." - the scene waited only for the
 * chat header, which is up long before the session's file index answers).
 *
 * Every selector below is markup of the app at v0.59.2
 * (src/renderer/src/features/chat/components/canvas/finder-files-view.tsx), and
 * the shipped `waitFor` is `document.querySelector`, so a selector LIST is one
 * wait that passes on the first settled face it finds:
 * - rows: `[data-tour-tag="file-row"]` (:1437 audio, :1533 every other kind),
 *   only rendered once the list has items, inside the scroller section
 *   `[data-tour-tag="files-scroller"]` (:811) - but only rows of the session's
 *   file INDEX, never the person's attachments (agent review F1). Attachments
 *   load on their own request and render their own "Attachments" section with
 *   the SAME `data-tour-tag="file-row"` (one `FinderEntry`, :1437/:1533), and
 *   once they arrive that section has no caption while the index can still be
 *   loading (the count line is then blank, :693) - a frame of the person's own
 *   uploads with the peer's files still missing. The Attachments `<section>`
 *   carries no attribute at v0.59.2 (:912-915, `key` and `style` only), so the
 *   exclusion is on the row's `data-file-id` (:1438/:1534): every attachment row's
 *   id is `attachment:<key>` (attachment-items.ts:41 `ATTACHMENT_ID_PREFIX`,
 *   :140 - one id per attachment, never the file's), and no index row's is
 *   (session-files.ts:113 `remote:<row id>` for a peer's path row, :123
 *   `artifact:<digest>` for any artifact row, the path itself for a local one).
 *   `remote:` alone would be the narrower anchor but the wrong one: a peer's
 *   ARTIFACT rows carry `artifact:` (:123) and a local session's rows neither,
 *   so it would time out on both; the remote claim is the provenance
 *   read-back's job (`imagePreviewCheck`). Consequence, fail-closed: a session
 *   whose index is settled EMPTY but which holds attachments shows neither an
 *   index row nor the empty block (:854 needs no attachments either), so the
 *   wait times out and the run fails - it cannot be told from "index still
 *   loading" by any v0.59.2 attribute, so it is never photographed;
 * - the empty state, or an explicit error: the scroller's no-rows block is ONE
 *   `<div>` whose first `<p>` is the heading (:860) - "Loading session files...",
 *   "Building the file index...", "No files yet", or the error sentence. The
 *   heading's TEXT is the only difference between those states (no attribute
 *   at v0.59.2), but what FOLLOWS it is not: the settled empty state adds its
 *   detail `<p>` (:882, rendered only when `index.state === "ready"` and the
 *   attachments are not loading), an unsupported index adds its explanation
 *   `<p>` (:875), and an error adds its Retry/Continue `<button>` (:887). The
 *   loading and building headings stand alone EXCEPT in two v0.59.2 states,
 *   where a `<button>` follows them and the wait would pass (agent review F2):
 *   "Building the file index..." + Continue, once the index hook gives up after
 *   60 building polls (use-session-files.ts:152, :247 back-off 1.1-5 s, ~3.7 min,
 *   then :257-259 sets `error`, so :887 renders), and "Loading session files..."
 *   + Clear while a search or kind filter is active (`narrowing`, :893). The
 *   harness reaches neither: its profile is fresh (no saved filter, no query
 *   typed) and its wait gives up at 20 s, long before the 60th poll. So
 *   `> div > p + :is(p, button)` matches every settled face the harness can
 *   reach and no loading one - there is no other `<p>` in the scroller, rows
 *   are spans and buttons;
 * - and, for both, no Attachments section still captioned "Loading session
 *   files..." (:1073: a `text-ink-dim` span in the section's `<h3><button>`; its
 *   one settled sibling caption, "partial", carries a `title`, :1081).
 * A timeout means none of those within 20 s: the run fails and no frame is
 * taken under the scene's name.
 *
 * NOT COVERED, and why: while an index is still PAGING with rows already on
 * screen, the count line above the scroller appends " - Loading session
 * files..." (:718) as bare text in an attribute-less span; no v0.59.2 selector
 * can see it. The rows that frame shows are real, settled rows.
 */
const FILES_SCROLLER =
	'[data-tour-tag="canvas-container"] [data-tour-tag="files-scroller"]:not(:has(h3 > button > span.text-ink-dim:not([title])))';
/** A row of the session's file INDEX: any file row that is not an attachment (F1). */
export const INDEX_ROW =
	'[data-tour-tag="file-row"][data-file-id]:not([data-file-id^="attachment:"])';
export const FILES_READY = `${FILES_SCROLLER} ${INDEX_ROW}, ${FILES_SCROLLER} > div > p + :is(p, button)`;

/**
 * The `file-preview` scene: --session's Files view, the `name` row shown IN THE
 * CANVAS, positive-waited on the painted picture. Shipped v0.59.2 verbs only
 * (`press`, `waitFor`, `openCanvas`, `navigate`: dev-driver-script.ts:62-71).
 *
 * WHY THE ROW'S MENU, NOT THE ROW. A picture in the grouped Images grid (the
 * default, finder-layout.ts:17 `group: true`) is a TILE, and a tile's own click
 * is EXPAND - the lightbox, not the canvas (finder-files-view.tsx:1553
 * `tiled && media === "image" ? onExpand : onOpen`). The canvas door every row
 * has is its menu's "Show in canvas" (remote rows: remote-file-actions-menu.tsx,
 * entry `data-remote-action="show-in-canvas"` :262, wired to the same `onOpen`,
 * finder-files-view.tsx:1363). `press` dispatches pointerdown...click
 * (install.ts:206-263): the trigger is a Radix `DropdownMenuTrigger` (`aria-
 * haspopup="menu"`, opens on pointerdown, button 0), the entry a Radix item
 * (selects on click; `data-disabled` while disabled - above the relay's size
 * ceiling - which the selector refuses, so a disabled entry fails the run).
 *
 * WHICH ROW. Row ids are opaque (`remote:<row id>` / `artifact:<digest>`,
 * session-files.ts:113/123), so the row is found by its button's tooltip
 * (`title`, :1552), matched on the EXACT name (agent review F4 / QA Q1-2: a
 * prefix match picked `image-1.png.bak` first). The tooltip's first line is
 * the identity (:1275-1281) and any further line follows a "\n" (:1295-1303:
 * the remote row's "On <device>", an attachment status):
 * - a path row: the identity is the (owner's display) path, so the title ends
 *   in `/<name>` or has `/<name>` right before a newline - or IS the bare name;
 * - an artifact row: `artifactTooltip` (artifact-identity.ts:200-211) is
 *   `<name> \u00b7 <digest head> \u00b7 <cue>`, so the title starts `<name> \u00b7 `.
 * Attachment rows are excluded (`INDEX_ROW`): an attachment named like the
 * peer's file is the person's upload, not the peer's file. The shipped verbs
 * cannot count matches, so "exactly one row of that name" is the provenance
 * read-back's check (`imagePreviewCheck` fails the run on two or more).
 * Rows are virtualised (only bands in view render), so the row must be on the
 * first screen of the list - if it is not, `press` fails with "nothing matches".
 *
 * THE COLLAPSED GROUP (79's Mac run at main 34a08e97, app 0.59.2: "step 10
 * press found no file-row with title image-1.png"). That session lists 1043
 * files: an expanded Highlights group of one row and a COLLAPSED "Working
 * files, 1,042" group, and `image-1.png` was inside the collapsed one - so its
 * row was never rendered and no selector could reach it. At v0.59.2, once a
 * session has any highlighted file, every other file sits under "Working
 * files", and that group starts CLOSED (finder-layout.ts:18 `workingOpen:
 * false`; :224 `open: prefs.workingOpen || narrowing`; :227 returns before any
 * of its rows are laid out). Two ways in:
 * - the search field (finder-files-view.tsx:568-575, an `<Input>`; typing makes
 *   the view `narrowing`, :271, which opens every group). Not usable: no
 *   v0.59.2 script verb types into a field (dev-driver-script.ts:62-71 ships
 *   navigate/setTheme/press/state/waitFor/openCanvas/skipOnboarding/shutter,
 *   and `press`, install.ts:206-263, only dispatches pointer and mouse events);
 * - pressing the group's header, which is what the scene does
 *   (`COLLAPSED_GROUP_HEADER`). The header is a `<button>` directly inside the
 *   section's `<h3>` (:912 `<section>`, :916 `<h3>`, :945 `<button>`); its
 *   click toggles the group (:986 -> :514-517 `setPrefs({ workingOpen })`),
 *   and it carries the group's OWN state as `aria-expanded` (:984) and
 *   `aria-disabled={narrowing}` (:985, where the toggle refuses, :516).
 *   The press is OPTIONAL: a session with no highlights has no Working files
 *   group (finder-layout.ts:217 needs both), and the second theme of one run
 *   finds the group already open (the preference persists), so "nothing
 *   collapsed" is expected and skipped. The header has no id attribute and its
 *   label is localized, so the selector names "a collapsed header" rather than
 *   "Working files". In the harness's fresh profile Working files is the only
 *   group that can start collapsed: every other group starts open
 *   (`closedSections: []`, finder-layout.ts:19) and closes only when a person
 *   presses it. Once the group is expanded, its rows are virtualised like any
 *   others, so the row still has to fall on the first screen.
 *
 * THE SETTLED STATE. The canvas viewer renders `<img alt={document.title}>`
 * only once the bytes arrived (image-preview.tsx:127-129 artifact, :238-240
 * path; loading/failure render `FileViewerState` instead), inside
 * `[data-tour-tag="canvas-container"]` (canvas/index.tsx:836). The lightbox
 * (`data-image-viewport`, image-lightbox.tsx:716) portals to <body>, and is
 * excluded anyway, so an Expand can never pass for the canvas. The Files
 * grid's own thumbnails are `alt=""`. A timeout means the picture never
 * reached the canvas (unreachable owner, refused read) and no frame.
 * NOT COVERED (QA Q1-1): the `<img>` exists as soon as its URL is set, BEFORE
 * the browser decodes it, and no v0.59.2 attribute marks the decode (no
 * `onLoad` state, no `complete` attribute a selector can read), so a frame can
 * catch a not-yet-decoded picture. Stated in the receipt's `limits`.
 */
/**
 * The file-preview scene's one remote-menu press: a READ (the bytes go to the
 * canvas, never to disk). One constant because `downloadStepsProblem` admits
 * exactly this string, and only it, in a run that is not a download run.
 */
export const SHOW_IN_CANVAS_ITEM_SELECTOR =
	'[role="menu"] [data-remote-action="show-in-canvas"]:not([data-disabled])';

/**
 * A Files group header whose group is collapsed and may be opened. See "THE
 * COLLAPSED GROUP" above: in the harness's profile this can only be Working
 * files. It names state attributes, never the chevron icon, so an icon change
 * cannot break it.
 */
export const COLLAPSED_GROUP_HEADER =
	'[data-tour-tag="files-scroller"] section > h3 > button[aria-expanded="false"]:not([aria-disabled="true"])';

/**
 * The Files view, settled, with a collapsed Working files group opened: the ONE
 * way every row-pressing scene (file-preview, download) reaches its row. Shared,
 * not copied, so a fix to how the list is reached lands in both (79's download
 * run at main 3673e88232 failed exactly where file-preview had been fixed in
 * #2015: its row sat in the collapsed group and was never rendered).
 */
export function filesRowReachSteps() {
	return [
		{ verb: "navigate", payload: "/chat" },
		{ verb: "openCanvas", payload: { view: "files" } },
		{
			verb: "waitFor",
			payload: { selector: FILES_READY, timeoutMs: 20000 },
			timeoutMs: 25000,
		},
		// Open the collapsed Working files group (79's run: the row was in it).
		// Optional, so "no collapsed group" is skipped. 1.5 s is the bound every
		// optional guarded toggle here uses (the asks and update-detail scenes).
		// It is not a measured latency: FILES_READY has already passed, and
		// the headers come from the same render as the rows (one `sections` memo,
		// finder-files-view.tsx:301), so the header is already in the DOM or it
		// never will be.
		{
			verb: "press",
			payload: { selector: COLLAPSED_GROUP_HEADER, timeoutMs: 1500 },
			optional: true,
		},
	];
}

export function filePreviewSceneSteps(name = PREVIEW_FILE_DEFAULT) {
	const problem = previewFileProblem(name);
	if (problem) throw new Refusal(problem);
	// `\a ` is CSS for a newline (the space ends the escape); `\b7 ` is U+00B7.
	const titled = `:is([title="${name}"], [title$="/${name}"], [title*="/${name}\\a "], [title^="${name}\\a "], [title^="${name} \\b7  "])`;
	return [
		...filesRowReachSteps(),
		{
			verb: "press",
			payload: {
				selector: `[data-tour-tag="files-scroller"] ${INDEX_ROW}:has(button${titled}) button[aria-haspopup="menu"]`,
				timeoutMs: 10000,
			},
		},
		{
			verb: "press",
			payload: {
				selector: SHOW_IN_CANVAS_ITEM_SELECTOR,
				timeoutMs: 5000,
			},
		},
		{
			verb: "waitFor",
			payload: {
				selector: filePreviewSelector(name),
				timeoutMs: 20000,
			},
			timeoutMs: 25000,
		},
	];
}

/** The canvas picture of `name` (see `filePreviewSceneSteps`). */
export function filePreviewSelector(name) {
	return `[data-tour-tag="canvas-container"] img[alt="${name}"]:not([data-image-viewport] img)`;
}

/**
 * How long the scene waits for the download's outcome toast. Not a measured
 * distribution: `downloadRemoteFile` re-POSTs a pending transfer on
 * ATTACHMENT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000] (use-attachment-url.ts at
 * v0.59.2), 30 s of backoff before it gives up, so this is twice that; the
 * whole-run --timeout still bounds it. No Mac run has measured the real latency
 * yet, so every receipt records it (`download.toastLatency`, review F4) and
 * lists the gap under `limits` until a distribution exists. Declared here,
 * above MEASUREMENT_LIMITS, because that frozen list's text reads it.
 */
export const DOWNLOAD_OUTCOME_WAIT_MS = 60_000;

/*
 * What a frame of this run CANNOT prove, said in the receipt (`limits`) so a
 * reader judging the frames does not have to know these waits' source. Each
 * entry names the scenes it applies to; a run lists only those its scenes hit.
 * Factual and short: the reasoning lives beside each selector above and in
 * docs/mac-proof-capture.md, "Scene waits".
 */
export const MEASUREMENT_LIMITS = Object.freeze([
	Object.freeze({
		id: "files-paging-caption",
		scenes: Object.freeze(["files", "file-preview"]),
		text: 'While the file index is still paging with rows on screen, the count line can read "Loading session files…"; no v0.59.2 attribute exposes it, so the wait cannot exclude it.',
	}),
	Object.freeze({
		id: "files-attachments-only",
		// download waits on FILES_READY too (filesRowReachSteps).
		scenes: Object.freeze(["files", "file-preview", "download"]),
		text: "Attachment rows never satisfy the Files wait; a session whose index is empty but holds attachments times out and fails rather than being photographed.",
	}),
	Object.freeze({
		id: "preview-first-screen",
		// The id predates download sharing the reach (filesRowReachSteps); kept so
		// earlier receipts still compare.
		scenes: Object.freeze(["file-preview", "download"]),
		text: "The previewed or downloaded row must be on the Files view's first screen (rows are virtualised), after a collapsed Working files group is expanded; otherwise the run fails.",
	}),
	Object.freeze({
		id: "preview-no-search",
		scenes: Object.freeze(["file-preview"]),
		text: "The Files search field is never used: no v0.59.2 script verb types into a field, so a row is reached by expanding its group, not by filtering.",
	}),
	Object.freeze({
		id: "preview-no-decode-wait",
		scenes: Object.freeze(["file-preview"]),
		text: "The wait sees the canvas <img> once its URL is set, not once it has decoded; there is no image-decode wait.",
	}),
	// Why the detail scenes show a SEEDED read face: `detailReadSelector`.
	Object.freeze({
		id: "detail-read-seeded",
		scenes: Object.freeze(["notification-detail", "update-detail"]),
		text: "The unread->read flip cannot run in an unfocused window: notifications.read is a foreground-receipt op refused outside focus (desktop-ipc.ts:95-101, :166-185). The read face is seeded, not driven.",
	}),
	Object.freeze({
		id: "selectors-fixture-proven",
		scenes: Object.freeze([
			"files",
			"file-preview",
			"library",
			"notifications",
			"update-detail",
		]),
		text: "Scene-wait selectors are read from the v0.59.2 source and proven on jsdom fixtures shaped like it, not in Chromium.",
	}),
	/*
	 * The download scene's (release owner's request, #2012). `unless` names a
	 * run option that, when set, makes the limit not apply: with
	 * --check-operator-downloads the stray listing runs, so containment is no
	 * longer destination-only.
	 */
	Object.freeze({
		id: "toast-latency-unmeasured",
		scenes: Object.freeze(["download"]),
		text: `The outcome-toast wait (${DOWNLOAD_OUTCOME_WAIT_MS} ms) is derived from the app's retry backoff, not measured; no Mac run had measured it. download.toastLatency records this run's value.`,
	}),
	Object.freeze({
		id: "config-root-only",
		scenes: Object.freeze(["download"]),
		text: "The download scene runs only with --backend-config-root (attach and isolated are refused); a download through the operator's own daemon, into their real ~/Downloads, is not exercised.",
	}),
	Object.freeze({
		id: "containment-destination-based",
		scenes: Object.freeze(["download"]),
		unless: "checkOperatorDownloads",
		text: "--check-operator-downloads off: ~/Downloads was neither listed nor resolved, so containment rests on destination + insideRig alone; a symlinked ~/Downloads is not followed.",
	}),
	Object.freeze({
		id: "fixture-proven-actions",
		scenes: Object.freeze(["download"]),
		text: "The group expand, the row trigger (exact label, one index row), the Download entry and the toast sequence are proven on the fixture app and jsdom, not in Chromium; a Mac run is their first real test.",
	}),
]);

/**
 * The `limits` this run's scenes hit, as `{id, text}` - the ONE assembly for
 * every scene (the receipt's top-level `limits`, and `download.limits`, its
 * download-scene view). `opts` drops a limit whose `unless` option is set.
 */
export function receiptLimits(scenes, opts = {}) {
	return MEASUREMENT_LIMITS.filter(
		(limit) =>
			limit.scenes.some((scene) => scenes.includes(scene)) &&
			!(limit.unless && opts[limit.unless]),
	).map(({ id, text }) => ({ id, text }));
}

/**
 * "This notification's detail shows it READ" (design D7), from markup present
 * at v0.59.2.
 *
 * WHY THE ITEM IS SEEDED READ, NOT OPENED UNREAD (79's Mac run at main
 * 34a08e97, app 0.59.2: "Step 16 waitFor `[data-drawer-detail="n_macproofdetailaa"]
 * [data-notification-toggle-read] svg.lucide-circle` timed out"). It was not
 * icon drift: lucide-react is 0.507.0 at v0.59.2 and on main, and its
 * createLucideIcon still emits `lucide-circle`. Opening an unread item fires
 * `notifications.read` (notification-detail.tsx:871-891 `useOpenedDetailRead`,
 * drawer-updates.tsx:371, through notifications-api.ts:879 `useNotificationsWrite`),
 * and main REFUSES that op unless the window is focused: it is a
 * foreground-receipt op (desktop-ipc.ts:95-101 `FOREGROUND_RECEIPT_OPS`, refused
 * at :166-185 on `!owner.isFocused()`). This harness only ever runs an
 * unfocused window, and refuses a focused one on purpose, so the optimistic
 * flip is rolled back (notifications-api.ts:892 `onError`) and the item never
 * becomes read. #1907's "Unread 3 in dark, 4 in light" fits that: one frame
 * caught the optimistic flip, the other caught the rollback. So the live
 * unread->read flip cannot be exercised here at all, and the notification-
 * details seed stores the item ALREADY READ: `useOpenedDetailRead` returns
 * before writing (notification-detail.tsx:889), the read face is there from
 * the first paint, and the frame shows the seeded state. It does not show the
 * app flipping it. Any --notification-id these scenes open must likewise
 * already be read.
 *
 * The facts, one selector:
 * - the detail's own toggle shows its READ face. The toggle
 *   (notification-detail.tsx:351-378, a `<Button data-notification-toggle-read="">`)
 *   carries NO read-state attribute at v0.59.2, only `aria-disabled`, `title`
 *   and the marker. `item.read` switches only its icon (:371-375, `<Circle>` when
 *   read, `<Check>` when unread) and its label text (localized), so the icon
 *   class is the only selector-visible proxy. No attribute is invented here.
 * - the ROW's own state attribute, wherever a row is on screen: on the page, no
 *   list row for it is still `data-notification-unread` (notification-row.tsx:203;
 *   the Unread count comes from those rows), and a narrow window hides the
 *   list, so an absent row passes. In the drawer the detail REPLACES the list
 *   (drawer-updates.tsx:779), so the row's `data-unread` (:1120) is checked
 *   BEFORE the detail opens (`updateDetailSceneSteps`), not here.
 * `scope` is the detail container: the page's `[data-notification-detail=id]`
 * or the drawer's `[data-drawer-detail=id]`.
 */
export function detailReadSelector(
	id,
	scope = `[data-notification-detail="${id}"]`,
) {
	const toggle = `${scope} [data-notification-toggle-read] svg.lucide-circle`;
	return scope.startsWith("[data-notification-detail=")
		? `[data-notifications-page]:not(:has([data-notification-row="${id}"][data-notification-unread])) ${toggle}`
		: toggle;
}

/**
 * The update-detail scene (#1907, design D6): the item's details INSIDE the
 * conversation's drawer (Updates tab -> View details -> in-drawer detail with
 * "Back to updates" and "Open in Notifications"), from shipped verbs only.
 *
 * WHY THE RAIL, NOT THE CHIP. The asks scene presses the composer chip
 * `[data-status-asks]`, but that chip renders only when the conversation has
 * asks (composer-status-row.tsx `showAsks`), and the notification-details seed
 * has none. The panel rail's ask item (`[data-panel-rail-item="ask"]`,
 * panel-rail.tsx/panel-rail-item.tsx) opens the drawer in the conversation's
 * scope regardless, and a door-opened drawer is not auto-closed on an empty
 * queue. Every press is guarded by the state it would change, as in the asks
 * scene: the rail item only while `aria-pressed="false"`, the Updates tab only
 * while `aria-selected="false"` (with no asks the drawer DEFAULTS to Updates,
 * drawer-updates.tsx `defaultDrawerTab`; pressing it from the fleet drawer's
 * strip re-scopes to this conversation). Then the required waits: the tab
 * selected, the item's row, the in-drawer detail with its title, and its read
 * face (`detailReadSelector`).
 *
 * THE READ VIEW. The item is seeded read (see `detailReadSelector` for why an
 * unfocused window cannot make it read), and the drawer opens on its Unread
 * view (drawer-updates.tsx:301 `initialView = "unread"`, :404-408 lists only
 * unread rows there). So the scene switches to the Read view. That is a radio
 * (:1033 `role="radio"`, :1034 `aria-checked`, :1064 `data-drawer-read-view`),
 * pressed only while unchecked, and then it waits for the item's row in that
 * list (:952 `data-drawer-view-list`) WITHOUT the row's own unread state
 * attribute (:1119 `data-drawer-update`, :1120 `data-unread`, present only
 * while unread). The row is checked by state attribute here because the detail
 * replaces the list once it opens.
 */
export function updateDetailSceneSteps(id) {
	const row = `[data-drawer-view-list="read"] [data-drawer-update="${id}"]:not([data-unread])`;
	const detail = `[data-drawer-detail="${id}"]`;
	return [
		{ verb: "navigate", payload: "/chat" },
		{ verb: "openCanvas", payload: { open: false } },
		{
			verb: "waitFor",
			payload: { selector: '[data-panel-rail-item="ask"]', timeoutMs: 20000 },
			timeoutMs: 25000,
		},
		{
			verb: "press",
			payload: {
				selector: '[data-panel-rail-item="ask"][aria-pressed="false"]',
				timeoutMs: 1500,
			},
			optional: true,
		},
		{
			verb: "waitFor",
			payload: { selector: '[data-drawer-tab="updates"]', timeoutMs: 10000 },
		},
		{
			verb: "press",
			payload: {
				selector: '[data-drawer-tab="updates"][aria-selected="false"]',
				timeoutMs: 1500,
			},
			optional: true,
		},
		{
			verb: "waitFor",
			payload: {
				selector: '[data-drawer-tab="updates"][aria-selected="true"]',
				timeoutMs: 10000,
			},
		},
		{
			verb: "press",
			payload: {
				selector: '[data-drawer-read-view="read"][aria-checked="false"]',
				timeoutMs: 1500,
			},
			optional: true,
		},
		{
			verb: "waitFor",
			payload: {
				selector: '[data-drawer-read-view="read"][aria-checked="true"]',
				timeoutMs: 10000,
			},
		},
		// The row, by its OWN read state (no `data-unread`): an item that is still
		// unread fails here, naming the row, rather than at the icon wait.
		{
			verb: "waitFor",
			payload: { selector: row, timeoutMs: 15000 },
			timeoutMs: 20000,
		},
		{
			verb: "press",
			payload: {
				selector: `${row} [data-row-action="details"]`,
				timeoutMs: 5000,
			},
		},
		{
			verb: "waitFor",
			payload: {
				selector: `${detail} [data-notification-detail-title]`,
				timeoutMs: 10000,
			},
		},
		{
			verb: "waitFor",
			payload: { selector: detailReadSelector(id, detail), timeoutMs: 10000 },
		},
	];
}

/**
 * Two DIFFERENT scenes photographed to the same bytes mean one of them is a
 * stale frame (run #1907: notifications-light == notification-detail-light,
 * sha256 cbbbcdc5...). Answers the problem naming both, else null. Frames of
 * the SAME scene in two themes are not compared here: that is a theme question,
 * not a stale route. The scene is the label minus its `-<theme>` suffix.
 */
export function duplicateFrameProblem(frames) {
	const byHash = new Map();
	for (const frame of frames ?? []) {
		if (!frame?.sha256) continue;
		const suffix = `-${frame.theme}`;
		const scene = frame.label.endsWith(suffix)
			? frame.label.slice(0, -suffix.length)
			: frame.label;
		const prior = byHash.get(frame.sha256);
		if (prior && prior.scene !== scene)
			return `frames ${prior.label} and ${frame.label} are byte-identical (sha256 ${frame.sha256}); two different scenes cannot be the same picture, so one is a stale frame`;
		if (!prior) byHash.set(frame.sha256, { scene, label: frame.label });
	}
	return null;
}

/** The shipped runner's cap (src/main/dev-driver-script.ts DEV_DRIVER_SCRIPT_MAX_STEPS at v0.59.2). */
export const RUNNER_MAX_STEPS = 64;

/**
 * A step list over the cap is refused by the app only AFTER its window is up;
 * refuse it here first, naming the fix. The drawer scenes are long (update-detail
 * is 15 steps a theme: the Read view switch and the row's state wait), so every
 * scene x both themes no longer fits one launch.
 */
export function stepCountProblem(steps) {
	if (steps.length <= RUNNER_MAX_STEPS) return null;
	return `the step list has ${steps.length} steps and the app's runner caps it at ${RUNNER_MAX_STEPS}; split the --scene list across runs`;
}

/**
 * The step list the app's S1 runner walks. One launch: onboarding out of the
 * way, readiness, then per theme every scene with one shutter each. Frames are
 * labelled `<scene>-<theme>` (also the PNG name).
 */
export function buildSteps({
	scenes,
	themes,
	session,
	capture,
	notificationId = null,
	windowWaitS = WINDOW_WAIT_DEFAULT_S,
	previewFile = PREVIEW_FILE_DEFAULT,
	downloadFile = null,
}) {
	const shutter = (label) => ({
		verb: "shutter",
		payload: {
			label,
			capture: capture === "screencapture" ? "external" : "capturepage",
		},
	});
	const steps = [
		{ verb: "skipOnboarding" },
		{
			verb: "waitFor",
			payload: {
				selector: "[data-onboarding-modal]",
				gone: true,
				timeoutMs: 15000,
			},
		},
		{
			verb: "waitFor",
			payload: { selector: '[data-chat-region="header"]', timeoutMs: 30000 },
			timeoutMs: 35000,
		},
		// The harness reads this result: with --session, activeSessionId must match.
		{ verb: "state" },
	];
	// Before the first scene, not right before the shutter: each scene's own
	// positive-selector waitFor stays the last step before its frame (#1907).
	const wait = windowWaitStep({ capture, windowWaitS });
	if (wait) steps.push(wait);
	for (const theme of themes) {
		steps.push({ verb: "setTheme", payload: THEMES[theme] });
		for (const scene of scenes) {
			const label = `${scene}-${theme}`;
			if (scene === "conversation" || scene === "files" || scene === "canvas") {
				steps.push({ verb: "navigate", payload: "/chat" });
				steps.push(
					scene === "conversation"
						? { verb: "openCanvas", payload: { open: false } }
						: {
								verb: "openCanvas",
								payload: { view: scene === "files" ? "files" : "documents" },
							},
				);
				// `files` waits for its DATA, not the header: the header is up long
				// before the file index answers (79's files-light.png, "Loading
				// session files..."). See FILES_READY for the settled faces.
				steps.push(
					scene === "files"
						? {
								verb: "waitFor",
								payload: { selector: FILES_READY, timeoutMs: 20000 },
								timeoutMs: 25000,
							}
						: {
								verb: "waitFor",
								payload: { selector: '[data-chat-region="header"]' },
							},
				);
			} else if (scene === "file-preview") {
				steps.push(...filePreviewSceneSteps(previewFile));
			} else if (scene === "asks") {
				steps.push(...asksSceneSteps());
			} else if (scene === "notification-detail") {
				const selector = `[data-notification-detail="${notificationId}"]`;
				steps.push({
					verb: "navigate",
					payload: `/notifications/${notificationId}`,
				});
				// The detail pane, keyed by THIS id (notification-detail.tsx), so a
				// list or an "item not found" state can never take the frame.
				steps.push({
					verb: "waitFor",
					payload: { selector, timeoutMs: 20000 },
					timeoutMs: 25000,
				});
				steps.push({
					verb: "waitFor",
					payload: { selector: `${selector} [data-notification-detail-title]` },
				});
				// The read face (design D7). The item is SEEDED read: an unfocused
				// window's `notifications.read` is refused by main's foreground guard
				// (desktop-ipc.ts:95-101, :166-185), so opening an unread one flips it
				// optimistically and rolls it back (#1907's Unread 3 vs 4). See
				// `detailReadSelector`.
				steps.push({
					verb: "waitFor",
					payload: {
						selector: detailReadSelector(notificationId),
						timeoutMs: 10000,
					},
					timeoutMs: 15000,
				});
			} else if (scene === "update-detail") {
				steps.push(...updateDetailSceneSteps(notificationId));
			} else if (scene === "download") {
				steps.push(
					...downloadSceneSteps(downloadFile ?? DOWNLOAD_FILE_DEFAULT),
				);
			} else {
				steps.push({ verb: "navigate", payload: `/${scene}` });
				steps.push({
					verb: "waitFor",
					payload: { selector: SCENE_READY[scene], timeoutMs: 20000 },
					timeoutMs: 25000,
				});
			}
			steps.push(shutter(label));
		}
	}
	return { steps };
}

/**
 * The asks scene (#1902), from the shipped S2 verbs only - no new renderer verb.
 *
 * WHY NOT ONE PRESS. The composer chip `[data-status-asks]` TOGGLES the drawer
 * (composer-status-row.tsx `onClick={() => setAskExpanded(!askExpanded)}`), and
 * the open policy (ask-open-policy.ts rule 2) may already have opened it on its
 * own when the conversation with a pending ask was opened. A blind press would
 * then CLOSE it. So: wait for the chip (the ask reached the renderer), give the
 * auto-open a moment (optional), press the chip only while it still reads
 * `data-lo-ask-item="minimized"` (optional: no match = already open), then
 * REQUIRE the drawer (`data-lo-ask-surfaces`, the drawer's marker and never the
 * chip's - UX round 1 U3 in that file) and the suggested-command block
 * (`data-ask-command`, ask-command.tsx). The two required waits are what make an
 * empty or closed drawer fail the run instead of taking the frame.
 */
export function asksSceneSteps() {
	return [
		{ verb: "navigate", payload: "/chat" },
		{ verb: "openCanvas", payload: { open: false } },
		{
			verb: "waitFor",
			payload: { selector: "[data-status-asks]", timeoutMs: 20000 },
			timeoutMs: 25000,
		},
		{
			verb: "waitFor",
			payload: { selector: "[data-lo-ask-surfaces]", timeoutMs: 3000 },
			optional: true,
		},
		{
			verb: "press",
			payload: {
				selector: '[data-status-asks][data-lo-ask-item="minimized"]',
				timeoutMs: 1500,
			},
			optional: true,
		},
		{
			verb: "waitFor",
			payload: { selector: "[data-lo-ask-surfaces]", timeoutMs: 10000 },
		},
		{
			verb: "waitFor",
			payload: {
				selector: "[data-lo-ask-surfaces] [data-ask-command]",
				timeoutMs: 10000,
			},
		},
	];
}

/*
 * ---------------------------------------------------------------------------
 * The download scene: the harness's FIRST (and only) write.
 * ---------------------------------------------------------------------------
 *
 * WHY IT EXISTS. The remote-files real-path plan needs proof that ONE file a
 * peer owns can be downloaded through the desktop app, on the Mac, without
 * touching the operator's app, profile or ~/Downloads. Every other scene only
 * looks; this one presses the Files row's "Download to this device".
 *
 * WHO WRITES, AND WHERE (read from the code, cited so a reviewer can re-check):
 * - The menu entry (`[data-remote-action="download"]`,
 *   remote-file-actions-menu.tsx at v0.59.2) calls `downloadRemoteFile`
 *   (remote-file-transfer.tsx), which sends the desktop op
 *   `sessions.files.download` = `POST /v1/desktop/sessions/<sid>/files/<fid>/download`
 *   (desktop-contract.ts) from the APP to the rig's `lop serve`, with the
 *   app's own token. The harness's daemon client is NOT on that path and its
 *   allowlist (`DAEMON_ROUTES`) gains no route: it stays GET-only, and a test
 *   pins that it still refuses that POST.
 * - The BACKEND lands the file (core
 *   `local_operator/server/routes/desktop_session_files.py` remote_file_download,
 *   `server/utils/remote_session_files.py` downloads_dir): `Path.home()/Downloads`
 *   when that is a directory, else `<config>/downloads`; never overwriting (an
 *   identical file is reused, `created: false`; a different one goes to
 *   `name (1).ext` ... `name (99).ext`).
 *
 * WHY --backend-config-root ONLY. In that mode the rig's lop processes run with
 * `HOME=--backend-home` and `LOCAL_OPERATOR_CONFIG_DIR=--backend-config-root`,
 * so both possible destinations are inside the rig. `--backend attach` talks to
 * a daemon running as the operator, whose `Path.home()/Downloads` IS the
 * operator's real ~/Downloads; `--backend isolated` has no peer, so the route
 * (remote rows only) has nothing to land. Both are refused before anything is
 * spawned.
 *
 * WHAT THE WRITE CAN REACH: exactly one new file, `<backend-home>/Downloads/<name>`
 * (or its `(n)` variant), or `<config-root>/downloads/<name>` when the former
 * is not a directory. Preflight refuses a destination that is a symlink or
 * resolves outside its rig root, and one that already holds `<name>` (a reused
 * identical file would land nothing new and prove nothing).
 *
 * WHY "Save as..." IS NEVER PRESSED. Save as reads the bytes into the window and
 * hands them to Electron's download manager, whose default folder is
 * `app.getPath('downloads')` - the operator's real ~/Downloads, whatever HOME
 * the rig set (window-guards-electron.ts guardDownloads). So the only remote
 * action this harness may press is `download` (`downloadStepsProblem`), and a row
 * that offers no Download (only Save as) fails the run instead.
 */

/** The ONE remote action the harness may press. */
export const DOWNLOAD_ITEM_SELECTOR =
	'[role="menu"] [data-remote-action="download"]:not([data-disabled])';

/** Sonner 2.0.3 marks each toast `data-sonner-toast` with `data-type` = its kind. */
const DOWNLOAD_OUTCOME_TOAST =
	'[data-sonner-toast]:is([data-type="success"], [data-type="error"], [data-type="info"])';
const DOWNLOAD_SUCCESS_TOAST = '[data-sonner-toast][data-type="success"]';

/**
 * The en template of `ui.common.actions.actions_for_name`, used when the
 * repository's catalogues cannot be read (the harness copied out of the tree).
 * A label set that misses the app's locale matches nothing, so the run fails
 * at the row wait - the safe direction.
 */
const ACTIONS_FOR_NAME_EN = "Actions for {name}";

/**
 * Every shipped locale's exact accessible name for the row trigger of `name`
 * ("Actions for <name>", "Acciones de <name>", ...), from the repository's own
 * catalogues beside this script. WHY exact labels (review F2 / S1-2): a
 * substring match let `old-notes.md`'s row be the one pressed, downloading a
 * file the run was never authorised to land before anything failed. The
 * harness does not pin the app's locale, so it accepts any shipped locale's
 * label - each still EXACT. A template carrying a quote, backslash or control
 * character is skipped (it is quoted into a CSS attribute selector).
 */
export function actionsForNameLabels(
	name,
	catalogues = join(HERE, "..", "src", "i18n", "catalogues"),
) {
	const templates = new Set([ACTIONS_FOR_NAME_EN]);
	let locales = [];
	try {
		locales = readdirSync(catalogues).sort();
	} catch {}
	for (const locale of locales) {
		let template;
		try {
			template = JSON.parse(
				readFileSync(
					join(catalogues, locale, "ui.common.actions.json"),
					"utf8",
				),
			)["ui.common.actions.actions_for_name"];
		} catch {
			continue;
		}
		// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
		if (typeof template !== "string" || /["\\\u0000-\u001f]/.test(template))
			continue;
		if (template.includes("{name}")) templates.add(template);
	}
	return [...templates].map((t) => t.replaceAll("{name}", name));
}

/** The menu trigger of the row whose accessible name is EXACTLY one of `labels`. */
function rowTriggerButton(labels) {
	return `button[aria-haspopup="menu"]:is(${labels.map((l) => `[aria-label="${l}"]`).join(", ")})`;
}

/**
 * Matches (something) only when TWO OR MORE file rows carry `name`'s trigger.
 * Any two distinct rows have a lowest common ancestor with two distinct
 * children c1 ~ c2, each the row itself or an ancestor of it, so the pair is
 * `X ~ X` with X = "is such a row, or contains one". `:has()` may not nest, so
 * the row-itself case is `row:has(button)` and the ancestor case is
 * `:has(row button)` - neither nests. Used with `waitFor {gone: true}`: the
 * run refuses rather than press the first of two same-named rows (S1-2).
 *
 * Only INDEX rows count (`INDEX_ROW`, #2012 review C1): the trigger the scene
 * presses is restricted to them, so an attachment of the same name (the
 * person's upload, which shares `data-tour-tag="file-row"`) is not a second
 * candidate, and counting it refused a run that had exactly one row to press.
 */
export function duplicateRowSelector(labels) {
	const button = rowTriggerButton(labels);
	const holder = `:is(${INDEX_ROW}:has(${button}), :has(${INDEX_ROW} ${button}))`;
	return `${holder} ~ ${holder}`;
}

/**
 * A plain basename the backend could land: no separator, no `.`/`..`, no
 * control character, no quote or backslash (it is quoted into a CSS attribute
 * selector).
 */
export function downloadFileProblem(name) {
	if (typeof name !== "string" || name.length === 0 || name.length > 255)
		return "--download-file must be a file name (1-255 characters)";
	if (name === "." || name === "..")
		return `--download-file must be a file name (got ${name})`;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
	if (/[/\\"\u0000-\u001f\u007f]/.test(name))
		return `--download-file must be a plain file name: no /, \\, " or control characters (got ${JSON.stringify(name)})`;
	return null;
}

/**
 * The download scene, from the shipped S2 verbs only (navigate, openCanvas,
 * waitFor, press - `DEV_DRIVER_SCRIPT_VERBS` at v0.59.2); no new renderer verb.
 *
 * - The Files view as file-preview reaches it (`filesRowReachSteps`): the
 *   settled-data wait (`FILES_READY`), then the OPTIONAL press of a collapsed
 *   group header (`COLLAPSED_GROUP_HEADER`). 79's Mac run at main 3673e88232
 *   ("waitFor failed: nothing matches [data-tour-tag="file-row"] ... Actions for
 *   notes.md ... after 20000ms"): 1043 files, an open Highlights group of one
 *   row and a collapsed "Working files, 1,042" holding notes.md, whose rows
 *   v0.59.2 never renders (see "THE COLLAPSED GROUP" at file-preview). As
 *   there, the row must then fall on the first screen (receipt limit
 *   `preview-first-screen`).
 * - The row's `⋯` trigger: the Radix trigger (`aria-haspopup="menu"`) inside an
 *   index row (`INDEX_ROW`, finder-files-view.tsx), whose accessible name is
 *   "Actions for <name>" (ui.common.actions.actions_for_name). The name is the
 *   only per-row marker the row carries (`data-file-id` is the owner's id, which
 *   the harness does not know), so the label is matched EXACTLY, in any shipped
 *   locale (`actionsForNameLabels`), never as a substring.
 *   Attachment rows are excluded, as at file-preview: an attachment named
 *   like the peer's file is the person's upload, not a peer row to download.
 * - Then the run REFUSES when more than one INDEX row carries that label
 *   (`duplicateRowSelector`, a `gone` wait that fails at once if present).
 * - Pressed only while `aria-expanded="false"`; the press dispatches
 *   pointerdown, which opens a Radix DropdownMenu.
 * - The Download entry is REQUIRED enabled (`DOWNLOAD_ITEM_SELECTOR`): a local
 *   row's menu has none, an unreadable row's is disabled, and a row that offers
 *   only Save as fails here. Then it is pressed (Radix selects on click).
 * - The outcome toast (one id: loading, then success/error/info in place), and
 *   then a REQUIRED success toast, so an error fails fast and names itself.
 */
export function downloadSceneSteps(file = null) {
	// `?? default`, not a parameter default: parseArgs leaves an unset
	// --download-file as null, which a default parameter would keep.
	const name = file ?? DOWNLOAD_FILE_DEFAULT;
	const labels = actionsForNameLabels(name);
	const trigger = `[data-tour-tag="files-scroller"] ${INDEX_ROW} ${rowTriggerButton(labels)}`;
	return [
		...filesRowReachSteps(),
		{
			verb: "waitFor",
			payload: { selector: trigger, timeoutMs: 20000 },
			timeoutMs: 25000,
		},
		// `gone` with a 1 ms bound: absent passes at the first look; present
		// fails after one re-check (install.ts waitFor), naming the selector.
		{
			verb: "waitFor",
			payload: {
				selector: duplicateRowSelector(labels),
				gone: true,
				timeoutMs: 1,
			},
		},
		{
			verb: "press",
			payload: { selector: `${trigger}[aria-expanded="false"]` },
		},
		{
			verb: "waitFor",
			payload: { selector: DOWNLOAD_ITEM_SELECTOR, timeoutMs: 5000 },
		},
		{ verb: "press", payload: { selector: DOWNLOAD_ITEM_SELECTOR } },
		{
			verb: "waitFor",
			payload: {
				selector: DOWNLOAD_OUTCOME_TOAST,
				timeoutMs: DOWNLOAD_OUTCOME_WAIT_MS,
			},
			timeoutMs: DOWNLOAD_OUTCOME_WAIT_MS + 5000,
		},
		{
			verb: "waitFor",
			payload: { selector: DOWNLOAD_SUCCESS_TOAST, timeoutMs: 1000 },
		},
	];
}

/**
 * The exact press selectors a download run may use: its own scene's three - the
 * collapsed-group header, the row trigger, the Download entry.
 *
 * WHY THE HEADER PRESS CANNOT REACH Save as / Copy image / Delete (read from
 * v0.59.2). `COLLAPSED_GROUP_HEADER` matches only a `<button>` that is the
 * direct child of an `<h3>` directly inside a `<section>` inside the Files
 * scroller, with `aria-expanded="false"`: the group header
 * (finder-files-view.tsx:912 section, :916 h3, :945 button). That button's
 * click does one thing, `toggle(section.id)` (:986 -> :514-524), which sets the
 * Working files preference or the closed-sections set - view state, no daemon
 * call, no file I/O. Its content is a chevron icon, the label and a caption
 * span ("a caption, never a control", :1061-1086); no menu or row lives in it.
 * Every file action is a Radix menu ITEM, and the menu content is portalled to
 * <body> (dropdown-menu.tsx:191 `DropdownMenuPrimitive.Portal`), so no menu
 * item is ever inside the scroller, let alone `section > h3 > button`. The row
 * triggers are `button[aria-haspopup="menu"]` inside a file row's `<div>`
 * (:1430, :1528) under the section's `<ul>`, never a child of the `<h3>`. And
 * `press` takes the selector's FIRST match only (dev-driver/install.ts:864
 * `document.querySelector`), so it presses a header or nothing.
 * The press is also skipped (optional) once the group is open. Each entry
 * is still admitted byte-for-byte, never by pattern.
 */
export function downloadPressAllowlist(file = null) {
	return downloadSceneSteps(file)
		.filter((s) => s.verb === "press")
		.map((s) => s.payload.selector);
}

/**
 * Refuse a step list that could press anything that writes outside the rig.
 * Run on the built list before launch, so a future edit cannot slip a press
 * through.
 *
 * - A DOWNLOAD run (`{download: true, file}`): an ALLOWLIST - every press must be
 *   byte-for-byte one of `downloadPressAllowlist(file)` (the collapsed-group
 *   header, the row trigger, the Download entry). WHY not a blocklist
 *   (review S1-1): a text blocklist was passed by an uppercase attribute, a
 *   sibling combinator (`[data-remote-action="download"] + *`) and
 *   `:nth-of-type`, each able to reach Save as, whose bytes Electron writes to
 *   the operator's real ~/Downloads. Other scenes' presses are refused in a
 *   download run too; run them separately.
 * - Any other run never presses a remote action or Save as (matched
 *   case-insensitively), except file-preview's byte-exact
 *   SHOW_IN_CANVAS_ITEM_SELECTOR, which reads the bytes into the canvas and
 *   writes nothing (#2013).
 */
export function downloadStepsProblem(
	steps,
	{ download = false, file = null } = {},
) {
	const allowed = download ? new Set(downloadPressAllowlist(file)) : null;
	for (const [i, step] of (steps ?? []).entries()) {
		if (step?.verb !== "press") continue;
		const selector =
			typeof step.payload === "string"
				? step.payload
				: String(step.payload?.selector ?? "");
		if (allowed) {
			if (!allowed.has(selector))
				return `step ${i + 1} presses ${selector}: a download run may press only the collapsed Files group header, its own row trigger and ${DOWNLOAD_ITEM_SELECTOR} (an exact allowlist; Save as and Copy image hand the bytes to Electron, whose download folder is the operator's real ~/Downloads)`;
			continue;
		}
		// The one exception is byte-exact: file-preview's Show in canvas, a read.
		if (selector === SHOW_IN_CANVAS_ITEM_SELECTOR) continue;
		if (/save[-_ ]?as|copy-image|data-remote-action/i.test(selector))
			return `step ${i + 1} presses ${selector}: only --scene download presses the remote file menu, and only its Download entry; the harness never presses Save as / Copy image, which hand the bytes to Electron, whose download folder is the operator's real ~/Downloads`;
	}
	return null;
}

/** A hint for the run's error when the Download entry never appeared, or two rows matched. */
export function downloadFailureHint(message, file = null) {
	const text = String(message);
	if (text.includes(DOWNLOAD_ITEM_SELECTOR))
		return "the row offered no enabled Download entry (a local row, an unreadable row, or one already landed in this profile); the harness never falls back to Save as, which would write to the operator's ~/Downloads";
	const name = file ?? DOWNLOAD_FILE_DEFAULT;
	// The runner prints errors through oneLine (whitespace collapsed).
	const flat = (s) => s.replace(/\s+/g, " ");
	if (
		flat(text).includes(flat(duplicateRowSelector(actionsForNameLabels(name))))
	)
		return `more than one Files row is labelled for ${name}; the harness refuses to guess which to download`;
	return null;
}

/**
 * The manifest entry for `name`: `{files: [{filename, bytes, sha256}, ...]}`
 * (the remote-files proof manifest's shape). Throws a Refusal for a path that
 * is not a regular file, unparseable JSON, no entry, or an entry without a
 * 64-hex sha256 and an integer byte count.
 */
export function manifestEntry(path, name) {
	let stat;
	try {
		stat = statSync(path);
	} catch {
		throw new Refusal(`--manifest ${path} does not exist`);
	}
	if (!stat.isFile())
		throw new Refusal(`--manifest ${path} is not a regular file`);
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Refusal(`--manifest ${path} is not JSON (${error.message})`);
	}
	const files = Array.isArray(parsed?.files) ? parsed.files : null;
	if (!files)
		throw new Refusal(`--manifest ${path} has no "files" list of entries`);
	const hits = files.filter((f) => f?.filename === name);
	if (hits.length === 0)
		throw new Refusal(
			`--manifest ${path} has no entry for ${name} (it lists ${files.map((f) => f?.filename).join(", ") || "nothing"})`,
		);
	if (hits.length > 1)
		throw new Refusal(`--manifest ${path} lists ${name} more than once`);
	const [entry] = hits;
	if (
		typeof entry.sha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(entry.sha256) ||
		!Number.isInteger(entry.bytes) ||
		entry.bytes < 0
	)
		throw new Refusal(
			`--manifest ${path}: the ${name} entry needs a lowercase 64-hex sha256 and an integer bytes`,
		);
	return { filename: name, bytes: entry.bytes, sha256: entry.sha256 };
}

/**
 * `path` with its PARENT resolved physically and its last component kept as
 * spelled: the leaf is never stat'ed or realpath'ed. WHY (review S1-4): on
 * macOS ~/Downloads is TCC-protected, and with --check-operator-downloads off
 * the harness promises to touch nothing in it - not even the realpath the
 * rig-inside-~/Downloads refusal used to take. The cost, recorded under
 * `download.limits`: a ~/Downloads that is itself a symlink is compared by its
 * spelled location, so containment then rests on the receipt's destination +
 * insideRig alone.
 */
export function physicalParent(path) {
	return join(physical(dirname(resolve(path))), basename(path));
}

/**
 * The two folders core may land into for this rig, in core's order, each
 * vetted: not a symlink, and physically inside its own rig root. `exists`
 * says whether it is a directory now (core picks the home one only then).
 * `operatorDownloads` is one folder or a list (see operatorDownloadsRefusals);
 * each is compared through `physicalParent`, so its leaf is not touched.
 */
export function downloadDestinations({
	backendHome,
	configRoot,
	operatorDownloads = operatorDownloadsDir(),
}) {
	const refuse = [operatorDownloads].flat().map((p) => ({
		spelled: p,
		compared: comparablePath(physicalParent(p)),
	}));
	const candidates = [
		{ dir: join(backendHome, "Downloads"), root: backendHome },
		{ dir: join(configRoot, "downloads"), root: configRoot },
	];
	return candidates.map(({ dir, root }) => {
		let st = null;
		try {
			st = lstatSync(dir);
		} catch {}
		if (st?.isSymbolicLink())
			throw new Refusal(
				`${dir} is a symlink; the download must land in the rig itself, so a linked downloads folder is refused`,
			);
		if (st && !st.isDirectory())
			return { dir, exists: false, notADirectory: true };
		if (st && !within(physical(dir), physical(root)))
			throw new Refusal(`${dir} resolves outside ${root}`);
		// A rig sited INSIDE the operator's ~/Downloads would add no top-level
		// entry there, so the stray check could not see it: refused outright.
		const inside = refuse.find((r) =>
			within(comparablePath(physical(dir)), r.compared),
		);
		if (inside)
			throw new Refusal(
				`${dir} is inside the operator's ~/Downloads (${inside.spelled}); site the rig elsewhere`,
			);
		return { dir, exists: Boolean(st) };
	});
}

/**
 * The folders the rig-inside-~/Downloads refusal compares against. ALWAYS the
 * operator's real default (`target.real`), whatever the test seam injected -
 * so the seam can add a comparison, never remove one. Its realpath (the leaf
 * resolved, following a symlinked ~/Downloads) is added only when
 * --check-operator-downloads is on against the real folder: that run lists it
 * anyway, and an off run must not touch it (S1-4).
 */
export function operatorDownloadsRefusals(target, check) {
	return [
		target.real,
		...(target.injected ? [target.path] : []),
		...(check && !target.injected ? [physical(target.real)] : []),
	];
}

/**
 * TEST-ONLY seam (QA Q1-1): the folder the opt-in stray listing reads instead
 * of the operator's real ~/Downloads, so the test suite's flag-on run never
 * lists - and on a Mac never raises a Files and Folders prompt for - the real
 * ~/Downloads of whoever runs it.
 *
 * WHY an env var and not an exported option: the end-to-end case runs the
 * harness as a child process (the only way to exercise main, its signals and
 * its exit codes), so an in-process option cannot reach it. WHY it cannot
 * loosen the guard:
 * - honoured ONLY when NODE_TEST_CONTEXT is set (node:test sets it in every
 *   test-file process; the suite forwards it), else refused (exit 2) rather
 *   than silently ignored, so an operator cannot believe they redirected it;
 * - an absolute path only;
 * - it redirects only the NEGATIVE listing; the rig-inside-~/Downloads refusal
 *   still compares against the real default (operatorDownloadsRefusals) and
 *   the positive proof (destination + insideRig) is untouched;
 * - the receipt records the listed path and `injected: true`.
 * `real` is always the passwd home's Downloads.
 */
export const TEST_OPERATOR_DOWNLOADS_ENV = "MAC_PROOF_TEST_OPERATOR_DOWNLOADS";
export function operatorDownloadsTarget(
	env = process.env,
	homedir = os.userInfo().homedir,
) {
	const real = operatorDownloadsDir(homedir);
	const injected = env[TEST_OPERATOR_DOWNLOADS_ENV];
	if (injected === undefined || injected === "")
		return { path: real, real, injected: false };
	if (!env.NODE_TEST_CONTEXT)
		throw new Refusal(
			`${TEST_OPERATOR_DOWNLOADS_ENV} is a test-only seam honoured only under node --test (NODE_TEST_CONTEXT); unset it - the stray check always lists the operator's real ~/Downloads`,
		);
	if (!isAbsolute(injected))
		throw new Refusal(
			`${TEST_OPERATOR_DOWNLOADS_ENV} must be an absolute path (got ${JSON.stringify(injected)})`,
		);
	return { path: resolve(injected), real, injected: true };
}

/**
 * The rig side of preflight: the manifest entry (when given) and the vetted
 * destinations, refusing one that already holds the file.
 */
export function downloadPreflight(
	opts,
	{ backendHome, operatorDownloads, target = null },
) {
	const file = opts.downloadFile ?? DOWNLOAD_FILE_DEFAULT;
	const manifest =
		opts.manifest === null
			? null
			: { path: opts.manifest, entry: manifestEntry(opts.manifest, file) };
	const stray = target ?? operatorDownloadsTarget();
	const destinations = downloadDestinations({
		backendHome,
		configRoot: opts.backendConfigRoot,
		operatorDownloads:
			operatorDownloads ??
			operatorDownloadsRefusals(stray, opts.checkOperatorDownloads === true),
	});
	for (const d of destinations)
		if (d.exists && existsSync(join(d.dir, file)))
			throw new Refusal(
				`${join(d.dir, file)} already exists in the rig; move it out first (the backend would reuse it and land nothing new, so the run could not prove a download)`,
			);
	return {
		file,
		manifest,
		destinations,
		operatorDownloads: { path: stray.path, injected: stray.injected },
	};
}

/** The operator's real ~/Downloads: from the passwd home, never $HOME (which a rig may set). */
export function operatorDownloadsDir(homedir = os.userInfo().homedir) {
	return join(homedir, "Downloads");
}

/**
 * Names only, sorted; `{exists: false}` when absent. EPERM/EACCES throws: on
 * macOS ~/Downloads is TCC-protected, and an unreadable listing can prove
 * nothing, so the caller turns it into BLOCKED rather than a pass.
 */
export function listNames(dir) {
	try {
		return { exists: true, names: readdirSync(dir).sort() };
	} catch (error) {
		if (error.code === "ENOENT") return { exists: false, names: [] };
		throw error;
	}
}

/** The names `after` has that `before` did not. */
export function newEntries(before, after) {
	const seen = new Set(before?.names ?? []);
	return (after?.names ?? []).filter((n) => !seen.has(n));
}

/** core `_candidates`: `name`, then `stem (1).ext` ... `stem (99).ext`. */
export function landingNames(name) {
	const dot = name.lastIndexOf(".");
	const [stem, ext] =
		dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	return [
		name,
		...Array.from({ length: 99 }, (_, i) => `${stem} (${i + 1})${ext}`),
	];
}

/**
 * EVERY new entry, of any name, across the rig's destinations: `before` maps
 * each destination dir to its listing at run start. Throws what listNames
 * throws (an unreadable folder).
 */
export function rigNewEntries(destinations, before) {
	const added = [];
	for (const d of destinations)
		for (const n of newEntries(before.get(d.dir), listNames(d.dir)))
			added.push(join(d.dir, n));
	return added;
}

/**
 * Read what landed, after the steps. Exactly ONE new entry, of ANY name, may
 * exist across both destinations (review F1: counting only `<name>` and its
 * `(n)` variants let `other.txt` land beside `notes.md` and still PASS), it
 * must carry the expected name (`<name>`, or core's `(n)` variant of it), and
 * it must be a regular file physically inside the rig; its bytes and sha256
 * are compared to the manifest entry when one was given. `newInRig` records
 * every new path seen. Returns `{result, problem}`; null only on a PASS.
 */
export function inspectLanding(plan, before, { rigRoots }) {
	const result = {
		file: plan.file,
		destination: null,
		insideRig: null,
		bytes: null,
		sha256: null,
		manifest: plan.manifest,
		compared: plan.manifest ? null : "not compared (no --manifest)",
		newInRig: null,
		verdict: "FAIL",
	};
	let added;
	try {
		added = rigNewEntries(plan.destinations, before);
	} catch (error) {
		return {
			result,
			problem: `the rig's downloads folders could not be listed after the steps (${error.code ?? error.message})`,
		};
	}
	result.newInRig = added;
	if (added.length === 0)
		return {
			result,
			problem: `no ${plan.file} appeared in the rig (${plan.destinations.map((d) => d.dir).join(" or ")}) after the download's success toast`,
		};
	if (added.length > 1)
		return {
			result,
			problem: `more than one new file landed in the rig (exactly one may): ${added.join(", ")}`,
		};
	const [path] = added;
	if (!landingNames(plan.file).includes(basename(path)))
		return {
			result,
			problem: `the one new file in the rig is ${path}, not ${plan.file}`,
		};
	result.destination = path;
	const st = lstatSync(path);
	const real = st.isFile() ? physical(path) : null;
	result.insideRig =
		real !== null && rigRoots.some((root) => within(real, physical(root)));
	if (!result.insideRig)
		return {
			result,
			problem: `${path} is not a regular file inside the rig`,
		};
	const bytes = readFileSync(path);
	result.bytes = bytes.length;
	result.sha256 = sha256(bytes);
	if (plan.manifest) {
		const want = plan.manifest.entry;
		const ok = result.sha256 === want.sha256 && result.bytes === want.bytes;
		result.compared = ok ? "match" : "mismatch";
		if (!ok)
			return {
				result,
				problem: `${path} is ${result.bytes} B sha256 ${result.sha256}; the manifest says ${want.bytes} B sha256 ${want.sha256}`,
			};
	}
	result.verdict = "PASS";
	return { result, problem: null };
}

/**
 * The stray-download check, after the reap: any name in the operator's real
 * ~/Downloads that was not there at run start fails the run. Names only: the
 * harness never opens or hashes the operator's files, and the receipt lists
 * only the NEW names. Something else on the machine saving a file meanwhile
 * also fails it - a false alarm is the safe direction.
 */
export function strayDownloadsProblem(before, after) {
	const added = newEntries(before, after);
	return {
		newEntries: added,
		problem:
			added.length === 0
				? null
				: `new entr${added.length === 1 ? "y" : "ies"} appeared in the operator's ~/Downloads during the run: ${added.join(", ")}`,
	};
}

/**
 * The operator-~/Downloads baseline, taken before the backend or the app starts.
 *
 * OPT-IN (`--check-operator-downloads`), default OFF. WHY: on macOS ~/Downloads
 * is TCC-protected, and listing it from the hosting app (Terminal, an agent
 * host) can raise a "Files and Folders" access prompt on the operator's own
 * screen before the app has even started - exactly the class of prompt this
 * harness promises never to raise on an unattended run. The containment proof
 * the scene needs is POSITIVE and does not need the listing: exactly one new
 * file, inside the rig (`destination` + `insideRig` in the receipt). The
 * absence-of-strays listing is a second, negative check an operator can ask
 * for when a prompt (or a granted host) is acceptable.
 *
 * Off: returns `{checked: false}` WITHOUT touching the folder, so the receipt
 * says the check did not run rather than implying it passed. On: the listing,
 * or a BLOCKED Refusal (exit 3) when it cannot be read - an unreadable folder
 * proves nothing. `list` is injectable so tests can prove "no listing attempted".
 */
export function operatorDownloadsBaseline({
	check,
	dir = operatorDownloadsDir(),
	injected = false,
	list = listNames,
	host = () => tccHost(),
}) {
	if (!check) return { checked: false };
	try {
		return {
			checked: true,
			path: dir,
			...(injected ? { injected: true } : {}),
			before: list(dir),
		};
	} catch (error) {
		// tccHost() is `{host, kind, pid}` or null; its `host` string is the name
		// to grant (QA Q1-2: the object itself rendered as [object Object]).
		const who =
			host()?.host ??
			"the terminal or agent app hosting this run (its parent chain could not be read)";
		throw new Refusal(
			`BLOCKED: cannot list the operator's ${dir} (${error.code ?? error.message}), so --check-operator-downloads could not run; on macOS grant Files and Folders > Downloads Folder to ${who} in System Settings > Privacy & Security, or run without the flag (containment is then proven by the receipt's destination alone)`,
			EXIT.BLOCKED,
		);
	}
}

/**
 * The after-the-reap half: `{record, problem}`. Off: `{checked: false}` and no
 * listing. On: before/after counts and the NEW names only; an unreadable
 * folder after the run, or any new name, is a problem (exit 1).
 */
export function operatorDownloadsVerdict(baseline, list = listNames) {
	if (!baseline?.checked) return { record: { checked: false }, problem: null };
	let after;
	try {
		after = list(baseline.path);
	} catch (error) {
		return {
			record: {
				checked: true,
				path: baseline.path,
				...(baseline.injected ? { injected: true } : {}),
				before: baseline.before.names.length,
				after: null,
				newEntries: null,
			},
			problem: `the operator's ${baseline.path} could not be listed after the run (${error.code ?? error.message})`,
		};
	}
	const stray = strayDownloadsProblem(baseline.before, after);
	return {
		record: {
			checked: true,
			path: baseline.path,
			...(baseline.injected ? { injected: true } : {}),
			before: baseline.before.names.length,
			after: after.names.length,
			newEntries: stray.newEntries,
		},
		problem: stray.problem,
	};
}

/**
 * The download scene's limits: `receiptLimits` filtered to that scene (one
 * implementation; the entries live in MEASUREMENT_LIMITS).
 */
export function downloadLimits({ checkOperatorDownloads }) {
	return receiptLimits(["download"], { checkOperatorDownloads });
}

/**
 * The outcome toast's measured latency (review F4): the renderer's own
 * `waitedMs` for the wait that follows the Download press, read from that
 * step's result line. `waitedMs` is null when the step did not run or its
 * result carried no number (a truncated or fixture line).
 */
export function downloadToastLatency(builtSteps, ranSteps) {
	const index = (builtSteps ?? []).findIndex(
		(s) =>
			s?.verb === "waitFor" && s.payload?.selector === DOWNLOAD_OUTCOME_TOAST,
	);
	const step = index === -1 ? null : index + 1;
	const ran = (ranSteps ?? []).find((s) => s.step === step);
	const waited =
		ran?.outcome === "ok" ? ran.detail.match(/"waitedMs":(\d+)/) : null;
	return {
		step,
		waitedMs: waited ? Number(waited[1]) : null,
		boundMs: DOWNLOAD_OUTCOME_WAIT_MS,
		source:
			"the renderer's waitFor result for the step after the Download press (press to outcome toast)",
	};
}

/**
 * Only these are inherited from the harness; everything else is built. Display
 * variables are passed only so an xvfb/Linux run can open a window at all.
 */
export const ENV_ALLOWLIST = Object.freeze([
	"PATH",
	"LANG",
	"LC_ALL",
	"TMPDIR",
	"USER",
	"LOGNAME",
	"DISPLAY",
	"XAUTHORITY",
	"WAYLAND_DISPLAY",
	"XDG_RUNTIME_DIR",
]);

/** Prefixes that must never reach a child even if a future allowlist edit admits them. */
export const ENV_DENY_PREFIXES = Object.freeze([
	"CMUX_",
	"LOP_",
	"LOCAL_OPERATOR_",
	"ELECTRON_RUN_AS_NODE",
	"NODE_OPTIONS",
]);

function allowlisted(base) {
	const env = {};
	for (const key of ENV_ALLOWLIST) {
		if (ENV_DENY_PREFIXES.some((p) => key.startsWith(p))) continue;
		if (base[key] !== undefined) env[key] = base[key];
	}
	return env;
}

/** The app's environment. `token` is the one secret; see `redactEnv`. */
export function buildAppEnv({
	base = process.env,
	rig,
	backendUrl,
	token,
	windowMode,
}) {
	return {
		...allowlisted(base),
		HOME: join(rig, "home"),
		LOCAL_OPERATOR_CONFIG_DIR: join(rig, "config-app"),
		LOCAL_OPERATOR_LOG_DIR: join(rig, "logs"),
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		VITE_DISABLE_BACKEND_MANAGER: "true",
		LOCAL_OPERATOR_UI_ATTACH_BACKEND_URL: backendUrl,
		LOCAL_OPERATOR_DESKTOP_TOKEN: token,
		LOCAL_OPERATOR_UI_WINDOW_MODE: windowMode,
		LOCAL_OPERATOR_UI_DEV_DRIVER: "1",
		LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: join(rig, "frames"),
		LOCAL_OPERATOR_UI_DEV_DRIVER_SCRIPT: join(rig, "steps.json"),
	};
}

/**
 * The environment of every `lop` process the harness starts (the daemon, and in
 * --backend-config-root mode the mesh relay): a scratch or rig-device HOME, the
 * chosen config root, and - for the daemon only - the token minted here.
 *
 * Why each extra key (measured on node2 by QA, manager addendum 2026-11-16):
 *   - `TMPDIR=<rig>/tmp`: an allowlisted env otherwise carries the harness's own
 *     TMPDIR (or none, and lop falls back to /tmp), so lop's temp files land
 *     outside the rig;
 *   - `GIT_CONFIG_SYSTEM=/dev/null` + `GIT_TERMINAL_PROMPT=0`: the system
 *     gitconfig carries `credential.helper=osxkeychain` on the Mac, and a git
 *     call under a redirected HOME would ask macOS to create a login keychain on
 *     the operator's screen (operator rig rule);
 *   - `GH_CONFIG_DIR=<home>/.gh`: keeps `gh` out of the operator's keychain token
 *     for the same reason.
 * `HOME` and `TMPDIR` are set AFTER the allowlist so neither can be inherited.
 */
export function buildLopEnv({
	base = process.env,
	rig,
	home = join(rig, "home"),
	configRoot,
	token = null,
}) {
	return {
		...allowlisted(base),
		HOME: home,
		TMPDIR: join(rig, "tmp"),
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GH_CONFIG_DIR: join(home, ".gh"),
		LOCAL_OPERATOR_CONFIG_DIR: configRoot,
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		...(token ? { LOCAL_OPERATOR_DESKTOP_TOKEN: token } : {}),
	};
}

/** The daemon's environment: `buildLopEnv` with the token. Kept as its own name for the plan. */
export function buildServeEnv(input) {
	return buildLopEnv(input);
}

/*
 * ---------------------------------------------------------------------------
 * What the harness may ask of `lop` and of the daemon. Both are allowlists.
 * ---------------------------------------------------------------------------
 *
 * WHY. A read-role rig device can still START A RUNTIME on the session's owner:
 * on core origin/main `network/types.py`, `net_session_engage` needs only the
 * "view" capability (:725). So the harness must never prompt, send, engage or
 * resume anything, and "never" is enforced in code rather than promised in a
 * doc: every lop invocation and every daemon HTTP call goes through one of the
 * two checks below, which refuse anything not listed.
 */

/** The only lop invocations the harness makes. `network init/install/start/restart` never. */
export function lopArgvProblem(argv) {
	const port = (v) => /^\d{2,5}$/.test(v ?? "");
	const isServe =
		argv.length === 5 &&
		argv[0] === "serve" &&
		argv[1] === "--host" &&
		argv[2] === "127.0.0.1" &&
		argv[3] === "--port" &&
		port(argv[4]);
	const isRelay =
		argv.length === 4 &&
		argv[0] === "network" &&
		argv[1] === "serve" &&
		argv[2] === "--port" &&
		port(argv[3]);
	return isServe || isRelay
		? null
		: `the harness runs only \`lop serve --host 127.0.0.1 --port N\` and \`lop network serve --port N\`; refused: lop ${argv.join(" ")}`;
}

/** Every daemon route the harness calls: method, exact path, and the query keys it may carry. */
export const DAEMON_ROUTES = Object.freeze([
	Object.freeze({ method: "GET", path: "/health", query: Object.freeze([]) }),
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/sessions",
		query: Object.freeze(["include_peers", "limit"]),
	}),
	/*
	 * The --seed read-backs (scripts/mac-proof-seed.mjs `seedRowsProblem`). Both
	 * are pure reads in core: the asks aggregate reads only the derived index and
	 * "starts no runtime" (server/routes/desktop_sessions.py:5213-5239), and the
	 * detail route is a store read (desktop_notifications.py:320-337). `{id}` is
	 * ONE path segment that must match `segment`, never a free suffix.
	 */
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/asks",
		query: Object.freeze([]),
	}),
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/notifications/{id}",
		segment: NOTIFICATION_ID,
		query: Object.freeze([]),
	}),
	/*
	 * The provenance read-backs (`libraryProvenance`, `imagePreview` in the
	 * receipt), NEW with the file-preview scene and read-only GETs, all three:
	 * - the library listing, asked exactly as the desktop asks it
	 *   (`scope=final`) for its first row - core desktop_library.py:225. On a
	 *   catalogue not yet indexed it can START the background index build, which
	 *   writes the catalogue under the rig's config root - the same build the
	 *   app's own Library route starts when it opens, so after the `library`
	 *   scene it is a no-op (the build is already running or done);
	 * - one library row - desktop_library.py:296, `service.get_asset`, a store
	 *   read; `{id}` is ONE `la_<16 hex>` segment (the route's own AssetID);
	 * - --session's file index, filtered by name - desktop_session_files.py:135;
	 *   for a peer's conversation core asks the OWNER for its index
	 *   (`peer_session_files`) and stamps `remote` on each row
	 *   (server/utils/remote_session_files.py `_stamp`). The same read the app's
	 *   Files view makes; it starts no runtime.
	 */
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/library/assets",
		query: Object.freeze(["scope", "limit"]),
	}),
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/library/assets/{id}",
		segment: LIBRARY_ASSET_ID,
		query: Object.freeze([]),
	}),
	Object.freeze({
		method: "GET",
		path: "/v1/desktop/sessions/{id}/files",
		segment: SESSION_ID,
		query: Object.freeze(["q", "limit"]),
	}),
]);

/**
 * Whether `pathname` is `route.path`, segment for segment, a `{id}` segment
 * standing for exactly ONE path segment that matches `route.segment` (never a
 * free suffix, never two segments).
 */
function routeMatches(route, pathname) {
	if (!route.path.includes("{id}")) return route.path === pathname;
	const want = route.path.split("/");
	const got = pathname.split("/");
	return (
		want.length === got.length &&
		want.every((part, i) =>
			part === "{id}" ? route.segment.test(got[i]) : part === got[i],
		)
	);
}

/**
 * Paths that would act on a session rather than read the list. Checked BEFORE
 * the allowlist, so a future allowlist edit that admitted one still refuses.
 */
export const FORBIDDEN_DAEMON_PATH =
	/(prompt|send|engage|message|\/runs?(\/|$)|resume|steer|wake|slash|\/stop|claim|turn|exec|history|stream)/i;

/** Null when `method path?query` is an allowed read; otherwise the refusal. */
export function daemonRequestProblem(method, pathWithQuery) {
	// A PATH, never a URL: `new URL("http://other/health", base)` and
	// `new URL("//other/health", base)` both ignore `base`, and WHATWG treats a
	// backslash like a slash for http, so `/\other` is a host too. Any of them
	// would pass the pathname allowlist below and carry the bearer token to
	// another origin (review r1 R1-9, QA r1 Q5-1).
	if (typeof pathWithQuery !== "string" || !/^\/(?![/\\])/.test(pathWithQuery))
		return `refused daemon call ${method} ${pathWithQuery}: only a path on the configured loopback backend (one leading /, no scheme or host)`;
	// WHATWG strips tab/CR/LF before parsing, so `/\t/host/health` passed the
	// leading-slash rule above and parsed as `//host/health` - a host. The
	// client's origin pin still refused it (QA r2 Q2-1, 0 connections), but
	// this predicate must be enough on its own: no control character, ever.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the control range IS the rule.
	if (/[\u0000-\u001f\u007f]/.test(pathWithQuery))
		return `refused daemon call ${method} ${JSON.stringify(pathWithQuery)}: a control character in the path`;
	let url;
	try {
		url = new URL(pathWithQuery, "http://127.0.0.1");
	} catch {
		return `not a path: ${pathWithQuery}`;
	}
	if (FORBIDDEN_DAEMON_PATH.test(url.pathname))
		return `refused daemon call ${method} ${url.pathname}: the harness never prompts, sends, engages or resumes`;
	const route = DAEMON_ROUTES.find(
		(r) => r.method === method && routeMatches(r, url.pathname),
	);
	if (!route)
		return `refused daemon call ${method} ${url.pathname}: not on the harness's read allowlist`;
	for (const key of url.searchParams.keys())
		if (!route.query.includes(key))
			return `refused daemon call ${method} ${url.pathname}: query key ${key} is not allowed`;
	return null;
}

/**
 * The ONE daemon client. Every HTTP call the harness makes goes through here,
 * and a call the allowlist refuses throws a `Refusal` before any byte is sent.
 * Answers the parsed JSON body (or null for an unreachable daemon / non-2xx).
 */
export async function daemonRequest(
	base,
	method,
	pathWithQuery,
	{ token = null, timeoutMs = 2000 } = {},
) {
	const problem = daemonRequestProblem(method, pathWithQuery);
	if (problem) throw new Refusal(problem);
	// Belt to the path rule: the request goes to `base`'s origin or nowhere.
	const target = new URL(pathWithQuery, base);
	if (target.origin !== new URL(base).origin)
		throw new Refusal(
			`refused daemon call ${method} ${pathWithQuery}: it resolves to ${target.origin}, not the configured backend ${new URL(base).origin}`,
		);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(target, {
			method,
			signal: controller.signal,
			headers: token ? { authorization: `Bearer ${token}` } : {},
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** The relay port a rig device's relay must use. 4097 is the operator's own relay. */
export const OPERATOR_RELAY_PORT = 4097;

/**
 * `values.network.port` from `<root>/config.yml`, read without a YAML dependency.
 *
 * WHERE THE PORT LIVES. lop keeps every setting under a top-level `values:`
 * mapping: `lop config edit network.port 14097` writes
 *
 *     values:
 *       network:
 *         port: 14097
 *
 * and core reads ONLY that mapping (local_operator/config.py `values =
 * parsed.get("values", {})`; settings_io.py `key="network.port", path=("network",
 * "port"), default=4097`). The first real Mac runs (2026-11) exited 2 on
 * every lop-written config because this read a top-level `network:` block.
 * A top-level `network.port` is NOT honoured: core ignores it (and reports the
 * stray key), so the relay would still advertise 4097. It answers null here,
 * which refuses, rather than pass a port the relay never uses.
 *
 * FAIL CLOSED. Only plain block style is read: two-space-or-any consistent
 * space indentation, bare `values:` and `network:` keys, and a decimal port,
 * optionally quoted, optionally followed by ` # comment`. Anything else -
 * flow style, anchors/aliases, tabs, document markers or directives, a
 * duplicated `values`/`network`/`port` key, a top-level line that is not a
 * plain `key:`, an indentation that steps back inside a block, or a port under
 * any other parent - answers null, which REFUSES. An unset port makes the relay
 * advertise :4097 and peers then dial the operator's real relay (measured on
 * node2: writes reached the real audit log), so guessing is never safe.
 */
export function relayPortFromConfig(text) {
	if (typeof text !== "string") return null;
	const KEY = /^( *)([A-Za-z0-9_.-]+):(?: +(.*?))? *$/;
	// A mapping key whose value is a nested block: nothing after the colon but
	// an optional comment. `values: {..}`, `network: &a`, `network: *a` are not.
	const bare = (value) => value === undefined || value.startsWith("#");
	let state = "top"; // top | values | network
	let valuesSeen = false;
	let networkSeen = false;
	let portSeen = false;
	let childIndent = null;
	let grandIndent = null;
	let port = null;
	for (const line of text.split(/\r?\n/)) {
		if (/^[ \t]*(#.*)?$/.test(line)) continue;
		if (/^\s*/.exec(line)[0].includes("\t")) return null;
		if (/^(---|\.\.\.|%)/.test(line)) return null;
		const indent = line.length - line.trimStart().length;
		const m = line.match(KEY);
		if (indent === 0) {
			if (!m) return null;
			state = "top";
			if (m[2] === "values") {
				if (valuesSeen || !bare(m[3])) return null;
				valuesSeen = true;
				state = "values";
			}
			continue;
		}
		if (state === "top") continue;
		if (state === "network") {
			if (indent > childIndent) {
				grandIndent ??= indent;
				if (indent < grandIndent) return null;
				if (indent > grandIndent) continue;
				if (!m) return null;
				if (m[2] === "port") {
					if (portSeen) return null;
					portSeen = true;
					const value = (m[3] ?? "").match(
						/^(?:(0|[1-9]\d*)|"(0|[1-9]\d*)"|'(0|[1-9]\d*)')(?: +#.*)?$/,
					);
					if (!value) return null;
					port = Number(value[1] ?? value[2] ?? value[3]);
				}
				continue;
			}
			state = "values";
		}
		childIndent ??= indent;
		if (indent < childIndent) return null;
		if (indent > childIndent) continue;
		if (!m) return null;
		if (m[2] === "network") {
			if (networkSeen || !bare(m[3])) return null;
			networkSeen = true;
			state = "network";
		}
	}
	return port;
}

export function relayPortProblem(port) {
	if (port === null || !Number.isInteger(port) || port <= 0 || port > 65535)
		return "--backend-config-root needs network.port set in <root>/config.yml as `values:` > `network:` > `port:` (what `lop config edit network.port <n>` writes; a top-level `network:` block is ignored by core), and unset the relay advertises the operator's :4097 and peers dial it";
	if (port === OPERATOR_RELAY_PORT)
		return `network.port is ${OPERATOR_RELAY_PORT}, the operator's own relay port; a rig device's relay must use another`;
	return null;
}

/** Switches only, after the absolute binary, and no `--` before them. */
export function buildAppArgv({ rig, windowMode, size, session }) {
	return [
		`--user-data-dir=${join(rig, "profile")}`,
		`--window-mode=${windowMode}`,
		`--window-size=${size}`,
		MOCK_KEYCHAIN_SWITCH,
		...(session ? [`--open-session=${session}`] : []),
	];
}

export function redactEnv(env) {
	const out = { ...env };
	if (out.LOCAL_OPERATOR_DESKTOP_TOKEN !== undefined)
		out.LOCAL_OPERATOR_DESKTOP_TOKEN = "<redacted>";
	return out;
}

/*
 * ---------------------------------------------------------------------------
 * The stdout supervisor: a pure state machine over the app's protocol lines.
 * ---------------------------------------------------------------------------
 */

/**
 * Feed it one line; it answers with what to do. Abort reasons end the run with
 * a reap. Pure, so a test walks the protocol line by line without an app.
 */
/** The app's own frame-label rule (`FRAME_LABEL`, src/main/dev-driver-script.ts). */
const FRAME_LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/*
 * The SHUTTER line's two shapes (src/main/dev-driver-script.ts). Only the label
 * and the space-free facts are READ from it: the ack and frame paths are
 * DERIVED here as `<framesDir>/<label>.ack|.png`, the same rule the app uses,
 * because a rig root containing a space split `ack=` at the space and the
 * harness then wrote to a sibling path (review r1 R1-2). The path-bearing field
 * is matched as "the rest of the line" so a space in it cannot shift a fact.
 */
const SHUTTER_EXTERNAL =
	/^SHUTTER label=(\S+) media=(\S+) visible=(true|false) focused=(true|false) ack=.+$/;
/** The window facts a SHUTTER line carries, quoted in the not-visible abort. */
const SHUTTER_FACTS = /visible=\S+ focused=\S+/;
const SHUTTER_CAPTUREPAGE =
	/^SHUTTER label=(\S+) capture=capturepage path=.+ width=(\d+) height=(\d+) visible=(true|false) focused=(true|false)$/;

export function createSupervisor({
	windowMode,
	session,
	capture,
	framesDir,
	labels = null,
	// The runner step (1-based) that spends the window wait, and its --window-wait;
	// null when the run has none. See WINDOW_WAIT_DEFAULT_S for why it exists.
	windowWait = null,
	now = Date.now,
}) {
	if (typeof framesDir !== "string" || !isAbsolute(framesDir))
		throw new TypeError(
			"createSupervisor needs the absolute framesDir it derives frame paths from",
		);
	const expected = labels === null ? null : new Set(labels);
	const shot = new Set();
	const state = {
		windowModeLine: null,
		windowStateLine: null,
		armed: false,
		scriptArmed: false,
		ready: false,
		stateChecked: session === null,
		done: false,
		steps: [],
		// The receipt's `windowWait`: how long the wait step actually took (harness
		// clock, from the line before it to its own line) and the first SHUTTER's
		// `visible`, so a run that still failed says whether the wait was spent.
		windowWait: { waitedMs: 0, visibleAtShutter: null },
	};
	let lastRunnerLineAt = null;
	const notVisible = (body) => {
		const facts = body.match(SHUTTER_FACTS)?.[0] ?? "";
		const waited =
			windowWait === null
				? "with no window wait (--window-wait 0)"
				: `after a ${state.windowWait.waitedMs} ms window wait (--window-wait ${windowWait.s})`;
		return `the window is not visible at the shutter ${waited}: ${facts}; the app had not presented its window yet (a window opened for a conversation is held until it paints, src/main/index.ts holdPresentUntilConversation), so retry with a longer --window-wait (max ${WINDOW_WAIT_MAX_S}) - never a focused or normal-mode run (${body})`;
	};
	const feed = (line) => {
		if (line.startsWith("[window-mode] window mode ")) {
			state.windowModeLine = line;
			const mode = line
				.slice("[window-mode] window mode ".length)
				.split(/[:\s]/)[0];
			if (mode !== windowMode)
				return {
					abort: `the app resolved window mode "${mode}", not "${windowMode}": ${line}`,
				};
			return null;
		}
		if (line.startsWith("[window-mode] state:")) {
			state.windowStateLine = line;
			if (/\bfocused=true\b/.test(line))
				return { abort: `the app's window took focus: ${line}` };
			return null;
		}
		if (line.startsWith("[dev-driver] ARMED")) {
			state.armed = true;
			return null;
		}
		if (line.startsWith("[dev-driver] not armed"))
			return { abort: `the dev driver did not arm: ${line}` };
		if (!line.startsWith("[dev-driver-script]")) return null;
		const body = line.slice("[dev-driver-script] ".length);
		if (body.startsWith("ARMED")) {
			state.scriptArmed = true;
			return null;
		}
		if (body.startsWith("refused:"))
			return { abort: `the step runner refused: ${body}` };
		if (body.startsWith("ready ")) {
			state.ready = true;
			lastRunnerLineAt = now();
			return null;
		}
		const step = body.match(/^step=(\d+) verb=(\S+) (ok|error:|skipped)(.*)$/);
		if (step) {
			const [, n, verb, outcome, rest] = step;
			const at = now();
			if (windowWait !== null && Number(n) === windowWait.step)
				state.windowWait.waitedMs = at - (lastRunnerLineAt ?? at);
			lastRunnerLineAt = at;
			state.steps.push({
				step: Number(n),
				verb,
				outcome: outcome.replace(":", ""),
				detail: rest.trim().slice(0, 600),
			});
			if (outcome === "error:")
				return { abort: `step ${n} (${verb}) failed:${rest}` };
			if (verb === "state" && outcome === "ok" && session !== null) {
				const id = rest.match(/"activeSessionId":"([a-f0-9]*)"/)?.[1] ?? null;
				if (id !== session)
					return {
						abort: `the app shows conversation ${id ?? "none"}, not --session ${session}; refusing to photograph it under that name`,
					};
				state.stateChecked = true;
			}
			return null;
		}
		if (body.startsWith("SHUTTER ")) {
			if (!state.armed || !state.scriptArmed || !state.windowModeLine)
				return {
					abort:
						"a SHUTTER arrived before the app announced its window mode and arming",
				};
			if (!state.stateChecked)
				return {
					abort: "a SHUTTER arrived before the conversation was verified",
				};
			const external = capture === "screencapture";
			const m = body.match(external ? SHUTTER_EXTERNAL : SHUTTER_CAPTUREPAGE);
			if (!m)
				return {
					abort: `expected a ${external ? "window-server (media=, ack=)" : "capturepage"} SHUTTER (${body})`,
				};
			const label = m[1];
			// The label names files the harness writes: the app's own rule, one of
			// the frames this run asked for, and each at most once.
			if (!FRAME_LABEL.test(label) || (expected && !expected.has(label)))
				return {
					abort: `the SHUTTER names a frame this run did not ask for (${body})`,
				};
			if (shot.has(label))
				return { abort: `a second SHUTTER for ${label} (${body})` };
			const [visible, focused] = external ? [m[3], m[4]] : [m[4], m[5]];
			if (state.windowWait.visibleAtShutter === null)
				state.windowWait.visibleAtShutter = visible === "true";
			if (focused !== "false")
				return { abort: `the window is focused at the shutter (${body})` };
			if (external) {
				if (visible !== "true") return { abort: notVisible(body) };
				const id = m[2].match(/^window:(\d+):/)?.[1];
				if (!id)
					return { abort: `the SHUTTER line carries no window id (${body})` };
				shot.add(label);
				return {
					shutter: {
						label,
						windowId: Number(id),
						ack: join(framesDir, `${label}.ack`),
					},
				};
			}
			shot.add(label);
			return {
				shutter: {
					label,
					path: join(framesDir, `${label}.png`),
					width: Number(m[2]),
					height: Number(m[3]),
				},
			};
		}
		if (body.startsWith("FAILED"))
			return { abort: `the step runner failed (${body})` };
		if (body.startsWith("DONE")) {
			state.done = true;
			return { done: true };
		}
		return null;
	};
	return { feed, state };
}

/*
 * ---------------------------------------------------------------------------
 * macOS capture: JXA window lookup, TCC preflight, screencapture.
 * All Mac-only; none of it runs on Linux (capturepage mode skips it).
 * ---------------------------------------------------------------------------
 */

function jxa(source) {
	const run = spawnSync("osascript", ["-l", "JavaScript", "-e", source], {
		encoding: "utf8",
		timeout: 20000,
	});
	if (run.status !== 0)
		throw new Error(`osascript failed: ${(run.stderr || "").trim()}`);
	return run.stdout.trim();
}

/**
 * Screen Recording, asked WITHOUT a prompt: `CGPreflightScreenCaptureAccess`
 * never prompts (its request-side sibling would put a dialog on the operator's
 * screen, so this source never names it - a test asserts that).
 *
 * TWO WAYS TO REACH THE SAME C FUNCTION. `ObjC.import('CoreGraphics')` bridges
 * the symbol on older macOS; on macOS 27 the bridged `$` has no function by
 * that name, so the first real Mac run answered unknown and exited 3 BLOCKED.
 * JXA's documented C binding, `ObjC.bindFunction(name, [returnType,
 * [argTypes]])`, declares the signature itself (`bool (void)`) and then `$.<name>`
 * calls it. Measured by manager 79bddc262663 on Damian's Mac (Darwin 27.2): the
 * bindFunction path returned `{"granted":true}`. Each step is in its own try,
 * and only a boolean (or the C bool's 0/1) is an answer.
 *
 * Output is exactly `{"granted": true|false|null}`. Null - neither path could
 * call the preflight - is UNKNOWN and BLOCKED by the caller, never guessed. An
 * earlier fallback read "another process's window has a kCGWindowName" as
 * granted, but system UI (Menubar, Dock, Window Server) reports names without
 * the permission, so it could answer yes while ungranted; `screencapture -l`
 * would then raise the TCC prompt on the operator's screen and photograph an
 * empty window (review r1 R1-1). Not being able to ask safely is a stop.
 */
export const SCREEN_RECORDING_PREFLIGHT_JXA = `
ObjC.import('CoreGraphics');
var granted = null;
var callable = false;
try { callable = typeof $.CGPreflightScreenCaptureAccess === 'function'; } catch (e) {}
if (!callable) {
	try { ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]); callable = true; } catch (e) {}
}
if (callable) {
	try {
		var answer = $.CGPreflightScreenCaptureAccess();
		if (answer === true || answer === false) granted = answer;
		else if (answer === 0 || answer === 1) granted = answer === 1;
	} catch (e) {}
}
JSON.stringify({granted: granted});`;

/** Runs `SCREEN_RECORDING_PREFLIGHT_JXA`: "granted", "denied" or "unknown". */
export function screenRecordingGranted() {
	return screenRecordingVerdict(jxa(SCREEN_RECORDING_PREFLIGHT_JXA));
}

/**
 * Who macOS asks about Screen Recording: the TCC "responsible" app is the
 * nearest `.app` bundle up this process's parent chain (Terminal, iTerm, the
 * agent's own app). The BLOCKED/denied messages name it so the operator knows
 * which row to tick; the harness itself never requests or changes TCC.
 *
 * `psTable` is `ps -A -o pid=,ppid=,comm=` output (C locale). Walks from `pid`
 * to the first ancestor whose `comm` is a `<X>.app/Contents/MacOS/...`
 * executable and answers `{ host: "<X>.app", kind: "app" }` (the OUTERMOST
 * bundle in the path, so a nested Helper.app names its parent app). With no
 * .app ancestor it answers the top non-launchd entry as `kind: "process"`:
 * measured by 79bddc262663 on the Mac, the agent shell's chain was
 * `48300 /opt/homebrew/bin/bash` -> `20192 Local Operator [session]
 * id=79bddc26` -> launchd, a renamed process title with no bundle path, so the
 * title is the best name available. Null when the chain cannot be read.
 */
export function tccHostFromPsTable(psTable, pid) {
	const rows = new Map();
	for (const line of String(psTable ?? "").split("\n")) {
		const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/);
		if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3] });
	}
	const launchd = (at, row) => at === 1 || /(^|\/)launchd$/.test(row.comm);
	let top = null;
	const seen = new Set();
	for (let at = pid; rows.has(at) && !seen.has(at); at = rows.get(at).ppid) {
		seen.add(at);
		const row = rows.get(at);
		if (launchd(at, row)) break;
		const bundle = row.comm.match(/^(?:.*?\/)?([^/]+?\.app)\/Contents\//);
		if (bundle && /\.app\/Contents\/MacOS\/[^/]+$/.test(row.comm))
			return { host: bundle[1], kind: "app", pid: at };
		top = { host: row.comm, kind: "process", pid: at };
	}
	return top;
}

/** The TCC host of this process, from one `ps` snapshot; null if unreadable. */
export function tccHost(pid = process.pid) {
	try {
		const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid=,comm="], {
			encoding: "utf8",
			env: cLocaleEnv(),
			timeout: 10000,
		});
		if (ps.error || ps.status !== 0) return null;
		return tccHostFromPsTable(ps.stdout, pid);
	} catch {
		return null;
	}
}

/** The operator-facing instruction naming the TCC host (never a request). */
export function screenRecordingGrantHint(host) {
	const who = host?.host
		? `${host.host}${host.kind === "process" ? ` (pid ${host.pid}, the top of this process's parent chain; no .app ancestor was found)` : ""}`
		: "this process's host (the terminal or agent app; its parent chain could not be read)";
	return `grant Screen & System Audio Recording to ${who} in System Settings > Privacy & Security; this harness never requests or changes it (that would prompt)`;
}

/** The JXA preflight's output, read strictly: only a boolean is an answer. */
export function screenRecordingVerdict(jxaOutput) {
	let granted;
	try {
		granted = JSON.parse(jxaOutput)?.granted;
	} catch {
		return "unknown";
	}
	if (granted === true) return "granted";
	if (granted === false) return "denied";
	return "unknown";
}

/**
 * Whether a `screencapture -o -l` PNG is the window CGWindowList described:
 * pixel size = `kCGWindowBounds` (points) x one backing scale for both axes.
 * A frame of some other size (a different window, the desktop, a truncated
 * write) is refused rather than labelled real vibrancy (review r1 R1-1 belt).
 * Scales: 1 and 2 are the Mac's backing factors; 3 is allowed defensively. The
 * 2 px slack is rounding of fractional point bounds; `-o` drops the shadow, so
 * no shadow margin is allowed.
 */
export function frameMatchesWindow(pixels, bounds) {
	if (!pixels || !bounds) return null;
	const w = Number(bounds.Width);
	const h = Number(bounds.Height);
	if (!(w > 0 && h > 0)) return null;
	for (const scale of [1, 2, 3])
		if (
			Math.abs(pixels.width - w * scale) <= 2 &&
			Math.abs(pixels.height - h * scale) <= 2
		)
			return scale;
	return null;
}

/** Owner pid, layer and bounds of one on-screen window. Needs no Screen Recording. */
export function windowInfo(windowId) {
	const out = jxa(`
ObjC.import('CoreGraphics');
var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
var w = list.filter(function (x) { return x.kCGWindowNumber === ${Number(windowId)}; })[0];
JSON.stringify(w ? {pid: w.kCGWindowOwnerPID, layer: w.kCGWindowLayer, bounds: w.kCGWindowBounds} : null);`);
	return JSON.parse(out);
}

/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG. */
export function pngSize(buffer) {
	if (
		buffer.length < 24 ||
		buffer.readUInt32BE(0) !== 0x89504e47 ||
		buffer.toString("ascii", 12, 16) !== "IHDR"
	)
		return null;
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/*
 * ---------------------------------------------------------------------------
 * Process plumbing.
 * ---------------------------------------------------------------------------
 */

/** `lop` on PATH, made absolute, so the spawn never depends on the child's PATH. */
export function resolveOnPath(name, pathValue = process.env.PATH ?? "") {
	for (const dir of pathValue.split(delimiter)) {
		if (!dir || !isAbsolute(dir)) continue;
		const candidate = join(dir, name);
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return null;
}

export function freeLoopbackPort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});
}

async function getHealth(url, timeoutMs = 2000) {
	const body = await daemonRequest(url, "GET", "/health", { timeoutMs });
	return body ? (body.result ?? body) : null;
}

/**
 * Wait until the daemon lists `session` as a REMOTE row (--backend-config-root).
 * The first reads on node2 came back empty until the peer row cache refreshed,
 * so this polls; the bound is a containment, not a measured distribution (none
 * exists yet), and a miss fails the run rather than photographing an empty list.
 */
export async function waitForRemoteSession(
	base,
	token,
	session,
	{ timeoutMs = 120_000, pollMs = 1000, shouldStop = () => null } = {},
) {
	const deadline = Date.now() + timeoutMs;
	let reads = 0;
	let last = null;
	for (;;) {
		// The run's own end (signal, child failure, whole-run --timeout) wins
		// over this wait's bound.
		const stop = shouldStop();
		if (stop)
			throw new Error(`${stop} (waiting for remote session ${session})`);
		reads++;
		const body = await daemonRequest(
			base,
			"GET",
			"/v1/desktop/sessions?include_peers=true&limit=500",
			{ token, timeoutMs: 5000 },
		);
		const rows = body?.result?.sessions ?? body?.sessions ?? [];
		const row = rows.find((r) => r?.id === session);
		last = row ? (row.locality ?? "local") : null;
		if (row && row.locality === "remote") return { reads, locality: "remote" };
		if (Date.now() >= deadline)
			throw new Error(
				`session ${session} did not appear as a remote row on the rig daemon within ${Math.round(timeoutMs / 1000)} s (${reads} reads; last seen: ${last ?? "absent"}); not capturing`,
			);
		await sleep(pollMs);
	}
}

/*
 * ---------------------------------------------------------------------------
 * Provenance: what makes a Library or file-preview frame proof of the REMOTE
 * path rather than a picture of local data that happens to look the same.
 * ---------------------------------------------------------------------------
 *
 * WHY. Both frames are meant to show a PEER's files through this device. A
 * library row with a local path, or a session whose transcript the rig holds in
 * its own `<config>/sessions`, renders the same pixels while proving nothing
 * about the remote route. So after the frames, while the rig daemon is still up,
 * the harness reads the data behind them back (allowlisted GETs only) and the
 * run FAILS (exit 1) when either is not remote. The receipt keeps what it
 * judged, so a reader can check the verdict without the rig.
 *
 * PRIVACY (security review S1/S2). Receipts and frames are attached to PRs in a
 * PUBLIC repository, so the receipt records only booleans about the peer and
 * the local disk - `remote`, `originDeviceKnown`, `localPath` - never the
 * peer's device id or name, nor an absolute local path (not even in a
 * `problem` sentence). The opaque row ids (`la_...`, the index row id) stay: they
 * name nothing outside the daemon that issued them.
 */

/**
 * `libraryProvenance` from the first row of the desktop's own listing and that
 * row's detail. A peer row: `remote` set and NO local `ref.path` (core keeps no
 * local path identity for a row only a peer references). `source` is the row's
 * `origin` (LibraryRow has no field named `source`). `remote` and `localPath`
 * are booleans: whether the row carries a remote block / a local path.
 */
export function libraryProvenanceCheck(listing, detail) {
	const first = (listing?.result ?? listing)?.rows?.[0] ?? null;
	const row = detail?.result ?? detail ?? null;
	if (!first?.id || !row)
		return {
			assetId: first?.id ?? null,
			remote: null,
			localPath: null,
			source: null,
			pass: false,
			problem: first?.id
				? `library row ${first.id} could not be read back`
				: "the library listing has no row to check",
		};
	const remote = (row.remote ?? null) !== null;
	const localPath = (row.ref?.path ?? null) !== null;
	const pass = remote && !localPath;
	return {
		assetId: row.id ?? first.id,
		remote,
		localPath,
		source: row.origin ?? null,
		pass,
		...(pass
			? {}
			: {
					problem: !remote
						? `library row ${first.id} is not a peer row (remote is null)`
						: `library row ${first.id} has a local path`,
				}),
	};
}

/**
 * `imagePreview` from --session's file index row named `name` and whether the
 * rig holds that session itself. Passes only for a row the daemon stamped
 * `remote` (a peer's index) in a session the rig's config root does NOT hold:
 * a session present under `<config>/sessions` could have been served from this
 * disk, so its picture would not prove the remote read.
 */
export function imagePreviewCheck({ listing, name, sessionOnRig }) {
	const rows = (listing?.result ?? listing)?.rows ?? [];
	// EXACT name, and exactly one (F4): the scene's row selector cannot count,
	// so two same-named rows (two folders) would make the frame ambiguous.
	const named = rows.filter((r) => r?.name === name);
	const row = named.length === 1 ? named[0] : null;
	const remote = row ? row.remote === true : null;
	const problems = [];
	if (named.length > 1)
		problems.push(
			`${named.length} file rows are named ${name} in the session's index (the frame cannot say which one it shows)`,
		);
	else if (!row)
		problems.push(`no file row named ${name} in the session's index`);
	else if (!remote) problems.push(`file row ${row.id} is not remote`);
	if (sessionOnRig !== false)
		problems.push(
			sessionOnRig === null
				? "no rig config root to check the session against (attach mode)"
				: "the session is present in the rig's own <config>/sessions",
		);
	return {
		assetId: row?.id ?? null,
		remote,
		matchingRows: named.length,
		// Whether the daemon named an origin device - never which one (S2).
		originDeviceKnown: row ? (row.origin_device ?? null) !== null : null,
		sessionOnRig,
		pass: problems.length === 0,
		...(problems.length ? { problem: problems.join("; ") } : {}),
	};
}

/** Read the first library row back (the one the Library frame shows first). */
export async function readLibraryProvenance(base, token, { timeoutMs }) {
	const listing = await daemonRequest(
		base,
		"GET",
		"/v1/desktop/library/assets?scope=final&limit=1",
		{ token, timeoutMs },
	);
	const id = (listing?.result ?? listing)?.rows?.[0]?.id;
	const detail =
		typeof id === "string" && LIBRARY_ASSET_ID.test(id)
			? await daemonRequest(base, "GET", `/v1/desktop/library/assets/${id}`, {
					token,
					timeoutMs,
				})
			: null;
	return libraryProvenanceCheck(listing, detail);
}

/**
 * Core's own bound on the peer index call it makes for this read
 * (network/file_index.py:48 `INDEX_CLIENT_TIMEOUT_S = 45.0`), plus margin, so
 * the harness never abandons a read core is still allowed to finish.
 */
export const PEER_INDEX_READ_MS = 50_000;

/** Read the previewed row back from --session's index; `configRoot` null = attach. */
export async function readImagePreview(
	base,
	token,
	{ session, name, configRoot, timeoutMs },
) {
	const listing = await daemonRequest(
		base,
		"GET",
		`/v1/desktop/sessions/${session}/files?q=${encodeURIComponent(name)}&limit=50`,
		{ token, timeoutMs: Math.min(PEER_INDEX_READ_MS, timeoutMs) },
	);
	const sessionOnRig =
		configRoot === null
			? null
			: existsSync(join(configRoot, "sessions", session));
	return imagePreviewCheck({ listing, name, sessionOnRig });
}

/**
 * Read the --seed's rows back from the real daemon through the allowlisted
 * client, retrying briefly (the first read can race the daemon's own startup
 * work), and BLOCK the run when they never come back. BLOCKED (exit 3), not
 * FAILED: nothing about the app is known yet - the rig cannot show the state the
 * frame would be named for, so no frame is taken at all.
 */
export async function verifySeedRows(
	base,
	token,
	expect,
	{ deadline = Date.now() + 10_000, pollMs = 250 } = {},
) {
	let reads = 0;
	for (;;) {
		reads++;
		const body = await daemonRequest(base, "GET", expect.path, {
			token,
			timeoutMs: 5000,
		});
		const problem = seedRowsProblem(expect, body);
		if (problem === null) return { path: expect.path, reads, ok: true };
		if (Date.now() >= deadline)
			throw new Refusal(
				`BLOCKED: the rig daemon did not read the --seed ${expect.scenario} rows back after ${reads} read(s): ${problem}; a frame now would show an empty state, not the seed`,
				EXIT.BLOCKED,
			);
		await sleep(pollMs);
	}
}

/** Whether something accepts TCP on 127.0.0.1:port. */
function portListening(port) {
	return new Promise((done) => {
		const socket = connect({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			done(true);
		});
		socket.once("error", () => done(false));
	});
}

/**
 * Whether EVERY TCP listener on 127.0.0.1-reachable `port` belongs to one of
 * `pids` (the relay this run spawned and its descendants). True / false, or
 * null when the sockets could not be read (callers fail closed). Linux maps
 * the LISTEN rows of /proc/net/tcp{,6} to socket inodes and checks those are
 * held by `pids`' own fds - it reads only our processes, never a stranger's;
 * macOS asks `lsof` which pids listen on the port.
 */
export function portListenerOwned(port, pids) {
	const ours = new Set(pids.filter((p) => Number.isInteger(p) && p > 0));
	if (process.platform === "linux") {
		const listening = new Set();
		let readAny = false;
		for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
			let text;
			try {
				text = readFileSync(table, "utf8");
				readAny = true;
			} catch {
				continue;
			}
			for (const line of text.split("\n").slice(1)) {
				const f = line.trim().split(/\s+/);
				if (f.length < 10 || f[3] !== "0A") continue;
				if (Number.parseInt(f[1].split(":").pop(), 16) === port)
					listening.add(f[9]);
			}
		}
		if (!readAny) return null;
		if (listening.size === 0) return false;
		const held = new Set();
		for (const pid of ours) {
			let fds = [];
			try {
				fds = readdirSync(`/proc/${pid}/fd`);
			} catch {
				continue;
			}
			for (const fd of fds)
				try {
					const m = readlinkSync(`/proc/${pid}/fd/${fd}`).match(
						/^socket:\[(\d+)\]$/,
					);
					if (m) held.add(m[1]);
				} catch {}
		}
		return [...listening].every((inode) => held.has(inode));
	}
	// WHAT THIS CANNOT SEE (review r2 R2-4): non-root `lsof` lists only the
	// invoking user's sockets, so "every listener is ours" is blind to a root- or
	// other-user listener that binds between the preflight probe and our relay.
	// The preflight CONNECT probe (`portListening` in `main`) is what covers
	// those - it is not redundant with this check, and must not be dropped.
	const lsof = spawnSync(
		"lsof",
		["-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
		{ encoding: "utf8", timeout: 10000, env: cLocaleEnv() },
	);
	if (lsof.error || lsof.status === null) return null;
	const owners = (lsof.stdout ?? "")
		.split("\n")
		.filter((line) => line.startsWith("p"))
		.map((line) => Number(line.slice(1)));
	if (owners.length === 0) return false;
	return owners.every((pid) => ours.has(pid));
}

/**
 * Every process carrying `configRoot` in its environment or argv - how a lop
 * daemon's STANDBY RUNTIMES are found: they run in their OWN process groups
 * (measured: 4 extra pgids per serve), so the daemon's group signal misses them.
 * Linux reads /proc/<pid>/environ; macOS reads `ps -E` (same-user env). Returns
 * null when nothing could be read, which callers treat as NOT clean.
 */
export function processesWithConfigRoot(configRoot) {
	// The ENVIRONMENT variable only, never a bare path in argv: the harness's own
	// command line (and the shell or agent that ran it) names the root as
	// `--backend-config-root <root>`, and a sweep that matched argv would kill
	// its own caller. This process and its ancestors are excluded for the same
	// reason.
	const needle = `LOCAL_OPERATOR_CONFIG_DIR=${configRoot}`;
	const matches = (text) => text.split(/\0|\s/).some((part) => part === needle);
	const mine = new Set(ancestorsOfSelf());
	const found = [];
	if (process.platform === "linux") {
		let entries;
		try {
			entries = readdirSync("/proc").filter((e) => /^\d+$/.test(e));
		} catch {
			return null;
		}
		for (const entry of entries) {
			const pid = Number(entry);
			if (mine.has(pid)) continue;
			let text = "";
			try {
				text = readFileSync(`/proc/${entry}/environ`, "utf8");
			} catch {
				continue;
			}
			if (matches(text)) found.push(pid);
		}
		return found;
	}
	const ps = spawnSync("ps", ["-A", "-E", "-ww", "-o", "pid=,command="], {
		encoding: "utf8",
		env: cLocaleEnv(),
	});
	if (ps.error || ps.status !== 0) return null;
	for (const line of ps.stdout.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(.*)$/);
		if (m && !mine.has(Number(m[1])) && matches(m[2])) found.push(Number(m[1]));
	}
	return found;
}

/**
 * Reap every process this run's lop processes left behind: the config-root
 * sweep above plus the descendants recorded while they ran. Exact pids only
 * (never a pattern), each re-checked as this run's at kill time, and a group
 * only when its leader is one of ours (`killRigMatched`).
 */
async function reapConfigRootProcesses(
	configRoot,
	recorded,
	rig,
	identities = new Map(),
	unknownStart = new Set(),
) {
	const pids = new Set(recorded);
	for (const pid of processesWithConfigRoot(configRoot) ?? []) pids.add(pid);
	const left = await killRigMatched(
		[...pids],
		rigMatcher({ rig, configRoot }),
		{
			settleMs: 500,
			identities,
			unknownStart,
		},
	);
	const after = processesWithConfigRoot(configRoot);
	const survivors =
		after === null ? null : after.filter((pid) => pidAlive(pid));
	return {
		swept: pids.size,
		survivors: survivors === null ? "unreadable" : survivors.length,
		clean: survivors !== null && survivors.length === 0 && left.length === 0,
	};
}

/** This process and every ancestor up to init: never a sweep target. */
function ancestorsOfSelf() {
	const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], {
		encoding: "utf8",
		env: cLocaleEnv(),
	});
	const parent = new Map();
	for (const line of (ps.stdout ?? "").split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(\d+)$/);
		if (m) parent.set(Number(m[1]), Number(m[2]));
	}
	const out = [process.pid];
	let at = process.ppid;
	while (at > 1 && !out.includes(at)) {
		out.push(at);
		at = parent.get(at) ?? 0;
	}
	return out;
}

/**
 * Every process whose working directory is the rig or inside it - the last
 * backstop of the reap. The app and every lop process are spawned with
 * `cwd=<rig>`, and children inherit it, so a helper that escaped both its
 * process group and the profile/config-root scans (re-parented, own group,
 * different argv) is still found by WHERE it runs. The rig is a fresh mkdtemp
 * path, so nothing else can be there. Linux reads /proc/<pid>/cwd; macOS asks
 * `lsof -d cwd`. This process and its ancestors are never targets. Returns null
 * when nothing could be read (treated as not clean).
 */
export function processesWithCwdUnder(rig) {
	const mine = new Set(ancestorsOfSelf());
	const inRig = (path) => path === rig || path.startsWith(`${rig}${sep}`);
	const found = [];
	if (process.platform === "linux") {
		let entries;
		try {
			entries = readdirSync("/proc").filter((e) => /^\d+$/.test(e));
		} catch {
			return null;
		}
		for (const entry of entries) {
			const pid = Number(entry);
			if (mine.has(pid)) continue;
			try {
				if (inRig(readlinkSync(`/proc/${entry}/cwd`))) found.push(pid);
			} catch {}
		}
		return found;
	}
	const lsof = spawnSync("lsof", ["-n", "-P", "-d", "cwd", "-F", "pn"], {
		encoding: "utf8",
		timeout: 30000,
		env: cLocaleEnv(),
	});
	if (lsof.error || lsof.status === null) return null;
	let pid = null;
	for (const line of (lsof.stdout ?? "").split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (
			line.startsWith("n") &&
			pid &&
			!mine.has(pid) &&
			inRig(line.slice(1))
		)
			found.push(pid);
	}
	return found;
}

/**
 * What the backstop needs to know about live pids, read from the kernel at kill
 * time: working directory, process group, START TIME and argv+env as text.
 * Linux reads /proc. macOS asks `ps` (`-E` appends the environment, same user
 * only) and `lsof -d cwd` - ONE call each for every pid, under ONE deadline
 * (review r2 R2-2: one `ps` + one 10 s `lsof` PER candidate, twice per target,
 * could carry a slow `lsof` past the documented caller timeout). A pid absent
 * from the answer is gone or unreadable; `cwd: null` means unreadable (deadline
 * hit or `lsof` refused), which the matcher then simply does not use.
 *
 * `start` is the identity half of (pid, start time) (review r2 R2-1): Linux
 * `/proc/<pid>/stat` field 22 (clock ticks since boot), macOS `ps -o lstart`
 * (second resolution). A recycled pid has a different start; the same process
 * always has the same one.
 *
 * A line whose start does not parse is NOT dropped (review r1 R1-1): it keeps
 * its pid, pgid and text with `start: null`, so the identity is UNKNOWN rather
 * than the pid vanishing from the reap set. `ps` runs under the C locale, so
 * that should never happen; if it does, the reap says so instead of reading
 * clean.
 */
export function processFactsMany(
	pids,
	{ deadline = Date.now() + 15_000, cwd: wantCwd = true } = {},
) {
	const facts = new Map();
	const wanted = [...new Set(pids)].filter(
		(pid) => Number.isInteger(pid) && pid > 0,
	);
	if (wanted.length === 0) return facts;
	if (process.platform === "linux") {
		for (const pid of wanted) {
			try {
				const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
				// Counted after the parenthesised comm, which may hold spaces: the
				// first field there is field 3 (state), so field N is index N-3.
				const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
				let cwd = null;
				if (wantCwd)
					try {
						cwd = readlinkSync(`/proc/${pid}/cwd`);
					} catch {}
				let text = "";
				for (const file of ["cmdline", "environ"])
					try {
						text += `\0${readFileSync(`/proc/${pid}/${file}`, "utf8")}`;
					} catch {}
				facts.set(pid, {
					pid,
					pgid: Number(fields[2]),
					start: fields[19] ?? null,
					cwd,
					text,
				});
			} catch {}
		}
		return facts;
	}
	const remaining = () => Math.max(1000, deadline - Date.now());
	const list = wanted.join(",");
	// Not `status === 0`: ps exits 1 when ANY listed pid is gone, and still
	// prints the live ones. Only a spawn error or a timeout is unreadable.
	const ps = spawnSync(
		"ps",
		["-E", "-ww", "-o", "pid=,pgid=,lstart=,command=", "-p", list],
		{ encoding: "utf8", timeout: remaining(), env: cLocaleEnv() },
	);
	if (ps.error || ps.status === null) return facts;
	for (const line of (ps.stdout ?? "").split("\n")) {
		const parsed = parsePsFactsLine(line);
		if (parsed) facts.set(parsed.pid, parsed);
	}
	if (!wantCwd || facts.size === 0 || Date.now() >= deadline) return facts;
	const lsof = spawnSync(
		"lsof",
		[
			"-b",
			"-w",
			"-n",
			"-P",
			"-a",
			"-p",
			[...facts.keys()].join(","),
			"-d",
			"cwd",
			"-F",
			"pn",
		],
		{ encoding: "utf8", timeout: remaining(), env: cLocaleEnv() },
	);
	if (lsof.error || lsof.status === null) return facts;
	let current = null;
	for (const line of (lsof.stdout ?? "").split("\n")) {
		if (line.startsWith("p"))
			current = facts.get(Number(line.slice(1))) ?? null;
		else if (line.startsWith("n") && current) current.cwd = line.slice(1);
	}
	return facts;
}

/**
 * The environment every `ps`/`lsof` whose output is PARSED runs under (review
 * r1 R1-1). macOS `ps` prints `lstart` with strftime("%c") after
 * setlocale(LC_ALL, "") (adv_cmds ps/print.c `lstarted`, ps/ps.c), so an en_GB
 * Mac answers `Mon 16 Nov 10:00:00 2026` and a de_DE one `Mo 16 Nov ...`, and
 * the inherited LANG/LC_ALL decide it. LC_ALL overrides every LC_* category;
 * LANG is pinned too so nothing falls back to the operator's locale.
 */
export function cLocaleEnv(env = process.env) {
	return { ...env, LC_ALL: "C", LANG: "C" };
}

/** The C-locale `lstart` (`Mon Nov 16 10:00:00 2026`) between pgid and command. */
const PS_FACTS_LINE =
	/^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+([\s\S]*)$/;
/** The same line with the start in any shape: identity unknown, pid still seen. */
const PS_PID_PGID_LINE = /^\s*(\d+)\s+(\d+)\s+([\s\S]*)$/;

/**
 * One `ps -o pid=,pgid=,lstart=,command=` line. A line with a pid and pgid but
 * a start in any other shape yields `start: null` and `startUnparsed: true`
 * (identity unknown, never "no such pid"); its text is everything after the
 * pgid, so the content matcher still sees the command and environment. A line
 * with no leading pid/pgid (blank) is null.
 */
export function parsePsFactsLine(line) {
	const m = line.match(PS_FACTS_LINE);
	if (m)
		return {
			pid: Number(m[1]),
			pgid: Number(m[2]),
			start: m[3].replace(/\s+/g, " "),
			cwd: null,
			text: m[4],
		};
	const loose = line.match(PS_PID_PGID_LINE);
	if (!loose) return null;
	return {
		pid: Number(loose[1]),
		pgid: Number(loose[2]),
		start: null,
		startUnparsed: true,
		cwd: null,
		text: loose[3],
	};
}

/**
 * What `identities` holds for a pid this run recorded but whose start time could
 * not be read into a comparable form. Never equal to a real start (Linux: clock
 * ticks; macOS: a C-locale date), so it can never "match" a recycled pid.
 */
export const UNKNOWN_START = "unknown";

/** One pid's facts (`processFactsMany` for a single pid); null when gone or unreadable. */
export function processFacts(pid) {
	return processFactsMany([pid]).get(pid) ?? null;
}

/**
 * Record (pid, start time) for pids this run started or saw descend from what
 * it started, the first time each is seen. Only the start is read (no cwd), in
 * one batch. A pid whose start cannot be read is simply not recorded, so the
 * content matcher still decides for it.
 */
export function rememberIdentities(identities, pids) {
	const fresh = [...new Set(pids)].filter(
		(pid) => Number.isInteger(pid) && pid > 1 && !identities.has(pid),
	);
	if (fresh.length === 0) return identities;
	// A read pid whose start did not parse is recorded as UNKNOWN (review r1
	// R1-1): dropping it used to make `killRigMatched` skip it as a stranger and
	// report the reap clean.
	for (const [pid, facts] of processFactsMany(fresh, { cwd: false }))
		identities.set(pid, facts.start ?? UNKNOWN_START);
	return identities;
}

/**
 * Does this process belong to THIS run? True when its cwd is the rig or inside
 * it, when its argv/env names a path in the rig (`--user-data-dir=<rig>/profile`,
 * `HOME=<rig>/home`, the frames dir), or when its env carries this run's
 * `LOCAL_OPERATOR_CONFIG_DIR` (a durable `--backend-config-root` sits outside
 * the rig). The rig is a fresh mkdtemp name, so a match is never a stranger's.
 */
export function rigMatcher({ rig, configRoot = null }) {
	const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const inRig = new RegExp(`${esc(rig)}(?=$|[\\s\\0${esc(sep)}])`);
	const config =
		configRoot === null
			? null
			: new RegExp(
					`(?:^|[\\s\\0])LOCAL_OPERATOR_CONFIG_DIR=${esc(configRoot)}(?=$|[\\s\\0])`,
				);
	return (facts) => {
		if (!facts) return false;
		const cwd = facts.cwd ?? "";
		if (cwd === rig || cwd.startsWith(`${rig}${sep}`)) return true;
		if (inRig.test(facts.text)) return true;
		return config?.test(facts.text) === true;
	};
}

/**
 * The stray-pid backstop. Which pids are ours is decided two ways:
 *
 *   - a pid in `identities` (recorded by this run with its start time) is ours
 *     exactly while its start time still matches - whatever it looks like now.
 *     A recorded child that scrubbed its env and `chdir`ed out of the rig used to
 *     be skipped by the content matcher and left out of the count, so it
 *     survived under a clean receipt (review r2 R2-1). A recycled pid has a new
 *     start and is never touched.
 *   - any other pid (found only by a sweep) is ours when `matches` its facts.
 *
 * The GROUP is signalled only for a recorded pid that leads its own group: a
 * sweep-only pid gets a plain pid signal, so a stray shell someone `cd`ed into
 * the rig under `setsid` no longer takes its non-rig children with it (review r2
 * R2-3; r1 R1-10 had already stopped the group signal for non-leaders). This
 * process and its ancestors are never targets. Facts are read in one batch
 * under `deadlineMs` (R2-2).
 *
 * A recorded pid whose identity is UNKNOWN (its start did not parse, now or
 * when recorded; review r1 R1-1) stays a target: it is signalled by pid (never
 * its group, which needs a verified identity) and added to `unknownStart` for
 * the receipt. A sweep-only pid whose start did not parse is still decided by
 * `matches` and noted the same way. An unparsed line never shrinks the set.
 *
 * Answers the pids still ours and alive afterwards, plus any RECORDED pid that
 * is alive but could not be read at all (unknown is not clean).
 */
export async function killRigMatched(
	pids,
	matches,
	{
		settleMs = 300,
		identities = new Map(),
		deadlineMs = 20_000,
		unknownStart = new Set(),
	} = {},
) {
	const mine = new Set(ancestorsOfSelf());
	const candidates = [...new Set(pids)].filter(
		(pid) => Number.isInteger(pid) && pid > 1 && !mine.has(pid),
	);
	const deadline = Date.now() + deadlineMs;
	const recordedAs = (pid, facts) =>
		identities.has(pid) && facts?.start === identities.get(pid);
	const ours = (pid, facts) => {
		if (!facts) return false;
		const unknown = !facts.start;
		if (identities.has(pid)) {
			if (unknown || identities.get(pid) === UNKNOWN_START) {
				unknownStart.add(pid);
				return true;
			}
			return recordedAs(pid, facts);
		}
		if (unknown) unknownStart.add(pid);
		return matches(facts);
	};
	const before = processFactsMany(candidates, { deadline });
	const unreadable = candidates.filter(
		(pid) => identities.has(pid) && !before.has(pid) && pidAlive(pid),
	);
	const targets = [];
	for (const pid of candidates) {
		const facts = before.get(pid);
		if (!ours(pid, facts)) continue;
		targets.push(pid);
		if (recordedAs(pid, facts) && facts.pgid === pid)
			try {
				process.kill(-pid, "SIGKILL");
			} catch {}
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
	if (targets.length > 0) await sleep(settleMs);
	const after = processFactsMany(
		targets.filter((pid) => pidAlive(pid)),
		{ deadline: Math.max(deadline, Date.now() + 5000) },
	);
	const left = targets.filter(
		(pid) => pidAlive(pid) && (!after.has(pid) || ours(pid, after.get(pid))),
	);
	return [...left, ...unreadable.filter((pid) => !left.includes(pid))];
}

/** Every descendant pid of `roots`, from one `ps` snapshot. */
export function descendantsOf(roots) {
	const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], {
		encoding: "utf8",
		env: cLocaleEnv(),
	});
	if (ps.error || ps.status !== 0) return [];
	const children = new Map();
	for (const line of ps.stdout.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(\d+)$/);
		if (!m) continue;
		const list = children.get(Number(m[2])) ?? [];
		list.push(Number(m[1]));
		children.set(Number(m[2]), list);
	}
	const out = [];
	const queue = [...roots];
	while (queue.length) {
		for (const child of children.get(queue.shift()) ?? []) {
			out.push(child);
			queue.push(child);
		}
	}
	return out;
}

/** Signal a whole process group, escalate, and say whether the leader is gone. */
async function stopGroup(pid, isExited, deadlineMs = 5000) {
	const kill = (signal) => {
		try {
			process.kill(-pid, signal);
		} catch {}
	};
	if (!isExited()) kill("SIGTERM");
	const deadline = Date.now() + deadlineMs;
	while (!isExited() && Date.now() < deadline) await sleep(100);
	if (!isExited()) {
		kill("SIGKILL");
		await sleep(500);
	}
	// The group may outlive its leader (a forked worker): sweep it either way.
	kill("SIGKILL");
	return { clean: !pidAlive(pid) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * ---------------------------------------------------------------------------
 * The negative-control self test: the refusal cases, against the real guards.
 * ---------------------------------------------------------------------------
 */

/**
 * Each case must REFUSE. Built in a throwaway tree with a fake HOME so the
 * operator-root cases (equal, inside, containing, symlink) are exercised for
 * real without touching the operator's directories. The two runtime cases
 * (`[window-mode]` says normal / focused=true) run through the same supervisor
 * the live run uses.
 */
export function negativeControlCases() {
	const tree = mkdtempSync(join(os.tmpdir(), "mac-proof-negative-"));
	const home = join(tree, "home");
	const names = appNames();
	const profileRoot = join(
		home,
		"Library",
		"Application Support",
		names.productName,
	);
	mkdirSync(profileRoot, { recursive: true });
	mkdirSync(join(home, ".local-operator", "run", "serve"), { recursive: true });
	const link = join(tree, "link-to-profile");
	// fs APIs, not a PATH-resolved `ln`/`rm` (QA r1 nit): the self test must not
	// depend on what PATH happens to hold.
	symlinkSync(profileRoot, link);
	const roots = operatorRoots({ homes: [home], names });
	const fakeApp = join(tree, "Fake.app");
	const refuses = (fn) => {
		try {
			const result = fn();
			return result !== null && result !== undefined && result !== false;
		} catch (error) {
			// Only a deliberate Refusal counts. A crash in a guard is a FAIL: a
			// guard that throws by accident has not shown that it refuses.
			return error instanceof Refusal;
		}
	};
	const supervised = (lines, opts) => {
		const sup = createSupervisor({
			windowMode: "inactive",
			session: null,
			capture: "screencapture",
			framesDir: join(tree, "frames"),
			...opts,
		});
		return lines.some((line) => sup.feed(line)?.abort);
	};
	const cases = [
		[
			"user-data-dir is the operator's profile",
			() => operatorPathProblem("profile", profileRoot, roots),
		],
		[
			"user-data-dir is a symlink to the operator's profile",
			() => operatorPathProblem("profile", link, roots),
		],
		[
			"user-data-dir is nested inside the operator's profile",
			() =>
				operatorPathProblem(
					"profile",
					join(profileRoot, "Default", "x"),
					roots,
				),
		],
		[
			"user-data-dir contains the operator's profile",
			() => operatorPathProblem("profile", join(home, "Library"), roots),
		],
		[
			"out dir inside ~/.local-operator (not a scratchpad)",
			() =>
				operatorPathProblem(
					"--out",
					join(home, ".local-operator", "run"),
					roots,
				),
		],
		[
			"backend config root is ~/.local-operator",
			() =>
				operatorPathProblem(
					"--backend-config-root",
					join(home, ".local-operator"),
					roots,
					{ allowScratchpad: false },
				),
		],
		[
			"backend config root is a scratchpad inside ~/.local-operator",
			() =>
				operatorPathProblem(
					"--backend-config-root",
					join(home, ".local-operator", "sessions", "abc", "scratchpad", "cfg"),
					roots,
					{ allowScratchpad: false },
				),
		],
		["--window-mode normal", () => windowModeProblem("normal")],
		["--window-mode empty", () => windowModeProblem("")],
		["--window-mode focus", () => windowModeProblem("focus")],
		[
			"app's [window-mode] line says normal",
			() => supervised(["[window-mode] window mode normal: 1380x900, shown"]),
		],
		[
			"app's [window-mode] state says focused=true",
			() =>
				supervised([
					"[window-mode] window mode inactive: 1380x900",
					"[window-mode] state: visible=true focused=true focusable=true",
				]),
		],
		[
			"isolated backend on port 1111",
			() =>
				backendUrlProblem(`http://127.0.0.1:${OPERATOR_PORT}`, {
					isolated: true,
				}),
		],
		[
			"non-loopback backend",
			() => backendUrlProblem("http://10.0.0.5:1111", { isolated: false }),
		],
		["relative app path", () => resolveAppBundle("Local Operator.app")],
		[
			"--app together with --app-zip",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--app-zip",
						"/x.zip",
						"--out",
						"/tmp/o",
					]),
				),
		],
		["relative --app-zip", () => appZipProblem("dl/local-operator-ui.zip")],
		[
			"--app-zip that is not a .zip",
			() => appZipProblem(join(tree, "home", "release.tar.gz")),
		],
		[
			"--app-zip that does not exist",
			() => appZipProblem(join(tree, "gone.zip")),
		],
		[
			"--app-zip that is a directory",
			() => {
				mkdirSync(join(tree, "dir.zip"), { recursive: true });
				return appZipProblem(join(tree, "dir.zip"));
			},
		],
		[
			"an extracted zip with no .app",
			() => {
				mkdirSync(join(tree, "x0", "Not An App"), { recursive: true });
				return bundleInExtracted(join(tree, "x0"));
			},
		],
		[
			"an extracted zip with two .app bundles",
			() => {
				mkdirSync(join(tree, "x2", "A.app"), { recursive: true });
				mkdirSync(join(tree, "x2", "B.app"), { recursive: true });
				return bundleInExtracted(join(tree, "x2"));
			},
		],
		[
			"a build that never arms the step runner (predates S1)",
			() =>
				startupProblem(
					{
						windowModeLine: "[window-mode] window mode inactive",
						scriptArmed: false,
					},
					STARTUP_WINDOW_MS + 1,
				),
		],
		[
			"app path that is a bare binary",
			() => resolveAppBundle(join(tree, "home")),
		],
		[
			"app bundle without Info.plist",
			() => {
				mkdirSync(fakeApp, { recursive: true });
				return resolveAppBundle(fakeApp);
			},
		],
		[
			"attach to an env-governed daemon",
			() =>
				selectServeRecord(
					[{ port: 1111, pid: process.pid, desktop: true, claim_key: "" }],
					1111,
				).kind === "blocked",
		],
		[
			"attach to an unclaimed daemon",
			() =>
				selectServeRecord(
					[{ port: 1111, pid: process.pid, desktop: false, claim_key: "k" }],
					1111,
				).kind === "refused",
		],
		[
			"seed template carrying credentials",
			() => {
				const seed = join(tree, "seed");
				mkdirSync(join(seed, "network"), { recursive: true });
				writeFileSync(join(seed, "network", "credentials"), "x");
				return credentialMaterial(seed).length > 0;
			},
		],
		[
			"--token-from-operator-profile without attach",
			() =>
				validateOptions({
					...parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/o",
						"--token-from-operator-profile",
					]),
				}),
		],
		[
			"config-root relay with network.port unset",
			() =>
				relayPortProblem(
					relayPortFromConfig("values:\n  network:\n    enabled: true\n"),
				),
		],
		[
			"config-root relay with network.port 4097",
			() =>
				relayPortProblem(
					relayPortFromConfig("values:\n  network:\n    port: 4097\n"),
				),
		],
		[
			// Core reads only `values:`; a top-level port leaves the relay on 4097.
			"config-root relay with network.port only at top level",
			() => relayPortProblem(relayPortFromConfig("network:\n  port: 14097\n")),
		],
		[
			"config-root relay with values: but no network",
			() =>
				relayPortProblem(
					relayPortFromConfig("values:\n  ui:\n    port: 14097\n"),
				),
		],
		[
			"daemon call to an engage path",
			() =>
				daemonRequestProblem("GET", "/v1/desktop/sessions/ce618964c88e/engage"),
		],
		[
			"daemon call that sends a prompt",
			() =>
				daemonRequestProblem(
					"POST",
					"/v1/desktop/sessions/ce618964c88e/prompt",
				),
		],
		[
			"daemon call off the read allowlist",
			() => daemonRequestProblem("GET", "/v1/desktop/config"),
		],
		["lop network start", () => lopArgvProblem(["network", "start"])],
		[
			// The download is the APP's request; the harness's client never sends it.
			"daemon call to the files download route (the app's write, never the harness's)",
			() =>
				daemonRequestProblem(
					"POST",
					"/v1/desktop/sessions/ce618964c88e/files/f1/download",
				),
		],
		[
			"--scene download on --backend attach (the operator's real ~/Downloads)",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/x",
						"--session",
						"ce618964c88e",
						"--scene",
						"download",
						"--theme",
						"dark",
						"--backend",
						"attach",
						"--backend-url",
						"http://127.0.0.1:5555",
					]),
				),
		],
		[
			"--scene download on the isolated backend",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/x",
						"--session",
						"ce618964c88e",
						"--scene",
						"download",
						"--theme",
						"dark",
					]),
				),
		],
		[
			"a --manifest that is a directory",
			() => manifestEntry(tree, DOWNLOAD_FILE_DEFAULT),
		],
		[
			"a step list that presses Save as",
			() =>
				downloadStepsProblem([
					{
						verb: "press",
						payload: { selector: '[data-remote-action="save-as"]' },
					},
				]),
		],
		[
			"daemon call to an absolute URL on another host",
			() => daemonRequestProblem("GET", "http://10.255.255.1:9/health"),
		],
		[
			"daemon call to a //host path",
			() => daemonRequestProblem("GET", "//10.255.255.1/health"),
		],
		[
			"daemon call whose path hides a tab before //host (QA r2 Q2-1)",
			() => daemonRequestProblem("GET", "/\t/10.255.255.1/health"),
		],
		[
			"daemon call past a notification id (one segment only)",
			() =>
				daemonRequestProblem(
					"GET",
					"/v1/desktop/notifications/n_macproofdetailaa/read",
				),
		],
		[
			"a quarantined (browser-downloaded) --app-zip on darwin",
			() =>
				quarantineProblem(join(tree, "dl.zip"), {
					platform: "darwin",
					read: () => ({ value: "0083;65f0;Safari;" }),
				}),
		],
		[
			"--seed together with --seed-config",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/o",
						"--seed",
						"ask-command",
						"--seed-config",
						"/tmp/s",
					]),
				),
		],
		[
			"rig root is a dangling symlink to a not-yet-created operator profile",
			() => {
				const dangling = join(tree, "link-to-missing-profile");
				symlinkSync(join(home, ".config", names.productName), dangling);
				return operatorPathProblem("rig root", dangling, roots);
			},
		],
		[
			"rig root is a case variant of the operator's profile (darwin rule)",
			() =>
				operatorPathProblem("rig root", profileRoot.toLowerCase(), roots, {
					platform: "darwin",
				}),
		],
		[
			"rig root is the operator's profile under $XDG_CONFIG_HOME",
			() =>
				operatorPathProblem(
					"rig root",
					join(tree, "xdg", names.productName),
					operatorRoots({
						homes: [home],
						names,
						xdgConfigHome: join(tree, "xdg"),
					}),
				),
		],
		[
			"--theme naming a prototype key",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/o",
						"--theme",
						"constructor",
					]),
				),
		],
		[
			"--backend config-root without --backend-config-root",
			() =>
				validateOptions(
					parseArgs([
						"--app",
						"/x.app",
						"--out",
						"/tmp/o",
						"--backend",
						"config-root",
					]),
				),
		],
	];
	const results = cases.map(([name, fn]) => ({ name, refused: refuses(fn) }));
	rmSync(tree, { recursive: true, force: true });
	return results;
}

/*
 * ---------------------------------------------------------------------------
 * The run.
 * ---------------------------------------------------------------------------
 */

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/** Make the rig: a fresh tagged directory, never reused, with its sub-roots. */
function makeRig(rigRoot) {
	// The PHYSICAL root preflight vetted: `mkdirSync` on a dangling symlink
	// throws (QA r1 Q1-1 saw an uncaught ENOENT), and the target is what was
	// checked, so that is what gets created.
	const root = physical(rigRoot);
	mkdirSync(root, { recursive: true });
	const rig = mkdtempSync(join(root, "mac-proof-"));
	for (const dir of [
		"home",
		"config",
		"config-app",
		"logs",
		"profile",
		"frames",
		"tmp",
	])
		mkdirSync(join(rig, dir), { recursive: true });
	return rig;
}

/** Everything resolvable before a spawn. Throws `Refusal` (exit 2) or BLOCKED (exit 3). */
export function preflight(opts, { roots = operatorRoots() } = {}) {
	validateOptions(opts);
	// A zip is only CHECKED here (path, hash): extracting needs the rig, which
	// exists only past preflight, so `main` resolves the bundle right after it
	// makes the rig and before anything else is spawned.
	let app;
	if (opts.appZip !== null) {
		const zipProblem = appZipProblem(opts.appZip);
		if (zipProblem) throw new Refusal(zipProblem);
		// Before the rig exists: a browser-downloaded zip is refused up front
		// (review r3 R3-3); the extracted bundle is checked again after ditto.
		const quarantined = quarantineProblem(opts.appZip);
		if (quarantined) throw new Refusal(quarantined);
		app = {
			kind: "release-zip",
			zip: {
				path: opts.appZip,
				basename: basename(opts.appZip),
				sha256: fileSha256(opts.appZip),
			},
			version: null,
			executable:
				"<rig>/app/<the zip's one .app>/Contents/MacOS/<CFBundleExecutable> (extracted at run)",
		};
	} else app = resolveAppBundle(opts.app);
	const outProblem = operatorPathProblem("--out", opts.out, roots);
	if (outProblem) throw new Refusal(outProblem);
	const rigRoot =
		opts.rigRoot ?? process.env.LOCAL_OPERATOR_SCRATCHPAD ?? os.tmpdir();
	const rigProblem = operatorPathProblem("rig root", rigRoot, roots);
	if (rigProblem) throw new Refusal(rigProblem);
	// --out may sit beside the rig under the same root: the rig is a NEW mkdtemp
	// child, so frames can never land inside the scratch tree a cleanup removes.
	let lop = null;
	if (opts.backend !== "attach") {
		lop = opts.lop ?? resolveOnPath("lop");
		if (!lop) throw new Refusal("no `lop` on PATH; pass --lop <absolute path>");
		if (!isAbsolute(lop))
			throw new Refusal(`--lop must be absolute (got ${lop})`);
		if (!existsSync(lop)) throw new Refusal(`--lop ${lop} does not exist`);
	}
	if (opts.seedConfig) {
		if (
			!existsSync(opts.seedConfig) ||
			!statSync(opts.seedConfig).isDirectory()
		)
			throw new Refusal(`--seed-config ${opts.seedConfig} is not a directory`);
		const seedProblem = operatorPathProblem(
			"--seed-config",
			opts.seedConfig,
			roots,
			{ allowScratchpad: true },
		);
		if (seedProblem) throw new Refusal(seedProblem);
		const found = credentialMaterial(opts.seedConfig);
		if (found.length > 0)
			throw new Refusal(
				`--seed-config carries credential material, refused (a template must be synthetic): ${found.join(", ")}`,
			);
	}
	if (opts.backendConfigRoot) {
		const problem = operatorPathProblem(
			"--backend-config-root",
			opts.backendConfigRoot,
			roots,
			{ allowScratchpad: false },
		);
		if (problem) throw new Refusal(problem);
		if (!existsSync(opts.backendConfigRoot))
			throw new Refusal(
				`--backend-config-root ${opts.backendConfigRoot} does not exist (it is prepared by the operator)`,
			);
	}
	let relayPort = null;
	let backendHome = null;
	if (opts.backend === "config-root") {
		const config = join(opts.backendConfigRoot, "config.yml");
		relayPort = relayPortFromConfig(
			existsSync(config) ? readFileSync(config, "utf8") : "",
		);
		const portProblem = relayPortProblem(relayPort);
		if (portProblem) throw new Refusal(portProblem);
		backendHome =
			opts.backendHome ??
			join(dirname(resolve(opts.backendConfigRoot)), "home");
		const realHomes = [os.userInfo().homedir, process.env.HOME]
			.filter(Boolean)
			.map((h) => comparablePath(physical(h)));
		if (realHomes.includes(comparablePath(physical(backendHome))))
			throw new Refusal(
				`--backend-home ${backendHome} is the operator's real home; a rig device needs its own`,
			);
		const homeProblem = operatorPathProblem(
			"--backend-home",
			backendHome,
			roots,
			{ allowScratchpad: false },
		);
		if (homeProblem) throw new Refusal(homeProblem);
		if (!existsSync(backendHome))
			throw new Refusal(
				`--backend-home ${backendHome} does not exist (default: <dirname(config root)>/home, prepared with the root)`,
			);
		// The teardown sweeps every process carrying this root, so a root another
		// process already uses (an operator-run relay for the rig device, say)
		// is refused rather than shared and then killed.
		const busy = [
			...(processesWithConfigRoot(opts.backendConfigRoot) ?? ["unreadable"]),
			...(processesWithConfigRoot(physical(opts.backendConfigRoot)) ?? []),
		];
		if (busy.length > 0)
			throw new Refusal(
				`--backend-config-root is already in use by pid(s) ${[...new Set(busy)].join(", ")}; stop them first (the harness reaps every process on its root, so it never shares one)`,
			);
	}
	// Last, so every backend refusal above names its own cause first.
	const download = opts.scenes.includes("download")
		? downloadPreflight(opts, { backendHome })
		: null;
	return { app, rigRoot, lop, relayPort, backendHome, download };
}

/** Resolve the token for attach mode. Never prints it. */
function attachToken(opts) {
	const port = Number(new URL(opts.backendUrl).port);
	if (opts.tokenFromOperatorProfile) {
		const path = operatorDesktopTokenPath();
		let token;
		try {
			token = readFileSync(path, "utf8").trim();
		} catch {
			throw new Refusal(
				`--token-from-operator-profile: no readable desktop-token in the operator's profile`,
				EXIT.BLOCKED,
			);
		}
		if (!token)
			throw new Refusal(
				"--token-from-operator-profile: the desktop-token is empty",
				EXIT.BLOCKED,
			);
		return {
			token,
			source: "operator-profile desktop-token (operator-approved opt-in)",
		};
	}
	const dir =
		opts.serveRecordDir ??
		join(os.userInfo().homedir, ".local-operator", "run", "serve");
	const picked = selectServeRecord(readServeRecords(dir), port);
	if (picked.kind === "blocked")
		throw new Refusal(picked.message, EXIT.BLOCKED);
	if (picked.kind === "refused") throw new Refusal(picked.message);
	return {
		token: picked.token,
		source: `serve-record claim-key of pid ${picked.pid} (claimed plane)`,
	};
}

export async function main(argv = process.argv.slice(2)) {
	// --timeout is a WHOLE-RUN bound from here (review r1 R1-6, QA r1 Q4-3): it
	// used to start at app spawn, after up to 60 s of relay wait, 90 s of
	// /health and --peer-wait, so `--timeout 5` measured 16 s. Every wait below
	// stops at this instant; only the reap runs past it (bounded by its own
	// per-step escalation), which is why the docs ask for a caller timeout above
	// --timeout - SIGKILL of the harness itself cannot be caught.
	const harnessStarted = Date.now();
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (error) {
		console.error(`[mac-proof] refused: ${error.message}`);
		return EXIT.REFUSED;
	}
	if (opts.help) {
		console.log(USAGE);
		return EXIT.OK;
	}
	if (opts.negativeControl) {
		const results = negativeControlCases();
		for (const r of results)
			console.log(`${r.refused ? "PASS" : "FAIL"} refuses: ${r.name}`);
		const failed = results.filter((r) => !r.refused).length;
		console.log(
			`[mac-proof] negative control: ${results.length - failed}/${results.length} refused`,
		);
		return failed === 0 ? EXIT.OK : EXIT.FAILED;
	}

	const runDeadline = harnessStarted + opts.timeoutS * 1000;
	let plan;
	try {
		plan = preflight(opts);
	} catch (error) {
		const code = error instanceof Refusal ? error.code : EXIT.REFUSED;
		console.error(
			`[mac-proof] ${code === EXIT.BLOCKED ? "" : "refused: "}${error.message}`,
		);
		return code;
	}

	const rigPlaceholder = join(plan.rigRoot, "mac-proof-XXXXXX");
	const steps = buildSteps(opts);
	const stepProblem =
		stepCountProblem(steps.steps) ??
		downloadStepsProblem(steps.steps, {
			download: Boolean(plan.download),
			file: plan.download?.file ?? null,
		});
	if (stepProblem) {
		console.error(`[mac-proof] refused: ${stepProblem}`);
		return EXIT.REFUSED;
	}
	if (opts.dryRun) {
		const placeholderToken = "<minted-at-run>";
		const backendUrl =
			opts.backend === "attach"
				? opts.backendUrl
				: "http://127.0.0.1:<free port>";
		const report = {
			app: plan.app,
			rig: rigPlaceholder,
			backend: {
				mode: opts.backend,
				url: backendUrl,
				...(plan.lop
					? {
							serve: {
								command: plan.lop,
								argv: ["serve", "--host", "127.0.0.1", "--port", "<free port>"],
								env: redactEnv(
									buildServeEnv({
										rig: rigPlaceholder,
										home: plan.backendHome ?? join(rigPlaceholder, "home"),
										configRoot:
											opts.backendConfigRoot ?? join(rigPlaceholder, "config"),
										token: placeholderToken,
									}),
								),
							},
						}
					: {}),
				...(plan.relayPort
					? {
							relay: {
								command: plan.lop,
								argv: ["network", "serve", "--port", String(plan.relayPort)],
								env: buildLopEnv({
									rig: rigPlaceholder,
									home: plan.backendHome,
									configRoot: opts.backendConfigRoot,
								}),
							},
							waitsForRemoteSession: opts.session,
						}
					: {}),
				token:
					opts.backend === "attach"
						? opts.tokenFromOperatorProfile
							? "operator-profile (opt-in)"
							: "serve-record claim_key"
						: "minted by the harness",
			},
			capture:
				opts.capture === "screencapture"
					? SCREENCAPTURE_METHOD
					: CAPTUREPAGE_METHOD,
			command: plan.app.executable,
			argv: buildAppArgv({
				rig: rigPlaceholder,
				windowMode: opts.windowMode,
				size: opts.size,
				session: opts.session,
			}),
			env: redactEnv(
				buildAppEnv({
					rig: rigPlaceholder,
					backendUrl,
					token: placeholderToken,
					windowMode: opts.windowMode,
				}),
			),
			frames: steps.steps
				.filter((s) => s.verb === "shutter")
				.map((s) => `${s.payload.label}.png`),
			...(opts.seed !== null
				? {
						seed: {
							scenario: opts.seed,
							generatedInto: join(rigPlaceholder, "seed"),
							check: seedExpectations(loadSeedSpec(opts.seed)),
						},
					}
				: {}),
			...(plan.download
				? {
						download: {
							file: plan.download.file,
							route:
								"POST /v1/desktop/sessions/<session>/files/<file id>/download, sent by the app; the harness's daemon client stays GET-only",
							destinations: plan.download.destinations,
							manifest: plan.download.manifest,
							operatorDownloads: opts.checkOperatorDownloads
								? {
										checked: true,
										path: plan.download.operatorDownloads.path,
										...(plan.download.operatorDownloads.injected
											? { injected: true }
											: {}),
									}
								: { checked: false },
							limits: downloadLimits(opts),
						},
					}
				: {}),
			steps,
		};
		console.log(JSON.stringify(report, null, 2));
		return EXIT.OK;
	}

	// The rig relay must be the ONLY listener on network.port. Something already
	// there (another rig, an operator-run relay) would make our relay die with
	// EADDRINUSE while `lop serve` advertised the foreign one - the trap the
	// 4097 rule exists for (review r1 R1-5). Refused before the rig is made.
	if (plan.relayPort !== null && (await portListening(plan.relayPort))) {
		console.error(
			`[mac-proof] refused: something already listens on 127.0.0.1:${plan.relayPort} (network.port in ${join(opts.backendConfigRoot, "config.yml")}); stop it first - the harness starts the rig's own relay there and never shares one`,
		);
		return EXIT.REFUSED;
	}

	if (opts.capture === "screencapture") {
		let verdict;
		try {
			verdict = screenRecordingGranted();
		} catch (error) {
			console.error(
				`[mac-proof] BLOCKED: could not read Screen Recording permission without a prompt (${error.message}). ` +
					`Once it can be read: ${screenRecordingGrantHint(tccHost())}.`,
			);
			return EXIT.BLOCKED;
		}
		if (verdict === "unknown") {
			console.error(
				`[mac-proof] BLOCKED: CGPreflightScreenCaptureAccess is not callable from JXA here (neither bridged nor via ObjC.bindFunction), so Screen Recording cannot be read without risking a prompt. Use --capture capturepage (no vibrancy claim), or report this macOS version so the harness can learn another prompt-free probe. If it is a permission gap: ${screenRecordingGrantHint(tccHost())}.`,
			);
			return EXIT.BLOCKED;
		}
		if (verdict !== "granted") {
			console.error(
				`[mac-proof] BLOCKED: Screen Recording is not granted to this process's host; ${screenRecordingGrantHint(tccHost())}.`,
			);
			return EXIT.BLOCKED;
		}
	}

	/*
	 * The download scene's "before" listings, taken before the backend or the
	 * app starts: names only, of the rig's two possible destinations (to tell
	 * the new landing from what was there) and - only with
	 * --check-operator-downloads (see operatorDownloadsBaseline for why it is
	 * opt-in) - of the operator's real ~/Downloads.
	 */
	let downloadBefore = null;
	if (plan.download) {
		try {
			const operator = operatorDownloadsBaseline({
				check: opts.checkOperatorDownloads,
				dir: plan.download.operatorDownloads.path,
				injected: plan.download.operatorDownloads.injected,
			});
			// A permission error on the rig's own folders is a named refusal, not
			// a raw throw (review S1-5): without this listing no landing can be
			// told from what was already there.
			const rigBefore = new Map();
			for (const d of plan.download.destinations) {
				try {
					rigBefore.set(d.dir, listNames(d.dir));
				} catch (error) {
					throw new Refusal(
						`cannot list the rig's ${d.dir} before the run (${error.code ?? error.message}); without that listing a landing cannot be told from what was already there`,
					);
				}
			}
			downloadBefore = { operator, rig: rigBefore };
		} catch (error) {
			console.error(
				`[mac-proof] ${error instanceof Refusal && error.code === EXIT.REFUSED ? "refused: " : ""}${error.message}`,
			);
			return error instanceof Refusal ? error.code : EXIT.BLOCKED;
		}
	}

	mkdirSync(opts.out, { recursive: true });
	const rig = makeRig(plan.rigRoot);
	const profile = join(rig, "profile");
	// Belt to the rig-root guard: the exact --user-data-dir the app will get is
	// re-checked after the rig exists, so a symlink planted between preflight and
	// now cannot point the profile at the operator's.
	const profileProblem = operatorPathProblem(
		"--user-data-dir",
		profile,
		operatorRoots(),
	);
	if (profileProblem) {
		console.error(`[mac-proof] refused: ${profileProblem}`);
		return EXIT.REFUSED;
	}
	/** What the post-start check must read back when --seed generated the config root. */
	let seedExpect = null;
	const receipt = {
		app: plan.app,
		rig: {
			root: rig,
			profile,
			home: join(rig, "home"),
			config: join(rig, "config"),
			logs: join(rig, "logs"),
		},
		session: opts.session,
		scenes: opts.scenes,
		themes: opts.themes,
		windowMode: opts.windowMode,
		capture:
			opts.capture === "screencapture"
				? SCREENCAPTURE_METHOD
				: CAPTUREPAGE_METHOD,
		backend: { mode: opts.backend },
		frames: [],
		steps: [],
		limits: receiptLimits(opts.scenes, opts),
		disclosed: [
			"the opened conversation's unread/seen marks may clear on the daemon that served it",
			"a desktop presence beat (45 s TTL) is sent to that daemon",
			...(opts.capture === "screencapture"
				? [
						"the vibrancy backdrop is whatever sat behind the inactive window on this screen",
					]
				: []),
		],
		reap: {},
		...(plan.download
			? {
					download: {
						route:
							"POST /v1/desktop/sessions/<session>/files/<file id>/download (sent by the app with its own token; the harness's daemon client stays GET-only)",
						file: plan.download.file,
						// The plan's own objects, the dry-run's shape (review F6).
						destinations: plan.download.destinations,
						manifest: plan.download.manifest,
						// Replaced after the reap; set now so an early end still
						// says whether the stray check was asked for.
						operatorDownloads: { checked: opts.checkOperatorDownloads },
						limits: downloadLimits(opts),
						verdict: "FAIL",
					},
				}
			: {}),
		verdict: "failed",
	};
	const children = { app: null };
	let appExited = false;
	/*
	 * Why the run ENDED early, when it did. `interrupted` is the signal name
	 * (SIGINT/SIGTERM/SIGHUP), `childFailure` the first spawn 'error' (EACCES,
	 * ENOENT) of the app, `lop serve` or the relay. Every wait below polls
	 * `endedBy()`, so each of these - and the whole-run deadline - leaves
	 * through the same throw -> `finally` -> full teardown -> receipt path, and
	 * the receipt names the cause (QA r1 Q4-2) instead of the knock-on symptom
	 * ("the app exited before the step runner finished").
	 */
	let interrupted = null;
	let childFailure = null;
	const endedBy = () => {
		if (interrupted) return `interrupted by ${interrupted}`;
		if (childFailure) return childFailure;
		if (Date.now() >= runDeadline)
			return `the run exceeded --timeout ${opts.timeoutS} s`;
		return null;
	};
	const checkpoint = (phase) => {
		const why = endedBy();
		if (why) throw new Error(`${why} (${phase})`);
	};
	/** A spawn 'error' would otherwise be an uncaught exception that skips the teardown. */
	const onChildError = (name) => (error) => {
		childFailure ??= `${name} could not run: ${error.message}`;
	};
	/*
	 * Every lop process this run started (daemon, relay), plus every descendant
	 * seen while they ran. Standby runtimes run in their OWN process groups
	 * (measured on node2: 4 extra pgids per serve), so the daemon's group signal
	 * misses them; the teardown kills these recorded pids AND sweeps every
	 * process carrying this run's config root in its env/argv.
	 */
	const lopRun = { configRoot: null, spawned: [], recorded: new Set() };
	/*
	 * (pid, start time) of every pid recorded below, read when first seen, so the
	 * reap kills a recorded pid by identity rather than by what it looks like at
	 * the end (review r2 R2-1; `killRigMatched`).
	 */
	const identities = new Map();
	const recordDescendants = () => {
		const live = lopRun.spawned
			.map((c) => c.pid)
			.filter((pid) => pid !== undefined);
		for (const pid of [...live, ...descendantsOf(live)])
			lopRun.recorded.add(pid);
		rememberIdentities(identities, lopRun.recorded);
	};
	const spawnLop = (argv, env, name) => {
		const problem = lopArgvProblem(argv);
		if (problem) throw new Refusal(problem);
		const child = spawn(plan.lop, argv, {
			cwd: rig,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.on(
			"error",
			onChildError(`lop ${argv[0] === "network" ? "network serve" : "serve"}`),
		);
		const log = [];
		const keep = (chunk) => log.push(chunk.toString());
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		child.on("exit", () => {
			const text = log.join("");
			writeFileSync(
				join(rig, "logs", `${name}.log`),
				env.LOCAL_OPERATOR_DESKTOP_TOKEN
					? text.replaceAll(env.LOCAL_OPERATOR_DESKTOP_TOKEN, "<redacted>")
					: text,
			);
		});
		child.name = name;
		lopRun.spawned.push(child);
		// No pid means the spawn itself failed ('error' above); nothing to reap.
		if (child.pid !== undefined) {
			lopRun.recorded.add(child.pid);
			rememberIdentities(identities, [child.pid]);
			reapOnExit({ pid: child.pid, userData: null, groupOutlivesLeader: true });
		}
		return child;
	};

	/*
	 * ONE teardown, however many paths ask for it: a SIGTERM that lands while
	 * the `finally` is already reaping must wait for that reap, not start a
	 * second one that races it (and must not let `process.exit` cut it short).
	 */
	let tearing = null;
	const teardown = () => {
		tearing ??= reapEverything();
		return tearing;
	};
	/** App descendants seen while it ran, killed by exact pid if they outlive the group. */
	const appRecorded = new Set();
	/** Pids reaped with an UNKNOWN identity (start did not parse; review r1 R1-1), for the receipt. */
	const unknownStart = new Set();
	const reapEverything = async () => {
		if (children.app && children.app.pid !== undefined && !receipt.reap.app) {
			const result = await stopAppTree({
				pid: children.app.pid,
				userData: profile,
				isExited: () => appExited,
			});
			receipt.reap.app = {
				clean: result.clean,
				escalated: result.escalated,
				reaped: result.reaped.length,
				survivors: result.survivors.length,
			};
		}
		if (lopRun.spawned.length > 0 && !receipt.reap.lop) {
			recordDescendants();
			// The daemon before the relay: it is the relay's client.
			for (const child of [...lopRun.spawned].reverse())
				if (child.pid !== undefined)
					receipt.reap[child.name] = await stopGroup(
						child.pid,
						() => child.exitCode !== null || child.signalCode !== null,
					);
			receipt.reap.lop = await reapConfigRootProcesses(
				lopRun.configRoot,
				lopRun.recorded,
				rig,
				identities,
				unknownStart,
			);
		}
		// Recorded app descendants, then anything still running in the rig.
		const ours = rigMatcher({ rig, configRoot: lopRun.configRoot });
		const recordedLeft = await killRigMatched(
			[...appRecorded].filter((pid) => pidAlive(pid)),
			ours,
			{ identities, unknownStart },
		);
		const inRig = processesWithCwdUnder(rig);
		const rigLeft =
			inRig === null
				? null
				: await killRigMatched(inRig, ours, { identities, unknownStart });
		const after = processesWithCwdUnder(rig);
		receipt.reap.rig = {
			recorded: appRecorded.size,
			swept: inRig === null ? "unreadable" : inRig.length,
			clean:
				recordedLeft.length === 0 &&
				rigLeft !== null &&
				after !== null &&
				after.length === 0,
			...(unknownStart.size > 0
				? {
						identityUnknown: {
							pids: [...unknownStart].sort((a, b) => a - b),
							note: "ps lstart did not parse for these pids: kept as reap candidates and signalled by pid (no group signal); their identity was not verified",
						},
					}
				: {}),
		};
	};
	/*
	 * The receipt and the closing line, written ONCE by whichever path ends the
	 * run: the main `finally`, or the signal handler (which then calls
	 * `process.exit`, so it must not rely on the `finally` getting there first).
	 */
	let finishing = null;
	const finalize = () => {
		finishing ??= (async () => {
			await teardown();
			if (interrupted) {
				receipt.verdict = "failed";
				receipt.error = `interrupted by ${interrupted}`;
				receipt.endedBy = { signal: interrupted };
				receipt.exit = EXIT.FAILED;
			}
			// After the reap, so nothing of this run can still be writing. With
			// --check-operator-downloads any new name in the operator's real
			// ~/Downloads fails the run; without it the receipt records
			// {checked: false} and nothing is listed.
			if (downloadBefore) {
				// Every path ends here (pass, abort, signal, timeout), after the
				// reap: record each new name in the rig, so a run that aborted
				// AFTER a file landed still says what landed (review S1-3). A PASS
				// that no longer sees exactly that one file is failed.
				let landed;
				try {
					landed = rigNewEntries(
						plan.download.destinations,
						downloadBefore.rig,
					);
				} catch (error) {
					landed = null;
					receipt.download.newInRigError = error.code ?? error.message;
				}
				receipt.download.newInRig = landed;
				if (
					receipt.download.verdict === "PASS" &&
					(landed === null ||
						landed.length !== 1 ||
						landed[0] !== receipt.download.destination)
				) {
					receipt.download.verdict = "FAIL";
					receipt.verdict = "failed";
					receipt.error = `${receipt.error ? `${receipt.error}; ` : ""}after the reap the rig holds ${landed === null ? "an unreadable downloads folder" : `${landed.length} new file(s): ${landed.join(", ")}`}, not exactly ${receipt.download.destination}`;
					receipt.exit = EXIT.FAILED;
				}
				const stray = operatorDownloadsVerdict(downloadBefore.operator);
				receipt.download.operatorDownloads = stray.record;
				if (stray.problem) {
					receipt.download.verdict = "FAIL";
					receipt.verdict = "failed";
					receipt.error = `${receipt.error ? `${receipt.error}; ` : ""}${stray.problem}`;
					receipt.exit = EXIT.FAILED;
				}
			}
			const leaked = Object.values(receipt.reap).some(
				(r) => r && r.clean === false,
			);
			if (leaked) {
				receipt.verdict = "failed";
				receipt.error = `${receipt.error ? `${receipt.error}; ` : ""}a process this run started survived the reap`;
				receipt.exit = EXIT.FAILED;
			}
			// The receipt's word matches the closing line's: an exit-3 run said
			// "blocked (...)" on stdout but `"verdict": "failed"` in receipt.json.
			if (receipt.verdict !== "captured" && receipt.exit === EXIT.BLOCKED)
				receipt.verdict = "blocked";
			try {
				cpSync(join(rig, "logs"), join(opts.out, "logs"), { recursive: true });
			} catch {}
			// The extracted release (a ~180 MB zip, more unpacked) goes once nothing of it can still be
			// running: after a CLEAN reap only. A survivor keeps its tree, both for
			// diagnosis and so no process is left executing from a deleted bundle.
			if (opts.appZip !== null && receipt.app.kind === "release-zip") {
				const extracted = join(rig, "app");
				if (opts.keepRig) receipt.app.extracted = { kept: extracted };
				else if (leaked)
					receipt.app.extracted = {
						kept: extracted,
						reason: "a process survived the reap",
					};
				else {
					// Never lose the receipt to a cleanup failure (review r3 R3-4): an
					// EACCES/EBUSY here used to reject `finalize` before receipt.json
					// and the closing line were written.
					try {
						rmSync(extracted, { recursive: true, force: true });
						receipt.app.extracted = { removed: extracted };
					} catch (error) {
						receipt.app.extracted = {
							kept: extracted,
							reason: `removal failed: ${error.message}`,
						};
					}
				}
			}
			writeFileSync(
				join(opts.out, "receipt.json"),
				`${JSON.stringify(receipt, null, 2)}\n`,
			);
			const code =
				receipt.verdict === "captured"
					? EXIT.OK
					: (receipt.exit ?? EXIT.FAILED);
			const word =
				code === EXIT.OK
					? "captured"
					: code === EXIT.REFUSED
						? "refused"
						: code === EXIT.BLOCKED
							? "blocked"
							: "failed";
			console.log(
				`[mac-proof] ${word}${receipt.error && code !== EXIT.OK ? ` (${receipt.error})` : ""}: ${receipt.frames.length} frame(s); receipt ${join(opts.out, "receipt.json")}`,
			);
			return code;
		})();
		return finishing;
	};
	// SIGHUP too: a closed terminal or dropped ssh would otherwise kill the
	// harness with no teardown, leaving the rig's `lop serve` and its standby
	// runtimes (own process groups) running (QA r1 Q4-1, review r1 R1-4).
	onInterrupted(
		async (signal) => {
			interrupted ??= signal;
			await finalize();
			return EXIT.FAILED;
		},
		["SIGINT", "SIGTERM", "SIGHUP"],
	);

	try {
		// ---- --app-zip: extract into the rig, then the --app guards -----------
		if (opts.appZip !== null) {
			plan.app = releaseZipApp(plan.app.zip, rig, {
				roots: operatorRoots(),
				timeoutMs: runDeadline - Date.now(),
			});
			receipt.app = plan.app;
			checkpoint("extracting --app-zip");
		}

		// ---- backend --------------------------------------------------------
		let backendUrl;
		let token;
		if (opts.backend === "attach") {
			const problem = backendUrlProblem(opts.backendUrl, { isolated: false });
			if (problem) throw new Refusal(problem);
			const health = await getHealth(opts.backendUrl);
			if (!health)
				throw new Refusal(
					`no Local Operator daemon answers /health at ${opts.backendUrl}`,
				);
			const picked = attachToken(opts);
			token = picked.token;
			backendUrl = new URL(opts.backendUrl).origin;
			receipt.backend = {
				mode: "attach",
				url: backendUrl,
				health: { pid: health.pid ?? null, version: health.version ?? null },
				tokenSource: picked.source,
			};
		} else {
			const configRoot = opts.backendConfigRoot ?? join(rig, "config");
			const lopHome = plan.backendHome ?? join(rig, "home");
			lopRun.configRoot = configRoot;
			if (opts.seedConfig)
				cpSync(opts.seedConfig, configRoot, { recursive: true });
			if (opts.seed !== null) {
				// Generated HERE, not in preflight: an ask is open only until its
				// expires_at, so the template is stamped as close to serve start as
				// possible, then vetted and copied exactly like a --seed-config one.
				let generated;
				try {
					generated = await generateSeed({
						scenario: opts.seed,
						out: join(rig, "seed"),
					});
				} catch (error) {
					throw new Refusal(`--seed ${opts.seed}: ${error.message}`);
				}
				const found = credentialMaterial(generated.out);
				if (found.length > 0)
					throw new Refusal(
						`--seed ${opts.seed} generated credential-shaped names, refused: ${found.join(", ")}`,
					);
				seedExpect = generated.expect;
				receipt.seed = {
					scenario: opts.seed,
					generatedAt: generated.now,
					files: generated.files,
					// `{id, read}` per seeded notification: the detail scenes' read
					// face is SEEDED (`detailReadSelector`), so the receipt says so.
					...(generated.expect?.items ? { items: generated.expect.items } : {}),
				};
				cpSync(generated.out, configRoot, { recursive: true });
			}
			// --backend-config-root: the rig device's OWN mesh relay first, in the
			// foreground and on the port its config names (preflight refused an
			// unset port or 4097), so peers dial this relay and never the
			// operator's. `lop serve` starts only once the relay listens.
			if (opts.backend === "config-root") {
				const relay = spawnLop(
					["network", "serve", "--port", String(plan.relayPort)],
					buildLopEnv({ rig, home: lopHome, configRoot }),
					"relay",
				);
				const relayBy = Date.now() + 60_000;
				while (!(await portListening(plan.relayPort))) {
					checkpoint("waiting for the rig relay");
					if (relay.exitCode !== null || Date.now() >= relayBy)
						throw new Error(
							`the rig relay did not listen on :${plan.relayPort}${relay.exitCode !== null ? " (it exited)" : ""}`,
						);
					await sleep(250);
				}
				// "Something answers" is not "OUR relay answers" (review r1 R1-5):
				// the relay must still be running and every listener on the port
				// must be its own process tree.
				if (relay.exitCode !== null || relay.signalCode !== null)
					throw new Error(
						`the rig relay exited although :${plan.relayPort} answers; another process holds that port`,
					);
				const owned = portListenerOwned(plan.relayPort, [
					relay.pid,
					...descendantsOf([relay.pid]),
				]);
				if (owned !== true)
					throw new Error(
						owned === null
							? `could not confirm that the listener on :${plan.relayPort} is the relay this run started (pid ${relay.pid}); not advertising it`
							: `the listener on :${plan.relayPort} is not the relay this run started (pid ${relay.pid}); not advertising someone else's relay`,
					);
				receipt.backend.relay = {
					command: plan.lop,
					port: plan.relayPort,
					pid: relay.pid,
				};
			}
			let port = await freeLoopbackPort();
			if (port === OPERATOR_PORT) port = await freeLoopbackPort();
			backendUrl = `http://127.0.0.1:${port}`;
			const urlProblem = backendUrlProblem(backendUrl, { isolated: true });
			if (urlProblem) throw new Refusal(urlProblem);
			token = randomBytes(32).toString("hex");
			const serve = spawnLop(
				["serve", "--host", "127.0.0.1", "--port", String(port)],
				buildServeEnv({ rig, home: lopHome, configRoot, token }),
				"serve",
			);
			const deadline = Date.now() + 90_000;
			let health = null;
			while (!health && Date.now() < deadline && serve.exitCode === null) {
				checkpoint("waiting for the rig daemon's /health");
				health = await getHealth(backendUrl, 1000);
				if (!health) await sleep(250);
			}
			recordDescendants();
			// A failed spawn sets exitCode (negative errno) and emits 'error' in the
			// same tick, so name that cause before the generic "did not answer".
			if (!health) checkpoint("starting the rig daemon");
			if (!health)
				throw new Error(
					`the rig daemon did not answer /health at ${backendUrl}${serve.exitCode !== null ? " (it exited)" : ""}`,
				);
			receipt.backend = {
				...receipt.backend,
				mode: opts.backend === "config-root" ? "config-root" : "isolated",
				url: backendUrl,
				configRoot,
				home: lopHome,
				seeded: Boolean(opts.seedConfig || opts.seed),
				serve: { command: plan.lop, pid: serve.pid },
				health: { pid: health.pid ?? null, version: health.version ?? null },
				tokenSource: "minted by the harness (env only)",
			};
			// The seed must be READ BACK by the real daemon before the app opens:
			// a schema drift, a stale expires_at or a mis-copied file would
			// otherwise give a frame of an empty drawer under the seed's name.
			if (seedExpect !== null) {
				checkpoint("reading the seeded rows back");
				receipt.seed.check = await verifySeedRows(
					backendUrl,
					token,
					seedExpect,
					{ deadline: Math.min(runDeadline, Date.now() + 10_000) },
				);
			}
			// The remote session must be LISTED before the app opens it: the first
			// reads on node2 were empty until the peer row cache refreshed, and a
			// frame of an empty list under the session's name would be a fake.
			if (opts.backend === "config-root" && opts.session) {
				receipt.backend.remoteSession = await waitForRemoteSession(
					backendUrl,
					token,
					opts.session,
					{
						timeoutMs: opts.peerWaitS * 1000,
						shouldStop: () => endedBy(),
					},
				);
				recordDescendants();
			}
		}

		// ---- app --------------------------------------------------------------
		recordDescendants();
		writeFileSync(join(rig, "steps.json"), JSON.stringify(steps, null, 2));
		const argvApp = buildAppArgv({
			rig,
			windowMode: opts.windowMode,
			size: opts.size,
			session: opts.session,
		});
		console.log(
			`[mac-proof] launching ONE ${opts.windowMode} window (${plan.app.kind} ${plan.app.version ?? "?"}) for ${opts.scenes.length * opts.themes.length} frame(s); it is reaped when the run ends`,
		);
		const app = spawn(plan.app.executable, argvApp, {
			cwd: rig,
			env: buildAppEnv({ rig, backendUrl, token, windowMode: opts.windowMode }),
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		children.app = app;
		app.on("error", onChildError("the app"));
		if (app.pid !== undefined) reapOnExit({ pid: app.pid, userData: profile });
		app.on("exit", () => {
			appExited = true;
		});
		const supervisor = createSupervisor({
			windowMode: opts.windowMode,
			session: opts.session,
			capture: opts.capture,
			framesDir: join(rig, "frames"),
			labels: steps.steps
				.filter((s) => s.verb === "shutter")
				.map((s) => s.payload.label),
			windowWait: (() => {
				const i = steps.steps.findIndex(
					(s) => s.payload?.selector === WINDOW_WAIT_SELECTOR,
				);
				return i < 0 ? null : { step: i + 1, s: opts.windowWaitS };
			})(),
		});
		const appLog = [];
		let abort = null;
		let finished = false;
		const work = [];
		const onLine = (line) => {
			appLog.push(line);
			if (abort || finished) return;
			const action = supervisor.feed(line);
			if (!action) return;
			if (action.abort) abort = action.abort;
			else if (action.done) finished = true;
			else if (action.shutter) work.push(capture(action.shutter));
		};
		const capture = async (shot) => {
			const theme = shot.label.split("-").pop();
			const file = join(opts.out, `${shot.label}.png`);
			if (opts.capture === "screencapture") {
				const info = windowInfo(shot.windowId);
				if (!info) throw new Error(`window ${shot.windowId} is not on screen`);
				if (info.pid !== app.pid)
					throw new Error(
						`window ${shot.windowId} belongs to pid ${info.pid}, not the app this run launched (${app.pid})`,
					);
				if (info.layer !== 0)
					throw new Error(
						`window ${shot.windowId} is on layer ${info.layer}, not a normal window`,
					);
				const run = spawnSync(
					"screencapture",
					["-x", "-o", "-l", String(shot.windowId), file],
					{ encoding: "utf8", timeout: 30000 },
				);
				if (run.status !== 0)
					throw new Error(`screencapture failed: ${(run.stderr || "").trim()}`);
				const bytes = readFileSync(file);
				const size = pngSize(bytes);
				if (!size || bytes.length < 1000)
					throw new Error(
						`screencapture wrote no usable PNG for ${shot.label}`,
					);
				const scale = frameMatchesWindow(size, info.bounds);
				if (scale === null)
					throw new Error(
						`screencapture of ${shot.label} is ${size.width}x${size.height} px, which is not window ${shot.windowId}'s ${JSON.stringify(info.bounds)} at any backing scale; refusing the frame`,
					);
				receipt.frames.push({
					label: shot.label,
					theme,
					file,
					windowId: shot.windowId,
					ownerPid: info.pid,
					bounds: info.bounds,
					backingScale: scale,
					method: SCREENCAPTURE_METHOD,
					sha256: sha256(bytes),
					pixels: size,
					at: new Date().toISOString(),
				});
				// `shot.ack` is derived (<rig>/frames/<label>.ack), never read off the line.
				writeFileSync(shot.ack, "ok");
			} else {
				const bytes = readFileSync(shot.path);
				const size = pngSize(bytes);
				if (!size)
					throw new Error(`capturePage wrote no PNG for ${shot.label}`);
				writeFileSync(file, bytes);
				receipt.frames.push({
					label: shot.label,
					theme,
					file,
					method: CAPTUREPAGE_METHOD,
					sha256: sha256(bytes),
					pixels: size,
					at: new Date().toISOString(),
				});
			}
		};
		let buffered = "";
		const split = (chunk) => {
			buffered += chunk.toString();
			let at = buffered.indexOf("\n");
			while (at !== -1) {
				onLine(buffered.slice(0, at).replace(/\r$/, ""));
				buffered = buffered.slice(at + 1);
				at = buffered.indexOf("\n");
			}
		};
		app.stdout.on("data", split);
		app.stderr.on("data", split);

		const started = Date.now();
		let tick = 0;
		while (!abort && !finished && !appExited && !endedBy()) {
			abort ??= startupProblem(supervisor.state, Date.now() - started);
			await sleep(100);
			// Every ~2 s: record the app's descendants (and the lop processes'),
			// so a helper that later leaves the group is still reaped by pid.
			if (tick++ % 20 === 0) {
				for (const pid of descendantsOf([app.pid])) appRecorded.add(pid);
				rememberIdentities(identities, appRecorded);
				recordDescendants();
			}
			// Surface capture failures as an abort rather than an unhandled rejection.
			for (const job of work.splice(0)) {
				try {
					await job;
				} catch (error) {
					abort = `capture failed: ${error.message}`;
				}
			}
		}
		for (const job of work.splice(0)) {
			try {
				await job;
			} catch (error) {
				abort ??= `capture failed: ${error.message}`;
			}
		}
		if (!abort && !finished)
			abort =
				endedBy() ??
				(appExited
					? "the app exited before the step runner finished"
					: "the run ended before the step runner finished");
		receipt.steps = supervisor.state.steps;
		receipt.windowModeLine = supervisor.state.windowModeLine;
		receipt.windowStateLine = supervisor.state.windowStateLine;
		receipt.windowWait = supervisor.state.windowWait;
		writeFileSync(
			join(rig, "logs", "app-stdout.log"),
			token
				? appLog.join("\n").replaceAll(token, "<redacted>")
				: appLog.join("\n"),
		);
		const expected = opts.scenes.length * opts.themes.length;
		if (!abort && receipt.frames.length !== expected)
			abort = `captured ${receipt.frames.length} of ${expected} frames`;
		if (!abort) abort = duplicateFrameProblem(receipt.frames);
		// Provenance (see `libraryProvenanceCheck`): after the frames, while the
		// rig daemon is still up, and bounded by what is left of --timeout. A
		// non-remote answer FAILS the run: the frame would not prove the remote path.
		if (!abort && opts.scenes.includes("library")) {
			checkpoint("reading the library row's provenance back");
			receipt.libraryProvenance = await readLibraryProvenance(
				backendUrl,
				token,
				{ timeoutMs: Math.max(1000, runDeadline - Date.now()) },
			);
			if (!receipt.libraryProvenance.pass)
				abort = `library provenance: ${receipt.libraryProvenance.problem}`;
		}
		if (!abort && opts.scenes.includes("file-preview")) {
			checkpoint("reading the previewed file's provenance back");
			receipt.imagePreview = await readImagePreview(backendUrl, token, {
				session: opts.session,
				name: opts.previewFile,
				configRoot: opts.backend === "attach" ? null : lopRun.configRoot,
				timeoutMs: Math.max(1000, runDeadline - Date.now()),
			});
			if (!receipt.imagePreview.pass)
				abort = `file-preview provenance: ${receipt.imagePreview.problem}`;
		}
		// The landing is read while the run is still whole (the steps are done,
		// the reap has not started), so a FAIL names the file it saw.
		if (!abort && plan.download) {
			const landing = inspectLanding(plan.download, downloadBefore.rig, {
				rigRoots: [plan.backendHome, opts.backendConfigRoot],
			});
			receipt.download = { ...receipt.download, ...landing.result };
			abort = landing.problem;
		}
		if (plan.download)
			receipt.download.toastLatency = downloadToastLatency(
				steps.steps,
				receipt.steps,
			);
		if (abort) throw new Error(abort);
		receipt.verdict = "captured";
	} catch (error) {
		// A signal that landed mid-run is THE cause; what the main path saw next
		// (the reaped app exiting) is only its symptom.
		receipt.error = interrupted
			? `interrupted by ${interrupted}`
			: error.message;
		const hint = plan.download
			? downloadFailureHint(receipt.error, plan.download.file)
			: null;
		if (hint) receipt.error = `${receipt.error} (${hint})`;
		receipt.exit = error instanceof Refusal ? error.code : EXIT.FAILED;
		if (!interrupted && /exceeded --timeout/.test(receipt.error))
			receipt.endedBy = { timeoutS: opts.timeoutS };
		// Refusals and BLOCKED raised after the rig exists (attach mode) say so,
		// rather than reading as a run failure (QA r1 nit).
		const prefix =
			receipt.exit === EXIT.REFUSED
				? "REFUSED: "
				: receipt.exit === EXIT.BLOCKED
					? receipt.error.startsWith("BLOCKED")
						? ""
						: "BLOCKED: "
					: "FAILED: ";
		console.error(`[mac-proof] ${prefix}${receipt.error}`);
	}
	return finalize();
}

if (isEntryPoint(import.meta.url)) {
	main().then((code) => process.exit(code));
}
