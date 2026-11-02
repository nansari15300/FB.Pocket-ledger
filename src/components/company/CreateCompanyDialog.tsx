
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CreateCompanyForm } from "./CreateCompanyForm";
import { Button } from "../ui/button";
import { PlusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner"; 
import { ScrollArea } from "../ui/scroll-area";

export function CreateCompanyDialog({ 
    onCompanyCreated, 
    children, 
    isOpen, 
    onOpenChange,
    redirectTo
}: { 
    onCompanyCreated: (companyId: string) => void, 
    children?: React.ReactNode, 
    isOpen?: boolean, 
    onOpenChange?: (open: boolean) => void,
    isDismissable?: boolean,
    /** If set, navigate here after create so the page actually changes without refresh. */
    redirectTo?: string | null
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const router = useRouter();

  const open = isOpen !== undefined ? isOpen : internalIsOpen;
  const setOpen = onOpenChange !== undefined ? onOpenChange : setInternalIsOpen;

  
  const handleCompanyCreated = async (companyId: string) => {
    // Company form already creates company + default data.
    onCompanyCreated(companyId);
    setOpen(false);
    toast.success("Company created successfully.");
    if (redirectTo) {
      router.replace(redirectTo);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent 
        // Mobile + desktop: ~90% viewport height taaki create form fields scroll ho sakein
        className="w-[98%] h-[90vh] max-h-[90vh] md:w-[80vw] md:max-w-[80vw] md:h-[90vh] md:max-h-[90vh] flex flex-col rounded-xl"
      >
        <DialogHeader>
          <DialogTitle>Create a New Company</DialogTitle>
          <DialogDescription>
            Fill in the details to create a new company profile.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full pr-6 -mr-6">
              <CreateCompanyForm onCompanyCreated={handleCompanyCreated} />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
