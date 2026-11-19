import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
/*
 * First, as in `team-bridge-composer.stories.tsx`: the composer registers with
 * the speech manager, which reads the preload's `electron` surface.
 */
import "../chat/components/story-electron-shim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FC, ReactNode } from "react";
import type {
	TeamBridgeMessage,
	TeamBridgeTypingState,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeComposer } from "./team-bridge-composer";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";
import {
	TeamBridgeTypingLine,
	TeamBridgeTypingProvider,
} from "./team-bridge-typing-line";

/*
 * Team Bridge typing indicators, every state the design review judges: nobody,
 * one, two, three and four-plus typers, a long name, under BOTH composers
 * (the channel bar and the thread pane), each scoped to its own surface.
 *
 * WHAT IS REAL: the composer, the thread pane, the provider, the reader hook
 * and the line. WHAT IS MOCKED: the typing GET (a synthetic hub answer with
 * long expiries so the frame holds still) and the window-focus gate (forced
 * on, since Storybook's iframe is rarely the focused window). Each story's
 * answer ALSO carries a typer in the other scope, so a frame that shows it
 * would be a scoping bug, not a fixture artefact.
 */

const CONVERSATION = "bcv_typing_story";
const TENANT = "org_story";
const ROOT_ID = "bcmsg_root_typing";
const NAMES: Record<string, string> = {
	acct_sana: "Sana",
	acct_ryan: "Ryan",
	acct_ana: "Ana",
	acct_bo: "Bo",
	acct_long: "Maximiliana Alexandrovna Kowalczyk-Featherstonehaugh",
	acct_long_two: "Bartholomew Montgomery-Vanderbilt",
	acct_long_three: "Anastasiya Konstantinovna Rimsky",
	acct_other_scope: "Should Never Show",
};
const OTHER_SCOPE_NAME = /Should Never Show/;
const labelFor = (accountId: string) => NAMES[accountId] ?? null;

function typingApi(accounts: readonly string[], scope: string | null) {
	const answer: TeamBridgeTypingState = {
		enabled: true,
		poll_after_ms: 3_000,
		message_seq: 1,
		truncated: false,
		typers: [
			...accounts.map((account_id) => ({
				account_id,
				kind: "human",
				thread_root_id: scope,
				expires_in_ms: 3_600_000,
			})),
			// The other surface's typer: must not appear in this frame.
			{
				account_id: "acct_other_scope",
				kind: "human",
				thread_root_id: scope === null ? ROOT_ID : null,
				expires_in_ms: 3_600_000,
			},
		],
	};
	return { typing: async () => answer };
}

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const Provider: FC<{
	accounts: readonly string[];
	scope: string | null;
	children: ReactNode;
}> = ({ accounts, scope, children }) => (
	<QueryClientProvider client={queryClient}>
		<TeamBridgeTypingProvider
			conversationId={CONVERSATION}
			tenantId={TENANT}
			selfAccountId="acct_self"
			open
			labelFor={labelFor}
			api={typingApi(accounts, scope)}
			windowActive
		>
			{children}
		</TeamBridgeTypingProvider>
	</QueryClientProvider>
);

/** The channel pane's foot, with the page's own column classes (team-bridge-page.tsx). */
const MainPane: FC<{ accounts: readonly string[] }> = ({ accounts }) => (
	<Provider accounts={accounts} scope={null}>
		<div className="flex h-[360px] w-[760px] flex-col justify-end bg-canvas text-ink">
			<div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1 pb-4">
				<TeamBridgeComposer
					conversationId={CONVERSATION}
					placeholder="Message #design"
					onSendMessage={() => true}
				/>
				<TeamBridgeTypingLine rootId={null} className="-mt-1" />
			</div>
		</div>
	</Provider>
);

const root: TeamBridgeMessage = {
	id: ROOT_ID,
	conversation_id: CONVERSATION,
	seq: 1,
	sender: { account_id: "acct_sana", kind: "human", display_label: "Sana" },
	body: "Can someone review the onboarding copy before Friday?",
	origin: "human",
	created_at: new Date().toISOString(),
};

const ThreadPane: FC<{ accounts: readonly string[] }> = ({ accounts }) => (
	<Provider accounts={accounts} scope={ROOT_ID}>
		<div className="flex h-[640px] bg-surface text-ink">
			<div className="flex-1 p-6 text-ink-muted">#design</div>
			<div className="h-full w-[26rem] shrink-0">
				<TeamBridgeThreadPaneView
					root={root}
					replies={[]}
					state="ready"
					labelFor={(sender) => sender.display_label}
					onClose={() => {}}
					onRetry={() => {}}
					onSend={async () => {}}
					typingLineRootId={ROOT_ID}
				/>
			</div>
		</div>
	</Provider>
);

const meta = {
	title: "Team Bridge/Typing indicator",
	component: MainPane,
	parameters: { layout: "fullscreen" },
	args: { accounts: [] as readonly string[] },
} satisfies Meta<typeof MainPane>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Asserts the rendered sentence, so a broken copy form fails the story's test run. */
const expectLine =
	(text: string, scope: "main" | "thread") =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const canvas = within(canvasElement);
		await waitFor(() => {
			const line = canvasElement.querySelector(
				`[data-team-bridge-typing="${scope}"]`,
			);
			expect(line).not.toBeNull();
			expect(line?.textContent ?? "").toBe(text);
		});
		expect(canvas.queryByText(OTHER_SCOPE_NAME)).toBeNull();
	};

export const MainNobody: Story = {
	args: { accounts: [] },
	play: expectLine("", "main"),
};
export const MainOne: Story = {
	args: { accounts: ["acct_sana"] },
	play: expectLine("Sana is typing", "main"),
};
export const MainTwo: Story = {
	args: { accounts: ["acct_sana", "acct_ryan"] },
	play: expectLine("Sana and Ryan are typing", "main"),
};
export const MainThree: Story = {
	args: { accounts: ["acct_sana", "acct_ryan", "acct_ana"] },
	play: expectLine("Sana, Ryan and Ana are typing", "main"),
};
export const MainSeveral: Story = {
	args: { accounts: ["acct_sana", "acct_ryan", "acct_ana", "acct_bo"] },
	play: expectLine("Several people are typing", "main"),
};
/**
 * Long names are clipped per name, never at the sentence's end (design round
 * 1, D1): the line must still close with its verb. The full text stays in the
 * DOM (and the polite region) - only the paint is cut - so the play checks the
 * geometry, not the text: the line itself never overflows, each name does.
 */
const expectVerbVisible =
	(text: string) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		await expectLine(text, "main")({ canvasElement });
		const line = canvasElement.querySelector<HTMLElement>(
			'[data-team-bridge-typing="main"]',
		);
		expect(line).not.toBeNull();
		if (!line) return;
		expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
		for (const name of line.querySelectorAll<HTMLElement>("strong"))
			expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
	};
export const MainLongName: Story = {
	args: { accounts: ["acct_long"] },
	play: expectVerbVisible(
		"Maximiliana Alexandrovna Kowalczyk-Featherstonehaugh is typing",
	),
};
export const MainThreeLongNames: Story = {
	args: { accounts: ["acct_long", "acct_long_two", "acct_long_three"] },
	play: expectVerbVisible(
		"Maximiliana Alexandrovna Kowalczyk-Featherstonehaugh, Bartholomew Montgomery-Vanderbilt and Anastasiya Konstantinovna Rimsky are typing",
	),
};

export const ThreadNobody: Story = {
	args: { accounts: [] },
	render: (args) => <ThreadPane {...args} />,
	play: expectLine("", "thread"),
};
export const ThreadOne: Story = {
	args: { accounts: ["acct_ryan"] },
	render: (args) => <ThreadPane {...args} />,
	play: expectLine("Ryan is typing", "thread"),
};
export const ThreadTwo: Story = {
	args: { accounts: ["acct_ryan", "acct_ana"] },
	render: (args) => <ThreadPane {...args} />,
	play: expectLine("Ryan and Ana are typing", "thread"),
};
export const ThreadThree: Story = {
	args: { accounts: ["acct_ryan", "acct_ana", "acct_bo"] },
	render: (args) => <ThreadPane {...args} />,
	play: expectLine("Ryan, Ana and Bo are typing", "thread"),
};
export const ThreadSeveral: Story = {
	args: { accounts: ["acct_sana", "acct_ryan", "acct_ana", "acct_bo"] },
	render: (args) => <ThreadPane {...args} />,
	play: expectLine("Several people are typing", "thread"),
};
