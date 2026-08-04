import {
	Box,
	Chip,
	ClickAwayListener,
	Divider,
	Menu,
	MenuItem,
	TextField,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { AgentUpdate } from "@shared/api/local-operator/types";
import { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { useRecentDirectoriesStore } from "@shared/store/recent-directories-store";
import type { LucideIcon } from "lucide-react";
import {
	Archive,
	Book,
	Clock,
	Database,
	Download,
	FileText,
	Folder,
	FolderOpen,
	FolderTree,
	HardDrive,
	House,
	Image as ImageIcon,
	Laptop,
	Monitor,
	Music,
	Network,
	Package,
	PackageOpen,
	Server,
	Users,
	Video,
} from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

/**
 * Props for the DirectoryIndicator component
 */
type DirectoryIndicatorProps = {
	/** The ID of the current agent */
	agentId: string;
	/** The current working directory of the agent */
	currentWorkingDirectory?: string;
};

type DirectoryInfo = {
	name: string;
	path: string;
	icon: LucideIcon;
};

/**
 * Maps directory names to appropriate icons
 */
const getDirectoryIcon = (name: string, path: string): LucideIcon => {
	const lowerName = name.toLowerCase();
	const lowerPath = path.toLowerCase();

	if (name === "Home" || path === "~") return House;
	if (lowerName.includes("download")) return Download;
	if (lowerName.includes("document")) return FileText;
	if (lowerName.includes("desktop")) return Monitor;
	if (lowerName.includes("picture")) return ImageIcon;
	if (lowerName.includes("music")) return Music;
	if (lowerName.includes("video")) return Video;
	if (lowerName.includes("program")) return Laptop;
	if (lowerName.includes("user")) return Users;
	if (lowerPath.includes("programdata")) return Database;
	if (lowerName.includes("application")) return PackageOpen;
	if (lowerName.includes("library")) return Book;
	if (lowerName.includes("volume")) return HardDrive;
	if (lowerName.includes("etc")) return Server;
	if (lowerName.includes("usr")) return Users;
	if (lowerName.includes("var")) return Database;
	if (lowerName.includes("opt")) return Package;
	if (lowerName.includes("mnt")) return HardDrive;
	if (lowerName.includes("media")) return Archive;
	if (lowerName.includes("srv")) return Network;

	return Folder;
};

/**
 * Default directories to offer as quick selections based on OS
 */
const DEFAULT_DIRECTORIES: DirectoryInfo[] = [
	{ name: "Home", path: "~", icon: House },
	{ name: "Downloads", path: "~/Downloads", icon: Download },
	{ name: "Documents", path: "~/Documents", icon: FileText },
	{ name: "Desktop", path: "~/Desktop", icon: Monitor },
	{ name: "Pictures", path: "~/Pictures", icon: ImageIcon },
	{ name: "Music", path: "~/Music", icon: Music },
	{ name: "Videos", path: "~/Videos", icon: Video },
	...(navigator.userAgent.indexOf("Win") !== -1
		? [
				{ name: "Program Files", path: "C:\\Program Files", icon: Laptop },
				{
					name: "Program Files (x86)",
					path: "C:\\Program Files (x86)",
					icon: Laptop,
				},
				{ name: "Users", path: "C:\\Users", icon: Users },
				{ name: "ProgramData", path: "C:\\ProgramData", icon: Database },
			]
		: navigator.userAgent.indexOf("Mac") !== -1
			? [
					{ name: "Applications", path: "/Applications", icon: PackageOpen },
					{ name: "Library", path: "~/Library", icon: Book },
					{ name: "Users", path: "/Users", icon: Users },
					{ name: "Volumes", path: "/Volumes", icon: HardDrive },
				]
			: [
					{ name: "etc", path: "/etc", icon: Server },
					{ name: "usr", path: "/usr", icon: Users },
					{ name: "var", path: "/var", icon: Database },
					{ name: "opt", path: "/opt", icon: Package },
					{ name: "mnt", path: "/mnt", icon: HardDrive },
					{ name: "media", path: "/media", icon: Archive },
					{ name: "srv", path: "/srv", icon: Network },
				]
	).map((dir) => ({
		...dir,
		icon: getDirectoryIcon(dir.name, dir.path),
	})),
];

const DirectoryChip = styled(Chip)(({ theme }) => ({
	backgroundColor: alpha(theme.palette.primary.main, 0.06),
	color: theme.palette.text.secondary,
	borderRadius: "8px",
	padding: "0 12px",
	height: "32px",
	maxWidth: "260px",
	transition: "all 0.15s ease",
	"& .MuiChip-label": {
		padding: "0 6px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: "0.85rem",
		letterSpacing: "0.01em",
	},
	"& .MuiChip-deleteIcon": {
		fontSize: "0.85rem",
		margin: "0 3px 0 0",
		color: alpha(theme.palette.text.primary, 0.4),
	},
	"& .MuiChip-icon": {
		fontSize: "0.85rem",
		margin: "0 3px 0 3px",
		color: alpha(theme.palette.text.primary, 0.6),
	},
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.1),
		color: theme.palette.text.primary,
		transform: "translateY(-1px)",
	},
}));

const DirectoryTextField = styled(TextField)(({ theme }) => ({
	"& .MuiInputBase-root": {
		backgroundColor: alpha(theme.palette.background.default, 0.06),
		borderRadius: "8px",
		padding: "0 12px",
		height: "32px",
		maxWidth: "260px",
		color: theme.palette.text.primary,
		border: `1px solid ${alpha(theme.palette.common.white, 0.2)}`,
	},
	"& .MuiOutlinedInput-notchedOutline": {
		border: "none",
	},
	"& .MuiInputBase-input": {
		padding: "0 6px",
		fontSize: "0.85rem",
		letterSpacing: "0.01em",
		"&::placeholder": {
			fontSize: "0.85rem",
			opacity: 0.7,
		},
	},
}));

const MenuItemIcon = styled(Box)({
	width: "20px",
	height: "20px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginRight: "8px",
	opacity: 0.7,
});

/**
 * DirectoryIndicator Component
 *
 * Displays the current working directory of the agent and allows changing it
 */
export const DirectoryIndicator: FC<DirectoryIndicatorProps> = ({
	agentId,
	currentWorkingDirectory,
}) => {
	const [isEditing, setIsEditing] = useState(false);
	const [directory, setDirectory] = useState(currentWorkingDirectory || "");
	const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null); // State for home directory
	const inputRef = useRef<HTMLInputElement>(null);
	const updateAgent = useUpdateAgent();

	// Fetch home directory on mount
	useEffect(() => {
		const fetchHomeDir = async () => {
			try {
				const homeDir = await window.api.getHomeDirectory();
				setHomeDirectory(homeDir);
			} catch (error) {
				console.error("Failed to fetch home directory:", error);
			}
		};
		fetchHomeDir();
	}, []);

	useEffect(() => {
		setDirectory(currentWorkingDirectory || "");
	}, [currentWorkingDirectory]);

	const handleOpenMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
		setMenuAnchorEl(event.currentTarget);
	}, []);

	const handleCloseMenu = useCallback(() => {
		setMenuAnchorEl(null);
	}, []);

	const { recentDirectories, addRecentDirectory } = useRecentDirectoriesStore();

	/**
	 * Filter out recent directories that are already in DEFAULT_DIRECTORIES
	 */
	const filteredRecentDirectories = useMemo(() => {
		const defaultPaths = DEFAULT_DIRECTORIES.map((dir) => dir.path);
		return recentDirectories.filter((path) => !defaultPaths.includes(path));
	}, [recentDirectories]);

	const handleSelectDirectory = useCallback(
		(path: string) => {
			setDirectory(path);
			handleCloseMenu();

			// Add to recent directories
			addRecentDirectory(path);

			updateAgent.mutate({
				agentId,
				update: {
					current_working_directory: path,
				} as AgentUpdate,
			});
		},
		[agentId, updateAgent, handleCloseMenu, addRecentDirectory],
	);

	const handleStartEdit = useCallback((event?: React.MouseEvent) => {
		if (event) {
			event.stopPropagation();
		}

		setMenuAnchorEl(null);

		setIsEditing(true);
		setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.focus();
			}
		}, 0);
	}, []);

	const handleFinishEdit = useCallback(() => {
		setIsEditing(false);

		if (directory !== currentWorkingDirectory) {
			// Add to recent directories when manually entering a path
			addRecentDirectory(directory);

			updateAgent.mutate({
				agentId,
				update: {
					current_working_directory: directory,
				} as AgentUpdate,
			});
		}
	}, [
		agentId,
		directory,
		currentWorkingDirectory,
		updateAgent,
		addRecentDirectory,
	]);

	const handleKeyPress = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				handleFinishEdit();
			} else if (e.key === "Escape") {
				setDirectory(currentWorkingDirectory || "");
				setIsEditing(false);
			}
		},
		[handleFinishEdit, currentWorkingDirectory],
	);

	const handleBrowseForDirectory = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			handleCloseMenu(); // Close menu when browse starts

			try {
				const selectedPath = await window.api.selectDirectory();
				if (selectedPath) {
					handleSelectDirectory(selectedPath);
				}
			} catch (error) {
				console.error("Error selecting directory:", error);
				// Optionally show a user-facing error message here
			}
		},
		[handleSelectDirectory, handleCloseMenu],
	);

	// Updated formatDirectory to use fetched home directory
	const formatDirectory = useCallback(
		(dir: string) => {
			if (homeDirectory && dir.startsWith(homeDirectory)) {
				// Ensure consistent path separators (especially for Windows)
				const relativePath = dir.substring(homeDirectory.length);
				// Add separator if needed, handle both '/' and '\'
				if (
					relativePath.startsWith("/") ||
					relativePath.startsWith("\\") ||
					relativePath === ""
				) {
					return `~${relativePath.replace(/\\/g, "/")}`;
				}
				return `~/${relativePath.replace(/\\/g, "/")}`;
			}
			// Handle the case where the path is exactly the home directory
			if (homeDirectory && dir === homeDirectory) {
				return "~";
			}
			// Handle explicit '~' path from default directories
			if (dir === "~") {
				return "~";
			}
			return dir.replace(/\\/g, "/"); // Always use forward slashes for display
		},
		[homeDirectory],
	);

	if (!currentWorkingDirectory && !isEditing) {
		return (
			<Box sx={{ display: "flex", alignItems: "center", ml: 1 }}>
				<Tooltip title="Click to set working directory" arrow placement="right">
					<DirectoryChip
						icon={<Folder size={14} />}
						label="No working directory set"
						onClick={handleStartEdit}
						clickable
					/>
				</Tooltip>
			</Box>
		);
	}

	return (
		<Box sx={{ display: "flex", alignItems: "center", ml: 1 }}>
			{isEditing ? (
				<ClickAwayListener onClickAway={handleFinishEdit}>
					<DirectoryTextField
						inputRef={inputRef}
						value={directory}
						onChange={(e) => setDirectory(e.target.value)}
						onKeyDown={handleKeyPress}
						size="small"
						fullWidth
						placeholder="Enter directory path"
						sx={{ minWidth: "250px" }}
					/>
				</ClickAwayListener>
			) : (
				<>
					<Tooltip
						title="Click to change working directory"
						arrow
						placement="right"
					>
						<DirectoryChip
							icon={<FolderOpen size={14} onClick={handleBrowseForDirectory} />}
							label={formatDirectory(currentWorkingDirectory || "")}
							onClick={handleOpenMenu}
							clickable
						/>
					</Tooltip>

					{/* Removed hidden file input */}

					<Menu
						anchorEl={menuAnchorEl}
						open={Boolean(menuAnchorEl)}
						onClose={handleCloseMenu}
						anchorOrigin={{
							vertical: "bottom",
							horizontal: "left",
						}}
						transformOrigin={{
							vertical: "top",
							horizontal: "left",
						}}
						PaperProps={{
							sx: {
								mt: 0.5,
								backgroundColor: (theme) =>
									alpha(theme.palette.background.default, 0.95),
								boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
								backgroundImage: "none",
								borderRadius: "8px",
								border: "1px solid rgba(255,255,255,0.1)",
								"& .MuiMenuItem-root": {
									borderRadius: "4px",
									margin: "2px 4px",
									"&:hover": {
										backgroundColor: (theme) =>
											alpha(theme.palette.primary.main, 0.15),
									},
								},
								"& .MuiDivider-root": {
									margin: "4px 0",
									borderColor: "rgba(255,255,255,0.1)",
								},
							},
						}}
					>
						{/* Custom directory option */}
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ px: 2, py: 0.5, display: "block" }}
						>
							Custom Directory
						</Typography>

						<MenuItem
							onClick={(e) => {
								e.stopPropagation();
								handleStartEdit();
								handleCloseMenu();
							}}
							dense
						>
							<Typography variant="body2">Enter custom path...</Typography>
						</MenuItem>

						<MenuItem onClick={handleBrowseForDirectory} dense>
							<MenuItemIcon>
								<FolderTree size={14} />
							</MenuItemIcon>
							<Typography variant="body2">Browse for directory...</Typography>
						</MenuItem>

						{/* Recent directories section - always show the section */}
						<Divider sx={{ my: 1 }} />

						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ px: 2, py: 0.5, display: "block" }}
						>
							Recent Directories
						</Typography>

						{filteredRecentDirectories.length > 0 ? (
							filteredRecentDirectories.map((path) => (
								<MenuItem
									key={`recent-${path}`}
									onClick={() => handleSelectDirectory(path)}
									dense
								>
									<MenuItemIcon>
										<Clock size={14} />
									</MenuItemIcon>
									{formatDirectory(path).length > 42 ? (
										<Tooltip
											title={formatDirectory(path)}
											arrow
											placement="right"
										>
											<Typography variant="body2">
												{`...${formatDirectory(path).substring(formatDirectory(path).length - 42)}`}
											</Typography>
										</Tooltip>
									) : (
										<Typography variant="body2">
											{formatDirectory(path)}
										</Typography>
									)}
								</MenuItem>
							))
						) : (
							<MenuItem disabled dense>
								<Typography
									variant="body2"
									color="text.secondary"
									sx={{ fontStyle: "italic" }}
								>
									No recent directories
								</Typography>
							</MenuItem>
						)}

						{/* Default directories section */}
						<Divider sx={{ my: 1 }} />

						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ px: 2, py: 0.5, display: "block" }}
						>
							Default Directories
						</Typography>

						{DEFAULT_DIRECTORIES.map((dir) => {
							const DirIcon = dir.icon;
							return (
								<MenuItem
									key={dir.path}
									onClick={() => handleSelectDirectory(dir.path)}
									dense
								>
									<MenuItemIcon>
										<DirIcon size={14} />
									</MenuItemIcon>
									<Typography variant="body2">{dir.name}</Typography>
									<Typography
										variant="caption"
										color="text.secondary"
										sx={{ ml: 1 }}
									>
										{formatDirectory(dir.path)}
									</Typography>
								</MenuItem>
							);
						})}
					</Menu>
				</>
			)}
		</Box>
	);
};
