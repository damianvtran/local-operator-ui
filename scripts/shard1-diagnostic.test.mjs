import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	FILES,
	classify,
	cleanEnv,
	outputPath,
	signal,
	subjectClassification,
	supervise,
	traceEvents,
	validSha,
} from "./shard1-diagnostic.mjs";

/*
 * Small REAL child-process negative controls, not renderer/native evidence.
 * Registered in test:desktop as well as the dedicated diagnostic preflight:
 * neither registration guard may silently omit these real contracts. This does
 * change the current sorted modulo4 partitions; historical neighbor positions
 * apply ONLY to the pinned subject SHAs, not to this revised tooling inventory.
 */
test("fixed cohort is exactly the reviewed predecessor trio in runner order", () => {
	assert.ok(Object.isFrozen(FILES));
	assert.deepEqual(FILES, [
		"scripts/check-runtime-deps.test.mjs",
		"scripts/child-reader-foot-react.test.mjs",
		"scripts/ci-scope.test.mjs",
	]);
});

const PASS_ONE_RE = /^# pass 1$/m;
// Ordinary desktop callers need no agent-specific environment. Each fixture
// still issues its own private RUNNER_TEMP; production output-path guards do
// not change when the outer suite falls back to the standard test temp root.
const parent =
	process.env.RUNNER_TEMP ?? process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir();
// Darwin's standard temp root can be a /var -> /private/var alias. Canonicalize
// our own freshly-created directory, not the production containment guard.
const root = realpathSync(mkdtempSync(join(parent, "shard1-contract-")));
const self = fileURLToPath(new URL("./shard1-diagnostic.mjs", import.meta.url));

async function fixture(name, source, wallMs, { denyGroups = false } = {}) {
	const path = join(root, `${name}.test.mjs`);
	writeFileSync(path, source);
	const out = join(root, name);
	const env = cleanEnv(out);
	env.RUNNER_TEMP = root;
	env.LOCAL_OPERATOR_UI_SHARD1_TRACE = join(out, "trace");
	env.LOCAL_OPERATOR_UI_SHARD1_ENTRIES = JSON.stringify([path]);
	env.NODE_OPTIONS = `--max-old-space-size=96 --import=${self}`;
	const result = await supervise({
		command: [process.execPath, "--test", "--test-reporter=tap", path],
		cwd: root,
		out,
		env,
		wallMs,
		memoryMb: 512,
		sendSignal: denyGroups
			? (pid, sig) =>
					signal(pid, sig, (target, action) => {
						if (target < 0) {
							const error = new Error(
								"synthetic owned-group permission denied",
							);
							error.code = "EPERM";
							throw error;
						}
						return process.kill(target, action);
					})
			: signal,
	});
	const events = traceEvents(join(out, "trace")).filter(
		(event) => event.worker,
	);
	assert.equal(
		result.samplingFailed,
		false,
		"process accounting must remain observable",
	);
	assert.equal(
		result.cleanupVerified,
		!denyGroups,
		"permission uncertainty is never reported as verified cleanup",
	);
	assert.deepEqual(
		result.survivors,
		[],
		"all owned process identities must be gone",
	);
	assert.ok(
		events.some((e) => e.event === "FILE_LOAD"),
		"actual physical worker entry was instrumented",
	);
	return { result, events, text: readFileSync(join(out, "tap.log"), "utf8") };
}

test("SHA/path validation rejects shell payloads and evidence symlink escapes", () => {
	assert.equal(validSha("a".repeat(40)), "a".repeat(40));
	for (const bad of [
		"main",
		"$(echo bad)",
		`${"a".repeat(40)};exit 0`,
		"A".repeat(40),
		"",
	])
		assert.throws(() => validSha(bad));
	assert.throws(() => outputPath("relative", root));
	assert.throws(() => outputPath(join(root, "..", "escape"), root));
	symlinkSync(parent, join(root, "escape"), "dir");
	assert.throws(() => outputPath(join(root, "escape", "outside"), root));
});

test("natural worker completes assertions and drains without force-exit", async () => {
	const { result, events, text } = await fixture(
		"natural",
		"import { test } from 'node:test'; test('body', () => {});",
		1500,
	);
	assert.equal(result.code, 0);
	assert.equal(result.timeout, false);
	assert.equal(classify(result, events), "completed");
	assert.ok(events.some((e) => e.event === "TESTS_START"));
	assert.ok(events.some((e) => e.event === "TESTS_COMPLETE"));
	assert.ok(events.some((e) => e.event === "BEFORE_EXIT"));
	assert.match(text, PASS_ONE_RE);
});

test("completed test with retained resource is held-after-tests, not a body stall", async () => {
	const { result, events } = await fixture(
		"held",
		"import { test } from 'node:test'; setInterval(() => {}, 100); test('body', () => {});",
		900,
	);
	assert.equal(
		result.timeout,
		true,
		"the injected leak must really hit the bound",
	);
	assert.equal(classify(result, events), "held-after-tests");
	assert.ok(events.some((e) => e.event === "TESTS_COMPLETE"));
	assert.ok(
		events.some(
			(e) => e.event === "RESOURCES" && e.resources.includes("Timeout"),
		),
	);
	assert.equal(
		events.some((e) => e.event === "BEFORE_EXIT"),
		false,
	);
});

test("pending render/body never completes and is not misreported as a resource-only hold", async () => {
	const { result, events } = await fixture(
		"stalled",
		"import { test } from 'node:test'; setInterval(() => {}, 100); test('body', async () => { globalThis.__loShard1Trace('BEFORE_RENDER'); await new Promise(() => {}); });",
		900,
	);
	assert.equal(result.timeout, true);
	assert.equal(classify(result, events), "incomplete-body-or-import");
	assert.ok(events.some((e) => e.event === "BEFORE_RENDER"));
	assert.equal(
		events.some((e) => e.event === "TESTS_COMPLETE"),
		false,
	);
});

test("a stalled SUBJECT root after-hook is incomplete teardown, never held-after-tests", async () => {
	const { result, events } = await fixture(
		"stalled-after",
		"import { test, after } from 'node:test'; test('body', () => {}); after(async () => { globalThis.__loShard1Trace('SUBJECT_AFTER_START'); setInterval(() => {}, 100); await new Promise(() => {}); });",
		900,
	);
	assert.equal(result.timeout, true);
	assert.ok(events.some((e) => e.event === "SUBJECT_AFTER_START"));
	assert.ok(events.some((e) => e.event === "SUBJECT_TEARDOWN_PENDING"));
	assert.equal(
		events.some((e) => e.event === "TESTS_COMPLETE"),
		false,
	);
	assert.equal(classify(result, events), "incomplete-subject-teardown");
});

test("owned-group EPERM retains subject phase, records uncertainty, and still reaps exact individual children", async () => {
	const { result, events } = await fixture(
		"permission",
		"import { test } from 'node:test'; setInterval(() => {}, 100); test('body', () => {});",
		900,
		{ denyGroups: true },
	);
	assert.equal(result.timeout, true);
	assert.ok(result.cleanupErrors.some((e) => e.code === "EPERM" && e.pid < 0));
	assert.equal(result.cleanupVerified, false);
	assert.equal(classify(result, events), "instrumentation-or-cleanup-failure");
	assert.equal(subjectClassification(result, events), "held-after-tests");
});

test("classification fails closed on accounting, interruption, memory and missing lifecycle", () => {
	const ok = { code: 0, survivors: [] };
	assert.equal(
		classify({ ...ok, samplingFailed: true }, []),
		"instrumentation-or-cleanup-failure",
	);
	assert.equal(
		classify({ ...ok, survivors: [123] }, []),
		"instrumentation-or-cleanup-failure",
	);
	assert.equal(
		classify({ ...ok, interrupted: true }, []),
		"instrumentation-or-cleanup-failure",
	);
	assert.equal(classify({ ...ok, memory: true }, []), "memory-bound");
	assert.equal(classify({ ...ok, code: 1 }, []), "assertion-or-launch-failure");
	assert.equal(classify(ok, []), "missing-lifecycle");
	assert.equal(
		classify({ ...ok, timeout: true }, [
			{ event: "TESTS_COMPLETE" },
			{ event: "EXIT", code: 0 },
		]),
		"completed-before-cutoff",
		"do not blame an exited neighbour for a different worker's hold",
	);
});
