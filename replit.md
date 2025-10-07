# Agent Diaz - Autonomous AI Agent for Content Generation

## Overview
Agent Diaz is an autonomous AI agent designed to generate professional content artifacts in various formats from natural language prompts. It features a three-panel persistent interface (Quick Actions, Chat, Logs/Artifacts), real-time AI chat with personas, and voice capabilities including a hands-free Car Mode. The agent produces downloadable artifacts in PPTX, DOCX, HTML, CSV, and Markdown, aiming to provide an efficient solution for content generation.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Layout**: ResizablePanelGroup for a three-panel persistent interface.
- **Styling**: Tailwind CSS with shadcn/ui.
- **State Management**: React hooks and custom WebSocket hook.
- **Routing**: Wouter for client-side routing.
- **HTTP Client**: TanStack React Query.
- **Real-time**: WebSocket connection.

### Backend
- **Runtime**: Node.js with Express.js.
- **Module System**: ESM.
- **Database**: PostgreSQL with Drizzle ORM.
- **Real-time**: WebSocket server.
- **File Storage**: Local filesystem (`/artifacts` directory).
- **AI Integration**: OpenAI API.
- **Packaging**: Archiver for multi-file bundling.

### Build System
- **Frontend**: Vite.
- **Backend**: esbuild for production, tsx for development.

### Key Features and Design Decisions
- **Three-Panel Layout**: Conversation History, Chat, and Logs/Artifacts with panel size persistence.
- **Conversation Management**: Store last 10 conversations with isolated context per conversation (like ChatGPT). Each conversation maintains its own message history and context memory. Users can revisit, continue, export to CSV, or delete conversations.
- **Dual-Delivery Artifacts**: Inline chat display and dedicated Artifacts panel with real-time updates.
- **Smart Auto-Scroll**: Chat auto-scroll with "Jump to latest" button.
- **Car Mode**: Hands-free voice interaction integrated into the top ribbon toggle. Uses MediaRecorder with Voice Activity Detection (VAD) for reliable audio capture. Features 3-second sustained silence detection, OpenAI Whisper STT endpoint (`/car-v2/stt`), automatic transcription-to-chat integration, and OpenAI TTS (`/car-v2/tts`) with **nova voice** for natural-sounding AI responses. Zero-gain audio graph prevents feedback while maintaining VAD functionality. **VERIFIED: No browser voices - 100% OpenAI TTS pipeline.**
- **Multi-step Content Generation**: Pipelines for Research, Outline, Visual Matching, Building, and Delivery.
- **Robust DOCX Generation**: 6-stage validation pipeline including citation mapping, table generation, and chart embedding.
- **Data Analysis Enforcement**: Prompt engineering to ensure deep analysis and synthesis, prohibiting meta-language.
- **Static Website Routing**: Dedicated Express router for serving files from `data/sites/:id`.
- **Multi-Page Website Generation**: Supports live preview and deployment.
- **Chat-First Orchestrator**: Intent detection and automatic routing to specialized pipelines (CALENDAR, DATA_ANALYSIS, PRESENTATION, WEBSITE, REPORT, GENERIC_CHAT) directly from chat, leveraging conversation context.
- **Orchestrator-Driven Prompts**: Adaptive, schema-driven prompt generation from runtime data, eliminating hardcoded examples.
- **Pipeline Separation**: Intent router distinguishes between `DATA_ANALYSIS` and `RESEARCH_REPORT` pipelines, routing to specialized execution paths.
- **R0-R5 Iterative Source Harvest System**: Improved source gathering strategy focusing on quality sources and iterative searching until at least 10 vetted sources are found, with a robust vetting policy.
- **Context Isolation**: Each conversation has its own 20-turn rolling context window. Switching conversations clears context, ensuring no information leakage between conversations.

## External Dependencies

### AI Services
- **OpenAI API**: Primary AI model (GPT-4o).

### Search Services
- **SerpAPI**: Primary web search.
- **DuckDuckGo**: Fallback search.

### Visual Services
- **Unsplash API**: Primary image source.
- **Pixabay API**: Secondary image source.
- **Picsum**: Fallback for placeholder images.
- **QuickChart.io**: Chart generation.

### Database
- **Neon Database**: Serverless PostgreSQL hosting, using `@neondatabase/serverless` and Drizzle Kit.

### Calendar Integration
- **Google Apps Script (via proxy)**: For hands-free natural language calendar scheduling.