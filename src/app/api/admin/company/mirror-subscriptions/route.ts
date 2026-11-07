import type { NextRequest } from "next/server";
import { handleAdminPanelMirrorSubscriptionsPost } from "@/lib/adminPanelCompany/mirrorSubscriptionsPost";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleAdminPanelMirrorSubscriptionsPost(req);
}
