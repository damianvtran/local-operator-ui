import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { localOperatorConfigDir } from "../browser/state-file";
import { dispatchConsole, isConsoleDispatchMethod } from "./dispatch";
import { ConsoleHistory } from "./history";
import {
	ConsoleHost,
	type PtyHandle,
	type SpawnOptions,
	type SurfaceRuntime,
} from "./host";
import { registerConsoleIpc, unregisterConsoleIpc } from "./ipc";
import { type PtyModule, loadNodePty, spawnPty } from "./pty";
import { ConsoleRegistry, MAX_SURFACES_PER_APP } from "./registry";

/**
 * The console host: wiring, lifecycle, and what the app reports about it.
 *
 * Design: docs/design/ui-console-tab.md 10.1 (one endpoint, one record, one new
 * namespace — the two flags), 10.4 (the reveal push), 12.1 (the completion
 * ladder's rungs), 7.3/7.4 (restore and the GC), 16.1 (this rig's window mode).
 *
 * WHY ONE ENTRY POINT: the pieces have a strict order — the pty must load before a
 * surface can exist, the history root must be resolved before a retained surface
 * can be restored, and the RPC dispatcher and the renderer namespace must both see
 * the same host — and every one of them must be released together on quit. Spread
 * across call sites, one of them ends up half-applied, which is the argument the
 * browser host's own entry point makes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never shows, raises or activates a window
 * (the reveal push asks the renderer, and the app's only module allowed to raise
 * anything is `window-raise.ts`), it never writes terminal content to a log line
 * (design 11.6.1), and it never touches a socket of its own — the console rides the
 * host's existing loopback endpoint and its existing record (design 10.1).
 */

/** The console's own kill switch. Default ON, and separate from the browser
 * host's flag so the browser host cannot take the console down with it. */
export const CONSOLE_HOST_ENV = "LOCAL_OPERATOR_UI_CONSOLE_HOST";

export interface StartConsoleHostOptions {
	window: BrowserWindow;
	/** The trusted renderer URL, for the IPC sender check. */
	expectedUrl: string;
	appVersion: string;
	log: (message: string) => void;
	now?: () => number;
	/** The config root the history lives under, defaulting to the same root the
	 * discovery record uses. */
	configDir?: string;
	/** Whether to replay retained surfaces at launch (design 7.3). On by default;
	 * a rig turns it off to assert that a fresh app has no surfaces, and a test
	 * turns it on to assert that a relaunch does. */
	restoreHistory?: boolean;
	/** The pty seam, injectable for tests. */
	spawn?: (options: SpawnOptions) => PtyHandle;
}

/** What the app learns about the console when it starts. */
export type ConsoleStartup =
	| {
			ok: true;
			host: ConsoleHost;
			registry: ConsoleRegistry<SurfaceRuntime>;
			/** The two numbers the discovery record carries (design 10.1). */
			counts: () => { total: number; agent: number };
			/** Route one console method. Answers only for console names. */
			dispatch: (
				method: string,
				params: Record<string, unknown>,
			) => Promise<Record<string, unknown>>;
			stop: () => Promise<void>;
	  }
	| {
			ok: false;
			/** `disabled` is the kill switch; `pty_unavailable` is the native
			 * module, which the design treats as a packaging bug with a remedy the
			 * user can report (design 15). */
			reason: "disabled" | "pty_unavailable";
			detail: string;
			stop: () => Promise<void>;
	  };

/** Whether the console feature is enabled for this run. Same three spellings the
 * browser host accepts, because a rig that asserts "no console" should not have to
 * learn a second convention. */
export function consoleHostEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const flag = env[CONSOLE_HOST_ENV]?.trim().toLowerCase();
	return !(flag === "0" || flag === "false" || flag === "off");
}

/**
 * §8.2 step 2(c)'s broadcast, in one place.
 *
 * A pane learns a grid from its OWN `console-content-rect` reply today, so a grid
 * an AGENT changed (`console_resize`) reaches no mounted pane at all and the mirror
 * keeps painting the old wrapping and cursor row until a remount.
 *
 * The frame carries NO payload, deliberately: §8.2 step 3 says the mirror applies
 * the grid "only as the value main returned", so the pane re-reads `console-state`
 * after this and applies what main says — a pushed number would be a second
 * authority on the one thing the design gives main.
 */
export function broadcastConsoleState(window: BrowserWindow): void {
	if (window.isDestroyed()) return;
	window.webContents.send("console-state-changed");
}

export async function startConsoleHost(
	options: StartConsoleHostOptions,
): Promise<ConsoleStartup> {
	const { log } = options;
	if (!consoleHostEnabled()) {
		log(
			`[console] disabled by ${CONSOLE_HOST_ENV}; no surfaces will be created and the record carries console: false`,
		);
		return {
			ok: false,
			reason: "disabled",
			detail: `${CONSOLE_HOST_ENV} is off`,
			stop: async () => {},
		};
	}

	const load = loadNodePty();
	if (!load.ok) {
		// ONE line, and it names the failure rather than the symptom: the design's
		// answer to a native module that will not load is that the capability is
		// absent and the reason is visible, never that the app is broken.
		log(`[console] node-pty is unavailable: ${load.reason}`);
		return {
			ok: false,
			reason: "pty_unavailable",
			detail: load.reason,
			stop: async () => {},
		};
	}

	if (load.helper.healed) {
		// The load-time heal is reported as loudly as the per-spawn one. It is the
		// common case (the tarball ships 0644, so the FIRST check in a process heals),
		// and a silent heal would hide the packaging defect P13 exists to catch.
		log(
			`[console] restored the exec bit on ${load.helper.path ?? "spawn-helper"}`,
		);
	}

	const configDir = options.configDir ?? localOperatorConfigDir();
	const history = new ConsoleHistory(
		join(configDir, "run", "ui-console", "history"),
	);
	const registry = new ConsoleRegistry<SurfaceRuntime>();
	const host = new ConsoleHost(registry, {
		window: () => options.window,
		log,
		history,
		now: options.now,
		spawn:
			options.spawn ??
			((spawnOptions: SpawnOptions) =>
				spawnPty(load.module as PtyModule, spawnOptions, (report) => {
					// A heal is worth a line: it means the artifact or the update path
					// delivered the wrong mode, which is the packaging defect P13 exists
					// to catch, and a silent heal would hide the next one.
					log(
						`[console] restored the exec bit on ${report.path ?? "spawn-helper"}`,
					);
				})),
		onChanged: () => {
			broadcastConsoleState(options.window);
		},
		onReveal: (request) => {
			// The renderer's half of `reveal` (design 10.4): whether the session an
			// agent named is the one on screen is a question only the renderer can
			// answer, and this push never carries a request to raise the window.
			const window = options.window;
			if (window.isDestroyed()) return;
			window.webContents.send("console-reveal", {
				surface: request.surface,
				session_id: request.sessionId,
				mode: request.mode,
			});
		},
	});

	if (options.restoreHistory !== false) {
		const retained = history
			.list()
			.sort((a, b) => b.meta.last_seen_at - a.meta.last_seen_at)
			.slice(0, MAX_SURFACES_PER_APP);
		for (const surface of retained) {
			host.restore(surface.meta, surface.bytes);
		}
		if (retained.length > 0) {
			// The count and the honesty in one line: nothing restored here is running,
			// and every one of them reads `live: false` from birth (design 7.3).
			log(
				`[console] restored ${retained.length} retained surface(s) from history; none of them is running`,
			);
		}
	}

	const collected = history.collect();
	if (collected.removedSessions.length > 0) {
		log(
			`[console] history GC removed ${collected.removedSurfaces} surface(s) from ${collected.removedSessions.length} session(s) older than the window`,
		);
	}

	registerConsoleIpc({
		window: () => options.window,
		expectedUrl: options.expectedUrl,
		host: () => host,
		log,
	});

	log(
		`[console] host ready on the existing endpoint: ${registry.count()} surface(s) (node-pty ${load.helper.mode === null ? "without a helper" : "ready"})`,
	);

	return {
		ok: true,
		host,
		registry,
		counts: () => host.counts(),
		dispatch: async (method, params) => {
			if (!isConsoleDispatchMethod(method)) {
				// Unreachable through the RPC layer, which routes by the same predicate;
				// a typed refusal here rather than an assertion keeps a mixed-up wiring
				// from answering a browser method with a console result.
				throw new Error(`not a console method: ${method}`);
			}
			return dispatchConsole(host, method, params);
		},
		stop: async () => {
			unregisterConsoleIpc();
			host.dispose();
			log("[console] host stopped");
		},
	};
}
