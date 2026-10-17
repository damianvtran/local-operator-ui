#!/usr/bin/env node
/**
 * Extra seeding for the model-picker driver: a CONFIGURED model, so the app
 * boots into chat with a model bound instead of into the first-run setup wizard.
 *
 *     node seed-model-picker.mjs <scratch-root>
 *
 * Run by `run.sh` through `EXTRA_SEED`, after the standard `seed.mjs`, into the
 * same scratch root. The wizard is not a bug — it is what a fresh config
 * produces — but it covers the composer, so `/model` cannot be typed and none of
 * the picker's states are reachable from it.
 *
 * `hosting` + `model_name` are the two keys the app reads to decide it has a
 * model (the same pair `/model default` writes). No credential is seeded: the
 * catalogue is expected to list the shipped registry rows with a `Needs sign-in`
 * group, which is exactly the shape the picker's grouping and its `current` row
 * are judged on, and it keeps this harness from depending on a live provider.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: seed-model-picker.mjs <scratch-root>");
	process.exit(1);
}
const CONFIG = join(resolve(root), "config");
if (CONFIG === join(homedir(), ".local-operator")) {
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}
mkdirSync(CONFIG, { recursive: true });
writeFileSync(
	join(CONFIG, "config.yml"),
	[
		"hosting: openrouter",
		"model_name: deepseek/deepseek-chat",
		"",
	].join("\n"),
);
console.log(join(CONFIG, "config.yml"));
