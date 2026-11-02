#!/usr/bin/env node
/**
 * Which macOS entitlements a signature may carry without an embedded
 * provisioning profile, read from the app's own definition of it.
 *
 * WHY THIS EXISTS. v0.29.6 signed `keychain-access-groups` into every
 * executable of the app and embedded no profile. Per Apple's TN3125 a
 * *restricted* entitlement must be authorized by a provisioning profile, so
 * amfid refused every Mach-O in the bundle at exec with
 * `AppleMobileFileIntegrityError Code=-413 "No matching profile found"`: the app
 * could not be launched at all, and neither could the ShipIt that was supposed
 * to relaunch it. `codesign --verify --deep --strict`, `spctl -a -vvv -t exec`
 * and `stapler validate` all passed on that bundle, because none of them asks
 * whether a claimed entitlement is authorized. Three places have to agree about
 * that rule — the release gate (`scripts/verify-macos-artifacts.mjs`) and the
 * app's own update pre-flight (`src/main/update-install.ts`) — and two copies of
 * a security rule is how the heal and the gate drifted apart before (see
 * `scripts/bundled-runtime-layout.mjs`, which exists for the same reason).
 *
 * WHY A LIST OF UNRESTRICTED SPELLINGS RATHER THAN OF RESTRICTED ONES. TN3125
 * names the *unrestricted* families (the App Sandbox, the hardened runtime,
 * `get-task-allow`, `application-groups`) and then says everything else must be
 * authorized by a profile. A list of restricted keys would therefore pass
 * silently on the next restricted entitlement somebody adds; this predicate
 * fails closed instead — an unrecognised key is reported as profile-backed, so
 * the remedy is a deliberate entry here, not a shipped brick.
 *
 * The app imports the same JSON (`src/shared/macos-entitlement-policy.json`), so
 * a spelling can only be wrong in one place at a time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const POLICY = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../src/shared/macos-entitlement-policy.json", import.meta.url),
		),
		"utf8",
	),
);

/** Where macOS looks for the profile that authorizes a restricted claim. */
export const EMBEDDED_PROVISIONING_PROFILE_PATH =
	POLICY.embeddedProvisioningProfilePath;

/** Whether one entitlement key needs a provisioning profile behind it.
 *
 * Exported separately from the scan below because a caller holding a single key
 * (a build step reading its own plist) asks the same question as one scanning a
 * signature. */
export function isProfileBackedEntitlement(key) {
	if (POLICY.unrestrictedEntitlementKeys.includes(key)) return false;
	return !POLICY.unrestrictedEntitlementPrefixes.some((prefix) =>
		key.startsWith(prefix),
	);
}

/**
 * Whether one profile allowlist entry authorizes one claimed value, by Apple's
 * matching rule: equal, or a wildcard entry ending in `*` whose prefix starts
 * the value.
 *
 * WHY A RULE AND NOT `===`. A Developer ID provisioning profile does not list
 * the keychain access groups it authorizes one by one: measured with
 * `security cms -D` on the Radient Inc. organization's real profiles (the
 * desktop app's and the key agent's), `keychain-access-groups` is the single
 * wildcard `<TEAM_ID>.*`, which is how the developer portal issues every
 * Developer ID profile. An exact-match check therefore refused the one profile
 * that can authorize the WebAuthn group, and the door to passkeys stayed shut for
 * a reason that was ours rather than Apple's.
 *
 * WHAT IT STILL REFUSES, which is what keeps the 0.29.6 brick out:
 *   - a different team's wildcard (`OTHERTEAM1.*` does not start our group);
 *   - a bare `*`, or any wildcard whose prefix is not a dotted team-scoped stem
 *     (`<prefix>.*`). Apple issues only team-prefixed wildcards in Developer ID
 *     profiles, so a bare `*` is not a profile this pipeline has ever been given,
 *     and treating it as "authorizes everything" is the one reading that could
 *     sign in a claim amfid then refuses. Refusing it costs nothing real;
 *   - a claimed value that itself contains `*`: a signature claims concrete
 *     values, and a wildcard claim is matched only by an identical entry.
 *
 * ONE COPY. The release-time renderer (`scripts/render-mac-entitlements.mjs`)
 * and the release gate (`scripts/verify-macos-artifacts.mjs`) both ask "does the
 * profile authorize this value", and two spellings of that answer are how a
 * build the renderer accepted could be failed by the gate, or the reverse.
 */
export function profileEntryAuthorizes(entry, value) {
	if (typeof entry !== "string" || typeof value !== "string") return false;
	if (!entry || !value) return false;
	if (entry === value) return true;
	if (!entry.endsWith(".*")) return false;
	const stem = entry.slice(0, -1);
	if (stem === "." || stem.includes("*") || value.includes("*")) return false;
	return value.startsWith(stem) && value.length > stem.length;
}

/** Whether any entry of a profile allowlist authorizes `value`
 * (`profileEntryAuthorizes` over the list). */
export function profileAllowlistAuthorizes(entries, value) {
	return (entries ?? []).some((entry) => profileEntryAuthorizes(entry, value));
}

/**
 * The string values a plist holds for `key`: the members of its `<array>`, or the
 * one `<string>` when the value is scalar; `[]` when the key is absent.
 *
 * Read from the text that `security cms -D` (a profile) or `codesign -d
 * --entitlements - --xml` (a signature) prints, and BOUNDED at the value's own
 * close: an open-ended walk leaves the array it started in and picks up strings
 * from whatever key follows (agent review round 2, R4 on the release gate). Only
 * the first occurrence of the key is read; a profile's dump names each
 * entitlement once, inside its `Entitlements` dict.
 */
export function plistStringValues(plistText, key) {
	const text = String(plistText ?? "");
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`<key>${escaped}</key>\\s*(?:<array>([\\s\\S]*?)</array>|<string>([^<]*)</string>)`,
	).exec(text);
	if (!match) return [];
	if (match[2] !== undefined) return [match[2].trim()];
	return [...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map(([, value]) =>
		value.trim(),
	);
}

/**
 * Every entitlement key an entitlements plist claims that needs a profile.
 *
 * The scan reads `<key>` names only: the question is WHICH entitlements are
 * claimed, not what they are set to, and a plist's booleans, strings and arrays
 * all spell their key the same way. An empty string is what
 * `codesign -d --entitlements - --xml` prints for a signature that carries no
 * entitlements at all (measured on an ad-hoc signed bundle), which is the
 * "nothing claimed" case rather than a parse failure.
 */
export function profileBackedEntitlementKeys(plistText) {
	const keys = [];
	for (const [, key] of String(plistText ?? "").matchAll(
		/<key>([^<]+)<\/key>/g,
	)) {
		if (isProfileBackedEntitlement(key) && !keys.includes(key)) keys.push(key);
	}
	return keys;
}
