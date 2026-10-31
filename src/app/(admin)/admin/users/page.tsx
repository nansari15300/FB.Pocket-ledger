
'use client'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search, Users, UserCheck, UserX } from 'lucide-react'
import { UserList } from '@/components/admin/UserList'
import { UserDetails } from '@/components/admin/UserDetails'
import {
  collection,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
} from '@/lib/pbCompat/firestore';
import { getDocs, onSnapshot } from '@/lib/pocketbaseData/pbReadSeam';
import { firestore as db } from '@/lib/firebase'
import type { Company } from '@/app/(admin)/admin/types';
import type { Role } from "@/utils/rbac";
import { computePresenceLooksOnline } from "@/lib/presenceDisplay";


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

/** `id` = Firestore document id (unique key + `doc('users',id)`); `data().id` spread se overwrite na ho — duplicate rows / keys. */
function mapUsersCollectionDoc(u: QueryDocumentSnapshot<DocumentData>): AppUser {
  const d = u.data();
  return {
    ...d,
    id: u.id,
    uid: String(d.uid ?? d.id ?? u.id),
  } as AppUser;
}

/** Ek hi Firebase `uid` (ya email) ke duplicate `users` docs — ek row; bina uid wale ko `doc:id` se unique rakho. */
function dedupeAdminUserRows(users: AppUser[]): AppUser[] {
  const keyOf = (u: AppUser) => {
    const uid = String(u.uid || "").trim().toLowerCase();
    if (uid) return `uid:${uid}`;
    const em = String(u.email || "").trim().toLowerCase();
    if (em) return `email:${em}`;
    return `doc:${u.id}`;
  };
  const out = new Map<string, AppUser>();
  for (const u of users) {
    const k = keyOf(u);
    const prev = out.get(k);
    if (!prev) {
      out.set(k, u);
      continue;
    }
    const prefer =
      u.id === u.uid && prev.id !== prev.uid
        ? u
        : prev.id === prev.uid && u.id !== u.uid
          ? prev
          : String(u.id).length <= String(prev.id).length
            ? u
            : prev;
    out.set(k, prefer);
  }
  return [...out.values()];
}


export default function UsersPage() {
  const { user } = useAdminAccess(['SuperAdmin', 'CompanyAdmin'])
  const [rows, setRows] = useState<AppUser[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]); // For live stats
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  
  useEffect(() => {
    if (!user?.uid) return;

    // One-time fetch for the initial, stable list
    const doInitialFetch = async () => {
      setLoading(true);
      const usersQuery = query(collection(db, 'users'));
      const companiesQuery = query(collection(db, 'companies'));

      try {
        const [usersSnapshot, companiesSnapshot] = await Promise.all([
            getDocs(usersQuery),
            getDocs(companiesQuery)
        ]);
        
        const mappedAll = usersSnapshot.docs.map(mapUsersCollectionDoc);

        const companiesList = companiesSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Company));

        // SuperAdmin: saari global `users` rows (slug doc + `users/{uid}` dono); `id===uid` filter hata — warna zyada users hide ho jaate.
        let usersToList: AppUser[] = [];
        if (user.role === 'SuperAdmin') {
            usersToList = dedupeAdminUserRows(mappedAll);
        } else if (user.companyId) {
            const currentCompany = companiesList.find(c => c.id === user.companyId);
            if (currentCompany) {
                const memberEmails = new Set([currentCompany.ownerEmail, ...(currentCompany.sharedWithEmails || [])].filter(Boolean));
                usersToList = dedupeAdminUserRows(
                  mappedAll.filter((u) => u.email && memberEmails.has(u.email)),
                );
            }
        }
        
        setRows(usersToList);

        if (usersToList.length > 0 && !selectedUser) {
            const savedUserId = localStorage.getItem('selectedAdminUserId');
            const userToSelect = savedUserId ? usersToList.find(u => u.id === savedUserId) : null;
            setSelectedUser(userToSelect || usersToList[0]);
        }

      } catch (error) {
        console.error("Error fetching initial user/company data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    doInitialFetch();

    // Live listener for companies and all users (for stats and details)
    const unsubCompanies = onSnapshot(collection(db, 'companies'), (snapshot) => {
        setAllCompanies(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Company)));
    });
    
    const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
        const mapped = snapshot.docs.map(mapUsersCollectionDoc);
        setAllUsers(mapped);
        // SuperAdmin: rows + selected user Firestore se; `dedupeAdminUserRows` = same uid ke duplicate docs ek row.
        if (user?.role === "SuperAdmin") {
          setRows(dedupeAdminUserRows(mapped));
          setSelectedUser((prev) => {
            if (!prev) return prev;
            const next = mapped.find((x) => x.id === prev.id);
            return next ? ({ ...prev, ...next } as AppUser) : prev;
          });
        }
    });


    return () => {
      unsubUsers();
      unsubCompanies();
    };
  }, [user?.uid, user?.role]);

  
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
    const owned = allCompanies.filter(
      (c) => c.ownerId === selectedUser.uid || c.ownerId === selectedUser.id
    );
    const shared = allCompanies.filter(
      (c) =>
        c.sharedWithEmails?.includes(selectedUser.email!) &&
        c.ownerId !== selectedUser.uid &&
        c.ownerId !== selectedUser.id
    );
    return { ownedCompanies: owned, sharedCompanies: shared };
  }, [selectedUser, allCompanies]);

  const userStats = useMemo(() => {
    const raw = user?.role === "SuperAdmin" ? allUsers : rows;
    const userList = dedupeAdminUserRows(raw);
    const total = userList.length;
    const active = userList.filter((u) => u.isActive !== false).length;
    const inactive = total - active;
    const online = userList.filter((u) =>
      computePresenceLooksOnline({ online: u.online, lastSeen: u.lastSeen }),
    ).length;
    const offline = total - online;

    return { total, active, inactive, online, offline };
  }, [allUsers, rows, user]);


  if (loading) {
    // `min-w-0` + minmax: grid column chhoti screen par overflow-x scroll de sake (warna table clip).
    return (
        <div className="grid grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)] gap-6 h-full min-w-0">
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
    <div className="grid grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)] gap-6 h-full min-w-0">
        <div className="flex flex-col gap-4 min-w-0">
            <Card>
                <CardHeader className="p-4">
                    <CardTitle className="text-base font-semibold">Users Status</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 border rounded-lg text-center">
                            <p className="text-xs font-medium text-muted-foreground">Total Users</p>
                            <p className="text-lg font-bold">{userStats.total}</p>
                        </div>
                        <div className="p-2 border rounded-lg text-center">
                            <p className="text-xs font-medium text-muted-foreground">Active Users</p>
                            <p className="text-lg font-bold text-green-600">{userStats.active}</p>
                        </div>
                        <div className="p-2 border rounded-lg text-center">
                            <p className="text-xs font-medium text-muted-foreground">Inactive Users</p>
                            <p className="text-lg font-bold text-red-600">{userStats.inactive}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 border rounded-lg text-center">
                            <p className="text-xs font-medium text-muted-foreground">Online Users</p>
                            <p className="text-lg font-bold text-blue-600">{userStats.online}</p>
                        </div>
                        <div className="p-2 border rounded-lg text-center">
                            <p className="text-xs font-medium text-muted-foreground">Offline Users</p>
                            <p className="text-lg font-bold text-gray-500">{userStats.offline}</p>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-4 pt-0">
                    <div className="relative w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name, email, or ID..."
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </CardFooter>
            </Card>
            <UserList 
                users={filteredUsers}
                selectedUser={selectedUser}
                onSelectUser={handleSelectUser}
            />
        </div>
        <div className="min-w-0 overflow-x-auto">
            {selectedUser ? (
                <UserDetails 
                    user={selectedUser} 
                    allUsers={allUsers}
                    onUpdate={handleUpdateUser} 
                    currentUser={user as AppUser}
                    ownedCompanies={ownedCompanies}
                    sharedCompanies={sharedCompanies}
                    isOnline={computePresenceLooksOnline({ online: selectedUser.online, lastSeen: selectedUser.lastSeen })}
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
