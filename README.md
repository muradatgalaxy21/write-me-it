# write·me·it — multi-agent blog pipeline (hybrid)

Writer drafts 3 → Critic red-lines each → Editor fixes → you pick the winner.
The visible critique (AI arguing with itself) is the demo hook.

## Architecture (hybrid)
```
Next.js UI ──▶ Next.js /api/* (thin proxy) ──▶ FastAPI backend ──▶ Groq
 (frontend)        no agent logic                the 3 agents
```
- **Frontend:** Next.js 14 + Tailwind. Renders cards, red-lines, pick-winner, copy.
- **Backend:** Python FastAPI. All agent logic + prompts + Groq calls live here.
- **Model:** Groq `llama-3.3-70b-versatile` — one model, 3 system prompts.
- No database. State in React.

Proxy keeps one origin (no CORS) and lets the key stay server-side in Python.

## The 3 agents = 3 prompts (run sequentially)
| Agent | Backend route | Output |
|---|---|---|
| Writer | `POST /writer` | 3 distinct drafts |
| Critic | `POST /critic` | inline red-lines (`~~cut~~`, `{{note}}`) + issue list |
| Editor | `POST /editor` | 3 polished drafts |

Critic returns the original annotated with `~~strikethrough~~` and `{{margin notes}}`;
`components/Redline.tsx` renders red strikethrough + mono notes — the shareable screenshot.

## Layout
```
backend/                 FastAPI (Python)
  main.py                endpoints: /writer /critic /editor /health
  agents/
    groq_client.py       Groq wrapper, JSON-forced
    prompts.py           the 3 system prompts
  requirements.txt
  venv/                  (created locally, gitignored)
  .env                   GROQ_API_KEY  (you create from .env.example)
app/                     Next.js (frontend + proxy routes)
  api/{writer,critic,editor}/route.ts   forward to FastAPI
  page.tsx               UI + sequential pipeline
components/Redline.tsx   red-line renderer
lib/backend.ts           proxy helper (reads BACKEND_URL)
.env.local               BACKEND_URL  (from .env.local.example)
```

## Run locally (two terminals)

### 1. Backend (Python)
```bash
cd backend
python -m venv venv
venv\Scripts\activate            # Windows  (mac/linux: source venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env             # add your free Groq key from console.groq.com/keys
uvicorn main:app --reload --port 8000
```

### 2. Frontend (Next.js)
```bash
cp .env.local.example .env.local   # BACKEND_URL defaults to http://127.0.0.1:8000
npm install
npm run dev                        # http://localhost:3000
```

## Deploy
- **Backend:** Render / Railway / Fly (any Python host). Set `GROQ_API_KEY`.
- **Frontend:** Vercel. Set `BACKEND_URL` to the deployed backend URL.

## Demo
Test topic: **"RAG vs Agents"**. Hit Generate, record the moment the 🔴 Critique appears.
