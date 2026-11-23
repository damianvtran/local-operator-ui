import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { checkRouteFrame, readRouteFrame } from "./route-tops-geometry.mjs";

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
	} = {},
) {
	const main = make({ "data-workspace-outlet": "" }, rect(0, 192, 600, 600));
	const mainPad = fullscreen ? 8 : bandHeight > 0 ? 0 : 32;
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
		: mainPad + bandHeight;
	const band =
		owner === "outlet"
			? append(
					main,
					make({ "data-chrome-route-band": "" }, rect(0, 192, 600, bandHeight)),
				)
			: null;
	const shell = append(
		host,
		make({ "data-workspace-frame-shell": "" }, rect(top, 192, 600, 600 - top)),
	);
	const frame = append(
		shell,
		make(
			{ "data-workspace-frame": "", ...attrs },
			rect(top, 200, 584, 592 - top),
			{
				borderStartStartRadius: "10px",
				borderInlineStartWidth: "0px",
				boxShadow: "none",
				overflow: "clip",
			},
		),
	);
	const body = append(frame, make({}, rect(top, 200, 584, 592 - top)));
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
			mode: "integrated",
			fullscreen,
			band: band?.bounds ?? null,
			bandDisplay: bandHeight > 0 ? "block" : "none",
		};
	};
	return { read, main, host, chrome, shell, frame, body };
}

function failures(owner, f) {
	const result = [];
	checkRouteFrame(`/${owner}`, owner, f.read(), (label, pass) => {
		if (!pass) result.push(label);
	});
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
