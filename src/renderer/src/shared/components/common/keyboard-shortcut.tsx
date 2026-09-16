/**
 * A rendered keyboard shortcut, as key caps.
 *
 * `kbd` rather than styled spans: the element already means "key the user
 * presses", so the caps read correctly to a screen reader without any ARIA.
 *
 * Machine voice, so `text-mono-sm`, and no edge OF ITS OWN: `sunken` is
 * recessed below every other ground, so a cap that is already a different ground
 * than the thing behind it does not need one drawn round it.
 *
 * WHERE THAT PREMISE FAILS, AND WHAT THE CALLER PASSES INSTEAD. The chat
 * sidebar's CURRENT row is painted `sunken` as well (`rowCurrent`), so on that
 * one row the cap's fill and its ground are the same role - measured 1.00:1 and
 * ΔE00 0.00 in all twelve palettes - and the caps read as plain monospace
 * glyphs at the one moment the chord they name has just been used. The New chat
 * row therefore passes `className` carrying a structural edge while it is
 * current: `outline-control`, 3.13-5.91:1 against that ground, clearing
 * `docs/branding.md` § 3's 3:1 structural floor in every palette. An OUTLINE
 * rather than a border, and that is not a detail: a border enters the box model
 * and would move the cap by 1px per side in one state only, while this row
 * retires `border-control` for exactly that shift. WHICH CAP GETS THE EDGE IS
 * THE CALLER'S DECISION, not this component's - every other cap in the app is
 * drawn on a ground this one is not.
 */

import { cn } from "@shared/lib/utils";
import { Command, CornerDownLeft } from "lucide-react";
import { Fragment } from "react";
import type { ElementType, FC } from "react";

type KeyboardShortcutProps = {
	shortcut: string;
	size?: number;
	/**
	 * Extra classes for the CAPS themselves, merged last so a caller can override
	 * their fill or add an edge. Exists for the one call site whose ground is the
	 * cap's own fill (see the note at the top of this file); a caller that passes
	 * nothing gets the caps this component has always drawn.
	 */
	className?: string;
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
	className,
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
						<kbd
							className={cn(CAP, Icon ? "p-0.5" : "px-1.5 py-0.5", className)}
						>
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
