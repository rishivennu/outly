/**
 * 1163: the admin component kit under one roof. The names match the brief for the panel overhaul; the files behind
 * them are the primitives the pages already used, so nothing was duplicated. Import from here in new admin code.
 *
 *   AdminPageHeader   title, lead, actions at the top of every page           (ui.tsx PageHead)
 *   AdminCard         the .admin-card surface; tone "flat" (inside a card) | "float" (over media), interactive  (ui.tsx Card, R1275)
 *   AdminSidebar      the shell: nav groups, slim mode, drawer, account        (AdminShell.tsx)
 *   AdminMetricCard   a KPI with comparison period, definition and states      (motion/AdminKpi.tsx)
 *   AdminSection      titled region with a responsive grid                     (ui.tsx Section)
 *   AdminFilterBar    filters left, source/range/timezone/updated right        (FilterBar.tsx)
 *   AdminDateRangePicker  7/30/90 chips plus optional custom from/to           (FilterBar.tsx)
 *   AdminChartCard    chart with table view and a real empty state             (ChartCard.tsx)
 *   AdminDataTable    the table that becomes labelled cards on phones          (ui.tsx Table)
 *   AdminStatusBadge  one status vocabulary                                    (ui.tsx StatusBadge)
 *   AdminEmptyState / AdminLoadingState / AdminErrorState                      (ui.tsx)
 *   AdminConfirmDialog  the shared Radix confirm                               (components/shared/ConfirmDialog)
 *   AdminTooltip / AdminHint                                                   (ui.tsx)
 *   statusOf          raw database value to a STATUS_LABEL key                 (ui.tsx, R1270)
 *   AdminPagination   Previous / "1-25 of 300" / Next from ?page=&limit=       (Pagination.tsx, R1270)
 *   pageWindow / readPaging  the same arithmetic for server pages             (page-window.ts, R1270)
 *   Switch / SwitchRow  the Settings lime switch, alone or as a labelled row   (Switch.tsx, R1270)
 *   SearchBox / FilterChips / FilterSelect / DateFilter / MoreFilters          (SearchBox.tsx)
 *   SearchInput       a local (not URL) search field                           (SearchInput.tsx)
 *   RefreshButton     re-read the list without a reload                        (RefreshButton.tsx)
 */
export { PageHead as AdminPageHeader, Card as AdminCard, CardTitle as AdminCardTitle, Section as AdminSection, Table as AdminDataTable, StatusBadge as AdminStatusBadge, STATUS_LABEL, Empty as AdminEmptyState, LoadingState as AdminLoadingState, ErrorState as AdminErrorState, Unavailable as AdminUnavailable, Tooltip as AdminTooltip, Hint as AdminHint, Pill, tableMinWidth, fmtDate, ago, statusOf, type StatusEntry, type Tone } from "./ui";
export { Pagination as AdminPagination, Pagination } from "./Pagination";
export { pageWindow, readPaging, PAGE_LIMIT, type PageWindow } from "./page-window";
export { Switch, SwitchRow } from "./Switch";
export { SearchBox, FilterChips, FilterSelect, DateFilter, MoreFilters } from "./SearchBox";
export { SearchInput } from "./SearchInput";
export { RefreshButton } from "./RefreshButton";
export { AdminShell as AdminSidebar, NAV, NAV_GROUPS } from "./AdminShell";
export { AdminKpi as AdminMetricCard } from "./motion/AdminKpi";
export { AdminFilterBar, AdminDateRangePicker, ReportMeta, RANGE_OPTIONS } from "./FilterBar";
export { AdminChartCard } from "./ChartCard";
export { ConfirmDialog as AdminConfirmDialog } from "@/components/shared/ConfirmDialog";
