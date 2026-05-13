"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { LoginCard, type CustomerChatSession } from "@/components/LoginCard";

interface ChatShellProps {
  brandName: string;
  brandSubtitle: string;
}

/**
 * Top-level client shell. Holds the customer chat session token in
 * React state only. Refreshing the page intentionally signs the
 * customer out so a fresh short-lived JWT must be minted.
 */
export function ChatShell({ brandName, brandSubtitle }: ChatShellProps) {
  const [session, setSession] = useState<CustomerChatSession | null>(null);

  if (!session) {
    return (
      <LoginCard
        brandName={brandName}
        brandSubtitle={brandSubtitle}
        onSession={setSession}
      />
    );
  }

  return (
    <ChatPanel
      brandName={brandName}
      brandSubtitle={brandSubtitle}
      session={session}
      onSignOut={() => setSession(null)}
    />
  );
}
