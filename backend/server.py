import os
import logging
import json
import asyncio
import tempfile
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper-server")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
CLIENT = None

if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY not found in environment variables. Please set it for AI features.")
else:
    try:
        CLIENT = genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        logger.error(f"Failed to initialize Gemini Client: {e}")

# Load Faster Whisper Model
model_size = "base"
logger.info(f"Loading Faster Whisper model: {model_size}...")
try:
    audio_model = WhisperModel(model_size, device="cpu", compute_type="int8")
    logger.info("Whisper model loaded successfully!")
except Exception as e:
    logger.error(f"Error loading Whisper model: {e}")
    audio_model = None

# --- IELTS Examiner Agent ---

class IELTSExaminer:
    def __init__(self):
        self.stage = "Introduction"  # Introduction, CueCard, Discussion, Evaluation
        self.chat_history = []
        self.model = "gemini-flash-latest"
        
        # System Prompt
        self.system_instructions = """
        You are a certified IELTS Speaking Examiner. Your job is to conduct a realistic IELTS Speaking test.
        The test has 3 parts. You must strictly follow this structure:

        PART 1: Introduction & Interview (4-5 minutes)
        - Ask 3-4 personal questions about home, work, studies, or hobbies.
        - Ask one question at a time. Wait for the user's answer.
        - Keep questions simple and direct.

        PART 2: Cue Card (Individual Long Turn) (3-4 minutes)
        - Give the candidate a specific topic (Cue Card) with 4 bullet points to cover.
        - Tell them: "I will give you a topic and I'd like you to talk about it for one to two minutes. Before you talk, you have one minute to think about what you are going to say."
        - Provide the topic immediately.
        - IMPORTANT: AFTER you give the topic, DO NOT ask more questions. The user will simulate the 1-minute prep and 2-minute speech on their end.
        - Wait for their long speech.

        PART 3: Two-Way Discussion (4-5 minutes)
        - Ask abstract, thematic questions based on the Part 2 topic.
        - Explore longer, more complex answers. 

        EVALUATION:
        - After Part 3 is done, provide a Band Score (0-9) based on the official 4 criteria:
            1. Fluency and Coherence
            2. Lexical Resource
            3. Grammatical Range and Accuracy
            4. Pronunciation
        - Provide a brief breakdown for each.
        """

    async def generate_response(self, user_text: str, override_stage: str = None):
        if not CLIENT:
            return {"text": "AI Error: Gemini API Key missing or invalid.", "stage": "Error"}

        try:
            # Context management
            context_wrapper = ""
            if override_stage:
                self.stage = override_stage
                if self.stage == "Introduction":
                    context_wrapper = "System: Start Part 1 (Introduction). Ask the first personal question."
                elif self.stage == "CueCard":
                    context_wrapper = "System: Start Part 2. Give the user a Cue Card topic with 4 bullet points. Tell them they have 1 minute to prep."
                elif self.stage == "Discussion":
                    context_wrapper = "System: Start Part 3 (Discussion). Ask abstract questions related to the previous topic."
                elif self.stage == "Evaluation":
                    context_wrapper = "System: The test is finished. Provide the Final Band Score (0-9) and detailed feedback."
            
            final_user_content = f"{context_wrapper}\nUser: {user_text}" if context_wrapper else user_text
            
            # Add user message to history
            self.chat_history.append(types.Content(role="user", parts=[types.Part.from_text(text=final_user_content)]))
            
            # Call Gemini API
            response = await asyncio.to_thread(
                CLIENT.models.generate_content,
                model=self.model,
                contents=self.chat_history,
                config=types.GenerateContentConfig(
                    system_instruction=self.system_instructions,
                    temperature=0.7
                )
            )
            
            ai_text = response.text
             
            # Add model response to history
            self.chat_history.append(types.Content(role="model", parts=[types.Part.from_text(text=ai_text)]))

            return {
                "text": ai_text,
                "stage": self.stage
            }

        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            return {"text": "I'm having trouble connecting to the brain. Please check your API key.", "stage": self.stage}


examiner = IELTSExaminer()

@app.websocket("/listen")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connected")
    
    session_examiner = IELTSExaminer()
    
    # Initial Greeting
    resp = await session_examiner.generate_response("", override_stage="Introduction")
    await websocket.send_text(json.dumps(resp))
    
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".webm")
    temp_file.close()
    
    current_transcript = ""

    try:
        while True:
            # Use receive() to handle both bytes (audio) and text (control)
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio Chunk
                data = message["bytes"]
                with open(temp_file.name, "ab") as f:
                    f.write(data)
                
                # Preview Transcription
                if audio_model:
                     segments, _ = audio_model.transcribe(temp_file.name, beam_size=1, vad_filter=True)
                     text = " ".join([s.text for s in segments]).strip()
                     if text:
                         current_transcript = text
                         await websocket.send_text(json.dumps({"text": text, "type": "preview"}))
            
            elif "text" in message:
                # Control Signal
                text_data = message["text"]
                if text_data == "COMMIT":
                    # User finished speaking.
                    final_text = current_transcript
                    # Wipe file for next turn
                    open(temp_file.name, 'w').close() 
                    current_transcript = ""
                    
                    # Generate AI Response
                    logger.info(f"User said: {final_text}")
                    ai_resp = await session_examiner.generate_response(final_text)
                    
                    # Send back
                    await websocket.send_text(json.dumps({"text": ai_resp["text"], "stage": ai_resp["stage"], "type": "response"}))
                
                elif text_data.startswith("STAGE_CHANGE:"):
                    # Force stage change
                    new_stage = text_data.split(":")[1]
                    logger.info(f"Forcing stage: {new_stage}")
                    ai_resp = await session_examiner.generate_response(f"System: Transition to {new_stage}", override_stage=new_stage)
                    await websocket.send_text(json.dumps({"text": ai_resp["text"], "stage": ai_resp["stage"], "type": "response"}))

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        if os.path.exists(temp_file.name):
            os.remove(temp_file.name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
