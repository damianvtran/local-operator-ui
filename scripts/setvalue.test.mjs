import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/**
 * The shipped `setvalue` page program, and the transport the two page programs
 * ride.
 *
 * WHAT IS UNDER TEST is the COMMITTED STRING the host injects, not a second
 * copy of the logic: the generated constants are bundled and the function is
 * re-materialised from its own text, so a stale or malformed `.gen.ts` fails
 * here rather than in a browser. `check-page-programs.test.mjs` owns freshness;
 * `browser-select.test.mjs` owns the rest of `select`'s matrix and keeps
 * executing `selectPage` from its module, which is byte-for-byte what the
 * generator captured.
 *
 * WHY THE REACT SHAPE IS MODELLED rather than installed: React's controlled
 * input is an OWN `value` accessor on the node (its input tracker) plus an
 * `input` handler that drops an update it already recorded. The fixture below
 * reproduces exactly that contract — including the negative control that proves
 * a plain `.value = x` write is swallowed — without adding a framework to the
 * desktop suite; the live page the PR's evidence drives carries the same shape.
 */

const bundle = await build({
	entryPoints: ["src/main/browser/actions/page-programs.gen.ts"],
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
});
const sources = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The exact text the host sends as `functionDeclaration`. */
const setvaluePage = new Function(
	`return (${sources.SETVALUE_PAGE_SOURCE});`,
)();
const selectPage = new Function(`return (${sources.SELECT_PAGE_SOURCE});`)();

const actionBlock = await build({
	entryPoints: ["src/main/browser/actions/setvalue.ts"],
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
});
const { setvalue } = await import(
	`data:text/javascript;base64,${Buffer.from(actionBlock.outputFiles[0].text).toString("base64")}`
);

function fixture(body) {
	const dom = new JSDOM(`<!doctype html><body>${body}</body>`);
	const doc = dom.window.document;
	const events = [];
	for (const el of doc.querySelectorAll("select, input, textarea")) {
		el.addEventListener("input", () => events.push("input"));
		el.addEventListener("change", () => events.push("change"));
	}
	return {
		dom,
		doc,
		events,
		run: (selector, value) =>
			setvaluePage.call(doc.querySelector(selector), value),
		close: () => dom.window.close(),
	};
}

describe("setvalue: native <select>", () => {
	const options =
		'<option value="a">Alpha</option><option value="b">Beta</option><option value="c"> Gamma </option>';

	test("matches a visible label and reports the read-back value", () => {
		const f = fixture(`<select id="s">${options}</select>`);
		const r = f.run("#s", "Beta");
		assert.equal(r.status, "ready");
		assert.equal(r.kind, "select");
		assert.equal(r.value, "b");
		assert.equal(r.verified, true);
		assert.deepEqual(r.matched, { index: 1, label: "Beta", value: "b" });
		assert.equal(f.doc.querySelector("#s").value, "b");
		f.close();
	});

	test("label matching is trimmed, then case-insensitive, then by value", () => {
		const f = fixture(`<select id="s">${options}</select>`);
		for (const [asked, index] of [
			[" Gamma ", 2],
			["bEtA", 1],
			["b", 1],
		]) {
			const r = f.run("#s", asked);
			assert.equal(r.status, "ready", `asking for ${JSON.stringify(asked)}`);
			assert.equal(r.matched.index, index);
			assert.equal(r.verified, true);
		}
		f.close();
	});

	test("dispatches input then change, so both framework and native handlers run", () => {
		const f = fixture(`<select id="s">${options}</select>`);
		f.run("#s", "Alpha");
		assert.deepEqual(f.events, ["input", "change"]);
		f.close();
	});

	test("an unmatched request refuses and lists what the control offers", () => {
		const f = fixture(`<select id="s">${options}</select>`);
		const r = f.run("#s", "Production");
		assert.equal(r.status, "option_not_found");
		assert.deepEqual(
			r.available.map(({ index, label, value }) => ({ index, label, value })),
			[
				{ index: 0, label: "Alpha", value: "a" },
				{ index: 1, label: "Beta", value: "b" },
				{ index: 2, label: "Gamma", value: "c" },
			],
		);
		assert.equal(
			f.doc.querySelector("#s").value,
			"a",
			"no mutation on refusal",
		);
		assert.deepEqual(f.events, []);
		f.close();
	});

	test("a multiple select needs exactly one match; a single select may repeat a label", () => {
		const multi = fixture(
			'<select id="m" multiple><option value="x">Same</option><option value="y">Same</option></select>',
		);
		const refused = multi.run("#m", "Same");
		assert.equal(refused.status, "option_ambiguous");
		assert.equal(refused.matches, 2);
		assert.deepEqual([...multi.doc.querySelector("#m").selectedOptions], []);
		multi.close();
		const single = fixture(
			'<select id="s"><option value="x">Same</option><option value="y">Same</option></select>',
		);
		const chosen = single.run("#s", "Same");
		assert.equal(chosen.status, "ready");
		assert.equal(chosen.value, "x");
		single.close();
	});

	test("a multiple select keeps only the matched option selected", () => {
		const f = fixture(
			'<select id="m" multiple><option value="a" selected>Alpha</option><option value="b">Beta</option></select>',
		);
		const r = f.run("#m", "Beta");
		assert.equal(r.status, "ready");
		assert.deepEqual(
			[...f.doc.querySelector("#m").selectedOptions].map((o) => o.value),
			["b"],
		);
		f.close();
	});

	test("a disabled select refuses before any mutation or event", () => {
		const f = fixture(
			'<select id="s" disabled><option value="a">Alpha</option></select>',
		);
		const r = f.run("#s", "Alpha");
		assert.equal(r.status, "disabled");
		assert.equal(r.tag, "select");
		assert.deepEqual(f.events, []);
		f.close();
	});

	test("the select program itself still works from the generated source", () => {
		const f = fixture(`<select id="s">${options}</select>`);
		const r = selectPage.call(f.doc.querySelector("#s"), "apply", ["Beta"]);
		assert.equal(r.status, "ready");
		assert.equal(r.verified, true);
		assert.equal(f.doc.querySelector("#s").value, "b");
		f.close();
	});
});

describe("setvalue: text fields", () => {
	test("a plain input takes the value and reports it read back", () => {
		const f = fixture('<input id="i" type="text">');
		const r = f.run("#i", "Damian");
		assert.equal(r.status, "ready");
		assert.equal(r.kind, "input");
		assert.equal(r.type, "text");
		assert.equal(r.value, "Damian");
		assert.equal(r.verified, true);
		f.close();
	});

	test("an empty string CLEARS the field rather than refusing", () => {
		const f = fixture('<input id="i" type="text" value="old">');
		const r = f.run("#i", "");
		assert.equal(r.status, "ready");
		assert.equal(r.value, "");
		assert.equal(r.verified, true);
		f.close();
	});

	test("a textarea is written through its own prototype setter", () => {
		const f = fixture("<textarea id='t'>old</textarea>");
		const r = f.run("#t", "line one\nline two");
		assert.equal(r.kind, "textarea");
		assert.equal(r.value, "line one\nline two");
		assert.equal(r.verified, true);
		f.close();
	});

	test("a date input takes the ISO string, and an unparsable one is reported not sticky", () => {
		const f = fixture('<input id="d" type="date">');
		const good = f.run("#d", "2026-11-06");
		assert.equal(good.value, "2026-11-06");
		assert.equal(good.verified, true);
		// Chromium keeps "" for a string it cannot parse; the read-back is the
		// only honest report, and `verified:false` says so instead of implying a
		// write that did not happen.
		const bad = f.run("#d", "06/11/2026");
		assert.equal(bad.status, "ready");
		assert.equal(bad.value, "");
		assert.equal(bad.verified, false);
		f.close();
	});

	test("the prototype setter bypasses a framework's instance value tracker", () => {
		const f = fixture('<input id="i" type="text">');
		const input = f.doc.querySelector("#i");
		const proto = Object.getOwnPropertyDescriptor(
			f.dom.window.HTMLInputElement.prototype,
			"value",
		);
		const tracker = { last: input.value };
		const state = { value: "" };
		// React's inputValueTracking, in the shape that matters: an OWN accessor
		// that records every write made through the instance property.
		Object.defineProperty(input, "value", {
			configurable: true,
			get() {
				return proto.get.call(this);
			},
			set(next) {
				proto.set.call(this, String(next));
				tracker.last = String(next);
			},
		});
		const commits = [];
		input.addEventListener("input", () => {
			const now = proto.get.call(input);
			if (now === tracker.last) return; // the framework's dedupe
			tracker.last = now;
			state.value = now;
			commits.push(now);
		});
		// NEGATIVE CONTROL first: the write an agent would make by hand is
		// swallowed, which is why this action exists at all.
		input.value = "typed-by-instance";
		assert.deepEqual(
			commits,
			[],
			"an instance-property write is invisible to the framework",
		);
		assert.equal(state.value, "");
		// The action's write is not.
		const r = f.run("#i", "Damian");
		assert.equal(r.verified, true);
		assert.deepEqual(commits, ["Damian"]);
		assert.equal(state.value, "Damian");
		f.close();
	});

	test("readonly, disabled, file and non-form targets refuse with typed reasons", () => {
		const f = fixture(`
			<input id="ro" type="text" value="fixed" readonly>
			<input id="dis" type="text" disabled>
			<input id="file" type="file">
			<div id="ce" contenteditable="true">editable</div>
			<div id="combo" role="combobox" aria-controls="opts">Choose</div>
			<div id="opts" role="listbox"><div role="option">Red</div></div>
			<fieldset id="inert" inert><input id="inside" type="text"></fieldset>
		`);
		assert.deepEqual(
			[
				f.run("#ro", "nope").status,
				f.run("#dis", "nope").status,
				f.run("#file", "/etc/passwd").status,
				f.run("#ce", "nope").status,
				f.run("#combo", "Red").status,
				f.run("#inside", "nope").status,
			],
			[
				"readonly",
				"disabled",
				"file_input",
				"not_a_form_control",
				"not_a_form_control",
				"disabled",
			],
		);
		assert.equal(
			f.doc.querySelector("#ro").value,
			"fixed",
			"a refused write changes nothing",
		);
		assert.equal(f.doc.querySelector("#ce").textContent, "editable");
		f.close();
	});
});

describe("the setvalue action's argument validation", () => {
	test("a missing selector and a missing text are refused before any page work", async () => {
		for (const params of [
			{ text: "x" },
			{ selector: "   ", text: "x" },
			{ selector: "#i" },
			{ selector: "body", text: 42 },
		]) {
			await assert.rejects(
				() => setvalue({}, params),
				(error) =>
					error.code === "internal" &&
					error.data.reason === "invalid_arguments",
				`params ${JSON.stringify(params)} must refuse as invalid_arguments`,
			);
		}
	});
});
