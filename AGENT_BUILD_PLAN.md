# Agentforce Custom AI Stack — Full Build Plan
> 6 Production-Grade AI Agents | Zero Paid Licenses | Salesforce + Custom LLM Stack

---

## Overview

We are building 6 AI agents that mirror the AblyPro use cases, using:
- **Salesforce Agentforce** as the agent runtime (already licensed)
- **Custom FastAPI backend** replacing Data Cloud / Einstein licenses
- **Ollama / Gemini / Groq** as free LLM providers
- **ChromaDB + sentence-transformers** as free RAG stack
- **React chat widget** replacing Experience Cloud
- **Custom Salesforce objects** replacing Certinia PSA

All code lives in this repository, tracked in git, deployed to Salesforce via SF CLI.

---

## Repository Structure (End State)

```
agente-setup/
├── force-app/
│   └── main/default/
│       ├── genAiPlannerBundles/        ← Agentforce agent definitions
│       │   ├── Support_Operations_Agent/
│       │   ├── Customer_Self_Service_Agent/
│       │   ├── Knowledge_Intelligence_Agent/
│       │   ├── Revenue_Intelligence_Agent/
│       │   ├── Field_Service_Agent/
│       │   └── Services_Org_Agent/
│       ├── objects/                    ← Custom Salesforce objects
│       │   ├── Project__c/
│       │   ├── Timecard__c/
│       │   ├── Resource__c/
│       │   ├── Milestone__c/
│       │   └── AccountHealthScore__c/
│       ├── classes/                    ← Apex callout classes
│       │   ├── RAGSearchCallout.cls
│       │   ├── ChurnPredictCallout.cls
│       │   ├── ProjectAnalysisCallout.cls
│       │   └── CaseClassifierCallout.cls
│       ├── flows/                      ← Salesforce Flows
│       │   ├── Auto_Resolve_Case.flow
│       │   ├── Reset_Password_Flow.flow
│       │   └── Create_Service_Appointment.flow
│       └── namedCredentials/           ← Auth to backend API
│           └── AI_Backend.namedCredential
│
├── backend/                            ← FastAPI Python backend
│   ├── main.py
│   ├── requirements.txt
│   ├── routers/
│   │   ├── rag.py                      ← /rag-search endpoint
│   │   ├── churn.py                    ← /predict-churn endpoint
│   │   ├── project.py                  ← /analyze-project endpoint
│   │   ├── case_classifier.py          ← /classify-case endpoint
│   │   └── field_service.py            ← /match-technician endpoint
│   ├── rag/
│   │   ├── embedder.py                 ← sentence-transformers embeddings
│   │   ├── vector_store.py             ← ChromaDB operations
│   │   └── ingest.py                   ← Load docs into vector store
│   ├── models/
│   │   └── churn_model.py              ← scikit-learn churn predictor
│   └── data/
│       ├── knowledge_articles/         ← Sample KB docs for RAG
│       └── sample_training_data.csv    ← Churn model training data
│
├── chat-widget/                        ← React self-service chat UI
│   ├── src/
│   │   ├── App.jsx
│   │   ├── ChatWidget.jsx
│   │   ├── SalesforceAuth.js           ← OAuth 2.0 flow
│   │   └── api.js                      ← REST calls to SF + backend
│   └── package.json
│
├── scripts/
│   └── apex/
│       └── load_sample_data.apex       ← Creates all sample records
│
└── AGENT_BUILD_PLAN.md                 ← This file
```

---

## Tech Stack

| Layer | Technology | License Cost |
|---|---|---|
| Agent Runtime | Salesforce Agentforce | ✅ Already owned |
| Salesforce Objects | Standard + Custom Objects | ✅ Free |
| Apex Callouts | Apex REST callouts | ✅ Free |
| Backend Framework | Python FastAPI | ✅ Free / Open Source |
| RAG Embeddings | sentence-transformers (HuggingFace) | ✅ Free / Local |
| Vector Database | ChromaDB | ✅ Free / Open Source |
| LLM (Local) | Ollama + Llama 3.1 8B | ✅ Free / Runs Locally |
| LLM (Cloud Free) | Google Gemini API (1M tokens/day) | ✅ Free Tier |
| LLM (Fast Prototyping) | Groq API | ✅ Free Tier |
| ML Scoring | scikit-learn + XGBoost | ✅ Free / Open Source |
| Chat UI | React + Vite | ✅ Free / Open Source |
| Hosting (Backend) | Render / Railway free tier | ✅ Free Tier |
| Hosting (Frontend) | Vercel / Netlify | ✅ Free Tier |

**Total cost: $0**

---

## The 6 Agents — Detailed Plan

---

### Agent 1 — AI Field Service Intelligence
**Goal:** Match right technician → right job → right parts. Eliminate failed truck rolls.

#### Salesforce Side
- Enable Field Service Lightning feature in scratch org
- Objects used: `WorkOrder`, `ServiceAppointment`, `ServiceResource`, `ServiceTerritory`
- Agentforce Topics:
  - `Technician Matching` — find best technician for a job
  - `Schedule Optimization` — build daily schedule
  - `Parts Pre-Check` — validate parts before dispatch
  - `Real-Time Rerouting` — handle mid-day changes

#### Backend Side (`/match-technician`)
```
Input:  work_order_id, required_skills, location, job_type
Logic:  Score each available technician by:
          - skill match (40%)
          - proximity score (30%)
          - current workload (20%)
          - first-time fix history (10%)
Output: ranked list of technicians + confidence score
```

#### Sample Data
- 10 WorkOrders (washing machine, HVAC, electrical repairs)
- 5 ServiceResources (technicians with different skill sets)
- Parts inventory records linked to work orders

#### Apex Callout
- `FieldServiceMatchCallout.cls` — calls `/match-technician`
- Named credential: `AI_Backend`

---

### Agent 2 — AI Knowledge Intelligence
**Goal:** Answer any support/field question from knowledge base in seconds using RAG.

#### Salesforce Side
- Enable Salesforce Knowledge in org settings
- Create 10–15 sample Knowledge Articles (troubleshooting guides)
- Agentforce Topics:
  - `Knowledge Search` — natural language search across articles
  - `Knowledge Gap Detection` — flag unanswered questions

#### Backend Side (`/rag-search`)
```
Input:  query, context (case_type, equipment_type, user_role)
Step 1: Embed query using sentence-transformers
Step 2: Similarity search in ChromaDB
Step 3: Top 3 chunks passed as context to LLM
Step 4: LLM generates answer with source citations
Output: answer, source_article, confidence_score
```

#### RAG Ingest Pipeline
```
Knowledge Articles (PDF/text)
    → chunk into 512-token segments
    → embed each chunk
    → store in ChromaDB with metadata (article_id, equipment_type)
```

#### LLM Options (switchable via env var)
```
LLM_PROVIDER=ollama   → uses local Llama 3.1 (private, free)
LLM_PROVIDER=gemini   → uses Gemini 1.5 Flash (free tier)
LLM_PROVIDER=groq     → uses Llama 3 on Groq (fastest, free tier)
```

#### Sample Knowledge Articles (we create these)
- Washing machine troubleshooting guide
- Password reset procedures
- Billing dispute handling
- HVAC maintenance checklist
- Service appointment policies

---

### Agent 3 — AI Support Operations
**Goal:** Auto-classify, auto-resolve, and intelligently route incoming cases.

#### Salesforce Side
- Objects: `Case`, `Account`, `Contact`, `Knowledge__kav`
- Agentforce Topics:
  - `Case Triage` — classify type, urgency, complexity
  - `Auto Resolution` — handle known-solution cases
  - `Smart Routing` — route complex cases with context
  - `SLA Monitoring` — escalate approaching-breach cases
- Flows:
  - `Auto_Resolve_Case.flow` — resolves password resets, status checks
  - `Route_To_Queue.flow` — assigns to correct queue with context

#### Backend Side (`/classify-case`)
```
Input:  case_subject, case_description, customer_history
Logic:  Fine-tuned text classifier using scikit-learn
        Categories: [password_reset, billing, outage, technical, general]
        Urgency:    [low, medium, high, critical]
Output: case_type, urgency_level, auto_resolvable (bool), suggested_queue
```

#### Sample Cases (we generate 20+)
- "I forgot my password and can't log in"           → auto-resolve
- "My washing machine won't spin"                   → route to technical
- "Why was I charged twice this month?"             → route to billing
- "My power has been out for 3 hours"               → critical, escalate
- "How do I update my address?"                     → auto-resolve

---

### Agent 4 — AI Customer Self-Service
**Goal:** 24/7 autonomous customer support chat — no wait time, no business hours.

#### Salesforce Side
- Agentforce Topics:
  - `Account Inquiry` — billing, status, account details
  - `Service Request` — create work orders, schedule appointments
  - `Outage Reporting` — log and check outage status
  - `Issue Escalation` — hand off to human with full context
- Authentication: Email verification flow (already built in `Agentforce_Service_Agent`)

#### React Chat Widget (replaces Experience Cloud)
```
Features:
  - Embeds on any website via <script> tag
  - Connects to Salesforce via OAuth 2.0 Connected App
  - Reads live Account/Case data from Salesforce REST API
  - Falls back to your RAG backend for knowledge questions
  - Escalation creates a Case in Salesforce automatically
  - Mobile responsive
  - Supports English + Spanish (via LLM translation)

Tech:
  - React 18 + Vite
  - Tailwind CSS for styling
  - Salesforce REST API (no Experience Cloud)
  - Hosted on Vercel (free)
```

#### Sample Data
- 5 Accounts with billing history
- Open and closed cases per account
- Service appointment records

---

### Agent 5 — AI Revenue Intelligence
**Goal:** Composite account health scoring — predict churn 90 days before it happens.

#### Salesforce Side
- Custom fields on `Account`:
  - `Health_Score__c` (Number 0–100)
  - `Churn_Risk_Level__c` (Picklist: Low/Medium/High/Critical)
  - `Last_Login_Days__c` (Number)
  - `Open_Tickets_30_Days__c` (Rollup)
  - `Payment_Delay_Avg_Days__c` (Number)
  - `NPS_Score__c` (Number)
- Agentforce Topics:
  - `Account Health Review` — explain why an account is at risk
  - `Churn Alert` — notify account manager with playbook
  - `Renewal Preparation` — generate QBR agenda for at-risk accounts

#### Backend Side (`/predict-churn`)
```
Model:  XGBoost classifier trained on sample data
Input:  days_since_login, open_tickets, payment_delay,
        nps_score, usage_decline_pct, contract_days_remaining
Output: churn_probability (0.0–1.0), risk_level, top_3_risk_factors,
        recommended_actions[]

Fallback (no ML):
  Formula field in Salesforce:
  Health_Score = (payment_score * 30) + (usage_score * 25) +
                 (support_score * 25) + (engagement_score * 20)
```

#### Sample Data
- 10 Accounts with varying health signals
- 3 accounts in critical churn risk (for demo)
- Opportunity records with renewal dates

---

### Agent 6 — AI Services Org Intelligence
**Goal:** Monitor project margins in real time — detect scope creep, resource waste, revenue risk.

#### Salesforce Side — Custom Objects (replacing Certinia PSA)

```
Project__c
  ├── Name
  ├── Client__c (lookup: Account)
  ├── Budget__c (Currency)
  ├── Actual_Cost__c (Currency, rollup from Timecards)
  ├── Margin__c (Formula: (Budget - Actual) / Budget * 100)
  ├── Margin_Risk_Score__c (Number)
  ├── Status__c (Picklist: Active/At Risk/On Track/Complete)
  └── Start_Date__c / End_Date__c

Timecard__c
  ├── Project__c (lookup)
  ├── Resource__c (lookup)
  ├── Hours_Worked__c
  ├── Billable__c (Checkbox)
  ├── Hourly_Rate__c
  └── Week_Ending__c

Resource__c
  ├── Name
  ├── Role__c
  ├── Skill_Set__c (Multi-select picklist)
  ├── Utilization_Rate__c (Formula: Billed Hours / Available Hours)
  └── Available_Hours_Per_Week__c

Milestone__c
  ├── Project__c (lookup)
  ├── Name
  ├── Due_Date__c
  ├── Completed_Date__c
  ├── Revenue_Amount__c
  └── Is_At_Risk__c (Checkbox)
```

#### Agentforce Topics
- `Project Margin Monitor` — surface margin deviation in real time
- `Scope Creep Detection` — flag unbilled out-of-scope work
- `Resource Utilization` — identify over/under-utilized resources
- `Milestone Revenue Alignment` — flag revenue recognition risks

#### Backend Side (`/analyze-project`)
```
Input:  project_id, timecards[], milestones[], budget, actual_cost
Logic:  Send structured project data as context to LLM
Prompt: "Analyze these project financials. Identify:
         1. Margin risk (flag if < 15%)
         2. Scope creep patterns in timecards
         3. Resource utilization outliers
         4. Milestone delay risks
         Return structured JSON with severity and recommended actions."
Output: margin_risk_score, scope_creep_flags[], staffing_alerts[],
        milestone_risks[], executive_summary (text)
```

#### Sample Data
- 5 Projects with different margin profiles
- 15 Timecards (some with unbillable overruns)
- 3 Resources with varying utilization
- 8 Milestones (some past due)

---

## Build Phases

### Phase 1 — Foundation (Week 1)
**Goal:** Everything needed before any agent can work

- [ ] Set up FastAPI project skeleton (`backend/`)
- [ ] Install Ollama locally + pull Llama 3.1 model
- [ ] Set up ChromaDB for vector storage
- [ ] Create Named Credential in Salesforce (`AI_Backend`)
- [ ] Create base Apex callout class
- [ ] Create all 4 custom object schemas (Project, Timecard, Resource, Milestone)
- [ ] Create Account custom fields for health scoring
- [ ] Enable Salesforce Knowledge in org
- [ ] Write `load_sample_data.apex` for all objects
- [ ] Initialize React chat widget project skeleton

**Deliverable:** Backend running locally, custom objects deployed, sample data loaded

---

### Phase 2 — Agent 3: Support Operations (Week 2)
**Goal:** Auto-triage and resolve cases — easiest agent, highest visible impact

- [ ] Build `/classify-case` endpoint (rule-based first, then ML)
- [ ] Build `Auto_Resolve_Case` Flow
- [ ] Build `Route_To_Queue` Flow
- [ ] Build `CaseClassifierCallout.cls`
- [ ] Create `Support_Operations_Agent` GenAiPlannerBundle
- [ ] Configure 4 topics + actions
- [ ] Load 20 sample cases
- [ ] Test end-to-end in org

**Deliverable:** Agent 3 fully working in Salesforce

---

### Phase 3 — Agent 4: Customer Self-Service (Week 3)
**Goal:** React chat widget talking to Salesforce — the showpiece demo

- [ ] Build React `ChatWidget.jsx` component
- [ ] Implement Salesforce OAuth 2.0 Connected App
- [ ] Connect widget to Salesforce REST API (read Account/Case)
- [ ] Connect widget to RAG backend for knowledge questions
- [ ] Build `Customer_Self_Service_Agent` topics
- [ ] Test: account lookup, case creation, escalation
- [ ] Deploy widget to Vercel

**Deliverable:** Live chat widget at a public URL connected to your Salesforce org

---

### Phase 4 — Agent 2: Knowledge Intelligence (Week 4)
**Goal:** RAG search across Knowledge Articles

- [ ] Write RAG ingest pipeline (`ingest.py`)
- [ ] Create 10–15 sample Knowledge Articles in Salesforce
- [ ] Export articles → embed → store in ChromaDB
- [ ] Build `/rag-search` endpoint
- [ ] Build `RAGSearchCallout.cls`
- [ ] Create `Knowledge_Intelligence_Agent` topics
- [ ] Test: context-aware search, source citations, gap detection

**Deliverable:** Agent 2 answering questions from knowledge base

---

### Phase 5 — Agent 5: Revenue Intelligence (Week 5)
**Goal:** Churn prediction with health scoring

- [ ] Create `sample_training_data.csv` (200 synthetic accounts)
- [ ] Train XGBoost churn model (`churn_model.py`)
- [ ] Build `/predict-churn` endpoint
- [ ] Build `ChurnPredictCallout.cls`
- [ ] Create Account custom fields + formula health score
- [ ] Build scheduled Flow to update health scores daily
- [ ] Create `Revenue_Intelligence_Agent` topics
- [ ] Test: health score updates, risk alerts, QBR generation

**Deliverable:** Agent 5 showing live churn risk per account

---

### Phase 6 — Agent 1: Field Service Intelligence (Week 6)
**Goal:** Smart technician dispatch

- [ ] Enable Field Service Lightning in scratch org config
- [ ] Create WorkOrder + ServiceResource sample data
- [ ] Build `/match-technician` scoring algorithm
- [ ] Build `FieldServiceMatchCallout.cls`
- [ ] Create `Field_Service_Agent` topics + actions
- [ ] Test: job matching, pre-check, rerouting

**Deliverable:** Agent 1 recommending technician assignments

---

### Phase 7 — Agent 6: Services Org Intelligence (Week 7)
**Goal:** Real-time project margin monitoring

- [ ] Deploy all 4 custom objects to org
- [ ] Load sample project/timecard/resource/milestone data
- [ ] Build `/analyze-project` endpoint (LLM-powered)
- [ ] Build `ProjectAnalysisCallout.cls`
- [ ] Create `Services_Org_Agent` topics + actions
- [ ] Test: margin alerts, scope creep detection, resource utilization

**Deliverable:** Agent 6 monitoring 5 sample projects in real time

---

### Phase 8 — Polish & Git Hygiene (Week 8)
- [ ] All 6 agents committed + tagged in git
- [ ] Backend deployed to Render (free tier)
- [ ] React widget live on Vercel
- [ ] `load_sample_data.apex` deploys full demo environment in 1 run
- [ ] Environment variables documented in `.env.example`
- [ ] GitHub repo polished with screenshots

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        SALESFORCE ORG                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              AGENTFORCE AGENTS (6)                       │    │
│  │  Support Ops │ Self-Service │ Knowledge │ Revenue │ ...  │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                          │ Apex Callouts (Named Credentials)     │
│  ┌───────────────────────┼──────────────────────────────────┐    │
│  │           SALESFORCE DATA LAYER                           │    │
│  │  Cases │ Accounts │ WorkOrders │ Project__c │ Knowledge   │    │
│  └───────────────────────┼──────────────────────────────────┘    │
└──────────────────────────┼───────────────────────────────────────┘
                           │ HTTPS REST
┌──────────────────────────▼───────────────────────────────────────┐
│                    FASTAPI BACKEND                                │
│                                                                  │
│  /rag-search       ChromaDB + sentence-transformers              │
│  /predict-churn    XGBoost ML model                              │
│  /analyze-project  Llama 3.1 / Gemini LLM                        │
│  /classify-case    Text classifier                               │
│  /match-technician Scoring algorithm                             │
│                                                                  │
│  LLM Router: Ollama (local) → Gemini (cloud) → Groq (fast)      │
└──────────────────────────────────────────────────────────────────┘
                           ▲
                           │ REST API
┌──────────────────────────┴───────────────────────────────────────┐
│                   REACT CHAT WIDGET                              │
│         Hosted on Vercel │ Embeds on any website                 │
│         OAuth 2.0 → Salesforce REST API                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Environment Setup

### Prerequisites to Install Locally
```bash
# Python 3.11+
python --version

# Node.js 20+
node --version

# Ollama (for local LLM)
# Download from https://ollama.com
ollama pull llama3.1

# Salesforce CLI (already installed)
sf --version
```

### Environment Variables (`.env`)
```env
# LLM Provider (ollama | gemini | groq)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434

# Cloud LLM fallbacks (free tiers)
GEMINI_API_KEY=your_key_here
GROQ_API_KEY=your_key_here

# Salesforce (for backend → SF direct calls if needed)
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=your_connected_app_client_id
SF_CLIENT_SECRET=your_connected_app_secret

# ChromaDB
CHROMA_PERSIST_DIR=./data/chroma_db
```

---

## Git Branching Strategy

```
main              ← stable, always deployable
├── phase/1-foundation
├── phase/2-support-ops
├── phase/3-self-service
├── phase/4-knowledge
├── phase/5-revenue
├── phase/6-field-service
└── phase/7-services-org
```

Each phase merges to `main` when the agent is fully tested.

---

## Decision Log

| Decision | Choice | Reason |
|---|---|---|
| LLM runtime | Ollama (local) primary | Zero cost, data privacy |
| Vector DB | ChromaDB | Simple, local, open source |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` | Fast, accurate, local |
| ML framework | scikit-learn + XGBoost | Lightweight, no GPU needed |
| Frontend | React + Vite | Industry standard, free |
| Backend | FastAPI (Python) | Fast, async, great for ML |
| Certinia replacement | Custom Salesforce objects | Same agent behavior, zero cost |
| Experience Cloud replacement | React widget + Salesforce REST API | Full control, embeddable anywhere |

---

*Last updated: May 2026 | Repo: github.com/hytechpro-keshav/AgentForce*
