#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Render the macOS entitlements plist a SIGNED build is codesigned with, by
 * injecting the WebAuthn keychain access group from the CI team id.
 *
 * WHY THIS EXISTS, and why it is a render step rather than a committed value.
 * Electron's platform authenticator (`app.configureWebAuthn({ touchID: { … } })`)
 * stores credentials in the macOS keychain under a keychain access group of the
 * form `<TEAM_ID>.<BUNDLE_ID>.webauthn`, and Electron REFUSES to service the
 * authenticator unless that exact value is also present in the app's
 * `keychain-access-groups` code-signing entitlement. The team id is a CI secret
 * (`APPLE_TEAM_ID`), so it cannot live in a committed plist — and a placeholder
 * would be worse than nothing: the app would configure an authenticator under a
 * group its signature does not carry, which is the case measured to leave
 * `navigator.credentials.create()` never settling at all (see
 * `src/main/webauthn.ts`, and docs/design/browser-challenges-and-passkeys.md).
 *
 * WHY THE WORKFLOW RENDERS IT RATHER THAN electron-builder. Measured in this
 * tree's own dependency: `app-builder-lib` resolves `mac.entitlements` to a path
 * (`out/mac/MacTargetHelper.js`) and hands the FILE to `@electron/osx-sign`,
 * which reads it as a plist and passes it to codesign. There is no macro
 * expansion in that path — a `${…}` in the plist would ship literally — so the
 * value has to be rendered before the build starts.
 *
 * WHAT PREVENTS THE 0.29.6 BRICK. `keychain-access-groups` is a RESTRICTED
 * entitlement: Apple's TN3125 says it must be authorized by a provisioning
 * profile embedded in the bundle, and without one amfid refuses to spawn every
 * Mach-O that claims it (`-413 "No matching profile found"`) while `codesign
 * --verify`, `spctl` and `stapler validate` all still pass. 0.29.6 rendered this
 * plist and embedded no profile, so the app could not be launched at all and the
 * ShipIt that should have relaunched it was refused too. This script therefore
 * refuses to emit the group unless it is given the profile that authorizes it
 * (`--profile`), and refuses a profile that does not cover the exact group being
 * rendered — the door to passkeys is one secret wide, and it cannot be opened
 * half way.
 *
 * "COVER", NOT "LIST". A real Developer ID profile authorizes keychain groups
 * with Apple's team wildcard (`<TEAM_ID>.*`), never by naming each one, so the
 * question is asked through `profileAllowlistAuthorizes` in
 * `scripts/macos-entitlement-policy.mjs` — the one copy of Apple's matching rule,
 * shared with the release gate. Another team's wildcard and a bare `*` are still
 * refusals.
 *
 * THE APP'S IDENTITY CLAIMS RIDE WITH THE GROUP. With a profile, the main
 * executable is also signed with `com.apple.application-identifier`
 * (`<TEAM_ID>.<BUNDLE_ID>`) and `com.apple.developer.team-identifier`, which is
 * what Xcode signs into every profile-backed Developer ID app: the keychain's
 * access-group machinery keys on the application identifier, and a profile that
 * authorizes a group for an app whose signature names no application identifier
 * is not a combination Apple's own tooling ever produces. `@electron/osx-sign`
 * would not add them for us — its `preAutoEntitlements` returns early unless
 * the App Sandbox is on, and this app is not sandboxed. Each of the three is
 * rendered only when the profile authorizes that exact value, and a profile that
 * authorizes any one of them but not all three is a refusal rather than a
 * partial render: half a door is the shape that silently never works.
 *
 * WHAT A LOCAL BUILD GETS: nothing. `pnpm dist:mac` on a developer machine keeps
 * using the committed `build/entitlements.mac.plist` (no group), stays ad-hoc
 * signed, and the app stays inert for passkeys (it logs the reason).
 *
 * `publish.yml` and `signed-update-candidate.yml` call it with the Developer ID
 * profile decoded from `MACOS_APP_PROFILE_BASE64` and hand the result to
 * `-c.mac.entitlements` only; the comment above `publish.yml`'s Build macOS app
 * step is the authority for that wiring and for rotating the profile.
 *
 * Usage:
 *   node scripts/render-mac-entitlements.mjs --out <path> \
 *     [--source build/entitlements.mac.plist] [--team-id <id>] [--bundle-id <id>] \
 *     [--profile <embedded.provisionprofile>]
 *
 * `--team-id` defaults to $APPLE_TEAM_ID and `--bundle-id` to `build.appId` in
 * package.json, so a pipeline only has to name the output path. Without
 * `--profile` the output is the committed plist unchanged: the app ships with no
 * restricted claim, and passkeys are inert rather than a brick.
 *
 * The rendered values are NEVER printed: each embeds the team id, which is a
 * secret, and this script's output is a CI log. What it prints is the count, the
 * key names and the destination.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";
import {
	plistStringValues,
	profileAllowlistAuthorizes,
} from "./macos-entitlement-policy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The suffix Electron documents for the WebAuthn keychain access group. */
export const WEBAUTHN_GROUP_SUFFIX = ".webauthn";

/** The entitlement key the group has to appear under. */
export const KEYCHAIN_ACCESS_GROUPS_KEY = "keychain-access-groups";

/** The app's identity claims a profile-backed Developer ID signature carries. */
export const APPLICATION_IDENTIFIER_KEY = "com.apple.application-identifier";
export const TEAM_IDENTIFIER_KEY = "com.apple.developer.team-identifier";

/**
 * Every restricted claim a profile-backed main executable is signed with, as
 * `[key, value, isArray]`, in the order they are written. The single list both
 * the authorization check and the render read, so a claim cannot be rendered
 * without first being checked against the profile.
 */
export function profileBackedClaims(teamId, bundleId) {
	return [
		[
			KEYCHAIN_ACCESS_GROUPS_KEY,
			webauthnKeychainAccessGroup(teamId, bundleId),
			true,
		],
		[APPLICATION_IDENTIFIER_KEY, `${teamId}.${bundleId}`, false],
		[TEAM_IDENTIFIER_KEY, teamId, false],
	];
}

/**
 * The keys of `claims` the profile's entitlements do NOT authorize, by Apple's
 * matching rule (`profileAllowlistAuthorizes`). Empty means every claim is
 * covered. Returns keys, never values: the caller's message lands in a CI log.
 */
export function unauthorizedClaims(profileEntitlementsText, claims) {
	return claims
		.filter(
			([key, value]) =>
				!profileAllowlistAuthorizes(
					plistStringValues(profileEntitlementsText, key),
					value,
				),
		)
		.map(([key]) => key);
}

/**
 * Set one scalar string entitlement, replacing an existing value. Same string
 * surgery and the same refusal on a plist with no `</dict>` as the group below,
 * for the same reasons.
 */
export function renderStringEntitlement(plist, key, value) {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const existing = new RegExp(
		`<key>${escaped}</key>\\s*<string>[^<]*</string>`,
	);
	const block = `<key>${key}</key>\n    <string>${value}</string>`;
	if (existing.test(plist)) return plist.replace(existing, block);
	const insertion = plist.lastIndexOf("</dict>");
	if (insertion === -1) {
		throw new Error(
			`the entitlements plist has no </dict>, so ${key} could not be injected`,
		);
	}
	// The indentation that precedes `</dict>` is dropped and re-emitted, so a key
	// inserted after an earlier insertion lines up with it rather than drifting.
	const head = plist.slice(0, insertion).replace(/[ \t]*$/, "");
	return `${head}    ${block}\n  ${plist.slice(insertion)}`;
}

/** Render every claim of `profileBackedClaims` into `plist`. */
export function renderProfileBackedEntitlements(plist, claims) {
	let rendered = plist;
	for (const [key, value, isArray] of claims) {
		rendered =
			key === KEYCHAIN_ACCESS_GROUPS_KEY && isArray
				? renderEntitlementsPlist(rendered, [value])
				: renderStringEntitlement(rendered, key, value);
	}
	return rendered;
}

/**
 * `<TEAM_ID>.<BUNDLE_ID>.webauthn`, the only place this shape is written here.
 * Kept as a function so the test asserts the same construction the pipeline
 * uses rather than a copy of it.
 */
export function webauthnKeychainAccessGroup(teamId, bundleId) {
	return `${teamId}.${bundleId}${WEBAUTHN_GROUP_SUFFIX}`;
}

/**
 * Put `groups` into a plist's `keychain-access-groups` array, replacing any
 * existing value.
 *
 * String surgery rather than a plist library: the input is a committed file
 * whose shape is asserted by the tests, the insertion point is one `</dict>`,
 * and the alternative is a build-time dependency for one array. It THROWS when
 * the plist has no `</dict>` rather than silently writing a plist without the
 * group — a signature missing the entitlement looks exactly like a working build
 * until someone tries to use a passkey.
 */
export function renderEntitlementsPlist(plist, groups) {
	if (groups.length === 0) {
		throw new Error("renderEntitlementsPlist needs at least one access group");
	}
	// The entitlement is an ARRAY of groups, not a string: `keychain-access-groups`
	// holding a bare `<string>` is a plist codesign would accept and macOS would
	// read as something other than what Electron compares against. The first
	// version of this function emitted exactly that, which is what the test beside
	// it caught.
	const block = `<key>${KEYCHAIN_ACCESS_GROUPS_KEY}</key>
    <array>
${groups.map((group) => `      <string>${group}</string>`).join("\n")}
    </array>`;
	// Matches whichever shape is already there — an array, or the bare string a
	// hand-edited plist might carry — so a second render replaces rather than
	// appends.
	const existing = new RegExp(
		`<key>${KEYCHAIN_ACCESS_GROUPS_KEY}</key>\\s*(?:<array>[\\s\\S]*?</array>|<string>[^<]*</string>)`,
	);
	if (existing.test(plist)) {
		return plist.replace(existing, block);
	}
	const insertion = plist.lastIndexOf("</dict>");
	if (insertion === -1) {
		throw new Error(
			"the entitlements plist has no </dict>, so the access group could not be injected",
		);
	}
	return `${plist.slice(0, insertion)}    ${block}\n  ${plist.slice(insertion)}`;
}

/** A team id is ten upper-case alphanumerics. Checked because a mistyped or
 * empty secret would otherwise render a group nothing can match, and the failure
 * would surface as "passkeys do nothing" on a shipped build. */
export function assertTeamId(teamId) {
	if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
		throw new Error(
			"APPLE_TEAM_ID is missing or is not a ten-character team id; refusing to render an entitlements plist that would ship a passkey group no signature carries",
		);
	}
	return teamId;
}

export function assertBundleId(bundleId) {
	if (!bundleId || !bundleId.includes(".")) {
		throw new Error(
			`the bundle id (${bundleId ?? "missing"}) does not look like a bundle identifier; refusing to render`,
		);
	}
	return bundleId;
}

/**
 * The keychain access groups a provisioning profile authorizes.
 *
 * Why the profile is read rather than trusted: the profile's allowlist and the
 * signature's claim have to agree EXACTLY, and when they disagree the outcome is
 * either a refusal at spawn or a feature that silently never works — both are
 * invisible in a build log. `security cms -D` is the OS's own way to unwrap the
 * CMS container, and the group is looked up in the same bounded
 * `keychain-access-groups` array a signature carries.
 *
 * Throws rather than returning an empty list when the profile cannot be read:
 * "we could not ask" must not be reported as "the profile authorizes nothing",
 * because only one of those is a reason to stop the build.
 */
export function profileKeychainGroups(profilePath, run = defaultProfileReader) {
	return plistStringValues(
		profileEntitlementsDump(profilePath, run),
		KEYCHAIN_ACCESS_GROUPS_KEY,
	);
}

/**
 * The profile unwrapped by `security cms -D`, as plist text. Throws when the
 * profile is missing or cannot be unwrapped, for the reason given above
 * `profileKeychainGroups`.
 */
export function profileEntitlementsDump(
	profilePath,
	run = defaultProfileReader,
) {
	if (!profilePath || !existsSync(profilePath)) {
		throw new Error(
			`--profile ${profilePath ?? "(missing)"} does not name a readable provisioning profile; refusing to render a restricted entitlement no profile can authorize`,
		);
	}
	const dump = run(profilePath);
	if (dump.status !== 0) {
		throw new Error(
			`security cms -D could not read ${profilePath}: ${(dump.stderr ?? "").trim() || "no output"}`,
		);
	}
	return dump.stdout ?? "";
}

/** Runs `security cms -D -i <path>`; injectable so the profile-side contract can
 * be tested with a synthetic dump on a machine that has no Developer ID profile
 * (which is every machine that is not the release runner). */
export function defaultProfileReader(profilePath) {
	return spawnSync("/usr/bin/security", ["cms", "-D", "-i", profilePath], {
		encoding: "utf8",
	});
}

function argValue(argv, name) {
	const index = argv.indexOf(name);
	return index === -1 ? null : (argv[index + 1] ?? null);
}

/** The bundle id the packaging config will sign the app as. Read from
 * package.json rather than passed twice, so the group and the signature cannot
 * describe different apps. */
export function bundleIdFromPackage(root = ROOT) {
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const appId = pkg?.build?.appId;
	return typeof appId === "string" && appId ? appId : null;
}

async function main() {
	const argv = process.argv.slice(2);
	const out = argValue(argv, "--out");
	if (!out) {
		throw new Error("--out <path> is required");
	}
	const source = resolve(
		ROOT,
		argValue(argv, "--source") ?? "build/entitlements.mac.plist",
	);
	const plist = readFileSync(source, "utf8");
	const destination = resolve(out);
	mkdirSync(dirname(destination), { recursive: true });

	/*
	 * No profile, no claim — the shipped default.
	 *
	 * The plist is written as committed and the run says what that means: the
	 * signature carries no restricted entitlement, so macOS spawns the app, and
	 * Electron's touchID authenticator is inert (`decideWebauthnGate` logs one
	 * line and never calls configureWebAuthn). Writing the group here without a
	 * profile is the arrangement that bricked 0.29.6, so there is no path in this
	 * script that does it.
	 */
	const profile = argValue(argv, "--profile");
	if (!profile) {
		writeFileSync(destination, plist);
		console.log(
			`render-mac-entitlements: wrote the committed entitlements (no keychain access group, no provisioning profile) to ${destination}; the app ships launchable and passkeys stay inert`,
		);
		return;
	}

	const teamId = assertTeamId(
		argValue(argv, "--team-id") ?? process.env.APPLE_TEAM_ID,
	);
	const bundleId = assertBundleId(
		argValue(argv, "--bundle-id") ?? bundleIdFromPackage(),
	);
	const claims = profileBackedClaims(teamId, bundleId);
	// The profile has to authorize EVERY claim before any of them is signed in: a
	// signature and an allowlist that disagree is refused at spawn, and the build
	// log would look the same either way. All three or none — a render that
	// carried the group without the application identifier, or the reverse, is
	// the half-open door this script exists to keep shut.
	const missing = unauthorizedClaims(
		profileEntitlementsDump(resolve(profile)),
		claims,
	);
	if (missing.length > 0) {
		throw new Error(
			`the provisioning profile at ${profile} does not authorize ${missing.join(", ")} for this build's team and bundle id; refusing to render restricted entitlements the profile does not cover`,
		);
	}
	const rendered = renderProfileBackedEntitlements(plist, claims);
	writeFileSync(destination, rendered);
	// The VALUES are not printed: each embeds the team id. The destination, the
	// count and the key names are what a reader needs to see that this ran.
	const entitlementCount = (rendered.match(/<key>/g) ?? []).length;
	console.log(
		`render-mac-entitlements: wrote ${entitlementCount} entitlements, including ${claims.map(([key]) => key).join(", ")} authorized by ${profile}, to ${destination}`,
	);
}

/*
 * Only when run as a program: the module is imported by its test.
 *
 * Through the SHARED helper rather than a hand-written entry-point comparison,
 * because the failure one of those produces is silent: through a symlinked
 * directory (`/tmp` on macOS, the ordinary case) the two spellings disagree, this
 * file loads, `main()` never runs, nothing is printed and the process exits 0 - a
 * CI log that says the entitlements were rendered when nothing rendered them. See
 * `scripts/entry-point.mjs`, and `scripts/entry-point.test.mjs`, which drives this
 * script's CLI in both spellings.
 */
if (isEntryPoint(import.meta.url)) {
	await main();
}
