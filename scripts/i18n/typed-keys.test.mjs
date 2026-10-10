import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

import { main as generateMain } from "./generate.mjs";

/*
 * The typed-key mechanism, end to end and falsifiable.
 *
 * RFC §2.4's decision was proven by a spike; this suite re-proves it on the
 * committed generator and the real `t()`: the SHAPE of the generated module,
 * the four NEGATIVE cases rejected by `tsc` (with a control compile that must
 * fail without them), and the runtime rendering through the same generated
 * catalogue. The fixture lives beside this file; the compile runs in a temp
 * tree so the shipped `src/i18n/keys.gen.ts` is never in the loop.
 *
 * HOW THE TEMP TREE RESOLVES DEPENDENCIES: it sits in the system temp
 * directory with a `node_modules` SYMLINK to this repository's — a temp tree
 * that copied the real one would be hundreds of megabytes, and one that
 * reached it through `../../..` would tsc-resolve by accident of where the
 * temp directory landed. `intl-messageformat` is the one runtime dependency
 * `messages.ts` needs, and the symlink is what hands it over.
 */

const REPO = new URL("../..", import.meta.url).pathname;
const FIXTURES = join(REPO, "scripts", "i18n", "fixtures", "typed-keys");
const TSC = join(REPO, "node_modules", ".bin", "tsc");

let workdir;
let tscBase;

before(() => {
	workdir = mkdtempSync(join(tmpdir(), "i18n-typed-keys-"));
	// The real core, minus the generated file (regenerated from the fixture).
	cpSync(join(REPO, "src", "i18n"), join(workdir, "i18n"), {
		recursive: true,
	});
	rmSync(join(workdir, "i18n", "catalogues"), { recursive: true, force: true });
	cpSync(join(FIXTURES, "catalogues"), join(workdir, "i18n", "catalogues"), {
		recursive: true,
	});
	symlinkSync(join(REPO, "node_modules"), join(workdir, "node_modules"), "dir");
	for (const name of ["call-sites-positive.ts", "call-sites-negative.ts"]) {
		cpSync(join(FIXTURES, name), join(workdir, "i18n", name));
	}
	const exit = generateMain([
		"--catalogues",
		join(workdir, "i18n", "catalogues"),
		"--out",
		join(workdir, "i18n", "keys.gen.ts"),
	]);
	assert.equal(exit, 0, "the generator refused the fixture catalogue");
	tscBase = [
		"--noEmit",
		"--strict",
		"--target",
		"es2020",
		"--module",
		"esnext",
		"--moduleResolution",
		"bundler",
		"--resolveJsonModule",
		"--esModuleInterop",
		"--skipLibCheck",
	];
});

after(() => {
	rmSync(workdir, { recursive: true, force: true });
});

function compile(files) {
	try {
		execFileSync(TSC, [...tscBase, ...files], {
			cwd: workdir,
			stdio: "pipe",
			encoding: "utf8",
		});
		return { ok: true, output: "" };
	} catch (error) {
		return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
	}
}

test("the generated module carries the RFC §2.4 shapes, from the fixture's own arguments", () => {
	const generated = readFileSync(join(workdir, "i18n", "keys.gen.ts"), "utf8");
	// Key order is sorted; each entry's parameter shape comes from the
	// message's own placeholders.
	assert.match(generated, /"demo\.words\.files": \{ count: number \};/);
	assert.match(generated, /"demo\.words\.hello": \{ name: string \};/);
	assert.match(
		generated,
		/"demo\.words\.updated": \{ when: Date \| number \};/,
	);
	assert.match(generated, /"demo\.words\.pick": \{ choice: string \};/);
	assert.match(generated, /"demo\.words\.plain": undefined;/);
	// The derived algebra the two overloads are declared against.
	assert.match(generated, /export type MessageKey = keyof MessageParams;/);
	assert.match(generated, /export type WithParams = \{/);
	assert.match(generated, /export type WithoutParams = \{/);
});

test("the committed keys.gen.ts matches its catalogues (generate.mjs --check)", () => {
	// The drift gate (round-1 review, R1-2): this case is what makes the
	// "CI rejects drift" claim in the generated header true — it runs in the
	// desktop suite CI executes, and `pnpm check-i18n` chains the same check.
	const exit = generateMain(["--check"]);
	assert.equal(
		exit,
		0,
		"src/i18n/keys.gen.ts is stale: run `node scripts/i18n/generate.mjs` and commit the result",
	);
});

test("every positive call site compiles under --strict", () => {
	const result = compile([
		join(workdir, "i18n", "messages.ts"),
		join(workdir, "i18n", "call-sites-positive.ts"),
	]);
	assert.ok(
		result.ok,
		`positive call sites failed to compile:\n${result.output}`,
	);
});

test("all four negative cases are rejected (every @ts-expect-error is used)", () => {
	// An UNUSED directive is itself a compile error (TS2578), so a green run
	// here means each of the four lines really errored.
	const result = compile([
		join(workdir, "i18n", "messages.ts"),
		join(workdir, "i18n", "call-sites-negative.ts"),
	]);
	assert.ok(result.ok, `negative cases were accepted:\n${result.output}`);
});

test("the control compile — directives stripped — fails, proving the rejections are real", () => {
	const negative = readFileSync(
		join(workdir, "i18n", "call-sites-negative.ts"),
		"utf8",
	);
	const control = negative.replace(
		/\/\/ @ts-expect-error/g,
		"// control: directive stripped",
	);
	assert.equal((control.match(/\/\/ @ts-expect-error/g) ?? []).length, 0);
	writeFileSync(join(workdir, "i18n", "call-sites-control.ts"), control);
	const result = compile([
		join(workdir, "i18n", "messages.ts"),
		join(workdir, "i18n", "call-sites-control.ts"),
	]);
	assert.ok(
		!result.ok,
		"the control compile passed, so some case is NOT an error",
	);
	const errorLines =
		result.output.match(/error TS\d+/g)?.length ??
		result.output.match(/error TS\d+/g)?.length ??
		0;
	assert.ok(errorLines >= 4, `expected 4+ errors, saw:\n${result.output}`);
});

test("the same generated catalogue renders through the real t() at runtime", async () => {
	const bundle = await build({
		stdin: {
			contents: 'export { t } from "./messages";',
			resolveDir: join(workdir, "i18n"),
			sourcefile: "typed-keys-runtime.mjs",
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	assert.equal(mod.t("demo.words.hello", { name: "Ada" }), "Hello, Ada!");
	assert.equal(mod.t("demo.words.files", { count: 2 }), "2 files");
	assert.equal(mod.t("demo.words.files", { count: 1 }), "1 file");
	assert.equal(mod.t("demo.words.plain"), "plain text, no params");
	assert.equal(mod.t("demo.words.pick", { choice: "a" }), "Alpha");
	// The degrade path of §2.6: an unresolvable message answers with the key.
	assert.equal(mod.t("demo.words.unknown"), "demo.words.unknown");
});
