"""
tts.py — Edge-TTS Backend Integration
=====================================
Uses Microsoft Edge Read Aloud API to generate high-quality voice audio 
and transmit it as base64 to the WebSocket.
"""
import edge_tts
import base64
import re
import logging

logger = logging.getLogger("tts-service")

# en-GB-SoniaNeural (Female, British) is great for IELTS.
# Other options: en-GB-RyanNeural (Male), en-US-AriaNeural
DEFAULT_VOICE = "en-GB-SoniaNeural"

def clean_text_for_tts(text: str) -> str:
    """Removes markdown and special characters that would sound weird if read out loud."""
    # Remove asterisks and hashes
    clean = re.sub(r'[*#]', '', text)
    # Collapse whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

async def synthesize_to_base64(text: str, voice: str = DEFAULT_VOICE) -> str:
    """
    Synthesize text to speech asynchronously and return base64 mp3 string.
    """
    cleaned_text = clean_text_for_tts(text)
    if not cleaned_text:
        return ""
        
    try:
        communicate = edge_tts.Communicate(cleaned_text, voice)
        audio_data = bytearray()
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])
                
        # Return as Base64 encoded MP3 string
        return base64.b64encode(audio_data).decode("utf-8")
        
    except Exception as e:
        logger.error(f"Edge-TTS synthesis failed: {e}")
        return ""
