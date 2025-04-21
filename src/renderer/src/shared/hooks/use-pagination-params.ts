/**
 * Custom hook for working with pagination parameters in routes
 *
 * Provides utilities for accessing and updating pagination URL parameters
 */

import { useLocation, useSearchParams } from "react-router-dom";

/**
 * Hook for working with pagination parameters in routes
 *
 * @returns Object with page number and function to update it
 */
export const usePaginationParams = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const location = useLocation();

	/**
	 * Get the current page from URL search params
	 *
	 * @returns Current page number (defaults to 1)
	 */
	const getPage = (): number => {
		const pageParam = searchParams.get("page");
		return pageParam ? Number.parseInt(pageParam, 10) : 1;
	};

	/**
	 * Set the page parameter in the URL
	 *
	 * @param page - Page number to set
	 */
	const setPage = (page: number): void => {
		const newSearchParams = new URLSearchParams(searchParams);

		if (page === 1) {
			// Remove the page parameter if it's the default value
			newSearchParams.delete("page");
		} else {
			newSearchParams.set("page", page.toString());
		}

		// Preserve the current path and update only the search params
		setSearchParams(newSearchParams);
	};

	return {
		page: getPage(),
		setPage,
		// Helper to check if we're on a specific view
		isView: (view: string): boolean => location.pathname.startsWith(`/${view}`),
	};
};
