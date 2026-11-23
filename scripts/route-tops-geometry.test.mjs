import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import {
	checkRouteFrame,
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
		error = false,
		native = false,
	} = {},
) {
	const main = make({ "data-workspace-outlet": "" }, rect(0, 192, 600, 600));
	const mainPad =
		fullHeight || native ? 0 : fullscreen ? 8 : bandHeight > 0 ? 0 : 32;
	const safeTop = fullscreen ? 8 : native ? 0 : bandHeight || 32;
	const marker =
		owner === "chat" ? "data-workspace-inset" : "data-workspace-browser";
	const attrs = owner === "outlet" ? {} : { [marker]: "" };
	const host =
		owner === "outlet"
			? main
			: append(
					append(
						append(main, make({}, null, { display: "contents" })),
						make({}, null, { display: "contents" }),
					),
					make({}, rect(owner === "chat" ? mainPad : 0, 192, 600, 600)),
				);
	const chromeMarker =
		owner === "chat"
			? "data-workspace-tabs"
			: pending
				? "data-browser-route-pending-chrome"
				: "data-browser-route-chrome";
	const chrome =
		owner === "outlet"
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
	const top = chrome
		? chrome.bounds.top + chrome.bounds.height
		: fullHeight
			? 0
			: mainPad + bandHeight;
	const band =
		owner === "outlet"
			? append(
					main,
					make(
						{ "data-chrome-route-band": "" },
						rect(0, 192, 600, bandHeight),
						{ position: fullHeight ? "absolute" : "static" },
					),
				)
			: null;
	const shell = append(
		host,
		make(
			{
				"data-workspace-frame-shell": "",
				...(fullHeight && { "data-workspace-frame-full-height": "" }),
			},
			rect(top, 192, 600, 600 - top),
		),
	);
	const frameHeight = (fullHeight ? 600 : 592) - top;
	const frame = append(
		shell,
		make(
			{ "data-workspace-frame": "", ...attrs },
			rect(top, 200, 584, frameHeight),
			{
				borderStartStartRadius: "10px",
				borderInlineStartWidth: "0px",
				boxShadow: "none",
				overflow: "clip",
			},
		),
	);
	const fallback = pending
		? "data-workspace-route-pending"
		: error
			? "data-workspace-route-error"
			: null;
	const body = append(
		frame,
		make(
			fullHeight && fallback
				? { [fallback]: "", "data-workspace-safe-content": "" }
				: {},
			rect(top, 200, 584, frameHeight),
			{ paddingTop: `${fullHeight && fallback ? safeTop : 0}px` },
		),
	);
	const pane = (role, left, width) =>
		append(
			body,
			make(
				{ "data-glass-region": role, "data-workspace-safe-content": "" },
				rect(top, left, width, frameHeight),
				{ paddingTop: `${safeTop}px` },
			),
		);
	const panes = fullHeight
		? fallback
			? [body]
			: [pane("page-sidebar", 200, 130), pane("canvas-content", 330, 454)]
		: [];
	for (const pane of panes) {
		const { left, width } = pane.bounds;
		append(pane, make({}, rect(top, left, 1, 1), { position: "absolute" })); // sr-only heading
		append(
			pane,
			make({}, rect(top + safeTop, left, width, frameHeight - safeTop)),
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
		"/browser: the frame keeps 8px side gutters, an 8px bottom gutter and no extra top gap",
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

test("full-height split geometry keeps y0, the window end and one native inset in all shell phases", () => {
	for (const chrome of [
		{},
		{ bandHeight: 40 },
		{ fullscreen: true },
		{ native: true },
	]) {
		for (const phase of [{}, { pending: true }, { error: true }]) {
			const f = fixture("outlet", { fullHeight: true, ...chrome, ...phase });
			assert.deepEqual(
				failures("outlet", f),
				[],
				JSON.stringify({ chrome, phase }),
			);
		}
	}
});

test("the geometry check rejects offset paint, doubled internal padding, missing pane ownership and flow bands", () => {
	const y = fixture("outlet", { fullHeight: true });
	y.frame.bounds.top += 1;
	assert.match(failures("outlet", y)[0], /split paint starts at y0/);
	const control = fixture("outlet", { fullHeight: true });
	control.panes[0].fixtureStyle.paddingTop = "64px";
	assert.match(
		failures("outlet", control)[0],
		/each painted column clears native chrome once/,
	);
	const startsUnderTheLane = fixture("outlet", { fullHeight: true });
	startsUnderTheLane.panes[0].lastElementChild.bounds.top = 31;
	assert.match(
		failures("outlet", startsUnderTheLane)[0],
		/each painted column clears native chrome once/,
	);
	startsUnderTheLane.panes[0].lastElementChild.bounds.top = 64;
	assert.match(
		failures("outlet", startsUnderTheLane)[0],
		/each painted column clears native chrome once/,
	);
	const owner = fixture("outlet", { fullHeight: true });
	owner.panes[0].removeAttribute("data-workspace-safe-content");
	assert.match(
		failures("outlet", owner)[0],
		/each painted column clears native chrome once/,
	);
	const flowBand = fixture("outlet", { fullHeight: true, bandHeight: 40 });
	flowBand.band.fixtureStyle.position = "static";
	assert.match(failures("outlet", flowBand)[0], /split paint starts at y0/);
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
	// The outlet's intentional clear glass above a shared inset is unchanged:
	// no DOM paint inside that outlet, and only there.
	const clear = { x: 690, bg: null, tag: null, inOutlet: true };
	assert.equal(accepted(clear, recorded["/settings"], "outlet", false), true);
	assert.equal(
		accepted(
			{ ...clear, inOutlet: false },
			recorded["/settings"],
			"outlet",
			false,
		),
		false,
	);
	assert.equal(stripAboveInset(recorded["/settings"], "outlet", true), false);
	assert.equal(stripAboveInset(recorded["/chat"], "chat", false), false);
	assert.equal(stripAboveInset(recorded["/settings"], "outlet", false), true);
});
