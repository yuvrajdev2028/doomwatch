"""
Payload Sanitization, Redaction & Truncation Utilities
"""

import json
from typing import Any, Dict, List, Optional, Set

DEFAULT_SENSITIVE_KEYS: Set[str] = {
    "password",
    "passwd",
    "secret",
    "token",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "refresh_token",
    "authorization",
    "auth",
    "cookie",
    "setcookie",
    "apikey",
    "api_key",
    "xapikey",
    "privatekey",
    "private_key",
    "creditcard",
    "credit_card",
    "cardnumber",
    "card_number",
    "cvv",
    "cvc",
    "ssn",
}

REDACTED_PLACEHOLDER = "[REDACTED]"
DEFAULT_MAX_BODY_BYTES = 4096  # 4KB


def is_sensitive_key(key: str, custom_keys: Optional[List[str]] = None) -> bool:
    """Checks if a key name matches any known sensitive patterns."""
    lower = key.lower().replace("-", "").replace("_", "")
    if lower in DEFAULT_SENSITIVE_KEYS:
        return True
    if custom_keys:
        for custom in custom_keys:
            if lower == custom.lower().replace("-", "").replace("_", ""):
                return True
    return False


def redact_data(data: Any, custom_keys: Optional[List[str]] = None, depth: int = 0) -> Any:
    """Recursively redacts sensitive fields from dicts or lists."""
    if data is None or depth > 8:
        return data

    if isinstance(data, list):
        return [redact_data(item, custom_keys, depth + 1) for item in data]

    if isinstance(data, dict):
        sanitized: Dict[str, Any] = {}
        for k, v in data.items():
            str_key = str(k)
            if is_sensitive_key(str_key, custom_keys):
                sanitized[str_key] = REDACTED_PLACEHOLDER
            elif isinstance(v, (dict, list)):
                sanitized[str_key] = redact_data(v, custom_keys, depth + 1)
            else:
                sanitized[str_key] = v
        return sanitized

    return data


def redact_headers(headers: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Redacts sensitive HTTP headers (e.g. Authorization, Cookie, API keys)."""
    if headers is None:
        return None

    sanitized: Dict[str, Any] = {}
    for k, v in headers.items():
        key_str = str(k)
        lower = key_str.lower()
        if (
            lower in ("authorization", "cookie", "set-cookie", "proxy-authorization")
            or "token" in lower
            or "secret" in lower
            or "key" in lower
        ):
            sanitized[key_str] = REDACTED_PLACEHOLDER
        else:
            sanitized[key_str] = v
    return sanitized


def sanitize_payload(
    payload: Any,
    max_bytes: int = DEFAULT_MAX_BODY_BYTES,
    custom_redact_keys: Optional[List[str]] = None
) -> Any:
    """
    Safely sanitizes and truncates a request/response payload to stay within size bounds.
    """
    if payload is None:
        return None

    # 1. Redact sensitive values first
    redacted = redact_data(payload, custom_redact_keys)

    # 2. Enforce byte length limits
    try:
        if isinstance(redacted, str):
            serialized = redacted
        elif isinstance(redacted, (bytes, bytearray)):
            serialized = redacted.decode("utf-8", errors="replace")
        else:
            serialized = json.dumps(redacted)

        if len(serialized) > max_bytes:
            return {
                "_doomwatch_truncated": True,
                "preview": serialized[:max_bytes],
                "original_bytes": len(serialized),
                "message": (
                    f"Payload truncated because size ({len(serialized)} bytes) "
                    f"exceeded maximum limit ({max_bytes} bytes)"
                )
            }
        return redacted
    except Exception:
        return "[Unserializable Payload]"
