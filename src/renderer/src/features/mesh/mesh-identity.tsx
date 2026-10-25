import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { compactDeviceId, deviceDisplayName } from "./mesh-types";

/**
 * A member's unauthenticated name and authenticated id, always painted together.
 *
 * The name is quoted (or is the distinct unnamed-device phrase) so a stored name
 * cannot impersonate the absent-name state. Space-constrained surfaces use the
 * stable compact id here rather than dropping the id or inventing a second label.
 */
export const MeshDeviceIdentity: FC<{
	deviceId: string;
	name?: string;
	compact?: boolean;
	className?: string;
}> = ({ deviceId, name, compact = false, className }) => {
	useI18nLocale();
	return (
		<span
			className={cn("flex min-w-0 items-baseline gap-2", className)}
			data-mesh-device-identity={deviceId}
		>
			<span
				className="min-w-0 flex-1 truncate text-start"
				data-mesh-device-name=""
			>
				{deviceDisplayName({ name })}
			</span>
			<span
				className="shrink-0 font-mono text-meta text-ink-muted"
				data-mesh-device-id=""
				title={deviceId}
			>
				{compact ? compactDeviceId(deviceId) : deviceId}
			</span>
		</span>
	);
};
