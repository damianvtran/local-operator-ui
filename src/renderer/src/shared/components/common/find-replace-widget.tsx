import { Box, IconButton, InputBase, Paper, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { styled } from "@mui/material/styles";
import { ChevronLeft, ChevronRight, X, Replace } from "lucide-react";
import type { FC } from "react";
import { useState, useEffect, useRef } from "react";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";

const WidgetContainer = styled(Paper)(({ theme }) => ({
	position: "absolute",
	top: "4px",
	right: "4px",
	zIndex: 10,
	padding: "4px",
	display: "flex",
	alignItems: "center",
	borderRadius: theme.shape.borderRadius * 1.5,
	backgroundColor: theme.palette.background.default,
	boxShadow: theme.shadows[3],
	border: `1px solid ${theme.palette.divider}`,
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
	fontSize: "0.8rem",
	padding: "2px 8px",
	width: "180px",
	backgroundColor: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius,
	border: `1px solid ${theme.palette.divider}`,
	"&.Mui-focused": {
		borderColor: theme.palette.primary.main,
	},
}));

const ActionButton = styled(IconButton)(({ theme }) => ({
	width: "24px",
	height: "24px",
	padding: "2px",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const MatchCount = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
	padding: "0 8px",
	userSelect: "none",
}));

const Divider = styled("div")(({ theme }) => ({
	width: "1px",
	height: "20px",
	backgroundColor: theme.palette.divider,
	margin: "0 4px",
}));

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
	containerSx?: SxProps<Theme>;
	findValue: string;
	onFindValueChange: (value: string) => void;
};

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
	containerSx,
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

	const handleReplaceKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
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
		<WidgetContainer sx={containerSx}>
			<Tooltip title={mode === "find" ? "Switch to Replace" : "Switch to Find"}>
				<ActionButton onClick={() => setMode(mode === "find" ? "replace" : "find")}>
					<ChevronLeft size={16} />
				</ActionButton>
			</Tooltip>
			<Box display="flex" flexDirection="column" gap="4px">
				<StyledInputBase
					inputRef={findInputRef}
					placeholder="Find"
					value={findValue}
					onChange={(e) => onFindValueChange(e.target.value)}
					onKeyDown={handleFindKeyDown}
				/>
				{mode === "replace" && (
					<StyledInputBase
						inputRef={replaceInputRef}
						placeholder="Replace"
						value={replaceValue}
						onChange={(e) => setReplaceValue(e.target.value)}
						onKeyDown={handleReplaceKeyDown}
					/>
				)}
			</Box>
			<Divider />
			<MatchCount>
				{matchCount > 0 ? `${currentMatch} of ${matchCount}` : "No results"}
			</MatchCount>
			<ActionButton onClick={() => onNavigate("prev")}>
				<ChevronLeft size={16} />
			</ActionButton>
			<ActionButton onClick={() => onNavigate("next")}>
				<ChevronRight size={16} />
			</ActionButton>
			{mode === "replace" && (
				<>
					<Divider />
					<Tooltip title="Replace (Enter)">
						<ActionButton
							onClick={async () => {
								await onReplace(replaceValue);
								replaceInputRef.current?.focus({ preventScroll: true });
							}}
						>
							<Replace size={16} />
						</ActionButton>
					</Tooltip>
					<Tooltip title="Replace All (Cmd/Ctrl+Enter)">
						<ActionButton onClick={() => onReplaceAll(findValue, replaceValue)}>
							<Box sx={{ fontSize: '0.7rem', fontWeight: 'bold' }}>All</Box>
						</ActionButton>
					</Tooltip>
				</>
			)}
			<Divider />
			<ActionButton onClick={onClose}>
				<X size={16} />
			</ActionButton>
		</WidgetContainer>
	);
};
