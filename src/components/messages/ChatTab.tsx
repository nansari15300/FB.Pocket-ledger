
"use client";

import { updateDoc, addDoc, deleteDoc, setDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { collection, query, orderBy, doc, arrayUnion, where, serverTimestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDocs, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { useMemo, useRef, useEffect } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, formatDistanceToNow, isSameDay, isToday, isYesterday } from "date-fns";
import { Button } from "@/components/ui/button";
import { UserPlus, Send, Search, MoreVertical, Trash2, Loader2, Check, CheckCheck, MessageSquare, X, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  openShareForReconciliationDialog,
  RECON_CHAT_SHARED_LIST_LINK_LABEL,
} from "@/lib/reconciliation/openShareDialog";
import { reconciliationPagePath } from "@/lib/reconciliation/reconciliationChat";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useDate } from "@/hooks/useDate";
import { useIsMobile } from "@/hooks/use-mobile";

function MessageStatus({ status }: { status: string }) {
  if (status === "sent") {
    return <Check className="h-3 w-3 text-muted-foreground" />;
  }

  if (status === "delivered") {
    return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  }

  if (status === "read") {
    return <CheckCheck className="h-3 w-3 text-blue-500" />;
  }

  return null;
}

const getInitials = (name: string | null | undefined) => {
    if (!name) return "U";
    return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
};

function formatLastSeen(lastChangedMs: number): string {
    const date = new Date(lastChangedMs);
    const now = Date.now();
    const diffMs = now - lastChangedMs;
    if (diffMs < 60 * 1000) return "Last seen just now";
    if (diffMs < 60 * 60 * 1000) return `Last seen ${formatDistanceToNow(date, { addSuffix: true })}`;
    if (isToday(date)) return `Last seen today at ${format(date, "p")}`;
    if (isYesterday(date)) return `Last seen yesterday at ${format(date, "p")}`;
    if (diffMs < 7 * 24 * 60 * 60 * 1000) return `Last seen ${format(date, "EEEE 'at' p")}`;
    return `Last seen ${format(date, "MMM d, yyyy 'at' p")}`;
}

/** Dashboard summary cards jaisa exact ribbon — chat sent/received tone match ke liye. */
const CHAT_MSG_CARD_BASE =
  "pl-chrome-card app-chrome-top-ribbon max-w-[85%] sm:max-w-md border-2 border-foreground/30 p-3 relative shadow-sm";
const CHAT_MSG_SENT_CARD = cn(CHAT_MSG_CARD_BASE, "border-sky-300/70 pl-dashboard-ribbon-sky");
const CHAT_MSG_RECEIVED_CARD = cn(CHAT_MSG_CARD_BASE, "border-emerald-300/70 pl-dashboard-ribbon-emerald");
const CHAT_MSG_SYSTEM_CARD = cn(CHAT_MSG_CARD_BASE, "border-slate-300/70 pl-dashboard-ribbon-rose border-dashed opacity-90");

export function ChatTab({ conversations, allPotentialContacts, onConversationSelect, selectedConversation, allAppUsers, messages, unreadCounts, handleSendInvite, statuses, unreadAlertsCount = 0, showAlertsOnList = false, onMobileViewChange }: any) {
  const router = useRouter();
  const { user } = useAuth();
  const { effectiveNotificationSettings, company } = useCompany();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const msgSettings = effectiveNotificationSettings?.message;
  const showListNotifications = msgSettings?.on !== false && msgSettings?.onList !== false;
  const [searchTerm, setSearchTerm] = React.useState("");
  const [isInviteDialogOpen, setIsInviteDialogOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteMessage, setInviteMessage] = React.useState("");
  const messageEndRef = useRef<null | HTMLDivElement>(null);
  
  const [messageToDelete, setMessageToDelete] = React.useState<any | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedMessages, setSelectedMessages] = React.useState<Set<string>>(new Set());
  const [mobileView, setMobileView] = React.useState<"list" | "chat">("list");
  const [contactAccountNamesByUserId, setContactAccountNamesByUserId] = React.useState<Record<string, string>>({});
  const isMobile = useIsMobile();
  React.useEffect(() => {
    if (typeof onMobileViewChange === "function") onMobileViewChange(mobileView);
  }, [mobileView, onMobileViewChange]);
  const resolveUserUid = React.useCallback((u: any): string | null => {
    if (!u) return null;
    return u.uid || u.id || null;
  }, []);

  const findUserByParticipantId = React.useCallback((participantId?: string) => {
    if (!participantId) return null;
    return allAppUsers.find((u: any) => u.id === participantId || u.uid === participantId) || null;
  }, [allAppUsers]);

  useEffect(() => {
    if (!Array.isArray(allPotentialContacts) || allPotentialContacts.length === 0) return;
    setContactAccountNamesByUserId((prev) => {
      const next = { ...prev };
      let changed = false;
      allPotentialContacts.forEach((contact: any) => {
        const uid = contact?.id || contact?.uid;
        if (!uid) return;
        const firstCompany = Array.isArray(contact.associatedCompanies) ? contact.associatedCompanies[0] : "";
        if (firstCompany && next[uid] !== firstCompany) {
          next[uid] = firstCompany;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [allPotentialContacts]);

  const conversationsForList = useMemo(() => {
    const list = Array.isArray(conversations) ? [...conversations] : [];
    if (!user?.uid) return list;
    const existingIds = new Set(list.map((c: any) => c.id));
    (allPotentialContacts || []).forEach((contact: any) => {
      const contactId = contact?.id || contact?.uid;
      if (!contactId || contactId === user.uid) return;
      const conversationId = [user.uid, contactId].sort().join("_");
      if (existingIds.has(conversationId)) return;
      list.push({
        id: conversationId,
        participants: [user.uid, contactId],
        lastMessageTimestamp: null,
      });
    });
    return list;
  }, [conversations, allPotentialContacts, user?.uid]);

  const selectedUser = useMemo(() => {
    if (!selectedConversation || !user) return null;
    const otherUserId = selectedConversation.participants.find((id: string) => id !== user.uid);
    return findUserByParticipantId(otherUserId);
  }, [selectedConversation, user, findUserByParticipantId]);

  const isSelectedUserOnline = useMemo(() => {
    if (!selectedUser) return false;
    return statuses[selectedUser.id]?.state === 'online';
  }, [selectedUser, statuses]);

  const selectedUserLastSeen = useMemo(() => {
    if (!selectedUser) return null;
    const lastChanged = statuses[selectedUser.id]?.last_changed ?? statuses[selectedUser.uid]?.last_changed;
    if (lastChanged == null) return null;
    return formatLastSeen(lastChanged);
  }, [selectedUser, statuses]);


  useEffect(() => {
    // Reset selection when conversation changes
    setSelectionMode(false);
    setSelectedMessages(new Set());
  }, [selectedConversation]);

  const handleMessageClick = (msgId: string) => {
    if (selectionMode) {
      setSelectedMessages(prev => {
        const newSet = new Set(prev);
        if (newSet.has(msgId)) {
          newSet.delete(msgId);
        } else {
          newSet.add(msgId);
        }
        
        // If no messages are selected anymore, exit selection mode.
        if (newSet.size === 0) {
            setSelectionMode(false);
        }

        return newSet;
      });
    }
  };

  const handleMessageLongPress = (msgId: string) => {
    setSelectionMode(true);
    setSelectedMessages(new Set([msgId]));
  };
  
  const handleSendMessage = async (text: string, targetUser?: any) => {
    const finalTarget = targetUser || selectedUser;
    if (!text.trim() || !user || !finalTarget) return;
    const targetUid = resolveUserUid(finalTarget);
    if (!targetUid) return;

    const conversationId = [user.uid, targetUid].sort().join('_');
    const messagesCol = collection(firestore, 'conversations', conversationId, 'messages');
    const conversationDocRef = doc(firestore, 'conversations', conversationId);
    
    try {
        await setDoc(
          conversationDocRef,
          {
            participants: [user.uid, targetUid],
            lastMessageTimestamp: serverTimestamp(),
          },
          { merge: true }
        );
        await addDoc(messagesCol, { 
            text: text.trim(), 
            senderId: user.uid, 
            receiverId: targetUid, 
            timestamp: serverTimestamp(), 
            company: company?.name || 'Personal', 
            status: "sent" 
        });
        await updateDoc(conversationDocRef, { lastMessageTimestamp: serverTimestamp() });
    } catch (error) {
        toast.error("Failed to send message.");
    }
  };

  const softDeleteMessageForUser = React.useCallback(
    async (message: any) => {
      if (!selectedConversation?.id || !user?.uid || !message?.id) return;
      const msgRef = doc(
        firestore,
        "conversations",
        selectedConversation.id,
        "messages",
        message.id
      );
      const participants = Array.isArray(selectedConversation.participants)
        ? selectedConversation.participants
        : [];
      const nextDeletedFor = new Set<string>([
        ...((Array.isArray(message.deletedFor) ? message.deletedFor : []) as string[]),
        user.uid,
      ]);
      await updateDoc(msgRef, { deletedFor: arrayUnion(user.uid) });
      // If both participants have deleted, permanently remove from server.
      if (participants.length > 0 && participants.every((uid: string) => nextDeletedFor.has(uid))) {
        await deleteDoc(msgRef);
      }
    },
    [selectedConversation, user?.uid]
  );

  const handleDeleteMessage = async () => {
    if (!messageToDelete || !selectedConversation || !user?.uid) return;
    setIsDeleting(true);
    try {
      await softDeleteMessageForUser(messageToDelete);
    } catch(err) {
      toast.error("Failed to delete message.");
    } finally {
      setIsDeleting(false);
      setMessageToDelete(null);
      setIsDeleteConfirmOpen(false);
    }
  }

  const handleDeleteSelected = async () => {
      if (!selectedConversation || selectedMessages.size === 0 || !user?.uid) return;
      setIsDeleting(true);
      const messageMap = new Map((messages || []).map((m: any) => [m.id, m]));
      const targets = Array.from(selectedMessages)
        .map((msgId) => messageMap.get(msgId))
        .filter(Boolean) as any[];
      try {
          await Promise.all(targets.map((message) => softDeleteMessageForUser(message)));
          toast.success(`${selectedMessages.size} message(s) deleted.`);
      } catch (err) {
          toast.error("Failed to delete messages.");
      } finally {
          setIsDeleting(false);
          setSelectionMode(false);
          setSelectedMessages(new Set());
      }
  };
  
  const handleDeleteConversation = async () => {
    if (!selectedConversation || !user?.uid) return;
    setIsDeleting(true);
    try {
        await Promise.all((messages || []).map((message: any) => softDeleteMessageForUser(message)));
        toast.success("Conversation cleared");
    } catch(err) {
        toast.error("Failed to clear conversation.");
    } finally {
        setIsDeleting(false);
    }
  }
  
  const getMessageDateSeparator = (currentMsg: any, prevMsg: any) => {
    if (!prevMsg || !currentMsg.timestamp) return null; 
    const prevDate = prevMsg.timestamp?.toDate();
    const currentDate = currentMsg.timestamp?.toDate();
    if (!prevDate || !currentDate) return null; 

    if (!isSameDay(prevDate, currentDate)) {
        if (isToday(currentDate)) return 'Today';
        if (isYesterday(currentDate)) return 'Yesterday';
        if (dateSystem === 'Both') return `${formatDate(currentDate)} (${formatDateBS(currentDate)})`;
        return dateSystem === 'AD' ? formatDate(currentDate) : formatDateBS(currentDate);
    }
    return null;
  };
  
  useEffect(() => {
    if(!selectionMode) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, selectionMode]);

  const filteredConversations = useMemo(() => {
    if (!conversationsForList) return [];
    return conversationsForList.filter((conv: any) => {
        const otherUserId = conv.participants.find((pId: string) => pId !== user?.uid);
        const otherUser = findUserByParticipantId(otherUserId);
        
        if (!searchTerm) return true;
        if (!otherUser) return false;

        return (
            otherUser.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            otherUser.email?.toLowerCase().includes(searchTerm.toLowerCase())
        );
    });
  }, [conversationsForList, searchTerm, user, findUserByParticipantId]);

  const showList = !isMobile || mobileView === "list";
  const showChat = !isMobile || mobileView === "chat";

  const handleConversationClick = (conv: any) => {
    onConversationSelect(conv);
    if (isMobile) setMobileView("chat");
  };

  return (
    <div className={cn("h-full gap-0 chat-bg", isMobile ? "flex flex-col" : "grid grid-cols-[300px_1fr]")}>
      {showList && (
      <div className={cn("flex flex-col border-r bg-background h-full", isMobile && "border-r-0")}>
        <div className="p-4 border-b">
          <div className="flex justify-between items-center">
             <h3 className="text-lg font-semibold flex items-center gap-2">
               Conversations
               {showAlertsOnList && unreadAlertsCount > 0 && (
                 <Badge variant="secondary" className="text-xs px-1.5 py-0">{unreadAlertsCount} alert{unreadAlertsCount !== 1 ? "s" : ""}</Badge>
               )}
             </h3>
              <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="icon"><UserPlus className="h-5 w-5"/></Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader><DialogTitle>Invite User to Chat</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                      <Input placeholder="Enter user's email..." value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                      <Textarea placeholder="Initial message (optional)..." value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)} />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>Cancel</Button>
                      <Button onClick={() => handleSendInvite(inviteEmail, inviteMessage, setIsInviteDialogOpen)}>Search & Start Chat</Button>
                    </DialogFooter>
                </DialogContent>
              </Dialog>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search existing contacts..." className="pl-8" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
        <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {filteredConversations.map((conv: any) => {
                  const otherUserId = conv.participants.find((pId: string) => pId !== user?.uid);
                  const otherUser = findUserByParticipantId(otherUserId);
                  const accountName = otherUserId ? contactAccountNamesByUserId[otherUserId] : "";

                  const unreadCount = unreadCounts[conv.id] || 0;
                  const isOnline = otherUser ? (statuses[otherUser.id]?.state === 'online' || statuses[otherUser.uid]?.state === 'online') : false;
                  const otherLastSeen = otherUser ? (statuses[otherUser.id]?.last_changed ?? statuses[otherUser.uid]?.last_changed) : null;

                  return (
                    <div key={conv.id} className={cn("flex flex-col gap-1 p-2 rounded-lg cursor-pointer group", selectedConversation?.id === conv.id ? "bg-muted" : "hover:bg-muted/50")} onClick={() => handleConversationClick(conv)}>
                      <div className="flex items-center gap-3">
                      <Avatar className={cn(
                          "h-10 w-10 p-0.5 border-2 transition-all duration-500", 
                          isOnline ? "border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "border-black"
                      )}>
                        <AvatarImage src={otherUser?.photoURL} className="rounded-full" />
                        <AvatarFallback>{getInitials(otherUser?.displayName ?? "?")}</AvatarFallback>
                      </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{otherUser?.displayName || 'Unknown User'}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {isOnline ? 'Online' : (otherLastSeen != null ? formatLastSeen(otherLastSeen) : (accountName || otherUser?.email || "Unknown account"))}
                          </p>
                        </div>
                        {showListNotifications && unreadCount > 0 && <Badge className="bg-blue-500 hover:bg-blue-600 h-5 min-w-5 flex items-center justify-center p-0">{unreadCount}</Badge>}
                      </div>
                    </div>
                  )
                })}
            </div>
          </ScrollArea>
      </div>
      )}
      
      {showChat && (
      <div className="flex flex-col h-full overflow-hidden min-h-0 flex-1">
        {selectionMode ? (
             <div className="p-3 border-b flex flex-row items-center justify-between bg-blue-500 text-white">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="text-white hover:text-white hover:bg-white/20" onClick={() => { setSelectionMode(false); setSelectedMessages(new Set())}}>
                        <X className="h-5 w-5"/>
                    </Button>
                    <h3 className="font-semibold text-sm">{selectedMessages.size} selected</h3>
                </div>
                <Button variant="ghost" size="icon" className="text-white hover:text-white hover:bg-white/20" onClick={handleDeleteSelected} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5"/>}
                </Button>
            </div>
        ) : (
             <div className="p-3 border-b flex flex-row items-center justify-between bg-muted/30">
                <div className="flex items-center gap-4 min-w-0">
                    {isMobile && (
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMobileView("list")} aria-label="Back to conversations">
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                    )}
                    {selectedUser && (
                      <Avatar className={cn(
                          "h-9 w-9 p-0.5 border-2 transition-all duration-500", 
                          isSelectedUserOnline ? "border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "border-black"
                      )}>
                        <AvatarImage src={selectedUser.photoURL} className="rounded-full" />
                        <AvatarFallback>{getInitials(selectedUser.displayName)}</AvatarFallback>
                      </Avatar>
                    )}
                    <div>
                    <h3 className="font-semibold text-sm">{selectedUser ? selectedUser.displayName : 'Chat'}</h3>
                    {selectedUser && (
                        <p className={cn("text-xs", isSelectedUserOnline ? "text-green-500" : "text-muted-foreground")}>
                            {isSelectedUserOnline ? 'Online' : (selectedUserLastSeen ?? 'Offline')}
                        </p> 
                    )}
                    </div>
                </div>
                {selectedUser && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                       <DropdownMenuItem onClick={() => setSelectionMode(true)}>Select Messages</DropdownMenuItem>
                      <DropdownMenuItem onClick={handleDeleteConversation} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Clear All Messages</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                )}
            </div>
        )}

        {selectedUser ? (
        <>
            <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                <ScrollArea className="flex-1 -mx-4 px-4">
                    <div className="space-y-3">
                        {messages.map((msg: any, index: number) => {
                          const separator = getMessageDateSeparator(msg, index > 0 ? messages[index - 1] : null);
                          const currentStatus = msg.status || (msg.read ? "read" : "delivered");
                          const isSent = msg.senderId === user?.uid;
                          const isSystem = msg.senderId === "system";
                          const reconKind = String(msg.kind || "");
                          const showSharedListLink =
                            !!msg.shareId &&
                            (reconKind === "reconciliation_request" ||
                              reconKind === "reconciliation_request_again" ||
                              String(msg.text || "").includes("Shared list"));
                          const showReconcilePageLink =
                            !!msg.shareId &&
                            (reconKind === "reconciliation_accepted" ||
                              String(msg.text || "").includes("/reconciliation/"));

                          return (
                            <React.Fragment key={msg.id}>
                              {separator && <div className="text-center my-6"><Badge variant="outline" className="bg-background/80 backdrop-blur-sm">{separator}</Badge></div>}
                                <div 
                                  className={cn(
                                    "flex flex-col gap-1 w-full animate-in fade-in slide-in-from-bottom-1 cursor-pointer",
                                    isSent ? "items-end" : "items-start",
                                    selectedMessages.has(msg.id) && "rounded-lg bg-blue-500/10 ring-2 ring-blue-400/30",
                                  )}
                                  onClick={() => handleMessageClick(msg.id)}
                                  onContextMenu={(e) => { e.preventDefault(); handleMessageLongPress(msg.id)}}
                                >
                                  {/* FinancialSummaryCards / dashboard ribbon — sent sky, received emerald */}
                                  <div
                                    className={cn(
                                      isSystem ? CHAT_MSG_SYSTEM_CARD : isSent ? CHAT_MSG_SENT_CARD : CHAT_MSG_RECEIVED_CARD,
                                    )}
                                  >
                                      
                                      {isSystem ? (
                                        <p className="text-[11px] italic text-muted-foreground text-center px-2">{msg.text}</p>
                                      ) : (
                                        <>
                                          <p className="text-[13px] leading-relaxed break-words text-foreground">{msg.text}</p>
                                          {/* Reconcilink — request: Shared list popup; accept: reconcile page */}
                                          {showSharedListLink ? (
                                            <button
                                              type="button"
                                              className={cn(
                                                "mt-2 text-[11px] font-semibold underline",
                                                isSent
                                                  ? "text-sky-800 hover:text-sky-950 dark:text-sky-200"
                                                  : "text-emerald-800 hover:text-emerald-950 dark:text-emerald-200",
                                              )}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openShareForReconciliationDialog({
                                                  tab: "list",
                                                  highlightShareId: String(msg.shareId),
                                                });
                                              }}
                                            >
                                              {RECON_CHAT_SHARED_LIST_LINK_LABEL}
                                            </button>
                                          ) : null}
                                          {showReconcilePageLink && !showSharedListLink ? (
                                            <button
                                              type="button"
                                              className={cn(
                                                "mt-2 text-[11px] font-semibold underline",
                                                isSent
                                                  ? "text-sky-800 hover:text-sky-950 dark:text-sky-200"
                                                  : "text-emerald-800 hover:text-emerald-950 dark:text-emerald-200",
                                              )}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(reconciliationPagePath(String(msg.shareId)), { scroll: false });
                                              }}
                                            >
                                              Go to reconciling page
                                            </button>
                                          ) : null}
                                        </>
                                      )}
                                      
                                      <div className="flex items-center justify-end gap-1.5 mt-2 pt-1 border-t border-black/5 dark:border-white/10">
                                          <p className="text-[9px] opacity-70 font-medium">
                                            {format(msg.timestamp?.toDate() || new Date(), 'p')}
                                          </p>
                                          {isSent && !isSystem && (
                                            <MessageStatus status={currentStatus} />
                                          )}
                                      </div>
                                  </div>
                                </div>
                            </React.Fragment>
                          )
                        })}
                        <div ref={messageEndRef} />
                    </div>
                </ScrollArea>

            </div>
             <div className="p-4 pt-2 flex items-center gap-2 bg-transparent border-t">
                    <Textarea 
                        placeholder="Type a message..." 
                        className="flex-1 min-h-[40px] max-h-[120px] bg-muted/50 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 py-2 resize-none text-[13px] rounded-full px-4"
                        rows={1}
                        onKeyDown={(e) => { 
                          if (e.key === 'Enter' && !e.shiftKey) { 
                            e.preventDefault(); 
                            if(e.currentTarget.value.trim()){
                              handleSendMessage(e.currentTarget.value); 
                              e.currentTarget.value = ""; 
                            }
                          } 
                        }}
                    />
                    <Button 
                      className="rounded-full h-10 w-10 p-0 shrink-0" 
                      onClick={(e) => {
                        const textarea = (e.currentTarget.previousElementSibling as HTMLTextAreaElement);
                        if(textarea.value.trim()){
                          handleSendMessage(textarea.value);
                          textarea.value = "";
                        }
                      }}
                    >
                      <Send className="h-4 w-4"/>
                    </Button>
                </div>
        </>
        ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-2">
                <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
                   <MessageSquare className="h-10 w-10 opacity-20" />
                </div>
                <p className="text-sm font-medium">Select a contact to start messaging</p>
                {isMobile && (
                  <Button variant="outline" onClick={() => setMobileView("list")} className="mt-2">
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back to list
                  </Button>
                )}
            </div>
        )}
      </div>
      )}
      
      {/* Delete Confirmation Alert */}
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message?</AlertDialogTitle>
            <AlertDialogDescription>This message will be permanently removed from your chat history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMessage} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
              {isDeleting ? <Loader2 className="animate-spin h-4 w-4"/> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

    