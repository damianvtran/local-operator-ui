/**
 * Page Header Component
 * 
 * A consistent header component for pages with customizable icon, title, and optional subtitle.
 */

import React from 'react';
import type { FC, ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

type PageHeaderProps = {
  /**
   * The title of the page
   */
  title: string;
  
  /**
   * FontAwesome icon to display next to the title
   */
  icon: IconDefinition;
  
  /**
   * Optional subtitle text to display below the header
   */
  subtitle?: string;
  
  /**
   * Optional additional content to render below the title
   */
  children?: ReactNode;
};

/**
 * Page Header Component
 * 
 * Provides consistent styling for page headers across the application
 * with customizable icon, title, and optional subtitle.
 */
export const PageHeader: FC<PageHeaderProps> = ({ 
  title, 
  icon, 
  subtitle,
  children 
}) => {
  return (
    <>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        mb: 1,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: 'divider'
      }}>
        <FontAwesomeIcon 
          icon={icon} 
          size="lg" 
          style={{ 
            marginRight: 16, 
            color: '#f2f2f3' 
          }} 
        />
        <Typography 
          variant="h4" 
          component="h1" 
          sx={{ 
            fontWeight: 700,
            letterSpacing: '-0.02em'
          }}
        >
          {title}
        </Typography>
      </Box>
      
      {subtitle && (
        <Typography 
          variant="subtitle1" 
          color="text.secondary" 
          sx={{ 
            mb: 3,
            maxWidth: '800px',
            lineHeight: 1
          }}
        >
          {subtitle}
        </Typography>
      )}
      
      {children}
    </>
  );
};
