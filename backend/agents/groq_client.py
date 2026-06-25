"""Thin Groq wrapper: one client, JSON-forced chat completion."""
import json
import os
from functools import lru_cache

from groq import Groq

MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
# Output cap for one call. One call returns all 3 drafts in JSON, so this is a
# whole-response budget (~200 tokens/draft + JSON overhead, headroom for critic).
MAX_TOKENS = int(os.environ.get("GROQ_MAX_TOKENS", "2048"))


@lru_cache(maxsize=1)
def get_client() -> Groq:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Copy backend/.env.example to backend/.env and add your key."
        )
    return Groq(api_key=key)


def chat_json(system: str, user: str) -> dict:
    """Call Groq forcing JSON output, return parsed dict."""
    client = get_client()
    res = client.chat.completions.create(
        model=MODEL,
        temperature=0.8,
        max_tokens=MAX_TOKENS,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    raw = res.choices[0].message.content or "{}"
    return json.loads(raw)
