import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

// QA finding Q3: the providers grid asserted "The backend may need an update."
// for EVERY load error, including a backend that is simply not running. That
// sends the user to a several-minute backend install that cannot fix an
// unreachable process.
//
// The selection now lives in `providerLoadErrorMessage`, which this test
// bundles and calls directly -- asserting the real shipped function rather than
// a restatement of its logic, so removing the branch fails these tests.
const bundle = await build({
	stdin: {
		contents: `
			export { providerLoadErrorMessage } from "./src/renderer/src/features/providers/provider-labels";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's `@shared` alias is a tsconfig path, not a node resolution.
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const { providerLoadErrorMessage, DesktopControlError } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const OFFLINE =
	"Providers could not be loaded. The backend is not answering. Retry once it has started.";
const UPDATE = "Providers could not be loaded. The backend may need an update.";

test("an unreachable backend is reported as offline, not as needing an update", () => {
	// `status: null` is what the transport raises when no backend was reached:
	// a rejected IPC call, a dead dev proxy, or the stalled-request deadline.
	assert.equal(
		providerLoadErrorMessage(new DesktopControlError(null, "unreachable")),
		OFFLINE,
	);
	// 503 is the main process's own "could not complete this request", which is
	// what a backend that is down or refusing work answers with.
	assert.equal(
		providerLoadErrorMessage(new DesktopControlError(503, "down")),
		OFFLINE,
	);
	// A non-typed failure carries no status and must not claim an update fixes it.
	assert.equal(providerLoadErrorMessage(new Error("boom")), OFFLINE);
});

test("a capability-missing backend is the only case told to update", () => {
	// 404 means the route is absent, so this backend predates the desktop
	// contract. That is the one state a backend update actually repairs.
	assert.equal(
		providerLoadErrorMessage(new DesktopControlError(404, "no route")),
		UPDATE,
	);
	// An unexpected status keeps the generic sentence rather than guessing.
	assert.equal(
		providerLoadErrorMessage(new DesktopControlError(500, "boom")),
		UPDATE,
	);
});

test("the grid renders the selected message rather than a hardcoded string", async () => {
	const source = await readFile(
		"src/renderer/src/features/providers/provider-grid.tsx",
		"utf8",
	);
	// Guards against the component drifting back to a single literal, which
	// would leave the assertions above passing about code nothing renders.
	assert.ok(
		source.includes("providerLoadErrorMessage(providers.error)"),
		"provider-grid no longer routes its error copy through providerLoadErrorMessage",
	);
	assert.ok(
		!source.includes(UPDATE),
		"provider-grid still hardcodes the update copy",
	);
});
