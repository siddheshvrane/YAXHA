# YAXHA — AI-Powered IELTS Speaking Evaluator

<div align="center">
  <img src="src/assets/Crane Main Page.png" alt="YAXHA Mascot" width="220" />
  <br />
  <h3>Precision Evaluation. Professional Standards.</h3>
  <p>An intelligent, RAG-enhanced IELTS Speaking examiner designed to provide high-fidelity simulations and data-driven feedback.</p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![React](https://img.shields.io/badge/Frontend-React%2019-blue?logo=react)](https://react.dev/)
  [![FastAPI](https://img.shields.io/badge/Backend-FastAPI-green?logo=fastapi)](https://fastapi.tiangolo.com/)
  [![Gemini](https://img.shields.io/badge/AI-Gemini%202.0%20Flash-red?logo=googlegemini)](https://deepmind.google/technologies/gemini/)
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
- **Gemini 2.0 Flash**: Powers the examiner logic with high intelligence and extremely low latency.
- **Faster-Whisper**: Local, optimized speech-to-text transcription utilizing the CTranslate2 engine for speed and privacy.
- **Knowledge Base (RAG)**: A curated repository of official IELTS guidebooks, band descriptors, and recent question sets (2024-2025).

## 📂 Project Structure

```text
YAXHA/
├── backend/                # Python FastAPI Server
│   ├── knowledge_base/     # RAG sources & PDF benchmarks
│   └── server.py           # AI integration & WebSocket logic
├── src/                    # React Frontend
│   ├── components/         # UI Elements & Visualizers
│   ├── services/           # API & Audio streaming logic
│   └── assets/             # Professional branding & illustrations
└── README.md               # You are here
```

## 🚥 Getting Started

### Prerequisites
- Node.js (v18+)
- Python 3.9+
- Gemini API Key

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

3. **Backend Setup**
   ```bash
   cd backend
   pip install -r requirements.txt
   python server.py
   ```

4. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
<p align="center">
  Built with precision to bridge the gap between practice and success. 🏗️
</p>
