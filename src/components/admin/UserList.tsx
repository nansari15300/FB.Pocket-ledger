
"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/app/(admin)/admin/users/page";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { useEffect, useState } from "react";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore as db } from "@/lib/plClientSession";
import { computePresenceLooksOnline } from "@/lib/presenceDisplay";

const getInitials = (name: string) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

const UserCard = ({ user, isSelected, onSelectUser }: { user: AppUser, isSelected: boolean, onSelectUser: (user: AppUser) => void }) => {
    
    const [isOnline, setIsOnline] = useState(false);

    useEffect(() => {
        if (!user.id) return;
        const unsub = onSnapshot(doc(db, "users", user.id), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                // `online` + `lastSeen` dono — do browser / devices par consistent badge.
                setIsOnline(computePresenceLooksOnline({ online: data.online, lastSeen: data.lastSeen }));
            }
        });
        return () => unsub();
    }, [user.id]);

    return (
        <Card 
            className={cn("p-3 cursor-pointer", isSelected && "bg-muted border-primary")}
            onClick={() => onSelectUser(user)}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 overflow-hidden">
                    <div className={cn(
                        "relative rounded-full p-[2px] transition-all duration-500 shrink-0",
                        isOnline ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]" : "bg-black"
                    )}>
                        <Avatar className="h-9 w-9 border-2 border-background shrink-0">
                            <AvatarImage src={(user as any).photoURL} alt={user.displayName} className="rounded-full object-cover" />
                            <AvatarFallback className="bg-muted text-xs font-bold">{getInitials(user.displayName || user.email)}</AvatarFallback>
                        </Avatar>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <p className="font-semibold truncate">{user.displayName || user.email}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                </div>
                <Badge variant={isOnline ? "default" : "secondary"} className={cn("capitalize text-xs", isOnline ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600")}>
                    {isOnline ? "Online" : "Offline"}
                </Badge>
            </div>
        </Card>
    );
}

interface UserListProps {
    users: AppUser[];
    selectedUser: AppUser | null;
    onSelectUser: (user: AppUser) => void;
}

export function UserList({ users, selectedUser, onSelectUser }: UserListProps) {
    if(users.length === 0) {
        return (
            <div className="text-center text-muted-foreground p-8">
                No users found.
            </div>
        )
    }

    return (
        <ScrollArea className="h-[calc(100vh-22rem)] border rounded-lg">
            <div className="pl-master-list-ul">
                {users.map(user => (
                   <UserCard 
                        key={user.id}
                        user={user}
                        isSelected={selectedUser?.id === user.id}
                        onSelectUser={onSelectUser}
                   />
                ))}
            </div>
        </ScrollArea>
    )
}
