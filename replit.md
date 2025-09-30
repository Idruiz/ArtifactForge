# Agent Diaz - Autonomous AI Agent for Content Generation

## Overview

Agent Diaz is a sophisticated autonomous AI agent that generates professional presentations and reports from natural language prompts. The application features a real-time chat interface with AI personas, voice capabilities, and produces downloadable artifacts in multiple formats (PPTX, PDF, HTML). This is a full-stack application built with Node.js/Express backend and React frontend, designed to replace a Firebase Studio AI agent with improved reliability and delivery capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
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

### Build System
- **Frontend Build**: Vite with React plugin
- **Backend Build**: esbuild for production bundling
- **Development**: Concurrent development with Vite dev server and tsx for backend

## Key Components

### Chat System
- **Persona Management**: Multiple AI personas (professional, creative, technical, etc.)
- **Tone Control**: Adjustable communication tone (formal, casual, friendly, etc.)
- **Voice Integration**: Speech-to-text input and text-to-speech output
- **Real-time Messaging**: WebSocket-based chat with live status updates

### Content Generation Agent
- **Multi-step Pipeline**: Research → Outline → Visual Matching → Building → Delivery
- **Web Search**: SerpAPI with DuckDuckGo fallback for content research
- **Visual Assets**: Unsplash → Pixabay → Picsum fallback pipeline for images
- **Chart Generation**: QuickChart.io integration for data visualizations
- **Document Building**: Support for PPTX, PDF, and HTML generation

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
6. **Artifact Delivery**: Completed files made available for download

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

### Configuration Requirements
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: Required for AI functionality
- `SERP_API_KEY`: Optional for enhanced search
- `UNSPLASH_ACCESS_KEY`: Optional for better image quality

The application is designed for easy deployment on platforms like Replit, with persistent file storage and reliable artifact delivery being key architectural decisions to address the original Firebase Studio limitations.