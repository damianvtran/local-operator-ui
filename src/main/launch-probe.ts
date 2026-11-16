/**
 * `--lo-launch-probe`: the release gate's way to ask a packaged bundle "do you
 * really start?" without a window, a profile lock, a backend or a user.
 *
 * WHY IT EXISTS. The macOS release gate (`scripts/verify-macos-artifacts.mjs`,
 * check `app-spawn`) used to exec the shipped launcher in Electron's node mode
 * (`ELECTRON_RUN_AS_NODE=1 <exe> -p 'process.exit(0)'`) to observe AMFI's
 * decision at exec, and a second check ran a bytecode probe the same way. F2
 * turns the RunAsNode fuse OFF, because node mode ran arbitrary JS inside the
 * genuine signed process (and passed its designated requirement), which would
 * make the runtime's app-signature attestation worthless. With the fuse off,
 * that command no longer runs a Node one-liner: it BOOTS THE WHOLE APP, which
 * on a build runner hangs to the bound, and on a person's machine raises a
 * window and touches the keychain. So the probe has to live in the app itself.
 *
 * WHAT A PASS PROVES, which is more than both old checks together:
 * - the OS let the real launcher exec (the 0.29.6 class, decided by amfid);
 * - Electron accepted `app.asar` under the integrity and only-from-asar fuses
 *   (a mismatched archive header, or tampering in any file read before this
 *   probe, aborts before the marker; Electron checks other files' block
 *   hashes only when they are first read, so they fail later, not here);
 * - the shipped `out/main/index.jsc` loaded under the bundle's OWN V8 (the
 *   0.30.10 x64 class: foreign bytecode throws `cachedDataRejected` before this
 *   module's caller is ever reached), because this runs from that bytecode.
 *
 * CONSTRAINTS. The caller (`src/main/index.ts`) runs this immediately after its
 * imports, before `requestSingleInstanceLock`, before any window, Dock tile,
 * `whenReady`, backend or telemetry, so a probe never collides with the
 * operator's running instance and never writes to their profile. The gate still
 * passes a scratch `--user-data-dir` and `--use-mock-keychain` so Chromium's own
 * early start-up has nowhere real to touch. It exits with `app.exit(0)`, which
 * Electron honours before `ready`.
 *
 * It grants nothing: the flag makes the process print three version strings and
 * leave. It is not a way to drive the app, and PR #3 of F2 treats any `--lo-*`
 * switch on a launch as ineligible to attest a card answer anyway.
 */

import { writeSync } from "node:fs";

/** The switch the gate passes. */
export const LAUNCH_PROBE_FLAG = "--lo-launch-probe";

/**
 * The stdout line prefix. The JSON after it rides the SAME line so a reader that
 * decides on the first match has every fact or none (the same reason
 * `LOCAL_OPERATOR_UI_READY` carries its version inline).
 */
export const LAUNCH_PROBE_MARKER = "LOCAL_OPERATOR_LAUNCH_PROBE";

export interface LaunchProbeReport {
	ok: true;
	electron: string;
	node: string;
	v8: string;
	arch: string;
	packaged: boolean;
}

/**
 * Whether this launch asked for the probe.
 *
 * Exact match only, and anywhere before a bare `--`: Chromium stops reading
 * switches at `--` (AGENTS.md, "NO `--` BEFORE THE EXTRA SWITCHES"), so a flag
 * after it is a positional argument, not a request.
 */
export function launchProbeRequested(argv: readonly string[]): boolean {
	for (const arg of argv) {
		if (arg === "--") return false;
		if (arg === LAUNCH_PROBE_FLAG) return true;
	}
	return false;
}

/** The one line the probe prints. */
export function launchProbeLine(report: LaunchProbeReport): string {
	return `${LAUNCH_PROBE_MARKER} ${JSON.stringify(report)}`;
}

/**
 * Print the probe line and exit when the flag is present; return false (and do
 * nothing) otherwise. The Electron `app` is passed in rather than imported so
 * the decision and the line can be tested without booting Electron.
 */
export function runLaunchProbeIfRequested(
	app: { isPackaged: boolean; exit: (code?: number) => void },
	argv: readonly string[] = process.argv,
	/*
	 * `writeSync` on fd 1, not `process.stdout.write`: on macOS a pipe stdout is
	 * ASYNCHRONOUS in Node, and `app.exit` right after could drop the line the
	 * gate is waiting for. A synchronous write is in the pipe before exit.
	 */
	write: (line: string) => void = (line) => {
		writeSync(1, `${line}\n`);
	},
): boolean {
	if (!launchProbeRequested(argv)) return false;
	write(
		launchProbeLine({
			ok: true,
			electron: process.versions.electron ?? "",
			node: process.versions.node,
			v8: process.versions.v8,
			arch: process.arch,
			packaged: app.isPackaged,
		}),
	);
	app.exit(0);
	return true;
}
