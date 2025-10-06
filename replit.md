# Agent Diaz - Autonomous AI Agent for Content Generation

## Overview
Agent Diaz is an autonomous AI agent designed to generate professional content artifacts in various formats from natural language prompts. It features a three-panel persistent interface (Quick Actions, Chat, Logs/Artifacts), real-time AI chat with personas, and voice capabilities including a hands-free Car Mode. The agent produces downloadable artifacts in PPTX, DOCX, HTML, CSV, and Markdown. This full-stack application, built with Node.js/Express and React, aims to provide a reliable and efficient solution for content generation, replacing previous Firebase-based systems.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Layout**: ResizablePanelGroup (react-resizable-panels) for a three-panel persistent interface.
- **Styling**: Tailwind CSS with shadcn/ui component library.
- **State Management**: React hooks and custom WebSocket hook for real-time communication.
- **Routing**: Wouter for lightweight client-side routing.
- **HTTP Client**: TanStack React Query with a custom fetch wrapper.
- **Real-time**: WebSocket connection for live updates and log streaming.

### Backend Architecture
- **Runtime**: Node.js with Express.js server.
- **Module System**: ESM (ES Modules).
- **Database**: PostgreSQL with Drizzle ORM.
- **Real-time**: WebSocket server for bidirectional communication.
- **File Storage**: Local filesystem, storing artifacts in an `/artifacts` directory.
- **AI Integration**: OpenAI API for chat completions and content generation.
- **Packaging**: Archiver for multi-file artifact bundling.

### Build System
- **Frontend Build**: Vite with React plugin.
- **Backend Build**: esbuild for production bundling.
- **Development**: Concurrent development using Vite dev server and tsx for the backend.

### Key Features and Design Decisions
- **Three-Panel Layout**: Quick Actions, Chat, and Logs/Artifacts panels with localStorage persistence for panel sizes.
- **Dual-Delivery Artifacts**: Artifacts appear inline in chat messages and in a dedicated Artifacts panel, with real-time updates via WebSocket.
- **Smart Auto-Scroll**: Chat auto-scroll with near-bottom detection and a "Jump to latest" button.
- **Car Mode FSM**: Explicit state machine for hands-free voice interaction (IDLE → LISTENING → TRANSCRIBING → SENDING → THINKING → SPEAKING → IDLE) with watchdog timer and error recovery.
- **Multi-step Content Generation Pipeline**: Includes Research, Outline, Visual Matching, Building, and Delivery stages.
- **Robust DOCX Generation**: Comprehensive 6-stage validation pipeline for DOCX reports, including citation mapping, table generation, robust chart embedding, and source vetting with multi-stage fallbacks.
- **Data Analysis Enforcement**: Enhanced prompt engineering to ensure deep analysis, inference, metric computation, and synthesis of sources, explicitly forbidding meta-language or placeholders.
- **Static Website Routing**: Dedicated Express router for serving static files from `data/sites/:id` with security and caching considerations.
- **Multi-Page Website Generation**: Supports generating multi-page websites with live preview and deployment options.

## External Dependencies

### AI Services
- **OpenAI API**: Primary AI model for chat and content generation (GPT-4o).

### Search Services
- **SerpAPI**: Primary web search API.
- **DuckDuckGo**: Fallback search service.

### Visual Services
- **Unsplash API**: Primary image source.
- **Pixabay API**: Secondary image source.
- **Picsum**: Final fallback for placeholder images.
- **QuickChart.io**: Chart generation service.

### Database
- **Neon Database**: Serverless PostgreSQL hosting, utilizing `@neondatabase/serverless` driver and Drizzle Kit for schema management.

## Recent Updates (October 6, 2025)

### CALENDAR AGENT INTEGRATION (Latest - Command-Based Interface)
**Feature**: Hands-free natural language calendar scheduling via Google Apps Script proxy
**Implementation**: Server-side only integration with chrono-node NLP parsing, no client-side Google API calls

**Architecture**:
- **Module Structure**: `server/modules/calendarProxy/` (isolated, additive)
  - `db.ts` - SQLite storage for user connectors (user_id → GAS credentials) and contact aliases
  - `schemas.ts` - Zod validation schemas for all inputs (CommandSchema, AliasUpsertSchema)
  - `gasClient.ts` - Google Apps Script proxy communication
  - `nlp.ts` - Natural language parsing with chrono-node (extracts intent, datetime, duration, attendee)
  - `calendarService.ts` - Shared scheduling logic consumed by /schedule and /command endpoints
  - `router.ts` - Express router with register/free/schedule/command/alias endpoints
- **Database**: SQLite at `data/calendar_proxy.db`
  - Tables: `user_connectors`, `aliases` (alias → email/ICS URL mapping)
- **Routes**:
  - `POST /calendar-proxy/register` - Register user's GAS web app URL + shared token
  - `POST /calendar-proxy/command` - Natural language command processing (schedule or find_free intent)
  - `POST /calendar-proxy/free` - Get available time slots
  - `POST /calendar-proxy/schedule` - Create calendar event
  - `POST /calendar-proxy/alias/upsert` - Save contact alias
  - `GET /calendar-proxy/alias/list` - List all saved aliases
  - `GET /api/calendar/config` - Fetch GAS credentials from env vars

**Natural Language Processing**:
- **chrono-node**: Battle-tested datetime parsing ("today 12:30", "tomorrow 3pm", "next Tue 10-11")
- **Intent Detection**: Regex-based classification (find_free vs schedule)
- **Entity Extraction**: Duration (30 min, 1 hr), attendee alias ("with colleague calendar"), title
- **Alias Resolution**: Maps spoken names to attendee emails or ICS URLs for multi-calendar free/busy

**UI Integration**:
- **Left Sidebar**: "Calendar Agent (Beta)" button below "Analyze" in Quick Actions
  - Blue theme with Calendar icon and Beta badge
  - Opens dialog panel on click
- **CalendarPanel Component**: (`client/src/components/CalendarPanel.tsx`)
  - **Command Input**: Single text field for natural language commands with voice button
  - **Voice Integration**: Uses existing useVoice hook for hands-free commands
  - **Alias Management**: Add/list contact aliases for use in commands
  - **Results Display**: Event creation confirmation with Google Calendar link, free slot suggestions with auto-book
  - **Example Commands**: "schedule team meeting tomorrow at 3pm 60 min", "find free 30 min slot with colleague calendar"

**Example Usage**:
1. **Direct Scheduling**: "book a 30 min with Carlos at 12:30 today" → Immediately schedules event
2. **Find Free Slots**: "find free 45 min tomorrow with colleague calendar" → Returns suggestions with auto-book button
3. **Teach Aliases**: Add "colleague calendar" → carlos@company.com, then use "with colleague calendar" in commands

**Environment Variables**:
- `GAS_WEB_APP_URL` - Google Apps Script deployed web app URL
- `GAS_SHARED_TOKEN` - Shared secret for GAS authentication

**Security**:
- All Google Calendar operations happen server-side via GAS proxy
- No browser-based Google API calls (no CORS issues)
- Credentials stored in Replit Secrets
- Per-user connector registration with isolated data
- Alias system prevents exposing raw emails in voice commands

## Recent Updates (October 3, 2025)

### ORCHESTRATOR-DRIVEN PROMPTS: No Hardcoding (Latest)
**Problem**: Prompts were hardcoded with example data, causing the system to embed sample text in templates
**Solution**: Implemented adaptive, schema-driven prompt orchestrator that builds prompts dynamically from runtime data

**RequestNormalizer Adapter**:
- Converts any input (JSON or text) → validated orchestrator schema
- Routes to DATA_ANALYSIS_DOCX or RESEARCH_REPORT_DOCX automatically
- Tags data origin: `user-provided-json`, `synthetic-from-prompt`, or `topic-from-prompt`
- Logs normalization decisions for transparency

**Orchestrator Prompt Builders**:
- `buildSystemMessage()`: Role, constraints, QA gates (no user data)
- `buildUserMessage()`: Task instruction + structured JSON (exact data, no paraphrasing)
- `buildDeveloperMessage()`: Output contract for DOCX builder (sections, figures, tables)
- **Zero hardcoded example data** - all content pulled from runtime payload

**DATA_ANALYSIS_DOCX Pipeline (Orchestrator-driven)**:
1. **O1**: Normalize input → structured students[] + class_averages
2. **O2**: Build orchestrator prompts → call generateDOCXSections
3. **O3**: LLM returns sections with exec_summary, methods, results, figures, tables
4. **O4**: Generate chart PNGs from LLM figure specs (QuickChart.io)
5. **O5**: Build DOCX from LLM sections (not templates)
6. **O6**: Save CSV with `dataOrigin` metadata, emit artifacts

**Metadata Tracking**:
- CSV files tagged with `dataOrigin` (synthetic vs real)
- Artifacts include `dataOrigin`, student count, section count
- Logs show normalization, data source, prompt sizes

### PIPELINE SEPARATION: DATA_ANALYSIS vs RESEARCH_REPORT
**Problem**: Different job types (data analysis vs research reports) were using the same template path
**Solution**: Intent router detects pipeline type and routes to appropriate specialized pipeline

**Intent Router**:
- **DATA_ANALYSIS**: Triggered by metrics, counts, thresholds, numeric patterns ("20 students, 5 below 60")
- **RESEARCH_REPORT**: Triggered by topic-based queries ("life cycle of", "history of", "what is")
- Routes to completely separate execution paths with different validation requirements

**DATA_ANALYSIS Pipeline**:
1. Parse analysis parameters (n_students, skills with thresholds)
2. Generate synthetic dataset with constrained randomization
3. Compute metrics (mean, median, p25/p75, stdev, rates)
4. Generate charts (bar charts for counts and rates)
5. Build structured DOCX with Executive Summary, Methods, Results sections
6. Deliver: DOCX report + CSV dataset + chart PNGs

**RESEARCH_REPORT Pipeline**:
- Unchanged - uses existing research flow with 10+ source requirement
- Web research → Source vetting → Outline → Visual matching → DOCX/PPTX build

### CRITICAL OVERHAUL: R0-R5 Iterative Source Harvest System
**Problem**: System searched generic queries then rejected 90% of results
**Solution**: TARGET QUALITY SOURCES FROM THE START + R0-R5 iterative harvest to reach 10 sources

**Initial Query Strategy (FIXED)**:
- **ALL topics**: ALWAYS target site:edu, site:gov, site:ac.uk first (not just scientific)
- **Academic topics**: Add site:doi.org, site:ncbi.nlm.nih.gov for scholarly databases
- **Generic topics**: Add research/study/analysis keywords
- **Removed**: Hardcoded ant/insect checks - now works for ANY topic

**R1-R5 Harvest Rounds (Keep searching until ≥10 sources)**:
- **R0 Seeds**: REMOVED (was hardcoded for ants only)
- **R1 Topical**: Generic fallback (site:edu, site:gov, scientific review, PDF)
- **R2 Scholar**: site:ncbi.nlm.nih.gov/pmc, site:doi.org, biodiversitylibrary.org, museums
- **R3 Extension**: site:edu research/study, site:gov publications/reports
- **R4 Synonyms**: Generic replacements (life cycle→development, history of→evolution of)
- **R5 Broader**: research findings, scientific literature, scholarly analysis
- **STOP**: When vetted_count ≥10, proceed to outline. Otherwise continue up to MAX_ROUNDS (10).

**Iterative Loop (MAX_ROUNDS = 10)**:
- System cycles through R1→R2→R3→R4→R5 repeatedly until ≥10 sources OR 10 rounds exhausted
- Each round logs progress: `[Round N] strategy → added X, total Y`
- NO HARD FAIL: Proceeds with whatever sources gathered after max rounds

**Vetting Policy (Sane + Quality)**:
- **Three-Tier Logic**: 1) Blocklist reject → 2) Allowlist auto-pass → 3) Scoring (≥0.4 threshold)
- **Allowlist Patterns**: .edu, .gov, .ac., museums, DOI, PMC, antwiki/antweb, Britannica, Wikipedia, National Geographic, Scientific American, Nature, Smithsonian
- **Enhanced Scoring**: National Geographic (+0.4), Britannica (+0.4), Wikipedia (+0.3), Nature (+0.5), Smithsonian (+0.4)
- **Detailed Logging**: Shows decision for each source `[ALLOWLIST→PASS]`, `[SCORE 0.65→PASS]`, `[SCORE 0.42→FAIL]`

### DOCX Report Pipeline
- **6-Stage Validation Pipeline**: Parse → Enrich → Fetch Charts → Validate → Assemble → Pack
- **Citation Mapping**: [Source1] tags → superscript [1] references linked to bibliography
- **Table Generation**: Extracts numeric bullets → formatted tables
- **Robust Chart Embedding**: Validates HTTP 200, buffer size >100 bytes
- **Fail-Closed Validation**: Checks forbidden terms, truncation, empty sections (NOT source count)
- **Limited Sources Banner**: Yellow-highlighted notice when vetted sources < 3 (NO HARD FAIL)