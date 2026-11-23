import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import {
	checkRouteFrame,
	findLeadingColumn,
	insetBandGround,
	readRouteFrame,
	stripAboveInset,
	stripPanelGrounds,
	stripProbeAccepted,
} from "./route-tops-geometry.mjs";

const rect = (top, left, width, height) => ({ top, left, width, height });
const surface = "rgb(40, 39, 38)";
const rawSurface = "color(srgb 0.16 0.15 0.15 / 0.8)";
const transparent = "rgba(0, 0, 0, 0)";
const clip = "shape(from 0px 0px, hline to 18px, close)";
// Use real DOM selectors; only geometry and CSS readback are synthetic.
const make = (attributes = {}, bounds = null, style = {}) => {
	const el = JSDOM.fragment("<div></div>").firstElementChild;
	for (const [name, value] of Object.entries(attributes))
		el.setAttribute(name, value);
	el.bounds = bounds;
	el.fixtureStyle = {
		display: "block",
		visibility: "visible",
		paddingTop: "0px",
		...style,
	};
	return el;
};
const append = (parent, child) => {
	parent.append(child);
	return child;
};

function fixture(
	owner,
	{
		pending = false,
		glass = false,
		supported = true,
		bandHeight = 0,
		fullscreen = false,
		fullHeight = false,
		hideSidebar = false,
		error = false,
		native = false,
	} = {},
) {
	const main = make(
		{
			"data-workspace-outlet": "",
			...(fullHeight && { "data-workspace-full-height": "" }),
		},
		rect(0, 192, 600, 600),
	);
	const mainPad =
		fullHeight || native ? 0 : fullscreen ? 8 : bandHeight > 0 ? 0 : 32;
	const safeTop = fullscreen ? 8 : native ? 0 : bandHeight || 32;
	const fallback = pending
		? "data-workspace-route-pending"
		: error
			? "data-workspace-route-error"
			: null;
	const marker =
		owner === "chat"
			? "data-workspace-inset"
			: owner === "browser"
				? "data-workspace-browser"
				: owner === "split"
					? "data-workspace-split-inset"
					: null;
	const attrs = {
		...(marker && { [marker]: "" }),
		...(owner === "split" && { "data-glass-region": "canvas-content" }),
	};
	const band =
		owner === "outlet" || owner === "split"
			? append(
					main,
					make(
						{ "data-chrome-route-band": "" },
						rect(0, 192, 600, bandHeight),
						{ position: fullHeight ? "absolute" : "static" },
					),
				)
			: null;
	const contentsSlot =
		owner === "outlet"
			? main
			: append(
					append(main, make({}, null, { display: "contents" })),
					make({}, null, { display: "contents" }),
				);
	const host =
		owner === "outlet"
			? main
			: owner === "split"
				? fallback
					? contentsSlot
					: append(
							contentsSlot,
							make({ "data-glass-split": "" }, rect(0, 192, 600, 600)),
						)
				: append(
						contentsSlot,
						make({}, rect(owner === "chat" ? mainPad : 0, 192, 600, 600)),
					);
	const chromeMarker =
		owner === "chat"
			? "data-workspace-tabs"
			: pending
				? "data-browser-route-pending-chrome"
				: "data-browser-route-chrome";
	const chrome =
		owner === "outlet" || owner === "split"
			? null
			: append(
					host,
					make(
						{ [chromeMarker]: "" },
						rect(
							owner === "chat" && fullscreen ? mainPad : 0,
							192,
							600,
							owner === "chat" ? 32 : 106,
						),
						{
							paddingTop:
								owner === "browser" && !pending ? `${mainPad}px` : "0px",
						},
					),
				);
	const sidebarWidth = owner === "split" && !fallback && !hideSidebar ? 130 : 0;
	const sidebar =
		sidebarWidth > 0
			? append(
					host,
					make(
						{
							"data-glass-region": "page-sidebar",
							"data-workspace-safe-content": "",
						},
						rect(0, 192, sidebarWidth, 600),
						{ paddingTop: `${safeTop}px` },
					),
				)
			: null;
	if (sidebar) {
		append(sidebar, make({}, rect(0, 192, 1, 1), { position: "absolute" }));
		append(sidebar, make({}, rect(safeTop, 192, sidebarWidth, 600 - safeTop)));
	}
	const top = chrome
		? chrome.bounds.top + chrome.bounds.height
		: fullHeight
			? 0
			: mainPad + bandHeight;
	const shellLeft = 192 + sidebarWidth;
	const shellWidth = 600 - sidebarWidth;
	const shell = append(
		host,
		make(
			{
				"data-workspace-frame-shell": "",
				...(fullHeight && { "data-workspace-frame-full-height": "" }),
			},
			rect(top, shellLeft, shellWidth, 600 - top),
		),
	);
	const frameTop = top + (fullHeight ? 8 : 0);
	const frameHeight = 600 - top - (fullHeight ? 16 : 8);
	const frame = append(
		shell,
		make(
			{ "data-workspace-frame": "", ...attrs },
			rect(frameTop, shellLeft + 8, shellWidth - 16, frameHeight),
			{
				borderStartStartRadius: "10px",
				borderInlineStartWidth: "0px",
				boxShadow: "none",
				overflow: "clip",
			},
		),
	);
	const insetPad = Math.max(0, safeTop - 8);
	const body = append(
		frame,
		make(
			fullHeight
				? fallback
					? { [fallback]: "", "data-workspace-safe-content": "" }
					: { "data-workspace-safe-content": "" }
				: {},
			rect(frameTop, shellLeft + 8, shellWidth - 16, frameHeight),
			{ paddingTop: `${fullHeight ? insetPad : 0}px` },
		),
	);
	const panes = fullHeight ? [...(sidebar ? [sidebar] : []), body] : [];
	if (fullHeight) {
		const { left, width } = body.bounds;
		append(
			body,
			make({}, rect(frameTop, left, 1, 1), { position: "absolute" }),
		); // sr-only heading
		append(
			body,
			make({}, rect(frameTop + insetPad, left, width, frameHeight - insetPad)),
		);
	}
	shell.perimeterStyle = supported
		? {
				content: '""',
				display: "block",
				clipPath: clip,
				backgroundColor: glass ? rawSurface : surface,
			}
		: {
				content: "none",
				display: "inline",
				clipPath: "none",
				backgroundColor: transparent,
			};
	const { document } = new JSDOM().window;
	if (glass)
		document.documentElement.setAttribute("data-glass", "sidebar pane");
	document.body.append(main);
	// Run the serialized function exactly as the CDP template does: no ESM
	// lexical scope is available to the measured side of the harness.
	const read = () => {
		const { route, geometry } = runInNewContext(
			`(${readRouteFrame})(document, main, box, roleGround)`,
			{
				document,
				main,
				box: (el) => el?.bounds ?? null,
				roleGround: (role) =>
					role === "--lo-glass-g-surface" ? rawSurface : surface,
				getComputedStyle: (el, pseudo) =>
					pseudo === "::before" ? el.perimeterStyle : el.fixtureStyle,
				CSS: {
					supports(property, value) {
						assert.equal(property, "clip-path");
						assert.match(value, /^shape\(/);
						return supported;
					},
				},
			},
		);
		return {
			...geometry,
			route: route?.bounds ?? null,
			main: main.bounds,
			mainPad,
			mode: native ? "native" : "integrated",
			fullscreen,
			lane:
				fullHeight && !fullscreen && !native && !bandHeight
					? rect(0, 0, 792, 32)
					: null,
			laneDisplay:
				fullHeight && !fullscreen && !native && !bandHeight ? "block" : "none",
			viewport: { height: 600 },
			band: band?.bounds ?? null,
			bandDisplay: bandHeight > 0 ? "block" : "none",
		};
	};
	return {
		read,
		main,
		host,
		chrome,
		sidebar,
		shell,
		frame,
		body,
		band,
		panes,
		fullHeight,
	};
}

function failures(owner, f) {
	const result = [];
	checkRouteFrame(
		`/${owner}`,
		owner,
		f.read(),
		(label, pass) => {
			if (!pass) result.push(label);
		},
		f.fullHeight,
	);
	return result;
}

test("one visible body passes for outlet, Chat and Browser; hidden pending copies aren't visible frames", () => {
	for (const [owner, options] of [
		["outlet", {}],
		["outlet", { bandHeight: 40 }],
		["chat", { glass: true }],
		["chat", { fullscreen: true }],
		["browser", {}],
		["browser", { pending: true }],
	]) {
		const f = fixture(owner, options);
		append(
			f.host,
			make({ "data-workspace-frame": "" }, f.frame.bounds, {
				visibility: "hidden",
			}),
		);
		assert.deepEqual(
			failures(owner, f),
			[],
			`${owner} ${JSON.stringify(options)}`,
		);
		assert.equal(f.read().outletFrames, owner === "outlet" ? 1 : 0);
		assert.equal(f.read().effectiveFrames, 1);
	}
});

test("missing, duplicated and wrongly placed chrome-owned frames fail the same scope as the scene", () => {
	for (const owner of ["chat", "browser"]) {
		const f = fixture(owner);
		const outletShell = append(
			f.main,
			make({ "data-workspace-frame-shell": "" }, f.shell.bounds),
		);
		const duplicate = append(
			outletShell,
			make({ "data-workspace-frame": "" }, f.frame.bounds),
		);
		assert.equal(f.read().effectiveFrames, 2);
		assert.match(failures(owner, f)[0], /one visible workspace frame/);
		duplicate.fixtureStyle.visibility = "hidden";
		assert.equal(f.read().effectiveFrames, 1);
		assert.deepEqual(failures(owner, f), [
			`/${owner}: ${owner} owns the one visible workspace frame`,
		]);
		f.frame.bounds.height = 0;
		assert.equal(f.read().effectiveFrames, 0);
		assert.match(failures(owner, f)[0], /one visible workspace frame/);
	}
});

test("a second clearance, detached chrome, or widened gutter fails geometry", () => {
	const outlet = fixture("outlet");
	outlet.body.bounds.top += 32;
	assert.deepEqual(failures("outlet", outlet), [
		"/outlet: the outlet uses one clearance and the route body starts at the frame top",
	]);
	const chat = fixture("chat");
	chat.chrome.bounds.top += 32;
	assert.deepEqual(failures("chat", chat), [
		"/chat: one clearance with route chrome outside and directly above its body frame",
	]);
	const browser = fixture("browser");
	browser.frame.bounds.left += 1;
	assert.deepEqual(failures("browser", browser), [
		"/browser: the frame keeps 8px side and bottom gutters and no extra top gap",
	]);
});

test("Browser status chrome may consume a row, but not a gap before the body", () => {
	const f = fixture("browser");
	const top = f.frame.bounds.top;
	const row = append(
		f.host,
		make({ "data-tour-tag": "browser-error" }, rect(top, 192, 600, 24)),
	);
	f.shell.before(row);
	for (const el of [f.shell, f.frame]) {
		el.bounds.top += row.bounds.height;
		el.bounds.height -= row.bounds.height;
	}
	assert.deepEqual(failures("browser", f), []);
	row.bounds.top += 1;
	assert.deepEqual(failures("browser", f), [
		"/browser: one clearance with route chrome outside and directly above its body frame",
	]);
});

test("computed gutter paint distinguishes correct raw surface, missing clip, and unsupported shape()", () => {
	const on = fixture("chat", { glass: true });
	assert.equal(on.read().perimeter.role, "--lo-glass-g-surface");
	assert.deepEqual(failures("chat", on), []);
	on.shell.perimeterStyle.clipPath = "none";
	assert.match(failures("chat", on)[0], /computed gutter paint/);
	on.shell.perimeterStyle.clipPath = clip;
	on.shell.perimeterStyle.backgroundColor = surface;
	assert.match(failures("chat", on)[0], /computed gutter paint/);
	const off = fixture("outlet", { supported: false });
	assert.deepEqual(failures("outlet", off), []);
	off.shell.perimeterStyle.content = '""';
	assert.match(failures("outlet", off)[0], /computed gutter paint/);
});

test("full-height split geometry keeps full-height sidebar, even 8px inset gutters and one native clearance in all shell phases", () => {
	for (const chrome of [
		{},
		{ bandHeight: 40 },
		{ fullscreen: true },
		{ native: true },
	]) {
		for (const phase of [
			{},
			{ hideSidebar: true },
			{ pending: true },
			{ error: true },
		]) {
			const f = fixture("split", { fullHeight: true, ...chrome, ...phase });
			assert.deepEqual(
				failures("split", f),
				[],
				JSON.stringify({ chrome, phase }),
			);
		}
	}
});

test("the geometry check rejects offset inset gutters, doubled internal padding, missing pane ownership and flow bands", () => {
	const y = fixture("split", { fullHeight: true });
	y.frame.bounds.top = 0;
	assert.match(
		failures("split", y).join("\n"),
		/8px side and bottom gutters and an 8px top gutter/,
	);
	const sidebarOffset = fixture("split", { fullHeight: true });
	sidebarOffset.sidebar.bounds.top = 8;
	assert.match(
		failures("split", sidebarOffset)[0],
		/split route reaches y0 and bottom/,
	);
	const control = fixture("split", { fullHeight: true });
	control.panes[0].fixtureStyle.paddingTop = "64px";
	assert.match(
		failures("split", control)[0],
		/each split column clears native chrome once/,
	);
	const insetDoublePad = fixture("split", { fullHeight: true });
	insetDoublePad.body.fixtureStyle.paddingTop = "32px";
	assert.match(
		failures("split", insetDoublePad)[0],
		/each split column clears native chrome once/,
	);
	const startsUnderTheLane = fixture("split", { fullHeight: true });
	startsUnderTheLane.body.lastElementChild.bounds.top = 31;
	assert.match(
		failures("split", startsUnderTheLane)[0],
		/each split column clears native chrome once/,
	);
	startsUnderTheLane.body.lastElementChild.bounds.top = 64;
	assert.match(
		failures("split", startsUnderTheLane)[0],
		/each split column clears native chrome once/,
	);
	const owner = fixture("split", { fullHeight: true });
	owner.panes[0].removeAttribute("data-workspace-safe-content");
	assert.match(
		failures("split", owner)[0],
		/each split column clears native chrome once/,
	);
	const flowBand = fixture("split", { fullHeight: true, bandHeight: 40 });
	flowBand.band.fixtureStyle.position = "static";
	assert.match(
		failures("split", flowBand)[0],
		/split route reaches y0 and bottom/,
	);
	const normal = fixture("outlet");
	normal.shell.setAttribute("data-workspace-frame-full-height", "");
	assert.match(failures("outlet", normal)[0], /only the named split routes/);
});

/*
 * RECORDED READINGS, NOT SYNTHESISED. QA round 6 measured four failures of the
 * y8 strip check on 881ba1cb - /settings, /settings?section=integrations,
 * /agents and /agents/local-operator - and all four were the same probe at
 * x=1376 reporting `bg:null, inOutlet:true` while that head's pixels and the
 * pre-change frames showed the gutter going from transparent to painted. These
 * are those readings as the driver logged them, with /chat and /browser beside
 * them as the control rows the fix must not move.
 */
const recorded = JSON.parse(
	readFileSync("scripts/fixtures/route-tops-strip-qa6-readings.json", "utf8"),
).readings;
const SPLIT_ROUTES = [
	"/settings",
	"/settings?section=integrations",
	"/agents",
	"/agents/local-operator",
];
/*
 * THE PREDICATE AS IT STOOD BEFORE THE FIX, kept as a control rather than
 * described: a row that passed then is compared probe by probe against the new
 * one, which is how "this only widens the full-height case" is proved instead
 * of asserted.
 */
function beforeFix(probe, reading, owner, fullHeight) {
	if (stripAboveInset(reading, owner, fullHeight) && probe.inOutlet)
		return probe.bg === null;
	return (
		stripPanelGrounds(reading).includes(probe.bg) ||
		(owner === "browser" &&
			probe.inOutlet &&
			probe.bg === reading.browserChromeGround)
	);
}
const verdicts = (reading, owner, fullHeight) =>
	reading.stripGrounds.map((probe) =>
		stripProbeAccepted(probe, reading, { owner, fullHeight }),
	);
const accepted = (probe, reading, owner, fullHeight) =>
	stripProbeAccepted(probe, reading, { owner, fullHeight });

test("the recorded split readings accept the gutter probe their shell's ::before paints", () => {
	for (const path of SPLIT_ROUTES) {
		const reading = recorded[path];
		assert.equal(reading.fullHeight, true, path);
		// The fixture has to keep being the false red QA measured, or the
		// positive case below proves nothing.
		assert.deepEqual(
			reading.stripGrounds.filter(
				(probe) => !beforeFix(probe, reading, "outlet", true),
			),
			[{ x: 1376, bg: null, tag: null, inOutlet: true }],
			path,
		);
		assert.deepEqual(
			verdicts(reading, "outlet", true),
			reading.stripGrounds.map(() => true),
			path,
		);
	}
});

test("the gutter case fails for an ungenerated, hidden, unpainted or mis-roled perimeter", () => {
	const gutter = { x: 1376, bg: null, tag: null, inOutlet: true };
	const rejected = (label, change = () => {}, probe = gutter) => {
		const reading = structuredClone(recorded["/settings"]);
		change(reading);
		assert.equal(
			accepted(probe, reading, "outlet", true),
			false,
			`${label} must not pass`,
		);
	};
	assert.equal(
		accepted(gutter, recorded["/settings"], "outlet", true),
		true,
		"the recorded reading itself passes",
	);
	rejected("a shell that generates no pseudo", (r) => {
		r.perimeter.content = "none";
	});
	rejected("a pseudo the shell hides", (r) => {
		r.perimeter.display = "none";
	});
	rejected("a gutter with no paint", (r) => {
		r.perimeter.paint = null;
	});
	rejected("a transparent gutter", (r) => {
		r.perimeter.paint = "rgba(0, 0, 0, 0)";
	});
	// Paint that is a real panel ground but not the role's own: the gutter would
	// be a different tone from the surface it is meant to continue.
	rejected("paint that is not the role's paint", (r) => {
		r.perimeter.paint = r.canvasGround;
	});
	// Paint consistent with the role but a role no ground carries.
	rejected("paint no panel ground carries", (r) => {
		r.perimeter.paint = "color(srgb 1 0 0 / 0.5)";
		r.perimeter.rolePaint = "color(srgb 1 0 0 / 0.5)";
	});
	// A covering element reports its OWN paint, which the panel rules judge.
	rejected("an out-of-flow element covering the gutter", () => {}, {
		...gutter,
		bg: "rgb(255, 0, 0)",
		tag: "div",
	});
	// Inside the frame no pseudo paints, so a hole there is still a hole.
	rejected("a hole inside the frame's own body", () => {}, {
		x: 690,
		bg: null,
		tag: null,
		inOutlet: true,
	});
	assert.equal(
		accepted(
			{ ...gutter, inOutlet: false },
			recorded["/settings"],
			"outlet",
			true,
		),
		false,
		"a gutter probe outside the outlet",
	);
	for (const x of [100, 2000])
		assert.equal(
			accepted({ ...gutter, x }, recorded["/settings"], "outlet", true),
			false,
			`x${x} is outside the shell's own ring`,
		);
	// The branch is scoped to the full-height routes: Chat's strip is its own,
	// and Browser's is covered by chrome, so neither may borrow the gutter rule.
	for (const [path, owner] of [
		["/chat", "chat"],
		["/browser", "browser"],
	])
		assert.equal(
			accepted(gutter, recorded[path], owner, false),
			false,
			`${path} must not accept a no-paint strip probe`,
		);
});

test("full-height split inset accepts top-gutter and corner-spandrel probes while rejecting interior holes", () => {
	const splitReading = {
		...structuredClone(recorded["/settings"]),
		shell: { left: 412, top: 0, width: 968, height: 900 },
		frame: { left: 420, top: 8, width: 952, height: 884 },
	};
	// Side gutter (left and right of inset frame)
	assert.equal(
		accepted(
			{ x: 416, y: 8, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		true,
	);
	assert.equal(
		accepted(
			{ x: 1376, y: 8, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		true,
	);
	// Top gutter above frame (y=4 < frame.top=8)
	assert.equal(
		accepted(
			{ x: 800, y: 4, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		true,
	);
	// Top-left and top-right 10px corner spandrels at y=8
	assert.equal(
		accepted(
			{ x: 421, y: 8, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		true,
	);
	assert.equal(
		accepted(
			{ x: 1371, y: 8, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		true,
	);
	// Interior of rounded frame at y=8 (past corner radius) must still reject bg: null
	assert.equal(
		accepted(
			{ x: 800, y: 8, bg: null, tag: null, inOutlet: true },
			splitReading,
			"split",
			true,
		),
		false,
	);
});

test("the recorded Chat and Browser strips read exactly as they did before the fix", () => {
	for (const [path, owner] of [
		["/chat", "chat"],
		["/browser", "browser"],
	]) {
		const reading = recorded[path];
		assert.equal(reading.fullHeight, false, path);
		assert.deepEqual(
			verdicts(reading, owner, false),
			reading.stripGrounds.map((probe) =>
				beforeFix(probe, reading, owner, false),
			),
			path,
		);
		assert.deepEqual(
			verdicts(reading, owner, false),
			reading.stripGrounds.map(() => true),
			path,
		);
	}
	// Browser's opaque pending chrome is sunken, not the elevated body under it.
	const browser = structuredClone(recorded["/browser"]);
	const chrome = {
		x: 1376,
		bg: browser.browserChromeGround,
		tag: "div",
		inOutlet: true,
	};
	assert.equal(accepted(chrome, browser, "browser", false), true);
	assert.equal(
		accepted(chrome, browser, "outlet", false),
		false,
		"the sunken chrome ground is Browser's alone",
	);
	assert.equal(stripAboveInset(recorded["/settings"], "outlet", true), false);
	assert.equal(stripAboveInset(recorded["/chat"], "chat", false), false);
	assert.equal(stripAboveInset(recorded["/settings"], "outlet", false), true);
});

test("findLeadingColumn descends past full-width bg-surface split roots under glass-off and finds leading columns under glass-on", () => {
	const box = (el) => el?.bounds ?? null;
	const paintedGroundOf = (el) => el?.fixtureStyle?.backgroundColor ?? null;
	const elevated = "rgb(52, 50, 48)";
	const glassSurface = "color(srgb 0.16 0.15 0.15 / 0.8)";
	const serializeFind = (ownRoot, grounds) =>
		runInNewContext(
			`(${findLeadingColumn})(ownRoot, box, paintedGroundOf, grounds)`,
			{
				ownRoot,
				box,
				paintedGroundOf,
				grounds,
			},
		);

	// 1. Settings / LegacyAgents shape with glass off: full-width [data-glass-split]
	// root paints surface, wrapper child is transparent, <aside> grandchild paints surface.
	const settingsRoot = make(
		{ "data-glass-split": "" },
		rect(0, 192, 1000, 800),
		{ backgroundColor: surface },
	);
	const railWrap = append(
		settingsRoot,
		make({}, rect(0, 192, 220, 800), { backgroundColor: transparent }),
	);
	const settingsAside = append(
		railWrap,
		make({ "data-glass-region": "page-sidebar" }, rect(0, 192, 220, 800), {
			backgroundColor: surface,
		}),
	);
	append(
		settingsRoot,
		make({ "data-workspace-frame-shell": "" }, rect(0, 412, 780, 800), {
			backgroundColor: transparent,
		}),
	);
	assert.equal(
		serializeFind(settingsRoot, [surface, elevated]),
		settingsAside,
		"glass-off split root carrying bg-surface must still locate nested leading column",
	);

	// 2. AgentsPage shape with glass off: sr-only heading precedes <aside> under bg-surface root.
	const agentsRoot = make({ "data-glass-split": "" }, rect(0, 192, 1000, 800), {
		backgroundColor: surface,
	});
	append(
		agentsRoot,
		make({}, rect(0, 192, 1, 1), { backgroundColor: transparent }),
	);
	const agentsAside = append(
		agentsRoot,
		make({ "data-glass-region": "page-sidebar" }, rect(0, 192, 280, 800), {
			backgroundColor: surface,
		}),
	);
	assert.equal(
		serializeFind(agentsRoot, [surface, elevated]),
		agentsAside,
		"glass-off Agents split root must skip sr-only heading to find leading aside",
	);

	// 3. Split route under glass on: transparent root, leading aside paints glass surface.
	settingsRoot.fixtureStyle.backgroundColor = transparent;
	settingsAside.fixtureStyle.backgroundColor = glassSurface;
	assert.equal(
		serializeFind(settingsRoot, [surface, elevated, glassSurface]),
		settingsAside,
		"glass-on split route must locate leading column painted in --lo-glass-g-surface",
	);

	// 4. Control: full-width elevated pane (/browser) must return null.
	const browserRoot = make({}, rect(0, 192, 1000, 800), {
		backgroundColor: elevated,
	});
	append(
		browserRoot,
		make({}, rect(0, 192, 1000, 800), { backgroundColor: elevated }),
	);
	assert.equal(
		serializeFind(browserRoot, [surface, elevated]),
		null,
		"full-width elevated pane must not be classified as a leading column",
	);

	// 5. Control: non-full-height card (/schedules) must return null.
	const schedulesRoot = make({}, rect(0, 192, 1000, 800), {
		backgroundColor: transparent,
	});
	append(
		schedulesRoot,
		make({}, rect(32, 192, 320, 200), { backgroundColor: surface }),
	);
	assert.equal(
		serializeFind(schedulesRoot, [surface, elevated]),
		null,
		"partial-height panel must not be classified as a leading column",
	);
});

/*
 * THE BAND ABOVE AN ORDINARY INSET (design round 7, D2). Before this round a
 * probe in that band was accepted when it read NO paint - the exemption that
 * let 32px of bare window material pass above a frame whose side and bottom
 * gutters were painted. `beforeFix` is that predicate, kept as the negative
 * control: it accepts the clear band, the new one must not.
 */
test("the band above an ordinary inset must carry the gutter's paint; clear glass now fails", () => {
	const reading = recorded["/settings"];
	const gutter = reading.perimeter.paint;
	assert.equal(insetBandGround(reading), gutter);
	const clear = { x: 690, bg: null, tag: null, inOutlet: true };
	const painted = { x: 690, bg: gutter, tag: "div", inOutlet: true };
	// Negative control: the old exemption passed exactly the hole.
	assert.equal(beforeFix(clear, reading, "outlet", false), true);
	assert.equal(accepted(clear, reading, "outlet", false), false);
	assert.equal(accepted(painted, reading, "outlet", false), true);
	// A panel ground that is NOT the gutter's (the canvas, an opaque surface)
	// is a different role in the band, not a match.
	for (const bg of [reading.canvasGround, reading.surfaceGround])
		assert.equal(accepted({ ...painted, bg }, reading, "outlet", false), false);
	// With no real gutter paint there is nothing the band may match.
	for (const [label, change] of [
		[
			"no perimeter",
			(r) => {
				r.perimeter = null;
			},
		],
		[
			"hidden perimeter",
			(r) => {
				r.perimeter.display = "none";
			},
		],
		[
			"transparent gutter",
			(r) => {
				r.perimeter.paint = "rgba(0, 0, 0, 0)";
			},
		],
		[
			"mis-roled gutter",
			(r) => {
				r.perimeter.rolePaint = r.canvasGround;
			},
		],
	]) {
		const broken = structuredClone(reading);
		change(broken);
		assert.equal(insetBandGround(broken), null, label);
		assert.equal(
			accepted({ ...painted }, broken, "outlet", false),
			false,
			label,
		);
	}
});

/*
 * The band's paint and geometry at source: one in-flow element, net-zero in
 * height (so the frame keeps y32), the same glass selector list as the gutter
 * pseudo, no app-region of its own, and only where the outlet draws the inset.
 */
test("the inset band is painted by the gutter's own glass rule and moves nothing", () => {
	const appSource = readFileSync("src/renderer/src/app.tsx", "utf8");
	const css = readFileSync("src/renderer/src/styles/index.css", "utf8");
	assert.match(
		appSource,
		/\{outletWrapsRoute \? \(\s*<div data-workspace-top-band="" aria-hidden="true" \/>\s*\) : null\}\s*\{\/\* Trailing caption buttons/,
	);
	const rule = css.match(/\n\t\[data-workspace-top-band\] \{([^}]+)\}/);
	assert.ok(rule, "band rule present");
	const pad = "var(--panel-top-pad, var(--chrome-strip-h, 0px))";
	assert.ok(rule[1].includes(`height: ${pad};`), rule[1]);
	assert.ok(
		rule[1]
			.replace(/\s+/g, " ")
			.includes(`margin-block-start: calc( -1 * ${pad} );`),
		rule[1],
	);
	assert.doesNotMatch(rule[1], /app-region|pointer-events/);
	const glass = css.match(
		/html\[data-glass~="sidebar"\] \.workspace-frame-shell::before,([^{]+)\{/,
	);
	assert.ok(glass, "shared glass rule present");
	assert.match(
		glass[1],
		/html\[data-glass~="sidebar"\] \[data-workspace-top-band\]/,
	);
	assert.doesNotMatch(css, /\[data-workspace-top-band\][^{]*\{[^}]*app-region/);
});
