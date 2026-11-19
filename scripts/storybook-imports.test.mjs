/**
 * EVERY PATH `.storybook/` IMPORTS RESOLVES, THROUGH THE CONFIG'S OWN ALIASES.
 *
 * WHY THIS EXISTS. `2767241bae` imported `@shared/window-glass` in
 * `.storybook/preview.tsx`. The preview's alias map (`.storybook/main.ts`) sends
 * `@shared` to `src/renderer/src/shared`, and the module is at repo-root
 * `src/shared/` - so Vite failed the import, the iframe never mounted and NO
 * story in the repository was reachable. Nothing went red: `.storybook/` sits in
 * no `tsconfig` include (`tsconfig.app.json` starts at `src/renderer/**`), so
 * `pnpm check-types` never reads the file, the `@ts-ignore` on the import would
 * have suppressed the resolution error anyway, and biome parses but does not
 * resolve. A dead gallery and a green gate were compatible states, and the only
 * symptom was an empty page a human had to notice.
 *
 * WHAT IT IS: a resolve sweep, not a policy. Every specifier imported by a
 * `.storybook/` file that names a PATH - relative, or under one of the config's
 * own aliases - is resolved with esbuild, using the alias map read OUT OF
 * `main.ts` rather than a copy kept here (a second copy is a second answer, and
 * the answer that matters is the one the bundler is given).
 *
 * WHAT IT IS NOT: a check of bare package specifiers. Whether `react` resolves is
 * the package manager's business and would make this lane depend on an installed
 * tree; the defect class here is the app's own path mapping.
 *
 * The negative control in the second test is load-bearing: it proves the sweep
 * reports failure instead of passing by construction, which is the difference
 * between a guard and a green light.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const CONFIG_DIR = ".storybook";
const CONFIG_PATH = join(CONFIG_DIR, "main.ts");

/** A taken path is a config file, not a declaration or a snapshot. */
const CONFIG_FILE = /\.(?:ts|tsx|mts|js|mjs)$/;

/**
 * THE ALIASES THIS SWEEP DEPENDS ON, pinned so a deleted one fails loudly instead
 * of quietly redefining "resolvable" (agent review round 4, M4-1).
 *
 * Both tests below agree that an unresolvable specifier is unresolvable - that is
 * what the negative control is for - so deleting an alias from `main.ts` used to
 * make them BOTH pass: the specifier that relied on it stops looking like a path,
 * the sweep skips it, and the gallery-breaker walks back in with a green lane. The
 * list is a CONTAINMENT check, not an equality: a new alias is welcome, a vanished
 * one is a failure that names it.
 */
const EXPECTED_ALIASES = [
	"@renderer",
	"@components",
	"@features",
	"@shared",
	"@assets",
	"@hooks",
	"@api",
	"@store",
	"@resources",
];

/** The synthetic entry's name, so a failure message points at the sweep and not a file. */
const SWEEP_ENTRY = "sweep.ts";

/** The default export's own regexes, hoisted: a literal rebuilt per call is a cost with no reader. */
const MISSING_MODULE = /__import_sweep_probe__|Could not resolve/;

/**
 * The alias map Storybook itself builds, read from the config that applies it.
 *
 * `main.ts` spells every entry as `"@name": resolve("path")`, so the literal is
 * the map - and a reshape of that block fails the count below rather than
 * sweeping nothing in silence.
 */
const storybookAliases = () => {
	const config = readFileSync(join(ROOT, CONFIG_PATH), "utf8");
	const pairs = [
		...config.matchAll(/"(@[a-z]+)":\s*resolve\("([^"]+)"\)/g),
	].map(([, key, target]) => [key, resolve(ROOT, target)]);
	for (const key of EXPECTED_ALIASES)
		assert.ok(
			pairs.some(([found]) => found === key),
			`${CONFIG_PATH} no longer maps ${key}: a specifier that relied on it would stop looking like a path, this sweep would skip it, and a dead gallery would pass both tests`,
		);
	for (const [key, target] of pairs)
		assert.ok(
			target === ROOT || target.startsWith(`${ROOT}/`),
			`${CONFIG_PATH} maps ${key} to ${target}, which is outside the repository - a specifier through it would resolve to somebody else's tree, or to nothing`,
		);
	assert.ok(
		pairs.length >= 8,
		`the alias scan found ${pairs.length} entries in ${CONFIG_PATH}; the config's alias block has changed shape and this sweep is no longer reading it`,
	);
	/*
	 * NO CHECK THAT EVERY TARGET IS A DIRECTORY: `@components` already points at a
	 * path this tree does not have, and an alias nothing imports is the config's
	 * business, not a failure here. An alias that IS imported is covered, by
	 * resolution, where it matters.
	 */
	return Object.fromEntries(pairs);
};

/** Every config file that can carry an import. */
const configFiles = () =>
	readdirSync(join(ROOT, CONFIG_DIR))
		.filter((name) => CONFIG_FILE.test(name))
		.sort();

/** `from "x"`, `import("x")` and the side-effect `import "x"` shapes. */
const specifiersIn = (source) => {
	const found = [
		...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
		...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
		...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
	].map(([, specifier]) => specifier);
	return [...new Set(found)];
};

/** Relative or alias-prefixed: the specifiers this lane judges. */
const isPathSpecifier = (specifier, aliases) =>
	specifier.startsWith("./") ||
	specifier.startsWith("../") ||
	Object.keys(aliases).some(
		(key) => specifier === key || specifier.startsWith(`${key}/`),
	);

/**
 * Resolve ONE specifier from the config directory, with the bundler that serves
 * the stories.
 *
 * Everything that is not the specifier under test is external: the question is
 * whether this path resolves, not what its graph costs to build.
 */
const resolves = async (specifier, aliases) => {
	try {
		await build({
			stdin: {
				contents: `import ${JSON.stringify(specifier)};`,
				resolveDir: join(ROOT, CONFIG_DIR),
				sourcefile: SWEEP_ENTRY,
				loader: "ts",
			},
			bundle: true,
			write: false,
			format: "esm",
			alias: aliases,
			loader: { ".css": "empty" },
			logLevel: "silent",
			plugins: [
				{
					name: "externalize-the-rest",
					setup(builder) {
						/* The specifier under test is left to the resolver (which applies
						 * the alias map above); everything else in its graph is external,
						 * because the question is whether this path resolves at all. */
						builder.onResolve({ filter: /^[^./]/ }, (args) =>
							args.path === specifier
								? undefined
								: { path: args.path, external: true },
						);
					},
				},
			],
		});
		return null;
	} catch (error) {
		return (error.errors?.[0]?.text ?? error.message).split("\n")[0];
	}
};

test("every path specifier in `.storybook/` resolves through the config's aliases", async () => {
	const aliases = storybookAliases();
	const files = configFiles();
	const swept = [];
	const failures = [];
	for (const file of files) {
		const source = readFileSync(join(ROOT, CONFIG_DIR, file), "utf8");
		for (const specifier of specifiersIn(source)) {
			if (!isPathSpecifier(specifier, aliases)) continue;
			swept.push(`${file} -> ${specifier}`);
			const error = await resolves(specifier, aliases);
			if (error !== null) failures.push(`${file}: ${specifier} - ${error}`);
		}
	}
	/*
	 * A sweep that found nothing is a broken scan, not a clean tree: the preview
	 * alone imports a dozen path specifiers, and the aliases it names are the ones
	 * the dead gallery used.
	 */
	assert.ok(
		swept.length >= 8,
		`the sweep resolved ${swept.length} path specifier(s); the scan is looking in the wrong shape of file`,
	);
	assert.deepEqual(
		failures,
		[],
		`unresolvable specifier(s) in ${CONFIG_DIR}/ - Storybook will not mount and every story becomes unreachable; fix the specifier or the alias it relies on:\n${failures.join("\n")}`,
	);
});

test("the sweep reports an unresolvable alias path instead of passing it", async () => {
	const aliases = storybookAliases();
	/* A path under a REAL alias, to a module that does not exist: the same shape
	 * of defect `@shared/window-glass` had at `2767241bae`. */
	const [key] = Object.keys(aliases);
	const error = await resolves(`${key}/__import_sweep_probe__`, aliases);
	assert.notEqual(
		error,
		null,
		`${key}/__import_sweep_probe__ resolved, so this sweep cannot tell a missing module from a present one and proves nothing`,
	);
	assert.match(
		error,
		MISSING_MODULE,
		`the failure does not name the missing specifier: ${error}`,
	);
});
