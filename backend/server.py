import os
import logging
import json
import asyncio
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# --- Architecture ---
from core_bus import bus
from rag import RAGPipeline
from memory import UserMemory

# Initialize services (this registers all EventBus subscriptions)
import services.transcription_service as t_service
import services.llm_service as llm_service
import services.tts_service as tts_service 

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api-gateway")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Background Initialization & Model Warmup
# ---------------------------------------------------------------------------
rag: RAGPipeline | None = None
user_mem: UserMemory | None = None

@app.on_event("startup")
async def _startup_services():
    global rag, user_mem
    logger.info("Gateway Boot: Pre-loading dependencies in background...")
    
    # Pre-warm transcriber models
    t_service.init_transcriber()
    
    # Init RAG & Memory
    import ollama
    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
    embed_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    kb_path = str(__import__('pathlib').Path(__file__).parent / "knowledge_base")
    
    try:
        _client = ollama.Client(host=OLLAMA_HOST)
        _client.list()
        rag = await asyncio.to_thread(RAGPipeline, kb_path, _client, embed_model)
        user_mem = await asyncio.to_thread(UserMemory, _client, embed_model, OLLAMA_MODEL)
    except Exception as e:
        logger.error(f"Failed to load RAG/Memory vectors: {e}")
        
    # Pre-warm LLM model to eliminate "First Start" delays
    llm_service.init_llm(rag=rag, mem=user_mem)

# ---------------------------------------------------------------------------
# WebSocket Gateway Routers
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    def connect(self, ws_id: str, websocket: WebSocket):
        self.active_connections[ws_id] = websocket

    def disconnect(self, ws_id: str):
        if ws_id in self.active_connections:
            del self.active_connections[ws_id]

    async def send_to(self, ws_id: str, payload: dict):
        if ws_id in self.active_connections:
            try:
                await self.active_connections[ws_id].send_text(json.dumps(payload))
            except Exception as e:
                logger.error(f"WebSocket send error to {ws_id}: {e}")

manager = ConnectionManager()

# Subscribe Gateway to the Service Bus to route finished data back to UI
async def route_llm_response(data: dict):
    await manager.send_to(data.get("websocket_id"), {
        "text": data.get("text"),
        "stage": data.get("stage"),
        "type": data.get("type", "response"),
        "audio": data.get("audio")
    })

async def route_transcript_preview(data: dict):
    # Only route preview text (not errors or stage changes)
    if "is_error" not in data and "override_stage" not in data:
        await manager.send_to(data.get("websocket_id"), {
            "text": data.get("text"),
            "type": "preview"
        })

bus.subscribe("response_ready_to_transmit", route_llm_response)
bus.subscribe("transcript_completed", route_transcript_preview)


@app.websocket("/listen")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    ws_id = str(uuid.uuid4())
    manager.connect(ws_id, websocket)
    logger.info(f"WebSocket Client Connected [{ws_id}]")
    
    # We maintain a bytearray for incoming chunks
    audio_buffer = bytearray()
    
    try:
        while True:
            message = await websocket.receive()
            
            # 1. Routing Audio Bytes -> Transcription Service
            if message.get("bytes"):
                audio_buffer.extend(message["bytes"])
                
            # 2. Routing Text Signals -> LLM Service
            elif message.get("text"):
                try:
                    text_data = message["text"]
                    payload = json.loads(text_data) if text_data.startswith("{") else {"text": text_data}
                    signal = payload.get("text", "")
                    
                    if signal == "COMMIT":
                        # Push the finalized WebM audio chunk to the Transcriber Bus
                        await bus.publish("audio_received", {
                            "websocket_id": ws_id,
                            "audio_bytes": bytes(audio_buffer)
                        })
                        audio_buffer.clear()
                        
                    elif signal.startswith("STAGE_CHANGE:"):
                        new_stage = signal.split(":")[1]
                        await bus.publish("ui_action_event", {
                            "websocket_id": ws_id,
                            "override_stage": new_stage,
                            "text": f"System: Transition to {new_stage}"
                        })
                        
                    elif signal == "START_EXAM":
                        await bus.publish("ui_action_event", {
                            "websocket_id": ws_id,
                            "override_stage": "Introduction",
                            "text": "User started the test."
                        })
                        
                except Exception as e:
                    logger.error(f"Event routing error: {e}")
                    
    except WebSocketDisconnect:
        manager.disconnect(ws_id)
        logger.info(f"WebSocket Client Disconnected [{ws_id}]")
    except Exception as e:
        manager.disconnect(ws_id)
        logger.error(f"Endpoint Error: {e}")
    finally:
        audio_buffer.clear()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
