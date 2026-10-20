/**
 * Fork auto-tagging: the setting's intent, the capability gate, the wire field
 * and the View-options row that reads them.
 *
 *     node --test scripts/sidebar-tag-auto.test.mjs
 *
 * WHY THE GATE IS TESTED, not only the happy path: the core's request models
 * inherit `extra="forbid"`, so `auto_tag` sent to a backend that predates the
 * field is a 422 and the FORK FAILS. The two negative cases below - a backend
 * without `session_tags_auto_tag` and an unanswered capability read - are the
 * ones that would break forking for every client if the row or the field
 * stopped being gated. The catalogue key (`session_tags`) is asserted NOT to
 * be a substitute, because that is the split the core chose.
 *
 * WHAT IT CANNOT SAY: that the row's helper wraps to the height budget, or how
 * the switch looks. Those are pixels and belong to the rendered frames and the
 * independent QA pass; the DOM half here proves only the control, its label
 * connection and the write it makes.
 */

import assert from "node:assert/strict";
import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const name of [
	"window",
	"document",
	"localStorage",
	"Node",
	"Element",
	"HTMLElement",
	"HTMLFormElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"InputEvent",
	"FocusEvent",
	"MutationObserver",
	"getComputedStyle",
])
	globalThis[name] =
		dom.window[name] ?? dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const dir = resolve("node_modules/.cache/tag-auto-tests");
await mkdir(dir, { recursive: true });
const bundlePath = `${dir}/auto-${process.pid}.mjs`;
await build({
	stdin: {
		contents: `
export * from "./src/renderer/src/features/chat/chat-auto-tag";
export {DEFAULT_SIDEBAR_VIEW, parseSidebarView} from "./src/renderer/src/features/chat/chat-sidebar-view";
export {desktopEndpoint} from "./src/shared/desktop-contract";
export {ChatSidebarViewMenu} from "./src/renderer/src/features/chat/components/chat-sidebar-view-menu";
export {setLocale} from "./src/i18n";
`,
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": resolve("src/renderer/src/features"),
		"@shared": resolve("src/renderer/src/shared"),
	},
	bundle: true,
	jsx: "automatic",
	packages: "external",
	platform: "node",
	format: "esm",
	outfile: bundlePath,
	logLevel: "silent",
});
const {
	AUTO_TAG_MINIMUM_VERSION,
	ChatSidebarViewMenu,
	DEFAULT_SIDEBAR_VIEW,
	autoTagSupported,
	desktopEndpoint,
	forkAutoTag,
	setLocale,
} = await import(pathToFileURL(bundlePath));
const root = createRoot(document.getElementById("root"));
after(async () => {
	await act(() => root.unmount());
	await unlink(bundlePath);
	dom.window.close();
});

setLocale("en");

const capabilities = (features, desktop_available = true) => ({
	desktop_contract: 1,
	desktop_available,
	desktop_auth: "bearer",
	features,
});

const request = (over = {}) => ({
	op: "sessions.fork",
	sessionId: "session-1",
	requestId: "5b1f6d9a-0000-4000-8000-000000000000",
	...over,
});

/* ------------------------------------------------------ the capability gate */

test("only a backend advertising session_tags_auto_tag is offered the field", () => {
	assert.equal(AUTO_TAG_MINIMUM_VERSION, 1);
	assert.equal(autoTagSupported(undefined), false);
	assert.equal(autoTagSupported(null), false);
	assert.equal(autoTagSupported(capabilities({}, false)), false);
	// The catalogue key alone is NOT the fork field's key: a daemon with tags
	// and without auto-tagging keeps its whole tag surface and never sees this
	// request key. This assertion is the regression the split exists for.
	assert.equal(autoTagSupported(capabilities({ session_tags: 1 })), false);
	assert.equal(
		autoTagSupported(capabilities({ session_tags: 1 }, false)),
		false,
	);
	assert.equal(
		autoTagSupported(capabilities({ session_tags_auto_tag: 1 })),
		true,
	);
	// A later version still understands the field; the gate is a floor.
	assert.equal(
		autoTagSupported(capabilities({ session_tags_auto_tag: 2 })),
		true,
	);
});

test("the intent is the design's one conjunction, and absence without the gate", () => {
	const view = (over = {}) => ({ ...DEFAULT_SIDEBAR_VIEW, ...over });
	assert.equal(forkAutoTag(view(), true), false, "defaults: tags off");
	// `DEFAULT_SIDEBAR_VIEW.tagsEnabled` is false, so the pair below is false.
	assert.equal(
		forkAutoTag(view({ tagsEnabled: true }), true),
		true,
		"tags on, auto on",
	);
	assert.equal(
		forkAutoTag(view({ tagsEnabled: true, autoTagForks: false }), true),
		false,
		"tags on, auto off",
	);
	assert.equal(
		forkAutoTag(view({ tagsEnabled: false, autoTagForks: true }), true),
		false,
		"tags off never auto-tags",
	);
	// The unsupported arm is `undefined`, not `false`: the key must be ABSENT
	// from the body rather than sent as a value an old `Fork` model refuses.
	assert.equal(forkAutoTag(view({ tagsEnabled: true }), false), undefined);
});

/* ----------------------------------------------------------- the wire body */

test("auto_tag travels with the fork body, and only when given", () => {
	const withTrue = desktopEndpoint(request({ autoTag: true }));
	assert.equal(withTrue.path, "/v1/desktop/sessions/session-1/fork");
	assert.equal(withTrue.method, "POST");
	assert.equal(withTrue.body.auto_tag, true);

	const withFalse = desktopEndpoint(request({ autoTag: false }));
	assert.equal(withFalse.body.auto_tag, false);

	// The released body key for key: `undefined` is dropped by JSON.stringify,
	// which is exactly how an older core receives the request it shipped with.
	const released = desktopEndpoint(request());
	assert.equal(released.body.auto_tag, undefined);
	assert.equal(
		"auto_tag" in JSON.parse(JSON.stringify(released.body)),
		false,
		"the released request's bytes carry no auto_tag key",
	);
});

/* --------------------------------------------------- the View-options row */

function Harness({
	initial,
	autoTagAvailable = true,
	tagsAvailable = true,
	onView,
}) {
	const [view, setView] = React.useState(initial);
	return React.createElement(ChatSidebarViewMenu, {
		view,
		tagsAvailable,
		autoTagAvailable,
		onView: (next) => {
			onView(next);
			setView(next);
		},
	});
}

const render = async (element) => {
	await act(() => root.render(element));
};

const switchOf = () => document.querySelector("[data-sidebar-auto-tag]");

test("the row shows only with tags on and a backend that reads the field", async () => {
	await render(
		React.createElement(Harness, {
			key: "tags-off",
			initial: { ...DEFAULT_SIDEBAR_VIEW, tagsEnabled: false },
			onView() {},
		}),
	);
	assert.equal(switchOf(), null, "tags off: no row");

	await render(
		React.createElement(Harness, {
			key: "incapable",
			initial: { ...DEFAULT_SIDEBAR_VIEW, tagsEnabled: true },
			autoTagAvailable: false,
			onView() {},
		}),
	);
	assert.equal(switchOf(), null, "an incapable backend is never offered it");

	await render(
		React.createElement(Harness, {
			key: "capable",
			initial: { ...DEFAULT_SIDEBAR_VIEW, tagsEnabled: true },
			onView() {},
		}),
	);
	const control = switchOf();
	assert.ok(control, "tags on and capable: the row draws");
	assert.equal(control.getAttribute("role"), "switch");
	assert.equal(control.getAttribute("aria-checked"), "true", "default on");
	assert.equal(control.getAttribute("aria-label"), "Auto-tag forked sessions");
	const help = document.getElementById("sidebar-auto-tag-help");
	assert.ok(help, "the helper is a real described-by target");
	assert.equal(help.textContent, "Uses your existing tags when naming a fork.");
	assert.equal(
		control.getAttribute("aria-describedby"),
		"sidebar-auto-tag-help",
	);
});

test("a press stores the choice on the one persisted view object", async () => {
	let written = null;
	await render(
		React.createElement(Harness, {
			key: "press",
			initial: { ...DEFAULT_SIDEBAR_VIEW, tagsEnabled: true },
			onView: (next) => {
				written = next;
			},
		}),
	);
	await act(() => switchOf().click());
	assert.ok(written, "the press wrote a whole next view");
	assert.equal(written.autoTagForks, false);
	assert.equal(written.tagsEnabled, true, "the sibling switch is untouched");
	/*
	 * NO FORCED CHIPS, NO FORCED MODE: the press is a preference about a FUTURE
	 * fork, not a statement about how this list draws. A handler that also set
	 * `groupBy: "tag"` would rearrange the reader's sidebar from a switch that
	 * never claimed to, so the saved grouping and the view's shape are asserted
	 * here rather than left to the pixels.
	 */
	assert.equal(written.groupBy, DEFAULT_SIDEBAR_VIEW.groupBy);
	assert.equal("tags" in written, false, "the view carries no tag chips");
	// And back on, so `off` is not a one-way latch.
	await act(() => switchOf().click());
	assert.equal(written.autoTagForks, true);
});

test("neither switch disturbs a grouping the reader chose", async () => {
	let written = null;
	await render(
		React.createElement(Harness, {
			key: "grouping",
			initial: {
				...DEFAULT_SIDEBAR_VIEW,
				tagsEnabled: true,
				groupBy: "agent",
			},
			onView: (next) => {
				written = next;
			},
		}),
	);
	await act(() => switchOf().click());
	assert.equal(written.autoTagForks, false);
	assert.equal(written.groupBy, "agent", "auto-tag leaves the grouping alone");
	/*
	 * The Tags master itself is the other half of the same rule: turning it off
	 * (or on) preserves the saved mode, which is what keeps a reader's Agent and
	 * team grouping from being rewritten by a switch about tags.
	 */
	await act(() =>
		document.querySelector('[aria-label="Group chats by tag"]').click(),
	);
	assert.equal(written.tagsEnabled, false);
	assert.equal(written.groupBy, "agent", "the Tags switch leaves it alone too");
});
