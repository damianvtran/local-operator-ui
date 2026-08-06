/**
 * A rendered keyboard shortcut, as key caps.
 *
 * `kbd` rather than styled spans: the element already means "key the user
 * presses", so the caps read correctly to a screen reader without any ARIA.
 *
 * Machine voice, so `text-mono-sm`. No border — `sunken` is recessed below
 * every other ground, and a cap that is already a different ground than the
 * thing behind it does not also need an edge drawn round it.
 */

import { cn } from "@shared/lib/utils";
import { Command, CornerDownLeft } from "lucide-react";
import { Fragment } from "react";
import type { ElementType, FC } from "react";

type KeyboardShortcutProps = {
	shortcut: string;
	size?: number;
};

const keyIconMap: Record<string, ElementType> = {
	"⌘": Command,
	cmd: Command,
	command: Command,
	enter: CornerDownLeft,
	"↵": CornerDownLeft,
};

const CAP =
	"inline-flex min-w-5 items-center justify-center rounded-xs bg-sunken font-mono text-mono-sm text-ink-muted";

export const KeyboardShortcut: FC<KeyboardShortcutProps> = ({
	shortcut,
	size = 10,
}) => {
	const keys = shortcut.split("+").map((key) => key.trim());

	return (
		<span className="inline-flex items-center gap-1">
			{keys.map((key, index) => {
				const Icon = keyIconMap[key.toLowerCase()];
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: the same key legitimately repeats in one shortcut ("Meta+Meta" exists in bindings), so position is part of the identity; the shortcut string is a stable prop, never reordered in place.
					<Fragment key={`${key}-${index}`}>
						{index > 0 && (
							<span aria-hidden="true" className="text-mono-sm text-ink-dim">
								+
							</span>
						)}
						<kbd className={cn(CAP, Icon ? "p-0.5" : "px-1.5 py-0.5")}>
							{Icon ? (
								<>
									<Icon size={size} aria-hidden="true" />
									<span className="sr-only">{key}</span>
								</>
							) : (
								key
							)}
						</kbd>
					</Fragment>
				);
			})}
		</span>
	);
};
