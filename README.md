# write·me·it — multi-agent blog pipeline (hybrid)

A multi-agent blog drafting and refinement pipeline. Generates outlines first, allows user feedback, then drafts, critique-annotates, and edits full blog posts.

## Architecture (hybrid)
```
Next.js UI ──▶ Next.js /api/* (thin proxy) ──▶ FastAPI backend ──▶ Gemini (Primary/Secondary) ──▶ Groq (Fallback)
 (frontend)        no agent logic                 multi-provider agents
```
- **Frontend:** Next.js 14 + Tailwind. Renders outlines, full drafts, inline critiques, and markdown rendering.
- **Backend:** Python FastAPI. All agent logic + prompts + multi-provider fallback calls live here.
- **Models:** Primary: Gemini 2.5 Flash, Secondary: Gemini 2.5 Flash Lite, Fallback: Groq `llama-3.3-70b-versatile` (or configure via environment).
- No database. State in React.

Proxy keeps one origin (no CORS) and lets the API keys stay server-side in Python.

## The Multi-stage Pipeline
| Stage / Agent | Route | Inputs / Output |
|---|---|---|
| **Outliner** | `POST /writer` (`mode=outline`) | Creates distinct structural outlines |
| **Blog Writer** | `POST /writer` (`mode=blog`) | Drafts full blog posts following selected outline |
| **Critic** | `POST /critic` | Inline red-lines (`~~cut~~`, `{{note}}`) + issue lists |
| **Editor** | `POST /editor` | Rewrites draft incorporating critic suggestions |

Critics return the original annotated with `~~strikethrough~~` and `{{margin notes}}`;
`components/Redline.tsx` renders red strikethrough + mono notes — the shareable screenshot.

## Layout
```
backend/                 FastAPI (Python)
  main.py                endpoints: /writer /critic /editor /health (includes budget/usage metrics)
  agents/
    groq_client.py       Multi-provider wrapper (Gemini + Groq), JSON-forced with fallback
    prompts.py           System prompts for each agent stage
  requirements.txt
  venv/                  (created locally, gitignored)
  .env                   GEMINI_API_KEY & GROQ_API_KEY (you create from .env.example)
app/                     Next.js (frontend + proxy routes)
  api/{writer,critic,editor}/route.ts   forward to FastAPI
  page.tsx               UI + sequential pipeline with outline selection and refinement
components/
  Redline.tsx            red-line renderer
  Markdown.tsx           markdown content renderer
lib/backend.ts           proxy helper (reads BACKEND_URL)
.env.local               BACKEND_URL  (from .env.local.example)
```

## Run locally (two terminals)

### 1. Backend (Python)
```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows (mac/linux: source venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env             # Add GEMINI_API_KEY and/or GROQ_API_KEY
uvicorn main:app --reload --port 8000
```

### 2. Frontend (Next.js)
```bash
cp .env.local.example .env.local   # BACKEND_URL defaults to http://127.0.0.1:8000
npm install
npm run dev                        # http://localhost:3000
```

## Deploy
- **Backend:** Render / Railway / Fly (any Python host). Set `GEMINI_API_KEY` and/or `GROQ_API_KEY`.
- **Frontend:** Vercel. Set `BACKEND_URL` to the deployed backend URL.

## Demo
Test topic: **"RAG vs Agents"**. Generate outline, refine/approve outline, then hit Generate Blog to watch the pipeline execute.
