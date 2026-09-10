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
	X,
} from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useId,
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
 * - `setCwd` on a draft session here. The create-file dialog does NOT hold an
 * agent UUID either (its `agentId` is the same session id), so it mounts this
 * chip read-only rather than owning a second write path that 404s.
 */
type DirectoryIndicatorProps = {
	/**
	 * Directory to display. Undefined renders the "not set" affordance, which
	 * is a real reachable state: the empty string is a legal value of the
	 * store's staged cwd, and the caller passes `undefined` for it rather than
	 * unmounting this component. See `LABEL` below for why that matters.
	 */
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
 * The same rule for the chip's own trigger, which is narrower than a menu row:
 * `max-w-65` is 260px, and 12px monospace fits about 28 characters in what is
 * left after the glyph, the label and the button's padding. Past it the span
 * ellipsises and the tooltip carries the full path instead of the generic
 * hint - the value being unreadable everywhere was the defect.
 */
const TRIGGER_PATH_TRUNCATES_AT = 28;

/**
 * The chip's outer slot.
 *
 * Deliberately NOT a query container itself. The chip is a ~53px shrink-wrap
 * around its own content, so a container query scoped here asks "is this chip
 * wide enough to hold the label" - which is circular, and answers no forever:
 * the label is what would make it wide. The question that has an answer is
 * whether the COMPOSER TOOLBAR has room, so the container is declared there
 * (`CHAT_COLUMN_CONTAINER` on the composer band) and this element only has to
 * avoid introducing a nearer one.
 */
const CHIP_WRAPPER = "ml-2 flex min-w-0 items-center";

/**
 * The chip's box, shared by all three states so they differ only where they
 * are meant to differ.
 *
 * `gap-1.5` explicitly rather than by way of the Button `md` slot: the glyph
 * and the path sat about 34px apart inside one control while the gap BETWEEN
 * the chip and the attach button beside it was 10px, so the pair read as two
 * objects rather than one. § 5 requires the space inside a pair to be visibly
 * tighter than the space around it, which is the ratio the button sizes are
 * built on (8/4, 12/6, 16/8) and which the truncating span's own box was
 * defeating.
 */
const CHIP_BOX =
	"inline-flex h-8 max-w-65 items-center gap-1.5 rounded-sm px-3 text-body-sm";

/**
 * The same box for the two states that really are buttons.
 *
 * `w-fit` matters: without it the button stretched to its `max-w-65` and the
 * `justify-start` content sat against a wide empty remainder, which is what
 * put ~34px between the glyph and the path inside ONE control while the gap
 * to the attach button beside it was 10px. § 5 asks for the space inside a
 * pair to be visibly tighter than the space around it; shrink-wrapping the
 * box is what makes the 6px gap the eye actually sees.
 */
const CHIP_BOX_INTERACTIVE = "w-fit max-w-65 justify-start gap-1.5";

/**
 * The word the deleted full-width bar used to carry.
 *
 * A lone `~` beside a folder glyph is the default and by far the most common
 * state, and nothing in it says "this is where the agent will work" - the
 * word survived only inside a hover tooltip and inside the menu, both of
 * which you have to already suspect are there. The label appears once the
 * chip's own container can afford it and collapses to the bare path when it
 * cannot, so a narrow composer degrades to what it rendered before rather
 * than truncating the path to make room for its own label.
 */
const CHIP_LABEL =
	"hidden shrink-0 whitespace-nowrap text-ink-muted @min-[620px]/chatcol:inline";

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
	/**
	 * The last committed path that does not name a directory on disk, or null.
	 *
	 * Kept as state rather than derived because the check is an async IPC round
	 * trip: the value is set when the answer arrives, and cleared the moment a
	 * new commit starts, so the danger marking never describes a stale path.
	 */
	const [invalidPath, setInvalidPath] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	/** Ties the read-only chip to the sentence explaining why it is read-only. */
	const reasonId = useId();
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

	const { recentDirectories, addRecentDirectory, removeRecentDirectory } =
		useRecentDirectoriesStore();

	/**
	 * The one commit path. Every way of choosing a directory - the menu, the
	 * native browser, and the typed field - lands here, so the rules below are
	 * stated once instead of three times with drift between them.
	 *
	 * Two rules, both of which were defects before:
	 *
	 *  1. An empty or whitespace path is never committed. `""` is a legal value
	 *     of the store's staged cwd, and the composer used to render-gate the
	 *     chip on that value's TRUTHINESS - so committing `""` unmounted the
	 *     only control that could set it again, and `cwd` is persisted, so the
	 *     app came back from a restart still with no chip. The render gate is
	 *     fixed at the call site; this is the other half, because "clear the
	 *     field to retype" should not be a destructive gesture in the first
	 *     place.
	 *  2. Recents record what a user CHOSE, not what they typed. Adding before
	 *     validating filled the suggestion list with `/etc/hosts` and typos
	 *     that no affordance could remove, degrading every later use of the
	 *     menu. A path that does not name a directory is still committed - the
	 *     user may be about to create it, and refusing the commit would be a
	 *     second trap - but it is marked, announced, and kept out of recents.
	 */
	const commitDirectory = useCallback(
		async (path: string) => {
			const trimmed = path.trim();
			if (!trimmed) return false;

			setInvalidPath(null);
			setDirectory(trimmed);
			onChangeDirectory?.(trimmed);

			let exists = false;
			try {
				exists = await window.api.directoryExists(trimmed);
			} catch (error) {
				// A failed check is not a failed path: report it as unverified
				// rather than marking a directory the user may well be able to use.
				console.error("Failed to check working directory:", error);
				return true;
			}

			if (exists) {
				addRecentDirectory(trimmed);
				setAnnouncement(`Working directory set to ${trimmed}`);
			} else {
				setInvalidPath(trimmed);
				setAnnouncement(`${trimmed} is not a directory on this computer`);
			}
			return true;
		},
		[onChangeDirectory, addRecentDirectory],
	);

	/**
	 * Filter out recent directories that are already in DEFAULT_DIRECTORIES
	 */
	const filteredRecentDirectories = useMemo(() => {
		const defaultPaths = DEFAULT_DIRECTORIES.map((dir) => dir.path);
		return recentDirectories.filter((path) => !defaultPaths.includes(path));
	}, [recentDirectories]);

	const handleSelectDirectory = useCallback(
		(path: string) => {
			handleCloseMenu();
			void commitDirectory(path);
		},
		[commitDirectory, handleCloseMenu],
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

	/**
	 * Abandon the edit, keeping the directory that was already in force.
	 *
	 * This is what BLUR does, not what it used to do. Blur used to commit, so
	 * the most ordinary gesture in the flow - type a partial path, then click
	 * into the composer to start writing the message - silently saved a path
	 * the user had not finished typing, with no signal that anything had been
	 * stored. Enter is now the only commit, which leaves the three exits
	 * saying three distinguishable things: Enter commits, Escape and blur keep
	 * what was there, and nothing is written by walking away.
	 */
	const handleCancelEdit = useCallback(() => {
		setDirectory(currentWorkingDirectory || "");
		setIsEditing(false);
	}, [currentWorkingDirectory]);

	const handleCommitEdit = useCallback(() => {
		setIsEditing(false);
		if (directory.trim() === (currentWorkingDirectory || "").trim()) return;
		// A whitespace-only field is a cancel, not a commit: `commitDirectory`
		// refuses it, so restore the field to what is actually in force rather
		// than leaving it showing a value nothing holds.
		if (!directory.trim()) {
			setDirectory(currentWorkingDirectory || "");
			return;
		}
		void commitDirectory(directory);
	}, [directory, currentWorkingDirectory, commitDirectory]);

	const handleKeyPress = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				handleCommitEdit();
			} else if (e.key === "Escape") {
				handleCancelEdit();
			}
		},
		[handleCommitEdit, handleCancelEdit],
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

	const shown = formatDirectory(currentWorkingDirectory || "");
	const isInvalid =
		invalidPath !== null && invalidPath === currentWorkingDirectory;
	/*
	 * A path is only worth a tooltip of its own when the chip cannot show all
	 * of it. The menu's recent rows already work this way; the trigger did not,
	 * so a long path truncated to about half and hovering gave the generic hint
	 * instead of the value - the leaf, which is the part that says where you
	 * are, was the part that could not be read anywhere.
	 */
	const truncates = shown.length > TRIGGER_PATH_TRUNCATES_AT;

	/*
	 * Read-only: show the directory and say why it cannot be changed here.
	 *
	 * A live session's cwd is fixed at creation. `sessions.create` is the only
	 * cwd write path the backend exposes - the TUI's `/move` has no HTTP route -
	 * so offering a picker on a live session would be a control whose every use
	 * fails. Stating the reason in a tooltip is the honest version of that, and
	 * the button stays focusable so a keyboard user can read it too.
	 *
	 * It is rendered as a `span`, not a `Button`. As a ghost `Button` this was
	 * BYTE-IDENTICAL to the editable chip at rest and on hover - measured at
	 * 478 of 3360 pixels differing at 0.14 mean distance, which is antialiasing
	 * - because `variant="ghost"` carries `hover:bg-accent-wash hover:text-ink`
	 * and `cursor-default` suppresses the cursor but not the colour step. So a
	 * dead control lit up under the pointer exactly like a live one, and the
	 * only thing distinguishing them in the entire rendered state was a tooltip
	 * string nobody has a reason to go looking for. `ink-dim` against the
	 * editable chip's `ink-muted` is the colour step branding.md asks for
	 * (disabled changes colour, never opacity), and with no hover classes the
	 * chip now stays put under the cursor, which is the honest signal.
	 *
	 * `tabIndex={0}` keeps it reachable so a keyboard user can read the reason,
	 * and `aria-disabled` tells assistive tech what the colour tells everyone
	 * else. The accessible name carries the PATH with the reason as its
	 * description: naming it after the rule told a screen-reader user why they
	 * could not change the value without ever telling them the value.
	 */
	if (!editable) {
		return (
			<div
				className={cn(CHIP_WRAPPER)}
				data-lo-cwd-chip="readonly"
				data-lo-cwd-path={currentWorkingDirectory || ""}
			>
				<Tooltip content={readOnlyReason ?? shown} side="right">
					{/*
					 * A real `button` with `aria-disabled`, and deliberately NOT the
					 * `Button` primitive.
					 *
					 * The primitive's `ghost` variant carries `hover:bg-accent-wash
					 * hover:text-ink` and matching `active:` steps, which is what made
					 * this chip byte-identical to the editable one at rest AND light up
					 * under the pointer exactly like a live control - a dead control
					 * advertising an interaction it does not have. Plain classes here
					 * give the same box with no hover promise.
					 *
					 * `aria-disabled` rather than `disabled`: this is a control that
					 * exists and cannot be used, and unlike the real attribute it keeps
					 * the element focusable, so a keyboard user can still reach the
					 * tooltip that explains why.
					 */}
					<button
						type="button"
						aria-disabled="true"
						aria-label={`Working directory: ${shown}`}
						// The reason is a DESCRIPTION, not the name: naming the chip
						// after the rule told a screen-reader user why they could not
						// change the directory without ever telling them what it is.
						// `aria-describedby` against a real node rather than
						// `aria-description`, which is ARIA 1.3 and not yet valid here.
						aria-describedby={readOnlyReason ? reasonId : undefined}
						className={cn(CHIP_BOX, "cursor-default text-ink-dim")}
					>
						<FolderOpen aria-hidden="true" className={cn("size-4 shrink-0")} />
						<span className={cn(CHIP_LABEL)}>Working directory:</span>
						<span className={cn("min-w-0 truncate", PATH_TYPE)}>{shown}</span>
					</button>
				</Tooltip>
				{readOnlyReason && (
					<span id={reasonId} className={cn("sr-only")}>
						{readOnlyReason}
					</span>
				)}
			</div>
		);
	}

	/*
	 * Not set. Reachable again: the composer used to gate this whole component
	 * on a truthy cwd, so this branch was dead code behind exactly the kind of
	 * unsatisfiable condition the chip was restored to remove. It is now the
	 * affordance a user lands on if the staged directory is ever empty, which
	 * is what makes an empty cwd recoverable from inside the app.
	 */
	if (!currentWorkingDirectory && !isEditing) {
		return (
			<div className={cn(CHIP_WRAPPER)} data-lo-cwd-chip="unset">
				<Tooltip content="Click to set the working directory" side="right">
					<Button
						ref={triggerRef}
						variant="ghost"
						size="md"
						className={cn(CHIP_BOX_INTERACTIVE)}
						onClick={handleStartEdit}
						aria-label="Set working directory"
					>
						<Folder aria-hidden="true" />
						No working directory set
					</Button>
				</Tooltip>
			</div>
		);
	}

	return (
		<div
			className={cn(CHIP_WRAPPER)}
			data-lo-cwd-chip="editable"
			data-lo-cwd-path={currentWorkingDirectory || ""}
			data-lo-cwd-invalid={isInvalid || undefined}
		>
			{/*
			 * The commit is announced rather than toasted. A toast for a setting
			 * the user just watched change is noise for a sighted user, but the
			 * change was reaching NOBODY on the assistive path - the chip's text
			 * updating is not an announcement. Polite, so it waits for a gap
			 * rather than interrupting.
			 */}
			{/* `<output>` rather than a span with role="status": it carries the same
			 * implicit live-region semantics as a native element, which is the form
			 * this codebase already uses for the composer's loading region. */}
			<output className={cn("sr-only")} aria-live="polite">
				{announcement}
			</output>
			{isEditing ? (
				<Input
					ref={inputRef}
					value={directory}
					onChange={(e) => setDirectory(e.target.value)}
					onKeyDown={handleKeyPress}
					onBlur={handleCancelEdit}
					placeholder="Enter directory path"
					aria-label="Working directory path"
					className={cn("w-64", PATH_TYPE)}
				/>
			) : (
				<DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
					<Tooltip
						content={
							isInvalid
								? `${shown} is not a directory on this computer`
								: truncates
									? shown
									: "Click to change the working directory"
						}
						side="right"
					>
						<DropdownMenuTrigger asChild>
							<Button
								ref={triggerRef}
								variant="ghost"
								size="md"
								className={cn(
									CHIP_BOX_INTERACTIVE,
									// Danger ink, not a danger border: the chip has no edge of
									// its own, so colour is the only channel available, and
									// § 6 puts state changes in colour rather than opacity.
									isInvalid && "text-danger hover:text-danger",
								)}
								aria-label={`Working directory: ${shown}`}
								aria-invalid={isInvalid || undefined}
							>
								<FolderOpen aria-hidden="true" />
								<span className={cn(CHIP_LABEL)}>Working directory:</span>
								<span className={cn("min-w-0 truncate", PATH_TYPE)}>
									{shown}
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
										className={cn("group")}
										onClick={() => handleSelectDirectory(path)}
										aria-current={
											path === currentWorkingDirectory ? "true" : undefined
										}
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
										{/*
										 * The prune affordance. A recents list is a suggestion
										 * surface, so an entry that is no longer wanted costs
										 * attention on every later open; with no way to remove
										 * one, a single stale path was permanent. Revealed on
										 * hover and on keyboard focus - `group-focus-within`, not
										 * `group-hover` alone, or the control would exist only
										 * for pointer users.
										 */}
										<button
											type="button"
											aria-label={`Remove ${formatted} from recent directories`}
											className={cn(
												"ml-auto shrink-0 rounded-xs p-0.5 text-ink-dim opacity-0 transition-colors duration-fast",
												"group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
												"hover:text-ink",
											)}
											onClick={(e) => {
												// The row itself commits a directory; removing one
												// must not also select it.
												e.stopPropagation();
												removeRecentDirectory(path);
											}}
										>
											<X aria-hidden="true" className={cn("size-3.5")} />
										</button>
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
