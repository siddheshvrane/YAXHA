import os
import logging
import asyncio
import ollama
from core_bus import bus

logger = logging.getLogger("llm-service")

_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
_OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

_client = None
rag_pipeline = None
user_memory = None

def init_llm(rag=None, mem=None):
    """Binds globals and pushes standard initialization + Warmup"""
    global _client, rag_pipeline, user_memory
    rag_pipeline = rag
    user_memory = mem
    try:
        _client = ollama.Client(host=_OLLAMA_HOST)
        _client.list()  # check connection
        logger.info(f"Warmup: Pinging Ollama to load '{_OLLAMA_MODEL}' into VRAM (may take seconds)..")
        # Minimal dummy payload to force memory allocation
        _client.chat(model=_OLLAMA_MODEL, messages=[{"role": "user", "content": "hi"}], options={"num_predict": 1})
        logger.info("Warmup: Ollama LLM is fully loaded and ready.")
    except Exception as e:
        logger.warning(f"Ollama Warmup Failed (is serving?): {e}")
        _client = None

class IELTSExaminer:
    def __init__(self):
        self.stage = "Introduction" 
        self.chat_history = []

        self.system_instructions = (
            "You are Baka, a certified IELTS Speaking Examiner. "
            "Your job is to conduct a realistic IELTS Speaking test perfectly by prioritizing official standards. "
            "Your name is BAKA. Never call yourself Alex or anything else.\n\n"
            "STRICT FORMATTING (CRITICAL):\n"
            "- USE PLAIN TEXT ONLY.\n"
            "- NEVER use bold (**), italics (*), or numbered lists.\n"
            "- When generating Part 2 Cue Cards, you are ALLOWED to use the '•' bullet point character.\n"
            "- NEVER use emojis or special symbols.\n"
            "- Your output must be pure speech-friendly text.\n\n"
            "STRICT TEST MOMENTUM:\n"
            "- After the user answers a question, IMMEDIATELY acknowledge it (briefly) and ask the NEXT question.\n"
            "- Keep the test moving according to the official parts.\n\n"
            "PART 1: Introduction & Interview (4-5 minutes)\n"
            "- Start with the official script: Good morning/afternoon. My name is Baka. Can you please tell me your full name?\n"
            "- Ask 3-4 personal questions about familiar topics.\n\n"
            "PART 2: Cue Card (Long Turn) (3-4 minutes)\n"
            "- Tell them they have one minute to prepare. Then provide the Cue Card topic.\n"
            "- The Cue Card MUST be formatted exactly like this:\n"
            "  TOPIC: [State the topic here]\n"
            "  • [Bullet point 1]\n"
            "  • [Bullet point 2]\n"
            "  • [Bullet point 3]\n"
            "  • [Bullet point 4]\n\n"
            "PART 3: Two-Way Discussion (4-5 minutes)\n"
            "- Transition: We've been talking about [Topic]. I'd like to discuss abstract questions related to this.\n\n"
            "FINAL EVALUATION:\n"
            "- When all parts are done, provide a Band Score (0-9).\n"
            "- Break down the score (Fluency, Lexical, Grammar, Pronunciation) and point out strengths/weaknesses."
        )

    async def generate_response(self, user_text: str, override_stage: str = None):
        global rag_pipeline, user_memory, _client
        if _client is None:
            return {"text": "AI Error: Cannot connect to Ollama.", "stage": "Error", "type": "error"}

        try:
            context_prefix = ""
            if override_stage:
                self.stage = override_stage
                if self.stage == "Introduction":
                    context_prefix = "[SYSTEM] Start Part 1. Introduce yourself as Baka and ask for the candidate's full name."
                elif self.stage == "CueCard":
                    context_prefix = "[SYSTEM] Start Part 2. Give the candidate a Cue Card topic with 4 bullet points as plain sentences."
                elif self.stage == "Discussion":
                    context_prefix = "[SYSTEM] Start Part 3. Ask abstract questions related to the previous Cue Card topic."
                elif self.stage == "Evaluation":
                    context_prefix = "[SYSTEM] The test is complete. Provide the Final Band Score (0-9) with detailed feedback."

            final_user_text = f"{context_prefix}\n{user_text}".strip() if context_prefix else user_text

            _STAGE_HINTS = {
                "Introduction": "IELTS Part 1 intro personal questions",
                "CueCard":      "IELTS Part 2 cue card speaking topic bullet points",
                "Discussion":   "IELTS Part 3 discussion abstract societal",
                "Evaluation":   "IELTS band descriptors grading criteria",
            }
            rag_query = f"{_STAGE_HINTS.get(self.stage, '')} {user_text}".strip()

            retrieved_context = ""
            if rag_pipeline and rag_pipeline.ready:
                chunks = rag_pipeline.retrieve(rag_query, top_k=3)
                retrieved_context = rag_pipeline.format_context(chunks)

            memory_profile = ""
            if user_memory and user_memory.ready and len(self.chat_history) < 4:
                memory_profile = user_memory.retrieve_profile()

            dynamic_system = self.system_instructions + memory_profile + retrieved_context

            messages = [{"role": "system", "content": dynamic_system}] + self.chat_history + [{"role": "user", "content": final_user_text}]

            logger.info(f"Ollama generating response (stage: {self.stage})...")
            response = await asyncio.to_thread(
                _client.chat, model=_OLLAMA_MODEL, messages=messages, options={"temperature": 0.7}
            )
            ai_text = response["message"]["content"]

            if not override_stage:
                upper_text = ai_text.upper()
                if "PART 2" in upper_text or "CUE CARD" in upper_text or "PREPARE" in upper_text:
                    self.stage = "CueCard"
                elif "PART 3" in upper_text or "DISCUSSION" in upper_text:
                    self.stage = "Discussion"
                elif "BAND SCORE" in upper_text or "END OF THE TEST" in upper_text:
                    self.stage = "Evaluation"

            self.chat_history.append({"role": "user", "content": final_user_text})
            self.chat_history.append({"role": "assistant", "content": ai_text})

            if self.stage == "Evaluation" and user_memory and user_memory.ready:
                asyncio.create_task(user_memory.summarize_and_save(self.chat_history))

            return {"text": ai_text, "stage": self.stage, "type": "response"}

        except Exception as e:
            logger.error(f"LLM Error: {e}")
            return {"text": f"SYSTEM ERROR: {e}", "stage": self.stage, "type": "error"}

session_examiner = IELTSExaminer()

async def handle_transcript(data: dict):
    if data.get("is_error"):
        await bus.publish("llm_text_generated", {
            "text": data.get("text", "Error"),
            "stage": session_examiner.stage,
            "websocket_id": data.get("websocket_id")
        })
        return

    text = data.get("text", "")
    override_stage = data.get("override_stage")
    
    if not text and not override_stage:
        return
        
    ws_id = data.get("websocket_id")
    response_obj = await session_examiner.generate_response(text, override_stage=override_stage)
    
    if response_obj:
        response_obj["websocket_id"] = ws_id
        await bus.publish("llm_text_generated", response_obj)

bus.subscribe("transcript_completed", handle_transcript)
bus.subscribe("ui_action_event", handle_transcript)
