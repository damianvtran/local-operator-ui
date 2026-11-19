/**
 * Amazon Bedrock's AWS panel, every state the bedrock design §11 asks Slice B
 * to show, each reachable by a story id.
 *
 * ## What is real here, and what is scripted
 *
 * The component under test is the production `ProviderDetail` on its
 * production path: it reads `capabilities`, licenses the AWS panel from
 * `features.bedrock_auth`, and the panel reads `auth.bedrock.context`, sends
 * `auth.bedrock.connect` and drives `auth.bedrock.ssoLogin` through the real
 * `sign-in-flow.ts`. Only the DESKTOP BRIDGE (`window.api.desktop.request`) is
 * a stub, answering in the §7 contract's shapes. The core routes (Slice A2)
 * were being built in parallel when these were written, so these fixtures ARE
 * the contract as the renderer reads it; a shape change on either side should
 * change them in the same PR.
 *
 * Every profile name, account and key on this page is fixture data. No
 * credential is real and nothing leaves the page.
 *
 * Stories whose state follows a press (connected, refused, unverified) carry a
 * `play` that presses Connect, so a capture of the settled frame shows the
 * state rather than the form.
 */

import { SettingsSection } from "@features/settings/components/settings-section";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import type { FC } from "react";
import type {
	AuthOperation,
	BedrockAwsContext,
	BedrockConnectResult,
	DesktopProvider,
} from "../../../../shared/desktop-contract";
import { ProviderDetail } from "./provider-detail";
import { resetSignInSessions } from "./sign-in-sessions";
import "../../styles/index.css";

type BridgeRequest = { op?: string; connection?: { method?: string } };
type DesktopResponse = { status: number; body: unknown };

type Scenario =
	/** The AWS context never answers: the panel's loading line. */
	| "loading"
	/** No ~/.aws at all: profile tabs say so and point at the key methods. */
	| "empty"
	/** Profiles of every kind, one SSO session valid. */
	| "profiles"
	/** The chosen SSO profile's session has expired: the sign-in action. */
	| "sso-expired"
	/** The same, with no AWS CLI on PATH: the command to run instead. */
	| "sso-no-cli"
	/** The SSO sign-in is running: the device code and Cancel. */
	| "sso-waiting"
	/** An aws login profile that was never signed in (session `missing`). */
	| "sso-missing"
	/** Two SSO profiles need sign-in; one run belongs to the first only. */
	| "sso-two-profiles"
	/** A saved connection's Check: AWS rejected it (422). */
	| "check-failed"
	/** A saved connection's Check: the app stopped waiting (504 deadline). */
	| "check-unverified"
	/** Access-key tab with a malformed key ID and a typed non-Region. */
	| "invalid-input"
	/** Connect answered 422 `bedrock_credentials_rejected`. */
	| "rejected"
	/** Credentials work but cannot list models (403): saved, unverified. */
	| "access-denied"
	/** The probe timed out: saved, unverified. */
	| "unverified"
	/** The AWS context read failed. */
	| "context-error"
	/** Connect verified, 12 models reachable. */
	| "connected"
	/** A backend without `features.bedrock_auth`: the plain API-key panel. */
	| "no-capability";

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});
const refused = (status: number, code: string, text: string) => ({
	status,
	body: { detail: { code, params: {}, text } },
});

/* The census row the core side will send (bedrock design §7 route 1). */
const BEDROCK: DesktopProvider = {
	id: "bedrock",
	name: "Amazon Bedrock",
	storage_id: "bedrock",
	search_aliases: ["aws", "bedrock"],
	auth_methods: [
		{
			id: "bedrock",
			method_id: "bedrock",
			label: "AWS account",
			kind: "aws",
			requires_secret_input: false,
			paste_fallback: false,
		},
		{
			id: "bedrock",
			method_id: "bedrock:api-key",
			label: "API key",
			kind: "api_key",
			requires_secret_input: true,
			paste_fallback: false,
		},
	],
	local: false,
	configured: false,
	credential_optional: false,
	has_credential: false,
	stored_credentials: 0,
	base_url: null,
	suggested_model: {
		id: "global.anthropic.claude-opus-5-5",
		name: "Claude Opus 5.5",
	},
};

const REGIONS = [
	{ id: "us-east-1", label: "US East (N. Virginia)", geo_prefix: "us" },
	{ id: "us-west-2", label: "US West (Oregon)", geo_prefix: "us" },
	{ id: "ca-central-1", label: "Canada (Central)", geo_prefix: "ca" },
	{ id: "eu-central-1", label: "Europe (Frankfurt)", geo_prefix: "eu" },
	{ id: "eu-west-1", label: "Europe (Ireland)", geo_prefix: "eu" },
	{ id: "ap-northeast-1", label: "Asia Pacific (Tokyo)", geo_prefix: "apac" },
];

const inTwoHours = new Date(Date.now() + 2 * 3600_000).toISOString();

const context = (scenario: Scenario): BedrockAwsContext => {
	const base: BedrockAwsContext = {
		regions: REGIONS,
		default_region: "us-east-1",
		default_region_source: "fallback",
		profiles: [
			{
				name: "acme-dev-sso",
				kind: "sso",
				region: "us-west-2",
				session: {
					state: "valid",
					expires_at: inTwoHours,
					login_command: "aws sso login --profile acme-dev-sso",
				},
			},
			{
				name: "acme-prod-sso",
				kind: "sso",
				region: "ca-central-1",
				session: {
					state: "expired_refreshable",
					expires_at: null,
					login_command: "aws sso login --profile acme-prod-sso",
				},
			},
			{
				name: "personal",
				kind: "static",
				region: null,
				session: {
					state: "not_applicable",
					expires_at: null,
					login_command: null,
				},
			},
			{
				name: "ci-deploy",
				kind: "assume_role",
				region: "eu-central-1",
				session: {
					state: "not_applicable",
					expires_at: null,
					login_command: null,
				},
			},
		],
		aws_cli_available: true,
		ambient: { enabled: false, sources: ["env:AWS_PROFILE"] },
		connections: [],
	};
	if (scenario === "empty")
		return {
			...base,
			profiles: [],
			aws_cli_available: false,
			ambient: { enabled: false, sources: [] },
		};
	if (
		scenario === "sso-expired" ||
		scenario === "sso-no-cli" ||
		scenario === "sso-waiting"
	) {
		const [first, ...rest] = base.profiles;
		return {
			...base,
			aws_cli_available: scenario !== "sso-no-cli",
			profiles: [
				{
					...first,
					session: { ...first.session, state: "expired", expires_at: null },
				},
				...rest,
			],
		};
	}
	if (scenario === "sso-missing") {
		const [, ...rest] = base.profiles;
		return {
			...base,
			profiles: [
				{
					name: "acme-console",
					kind: "login",
					region: "us-west-2",
					session: {
						state: "missing",
						expires_at: null,
						login_command: null,
					},
				},
				...rest,
			],
		};
	}
	if (scenario === "sso-two-profiles") {
		const [first, second, ...rest] = base.profiles;
		const expired = { state: "expired" as const, expires_at: null };
		return {
			...base,
			profiles: [
				{ ...first, session: { ...first.session, ...expired } },
				{ ...second, session: { ...second.session, ...expired } },
				...rest,
			],
		};
	}
	if (
		scenario === "profiles" ||
		scenario === "check-failed" ||
		scenario === "check-unverified"
	)
		return {
			...base,
			connections: [
				{
					credential_id: 12,
					method: "profile",
					profile: "acme-dev-sso",
					region: "us-west-2",
					label: "acme-dev-sso · us-west-2",
				},
			],
		};
	return base;
};

const SSO_WAITING: AuthOperation = {
	id: "op-bedrock-sso",
	provider: "bedrock",
	state: "waiting",
	message: "Waiting for AWS sign-in for acme-dev-sso.",
	auth_url: "https://device.sso.us-west-2.amazonaws.com/?user_code=WDKX-QPLM",
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 600,
	user_code: "WDKX-QPLM",
};

const connectResult = (scenario: Scenario): DesktopResponse => {
	switch (scenario) {
		case "rejected":
			return refused(
				422,
				"bedrock_credentials_rejected",
				"AWS did not recognise the credentials in profile acme-dev-sso (UnrecognizedClientException). Check the profile in ~/.aws/config. Nothing was saved.",
			);
		case "access-denied":
			return ok({
				valid: null,
				reason:
					"These credentials work but are not allowed to list Bedrock models (bedrock:ListInferenceProfiles). The built-in model list will be used.",
				credential_id: 13,
				label: "personal · us-east-1",
				models_available: null,
				defaults_applied: null,
			} satisfies BedrockConnectResult);
		case "unverified":
			return ok({
				valid: null,
				reason:
					"Amazon Bedrock in us-east-1 did not answer within 15 seconds. The connection was saved and will be tried when you send a message.",
				credential_id: 14,
				label: "personal · us-east-1",
				models_available: null,
				defaults_applied: null,
			} satisfies BedrockConnectResult);
		default:
			return ok({
				valid: true,
				reason: null,
				credential_id: 15,
				label: "acme-dev-sso · us-west-2",
				models_available: 12,
				defaults_applied: {
					hosting: "bedrock",
					model: "bedrock/us.anthropic.claude-opus-5-5",
					model_name: "Claude Opus 5.5",
					receipt:
						"Claude Opus 5.5 on Amazon Bedrock is now your default model.",
				},
			} satisfies BedrockConnectResult);
	}
};

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;
const never = new Promise<DesktopResponse>(() => {});

/*
 * The sign-in sessions are module-level (they outlive a panel by design), so a
 * story starts from a clean registry - once per story, not per render: a reset
 * on every render would drop the SSO flow the waiting story just started.
 */
let installedScenario: Scenario | null = null;
const installBridge = (scenario: Scenario) => {
	if (installedScenario !== scenario) {
		resetSignInSessions();
		installedScenario = scenario;
	}
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features:
						scenario === "no-capability"
							? { auth: 1 }
							: { auth: 1, bedrock_auth: 1 },
				});
			case "auth.bedrock.context":
				if (scenario === "loading") return never;
				if (scenario === "context-error")
					return refused(
						500,
						"bedrock_context_failed",
						"~/.aws/config could not be parsed: line 14 is not a section or a key.",
					);
				return ok(context(scenario));
			case "auth.bedrock.connect":
				return connectResult(scenario);
			case "auth.bedrock.ssoLogin":
				return ok(SSO_WAITING);
			case "auth.status":
				return ok(SSO_WAITING);
			case "auth.bedrock.check":
				if (scenario === "check-unverified")
					return refused(
						504,
						"deadline_exceeded",
						"The app stopped waiting for the backend after 90 seconds. The check may still be running.",
					);
				if (scenario === "check-failed")
					return refused(
						422,
						"bedrock_sso_expired",
						"The SSO session for profile acme-dev-sso has expired. Run aws sso login --profile acme-dev-sso, then check again.",
					);
				return ok({ valid: true, reason: null, code: null });
			case "config.get":
				return ok({ values: { hosting: "bedrock" } });
			default:
				// Everything else the panel's neighbours read (the Radient verdict,
				// the account) is absent from this fixture, as on a backend without it.
				return { status: 404, body: { detail: "not in this fixture" } };
		}
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
		__openedAuth?: string[];
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
	};
}

/*
 * The row a SAVED connection leaves behind. In the app the grid re-reads the
 * census after a connect (`refreshProviders`) and hands the panel the stored
 * row, whose verdict the receipt repeats; a static fixture row would instead
 * paint the never-configured verdict ("Needs sign-in") over a fresh success.
 * The post-connect stories therefore render the row as it is after that read.
 */
const SAVED_SCENARIOS: ReadonlySet<Scenario> = new Set([
	"connected",
	"access-denied",
	"unverified",
]);
const rowFor = (scenario: Scenario): DesktopProvider =>
	SAVED_SCENARIOS.has(scenario)
		? {
				...BEDROCK,
				configured: true,
				has_credential: true,
				stored_credentials: 1,
				identity: "acme-dev-sso · us-west-2",
				account_count: 1,
			}
		: BEDROCK;

/** Installed as the story RENDERS, so the first read never meets "no bridge". */
const Frame: FC<{ scenario: Scenario }> = ({ scenario }) => {
	installBridge(scenario);
	return (
		<div className="min-h-screen bg-canvas p-8">
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
				<SettingsSection
					title="Amazon Bedrock"
					description="Fixture frame: every profile, account and key on this page is stub data."
				>
					<ProviderDetail provider={rowFor(scenario)} />
				</SettingsSection>
			</div>
		</div>
	);
};

const meta: Meta<{ scenario: Scenario }> = {
	title: "Providers/Amazon Bedrock",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<{ scenario: Scenario }>;

const CONNECT = /^Connect$/;
const SIGN_IN_SSO = /Sign in with AWS SSO/;
const ACCESS_KEY_TAB = /Access key/;
const PROFILE_TAB = /^AWS profile$/;
const CHECK = /^Check$/;

const story = (scenario: Scenario, play?: Story["play"]) =>
	({
		args: { scenario },
		render: () => <Frame scenario={scenario} />,
		...(play ? { play } : {}),
	}) satisfies Story;

const pressConnect = async () => {
	await userEvent.click(await screen.findByRole("button", { name: CONNECT }));
};

/** Reading ~/.aws: one line and a spinner. */
export const Loading: Story = story("loading");
/** No AWS configuration on this computer; the API-key tab is offered first. */
export const EmptyNoAwsConfig: Story = story("empty");
/** SSO tab with a valid session, its Region, and one saved connection. */
export const SsoSignedIn: Story = story("profiles");
/** Every profile kind with its badge (Profile tab). */
export const ProfilePicker: Story = story("profiles", async () => {
	await userEvent.click(await screen.findByRole("tab", { name: PROFILE_TAB }));
});
/** The chosen SSO session has expired; Connect waits on the sign-in. */
export const SsoExpired: Story = story("sso-expired");
/** No AWS CLI: the command to run by hand replaces the button. */
export const SsoExpiredNoCli: Story = story("sso-no-cli");
/** The SSO sign-in is running: device code, open-page and Cancel. */
export const SsoWaiting: Story = story("sso-waiting", async () => {
	await userEvent.click(
		await screen.findByRole("button", { name: SIGN_IN_SSO }),
	);
});
/** Access-key tab (masked secret and optional session token). */
export const AccessKeyForm: Story = story("profiles", async () => {
	await userEvent.click(
		await screen.findByRole("tab", { name: ACCESS_KEY_TAB }),
	);
});
/**
 * AWS rejected the credentials (422): heading by code, backend's sentence.
 * Driven from the profile tab: the play only has to press Connect, so the
 * frame does not depend on synthetic typing into masked fields.
 */
export const Rejected: Story = story("rejected", async () => {
	await userEvent.click(await screen.findByRole("tab", { name: PROFILE_TAB }));
	await pressConnect();
});
/** Credentials work but cannot list models: saved, unverified, AWS's reason. */
export const AccessDenied: Story = story("access-denied", pressConnect);
/** The probe timed out: saved, unverified. */
export const Unverified: Story = story("unverified", pressConnect);
/** The AWS context could not be read. */
export const ContextError: Story = story("context-error");
/** Verified: connection label, model count and the default-model receipt. */
export const Connected: Story = story("connected", pressConnect);
/** A backend without `features.bedrock_auth`: the plain API-key panel only. */
export const NoCapabilityFallback: Story = story("no-capability");
/** An aws login profile never signed in: "not signed in yet", no "Nothing was saved." */
export const SsoNeverSignedIn: Story = story("sso-missing");
/**
 * Per-profile sign-in (R2): the run started for acme-dev-sso stays with it;
 * picking acme-prod-sso shows that profile's own Sign in button, and the
 * key tabs' Connect is not held by the other profile's run.
 */
export const SsoPerProfile: Story = story("sso-two-profiles", async () => {
	await userEvent.click(
		await screen.findByRole("button", { name: SIGN_IN_SSO }),
	);
	await screen.findByText(/WDKX-QPLM/);
	await userEvent.click(
		await screen.findByRole("combobox", { name: /AWS profile/ }),
	);
	await userEvent.click(
		await screen.findByRole("option", { name: /acme-prod-sso/ }),
	);
});
/** A saved connection's Check that AWS refused: the reason is a visible line. */
export const CheckFailed: Story = story("check-failed", async () => {
	await userEvent.click(await screen.findByRole("button", { name: CHECK }));
	await screen.findByText(/has expired/);
});
/** A Check the app stopped waiting for: "Not verified", neutral, with the reason. */
export const CheckUnverified: Story = story("check-unverified", async () => {
	await userEvent.click(await screen.findByRole("button", { name: CHECK }));
	await screen.findByText(/stopped waiting/);
});
/** Inline validation: a lower-case key ID and a typed Region AWS has no such id for. */
export const InvalidInput: Story = story("invalid-input", async () => {
	await userEvent.click(
		await screen.findByRole("tab", { name: ACCESS_KEY_TAB }),
	);
	await userEvent.type(
		await screen.findByLabelText(/Access key ID/),
		"akia-not-a-key",
	);
	await userEvent.tab();
	const region = await screen.findByRole("combobox", { name: /Region/ });
	await userEvent.click(region);
	await userEvent.keyboard("moon-base-1{Enter}");
});
