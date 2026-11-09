
'use client'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { listUsers } from '@/hooks/useFirestore'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Users, UserCheck, UserX } from 'lucide-react'
import { UserList } from '@/components/admin/UserList'
import { UserDetails } from '@/components/admin/UserDetails'
import {
  collection,
  query,
  doc,
  DocumentData,
} from '@/lib/pbCompat/firestore';
import { getDocs, onSnapshot } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore as db } from '@/lib/plClientSession'
import type { Company } from '@/app/(admin)/admin/companies/page';
import type { Role } from "@/utils/rbac";
import { PRESENCE_ONLINE_THRESHOLD_MS } from "@/lib/presenceConstants";


export type AppUser = {
  id: string;
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  companyId: string | null;
  isActive: boolean;
  online?: boolean;
  lastSeen?: any;
  [key: string]: any;
};

export default function UsersPage() {
  const { user } = useAdminAccess(['SuperAdmin', 'CompanyAdmin'])
  const [rows, setRows] = useState<AppUser[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null)
  const [searchTerm, setSearchTerm] = useState("")


  useEffect(() => {
    (async () => {
      if (!user) return
      setLoading(true);

      const isSuperAdmin = user.role === 'SuperAdmin';
      
      const usersQuery = collection(db, 'users');
      const companiesSnapPromise = getDocs(collection(db, 'companies'));

      const unsubUsers = onSnapshot(usersQuery, (usersSnapshot) => {
        const allUsersList = usersSnapshot.docs.map(u => {
            const data = u.data();
            return { id: u.id, uid: data.uid || u.id, ...data } as AppUser;
        });
        setAllUsers(allUsersList);
        
        const usersList = isSuperAdmin ? allUsersList : allUsersList.filter(u => u.companyId === user.companyId);
        setRows(usersList);

        // Persistance and auto-selection logic
        if (!selectedUser) {
            const savedUserId = localStorage.getItem('selectedAdminUserId');
            const userToSelect = savedUserId ? usersList.find(u => u.id === savedUserId) : null;
            if (userToSelect) {
              setSelectedUser(userToSelect);
            } else if (usersList.length > 0) {
              setSelectedUser(usersList[0]);
            }
        }
        setLoading(false);
      });
      
      const companiesSnap = await companiesSnapPromise;
      const companiesList = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Company));
      setAllCompanies(companiesList);
      
      return () => unsubUsers();
    })()
  }, [user, selectedUser]) // Re-run if user context changes
  
  const handleSelectUser = useCallback((userToSelect: AppUser) => {
    setSelectedUser(userToSelect);
    localStorage.setItem('selectedAdminUserId', userToSelect.id);
  }, []);

  const handleUpdateUser = (updatedUser: AppUser) => {
    const updateUserInList = (list: AppUser[]) => list.map(u => u.id === updatedUser.id ? updatedUser : u);
    setRows(prev => updateUserInList(prev));
    setAllUsers(prev => updateUserInList(prev));

    if (selectedUser?.id === updatedUser.id) {
        setSelectedUser(updatedUser);
    }
  }

  const filteredUsers = useMemo(() => {
    return rows.filter(u => 
      (u.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      u.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [rows, searchTerm]);

  const { ownedCompanies, sharedCompanies } = useMemo(() => {
    if (!selectedUser || !selectedUser.email) return { ownedCompanies: [], sharedCompanies: [] };
    const owned = allCompanies.filter(c => c.ownerId === selectedUser.id);
    const shared = allCompanies.filter(c => c.sharedWithEmails?.includes(selectedUser.email!) && c.ownerId !== selectedUser.id);
    return { ownedCompanies: owned, sharedCompanies: shared };
  }, [selectedUser, allCompanies]);

  const userStats = useMemo(() => {
    const userList = user?.role === 'SuperAdmin' ? allUsers : rows;
    const total = userList.length;
    const active = userList.filter(u => u.isActive !== false).length;
    const inactive = total - active;
    const now = Date.now();
    const online = userList.filter(u => u.lastSeen?.toDate && (now - u.lastSeen.toDate().getTime() < PRESENCE_ONLINE_THRESHOLD_MS)).length;
    const offline = total - online;

    return { total, active, inactive, online, offline };
  }, [rows, allUsers, user]);


  if (loading) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-6 h-full">
            <div>
                <Skeleton className="h-12 w-full mb-4" />
                <Skeleton className="h-24 w-full mb-4" />
                <Skeleton className="h-20 w-full mb-2" />
                <Skeleton className="h-20 w-full mb-2" />
                <Skeleton className="h-20 w-full mb-2" />
            </div>
            <div>
                 <Skeleton className="h-full w-full" />
            </div>
        </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-6 h-full">
        <div className="flex flex-col gap-4">
            <Card>
                <CardHeader>
                    <CardTitle>Users Status</CardTitle>
                    <CardDescription>A quick overview of user statistics.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                    <div className="flex justify-between items-center border-b pb-2">
                        <span className="text-sm font-medium text-muted-foreground">Total Users</span>
                        <span className="font-bold text-lg">{userStats.total}</span>
                    </div>
                     <div className="flex justify-between items-center border-b pb-2">
                        <span className="text-sm font-medium text-muted-foreground">Active Users</span>
                        <span className="font-bold text-lg text-green-600">{userStats.active}</span>
                    </div>
                     <div className="flex justify-between items-center pb-2 border-b">
                        <span className="text-sm font-medium text-muted-foreground">Inactive Users</span>
                        <span className="font-bold text-lg text-red-600">{userStats.inactive}</span>
                    </div>
                     <div className="flex justify-between items-center pb-2 border-b">
                        <span className="text-sm font-medium text-muted-foreground">Online Users</span>
                        <span className="font-bold text-lg text-blue-600">{userStats.online}</span>
                    </div>
                     <div className="flex justify-between items-center pb-2 border-b">
                        <span className="text-sm font-medium text-muted-foreground">Offline Users</span>
                        <span className="font-bold text-lg text-gray-500">{userStats.offline}</span>
                    </div>
                     <div className="relative pt-4 mt-4 border-t">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name, email, or ID..."
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </CardContent>
            </Card>
            <UserList 
                users={filteredUsers}
                selectedUser={selectedUser}
                onSelectUser={handleSelectUser}
            />
        </div>
        <div>
            {selectedUser ? (
                <UserDetails 
                    user={selectedUser} 
                    allUsers={allUsers}
                    onUpdate={handleUpdateUser} 
                    currentUser={user as AppUser}
                    ownedCompanies={ownedCompanies}
                    sharedCompanies={sharedCompanies}
                    isOnline={selectedUser.lastSeen?.toDate && (Date.now() - selectedUser.lastSeen.toDate().getTime()) < PRESENCE_ONLINE_THRESHOLD_MS}
                />
            ): (
                <Card className="h-full flex items-center justify-center">
                    <CardContent className="text-center">
                        <p className="text-muted-foreground">No user selected.</p>
                    </CardContent>
                </Card>
            )}
        </div>
    </div>
  )
}

    