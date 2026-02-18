import os
import logging
import json
import asyncio
import tempfile
import io
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
model_size = "base.en" # Use English-optimized model for speed and accuracy
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
        self.candidate_models = [
            "models/gemini-2.0-flash",
            "models/gemini-2.0-flash-lite",
            "models/gemini-2.5-flash",
            "models/gemini-flash-lite-latest",
            "models/gemini-flash-latest"
        ]
        self.current_model_index = 0
        self.model = self.candidate_models[self.current_model_index]
        
        # System Prompt
        self.system_instructions = """
        You are Baka, a certified IELTS Speaking Examiner. Your job is to conduct a realistic IELTS Speaking test perfectly by prioritizing official standards.
        Your name is BAKA. Never call yourself Alex or anything else.

        PRIORITIZATION & ACCURACY:
        - Always prioritize information tagged as [OFFICIAL SOURCE] in the `backend/knowledge_base/` directory.
        - Reference `backend/knowledge_base/sources.md` for a catalog of legitimate documentation.
        
        STRICT FORMATTING (CRITICAL):
        - USE PLAIN TEXT ONLY.
        - NEVER use bold (**), italics (*), or markdown headers (#).
        - NEVER use bullet points (-) or numbered lists. Use commas and full sentences instead.
        - NEVER use emojis or special symbols.
        - Your output must be pure speech-friendly text.
        
        STRICT TEST MOMENTUM:
        - After the user answers a question, IMMEDIATELY acknowledge it (briefly) and ask the NEXT question.
        - NEVER stop the conversation or wait for the user to prompt you to continue.
        - Keep the test moving according to the official parts.

        STRICT TEST STRUCTURE:
        
        PART 1: Introduction & Interview (4-5 minutes)
        - Start with the official script: "Good morning/afternoon. My name is Baka. Can you please tell me your full name?"
        - Ask 3-4 personal questions about familiar topics (Home, Work, Studies, Hobbies).
        - One question at a time. After they answer, move to the next topic.

        PART 2: Cue Card (Long Turn) (3-4 minutes)
        - Provide a Cue Card topic with 4 bullet points.
        - Use the official transition: "I'd like you to talk about it for one to two minutes. Before you speak, you have one minute to prepare."
        - Provide the topic and bullets immediately.
        - Once they finish their speech, ask 1-2 brief follow-up questions.

        PART 3: Two-Way Discussion (4-5 minutes)
        - Transition using: "We’ve been talking about [Topic]. I’d like to discuss with you one or two more general questions relating to this."
        - Ask abstract, thematic questions. Probe deeper if answers are shallow.

        FINAL EVALUATION:
        - When all parts are done, or if the user requests an evaluation, provide a Band Score (0-9).
        - Break down the score based on: 1. Fluency and Coherence, 2. Lexical Resource, 3. Grammatical Range and Accuracy, 4. Pronunciation.
        - Be objective and point out specific areas for improvement vs. strengths.
        """

    async def generate_response(self, user_text: str, override_stage: str = None):
        if not CLIENT:
            return {"text": "AI Error: Gemini API Key missing or invalid.", "stage": "Error", "type": "error"}

        try:
            # Context management
            context_wrapper = ""
            if override_stage:
                self.stage = override_stage
                if self.stage == "Introduction":
                    context_wrapper = "System: Start Part 1 (Introduction). Introduce yourself as Baka and ask for their full name."
                elif self.stage == "CueCard":
                    context_wrapper = "System: Start Part 2. Give the user a Cue Card topic with 4 bullet points. Tell them they have 1 minute to prep."
                elif self.stage == "Discussion":
                    context_wrapper = "System: Start Part 3 (Discussion). Ask abstract questions related to the previous topic."
                elif self.stage == "Evaluation":
                    context_wrapper = "System: The test is finished. Provide the Final Band Score (0-9) and detailed feedback."
            
            final_user_content = f"{context_wrapper}\nUser: {user_text}" if context_wrapper else user_text
            
            # Add user message to history (don't commit yet in case of retry)
            user_content = types.Content(role="user", parts=[types.Part.from_text(text=final_user_content)])
            
            # Retry logic for quota exhaustion
            for attempt in range(len(self.candidate_models)):
                try:
                    current_model = self.candidate_models[self.current_model_index]
                    logger.info(f"Attempting generation with model: {current_model}")
                    
                    response = await asyncio.to_thread(
                        CLIENT.models.generate_content,
                        model=current_model,
                        contents=self.chat_history + [user_content],
                        config=types.GenerateContentConfig(
                            system_instruction=self.system_instructions,
                            temperature=0.7
                        )
                    )
                    
                    ai_text = response.text
                    
                    # Auto-detect Stage Transitions if not overridden
                    if not override_stage:
                        upper_text = ai_text.upper()
                        # Be more aggressive in detecting Part 2 transition
                        if "PART 2" in upper_text or "CUE CARD" in upper_text or "ONE MINUTE TO PREPARE" in upper_text:
                            self.stage = "CueCard"
                        elif "PART 3" in upper_text or "DISCUSSION" in upper_text or "ONE OR TWO MORE GENERAL QUESTIONS" in upper_text:
                            self.stage = "Discussion"
                        elif "BAND SCORE" in upper_text or "EVALUATION" in upper_text or "THAT IS THE END OF THE TEST" in upper_text:
                            self.stage = "Evaluation"

                    # Success: Commit history
                    self.chat_history.append(user_content)
                    self.chat_history.append(types.Content(role="model", parts=[types.Part.from_text(text=ai_text)]))
                    
                    self.model = current_model # Persist successful model
                    return {
                        "text": ai_text,
                        "stage": self.stage,
                        "type": "response"
                    }
                    
                except Exception as e:
                    error_msg = str(e).upper()
                    if "404" in error_msg or "NOT_FOUND" in error_msg:
                        logger.warning(f"Model {current_model} not found/supported. Skipping...")
                        self.current_model_index = (self.current_model_index + 1) % len(self.candidate_models)
                        continue # Try next model
                    
                    if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                        logger.warning(f"Model {current_model} exhausted. Switching...")
                        self.current_model_index = (self.current_model_index + 1) % len(self.candidate_models)
                        if attempt == len(self.candidate_models) - 1:
                            raise Exception("All available Gemini models have exhausted their quotas for today.")
                        continue # Try next model
                    
                    # For other errors, don't fallback immediately unless specified
                    raise e

        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            return {
                "text": f"SYSTEM ERROR: {str(e)[:100]}", 
                "stage": self.stage, 
                "type": "error"
            }


session_examiner = IELTSExaminer()

# EBML/WebM Header for validation
WEBM_HEADER = b'\x1a\x45\xdf\xa3'

def is_valid_webm(buffer: bytes) -> bool:
    """Checks if the buffer starts with a valid WebM header."""
    return buffer.startswith(WEBM_HEADER)

@app.websocket("/listen")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connected")
    
    # Audio Buffer: Use memory instead of disk for stability on Windows
    audio_buffer = bytearray()
    
    current_transcript = ""
    transcription_lock = asyncio.Lock() # Prevent concurrent transcriptions
    last_preview_time = 0 # Throttle previews

    try:
        while True:
            # Use receive() to handle both bytes (audio) and text (control)
            try:
                message = await websocket.receive()
            except RuntimeError as e:
                if "disconnect message has been received" in str(e):
                    logger.info("WebSocket already disconnected (received disconnect message).")
                    break
                raise e

            if "bytes" in message:
                # Audio Chunk
                data = message["bytes"]
                audio_buffer.extend(data)
                
                # Preview Transcription - Non-blocking, Throttled, and Forced English
                current_time = asyncio.get_event_loop().time()
                if audio_model and not transcription_lock.locked() and (current_time - last_preview_time) > 1.2:
                    # Validate header before trying to transcribe
                    if not is_valid_webm(audio_buffer):
                        logger.warning("Corrupted audio buffer (missing header). Purging...")
                        audio_buffer.clear()
                        continue

                    async with transcription_lock:
                        last_preview_time = current_time
                        try:
                            # Take a thread-safe snapshot
                            snapshot = bytes(audio_buffer)
                            audio_data = io.BytesIO(snapshot)
                            segments, _ = await asyncio.to_thread(
                                audio_model.transcribe, 
                                audio_data, 
                                beam_size=1, 
                                vad_filter=True,
                                language="en"
                            )
                            text = " ".join([s.text for s in segments]).strip()
                            if text:
                                current_transcript = text
                                await websocket.send_text(json.dumps({"text": text, "type": "preview"}))
                        except Exception as e:
                            # Silently ignore transcription errors for previews
                            pass
            
            elif "text" in message:
                # Control Signal
                try:
                    text_data = message["text"]
                    # Try to parse as JSON first
                    try:
                        payload = json.loads(text_data)
                        signal = payload.get("text", "")
                    except json.JSONDecodeError:
                        signal = text_data
                    
                    if signal == "COMMIT":
                        # Final Transcription
                        if not audio_buffer or not is_valid_webm(audio_buffer):
                            logger.warning("Empty or invalid buffer on COMMIT. Skipping transcription.")
                            audio_buffer.clear()
                            continue

                        async with transcription_lock:
                            # Take a safe snapshot before clearing
                            snapshot = bytes(audio_buffer)
                            audio_buffer.clear()
                            audio_data = io.BytesIO(snapshot)
                            
                            try:
                                segments, _ = await asyncio.to_thread(
                                    audio_model.transcribe, 
                                    audio_data, 
                                    beam_size=1, 
                                    vad_filter=True,
                                    language="en"
                                )
                                final_text = " ".join([s.text for s in segments]).strip()
                                current_transcript = ""
                                
                                # Generate AI Response
                                logger.info(f"User said: {final_text}")
                                ai_resp = await session_examiner.generate_response(final_text)
                                
                                # Send back
                                await websocket.send_text(json.dumps({
                                    "text": ai_resp["text"], 
                                    "stage": ai_resp["stage"], 
                                    "type": "response"
                                }))
                            except Exception as e:
                                logger.error(f"COMMIT transcription error: {e}")
                                await websocket.send_text(json.dumps({
                                    "text": "SYSTEM: I couldn't hear that clearly. Could you repeat?", 
                                    "stage": session_examiner.stage,
                                    "type": "response"
                                }))
                    
                    elif signal.startswith("STAGE_CHANGE:"):
                        # Force stage change
                        new_stage = signal.split(":")[1]
                        logger.info(f"Forcing stage: {new_stage}")
                        ai_resp = await session_examiner.generate_response(f"System: Transition to {new_stage}", override_stage=new_stage)
                        await websocket.send_text(json.dumps({
                            "text": ai_resp["text"], 
                            "stage": ai_resp["stage"], 
                            "type": ai_resp["type"]
                        }))
                    
                    elif signal == "START_EXAM":
                        # Triggered by user gesture on frontend
                        logger.info("User started exam. Generating initial greeting...")
                        ai_resp = await session_examiner.generate_response("", override_stage="Introduction")
                        await websocket.send_text(json.dumps({
                            "text": ai_resp["text"], 
                            "stage": ai_resp["stage"], 
                            "type": ai_resp["type"]
                        }))
                except Exception as e:
                    logger.error(f"Error handling text signal: {e}")

    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        audio_buffer.clear()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
