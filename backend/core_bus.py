import asyncio
import logging
from typing import Callable, Dict, List

logger = logging.getLogger("event-bus")

class EventBus:
    """
    Central Asynchronous Message Bus for Decoupled Microservices.
    Allows independent layers (Transcription, LLM, TTS) to communicate 
    without blocking one another.
    """
    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_type: str, callback: Callable):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(callback)
        logger.info(f"Subscribed {callback.__name__} to '{event_type}'")

    async def publish(self, event_type: str, data: dict = None):
        if data is None:
            data = {}
            
        if event_type in self._subscribers:
            for callback in self._subscribers[event_type]:
                # Fire and forget concurrent task
                asyncio.create_task(self._safe_call(callback, event_type, data))
                
    async def _safe_call(self, callback: Callable, event_type: str, data: dict):
        try:
            await callback(data)
        except Exception as e:
            logger.error(f"Error in '{event_type}' subscriber '{callback.__name__}': {e}", exc_info=True)

# Global singleton instance
bus = EventBus()
