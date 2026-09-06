#!/usr/bin/env node
/**
 * Test the actual YAML graph, inline shell gates and pnpm argument forwarding.
 * Packaging/signing are not executed here. Existing builder dependencies supply
 * the YAML and CLI parsers; no second parser or dependency install is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");
const builder = require("electron-builder/out/builder");
const workflow = load(readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const jobs = workflow.jobs;
const steps = (job) => jobs[job].steps;
const step = (job, name) => steps(job).find((s) => s.name === name);
const needsOf = (job) => [].concat(jobs[job].needs || []);
function condition(expression, context) {
  if (!expression) return true;
  const code = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result');
  // Expressions come only from the checked-in workflow, not user input. Status
  // functions are deliberately unsupported: they can bypass GitHub's skip gate.
  return Boolean(Function(...Object.keys(context), `return (${code})`)(...Object.values(context)));
}
function graph(event, prerelease = false, forced = {}) {
  const result = {};
  for (const job of Object.keys(jobs)) {
    const needs = Object.fromEntries(needsOf(job).map((n) => [n, { result: result[n] }]));
    const success = Object.values(needs).every((n) => n.result === "success");
    const eligible = success && condition(jobs[job].if, { needs, github: { event_name: event, event: { release: { prerelease } } } });
    result[job] = eligible ? forced[job] || "success" : "skipped";
  }
  return result;
}
function sandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), "publish-contract-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH || "" };
function shell(script, env, cwd) {
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], { encoding: "utf8", cwd, env: { ...cleanEnv, ...env } });
}

for (const [event, prerelease] of [["workflow_dispatch", false], ["release", false], ["release", true]]) {
  test(`${event} prerelease=${prerelease}: every required job reaches upload`, () => {
    const result = graph(event, prerelease);
    assert.ok(Object.values(result).every((r) => r === "success"), JSON.stringify(result));
    console.log(`REACHABLE ${event} prerelease=${prerelease}: ${Object.keys(result).join(" -> ")}`);
  });
  for (const failed of ["validate-release", "preflight-macos", "npm-publish", "build-macos", "build-windows", "build-linux"]) {
    for (const status of ["failure", "cancelled", "skipped"]) {
      test(`${event} prerelease=${prerelease}: ${failed} ${status} blocks upload`, () => {
        assert.equal(graph(event, prerelease, { [failed]: status })["attach-to-release"], "skipped");
      });
    }
  }
}
test("upload requires all platform jobs; no status-function bypass", () => {
  assert.deepEqual(needsOf("attach-to-release").sort(), ["build-linux", "build-macos", "build-windows", "validate-release"]);
  for (const job of Object.values(jobs)) assert.doesNotMatch(job.if || "", /always\(|failure\(|cancelled\(/);
});
test("payload checkouts use validated source, helper checkouts use workflow SHA", () => {
  for (const job of ["npm-publish", "build-macos", "build-windows", "build-linux"]) {
    assert.equal(step(job, "Checkout code").with.ref, "${{ needs.validate-release.outputs.source_sha }}");
  }
  for (const job of ["validate-release", "attach-to-release"]) {
    assert.equal(step(job, "Checkout workflow scripts").with.ref, "${{ github.workflow_sha }}");
  }
  const upload = step("attach-to-release", "Revalidate and attach artifacts to existing release");
  assert.equal(upload.run, "node workflow/scripts/upload-release.mjs");
  assert.equal(upload.env.EXPECTED_SOURCE_SHA, "${{ needs.validate-release.outputs.source_sha }}");
  assert.equal(upload.env.EXPECTED_RELEASE_ID, "${{ needs.validate-release.outputs.release_id }}");
  assert.match(step("attach-to-release", "Checkout workflow scripts").with["sparse-checkout"], /scripts\/upload-release.mjs/);
  assert.equal(step("attach-to-release", "Checkout workflow scripts").with.path, "workflow");
});
for (const event of ["release", "workflow_dispatch"]) {
  for (const published of ["true", "false"]) {
    test(`npm publish guard event=${event}, published=${published}`, () => {
      assert.equal(condition(step("npm-publish", "Publish to npm").if, { github: { event_name: event }, steps: { check_version: { outputs: { published } } } }), event === "release" && published === "false");
    });
  }
}
for (const [label, output, exitCode] of [["exists", "0.14.1", 0], ["absent", "", 1], ["registry unavailable", "", 42], ["wrong version", "0.14.0", 0]]) {
  for (const manual of [true, false]) {
    test(`npm registry ${label}, manual=${manual}: actual shell gate`, () => sandbox((dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "local-operator-ui", version: "0.14.1" }));
      writeFileSync(join(dir, "npm"), `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${exitCode}\n`, { mode: 0o755 });
      const result = shell(step("npm-publish", "Check if version already published").run, { PATH: `${dir}:${process.env.PATH}`, IS_MANUAL_DISPATCH: String(manual), GITHUB_OUTPUT: join(dir, "outputs") }, dir);
      assert.equal(result.status, manual && label !== "exists" ? 1 : 0, result.stderr);
      if (result.status === 0) assert.equal(readFileSync(join(dir, "outputs"), "utf8").trim(), `published=${label === "exists"}`);
    }));
  }
}
test("electron pins move together across the npm and installer channels", () => {
  // electron-builder never reads optionalDependencies, so without the explicit
  // build.electronVersion the installers silently take whatever is in
  // node_modules. Two declarations, one runtime: fail if they drift.
  assert.equal(pkg.build.electronVersion, pkg.optionalDependencies.electron);
  assert.match(pkg.optionalDependencies.electron, /^\d+\.\d+\.\d+$/, "the pin must be exact, not a range");
});

const preflight = step("preflight-macos", "Check required secrets");
const signingEnv = { NOTARIZE: workflow.env.NOTARIZE, ...Object.fromEntries(Object.keys(preflight.env).map((k) => [k, "fixture-secret-value-never-log"])) };
test("signing preflight accepts complete credentials", () => assert.equal(shell(preflight.run, signingEnv).status, 0));
for (const name of Object.keys(signingEnv)) {
  test(`signing preflight rejects missing ${name} without exposing values`, () => {
    const result = shell(preflight.run, { ...signingEnv, [name]: "" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(name));
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret-value/);
  });
}
test("NOTARIZE=false is rejected", () => assert.equal(shell(preflight.run, { ...signingEnv, NOTARIZE: "false" }).status, 1));
test("mac signing uses imported keychain without CSC_LINK, keeps notarization", () => {
  assert.equal(workflow.env.NOTARIZE, "true");
  const mac = step("build-macos", "Build macOS app");
  assert.ok(!("NOTARIZE" in mac.env));
  assert.ok(!("CSC_LINK" in mac.env));
  for (const key of ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"]) assert.equal(mac.env[key], preflight.env[key]);
  const setup = step("build-macos", "Setup code signing").run;
  assert.match(setup, /CSC_KEYCHAIN=\"\$RUNNER_TEMP\/build.keychain-db\"/);
  assert.match(setup, /echo "CSC_KEYCHAIN=\$CSC_KEYCHAIN" >> "\$GITHUB_ENV"/);
  assert.match(setup, /set-key-partition-list .* -k "\$KEYCHAIN_PASSWORD" "\$CSC_KEYCHAIN"/);
  for (const job of ["build-windows", "build-linux"]) assert.ok(!JSON.stringify(jobs[job]).includes("forceCodeSigning"));
});
test("keychain password is generated per job, masked, and never a repository dependency", () => {
  assert.ok(!("KEYCHAIN_PASSWORD" in preflight.env));
  assert.doesNotMatch(preflight.run, /KEYCHAIN_PASSWORD/);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.KEYCHAIN_PASSWORD/);
  assert.deepEqual(Object.keys(preflight.env).sort(), ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID", "CSC_CONTENT", "CSC_KEY_PASSWORD"]);
  const setup = step("build-macos", "Setup code signing");
  assert.ok(!("KEYCHAIN_PASSWORD" in setup.env));
  assert.match(setup.run, /KEYCHAIN_PASSWORD="\$\(openssl rand -hex 32\)"/);
});
test("actual signing setup masks one random password and passes it consistently", () => {
  const digests = [0, 1].map(() => sandbox((dir) => {
    // Only security is stubbed: execute the checked-in shell, real OpenSSL
    // generation, base64 decoding and cleanup. Persist hashes, never passwords.
    writeFileSync(join(dir, "security"), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
const command = args[0];
const flag = command === 'set-key-partition-list' ? '-k' : '-p';
const password = ['create-keychain', 'unlock-keychain', 'set-key-partition-list'].includes(command) ? args[args.indexOf(flag) + 1] : undefined;
appendFileSync(process.env.CALLS_FILE, JSON.stringify({ command, keychain: args.at(-1), flags: args.slice(1, -1).filter((a) => a.startsWith('-')), passwordShape: password ? /^[a-f0-9]{64}$/.test(password) : null, digest: password ? createHash('sha256').update(password).digest('hex') : null }) + '\\n');
console.log('SECURITY_CALLED');
`, { mode: 0o755 });
    const result = shell(step("build-macos", "Setup code signing").run, {
      PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir,
      GITHUB_ENV: join(dir, "env"), CALLS_FILE: join(dir, "calls"),
      CSC_CONTENT: Buffer.from("fixture-p12").toString("base64"), CSC_KEY_PASSWORD: "fixture-p12-password",
    }, dir);
    // Avoid including captured stdout in assertion errors: the Actions mask
    // command necessarily contains the value, but no test output may reveal it.
    assert.equal(result.status, 0, "signing setup shell must succeed");
    const lines = result.stdout.trim().split("\n");
    assert.ok(/^::add-mask::[a-f0-9]{64}$/.test(lines[0]), "mask must precede every security invocation");
    const password = lines[0].slice("::add-mask::".length);
    const digest = createHash("sha256").update(password).digest("hex");
    assert.ok(!result.stderr.includes(password));
    assert.deepEqual(lines.slice(1), Array(7).fill("SECURITY_CALLED"));
    const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((c) => c.command), ["create-keychain", "default-keychain", "unlock-keychain", "set-keychain-settings", "show-keychain-info", "import", "set-key-partition-list"]);
    // Regression for run 33948569170: a fresh keychain auto-locks after 300s and
    // codesign then hangs on a GUI prompt. The settings call must follow unlock,
    // precede import/partition-list, and carry no -t timeout or -l lock flag.
    const settings = calls.find((c) => c.command === "set-keychain-settings");
    assert.equal(settings.keychain, join(dir, "build.keychain-db"));
    assert.deepEqual(settings.flags, [], "set-keychain-settings must remove the timeout, not set one");
    assert.ok(!settings.passwordShape, "keychain settings do not take the password");
    const passwordCalls = calls.filter((c) => c.digest);
    assert.equal(passwordCalls.length, 3);
    assert.ok(passwordCalls.every((c) => c.passwordShape && c.digest === digest), "create/unlock/partition must share the generated 32-byte password");
    assert.ok(calls.filter((c) => c.command !== "import").every((c) => c.keychain === join(dir, "build.keychain-db")));
    assert.equal(calls.findIndex((c) => c.command === "set-keychain-settings") - calls.findIndex((c) => c.command === "unlock-keychain"), 1, "settings must be applied immediately after unlock");
    assert.equal(readFileSync(join(dir, "env"), "utf8"), `CSC_KEYCHAIN=${join(dir, "build.keychain-db")}\n`);
    assert.ok(!existsSync(join(dir, "certificate.p12")), "temporary certificate must be removed");
    return digest;
  }));
  assert.notEqual(digests[0], digests[1], "each job must generate a fresh password");
  console.log("SIGNING_SHELL: 2 fresh 32-byte passwords; mask before use; create/unlock/partition equal; set-keychain-settings after unlock with no timeout; only keychain path persisted");
});
test("failed random generation stops before keychain setup", () => sandbox((dir) => {
  writeFileSync(join(dir, "openssl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(dir, "security"), "#!/bin/sh\necho SECURITY_CALLED\n", { mode: 0o755 });
  const result = shell(step("build-macos", "Setup code signing").run, { PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_ENV: join(dir, "env") }, dir);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(!existsSync(join(dir, "env")));
}));
test("actual pnpm forwarding and electron-builder parser enforce signing", async () => {
  const captures = sandbox((dir) => {
  // Preserve the real dist script. Only its expensive build and packaging
  // executables are replaced at the process boundary to capture actual argv.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "node -e ''", "dist:mac": pkg.scripts["dist:mac"] } }));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "electron-builder"), '#!/usr/bin/env node\nconsole.log("BUILDER_ARGV="+JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  return [["pnpm dist:mac -- -c.forceCodeSigning=true", false], [step("build-macos", "Build macOS app").run, true]].map(([command, shouldForce]) => {
    const result = shell(command, { PATH: `${join(dir, "bin")}:${process.env.PATH}` }, dir);
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("BUILDER_ARGV=")).slice(13));
    const parsed = builder.configureBuildCommand(builder.createYargs()).parse(args);
    const options = builder.normalizeOptions(parsed);
    return { command, shouldForce, args, options };
  });
  });
  for (const { command, shouldForce, args, options } of captures) {
    // AJV performs boolean coercion after yargs and normalizeOptions.
    await appRequire("./util/config/config").validateConfiguration(options.config || {}, { add() {} });
    assert.equal(options.config?.forceCodeSigning === true, shouldForce, JSON.stringify({ args, options }));
    console.log(`ACTUAL ${command}: argv=${JSON.stringify(args)} forceCodeSigning=${options.config?.forceCodeSigning}`);
  }
});
