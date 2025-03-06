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
import { useUserStore } from "@renderer/store/user-store";
import { useState } from "react";
import type React from "react";
import type { FC } from "react";
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
})<{ expanded: boolean }>(({ expanded }) => ({
	margin: "8px 0",
	borderColor: "rgba(255,255,255,0.08)",
	marginLeft: expanded ? 16 : 8,
	marginRight: expanded ? 16 : 8,
}));

const ProfileBox = styled(Box, {
	shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ expanded }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 16px",
	cursor: "pointer",
	borderRadius: 8,
	marginLeft: expanded ? 8 : "auto",
	marginRight: expanded ? 8 : "auto",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: "rgba(255,255,255,0.05)",
	},
}));

const UserAvatar = styled(Avatar)(() => ({
	width: 36,
	height: 36,
	backgroundColor: "primary.main",
	transition: "all 0.3s ease",
	"&:hover": {
		boxShadow: "0 0 15px rgba(56, 201, 106, 0.5)",
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
		backgroundColor: "background.paper",
		backgroundImage:
			"linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03))",
		backdropFilter: "blur(20px)",
		border: "1px solid rgba(255, 255, 255, 0.08)",
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
			bgcolor: "background.paper",
			transform: "translateY(-50%) rotate(45deg)",
			zIndex: 0,
			borderTop: "1px solid rgba(255, 255, 255, 0.08)",
			borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
		},
	},
}));

const MenuItemStyled = styled(MenuItem)(() => ({
	padding: "12px 12px",
	borderRadius: 8,
	margin: "4px 8px",
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: "rgba(255,255,255,0.05)",
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

const MenuDivider = styled(Box)(() => ({
	borderTop: "1px solid rgba(255,255,255,0.08)",
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

const StyledTooltip = styled(Tooltip)(() => ({
	"& .MuiTooltip-tooltip": {
		backgroundColor: "rgba(0, 0, 0, 0.8)",
		color: "white",
		fontSize: 12,
		borderRadius: 8,
		padding: "5px 10px",
	},
	"& .MuiTooltip-arrow": {
		color: "rgba(0, 0, 0, 0.8)",
	},
}));

/**
 * UserProfileSidebar component displays user information at the bottom of the sidebar
 * Shows only the avatar when collapsed, and user details when expanded
 * Uses React Router for navigation
 */
export const UserProfileSidebar: FC<UserProfileSidebarProps> = ({
	expanded,
	useAuth = false,
}) => {
	const navigate = useNavigate();
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const open = Boolean(anchorEl);

	// Get user profile from the store
	const { profile } = useUserStore();
	const userName = profile.name;
	const userEmail = profile.email;

	const handleClick = (event: React.MouseEvent<HTMLElement>) => {
		if (useAuth) {
			setAnchorEl(event.currentTarget);
		} else {
			navigate("/settings");
		}
	};

	const handleClose = () => {
		setAnchorEl(null);
	};

	const handleNavigate = (path: string) => {
		handleClose();
		navigate(path);
	};

	// Get user initials from name or use default icon
	const getUserInitials = (): string | null => {
		if (!userName) return null;

		return userName
			.split(" ")
			.map((part) => part.charAt(0))
			.join("")
			.toUpperCase()
			.substring(0, 2);
	};

	const userInitials = getUserInitials();

	// Avatar component that will be wrapped in a tooltip if sidebar is collapsed
	const avatarComponent = (
		<UserAvatar>
			{userInitials ? (
				<UserInitials>{userInitials}</UserInitials>
			) : (
				<FontAwesomeIcon icon={faUser} size="sm" />
			)}
		</UserAvatar>
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
						{userEmail && <UserEmail variant="caption">{userEmail}</UserEmail>}
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
					<MenuItemDanger onClick={handleClose}>
						<IconWrapper>
							<FontAwesomeIcon icon={faSignOut} />
						</IconWrapper>
						Sign out
					</MenuItemDanger>
				</StyledMenu>
			) : null}
		</ProfileContainer>
	);
};
