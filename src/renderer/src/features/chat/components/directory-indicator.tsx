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
	/**
	 * A move is in flight for THIS session: the chip is painting a directory the
	 * backend has not confirmed yet.
	 *
	 * The chip gains no new visual state from this - no spinner, no colour step -
	 * and the reason is that the transcript receipt is the primary feedback while
	 * the chip repaints from the canonical stream within a couple of seconds. What
	 * it does gain is honest copy while it is showing a value nothing has
	 * confirmed: the tooltip says what is happening, and the live region says it
	 * too, so the change is announced rather than only painted.
	 */
	pending?: boolean;
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
 * How long the chip says WHERE a move is going before it says what the move does.
 *
 * About 600 ms, which is roughly where the optimistic path stops being news:
 * "Moving to ~/x" is true the instant the user chose, and it is no longer the
 * useful fact once the wait is long enough to wonder about - at that point what
 * the user is waiting on is that this session's runtime is being replaced. Past
 * the second sentence there is nothing more to say until the backend answers, so
 * it stays up rather than cycling through a third phrase.
 */
const PENDING_RESTART_AFTER_MS = 600;

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
 *
 * `shrink` alongside `min-w-0`: a flex item's floor is its CONTENT, not zero,
 * so `min-w-0` alone only permits shrinking below that floor -- it does not
 * make this item yield when the row is over budget. With the canvas panel open
 * the chat column collapses to its 220px floor, and without `shrink` the chip
 * kept its full width and hung 97px past the column's right edge, clipped
 * mid-path (design round 2, D11).
 */
const CHIP_WRAPPER =
	"ml-2 flex min-w-0 shrink items-center @min-[750px]/chatcol:shrink-0";

/**
 * The chip at the composer's own floor: the glyph, and nothing else.
 *
 * Below `CHAT_CHIP_ICON_ONLY_PX` (240) of column the chip's 96px floor and the
 * session's readings cannot
 * share the row. Measured at the 220px floor (the canvas-open column): the row
 * is 202px, the readings take their own line, and the button line then needs
 * 28 + 12 + 96 + 8 + 60 = 204 of it - two pixels over, so the controls broke to
 * a THIRD line and the composer grew from the 143.5px it had before the
 * readings moved into the row to 179.5px (design round 1, D1). One of the four
 * things on that line has to give up width, and the chip is the only one whose
 * content exists somewhere else: the path stays in the tooltip, in the
 * `aria-label` and in the menu, while a reading has no second place to be.
 *
 * 240 is measured, not chosen. The full form first fits at ~222 (row = container
 * - 18 below 750, so 220 -> 202 and 272 -> 254), and 240 leaves ~18px of slack
 * there plus room for the 28px `icon-sm` control step below 550. The icon form
 * measures 44px, leaving ~50px of slack at the floor.
 *
 * `min-w-11` overrides the 96px `min-w-24` floor rather than sitting beside it:
 * the floor exists to keep truncation meaningful, and at this width the chip is
 * not truncating, it is yielding.
 */
const CHIP_FLOOR =
	"@max-[240px]/chatcol:w-11 @max-[240px]/chatcol:min-w-11 @max-[240px]/chatcol:justify-center @max-[240px]/chatcol:px-0";

/**
 * The chip's two text spans at that floor.
 *
 * `sr-only` and never `hidden`: the spans keep their place in the accessibility
 * tree, so a screen-reader user still hears "Working directory: /Users/damian"
 * and only the pixels change. `hidden` would strip the chip of the value it is
 * named after.
 */
const CHIP_TEXT_AT_FLOOR = "@max-[240px]/chatcol:sr-only";

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
 *
 * `max-w-65` is a CEILING, not a width: it caps the chip on a wide toolbar and
 * says nothing about a narrow one. `min-w-0 shrink` is what makes the ceiling
 * yield to a column narrower than it, so the path truncates AT the panel edge
 * rather than past it.
 *
 * `min-w-24` is the FLOOR that keeps truncation meaningful. Shrinking is only
 * an improvement while some of the path survives: with `min-w-0` alone the
 * chip collapsed to 46px in the canvas-open column, at which point the path
 * span was ellipsised to ZERO width and the control showed a folder glyph and
 * nothing else. A chip that has shrunk out of its own content is not more
 * honest than one that overhangs -- it just fails quietly instead of loudly.
 * 96px keeps a readable leading fragment plus the ellipsis, and the full path
 * stays reachable through the chip's `aria-label` and its menu.
 */
const CHIP_BOX = cn(
	"inline-flex h-8 max-w-65 min-w-24 shrink items-center gap-1.5 rounded-sm px-3 text-body-sm",
	CHIP_FLOOR,
);
/**
 * The same box for the two states that really are buttons.
 *
 * `cursor-pointer`, unlike the read-only chip's `cursor-default`: this is a
 * live menu trigger, and the pointer is the one affordance it carries at
 * rest besides the tooltip — its hover fill is the shared `accent-wash`, too
 * faint to carry the affordance alone (design round 3, D15). The app's
 * convention is not "buttons never take a pointer": interactive rows
 * (attachments, canvas variable rows) take `cursor-pointer` and inert rows
 * (the read-only chip, slash-popup rows) take `cursor-default`, and a
 * control that opens a menu is in the first group.
 *
 * `w-fit` matters: without it the button stretched to its `max-w-65` and the
 * `justify-start` content sat against a wide empty remainder, which is what
 * put ~34px between the glyph and the path inside ONE control while the gap
 * to the attach button beside it was 10px. § 5 asks for the space inside a
 * pair to be visibly tighter than the space around it; shrink-wrapping the
 * box is what makes the 6px gap the eye actually sees.
 */
const CHIP_BOX_INTERACTIVE = cn(
	"w-fit max-w-65 min-w-24 shrink cursor-pointer justify-start gap-1.5",
	CHIP_FLOOR,
);
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
const CHIP_LABEL = cn(
	"hidden shrink-0 whitespace-nowrap text-ink-muted @min-[620px]/chatcol:inline",
	// See `CHIP_FLOOR`: the word is already `hidden` below 620px, so this only
	// states the rule at the floor rather than relying on one breakpoint being
	// narrower than the other.
	CHIP_TEXT_AT_FLOOR,
);

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
	pending = false,
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

	/*
	 * The pending chip's two sentences, escalated on a timer.
	 *
	 * State rather than a derived value because the escalation is the only thing
	 * that makes this chip's copy time-dependent, and it has to reset when a new
	 * move starts (a second move must not open on "Restarting…" from the first).
	 * See `PENDING_RESTART_AFTER_MS` for why the second sentence replaces the
	 * first rather than joining it.
	 */
	const [pendingRestarting, setPendingRestarting] = useState(false);
	useEffect(() => {
		if (!pending) {
			setPendingRestarting(false);
			return;
		}
		const timer = setTimeout(
			() => setPendingRestarting(true),
			PENDING_RESTART_AFTER_MS,
		);
		return () => clearTimeout(timer);
	}, [pending]);

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
	 * What the chip says while a move it has asked for has not been confirmed.
	 *
	 * `null` the rest of the time, so every consumer below reads one value instead
	 * of re-deriving the two sentences. The tooltip and the live region both use
	 * it: the transcript receipt is the primary feedback, but the chip is showing a
	 * directory nothing has confirmed yet, and a silent pending value is how a user
	 * comes to believe a move landed when it did not.
	 */
	const pendingText = pending
		? pendingRestarting
			? "Restarting this session's runtime…"
			: `Moving to ${shown}…`
		: null;

	/*
	 * Read-only: show the directory and say why it cannot be changed HERE.
	 *
	 * The reason is no longer always "a cwd cannot be moved". A live session CAN be
	 * moved when the backend advertises `session_move` (`sessions.move`, the route
	 * `/move` uses on both surfaces); what this branch renders is the case where
	 * that capability is absent, or where the caller has no write path of its own
	 * to offer. Both are real: the create-file dialog holds a session id rather
	 * than an agent UUID, so it mounts this chip read-only rather than owning a
	 * second write path that 404s, and a renderer talking to a backend without the
	 * route must keep the read-only chip it has always rendered - which is exactly
	 * what the capability negotiation is for.
	 *
	 * Stating the reason in a tooltip is the honest version of that, and
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
				<Tooltip content={readOnlyReason ?? shown} side="top">
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
						<span
							className={cn("min-w-0 truncate", PATH_TYPE, CHIP_TEXT_AT_FLOOR)}
						>
							{shown}
						</span>
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
				<Tooltip content="Click to set the working directory" side="top">
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
				{pendingText ?? announcement}
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
							// A move in flight speaks first: it is the thing the user just did,
							// and "Click to change the working directory" would invite a second
							// move while the first is still being applied.
							pendingText ??
							(isInvalid
								? `${shown} is not a directory on this computer`
								: truncates
									? shown
									: "Click to change the working directory")
						}
						side="top"
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
								<span
									className={cn(
										"min-w-0 truncate",
										PATH_TYPE,
										CHIP_TEXT_AT_FLOOR,
									)}
								>
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
