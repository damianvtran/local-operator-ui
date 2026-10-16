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

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The rig directory's default (`voice.qwen_rig_dir`). */
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
		join("s2s-venv", "bin", "speech-to-speech"),
		join("qwa", "node_modules", "qwen-audio-agent", "package.json"),
		"hf-cache",
	]) {
		if (!existsSync(join(rigDir, relative))) return relative;
	}
	return null;
}

/**
 * s2s's argument list. `--model_name lop-relay` is accepted offline because the
 * chat-completions backend never loads a model; it only names the one the
 * relay serves (measured: listening in 11 s with `HF_HUB_OFFLINE=1`).
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
): NodeJS.ProcessEnv {
	return {
		PATH: parent.PATH ?? "/usr/bin:/bin",
		HOME: parent.HOME ?? homedir(),
		LANG: parent.LANG ?? "en_US.UTF-8",
		HF_HOME: join(rigDir, "hf-cache"),
		HF_HUB_OFFLINE: "1",
	};
}

export type QwenRigDeps = {
	spawnImpl?: typeof spawn;
	kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
	probe?: (port: number) => Promise<boolean>;
	log?: (message: string) => void;
	sleep?: (ms: number) => Promise<void>;
};

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
	private readonly spawnImpl: typeof spawn;
	private readonly kill: (pid: number, signal: NodeJS.Signals | 0) => void;
	private readonly probe: (port: number) => Promise<boolean>;
	private readonly log: (message: string) => void;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(
		private readonly rigDir: string,
		private readonly ports: QwenPorts,
		private readonly logDir: string,
		deps: QwenRigDeps = {},
	) {
		this.spawnImpl = deps.spawnImpl ?? spawn;
		this.kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
		this.probe = deps.probe ?? defaultProbe;
		this.log = deps.log ?? (() => {});
		this.sleep =
			deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
		if (missing) throw new Error(`the Qwen rig is missing ${missing}`);
		if (await this.probe(this.ports.s2s)) {
			// Someone else's s2s (Ben's manual rig): never adopt or kill it.
			throw new Error(
				`port ${this.ports.s2s} is already in use; stop the other voice rig first`,
			);
		}
		mkdirSync(this.logDir, { recursive: true });
		const logFile = openSync(join(this.logDir, "qwen-s2s.log"), "a");
		const child = this.spawnImpl(
			join(this.rigDir, "s2s-venv", "bin", "speech-to-speech"),
			s2sArgs(this.ports),
			{
				env: s2sEnv(this.rigDir, process.env),
				cwd: this.rigDir,
				detached: true,
				stdio: ["ignore", logFile, logFile],
			},
		);
		this.child = child;
		this.pgid = child.pid ?? null;
		this.log(`qwen-rig: s2s started, pid/pgid ${this.pgid}`);
		child.once("exit", (code, signal) => {
			this.log(`qwen-rig: s2s exited (code ${code}, signal ${signal})`);
			if (this.child === child) {
				this.child = null;
				this.pgid = null;
			}
		});
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null || this.child !== child)
				throw new Error(
					"speech-to-speech exited during start; see qwen-s2s.log",
				);
			if (await this.probe(this.ports.s2s)) return;
			await this.sleep(1000);
		}
		await this.stop();
		throw new Error("speech-to-speech did not start listening in 8 minutes");
	}

	/** Stop by the recorded process group. Idempotent. */
	async stop(): Promise<void> {
		const pgid = this.pgid;
		const child = this.child;
		this.child = null;
		this.pgid = null;
		if (pgid === null || !child) return;
		this.signalGroup(pgid, "SIGTERM");
		const deadline = Date.now() + STOP_GRACE_MS;
		while (Date.now() < deadline) {
			if (!this.groupAlive(pgid)) return;
			await this.sleep(200);
		}
		this.log(`qwen-rig: s2s group ${pgid} ignored SIGTERM; SIGKILL`);
		this.signalGroup(pgid, "SIGKILL");
	}

	/**
	 * The synchronous last resort for `will-quit`, where nothing may be awaited:
	 * SIGKILL the recorded group so no model process outlives the app.
	 */
	killNow(): void {
		const pgid = this.pgid;
		this.child = null;
		this.pgid = null;
		if (pgid !== null) this.signalGroup(pgid, "SIGKILL");
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
