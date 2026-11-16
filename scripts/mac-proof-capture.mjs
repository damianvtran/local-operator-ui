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

export const SCENES = Object.freeze([
	"conversation",
	"files",
	"canvas",
	"library",
	"notifications",
]);
export const THEMES = Object.freeze({
	dark: "localOperatorDark",
	light: "localOperatorLight",
});
const SESSION_ID = /^[a-f0-9]{12}$/;

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
 * `codesign --verify --deep --strict`, recorded for the reviewer and never
 * gating: verify reads the bundle and its embedded signature only (no keychain,
 * so no prompt), and an unsigned or ad-hoc PR artifact is still a frame of that
 * artifact. Not run off darwin.
 */
export function codesignVerdict(
	appPath,
	{ platform = process.platform, timeoutMs },
) {
	if (platform !== "darwin") return { ran: false, reason: "not darwin" };
	const result = spawnSync(
		"/usr/bin/codesign",
		["--verify", "--deep", "--strict", appPath],
		{
			encoding: "utf8",
			timeout: Math.max(1000, timeoutMs),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	return {
		ran: true,
		valid: result.status === 0,
		status: result.status,
		detail: (result.error?.message ?? result.stderr ?? "").trim().slice(0, 600),
	};
}

/**
 * Extract `--app-zip` into `<rig>/app` and resolve the bundle through the same
 * guards as `--app`, plus the operator-root check on the extracted path.
 */
export function releaseZipApp(
	zipInfo,
	rig,
	{ roots, timeoutMs, platform = process.platform },
) {
	const dest = join(rig, "app");
	extractAppZip(zipInfo.path, dest, { platform, timeoutMs });
	const bundle = bundleInExtracted(dest);
	const problem = operatorPathProblem("--app-zip bundle", bundle, roots);
	if (problem) throw new Refusal(problem);
	const app = resolveAppBundle(bundle);
	return {
		...app,
		kind: "release-zip",
		zip: zipInfo,
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
		timeoutS: 180,
		rigRoot: null,
		backend: "isolated",
		backendUrl: null,
		backendConfigRoot: null,
		backendHome: null,
		peerWaitS: 120,
		lop: null,
		seedConfig: null,
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
			case "--serve-record-dir":
				opts.serveRecordDir = take();
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
	return opts;
}

/** Every refusal that needs no filesystem state beyond the flags themselves. */
/** --peer-wait was given explicitly (its default must not trip the mode check). */
function argvHasPeerWait(opts) {
	return opts.peerWaitS !== 120;
}

export function validateOptions(opts) {
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
		opts.scenes.some((s) => s === "files" || s === "canvas")
	)
		throw new Refusal(
			"the files and canvas scenes need --session (the canvas belongs to a conversation)",
		);
	const mode = windowModeProblem(opts.windowMode);
	if (mode) throw new Refusal(mode);
	const capture = captureModeProblem(opts.capture, opts.windowMode);
	if (capture) throw new Refusal(capture);
	if (!/^\d{3,4}x\d{3,4}$/.test(opts.size))
		throw new Refusal(`--size must be WxH (got ${opts.size})`);
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
 * The step list the app's S1 runner walks. One launch: onboarding out of the
 * way, readiness, then per theme every scene with one shutter each. Frames are
 * labelled `<scene>-<theme>` (also the PNG name).
 */
export function buildSteps({ scenes, themes, session, capture }) {
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
				steps.push({
					verb: "waitFor",
					payload: { selector: '[data-chat-region="header"]' },
				});
			} else {
				steps.push({ verb: "navigate", payload: `/${scene}` });
			}
			steps.push(shutter(label));
		}
	}
	return { steps };
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
]);

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
	let url;
	try {
		url = new URL(pathWithQuery, "http://127.0.0.1");
	} catch {
		return `not a path: ${pathWithQuery}`;
	}
	if (FORBIDDEN_DAEMON_PATH.test(url.pathname))
		return `refused daemon call ${method} ${url.pathname}: the harness never prompts, sends, engages or resumes`;
	const route = DAEMON_ROUTES.find(
		(r) => r.method === method && r.path === url.pathname,
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
 * `network.port` from `<root>/config.yml`, read without a YAML dependency: the
 * block-style `network:` mapping and its indented `port:` key. Anything else
 * (flow style, anchors) answers null, which REFUSES - fail closed, because an
 * unset port makes the relay advertise :4097 and peers then dial the operator's
 * real relay (measured on node2: writes reached the real audit log).
 */
export function relayPortFromConfig(text) {
	const lines = text.split(/\r?\n/);
	let inNetwork = false;
	let indent = null;
	for (const line of lines) {
		if (/^\S/.test(line)) {
			inNetwork = /^network:\s*(#.*)?$/.test(line);
			indent = null;
			continue;
		}
		if (!inNetwork || line.trim() === "" || line.trim().startsWith("#"))
			continue;
		const lead = line.match(/^(\s+)/)[1].length;
		indent ??= lead;
		if (lead !== indent) continue;
		const match = line.match(/^\s+port:\s*["']?(\d+)["']?\s*(#.*)?$/);
		if (match) return Number(match[1]);
	}
	return null;
}

export function relayPortProblem(port) {
	if (port === null || !Number.isInteger(port) || port <= 0 || port > 65535)
		return "--backend-config-root needs network.port set in <root>/config.yml (unset, the relay advertises the operator's :4097 and peers dial it)";
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
const SHUTTER_CAPTUREPAGE =
	/^SHUTTER label=(\S+) capture=capturepage path=.+ width=(\d+) height=(\d+) visible=(true|false) focused=(true|false)$/;

export function createSupervisor({
	windowMode,
	session,
	capture,
	framesDir,
	labels = null,
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
			return null;
		}
		const step = body.match(/^step=(\d+) verb=(\S+) (ok|error:|skipped)(.*)$/);
		if (step) {
			const [, n, verb, outcome, rest] = step;
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
			if (focused !== "false")
				return { abort: `the window is focused at the shutter (${body})` };
			if (external) {
				if (visible !== "true")
					return {
						abort: `the window is not visible at the shutter (${body})`,
					};
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
 * never prompts (its sibling `CGRequestScreenCaptureAccess` would put a dialog on
 * the operator's screen and is never called).
 *
 * Answers "granted", "denied" or "unknown". UNKNOWN - the JXA bridge could not
 * call the preflight - is BLOCKED by the caller, never guessed. An earlier
 * fallback read "another process's window has a kCGWindowName" as granted, but
 * system UI (Menubar, Dock, Window Server) reports names without the
 * permission, so it could answer yes while ungranted; `screencapture -l` would
 * then raise the TCC prompt on the operator's screen and photograph an empty
 * window (review r1 R1-1). Not being able to ask safely is a stop.
 */
export function screenRecordingGranted() {
	return screenRecordingVerdict(
		jxa(`
ObjC.import('CoreGraphics');
var granted = null;
try { if (typeof $.CGPreflightScreenCaptureAccess === 'function') granted = !!$.CGPreflightScreenCaptureAccess(); } catch (e) {}
JSON.stringify({granted: granted});`),
	);
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
	const lsof = spawnSync(
		"lsof",
		["-n", "-P", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
		{ encoding: "utf8", timeout: 10000 },
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
async function reapConfigRootProcesses(configRoot, recorded, rig) {
	const pids = new Set(recorded);
	for (const pid of processesWithConfigRoot(configRoot) ?? []) pids.add(pid);
	const left = await killRigMatched(
		[...pids],
		rigMatcher({ rig, configRoot }),
		{
			settleMs: 500,
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
	const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
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
 * What the backstop needs to know about one live pid, read from the kernel at
 * kill time: working directory, process group, and argv+env as text. Linux
 * reads /proc; macOS asks `ps` (`-E` appends the environment, same user only)
 * and `lsof -d cwd`. Null when the pid is gone or unreadable.
 */
export function processFacts(pid) {
	if (process.platform === "linux") {
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			// Field 5 (pgrp), counted after the parenthesised comm, which may hold spaces.
			const pgid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
			let cwd = null;
			try {
				cwd = readlinkSync(`/proc/${pid}/cwd`);
			} catch {}
			let text = "";
			for (const file of ["cmdline", "environ"])
				try {
					text += `\0${readFileSync(`/proc/${pid}/${file}`, "utf8")}`;
				} catch {}
			return { pid, pgid, cwd, text };
		} catch {
			return null;
		}
	}
	const ps = spawnSync(
		"ps",
		["-E", "-ww", "-o", "pgid=,command=", "-p", String(pid)],
		{ encoding: "utf8" },
	);
	const m = (ps.stdout ?? "").trim().match(/^(\d+)\s+([\s\S]*)$/);
	if (ps.status !== 0 || !m) return null;
	const lsof = spawnSync(
		"lsof",
		["-n", "-P", "-a", "-p", String(pid), "-d", "cwd", "-F", "n"],
		{ encoding: "utf8", timeout: 10000 },
	);
	const cwd =
		(lsof.stdout ?? "")
			.split("\n")
			.find((line) => line.startsWith("n"))
			?.slice(1) ?? null;
	return { pid, pgid: Number(m[1]), cwd, text: m[2] };
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
 * The stray-pid backstop. SIGKILL each pid ONLY if it is still this run's
 * (`matches`, re-read now: a recorded pid can have been recycled), and its
 * whole group ONLY when that pid leads the group itself. The earlier version
 * signalled `-pid` for every swept pid, which widened one stray rig process
 * (a shell someone `cd`'d into the rig, a recycled pid) into its whole group,
 * strangers included (review r1 R1-10). This process and its ancestors are
 * never targets. Answers the matched pids still alive afterwards; a pid that
 * is alive but no longer matches is skipped, not counted as a leak.
 */
export async function killRigMatched(pids, matches, { settleMs = 300 } = {}) {
	const mine = new Set(ancestorsOfSelf());
	const targets = [];
	for (const pid of new Set(pids)) {
		if (!Number.isInteger(pid) || pid <= 1 || mine.has(pid)) continue;
		const facts = processFacts(pid);
		if (!matches(facts)) continue;
		targets.push(pid);
		if (facts.pgid === pid)
			try {
				process.kill(-pid, "SIGKILL");
			} catch {}
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
	if (targets.length > 0) await sleep(settleMs);
	return targets.filter((pid) => pidAlive(pid) && matches(processFacts(pid)));
}

/** Every descendant pid of `roots`, from one `ps` snapshot. */
export function descendantsOf(roots) {
	const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
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
				relayPortProblem(relayPortFromConfig("network:\n  enabled: true\n")),
		],
		[
			"config-root relay with network.port 4097",
			() => relayPortProblem(relayPortFromConfig("network:\n  port: 4097\n")),
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
			"daemon call to an absolute URL on another host",
			() => daemonRequestProblem("GET", "http://10.255.255.1:9/health"),
		],
		[
			"daemon call to a //host path",
			() => daemonRequestProblem("GET", "//10.255.255.1/health"),
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
	return { app, rigRoot, lop, relayPort, backendHome };
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
					: "capturePage: no vibrancy claim",
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
				`[mac-proof] BLOCKED: could not read Screen Recording permission without a prompt (${error.message})`,
			);
			return EXIT.BLOCKED;
		}
		if (verdict === "unknown") {
			console.error(
				"[mac-proof] BLOCKED: CGPreflightScreenCaptureAccess is not callable from JXA here, so Screen Recording cannot be read without risking a prompt. " +
					"Use --capture capturepage (no vibrancy claim), or report this macOS version so the harness can learn another prompt-free probe.",
			);
			return EXIT.BLOCKED;
		}
		if (verdict !== "granted") {
			console.error(
				"[mac-proof] BLOCKED: Screen Recording is not granted to this process's host (the terminal or agent app). " +
					"Grant it in System Settings > Privacy & Security > Screen Recording; this harness never requests it (that would prompt).",
			);
			return EXIT.BLOCKED;
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
				: "capturePage: no vibrancy claim",
		backend: { mode: opts.backend },
		frames: [],
		steps: [],
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
	const recordDescendants = () => {
		const live = lopRun.spawned
			.map((c) => c.pid)
			.filter((pid) => pid !== undefined);
		for (const pid of [...live, ...descendantsOf(live)])
			lopRun.recorded.add(pid);
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
			);
		}
		// Recorded app descendants, then anything still running in the rig.
		const ours = rigMatcher({ rig, configRoot: lopRun.configRoot });
		const recordedLeft = await killRigMatched(
			[...appRecorded].filter((pid) => pidAlive(pid)),
			ours,
		);
		const inRig = processesWithCwdUnder(rig);
		const rigLeft = inRig === null ? null : await killRigMatched(inRig, ours);
		const after = processesWithCwdUnder(rig);
		receipt.reap.rig = {
			recorded: appRecorded.size,
			swept: inRig === null ? "unreadable" : inRig.length,
			clean:
				recordedLeft.length === 0 &&
				rigLeft !== null &&
				after !== null &&
				after.length === 0,
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
			const leaked = Object.values(receipt.reap).some(
				(r) => r && r.clean === false,
			);
			if (leaked) {
				receipt.verdict = "failed";
				receipt.error = `${receipt.error ? `${receipt.error}; ` : ""}a process this run started survived the reap`;
				receipt.exit = EXIT.FAILED;
			}
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
					rmSync(extracted, { recursive: true, force: true });
					receipt.app.extracted = { removed: extracted };
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
				seeded: Boolean(opts.seedConfig),
				serve: { command: plan.lop, pid: serve.pid },
				health: { pid: health.pid ?? null, version: health.version ?? null },
				tokenSource: "minted by the harness (env only)",
			};
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
					method: "capturePage: no vibrancy claim",
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
		writeFileSync(
			join(rig, "logs", "app-stdout.log"),
			token
				? appLog.join("\n").replaceAll(token, "<redacted>")
				: appLog.join("\n"),
		);
		const expected = opts.scenes.length * opts.themes.length;
		if (!abort && receipt.frames.length !== expected)
			abort = `captured ${receipt.frames.length} of ${expected} frames`;
		if (abort) throw new Error(abort);
		receipt.verdict = "captured";
	} catch (error) {
		// A signal that landed mid-run is THE cause; what the main path saw next
		// (the reaped app exiting) is only its symptom.
		receipt.error = interrupted
			? `interrupted by ${interrupted}`
			: error.message;
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
