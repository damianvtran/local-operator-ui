import { faFolder, faFolderOpen, faPen } from "@fortawesome/free-solid-svg-icons";
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
import { useState, useRef, useCallback, type FC } from "react";

/**
 * Props for the DirectoryIndicator component
 */
type DirectoryIndicatorProps = {
  /** The ID of the current agent */
  agentId: string;
  /** The current working directory of the agent */
  currentWorkingDirectory?: string;
};

/**
 * Default directories to offer as quick selections
 */
const DEFAULT_DIRECTORIES = [
  { name: "Home", path: "/Users/damiantran" },
  { name: "Downloads", path: "/Users/damiantran/Downloads" },
  { name: "Documents", path: "/Users/damiantran/Documents" },
  { name: "Desktop", path: "/Users/damiantran/Desktop" },
];

const DirectoryChip = styled(Chip)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.primary.main, 0.08),
  color: theme.palette.text.secondary,
  borderRadius: "14px",
  padding: "0 8px",
  height: "28px",
  maxWidth: "280px",
  transition: "all 0.2s ease",
  "& .MuiChip-label": {
    padding: "0 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.75rem",
  },
  "& .MuiChip-deleteIcon": {
    fontSize: "0.65rem",
    margin: "0 4px 0 -4px",
    color: alpha(theme.palette.text.primary, 0.5),
  },
  "& .MuiChip-icon": {
    fontSize: "0.75rem",
    margin: "0 -4px 0 4px",
    color: alpha(theme.palette.text.primary, 0.7),
  },
  "&:hover": {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    color: theme.palette.text.primary,
  },
}));

const DirectoryTextField = styled(TextField)(({ theme }) => ({
  "& .MuiInputBase-root": {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
    borderRadius: "16px",
    padding: "0 8px",
    height: "28px",
    fontSize: "0.8125rem",
    color: theme.palette.text.primary,
  },
  "& .MuiOutlinedInput-notchedOutline": {
    border: "none",
  },
  "& .MuiInputBase-input": {
    padding: "4px 8px",
  },
}));

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
  
  // Handle opening the directory menu
  const handleOpenMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  }, []);
  
  // Handle closing the directory menu
  const handleCloseMenu = useCallback(() => {
    setMenuAnchorEl(null);
  }, []);
  
  // Handle selecting a directory from the menu
  const handleSelectDirectory = useCallback((path: string) => {
    setDirectory(path);
    handleCloseMenu();
    
    // Update the agent's working directory
    updateAgent.mutate({
      agentId,
      update: {
        current_working_directory: path,
      } as AgentUpdate,
    });
  }, [agentId, updateAgent, handleCloseMenu]);
  
  // Handle starting to edit the directory
  const handleStartEdit = useCallback((event?: React.MouseEvent) => {
    // Stop propagation to prevent the menu from opening
    if (event) {
      event.stopPropagation();
    }
    
    // Close the menu if it's open
    setMenuAnchorEl(null);
    
    setIsEditing(true);
    // Focus the input after rendering
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
  }, []);
  
  // Handle finishing editing the directory
  const handleFinishEdit = useCallback(() => {
    setIsEditing(false);
    
    // Only update if the directory has changed
    if (directory !== currentWorkingDirectory) {
      updateAgent.mutate({
        agentId,
        update: {
          current_working_directory: directory,
        } as AgentUpdate,
      });
    }
  }, [agentId, directory, currentWorkingDirectory, updateAgent]);
  
  // Handle key press in the directory input
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleFinishEdit();
    } else if (e.key === "Escape") {
      setDirectory(currentWorkingDirectory || "");
      setIsEditing(false);
    }
  }, [handleFinishEdit, currentWorkingDirectory]);
  
  // Format the directory for display
  const formatDirectory = (dir: string) => {
    // Replace home directory with ~
    if (dir.startsWith("/Users/damiantran")) {
      return dir.replace("/Users/damiantran", "~");
    }
    return dir;
  };
  
  // If no directory is set, show a placeholder
  if (!currentWorkingDirectory && !isEditing) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", ml: 1 }}>
        {/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
        <Tooltip title="Set working directory" arrow placement="bottom">
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
          {/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
          <Tooltip title="Change working directory" arrow placement="bottom">
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
                <FontAwesomeIcon 
                  icon={faFolder} 
                  size="sm" 
                  style={{ marginRight: "8px", opacity: 0.7 }} 
                />
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
