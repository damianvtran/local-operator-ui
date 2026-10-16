/**
 * THE QWEN GATEWAY'S HOST (design: the backend's docs/design/qwen-voice.md, Q1,
 * Q5): `resources/qwen-voice/gateway-launcher.mjs` run as an Electron
 * `utilityProcess`, the same host the qwen-audio-agent package itself uses
 * (shared/gateway/process.mjs). Electron 44.3.0 bundles Node 24.20.0, inside the
 * package's `^22.22.2 || ^24.15.0 || >=26` engine range (measured), so no
 * system `node` is needed.
 *
 * THE DESKTOP BEARER NEVER CROSSES INTO THIS PROCESS. Its environment is an
 * allowlist built here - the rig paths, the ports, the provider selection - and
 * it reaches the daemon only by asking main over `parentPort`, which answers
 * with outcomes and texts, never a credential. The Gateway is third-party code
 * that serves HTTP; a bearer in its environment would hand `/v1/credentials` to
 * anything that can talk to it.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { QwenPorts } from "./qwen-rig";

/** Messages up from the launcher. */
export type GatewayUpMessage =
	| { type: "take"; taskId: string; text: string }
	| { type: "status"; event: string; [key: string]: unknown }
	| { type: "qwen-voice:ready"; webuiUrl: string }
	| { type: "qwen-voice:error"; reason: string };

/** Messages down to the launcher (the frozen main <-> Gateway contract). */
export type GatewayDownMessage =
	| { type: "outcome"; taskId: string; ok: true }
	| { type: "outcome"; taskId: string; ok: false; code: string }
	| { type: "speak"; text: string; kind: "reply" | "gate" }
	| { type: "slot"; active: { session_id: string } | null }
	| { type: "cancel_all" };

/** The subset of Electron's `UtilityProcess` this host uses (a test seam). */
export type UtilityChild = {
	pid?: number;
	postMessage: (message: unknown) => void;
	onMessage: (listener: (message: unknown) => void) => void;
	onExit: (listener: (code: number) => void) => void;
	kill: () => boolean;
};

export type ForkImpl = (
	modulePath: string,
	args: string[],
	options: { env: NodeJS.ProcessEnv; stdio: "pipe" | "ignore" | "inherit" },
) => UtilityChild;

/**
 * The launcher's environment: an ALLOWLIST. Nothing named `LOCAL_OPERATOR_*`
 * (the desktop token above all) can reach it, because nothing is copied from the
 * parent except `PATH`, `HOME` and `LANG`.
 */
export function gatewayEnv(
	rigDir: string,
	ports: QwenPorts,
	stateDir: string,
	parent: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	return {
		PATH: parent.PATH ?? "/usr/bin:/bin",
		HOME: parent.HOME ?? "",
		LANG: parent.LANG ?? "en_US.UTF-8",
		LOP_QWEN_RIG_DIR: rigDir,
		LOP_QWEN_RELAY_PORT: String(ports.relay),
		HOST: "127.0.0.1",
		PORT: String(ports.gateway),
		// The Gateway's own config/state root, app-owned, so this never shares a
		// task store or identity with Ben's manual rig (`$RIG/qwa-config`).
		QWAUDIO_CONFIG_DIR: stateDir,
		QWEN_AUDIO_REALTIME_PROVIDER: "speech-to-speech",
		SPEECH_TO_SPEECH_REALTIME_URL: `ws://127.0.0.1:${ports.s2s}/v1/realtime`,
		// The Gateway's background text-model calls (memory, summaries) would go
		// to a cloud model with a key; there is none, and none is wanted.
		QWEN_AUDIO_MEMORY_AUTO: "off",
		AGENT_PROTOCOL: "none",
	};
}

const READY_TIMEOUT_MS = 60_000;

export class QwenGatewayHost {
	private child: UtilityChild | null = null;
	private starting: Promise<string> | null = null;
	private webuiUrl: string | null = null;

	constructor(
		private readonly launcherPath: string,
		private readonly rigDir: string,
		private readonly ports: QwenPorts,
		private readonly stateDir: string,
		private readonly onMessage: (message: GatewayUpMessage) => void,
		private readonly fork: ForkImpl,
		private readonly log: (message: string) => void = () => {},
		/** The launcher exited after it was ready, without being stopped. */
		private readonly onUnexpectedExit: (detail: string) => void = () => {},
	) {}

	get running(): boolean {
		return this.child !== null && this.webuiUrl !== null;
	}

	get pid(): number | null {
		return this.child?.pid ?? null;
	}

	/** Start the launcher; resolves to the WebUI URL. Idempotent. */
	start(): Promise<string> {
		if (this.running && this.webuiUrl) return Promise.resolve(this.webuiUrl);
		if (this.starting) return this.starting;
		this.starting = this.startOnce().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private startOnce(): Promise<string> {
		mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
		const child = this.fork(this.launcherPath, [], {
			env: gatewayEnv(this.rigDir, this.ports, this.stateDir, process.env),
			stdio: "inherit",
		});
		this.child = child;
		this.log(`qwen-gateway: launcher started, pid ${child.pid}`);
		return new Promise<string>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				this.stop();
				reject(new Error("the voice Gateway did not start within 60 s"));
			}, READY_TIMEOUT_MS);
			child.onMessage((raw) => {
				const message = raw as GatewayUpMessage;
				if (message?.type === "qwen-voice:ready" && !settled) {
					settled = true;
					clearTimeout(timer);
					this.webuiUrl = message.webuiUrl;
					resolve(message.webuiUrl);
					return;
				}
				if (message?.type === "qwen-voice:error" && !settled) {
					settled = true;
					clearTimeout(timer);
					this.stop();
					reject(new Error(message.reason));
					return;
				}
				this.onMessage(message);
			});
			child.onExit((code) => {
				this.log(`qwen-gateway: launcher exited (${String(code)})`);
				// Still current means nobody asked it to stop (stop() lets go first).
				const unexpected = this.child === child && settled;
				if (this.child === child) {
					this.child = null;
					this.webuiUrl = null;
				}
				if (unexpected) this.onUnexpectedExit(`code ${String(code)}`);
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(new Error(`the voice Gateway exited (${String(code)})`));
				}
			});
		});
	}

	send(message: GatewayDownMessage): boolean {
		if (!this.child) return false;
		this.child.postMessage(message);
		return true;
	}

	/** Stop the launcher (it closes its own ports on SIGTERM). Idempotent. */
	stop(): void {
		const child = this.child;
		this.child = null;
		this.webuiUrl = null;
		if (child) child.kill();
	}
}

/** The launcher's path in a dev tree and a packaged app alike. */
export function launcherPathFor(
	appPath: string,
	resourcesPath: string,
	packaged: boolean,
): string {
	return packaged
		? join(resourcesPath, "qwen-voice", "gateway-launcher.mjs")
		: join(appPath, "resources", "qwen-voice", "gateway-launcher.mjs");
}
