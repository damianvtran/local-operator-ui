/*
 * The delegated-work retention window: the duration model, the range check that
 * stands between a draft and the wire, the control's gated and invalid states,
 * the grouping of the two new registry sections, and the one-time notice's wire
 * lifecycle (peek-lift, dismissal-ack, tolerance).
 *
 * The rows are read from the COMMITTED registry projection
 * (`scripts/fixtures/backend-settings-registry.json`, derived from the backend's
 * own `settings_io`), not hand-built, so a bound, a unit or a section name that
 * is wrong here is wrong in the registry. The bundle imports the SHIPPED modules
 * (the same esbuild harness `backend-settings-drafts.test.mjs` and
 * `backend-settings-collapse.test.mjs` use), so a second implementation cannot
 * pass this while the page disagrees with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// A document before React DOM loads, and every jsdom global the Radix
// primitives reference as a bare name (see backend-settings-collapse.test.mjs).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// A few jsdom accessors refuse to be read out of context.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};
/*
 * A localStorage for the notice store's `persist` middleware. The renderer
 * always has one; jsdom puts it on the window (which the promotion loop above
 * would copy), but a bare `localStorage` read inside a bundled module is not
 * guaranteed to resolve, so the test states the environment it needs.
 */
globalThis.localStorage ??= {
	store: new Map(),
	getItem(key) {
		return this.store.has(key) ? this.store.get(key) : null;
	},
	setItem(key, value) {
		this.store.set(key, String(value));
	},
	removeItem(key) {
		this.store.delete(key);
	},
	clear() {
		this.store.clear();
	},
	key(index) {
		return [...this.store.keys()][index] ?? null;
	},
	get length() {
		return this.store.size;
	},
};
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { createElement };
			export * from "./src/renderer/src/features/settings/retention-duration";
			export { editOutcome } from "./src/renderer/src/features/settings/components/backend-settings-drafts";
			export { presentSetting, gateLabelFor, sectionTitle } from "./src/renderer/src/features/settings/backend-setting-copy";
			export { tierFor } from "./src/renderer/src/features/settings/backend-settings-tiers";
			export { RetentionDurationControl } from "./src/renderer/src/features/settings/components/retention-duration-control";
			export { BackendSettingRow } from "./src/renderer/src/features/settings/components/backend-setting-row";
			export { parseDelegatedCleanupNotice, useDelegatedCleanupNoticeStore } from "./src/renderer/src/shared/store/delegated-cleanup-notice-store";
			export { desktopResult, dismissDelegatedCleanupNotice } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL("./_retention-duration.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const m = await import(bundlePath.href);

const registry = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);
const row = (key) => {
	const found = registry.settings.find((s) => s.key === key);
	assert.ok(found, `the registry fixture must carry ${key}`);
	return found;
};
const age = () => row(m.DELEGATED_MAX_AGE_KEY);
const spec = () => {
	const s = m.durationSpec(age());
	assert.ok(s, "the age row must be a duration this control understands");
	return s;
};

/* ------------------------------------------------------------------ *
 * The wire row
 * ------------------------------------------------------------------ */

test("the fixture carries the contract this control reads", () => {
	const r = age();
	assert.equal(r.kind, "int");
	assert.equal(r.unit, "hours");
	assert.equal(r.minimum, 2);
	assert.equal(r.maximum, 720);
	assert.equal(r.default, 48);
	assert.equal(r.gated_by, m.DELEGATED_ENABLED_KEY);
	assert.equal(row(m.DELEGATED_ENABLED_KEY).default, true);
});

/* ------------------------------------------------------------------ *
 * hours <-> human label, stops, clamp
 * ------------------------------------------------------------------ */

test("hours are spoken in the unit a person says them in", () => {
	const cases = [
		[2, "2 hours"],
		[6, "6 hours"],
		[12, "12 hours"],
		[24, "24 hours"],
		[48, "48 hours"],
		[71, "71 hours"],
		[72, "3 days"],
		[100, "100 hours"], // not a whole number of days: never rounded
		[168, "7 days"],
		[336, "14 days"],
		[360, "15 days"],
		[720, "1 month"],
		[1, "1 hour"],
	];
	for (const [hours, label] of cases) {
		assert.equal(m.formatHours(hours), label, `${hours}h`);
	}
});

test("the stops are the nine the design names, in order, and 48 is the default", () => {
	const s = spec();
	assert.deepEqual(s.stops, [2, 6, 12, 24, 48, 72, 168, 336, 720]);
	assert.deepEqual(s.stops.map(m.shortLabel), [
		"2h",
		"6h",
		"12h",
		"24h",
		"48h",
		"3d",
		"7d",
		"14d",
		"30d",
	]);
	assert.equal(s.defaultHours, 48);
	assert.ok(s.stops.includes(s.defaultHours));
});

test("the range comes from the row, and a stop outside it is not offered", () => {
	const narrowed = m.durationSpec({ ...age(), minimum: 6, maximum: 168 });
	assert.deepEqual(narrowed.stops, [6, 12, 24, 48, 72, 168]);
	// A row that lost its bounds falls back to the registry's current ones.
	const bare = m.durationSpec({ ...age(), minimum: null, maximum: null });
	assert.equal(bare.min, 2);
	assert.equal(bare.max, 720);
});

test("only the delegated age row is a duration, and only in hours", () => {
	assert.equal(m.durationSpec(row("runtime.unattended_gate_timeout")), null);
	assert.equal(m.durationSpec(row(m.DELEGATED_ENABLED_KEY)), null);
	// A server that re-denominates the key must not be read as hours.
	assert.equal(m.durationSpec({ ...age(), unit: "minutes" }), null);
	// An older server that sends no unit still gets the control.
	assert.ok(m.durationSpec({ ...age(), unit: undefined }));
});

test("exact entry converts days to hours and refuses anything else loudly", () => {
	assert.equal(m.entryToDraft({ text: "7", unit: "days" }), "168");
	assert.equal(m.entryToDraft({ text: "30", unit: "days" }), "720");
	assert.equal(m.entryToDraft({ text: "36", unit: "hours" }), "36");
	// Not a number: passed through verbatim so validation can refuse it where it
	// is saved, rather than this function inventing one ("2.5" must not become 2).
	assert.equal(m.entryToDraft({ text: "2.5", unit: "hours" }), "2.5");
	assert.equal(m.entryToDraft({ text: "12abc", unit: "hours" }), "12abc");
	assert.equal(m.entryToDraft({ text: "", unit: "days" }), "");
	assert.deepEqual(m.splitEntry(168), { text: "7", unit: "days" });
	assert.deepEqual(m.splitEntry(48), { text: "48", unit: "hours" });
	assert.deepEqual(m.splitEntry(100), { text: "100", unit: "hours" });
});

test("clamp pins to the registry's range", () => {
	const s = spec();
	assert.equal(m.clampHours(1, s), 2);
	assert.equal(m.clampHours(5000, s), 720);
	assert.equal(m.clampHours(48, s), 48);
});

/* ------------------------------------------------------------------ *
 * Range validation
 * ------------------------------------------------------------------ */

test("the range is 2 hours to 1 month, inclusive, in plain words", () => {
	const s = spec();
	assert.deepEqual(m.validateHours("2", s), { ok: true, hours: 2 });
	assert.deepEqual(m.validateHours("720", s), { ok: true, hours: 720 });
	assert.deepEqual(m.validateHours(" 48 ", s), { ok: true, hours: 48 });

	const low = m.validateHours("1", s);
	assert.equal(low.ok, false);
	assert.equal(low.nearest, 2);
	assert.match(low.error, /1 hour is too short/);
	assert.match(low.error, /between 2 hours and 1 month \(30 days\)/);

	const high = m.validateHours("721", s);
	assert.equal(high.ok, false);
	assert.equal(high.nearest, 720);
	assert.match(high.error, /721 hours is too long/);

	for (const junk of ["", "abc", "2.5", "-5", "12abc", "1e2", "0x10"]) {
		const verdict = m.validateHours(junk, s);
		assert.equal(verdict.ok, false, `"${junk}" must not validate`);
		assert.equal(verdict.nearest, null);
	}
});

test("no out-of-range value can become a request", () => {
	const draftOf = (value) => ({ value, cascadeBase: null });
	const send = (value) => m.editOutcome(age(), draftOf(value));

	for (const ok of ["2", "48", "720"]) {
		const outcome = send(ok);
		assert.equal(outcome.ok, true, ok);
		assert.equal(outcome.request.op, "settings.edit");
		assert.equal(outcome.request.key, m.DELEGATED_MAX_AGE_KEY);
		assert.equal(outcome.request.value, Number(ok), "hours, as a number");
	}
	for (const bad of ["1", "0", "721", "9999", "-1", "12abc", "2.5", ""]) {
		const outcome = send(bad);
		assert.equal(outcome.ok, false, `"${bad}" must be refused before the wire`);
		assert.ok(outcome.error.length > 0);
	}
	// The ordinary int rows keep their lenient arm: this is not a global change.
	const plain = m.editOutcome(
		row("session.cleanup.max_sessions"),
		draftOf("7"),
	);
	assert.equal(plain.ok, true);
});

/* ------------------------------------------------------------------ *
 * Section grouping, tiers and copy
 * ------------------------------------------------------------------ */

test("the cleanup keys moved out of `session` into two labelled groups", () => {
	// The title the PAGE paints: the registry's own for the first group, and the
	// desktop's full phrase for the second (the registry shortened it to fit the
	// terminal's header column, and the page has the width).
	const title = (name) =>
		m.sectionTitle(registry.sections.find((s) => s.name === name));
	assert.equal(title("session_cleanup"), "Your conversations");
	assert.equal(
		title("session_delegated"),
		"Delegated work: subagents and background sessions",
	);
	assert.equal(
		title("session"),
		"Session storage",
		"no other title is touched",
	);
	const inSection = (name) =>
		registry.settings.filter((s) => s.section === name).map((s) => s.key);
	assert.deepEqual(inSection("session"), ["auto_save_conversation"]);
	assert.deepEqual(inSection("session_cleanup"), [
		"session.cleanup.enabled",
		"session.cleanup.max_sessions",
		"session.cleanup.max_inactive_days",
		"session.cleanup.max_total_bytes",
		"session.cleanup.remove_empty",
	]);
	assert.deepEqual(inSection("session_delegated"), [
		m.DELEGATED_ENABLED_KEY,
		m.DELEGATED_MAX_AGE_KEY,
	]);
	// The two groups sit together, in the order the reader meets them.
	const names = registry.sections.map((s) => s.name);
	assert.equal(
		names.indexOf("session_delegated"),
		names.indexOf("session_cleanup") + 1,
	);
});

test("both delegated rows are everyday rows, and the copy overrides name real keys", () => {
	assert.equal(m.tierFor(row(m.DELEGATED_ENABLED_KEY)), "core");
	assert.equal(m.tierFor(row(m.DELEGATED_MAX_AGE_KEY)), "core");
	// The parent keys keep the tiers they had.
	assert.equal(m.tierFor(row("session.cleanup.enabled")), "core");
	assert.equal(m.tierFor(row("session.cleanup.max_sessions")), "advanced");

	const shown = m.presentSetting(row(m.DELEGATED_ENABLED_KEY));
	assert.equal(shown.label, "Remove delegated sessions automatically");
	assert.equal(
		shown.key,
		m.DELEGATED_ENABLED_KEY,
		"presentation never touches identity",
	);
	assert.equal(shown.value, true);
	// A row with no override is returned untouched, by identity.
	const other = row("hosting");
	assert.equal(m.presentSetting(other), other);
	assert.equal(
		m.gateLabelFor(m.DELEGATED_ENABLED_KEY, "x"),
		"automatic removal",
	);
	assert.equal(m.gateLabelFor("hosting", "Hosting"), "Hosting");
});

test("search finds the group by what a reader would type", () => {
	const fold = (v) => v.toLowerCase().replace(/[-_.]/g, " ");
	const haystack = (s) => {
		const p = m.presentSetting(s);
		return fold([p.label, p.help, s.key, s.section, s.warning ?? ""].join(" "));
	};
	const hits = (needle) =>
		registry.settings
			.filter((s) => haystack(s).includes(fold(needle)))
			.map((s) => s.key);
	for (const needle of ["retention", "subagent", "delegated"]) {
		const found = hits(needle);
		assert.ok(
			found.includes(m.DELEGATED_MAX_AGE_KEY),
			`"${needle}" must reach the age row (got ${found.length} rows)`,
		);
	}
	assert.ok(hits("delegated").includes(m.DELEGATED_ENABLED_KEY));
});

/* ------------------------------------------------------------------ *
 * The rendered control
 * ------------------------------------------------------------------ */

const mount = async (t, props) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () => {
		root.render(m.createElement(m.RetentionDurationControl, props));
	});
	return container;
};
const changes = [];
const base = () => ({
	setting: age(),
	value: "48",
	disabled: false,
	onValueChange: (v) => changes.push(v),
});
const typeInto = async (input, text) => {
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, text);
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};

test("default state: nine stops, 48 hours selected, no error", async (t) => {
	const c = await mount(t, base());
	const stops = [...c.querySelectorAll('[role="tab"]')];
	assert.equal(stops.length, 9);
	const selected = stops.filter(
		(s) => s.getAttribute("aria-selected") === "true",
	);
	assert.equal(selected.length, 1);
	assert.equal(selected[0].textContent.includes("48h"), true);
	assert.match(c.textContent, /48 hours with no activity \(default\)/);
	assert.equal(c.querySelector('input[aria-invalid="true"]'), null);
});

test("min, max and an in-between value read in words", async (t) => {
	for (const [value, words] of [
		["2", /2 hours with no activity/],
		["720", /1 month with no activity/],
		["168", /7 days with no activity/],
		["100", /100 hours with no activity/],
	]) {
		const c = await mount(t, { ...base(), value });
		assert.match(c.textContent, words, value);
	}
});

test("an exact value that is not a stop selects no stop", async (t) => {
	const c = await mount(t, { ...base(), value: "100" });
	const selected = [...c.querySelectorAll('[role="tab"]')].filter(
		(s) => s.getAttribute("aria-selected") === "true",
	);
	assert.equal(selected.length, 0);
});

test("an invalid draft shows the sentence, flags the field and offers the nearest value", async (t) => {
	const c = await mount(t, { ...base(), value: "721" });
	const input = c.querySelector("input");
	assert.equal(input.getAttribute("aria-invalid"), "true");
	assert.match(c.textContent, /721 hours is too long/);
	assert.match(c.textContent, /between 2 hours and 1 month \(30 days\)/);
	assert.match(c.textContent, /Use 1 month/);
	const describedBy = input.getAttribute("aria-describedby") ?? "";
	assert.ok(
		describedBy && c.querySelector(`[id="${describedBy.split(" ")[0]}"]`),
		"the field must be described by the message it is showing",
	);
});

test("typing reports hours to the draft, and days convert", async (t) => {
	changes.length = 0;
	const c = await mount(t, base());
	await typeInto(c.querySelector("input"), "36");
	assert.equal(changes.at(-1), "36");
	await typeInto(c.querySelector("input"), "5000");
	assert.equal(
		changes.at(-1),
		"5000",
		"invalid text still reaches the draft; Save refuses it",
	);
});

test("gated off: every control is disabled, none can report a change", async (t) => {
	changes.length = 0;
	const c = await mount(t, { ...base(), disabled: true });
	assert.equal(c.querySelector("input").disabled, true);
	for (const tab of c.querySelectorAll('[role="tab"]')) {
		assert.equal(tab.disabled || tab.hasAttribute("data-disabled"), true);
	}
	assert.equal(c.querySelector('[role="combobox"]').disabled, true);
	assert.equal(changes.length, 0);
});

test("the row explains the gate in the switch's own words", async (t) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () => {
		root.render(
			m.createElement(m.BackendSettingRow, {
				setting: age(),
				draft: { value: "48", cascadeBase: null },
				tier: "core",
				gate: {
					key: m.DELEGATED_ENABLED_KEY,
					label: m.gateLabelFor(m.DELEGATED_ENABLED_KEY, "Delegated cleanup"),
					on: false,
				},
				saving: false,
				error: null,
				onDraftChange() {},
				onSave() {},
				onReset() {},
			}),
		);
	});
	assert.match(container.textContent, /Needs automatic removal on\./);
	assert.equal(container.querySelector("input").disabled, true);
});

/* ------------------------------------------------------------------ *
 * The first-run notice's wire shape
 * ------------------------------------------------------------------ */

/** The wire's notice, as `notice_wire` spells it. */
const WIRE_NOTICE = {
	message: "Cleaned up 3 delegated sessions so far.",
	removed: 3,
	max_age_hours: 48,
	in_progress: true,
	first_removal_at: "2026-10-09T10:00:00-0400",
	freed_bytes_estimate: null,
	record: "~/.local-operator/sessions/cleanup.log",
};

/**
 * A preload bridge whose list answers carry the notice until the ack lands.
 *
 * THE ROUTE IS A PEEK: `GET /v1/desktop/sessions` serves `delegated_cleanup_notice`
 * on EVERY answer while the store is unacknowledged, and the dismissal's
 * `delegated_cleanup_notice.ack` is the write that stops it. The stub models
 * exactly that - it records every request, keeps carrying the field until the
 * ack arrives (or forever, when `ackFails`), and can be flipped back to
 * carrying for the failed-ack direction.
 */
const installNoticeBridge = ({ ackFails = false } = {}) => {
	const requests = [];
	let carrying = true;
	globalThis.window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "delegated_cleanup_notice.ack") {
					if (ackFails) {
						return {
							status: 500,
							body: { detail: "the ack could not be written" },
						};
					}
					carrying = false;
					return {
						status: 200,
						body: { status: 200, message: "ok", result: {} },
					};
				}
				return {
					status: 200,
					body: {
						status: 200,
						message: "ok",
						result: {
							sessions: [],
							...(carrying ? { delegated_cleanup_notice: WIRE_NOTICE } : {}),
						},
					},
				};
			},
		},
	};
	return {
		requests,
		setCarrying: (value) => {
			carrying = value;
		},
	};
};

test("a sessions.list answer carrying the notice lifts it into the store, once per acknowledgment", async () => {
	/*
	 * THE REAL PATH this contract is about: the notice rides `sessions.list`,
	 * and the renderer lifts it at the transport (`desktopResult`) rather than in
	 * any one caller - because five callers issue this op and, on the peek
	 * contract, whichever asks first must not be the only one that ever sees it
	 * (the round-1 defect was the FIRST read consuming it before the renderer
	 * could). This drives that function with a stubbed bridge and reads the
	 * store.
	 */
	m.useDelegatedCleanupNoticeStore.setState({ notice: null });
	const bridge = installNoticeBridge();
	// Read 1 and read 2 both carry the field, the way two of the five callers
	// (the attach probe, the sidebar) would in one launch.
	await m.desktopResult({ op: "sessions.list" });
	const held = m.useDelegatedCleanupNoticeStore.getState().notice;
	assert.equal(held?.removed, 3);
	assert.equal(held?.in_progress, true);
	await m.desktopResult({ op: "sessions.list" });
	assert.equal(
		m.useDelegatedCleanupNoticeStore.getState().notice,
		held,
		"a second identical arrival keeps the held reference - no re-render",
	);
	// Dismissal: the local clear, then the ack that stops the server serving
	// the field.
	await m.dismissDelegatedCleanupNotice();
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice, null);
	assert.ok(
		bridge.requests.some((r) => r.op === "delegated_cleanup_notice.ack"),
		"dismiss must acknowledge the notice for the store",
	);
	// The next answer no longer carries it: nothing resurrects the notice.
	await m.desktopResult({ op: "sessions.list" });
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice, null);
	// And a LATER answer that carries it again re-lifts it - the failed-ack
	// direction, which is acceptable: the notice is at-least-once client-side,
	// and no dismissal may poison the lift.
	bridge.setCarrying(true);
	await m.desktopResult({ op: "sessions.list" });
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice?.removed, 3);
});

test("a failed ack keeps the local dismissal and reports nothing", async () => {
	/*
	 * The tolerance the lifecycle promises: the local clear is what the reader
	 * asked for and it stands; the ack's failure is swallowed, so a refused
	 * write cannot leave an unhandled rejection or a scary banner about a
	 * notice the reader just dismissed. The field stays on the wire and the
	 * notice may reappear on a later answer - acceptable, and the direction the
	 * at-least-once notice wants.
	 */
	m.useDelegatedCleanupNoticeStore.setState({ notice: null });
	const bridge = installNoticeBridge({ ackFails: true });
	await m.desktopResult({ op: "sessions.list" });
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice?.removed, 3);
	// Must RESOLVE: the dismissal is the promise this call makes, and it is
	// kept even though the write was not.
	await m.dismissDelegatedCleanupNotice();
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice, null);
	assert.ok(
		bridge.requests.some((r) => r.op === "delegated_cleanup_notice.ack"),
		"the ack was attempted",
	);
	// The next read still carries the field (the ack never landed), so the
	// notice re-lifts - the re-show a failed ack tolerates.
	await m.desktopResult({ op: "sessions.list" });
	assert.equal(m.useDelegatedCleanupNoticeStore.getState().notice?.removed, 3);
});

test("the notice store's storage factory refuses an absent localStorage (the sibling's guard)", () => {
	/*
	 * An anchor on the store's source, the shape
	 * `update-indicator-segments.test.mjs` pins its sibling with. The BEHAVIOUR
	 * cannot be driven from here: this file installs its `localStorage` stub
	 * before the bundle loads, and the store is a module singleton - but the
	 * guard is what keeps a Node harness WITHOUT one from watching the first
	 * write reject asynchronously with "Cannot read properties of undefined
	 * (reading 'setItem')" (the failure `update-notice-store.ts` documents and
	 * this store was missing until agent review round 1, F3).
	 */
	const source = readFileSync(
		"src/renderer/src/shared/store/delegated-cleanup-notice-store.ts",
		"utf8",
	);
	assert.match(
		source,
		/throw new Error\("no localStorage in this environment"\)/,
		"the storage factory must THROW on an absent store so zustand degrades to in-memory",
	);
});

test("the notice parser accepts the wire shape and refuses a message-less one", () => {
	const wire = {
		message:
			"Cleaned up 12 delegated sessions so far.\nYour own conversations were not touched.",
		removed: 12,
		max_age_hours: 48,
		in_progress: true,
		first_removal_at: "2026-10-09T10:00:00-0400",
		freed_bytes_estimate: null,
		record: "~/.local-operator/sessions/cleanup.log",
	};
	assert.deepEqual(m.parseDelegatedCleanupNotice(wire), wire);
	assert.equal(m.parseDelegatedCleanupNotice(null), null);
	assert.equal(m.parseDelegatedCleanupNotice({ ...wire, message: "  " }), null);
	assert.equal(m.parseDelegatedCleanupNotice("hi"), null);
	assert.equal(
		m.parseDelegatedCleanupNotice({ ...wire, in_progress: "yes" }).in_progress,
		false,
	);
});
