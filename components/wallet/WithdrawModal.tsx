"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CircleDollarSign, Loader2, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useQuestify } from "@/providers/QuestifyProvider";
import { cn, formatUsdt, shortenWallet } from "@/lib/utils";
import type { Withdrawal } from "@/lib/types";

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
}

const NETWORKS: { key: Withdrawal["network"]; label: string; hint: string }[] = [
  { key: "BEP20", label: "USDT BEP-20", hint: "BSC network · 0x…" },
  { key: "TON", label: "USDT TON", hint: "TON network · UQ…" },
];

export function WithdrawModal({ open, onClose }: WithdrawModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Withdraw USDT" subtitle="On-chain payout to your wallet">
      {open && <WithdrawForm onClose={onClose} />}
    </Modal>
  );
}

function WithdrawForm({ onClose }: { onClose: () => void }) {
  const { profile, wallet, actions, config } = useQuestify();
  const balance = profile?.usdt_balance ?? 0;
  const minWithdrawal = config.minWithdrawalUsdt;

  const [network, setNetwork] = useState<Withdrawal["network"]>("BEP20");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState(
    () => wallet?.usdt_bep20 ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const net = NETWORKS.find((n) => n.key === network)!;
  const fee = config.withdrawalFees[network];

  const selectNetwork = (next: Withdrawal["network"]) => {
    setNetwork(next);
    setAddress((next === "BEP20" ? wallet?.usdt_bep20 : wallet?.ton_address) ?? "");
  };

  const numericAmount = Number(amount);
  const validAddress =
    network === "BEP20"
      ? /^0x[a-fA-F0-9]{40}$/.test(address.trim())
      : address.trim().length >= 30;
  const canSubmit =
    !submitting && numericAmount >= minWithdrawal && numericAmount <= balance && validAddress;

  const handleSubmit = async () => {
    setError(null);
    if (numericAmount < minWithdrawal) return setError(`Minimum withdrawal is ${minWithdrawal} USDT`);
    if (numericAmount > balance) return setError("Amount exceeds balance");
    if (!validAddress) return setError(`Enter a valid ${net.label} address`);

    setSubmitting(true);
    try {
      const res = await actions.requestWithdrawal(numericAmount, network, address.trim());
      if (res.ok) {
        setDone(true);
        actions.pushToast({
          kind: "success",
          title: "Withdrawal submitted",
          message: `${formatUsdt(numericAmount)} USDT · ${network}`,
          amountUsdt: numericAmount,
        });
      } else {
        setError(res.message ?? "Withdrawal failed");
      }
    } catch {
      setError("Withdrawal failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {done ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center py-4 text-center"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full border border-emerald-400/40 bg-emerald-400/15 text-emerald-300">
            <Check className="h-7 w-7" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-white">Withdrawal queued</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/50">
            {formatUsdt(numericAmount)} USDT to {shortenWallet(address, 6)} on {network}. Payouts are
            processed within 24h and appear in your activity feed.
          </p>
          <button
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-neon-orange to-amber-500 py-3 text-sm font-bold text-black"
          >
            Done
          </button>
        </motion.div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-neon-cyan/15 text-neon-cyan">
                <CircleDollarSign className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  Available balance
                </p>
                <p className="text-sm font-bold text-white">{formatUsdt(balance)} USDT</p>
              </div>
            </div>
            <button
              onClick={() => setAmount(String(balance))}
              className="rounded-lg border border-neon-orange/40 bg-neon-orange/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-neon-orange"
            >
              Max
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/45">
              Network
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {NETWORKS.map((n) => (
                <button
                  key={n.key}
                  onClick={() => selectNetwork(n.key)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition",
                    network === n.key
                      ? "border-neon-orange/50 bg-neon-orange/12"
                      : "border-white/10 bg-white/[0.02]",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <WalletIcon className="h-3.5 w-3.5" />
                    {n.label}
                  </p>
                  <p className="mt-0.5 text-[10px] text-white/40">
                    Fee {config.withdrawalFees[n.key]} USDT
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/45">
              Amount (USDT)
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <CircleDollarSign className="h-4 w-4 text-white/40" />
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/25"
              />
              <span className="text-xs font-semibold text-white/40">USDT</span>
            </div>
            <p className="mt-1 text-[10px] text-white/35">
              You receive {formatUsdt(Math.max(0, numericAmount - fee))} USDT after fee
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/45">
              {net.label} Wallet Address
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={net.hint}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-neon-orange/50"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition active:scale-[0.98]",
              canSubmit
                ? "bg-gradient-to-r from-neon-orange to-amber-500 text-black shadow-[0_0_28px_-6px_rgba(255,107,0,0.9)]"
                : "cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/35",
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Confirm Withdrawal
              </>
            )}
          </button>
          <p className="flex items-center justify-center gap-1 text-center text-[10px] text-white/30">
            <ShieldCheck className="h-3 w-3" /> Payouts are secured & processed automatically
          </p>
        </div>
      )}
    </>
  );
}
