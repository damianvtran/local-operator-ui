#!/usr/bin/env node
/**
 * The update feed must describe BOTH macOS architectures after a split build.
 *
 * WHY THIS FILE EXISTS. `latest-mac.yml` is one file listing every macOS
 * artifact, and electron-builder rewrites it from scratch at the end of each
 * run with only that run's artifacts. Building arm64 and x64 in separate passes
 * — which is what stops the x64 DMG shipping arm64 V8 bytecode, the v0.30.10
 * brick — therefore leaves the second pass's feed naming only the second
 * architecture, and every user on the first is told there is no update. That
 * failure is SILENT: the release publishes, the assets are all present, and only
 * the feed is short. So the merge is asserted here rather than trusted.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { mergeFeedFiles, mergeFeeds, saveFeeds } from "./merge-update-feed.mjs";

/** The refusal a merge that found nothing must raise. */
const NOTHING_MERGED = /No macOS update feed was merged/;

const feed = (version, entries, defaultUrl) =>
	`version: ${version}\nfiles:\n${entries
		.map(
			(entry) =>
				`  - url: ${entry.url}\n    sha512: ${entry.sha512}\n    size: ${entry.size}\n`,
		)
		.join(
			"",
		)}path: ${defaultUrl}\nsha512: ${entries[0].sha512}\nreleaseDate: '2026-09-22T10:04:56.023Z'\n`;

const ARM = feed(
	"0.30.10",
	[
		{
			url: "local-operator-ui-0.30.10-arm64.zip",
			sha512: "ARMZIP",
			size: 178462443,
		},
		{
			url: "local-operator-ui-0.30.10-arm64.dmg",
			sha512: "ARMDMG",
			size: 185299892,
		},
	],
	"local-operator-ui-0.30.10-arm64.zip",
);
const X64 = feed(
	"0.30.10",
	[
		{
			url: "local-operator-ui-0.30.10-x64.zip",
			sha512: "X64ZIP",
			size: 189765336,
		},
		{
			url: "local-operator-ui-0.30.10-x64.dmg",
			sha512: "X64DMG",
			size: 196789295,
		},
	],
	"local-operator-ui-0.30.10-x64.zip",
);

test("the second pass's feed carries the first pass's architecture", () => {
	const merged = parse(mergeFeedFiles(X64, ARM));
	assert.deepEqual(
		merged.files.map((entry) => entry.url),
		[
			// New entries first, then the carried ones: `path:`/`sha512:` at the top
			// level name the default download and electron-builder points them at its
			// own first entry, so reordering would change which artifact that is.
			"local-operator-ui-0.30.10-x64.zip",
			"local-operator-ui-0.30.10-x64.dmg",
			"local-operator-ui-0.30.10-arm64.zip",
			"local-operator-ui-0.30.10-arm64.dmg",
		],
	);
	assert.equal(merged.path, "local-operator-ui-0.30.10-x64.zip");
	// The carried entries keep their own hashes and sizes: they describe files
	// that were built in the other pass and are still on the runner.
	const armDmg = merged.files.find((entry) => entry.url.endsWith("arm64.dmg"));
	assert.equal(armDmg.sha512, "ARMDMG");
	assert.equal(armDmg.size, 185299892);
});

test("a rebuilt architecture keeps the NEW hash, never the saved one", () => {
	// The saved feed names an artifact the new pass rebuilt. Resurrecting the old
	// hash would publish metadata for bytes that no longer exist.
	const stale = feed(
		"0.30.10",
		[{ url: "local-operator-ui-0.30.10-x64.zip", sha512: "STALE", size: 1 }],
		"local-operator-ui-0.30.10-x64.zip",
	);
	const merged = parse(mergeFeedFiles(X64, stale));
	const entry = merged.files.find((file) => file.url.endsWith("x64.zip"));
	assert.equal(entry.sha512, "X64ZIP");
	assert.equal(merged.files.length, 2);
});

test("feeds for different versions are never mixed", () => {
	// A stale state directory from an earlier release must not offer users an
	// artifact this release did not build.
	const older = ARM.replace("version: 0.30.10", "version: 0.30.9");
	assert.equal(mergeFeedFiles(X64, older), X64);
});

test("save then merge round-trips through the runner's state directory", () => {
	const dist = mkdtempSync(join(tmpdir(), "lo-feed-dist-"));
	const state = mkdtempSync(join(tmpdir(), "lo-feed-state-"));
	try {
		// Pass one wrote the arm64 feed; snapshot it.
		writeFileSync(join(dist, "latest-mac.yml"), ARM);
		assert.deepEqual(
			saveFeeds(dist, state, () => {}),
			["latest-mac.yml"],
		);

		// Pass two overwrote it with x64 only — the exact state that loses arm64.
		writeFileSync(join(dist, "latest-mac.yml"), X64);
		assert.deepEqual(
			mergeFeeds(dist, state, () => {}),
			["latest-mac.yml"],
		);

		const merged = parse(readFileSync(join(dist, "latest-mac.yml"), "utf8"));
		assert.equal(merged.files.length, 4);
		assert.ok(
			merged.files.some((entry) => entry.url.endsWith("arm64.dmg")),
			"the architecture built first is still offered an update",
		);
	} finally {
		rmSync(dist, { recursive: true, force: true });
		rmSync(state, { recursive: true, force: true });
	}
});

test("a merge that changed nothing is an error, not a quiet pass", () => {
	// THE FAILURE THIS GUARDS. If the save step did not run, or the build wrote
	// its feed somewhere else, the merge has nothing to do — and a feed listing
	// one architecture is indistinguishable from a correct one until users stop
	// receiving updates. It has to be red on the runner instead.
	const dist = mkdtempSync(join(tmpdir(), "lo-feed-dist-"));
	const state = mkdtempSync(join(tmpdir(), "lo-feed-state-"));
	try {
		writeFileSync(join(dist, "latest-mac.yml"), X64);
		assert.throws(() => mergeFeeds(dist, state, () => {}), NOTHING_MERGED);
	} finally {
		rmSync(dist, { recursive: true, force: true });
		rmSync(state, { recursive: true, force: true });
	}
});
