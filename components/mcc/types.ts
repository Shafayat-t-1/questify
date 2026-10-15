/** Shared data shapes for the /mcc control center (mirrors /api/admin). */

export interface MccStats {
  totalUsers: number;
  totalTasksCompleted: number;
  pendingWithdrawals: number;
  totalPaidOut: number;
  totalActiveUsers?: number;
  platformLiquidity?: number;
}

export interface MccUser {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  telegram_id: number | string | null;
  coins: number;
  usdt_balance: number;
  trust_score: number;
  level: number;
  referral_code?: string | null;
  referral_count?: number | null;
  referred_by?: string | null;
  referred_by_tier2?: string | null;
  is_premium?: boolean | null;
  is_banned: boolean | null;
  is_admin: boolean | null;
  is_founder?: boolean | null;
  created_at: string;
}

export interface MccWithdrawal {
  id: string;
  user_id?: string;
  amount_usdt: number;
  fee_usdt?: number;
  net_amount_usdt?: number;
  network: string;
  address: string;
  status: string;
  tx_hash?: string | null;
  created_at: string;
  profiles?: { username?: string | null; telegram_id?: number | string | null };
}

export interface MccTask {
  id: string;
  title: string;
  platform: string;
  action_label?: string | null;
  action_url?: string | null;
  reward_coins: number;
  reward_usdt: number;
  margin_usdt?: number | null;
  difficulty?: string | null;
  duration_seconds?: number | null;
  verification_type?: string | null;
  verification_target?: string | null;
  max_completions?: number | null;
  completions?: number | null;
  is_active: boolean | null;
  created_at: string;
}

export interface MccSetting {
  key: string;
  value: unknown;
  is_public: boolean | null;
  description: string | null;
}

export interface MccAction {
  id: string;
  admin_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  details?: unknown;
  created_at: string;
}

export interface MccLedgerEntry {
  id: string;
  type: string;
  amount_usdt: number;
  balance_after: number;
}

export interface MccWallet {
  balance: number;
  entries: MccLedgerEntry[];
}

export interface MccData {
  stats: MccStats;
  users: MccUser[];
  tasks: MccTask[];
  withdrawals: MccWithdrawal[];
  actions: MccAction[];
  settings?: MccSetting[];
  wallets?: { owner: MccWallet; marketing: MccWallet };
}

export interface MccLiveData {
  stats: MccStats;
  wallets: { owner: number; marketing: number };
  ticks: Record<string, string>;
}
