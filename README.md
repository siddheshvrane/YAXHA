# YAXHA — AI-Powered IELTS Speaking Evaluator

<div align="center">
  <img src="src/assets/Crane Main Page.png" alt="YAXHA Mascot" width="220" />
  <br />
  <h3>Precision Evaluation. Professional Standards.</h3>
  <p>An intelligent, RAG-enhanced IELTS Speaking examiner designed to provide high-fidelity simulations and data-driven feedback.</p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![React](https://img.shields.io/badge/Frontend-React%2019-blue?logo=react)](https://react.dev/)
  [![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green?logo=fastapi)](https://fastapi.tiangolo.com/)
  [![Ollama](https://img.shields.io/badge/AI-Ollama%20Llama%203-blue?logo=ollama)](https://ollama.com/)
</div>

---

## 📖 Overview

**YAXHA** (named after the elegance of the Sarus Crane) is a sophisticated web application that delivers a realistic IELTS Speaking test experience. Leveraging state-of-the-art Generative AI and Retrieval-Augmented Generation (RAG), YAXHA acts as a certified virtual examiner, grading candidates on fluency, lexical resource, grammatical accuracy, and pronunciation using official assessment benchmarks.

## 🚀 Key Features

- **Interactive AI Agent (Baka)**: A specialized examiner persona that maintains strict test momentum and professional decorum.
- **RAG-Enhanced Intelligence**: The system prioritizes official IELTS documentation and examiner handbooks to ensure scoring accuracy and realistic task delivery.
- **Real-time Audio Visualization**: High-performance "Gemini-style" liquid visualizer that reacts dynamically to voice input using the Web Audio API.
- **Full Exam Simulation**: Automated progression through Part 1 (Introduction), Part 2 (Cue Card/Long Turn), and Part 3 (Discussion).
- **Comprehensive Evaluation**: Delivers a final Band Score (0-9) with a detailed breakdown of strengths and areas for improvement.

## 🛠️ Technical Architecture

### Frontend
- **React 19 & Vite**: Ultra-fast, modern reactive UI.
- **Tailwind CSS**: Professional, minimalist aesthetic with responsive design.
- **RxJS**: Reactive state management for real-time audio data streams.
- **Web Audio API**: Low-latency audio processing and canvas-based "liquid" visualization.

### Backend (The AI Engine)
- **FastAPI**: High-performance Python web framework for handling WebSocket-based audio streaming.
- **Event-Driven Microservices**: Decoupled architecture utilizing an internal Service Bus (`core_bus.py`) for routing events between LLM, TTS, and Transcription services.
- **Local AI (Ollama)**: Powers the examiner logic using local Llama 3 models for enhanced privacy and no API costs.
- **Faster-Whisper**: Local, optimized speech-to-text transcription utilizing the CTranslate2 engine for speed and privacy.
- **Knowledge Base (RAG & Memory)**: Local embedding-based Retrieval-Augmented Generation for official IELTS guidebooks and persistent user memory across sessions.

## 📂 Project Structure

```text
YAXHA/
├── backend/                # Python FastAPI Server
│   ├── knowledge_base/     # RAG sources & PDF benchmarks
│   ├── services/           # Decoupled microservices (LLM, TTS, Transcription)
│   ├── core_bus.py         # Internal Event Bus for pub/sub communication
│   ├── rag.py & memory.py  # Context and memory management via embeddings
│   └── server.py           # WebSocket Gateway logic
├── src/                    # React Frontend
│   ├── components/         # UI Elements & Visualizers
│   ├── services/           # Decoupled RxJS API (audio, sockets, examination)
│   └── assets/             # Professional branding & illustrations
└── README.md               # You are here
```

## 🚥 Getting Started

### Prerequisites
- Node.js (v18+)
- Python 3.9+
- Ollama (running locally with `llama3.2` and `nomic-embed-text` models)

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/siddheshvrane/YAXHA.git
   cd YAXHA
   ```

2. **Frontend Setup**
   ```bash
   npm install
   npm run dev
   ```

3. **Ollama Setup**
   Ensure Ollama is installed and run the following commands to pull the necessary models:
   ```bash
   ollama run llama3.2
   ollama pull nomic-embed-text
   ```

4. **Backend Setup**
   ```bash
   cd backend
   pip install -r requirements.txt
   python server.py
   ```

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
<p align="center">
  Built with precision to bridge the gap between practice and success. 🏗️
</p>
