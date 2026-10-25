
"use client";

import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  collection,
  query,
  orderBy,
  doc,
  updateDoc,
  writeBatch,
  where,
  addDoc,
  serverTimestamp,
  deleteDoc,
  setDoc,
} from "firebase/firestore";
import { onSnapshot, getDocs, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import { PRESENCE_ONLINE_THRESHOLD_MS } from "@/lib/presenceConstants";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Bell, MessageSquare, AlarmPlus, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { toast } from "sonner";
import { isSuppressibleNewTransactionAlert } from "@/lib/transactionAlerts";
import { IC_ALERTS_CHANGED } from "@/lib/interCompany/interCompanyAlerts";
import { interCompanySystemJoinAlertVisibleForCompany } from "@/lib/interCompany/interCompanySystemJoinRequest";
import { AlertsTab } from '@/components/messages/AlertsTab';
import { ChatTab } from '@/components/messages/ChatTab';
import { AlarmsTab } from '@/components/messages/AlarmsTab';
import { Badge } from "@/components/ui/badge";
import {
  messagesTabRibbonClassName,
  messagesTabListClassName,
  messagesTabTriggerClassName,
  messagesTabUnreadBadgeClassName,
} from "@/lib/messagesChrome";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { HistoryDialog } from "@/components/vouchers/HistoryDialog";

type Notification = {
  id: string;
  message: string;
  timestamp: any;
  isRead: boolean;
};

type Message = {
    id: string;
    receiverId: string;
    status: 'sent' | 'delivered' | 'read';
    deletedFor?: string[];
    [key: string]: any;
};

type Alarm = {
  id: string;
  title: string;
  datetime: any;
  users: string[];
  notified?: boolean;
  context?: string;
  entityId?: string;
};

const findUserByParticipantId = (users: any[], participantId: string) =>
  users.find((u: any) => u.id === participantId || u.uid === participantId);

/** Valid tab values — keep in sync with TabsTrigger `value` props. */
const MESSAGES_TAB_VALUES = ["alerts", "auto", "chat", "alarms"] as const;
type MessagesTabValue = (typeof MESSAGES_TAB_VALUES)[number];
const MESSAGES_TAB_STORAGE_KEY = "messagesActiveTab";

export default function MessagesPage() {
  // Same default on server + first client paint; restore from localStorage after mount only (avoids hydration mismatch).
  const [activeTab, setActiveTab] = useState<MessagesTabValue>("chat");
  // Radix Tabs + nested dialogs use React useId(); SSR and client can assign different prefixes in Next dev — render tabs only after mount.
  const [messagesRadixMounted, setMessagesRadixMounted] = useState(false);

  const { company, companyId, setCompanyId, allCompanies: userCompanies, effectiveNotificationSettings } =
    useCompany();
  const { user, customUser } = useAuth();
  const { processedParties, processedStaff } = useVouchers();
  const [allAppUsers, setAllAppUsers] = useState<any[]>([]);
  const [voucherToEdit, setVoucherToEdit] = useState<any>(null);
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false);
  const [historyVoucher, setHistoryVoucher] = useState<any>(null);
  const [historyHighlightTimestamp, setHistoryHighlightTimestamp] = useState<any>(null);
  const [historyHighlightUid, setHistoryHighlightUid] = useState<string | undefined>(undefined);
  /** Alerts -> View changes: same notification ko history dialog se mark-as-read karne ke liye. */
  const [historyNotificationId, setHistoryNotificationId] = useState<string | null>(null);
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const userSelectedConversationIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<MessagesTabValue>("chat");
  const isMobile = useIsMobile();
  const [mobileChatView, setMobileChatView] = useState<"list" | "chat">("list");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  
  // States for notification counts
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  // Auto-created vouchers ko separate tab badge dene ke liye dedicated unread state.
  const [unreadAutoAlerts, setUnreadAutoAlerts] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [alarms, setAlarms] = React.useState<Alarm[]>([]);
  const [statuses, setStatuses] = React.useState<Record<string, { state: string, last_changed: number }>>({});
  const myUserIds = useMemo(() => {
    const ids = new Set<string>();
    if (user?.uid) ids.add(user.uid);
    if (customUser?.userDocId) ids.add(customUser.userDocId);
    return Array.from(ids);
  }, [user?.uid, customUser?.userDocId]);


  const skipInitialTabPersist = useRef(true);

  useEffect(() => {
    const raw = localStorage.getItem(MESSAGES_TAB_STORAGE_KEY);
    if (raw && (MESSAGES_TAB_VALUES as readonly string[]).includes(raw)) {
      setActiveTab(raw as MessagesTabValue);
    }
  }, []);

  useEffect(() => {
    setMessagesRadixMounted(true);
  }, []);

  useEffect(() => {
    // First run is right after hydration; avoid clobbering stored tab with default "chat" before restore effect applies.
    if (skipInitialTabPersist.current) {
      skipInitialTabPersist.current = false;
      return;
    }
    localStorage.setItem(MESSAGES_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);
  
  useEffect(() => {
    if (!companyId || !user) return;

    const q = query(
      collection(firestore, `companies/${companyId}/alarms`),
      where('notified', '==', false),
      where('notifyAt', '<=', new Date())
    );
    const unsub = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) return;

        const batch = writeBatch(firestore);
        const usersToNotify: Record<string, any[]> = {};

        for (const alarmDoc of snapshot.docs) {
            const alarmData = alarmDoc.data() as any;
            
            let targetUserIds: string[] = [];
            if (alarmData.users && Array.isArray(alarmData.users) && alarmData.users.length > 0) {
              const qUsers = query(collection(firestore, "users"), where('email', 'in', alarmData.users));
              const userSnaps = await getDocs(qUsers);
              targetUserIds = userSnaps.docs
                .map(d => ({ id: d.id, ...d.data() } as any))
                .map((u: any) => u.uid || u.id)
                .filter(Boolean);
            }
            
            if(targetUserIds.length === 0) {
              if (company?.ownerId) {
                targetUserIds.push(company.ownerId);
              }
            }

            for (const userId of targetUserIds) {
                if (!usersToNotify[userId]) usersToNotify[userId] = [];
                usersToNotify[userId].push({ ...alarmData, alarmId: alarmDoc.id });
            }
            
            const alarmRef = doc(firestore, `companies/${companyId}/alarms`, alarmDoc.id);
            batch.update(alarmRef, { notified: true });
        }
        
        const createdByName = (uid: string | null | undefined) => {
            if (!uid) return null;
            const u = allAppUsers.find((a: any) => a.id === uid);
            return u?.displayName || u?.email || uid;
        };
        for (const [userId, userAlarms] of Object.entries(usersToNotify)) {
            for (const alarm of userAlarms) {
                 const notificationRef = collection(firestore, "admin_notifications");
                 await addDoc(notificationRef, {
                    recipientUserId: userId,
                    type: "alarm",
                    alarmId: alarm.alarmId,
                    message: alarm.message || alarm.title || `ALARM: ${alarm.title}`,
                    alarmTitle: alarm.title,
                    timestamp: serverTimestamp(),
                    isRead: false,
                    companyId: companyId,
                    context: alarm.context || null,
                    entityId: alarm.entityId || null,
                    alarmForUsers: alarm.users && Array.isArray(alarm.users) ? alarm.users : [],
                    alarmCreatedBy: alarm.createdBy ?? null,
                    alarmCreatedByName: createdByName(alarm.createdBy) ?? null,
                    alarmCreatedAt: alarm.createdAt ?? null,
                    alarmDatetime: alarm.datetime ?? null,
                    alarmNotifyAt: alarm.notifyAt ?? null,
                });
            }
        }
        
        await batch.commit();
        const totalAlarms = snapshot.size;
        toast.info(`${totalAlarms} alarm(s) went off! Check your alerts.`);
    });
    return () => unsub();
  }, [companyId, user, allAppUsers, company]);

  const handleTabChange = (value: string) => {
    if (!(MESSAGES_TAB_VALUES as readonly string[]).includes(value)) return;
    const v = value as MessagesTabValue;
    activeTabRef.current = v;
    setActiveTab(v);
  };
  
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchUsers = async () => {
      try {
        const q = query(collection(firestore, "users"));
        const snapshot = await getDocs(q);
        let allUsers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        const existingIds = new Set(allUsers.map((u) => u.id));
        const superAdminEmails = getSuperAdminEmails();
        if (superAdminEmails.length > 0) {
          const emailsToFetch = superAdminEmails.slice(0, 30);
          const qSuper = query(
            collection(firestore, "users"),
            where("email", "in", emailsToFetch)
          );
          const snapSuper = await getDocs(qSuper);
          snapSuper.docs.forEach((d) => {
            const u = { id: d.id, ...d.data() } as any;
            if (!existingIds.has(u.id)) {
              allUsers.push(u);
              existingIds.add(u.id);
            }
          });
        }
        if (!cancelled) setAllAppUsers(allUsers);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    };
    fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const relevantChatUserIds = useMemo(() => {
    if (!myUserIds.length || !conversations.length) return [] as string[];
    const ids = new Set<string>();
    conversations.forEach((conversation: any) => {
      (conversation.participants || []).forEach((participantId: string) => {
        if (participantId && !myUserIds.includes(participantId)) ids.add(participantId);
      });
    });
    return Array.from(ids);
  }, [conversations, myUserIds]);

  // Resolve participant uid -> Firestore user doc id (slug_uid) by querying users by uid, so presence works for all users.
  useEffect(() => {
    if (!relevantChatUserIds.length) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    const teardownRef = { current: null as (() => void) | null };
    (async () => {
      const ids = relevantChatUserIds.slice(0, 30);
      const q = query(collection(firestore, "users"), where("uid", "in", ids));
      const snap = await getDocs(q);
      if (cancelled) return;
      const uidToDocId = new Map<string, string>();
      snap.docs.forEach((d) => {
        const uid = d.data()?.uid;
        if (uid) uidToDocId.set(uid, d.id);
      });
      relevantChatUserIds.forEach((pid) => {
        if (!uidToDocId.has(pid)) uidToDocId.set(pid, pid);
      });
      const docIdToPids = new Map<string, string[]>();
      relevantChatUserIds.forEach((pid) => {
        const docId = uidToDocId.get(pid) ?? pid;
        if (!docIdToPids.has(docId)) docIdToPids.set(docId, []);
        docIdToPids.get(docId)!.push(pid);
      });
      const unsubscribers = Array.from(docIdToPids.entries()).map(([docId, pids]) => {
        const userRef = doc(firestore, "users", docId);
        return onSnapshot(userRef, (docSnap) => {
          if (cancelled) return;
          const data = docSnap.data();
          if (!data?.lastSeen?.toDate) return;
          const lastChanged = data.lastSeen.toDate().getTime() || 0;
          const nextState =
            data?.online && Date.now() - lastChanged < PRESENCE_ONLINE_THRESHOLD_MS ? "online" : "offline";
          setStatuses((prev) => {
            let next = { ...prev };
            let changed = false;
            pids.forEach((pid) => {
              const prevStatus = prev[pid];
              if (
                prevStatus &&
                prevStatus.state === nextState &&
                prevStatus.last_changed === lastChanged
              )
                return;
              next[pid] = { state: nextState, last_changed: lastChanged };
              changed = true;
            });
            return changed ? next : prev;
          });
        });
      });
      if (cancelled) {
        unsubscribers.forEach((unsub) => unsub());
      } else {
        teardownRef.current = () => unsubscribers.forEach((unsub) => unsub());
      }
    })();
    return () => {
      cancelled = true;
      teardownRef.current?.();
    };
  }, [relevantChatUserIds]);

  useEffect(() => {
    if (!user || allAppUsers.length === 0 || !myUserIds.length) return;

    const unsubscribers: Array<() => void> = [];
    const snapshotsById = new Map<string, any>();
    const recompute = () => {
      const convos = Array.from(snapshotsById.values()).sort((a: any, b: any) => {
        const aTs = a?.lastMessageTimestamp?.toDate ? a.lastMessageTimestamp.toDate().getTime() : 0;
        const bTs = b?.lastMessageTimestamp?.toDate ? b.lastMessageTimestamp.toDate().getTime() : 0;
        return bTs - aTs;
      });
      setConversations(convos);
      setSelectedConversation((prev: any) => {
        if (convos.length === 0) return null;
        const preferredId = prev?.id ?? userSelectedConversationIdRef.current ?? localStorage.getItem('selectedConversationId');
        const found = preferredId ? convos.find((c) => c.id === preferredId) : null;
        const next = found ?? convos[0] ?? null;
        if (next) userSelectedConversationIdRef.current = next.id;
        return next;
      });
    };

    myUserIds.forEach((id) => {
      const conversationsQuery = query(
        collection(firestore, 'conversations'),
        where('participants', 'array-contains', id)
      );
      const unsub = onSnapshot(conversationsQuery, (snapshot) => {
        snapshot.docs.forEach((d) => snapshotsById.set(d.id, { id: d.id, ...d.data() } as any));
        recompute();
      });
      unsubscribers.push(unsub);
    });

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [user, allAppUsers, myUserIds]);

  useEffect(() => {
    if (!conversations.length || !user || !myUserIds.length) return;
  
    const unsubs = conversations.map(conv => {
        const messagesQuery = query(
            collection(firestore, 'conversations', conv.id, 'messages'),
            orderBy('timestamp', 'asc')
        );
        return onSnapshot(messagesQuery, async (snapshot) => {
            const newMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
            const visibleMessages = newMessages.filter((message) => !(message.deletedFor || []).includes(user.uid));
            setMessages(prev => ({ ...prev, [conv.id]: visibleMessages }));
  
            const unreadCount = visibleMessages.filter(m => myUserIds.includes(m.receiverId) && m.status !== "read").length;
            setUnreadCounts(prev => ({...prev, [conv.id]: unreadCount}));

            const batch = writeBatch(firestore);
            let hasUpdates = false;
            snapshot.docs.forEach(docSnap => {
                const msg = docSnap.data();
                if (myUserIds.includes(msg.receiverId) && msg.status === "sent") {
                    batch.update(docSnap.ref, { status: "delivered" });
                    hasUpdates = true;
                }
            });

            if (hasUpdates) {
                await batch.commit();
            }
        });
    });
  
    return () => unsubs.forEach(unsub => unsub());
  
  }, [conversations, user, myUserIds]);

  useEffect(() => {
    const totalUnreadMessages = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
    setUnreadMessages(totalUnreadMessages);
  }, [unreadCounts]);

   useEffect(() => {
    if (!myUserIds.length) {
      setUnreadAlerts(0);
      setUnreadAutoAlerts(0);
      return;
    }
    // Sirf owner + selected company ke alerts — badge/count dusri company se mix na ho.
    if (company?.isOwned !== true || !companyId?.trim()) {
      setUnreadAlerts(0);
      setUnreadAutoAlerts(0);
      return;
    }
    const unreadByRecipient: Record<string, Set<string>> = {};
    const unreadIcSystemJoinsByRecipient: Record<string, Set<string>> = {};
    const unsubscribers: Array<() => void> = [];
    const recompute = () => {
      const auto = new Set<string>();
      const regular = new Set<string>();
      const firestoreIcReqIds = new Set<string>();
      Object.values(unreadByRecipient).forEach((set) => {
        set.forEach((raw) => {
          const parts = raw.split("::");
          const idPart = parts[0] || "";
          const kindPart = parts[1] || "";
          const icReqId = parts[2] || "";
          if (kindPart === "auto_created") auto.add(idPart);
          else {
            regular.add(idPart);
            if (kindPart === "ic_reverse_pending" && icReqId) firestoreIcReqIds.add(icReqId);
          }
        });
      });
      Object.values(unreadIcSystemJoinsByRecipient).forEach((set) => {
        set.forEach((id) => regular.add(id));
      });
      const icLocalOnly = 0; // IC reverse-request feature removed
      setUnreadAlerts(regular.size + icLocalOnly);
      setUnreadAutoAlerts(auto.size);
    };

    myUserIds.forEach((id) => {
      const alertsQuery = query(
        collection(firestore, "admin_notifications"),
        where("recipientUserId", "==", id),
        where("companyId", "==", companyId),
        where("isRead", "==", false)
      );
      const unsubAlerts = onSnapshot(alertsQuery, (snapshot) => {
        // Hidden alert types ko unread badge me count na karo.
        unreadByRecipient[id] = new Set(
          snapshot.docs
            .filter((d) => !isSuppressibleNewTransactionAlert(d.data() as any))
            .map((d) => {
              const data = d.data() as { kind?: string; interCompanyRequestId?: string };
              return `${d.id}::${String(data?.kind || "")}::${String(data?.interCompanyRequestId || "")}`;
            })
        );
        recompute();
      });
      unsubscribers.push(unsubAlerts);

      const systemJoinAlertsQuery = query(
        collection(firestore, "admin_notifications"),
        where("recipientUserId", "==", id),
        where("kind", "==", "ic_system_join_pending"),
        where("isRead", "==", false)
      );
      const unsubIcSystemJoin = onSnapshot(systemJoinAlertsQuery, (snapshot) => {
        const next = new Set<string>();
        snapshot.docs.forEach((d) => {
          if (interCompanySystemJoinAlertVisibleForCompany(d.data() as Record<string, unknown>, companyId)) {
            next.add(d.id);
          }
        });
        unreadIcSystemJoinsByRecipient[id] = next;
        recompute();
      });
      unsubscribers.push(unsubIcSystemJoin);
    });

    window.addEventListener(IC_ALERTS_CHANGED, recompute);

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      window.removeEventListener(IC_ALERTS_CHANGED, recompute);
    };
  }, [myUserIds, company?.isOwned, companyId]);
  
  const handleConversationSelect = useCallback((conversation: any) => {
    if (!conversation || !user) return;
    userSelectedConversationIdRef.current = conversation.id;
    setSelectedConversation(conversation);
    localStorage.setItem('selectedConversationId', conversation.id);
  }, [user]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const markAsRead = async () => {
      if (activeTabRef.current !== "chat" || !user || !myUserIds.length) return;
      if (isMobile && mobileChatView !== "chat") return;
      const convoId = userSelectedConversationIdRef.current ?? selectedConversation?.id;
      if (!convoId) return;
      const messagesForSelectedConvo = messages[convoId] || [];
      const unread = messagesForSelectedConvo.filter(m => myUserIds.includes(m.receiverId) && m.status !== 'read');
      if (unread.length === 0) return;
      const batch = writeBatch(firestore);
      unread.forEach(msg => {
        const msgRef = doc(firestore, 'conversations', convoId, 'messages', msg.id);
        batch.update(msgRef, { status: 'read' });
      });
      try {
        await batch.commit();
      } catch (error) {
        console.error("Failed to mark messages as read:", error);
      }
    };
    markAsRead();
  }, [activeTab, selectedConversation?.id, messages, user, myUserIds, isMobile, mobileChatView]);
  
    const allPotentialContacts = useMemo(() => {
    if (!user || allAppUsers.length === 0 || userCompanies.length === 0) return [];

    const contactMap = new Map<string, { user: any, companies: Set<string>, sources: Set<string> }>();

    const processEntity = (entity: any, type: string, companyName: string) => {
        if (entity.email) {
            const appUser = allAppUsers.find(u => u.email === entity.email);
            const appUserUid = appUser?.uid || appUser?.id;
            if (appUser && appUserUid && appUserUid !== user.uid) {
                if (!contactMap.has(appUserUid)) {
                    contactMap.set(appUserUid, { user: { ...appUser, id: appUserUid }, companies: new Set(), sources: new Set() });
                }
                const contact = contactMap.get(appUserUid)!;
                contact.companies.add(companyName);
                contact.sources.add(type);
            }
        }
    };
    
    userCompanies.forEach(c => {
        // If the current user is not the owner of the company, add the owner as a potential contact.
        if (c.ownerId !== user.uid && c.ownerEmail) {
            processEntity({ email: c.ownerEmail }, 'Company Owner', c.name);
        }
        (c.sharedWith || []).forEach((sharedUser: any) => processEntity({email: sharedUser.email}, 'Shared User', c.name));
    });

    processedParties.forEach(p => processEntity(p, 'Party', company?.name || 'Current'));
    processedStaff.forEach(s => processEntity(s, 'Staff', company?.name || 'Current'));
    
    const finalContacts = new Map<string, any>();
    
    for (const contact of contactMap.values()) {
        const email = contact.user.email;
        if (!finalContacts.has(email)) {
            finalContacts.set(email, {
                ...contact.user,
                associatedCompanies: new Set(contact.companies),
                sources: new Set(contact.sources),
            });
        } else {
            const existing = finalContacts.get(email);
            contact.companies.forEach(c => existing.associatedCompanies.add(c));
            contact.sources.forEach(s => existing.sources.add(s));
        }
    }

    conversations.forEach(conv => {
        const otherUserId = conv.participants.find((pId: string) => pId !== user.uid);
        if (otherUserId) {
            const userInConv = findUserByParticipantId(allAppUsers, otherUserId);
            if (userInConv && !finalContacts.has(userInConv.email)) {
                const normalizedId = (userInConv as any).uid || userInConv.id;
                finalContacts.set(userInConv.email, {
                    ...userInConv,
                    id: normalizedId,
                    associatedCompanies: new Set(['Existing Chat']),
                    sources: new Set(['Chat']),
                });
            }
        }
    });

    return Array.from(finalContacts.values()).map(c => ({...c, associatedCompanies: Array.from(c.associatedCompanies)}));

  }, [user, allAppUsers, userCompanies, processedParties, processedStaff, conversations, company]);

  const handleSendInvite = async (inviteEmail: string, inviteMessage: string, setIsInviteDialogOpen: (isOpen: boolean) => void) => {
    if (!inviteEmail || !user) return;
    const userToInviteQuery = query(collection(firestore, "users"), where("email", "==", inviteEmail));
    const userToInviteSnap = await getDocs(userToInviteQuery);
    
    if (!userToInviteSnap.empty) {
        const userToInviteDoc = userToInviteSnap.docs[0];
        const userToInvite = { id: userToInviteDoc.id, ...userToInviteDoc.data() };
        
        const userToInviteUid = (userToInvite as any).uid || userToInvite.id;
        const conversationId = [user.uid, userToInviteUid].sort().join('_');
        const convRef = doc(firestore, 'conversations', conversationId);
        
        let convSnap = await getDoc(convRef);
        if (!convSnap.exists()) {
             await setDoc(convRef, {
                participants: [user.uid, userToInviteUid],
                lastMessageTimestamp: serverTimestamp()
            });
             convSnap = await getDoc(convRef);
        }

        if(inviteMessage) {
            const messagesCol = collection(firestore, 'conversations', conversationId, 'messages');
            await addDoc(messagesCol, {
                text: inviteMessage, senderId: user.uid, receiverId: userToInviteUid,
                timestamp: serverTimestamp(), company: company?.name || 'Personal', status: "sent"
            });
            await updateDoc(convRef, { lastMessageTimestamp: serverTimestamp() });
        }
        
        handleConversationSelect({id: convSnap.id, ...convSnap.data()});
        
        toast.success("Chat Started", { description: `You can now chat with ${inviteEmail}.` });
    } else {
        toast.error("User not found", { description: "No user with this email exists in the app." });
    }
    setIsInviteDialogOpen(false);
  };
  
  const handleStartChatFromAlert = async (otherUserId: string) => {
    if (!user || !otherUserId) {
        toast.error("Cannot start chat. User information is missing.");
        return;
    }

    const conversation = conversations.find(c =>
      Array.isArray(c.participants) && c.participants.includes(otherUserId)
    );

    if (conversation) {
        await handleConversationSelect(conversation);
        setActiveTab('chat');
    } else {
        const userToChatWith = findUserByParticipantId(allAppUsers, otherUserId);
        
        if (userToChatWith) {
            const userToChatWithUid = (userToChatWith as any).uid || userToChatWith.id;
             const conversationId = [user.uid, userToChatWithUid].sort().join('_');
            const convRef = doc(firestore, 'conversations', conversationId);
            
            let convSnap = await getDoc(convRef);
            if (!convSnap.exists()) {
                 await setDoc(convRef, {
                    participants: [user.uid, userToChatWithUid],
                    lastMessageTimestamp: serverTimestamp()
                });
                 convSnap = await getDoc(convRef);
            }
            if (convSnap.exists()) {
                await handleConversationSelect({id: convSnap.id, ...convSnap.data()});
                setActiveTab('chat');
            }
        } else {
            toast.error("User not found", { description: "Cannot initiate chat with this user." });
        }
    }
  };

  const selectedMessages = selectedConversation ? messages[selectedConversation.id] || [] : [];

  const handleOpenVoucherFromAlert = useCallback(
    async (alertCompanyId: string, voucherId: string) => {
      setCompanyId(alertCompanyId);
      try {
        const snap = await getDoc(doc(firestore, `companies/${alertCompanyId}/vouchers`, voucherId));
        if (snap.exists()) {
          const d = snap.data();
          const dateVal = d.date;
          const voucher = {
            id: snap.id,
            ...d,
            date: dateVal?.toDate ? dateVal.toDate() : dateVal,
          };
          setVoucherToEdit(voucher);
          setVoucherDialogOpen(true);
        } else {
          toast.info("Voucher not found", { description: "It may have been deleted." });
        }
      } catch (e) {
        console.error("Failed to open voucher from alert", e);
        toast.error("Failed to open voucher");
      }
    },
    [setCompanyId]
  );

  const handleOpenHistoryFromAlert = useCallback(
    async (
      alertCompanyId: string,
      voucherId: string,
      notificationTimestamp?: any,
      changedByUid?: string,
      notificationId?: string
    ) => {
      setCompanyId(alertCompanyId);
      try {
        const snap = await getDoc(doc(firestore, `companies/${alertCompanyId}/vouchers`, voucherId));
        if (snap.exists()) {
          const d = snap.data();
          const dateVal = d.date;
          const voucher = {
            id: snap.id,
            ...d,
            date: dateVal?.toDate ? dateVal.toDate() : dateVal,
          };
          // Convert Firestore Timestamp to plain ms number to avoid serialisation issues
          const tsMs = notificationTimestamp?.toDate instanceof Function
            ? notificationTimestamp.toDate().getTime()
            : notificationTimestamp?._seconds != null
            ? notificationTimestamp._seconds * 1000
            : typeof notificationTimestamp === 'number' ? notificationTimestamp
            : null;
          setHistoryHighlightTimestamp(tsMs);
          setHistoryHighlightUid(changedByUid ?? undefined);
          setHistoryNotificationId(notificationId ?? null);
          setHistoryVoucher(voucher);
        } else {
          toast.info("Voucher not found", { description: "It may have been deleted." });
        }
      } catch (e) {
        console.error("Failed to open history from alert", e);
        toast.error("Failed to open history");
      }
    },
    [setCompanyId]
  );

  const handleMarkHistoryAlertAsRead = useCallback(async () => {
    if (!historyNotificationId) return;
    try {
      await updateDoc(doc(firestore, "admin_notifications", historyNotificationId), { isRead: true });
      toast.success("Marked as read");
      setHistoryNotificationId(null);
    } catch (e) {
      console.error("Failed to mark alert as read from history dialog", e);
      toast.error("Failed to mark as read");
    }
  }, [historyNotificationId]);

  return (
    <div className="px-[2px] py-4 sm:py-6 md:py-8 flex flex-col h-full w-full max-w-full">
        {!messagesRadixMounted ? (
          <div
            className="flex flex-1 flex-col min-h-0 w-full gap-2"
            aria-busy="true"
            aria-label="Loading messages"
          >
            <div className="h-10 w-full max-w-md rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-56 rounded bg-muted/70 animate-pulse sm:ml-0 ml-auto" />
            <div className="flex-1 min-h-[240px] rounded-md border border-border/40 bg-muted/15" />
          </div>
        ) : (
          <>
            {/* Single Tabs root: tablist + tabpanels share one Radix context. */}
            <Tabs
              value={activeTab}
              onValueChange={handleTabChange}
              className="flex flex-1 flex-col min-h-0 w-full"
            >
                <div className="flex flex-col gap-2 w-full">
                    <div className={messagesTabRibbonClassName}>
                    <TabsList className={messagesTabListClassName} data-pl-messages-tabs="">
                        <TabsTrigger value="alerts" className={messagesTabTriggerClassName}>
                            <Bell className="h-4 w-4 shrink-0" />
                            <span className="truncate">Alerts</span>
                            {unreadAlerts > 0 && (effectiveNotificationSettings?.transactionAlerts?.onTabs !== false) && (
                              <span className={messagesTabUnreadBadgeClassName}>
                                {unreadAlerts > 99 ? "99+" : unreadAlerts}
                              </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="auto" className={messagesTabTriggerClassName}>
                            <Bot className="h-4 w-4 shrink-0" />
                            <span className="truncate sm:whitespace-normal">Auto Voucher</span>
                            {unreadAutoAlerts > 0 && (effectiveNotificationSettings?.transactionAlerts?.onTabs !== false) && (
                              <span className={messagesTabUnreadBadgeClassName}>
                                {unreadAutoAlerts > 99 ? "99+" : unreadAutoAlerts}
                              </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="chat" className={messagesTabTriggerClassName}>
                            {!isMobile ? <MessageSquare className="h-4 w-4 shrink-0" /> : null}
                            <span className="truncate">Chat</span>
                            {unreadMessages > 0 && (
                              <span className={messagesTabUnreadBadgeClassName}>
                                {unreadMessages > 99 ? "99+" : unreadMessages}
                              </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="alarms" className={messagesTabTriggerClassName}>
                            <AlarmPlus className="h-4 w-4 shrink-0" />
                            <span className="truncate">Alarms</span>
                        </TabsTrigger>
                    </TabsList>
                    </div>
                    <CardDescription className="text-green-500 whitespace-nowrap text-right sm:text-left">Online from: <span className="font-semibold text-foreground">{company?.name || 'Personal Account'}</span></CardDescription>
                </div>
                <TabsContent value="alerts" className="h-full flex-1 min-h-0 w-full data-[state=inactive]:hidden">
                    <AlertsTab
                      onStartChat={handleStartChatFromAlert}
                      onOpenVoucher={handleOpenVoucherFromAlert}
                      onOpenHistory={handleOpenHistoryFromAlert}
                      kindFilter="exclude_auto"
                    />
                </TabsContent>
                <TabsContent value="auto" className="h-full flex-1 min-h-0 w-full data-[state=inactive]:hidden">
                    <AlertsTab
                      onOpenVoucher={handleOpenVoucherFromAlert}
                      onOpenHistory={handleOpenHistoryFromAlert}
                      kindFilter="auto_only"
                      headerTitle="Auto Created Vouchers"
                      headerDescription="Monthly recurring vouchers generated by automation appear here."
                    />
                </TabsContent>
                <TabsContent value="chat" className="h-full flex-1 min-h-0 w-full data-[state=inactive]:hidden">
                     <ChatTab 
                        conversations={conversations}
                        allPotentialContacts={allPotentialContacts}
                        onConversationSelect={handleConversationSelect}
                        selectedConversation={selectedConversation}
                        allAppUsers={allAppUsers}
                        messages={selectedMessages}
                        unreadCounts={unreadCounts}
                        handleSendInvite={handleSendInvite}
                        statuses={statuses}
                        unreadAlertsCount={unreadAlerts}
                        showAlertsOnList={
                          effectiveNotificationSettings?.transactionAlerts?.on !== false &&
                          effectiveNotificationSettings?.transactionAlerts?.onList !== false
                        }
                        onMobileViewChange={setMobileChatView}
                     />
                </TabsContent>
                <TabsContent value="alarms" className="h-full flex-1 min-h-0 w-full data-[state=inactive]:hidden">
                    <AlarmsTab />
                </TabsContent>
            </Tabs>
            <AddVoucherDialog
              isOpen={voucherDialogOpen}
              onOpenChange={setVoucherDialogOpen}
              voucher={voucherToEdit}
              onVoucherAction={() => {
                setVoucherToEdit(null);
                setVoucherDialogOpen(false);
              }}
            />
            <HistoryDialog
              voucher={historyVoucher}
              isOpen={!!historyVoucher}
              onOpenChange={(open) => {
                if (!open) {
                  setHistoryVoucher(null);
                  setHistoryHighlightTimestamp(null);
                  setHistoryHighlightUid(undefined);
                  setHistoryNotificationId(null);
                }
              }}
              onHistoryReset={() => setHistoryVoucher((prev: any) => (prev ? { ...prev, history: [] } : null))}
              highlightTimestamp={historyHighlightTimestamp}
              highlightUid={historyHighlightUid}
              onMarkAsReadFromAlert={historyNotificationId ? handleMarkHistoryAlertAsRead : undefined}
            />
          </>
        )}
    </div>
  );
}
