
"use client";

import { updateDoc, writeBatch, deleteDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, MailOpen, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { collection, query, where, doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "sonner";
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


type Notification = {
  id: string;
  message: string;
  timestamp: any;
  isRead: boolean;
  context?: string;
  entityId?: string;
};

export function NotificationBell({ context, entityId }: { context: string, entityId: string }) {
  const { companyId } = useCompany();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [itemToDelete, setItemToDelete] = useState<Notification | null>(null);

  useEffect(() => {
    if (!companyId || !entityId || !context) return;
    
    const q = query(
      collection(firestore, "admin_notifications"),
      where("companyId", "==", companyId),
      where("entityId", "==", entityId),
      where("context", "==", context)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));
      setNotifications(notifs);
    });

    return () => unsubscribe();
  }, [companyId, entityId, context]);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    const batch = writeBatch(firestore);
    notifications.forEach(n => {
      if (!n.isRead) {
        batch.update(doc(firestore, "admin_notifications", n.id), { isRead: true });
      }
    });
    await batch.commit();
  };

  const handleDelete = async (id: string) => {
    try {
        await deleteDoc(doc(firestore, "admin_notifications", id));
        toast.success("Notification deleted.");
    } catch (e) {
        toast.error("Failed to delete notification.");
    } finally {
        setItemToDelete(null);
    }
  }

  if (notifications.length === 0) {
    return null; // Don't show the bell if there are no notifications for this entity
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{unreadCount}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0">
          <div className="p-4 border-b">
            <h4 className="font-medium leading-none">Notifications</h4>
            <p className="text-sm text-muted-foreground">Alerts for this entity.</p>
          </div>
          <ScrollArea className="h-80">
            <div className="p-4 space-y-3">
              {notifications.length > 0 ? (
                notifications.map((n) => (
                   <div key={n.id} className={cn("p-2 border rounded-md text-sm", !n.isRead && "bg-blue-50")}>
                        <p>{n.message}</p>
                        <div className="flex justify-between items-center mt-1">
                            <p className="text-xs text-muted-foreground">
                                {n.timestamp?.toDate ? formatDistanceToNow(n.timestamp.toDate(), { addSuffix: true }) : ''}
                            </p>
                             <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setItemToDelete(n)}>
                                <Trash2 className="h-4 w-4 text-destructive"/>
                             </Button>
                        </div>
                   </div>
                ))
              ) : (
                <p className="text-sm text-center text-muted-foreground py-4">No notifications found.</p>
              )}
            </div>
          </ScrollArea>
           {unreadCount > 0 && (
             <div className="p-2 border-t">
                <Button variant="ghost" size="sm" className="w-full justify-center" onClick={handleMarkAllRead}>
                    <MailOpen className="mr-2 h-4 w-4"/>Mark all as read
                </Button>
             </div>
           )}
        </PopoverContent>
      </Popover>
      <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notification?</AlertDialogTitle>
            <AlertDialogDescription>This will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => itemToDelete && handleDelete(itemToDelete.id)} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
