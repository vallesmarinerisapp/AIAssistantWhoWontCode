from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from llm import call_openai_api
app = Flask(__name__)
app.config['SESSION_COOKIE_NAME'
    ] = 'e5a665bd5e6bf4b497ccf1ab927b35b8bc26862a9b43fb6dcbb2e46707fa8699'
app.config['SECRET_KEY'
    ] = 'bbc64d1b6bc4cfafb8fc5e62c8e5d1ea257dc2e8ede25b0ddca9cac3c0e1c57a'
CORS(app)


@app.route('/api/query', methods=['POST'])
def api_query():
    """API endpoint to accept structured payload from frontend and forward to the LLM.
    Expected JSON payload:
      {
        "query": str,
        "files": [{"path": str, "size": int, "content": str, "truncated": bool}, ...],
        "options": {"allow_pseudocode": bool, "tone": str}
      }
    """
    try:
        payload = request.get_json(force=True)
    except Exception as e:
        return jsonify({'error': f'Invalid JSON payload: {e}'}), 400
    if not payload or not payload.get('query'):
        return jsonify({'error': "'query' field is required in payload."}), 400
    try:
        assistant_text = call_openai_api(payload)
    except Exception as e:
        print('Error calling LLM:', e)
        return jsonify({'error': f'Error calling LLM: {e}'}), 500
    if isinstance(assistant_text, dict) and assistant_text.get('error'):
        return jsonify({'error': assistant_text.get('error')}), 500
    if isinstance(assistant_text, str) and assistant_text.startswith('Error'):
        return jsonify({'error': assistant_text}), 500
    return jsonify({'assistant': assistant_text})


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')

