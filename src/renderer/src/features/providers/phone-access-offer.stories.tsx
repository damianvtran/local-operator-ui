/**
 * The first-sign-in phone access offer (spec v2 §4.1, D6), in a sidebar-width
 * column above a stand-in account row, against a stubbed desktop bridge: a
 * signed-in Radient account, a backend that advertises `tunnel_setup` and
 * `tunnel_remedy_kinds`, and a local read that says no phone access exists.
 * Every account and address is fixture data.
 *
 * "Not now" is remembered in localStorage; the frame clears that one key as it
 * renders so a reload after pressing it shows the card again.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import {
	PHONE_OFFER_DISMISSED_KEY,
	PhoneAccessOffer,
	PhoneAccessOfferIcon,
} from "./phone-access-offer";
import "../../styles/index.css";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

const LOCAL_READ = {
	step: "apply",
	blocked_on: "none",
	configured: false,
	ready: false,
	verified: false,
	url: null,
	credential_id: 17,
	identity_label: "d***@example.test",
	credential_choices: [],
	quote: null,
	receipts: [],
	remedy: {
		kind: "run",
		text: "Phone access can be set up now. Nothing has been changed yet.",
		command: null,
		url: null,
	},
	source: "local",
	in_progress: false,
	progress: [],
	active_credential_id: null,
};

const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
	switch (request?.op) {
		case "capabilities":
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: { radient: 1, tunnel_setup: 1, tunnel_remedy_kinds: 1 },
			});
		case "tunnel.setup.read":
			return ok(LOCAL_READ);
		case "radient.request":
			if (request?.control?.operation === "account")
				return ok({
					data: {
						msg: "ok",
						result: {
							account: {
								id: "acct_storybook_offer",
								tenant_id: "ten_storybook_offer",
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
								provider_id: "google-offer-fixture",
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

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
}

const Frame: FC = () => {
	window.localStorage.removeItem(PHONE_OFFER_DISMISSED_KEY);
	return (
		<div className="flex min-h-screen bg-surface">
			<div className="flex w-[260px] flex-col justify-end border-hairline border-r bg-canvas pt-8">
				<PhoneAccessOffer />
				<div className="flex min-h-10 items-center px-4 pb-2 text-body-sm text-ink-muted">
					Fixture Owner
				</div>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Providers/Phone access offer",
	parameters: { layout: "fullscreen" },
};
export default meta;

/** Signed in, no phone access on this machine: the card, above the account row. */
export const FirstSignIn: StoryObj = { render: () => <Frame /> };

/**
 * A short window (review N2 / design D2): the card is `shrink-0`, so a 360px
 * column squeezes the scrolling list above it, never the card, and the
 * medium-weight title wraps rather than truncating.
 */
const ShortFrame: FC = () => {
	window.localStorage.removeItem(PHONE_OFFER_DISMISSED_KEY);
	return (
		<div className="flex h-[360px] bg-surface">
			<div className="flex h-full w-[260px] flex-col border-hairline border-r bg-canvas pt-8">
				<ul className="min-h-0 flex-1 overflow-y-auto px-4">
					{Array.from({ length: 30 }, (_, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static filler rows
						<li key={index} className="py-1 text-body-sm text-ink-muted">
							{`Chat ${index + 1}`}
						</li>
					))}
				</ul>
				<PhoneAccessOffer />
				<div className="flex min-h-10 shrink-0 items-center px-4 pb-2 text-body-sm text-ink-muted">
					Fixture Owner
				</div>
			</div>
		</div>
	);
};
export const ShortWindow: StoryObj = { render: () => <ShortFrame /> };

/**
 * The COLLAPSED sidebar (UX review U1): the strip has no foot for the card, so
 * an icon with an accent dot opens the same card in a popover. Press it.
 */
const CollapsedFrame: FC = () => {
	window.localStorage.removeItem(PHONE_OFFER_DISMISSED_KEY);
	return (
		<div className="flex min-h-screen bg-surface">
			<div className="flex w-12 flex-col items-center justify-end gap-1 border-hairline border-r bg-canvas pb-2">
				<PhoneAccessOfferIcon />
			</div>
		</div>
	);
};
export const CollapsedSidebar: StoryObj = { render: () => <CollapsedFrame /> };
