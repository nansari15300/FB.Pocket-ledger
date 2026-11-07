"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// This is a placeholder component.
// In a real application, you would fetch user data and display it here.

const sampleUsers = [
    { id: "1", name: "Nabil Ansari", email: "nabil@example.com", role: "CompanyAdmin", isActive: true },
    { id: "2", name: "Jane Doe", email: "jane@example.com", role: "User", isActive: true },
    { id: "3", name: "John Smith", email: "john@example.com", role: "Viewer", isActive: false },
];

export function UserTable({loading}: {loading?: boolean}) {
    if (loading) {
        return (
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        )
    }
    
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {sampleUsers.map(user => (
                    <TableRow key={user.id}>
                        <TableCell>{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.role}</TableCell>
                        <TableCell>{user.isActive ? "Active" : "Inactive"}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
