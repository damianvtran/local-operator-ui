import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * First-run recovery (onboarding friction, 2026-11): the local-model check (D1),
 * the failed-send row's fix (D3) and the composer's pre-send block line (D4).
 *
 * PostHog, 30 days of external desktop users: 146 pressed the local model's
 * "Check again" (8.4x each on Windows, 74 never sent a message), 62 pressed
 * "Send again", ~32 rage-clicked an empty composer. Each test below pins the
 * property that answers one of those: a check that names its cause and
 * visibly lands, a failure that offers the fix its cause needs, a composer that
 * says why it cannot send before the press.
 *
 * Server-rendered like `approval-escape.test.mjs` (there is no jsdom in this
 * tree): the views are presentational, and the decisions are pure functions.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { diagnoseLocal, isDefaultLocalAddress, OLLAMA_RECOMMENDED_MODEL } from "./src/renderer/src/features/providers/local-provider-diagnosis";',
			'export { LocalProviderStatusView } from "./src/renderer/src/features/providers/local-provider-status";',
			'export { sendBlockFor, recoveryForFailure, recoveryForBlock, keepsSendAgain, failureCauseOf } from "./src/renderer/src/features/chat/send-recovery";',
			'export { SendBlockedLineView, UndeliveredLineView, undeliveredSentence, reconnectOutcome } from "./src/renderer/src/features/chat/components/send-recovery-action";',
			'export { sendFailureCopy } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { makeLocalDefault } from "./src/renderer/src/features/providers/local-default";',
			'export { providerStatusFrom } from "./src/renderer/src/features/providers/use-provider-status";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL(
	"./_onboarding-recovery.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const {
	diagnoseLocal,
	isDefaultLocalAddress,
	OLLAMA_RECOMMENDED_MODEL,
	LocalProviderStatusView,
	sendBlockFor,
	recoveryForFailure,
	recoveryForBlock,
	keepsSendAgain,
	failureCauseOf,
	SendBlockedLineView,
	UndeliveredLineView,
	undeliveredSentence,
	reconnectOutcome,
	sendFailureCopy,
	DesktopControlError,
	makeLocalDefault,
	providerStatusFrom,
} = await import(bundlePath.href);
await unlink(bundlePath);

const OLLAMA = {
	id: "ollama",
	name: "Ollama",
	brand: "Ollama",
	base_url: "http://localhost:11434/v1",
};
const NO_ANSWER = {
	reachable: false,
	detail: "No server answered at this address.",
};
const answered = (status) => ({
	reachable: true,
	detail: `A server answered (${status}).`,
});

// ------------------------------------------------------------------ D1

test("D1: the default address with nothing answering reads as not running", () => {
	assert.equal(
		isDefaultLocalAddress("ollama", "http://localhost:11434/v1"),
		true,
	);
	assert.equal(
		isDefaultLocalAddress("ollama", "http://127.0.0.1:11434/v1"),
		true,
	);
	assert.equal(
		isDefaultLocalAddress("ollama", "http://192.168.1.4:11434/v1"),
		false,
	);
	assert.equal(
		isDefaultLocalAddress("ollama", "http://localhost:9999/v1"),
		false,
	);
	assert.equal(
		isDefaultLocalAddress("openai-compatible", "http://localhost:8000/v1"),
		false,
	);
	const base = { providerId: "ollama", baseUrl: OLLAMA.base_url, models: null };
	assert.deepEqual(diagnoseLocal({ ...base, probe: NO_ANSWER }), {
		kind: "not_running",
	});
	// A changed address that nothing answers may be a typo: say so.
	assert.deepEqual(
		diagnoseLocal({
			...base,
			baseUrl: "http://localhost:9999/v1",
			probe: NO_ANSWER,
		}),
		{ kind: "wrong_address", status: null },
	);
});

test("D1: a server answering, by status and model count", () => {
	const base = { providerId: "ollama", baseUrl: OLLAMA.base_url };
	/*
	 * R2/Q1: an EMPTY list is not "no models". Core discovery caches the listing
	 * (an empty one too), so after `ollama pull` every Check again still read 0;
	 * the verdict is "running", with the download step as a hint.
	 */
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(200), models: 0 }),
		{ kind: "ready", models: null, emptyListing: true },
	);
	assert.deepEqual(
		diagnoseLocal({
			...base,
			probe: answered(200),
			models: 3,
			firstModel: "qwen3:8b",
		}),
		{ kind: "ready", models: 3, firstModel: "qwen3:8b" },
	);
	// An unreadable list is unknown, never "no models".
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(200), models: null }),
		{ kind: "ready", models: null, firstModel: null },
	);
	// Something on the port that does not serve /models: wrong program or path.
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(404), models: null }),
		{
			kind: "wrong_address",
			status: 404,
		},
	);
	// A server that wants a token is still this server running (the probe's rule).
	assert.equal(
		diagnoseLocal({ ...base, probe: answered(401), models: 2 }).kind,
		"ready",
	);
	/*
	 * Q4: a 401/403 listing is unreadable, and the core answers it with []. That
	 * must not read as "running, no models" (and must not offer a download).
	 */
	for (const status of [401, 403])
		assert.deepEqual(
			diagnoseLocal({ ...base, probe: answered(status), models: 0 }),
			{ kind: "ready", models: null },
		);
	// A detail with no status is the probe's healthy answer.
	assert.equal(
		diagnoseLocal({
			...base,
			probe: { reachable: true, detail: "" },
			models: 1,
		}).kind,
		"ready",
	);
});

const renderLocal = (props) =>
	renderToStaticMarkup(
		createElement(LocalProviderStatusView, {
			provider: OLLAMA,
			testing: false,
			checkedAt: Date.UTC(2026, 10, 17, 14, 32, 7),
			failedChecks: 1,
			onCheckAgain: () => {},
			...props,
		}),
	);

test("D1: not running offers download, the start command and the hosted way out", () => {
	const html = renderLocal({
		diagnosis: { kind: "not_running" },
		onUseHosted: () => {},
	});
	assert.match(html, /data-local-status="not_running"/);
	assert.match(html, /Ollama isn&#x27;t running on this computer/);
	assert.match(
		html,
		/Nothing answered at <code[^>]*>http:\/\/localhost:11434\/v1<\/code>/,
	);
	assert.match(html, /data-local-download/);
	assert.match(html, /Download Ollama/);
	assert.match(html, /<code[^>]*>ollama serve<\/code>/);
	assert.match(html, /Use a Radient account instead/);
	assert.match(html, /Check again/);
	// The receipt: every finished check stamps a time.
	assert.match(html, /data-local-checked-at[^>]*>Checked at /);
});

test("D1: a repeated failed check says so, and the hosted path is omitted without a row", () => {
	const html = renderLocal({
		diagnosis: { kind: "not_running" },
		failedChecks: 3,
	});
	assert.match(html, /Still not found · checked at /);
	assert.doesNotMatch(html, /Use a Radient account instead/);
});

test("D1: in flight, the control says Checking at body ink, refused by aria-disabled", () => {
	const html = renderLocal({
		diagnosis: { kind: "not_running" },
		testing: true,
	});
	const control = html.match(/<button[^>]*data-local-check-again[^>]*>/)?.[0];
	assert.ok(control, "the Check again control renders");
	// Design D1: the label IS the status, so not the 2.65:1 disabled palette.
	assert.match(control, /aria-disabled="true"/);
	assert.match(control, /aria-busy="true"/);
	assert.match(control, /text-ink-muted/);
	assert.doesNotMatch(control, / disabled=""/);
	assert.match(html, />Checking</);
	// The stale receipt is withheld while a new check runs.
	assert.doesNotMatch(html, /Checked at /);
});

test("D1: the first check shows one spinner, not a second one under it (D8)", () => {
	const html = renderLocal({ diagnosis: null, testing: true, checkedAt: null });
	assert.match(html, /Checking whether Ollama is running…/);
	assert.doesNotMatch(html, /data-local-check-again/);
});

test("D1: the address is set as code, apart from the full stop (D6)", () => {
	const html = renderLocal({ diagnosis: { kind: "not_running" } });
	assert.match(
		html,
		/Nothing answered at <code data-local-address="" class="font-mono">http:\/\/localhost:11434\/v1<\/code>\./,
	);
	const changed = renderLocal({
		provider: { ...OLLAMA, base_url: "http://localhost:9999/v1" },
		diagnosis: { kind: "wrong_address", status: null },
	});
	assert.match(
		changed,
		/Nothing answered at <code data-local-address="" class="font-mono">http:\/\/localhost:9999\/v1<\/code>/,
	);
});

test("D1: the repeat receipt names what repeated (D2/N2)", () => {
	// Nothing answered: "still not found" is true.
	assert.match(
		renderLocal({ diagnosis: { kind: "not_running" }, failedChecks: 2 }),
		/Still not found · checked at /,
	);
	// Something answered, or the check never ran: never "not found".
	for (const diagnosis of [
		{ kind: "wrong_address", status: 404 },
		{ kind: "check_failed" },
		{ kind: "no_address" },
	]) {
		const html = renderLocal({ diagnosis, failedChecks: 2 });
		assert.doesNotMatch(html, /Still not found/);
		assert.match(html, /Same result · checked at /);
	}
});

test("D1: no address and a failed check route each name their own cause (Q3, M3)", () => {
	const compatible = {
		id: "openai-compatible",
		name: "OpenAI-compatible",
		brand: "OpenAI-compatible",
		base_url: null,
	};
	const noAddress = renderLocal({
		provider: compatible,
		diagnosis: { kind: "no_address" },
	});
	assert.match(noAddress, /OpenAI-compatible has no server address yet/);
	assert.doesNotMatch(noAddress, /Nothing answered at/);
	const failed = renderLocal({ diagnosis: { kind: "check_failed" } });
	assert.match(failed, /Couldn&#x27;t check Ollama/);
	assert.match(failed, /background service didn&#x27;t answer/);
	// Not the not-running copy: a working Ollama must not be told to reinstall.
	assert.doesNotMatch(failed, /Download Ollama|isn&#x27;t running/);
});

test("U1: a ready runtime is one press from a working chat", () => {
	let used = 0;
	const ready = renderLocal({
		diagnosis: { kind: "ready", models: 3, firstModel: "qwen3:8b" },
		onUseForChats: () => {
			used += 1;
		},
	});
	assert.match(
		ready,
		/<button[^>]*data-local-use-for-chats=""[^>]*>Use Ollama for chats<\/button>/,
	);
	// No model known: nothing to make the default, so no press is offered.
	assert.doesNotMatch(
		renderLocal({
			diagnosis: { kind: "ready", models: null, firstModel: null },
			onUseForChats: () => {},
		}),
		/data-local-use-for-chats/,
	);
	// In flight: the label states it at body ink.
	assert.match(
		renderLocal({
			diagnosis: { kind: "ready", models: 3, firstModel: "qwen3:8b" },
			onUseForChats: () => {},
			using: true,
		}),
		/aria-busy="true"[^>]*>Setting up Ollama…/,
	);
	// Already the default: the receipt and the flow's next step, no second press.
	const inUse = renderLocal({
		diagnosis: { kind: "ready", models: 3, firstModel: "qwen3:8b" },
		onUseForChats: () => {},
		inUse: "qwen3:8b",
		onContinue: () => {},
		continueLabel: "Continue",
	});
	assert.match(
		inUse,
		/data-local-in-use=""[^>]*>.*Chats use Ollama · qwen3:8b/,
	);
	assert.match(inUse, />Continue<\/button>/);
	assert.doesNotMatch(inUse, /data-local-use-for-chats/);
	assert.equal(used, 0);
});

test("U1: the use press writes the picker's two defaults, and the gate then counts the runtime", async () => {
	const writes = [];
	await makeLocalDefault(
		{ provider: "ollama", model_id: "qwen3:8b" },
		async (key, value) => {
			writes.push([key, value]);
		},
	);
	assert.deepEqual(writes, [
		["hosting", "ollama"],
		["model_name", "qwen3:8b"],
	]);
	const census = [
		{ id: "ollama", local: true, configured: true, has_credential: false },
		{ id: "openai", local: false, configured: false, has_credential: false },
	];
	const known = {
		censusEnabled: true,
		censusLoaded: true,
		configLoading: false,
		rows: census,
	};
	// Before: no default, no cloud credential - the replays' refused send.
	assert.equal(
		providerStatusFrom({ ...known, hosting: null }).needsProvider,
		true,
	);
	// After the write: the local row is the default and counts as usable.
	const after = providerStatusFrom({ ...known, hosting: "ollama" });
	assert.equal(after.needsProvider, false);
	assert.equal(after.needsModel, false);
});

test("D1: an empty listing reads as running, with the pull command as a hint (R2/Q1)", () => {
	const html = renderLocal({
		diagnosis: { kind: "ready", models: null, emptyListing: true },
		failedChecks: 0,
	});
	assert.match(html, /data-local-status="ready"/);
	assert.match(html, /Ollama is running/);
	assert.doesNotMatch(html, /has no models|Still not found/);
	assert.match(html, /No models are listed yet/);
	assert.match(html, /can take a while to appear here/);
	assert.match(
		html,
		new RegExp(`ollama pull ${OLLAMA_RECOMMENDED_MODEL.replace(":", ":")}`),
	);
	assert.match(html, />Copy</);
	const other = renderLocal({
		provider: {
			id: "lmstudio",
			name: "LM Studio",
			brand: "LM Studio",
			base_url: "http://localhost:1234/v1",
		},
		diagnosis: { kind: "ready", models: null, emptyListing: true },
	});
	assert.match(other, /Load one in LM Studio\./);
	assert.doesNotMatch(other, /ollama pull/);
});

test("D1: the wrong program on the port names the status", () => {
	const html = renderLocal({
		diagnosis: { kind: "wrong_address", status: 404 },
	});
	assert.match(html, /but not as Ollama \(HTTP 404\)/);
	const ready = renderLocal({ diagnosis: { kind: "ready", models: 2 } });
	assert.match(ready, /Ollama is running with 2 models/);
	assert.doesNotMatch(ready, /data-local-alternative/);
});

// ------------------------------------------------------------------ D3 / D4

test("D4: offline outranks the provider facts; each block has one fix", () => {
	assert.equal(
		sendBlockFor({ noProvider: true, noModel: false, serverOffline: true }),
		"offline",
	);
	assert.equal(
		sendBlockFor({ noProvider: true, noModel: false, serverOffline: false }),
		"no_provider",
	);
	assert.equal(
		sendBlockFor({ noProvider: false, noModel: true, serverOffline: false }),
		"no_model",
	);
	assert.equal(
		sendBlockFor({ noProvider: false, noModel: false, serverOffline: false }),
		null,
	);
	assert.equal(recoveryForBlock("offline"), "reconnect");
	assert.equal(recoveryForBlock("no_provider"), "connect_provider");
	assert.equal(recoveryForBlock("no_model"), "choose_model");
	// U1: a local model picked while nothing is the default names THAT fix.
	assert.equal(
		sendBlockFor({
			noProvider: true,
			noModel: false,
			serverOffline: false,
			localSelection: true,
		}),
		"local_not_default",
	);
	assert.equal(recoveryForBlock("local_not_default"), "use_local");
	// Offline still outranks it.
	assert.equal(
		sendBlockFor({
			noProvider: true,
			noModel: false,
			serverOffline: true,
			localSelection: true,
		}),
		"offline",
	);
});

const VETTED_NO_PROVIDER =
	"No model provider is configured yet. Connect one in Settings > Providers, then send the message again.";
const VETTED_NO_MODEL =
	"No model is selected for this session. Pick one with /model, then send the message again.";

test("D3/R1: the backend's 503 runtime_unreachable keeps its cause THROUGH the store", () => {
	// The real wire shape: the vetted startup reason is the refusal's message.
	const copy = sendFailureCopy(
		new DesktopControlError(
			503,
			VETTED_NO_PROVIDER,
			undefined,
			"runtime_unreachable",
		),
	);
	assert.equal(copy.cause, "no_provider");
	assert.equal(copy.code, "runtime_unreachable");
	// This app's sentence, not "couldn't confirm… sending it again is safe".
	assert.match(copy.message, /No model provider is set up for chats yet/);
	assert.doesNotMatch(copy.message, /safe/);
	// The row maps the KEPT cause to its fix, although its sentence is ours now.
	assert.equal(
		recoveryForFailure({
			code: copy.code,
			message: copy.message,
			cause: copy.cause,
		}),
		"connect_provider",
	);
	const model = sendFailureCopy(
		new DesktopControlError(
			503,
			VETTED_NO_MODEL,
			undefined,
			"runtime_unreachable",
		),
	);
	assert.equal(model.cause, "no_model");
	assert.equal(
		recoveryForFailure({
			code: model.code,
			message: model.message,
			cause: model.cause,
		}),
		"choose_model",
	);
	// An unrelated runtime_unreachable keeps the unknown-outcome copy and no cause.
	const other = sendFailureCopy(
		new DesktopControlError(
			503,
			"Session owner is unavailable.",
			undefined,
			"runtime_unreachable",
		),
	);
	assert.equal(other.cause, undefined);
	assert.equal(failureCauseOf("Session owner is unavailable."), null);
});

test("D3/U2: once the live verdict is read and clear, the cause's row offers Send again", () => {
	for (const cause of ["no_provider", "no_model"]) {
		// Unknown verdict (census loading): keep the cause's fix.
		assert.notEqual(recoveryForFailure({ cause, verdictKnown: false }), null);
		// Known and clear: the cause is gone, so Send again comes back.
		const fixed = recoveryForFailure({
			cause,
			block: null,
			verdictKnown: true,
		});
		assert.equal(fixed, null);
		assert.equal(keepsSendAgain(fixed), true);
	}
	// The sentence-only path (a pre-R1 row) retires the same way.
	assert.equal(
		recoveryForFailure({ message: VETTED_NO_PROVIDER, verdictKnown: true }),
		null,
	);
	// A live block still wins over a known verdict.
	assert.equal(
		recoveryForFailure({
			cause: "no_provider",
			block: "no_provider",
			verdictKnown: true,
		}),
		"connect_provider",
	);
});

test("D3/Q2/M2: the row's Reconnect always ends in a stated result", async () => {
	const clock = { at: 1_000 };
	const slept = [];
	const deps = {
		now: () => clock.at,
		sleep: async (ms) => {
			slept.push(ms);
			clock.at += ms;
		},
	};
	// Still down: the receipt names it, after the 400 ms perception floor.
	const still = await reconnectOutcome({
		...deps,
		reconnect: async () => {},
		readHealth: async () => ({ online: false }),
	});
	assert.match(still, /^Still not responding · checked at /);
	assert.deepEqual(slept, [400]);
	// M2: a rejected reconnect IPC is not silent.
	assert.match(
		await reconnectOutcome({
			...deps,
			reconnect: async () => {
				throw new Error("ipc closed");
			},
			readHealth: async () => ({ online: false }),
		}),
		/Still not responding/,
	);
	// Nor is a health read that throws.
	assert.match(
		await reconnectOutcome({
			...deps,
			readHealth: async () => {
				throw new Error("boom");
			},
		}),
		/Still not responding/,
	);
	// Back: no outcome, the row's reason clears by itself.
	assert.equal(
		await reconnectOutcome({
			...deps,
			readHealth: async () => ({ online: true }),
		}),
		null,
	);
	// And the row renders the outcome where the press was made.
	const html = renderToStaticMarkup(
		createElement(UndeliveredLineView, {
			sentence: undeliveredSentence({
				message:
					"Couldn't reach Local Operator. Your message may not have been sent.",
				recovery: "reconnect",
				block: "offline",
				outcome: still,
			}),
			recovery: "reconnect",
			offerSendAgain: true,
			onFix: () => {},
			onSendAgain: () => {},
			onEdit: () => {},
		}),
	);
	assert.match(
		html,
		/data-undelivered-sentence=""[^>]*>.*Still not responding · checked at /,
	);
	assert.match(html, /data-undelivered-recovery="reconnect"[^>]*>Reconnect</);
	assert.match(html, />Send again</);
});

test("D3/M4: a row whose fix replaces Send again does not promise a safe resend", () => {
	const unconfirmed =
		"Couldn't confirm your message was sent. Sending it again is safe.";
	const sentence = undeliveredSentence({
		message: unconfirmed,
		recovery: "connect_provider",
		block: "no_provider",
	});
	assert.doesNotMatch(sentence, /safe/);
	assert.match(sentence, /No model provider is connected/);
	// Beside a kept Send again, the store's sentence stays.
	assert.equal(
		undeliveredSentence({ message: unconfirmed, recovery: null, block: null }),
		unconfirmed,
	);
	const html = renderToStaticMarkup(
		createElement(UndeliveredLineView, {
			sentence,
			recovery: "connect_provider",
			offerSendAgain: false,
			onFix: () => {},
			onSendAgain: () => {},
			onEdit: () => {},
		}),
	);
	assert.doesNotMatch(html, /Send again/);
	assert.match(html, />Connect a provider</);
	assert.match(html, />Edit</);
});

test("D3: a failed send's fix comes from its vetted cause", () => {
	assert.equal(
		recoveryForFailure({
			message:
				"No model provider is configured yet. Connect one in Settings > Providers, then send the message again.",
		}),
		"connect_provider",
	);
	assert.equal(
		recoveryForFailure({
			message:
				"This session's model provider is not recognised. Choose a provider in Settings > Providers, then send the message again.",
		}),
		"connect_provider",
	);
	assert.equal(
		recoveryForFailure({
			message:
				"No model is selected for this session. Pick one with /model, then send the message again.",
		}),
		"choose_model",
	);
	assert.equal(recoveryForFailure({ code: "transport.failed" }), "reconnect");
	// The daemon answered that ONE runtime is unreachable: a re-dial does not fix it.
	assert.equal(recoveryForFailure({ code: "runtime_unreachable" }), null);
	assert.equal(
		recoveryForFailure({ message: "Your message wasn't sent." }),
		null,
	);
	// The live block wins: a row that failed while the service is down now.
	assert.equal(
		recoveryForFailure({
			message: "Your message wasn't sent.",
			block: "offline",
		}),
		"reconnect",
	);
	// A config fix replaces Send again; a reconnect sits beside it.
	assert.equal(keepsSendAgain("connect_provider"), false);
	assert.equal(keepsSendAgain("choose_model"), false);
	assert.equal(keepsSendAgain("reconnect"), true);
	assert.equal(keepsSendAgain(null), true);
});

const renderBlocked = (props) =>
	renderToStaticMarkup(
		createElement(SendBlockedLineView, { onFix: () => {}, ...props }),
	);

test("D4: the block line states the reason and carries the fix as a control", () => {
	const html = renderBlocked({ block: "no_provider" });
	assert.match(html, /data-send-blocked="no_provider"/);
	assert.match(
		html,
		/<output[^>]*>.*No model provider is connected, so messages can&#x27;t be sent yet\./,
	);
	assert.match(
		html,
		/<button[^>]*data-send-recovery="connect_provider"[^>]*>Connect a provider<\/button>/,
	);
	/*
	 * M1: dim until a refused press or a click into the box; then full ink - read
	 * off the `<output>` ITSELF (the icon also carries text-ink-muted).
	 */
	const outputClass = (markup) => /<output class="([^"]*)"/.exec(markup)?.[1];
	assert.match(outputClass(html), /(^| )text-ink-muted( |$)/);
	assert.doesNotMatch(outputClass(html), /(^| )text-ink( |$)/);
	const emphasised = renderBlocked({ block: "no_provider", emphasis: true });
	assert.match(emphasised, /data-emphasis=""/);
	assert.match(outputClass(emphasised), /(^| )text-ink( |$)/);
	assert.doesNotMatch(outputClass(emphasised), /text-ink-muted/);
	/*
	 * D1: in flight, the label IS the status, so it keeps body ink and is refused
	 * by aria-disabled rather than the disabled palette.
	 */
	const offline = renderBlocked({ block: "offline", busy: true });
	assert.match(offline, /Reconnecting…/);
	assert.match(
		offline,
		/data-send-recovery="reconnect"[^>]*aria-disabled="true"/,
	);
	assert.doesNotMatch(offline, /<button[^>]* disabled=""/);
	const busyButton =
		/<button[^>]*data-send-recovery="reconnect"[^>]*>/.exec(offline)?.[0] ?? "";
	assert.match(busyButton, /aria-busy="true"/);
	assert.match(busyButton, /class="[^"]* text-ink-muted"/);
	assert.match(
		renderBlocked({
			block: "offline",
			outcome: "Still not responding · checked at 2:32:07 PM",
		}),
		/Still not responding · checked at 2:32:07 PM/,
	);
	assert.match(renderBlocked({ block: "no_model" }), />Choose a model</);
	// U1: the local runtime is named, and the fix is one press.
	const local = renderBlocked({ block: "local_not_default", brand: "Ollama" });
	assert.match(local, /Ollama isn&#x27;t set up for chats yet/);
	assert.doesNotMatch(local, /No model provider is connected/);
	assert.match(
		local,
		/data-send-recovery="use_local"[^>]*>Use Ollama for chats</,
	);
	// D5: each refused press re-keys the fix control with the one-shot cue.
	assert.doesNotMatch(
		renderBlocked({ block: "no_provider" }),
		/lo-refused-cue/,
	);
	assert.match(
		renderBlocked({ block: "no_provider", cue: 2 }),
		/data-cue="2"[^>]*class="[^"]*lo-refused-cue|class="[^"]*lo-refused-cue[^"]*"[^>]*data-cue="2"/,
	);
});

test("D4: the composer mounts the line for every block and a click into the box reaches it", () => {
	const source = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.match(
		source,
		/<SendBlockedLine\s+block=\{sendBlock\}\s+emphasis=\{noProviderHint\}\s+cue=\{refusedPresses\}/,
	);
	// D3: the empty chat's connect card is not echoed by a second Connect button.
	assert.match(
		source,
		/sendBlock && !\(sendBlock === "no_provider" && showEmptyChatPrompt\)/,
	);
	// D5: every refused press counts, so each one restarts the window and the cue.
	assert.match(source, /setRefusedPresses\(\(count\) => count \+ 1\)/);
	assert.match(source, /if \(sendBlock\) explainRefusedSend\(\);/);
	// The plain-text hint users rage-clicked is gone.
	assert.doesNotMatch(
		source,
		/t\("ui\.chat\.composer_notes\.hint\.connect_provider"\)/,
	);
});
