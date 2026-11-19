/**
 * The Library's glyph vocabulary: one icon per preview kind.
 *
 * A kind icon is the card's whole picture when there is no thumbnail, so the
 * mapping is exhaustive over the backend's classifier and falls back to a
 * plain document rather than to nothing. The category rows reuse the same
 * component through a representative kind, which keeps one drawing of "this
 * is a slideshow" in the feature.
 */

import {
	Code,
	File as FileIcon,
	FileText,
	Image as ImageIcon,
	Music,
	Presentation,
	Sheet,
	Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DesktopLibraryKind } from "../../../../../shared/desktop-control-contract";

const KIND_ICONS: Record<DesktopLibraryKind, LucideIcon> = {
	image: ImageIcon,
	audio: Music,
	video: Video,
	pdf: FileText,
	pptx: Presentation,
	docx: FileText,
	markdown: FileText,
	html: Code,
	spreadsheet: Sheet,
	text: FileText,
	code: Code,
	other: FileIcon,
};

export function kindIcon(kind: string): LucideIcon {
	return KIND_ICONS[kind as DesktopLibraryKind] ?? FileIcon;
}

export function KindGlyph({
	kind,
	size = 20,
	className,
}: {
	kind: string;
	size?: number;
	className?: string;
}) {
	const Icon = kindIcon(kind);
	return <Icon size={size} aria-hidden="true" className={className} />;
}
