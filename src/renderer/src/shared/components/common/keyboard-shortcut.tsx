import { Box, Typography, styled, useTheme } from "@mui/material";
import { Command, CornerDownLeft } from "lucide-react";
import type { FC, ElementType } from "react";

type KeyboardShortcutProps = {
	shortcut: string;
	size?: number;
};

const Key = styled(Box)(({ theme }) => ({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(0.25, 0.75),
	border: `1px solid ${theme.palette.divider}`,
	borderRadius: theme.shape.borderRadius,
	backgroundColor: theme.palette.background.default,
	color: theme.palette.text.secondary,
	fontSize: "0.75rem",
	fontWeight: 500,
	lineHeight: "1.2",
	minWidth: "20px",
	textAlign: "center",
}));

const ShortcutContainer = styled(Box)({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
});

const keyIconMap: Record<string, ElementType> = {
	"⌘": Command,
	cmd: Command,
	command: Command,
	enter: CornerDownLeft,
	"↵": CornerDownLeft,
};

export const KeyboardShortcut: FC<KeyboardShortcutProps> = ({
	shortcut,
	size = 10,
}) => {
	const theme = useTheme();
	const keys = shortcut.split("+").map((key) => key.trim());

	return (
		<ShortcutContainer>
			{keys.map((key, index) => {
				const Icon = keyIconMap[key.toLowerCase()];
				return (
					<>
						{index > 0 && (
							<Typography
								variant="caption"
								sx={{
									fontSize: "0.5rem",
									color: theme.palette.text.secondary,
								}}
							>
								+
							</Typography>
						)}
						{Icon ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: Using index as key is fine here
							<Key key={`${key}-${index}`} sx={{ p: "2px" }}>
								<Icon size={size} />
							</Key>
						) : (
							// biome-ignore lint/suspicious/noArrayIndexKey: Using index as key is fine here
							<Key key={`${key}-${index}`}>
								<Typography
									variant="caption"
									sx={{
										fontSize: "0.6rem",
										lineHeight: 1,
										color: theme.palette.text.secondary,
									}}
								>
									{key}
								</Typography>
							</Key>
						)}
					</>
				);
			})}
		</ShortcutContainer>
	);
};
