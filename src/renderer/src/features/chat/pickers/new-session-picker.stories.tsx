/**
 * The `/new` device choice: which device a new conversation is born on.
 *
 * WHY THIS FILE EXISTS (design review round 1, D3). This is the operator's own
 * ask - "upon /new is there a simplified way to create new on remote and select
 * the device" - and it shipped with no story and no frame, so it could not be
 * signed off from source. Three states are required, plus the no-mesh state that
 * proves nothing changes for a user without a network:
 *
 *   - `ThisDevice`      the resting form, closed, on this device
 *   - `ChooseDevice`    the list open: one reachable peer and one unreachable peer
 *                       whose backend reason is long enough to test the row
 *   - `PeerChosen`      a peer picked, and the directory hint moving with it
 *   - `NoMesh`          no `features.peers`: NO device field at all
 *
 * The picker is driven through the real transport stub (`window.api.desktop
 * .request`), because `useDesktopCapabilities` and `usePeers` are what decide
 * whether the field exists at all: a story that rendered the form directly would
 * prove nothing about the gate.
 *
 * The unreachable option's label is `deviceLabel(peer) — unreachable: <reason>`,
 * with the reason in the BACKEND's words (`mesh-ui.md` §2.6): this app glosses
 * nothing, and does not invent a vocabulary of its own for a state the relay
 * already described.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent, waitFor } from "@storybook/test";
import type { FC } from "react";
import "../../../styles/index.css";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type {
	PeerList,
	PeerRow,
} from "../../../../../shared/desktop-session-contract";
import type { SlashCommandMeta } from "../components/slash-commands";
import { NewSessionPicker, type PickerContext } from "./destination-pickers";

const noop = () => {};

/** The two devices the catalogue lists, one of them out of reach. */
const LAPTOP = "d_9c02f1e4a7b3c6d5e8f9a0b1c2d3e4f5";
const STUDIO = "d_7e11a2b3c4d5e6f708192a3b4c5d6e7f";

/**
 * A reason a relay can really send, at a length that tests the row: the plan's own
 * example is short, so this is the same vocabulary (a refused dial, glossed) with
 * the address that made it long.
 */
const LONG_REASON =
	"no address of it answered: tried 192.168.1.31:47100 and studio-mini.local:47100";

const peer = (
	device_id: string,
	name: string,
	over: Partial<PeerRow> = {},
): PeerRow => ({
	device_id,
	name,
	reachable: true,
	rtt_ms: null,
	session_count: 0,
	last_seen_at: 1_789_400_210,
	unreachable_reason: "",
	...over,
});

const PEERS: PeerList = {
	peers: [
		peer(LAPTOP, "devon-laptop"),
		peer(STUDIO, "studio-mini", {
			reachable: false,
			unreachable_reason: LONG_REASON,
		}),
	],
	degraded: [],
};

const SPEC: SlashCommandMeta = {
	name: "new",
	description: "Start a new conversation",
	aliases: [],
	arguments: "optional",
	echo: false,
	consumes_prompt: false,
	destination: "new",
	execution: "owner",
};

const ACTION: NativeDesktopAction = {
	kind: "native_action",
	destination: "new",
	session_id: "sess",
	args: "",
	fields: [],
	data: {},
};

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string };

const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

/**
 * The transport, stubbed: `capabilities` decides whether the device field exists,
 * `peers.list` fills it, and everything else is refused loudly rather than
 * answered with a shape this story never checked.
 */
const installBridge = (peersEnabled: boolean) => {
	if (typeof window === "undefined") return;
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: async (request: BridgeRequest) => {
			if (request.op === "capabilities") {
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: peersEnabled ? { peers: 1 } : {},
				});
			}
			if (request.op === "peers.list") return ok(PEERS);
			return { status: 400, body: { detail: `unexpected ${request.op}` } };
		},
	};
};

/* ------------------------------------------------------------- harness */

/**
 * The production `NewSessionPicker` in a `PickerContext`. Only the fields this
 * picker reads (`canonical`, `onClose`, `rebind`) carry meaning; the rest are the
 * dispatcher's, filled rather than pretended into values that mean something.
 */
const Frame: FC<{ peersEnabled: boolean }> = ({ peersEnabled }) => {
	installBridge(peersEnabled);
	const ctx: PickerContext = {
		action: ACTION,
		spec: SPEC,
		sessionId: "sess",
		canonical: {
			frontend: { cwd: "/Users/damian/workspace" },
		} as unknown as CanonicalSessionHandle,
		commands: [SPEC],
		onClose: noop,
		note: noop,
		dispatch: noop,
		rebind: noop,
	};
	return <NewSessionPicker {...ctx} />;
};

/*
 * `satisfies Meta` with an untyped `StoryObj`, the shape
 * `chat-sidebar-peers.stories.tsx` uses: every story here renders `Frame`, which
 * builds the whole `PickerContext` itself, so there are no per-story args for the
 * generic `Meta<typeof NewSessionPicker>` to type (and that form demands `args` on
 * every story, which would mean restating the context five times).
 */
const meta = {
	title: "Chat/New conversation picker",
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen bg-canvas p-6 text-ink">
				<Story />
			</div>
		),
	],
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** The resting form: the device choice reads `This device` and nothing else changed. */
export const ThisDevice: Story = {
	render: () => <Frame peersEnabled />,
	play: async () => {
		await waitFor(() =>
			document.querySelector<HTMLElement>("#new-session-device"),
		);
		const trigger = document.querySelector<HTMLElement>("#new-session-device");
		if (trigger?.textContent?.trim() !== "This device")
			throw new Error(`the trigger reads "${trigger?.textContent?.trim()}"`);
		await screen.findByText("Must exist on this machine.");
	},
};

/**
 * The list open: a reachable peer and an unreachable one whose reason is long. The
 * play asserts the reason is PRESENT AND WHOLE in the document - the option label
 * is the one string in this picker that can overflow, and a frame that photographs
 * a truncated reason is the state D3 asked to see.
 */
export const ChooseDevice: Story = {
	render: () => <Frame peersEnabled />,
	play: async () => {
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>("#new-session-device");
			if (!node) throw new Error("no device trigger yet");
			return node;
		});
		await userEvent.click(trigger);
		await screen.findByRole("option", { name: "devon-laptop" });
		const unreachable = await screen.findByRole("option", {
			name: new RegExp(LONG_REASON.slice(0, 40)),
		});
		if (!unreachable.textContent?.includes(LONG_REASON))
			throw new Error(
				"the unreachable peer's reason is not whole in the option",
			);
	},
};

/** A peer picked: the hint moves with the choice, because the path resolves there. */
export const PeerChosen: Story = {
	render: () => <Frame peersEnabled />,
	play: async () => {
		const trigger = await waitFor(() => {
			const node = document.querySelector<HTMLElement>("#new-session-device");
			if (!node) throw new Error("no device trigger yet");
			return node;
		});
		await userEvent.click(trigger);
		await userEvent.click(
			await screen.findByRole("option", { name: "devon-laptop" }),
		);
		await screen.findByText("Must exist on devon-laptop.");
		if (trigger.textContent?.trim() !== "devon-laptop")
			throw new Error(`the trigger reads "${trigger.textContent?.trim()}"`);
	},
};

/**
 * NO MESH: without `features.peers` there is no device field, and the form is the
 * one this app has always had. This is the frame that proves the gate, and it is
 * the one a user without a network will ever see.
 */
export const NoMesh: Story = {
	render: () => <Frame peersEnabled={false} />,
	play: async () => {
		await screen.findByText("Must exist on this machine.");
		if (document.querySelector("#new-session-device"))
			throw new Error("the device field is mounted without features.peers");
	},
};
