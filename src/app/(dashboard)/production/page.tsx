"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Search, Factory } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useCompany } from "@/hooks/useCompany";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import type { DateRange } from "@/components/ui/ad-calendar";
import { doc, collection, query, where, orderBy } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { usePageMemory } from "@/hooks/usePageMemory";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TransactionsTable } from "@/components/vouchers/TransactionsTable";

type ProductionOrder = {
    id: string;
    productionNumber?: string;
    date: any;
    rawMaterials?: Array<{ itemId: string; itemName: string; quantity: number; unit: string; rate: number; amount: number }>;
    finishedGoods?: Array<{ itemId: string; itemName: string; quantity: number; unit: string; rate: number; amount: number }>;
    totalCost?: number;
    totalOutput?: number;
    narration?: string;
    userId?: string;
    createdAt?: any;
    [key: string]: any;
};

export default function ProductionPage() {
    const { companyId } = useCompany();
    const { user } = useAuth();
    const router = useRouter();
    const { formatCurrency, formatDate, formatDateBS } = useDate();
    const { vouchers: allVouchers, loading: vouchersLoading, processedItems } = useVouchers();
    
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAllOrders, setShowAllOrders] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [userNames, setUserNames] = useState<Record<string, string>>({});
    const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);

    const productionVouchers = useMemo(() => allVouchers.filter(v => v.type === 'production'), [allVouchers]);

    useEffect(() => {
        if (!companyId || !user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        const productionQuery = query(
            collection(firestore, `companies/${companyId}/vouchers`),
            where("type", "==", "production"),
            orderBy('date', 'desc')
        );
        
        const unsub = onSnapshot(productionQuery, (snapshot) => {
            const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ProductionOrder[];
            setProductionOrders(orders);
            setLoading(vouchersLoading);
        }, (error) => {
            console.error("Error fetching production orders:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [companyId, user, vouchersLoading]);

    const fetchUserName = useCallback(async (userId: string): Promise<string> => {
        if (userNames[userId]) return userNames[userId];
        try {
            const userDoc = await getDoc(doc(firestore, 'users', userId));
            if (userDoc.exists()) {
                return userDoc.data().displayName || userDoc.data().email || "Unknown";
            }
        } catch (e) {}
        return "Unknown";
    }, [userNames]);

    useEffect(() => {
        const uids = new Set([...productionOrders.map((t) => t.userId), ...allVouchers.map((t) => t.userId)].filter(Boolean) as string[]);
        uids.forEach(async (uid) => {
            if (!userNames[uid]) {
                const name = await fetchUserName(uid);
                setUserNames((prev) => ({ ...prev, [uid as any]: name }));
            }
        });
    }, [productionOrders, allVouchers, userNames, fetchUserName]);

    // ========== MEMORY LOGIC ==========
    usePageMemory(
        "productionPageState", 
        "orders",
        () => {},
        selectedOrder,                 
        (order) => setSelectedOrder(order),              
        productionOrders, 
        loading           
    );
    // ==================================

    const handleSelectOrder = useCallback((order: ProductionOrder) => {
        setShowAllOrders(false);
        setSelectedOrder(order);
    }, []);
    
    const filteredOrders = useMemo(() => {
        return productionOrders.filter(order => {
            const searchLower = searchTerm.toLowerCase();
            return (
                order.productionNumber?.toLowerCase().includes(searchLower) ||
                order.narration?.toLowerCase().includes(searchLower) ||
                order.rawMaterials?.some(rm => rm.itemName?.toLowerCase().includes(searchLower)) ||
                order.finishedGoods?.some(fg => fg.itemName?.toLowerCase().includes(searchLower))
            );
        });
    }, [productionOrders, searchTerm]);

    const orderTransactions = useMemo(() => {
        if (!selectedOrder) return [];
        return productionVouchers.filter(v => v.id === selectedOrder.id);
    }, [productionVouchers, selectedOrder]);

    const allOrdersEntity = useMemo(() => {
        if (!showAllOrders) return null;
        const totalCost = productionOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
        const totalOutput = productionOrders.reduce((sum, o) => sum + (o.totalOutput || 0), 0);
        return {
            id: 'all',
            productionNumber: 'All Production Orders',
            totalCost: totalCost,
            totalOutput: totalOutput,
            balance: 0,
            openingBalance: 0,
        };
    }, [showAllOrders, productionOrders]);
    
    const totalProduction = useMemo(() => {
        const cost = productionOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
        const output = productionOrders.reduce((sum, o) => sum + (o.totalOutput || 0), 0);
        return { cost, output };
    }, [productionOrders]);

    const currentOrder = showAllOrders ? allOrdersEntity : selectedOrder;
    const currentTransactions = showAllOrders ? productionVouchers : orderTransactions;

    if (loading) {
        return (
          <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 p-4 h-full">
            <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-full w-full" /></div>
            <div className="space-y-2"><Skeleton className="h-full w-full" /></div>
          </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] h-full">
            <div className="flex flex-col min-h-0 border-r">
                <div className="p-4 border-b">
                    <h1 className="text-2xl font-bold font-headline">Production</h1>
                    <p className="text-sm text-muted-foreground">Manage manufacturing and production orders.</p>
                </div>
                <div className="p-4 border-b">
                    <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="production">
                        <PermissionButton permission="create_records" className="w-full">
                            <PlusCircle className="mr-2 h-4 w-4" /> Create Production Order
                        </PermissionButton>
                    </AddVoucherDialog>
                    <Card className="mt-4 p-4 text-center">
                        <p className="text-sm text-muted-foreground">Total Production</p>
                        <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalProduction.output, { noSuffix: true })}</p>
                        <p className="text-xs text-muted-foreground mt-1">Cost: {formatCurrency(totalProduction.cost, { noSuffix: true })}</p>
                         <Button 
                            variant="link" 
                            size="sm" 
                            className="mt-1 h-auto p-0 text-xs" 
                            onClick={() => setShowAllOrders(true)}
                        >
                            View All Orders
                        </Button>
                    </Card>
                    <div className="relative mt-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search orders..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                </div>
                <div className="px-4 pt-2 pb-1 border-b">
                    <h3 className="text-sm font-semibold">Orders ({filteredOrders.length})</h3>
                </div>
                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-2">
                        {filteredOrders.length === 0 ? (
                            <div className="text-center text-muted-foreground p-8">No production orders found.</div>
                        ) : (
                            filteredOrders.map(order => {
                                const isSelected = selectedOrder?.id === order.id;
                                const orderDate = order.date?.toDate ? order.date.toDate() : new Date(order.date);
                                return (
                                    <Card
                                        key={order.id}
                                        className={cn(
                                            "p-3 cursor-pointer border",
                                            isSelected ? "border-primary bg-secondary" : "hover:border-primary/50"
                                        )}
                                        onClick={() => handleSelectOrder(order)}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold truncate">{order.productionNumber || `PROD-${order.id.slice(0, 8)}`}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDate(orderDate)} • {formatCurrency(order.totalOutput || 0, { noSuffix: true })}
                                                </p>
                                            </div>
                                            <Badge variant="outline">Production</Badge>
                                        </div>
                                    </Card>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>
            </div>

            <div className="flex flex-col min-h-0 w-full overflow-x-auto">
                {currentOrder ? (
                    <Card className="h-full flex flex-col">
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle>{currentOrder.productionNumber || 'All Production Orders'}</CardTitle>
                                    <CardDescription>
                                        {currentOrder.id !== 'all' ? 'Production order details' : 'All production orders'}
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!showAllOrders && (
                                        <Button variant="outline" size="sm" onClick={() => setShowAllOrders(true)}>
                                            All Orders
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0 flex flex-col min-h-0">
                            <ScrollArea className="flex-1">
                                <div className="p-4">
                                    {currentOrder.id !== 'all' && 'rawMaterials' in currentOrder && (
                                        <div className="mb-4 space-y-2">
                                            {currentOrder.rawMaterials && currentOrder.rawMaterials.length > 0 && (
                                                <div>
                                                    <h4 className="font-semibold mb-2">Raw Materials (Input)</h4>
                                                    <div className="space-y-1">
                                                        {currentOrder.rawMaterials.map((rm, idx) => (
                                                            <div key={idx} className="flex justify-between text-sm p-2 bg-muted/30 rounded">
                                                                <span>{rm.itemName} - {rm.quantity} {rm.unit}</span>
                                                                <span className="font-semibold">{formatCurrency(rm.amount)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {'finishedGoods' in currentOrder && currentOrder.finishedGoods && currentOrder.finishedGoods.length > 0 && (
                                                <div>
                                                    <h4 className="font-semibold mb-2">Finished Goods (Output)</h4>
                                                    <div className="space-y-1">
                                                        {currentOrder.finishedGoods.map((fg, idx) => (
                                                            <div key={idx} className="flex justify-between text-sm p-2 bg-green-50 rounded">
                                                                <span>{fg.itemName} - {fg.quantity} {fg.unit}</span>
                                                                <span className="font-semibold text-green-600">{formatCurrency(fg.amount)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {'narration' in currentOrder && currentOrder.narration && (
                                                <div className="mt-2">
                                                    <p className="text-sm text-muted-foreground">{currentOrder.narration}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <TransactionsTable
                                        transactions={currentTransactions.map(t => ({
                                            ...t,
                                            debit: t.totalCost || 0,
                                            credit: t.totalOutput || 0,
                                            balance: (t.totalOutput || 0) - (t.totalCost || 0)
                                        }))}
                                        context="other"
                                        userNames={userNames}
                                    />
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex flex-1 items-center justify-center">
                        <Card className="w-full max-w-md text-center">
                            <CardHeader>
                                <CardTitle>No Production Orders</CardTitle>
                                <CardDescription>Create your first production order to see details here.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AddVoucherDialog onVoucherCreated={() => {}} defaultTab="production">
                                    <PermissionButton permission="create_records">
                                        <PlusCircle className="mr-2 h-4 w-4" /> Create Production Order
                                    </PermissionButton>
                                </AddVoucherDialog>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
