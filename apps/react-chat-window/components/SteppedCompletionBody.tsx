"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { SteppedSection } from "@/lib/stepped-view-model";

import styles from "./SteppedOrchestrationView.module.css";

const CHAR_MS = 38;
const BLOCK_PAUSE_MS = 180;

function blocksFromDetail(
  sections: SteppedSection[],
  output?: string
): string[] {
  const blocks: string[] = [];
  for (const section of sections) {
    if (section.type === "summary" || section.type === "note") {
      blocks.push(section.text);
    }
  }
  if (output) {
    blocks.push(output);
  }
  return blocks;
}

function blocksSignature(blocks: string[]): string {
  return blocks.join("\u0001");
}

export function SteppedCompletionBody({
  sections,
  output,
  outputTestId,
  active,
  onTypingComplete
}: {
  sections: SteppedSection[];
  output?: string;
  outputTestId?: string;
  active: boolean;
  onTypingComplete?: () => void;
}) {
  const blocks = useMemo(
    () => blocksFromDetail(sections, output),
    [sections, output]
  );
  const signature = useMemo(() => blocksSignature(blocks), [blocks]);
  const [blockIndex, setBlockIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onTypingComplete);
  const blocksRef = useRef(blocks);
  const startedSignatureRef = useRef("");
  blocksRef.current = blocks;

  useEffect(() => {
    onCompleteRef.current = onTypingComplete;
  }, [onTypingComplete]);

  useEffect(() => {
    if (!active) return;
    if (startedSignatureRef.current === signature) return;
    startedSignatureRef.current = signature;
    setBlockIndex(0);
    setCharCount(0);
    completedRef.current = false;
  }, [active, signature]);

  useEffect(() => {
    const textBlocks = blocksRef.current;
    if (!active || textBlocks.length === 0) return;

    const current = textBlocks[blockIndex];
    if (!current) return;

    if (charCount >= current.length) {
      if (blockIndex < textBlocks.length - 1) {
        const timer = setTimeout(() => {
          setBlockIndex((index) => index + 1);
          setCharCount(0);
        }, BLOCK_PAUSE_MS);
        return () => clearTimeout(timer);
      }
      return;
    }

    const timer = setTimeout(() => {
      setCharCount((count) => count + 1);
    }, CHAR_MS);
    return () => clearTimeout(timer);
  }, [active, blocks, blockIndex, charCount]);

  useEffect(() => {
    const textBlocks = blocksRef.current;
    if (!active || textBlocks.length === 0) {
      completedRef.current = false;
      return;
    }
    const lastIndex = textBlocks.length - 1;
    const done =
      blockIndex >= lastIndex &&
      charCount >= textBlocks[lastIndex]!.length;
    if (!done) {
      completedRef.current = false;
      return;
    }
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.();
  }, [active, blocks, blockIndex, charCount]);

  if (!active || blocks.length === 0) {
    return null;
  }

  const visibleBlocks = blocks.slice(0, blockIndex + 1);
  let sectionCursor = 0;

  return (
    <div className={styles.completionBody} data-testid="stepped-completion-body">
      {sections.map((section, index) => {
        if (section.type !== "summary" && section.type !== "note") {
          return null;
        }
        const textBlockIndex = sectionCursor;
        sectionCursor += 1;
        if (textBlockIndex > blockIndex) return null;

        const fullText = section.type === "summary" ? section.text : section.text;
        const visibleText =
          textBlockIndex < blockIndex
            ? fullText
            : fullText.slice(0, charCount);
        const showCursor =
          textBlockIndex === blockIndex &&
          charCount < fullText.length;

        if (section.type === "summary") {
          return (
            <div
              key={`summary-${index}`}
              className={styles.accSummary}
              data-testid="stepped-detail-summary"
            >
              {visibleText}
              {showCursor ? (
                <span className={styles.typeCursor} aria-hidden>
                  ▌
                </span>
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={`note-${index}`}
            className={styles.ofoot}
            style={{ borderRadius: 7, marginBottom: 14 }}
          >
            {visibleText}
            {showCursor ? (
              <span className={styles.typeCursor} aria-hidden>
                ▌
              </span>
            ) : null}
          </div>
        );
      })}

      {output && blockIndex >= blocks.length - 1 && blocks.length > 0 ? (
        <div
          className={styles.output}
          data-testid={outputTestId ?? "stepped-node-output-live"}
        >
          <span className={styles.arr}>↳</span>
          <span className={styles.txt}>
            {blockIndex === blocks.length - 1
              ? output.slice(0, charCount)
              : output}
            {blockIndex === blocks.length - 1 && charCount < output.length ? (
              <span className={styles.typeCursor} aria-hidden>
                ▌
              </span>
            ) : null}
          </span>
          <span className={styles.to}>→ ORCHESTRATOR</span>
        </div>
      ) : null}
    </div>
  );
}
