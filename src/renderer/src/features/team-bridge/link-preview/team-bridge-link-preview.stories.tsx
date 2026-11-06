import type { Meta, StoryObj } from "@storybook/react";
import type {
	LinkPreviewBridge,
	LinkPreviewResolveResult,
} from "../../../../../shared/link-preview";
import {
	type LinkPreviewCardView,
	linkPreviewCardView,
} from "./link-preview-model";
import {
	TeamBridgeLinkPreview,
	TeamBridgeLinkPreviewView,
} from "./team-bridge-link-preview";

/**
 * The link-preview card, every state it has.
 *
 * WHY THE PRESENTATIONAL COMPONENT IS THE SUBJECT. The design round needs each
 * state on screen without a main process, a daemon or a live page: a `disabled`
 * switch and a `429` are two of the states and neither can be made to happen in a
 * frame otherwise. The connected component has its own story at the bottom, with
 * a fake bridge, so the seam the design round will exercise is proven too.
 *
 * `linkPreviewCardView` builds each view from the wire shape rather than from a
 * hand-written literal, so a rule change in the model shows up here instead of
 * being papered over by a story that agrees with itself.
 */
const image =
	"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%23232a36'/%3E%3Ccircle cx='120' cy='180' r='56' fill='%234f7cff'/%3E%3Crect x='220' y='120' width='320' height='18' rx='9' fill='%23c9d3e3'/%3E%3Crect x='220' y='160' width='240' height='12' rx='6' fill='%237887a0'/%3E%3C/svg%3E";

const favicon =
	"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' rx='7' fill='%234f7cff'/%3E%3C/svg%3E";

const view = (result: LinkPreviewResolveResult): LinkPreviewCardView =>
	linkPreviewCardView(result);

const full = view({
	kind: "ready",
	preview: {
		url: "https://www.anthropic.com/research/interpretability",
		title: "Tracing the thoughts of a large language model",
		description:
			"We applied interpretability tools to a production model and found a shared conceptual space it reasons in.",
		siteName: "Anthropic",
		favicon: { id: "0123456789abcdef0123456789abcdef", mime: "image/png" },
		image: {
			id: "fedcba9876543210fedcba9876543210",
			mime: "image/png",
			width: 640,
			height: 360,
		},
	},
});

/** The same card where core's header read carried no dimensions: the bytes still
 * serve, so the strip is reserved at a fixed height and no ratio is claimed. */
const unknownSize = view({
	kind: "ready",
	preview: {
		url: "https://example.com/changelog",
		title: "What changed this week",
		description: null,
		siteName: "Example",
		favicon: null,
		image: {
			id: "0123456789abcdef0123456789abcdef",
			mime: "image/png",
			width: null,
			height: null,
		},
	},
});

const textOnly = view({
	kind: "ready",
	preview: {
		url: "https://news.ycombinator.com/item?id=1",
		title: "Ask HN: how do you keep a changelog honest?",
		description: null,
		siteName: null,
		favicon: null,
		image: null,
	},
});

const meta: Meta<typeof TeamBridgeLinkPreviewView> = {
	title: "Team Bridge/Link preview",
	component: TeamBridgeLinkPreviewView,
	parameters: {
		layout: "padded",
	},
	decorators: [
		(Story) => (
			<div className="max-w-[380px]">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof TeamBridgeLinkPreviewView>;

export const ReadyWithImage: Story = {
	name: "Ready, with picture",
	args: { view: full, imageUrl: image, faviconUrl: favicon },
};

export const ReadyUnknownImageSize: Story = {
	name: "Ready, picture size unknown",
	args: { view: unknownSize, imageUrl: image },
};

export const ReadyTextOnly: Story = {
	name: "Ready, text only",
	args: { view: textOnly },
};

/** A picture whose bytes 404'd after the card resolved: the text keeps the card,
 * the picture slot is simply absent — never an empty framed box. */
export const ReadyImageGone: Story = {
	name: "Ready, picture refused",
	args: { view: full, faviconUrl: favicon },
};

/** `web_fetch.enabled` off: plain text at the caller, no card, no artifact, and
 * no further asking. Nothing is drawn here on purpose. */
export const Disabled: Story = {
	name: "Disabled (operator switch off)",
	args: { view: view({ kind: "absent", reason: "disabled" }) },
};

/** A link core declined: the same nothing, for a different reason. */
export const Absent: Story = {
	name: "Absent (local or private address)",
	args: { view: view({ kind: "absent", reason: "local-or-private" }) },
};

/** A `429` that named its delay: the card waits and draws nothing, because a
 * failure the reader cannot act on is worse than a blank line. */
export const RetryWaiting: Story = {
	name: "Retryable, waiting on core's delay",
	args: { view: view({ kind: "error", retryable: true, retryAfterMs: 4000 }) },
};

/** Retryable without a delay: one quiet control, and only the person decides. */
export const RetryManual: Story = {
	name: "Retryable, ask again",
	args: { view: view({ kind: "error", retryable: true }) },
};

/** Non-retryable (another account's receipt, or no sign-in): nothing. */
export const Silent: Story = {
	name: "Not retryable",
	args: { view: view({ kind: "error", retryable: false }) },
};

/**
 * The connected card against a fake bridge, so the seam is visible: the resolve
 * is an IPC call, the picture is bytes over a second IPC call, and neither is a
 * request this app makes to the linked site.
 */
const fakeBridge = (result: LinkPreviewResolveResult): LinkPreviewBridge => ({
	resolve: async () => result,
	artifact: async () => ({
		kind: "bytes",
		data: new Uint8Array([137, 80, 78, 71]),
		mimeType: "image/png",
	}),
});

export const Connected: Story = {
	name: "Connected (fake bridge)",
	render: () => (
		<TeamBridgeLinkPreview
			url="https://example.com/changelog"
			index={0}
			expectedAccountId="acct_story"
			bridge={fakeBridge({
				kind: "ready",
				preview: {
					url: "https://example.com/changelog",
					title: "What changed this week",
					description: "Three fixes, one of them visible.",
					siteName: "Example",
					favicon: null,
					image: null,
				},
			})}
		/>
	),
};
