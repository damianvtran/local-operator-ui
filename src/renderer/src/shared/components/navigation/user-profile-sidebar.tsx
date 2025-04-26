import {
	faGear,
	faShield,
	faSignOut,
	faUser,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Avatar,
	Box,
	Divider,
	Menu,
	MenuItem,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useCallback, useMemo, useState } from "react";
import React, { type FC } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Props for the UserProfileSidebar component
 */
type UserProfileSidebarProps = {
	/** Whether the sidebar is expanded or collapsed */
	expanded: boolean;
	/** Whether to display authentication-related menu items (default: false) */
	useAuth?: boolean;
};

const ProfileContainer = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
}));

const ProfileDivider = styled(Divider, {
	shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ theme, expanded }) => ({
	margin: "8px 0",
	borderColor: theme.palette.sidebar.border,
	marginLeft: expanded ? 16 : 8,
	marginRight: expanded ? 16 : 8,
}));

const ProfileBox = styled(Box, {
	shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ theme, expanded }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 16px",
	cursor: "pointer",
	borderRadius: 8,
	marginLeft: expanded ? 8 : "auto",
	marginRight: expanded ? 8 : "auto",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: theme.palette.sidebar.itemHover,
	},
}));

const UserAvatar = styled(Avatar)(({ theme }) => ({
	width: 36,
	height: 36,
	backgroundColor: theme.palette.primary.main,
	transition: "all 0.3s ease",
	"&:hover": {
		boxShadow: `0 0 15px ${alpha(theme.palette.primary.main, 0.5)}`,
	},
}));

const UserInitials = styled("span")(() => ({
	fontSize: "0.95rem",
	fontWeight: 500,
}));

const UserInfoContainer = styled(Box)(() => ({
	marginLeft: 12,
	overflow: "hidden",
}));

const UserName = styled(Typography)(() => ({
	fontWeight: 500,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

const UserEmail = styled(Typography)(() => ({
	color: "text.secondary",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	display: "block",
}));

const StyledMenu = styled(Menu)(({ theme }) => ({
	"& .MuiPaper-root": {
		marginTop: theme.spacing(1.5),
		backgroundColor: theme.palette.background.paper,
		backgroundImage:
			theme.palette.mode === "dark"
				? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03))"
				: "linear-gradient(rgba(0, 0, 0, 0.01), rgba(0, 0, 0, 0.02))",
		backdropFilter: "blur(20px)",
		border: `1px solid ${theme.palette.sidebar.border}`,
		borderRadius: 16,
		minWidth: 200,
		overflow: "visible",
		boxShadow: theme.shadows[3],
		"&:before": {
			content: '""',
			display: "block",
			position: "absolute",
			top: 0,
			right: 14,
			width: 10,
			height: 10,
			bgcolor: theme.palette.background.paper,
			transform: "translateY(-50%) rotate(45deg)",
			zIndex: 0,
			borderTop: `1px solid ${theme.palette.sidebar.border}`,
			borderLeft: `1px solid ${theme.palette.sidebar.border}`,
		},
	},
}));

const MenuItemStyled = styled(MenuItem)(({ theme }) => ({
	padding: "12px 12px",
	borderRadius: 8,
	margin: "4px 8px",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: theme.palette.sidebar.itemHover,
		transform: "translateX(5px)",
	},
}));

const MenuItemDanger = styled(MenuItemStyled)(() => ({
	color: alpha("#ff6b6b", 0.9),
	"&:hover": {
		backgroundColor: alpha("#ff6b6b", 0.1),
		transform: "translateX(5px)",
	},
}));

const MenuDivider = styled(Box)(({ theme }) => ({
	borderTop: `1px solid ${theme.palette.sidebar.border}`,
	margin: "8px 0",
}));

const IconWrapper = styled("span")(() => ({
	marginRight: 12,
	width: 16,
	height: 16,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
}));

const StyledTooltip = styled(Tooltip)(({ theme }) => ({
	"& .MuiTooltip-tooltip": {
		backgroundColor: theme.palette.tooltip.background,
		color: theme.palette.tooltip.text,
		fontSize: 12,
		borderRadius: 8,
		padding: "5px 10px",
		border: `1px solid ${theme.palette.tooltip.border}`,
	},
	"& .MuiTooltip-arrow": {
		color: theme.palette.tooltip.background,
	},
}));

/**
 * UserProfileSidebar component displays user information at the bottom of the sidebar
 * Shows only the avatar when collapsed, and user details when expanded
 * Uses React Router for navigation
 */
// Use React.memo to prevent unnecessary re-renders of the entire component
export const UserProfileSidebar: FC<UserProfileSidebarProps> = React.memo(
	({ expanded, useAuth = false }) => {
		const navigate = useNavigate();
		const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
		const open = Boolean(anchorEl);

		// Get user profile from Radient auth or fallback to user store
		const { user, isAuthenticated, signOut } = useRadientAuth();
		const userName = user?.name ?? "User";
		const userEmail = user?.email ?? "";

		// Memoize handlers to prevent unnecessary re-renders
		const handleClick = useCallback(
			(event: React.MouseEvent<HTMLElement>) => {
				if (useAuth) {
					setAnchorEl(event.currentTarget);
				} else {
					navigate("/settings");
				}
			},
			[useAuth, navigate],
		);

		const handleClose = useCallback(() => {
			setAnchorEl(null);
		}, []);

		const handleNavigate = useCallback(
			(path: string) => {
				handleClose();
				navigate(path);
			},
			[handleClose, navigate],
		);

		const handleSignOut = useCallback(async () => {
			// If authenticated with Radient, sign out
			if (isAuthenticated) {
				await signOut();
				console.log("Signed out from Radient session");

				// Refresh the page to reset the auth state
				window.location.reload();
			}
			handleClose();
		}, [isAuthenticated, signOut, handleClose]);

		// Memoize user initials calculation
		const userInitials = useMemo(() => {
			if (!userName) return null;

			return userName
				.split(" ")
				.map((part) => part.charAt(0))
				.join("")
				.toUpperCase()
				.substring(0, 2);
		}, [userName]);

		// Memoize avatar component to prevent unnecessary re-renders
		const avatarComponent = useMemo(
			() => (
				<UserAvatar>
					{userInitials ? (
						<UserInitials>{userInitials}</UserInitials>
					) : (
						<FontAwesomeIcon icon={faUser} size="sm" />
					)}
				</UserAvatar>
			),
			[userInitials],
		);

		return (
			<ProfileContainer>
				<ProfileDivider expanded={expanded} />

				<ProfileBox expanded={expanded} onClick={handleClick}>
					{!expanded ? (
						<StyledTooltip title="Account Settings" placement="right" arrow>
							<Box>{avatarComponent}</Box>
						</StyledTooltip>
					) : (
						avatarComponent
					)}

					{expanded && userName && (
						<UserInfoContainer>
							<UserName variant="subtitle2">{userName}</UserName>
							{userEmail && (
								<UserEmail variant="caption">{userEmail}</UserEmail>
							)}
						</UserInfoContainer>
					)}
				</ProfileBox>

				{useAuth ? (
					<StyledMenu
						anchorEl={anchorEl}
						id="account-menu"
						open={open}
						onClose={handleClose}
						transformOrigin={{ horizontal: "right", vertical: "top" }}
						anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
					>
						<MenuItemStyled onClick={() => handleNavigate("/settings")}>
							<IconWrapper>
								<FontAwesomeIcon icon={faGear} />
							</IconWrapper>
							Settings
						</MenuItemStyled>
						<MenuItemStyled onClick={handleClose}>
							<IconWrapper>
								<FontAwesomeIcon icon={faShield} />
							</IconWrapper>
							Privacy & Security
						</MenuItemStyled>
						<MenuDivider />
						<MenuItemDanger onClick={handleSignOut}>
							<IconWrapper>
								<FontAwesomeIcon icon={faSignOut} />
							</IconWrapper>
							Sign out
						</MenuItemDanger>
					</StyledMenu>
				) : null}
			</ProfileContainer>
		);
	},
);
