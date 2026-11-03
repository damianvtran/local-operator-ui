import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Execute the shipped, self-contained page function in a DOM, not a second
// matching implementation. Native Chromium event/framework proof is separate.
const bundle = await build({
	entryPoints: ["src/main/browser/actions/select.ts"],
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
});
const { selectPage, select } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function fixture(
	attrs = "",
	body = '<option value="a"> Alpha </option><option value="b">Beta</option><option value="Alpha">Other</option>',
) {
	const dom = new JSDOM(`<select ${attrs}>${body}</select>`);
	const el = dom.window.document.querySelector("select");
	return {
		el,
		run: (mode, options) => selectPage.call(el, mode, options),
		close: () => dom.window.close(),
	};
}
test("native matching: exact trimmed label, case-insensitive label, value, then index; label beats value", () => {
	const f = fixture();
	for (const [option, index] of [
		["  Alpha ", 0],
		["bEtA", 1],
		["b", 1],
		[2, 2],
		["Alpha", 0],
	]) {
		const r = f.run("apply", [option]);
		assert.equal(r.status, "ready");
		assert.equal(r.selected[0].index, index);
		assert.equal(r.verified, true);
	}
	f.close();
});
test("native multiple replaces exactly; empty clears; single requires exactly one", () => {
	const multi = fixture("multiple");
	multi.run("apply", [0, 1]);
	assert.deepEqual(
		multi.run("apply", [2]).selected.map((o) => o.index),
		[2],
	);
	assert.deepEqual(multi.run("apply", []).selected, []);
	multi.close();
	const single = fixture();
	assert.equal(single.run("apply", [0, 1]).status, "single_select");
	assert.equal(single.el.selectedIndex, 0);
	let events = 0;
	single.el.addEventListener("input", () => {
		events += 1;
	});
	single.el.addEventListener("change", () => {
		events += 1;
	});
	assert.equal(single.run("apply", []).status, "single_select");
	assert.equal(
		single.el.selectedIndex,
		0,
		"empty request must not clear a single select",
	);
	assert.equal(events, 0, "refusal must emit no mutation events");
	single.close();
});
test("disabled select, disabled option, disabled optgroup refuse atomically", () => {
	for (const [attrs, html] of [
		["disabled", undefined],
		["", "<option>ok</option><option disabled>no</option>"],
		[
			"",
			"<option>ok</option><optgroup disabled><option>no</option></optgroup>",
		],
	]) {
		const f = fixture(attrs, html);
		const before = f.el.selectedIndex;
		assert.equal(f.run("apply", [1]).status, "disabled");
		assert.equal(f.el.selectedIndex, before);
		f.close();
	}
});
test("no match returns bounded correction list and never changes selection", () => {
	const f = fixture(
		"",
		Array.from(
			{ length: 80 },
			(_, i) => `<option value="${i}">${"x".repeat(200)}${i}</option>`,
		).join(""),
	);
	const r = f.run("apply", ["missing"]);
	assert.equal(r.status, "option_not_found");
	assert.equal(r.available.length, 50);
	assert.equal(r.available[0].label.length, 120);
	assert.equal(f.el.selectedIndex, 0);
	f.close();
});
test("prototype setters plus input/change feed controlled wrappers; read detects a revert", () => {
	const f = fixture();
	let held = "a";
	const events = [];
	f.el.addEventListener("input", () => events.push("input"));
	f.el.addEventListener("change", () => {
		events.push("change");
		held = f.el.value;
	});
	Object.defineProperty(f.el, "value", {
		get() {
			return held;
		},
		set() {
			throw new Error("instance tracker must not receive assignment");
		},
	});
	// Event handler uses native getter, simulating framework state synchronisation.
	f.el.onchange = () => {
		held = Object.getOwnPropertyDescriptor(
			f.el.ownerDocument.defaultView.HTMLSelectElement.prototype,
			"value",
		).get.call(f.el);
	};
	assert.equal(f.run("apply", ["Beta"]).verified, true);
	assert.deepEqual(events, ["input", "change"]);
	assert.equal(held, "b");
	f.el.selectedIndex = 0;
	assert.equal(f.run("read", ["Beta"]).verified, false);
	f.close();
});
test("ARIA matching never forges aria-selected; verification follows real widget state", () => {
	const dom = new JSDOM(
		'<button role="combobox" aria-controls="list">Choose</button><div id="list" role="listbox"><div role="option" data-value="a">Alpha</div><div role="option" data-value="b">Beta</div></div>',
	);
	const trigger = dom.window.document.querySelector("button");
	const run = (mode) => selectPage.call(trigger, mode, ["Beta"]);
	assert.equal(run("read").verified, false);
	assert.equal(run("option").textContent, "Beta");
	run("option").setAttribute("aria-selected", "true");
	assert.equal(run("read").verified, true);
	assert.equal(run("read").selected[0].value, "b");
	dom.window.close();
});
test("argument validation touches no registry or page for missing/bad options", async () => {
	const ctx = {
		registry: {
			requireSurface() {
				assert.fail("page touched");
			},
		},
	};
	for (const params of [
		{},
		{ selector: "#x" },
		{ selector: "#x", options: [true] },
		{ selector: "#x", options: [-1] },
		{ selector: "#x", options: [1.2] },
		{ selector: "#x", options: "b" },
	])
		await assert.rejects(
			select(ctx, params),
			(e) => e.code === "internal" && e.data.reason === "invalid_arguments",
		);
});

test("ARIA active descendant alone is focus, not committed selection", () => {
	const dom = new JSDOM(
		'<button role="combobox" aria-controls="list" aria-activedescendant="beta">Alpha</button><div id="list" role="listbox"><div role="option" id="alpha" aria-selected="true">Alpha</div><div role="option" id="beta" aria-selected="false">Beta</div></div>',
	);
	const trigger = dom.window.document.querySelector("button");
	const read = () => selectPage.call(trigger, "read", ["Beta"]);
	assert.equal(
		read().verified,
		false,
		"focused Beta with selected Alpha is not a committed Beta",
	);
	dom.window.document
		.getElementById("alpha")
		.setAttribute("aria-selected", "false");
	assert.equal(
		read().verified,
		false,
		"no selected option is not committed either",
	);
	trigger.textContent = "Beta";
	assert.equal(
		read().verified,
		true,
		"exact trigger text is committed evidence",
	);
	trigger.textContent = "Alpha";
	dom.window.document
		.getElementById("beta")
		.setAttribute("aria-selected", "true");
	assert.equal(
		read().verified,
		true,
		"chosen option aria-selected is committed evidence",
	);
	dom.window.close();
});
