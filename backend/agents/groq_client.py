"""LLM wrapper with provider fallback: JSON-forced chat completion.

Provider order (each falls through to the next on quota/rate-limit/parse failure):
  1. gemini-2.5-flash       (Gemini free tier, primary)
  2. gemini-2.5-flash-lite  (Gemini free tier, more daily requests)
  3. groq llama-3.3-70b      (last resort)

Public surface is unchanged: chat_json(system, user, max_tokens) -> (dict, usage)
and total_tokens(). Callers in main.py need no changes.
"""
import json
import os
from functools import lru_cache

import httpx
from groq import Groq
from groq import BadRequestError

# --- Groq config -----------------------------------------------------------
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
# Default output cap. Each agent passes its own per-call budget so one stage
# (e.g. the first writer) can't swallow the whole token allowance.
DEFAULT_MAX_TOKENS = int(os.environ.get("GROQ_MAX_TOKENS", "10000"))

# --- Gemini config ---------------------------------------------------------
# Primary first, then lite. Override via env if needed.
GEMINI_MODEL_PRIMARY = os.environ.get("GEMINI_MODEL_PRIMARY", "gemini-2.5-flash")
GEMINI_MODEL_SECONDARY = os.environ.get("GEMINI_MODEL_SECONDARY", "gemini-2.5-flash-lite")
_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Running, process-lifetime token total across every agent call/provider.
_TOTAL_TOKENS = 0


def total_tokens() -> int:
    return _TOTAL_TOKENS


class _QuotaExhausted(Exception):
    """Provider hit a rate/quota limit (or returned no usable output). Try next."""


# --- Groq helpers ----------------------------------------------------------
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


def _groq_call(system: str, user: str, budget: int, temperature: float) -> tuple[dict, dict]:
    client = get_client()

    def _call(sys_msg: str, temp: float, b: int):
        return client.chat.completions.create(
            model=GROQ_MODEL,
            temperature=temp,
            max_tokens=b,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": user},
            ],
        )

    try:
        res = _call(system, temperature, budget)
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
            res = _call(nudge, 0.2, min(budget * 2, 8000))
        else:
            raise

    raw = res.choices[0].message.content or "{}"
    u = res.usage
    usage = {
        "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
        "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
        "total_tokens": getattr(u, "total_tokens", 0) or 0,
    }
    return json.loads(raw), usage


# --- Gemini helpers --------------------------------------------------------
def _gemini_call(model: str, system: str, user: str, budget: int, temperature: float) -> tuple[dict, dict]:
    """Call Gemini generateContent forcing JSON. Raise _QuotaExhausted on 429
    or when the model returns no usable JSON text (so we fall to the next provider)."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise _QuotaExhausted("GEMINI_API_KEY not set")

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": budget,
            "responseMimeType": "application/json",
            # Disable 2.5 "thinking" so the token budget goes to actual output
            # and we don't get empty responses that burn the budget on reasoning.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    url = f"{_GEMINI_BASE}/{model}:generateContent"
    try:
        resp = httpx.post(
            url,
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json=payload,
            timeout=60.0,
        )
    except httpx.HTTPError as e:
        raise _QuotaExhausted(f"gemini transport error: {e}")

    if resp.status_code == 429:
        raise _QuotaExhausted(f"{model} quota/rate limit (429)")
    if resp.status_code >= 400:
        # Other errors (e.g. limit:0 free-tier comes back as 429, but be safe).
        raise _QuotaExhausted(f"{model} http {resp.status_code}: {resp.text[:200]}")

    body = resp.json()
    try:
        text = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise _QuotaExhausted(f"{model} returned no text (finish: {body!r})")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise _QuotaExhausted(f"{model} returned non-JSON output")

    um = body.get("usageMetadata", {})
    usage = {
        "prompt_tokens": um.get("promptTokenCount", 0) or 0,
        "completion_tokens": um.get("candidatesTokenCount", 0) or 0,
        "total_tokens": um.get("totalTokenCount", 0) or 0,
    }
    return parsed, usage


# --- Public API ------------------------------------------------------------
def chat_json(
    system: str, user: str, max_tokens: int | None = None, temperature: float = 0.8
) -> tuple[dict, dict]:
    """Call the LLM forcing JSON output, with provider fallback.

    Tries gemini-2.5-flash, then gemini-2.5-flash-lite, then Groq. The first
    provider that returns valid JSON wins. Returns (parsed_dict, usage_dict)
    where usage_dict = {prompt_tokens, completion_tokens, total_tokens}.
    Also accumulates into the process-lifetime total.
    """
    global _TOTAL_TOKENS
    budget = max_tokens or DEFAULT_MAX_TOKENS

    providers = [
        ("gemini", GEMINI_MODEL_PRIMARY),
        ("gemini", GEMINI_MODEL_SECONDARY),
        ("groq", GROQ_MODEL),
    ]

    last_err: Exception | None = None
    for kind, model in providers:
        try:
            if kind == "gemini":
                parsed, usage = _gemini_call(model, system, user, budget, temperature)
            else:
                parsed, usage = _groq_call(system, user, budget, temperature)
        except _QuotaExhausted as e:
            last_err = e
            continue  # next provider
        _TOTAL_TOKENS += usage["total_tokens"]
        return parsed, usage

    raise RuntimeError(f"All LLM providers exhausted. Last error: {last_err}")
