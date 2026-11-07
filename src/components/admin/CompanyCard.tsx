"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building, Calendar, Users } from "lucide-react";

interface CompanyCardProps {
    company: {
        id: string;
        name: string;
        planExpiry: string;
        userCount: number;
    }
}

export function CompanyCard({ company }: CompanyCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building /> {company.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
                <p className="flex items-center gap-2"><Users /> {company.userCount} Users</p>
                <p className="flex items-center gap-2"><Calendar /> Expires on: {new Date(company.planExpiry).toLocaleDateString()}</p>
            </CardContent>
            <CardFooter>
                <Button variant="outline" size="sm">Manage Company</Button>
            </CardFooter>
        </Card>
    );
}
