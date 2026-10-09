/**
 * The chat row for a Radient run refused for want of credits, in every account
 * state its guidance can take.
 *
 * WHAT THESE FRAMES ARE FOR. A signed-in user with a zero balance gets an HTTP
 * 402 from Radient, and the row used to render as a generic rate-limit incident
 * with a provider-settings button - nothing said that free credits wait behind
 * email verification, or how to top up. The guidance under the row is a function
 * of the ACCOUNT, so each frame drives the real path: the production
 * `CanonicalTranscript` renders the production reducer's incident row, and the
 * guidance under it reads the account through the same `useRadientUserQuery`
 * the settings page uses, against a stubbed desktop transport
 * (`radient-account-section.stories.tsx`'s pattern). Nothing in a frame is
 * hand-painted.
 *
 * The states, one per way the account can answer:
 *  - `unverified-*`: the signup grant is waiting (pending / expired / none);
 *  - `verified-*`: top up, with the first-top-up bonus line while it is on offer,
 *    without it once received, and without it on a backend that predates the
 *    `first_topup` field;
 *  - `account-unreadable`: signed out / read failed - the neutral message with
 *    both remedies worded conditionally;
 *  - `non-radient-rate-limit`: the control. A real rate limit on another
 *    provider is exactly what it was before this change.
 *
 * All data is synthetic (`*.example.test`, invented ids).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	applyHistoryPage,
} from "./transcript-reducer";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

type Verification = Record<string, unknown> | "signed-out" | "no-block";

const ACCOUNT = {
	id: "acct_storybook_credits",
	tenant_id: "ten_storybook_credits",
	email: "credits@example.test",
	name: "Credits Fixture",
	role: "owner",
	status: "active",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
};

const CLAIM_URL = "https://console.radienthq.com/dashboard/verification";
const TOPUP_URL = "https://console.radienthq.com/dashboard/billing";

const UNVERIFIED = (grant: "pending" | "expired" | "none") => ({
	email_verified: false,
	signup_grant: grant,
	// The contract attaches the amount to pending/expired only.
	grant_amount: grant === "none" ? undefined : 5,
	claim_url: CLAIM_URL,
});

const VERIFIED = (bonusReceived: boolean | "absent") => ({
	email_verified: true,
	signup_grant: "claimed",
	grant_amount: 5,
	claim_url: CLAIM_URL,
	...(bonusReceived === "absent"
		? {}
		: {
				first_topup: {
					bonus_amount: 10,
					minimum_purchase: 5,
					bonus_received: bonusReceived,
					topup_url: TOPUP_URL,
				},
			}),
});

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (verification: Verification) => {
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
					features: { radient: 1 },
				});
			case "radient.request":
				if (request?.control?.operation === "account") {
					if (verification === "signed-out")
						return {
							status: 409,
							body: {
								detail: {
									code: "radient_no_credential",
									message: "Sign in to Radient to access your account",
								},
							},
						};
					return ok({
						data: {
							msg: "ok",
							result: {
								account: ACCOUNT,
								identity: {
									email: ACCOUNT.email,
									provider: "google",
									provider_id: "google-credits-fixture",
								},
								...(verification === "no-block" ? {} : { verification }),
							},
						},
					});
				}
				if (request?.control?.operation === "prices")
					/*
					 * The advertised grant the guidance reads when a capture has
					 * no `grant_amount` of its own (agent review round 1, R1-2) -
					 * the same pair the settings callout's story answers.
					 */
					return ok({
						data: {
							msg: "ok",
							result: { default_new_credits: 5 },
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

const custom = (
	id: string,
	text: string,
	raw: string,
): DesktopHistoryPage["entries"][number] => ({
	id,
	ts: 1789113544.47,
	type: "message",
	payload: {
		kind: "custom",
		custom_type: "session_incident",
		details: { text, raw },
	},
});

/** The relayed refusal as the runtime renders it: a 402 filed under rate-limit. */
const RADIENT_402 = custom(
	"3f9a1c7e5b2d4a60b8e1c9d7f5a30421",
	"[session incident (radient/auto)] rate-limit: rate limit or quota exceeded (HTTP 402): insufficient credits\nsuggested action: Back off and retry later; if it persists, tell the user which provider hit the limit — they may need to switch model or top up quota.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
	"rate limit or quota exceeded (HTTP 402): insufficient credits",
);

/** The control: a genuine 429 on another provider. */
const ANTHROPIC_429 = custom(
	"7c2e9b4d1a6f4083a5d7e1b9c3f50862",
	"[session incident (anthropic/claude-opus-5)] rate-limit: rate limit or quota exceeded (HTTP 429)\nsuggested action: Back off and retry later; if it persists, tell the user which provider hit the limit — they may need to switch model or top up quota.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
	"rate limit or quota exceeded (HTTP 429)",
);

const recordsOf = (
	entry: DesktopHistoryPage["entries"][number],
): TranscriptRecord[] =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [entry],
		has_more: false,
		cursor_missing: false,
	}).records;

const Frame: FC<{
	verification: Verification;
	entry?: DesktopHistoryPage["entries"][number];
	height?: number;
}> = ({ verification, entry = RADIENT_402, height = 260 }) => {
	/* Installed as the story RENDERS, not from an effect: the account read can
	   fire before a parent effect runs (`radient-account-section.stories.tsx`). */
	installBridge(verification);
	const containerRef = useRef<HTMLDivElement>(null);
	const records = recordsOf(entry);
	return (
		<div className="overflow-y-auto p-6" style={{ height }} ref={containerRef}>
			<CanonicalTranscript
				transcript={{
					...EMPTY_TRANSCRIPT,
					records,
					index: new Map(records.map((record, at) => [record.id, at])),
				}}
				gate={null}
				waiting={false}
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				failure={null}
				awaitingHydration={false}
				onReconnect={() => {}}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Radient out of credits",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Unverified, the link is in the inbox: verify to claim the grant. */
export const UnverifiedPending: Story = {
	render: () => <Frame verification={UNVERIFIED("pending")} />,
};

/** Unverified, the link lapsed: ask for a new one on the verification page. */
export const UnverifiedExpired: Story = {
	render: () => <Frame verification={UNVERIFIED("expired")} />,
};

/** Unverified with no ticket: promises no amount, sends the reader to check. */
export const UnverifiedNone: Story = {
	render: () => <Frame verification={UNVERIFIED("none")} />,
};

/** Verified, first top-up not yet made: top up, plus the bonus line. */
export const VerifiedBonusAvailable: Story = {
	render: () => <Frame verification={VERIFIED(false)} />,
};

/** Verified and the bonus is spent (or a purchase exists): top up, no bonus line. */
export const VerifiedBonusReceived: Story = {
	render: () => <Frame verification={VERIFIED(true)} />,
};

/** A backend that predates `first_topup`: the link still shows, the bonus line does not. */
export const VerifiedOlderBackend: Story = {
	render: () => <Frame verification={VERIFIED("absent")} />,
};

/** Signed out, offline or the read failed: both remedies, worded conditionally. */
export const AccountUnreadable: Story = {
	render: () => <Frame verification="signed-out" height={300} />,
};

/** The control: a real rate limit on another provider, unchanged. */
export const NonRadientRateLimit: Story = {
	render: () => (
		<Frame verification={VERIFIED(false)} entry={ANTHROPIC_429} height={160} />
	),
};
