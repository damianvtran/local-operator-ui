import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { ExtensionSummary } from "../../../../../shared/browser-extensions";
import { BrowserExtensionsSubmenu } from "./browser-extensions-menu";
import { ExtensionsPageView } from "./browser-extensions-page";

/**
 * lop://extensions in every state the design spec (PR #1821, design review
 * round 1 §5) names, without a running browser host. The view is presentational
 * — main owns every decision and every confirmation — so these rows are exactly
 * the ExtensionSummary projections main sends; only callbacks are stubbed.
 * The decorator gives the page the tab content rect it fills in the app
 * (a fixed-height box), so sticky header and scrolling behave as they do there.
 */
/* D2: production cards show the verified package's icon (main inlines it as a
 * bounded data: URL); the fixtures are neutral generated PNGs — one square, one
 * deliberately 2:1 so the frames prove a non-square icon is contained, not
 * stretched. */
const SQUARE_ICON =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiUlEQVR42u2X2xHAIAgErSM1p2fTQAQ8xDtnZCZ/kd3EF7R2Wjxv79ZDgZbKoPC0xF+yaKRFULAnshUOS0Tgo/mOvJ+CRxceJLEKDktYg9EtCAmsgnv5yr9+6i+MBmThXs4rcAX0BbZtQ/pBJHUU0y4j+nUsUZBIlGT0olSiLJdoTGRaM4nmtDI+8qaVieUM1VoAAAAASUVORK5CYII=";
const WIDE_ICON =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAAAaElEQVR42u2WsQ2AMAwEX4I1mZOV2CIRKSxZDqk55Qs3lou7yqfnOttq2n2k+du9yPDvTmT4TwEK/FSABF8EaPBJgAgfAlT4IUCGLwLEpyYyfAiQc0JuIbeQW8gt5BZyC7mF3EIbt1AHkZPsl4eVlxEAAAAASUVORK5CYII=";
const base: ExtensionSummary = {
	id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
	name: "1Password – Password Manager",
	version: "8.12.44.33",
	status: "enabled",
	error: null,
	hasPopup: true,
	hasOptions: false,
	iconDataUrl: SQUARE_ICON,
	allSites: true,
	hosts: [],
	permissions: [
		"contextMenus",
		"downloads",
		"nativeMessaging",
		"notifications",
		"privacy",
		"storage",
		"tabs",
		"webRequest",
	],
	pendingVersion: null,
	description:
		"The best way to experience 1Password in your browser. Easily sign in to sites, generate passwords, and store secure information.",
	hasHomepage: true,
	waitingPages: 0,
};
const other: ExtensionSummary = {
	...base,
	id: "cjpalhdlnbpafiamejdnhcphjbkeiagm",
	name: "Example Blocker",
	version: "1.62.0",
	iconDataUrl: WIDE_ICON,
	hasPopup: true,
	hasOptions: true,
	allSites: false,
	hosts: ["*.example.com", "news.example.org"],
	permissions: ["storage", "declarativeNetRequest", "experimentalThing"],
	description: "Blocks trackers on the sites you choose.",
	hasHomepage: false,
};
const third: ExtensionSummary = {
	...other,
	id: "fldmhceldgbpfpkbgopacenieobmligc",
	name: "Reader Mode With A Deliberately Very Long Extension Name That Truncates",
	version: "2.0.33",
	status: "disabled",
	hasPopup: false,
	hasOptions: false,
	description: "",
	// The neutral-glyph fallback stays in every frame.
	iconDataUrl: null,
};

const noop = () => {};
const callbacks = {
	onNavigate: noop,
	onReload: noop,
	onSetEnabled: noop,
	onRemove: async () => false,
	onOpen: noop,
	onOpenLink: noop,
	onRetry: noop,
	onCancelInstall: noop,
	onOpenStore: noop,
	onCheckUpdates: noop,
};

const meta = {
	title: "Browser/Extensions page",
	component: ExtensionsPageView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story: FC) => (
			<div className="h-[720px] w-full bg-canvas">
				<Story />
			</div>
		),
	],
	args: {
		page: { page: "extensions", id: null },
		loadState: "ready",
		extensions: [base, other, third],
		installing: [],
		busy: new Set<string>(),
		checking: false,
		updateMessage: null,
		...callbacks,
	},
} satisfies Meta<typeof ExtensionsPageView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Loading: Story = {
	args: { loadState: "loading", extensions: [] },
};
export const LoadError: Story = {
	args: { loadState: "error", extensions: [] },
};
export const Empty: Story = { args: { extensions: [] } };
export const Starting: Story = {
	args: {
		extensions: [{ ...base, status: "loading", hasPopup: false }, other],
	},
};
export const WorkerNotReady: Story = {
	args: { extensions: [{ ...base, status: "error", error: "worker" }, other] },
};
export const VerificationFailed: Story = {
	args: {
		extensions: [
			{ ...base, status: "error", error: "verify", hasPopup: false },
			other,
		],
	},
};
export const UpdateWaitingForApproval: Story = {
	args: {
		extensions: [
			base,
			{ ...other, status: "needs-reconsent", pendingVersion: "1.63.0" },
		],
	},
};
export const CheckingForUpdates: Story = {
	args: { checking: true, busy: new Set(["updates"]) },
};
export const UpdateCheckFailed: Story = {
	args: {
		updateMessage:
			"Couldn't check for updates. Check your connection and try again.",
	},
};
export const Installing: Story = {
	args: {
		installing: [
			{ id: "bmnlcjabgnpnenekpadlanbbkooimhnj", phase: "downloading" },
		],
	},
};
export const PageWaiting: Story = {
	args: { extensions: [{ ...base, waitingPages: 1 }, other] },
};
export const BusyRow: Story = {
	args: { busy: new Set([base.id]) },
};
export const Details: Story = {
	args: { page: { page: "extensions", id: base.id } },
};
export const DetailsWithOptions: Story = {
	args: {
		page: { page: "extensions", id: other.id },
		extensions: [
			base,
			{ ...other, status: "needs-reconsent", pendingVersion: "1.63.0" },
		],
	},
};
export const DetailsNotFound: Story = {
	args: {
		page: { page: "extensions", id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
	},
};
/** ~420px content width: header actions wrap, one column, switch pinned. */
export const Narrow: Story = {
	decorators: [
		(Story: FC) => (
			<div className="h-[720px] w-[420px] bg-canvas">
				<Story />
			</div>
		),
	],
};
export const NarrowDetails: Story = {
	...Narrow,
	args: { page: { page: "extensions", id: base.id } },
};

/** The page-menu submenu: quick list, then Manage (→ lop://extensions). */
export const Submenu: StoryObj = {
	render: () => (
		<DropdownMenu open>
			<DropdownMenuTrigger>…</DropdownMenuTrigger>
			<DropdownMenuContent>
				<BrowserExtensionsSubmenu
					extensions={[base, { ...other, status: "disabled", hasPopup: false }]}
					onOpenPopup={noop}
					onManage={noop}
					onOpenStore={noop}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
