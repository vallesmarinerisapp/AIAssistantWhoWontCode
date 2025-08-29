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
    if not isinstance(payload, dict):
        return jsonify({'error': 'Error: payload must be a dict.'}), 400
    query = payload.get('query')
    if not query or not isinstance(query, str) or not query.strip():
        return jsonify({'error': "'query' field is required in payload."}), 400
    try:
        result = call_openai_api(payload)
    except Exception as e:
        print('Error calling LLM:', e)
        return jsonify({'error': f'Error calling LLM: {e}'}), 500
    if isinstance(result, str):
        if result.startswith('Error'):
            return jsonify({'error': result}), 500
        return jsonify({'assistant': result})
    if isinstance(result, dict):
        if result.get('error'):
            return jsonify({'error': result.get('error')}), 500
        assistant_text = result.get('assistant') or result.get('text') or ''
        response_payload = {'assistant': assistant_text}
        if 'usage' in result and result.get('usage') is not None:
            response_payload['usage'] = result.get('usage')
        return jsonify(response_payload)
    return jsonify({'error': 'Invalid response from LLM.'}), 500


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')

