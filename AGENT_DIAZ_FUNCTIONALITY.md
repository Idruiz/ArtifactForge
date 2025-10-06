# Agent Diaz - Complete Functionality Reference

## Overview
Agent Diaz is an autonomous AI agent for professional content generation with conversation management, voice interaction, and multi-format artifact creation.

---

## Core Capabilities

### 1. **Conversation Management (ChatGPT-style)**
- **Create unlimited conversations** - Each conversation has isolated context
- **Revisit past conversations** - Access last 10 conversations from sidebar
- **Export to CSV** - Download full conversation history with timestamps
- **Delete conversations** - Remove unwanted conversations
- **Context isolation** - Switching conversations clears memory (no cross-talk)
- **Rolling context window** - 20-turn memory per conversation

**How to use:**
- Click "Conversations" tab in left panel
- Click "New Conversation" to start fresh
- Select any conversation to continue where you left off
- Export button downloads CSV with all messages

---

### 2. **Content Generation Pipelines**

#### **Research Reports (DOCX)**
- **Deep web research** - R0-R5 iterative source harvesting (10+ scholarly sources)
- **6-stage validation** - Citation mapping, table generation, chart embedding
- **Academic formatting** - Proper citations, references, structured sections
- **Data visualization** - Embedded charts and tables

**Example prompt:** "Generate a comprehensive report about renewable energy trends in 2024"

#### **Data Analysis (DOCX)**
- **CSV/Excel analysis** - Upload data for deep statistical analysis
- **Chart generation** - QuickChart.io integration for visualizations
- **Insight synthesis** - Prohibition against meta-language ensures real analysis
- **Professional formatting** - Executive summary, methodology, findings

**Example prompt:** "Analyze this student performance data and find trends"

#### **Presentations (PPTX)**
- **Multi-slide generation** - Title, content, charts, conclusion slides
- **Visual matching** - Unsplash/Pixabay integration for relevant images
- **Professional layouts** - Clean, corporate-ready design
- **Data charts** - Embedded visualizations

**Example prompt:** "Create a presentation about quarterly sales performance"

#### **Websites (HTML)**
- **Multi-page sites** - Index + navigation pages
- **Live preview** - Instant `/sites/:id` URL for testing
- **Modern design** - Responsive, mobile-friendly layouts
- **Static hosting** - Deployable via Express router

**Example prompt:** "Build a portfolio website with about, projects, and contact pages"

---

### 3. **Car Mode V2 (NEW - Hands-Free Voice)**

**Features:**
- **Voice Activity Detection (VAD)** - Automatic recording on voice detection
- **Circuit breaker** - Stops after 4 consecutive API failures (60s cooldown)
- **Rate limiting** - Max 8 requests/minute
- **Budget controls** - 5-minute session hard cap
- **Calendar integration** - Auto-routes calendar commands to Google Calendar
- **On-device TTS** - Free speech synthesis for responses

**How to use:**
1. Click "Quick Actions" tab → "Car Mode V2"
2. Click "Start (Car Mode V2)" to begin listening
3. Say calendar commands like: "Create a team meeting today at 12:30 with colleague calendar for 30 minutes"
4. System auto-detects voice, transcribes via Whisper, and routes to calendar

**Technology:**
- OpenAI Whisper for speech-to-text
- MediaRecorder API for audio capture
- Simple energy + zero-crossing VAD
- No streaming (chunks only sent on silence detection)

**Cost guardrails:**
- Session cap: 5 minutes max
- Rate limit: 8 requests/minute
- Circuit breaker after 4 fails
- VAD prevents empty API calls

---

### 4. **Calendar Agent (Beta)**
- **Natural language scheduling** - "Book meeting tomorrow at 2pm"
- **Google Calendar integration** - Via Apps Script proxy
- **Multi-attendee support** - Invite colleagues by calendar ID
- **Free slot finding** - Suggests available times
- **Work hours aware** - Respects 9am-6pm constraints

**Example command:** "Schedule a 1-hour review meeting with john@company.com next Tuesday at 10am"

---

### 5. **Chat-First Orchestrator**

**Intent Detection:**
- `CALENDAR` - Natural language calendar commands
- `DATA_ANALYSIS` - CSV/Excel analysis requests
- `RESEARCH_REPORT` - Topic research with sources
- `PRESENTATION` - Slide deck creation
- `WEBSITE` - Multi-page site generation
- `GENERIC_CHAT` - Conversational AI responses

**Pipeline Separation:**
- Automatically routes to specialized execution paths
- No manual mode selection required
- Context-aware based on conversation history

---

## Artifact Formats

| Format | Use Case | Download |
|--------|----------|----------|
| **PPTX** | Presentations, slide decks | ✓ |
| **DOCX** | Reports, analysis, documentation | ✓ |
| **HTML** | Websites, landing pages | ✓ Live preview |
| **CSV** | Data exports, conversation history | ✓ |
| **MD** | Markdown documentation | ✓ |

---

## Architecture

### **Frontend**
- React 18 + TypeScript
- Three-panel resizable layout (Conversations/Actions | Chat | Logs/Artifacts)
- TanStack Query for state management
- Wouter for routing
- WebSocket for real-time updates

### **Backend**
- Node.js + Express
- PostgreSQL with Drizzle ORM
- WebSocket server for real-time
- OpenAI API (GPT-4o, Whisper, TTS)
- Multi-format artifact generation

### **Database**
- Neon PostgreSQL (serverless)
- Tables: `conversations`, `conversation_messages`
- Context isolation by `conversationId`

---

## External Services

### **AI Services**
- OpenAI GPT-4o (chat, orchestration)
- OpenAI Whisper (speech-to-text)
- OpenAI TTS (text-to-speech)

### **Search & Data**
- SerpAPI (primary web search)
- DuckDuckGo (fallback search)

### **Visual Assets**
- Unsplash API (primary images)
- Pixabay API (secondary images)
- QuickChart.io (chart generation)

### **Calendar**
- Google Apps Script proxy for Calendar API

---

## Usage Contexts

### **From Chat Interface:**
```
User: "Create a presentation about climate change"
→ Routes to PRESENTATION pipeline
→ Generates PPTX with slides, charts, images
→ Displays inline + Artifacts panel
```

### **From Quick Actions:**
```
Click "Report" → Pre-fills: "Generate a comprehensive DOCX report about [YOUR TOPIC]..."
→ User edits topic
→ Routes to RESEARCH_REPORT pipeline
→ R0-R5 source harvest → 6-stage DOCX validation
```

### **From Car Mode V2:**
```
User: "Create a team sync tomorrow at 3pm with engineering calendar"
→ VAD detects voice → Whisper transcribes
→ Regex matches calendar intent
→ Routes to /calendar-multi/command
→ Books event → Speaks confirmation
```

### **From Conversation History:**
```
Click conversation from sidebar
→ Loads all messages for that conversation
→ Context restored (last 20 turns)
→ Continue where you left off
→ Export to CSV anytime
```

---

## Quick Start

1. **Start a conversation:** Auto-creates on first load
2. **Choose your task:**
   - Type naturally in chat (e.g., "Analyze this sales data")
   - Use Quick Actions for templates
   - Enable Car Mode V2 for hands-free
3. **Review artifacts:** Right panel shows logs + downloadable files
4. **Switch contexts:** Click different conversation to isolate work
5. **Export/Download:** Get CSV history or artifact files

---

## Environment Variables Required

```bash
OPENAI_API_KEY        # For GPT-4o, Whisper, TTS
DATABASE_URL          # Neon PostgreSQL connection
GAS_WEB_APP_URL       # Google Calendar proxy
GAS_SHARED_TOKEN      # Calendar auth token
SERPAPI_KEY           # Web search (optional, has fallback)
UNSPLASH_ACCESS_KEY   # Images (optional, has fallback)
```

---

## Current State (October 2025)

✅ **Working:**
- Conversation management with isolation
- All content pipelines (DOCX, PPTX, HTML, CSV)
- Car Mode V2 with VAD and cost controls
- Calendar agent via natural language
- CSV export of conversations
- Multi-format artifact generation

⚠️ **Beta:**
- Calendar agent (Google Apps Script proxy)
- Car Mode V2 (new implementation, not battle-tested)

🔧 **Technical Debt:**
- Old Car Mode (deprecated, replaced by V2)
- ScriptProcessorNode (deprecated in Web Audio API, works but should migrate to AudioWorklet)

---

## Access Points

| Feature | Access Method |
|---------|--------------|
| Conversations | Left panel → "Conversations" tab |
| Quick Actions | Left panel → "Quick Actions" tab |
| Car Mode V2 | Quick Actions → "Car Mode V2" button |
| Calendar Agent | Quick Actions → "Calendar Agent" button |
| Chat Interface | Center panel (always visible) |
| Artifacts | Right panel → "Artifacts" tab |
| Logs | Right panel → "Logs" tab |

---

## Next Steps

1. Test Car Mode V2 with real microphone input
2. Verify calendar integration works end-to-end
3. Battle-test conversation isolation (no memory leaks)
4. Validate artifact generation quality
5. Consider migrating ScriptProcessorNode → AudioWorklet
