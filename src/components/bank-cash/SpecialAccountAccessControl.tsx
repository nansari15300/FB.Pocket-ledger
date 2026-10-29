
"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import {
  normalizeSpecialAccountUseFor,
  specialAccountUseForIncludesUser,
  userIsSpecialAccountOwner,
  type SpecialAccountUseFor,
} from "@/lib/specialAccountUsage";

type User = {
    id: string;
    email?: string | null;
    name?: string | null;
    photoURL?: string | null;
    role?: string;
};

type SpecialAccountAccessControlProps = {
  users: User[];
  useFor: SpecialAccountUseFor;
  onUseForChange: (newUseFor: SpecialAccountUseFor) => void;
};

export function SpecialAccountAccessControl({
  users,
  useFor,
  onUseForChange,
}: SpecialAccountAccessControlProps) {
  const { company } = useCompany();
  const normalized = normalizeSpecialAccountUseFor(useFor);

  const handleCheckChange = (userId: string, type: "in" | "out" | "balance", checked: boolean) => {
    const currentList = normalized[type] || [];
    let newList: string[];

    if (checked) {
      newList = currentList.includes(userId) ? currentList : [...currentList, userId];
    } else {
      newList = currentList.filter((id) => id !== userId);
    }

    onUseForChange({ ...normalized, [type]: newList });
  };

  return (
    <div className="pl-master-special-account-table pl-special-account-usage-table-wrap overflow-hidden rounded-lg">
      <ScrollArea className="h-64 pl-master-special-account-scroll rounded-lg" icVoucherChrome>
        <div className="min-w-[520px] pr-4">
        <Table
          scrollContainer={false}
          data-pl-company-profile-table=""
          className="pl-special-account-usage-table pl-company-profile-soft-table"
        >
          <TableHeader className="bg-emerald-50/95">
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-[5.5rem] min-w-[5.5rem] whitespace-nowrap text-center px-1">
                Receipt
              </TableHead>
              <TableHead className="w-[5.5rem] min-w-[5.5rem] whitespace-nowrap text-center px-1">
                Payment
              </TableHead>
              <TableHead className="w-[6.25rem] min-w-[6.25rem] whitespace-nowrap text-center px-1 pr-2">
                View Balance
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
                const isOwner = userIsSpecialAccountOwner(user.id, company);
                const paymentInId = `payment-in-${user.id}`;
                const paymentOutId = `payment-out-${user.id}`;
                const viewBalanceId = `view-balance-${user.id}`;
                return (
                  <TableRow key={user.id} className="border-0 hover:bg-muted/30">
                    <TableCell>
                      <div className="min-w-0">
                        <p className="font-medium leading-snug">{user.name}</p>
                        <p className="text-xs text-muted-foreground leading-snug">{user.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell className="text-center px-1">
                       <Checkbox
                        id={paymentInId}
                        checked={isOwner || specialAccountUseForIncludesUser(normalized.in, user.id)}
                        onCheckedChange={(checked) => handleCheckChange(user.id, "in", !!checked)}
                        disabled={isOwner}
                      />
                    </TableCell>
                    <TableCell className="text-center px-1">
                      <Checkbox
                        id={paymentOutId}
                        checked={isOwner || specialAccountUseForIncludesUser(normalized.out, user.id)}
                        onCheckedChange={(checked) => handleCheckChange(user.id, "out", !!checked)}
                        disabled={isOwner}
                      />
                    </TableCell>
                    <TableCell className="text-center px-1 pr-2">
                      <Checkbox
                        id={viewBalanceId}
                        checked={isOwner || specialAccountUseForIncludesUser(normalized.balance, user.id)}
                        onCheckedChange={(checked) => handleCheckChange(user.id, "balance", !!checked)}
                        disabled={isOwner}
                      />
                    </TableCell>
                  </TableRow>
                );
            })}
          </TableBody>
        </Table>
        </div>
      </ScrollArea>
    </div>
  );
}
