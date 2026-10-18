import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	LopSlotBackend,
	PHRASES,
	SESSION_INSTRUCTIONS,
	SayRegistry,
	createVerbatimProvider,
	decideRelay,
	tokenOf,
} from "../resources/qwen-voice/relay-core.mjs";

/*
 * THE VERBATIM PROVIDER AND THE LOP-SLOT BACKEND (the backend's
 * docs/design/qwen-voice.md, Q3/Q4/Q6).
 *
 * The provider is the rig's s2s profile with one change: every response the
 * Gateway builds carries a registered token as its instructions, or nothing. The
 * Gateway's own words - its Chinese "convey naturally" envelope, a result body, a
 * permission prompt - never reach s2s as instructions, so the relay answers them
 * with silence. A stand-in `base` is used here so CI needs no rig; the real
 * `s2sProvider` is checked at the bottom when the rig is installed.
 */

const APPROVAL_PENDING = /approval_pending/;
const ON_SCREEN = /on screen/;
const ASKS_NOTHING = /asks no questions/;
const TIMED_OUT = /timeout/;

const BASE = {
	key: "speech-to-speech",
	label: "HF speech-to-speech",
	aliases: ["s2s"],
	buildSession: () => ({
		type: "realtime",
		instructions: "你是语音助手……(the Gateway's long frontend prompt)",
		tools: [{ type: "function", name: "spawn_thinking" }],
	}),
	buildSpeakResponse: (content) => ({
		instructions: `请以自然口语传达下面的信息：\n${content}`,
	}),
};

test("speak: a token passes through as the only instructions; anything else is empty", () => {
	const r = new SayRegistry();
	const provider = createVerbatimProvider(BASE, { resolveToken: tokenOf });
	const token = r.register("Hello, word for word.", "reply");
	const speak = provider.buildSpeakResponse(token);
	assert.equal(speak.instructions, token);
	assert.equal(speak.tool_choice, "none");
	assert.equal(speak.conversation, "none");
	// The Gateway wrapping a token in its own envelope is NOT a bare token.
	assert.equal(
		provider.buildSpeakResponse(`请转达：${token}`).instructions,
		"",
	);
	assert.equal(provider.buildSpeakResponse("free text").instructions, "");
	// And the relay, given what the provider built, speaks only the registered text.
	const decision = decideRelay(
		{ messages: [{ role: "system", content: speak.instructions }] },
		r,
	);
	assert.deepEqual(decision, {
		kind: "say",
		text: "Hello, word for word.",
		sayKind: "reply",
	});
});

test("result and permission injections are silent and cannot call tools", () => {
	const provider = createVerbatimProvider(BASE, { resolveToken: tokenOf });
	const result = provider.buildResultInjection(
		'<task_result status="completed">The lop session said hi</task_result>',
		{ allowTools: true },
	);
	assert.equal(result.response.instructions, "");
	assert.equal(result.response.tool_choice, "none");
	assert.equal(
		JSON.stringify(result.item).includes("lop session said"),
		false,
		"the Gateway's text never enters s2s's chat",
	);
	const permission = provider.buildPermissionInjection({
		id: "p1",
		taskId: "t1",
		summary: "rm -rf /",
	});
	assert.equal(permission.response.instructions, "");
	assert.equal(permission.response.tool_choice, "none");
	assert.equal(JSON.stringify(permission).includes("rm -rf"), false);
});

test("the session keeps the base's tools and audio setup, with a fixed instruction", () => {
	const provider = createVerbatimProvider(BASE, { resolveToken: tokenOf });
	const session = provider.buildSession({ agentContext: {} });
	assert.equal(session.instructions, SESSION_INSTRUCTIONS);
	assert.deepEqual(session.tools, BASE.buildSession().tools);
	assert.equal(provider.key, "lop-relay");
	assert.equal(provider.visibility, "gateway-only");
	assert.deepEqual(provider.aliases, [], "never claims the base's aliases");
});

/* ------------------------------------------------------------------------ */
/* LopSlotBackend                                                            */
/* ------------------------------------------------------------------------ */

function backendRig() {
	const posted = [];
	const outcomes = [];
	const backend = new LopSlotBackend({
		post: (message) => posted.push(message),
		onOutcome: (taskId, outcome) => outcomes.push({ taskId, ...outcome }),
	});
	return { backend, posted, outcomes };
}
const work = (id = "task_1", text = "Hello lop.") => ({
	id,
	ownerId: "user_personal",
	instruction: text,
});

test("a take is posted up verbatim and resolves on main's ok, with empty content", async () => {
	const { backend, posted, outcomes } = backendRig();
	const pending = backend.submit(work("task_1", "  exact words, kept as is  "));
	assert.deepEqual(posted, [
		{ type: "take", taskId: "task_1", text: "  exact words, kept as is  " },
	]);
	assert.equal(backend.status("task_1").state, "working");
	backend.settle("task_1", { ok: true });
	assert.deepEqual(await pending, { content: "", artifacts: [] });
	assert.deepEqual(outcomes, [{ taskId: "task_1", ok: true }]);
	assert.equal(backend.status("task_1").state, "not_found");
});

test("a refused take rejects with its code; the outcome hook sees it", async () => {
	const { backend, outcomes } = backendRig();
	const pending = backend.submit(work());
	backend.settle("task_1", { ok: false, code: "approval_pending" });
	await assert.rejects(pending, APPROVAL_PENDING);
	assert.equal(outcomes[0].code, "approval_pending");
});

test("approvals and input are refused: voice never answers a gate (V7)", async () => {
	const { backend } = backendRig();
	await assert.rejects(
		backend.respondAuthorization("t", "p", "approve"),
		ON_SCREEN,
	);
	await assert.rejects(backend.respondInput("t", "i", "yes"), ASKS_NOTHING);
	assert.equal(backend.describe().capabilities.authorization, false);
});

test("an unanswered take times out and does not hold the queue", async () => {
	const backend = new LopSlotBackend({
		post: () => {},
		admissionTimeoutMs: 20,
	});
	await assert.rejects(backend.submit(work()), TIMED_OUT);
	assert.equal(backend.status("task_1").state, "not_found");
});

test("Q7 phrases are the closed set of four", () => {
	assert.deepEqual(Object.keys(PHRASES).sort(), [
		"failed",
		"on_screen_first",
		"switched",
		"voice_off",
	]);
	assert.equal(
		"sent" in PHRASES,
		false,
		"a successful take is silent (plan §7)",
	);
});

/* ------------------------------------------------------------------------ */
/* AGAINST THE RIG'S OWN SDK, when the rig is installed                      */
/* ------------------------------------------------------------------------ */

const RIG =
	process.env.LOP_QWEN_RIG_DIR ||
	join(homedir(), ".local", "share", "qwen-voice-rig");
const SERVER = join(
	RIG,
	"qwa",
	"node_modules",
	"qwen-audio-agent",
	"server",
	"src",
);
const rigPresent = existsSync(
	join(SERVER, "backend", "backend-adapter-sdk.mjs"),
);
const skipWhy = rigPresent
	? false
	: `the Qwen rig is not installed at ${RIG} (CI); run locally with the rig`;

test(
	"BackendPort conformance through the SDK (verifyBackendAdapterConformance)",
	{ skip: skipWhy },
	async () => {
		const sdk = await import(
			pathToFileURL(join(SERVER, "backend", "backend-adapter-sdk.mjs")).href
		);
		assert.equal(sdk.BACKEND_ADAPTER_SDK_VERSION, "3.0.0");
		let n = 0;
		await sdk.verifyBackendAdapterConformance({
			createFixture: async ({ hold }) => {
				let markStarted;
				const started = new Promise((resolve) => {
					markStarted = resolve;
				});
				const backend = new LopSlotBackend({
					// "Main": admit every take at once unless the harness holds it.
					post: (message) => {
						markStarted();
						if (!hold)
							queueMicrotask(() =>
								backend.settle(message.taskId, { ok: true }),
							);
					},
				});
				n += 1;
				return {
					name: "lop-slot",
					backend,
					work: work(`task_${n}_a`),
					nextWork: work(`task_${n}_b`),
					started,
				};
			},
		});
		// The host the launcher composes accepts it too.
		const host = sdk.createBackendAgentHost(
			new LopSlotBackend({ post: () => {} }),
			{
				name: "lop-slot",
			},
		);
		assert.equal(typeof host, "object");
	},
);

test(
	"the real s2sProvider, wrapped, passes the Gateway's provider validation",
	{ skip: skipWhy },
	async () => {
		const { s2sProvider } = await import(
			pathToFileURL(join(SERVER, "voice", "providers", "s2s.mjs")).href
		);
		const { createRealtimeProviderRegistry } = await import(
			pathToFileURL(join(SERVER, "voice", "realtime-provider-extension.mjs"))
				.href
		);
		const provider = createVerbatimProvider(s2sProvider, {
			resolveToken: tokenOf,
		});
		const registry = createRealtimeProviderRegistry({
			providers: [provider],
			defaultProvider: provider.key,
		});
		assert.equal(registry.resolve().key, "lop-relay");
		const r = new SayRegistry();
		const token = r.register("Exactly this.", "reply");
		assert.equal(provider.buildSpeakResponse(token).instructions, token);
		assert.equal(
			provider.buildResultInjection("任务完成：结果……").response.instructions,
			"",
		);
	},
);
