import { Menu, MenuItem, IconButton, Tooltip } from "@mui/material";
import { File as FileIcon, FolderOpen, MoreHorizontal, LayoutGrid } from "lucide-react";
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
   * Optional: icon to use for the trigger (defaults to MoreHorizontal).
   */
  icon?: React.ReactNode;
  /**
   * Optional: aria-label for accessibility.
   */
  "aria-label"?: string;
  /**
   * Optional: callback to show the file in the canvas.
   */
  onShowInCanvas?: (() => void) | undefined;
};

/**
 * FileActionsMenu provides actions to open a file, show in canvas, or its location in the OS.
 * Uses Electron's window.api.openFile and window.api.showItemInFolder.
 */
export const FileActionsMenu = ({
  filePath,
  tooltip = "File actions",
  icon,
  "aria-label": ariaLabel = "File actions",
  onShowInCanvas,
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

  const handleShowInCanvas = () => {
    handleCloseMenu();
    if (onShowInCanvas) {
      onShowInCanvas();
    }
  };

  // shadcn-like styles
  const menuPaperProps = {
    sx: {
      borderRadius: 2,
      minWidth: 180,
      boxShadow: "0px 8px 32px rgba(0,0,0,0.18)",
      fontFamily: '"Inter", system-ui, sans-serif',
      fontSize: "0.97rem",
      fontWeight: 500,
      p: 0.5,
      bgcolor: "background.paper",
      "& .MuiMenuItem-root": {
        borderRadius: 1,
        px: 2,
        py: 1.2,
        gap: 1.5,
        fontFamily: '"Inter", system-ui, sans-serif',
        fontWeight: 500,
        fontSize: "0.97rem",
        color: "text.primary",
        "& svg": {
          marginRight: 12,
          color: "text.secondary",
          width: 18,
          height: 18,
        },
        "&:active": {
          bgcolor: "action.selected",
        },
        "&:hover": {
          bgcolor: "action.hover",
        },
      },
    },
  };

  return (
    <>
      <Tooltip title={tooltip} arrow>
        <IconButton
          size="small"
          onClick={handleOpenMenu}
          aria-label={ariaLabel}
          sx={{
            ml: 0.5,
            borderRadius: 1.5,
            bgcolor: "background.paper",
            "&:hover": { bgcolor: "action.hover" },
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          {icon ?? <MoreHorizontal size={18} />}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={menuPaperProps}
        MenuListProps={{
          sx: {
            p: 0,
          },
        }}
      >
        {onShowInCanvas && (
          <MenuItem onClick={handleShowInCanvas}>
            <LayoutGrid size={18} style={{ marginRight: 12 }} />
            Show in Canvas
          </MenuItem>
        )}
        <MenuItem onClick={handleOpenFile}>
          <FileIcon size={18} style={{ marginRight: 12 }} />
          Open File
        </MenuItem>
        <MenuItem onClick={() => { handleCloseMenu(); window.api.showItemInFolder(filePath); }}>
          <FolderOpen size={18} style={{ marginRight: 12 }} />
          Open Folder
        </MenuItem>
      </Menu>
    </>
  );
};
