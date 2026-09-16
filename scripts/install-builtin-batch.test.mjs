/**
 * The built-ins batch: what it reports when a name is refused, when a copy was
 * a no-op, and when the backend cannot say which.
 *
 *     node --test scripts/install-builtin-batch.test.mjs
 *
 * Why this file exists. The shortcut's whole promise is that ONE bad name does
 * not take the batch with it, and that the summary counts what happened rather
 * than what was attempted — a copy that was already there is not an install, a
 * skip is not a success, and a failure is not silence. Those are claims about
 * the module's bookkeeping, and a frame of the summary cannot falsify any of
 * them: the frame shows the sentence the module produced.
 *
 * WHAT IT DRIVES. `install-builtin-batch.ts` is bundled in memory and run
 * against a scripted installer, so the real `installBuiltin`/`installBuiltins`/
 * `summariseInstalls`/`summarySentence` are what run — not a copy of their
 * rules. The installer's failures are the TYPED refusals the app's own
 * transport throws (`DesktopControlError`), because the 409 branch keys on the
 * status rather than on the route's message text.
 *
 * WHAT IT CANNOT PROVE. That the local backend answers 409 for a name collision
 * or `already_installed: true` for a repeat: those are the real server's
 * behaviours, and the shapes here are read from
 * `server/routes/desktop_profiles.py` (the `NameTakenError` → 409 branch) and
 * the hub standard's §5.6. QA's pass against a real app is what closes that.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the batch module the same way the other rigs run shipped TypeScript:
// in memory, from the tree under test, with the renderer's own globals.
const bundle = await build({
	stdin: {
		contents: `
			export { installBuiltin, installBuiltins, summariseInstalls, summarySentence } from "./src/renderer/src/features/agents/install-builtin-batch";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
	external: ["react", "react-dom"],
});
const source = bundle.outputFiles[0].text;

const load = () =>
	import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);

const NAMES = [
	"coder",
	"reviewer",
	"designer",
	"architect",
	"qa-tester",
	"manager",
];

test("a name the user already holds is skipped and the batch continues", async () => {
	const { installBuiltins, DesktopControlError } = await load();
	// The route's own refusal for `install_seed`'s NameTakenError.
	const collision = () =>
		new DesktopControlError(
			409,
			"That name belongs to another agent. Choose a different name to extend the packaged profile.",
		);
	const asked = [];
	const summary = await installBuiltins(NAMES, async (name) => {
		asked.push(name);
		if (name === "reviewer") throw collision();
		return { name };
	});

	assert.deepEqual(asked, NAMES, "every name is attempted, in order");
	assert.deepEqual(summary, {
		installed: 5,
		alreadyPresent: 0,
		skipped: ["reviewer"],
		failed: [],
	});
	const { summarySentence } = await load();
	assert.equal(summarySentence(summary), "5 installed, 1 skipped.");
});

test("already_installed is reported as present, and its absence as installed", async () => {
	const { installBuiltins, summariseInstalls } = await load();
	// A backend that answers the field at all, and one that predates it: both
	// answer 200, and only the field tells them apart.
	const summary = await installBuiltins(
		["coder", "reviewer", "designer"],
		async (name) =>
			name === "coder" ? { name, already_installed: true } : { name },
	);
	assert.deepEqual(summary, {
		installed: 2,
		alreadyPresent: 1,
		skipped: [],
		failed: [],
	});
	assert.deepEqual(
		summariseInstalls([
			{ name: "coder", result: "already_present" },
			{ name: "reviewer", result: "already_present" },
		]),
		{ installed: 0, alreadyPresent: 2, skipped: [], failed: [] },
	);
});

test("a failure is reported verbatim and does not stop the batch", async () => {
	const { installBuiltins } = await load();
	const summary = await installBuiltins(NAMES, async (name) => {
		if (name === "architect") throw new Error("The server did not answer.");
		return { name };
	});
	assert.equal(summary.installed, 5);
	assert.deepEqual(summary.failed, [
		{ name: "architect", message: "The server did not answer." },
	]);
	const { summarySentence } = await load();
	assert.equal(summarySentence(summary), "5 installed, 1 failed.");
});

test("progress names one agent at a time and counts completed installs", async () => {
	const { installBuiltins } = await load();
	const events = [];
	await installBuiltins(
		["coder", "reviewer"],
		async (name) => ({ name }),
		(progress) => events.push(`${progress.done}:${progress.current ?? "-"}`),
	);
	assert.deepEqual(events, ["0:coder", "1:-", "1:reviewer", "2:-"]);
});

test("a batch of one reports one, and the sentence never claims a missing bucket", async () => {
	const { installBuiltins, summarySentence } = await load();
	const summary = await installBuiltins(["coder"], async (name) => ({ name }));
	assert.equal(summary.installed, 1);
	assert.equal(summarySentence(summary), "1 installed.");
	assert.equal(
		summarySentence({
			installed: 0,
			alreadyPresent: 0,
			skipped: [],
			failed: [],
		}),
		"Nothing to install.",
	);
});
