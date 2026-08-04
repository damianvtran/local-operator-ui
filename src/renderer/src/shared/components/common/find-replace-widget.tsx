import { Button, Input, Separator, Tooltip } from "@shared/components/ui";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { cn } from "@shared/lib/utils";
import { ChevronLeft, ChevronRight, Replace, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";

type FindReplaceWidgetProps = {
	onFind: (query: string) => void;
	onNavigate: (direction: "next" | "prev") => void;
	onReplace: (replaceText: string) => Promise<void>;
	onReplaceAll: (findText: string, replaceText: string) => void;
	onClose: () => void;
	show: boolean;
	initialMode?: "find" | "replace";
	matchCount: number;
	currentMatch: number;
	/**
	 * Positioning overrides for the widget container. The one caller uses this
	 * to move the widget down from the editor's own toolbar, which is layout
	 * the caller knows about and the widget does not.
	 *
	 * Renamed from `containerSx` because the value is classes now, not an MUI
	 * `SxProps`. That is the only public prop in this file that changed, and it
	 * is changed because its type could not survive de-MUI-ification.
	 */
	containerClassName?: string;
	findValue: string;
	onFindValueChange: (value: string) => void;
};

/**
 * The find/replace control that floats over a text editor.
 *
 * It leaves the flow — it is `absolute`, over the document — so it takes the
 * one shadow in the system. The old version was `theme.palette.background.default`
 * (canvas) with a 1px `divider` border; on `elevated` the border loses no
 * information, so it is gone and the widget reads as the thing on top rather
 * than as a card drawn with an outline.
 *
 * The match count is machine voice: `"3 of 12"` is a counter, not prose, so it
 * is `text-mono-sm`, which is what lets it sit inside the widget without a
 * second background behind it. The previous hairline dividers between the count
 * and the buttons carried no information either — the count and the buttons
 * are already different roles — and are removed.
 */
export const FindReplaceWidget: FC<FindReplaceWidgetProps> = ({
	onFind,
	onNavigate,
	onReplace,
	onReplaceAll,
	onClose,
	show,
	initialMode = "find",
	matchCount,
	currentMatch,
	containerClassName,
	findValue,
	onFindValueChange,
}) => {
	const [mode, setMode] = useState(initialMode);
	const [replaceValue, setReplaceValue] = useState("");

	const findInputRef = useRef<HTMLInputElement>(null);
	const replaceInputRef = useRef<HTMLInputElement>(null);

	const debouncedFindValue = useDebouncedValue(findValue, 300);

	useEffect(() => {
		if (show) {
			if (mode === "find") {
				findInputRef.current?.focus();
			} else {
				replaceInputRef.current?.focus();
			}
		}
	}, [show, mode]);

	useEffect(() => {
		onFind(debouncedFindValue);
	}, [debouncedFindValue, onFind]);

	const handleFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (matchCount > 0) {
				onNavigate("next");
			}
		}
		if (e.key === "Escape") {
			onClose();
		}
	};

	const handleReplaceKeyDown = async (
		e: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (e.metaKey || e.ctrlKey) {
				onReplaceAll(findValue, replaceValue);
			} else {
				await onReplace(replaceValue);
				replaceInputRef.current?.focus({ preventScroll: true });
			}
		}
		if (e.key === "Escape") {
			onClose();
		}
	};

	if (!show) {
		return null;
	}

	return (
		<div
			className={cn(
				"absolute top-1 right-1 z-10 flex items-center gap-1 rounded-md bg-elevated p-1 shadow-overlay",
				containerClassName,
			)}
		>
			<Tooltip
				content={mode === "find" ? "Switch to replace" : "Switch to find"}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => setMode(mode === "find" ? "replace" : "find")}
					aria-label={mode === "find" ? "Switch to replace" : "Switch to find"}
				>
					<ChevronLeft size={16} aria-hidden="true" />
				</Button>
			</Tooltip>

			<div className="flex flex-col gap-1">
				<Input
					inputSize="sm"
					ref={findInputRef}
					placeholder="Find"
					value={findValue}
					onChange={(e) => onFindValueChange(e.target.value)}
					onKeyDown={handleFindKeyDown}
					className="w-44"
				/>
				{mode === "replace" && (
					<Input
						inputSize="sm"
						ref={replaceInputRef}
						placeholder="Replace"
						value={replaceValue}
						onChange={(e) => setReplaceValue(e.target.value)}
						onKeyDown={handleReplaceKeyDown}
						className="w-44"
					/>
				)}
			</div>

			<span className="min-w-14 px-2 text-center text-ink-dim text-mono-sm select-none">
				{matchCount > 0 ? `${currentMatch} of ${matchCount}` : "No results"}
			</span>

			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => onNavigate("prev")}
				aria-label="Previous match"
			>
				<ChevronLeft size={16} aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={() => onNavigate("next")}
				aria-label="Next match"
			>
				<ChevronRight size={16} aria-hidden="true" />
			</Button>

			{mode === "replace" && (
				<>
					<Separator orientation="vertical" className="h-5" />
					<Tooltip content="Replace (Enter)">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={async () => {
								await onReplace(replaceValue);
								replaceInputRef.current?.focus({ preventScroll: true });
							}}
							aria-label="Replace"
						>
							<Replace size={16} aria-hidden="true" />
						</Button>
					</Tooltip>
					<Tooltip content="Replace all (Cmd/Ctrl+Enter)">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => onReplaceAll(findValue, replaceValue)}
							aria-label="Replace all"
							className="text-body-sm"
						>
							All
						</Button>
					</Tooltip>
				</>
			)}

			<Separator orientation="vertical" className="h-5" />
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onClose}
				aria-label="Close"
			>
				<X size={16} aria-hidden="true" />
			</Button>
		</div>
	);
};
