import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Library's pure model, against the SHIPPED module.
 *
 * These are the predicates the page composes and the stories use as their
 * fixture engine, so a drift between what the rail says and what the catalog
 * answers is caught here rather than in a rendered frame. The route filters
 * server-side in production; this module's client copy still has to agree with
 * the documented rules because stories and optimistic row sets read it.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/library/library-model";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	/* `@shared/i18n` is a VALUE import now (t() for the relative-age labels),
	 * not just the `import type` esbuild used to erase — so the harness needs
	 * the renderer's alias the app's tsconfig already provides. */
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
const {
	LIBRARY_CATEGORIES,
	NO_LIBRARY_FILTERS,
	assetMatchesQuery,
	defaultOrder,
	filterAssets,
	formatBytes,
	formatDuration,
	groupTagsByCategory,
	sortAssets,
	relativeTime,
	locale,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const tag = (id, name, category = "topic") => ({ id, name, category });
const asset = (id, patch = {}) => ({
	id,
	ref: {
		type: "path",
		path: `/tmp/${id}.png`,
		display_path: `~/${id}.png`,
		digest: null,
		content_type: "image/png",
	},
	name: "",
	derived_name: `${id}.png`,
	description: "",
	kind: "image",
	category: "image",
	origin: "generated",
	origin_group: "generated",
	origins: ["generated"],
	tags: [],
	primary_tag: null,
	size_bytes: 1024,
	width: 800,
	height: 600,
	duration_s: null,
	created_at: 1_700_000_000,
	modified_at: 1_700_000_100,
	last_seen_at: 1_700_000_200,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [
		{
			session_id: "abcdef123456",
			session_title: "March invoices",
			origin: "generated",
			tool: "generate_image",
			at: 1_700_000_000,
			intent: null,
			first_seq: 3,
			last_seq: 4,
			child_id: null,
			label: null,
		},
	],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "image/png", pages: null },
	organized: null,
	locked: false,
	favorite: false,
	archived: false,
	...patch,
});

const ROWS = [
	asset("la_0000000000000001", {
		name: "invoice hero",
		description: "A tall invoice illustration",
		tags: [tag("t1", "finance"), tag("t2", "q4", "project")],
		highlighted: true,
		favorite: true,
		size_bytes: 2_500_000,
		kind: "image",
		category: "image",
		last_seen_at: 1_700_000_300,
	}),
	asset("la_0000000000000002", {
		name: "Q4 deck",
		kind: "pptx",
		category: "presentation",
		origin: "written",
		origin_group: "created",
		size_bytes: 18_200_000,
		organized: { at: 1_700_000_400, by: "librarian", confidence: 0.8 },
		derived_name: "q4-deck.pptx",
		last_seen_at: 1_700_000_150,
	}),
	asset("la_0000000000000003", {
		name: "old notes",
		kind: "markdown",
		category: "document",
		origin: "mentioned",
		origin_group: "mentioned",
		organized: null,
		last_seen_at: 1_600_000_000,
	}),
];

test("default direction follows the route's documented defaults", () => {
	assert.equal(defaultOrder("name"), "asc");
	assert.equal(defaultOrder("kind"), "asc");
	assert.equal(defaultOrder("recent"), "desc");
	assert.equal(defaultOrder("size"), "desc");
});

test("search covers the fields the route searches", () => {
	assert.equal(assetMatchesQuery(ROWS[0], "invoice"), true);
	assert.equal(assetMatchesQuery(ROWS[0], "FINANCE"), true);
	assert.equal(assetMatchesQuery(ROWS[0], "march invoices"), true);
	assert.equal(assetMatchesQuery(ROWS[0], "~ la_0000000000000001"), false);
	assert.equal(assetMatchesQuery(ROWS[1], "q4 deck"), true);
	assert.equal(assetMatchesQuery(ROWS[1], "nothing"), false);
});

test("category, origin, status, tag and session filters compose", () => {
	/* This case is about the other filters; `all` keeps every fixture visible
	 * regardless of the population scope. */
	const ALL = { ...NO_LIBRARY_FILTERS, scope: "all" };
	const byCategory = filterAssets(ROWS, {
		...ALL,
		category: "presentation",
	});
	assert.deepEqual(
		byCategory.map((row) => row.id),
		["la_0000000000000002"],
	);
	assert.equal(
		filterAssets(ROWS, { ...ALL, originGroup: "mentioned" }).length,
		1,
	);
	assert.equal(filterAssets(ROWS, { ...ALL, status: "favorite" }).length, 1);
	assert.equal(
		filterAssets(ROWS, { ...ALL, status: "unorganized" }).length,
		2,
		"the two rows with no organized receipt are unorganized",
	);
	assert.equal(filterAssets(ROWS, { ...ALL, status: "highlighted" }).length, 1);
	assert.equal(filterAssets(ROWS, { ...ALL, tag: "t2" }).length, 1);
	assert.equal(
		filterAssets(ROWS, {
			...ALL,
			session: "abcdef123456",
		}).length,
		3,
		"every fixture row carries the same occurrence",
	);
});

test("the default scope keeps final artifacts and all restores inclusions", () => {
	assert.deepEqual(
		filterAssets(ROWS, NO_LIBRARY_FILTERS).map((row) => row.id),
		["la_0000000000000001"],
		"final keeps the highlighted row and drops created/mentioned rows",
	);
	assert.deepEqual(
		filterAssets(ROWS, { ...NO_LIBRARY_FILTERS, scope: "all" }).map(
			(row) => row.id,
		),
		["la_0000000000000001", "la_0000000000000002", "la_0000000000000003"],
		"all restores the created and mentioned rows",
	);
});

test("sort orders match the menu's promise", () => {
	assert.deepEqual(
		sortAssets(ROWS, "recent", "desc").map((row) => row.id),
		["la_0000000000000001", "la_0000000000000002", "la_0000000000000003"],
	);
	assert.deepEqual(
		sortAssets(ROWS, "name", "asc").map((row) => row.name),
		["invoice hero", "old notes", "Q4 deck"],
	);
	assert.deepEqual(
		sortAssets(ROWS, "size", "desc").map((row) => row.size_bytes),
		[18_200_000, 2_500_000, 1024],
	);
});

test("tag groups put known categories first and unknown last", () => {
	const groups = groupTagsByCategory([
		tag("t3", "misc", "zeta"),
		tag("t1", "finance", "topic"),
		tag("t2", "q4", "project"),
	]);
	assert.deepEqual(
		groups.map((group) => group.category),
		["topic", "project", "zeta"],
	);
});

test("categories are ordered and extensible", () => {
	assert.deepEqual(
		LIBRARY_CATEGORIES.map((row) => row.key),
		[
			"image",
			"sound",
			"document",
			"presentation",
			"video",
			"spreadsheet",
			"code",
			"other",
		],
	);
});

test("byte and duration formatting is compact and honest", () => {
	assert.equal(formatBytes(0), "0 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(2_500_000), "2.4 MB");
	assert.equal(formatBytes(18_200_000), "17 MB");
	assert.equal(formatDuration(61), "1:01");
	assert.equal(formatDuration(null), "");
});

/*
 * RELATIVE AGES — the threshold ladder, then the defect this pins.
 *
 * `relativeTime` used to return hardcoded English, so every locale rendered its
 * translated sentence with an English tail ("Classé par librarian le 2h ago").
 * The first case freezes the pre-localization behaviour (tests, rounding, the
 * empty string) so a localization change cannot quietly move a threshold; the
 * second renders THE SAME AGE at three locales and requires three different
 * strings, which is the only assertion that fails on the old code.
 */
const AGES_NOW = 1_700_000_000_000;
const ageOf = (ms) => (AGES_NOW - ms) / 1000;

test("relativeTime keeps the pre-localization ladder, rounding and empty case", () => {
	locale.setLocale("en");
	const cases = [
		[0, "just now"],
		[59_999, "just now"],
		[60_000, "1m ago"],
		[59 * 60_000, "59m ago"],
		[60 * 60_000, "1h ago"],
		[23 * 3_600_000, "23h ago"],
		[24 * 3_600_000, "1d ago"],
		[29 * 86_400_000, "29d ago"],
		[30 * 86_400_000, "1mo ago"],
		[359 * 86_400_000, "11mo ago"],
		[360 * 86_400_000, "1y ago"],
	];
	for (const [ms, expected] of cases) {
		assert.equal(
			relativeTime(ageOf(ms), AGES_NOW),
			expected,
			`${ms}ms old must render ${expected}`,
		);
	}
	assert.equal(relativeTime(null, AGES_NOW), "");
	assert.equal(relativeTime(undefined, AGES_NOW), "");
	assert.equal(relativeTime(0, AGES_NOW), "");
});

test("the same age renders in the reader's language", () => {
	const ages = [
		[30_000, { en: "just now", fr: "à l’instant", "zh-CN": "刚刚" }],
		[120_000, { en: "2m ago", fr: "il y a 2 min", "zh-CN": "2分钟前" }],
		[2 * 3_600_000, { en: "2h ago", fr: "il y a 2 h", "zh-CN": "2小时前" }],
		[3 * 86_400_000, { en: "3d ago", fr: "il y a 3 j", "zh-CN": "3天前" }],
		[
			5 * 30 * 86_400_000,
			{ en: "5mo ago", fr: "il y a 5 mois", "zh-CN": "5个月前" },
		],
		[
			2 * 12 * 30 * 86_400_000,
			{ en: "2y ago", fr: "il y a 2 ans", "zh-CN": "2年前" },
		],
	];
	for (const [ms, expected] of ages) {
		for (const [tag, rendered] of Object.entries(expected)) {
			locale.setLocale(tag);
			assert.equal(
				relativeTime(ageOf(ms), AGES_NOW),
				rendered,
				`${tag} must render ${rendered}, not the English source`,
			);
		}
	}
	locale.setLocale("en");
});
