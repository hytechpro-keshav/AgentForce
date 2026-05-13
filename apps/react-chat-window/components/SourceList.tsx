"use client";

import { ExternalLink } from "lucide-react";

import type { CustomerSafeSource } from "@/lib/sources";

export function SourceList({ sources }: { sources: CustomerSafeSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t pt-3 text-xs text-muted-foreground">
      <p className="font-medium uppercase tracking-wide">Sources</p>
      <ul className="space-y-1">
        {sources.map((source, idx) => (
          <li key={`${source.title}-${idx}`} className="flex items-start gap-2">
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {source.title}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span className="font-medium text-foreground">{source.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
