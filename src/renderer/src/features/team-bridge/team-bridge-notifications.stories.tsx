import { Button } from "@shared/components/ui/button";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import {
	QueryClient,
	QueryClientProvider,
	useIsFetching,
} from "@tanstack/react-query";
import {
	useEffect,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../shared/desktop-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeNotifyRequest,
	teamBridgeOpenPath,
} from "../../../../shared/team-bridge-notify";
import { backendSettingsQueryOptions } from "../chat/canonical/use-display-flag";
import { TEAM_BRIDGE_ALL_SCOPE } from "./team-bridge-model";
import { teamBridgeKeys } from "./use-team-bridge";
import { useTeamBridgeNotifications } from "./use-team-bridge-notifications";

/**
 * D30 evidence at the preload boundary, not a second banner formatter. The
 * production hook, schemas, planner, directory resolver, sanitizer and cursor
 * all run; only desktop.request and the actual notify sink are fixtures.
 * A plain payload preview deliberately does not impersonate native OS pixels.
 */
type Scenario =
	| "settled"
	| "delayed-replies"
	| "delayed-directory"
	| "refused"
	| "wrong-scope"
	| "disabled";
const tenant = "tnt_notify_story";
const conversationId = "bcv_notify_story";
const rootId = "bcmsg_story_root";
const pixel = "https://invalid.example.test/private-pixel.png";
const foreignBody = "FOREIGN_REPLY_MUST_NOT_LEAK";
const root: TeamBridgeMessage = {
	id: rootId,
	conversation_id: conversationId,
	seq: 1,
	sender: {
		account_id: "acct_bea",
		kind: "human",
		display_label: "Root author",
	},
	body: "Already-read root, not the new reply",
	origin: "human",
	created_at: "2026-10-22T10:00:00Z",
};
const reply: TeamBridgeMessage = {
	...root,
	id: "bcmsg_story_reply",
	seq: 2,
	thread_root_id: rootId,
	sender: { account_id: "acct_bea", kind: "human", display_label: "Member" },
	body: `Can you check the **deploy**? ![](${pixel})`,
};
const conversation: TeamBridgeConversation = {
	id: conversationId,
	tenant_id: tenant,
	kind: "channel",
	name: "launch",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-22T10:01:00Z",
	latest_seq: 2,
	last_thread_root_id: rootId,
	last_sender_label: "Member",
	last_read_seq: 1,
	unread_count: 1,
	muted: false,
	notify: "all",
	member: true,
	members: [],
};

function gate() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function createFixture(scenario: Scenario) {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				networkMode: "always",
				refetchOnWindowFocus: false,
			},
		},
	});
	const replies = gate();
	const directory = gate();
	if (scenario !== "delayed-replies" && scenario !== "disabled")
		replies.release();
	if (scenario !== "delayed-directory") directory.release();
	let arrived = false;
	let enabled = true;
	let alive = true;
	const listeners = new Set<() => void>();
	let snapshot = {
		stage: "Seeding the production watcher",
		ready: false,
		polls: 0,
		repliesPending: false,
		directoryPending: false,
		enabled,
		emissions: [] as TeamBridgeNotifyRequest[],
		calls: [] as string[],
	};
	const update = (patch: Partial<typeof snapshot>) => {
		if (!alive) return;
		snapshot = { ...snapshot, ...patch };
		for (const listener of listeners) listener();
	};
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const request = async (request: DesktopRequest): Promise<DesktopResponse> => {
		update({ calls: [...snapshot.calls, request.op] });
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { settings: 1, team_bridge_conversations: 1 },
				});
			case "settings.list":
				return ok({
					settings: [{ key: "display.notifications", value: enabled }],
				});
			case "agent_messages.status":
				return ok({ account_id: "acct_self" });
			case "team_bridge.conversations.list":
				return ok({ conversations: [conversation] });
			case "team_bridge.unread":
				return request.scope === "account"
					? ok({
							total: arrived ? 1 : 0,
							organizations: [
								{
									tenant_id: tenant,
									tenant_name: "Minerva",
									eligible: true,
									unread: arrived ? 1 : 0,
								},
							],
						})
					: ok({
							total: arrived ? 1 : 0,
							conversations: arrived
								? [
										{
											conversation_id: conversationId,
											unread_count: 1,
											last_read_seq: 1,
											latest_seq: 2,
											muted: false,
										},
									]
								: [],
						});
			case "team_bridge.messages.list":
				// History is root-only. Returning reply seq 2 here would hide R6-1.
				return ok({ messages: [root] });
			case "team_bridge.messages.replies": {
				if (
					request.tenant_id !== tenant ||
					request.conversation_id !== conversationId ||
					request.message_id !== rootId ||
					request.after_seq !== 2 ||
					request.limit !== 1
				) {
					throw new Error(
						"Reply enrichment lost its bounded tenant/root/sequence scope",
					);
				}
				update({ stage: "Waiting for the reply read", repliesPending: true });
				await replies.promise;
				update({ stage: "Reply read answered", repliesPending: false });
				if (scenario === "refused")
					return {
						status: 403,
						body: {
							detail: {
								code: "bridge_not_available",
								message: "Fixture refuses the reply read",
							},
						},
					};
				return ok({
					root,
					replies: [
						scenario === "wrong-scope"
							? { ...reply, conversation_id: "bcv_foreign", body: foreignBody }
							: reply,
					],
				});
			}
			case "team_bridge.directory":
				if (request.tenant_id !== tenant)
					throw new Error("Directory lost the candidate tenant");
				update({
					stage: "Waiting for the tenant directory",
					directoryPending: true,
				});
				await directory.promise;
				update({
					stage: "Enrichment reads completed",
					directoryPending: false,
				});
				return ok({
					members: [
						{
							account_id: "acct_bea",
							display_label: "Bea Tran",
							role: "member",
							bridge_enabled: true,
							bridge_state: "active",
						},
					],
				});
			default:
				throw new Error(
					`Unexpected notification-story desktop op: ${request.op}`,
				);
		}
	};
	const poll = async () => {
		await client.invalidateQueries({ queryKey: teamBridgeKeys.all });
		update({ polls: snapshot.polls + 1 });
	};
	return {
		client,
		request,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => snapshot,
		seeded: () => {
			if (!snapshot.ready)
				update({ ready: true, stage: "Ready for a new reply" });
		},
		receive: async () => {
			arrived = true;
			update({ stage: "Reply seq 2 arrived" });
			await poll();
		},
		releaseReplies: replies.release,
		releaseDirectory: directory.release,
		poll,
		toggle: () => {
			enabled = !enabled;
			client.setQueryData(backendSettingsQueryOptions().queryKey, {
				settings: [{ key: "display.notifications", value: enabled }],
			});
			update({ enabled });
		},
		notify: async (payload: TeamBridgeNotifyRequest) => {
			update({
				emissions: [...snapshot.emissions, payload],
				stage: "Payload emitted by the production hook",
			});
			return { shown: false, reason: "unsupported" as const };
		},
		close: () => {
			alive = false;
			replies.release();
			directory.release();
			client.clear();
			listeners.clear();
		},
	};
}

type Fixture = ReturnType<typeof createFixture>;
function Watcher({ fixture }: { fixture: Fixture }) {
	useTeamBridgeNotifications(true);
	const fetching = useIsFetching();
	useEffect(() => {
		if (
			fetching === 0 &&
			fixture.client.getQueryData(
				teamBridgeKeys.unread(TEAM_BRIDGE_ALL_SCOPE),
			) &&
			fixture.client.getQueryData(
				teamBridgeKeys.conversations(TEAM_BRIDGE_ALL_SCOPE),
			)
		)
			fixture.seeded();
	}, [fetching, fixture]);
	return null;
}

function PayloadPreview({ scenario }: { scenario: Scenario }) {
	// Storybook can change args without unmounting the canvas. Each case owns
	// its transport, cursor and pending reads; never inherit a previous case.
	return <InstalledPreview key={scenario} scenario={scenario} />;
}

function InstalledPreview({ scenario }: { scenario: Scenario }) {
	const [fixture] = useState(() => createFixture(scenario));
	const [installed, setInstalled] = useState(false);
	const state = useSyncExternalStore(fixture.subscribe, fixture.getSnapshot);
	useLayoutEffect(() => {
		// Install before mounting the hook, not at module scope: another story's
		// preload must never be overwritten merely by importing this file.
		const page = window as unknown as { api?: { desktop?: unknown } };
		const api = page.api ?? {};
		page.api = api;
		const previous = api.desktop;
		api.desktop = {
			request: fixture.request,
			teamBridge: { notify: fixture.notify },
		};
		setInstalled(true);
		return () => {
			fixture.close();
			api.desktop = previous;
		};
	}, [fixture]);
	const payload = state.emissions.at(-1);
	return (
		<QueryClientProvider client={fixture.client}>
			{installed && <Watcher fixture={fixture} />}
			<main className="mx-auto flex max-w-2xl flex-col gap-6 bg-canvas p-8 text-ink">
				<header className="space-y-2">
					<h1 className="text-xl font-semibold">
						Notification payload preview
					</h1>
					<p className="text-sm text-ink-muted">
						Actual production-hook output, not native OS pixels. History
						contains root seq 1 only; its new reply is seq 2.
					</p>
				</header>
				<div className="flex flex-wrap gap-2">
					<Button
						disabled={
							!state.ready ||
							state.calls.includes("team_bridge.messages.replies")
						}
						onClick={() => void fixture.receive()}
					>
						Receive reply
					</Button>
					<Button
						disabled={!state.repliesPending}
						onClick={fixture.releaseReplies}
					>
						Release reply read
					</Button>
					<Button
						disabled={!state.directoryPending}
						onClick={fixture.releaseDirectory}
					>
						Release directory
					</Button>
					<Button onClick={fixture.toggle}>
						{state.enabled
							? "Disable desktop notifications"
							: "Enable desktop notifications"}
					</Button>
					<Button disabled={!state.ready} onClick={() => void fixture.poll()}>
						Poll same sequence
					</Button>
				</div>
				<output data-testid="read-stage" className="text-sm text-ink-muted">
					{state.stage}
				</output>
				<section
					aria-label="Emitted payload"
					className="space-y-4 bg-surface p-6"
				>
					<p className="text-sm text-ink-muted">
						Emissions:{" "}
						<output data-testid="emission-count">
							{state.emissions.length}
						</output>
					</p>
					{payload ? (
						<>
							<h2 data-testid="payload-title" className="text-lg font-semibold">
								{payload.title}
							</h2>
							<p
								data-testid="payload-subtitle"
								className="text-sm text-ink-muted"
							>
								{payload.subtitle}
							</p>
							<p data-testid="payload-body">{payload.body}</p>
							<dl className="space-y-2 text-sm">
								<dt className="text-ink-muted">Click target</dt>
								<dd data-testid="click-target" className="break-all font-mono">
									{teamBridgeOpenPath(payload)}
								</dd>
								<dt className="text-ink-muted">Candidate sequence</dt>
								<dd>{payload.seq}</dd>
							</dl>
						</>
					) : (
						<p className="text-ink-muted">No notification payload emitted.</p>
					)}
				</section>
				<p className="text-sm text-ink-muted">
					Completed polls: <span data-testid="poll-count">{state.polls}</span>
				</p>
				<details className="text-sm text-ink-muted">
					<summary>Transport calls (no bodies)</summary>
					<ol>
						{state.calls.map((op, index) => (
							<li key={`${index}-${op}`}>{op}</li>
						))}
					</ol>
				</details>
			</main>
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Notification payload",
	component: PayloadPreview,
	parameters: { layout: "fullscreen" },
	args: { scenario: "settled" },
} satisfies Meta<typeof PayloadPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
const frame = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

const pollSameSequence = async (canvas: ReturnType<typeof within>) => {
	const previous = Number(canvas.getByTestId("poll-count").textContent);
	await userEvent.click(
		canvas.getByRole("button", { name: "Poll same sequence" }),
	);
	await waitFor(() =>
		expect(
			Number(canvas.getByTestId("poll-count").textContent),
		).toBeGreaterThan(previous),
	);
	await frame();
};

const exercise =
	(scenario: Scenario): NonNullable<Story["play"]> =>
	async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Receive reply" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Receive reply" }),
		);
		if (scenario === "delayed-replies" || scenario === "disabled") {
			await waitFor(() =>
				expect(
					canvas.getByRole("button", { name: "Release reply read" }),
				).toBeEnabled(),
			);
			await expect(canvas.getByTestId("emission-count")).toHaveTextContent("0");
			// Keep this state on screen for the consecutive pending/settled capture.
			if (scenario === "delayed-replies") return;
			await userEvent.click(
				canvas.getByRole("button", { name: "Disable desktop notifications" }),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "Release reply read" }),
			);
			await waitFor(() =>
				expect(canvas.getByTestId("read-stage")).toHaveTextContent(
					"Enrichment reads completed",
				),
			);
			await frame();
			await expect(canvas.getByTestId("emission-count")).toHaveTextContent("0");
			await userEvent.click(
				canvas.getByRole("button", { name: "Enable desktop notifications" }),
			);
			await pollSameSequence(canvas);
			await expect(canvas.getByTestId("emission-count")).toHaveTextContent("0");
			return;
		}
		if (scenario === "delayed-directory") {
			await waitFor(() =>
				expect(
					canvas.getByRole("button", { name: "Release directory" }),
				).toBeEnabled(),
			);
			await expect(canvas.getByTestId("emission-count")).toHaveTextContent("0");
			return;
		}
		await waitFor(() =>
			expect(canvas.getByTestId("emission-count")).toHaveTextContent("1"),
		);
		await expect(canvas.getByTestId("payload-title")).toHaveTextContent(
			scenario === "settled" ? "Bea Tran" : "launch",
		);
		await expect(canvas.getByTestId("click-target")).toHaveTextContent(
			`/team-bridge?tenant=${tenant}&conversation=${conversationId}&thread=${rootId}`,
		);
		if (scenario === "settled")
			await expect(canvas.getByTestId("payload-body")).toHaveTextContent(
				"Can you check the deploy?",
			);
		else
			await expect(canvas.getByTestId("payload-body")).not.toHaveTextContent(
				"Can you check the deploy?",
			);
		await expect(canvasElement).not.toHaveTextContent(foreignBody);
		await expect(canvasElement).not.toHaveTextContent(pixel);
		await expect(canvasElement.querySelector("img")).toBeNull();
		await pollSameSequence(canvas);
		await expect(canvas.getByTestId("emission-count")).toHaveTextContent("1");
	};

export const SettledReply: Story = {
	args: { scenario: "settled" },
	play: exercise("settled"),
};
export const PendingReplies: Story = {
	args: { scenario: "delayed-replies" },
	play: exercise("delayed-replies"),
};
export const PendingDirectory: Story = {
	args: { scenario: "delayed-directory" },
	play: exercise("delayed-directory"),
};
export const RefusedReply: Story = {
	args: { scenario: "refused" },
	play: exercise("refused"),
};
export const WrongScopeReply: Story = {
	args: { scenario: "wrong-scope" },
	play: exercise("wrong-scope"),
};
export const DisabledWhilePending: Story = {
	args: { scenario: "disabled" },
	play: exercise("disabled"),
};
