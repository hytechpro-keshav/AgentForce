"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import type { SteppedSection, SteppedTraceStep } from "@/lib/stepped-view-model";

import styles from "./SteppedOrchestrationView.module.css";

const CHAR_MS = 38;
const STEP_PAUSE_MS = 140;

export interface TypewriterTraceStep extends SteppedTraceStep {
  visibleLabel: string;
  showCursor: boolean;
}

export function isTraceTypingComplete(
  items: SteppedTraceStep[],
  typedStepIndex: number,
  typedCharCount: number
): boolean {
  if (items.length === 0) return false;
  const lastIndex = items.length - 1;
  return (
    typedStepIndex >= lastIndex &&
    typedCharCount >= items[lastIndex]!.label.length
  );
}

export function estimateTypingDurationMs(items: SteppedTraceStep[]): number {
  if (items.length === 0) return 500;
  return (
    items.reduce(
      (total, item) => total + item.label.length * CHAR_MS + STEP_PAUSE_MS,
      0
    ) + 100
  );
}

export function useTypewriterTrace(
  items: SteppedTraceStep[],
  active: boolean,
  onTypingComplete?: () => void,
  settleToken = 0
): TypewriterTraceStep[] {
  const [typedStepIndex, setTypedStepIndex] = useState(0);
  const [typedCharCount, setTypedCharCount] = useState(0);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onTypingComplete);
  const itemsRef = useRef(items);
  const hasBeenActiveRef = useRef(false);
  itemsRef.current = items;
  const prevSignatureRef = useRef("");
  const itemsSignature = traceItemsSignature(items);

  useEffect(() => {
    onCompleteRef.current = onTypingComplete;
  }, [onTypingComplete]);

  useEffect(() => {
    completedRef.current = false;
  }, [settleToken]);

  useEffect(() => {
    if (active) {
      hasBeenActiveRef.current = true;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (prevSignatureRef.current === itemsSignature) return;
    const appendOnly = isTraceSignatureAppendOnly(
      prevSignatureRef.current,
      itemsSignature
    );
    prevSignatureRef.current = itemsSignature;
    if (appendOnly) {
      completedRef.current = false;
      return;
    }
    setTypedStepIndex(0);
    setTypedCharCount(0);
    completedRef.current = false;
  }, [active, itemsSignature]);

  useEffect(() => {
    const traceItems = itemsRef.current;
    if (!active || traceItems.length === 0) return;

    if (typedStepIndex >= traceItems.length) {
      setTypedStepIndex(Math.max(0, traceItems.length - 1));
      return;
    }

    const current = traceItems[typedStepIndex];
    if (typedCharCount >= current.label.length) {
      if (typedStepIndex < traceItems.length - 1) {
        const timer = setTimeout(() => {
          setTypedStepIndex((index) => index + 1);
          setTypedCharCount(0);
        }, STEP_PAUSE_MS);
        return () => clearTimeout(timer);
      }
      return;
    }

    const timer = setTimeout(() => {
      setTypedCharCount((count) => count + 1);
    }, CHAR_MS);
    return () => clearTimeout(timer);
  }, [active, itemsSignature, typedStepIndex, typedCharCount]);

  useEffect(() => {
    const traceItems = itemsRef.current;
    if (!active || traceItems.length === 0) {
      completedRef.current = false;
      return;
    }
    if (!isTraceTypingComplete(traceItems, typedStepIndex, typedCharCount)) {
      completedRef.current = false;
      return;
    }
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.();
  }, [active, itemsSignature, typedStepIndex, typedCharCount]);

  return useMemo(() => {
    if (!active) {
      if (!hasBeenActiveRef.current || items.length === 0) {
        return items.map((step) => ({
          ...step,
          visibleLabel: step.label,
          showCursor: false
        }));
      }
      const fullyTyped = isTraceTypingComplete(
        items,
        typedStepIndex,
        typedCharCount
      );
      if (fullyTyped) {
        return items.map((step) => ({
          ...step,
          visibleLabel: step.label,
          showCursor: false
        }));
      }
      return items.slice(0, typedStepIndex + 1).map((step, index) => ({
        ...step,
        visibleLabel:
          index < typedStepIndex
            ? step.label
            : step.label.slice(0, typedCharCount),
        showCursor: false
      }));
    }

    if (items.length === 0) {
      return [
        {
          label: "Starting agent reasoning",
          status: "running",
          fields: [],
          visibleLabel: "",
          showCursor: true
        }
      ];
    }

    return items.slice(0, typedStepIndex + 1).map((step, index) => ({
      ...step,
      visibleLabel:
        index < typedStepIndex
          ? step.label
          : step.label.slice(0, typedCharCount),
      showCursor: index === typedStepIndex
    }));
  }, [active, items, typedStepIndex, typedCharCount]);
}

function displayTraceStatus(
  step: SteppedTraceStep,
  settled: boolean,
  active: boolean
): string {
  if (settled || !active) {
    return "completed";
  }
  return step.status;
}

export function SteppedLiveTrace({
  items,
  active,
  settled = false,
  onGrowth,
  onTypingComplete,
  settleToken = 0
}: {
  items: SteppedTraceStep[];
  active: boolean;
  settled?: boolean;
  onGrowth?: () => void;
  onTypingComplete?: () => void;
  settleToken?: number;
}) {
  const displaySteps = useTypewriterTrace(
    items,
    active,
    onTypingComplete,
    settleToken
  );
  const cursorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    onGrowth?.();
  }, [displaySteps, onGrowth]);

  useEffect(() => {
    if (!active) return;
    cursorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [active, displaySteps]);

  return (
    <div className={styles.trace} data-testid="stepped-detail-trace">
      <div className={styles.tlabel}>Execution trace · agent reasoning</div>
      {displaySteps.map((step, index) => {
        const status = displayTraceStatus(step, settled, active);
        return (
          <div
            key={step.sequence ?? `${index}-${step.label}`}
            className={clsx(
              styles.tstep,
              status === "assigned" && styles.tstepAssigned,
              status === "waiting_approval" && styles.tstepWaiting,
              status === "completed" && styles.tstepCompleted,
              active && step.showCursor && styles.tstepLive
            )}
          >
            <span className={styles.tknot} />
            <div className={styles.th}>
              <span className={styles.tn}>SEQ {index + 1}</span>
              <span className={styles.tt}>
                {step.visibleLabel}
                {step.showCursor ? (
                  <span
                    ref={cursorRef}
                    className={styles.typeCursor}
                    data-testid="stepped-live-trace-cursor"
                    aria-hidden
                  >
                    ▌
                  </span>
                ) : null}
              </span>
              <span className={styles.tst} data-testid="stepped-trace-step-status">
                {status}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function traceItemsFromDetail(detail: SteppedSection[]): SteppedTraceStep[] {
  const section = detail.find((entry) => entry.type === "trace");
  return section?.type === "trace" ? section.items : [];
}

export function traceItemsSignature(items: SteppedTraceStep[]): string {
  return items.map((item) => item.label).join("\u0001");
}

/** True when `next` extends `prev` with the same prefix labels (poll append). */
export function isTraceSignatureAppendOnly(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (prev === next) return true;
  const prevParts = prev.split("\u0001");
  const nextParts = next.split("\u0001");
  return (
    prevParts.length <= nextParts.length &&
    prevParts.every((part, index) => part === nextParts[index])
  );
}
