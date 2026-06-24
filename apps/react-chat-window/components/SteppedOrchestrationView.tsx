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
  type SteppedNode,
  type SteppedNodeIcon,
  type SteppedSection,
  type SteppedViewModel
} from "@/lib/stepped-view-model";

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
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(
    initialSnapshot ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const stopped = useRef(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!caseId && !workflowId) return;
    const path = workflowId
      ? `/api/orchestrator/${workflowId}`
      : `/api/orchestrator/case/${caseId}`;
    try {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      // Case may exist before its workflow does — keep polling quietly.
      if (response.status === 404 && caseId) return;
      if (!response.ok) {
        setError(`Orchestration status unavailable (${response.status}).`);
        return;
      }
      const parsed = sanitizeSnapshot(await response.json());
      if (parsed) {
        setError(null);
        setSnapshot(parsed);
        if (isTerminalStatus(parsed.status)) stopped.current = true;
      }
    } catch {
      setError("Unable to reach orchestration status.");
    }
  }, [caseId, workflowId]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    if (!caseId && !workflowId) return;
    void load();
    const id = setInterval(() => {
      if (!stopped.current) void load();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [load, pollIntervalMs, caseId, workflowId]);

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

  const startReveal = useCallback((index: number) => {
    setRunningIndex(index);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => {
      setRunningIndex(null);
      setRevealed((current) => Math.max(current, index + 1));
    }, REVEAL_MS);
  }, []);

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

  // Triage auto-runs as soon as the case is assigned (its result is available).
  useEffect(() => {
    if (!vm) return;
    if (revealed === 0 && runningIndex === null && vm.nodes[0]?.available) {
      startReveal(0);
    }
  }, [vm, revealed, runningIndex, startReveal]);

  if (!vm) {
    return (
      <div className={styles.wrap}>
        <div className={styles.state}>
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
  else if (frontier?.available) pill = "ready";
  else pill = "running";

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const onRun = (index: number) => {
    if (runningIndex !== null || advancing) return;
    // Stepped mode: the frontier node has not run yet — advance the backend.
    if (isSteppedRun && index === awaitingIndex) {
      void advanceStep(index);
      return;
    }
    // Replay mode: the node's data is already computed — reveal locally.
    if (!vm.nodes[index]?.available) return;
    startReveal(index);
  };

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
            // In stepped mode, the awaiting node is runnable even though its
            // data hasn't been fetched yet; all other non-available nodes stay
            // disabled. In replay mode, only available nodes are runnable.
            const isRunnable = isSteppedRun
              ? index === awaitingIndex
              : node.available;
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
                  className={styles.odot}
                  style={{ background: pill === "paused" ? "#d97706" : "#111" }}
                />
                <span className={styles.olabel}>
                  {orchLabel(pill, allRevealed)}
                </span>
              </div>
              <div className={styles.osub}>
                {orchSub(pill, frontier?.name, vm.guardrailWaiting)}
              </div>
            </div>
            <div className={styles.oactivity}>
              <div className={styles.at}>ACTIVITY</div>
              {vm.activity.map((entry) => (
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
  const showWaitNote = node.guardrail && guardrailWaiting && state === "done";

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
          <Dot state={state} />
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
            <span className={clsx(styles.status, statusClass(state))}>
              {statusLabel(state)}
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
              {steppedFrontier || node.available
                ? `Run ${node.name} ▸`
                : "Waiting for backend…"}
            </button>
            <span className={styles.hint}>
              {steppedFrontier
                ? "sends to backend, then reveals"
                : node.available
                  ? "press to reveal this stage"
                  : "this stage has not run yet"}
            </span>
          </div>
        ) : null}

        {state === "queued" ? (
          <div className={styles.ctl}>
            <button type="button" className={styles.nextbtn} disabled>
              Queued ▸
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

function Dot({ state }: { state: NodeRenderState }) {
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
            step.status === "assigned" && styles.tstepAssigned
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

function orchLabel(
  pill: "running" | "ready" | "paused" | "complete",
  allRevealed: boolean
): string {
  if (pill === "complete") return "Run complete";
  if (pill === "paused") return "Paused";
  if (pill === "ready") return "Awaiting Next ▸";
  return allRevealed ? "Settling…" : "Working…";
}

function orchSub(
  pill: "running" | "ready" | "paused" | "complete",
  frontierName: string | undefined,
  guardrailWaiting: boolean
): string {
  if (pill === "complete") return "all nodes settled";
  if (pill === "paused") return "awaiting external approval";
  if (pill === "ready")
    return `press Run to reveal ${frontierName ?? "next stage"}`;
  if (guardrailWaiting) return "guardrail awaiting approval";
  return "waiting for the next stage to finish";
}
