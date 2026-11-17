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
			'export { sendBlockFor, recoveryForFailure, recoveryForBlock, keepsSendAgain } from "./src/renderer/src/features/chat/send-recovery";',
			'export { SendBlockedLineView } from "./src/renderer/src/features/chat/components/send-recovery-action";',
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
	SendBlockedLineView,
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
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(200), models: 0 }),
		{
			kind: "no_models",
		},
	);
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(200), models: 3 }),
		{
			kind: "ready",
			models: 3,
		},
	);
	// An unreadable list is unknown, never "no models".
	assert.deepEqual(
		diagnoseLocal({ ...base, probe: answered(200), models: null }),
		{
			kind: "ready",
			models: null,
		},
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
	assert.match(html, /Nothing answered at http:\/\/localhost:11434\/v1/);
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

test("D1: in flight, the control says Checking and is disabled", () => {
	const html = renderLocal({
		diagnosis: { kind: "not_running" },
		testing: true,
	});
	assert.match(
		html,
		/data-local-check-again[^>]*disabled|disabled[^>]*data-local-check-again/,
	);
	assert.match(html, />Checking</);
	// The stale receipt is withheld while a new check runs.
	assert.doesNotMatch(html, /Checked at /);
});

test("D1: running with nothing pulled gives a copyable pull command", () => {
	const html = renderLocal({ diagnosis: { kind: "no_models" } });
	assert.match(html, /Ollama is running, but has no models yet/);
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
		diagnosis: { kind: "no_models" },
	});
	assert.match(other, /Load a model in LM Studio, then check again\./);
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
	// Dim until a refused press or a click into the box; then full ink.
	assert.match(html, /text-ink-muted/);
	assert.match(
		renderBlocked({ block: "no_provider", emphasis: true }),
		/data-emphasis="" [^>]*>|data-emphasis=""/,
	);
	const offline = renderBlocked({ block: "offline", busy: true });
	assert.match(offline, /Reconnecting…/);
	assert.match(
		offline,
		/data-send-recovery="reconnect"[^>]*disabled|disabled[^>]*data-send-recovery="reconnect"/,
	);
	assert.match(
		renderBlocked({
			block: "offline",
			outcome: "Still not responding · checked at 2:32:07 PM",
		}),
		/Still not responding · checked at 2:32:07 PM/,
	);
	assert.match(renderBlocked({ block: "no_model" }), />Choose a model</);
});

test("D4: the composer mounts the line for every block and a click into the box reaches it", () => {
	const source = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.match(
		source,
		/<SendBlockedLine block=\{sendBlock\} emphasis=\{noProviderHint\} \/>/,
	);
	assert.match(source, /if \(sendBlock\) explainRefusedSend\(\);/);
	// The plain-text hint users rage-clicked is gone.
	assert.doesNotMatch(
		source,
		/t\("ui\.chat\.composer_notes\.hint\.connect_provider"\)/,
	);
});
