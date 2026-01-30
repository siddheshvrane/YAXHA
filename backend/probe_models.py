import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("No API Key found")
    exit()

genai.configure(api_key=api_key)

print("Listing available models to models_list.txt...")
try:
    with open("backend/models_list.txt", "w") as f:
        for m in genai.list_models():
            f.write(f"Model: {m.name}\n")
            f.write(f"Methods: {m.supported_generation_methods}\n")
            f.write("-" * 20 + "\n")
    print("Done.")
except Exception as e:
    print(f"Error listing models: {e}")
