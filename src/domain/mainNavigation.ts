export const SIDEBAR_BREAKPOINT = 768;
export const SIDEBAR_EXPANDED_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 76;

export function usesSidebarNavigation(width: number): boolean {
  return Number.isFinite(width) && width >= SIDEBAR_BREAKPOINT;
}

export function sidebarNavigationWidth(expanded: boolean): number {
  return expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
}
