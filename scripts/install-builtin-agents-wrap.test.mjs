/**
 * The "install all built-in agents" action wraps instead of overflowing
 * (i18n census L1).
 *
 *     node --test scripts/install-builtin-agents-wrap.test.mjs
 *
 * THE DEFECT. In ru the primary action reads "Установить всех встроенных
 * агентов", and the base Button's `whitespace-nowrap` + fixed `h-8` ran it past
 * both edges of the sidebar-width button. The fix lets the label wrap and the
 * button grow from the same 32 px floor. jsdom/SSR has no layout, so this pins
 * the RENDERED class list of the real component in ru (tailwind-merge has to
 * have dropped the base's nowrap and fixed height for the override to win).
 *
 * CLASS NAMES ARE NOT LAYOUT PROOF (code review round 1, R1-4). This file
 * cannot show that the ru label stops overflowing or that en stays 32 px tall:
 * that is the rendered-frame pass (ru/es/fr two balanced lines, en one line at
 * 32 px). What it does pin is the arithmetic those frames rest on: the
 * `secondary` Button carries a 1 px border on each side (border-box), so the
 * vertical padding must be `py-1` - 19.5 px line + 2 x 4 px + 2 x 1 px =
 * 29.5 px, under the `min-h-8` floor, so en keeps exactly 32 px. `py-1.5`
 * made it 33.5 px (design D3 / code R1-3 / QA Q-2).
 */
import assert from "node:assert/strict";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = resolve(import.meta.dirname, "..");
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
const CACHE = resolve(ROOT, "node_modules", ".cache", "install-builtin-wrap");
mkdirSync(CACHE, { recursive: true });
const bundle = await build({
	stdin: {
		contents: [
			'export { InstallBuiltinAgents } from "./src/renderer/src/features/agents/components/install-builtin-agents";',
			'export { setLocale, t } from "./src/i18n";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "{}" },
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: /^[^./]/ }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
	logLevel: "silent",
});
const bundlePath = resolve(CACHE, `install-builtin-wrap-${process.pid}.mjs`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { InstallBuiltinAgents, setLocale, t } = await import(
	pathToFileURL(bundlePath).href
);
unlinkSync(bundlePath);

/*
 * React 18's server renderer warns once per `useLayoutEffect` (the component's
 * focus handoff), which is expected here: only the first paint's markup is
 * under test. Only that warning is filtered.
 */
const consoleError = console.error;
console.error = (first, ...rest) => {
	if (String(first).includes("useLayoutEffect does nothing on the server"))
		return;
	consoleError(first, ...rest);
};

const render = () =>
	renderToStaticMarkup(
		h(
			QueryClientProvider,
			{ client: new QueryClient() },
			h(InstallBuiltinAgents, {
				builtins: [{ id: "coder", name: "coder" }],
				presentation: "primary",
			}),
		),
	);

const actionClasses = (markup, label) => {
	const match = markup.match(
		/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/,
	);
	assert.ok(match, markup);
	assert.equal(match[2], label);
	return match[1].split(/\s+/);
};

test("the primary install action wraps its label and grows in ru (and en)", () => {
	try {
		for (const locale of ["ru", "en"]) {
			setLocale(locale);
			const label = t("ui.agents.starters.action.all_builtins");
			const classes = actionClasses(render(), label);
			for (const wanted of [
				"whitespace-normal",
				"h-auto",
				"min-h-8",
				"text-center",
				"w-full",
				"py-1",
			])
				assert.ok(
					classes.includes(wanted),
					`${locale}: ${wanted} in ${classes}`,
				);
			for (const unwanted of ["whitespace-nowrap", "h-8"])
				assert.ok(
					!classes.includes(unwanted),
					`${locale}: ${unwanted} would clip the label`,
				);
			// Any taller padding lifts a one-line en button past the 32 px floor.
			for (const tall of ["py-1.5", "py-2"])
				assert.ok(
					!classes.includes(tall),
					`${locale}: ${tall} + the 1 px border grows en past 32 px`,
				);
		}
	} finally {
		setLocale("en");
	}
});
