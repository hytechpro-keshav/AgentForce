"use client";

/**
 * Stepped orchestration console (Phase 2 — real stepping + Phase 1 replay).
 *
 * Two modes driven by `snapshot.status`:
 *
 * **Stepped** (`awaiting_step`): the backend paused after a stage via
 * `interruptAfter`. Each "Run" button POSTs to `/api/orchestrator/[wfId]/advance`,
 * which runs exactly one graph node and returns the updated snapshot. The UI
 * animates the reveal once the backend confirms the data.
 *
 * **Replay** (any other status): the backend has already computed all stages.
 * "Run" reveals the already-computed result locally (no backend call).
 *
 * Triage auto-reveals in both modes as soon as its data is available.
 * The existing read-only console (`OrchestrationView`) is left untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Check,
  Cpu,
  Flag,
  Inbox,
  Package,
  Search,
  ShieldCheck,
  User
} from "lucide-react";

import {
  isTerminalStatus,
  sanitizeSnapshot,
  type OrchestrationSnapshot
} from "@/lib/orchestration";
import {
  buildSteppedViewModel,
  buildVisibleActivity,
  computeRevealedProgress,
  isSteppedSnapshot,
  type SteppedNode,
  type SteppedNodeIcon,
  type SteppedSection,
  type SteppedViewModel
} from "@/lib/stepped-view-model";

import { SteppedStartPanel } from "@/components/SteppedStartPanel";
import styles from "./SteppedOrchestrationView.module.css";

const NODE_ICON: Record<
  SteppedNodeIcon,
  (props: { size?: number; strokeWidth?: number }) => JSX.Element
> = {
  search: (p) => <Search {...p} />,
  user: (p) => <User {...p} />,
  book: (p) => <BookOpen {...p} />,
  box: (p) => <Package {...p} />,
  cal: (p) => <CalendarDays {...p} />,
  shield: (p) => <ShieldCheck {...p} />
};

const REVEAL_MS = 850;

interface SteppedOrchestrationViewProps {
  caseId?: string;
  workflowId?: string;
  pollIntervalMs?: number;
  /** Seed snapshot for SSR/tests. When set with pollIntervalMs<=0, no fetch runs. */
  initialSnapshot?: OrchestrationSnapshot;
}

type NodeRenderState = "done" | "running" | "frontier" | "queued";

export function SteppedOrchestrationView({
  caseId,
  workflowId,
  pollIntervalMs = 2500,
  initialSnapshot
}: SteppedOrchestrationViewProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(() => {
    if (!initialSnapshot) return null;
    if (caseId && !workflowId && !isSteppedSnapshot(initialSnapshot)) return null;
    return initialSnapshot;
  });
  const [error, setError] = useState<string | null>(null);
  const [noWorkflowYet, setNoWorkflowYet] = useState(
    () =>
      Boolean(
        caseId &&
          !workflowId &&
          initialSnapshot &&
          !isSteppedSnapshot(initialSnapshot)
      )
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(0);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const stopped = useRef(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapPlayed = useRef(false);
  const triageWasRunning = useRef(false);

  const pollWorkflowId = activeWorkflowId ?? workflowId;
  const pollCaseId = pollWorkflowId ? undefined : caseId;

  const load = useCallback(async () => {
    if (!pollCaseId && !pollWorkflowId) return;
    const path = pollWorkflowId
      ? `/api/orchestrator/${pollWorkflowId}`
      : `/api/orchestrator/case/${pollCaseId}`;
    try {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      // Case may exist before its workflow does — keep polling quietly.
      if (response.status === 404 && pollCaseId) {
        setNoWorkflowYet(true);
        return;
      }
      if (!response.ok) {
        if (response.status === 401) {
          setNeedsLogin(true);
          setError(null);
          return;
        }
        setError(`Orchestration status unavailable (${response.status}).`);
        return;
      }
      const parsed = sanitizeSnapshot(await response.json());
      if (parsed) {
        setNeedsLogin(false);
        // Ignore auto-trigger full runs when polling by Case id only.
        if (!isSteppedSnapshot(parsed) && pollCaseId) {
          setNoWorkflowYet(true);
          return;
        }
        if (!isSteppedSnapshot(parsed) && !pollWorkflowId) {
          setError("This workflow is not a stepped run.");
          return;
        }
        setError(null);
        setNoWorkflowYet(false);
        setSnapshot(parsed);
        if (isTerminalStatus(parsed.status)) stopped.current = true;
      }
    } catch {
      setError("Unable to reach orchestration status.");
    }
  }, [pollCaseId, pollWorkflowId]);

  const handleSteppedStarted = useCallback(
    (nextWorkflowId: string) => {
      setNoWorkflowYet(false);
      setActiveWorkflowId(nextWorkflowId);
      stopped.current = false;
      router.replace(
        `/orchestration/stepped?workflowId=${encodeURIComponent(nextWorkflowId)}`
      );
    },
    [router]
  );

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    if (!pollCaseId && !pollWorkflowId) return;
    void load();
    const id = setInterval(() => {
      if (!stopped.current) void load();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [load, pollIntervalMs, pollCaseId, pollWorkflowId]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    []
  );

  const vm = useMemo<SteppedViewModel | null>(
    () => (snapshot ? buildSteppedViewModel(snapshot) : null),
    [snapshot]
  );

  const visibleActivity = useMemo(
    () =>
      vm && snapshot
        ? buildVisibleActivity(vm.activity, vm.nodes, revealed, snapshot)
        : [],
    [vm, snapshot, revealed]
  );

  const startReveal = useCallback((index: number) => {
    setRunningIndex(index);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      setRunningIndex(null);
      setRevealed((current) => Math.max(current, index + 1));
    }, REVEAL_MS);
  }, []);

  // Re-hydrate reveal progress; play a triage intro animation on fresh workflow loads.
  useEffect(() => {
    if (!vm || !snapshot || advancing) return;

    const workflowBound = Boolean(pollWorkflowId);
    const stepped = isSteppedSnapshot(snapshot);
    if (!stepped && !workflowBound) return;

    const fromSnapshot = computeRevealedProgress(vm.nodes, snapshot);
    const triageBootstrapping =
      workflowBound &&
      (snapshot.status === "running" || snapshot.status === "assigned") &&
      (snapshot.node === "triage" || !vm.nodes[0]?.available);

    const triagePausedForNext =
      snapshot.status === "awaiting_step" &&
      snapshot.node === "customer_history" &&
      fromSnapshot >= 1;

    if (triageBootstrapping) {
      triageWasRunning.current = true;
      if (runningIndex === null && revealed === 0) {
        setRunningIndex(0);
      }
      return;
    }

    // Triage finished on the backend — complete the intro even if runningIndex
    // is still 0 from the bootstrap spinner (must run before the guard below).
    if (!bootstrapPlayed.current && workflowBound && triagePausedForNext) {
      bootstrapPlayed.current = true;
      triageWasRunning.current = false;
      startReveal(0);
      return;
    }

    if (runningIndex !== null) return;

    if (!bootstrapPlayed.current && workflowBound && fromSnapshot > 1) {
      bootstrapPlayed.current = true;
      setRevealed(fromSnapshot);
      return;
    }

    if (bootstrapPlayed.current || !workflowBound) {
      setRevealed((current) =>
        current === 0 && fromSnapshot > 0 && !bootstrapPlayed.current
          ? fromSnapshot
          : Math.max(current, fromSnapshot)
      );
    }
  }, [
    vm,
    snapshot,
    runningIndex,
    advancing,
    pollWorkflowId,
    revealed,
    startReveal
  ]);

  /**
   * Phase 2 — call the `/advance` proxy to run the next graph node on the
   * backend, then animate the reveal of its result. Used when
   * `snapshot.status === "awaiting_step"`.
   */
  const advanceStep = useCallback(
    async (index: number) => {
      if (!snapshot?.workflowId) return;
      setAdvancing(true);
      setAdvanceError(null);
      try {
        const response = await fetch(
          `/api/orchestrator/${snapshot.workflowId}/advance`,
          {
            method: "POST",
            headers: { accept: "application/json" },
            cache: "no-store"
          }
        );
        if (!response.ok) {
          setAdvanceError(`Advance failed (${response.status}).`);
          return;
        }
        const updated = sanitizeSnapshot(await response.json());
        if (updated) {
          setSnapshot(updated);
          if (isTerminalStatus(updated.status)) stopped.current = true;
        }
        startReveal(index);
      } catch {
        setAdvanceError("Unable to advance step.");
      } finally {
        setAdvancing(false);
      }
    },
    [snapshot?.workflowId, startReveal]
  );

  const handleOperatorLogin = useCallback(async () => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/orchestrator/operator-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode })
      });
      if (!response.ok) {
        setLoginError(
          response.status === 401 ? "Invalid access code." : "Login unavailable."
        );
        return;
      }
      setAccessCode("");
      setNeedsLogin(false);
      await load();
    } catch {
      setLoginError("Login unavailable.");
    } finally {
      setLoggingIn(false);
    }
  }, [accessCode, load]);

  if (!vm) {
    if (noWorkflowYet && caseId && !pollWorkflowId) {
      return (
        <div className={styles.wrap}>
          <SteppedStartPanel caseId={caseId} onStarted={handleSteppedStarted} />
        </div>
      );
    }
    if (needsLogin) {
      return (
        <div className={styles.wrap}>
          <div className={styles.startPanel}>
            <p className={styles.startTitle}>Operator sign-in required</p>
            <p className={styles.startCopy}>
              This stepped console needs an operator session to read orchestration
              status. Sign in with the access code, or start from{" "}
              <a href="/demo/case-create">demo Case create</a> to mint a session
              automatically.
            </p>
            {loginError ? (
              <p className={styles.startError} role="alert">
                {loginError}
              </p>
            ) : null}
            <div className={styles.startLogin}>
              <label className={styles.startLabel} htmlFor="stepped-view-access-code">
                Operator access code
              </label>
              <input
                id="stepped-view-access-code"
                type="password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                className={styles.startInput}
                placeholder="Enter access code"
              />
              <div className={styles.startActions}>
                <button
                  type="button"
                  className={styles.startPrimary}
                  disabled={!accessCode.trim() || loggingIn}
                  onClick={() => void handleOperatorLogin()}
                >
                  {loggingIn ? "Signing in…" : "Sign in ▸"}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.wrap}>
        <div className={styles.state} role="status">
          {error ?? "Loading orchestration console…"}
        </div>
      </div>
    );
  }

  const displayError = error ?? advanceError;

  // Stepped-mode signals: the backend is paused and waiting for an advance call.
  const isSteppedRun = snapshot?.status === "awaiting_step";
  // The node that will run on the next /advance (matches snapshot.node).
  const stepAwaitingNodeId = snapshot?.node;
  const awaitingIndex = vm
    ? vm.nodes.findIndex((n) => n.id === stepAwaitingNodeId)
    : -1;

  const nodeState = (index: number): NodeRenderState => {
    if (index < revealed) return "done";
    if (index === runningIndex) return "running";
    if (index === revealed) return "frontier";
    return "queued";
  };

  const frontier = vm.nodes[revealed];
  const allRevealed = revealed >= vm.nodes.length;
  const elapsedLabel = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  let pill: "running" | "ready" | "paused" | "complete";
  if (allRevealed && vm.complete && !vm.guardrailWaiting) pill = "complete";
  else if (allRevealed && vm.guardrailWaiting) pill = "paused";
  else if (runningIndex !== null || advancing) pill = "running";
  else if (isSteppedRun && awaitingIndex >= 0) pill = "ready";
  else if (isSteppedSnapshot(snapshot!)) pill = "paused";
  else pill = "running";

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const onRun = (index: number) => {
    if (runningIndex !== null || advancing) return;
    if (!isSteppedRun || index !== awaitingIndex) return;
    void advanceStep(index);
  };

  const orchState = resolveOrchState({
    pill,
    advancing,
    runningIndex,
    snapshotStatus: snapshot?.status
  });

  const orchActiveName =
    advancing || runningIndex !== null
      ? vm.nodes[runningIndex ?? awaitingIndex]?.name
      : snapshot?.status === "running" || snapshot?.status === "assigned"
        ? vm.nodes.find((node) => node.id === snapshot.node)?.name
        : orchState === "ready" && awaitingIndex >= 0
          ? vm.nodes[awaitingIndex]?.name
          : frontier?.name;

  return (
    <div className={styles.wrap}>
      {displayError ? (
        <div className={styles.state} role="alert">
          {displayError}
        </div>
      ) : null}

      {/* HEADER */}
      <header className={styles.top}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <span />
          </div>
          <div>
            <div className={styles.title}>Orchestration Console</div>
            <div className={styles.subtitle}>
              read-only observability · LangGraph · 6 nodes
            </div>
          </div>
        </div>
        <div className={styles.stats}>
          <Stat k="CASE" v={vm.caseNumber ?? "—"} />
          <Stat k="SOURCE" v="Web · Salesforce" />
          <Stat k="ELAPSED" v={elapsedLabel} />
          <Stat
            k="NODES"
            v={`${Math.min(revealed, vm.nodes.length)} / ${vm.nodes.length}`}
          />
          <Pill state={pill} />
        </div>
      </header>

      {/* PROGRESS */}
      <div className={styles.progress}>
        <div
          className={styles.fill}
          style={{
            width: `${(Math.min(revealed, vm.nodes.length) / vm.nodes.length) * 100}%`,
            background: pill === "paused" ? "#d97706" : "#111"
          }}
        />
      </div>

      {/* BODY */}
      <div className={styles.body}>
        {/* LEFT: spine */}
        <main className={styles.spine}>
          {/* origin */}
          <div className={styles.row}>
            <div className={styles.rail}>
              <div
                className={clsx(styles.line, styles.lineBot, styles.lineOn)}
              />
              <div className={styles.knot}>
                <span className={clsx(styles.dot, styles.dotDone)}>
                  <Check size={11} strokeWidth={3} />
                </span>
              </div>
            </div>
            <div className={styles.cellpad}>
              <div className={styles.chead}>
                <div
                  className={styles.ibox}
                  style={{ background: "#fff", color: "#111" }}
                >
                  <Inbox size={18} />
                </div>
                <div className={styles.cmid}>
                  <div className={styles.cname} style={{ color: "#141414" }}>
                    Case received
                  </div>
                  <div className={styles.csub}>
                    Web → Salesforce Case · workflow {vm.workflowId}
                  </div>
                </div>
                <span className={styles.status}>INTAKE</span>
              </div>
            </div>
          </div>

          {/* nodes */}
          {vm.nodes.map((node, index) => {
            const isRunnable = isSteppedRun && index === awaitingIndex;
            return (
              <NodeRow
                key={node.id}
                node={node}
                index={index}
                state={nodeState(index)}
                guardrailWaiting={vm.guardrailWaiting}
                open={!!open[node.id]}
                onToggle={() => toggle(node.id)}
                onRun={() => onRun(index)}
                runDisabled={runningIndex !== null || advancing || !isRunnable}
                steppedFrontier={isSteppedRun && index === awaitingIndex}
              />
            );
          })}

          {/* terminal */}
          <div className={styles.row}>
            <div className={styles.rail}>
              <div
                className={clsx(
                  styles.line,
                  styles.lineTop,
                  allRevealed && vm.complete && styles.lineOn
                )}
              />
              <div className={styles.knot}>
                <span
                  className={clsx(
                    styles.dot,
                    allRevealed && vm.complete && styles.dotDone
                  )}
                >
                  {allRevealed && vm.complete ? (
                    <Check size={11} strokeWidth={3} />
                  ) : null}
                </span>
              </div>
            </div>
            <div className={styles.cellpad} style={{ paddingBottom: 8 }}>
              <div
                className={styles.chead}
                style={{
                  cursor: vm.verdict && allRevealed ? "pointer" : "default"
                }}
                onClick={() => vm.verdict && allRevealed && toggle("verdict")}
              >
                <div
                  className={styles.ibox}
                  style={
                    allRevealed && vm.complete
                      ? { background: "#fff", color: "#111" }
                      : undefined
                  }
                >
                  <Flag size={18} />
                </div>
                <div className={styles.cmid}>
                  <div
                    className={styles.cname}
                    style={
                      allRevealed && vm.complete
                        ? { color: "#141414" }
                        : undefined
                    }
                  >
                    Case handled
                  </div>
                  <div className={styles.csub}>
                    operational intelligence logged
                  </div>
                </div>
                <span
                  className={clsx(
                    styles.status,
                    allRevealed && vm.complete && styles.statusDone
                  )}
                >
                  {allRevealed && vm.complete ? "DONE" : "PENDING"}
                </span>
                {vm.verdict && allRevealed ? (
                  <span
                    className={clsx(
                      styles.chev,
                      open.verdict && styles.chevOpen
                    )}
                  >
                    ⌄
                  </span>
                ) : null}
              </div>

              {vm.verdict && allRevealed ? (
                <>
                  <div className={styles.verdict}>
                    <div className={styles.vk}>ORCHESTRATOR VERDICT</div>
                    <div className={styles.vh}>{vm.verdict.headline}</div>
                    {vm.verdict.meta ? (
                      <div className={styles.vmeta}>{vm.verdict.meta}</div>
                    ) : null}
                  </div>
                  <div
                    className={clsx(
                      styles.accordion,
                      open.verdict && styles.accordionOpen
                    )}
                  >
                    <div className={styles.accInner}>
                      <div className={styles.accSummary}>
                        {vm.verdict.summary}
                      </div>
                      {vm.verdict.chips.length ? (
                        <Chips items={vm.verdict.chips} />
                      ) : null}
                      {vm.verdict.steps.length ? (
                        <>
                          <div className={styles.bt}>Recommended steps</div>
                          <ol className={styles.stepsList}>
                            {vm.verdict.steps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ol>
                        </>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </main>

        {/* RIGHT: orchestrator */}
        <aside className={styles.orch}>
          <div className={styles.opanel}>
            <div className={styles.ohead}>
              <div className={styles.oico}>
                <Cpu size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div className={styles.ot}>Orchestrator</div>
                <div className={styles.os}>
                  the brain · routes every handoff
                </div>
              </div>
            </div>
            <div className={styles.ostate}>
              <div className={styles.orow1}>
                <span
                  className={clsx(
                    styles.odot,
                    orchState === "dispatching" ||
                      orchState === "awaiting" ||
                      orchState === "ready"
                      ? styles.odotLive
                      : orchState === "paused"
                        ? styles.odotPaused
                        : orchState === "receiving" ||
                            orchState === "complete"
                          ? styles.odotActive
                          : undefined
                  )}
                />
                <span className={styles.olabel}>{orchLabel(orchState)}</span>
              </div>
              <div className={styles.osub}>
                {orchSub(orchState, orchActiveName)}
              </div>
            </div>
            <div className={styles.oactivity} aria-label="Orchestrator activity">
              <div className={styles.at}>ACTIVITY</div>
              {visibleActivity.map((entry) => (
                <div
                  key={entry.seq}
                  className={clsx(
                    styles.logrow,
                    entry.kind === "out" && styles.logOut,
                    entry.kind === "in" && styles.logIn,
                    entry.kind === "warn" && styles.logWarn
                  )}
                >
                  <span className={styles.lt}>#{entry.seq}</span>
                  <span className={styles.lg}>{logGlyph(entry.kind)}</span>
                  <span className={styles.lx}>{entry.text}</span>
                </div>
              ))}
            </div>
            <div className={styles.ofoot}>
              Approvals route via account-manager email / Salesforce. This
              console only reflects state — nothing is actioned here.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statK}>{k}</div>
      <div className={styles.statV}>{v}</div>
    </div>
  );
}

function Pill({
  state
}: {
  state: "running" | "ready" | "paused" | "complete";
}) {
  const label =
    state === "complete"
      ? "COMPLETE"
      : state === "paused"
        ? "WAITING · APPROVAL"
        : state === "ready"
          ? "AWAITING NEXT"
          : "RUNNING";
  return (
    <div
      className={clsx(
        styles.pill,
        state === "complete" && styles.pillComplete,
        state === "ready" && styles.pillReady,
        state === "paused" && styles.pillPaused
      )}
    >
      <span className={styles.pillDot} />
      <span>{label}</span>
    </div>
  );
}

function NodeRow({
  node,
  index,
  state,
  guardrailWaiting,
  open,
  onToggle,
  onRun,
  runDisabled,
  steppedFrontier = false
}: {
  node: SteppedNode;
  index: number;
  state: NodeRenderState;
  guardrailWaiting: boolean;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
  runDisabled: boolean;
  /** True when this node is the awaiting frontier in a real stepped run. */
  steppedFrontier?: boolean;
}) {
  const reached = state !== "queued";
  const Icon = NODE_ICON[node.icon];
  const approvalWaiting = Boolean(
    node.guardrail && guardrailWaiting && state === "done"
  );
  const showWaitNote = approvalWaiting;

  return (
    <div className={styles.row}>
      <div className={styles.rail}>
        <div
          className={clsx(
            styles.line,
            styles.lineTop,
            reached && styles.lineOn
          )}
        />
        <div
          className={clsx(
            styles.line,
            styles.lineBot,
            state === "done" && styles.lineOn
          )}
        />
        <div className={styles.knot}>
          <Dot
            state={state}
            approvalWaiting={Boolean(
              node.guardrail && guardrailWaiting && state === "done"
            )}
          />
        </div>
      </div>
      <div
        className={clsx(
          styles.card,
          reached && styles.reached,
          (state === "running" || state === "frontier") && styles.active,
          showWaitNote && styles.guardwait,
          state === "done" && styles.done
        )}
      >
        <div
          className={styles.chead}
          onClick={() => state === "done" && onToggle()}
        >
          <div className={styles.ibox}>
            <Icon size={18} />
          </div>
          <div className={styles.cmid}>
            <div className={styles.cnumName}>
              <span className={styles.cnum}>{node.n}</span>
              <span className={styles.cname}>{node.name}</span>
            </div>
            <div className={styles.csub}>{node.sub}</div>
          </div>
          <div className={styles.cright}>
            <span
              className={clsx(
                styles.status,
                approvalWaiting
                  ? styles.statusWaiting
                  : statusClass(state)
              )}
            >
              {approvalWaiting ? "WAITING" : statusLabel(state)}
            </span>
            {state === "done" && node.latency ? (
              <span className={styles.lat}>{node.latency}</span>
            ) : null}
          </div>
          {state === "done" ? (
            <span className={clsx(styles.chev, open && styles.chevOpen)}>
              ⌄
            </span>
          ) : null}
        </div>

        {state === "running" ? (
          <div className={styles.thinking}>
            analysing request
            <span className={styles.dots}>
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : null}

        {state === "frontier" ? (
          <div className={styles.ctl}>
            <button
              type="button"
              className={styles.nextbtn}
              disabled={runDisabled}
              onClick={onRun}
            >
              {steppedFrontier
                ? `Run ${node.name} ▸`
                : "Waiting for agent output"}
            </button>
            <span className={styles.hint}>
              {steppedFrontier
                ? "sends to backend, then reveals"
                : "awaiting prior stages to complete"}
            </span>
          </div>
        ) : null}

        {state === "queued" ? (
          <div className={styles.ctl}>
            <button type="button" className={styles.nextbtn} disabled>
              Waiting for agent output
            </button>
          </div>
        ) : null}

        {showWaitNote ? (
          <div className={styles.waitnote}>
            <span className={styles.bang}>!</span>
            <span>
              Approval requested — routed to{" "}
              <b>account-manager email / Salesforce</b>. Resolved out of band;
              this console is read-only.
            </span>
          </div>
        ) : state === "done" && node.output ? (
          <div className={styles.output}>
            <span className={styles.arr}>↳</span>
            <span className={styles.txt}>{node.output}</span>
            <span className={styles.to}>→ ORCHESTRATOR</span>
          </div>
        ) : null}

        {state === "done" ? (
          <div className={clsx(styles.accordion, open && styles.accordionOpen)}>
            <div className={styles.accInner}>
              {node.detail.map((section, i) => (
                <Section key={i} section={section} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Dot({
  state,
  approvalWaiting = false
}: {
  state: NodeRenderState;
  approvalWaiting?: boolean;
}) {
  if (approvalWaiting) {
    return <span className={clsx(styles.dot, styles.dotWaiting)} />;
  }
  if (state === "done") {
    return (
      <span className={clsx(styles.dot, styles.dotDone)}>
        <Check size={11} strokeWidth={3} />
      </span>
    );
  }
  if (state === "running") {
    return (
      <span className={clsx(styles.dot, styles.dotRunning)}>
        <span className={styles.mini} style={{ background: "#111" }} />
      </span>
    );
  }
  if (state === "frontier") {
    return <span className={clsx(styles.dot, styles.dotAssigned)} />;
  }
  return <span className={styles.dot} />;
}

function Section({ section }: { section: SteppedSection }) {
  if (section.type === "summary") {
    return <div className={styles.accSummary}>{section.text}</div>;
  }
  if (section.type === "fields") {
    return (
      <div className={styles.grid}>
        {section.items.map((field, i) => (
          <div key={i} className={styles.field}>
            <div className={styles.fk}>{field.k}</div>
            <div className={styles.fv}>{field.v}</div>
            {field.h ? <div className={styles.fh}>{field.h}</div> : null}
          </div>
        ))}
      </div>
    );
  }
  if (section.type === "list") {
    return (
      <div className={styles.block}>
        <div className={styles.bt}>{section.title}</div>
        {section.items.map((item, i) => (
          <div key={i} className={styles.item}>
            <div className={styles.itTop}>
              <span className={styles.itTitle}>{item.title}</span>
              {(item.tags ?? []).map((tag, j) => (
                <span
                  key={j}
                  className={clsx(
                    styles.tag,
                    tag.tone === "amber" && styles.tagAmber,
                    tag.tone === "ink" && styles.tagInk
                  )}
                >
                  {tag.t}
                </span>
              ))}
            </div>
            {item.meta ? (
              <div className={styles.itMeta}>{item.meta}</div>
            ) : null}
            {item.desc ? (
              <div className={styles.itDesc}>{item.desc}</div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }
  if (section.type === "chips") {
    return <Chips items={section.items} />;
  }
  if (section.type === "note") {
    return (
      <div
        className={styles.ofoot}
        style={{ borderRadius: 7, marginBottom: 14 }}
      >
        {section.text}
      </div>
    );
  }
  // trace
  return (
    <div className={styles.trace}>
      <div className={styles.tlabel}>Execution trace · agent reasoning</div>
      {section.items.map((step, i) => (
        <div
          key={i}
          className={clsx(
            styles.tstep,
            step.status === "assigned" && styles.tstepAssigned,
            step.status === "waiting_approval" && styles.tstepWaiting
          )}
        >
          <span className={styles.tknot} />
          <div className={styles.th}>
            <span className={styles.tn}>SEQ {i + 1}</span>
            <span className={styles.tt}>{step.label}</span>
            <span className={styles.tst}>{step.status}</span>
          </div>
          {step.fields.length ? (
            <div className={styles.tfields}>
              {step.fields.map((field, j) => (
                <span key={j} className={styles.tf}>
                  {field.k} <b>{field.v}</b>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Chips({ items }: { items: { k: string; v?: string }[] }) {
  return (
    <div className={styles.chips}>
      {items.map((chip, i) => (
        <span key={i} className={styles.chip}>
          {chip.k}
          {chip.v ? (
            <>
              : <b>{chip.v}</b>
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function statusLabel(state: NodeRenderState): string {
  return state === "done"
    ? "DONE"
    : state === "running"
      ? "RUNNING"
      : state === "frontier"
        ? "READY"
        : "QUEUED";
}

function statusClass(state: NodeRenderState): string | undefined {
  if (state === "done") return styles.statusDone;
  if (state === "running") return styles.statusRunning;
  if (state === "frontier") return styles.statusAssigned;
  return undefined;
}

function logGlyph(kind: "sys" | "out" | "in" | "warn"): string {
  return kind === "out"
    ? "→"
    : kind === "in"
      ? "←"
      : kind === "warn"
        ? "!"
        : "•";
}

function orchLabel(state: OrchUiState): string {
  switch (state) {
    case "dispatching":
      return "Dispatching →";
    case "awaiting":
      return "Awaiting node…";
    case "receiving":
      return "Receiving ←";
    case "ready":
      return "Awaiting Next ▸";
    case "paused":
      return "Paused";
    case "complete":
      return "Run complete";
    default:
      return "Working…";
  }
}

function orchSub(state: OrchUiState, activeName?: string): string {
  const name = activeName ?? "next stage";
  switch (state) {
    case "dispatching":
      return `handing case to ${name}`;
    case "awaiting":
      return `${name} is reasoning`;
    case "receiving":
      return `output from ${name}`;
    case "ready":
      return `press Run to dispatch ${name}`;
    case "paused":
      return "awaiting external approval";
    case "complete":
      return "all nodes settled";
    default:
      return "waiting for the next stage to finish";
  }
}

type OrchUiState =
  | "dispatching"
  | "awaiting"
  | "receiving"
  | "ready"
  | "paused"
  | "complete"
  | "working";

function resolveOrchState({
  pill,
  advancing,
  runningIndex,
  snapshotStatus
}: {
  pill: "running" | "ready" | "paused" | "complete";
  advancing: boolean;
  runningIndex: number | null;
  snapshotStatus?: OrchestrationSnapshot["status"];
}): OrchUiState {
  if (pill === "complete") return "complete";
  if (pill === "paused") return "paused";
  if (advancing) return "dispatching";
  if (runningIndex !== null) return "receiving";
  if (snapshotStatus === "running" || snapshotStatus === "assigned") {
    return "awaiting";
  }
  if (pill === "ready") return "ready";
  return "working";
}
