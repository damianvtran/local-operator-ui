/**
 * Phone access, in every state the backend can put it in.
 *
 * WHAT THESE FRAMES ARE, AND ARE NOT. The component is the PRODUCTION block on its
 * production data path (`usePhoneSetup` -> `desktopResult` -> the bridge). The
 * desktop bridge (`window.api.desktop.request`) is the only stub, the way
 * `radient-account-section.stories.tsx` stubs it, and it replays the answers the
 * backend's explicit setup route documents (local-operator `docs/DESKTOP_API.md`,
 * "Explicit phone setup"). Every account label, address and amount here is a
 * FIXTURE; none is a real account or a real quote, and nothing here proves the
 * backend behaves this way - the backend slice is exercised on its own PR.
 *
 * STATEFUL WHERE THE FLOW IS: `Quote` and `ReadyNoActivation` answer the run the
 * way the backend does (the press flips the answer to `verified: true`), and
 * `Applying` keeps answering "a run is live" from the local read, so a capture can
 * take the transition (Checking -> consent -> Setting up -> Connected) rather than
 * only the four resting frames.
 *
 * TWO MOUNTS. The "Account" stories render the Settings -> Radient account section
 * (the real section, with the block in it). The remaining stories render the block
 * ALONE with `offerSignIn={false}`, which is how the Radient provider panel mounts
 * it; they do not render the surrounding provider panel itself, so a frame of
 * those is the block's own layout, not a photograph of that panel.
 */

import { RadientAccountSection } from "@features/settings/components/radient-account-section";
import { SettingsSection } from "@features/settings/components/settings-section";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { PhoneAccessBlock } from "./phone-access-block";
import "../../styles/index.css";

type BridgeRequest = {
	op?: string;
	credentialId?: number;
	acceptMonthlyPrice?: string;
	control?: { operation?: string };
};
type DesktopResponse = { status: number; body: unknown };

/** The states the backend can report, plus the transport failures. */
type Scenario =
	| "checking"
	| "quote"
	| "ready"
	| "applying"
	| "connected"
	| "waiting"
	| "login"
	| "choose"
	| "cloudflared"
	| "mobile_bundle"
	| "supervisor"
	| "balance"
	| "quote_changed"
	| "failed-5xx"
	| "intent-corrupt"
	| "no-capability"
	| "owner_missing"
	| "failed"
	| "billing-unconfirmed"
	// Transitions: the bridge answers late, so a capture can take the first frame
	// and the settled one from the same story.
	| "slow-plan"
	| "slow-run";

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

const base = {
	step: "apply",
	blocked_on: "none",
	configured: false,
	ready: true,
	verified: false,
	url: null as string | null,
	credential_id: 17 as number | null,
	identity_label: "d***@example.test" as string | null,
	credential_choices: [] as unknown[],
	quote: null as unknown,
	receipts: [] as unknown[],
	remedy: {
		kind: "run",
		text: "Phone access can be set up now. Nothing has been changed yet.",
		command: null,
		url: null,
	} as unknown,
	source: "fresh",
	in_progress: false,
	progress: [] as string[],
	active_credential_id: null as number | null,
};

const quoteOf = (price: string) => ({
	monthly_price_usd: price,
	positive_balance: true,
	eligible: false,
	account_valid: true,
});

const blocked = (
	step: string,
	kind: string,
	text: string,
	over: Record<string, unknown> = {},
) => ({
	...base,
	step,
	blocked_on: step,
	ready: false,
	remedy: { kind, text, command: null, url: null },
	...over,
});

const VERIFIED = {
	...base,
	step: "complete",
	configured: true,
	verified: true,
	url: "https://phone.fixture.example.test",
	remedy: null,
	receipts: [
		{
			step: "reservation",
			ok: true,
			text: "Phone address: reservation saved on this computer.",
		},
		{
			step: "installation",
			ok: true,
			text: "Background connector installed and started.",
		},
	],
};

/** The activation-required plan, shared by every consent-shaped scenario. */
const consentPlan = {
	...base,
	step: "quote",
	blocked_on: "quote",
	quote: quoteOf("0.05"),
	remedy: {
		kind: "accept_quote",
		text: "Accept only if you agree:",
		command:
			"lop tunnel setup apply --credential-id 17 --accept-monthly-price 0.05",
		url: null,
	},
};

/** The plan each scenario answers, and what a press of the run does to it. */
const plans = (scenario: Scenario): { plan: unknown; afterRun?: unknown } => {
	switch (scenario) {
		case "quote":
			return { plan: consentPlan, afterRun: VERIFIED };
		case "ready":
			return { plan: base, afterRun: VERIFIED };
		case "connected":
			return { plan: VERIFIED };
		case "waiting":
			return {
				plan: blocked(
					"verification",
					"check_status",
					"The connection is not yet confirmed. Check the status again in a minute; completed steps remain saved.",
					{
						configured: true,
						url: "https://not-verified.fixture.example.test",
						receipts: VERIFIED.receipts,
					},
				),
			};
		case "login":
			return {
				plan: blocked(
					"login",
					"sign_in",
					"Phone access needs a Radient sign-in. Sign in, then check again.",
					{ credential_id: null, identity_label: null },
				),
			};
		case "choose":
			return {
				plan: blocked(
					"owner_choice",
					"choose_account",
					"More than one Radient account is signed in. Choose the one to use; setup never switches accounts on its own.",
					{
						credential_id: null,
						identity_label: null,
						credential_choices: [
							{ id: 17, identity_label: "d***@example.test" },
							{ id: 23, identity_label: "w***@example.test" },
						],
					},
				),
			};
		case "cloudflared":
			return {
				plan: blocked(
					"cloudflared",
					"install_cloudflared",
					"The connector tool (cloudflared 2025.4.0 or newer) is not installed. Ask your agent to install it with normal approval, then check again.",
				),
			};
		case "mobile_bundle":
			return {
				plan: blocked(
					"mobile_bundle",
					"prepare_mobile",
					"The phone interface is not prepared yet. Ask your agent to prepare it with normal approval; no setup changes were made.",
				),
			};
		case "supervisor":
			return {
				plan: blocked(
					"supervisor",
					"enable_supervisor",
					"Background setup is unavailable on this computer. No setup changes were made.",
				),
			};
		case "owner_missing":
			return {
				plan: blocked(
					"owner_missing",
					"restore_owner",
					"The account that set this up is no longer signed in on this computer. Sign in to that original account; setup never switches to another one.",
				),
			};
		case "failed":
			return {
				plan: blocked(
					"failed",
					"check_status",
					"Setup stopped part-way. Steps already completed have not been undone. Check the status, then try again.",
					{
						receipts: [
							{
								step: "billing",
								ok: true,
								text: "Billing activation completed at the accepted monthly price.",
							},
						],
						billing_outcome: "activated",
						reservation_outcome: "saved",
						failure_stage: "installation",
					},
				),
			};
		case "billing-unconfirmed":
			return {
				plan: blocked(
					"failed",
					"check_status",
					"Setup stopped part-way. Steps already completed have not been undone. Check the status, then try again.",
					{
						receipts: [],
						billing_outcome: "unconfirmed",
						reservation_outcome: "not_requested",
						failure_stage: "billing",
					},
				),
			};
		case "slow-plan":
			return { plan: consentPlan };
		case "slow-run":
			return { plan: consentPlan, afterRun: VERIFIED };
		case "balance":
			return {
				plan: blocked(
					"balance",
					"add_credit",
					"This account has no credit. Add credit in the Radient console yourself; setup never purchases credit. Then check again.",
				),
			};
		case "quote_changed":
			return {
				plan: blocked(
					"quote",
					"accept_quote",
					"The current price is USD 0.07 a month, not the USD 0.05 you accepted. Nothing was submitted; check the current quote.",
					{ quote: quoteOf("0.07") },
				),
			};
		default:
			return { plan: base };
	}
};

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const installBridge = (scenario: Scenario) => {
	const { plan, afterRun } = plans(scenario);
	let current = plan;
	// `slow-run`: the run takes long enough for the 3 s poll to land once, so the
	// frames can be Applying with no lines, Applying with the backend's lines, and
	// Connected, from ONE story.
	let live = false;
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features:
						scenario === "no-capability"
							? { radient: 1 }
							: { radient: 1, tunnel_setup: 1 },
				});
			case "tunnel.setup.read":
				if (scenario === "failed-5xx")
					return { status: 500, body: "<html>raw upstream body</html>" };
				if (scenario === "intent-corrupt")
					return {
						status: 503,
						body: {
							detail: {
								code: "setup_intent_corrupt",
								params: {},
								text: "The saved phone setup request is invalid. Leave create.json unchanged and ask your agent to recover the original request before retrying. No setup changes were made.",
							},
						},
					};
				if (scenario === "applying")
					return ok({
						...base,
						source: "local",
						in_progress: true,
						active_credential_id: 17,
						blocked_on: "in_progress",
						ready: false,
						progress: [
							"Checking the selected account and required preparation before changes.",
							"Applying - preparing and starting the background connector...",
						],
					});
				if (live)
					return ok({
						...base,
						source: "local",
						in_progress: true,
						active_credential_id: 17,
						blocked_on: "in_progress",
						ready: false,
						progress: [
							"Checking the selected account and required preparation before changes.",
							"Applying - preparing and starting the background connector...",
						],
					});
				return ok({ ...base, source: "local", ready: false });
			case "tunnel.setup.plan":
				if (scenario === "checking") return new Promise(() => undefined);
				if (scenario === "slow-plan") await wait(2500);
				return ok(current);
			case "tunnel.setup.run":
				if (scenario === "slow-run") {
					live = true;
					await wait(7000);
					live = false;
				}
				if (afterRun) current = afterRun;
				return ok(current);
			case "radient.request":
				if (request?.control?.operation === "account")
					return ok({
						data: {
							msg: "ok",
							result: {
								account: {
									id: "acct_storybook_phone",
									tenant_id: "ten_storybook_phone",
									email: "d***@example.test",
									name: "Fixture Owner",
									role: "owner",
									status: "active",
									created_at: "2026-01-02T03:04:05Z",
									updated_at: "2026-01-02T03:04:05Z",
								},
								identity: {
									email: "d***@example.test",
									provider: "google",
									provider_id: "google-phone-fixture",
								},
							},
						},
					});
				break;
			default:
				break;
		}
		return {
			status: 404,
			body: { detail: { code: "not_implemented", message: request?.op } },
		};
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
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

/**
 * Installed as the story RENDERS, not from an effect: the block's first read can
 * fire before a parent layout effect, and a delegate that throws "no bridge" would
 * photograph a transport error instead of the state.
 */
const Frame: FC<{ scenario: Scenario; mount: "account" | "panel" }> = ({
	scenario,
	mount,
}) => {
	installBridge(scenario);
	return (
		<div className="min-h-screen bg-canvas p-8">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
				<SettingsSection
					title={mount === "account" ? "Radient account" : "Radient provider"}
					description="Fixture frame: every account, address and amount on this page is stub data."
				>
					{mount === "account" ? (
						<RadientAccountSection />
					) : (
						<PhoneAccessBlock offerSignIn={false} />
					)}
				</SettingsSection>
			</div>
		</div>
	);
};

const meta: Meta<{ scenario: Scenario }> = {
	title: "Providers/Phone access",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<{ scenario: Scenario }>;

const story = (scenario: Scenario, mount: "account" | "panel" = "panel") =>
	({
		args: { scenario },
		render: () => <Frame scenario={scenario} mount={mount} />,
	}) satisfies Story;

/** The plan has not answered yet: heading and a spinner only, no remedy, no price. */
export const Checking: Story = story("checking");
/** Activation required: account, exact price, consent sentence, one primary action. */
export const Quote: Story = story("quote");
/** No activation required: one "Set up phone access" action and no price at all. */
export const ReadyNoActivation: Story = story("ready");
/** The backend reports a live run: progress lines from the backend, no action. */
export const Applying: Story = story("applying");
/** `verified: true`: the only frame with the success treatment and the address. */
export const Connected: Story = story("connected");
/** Configured and still connecting: neutral, with the backend's own sentence. */
export const WaitingForConnection: Story = story("waiting");
/** The tunnel's login needs a sign-in (provider panel: the panel's own button). */
export const NeedsSignInPanel: Story = story("login");
/** The same blocker in Settings, which offers the existing sign-in itself. */
export const NeedsSignInAccount: Story = story("login", "account");
/** Several accounts: listed by masked label, none chosen for the user. */
export const ChooseAccount: Story = story("choose");
export const ConnectorToolMissing: Story = story("cloudflared");
export const PhoneInterfaceMissing: Story = story("mobile_bundle");
export const BackgroundServiceMissing: Story = story("supervisor");
export const NoCredit: Story = story("balance");
/** The price moved after the person looked: the new amount, nothing submitted. */
export const PriceChanged: Story = story("quote_changed");
/** A 5xx with a non-JSON body: the block's own sentence, never the raw text. */
export const GenericFailure: Story = story("failed-5xx");
/** The saved-intent refusal: generic sentence, no internal file name. */
export const SavedRequestInvalid: Story = story("intent-corrupt");
/** Transition: the plan answers after 2.5 s (Checking, then the consent). */
export const TransitionCheckingToConsent: Story = story("slow-plan");
/** Transition: press Activate; Applying, then the first poll's lines, then Connected. */
export const TransitionApplyingToConnected: Story = story("slow-run");
/** The tunnel's original account is gone from this computer: no account switcher. */
export const OriginalAccountMissing: Story = story("owner_missing");
/** Setup stopped part-way: the backend's sentence and the receipts, no rollback claim. */
export const PartialFailure: Story = story("failed");
/** An activation whose answer was lost; no success receipt or reservation is asserted. */
export const BillingUnconfirmed: Story = story("billing-unconfirmed");
/** Backend without `tunnel_setup`: the frame is the ABSENCE of the block. */
export const NoCapability: Story = story("no-capability", "account");
/** Connected, in the Settings mount, to show the block inside its section. */
export const ConnectedInSettings: Story = story("connected", "account");
