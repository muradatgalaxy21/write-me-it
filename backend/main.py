"""FastAPI backend — the 3 agents. Run sequentially, one endpoint per stage."""
import os
import textwrap

from dotenv import load_dotenv

load_dotenv()  # load backend/.env before anything reads GROQ_API_KEY

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents.groq_client import chat_json, total_tokens
from agents.prompts import (
    CRITIC_BLOG_SYSTEM,
    CRITIC_OUTLINE_SYSTEM,
    EDITOR_BLOG_SYSTEM,
    EDITOR_OUTLINE_SYSTEM,
    WRITER_BLOG_SYSTEM,
    WRITER_OUTLINE_SYSTEM,
    blog_user,
    critic_user,
    editor_user,
    outline_user,
)

# how many drafts each writer call returns (single-track flow with user-driven refine)
N = 1

# Per-agent output budgets. Each stage gets its own cap so no single agent
# (e.g. the outline writer) consumes the whole allowance and forces later
# stages to summarize. Override per agent via env if needed.
# Critic/editor budgets are per-mode: the BLOG critic and editor echo the FULL
# text of one ~600-word post (annotated / polished), so they need more room than
# the OUTLINE phase but not double. Too small here => the model truncates mid-JSON
# and Groq rejects the call with json_validate_failed.
BUDGET = {
    "outline": int(os.environ.get("BUDGET_OUTLINE", "1000")),
    "blog": int(os.environ.get("BUDGET_BLOG", "1500")),
    "critic_outline": int(os.environ.get("BUDGET_CRITIC_OUTLINE", "1200")),
    "critic_blog": int(os.environ.get("BUDGET_CRITIC_BLOG", "2200")),
    "editor_outline": int(os.environ.get("BUDGET_EDITOR_OUTLINE", "1200")),
    "editor_blog": int(os.environ.get("BUDGET_EDITOR_BLOG", "2200")),
}


def pick_list(data, key: str) -> list:
    """Pull a list out of the model's JSON, tolerating shape drift.

    The model sometimes returns a bare array instead of {key: [...]}, or nests
    the array under the wrong key. Fall back gracefully instead of crashing.
    """
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        v = data.get(key)
        if isinstance(v, list):
            return v
        # take the first list-valued field if the key was renamed
        for val in data.values():
            if isinstance(val, list):
                return val
    return []


def usage_payload(usage: dict) -> dict:
    """Attach the cross-call running total to a single call's usage."""
    return {"usage": usage, "total_tokens_all_time": total_tokens()}


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
    mode: str = "outline"  # "outline" | "blog"


class EditorReq(BaseModel):
    drafts: list[str]
    critiques: list[Critique]
    mode: str = "outline"  # "outline" | "blog"


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
        budget = BUDGET["blog"]
    else:
        system, user = WRITER_OUTLINE_SYSTEM, outline_user(req.topic)
        budget = BUDGET["outline"]
    try:
        data, usage = chat_json(system, user, max_tokens=budget)
    except Exception as e:
        raise HTTPException(500, str(e))
    return {
        "drafts": [clean_md(d) for d in pick_list(data, "drafts")[:N]],
        **usage_payload(usage),
    }


@app.post("/critic")
def critic(req: CriticReq):
    if not req.drafts:
        raise HTTPException(400, "drafts are required")
    system = CRITIC_BLOG_SYSTEM if req.mode == "blog" else CRITIC_OUTLINE_SYSTEM
    budget = BUDGET["critic_blog"] if req.mode == "blog" else BUDGET["critic_outline"]
    try:
        data, usage = chat_json(system, critic_user(req.drafts), max_tokens=budget)
    except Exception as e:
        raise HTTPException(500, str(e))
    out = []
    for c in pick_list(data, "critiques"):
        if not isinstance(c, dict):
            continue
        out.append(
            {
                "annotated": c.get("annotated", ""),
                "issues": c.get("issues", []) if isinstance(c.get("issues"), list) else [],
            }
        )
    return {"critiques": out, **usage_payload(usage)}


@app.post("/editor")
def editor(req: EditorReq):
    if not req.drafts:
        raise HTTPException(400, "drafts are required")
    critiques = [c.model_dump() for c in req.critiques]
    system = EDITOR_BLOG_SYSTEM if req.mode == "blog" else EDITOR_OUTLINE_SYSTEM
    budget = BUDGET["editor_blog"] if req.mode == "blog" else BUDGET["editor_outline"]
    try:
        data, usage = chat_json(
            system, editor_user(req.drafts, critiques), max_tokens=budget, temperature=0.2
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    return {
        "edited": [clean_md(x) for x in pick_list(data, "edited")[: len(req.drafts)]],
        **usage_payload(usage),
    }
