# Agent Diaz - Autonomous AI Agent for Content Generation

## Overview

Agent Diaz is a sophisticated autonomous AI agent that generates professional content artifacts in multiple formats from natural language prompts. The application features a **three-panel persistent interface** (Quick Actions, Chat, Logs/Artifacts), real-time AI chat with personas, voice capabilities including **hands-free Car Mode with explicit FSM**, and produces downloadable artifacts in PPTX, DOCX, HTML, CSV, and Markdown formats. This is a full-stack application built with Node.js/Express backend and React frontend, designed to replace a Firebase Studio AI agent with improved reliability and delivery capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Updates (October 2025)

### Critical Fixes (October 3, 2025)

#### DOCX Report Pipeline - COMPLETE REWRITE ✅ NEW
- **6-Stage Validation Pipeline**: Parse → Enrich → Fetch Charts → Validate → Assemble → Pack
  - Stage 1: Parse & Sanitize (remove meta language, fix tense)
  - Stage 2: Enrich with Citations & Tables (convert [Source1] to superscript refs, extract numeric data)
  - Stage 3: Fetch Charts (robust PNG download with validation, error logging)
  - Stage 4: Validate (forbidden terms, truncation, minimum citations, chart/table requirements)
  - Stage 5: Assemble DOCX (proper structure with citations, tables, charts)
  - Stage 6: Pack & Export (error-wrapped Packer.toBuffer)
- **Citation Mapping**: [Source1] tags → superscript [1] references linked to bibliography
- **Table Generation**: Extracts numeric bullets (e.g., "Stage duration: 3 weeks") → formatted tables
- **Robust Chart Embedding**: Validates HTTP 200, buffer size >100 bytes, fails gracefully
- **Fail-Fast Validation**: Checks forbidden terms, truncation (ellipses), min 3 citations, min 3 sources, chart/table for data analysis
- **Source Vetting (Stage 1 in Agent)**: Whitelist .edu/.gov/peer-reviewed, blacklist junk, min 3 vetted sources for reports

#### Static Website Routing - PRODUCTION READY
- ✅ **Dedicated Express Router**: Synchronous router setup before async operations prevents Vite interception
- ✅ **Route Pattern**: `/sites/:id` and `/sites/:id/*` serve static files from `data/sites/<id>/`
- ✅ **express.static middleware**: Extensions: ['html'], index: 'index.html', no-store caching
- ✅ **Security**: ID validation regex, path traversal prevention
- ✅ **Logging**: All static file requests logged for debugging
- ✅ **Tested**: `curl http://localhost:5000/sites/test123/` returns actual HTML (not React app)

#### DOCX Report Generation - COMPREHENSIVE OVERHAUL
- ✅ **New buildDOCXReport() function**: Dedicated structured report builder (builder.ts lines 2308-2569)
- ✅ **Source Filtering**: Blacklist weak domains (scribd, geeksforgeeks, calculator sites, Microsoft Create templates)
- ✅ **Anti-Leakage**: Strips meta language ("this slide", "presentation") and rewrites future tense ("will be" → "is")
- ✅ **Proper Structure**: Cover → Executive Summary → Introduction → Methods → Results → Discussion → References
- ✅ **Chart Embedding**: Downloads PNGs from QuickChart, validates size, adds figure captions, fallback text on failure
- ✅ **Detection Logic**: Checks title AND content for report keywords (method, result, analysis, data, findings, etc.)
- ✅ **Acceptance Guards**: Validates minimum content length (500 chars), logs chart/reference counts, adds quality notes for data analysis
- ✅ **Removed**: Notes field no longer appears in DOCX output (was leaking internal scaffolding)

#### Data Analysis Pipeline - DEEP ANALYSIS ENFORCEMENT  
- ✅ **Enhanced generateRichOutline Prompt** (openai.ts lines 139-169):
  - **CRITICAL RULES**: Analyze & infer, compute metrics, synthesize sources, reason (not copy-paste)
  - **FORBIDDEN**: Meta language, placeholders ("TBD"), future tense for content, empty analysis
  - **DATA & CHARTS**: Compute percentages/rates/comparisons from research, no fabrication but DO calculate
  - **QUALITY CHECKS**: 700+ char bodies, unique specific titles, concrete bullets, relevant keywords
- ✅ **Explicit Instructions**: "Extract insights, patterns, implications" instead of passive "use research context"
- ✅ **Validation**: Body must contain actual reasoning, not generic statements

### Major UI Overhaul - Three-Panel Layout
- ✅ **Replaced tab system** with three-panel ResizablePanelGroup layout
- ✅ **Left Panel (15%)**: Quick Actions for common content types
- ✅ **Center Panel (50%)**: Chat interface with messages and inline artifacts
- ✅ **Right Panel (35%)**: Vertical split for Live Logs (top) + Artifacts browser (bottom)
- ✅ **localStorage persistence** for panel sizes across sessions
- ✅ **Mobile responsive** with proper touch handling for Android devices

### Dual-Delivery Artifacts
- ✅ **Artifacts appear in TWO places**: as inline attachments in chat messages AND in the dedicated Artifacts panel
- ✅ **ArtifactRef interface** for consistent artifact representation
- ✅ **Download buttons** available in both locations
- ✅ **Real-time updates** via WebSocket for both delivery channels

### Smart Auto-Scroll
- ✅ **Near-bottom detection** (150px threshold) for chat auto-scroll
- ✅ **Jump to latest button** appears when user scrolls up, hides when near bottom
- ✅ **requestAnimationFrame** for smooth scrolling performance
- ✅ **User override respected** - no forced scrolling when reading history
- ✅ **Separate log auto-scroll** with 200px threshold

### Car Mode FSM (Production-Ready)
- ✅ **Explicit state machine**: IDLE → LISTENING → TRANSCRIBING → SENDING → THINKING → SPEAKING → IDLE
- ✅ **Console logging** of all state transitions for debugging
- ✅ **90-second watchdog timer** prevents stuck THINKING state
- ✅ **Proper lifecycle management**: recognition instance stable across listening state changes
- ✅ **Error recovery**: all error paths transition to IDLE and attempt restart
- ✅ **Reliable restart**: explicit recognition.start() after TTS completes
- ✅ **State synchronization**: carModeStateRef eliminates dependency issues

### Multi-Page Website with Live Preview (October 2, 2025)
- ✅ **Express server integration**: server.js serves static files from /site directory on port 3000
- ✅ **ZIP bundle structure**: /site/ subfolder for website files, server.js and package.json at root
- ✅ **File-based navigation**: Links use /about.html, /projects.html, /contact.html (not hash routes)
- ✅ **Clean URL support**: Express extensions option allows /about to resolve to about.html
- ✅ **Apps Script multi-page router**: doGet() with HtmlService.createHtmlOutputFromFile() for Sheets Web App deployment
- ✅ **Complete documentation**: README.md with setup, structure, and deployment instructions
- ✅ **Admin panel included**: Separate /admin directory with token auth and CRUD interface
- ✅ **Apps Script backend**: /apps_script directory with ContentApi.gs for Google Sheets integration

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Layout**: ResizablePanelGroup (react-resizable-panels) with horizontal + nested vertical splits
- **Styling**: Tailwind CSS with shadcn/ui component library
- **State Management**: React hooks with custom WebSocket hook for real-time communication
- **Routing**: Wouter for lightweight client-side routing
- **HTTP Client**: TanStack React Query with custom fetch wrapper
- **Real-time**: WebSocket connection for live updates and log streaming

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Module System**: ESM (ES Modules)
- **Database**: PostgreSQL with Drizzle ORM
- **Real-time**: WebSocket server for bidirectional communication
- **File Storage**: Local filesystem with artifacts stored in `/artifacts` directory
- **AI Integration**: OpenAI API for chat completions and content generation
- **Packaging**: archiver for future multi-file artifact bundling

### Build System
- **Frontend Build**: Vite with React plugin
- **Backend Build**: esbuild for production bundling
- **Development**: Concurrent development with Vite dev server and tsx for backend

## Key Components

### Chat System
- **Persona Management**: Multiple AI personas (professional, creative, technical, etc.)
- **Tone Control**: Adjustable communication tone (formal, casual, friendly, etc.)
- **Voice Integration**: Speech-to-text input and text-to-speech output
- **Car Mode FSM**: Production-ready hands-free voice interaction with explicit state machine
  - States: IDLE → LISTENING → TRANSCRIBING → SENDING → THINKING → SPEAKING → IDLE
  - 3-second silence detection for automatic message sending
  - 90-second watchdog timer for stuck THINKING state
  - Comprehensive error recovery and logging
- **Real-time Messaging**: WebSocket-based chat with live status updates and auto-reconnection

### Content Generation Agent
- **Multi-step Pipeline**: Research → Outline → Visual Matching → Building → Delivery
- **Web Search**: SerpAPI with DuckDuckGo fallback for content research
- **Visual Assets**: Unsplash → Pixabay → Picsum fallback pipeline for images
- **Chart Generation**: QuickChart.io integration for data visualizations
- **Document Building**: Intelligent format detection supporting PPTX, DOCX, HTML, CSV, Markdown, Reports, Dashboards, and Infographics
- **Format Detection**: Smart keyword-based format detection (website→HTML, document→DOCX, spreadsheet→CSV, analysis→DOCX+MD)
- **Quick Actions**: User-customizable templates for common content types with format-specific keywords

### UI/UX Features
- **Three-Panel Layout**: Persistent Quick Actions | Chat | Logs+Artifacts panels
- **Dual-Delivery**: Artifacts appear in chat AND dedicated panel simultaneously
- **Smart Auto-Scroll**: Near-bottom detection with optional "Jump to latest" button
- **Panel Persistence**: Resize preferences saved to localStorage
- **Real-time Logs**: Live structured logging with color-coded log levels
- **Artifact Browser**: Dedicated panel for browsing all generated files

### Task Management
- **Async Processing**: Background task execution with progress tracking
- **Status Updates**: Real-time progress reporting through WebSocket
- **Error Handling**: Comprehensive error handling with fallback mechanisms
- **Logging**: Structured logging with multiple log levels (trace, step_start, step_end, delivery)

### File Management
- **Artifact Storage**: Local filesystem storage with public URL generation
- **Download System**: Direct file serving through Express static middleware
- **Metadata Tracking**: File size, type, and content metadata storage

## Data Flow

1. **User Interaction**: User sends chat message or content generation request
2. **Session Management**: WebSocket connection establishes session-based communication
3. **Task Creation**: Agent service creates background task with unique ID
4. **Processing Pipeline**: 
   - Research phase: Web search and content gathering
   - Planning phase: AI-generated outline and structure
   - Visual phase: Image and chart procurement
   - Building phase: Document assembly and generation
   - Delivery phase: File storage and URL generation
5. **Real-time Updates**: Progress and status updates sent via WebSocket
6. **Artifact Delivery**: Completed files made available for download in BOTH chat and panel

## External Dependencies

### AI Services
- **OpenAI API**: Primary AI model for chat and content generation (GPT-4o)
- **Fallback Strategy**: Error handling for API rate limits and failures

### Search Services
- **SerpAPI**: Primary web search API (optional, requires API key)
- **DuckDuckGo**: Fallback search service (no API key required)

### Visual Services
- **Unsplash API**: Primary image source (optional, requires API key)
- **Pixabay API**: Secondary image source
- **Picsum**: Final fallback for placeholder images
- **QuickChart.io**: Chart generation service

### Database
- **Neon Database**: Serverless PostgreSQL hosting
- **Connection**: Uses `@neondatabase/serverless` driver
- **Schema Management**: Drizzle Kit for migrations

## Deployment Strategy

### Development Environment
- **Local Development**: Vite dev server with hot reload
- **Database**: Connected to remote Neon database
- **File Storage**: Local artifacts directory
- **WebSocket**: Development WebSocket server on same port

### Production Deployment
- **Build Process**: Frontend built to `/dist/public`, backend bundled with esbuild
- **Static Files**: Express serves built React app and artifact files
- **Environment Variables**: API keys and database URL configured via environment
- **Process Management**: Single Node.js process serving both API and static files
- **Port**: 8080 for Cloud Run compatibility

### Configuration Requirements
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: Required for AI functionality
- `SERP_API_KEY`: Optional for enhanced search
- `UNSPLASH_ACCESS_KEY`: Optional for better image quality

## Future Enhancements

### Enhanced DOCX Quality (Planned)
- Proper heading hierarchy (H1, H2, H3)
- Table of contents generation
- Native table support
- Embedded chart images
- Optional PDF export via HTML-to-PDF conversion

### Advanced Telemetry (Planned)
- Structured error logging with severity levels
- Performance metrics (generation time, API call counts)
- User analytics (popular formats, successful generations)
- Debugging aids (request/response traces)

The application is designed for easy deployment on platforms like Replit, with persistent file storage and reliable artifact delivery being key architectural decisions to address the original Firebase Studio limitations.
