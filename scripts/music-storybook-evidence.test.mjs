import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	musicEvidenceManifest,
	musicEvidenceRequested,
} from "./music-storybook-evidence.mjs";

const states = [
	"queued",
	"running",
	"narrow",
	"populated",
	"partial-failure",
	"empty",
	"jobs-cancel",
	"jobs-cancel-rtl",
	"canonical-missing-bytes",
	"canonical-rtl",
];
const fixture = (run) => {
	const directory = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"music-static-test-",
		),
	);
	try {
		writeFileSync(join(directory, "index.html"), "actual static entry fixture");
		writeFileSync(join(directory, "iframe.html"), "iframe fixture");
		writeFileSync(
			join(directory, "index.json"),
			JSON.stringify({
				entries: Object.fromEntries(
					[
						...states.map((state) => `chat-canonical-music--${state}`),
						"chat-canonical-sound--running",
					].map((id) => [id, { id }]),
				),
			}),
		);
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

test("music evidence uses changed surfaces, never a PR or branch name", () => {
	for (const path of [
		"src/renderer/src/features/chat/canonical/music-result.tsx",
		"scripts/music-storybook-evidence.test.mjs",
		"scripts/storybook-music-scope.mjs",
		".storybook/main.ts",
		"scripts/fixtures/music-tone.mp3",
	])
		assert.equal(musicEvidenceRequested([path]), true, path);
	for (const path of [
		"docs/music.md",
		"src/renderer/src/features/settings/page.tsx",
		"package.json",
		".github/workflows/ci.yml",
	])
		assert.equal(musicEvidenceRequested([path]), false, path);
	assert.equal(musicEvidenceRequested([]), false);
	assert.throws(() => musicEvidenceRequested(null), /inventory unavailable/);
});

test("static manifest hashes bytes and records exact source and fixture scope", () =>
	fixture((directory) => {
		writeFileSync(join(directory, ".nojekyll"), "");
		const result = musicEvidenceManifest(directory, {
			checkoutCommit: "checkout",
			requestedHead: "requested",
			srcTree: "src",
			scriptsTree: "scripts",
		});
		assert.equal(result.requestedHead, "requested");
		assert.equal(result.fixtureScope.reactDocgen, false);
		assert.equal(result.nativeDependenciesIncluded, false);
		assert.equal(result.fixtureScope.stories.length, 2);
		assert.equal(
			result.files.find((file) => file.path === "index.html").sha256,
			createHash("sha256")
				.update(readFileSync(join(directory, "index.html")))
				.digest("hex"),
		);
		assert.equal(result.files.length, 4);
	}));

for (const bad of [".env", "binding.node", "escape-link"])
	test(`static manifest rejects ${bad}`, () =>
		fixture((directory) => {
			if (bad === "escape-link")
				symlinkSync(join(directory, "index.html"), join(directory, bad));
			else writeFileSync(join(directory, bad), "unsafe");
			assert.throws(
				() => musicEvidenceManifest(directory, {}),
				/(?:Unsafe|Non-static)/,
			);
		}));

test("missing entry or incomplete actual story index cannot be published", () =>
	fixture((directory) => {
		rmSync(join(directory, "iframe.html"));
		assert.throws(
			() => musicEvidenceManifest(directory, {}),
			/Missing music evidence entry/,
		);
		writeFileSync(join(directory, "iframe.html"), "fixture");
		writeFileSync(join(directory, "index.json"), '{"entries":{}}');
		assert.throws(
			() => musicEvidenceManifest(directory, {}),
			/Missing music story/,
		);
	}));

test("workflow keeps static evidence outside the existing out manifest", () => {
	const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
	const job = workflow.slice(
		workflow.indexOf("  qa-bundle:"),
		workflow.indexOf("  bytecode-build:"),
	);
	assert.match(job, /fetch-depth: 2/);
	assert.match(job, /run: node scripts\/music-storybook-evidence\.mjs scope/);
	assert.match(job, /LOP_STORYBOOK_MUSIC_EVIDENCE: '1'/);
	assert.match(
		job,
		/pnpm build-storybook --output-dir "\$RUNNER_TEMP\/music-storybook"/,
	);
	assert.match(
		job,
		/node scripts\/music-storybook-evidence\.mjs manifest "\$RUNNER_TEMP\/music-storybook"/,
	);
	assert.match(job, /path: out\//);
	assert.match(job, /path: \$\{\{ runner.temp \}\}\/music-storybook\//);
	assert.equal(
		(job.match(/if: steps\.music_evidence\.outputs\.music == 'true'/g) ?? [])
			.length,
		2,
	);
});
