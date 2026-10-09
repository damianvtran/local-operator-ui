/**
 * The main window's guards against a HOSTILE document, in the pinned Electron.
 *
 * `window-guards.test.mjs` pins the rules by execution; this is the other half
 * the memo asks for (§4.1, §8 F6): a real BrowserWindow, a real sandboxed iframe
 * loading a document from a loopback "daemon" that logs every request it
 * receives, and a script that attempts each escape. It runs the SAME document
 * twice - BEFORE (the old sandbox, no guards) and AFTER (the shipped sandbox read
 * out of `html-preview.tsx`, the shipped guards bundled from `src/main`) - so the
 * assertions are a difference, not just an absence: a rig that blocks nothing
 * would fail the BEFORE half.
 *
 * WHY IT IS NOT IN `pnpm test:desktop`: that suite is node-only; this boots
 * Electron (hidden, `show: false`, its own userData dir under the temp root), so
 * like `session-cookie-electron.test.mjs` it is run on demand:
 * `pnpm test:window-guards`. The environment handed to the child drops every
 * inherited CMUX_* / ELECTRON_RUN_AS_NODE value.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const scenario = join(here, "window-guards-electron-scenario.cjs");
const skip =
	process.platform === "linux" && !process.env.DISPLAY
		? "Electron needs a display and this runner has none"
		: undefined;

const OLD_SANDBOX = ["allow-scripts", "allow-same-origin", "allow-forms"].join(
	" ",
);
let root;
let bundlePath;
let newSandbox;

const run = (mode, sandbox) => {
	const userData = join(root, `ud-${mode}`);
	const out = join(root, `${mode}.json`);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([k]) => !k.startsWith("CMUX_") && k !== "ELECTRON_RUN_AS_NODE",
		),
	);
	const child = spawnSync(electronPath, [scenario], {
		env: {
			...env,
			WG_BUNDLE: bundlePath,
			WG_SANDBOX: sandbox,
			WG_MODE: mode,
			WG_USER_DATA: userData,
			WG_OUT: out,
		},
		encoding: "utf8",
		timeout: 90_000,
	});
	assert.equal(
		child.status,
		0,
		`${mode} scenario exited ${child.status}\n${child.stdout}\n${child.stderr}`,
	);
	return JSON.parse(readFileSync(out, "utf8"));
};

before(async () => {
	root = mkdtempSync(join(tmpdir(), "lop-window-guards-"));
	for (const m of ["before", "after"]) {
		// userData must exist for the parent page the scenario writes into it.
		(await import("node:fs")).mkdirSync(join(root, `ud-${m}`), {
			recursive: true,
		});
	}
	const bundle = await build({
		stdin: {
			contents: [
				'export * from "./src/main/window-guards";',
				'export * from "./src/main/window-guards-electron";',
			].join("\n"),
			resolveDir: repoRoot,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		external: ["electron"],
		write: false,
	});
	bundlePath = join(root, "guards.mjs");
	writeFileSync(bundlePath, bundle.outputFiles[0].text);
	const src = readFileSync(
		join(
			repoRoot,
			"src/renderer/src/features/chat/components/canvas/html-preview.tsx",
		),
		"utf8",
	);
	newSandbox = /export const PREVIEW_SANDBOX = "([^"]+)"/.exec(src)?.[1];
});
after(() => rmSync(root, { recursive: true, force: true }));

test(
	"the hostile preview document is contained after the change and was not before",
	{ skip },
	() => {
		assert.ok(newSandbox, "html-preview.tsx must export PREVIEW_SANDBOX");
		const before = run("before", OLD_SANDBOX);
		const after = run("after", newSandbox);
		if (process.env.WG_PRINT)
			console.log(JSON.stringify({ before, after }, null, 1));

		// BEFORE: the rig can see the escape, so a pass AFTER means something.
		assert.ok(
			before.hits.some((h) => h.startsWith("GET /secret")),
			"before: the document must reach the daemon, or the rig proves nothing",
		);
		assert.ok(
			before.hits.some((h) => h.includes("main-nav")),
			"before: a script can navigate the window",
		);

		// AFTER: the server never saw any of it. /v1/static/html is the document's own load.
		assert.deepEqual(
			after.hits,
			[],
			"after: nothing from the document reached the daemon",
		);
		assert.equal(
			after.mainStayedOnApp,
			true,
			"after: the main window stays on the app's document",
		);
		assert.equal(after.sandbox, newSandbox);
		const r = after.report;
		assert.ok(
			r,
			"after: the frame still RUNS (the preview works): it reported",
		);
		for (const key of ["parent.document", "top.document"])
			assert.match(r[key], /^THREW/, key);
		assert.match(r["read file via fetch(file:///etc/hosts)"], /^THREW/);
		assert.match(r["read file via XHR(file:///etc/hosts)"], /^THREW/);
		assert.match(
			r["fetch loopback daemon (http, cross-origin read)"],
			/^THREW/,
		);
		assert.match(r.localStorage, /^THREW/);
		assert.equal(r["window.open"], "null");
		assert.equal(r["frameElement (sandbox lift)"], "no frameElement");
		// window.open from the MAIN frame: file: and smb: never leave; a lookalike of
		// a sign-in host is NOT a sign-in popup (it is an ordinary https link, so it
		// goes to the system browser, not into an app-owned window).
		assert.deepEqual(after.opened, [
			"https://accounts.google.com.attacker.test/",
			"https://example.com/ok",
		]);
		// BEFORE, the raw string reached shell.openExternal (the old handler's sink).
		assert.ok(before.opened.includes("smb://attacker/share"));
	},
);
