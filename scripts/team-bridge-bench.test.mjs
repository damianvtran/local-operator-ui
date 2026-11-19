import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The bench's own failure path, exercised without launching Electron.
 *
 * WHY THIS FILE EXISTS. Review round 1's second major was not a wrong number: it
 * was that the rig could measure NOTHING and still exit 0. Every scenario check was
 * advisory, and the only exit gate (`settledMs === null`) could never fire, so a
 * crashing branch printed `firstRow=null settled≈90000ms rows=0` and called itself a
 * pass. A failure path nobody runs is a failure path that does not work, so the
 * gate is driven here through the same CLI a person uses.
 *
 * NO ELECTRON, deliberately: `--self-test` builds the report a zero-row run
 * produces and sends it through `applyGate`, which is the same function the real
 * runs go through. The cheap cases pin the CLI's own refusals, which happen before
 * any launch.
 */

const BENCH = join(process.cwd(), "scripts", "team-bridge-bench.mjs");

/** Run the bench with a throwaway scratch root; never touches operator state. */
function bench(args) {
	const scratch = mkdtempSync(join(tmpdir(), "team-bridge-bench-test-"));
	try {
		const run = spawnSync(
			process.execPath,
			[BENCH, ...args, `--scratch=${scratch}`],
			{
				encoding: "utf8",
				env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024" },
			},
		);
		return {
			status: run.status,
			stdout: run.stdout ?? "",
			stderr: run.stderr ?? "",
		};
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

test("a zero-row report FAILS the run", () => {
	const run = bench(["--self-test=zero-rows"]);
	assert.equal(run.status, 1, `expected a non-zero exit, got ${run.status}`);
	assert.match(run.stderr, /RUN FAILED/);
	assert.match(run.stderr, /the timeline rendered at least one row/);
	assert.match(run.stderr, /NO SETTLE|no settled time/);
});

test("--allow-fail is the only way to exit 0 with a failed check", () => {
	const run = bench(["--self-test=zero-rows", "--allow-fail"]);
	assert.equal(
		run.status,
		0,
		`expected exit 0 with --allow-fail, got ${run.status}`,
	);
	assert.match(run.stderr, /--allow-fail: exiting 0 WITH the failures above/);
	// The failure is still NAMED - the flag licenses the exit code, not the silence.
	assert.match(run.stderr, /the timeline rendered at least one row/);
});

test("--messages refuses a value that cannot be a history length", () => {
	for (const value of ["0", "-5", "abc", "1.5"]) {
		const run = bench([`--messages=${value}`, "--self-test=zero-rows"]);
		assert.equal(run.status, 1, `--messages=${value} should be refused`);
		assert.match(
			run.stderr,
			/is not a positive integer between 1 and/,
			`--messages=${value} should name the bound it broke`,
		);
	}
});

test("an unknown self-test is refused rather than silently passing", () => {
	const run = bench(["--self-test=everything-is-fine"]);
	assert.equal(run.status, 1);
	assert.match(run.stderr, /unknown --self-test=everything-is-fine/);
});

/**
 * QA round 3 on ui#1889 (Q3-1): `waitForShell` polled `document.getElementById
 * ("root")`, a node this app never had - it mounts on the id `main.tsx` hands to
 * `createRoot`, declared in `index.html`. The probe read -1 for its whole budget and
 * no `instant-load` run could pass `mount`. These cases pin the bench to the app's
 * real mount node, read from the sources, and evaluate the EXACT page-side probe
 * string against a fake `document` shaped like the real `index.html`.
 */
const REPO = process.cwd();

/** A `document` holding every id the real index.html declares; the mount node has
 * `mountedChildren` children (what React renders), every other node none. */
function fakeDocumentFrom(html, mountIdToFill, mountedChildren) {
	const ids = new Set(
		[...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
	);
	return {
		getElementById: (id) =>
			ids.has(id)
				? { childElementCount: id === mountIdToFill ? mountedChildren : 0 }
				: null,
	};
}

/** Evaluate a page-side expression string against a fake `document`. */
function evaluateIn(document, expression) {
	return new Function("document", `return ${expression};`)(document);
}

test("the bench waits on the node the app actually mounts on (Q3-1)", async () => {
	const { appMountId, entryMountId, isMounted, mountProbe } = await import(
		"./team-bridge-mount.mjs"
	);
	const html = readFileSync(
		join(REPO, "src", "renderer", "index.html"),
		"utf8",
	);
	const entry = readFileSync(
		join(REPO, "src", "renderer", "src", "main.tsx"),
		"utf8",
	);
	const id = appMountId(REPO);
	// Parsed independently of the module: createRoot's argument, declared in the HTML.
	assert.equal(id, entryMountId(entry));
	assert.match(html, new RegExp(`<div id="${id}"`));

	// Mounted shell (React rendered children into the mount node): the probe passes.
	const mounted = evaluateIn(fakeDocumentFrom(html, id, 3), mountProbe(id));
	assert.equal(mounted, 3);
	assert.ok(isMounted(mounted));
	// The mount node exists but React has not rendered yet: not mounted.
	assert.ok(
		!isMounted(evaluateIn(fakeDocumentFrom(html, id, 0), mountProbe(id))),
	);
	// A document without the mount node (the old `#root` guess on the real DOM): -1.
	const withoutMount = { getElementById: () => null };
	assert.equal(evaluateIn(withoutMount, mountProbe(id)), -1);
	assert.equal(
		evaluateIn(fakeDocumentFrom(html, id, 3), mountProbe("root")),
		-1,
	);

	// The bench itself must not carry its own hardcoded mount selector: every
	// `getElementById` it sends to the page goes through `mountProbe`.
	const bench = readFileSync(BENCH, "utf8");
	assert.deepEqual(
		[...bench.matchAll(/getElementById\(\s*["'`][^"'`]*["'`]/g)].map(
			(m) => m[0],
		),
		[],
		"the bench hardcodes a mount selector instead of using mountProbe(appMountId())",
	);
	assert.match(bench, /mount: \$\{mountProbe\(id\)\}/);
});

test("appMountId refuses a checkout whose entry mounts on an undeclared node", async () => {
	const { appMountId } = await import("./team-bridge-mount.mjs");
	const root = mkdtempSync(join(tmpdir(), "tb-mount-"));
	try {
		mkdirSync(join(root, "src", "renderer", "src"), { recursive: true });
		writeFileSync(
			join(root, "src", "renderer", "src", "main.tsx"),
			'createRoot(document.getElementById("app") as HTMLElement);\n',
		);
		writeFileSync(
			join(root, "src", "renderer", "index.html"),
			'<body><div id="root"></div></body>\n',
		);
		assert.throws(
			() => appMountId(root),
			/mounts on #app, but .* declares no such element/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
