import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useCanvasPane } from "../utils/canvas-pane";
import {
	barePath,
	classifyImageSource,
	hasImageActions,
} from "../utils/image-actions";
import { openLocalTarget } from "../utils/link-open";
import { ImageActionsMenu } from "./image-actions-menu";

/**
 * A markdown image (`![alt](src)`), with the same hover actions as every other
 * picture in a conversation.
 *
 * WHY A COMPONENT RATHER THAN THE LIBRARY'S OWN `<img>`: the operator's ask is
 * that hovering an image offers its actions, and markdown images were the one
 * surface react-markdown owned outright — `MARKDOWN_COMPONENTS` has no `img`
 * entry, so an agent that wrote `![shot](/tmp/a.png)` produced a bare `<img>`
 * with no way to open, copy or reveal what it names (the sibling gap the
 * linkifier closed for paths in prose).
 *
 * ADMISSION IS THE CLASSIFIER'S, and the refused shape is the reason it is
 * strict: `classifyImageSource("shot.png")` is `other` — a relative `src`
 * resolves against the PAGE's own origin, which names no file this app can act
 * on — and such an image renders exactly as it did before this component
 * existed: a plain `<img>`, no wrapper, no trigger. Only the shapes the file
 * bridge, the OS doors or the canvas can actually address (`/…`, `~…`,
 * `file://`, `data:`, `blob:`, `http(s):`) get the menu, and the menu itself
 * offers each of them only the actions its bytes allow (`image-actions.ts`).
 *
 * THE CANVAS ACTION rides the pane provider, the same one the link toolbar
 * uses: `useCanvasPane()` is `null` outside the transcript's row list (the
 * trace rows, the run panel's child reader, Storybook), and there the entry is
 * simply absent rather than promising a pane that cannot be reached. Only a
 * PATH is offered to it: the pane handle is path-shaped (`openPathInCanvas`),
 * and a `data:` image has no path for it to open — the canvas branch that
 * accepts a data URI lives on the attachment surfaces, which carry the
 * conversation id this component deliberately cannot read (the provider
 * publishes the opener, not the id — `canvas-pane.tsx`'s own rule).
 *
 * THE WRAPPER'S GROUP IS NAMED (`group/mdimg`), not the anonymous `group` the
 * attachment frame uses: markdown renders inside transcript rows that may
 * themselves carry a `group`, and an anonymous token would let an outer row's
 * hover reveal this menu. The named group is the pattern `attachment-frame.tsx`
 * established for exactly this reason (`group/tile`), and the reveal tokens are
 * otherwise the measured set from `image-attachment.tsx`'s wrapper: hidden from
 * the pointer and the painter at rest, back on hover or keyboard focus, and kept
 * while the menu is open (the `has-[[aria-expanded=true]]` pair).
 */
export const MarkdownImage: FC<{
	src?: string;
	alt?: string;
	title?: string;
	className?: string;
}> = ({ src, alt, title, className }) => {
	useI18nLocale();
	const pane = useCanvasPane();
	const source = src ?? "";
	const kind = classifyImageSource(source);

	// A relative source, or an empty one: untouched, exactly as the library
	// rendered it before this component existed.
	if (kind === "other") {
		return <img src={src} alt={alt} title={title} className={className} />;
	}

	const canShowInCanvas = pane !== null && kind === "path";
	const showMenu = hasImageActions(kind, { canShowInCanvas, source });

	return (
		<span className={cn("group/mdimg relative inline-block max-w-full")}>
			<img src={src} alt={alt} title={title} className={className} />
			{showMenu && (
				<span
					// Named for the rigs and tests the way `data-fold-media` is: what is
					// asserted is the STATE (a markdown image with actions), not the
					// markup.
					data-markdown-image=""
					className={cn(
						"pointer-events-none absolute top-1 right-1 z-[2] opacity-0",
						"transition-opacity duration-fast ease-out-quart",
						"group-hover/mdimg:pointer-events-auto group-hover/mdimg:opacity-100",
						"group-focus-within/mdimg:pointer-events-auto group-focus-within/mdimg:opacity-100",
						"has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100",
					)}
				>
					<ImageActionsMenu
						file={source}
						src={src}
						label={alt}
						onShowInCanvas={
							canShowInCanvas && pane
								? () => {
										/*
										 * A refusal (no viewer for the type, probing says the file is gone,
										 * a read that failed) falls through to the OS door, the fallback
										 * `link-toolkit.tsx:339` established for the same press: answering
										 * that refusal with nothing would be the silent no-op the
										 * fallthrough exists to remove (agent review round 1, R1).
										 */
										void pane.openInCanvas(source).then((opened) => {
											if (!opened) void openLocalTarget(barePath(source));
										});
									}
								: undefined
						}
					/>
				</span>
			)}
		</span>
	);
};
