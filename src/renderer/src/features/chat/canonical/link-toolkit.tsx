/**
 * The toolbar a link raises on the canonical transcript: Copy, Open, Open folder,
 * and Quote when the reader has highlighted the link.
 *
 * ONE OBJECT, TWO TOOLBARS, ONE LOOK. The shell is deliberately the same one the
 * turn's Quote control wears - the same `bg-elevated` ground, `border-hairline`
 * edge, `rounded-md` radius, `h-8` height, `px-1` padding, the same
 * `QUOTE_TOOLKIT_ATTR` and the same 8px clearance from what it acts on - because
 * two floating toolbars that look different is a defect rather than a style
 * choice, and because both are the same affordance: a small group that says what
 * can be done to the thing under the reader's hand.
 *
 * WHAT IT IS ABOUT, AND WHY IT KNOWS. The subject is the ANCHOR ELEMENT, handed
 * in by the row (`use-link-subject.ts`), which is what makes "one toolbar at a
 * time" a property of the row's state rather than of five links agreeing with
 * each other. The target and its kind are then read off that element's own
 * attributes, which is also what keeps the rendered text and the acted-on text
 * the same string: what the reader sees underlined is what Copy copies.
 *
 * IT IS PLACED BY THE SAME FUNCTION AS THE QUOTE CONTROL, against the link's own
 * boxes rather than the highlight's, through the same hook. That is why the
 * toolbar sits 8px above the link it belongs to - immediately, unmistakably
 * attached to one target rather than to the row - and it is the reason a link
 * whose first line has scrolled off screen takes its toolbar away with it
 * (`placeQuoteControl` answers `null` there, and `visibility: hidden` is what the
 * shell does with that answer).
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not offer Open or Open folder for a
 * path that is not there, and it says so instead (`link-actions.ts`'s matrix): a
 * press that silently does nothing is the failure the whole matrix exists to
 * remove. It does not mount at all when the subject is not a target this app
 * opens, and it does not mount for a target the classifier called `other`, so a
 * `mailto:` link keeps exactly the behaviour it had.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Check,
	ClipboardCopy,
	ExternalLink,
	File as FileIcon,
	FolderOpen,
	Quote,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	type LinkActionId,
	type LinkKind,
	type ProbedTarget,
	linkToolbarModel,
	probeStateFor,
	probeTarget,
} from "../utils/link-actions";
import { copyTarget, openTarget, revealLocalTarget } from "../utils/link-open";
import { QUOTE_TOOLKIT_ATTR } from "./quote-model";
import { useFloatingControl } from "./use-floating-control";
import { LINK_TOOLBAR_ATTR } from "./use-link-subject";
import { useQuotePress } from "./use-quote-press";

type LinkToolkitProps = {
	/** The conversation the staged quote is filed under; see `quote-toolkit.tsx`. */
	conversationId: string;
	/** The turn element this link lives in: the frame the toolbar is placed in. */
	turnRef: { readonly current: HTMLElement | null };
	/** The link the toolbar is about. Its identity, not an href. */
	subject: Element;
	/** The reader's highlight lies wholly inside `subject`. */
	quoteAvailable: boolean;
	/** Clear the row's subject, for Escape. */
	onDismiss: () => void;
};

export const LinkToolkit: FC<LinkToolkitProps> = ({
	conversationId,
	turnRef,
	subject,
	quoteAvailable,
	onDismiss,
}) => {
	const target = subject.getAttribute("data-lo-target") ?? "";
	const kind = (subject.getAttribute("data-lo-kind") ?? "file") as LinkKind;
	const handleQuote = useQuotePress(conversationId, turnRef);
	const [copied, setCopied] = useState(false);
	/*
	 * The probe's answer, or `null` while nothing is known. Seeded from the cache
	 * so a second hover on the same link paints the right matrix on its first
	 * frame instead of flashing the optimistic one.
	 */
	const [probe, setProbe] = useState<ProbedTarget>(
		() => probeStateFor(target) ?? null,
	);
	const { controlRef, placement } = useFloatingControl({
		turnRef,
		visible: true,
		// The link's own boxes: one per line when the link wraps, in document
		// order, which is exactly what the placement takes.
		lines: () => {
			const rects = subject.getClientRects();
			return Array.from(rects, (rect) => ({
				top: rect.top,
				left: rect.left,
				right: rect.right,
				bottom: rect.bottom,
			}));
		},
	});

	/*
	 * LIVENESS IS LEARNED ON REVEAL, ONCE PER PATH PER SESSION.
	 *
	 * The row re-renders per delta while a turn streams, so probing per row would
	 * be a stat storm, and `probe-files` caps its batch at 64 paths. The cache is
	 * `link-actions.ts`'s, keyed by the spelling the transcript wrote; this effect
	 * only asks when nothing is cached, and writes the answer into the cache so
	 * the next reveal is free.
	 *
	 * No probe bridge at all (Storybook, browser development) leaves the state
	 * `null`, which the model reads as "offer everything": with no way to stat,
	 * disabling Open would be the app guessing that a path the reader can see
	 * does not exist.
	 */
	useEffect(() => {
		const known = probeStateFor(target);
		setProbe(known ?? null);
		setCopied(false);
		if (known !== undefined) return;
		let live = true;
		void probeTarget(target, window.api?.probeFiles).then(() => {
			if (live) setProbe(probeStateFor(target) ?? null);
		});
		return () => {
			live = false;
		};
	}, [target]);

	const model = linkToolbarModel({
		kind,
		target,
		probe,
		quotable: quoteAvailable,
	});
	/*
	 * Nothing to offer means nothing on screen. `linkToolbarModel` answers `null`
	 * for a target this app does not open, and the row's own subject rule means
	 * this component is usually not mounted at all; the guard covers the case
	 * where the two disagree rather than trusting them to.
	 */
	if (!model || !target) return null;

	const handleCopy = async () => {
		if (await copyTarget(target)) setCopied(true);
	};

	const handleOpen = async () => {
		const opened = await openTarget(kind, target);
		/*
		 * A press that failed is the one thing that can make the cached answer
		 * wrong - the file was deleted between the probe and the press, or it
		 * appeared after a probe said it was missing - so the cache is dropped and
		 * the matrix is re-derived on the next reveal rather than repeating it.
		 */
		if (!opened && kind === "file") setProbe(null);
	};

	const handleOpenFolder = async () => {
		if (!(await revealLocalTarget(target))) setProbe(null);
	};

	/*
	 * One icon and one press per action id, chosen by the id the MODEL published
	 * rather than by a second list of buttons here: the matrix decides what is
	 * offered (and whether Open folder is offered at all), and this file decides
	 * only what each offer looks like. A hard-coded button list here would be a
	 * second place that has to agree with the matrix, which is the shape of defect
	 * § 9 is about one level up.
	 */
	const icons: Record<LinkActionId, React.ReactNode> = {
		quote: <Quote />,
		copy: copied ? <Check /> : <ClipboardCopy />,
		open: kind === "url" ? <ExternalLink /> : <FileIcon />,
		"open-folder": <FolderOpen />,
	};
	const presses: Record<LinkActionId, () => void> = {
		quote: handleQuote,
		copy: () => {
			void handleCopy();
		},
		open: () => {
			void handleOpen();
		},
		"open-folder": () => {
			void handleOpenFolder();
		},
	};

	return (
		<div
			{...{ [QUOTE_TOOLKIT_ATTR]: "", [LINK_TOOLBAR_ATTR]: "" }}
			ref={controlRef}
			role="toolbar"
			aria-label={model.label}
			className={cn(
				"absolute z-10 flex h-8 items-center gap-0.5 rounded-md border border-hairline bg-elevated px-1",
				!placement && "invisible",
			)}
			style={
				placement ? { top: placement.top, left: placement.left } : undefined
			}
			/*
			 * The press must not collapse a highlight the toolbar is about to quote,
			 * and must not move focus off the reader's highlight before `click` runs
			 * - the same two reasons the quote control cancels `mousedown`.
			 */
			onMouseDown={(event) => event.preventDefault()}
			/*
			 * ESCAPE HIDES THE TOOLBAR AND HANDS FOCUS BACK to the link it was about,
			 * which is the keyboard reader's only way out once Tab has walked into
			 * the buttons: without the hand-back, Escape would drop them at the top
			 * of the document. An Escape something else has already answered is not
			 * this control's to answer as well (`defaultPrevented`), and the app has
			 * its own Escape.
			 */
			onKeyDown={(event) => {
				if (event.key !== "Escape" || event.defaultPrevented) return;
				/*
				 * THE HIGHLIGHT GOES FIRST when one is what raised this toolbar, because
				 * clearing only the row's subject would leave the reader looking at a
				 * toolbar that comes straight back: the subject is recomputed from the
				 * live highlight, and a highlight inside this link IS the subject. This
				 * is the same thing the turn's Quote control does on Escape, and the
				 * operator's ask - that the strip goes away "instead of sticking
				 * around" - is what it is for.
				 */
				window.getSelection()?.removeAllRanges();
				const anchor = subject as HTMLElement;
				onDismiss();
				anchor.focus?.();
			}}
		>
			{model.actions.map((action) => (
				<Tooltip
					key={action.id}
					/*
					 * "Copied" is the press's own answer, and it replaces the label rather
					 * than sitting beside it: the transcript's Copy control does the same,
					 * and a pressed control that looks identical to an unpressed one is how
					 * a reader presses it twice.
					 */
					content={action.id === "copy" && copied ? "Copied" : action.label}
					side={placement?.placement === "below" ? "bottom" : "top"}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={
							action.id === "copy" && copied ? "Copied" : action.label
						}
						className="text-ink-dim hover:bg-accent-wash hover:text-accent"
						onClick={presses[action.id]}
					>
						{icons[action.id]}
					</Button>
				</Tooltip>
			))}
			{/*
			 * The reason, when there is one, in the strip rather than behind a
			 * disabled button: the reader is told the path names nothing on screen,
			 * where a disabled control only says "not for you". Truncated to keep
			 * the strip a strip, with the whole sentence as the accessible name and
			 * the tooltip so nothing is lost.
			 */}
			{model.note && (
				<span
					className="max-w-56 truncate pl-1 text-ink-dim text-meta"
					title={model.note}
				>
					{model.note}
				</span>
			)}
		</div>
	);
};
