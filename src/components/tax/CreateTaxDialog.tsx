
"use client";

import { addDoc } from "@/lib/writeGateway/pbWrites";
import * as React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";
import type { TaxGroup } from "@/components/tax/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { collection, serverTimestamp, query, where } from "@/lib/pbCompat/firestore";
import { getDocs, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { firestore, storage } from "@/lib/firebase";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, FileText, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateTaxGroupDialog } from "./CreateTaxGroupDialog";
import { Combobox } from "../ui/combobox";
import Image from "next/image";
import { ref, uploadBytes, getDownloadURL } from "@/lib/pocketbaseData/pbStorage";
import { compressFile } from "@/lib/compression";
import { toast as sonnerToast } from "sonner";
import { FilePreview } from "../vouchers/FilePreview";
import { useDate } from "@/hooks/useDate";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Calendar } from "../ui/calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { cn } from "@/lib/utils";
import { apkCloudEntityMasterReadFromSqliteMirror, apkEntityWriteUsesLocalSqliteMirror } from "@/lib/apkOnlineFirestoreWritePolicy";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  cnMasterEntityDialogContent,
  masterEntityDialogHeaderClassName,
  masterEntityDialogFormWrapperClassName,
} from "@/lib/masterEntityDialogClasses";
import { NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { CreateTaxForm } from "./CreateTaxForm";


const fileSchema = z.object({
  file: z.instanceof(File),
  preview: z.string(),
});

const formSchema = z.object({
  name: z.string().min(2, { message: "Tax name must be at least 2 characters." }),
  rate: z.coerce.number().min(0, "Tax rate cannot be negative.").max(100, "Tax rate cannot be over 100."),
  openingBalance: z.coerce.number().optional().default(0),
  openingBalanceDate: z.date().optional(),
  groupId: z.string().min(1, "A group is required."),
});

const MAX_FILE_SIZE_MB = 0.5;


export function CreateTaxDialog({ onTaxCreated, children, groups: parentGroups = [], isOpen: parentIsOpen, onOpenChange: parentOnOpenChange, prefillTaxName, prefillTaxRate }: { 
    onTaxCreated: (newId: string, newTax?: { id: string; name: string; rate: number; balance?: number; companyId: string; groupId?: string }) => void, 
    children?: React.ReactNode, 
    groups?: TaxGroup[],
    isOpen?: boolean,
    onOpenChange?: (open: boolean) => void,
    prefillTaxName?: string,
  prefillTaxRate?: number
}) {
  const [internalIsOpen, setIsOpen] = useState(false);
  const [isNestedOpen, setIsNestedOpen] = useState(false);
  const router = useRouter();
  const [groups, setGroups] = useState<TaxGroup[]>(parentGroups);
  const { companyId, company } = useCompany();
  const sqliteListsSkipFirestore = useMemo(
    () =>
      apkEntityWriteUsesLocalSqliteMirror(company) || apkCloudEntityMasterReadFromSqliteMirror(company),
    [company]
  );
  const { processedTaxGroups } = useVouchers();
  const processedTaxGroupsRef = useRef(processedTaxGroups);
  processedTaxGroupsRef.current = processedTaxGroups;
  
  const isOpen = parentIsOpen !== undefined ? parentIsOpen : internalIsOpen;
  const setOpen = parentOnOpenChange !== undefined ? parentOnOpenChange : setIsOpen;
  const isMobile = useIsMobile();


  useEffect(() => {
    if (!isOpen || !companyId) return;

    /** APK cloud/local-static: SQLite mirror authoritative — redundant Firestore snapshot na lagao */
    if (sqliteListsSkipFirestore) {
      setGroups((processedTaxGroupsRef.current as TaxGroup[]) || []);
      void (async () => {
        try {
          const rows = await listCompanyDocsFromBrowserDb(companyId, "tax_groups");
          const filtered = rows
            .filter((r: any) => !r.isDeleted)
            .map((r: Record<string, unknown> & { id: string }) => ({ ...r, id: r.id } as TaxGroup));
          if (filtered.length > 0) setGroups(filtered);
        } catch (e) {
          console.warn("[CreateTaxDialog] tax_groups SQLite mirror failed", e);
        }
      })();
      return;
    }
    const q = query(collection(firestore, `companies/${companyId}/tax_groups`), where("isDeleted", "==", false));
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        setGroups(querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as TaxGroup)));
      },
      (error) => {
        console.error("Error fetching tax groups:", error);
        const fb = (processedTaxGroupsRef.current || []) as TaxGroup[];
        if (fb.length > 0) setGroups(fb);
      }
    );
    return () => unsubscribe();
  }, [isOpen, companyId, sqliteListsSkipFirestore]);

  const handleTaxCreated = (isSaveAndNew: boolean, newId: string, newTax?: { id: string; name: string; rate: number; balance?: number; companyId: string; groupId?: string }) => {
    onTaxCreated(newId, newTax);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogPortal>
        <DialogOverlay className={NESTED_VOUCHER_MASTER_CREATE_OVERLAY_CN} />
        <DialogContent
            className={cn(cnMasterEntityDialogContent(isMobile), "sm:max-w-2xl")}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => {
                if (isNestedOpen) { e.preventDefault(); return; }
                const target = e.target as HTMLElement;
                const isInsideNested = target.closest('[data-radix-popper-content-wrapper]') || target.closest('[cmdk-root]');
                if (isInsideNested) e.preventDefault();
            }}
             onInteractOutside={(e) => {
                if (isNestedOpen) { e.preventDefault(); return; }
                const target = e.target as HTMLElement;
                const isInsideNested = target.closest('[data-radix-popper-content-wrapper]') || target.closest('[cmdk-root]');
                if (isInsideNested) e.preventDefault();
            }}
          >
            <DialogHeader className={masterEntityDialogHeaderClassName}>
              <DialogTitle>Add a New Tax Type</DialogTitle>
              <DialogDescription>
                Fill in the details for the new tax.
              </DialogDescription>
            </DialogHeader>
            <div className={masterEntityDialogFormWrapperClassName}>
              <CreateTaxForm
                onTaxCreated={handleTaxCreated}
                onCloseDialogRequest={() => setOpen(false)}
                groups={groups}
                onNestedDialogOpenChange={setIsNestedOpen}
                prefillName={prefillTaxName}
          prefillRate={prefillTaxRate}
              />
            </div>
          </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
