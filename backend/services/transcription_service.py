import asyncio
import io
import logging
from core_bus import bus

logger = logging.getLogger("transcription-service")

try:
    from faster_whisper import WhisperModel
    WHISPER_AVAILABLE = True
except ImportError:
    logger.warning("faster_whisper not installed.")
    WHISPER_AVAILABLE = False

audio_model = None

def init_transcriber():
    """Loads the Whisper model into RAM for zero-latency inference."""
    global audio_model
    if WHISPER_AVAILABLE and audio_model is None:
        logger.info("Warmup: Loading Whisper model...")
        audio_model = WhisperModel("base", device="cpu", compute_type="default")
        logger.info("Warmup: Whisper ready.")

async def handle_audio_received(data: dict):
    """
    Consumes raw audio bytes, runs Whisper, and emits the transcript.
    """
    if not WHISPER_AVAILABLE:
        logger.error("Whisper unavailable. Cannot transcribe.")
        await bus.publish("transcript_completed", {
            "text": "I couldn't hear that because Whisper is missing.", 
            "websocket_id": data.get("websocket_id"),
            "is_error": True
        })
        return

    buffer_bytes = data.get("audio_bytes", b"")
    ws_id = data.get("websocket_id")
    
    if not buffer_bytes:
        logger.warning("Empty buffer received.")
        return

    if not buffer_bytes.startswith(b'\x1aE\xdf\xa3'):
        logger.warning("Received audio chunk is NOT valid WebM. Transcriber might struggle without headers.")
    
    try:
        audio_data = io.BytesIO(buffer_bytes)
        segments, _ = await asyncio.to_thread(
            audio_model.transcribe, 
            audio_data, 
            beam_size=5, 
            vad_filter=True,
            language="en"
        )
        final_text = " ".join([s.text for s in segments]).strip()
        logger.info(f"[Audio -> Text]: '{final_text}'")
        
        # Pass to the next phase
        await bus.publish("transcript_completed", {
            "text": final_text,
            "websocket_id": ws_id
        })
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        await bus.publish("transcript_completed", {
            "text": "System: Audio processing failed. Could you repeat?",
            "websocket_id": ws_id,
            "is_error": True
        })

# Register with Event Bus
bus.subscribe("audio_received", handle_audio_received)
