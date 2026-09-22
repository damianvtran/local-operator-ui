#!/usr/bin/env node
/**
 * Proof that a console surface can run the tools the user installed - through the
 * app's OWN construction path.
 *
 * WHY THIS EXISTS. The app is launched by launchd from Finder or the Dock, so its
 * process environment is the macOS default rather than a shell's: measured on this
 * machine, `ps eww` on the running app reports `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
 * and `launchctl getenv PATH` is unset. Nothing the user installed through
 * Homebrew, nvm, pyenv or cargo is in that list, so a surface asked to run `brew`
 * exited 1 with no output - the console could not run the very tools an agent is
 * meant to acquire through it.
 *
 * WHAT IT RUNS. `startConsoleHost` - the app's own entry point, the one place that
 * decides what environment a surface is handed - twice, differing in ONE thing:
 * whether it is given the login-shell PATH resolver the app now builds. The
 * BEFORE arm is the wiring as it was (`withUserShellPath` with no resolver returns
 * the environment untouched), the AFTER arm is the wiring as it ships. Both then
 * create a surface through the returned host, with the shipped pty spawner, at the
 * shipped grid, and read the result back through the host's own `read`.
 *
 * WHY THAT MATTERS FOR THIS RIG SPECIFICALLY (round-1 review R1-4, QA's Q-1): an
 * earlier version of this file built the AFTER environment itself
 * (`withUserShellPath(launchEnv, resolver)`) and handed it to a host it
 * constructed, which stayed GREEN with `startConsoleHost`'s `env:` line deleted -
 * it was evidence about the resolver and the pty, not about the app being wired.
 * Now the only thing the rig chooses is which arm gets a resolver; the environment
 * a surface sees is whatever `startConsoleHost` derives. Disconnect that line and
 * the AFTER arm fails.
 *
 * WHAT IT STILL DOES NOT RUN, STATED SO A GREEN RUN IS NOT READ AS MORE THAN IT
 * IS: Electron. The window is a stub (`window: () => null`, no surface is
 * displayed), and the app's own bootstrap, renderer and RPC endpoint are not
 * here. The pty, the environment, the host, the registry and the read path are the
 * shipped ones.
 *
 * Isolation: nothing of the operator's is touched. A scratch directory holds the
 * bundle, the console history root and the electron stub, its `node_modules` is a
 * symlink to this checkout's, and the directory is removed on exit unless `--keep`
 * is passed. The app's own process is only READ, for the PATH it reports.
 *
 * Usage: node scripts/shell-path-console-proof.mjs [--keep]
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const KEEP = process.argv.includes("--keep");

/** The path of the operator's own app, so the run reads the launch environment
 * the defect is about rather than a guess at it. */
const APP_PROCESS_PATTERN = "Local Operator.app/Contents/MacOS/Local Operator";

/** The state the legacy `consoleHostEnabled()` reads; set explicitly so the run
 * does not depend on the ambient environment. */
const CONSOLE_HOST_ENV = "LOCAL_OPERATOR_UI_CONSOLE_HOST";

const dir = mkdtempSync(join(tmpdir(), "lo-shell-path-proof-"));
process.on("exit", () => {
	if (!KEEP) rmSync(dir, { recursive: true, force: true });
});

/** The PATH the running app's process has, read from the process itself. */
function appProcessPath() {
	const pid = spawnSync("pgrep", ["-f", APP_PROCESS_PATTERN])
		.stdout.toString()
		.trim()
		.split("\n")[0];
	if (!pid) return null;
	const env = spawnSync("ps", ["eww", "-p", pid]).stdout.toString();
	return { pid, path: /(?:^|\s)PATH=(\S+)/.exec(env)?.[1] ?? "" };
}

const app = appProcessPath();
if (!app) {
	console.log(
		`BLOCKED: no running app matched "${APP_PROCESS_PATTERN}", so this run cannot read the launch environment the defect is about.`,
	);
	process.exit(2);
}
console.log(`app pid ${app.pid}: PATH=${app.path}`);

// The bundle resolves `node-pty` from its own directory upwards.
symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"));

// `src/main/console/capture.ts` and `ipc.ts` reach Electron as VALUES, which an
// ESM bundle cannot require; the same stub shape `scripts/console-host.test.mjs`
// uses, plus the `ipcMain.handle` the host's namespace registration calls.
const electronStub = join(dir, "electron-stub.mjs");
writeFileSync(
	electronStub,
	[
		"export const app = { isPackaged: false, getPath: () => process.env.HOME, getAppPath: () => process.cwd() };",
		"export const ipcMain = { handle: () => {}, removeHandler: () => {}, on: () => {} };",
		"export class BrowserWindow { static getAllWindows() { return []; } }",
	].join("\n"),
);

const bundlePath = join(dir, "console-proof.mjs");
await build({
	stdin: {
		contents: [
			'export * from "./src/main/console/index";',
			'export * from "./src/main/console/host";',
			'export * from "./src/main/shell-path";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	outfile: bundlePath,
	absWorkingDir: process.cwd(),
	alias: { electron: electronStub },
	banner: {
		js: 'import { createRequire as __proofRequire } from "node:module"; const require = __proofRequire(import.meta.url); const __dirname = process.cwd();',
	},
});

const { startConsoleHost, createUserShellPath } = await import(bundlePath);

/**
 * One surface through the app's own host, run to completion.
 *
 * `userShellPath` is the ONLY difference between the two arms: with none, the
 * host hands a surface the environment it was launched with, which is the wiring
 * before this change; with one, the host derives PATH from the user's shell.
 */
async function runSurface(label, userShellPath) {
	const startup = await startConsoleHost({
		// The host broadcasts a state frame to the window on every change, so the
		// stub has to answer the two questions that broadcast asks - not a real
		// window, and nothing is displayed on it.
		window: {
			isDestroyed: () => false,
			webContents: { send: () => {} },
		},
		expectedUrl: "http://localhost/proof",
		appVersion: "0.0.0-proof",
		log: () => {},
		userShellPath,
		configDir: join(dir, `config-${label}`),
		restoreHistory: false,
	});
	if (!startup.ok) {
		throw new Error(`console host did not start: ${startup.reason}`);
	}
	const created = await startup.host.create({
		sessionId: "shell-path-proof",
		origin: "agent",
		command: "brew",
		args: ["--version"],
		cols: 100,
		rows: 30,
	});
	for (let attempt = 0; attempt < 150; attempt += 1) {
		if (!startup.host.status(created.surface).running) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const status = startup.host.status(created.surface);
	// The viewport, not the scrollback: `brew --version` is a few lines and never
	// scrolls, so what has scrolled out of view is empty by definition.
	const read = await startup.host.read(created.surface, "viewport");
	const firstLine = String(read.text ?? "")
		.trim()
		.split("\n")[0];
	console.log(`\n== ${label}`);
	console.log(`   surface ${created.surface}  exit_code=${status.exit_code}`);
	console.log(`   first line: ${JSON.stringify(firstLine)}`);
	await startup.stop();
	return { exitCode: status.exit_code, firstLine };
}

// Every arm runs with the app's OWN launch environment, which is the whole point:
// the defect exists because that PATH cannot see `brew`.
process.env.PATH = app.path;
process.env[CONSOLE_HOST_ENV] = "1";

const resolver = createUserShellPath({
	log: (message) => console.log(`   ${message}`),
});
console.log("\nresolved login-shell PATH:");
const resolved = await resolver.resolve();
console.log(`   ${resolved ?? "(none)"}`);

const before = await runSurface(
	"BEFORE - the host with no resolver",
	undefined,
);
const after = await runSurface(
	"AFTER - the host given the resolver the app builds",
	resolver,
);

console.log("\nverdict");
console.log(`   before: exit ${before.exitCode}  ${before.firstLine}`);
console.log(`   after:  exit ${after.exitCode}  ${after.firstLine}`);
if (KEEP) console.log(`\nkept: ${dir}`);

const ok =
	before.exitCode !== 0 &&
	after.exitCode === 0 &&
	after.firstLine.startsWith("Homebrew");
process.exit(ok ? 0 : 1);
