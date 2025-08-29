Live demo: https://assistant.codeplusequalsai.com/

This was made with [Code+=AI](https://codeplusequalsai.com) in about 30 minutes. It is a prototype of a helpful AI assistant who will lead you to your answer rather than giving you code directly.

# AI Code Assistant who won't write code

A lightweight, local Flask webapp that helps you explore and reason about your codebase. The app uses the browser File System Access API so the assistant can read selected files or folders for context. The assistant is strictly prevented from returning runnable code or full file contents; it will provide high-level guidance and, if explicitly allowed in the UI, non-executable pseudo-code examples for illustration only.

## Key features

- Local file and folder selection using the browser File System Access API  
- Include/exclude controls per file and an in-app per-file preview with truncation indicators  
- Session-only chat (conversation state lives in memory and is cleared on refresh)  
- Uses OpenAI GPT-5-nano via the server-side wrapper (llm.py); requires an OpenAI API key to be provided locally  
- Privacy-first behavior: files are read in your browser and are not stored on the server; only the packaged context you choose to send is forwarded to the model

## Prerequisites

- Python 3.10 or newer installed on your machine  
- A Chromium-based browser (Chrome, Edge, or similar) for best support of the File System Access API; the API requires a secure context (localhost is OK)

## Local setup (high-level)

1. Create and activate a Python virtual environment appropriate for your operating system.  
2. Install the Python dependencies listed in requirements.txt using pip.  
3. Create a local .env file at the project root and provide your OpenAI API key in it under the environment variable name OPENAI_API_KEY.  
4. Run the Flask application (the entry point in this project is the server script) and open a Chromium-based browser to the local URL (default: http://localhost:5000).  
5. In the browser UI, use the left-panel controls to open a folder or select files, then interact with the chat in the center panel.

Note: these steps assume you are comfortable with basic Python development workflows and virtual environments. The project is intentionally designed to run locally and keep user files on the client side.

## Environment variables and configuration

- The server-side OpenAI client reads the OpenAI API key from the environment (or from a .env file using python-dotenv). Provide your key as OPENAI_API_KEY.  
- The model name is set to `gpt-5-nano` in llm.py. If you need to change the model, edit llm.py and update the model identifier accordingly.

## Usage and limitations

- Open a folder to let the app enumerate files. By default, common large or sensitive folders such as .git, node_modules, dist, and build are auto-excluded (this behavior can be toggled in the UI).  
- Include or exclude individual files using the checkboxes in the file list. Clicking a file opens a read-only preview in the right pane.  
- Files are read on demand into the browser and packaged into delimited blocks for the assistant. By default, server-side trimming will enforce a per-file limit of roughly 50,000 characters; this prevents enormous messages and conserves tokens. If many files are included and the aggregate context exceeds the model/message-size cap, some files may be omitted and you will see a note that files were omitted.  
- The assistant will not produce runnable code or full file dumps. It can provide high-level pseudo-code only if you enable that option in the UI. If you request runnable code, the assistant will politely refuse and offer actionable steps and guidance instead.

## Privacy & security

- Files you select are read locally in your browser. The server does not store the raw files. Only the packaged context you elect to send is forwarded to OpenAI when you submit a query.  
- Avoid including secrets such as credentials, private keys, or unencrypted .env files in the selected context. The app auto-excludes many common sensitive paths by default, but please double-check selections before sending.  
- If you need to ensure no sensitive data is transmitted, do not include those files in the selected set or remove them from disk prior to querying.

## Developer notes

Key files and their responsibilities:
- app.py: Flask server and the POST /api/query endpoint that forwards structured payloads to the LLM wrapper  
- llm.py: OpenAI API wrapper: builds the system and user prompts, packages file blocks, applies server-side trimming and aggregate caps, calls GPT-5-nano, and returns assistant text or descriptive error strings  
- templates/index.html: main UI shell delivered by Flask  
- static/scripts.js: front-end integration for File System Access API, file selection, preview, and chat flows  
- static/styles.css: site styling and responsive layout  
- requirements.txt: pinned Python dependencies

Manual testing checklist:
- Start the server and open the app in a Chromium-based browser.  
- Use the left panel to open a folder and inspect the discovered file list.  
- Include a few source files and preview them in the right pane.  
- Send a simple, non-ambiguous query about the code base and confirm the assistant responds without providing runnable code.  
- Test the "Allow pseudo-code" toggle to verify the assistant may include illustrative pseudo-code only when enabled.

If you need to change server-side limits:
- In llm.py you can adjust PER_FILE_CHAR_LIMIT (per-file character trimming) and MAX_TOTAL_CHARS (aggregate cap for packaged context) to tune how much context is forwarded to the model.

## Troubleshooting

- If you see an error about an unsupported parameter related to tokens (for example, an "Unsupported parameter: max_tokens" message), the llm.py code already attempts to use the model-appropriate token parameter and contains a fallback path. See llm.py's OpenAI call logic which prefers model-compatible parameters and retries without an unsupported token argument.  
- Browser compatibility: the File System Access API is best supported in Chromium-based browsers. For reference and compatibility details, consult the File System Access API documentation on MDN or your preferred browser documentation. If your browser does not support the API, you will not be able to choose local folders; in that case, try Chrome or Edge on a secure context such as localhost.

## Contributing & license

Contributions, issues, and pull requests are welcome! If you plan to contribute:
- Open an issue first to discuss larger changes or to propose features.  
- Use branches and submit pull requests against the repository's main branch.
