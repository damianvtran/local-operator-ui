/**
 * THE QWEN VOICE GATEWAY LAUNCHER, run by Electron main as a `utilityProcess`
 * (`src/main/voice/qwen-gateway.ts`). Design: the backend's
 * docs/design/qwen-voice.md, Q1-Q7.
 *
 * It composes the rig's own qwen-audio-agent Gateway (the WebUI at :3101, the
 * realtime socket, the task queue) with three replacements:
 *
 *   1. `LopSlotBackend` as the backend: a take becomes `{type: "take"}` up to
 *      main, which alone calls the desktop daemon. The desktop bearer stays in
 *      main; this process never receives it, and its environment is built by
 *      main from an allowlist (no LOCAL_OPERATOR_* names).
 *   2. The verbatim provider: the s2s profile with token-only instructions.
 *   3. The relay LLM on :8766 in place of the Qwen3-4B (`relay-core.mjs`).
 *
 * And it captures each realtime connection's `getFrontend` by wrapping the
 * default task-announcement factory, which the Gateway calls once per
 * connection with that connection's own `getFrontend` (Q4). The factory module
 * is not a package export, so it is imported by absolute path from the rig and
 * the package version is asserted at startup: a moved internal fails closed.
 *
 * Messages from main (`process.parentPort`): `outcome {taskId, ok|code}`,
 * `speak {text, kind}`, `slot {active}`, `cancel_all`. Up to main: `take`,
 * `status`, and `qwen-voice:ready` / `qwen-voice:error`.
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	LopSlotBackend,
	PHRASES,
	SayRegistry,
	createRelayHandler,
	createVerbatimProvider,
	phraseForOutcome,
	tokenOf,
	voiceEventOf,
} from "./relay-core.mjs";

/** The package version this launcher's internal imports were read against. */
export const PINNED_GATEWAY_VERSION = "2.0.1";

const env = process.env;
const rig = env.LOP_QWEN_RIG_DIR;
const gatewayPort = Number(env.PORT || 3101);
const relayPort = Number(env.LOP_QWEN_RELAY_PORT || 8766);
/*
 * Electron's `utilityProcess` gives `process.parentPort`; a plain Node
 * `child_process.fork` (the QA probes, and the package's own non-Electron host
 * shape, shared/gateway/process.mjs) gives `process.send`. Both carry the same
 * messages, so a probe drives exactly the code main drives.
 */
const parent = process.parentPort
	? {
			post: (message) => process.parentPort.postMessage(message),
			on: (listener) =>
				process.parentPort.on("message", (event) => listener(event?.data)),
		}
	: typeof process.send === "function"
		? {
				post: (message) => process.send(message),
				on: (listener) => process.on("message", listener),
			}
		: null;

function post(message) {
	parent?.post(message);
}

function fail(reason) {
	post({ type: "qwen-voice:error", reason: String(reason) });
	// A launcher that cannot compose must not linger holding ports.
	setTimeout(() => process.exit(1), 50).unref?.();
}

async function main() {
	if (!rig) throw new Error("LOP_QWEN_RIG_DIR is not set");
	const pkgRoot = join(rig, "qwa", "node_modules", "qwen-audio-agent");
	const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
	if (pkg.version !== PINNED_GATEWAY_VERSION) {
		throw new Error(
			`qwen-audio-agent ${pkg.version} is installed; this launcher is pinned to ${PINNED_GATEWAY_VERSION}`,
		);
	}
	const internal = (relative) =>
		import(pathToFileURL(join(pkgRoot, relative)).href);
	const [
		{ createGatewayApplication },
		{ createBackendAgentHost },
		{ createRealtimeProviderRegistry },
		{ s2sProvider },
		{ createTaskAnnouncementRuntime },
	] = await Promise.all([
		internal("server/src/app/gateway-application.mjs"),
		internal("server/src/backend/backend-adapter-sdk.mjs"),
		internal("server/src/voice/realtime-provider-extension.mjs"),
		internal("server/src/voice/providers/s2s.mjs"),
		internal("server/src/voice/announcement/task-announcement-runtime.mjs"),
	]);
	if (typeof createTaskAnnouncementRuntime !== "function") {
		throw new Error("createTaskAnnouncementRuntime moved; pin or vendor it");
	}
	/*
	 * The factory wrapper below reads `resultOptions.getFrontend` and
	 * `resultOptions.onDelivered` off the options the Gateway passes it. Both are
	 * internal shapes of 2.0.1 (realtime-task-presentation.mjs), so they are
	 * asserted from that module's source at startup: a renamed field fails
	 * closed here, instead of every reply going silent at runtime.
	 */
	const presentation = readFileSync(
		join(pkgRoot, "server/src/voice/realtime-task-presentation.mjs"),
		"utf8",
	);
	for (const field of ["resultOptions", "getFrontend", "onDelivered"]) {
		if (!presentation.includes(field))
			throw new Error(
				`qwen-audio-agent no longer passes ${field} to the announcement factory; pin or vendor it`,
			);
	}

	const registry = new SayRegistry();

	/*
	 * ONE LOGGER, TWO DESTINATIONS (plan §10): the file keeps every record as
	 * before, and an ALLOWLISTED few also go up to main as `voice.qwen.event`.
	 * Every connection logs through `logger.child(...)`, which shares this sink
	 * (`shared/logger.mjs`), so a new log line cannot bypass the whitelist.
	 */
	const { JsonLineFileSink, createLogger, defaultLogDirectory } =
		await internal("shared/logger.mjs");
	const fileSink =
		env.QWEN_AUDIO_LOG_FILE === "0"
			? null
			: new JsonLineFileSink({
					directory: defaultLogDirectory(env),
					fileName: "gateway.log",
				});
	const logger = createLogger({
		component: "gateway",
		sink: {
			path: fileSink?.path ?? null,
			write(record) {
				fileSink?.write(record);
				const event = voiceEventOf(record);
				if (event) post({ type: "event", event });
			},
			flush: () => fileSink?.flush(),
		},
	});

	/*
	 * ONE getFrontend PER REALTIME CONNECTION, newest last. A WebUI tab and a
	 * scripted `turn.mjs` are separate connections; speech goes to the newest one
	 * that is ready (the operator's latest client), and a closed connection's
	 * runtime is dropped when its results manager closes.
	 */
	const frontends = [];
	const taskAnnouncementFactory = (options) => {
		const runtime = createTaskAnnouncementRuntime(options);
		/*
		 * A TASK RESULT IS NEVER ANNOUNCED (Q4). A lop-slot task is the admission
		 * of one take; its outcome was already spoken as a Q7 phrase, and the
		 * session's reply arrives later through `speak`. Left to the default
		 * manager, the empty result is "announced" as a silent response that never
		 * reports playback, so it is retried (measured: 4 silent retries in 1.2 s
		 * on one take) and holds the response slot. Confirmed delivered instead.
		 */
		const onDelivered = options?.resultOptions?.onDelivered;
		runtime.results.completed = (task) => onDelivered?.([task.id]);
		runtime.results.failed = (task) => onDelivered?.([task.id]);
		const getFrontend = options?.resultOptions?.getFrontend;
		if (typeof getFrontend === "function") {
			const entry = { getFrontend };
			frontends.push(entry);
			post({
				type: "status",
				event: "client_attached",
				clients: frontends.length,
			});
			const close = runtime.results.close.bind(runtime.results);
			runtime.results.close = () => {
				const index = frontends.indexOf(entry);
				if (index >= 0) frontends.splice(index, 1);
				post({
					type: "status",
					event: "client_detached",
					clients: frontends.length,
				});
				return close();
			};
		}
		return runtime;
	};
	const readyFrontend = () => {
		for (let i = frontends.length - 1; i >= 0; i -= 1) {
			const frontend = frontends[i].getFrontend();
			if (frontend?.ready) return frontend;
		}
		return null;
	};

	/** Speak a registered text on the live connection. Silent with none. */
	const speak = (text, kind) => {
		const frontend = readyFrontend();
		if (!frontend) {
			post({ type: "status", event: "speak_dropped", reason: "no_client" });
			return false;
		}
		const token = registry.register(text, kind);
		void frontend.speak(token, "lop-voice", { lopVoice: kind }).catch(() => {});
		return true;
	};

	const backend = new LopSlotBackend({
		post,
		onOutcome: (_taskId, outcome) => {
			const phrase = phraseForOutcome(outcome);
			if (phrase) speak(PHRASES[phrase], "phrase");
		},
	});

	const provider = createVerbatimProvider(s2sProvider, {
		resolveToken: tokenOf,
	});
	const realtimeProviderRegistry = createRealtimeProviderRegistry({
		providers: [provider],
		defaultProvider: provider.key,
	});

	// The relay LLM first: s2s warms up against it before the Gateway is useful.
	const relay = createServer(
		createRelayHandler({
			registry,
			onOutput: ({ decision }) =>
				post({ type: "status", event: "relay", kind: decision.kind }),
		}),
	);
	await new Promise((resolve, reject) => {
		relay.once("error", reject);
		relay.listen(relayPort, "127.0.0.1", resolve);
	});

	const application = createGatewayApplication({
		logger,
		agent: createBackendAgentHost(backend, { name: "lop-slot" }),
		realtimeProviderRegistry,
		realtimeProvider: provider.key,
		taskAnnouncementFactory,
		// The Gateway's own ready report would be read by main as ours; ours
		// follows below, after the realtime surface is listening.
		parentPort: null,
		autoStart: false,
	});
	const server = application.start({ host: "127.0.0.1", port: gatewayPort });
	await new Promise((resolve, reject) => {
		if (server.listening) resolve();
		server.once("listening", resolve);
		server.once("error", reject);
	});

	let slotActive = null;
	parent?.on((message) => {
		switch (message?.type) {
			case "outcome":
				backend.settle(message.taskId, message);
				break;
			case "speak":
				// Main sends only texts it relayed from `/voice/text` (reply, gate).
				// A phrase never crosses from main: the launcher owns the Q7 set.
				if (message.kind === "reply" || message.kind === "gate")
					speak(message.text, message.kind);
				break;
			case "slot": {
				const next = message.active?.session_id ?? null;
				if (slotActive !== null && next !== null && next !== slotActive)
					speak(PHRASES.switched, "phrase");
				slotActive = next;
				break;
			}
			case "cancel_all":
				// The slot moved or went off: nothing queued for the old session plays.
				for (const entry of frontends) entry.getFrontend()?.cancel?.();
				break;
			default:
				break;
		}
	});

	const shutdown = async () => {
		await backend.close().catch(() => {});
		await application.close().catch(() => {});
		relay.close();
		process.exit(0);
	};
	process.once("SIGTERM", () => void shutdown());
	process.once("SIGINT", () => void shutdown());

	post({
		type: "qwen-voice:ready",
		webuiUrl: `http://127.0.0.1:${gatewayPort}/`,
		relayUrl: `http://127.0.0.1:${relayPort}/v1`,
		gatewayVersion: pkg.version,
	});
}

main().catch((error) => fail(error?.message ?? error));
