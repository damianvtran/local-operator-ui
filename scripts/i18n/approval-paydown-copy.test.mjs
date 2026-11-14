import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * S18b: NINE LITERALS THE SCANNER ALLOWED BECOME CATALOGUE KEYS, so switching the
 * interface language leaves no English in them.
 *
 * The nine are the data-shape ids paid down from `i18n/literal-allowance.json`:
 *
 *   tool-detail.tsx        Interrupted / Error / Output  (the result's section label)
 *   code-block.tsx         Code                          (the heading when none is given)
 *   invalid-attachment.tsx "{name} is not viewable (…)"  (media that cannot be shown)
 *   run-detail-subagents   "Show {count} more"           (the roster's disclosure)
 *   credential-chip.tsx    "· {chars} chars"             (the pill's character count)
 *   agent-detail.tsx       the create/duplicate form's description, both branches
 *
 * Three properties, for three different readers:
 *
 * 1. ENGLISH IS BYTE-IDENTICAL to what the code printed before the keys existed
 *    (the strings below are the literals at origin/main a114b6d102), through the
 *    repo's own render path: `t()` -> IntlMessageFormat, and for the components
 *    the real markup. ONE deliberate exception, pinned as such: the credential
 *    pill said "1 chars" for a one-character secret; the plural now says
 *    "1 char", which is the whole reason that phrase is one ICU message.
 * 2. A REGISTERED PROBE LOCALE REACHES EACH SURFACE, which is the difference
 *    between "keyed" and "still English in fr". The stubs are markers, not
 *    translations (those live in `src/i18n/catalogues/<locale>/`). Each surface
 *    is read at call time: switching back repaints English with no memo.
 * 3. THE CONTROL IS REAL. `S18B_CONTROL_BASE=<sha> node --test <this file>`
 *    loads the six components from that commit instead of the working tree; on
 *    origin/main (which reads no key) the probe-locale assertions must FAIL and
 *    the English pins must still pass, proving the pins describe the old output
 *    and the probe tests discriminate.
 */

const ROOT = process.cwd();
const controlBase = process.env.S18B_CONTROL_BASE;
const FEATURES = "src/renderer/src/features";
const COMPONENTS = [
	`${FEATURES}/chat/components/trace/tool-detail.tsx`,
	`${FEATURES}/chat/components/message-item/code-block.tsx`,
	`${FEATURES}/chat/components/message-item/invalid-attachment.tsx`,
	`${FEATURES}/chat/components/run-details/run-detail-subagents.tsx`,
	`${FEATURES}/chat/components/credential-chip.tsx`,
	`${FEATURES}/agents/components/agent-detail.tsx`,
];

const baseSource = (path) =>
	execFileSync("git", ["show", `${controlBase}:${path}`], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

const TSX_FILE = /\.tsx$/;
const controlPlugin = {
	name: "pre-fix-components-control",
	setup(builder) {
		builder.onLoad({ filter: TSX_FILE }, ({ path }) => {
			const rel = relative(ROOT, path);
			if (!COMPONENTS.includes(rel)) return undefined;
			return {
				contents: baseSource(rel),
				loader: "tsx",
				resolveDir: dirname(path),
			};
		});
	},
};

const bundle = await build({
	stdin: {
		contents: `export { ToolDetail } from "./${COMPONENTS[0]}";
export { CodeBlock } from "./${COMPONENTS[1]}";
export { InvalidAttachment } from "./${COMPONENTS[2]}";
export { RunDetailSubagents } from "./${COMPONENTS[3]}";
export { CredentialChip } from "./${COMPONENTS[4]}";
export { AgentCreate } from "./${COMPONENTS[5]}";
export { MemoryRouter } from "react-router-dom";
export { setLocale, registerCatalogue, clearRegisteredCatalogues, t } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	plugins: controlBase ? [controlPlugin] : [],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	// One copy of react/react-query with the renders below.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
// A FILE, not a data: URL: the bundle keeps `react` external and a data: module
// cannot resolve a bare specifier.
const bundlePath = new URL(
	"./_approval-paydown-copy.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	ToolDetail,
	CodeBlock,
	InvalidAttachment,
	RunDetailSubagents,
	CredentialChip,
	AgentCreate,
	MemoryRouter,
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
	t,
} = mod;

const catalogue = (ns) =>
	JSON.parse(
		readFileSync(join(ROOT, `src/i18n/catalogues/en/${ns}.json`), "utf8"),
	);

/* key -> [namespace file, ICU args, the English the code printed before]. */
const KEYS = {
	"ui.chat.canonical.tool_row.detail_section.error": [
		"ui.chat.canonical",
		{},
		"Error",
	],
	"ui.chat.canonical.tool_row.detail_section.interrupted": [
		"ui.chat.canonical",
		{},
		"Interrupted",
	],
	"ui.chat.canonical.tool_row.detail_section.output": [
		"ui.chat.canonical",
		{},
		"Output",
	],
	"ui.chat.code_block.default_header": ["ui.chat", {}, "Code"],
	"ui.chat.attachments.not_viewable_detail": [
		"ui.chat.attachments",
		{ name: "clip.mp4" },
		"clip.mp4 is not viewable (file may be incomplete, deleted, or moved)",
	],
	"ui.chat.run_details.subagents.show_more": [
		"ui.chat.run_details",
		{ count: 3 },
		"Show 3 more",
	],
	"ui.chat.credential_notice.chip_chars": [
		"ui.chat.credential_notice",
		{ chars: 19 },
		"· 19 chars",
	],
	"ui.agents.detail.create.description_duplicate": [
		"ui.agents.detail",
		{ name: "Aida" },
		"A copy of Aida. It is a separate agent: changing it does not change the original.",
	],
	"ui.agents.detail.create.description_new": [
		"ui.agents.detail",
		{},
		"Reusable instructions shared by agent commands, subagents and teams. Chats stay separate.",
	],
};

const withLocale = (locale, probe, body) => {
	registerCatalogue(locale, probe);
	setLocale(locale);
	try {
		return body();
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
};

/* A marker per key; ICU shapes kept so a wrong placeholder shows as a wrong marker. */
const PROBE = {
	...Object.fromEntries(
		Object.keys(KEYS).map((k) => [k, `FR[${k.split(".").slice(-1)}]`]),
	),
	"ui.chat.attachments.not_viewable_detail": "FR[not_viewable_detail]{name}",
	"ui.chat.run_details.subagents.show_more": "FR[show_more]{count, number}",
	"ui.chat.credential_notice.chip_chars":
		"FR[chip_chars]{chars, plural, one {#:un} other {#:autres}}",
	"ui.agents.detail.create.description_duplicate":
		"FR[description_duplicate]{name}",
};

test("the nine S18b keys exist, each with a context entry, and render today's English", () => {
	setLocale("en");
	for (const [key, [ns, args, english]] of Object.entries(KEYS)) {
		assert.ok(key in catalogue(ns), `${key} is in ${ns}.json`);
		const context = JSON.parse(
			readFileSync(
				join(ROOT, `src/i18n/catalogues/en/${ns}.context.json`),
				"utf8",
			),
		)[key];
		assert.ok(context, `${key} has a context entry`);
		assert.deepEqual(
			Object.keys(context.placeholders).sort(),
			Object.keys(args).sort(),
			`${key}'s sidecar documents exactly its placeholders`,
		);
		assert.equal(t(key, args), english, key);
	}
});

test("the chip's phrase pluralises and never groups digits", () => {
	setLocale("en");
	const key = "ui.chat.credential_notice.chip_chars";
	// The ONE deliberate English change: the old template said "1 chars".
	assert.equal(t(key, { chars: 1 }), "· 1 char");
	assert.equal(t(key, { chars: 2 }), "· 2 chars");
	// Old output was `${chars}` with no grouping; `#` would have printed 1,234.
	assert.equal(t(key, { chars: 1234 }), "· 1234 chars");
	assert.equal(
		t("ui.chat.run_details.subagents.show_more", { count: 1234 }),
		"Show 1234 more",
	);
});

/*
 * `ToolDetail` measures with `useLayoutEffect`, which React warns about on the
 * server render this suite uses; the warning is about hydration, not copy, so it
 * is dropped here rather than left to bury a real failure in the log.
 */
const markup = (el) => {
	const error = console.error;
	console.error = (message, ...rest) => {
		if (String(message).includes("useLayoutEffect does nothing")) return;
		error(message, ...rest);
	};
	try {
		return renderToStaticMarkup(el);
	} finally {
		console.error = error;
	}
};
const text = (html) => html.replace(/<[^>]*>/g, "");

const toolDetail = (props) =>
	text(
		markup(
			h(ToolDetail, {
				args: { command: "ls" },
				output: "ok",
				isError: false,
				...props,
			}),
		),
	);

const subagentRows = (count) =>
	Array.from({ length: count }, (_, i) => ({
		id: `c${i}`,
		label: `child ${i}`,
		role: null,
		jobType: null,
		status: "done",
		elapsedLabel: null,
		startSeconds: null,
		settledSeconds: null,
		contextLabel: null,
		costLabel: null,
		activity: null,
		errorLine: null,
	}));
const subagents = () =>
	text(
		markup(
			h(RunDetailSubagents, {
				details: { subagents: subagentRows(9), lineage: [] },
				expanded: false,
				onToggleExpanded: () => {},
				onOpenChild: () => {},
				interactive: true,
				paneWidth: 600,
			}),
		),
	);

const createForm = (initial) =>
	text(
		markup(
			h(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
				h(
					MemoryRouter,
					null,
					h(AgentCreate, {
						initial,
						takenNames: [],
						effortTiers: [],
						onSaved: () => {},
						onCancel: () => {},
					}),
				),
			),
		),
	);

/* One entry per surface: how to paint it, the English it must print, the probe marker. */
const SURFACES = {
	"tool detail: output": [() => toolDetail({}), "Output", "FR[output]"],
	"tool detail: error": [
		() => toolDetail({ isError: true }),
		"Error",
		"FR[error]",
	],
	"tool detail: interrupted": [
		() => toolDetail({ isError: true, interrupted: true }),
		"Interrupted",
		"FR[interrupted]",
	],
	"code block": [
		() => text(markup(h(CodeBlock, { code: "x = 1", language: "python" }))),
		"Code",
		"FR[default_header]",
	],
	"invalid attachment": [
		() => text(markup(h(InvalidAttachment, { file: "/tmp/dir/clip.mp4" }))),
		"clip.mp4 is not viewable (file may be incomplete, deleted, or moved)",
		"FR[not_viewable_detail]clip.mp4",
	],
	"subagents disclosure": [subagents, "Show 3 more", "FR[show_more]3"],
	"credential chip": [
		() =>
			text(markup(h(CredentialChip, { label: "Credential #1", chars: 19 }))),
		"· 19 chars",
		"FR[chip_chars]19:autres",
	],
	"create form: duplicate": [
		() =>
			createForm({
				name: "Aida",
				kind: "role",
				description: "",
				instructions: "",
			}),
		"A copy of Aida. It is a separate agent: changing it does not change the original.",
		"FR[description_duplicate]Aida",
	],
	"create form: new": [
		() => createForm(null),
		"Reusable instructions shared by agent commands, subagents and teams. Chats stay separate.",
		"FR[description_new]",
	],
};

for (const [surface, [paint, english, marker]] of Object.entries(SURFACES)) {
	test(`${surface}: English markup is unchanged`, () => {
		setLocale("en");
		assert.ok(paint().includes(english), `${surface} prints "${english}"`);
	});

	test(`${surface}: a registered locale reaches it at render time`, () => {
		const painted = withLocale("fr", PROBE, paint);
		assert.ok(
			painted.includes(marker),
			`${surface} prints ${marker}; got ${painted.slice(0, 300)}`,
		);
		assert.ok(
			!painted.includes(english),
			`${surface} no longer prints "${english}" in fr`,
		);
		// Nothing was captured at load: back in English the next render is English.
		assert.ok(paint().includes(english), `${surface} repaints English`);
	});
}
