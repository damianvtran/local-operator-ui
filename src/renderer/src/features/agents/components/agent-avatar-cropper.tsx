/**
 * The square crop step of an agent's profile picture: drag to pan,
 * wheel/slider/buttons to zoom over 1-4x, recenter, and live previews at the
 * sizes the app actually draws the picture.
 *
 * PORTED, NOT INVENTED. The behaviour is the Radient console's account cropper
 * (`radient-ml/user-console/src/components/account/avatar-cropper.tsx`), which
 * the operator named as the editor to match: hand-rolled, no crop dependency,
 * a "cover" fit times a zoom multiplier with the offset clamped so the square is
 * never left with empty space. The maths lives in
 * `shared/agent-avatar/crop-geometry.ts` so it is asserted in Node; this file is
 * the canvases, the gestures and the copy.
 *
 * PREVIEWS ARE THE POINT. The three live previews draw the EXACT crop at the
 * header's, the sidebar row's and the roster's box sizes. A cropper that
 * previews at one size and ships another is how a face ends up cut in the one
 * place nobody checked - and the sidebar row's 16px is where that happens.
 *
 * KEYBOARD. The crop square is focusable: arrows pan, + / - zoom, 0 recenters.
 * The slider is the primary control for assistive tech and every button has a
 * name, so nothing here needs a pointer.
 *
 * OUTPUT. One 512x512 PNG (the contract's stored edge) - PNG so a transparent
 * logo stays transparent. Core re-normalises whatever it is sent and owns the
 * 1 MiB cap (it falls back to JPEG itself), so this step does not re-encode.
 */

import {
	AvatarCropper,
	type AvatarCropperProps,
} from "@shared/components/avatar-cropper";
import { AgentAvatar } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
export type { CropSource } from "@shared/components/avatar-cropper";
export { renderAvatarCrop as renderAgentAvatarCrop } from "@shared/components/avatar-cropper";
export const AGENT_AVATAR_PREVIEW_SIZES = [
	{ id: "header", px: 20 },
	{ id: "sidebar", px: 16 },
	{ id: "roster", px: 32 },
] as const;

type PreviewId = (typeof AGENT_AVATAR_PREVIEW_SIZES)[number]["id"];

/*
 * Each preview's name and caption, spelled out per key: the typed catalogue
 * rejects a computed key, and that check is what keeps a renamed preview from
 * shipping an untranslated label.
 */
const previewCopy: Record<
	PreviewId,
	{ label: () => string; caption: () => string }
> = {
	header: {
		label: () => t("ui.agents.avatar.editor.preview_header"),
		caption: () => t("ui.agents.avatar.editor.preview_header_caption"),
	},
	sidebar: {
		label: () => t("ui.agents.avatar.editor.preview_sidebar"),
		caption: () => t("ui.agents.avatar.editor.preview_sidebar_caption"),
	},
	roster: {
		label: () => t("ui.agents.avatar.editor.preview_roster"),
		caption: () => t("ui.agents.avatar.editor.preview_roster_caption"),
	},
};

export type AgentAvatarCropperProps = Omit<
	AvatarCropperProps,
	"copy" | "previewSizes" | "outputEdge" | "previewFrame"
>;
export function AgentAvatarCropper(props: AgentAvatarCropperProps) {
	useI18nLocale();
	return (
		<AvatarCropper
			{...props}
			previewFrame={(children, edge) => (
				<AgentAvatar style={{ width: edge, height: edge }}>
					{children}
				</AgentAvatar>
			)}
			previewSizes={AGENT_AVATAR_PREVIEW_SIZES.map((preview) => ({
				...preview,
				label: previewCopy[preview.id].label(),
				caption: previewCopy[preview.id].caption(),
			}))}
			copy={{
				cropArea: t("ui.agents.avatar.editor.crop_area"),
				instructions: (width, height) =>
					t("ui.agents.avatar.editor.instructions", {
						width: String(width),
						height: String(height),
					}),
				zoom: t("ui.agents.avatar.editor.zoom"),
				zoomOut: t("ui.agents.avatar.editor.zoom_out"),
				zoomIn: t("ui.agents.avatar.editor.zoom_in"),
				zoomValue: (value) =>
					t("ui.agents.avatar.editor.zoom_value", { value }),
				recenter: t("ui.agents.avatar.editor.recenter"),
				previews: t("ui.agents.avatar.editor.previews"),
				save: t("ui.agents.avatar.editor.save"),
				saving: t("ui.agents.avatar.editor.saving"),
				cancel: t("ui.common.actions.cancel"),
				errorEncode: t("ui.agents.avatar.editor.error_encode"),
			}}
		/>
	);
}
