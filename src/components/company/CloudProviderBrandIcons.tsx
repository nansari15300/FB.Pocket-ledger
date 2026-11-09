"use client";

import { cn } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/webAppBasePath";

type IconProps = { className?: string };

/** Google Drive product icon (2020+). Asset: `/public/icons/google-drive.png`. */
export function GoogleDriveBrandIcon({ className }: IconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand raster; exact colors from official asset
    <img
      src={publicAssetUrl("/icons/google-drive.png")}
      alt=""
      width={24}
      height={24}
      className={cn("h-6 w-6 shrink-0 object-contain", className)}
      aria-hidden
      draggable={false}
    />
  );
}
