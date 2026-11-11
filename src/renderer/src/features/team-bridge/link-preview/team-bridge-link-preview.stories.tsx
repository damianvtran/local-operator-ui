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

/*
 * A stand-in for GitHub's 1200x600 og:image, drawn to the same layout because
 * the layout is what the crop bug destroyed: a white ground, a large title, a
 * subtitle, a stats row near the bottom and GitHub's coloured language bar
 * flush with the bottom edge. The old `object-cover` cut that bottom band off
 * at any card wider than 352px, so this fixture makes a crop visible in a
 * single frame (the bar is either there or it is not). Synthetic rather than
 * the real PNG: the real one carries a contributor's avatar, which is not ours
 * to commit as a fixture.
 */
const githubOgImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
	`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='600'>` +
		`<rect width='1200' height='600' fill='#ffffff'/>` +
		`<text x='80' y='110' font-family='sans-serif' font-size='28' fill='#57606a'>New Release v0.101.41</text>` +
		`<text x='80' y='190' font-family='sans-serif' font-size='56' font-weight='700' fill='#1f2328'>0.101.41: Clearer handling of</text>` +
		`<text x='80' y='255' font-family='sans-serif' font-size='56' font-weight='700' fill='#1f2328'>empty and conflicting provider...</text>` +
		`<text x='80' y='330' font-family='sans-serif' font-size='34' fill='#57606a'>This patch makes two kinds of provider failure</text>` +
		`<rect x='940' y='70' width='180' height='180' rx='18' fill='#8c959f'/>` +
		`<circle cx='100' cy='470' r='22' fill='#8c959f'/>` +
		`<text x='140' y='466' font-family='sans-serif' font-size='26' fill='#1f2328'>1</text>` +
		`<text x='140' y='496' font-family='sans-serif' font-size='22' fill='#57606a'>Contributor</text>` +
		`<rect y='580' width='980' height='20' fill='#3572a5'/>` +
		`<rect x='980' y='580' width='220' height='20' fill='#3178c6'/>` +
		"</svg>",
)}`;

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

/** GitHub's release page as core resolves it: a 2:1 picture, a title long
 * enough to wrap, a description long enough to clamp. */
const github = view({
	kind: "ready",
	preview: {
		url: "https://github.com/damianvtran/local-operator/releases/tag/v0.101.41",
		title:
			"Release 0.101.41: Clearer handling of empty and conflicting provider replies · damianvtran/local-operator",
		description:
			"Clearer handling of empty and conflicting provider replies This patch makes two kinds of provider failure easier to understand and recover from. A provider reply with no content is now retried once, then reported with the provider and model.",
		siteName: "GitHub",
		favicon: { id: "0123456789abcdef0123456789abcdef", mime: "image/png" },
		image: {
			id: "fedcba9876543210fedcba9876543210",
			mime: "image/png",
			width: 1200,
			height: 600,
		},
	},
});

/** No picture, but every text field: the plate alone carries the card. */
const noImage = view({
	kind: "ready",
	preview: {
		url: "https://docs.python.org/3/library/asyncio-task.html",
		title: "Coroutines and Tasks — Python 3.14 documentation",
		description:
			"This section outlines high-level asyncio APIs to work with coroutines and Tasks.",
		siteName: "Python documentation",
		favicon: null,
		image: null,
	},
});

/** A title far past two lines, so the clamp and its ellipsis are looked at. */
const longTitle = view({
	kind: "ready",
	preview: {
		url: "https://example.com/posts/long",
		title:
			"An unreasonably long page title that keeps going well past the second line of the card, because some sites put the whole first paragraph into their og:title and the card must still hold its shape",
		description:
			"And a description that is also long enough to need its own clamp: it runs on past the third line so the ellipsis at the end of the third line is something a reviewer can see rather than infer from the class list.",
		siteName:
			"A site name long enough to truncate on its own single source line",
		favicon: null,
		image: null,
	},
});

/** Unbroken tokens: a URL as the title (sites with no og:title do this) and a
 * hash as the description. Neither has a space to wrap at. */
const longUrl = view({
	kind: "ready",
	preview: {
		url: "https://example.com/a/very/long/path/that/never/breaks/0123456789abcdef0123456789abcdef0123456789abcdef?query=0123456789abcdef0123456789abcdef",
		title:
			"https://example.com/a/very/long/path/that/never/breaks/0123456789abcdef0123456789abcdef0123456789abcdef?query=0123456789abcdef0123456789abcdef",
		description:
			"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		siteName: null,
		favicon: null,
		image: null,
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

/**
 * The chat column's 172px floor (design round 1 asked for this as a frame rather
 * than arithmetic). The meta decorator pins 380px, the width the ratio cap is
 * measured at; this story overrides it so the wrap, the truncation and the
 * two-line clamp are looked at instead of derived.
 */
export const ReadyAtChatColumnFloor: Story = {
	name: "Ready, at the 172px chat column floor",
	args: { view: full, imageUrl: image, faviconUrl: favicon },
	decorators: [
		(Story) => (
			<div className="max-w-[172px]">
				<Story />
			</div>
		),
	],
};

/** GitHub's 2:1 card at the 380px measuring width: the box is capped at 176px,
 * so the picture letterboxes rather than losing its bottom bar to a crop. */
export const ReadyGitHub: Story = {
	name: "Ready, GitHub 2:1 picture",
	args: { view: github, imageUrl: githubOgImage, faviconUrl: favicon },
};

export const ReadyNoImage: Story = {
	name: "Ready, no picture",
	args: { view: noImage },
};

export const ReadyLongTitle: Story = {
	name: "Ready, long title and description",
	args: { view: longTitle },
};

export const ReadyLongUrl: Story = {
	name: "Ready, long unbroken URL",
	args: { view: longUrl },
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
