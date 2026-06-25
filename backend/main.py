"""FastAPI backend — the 3 agents. Run sequentially, one endpoint per stage."""
from dotenv import load_dotenv

load_dotenv()  # load backend/.env before anything reads GROQ_API_KEY

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.groq_client import chat_json
from agents.prompts import (
    CRITIC_SYSTEM,
    EDITOR_SYSTEM,
    WRITER_SYSTEM,
    critic_user,
    editor_user,
    writer_user,
)

app = FastAPI(title="write-me-it agents")

# allow the Next.js dev server to call directly if you skip the proxy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Critique(BaseModel):
    annotated: str = ""
    issues: list[str] = []


class WriterReq(BaseModel):
    topic: str


class CriticReq(BaseModel):
    drafts: list[str]


class EditorReq(BaseModel):
    drafts: list[str]
    critiques: list[Critique]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/writer")
def writer(req: WriterReq):
    if not req.topic.strip():
        raise HTTPException(400, "topic is required")
    try:
        data = chat_json(WRITER_SYSTEM, writer_user(req.topic))
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"drafts": (data.get("drafts") or [])[:3]}


@app.post("/critic")
def critic(req: CriticReq):
    if not req.drafts:
        raise HTTPException(400, "drafts are required")
    try:
        data = chat_json(CRITIC_SYSTEM, critic_user(req.drafts))
    except Exception as e:
        raise HTTPException(500, str(e))
    out = []
    for c in data.get("critiques") or []:
        out.append(
            {
                "annotated": c.get("annotated", ""),
                "issues": c.get("issues", []) if isinstance(c.get("issues"), list) else [],
            }
        )
    return {"critiques": out}


@app.post("/editor")
def editor(req: EditorReq):
    if not req.drafts:
        raise HTTPException(400, "drafts are required")
    critiques = [c.model_dump() for c in req.critiques]
    try:
        data = chat_json(EDITOR_SYSTEM, editor_user(req.drafts, critiques))
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"edited": (data.get("edited") or [])[: len(req.drafts)]}
