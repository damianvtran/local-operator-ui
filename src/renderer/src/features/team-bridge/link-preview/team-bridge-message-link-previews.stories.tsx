import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type {
	LinkPreviewArtifactRequest,
	LinkPreviewBridge,
	LinkPreviewResolveRequest,
	LinkPreviewResolveResult,
} from "../../../../../shared/link-preview";
import type { TeamBridgeMessage } from "../../../../../shared/team-bridge-contract";
import {
	SHOT_RED_B64,
	SHOT_WIDE_B64,
} from "../team-bridge-attachments.fixtures";
import { TeamBridgeMessageList } from "../team-bridge-message-list";

/*
 * The link-preview card IN CONTEXT: inside the real message list, under a real
 * message body, so the card is judged against the bubble, the header and the
 * link text it belongs to rather than on a blank canvas (the card's own states
 * are in `team-bridge-link-preview.stories.tsx`).
 *
 * The states a reviewer has to see: a message with no links, one link, three
 * links, more than three (three cards, and the fourth link left as text), the
 * operator's switch off (plain link, no card), and mixed refusals (a private
 * address and a non-retryable error draw nothing beside a resolved card).
 *
 * WHAT IS MOCKED: the preload's `window.api.desktop.linkPreview`, the same seam
 * production reads, answering per URL from the table below - so the list, the
 * index assignment and the card-or-plain-text decision are the shipped code, and
 * only core's answers are scripted. The pictures are the attachment stories'
 * synthetic PNGs (generated pixels, no user data). No core, hub or network is
 * involved, and nothing here fetches the linked pages.
 *
 * The bridge is merged INTO `window.api.desktop` rather than replacing it, the
 * same way the attachment stories install their media relay, so a story that
 * loads after this one keeps every other member it relies on.
 */

const IMAGE_ID = "fedcba9876543210fedcba9876543210";
const FAVICON_ID = "0123456789abcdef0123456789abcdef";
const decode = (b64: string) =>
	Uint8Array.from(atob(b64), (character) => character.charCodeAt(0));

const card = (
	url: string,
	title: string,
	description: string,
	siteName: string,
	withImage: boolean,
): LinkPreviewResolveResult => ({
	kind: "ready",
	preview: {
		url,
		title,
		description,
		siteName,
		favicon: { id: FAVICON_ID, mime: "image/png" },
		image: withImage
			? { id: IMAGE_ID, mime: "image/png", width: 240, height: 150 }
			: null,
	},
});

/** Core's answer for each URL a story uses. Anything unlisted is `no-metadata`. */
const ANSWERS: Record<string, LinkPreviewResolveResult> = {
	"https://docs.example.com/guides/release-checklist": card(
		"https://docs.example.com/guides/release-checklist",
		"Release checklist",
		"Every step between a green build and a tagged release, in order, with the owner of each.",
		"Example Docs",
		true,
	),
	"https://status.example.com/incidents/42": card(
		"https://status.example.com/incidents/42",
		"Elevated API latency - resolved",
		"Between 14:02 and 14:31 UTC requests to the EU region saw elevated latency.",
		"Example Status",
		false,
	),
	"https://blog.example.org/posts/caching": card(
		"https://blog.example.org/posts/caching",
		"Two caches, one expiry",
		"Why a second copy of a TTL is a second expiry, and which one wins.",
		"Example Engineering",
		true,
	),
	"https://news.example.net/2026/11/launch": card(
		"https://news.example.net/2026/11/launch",
		"The launch, in one page",
		"What shipped, what did not, and what comes next.",
		"Example News",
		false,
	),
	"http://192.168.1.20/admin": { kind: "absent", reason: "local-or-private" },
	"https://flaky.example.com/report": { kind: "error", retryable: false },
	"https://off.example.com/one": { kind: "absent", reason: "disabled" },
	"https://off.example.com/two": { kind: "absent", reason: "disabled" },
};

const storyBridge: LinkPreviewBridge = {
	resolve: async (request: LinkPreviewResolveRequest) =>
		ANSWERS[request.url] ?? { kind: "absent", reason: "no-metadata" },
	artifact: async (request: LinkPreviewArtifactRequest) => ({
		kind: "bytes",
		data: decode(request.id === IMAGE_ID ? SHOT_WIDE_B64 : SHOT_RED_B64),
		mimeType: "image/png",
	}),
};

const installBridge = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = { ...api.desktop, linkPreview: storyBridge };
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installBridge();

const message = (id: string, body: string): TeamBridgeMessage => ({
	id,
	conversation_id: "bcv_link_previews",
	seq: 1,
	sender: { account_id: "acct_ada", kind: "human", display_label: "Ada" },
	body,
	origin: "human",
	created_at: new Date().toISOString(),
});

const Thread: FC<{ bodies: string[]; width?: number }> = ({
	bodies,
	width = 760,
}) => (
	<div className="flex flex-col bg-surface py-4 text-ink" style={{ width }}>
		<TeamBridgeMessageList
			messages={bodies.map((body, index) => ({
				...message(`bcmsg_lp_${index}`, body),
				seq: index + 1,
			}))}
			labelFor={(sender) => sender.display_label}
			tenantId="tnt_story"
			// The reader's account: the receipt every resolve carries. A list rendered
			// without one asks nothing, which is the production rule, not a story gap.
			accountId="acct_me"
		/>
	</div>
);

const meta = {
	title: "Team Bridge/Link preview in a message",
	component: Thread,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Thread>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoLinks: Story = {
	name: "No links",
	args: {
		bodies: ["Can you take the release this week? I am out from Thursday."],
	},
};

export const OneLink: Story = {
	name: "One link",
	args: {
		bodies: [
			"Before you tag it, walk this: https://docs.example.com/guides/release-checklist",
		],
	},
};

export const ThreeLinks: Story = {
	name: "Three links",
	args: {
		bodies: [
			[
				"Context for tomorrow:",
				"- the checklist https://docs.example.com/guides/release-checklist",
				"- last week's incident https://status.example.com/incidents/42",
				"- and the [caching write-up](https://blog.example.org/posts/caching)",
			].join("\n"),
		],
	},
};

export const MoreThanThree: Story = {
	name: "More than three links (three cards)",
	args: {
		bodies: [
			[
				"Reading list:",
				"https://docs.example.com/guides/release-checklist",
				"https://status.example.com/incidents/42",
				"https://blog.example.org/posts/caching",
				"https://news.example.net/2026/11/launch",
			].join("\n\n"),
		],
	},
};

export const Disabled: Story = {
	name: "Previews turned off (plain links)",
	args: {
		bodies: [
			"Both of these stay as links: https://off.example.com/one and https://off.example.com/two",
		],
	},
};

export const MixedRefusals: Story = {
	name: "Mixed refusals",
	args: {
		bodies: [
			[
				"The router at http://192.168.1.20/admin is down again,",
				"the write-up is https://blog.example.org/posts/caching,",
				"and the report at https://flaky.example.com/report would not load.",
				"Fourth link, past the cap: https://news.example.net/2026/11/launch",
			].join(" "),
		],
	},
};

/** Every state above as one conversation, for a single frame of the transcript. */
export const Conversation: Story = {
	name: "In a conversation",
	args: {
		bodies: [
			NoLinks.args?.bodies?.[0] ?? "",
			OneLink.args?.bodies?.[0] ?? "",
			MixedRefusals.args?.bodies?.[0] ?? "",
			Disabled.args?.bodies?.[0] ?? "",
		],
	},
};

/** The thread pane's narrow column: the card shrinks with the body. */
export const NarrowColumn: Story = {
	name: "One link, narrow column",
	args: { ...OneLink.args, width: 320 },
};
