import { Menu, MenuItem, IconButton, Tooltip } from "@mui/material";
import { File as FileIcon, FolderOpen, EllipsisVertical } from "lucide-react";
import { useState, type MouseEvent } from "react";

/**
 * Props for FileActionsMenu
 */
export type FileActionsMenuProps = {
  /**
   * The file path or URI to act on.
   */
  filePath: string;
  /**
   * Optional: placement for the tooltip or menu trigger.
   */
  tooltip?: string;
  /**
   * Optional: icon to use for the trigger (defaults to MoreVert).
   */
  icon?: React.ReactNode;
  /**
   * Optional: aria-label for accessibility.
   */
  "aria-label"?: string;
};

/**
 * FileActionsMenu provides actions to open a file or its location in the OS.
 * Uses Electron's window.api.openFile and window.api.showItemInFolder.
 */
export const FileActionsMenu = ({
  filePath,
  tooltip = "File actions",
  icon,
  "aria-label": ariaLabel = "File actions",
}: FileActionsMenuProps) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleOpenMenu = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
  };

  const handleOpenFile = () => {
    handleCloseMenu();
    if (filePath) {
      window.api.openFile(filePath);
    }
  };

  return (
    <>
      <Tooltip title={tooltip} arrow>
        <IconButton
          size="small"
          onClick={handleOpenMenu}
          aria-label={ariaLabel}
          sx={{ ml: 0.5 }}
        >
          {icon ?? <EllipsisVertical size={14} />}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleOpenFile}>
          <FileIcon size={16} style={{ marginRight: 8 }} />
          Open File
        </MenuItem>
        <MenuItem onClick={() => { handleCloseMenu(); window.api.showItemInFolder(filePath); }}>
          <FolderOpen size={16} style={{ marginRight: 8 }} />
          Open Folder
        </MenuItem>
      </Menu>
    </>
  );
};
