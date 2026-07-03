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
      <head>
        {/*
         * Fonts are loaded here as static <link> tags rather than via an
         * @import inside a component <style> block. An @import in an injected
         * <style> is invalid placement — the browser relocates it (firing a
         * malformed, quote-wrapped request) and rewrites the <style> text,
         * which breaks React hydration on the landing page.
         */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Grotesk:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen bg-background">{children}</body>
    </html>
  );
}
