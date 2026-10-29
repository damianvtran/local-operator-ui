import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Source-only proof of the alias-collision classifier that picks the sentence a
 * failed skill pull/subscribe shows. It cannot prove the panel that renders the
 * line, the core that emits the code, or a rendered frame; the hub-skills
 * scene and independent QA own those.
 *
 * It exists because the classifier used to live inside the component file and
 * matched the WORD "alias" in the refusal's prose. Core has since moved alias
 * collisions onto a dedicated `alias-occupied` code and reworded the sentence,
 * which made the old matcher silently fall back to generic copy. The first two
 * tests are that regression: the dedicated code must route the remedy with no
 * help from the message text at all. The last two hold the other direction —
 * the legacy arm must survive for older cores, and neither arm may swallow the
 * source/scope-mismatch class where renaming is the wrong advice.
 *
 * One bundle, two exports: `aliasConflict`'s `instanceof DesktopControlError`
 * only holds when the error class comes from the SAME module instance as the
 * predicate's own import, so both are taken from this one compiled output.
 */
const bundled = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/agent-hub/hub-skill-alias";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	// The modules import through the renderer's path aliases.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const { aliasConflict, DesktopControlError } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("alias-occupied routes the alias remedy regardless of the message text", () => {
	assert.equal(
		aliasConflict(
			new DesktopControlError(409, "", undefined, "alias-occupied"),
		),
		true,
	);
});

test("alias-occupied routes the alias remedy when the sentence never says alias", () => {
	assert.equal(
		aliasConflict(
			new DesktopControlError(
				409,
				"That name is already used by a local skill.",
				undefined,
				"alias-occupied",
			),
		),
		true,
	);
});

test("legacy origin-conflict naming the alias still routes the alias remedy", () => {
	assert.equal(
		aliasConflict(
			new DesktopControlError(
				409,
				"The local alias is already taken by another skill.",
				undefined,
				"origin-conflict",
			),
		),
		true,
	);
});

test("origin-conflict without an alias mention keeps the generic sentence", () => {
	assert.equal(
		aliasConflict(
			new DesktopControlError(
				409,
				"This copy includes changes from another source.",
				undefined,
				"origin-conflict",
			),
		),
		false,
	);
});

test("another refusal code naming an alias is not an alias collision", () => {
	assert.equal(
		aliasConflict(
			new DesktopControlError(
				403,
				"You cannot write to that alias.",
				undefined,
				"forbidden",
			),
		),
		false,
	);
});

test("a non-DesktopControlError is never an alias collision", () => {
	assert.equal(aliasConflict(new Error("alias is taken")), false);
	assert.equal(
		aliasConflict(
			Object.assign(new Error("alias is taken"), { code: "alias-occupied" }),
		),
		false,
	);
	assert.equal(aliasConflict(null), false);
});
