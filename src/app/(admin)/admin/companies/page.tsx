
"use client"
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { firestore as db } from '@/lib/firebase'
import {
  collection,
  doc,
  updateDoc,
  Timestamp,
  query,
} from 'firebase/firestore';
import { getDocs, getDoc } from '@/lib/pocketbaseData/pbReadSeam';
import { useEffect, useState, useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyList } from '@/components/admin/CompanyList'
import { CompanyDetails } from '@/components/admin/CompanyDetails'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { Plan, PlanId } from '@/config/plans'
import { DEFAULT_PLANS } from '@/config/plans'

export type Company = {
  id: string;
  name: string;
  planId?: PlanId;
  planExpiry: Timestamp;
  settings?: Record<string, boolean>;
  ownerId: string;
  ownerEmail?: string;
  [key: string]: any;
};

// Add User type
type User = {
  id: string;
  displayName: string;
  email: string;
  photoURL?: string;
};

// New grouped structure
export type GroupedCompany = {
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhotoURL?: string;
    companies: Company[];
}


export default function CompaniesPage() {
  useAdminAccess(['SuperAdmin'])
  const [rows, setRows] = useState<Company[]>([]) // This will still hold the flat list of companies
  const [users, setUsers] = useState<User[]>([]); // New state for users
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    (async () => {
      // Fetch all data in parallel
      const [companiesSnap, usersSnap, plansSnap] = await Promise.all([
          getDocs(collection(db, 'companies')),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'app_settings', 'plans', 'plans')),
      ]);

      const companyList = companiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Company));
      setRows(companyList);

      const userList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
      setUsers(userList);

      // Select first company if none selected
      if (companyList.length > 0 && !selectedCompany) {
        setSelectedCompany(companyList[0]);
      }

      // Process plans
      const firestorePlans = (await getDoc(doc(db, "app_settings", "plans"))).data() as Record<PlanId, Plan>;
      if (firestorePlans) {
          const mergedPlans = Object.values(DEFAULT_PLANS).map(defaultPlan => ({
              ...defaultPlan,
              ...(firestorePlans[defaultPlan.id] || {}),
          }));
          setPlans(mergedPlans);
      } else {
          setPlans(Object.values(DEFAULT_PLANS));
      }

      setLoading(false)
    })()
  }, []) // Remove dependencies to run only once

  const handleUpdateCompany = (updatedCompany: Company) => {
    setRows(prev => prev.map(c => c.id === updatedCompany.id ? updatedCompany : c));
    if (selectedCompany?.id === updatedCompany.id) {
        setSelectedCompany(updatedCompany);
    }
  }

  /** Admin plan/expiry: same `ownerId` ki saari rows ek saath UI me sync. */
  const handleSeveralCompaniesUpdated = (updatedList: Company[]) => {
    setRows((prev) => {
      const m = new Map(updatedList.map((u) => [u.id, u] as const));
      return prev.map((c) => m.get(c.id) ?? c);
    });
    setSelectedCompany((prev) => {
      if (!prev) return null;
      const hit = updatedList.find((u) => u.id === prev.id);
      return hit ?? prev;
    });
  };

  const companiesSameOwner = useMemo(() => {
    if (!selectedCompany) return [];
    const oid = String(selectedCompany.ownerId ?? "").trim();
    if (!oid) return [selectedCompany];
    const list = rows.filter((c) => String(c.ownerId ?? "").trim() === oid);
    return list.length > 0 ? list : [selectedCompany];
  }, [rows, selectedCompany]);

  // Memoized logic to group companies by owner
  const groupedAndFilteredCompanies: GroupedCompany[] = useMemo(() => {
    if (users.length === 0 || rows.length === 0) return [];
    
    const userMap = new Map<string, User>();
    users.forEach(user => userMap.set(user.id, user));

    const grouped = new Map<string, GroupedCompany>();

    rows.forEach(company => {
        const ownerId = company.ownerId;
        const owner = userMap.get(ownerId);
        
        if (owner) {
            if (!grouped.has(ownerId)) {
                grouped.set(ownerId, {
                    ownerId: owner.id,
                    ownerName: owner.displayName,
                    ownerEmail: owner.email,
                    ownerPhotoURL: owner.photoURL,
                    companies: []
                });
            }
            grouped.get(ownerId)!.companies.push(company);
        }
    });

    let result = Array.from(grouped.values());

    if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        result = result.map(group => {
            const ownerMatches = group.ownerName.toLowerCase().includes(lowerSearch) || group.ownerEmail.toLowerCase().includes(lowerSearch);
            const matchingCompanies = group.companies.filter(c => 
                c.name.toLowerCase().includes(lowerSearch) || 
                c.id.toLowerCase().includes(lowerSearch)
            );

            // If owner matches, show all their companies. Otherwise, show only matching companies.
            if (ownerMatches) {
                return group;
            }
            if (matchingCompanies.length > 0) {
                return { ...group, companies: matchingCompanies };
            }
            return null;

        }).filter((g): g is GroupedCompany => g !== null);
    }

    return result;
  }, [rows, users, searchTerm]);


  if (loading) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-6 h-full p-6">
            <div>
                <Skeleton className="h-12 w-full mb-4" />
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
    <div className="h-full p-6">
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-6 h-full min-h-0">
            {/* LEFT */}
            <div className="flex flex-col h-full min-h-0 gap-4">
                <Card className="shrink-0">
                    <CardHeader>
                        <CardTitle>Companies</CardTitle>
                        <CardDescription>Select a company to manage its settings.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name, ID, or owner..."
                                className="pl-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </CardContent>
                </Card>
                 <div className="flex-1 min-h-0">
                    <CompanyList 
                        groupedCompanies={groupedAndFilteredCompanies}
                        selectedCompany={selectedCompany}
                        onSelectCompany={setSelectedCompany}
                    />
                </div>
            </div>

            {/* RIGHT */}
            <div className="h-full min-h-0 overflow-hidden">
                {selectedCompany ? (
                    <CompanyDetails
                        company={selectedCompany}
                        sameOwnerCompanies={companiesSameOwner}
                        onUpdate={handleUpdateCompany}
                        onSeveralCompaniesUpdated={handleSeveralCompaniesUpdated}
                        plans={plans}
                    />
                ): (
                    <Card className="h-full flex items-center justify-center">
                        <CardContent className="text-center">
                            <p className="text-muted-foreground">No company selected.</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    </div>
  )
}
