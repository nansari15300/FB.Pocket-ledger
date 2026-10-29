import { cn } from "@/lib/utils";
import { masterListUnselectedCn } from "@/lib/listSelectionChrome";
import { mlc } from "@/lib/mobileListChrome";

/** Master-detail list pane shell — Tax page screenshot / `TaxGroupList` jaisa. Soft mint parent chrome se aata hai. */
export const masterListShellCn =
  "pl-master-list-shell flex h-full min-h-0 min-w-0 w-full flex-col rounded-b-lg border-t-0 bg-transparent";

/** Scroll body — category groups (PartyGroupList); rows `pl-master-list-ul` se 2px inset */
export const masterListScrollBodyCn = "w-full min-w-0 space-y-2 pb-2";

/** PartyGroupList category header — cards jaisa dono taraf 2px (mlc.sectionLabelRow = px-2) */
export const masterListCategoryLabelCn = cn(
  mlc.sectionLabelRow,
  "px-[2px]"
);

/** `MasterListRow` par extra class — selected orange `MasterListRow` + Pro CSS se aata hai. */
export function masterListRowUnselectedCn(isSelected: boolean, extra?: string) {
  return cn(!isSelected && masterListUnselectedCn, extra);
}

/** Masters list profile — initials + icon ink (border jaisa green / IC blue). */
export const MASTER_LIST_PROFILE_INK_CN = "pl-master-list-profile-ink";

/** List row profile square — height matches name block; rounded corners via globals.css. */
export const MASTER_LIST_AVATAR_CN = "pl-master-list-avatar h-8 w-8 text-sm rounded-lg";
export const MASTER_LIST_AVATAR_FALLBACK_CN = cn(
  "pl-master-list-avatar-fallback",
  MASTER_LIST_PROFILE_INK_CN
);

/** List row group icon box — same green/blue as avatar; square rounded-md (border via globals.css, not Tailwind `.border`). */
export const MASTER_LIST_GROUP_ICON_CN = cn(
  "pl-master-list-group-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0",
  MASTER_LIST_PROFILE_INK_CN
);

/** Items tab list — Package icon passive + bada (group Boxes jaisa); box h-8 circle same. */
export const MASTER_LIST_ITEM_AVATAR_CN = cn(
  MASTER_LIST_AVATAR_CN,
  "pl-master-list-item-avatar",
  MASTER_LIST_PROFILE_INK_CN
);
