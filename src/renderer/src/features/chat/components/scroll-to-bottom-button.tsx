import { faArrowDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Fade, IconButton, styled } from "@mui/material";
import { useCallback } from "react";
import type { FC } from "react";
/**
 * Props for the ScrollToBottomButton component
 */
type ScrollToBottomButtonProps = {
	/**
	 * Whether the button should be visible
	 */
	visible: boolean;

	/**
	 * Whether chat utilities panel is expanded
	 */
	isChatUtilitiesExpanded: boolean;

	/**
	 * Callback function to scroll to the bottom
	 */
	onClick: () => void;

	/**
	 * Optional className for additional styling
	 */
	className?: string;
};

const ButtonContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isChatUtilitiesExpanded",
})<Pick<ScrollToBottomButtonProps, "isChatUtilitiesExpanded">>(
	({ isChatUtilitiesExpanded }) => ({
		position: "absolute",
		bottom: isChatUtilitiesExpanded ? 260 : 200,
		zIndex: 1000,
		display: "flex",
		justifyContent: "center",
		alignItems: "center",
		pointerEvents: "none", // Prevent container from blocking clicks
	}),
);

const StyledButton = styled(IconButton)(({ theme }) => ({
	backgroundColor: theme.palette.background.paper,
	color: theme.palette.text.secondary,
	width: 44,
	height: 44,
	backdropFilter: "blur(8px)",
	WebkitBackdropFilter: "blur(8px)",
	borderRadius: "12px",
	pointerEvents: "auto",
	boxShadow: "0 2px 12px rgba(0, 0, 0, 0.15)",
	border: "1px solid rgba(255, 255, 255, 0.1)",
	transform: "translateY(0)",
	transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
	"&:hover": {
		backgroundColor: theme.palette.background.paper,
		transform: "translateY(-2px)",
		boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
		color: theme.palette.primary.main,
		"& svg": {
			transform: "translateY(1px)",
		},
	},
	"&:active": {
		transform: "translateY(0)",
		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
	},
	"& svg": {
		fontSize: "1rem",
		transition: "transform 0.2s ease",
	},
}));

/**
 * ScrollToBottomButton Component
 *
 * A modern, minimalist button that appears when the user scrolls up in chat.
 * Features smooth animations and glass-morphism styling.
 *
 * The button is now positioned absolutely within its container, allowing it to
 * move with the container rather than being fixed on the screen.
 */
export const ScrollToBottomButton: FC<ScrollToBottomButtonProps> = ({
	visible,
	isChatUtilitiesExpanded,
	onClick,
	className,
}) => {
	const handleClick = useCallback(() => {
		onClick();
	}, [onClick]);

	return (
		<Fade in={visible} timeout={200}>
			{/* Pass isChatUtilitiesExpanded to the styled component for styling, but prevent it from reaching the DOM */}
			<ButtonContainer
				isChatUtilitiesExpanded={isChatUtilitiesExpanded}
				className={className}
			>
				<StyledButton
					aria-label="Scroll to bottom"
					onClick={handleClick}
					size="small"
				>
					<FontAwesomeIcon icon={faArrowDown} />
				</StyledButton>
			</ButtonContainer>
		</Fade>
	);
};
