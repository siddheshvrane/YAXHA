"""
memory.py — Long-Term Semantic Memory for YAXHA
=================================================
Architecture:
  1. Extractor: Uses Ollama to read chat history and output specific feedback.
  2. Embedder: Uses nomic-embed-text via Ollama.
  3. Store: ChromaDB 'user_memory' collection.
  4. Retriever: Fetches past weaknesses/strengths to inject into the Examiner prompt.
"""

import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime
import uuid

logger = logging.getLogger("memory-pipeline")

class UserMemory:
    def __init__(self, ollama_client, embed_model: str = "nomic-embed-text", chat_model: str = "llama3.2"):
        self.client = ollama_client
        self.embed_model = embed_model
        self.chat_model = chat_model
        
        # We store memory in the same chroma_db folder as the RAG, but in a separate collection.
        self.chroma_dir = Path(__file__).parent / "chroma_db"
        self.collection = None
        self.ready = False
        
        self._initialize()

    def _initialize(self):
        try:
            import chromadb
            chroma_client = chromadb.PersistentClient(path=str(self.chroma_dir))
            # Store user memory. Currently a single-user MVP.
            self.collection = chroma_client.get_or_create_collection(
                name="user_memory",
                metadata={"hnsw:space": "cosine"},
            )
            self.ready = True
            logger.info(f"UserMemory initialized. Historic entries: {self.collection.count()}")
        except Exception as e:
            logger.error(f"Failed to initialize UserMemory: {e}")

    # -----------------------------------------------------------------------
    # Retrieval
    # -----------------------------------------------------------------------
            
    def retrieve_profile(self) -> str:
        """
        Retrieves the past historical profile of the candidate.
        For MVP, we fetch the 3 most recent session summaries.
        """
        if not self.ready or self.collection.count() == 0:
            return ""
            
        try:
            # We want recent memories. Since Chroma doesn't inherently sort by time easily without filters,
            # we can just fetch top K by a dummy search or if we had a chronological index.
            # A simple approach: embed a prompt like "candidate strengths and weaknesses band score progress"
            query = "candidate strengths weaknesses band score"
            q_emb = self.client.embeddings(model=self.embed_model, prompt=query)["embedding"]
            
            res = self.collection.query(
                query_embeddings=[q_emb],
                n_results=min(3, self.collection.count())
            )
            
            if not res["documents"] or not res["documents"][0]:
                return ""
                
            summaries = res["documents"][0]
            metadatas = res["metadatas"][0]
            
            profile_lines = ["\n\n[LONG-TERM CANDIDATE MEMORY]"]
            profile_lines.append("You have tested this candidate before. Use this context to personalize your phrasing (e.g. 'Welcome back... Let's see if your fluency has improved since last time.').")
            
            for idx, summary in enumerate(summaries):
                date_str = metadatas[idx].get("date", "Unknown Date")
                profile_lines.append(f"--- Past Session ({date_str}) ---\n{summary}")
                
            profile_lines.append("[END LONG-TERM MEMORY]\n")
            return "\n".join(profile_lines)
            
        except Exception as e:
            logger.warning(f"Error retrieving memory profile: {e}")
            return ""

    # -----------------------------------------------------------------------
    # Summarization & Save
    # -----------------------------------------------------------------------

    async def summarize_and_save(self, chat_history: list):
        """
        Instructs the LLM to analyze the completed session transcript, 
        extract key insights, embed them, and save them to the DB.
        This runs asynchronously in the background so it doesn't block the UI.
        """
        if not self.ready:
            return
            
        if len(chat_history) < 6:
            logger.info("Session too short to summarize.")
            return

        logger.info("Starting background memory summarization...")
        
        # Build transcript string
        transcript = []
        for msg in chat_history:
            role = msg.get("role", "unknown")
            if role == "system":
                continue
            content = msg.get("content", "")
            transcript.append(f"{role.upper()}: {content}")
        
        transcript_text = "\n".join(transcript)
        
        # Summarization prompt
        sys_prompt = (
            "You are an AI Memory Summarizer for an IELTS coaching system. "
            "Analyze the following transcript of an IELTS mock speaking test. "
            "Extract a very concise, plain-text summary covering exactly 3 things:\n"
            "1. The final Band Score awarded.\n"
            "2. Specific Weaknesses (e.g. grammar errors, lack of collocations, hesitations).\n"
            "3. Specific Strengths.\n"
            "Provide the output as brief bullet points using dashes (-). Do not include pleasantries."
        )
        
        try:
            response = await asyncio.to_thread(
                self.client.chat,
                model=self.chat_model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": transcript_text[-4000:]} # Pass last ~4k chars to keep context light
                ],
                options={"temperature": 0.2}
            )
            
            summary = response["message"]["content"].strip()
            
            # Save to Chroma
            emb = await asyncio.to_thread(
                self.client.embeddings,
                model=self.embed_model,
                prompt=summary
            )
            
            doc_id = str(uuid.uuid4())
            date_str = datetime.now().strftime("%Y-%m-%d %H:%M")
            
            await asyncio.to_thread(
                self.collection.add,
                ids=[doc_id],
                embeddings=[emb["embedding"]],
                documents=[summary],
                metadatas=[{"date": date_str, "type": "session_summary"}]
            )
            
            logger.info(f"Memory successfully embedded and saved! (ID: {doc_id})")
            
        except Exception as e:
            logger.error(f"Memory summarization failed: {e}")
