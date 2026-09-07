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
		// Matches the remedy's imperative and the diagnosis that licenses it. The
		// diagnosis lost its "may" hedge (design D9) and the noun is now "server"
		// everywhere (D7), so both spellings are the current shipped copy.
		const gridSaysUpdate =
			/update the server|older than this app expects/i.test(grid);
		const bannerSaysUpdate = /update|older than this app expects/i.test(banner);
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
	// The remedy names an action the USER can take. "Retry once it has started."
	// asked them to wait for an event they cannot cause, on the most common of
	// the five conditions, while the app starts the server itself (design D5).
	const OFFLINE =
		"Providers could not be loaded. The Local Operator server is not answering. Restart the app so it can start its own server.";
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
		"Providers could not be loaded. The Local Operator server is older than this app expects. Update the server and try again.",
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
	// The grid's Retry must reflect the in-flight refetch. Asserted on the
	// source because the flag is the whole finding: `isLoading` is false during
	// a refetch of an errored query, so a component that reached for it would
	// render an unchanged frame while passing any behavioural test that only
	// checked for a disabled attribute somewhere.
	assert.ok(
		grid.includes("providers.isFetching"),
		"provider-grid's Retry no longer reflects the in-flight refetch",
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
		!banner.includes("older than this app expects"),
		"the banner re-inlined its copy instead of sharing the classification",
	);
});

test("no surface asks the user to wait for an event they cannot cause", () => {
	// Design D5. Every remedy must name a user action; "Retry once it has
	// started" named an event with no agent, on the most common condition of the
	// five, while the unauthorized string beside it says the app starts the
	// server itself. `unknown` is the deliberate empty: no established remedy,
	// so no sentence at all.
	for (const [kind, remedy] of Object.entries(BACKEND_ERROR_REMEDY)) {
		if (kind === "unknown") {
			assert.equal(remedy, "", "unknown must assert no remedy");
			continue;
		}
		assert.match(
			remedy,
			/^(Restart|Update) /,
			`the ${kind} remedy "${remedy}" does not open with an action the user takes`,
		);
	}
});

test("one process, one name: no shipped sentence calls it 'the backend'", () => {
	// Design D7. Three names for one process, two of them on screen together --
	// the connectivity banner says "The server", these said "the backend". A PR
	// whose purpose is that two surfaces stop contradicting each other must not
	// leave them naming the subject differently in one viewport. "backend"
	// survives only on the update BUTTON, which names an installable artifact.
	const sentences = [
		...Object.values(BACKEND_ERROR_REMEDY),
		...STATUSES.map(({ status }) =>
			bannerMessage(new DesktopControlError(status, "probe")),
		),
		...STATUSES.map(({ status }) =>
			providerLoadErrorMessage(new DesktopControlError(status, "probe")),
		),
		backendCompatibilityMessage({
			kind: "unknown",
			unpaired: true,
			missing: [],
			answered: true,
		}),
		backendCompatibilityMessage({
			kind: "unknown",
			unpaired: false,
			missing: ["settings"],
			answered: true,
		}),
	];
	for (const sentence of sentences) {
		assert.doesNotMatch(
			sentence,
			/backend/i,
			`"${sentence}" still calls the server "backend"`,
		);
	}
});

test("the outdated banner sentence has no dangling referent", () => {
	// Design D4: extracting the remedy into the shared trailing sentence left
	// "stay off until then" pointing at nothing -- the sentence before it names
	// no time and no event. The consequence is now bound to the diagnosis.
	const banner = bannerMessage(new DesktopControlError(404, "no route"));
	assert.doesNotMatch(banner, /until then/);
	assert.match(banner, /older than this app expects, so /);
	assert.ok(banner.endsWith(BACKEND_ERROR_REMEDY.outdated));
});
