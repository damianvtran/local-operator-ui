import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SEEDING EFFECT MUST DO WHAT ITS OWN COMMENT SAYS: seed the box when the
 * composer adopts a conversation, and at no other time.
 *
 * `shouldReinitialiseComposer` is the gate it always MEANT to have and did not.
 * Its deps array is `[conversationId, hydrated, getCurrentInput, historyIndex,
 * submittedMessages]`, and two of those change on every submit SETTLE -
 * `addSubmittedMessage` installs a new array identity and `retireDraft` nulls
 * the history index, in the same turn - so the effect ran again and re-seeded
 * the box from `getCurrentInput`, which `retireDraft` had just written to `""`.
 * That is the measured destruction of text typed while a send was in flight: 16
 * of 16 characters at one hold, 5 of 16 at another, with the caret still in the
 * box. It is a DIFFERENT writer from the documented clear whose whole purpose is
 * that a late echo must not clear what the user has typed since - which is
 * exactly the guarantee the second writer was breaking.
 *
 * The rule is pure and exported so it is asserted here without a DOM (the shape
 * `ask-answer.ts`'s predicates take), and the effect is pinned to it by a source
 * scan because a rule nothing consults is a comment. The BEHAVIOUR - the box
 * holding what the user typed while the send settles - is driven through the
 * shipped component in `scripts/credential-composer.test.mjs`, whose jsdom
 * harness is the only one in this tree that mounts it.
 */

const read = (path) => readFileSync(path, "utf8");

/** The source with its comments blanked, so prose about a token is not the token. */
const code = (path) =>
	read(path)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";
/* ------------------------------------------------------------------ */
/* The settle rule                                                      */
/* ------------------------------------------------------------------ */

/*
 * React stays external so the bundle shares ONE copy with this file's own
 * imports - which is why the bundle is written to a file and imported from
 * there rather than through a data URL: a data-URL module has no directory to
 * resolve a bare `react` from, and node refuses it (the same reason
 * `scripts/ask-options.test.mjs` writes its bundle out). The renderer's
 * `@shared` alias is declared by hand because it is a tsconfig path rather than
 * a node resolution.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { shouldReinitialiseComposer } from "./src/renderer/src/shared/hooks/use-message-input";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundlePath = new URL(
	`./_composer-focus-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { shouldReinitialiseComposer } = await import(bundlePath.href);
await unlink(bundlePath);

test("a composer seeds for a conversation it has not seeded for", () => {
	assert.equal(shouldReinitialiseComposer(undefined, "conv-1", true), true);
	assert.equal(
		shouldReinitialiseComposer("conv-0", "conv-1", true),
		true,
		"a conversation CHANGE is what the effect is named for",
	);
});

test("a settle on the SAME conversation does not seed, which is the fix", () => {
	/*
	 * The defect, as one line: the box has already been seeded for this
	 * conversation, and the submit settle that re-runs the effect must not write
	 * the store's value over what the user has typed since.
	 */
	assert.equal(shouldReinitialiseComposer("conv-1", "conv-1", true), false);
});

test("a settle with no conversation at all does not seed either", () => {
	assert.equal(shouldReinitialiseComposer(undefined, undefined, true), false);
	assert.equal(shouldReinitialiseComposer("conv-1", undefined, true), true);
});

test("nothing seeds before hydration", () => {
	/*
	 * The store is persisted, so before hydration its value is the empty default:
	 * seeding from it would write `""` over the restored draft.
	 */
	assert.equal(shouldReinitialiseComposer(undefined, "conv-1", false), false);
	assert.equal(shouldReinitialiseComposer("conv-1", "conv-1", false), false);
});

test("the seeding effect is GATED on the rule, not merely accompanied by it", () => {
	const source = code(HOOK);
	const from = source.indexOf("export const useMessageInput = ({");
	assert.ok(from > -1, "the hook is gone");
	/*
	 * The seeding effect, located by its own gate rather than by a comment: the
	 * comment blanking above removes prose, which is the point of it.
	 */
	const effectFrom = source.indexOf("lastInitialisedRef.current,", from);
	const effectTo = source.indexOf(
		"]);",
		source.indexOf("submittedMessages,", effectFrom),
	);
	assert.ok(
		effectFrom > -1 && effectTo > effectFrom,
		"the seeding effect is gone",
	);
	const effect = source.slice(
		source.lastIndexOf("useEffect(", effectFrom),
		effectTo,
	);
	assert.match(
		effect,
		/shouldReinitialiseComposer\(/,
		"the exported rule is what the effect consults, and it is consulted BEFORE the writes below",
	);
	assert.ok(
		effect.indexOf("shouldReinitialiseComposer") <
			effect.indexOf("setInputValue"),
		"the gate has to precede the seeding write, or it gates nothing",
	);
	assert.match(effect, /lastInitialisedRef\.current = conversationId;/);
	assert.match(
		effect,
		/getCurrentInput\(conversationId\)/,
		"the write the gate protects is still the store's value",
	);
	/*
	 * And the memory that makes the gate work is written by the effect it gates:
	 * a ref written anywhere else is a gate that opens on the next render.
	 */
	assert.equal(
		source.split("lastInitialisedRef.current = conversationId;").length - 1,
		1,
		"the gate's memory has exactly one writer, and it is the gated effect",
	);
});
