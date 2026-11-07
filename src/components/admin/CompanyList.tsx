"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Company, GroupedCompany } from "@/app/(admin)/admin/companies/page";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

interface CompanyListProps {
  groupedCompanies: GroupedCompany[];
  selectedCompany: Company | null;
  onSelectCompany: (company: Company) => void;
}

const getInitials = (name: string) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

export function CompanyList({ groupedCompanies, selectedCompany, onSelectCompany }: CompanyListProps) {
  if (groupedCompanies.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-8">
        No companies found.
      </div>
    );
  }

  return (
    // ✅ flex-1 + h-full + min-h-0 = independent scrolling works inside flex layouts
    <ScrollArea className="flex-1 h-full min-h-0 border rounded-lg">
      <div className="p-2 space-y-4">
        {groupedCompanies.map((group) => (
          <Card key={group.ownerId} className="bg-background">
            <CardHeader className="p-3 border-b flex flex-row items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={group.ownerPhotoURL} alt={group.ownerName} />
                <AvatarFallback>{getInitials(group.ownerName)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <CardTitle className="text-base truncate">{group.ownerName}</CardTitle>
                <CardDescription className="text-xs truncate">{group.ownerEmail}</CardDescription>
              </div>
            </CardHeader>

            <CardContent className="pl-master-list-ul">
              {group.companies.map((company) => (
                <Card
                  key={company.id}
                  className={cn(
                    "p-2.5 cursor-pointer hover:bg-muted/50 transition-colors",
                    selectedCompany?.id === company.id && "bg-muted border-primary"
                  )}
                  onClick={() => onSelectCompany(company)}
                >
                  <p className="font-semibold text-sm">
                    <span className="font-medium text-muted-foreground text-xs">Company: </span>
                    {company.name}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    ID: {company.id}
                  </p>
                </Card>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
