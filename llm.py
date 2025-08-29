import os
from openai import OpenAI
from dotenv import load_dotenv
from typing import Dict, List, Optional
load_dotenv()
client = OpenAI()


def call_openai_api(payload: dict) ->str:
    """Send structured payload to OpenAI GPT-5-nano and return assistant text.

    Expected payload shape:
      {
        "query": str,
        "files": [{"path": str, "size": int, "content": str, "truncated": bool}, ...],
        "options": {"allow_pseudocode": bool, "tone": str, "ask_clarifying": bool}
      }
    Returns:
      Assistant response string, or an error string that starts with 'Error'.
    """
    PER_FILE_CHAR_LIMIT = 50000
    MAX_TOTAL_CHARS = 200000
    if not isinstance(payload, dict):
        return 'Error: payload must be a dict.'
    query = payload.get('query')
    if not query or not isinstance(query, str) or not query.strip():
        return "Error: 'query' field is required in payload."
    files = payload.get('files', []) or []
    options = payload.get('options', {}) or {}
    allow_pseudo = bool(options.get('allow_pseudocode', False))
    tone = options.get('tone', 'concise')
    ask_clarifying = bool(options.get('ask_clarifying', True))
    system_prompt = (
        "You are an assistant helping the user understand and debug their codebase. You must not provide runnable code or full file contents. You may provide high-level pseudo-code examples only if options.allow_pseudocode is true, but these must be non-executable and clearly marked as illustrative. Always ask clarifying questions when the user's query is ambiguous. Never output runnable code, do not print full files, and avoid copy-pasteable snippets. When referencing code, use the notation file:path and include line numbers when appropriate. If the user asks for runnable code or full file contents, politely refuse and give actionable steps instead. Micro-excerpts may be wrapped with [SNIPPET_START] and [SNIPPET_END], but these must not be executable."
        )
    user_parts = []
    user_parts.append(
        f'OPTIONS: allow_pseudocode={allow_pseudo} tone={tone} ask_clarifying={ask_clarifying}'
        )
    user_parts.append('USER_QUERY:')
    user_parts.append(str(query))
    user_parts.append('\nFILES:')
    total_chars = 0
    omitted_count = 0
    for f in files:
        try:
            path = f.get('path', '<unknown>')
            size = f.get('size', None)
            content = f.get('content', '') or ''
            client_truncated = bool(f.get('truncated', False))
            server_truncated = False
            if client_truncated:
                if len(content) > PER_FILE_CHAR_LIMIT:
                    content = content[:PER_FILE_CHAR_LIMIT]
                    server_truncated = True
                else:
                    server_truncated = True
            elif len(content) > PER_FILE_CHAR_LIMIT:
                content = content[:PER_FILE_CHAR_LIMIT]
                server_truncated = True
            truncated_flag_final = bool(client_truncated or server_truncated)
            file_block = (
                f"""FILE_START: path={path} size={size} truncated={str(truncated_flag_final).lower()}
CONTENT:
"""
                 + (content if content is not None else '') + '\nFILE_END\n')
            if total_chars + len(file_block) > MAX_TOTAL_CHARS:
                omitted_count += 1
                continue
            user_parts.append(file_block)
            total_chars += len(file_block)
        except Exception:
            omitted_count += 1
            continue
    if omitted_count:
        user_parts.append(
            f'NOTE: {omitted_count} files were omitted from packaged context due to size limits.'
            )
    user_message = '\n\n'.join(user_parts)
    messages = [{'role': 'system', 'content': system_prompt}, {'role':
        'user', 'content': user_message}]
    try:
        response = client.chat.completions.create(messages=messages, model=
            'gpt-5-nano', max_tokens=1500)
    except Exception as e:
        return 'Error occurred while calling OpenAI API: ' + str(e)
    try:
        if not hasattr(response, 'choices') or len(response.choices) == 0:
            return 'Error: Unexpected response format from OpenAI API.'
        choice0 = response.choices[0]
        assistant_text = None
        if getattr(choice0, 'message', None) is not None:
            assistant_text = getattr(choice0.message, 'content', None)
        if not assistant_text:
            assistant_text = getattr(choice0, 'text', None)
        if not assistant_text and isinstance(choice0, dict):
            assistant_text = choice0.get('message', {}).get('content'
                ) or choice0.get('text')
        if not assistant_text:
            return 'Error: Unexpected response format from OpenAI API.'
        return assistant_text
    except Exception as e:
        return 'Error: Unexpected response format from OpenAI API. ' + str(e)

