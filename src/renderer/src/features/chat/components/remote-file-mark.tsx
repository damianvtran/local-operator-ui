import { t } from "@shared/i18n";
import { MonitorSmartphone } from "lucide-react";

/**
 * The small, non-intrusive "this lives on another device" mark beside a remote
 * row's name (operator: "maybe just with a small non-intrusive indication").
 *
 * A 12px device glyph in `ink-dim`, the quietest ink a row already uses for
 * its folder and size, so it never competes with the name. Named for screen
 * readers and the pointer ("On <device>") because a glyph alone says nothing.
 * Token-only and deliberately minimal: the design round owns its final form.
 */
export const RemoteFileMark = ({ device }: { device: string }) => {
	const label = t("ui.canvas.files.remoteOn", { device });
	return (
		<span
			className="inline-flex shrink-0 items-center text-ink-dim"
			title={label}
			role="img"
			aria-label={label}
			data-remote-file-mark=""
		>
			<MonitorSmartphone className="size-3" aria-hidden="true" />
		</span>
	);
};
