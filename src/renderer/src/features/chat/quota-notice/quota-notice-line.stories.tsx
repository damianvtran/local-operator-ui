/**
 * The pre-emptive quota notice, in every state its copy, its resend phases and
 * its dismiss can take — driven through the REAL line and hook over a stubbed
 * desktop transport.
 *
 * WHY THE REAL CONTAINER. The frames exist to show states the container can
 * actually produce, so nothing here re-derives a view model: the hook's query,
 * its capability gate, the resend classification and the dismissal all run as
 * the app runs them, and only the transport below `desktopResult` is stubbed —
 * the pattern `radient-credits-guidance.stories.tsx` states next door. The
 * fixtures' words are the CORE builders' own (a depleted DeepSeek balance, a
 * Radient signup grant waiting behind verification, an Anthropic plan window),
 * so a frame cannot certify copy the backend would not send.
 *
 * HOW EACH TERMINAL STATE IS REACHED. `sending`, `sent`, `rate-limited` and
 * `dismissed` are states a PRESS produces, not props: the capture rig presses
 * the real control (`press:` in `scripts/capture-evidence.mjs`'s entry) and
 * the shutter waits for the phase's own `data-quota-notice-resend-phase`
 * marker, so a frame filed under a state is one the state was actually in.
 * The `sending` story's bridge never settles, so its press is frozen mid
 * flight; the other two answer 200 and 429 — each navigation re-mounts and
 * re-presses, so a 120 s cooldown cannot expire between themes.
 *
 * THE DISMISSAL IS CLEARED PER NAVIGATION, in `installBridge` and not in an
 * effect: the hook reads the stored signature during the line's first render,
 * which is BEFORE any effect runs, so clearing afterwards would leave the next
 * navigation of the same `(provider, state)` pair already dismissed.
 *
 * All data is [redacted] and the URLs are the product's real consoles.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import "../../../styles/index.css";
import type { QuotaNotice } from "../../../../../shared/desktop-contract";
import { QUOTA_NOTICE_DISMISSAL_KEY } from "./quota-notice";
import { QuotaNoticeLine } from "./quota-notice-line";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

/** A depleted DeepSeek balance: the plainest balance-state line. */
const DEEPSEEK_DEPLETED: QuotaNotice = {
	state: "depleted",
	provider: "deepseek",
	kind: "balance",
	model_free: false,
	title: "No balance on DeepSeek",
	body: "No balance on DeepSeek — top up at the DeepSeek platform.",
	actions: [
		{
			id: "open_url",
			label: "Top up at the DeepSeek platform",
			url: "https://platform.deepseek.com/top_up",
		},
		{ id: "refresh", label: "I topped up", url: null },
	],
	resets_at_ms: null,
	checked_at_ms: 1791597803748,
	age_ms: 0,
	source: "live",
};

/**
 * The Radient signup grant waiting behind verification — the state that offers
 * the resend action, and the longest body the line ever shows (two lines and a
 * URL, straight from `recovery_line`).
 */
const RADIENT_UNVERIFIED: QuotaNotice = {
	state: "unverified",
	provider: "radient",
	kind: "radient",
	model_free: false,
	title: "Verify your email to claim your free credits",
	body: "You haven't verified your email yet. Verify to claim $5 in free credits and start using Local Operator for free.\nCheck your inbox for the Radient verification email, or open https://console.radienthq.com/dashboard/verification",
	actions: [
		{
			id: "open_url",
			label: "Open verification page",
			url: "https://console.radienthq.com/dashboard/verification",
		},
		{
			id: "resend_verification",
			label: "Resend verification email",
			url: null,
		},
		{ id: "refresh", label: "I verified", url: null },
	],
	resets_at_ms: null,
	checked_at_ms: 1791597803748,
	age_ms: 0,
	source: "live",
};

/** A spent Anthropic plan window: the subscription line, with its reset time. */
const ANTHROPIC_LIMIT: QuotaNotice = {
	state: "limit_reached",
	provider: "anthropic",
	kind: "subscription",
	model_free: false,
	title: "Anthropic limit reached",
	body: "Anthropic limit reached — 5 hour resets in 59 min.",
	actions: [
		{
			id: "open_url",
			label: "Open Claude settings",
			url: "https://claude.ai/settings/usage",
		},
		{ id: "refresh", label: "Check again", url: null },
	],
	resets_at_ms: 1791601412402,
	checked_at_ms: 1791597803748,
	age_ms: 0,
	source: "live",
};

/** What `gradient.request` does with `signup.resend` in this frame. */
type ResendBehaviour = "accepted" | "hangs" | "rate-limited";

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (options: {
	provider: string;
	model: string;
	notice: QuotaNotice;
	resend?: ResendBehaviour;
}) => {
	/*
	 * See the file docstring: cleared as the frame mounts, before the line's
	 * first render reads it, so one story's dismissal cannot leak into the next
	 * navigation (or into a sibling story's signature).
	 */
	if (typeof window !== "undefined") {
		try {
			window.localStorage.removeItem(QUOTA_NOTICE_DISMISSAL_KEY);
		} catch {
			/* A blocked store has nothing to clear. */
		}
	}
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { quota_notice: 1 },
				});
			case "config.get":
				return ok({
					values: { hosting: options.provider, model_name: options.model },
				});
			case "providers.list":
				return ok({ providers: [] });
			case "quota.notice":
				return ok(options.notice);
			case "radient.request": {
				if (request?.control?.operation === "signup.resend") {
					if (options.resend === "hangs") {
						return new Promise<DesktopResponse>(() => {});
					}
					if (options.resend === "rate-limited") {
						return {
							status: 429,
							body: {
								detail: {
									code: "signup_resend_rate_limited",
									message: "A verification email was requested recently",
								},
							},
						};
					}
					return ok({ data: { msg: "ok", result: { status: 200 } } });
				}
				break;
			}
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

/*
 * The band the line lives on: the chat column's ground, a stand-in composer box
 * carrying the roles the real one declares (`rounded-frame border-control
 * bg-surface p-4`) and the line's own `mt-2` slot under it. The box is a
 * stand-in because the row's neighbours are what its vertical rhythm is judged
 * against, not its contents — and it deliberately keeps that much furniture
 * (a label and two control pills, the shapes the real box has) because the
 * capturer PRESSES Dismiss for one row, and a story that loses the line still
 * has to clear the rig's element floor to prove it rendered: four bare divs
 * fall under it, and the failure reads as "Storybook never finished preparing
 * the story" rather than as the missing press evidence it is.
 */
const Band: FC<{
	provider: string;
	model: string;
	notice: QuotaNotice;
	resend?: ResendBehaviour;
	maxWidth?: number;
}> = ({ provider, model, notice, resend, maxWidth }) => {
	installBridge({ provider, model, notice, resend });
	return (
		<div className="min-h-[200px] bg-canvas p-6 font-sans">
			<div
				className="mx-auto flex w-full flex-col"
				style={{ maxWidth: maxWidth ?? 900 }}
			>
				<div className="rounded-frame border border-control bg-surface p-4 text-body-sm text-ink-dim">
					<div>Ask anything, or type / for commands.</div>
					<div className="mt-3 flex items-center gap-2 text-meta">
						<span className="rounded-md border border-control px-2 py-1">
							Attach
						</span>
						<span className="rounded-md border border-control px-2 py-1">
							Model
						</span>
					</div>
				</div>
				<div className="mt-2">
					<QuotaNoticeLine />
				</div>
			</div>
		</div>
	);
};

const meta: Meta = {
	/*
	 * `Chat/Quota Notice`, WITH the space: Storybook lowercases a title and
	 * turns spaces into the id's dashes, so the id is `chat-quota-notice--*` —
	 * the name this module, its evidence directory and every committed frame
	 * use. `QuotaNotice` (no space) would build `chat-quotanotice--*` and the
	 * capturer's `--only=chat-quota-notice` would refuse the whole set.
	 */
	title: "Chat/Quota Notice",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** A depleted balance provider: the line's plainest state. */
export const Depleted: Story = {
	render: () => (
		<Band
			provider="deepseek"
			model="deepseek-chat"
			notice={DEEPSEEK_DEPLETED}
		/>
	),
};

/** Radient, verified-not-yet: the resend offer is present. */
export const Unverified: Story = {
	render: () => (
		<Band provider="radient" model="radient/auto" notice={RADIENT_UNVERIFIED} />
	),
};

/** A spent subscription window, with its reset time in the sentence. */
export const LimitReached: Story = {
	render: () => (
		<Band
			provider="anthropic"
			model="claude-sonnet-5-5"
			notice={ANTHROPIC_LIMIT}
		/>
	),
};

/** The resend press in flight: the button is disabled and nothing else moved. */
export const Sending: Story = {
	render: () => (
		<Band
			provider="radient"
			model="radient/auto"
			notice={RADIENT_UNVERIFIED}
			resend="hangs"
		/>
	),
};

/** The server took the press: the receipt and the 120 s cooldown. */
export const Sent: Story = {
	render: () => (
		<Band
			provider="radient"
			model="radient/auto"
			notice={RADIENT_UNVERIFIED}
			resend="accepted"
		/>
	),
};

/** The server's own cooldown refused it: "requested recently", never "sign in". */
export const RateLimited: Story = {
	render: () => (
		<Band
			provider="radient"
			model="radient/auto"
			notice={RADIENT_UNVERIFIED}
			resend="rate-limited"
		/>
	),
};

/**
 * The dismissal, pressed for real: the line goes and the band keeps its space
 * claim minimal. The frame is the empty slot — what a dismissed notice looks
 * like — and the README records that the press produced it.
 */
export const Dismissed: Story = {
	render: () => (
		<Band provider="radient" model="radient/auto" notice={RADIENT_UNVERIFIED} />
	),
};

/** The longest body at a narrow width, where wrapping is the risk. */
export const NarrowWidth: Story = {
	render: () => (
		<Band
			provider="radient"
			model="radient/auto"
			notice={RADIENT_UNVERIFIED}
			maxWidth={420}
		/>
	),
};
