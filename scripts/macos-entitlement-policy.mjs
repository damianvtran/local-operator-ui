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
 * `scripts/bundled-python-layout.mjs`, which exists for the same reason).
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
