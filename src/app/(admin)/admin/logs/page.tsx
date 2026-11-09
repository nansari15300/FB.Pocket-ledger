
'use client'
import { useAdminAccess } from '@/hooks/useAdminAccess'
import { firestore as db } from '@/lib/plClientSession'
import {
  collection,
  orderBy,
  query,
  limit,
} from '@/lib/pbCompat/firestore';
import { getDocs } from '@/lib/pocketbaseData/pbReadSeam';
import { useEffect, useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { Company } from '@/app/(admin)/admin/types';

type User = {
    id: string;
    displayName: string;
    email: string;
}

export default function LogsPage() {
  useAdminAccess(['SuperAdmin'])
  const [rows, setRows] = useState<any[]>([])
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const logsQuery = query(collection(db, 'activity_logs'), orderBy('at', 'desc'), limit(200));
      const usersQuery = query(collection(db, 'users'));
      const companiesQuery = query(collection(db, 'companies'));
      
      const [logsSnap, usersSnap, companiesSnap] = await Promise.all([
          getDocs(logsQuery),
          getDocs(usersQuery),
          getDocs(companiesQuery)
      ]);

      setRows(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
      setCompanies(companiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Company)));
      
      setLoading(false)
    })()
  }, [])
  
  const userMap = useMemo(() => {
      const map = new Map<string, User>();
      users.forEach(user => map.set(user.id, user));
      return map;
  }, [users]);
  
  const companyMap = useMemo(() => {
      const map = new Map<string, Company>();
      companies.forEach(company => map.set(company.id, company));
      return map;
  }, [companies]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Logs</CardTitle>
        <CardDescription>Recent activities performed by admins.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[70vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Meta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
                Array.from({length: 10}).map((_, i) => (
                    <TableRow key={i}>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                ))
            ) : rows.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">No logs found.</TableCell>
                </TableRow>
            ) : (
                rows.map(r => {
                    const user = userMap.get(r.byUserId);
                    const company = r.companyId ? companyMap.get(r.companyId) : null;
                    return (
                        <TableRow key={r.id} className="border-t">
                            <TableCell className="p-2 text-xs">{r.at?.toDate ? r.at.toDate().toLocaleString() : ''}</TableCell>
                            <TableCell className="p-2 text-xs">
                                {user ? (
                                    <div>
                                        <p className="font-semibold">{user.displayName}</p>
                                        <p className="text-muted-foreground">{user.email}</p>
                                    </div>
                                ) : r.byUserId}
                            </TableCell>
                            <TableCell className="p-2 text-xs font-mono bg-muted rounded-sm">{r.action}</TableCell>
                            <TableCell className="p-2 text-xs">{company ? company.name : (r.companyId || '-')}</TableCell>
                            <TableCell className="p-2">
                                <pre className="text-xs whitespace-pre-wrap bg-muted/50 p-2 rounded-md">{JSON.stringify(r.meta, null, 2)}</pre>
                            </TableCell>
                        </TableRow>
                    );
                })
            )}
          </TableBody>
        </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
