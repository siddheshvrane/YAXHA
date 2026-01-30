
from google import genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("No API Key found")
    exit()

try:
    client = genai.Client(api_key=api_key)
    print(f"Checking key: {api_key[:10]}...")
    print("Listing available models:")
    
    for model in client.models.list():
        print(f"Model: {model.name}")
        
except Exception as e:
    print(f"Error listing models: {e}")
