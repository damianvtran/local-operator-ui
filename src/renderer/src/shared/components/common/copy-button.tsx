import { showErrorToast } from "@shared/utils/toast-manager";
import { Check, Copy } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Button } from "../ui";

/**
 * A copy button that says "Copied" for two seconds, then goes back.
 *
 * Shared (moved out of the provider panel unchanged) because the Phone access
 * block copies an address the same way, and a second clipboard implementation
 * beside this one would drift on the failure toast.
 */
export const CopyButton: FC<{
	value: string;
	label: string;
	variant?: "ghost" | "secondary" | "primary";
	onCopied?: () => void;
}> = ({ value, label, variant = "ghost", onCopied }) => {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return undefined;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			variant={variant}
			size="sm"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					onCopied?.();
				} catch {
					showErrorToast("Could not copy. Select and copy it manually.");
				}
			}}
		>
			{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			{copied ? "Copied" : label}
		</Button>
	);
};
