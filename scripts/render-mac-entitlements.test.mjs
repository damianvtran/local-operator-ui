/**
 * Tests for the release-path entitlements renderer.
 *
 * WHY THIS FILE EXISTS SEPARATELY from `webauthn.test.mjs`: that one is about the
 * RUNTIME rule (when the platform authenticator may be enabled), and this one is
 * about the RELEASE rule (what the signed bundle's signature carries). They fail
 * for different reasons — a broken gate and a plist that never got the group both
 * end with "passkeys do nothing", and the two need different fixes.
 *
 * The CLI cases run the script as the workflow does, with a synthetic team id, so
 * the assertion covers the argument handling and the exit status a release job
 * reads rather than only the pure function behind them.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	assertBundleId,
	assertTeamId,
	bundleIdFromPackage,
	renderEntitlementsPlist,
	webauthnKeychainAccessGroup,
} from "./render-mac-entitlements.mjs";

const COMMITTED = readFileSync(
	new URL("../build/entitlements.mac.plist", import.meta.url),
	"utf8",
);
const TEAM_ID = "AB12CD34EF";

test("the committed plist carries no keychain access group and no team id", () => {
	// The gate for the whole mechanism: the group embeds the team id, so a group
	// here would be a secret in the repository.
	assert.doesNotMatch(COMMITTED, /keychain-access-groups/);
	assert.doesNotMatch(COMMITTED, new RegExp(TEAM_ID));
	assert.match(COMMITTED, /com\.apple\.security\.cs\.allow-jit/);
});

test("rendering adds the group and changes nothing else", () => {
	const group = webauthnKeychainAccessGroup(TEAM_ID, "com.local-operator");
	const rendered = renderEntitlementsPlist(COMMITTED, [group]);
	assert.match(rendered, /<key>keychain-access-groups<\/key>/);
	assert.match(rendered, new RegExp(`<string>${group}</string>`));
	// Every committed entitlement survives, because the injection is an insertion
	// before the closing dict rather than a rewrite.
	for (const key of [
		"com.apple.security.cs.allow-jit",
		"com.apple.security.cs.disable-library-validation",
		"com.apple.security.device.camera",
		"com.apple.security.network.server",
	]) {
		assert.match(
			rendered,
			new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>`),
		);
	}
	assert.equal(
		(rendered.match(/<\/dict>/g) ?? []).length,
		1,
		"the plist still has exactly one dict",
	);
	// Idempotent: rendering a plist that already carries the key replaces the array
	// rather than appending a second one.
	const twice = renderEntitlementsPlist(rendered, [group]);
	assert.equal((twice.match(/keychain-access-groups/g) ?? []).length, 1);
});

test("rendering refuses inputs that would ship a group nothing can match", () => {
	assert.throws(
		() => renderEntitlementsPlist(COMMITTED, []),
		/at least one access group/,
	);
	assert.throws(
		() => renderEntitlementsPlist("<plist></plist>", ["x"]),
		/no <\/dict>/,
	);
	assert.throws(() => assertTeamId(""), /APPLE_TEAM_ID is missing/);
	assert.throws(
		() => assertTeamId("ab12cd34ef"),
		/not a ten-character team id/,
	);
	assert.throws(() => assertTeamId("AB12CD34E"), /not a ten-character team id/);
	assert.throws(
		() => assertBundleId(""),
		/does not look like a bundle identifier/,
	);
	assert.equal(assertTeamId(TEAM_ID), TEAM_ID);
	// The bundle id comes from the packaging config, so the group and the signature
	// cannot describe different apps.
	assert.equal(bundleIdFromPackage(), "com.local-operator");
});

test("the workflow command renders a lint-clean plist without printing the team id", () => {
	const dir = mkdtempSync(join(tmpdir(), "render-entitlements-"));
	try {
		const out = join(dir, "nested", "entitlements.mac.plist");
		const result = spawnSync(
			process.execPath,
			["scripts/render-mac-entitlements.mjs", "--out", out],
			{
				env: { ...process.env, APPLE_TEAM_ID: TEAM_ID },
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 0, result.stderr);
		// The destination directory is created when it does not exist: $RUNNER_TEMP
		// exists on a runner, but a caller naming a fresh path must not fail.
		assert.ok(existsSync(out), "the plist was written");
		const rendered = readFileSync(out, "utf8");
		assert.match(
			rendered,
			/<string>AB12CD34EF\.com\.local-operator\.webauthn<\/string>/,
		);
		// SECRET HYGIENE: the script's output is a CI log, and the team id is a CI
		// secret. The group is written to the file and never to stdout.
		assert.doesNotMatch(result.stdout, new RegExp(TEAM_ID));
		assert.doesNotMatch(result.stderr, new RegExp(TEAM_ID));
		assert.match(result.stdout, /wrote \d+ entitlements/);
		if (process.platform === "darwin") {
			// The check that matters for codesign: it has to be a real plist.
			const lint = spawnSync("/usr/bin/plutil", ["-lint", out], {
				encoding: "utf8",
			});
			assert.equal(lint.status, 0, `${lint.stdout}${lint.stderr}`);
		}
		// A missing secret fails the step rather than rendering a plist without the
		// group: a release whose signature lacks the entitlement is a release whose
		// passkeys silently do nothing.
		const missing = spawnSync(
			process.execPath,
			[
				"scripts/render-mac-entitlements.mjs",
				"--out",
				join(dir, "never.plist"),
			],
			{ env: { ...process.env, APPLE_TEAM_ID: "" }, encoding: "utf8" },
		);
		assert.notEqual(missing.status, 0);
		assert.match(missing.stderr, /APPLE_TEAM_ID is missing/);
		assert.ok(!existsSync(join(dir, "never.plist")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
