import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

// QA Q3 / reviewer M1: two surfaces read the SAME `DesktopControlError.status`
// and reached different conclusions from it. The providers grid asserted "The
// backend may need an update." for every error it did not recognise -- which
// included 401 and 403, where the compatibility banner says the opposite
// (restart and re-pair) and deliberately withholds its update button, because
// installing a newer backend cannot fix a bearer the running one refuses.
//
// Both selectors are bundled and CALLED here, so these assertions are about the
// shipped functions rather than a restatement of their logic. A local copy of
// the branching would stay green under mutation, which is exactly the hole this
// file exists to close.
const bundle = await build({
	stdin: {
		contents: `
			export { providerLoadErrorMessage } from "./src/renderer/src/features/providers/provider-labels";
			export {
				backendCompatibilityMessage,
				backendErrorKind,
				backendUpdateIsRemedy,
				BACKEND_ERROR_REMEDY,
			} from "./src/renderer/src/shared/api/local-operator/backend-error";
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
const {
	providerLoadErrorMessage,
	backendCompatibilityMessage,
	backendErrorKind,
	backendUpdateIsRemedy,
	BACKEND_ERROR_REMEDY,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The banner as the app renders it: nothing answered, so only the status speaks. */
function bannerMessage(error) {
	return backendCompatibilityMessage({
		kind: backendErrorKind(error),
		unpaired: false,
		missing: [],
		answered: false,
	});
}

// Every status the two surfaces can disagree about, including the fallback.
// 401 and 403 are the regression: they used to land on the update copy.
const STATUSES = [
	{ status: 404, kind: "outdated" },
	{ status: 503, kind: "unreachable" },
	{ status: null, kind: "unreachable" },
	{ status: 401, kind: "unauthorized" },
	{ status: 403, kind: "unauthorized" },
	{ status: 500, kind: "unknown" },
];

test("the grid and the banner agree on the remedy for every status", () => {
	for (const { status, kind } of STATUSES) {
		const error = new DesktopControlError(status, "probe");
		assert.equal(backendErrorKind(error), kind, `status ${status} classified`);

		const remedy = BACKEND_ERROR_REMEDY[kind];
		const grid = providerLoadErrorMessage(error);
		const banner = bannerMessage(error);

		// The two surfaces describe different scopes -- the grid speaks about
		// providers, the banner about the whole app -- so the agreement that
		// matters is the ACTION each one tells the user to take.
		if (remedy) {
			assert.ok(
				grid.includes(remedy),
				`status ${status}: grid "${grid}" omits the remedy "${remedy}"`,
			);
			assert.ok(
				banner.includes(remedy),
				`status ${status}: banner "${banner}" omits the remedy "${remedy}"`,
			);
		}

		// Neither surface may assert a remedy the other withholds. "Update" is the
		// one that cost a user a several-minute install for a fault it cannot fix.
		const updateIsRemedy = backendUpdateIsRemedy({
			kind,
			unpaired: false,
			answered: false,
		});
		const gridSaysUpdate = /update the backend|may need an update/i.test(grid);
		const bannerSaysUpdate = /update|older than the app expects/i.test(banner);
		assert.equal(
			gridSaysUpdate,
			updateIsRemedy,
			`status ${status}: grid "${grid}" disagrees with the update remedy`,
		);
		assert.equal(
			bannerSaysUpdate,
			updateIsRemedy,
			`status ${status}: banner "${banner}" disagrees with the update remedy`,
		);
	}
});

test("a rejected bearer is never told to install a newer backend", () => {
	// The specific defect: at 401 the grid sent the user through a backend
	// install while the banner told them to restart and re-pair.
	for (const status of [401, 403]) {
		const error = new DesktopControlError(status, "unauthorized");
		const grid = providerLoadErrorMessage(error);
		assert.match(grid, /Restart the app/);
		assert.doesNotMatch(grid, /update/i);
		assert.equal(
			backendUpdateIsRemedy({
				kind: backendErrorKind(error),
				unpaired: false,
				answered: false,
			}),
			false,
		);
	}
});

test("an unreachable backend is reported as offline, not as needing an update", () => {
	// `status: null` is what the transport raises when no backend was reached:
	// a rejected IPC call, a dead dev proxy, or the stalled-request deadline.
	const OFFLINE =
		"Providers could not be loaded. The backend is not answering. Retry once it has started.";
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
		"Providers could not be loaded. The backend may need an update. Update the backend and try again.",
	);
});

test("an unrecognised status asserts no remedy at all", () => {
	// The old fallback WAS the update sentence, so a 500 from a backend that is
	// running and current was answered with an install. A status we cannot
	// advise on must state the failure and stop.
	const grid = providerLoadErrorMessage(new DesktopControlError(500, "boom"));
	assert.equal(grid, "Providers could not be loaded.");
	assert.doesNotMatch(grid, /update|restart|retry/i);
});

test("both surfaces render the selected message rather than a hardcoded string", async () => {
	const grid = await readFile(
		"src/renderer/src/features/providers/provider-grid.tsx",
		"utf8",
	);
	// Guards against the component drifting back to a single literal, which
	// would leave the assertions above passing about code nothing renders.
	assert.ok(
		grid.includes("providerLoadErrorMessage(providers.error)"),
		"provider-grid no longer routes its error copy through providerLoadErrorMessage",
	);
	assert.ok(
		!grid.includes("may need an update"),
		"provider-grid still hardcodes the update copy",
	);

	const banner = await readFile(
		"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
		"utf8",
	);
	// The banner's own copy moved beside the classification so the two cannot
	// drift. Re-inlining a sentence here is how they disagreed in the first
	// place, and it would leave the agreement test above asserting nothing.
	assert.ok(
		banner.includes("backendCompatibilityMessage("),
		"the banner no longer routes its copy through backendCompatibilityMessage",
	);
	assert.ok(
		!banner.includes("older than the app expects"),
		"the banner re-inlined its copy instead of sharing the classification",
	);
});
