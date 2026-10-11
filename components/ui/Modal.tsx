"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, subtitle, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center"
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          <motion.button
            aria-label="Close"
            onClick={onClose}
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            variants={{
              hidden: { y: "100%" },
              visible: { y: 0 },
            }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 140 || info.velocity.y > 800) onClose();
            }}
            className={cn(
              "relative z-10 w-full max-w-md rounded-t-3xl border-t border-white/10 bg-obsidian-soft/95 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl",
              "shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.9)]",
              className,
            )}
          >
            <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-white/20" />
            <div className="flex items-start justify-between gap-4 px-5">
              <div>
                {title && (
                  <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
                )}
                {subtitle && <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 px-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
