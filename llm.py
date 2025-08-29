import os
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()
client = OpenAI()


def call_openai_api(prompt):
    try:
        response = client.chat.completions.create(messages=[{'role': 'user',
            'content': prompt}], model='gpt-5-mini')
    except Exception as e:
        error_message = 'Error occurred: ' + str(e)
        return error_message
    return response.choices[0].message.content


