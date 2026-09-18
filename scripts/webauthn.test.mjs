/**
 * Tests for the WebAuthn half: the signature gate, the entitlement parse, the
 * installer and the discoverable-credential chooser.
 *
 * WHAT THESE ARE, AND WHAT THEY ARE NOT. The shipped TypeScript is bundled in
 * memory with esbuild and driven directly; Electron is a stub (see
 * `browser-electron-stub.ts`), and no signature, keychain or Touch ID sheet is
 * involved. So what is tested here is the RULE: which facts enable the platform
 * authenticator, what is passed when they do, that nothing is passed when they do
 * not, and that every path of the chooser settles the page's callback exactly
 * once. What is NOT tested here — and cannot be, on a machine with no signing
 * identity — is that the OS sheet appears on a signed build. The evidence for
 * that is stated as owed in docs/design/browser-challenges-and-passkeys.md.
 *
 * The codesign samples are shaped like the real output measured on this machine
 * (Electron 44.3.0, macOS 25.6.0): `codesign -dv --verbose=4` prints
 * `Identifier=` and, for a team-signed bundle, `TeamIdentifier=` on its own
 * lines, and an ad-hoc signature prints no `TeamIdentifier=` line at all;
 * `codesign -d --entitlements :-` prints a single-line XML plist, and NOTHING
 * when the signature carries no entitlements. The values are synthetic.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/webauthn";',
			'export * from "./src/renderer/src/features/browser/model/webauthn-chooser";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	WEBAUTHN_CHOOSER_TIMEOUT_MS,
	WEBAUTHN_GROUP_SUFFIX,
	WEBAUTHN_PROMPT_REASON,
	WebauthnChooser,
	appBundlePathFromExecutable,
	decideWebauthnGate,
	installWebauthn,
	parseBundleIdentifier,
	parseKeychainAccessGroups,
	parseTeamIdentifier,
	readAppSignature,
	webauthnKeychainAccessGroup,
	accountChoiceDetail,
	accountChoiceLabel,
} = mod;

/** A team-signed bundle's report, as `codesign -dv --verbose=4` prints it. */
const SIGNED_REPORT = [
	"Executable=/Applications/Local Operator.app/Contents/MacOS/Local Operator",
	"Identifier=com.local-operator",
	"Format=app bundle with Mach-O thin (arm64)",
	"CodeDirectory v=20500 size=24995 flags=0x10000(runtime) hashes=771+3 location=embedded",
	"Signature size=8972",
	"Authority=Developer ID Application: Example Corp (AB12CD34EF)",
	"TeamIdentifier=AB12CD34EF",
	"Sealed Resources version=2 rules=13 files=278",
].join("\n");

/** An ad-hoc signature's report: no Authority, no TeamIdentifier line. */
const ADHOC_REPORT = [
	"Executable=/Applications/Local Operator.app/Contents/MacOS/Local Operator",
	"Identifier=Electron",
	"Format=app bundle with Mach-O thin (arm64)",
	"CodeDirectory v=20400 size=392 flags=0x20002(adhoc,linker-signed) hashes=9+0 location=embedded",
	"Signature=adhoc",
	"Info.plist=not bound",
].join("\n");

/** Entitlements as `codesign -d --entitlements :-` prints them with the group. */
const ENTITLEMENTS_WITH_GROUP =
	'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
	"<key>com.apple.security.cs.allow-jit</key><true/>" +
	"<key>keychain-access-groups</key><array><string>AB12CD34EF.com.local-operator.webauthn</string><string>AB12CD34EF.com.local-operator.shared</string></array>" +
	"<key>com.apple.security.network.client</key><true/></dict></plist>";

/** The shipped signature today: entitlements, but no access group. */
const ENTITLEMENTS_WITHOUT_GROUP =
	'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>';

const facts = (overrides = {}) => ({
	platform: "darwin",
	packaged: true,
	bundlePath: "/Applications/Local Operator.app",
	bundleIdentifier: "com.local-operator",
	teamIdentifier: "AB12CD34EF",
	keychainAccessGroups: ["AB12CD34EF.com.local-operator.webauthn"],
	unreadable: null,
	...overrides,
});

test("the keychain access group is <TEAM_ID>.<BUNDLE_ID>.webauthn", () => {
	assert.equal(
		webauthnKeychainAccessGroup("AB12CD34EF", "com.local-operator"),
		"AB12CD34EF.com.local-operator.webauthn",
	);
	assert.equal(WEBAUTHN_GROUP_SUFFIX, ".webauthn");
});

test("the bundle path is derived from the executable, not from app.getAppPath()", () => {
	assert.equal(
		appBundlePathFromExecutable(
			"/Applications/Local Operator.app/Contents/MacOS/Local Operator",
		),
		"/Applications/Local Operator.app",
	);
	// A dev tree is not a bundle: the answer is the path itself, which the gate
	// never reaches because `packaged` is false first.
	assert.equal(
		appBundlePathFromExecutable(
			"/Users/someone/tree/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
		),
		"/Users/someone/tree/node_modules/electron/dist/Electron.app",
	);
	assert.equal(
		appBundlePathFromExecutable("/usr/local/bin/node"),
		"/usr/local/bin/node",
	);
});

test("TeamIdentifier and Identifier are parsed from the real report shape", () => {
	assert.equal(parseTeamIdentifier(SIGNED_REPORT), "AB12CD34EF");
	assert.equal(parseBundleIdentifier(SIGNED_REPORT), "com.local-operator");
	// An ad-hoc bundle prints neither an Authority nor a TeamIdentifier line: the
	// gate's "no team id" arm, measured on this machine's Electron.
	assert.equal(parseTeamIdentifier(ADHOC_REPORT), null);
	assert.equal(parseBundleIdentifier(ADHOC_REPORT), "Electron");
	// codesign's own spelling for "the signature has no team".
	assert.equal(
		parseTeamIdentifier("Identifier=x\nTeamIdentifier=not set\n"),
		null,
	);
});

test("keychain access groups are parsed from the entitlements plist", () => {
	assert.deepEqual(parseKeychainAccessGroups(ENTITLEMENTS_WITH_GROUP), [
		"AB12CD34EF.com.local-operator.webauthn",
		"AB12CD34EF.com.local-operator.shared",
	]);
	// The shipped app: entitlements present, none of them this one.
	assert.deepEqual(parseKeychainAccessGroups(ENTITLEMENTS_WITHOUT_GROUP), []);
	// An ad-hoc signature prints NOTHING for `-d --entitlements :-` (measured):
	// that is "entitlement absent", not a parse failure.
	assert.deepEqual(parseKeychainAccessGroups(""), []);
	// A malformed tail must not be read as a group.
	assert.deepEqual(
		parseKeychainAccessGroups("<key>keychain-access-groups</key><array>"),
		[],
	);
});

test("the gate names the first fact that is wrong, in order", () => {
	assert.equal(
		decideWebauthnGate(facts({ platform: "linux" })).reason,
		"not darwin",
	);
	assert.equal(
		decideWebauthnGate(facts({ packaged: false })).reason,
		"unpackaged",
	);
	assert.equal(
		decideWebauthnGate(facts({ unreadable: "codesign -dv failed: ENOENT" }))
			.reason,
		"signature unreadable",
	);
	assert.equal(
		decideWebauthnGate(facts({ bundleIdentifier: null })).reason,
		"no bundle id",
	);
	const noTeam = decideWebauthnGate(facts({ teamIdentifier: null }));
	assert.equal(noTeam.reason, "no team id");
	assert.equal(noTeam.group, null);
	const absent = decideWebauthnGate(facts({ keychainAccessGroups: [] }));
	assert.equal(absent.reason, "entitlement absent");
	assert.equal(
		absent.group,
		"AB12CD34EF.com.local-operator.webauthn",
		"the group it would need is still named, so the log says what to add",
	);
	const mismatch = decideWebauthnGate(
		facts({ keychainAccessGroups: ["AB12CD34EF.other.webauthn"] }),
	);
	assert.equal(mismatch.reason, "entitlement mismatch");
	assert.match(mismatch.detail, /AB12CD34EF\.other\.webauthn/);
	assert.match(mismatch.detail, /AB12CD34EF\.com\.local-operator\.webauthn/);
	const enabled = decideWebauthnGate(facts());
	assert.equal(enabled.enabled, true);
	assert.equal(enabled.reason, "enabled");
});

test("the signature probe spawns codesign only for a packaged macOS bundle", async () => {
	const calls = [];
	const run = async (file, args) => {
		calls.push([file, args]);
		if (args[0] === "-dv") return { stdout: SIGNED_REPORT, stderr: "" };
		return { stdout: ENTITLEMENTS_WITH_GROUP, stderr: "" };
	};
	const packaged = await readAppSignature({
		platform: "darwin",
		packaged: true,
		execPath: "/Applications/Local Operator.app/Contents/MacOS/Local Operator",
		run,
	});
	assert.equal(packaged.teamIdentifier, "AB12CD34EF");
	assert.equal(packaged.bundlePath, "/Applications/Local Operator.app");
	assert.deepEqual(packaged.keychainAccessGroups, [
		"AB12CD34EF.com.local-operator.webauthn",
		"AB12CD34EF.com.local-operator.shared",
	]);
	assert.equal(calls.length, 2);
	// The entitlement read asks for XML on stdout, which is what makes the parse
	// above meaningful rather than accidental.
	assert.deepEqual(calls[1][1], [
		"-d",
		"--entitlements",
		":-",
		"/Applications/Local Operator.app",
	]);

	calls.length = 0;
	const unpackaged = await readAppSignature({
		platform: "darwin",
		packaged: false,
		execPath: "/Users/someone/tree/out/main/index.js",
		run,
	});
	assert.equal(unpackaged.packaged, false);
	assert.equal(calls.length, 0, "an unpackaged run spawns nothing at all");

	const broken = await readAppSignature({
		platform: "darwin",
		packaged: true,
		execPath: "/Applications/Local Operator.app/Contents/MacOS/Local Operator",
		run: async () => {
			throw new Error("codesign: command not found");
		},
	});
	assert.match(broken.unreadable, /codesign -dv failed/);
});

test("the installer configures the authenticator only when the signature carries the group", async () => {
	const logged = [];
	const configured = [];
	const install = (overrides = {}) =>
		installWebauthn({
			log: (message) => logged.push(message),
			facts: async () => facts(overrides),
			configure: (options) => configured.push(options),
		});

	const off = await install({ teamIdentifier: null });
	assert.equal(off.configured, false);
	assert.equal(configured.length, 0, "nothing is configured without a team id");
	assert.match(
		logged.at(-1),
		/^\[webauthn\] Touch ID passkeys are off: no team id — /,
	);

	const on = await install();
	assert.equal(on.configured, true);
	assert.deepEqual(configured, [
		{
			touchID: {
				keychainAccessGroup: "AB12CD34EF.com.local-operator.webauthn",
				promptReason: WEBAUTHN_PROMPT_REASON,
			},
		},
	]);
	// The prompt is a lowercase sentence fragment: macOS renders it as
	// `"<App Name>" is trying to <promptReason>`.
	assert.equal(WEBAUTHN_PROMPT_REASON, "use a passkey for $1");
	assert.match(
		logged.at(-1),
		/^\[webauthn\] Touch ID platform authenticator enabled/,
	);
});

test("the installer survives a configureWebAuthn that throws", async () => {
	const logged = [];
	const result = await installWebauthn({
		log: (message) => logged.push(message),
		facts: async () => facts(),
		configure: () => {
			throw new Error("no keychain item");
		},
	});
	assert.equal(result.configured, false);
	assert.equal(result.gate.enabled, false);
	assert.match(logged.at(-1), /configureWebAuthn failed — no keychain item/);
});

/** A chooser with a captured notify list and a deterministic id. */
function makeChooser(options = {}) {
	const notified = [];
	const logged = [];
	let next = 0;
	const chooser = new WebauthnChooser({
		notify: (request) => notified.push(request),
		log: (message) => logged.push(message),
		nextRequestId: () => `req-${++next}`,
		...options,
	});
	return { chooser, notified, logged };
}

const ACCOUNTS = [
	{
		credentialId: "Y3JlZC0x",
		displayName: "Ada Lovelace",
		name: "ada@example.test",
		userHandle: "dXNlci0x",
	},
	{ credentialId: "Y3JlZC0y", name: "grace@example.test" },
];

test("a multi-match request is surfaced with its accounts and answered with the choice", () => {
	const { chooser, notified, logged } = makeChooser();
	let answered;
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS, frame: null },
		(value) => {
			answered = value;
		},
	);
	assert.deepEqual(notified, [
		{
			requestId: "req-1",
			relyingPartyId: "example.test",
			accounts: [
				{
					credentialId: "Y3JlZC0x",
					displayName: "Ada Lovelace",
					name: "ada@example.test",
					userHandle: "dXNlci0x",
				},
				{
					credentialId: "Y3JlZC0y",
					displayName: null,
					name: "grace@example.test",
					userHandle: null,
				},
			],
		},
	]);
	assert.deepEqual(chooser.pendingRequestIds(), ["req-1"]);
	assert.equal(chooser.respond("req-1", "Y3JlZC0y"), true);
	assert.equal(
		answered,
		"Y3JlZC0y",
		"the chosen credential id reaches Electron",
	);
	assert.equal(
		logged.some((line) => line.includes("grace@example.test")),
		true,
	);
	assert.deepEqual(chooser.pendingRequestIds(), []);
	// Exactly once: an answer that arrives twice must not call the callback again,
	// which would settle a promise Electron already settled.
	assert.equal(chooser.respond("req-1", "Y3JlZC0x"), false);
	assert.equal(answered, "Y3JlZC0y");
});

test("a request with no account, a dismissal and an unknown request id all settle with nothing", () => {
	const { chooser, notified, logged } = makeChooser();
	let emptyArgs = "unset";
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: [] },
		(...args) => {
			emptyArgs = args;
		},
	);
	assert.equal(
		notified.length,
		0,
		"nothing is surfaced when there is nothing to choose",
	);
	assert.deepEqual(
		emptyArgs,
		[],
		"the page's request is cancelled, not left hanging",
	);

	let dismissed = "unset";
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS },
		(value) => {
			dismissed = value;
		},
	);
	// The id is main's own, read off the chooser rather than hard-coded: the empty
	// request above deliberately mints none, and a test pinned to "req-2" would be
	// asserting the counter's arithmetic instead of the rule.
	const pendingId = chooser.pendingRequestIds()[0];
	assert.equal(chooser.respond(pendingId, null), true);
	assert.equal(dismissed, undefined);
	assert.equal(chooser.respond("nope", "Y3JlZC0x"), false);
	assert.match(logged.at(-1), /unknown or already-answered request/);
});

test("a choice naming a credential that was not offered cancels the request", () => {
	const { chooser, logged } = makeChooser();
	let answered = "unset";
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS },
		(value) => {
			answered = value;
		},
	);
	assert.equal(chooser.respond("req-1", "c29tZXRoaW5nLWVsc2U"), true);
	assert.equal(answered, undefined);
	assert.match(logged.at(-1), /named a credential that was not offered/);
});

test("an unanswered chooser expires rather than leaving the page pending", async () => {
	const { chooser, logged } = makeChooser({ timeoutMs: 20 });
	let answered = "unset";
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS },
		(value) => {
			answered = value;
		},
	);
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(answered, undefined);
	assert.deepEqual(chooser.pendingRequestIds(), []);
	assert.match(
		logged.at(-1),
		/nobody chose a passkey for example\.test within 0s/,
	);
	// The default bound is the browser session's own origin-prompt TTL.
	assert.equal(WEBAUTHN_CHOOSER_TIMEOUT_MS, 60_000);
});

test("stopping the host cancels every pending choice", () => {
	const { chooser, logged } = makeChooser();
	const answers = [];
	chooser.handle({ relyingPartyId: "a.test", accounts: ACCOUNTS }, (value) =>
		answers.push(value),
	);
	chooser.handle(
		{ relyingPartyId: "b.test", accounts: [ACCOUNTS[1]] },
		(value) => answers.push(value),
	);
	assert.equal(chooser.pendingRequestIds().length, 2);
	chooser.dispose();
	assert.deepEqual(answers, [undefined, undefined]);
	assert.deepEqual(chooser.pendingRequestIds(), []);
	assert.equal(
		logged.filter((line) => line.includes("the browser host stopped")).length,
		2,
	);
});

test("the chooser labels an account without inventing an identity", () => {
	assert.equal(
		accountChoiceLabel(
			{ credentialId: "a", displayName: "Ada Lovelace", name: "ada@x.test" },
			0,
		),
		"Ada Lovelace",
	);
	assert.equal(
		accountChoiceLabel(
			{ credentialId: "a", displayName: null, name: "ada@x.test" },
			0,
		),
		"ada@x.test",
	);
	assert.equal(
		accountChoiceLabel({ credentialId: "a", displayName: "  ", name: null }, 2),
		"Passkey 3",
	);
	assert.equal(accountChoiceLabel(null, 0), "Passkey 1");
	// The detail line exists for a display name that hides the login, and is
	// suppressed when it would repeat the label.
	assert.equal(
		accountChoiceDetail(
			{ credentialId: "a", displayName: "Ada Lovelace", name: "ada@x.test" },
			0,
		),
		"ada@x.test",
	);
	assert.equal(
		accountChoiceDetail(
			{ credentialId: "a", displayName: null, name: "ada@x.test" },
			0,
		),
		null,
	);
	assert.equal(accountChoiceDetail(null, 0), null);
});
