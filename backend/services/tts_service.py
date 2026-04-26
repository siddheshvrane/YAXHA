import asyncio
import logging
from core_bus import bus
import edge_tts
import base64
import re

logger = logging.getLogger("tts-service")
DEFAULT_VOICE = "en-GB-SoniaNeural"

def clean_text_for_tts(text: str) -> str:
    clean = re.sub(r'[*#]', '', text)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

async def synthesize_to_base64(text: str, voice: str = DEFAULT_VOICE) -> str:
    cleaned_text = clean_text_for_tts(text)
    if not cleaned_text:
        return ""
    try:
        communicate = edge_tts.Communicate(cleaned_text, voice)
        audio_data = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])
        return base64.b64encode(audio_data).decode("utf-8")
    except Exception as e:
        logger.error(f"Edge-TTS failed: {e}")
        return ""

async def handle_llm_generated(data: dict):
    """
    Consumes LLM text, requests voice audio from Edge-TTS, 
    and emits the finalized payload to transmit.
    """
    text = data.get("text", "")
    stage = data.get("stage", "Discussion")
    ws_id = data.get("websocket_id")
    
    if not text:
        return
        
    logger.info(f"[Text -> Audio]: Generating TTS for {len(text)} chars...")
    
    # Run synthesis
    audio_b64 = await synthesize_to_base64(text)
    
    # Emit final payload directed strictly to the connected client
    await bus.publish("response_ready_to_transmit", {
        "text": text,
        "stage": stage,
        "audio": audio_b64,
        "type": "response",
        "websocket_id": ws_id
    })
    
bus.subscribe("llm_text_generated", handle_llm_generated)
