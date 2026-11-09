"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Plus, Trash2, Search, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  readInterCompanyLocalSettings,
  type InterCompanyLocalSettings,
} from "@/lib/interCompany/interCompanyLocalStore";
import {
  interCompanySettingsCardClass,
  interCompanyVoucherTabShellClass,
} from "@/lib/interCompany/interCompanyVoucherChrome";
import { cn } from "@/lib/utils";
import { InterCompanyJoinNotificationsInbox } from "@/components/inter-company/InterCompanyJoinNotificationsInbox";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import usePermissions from "@/hooks/usePermissions";
import type { InterCompanyPartnerFieldKey } from "@/lib/interCompany/interCompanyPartnerPrivacy";
import { InterCompanyPartnerPrivacySettings } from "@/components/inter-company/InterCompanyPartnerPrivacySettings";
import {
  assignCompanyToInterCompanyGroup,
  createInterCompanyGroup,
  deleteInterCompanyGroup,
  fetchInterCompanyUserProfileByUid,
  interCompanyGroupCreateErrorMessage,
  interCompanyGroupDeleteErrorMessage,
  interCompanyGroupRenameErrorMessage,
  isInterCompanySystemNameTaken,
  normalizeInterCompanySystemNameKey,
  renameInterCompanyGroup,
  resolveInterCompanyGroupOwnerUid,
  subscribeInterCompanyGroups,
  updateInterCompanyGroup,
  writeCompanyInterCompanyGroupId,
  type InterCompanyGroupDoc,
  type InterCompanyGroupVisibility,
} from "@/lib/interCompany/interCompanyGroups";
import {
  resetInterCompanyJoinLinks,
  saveInterCompanyJoinSettings,
  subscribeInterCompanyJoinSettings,
} from "@/lib/interCompany/interCompanyJoinSettingsSync";
import { collectInterCompanyMemberUsers } from "@/lib/interCompany/interCompanyGroupMembers";
import { buildCompanySummariesForIds } from "@/lib/interCompany/interCompanySystemCompaniesView";
import {
  addLinkedPublicInterCompanySystem,
  removeLinkedPublicInterCompanySystem,
  searchPublicInterCompanySystems,
  subscribeLinkedPublicInterCompanySystems,
} from "@/lib/interCompany/interCompanyPublicSystemLinks";
import { InterCompanySystemViewCompaniesDialog } from "@/components/inter-company/InterCompanySystemViewCompaniesDialog";
import { Badge } from "@/components/ui/badge";
import {
  subscribeIncomingSystemJoinRequests,
  subscribeAcceptedSystemJoinLinksForRequester,
  type IncomingSystemJoinRequest,
} from "@/lib/interCompany/interCompanySystemJoinRequest";

/** One-time reset after Join tab partner sections removed */
const JOIN_LINKS_RESET_MIGRATION_KEY = "pl-ic-join-sections-removed-reset-v1";

type Props = {
  companyId: string;
  onSettingsChange?: () => void;
};

function settingsEqual(a: InterCompanyLocalSettings, b: InterCompanyLocalSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Join tab — draft + Save; centralized systems. */
export function InterCompanyJoinSettingsPanel({ companyId, onSettingsChange }: Props) {
  const { user, customUser } = useAuth();
  const { allCompanies } = useCompany();
  const { can } = usePermissions();

  const canReadIc = can("inter_company_read") || can("inter_company_write");
  const canWriteIc = can("inter_company_write");

  const groupOwnerUid = useMemo(
    () => resolveInterCompanyGroupOwnerUid(user?.uid),
    [user?.uid]
  );

  /** System create/card — Firebase Auth displayName khali ho sakta hai; users doc (customUser) prefer */
  const sessionCreatorIdentity = useMemo(() => {
    const email =
      customUser?.email?.toLowerCase().trim() ||
      user?.email?.toLowerCase().trim() ||
      "";
    const displayName =
      customUser?.displayName?.trim() ||
      user?.displayName?.trim() ||
      (email.includes("@") ? email.split("@")[0] : "") ||
      "";
    return { email, displayName };
  }, [
    customUser?.email,
    customUser?.displayName,
    user?.email,
    user?.displayName,
  ]);

  const [draft, setDraft] = useState<InterCompanyLocalSettings>(() =>
    readInterCompanyLocalSettings(companyId)
  );
  const [saved, setSaved] = useState<InterCompanyLocalSettings>(() =>
    readInterCompanyLocalSettings(companyId)
  );
  const [groups, setGroups] = useState<InterCompanyGroupDoc[]>([]);
  const [savedGroupsJson, setSavedGroupsJson] = useState("[]");
  const [newGroupName, setNewGroupName] = useState("");
  const [newSystemVisibility, setNewSystemVisibility] =
    useState<InterCompanyGroupVisibility>("private");
  const [systemSearchQuery, setSystemSearchQuery] = useState("");
  const [viewSystemId, setViewSystemId] = useState<string | null>(null);
  const [linkedPublicSystems, setLinkedPublicSystems] = useState<InterCompanyGroupDoc[]>([]);
  const [publicSearchResults, setPublicSearchResults] = useState<InterCompanyGroupDoc[]>([]);
  const [searchingPublic, setSearchingPublic] = useState(false);
  const [linkingSystemId, setLinkingSystemId] = useState<string | null>(null);
  /** Linked/public cards — creator profile jab group doc me missing ho */
  const [ownerProfilesByUid, setOwnerProfilesByUid] = useState<
    Record<string, { email?: string; displayName?: string }>
  >({});
  const [renamingSystemId, setRenamingSystemId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [incomingSystemJoinRequests, setIncomingSystemJoinRequests] = useState<
    IncomingSystemJoinRequest[]
  >([]);
  const viewSystem = useMemo(() => {
    const all = [...groups, ...linkedPublicSystems];
    return all.find((g) => g.id === viewSystemId) ?? null;
  }, [groups, linkedPublicSystems, viewSystemId]);
  const [companyGroupId, setCompanyGroupId] = useState<string | null>(null);
  const [savedCompanyGroupId, setSavedCompanyGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const savedSettingsRef = useRef(saved);
  const savedCompanyGroupIdRef = useRef(savedCompanyGroupId);

  useEffect(() => {
    savedSettingsRef.current = saved;
  }, [saved]);

  useEffect(() => {
    savedCompanyGroupIdRef.current = savedCompanyGroupId;
  }, [savedCompanyGroupId]);

  // Firestore settings sync — shared user admin joins auto dekhe
  useEffect(() => {
    if (!companyId) return;
    setLoadingRemote(true);
    const unsub = subscribeInterCompanyJoinSettings(
      companyId,
      ({ settings, companyGroupId: gid }) => {
        setSaved(settings);
        setDraft((current) =>
          settingsEqual(current, savedSettingsRef.current) ? settings : current
        );
        savedSettingsRef.current = settings;
        setCompanyGroupId((current) =>
          current !== savedCompanyGroupIdRef.current ? current : gid
        );
        setSavedCompanyGroupId(gid);
        savedCompanyGroupIdRef.current = gid;
        setLoadingRemote(false);
      },
      () => setLoadingRemote(false)
    );
    return () => unsub();
  }, [companyId]);

  useEffect(() => {
    if (!groupOwnerUid) return;
    return subscribeInterCompanyGroups(groupOwnerUid, (rows) => {
      setGroups(rows);
      setSavedGroupsJson(JSON.stringify(rows));
    });
  }, [groupOwnerUid]);

  // User's bookmarked public systems
  useEffect(() => {
    if (!groupOwnerUid) {
      setLinkedPublicSystems([]);
      return;
    }
    return subscribeLinkedPublicInterCompanySystems(groupOwnerUid, setLinkedPublicSystems);
  }, [groupOwnerUid]);

  // Target owner — pending system join requests (system card badge)
  useEffect(() => {
    if (!groupOwnerUid) {
      setIncomingSystemJoinRequests([]);
      return;
    }
    return subscribeIncomingSystemJoinRequests({ targetOwnerUserId: groupOwnerUid }, setIncomingSystemJoinRequests);
  }, [groupOwnerUid]);

  // Requester — accepted requests par apni company link sync
  useEffect(() => {
    if (!groupOwnerUid) return;
    return subscribeAcceptedSystemJoinLinksForRequester(groupOwnerUid, onSettingsChange);
  }, [groupOwnerUid, onSettingsChange]);

  const pendingJoinCountBySystemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of incomingSystemJoinRequests) {
      if (!r.systemId) continue;
      map.set(r.systemId, (map.get(r.systemId) || 0) + 1);
    }
    return map;
  }, [incomingSystemJoinRequests]);

  /** User-owned companies — group assign; sirf ownerId / ownerEmail match */
  const ownedCompaniesForGroups = useMemo(() => {
    const uid = user?.uid;
    const email = user?.email?.toLowerCase().trim();
    return (allCompanies || [])
      .filter((c) => {
        if (!c.id) return false;
        if (uid && c.ownerId === uid) return true;
        if (email && String(c.ownerEmail || "").toLowerCase().trim() === email) return true;
        return false;
      })
      .map((c) => ({ id: c.id!, name: String(c.name || c.id) }));
  }, [allCompanies, user?.uid, user?.email]);

  // One-time: clear joined partner ticks from removed Join sections
  useEffect(() => {
    if (!user?.uid || ownedCompaniesForGroups.length === 0) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(JOIN_LINKS_RESET_MIGRATION_KEY)) return;

    const companyIds = ownedCompaniesForGroups.map((c) => c.id);
    void resetInterCompanyJoinLinks({ companyIds, updatedByUid: user.uid })
      .then(() => {
        localStorage.setItem(JOIN_LINKS_RESET_MIGRATION_KEY, "1");
        if (companyIds.includes(companyId)) {
          const next = readInterCompanyLocalSettings(companyId);
          setDraft(next);
          setSaved(next);
        }
    onSettingsChange?.();
      })
      .catch((err) => console.warn("[IC join] reset links:", err));
  }, [user?.uid, ownedCompaniesForGroups, companyId, onSettingsChange]);

  /** IC centralized system list — owned + linked (same id / same naam duplicate hide) */
  const allSystemsInList = useMemo(() => {
    const byId = new Map<string, InterCompanyGroupDoc>();
    const nameKeys = new Set<string>();
    for (const g of groups) {
      byId.set(g.id, g);
      nameKeys.add(normalizeInterCompanySystemNameKey(g.name));
    }
    for (const g of linkedPublicSystems) {
      if (byId.has(g.id)) continue;
      const key = normalizeInterCompanySystemNameKey(g.name);
      if (nameKeys.has(key)) continue;
      byId.set(g.id, g);
      nameKeys.add(key);
    }
    return Array.from(byId.values());
  }, [groups, linkedPublicSystems]);

  const ownedSystemIdsKey = useMemo(() => groups.map((g) => g.id).join(","), [groups]);
  const linkedSystemIdsKey = useMemo(
    () => linkedPublicSystems.map((g) => g.id).join(","),
    [linkedPublicSystems]
  );
  const ownedSystemIds = useMemo(
    () => new Set(ownedSystemIdsKey ? ownedSystemIdsKey.split(",") : []),
    [ownedSystemIdsKey]
  );
  const linkedSystemIds = useMemo(
    () => new Set(linkedSystemIdsKey ? linkedSystemIdsKey.split(",") : []),
    [linkedSystemIdsKey]
  );
  const excludeSystemIdsKey = useMemo(
    () => [ownedSystemIdsKey, linkedSystemIdsKey].filter(Boolean).join(","),
    [ownedSystemIdsKey, linkedSystemIdsKey]
  );

  const filteredSystems = useMemo(() => {
    const q = systemSearchQuery.trim().toLowerCase();
    if (!q) return allSystemsInList;
    return allSystemsInList.filter((g) => g.name.toLowerCase().includes(q));
  }, [allSystemsInList, systemSearchQuery]);

  /** Card par creator email/name — group doc, session (customUser), ya users lookup se */
  const resolveSystemCreatorDisplay = (g: InterCompanyGroupDoc) => {
    const isOwnerCard = g.ownerUserId === groupOwnerUid;
    const cached = ownerProfilesByUid[g.ownerUserId];
    const email =
      g.ownerEmail ||
      (isOwnerCard ? sessionCreatorIdentity.email : cached?.email) ||
      cached?.email ||
      "";
    const displayName =
      g.ownerDisplayName ||
      (isOwnerCard ? sessionCreatorIdentity.displayName : cached?.displayName) ||
      cached?.displayName ||
      "";
    return { email, displayName };
  };

  // Creator profile fetch — linked/public + apne system jahan doc me name/email missing ho
  useEffect(() => {
    const missingUids = new Set<string>();
    for (const g of allSystemsInList) {
      if (!g.ownerUserId) continue;
      const cached = ownerProfilesByUid[g.ownerUserId];
      const docMissingEmail = !g.ownerEmail;
      const docMissingName = !g.ownerDisplayName;
      if (!docMissingEmail && !docMissingName) continue;
      // Apna card: customUser se fill ho sakta hai — sirf tab skip jab dono mil gaye
      if (g.ownerUserId === groupOwnerUid) {
        const sessionFillsEmail = !docMissingEmail || !!sessionCreatorIdentity.email;
        const sessionFillsName = !docMissingName || !!sessionCreatorIdentity.displayName;
        if (sessionFillsEmail && sessionFillsName) continue;
      }
      const cacheFillsEmail = !docMissingEmail || !!cached?.email;
      const cacheFillsName = !docMissingName || !!cached?.displayName;
      if (cacheFillsEmail && cacheFillsName) continue;
      missingUids.add(g.ownerUserId);
    }
    if (missingUids.size === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        Array.from(missingUids).map(async (uid) => {
          const profile = await fetchInterCompanyUserProfileByUid(uid);
          return [uid, profile ?? {}] as const;
        })
      );
      if (cancelled) return;
      setOwnerProfilesByUid((prev) => {
        const next = { ...prev };
        for (const [uid, profile] of entries) {
          next[uid] = {
            email: profile.email,
            displayName: profile.displayName,
          };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    allSystemsInList,
    groupOwnerUid,
    ownerProfilesByUid,
    sessionCreatorIdentity.email,
    sessionCreatorIdentity.displayName,
  ]);

  const addablePublicResults = useMemo(
    () =>
      publicSearchResults.filter(
        (g) => !ownedSystemIds.has(g.id) && !linkedSystemIds.has(g.id)
      ),
    [publicSearchResults, ownedSystemIds, linkedSystemIds]
  );

  // Global public system search (2+ characters)
  useEffect(() => {
    if (!groupOwnerUid) return;
    const q = systemSearchQuery.trim();
    if (q.length < 2) {
      setPublicSearchResults([]);
      setSearchingPublic(false);
      return;
    }
    setSearchingPublic(true);
    const timer = window.setTimeout(() => {
      void searchPublicInterCompanySystems({
        nameQuery: q,
        excludeOwnerUserId: groupOwnerUid,
        excludeSystemIds: excludeSystemIdsKey ? excludeSystemIdsKey.split(",") : [],
      })
        .then(setPublicSearchResults)
        .finally(() => setSearchingPublic(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [systemSearchQuery, groupOwnerUid, excludeSystemIdsKey]);

  const isDirty = useMemo(() => {
    if (!settingsEqual(draft, saved)) return true;
    if (companyGroupId !== savedCompanyGroupId) return true;
    if (JSON.stringify(groups) !== savedGroupsJson) return true;
    return false;
  }, [draft, saved, companyGroupId, savedCompanyGroupId, groups, savedGroupsJson]);

  const patchDraft = (next: InterCompanyLocalSettings) => {
    if (!canWriteIc) return;
    setDraft(next);
  };

  const handleAddGroup = async () => {
    if (!canWriteIc || !groupOwnerUid) {
      toast.error("Sign in required to create a system.");
      return;
    }
    const name = newGroupName.trim();
    if (!name) {
      toast.error("Enter a system name");
      return;
    }
    // Client-side — list + linked public me same naam block (Firestore se pehle)
    const nameKey = normalizeInterCompanySystemNameKey(name);
    if (
      groups.some((g) => normalizeInterCompanySystemNameKey(g.name) === nameKey) ||
      linkedPublicSystems.some((g) => normalizeInterCompanySystemNameKey(g.name) === nameKey)
    ) {
      toast.error("This system name is already taken.");
      return;
    }
    try {
      const taken = await isInterCompanySystemNameTaken({
        name,
        ownerUserId: groupOwnerUid,
      });
      if (taken) {
        toast.error("This system name is already taken.");
        return;
      }
      const created = await createInterCompanyGroup({
        ownerUserId: groupOwnerUid,
        name,
        ownerEmail: sessionCreatorIdentity.email || undefined,
        ownerDisplayName: sessionCreatorIdentity.displayName || undefined,
        visibility: newSystemVisibility,
      });
      setNewGroupName("");
      setGroups((prev) => {
        if (prev.some((g) => g.id === created.id)) return prev;
        return [
          {
            id: created.id,
            name,
            ownerUserId: groupOwnerUid,
            ownerEmail: sessionCreatorIdentity.email || undefined,
            ownerDisplayName: sessionCreatorIdentity.displayName || undefined,
            visibility: newSystemVisibility,
            companyIds: [],
            memberUsers: [],
            localOnly: created.localOnly,
          },
          ...prev,
        ];
      });
      toast.success(
        newSystemVisibility === "local" || created.localOnly
          ? "Local IC system created — add your local companies via View companies."
          : created.localOnly
            ? "System saved on this device — deploy Firestore rules to sync across devices."
            : "System created — use View companies to add companies"
      );
    } catch (err) {
      toast.error(interCompanyGroupCreateErrorMessage(err));
    }
  };

  const isOwnedSystem = (g: InterCompanyGroupDoc) => ownedSystemIds.has(g.id);

  /** Public system — companies joined hon to delete UI + API dono block */
  const isPublicSystemDeleteBlocked = (g: InterCompanyGroupDoc) => {
    if (g.visibility !== "public") return false;
    const joined = g.companyIds?.filter((id) => String(id || "").trim()).length ?? 0;
    return joined > 0;
  };

  const handleDeleteSystem = async (g: InterCompanyGroupDoc) => {
    if (!canWriteIc || !groupOwnerUid) return;
    if (isPublicSystemDeleteBlocked(g)) {
      toast.error("Remove all companies from this public system before deleting.");
      return;
    }
    try {
      await deleteInterCompanyGroup(g.id, groupOwnerUid);
      setGroups((prev) => prev.filter((row) => row.id !== g.id));
      if (viewSystemId === g.id) setViewSystemId(null);
      toast.success("System deleted");
    } catch (err) {
      toast.error(interCompanyGroupDeleteErrorMessage(err));
    }
  };

  const startRenameSystem = (g: InterCompanyGroupDoc) => {
    setRenamingSystemId(g.id);
    setRenameDraft(g.name);
  };

  const cancelRenameSystem = () => {
    setRenamingSystemId(null);
    setRenameDraft("");
  };

  /** Rename — systemId same; linked users realtime group doc se naya naam dekhenge */
  const handleRenameSystem = async (systemId: string) => {
    if (!canWriteIc || !groupOwnerUid) return;
    const newName = renameDraft.trim();
    if (!newName) {
      toast.error("Enter a system name");
      return;
    }
    const current = groups.find((g) => g.id === systemId);
    if (!current) return;
    if (newName === current.name) {
      cancelRenameSystem();
      return;
    }
    const nameKey = normalizeInterCompanySystemNameKey(newName);
    if (
      groups.some(
        (g) => g.id !== systemId && normalizeInterCompanySystemNameKey(g.name) === nameKey
      ) ||
      linkedPublicSystems.some((g) => normalizeInterCompanySystemNameKey(g.name) === nameKey)
    ) {
      toast.error("This system name is already taken.");
      return;
    }
    setRenaming(true);
    try {
      const taken = await isInterCompanySystemNameTaken({
        name: newName,
        ownerUserId: groupOwnerUid,
        exceptSystemId: systemId,
      });
      if (taken) {
        toast.error("This system name is already taken.");
        return;
      }
      await renameInterCompanyGroup({
        groupId: systemId,
        newName,
        ownerUserId: groupOwnerUid,
      });
      setGroups((prev) =>
        prev.map((g) =>
          g.id === systemId
            ? { ...g, name: newName, nameKey: normalizeInterCompanySystemNameKey(newName) }
            : g
        )
      );
      toast.success("System renamed");
      cancelRenameSystem();
    } catch (err) {
      toast.error(interCompanyGroupRenameErrorMessage(err));
    } finally {
      setRenaming(false);
    }
  };

  const handleAddPublicSystem = async (systemId: string) => {
    if (!groupOwnerUid || !canReadIc) return;
    setLinkingSystemId(systemId);
    try {
      await addLinkedPublicInterCompanySystem({ userId: groupOwnerUid, systemId });
      toast.success("Public system added to your list");
      setPublicSearchResults((prev) => prev.filter((g) => g.id !== systemId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add system");
    } finally {
      setLinkingSystemId(null);
    }
  };

  const handleRemoveLinkedPublic = async (systemId: string) => {
    if (!groupOwnerUid || !canReadIc) return;
    try {
      await removeLinkedPublicInterCompanySystem({ userId: groupOwnerUid, systemId });
      toast.success("Removed from your list");
      if (viewSystemId === systemId) setViewSystemId(null);
    } catch {
      toast.error("Could not remove system");
    }
  };

  const handleSave = async () => {
    if (!companyId || !user?.uid) {
      toast.error("Sign in and select a company to save join settings.");
      return;
    }
    if (!canWriteIc) {
      toast.error("You need Manage Inter Company joins permission to save.");
      return;
    }
    setSaving(true);
    const settingsToSave = draft;
    const groupsChanged = JSON.stringify(groups) !== savedGroupsJson;
    const groupAssignmentChanged = companyGroupId !== savedCompanyGroupId;

    try {
      await saveInterCompanyJoinSettings({
        companyId,
        settings: settingsToSave,
        companyGroupId,
        updatedByUid: user.uid,
      });
      setSaved({ ...settingsToSave });
      savedSettingsRef.current = settingsToSave;
    } catch (err) {
      console.warn("[IC join] save settings failed:", err);
      toast.error("Could not save settings");
      return;
    } finally {
      setSaving(false);
    }

    if (!groupsChanged && !groupAssignmentChanged) {
      onSettingsChange?.();
      toast.success("Inter Company join settings saved");
      return;
    }

    setSaving(true);
    try {
      if (groupsChanged) {
        for (const g of groups) {
          const groupCompanies = g.companyIds
            .map((id) => (allCompanies || []).find((c) => c.id === id))
            .filter(Boolean);
          const memberUsers = collectInterCompanyMemberUsers(
            groupCompanies as Parameters<typeof collectInterCompanyMemberUsers>[0]
          );
          const nextSummaries = {
            ...(g.companySummaries ?? {}),
            ...buildCompanySummariesForIds(g.companyIds, allCompanies || []),
          };
          const nextOwners = { ...(g.companyOwners ?? {}) };
          const uid = user.uid;
          const email = user.email?.toLowerCase().trim();
          for (const cid of g.companyIds) {
            const co = (allCompanies || []).find((c) => c.id === cid);
            if (!co?.id) continue;
            const isOwner =
              (uid && co.ownerId === uid) ||
              (email && String(co.ownerEmail || "").toLowerCase().trim() === email);
            if (!isOwner) continue;
            nextOwners[cid] = {
              ownerUserId: co.ownerId || uid,
              ownerEmail: co.ownerEmail || user.email || "",
            };
          }
          await updateInterCompanyGroup(
            g.id,
            {
              name: g.name,
              companyIds: g.companyIds,
              memberUsers,
              visibility: g.visibility ?? "private",
              companySummaries: nextSummaries,
              companyOwners: nextOwners,
            },
            groupOwnerUid
          );
        }
      }

      for (const oc of ownedCompaniesForGroups) {
        const gid =
          oc.id === companyId
            ? companyGroupId
            : groups.find((g) => g.companyIds.includes(oc.id))?.id ?? null;
        await assignCompanyToInterCompanyGroup({
          groups,
          companyId: oc.id,
          groupId: gid,
          ownerUserId: groupOwnerUid,
        });
        if (oc.id === companyId) {
          await writeCompanyInterCompanyGroupId(oc.id, gid, user.uid);
        }
      }

      setSavedCompanyGroupId(companyGroupId);
      savedCompanyGroupIdRef.current = companyGroupId;
      setSavedGroupsJson(JSON.stringify(groups));
      onSettingsChange?.();
      toast.success("Inter Company join settings saved");
    } catch (err) {
      console.warn("[IC join] save groups failed:", err);
      onSettingsChange?.();
      toast.warning("Privacy settings saved, but centralized system could not sync");
    } finally {
      setSaving(false);
    }
  };

  if (!canReadIc) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", interCompanyVoucherTabShellClass)}>
        You need <strong>View Inter Company join settings</strong> permission. Ask your company admin
        under Users &amp; Roles → Permissions.
      </div>
    );
  }

  return (
    <div className={cn("pl-inter-company-voucher space-y-5 p-1", interCompanyVoucherTabShellClass)}>
      {loadingRemote ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading join settings…
        </div>
      ) : null}

      <div className={cn("space-y-0", interCompanySettingsCardClass, "p-3")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="ic-notify" className="text-sm font-medium">
              Notifications
            </Label>
            <p className="text-xs text-muted-foreground">
              Inter Com System join requests — syncs with Messages → Alerts
            </p>
          </div>
          <Switch
            id="ic-notify"
            checked={draft.notificationsEnabled}
            disabled={!canWriteIc}
            onCheckedChange={(on) => patchDraft({ ...draft, notificationsEnabled: on })}
          />
        </div>
        <InterCompanyJoinNotificationsInbox
          companyId={companyId}
          enabled={draft.notificationsEnabled}
          onJoined={onSettingsChange}
        />
      </div>

      <InterCompanyPartnerPrivacySettings
        searchBy={draft.partnerSearchBy}
        viewFields={draft.partnerViewFields}
        maskInView={draft.partnerMaskInView}
        onSearchByChange={(key: InterCompanyPartnerFieldKey, checked: boolean) => {
          if (!canWriteIc) return;
          patchDraft({ ...draft, partnerSearchBy: { ...draft.partnerSearchBy, [key]: checked } });
        }}
        onViewFieldsChange={(key: InterCompanyPartnerFieldKey, checked: boolean) => {
          if (!canWriteIc) return;
          patchDraft({ ...draft, partnerViewFields: { ...draft.partnerViewFields, [key]: checked } });
        }}
        onMaskInViewChange={(on) => {
          if (!canWriteIc) return;
          patchDraft({ ...draft, partnerMaskInView: on });
        }}
      />

      {/* Inter Company centralized system — owned companies organize */}
      <div className={cn(interCompanySettingsCardClass, "space-y-3 p-3")}>
        <div>
          <Label className="text-sm font-medium">Inter Company centralized system</Label>
          <p className="text-xs text-muted-foreground">
            <strong>Local (device)</strong> — sirf is device ki local companies, SQLite IC (Firebase nahi).
            <strong> Private</strong> / <strong>Public</strong> — cloud systems (Firebase).
            Use <strong>View companies</strong> to add companies, then <strong>Save</strong>.
          </p>
        </div>
        {canWriteIc ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="New system name"
              className="h-9 min-w-[10rem] flex-1 sm:max-w-xs"
            />
            <Select
              value={newSystemVisibility}
              onValueChange={(v) => setNewSystemVisibility(v as InterCompanyGroupVisibility)}
            >
              <SelectTrigger className="h-9 w-[7.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (device)</SelectItem>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => void handleAddGroup()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add system
            </Button>
            <div className="relative min-w-[10rem] flex-1 sm:max-w-[14rem] sm:ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={systemSearchQuery}
                onChange={(e) => setSystemSearchQuery(e.target.value)}
                placeholder="Search my or public systems…"
                className="h-9 pl-8"
              />
            </div>
          </div>
        ) : (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={systemSearchQuery}
              onChange={(e) => setSystemSearchQuery(e.target.value)}
              placeholder="Search systems…"
              className="h-9 pl-8"
        />
      </div>
        )}
        {allSystemsInList.length === 0 ? (
          <p className="text-xs text-muted-foreground">No systems yet.</p>
        ) : filteredSystems.length === 0 ? (
          <p className="text-xs text-muted-foreground">No systems in your list match this search.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSystems.map((g) => {
              const owned = isOwnedSystem(g);
              const vis =
                g.visibility === "local" || g.localOnly
                  ? "local"
                  : g.visibility === "public"
                    ? "public"
                    : "private";
              const pendingJoinCount = pendingJoinCountBySystemId.get(g.id) || 0;
              const creator = resolveSystemCreatorDisplay(g);
              const isRenaming = renamingSystemId === g.id;
              const publicDeleteBlocked = owned && isPublicSystemDeleteBlocked(g);
              return (
                <li
                  key={g.id}
                  className="flex min-w-0 flex-col gap-1.5 rounded-md border p-2.5 text-sm"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                          System name
                        </span>
                        {isRenaming ? (
                          <Input
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            className="h-7 min-w-0 flex-1 text-sm"
                            disabled={renaming}
                            autoFocus
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                        )}
                      </div>
                      {/* Creator — email upar, user name niche */}
                      <p className="truncate text-xs text-muted-foreground">
                        Created by: {creator.email || "—"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        User name: {creator.displayName || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {owned ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 text-[10px]",
                            vis === "public"
                              ? "border-sky-600/50 bg-sky-50 text-sky-800"
                              : vis === "local"
                                ? "border-violet-600/50 bg-violet-50 text-violet-900"
                                : "border-muted-foreground/30 text-muted-foreground"
                          )}
                        >
                          {vis === "public" ? "Public" : vis === "local" ? "Local device" : "Private"}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] border-emerald-600/50 bg-emerald-50 text-emerald-800"
                        >
                          Linked public
                        </Badge>
                      )}
                      {pendingJoinCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] border-amber-600/50 bg-amber-50 text-amber-800"
                          title="Pending join requests"
                        >
                          {pendingJoinCount} request{pendingJoinCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      {canWriteIc && owned && !isRenaming ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          title="Rename system"
                          onClick={() => startRenameSystem(g)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {canReadIc && !owned ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-destructive"
                          title="Remove from my list"
                          onClick={() => void handleRemoveLinkedPublic(g.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {canWriteIc && owned && !isRenaming ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className={cn(
                            "h-7 w-7 shrink-0",
                            publicDeleteBlocked ?
                              "text-muted-foreground opacity-50"
                            : "text-destructive"
                          )}
                          disabled={publicDeleteBlocked}
                          title={
                            publicDeleteBlocked ?
                              "Remove all companies first — then you can delete this public system"
                            : "Delete system"
                          }
                          onClick={() => void handleDeleteSystem(g)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {isRenaming ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={renaming}
                        onClick={() => void handleRenameSystem(g.id)}
                      >
                        {renaming ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5 mr-1" />
                        )}
                        Save name
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={renaming}
                        onClick={cancelRenameSystem}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {g.companyIds.length} companies
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-fit text-xs"
                    onClick={() => setViewSystemId(g.id)}
                  >
                    View companies
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {systemSearchQuery.trim().length >= 2 ? (
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs text-muted-foreground">Public systems — search results</Label>
            {searchingPublic ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching public systems…
              </div>
            ) : addablePublicResults.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No new public systems found for &quot;{systemSearchQuery.trim()}&quot;.
              </p>
            ) : (
              <ul className="space-y-2">
                {addablePublicResults.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{g.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.companyIds.length} companies · Public
                      </p>
                    </div>
                    {canReadIc ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs shrink-0"
                        disabled={linkingSystemId === g.id}
                        onClick={() => void handleAddPublicSystem(g.id)}
                      >
                        {linkingSystemId === g.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5 mr-1" />
                        )}
                        Add to my system
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {canWriteIc ? (
        <div className="sticky bottom-0 flex justify-end border-t bg-background/95 pt-3 pb-1">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !isDirty}
            className="min-w-[7rem]"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground border-t pt-2">
          Read-only — ask admin for <strong>Manage Inter Company joins</strong> permission to edit.
        </p>
      )}
      <InterCompanySystemViewCompaniesDialog
        open={!!viewSystemId}
        onOpenChange={(open) => {
          if (!open) setViewSystemId(null);
        }}
        system={viewSystem}
        allCompanies={allCompanies || []}
        ownedCompanies={ownedCompaniesForGroups}
        currentCompanyId={companyId}
        groups={groups}
        groupOwnerUid={groupOwnerUid}
        userEmail={user?.email || undefined}
        requesterName={user?.displayName || user?.email || undefined}
        canRead={canReadIc}
        canWrite={canWriteIc}
        onSystemCompaniesChanged={(nextGroups) => {
          setGroups(nextGroups);
          setSavedGroupsJson(JSON.stringify(nextGroups));
          if (viewSystemId && companyId) {
            const g = nextGroups.find((x) => x.id === viewSystemId);
            if (g?.companyIds.includes(companyId)) setCompanyGroupId(viewSystemId);
          }
          onSettingsChange?.();
        }}
        onSystemUpdated={(updated) => {
          setLinkedPublicSystems((prev) =>
            prev.map((g) => (g.id === updated.id ? updated : g))
          );
          setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
          onSettingsChange?.();
        }}
      />
    </div>
  );
}
