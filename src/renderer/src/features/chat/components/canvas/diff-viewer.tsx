import { Box, styled, alpha } from "@mui/material";
import { diffLines } from "diff";
import type { FC } from "react";
import { useMemo } from "react";

type DiffViewerProps = {
	oldCode: string;
	newCode: string;
};

const DiffContainer = styled(Box)(({ theme }) => ({
	fontFamily: "monospace",
	whiteSpace: "pre-wrap",
	fontSize: "0.875rem",
	borderRadius: theme.shape.borderRadius,
	padding: theme.spacing(1),
	maxHeight: "300px",
	overflowY: "auto",
	backgroundColor: theme.palette.background.default,
}));

const DiffLine = styled("div")<{ type: "added" | "removed" | "neutral" }>(({ theme, type }) => ({
	padding: "2px 4px",
	...(type === "added" && {
		backgroundColor: alpha(theme.palette.success.main, 0.2),
	}),
	...(type === "removed" && {
		backgroundColor: alpha(theme.palette.error.main, 0.2),
	}),
}));

const NoChanges = styled(Box)(({ theme }) => ({
	padding: theme.spacing(2),
	textAlign: "center",
	color: theme.palette.text.secondary,
}));

export const DiffViewer: FC<DiffViewerProps> = ({ oldCode, newCode }) => {
	const changes = useMemo(() => diffLines(oldCode, newCode), [oldCode, newCode]);
	const hasChanges = useMemo(
		() => changes.some((part) => part.added || part.removed),
		[changes],
	);

	if (!hasChanges) {
		return <NoChanges>No changes detected.</NoChanges>;
	}

	return (
		<DiffContainer>
			{changes.map((part, index) => {
				const type = part.added ? "added" : part.removed ? "removed" : "neutral";
				return (
          // biome-ignore lint/suspicious/noArrayIndexKey: The list is static and won't be reordered
					<DiffLine key={index} type={type}>
						{part.value}
					</DiffLine>
				);
			})}
		</DiffContainer>
	);
};
