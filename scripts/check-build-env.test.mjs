#!/usr/bin/env node
/**
 * The contract's pass and fail cases, on fixtures built in a temp directory.
 *
 * WHY FIXTURES AND NOT THE SHIPPED WORKFLOWS ALONE. The repository's own
 * workflows happen to be compliant, so a suite that only ran over them would be
 * green whether or not the check could see a missing variable at all - and the
 * defect this closes was exactly a compliant-looking step in a workflow nobody
 * read. Every fixture therefore carries the case it names: a missing variable, a
 * job-level one, a comment that mentions a builder, a script reached through
 * `pnpm`. The shipped tree is checked too, because "green on the real files" is
 * the property the gate is trusted for.
 *
 * WHY THE DERIVED LIST IS ASSERTED AGAINST A FIXTURE PLUGIN. The binding between
 * `replace-backend-config.ts` and this check is the part that can rot silently:
 * a fifth guard added to the plugin is a fifth variable every build step would
 * need, and a check holding its own copy of four names would stay green while it
 * went unset. The fixture plugin proves the list is READ, not remembered.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	buildInvocation,
	checkWorkflows,
	commandSegments,
	defaultVitePlugins,
	formatReport,
	requiredBuildEnv,
} from "./check-build-env.mjs";

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway tree: `workflows` written as `.github/workflows/<name>` inside it,
 * plus a package.json for the `pnpm <script>` hop and an empty `node_modules/.bin`
 * so the second place `pnpm <word>` resolves is the fixture's own, never the
 * operator's installed dependencies. `plugins` (module name -> source) and
 * `config` build the other end of the binding: the config that decides which
 * plugins the build loads.
 */
function tree({
	workflows = {},
	scripts = {},
	plugin = null,
	plugins = null,
	config = null,
	bins = [],
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "check-build-env-"));
	scratch.push(root);
	const workflowsDir = join(root, ".github", "workflows");
	mkdirSync(workflowsDir, { recursive: true });
	for (const [name, body] of Object.entries(workflows)) {
		writeFileSync(join(workflowsDir, name), body);
	}
	const packageJson = join(root, "package.json");
	writeFileSync(packageJson, JSON.stringify({ scripts }, null, "\t"));
	const binDir = join(root, "node_modules", ".bin");
	mkdirSync(binDir, { recursive: true });
	for (const name of bins) writeFileSync(join(binDir, name), "#!/bin/sh\n");
	let pluginPath = null;
	if (plugin !== null) {
		pluginPath = join(root, "replace-backend-config.ts");
		writeFileSync(pluginPath, plugin);
	}
	let pluginDir = null;
	let configPath = null;
	if (plugins !== null) {
		pluginDir = join(root, "scripts", "vite-plugins");
		mkdirSync(pluginDir, { recursive: true });
		for (const [name, body] of Object.entries(plugins)) {
			writeFileSync(join(pluginDir, `${name}.ts`), body);
		}
	}
	if (config !== null) {
		configPath = join(root, "electron.vite.config.js");
		writeFileSync(configPath, config);
	}
	return {
		root,
		workflowsDir,
		packageJson,
		pluginPath,
		pluginDir,
		configPath,
		binDir,
	};
}

/**
 * A build config that imports the named plugins and passes each one to a
 * `plugins:` list, which is what "the build loads it" means here. `used: false`
 * writes an import nothing references, the shape a removal leaves behind.
 */
const configSource = (names, { used = true } = {}) => {
	const imports = names
		.map(
			(name, index) =>
				`import { plugin${index} } from "./scripts/vite-plugins/${name}";`,
		)
		.join("\n");
	const wired = used
		? `\nexport default { main: { plugins: [${names.map((_, i) => `plugin${i}()`).join(", ")}] } };\n`
		: "\nexport default { main: { plugins: [] } };\n";
	return `${imports}\n${wired}`;
};

/** The four guards as the shipped plugin writes them. */
const pluginSource = (names) =>
	`export function plugin() {\n${names
		.map(
			(name) =>
				`\tif (!process.env.${name}) {\n\t\tthrow new Error("${name} is not set");\n\t}\n`,
		)
		.join("")}}\n`;

const FOUR = [
	"VITE_GOOGLE_CLIENT_ID",
	"VITE_GOOGLE_CLIENT_SECRET",
	"VITE_MICROSOFT_CLIENT_ID",
	"VITE_MICROSOFT_TENANT_ID",
];

/** A step that sets exactly the variables it is given, at step or job level. */
const workflowWith = (
	names,
	{ level = "step", command = "pnpm build", job = "build" } = {},
) => {
	const env = names
		.map((name) => `          ${name}: \${{ secrets.${name} }}`)
		.join("\n");
	const jobEnv = names
		.map((name) => `      ${name}: \${{ secrets.${name} }}`)
		.join("\n");
	return `name: Fixture
on: workflow_dispatch
jobs:
  ${job}:
    runs-on: ubuntu-latest
${level === "job" ? `    env:\n${jobEnv}\n` : ""}    steps:
      - name: Build the app
${level === "step" ? `        env:\n${env}\n` : ""}        run: |
          ${command}
`;
};

/** `checkWorkflows` for a fixture tree, with the fixture's own package.json and bin dir. */
function check({ workflowsDir, packageJson, binDir }, options = {}) {
	return checkWorkflows({
		workflowsDir,
		packageJsonPath: packageJson,
		binDir,
		...options,
	});
}

/**
 * The verdict for one fixture tree, as a caller of the CLI would read it.
 *
 * `packageJsonPath` and `binDir` both point INTO the fixture: the hop walk and
 * the script-or-binary resolution have to read the tree under test rather than
 * the operator's checkout, or a fixture's `scripts` map would be decorative.
 */
function verdict(fixture, options = {}) {
	return formatReport(check(fixture, options));
}

test("the required variables are derived from the plugin's own guards, and are the four", () => {
	const { pluginPath } = tree({
		plugin: pluginSource(FOUR),
	});
	assert.deepEqual(requiredBuildEnv(pluginPath), FOUR);
	// And the SHIPPED plugin, which is the binding the gate depends on: if the four
	// names ever stop being what it guards on, this fails rather than the check
	// quietly guarding nothing.
	assert.deepEqual(requiredBuildEnv(), FOUR);
});

test("a fifth guard added to the plugin is picked up rather than missed", () => {
	const five = [...FOUR, "VITE_NEW_CLIENT_ID"];
	const { pluginPath } = tree({ plugin: pluginSource(five) });
	const required = requiredBuildEnv(pluginPath);
	assert.deepEqual(
		required,
		five,
		"the derived list has to grow with the plugin",
	);

	// The same compliance check, against the fixture's five: the tree sets the four
	// it always set and is now RED, naming the fifth. This is what a hard-coded
	// list of four could not do.
	const fixture = tree({
		workflows: { "build.yml": workflowWith(FOUR) },
		plugin: pluginSource(five),
	});
	const report = verdict(fixture, { required });
	assert.equal(report.ok, false);
	assert.match(report.lines.join("\n"), /VITE_NEW_CLIENT_ID/);
	assert.ok(
		!report.lines.join("\n").includes("VITE_GOOGLE_CLIENT_ID"),
		"only the missing variable is named, not the ones that are set",
	);
});

test("a plugin with no guard at all refuses rather than passing everything", () => {
	const { pluginPath } = tree({ plugin: "export function plugin() {}\n" });
	assert.throws(
		() => requiredBuildEnv(pluginPath),
		/cannot be derived from the plugin/,
	);
});

test("a compliant step passes, and the report names the step it cleared", () => {
	const fixture = tree({ workflows: { "build.yml": workflowWith(FOUR) } });
	const report = verdict(fixture);
	assert.equal(report.ok, true, report.lines.join("\n"));
	assert.equal(check(fixture).checked.length, 1);
	assert.match(report.lines[0], /1 build steps carry all 4 variables/);
	assert.match(
		report.lines[1],
		/build\.yml job "build" step "Build the app" -> pnpm build/,
	);
});

test("a build step missing one variable fails and names the workflow, the job, the step and that variable", () => {
	const fixture = tree({
		workflows: { "candidate.yml": workflowWith(FOUR.slice(0, 3)) },
	});
	const report = verdict(fixture);
	assert.equal(report.ok, false);
	const text = report.lines.join("\n");
	assert.match(text, /candidate\.yml, job "build", step "Build the app"/);
	assert.match(text, /without VITE_MICROSOFT_TENANT_ID/);
	assert.match(text, /is not set/);
	assert.deepEqual(
		check(fixture).failures.map((failure) => failure.missing),
		[["VITE_MICROSOFT_TENANT_ID"]],
	);
});

test("a variable set at JOB level counts, because both are places it is really set", () => {
	const fixture = tree({
		workflows: { "build.yml": workflowWith(FOUR, { level: "job" }) },
	});
	const report = verdict(fixture);
	assert.equal(report.ok, true, report.lines.join("\n"));
	assert.equal(check(fixture).failures.length, 0);
});

test("a structural defect: one variable at job level and the rest on the step is still complete", () => {
	const fixture = tree({
		workflows: {
			"mixed.yml": `name: Fixture
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      VITE_GOOGLE_CLIENT_ID: \${{ secrets.GOOGLE_CLIENT_ID }}
    steps:
      - name: Build the app
        env:
          VITE_GOOGLE_CLIENT_SECRET: \${{ secrets.GOOGLE_CLIENT_SECRET }}
          VITE_MICROSOFT_CLIENT_ID: \${{ secrets.MICROSOFT_CLIENT_ID }}
          VITE_MICROSOFT_TENANT_ID: \${{ secrets.MICROSOFT_TENANT_ID }}
        run: pnpm build
`,
		},
	});
	assert.equal(verdict(fixture).ok, true);
});

test("a mention of a builder that is not a command does not false-positive", () => {
	// The shape that matters: publish.yml discusses electron-builder in six
	// comments inside run blocks it does not build in, and a check that read those
	// as builds would be red on a compliant tree - which is how a gate gets
	// deleted instead of fixed.
	const fixture = tree({
		// The two names this fixture runs have to RESOLVE, because a `pnpm <word>` that
		// resolves to neither a script nor an installed binary is now a reported
		// failure (MINOR-2): the point of this fixture is the classification, not the
		// resolution, so the scripts are the real ones.
		scripts: {
			lint: "biome check",
			"notarize-dmg": "node scripts/notarize-artifacts.mjs",
		},
		workflows: {
			"noisy.yml": `name: Fixture
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Build the app
        env:
          VITE_GOOGLE_CLIENT_ID: \${{ secrets.GOOGLE_CLIENT_ID }}
          VITE_GOOGLE_CLIENT_SECRET: \${{ secrets.GOOGLE_CLIENT_SECRET }}
          VITE_MICROSOFT_CLIENT_ID: \${{ secrets.MICROSOFT_CLIENT_ID }}
          VITE_MICROSOFT_TENANT_ID: \${{ secrets.MICROSOFT_TENANT_ID }}
        run: |
          # electron-builder writes a .blockmap beside every archive; this step
          # does not build one.
          pnpm exec electron-vite build
          echo "the electron-builder config is not used here"
          bash scripts/require-report.sh "Notarization" pnpm --silent notarize-dmg
      - name: Not a run step
        uses: actions/setup-node@v4
        with:
          node-version: '22.13.1'
  other:
    runs-on: ubuntu-latest
    steps:
      - name: Extra work
        run: pnpm lint
`,
		},
	});
	const result = check(fixture);
	assert.deepEqual(result.failures, []);
	// `pnpm exec electron-vite build` is NOT `electron-builder`, and the comment and
	// the echoed string are not commands: exactly nothing here builds the app.
	assert.deepEqual(result.checked, []);
});

test("every command form that builds or packs is classified, and nothing else is", () => {
	const scripts = {
		"dist:mac": "pnpm run build && electron-builder --mac --publish never",
		"dist:app": "electron-builder -mwl --publish never",
		build: "electron-vite build",
		lint: "biome check",
		"notarize-dmg": "node scripts/notarize-artifacts.mjs",
	};
	const context = { scriptBody: (name) => scripts[name] ?? null };
	const classify = (line) =>
		commandSegments(line)
			.map((segment) => buildInvocation(segment, context))
			.find((hit) => hit !== null) ?? null;

	assert.equal(classify("pnpm build"), "pnpm build");
	assert.equal(classify("pnpm run build"), "pnpm run build");
	assert.equal(
		classify("pnpm exec electron-builder --mac"),
		"pnpm exec electron-builder",
	);
	assert.equal(
		classify("pnpm dlx electron-builder"),
		"pnpm dlx electron-builder",
	);
	assert.equal(classify("npx electron-builder --dir"), "electron-builder");
	assert.equal(classify("electron-builder -mwl"), "electron-builder");
	assert.equal(
		classify('npm publish "${TARBALL}" --provenance'),
		"npm publish",
	);
	assert.equal(classify("npm pack"), "npm pack");
	assert.equal(
		classify("pnpm dist:mac -c.forceCodeSigning=true"),
		"pnpm dist:mac -> pnpm run build",
	);
	// The same hop where the body reaches electron-builder directly, so the label names
	// the builder rather than the vite CLI the `build` script wraps.
	assert.equal(classify("pnpm dist:app"), "pnpm dist:app -> electron-builder");
	assert.equal(
		classify('bash scripts/require-report.sh "Packaged closure" pnpm dist:mac'),
		"pnpm dist:mac -> pnpm run build",
	);
	// A build behind a lifecycle flag order pnpm supports, and one that is not a build.
	assert.equal(classify("pnpm -C packages/app build"), "pnpm build");
	assert.equal(classify("pnpm --silent notarize-dmg"), null);
	assert.equal(classify("pnpm install --frozen-lockfile"), null);
	assert.equal(classify("pnpm audit --json"), null);
	assert.equal(classify("npm view pkg version"), null);
	assert.equal(classify("pnpm lint"), null);
	assert.equal(
		classify("node scripts/check-packaged-closure.mjs --dist dist"),
		null,
	);
	assert.equal(classify("# electron-builder's own keychain"), null);
	assert.equal(
		classify("echo 'the electron-builder config is not used here'"),
		null,
		"a quoted mention is not a command",
	);
});

test("a workflow that builds nowhere fails rather than passing vacuously", () => {
	const fixture = tree({
		workflows: {
			"empty.yml": "name: Fixture\non: workflow_dispatch\njobs: {}\n",
		},
	});
	const report = verdict(fixture);
	assert.equal(report.ok, false);
	assert.match(report.lines[0], /no build or pack step found/);
});

test("the repository's own workflows are compliant, and the scan really finds their build steps", () => {
	// The shipped tree, through the same code path the CLI uses. `checked` is
	// asserted to be more than the one step this branch fixed: a scan that had
	// stopped seeing build steps would otherwise read as compliance.
	const result = checkWorkflows();
	assert.deepEqual(result.failures, []);
	assert.deepEqual(result.bindingFailures, []);
	assert.deepEqual(
		result.unresolved,
		[],
		"every invocation in the repository's own workflows resolves to a script or a binary",
	);
	assert.ok(
		result.checked.length >= 5,
		`only ${result.checked.length} build steps found in the repository's own workflows`,
	);
	const candidate = result.checked.filter(
		(entry) => entry.file === "signed-update-candidate.yml",
	);
	assert.deepEqual(
		candidate.map((entry) => entry.step),
		["Build signed candidate without publishing or version changes"],
		"the workflow this check was added for has exactly one build step, and it is the one named",
	);
	// And the canonical mapping the binding check is built on is the repository's
	// own: the four variables are fed by the secrets named after them. A fixture
	// would prove the rule; this proves which names the rule is applied to.
	assert.deepEqual(result.canonical, {
		VITE_GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
		VITE_GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
		VITE_MICROSOFT_CLIENT_ID: "MICROSOFT_CLIENT_ID",
		VITE_MICROSOFT_TENANT_ID: "MICROSOFT_TENANT_ID",
	});
});

/*
 * MINOR-3 of the review round, closed rather than stated: the names come from
 * every plugin the config wires, so a second guard-bearing plugin is under the
 * gate rather than beside it. The refusals are fixtures too, because "the
 * derivation found nothing" is the state that would make this gate green for
 * every tree at once.
 */
test("the required list is derived from every plugin the build config loads, not one", () => {
	const second = "VITE_SECOND_CLIENT_ID";
	const { configPath, pluginDir } = tree({
		plugins: {
			"replace-backend-config": pluginSource(FOUR),
			"second-guard": pluginSource([second]),
		},
		config: configSource(["replace-backend-config", "second-guard"]),
	});
	const required = requiredBuildEnv(defaultVitePlugins(configPath, pluginDir));
	assert.deepEqual(
		required,
		[...FOUR, second],
		"a second wired plugin that refuses to build without its own variable is required by the build",
	);

	// And the tree that sets only the four is RED, naming the fifth - which is what
	// reading `replace-backend-config.ts` alone could not do.
	const fixture = tree({
		workflows: { "build.yml": workflowWith(FOUR) },
	});
	const report = verdict(fixture, { required });
	assert.equal(report.ok, false);
	assert.match(report.lines.join("\n"), /VITE_SECOND_CLIENT_ID/);
});

test("an import the config does not load, or no plugin at all, refuses rather than requiring nothing", () => {
	const unused = tree({
		plugins: { "replace-backend-config": pluginSource(FOUR) },
		config: configSource(["replace-backend-config"], { used: false }),
	});
	assert.throws(
		() => defaultVitePlugins(unused.configPath, unused.pluginDir),
		/cannot be derived/,
		"an import left behind by a removal is not a plugin the build loads",
	);

	const none = tree({
		config: "export default { main: { plugins: [] } };\n",
	});
	assert.throws(
		() => defaultVitePlugins(none.configPath, none.pluginDir),
		/cannot be derived/,
		"a config this cannot read refuses rather than clearing every workflow",
	);
});

/*
 * MINOR-1 of the review round: a `secrets.*` name that is a typo, or a swap, used
 * to be green. The fixture carries TWO compliant steps and one wrong one, which
 * is what makes the tree's own consensus the yardstick rather than a guess.
 */

/** The four bindings `publish.yml` writes, with any of them overridden. */
const bindings = (overrides = {}) =>
	FOUR.map((name) => [
		name,
		// The repository's secret names carry the variable name without its `VITE_`
		// prefix, which is the mapping the check derives and the fixture has to copy.
		overrides[name] ?? `\${{ secrets.${name.replace(/^VITE_/, "")} }}`,
	]);

/**
 * A workflow whose build step carries exactly these `NAME: value` bindings, at
 * the step, job or workflow level. The value is written verbatim, so a fixture
 * can bind the right variable to the wrong secret.
 */
const boundWorkflow = (
	pairs,
	{ level = "step", command = "pnpm build", job = "build" } = {},
) => {
	const entryIndent = { step: 10, job: 6, workflow: 2 }[level];
	const env = `${" ".repeat(entryIndent - 2)}env:\n${pairs
		.map(([name, value]) => `${" ".repeat(entryIndent)}${name}: ${value}`)
		.join("\n")}\n`;
	return `name: Fixture
on: workflow_dispatch
${level === "workflow" ? env : ""}jobs:
  ${job}:
    runs-on: ubuntu-latest
${level === "job" ? env : ""}    steps:
      - name: Build the app
${level === "step" ? env : ""}        run: |
          ${command}
`;
};

/** Two compliant workflows and one whose build step carries `wrong`. */
const bindingFixture = (wrong) =>
	tree({
		workflows: {
			"a.yml": boundWorkflow(bindings()),
			"b.yml": boundWorkflow(bindings()),
			"candidate.yml": boundWorkflow(bindings(wrong)),
		},
	});

test("a mistyped secrets.* name fails, naming the variable and both spellings", () => {
	const fixture = bindingFixture({
		VITE_GOOGLE_CLIENT_ID: "${{ secrets.GOOGLE_CLIENTID }}",
	});
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	const text = report.lines.join("\n");
	assert.match(text, /candidate\.yml, job "build", step "Build the app"/);
	assert.match(
		text,
		/binds VITE_GOOGLE_CLIENT_ID to `secrets\.GOOGLE_CLIENTID`/,
	);
	assert.match(text, /bind it to `secrets\.GOOGLE_CLIENT_ID`/);
	assert.match(text, /is not set/);
	assert.deepEqual(
		check(fixture).bindingFailures.map((failure) => [
			failure.file,
			failure.variable,
			failure.actual,
			failure.expected,
			failure.reason,
		]),
		[
			[
				"candidate.yml",
				"VITE_GOOGLE_CLIENT_ID",
				"GOOGLE_CLIENTID",
				"GOOGLE_CLIENT_ID",
				"wrong-secret",
			],
		],
	);
});

test("a swapped secrets.* binding fails, naming the variable and both names", () => {
	const fixture = bindingFixture({
		VITE_GOOGLE_CLIENT_ID: "${{ secrets.GOOGLE_CLIENT_SECRET }}",
	});
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	const text = report.lines.join("\n");
	assert.match(
		text,
		/binds VITE_GOOGLE_CLIENT_ID to `secrets\.GOOGLE_CLIENT_SECRET`/,
	);
	assert.match(
		text,
		/where the repository's build steps bind it to `secrets\.GOOGLE_CLIENT_ID`/,
	);
	// The swap is the quiet half: it does not fail the build, it ships a bundle
	// wired to the wrong client, which is why the message has to say so.
	assert.match(text, /ships a bundle wired to the wrong client/);
});

test("a binding the tree disagrees about with no majority is reported as ambiguous, not guessed", () => {
	const fixture = tree({
		workflows: {
			"a.yml": boundWorkflow(bindings()),
			"b.yml": boundWorkflow(
				bindings({ VITE_GOOGLE_CLIENT_ID: "${{ secrets.GOOGLE_CLIENTID }}" }),
			),
		},
	});
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	assert.match(report.lines.join("\n"), /more than one way/);
});

test("an empty binding fails rather than counting as set", () => {
	const fixture = bindingFixture({ VITE_MICROSOFT_TENANT_ID: '""' });
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	assert.deepEqual(
		check(fixture).bindingFailures.map((failure) => [
			failure.variable,
			failure.reason,
		]),
		[["VITE_MICROSOFT_TENANT_ID", "empty"]],
	);
});

test("a variable set at WORKFLOW level counts, because that is the third place it is really set", () => {
	const fixture = tree({
		workflows: {
			"build.yml": boundWorkflow(bindings(), { level: "workflow" }),
		},
	});
	const report = verdict(fixture);
	assert.equal(report.ok, true, report.lines.join("\n"));
	assert.equal(check(fixture).failures.length, 0);
});

/*
 * MINOR-2 of the review round: a `pnpm <word>` the hop walk cannot resolve used
 * to be dropped - neither checked nor reported - so a build authored that way
 * was green AND invisible. Both shapes are reported now, with the workflow, the
 * job, the step, the invocation and the reason.
 */
test("an invocation that is neither a script nor a binary is reported rather than dropped", () => {
	const fixture = tree({
		workflows: {
			"a.yml": boundWorkflow(bindings()),
			"candidate.yml": boundWorkflow(bindings(), {
				command: "pnpm nosuchscript",
			}),
		},
	});
	const result = check(fixture);
	assert.deepEqual(
		result.unresolved.map((record) => [
			record.file,
			record.job,
			record.step,
			record.invocation,
			record.reason,
		]),
		[
			[
				"candidate.yml",
				"build",
				"Build the app",
				"pnpm nosuchscript",
				"missing-script",
			],
		],
	);
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	assert.match(
		report.lines.join("\n"),
		/candidate\.yml, job "build", step "Build the app" runs `pnpm nosuchscript`/,
	);
	assert.match(report.lines.join("\n"), /ERR_PNPM_NO_SCRIPT/);
	// The compliant step is still cleared, so the message is about one defect and
	// not about a scan that broke.
	assert.equal(result.checked.length, 1);
});

test("a chain past MAX_SCRIPT_HOPS is reported rather than dropped", () => {
	const fixture = tree({
		workflows: {
			"a.yml": boundWorkflow(bindings()),
			"candidate.yml": boundWorkflow(bindings(), { command: "pnpm deep" }),
		},
		scripts: {
			deep: "pnpm ship",
			ship: "pnpm dist:mac",
			"dist:mac": "electron-builder --mac",
		},
	});
	const result = check(fixture);
	assert.deepEqual(
		result.unresolved.map((record) => [record.invocation, record.reason]),
		[["pnpm dist:mac", "hop-cap"]],
	);
	const report = verdict(fixture);
	assert.equal(report.ok, false, report.lines.join("\n"));
	assert.match(report.lines.join("\n"), /chain deep -> ship -> dist:mac/);
	assert.match(report.lines.join("\n"), /MAX_SCRIPT_HOPS \(2\)/);
});

test("a word that is an installed binary is resolved, not reported as a missing script", () => {
	const fixture = tree({
		workflows: {
			"a.yml": boundWorkflow(bindings()),
			"lint.yml": boundWorkflow(bindings(), { command: "pnpm lint" }),
		},
		// `pnpm biome check .` is the shipped lint script's own body, and `biome` is
		// not a package.json script: pnpm runs node_modules/.bin/biome for it.
		scripts: { lint: "pnpm biome check ." },
		bins: ["biome"],
	});
	const result = check(fixture);
	assert.deepEqual(result.unresolved, []);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(
		result.checked.map((entry) => entry.file),
		["a.yml"],
		"a step that only lints is not a build step, and it is not a failure either",
	);
});

test("a backslash line continuation classifies the command it joins", () => {
	const fixture = tree({
		workflows: {
			"continued.yml": `name: Fixture
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Build the app
        env:
          VITE_GOOGLE_CLIENT_ID: \${{ secrets.GOOGLE_CLIENT_ID }}
          VITE_GOOGLE_CLIENT_SECRET: \${{ secrets.GOOGLE_CLIENT_SECRET }}
          VITE_MICROSOFT_CLIENT_ID: \${{ secrets.MICROSOFT_CLIENT_ID }}
          VITE_MICROSOFT_TENANT_ID: \${{ secrets.MICROSOFT_TENANT_ID }}
        run: |
          pnpm \\
          build
`,
		},
	});
	const result = check(fixture);
	assert.deepEqual(
		result.checked.map((entry) => entry.command),
		["pnpm build"],
		"the two lines are one command, so the step is classified rather than invisible",
	);
	assert.deepEqual(result.unresolved, []);
});
