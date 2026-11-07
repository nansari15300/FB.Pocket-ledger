"use client";

import dynamic from "next/dynamic";

const AdminDashboard = dynamic(() => import("@/components/admin/AdminDashboard"), {
  loading: () => (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
      <p className="text-sm font-medium">Loading Admin Panel…</p>
    </div>
  ),
  ssr: false,
});

export default function AdminPage() {
  return <AdminDashboard />;
}
