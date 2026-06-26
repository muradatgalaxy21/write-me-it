"""FastAPI backend — the 3 agents. Run sequentially, one endpoint per stage."""
import textwrap

from dotenv import load_dotenv

load_dotenv()  # load backend/.env before anything reads GROQ_API_KEY

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.groq_client import chat_json
from agents.prompts import (
    CRITIC_SYSTEM,
    EDITOR_SYSTEM,
    WRITER_BLOG_SYSTEM,
    WRITER_OUTLINE_SYSTEM,
    blog_user,
    critic_user,
    editor_user,
    outline_user,
)

# how many drafts each writer call returns
N = 2


def clean_md(s: str) -> str:
    """Strip common leading indent so markdown isn't parsed as a code block."""
    return textwrap.dedent(s).strip()

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
    mode: str = "outline"  # "outline" | "blog"
    outline: str = ""      # required when mode == "blog"


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
    if req.mode == "blog":
        if not req.outline.strip():
            raise HTTPException(400, "outline is required for blog mode")
        system, user = WRITER_BLOG_SYSTEM, blog_user(req.topic, req.outline)
    else:
        system, user = WRITER_OUTLINE_SYSTEM, outline_user(req.topic)
    try:
        data = chat_json(system, user)
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"drafts": [clean_md(d) for d in (data.get("drafts") or [])[:N]]}


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
    return {"edited": [clean_md(x) for x in (data.get("edited") or [])[: len(req.drafts)]]}
