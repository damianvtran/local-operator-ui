/**
 * The New chat row's evidence set, checked against what makes a frame evidence.
 *
 *     node --test scripts/new-chat-row-evidence.test.mjs
 *
 * Two things are tested here, and they are different jobs:
 *
 *   1. `assertHealthyFrame` (scripts/new-chat-row-evidence.mjs) rejects the
 *      degraded run round 1 published. The rejected record is the one the
 *      committed set itself carries — `after-new-chat-current`/`Light` has two
 *      `Retry` stops and `newChat.y` 503.83 against 568 in the other fourteen
 *      frames — so the test's fixture is a measurement, not an invention. A
 *      guard that cannot fail on the artefact that slipped through is not a
 *      guard, which is the whole of review finding M3.
 *   2. The COMMITTED readbacks are healthy. The capture harness only runs when
 *      someone re-takes the set; this runs on every `pnpm test:desktop`, so a
 *      degraded frame cannot be published and then sit there unnoticed.
 *
 * The `before-` set is checked on the fields its probe recorded. It predates the
 * error-surface block (the audit of it is written out in
 * docs/evidence/new-chat-row/README.md), and re-stating that audit here would
 * mean a test asserting a deficiency rather than a property.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
	SEEDED_CATALOGUE,
	assertHealthyFrame,
	baselineRows,
} from "./new-chat-row-evidence.mjs";

/** The guard's own failure messages, matched rather than restated. */
const SCROLLED = /panel is scrolled/;
const RETRY_CONTROL = /passes a "Retry" control/;
const ANY_ALERT = /\[role=alert\]/;
const INCOMPLETE_CALL = /could not complete this request/;
const SIDEBAR_SCROLLED = /scrolled/;
const ACTIVE_TOTAL = /Active chats/;
const PREVIOUS_TOTAL = /Previous chats/;
const BANNER_COPY = /will not function properly/;

const ROOT = process.cwd();
const readback = (name) =>
	JSON.parse(
		readFileSync(join(ROOT, "docs/evidence/new-chat-row", name), "utf8"),
	);

/** A record of the shape the capture probes write, healthy unless overridden. */
const healthyFrame = (overrides = {}) => ({
	theme: "localOperatorLight",
	state: "after-new-chat-focus",
	allChatsText: SEEDED_CATALOGUE.allChats,
	activeChatsText: SEEDED_CATALOGUE.activeChats,
	previousChatsText: SEEDED_CATALOGUE.previousChats,
	newChat: { box: { y: 568, h: 32 } },
	alerts: 0,
	navText: "Chats\nSearch chats and agents\nAgents\n…\nAll chats 34\nNew chat",
	navScroll: 0,
	bannerText: "",
	...overrides,
});

test("a frame of the seeded catalogue passes", () => {
	assert.doesNotThrow(() =>
		assertHealthyFrame(healthyFrame(), {
			baselineY: 568,
			requireSignals: true,
		}),
	);
});

test("the degraded run round 1 published is rejected", () => {
	// `docs/evidence/new-chat-row/after-readback.json` before the re-capture:
	// 49 stops against 47, `Retry` at index 0 and index 9, `newChatIndex` 48,
	// `newChat.y` 503.83 against 568 in the run's own rest frame.
	const recorded = () =>
		healthyFrame({
			state: "after-new-chat-current",
			newChat: { box: { y: 503.83, h: 32 } },
			keyboard: {
				traversal: [{ label: "Retry" }, { label: "Collapse sidebar" }],
				newChatIndex: 48,
			},
		});
	// As recorded, the scroll is what fails first — the extra `Retry` control is
	// a button in the document, not something that moves the row on its own.
	assert.throws(
		() =>
			assertHealthyFrame(recorded(), { baselineY: 568, requireSignals: true }),
		SCROLLED,
	);
	// Held at the baseline, the walk alone still fails it: the control is only
	// in the document because a desktop call failed.
	assert.throws(
		() =>
			assertHealthyFrame(
				healthyFrame({
					state: "after-new-chat-current",
					keyboard: { traversal: [{ label: "Retry" }], newChatIndex: 48 },
				}),
				{ baselineY: 568, requireSignals: true },
			),
		RETRY_CONTROL,
	);
});

test("a frame from a run whose panel is scrolled is rejected", () => {
	// Same degradation, seen without a keyboard walk: the row cannot move
	// between the states of one run unless something above it changed height.
	assert.throws(
		() =>
			assertHealthyFrame(
				healthyFrame({ newChat: { box: { y: 503.83, h: 32 } } }),
				{
					baselineY: 568,
					requireSignals: true,
				},
			),
		SCROLLED,
	);
});

test("a half-arrived catalogue is rejected on the split totals, not just the rows", () => {
	// The rows exist from the first render; `Active chats 2` and
	// `Previous chats 32` arrive on later desktop calls. Round 1's guard checked
	// only the All chats total, so a frame taken in between passed.
	assert.throws(
		() =>
			assertHealthyFrame(healthyFrame({ activeChatsText: "Active chats 0" }), {
				baselineY: 568,
				requireSignals: true,
			}),
		ACTIVE_TOTAL,
	);
	assert.throws(
		() =>
			assertHealthyFrame(
				healthyFrame({ previousChatsText: "Previous chats 0" }),
				{
					baselineY: 568,
					requireSignals: true,
				},
			),
		PREVIOUS_TOTAL,
	);
});

test("an error surface in the sidebar is rejected, three ways", () => {
	assert.throws(
		() =>
			assertHealthyFrame(healthyFrame({ alerts: 1 }), { requireSignals: true }),
		ANY_ALERT,
	);
	assert.throws(
		() =>
			assertHealthyFrame(
				healthyFrame({
					navText: "The backend could not complete this request.",
				}),
				{ requireSignals: true },
			),
		INCOMPLETE_CALL,
	);
	assert.throws(
		() =>
			assertHealthyFrame(healthyFrame({ navScroll: 64.17 }), {
				requireSignals: true,
			}),
		SIDEBAR_SCROLLED,
	);
});

test("the window-level connectivity banner is rejected, because the sidebar cannot see it", () => {
	// The banner is `fixed` and outside `nav[aria-label="Chats"]`, so a guard
	// scoped to the sidebar passes a run in which the app has decided the server
	// is gone. This is how the re-capture's first attempt failed: the counts read
	// their fixture totals and the nav carried no alert, and the Tab walk's first
	// stop was the banner's own `Retry` button.
	assert.throws(
		() =>
			assertHealthyFrame(
				healthyFrame({
					bannerText:
						"The server is offline. The interface will not function properly until the server is back online. Retry",
				}),
				{ requireSignals: true },
			),
		BANNER_COPY,
	);
});

test("a record without the error-surface signals fails the strict contract", () => {
	// The capture must not silently lose the signals the re-capture added.
	const { alerts, navText, navScroll, bannerText, ...frame } = healthyFrame();
	assert.equal(
		[alerts, navText, navScroll, bannerText].filter(
			(value) => value !== undefined,
		).length,
		4,
		"the fixture is expected to carry the signal block",
	);
	assert.throws(
		() => assertHealthyFrame(frame, { requireSignals: true }),
		ANY_ALERT,
	);
	assert.doesNotThrow(() => assertHealthyFrame(frame, { baselineY: 568 }));
});

test("the committed after- readback is healthy in all eight frames", () => {
	const frames = readback("after-readback.json");
	assert.equal(frames.length, 8, "four states in two themes");
	const baselines = baselineRows(frames);
	assert.equal(baselines.size, 2, "one rest frame per theme");
	for (const frame of frames) {
		assertHealthyFrame(frame, {
			baselineY: baselines.get(frame.theme),
			requireSignals: true,
		});
	}
});

test("the committed before- readback is healthy in all eight frames", () => {
	const frames = readback("before-readback.json");
	assert.equal(frames.length, 8);
	const baselines = baselineRows(frames);
	assert.equal(baselines.size, 2);
	for (const frame of frames) {
		assertHealthyFrame(frame, { baselineY: baselines.get(frame.theme) });
	}
});
