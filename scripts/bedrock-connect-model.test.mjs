/**
 * The Amazon Bedrock connect panel's rules, checked in Node (review round 1,
 * R5): which profiles each tab lists and in which words (design D1), when a
 * sign-in is needed and what it is called (D4, QA Q2), where the Region's
 * default comes from (D3), which input is refused before it is sent and which
 * secrets survive a refusal (R3), what a failed saved-connection Check is
 * called (D2, R4), the hand-run sign-in command (R6), the per-profile sign-in
 * key (R2) and the gate that licenses the panel at all.
 *
 * The panel itself only arranges these answers; its pixels are in the
 * Storybook frames on the PR.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/providers/bedrock-connect-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	BEDROCK_METHODS,
	accessKeyIdError,
	awsPanelAvailable,
	checkResultFromError,
	checkVerdict,
	connectionInput,
	customRegionError,
	defaultMethod,
	kindLabel,
	keepsSecretsAfter,
	methodDescription,
	methodLabel,
	needsSignIn,
	outcomeUnknown,
	profilesFor,
	regionHelp,
	signInCommand,
	signInCopy,
	ssoSessionKey,
} = model;

// Built by join so no secret scanner mistakes a fixture for a leaked key.
const KEY_ID = ["AKIA", "0123456789", "ABCDEF"].join("");
const DEFAULT_CREDENTIALS = ["am", "bient"].join("");

const profile = (name, kind, state = "not_applicable", extra = {}) => ({
	name,
	kind,
	region: null,
	session: { state, expires_at: null, login_command: null },
	...extra,
});

const PROFILES = [
	profile("acme-dev-sso", "sso", "valid"),
	profile("console", "login", "missing"),
	profile("personal", "static"),
	profile("ci-deploy", "assume_role"),
	profile("vault", "process"),
];

test("D1: tabs use the terminal's words, in its order", () => {
	assert.deepEqual(BEDROCK_METHODS.map(methodLabel), [
		"AWS profile",
		"AWS SSO",
		"Access key",
		"Bedrock API key",
		"Default credentials",
	]);
	assert.equal(BEDROCK_METHODS[4], DEFAULT_CREDENTIALS);
	assert.deepEqual(
		[
			"static",
			"sso",
			"login",
			"assume_role",
			"process",
			"web_identity",
			"x",
		].map(kindLabel),
		[
			"Access keys",
			"SSO",
			"AWS login",
			"Assume role",
			"Credential process",
			"Web identity",
			"Other",
		],
	);
});

test("D1: AWS profile lists self-signing profiles, AWS SSO the sso/login ones", () => {
	assert.deepEqual(
		profilesFor("profile", PROFILES).map((p) => p.name),
		["personal", "ci-deploy", "vault"],
	);
	assert.deepEqual(
		profilesFor("sso", PROFILES).map((p) => p.name),
		["acme-dev-sso", "console"],
	);
	assert.deepEqual(profilesFor("api_key", PROFILES), []);
	assert.equal(
		methodDescription("profile", PROFILES),
		"3 profiles with access keys, assume role, credential process or web identity",
	);
	assert.equal(
		methodDescription("sso", [PROFILES[0]]),
		"1 profile using IAM Identity Center or aws login; sign in from here",
	);
});

test("the first tab follows the machine: SSO, then a profile, then the API key", () => {
	assert.equal(defaultMethod(PROFILES), "sso");
	assert.equal(defaultMethod(PROFILES.slice(2)), "profile");
	assert.equal(defaultMethod([]), "api_key");
});

test("D4/Q2: a never-signed-in profile is not told it expired; 'Nothing was saved' only after a refusal", () => {
	const missing = profile("console", "login", "missing");
	const expired = profile("acme", "sso", "expired");
	assert.equal(needsSignIn(missing), true);
	assert.equal(needsSignIn(expired), true);
	assert.equal(
		needsSignIn(profile("acme", "sso", "expired_refreshable")),
		false,
	);
	assert.equal(needsSignIn(profile("p", "static")), false);

	const first = signInCopy(missing, false);
	assert.equal(first.title, "This profile is not signed in to AWS yet");
	assert.doesNotMatch(first.title + first.body, /expired/);
	assert.equal(first.nothingSaved, null);

	const lapsed = signInCopy(expired, false);
	assert.equal(lapsed.title, "This SSO session has expired");
	assert.equal(lapsed.body, "Sign in again to refresh it.");
	assert.equal(lapsed.nothingSaved, null);
	assert.equal(signInCopy(expired, true).nothingSaved, "Nothing was saved.");
});

test("D3: the Region help names the profile when the profile supplies the Region", () => {
	const context = {
		default_region: "us-east-1",
		default_region_source: "fallback",
	};
	const withRegion = profile("ci", "assume_role", "not_applicable", {
		region: "us-west-2",
	});
	assert.equal(
		regionHelp(context, withRegion, true),
		"Default: us-west-2, from the profile.",
	);
	assert.equal(
		regionHelp(context, profile("p", "static"), true),
		"Default: us-east-1, from the built-in default.",
	);
	// A key method never reads a profile's Region.
	assert.equal(
		regionHelp(context, withRegion, false),
		"Default: us-east-1, from the built-in default.",
	);
});

test("R3: the access key ID and a typed Region are held to the server's bounds, with a reason", () => {
	assert.equal(accessKeyIdError(""), null);
	assert.equal(accessKeyIdError(KEY_ID), null);
	assert.match(
		accessKeyIdError("akia0123456789abcdef"),
		/not an AWS access key ID/,
	);
	assert.match(accessKeyIdError(KEY_ID.slice(0, 8)), /16 to 128/);
	assert.equal(customRegionError(" eu-central-1 "), null);
	assert.equal(
		customRegionError("Frankfurt"),
		"Frankfurt is not an AWS Region id (for example us-east-1).",
	);
	assert.notEqual(customRegionError(`us-${"a".repeat(40)}-1`), null);

	const form = {
		method: "access_key",
		region: "us-east-1",
		profile: null,
		apiKey: "",
		accessKeyId: "akia0123456789abcdef",
		secretAccessKey: "synthetic-secret",
		sessionToken: "",
	};
	// Never sent while the ID is malformed: main's schema would refuse it
	// with a sentence that names no field.
	assert.equal(connectionInput(form), null);
	assert.deepEqual(connectionInput({ ...form, accessKeyId: ` ${KEY_ID} ` }), {
		method: "access_key",
		region: "us-east-1",
		access_key_id: KEY_ID,
		secret_access_key: "synthetic-secret",
		session_token: null,
	});
	assert.deepEqual(
		connectionInput({ ...form, method: "sso", profile: PROFILES[0] }),
		{ method: "profile", profile: "acme-dev-sso", region: "us-east-1" },
	);
	assert.deepEqual(
		connectionInput({ ...form, method: DEFAULT_CREDENTIALS, region: null }),
		{ method: DEFAULT_CREDENTIALS, region: null },
	);
});

test("R3: secrets survive a refusal of the input's shape, not one of the credentials", () => {
	const err = (status, code) => Object.assign(new Error("x"), { status, code });
	assert.equal(keepsSecretsAfter(err(422, undefined)), true);
	assert.equal(keepsSecretsAfter(err(422, "bedrock_input_invalid")), true);
	assert.equal(keepsSecretsAfter(err(422, "bedrock_region_invalid")), true);
	assert.equal(
		keepsSecretsAfter(err(422, "bedrock_credentials_rejected")),
		false,
	);
	assert.equal(keepsSecretsAfter(err(null, undefined)), false);
	assert.equal(keepsSecretsAfter(new Error("plain")), false);
	assert.equal(outcomeUnknown(err(null, undefined)), true);
	assert.equal(outcomeUnknown(err(504, "deadline_exceeded")), true);
	assert.equal(outcomeUnknown(err(422, "bedrock_sso_expired")), false);
});

test("D2/R4: a failed Check says why; only the backend's 4xx is 'Not working'", () => {
	const deadline = Object.assign(
		new Error("The backend did not answer within 90 seconds."),
		{ status: null },
	);
	const unverified = checkResultFromError(deadline);
	assert.deepEqual(unverified, {
		valid: null,
		reason: "The backend did not answer within 90 seconds.",
		code: null,
	});
	const shown = checkVerdict(unverified);
	assert.equal(shown.tone, "neutral");
	assert.equal(shown.text, "Not verified");
	assert.equal(shown.detail, "The backend did not answer within 90 seconds.");

	// The transport's own deadline is a 504 with its code: still "could not tell".
	assert.equal(
		checkResultFromError(
			Object.assign(new Error("timed out"), {
				status: 504,
				code: "deadline_exceeded",
			}),
		).valid,
		null,
	);

	const rejected = checkResultFromError(
		Object.assign(new Error("AWS rejected the key."), {
			status: 422,
			code: "bedrock_credentials_rejected",
		}),
	);
	assert.equal(rejected.valid, false);
	assert.equal(checkVerdict(rejected).tone, "danger");
	assert.equal(checkVerdict(rejected).detail, "AWS rejected the key.");
	// A rejection with no sentence still gets one: the heading for its code.
	assert.equal(
		checkVerdict({ valid: false, reason: null, code: "bedrock_sso_expired" })
			.detail,
		"This SSO session has expired",
	);
	assert.equal(
		checkVerdict({ valid: true, reason: null, code: null }).detail,
		null,
	);
	assert.equal(checkVerdict(null), null);
});

test("R6: the hand-run command quotes the profile and uses aws login for login profiles", () => {
	assert.equal(
		signInCommand(profile("acme dev", "sso", "expired")),
		"aws sso login --profile 'acme dev'",
	);
	assert.equal(
		signInCommand(profile("console", "login", "missing")),
		"aws login --profile console",
	);
	assert.equal(
		signInCommand(profile("it's", "sso", "expired")),
		`aws sso login --profile 'it'"'"'s'`,
	);
	// The backend's own command wins when it sends one.
	assert.equal(
		signInCommand(
			profile("x", "sso", "expired", {
				session: {
					state: "expired",
					expires_at: null,
					login_command: "aws sso login --profile x",
				},
			}),
		),
		"aws sso login --profile x",
	);
});

test("R2: each profile's sign-in runs under its own session key", () => {
	assert.notEqual(ssoSessionKey("a"), ssoSessionKey("b"));
	assert.equal(ssoSessionKey("a"), ssoSessionKey("a"));
});

test("the AWS panel needs both the aws method and features.bedrock_auth", () => {
	const row = {
		auth_methods: [
			{
				id: "bedrock",
				method_id: "bedrock",
				label: "AWS account",
				kind: "aws",
			},
			{
				id: "bedrock",
				method_id: "bedrock:api-key",
				label: "API key",
				kind: "api_key",
			},
		],
	};
	assert.equal(awsPanelAvailable(row, true), true);
	assert.equal(awsPanelAvailable(row, false), false);
	assert.equal(
		awsPanelAvailable({ auth_methods: [row.auth_methods[1]] }, true),
		false,
	);
});
