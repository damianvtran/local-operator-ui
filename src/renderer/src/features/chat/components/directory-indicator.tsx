import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
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
	Pencil,
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
 *
 * The chip is a CONTROLLED input: it renders the directory it is given and
 * reports a chosen one back. It deliberately owns no write path of its own.
 *
 * It used to take an `agentId` and PATCH the legacy agents REST API itself,
 * which quietly could not work from the composer: the id threaded in there is
 * a 12-hex canonical session id or a draft key, never an agent UUID, so the
 * write went to the wrong resource with the wrong key. Handing the write back
 * to the caller lets each mount site use the path that actually exists for it
 * - `setCwd` on a draft session here, `useUpdateAgent` in the create-file
 * dialog, which really does hold an agent UUID.
 */
type DirectoryIndicatorProps = {
	/** Directory to display. Undefined renders the "not set" affordance. */
	currentWorkingDirectory?: string;
	/**
	 * Commit a newly chosen directory. Omit to render read-only: the chip then
	 * shows the directory and explains, via `readOnlyReason`, why it cannot be
	 * changed here rather than offering a control that would silently fail.
	 */
	onChangeDirectory?: (path: string) => void;
	/** Tooltip shown when `onChangeDirectory` is absent. */
	readOnlyReason?: string;
};

type DirectoryInfo = {
	name: string;
	path: string;
	icon: LucideIcon;
};

/**
 * A path is machine voice, so it is monospace wherever it appears: in the chip,
 * in the edit field, and next to a directory name in the menu. The ink role is
 * left to each site — subdued for a label, full for the field being typed in.
 */
const PATH_TYPE = "font-mono text-mono-sm";

/**
 * Roughly the number of 12px monospace characters that fit on a recent-path
 * row of the 320px menu. Past it the row ellipsises, so that is where the
 * row earns a tooltip carrying the full path.
 */
const RECENT_PATH_TRUNCATES_AT = 42;

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

/**
 * DirectoryIndicator Component
 *
 * Displays the current working directory of the agent and allows changing it
 */
export const DirectoryIndicator: FC<DirectoryIndicatorProps> = ({
	currentWorkingDirectory,
	onChangeDirectory,
	readOnlyReason,
}) => {
	const [isEditing, setIsEditing] = useState(false);
	const [directory, setDirectory] = useState(currentWorkingDirectory || "");
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null); // State for home directory
	const inputRef = useRef<HTMLInputElement>(null);
	const editable = Boolean(onChangeDirectory);

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

	const handleCloseMenu = useCallback(() => {
		setIsMenuOpen(false);
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

			onChangeDirectory?.(path);
		},
		[onChangeDirectory, handleCloseMenu, addRecentDirectory],
	);

	const handleStartEdit = useCallback((event?: React.MouseEvent) => {
		if (event) {
			event.stopPropagation();
		}

		setIsMenuOpen(false);

		setIsEditing(true);
		// Deferred a task so the menu's own focus restoration, which runs while
		// the trigger is unmounting, cannot steal the caret back.
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

			onChangeDirectory?.(directory);
		}
	}, [
		directory,
		currentWorkingDirectory,
		onChangeDirectory,
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

	/*
	 * Read-only: show the directory and say why it cannot be changed here.
	 *
	 * A live session's cwd is fixed at creation. `sessions.create` is the only
	 * cwd write path the backend exposes - the TUI's `/move` has no HTTP route -
	 * so offering a picker on a live session would be a control whose every use
	 * fails. Stating the reason in a tooltip is the honest version of that, and
	 * the button stays focusable so a keyboard user can read it too.
	 */
	if (!editable) {
		return (
			<div className={cn("ml-2 flex items-center")} data-lo-cwd-chip="readonly">
				<Tooltip content={readOnlyReason ?? "Working directory"} side="right">
					<Button
						variant="ghost"
						className={cn("max-w-65 cursor-default justify-start", PATH_TYPE)}
						aria-label={readOnlyReason ?? "Working directory"}
					>
						<FolderOpen aria-hidden="true" />
						<span className={cn("min-w-0 truncate")}>
							{formatDirectory(currentWorkingDirectory || "")}
						</span>
					</Button>
				</Tooltip>
			</div>
		);
	}

	if (!currentWorkingDirectory && !isEditing) {
		return (
			<div className={cn("ml-2 flex items-center")} data-lo-cwd-chip="unset">
				<Tooltip content="Click to set working directory" side="right">
					<Button variant="ghost" onClick={handleStartEdit}>
						<Folder aria-hidden="true" />
						No working directory set
					</Button>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className={cn("ml-2 flex items-center")} data-lo-cwd-chip="editable">
			{isEditing ? (
				<Input
					ref={inputRef}
					value={directory}
					onChange={(e) => setDirectory(e.target.value)}
					onKeyDown={handleKeyPress}
					onBlur={handleFinishEdit}
					placeholder="Enter directory path"
					aria-label="Working directory path"
					className={cn("w-64", PATH_TYPE)}
				/>
			) : (
				<DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
					<Tooltip content="Click to change working directory" side="right">
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								className={cn("max-w-65 justify-start", PATH_TYPE)}
							>
								<FolderOpen aria-hidden="true" />
								<span className={cn("min-w-0 truncate")}>
									{formatDirectory(currentWorkingDirectory || "")}
								</span>
							</Button>
						</DropdownMenuTrigger>
					</Tooltip>

					<DropdownMenuContent align="start" className={cn("w-80")}>
						<DropdownMenuLabel>Custom directory</DropdownMenuLabel>

						<DropdownMenuItem
							onClick={(e) => {
								e.stopPropagation();
								handleStartEdit();
							}}
						>
							<Pencil aria-hidden="true" />
							Enter custom path...
						</DropdownMenuItem>

						<DropdownMenuItem onClick={handleBrowseForDirectory}>
							<FolderTree aria-hidden="true" />
							Browse for directory...
						</DropdownMenuItem>

						{/* Recent directories section - always show the section */}
						<DropdownMenuSeparator />

						<DropdownMenuLabel>Recent directories</DropdownMenuLabel>

						{filteredRecentDirectories.length > 0 ? (
							filteredRecentDirectories.map((path) => {
								const formatted = formatDirectory(path);
								return (
									<DropdownMenuItem
										key={`recent-${path}`}
										onClick={() => handleSelectDirectory(path)}
									>
										<Clock aria-hidden="true" />
										<Tooltip
											content={formatted}
											side="right"
											disabled={formatted.length <= RECENT_PATH_TRUNCATES_AT}
										>
											<span
												className={cn(
													"min-w-0 truncate",
													PATH_TYPE,
													"text-ink-muted",
												)}
											>
												{formatted}
											</span>
										</Tooltip>
									</DropdownMenuItem>
								);
							})
						) : (
							<DropdownMenuItem disabled>
								No recent directories
							</DropdownMenuItem>
						)}

						{/* Default directories section */}
						<DropdownMenuSeparator />

						<DropdownMenuLabel>Default directories</DropdownMenuLabel>

						{DEFAULT_DIRECTORIES.map((dir) => {
							const DirIcon = dir.icon;
							return (
								<DropdownMenuItem
									key={dir.path}
									onClick={() => handleSelectDirectory(dir.path)}
								>
									<DirIcon aria-hidden="true" />
									{dir.name}
									<span
										className={cn(
											"ml-auto min-w-0 truncate",
											PATH_TYPE,
											"text-ink-dim",
										)}
									>
										{formatDirectory(dir.path)}
									</span>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
};
