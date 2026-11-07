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

	test("the match ladder is select's own: exact label, case-insensitive label, then value", () => {
		// A value that collides with ANOTHER option's label is the case where a
		// ladder differs by one tier silently lands on a different option. Both
		// verbs must pick the same one — this is the reviewer's repro.
		const f = fixture(
			'<select id="s"><option value="blue">Red</option><option value="green">Blue</option></select>',
		);
		const viaSetvalue = f.run("#s", "blue");
		const viaSelect = selectPage.call(f.doc.querySelector("#s"), "apply", [
			"blue",
		]);
		assert.equal(
			viaSetvalue.matched.index,
			1,
			"case-insensitive LABEL wins here",
		);
		assert.equal(viaSelect.selected[0].index, 1);
		assert.equal(
			viaSetvalue.matched.index,
			viaSelect.selected[0].index,
			"the two verbs cannot disagree about which option a name means",
		);
		f.close();
	});

	test("a disabled option is refused, exactly as select refuses it", () => {
		const markup =
			'<select id="s"><option value="a">Alpha</option><option value="b" disabled>Beta</option></select>';
		const f = fixture(markup);
		const before = f.doc.querySelector("#s").value;
		const viaSetvalue = f.run("#s", "Beta");
		assert.equal(viaSetvalue.status, "disabled");
		assert.equal(viaSetvalue.kind, "select");
		assert.deepEqual(viaSetvalue.matched, {
			index: 1,
			label: "Beta",
			value: "b",
		});
		assert.equal(
			f.doc.querySelector("#s").value,
			before,
			"a refused write changes nothing",
		);
		const viaSelect = selectPage.call(f.doc.querySelector("#s"), "apply", [
			"Beta",
		]);
		assert.equal(viaSelect.status, "disabled");
		f.close();
	});

	test("an option inside a disabled optgroup is refused too", () => {
		const f = fixture(
			'<select id="s"><optgroup label="g" disabled><option value="a">Alpha</option></optgroup><option value="b">Beta</option></select>',
		);
		assert.equal(f.run("#s", "Alpha").status, "disabled");
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

	test("a date input takes the ISO string", () => {
		const f = fixture('<input id="d" type="date">');
		const good = f.run("#d", "2026-11-06");
		assert.equal(good.status, "ready");
		assert.equal(good.value, "2026-11-06");
		assert.equal(good.verified, true);
		f.close();
	});

	test("a value the input's own sanitizer drops or coerces is REFUSED, never a success", () => {
		// Each of these is a write the browser does not store as asked: the date
		// family and `number` keep "", `range` clamps, `color` falls back. Reporting
		// any of them as `verified: true` is how a form is submitted with an empty
		// or wrong field.
		const cases = [
			['<input id="x" type="date">', "01/03/2027", "YYYY-MM-DD"],
			['<input id="x" type="time">', "not-a-time", "HH:MM or HH:MM:SS"],
			['<input id="x" type="datetime-local">', "nope", "YYYY-MM-DDTHH:MM"],
			['<input id="x" type="month">', "nope", "YYYY-MM"],
			['<input id="x" type="week">', "nope", "YYYY-Www"],
			['<input id="x" type="number">', "abc", "a number"],
			[
				'<input id="x" type="range">',
				"abc",
				"a number between the control's min and max",
			],
			['<input id="x" type="color">', "purple", "#rrggbb"],
		];
		for (const [markup, requested, expected] of cases) {
			const f = fixture(markup);
			const r = f.run("#x", requested);
			assert.equal(r.status, "value_rejected", `${markup} / ${requested}`);
			assert.equal(r.expected, expected, `${markup} names the format`);
			assert.equal(r.input_type, f.doc.querySelector("#x").type);
			f.close();
		}
		// The same types accept a value they understand, so the refusal is not just
		// "this verb never writes these".
		for (const [markup, good] of [
			['<input id="x" type="date">', "2027-03-01"],
			['<input id="x" type="time">', "13:45"],
			['<input id="x" type="number">', "42"],
			['<input id="x" type="color">', "#ff0000"],
		]) {
			const f = fixture(markup);
			const r = f.run("#x", good);
			assert.equal(r.status, "ready", `${markup} accepts ${good}`);
			assert.equal(r.verified, true);
			f.close();
		}
	});

	test("a password field is verified but its value is never returned", () => {
		const f = fixture('<input id="p" type="password">');
		const r = f.run("#p", "hunter2");
		assert.equal(r.status, "ready");
		assert.equal(r.type, "password");
		assert.equal(r.redacted, true);
		assert.equal(r.verified, true);
		assert.equal(
			"value" in r,
			false,
			"a credential must not ride back in the answer",
		);
		assert.equal(
			f.doc.querySelector("#p").value,
			"hunter2",
			"the write itself still happened",
		);
		f.close();
	});

	test("input and change are composed, so a control inside a shadow root notifies its host", () => {
		const dom = new JSDOM("<!doctype html><body><div id='host'></div></body>");
		const hostEl = dom.window.document.getElementById("host");
		const root = hostEl.attachShadow({ mode: "open" });
		root.innerHTML = '<input id="in" type="text">';
		const input = root.querySelector("#in");
		const seen = [];
		input.addEventListener("input", (event) =>
			seen.push(["inner-input", event.composed]),
		);
		hostEl.addEventListener("input", () => seen.push(["host-input"]));
		hostEl.addEventListener("change", () => seen.push(["host-change"]));
		const r = setvaluePage.call(input, "x");
		assert.equal(r.status, "ready");
		assert.equal(r.verified, true);
		assert.deepEqual(
			seen,
			[["inner-input", true], ["host-input"], ["host-change"]],
			"a bubbling-only event stops at the shadow root; a composed one notifies the host",
		);
		dom.window.close();
	});

	test("checkbox and radio refuse, naming the verb that toggles them", () => {
		const f = fixture(
			'<input id="c" type="checkbox"><input id="r" type="radio" value="b">',
		);
		assert.deepEqual(f.run("#c", "true"), {
			status: "not_a_value_control",
			tag: "input",
			input_type: "checkbox",
		});
		assert.equal(f.run("#r", "true").input_type, "radio");
		// The state a caller asked for is NOT the state these controls hold: they
		// are unchanged, and `click` is the verb that moves them.
		assert.equal(f.doc.querySelector("#c").checked, false);
		assert.equal(f.doc.querySelector("#r").checked, false);
		f.close();
	});

	test("a refused write leaves the control and the page EXACTLY as they were", () => {
		// The refusal is only honest if nothing happened: no prior value lost, and
		// no `input`/`change` reaching the page's own handlers. Each case first sets
		// a value the control accepts, so there is something to lose.
		const cases = [
			['<input id="x" type="date">', "2026-11-06", "01/03/2027", "YYYY-MM-DD"],
			[
				'<input id="x" type="range" min="0" max="10">',
				"5",
				"99",
				"a number between the control's min and max",
			],
			['<input id="x" type="color">', "#112233", "purple", "#rrggbb"],
			['<input id="x" type="color">', "#112233", "notacolour", "#rrggbb"],
		];
		for (const [markup, prior, refused, expected] of cases) {
			const f = fixture(markup);
			const el = f.doc.querySelector("#x");
			const good = f.run("#x", prior);
			assert.equal(good.status, "ready", `${markup} accepts ${prior}`);
			const eventsBefore = [...f.events];
			const r = f.run("#x", refused);
			assert.equal(r.status, "value_rejected", `${markup} refuses ${refused}`);
			assert.equal(r.expected, expected);
			assert.equal(
				el.value,
				prior,
				`${markup}: the refused write must not move the control off ${prior}`,
			);
			assert.deepEqual(
				f.events,
				eventsBefore,
				`${markup}: a refused write must dispatch nothing`,
			);
			f.close();
		}
	});

	test("a colour read-back is compared case-insensitively, because browsers fold hex", () => {
		const f = fixture('<input id="x" type="color">');
		const r = f.run("#x", "#ABCDEF");
		assert.equal(
			r.status,
			"ready",
			"#ABCDEF is a valid colour; the stored #abcdef is the same value",
		);
		assert.equal(r.value.toLowerCase(), "#abcdef");
		assert.equal(r.verified, true);
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
