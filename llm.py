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
        "options": {"allow_pseudocode": bool, "tone": str}
      }
    """
    MAX_TOTAL_CHARS = 200000
    PER_FILE_CHAR_LIMIT = 50000
    if not isinstance(payload, dict):
        return 'Error: payload must be a dict.'
    query = payload.get('query')
    if not query:
        return "Error: 'query' field is required in payload."
    files = payload.get('files', []) or []
    options = payload.get('options', {}) or {}
    allow_pseudo = bool(options.get('allow_pseudocode', False))
    tone = options.get('tone', 'concise')
    system_prompt = (
        "You are an assistant helping the user understand and debug their codebase. You must not provide runnable code or full file contents. You may provide high-level pseudo-code examples only if options.allow_pseudocode is true, but these must be non-executable and illustrative only. Always ask clarifying questions when the user's query is ambiguous. When referencing code, use the notation file:path and include line numbers when appropriate. Do NOT reproduce large amounts of code or full files. Provide high-level guidance, references to files and function names, and short non-executable snippets only when necessary. If the user asks for runnable code or full file contents, refuse and suggest how to proceed."
        )
    user_parts = []
    user_parts.append(f'OPTIONS: allow_pseudocode={allow_pseudo} tone={tone}')
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
            truncated_flag = bool(f.get('truncated', False))
            if len(content) > PER_FILE_CHAR_LIMIT:
                content = content[:PER_FILE_CHAR_LIMIT]
                truncated_flag = True
            file_block = (
                f"""FILE_START: path={path} size={size} truncated={str(truncated_flag).lower()}
CONTENT:
"""
                 + content + '\nFILE_END\n')
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
            f'NOTE: {omitted_count} files were omitted from the packaged context due to size limits.'
            )
    user_message = '\n\n'.join(user_parts)
    try:
        response = client.chat.completions.create(messages=[{'role':
            'system', 'content': system_prompt}, {'role': 'user', 'content':
            user_message}], model='gpt-5-nano')
    except Exception as e:
        return 'Error occurred while calling OpenAI API: ' + str(e)
    try:
        return response.choices[0].message.content
    except Exception:
        try:
            return response.choices[0].text
        except Exception:
            return 'Error: Unexpected response format from OpenAI API.'

