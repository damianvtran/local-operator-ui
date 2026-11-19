import { t } from "@shared/i18n";
import { Monitor } from "lucide-react";

/**
 * The small, non-intrusive "this lives on another device" mark (operator:
 * "maybe just with a small non-intrusive indication").
 *
 * `Monitor` at `size-3 text-ink-dim`: the glyph the header's device chip
 * already draws, so one device reads one way across the app. The first cut's
 * `MonitorSmartphone` read as a chat bubble at 12 px and is the header's
 * "Move to device" action (design round 1, D1-1).
 *
 * Two forms. The bare glyph (a Library card, where local and remote cards mix)
 * is named for screen readers and the pointer, since a glyph alone says
 * nothing. `withLabel` writes "On <device>" beside it (the Files count line and
 * the Library detail), where the words are on screen and the glyph is decor.
 */
export const RemoteFileMark = ({
	device,
	withLabel = false,
}: {
	device: string;
	withLabel?: boolean;
}) => {
	const label = t("ui.canvas.files.remoteOn", { device });
	if (withLabel)
		return (
			<span
				className="inline-flex min-w-0 items-center gap-1 text-ink-muted text-meta"
				data-remote-file-mark=""
			>
				<Monitor className="size-3 shrink-0 text-ink-dim" aria-hidden="true" />
				<span className="min-w-0 truncate">{label}</span>
			</span>
		);
	return (
		<span
			className="inline-flex shrink-0 items-center text-ink-dim"
			title={label}
			role="img"
			aria-label={label}
			data-remote-file-mark=""
		>
			<Monitor className="size-3" aria-hidden="true" />
		</span>
	);
};
