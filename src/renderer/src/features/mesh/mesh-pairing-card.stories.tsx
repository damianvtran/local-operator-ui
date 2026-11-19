/**
 * The mesh pairing cards inside the Mesh approvals tray, one story per state.
 *
 * NOTHING HERE DIALS A BACKEND. Every row is the wire shape `GET
 * /v1/desktop/mesh/pairings` serves (core PR #4259, docs/DESKTOP_API.md "Mesh
 * pairing cards"), parsed by the shipped `pairingRows`, and drawn by the shipped
 * tray - so the state on screen is the state the app renders, not a hand-built
 * prop bag. The clock is pinned (`NOW`) so the time-left line is the same in
 * every frame.
 *
 * WHY EVERY STATE. The ceremony is two people at two screens reading digits to
 * each other under a clock; the states nobody photographs (the inviter's first
 * stage with nothing to press, a wrong code with attempts left, the host that
 * cannot attest) are exactly where a person gets lost. `Empty` is the tray with
 * no pairing at all: it renders NOTHING, which is the claim.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { type FC, useState } from "react";
import { type MeshApprovalRow, approvalRows } from "./mesh-approvals";
import { MeshApprovalsTray } from "./mesh-approvals-tray";
import type {
	MeshPairingSectionProps,
	PairingPendingPhase,
} from "./mesh-pairing-card";
import {
	type MeshPairingRow,
	type PairingOutcome,
	pairingRows,
} from "./mesh-pairings";

const NOW = 1_763_500_000;

const wire = (over: Record<string, unknown> = {}) => ({
	id: "joiner:inv_7Kd2",
	side: "joiner",
	stage: "awaiting_confirmation",
	invite_id: "inv_7Kd2",
	network_id: "net_home",
	network_name: "Home",
	peer_device_id: "dev_studio",
	peer_name: "Studio Mac",
	role: "",
	code: "481926",
	fingerprint: "SHA256:9f2c…",
	offers: {
		state: "listed",
		items: [
			{ key: "openai", label: "OpenAI API key", kind: "api_key", share: true },
		],
	},
	expires_at: NOW + 512,
	seconds_left: 512,
	attempts_left: 3,
	nonce: "a1b2c3d4",
	can_answer_here: true,
	answer_unavailable: "",
	...over,
});

const inviterWire = (over: Record<string, unknown> = {}) =>
	wire({
		id: "inviter:inv_7Kd2",
		side: "inviter",
		peer_device_id: "dev_laptop",
		peer_name: "Ana's MacBook Air",
		role: "drive",
		offers: {
			// Core's final one-vocabulary state (#4259 remediation; code review F1).
			state: "listed",
			items: [
				{
					key: "openai",
					label: "OpenAI API key",
					kind: "api_key",
					share: true,
				},
				{ key: "github", label: "GitHub token", kind: "token", share: true },
			],
		},
		...over,
	});

const rows = (...values: Record<string, unknown>[]): MeshPairingRow[] =>
	pairingRows({ pairings: values });

const outcome = (
	kind: PairingOutcome["kind"],
	row: MeshPairingRow,
): PairingOutcome => ({ id: row.id, row, kind, at: NOW * 1000 });

const bundle = (
	over: Partial<MeshPairingSectionProps> = {},
): MeshPairingSectionProps => ({
	rows: [],
	outcomes: [],
	loading: false,
	error: null,
	onRetry: () => {},
	nowSeconds: NOW,
	pending: null,
	refusal: null,
	// What main answers on a signed Mac launch (`pairings.eligibility`).
	eligibility: { eligible: true, reason: "" },
	onAnswer: () => {},
	...over,
});

/**
 * One ordinary onboarding approval record (the frozen §3.5 read shape), for the
 * story that stacks a pairing card above a regular approval.
 */
const approval: MeshApprovalRow[] = approvalRows({
	approvals: [
		{
			approval_id: "ap_2v9k4m0q7r1s",
			state: "requested",
			what: {
				connect: true,
				install: true,
				unattended: true,
				grant: ["approve"],
				network_id: "net_home",
				role: "drive",
			},
			requested_by: { surface: "cli", session_id: "0123456789ef" },
			expires_at: NOW + 42 * 60,
			device: {
				device_id: "dev_devon",
				name: "devon-laptop",
				host: "devon-laptop.local",
				user: "damian",
				transport: "ssh",
				host_key_fp: "SHA256:9f3cQm2p…",
			},
		},
	],
});

/** The tray exactly as the Mesh tab mounts it, with no approval records. */
const Tray: FC<{
	pairings: MeshPairingSectionProps;
	rows?: MeshApprovalRow[];
}> = ({ pairings, rows: approvalRecords = [] }) => (
	<div className="max-w-180">
		<MeshApprovalsTray
			rows={approvalRecords}
			error={null}
			pending={null}
			refusal={null}
			onDecide={() => {}}
			onRetry={() => {}}
			nowSeconds={NOW}
			pairings={pairings}
		/>
	</div>
);

const meta = {
	title: "Mesh/PairingCard",
	component: Tray,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"A mesh pairing in the Mesh approvals tray: this device's code to show on the other device, an empty field for the other device's code, offers, time left and the outcome.",
			},
		},
	},
} satisfies Meta<typeof Tray>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inviter, stage 1: the joiner has not typed yet. Its code and the waiting line; nothing to press. */
export const InviterShowsCode: Story = {
	args: {
		pairings: bundle({
			rows: rows(
				inviterWire({ stage: "awaiting_joiner", can_answer_here: false }),
			),
		}),
	},
};

/** Joiner: its own code to show, and the EMPTY field for the inviter's code. Confirm disabled. */
export const JoinerAwaiting: Story = {
	args: { pairings: bundle({ rows: rows(wire()) }) },
};

/** Inviter, stage 2: the joiner typed and matched; reduce-only shares, attempts left, Admit. */
export const InviterAwaitingConfirmation: Story = {
	args: { pairings: bundle({ rows: rows(inviterWire()) }) },
};

/** A wrong code: the card stays, the field is cleared, and the attempts left are named. */
export const MismatchAttemptsLeft: Story = {
	args: {
		pairings: bundle({
			rows: rows(inviterWire({ attempts_left: 2 })),
			refusal: {
				id: "inviter:inv_7Kd2",
				refusal: { kind: "mismatch", attemptsLeft: 2 },
				serial: 1,
			},
		}),
	},
};

/** Joiner after its own match: waiting for the inviter's person. */
export const WaitingForOtherDevice: Story = {
	args: {
		pairings: bundle({
			rows: rows(
				wire({ stage: "waiting_for_other_device", can_answer_here: false }),
			),
		}),
	},
};

/** The window ran out: the card at zero, and a card that already closed as expired. */
export const Expired: Story = {
	args: {
		pairings: bundle({
			rows: rows(wire({ expires_at: NOW - 1, seconds_left: 0 })),
			outcomes: [outcome("expired", rows(inviterWire())[0])],
		}),
	},
};

/** Closed cards that ended well: this device joined; the inviter admitted its peer. */
export const Joined: Story = {
	args: {
		pairings: bundle({
			outcomes: [
				outcome("joined", rows(wire())[0]),
				outcome("admitted", rows(inviterWire())[0]),
				outcome("finished", rows(wire({ id: "joiner:inv_other" }))[0]),
			],
		}),
	},
};

/** Closed cards that were refused: declined, and spent after three wrong codes. */
export const Refused: Story = {
	args: {
		pairings: bundle({
			outcomes: [
				outcome("declined", rows(inviterWire())[0]),
				outcome("spent", rows(wire())[0]),
			],
		}),
	},
};

/** A host that cannot attest (Linux/Windows): code shown, controls disabled, terminal fallback. */
export const NeedsAppUnsupportedHost: Story = {
	args: {
		pairings: bundle({
			rows: rows(
				inviterWire({
					can_answer_here: false,
					answer_unavailable: "unsupported_host",
				}),
				wire({
					can_answer_here: false,
					answer_unavailable: "no_app_attestation",
				}),
			),
		}),
	},
};

/** A provenance refusal from main (window not focused): what to do, keyed. */
export const NeedsForeground: Story = {
	args: {
		pairings: bundle({
			rows: rows(wire()),
			refusal: {
				id: "joiner:inv_7Kd2",
				refusal: { kind: "foreground", action: "confirm" },
				serial: 1,
			},
		}),
	},
};

/** The feed named an open card and the first read is in flight. */
export const Loading: Story = {
	args: { pairings: bundle({ loading: true }) },
};

/** The read failed: its sentence and Ask again. */
export const ReadError: Story = {
	args: {
		pairings: bundle({ error: "Pairing requests could not be read." }),
	},
};

/** No pairing and no approval: the tray draws nothing at all. */
export const Empty: Story = {
	args: { pairings: bundle() },
};

/**
 * A card that answers like the real tray: a press sets the in-flight state and
 * holds it (the answer never returns here), so the frame after a click is the
 * frame a person sees while main confirms, attests and core checks the code.
 */
const LiveTray: FC<{
	pairings: MeshPairingSectionProps;
	/** Where the held press is: the sheet still asking, or approved (U-R3-2). */
	phase?: PairingPendingPhase;
}> = ({ pairings, phase = "answering" }) => {
	const [pending, setPending] =
		useState<MeshPairingSectionProps["pending"]>(null);
	return (
		<Tray
			pairings={{
				...pairings,
				pending,
				onAnswer: (ask) =>
					setPending({ id: ask.row.id, decision: ask.decision, phase }),
			}}
		/>
	);
};

const typeCode = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await userEvent.type(
		await canvas.findByTestId("mesh-pairing-code-input"),
		"481926",
	);
	return canvas;
};

/** Inviter, stage 2, six digits typed: Admit is live (design D5). */
export const InviterCodeTyped: Story = {
	render: (args) => <LiveTray {...args} />,
	args: { pairings: bundle({ rows: rows(inviterWire()) }) },
	play: async ({ canvasElement }) => {
		await typeCode(canvasElement);
	},
};

/**
 * The press landed and main's native sheet is up: the card says only "Waiting
 * for confirmation…", never the act itself, until the person approves the sheet
 * (UX review round 3, U-R3-2).
 */
export const AwaitingSheet: Story = {
	render: (args) => <LiveTray {...args} phase="confirming" />,
	args: { pairings: bundle({ rows: rows(inviterWire()) }) },
	play: async ({ canvasElement }) => {
		const canvas = await typeCode(canvasElement);
		await userEvent.click(await canvas.findByTestId("mesh-pairing-admit"));
	},
};

/** The sheet was approved: "Checking…" while main attests and core compares. */
export const Confirming: Story = {
	render: (args) => <LiveTray {...args} />,
	args: { pairings: bundle({ rows: rows(inviterWire()) }) },
	play: async ({ canvasElement }) => {
		const canvas = await typeCode(canvasElement);
		await userEvent.click(await canvas.findByTestId("mesh-pairing-admit"));
	},
};

/** A pairing card renders FIRST, above the regular approvals waiting in the same tray. */
export const StackedAboveApproval: Story = {
	args: {
		pairings: bundle({ rows: rows(wire()) }),
		rows: approval,
	},
};

/**
 * Main says this LAUNCH can never attest (an unpackaged/dev build here): the
 * card is disabled up front, no "type the digits" hint, and the terminal
 * fallback - the joiner's with its `<code>` argument (design D1, UX U1/U2).
 */
export const DevBuildIneligible: Story = {
	args: {
		pairings: bundle({
			rows: rows(inviterWire(), wire({ id: "joiner:inv_other" })),
			eligibility: { eligible: false, reason: "not_packaged" },
		}),
	},
};

/** The listener did not answer in time: retryable, never "a development build" (UX U1). */
export const ListenerRetry: Story = {
	args: {
		pairings: bundle({
			rows: rows(wire()),
			refusal: {
				id: "joiner:inv_7Kd2",
				refusal: { kind: "relay" },
				serial: 1,
			},
		}),
	},
};
