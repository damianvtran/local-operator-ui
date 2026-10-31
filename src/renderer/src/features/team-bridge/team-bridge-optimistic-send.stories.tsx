import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";

/*
 * THE OPTIMISTIC SEND, AS A FRAME (operator report, 2026-10-30).
 *
 * These three stories exist so a reviewer can LOOK at the state the press now
 * produces instead of taking it on trust: the author's message to a teammate's
 * chief of staff, drawn at the press, with the conversation not yet created. The
 * transport is the only thing stubbed - `onSend` hangs, refuses, or answers with
 * the stored message - because "still in flight", "failed" and "confirmed" are
 * three states of one real component, not three mock-ups of it.
 *
 * The person and the chief are the same human: `draftPerson` resolves through the
 * People roster, and the chief target is that person's agent row, so the frame
 * shows the name, the mark and the intro line the shipping pane draws.
 */
const self = "acct_self";
const peer = "acct_peer";

const person = {
	account_id: peer,
	display_label: "Bea Orti",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active" as const,
	agent: { endpoint_id: "bep_peer", name: "Aida", state: "active" },
};

const personDm: TeamBridgeConversation = {
	id: "bcv_person_dm",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: self,
	last_message_at: new Date().toISOString(),
	latest_seq: 0,
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: peer,
			kind: "human",
			display_label: "Bea Orti",
			role: "member",
			state: "active",
		},
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
};

/** The row the hub answers a send with: `client_ref` is not serialised on rows. */
const stored = (body: string): TeamBridgeMessage => ({
	id: "bcmsg_chief_first",
	conversation_id: "bcv_chief_dm",
	seq: 1,
	sender: { account_id: self, kind: "human", display_label: "Damian" },
	body,
	origin: "human",
	created_at: new Date().toISOString(),
});

const minervaOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 0,
};

const base = {
	selfAccountId: self,
	/* The shell's own name, which the real container supplies. */
	selfName: "Damian",
	people: [person],
	conversations: [personDm],
	/*
	 * A CHIEF TARGET: the reader is looking at the person's agent, which is exactly
	 * the lane a first message is typed into before any conversation exists. The
	 * rail shows the person's row; the thread shows the draft.
	 */
	target: { type: "chief" as const, accountId: peer },
	messages: [] as TeamBridgeMessage[],
	organizations: [minervaOrganization],
	scope: minervaOrganization.tenantId,
	totalUnread: 0,
	listState: "ready" as const,
	messageState: "idle" as const,
	onTarget: () => {},
	onNewChannel: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	onRetryPeople: () => {},
	initialDraft: "Can you take the launch checklist today?",
};

/*
 * THE MEASUREMENT, TAKEN IN THE PAGE RATHER THAN ARGUED.
 *
 * A capture cannot time a click from outside: the harness's round trip is larger
 * than the interval being claimed. So the press is timed where it happens - a
 * capture-phase listener notes `performance.now()` at the click, a MutationObserver
 * notes it again when the author's row first exists in the DOM, and the difference
 * is written as an inline custom property on <html>. `--press-to-row-ms` is read
 * back from the live page; "n/a" means the press has not happened yet.
 */
const usePressToRowMeasurement = () => {
	useEffect(() => {
		const stamp = (value: string) =>
			document.documentElement.style.setProperty("--press-to-row-ms", value);
		stamp("n/a");
		let pressedAt: number | null = null;
		const onPress = (event: Event) => {
			const target = event.target as HTMLElement | null;
			if (
				!target?.closest(
					'button[aria-label="Send"], button[aria-label="Send message"]',
				)
			)
				return;
			pressedAt = performance.now();
			stamp("pending");
		};
		const observer = new MutationObserver(() => {
			if (pressedAt === null) return;
			if (!document.querySelector("[data-row-key]")) return;
			stamp((performance.now() - pressedAt).toFixed(1));
			pressedAt = null;
		});
		document.addEventListener("click", onPress, true);
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			document.removeEventListener("click", onPress, true);
			observer.disconnect();
		};
	}, []);
};

const meta = {
	title: "Team Bridge/Optimistic send",
	component: TeamBridgePageView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => {
			usePressToRowMeasurement();
			return (
				<div className="flex h-dvh flex-col">
					<Story />
				</div>
			);
		},
	],
} satisfies Meta<typeof TeamBridgePageView>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * PRESS SEND: the row is already there, the create is still out. The clock is at
 * half ink - the quiet pending treatment - and no spinner is drawn per message.
 */
export const ChiefFirstMessagePending: Story = {
	args: {
		...base,
		/*
		 * THE ANSWER IS LATE ON PURPOSE (20s), so ONE page can be photographed twice:
		 * in flight, then confirmed - which is the only way to see that the row did
		 * not move, remount or re-animate when the server copy replaced it.
		 */
		onSend: () =>
			new Promise<unknown>((resolve) =>
				setTimeout(
					() => resolve(stored("Can you take the launch checklist today?")),
					20000,
				),
			),
	},
};

/** The hub refused. The row stays where it was typed, with Retry and Edit. */
export const ChiefFirstMessageFailed: Story = {
	args: {
		...base,
		onSend: () => Promise.reject(new Error("transport refused")),
	},
};

/**
 * THE SAME ROW, CONFIRMED: the POST answered with the stored message, so the row
 * is the server's - full ink, the hub's own seq, the same list item and place.
 */
export const ChiefFirstMessageReconciled: Story = {
	args: {
		...base,
		onSend: () =>
			Promise.resolve(stored("Can you take the launch checklist today?")),
	},
};

/*
 * THE MOVE ONTO THE CREATED CONVERSATION (design review round 1, D1).
 *
 * The stories above render a VIEW, where nothing is ever created. This one walks
 * the prop sequence the container produces for a first message - the person lane,
 * then the new DM with its thread read still in flight, then the DM with its
 * answer - on a timer, so the row can be photographed THROUGH the sequence that
 * used to swallow it behind a spinner. `onSend` reports its conversation the way
 * the container does, on the same press.
 */
const createdDm: TeamBridgeConversation = {
	...personDm,
	id: "bcv_created_dm",
	latest_seq: 0,
	last_message_at: new Date().toISOString(),
};

const MoveSequenceStory = () => {
	const [step, setStep] = useState(0);
	useEffect(() => {
		const timers = [
			setTimeout(() => setStep(1), 12000),
			setTimeout(() => setStep(2), 24000),
		];
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, []);
	const created = createdDm;
	if (step === 0)
		return <TeamBridgePageView {...base} onSend={reportingSend} />;
	if (step === 1)
		return (
			<TeamBridgePageView
				{...base}
				onSend={reportingSend}
				target={{ type: "conversation", id: created.id }}
				conversations={[personDm, created]}
				messageState="loading"
			/>
		);
	return (
		<TeamBridgePageView
			{...base}
			onSend={reportingSend}
			target={{ type: "conversation", id: created.id }}
			conversations={[personDm, created]}
			messageState="ready"
			messages={[stored("Can you take the launch checklist today?")]}
		/>
	);
};

/** The container's part: report the created conversation, then keep the post open. */
const reportingSend = (
	_body: string,
	_clientRef: string,
	_attachments?: unknown,
	delivery?: { onCreated?: (id: string, tenantId?: string) => void },
) => {
	delivery?.onCreated?.(createdDm.id, createdDm.tenant_id);
	return new Promise<unknown>(() => {});
};

export const ChiefFirstMessageMove: Story = {
	render: () => <MoveSequenceStory />,
	args: { ...base, onSend: reportingSend },
};
