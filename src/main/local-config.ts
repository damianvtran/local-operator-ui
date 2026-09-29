/**
 * The one thing this app reads straight out of the backend's config file: the
 * global hotkey's stored value.
 *
 * WHY THE FILE AND NOT THE DAEMON. The hotkey has to work before — and without
 * — a reachable backend: a Dock-only app still answers the chord, and the
 * registrar must be live by the time a person presses it. `config.yml` is the
 * single source of truth every writer funnels through (`lop config edit`, the
 * TUI's `/settings`, the desktop's own `PATCH /v1/settings/{key}`), so reading
 * it directly is reading the same value the daemon would serve, without
 * waiting for a round trip that may never answer. The same reasoning the
 * viewer record uses for its own config root applies: the backend resolves
 * `LOCAL_OPERATOR_CONFIG_DIR` per call, so this module does too.
 *
 * WHAT IT IS NOT. It is not a second settings implementation: it reads ONE
 * flat-dotted key (`keymap.quick_send`, stored under `values:` exactly as
 * `settings_io._store` writes it — a single path element, so the literal key
 * with its dot) and it validates nothing. The registrar is where a value is
 * judged; this module's contract is "the bytes, parsed, or a notice".
 *
 * FAILURE POLICY, stated once: a config that cannot be read, parsed, or that
 * carries a non-string value is a NOTICE, never a crash and never a silent
 * default. The last good registration survives it — a hand-broken YAML edit
 * must not take a working hotkey down — and the notice goes to the caller's
 * log so the state is findable rather than mysterious.
 */

import { unwatchFile, watch, watchFile } from "node:fs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DEFAULT_QUICK_SEND_VALUE } from "./hotkey-registration";

/** The config file's name, the same constant the backend's `config.py` uses. */
export const CONFIG_FILE_NAME = "config.yml";

/**
 * The flat-dotted key, one string — see the module docstring for why the dot
 * is part of the literal key rather than a nesting step.
 */
export const QUICK_SEND_KEY = "keymap.quick_send";

/** The poll interval `fs.watchFile` uses. Stats-polling is rename-safe, which
 * matters because every writer replaces the file atomically. */
export const CONFIG_POLL_INTERVAL_MS = 1_500;

/** How long a burst of filesystem events settles before one read. */
export const CONFIG_DEBOUNCE_MS = 250;

/**
 * The config directory, resolved the way the backend resolves it.
 *
 * Read from the environment on every call rather than captured at import, for
 * `viewer-record.ts`'s reason: the backend resolves the variable per call, and
 * a constant here would freeze whatever the first importer saw.
 */
export function quickSendConfigDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return env.LOCAL_OPERATOR_CONFIG_DIR || join(homedir(), ".local-operator");
}

/** The full path to the config file this module reads. */
export function quickSendConfigPath(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return join(quickSendConfigDir(env), CONFIG_FILE_NAME);
}

export interface QuickSendReading {
	/** The EFFECTIVE value: the stored one when present, else the default. */
	value: string;
	/** Whether the file itself carried a stored value for the key. */
	present: boolean;
	/**
	 * Set when the file or the value could not be used. The caller logs it; the
	 * returned `value` is then the DEFAULT only when nothing better is known —
	 * callers that hold a last-good value should keep it (see the watcher).
	 */
	problem?: string;
}

/**
 * Read the effective `keymap.quick_send` value once.
 *
 * Synchronous, deliberately: the file is a few kilobytes, the callers are the
 * registrar's boot and a debounced watcher tick, and an async read here would
 * put a promise between a keystroke and the state it explains for no gain.
 */
export function readQuickSendValue(
	env: NodeJS.ProcessEnv = process.env,
): QuickSendReading {
	const file = quickSendConfigPath(env);
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// No config yet (a fresh install): the default is the answer, not a
			// problem. §K.8 calls this out as a QA item precisely because it is
			// the ordinary first-run path.
			return { value: DEFAULT_QUICK_SEND_VALUE, present: false };
		}
		return {
			value: DEFAULT_QUICK_SEND_VALUE,
			present: false,
			problem: `config.yml could not be read (${String(code ?? error)})`,
		};
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(text);
	} catch (error) {
		return {
			value: DEFAULT_QUICK_SEND_VALUE,
			present: false,
			problem: `config.yml is not parseable YAML (${String(error)})`,
		};
	}
	const values =
		parsed !== null && typeof parsed === "object"
			? (parsed as { values?: unknown }).values
			: undefined;
	const stored =
		values !== null && typeof values === "object"
			? (values as Record<string, unknown>)[QUICK_SEND_KEY]
			: undefined;
	if (stored === undefined || stored === null) {
		return { value: DEFAULT_QUICK_SEND_VALUE, present: false };
	}
	if (typeof stored !== "string" || stored.trim() === "") {
		return {
			value: DEFAULT_QUICK_SEND_VALUE,
			present: false,
			problem: `config.yml carries a ${typeof stored} for ${QUICK_SEND_KEY}; expected a string chord`,
		};
	}
	return { value: stored.trim(), present: true };
}

export interface QuickSendWatcher {
	/** Stop every watch and the pending debounce. Idempotent. */
	stop(): void;
}

/**
 * Watch `config.yml` for the effective value changing.
 *
 * TWO WATCHES, ONE READ. `fs.watchFile` polls the file's stats and is
 * rename-safe — every writer replaces the file atomically, so an
 * mtime/inode-based watcher would fire for a path whose content a naive reader
 * could see half-written; stats polling plus a full re-read never does. A
 * directory watch is added beside it because the file may not exist yet (a
 * fresh install writes it later), and a `watchFile` on a path inside a
 * directory that does not exist is a poll with nothing to observe. Both funnel
 * into one debounced read, and the read's answer is compared to the last one
 * EMITTED: what fires `onValue` is the effective value differing, never a
 * write that changed only a comment or the mtime.
 *
 * `baseline` is what the caller has already applied, so starting the watcher
 * after an initial `readQuickSendValue` does not re-emit the same value.
 * Without it the first observed read is emitted unconditionally.
 *
 * A read that fails emits `onProblem` and passes NO value on, which is the
 * "keep the last good registration" half of the failure policy: the registrar
 * is left exactly as it was.
 */
export function watchQuickSend(options: {
	onValue: (value: string) => void;
	onProblem: (message: string) => void;
	env?: NodeJS.ProcessEnv;
	/** Overridable for tests; the shipped values are the constants above. */
	intervalMs?: number;
	debounceMs?: number;
	/** The effective value the caller already applied, if any. */
	baseline?: string;
}): QuickSendWatcher {
	const env = options.env ?? process.env;
	const file = quickSendConfigPath(env);
	const dir = quickSendConfigDir(env);
	const interval = options.intervalMs ?? CONFIG_POLL_INTERVAL_MS;
	const debounceMs = options.debounceMs ?? CONFIG_DEBOUNCE_MS;

	let last = options.baseline ?? null;
	let lastProblem: string | null = null;
	let timer: NodeJS.Timeout | null = null;
	let stopped = false;

	function readAndEmit(): void {
		if (stopped) return;
		const reading = readQuickSendValue(env);
		if (reading.problem !== undefined) {
			/*
			 * A problem HOLDS the last good value and moves nothing: only a
			 * successful read of a different value re-registers. The reading's
			 * own `value` is deliberately not used — it is the fallback for a
			 * caller with nothing better, and a watcher that adopted it would
			 * take a working hotkey down over a comment someone broke.
			 *
			 * The problem is reported ONCE PER DISTINCT SENTENCE. A malformed
			 * file keeps being malformed, at the poll interval, for as long as
			 * it sits there; re-reporting it every 1.5 s would bury the one
			 * line that matters under its own repeats.
			 */
			if (reading.problem !== lastProblem) {
				lastProblem = reading.problem;
				options.onProblem(reading.problem);
			}
			return;
		}
		lastProblem = null;
		if (reading.value !== last) {
			last = reading.value;
			options.onValue(reading.value);
		}
	}

	function schedule(): void {
		if (stopped) return;
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			readAndEmit();
		}, debounceMs);
	}

	watchFile(file, { interval }, schedule);
	let dirWatcher: ReturnType<typeof watch> | null = null;
	try {
		/*
		 * A non-recursive watch on the config directory: it reports the file
		 * appearing, disappearing and being replaced. Non-persistent so a
		 * watcher left running cannot hold the process open by itself.
		 */
		dirWatcher = watch(dir, { persistent: false }, schedule);
		dirWatcher.on("error", (error) => {
			options.onProblem(
				`the config directory watch stopped (${String(error)})`,
			);
		});
	} catch (error) {
		/*
		 * No directory yet (a first run before the backend has ever started).
		 * The file watch still polls the path, so creation is still observed —
		 * this is a degradation, not a loss, and it is reported at debug weight
		 * by the caller's log line rather than treated as a failure.
		 */
		options.onProblem(
			`the config directory could not be watched yet (${String(error)})`,
		);
	}

	return {
		stop(): void {
			if (stopped) return;
			stopped = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			unwatchFile(file, schedule);
			dirWatcher?.close();
			dirWatcher = null;
		},
	};
}
