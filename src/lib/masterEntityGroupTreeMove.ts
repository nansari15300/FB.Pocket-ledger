import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import type { Company } from "@/hooks/useCompany";
import type { MasterEntityGroupFormPreset } from "@/lib/masterEntityGroupFormPresets";
import { getCompanyDocFromBrowserDb, upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";
import { enqueueCompanyDocOutbox } from "@/lib/localVoucherOutbox";
import { apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import {
  isMasterEntitySystemGroupId,
} from "@/lib/masterEntitySystemGroups";
import type { MasterGroupListConfig, MasterGroupListRow } from "@/lib/masterGroupListTree";
import {
  isMasterGroupAncestorOf,
  resolveMasterGroupBranchForGroup,
} from "@/lib/masterGroupListTree";
import { isSystemParentGroup, type SystemGroupCollection } from "@/lib/system-groups";
import { LOAN_UNGROUPED_UI_ID } from "@/modules/loans/constants/loanConstants";

export type MasterEntityGroupTreeRow = {
  id: string;
  name?: string;
  parentId?: string | null;
  companyId?: string;
  isSystemReserved?: boolean;
  isAutoUngrouped?: boolean;
  isReportOnly?: boolean;
};

function asMasterGroupListRows(groups: MasterEntityGroupTreeRow[]): MasterGroupListRow[] {
  return groups.map((group) => ({ ...group, name: group.name ?? "" }));
}

export function canMoveMasterEntityUserGroup(
  group: MasterEntityGroupTreeRow | null | undefined,
  preset: MasterEntityGroupFormPreset
): boolean {
  if (!group?.id) return false;
  if (group.isSystemReserved === true) return false;
  if (group.isReportOnly === true) return false;
  if (group.isAutoUngrouped === true) return false;
  if (group.id === "ungrouped" || group.id === LOAN_UNGROUPED_UI_ID) return false;
  if (isMasterEntitySystemGroupId(preset, group.id)) return false;
  const collection = preset.collection as SystemGroupCollection;
  if (isSystemParentGroup(collection, group.id)) return false;
  return true;
}

/** Drop target → stored parentId for the moved group. */
export function resolveMasterEntityGroupMoveParentId(
  targetListGroupId: string,
  config: MasterGroupListConfig
): string {
  const target = String(targetListGroupId || "").trim();
  if (config.branches.some((branch) => branch.id === target)) return target;
  return target;
}

export function masterEntityGroupAlreadyUnderMoveTarget(
  group: MasterEntityGroupTreeRow,
  targetListGroupId: string,
  allGroups: MasterEntityGroupTreeRow[],
  config: MasterGroupListConfig
): boolean {
  const nextParentId = resolveMasterEntityGroupMoveParentId(targetListGroupId, config);
  const currentParentId = String(group.parentId || "").trim();
  if (currentParentId === nextParentId) return true;
  const branch = config.branches.find((b) => b.id === targetListGroupId);
  if (branch && !currentParentId) {
    const listRows = asMasterGroupListRows(allGroups);
    const resolvedBranch = resolveMasterGroupBranchForGroup(
      { ...group, name: group.name ?? "" },
      listRows,
      config
    );
    return resolvedBranch === branch.id;
  }
  return false;
}

export function createMasterEntityGroupTreeMoveHelpers(preset: MasterEntityGroupFormPreset) {
  function isInvalidGroupDropTarget(
    sourceGroupId: string,
    targetListGroupId: string,
    allGroups: MasterEntityGroupTreeRow[],
    config: MasterGroupListConfig
  ): boolean {
    const source = String(sourceGroupId || "").trim();
    const target = String(targetListGroupId || "").trim();
    if (!source || !target) return true;
    if (source === target) return true;
    if (isMasterGroupAncestorOf(source, target, asMasterGroupListRows(allGroups), config)) return true;
    const targetGroup = allGroups.find((g) => g.id === target);
    if (targetGroup && !canMoveMasterEntityUserGroup(targetGroup, preset)) {
      return !config.branches.some((branch) => branch.id === target);
    }
    return false;
  }

  return {
    preset,
    canMoveGroup(group: MasterEntityGroupTreeRow) {
      return canMoveMasterEntityUserGroup(group, preset);
    },
    isInvalidGroupDropTarget,
    async moveGroupToTarget(args: {
      companyId: string;
      company: Company | null | undefined;
      sourceGroupId: string;
      targetListGroupId: string;
      allGroups: MasterEntityGroupTreeRow[];
      config: MasterGroupListConfig;
    }): Promise<void> {
      const { companyId, company, sourceGroupId, targetListGroupId, allGroups, config } = args;
      const group = allGroups.find((g) => g.id === sourceGroupId);
      if (!group || !canMoveMasterEntityUserGroup(group, preset)) return;
      if (isInvalidGroupDropTarget(sourceGroupId, targetListGroupId, allGroups, config)) {
        return;
      }
      if (masterEntityGroupAlreadyUnderMoveTarget(group, targetListGroupId, allGroups, config)) {
        return;
      }

      const parentId = resolveMasterEntityGroupMoveParentId(targetListGroupId, config);
      const localSqlMirror = apkEntityWriteUsesLocalSqliteMirror(company);

      if (localSqlMirror) {
        const fromDb = await getCompanyDocFromBrowserDb(
          companyId,
          preset.collection,
          sourceGroupId
        );
        const payload = {
          ...(fromDb ?? { id: sourceGroupId, companyId, name: group.name }),
          id: sourceGroupId,
          companyId,
          parentId,
        };
        await upsertCompanyDocInBrowserDb(companyId, preset.collection, sourceGroupId, payload);
        await enqueueCompanyDocOutbox(
          companyId,
          preset.collection,
          "update",
          sourceGroupId,
          payload
        );
        return;
      }

      await updateDoc(doc(firestore, `companies/${companyId}/${preset.collection}`, sourceGroupId), {
        parentId,
      });
    },
  };
}
