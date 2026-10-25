import tourAgenticSequenceImage from "@assets/images/tour/agentic-sequence.png";
import tourCanvasCodeInlineEditImage from "@assets/images/tour/canvas-code-inline-edit.png";
import tourCanvasOverviewImage from "@assets/images/tour/canvas-overview.png";
import tourCanvasVariablesImage from "@assets/images/tour/canvas-variables-view.png";
import tourChatAttachmentsImage from "@assets/images/tour/chat-attachments.png";
import tourChatFullViewImage from "@assets/images/tour/chat-full-view.png";
import tourChatInputImage from "@assets/images/tour/chat-input.png";
import tourInlineEditCanvasImage from "@assets/images/tour/inline-edit-canvas.png";
import { paletteDoorLabel } from "@features/command-palette/palette-shortcut";
import { t } from "@shared/i18n";
import type { WithoutParams } from "@shared/i18n";

/**
 * The walkthrough tour's copy and body structure.
 *
 * WHY THE BODIES ARE DATA, NOT PROSE WITH MARKUP. A tour body is a document —
 * paragraphs, bulleted lists, screenshots and inline keyboard shortcuts — and
 * the catalogue forbids markup in a message. So the catalogue holds the words
 * (one key per translatable run) and this module holds the structure: block
 * order, image sources, and the literal key names/symbols rendered inside
 * `<code>`. The renderer below puts them back together; moving a paragraph or
 * a screenshot is an edit here, never a change to a translated sentence.
 *
 * WHY FRAGMENTS AROUND `<code>` SPANS. The repository has no rich-text tag
 * convention (`<Trans>` or tag-bearing ICU messages); its demonstrated pattern
 * for emphasised runs is a message per fragment, with the component inserting
 * the element between them (see `project-delete-dialog.tsx`). These runs
 * follow that pattern, and each fragment's context sidecar states that its
 * leading/trailing spaces are load-bearing.
 *
 * `breaks` reproduces the source's `<br>` count after a block, so the rendered
 * body keeps the spacing the tour had before extraction. It is presentation,
 * not copy.
 */

/**
 * A catalogue key in the tour's own namespace.
 *
 * Narrowed from the generated parameterless-key union so a typo fails `tsc`
 * instead of rendering a raw key, and so `t()`'s no-argument overload accepts
 * it. Every tour message is parameterless: structure and literal key names stay
 * in this module rather than becoming ICU arguments.
 */
type TourKey = Extract<WithoutParams, `ui.onboarding.tour.${string}`>;

/** One inline run: catalogue copy, or a literal rendered as `<code>`. */
export type TourRun = { readonly key: TourKey } | { readonly code: string };

/** One block of a step body, with the source's `<br>` count after it. */
export type TourBlock =
	| {
			readonly kind: "paragraph";
			readonly runs: readonly TourRun[];
			readonly breaks?: 0 | 1 | 2;
	  }
	| {
			readonly kind: "list";
			readonly items: readonly (readonly TourRun[])[];
			readonly breaks?: 0 | 1 | 2;
	  }
	| {
			readonly kind: "image";
			readonly src: string;
			readonly altKey: TourKey;
			/** The screenshot's source inline style, kept verbatim from the tour. */
			readonly style: string;
			readonly breaks?: 0 | 1 | 2;
	  };

/**
 * Escape text that is assembled into Shepherd's HTML string.
 *
 * Shepherd assigns `text` to `innerHTML`. Catalogue copy is data, not markup:
 * without this, a translation containing `<` or `&` would inject markup or
 * render a broken entity. The structure tags in the renderer are the only
 * markup this module emits. Quotes stay literal in text (they need escaping
 * only inside an attribute); escaping them here would rewrite ordinary prose.
 */
const escapeHtml = (value: string): string =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string =>
	escapeHtml(value).replace(/"/g, "&quot;");

const renderRuns = (runs: readonly TourRun[]): string =>
	runs
		.map((run) =>
			"key" in run
				? escapeHtml(t(run.key))
				: `<code>${escapeHtml(run.code)}</code>`,
		)
		.join("");

const renderBlock = (block: TourBlock): string => {
	const breaks = "<br/>".repeat(block.breaks ?? 0);
	if (block.kind === "paragraph") return `${renderRuns(block.runs)}${breaks}`;
	if (block.kind === "list") {
		const items = block.items
			.map((item) => `<li>${renderRuns(item)}</li>`)
			.join("");
		return `<ul>${items}</ul>${breaks}`;
	}
	return `<img src="${block.src}" alt="${escapeAttribute(t(block.altKey))}" style="${block.style}"/>${breaks}`;
};

/** Build the HTML Shepherd renders for one step body. */
export const renderTourBody = (blocks: readonly TourBlock[]): string =>
	blocks.map(renderBlock).join("");

/** Every step body, in tour order. */
export const TOUR_BODIES = {
	welcome: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.welcome.body.1" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourChatFullViewImage,
			altKey: "ui.onboarding.tour.welcome.image.1.alt",
			style:
				"width: 100%; height: 350px; object-fit: contain; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.welcome.body.2" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.welcome.body.3" }],
			breaks: 0,
		},
		{
			kind: "list",
			items: [
				[{ key: "ui.onboarding.tour.welcome.list.1.item.1" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.2" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.3" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.4" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.5" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.6" }],
				[{ key: "ui.onboarding.tour.welcome.list.1.item.7" }],
			],
			breaks: 0,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.welcome.body.4" }],
			breaks: 0,
		},
	],
	agent_list: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_list.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_list.body.2" }],
			breaks: 0,
		},
	],
	select_agent: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.select_agent.body.1" }],
			breaks: 0,
		},
	],
	chat_input: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.chat_input.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.chat_input.body.2" }],
			breaks: 2,
		},
		{
			kind: "list",
			items: [
				[{ key: "ui.onboarding.tour.chat_input.list.1.item.1" }],
				[{ key: "ui.onboarding.tour.chat_input.list.1.item.2" }],
				[{ key: "ui.onboarding.tour.chat_input.list.1.item.3" }],
			],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourChatInputImage,
			altKey: "ui.onboarding.tour.chat_input.image.1.alt",
			style:
				"width: 100%; height: 200px; object-fit: contain; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.chat_input.body.3" }],
			breaks: 0,
		},
	],
	attachments: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.attachments.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.attachments.body.2" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourChatAttachmentsImage,
			altKey: "ui.onboarding.tour.attachments.image.1.alt",
			style:
				"width: 100%; height: 200px; object-fit: contain; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.attachments.body.3" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.attachments.body.4" }],
			breaks: 0,
		},
	],
	agent_capabilities: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_capabilities.body.1" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourAgenticSequenceImage,
			altKey: "ui.onboarding.tour.agent_capabilities.image.1.alt",
			style:
				"width: 100%; height: 350px; object-fit: contain; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_capabilities.body.2" }],
			breaks: 0,
		},
	],
	pre_command_palette_open_canvas: [
		{
			kind: "paragraph",
			runs: [
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.1" },
				{ code: paletteDoorLabel("everything", true) },
				{
					key: "ui.onboarding.tour.pre_command_palette_open_canvas.connector.on_mac_and",
				},
				{ code: paletteDoorLabel("everything", false) },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.3" },
				{ code: "#" },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.4" },
				{ code: "@" },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.5" },
				{ code: "," },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.6" },
				{ code: ">" },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.1.7" },
			],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.2.1" },
				{ code: paletteDoorLabel("chats", true) },
				{
					key: "ui.onboarding.tour.pre_command_palette_open_canvas.connector.on_mac_and",
				},
				{ code: paletteDoorLabel("chats", false) },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.2.3" },
				{ code: paletteDoorLabel("commands", true) },
				{
					key: "ui.onboarding.tour.pre_command_palette_open_canvas.connector.on_mac_and",
				},
				{ code: paletteDoorLabel("commands", false) },
				{ key: "ui.onboarding.tour.pre_command_palette_open_canvas.body.2.5" },
			],
			breaks: 0,
		},
	],
	canvas_open_button: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_open_button.body.1" }],
			breaks: 0,
		},
	],
	canvas_feature: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_feature.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_feature.body.2" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourCanvasOverviewImage,
			altKey: "ui.onboarding.tour.canvas_feature.image.1.alt",
			style:
				"width: 100%; height: 300px; object-fit: contain; border-radius: 8px;",
			breaks: 0,
		},
	],
	canvas_documents_view: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_documents_view.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_documents_view.body.2" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourInlineEditCanvasImage,
			altKey: "ui.onboarding.tour.canvas_documents_view.image.1.alt",
			style:
				"width: 100%; height: 200px; object-fit: contain; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_documents_view.body.3" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourCanvasCodeInlineEditImage,
			altKey: "ui.onboarding.tour.canvas_documents_view.image.2.alt",
			style:
				"width: 100%; height: 200px; object-fit: cover; object-position: top; border-radius: 8px;",
			breaks: 1,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_documents_view.body.4" }],
			breaks: 0,
		},
	],
	canvas_files_view: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_files_view.body.1" }],
			breaks: 0,
		},
	],
	canvas_variables_view: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_variables_view.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.canvas_variables_view.body.2" }],
			breaks: 1,
		},
		{
			kind: "image",
			src: tourCanvasVariablesImage,
			altKey: "ui.onboarding.tour.canvas_variables_view.image.1.alt",
			style:
				"width: 100%; height: 350px; object-fit: contain; border-radius: 8px;",
			breaks: 0,
		},
	],
	agent_options: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_options.body.1" }],
			breaks: 0,
		},
	],
	click_view_settings_from_chat: [
		{
			kind: "paragraph",
			runs: [
				{ key: "ui.onboarding.tour.click_view_settings_from_chat.body.1" },
			],
			breaks: 0,
		},
	],
	view_agent_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.view_agent_settings.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.view_agent_settings.body.2" }],
			breaks: 0,
		},
	],
	select_provider: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.select_provider.body.1" }],
			breaks: 0,
		},
	],
	select_model: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.select_model.body.1" }],
			breaks: 0,
		},
	],
	modify_security_prompt: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.modify_security_prompt.body.1" }],
			breaks: 0,
		},
	],
	modify_agent_prompt: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.modify_agent_prompt.body.1" }],
			breaks: 0,
		},
	],
	create_new_agent: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_new_agent.body.1" }],
			breaks: 0,
		},
	],
	agent_naming_guidelines: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_naming_guidelines.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_naming_guidelines.body.2" }],
			breaks: 0,
		},
	],
	navigate_agent_hub: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.navigate_agent_hub.body.1" }],
			breaks: 0,
		},
	],
	agent_hub_view: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.agent_hub_view.body.1" }],
			breaks: 0,
		},
	],
	download_agent: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.download_agent.body.1" }],
			breaks: 0,
		},
	],
	upload_agent_hub: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.upload_agent_hub.body.1" }],
			breaks: 0,
		},
	],
	upload_agent_hub_dialog: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.upload_agent_hub_dialog.body.1" }],
			breaks: 0,
		},
	],
	navigate_schedules: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.navigate_schedules.body.1" }],
			breaks: 0,
		},
	],
	schedules_overview: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.schedules_overview.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.schedules_overview.body.2" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.schedules_overview.body.3" }],
			breaks: 0,
		},
	],
	create_schedule: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_schedule.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_schedule.body.2" }],
			breaks: 0,
		},
	],
	create_schedule_dialog: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_schedule_dialog.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_schedule_dialog.body.2" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.create_schedule_dialog.body.3" }],
			breaks: 0,
		},
	],
	navigate_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.navigate_settings.body.1" }],
			breaks: 0,
		},
	],
	general_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.general_settings.body.1" }],
			breaks: 0,
		},
	],
	appearance_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.appearance_settings.body.1" }],
			breaks: 0,
		},
	],
	radient_account_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.radient_account_settings.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.radient_account_settings.body.2" }],
			breaks: 0,
		},
	],
	integrations_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.integrations_settings.body.1" }],
			breaks: 2,
		},
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.integrations_settings.body.2" }],
			breaks: 0,
		},
	],
	application_updates_settings: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.application_updates_settings.body.1" }],
			breaks: 0,
		},
	],
	tour_complete: [
		{
			kind: "paragraph",
			runs: [{ key: "ui.onboarding.tour.tour_complete.body.1" }],
			breaks: 0,
		},
	],
} as const satisfies Record<string, readonly TourBlock[]>;
