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
	formatReport,
	requiredBuildEnv,
} from "./check-build-env.mjs";

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway tree: `workflows` written as `.github/workflows/<name>` inside it,
 * plus a package.json for the `pnpm <script>` hop. The plugin lives under
 * `scripts/vite-plugins/` so a fixture can drive the derivation as well.
 */
function tree({ workflows = {}, scripts = {}, plugin = null } = {}) {
	const root = mkdtempSync(join(tmpdir(), "check-build-env-"));
	scratch.push(root);
	const workflowsDir = join(root, ".github", "workflows");
	mkdirSync(workflowsDir, { recursive: true });
	for (const [name, body] of Object.entries(workflows)) {
		writeFileSync(join(workflowsDir, name), body);
	}
	const packageJson = join(root, "package.json");
	writeFileSync(packageJson, JSON.stringify({ scripts }, null, "\t"));
	let pluginPath = null;
	if (plugin !== null) {
		pluginPath = join(root, "replace-backend-config.ts");
		writeFileSync(pluginPath, plugin);
	}
	return { root, workflowsDir, packageJson, pluginPath };
}

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

/** The verdict for one fixture tree, as a caller of the CLI would read it. */
function verdict({ workflowsDir, packageJson }, options = {}) {
	return formatReport(
		checkWorkflows({ workflowsDir, packageJson, ...options }),
	);
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
	assert.equal(checkWorkflows(fixture).checked.length, 1);
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
		checkWorkflows(fixture).failures.map((failure) => failure.missing),
		[["VITE_MICROSOFT_TENANT_ID"]],
	);
});

test("a variable set at JOB level counts, because both are places it is really set", () => {
	const fixture = tree({
		workflows: { "build.yml": workflowWith(FOUR, { level: "job" }) },
	});
	const report = verdict(fixture);
	assert.equal(report.ok, true, report.lines.join("\n"));
	assert.equal(checkWorkflows(fixture).failures.length, 0);
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
	const result = checkWorkflows(fixture);
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
});
