
"use client";

import { adminServerWriteBlocked } from "@/lib/adminData/adminServerMode";
import { useEffect, useState, useMemo, useCallback } from "react";
import { collection, query, doc, updateDoc } from "firebase/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X, Search, User, Filter, Wallet, Edit } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDate } from "@/hooks/useDate";
import type { DateRange } from "@/components/ui/ad-calendar";
import { AdminPanelDateRangePicker } from "@/components/admin/AdminPanelDateRangePicker";
import { CommissionPayoutDialog } from "@/components/admin/CommissionPayoutDialog";
import { DistributorApplicationDialog } from "@/components/admin/DistributorApplicationDialog";
import { FilePreview } from "@/components/vouchers/FilePreview";


export type Application = {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    pan?: string;
    userId: string;
    status: 'pending' | 'approved' | 'rejected';
    submittedAt: any;
    profilePic?: string;
    commissionBalance?: number;
    documents?: string[];
};

// Placeholder data for commissions - replace with real data logic
const sampleCommissions = [
    { distributorName: 'Nabil Ansari', totalSales: 50000, commissionRate: '5%', totalEarnings: 2500 },
    { distributorName: 'Jane Doe', totalSales: 75000, commissionRate: '5%', totalEarnings: 3750 },
];

export default function AgentsPage() {
  useAdminAccess(['SuperAdmin']);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [activeTab, setActiveTab] = useState<'approved' | 'pending' | 'rejected'>('approved');
  const [searchTerm, setSearchTerm] = useState('');
  const { formatCurrency, dateSystem, formatDate, formatDateBS } = useDate();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [isPayoutOpen, setIsPayoutOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  useEffect(() => {
    const q = query(collection(firestore, "distributor_applications"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          commissionBalance: (Math.random() * 5000) // Placeholder balance
        } as Application));
      setApplications(apps);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching applications:", error);
        setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleUpdateStatus = async (application: Application, status: 'approved' | 'rejected') => {
    if (adminServerWriteBlocked()) return;
    setUpdatingId(application.id);
    try {
      await updateDoc(doc(firestore, "distributor_applications", application.id), { status });
      if (status === 'approved') {
        await updateDoc(doc(firestore, "users", application.userId), { role: "Distributor" });
      }
    } catch (error) {
      console.error("Error updating status:", error);
    } finally {
      setUpdatingId(null);
    }
  };
  
  const filteredApplications = useMemo(() => {
    return applications
      .filter(app => app.status === activeTab)
      .filter(app => app.name.toLowerCase().includes(searchTerm.toLowerCase()) || app.email.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => (b.submittedAt?.toDate() || 0) - (a.submittedAt?.toDate() || 0));
  }, [applications, activeTab, searchTerm]);

  useEffect(() => {
    if (!selectedApplication && filteredApplications.length > 0) {
      setSelectedApplication(filteredApplications[0]);
    } else if (selectedApplication && !filteredApplications.some(app => app.id === selectedApplication.id)) {
      setSelectedApplication(filteredApplications.length > 0 ? filteredApplications[0] : null);
    }
  }, [filteredApplications, selectedApplication]);


  const ApplicantList = ({ data, onSelect }: { data: Application[], onSelect: (app: Application) => void }) => (
    <ScrollArea className="h-[calc(100vh-24rem)]">
        <div className="space-y-2 p-2">
            {data.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No applications found.</div>
            ) : data.map(app => (
                <Card 
                    key={app.id} 
                    className={cn(
                        "p-3 cursor-pointer",
                        selectedApplication?.id === app.id && "bg-muted border-primary"
                    )}
                    onClick={() => onSelect(app)}
                >
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 overflow-hidden">
                            <Avatar><AvatarImage src={app.profilePic} /><AvatarFallback>{app.name[0]}</AvatarFallback></Avatar>
                            <div className="flex-1 truncate">
                                <p className="font-semibold truncate">{app.name}</p>
                                <p className="text-sm text-muted-foreground truncate">{app.email}</p>
                            </div>
                        </div>
                        {app.status === 'approved' && (
                            <div className="text-right flex-shrink-0">
                                <p className={cn("text-sm font-semibold whitespace-nowrap", (app.commissionBalance || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                                    {formatCurrency(app.commissionBalance || 0)}
                                </p>
                                <p className="text-xs text-muted-foreground">Commission</p>
                            </div>
                        )}
                    </div>
                </Card>
            ))}
        </div>
    </ScrollArea>
  );
  
   const HeaderWithFilter = ({ label, className }: { label: string; className?: string }) => (
    <TableHead className={cn("p-0", className)}>
      <div className="flex items-center gap-1 font-bold text-black whitespace-nowrap px-2 py-3">
        <span>{label}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6"><Filter className="h-4 w-4" /></Button>
      </div>
    </TableHead>
  );

  const ApplicantDetails = ({ app }: { app: Application | null }) => {
      if (!app) {
          return (
              <Card className="h-full flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                      <User className="mx-auto h-12 w-12" />
                      <p className="mt-4">Select an applicant to view details</p>
                  </div>
              </Card>
          )
      }
      
      const commissionsForDistributor = sampleCommissions.filter(c => c.distributorName === app.name);
      const promotionCode = app.userId.substring(0, 8).toUpperCase();

      return (
           <Card className="h-full">
                <CardHeader>
                    <div className="flex items-start justify-between">
                         <div className="flex items-center gap-4">
                            <FilePreview file={app.profilePic || ""} onRemove={()=>{}} isAvatar holdAttachmentClipboard={false}>
                                <Avatar className="h-16 w-16 cursor-pointer"><AvatarImage src={app.profilePic} /><AvatarFallback>{app.name[0]}</AvatarFallback></Avatar>
                            </FilePreview>
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    {app.name}
                                     <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setIsEditOpen(true)}>
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                </CardTitle>
                                <CardDescription>{app.address}</CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {app.status === 'pending' && (
                                <div className="flex gap-2">
                                    {updatingId === app.id ? (
                                        <Loader2 className="h-5 w-5 animate-spin"/>
                                    ) : (
                                        <>
                                            <Button size="sm" variant="outline" className="bg-green-100 text-green-700 hover:bg-green-200" onClick={() => handleUpdateStatus(app, 'approved')}>
                                            <Check className="mr-2 h-4 w-4"/>Approve
                                            </Button>
                                            <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(app, 'rejected')}>
                                            <X className="mr-2 h-4 w-4"/>Reject
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}
                            {app.status === 'approved' && (
                                <Button size="sm" onClick={() => setIsPayoutOpen(true)} className="bg-sky-500 hover:bg-sky-600 text-white">
                                    <Wallet className="mr-2 h-4 w-4" />
                                    Payout
                                </Button>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {(app.documents || []).map((docUrl, index) => (
                                    <FilePreview key={index} file={docUrl} onRemove={() => {}} holdAttachmentClipboard={false} />
                                ))}
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-8">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Email</p>
                            <p>{app.email}</p>
                        </div>
                         <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Phone</p>
                            <p>{app.phone}</p>
                        </div>
                         <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">PAN</p>
                            <p>{app.pan || 'N/A'}</p>
                        </div>
                         <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Submitted</p>
                            <p>{app.submittedAt ? formatDistanceToNow(app.submittedAt.toDate(), { addSuffix: true }) : '-'}</p>
                        </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">Status</p>
                            <Badge>{app.status}</Badge>
                        </div>
                        {app.status === 'approved' && (
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Promotion Code</p>
                                <Badge variant="secondary" className="font-mono">{promotionCode}</Badge>
                            </div>
                        )}
                    </div>
                   
                    {app.status === 'approved' && (
                         <div className="border-t pt-8">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold">Distributor Commission Details</h3>
                                <AdminPanelDateRangePicker value={dateRange} onChange={setDateRange} />
                            </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            {dateSystem === 'Both' ? (
                                                <>
                                                    <HeaderWithFilter label="Date (BS)" />
                                                    <HeaderWithFilter label="Date (AD)" />
                                                </>
                                            ) : (
                                                <HeaderWithFilter label="Date" />
                                            )}
                                            <HeaderWithFilter label="Type" />
                                            <HeaderWithFilter label="Voucher No." />
                                            <HeaderWithFilter label="User" />
                                            <HeaderWithFilter label="Taxable Amt" className="text-right" />
                                            <HeaderWithFilter label="Tax %" className="text-right" />
                                            <HeaderWithFilter label="Tax Amt" className="text-right" />
                                            <HeaderWithFilter label="Debit" className="text-right" />
                                            <HeaderWithFilter label="Credit" className="text-right" />
                                            <HeaderWithFilter label="Balance" className="text-right" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {/* Placeholder for commission rows */}
                                        <TableRow>
                                            <TableCell colSpan={dateSystem === 'Both' ? 11 : 10} className="text-center py-8 text-muted-foreground">
                                                No commission data available for this period.
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                        </div>
                    )}
                </CardContent>
           </Card>
      )
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-6 h-full">
        <div className="flex flex-col gap-4">
            <Card>
                  <CardHeader>
                      <CardTitle>Agents &amp; Distributor Management</CardTitle>
                      <CardDescription>Review and manage distributor applications and their commissions.</CardDescription>
                  </CardHeader>
                  <CardContent>
                      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
                          <TabsList className="w-full">
                          <TabsTrigger value="approved" className="flex-1">Approved</TabsTrigger>
                          <TabsTrigger value="pending" className="flex-1">Pending <Badge className="ml-2">{applications.filter(a => a.status === 'pending').length}</Badge></TabsTrigger>
                          <TabsTrigger value="rejected" className="flex-1">Rejected</TabsTrigger>
                          </TabsList>
                      </Tabs>
                      <div className="relative mt-4">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                              placeholder="Search by name or email..."
                              className="pl-9"
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                          />
                      </div>
                  </CardContent>
              </Card>
            <ApplicantList data={filteredApplications} onSelect={setSelectedApplication} />
        </div>
        <div>
              <ApplicantDetails app={selectedApplication} />
        </div>
      </div>
      {selectedApplication && (
        <CommissionPayoutDialog
          agent={selectedApplication}
          isOpen={isPayoutOpen}
          onOpenChange={setIsPayoutOpen}
          onVoucherCreated={() => {}}
        />
      )}
      {selectedApplication && (
        <DistributorApplicationDialog
            application={selectedApplication}
            isOpen={isEditOpen}
            onOpenChange={setIsEditOpen}
            onApplicationUpdated={() => {
                const q = query(collection(firestore, "distributor_applications"));
                onSnapshot(q, (snapshot) => {
                    const apps = snapshot.docs.map(doc => ({ 
                        id: doc.id, 
                        ...doc.data(),
                        commissionBalance: (Math.random() * 5000) 
                    } as Application));
                    setApplications(apps);
                    const updatedSelected = apps.find(app => app.id === selectedApplication.id);
                    if (updatedSelected) {
                        setSelectedApplication(updatedSelected);
                    }
                });
            }}
        />
      )}
    </>
  );
}
