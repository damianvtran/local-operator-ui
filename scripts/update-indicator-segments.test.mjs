/**
 * The quiet update indicator and the segment preference, executable.
 *
 *     node --test scripts/update-indicator-segments.test.mjs
 *
 * Issue #672 asked for two things that are one behaviour: the app's own periodic
 * "there is a new version" news must stop painting a card over the view, and a
 * person must be able to say how much of a version change is worth being told
 * about. Both are decisions about WHEN the app speaks, so what this file asserts
 * is the decision, driven three ways:
 *
 *   - the RULES (`segmentCrossed`) as pure units, because the cases that matter
 *     are the ones nobody sees: an unorderable version, a same-triple
 *     respelling, each of the three settings;
 *   - the GATE a store state answers (`quietOfferShown`), which is the same
 *     function the indicator and the tests call, so "the band is up" cannot mean
 *     one thing here and another in the app;
 *   - the WHOLE PATH in a real DOM: the shipped `UpdateNotification` mounted
 *     beside the shipped indicator, driven by the updater events the main
 *     process really emits - so "the indicator appears", "it stays away for a
 *     release below the followed segment", "deferral silences it" and "a press
 *     opens the card" are read off the rendered tree rather than off a claim.
 *
 * What is faked is the BRIDGE (`window.api.updater` / `window.api.systemInfo`)
 * and nothing else: the two stores, the component, the gate and `cn` are the
 * shipped ones. What this is NOT: evidence about pixels. jsdom has no layout
 * engine, so nothing here says the band sits where it should or that it clears
 * the contrast floors; those are the theme gate's and the frames' job
 * (`docs/evidence/update-reload-ux/`).
 *
 * Colours are asserted as ROLES and CLASSES, never as hexes - the same rule the
 * branding contract states, and the reason a palette edit must not be able to
 * break this file while a class edit must.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The DOM exists before React is imported: React DOM feature-detects at import
 * time (`canUseDOM`), and a React that decided it has no document renders
 * nothing and schedules nothing.
 */
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
/*
 * jsdom's own constructors are FORCED onto the global - Node defines `Event`,
 * `MouseEvent`, `navigator` and the rest itself, and a React tree whose events
 * are built from Node's classes fails inside the commit phase with an error that
 * reads like a component bug (Node also refuses the assignment outright for
 * `navigator`, which is a getter). The recipe is `agents-offer-dismiss.test.mjs`'s.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * A frame clock this harness owns, because jsdom without `pretendToBeVisual`
 * has none and the promotion above then assigns `undefined`: Radix's own
 * presence effects and sonner's observer both schedule through it, and a frame
 * that never runs is a state that never settles. Queued rather than run, so a
 * case is never racing a real clock - the cases below drain inside `act`.
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
};

/*
 * The stores persist through `localStorage`, and one of the cases below is ABOUT
 * what lands there (the preference persists; a notice does not). So a real
 * in-memory implementation, installed before the bundle imports the persist
 * middleware - a missing global would leave the store unpersisted and the case
 * silently meaningless.
 */
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => {
			storage.set(key, String(value));
		},
		removeItem: (key) => {
			storage.delete(key);
		},
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
	configurable: true,
	writable: true,
});

const ROOT = process.cwd();
const CACHE = join(ROOT, "node_modules/.cache/update-indicator-segments");

const bundle = await build({
	stdin: {
		contents: `
			export {
				UpdateQuietIndicator,
				UpdateQuietIndicatorView,
			} from "./src/renderer/src/shared/components/common/update-quiet-indicator";
			export {
				quietOfferShown,
				useUpdateNoticeStore,
			} from "./src/renderer/src/shared/store/update-notice-store";
			export {
				FollowedSegment,
				DEFAULT_FOLLOWED_SEGMENT,
				parseVersionTriple,
				segmentCrossed,
			} from "./src/renderer/src/shared/utils/update-segment";
			export {
				UpdateType,
				useDeferredUpdatesStore,
			} from "./src/renderer/src/shared/store/deferred-updates-store";
			export { UpdateNotification } from "./src/renderer/src/shared/components/common/update-notification";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// React and react-dom stay OUT of the bundle so the module under test uses this
	// process's own React - the one `createRoot` below is holding. A second bundled
	// copy would render a tree from a different React and quietly test nothing.
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": resolve("src/renderer/src/shared"),
		"@features": resolve("src/renderer/src/features"),
		"@renderer": resolve("src/renderer/src"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "update-indicator-segments.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);

const {
	DEFAULT_FOLLOWED_SEGMENT,
	FollowedSegment,
	UpdateNotification,
	UpdateQuietIndicator,
	UpdateQuietIndicatorView,
	UpdateType,
	parseVersionTriple,
	quietOfferShown,
	segmentCrossed,
	useDeferredUpdatesStore,
	useUpdateNoticeStore,
} = await import(`file://${bundlePath}`);

const { act } = await import("react");
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");

/* ------------------------------------------------------------------ harness */

/** The updater listeners the mounted component registered, by channel. */
let listeners = new Map();
/** The answer `systemInfo.getAppVersion` gives; the case sets it. */
let appVersion = "0.30.0";

const clearListeners = () => {
	listeners = new Map();
};

const register = (channel) => (callback) => {
	const set = listeners.get(channel) ?? new Set();
	set.add(callback);
	listeners.set(channel, set);
	return () => set.delete(callback);
};

/**
 * The bridge, and only the bridge.
 *
 * Every method `UpdateNotification` touches is here because the mount effect
 * registers all of them: a missing one throws inside the subscription and the
 * case would pass or fail for a reason that has nothing to do with the change.
 */
const installBridge = () => {
	const noop = async () => null;
	DOM.window.api = {
		openExternal: async () => undefined,
		showItemInFolder: () => undefined,
		systemInfo: { getAppVersion: async () => appVersion },
		updater: {
			onUpdateAvailable: register("update-available"),
			onUpdateNotAvailable: register("update-not-available"),
			onUpdateDownloaded: register("update-downloaded"),
			onUpdateProgress: register("update-progress"),
			onUpdateError: register("update-error"),
			onBackendUpdateAvailable: register("backend-update-available"),
			onBackendUpdateNotAvailable: register("backend-update-not-available"),
			onBackendUpdateCompleted: register("backend-update-completed"),
			onBackendUpdateProgress: register("backend-update-progress"),
			onBackendUpdateError: register("backend-update-error"),
			onBackendUpdateManualRequired: register("backend-update-manual-required"),
			onUpdateInstallBlocked: register("update-install-blocked"),
			onUpdateInstallFailed: register("update-install-failed"),
			onUpdateInstallInFlight: register("update-install-in-flight"),
			onUpdateInstallProgress: register("update-install-progress"),
			onUpdateInstallSucceeded: register("update-install-succeeded"),
			checkForUpdates: noop,
			checkForAllUpdates: noop,
			downloadUpdate: noop,
			updateBackend: async () => true,
			quitAndInstall: async () => true,
			quitForUpdateInstall: async () => true,
		},
	};
};

/** Fire one updater event at whatever has registered for it. */
const fire = async (channel, payload) => {
	await act(async () => {
		for (const callback of [...(listeners.get(channel) ?? [])])
			callback(payload);
	});
};

/**
 * Mount the shipped component beside the shipped indicator.
 *
 * Both halves, because the behaviour is a relationship between them: the notice
 * is raised by the component that receives the events and drawn by the band, and
 * a case that mounted only one of them could not observe the hand-off at all.
 */
/* The root of the last mount, so a case can take its tree down before the next
 * one resets the stores: a live React tree re-rendering from a store change made
 * outside `act` is an un-acted update warning, and a warning nobody can act on
 * is how a real one gets read past. */
let mountedRoot = null;

const mount = async () => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	mountedRoot = root;
	await act(async () => {
		root.render(
			/*
			 * `autoCheck: false`: the app's mount check is main's own business here, and
			 * a test that let it run would be asserting against a check whose answer the
			 * bridge does not have.
			 *
			 * Both halves in one tree, both the SHIPPED components: the notice is raised
			 * by the component that receives the events and drawn by the band, and a case
			 * that mounted only one of them could not observe the hand-off at all.
			 */
			React.createElement(
				React.Fragment,
				null,
				React.createElement(UpdateNotification, { autoCheck: false }),
				React.createElement(UpdateQuietIndicator, null),
			),
		);
	});
	// One more flush: `systemInfo.getAppVersion` resolves a promise, and the
	// running version must have landed before an offer is gated against it.
	await act(async () => {
		frame();
	});
	return container;
};

const indicatorBand = () => document.querySelector("[data-update-indicator]");
const indicatorButtons = () => [
	...document.querySelectorAll("[data-update-indicator-open]"),
];

const cardHeadings = () =>
	[...document.querySelectorAll("h2")].map((node) => node.textContent ?? "");

/** A fresh run: both stores back to their shipped defaults, DOM emptied. */
const reset = async () => {
	if (mountedRoot) {
		const root = mountedRoot;
		mountedRoot = null;
		await act(async () => {
			root.unmount();
		});
	}
	useUpdateNoticeStore.getState().resetNotices();
	useUpdateNoticeStore.setState({
		followed: {
			[UpdateType.UI]: DEFAULT_FOLLOWED_SEGMENT,
			[UpdateType.BACKEND]: DEFAULT_FOLLOWED_SEGMENT,
		},
		running: { [UpdateType.UI]: null, [UpdateType.BACKEND]: null },
	});
	useDeferredUpdatesStore.getState().clearDeferredUpdate(UpdateType.UI);
	useDeferredUpdatesStore.getState().clearDeferredUpdate(UpdateType.BACKEND);
	document.body.innerHTML = "";
	clearListeners();
	installBridge();
};

/* ------------------------------------------------------- the rules (pure) */

test("parseVersionTriple reads the triple and refuses everything else", () => {
	assert.deepEqual(parseVersionTriple("0.30.1"), [0, 30, 1]);
	assert.deepEqual(parseVersionTriple("v0.30.1"), [0, 30, 1]);
	// A suffix is part of the spelling, not a fourth number.
	assert.deepEqual(parseVersionTriple("0.30.1-beta.2"), [0, 30, 1]);
	assert.equal(parseVersionTriple("unknown"), null);
	assert.equal(parseVersionTriple("dev"), null);
	assert.equal(parseVersionTriple(""), null);
	assert.equal(parseVersionTriple(null), null);
	assert.equal(parseVersionTriple(undefined), null);
});

test("every release is news on patch, only a minor or major step on minor, only a major on major", () => {
	const cases = [
		// [followed, running, available, expected]
		[FollowedSegment.PATCH, "0.30.0", "0.30.1", true],
		[FollowedSegment.PATCH, "0.30.0", "0.31.0", true],
		[FollowedSegment.PATCH, "0.30.0", "1.0.0", true],
		[FollowedSegment.MINOR, "0.30.0", "0.30.1", false],
		[FollowedSegment.MINOR, "0.30.0", "0.31.0", true],
		[FollowedSegment.MINOR, "0.30.0", "1.0.0", true],
		[FollowedSegment.MAJOR, "0.30.0", "0.30.1", false],
		[FollowedSegment.MAJOR, "0.30.0", "0.31.0", false],
		[FollowedSegment.MAJOR, "0.30.0", "1.0.0", true],
		// A gap larger than one step still crosses the coarser segment.
		[FollowedSegment.MAJOR, "0.30.0", "2.1.3", true],
		[FollowedSegment.MINOR, "0.30.0", "1.0.0", true],
	];
	for (const [followed, running, available, expected] of cases) {
		assert.equal(
			segmentCrossed(followed, running, available),
			expected,
			`${followed}: ${running} -> ${available}`,
		);
	}
});

test("the same version, and a same-triple respelling, are not arrivals", () => {
	assert.equal(
		segmentCrossed(FollowedSegment.PATCH, "0.30.0", "0.30.0"),
		false,
	);
	assert.equal(
		segmentCrossed(FollowedSegment.PATCH, "0.30.0", "v0.30.0"),
		false,
		"a leading v is noise the app and the server disagree on",
	);
	assert.equal(
		segmentCrossed(FollowedSegment.PATCH, "0.30.0", "0.30.0-beta.2"),
		false,
		"the same triple with a pre-release suffix has not moved",
	);
});

test("an unorderable version is never a notify", () => {
	for (const followed of Object.values(FollowedSegment)) {
		assert.equal(
			segmentCrossed(followed, "unknown", "0.31.0"),
			false,
			`${followed}: an unread running version proves no crossing`,
		);
		assert.equal(
			segmentCrossed(followed, "0.30.0", "unknown"),
			false,
			`${followed}: an unread available version proves no crossing`,
		);
		assert.equal(
			segmentCrossed(followed, "dev-9f2a", "0.31.0"),
			false,
			`${followed}: a dev stamp proves no crossing`,
		);
	}
});

/* ------------------------------------------------ the gate (store state) */

test("the gate needs an offer, an orderable pair, a crossed segment and a closed detail", () => {
	const state = (over) => ({
		followed: {
			[UpdateType.UI]: FollowedSegment.PATCH,
			[UpdateType.BACKEND]: FollowedSegment.PATCH,
		},
		running: { [UpdateType.UI]: "0.30.0", [UpdateType.BACKEND]: "0.55.0" },
		offers: { [UpdateType.UI]: null, [UpdateType.BACKEND]: null },
		detailOpen: { [UpdateType.UI]: false, [UpdateType.BACKEND]: false },
		...over,
	});
	const withOffer = state({
		offers: {
			[UpdateType.UI]: { version: "0.30.1" },
			[UpdateType.BACKEND]: null,
		},
	});

	assert.equal(quietOfferShown(state({}), UpdateType.UI), false, "no offer");
	assert.equal(quietOfferShown(withOffer, UpdateType.UI), true);
	assert.equal(
		quietOfferShown(
			state({
				...withOffer,
				detailOpen: { [UpdateType.UI]: true, [UpdateType.BACKEND]: false },
			}),
			UpdateType.UI,
		),
		false,
		"the detail IS the notice, one step louder",
	);
	assert.equal(
		quietOfferShown(
			state({
				...withOffer,
				followed: {
					[UpdateType.UI]: FollowedSegment.MINOR,
					[UpdateType.BACKEND]: FollowedSegment.PATCH,
				},
			}),
			UpdateType.UI,
		),
		false,
		"a patch below a minor-following surface stays quiet",
	);
	assert.equal(
		quietOfferShown(
			state({
				...withOffer,
				running: { [UpdateType.UI]: "unknown", [UpdateType.BACKEND]: null },
			}),
			UpdateType.UI,
		),
		false,
		"an unread running version stays quiet",
	);
});

test("the preference persists and a notice does not", async () => {
	useUpdateNoticeStore
		.getState()
		.setFollowedSegment(UpdateType.BACKEND, FollowedSegment.MAJOR);
	useUpdateNoticeStore
		.getState()
		.noteQuietOffer(UpdateType.BACKEND, { version: "0.55.10" });
	// The middleware writes on the next tick of its own scheduler.
	await new Promise((resolve) => setTimeout(resolve, 0));

	const envelope = JSON.parse(storage.get("update-notice-storage") ?? "null");
	assert.ok(envelope, "the store did not persist at all");
	assert.equal(
		envelope.state.followed.backend,
		FollowedSegment.MAJOR,
		"the preference is what persists",
	);
	assert.equal(
		Object.hasOwn(envelope.state, "offers"),
		false,
		"a notice must not survive the process that raised it",
	);
	useUpdateNoticeStore
		.getState()
		.setFollowedSegment(UpdateType.BACKEND, DEFAULT_FOLLOWED_SEGMENT);
});

test("a stored value the app does not recognise falls back to the default", async () => {
	storage.set(
		"update-notice-storage",
		JSON.stringify({
			state: { followed: { ui: "patchy", backend: "major" } },
			version: 0,
		}),
	);
	await useUpdateNoticeStore.persist.rehydrate();
	assert.equal(
		useUpdateNoticeStore.getState().followed.ui,
		DEFAULT_FOLLOWED_SEGMENT,
		"an unknown segment must not reach the comparator",
	);
	assert.equal(
		useUpdateNoticeStore.getState().followed.backend,
		FollowedSegment.MAJOR,
		"a recognised one is kept",
	);
	await reset();
});

/* --------------------------------------------- the drawn indicator (pure) */

test("the indicator draws nothing at rest and one control per surface", () => {
	assert.equal(
		renderToStaticMarkup(
			UpdateQuietIndicatorView({ offers: [], onOpen: () => undefined }),
		),
		"",
		"nothing waiting must cost no pixels",
	);

	const markup = renderToStaticMarkup(
		UpdateQuietIndicatorView({
			offers: [
				{ type: UpdateType.UI, version: "0.31.0" },
				{ type: UpdateType.BACKEND, version: "0.55.10" },
			],
			onOpen: () => undefined,
		}),
	);
	assert.match(markup, /<output/, "the band is the status role itself");
	assert.match(markup, /App update 0\.31\.0/);
	assert.match(markup, /Server update 0\.55\.10/);
	assert.match(
		markup,
		/aria-label="App update 0\.31\.0 available\. Open release details\."/,
		"the accessible name begins with the visible text (label in name)",
	);
	// The interaction is a real button, and the focus ring is an outline rather
	// than a box-shadow ring the first `overflow: hidden` ancestor would clip.
	assert.match(markup, /focus-visible:outline-2/);
	assert.match(markup, /focus-visible:outline-accent/);
});

/* ----------------------------------------- the whole path in a real DOM */

test("an unsolicited release raises the quiet band, and a press opens the card", async () => {
	await reset();
	const container = await mount();

	await fire("update-available", {
		version: "0.31.0",
		releaseNotes: "Fixes.",
	});

	assert.ok(
		indicatorBand(),
		"the unsolicited release must be announced quietly",
	);
	assert.equal(indicatorButtons().length, 1);
	assert.match(
		container.textContent ?? "",
		/App update 0\.31\.0/,
		"the band names the version",
	);
	assert.equal(
		cardHeadings().includes("Update available"),
		false,
		"the fixed card must NOT paint over the view for the app's own news",
	);

	// The press is what opens the release detail: the card is one press behind the
	// indicator, never in front of the work.
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.ok(
		cardHeadings().includes("Update available"),
		"a press on the indicator opens the card",
	);
	assert.equal(indicatorBand(), null, "and the band yields to it");
});

test("a release below the followed segment stays quiet", async () => {
	await reset();
	useUpdateNoticeStore
		.getState()
		.setFollowedSegment(UpdateType.UI, FollowedSegment.MINOR);
	await mount();

	await fire("update-available", { version: "0.30.1", releaseNotes: "Patch." });

	assert.equal(
		indicatorBand(),
		null,
		"a patch release is not news to a minor-following surface",
	);
	assert.equal(
		cardHeadings().includes("Update available"),
		false,
		"and it is not a card either",
	);
});

test("an explicit check is still loud, even below the followed segment", async () => {
	await reset();
	useUpdateNoticeStore
		.getState()
		.setFollowedSegment(UpdateType.UI, FollowedSegment.MAJOR);
	await mount();
	await fire("update-available", { version: "0.30.1", releaseNotes: "Patch." });
	assert.equal(indicatorBand(), null, "the app's own news is gated");

	/*
	 * What the settings button does after a check it ran: the verdict said the app
	 * channel has something, so the detail opens. A person who pressed the button
	 * is told what the check found - the preference gates the app's unsolicited
	 * notices, never an answer to a question.
	 */
	await act(async () => {
		useUpdateNoticeStore.getState().openDetail(UpdateType.UI);
	});
	assert.ok(
		cardHeadings().includes("Update available"),
		"an explicit check reports what it finds",
	);
});

test("a deferred version is not raised at all", async () => {
	await reset();
	useDeferredUpdatesStore.getState().deferUpdate(UpdateType.UI, "0.31.0");
	await mount();

	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });

	assert.equal(
		indicatorBand(),
		null,
		"the deferral silences the indicator exactly as it silenced the card",
	);
	assert.equal(cardHeadings().includes("Update available"), false);
});

test("a server release raises the same band, and its own version", async () => {
	await reset();
	appVersion = "0.30.0";
	const container = await mount();

	await fire("backend-update-available", {
		latestVersion: "0.55.10",
		currentVersion: "0.55.9",
		runningVersion: "0.55.9",
		releaseNotes: "Server fixes.",
		canManageUpdate: true,
		updateCommand: "lop update",
		updateMethod: "global",
	});

	assert.ok(indicatorBand(), "the server surface is announced the same way");
	assert.match(container.textContent ?? "", /Server update 0\.55\.10/);
});

test("dismissing the card also takes the band away", async () => {
	await reset();
	const container = await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});

	const later = [...container.querySelectorAll("button")].find(
		(button) => (button.textContent ?? "").trim() === "Update later",
	);
	assert.ok(later, "the card offers its own dismissal");

	await act(async () => {
		later.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	assert.equal(indicatorBand(), null, "a waved-away notice is gone");
	assert.equal(cardHeadings().includes("Update available"), false);
	assert.equal(
		useDeferredUpdatesStore.getState().uiDeferredVersion,
		"0.31.0",
		"and the deferral is what keeps it gone",
	);
});

test("nothing is left behind: the file the store writes is the shipped envelope", () => {
	// A guard on the shape rather than a second copy of the assertions above: the
	// keys are what a future reader of `localStorage` sees, and the store's own
	// name is what a support engineer greps for.
	const source = readFileSync(
		join(ROOT, "src/renderer/src/shared/store/update-notice-store.ts"),
		"utf8",
	);
	assert.match(source, /name: "update-notice-storage"/);
	assert.match(
		source,
		/partialize: \(state\) => \(\{ followed: state\.followed \}\)/,
	);
});
