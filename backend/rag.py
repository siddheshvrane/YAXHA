"""
rag.py — Hybrid RAG Pipeline for YAXHA IELTS Speaking Examiner
================================================================
Architecture:
  1. Parse: .md (header-aware hierarchical) + .pdf (paragraph-level)
  2. Chunk: Hierarchical — Parent chunks (sections) + Child chunks (sentences)
  3. Embed: nomic-embed-text via Ollama (local, no API key)
  4. Store: ChromaDB persistent local collection (child chunks with embeddings)
  5. Retrieve: BM25 (sparse) + ChromaDB (dense) fused via Reciprocal Rank Fusion
  6. Expand: Retrieved child chunks are expanded to their full parent section
  7. Inject: Formatted context block is appended to the Ollama system prompt
"""

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger("rag-pipeline")


# ---------------------------------------------------------------------------
# RAGPipeline
# ---------------------------------------------------------------------------

class RAGPipeline:
    def __init__(self, kb_path: str, ollama_client, embedding_model: str = "nomic-embed-text"):
        self.kb_path = Path(kb_path)
        self.client = ollama_client
        self.embed_model = embedding_model
        self.chroma_dir = Path(__file__).parent / "chroma_db"

        # State — populated during _initialize()
        self.collection = None       # ChromaDB collection (dense index)
        self.all_chunks: list = []   # all parent + child chunks
        self.child_chunks: list = [] # child-only list (for BM25)
        self.bm25 = None
        self.ready = False

        self._initialize()

    # -----------------------------------------------------------------------
    # Initialization
    # -----------------------------------------------------------------------

    def _initialize(self):
        """Load or build the full RAG index."""
        # Check hard dependencies
        try:
            import chromadb
            from rank_bm25 import BM25Okapi  # noqa: F401
        except ImportError as err:
            logger.error(
                f"RAG dependencies missing ({err}). "
                "Run: pip install chromadb rank-bm25 pypdf"
            )
            return

        # Test embedding model availability
        vector_ok = self._check_embedding_model()

        # Persist ChromaDB beside this file
        import chromadb as _chromadb
        chroma_client = _chromadb.PersistentClient(path=str(self.chroma_dir))
        self.collection = chroma_client.get_or_create_collection(
            name="ielts_kb",
            metadata={"hnsw:space": "cosine"},
        )

        chunks_file = self.chroma_dir / "chunks.json"
        already_indexed = self.collection.count() > 0 and chunks_file.exists()

        if already_indexed:
            logger.info(
                f"Loading existing RAG index ({self.collection.count()} vectors)…"
            )
            with open(chunks_file, encoding="utf-8") as f:
                self.all_chunks = json.load(f)
        else:
            logger.info("Building RAG index from knowledge base (first run)…")
            self._build_index(embed=vector_ok)

        self._build_bm25()
        self.ready = True
        mode = "hybrid (BM25 + vector)" if vector_ok else "BM25-only (embed model unavailable)"
        logger.info(f"RAG pipeline ready — mode: {mode} | chunks: {len(self.child_chunks)}")

    def _check_embedding_model(self) -> bool:
        """Return True if the embedding model responds correctly."""
        try:
            self.client.embeddings(model=self.embed_model, prompt="test")
            return True
        except Exception as e:
            logger.warning(
                f"Embedding model '{self.embed_model}' unreachable: {e}\n"
                "  → Run: ollama pull nomic-embed-text\n"
                "  → Falling back to BM25-only retrieval for this session."
            )
            return False

    # -----------------------------------------------------------------------
    # Document Parsing — Hierarchical Chunking
    # -----------------------------------------------------------------------

    def _parse_all_documents(self) -> list:
        chunks = []
        for fp in sorted(self.kb_path.iterdir()):
            try:
                if fp.suffix == ".md":
                    text = fp.read_text(encoding="utf-8", errors="ignore")
                    chunks.extend(self._chunk_markdown(fp, text))
                elif fp.suffix == ".pdf":
                    chunks.extend(self._chunk_pdf(fp))
                else:
                    continue
                logger.info(f"  Parsed: {fp.name}")
            except Exception as e:
                logger.warning(f"  Skipped {fp.name}: {e}")
        return chunks

    def _chunk_markdown(self, filepath: Path, content: str) -> list:
        """
        Hierarchical chunking for structured markdown:
          Parent  = entire ## section (or # section if no ##)
          Children = individual sentences / bullet items within the section
        """
        chunks = []
        # Split on level-1 or level-2 headers, keeping the delimiter
        sections = re.split(r"(?m)^(?=#{1,2} )", content)

        for section in sections:
            section = section.strip()
            if not section:
                continue

            hm = re.match(r"^(#{1,2}) (.+)", section)
            header = hm.group(2).strip() if hm else filepath.stem
            parent_id = f"{filepath.stem}__{self._safe_id(header)}"

            # Parent = full section text (used for context expansion)
            chunks.append({
                "id": parent_id,
                "text": section,
                "source": filepath.name,
                "header": header,
                "type": "parent",
            })

            # Children = sub-sentences / bullet points
            body = re.sub(r"^#{1,2} .+\n?", "", section, count=1).strip()
            for i, sub in enumerate(self._sub_split(body, max_chars=350)):
                chunks.append({
                    "id": f"{parent_id}__c{i}",
                    "text": f"{header}: {sub}",
                    "source": filepath.name,
                    "header": header,
                    "type": "child",
                    "parent_id": parent_id,
                })

        return chunks

    def _chunk_pdf(self, filepath: Path) -> list:
        """
        Hierarchical chunking for PDFs:
          Parent  = paragraph (double-newline separated, ≥80 chars)
          Children = sentence-level sub-chunks within the paragraph
        """
        try:
            import pypdf
        except ImportError:
            logger.warning(f"pypdf not installed — skipping {filepath.name}")
            return []

        try:
            reader = pypdf.PdfReader(str(filepath))
            full_text = "\n".join(p.extract_text() or "" for p in reader.pages)
        except Exception as e:
            logger.warning(f"PDF read error ({filepath.name}): {e}")
            return []

        # Clean noisy PDF whitespace
        full_text = re.sub(r"\n{3,}", "\n\n", full_text)
        full_text = re.sub(r"[ \t]{2,}", " ", full_text)

        paragraphs = [p.strip() for p in full_text.split("\n\n") if len(p.strip()) > 80]

        chunks = []
        for i, para in enumerate(paragraphs):
            parent_id = f"{filepath.stem}__p{i}"
            chunks.append({
                "id": parent_id,
                "text": para,
                "source": filepath.name,
                "header": filepath.stem,
                "type": "parent",
            })
            for j, sub in enumerate(self._sub_split(para, max_chars=300)):
                chunks.append({
                    "id": f"{parent_id}__c{j}",
                    "text": sub,
                    "source": filepath.name,
                    "header": filepath.stem,
                    "type": "child",
                    "parent_id": parent_id,
                })

        return chunks

    def _sub_split(self, text: str, max_chars: int = 300) -> list:
        """
        Split text into sub-chunks ≤ max_chars, breaking on:
          • sentence endings (.!?)
          • markdown bullet lines (- / *)
        Returns only non-trivial chunks (len > 20 chars).
        """
        # Split on sentence endings or bullet markers
        parts = re.split(r"(?<=[.!?])\s+|(?m)^\s*[-*]\s+", text)
        result, current = [], ""
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if len(current) + len(part) + 1 <= max_chars:
                current = f"{current} {part}".strip()
            else:
                if current:
                    result.append(current)
                current = part
        if current:
            result.append(current)
        return [c for c in result if len(c) > 20]

    # -----------------------------------------------------------------------
    # Embedding
    # -----------------------------------------------------------------------

    def _embed(self, text: str) -> list:
        resp = self.client.embeddings(model=self.embed_model, prompt=text)
        return resp["embedding"]

    # -----------------------------------------------------------------------
    # Index Construction
    # -----------------------------------------------------------------------

    def _build_index(self, embed: bool = True):
        """Parse all KB documents, embed child chunks, persist to ChromaDB + disk."""
        self.all_chunks = self._parse_all_documents()
        self.chroma_dir.mkdir(exist_ok=True)

        child_chunks = [c for c in self.all_chunks if c["type"] == "child"]
        logger.info(f"Total chunks: {len(self.all_chunks)} | Child chunks to embed: {len(child_chunks)}")

        if embed:
            ids, embeddings, docs, metas = [], [], [], []
            for idx, chunk in enumerate(child_chunks):
                try:
                    emb = self._embed(chunk["text"])
                    ids.append(chunk["id"])
                    embeddings.append(emb)
                    docs.append(chunk["text"])
                    metas.append({
                        "source": chunk["source"],
                        "header": chunk["header"],
                        "parent_id": chunk.get("parent_id", ""),
                    })
                    if (idx + 1) % 20 == 0:
                        logger.info(f"  Embedded {idx + 1}/{len(child_chunks)} chunks…")
                except Exception as e:
                    logger.warning(f"  Embedding skipped for {chunk['id']}: {e}")

            if ids:
                # ChromaDB add in one batch
                self.collection.add(
                    ids=ids,
                    embeddings=embeddings,
                    documents=docs,
                    metadatas=metas,
                )
                logger.info(f"  → {len(ids)} vectors stored in ChromaDB.")

        # Persist chunk metadata so BM25 can be rebuilt on future restarts
        with open(self.chroma_dir / "chunks.json", "w", encoding="utf-8") as f:
            json.dump(self.all_chunks, f, ensure_ascii=False)

        logger.info("Index build complete.")

    def _build_bm25(self):
        """Build in-memory BM25 index from child chunks."""
        from rank_bm25 import BM25Okapi
        self.child_chunks = [c for c in self.all_chunks if c["type"] == "child"]
        if not self.child_chunks:
            logger.warning("No child chunks found. BM25 index will not be built.")
            self.bm25 = None
            return
        tokenized = [c["text"].lower().split() for c in self.child_chunks]
        self.bm25 = BM25Okapi(tokenized)
        logger.info(f"BM25 index built: {len(self.child_chunks)} child chunks.")

    # -----------------------------------------------------------------------
    # Retrieval — Hybrid BM25 + Vector with RRF + Parent Expansion
    # -----------------------------------------------------------------------

    def retrieve(self, query: str, top_k: int = 3) -> list:
        """
        Returns up to `top_k` parent-chunk dicts:
          {"text": str, "source": str, "header": str}

        Pipeline:
          1. BM25 sparse search  → top-10 child chunks ranked
          2. ChromaDB dense search → top-10 child chunks ranked (if available)
          3. Reciprocal Rank Fusion → unified ranking
          4. Expand each top child to its parent section
          5. Deduplicate by parent_id, return top_k
        """
        if not self.ready or not query.strip():
            return []

        rrf_scores: dict = {}
        K = 60  # RRF constant (higher K = less steep rank penalty)

        # --- BM25 ---
        if self.bm25 is not None:
            tokens = query.lower().split()
            bm25_raw = self.bm25.get_scores(tokens)
            bm25_top = sorted(range(len(bm25_raw)), key=lambda i: bm25_raw[i], reverse=True)[:10]
            for rank, idx in enumerate(bm25_top):
                cid = self.child_chunks[idx]["id"]
                rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (K + rank + 1)

        # --- Vector (ChromaDB) ---
        if self.collection and self.collection.count() > 0:
            try:
                q_emb = self._embed(query)
                n = min(10, self.collection.count())
                res = self.collection.query(query_embeddings=[q_emb], n_results=n)
                for rank, vid in enumerate(res["ids"][0]):
                    rrf_scores[vid] = rrf_scores.get(vid, 0.0) + 1.0 / (K + rank + 1)
            except Exception as e:
                logger.debug(f"Vector search fallback to BM25-only: {e}")

        # --- RRF Sort ---
        top_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)[: top_k * 3]

        # --- Parent Expansion ---
        parent_lookup = {c["id"]: c for c in self.all_chunks if c["type"] == "parent"}
        child_lookup = {c["id"]: c for c in self.child_chunks}

        seen_parents: set = set()
        results: list = []
        for cid in top_ids:
            child = child_lookup.get(cid)
            if not child:
                continue
            pid = child.get("parent_id")
            if pid in seen_parents:
                continue
            seen_parents.add(pid)
            parent = parent_lookup.get(pid)
            if parent:
                results.append({
                    "text": parent["text"],
                    "source": parent["source"],
                    "header": parent["header"],
                })
            if len(results) >= top_k:
                break

        return results

    # -----------------------------------------------------------------------
    # Prompt Formatting
    # -----------------------------------------------------------------------

    def format_context(self, chunks: list) -> str:
        """Format retrieved parent chunks as a prompt-injectable context block."""
        if not chunks:
            return ""
        lines = [
            "\n\n[RETRIEVED KNOWLEDGE BASE CONTEXT — treat as authoritative reference]"
        ]
        for i, chunk in enumerate(chunks, 1):
            lines.append(
                f"\n--- Source {i}: {chunk['source']} | Section: {chunk['header']} ---\n"
                f"{chunk['text']}"
            )
        lines.append("\n[END OF RETRIEVED CONTEXT]\n")
        return "\n".join(lines)

    # -----------------------------------------------------------------------
    # Utility
    # -----------------------------------------------------------------------

    @staticmethod
    def _safe_id(text: str) -> str:
        return re.sub(r"[^a-z0-9_]", "_", text.lower())[:60]
