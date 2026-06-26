"""Thin Groq wrapper: one client, JSON-forced chat completion."""
import json
import os
from functools import lru_cache

from groq import Groq
from groq import BadRequestError

MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
# Default output cap. Each agent passes its own per-call budget so one stage
# (e.g. the first writer) can't swallow the whole token allowance.
DEFAULT_MAX_TOKENS = int(os.environ.get("GROQ_MAX_TOKENS", "2048"))

# Running, process-lifetime token total across every agent call.
_TOTAL_TOKENS = 0


def total_tokens() -> int:
    return _TOTAL_TOKENS


def _is_json_validate_failed(e: BadRequestError) -> bool:
    """True if Groq rejected the call because its JSON output failed to validate."""
    try:
        code = (e.body or {}).get("error", {}).get("code")
    except AttributeError:
        code = None
    return code == "json_validate_failed" or "json_validate_failed" in str(e)


@lru_cache(maxsize=1)
def get_client() -> Groq:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Copy backend/.env.example to backend/.env and add your key."
        )
    return Groq(api_key=key)


def chat_json(system: str, user: str, max_tokens: int | None = None) -> tuple[dict, dict]:
    """Call Groq forcing JSON output. Return (parsed_dict, usage_dict).

    usage_dict = {prompt_tokens, completion_tokens, total_tokens}.
    Also accumulates into the process-lifetime total.
    """
    global _TOTAL_TOKENS
    client = get_client()

    base_budget = max_tokens or DEFAULT_MAX_TOKENS

    def _call(sys_msg: str, temp: float, budget: int):
        return client.chat.completions.create(
            model=MODEL,
            temperature=temp,
            max_tokens=budget,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": user},
            ],
        )

    try:
        res = _call(system, 0.8, base_budget)
    except BadRequestError as e:
        # Groq's JSON mode reports json_validate_failed for BOTH causes we hit:
        # (a) the model nested objects instead of plain strings, and
        # (b) the output got truncated mid-JSON by max_tokens.
        # Retry once: colder, with a hard schema reminder, AND a bigger budget
        # so a truncated response has room to finish.
        if _is_json_validate_failed(e):
            nudge = (
                system
                + "\n\nCRITICAL: Output MUST be valid, COMPLETE JSON. Every array element is a"
                " single plain-text STRING (newlines as \\n). NEVER emit a nested JSON object or"
                " array as an element. Do not use section names as JSON keys."
            )
            res = _call(nudge, 0.2, min(base_budget * 2, 8000))
        else:
            raise

    raw = res.choices[0].message.content or "{}"
    u = res.usage
    usage = {
        "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
        "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
        "total_tokens": getattr(u, "total_tokens", 0) or 0,
    }
    _TOTAL_TOKENS += usage["total_tokens"]
    return json.loads(raw), usage
