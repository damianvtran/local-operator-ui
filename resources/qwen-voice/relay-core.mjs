/**
 * THE QWEN VOICE RELAY'S PURE CORE (design: the backend's
 * docs/design/qwen-voice.md, Q2-Q7). Everything here is deterministic and
 * imports nothing from the qwen-audio-agent package, so the node tests drive it
 * directly and CI needs no rig.
 *
 * The rig (s2s: VAD, Smart Turn, Parakeet, Qwen3-TTS) calls an "LLM" on every
 * turn. There is no LLM: this module answers in its place.
 *
 *   - A USER TURN -> one `spawn_thinking` tool call whose `objective` is the last
 *     user message, unchanged (the Parakeet final; the relay test pins internal
 *     double spaces and non-ASCII through). That hands the words to the
 *     Gateway's task path, which hands them to the lop-slot backend.
 *   - A TOKEN `⟦lop-say:<uuid>⟧` in the system prompt -> exactly the text this
 *     process registered under that uuid, and nothing else. That is how a reply
 *     is spoken verbatim up to whitespace normalisation (Q3): the provider puts
 *     only the token into
 *     `instructions`, and s2s's own `instructions` override puts it here.
 *   - ANYTHING ELSE (a tool-result follow-up, a warmup, a compaction or summary
 *     request, an unknown token) -> EMPTY TEXT. The failure mode is silence.
 *
 * So every non-empty word the rig can say is one this process registered: a
 * reply or gate text main relayed from `/v1/desktop/voice/text`, or one of the
 * four Q7 phrases. `qwen-relay-llm.test.mjs` pins that as an invariant.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/** The Q7 phrase set, closed. Loaded from the JSON beside this file. */
export const PHRASES = Object.freeze(
	JSON.parse(readFileSync(new URL("./phrases.json", import.meta.url), "utf8")),
);
export const PHRASE_KINDS = Object.freeze(Object.keys(PHRASES));

/**
 * The Q7 phrase a take's admission is answered with, or null for SILENCE.
 *
 * A SUCCESS IS SILENT (plan §7): "Sent." was a receipt for words the person had
 * just said, on every single take, and the reply is what they are waiting for.
 *
 * `echo` is silent above all: it is the renderer's echo guard dropping the rig's
 * own speech heard back through the microphone, and answering it with "That did
 * not go through." would be heard back in turn (QA round 1, Q4). `cancelled` and
 * `closed` are the Gateway tearing a task down, not a take being refused.
 */
export function phraseForOutcome(outcome) {
	if (outcome?.ok) return null;
	switch (outcome?.code) {
		case "echo":
		case "cancelled":
		case "closed":
			return null;
		case "approval_pending":
			return "on_screen_first";
		case "voice_not_enabled":
			return "voice_off";
		default:
			return "failed";
	}
}

/** The relay's model name; s2s is started with `--model_name lop-relay`. */
export const RELAY_MODEL = "lop-relay";

const TOKEN_PATTERN = /⟦lop-say:([0-9a-f-]{36})⟧/;
const SPAWN_TOOL = "spawn_thinking";

/** The token string for a registered id. */
export const sayToken = (id) => `⟦lop-say:${id}⟧`;

const EXACT_TOKEN = /^⟦lop-say:[0-9a-f-]{36}⟧$/;

/**
 * `content` when it is EXACTLY one say token, else null. The provider's gate: a
 * response the Gateway builds from any other text (its Chinese result envelope,
 * a progress note) carries no instructions at all, and the relay is silent.
 */
export function tokenOf(content) {
	const value = String(content ?? "").trim();
	return EXACT_TOKEN.test(value) ? value : null;
}

/**
 * Texts the rig may speak, keyed by a one-use id. Bounded and time-limited: a
 * token is consumed when the relay answers with it, and an unconsumed one lapses
 * after `ttlMs` (the speech it was for was cancelled or never requested).
 */
export class SayRegistry {
	constructor({ ttlMs = 10 * 60_000, limit = 64, now = Date.now } = {}) {
		this.ttlMs = ttlMs;
		this.limit = limit;
		this.now = now;
		this.entries = new Map();
	}

	/** Register `text` (`kind`: reply | gate | phrase) and return its token. */
	register(text, kind) {
		const value = String(text ?? "").trim();
		if (!value) throw new TypeError("SayRegistry: empty text");
		if (!["reply", "gate", "phrase"].includes(kind))
			throw new TypeError(`SayRegistry: unknown kind ${kind}`);
		if (kind === "phrase" && !Object.values(PHRASES).includes(value))
			throw new TypeError("SayRegistry: a phrase must be a Q7 phrase");
		this.prune();
		const id = randomUUID();
		this.entries.set(id, { text: value, kind, at: this.now() });
		while (this.entries.size > this.limit) {
			this.entries.delete(this.entries.keys().next().value);
		}
		return sayToken(id);
	}

	/** The text for a token string, consumed; null when unknown or lapsed. */
	take(instructions) {
		const match = TOKEN_PATTERN.exec(String(instructions ?? ""));
		if (!match) return null;
		this.prune();
		const entry = this.entries.get(match[1]);
		if (!entry) return null;
		this.entries.delete(match[1]);
		return entry;
	}

	prune() {
		const cutoff = this.now() - this.ttlMs;
		for (const [id, entry] of this.entries) {
			if (entry.at < cutoff) this.entries.delete(id);
		}
	}
}

/** The text of one chat message's content, either shape. */
function contentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part) => part && (part.type === "text" || part.type === "input_text"),
		)
		.map((part) => String(part.text ?? ""))
		.join("");
}

/**
 * Decide what the relay says for one `/v1/chat/completions` body.
 *
 * Returns `{kind: "tool", objective}`, `{kind: "say", text, sayKind}` or
 * `{kind: "silent", reason}`. Pure apart from consuming a registry token.
 */
export function decideRelay(body, registry) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const system = messages.find((m) => m?.role === "system");
	const systemText = contentText(system?.content);
	// A token first: a say-response carries `tool_choice: none` and no user turn
	// of its own, and must speak exactly its registered words.
	if (TOKEN_PATTERN.test(systemText)) {
		const entry = registry.take(systemText);
		return entry
			? { kind: "say", text: entry.text, sayKind: entry.kind }
			: { kind: "silent", reason: "unknown_token" };
	}
	const last = messages[messages.length - 1];
	if (!last || last.role !== "user")
		return { kind: "silent", reason: "not_a_user_turn" };
	// A response that may not call tools is never a take (warmup has no tools;
	// a Gateway `buildSpeakResponse` sends `tool_choice: none`).
	const tools = Array.isArray(body?.tools) ? body.tools : [];
	const canSpawn =
		body?.tool_choice !== "none" &&
		tools.some((tool) => (tool?.function?.name ?? tool?.name) === SPAWN_TOOL);
	if (!canSpawn) return { kind: "silent", reason: "no_spawn_tool" };
	// Audio parts would mean s2s ran without STT; there are no words to relay.
	const objective = contentText(last.content);
	if (!objective.trim()) return { kind: "silent", reason: "empty_user_turn" };
	return { kind: "tool", objective };
}

/**
 * The SSE body s2s's Chat Completions accumulator reads
 * (`_iter_chat_stream_events`): one chunk carrying the whole tool call (name and
 * arguments) or the whole text, then a `finish_reason` chunk, then `[DONE]`.
 * The shape matches the mlx_lm.server stream the rig recorded
 * (`$RIG/tp-stream.out`).
 */
export function relayStream(
	decision,
	{ model = RELAY_MODEL, id = randomUUID() } = {},
) {
	const base = {
		id: `chatcmpl-${id}`,
		object: "chat.completion.chunk",
		model,
		created: Math.floor(Date.now() / 1000),
	};
	const chunk = (delta, finish) =>
		`data: ${JSON.stringify({
			...base,
			choices: [{ index: 0, finish_reason: finish, delta }],
		})}\n\n`;
	const frames = [];
	if (decision.kind === "tool") {
		frames.push(
			chunk(
				{
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: randomUUID(),
							type: "function",
							function: {
								name: SPAWN_TOOL,
								arguments: JSON.stringify({ objective: decision.objective }),
							},
						},
					],
				},
				null,
			),
		);
		frames.push(chunk({ role: "assistant" }, "tool_calls"));
	} else if (decision.kind === "say") {
		frames.push(chunk({ role: "assistant", content: decision.text }, null));
		frames.push(chunk({ role: "assistant" }, "stop"));
	} else {
		frames.push(chunk({ role: "assistant" }, "stop"));
	}
	frames.push("data: [DONE]\n\n");
	return frames.join("");
}

/** The non-streaming answer (warmup, compaction): text only, never a tool call. */
export function relayCompletion(decision, { model = RELAY_MODEL } = {}) {
	const text = decision.kind === "say" ? decision.text : "";
	return {
		id: `chatcmpl-${randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				finish_reason: "stop",
				message: { role: "assistant", content: text },
			},
		],
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
	};
}

/**
 * The relay's HTTP handler (`node:http` request listener). `onOutput` sees every
 * answer's spoken text, empty included - the test harness's invariant tap.
 */
export function createRelayHandler({ registry, onOutput = () => {} }) {
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://relay.invalid");
		if (req.method === "GET" && url.pathname === "/v1/models") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					object: "list",
					data: [{ id: RELAY_MODEL, object: "model", owned_by: "lop" }],
				}),
			);
			return;
		}
		if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "not found" } }));
			return;
		}
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			// A chat history is small; refuse a runaway body rather than buffer it.
			if (size > 8 * 1024 * 1024) req.destroy();
			else chunks.push(chunk);
		});
		req.on("end", () => {
			let body;
			try {
				body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "invalid JSON" } }));
				return;
			}
			const decision = decideRelay(body, registry);
			onOutput({
				decision,
				text: decision.kind === "say" ? decision.text : "",
				objective: decision.kind === "tool" ? decision.objective : null,
			});
			if (body?.stream === true) {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				});
				res.end(relayStream(decision));
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(relayCompletion(decision)));
		});
	};
}

/**
 * THE VERBATIM PROVIDER (Q3): the Gateway's s2s profile with every response it
 * builds carrying ONLY a registered token as its instructions. The text the
 * Gateway wanted the model to "convey naturally" is never sent to anything: a
 * response whose content is not a registered token is answered by the relay
 * with silence. The session itself also gets a fixed instruction, so a turn s2s
 * starts on its own (server VAD) reaches the relay with no token and the
 * relay's user-turn rule applies.
 *
 * `base` is the package's own `s2sProvider`; only the builders change.
 */
export const SESSION_INSTRUCTIONS =
	"Relay. Call spawn_thinking with the user's exact words.";

export function createVerbatimProvider(base, { resolveToken }) {
	const tokenOrNothing = (content) => resolveToken(String(content ?? "")) ?? "";
	return {
		...base,
		key: "lop-relay",
		label: "lop relay (speech-to-speech)",
		aliases: [],
		visibility: "gateway-only",
		buildSession: (options) => ({
			...base.buildSession(options),
			instructions: SESSION_INSTRUCTIONS,
		}),
		buildSpeakResponse: (content) => ({
			conversation: "none",
			modalities: ["audio"],
			instructions: tokenOrNothing(content),
			tool_choice: "none",
		}),
		// A delivery the Gateway makes on its own (a task result, a progress note,
		// a permission prompt) is silence unless its text IS a token: the lop slot
		// backend's results are empty, and the backend raises no permissions.
		buildResultInjection: (content) => ({
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "(relay)" }],
			},
			response: {
				modalities: ["audio"],
				tool_choice: "none",
				instructions: tokenOrNothing(content),
			},
		}),
		buildPermissionInjection: () => ({
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "(relay)" }],
			},
			response: {
				modalities: ["audio"],
				tool_choice: "none",
				instructions: "",
			},
		}),
	};
}

/**
 * THE LOP-SLOT BACKEND (Q4/Q5), a complete BackendPort. A Gateway task is the
 * ADMISSION of one take: `submit` sends `{type: "take", taskId, text}` up to
 * Electron main and resolves when main answers with `outcome`. It never waits
 * for the session's turn - tasks run one at a time per owner, so tying a task to
 * a turn would hold every later take behind it. The result content is empty,
 * so the Gateway's own result announcement is silence (the provider above).
 *
 * It never emits `backend.permission.requested` and refuses
 * `respondAuthorization`/`respondInput`: approvals are answered on screen only.
 */
export class LopSlotBackend {
	constructor({
		post,
		admissionTimeoutMs = 60_000,
		onOutcome = () => {},
	} = {}) {
		if (typeof post !== "function") throw new TypeError("LopSlotBackend: post");
		this.post = post;
		this.admissionTimeoutMs = admissionTimeoutMs;
		this.onOutcome = onOutcome;
		this.pending = new Map();
		this.listeners = new Set();
		this.started = false;
	}

	describe() {
		return {
			protocol: "lop-slot",
			label: "Local Operator (voice slot)",
			enabled: true,
			configured: true,
			capabilities: { authorization: false, input: false, artifacts: false },
		};
	}

	async start() {
		this.started = true;
		return { ok: true };
	}

	async health() {
		return { ok: true, status: "ready" };
	}

	status(taskId, context = {}) {
		if (taskId === undefined) {
			return { state: "ready", active: this.pending.size };
		}
		const entry = this.pending.get(String(taskId));
		if (!entry) return { taskId, state: "not_found" };
		if (context.ownerId !== undefined && context.ownerId !== entry.ownerId)
			return { taskId, state: "not_found" };
		return { taskId, state: "working" };
	}

	submit(task, { signal, onEvent } = {}) {
		const taskId = String(task?.id ?? "").trim();
		const ownerId = String(task?.ownerId ?? "").trim();
		const text = String(task?.instruction ?? task?.objective ?? "");
		if (!taskId || !ownerId || !text.trim()) {
			return Promise.reject(
				new Error("lop-slot submit requires task id, owner and input"),
			);
		}
		if (this.pending.has(taskId)) {
			return Promise.reject(new Error(`task ${taskId} is already active`));
		}
		return new Promise((resolve, reject) => {
			const entry = {
				ownerId,
				onEvent,
				resolve,
				reject,
				timer: setTimeout(
					() => this.settle(taskId, { ok: false, code: "timeout" }),
					this.admissionTimeoutMs,
				),
			};
			entry.timer.unref?.();
			this.pending.set(taskId, entry);
			signal?.addEventListener?.("abort", () =>
				this.settle(taskId, { ok: false, code: "cancelled" }),
			);
			this.emit({
				type: "backend.activity",
				taskId,
				ownerId,
				activity: { id: `admit-${taskId}`, kind: "status", status: "running" },
			});
			// The ONLY place a take leaves this process: main does the HTTP call.
			this.post({ type: "take", taskId, text });
		});
	}

	/** Main's answer for one take (`outcome {taskId, ok | code}`). */
	settle(taskId, outcome) {
		const entry = this.pending.get(String(taskId));
		if (!entry) return false;
		this.pending.delete(String(taskId));
		clearTimeout(entry.timer);
		try {
			this.onOutcome(String(taskId), outcome);
		} catch {
			// The phrase side effect must not hold the task open.
		}
		if (outcome?.ok) {
			// Empty content: the reply is spoken later from `/voice/text`, never
			// from this task result (Q4).
			entry.resolve({ content: "", artifacts: [] });
		} else {
			entry.reject(
				new Error(`take not admitted: ${outcome?.code ?? "failed"}`),
			);
		}
		return true;
	}

	async cancel(taskId, context = {}) {
		const entry = this.pending.get(String(taskId));
		if (!entry) return { taskId, state: "not_found" };
		if (context.ownerId !== undefined && context.ownerId !== entry.ownerId)
			throw new Error("task belongs to another owner");
		this.settle(taskId, { ok: false, code: "cancelled" });
		return { taskId, state: "cancelled" };
	}

	async respondAuthorization() {
		throw new Error("lop-slot: approvals are answered on screen only");
	}

	async respondInput() {
		throw new Error("lop-slot: this backend asks no questions");
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(event) {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A failing observer cannot interrupt execution (SDK contract).
			}
		}
		const entry = this.pending.get(event.taskId);
		try {
			entry?.onEvent?.(event);
		} catch {
			// Same rule for the per-task callback.
		}
	}

	async close() {
		for (const taskId of [...this.pending.keys()]) {
			this.settle(taskId, { ok: false, code: "closed" });
		}
		this.listeners.clear();
		this.started = false;
	}
}
