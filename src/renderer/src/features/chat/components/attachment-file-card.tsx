/**
 * One attached file, as both the composer and the transcript draw it.
 *
 * WHY THE TWO SEATS SHARE THIS. A file the user is about to send and a file they
 * sent a week ago are the same object described the same way - a type, a name, a
 * size - and two copies of the type/size vocabulary is how the pending card and
 * the history card come to disagree about what a `.md` is called. The differences
 * that DO exist (a remove affordance, a path line, an existence claim) stay in the
 * two wrappers; everything a reader parses at a glance lives here.
 */

import { t } from "@shared/i18n";
import { formatByteSize } from "@shared/lib/format-bytes";
import {
	File,
	FileArchive,
	FileAudio,
	FileCode,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileVideo,
} from "lucide-react";
import type { FC } from "react";
import { extensionOf } from "../utils/file-kind";

/**
 * The short type label a file card prints before its size (`PDF · 2.4 MB`).
 *
 * The EXTENSION is the reader's own word for the file - a person calls it "a
 * PDF", not "an application/pdf" - except where the extension is unfamiliar or
 * absent, where the MIME subtype is the only honest answer. Never the whole
 * vendor MIME string: that is the machine's word, and this line is read at a
 * glance.
 */
export function attachmentTypeLabel(name: string, mimeType?: string): string {
	const extension = extensionOf(name);
	if (extension) {
		if (extension === "jpeg" || extension === "jpg") return "JPEG";
		return extension.toUpperCase().slice(0, 4);
	}
	const subtype = mimeType?.split("/")[1]?.split(";")[0]?.trim();
	/*
	 * `text/plain` is the type an extension-less text file (`.env`, a dotfile)
	 * arrives as, and its four-letter cut read `PLAI` (PR #1452 QA R4 n1). `TXT`
	 * is the name a person gives it; a machine token, so not translated.
	 */
	if (subtype === "plain") return "TXT";
	return subtype
		? subtype.toUpperCase().slice(0, 4)
		: t("ui.chat.attachments.file_type_unknown");
}
/** `PDF · 2.4 MB`, or the type alone while the size is not known yet. */
export function attachmentMetaLine(
	name: string,
	mimeType: string | undefined,
	bytes: number | null | undefined,
): string {
	const type = attachmentTypeLabel(name, mimeType);
	if (typeof bytes !== "number" || bytes <= 0) return type;
	const size = attachmentSizeLabel(bytes) ?? "";
	return t("ui.chat.attachments.file_meta", { type, size });
}

/**
 * An attachment's size as every attachment surface states it (`92 B`, `4 KB`).
 *
 * The shared formatter's floor is KB, because every other reader of it weighs
 * budgets and bundles. A composer card can hold a 45-byte PDF, which that floor
 * would print as "0 KB" - a size that contradicts the file it names - so the
 * sub-kilobyte rung is stated here rather than by widening a formatter whose
 * other callers would lose a digit. Exported so the canvas Attachments list
 * says the same size as the card beside it (PR #1452 UX R2 U14: `0 KB` next to
 * a card reading `92 B`). `null` when the size is not known.
 */
export function attachmentSizeLabel(
	bytes: number | null | undefined,
): string | null {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0)
		return null;
	return bytes < 1000 ? `${bytes} B` : formatByteSize(bytes);
}

const textExtensions = new Set([
	"md",
	"markdown",
	"txt",
	"csv",
	"json",
	"yaml",
	"yml",
	"toml",
	"log",
]);

const codeExtensions = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"py",
	"rs",
	"go",
	"java",
	"c",
	"h",
	"cpp",
	"sh",
	"html",
	"css",
]);

const sheetExtensions = new Set(["xls", "xlsx", "numbers", "ods"]);
const archiveExtensions = new Set(["zip", "tar", "gz", "tgz", "rar", "7z"]);

/**
 * The glyph for a file's kind.
 *
 * A type family rather than a colour: the card's ink is the theme's, and these
 * icons are `aria-hidden` because the type is also stated in words beside them.
 */
export const AttachmentKindIcon: FC<{
	name: string;
	mimeType?: string;
	className?: string;
}> = ({ name, mimeType, className }) => {
	const extension = extensionOf(name) ?? "";
	const mime = mimeType ?? "";
	if (mime.startsWith("image/"))
		return <FileImage className={className} aria-hidden="true" />;
	if (mime.startsWith("video/"))
		return <FileVideo className={className} aria-hidden="true" />;
	if (mime.startsWith("audio/"))
		return <FileAudio className={className} aria-hidden="true" />;
	if (mime === "application/pdf")
		return <FileText className={className} aria-hidden="true" />;
	if (sheetExtensions.has(extension) || mime.includes("spreadsheet"))
		return <FileSpreadsheet className={className} aria-hidden="true" />;
	if (archiveExtensions.has(extension) || mime.includes("zip"))
		return <FileArchive className={className} aria-hidden="true" />;
	if (codeExtensions.has(extension))
		return <FileCode className={className} aria-hidden="true" />;
	if (textExtensions.has(extension) || mime.startsWith("text/"))
		return <FileText className={className} aria-hidden="true" />;
	return <File className={className} aria-hidden="true" />;
};
