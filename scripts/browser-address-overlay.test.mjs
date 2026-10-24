/**
 * S1's address overlay, DRIVEN rather than read.
 *
 * Two halves, both real code:
 *
 * 1. the pure gate/geometry/document-URL helpers and the real
 *    `AddressOverlayController` bundled with `electron` replaced by a recording
 *    stub. The stub exposes a `WebContentsView` factory that records every call,
 *    so the assertions are about the order and the vocabulary the controller
 *    actually uses — not about a regex over its source:
 *    - no show before BOTH readiness events, no visibility before show;
 *    - one child across 20 show/hide cycles; no re-load on a reuse;
 *    - a changed layout hides and invalidates, an unchanged one re-raises;
 *    - owner loss releases a child, a child crash/load failure latches off;
 *    - disposal is idempotent and closes before detaching.
 * 2. the real `TabRegistry`'s post-layout observer: every pass is delivered,
 *    including null/suppressed ones, and a throwing observer cannot stop page
 *    geometry.
 *
 * WHAT THIS CANNOT SHOW (and the probe must not quietly claim): whether the
 * native child actually paints above the page, whether it receives native input,
 * or whether macOS composes the two surfaces. Those are built-app observations;
 * the real-app matrix is `scripts/browser-address-overlay-probe.mjs`.
 *
 * Run: node --test scripts/browser-address-overlay.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

/** The recording stub `electron` resolves to. Exports only what the bundled
 * modules import at runtime; `WebContentsView` records its constructor options so
 * the hardened factory's webPreferences are asserted on the real object. */
const STUB = `
export const constructorOptions = [];
export const stubSessions = new Map();
/**
 * S3's focus facts read webContents.getFocusedWebContents (this whole stub is
 * one template literal, so no backticks here). The stub records what the test
 * wants focused rather than modelling a window: the controller only asks which
 * id and must survive a null answer.
 */
export const focusState = { focused: null };
export const webContents = {
	getFocusedWebContents: () => focusState.focused,
};
export const session = {
	fromPartition: (name) => {
		let entry = stubSessions.get(name);
		if (!entry) {
			entry = {
				name,
				handlers: new Map(),
				permissionRequest: null,
				permissionCheck: null,
				on(event, listener) { this.handlers.set(event, listener); },
				setPermissionRequestHandler(fn) { this.permissionRequest = fn; },
				setPermissionCheckHandler(fn) { this.permissionCheck = fn; },
			};
			stubSessions.set(name, entry);
		}
		return entry;
	},
};
export class WebContentsView {
	constructor(options) {
		constructorOptions.push(options);
		this.options = options;
		this.visible = false;
		this.bounds = null;
		this.destroyed = false;
		const listeners = new Map();
		this.listeners = listeners;
		const self = this;
		this.webContents = {
			id: 900 + constructorOptions.length,
			loadURL: () => Promise.resolve(),
			close: () => { self.destroyed = true; },
			isDestroyed: () => self.destroyed,
			isFocused: () => Boolean(self.focused),
			setWindowOpenHandler: (handler) => { self.windowOpenHandler = handler; },
			on: (event, listener) => {
				const list = listeners.get(event) ?? [];
				list.push(listener);
				listeners.set(event, list);
			},
			removeListener: (event, listener) => {
				const list = listeners.get(event) ?? [];
				const index = list.indexOf(listener);
				if (index >= 0) list.splice(index, 1);
			},
		};
	}
	setBounds(bounds) { this.bounds = { ...bounds }; }
	setVisible(visible) { this.visible = visible; }
	getBounds() { return this.bounds ? { ...this.bounds } : null; }
	getVisible() { return this.visible; }
	setBackgroundColor(color) { this.backgroundColor = color; }
}
`;

const stubPlugin = {
	name: "electron-stub",
	setup(b) {
		b.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "stub",
		}));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents: STUB,
			loader: "js",
		}));
	},
};

/** One bundle for both modules so `esbuild` runs once per file, not once per case. */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/main/browser/address-overlay";
			export * from "./src/renderer/src/features/browser/overlay/address-overlay-port";
			export { nextStaleAttempt, STALE_LAYOUT_ATTEMPTS } from "./src/renderer/src/features/browser/overlay/stale-layout-retry";
			export * from "./src/main/browser/address-overlay-list";
			export * from "./src/main/browser/registry";
			export * as electron from "electron";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [stubPlugin],
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	AddressOverlayController,
	ADDRESS_OVERLAY_MAX_HEIGHT_DIP,
	ADDRESS_OVERLAY_S1_ENV,
	ADDRESS_OVERLAY_VISIBLE_ENV,
	ADDRESS_LIST_ENV,
	ADDRESS_LIST_MAX_HEIGHT_DIP,
	ADDRESS_LIST_MIN_WIDTH_DIP,
	ADDRESS_LIST_NOTICE_HEIGHT_DIP,
	ADDRESS_LIST_ROW_HEIGHT,
	addressListBoundsFor,
	addressListBoundsV2For,
	addressListDocumentUrlFor,
	addressListHeightFor,
	addressListMeasurementProblem,
	addressListRowIndexAt,
	addressListViewModel,
	addressOverlayDocumentUrlFor,
	addressOverlayPort,
	isPermanentOverlayRefusal,
	nextStaleAttempt,
	STALE_LAYOUT_ATTEMPTS,
	layoutKeyOf,
	overlayBoundsFor,
	resolveAddressOverlayGate,
	sanitizeProjection,
	TabRegistry,
} = mod;
const electron = mod.electron;

// ---- fixtures --------------------------------------------------------------

const RECT = { x: 260, y: 110, width: 1120, height: 790 };
const OWNER = { width: 1380, height: 872 };

function makeEmitter(record) {
	const listeners = new Map();
	return {
		on(event, listener) {
			const list = listeners.get(event) ?? [];
			list.push(listener);
			listeners.set(event, list);
		},
		removeListener(event, listener) {
			const list = listeners.get(event) ?? [];
			const index = list.indexOf(listener);
			if (index >= 0) list.splice(index, 1);
		},
		emit(event, ...args) {
			for (const listener of [...(listeners.get(event) ?? [])])
				listener(...args);
		},
		listenerCount(event) {
			return (listeners.get(event) ?? []).length;
		},
		record,
	};
}

/**
 * A view the controller is allowed to drive. Every setter records into `calls`
 * so ordering assertions ("hidden before load", "never visible before ready")
 * are made on the actual call sequence.
 */
function makeView(id, calls) {
	const emitter = makeEmitter(calls);
	let destroyed = false;
	const view = {
		id,
		visible: false,
		bounds: null,
		windowOpenHandler: null,
		calls,
		webContents: {
			id,
			loadURL: (url) => {
				calls.push(["loadURL", id, url]);
				return Promise.resolve();
			},
			close: () => {
				calls.push(["close", id]);
				destroyed = true;
			},
			isDestroyed: () => destroyed,
			isFocused: () => Boolean(view.focused),
			setWindowOpenHandler: (handler) => {
				view.windowOpenHandler = handler;
			},
			on: emitter.on,
			removeListener: emitter.removeListener,
			emit: emitter.emit,
			listenerCount: emitter.listenerCount,
			focus: () => {
				calls.push(["forbidden:webContents.focus", id]);
			},
		},
		setBounds: (bounds) => {
			calls.push(["bounds", id, { ...bounds }]);
			view.bounds = { ...bounds };
		},
		setVisible: (visible) => {
			calls.push(["visible", id, visible]);
			view.visible = visible;
		},
		getBounds: () => (view.bounds ? { ...view.bounds } : null),
		getVisible: () => view.visible,
		emit: emitter.emit,
		listenerCount: emitter.listenerCount,
	};
	return view;
}

/** The two owner emitters need one shared listener registry, not two. */
function makeOwnerWindow() {
	const calls = [];
	const children = [];
	const owner = makeEmitter(calls);
	const windowEvents = makeEmitter(calls);
	const window = {
		id: 7,
		calls,
		children,
		destroyed: false,
		focused: false,
		isDestroyed: () => window.destroyed,
		isFocused: () => window.focused === true,
		getContentBounds: () => ({ ...OWNER }),
		contentView: {
			get children() {
				return children;
			},
			addChildView: (view) => {
				calls.push(["addChildView", view.id]);
				const index = children.indexOf(view);
				if (index >= 0) children.splice(index, 1);
				children.push(view);
			},
			removeChildView: (view) => {
				calls.push(["removeChildView", view.id]);
				const index = children.indexOf(view);
				if (index >= 0) children.splice(index, 1);
			},
		},
		webContents: owner,
		on: windowEvents.on,
		removeListener: windowEvents.removeListener,
		show: () => calls.push(["forbidden:window.show"]),
		showInactive: () => calls.push(["forbidden:window.showInactive"]),
		focus: () => calls.push(["forbidden:window.focus"]),
		owner,
		windowEvents,
	};
	owner.id = 1;
	owner.isDestroyed = () => window.destroyed;
	return window;
}

function makeController(options = {}) {
	const window = options.window ?? makeOwnerWindow();
	const calls = window.calls;
	let nextId = 100;
	const views = [];
	const createView = () => {
		const view = makeView(nextId++, calls);
		views.push(view);
		return view;
	};
	const deps = {
		window,
		documentUrl:
			options.documentUrl ??
			"file:///app/out/renderer/browser-address-overlay.html",
		readinessTimeoutMs: options.readinessTimeoutMs ?? 5_000,
		log: options.log,
		javascript: options.javascript === true,
		visible: options.visible === true,
		product: options.product === true,
		onEvent: options.onEvent,
		onHealthChange: options.onHealthChange,
	};
	if (!options.defaultFactory) deps.createView = createView;
	const controller = new AddressOverlayController(deps);
	return { controller, window, calls, views };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function layout(overrides = {}) {
	return {
		activeTabId: 1,
		presented: true,
		contentRect: { ...RECT },
		revision: 1,
		...overrides,
	};
}

// ---- gate and document URL ------------------------------------------------

test("gate: exact opt-in, armed driver and headless are all required", () => {
	const env = (value) =>
		value === undefined
			? {}
			: { LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1: value };
	assert.deepEqual(
		resolveAddressOverlayGate({
			env: env(undefined),
			devDriverArmed: true,
			windowMode: "headless",
		}),
		{ asked: false, enabled: false, list: false, visible: false, reason: null },
	);
	for (const value of ["0", "true", "yes", "  "]) {
		const result = resolveAddressOverlayGate({
			env: env(value),
			devDriverArmed: true,
			windowMode: "headless",
		});
		assert.equal(
			result.enabled,
			false,
			`value ${JSON.stringify(value)} must be off`,
		);
	}
	assert.equal(
		resolveAddressOverlayGate({
			env: env("1"),
			devDriverArmed: false,
			windowMode: "headless",
		}).enabled,
		false,
		"the driver arming is required, not merely the env",
	);
	for (const mode of ["normal", "inactive"]) {
		assert.equal(
			resolveAddressOverlayGate({
				env: env("1"),
				devDriverArmed: true,
				windowMode: mode,
			}).enabled,
			false,
			`${mode} must refuse: S1 has no user-facing path`,
		);
	}
	const armed = resolveAddressOverlayGate({
		env: env("1"),
		devDriverArmed: true,
		windowMode: "headless",
	});
	assert.deepEqual(armed, {
		asked: true,
		enabled: true,
		list: false,
		visible: false,
		reason: null,
	});
	// S2 is an increment on S1, never a parallel arm.
	const listArmed = resolveAddressOverlayGate({
		env: {
			LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1: "1",
			LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2: "1",
		},
		devDriverArmed: true,
		windowMode: "headless",
	});
	assert.deepEqual(listArmed, {
		asked: true,
		enabled: true,
		list: true,
		visible: false,
		reason: null,
	});
	for (const test of [
		{
			env: { LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2: "1" },
			why: "S2 alone has no child of its own",
		},
		{
			env: {
				LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1: "1",
				LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2: "true",
			},
			why: "S2's opt-in is exact",
		},
	]) {
		const refused = resolveAddressOverlayGate({
			env: test.env,
			devDriverArmed: true,
			windowMode: "headless",
		});
		assert.equal(refused.enabled, false, test.why);
		assert.equal(refused.asked, true, `${test.why}: refusal is printed`);
		assert.ok(refused.reason, test.why);
	}
});

/**
 * S3's gate table. The shape under test is an ORDERED refusal: every combination
 * below draws its own sentence, and the sentence is the evidence a rig reads, so
 * one string per row is asserted rather than a boolean. Rows are written as
 * literal inputs so a future condition cannot hide behind a helper.
 */
test("S3 gate: the visible probe is S1+S2+driver+inactive+unpackaged, and nothing less", () => {
	const base = { [ADDRESS_OVERLAY_S1_ENV]: "1", [ADDRESS_LIST_ENV]: "1" };
	const ask = (overrides = {}) =>
		resolveAddressOverlayGate({
			devDriverArmed: true,
			windowMode: "inactive",
			packaged: false,
			...overrides,
			env: overrides.env ?? { ...base, [ADDRESS_OVERLAY_VISIBLE_ENV]: "1" },
		});

	// The armed shape: every precondition satisfied, the one visible answer.
	assert.deepEqual(ask(), {
		asked: true,
		enabled: true,
		list: true,
		visible: true,
		reason: null,
	});

	// A lone VISIBLE names BOTH missing opt-ins, not just S1.
	assert.deepEqual(ask({ env: { [ADDRESS_OVERLAY_VISIBLE_ENV]: "1" } }), {
		asked: true,
		enabled: false,
		list: false,
		visible: false,
		reason: `${ADDRESS_OVERLAY_VISIBLE_ENV} needs ${ADDRESS_OVERLAY_S1_ENV}=1 and ${ADDRESS_LIST_ENV}=1: the visible probe is an increment on S1's child and S2's mirror, not a third arm`,
	});
	// S1 without S2 is one arm short: the visible probe shows the mirror.
	assert.equal(
		ask({
			env: {
				[ADDRESS_OVERLAY_S1_ENV]: "1",
				[ADDRESS_OVERLAY_VISIBLE_ENV]: "1",
			},
		}).reason,
		`${ADDRESS_OVERLAY_VISIBLE_ENV} needs ${ADDRESS_LIST_ENV}=1: S3's visible probe shows S2's mirror, never a bare S1 child`,
	);
	// The opt-in itself is exact, like S1/S2.
	for (const value of ["0", "true", "yes"]) {
		assert.equal(
			ask({
				env: {
					[ADDRESS_OVERLAY_S1_ENV]: "1",
					[ADDRESS_LIST_ENV]: "1",
					[ADDRESS_OVERLAY_VISIBLE_ENV]: value,
				},
			}).reason,
			`${ADDRESS_OVERLAY_VISIBLE_ENV}=${value.trim()} is not an opt-in (accepted: 1); the address overlay stayed off`,
			`${JSON.stringify(value)} must refuse as a non-opt-in`,
		);
	}
	// A blank VISIBLE is ABSENT, not a refusal: it names no experiment.
	for (const value of ["", "   ", undefined]) {
		const result = ask({
			env: {
				[ADDRESS_OVERLAY_S1_ENV]: "1",
				[ADDRESS_LIST_ENV]: "1",
				[ADDRESS_OVERLAY_VISIBLE_ENV]: value,
			},
			windowMode: "headless",
		});
		assert.equal(result.asked, true, "S1/S2 still print their own line");
		assert.equal(result.visible, false);
		assert.equal(result.enabled, true, "headless S2 behaviour is untouched");
	}

	assert.equal(
		ask({ devDriverArmed: false }).reason,
		"the visible address overlay needs the armed renderer dev driver; it has no product path",
	);
	assert.equal(
		ask({ windowMode: "headless" }).reason,
		`${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a "headless" window: a headless run labelled visible would misattribute its evidence; use --window-mode=inactive`,
	);
	assert.equal(
		ask({ windowMode: "normal" }).reason,
		`${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a "normal" window: a visible probe never runs in the product's own mode; use --window-mode=inactive`,
	);
	assert.equal(
		ask({ packaged: true }).reason,
		`${ADDRESS_OVERLAY_VISIBLE_ENV} refused in a packaged build: S3 is an unpackaged probe, never product surface`,
	);

	/*
	 * The old table, pinned through the new field: for EVERY input without VISIBLE,
	 * the answer is exactly what it was before S3 — same `enabled`, `list`,
	 * `asked` and reason — with `visible:false` appended. This is the promise that
	 * makes the visible arm additive rather than a relaxation.
	 */
	for (const s1 of [undefined, "1", "0"]) {
		for (const s2 of [undefined, "1", "true"]) {
			for (const devDriverArmed of [true, false]) {
				for (const windowMode of ["headless", "inactive", "normal"]) {
					for (const packaged of [true, false]) {
						const env = {};
						if (s1 !== undefined) env[ADDRESS_OVERLAY_S1_ENV] = s1;
						if (s2 !== undefined) env[ADDRESS_LIST_ENV] = s2;
						const result = resolveAddressOverlayGate({
							env,
							devDriverArmed,
							windowMode,
							packaged,
						});
						assert.equal(
							result.visible,
							false,
							`VISIBLE absent must never arm: ${JSON.stringify({ s1, s2, devDriverArmed, windowMode, packaged })}`,
						);
						// The accepted arms are still exactly the pre-S3 ones.
						const expected =
							s1 === "1" &&
							(s2 === undefined || s2 === "1") &&
							devDriverArmed &&
							windowMode === "headless";
						assert.equal(
							result.enabled,
							expected,
							`pre-S3 arm table: ${JSON.stringify({ s1, s2, devDriverArmed, windowMode, packaged })}`,
						);
						assert.equal(
							result.list,
							s1 === "1" &&
								s2 === "1" &&
								devDriverArmed &&
								windowMode === "headless",
						);
					}
				}
			}
		}
	}
});

test("S3 facts: focus counters and the visible fact are reported, never inferred", async () => {
	const { controller, views } = makeController({
		javascript: true,
		visible: true,
	});
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const child = views[0];
	child.webContents.emit("dom-ready");
	child.webContents.emit("did-finish-load");
	await pending;

	const empty = controller.facts();
	assert.equal(empty.visibleMode, true);
	assert.equal(empty.child.focusEvents, 0);
	assert.equal(empty.child.blurEvents, 0);
	assert.equal(empty.child.isFocused, false);
	assert.equal(empty.ownerWindowFocused, false);
	assert.equal(empty.ownerFocusedContentsId, null);

	child.webContents.emit("focus");
	child.webContents.emit("blur");
	child.focused = true;
	electron.focusState.focused = child.webContents;
	const after = controller.facts();
	assert.equal(after.child.focusEvents, 1, "the child focus listener counts");
	assert.equal(after.child.blurEvents, 1, "the child blur listener counts");
	assert.equal(after.child.isFocused, true);
	assert.equal(after.ownerFocusedContentsId, child.webContents.id);
	assert.equal(after.listeners.child, 12, "the S2/S3 listener set is pinned");

	// The S1 shape stays what it was: hidden, no visible fact, no extra listeners.
	const s1 = makeController();
	s1.controller.onLayout(layout());
	const s1Pending = s1.controller.showOverlay();
	await tick();
	s1.views[0].webContents.emit("dom-ready");
	s1.views[0].webContents.emit("did-finish-load");
	await s1Pending;
	const s1Facts = s1.controller.facts();
	assert.equal(s1Facts.visibleMode, false);
	assert.equal(s1Facts.child.focusEvents, 0);
	assert.equal(s1Facts.listeners.child, 7, "S1's listener set is unchanged");
	electron.focusState.focused = null;
	controller.dispose("test");
	s1.controller.dispose("test");
});

test("document URL follows the same two shapes as the other second documents", () => {
	assert.equal(
		addressOverlayDocumentUrlFor("file:///app/out/renderer/index.html"),
		"file:///app/out/renderer/browser-address-overlay.html",
	);
	assert.equal(
		addressOverlayDocumentUrlFor("file:///app/out/renderer/index.html?x=1"),
		"file:///app/out/renderer/browser-address-overlay.html",
	);
	assert.equal(
		addressOverlayDocumentUrlFor("http://localhost:5173"),
		"http://localhost:5173/browser-address-overlay.html",
	);
	assert.equal(
		addressOverlayDocumentUrlFor("http://localhost:5173/"),
		"http://localhost:5173/browser-address-overlay.html",
	);
});

// ---- S1 geometry -----------------------------------------------------------

test("overlay bounds: top 160 dip of the content rect, clamped and validated", () => {
	assert.equal(overlayBoundsFor(null, OWNER), null);
	assert.deepEqual(overlayBoundsFor(RECT, OWNER), {
		x: 260,
		y: 110,
		width: 1120,
		height: ADDRESS_OVERLAY_MAX_HEIGHT_DIP,
	});
	assert.equal(ADDRESS_OVERLAY_MAX_HEIGHT_DIP, 160);
	// A short content rect is not padded up to 160.
	assert.equal(overlayBoundsFor({ ...RECT, height: 40 }, OWNER).height, 40);
	// Rounding happens once, on every edge.
	assert.deepEqual(
		overlayBoundsFor(
			{ x: 10.4, y: 20.6, width: 100.5, height: 500 },
			{ width: 1380.2, height: 871.5 },
		),
		{ x: 10, y: 21, width: 101, height: 160 },
	);
	// Non-finite and out-of-int32 inputs refuse rather than clamp.
	for (const bad of [
		{ x: Number.NaN, y: 0, width: 10, height: 10 },
		{ x: 0, y: Number.POSITIVE_INFINITY, width: 10, height: 10 },
		{ x: 0, y: 0, width: 2 ** 31, height: 10 },
	]) {
		assert.equal(overlayBoundsFor(bad, OWNER), null, JSON.stringify(bad));
	}
	for (const zero of [
		{ x: 0, y: 0, width: 0, height: 10 },
		{ x: 0, y: 0, width: 10, height: 0 },
		{ x: 0, y: 0, width: -10, height: 10 },
	]) {
		assert.equal(overlayBoundsFor(zero, OWNER), null, JSON.stringify(zero));
	}
	// Off-window rectangles intersect; an empty intersection gives null.
	assert.deepEqual(
		overlayBoundsFor({ x: -50, y: -20, width: 100, height: 500 }, OWNER),
		{
			x: 0,
			y: 0,
			width: 50,
			// The strip is 160 tall but starts 20 above the window: only 140 is inside.
			height: 140,
		},
	);
	assert.equal(
		overlayBoundsFor({ x: 4000, y: 110, width: 100, height: 500 }, OWNER),
		null,
	);
	assert.equal(
		overlayBoundsFor({ x: 260, y: 900, width: 1120, height: 100 }, OWNER),
		null,
	);
	// Taller than the window: clipped to the owner, never past it.
	assert.deepEqual(
		overlayBoundsFor({ x: 0, y: 0, width: 2000, height: 2000 }, OWNER),
		{
			x: 0,
			y: 0,
			width: OWNER.width,
			height: ADDRESS_OVERLAY_MAX_HEIGHT_DIP,
		},
	);
});

test("layout key distinguishes tab, presentation and rectangle; never revision alone", () => {
	const base = layout();
	assert.equal(layoutKeyOf(base), layoutKeyOf({ ...base, revision: 9 }));
	assert.notEqual(layoutKeyOf(base), layoutKeyOf({ ...base, activeTabId: 2 }));
	assert.notEqual(
		layoutKeyOf(base),
		layoutKeyOf({ ...base, presented: false }),
	);
	assert.notEqual(
		layoutKeyOf(base),
		layoutKeyOf({ ...base, contentRect: { ...RECT, x: RECT.x + 1 } }),
	);
	assert.notEqual(
		layoutKeyOf(base),
		layoutKeyOf({ ...base, contentRect: null }),
	);
});

// ---- controller: first show / hide ----------------------------------------

test("first show: attach, nonzero bounds, hidden, load, then visible only after both readiness events", async () => {
	const { controller, calls, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	assert.ok(view, "a child was created lazily on the first show");
	const sequence = calls.map((call) => call[0]);
	assert.ok(sequence.indexOf("addChildView") < sequence.indexOf("bounds"));
	assert.ok(sequence.indexOf("bounds") < sequence.indexOf("visible"));
	assert.ok(sequence.indexOf("visible") < sequence.indexOf("loadURL"));
	assert.deepEqual(
		calls.filter((call) => call[0] === "visible")[0].slice(2),
		[false],
		"the child is hidden before it loads",
	);
	assert.equal(
		calls.filter((call) => call[0] === "visible" && call[2] === true).length,
		0,
		"nothing made it visible before readiness",
	);
	view.webContents.emit("dom-ready");
	assert.equal(view.visible, false, "dom-ready alone is not readiness");
	view.webContents.emit("did-finish-load");
	const result = await pending;
	assert.equal(result.shown, true);
	assert.deepEqual(result.bounds, {
		x: RECT.x,
		y: RECT.y,
		width: RECT.width,
		height: ADDRESS_OVERLAY_MAX_HEIGHT_DIP,
	});
	assert.equal(view.visible, true);
	assert.equal(view.bounds.height, ADDRESS_OVERLAY_MAX_HEIGHT_DIP);
	const facts = controller.facts();
	assert.equal(facts.state, "shown");
	assert.equal(facts.child.webContentsId, view.webContents.id);
	assert.equal(
		facts.child.order,
		facts.child.childCount - 1,
		"child is topmost",
	);
	assert.equal(facts.readiness.domReady, true);
	assert.equal(facts.readiness.finished, true);
	assert.equal(facts.childCreatedCount, 1);
	controller.dispose("test");
});

test("first hide keeps the reusable child; the next show does not re-load it", async () => {
	const { controller, calls, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const child = views[0];
	child.webContents.emit("dom-ready");
	child.webContents.emit("did-finish-load");
	const first = await pending;
	assert.equal(first.shown, true);
	controller.hide("test-hide");
	assert.equal(child.visible, false);
	assert.equal(
		calls.filter((call) => call[0] === "close").length,
		0,
		"hide retains the child",
	);
	await controller.showOverlay();
	assert.equal(child.visible, true);
	assert.equal(
		calls.filter((call) => call[0] === "loadURL").length,
		1,
		"a reused child is not re-loaded",
	);
	controller.dispose("test");
});

test("20 show/hide cycles reuse exactly one child and one webContents id", async () => {
	const { controller, calls, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	for (let cycle = 0; cycle < 20; cycle += 1) {
		controller.hide(`cycle-${cycle}`);
		await controller.showOverlay();
		assert.equal(view.visible, true, `cycle ${cycle} visible`);
	}
	const facts = controller.facts();
	assert.equal(facts.childCreatedCount, 1);
	assert.equal(views.length, 1);
	assert.equal(
		calls.filter((call) => call[0] === "loadURL").length,
		1,
		"exactly one load across 20 cycles",
	);
	assert.equal(facts.shownCount, 21);
	controller.dispose("test");
});

// ---- controller: layout, owner and crash ----------------------------------

test("a changed layout hides first and requires an explicit show", async () => {
	const { controller, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	assert.equal(view.visible, true);
	controller.onLayout(layout({ contentRect: { ...RECT, width: 900 } }));
	assert.equal(view.visible, false, "geometry change hid the child");
	assert.equal(controller.facts().state, "ready");
	assert.equal(controller.facts().shownCount, 1, "no implicit re-open");
	await controller.showOverlay();
	assert.equal(view.visible, true, "an explicit show recomputes and shows");
	controller.dispose("test");
});

test("an unchanged layout pass re-raises the child above a newly added page", async () => {
	const { controller, window, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	const page = { id: 5000 };
	window.contentView.children.push(page);
	assert.notEqual(window.contentView.children.at(-1), view);
	controller.onLayout(layout({ revision: 2 }));
	assert.equal(window.contentView.children.at(-1), view, "re-added last");
	assert.equal(view.visible, true, "an unchanged layout does not hide");
	controller.dispose("test");
});

test("background creation (same key) never re-opens after a hide; null layout stays hidden", async () => {
	const { controller, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	controller.onLayout(
		layout({ contentRect: null, presented: false, revision: 2 }),
	);
	assert.equal(view.visible, false);
	assert.equal(controller.facts().state, "ready");
	controller.onLayout(
		layout({ contentRect: null, presented: false, revision: 3 }),
	);
	assert.equal(view.visible, false);
	assert.equal(controller.facts().shownCount, 1);
	controller.dispose("test");
});

test("owner blur/minimize hide without disposing; owner crash releases the child", async () => {
	const { controller, window, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	window.windowEvents.emit("blur");
	assert.equal(view.visible, false);
	assert.equal(controller.facts().child !== null, true, "blur keeps the child");
	controller.onLayout(layout({ revision: 2 }));
	await controller.showOverlay();
	assert.equal(view.visible, true);
	window.owner.emit("render-process-gone", {}, { reason: "crashed" });
	assert.equal(
		view.webContents.isDestroyed(),
		true,
		"owner crash closed the child",
	);
	assert.equal(
		window.children.includes(view),
		false,
		"owner crash detached it",
	);
	assert.equal(controller.facts().state, "absent");
	// A fresh explicit show may lazily create one new child.
	const next = controller.showOverlay();
	await tick();
	const replacement = views.at(-1);
	assert.notEqual(replacement, view);
	replacement.webContents.emit("dom-ready");
	replacement.webContents.emit("did-finish-load");
	assert.equal((await next).shown, true);
	controller.dispose("test");
});

test("child crash and load failure latch off for this host lifetime", async () => {
	for (const event of ["render-process-gone", "did-fail-load"]) {
		const { controller, views } = makeController();
		controller.onLayout(layout());
		const pending = controller.showOverlay();
		await tick();
		const view = views.at(-1);
		if (event === "render-process-gone") {
			view.webContents.emit("render-process-gone", {}, { reason: "crashed" });
			assert.equal((await pending).shown, false);
		} else {
			view.webContents.emit(
				"did-fail-load",
				{},
				-105,
				"NAME_NOT_RESOLVED",
				"",
				true,
			);
			assert.equal((await pending).shown, false);
		}
		const facts = controller.facts();
		assert.equal(facts.state, "failed", event);
		assert.ok(facts.failedReason, `${event} must carry a reason`);
		assert.equal(facts.child, null);
		const again = await controller.showOverlay();
		assert.equal(again.shown, false);
		assert.equal(
			again.reason,
			facts.failedReason,
			"the latch refuses, not retries",
		);
		assert.equal(views.length, 1, "no replacement child after a latch");
		controller.dispose("test");
	}
});

/**
 * S4b round-2 regressions. Both mechanisms below were found by reading in round
 * 1 and are reproduced here against the REAL controller (electron stubbed), not
 * a model of it.
 */
test("S4b: a presentation-only flip lowers nothing, and the child comes back", async () => {
	const events = [];
	let health = 0;
	const { controller, views } = makeController({
		product: true,
		onEvent: (event) => events.push(event),
		onHealthChange: () => {
			health += 1;
		},
	});
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	assert.equal((await pending).shown, true);
	assert.equal(view.visible, true);

	// The page menu suppresses the native page for as long as its panel is open:
	// presented flips, the tab and the rectangle do not.
	controller.onLayout(layout({ presented: false, revision: 2 }));
	assert.deepEqual(events, [], "opening the menu must not dismiss the popout");
	assert.equal(view.visible, false, "the child must yield to the menu panel");
	assert.equal(controller.facts().state, "shown", "the row is still raised");

	controller.onLayout(layout({ presented: true, revision: 3 }));
	assert.deepEqual(events, [], "closing the menu must not dismiss either");
	assert.equal(view.visible, true, "the list returns with the page");
	assert.equal(health, 0, "presentation is not a health fact");

	// A REAL layout change is still a dismissal.
	controller.onLayout(
		layout({ contentRect: { ...RECT, x: RECT.x + 40 }, revision: 4 }),
	);
	assert.deepEqual(
		events.map((event) => [event.type, event.reason]),
		[["dismiss", "layout"]],
	);
	controller.dispose("test");
});

test("page_pointer dismisses the bound tab only, through the product door", () => {
	// The page's own press path (browser/index.ts's `before-mouse-event`) calls
	// this. The reason is asserted because the renderer's abandonment is keyed on
	// the event, and a background tab's press must not lower the active field.
	const events = [];
	const { controller } = makeController({
		product: true,
		onEvent: (event) => events.push(event),
	});
	controller.onLayout(layout());
	controller.dismissForTab(2, "page_pointer");
	assert.deepEqual(
		events,
		[],
		"another tab's press is not this popout's business",
	);
	controller.dismissForTab(1, "page_pointer");
	assert.deepEqual(
		events.map((event) => [event.type, event.reason]),
		[["dismiss", "page_pointer"]],
	);
	controller.dispose("test");
});

test("S5: a narrow anchor that precedes its page rect resizes the hidden reusable child", async () => {
	const events = [];
	const {
		controller,
		views,
		window: host,
	} = makeController({
		product: true,
		onEvent: (event) => events.push(event),
	});
	host.webContents.getZoomFactor = () => 1;
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	assert.equal((await pending).shown, true);
	controller.hide("test");

	// Q-3: the row observer can publish x0/360 while main still owns the old
	// x260/1120 page rect. Their 100px intersection is invalid, so the projection
	// is refused and the child is hidden before the matching rect arrives.
	const answer = await controller.project({
		v: 2,
		seq: 900,
		tabId: 1,
		visible: true,
		pageRect: { ...RECT },
		anchor: { x: 0, width: 360 },
		active: 0,
		view: { kind: "rows", rows: [{ text: "example.com", title: "Example" }] },
		label: "From this browser session",
		dir: "ltr",
	});
	assert.equal(answer.accepted, false);
	assert.equal(answer.reason, "anchor_inconsistent");
	assert.equal(view.visible, false);

	const narrowRect = { ...RECT, x: 0, width: 360 };
	controller.onLayout(layout({ contentRect: narrowRect, revision: 2 }));
	assert.equal(
		view.bounds.x,
		0,
		"the deferred narrow projection must use the matching new page rect",
	);
	assert.equal(view.bounds.width, 360);
	assert.equal(
		view.visible,
		false,
		"resizing must not re-open a dismissed list",
	);
	assert.deepEqual(
		events.map((event) => [event.type, event.reason]),
		[["dismiss", "layout"]],
		"the real rect change keeps its intentional product dismissal",
	);
	controller.dispose("test");
});

test("S4b: a presentation-only flip does not drop a projection that arrives meanwhile", async () => {
	const events = [];
	const { controller, views } = makeController({
		product: true,
		onEvent: (event) => events.push(event),
	});
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views[0];
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	controller.onLayout(layout({ presented: false, revision: 2 }));
	// The renderer keeps projecting while the menu owns focus. Refusing would make
	// the mirror re-project the same frame every animation frame.
	const answer = await controller.project({
		v: 2,
		seq: 900,
		tabId: 1,
		visible: true,
		pageRect: { ...RECT },
		anchor: { x: RECT.x, width: 640 },
		active: 0,
		view: { kind: "rows", rows: [{ text: "example.com", title: "Example" }] },
		label: "From this browser session",
		dir: "ltr",
	});
	assert.equal(answer.accepted, true, JSON.stringify(answer));
	assert.deepEqual(events, []);
	assert.equal(controller.facts().state, "shown", "the row is still raised");
	// Resuming hands the deferred payload to the projection queue. The stub view
	// cannot answer `executeJavaScript`, so what is asserted here is the decision
	// (accepted, deferred, no dismissal), not the paint.
	controller.onLayout(layout({ presented: true, revision: 3 }));
	assert.deepEqual(events, []);
	controller.dispose("test");
});

test("S4b: a child failure while the field is raised pushes a health change", async () => {
	let health = 0;
	const { controller, views } = makeController({
		product: true,
		onHealthChange: () => {
			health += 1;
		},
	});
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	assert.equal(health, 0, "warming the child is not a health fact");
	views[0].webContents.emit(
		"did-fail-load",
		{},
		-105,
		"NAME_NOT_RESOLVED",
		"",
		true,
	);
	await pending;
	assert.equal(health, 1, "the renderer reads Tier 1 from the projection");
	assert.deepEqual(controller.mode(), {
		mode: "suspend",
		reason: "load_failed:-105",
	});
	controller.dispose("test");
});

test("a readiness timeout fails closed and rejects the pending show", async () => {
	const { controller, views } = makeController({ readinessTimeoutMs: 10 });
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	// dom-ready only: did-finish-load never arrives.
	view.webContents.emit("dom-ready");
	const result = await pending;
	assert.equal(result.shown, false);
	assert.equal(controller.facts().state, "failed");
	assert.match(controller.facts().failedReason, /load_timeout/);
	assert.equal(view.visible, false);
	assert.equal(view.webContents.isDestroyed(), true);
	controller.dispose("test");
});

test("hide during a pending load invalidates the show and ignores late readiness", async () => {
	const { controller, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	controller.hide("pending");
	assert.equal(view.visible, false);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	const result = await pending;
	assert.equal(result.shown, false);
	assert.equal(result.reason, "invalidated");
	assert.equal(view.visible, false);
	assert.equal(
		controller.facts().state,
		"ready",
		"the child itself is ready and reusable",
	);
	controller.dispose("test");
});

test("dispose is idempotent, closes before detaching and refuses later shows", async () => {
	const { controller, window, calls, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	const listenersBefore = view.listenerCount("dom-ready");
	controller.dispose("stop");
	controller.dispose("stop-again");
	assert.equal(view.webContents.isDestroyed(), true);
	assert.equal(window.children.includes(view), false);
	assert.equal(
		calls.filter((call) => call[0] === "close").length,
		1,
		"close exactly once",
	);
	assert.equal(
		calls.filter((call) => call[0] === "removeChildView").length,
		1,
		"detach exactly once",
	);
	assert.equal(view.listenerCount("dom-ready"), 0, "listeners removed");
	assert.ok(listenersBefore > 0);
	const refused = await controller.showOverlay();
	assert.equal(refused.shown, false);
	assert.equal(refused.reason, "disposed");
	assert.equal(controller.facts().state, "disposed");
});

test("forbidden calls: no window raise/focus and no child focus, ever", async () => {
	const { controller, window, calls, views } = makeController();
	controller.onLayout(layout());
	const pending = controller.showOverlay();
	await tick();
	const view = views.at(-1);
	view.webContents.emit("dom-ready");
	view.webContents.emit("did-finish-load");
	await pending;
	controller.hide("test");
	await controller.showOverlay();
	controller.dispose("test");
	assert.deepEqual(
		calls.filter((call) => String(call[0]).startsWith("forbidden:")),
		[],
	);
	assert.equal(
		window.show,
		window.show,
		"sanity: the counters are not invoked",
	);
});

test("show refuses with no layout, a missing tab or an invalid rectangle", async () => {
	const cases = [
		{ name: "no layout", snapshot: null },
		{ name: "no active tab", snapshot: layout({ activeTabId: null }) },
		{ name: "not presented", snapshot: layout({ presented: false }) },
		{ name: "null rect", snapshot: layout({ contentRect: null }) },
		{
			name: "zero rect",
			snapshot: layout({ contentRect: { x: 0, y: 0, width: 0, height: 0 } }),
		},
	];
	for (const item of cases) {
		const { controller, views } = makeController();
		if (item.snapshot) controller.onLayout(item.snapshot);
		const result = await controller.showOverlay();
		assert.equal(result.shown, false, item.name);
		assert.equal(result.reason, "no_layout", item.name);
		assert.equal(views.length, 0, `${item.name}: no child is created`);
		controller.dispose("test");
	}
});

test("the hardened factory's webPreferences and session handlers are real", async () => {
	electron.constructorOptions.length = 0;
	electron.stubSessions.clear();
	const { controller } = makeController({ defaultFactory: true });
	controller.onLayout(layout());
	void controller.showOverlay();
	await tick();
	const created = electron.constructorOptions.at(-1);
	assert.ok(created, "the default factory ran");
	const prefs = created.webPreferences;
	assert.equal(prefs.sandbox, true);
	assert.equal(prefs.contextIsolation, true);
	assert.equal(prefs.nodeIntegration, false);
	assert.equal(prefs.webSecurity, true);
	assert.equal(prefs.allowRunningInsecureContent, false);
	assert.equal(prefs.javascript, false);
	assert.equal("preload" in prefs, false, "the child receives no preload");
	assert.equal(
		String(prefs.partition).startsWith("persist:"),
		false,
		"a dedicated in-memory session, not the browsing partition",
	);
	const entry = [...electron.stubSessions.values()].at(-1);
	assert.ok(entry, "the child session was configured");
	let allowed = null;
	entry.permissionRequest({}, "media", (value) => {
		allowed = value;
	});
	assert.equal(allowed, false, "permission requests deny");
	assert.equal(
		entry.permissionCheck({}, "media", {}),
		false,
		"permission checks deny",
	);
	const download = {
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	};
	entry.handlers.get("will-download")?.(download);
	assert.equal(download.prevented, true, "downloads are denied");
	controller.dispose("test");
});

// ---- registry post-layout observer ----------------------------------------

function makeRegistry(observer) {
	const views = [];
	const removals = [];
	let changed = 0;
	const registry = new TabRegistry(
		() => {
			const view = makeView(7000 + views.length, []);
			views.push(view);
			return view;
		},
		(tabId) => removals.push(tabId),
		() => {
			changed += 1;
		},
		observer,
	);
	return { registry, views, removals, changed: () => changed };
}

test("registry delivers every layout revision, including null and suppressed", () => {
	const snapshots = [];
	const { registry, views } = makeRegistry((snapshot) =>
		snapshots.push(snapshot),
	);
	registry.create({ owner: "user" });
	const created = registry.activeTab.tabId;
	assert.equal(snapshots.length, 1, "creation runs one layout pass");
	assert.equal(snapshots[0].activeTabId, created);
	assert.equal(snapshots[0].presented, false);
	assert.equal(snapshots[0].contentRect, null);
	registry.setContentRect({ x: 10, y: 20, width: 300, height: 400 });
	assert.equal(snapshots.at(-1).presented, true);
	assert.deepEqual(snapshots.at(-1).contentRect, {
		x: 10,
		y: 20,
		width: 300,
		height: 400,
	});
	const delivered = snapshots.at(-1).contentRect;
	registry.setContentRect({ x: 11, y: 20, width: 300, height: 400 });
	assert.deepEqual(
		delivered,
		{ x: 10, y: 20, width: 300, height: 400 },
		"snapshots are copies",
	);
	registry.setViewVisible(false);
	assert.equal(snapshots.at(-1).presented, false);
	assert.equal(snapshots.at(-1).contentRect.width, 300);
	registry.setContentRect(null);
	assert.equal(snapshots.at(-1).contentRect, null);
	assert.equal(snapshots.at(-1).presented, false);
	const revisions = snapshots.map((snapshot) => snapshot.revision);
	assert.deepEqual(
		revisions,
		[...revisions].sort((a, b) => a - b),
	);
	assert.equal(
		new Set(revisions).size,
		revisions.length,
		"revisions are unique",
	);
	assert.equal(
		views.every((view) => view.bounds !== null),
		true,
	);
});

test("a throwing layout observer cannot interrupt page layout", () => {
	const { registry } = makeRegistry(() => {
		throw new Error("observer exploded");
	});
	assert.doesNotThrow(() => registry.create({ owner: "user" }));
	registry.setContentRect({ x: 1, y: 2, width: 3, height: 4 });
	const view = registry.activeTab.view;
	assert.deepEqual(view.getBounds(), { x: 1, y: 2, width: 3, height: 4 });
	assert.equal(view.visible, true);
});

// ---- static contract of the inert document and build inputs ---------------

test("the overlay document is inert and its CSP hash matches its only style block", () => {
	const html = readFileSync(
		join(ROOT, "src/renderer/browser-address-overlay.html"),
		"utf8",
	);
	assert.equal(/<script\b/i.test(html), false, "no script tag");
	assert.equal(/autofocus/i.test(html), false, "no autofocus");
	assert.equal(
		/<input\b|<textarea\b|<select\b/i.test(html),
		false,
		"no controls",
	);
	assert.equal(/unsafe-inline/i.test(html), false, "no unsafe-inline");
	for (const directive of [
		"default-src 'none'",
		"script-src 'none'",
		"connect-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	]) {
		assert.ok(html.includes(directive), directive);
	}
	const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
	assert.ok(style, "the style block exists");
	const hash = createHash("sha256").update(style).digest("base64");
	assert.ok(
		html.includes(`style-src 'sha256-${hash}'`),
		`style hash ${hash} matches the block`,
	);
});

test("the document is a dev-server AND build input, and the probe/factory source keeps its boundaries", () => {
	const config = readFileSync(join(ROOT, "electron.vite.config.js"), "utf8");
	const occurrences =
		config.match(/src\/renderer\/browser-address-overlay\.html/g) ?? [];
	assert.equal(occurrences.length, 2, "renderer input and rollupOptions.input");
	const source = readFileSync(
		join(ROOT, "src/main/browser/address-overlay.ts"),
		"utf8",
	)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	// S2 adds exactly two scripted calls, both into the child's own fixed
	// functions with main-built JSON. Anything else that runs code is refused
	// here: `eval`, a bare string built from renderer input, or a second sink.
	const scripts = source.match(/executeJavaScript\(([\s\S]{0,220}?)\)/g) ?? [];
	assert.ok(scripts.length >= 2, "the apply and measure calls exist");
	for (const call of scripts) {
		assert.match(
			call,
			/window\.__loAddressOverlay/,
			"executeJavaScript only targets the child's fixed functions",
		);
	}
	assert.equal(/\beval\(/.test(source), false, "no eval");
	assert.equal(/\.focus\(\)|showInactive/.test(source), false);
	assert.equal(/preload:/.test(source), false, "no preload is configured");
	assert.equal(
		/persist:/.test(source),
		false,
		"no persistent partition is named",
	);
});

// ---- S2: the mirror list's pure decisions ---------------------------------

const S2_FIELD = { x: 300, y: 60, width: 604, height: 32 };
const S2_OWNER = { width: 1380, height: 872 };
const S2_LIST_TOP = 97; // field bottom 92 + the toolbar's ~5px rule

function rows(n) {
	return Array.from({ length: n }, (_, index) => ({
		text: `host-${index}.example.com/path`,
		title: `Title ${index}`,
	}));
}

function projection(overrides = {}) {
	return {
		v: 1,
		seq: 7,
		tabId: 3,
		visible: true,
		pageRect: { x: 260, y: 110, width: 1120, height: 790 },
		field: { ...S2_FIELD },
		listTop: S2_LIST_TOP,
		active: 0,
		view: { kind: "rows", rows: rows(3) },
		label: "Suggestions",
		dir: "ltr",
		...overrides,
	};
}

test("S2 list geometry: the dock's numbers, computed by main and capped", () => {
	assert.equal(addressListHeightFor({ kind: "rows", rows: rows(1) }), 69);
	assert.equal(addressListHeightFor({ kind: "rows", rows: rows(3) }), 140);
	assert.equal(addressListHeightFor({ kind: "rows", rows: rows(5) }), 211);
	assert.ok(
		addressListHeightFor({ kind: "rows", rows: rows(5) }) <=
			ADDRESS_LIST_MAX_HEIGHT_DIP,
	);
	assert.equal(ADDRESS_LIST_ROW_HEIGHT, 35.5);
	assert.equal(
		addressListHeightFor({ kind: "notice", notice: "empty", text: "" }),
		ADDRESS_LIST_NOTICE_HEIGHT_DIP,
	);
	const bounds = addressListBoundsFor(
		S2_FIELD,
		S2_LIST_TOP,
		{ kind: "rows", rows: rows(3) },
		S2_OWNER,
	);
	assert.deepEqual(bounds, {
		x: S2_FIELD.x,
		y: S2_LIST_TOP,
		width: S2_FIELD.width,
		height: 140,
	});
	// The list can never overlap the field it belongs to.
	assert.ok(bounds.y >= S2_FIELD.y + S2_FIELD.height);
});

test("S2 anchor: the 0..24 gap is measured, and every bad rectangle refuses", () => {
	const view = { kind: "rows", rows: rows(3) };
	const at = (listTop) =>
		addressListBoundsFor(S2_FIELD, listTop, view, S2_OWNER);
	const fieldBottom = S2_FIELD.y + S2_FIELD.height;
	assert.ok(at(fieldBottom), "flush is allowed");
	assert.ok(at(fieldBottom + 24), "24 DIP is the documented maximum");
	assert.equal(at(fieldBottom + 25), null, "further is another surface");
	assert.equal(at(fieldBottom - 1), null, "never covers the field");
	for (const bad of [
		{ ...S2_FIELD, width: 0 },
		{ ...S2_FIELD, height: -4 },
		{ ...S2_FIELD, x: Number.NaN },
	]) {
		assert.equal(addressListBoundsFor(bad, S2_LIST_TOP, view, S2_OWNER), null);
	}
	assert.equal(
		addressListBoundsFor(S2_FIELD, Number.POSITIVE_INFINITY, view, S2_OWNER),
		null,
	);
	// The horizontal edge is clamped to the owner's content box (the list can
	// never paint past the window), while a VERTICAL shortage is refused: a
	// clamped height would hide rows the model says exist.
	assert.deepEqual(
		addressListBoundsFor(S2_FIELD, S2_LIST_TOP, view, {
			width: 900,
			height: 872,
		}),
		{ x: 300, y: S2_LIST_TOP, width: 600, height: 140 },
	);
	assert.equal(
		addressListBoundsFor(
			{ ...S2_FIELD, y: 800 },
			837,
			{ kind: "notice", notice: "empty", text: "x" },
			{ width: 1380, height: 900 },
		),
		null,
		"a notice that would cross the bottom edge is refused",
	);
});

function projectionV2(overrides = {}) {
	return {
		v: 2,
		seq: 8,
		tabId: 3,
		visible: true,
		pageRect: { x: 260, y: 69, width: 1120, height: 831 },
		anchor: { x: 260, width: 1120 },
		active: 0,
		view: { kind: "rows", rows: rows(3) },
		label: "Suggestions",
		dir: "ltr",
		...overrides,
	};
}

test("S4b anchor geometry: strip width, page top, and a 240 DIP floor", () => {
	const view = { kind: "rows", rows: rows(3) };
	const pageRect = { x: 260, y: 69, width: 1120, height: 831 };
	const bounds = addressListBoundsV2For(
		{ x: 260, width: 1120 },
		pageRect,
		view,
		S2_OWNER,
	);
	assert.deepEqual(bounds, {
		x: 260,
		y: 69,
		width: 1120,
		height: 140,
	});
	// The strip band is clipped to the page rect on both sides: a pane whose
	// chrome is wider than its page can never paint the child beside the page.
	assert.deepEqual(
		addressListBoundsV2For({ x: 100, width: 900 }, pageRect, view, S2_OWNER),
		{ x: 260, y: 69, width: 740, height: 140 },
	);
	// A rail pane narrower than the design's floor refuses instead of drawing a
	// list whose rows cannot be read (the renderer then shows Tier 1).
	assert.equal(
		addressListBoundsV2For(
			{ x: 0, width: ADDRESS_LIST_MIN_WIDTH_DIP - 1 },
			{ x: 0, y: 69, width: ADDRESS_LIST_MIN_WIDTH_DIP - 1, height: 831 },
			view,
			S2_OWNER,
		),
		null,
	);
	assert.ok(ADDRESS_LIST_MIN_WIDTH_DIP >= 240);
	// Never shortened: a list that would run past the owner's bottom refuses.
	assert.equal(
		addressListBoundsV2For(
			{ x: 0, width: 1000 },
			{ x: 0, y: 800, width: 1000, height: 60 },
			{ kind: "rows", rows: rows(5) },
			S2_OWNER,
		),
		null,
	);
});

test("S4b projection: v2 replaces field/listTop and keeps the strict key set", () => {
	const ok = sanitizeProjection(projectionV2());
	assert.equal(ok.ok, true);
	assert.equal(ok.projection.v, 2);
	assert.deepEqual(ok.projection.anchor, { x: 260, width: 1120 });
	const refused = (payload) => {
		const result = sanitizeProjection(payload);
		assert.equal(result.ok, false, JSON.stringify(payload).slice(0, 120));
		return result.reason;
	};
	assert.equal(refused({ ...projectionV2(), v: 1 }), "unknown_key");
	assert.equal(refused({ ...projectionV2(), anchor: { x: 0 } }), "bad_anchor");
	assert.equal(
		refused({ ...projectionV2(), anchor: { x: 0, width: 0 } }),
		"bad_anchor",
	);
	assert.equal(
		refused({ ...projectionV2(), field: { ...S2_FIELD } }),
		"unknown_key",
	);
	assert.equal(
		refused({ ...projectionV2(), anchor: { x: 0, width: 240, y: 1 } }),
		"bad_anchor",
	);
	const hidden = sanitizeProjection({
		v: 2,
		seq: 9,
		tabId: 3,
		visible: false,
	});
	assert.equal(hidden.ok, true);
	assert.equal(hidden.projection.visible, false);
});

test("S2 projection: every field revalidated, unknown keys refused", () => {
	const ok = sanitizeProjection(projection());
	assert.equal(ok.ok, true);
	assert.equal(ok.projection.seq, 7);

	const refused = (payload) => {
		const result = sanitizeProjection(payload);
		assert.equal(result.ok, false, JSON.stringify(payload).slice(0, 120));
		return result.reason;
	};
	assert.equal(refused({ ...projection(), v: 3 }), "bad_version");
	// A v1 payload relabelled v2 keeps v1-only keys: the v2 key set is strict,
	// so the shape is refused before any geometry is read.
	assert.equal(refused({ ...projection(), v: 2 }), "unknown_key");
	assert.equal(refused({ ...projection(), seq: 0 }), "bad_seq");
	assert.equal(refused({ ...projection(), seq: 1.5 }), "bad_seq");
	assert.equal(refused({ ...projection(), tabId: "3" }), "bad_tab");
	assert.equal(refused({ ...projection(), visible: "true" }), "bad_visible");
	assert.equal(refused({ ...projection(), dir: "auto" }), "bad_dir");
	assert.equal(refused({ ...projection(), extra: 1 }), "unknown_key");
	assert.equal(
		refused({ ...projection(), field: { ...S2_FIELD, width: Number.NaN } }),
		"bad_rect",
	);
	assert.equal(
		refused({ ...projection(), view: { kind: "rows", rows: rows(6) } }),
		"bad_rows",
	);
	assert.equal(
		refused({
			...projection(),
			view: { kind: "notice", notice: "info", text: "x" },
		}),
		"bad_notice",
	);
	assert.equal(
		refused({ ...projection(), active: 3 }),
		"bad_active",
		"active cannot name a row that does not exist",
	);
	assert.equal(
		refused({
			...projection(),
			view: { kind: "rows", rows: [{ text: "", title: "" }] },
			active: -1,
		}),
		"bad_rows",
	);
	// The size cap is on ACTUAL bytes, not on a field count.
	const huge = projection();
	huge.label = "x".repeat(20_000);
	assert.equal(refused(huge), "payload_too_large");
});

test("S2 projection: hostile strings are stripped and capped, never interpreted", () => {
	const hostile = `a\u202Eb\u202Ac${String.fromCharCode(0)}d\u2028e<img src=x onerror=alert(1)>`;
	const result = sanitizeProjection(
		projection({
			active: -1,
			view: {
				kind: "rows",
				rows: [{ text: hostile, title: "y".repeat(600) }],
			},
		}),
	);
	assert.equal(result.ok, true);
	const [row] = result.projection.view.rows;
	assert.equal(row.text.includes("\u202E"), false);
	assert.equal(row.text.includes("\u202A"), false);
	assert.equal(row.text.includes(String.fromCharCode(0)), false);
	assert.equal(row.text.includes("\u2028"), false);
	assert.equal(row.text.includes("<img"), true, "literal text stays literal");
	assert.ok(row.text.length <= 512);
	assert.ok(row.title.length <= 256);
	// A string that is ALL disallowed becomes empty, which is then refused —
	// the mirror never paints an invisible row.
	const stripped = sanitizeProjection(
		projection({
			active: -1,
			view: { kind: "rows", rows: [{ text: "\u202E\u0000", title: "" }] },
		}),
	);
	assert.equal(stripped.ok, false);
});

test("S2 theme: opaque colours only; alpha or junk falls back to one neutral", () => {
	const resolved = sanitizeProjection(
		projection({
			theme: {
				elevated: "#1b1f24",
				ink: "rgb(230, 232, 234)",
				inkMuted: "rgb(154,160,166)",
				accent: "#5b9dd9",
				accentWash: "#23303d",
				rowHover: "#24282e",
				hairline: "#2f343b",
				control: "#3a4048",
			},
		}),
	);
	assert.equal(resolved.projection.themeFact, "resolved");
	assert.equal(resolved.projection.theme.elevated, "#1b1f24");

	const alpha = sanitizeProjection(
		projection({
			theme: {
				elevated: "rgba(1, 2, 3, 0.5)",
				ink: "#ffffff",
				inkMuted: "#ffffff",
				accent: "#ffffff",
				accentWash: "#ffffff",
				rowHover: "#ffffff",
				hairline: "#ffffff",
				control: "#ffffff",
			},
		}),
	);
	assert.equal(alpha.ok, true);
	assert.equal(alpha.projection.themeFact, "fallback");
	assert.equal(alpha.projection.theme, null);

	assert.equal(sanitizeProjection(projection()).projection.themeFact, "absent");
});

test("S2 hit-test: rows only, in the child's own viewport coordinates", () => {
	const view = { kind: "rows", rows: rows(3) };
	assert.equal(addressListRowIndexAt(view, 0), null, "header");
	assert.equal(addressListRowIndexAt(view, 29), null, "header/rule boundary");
	assert.equal(addressListRowIndexAt(view, 30), 0, "first row's first pixel");
	assert.equal(addressListRowIndexAt(view, 64), 0);
	assert.equal(addressListRowIndexAt(view, 65.5), 1);
	assert.equal(addressListRowIndexAt(view, 100), 1);
	assert.equal(addressListRowIndexAt(view, 136), 2);
	assert.equal(addressListRowIndexAt(view, 141), null, "below the last row");
	assert.equal(
		addressListRowIndexAt({ kind: "notice", notice: "empty", text: "" }, 40),
		null,
		"a notice has no rows",
	);
});

test("S2 measurement: the child must prove what it painted", () => {
	const model = sanitizeProjection(projection({ active: 1 })).projection;
	const good = {
		appliedSeq: model.seq,
		rowCount: 3,
		headerHeight: 28,
		rowRects: [0, 1, 2].map((index) => ({
			top: 2 + index * 35.5,
			height: 35.5,
		})),
		viewportHeight: 110,
		scrollHeight: 110,
		innerHeight: 140,
		activeRowRect: { top: 37.5, height: 35.5 },
	};
	assert.equal(addressListMeasurementProblem(good, model, 140), null);
	// M1's negative control: the layout viewport is pinned to the model, so only
	// innerHeight can prove the native view is the requested rectangle. A view
	// 71 DIP short is exactly the shipped run's 211-requested/140-painted case.
	assert.equal(
		addressListMeasurementProblem({ ...good, innerHeight: 69 }, model, 140),
		"measure_viewport",
	);
	assert.equal(
		addressListMeasurementProblem({ ...good, innerHeight: 139 }, model, 140),
		null,
		"one DIP of rounding is tolerated",
	);
	const shortPaint = sanitizeProjection(
		projection({
			view: { kind: "notice", notice: "empty", text: "x" },
			active: -1,
		}),
	).projection;
	assert.equal(
		addressListMeasurementProblem(
			{
				appliedSeq: shortPaint.seq,
				rowCount: 0,
				headerHeight: 28,
				rowRects: [],
				viewportHeight: 75,
				scrollHeight: 0,
				innerHeight: 104,
				activeRowRect: null,
			},
			shortPaint,
			104,
		),
		null,
	);
	assert.equal(
		addressListMeasurementProblem(
			{ ...good, appliedSeq: model.seq + 1 },
			model,
		),
		"measure_stale",
	);
	assert.equal(
		addressListMeasurementProblem({ ...good, rowCount: 2 }, model, 140),
		"measure_row_count",
	);
	assert.equal(
		addressListMeasurementProblem(
			{ ...good, rowRects: [{ top: 2, height: 30 }] },
			model,
			140,
		),
		"measure_row_rects",
	);
	assert.equal(
		addressListMeasurementProblem(
			{
				...good,
				rowRects: good.rowRects.map((row) => ({ ...row, height: 34 })),
			},
			model,
			140,
		),
		"measure_row_height",
	);
	assert.equal(
		addressListMeasurementProblem({ ...good, scrollHeight: 400 }, model, 140),
		"measure_scroll",
		"rows are capped so the mirror never scrolls",
	);
	assert.equal(
		addressListMeasurementProblem(
			{ ...good, activeRowRect: { top: -40, height: 35.5 } },
			model,
			140,
		),
		"active_not_visible",
	);
	assert.equal(addressListMeasurementProblem(null, model), "measure_invalid");
});

test("S2 view model: the child never receives page identity or a URL-bearing key", () => {
	const model = addressListViewModel(
		sanitizeProjection(
			projection({ active: 2, view: { kind: "rows", rows: rows(3) } }),
		).projection,
	);
	for (const forbidden of ["tabId", "pageRect", "field", "listTop", "url"]) {
		assert.equal(
			JSON.stringify(model).includes(`"${forbidden}"`),
			false,
			`${forbidden} does not travel to the child`,
		);
	}
	assert.equal(model.active, 2);
	assert.equal(model.view.rows.length, 3);
});

test("S2 document and bundle: strict CSP, no accessibility claim, no app imports", () => {
	const html = readFileSync(
		join(ROOT, "src/renderer/browser-address-overlay-list.html"),
		"utf8",
	);
	const csp = html.match(
		/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
	)?.[1];
	assert.equal(
		csp,
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
	);
	assert.equal(/unsafe-inline|unsafe-eval/i.test(html), false);
	assert.equal(/\brole=|\btabindex=|\bautofocus/i.test(html), false);
	assert.equal(/aria-hidden="true"/.test(html), true);

	const script = readFileSync(
		join(ROOT, "src/renderer/src/address-overlay-list/main.ts"),
		"utf8",
	);
	const imports = [...script.matchAll(/from\s+"([^"]+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(
		imports,
		[],
		"the child bundles no app module (the stylesheet is a side-effect import)",
	);
	assert.match(script, /textContent =/);
	assert.equal(
		/innerHTML|insertAdjacentHTML|document\.write/.test(script),
		false,
	);
	assert.equal(/ipcRenderer|window\.api/.test(script), false);

	const config = readFileSync(join(ROOT, "electron.vite.config.js"), "utf8");
	const occurrences =
		config.match(/src\/renderer\/browser-address-overlay-list\.html/g) ?? [];
	assert.equal(
		occurrences.length,
		2,
		"renderer input and rollupOptions.input both name the S2 document",
	);
	// Both documents are resolved by the same URL rule.
	assert.equal(
		addressListDocumentUrlFor("file:///app/out/renderer/index.html"),
		"file:///app/out/renderer/browser-address-overlay-list.html",
	);
});

test("S2 port: the no-handler latch invokes the bridge once and stops", async () => {
	let calls = 0;
	globalThis.window = {
		__loDevDriver: {
			armed: true,
			addressOverlayProject: async () => {
				calls += 1;
				throw new Error(
					"Error invoking remote method 'dev-driver-address-overlay-project': Error: No handler registered for 'dev-driver-address-overlay-project'",
				);
			},
			onAddressOverlayEvent: () => () => undefined,
		},
	};
	try {
		const port = addressOverlayPort();
		assert.ok(port, "an armed bridge exposes the port");
		await assert.rejects(port.project({ v: 1 }));
		assert.equal(calls, 1);
		// The SAME captured port must not invoke again after the latch.
		await assert.rejects(port.project({ v: 1 }));
		assert.equal(calls, 1, "the latch is checked inside the returned method");
		assert.equal(
			addressOverlayPort(),
			null,
			"the port disappears after latching",
		);
	} finally {
		globalThis.window = undefined;
	}
});

test("S2 permanent refusals are recognised, transient ones are not", () => {
	for (const reason of ["overlay_failed", "disposed", "owner_unavailable"]) {
		assert.equal(isPermanentOverlayRefusal(reason), true, reason);
	}
	for (const reason of [
		"stale_seq",
		"stale_layout",
		"stale_tab",
		"measure_viewport",
		"anchor_inconsistent",
		undefined,
		null,
		42,
	]) {
		assert.equal(isPermanentOverlayRefusal(reason), false, String(reason));
	}
});

test("S5: a stale_layout refusal keeps the frame signature, so the mirror idles", () => {
	// UX U3 (round 1): the start page and the load-failure page hide the native
	// view, so main answers `stale_layout` for as long as the user is there. If the
	// renderer cleared its signature on that answer, the RAF loop re-projected
	// every frame at a main that refused every one — the storm the reviewer
	// measured. The early return is the fix; this pins it so a later "retry on any
	// refusal" cannot quietly come back.
	const src = readFileSync(
		join(
			ROOT,
			"src/renderer/src/features/browser/overlay/use-address-overlay-mirror.ts",
		),
		"utf8",
	);
	assert.match(
		src,
		/if \(answer\.reason === "stale_layout"\) \{/,
		"stale_layout is handled before the signature reset",
	);
	assert.match(
		src,
		/nextStaleAttempt\(/,
		"the retry is the bounded budget, not a per-frame storm",
	);
	assert.match(src, /forceProject = step\.retry;/);
});

test("S5: the stale_layout budget is bounded and a real change restarts it (U11)", () => {
	let attempts = 0;
	const refused = () =>
		nextStaleAttempt({ attempts, refused: true, signatureChanged: false });
	for (let i = 0; i < STALE_LAYOUT_ATTEMPTS; i++) {
		const step = refused();
		assert.equal(step.retry, true, `attempt ${i + 1} retries`);
		attempts = step.attempts;
	}
	const spent = refused();
	assert.equal(spent.retry, false, "the budget stops the retry storm");
	assert.equal(spent.attempts, STALE_LAYOUT_ATTEMPTS);

	// A real projection change lands while the spent budget idles: it starts a new
	// budget, so the next refusal gets its retries again.
	const changed = nextStaleAttempt({
		attempts: spent.attempts,
		refused: false,
		signatureChanged: true,
	});
	assert.equal(changed.attempts, 0);
	attempts = changed.attempts;
	assert.equal(refused().retry, true, "the next condition may be retried");
});

test("S2 escaping: the sanitizer, not JSON.stringify, removes line separators", () => {
	// JSON.stringify does NOT escape these; S3/S4 must not rely on the old claim.
	const json = JSON.stringify({ a: "x\u2028y\u2029z</script>" });
	assert.ok(json.includes("\u2028"), "U+2028 survives JSON.stringify");
	assert.ok(json.includes("\u2029"), "U+2029 survives JSON.stringify");
	assert.ok(json.includes("</script>"), "</script> survives JSON.stringify");
	const result = sanitizeProjection(
		projection({
			label: "a\u2028b\u2029c",
			view: {
				kind: "rows",
				rows: [{ text: "x\u2028y", title: "p\u2029q" }],
			},
		}),
	);
	assert.equal(result.ok, true);
	assert.equal(result.projection.label, "abc");
	assert.equal(result.projection.view.rows[0].text, "xy");
	assert.equal(result.projection.view.rows[0].title, "pq");
});

/**
 * The probe harness is plain ESM, so `noUndeclaredVariables` is off and an
 * assignment to a name that was never declared fails only when that branch runs
 * — which for the operator-attended `--s3-visible` path is once, on a screen, in
 * front of a person. Round 1 shipped exactly that twice (`factsLog` in the
 * visible run, `baseline` in the S1 matrix). These are source pins, in the same
 * spirit as `launcher-watch.test.mjs`: they do not prove the branches run, they
 * prove the declarations exist and precede their first use.
 */
test("probe harness: branches that push a facts log declare it first", () => {
	const source = readFileSync(
		join(ROOT, "scripts/browser-address-overlay-probe.mjs"),
		"utf8",
	);
	const sections = [
		["async function s3VisibleRun()", "function recordRowVisible("],
		["async function drivenMatrix()", "async function windowCloseCase()"],
		[
			"async function s2RealInputMatrix()",
			"async function s2SyntheticMatrix()",
		],
	];
	for (const [startMarker, endMarker] of sections) {
		const start = source.indexOf(startMarker);
		const end = source.indexOf(endMarker);
		assert.ok(start >= 0 && end > start, `${startMarker} is a function`);
		const body = source.slice(start, end);
		const declaration = body.indexOf("const factsLog");
		assert.ok(declaration >= 0, `${startMarker} declares its facts log`);
		const firstPush = body.indexOf("factsLog.push");
		assert.ok(
			firstPush === -1 || declaration < firstPush,
			`${startMarker} declares factsLog before the first push`,
		);
	}
});

test("probe harness: the S1 20-cycle baseline is declared, not assigned", () => {
	const source = readFileSync(
		join(ROOT, "scripts/browser-address-overlay-probe.mjs"),
		"utf8",
	);
	const start = source.indexOf("async function drivenMatrix()");
	const end = source.indexOf("async function windowCloseCase()");
	const body = source.slice(start, end);
	assert.match(
		body,
		/const baseline = await evaluate\(/,
		"the S1 matrix's baseline must be a declaration; a bare assignment is a ReferenceError at run time",
	);
});
