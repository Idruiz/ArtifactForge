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