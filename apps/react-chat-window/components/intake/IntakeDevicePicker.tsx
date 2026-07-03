"use client";

import { useMemo, useState } from "react";

import type { IntakeDevice } from "@/lib/intake-flow";
import {
  DEVICE_PICKER_SEARCH_THRESHOLD,
  filterDevicesByQuery
} from "@/lib/intake-client";

interface IntakeDevicePickerProps {
  devices: IntakeDevice[];
  suggestedAssetId?: string | null;
  sending?: boolean;
  onSelect(assetId: string): void;
  /** Landing panel inline styles; IntakeShell uses Tailwind via className. */
  variant?: "landing" | "intake";
}

export function IntakeDevicePicker({
  devices,
  suggestedAssetId = null,
  sending = false,
  onSelect,
  variant = "intake"
}: IntakeDevicePickerProps) {
  const [query, setQuery] = useState("");
  const showSearch = devices.length > DEVICE_PICKER_SEARCH_THRESHOLD;

  const sorted = useMemo(
    () =>
      [...devices].sort((a, b) =>
        a.assetId === suggestedAssetId
          ? -1
          : b.assetId === suggestedAssetId
            ? 1
            : 0
      ),
    [devices, suggestedAssetId]
  );

  const visible = useMemo(
    () => filterDevicesByQuery(sorted, query),
    [sorted, query]
  );

  const header = suggestedAssetId
    ? "Tap to confirm the affected device"
    : showSearch
      ? `Which device is affected? (${devices.length} on file — search below)`
      : "Which device is affected?";

  if (variant === "landing") {
    return (
      <div style={{ paddingTop: "4px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#5A7189",
            marginBottom: "6px"
          }}
        >
          {header}
        </div>
        {showSearch ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your devices…"
            disabled={sending}
            aria-label="Search registered devices"
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: "12px",
              padding: "7px 10px",
              marginBottom: "8px",
              borderRadius: "8px",
              border: "1px solid #E6EDF4",
              fontFamily: "inherit"
            }}
          />
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {visible.map((device) => {
            const suggested = device.assetId === suggestedAssetId;
            return (
              <button
                key={device.assetId}
                type="button"
                onClick={() => onSelect(device.assetId)}
                disabled={sending}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: suggested ? "#fff" : "#0E5E86",
                  background: suggested ? "#139ED9" : "#fff",
                  border: suggested
                    ? "1px solid #139ED9"
                    : "1px solid rgba(19,158,217,.3)",
                  borderRadius: "100px",
                  padding: "6px 12px",
                  cursor: sending ? "default" : "pointer",
                  opacity: sending ? 0.6 : 1,
                  fontFamily: "inherit"
                }}
              >
                {suggested ? `✓ ${device.label}` : device.label}
              </button>
            );
          })}
        </div>
        {showSearch && visible.length === 0 ? (
          <p style={{ fontSize: "11px", color: "#5A7189", margin: "6px 0 0" }}>
            No devices match &ldquo;{query.trim()}&rdquo;. Try another name.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">{header}</h2>
      {showSearch ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your devices…"
          disabled={sending}
          aria-label="Search registered devices"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {visible.map((device) => {
          const suggested = device.assetId === suggestedAssetId;
          return (
            <button
              key={device.assetId}
              type="button"
              disabled={sending}
              onClick={() => onSelect(device.assetId)}
              className={
                suggested
                  ? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  : "rounded-full border border-primary/30 bg-background px-3 py-1.5 text-xs font-semibold text-primary"
              }
            >
              {suggested ? `✓ ${device.label}` : device.label}
            </button>
          );
        })}
      </div>
      {showSearch && visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No devices match &ldquo;{query.trim()}&rdquo;. Try another name.
        </p>
      ) : null}
    </section>
  );
}
