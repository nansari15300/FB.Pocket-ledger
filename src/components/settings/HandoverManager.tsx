
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import {
  collection,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  deleteDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { onSnapshot, getDocs, getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
import { Loader2, Hand, X, Send, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import type { Company } from "@/hooks/useCompany";
import { acceptCompanyHandover } from "@/lib/actions";
import {
  isDeviceLocalCompany,
  buildDuplicateNameCountMap,
  companySelectOptionLabel,
  mergeOwnedCompaniesForUser,
} from "@/lib/companyStorageKind";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";

export function HandoverManager() {
  const { user, customUser } = useAuth();
  const { setCompanyId, allCompanies, allCompaniesRegistry } = useCompany();
  const [ownedCompanies, setOwnedCompanies] = useState<Company[]>([]);
  const [incomingHandovers, setIncomingHandovers] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [handoverEmail, setHandoverEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isHandoverSectionVisible, setIsHandoverSectionVisible] =
    useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [warningDialogOpen, setWarningDialogOpen] = useState(false);
  const [warningLang, setWarningLang] = useState<'en' | 'ne'>('en');

  // Fetch owned companies from the context (ownerId or, for SuperAdmin, ownerEmail match)
  useEffect(() => {
    if (!user?.uid) {
      setOwnedCompanies([]);
      return;
    }
    const shareUser = { uid: user.uid, email: user.email ?? null };
    const userOwnedCompanies = mergeOwnedCompaniesForUser(
      [allCompaniesRegistry || [], allCompanies || []],
      shareUser,
      (c, u) => {
        if (resolveCompanyIsOwnedForUser(c, u)) return true;
        if (customUser?.role === "SuperAdmin" && c.ownerEmail && u.email) {
          return c.ownerEmail.toLowerCase().trim() === u.email.toLowerCase().trim();
        }
        return false;
      }
    );
    setOwnedCompanies(userOwnedCompanies);
    setSelectedCompanyId((prev) => {
      if (userOwnedCompanies.length === 0) return "";
      if (!prev || !userOwnedCompanies.some((c) => c.id === prev)) return userOwnedCompanies[0].id;
      return prev;
    });
  }, [user, customUser?.role, allCompanies, allCompaniesRegistry]);


  // Fetch incoming handovers
  useEffect(() => {
    if (!user?.email) return;
    const q = query(
      collection(firestore, "companies"),
      where("handoverTo", "==", user.email),
      where("handoverStatus", "==", "pending")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setIncomingHandovers(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });
    return () => unsub();
  }, [user?.email]);

  const selectedCompany = useMemo(
    () => ownedCompanies.find((c) => c.id === selectedCompanyId),
    [selectedCompanyId, ownedCompanies]
  );
  const isHandoverPending = selectedCompany?.handoverStatus === "pending";

  const { localHandoverCompanies, onlineHandoverCompanies } = useMemo(() => {
    const local: Company[] = [];
    const online: Company[] = [];
    for (const c of ownedCompanies) {
      if (isDeviceLocalCompany(c)) local.push(c);
      else online.push(c);
    }
    return { localHandoverCompanies: local, onlineHandoverCompanies: online };
  }, [ownedCompanies]);

  const duplicateNameCountMap = useMemo(() => buildDuplicateNameCountMap(ownedCompanies), [ownedCompanies]);

  const handleInitiateHandover = async () => {
    if (!selectedCompany || !handoverEmail) {
      toast.error("Please fill all fields.");
      return;
    }
    if (selectedCompany.password && selectedCompany.password !== confirmPassword) {
      toast.error("Incorrect company password.");
      return;
    }
    setWarningDialogOpen(true);
  };
  
  const confirmHandover = async () => {
    if (!selectedCompany || !handoverEmail) return;
    setIsProcessing(true);
    const toastId = toast.loading("Initiating handover...");
    try {
        // Check if receiver email exists as a user
        const userQuery = query(collection(firestore, "users"), where("email", "==", handoverEmail));
        const userSnap = await getDocs(userQuery);
        if (userSnap.empty) {
            throw new Error(`User with email ${handoverEmail} does not exist.`);
        }

        const companyRef = doc(firestore, "companies", selectedCompany.id);
        await updateDoc(companyRef, {
            handoverTo: handoverEmail,
            handoverStatus: "pending",
            handoverInitiatedAt: serverTimestamp(),
        });
        toast.success("Handover Initiated", { id: toastId, description: "Waiting for receiver to accept." });
        setHandoverEmail("");
        setConfirmPassword("");
        setIsHandoverSectionVisible(false);
    } catch (error: any) {
        const msg = (error?.code === "not-found" || error?.message?.includes("No document to update")) ? "This company hasn't synced to the server yet. Connect to the internet and wait for sync." : error.message;
        toast.error("Failed to initiate handover", { id: toastId, description: msg });
    } finally {
        setIsProcessing(false);
    }
  }


  const handleCancelHandover = async () => {
    if (!selectedCompany) return;
    setIsProcessing(true);
    const toastId = toast.loading("Cancelling handover...");
    try {
      const companyRef = doc(firestore, "companies", selectedCompany.id);
      await updateDoc(companyRef, {
        handoverTo: null,
        handoverStatus: null,
        handoverInitiatedAt: null,
      });
      toast.success("Handover Cancelled", { id: toastId });
    } catch (error: any) {
      const msg = (error?.code === "not-found" || error?.message?.includes("No document to update")) ? "This company hasn't synced to the server yet." : error.message;
      toast.error("Failed to cancel", { id: toastId, description: msg });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHandoverResponse = async (companyId: string, accept: boolean) => {
    if (!user?.email) return;
    setIsProcessing(true);
    const toastId = toast.loading("Processing handover...");

    try {
        const companyRef = doc(firestore, "companies", companyId);
        const companyDoc = await getDoc(companyRef);
        const companyData = companyDoc.data() as Company;

        if (!companyDoc.exists() || companyData?.handoverTo !== user.email) {
            throw new Error("This handover request is no longer valid.");
        }

        if (accept) {
            if (!user) throw new Error("Current user not found.");
            if (!companyData.ownerEmail) throw new Error("Original owner email is missing from company data.");
            await acceptCompanyHandover(
                companyId,
                { uid: user.uid, email: user.email },
                companyData.ownerId,
                companyData.ownerEmail
            );

            setCompanyId(companyId);
            toast.success("Handover Complete", { id: toastId, description: `You are now the owner of ${companyData?.name}`});

        } else { // Declined
            await updateDoc(companyRef, {
                handoverTo: null,
                handoverStatus: "declined",
            });
            toast.info("Handover Declined", { id: toastId });
        }
    } catch(error: any) {
         toast.error("Action Failed", { id: toastId, description: error.message });
    } finally {
        setIsProcessing(false);
    }
  };

  const warningMessages = {
    en: {
        title: "Are you absolutely sure?",
        description: (
            <>
                This will transfer full ownership of <strong>{selectedCompany?.name}</strong> to <strong>{handoverEmail}</strong>. You will lose all ownership rights and access once they accept.
                <br /><br />
                <span className="font-bold text-destructive">This action is more permanent than deleting.</span> You cannot restore a backup of this company once the handover is complete. This process is irreversible.
            </>
        ),
        button: "Yes, Transfer Ownership"
    },
    ne: {
        title: "के तपाईं निश्चित हुनुहुन्छ?",
        description: (
             <>
                यसले <strong>{selectedCompany?.name}</strong> कम्पनीको पूर्ण स्वामित्व <strong>{handoverEmail}</strong> लाई हस्तान्तरण गर्नेछ। नयाँ प्रयोगकर्ताले स्वीकार गरेपछि तपाईंले सबै स्वामित्व अधिकार र पहुँच गुमाउनुहुनेछ।
                <br /><br />
                <span className="font-bold text-destructive">यो कार्य कम्पनी डिलिट गर्नुभन्दा पनि स्थायी हो।</span> हस्तान्तरण पूरा भएपछि तपाईंले यो कम्पनीको ब्याकअप पुनर्स्थापना गर्न सक्नुहुन्न। यो प्रक्रिया अपरिवर्तनीय छ।
            </>
        ),
        button: "हो, स्वामित्व हस्तान्तरण गर्नुहोस्"
    }
  };


  return (
    <div className="space-y-6">
      {/* INCOMING HANDOVERS */}
      {incomingHandovers.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle>Incoming Handovers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incomingHandovers.map((company) => (
              <div key={company.id} className="flex items-center justify-between p-3 border rounded-lg bg-background">
                <div>
                  <p className="font-semibold">{company.name}</p>
                  <p className="text-sm text-muted-foreground">
                    From: {company.ownerEmail}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleHandoverResponse(company.id, true)} disabled={isProcessing} className="bg-green-500 hover:bg-green-600">Accept</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleHandoverResponse(company.id, false)} disabled={isProcessing}>Decline</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* OUTGOING HANDOVER */}
      <Card>
        <CardHeader>
          <CardTitle>Handover Company</CardTitle>
          <CardDescription>Transfer ownership of a company to another user.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <Select
              value={selectedCompanyId}
              onValueChange={setSelectedCompanyId}
              disabled={isHandoverSectionVisible || isProcessing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a company..." />
              </SelectTrigger>
              <SelectContent>
                {localHandoverCompanies.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs font-semibold text-muted-foreground">Local</SelectLabel>
                    {localHandoverCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            Local
                          </span>
                          <span className="truncate">{companySelectOptionLabel(c, duplicateNameCountMap)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {onlineHandoverCompanies.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs font-semibold text-muted-foreground">Online (cloud)</SelectLabel>
                    {onlineHandoverCompanies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0 text-[10px] font-medium text-sky-800 dark:text-sky-300">
                            Online
                          </span>
                          <span className="truncate">{companySelectOptionLabel(c, duplicateNameCountMap)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>

            {isHandoverPending ? (
                 <div className="flex items-center gap-2">
                    <p className="text-sm text-amber-600">Pending for: {selectedCompany.handoverTo}</p>
                    <Button variant="destructive" size="sm" onClick={handleCancelHandover} disabled={isProcessing}>
                       {isProcessing ? <Loader2 className="h-4 w-4 animate-spin"/> : <X className="h-4 w-4"/>}
                        Cancel
                    </Button>
                 </div>
            ): (
                 <Button onClick={() => setIsHandoverSectionVisible(true)} disabled={!selectedCompanyId || isHandoverSectionVisible || isProcessing}>
                    <Hand className="mr-2 h-4 w-4"/> Initiate Handover
                </Button>
            )}
          </div>
          
           {isHandoverSectionVisible && (
               <div className="border-t pt-4 mt-4 space-y-4 animate-in fade-in-50">
                    <Input placeholder="Receiver's Email Address" value={handoverEmail} onChange={(e) => setHandoverEmail(e.target.value)} />
                    {selectedCompany?.password && (
                        <div className="relative">
                            <Input 
                                type={showPassword ? "text" : "password"} 
                                placeholder="Confirm your company password" 
                                value={confirmPassword} 
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowPassword(!showPassword)}>
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setIsHandoverSectionVisible(false)}>Cancel</Button>
                        <Button onClick={handleInitiateHandover} disabled={isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                            Send Handover Request
                        </Button>
                    </div>
               </div>
           )}
        </CardContent>
      </Card>
      
       <AlertDialog open={warningDialogOpen} onOpenChange={setWarningDialogOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{warningMessages[warningLang].title}</AlertDialogTitle>
                    <AlertDialogDescription>
                       {warningMessages[warningLang].description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="sm:justify-between">
                     <Button variant="outline" size="sm" onClick={() => setWarningLang(lang => lang === 'en' ? 'ne' : 'en')}>
                        {warningLang === 'en' ? 'नेपालीमा हेर्नुहोस्' : 'View in English'}
                     </Button>
                     <div className="flex gap-2">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmHandover}>{warningMessages[warningLang].button}</AlertDialogAction>
                     </div>
                </AlertDialogFooter>
            </AlertDialogContent>
       </AlertDialog>
    </div>
  );
}

    