
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateDistributorForm } from "@/components/auth/CreateDistributorForm";
import type { Application } from "@/app/(admin)/admin/agents/page";

export function DistributorApplicationDialog({
  application,
  isOpen,
  onOpenChange,
  onApplicationUpdated,
}: {
  application: Application;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onApplicationUpdated: () => void;
}) {
  const handleUpdate = () => {
    onApplicationUpdated();
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Distributor Application</DialogTitle>
          <DialogDescription>
            Update the details for {application.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <CreateDistributorForm
            application={application}
            onApplicationUpdated={handleUpdate}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

    