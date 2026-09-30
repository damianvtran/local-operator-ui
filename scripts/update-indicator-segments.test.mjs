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
			export { CheckForUpdatesButton } from "./src/renderer/src/shared/components/common/check-for-updates-button";
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
	/*
	 * `CheckForUpdatesButton` short-circuits to a "not checked in development mode"
	 * info sentence when `import.meta.env.DEV` is true, and esbuild leaves
	 * `import.meta.env` undefined without this define - so the settings control the
	 * R1 case mounts would answer the wrong branch (or throw) rather than run the
	 * check under test. The rig is a PRODUCTION build for the same reason the
	 * Storybook rigs are (`DEV=false`): the check the button runs is the subject.
	 */
	define: { "import.meta.env.DEV": "false" },
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
	CheckForUpdatesButton,
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
			/*
			 * The settings control (`CheckForUpdatesButton`) subscribes to two channels
			 * `UpdateNotification` does not, and a missing one throws inside its own
			 * subscription - a case failing for a reason that has nothing to do with the
			 * wiring under test (the R1 case mounts that control).
			 */
			onBackendUpdateDevMode: register("backend-update-dev-mode"),
			onUpdateNpxAvailable: register("update-npx-available"),
			getLastInstallAttempt: async () => null,
			checkForUpdates: async () => {
				const verdict = checkScript();
				if (verdict.app === "available") emit("update-available", APP_OFFER);
				else emit("update-not-available", { version: appVersion });
				return { updateInfo: {}, cancellationToken: null };
			},
			checkForAllUpdates: async () => {
				const verdict = checkScript();
				if (verdict.app === "available") emit("update-available", APP_OFFER);
				else emit("update-not-available", { version: appVersion });
				if (verdict.server === "available")
					emit("backend-update-available", SERVER_OFFER);
				else
					emit("backend-update-not-available", {
						version: SERVER_OFFER.latestVersion,
						runningVersion: SERVER_OFFER.runningVersion,
					});
				return verdict;
			},
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
 * Emit one event WITHOUT `act`, for use from inside a check.
 *
 * The bridge's own checks are called from inside a React event handler (a button's
 * press), which is already inside `act`; nesting another `act` there would be a
 * second commit boundary inside one interaction. The listeners are called
 * synchronously, exactly as `webContents.send` delivers them.
 */
const emit = (channel, payload) => {
	for (const callback of [...(listeners.get(channel) ?? [])]) callback(payload);
};

/**
 * What an explicit check answers, and the events main emits for that answer.
 *
 * A CHECK THE USER PRESSED, AS MAIN REALLY ANSWERS IT: the invoke returns the
 * verdict, and before it resolves main has sent each channel's own event -
 * `update-available`/`update-not-available` on the app channel,
 * `backend-update-available`/`-not-available` on the server's. The offers are
 * therefore raised where the app raises them, which is what makes these cases
 * evidence about the wiring rather than about a fixture.
 */
let checkScript = () => ({
	app: "current",
	server: "current",
	affirmation: null,
});

const APP_OFFER = { version: "0.31.0", releaseNotes: "Fixes." };
const SERVER_OFFER = {
	latestVersion: "0.55.10",
	currentVersion: "0.55.9",
	runningVersion: "0.55.9",
	releaseNotes: "Server fixes.",
	canManageUpdate: true,
	updateCommand: "lop update",
	updateMethod: "global",
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
/*
 * "Nothing waiting" is now asked of the CONTROLS rather than of the region (review
 * R4): the `<output>` is mounted empty at rest, deliberately, so a case that asked
 * whether the region exists would be asking the wrong question. The band's own box
 * is what is conditional - the view's own case above pins that it carries no
 * classes at rest.
 */
const bandIsQuiet = () =>
	indicatorBand() !== null && indicatorButtons().length === 0;

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
	checkScript = () => ({
		app: "current",
		server: "current",
		affirmation: null,
	});
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

test("patch is every release, minor starts at the minor position, and 0.x puts the breaking step on the minor", () => {
	const cases = [
		// [followed, running, available, expected]
		[FollowedSegment.PATCH, "0.30.0", "0.30.1", true],
		[FollowedSegment.PATCH, "0.30.0", "0.31.0", true],
		[FollowedSegment.PATCH, "0.30.0", "1.0.0", true],
		[FollowedSegment.MINOR, "0.30.0", "0.30.1", false],
		[FollowedSegment.MINOR, "0.30.0", "0.31.0", true],
		[FollowedSegment.MINOR, "0.30.0", "1.0.0", true],
		/*
		 * THE 0.x READING OF THE BREAKING STEP (reviews R7, U7). npm's caret range
		 * says `^0.31.0` allows `0.31.4` and not `0.32.0`, so on a 0.x product the
		 * leading non-zero segment is the SECOND one and a minor-position move IS the
		 * breaking step. "Breaking changes only" was a mute switch for the whole 0.x
		 * era without this: every release the product can publish was withheld while
		 * the label read like an ordinary filter.
		 */
		[FollowedSegment.MAJOR, "0.30.0", "0.30.1", false],
		[FollowedSegment.MAJOR, "0.30.0", "0.31.0", true],
		[FollowedSegment.MAJOR, "0.31.1", "0.31.2", false],
		[FollowedSegment.MINOR, "0.31.1", "0.31.2", false],
		[FollowedSegment.PATCH, "0.31.1", "0.31.2", true],
		[FollowedSegment.MAJOR, "0.31.0", "0.32.0", true],
		[FollowedSegment.MINOR, "0.31.0", "0.32.0", true],
		/* 0.x -> 1.0 moves the FIRST position, so it is a step on every reading. */
		[FollowedSegment.MAJOR, "0.30.0", "1.0.0", true],
		[FollowedSegment.MINOR, "0.30.0", "1.0.0", true],
		[FollowedSegment.PATCH, "0.30.0", "1.0.0", true],
		/* Past 1.0 the first position is the breaking step again. */
		[FollowedSegment.MAJOR, "1.2.3", "1.3.0", false],
		[FollowedSegment.MAJOR, "1.2.3", "2.0.0", true],
		[FollowedSegment.MINOR, "1.2.3", "1.2.4", false],
		[FollowedSegment.MINOR, "1.2.3", "1.3.0", true],
		[FollowedSegment.PATCH, "1.2.3", "1.2.4", true],
		// A gap larger than one step still crosses the coarser segment.
		[FollowedSegment.MAJOR, "0.30.0", "2.1.3", true],
	];
	for (const [followed, running, available, expected] of cases) {
		assert.equal(
			segmentCrossed(followed, running, available),
			expected,
			`${followed}: ${running} -> ${available}`,
		);
	}
});

/*
 * AN OLDER OFFER IS NOT AN ARRIVAL (review R6), on any setting.
 *
 * The gate used to ask "is there a difference at this segment", and a difference
 * is symmetric, so `available` BELOW `running` announced itself. The header's
 * defence ("the offer only exists when main found a newer version") is a property
 * of the app channel and not of the server's: there `running` is the daemon's own
 * reading against a `latestVersion` main compared against the INSTALLED version,
 * so an offer can sit below the running build. Equal triples are the same case one
 * step further: nothing arrived.
 */
test("an offer at or below the running version is not an arrival", () => {
	for (const followed of Object.values(FollowedSegment)) {
		assert.equal(
			segmentCrossed(followed, "0.30.0", "0.29.9"),
			false,
			`${followed}: an older offer is not news`,
		);
		assert.equal(
			segmentCrossed(followed, "1.2.3", "1.2.2"),
			false,
			`${followed}: an older PATCH is not news`,
		);
		assert.equal(
			segmentCrossed(followed, "0.30.0", "0.30.0"),
			false,
			`${followed}: an equal version is not news`,
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

test("the indicator draws no band at rest and one control per surface", () => {
	/*
	 * THE REGION IS MOUNTED, THE BAND IS NOT (review R4). A polite live region is
	 * announced when its CONTENT CHANGES and unreliably when it arrives already
	 * populated, so the element is always there and only its contents and its box
	 * are conditional - which is what keeps "nothing waiting costs no pixels" true
	 * while the announcement becomes reliable.
	 */
	const atRest = renderToStaticMarkup(
		UpdateQuietIndicatorView({ offers: [], onOpen: () => undefined }),
	);
	assert.match(atRest, /<output/, "the live region is mounted at rest");
	assert.match(atRest, /data-update-indicator-count="0"/);
	assert.doesNotMatch(atRest, /<button/, "with nothing to press");
	assert.doesNotMatch(
		atRest,
		/h-7|bg-surface|border-t|px-2/,
		"and no box, ground or hairline that could paint a pixel",
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
	assert.match(markup, /Application update 0\.31\.0 available/);
	assert.match(markup, /Server update 0\.55\.10 available/);
	assert.match(
		markup,
		/aria-label="Application update 0\.31\.0 available\. Open release details\."/,
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
		/Application update 0\.31\.0 available/,
		"the band states the release is available, not merely its number",
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
	assert.equal(
		bandIsQuiet(),
		true,
		"and the band yields to it - the detail IS the notice",
	);
});

test("a release below the followed segment stays quiet", async () => {
	await reset();
	useUpdateNoticeStore
		.getState()
		.setFollowedSegment(UpdateType.UI, FollowedSegment.MINOR);
	await mount();

	await fire("update-available", { version: "0.30.1", releaseNotes: "Patch." });

	assert.equal(
		bandIsQuiet(),
		true,
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
	assert.equal(bandIsQuiet(), true, "the app's own news is gated");

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
		bandIsQuiet(),
		true,
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
	assert.match(
		container.textContent ?? "",
		/Server update 0\.55\.10 available/,
	);
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
	assert.equal(bandIsQuiet(), true, "a waved-away notice is gone");
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

/* ------------------------------- the loud step, at every entry point (R1, R2) */

/*
 * WHY THESE ASSERT THE STORE AND NOT THE CARD. The card renders on
 * `detailOpen` plus the offer, so a case that looked only for the heading would
 * pass for a card some OTHER path opened - which is exactly how the wiring went
 * unpinned in round 1 (review R1: deleting the two `openDetail` lines from
 * `check-for-updates-button.tsx` left every case green). `detailOpened()` is the
 * fact the entry point has to move.
 */
const detailOpened = () => useUpdateNoticeStore.getState().detailOpen;

/** Mount just the settings control - the R1 case's subject. */
const mountSettings = async () => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	mountedRoot = root;
	await act(async () => {
		root.render(
			React.createElement(CheckForUpdatesButton, { appVersion: "0.30.0" }),
		);
	});
	await act(async () => {
		frame();
	});
	return container;
};

/** Press the control whose visible text is exactly `label`. */
const press = async (label) => {
	const button = [...document.querySelectorAll("button")].find(
		(candidate) => (candidate.textContent ?? "").trim() === label,
	);
	assert.ok(button, `a control reading "${label}"`);
	await act(async () => {
		button.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	return button;
};

/** Press the control whose ACCESSIBLE NAME is `label` (an icon-only control). */
const pressLabelled = async (label) => {
	/*
	 * `button[aria-label=...]`, not `[aria-label=...]`: the release card's own
	 * container is a focus target and carries the same words on no node of its own,
	 * but a caller may label a wrapper - and `querySelector` would then hand back a
	 * node with no handler on it, a case that presses nothing and reads as a defect.
	 */
	const button = document.querySelector(`button[aria-label="${label}"]`);
	assert.ok(button, `a control named "${label}"`);
	await act(async () => {
		button.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	return button;
};

test("R1: the settings check opens the release detail for what it found", async () => {
	await reset();
	await mountSettings();
	checkScript = () => ({
		app: "available",
		server: "current",
		affirmation: null,
	});
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.UI],
		true,
		"a press on Check for updates is answered by the card, whatever the segment",
	);

	await reset();
	await mountSettings();
	checkScript = () => ({
		app: "current",
		server: "available",
		affirmation: null,
	});
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		true,
		"and the server channel's own answer opens the server card",
	);
	assert.equal(
		detailOpened()[UpdateType.UI],
		false,
		"while a channel that found nothing opens nothing",
	);
});

test("R2: the failure panel's Check for updates opens the detail", async () => {
	await reset();
	await mount();
	checkScript = () => ({
		app: "available",
		server: "current",
		affirmation: null,
	});
	await fire("update-install-failed", {
		message: "The install did not finish.",
		remedy: { text: "Free some space, then try again.", url: "https://x.test" },
		targetVersion: "0.31.0",
	});
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.UI],
		true,
		"the press that supersedes the failure notice must answer with the offer",
	);
});

test("R2: installBlocked's Check for updates opens the detail", async () => {
	await reset();
	await mount();
	checkScript = () => ({
		app: "available",
		server: "current",
		affirmation: null,
	});
	await fire("update-install-blocked", {
		message: "The update was not installed.",
		remedy: { text: "Free some space, then try again." },
	});
	await press("Check for updates");
	assert.equal(detailOpened()[UpdateType.UI], true);
});

test("R2: the error toast's retry opens the detail", async () => {
	await reset();
	await mount();
	checkScript = () => ({
		app: "available",
		server: "current",
		affirmation: null,
	});
	await fire("update-error", "net::ERR_INTERNET_DISCONNECTED");
	await press("Try again");
	assert.equal(detailOpened()[UpdateType.UI], true);
});

test("R2: the by-hand panel's check opens the server detail", async () => {
	await reset();
	await mount();
	checkScript = () => ({
		app: "current",
		server: "available",
		affirmation: null,
	});
	await fire("backend-update-manual-required", {
		latestVersion: "0.55.10",
		currentVersion: "0.55.9",
		installVersion: "0.55.10",
		message: "This server is not one the app can update.",
		appOwned: false,
		updateCommand: "pip install -U local-operator",
	});
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		true,
		"the check the panel's own copy tells the reader to run reports what it found",
	);
});

test("R2: the offer card's own check (the manual arm) keeps the detail up", async () => {
	await reset();
	await mount();
	/*
	 * THE MANUAL ARM, because it is the only one this card draws a check control
	 * on (the managed arm answers with `Update server`): the panel is the app's own
	 * refusal to install a server it does not own, and its closing sentence sends
	 * the reader to the check. `manual`/`appOwned: false` is what makes that arm.
	 */
	await fire("backend-update-available", {
		...SERVER_OFFER,
		manual: true,
		canManageUpdate: false,
		appOwned: false,
	});
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	checkScript = () => ({
		app: "current",
		server: "available",
		affirmation: null,
	});
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		true,
		"the card the check was pressed from is the card its answer belongs to",
	);
	assert.ok(
		cardHeadings().includes("Server update available"),
		"and it is still drawn rather than blanked by its own press",
	);
});

/* --------------------------------- the card's own exits and hand-back (U1-U4) */

test("U1/U2: Escape closes the press-opened card and hands focus back to the band", async () => {
	await reset();
	const container = await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.ok(
		cardHeadings().includes("Update available"),
		"the press opens the card",
	);

	const card = container.querySelector("[data-release-detail]");
	assert.ok(card, "the detail is the card that carries the close control");
	assert.equal(
		document.activeElement === card,
		true,
		"focus moves INTO the card on a press-open (review U2)",
	);
	/*
	 * U3 in the same frame: the card IS the answer to the press, so the offer's own
	 * "A new update is available" toast must not ride in beside it.
	 */
	assert.equal(
		(document.body.textContent ?? "").includes("A new update is available"),
		false,
		"the card is the answer, so the toast that says the same thing is suppressed",
	);

	await act(async () => {
		card.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			}),
		);
	});
	assert.equal(
		detailOpened()[UpdateType.UI],
		false,
		"Escape is the exit that is not a decision (review U1)",
	);
	assert.equal(
		bandIsQuiet(),
		false,
		"and the band's own item comes back, which is also the proof that no deferral was recorded",
	);
	assert.equal(
		document.activeElement?.getAttribute("data-update-indicator-open"),
		UpdateType.UI,
		"focus is handed back to the landmark the press came from",
	);
});

test("U1: the visible close control is the same exit", async () => {
	await reset();
	await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	await pressLabelled("Close app update details");
	assert.equal(
		detailOpened()[UpdateType.UI],
		false,
		"the control closes the card",
	);
	assert.equal(bandIsQuiet(), false, "and leaves the quiet notice behind");
});

test("U4: pressing the other surface switches the card rather than doing nothing", async () => {
	await reset();
	await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await fire("backend-update-available", SERVER_OFFER);
	assert.equal(indicatorButtons().length, 2, "both surfaces are offered");

	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.ok(cardHeadings().includes("Update available"));

	const server = indicatorButtons().find(
		(button) =>
			button.getAttribute("data-update-indicator-open") === UpdateType.BACKEND,
	);
	assert.ok(server, "the other surface's item is still in the band");
	await act(async () => {
		server.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	assert.ok(
		cardHeadings().includes("Server update available"),
		"the press shows what it pressed instead of leaving the app card up",
	);
	assert.equal(
		indicatorButtons().length,
		1,
		"and the surface that gave way keeps its offer in the band",
	);
	assert.equal(
		indicatorButtons()[0].getAttribute("data-update-indicator-open"),
		UpdateType.UI,
	);
});

/* ------------------------------------- the aggressive check's own loud step (R9) */

/**
 * The by-hand panel, which is one of the two routes that call the AGGREGATE
 * check (`checkForAllUpdates`) - the other is the server offer card's own
 * control. Its copy tells the reader to run the check, so it is the honest way
 * into the path whose verdict lines these cases are about.
 */
const fireManualRequiredPanel = () =>
	fire("backend-update-manual-required", {
		latestVersion: "0.55.10",
		currentVersion: "0.55.9",
		installVersion: "0.55.10",
		message: "This server is not one the app can update.",
		appOwned: false,
		updateCommand: "pip install -U local-operator",
	});

test("R9: a verdict does not open a card for an offer the app is not holding", async () => {
	await reset();
	await mount();
	/*
	 * THE USER ALREADY ANSWERED THIS RELEASE with "Update later": a deferral is
	 * recorded and the surface is cleared, which is the state every later check's
	 * verdict is read in - and the verdict still says `available`, because the
	 * deferral lives on THIS side and main's check knows nothing about it.
	 */
	await fire("backend-update-available", SERVER_OFFER);
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.ok(
		cardHeadings().includes("Server update available"),
		"the offer's card is up for the press",
	);
	await press("Update later");
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		false,
		"the dismissal closes the card it was on",
	);
	assert.equal(bandIsQuiet(), true, "and takes the band's item with it");

	/*
	 * Now the by-hand panel arrives and the reader presses its check. The check's
	 * own `backend-update-available` event is the one that would re-record an
	 * offer, and the deferral is what stops it - so the surface holds no offer
	 * while the verdict reads `available`.
	 */
	await fireManualRequiredPanel();
	checkScript = () => ({
		app: "current",
		server: "available",
		affirmation: null,
	});
	assert.equal(
		useUpdateNoticeStore.getState().offers[UpdateType.BACKEND],
		null,
		"the premise: the surface holds no offer for the deferred release",
	);
	await press("Check for updates");
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		false,
		"a verdict is not licence to open a card for a surface holding no offer",
	);
});

test("R9: a check that finds both channels opens one card and leaves the other in the band", async () => {
	await reset();
	await mount();
	/*
	 * THE SERVER OFFER CARD'S OWN CHECK, which is the other route into the
	 * aggregate (the by-hand panel is the first). A card rather than a panel is
	 * deliberate here: the by-hand panel is ABOVE both offer cards in the same
	 * early-return chain, so a case that left it up could not observe what paints.
	 */
	await fire("backend-update-available", {
		...SERVER_OFFER,
		manual: true,
		canManageUpdate: false,
		appOwned: false,
	});
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	assert.ok(
		cardHeadings().includes("Server update available"),
		"the press opens the card whose check control this case drives",
	);

	checkScript = () => ({
		app: "available",
		server: "available",
		affirmation: null,
	});
	await press("Check for updates");
	const open = detailOpened();
	/*
	 * ONE CARD, NOT TWO QUEUED BEHIND EACH OTHER. Both cards are
	 * `fixed top-4 right-4 z-50` in one early-return chain, so opening both showed
	 * one and QUEUED the other: closing the first revealed the second, which is a
	 * card the reader never asked for.
	 */
	assert.equal(
		[open[UpdateType.UI], open[UpdateType.BACKEND]].filter(Boolean).length,
		1,
		"exactly one surface holds the detail",
	);
	assert.equal(
		cardHeadings().filter((heading) => heading.includes("available")).length,
		1,
		"and exactly one card paints",
	);
	assert.equal(
		indicatorButtons().length,
		1,
		"the surface that gave way keeps its offer in the band",
	);
	assert.equal(
		indicatorButtons()[0].getAttribute("data-update-indicator-open"),
		open[UpdateType.UI] ? UpdateType.BACKEND : UpdateType.UI,
		"and the item in the band is the surface whose card is NOT up",
	);
});

test("R10/U11: the hand-back returns to the surface the press came from, not the first item", async () => {
	await reset();
	await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await fire("backend-update-available", SERVER_OFFER);
	assert.equal(indicatorButtons().length, 2, "both surfaces are offered");

	const server = indicatorButtons().find(
		(button) =>
			button.getAttribute("data-update-indicator-open") === UpdateType.BACKEND,
	);
	assert.ok(server, "the server's item is in the band");
	await act(async () => {
		server.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	assert.ok(cardHeadings().includes("Server update available"));

	const card = document.querySelector("[data-release-detail]");
	assert.ok(card, "the press opens a card");
	await act(async () => {
		card.dispatchEvent(
			new DOM.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.equal(
		document.activeElement?.getAttribute("data-update-indicator-open"),
		UpdateType.BACKEND,
		"focus returns to the SERVER item, the landmark the press came from",
	);
});

/*
 * A SWITCH IS NOT A CLOSE (UX round 3, U13). The hand-back compared the two
 * open-sets and treated "the other surface's detail is no longer open" as a close,
 * so pressing the second band item opened its card and then moved focus OUT of it
 * onto the item of the surface just left. Both directions, because the bug is in
 * the set arithmetic and a one-directional case would pass a fix that special-cased
 * the app surface.
 */
for (const [from, to] of [
	[UpdateType.UI, UpdateType.BACKEND],
	[UpdateType.BACKEND, UpdateType.UI],
]) {
	test(`U13: switching the card ${from} -> ${to} keeps focus in the card`, async () => {
		await reset();
		await mount();
		await fire("update-available", {
			version: "0.31.0",
			releaseNotes: "Fixes.",
		});
		await fire("backend-update-available", SERVER_OFFER);
		const item = (type) =>
			indicatorButtons().find(
				(button) => button.getAttribute("data-update-indicator-open") === type,
			);
		await act(async () => {
			item(from).dispatchEvent(
				new DOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		await act(async () => {
			item(to).dispatchEvent(
				new DOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		const card = document.querySelector("[data-release-detail]");
		assert.ok(card, "the pressed surface's card is up");
		assert.equal(
			detailOpened()[to],
			true,
			"the detail moved to the surface that was pressed",
		);
		assert.ok(
			card.contains(document.activeElement),
			`focus stays inside the card the press opened, not ${document.activeElement?.outerHTML.slice(0, 80)}`,
		);
	});
}

test("R14: a settings check that finds both channels opens one card, not two", async () => {
	await reset();
	await mountSettings();
	checkScript = () => ({
		app: "available",
		server: "available",
		affirmation: null,
	});
	await press("Check for updates");
	const open = detailOpened();
	/*
	 * THE THIRD ROUTE TO THE SAME OUTCOME as R9(b): the settings button called the
	 * store's `openDetail` for each channel, so both flags were set and the second
	 * card was queued behind the first. The invariant lives in the store now, so the
	 * assertion is on the store's own state and holds for any caller.
	 */
	assert.equal(
		[open[UpdateType.UI], open[UpdateType.BACKEND]].filter(Boolean).length,
		1,
		"exactly one surface holds the detail",
	);
	assert.equal(
		open[UpdateType.BACKEND],
		true,
		"and the last one the check opened holds it, as the band's press does",
	);
});

test("U12: the close control is not inside the card's scrolling box", async () => {
	await reset();
	const container = await mount();
	await fire("backend-update-available", SERVER_OFFER);
	await act(async () => {
		indicatorButtons()[0].dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
	const card = container.querySelector("[data-release-detail]");
	assert.ok(card, "the server card is up");
	assert.doesNotMatch(
		(card.className ?? "").toString(),
		/overflow-y-auto/,
		"the card itself no longer scrolls, so nothing positioned against it can travel",
	);
	const scroller = card.querySelector("[data-release-detail-scroll]");
	assert.ok(scroller, "the scrolling box is its own element");
	assert.match(
		(scroller.className ?? "").toString(),
		/overflow-y-auto/,
		"and it is the one that scrolls",
	);
	const close = card.querySelector(
		'button[aria-label="Close server update details"]',
	);
	assert.ok(close, "the card carries its visible exit");
	/*
	 * STRUCTURAL, because jsdom lays nothing out: an abspos child of a scroll
	 * container scrolls WITH it, so "outside the scroller" is the property that
	 * keeps the exit reachable however far the notes are scrolled - measured in a
	 * real browser as `beforeY 24 (visible) -> afterY -20 (NOT visible)` before the
	 * split (review U12).
	 */
	assert.equal(
		scroller.contains(close),
		false,
		"so the exit cannot scroll out of reach with the release notes",
	);
});

/* ------------------------------------------- the store cannot outlive the answer */

test("R3: a not-available answer clears the detail with the offer, on both channels", async () => {
	await reset();
	await mount();
	await fire("update-available", { version: "0.31.0", releaseNotes: "Fixes." });
	await act(async () => {
		useUpdateNoticeStore.getState().openDetail(UpdateType.UI);
	});
	assert.equal(detailOpened()[UpdateType.UI], true);
	await fire("update-not-available", { version: "0.31.0" });
	assert.equal(
		detailOpened()[UpdateType.UI],
		false,
		"the answer to the question closes the card it opened",
	);
	assert.equal(cardHeadings().length, 0);

	await reset();
	await mount();
	await fire("backend-update-available", SERVER_OFFER);
	await act(async () => {
		useUpdateNoticeStore.getState().openDetail(UpdateType.BACKEND);
	});
	assert.equal(detailOpened()[UpdateType.BACKEND], true);
	/*
	 * NO `runningVersion` IN THIS PAYLOAD, deliberately: a readable one that differs
	 * from the install is the SKEW notice's own arm, and its panel would put a
	 * heading on screen for a reason this case is not about.
	 */
	await fire("backend-update-not-available", { version: "0.55.10" });
	assert.equal(
		detailOpened()[UpdateType.BACKEND],
		false,
		"a periodic offer must not be able to pop a card the user already answered",
	);
	assert.equal(cardHeadings().length, 0);
});
