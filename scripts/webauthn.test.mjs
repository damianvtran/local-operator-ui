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
 * `codesign -d --entitlements - --xml` prints a single-line XML plist, and NOTHING
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
			'export * from "./src/renderer/src/features/browser/model/webauthn-panel";',
			'export * from "./src/shared/webauthn-request";',
			'export * from "./src/renderer/src/shared/browser-webauthn-queue";',
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
	accountChoiceVoice,
	accountsAreNameless,
	attachWebauthnChooser,
	chooserLead,
	chooserPageNote,
	chooserQueueNote,
	chooserPanel,
	endingFor,
	parseWebauthnRequest,
	noteWebauthnRequest,
	clearWebauthnRequest,
	replaceWebauthnRequests,
	webauthnRequestsSnapshot,
	settledChooserCopy,
	UNNAMED_ACCOUNT_DETAIL,
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

/** Entitlements as `codesign -d --entitlements - --xml` prints them with the group. */
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
	// An ad-hoc signature prints NOTHING for `-d --entitlements - --xml` (measured):
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
		"-",
		// `--xml` is what keeps the read an XML plist rather than codesign's
		// human-readable dump, without the deprecated `:` path spelling.
		"--xml",
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
			// The source is null here because this call passes no `describeSource`,
			// which is the shape a host that cannot resolve the frame produces.
			tabId: null,
			pageTitle: null,
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
		[undefined],
		"the page's request is cancelled with no credential, not left hanging",
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
	// An account with NO name of any kind now says so rather than leaving a blank
	// second line (design round 1, D9; UX round 1, U1): the row is the only place
	// the user can learn that the choice is arbitrary.
	assert.equal(accountChoiceDetail(null, 0), UNNAMED_ACCOUNT_DETAIL);
});

/**
 * A `Session` as far as the chooser's registration uses one: the two listener
 * methods and the emit, so a test can watch what the SESSION would deliver rather
 * than what one chooser happens to hold.
 */
function makeSession() {
	const listeners = new Map();
	return {
		listeners,
		on(event, listener) {
			const current = listeners.get(event) ?? [];
			listeners.set(event, [...current, listener]);
		},
		removeListener(event, listener) {
			const current = listeners.get(event) ?? [];
			listeners.set(
				event,
				current.filter((entry) => entry !== listener),
			);
		},
		emit(event, ...args) {
			for (const listener of listeners.get(event) ?? []) listener(...args);
		},
		count(event = "select-webauthn-account") {
			return (listeners.get(event) ?? []).length;
		},
	};
}

test("a second host start leaves ONE listener, and one request settles one callback", () => {
	// Reviewer round 1, finding 2 (MAJOR). `session.fromPartition` returns the same
	// Session for the life of the process, so a listener registered inside the
	// host's startup accumulates across a window close plus a Dock click — and
	// Electron's contract for this event is that its callback is invoked exactly
	// once. Both halves are asserted here: the registration is idempotent, and the
	// callback is guarded where it is created, so a second delivery cannot answer
	// twice even if something else registers a listener.
	const session = makeSession();
	const first = makeChooser();
	const second = makeChooser();
	const detachFirst = attachWebauthnChooser(session, first.chooser, () => {});
	attachWebauthnChooser(session, second.chooser, () => {});
	assert.equal(
		session.count(),
		1,
		"the previous listener was removed, not joined by a second",
	);

	const answers = [];
	const callback = (value) => answers.push(value);
	session.emit(
		"select-webauthn-account",
		{},
		{ relyingPartyId: "example.test", accounts: ACCOUNTS, frame: null },
		callback,
	);
	assert.deepEqual(first.notified, [], "the replaced chooser saw nothing");
	assert.equal(second.notified.length, 1);
	assert.equal(second.chooser.respond("req-1", "Y3JlZC0y"), true);
	// The stale chooser holding the SAME request id must not answer the callback a
	// second time — it is the same native callback, and the guard is keyed on it.
	assert.deepEqual(answers, ["Y3JlZC0y"]);

	// Detaching is what the stop path does, and it must leave nothing behind.
	detachFirst();
	session.emit(
		"select-webauthn-account",
		{},
		{ relyingPartyId: "example.test", accounts: ACCOUNTS, frame: null },
		callback,
	);
	assert.equal(second.notified.length, 2, "the live chooser still receives");
	const secondListener = (session.listeners.get("select-webauthn-account") ??
		[])[0];
	session.removeListener("select-webauthn-account", secondListener);
	assert.equal(session.count(), 0);
});

test("a surface that mounts late reads the pending queue oldest-first, with the page it came from", () => {
	// UX round 1, U2: the request is raised while nothing is mounted, so the push
	// had nowhere to go. Main is the source of truth for the queue, and the order
	// is arrival order because the surface offers the oldest and names the rest.
	const { chooser } = makeChooser({
		describeSource: (frame) =>
			frame === null
				? { tabId: null, pageTitle: null }
				: { tabId: 7, pageTitle: "Quincy Beginnings" },
	});
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS, frame: null },
		() => {},
	);
	chooser.handle(
		{ relyingPartyId: "other.test", accounts: [ACCOUNTS[0]], frame: { id: 1 } },
		() => {},
	);
	assert.deepEqual(
		chooser.pendingRequests().map((request) => ({
			requestId: request.requestId,
			relyingPartyId: request.relyingPartyId,
			tabId: request.tabId,
			pageTitle: request.pageTitle,
			accounts: request.accounts.length,
		})),
		[
			{
				requestId: "req-1",
				relyingPartyId: "example.test",
				tabId: null,
				pageTitle: null,
				accounts: 2,
			},
			{
				requestId: "req-2",
				relyingPartyId: "other.test",
				tabId: 7,
				pageTitle: "Quincy Beginnings",
				accounts: 1,
			},
		],
	);
	chooser.respond("req-1", null);
	assert.deepEqual(
		chooser.pendingRequests().map((request) => request.requestId),
		["req-2"],
	);
});

test("every settle path reports its outcome, which is what the surface explains", () => {
	// Design round 1, D2: the dialog stayed up after main had cancelled the
	// request, and a later click was discarded in silence. The push is what closes
	// that gap, and the OUTCOME is what decides whether the user is told anything
	// — their own answer needs no explanation, an expiry does.
	const settled = [];
	const { chooser } = makeChooser({
		onSettled: (requestId, outcome) => settled.push([requestId, outcome]),
		timeoutMs: 5,
	});
	const request = {
		relyingPartyId: "example.test",
		accounts: ACCOUNTS,
		frame: null,
	};
	chooser.handle(request, () => {});
	chooser.respond("req-1", "Y3JlZC0x");
	chooser.handle(request, () => {});
	chooser.respond("req-2", null);
	chooser.handle(request, () => {});
	chooser.respond("req-3", "not-offered");
	chooser.handle(request, () => {});
	// An id main never minted is refused rather than settling anything.
	assert.equal(chooser.respond("req-9", null), false);
	chooser.dispose();
	assert.deepEqual(settled, [
		["req-1", "chosen"],
		["req-2", "dismissed"],
		["req-3", "credential-not-offered"],
		["req-4", "host-stopped"],
	]);
});

test("an expired request reports 'expired' rather than only cancelling", async () => {
	const settled = [];
	const { chooser } = makeChooser({
		onSettled: (requestId, outcome) => settled.push([requestId, outcome]),
		timeoutMs: 20,
	});
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS, frame: null },
		() => {},
	);
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.deepEqual(settled, [["req-1", "expired"]]);
});

test("a nameless multi-match is explained rather than offered as an arbitrary choice", () => {
	// UX round 1, U1 (MAJOR) and design round 1, D3 (the copy contradicted the
	// rows under it). Three nameless credentials is the case where the user has
	// nothing to choose by, and the honest answer is to say so.
	const nameless = [
		{ credentialId: "a", displayName: null, name: null },
		{ credentialId: "b", displayName: "  ", name: "" },
	];
	const request = {
		requestId: "req-1",
		relyingPartyId: "example.test",
		accounts: nameless,
		tabId: null,
		pageTitle: null,
	};
	assert.equal(accountsAreNameless(nameless), true);
	assert.match(chooserLead(request), /did not give their names/);
	assert.match(chooserLead(request), /the account you sign in as/);
	// One account is not "more than one of your passkeys matches".
	assert.equal(
		chooserLead({ ...request, accounts: [nameless[0]] }),
		"example.test asked for a passkey. Pick it to sign in.",
	);
	// A named pair keeps the existing sentence, which is true of it.
	assert.match(
		chooserLead({
			...request,
			accounts: [
				{ credentialId: "a", displayName: "Ada", name: "ada@x.test" },
				{ credentialId: "b", displayName: "Grace", name: null },
			],
		}),
		/More than one of your passkeys matches/,
	);
	// The voice follows the field the label came from (design round 1, D4; the
	// positional fallback gained its own voice in round 2, N2, because a position is
	// neither a person nor a machine string).
	assert.equal(accountChoiceVoice(nameless[0]), "ordinal");
	assert.equal(
		accountChoiceVoice({ credentialId: "a", displayName: "Ada", name: "a@x" }),
		"human",
	);
	assert.equal(
		accountChoiceVoice({ credentialId: "a", displayName: null, name: "a@x" }),
		"login",
	);
	// And nothing at all for a request that came from no page.
	assert.equal(chooserPageNote(request), null);
	assert.equal(
		chooserPageNote({ ...request, pageTitle: "Quincy Beginnings" }),
		"The page asking is \u201cQuincy Beginnings\u201d.",
	);
	// The requests waiting behind are named, not hidden (reviewer round 1, 7).
	// REQUESTS, not sites: main keys its pending map by request id with no dedupe
	// by relying party, so two tabs of one site would make "2 more sites" false
	// (design round 2, N3; UX round 2, U7).
	assert.equal(chooserQueueNote(0), null);
	assert.equal(chooserQueueNote(1), "One more passkey request is waiting.");
	assert.equal(chooserQueueNote(2), "2 more passkey requests are waiting.");
});

test("only the endings the user did not choose carry copy", () => {
	// The dialog shows a settled request's outcome in words; a choice or a
	// dismissal is the user's own act and gets no paragraph.
	assert.equal(settledChooserCopy("chosen"), null);
	assert.equal(settledChooserCopy("dismissed"), null);
	// No `no-accounts` member: a request Electron raises with nothing to offer is
	// answered before it is ever pending, so the state could never be shown
	// (agent review round 2, R2).
	for (const outcome of ["expired", "host-stopped", "credential-not-offered"]) {
		const copy = settledChooserCopy(outcome);
		assert.ok(copy, `${outcome} has copy`);
		assert.ok(copy.title.length > 0 && copy.body.length > 0);
	}
});

test("the mirror merges main's snapshot instead of overwriting what it holds", () => {
	/*
	 * Agent review round 2, N1. The pull used to REPLACE the mirror with main's
	 * answer, which is correct only because main sets its pending entry before it
	 * notifies — so a push that arrived between the invoke and the reply is always
	 * present in the snapshot. That is an ordering coincidence between two adjacent
	 * lines in `src/main/webauthn.ts`, and overwriting would silently drop a request
	 * if they were ever reordered. Merging makes the mirror order-independent.
	 */
	const entries = () => webauthnRequestsSnapshot();
	for (const entry of entries()) clearWebauthnRequest(entry.requestId);

	const first = {
		requestId: "req-1",
		relyingPartyId: "one.test",
		accounts: [{ credentialId: "a", displayName: null, name: null }],
		tabId: 1,
		pageTitle: null,
	};
	const second = { ...first, requestId: "req-2", relyingPartyId: "two.test" };
	noteWebauthnRequest(first);
	// A snapshot taken before `second` was pushed: the push must survive the pull.
	replaceWebauthnRequests([first]);
	noteWebauthnRequest(second);
	replaceWebauthnRequests([first, second]);
	assert.deepEqual(
		entries().map((entry) => entry.requestId),
		["req-1", "req-2"],
		"main's order first, and nothing the mirror already held is dropped",
	);

	// A settle is what removes an entry, and only the one it names.
	assert.equal(clearWebauthnRequest("req-1")?.requestId, "req-1");
	assert.deepEqual(
		entries().map((entry) => entry.requestId),
		["req-2"],
	);
	clearWebauthnRequest("req-2");
});

test("the recovery clause lives in the lead, where prose wraps, and not in a truncating row", () => {
	/*
	 * Design round 3, D11 (and UX round 3's U9). The clause was put in the row's
	 * second line, which exists for a LOGIN: `truncate` + `title`, so a 706px
	 * sentence in a 380px box painted about half of itself and the actionable half
	 * was hover-only. The test pins the shape the frame settles: the clause is in the
	 * lead, and the row's line is one sentence.
	 */
	const nameless = {
		requestId: "req-n",
		relyingPartyId: "accounts.example.com",
		accounts: [
			{ credentialId: "a", displayName: null, name: null },
			{ credentialId: "b", displayName: null, name: null },
		],
		tabId: 1,
		pageTitle: null,
	};
	const lead = chooserLead(nameless);
	assert.match(lead, /sign out and ask the site again/);
	assert.equal(
		UNNAMED_ACCOUNT_DETAIL,
		"The site stored no name for this passkey.",
	);
	assert.ok(
		!UNNAMED_ACCOUNT_DETAIL.includes("sign out and ask the site again"),
		"the recovery clause is not in the row's line",
	);
	// A length ceiling rather than a pixel measurement: the row's box is 380px at the
	// panel's fixed width, and this is the string that has to fit it.
	assert.ok(
		UNNAMED_ACCOUNT_DETAIL.length <= 60,
		`the row's line stays short (${UNNAMED_ACCOUNT_DETAIL.length} chars)`,
	);
});

test("a request whose push throws leaves nothing pending behind", () => {
	/*
	 * Agent review round 3, N1. `notify` is the host's `webContents.send` behind a
	 * destroyed check, so it is the one call in the pre-timer body that can throw.
	 * Registering the entry before it would leave main advertising a request whose
	 * page `handle`'s catch has just cancelled.
	 */
	const thrown = [];
	const chooser = new WebauthnChooser({
		notify: () => {
			throw new Error("window is gone");
		},
		log: (message) => thrown.push(message),
		timeoutMs: 10_000,
	});
	let answered = "unset";
	chooser.handle(
		{ relyingPartyId: "example.test", accounts: ACCOUNTS },
		(value) => {
			answered = value;
		},
	);
	// `undefined` rather than `null`: `onceAnswer` normalises "nothing" to the shape
	// Electron's own callback documents (measured by the round-1 expiry case too).
	assert.equal(answered, undefined, "the callback is still settled");
	assert.deepEqual(chooser.pendingRequestIds(), [], "no entry is left pending");
	assert.match(thrown.join("\n"), /could not be prepared/);
});

test("a live request is never hidden behind an ending, and an ending cancels nothing", () => {
	/*
	 * THE ROUND-2 BLOCKER, as a property rather than as a copy change (agent review
	 * round 2, R1). Round 1 held the ending in a single `notice` slot beside the
	 * queue; with two requests queued the oldest expiring rendered the ending
	 * INSTEAD of the live request's rows, and the only button on screen — the
	 * ending's Close — ran the live branch's answer with nothing, cancelling a
	 * request the user had never seen. The old behaviour fails the first assertion
	 * below: it had no panel at all, and its ending state was reachable while a
	 * request was still answerable.
	 */
	const live = {
		requestId: "req-new",
		relyingPartyId: "second.test",
		accounts: [{ credentialId: "credB", displayName: null, name: null }],
		tabId: 2,
		pageTitle: null,
	};
	const ending = {
		requestId: "req-old",
		title: "That passkey request expired",
		body: "Nobody chose a passkey within a minute.",
	};

	const both = chooserPanel({ requests: [live], ending, answering: false });
	assert.equal(both.kind, "request");
	assert.equal(both.request.requestId, "req-new");
	// The ending is not lost, it waits: it is shown once nothing is answerable.
	const afterQueue = chooserPanel({ requests: [], ending, answering: false });
	assert.equal(afterQueue.kind, "ending");
	assert.equal(afterQueue.body, ending.body);
	// And the panel the user presses Close on holds no request at all, which is
	// what makes "the ending's press cannot answer anything" structural.
	assert.equal("request" in afterQueue, false);
	assert.equal(
		chooserPanel({ requests: [], ending: null, answering: false }).kind,
		"none",
	);

	// The queue behind the offered request is counted, oldest first.
	const queued = chooserPanel({
		requests: [live, { ...live, requestId: "req-third" }],
		ending: null,
		answering: false,
	});
	assert.equal(queued.waitingBehind, 1);

	// Only an ending the user did not cause produces one, and it is tied to the
	// request it ended (so a dismissal settles that one and nothing else).
	assert.equal(endingFor("req-1", "chosen"), null);
	assert.equal(endingFor("req-1", "dismissed"), null);
	assert.equal(endingFor("req-1", "expired")?.requestId, "req-1");
});

test("an inbound chooser payload is validated once, for both channels", () => {
	// The push and the pull share one parser, so a payload shaped one way when it
	// arrives and another way when it is asked for cannot exist. Malformed input is
	// refused rather than rendered as a dialog with no rows.
	const good = {
		requestId: "req-1",
		relyingPartyId: "example.test",
		accounts: [
			{ credentialId: "a", displayName: "Ada", name: "ada@x.test" },
			{ credentialId: "b", displayName: 7, name: null },
		],
		tabId: 4,
		pageTitle: "A page",
	};
	assert.deepEqual(parseWebauthnRequest(good), {
		requestId: "req-1",
		relyingPartyId: "example.test",
		accounts: [
			{ credentialId: "a", displayName: "Ada", name: "ada@x.test" },
			{ credentialId: "b", displayName: null, name: null },
		],
		tabId: 4,
		pageTitle: "A page",
	});
	// The source fields are optional on the wire: absent means "could not resolve".
	assert.deepEqual(
		parseWebauthnRequest({ ...good, tabId: "7", pageTitle: "" }),
		{
			requestId: "req-1",
			relyingPartyId: "example.test",
			accounts: [
				{ credentialId: "a", displayName: "Ada", name: "ada@x.test" },
				{ credentialId: "b", displayName: null, name: null },
			],
			tabId: null,
			pageTitle: null,
		},
	);
	for (const bad of [
		null,
		"req-1",
		{},
		{ requestId: "" },
		{ requestId: "req-1" },
		{ requestId: "req-1", accounts: [] },
		{ requestId: "req-1", accounts: [{ name: "no id" }] },
	]) {
		assert.equal(parseWebauthnRequest(bad), null, JSON.stringify(bad));
	}
});
