import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Source-only proof of the reason-code routing. It cannot prove the panel that
// renders the line, the service that emits the code, or a rendered frame; the
// hub-links scene and independent QA own those.
const bundled = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/agents/hub-link-copy";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
	// `hub-link-copy` imports `t` from `@shared/i18n`, so the alias the sibling
	// hub suites use has to resolve here too.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const { hubReasonText } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

/*
 * `alias-occupied` means an unowned local skill already holds the alias. It is
 * not a lineage conflict, so it must not render the mixed-lineage sentence that
 * `origin-conflict` uses; it names the local collision and the choice instead.
 */
test("alias-occupied names the occupied local alias", () => {
	assert.equal(
		hubReasonText("alias-occupied"),
		"That local alias is already used. Choose another.",
	);
});

test("alias-occupied with service detail resolves to the same sentence", () => {
	assert.equal(
		hubReasonText("alias-occupied/some/detail"),
		"That local alias is already used. Choose another.",
	);
});

test("origin-conflict still reports merge lineage", () => {
	assert.equal(
		hubReasonText("origin-conflict"),
		"This copy includes changes from another source. Automatic publication is paused.",
	);
});
