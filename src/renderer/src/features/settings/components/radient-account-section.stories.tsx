/**
 * Settings -> Radient account, in the states the signup grant can be in.
 *
 * WHAT THESE FRAMES ARE FOR. The verify-to-claim line is a PROMPT, and a prompt
 * is judged by what it says and by when it is ABSENT. The account read carries
 * an optional `verification` block (Radient's own Turnstile-gated claim state,
 * never the OAuth identity's), and the three states it drives are:
 *
 *  - `verify-pending`: unclaimed, waiting on the inbox - the callout, with the
 *    amount from the backend's own capture;
 *  - `verify-expired`: the link is dead, so the copy points at asking for a new
 *    one;
 *  - `claimed`: nothing at all. This frame is the ABSENCE, which is also what a
 *    backend that predates the field renders - which is why `verification` is
 *    optional end to end and its absence is photographed rather than described.
 *
 * The section is the PRODUCT's, wrapped in the same `SettingsSection` header
 * the settings page gives it, so the frame is the page's own arrangement.
 *
 * The desktop transport is stubbed the way `backend-settings.stories.tsx` stubs
 * it (`window.api.desktop.request`, the bridge `desktop-api.desktopRequest`
 * prefers): without it every frame would photograph a transport error.
 */

import { RadientAccountSection } from "@features/settings/components/radient-account-section";
import { SettingsSection } from "@features/settings/components/settings-section";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import "../../../styles/index.css";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

type GrantState = "pending" | "expired" | "claimed";

const ACCOUNT = {
	id: "acct_storybook_verify",
	tenant_id: "ten_storybook_verify",
	email: "verify@example.test",
	name: "Verification Fixture",
	role: "owner",
	status: "active",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
};

const IDENTITY = {
	email: "verify@example.test",
	provider: "google",
	provider_id: "google-verify-fixture",
};

/**
 * The account payload for one grant state, as the backend reports it.
 *
 * The amounts are the constants the flow promises ($5.00 captured at issue),
 * shaped exactly like `desktop_radient.py` forwards them - the desktop envelope
 * around the upstream `{msg, result}` one - so a frame that renders an amount
 * is rendering the transport's own path rather than a convenience object.
 */
const accountBody = (grant: GrantState) => ({
	status: 200,
	body: {
		result: {
			data: {
				msg: "ok",
				result: {
					account: ACCOUNT,
					identity: IDENTITY,
					verification: {
						email_verified: grant === "claimed",
						signup_grant: grant,
						grant_amount: 5,
						claim_url: "https://console.radienthq.com/dashboard/verification",
					},
				},
			},
		},
	},
});

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (grant: GrantState) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					// `radient` is the feature gate the account read sits behind.
					features: { radient: 1 },
				});
			case "radient.request":
				if (request?.control?.operation === "account")
					return accountBody(grant);
				if (request?.control?.operation === "prices")
					return ok({
						data: {
							msg: "ok",
							result: {
								default_new_credits: 5,
								default_registration_credits: 25,
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
 * The section, installed against one grant state.
 *
 * The bridge is installed as the story RENDERS rather than from an effect,
 * which is `backend-settings.stories.tsx`'s pattern: the page's query can fire
 * before a parent layout effect runs, and a delegate that throws "no bridge
 * installed" would turn that race into a transport error in the frame.
 */
const Section: FC<{ grant: GrantState }> = ({ grant }) => {
	installBridge(grant);
	return (
		<div className="min-h-screen bg-canvas p-8">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
				<SettingsSection
					title="Radient account"
					description="Your Radient account, Radient Pass details and credits. To use Radient models, sign in under Model providers."
				>
					<RadientAccountSection />
				</SettingsSection>
			</div>
		</div>
	);
};

const meta: Meta<{ grant: GrantState }> = {
	title: "Settings/Radient account",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<{ grant: GrantState }>;

/** Unclaimed and waiting on the inbox: the callout, with the captured amount. */
export const VerifyPending: Story = {
	args: { grant: "pending" },
	render: (args) => <Section grant={args.grant} />,
};

/** The link is dead: the copy points at asking for a new one. */
export const VerifyExpired: Story = {
	args: { grant: "expired" },
	render: (args) => <Section grant={args.grant} />,
};

/**
 * Claimed: nothing is rendered, even though the block is present and says so.
 * A backend that sends no `verification` block at all renders the same absence
 * (asserted in `scripts/radient-verify-callout.test.mjs`), so this frame is the
 * one absence both causes share.
 */
export const Claimed: Story = {
	args: { grant: "claimed" },
	render: (args) => <Section grant={args.grant} />,
};
