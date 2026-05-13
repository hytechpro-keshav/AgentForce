import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Customer Support Chat",
  description:
    "Sign in to start a secure customer support chat. Powered by Agentforce.",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background">{children}</body>
    </html>
  );
}
