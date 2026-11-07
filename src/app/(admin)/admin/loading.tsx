import { Loader2 } from "lucide-react";

/** Shown while Turbopack compiles /admin on first dev visit. */
export default function AdminLoading() {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">Loading Admin Panel…</p>
    </div>
  );
}
