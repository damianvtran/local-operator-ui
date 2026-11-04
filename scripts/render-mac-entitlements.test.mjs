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
 * reads rather than only the pure function behind them. The profile-PRESENT
 * branch is driven with a synthetic profile dump (`profileKeychainGroups` takes
 * its reader), because a real Developer ID profile exists only on the release
 * runner; the branch is exercised again by the release gate, which reads the
 * profile off the built artifact.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	plistStringValues,
	profileAllowlistAuthorizes,
	profileEntryAuthorizes,
} from "./macos-entitlement-policy.mjs";
import {
	APPLICATION_IDENTIFIER_KEY,
	KEYCHAIN_ACCESS_GROUPS_KEY,
	TEAM_IDENTIFIER_KEY,
	assertBundleId,
	assertTeamId,
	bundleIdFromPackage,
	profileBackedClaims,
	profileKeychainGroups,
	renderEntitlementsPlist,
	renderProfileBackedEntitlements,
	unauthorizedClaims,
	webauthnKeychainAccessGroup,
} from "./render-mac-entitlements.mjs";
import {
	hasWebauthnEntitlement,
	profileAuthorizes,
} from "./verify-macos-artifacts.mjs";

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

test("the renderer writes the committed plist unchanged when no profile is given", () => {
	/*
	 * No profile, no claim — the shipped default since the 0.29.6 incident.
	 *
	 * This case is the whole shape of the release path while no provisioning
	 * profile exists: the plist that reaches codesign carries no restricted
	 * entitlement, so macOS spawns the bundle, and the app is inert for passkeys
	 * by design rather than unlaunchable. The team id is no longer needed at all on
	 * this path, which is why the case passes one in and still expects no group.
	 */
	const dir = mkdtempSync(join(tmpdir(), "render-entitlements-"));
	try {
		const out = join(dir, "nested", "entitlements.mac.plist");
		const result = spawnSync(
			process.execPath,
			[
				"scripts/render-mac-entitlements.mjs",
				"--out",
				out,
				"--team-id",
				TEAM_ID,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(existsSync(out), "the plist was written");
		const rendered = readFileSync(out, "utf8");
		assert.equal(
			rendered,
			COMMITTED,
			"the committed plist is written verbatim",
		);
		assert.doesNotMatch(rendered, /keychain-access-groups/);
		assert.doesNotMatch(result.stdout, new RegExp(TEAM_ID));
		assert.match(result.stdout, /passkeys stay inert/);
		if (process.platform === "darwin") {
			// The check that matters for codesign: it has to be a real plist.
			const lint = spawnSync("/usr/bin/plutil", ["-lint", out], {
				encoding: "utf8",
			});
			assert.equal(lint.status, 0, `${lint.stdout}${lint.stderr}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a profile-less group is unreachable: the renderer refuses every half-open door", () => {
	const dir = mkdtempSync(join(tmpdir(), "render-entitlements-"));
	try {
		// A profile path that does not exist: there is nothing to authorize the
		// claim, so the build stops rather than signing one.
		const missingProfile = spawnSync(
			process.execPath,
			[
				"scripts/render-mac-entitlements.mjs",
				"--out",
				join(dir, "never.plist"),
				"--team-id",
				TEAM_ID,
				"--profile",
				join(dir, "absent.provisionprofile"),
			],
			{ encoding: "utf8" },
		);
		assert.notEqual(missingProfile.status, 0);
		assert.match(
			missingProfile.stderr,
			/does not name a readable provisioning profile/,
		);
		assert.ok(!existsSync(join(dir, "never.plist")));

		// A team id is still required on the profile path, so a mistyped secret
		// cannot render a group nothing can match.
		const noTeam = spawnSync(
			process.execPath,
			[
				"scripts/render-mac-entitlements.mjs",
				"--out",
				join(dir, "never2.plist"),
				"--profile",
				join(dir, "absent.provisionprofile"),
			],
			{ env: { ...process.env, APPLE_TEAM_ID: "" }, encoding: "utf8" },
		);
		assert.notEqual(noTeam.status, 0);
		assert.match(noTeam.stderr, /APPLE_TEAM_ID is missing/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the profile's allowlist decides, and a disagreement is a refusal", () => {
	/*
	 * The profile-present half of the contract, driven with a synthetic dump
	 * because a real Developer ID profile exists only on the release runner. What
	 * is being asserted is the agreement between the value that would be signed in
	 * and the value the profile authorizes: a mismatch is refused at spawn on the
	 * user's machine and looks identical in the build log.
	 */
	const dir = mkdtempSync(join(tmpdir(), "render-entitlements-"));
	try {
		const profile = join(dir, "embedded.provisionprofile");
		writeFileSync(profile, "synthetic CMS container\n");
		const group = webauthnKeychainAccessGroup(TEAM_ID, "com.local-operator");
		const dump = (groups) => () => ({
			status: 0,
			stdout: `<plist><dict><key>Entitlements</key><dict><key>keychain-access-groups</key><array>${groups
				.map((value) => `<string>${value}</string>`)
				.join("")}</array></dict></dict></plist>`,
			stderr: "",
		});
		assert.deepEqual(profileKeychainGroups(profile, dump([group])), [group]);
		assert.deepEqual(
			profileKeychainGroups(profile, dump([group, "OTHER.thing.shared"])),
			[group, "OTHER.thing.shared"],
		);
		assert.deepEqual(profileKeychainGroups(profile, dump([])), []);
		assert.deepEqual(
			profileKeychainGroups(
				profile,
				dump([`${TEAM_ID}.com.somebody-else.webauthn`]),
			),
			[`${TEAM_ID}.com.somebody-else.webauthn`],
		);
		// "We could not ask" is not "the profile authorizes nothing": a profile
		// that cannot be unwrapped stops the build rather than rendering blindly.
		assert.throws(
			() =>
				profileKeychainGroups(profile, () => ({
					status: 1,
					stdout: "",
					stderr: "SecPolicyCreateBasicX509: unable to decode",
				})),
			/security cms -D could not read/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the release gate accepts a rendered group and refuses a signature without one", () => {
	/*
	 * Reviewer round 1, finding 6. The renderer fails closed and the workflow
	 * asserts its ordering, but nothing looked at the SIGNED artifact — and every
	 * failure downstream of a missing entitlement is silent by design (the app logs
	 * one line and stays inert), so a release could ship a passkey feature that can
	 * never work with nothing in the pipeline saying so. The check reads the shape
	 * rather than the value, because the team id is a release secret this gate does
	 * not have.
	 */
	const group = webauthnKeychainAccessGroup(TEAM_ID, "com.local-operator");
	const rendered = renderEntitlementsPlist(COMMITTED, [group]);
	assert.equal(hasWebauthnEntitlement(rendered, "com.local-operator"), true);
	// Without the bundle id the check falls back to the group's shape, and says so
	// in its own description (the app's Info.plist is what supplies the id).
	assert.equal(hasWebauthnEntitlement(rendered), true);

	// An ad-hoc signature prints nothing at all for `-d --entitlements - --xml`
	// (measured), which is the case this has to catch rather than accept.
	assert.equal(hasWebauthnEntitlement(""), false);
	// Entitlements that carry other keys but no keychain group are refused too.
	assert.equal(
		hasWebauthnEntitlement(
			"<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>",
		),
		false,
	);
	// A group with no `.webauthn` suffix is not the group the runtime requires.
	assert.equal(
		hasWebauthnEntitlement(
			"<key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.shared</string></array>",
		),
		false,
	);

	/*
	 * The check is bound to the app's OWN bundle id and to the keychain array
	 * itself (agent review round 2, R4): the old pattern walked past the array's
	 * close and accepted any `.webauthn` string anywhere after it, so a release
	 * whose group was rendered for a different bundle — or present in another
	 * array — passed a gate whose whole purpose is catching exactly that.
	 */
	assert.equal(
		hasWebauthnEntitlement(
			"<key>keychain-access-groups</key><array><string>AB12CD34EF.com.somebody-else.webauthn</string></array>",
			"com.local-operator",
		),
		false,
	);
	assert.equal(
		hasWebauthnEntitlement(
			"<key>another-feature</key><array><string>AB12CD34EF.com.local-operator.webauthn</string></array><key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.shared</string></array>",
			"com.local-operator",
		),
		false,
	);
	// The runtime's own group passes with the bundle id in hand, which is the
	// positive case that makes the two above discriminating rather than vacuous.
	assert.equal(
		hasWebauthnEntitlement(
			`<key>keychain-access-groups</key><array><string>${group}</string></array>`,
			"com.local-operator",
		),
		true,
	);
});

/**
 * A profile dump in the shape `security cms -D` prints for a Developer ID
 * profile: the authorizations live in the `Entitlements` dict, with keychain
 * groups as an array and the two identity claims as strings.
 */
function developerIdProfileDump({
	groups = [`${TEAM_ID}.*`],
	applicationIdentifier = `${TEAM_ID}.com.local-operator`,
	teamIdentifier = TEAM_ID,
} = {}) {
	const entries = [];
	if (applicationIdentifier !== null)
		entries.push(
			`<key>${APPLICATION_IDENTIFIER_KEY}</key><string>${applicationIdentifier}</string>`,
		);
	if (groups !== null)
		entries.push(
			`<key>${KEYCHAIN_ACCESS_GROUPS_KEY}</key><array>${groups.map((g) => `<string>${g}</string>`).join("")}</array>`,
		);
	if (teamIdentifier !== null)
		entries.push(
			`<key>${TEAM_IDENTIFIER_KEY}</key><string>${teamIdentifier}</string>`,
		);
	return `<plist><dict><key>Name</key><string>synthetic</string><key>Entitlements</key><dict>${entries.join("")}</dict></dict></plist>`;
}

test("Apple's allowlist rule: exact or team-scoped wildcard, nothing wider", () => {
	/*
	 * Measured on the Radient Inc. organization's real Developer ID profiles: the
	 * only `keychain-access-groups` entry is `<TEAM_ID>.*`. The WebAuthn group is
	 * never listed by name, so the exact-match rule this replaced refused the one
	 * profile that authorizes it. The negatives are what keep the 0.29.6 brick
	 * out: another team's wildcard, a bare `*`, and wildcards that are not a
	 * dotted team stem are all refusals.
	 */
	const group = webauthnKeychainAccessGroup(TEAM_ID, "com.local-operator");
	assert.equal(profileEntryAuthorizes(group, group), true, "exact");
	assert.equal(profileEntryAuthorizes(`${TEAM_ID}.*`, group), true, "wildcard");
	assert.equal(
		profileEntryAuthorizes(`${TEAM_ID}.com.local-operator.*`, group),
		true,
		"a narrower wildcard still covers its own subtree",
	);
	assert.equal(
		profileEntryAuthorizes("ZZ99YY88XX.*", group),
		false,
		"another team's wildcard",
	);
	assert.equal(profileEntryAuthorizes("*", group), false, "bare *");
	assert.equal(profileEntryAuthorizes(".*", group), false, "bare .*");
	assert.equal(
		profileEntryAuthorizes(`${TEAM_ID}*`, group),
		false,
		"a wildcard that is not a dotted stem",
	);
	assert.equal(
		profileEntryAuthorizes(`${TEAM_ID}.*.*`, group),
		false,
		"a stem that itself carries a wildcard",
	);
	assert.equal(
		profileEntryAuthorizes(`${TEAM_ID}.*`, `${TEAM_ID}.*`),
		true,
		"a wildcard claim is matched only by the identical entry",
	);
	assert.equal(
		profileEntryAuthorizes(`${TEAM_ID}.com.*`, `${TEAM_ID}.*`),
		false,
	);
	assert.equal(profileEntryAuthorizes(`${TEAM_ID}.*`, `${TEAM_ID}.`), false);
	assert.equal(profileEntryAuthorizes(`${TEAM_ID}.*`, ""), false);
	assert.equal(profileEntryAuthorizes(undefined, group), false);
	assert.equal(profileAllowlistAuthorizes([], group), false);
	assert.equal(profileAllowlistAuthorizes(undefined, group), false);
	assert.equal(
		profileAllowlistAuthorizes(["ZZ99YY88XX.*", `${TEAM_ID}.*`], group),
		true,
	);
});

test("plistStringValues reads one key's strings, bounded at that key's value", () => {
	const dump = developerIdProfileDump({ groups: [`${TEAM_ID}.*`, "X.y"] });
	assert.deepEqual(plistStringValues(dump, KEYCHAIN_ACCESS_GROUPS_KEY), [
		`${TEAM_ID}.*`,
		"X.y",
	]);
	assert.deepEqual(plistStringValues(dump, TEAM_IDENTIFIER_KEY), [TEAM_ID]);
	assert.deepEqual(plistStringValues(dump, "com.apple.nope"), []);
	assert.deepEqual(plistStringValues("", KEYCHAIN_ACCESS_GROUPS_KEY), []);
	// The array's own close bounds the read: strings under the NEXT key are not
	// members of this one (agent review round 2, R4 on the release gate).
	assert.deepEqual(
		plistStringValues(
			"<key>keychain-access-groups</key><array></array><key>other</key><array><string>A.*</string></array>",
			KEYCHAIN_ACCESS_GROUPS_KEY,
		),
		[],
	);
});

test("a real Developer ID profile authorizes all three claims, and anything less renders nothing", () => {
	const claims = profileBackedClaims(TEAM_ID, "com.local-operator");
	assert.deepEqual(
		claims.map(([key]) => key),
		[
			KEYCHAIN_ACCESS_GROUPS_KEY,
			APPLICATION_IDENTIFIER_KEY,
			TEAM_IDENTIFIER_KEY,
		],
	);
	assert.deepEqual(unauthorizedClaims(developerIdProfileDump(), claims), []);

	// Each half-open door, refused by name and never by value.
	for (const [label, dump, expected] of [
		[
			"another team's wildcard",
			developerIdProfileDump({ groups: ["ZZ99YY88XX.*"] }),
			[KEYCHAIN_ACCESS_GROUPS_KEY],
		],
		[
			"a bare *",
			developerIdProfileDump({ groups: ["*"] }),
			[KEYCHAIN_ACCESS_GROUPS_KEY],
		],
		[
			"no keychain groups at all",
			developerIdProfileDump({ groups: null }),
			[KEYCHAIN_ACCESS_GROUPS_KEY],
		],
		[
			"a profile for another app",
			developerIdProfileDump({
				applicationIdentifier: `${TEAM_ID}.com.somebody-else`,
			}),
			[APPLICATION_IDENTIFIER_KEY],
		],
		[
			"a profile for another team",
			developerIdProfileDump({
				groups: ["ZZ99YY88XX.*"],
				applicationIdentifier: "ZZ99YY88XX.com.local-operator",
				teamIdentifier: "ZZ99YY88XX",
			}),
			[
				KEYCHAIN_ACCESS_GROUPS_KEY,
				APPLICATION_IDENTIFIER_KEY,
				TEAM_IDENTIFIER_KEY,
			],
		],
		[
			"no identity claims",
			developerIdProfileDump({
				applicationIdentifier: null,
				teamIdentifier: null,
			}),
			[APPLICATION_IDENTIFIER_KEY, TEAM_IDENTIFIER_KEY],
		],
	]) {
		const missing = unauthorizedClaims(dump, claims);
		assert.deepEqual(missing, expected, label);
		for (const key of missing) assert.doesNotMatch(key, new RegExp(TEAM_ID));
	}

	// The render: all three land in the MAIN plist, the committed keys survive,
	// and it is still one well-formed dict.
	const rendered = renderProfileBackedEntitlements(COMMITTED, claims);
	assert.deepEqual(plistStringValues(rendered, KEYCHAIN_ACCESS_GROUPS_KEY), [
		`${TEAM_ID}.com.local-operator.webauthn`,
	]);
	assert.deepEqual(plistStringValues(rendered, APPLICATION_IDENTIFIER_KEY), [
		`${TEAM_ID}.com.local-operator`,
	]);
	assert.deepEqual(plistStringValues(rendered, TEAM_IDENTIFIER_KEY), [TEAM_ID]);
	assert.match(rendered, /com\.apple\.security\.cs\.allow-jit/);
	assert.equal((rendered.match(/<\/dict>/g) ?? []).length, 1);
	// Idempotent, like the group render.
	assert.equal(renderProfileBackedEntitlements(rendered, claims), rendered);
	if (process.platform === "darwin") {
		const dir = mkdtempSync(join(tmpdir(), "render-entitlements-"));
		try {
			const out = join(dir, "rendered.plist");
			writeFileSync(out, rendered);
			const lint = spawnSync("/usr/bin/plutil", ["-lint", out], {
				encoding: "utf8",
			});
			assert.equal(lint.status, 0, `${lint.stdout}${lint.stderr}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("the release gate reads the profile by the same rule the renderer does", () => {
	const group = webauthnKeychainAccessGroup(TEAM_ID, "com.local-operator");
	const ask = (dump, bundleId = "com.local-operator", value = group) =>
		profileAuthorizes(dump, KEYCHAIN_ACCESS_GROUPS_KEY, bundleId, value);
	assert.equal(ask(developerIdProfileDump()), true, "team wildcard");
	assert.equal(
		ask(developerIdProfileDump({ groups: [group] })),
		true,
		"exact entry",
	);
	assert.equal(
		ask(developerIdProfileDump({ groups: ["ZZ99YY88XX.*"] })),
		false,
		"another team's wildcard",
	);
	assert.equal(ask(developerIdProfileDump({ groups: ["*"] })), false, "bare *");
	assert.equal(ask(developerIdProfileDump({ groups: [] })), false, "empty");
	assert.equal(ask(null), false, "no profile");
	// A wildcard covers every group of the team, but the gate still asks about
	// THIS app's group: a claim for another bundle is not this app's passkeys.
	assert.equal(
		ask(
			developerIdProfileDump(),
			"com.local-operator",
			`${TEAM_ID}.com.somebody-else.webauthn`,
		),
		false,
	);
});
