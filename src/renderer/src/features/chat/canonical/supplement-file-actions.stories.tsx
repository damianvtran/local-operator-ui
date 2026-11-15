/**
 * The callout's file-actions menu — un-copied, copied and refused — at every
 * locale the preview can pin (`fr`, `ur` and `zh-CN` among them).
 *
 * REAL COMPONENT, SYNTHETIC BOUNDARY. `FileActionsMenu` here is the shipped
 * module `supplement-row.tsx` itself mounts: imported by path, never copied and
 * never re-drawn as markup, so a frame can only show what the product renders —
 * the trigger's accessible name, the item labels, the copied label and the
 * refusal toast all come from the component and its own translations. The two
 * seams Storybook genuinely cannot supply (the OS file probe, the clipboard) are
 * stubbed below and named; everything else is the app's own code.
 *
 * LOCALE is the preview's existing `locale` arg (`?args=locale:fr`), whose
 * options are read off the shipped catalogue directories; this story invents no
 * second switch. The component subscribes through `useI18nLocale()`, so moving
 * that control relabels the real menu live, and `ur` lays it out RTL under the
 * `dir` the preview writes.
 *
 * NO PRE-FIX FRAME IS CLAIMED FROM THIS FILE. Holding the menu at the base
 * revision would need either a copy of the component or a bundler alias around
 * it — both are the parallel implementation this story exists to avoid. An
 * English-before frame belongs to a base-branch run outside Storybook and must
 * not be read as coming from here.
 */
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { useEffect } from "react";
import { FileActionsMenu } from "./supplement-file-actions";

/* Deterministic synthetic fixture: no real file, no session, no user directory. */
const CWD = "/Users/someone/workspace/project";
const ACTION_PATH = "workspace/report/RUN-RECORD.md";
const FILE_NAME = "RUN-RECORD.md";

/**
 * Install the two boundary stubs for as long as the story is mounted, and put
 * the host's own back on unmount: Storybook runs many stories in one page, and
 * a stub left behind would answer for a later story's probe.
 *
 * - `window.api.probeFiles` answers for the fixture path. The menu resolves an
 *   action through this seam, so without it a press raises the app's resolution
 *   toast instead of reaching the state being shown.
 * - `navigator.clipboard.writeText` swallows the write, or refuses it for the
 *   failure state. Nothing reaches the machine's real clipboard.
 * - `openFile` / `showItemInFolder` stay ABSENT on purpose: `link-open.ts` reads
 *   a missing bridge as "outside Electron, nothing to open with", so a stray
 *   press cannot launch a file or reveal one on the machine running Storybook.
 */
function useSyntheticFileActions(clipboard: "accept" | "refuse") {
	useEffect(() => {
		const previousApi = window.api;
		const previousClipboard = Object.getOwnPropertyDescriptor(
			navigator,
			"clipboard",
		);
		window.api = {
			...(previousApi ?? {}),
			probeFiles: async (paths: string[]) =>
				paths.map((input) => ({
					input,
					resolved: `${CWD}/${ACTION_PATH}`,
					exists: true,
					isFile: true,
					sizeBytes: 37_000,
					mtimeMs: 1_760_000_000_000,
				})),
		} as typeof window.api;
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async () => {
					if (clipboard === "refuse") throw new Error("synthetic refusal");
				},
			},
		});
		return () => {
			// `Reflect.deleteProperty` restores ABSENCE rather than an `undefined`
			// value: the component's bridge checks are `typeof fn === "function"`
			// and optional calls, and a leftover own property would answer a later
			// story's probe with the wrong shape.
			if (previousApi === undefined) Reflect.deleteProperty(window, "api");
			else window.api = previousApi;
			if (previousClipboard) {
				Object.defineProperty(navigator, "clipboard", previousClipboard);
			} else {
				Reflect.deleteProperty(navigator, "clipboard");
			}
		};
	}, [clipboard]);
}

/**
 * The row's own grammar around the menu: the trigger is the bare ellipsis the
 * row draws, revealed on hover or keyboard focus by the row's `group`, exactly
 * as `supplement-row.tsx` wraps it. The path beside it is the callout's own
 * label, so the trigger wears the accessible name the row produces.
 */
function Row({ clipboard }: { clipboard: "accept" | "refuse" }) {
	useSyntheticFileActions(clipboard);
	return (
		<div className="group flex items-center gap-2 p-6">
			<span className="text-meta text-ink-dim">{ACTION_PATH}</span>
			<FileActionsMenu actionPath={ACTION_PATH} label={FILE_NAME} cwd={CWD} />
		</div>
	);
}

/** Open the menu through the trigger the row draws. */
const openMenu = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await userEvent.click(
		await canvas.findByRole("button", {
			name: t("ui.common.actions.actions_for_name", { name: FILE_NAME }),
		}),
	);
};

/** An open item, in the portal, found by the catalogue string for this locale. */
const item = (name: string) =>
	within(document.body).findByRole("menuitem", { name });

const meta = {
	title: "Chat/Canonical/Supplement file actions",
	component: FileActionsMenu,
	// `actionPath` and `label` are required props, so `StoryObj<typeof meta>`
	// demands them on every story unless meta supplies them. They mirror the
	// fixture `Row` mounts (the custom `render` ignores args, so frames are
	// unchanged); they exist to satisfy the Story type and describe the fixture
	// truthfully in Storybook's controls panel.
	args: { actionPath: ACTION_PATH, label: FILE_NAME, cwd: CWD },
	render: () => <Row clipboard="accept" />,
} satisfies Meta<typeof FileActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Un-copied, menu open. The item's label is the shipped copy-path key, so a
 * frame in any pinned locale shows that locale's catalogue value.
 */
export const Uncopied: Story = {
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await item(t("ui.common.file_actions.copy_file_path"));
	},
};

/**
 * Copied. The press runs the component's real handler (its stubbed clipboard
 * write) and closes the menu, so the label flip is shown by reopening it — the
 * state lives in the component, as it does for the reader who presses twice.
 */
export const Copied: Story = {
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await userEvent.click(
			await item(t("ui.common.file_actions.copy_file_path")),
		);
		await openMenu(canvasElement);
		await item(t("ui.common.actions.copied"));
	},
};

/**
 * A refusing clipboard. The component's own catch raises the already-keyed
 * refusal toast, which the preview's shared toast container draws.
 */
export const ClipboardRefused: Story = {
	render: () => <Row clipboard="refuse" />,
	play: async ({ canvasElement }) => {
		await openMenu(canvasElement);
		await userEvent.click(
			await item(t("ui.common.file_actions.copy_file_path")),
		);
		await within(document.body).findByText(
			t("ui.notices.files.copy_path_failed"),
		);
	},
};
