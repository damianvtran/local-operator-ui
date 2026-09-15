/**
 * The chart frame's HOVER rule, executable.
 *
 *     node --test scripts/panel-chart-hover.test.mjs
 *
 * Why this file exists. The operator's report was that hovering a bar chart
 * highlighted the whole COLUMN: recharts' default cursor for a `BarChart` is a
 * full-height `Rectangle` over the category band, painted over the marks, so the
 * bar the question is about was the one thing the pointer did not single out.
 * The fix has two halves that fail in different ways and neither of which a
 * settled screenshot can distinguish from "the chart still works":
 *
 *   1. the Tooltip's cursor is disabled for a BAR chart and left alone for a
 *      LINE chart, where the cursor IS the affordance — so the pin has to be on
 *      the injected Tooltip's own prop, per chart type, not on a screenshot;
 *   2. the active bar carries the hover colour, which is a FRAME_CLASS rule
 *      because a CSS rule beats the SVG presentation attribute a prop would
 *      write — and the rule only wins if it comes AFTER the plain-rectangle rule
 *      it shares its specificity with. Source text is the only place that order
 *      is visible.
 *
 * The middle layer is the shipped `withActiveBar` itself, over real recharts
 * elements: recharts reaches a mark's active state only when the mark declares
 * an active shape, so a helper that quietly stopped setting the prop would
 * restore the defect with every assertion above it still green.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement as h } from "react";
import { Bar, BarChart, Line, LineChart, Tooltip, XAxis } from "recharts";

const ROOT = resolve(import.meta.dirname, "..");
const FRAME =
	"src/renderer/src/features/chat/pickers/panels/primitives/chart-frame.tsx";

/*
 * React stays out of the bundle so the module under test shares THIS process's
 * React — element symbols are per-instance, and a second copy would compare
 * elements from two different Reacts. `packages: "external"` keeps the specifier
 * bare, so the bundle has to be a real file rather than a `data:` URL, which
 * cannot resolve a bare import. Same helper as `panel-chart-motion.test.mjs`.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-chart-hover");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		packages: "external",
		loader: { ".css": "empty" },
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
			"@features": resolve("src/renderer/src/features"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const { ChartFrame, withActiveBar } = await bundleInto(
	"chart-frame",
	`export { ChartFrame, withActiveBar } from "./${FRAME}";`,
);

const frameSource = readFileSync(join(ROOT, FRAME), "utf8");

const DATA = [
	{ bucket: "Sep 12", value: 132_400 },
	{ bucket: "Sep 13", value: 448_200 },
];

/** The injected Tooltip, found in the frame's own clone of the caller's chart. */
const tooltipOf = (chart) =>
	(chart.props.children ?? []).find((child) => child?.type === Tooltip);

/** The marks the frame passed through, in the caller's order. */
const marksOf = (chart) =>
	(chart.props.children ?? []).filter((child) =>
		[Bar, Line].includes(child?.type),
	);

/**
 * The chart the frame actually renders, reached the way the settings chart's
 * own test reaches it: the classed box holds one `ResponsiveContainer`, whose
 * single child is the clone.
 */
const rendered = (chart) => {
	const frame = ChartFrame({
		heightClassName: "h-62",
		yAxisWidth: 48,
		srSummary: "Daily tokens for the last 7 days",
		children: chart,
	});
	return frame.props.children[2].props.children.props.children;
};

test("a bar chart's cursor band is off and a line chart's cursor stays", () => {
	/*
	 * The band is what the operator reported: on a `BarChart` recharts paints a
	 * full-height `Rectangle` over the category (`component/Cursor.js` →
	 * `getCursorRectangle`), which is a claim about the COLUMN where the user
	 * asked about the bar. `cursor={false}` removes it; `undefined` (not `true`)
	 * is the line chart's answer, so the frame keeps recharts' default there
	 * rather than pinning a value this change has no opinion about.
	 */
	const bars = rendered(
		h(
			BarChart,
			{ data: DATA },
			h(Bar, { dataKey: "value", name: "Tokens used" }),
		),
	);
	assert.equal(tooltipOf(bars)?.props.cursor, false);

	const line = rendered(
		h(
			LineChart,
			{ data: DATA },
			h(Line, { dataKey: "value", name: "Tokens used", dot: false }),
		),
	);
	/*
	 * The line chart keeps recharts' own default rather than a value of this
	 * frame's — `defaultProps.cursor` is `true`, and React resolves it while the
	 * element is CREATED, so "the frame wrote nothing" is what `true` reads as
	 * here. Pinned rather than asserted as `!== false` because the property that
	 * matters is that the frame did not disable the one cursor that IS the
	 * affordance on a chart with no mark to highlight.
	 */
	assert.equal(tooltipOf(line)?.props.cursor, true);

	// The tooltip itself is unchanged: the frame still injects its own renderer
	// and still formats through the one formatter prop.
	for (const chart of [bars, line]) {
		const tooltip = tooltipOf(chart);
		assert.ok(tooltip, "the frame injects the tooltip");
		assert.ok(tooltip.props.content, "with the frame's own renderer");
	}
});

test("the frame hands every bar an active shape, and no other mark one", () => {
	const bars = rendered(
		h(
			BarChart,
			{ data: DATA },
			h(Bar, { dataKey: "value", name: "Tokens used" }),
		),
	);
	const [bar] = marksOf(bars);
	assert.equal(
		bar.props.activeBar,
		true,
		"recharts reaches a mark's active state only when it declares an active shape (generateCategoricalChart.js)",
	);
	// The motion rule is still applied by the same pass, so the two mark-level
	// rules cannot be satisfied one at a time.
	assert.equal(bar.props.isAnimationActive, false);

	const line = rendered(
		h(LineChart, { data: DATA }, h(Line, { dataKey: "value", dot: false })),
	);
	const [stroke] = marksOf(line);
	assert.equal(
		Object.hasOwn(stroke.props, "activeBar"),
		false,
		"a line was given the bar's hover prop",
	);
});

test("withActiveBar marks bars, reaches nested ones, and leaves the rest alone", () => {
	const only = (node) => {
		const mapped = withActiveBar(node);
		return Array.isArray(mapped) ? mapped[0] : mapped;
	};

	const bar = only(h(Bar, { dataKey: "value" }));
	assert.equal(bar.props.activeBar, true, "Bar did not get its active shape");

	const line = only(h(Line, { dataKey: "value" }));
	assert.equal(
		Object.hasOwn(line.props, "activeBar"),
		false,
		"a line was given the bar prop",
	);

	/*
	 * A non-mark must gain NOTHING: the frame injects axes whose props recharts
	 * spreads onto SVG nodes, where an unknown attribute warns.
	 */
	const axis = h(XAxis, { dataKey: "bucket" });
	const axisAfter = only(axis);
	assert.deepEqual(
		Object.keys(axisAfter.props).filter((key) => !(key in axis.props)),
		[],
		"a non-mark element came back with props it was not given",
	);

	// Reached through a wrapper: a clone that only looked at the top level would
	// pass every assertion above while failing on a chart that nests its marks.
	const wrapper = only(h("g", { key: "w" }, h(Bar, { dataKey: "value" })));
	const inner = only(wrapper.props.children);
	assert.equal(inner.props.activeBar, true, "a nested bar kept its old shape");
});

test("the hover colour is a role rule on the active wrapper", () => {
	/*
	 * Source text, not behaviour, for the reason the motion test pins its own
	 * line the same way: the defect is a plausible-looking ENCODING that renders
	 * almost right. A presentation attribute cannot take a `var()`, and a CSS
	 * rule beats a presentation attribute — so a hover colour passed as
	 * `activeBar={{ fill: ... }}` is silently overridden by the plain-rectangle
	 * rule, and no rendered frame can tell the difference from the role.
	 *
	 * WHAT DECIDES THE WIN is the NESTING rather than the source order (review
	 * round 1, F2): recharts renders the active shape inside a
	 * `<g class="recharts-active-bar">` that is a DESCENDANT of the
	 * `<g class="recharts-bar-rectangle">` wrapper, and `fill` is inherited, so the
	 * path takes the active wrapper's value from its nearest ancestor. This test
	 * therefore asserts that both rules EXIST and that the active one names a role —
	 * not their order, which a reorder of `FRAME_CLASS` can change with no
	 * behavioural effect.
	 */
	const plain = frameSource.indexOf(
		'"[&_.recharts-bar-rectangle]:fill-accent"',
	);
	const active = frameSource.indexOf(
		'"[&_.recharts-active-bar]:fill-chart-bar-hover"',
	);
	assert.ok(plain > 0, "the plain bar rule is gone");
	assert.ok(
		active > 0,
		"the active-bar rule is gone: without it every rectangle is the same rectangle and the frame's only hover affordance would be the cursor band this change removes",
	);
	// The role, not a hex and not a palette lookup: `chart-bar-hover` is the
	// contract's own "the mark under the pointer".
	assert.doesNotMatch(
		frameSource.slice(active, active + 80),
		/#[0-9a-fA-F]{3,8}/,
		"the hover fill is a literal colour rather than the chart-bar-hover role",
	);
});
