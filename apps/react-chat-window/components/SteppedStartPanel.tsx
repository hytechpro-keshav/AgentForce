"use client";

import { useCallback, useState } from "react";

import styles from "./SteppedOrchestrationView.module.css";

interface SteppedStartPanelProps {
  caseId: string;
  onStarted: (workflowId: string) => void;
}

type PanelMode = "idle" | "login" | "working";

/**
 * Shown when a Case has no orchestration run yet. POSTs to the stepped
 * trigger proxy (operator session required) and hands the new workflow id
 * back to the parent for polling.
 */
export function SteppedStartPanel({ caseId, onStarted }: SteppedStartPanelProps) {
  const [mode, setMode] = useState<PanelMode>("idle");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const postStepped = useCallback(async (): Promise<
    "ok" | "needs_login" | "error"
  > => {
    try {
      const response = await fetch(
        `/api/orchestrator/case/${encodeURIComponent(caseId)}/stepped`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ caseId })
        }
      );
      if (response.status === 401) return "needs_login";
      if (!response.ok) return "error";
      const data = (await response.json()) as { workflowId?: string };
      if (!data.workflowId) return "error";
      onStarted(data.workflowId);
      return "ok";
    } catch {
      return "error";
    }
  }, [caseId, onStarted]);

  const handleStart = async () => {
    setMode("working");
    setError(null);
    const result = await postStepped();
    if (result === "ok") {
      setMode("idle");
    } else if (result === "needs_login") {
      setMode("login");
    } else {
      setError("Could not start stepped run. Try again.");
      setMode("idle");
    }
  };

  const handleLogin = async () => {
    setMode("working");
    setError(null);
    try {
      const response = await fetch("/api/orchestrator/operator-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode })
      });
      if (!response.ok) {
        setError(
          response.status === 401 ? "Invalid access code." : "Login unavailable."
        );
        setMode("login");
        return;
      }
    } catch {
      setError("Login unavailable.");
      setMode("login");
      return;
    }
    const result = await postStepped();
    if (result === "ok") {
      setAccessCode("");
      setMode("idle");
    } else {
      setError("Could not start stepped run. Try again.");
      setMode("login");
    }
  };

  return (
    <div className={styles.startPanel}>
      <p className={styles.startTitle}>No orchestration run yet</p>
      <p className={styles.startCopy}>
        Start a stepped run, then use <b>Run</b> on each stage — Triage first,
        then Knowledge Base through Guardrail. Demo Case create opens the new
        Case in Salesforce; return here when you are ready to orchestrate.
      </p>
      {error ? (
        <p className={styles.startError} role="alert">
          {error}
        </p>
      ) : null}
      {mode === "login" ? (
        <div className={styles.startLogin}>
          <label className={styles.startLabel} htmlFor="stepped-access-code">
            Operator access code
          </label>
          <input
            id="stepped-access-code"
            type="password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            className={styles.startInput}
            placeholder="Enter access code"
          />
          <div className={styles.startActions}>
            <button
              type="button"
              className={styles.startSecondary}
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.startPrimary}
              disabled={!accessCode.trim() || mode !== "login"}
              onClick={() => void handleLogin()}
            >
              Sign in &amp; start
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.startPrimary}
          disabled={mode === "working"}
          onClick={() => void handleStart()}
        >
          {mode === "working" ? "Starting…" : "Start stepped run ▸"}
        </button>
      )}
    </div>
  );
}
