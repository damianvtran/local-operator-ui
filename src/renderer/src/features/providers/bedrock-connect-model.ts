/**
 * The Amazon Bedrock connect panel's decisions, kept apart from its markup.
 *
 * ## Why a separate module
 *
 * Review round 1 (R5) found every rule the panel applies - which profiles a
 * tab lists, when a sign-in is needed, which secret survives a refusal, what a
 * failed Check is called - reachable only through Storybook. These are pure
 * functions of the AWS context and the form state, so they live here, where
 * `scripts/bedrock-connect-model.test.mjs` bundles them in Node without a DOM
 * or the UI kit, and the panel only arranges what they return.
 *
 * ## Vocabulary (design round 1, D1)
 *
 * The method names, their order and the profile-kind badges are the SAME words
 * the terminal login uses (local-operator `wire.login.bedrock.*`): AWS profile
 * · AWS SSO · Access key · Bedrock API key · Default credentials. "AWS
 * profile" lists the profiles that sign on their own (static keys, assume
 * role, credential process, web identity); "AWS SSO" lists the ones that need
 * an IAM Identity Center or `aws login` sign-in. A person following a
 * teammate's screenshot from either surface finds the same words in the same
 * order.
 */

import { t } from "@shared/i18n";
import { formatDateTime } from "@shared/i18n";
import type {
	BedrockAwsContext,
	BedrockCheckResult,
	BedrockConnectionInput,
	BedrockProfile,
	BedrockProfileKind,
	DesktopProvider,
} from "../../../../shared/desktop-contract";

/** The panel's five ways in; SSO and AWS profile both submit `method: "profile"`. */
export type BedrockMethod =
	| "profile"
	| "sso"
	| "access_key"
	| "api_key"
	| "ambient";

/** Tab order, identical to the terminal's method list (D1). */
export const BEDROCK_METHODS: readonly BedrockMethod[] = [
	"profile",
	"sso",
	"access_key",
	"api_key",
	"ambient",
];

/** Profiles whose session the AWS CLI's SSO/login flow refreshes. */
const SSO_KINDS: ReadonlySet<BedrockProfileKind> = new Set(["sso", "login"]);

export const isSsoProfile = (profile: BedrockProfile): boolean =>
	SSO_KINDS.has(profile.kind);

/*
 * The server's own input bounds (local-operator
 * `local_operator/providers/bedrock/profiles.py`: `REGION_INPUT_RE`,
 * `ACCESS_KEY_ID_RE`) and the contract's (`desktop-contract.ts` `awsRegion`
 * max 32, `access_key_id`). Checked here so a malformed value gets a sentence
 * that names the problem instead of main's schema refusal ("Invalid desktop
 * operation."), which cannot say which field was wrong (R3).
 */
export const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const AWS_REGION_MAX = 32;
export const ACCESS_KEY_ID = /^[A-Z0-9]{16,128}$/;

/** The profiles a tab lists: SSO/login kinds on AWS SSO, every other kind on AWS profile. */
export function profilesFor(
	method: BedrockMethod,
	profiles: readonly BedrockProfile[],
): BedrockProfile[] {
	if (method === "sso") return profiles.filter(isSsoProfile);
	if (method === "profile")
		return profiles.filter((profile) => !isSsoProfile(profile));
	return [];
}

/**
 * The first method a person most likely wants: an SSO profile if the machine
 * has one (the common corporate setup), a self-signing profile next, else the
 * Bedrock API key - the one method that needs nothing on this computer.
 */
export function defaultMethod(
	profiles: readonly BedrockProfile[],
): BedrockMethod {
	if (profilesFor("sso", profiles).length > 0) return "sso";
	if (profilesFor("profile", profiles).length > 0) return "profile";
	return "api_key";
}

export const methodLabel = (method: BedrockMethod): string => {
	switch (method) {
		case "profile":
			return t("ui.providers.bedrock.tab_profile");
		case "sso":
			return t("ui.providers.bedrock.tab_sso");
		case "access_key":
			return t("ui.providers.bedrock.tab_access_key");
		case "api_key":
			return t("ui.providers.bedrock.tab_api_key");
		case "ambient":
			return t("ui.providers.bedrock.tab_ambient");
	}
};

/** The one line under the tab strip saying what the chosen method uses (D1). */
export function methodDescription(
	method: BedrockMethod,
	profiles: readonly BedrockProfile[],
): string {
	switch (method) {
		case "profile":
			return t("ui.providers.bedrock.method_profile_desc", {
				count: profilesFor("profile", profiles).length,
			});
		case "sso":
			return t("ui.providers.bedrock.method_sso_desc", {
				count: profilesFor("sso", profiles).length,
			});
		case "access_key":
			return t("ui.providers.bedrock.method_access_key_desc");
		case "api_key":
			return t("ui.providers.bedrock.method_api_key_desc");
		case "ambient":
			return t("ui.providers.bedrock.method_ambient_desc");
	}
}

export const kindLabel = (kind: BedrockProfileKind): string => {
	switch (kind) {
		case "static":
			return t("ui.providers.bedrock.kind_static");
		case "sso":
			return t("ui.providers.bedrock.kind_sso");
		case "login":
			return t("ui.providers.bedrock.kind_login");
		case "assume_role":
			return t("ui.providers.bedrock.kind_assume_role");
		case "process":
			return t("ui.providers.bedrock.kind_process");
		case "web_identity":
			return t("ui.providers.bedrock.kind_web_identity");
		default:
			return t("ui.providers.bedrock.kind_other");
	}
};

/**
 * The session badge for a profile, or null when sessions do not apply (a
 * static key pair has no session to expire). `expired_refreshable` is NOT a
 * warning: botocore refreshes it with the stored refresh token on first use,
 * so telling the user to sign in again would be a false alarm.
 */
export function sessionBadge(
	profile: BedrockProfile,
): { text: string; tone: "success" | "warning" | "neutral" } | null {
	const { state, expires_at: expiresAt } = profile.session;
	switch (state) {
		case "valid":
			return {
				text: expiresAt
					? t("ui.providers.bedrock.session_valid_until", {
							time: formatDateTime(new Date(expiresAt), {
								hour: "numeric",
								minute: "2-digit",
							}),
						})
					: t("ui.providers.bedrock.session_valid"),
				tone: "success",
			};
		case "expired_refreshable":
			return {
				text: t("ui.providers.bedrock.session_refreshes"),
				tone: "neutral",
			};
		case "expired":
			return {
				text: t("ui.providers.bedrock.session_expired"),
				tone: "warning",
			};
		case "missing":
			return {
				text: t("ui.providers.bedrock.session_missing"),
				tone: "warning",
			};
		default:
			return null;
	}
}

/** Whether a profile needs an SSO sign-in before it can sign requests. */
export const needsSignIn = (profile: BedrockProfile | null): boolean =>
	profile !== null &&
	isSsoProfile(profile) &&
	(profile.session.state === "expired" || profile.session.state === "missing");

/**
 * The sign-in block's words (D4, QA Q2). A profile that was NEVER signed in
 * (`missing`) is not told its session "expired", and "Nothing was saved." is
 * said only after a Connect the backend refused - on first view nothing was
 * attempted, so there was nothing to not save.
 */
export function signInCopy(
	profile: BedrockProfile,
	afterRefusedConnect: boolean,
): { title: string; body: string; nothingSaved: string | null } {
	const neverSignedIn = profile.session.state === "missing";
	return {
		title: neverSignedIn
			? t("ui.providers.bedrock.sso_missing_title")
			: t("ui.providers.bedrock.sso_expired_title"),
		body: neverSignedIn
			? t("ui.providers.bedrock.sso_missing_body")
			: t("ui.providers.bedrock.sso_expired_body"),
		nothingSaved: afterRefusedConnect
			? t("ui.providers.bedrock.nothing_saved")
			: null,
	};
}

/** The heading for a refused connect, by the backend's `bedrock_*` code. */
export function refusalTitle(code: string | null | undefined): string {
	switch (code) {
		case "bedrock_credentials_rejected":
			return t("ui.providers.bedrock.error_credentials_rejected");
		case "bedrock_sso_expired":
			return t("ui.providers.bedrock.sso_expired_title");
		case "bedrock_profile_not_found":
			return t("ui.providers.bedrock.error_profile_not_found");
		case "bedrock_region_invalid":
			return t("ui.providers.bedrock.error_region_invalid");
		case "bedrock_no_credentials":
			return t("ui.providers.bedrock.error_no_credentials");
		default:
			return t("ui.providers.bedrock.error_generic");
	}
}

const regionSourceLabel = (
	source: BedrockAwsContext["default_region_source"],
): string => {
	switch (source) {
		case "config":
			return t("ui.providers.bedrock.region_source_config");
		case "profile":
			return t("ui.providers.bedrock.region_source_profile");
		case "fallback":
			return t("ui.providers.bedrock.region_source_fallback");
		default:
			// AWS_REGION / AWS_DEFAULT_REGION: an env var name is a machine
			// token and stays untranslated.
			return source;
	}
};

/**
 * The Region field's help line, naming where the default ACTUALLY comes from
 * (D3). A profile with its own Region wins over the backend's default for an
 * unsaved connection (the backend's `effective_region` order), so the line
 * must say "from the profile" rather than the machine-wide source the field
 * is no longer showing.
 */
export function regionHelp(
	context: Pick<BedrockAwsContext, "default_region" | "default_region_source">,
	profile: BedrockProfile | null,
	usesProfile: boolean,
): string {
	if (usesProfile && profile?.region)
		return t("ui.providers.bedrock.region_help", {
			region: profile.region,
			source: regionSourceLabel("profile"),
		});
	return t("ui.providers.bedrock.region_help", {
		region: context.default_region,
		source: regionSourceLabel(context.default_region_source),
	});
}

/** The sentence for a typed Region the backend would refuse, or null when it is fine. */
export function customRegionError(text: string): string | null {
	const typed = text.trim();
	if (typed.length <= AWS_REGION_MAX && AWS_REGION.test(typed)) return null;
	return t("ui.providers.bedrock.region_invalid", { region: typed });
}

/** The sentence for an access key ID the contract would refuse, or null (empty is "not yet"). */
export function accessKeyIdError(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === "" || ACCESS_KEY_ID.test(trimmed)) return null;
	return t("ui.providers.bedrock.access_key_id_invalid");
}

export type BedrockForm = {
	method: BedrockMethod;
	region: string | null;
	profile: BedrockProfile | null;
	apiKey: string;
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
};

/**
 * The request a form state submits, or null when it is not submittable yet.
 * An access key ID that fails the contract's bound is "not yet", never sent:
 * main's schema would refuse it with a sentence that names no field (R3).
 */
export function connectionInput(
	form: BedrockForm,
): BedrockConnectionInput | null {
	const { method, region } = form;
	if (method === "ambient") return { method: "ambient", region };
	if (!region) return null;
	if (method === "api_key") {
		const apiKey = form.apiKey.trim();
		return apiKey ? { method: "api_key", region, api_key: apiKey } : null;
	}
	if (method === "access_key") {
		const id = form.accessKeyId.trim();
		const secret = form.secretAccessKey.trim();
		if (!id || !secret || accessKeyIdError(id) !== null) return null;
		return {
			method: "access_key",
			region,
			access_key_id: id,
			secret_access_key: secret,
			session_token: form.sessionToken.trim() || null,
		};
	}
	return form.profile
		? { method: "profile", profile: form.profile.name, region }
		: null;
}

/** What the panel reads off a rejected desktop request; `DesktopControlError` fits it. */
export type RequestFailure = {
	status?: number | null;
	code?: string;
	message?: string;
};

const failureOf = (error: unknown): RequestFailure =>
	typeof error === "object" && error !== null ? (error as RequestFailure) : {};

/**
 * Whether the typed secrets survive a refused Connect (R3).
 *
 * They are cleared once AWS has judged them - a key AWS just rejected is not
 * worth keeping in memory - and after a transport failure, whose request may
 * have been stored. A refusal of the INPUT's shape (main's schema 422, which
 * carries no code; the backend's `bedrock_input_invalid`; a Region that does
 * not serve Bedrock) never reached the credential check, so wiping a correct
 * secret there would only make the user paste it again to fix another field.
 */
export function keepsSecretsAfter(error: unknown): boolean {
	const { status, code } = failureOf(error);
	if (status !== 422) return false;
	return (
		code === undefined ||
		code === "bedrock_input_invalid" ||
		code === "bedrock_region_invalid"
	);
}

/**
 * Whether a failed request may have been carried out anyway. No status (IPC
 * never settled) and a 5xx - including the transport's own 504
 * `deadline_exceeded`, which means the app stopped waiting while the backend
 * kept going - carry no verdict, and a connect the app abandoned can still be
 * stored afterwards.
 */
export const outcomeUnknown = (error: unknown): boolean => {
	const { status } = failureOf(error);
	return status == null || status >= 500;
};

/**
 * A saved-connection Check that rejected (R4). Only the BACKEND's 4xx is a
 * verdict on the credentials; a deadline or an offline backend means "could
 * not tell", which is the backend's own `valid: null`, never a red "Not
 * working" for a connection nobody actually checked.
 */
export function checkResultFromError(error: unknown): BedrockCheckResult {
	const { status, code, message } = failureOf(error);
	const judged = typeof status === "number" && status >= 400 && status < 500;
	return {
		valid: judged ? false : null,
		reason: message ? message : null,
		code: judged ? (code ?? null) : null,
	};
}

/**
 * A Check result as the row shows it (D2): the badge, plus the reason as a
 * visible line - not only in a hover title keyboard and touch users never see.
 */
export function checkVerdict(result: BedrockCheckResult | null): {
	tone: "success" | "neutral" | "danger";
	text: string;
	detail: string | null;
} | null {
	if (result === null) return null;
	if (result.valid === true)
		return {
			tone: "success",
			text: t("ui.providers.bedrock.check_ok"),
			detail: null,
		};
	if (result.valid === null)
		return {
			tone: "neutral",
			text: t("ui.providers.bedrock.check_unverified"),
			detail: result.reason,
		};
	return {
		tone: "danger",
		text: t("ui.providers.bedrock.check_failed"),
		detail: result.reason ?? refusalTitle(result.code),
	};
}

/**
 * The sign-in session's registry key, one per profile (R2). A single shared
 * key let profile A's device code, waiting state and Cancel show on profile
 * B, and its failure linger there; per-profile keys keep each run where it
 * was started, and switching back to A finds A's run still going.
 */
export const ssoSessionKey = (profileName: string): string =>
	`bedrock-sso:${profileName}`;

/*
 * POSIX shell quoting with the same safe set as Python's `shlex.quote`, which
 * the backend applies to its own `login_command`: a profile name may contain
 * spaces, `/` or `@` (`PROFILE_INPUT_RE`), and a command the user pastes must
 * address exactly that profile.
 */
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;
export const shellQuote = (value: string): string =>
	value !== "" && SHELL_SAFE.test(value)
		? value
		: `'${value.replace(/'/g, `'"'"'`)}'`;

/**
 * The command that signs a profile in by hand. The backend's own is preferred;
 * the fallback mirrors it (R6): `aws login` for console sign-in profiles,
 * `aws sso login` for IAM Identity Center ones, the name quoted.
 */
export function signInCommand(profile: BedrockProfile): string {
	if (profile.session.login_command) return profile.session.login_command;
	const verb = profile.kind === "login" ? "login" : "sso login";
	return `aws ${verb} --profile ${shellQuote(profile.name)}`; // i18n: ignore AWS CLI syntax the user runs verbatim
}

/**
 * Whether the provider panel renders the AWS panel: the census row must offer
 * the `aws` method AND the backend must advertise `features.bedrock_auth`
 * (the four `auth.bedrock.*` routes). Either missing, the provider falls back
 * to the plain API-key field every backend with a `bedrock` row serves.
 */
export const awsPanelAvailable = (
	provider: Pick<DesktopProvider, "auth_methods">,
	bedrockAuthFeature: boolean,
): boolean =>
	bedrockAuthFeature &&
	provider.auth_methods.some((method) => method.kind === "aws");
