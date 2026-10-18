"use client";

import { createContext, useContext } from "react";

/** Operator identity resolved server-side by the /mcc (panel) layout. */
export interface MccIdentity {
  username: string | null;
  telegramId: number | null;
  isFounder: boolean;
}

const MccIdentityContext = createContext<MccIdentity | null>(null);

export function MccIdentityProvider({
  value,
  children,
}: {
  value: MccIdentity;
  children: React.ReactNode;
}) {
  return <MccIdentityContext.Provider value={value}>{children}</MccIdentityContext.Provider>;
}

export function useMccIdentity(): MccIdentity {
  return useContext(MccIdentityContext) ?? { username: null, telegramId: null, isFounder: false };
}
