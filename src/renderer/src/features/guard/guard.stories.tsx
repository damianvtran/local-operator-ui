/**
 * Radient Guard on the desktop, in every state its vocabulary allows.
 *
 * ## What is stubbed, and what is not
 *
 * NOTHING BEHIND THESE STORIES DIALS A BACKEND. The consent cards are built from
 * `GET /v1/desktop/approvals`-shaped WIRE records run through the shipped
 * `approvalRows` and `guardPromptView`, so what renders is what the app renders
 * for that record, not a hand-built prop bag. The status fixtures follow
 * `local_operator/server/models/desktop_guard.py` (L2c). These are proof-of-shape;
 * they are not evidence that a live host answered anything.
 *
 * ## The states (RFC §5.2.3, §5.4, §14')
 * Prompt: new org, widening, new computer, plan gap, with posture + admin share,
 * working, failed, shared, declined, answered elsewhere, and the card the host
 * will not sign. Settings: sharing, pending widening, declined, stopped here,
 * stopped from Console, after a namespace reset, will-ask, paused for each
 * reason, unavailable, none, and the non-Team card as owner, admin and member.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import type { GuardScope } from "../../../../shared/guard-consent";
import {
	type GuardNonTeamCard,
	type GuardOrg,
	type GuardStatus,
	guardStatus,
} from "../../../../shared/guard-status";
import { approvalRows } from "../mesh/mesh-approvals";
import {
	GuardConsentDialog,
	type GuardDialogPhase,
	type GuardUnsent,
} from "./guard-consent-dialog";
import { ORG_MARK } from "./guard-org-mark";
import { GuardPromptEntry } from "./guard-prompt-entries";
import { type GuardPromptView, guardPromptView } from "./guard-prompt-model";
import { GuardSettingsView, type GuardViewerRole } from "./guard-settings-view";

const D = (c: string) => `sha256:${c.repeat(64)}`;

/** A `guard_consent` row exactly as `GET /v1/desktop/approvals` serves it. */
function wireRow(
	over: {
		org?: string;
		reason?: string;
		asked?: GuardScope[];
		grant?: GuardScope[];
		signable?: boolean;
	} = {},
) {
	const approvalId = "ap_guard1234";
	return {
		approval_id: approvalId,
		state: "requested",
		kind: "guard_consent",
		machine: { key_id: "k", spki_fp: "f" },
		what: {},
		requested_by: { surface: "guard-host" },
		expires_at: null,
		typed_approval: {
			action: "approve-credential",
			operation: "guard_consent",
			request_digest: D("a"),
			assurance: "file_only",
			unproven_human: true,
			disclosure: {
				version: 1,
				operation: "guard_consent",
				approval_id: approvalId,
				tenant: "ten_acme",
				org_display_name: over.org ?? "Acme Robotics",
				reason: over.reason ?? "new_org",
				collection_rev: 4,
				revocation_gen: 1,
				asked_scopes: over.asked ?? ["decisions", "task_time", "review_cycles"],
				grant_scopes: over.grant ?? ["decisions", "task_time", "review_cycles"],
				rendered_terms_digest: D("c"),
				prompt_digest: D("d"),
				expires_at: null,
				signing_principal: null,
			},
			disclosure_digest: D("b"),
			signable_here: over.signable ?? true,
		},
	};
}

function viewOf(over: Parameters<typeof wireRow>[0] = {}): GuardPromptView {
	const rows = approvalRows([wireRow(over)]);
	const view = rows[0] ? guardPromptView(rows[0]) : null;
	if (!view) throw new Error("fixture row did not parse");
	return view;
}

const noop = () => {};

function status(
	orgs: Partial<GuardOrg>[],
	over: Partial<GuardStatus> = {},
): GuardStatus {
	const parsed = guardStatus({
		mode: orgs.length ? "orgs" : "none",
		badge: "",
		orgs: orgs.map((org) => ({
			tenant: "ten_acme",
			org: "Acme Robotics",
			role: "member",
			state: "sharing",
			reason: "",
			since: null,
			answered_via: "",
			scopes_shared: ["decisions", "task_time", "review_cycles"],
			prompt: null,
			can_revoke: true,
			can_share_again: false,
			...org,
		})),
		backup_days: 31,
		this_computer: "Damian's MacBook",
		can_answer: true,
		team_url: "https://console.radienthq.com/dashboard/team",
		...over,
	});
	if (!parsed) throw new Error("fixture status did not parse");
	return parsed;
}

const CARD: GuardNonTeamCard = {
	trial_days: 14,
	org: null,
	url: "https://console.radienthq.com/dashboard/team",
};

const Frame = ({ children }: { children: ReactNode }) => (
	<div className="w-[560px] max-w-full bg-surface p-6">{children}</div>
);

const meta = {
	title: "Guard/Desktop",
	parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------ the prompt */

const dialog = (
	view: GuardPromptView,
	phase: GuardDialogPhase = "idle",
	extra: {
		notice?: string;
		answeredOn?: string;
		unsent?: GuardUnsent;
	} = {},
) => (
	<GuardConsentDialog
		view={view}
		open
		phase={phase}
		notice={extra.notice}
		answeredOn={extra.answeredOn}
		unsent={extra.unsent}
		onRetry={noop}
		onShare={noop}
		onDecline={noop}
		onLater={noop}
		onDone={noop}
	/>
);

/** The passive entry a prompt arrives as: no dialog, no focus move. */
export const EntryPending: Story = {
	render: () => (
		<Frame>
			<GuardPromptEntry view={viewOf()} onReview={noop} />
		</Frame>
	),
};
export const PromptNewOrg: Story = { render: () => dialog(viewOf()) };
export const PromptPendingWiden: Story = {
	render: () =>
		dialog(
			viewOf({
				reason: "widened",
				asked: ["posture", "admin_share"],
				grant: ["decisions", "task_time", "posture", "admin_share"],
			}),
		),
};
export const PromptNewComputer: Story = {
	render: () => dialog(viewOf({ reason: "new_device" })),
};
export const PromptPlanGap: Story = {
	render: () => dialog(viewOf({ reason: "plan_gap" })),
};
export const PromptPostureAndAdminShare: Story = {
	render: () =>
		dialog(
			viewOf({
				asked: ["decisions", "posture", "reports", "admin_share"],
				grant: ["decisions", "posture", "reports", "admin_share"],
			}),
		),
};
export const PromptWorking: Story = {
	render: () => dialog(viewOf(), "working"),
};
export const PromptFailed: Story = {
	render: () => dialog(viewOf(), "failed"),
};
export const PromptNotSignableHere: Story = {
	render: () => dialog(viewOf({ signable: false })),
};
export const PromptAccepted: Story = {
	render: () => dialog(viewOf(), "shared"),
};
export const PromptDeclined: Story = {
	render: () => dialog(viewOf(), "declined"),
};
export const PromptAnsweredElsewhere: Story = {
	render: () =>
		dialog(viewOf(), "answered_elsewhere", { answeredOn: "this terminal" }),
};
export const PromptChanged: Story = {
	render: () =>
		dialog(viewOf({ reason: "reactivated" }), "idle", {
			notice: `${ORG_MARK} changed this request. Check the new one below.`,
		}),
};

/* Round 2: signed-not-sent (S-1), expired (S-6), unconfirmed (S-4). */
export const PromptNotApplied: Story = {
	render: () =>
		dialog(viewOf(), "not_applied", {
			unsent: {
				reason:
					"Radient could not be reached, so your choice has not been sent.",
				remedy: "Check your connection, then try again.",
				retryable: true,
			},
		}),
};
export const PromptExpired: Story = {
	render: () => dialog(viewOf(), "expired"),
};
export const PromptUnconfirmed: Story = {
	render: () => dialog(viewOf(), "unconfirmed"),
};

/* Round 2 D6: long names. The dialog and the entry must wrap, never overflow. */
const LONG_ORG =
	"Northwind Traders International Holdings and Subsidiary Operating Companies Ltd";
const UNBROKEN_ORG = "Northwind-Traders-International-Holdings-Ltd";
export const PromptLongOrg: Story = {
	render: () => dialog(viewOf({ org: LONG_ORG })),
};
export const PromptUnbrokenOrg: Story = {
	render: () => dialog(viewOf({ org: UNBROKEN_ORG })),
};
export const EntryLongOrgs: Story = {
	render: () => (
		<Frame>
			<div className="flex flex-col gap-3">
				<GuardPromptEntry view={viewOf({ org: LONG_ORG })} onReview={noop} />
				<GuardPromptEntry
					view={viewOf({ org: UNBROKEN_ORG })}
					onReview={noop}
				/>
			</div>
		</Frame>
	),
};
/** 320 px: the Review button wraps under the text instead of squeezing it (D7). */
export const EntryNarrow: Story = {
	render: () => (
		<div className="w-[320px] bg-surface p-3">
			<GuardPromptEntry view={viewOf({ org: LONG_ORG })} onReview={noop} />
		</div>
	),
};

/* ----------------------------------------------------------- the settings */

const view = (
	s: GuardStatus | null,
	over: Partial<React.ComponentProps<typeof GuardSettingsView>> = {},
) => (
	<Frame>
		<GuardSettingsView
			load={s ? "ready" : "unavailable"}
			status={s}
			role={"owner" as GuardViewerRole}
			nonTeamCard={null}
			nonTeamLoading={false}
			busyTenant={null}
			failedTenant={null}
			revoked={null}
			onRevoke={noop}
			onShareAgain={noop}
			{...over}
		/>
	</Frame>
);

export const SettingsSharing: Story = {
	render: () => view(status([{}])),
};
export const SettingsPendingWiden: Story = {
	render: () =>
		view(status([{ state: "sharing_pending" }]), {
			prompts: (
				<GuardPromptEntry
					view={viewOf({ reason: "widened", asked: ["posture"] })}
					onReview={noop}
				/>
			),
		}),
};
export const SettingsWaiting: Story = {
	render: () =>
		view(status([{ state: "waiting", scopes_shared: [], can_revoke: false }]), {
			prompts: <GuardPromptEntry view={viewOf()} onReview={noop} />,
		}),
};
export const SettingsDeclined: Story = {
	render: () =>
		view(
			status([
				{
					state: "not_sharing",
					scopes_shared: [],
					can_revoke: false,
					can_share_again: true,
				},
			]),
		),
};
export const SettingsRevokedHere: Story = {
	render: () =>
		view(
			status([
				{
					state: "paused",
					reason: "scope_revoked",
					scopes_shared: [],
					can_revoke: false,
					can_share_again: true,
				},
			]),
			{ revoked: { tenant: "ten_acme", status: "revoked" } },
		),
};
export const SettingsRevokePending: Story = {
	render: () =>
		view(
			status([
				{
					state: "paused",
					reason: "revoke_pending",
					scopes_shared: [],
					can_revoke: false,
				},
			]),
			{ revoked: { tenant: "ten_acme", status: "revoke_pending" } },
		),
};
export const SettingsStoppedFromConsole: Story = {
	render: () =>
		view(
			status([
				{
					state: "paused",
					reason: "console_revoked",
					since: 1795219200,
					scopes_shared: [],
					can_revoke: false,
					can_share_again: true,
				},
			]),
		),
};
/** After the server's `namespace_reset`: a never-answered org is asked again, a stopped one stays stopped. */
export const SettingsNamespaceReset: Story = {
	render: () =>
		view(
			status([
				{
					tenant: "ten_a",
					org: "Acme Robotics",
					state: "waiting",
					scopes_shared: [],
					can_revoke: false,
				},
				{
					tenant: "ten_b",
					org: "Birch Labs",
					state: "paused",
					reason: "scope_revoked",
					scopes_shared: [],
					can_revoke: false,
					can_share_again: true,
				},
			]),
			{
				prompts: (
					<GuardPromptEntry
						view={viewOf({ reason: "new_org" })}
						onReview={noop}
					/>
				),
			},
		),
};
export const SettingsWillAsk: Story = {
	render: () =>
		view(status([{ state: "will_ask", scopes_shared: [], can_revoke: false }])),
};
export const SettingsPausedPlanLapsed: Story = {
	render: () =>
		view(
			status([
				{
					state: "paused",
					reason: "entitlement_lapsed",
					scopes_shared: [],
					can_revoke: true,
				},
			]),
		),
};
export const SettingsActionFailed: Story = {
	render: () => view(status([{}]), { failedTenant: "ten_acme" }),
};
export const SettingsNone: Story = {
	render: () => view(status([])),
};
export const SettingsUnavailable: Story = {
	render: () => view(null),
};
export const SettingsLoading: Story = {
	render: () => view(null, { load: "loading" }),
};
export const NonTeamOwnerEligible: Story = {
	render: () =>
		view(status([], { mode: "non_team" }), {
			role: "owner",
			nonTeamCard: CARD,
		}),
};
export const NonTeamOwnerIneligible: Story = {
	render: () =>
		view(status([], { mode: "non_team" }), {
			role: "owner",
			nonTeamCard: { ...CARD, trial_days: null },
		}),
};
export const NonTeamOwnerLoading: Story = {
	render: () =>
		view(status([], { mode: "non_team" }), {
			role: "owner",
			nonTeamLoading: true,
		}),
};
export const NonTeamAdmin: Story = {
	render: () =>
		view(status([], { mode: "non_team" }), {
			role: "admin",
			nonTeamCard: CARD,
		}),
};
export const NonTeamMember: Story = {
	render: () =>
		view(status([], { mode: "non_team" }), {
			role: "member",
			nonTeamCard: CARD,
		}),
};

/* ---------------------------------------------------------------- gallery */

const Labelled = ({
	name,
	children,
}: { name: string; children: ReactNode }) => (
	<section className="flex flex-col gap-2 border-hairline border-t pt-3">
		<p className="text-meta text-ink-dim">{name}</p>
		{children}
	</section>
);

/** Sharing and every stopped / pending state, side by side. Labels are story chrome, not product copy. */
export const GalleryStates: Story = {
	render: () => {
		const settings = (
			s: GuardStatus | null,
			over: Partial<React.ComponentProps<typeof GuardSettingsView>> = {},
		) => (
			<GuardSettingsView
				load={s ? "ready" : "unavailable"}
				status={s}
				role={"owner" as GuardViewerRole}
				nonTeamCard={null}
				nonTeamLoading={false}
				busyTenant={null}
				failedTenant={null}
				revoked={null}
				onRevoke={noop}
				onShareAgain={noop}
				{...over}
			/>
		);
		return (
			<div className="grid w-[1240px] grid-cols-3 gap-x-8 gap-y-6 bg-surface p-6">
				<Labelled name="sharing">{settings(status([{}]))}</Labelled>
				<Labelled name="pending widening (still sharing)">
					{settings(status([{ state: "sharing_pending" }]), {
						prompts: (
							<GuardPromptEntry
								view={viewOf({ reason: "widened", asked: ["posture"] })}
								onReview={noop}
							/>
						),
					})}
				</Labelled>
				<Labelled name="declined (sticky)">
					{settings(
						status([
							{
								state: "not_sharing",
								scopes_shared: [],
								can_revoke: false,
								can_share_again: true,
							},
						]),
					)}
				</Labelled>
				<Labelled name="stopped here">
					{settings(
						status([
							{
								state: "paused",
								reason: "scope_revoked",
								scopes_shared: [],
								can_revoke: false,
								can_share_again: true,
							},
						]),
						{ revoked: { tenant: "ten_acme", status: "revoked" } },
					)}
				</Labelled>
				<Labelled name="stopped from Console">
					{settings(
						status([
							{
								state: "paused",
								reason: "console_revoked",
								since: 1795219200,
								scopes_shared: [],
								can_revoke: false,
								can_share_again: true,
							},
						]),
					)}
				</Labelled>
				<Labelled name="revoke pending (calm, not an error)">
					{settings(
						status([
							{
								state: "paused",
								reason: "revoke_pending",
								scopes_shared: [],
								can_revoke: false,
							},
						]),
						{ revoked: { tenant: "ten_acme", status: "revoke_pending" } },
					)}
				</Labelled>
			</div>
		);
	},
};

/** Namespace reset, a failed write, an unreadable store and the non-Team card for each viewer role. Labels are story chrome. */
export const GalleryOther: Story = {
	render: () => {
		const settings = (
			s: GuardStatus | null,
			over: Partial<React.ComponentProps<typeof GuardSettingsView>> = {},
		) => (
			<GuardSettingsView
				load={s ? "ready" : "unavailable"}
				status={s}
				role={"owner" as GuardViewerRole}
				nonTeamCard={null}
				nonTeamLoading={false}
				busyTenant={null}
				failedTenant={null}
				revoked={null}
				onRevoke={noop}
				onShareAgain={noop}
				{...over}
			/>
		);
		return (
			<div className="grid w-[1240px] grid-cols-3 gap-x-8 gap-y-6 bg-surface p-6">
				<Labelled name="after a namespace reset">
					{settings(
						status([
							{
								tenant: "ten_a",
								state: "waiting",
								scopes_shared: [],
								can_revoke: false,
							},
							{
								tenant: "ten_b",
								org: "Birch Labs",
								state: "paused",
								reason: "scope_revoked",
								scopes_shared: [],
								can_revoke: false,
								can_share_again: true,
							},
						]),
						{ prompts: <GuardPromptEntry view={viewOf()} onReview={noop} /> },
					)}
				</Labelled>
				<Labelled name="action failed">
					{settings(status([{}]), { failedTenant: "ten_acme" })}
				</Labelled>
				<Labelled name="unavailable (older host / unreadable store)">
					{settings(null)}
				</Labelled>
				<Labelled name="non-Team: owner, trial eligible">
					{settings(status([], { mode: "non_team" }), { nonTeamCard: CARD })}
				</Labelled>
				<Labelled name="non-Team: owner, not eligible">
					{settings(status([], { mode: "non_team" }), {
						nonTeamCard: { ...CARD, trial_days: null },
					})}
				</Labelled>
				<Labelled name="non-Team: admin (ask owner)">
					{settings(status([], { mode: "non_team" }), {
						role: "admin",
						nonTeamCard: CARD,
					})}
				</Labelled>
				<Labelled name="non-Team: member (nothing below this line)">
					{settings(status([], { mode: "non_team" }), {
						role: "member",
						nonTeamCard: CARD,
					})}
				</Labelled>
			</div>
		);
	},
};
