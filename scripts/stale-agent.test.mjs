import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// The status predicates and the selection store are pure (zustand runs
// outside React), so the stale-selection rule the chat page applies can be
// exercised here with the exact error shapes the desktop relay produces.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export * from "./src/renderer/src/shared/store/agent-selection-store";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	tsconfig: "tsconfig.web.json",
});
// zustand's persist middleware reads localStorage at store creation; give it
// a minimal one so the module loads the same way it does in the renderer.
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => storage.get(key) ?? null,
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};
globalThis.window = globalThis;
const {
	DesktopControlError,
	isAgentNotFound,
	isServerUnreachable,
	useAgentSelectionStore,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const notFound = new DesktopControlError(
	404,
	"Get agent execution history request failed: 404 Not Found",
);
const transportDown = new DesktopControlError(
	null,
	"Desktop controls could not reach the backend process.",
);
const relayDown = new DesktopControlError(
	503,
	"The backend could not complete this request.",
);
const refused = new DesktopControlError(401, "Desktop authorization is required.");

test("a 404 is 'agent gone', never 'server down'", () => {
	assert.equal(isAgentNotFound(notFound), true);
	assert.equal(isServerUnreachable(notFound), false);
});

test("a transport failure or 503 is 'server down', never 'agent gone'", () => {
	for (const error of [transportDown, relayDown]) {
		assert.equal(isServerUnreachable(error), true);
		assert.equal(isAgentNotFound(error), false);
	}
});

test("a refusal from a running server is neither", () => {
	assert.equal(isAgentNotFound(refused), false);
	assert.equal(isServerUnreachable(refused), false);
	// A bare Error (pre-typed callers) claims nothing either way.
	assert.equal(isAgentNotFound(new Error("404")), false);
	assert.equal(isServerUnreachable(new Error("Failed to fetch")), false);
});

/**
 * The rule chat-page.tsx applies in its effect: a persisted id that 404s is
 * dropped; a URL id that 404s is reported, not dropped.
 */
function resolveStaleSelection({ urlAgentId, error }) {
	const store = useAgentSelectionStore.getState();
	const effective = urlAgentId || store.getLastAgentId("chat");
	if (isAgentNotFound(error) && !urlAgentId && effective) {
		store.clearAgentFromAllPages(effective);
	}
	return useAgentSelectionStore.getState().getLastAgentId("chat");
}

test("persisted id that 404s is cleared; the page falls back to the list", () => {
	useAgentSelectionStore.getState().setLastChatAgentId("25f49075-stale");
	useAgentSelectionStore.getState().setLastAgentsPageAgentId("25f49075-stale");
	assert.equal(
		resolveStaleSelection({ urlAgentId: null, error: notFound }),
		null,
	);
	assert.equal(
		useAgentSelectionStore.getState().getLastAgentId("agents"),
		null,
	);
});

test("a genuine network failure keeps the selection so retry can succeed", () => {
	useAgentSelectionStore.getState().setLastChatAgentId("25f49075-live");
	assert.equal(
		resolveStaleSelection({ urlAgentId: null, error: transportDown }),
		"25f49075-live",
	);
});

test("an explicit URL to a missing agent is reported, not silently dropped", () => {
	useAgentSelectionStore.getState().setLastChatAgentId("25f49075-other");
	assert.equal(
		resolveStaleSelection({ urlAgentId: "does-not-exist", error: notFound }),
		"25f49075-other",
	);
});
