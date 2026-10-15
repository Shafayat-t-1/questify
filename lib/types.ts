export type Platform =
  | "telegram"
  | "x"
  | "tiktok"
  | "youtube"
  | "github"
  | "reddit"
  | "discord";

export type TaskCategory = "ALL" | Platform;

export type TaskDifficulty = "easy" | "medium" | "hard";

export interface Profile {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  language_code: string | null;
  coins: number;
  usdt_balance: number;
  trust_score: number;
  level: number;
  referral_code: string;
  referred_by: string | null;
  referral_count: number;
  is_premium: boolean;
  is_banned: boolean;
  is_admin?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConnectedAccount {
  provider:
    | "telegram"
    | "google"
    | "x"
    | "github"
    | "reddit"
    | "discord"
    | "youtube"
    | "tiktok";
  provider_user_id: string | null;
  username: string | null;
  connected_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  usdt_bep20: string | null;
  ton_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  platform: Platform;
  action_label: string;
  action_url: string;
  reward_coins: number;
  reward_usdt: number;
  difficulty: TaskDifficulty;
  duration_seconds: number;
  max_completions: number;
  completions: number;
  /** Owner profit margin per completion, split into the two wallets. */
  margin_usdt?: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  verification_type?: string | null;
  verification_target?: string | null;
  verification_rules?: Record<string, unknown> | null;
}

export interface UserTask {
  id: string;
  user_id: string;
  task_id: string;
  status: "pending" | "verifying" | "completed" | "rejected";
  reward_coins: number;
  reward_usdt: number;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  day_index: number;
  reward_coins: number;
  checked_in_at: string;
  streak_date: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  /** Gross amount debited from the user's balance. */
  amount_usdt: number;
  /** Fee collected into the owner wallet (0 on legacy rows). */
  fee_usdt?: number;
  /** Actual payout amount (amount_usdt - fee_usdt). */
  net_amount_usdt?: number;
  network: "BEP20" | "TON";
  address: string;
  status: "pending" | "processing" | "paid" | "rejected";
  tx_hash: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  reward_coins: number;
  reward_usdt: number;
  created_at: string;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  photo_url: string | null;
  level: number;
  usdt_earned: number;
  referrals: number;
  rank: number;
  is_me?: boolean;
}

export interface TickerEvent {
  id: string;
  masked_name: string;
  amount_usdt: number;
  network: "BEP20" | "TON";
  created_at: string;
}

export interface ActivityItem {
  id: string;
  type: "reward" | "withdrawal" | "referral" | "checkin";
  title: string;
  subtitle: string;
  amount_coins: number;
  amount_usdt: number;
  status: "completed" | "pending" | "processing" | "paid" | "rejected";
  created_at: string;
}

export interface SessionUser {
  profile: Profile;
  wallet: Wallet;
  token: string;
}

export interface AuthResponse {
  ok: boolean;
  token?: string;
  profile?: Profile;
  wallet?: Wallet;
  error?: string;
}
