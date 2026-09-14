/**
 * The chart frame's motion rule, executable.
 *
 *     node --test scripts/panel-chart-motion.test.mjs
 *
 * Why this file exists at all. § 7 of `docs/design/panel-views.md` says charts
 * carry no motion, and `ChartFrame` is the one file that owns the idiom — yet the
 * first cut wrote `isAnimationActive: false` on the CHART element, where recharts
 * never reads it, so every mark animated in anyway and no settled frame could
 * show the difference: a frame taken after the animation is byte-identical to one
 * taken before it. Review round 1 (R1) found it by reading the installed
 * package. This is the check that would have found it too, and it is written
 * against the INSTALLED recharts rather than the documentation, because the
 * documentation is what said the prop worked.
 *
 * Three layers, in the order they can fail:
 *
 *   1. WHERE recharts reads the flag — read out of `node_modules` as source, so a
 *      dependency bump that moves the prop again fails here with the file name
 *      in the message rather than silently re-animating every chart;
 *   2. THAT the frame's own clone puts it on the marks — the shipped
 *      `withoutMotion`, over real recharts elements, including a nested mark and
 *      a non-mark that must come back untouched;
 *   3. THAT the chart-level prop is gone, pinned as source text, because that is
 *      the mistake being kept out.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement as h } from "react";
import { Area, Bar, Line, XAxis } from "recharts";

const ROOT = resolve(import.meta.dirname, "..");
const FRAME =
	"src/renderer/src/features/chat/pickers/panels/primitives/chart-frame.tsx";
const RECO_ = "node_modules/recharts/es6";

/*
 * React stays out of the bundle so the module under test shares THIS process's
 * React — element symbols and `Children.map` are per-instance, and a second copy
 * would compare elements from two different Reacts. `packages: "external"` keeps
 * the specifier bare, so the bundle has to be a real file rather than a `data:`
 * URL, which cannot resolve a bare import. Same helper as
 * `scripts/picker-feedback.test.mjs`.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-chart-motion");
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
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const { withoutMotion } = await bundleInto(
	"chart-frame",
	`export { withoutMotion } from "./${FRAME}";`,
);

const frameSource = readFileSync(join(ROOT, FRAME), "utf8");

test("recharts reads isAnimationActive on the mark, never on the chart", () => {
	/*
	 * The chart module builds `BarChart` and `LineChart` and is where a
	 * chart-level prop would have to be honoured. If a future recharts starts
	 * reading it there, this assertion is the notice that the frame's clone is no
	 * longer the only mechanism — not a licence to drop the clone.
	 */
	const chart = readFileSync(
		join(ROOT, RECO_, "chart/generateCategoricalChart.js"),
		"utf8",
	);
	assert.equal(
		/isAnimationActive/.test(chart),
		false,
		"generateCategoricalChart now mentions isAnimationActive: re-read where recharts reads it before trusting the frame's clone",
	);
	/*
	 * The mark defaults it to `!Global.isSsr`, which is TRUE in a browser — so
	 * the fact this file depends on is "on by default", not the literal value a
	 * Node process sees. Under `node --test` there is no window and the default
	 * evaluates false, which is exactly why the assertion is written against the
	 * expression and not against `true`.
	 */
	for (const file of [
		"cartesian/Bar.js",
		"cartesian/Line.js",
		"cartesian/Area.js",
	]) {
		const source = readFileSync(join(ROOT, RECO_, file), "utf8");
		assert.match(
			source,
			/defaultProps[\s\S]{0,400}?isAnimationActive: !Global\.isSsr/,
			`${file} no longer defaults isAnimationActive to !Global.isSsr`,
		);
	}
});

/*
 * `Children.map` answers with an array even for a single child, and the frame
 * spreads the result into a child list — so the assertions read the first (only)
 * element rather than assuming the helper returns exactly what it was given.
 */
const only = (node) => {
	const mapped = withoutMotion(node);
	return Array.isArray(mapped) ? mapped[0] : mapped;
};

test("the frame's clone turns the marks' animation off, and only the marks'", () => {
	const bar = only(h(Bar, { dataKey: "value" }));
	assert.equal(bar.props.isAnimationActive, false, "Bar kept animating");

	const line = only(h(Line, { dataKey: "value" }));
	assert.equal(line.props.isAnimationActive, false, "Line kept animating");

	const area = only(h(Area, { dataKey: "value" }));
	assert.equal(area.props.isAnimationActive, false, "Area kept animating");

	/*
	 * A non-mark must gain NOTHING. `Children.map` re-keys what it returns, so
	 * identity is not the property to assert — the property that matters is that
	 * no extra prop reaches an axis: the frame injects its own axes and grid, and
	 * recharts spreads their props onto SVG nodes, where an unknown attribute
	 * warns.
	 */
	const axis = h(XAxis, { dataKey: "bucket" });
	const axisAfter = only(axis);
	assert.equal(
		Object.hasOwn(axisAfter.props, "isAnimationActive"),
		false,
		"a non-mark element was given the animation flag",
	);
	/*
	 * Compared against the element's OWN props rather than against `["dataKey"]`:
	 * React fills in every `defaultProps` key of a recharts axis, so the question
	 * is not "which props does it carry" but "which props did this helper add".
	 */
	assert.deepEqual(
		Object.keys(axisAfter.props).filter((key) => !(key in axis.props)),
		[],
		"a non-mark element came back with props it was not given",
	);

	/*
	 * Reached through a wrapper, because a chart is allowed to nest its marks —
	 * and because a clone that only looked at the top level would pass every
	 * assertion above while failing on the next chart someone writes.
	 */
	const wrapper = only(h("g", { key: "w" }, h(Line, { dataKey: "value" })));
	const inner = only(wrapper.props.children);
	assert.equal(
		inner.props.isAnimationActive,
		false,
		"a mark nested inside a wrapper kept animating",
	);
});

test("the chart element is not handed the prop nothing reads", () => {
	/*
	 * Source text, not behaviour: the defect being kept out is a plausible-looking
	 * line, and no assertion on the rendered output can distinguish it from the
	 * fix. `STRUCTURAL_CALL_SITES` in `contrast-contract.mjs` pins wiring the same
	 * way, for the same reason.
	 */
	const chartClone = frameSource.slice(
		frameSource.indexOf("const chart: ReactElement"),
		frameSource.indexOf("const chart: ReactElement") + 900,
	);
	assert.doesNotMatch(
		chartClone,
		/isAnimationActive/,
		"the chart element is carrying isAnimationActive again — recharts reads it on the mark (see withoutMotion)",
	);
	assert.match(
		frameSource,
		/withoutMotion\(\s*\(children as ReactElement<\{ children\?: ReactNode \}>\)\.props\.children/,
		"the caller's marks are no longer passed through withoutMotion",
	);
});
