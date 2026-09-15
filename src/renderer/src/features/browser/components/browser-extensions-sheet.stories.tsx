/**
 * The browser extensions sheet, in every state its main-process projection can
 * be in.
 *
 * WHY this is a story rather than a screenshot of the running app: the sheet's
 * states are the *output* of the manager — an empty registry, a loaded
 * extension, a manifest that changed after approval, a registry that could not
 * be read — and forcing each of those in the live app means driving native
 * dialogs and editing files on disk between frames. The component takes its
 * transport as a prop for exactly this reason (see its own docstring), so the
 * frames here are of the shipped component with a stubbed `api`, and the states
 * are the real projections the manager produces.
 *
 * What these frames are NOT: proof that the native flow works. Nothing here
 * loads an extension. That evidence is the Electron run in
 * `scripts/browser-extensions-proof.mjs`, which boots the shipped main-process
 * modules in a real session.
 *
 * The warning strings below are the ones `src/main/browser/extensions.ts`
 * builds, copied rather than imported because this is renderer code and that
 * module is main-process. A drift makes a frame describe different copy from
 * the app's — worth a look in review, and the alternative (importing the main
 * bundle into the renderer) is worse.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import type {
	BrowserExtensionRow,
	BrowserExtensionsApi,
	BrowserExtensionsState,
} from "../../../../../shared/browser-extensions";
import { BrowserExtensionsSheet } from "./browser-extensions-sheet";

const COMPATIBILITY_WARNING =
	"Chrome extension support is partial. A successful load does not prove every feature works. Native messaging, browser-store services and desktop companion integrations are unavailable. File access is not granted.";
const NO_POPUP_WARNING =
	"This extension has no default popup. Action-click dispatch and browser toolbar integration are not available.";
const POPUP_WARNING =
	"Opens the declared default popup as an extension page. Active-tab grants, dynamic toolbar state and browser-window APIs may not behave like Chrome.";

/** A row with every field spelled out, so a story only states what it varies. */
function row(overrides: Partial<BrowserExtensionRow>): BrowserExtensionRow {
	return {
		key: "4b3f9f9e-3a2f-4e1c-9f2d-2f0d9c7a5b10",
		id: "cekgkegbidkbkfigdofagimfonadbdjj",
		name: "Proof Extension",
		version: "1.0",
		path: "/Users/you/extensions/proof-extension",
		enabled: true,
		loaded: true,
		error: null,
		permissions: ["Permission: storage", "Permission: alarms"],
		warnings: [COMPATIBILITY_WARNING],
		popup: true,
		...overrides,
	};
}

/** The manager's projection, with the states a stalled action leaves behind. */
const stub = (state: BrowserExtensionsState): BrowserExtensionsApi => ({
	list: async () => state,
	install: async () => state,
	setEnabled: async () => state,
	remove: async () => state,
	openPopup: async () => {},
});

/**
 * The compatibility warnings live inside the row's collapsed disclosure, so a
 * frame of the default state photographs a summary line that says they exist
 * and not the text itself. Opening it is what makes the frame show the copy a
 * user reads after one click, and it is a DOM state the component itself can
 * reach.
 *
 * The query is on `document`, not on this element: `SheetContent` renders
 * through a Radix portal at the end of `document.body`, so a `querySelectorAll`
 * scoped to a wrapper finds nothing and the elements stay closed — which is
 * exactly what the first capture of this story produced. The second pass is a
 * macrotask later because the portal's children mount in an effect of their
 * own, after this one.
 */
function ExpandedDisclosures({ children }: { children: ReactNode }) {
	useEffect(() => {
		const open = () => {
			for (const detail of document.querySelectorAll("details"))
				detail.open = true;
		};
		open();
		const timer = setTimeout(open, 50);
		return () => clearTimeout(timer);
	}, []);
	return <>{children}</>;
}

const meta: Meta<typeof BrowserExtensionsSheet> = {
	title: "Browser/Extensions sheet",
	component: BrowserExtensionsSheet,
	parameters: { layout: "fullscreen" },
	tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Framed({ state }: { state: BrowserExtensionsState }) {
	return (
		<BrowserExtensionsSheet open onOpenChange={() => {}} api={stub(state)} />
	);
}

export const Empty: Story = {
	render: () => <Framed state={{ rows: [], error: null }} />,
};

export const Installed: Story = {
	render: () => (
		<Framed
			state={{
				rows: [
					row({}),
					row({
						key: "9a1c2d3e-4f50-4a6b-8c7d-1e2f3a4b5c60",
						id: "iekpojmhfefniljhcifgambdkidgkibg",
						name: "Second extension",
						version: "2.4.1",
						path: "/Users/you/extensions/second-extension",
						enabled: false,
						loaded: false,
						permissions: [
							"Permission: tabs",
							"Site access: https://example.com/*",
						],
					}),
				],
				error: null,
			}}
		/>
	),
};

export const Warnings: Story = {
	decorators: [
		(Story) => (
			<ExpandedDisclosures>
				<Story />
			</ExpandedDisclosures>
		),
	],
	render: () => (
		<Framed
			state={{
				rows: [
					row({
						key: "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
						id: "fdkjnbhcedelcemabpbjacdcghgbafii",
						name: "Action-only extension",
						path: "/Users/you/extensions/action-only",
						popup: false,
						warnings: [COMPATIBILITY_WARNING, NO_POPUP_WARNING],
						permissions: ["Permission: storage"],
					}),
					row({
						key: "1f2e3d4c-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
						id: "jbfpjpacncgbglbmpmnemnfakkmhaflg",
						name: "Extension with a popup",
						path: "/Users/you/extensions/extension-with-a-popup",
						warnings: [COMPATIBILITY_WARNING, POPUP_WARNING],
					}),
				],
				error: null,
			}}
		/>
	),
};

export const Refused: Story = {
	decorators: [
		(Story) => (
			<ExpandedDisclosures>
				<Story />
			</ExpandedDisclosures>
		),
	],
	render: () => (
		<Framed
			state={{
				rows: [
					row({
						key: "2c1b0a9f-8e7d-4c6b-9a5f-4e3d2c1b0a99",
						id: "pkkbcmceabkfnjiabpdcgbmnfakmkbdd",
						name: "Changed after approval",
						path: "/Users/you/extensions/changed-after-approval",
						enabled: true,
						loaded: false,
						error:
							"The extension directory or manifest changed. Disable and enable it to review permissions again.",
					}),
				],
				error: null,
			}}
		/>
	),
};

export const RegistryUnreadable: Story = {
	render: () => (
		<Framed
			state={{
				rows: [],
				error:
					"The extension registry is unreadable or invalid. No extensions were loaded. Restore the registry before making changes.",
			}}
		/>
	),
};
