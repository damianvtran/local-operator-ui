import { execFile } from "node:child_process";
import { app } from "electron";

/**
 * The platform authenticator (Touch ID) for WebAuthn, the gate that decides
 * whether it may be enabled, and the chooser for a request that matches more
 * than one discoverable credential.
 *
 * Design: docs/design/browser-challenges-and-passkeys.md.
 *
 * WHY A GATE AT ALL, and why it is derived from the app's own signature rather
 * than configured by hand. `app.configureWebAuthn({ touchID: { keychainAccessGroup } })`
 * is only half of the contract: the group must ALSO be present in the app's
 * `keychain-access-groups` code-signing entitlement, and the value is
 * `<TEAM_ID>.<BUNDLE_ID>.webauthn` where the team id is a CI secret
 * (`APPLE_TEAM_ID`) that does not exist on a developer's machine. Enabling the
 * authenticator without a usable entitlement does not fail loudly — measured on
 * Electron 44.3.0, this machine, ad-hoc signed and unentitled:
 *
 *   - `configureWebAuthn` returns normally (it never throws);
 *   - Chromium logs `FIDO: touch_id_context.mm:89 Touch ID authenticator
 *     unavailable because keychain-access-group entitlement is missing or
 *     incorrect. Expected value: <group>`;
 *   - `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
 *     stays `false`;
 *   - and `navigator.credentials.create()` never settles AT ALL — the page's
 *     promise hangs past a 60 s observation in both arms (hidden window and
 *     shown-inactive window).
 *
 * That last row is the reason this module is deliberate rather than eager: a
 * site that offers a passkey which cannot complete is worse than a site that
 * never offers one, and a hanging promise is the worst of the three. So the
 * authenticator is configured ONLY when the running app's signature really
 * carries the entitlement for the exact group about to be passed, and otherwise
 * the module logs one line naming why it is off and stays inert.
 *
 * WHAT IT CANNOT DO, stated here rather than discovered later: Electron's
 * implementation is Touch ID / Secure Enclave only, through `LAContext`.
 * Credentials are device-bound (no iCloud Keychain sync, no Apple Passwords
 * sheet, no 1Password) — see the design doc for the entitlement and native
 * integration that a real browser's passkey picker needs and Electron does not
 * have.
 */

/** The suffix Electron documents for the group: `<TEAM_ID>.<BUNDLE_ID>.webauthn`. */
export const WEBAUTHN_GROUP_SUFFIX = ".webauthn";

/** The prompt macOS renders as `"<App Name>" is trying to <promptReason>`. */
export const WEBAUTHN_PROMPT_REASON = "use a passkey for $1";

/** How long a surfaced chooser may stay unanswered before the request is
 * cancelled. Bounded rather than indefinite: an unanswered
 * `select-webauthn-account` keeps the page's `credentials.get()` pending, and a
 * promise nobody can settle is exactly the dead end this module exists to
 * avoid. Sixty seconds matches the browser session's own origin-prompt TTL. */
export const WEBAUTHN_CHOOSER_TIMEOUT_MS = 60_000;

/** How long `codesign` is given before the probe gives up. Both calls are local
 * and answer in milliseconds; the bound exists so a wedged codesign cannot hold
 * the browser host's startup. */
export const CODESIGN_TIMEOUT_MS = 5_000;

/**
 * The facts read off the running app's own signature.
 *
 * Everything the gate needs is derived here rather than from configuration, so
 * a mismatched value is impossible by construction: the group that would be
 * passed to Electron and the group compared against the entitlement come from
 * one string.
 */
export interface SignatureFacts {
	platform: string;
	packaged: boolean;
	/** The `.app` bundle the executable lives in (derived, never guessed). */
	bundlePath: string;
	/** `Identifier=` from `codesign -dv --verbose=4` — the bundle id. */
	bundleIdentifier: string | null;
	/** `TeamIdentifier=` from the same call. Absent for an ad-hoc signature. */
	teamIdentifier: string | null;
	/** The values in the `keychain-access-groups` entitlement. Empty when the
	 * signature carries no entitlements at all. */
	keychainAccessGroups: string[];
	/** Set when the signature could not be read, naming the failure. Null when
	 * both `codesign` calls answered. */
	unreadable: string | null;
}

/** Why the platform authenticator is off. These exact tokens appear in the log
 * line, because "why is my passkey not working" has to be answerable from the
 * log without a rebuild. */
export type WebauthnGateReason =
	| "enabled"
	| "not darwin"
	| "unpackaged"
	| "signature unreadable"
	| "no bundle id"
	| "no team id"
	| "entitlement absent"
	| "entitlement mismatch";

export interface WebauthnGateDecision {
	enabled: boolean;
	/** The group the authenticator would be configured under, when derivable. */
	group: string | null;
	reason: WebauthnGateReason;
	/** The specific fact behind the reason: the entitlement's actual values, the
	 * team id that is missing, what `codesign` said. Never empty. */
	detail: string;
}

/** `<TEAM_ID>.<BUNDLE_ID>.webauthn`, the one place this shape is written. */
export function webauthnKeychainAccessGroup(
	teamIdentifier: string,
	bundleIdentifier: string,
): string {
	return `${teamIdentifier}.${bundleIdentifier}${WEBAUTHN_GROUP_SUFFIX}`;
}

/**
 * The `.app` bundle an executable path belongs to.
 *
 * `/Applications/Local Operator.app/Contents/MacOS/Local Operator` ->
 * `/Applications/Local Operator.app`. Derived from `process.execPath` rather
 * than `app.getAppPath()`: the latter points INSIDE the bundle
 * (`…/Contents/Resources/app.asar`), which `codesign` would refuse.
 */
export function appBundlePathFromExecutable(execPath: string): string {
	const parts = execPath.split("/");
	const macOs = parts.lastIndexOf("MacOS");
	// `MacOS` is inside `Contents` inside the `.app`; anything else is not a
	// bundle layout and the caller reports it rather than signing the wrong path.
	if (macOs < 2 || parts[macOs - 1] !== "Contents") {
		return execPath;
	}
	return parts.slice(0, macOs - 1).join("/") || "/";
}

/** The two lines `codesign -dv --verbose=4` prints that this module reads. Hoisted
 * to module scope so a parse does not rebuild the pattern on every call. */
const TEAM_IDENTIFIER_LINE = /^TeamIdentifier=(.*)$/m;
const IDENTIFIER_LINE = /^Identifier=(.*)$/m;

/** `TeamIdentifier=` from `codesign -dv --verbose=4`. An ad-hoc signature omits
 * the line entirely; `not set` is codesign's way of saying the same thing. */
export function parseTeamIdentifier(
	codesignVerboseOutput: string,
): string | null {
	const match = TEAM_IDENTIFIER_LINE.exec(codesignVerboseOutput);
	const value = (match?.[1] ?? "").trim();
	return value && value !== "not set" ? value : null;
}

/** `Identifier=` from the same output: the bundle id codesign recorded. */
export function parseBundleIdentifier(
	codesignVerboseOutput: string,
): string | null {
	const match = IDENTIFIER_LINE.exec(codesignVerboseOutput);
	const value = (match?.[1] ?? "").trim();
	return value || null;
}

/**
 * The `keychain-access-groups` values from an entitlements plist.
 *
 * Parsed with a tag scan rather than a plist library: the input is
 * `codesign -d --entitlements :-`'s own output, which is a single-line XML
 * plist, and the alternative is a dependency in the main process for one array.
 * A signature with NO entitlements prints nothing at all (measured on an ad-hoc
 * signed bundle), which is the empty array this returns — the "entitlement
 * absent" case rather than a parse failure.
 */
export function parseKeychainAccessGroups(entitlementsPlist: string): string[] {
	const key = entitlementsPlist.indexOf("<key>keychain-access-groups</key>");
	if (key === -1) return [];
	const after = entitlementsPlist.slice(key);
	const arrayStart = after.indexOf("<array>");
	const arrayEnd = after.indexOf("</array>", arrayStart + 1);
	if (arrayStart === -1 || arrayEnd === -1) return [];
	const body = after.slice(arrayStart + "<array>".length, arrayEnd);
	const groups: string[] = [];
	const pattern = /<string>([^<]*)<\/string>/g;
	let match = pattern.exec(body);
	while (match !== null) {
		const value = match[1].trim();
		if (value) groups.push(value);
		match = pattern.exec(body);
	}
	return groups;
}

/**
 * The gate, as a pure function of the facts.
 *
 * Order matters: each reason is the FIRST thing that is wrong, so the log line
 * names the fact that actually has to change (a developer reading `unpackaged`
 * knows to build a bundle; reading `entitlement mismatch` sees both values).
 */
export function decideWebauthnGate(
	facts: SignatureFacts,
): WebauthnGateDecision {
	if (facts.platform !== "darwin") {
		return {
			enabled: false,
			group: null,
			reason: "not darwin",
			detail: `the platform authenticator is macOS only (platform ${facts.platform})`,
		};
	}
	if (!facts.packaged) {
		return {
			enabled: false,
			group: null,
			reason: "unpackaged",
			detail:
				"an unpackaged run has no signature to carry the entitlement, so there is no group to configure",
		};
	}
	if (facts.unreadable) {
		return {
			enabled: false,
			group: null,
			reason: "signature unreadable",
			detail: facts.unreadable,
		};
	}
	if (!facts.bundleIdentifier) {
		return {
			enabled: false,
			group: null,
			reason: "no bundle id",
			detail: `codesign reported no Identifier for ${facts.bundlePath}`,
		};
	}
	if (!facts.teamIdentifier) {
		return {
			enabled: false,
			group: null,
			reason: "no team id",
			detail: `${facts.bundlePath} is not team-signed (an ad-hoc signature has no TeamIdentifier)`,
		};
	}
	const group = webauthnKeychainAccessGroup(
		facts.teamIdentifier,
		facts.bundleIdentifier,
	);
	if (facts.keychainAccessGroups.length === 0) {
		return {
			enabled: false,
			group,
			reason: "entitlement absent",
			detail: `the signature carries no keychain-access-groups entitlement, so ${group} cannot be used`,
		};
	}
	if (!facts.keychainAccessGroups.includes(group)) {
		return {
			enabled: false,
			group,
			reason: "entitlement mismatch",
			detail: `the signature's keychain-access-groups are [${facts.keychainAccessGroups.join(", ")}] but the authenticator needs ${group}`,
		};
	}
	return {
		enabled: true,
		group,
		reason: "enabled",
		detail: `the signature carries ${group}`,
	};
}

/** A promise-returning `codesign` call, injectable so the gate is testable
 * without a signature. */
export type CodesignRunner = (
	file: string,
	args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultCodesign: CodesignRunner = (file, args) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{ timeout: CODESIGN_TIMEOUT_MS },
			(error, stdout, stderr) => {
				if (error) {
					// `codesign -d` prints its report on STDERR, so a failure's message is
					// the only thing that explains it; it travels with the rejection.
					reject(
						new Error(
							`${error.message}${stderr ? ` (${String(stderr).trim()})` : ""}`,
						),
					);
					return;
				}
				resolve({ stdout: String(stdout), stderr: String(stderr) });
			},
		);
	});

export interface ReadSignatureOptions {
	platform: string;
	packaged: boolean;
	execPath: string;
	run?: CodesignRunner;
}

/**
 * Read the running app's signature: team id, bundle id and the entitlement.
 *
 * Two bounded `codesign` calls, and BOTH are made only when the app is actually
 * packaged — an unpackaged run is decided before any process is spawned, so a
 * development launch pays nothing for a gate it cannot pass.
 */
export async function readAppSignature(
	options: ReadSignatureOptions,
): Promise<SignatureFacts> {
	const bundlePath = appBundlePathFromExecutable(options.execPath);
	const base: SignatureFacts = {
		platform: options.platform,
		packaged: options.packaged,
		bundlePath,
		bundleIdentifier: null,
		teamIdentifier: null,
		keychainAccessGroups: [],
		unreadable: null,
	};
	if (options.platform !== "darwin" || !options.packaged) return base;
	const run = options.run ?? defaultCodesign;
	try {
		const verbose = await run("/usr/bin/codesign", [
			"-dv",
			"--verbose=4",
			bundlePath,
		]);
		base.bundleIdentifier = parseBundleIdentifier(verbose.stdout);
		base.teamIdentifier = parseTeamIdentifier(verbose.stdout);
	} catch (error) {
		return { ...base, unreadable: `codesign -dv failed: ${messageOf(error)}` };
	}
	try {
		// `:-` writes the plist to stdout. It exits 0 with EMPTY output when the
		// signature carries no entitlements (measured), which is a fact about the
		// app rather than a failure to read it.
		const entitlements = await run("/usr/bin/codesign", [
			"-d",
			"--entitlements",
			":-",
			bundlePath,
		]);
		base.keychainAccessGroups = parseKeychainAccessGroups(entitlements.stdout);
	} catch (error) {
		return {
			...base,
			unreadable: `codesign -d --entitlements failed: ${messageOf(error)}`,
		};
	}
	return base;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The cached read of THIS process's signature.
 *
 * Cached because the answer cannot change while the process runs — the bundle
 * on disk is the one that is executing — and because the browser host and any
 * future caller should not each spawn codesign. The in-flight promise is cached
 * rather than the value, so two callers cannot race two probes.
 */
let ownSignature: Promise<SignatureFacts> | null = null;

export function ownAppSignature(): Promise<SignatureFacts> {
	ownSignature ??= readAppSignature({
		platform: process.platform,
		packaged: app.isPackaged,
		execPath: process.execPath,
	});
	return ownSignature;
}

/** Reset the cache. Tests only: nothing in the app re-reads a signature. */
export function resetOwnSignatureCache(): void {
	ownSignature = null;
}

export interface WebauthnInstallOptions {
	log: (message: string) => void;
	/** Injected for tests. Defaults to this process's own signature and Electron's
	 * `app.configureWebAuthn`. */
	facts?: () => Promise<SignatureFacts>;
	configure?: (options: {
		touchID: { keychainAccessGroup: string; promptReason: string };
	}) => void;
}

export interface WebauthnInstallResult {
	gate: WebauthnGateDecision;
	configured: boolean;
}

/**
 * Enable the platform authenticator when the signature can support it, and say
 * exactly why not when it cannot.
 *
 * Called once, from the browser host's startup: the authenticator is a property
 * of the process, and configuring it per tab would be the same call repeated
 * with the same answer.
 */
export async function installWebauthn(
	options: WebauthnInstallOptions,
): Promise<WebauthnInstallResult> {
	const facts = await (options.facts ?? ownAppSignature)();
	const gate = decideWebauthnGate(facts);
	if (!gate.enabled || !gate.group) {
		options.log(
			`[webauthn] Touch ID passkeys are off: ${gate.reason} — ${gate.detail}`,
		);
		return { gate, configured: false };
	}
	const configure =
		options.configure ?? ((value) => app.configureWebAuthn(value));
	try {
		configure({
			touchID: {
				keychainAccessGroup: gate.group,
				promptReason: WEBAUTHN_PROMPT_REASON,
			},
		});
	} catch (error) {
		options.log(
			`[webauthn] Touch ID passkeys are off: configureWebAuthn failed — ${messageOf(error)}`,
		);
		return { gate: { ...gate, enabled: false }, configured: false };
	}
	options.log(
		`[webauthn] Touch ID platform authenticator enabled (${gate.group}); credentials are device-bound and never leave this Mac`,
	);
	return { gate, configured: true };
}

/** One discoverable credential, as the chooser surfaces it. Mirrors Electron's
 * `WebAuthnAccount` deliberately: this is the shape main already holds. */
export interface WebauthnAccountView {
	credentialId: string;
	name: string | null;
	displayName: string | null;
	userHandle: string | null;
}

/** A request the renderer has to answer. `requestId` is main's own, never a
 * credential id, so nothing about the accounts travels back as the token. */
export interface WebauthnChooserRequest {
	requestId: string;
	relyingPartyId: string;
	accounts: WebauthnAccountView[];
}

export interface WebauthnChooserOptions {
	/** Sends the request to the app's renderer. */
	notify: (request: WebauthnChooserRequest) => void;
	log: (message: string) => void;
	timeoutMs?: number;
	/** Injectable so a test can name requests deterministically. */
	nextRequestId?: () => string;
}

interface PendingChoice {
	requestId: string;
	relyingPartyId: string;
	accounts: WebauthnAccountView[];
	callback: (credentialId?: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * The chooser behind `Session`'s `select-webauthn-account`.
 *
 * WHY IT IS REQUIRED rather than a nicety: that event fires when a
 * `navigator.credentials.get()` matches MORE THAN ONE discoverable credential,
 * and Electron's contract is that with no listener — or with one that passes no
 * `credentialId` — the request is cancelled with `NotAllowedError`. So without
 * this, a user with two passkeys for one site gets a failure and no explanation.
 * A single matching credential never reaches here: Electron dispatches it.
 *
 * EVERY PATH SETTLES THE CALLBACK EXACTLY ONCE. The callback is the page's
 * pending promise: leaving it unanswered is the dead end that motivated this
 * module, so a dismissal, an unknown request id and the timeout all answer with
 * nothing and log a line — the page sees `NotAllowedError` (the correct outcome
 * for "nobody chose") rather than hanging.
 */
export class WebauthnChooser {
	private readonly pending = new Map<string, PendingChoice>();
	private counter = 0;

	constructor(private readonly options: WebauthnChooserOptions) {}

	/** Handle the Session event. `accounts` is Electron's own array. */
	handle(
		details: {
			relyingPartyId?: unknown;
			accounts?: unknown;
		},
		callback: (credentialId?: string | null) => void,
	): void {
		const relyingPartyId =
			typeof details.relyingPartyId === "string" ? details.relyingPartyId : "";
		const accounts = Array.isArray(details.accounts)
			? details.accounts
					.filter(
						(account): account is Record<string, unknown> =>
							typeof account === "object" && account !== null,
					)
					.map((account) => toAccountView(account))
			: [];
		if (accounts.length === 0) {
			this.options.log(
				`[webauthn] ${relyingPartyId || "a site"} asked for a passkey with no account to choose; cancelling the request`,
			);
			callback();
			return;
		}
		const requestId = this.options.nextRequestId
			? this.options.nextRequestId()
			: `webauthn-${++this.counter}-${Date.now().toString(36)}`;
		const timer = setTimeout(
			() => this.expire(requestId),
			this.options.timeoutMs ?? WEBAUTHN_CHOOSER_TIMEOUT_MS,
		);
		// A pending chooser must not be the reason this process cannot exit.
		timer.unref?.();
		this.pending.set(requestId, {
			requestId,
			relyingPartyId,
			accounts,
			callback,
			timer,
		});
		this.options.log(
			`[webauthn] ${relyingPartyId || "a site"} matched ${accounts.length} passkeys; asking the user which one to use (${requestId})`,
		);
		this.options.notify({ requestId, relyingPartyId, accounts });
	}

	/**
	 * Answer a surfaced chooser. Returns whether a pending request was settled.
	 *
	 * A `credentialId` that is not one of the offered accounts is treated as a
	 * dismissal rather than passed through: Electron would cancel the request
	 * anyway, and doing it here keeps the log honest about what happened.
	 */
	respond(requestId: string, credentialId: string | null): boolean {
		const entry = this.pending.get(requestId);
		if (!entry) {
			this.options.log(
				`[webauthn] ignored a choice for an unknown or already-answered request (${requestId})`,
			);
			return false;
		}
		if (
			credentialId !== null &&
			!entry.accounts.some((a) => a.credentialId === credentialId)
		) {
			this.options.log(
				`[webauthn] a choice for ${entry.relyingPartyId} named a credential that was not offered; cancelling the request`,
			);
			this.settle(entry, null);
			return true;
		}
		if (credentialId === null) {
			this.options.log(
				`[webauthn] the passkey choice for ${entry.relyingPartyId} was dismissed; cancelling the request`,
			);
			this.settle(entry, null);
			return true;
		}
		const chosen = entry.accounts.find((a) => a.credentialId === credentialId);
		this.options.log(
			`[webauthn] the user chose ${labelOf(chosen)} for ${entry.relyingPartyId}`,
		);
		this.settle(entry, credentialId);
		return true;
	}

	/** Ids still waiting for an answer. Read by tests and by nothing else. */
	pendingRequestIds(): string[] {
		return [...this.pending.keys()];
	}

	/** Cancel everything still pending. Called when the host stops, because a
	 * callback left behind would keep the page's promise pending in a window
	 * that is going away. */
	dispose(): void {
		for (const entry of [...this.pending.values()]) {
			this.options.log(
				`[webauthn] the passkey request from ${entry.relyingPartyId} was cancelled: the browser host stopped`,
			);
			this.settle(entry, null);
		}
	}

	private expire(requestId: string): void {
		const entry = this.pending.get(requestId);
		if (!entry) return;
		this.options.log(
			`[webauthn] nobody chose a passkey for ${entry.relyingPartyId} within ${Math.round((this.options.timeoutMs ?? WEBAUTHN_CHOOSER_TIMEOUT_MS) / 1000)}s; cancelling the request`,
		);
		this.settle(entry, null);
	}

	/** Answer exactly once: the map entry is the once-guard, and the timer is
	 * cleared here so an expired request cannot fire a second answer. */
	private settle(entry: PendingChoice, credentialId: string | null): void {
		if (!this.pending.has(entry.requestId)) return;
		this.pending.delete(entry.requestId);
		clearTimeout(entry.timer);
		entry.callback(credentialId ?? undefined);
	}
}

function toAccountView(account: Record<string, unknown>): WebauthnAccountView {
	return {
		credentialId:
			typeof account.credentialId === "string" ? account.credentialId : "",
		name: typeof account.name === "string" ? account.name : null,
		displayName:
			typeof account.displayName === "string" ? account.displayName : null,
		userHandle:
			typeof account.userHandle === "string" ? account.userHandle : null,
	};
}

/** How a chosen account is named in the log. Never the credential id: it is a
 * credential, and the log line is read far more often than it is useful. */
export function labelOf(account: WebauthnAccountView | undefined): string {
	if (!account) return "an unnamed passkey";
	return account.displayName || account.name || "an unnamed passkey";
}
