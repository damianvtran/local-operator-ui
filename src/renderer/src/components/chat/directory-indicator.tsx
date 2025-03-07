import { 
  faFolder, 
  faFolderOpen, 
  faPen,
  faHome,
  faDownload,
  faFileAlt,
  faDesktop,
  faImage,
  faMusic,
  faVideo,
  faLaptop,
  faServer,
  faDatabase,
  faUsers,
  faArchive,
  faBook,
  faHdd,
  faNetworkWired,
  faBoxOpen,
  faBox
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  Box,
  Chip,
  ClickAwayListener,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import type { AgentUpdate } from "@renderer/api/local-operator/types";
import { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import { useState, useRef, useCallback, useEffect, type FC } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

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
  icon: IconDefinition;
};

/**
 * Maps directory names to appropriate FontAwesome icons
 */
const getDirectoryIcon = (name: string, path: string): IconDefinition => {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();

  if (name === "Home" || path === "~") return faHome;
  if (lowerName.includes("download")) return faDownload;
  if (lowerName.includes("document")) return faFileAlt;
  if (lowerName.includes("desktop")) return faDesktop;
  if (lowerName.includes("picture")) return faImage;
  if (lowerName.includes("music")) return faMusic;
  if (lowerName.includes("video")) return faVideo;
  if (lowerName.includes("program")) return faLaptop;
  if (lowerName.includes("user")) return faUsers;
  if (lowerPath.includes("programdata")) return faDatabase;
  if (lowerName.includes("application")) return faBoxOpen;
  if (lowerName.includes("library")) return faBook;
  if (lowerName.includes("volume")) return faHdd;
  if (lowerName.includes("etc")) return faServer;
  if (lowerName.includes("usr")) return faUsers;
  if (lowerName.includes("var")) return faDatabase;
  if (lowerName.includes("opt")) return faBox;
  if (lowerName.includes("mnt")) return faHdd;
  if (lowerName.includes("media")) return faArchive;
  if (lowerName.includes("srv")) return faNetworkWired;

  return faFolder;
};

/**
 * Default directories to offer as quick selections based on OS
 */
const DEFAULT_DIRECTORIES: DirectoryInfo[] = [
  { name: "Home", path: "~", icon: faHome },
  { name: "Downloads", path: "~/Downloads", icon: faDownload },
  { name: "Documents", path: "~/Documents", icon: faFileAlt },
  { name: "Desktop", path: "~/Desktop", icon: faDesktop },
  { name: "Pictures", path: "~/Pictures", icon: faImage },
  { name: "Music", path: "~/Music", icon: faMusic },
  { name: "Videos", path: "~/Videos", icon: faVideo },
  ...(navigator.userAgent.indexOf("Win") !== -1 ? [
    { name: "Program Files", path: "C:\\Program Files", icon: faLaptop },
    { name: "Program Files (x86)", path: "C:\\Program Files (x86)", icon: faLaptop },
    { name: "Users", path: "C:\\Users", icon: faUsers },
    { name: "ProgramData", path: "C:\\ProgramData", icon: faDatabase }
  ] : navigator.userAgent.indexOf("Mac") !== -1 ? [
    { name: "Applications", path: "/Applications", icon: faBoxOpen },
    { name: "Library", path: "~/Library", icon: faBook },
    { name: "Users", path: "/Users", icon: faUsers },
    { name: "Volumes", path: "/Volumes", icon: faHdd }
  ] : [
    { name: "etc", path: "/etc", icon: faServer },
    { name: "usr", path: "/usr", icon: faUsers },
    { name: "var", path: "/var", icon: faDatabase },
    { name: "opt", path: "/opt", icon: faBox },
    { name: "mnt", path: "/mnt", icon: faHdd },
    { name: "media", path: "/media", icon: faArchive },
    { name: "srv", path: "/srv", icon: faNetworkWired }
  ]).map(dir => ({
    ...dir,
    icon: getDirectoryIcon(dir.name, dir.path)
  }))
];

const DirectoryChip = styled(Chip)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.primary.main, 0.06),
  color: theme.palette.text.secondary,
  borderRadius: "16px",
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
    backgroundColor: alpha(theme.palette.background.default, 0.9),
    borderRadius: "12px",
    padding: "0 6px",
    height: "24px",
    fontSize: "0.75rem",
    color: theme.palette.text.primary,
    boxShadow: `0 2px 4px ${alpha(theme.palette.common.black, 0.1)}`,
  },
  "& .MuiOutlinedInput-notchedOutline": {
    border: "none",
  },
  "& .MuiInputBase-input": {
    padding: "3px 6px",
    "&::placeholder": {
      fontSize: "0.7rem",
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
  const inputRef = useRef<HTMLInputElement>(null);
  const updateAgent = useUpdateAgent();

  useEffect(() => {
    setDirectory(currentWorkingDirectory || "");
  }, [currentWorkingDirectory]);
  
  const handleOpenMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  }, []);
  
  const handleCloseMenu = useCallback(() => {
    setMenuAnchorEl(null);
  }, []);
  
  const handleSelectDirectory = useCallback((path: string) => {
    setDirectory(path);
    handleCloseMenu();
    
    updateAgent.mutate({
      agentId,
      update: {
        current_working_directory: path,
      } as AgentUpdate,
    });
  }, [agentId, updateAgent, handleCloseMenu]);
  
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
      updateAgent.mutate({
        agentId,
        update: {
          current_working_directory: directory,
        } as AgentUpdate,
      });
    }
  }, [agentId, directory, currentWorkingDirectory, updateAgent]);
  
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleFinishEdit();
    } else if (e.key === "Escape") {
      setDirectory(currentWorkingDirectory || "");
      setIsEditing(false);
    }
  }, [handleFinishEdit, currentWorkingDirectory]);
  
  const formatDirectory = (dir: string) => {
    if (dir.startsWith("/Users/damiantran")) {
      return dir.replace("/Users/damiantran", "~");
    }
    return dir;
  };
  
  if (!currentWorkingDirectory && !isEditing) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", ml: 1 }}>
        <Tooltip title="Set working directory" arrow placement="right">
          <DirectoryChip
            icon={<FontAwesomeIcon icon={faFolder} size="sm" />}
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
          <Tooltip title="Change working directory" arrow placement="right">
            <DirectoryChip
              icon={<FontAwesomeIcon icon={faFolderOpen} size="sm" />}
              label={formatDirectory(currentWorkingDirectory || "")}
              onClick={handleOpenMenu}
              clickable
              deleteIcon={
                <FontAwesomeIcon icon={faPen} size="2xs" />
              }
              onDelete={(e) => {
                e.stopPropagation();
                handleStartEdit();
              }}
            />
          </Tooltip>
          
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
                backgroundColor: (theme) => alpha(theme.palette.background.default, 0.95),
                boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)",
                backdropFilter: "blur(10px)",
                "& .MuiMenuItem-root": {
                  borderRadius: "4px",
                  margin: "2px 4px",
                  "&:hover": {
                    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.15),
                  },
                },
                "& .MuiDivider-root": {
                  margin: "4px 0",
                  borderColor: "rgba(255,255,255,0.1)",
                },
              },
            }}
          >
            <MenuItem 
              onClick={(e) => {
                e.stopPropagation();
                handleStartEdit();
                handleCloseMenu();
              }} 
              dense
            >
              <Typography variant="body2">Custom directory...</Typography>
            </MenuItem>
            
            {DEFAULT_DIRECTORIES.map((dir) => (
              <MenuItem 
                key={dir.path} 
                onClick={() => handleSelectDirectory(dir.path)}
                dense
              >
                <MenuItemIcon>
                  <FontAwesomeIcon icon={dir.icon} size="sm" />
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
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
};
