"use client";

import { useState } from "react";
import { cn, safeExternalUrl } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  ring?: string;
}

function initials(name?: string | null): string {
  if (!name) return "Q";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ src, name, size = 40, className, ring }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const safeSrc = safeExternalUrl(src);
  const showImg = Boolean(safeSrc) && !failed;

  return (
    <span
      style={{ width: size, height: size, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-neon-orange/80 via-orange-600 to-neon-cyan/60 font-bold text-white",
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeSrc as string}
          alt={name ?? "avatar"}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span style={{ fontSize: size * 0.36 }}>{initials(name)}</span>
      )}
    </span>
  );
}
