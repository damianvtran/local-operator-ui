/**
 * THE QWEN RIG'S SPEECH PROCESS (design: the backend's docs/design/qwen-voice.md,
 * Q1 and Q12): HF speech-to-speech (Silero VAD, Smart Turn, Parakeet,
 * Qwen3-TTS) run from the rig directory's own venv, pointed at the relay LLM
 * the Gateway launcher serves - so no language model is loaded at all.
 *
 * The rig directory supplies the RUNTIME only (`s2s-venv`, `hf-cache`); nothing
 * here writes into it. Ben's own `start.sh`/`stop.sh` stay his manual path and
 * are never called.
 *
 * Process ownership, the rule this machine's other sessions depend on: the child
 * is started DETACHED, so it leads its own process group, and it is stopped by
 * that recorded group id - SIGTERM, then SIGKILL after a grace - and never by
 * name or pattern. Every method is idempotent.
 */

import {
	type ChildProcess,
	execFile,
	execFileSync,
	spawn,
} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";

/**
 * The rig directory's default. `index.ts` reads the `LOP_QWEN_RIG_DIR`
 * environment variable over it; there is no setting.
 */
export const DEFAULT_QWEN_RIG_DIR = join(
	homedir(),
	".local",
	"share",
	"qwen-voice-rig",
);

export type QwenPorts = { gateway: number; s2s: number; relay: number };

/** Version 1's ports, which Ben's rig and the WebUI bookmark use. */
export const DEFAULT_QWEN_PORTS: QwenPorts = {
	gateway: 3101,
	s2s: 8765,
	relay: 8766,
};

/**
 * `LOP_QWEN_PORTS=gateway,s2s,relay`, honoured ONLY in an unpackaged build, so a
 * QA run can never collide with Ben's manual rig while the shipped app always
 * uses version 1's ports. Anything malformed is ignored, not half-applied.
 */
export function resolveQwenPorts(
	raw: string | undefined,
	packaged: boolean,
): QwenPorts {
	if (packaged || !raw) return DEFAULT_QWEN_PORTS;
	const parts = raw.split(",").map((part) => Number(part.trim()));
	if (
		parts.length !== 3 ||
		parts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
	)
		return DEFAULT_QWEN_PORTS;
	return { gateway: parts[0], s2s: parts[1], relay: parts[2] };
}

/** What the rig directory must contain for this app to run it. */
export function rigMissing(rigDir: string): string | null {
	for (const relative of [
		// What this app starts now (`s2s-launch.py`), then the venv's own entry
		// point, so a rig whose package is not installed fails by name.
		join("s2s-venv", "bin", "python"),
		join("s2s-venv", "bin", "speech-to-speech"),
		join("qwa", "node_modules", "qwen-audio-agent", "package.json"),
		"hf-cache",
	]) {
		if (!existsSync(join(rigDir, relative))) return relative;
	}
	return null;
}

/**
 * The launcher this app runs instead of the rig's console script (plan §9,
 * layer 1): it sets MLX's cache and memory limits, then calls the rig's own
 * `speech_to_speech.cli.main`. In a checkout it sits under `resources/`; in a
 * packaged app electron-builder copies `resources/qwen-voice` to the bundle's
 * `qwen-voice`.
 */
export function s2sLauncherPathFor(
	appPath: string,
	resourcesPath: string,
	packaged: boolean,
): string {
	return packaged
		? join(resourcesPath, "qwen-voice", "s2s-launch.py")
		: join(appPath, "resources", "qwen-voice", "s2s-launch.py");
}

const GIB = 1024 ** 3;

/**
 * §9's budget FLOOR, and the one number to tune: the two models are ~4.8 GB on
 * disk, and a healthy idle rig measured ~5.5 GB (QA round 1). A budget below
 * that would stop a rig that is merely working, so the default never goes under
 * this - the quarter-of-RAM rule only ever raises it (review R1).
 */
export const QWEN_MEM_BUDGET_BYTES = 8 * GIB;

/** Under this much RAM the rig cannot fit beside the app at all. */
export const QWEN_MIN_MACHINE_BYTES = 16 * GIB;

/** The header sentence a machine that is too small gets, verbatim. */
export const QWEN_MACHINE_TOO_SMALL =
	"Voice needs a machine with at least 16 GB of memory.";

/**
 * The refusal sentence for a machine too small to hold the rig, or null. THE
 * CHECK LIVES IN THE COORDINATOR (`qwen-voice.ts`), before anything is spawned:
 * the header has to say it and no process or prompt may start first.
 */
export function qwenMachineTooSmall(
	totalBytes: number = totalmem(),
): string | null {
	return totalBytes < QWEN_MIN_MACHINE_BYTES ? QWEN_MACHINE_TOO_SMALL : null;
}

/**
 * The memory budget both layers share: `LOP_QWEN_MEM_BUDGET_GB` when it names a
 * positive number, else max(8 GiB, a quarter of physical RAM). The floor is the
 * healthy footprint; the quarter keeps a big machine's rig from being allowed to
 * take the app and the OS with it.
 */
export function qwenMemoryBudget(
	env: NodeJS.ProcessEnv,
	totalBytes: number = totalmem(),
): number {
	const override = Number(env.LOP_QWEN_MEM_BUDGET_GB);
	if (Number.isFinite(override) && override > 0)
		return Math.floor(override * GIB);
	return Math.max(QWEN_MEM_BUDGET_BYTES, Math.floor(totalBytes / 4));
}

/**
 * s2s's argument list. `--model_name lop-relay` is accepted offline because the
 * chat-completions backend never loads a model; it only names the one the
 * relay serves (measured: listening in 11 s with `HF_HUB_OFFLINE=1`).
 *
 * `--max_speech_ms 30000` is a SAFETY NET, not the thing that bounds a turn
 * (review BRIEF-1, corrected after QA measured the real rig): segments soft-end
 * through smart-turn at ~10.6 s, and the discarding branch the flag guards never
 * ran in QA's 60 s take - zero `VAD: discarding segment` lines. What actually
 * bounds memory is the MLX cache limit (layer 1) and the group-footprint
 * watchdog (layer 3); what grows is TIME, because the final STT re-runs over the
 * whole growing buffer on each revision (~3.55x cost for a 60 s take, ~n^2/2).
 * The cap stays as the cheap backstop for a segment that never soft-ends, and a
 * drop is surfaced as `ui.chat.voice.take_too_long`.
 */
export function s2sArgs(ports: QwenPorts): string[] {
	return [
		"serve",
		"--mac-optimal-settings",
		"--llm_backend",
		"chat-completions",
		"--model_name",
		"lop-relay",
		"--responses_api_base_url",
		`http://127.0.0.1:${ports.relay}/v1`,
		"--port",
		String(ports.s2s),
		"--max_speech_ms",
		"30000",
	];
}

/**
 * The child's environment, built from an allowlist rather than inherited:
 * `XPC_FLAGS` breaks `getaddrinfo` in children on this platform, and nothing of
 * this app's (the desktop bearer above all) has any business in a third-party
 * process. `HF_HUB_OFFLINE=1`: serve only what is already cached, never pull a
 * model implicitly.
 */
export function s2sEnv(
	rigDir: string,
	parent: NodeJS.ProcessEnv,
	budgetBytes: number = qwenMemoryBudget(parent),
): NodeJS.ProcessEnv {
	return {
		PATH: parent.PATH ?? "/usr/bin:/bin",
		HOME: parent.HOME ?? homedir(),
		LANG: parent.LANG ?? "en_US.UTF-8",
		HF_HOME: join(rigDir, "hf-cache"),
		HF_HUB_OFFLINE: "1",
		// Layer 1's memory limit, passed to `s2s-launch.py`. MLX treats it as a
		// SOFT hint, so layer 3 - the footprint watchdog - is the hard enforcer
		// of the same number.
		LOP_QWEN_MEM_LIMIT_BYTES: String(budgetBytes),
	};
}

/** One live process as `ps` reports it, or null when it is gone. */
export type ProcessFacts = { pgid: number; command: string };

export type QwenRigDeps = {
	spawnImpl?: typeof spawn;
	kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
	probe?: (port: number) => Promise<boolean>;
	log?: (message: string) => void;
	sleep?: (ms: number) => Promise<void>;
	/** `ps` for one pid (a test seam). */
	inspect?: (pid: number) => ProcessFacts | null;
	/** s2s exited without being stopped (a crash, an OOM kill). */
	onUnexpectedExit?: (detail: string) => void;
	/** The budget layers 1 and 3 share; defaults to `qwenMemoryBudget`. */
	budgetBytes?: number;
	/** A process group's total footprint in bytes, or null (a test seam). */
	footprint?: (pgid: number) => Promise<number | null> | number | null;
	/** The footprint guard stopped the rig; `limit` is the budget in bytes. */
	onBudgetExceeded?: (limitBytes: number) => void;
	setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
	clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

/** §9 layer 3's poll: frequent enough to catch a turn's growth, cheap enough idle. */
export const FOOTPRINT_INTERVAL_MS = 5_000;

/** The file in the profile's qwen-voice state dir that records our s2s. */
export const S2S_RECORD_FILE = "s2s.json";

/** `ps -o pgid=,command=` output: the group id, then the whole command line. */
const PS_PGID_COMMAND = /^(\d+)\s+(.*)$/s;

const defaultInspect = (pid: number): ProcessFacts | null => {
	try {
		const out = execFileSync(
			"ps",
			["-o", "pgid=,command=", "-p", String(pid)],
			{
				encoding: "utf8",
				timeout: 5_000,
			},
		).trim();
		const match = PS_PGID_COMMAND.exec(out);
		return match ? { pgid: Number(match[1]), command: match[2] } : null;
	} catch {
		// `ps -p` exits 1 for a pid that does not exist.
		return null;
	}
};

/**
 * The summed footprint of a process group (§9 layer 3), or null when it cannot
 * be read.
 *
 * `footprint` is the tool that counts Metal/GPU memory; `ps` RSS reports the CPU
 * side only, and the leak this guard exists for is Metal buffers. The group is
 * enumerated with `ps -g`, because the guard is about what the whole rig costs,
 * not only the python process that leads it. `--noCategories` keeps the parse to
 * the summary line.
 */
const FOOTPRINT_SUMMARY = /Summary Footprint:\s*(\d+)\s*B/;
const FOOTPRINT_SINGLE = /Footprint:\s*(\d+)\s*B/;

/** One bounded, ASYNC child: the watchdog runs on the main thread (review M4). */
const capture = (file: string, args: string[]): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(file, args, { encoding: "utf8", timeout: 5_000 }, (error, out) => {
			if (error) reject(error);
			else resolve(out);
		});
	});

const defaultGroupFootprint = async (pgid: number): Promise<number | null> => {
	try {
		const listing = await capture("ps", ["-o", "pid=", "-g", String(pgid)]);
		const pids = listing
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (pids.length === 0) return null;
		const out = await capture("footprint", [
			"-f",
			"bytes",
			"--noCategories",
			...pids,
		]);
		// Several pids print one summary; one pid prints only its own total.
		const summary = FOOTPRINT_SUMMARY.exec(out);
		if (summary) return Number(summary[1]);
		const single = FOOTPRINT_SINGLE.exec(out);
		return single ? Number(single[1]) : null;
	} catch {
		return null;
	}
};

/**
 * Whether a live process is THE s2s this app started from this rig: its
 * command runs the rig's own entry point (the console script, or the launcher
 * this app runs in its place) with the relay model, and it still leads the
 * group recorded for it. Anything else on the port (Ben's manual rig, another
 * session's) is never ours to kill.
 */
export function isOurS2s(
	facts: ProcessFacts | null,
	record: { pid: number; pgid: number },
	rigDir: string,
): boolean {
	if (!facts) return false;
	const entry =
		facts.command.includes("speech-to-speech") ||
		facts.command.includes("s2s-launch.py");
	return (
		facts.pgid === record.pgid &&
		facts.command.includes(join(rigDir, "s2s-venv")) &&
		entry &&
		facts.command.includes("lop-relay")
	);
}

const defaultProbe = async (port: number): Promise<boolean> => {
	try {
		await fetch(`http://127.0.0.1:${port}/`, {
			signal: AbortSignal.timeout(1500),
		});
		return true;
	} catch {
		return false;
	}
};

/** How long a warm s2s takes to listen; measured 11 s, first run downloads. */
const READY_TIMEOUT_MS = 8 * 60_000;
const STOP_GRACE_MS = 5_000;

export class QwenSpeechProcess {
	private child: ChildProcess | null = null;
	private pgid: number | null = null;
	private starting: Promise<void> | null = null;
	private watchdog: ReturnType<typeof setInterval> | null = null;
	/** Consecutive failed footprint reads; 0 while the guard can see. */
	private footprintFailures = 0;
	private footprintBusy = false;
	private readonly spawnImpl: typeof spawn;
	private readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void;
	private readonly probe: (port: number) => Promise<boolean>;
	private readonly log: (message: string) => void;
	private readonly inspect: (pid: number) => ProcessFacts | null;
	private readonly onUnexpectedExit: (detail: string) => void;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly budgetBytes: number;
	private readonly footprint: (pgid: number) => Promise<number | null>;
	private readonly onBudgetExceeded: (limitBytes: number) => void;
	private readonly setIntervalImpl: (
		fn: () => void,
		ms: number,
	) => ReturnType<typeof setInterval>;
	private readonly clearIntervalImpl: (
		handle: ReturnType<typeof setInterval>,
	) => void;

	constructor(
		private readonly launcherPath: string,
		private readonly rigDir: string,
		private readonly ports: QwenPorts,
		private readonly logDir: string,
		deps: QwenRigDeps = {},
	) {
		this.spawnImpl = deps.spawnImpl ?? spawn;
		this.kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
		this.probe = deps.probe ?? defaultProbe;
		this.log = deps.log ?? (() => {});
		this.inspect = deps.inspect ?? defaultInspect;
		this.onUnexpectedExit = deps.onUnexpectedExit ?? (() => {});
		this.sleep =
			deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.budgetBytes = deps.budgetBytes ?? qwenMemoryBudget(process.env);
		this.footprint = deps.footprint
			? async (pgid) => (await deps.footprint?.(pgid)) ?? null
			: defaultGroupFootprint;
		this.onBudgetExceeded = deps.onBudgetExceeded ?? (() => {});
		this.setIntervalImpl =
			deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
		this.clearIntervalImpl =
			deps.clearInterval ?? ((handle) => clearInterval(handle));
	}

	/** The recorded process group, for the quit path and the report. */
	get processGroup(): number | null {
		return this.pgid;
	}

	get running(): boolean {
		return this.child !== null && this.child.exitCode === null;
	}

	/** Start s2s, resolving once it listens. Idempotent; concurrent calls share. */
	start(): Promise<void> {
		if (this.running && !this.starting) return Promise.resolve();
		if (this.starting) return this.starting;
		this.starting = this.startOnce().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async startOnce(): Promise<void> {
		const missing = rigMissing(this.rigDir);
		// The reason is shown verbatim in the header (design round 2, D10).
		if (missing)
			throw new Error(
				`Voice rig not found at ${this.rigDir} (missing ${missing})`,
			);
		await this.reapOwnOrphan();
		if (await this.probe(this.ports.s2s)) {
			// Someone else's s2s (Ben's manual rig): never adopt or kill it.
			throw new Error(
				`Port ${this.ports.s2s} is in use; stop the other voice rig first`,
			);
		}
		mkdirSync(this.logDir, { recursive: true });
		const logFile = openSync(join(this.logDir, "qwen-s2s.log"), "a");
		const child = this.spawnImpl(
			join(this.rigDir, "s2s-venv", "bin", "python"),
			[this.launcherPath, ...s2sArgs(this.ports)],
			{
				env: s2sEnv(this.rigDir, process.env, this.budgetBytes),
				cwd: this.rigDir,
				detached: true,
				stdio: ["ignore", logFile, logFile],
			},
		);
		this.child = child;
		this.pgid = child.pid ?? null;
		this.log(`qwen-rig: s2s started, pid/pgid ${this.pgid}`);
		if (this.pgid !== null) this.writeRecord(this.pgid);
		this.startWatchdog();
		child.once("exit", (code, signal) => {
			this.log(`qwen-rig: s2s exited (code ${code}, signal ${signal})`);
			// Still current means nobody asked it to stop: stop() and killNow()
			// let go of the child before they signal it.
			if (this.child === child) {
				this.stopWatchdog();
				this.child = null;
				this.pgid = null;
				this.clearRecord();
				this.onUnexpectedExit(`code ${code}, signal ${signal}`);
			}
		});
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null || this.child !== child)
				throw new Error("Speech process exited during start; see qwen-s2s.log");
			if (await this.probe(this.ports.s2s)) return;
			await this.sleep(1000);
		}
		await this.stop();
		throw new Error("Speech process did not start listening in 8 minutes");
	}

	/** Stop by the recorded process group. Idempotent. */
	async stop(): Promise<void> {
		this.stopWatchdog();
		const pgid = this.pgid;
		const child = this.child;
		this.child = null;
		this.pgid = null;
		if (pgid === null || !child) return;
		await this.stopGroup(pgid);
		this.clearRecord();
	}

	private async stopGroup(pgid: number): Promise<void> {
		this.signalGroup(pgid, "SIGTERM");
		const deadline = Date.now() + STOP_GRACE_MS;
		while (Date.now() < deadline) {
			if (!this.groupAlive(pgid)) return;
			await this.sleep(200);
		}
		this.log(`qwen-rig: s2s group ${pgid} ignored SIGTERM; SIGKILL`);
		this.signalGroup(pgid, "SIGKILL");
	}

	/*
	 * THE APP'S OWN CRASH ORPHAN (QA round 1, Q5). A SIGKILLed or crashed app
	 * runs no quit path, so its s2s (detached, its own group) lives on as ppid 1
	 * holding the port and ~5 GB. The pid and group are recorded in the profile
	 * at spawn; the next start reaps that group ONLY when the pid is alive, still
	 * leads that group, and its command is this rig's s2s on the relay model.
	 * A port held by anything else keeps the clear "already in use" error.
	 */
	private async reapOwnOrphan(): Promise<void> {
		const record = this.readRecord();
		if (!record) return;
		if (!isOurS2s(this.inspect(record.pid), record, this.rigDir)) {
			this.clearRecord();
			return;
		}
		this.log(
			`qwen-rig: reaping s2s left by an earlier run, pid/pgid ${record.pid}/${record.pgid}`,
		);
		await this.stopGroup(record.pgid);
		this.clearRecord();
		// The port is released as the process exits; give it a moment.
		for (let i = 0; i < 10 && (await this.probe(this.ports.s2s)); i += 1)
			await this.sleep(500);
	}

	private get recordPath(): string {
		return join(this.logDir, S2S_RECORD_FILE);
	}

	private readRecord(): { pid: number; pgid: number } | null {
		try {
			const value = JSON.parse(readFileSync(this.recordPath, "utf8"));
			return Number.isInteger(value?.pid) && Number.isInteger(value?.pgid)
				? { pid: value.pid, pgid: value.pgid }
				: null;
		} catch {
			return null;
		}
	}

	private writeRecord(pid: number): void {
		try {
			// Started detached, so the child leads its own group: pgid == pid.
			writeFileSync(this.recordPath, JSON.stringify({ pid, pgid: pid }), {
				mode: 0o600,
			});
		} catch (error) {
			this.log(`qwen-rig: could not record s2s pid: ${String(error)}`);
		}
	}

	private clearRecord(): void {
		rmSync(this.recordPath, { force: true });
	}

	/**
	 * The synchronous last resort for `will-quit` and a terminating SIGNAL, where
	 * nothing may be awaited: SIGKILL the recorded group so no model process
	 * outlives the app.
	 *
	 * `clearRecord` is for the paths where NOTHING will reap later (a signal
	 * handler, review Q-3): SIGKILL cannot be ignored, so a record that still
	 * looked alive a microsecond after the signal is stale, not a live claim.
	 * The quit paths leave the default, which re-checks the group.
	 */
	killNow(clearRecord = false): void {
		this.stopWatchdog();
		const pgid = this.pgid;
		this.child = null;
		this.pgid = null;
		if (pgid === null) return;
		this.signalGroup(pgid, "SIGKILL");
		if (clearRecord || !this.groupAlive(pgid)) this.clearRecord();
	}

	/**
	 * §9 layer 3: every 5 s, compare the group's footprint with the budget the
	 * launcher was given. Over it, the rig is stopped and its owner told why - a
	 * rig that eats the machine is worse than a rig that is off.
	 */
	private startWatchdog(): void {
		this.stopWatchdog();
		this.footprintFailures = 0;
		this.footprintBusy = false;
		const handle = this.setIntervalImpl(
			// The promise is returned so a test can await one poll; setInterval
			// ignores it.
			() => this.checkFootprint(),
			FOOTPRINT_INTERVAL_MS,
		);
		// Never a reason for the app to stay alive.
		handle.unref?.();
		this.watchdog = handle;
	}

	private stopWatchdog(): void {
		if (this.watchdog === null) return;
		this.clearIntervalImpl(this.watchdog);
		this.watchdog = null;
	}

	private async checkFootprint(): Promise<void> {
		const pgid = this.pgid;
		// One poll at a time: a slow `footprint` must not stack reads.
		if (pgid === null || this.footprintBusy) return;
		this.footprintBusy = true;
		let used: number | null;
		try {
			used = await this.footprint(pgid);
		} finally {
			this.footprintBusy = false;
		}
		/*
		 * Unreadable is not over budget - refusing to stop a working rig on a
		 * failed read would be the worse error - but it must not be SILENT either
		 * (review M4): the first failure and a periodic count say the guard is
		 * blind, instead of a line every 5 s for the life of the rig.
		 */
		if (used === null) {
			this.footprintFailures += 1;
			if (this.footprintFailures === 1 || this.footprintFailures % 12 === 0)
				this.log(
					`qwen-rig: footprint unreadable (${this.footprintFailures} consecutive failed reads); the memory guard is blind until it recovers`,
				);
			return;
		}
		if (this.footprintFailures > 0) {
			this.log(
				`qwen-rig: footprint readable again after ${this.footprintFailures} failed read(s)`,
			);
			this.footprintFailures = 0;
		}
		if (used <= this.budgetBytes) return;
		this.log(
			`qwen-rig: s2s group footprint ${used} B exceeds ${this.budgetBytes} B; stopping`,
		);
		this.stopWatchdog();
		const limit = this.budgetBytes;
		void this.stop();
		this.onBudgetExceeded(limit);
	}

	private signalGroup(pgid: number, signal: NodeJS.Signals): void {
		try {
			// Negative: the whole group this child leads (it was started detached).
			this.kill(-pgid, signal);
		} catch {
			// Already gone.
		}
	}

	private groupAlive(pgid: number): boolean {
		try {
			this.kill(-pgid, 0);
			return true;
		} catch {
			return false;
		}
	}
}
