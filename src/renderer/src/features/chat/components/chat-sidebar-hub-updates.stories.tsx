/**
 * The chat sidebar's hub-update marks, in the four states the operator asked to
 * see: nothing to update (the mark is ABSENT), an update available, an update
 * in flight, and a failure with its retry.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real `useProfiles` / `useTeams` / `useHubUpdates`
 * queries and the real `useHubActions` mutations. Below them
 * `window.api.desktop.request` is a stub that answers the catalogue reads and the
 * hub plane from a small mutable model, so a press in a play function changes
 * what the next poll reports - the row really goes from "available" to gone.
 *
 * ## What a frame here does NOT prove
 *
 * That the local backend serves `/v1/desktop/hub/updates` with these shapes. The
 * payload is written from the design's B5.1 contract, not a live call; the
 * backend's own tests and QA's live-organization pass answer that. Nor does a
 * frame prove the merge itself: the stub answers `apply` with a canned report.
 *
 * ## Every story pins the same shared origin state
 *
 * Like `chat-sidebar-agents.stories.tsx`, the built-ins offer's dismissal lives
 * in one localStorage key shared by the whole sweep, and every story here has
 * agents of its own (so no offer is drawn), which is what keeps them
 * order-independent without a fixture.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatSidebar } from "./chat-sidebar";

/* ---------------------------------------------------------------- the model */

type WireItem = {
	kind: "agent" | "team";
	name: string;
	state: string;
	classification?: string | null;
	auto_will_apply?: boolean;
	error_class?: string | null;
	last_error?: string | null;
	last_applied_at?: string | null;
	/** Org-linked rows carry the tenant the credential is resolved for (U11's shape). */
	tenant_id?: string | null;
};

type Scenario = {
	credential?: "ok" | "none";
	autoAgents?: boolean;
	items: WireItem[];
	/** Never settle an `apply`, so the in-flight glyph is the subject. */
	holdApply?: boolean;
	/** Answer `apply` with a 409 so the row's refusal line is the subject. */
	applyRefused?: boolean;
	/** Answer `apply`/`retry` with this outcome and leave the item listed (the "still not on the hub" arm). */
	applyOutcome?: { outcome: string; error_class?: string };
	/**
	 * What a `hub.retry` alone answers, mirroring the backend: a retry that answers
	 * `would-merge` proved the update computes, so the stale failure is retired and
	 * the row offers the UPDATE on the next press (UX round 2, U10).
	 */
	retryOutcome?: { outcome: string; error_class?: string };
	uptodate?: number;
	/** A backend that predates the plane: `hub_updates` absent from the capabilities. */
	noCapability?: boolean;
};

const LONG_NAME = "customer-escalation-triage-coordinator";
const AGENTS = ["coder", "reviewer", "architect", "release-captain", LONG_NAME];
const TEAMS = ["lopdev", "minerva-support"];

const profile = (name: string) => ({
	name,
	kind: "role",
	source: "installed",
	agent_id: `agent-${name}`,
	description: `${name} - reusable instructions for this role.`,
	tools: null,
	effort: null,
	delegate: false,
	seed_origin: null,
	divergent_fields: [],
});

const installBridge = (scenario: Scenario) => {
	let items = [...scenario.items];
	// What the play functions assert on: a review press must send NOTHING to `apply`.
	const calls: { op: string; name?: string }[] = [];
	(window as unknown as { __hubCalls?: typeof calls }).__hubCalls = calls;
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const snapshot = () => ({
		generated_at: "2026-09-29T12:00:00Z",
		credential: scenario.credential ?? "ok",
		settings: {
			auto_agents: scenario.autoAgents ?? true,
			auto_teams: scenario.autoAgents ?? true,
			interval_min: 60,
		},
		counts: {
			available: items.filter((item) => item.state === "available").length,
			failed: items.filter((item) => item.state === "failed").length,
			updating: 0,
			"up-to-date": scenario.uptodate ?? 4,
		},
		items,
	});
	const bridge = async (request: {
		op: string;
		name?: string;
		kind?: "agent" | "team";
	}): Promise<DesktopResponse> => {
		if (request.op.startsWith("hub.") && request.op !== "hub.updates")
			calls.push({ op: request.op, name: request.name });
		switch (request.op) {
			case "hub.check":
				return ok({ reports: [], status: snapshot() });
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
						...(scenario.noCapability ? {} : { hub_updates: 1 }),
					},
				});
			case "sessions.list":
				return ok({ sessions: [], truncated: false });
			case "profiles.list":
				return ok({ profiles: AGENTS.map(profile) });
			case "teams.list":
				return ok({
					teams: TEAMS.map((name) => ({
						name,
						manager: "manager",
						members: [],
					})),
				});
			case "hub.updates":
				return ok(snapshot());
			case "hub.retry": {
				const retry = scenario.retryOutcome ?? scenario.applyOutcome;
				if (retry) {
					if (retry.outcome === "would-merge")
						items = items.map((item) =>
							item.kind === request.kind && item.name === request.name
								? { ...item, state: "available", error_class: null }
								: item,
						);
					return ok({
						reports: [
							{
								kind: request.kind,
								name: request.name,
								applied: false,
								...retry,
							},
						],
						status: snapshot(),
					});
				}
				items = items.filter(
					(item) => !(item.kind === request.kind && item.name === request.name),
				);
				return ok({
					reports: [
						{
							kind: request.kind,
							name: request.name,
							outcome: "merged",
							applied: true,
						},
					],
					status: snapshot(),
				});
			}
			case "hub.apply": {
				if (scenario.holdApply) return await new Promise(() => {});
				if (scenario.applyRefused)
					return {
						status: 409,
						body: { detail: "It changed while updating. Try again." },
					};
				if (scenario.applyOutcome)
					return ok({
						reports: [
							{
								kind: request.kind,
								name: request.name,
								applied: false,
								...scenario.applyOutcome,
							},
						],
						status: snapshot(),
					});
				items = items.filter(
					(item) => !(item.kind === request.kind && item.name === request.name),
				);
				return ok({
					reports: [
						{
							kind: request.kind,
							name: request.name,
							outcome: "merged",
							applied: true,
						},
					],
					status: snapshot(),
				});
			}
			case "hub.applyAll": {
				const taken = items.filter(
					(item) =>
						item.kind === request.kind &&
						item.state === "available" &&
						!item.error_class,
				);
				items = items.filter((item) => !taken.includes(item));
				return ok({
					reports: taken.map((item) => ({
						kind: item.kind,
						name: item.name,
						outcome: "merged",
						applied: true,
					})),
					status: snapshot(),
				});
			}
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: {
					op: string;
					name?: string;
					kind?: "agent" | "team";
				}) => Promise<DesktopResponse>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

const Page = ({ width = 360 }: { width?: number }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div
			style={{ width }}
			className="shrink-0 border-r border-hairline"
			data-testid="hub-story-frame"
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat sidebar/Hub updates",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/**
 * A user who never used the hub: no mark, no control, no line. Nothing is tracked
 * (`counts` all zero), so the section is byte-for-byte today's - the frame the
 * `origin/main` comparison (design D7) is diffed against.
 */
export const UpToDate: Story = {
	render: () => {
		installBridge({ items: [], uptodate: 0 });
		return <Page />;
	},
	play: async () => {
		await screen.findByRole("button", { name: "New chat with coder" });
		expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
		expect(screen.queryByTestId("hub-update-all-agent")).toBeNull();
	},
};

/**
 * The same sidebar on a backend WITHOUT the hub capability: the code path today's
 * `main` has. Diffed pixel-for-pixel against `UpToDate` (design D7): with nothing
 * tracked, the feature adds no pixel.
 */
export const CapabilityAbsent: Story = {
	render: () => {
		installBridge({ items: [], uptodate: 0, noCapability: true });
		return <Page />;
	},
};

/** Hub-linked and everything current: the only addition is the quiet check-now control in the Agents heading. */
export const UpToDateLinked: Story = {
	render: () => {
		installBridge({ items: [] });
		return <Page />;
	},
	play: async () => {
		await screen.findByTestId("hub-check-now");
		expect(screen.queryByTestId("hub-update-all-agent")).toBeNull();
	},
};

/**
 * One agent with an update waiting, auto-update ON: the mark says it "updates
 * automatically" (tooltip and accessible description). One waiting item gets no
 * "Update all" strip - the row's own mark is already the single click.
 */
export const AvailableAutoOn: Story = {
	render: () => {
		installBridge({
			autoAgents: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
					auto_will_apply: true,
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("aria-label")).toBe("Update coder from the hub");
	},
};

/**
 * Manual mode, three indicators across both sections: the operator's ask that
 * an update be visible even when auto-update is off. The team row needs a
 * decision (`both-changed`), the agents just wait.
 */
export const AvailableManualMixed: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "team",
					name: "lopdev",
					state: "available",
					classification: "both-changed",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await screen.findByTestId("hub-mark-agent-coder");
		await screen.findByTestId("hub-mark-agent-reviewer");
		await screen.findByTestId("hub-mark-team-lopdev");
	},
};

/** The press really updates: the mark leaves the row when the next snapshot says so. */
export const ClickUpdatesTheItem: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
		});
		expect(screen.getByTestId("hub-mark-agent-reviewer")).toBeTruthy();
	},
};

/** "Update all" takes the section's waiting items and leaves a one-line roll-up. */
export const UpdateAllRollup: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "architect",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-update-all-agent"));
		await screen.findByText("3 updated");
		expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
	},
};

/** A merge is running: the glyph becomes a spinner IN THE SAME 24px box. */
export const Updating: Story = {
	render: () => {
		installBridge({
			holdApply: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(
				screen
					.getByTestId("hub-mark-agent-coder")
					.getAttribute("data-hub-mark"),
			).toBe("updating");
		});
	},
};

/** A failed attempt the backend still holds: a warning glyph whose press retries. */
export const Failed: Story = {
	render: () => {
		installBridge({
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
					error_class: "provider-error",
					last_error: "The model call timed out.",
				},
				{
					kind: "team",
					name: "lopdev",
					state: "failed",
					error_class: "prompt-too-long",
					last_error: "Too large.",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("data-hub-mark")).toBe("failed");
		expect(mark.getAttribute("aria-label")).toBe(
			"Retry the hub update for coder",
		);
	},
};

/** A press the server refuses: the sentence lands under the row, not in a toast. */
export const PressRefused: Story = {
	render: () => {
		installBridge({
			applyRefused: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await screen.findByRole("alert");
	},
};

/** Both-changed items are a decision, not a failure: a distinct mark, no retry. */
export const NeedsReview: Story = {
	render: () => {
		installBridge({
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "both-changed",
					error_class: "merge-refused",
					last_error: "Both changed a section.",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("data-hub-mark")).toBe("review");
		// UX U3: pressing it opens the review; it must never write.
		await userEvent.click(mark);
		const calls = (window as unknown as { __hubCalls: { op: string }[] })
			.__hubCalls;
		expect(calls.filter((call) => call.op === "hub.apply").length).toBe(0);
	},
};

/**
 * An agent that needs the login (`no-credential`): the sentence is drawn ONCE,
 * under Agents, as a link, and never under Teams (UX U1, design D5).
 */
export const SignedOut: Story = {
	render: () => {
		/*
		 * THE ORG-LINKED ROW'S REAL SHAPE (UX round 2, U11): `oscar` is linked to a
		 * tenant the local session has no credential for, so the check says
		 * `unavailable / no-credential` and the store keeps the item at
		 * `up-to-date` with that class. It is the only shape in which the sign-in
		 * sentence is reachable at all - the previous fixture used an `available`
		 * item, which the backend never produces for this case.
		 */
		installBridge({
			credential: "none",
			items: [
				{
					kind: "agent",
					name: "oscar",
					state: "up-to-date",
					tenant_id: "acme-team",
					error_class: "no-credential",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const link = await screen.findByRole("link", {
			name: "Sign in to Radient to get hub updates",
		});
		expect(link.getAttribute("href")).toContain("/settings");
		expect(
			screen.getAllByText("Sign in to Radient to get hub updates").length,
		).toBe(1);
		// The row is up to date: the sentence is the ONLY affordance, and no mark
		// is drawn (a `no-credential` item is never a row mark - design B6.2.4).
		expect(screen.queryByTestId("hub-mark-agent-oscar")).toBeNull();
	},
};

/**
 * Anonymous updates working while the credential reads `none`: NO sign-in line
 * (UX U1 - the sentence used to contradict the marks above it).
 */
export const SignedOutButUpdating: Story = {
	render: () => {
		installBridge({
			credential: "none",
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await screen.findByTestId("hub-mark-agent-coder");
		expect(screen.queryByText(/Sign in to Radient/)).toBeNull();
	},
};

/** The frame BEFORE the press in `TwoToOne`: two waiting, "Update all" in the heading. */
export const TwoWaiting: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
};

/**
 * Two waiting agents, the person presses one: the list must not move (design D2).
 * `data-frame` is read by the capture rig BEFORE and AFTER the press.
 */
export const TwoToOne: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const first = () =>
			screen.getByRole("button", { name: "New chat with architect" });
		await screen.findByTestId("hub-update-all-agent");
		const before = first().getBoundingClientRect().top;
		await userEvent.click(screen.getByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(screen.queryByTestId("hub-update-all-agent")).toBeNull();
		});
		// The strip that used to come and go reflowed every row by 28px.
		expect(first().getBoundingClientRect().top).toBe(before);
	},
};

/** A 40-character name at 279px, with a mark: the squeeze the mark costs the label (design D11). */
export const LongName: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: LONG_NAME,
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page width={279} />;
	},
	play: async () => {
		await screen.findByTestId(`hub-mark-agent-${LONG_NAME}`);
	},
};

/**
 * The 2-waiting state at 279px (design round 2, D17): the heading row carrying
 * "Update all (2)" AND the ⟳ check control, at the narrowest sidebar the app
 * draws. The measured boxes said it fits; this is the frame that shows it.
 */
export const TwoWaitingNarrow: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "reviewer",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page width={279} />;
	},
	play: async () => {
		await screen.findByTestId("hub-update-all-agent");
		expect(screen.getByTestId("hub-check-now")).toBeTruthy();
	},
};

/**
 * The MANUAL item's tooltip sentence (design round 2, D17): auto-update off, so
 * the sentence is the plain offer and the action, not "it will update
 * automatically". Focused, because the tooltip opens on focus and not on hover.
 */
export const MarkFocusedManual: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		(await screen.findByTestId("hub-mark-agent-coder")).focus();
		await screen.findByText(
			/A newer version is on the hub\. Click to update\./,
		);
	},
};

/** Keyboard focus on a mark opens the sidebar's own tooltip, naming the action (design D3). */
export const MarkFocused: Story = {
	render: () => {
		installBridge({
			autoAgents: true,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
					auto_will_apply: true,
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		(await screen.findByTestId("hub-mark-agent-coder")).focus();
		await screen.findByText(/Click to update\./, {}, { timeout: 3000 });
	},
};

/** The check-now control answers in a sentence, and the sentence goes away by itself (UX U8). */
export const CheckNow: Story = {
	render: () => {
		installBridge({ items: [] });
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-check-now"));
		await screen.findByText(/Checked just now\./);
	},
};

/**
 * Manual mode, retry after the hub restored the item: the retry answers in a
 * sentence, the ROW then offers the update, and the next press applies it
 * (UX round 2, U10 - "press it again to update" used to be unperformable: every
 * press was another retry and the item was unreachable).
 */
export const RetryReadyToUpdate: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			retryOutcome: { outcome: "would-merge" },
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "failed",
					error_class: "provider-error",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("data-hub-mark")).toBe("failed");
		await userEvent.click(mark);
		await screen.findByText(/It is ready to update/);
		// The row is now an OFFER: pressing again updates, which is what the
		// sentence tells the person to do. Under the defect this assertion is the
		// one that failed - the mark stayed `failed` and every press re-retried.
		const again = await screen.findByTestId("hub-mark-agent-coder");
		expect(again.getAttribute("data-hub-mark")).toBe("available");
	},
};

/**
 * The press after that sentence: the update the person was told to take, taken
 * (UX round 2, U10). Same scenario as `RetryReadyToUpdate`, carried one press
 * further, so the pair reads as the two halves of the same flow.
 */
export const RetryThenApplies: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			retryOutcome: { outcome: "would-merge" },
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "failed",
					error_class: "provider-error",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await screen.findByText(/It is ready to update/);
		await userEvent.click(await screen.findByTestId("hub-mark-agent-coder"));
		await waitFor(() => {
			expect(screen.queryByTestId("hub-mark-agent-coder")).toBeNull();
		});
	},
};

/** A press on a missing hub item: no blind retry; it opens the details and the class sentence is shown. */
export const FailedNotRetryable: Story = {
	render: () => {
		installBridge({
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "failed",
					error_class: "hub-item-missing",
				},
			],
		});
		return <Page />;
	},
	play: async () => {
		const mark = await screen.findByTestId("hub-mark-agent-coder");
		expect(mark.getAttribute("aria-label")).toBe(
			"See why the hub update for coder failed",
		);
		await userEvent.click(mark);
		const calls = (window as unknown as { __hubCalls: { op: string }[] })
			.__hubCalls;
		expect(calls.length).toBe(0);
	},
};

/** The 360px measurement the sidebar's own comments cite, with the longest copy. */
export const NarrowWidth: Story = {
	render: () => {
		installBridge({
			autoAgents: false,
			items: [
				{
					kind: "agent",
					name: "coder",
					state: "available",
					classification: "remote-only",
				},
				{
					kind: "agent",
					name: "release-captain",
					state: "available",
					classification: "both-changed",
					error_class: "merge-refused",
				},
				{
					kind: "team",
					name: "minerva-support",
					state: "failed",
					error_class: "concurrent-edit",
				},
			],
		});
		return <Page width={279} />;
	},
};
