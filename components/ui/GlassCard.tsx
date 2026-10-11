import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  glow?: "none" | "orange" | "cyan";
  as?: "div" | "section" | "article";
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = "none", as = "div", children, ...props }, ref) => {
    const Tag = as;
    return (
      <Tag
        ref={ref}
        className={cn(
          "relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl",
          "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]",
          glow === "orange" && "border-neon-orange/30 shadow-[0_0_35px_-10px_rgba(255,107,0,0.5)]",
          glow === "cyan" && "border-neon-cyan/30 shadow-[0_0_35px_-10px_rgba(0,240,255,0.45)]",
          className,
        )}
        {...props}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        {children}
      </Tag>
    );
  },
);
GlassCard.displayName = "GlassCard";
