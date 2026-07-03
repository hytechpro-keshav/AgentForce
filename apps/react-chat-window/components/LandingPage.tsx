"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LandingChatPanel } from "./LandingChatPanel";

const TABS = [
  { n: "01", name: "Support", tag: "Multi-channel intake" },
  { n: "02", name: "Field", tag: "Dispatch & work orders" },
  { n: "03", name: "Repair", tag: "Depot · RMA · warranty" },
  { n: "04", name: "Parts", tag: "Inventory & logistics" },
  { n: "05", name: "Recovery", tag: "Secure end-of-life" }
];

const METRICS = [
  { value: 55, suffix: "%", arrow: "↓", label: "First-response time", sub: "on critical cases" },
  { value: 85, suffix: "%", arrow: "↑", label: "First-time fix rate", sub: "right tech, right parts on the van" },
  { value: 92, suffix: "%+", arrow: "↑", label: "SLA compliance", sub: "on priority downtime" },
  { value: 7, suffix: " hrs", arrow: "↓", label: "Admin time per tech", sub: "given back every week" }
];

const OUTCOMES = [
  { metric: "First-response time on critical cases", dir: "down", result: "Down ~55%" },
  { metric: "First-time fix rate", dir: "up", result: "Up to ~85%" },
  { metric: "SLA compliance on priority downtime", dir: "up", result: "92%+" },
  { metric: "Depot repair turnaround (mean time to repair)", dir: "down", result: "Down ~40%" },
  { metric: "Parts fill rate for scheduled jobs", dir: "up", result: "Up ~30%" },
  { metric: "Technician admin time", dir: "down", result: "−7 hrs / week per tech" },
  { metric: "Recovery value recaptured on retired assets", dir: "up", result: "40–60% of retail" },
  { metric: "Data-bearing assets with destruction certificates", dir: "flat", result: "100%" },
  { metric: "Time-to-detection of emerging product defects", dir: "down", result: "Weeks earlier" }
];

const APPROACH = [
  { t: "Grounded in unified data", d: "CRM, asset telemetry, service history, warranty, parts and catalogs join into one data layer — so agents act on context, not guesses. One customer, one asset, one source of truth." },
  { t: "Agents that reason and act", d: "Beyond chat: triage a case, book a field visit end-to-end, reroute a tech when a job cancels, flag a parts shortage before it bites, start a secure recovery — autonomously." },
  { t: "Trust, security & auditability", d: "Every autonomous action is permission-bound, logged and reversible. Sensitive steps carry human approval. Einstein-layer guardrails make agentic AI viable in regulated environments." },
  { t: "Predictive, not reactive", d: "Because all five pillars feed one model, failure modes, demand signals and SLA risk surface early — so leadership acts before a defect becomes a recall or a churn event." }
];

const WHY = [
  { t: "One engine, not ten tools", d: "The whole post-sale lifecycle on one platform with a single source of truth. Fragmentation — the root cause of most service failures — goes away." },
  { t: "Agentic AI that acts", d: "Agents triage, schedule, reroute, forecast and protect data autonomously — grounded in real customer and asset data, humans in the loop where it counts." },
  { t: "Salesforce-native", d: "Built inside your existing Salesforce estate. No rip-and-replace, no new island of data." },
  { t: "Built for high-stakes hardware", d: "We specialize in manufacturers whose products can't afford downtime — where a service miss is a business miss for the customer." },
  { t: "Secure & auditable end-to-end", d: "From Einstein-layer guardrails on every AI action to serialized certificates of destruction at end-of-life, trust is engineered in." },
  { t: "The whole loop closes", d: "Failure data from Repair and Recovery flows back to engineering and leadership — service stops being a cost center and starts improving the product." }
];

const PROBLEMS = [
  { t: "Cases arrive from everywhere", d: "Email, phone, portal, resellers and field escalations each land in a different system. Context is lost at every handoff." },
  { t: "Warranty data is scattered", d: "Agents can't tell in seconds whether a unit is in warranty, what its history is, or whether a known defect applies." },
  { t: "Skilled people do low-value work", d: "Technicians lose nearly a full working day each week to manual entry and paperwork — and about half of appointments don't go to plan." },
  { t: "Dispatch is a manual puzzle", d: "Matching tech to job across skills, geography, SLA and parts is done by hand, under pressure — and often wrong the first time." },
  { t: "Repairs & returns lose value", d: "Without disciplined RMA and depot flow, returned units sit in limbo, lose value daily, and never feed failure data back to engineering." },
  { t: "Leadership flies blind", d: "By the time a defect shows up in a monthly report, the damage — revenue, SLA credits, trust — is already done." }
];

const CERTS = [
  { t: "SOC 2 Type II", d: "Platform & data security" },
  { t: "ISO 27001", d: "Information security management" },
  { t: "ISO 9001", d: "Quality across delivery & depot ops" },
  { t: "NIST SP 800-88", d: "Aligned data sanitization" },
  { t: "NAID AAA", d: "Physical destruction specifications" },
  { t: "R2v3 certified", d: "Responsible recycling network" }
];

const FACTS = [
  { k: "Founded", v: "2016" },
  { k: "Headquarters", v: "Austin, Texas" },
  { k: "EMEA hub", v: "Dublin, Ireland" },
  { k: "Team", v: "~420 people" },
  { k: "Category", v: "Salesforce-native agentic AI" },
  { k: "Partner status", v: "Summit-tier · Agentforce" },
  { k: "Coverage", v: "North America & Europe" },
  { k: "Quality & security", v: "SOC 2 · ISO 27001 · ISO 9001" }
];

const LEADERS = [
  { r: "CEO & Co-Founder", d: "Company strategy; enterprise service transformation and Salesforce delivery.", i: "CE" },
  { r: "CTO & Co-Founder", d: "Platform architecture and the agentic AI engine.", i: "CT" },
  { r: "Chief AI Officer", d: "Agent design, evaluation and the trust / guardrail framework.", i: "AI" },
  { r: "SVP, Field & Depot Ops", d: "The Field, Repair and Parts delivery practices.", i: "FD" },
  { r: "VP, Secure Recovery", d: "The Recovery pillar, certifications and the ITAD network.", i: "SR" },
  { r: "VP, Customer Success · EMEA", d: "European delivery from the Dublin hub.", i: "CS" }
];

const STEPS = [
  { n: "01", t: "Discovery & Service Audit", d: "Map current-state service across all five pillars, quantify the pain, find the highest-ROI starting point." },
  { n: "02", t: "Command Center Design", d: "Define the unified data model, agent topics and actions, human-in-the-loop gates and success metrics." },
  { n: "03", t: "Phased Deployment", d: "Stand up pillars in priority order — typically Support and Field first — inside your Salesforce estate." },
  { n: "04", t: "Agent Tuning & Trust Validation", d: "Monitor agent performance, tune against real outcomes, validate guardrails and auditability." },
  { n: "05", t: "Scale & Optimize", d: "Expand across pillars and geographies, close the loop to engineering, improve from live operational data." }
];

// SVG helpers
const CheckSvg = ({ size = 17, stroke = "#139ED9", sw = "2.4" }: { size?: number; stroke?: string; sw?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: "2px" }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ShieldSvg = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activePillar, setActivePillar] = useState(0);
  const [metricVals, setMetricVals] = useState<number[]>([0, 0, 0, 0]);
  const [metricsDone, setMetricsDone] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);

  // Scroll progress + nav
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(y > 24);
      setProgress(Math.max(0, Math.min(1, y / (h || 1))));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-rotate tabs
  useEffect(() => {
    const timer = setInterval(() => setActivePillar((p) => (p + 1) % 5), 5000);
    return () => clearInterval(timer);
  }, []);

  // Reveal animation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const els = Array.from(container.querySelectorAll("[data-reveal]")) as HTMLElement[];
    els.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(26px)";
      el.style.transition = "opacity .7s cubic-bezier(.22,.61,.36,1), transform .7s cubic-bezier(.22,.61,.36,1)";
      el.style.willChange = "opacity, transform";
    });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = parseFloat(el.getAttribute("data-reveal-delay") ?? "0");
            el.style.transitionDelay = `${delay}ms`;
            el.style.opacity = "1";
            el.style.transform = "none";
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    const timer = setTimeout(() => {
      els.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    }, 480);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Metric count-up
  useEffect(() => {
    const band = metricsRef.current;
    if (!band) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !metricsDone) {
            runCountUp();
          }
        });
      },
      { threshold: 0.35 }
    );
    observer.observe(band);
    const fallback = setTimeout(() => { if (!metricsDone) runCountUp(); }, 620);
    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsDone]);

  function runCountUp() {
    if (metricsDone) return;
    setMetricsDone(true);
    const dur = 1500;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setMetricVals(METRICS.map((m) => Math.round(m.value * e)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => setMetricVals(METRICS.map((m) => m.value)), dur + 250);
  }

  const pillarPanels = [
    {
      num: "01", name: "Support", tag: "Help desk & multi-channel intake",
      headline: "Every channel, one case queue.",
      desc: "Email, phone, chat, portal and reseller submissions normalize into one structured record — tied to the customer, the exact asset by serial number, and its warranty entitlement.",
      outcome: "faster first response, higher deflection, and a clean record every downstream pillar can trust.",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13v-2a8 8 0 0 1 16 0v2" /><rect x="2.5" y="13" width="4" height="6" rx="1.4" /><rect x="17.5" y="13" width="4" height="6" rx="1.4" /></svg>,
      bgIcon: <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="rgba(19,158,217,.12)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", top: "-22px", right: "-18px", pointerEvents: "none" }}><path d="M4 13v-2a8 8 0 0 1 16 0v2" /><rect x="2.5" y="13" width="4" height="6" rx="1.4" /><rect x="17.5" y="13" width="4" height="6" rx="1.4" /></svg>,
      items: [
        "Omni-channel intake into one record, tied to customer, asset and entitlement",
        "AI triage classifies severity, checks warranty, links known defects, routes",
        "Agent assist surfaces the right manual, prior cases and next steps",
        "24/7 self-service that resolves, returns or books — autonomously"
      ]
    },
    {
      num: "02", name: "Field", tag: "Dispatch & work order management",
      headline: "The right tech, arriving prepared.",
      desc: "Turn a case into a completed, documented work order — matched across skills, geography, SLA and parts on the van, with routes optimized automatically.",
      outcome: "higher first-time fix, better SLA compliance, less windshield time; techs freed for skilled work.",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a3.7 3.7 0 0 0-5 5L4 17v3h3l5.7-5.7a3.7 3.7 0 0 0 5-5l-2.3 2.3-2-.5-.5-2 2.3-2.3z" /></svg>,
      bgIcon: <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="rgba(19,158,217,.12)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", top: "-22px", right: "-18px", pointerEvents: "none" }}><path d="M14.7 6.3a3.7 3.7 0 0 0-5 5L4 17v3h3l5.7-5.7a3.7 3.7 0 0 0 5-5l-2.3 2.3-2-.5-.5-2 2.3-2.3z" /></svg>,
      items: [
        "Scheduling across skills, certifications, SLA and parts-on-van, then route optimization",
        "Autonomous gap resolution on cancels, no-shows and early finishes",
        "Pre-work briefs — history, asset details, parts required — on mobile",
        "In-field guidance, image diagnostics and automated post-visit reporting"
      ]
    },
    {
      num: "03", name: "Repair", tag: "Depot repairs · RMA · warranty",
      headline: "Reverse flow, fully traceable.",
      desc: "Authorize returns, run depot repair and close warranty claims — with chain-of-custody from intake all the way to disposition.",
      outcome: "faster turnaround, higher yields, and a feedback loop that tells engineering exactly what's failing.",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.1" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>,
      bgIcon: <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="rgba(19,158,217,.12)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", top: "-22px", right: "-18px", pointerEvents: "none" }}><circle cx="12" cy="12" r="3.1" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>,
      items: [
        "Automated RMAs with return authorizations and prepaid labels in minutes",
        "Serial-scan intake, condition grading and disposition codes",
        "Board-level repair with genealogy and work-in-progress visibility",
        "Warranty validation, quality linkage and financial settlement in one flow"
      ]
    },
    {
      num: "04", name: "Parts", tag: "Inventory, logistics & shipments",
      headline: "The right part, before it's needed.",
      desc: "Real-time visibility across depots, warehouses, field stock and vans — with demand forecast from live service signals, so first-time fixes stop stalling on a missing component.",
      outcome: "higher fill rates, fewer wasted truck rolls, lower carrying cost, repairs that don't stall.",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="M3 7l9 5 9-5M12 12v10" /></svg>,
      bgIcon: <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="rgba(19,158,217,.12)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", top: "-22px", right: "-18px", pointerEvents: "none" }}><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="M3 7l9 5 9-5M12 12v10" /></svg>,
      items: [
        "Unified inventory across depots, warehouses, field stock and vans",
        "Predictive planning from open RMAs, WIP, failure trends and scheduled jobs",
        "Replenishment, cross-shipping, advance replacement and customs docs",
        "Consumption-linked requisitions keep stock accurate automatically"
      ]
    },
    {
      num: "05", name: "Recovery", tag: "Secure wipe · resale · recycling",
      headline: "End-of-life, done right.",
      desc: "Securely retire assets with an auditable paper trail — the way regulated enterprises require — while recapturing residual value along the way.",
      outcome: "zero data-breach exposure, defensible compliance, recovered value and measurable sustainability.",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
      bgIcon: <svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="rgba(19,158,217,.12)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", top: "-22px", right: "-18px", pointerEvents: "none" }}><path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
      items: [
        "Serialized chain of custody — tamper-evident containers, GPS-tracked transport",
        "NIST 800-88 sanitization; NAID AAA destruction; serialized certificates",
        "Functional hardware tested, graded and remarketed — proceeds returned",
        "R2v3 recycling with downstream due-diligence and environmental reporting"
      ]
    }
  ];

  const ap = activePillar;
  const panel = pillarPanels[ap]!;

  return (
    <>
      <style>{`
        @keyframes acp-pulse{0%,100%{opacity:.45;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
        @keyframes acp-pulseDown{0%{top:22px;opacity:0}12%{opacity:1}86%{opacity:1}100%{top:calc(100% - 40px);opacity:0}}
        @keyframes acp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes acp-toast{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
        @keyframes acp-ring{0%{transform:scale(.6);opacity:.6}100%{transform:scale(2.4);opacity:0}}
        @keyframes acp-botbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes acp-botwiggle{0%,60%,100%{transform:rotate(0)}66%{transform:rotate(-12deg)}72%{transform:rotate(10deg)}78%{transform:rotate(-7deg)}84%{transform:rotate(4deg)}90%{transform:rotate(-2deg)}}
        @keyframes acp-blink{0%,90%,100%{transform:scaleY(1)}93%{transform:scaleY(.1)}96%{transform:scaleY(1)}}
        @keyframes acp-bubblein{0%{opacity:0;transform:translateY(10px) scale(.9)}100%{opacity:1;transform:none}}
        @keyframes acp-panelin{0%{opacity:0;transform:translateY(16px) scale(.95)}100%{opacity:1;transform:none}}
      `}</style>

      <div
        ref={containerRef}
        style={{
          fontFamily: "'Hanken Grotesk',system-ui,-apple-system,sans-serif",
          color: "#0A2540",
          background: "#fff",
          overflowX: "hidden"
        }}
      >
        {/* Progress bar */}
        <div style={{ position: "fixed", top: 0, left: 0, height: "3px", width: `${(progress * 100).toFixed(2)}%`, background: "#139ED9", zIndex: 70, boxShadow: "0 0 10px rgba(19,158,217,.6)" }} />

        {/* Nav */}
        <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 60, background: scrolled ? "rgba(255,255,255,.82)" : "rgba(255,255,255,0)", boxShadow: scrolled ? "0 1px 0 rgba(10,37,64,.06),0 10px 34px rgba(10,37,64,.07)" : "none", backdropFilter: "saturate(160%) blur(14px)", WebkitBackdropFilter: "saturate(160%) blur(14px)", transition: "background .3s ease,box-shadow .3s ease" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: "68px" }}>
            <a href="#top" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
              <Image src="/ablypro-logo.png" alt="AblyPro" width={120} height={26} style={{ height: "26px", width: "auto", display: "block" }} />
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: "30px" }}>
              <a href="#platform" style={{ fontSize: "14.5px", fontWeight: 500, color: "#40566B", textDecoration: "none", letterSpacing: "-.01em" }}>Platform</a>
              <a href="#approach" style={{ fontSize: "14.5px", fontWeight: 500, color: "#40566B", textDecoration: "none", letterSpacing: "-.01em" }}>Approach</a>
              <a href="#results" style={{ fontSize: "14.5px", fontWeight: 500, color: "#40566B", textDecoration: "none", letterSpacing: "-.01em" }}>Results</a>
              <a href="#case" style={{ fontSize: "14.5px", fontWeight: 500, color: "#40566B", textDecoration: "none", letterSpacing: "-.01em" }}>Case study</a>
              <a href="#security" style={{ fontSize: "14.5px", fontWeight: 500, color: "#40566B", textDecoration: "none", letterSpacing: "-.01em" }}>Security</a>
              <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "#139ED9", color: "#fff", fontWeight: 600, fontSize: "14px", padding: "10px 18px", borderRadius: "9px", textDecoration: "none", boxShadow: "0 6px 18px -6px rgba(19,158,217,.7)", letterSpacing: "-.01em" }}>Book a service audit</a>
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section id="top" style={{ position: "relative", padding: "150px 0 84px", background: "radial-gradient(1100px 520px at 78% -8%,rgba(19,158,217,.13),#fff 62%)" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(#0a25400a 1px,transparent 1px),linear-gradient(90deg,#0a25400a 1px,transparent 1px)", backgroundSize: "56px 56px", WebkitMaskImage: "radial-gradient(900px 500px at 75% 5%,#000,transparent 75%)", maskImage: "radial-gradient(900px 500px at 75% 5%,#000,transparent 75%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", width: "min(1180px,100% - 48px)", margin: "0 auto", display: "flex", flexWrap: "wrap", gap: "56px", alignItems: "center" }}>
            <div style={{ flex: "1 1 470px", minWidth: "320px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "9px", padding: "7px 13px", border: "1px solid rgba(19,158,217,.32)", background: "rgba(19,158,217,.08)", borderRadius: "100px", marginBottom: "24px" }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#139ED9", animation: "acp-pulse 2.2s ease-in-out infinite" }} />
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "#0E5E86" }}>Salesforce-native agentic AI</span>
              </div>
              <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(38px,5vw,62px)", lineHeight: 1.02, letterSpacing: "-.03em", margin: "0 0 22px", color: "#0A2540" }}>The Service Command Center for the products that keep the world running.</h1>
              <p style={{ fontSize: "19px", lineHeight: 1.6, color: "#43596E", margin: "0 0 34px", maxWidth: "540px" }}>Ablypro turns fractured, manual after-sales operations into one connected engine — Support, Field, Repair, Parts and Recovery — with autonomous AI agents that reason, decide and act on your real Salesforce data.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center" }}>
                <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "9px", background: "#139ED9", color: "#fff", fontWeight: 600, fontSize: "16px", padding: "15px 26px", borderRadius: "11px", textDecoration: "none", boxShadow: "0 14px 30px -10px rgba(19,158,217,.75)", letterSpacing: "-.01em" }}>
                  Book a service audit
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </a>
                <a href="#platform" style={{ display: "inline-flex", alignItems: "center", gap: "9px", background: "#fff", color: "#0A2540", fontWeight: 600, fontSize: "16px", padding: "15px 24px", borderRadius: "11px", textDecoration: "none", border: "1px solid #DCE6EF", letterSpacing: "-.01em" }}>See the five pillars</a>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px", marginTop: "38px", alignItems: "center" }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".12em", textTransform: "uppercase", color: "#8598AB" }}>Trusted foundation</span>
                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#4A6076" }}>Summit-tier Salesforce Partner</span>
                <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#C3D0DC" }} />
                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#4A6076" }}>Agentforce Specialized</span>
                <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#C3D0DC" }} />
                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#4A6076" }}>SOC 2 Type II</span>
              </div>
            </div>

            {/* Hero dashboard card */}
            <div style={{ flex: "1 1 400px", minWidth: "310px", display: "flex", justifyContent: "center" }}>
              <div style={{ position: "relative", width: "100%", maxWidth: "440px", animation: "acp-float 7s ease-in-out infinite" }}>
                <div style={{ position: "absolute", inset: "-26px -18px", background: "radial-gradient(closest-side,rgba(19,158,217,.22),transparent)", filter: "blur(10px)", borderRadius: "40px" }} />
                <div style={{ position: "relative", background: "#fff", border: "1px solid #E4EDF5", borderRadius: "22px", boxShadow: "0 40px 80px -30px rgba(10,37,64,.4),0 12px 30px -10px rgba(10,37,64,.12)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #EEF3F8", background: "linear-gradient(180deg,#fbfdff,#fff)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#139ED9", boxShadow: "0 0 0 4px rgba(19,158,217,.18)" }} />
                      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "14.5px", color: "#0A2540" }}>Service Command Center</span>
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "10px", fontWeight: 500, letterSpacing: ".1em", color: "#1F9D6B", background: "#EAF7F1", padding: "4px 8px", borderRadius: "6px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#1F9D6B", animation: "acp-pulse 1.8s ease-in-out infinite" }} />LIVE
                    </span>
                  </div>
                  <div style={{ display: "flex", borderBottom: "1px solid #EEF3F8" }}>
                    {[["SLA","92%","↑"],["First-time fix","85%","↑"],["Open critical","6",""]].map(([lbl,val,arr]) => (
                      <div key={lbl} style={{ flex: 1, padding: "13px 16px", borderRight: lbl !== "Open critical" ? "1px solid #EEF3F8" : undefined }}>
                        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9.5px", letterSpacing: ".1em", textTransform: "uppercase", color: "#8598AB" }}>{lbl}</div>
                        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "21px", color: "#0A2540" }}>{val}<span style={{ fontSize: "12px", color: "#1F9D6B" }}>{arr}</span></div>
                      </div>
                    ))}
                  </div>
                  <div style={{ position: "relative", padding: "18px 20px 6px" }}>
                    <div style={{ position: "absolute", left: "33px", top: "26px", bottom: "26px", width: "2px", background: "linear-gradient(180deg,#139ED9,rgba(19,158,217,.4),transparent)", borderRadius: "2px" }} />
                    <div style={{ position: "absolute", left: "29px", width: "10px", height: "10px", borderRadius: "50%", background: "#139ED9", boxShadow: "0 0 0 4px rgba(19,158,217,.2)", animation: "acp-pulseDown 3.4s ease-in-out infinite" }} />
                    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "13px" }}>
                      {[
                        { name:"Support", sub:"Case #7741 triaged & routed", badge:"auto", badgeBg:"#EAF7F1", badgeColor:"#1F9D6B", icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="13" width="4" height="6" rx="1.4"/><rect x="17.5" y="13" width="4" height="6" rx="1.4"/></svg> },
                        { name:"Field", sub:"Tech dispatched · ETA 34 min", badge:"en route", badgeBg:"rgba(19,158,217,.12)", badgeColor:"#0E5E86", icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a3.7 3.7 0 0 0-5 5L4 17v3h3l5.7-5.7a3.7 3.7 0 0 0 5-5l-2.3 2.3-2-.5-.5-2 2.3-2.3z"/></svg> },
                        { name:"Repair", sub:"RMA #4821 graded · restock", badge:"depot", badgeBg:"#F1F5F9", badgeColor:"#8598AB", icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg> },
                        { name:"Parts", sub:"Stock pre-positioned · Dublin", badge:"ready", badgeBg:"#EAF7F1", badgeColor:"#1F9D6B", icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg> },
                        { name:"Recovery", sub:"Wiped to NIST 800-88 · cert issued", badge:"certified", badgeBg:"#EAF7F1", badgeColor:"#1F9D6B", icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg> }
                      ].map((row) => (
                        <div key={row.name} style={{ display: "flex", alignItems: "center", gap: "13px" }}>
                          <span style={{ position: "relative", zIndex: 1, flex: "none", width: "28px", height: "28px", borderRadius: "50%", background: "#fff", border: "2px solid #139ED9", display: "flex", alignItems: "center", justifyContent: "center", color: "#139ED9" }}>{row.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#0A2540" }}>{row.name}</div>
                            <div style={{ fontSize: "11.5px", color: "#8598AB" }}>{row.sub}</div>
                          </div>
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9.5px", color: row.badgeColor, background: row.badgeBg, padding: "3px 7px", borderRadius: "5px" }}>{row.badge}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ margin: "10px 20px 18px", display: "flex", alignItems: "center", gap: "11px", padding: "11px 14px", background: "rgba(19,158,217,.09)", border: "1px solid rgba(19,158,217,.22)", borderRadius: "11px", animation: "acp-toast .8s ease .4s both" }}>
                    <span style={{ flex: "none", width: "26px", height: "26px", borderRadius: "8px", background: "#139ED9", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
                    </span>
                    <span style={{ fontSize: "12.5px", lineHeight: 1.35, color: "#0A2540" }}><b style={{ fontWeight: 600 }}>Agent rerouted Tech #17</b> after a cancellation — SLA protected, no overtime.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Cert strip */}
        <section style={{ padding: "26px 0", borderTop: "1px solid #EEF3F8", borderBottom: "1px solid #EEF3F8", background: "#FbFcFe" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto", display: "flex", flexWrap: "wrap", gap: "18px 34px", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8598AB" }}>Compliance & certifications</span>
            {["SOC 2 Type II","ISO 27001","ISO 9001","NIST SP 800-88","NAID AAA","R2v3"].map((c) => (
              <span key={c} style={{ fontSize: "14px", fontWeight: 600, color: "#43596E" }}>{c}</span>
            ))}
          </div>
        </section>

        {/* Problem */}
        <section id="problem" style={{ padding: "clamp(64px,8vw,110px) 0", background: "#F5F9FD", scrollMarginTop: "80px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "44px", alignItems: "flex-end", marginBottom: "52px" }}>
              <div style={{ flex: "1 1 520px" }} data-reveal="">
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>The problem we solve</div>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>Great products.<br />Fractured service.</h2>
              </div>
              <p style={{ flex: "1 1 340px", fontSize: "17.5px", lineHeight: 1.62, color: "#43596E", margin: 0 }} data-reveal="" data-reveal-delay="80">Most manufacturers build excellent hardware. Where they struggle is everything <em style={{ fontStyle: "normal", color: "#0A2540", fontWeight: 600 }}>after the sale</em> — the moments that decide whether a customer renews, refers and trusts the brand. Today those moments sprawl across a dozen disconnected tools.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "18px" }}>
              {PROBLEMS.map((p) => (
                <div key={p.t} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "15px", padding: "24px 24px 26px" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C0492E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "14px" }}>
                    <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  </svg>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "17px", color: "#0A2540", marginBottom: "8px", letterSpacing: "-.01em" }}>{p.t}</div>
                  <div style={{ fontSize: "14.5px", lineHeight: 1.55, color: "#5A7189" }}>{p.d}</div>
                </div>
              ))}
            </div>
            <div data-reveal="" style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "18px 30px", background: "#0A2540", borderRadius: "16px", padding: "28px 32px" }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "clamp(28px,3vw,38px)", color: "#fff", letterSpacing: "-.02em" }}>Built to solve this cluster<br />as <span style={{ color: "#139ED9" }}>one problem</span> — because it is.</div>
              <div style={{ flex: 1, minWidth: "200px", fontSize: "15px", lineHeight: 1.6, color: "#AEC3D6" }}>Fragmentation is the root cause of most service failures. Ablypro unifies the entire lifecycle onto one platform and one set of AI agents.</div>
            </div>
          </div>
        </section>

        {/* Platform */}
        <section id="platform" style={{ padding: "clamp(64px,8vw,112px) 0", background: "#fff", scrollMarginTop: "76px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ maxWidth: "720px", marginBottom: "44px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>The platform · five pillars</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: "0 0 16px", color: "#0A2540" }}>One connected engine, five pillars.</h2>
              <p style={{ fontSize: "17.5px", lineHeight: 1.62, color: "#43596E", margin: 0 }}>Each pillar is powerful on its own. The value compounds when they share one data model and one set of AI agents — the whole post-sale lifecycle, end to end.</p>
            </div>

            {/* Tabs */}
            <div style={{ position: "relative", borderBottom: "1px solid #E3EBF2", marginBottom: "38px" }} data-reveal="">
              <div style={{ position: "relative", display: "flex", gap: 0 }}>
                {TABS.map((tab, i) => (
                  <button
                    key={i}
                    data-tab=""
                    onClick={() => setActivePillar(i)}
                    style={{ flex: 1, minWidth: 0, background: "none", border: 0, cursor: "pointer", padding: "15px 12px 17px", textAlign: "left", display: "flex", alignItems: "center", gap: "12px", fontFamily: "inherit" }}
                  >
                    <span data-badge="" style={{ flex: "none", width: "34px", height: "34px", borderRadius: "9px", border: `1px solid ${i === ap ? "#139ED9" : "#E3EBF2"}`, background: i === ap ? "#139ED9" : "#EEF3F8", color: i === ap ? "#fff" : "#93A4B5", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .3s ease" }}>{tab.n}</span>
                    <span style={{ minWidth: 0 }}>
                      <span data-tabname="" style={{ display: "block", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "16px", color: i === ap ? "#0A2540" : "#5A7189", transition: "color .3s ease", letterSpacing: "-.01em" }}>{tab.name}</span>
                      <span style={{ display: "block", fontSize: "11.5px", color: "#93A4B5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tab.tag}</span>
                    </span>
                  </button>
                ))}
                <div style={{ position: "absolute", left: 0, bottom: "-1px", width: "20%", height: "3px", background: "#139ED9", borderRadius: "3px 3px 0 0", transform: `translateX(${ap * 100}%)`, transition: "transform .45s cubic-bezier(.6,.2,.1,1)" }} />
              </div>
            </div>

            {/* Pillar content */}
            <div style={{ minHeight: "378px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "40px", alignItems: "stretch", animation: "acp-toast .5s ease" }}>
                <div style={{ flex: "1 1 430px", minWidth: "300px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
                    <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "50px", lineHeight: 1, color: "rgba(19,158,217,.34)" }}>{panel.num}</span>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "25px", color: "#0A2540", letterSpacing: "-.01em" }}>{panel.name}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", letterSpacing: ".1em", textTransform: "uppercase", color: "#139ED9" }}>{panel.tag}</div>
                    </div>
                  </div>
                  <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(23px,2.6vw,31px)", lineHeight: 1.12, letterSpacing: "-.02em", color: "#0A2540", margin: "0 0 15px" }}>{panel.headline}</h3>
                  <p style={{ fontSize: "16.5px", lineHeight: 1.62, color: "#43596E", margin: 0 }}>{panel.desc}</p>
                  <div style={{ marginTop: "auto", paddingTop: "24px" }}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", background: "rgba(19,158,217,.08)", border: "1px solid rgba(19,158,217,.2)", borderRadius: "13px", padding: "15px 17px" }}>
                      <CheckSvg size={18} stroke="#139ED9" sw="2.3" />
                      <div style={{ fontSize: "14.5px", lineHeight: 1.5, color: "#0A2540" }}><b style={{ fontWeight: 600 }}>The outcome</b> — {panel.outcome}</div>
                    </div>
                  </div>
                </div>
                <div style={{ flex: "1 1 380px", minWidth: "300px", position: "relative", overflow: "hidden", background: "linear-gradient(180deg,#FbFdFf,#F5F9FD)", border: "1px solid #E6EDF4", borderRadius: "18px", padding: "28px 30px" }}>
                  {panel.bgIcon}
                  <div style={{ position: "relative", fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8598AB" }}>What it does</div>
                  <ul style={{ position: "relative", listStyle: "none", margin: "18px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "15px" }}>
                    {panel.items.map((item) => (
                      <li key={item} style={{ display: "flex", gap: "11px", alignItems: "flex-start" }}>
                        <CheckSvg />
                        <span style={{ fontSize: "15px", lineHeight: 1.5, color: "#3C5268" }}>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Approach */}
        <section id="approach" style={{ position: "relative", padding: "clamp(64px,8vw,112px) 0", background: "#0A2540", color: "#fff", overflow: "hidden", scrollMarginTop: "76px" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(900px 460px at 82% -6%,rgba(19,158,217,.3),transparent 70%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)", backgroundSize: "58px 58px", WebkitMaskImage: "radial-gradient(800px 500px at 80% 0,#000,transparent 72%)", maskImage: "radial-gradient(800px 500px at 80% 0,#000,transparent 72%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ maxWidth: "760px", marginBottom: "48px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>The Ablypro approach</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.05, letterSpacing: "-.025em", margin: "0 0 16px", color: "#fff" }}>It&apos;s not just five pillars — it&apos;s how they run.</h2>
              <p style={{ fontSize: "17.5px", lineHeight: 1.62, color: "#AEC3D6", margin: 0 }}>A single agentic AI engine across the entire lifecycle, built natively on Salesforce. One data model. One set of agents. Coordinated action, grounded in real data.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(258px,1fr))", gap: "18px" }}>
              {APPROACH.map((a, i) => (
                <div key={a.t} data-reveal="" style={{ background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px 24px", backdropFilter: "blur(4px)" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "42px", height: "42px", borderRadius: "11px", background: "rgba(19,158,217,.22)", border: "1px solid rgba(19,158,217,.45)", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "15px", color: "#139ED9", marginBottom: "18px" }}>{String(i + 1).padStart(2, "0")}</div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "18px", color: "#fff", marginBottom: "10px", letterSpacing: "-.01em" }}>{a.t}</div>
                  <div style={{ fontSize: "14.5px", lineHeight: 1.58, color: "#9FB6CB" }}>{a.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Results */}
        <section id="results" style={{ padding: "clamp(64px,8vw,110px) 0", background: "#F5F9FD", scrollMarginTop: "76px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px 44px", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "44px" }}>
              <div style={{ maxWidth: "620px" }} data-reveal="">
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Illustrative outcomes</div>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>Numbers that move the business.</h2>
              </div>
              <p style={{ maxWidth: "340px", fontSize: "15px", lineHeight: 1.6, color: "#5A7189", margin: 0 }} data-reveal="" data-reveal-delay="80">Representative of the Ablypro engagement model for a client of this profile. See the full picture in the <a href="#case" style={{ color: "#139ED9", fontWeight: 600, textDecoration: "none" }}>VoltEdge case study ↓</a></p>
            </div>
            <div ref={metricsRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "18px" }}>
              {METRICS.map((m, i) => (
                <div key={m.label} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "16px", padding: "26px 25px", boxShadow: "0 1px 2px rgba(10,37,64,.04)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "8px", background: "#EAF7F1", color: "#1F9D6B", fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>{m.arrow}</span>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "clamp(42px,5vw,58px)", lineHeight: .95, color: "#0A2540", letterSpacing: "-.03em" }}>
                    {metricVals[i] ?? 0}<span style={{ fontSize: ".46em", fontWeight: 600, color: "#139ED9", letterSpacing: 0 }}>{m.suffix}</span>
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "15.5px", color: "#0A2540", marginTop: "14px" }}>{m.label}</div>
                  <div style={{ fontSize: "13px", lineHeight: 1.45, color: "#7A8C9E", marginTop: "4px" }}>{m.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Case study */}
        <section id="case" style={{ position: "relative", padding: "clamp(64px,8vw,112px) 0", background: "#fff", scrollMarginTop: "76px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "20px 32px", marginBottom: "40px" }} data-reveal="">
              <div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Flagship engagement</div>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.03, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>VoltEdge Technologies</h2>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", paddingBottom: "6px" }}>
                {["Laptops","Routers","Enterprise networking"].map((tag) => (
                  <span key={tag} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "#5A7189", background: "#F1F5F9", border: "1px solid #E3EBF2", padding: "6px 11px", borderRadius: "100px" }}>{tag}</span>
                ))}
              </div>
            </div>

            <div data-reveal="" style={{ position: "relative", background: "linear-gradient(135deg,rgba(19,158,217,.1),#F5F9FD)", border: "1px solid rgba(19,158,217,.18)", borderRadius: "20px", padding: "40px 44px", marginBottom: "34px", overflow: "hidden" }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "110px", lineHeight: .6, color: "rgba(19,158,217,.26)", position: "absolute", top: "26px", left: "26px", pointerEvents: "none" }}>&ldquo;</div>
              <blockquote style={{ position: "relative", margin: 0, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500, fontSize: "clamp(21px,2.5vw,30px)", lineHeight: 1.32, letterSpacing: "-.02em", color: "#0A2540", maxWidth: "900px" }}>We were selling faster than we could serve. Ablypro didn&apos;t just give us better tools — it gave us <span style={{ color: "#139ED9" }}>one nervous system</span> for the entire service organization.</blockquote>
              <div style={{ position: "relative", marginTop: "22px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", letterSpacing: ".04em", color: "#4A6076" }}>— VP of Customer Operations, VoltEdge Technologies</div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "40px", marginBottom: "52px", alignItems: "stretch" }}>
              <div style={{ flex: "1 1 400px", minWidth: "300px" }} data-reveal="">
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8598AB", marginBottom: "18px" }}>The core conflict</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {[
                    { icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>, t: "High stakes", d: "Retail customers run payment systems on VoltEdge routers. Every hour offline is money out of the till." },
                    { icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="8" height="6" rx="1"/><rect x="13" y="4" width="8" height="6" rx="1"/><rect x="3" y="14" width="8" height="6" rx="1"/><rect x="13" y="14" width="8" height="6" rx="1"/></svg>, t: "Data silos", d: "Cases poured in from fragmented channels while warranty data sat scattered across systems." },
                    { icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg>, t: "Manual inefficiencies", d: "Agents searched through manuals; dispatchers matched techs by hand — slowly, and often wrong." },
                    { icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4 10 7a12 12 0 0 1-2.4 3.4M6.6 6.6A12 12 0 0 0 2 12c1 3 5 7 10 7a9.7 9.7 0 0 0 2.6-.4"/></svg>, t: "Blind spots", d: "Leadership lacked real-time visibility, so product and service defects surfaced far too late." }
                  ].map((row) => (
                    <div key={row.t} style={{ display: "flex", gap: "14px" }}>
                      <div style={{ flex: "none", width: "38px", height: "38px", borderRadius: "10px", background: "#FBEDE8", color: "#C0492E", display: "flex", alignItems: "center", justifyContent: "center" }}>{row.icon}</div>
                      <div>
                        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "16px", color: "#0A2540", marginBottom: "3px" }}>{row.t}</div>
                        <div style={{ fontSize: "14.5px", lineHeight: 1.5, color: "#5A7189" }}>{row.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ flex: "1 1 360px", minWidth: "300px", display: "flex", flexDirection: "column" }} data-reveal="" data-reveal-delay="90">
                <div style={{ width: "100%", height: "340px", background: "linear-gradient(135deg,#F5F9FD,#E8F3FB)", borderRadius: "16px", boxShadow: "0 24px 54px -26px rgba(10,37,64,.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ textAlign: "center", color: "#8598AB" }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C3D0DC" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "10px" }}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                    <div style={{ fontSize: "12px", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: ".04em" }}>Product environment photo</div>
                  </div>
                </div>
                <div style={{ marginTop: "12px", fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "#93A4B5", letterSpacing: ".02em" }}>Illustrative — VoltEdge routers keep retail payment systems online.</div>
              </div>
            </div>

            <div data-reveal="" style={{ marginBottom: "22px" }}>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8598AB", marginBottom: "6px" }}>The mandate — an AI Service Command Center</div>
              <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(21px,2.4vw,28px)", lineHeight: 1.15, letterSpacing: "-.02em", color: "#0A2540", margin: 0, maxWidth: "760px" }}>How we deployed the five pillars at VoltEdge</h3>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: "16px", marginBottom: "34px" }}>
              {[
                { code:"01 · SUPPORT", text:"Every channel into one queue; AI triage checks warranty and routes a downed payment router straight to a tech." },
                { code:"02 · FIELD", text:"Autonomous dispatch across skills, SLA and parts-on-van; cancellations reshuffle to protect SLAs and avoid overtime." },
                { code:"03 · REPAIR", text:"Auto RMAs and labels, serial-scanned intake, depot repair with genealogy; warranty validates and settles in-flow." },
                { code:"04 · PARTS", text:"Real-time inventory across depots, warehouses and vans; predictive planning pre-positions parts across NA & Europe." },
                { code:"05 · RECOVERY", text:"Serialized chain of custody, NIST 800-88 wipes with certificates, graded for resale or responsibly recycled." }
              ].map((item) => (
                <div key={item.code} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "15px", padding: "22px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "#139ED9", letterSpacing: ".08em" }}>{item.code}</div>
                  <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#43596E", marginTop: "10px" }}>{item.text}</div>
                </div>
              ))}
            </div>

            <div data-reveal="" style={{ display: "flex", gap: "14px", alignItems: "flex-start", background: "rgba(19,158,217,.07)", borderLeft: "3px solid #139ED9", borderRadius: "0 12px 12px 0", padding: "20px 24px", marginBottom: "44px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#139ED9" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: "1px" }}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8M7 9l3 3 4-5"/></svg>
              <div style={{ fontSize: "15.5px", lineHeight: 1.55, color: "#33495F" }}><b style={{ fontWeight: 600, color: "#0A2540" }}>Above it all, the Command Center.</b> Because all five pillars share one data model, recurring router failures, parts shortages and SLA risks surface early — turning VoltEdge&apos;s leadership from the last to know into the first.</div>
            </div>

            <div data-reveal="" style={{ position: "relative", overflow: "hidden", background: "#0A2540", borderRadius: "20px", padding: "clamp(28px,4vw,40px)" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(700px 340px at 88% -10%,rgba(19,158,217,.26),transparent 68%)", pointerEvents: "none" }} />
              <div style={{ position: "relative", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: "12px", marginBottom: "20px" }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "19px", color: "#fff" }}>Illustrative outcomes</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", color: "#7C93A9", letterSpacing: ".04em" }}>Representative of the Ablypro engagement model</div>
              </div>
              <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
                {OUTCOMES.map((o) => {
                  const arrow = o.dir === "up" ? "↑" : o.dir === "down" ? "↓" : "—";
                  return (
                    <div key={o.metric} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "15px 0", borderTop: "1px solid rgba(255,255,255,.09)" }}>
                      <span style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "7px", background: "rgba(31,157,107,.16)", color: "#4FD6A0", fontSize: "14px", fontWeight: 700 }}>{arrow}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: "15px", lineHeight: 1.4, color: "#D3E0EC" }}>{o.metric}</span>
                      <span style={{ flex: "none", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "15.5px", color: "#fff", textAlign: "right", letterSpacing: "-.01em" }}>{o.result}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Why Ablypro */}
        <section style={{ padding: "clamp(64px,8vw,110px) 0", background: "#F5F9FD" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ maxWidth: "640px", marginBottom: "46px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Why Ablypro</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>Why high-stakes manufacturers choose us.</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "18px" }}>
              {WHY.map((w) => (
                <div key={w.t} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "15px", padding: "26px 26px 28px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "10px", background: "rgba(19,158,217,.12)", color: "#139ED9", marginBottom: "16px" }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "17.5px", color: "#0A2540", marginBottom: "9px", letterSpacing: "-.01em" }}>{w.t}</div>
                  <div style={{ fontSize: "14.5px", lineHeight: 1.58, color: "#5A7189" }}>{w.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" style={{ padding: "clamp(64px,8vw,110px) 0", background: "#fff", scrollMarginTop: "76px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px 44px", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "44px" }}>
              <div style={{ maxWidth: "620px" }} data-reveal="">
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Certifications, compliance & security</div>
                <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>Trust, engineered in — not bolted on.</h2>
              </div>
              <p style={{ maxWidth: "330px", fontSize: "15px", lineHeight: 1.6, color: "#5A7189", margin: 0 }} data-reveal="" data-reveal-delay="80">Every autonomous action is permission-bound, logged and reversible, with Einstein-layer guardrails and human oversight on sensitive steps.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "16px", marginBottom: "26px" }}>
              {CERTS.map((c) => (
                <div key={c.t} data-reveal="" style={{ display: "flex", alignItems: "center", gap: "15px", background: "#F7FAFD", border: "1px solid #E6EDF4", borderRadius: "14px", padding: "20px 22px" }}>
                  <div style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "44px", height: "44px", borderRadius: "11px", background: "#fff", border: "1px solid #E3EBF2", color: "#139ED9" }}><ShieldSvg /></div>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "16px", color: "#0A2540", letterSpacing: "-.01em" }}>{c.t}</div>
                    <div style={{ fontSize: "13px", color: "#7A8C9E", marginTop: "2px" }}>{c.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <div data-reveal="" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "16px" }}>
              {[
                { label:"Regulatory support", text:"Documentation and chain-of-custody records structured to support HIPAA, GLBA, SOX and EU data-protection obligations." },
                { label:"Sustainability", text:"High landfill-diversion recycling with environmental and carbon reporting mapped to Scope 3 (Categories 11 & 12) for ESG disclosure." },
                { label:"Agentic guardrails", text:"Security controls, access policies and enterprise data governance enforced at the platform level on every AI action." }
              ].map((item) => (
                <div key={item.label} style={{ background: "#0A2540", borderRadius: "14px", padding: "22px 24px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "10.5px", letterSpacing: ".12em", textTransform: "uppercase", color: "#139ED9", marginBottom: "9px" }}>{item.label}</div>
                  <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#C5D6E5" }}>{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Company */}
        <section id="company" style={{ padding: "clamp(64px,8vw,110px) 0", background: "#F5F9FD", scrollMarginTop: "76px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ maxWidth: "640px", marginBottom: "40px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Company · at a glance</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(30px,3.8vw,48px)", lineHeight: 1.04, letterSpacing: "-.025em", margin: "0 0 16px", color: "#0A2540" }}>A service-operations company, built Salesforce-native.</h2>
              <p style={{ fontSize: "17px", lineHeight: 1.6, color: "#43596E", margin: 0 }}>We help hardware manufacturers turn fractured, manual after-sales processes into a single intelligent engine — grounded in their real customer, asset and warranty data.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: "14px", marginBottom: "20px" }}>
              {FACTS.map((f) => (
                <div key={f.k} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "13px", padding: "18px 20px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "10.5px", letterSpacing: ".1em", textTransform: "uppercase", color: "#8598AB", marginBottom: "7px" }}>{f.k}</div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "17px", color: "#0A2540", lineHeight: 1.2, letterSpacing: "-.01em" }}>{f.v}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "34px" }}>
              <div data-reveal="" style={{ flex: "1 1 340px", minWidth: "280px", background: "#fff", border: "1px solid #E6EDF4", borderLeft: "3px solid #139ED9", borderRadius: "4px 14px 14px 4px", padding: "26px 28px" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#139ED9", marginBottom: "12px" }}>Mission</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500, fontSize: "19px", lineHeight: 1.4, color: "#0A2540", letterSpacing: "-.01em" }}>Make world-class service operations achievable for every manufacturer — replacing manual, siloed, reactive processes with a unified, autonomous, auditable engine.</div>
              </div>
              <div data-reveal="" data-reveal-delay="80" style={{ flex: "1 1 340px", minWidth: "280px", background: "#0A2540", borderRadius: "14px", padding: "26px 28px" }}>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#139ED9", marginBottom: "12px" }}>Vision</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500, fontSize: "19px", lineHeight: 1.4, color: "#fff", letterSpacing: "-.01em" }}>Downtime measured in minutes, not days. The first to know about a defect is the manufacturer, not the customer. Every retired device recovered securely.</div>
              </div>
            </div>

            <div data-reveal="" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", letterSpacing: ".14em", textTransform: "uppercase", color: "#8598AB", marginBottom: "16px" }}>What we believe</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "16px" }}>
              {[
                { t:"Service is a growth engine.", d:"Done well, after-sales drives retention, upsell and brand trust — not cost." },
                { t:"AI should act, not just chat.", d:"Value comes from coordinated action across a real process, grounded in real data." },
                { t:"Trust is non-negotiable.", d:"Every autonomous action is permission-bound, auditable and reversible." },
                { t:"One source of truth wins.", d:"Fragmentation is the root cause of most service failures. So we remove it." }
              ].map((b) => (
                <div key={b.t} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "14px", padding: "22px 24px" }}>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "16.5px", color: "#0A2540", marginBottom: "8px", letterSpacing: "-.01em" }}>{b.t}</div>
                  <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#5A7189" }}>{b.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Leadership */}
        <section style={{ padding: "clamp(64px,8vw,110px) 0", background: "#fff" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ maxWidth: "620px", marginBottom: "40px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>Leadership</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(28px,3.5vw,44px)", lineHeight: 1.05, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>The team behind the engine.</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "16px", marginBottom: "64px" }}>
              {LEADERS.map((l) => (
                <div key={l.r} data-reveal="" style={{ display: "flex", gap: "16px", alignItems: "flex-start", background: "#F7FAFD", border: "1px solid #E6EDF4", borderRadius: "15px", padding: "22px 24px" }}>
                  <div style={{ flex: "none", width: "48px", height: "48px", borderRadius: "12px", background: "linear-gradient(135deg,#139ED9,#0A6A96)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "15px", color: "#fff", letterSpacing: ".02em" }}>{l.i}</div>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "16px", color: "#0A2540", letterSpacing: "-.01em" }}>{l.r}</div>
                    <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: "#5A7189", marginTop: "5px" }}>{l.d}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ maxWidth: "620px", marginBottom: "40px" }} data-reveal="">
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#139ED9", fontWeight: 500, marginBottom: "14px" }}>How we engage</div>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(28px,3.5vw,44px)", lineHeight: 1.05, letterSpacing: "-.025em", margin: 0, color: "#0A2540" }}>From audit to autonomous, in five moves.</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "16px" }}>
              {STEPS.map((s) => (
                <div key={s.n} data-reveal="" style={{ background: "#fff", border: "1px solid #E6EDF4", borderRadius: "15px", padding: "24px 22px", position: "relative" }}>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: "34px", lineHeight: 1, color: "rgba(19,158,217,.32)", marginBottom: "14px" }}>{s.n}</div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "15.5px", color: "#0A2540", marginBottom: "8px", letterSpacing: "-.01em" }}>{s.t}</div>
                  <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: "#5A7189" }}>{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" style={{ position: "relative", padding: "clamp(72px,9vw,120px) 0", background: "#0A2540", color: "#fff", overflow: "hidden", scrollMarginTop: "76px" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(760px 420px at 50% -12%,rgba(19,158,217,.34),transparent 66%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px)", backgroundSize: "56px 56px", WebkitMaskImage: "radial-gradient(700px 460px at 50% 30%,#000,transparent 74%)", maskImage: "radial-gradient(700px 460px at 50% 30%,#000,transparent 74%)", pointerEvents: "none" }} />
          <div style={{ position: "relative", width: "min(860px,100% - 48px)", margin: "0 auto", textAlign: "center" }} data-reveal="">
            <div style={{ display: "inline-flex", alignItems: "center", gap: "9px", padding: "7px 14px", border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.05)", borderRadius: "100px", marginBottom: "26px" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#139ED9", animation: "acp-pulse 2.2s ease-in-out infinite" }} />
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11.5px", fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "#C5D6E5" }}>Get started</span>
            </div>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: "clamp(32px,4.4vw,56px)", lineHeight: 1.03, letterSpacing: "-.03em", margin: "0 0 20px", color: "#fff" }}>Turn service into your<br />growth engine.</h2>
            <p style={{ fontSize: "18px", lineHeight: 1.6, color: "#AEC3D6", margin: "0 auto 34px", maxWidth: "560px" }}>Start with a Discovery &amp; Service Audit. We map your current-state lifecycle across all five pillars, quantify the pain, and find the highest-ROI place to begin — inside your existing Salesforce estate.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "center" }}>
              <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "9px", background: "#139ED9", color: "#fff", fontWeight: 600, fontSize: "16px", padding: "15px 28px", borderRadius: "11px", textDecoration: "none", boxShadow: "0 16px 34px -12px rgba(19,158,217,.8)" }}>
                Book a service audit
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
              <a href="#platform" style={{ display: "inline-flex", alignItems: "center", gap: "9px", background: "rgba(255,255,255,.06)", color: "#fff", fontWeight: 600, fontSize: "16px", padding: "15px 26px", borderRadius: "11px", textDecoration: "none", border: "1px solid rgba(255,255,255,.18)" }}>Explore the platform</a>
            </div>
            <div style={{ marginTop: "52px", paddingTop: "30px", borderTop: "1px solid rgba(255,255,255,.1)", display: "flex", flexWrap: "wrap", gap: "14px 26px", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", letterSpacing: ".02em", color: "#8FA6BC" }}>One connected engine for Support · Field · Repair · Parts · Recovery</span>
              <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#4A6076" }} />
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12.5px", color: "#8FA6BC" }}>Austin, TX · Dublin, IE</span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ background: "#071B2E", color: "#fff", padding: "66px 0 34px" }}>
          <div style={{ width: "min(1180px,100% - 48px)", margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "44px", justifyContent: "space-between", paddingBottom: "44px", borderBottom: "1px solid rgba(255,255,255,.12)" }}>
              <div style={{ flex: "1 1 320px", maxWidth: "380px" }}>
                <div style={{ display: "inline-flex", background: "#fff", padding: "8px 12px", borderRadius: "9px", marginBottom: "18px" }}>
                  <Image src="/ablypro-logo.png" alt="AblyPro" width={100} height={24} style={{ height: "24px", width: "auto", display: "block" }} />
                </div>
                <p style={{ fontSize: "15.5px", lineHeight: 1.6, color: "#9FB6CB", margin: "0 0 18px" }}>One connected engine for Support, Field, Repair, Parts, and Recovery.</p>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "12px", color: "#7C93A9", lineHeight: 1.7 }}>Austin, Texas, USA<br />Dublin, Ireland<br />Serving North America &amp; Europe</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "44px" }}>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#5F7688", marginBottom: "16px" }}>Platform</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                    {["Support","Field","Repair","Parts","Recovery"].map((name) => (
                      <a key={name} href="#platform" style={{ fontSize: "14.5px", color: "#C5D6E5", textDecoration: "none" }}>{name}</a>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#5F7688", marginBottom: "16px" }}>Company</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
                    {[["Approach","#approach"],["Results","#results"],["Case study","#case"],["Security","#security"]].map(([name,href]) => (
                      <a key={name} href={href} style={{ fontSize: "14.5px", color: "#C5D6E5", textDecoration: "none" }}>{name}</a>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", letterSpacing: ".14em", textTransform: "uppercase", color: "#5F7688", marginBottom: "16px" }}>Get started</div>
                  <a href="#contact" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#139ED9", color: "#fff", fontWeight: 600, fontSize: "14px", padding: "11px 18px", borderRadius: "9px", textDecoration: "none" }}>Book a service audit</a>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", justifyContent: "space-between", alignItems: "center", paddingTop: "26px" }}>
              <div style={{ fontSize: "12.5px", color: "#6E8499", maxWidth: "720px", lineHeight: 1.6 }}>This is a fictional company profile created for illustrative and scenario-planning purposes. Names, figures, leadership roles and outcomes are mock. Referenced standards (NIST 800-88, R2v3, NAID AAA) are real and used here for realism.</div>
              <div style={{ fontSize: "12.5px", color: "#6E8499" }}>© 2026 Ablypro · Confidential</div>
            </div>
          </div>
        </footer>

        <LandingChatPanel />
      </div>
    </>
  );
}
