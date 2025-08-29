# This file is used for the preview on Code=+AI. It is not needed for your project once you export.
# Please ignore this file for now or modify with great care. Any changes could break your preview.

import os

# ────────────────────────────────────────────────────────────────
# 1) Monkey-patch OpenAI to use an HTTPX client that tacks on the Flask cookie
import openai
import httpx
from flask import request, has_request_context

def _attach_flask_cookie(httpx_request: httpx.Request):
    if has_request_context():
        cookie = request.headers.get("Cookie")
        if cookie:
            httpx_request.headers["Cookie"] = cookie

_orig_openai_init = openai.OpenAI.__init__
def _patched_openai_init(self, *args, http_client=None, **kwargs):
    if http_client is None:
        http_client = httpx.Client(
            event_hooks={"request": [_attach_flask_cookie]}
        )
    return _orig_openai_init(self, *args, http_client=http_client, **kwargs)

openai.OpenAI.__init__ = _patched_openai_init


from app import app

app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Middleware to force SCRIPT_NAME in the WSGI environment so previews load from the correct base path.
class ForceScriptNameMiddleware:
    def __init__(self, app, script_name):
        self.app = app
        self.script_name = script_name.rstrip('/')

    def __call__(self, environ, start_response):
        environ['SCRIPT_NAME'] = self.script_name
        return self.app(environ, start_response)

force_script_name = os.environ.get('FORCE_SCRIPT_NAME', '')
if force_script_name:
    app.wsgi_app = ForceScriptNameMiddleware(app.wsgi_app, force_script_name)

application = app

