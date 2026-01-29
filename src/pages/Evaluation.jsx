import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import GeminiVisualizer from '../components/GeminiVisualizer';
import craneAgent from '../assets/Crane AI Agent.png';

function Evaluation() {
    const [isSpeaking, setIsSpeaking] = useState(true); // AI is speaking initially
    const [status, setStatus] = useState('Wait'); // 'Wait' or 'Your Turn'
    const [transcription, setTranscription] = useState("AI Agent is asking a question...");

    // ... (rest of the state logic is unchanged)

    // Split audio into frequency bands for wavy effect
    const [audioData, setAudioData] = useState({ low: 0, mid: 0, high: 0 });

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const dataArrayRef = useRef(null);
    const sourceRef = useRef(null);
    const rafIdRef = useRef(null);

    const startAudioAnalysis = async () => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 512; // Higher resolution
            const bufferLength = analyserRef.current.frequencyBinCount;
            dataArrayRef.current = new Uint8Array(bufferLength);

            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            sourceRef.current.connect(analyserRef.current);

            const updateAudioLevel = () => {
                if (analyserRef.current && dataArrayRef.current) {
                    analyserRef.current.getByteFrequencyData(dataArrayRef.current);

                    const length = dataArrayRef.current.length;
                    const lowEnd = Math.floor(length * 0.1);
                    const midEnd = Math.floor(length * 0.4);

                    let lowSum = 0, midSum = 0, highSum = 0;

                    // Lows
                    for (let i = 0; i < lowEnd; i++) lowSum += dataArrayRef.current[i];
                    // Mids
                    for (let i = lowEnd; i < midEnd; i++) midSum += dataArrayRef.current[i];
                    // Highs
                    for (let i = midEnd; i < length; i++) highSum += dataArrayRef.current[i];

                    const lowAvg = lowSum / lowEnd || 0;
                    const midAvg = midSum / (midEnd - lowEnd) || 0;
                    const highAvg = highSum / (length - midEnd) || 0;

                    // Normalize roughly 0-1
                    // OPTIMIZATION: Heavy smoothing (0.9 retention) to prevent "fast frequency" jitter
                    setAudioData(prev => ({
                        low: prev.low * 0.9 + (Math.min(lowAvg / 128, 1.5)) * 0.1,
                        mid: prev.mid * 0.9 + (Math.min(midAvg / 128, 1.5)) * 0.1,
                        high: prev.high * 0.9 + (Math.min(highAvg / 128, 1.5)) * 0.1
                    }));
                }
                rafIdRef.current = requestAnimationFrame(updateAudioLevel);
            };

            updateAudioLevel();

        } catch (err) {
            console.error("Error accessing microphone:", err);
            setTranscription("Error: Could not access microphone. Please check permissions.");
        }
    };

    const stopAudioAnalysis = () => {
        if (rafIdRef.current) {
            cancelAnimationFrame(rafIdRef.current);
        }
        setAudioData({ low: 0, mid: 0, high: 0 });
    };

    useEffect(() => {
        if (!isSpeaking) {
            startAudioAnalysis();
        } else {
            stopAudioAnalysis();
        }

        return () => {
            stopAudioAnalysis();
        };
    }, [isSpeaking]);


    const handleToggle = () => {
        setIsSpeaking(!isSpeaking);
        setStatus(isSpeaking ? 'Your Turn' : 'Wait');
    };

    return (
        <div className="min-h-screen bg-sarus-body flex flex-col items-center justify-between relative overflow-hidden font-sans">

            {/* Navigation / Header */}
            <nav className="absolute top-0 left-0 w-full p-6 flex justify-between items-center px-8 md:px-12 z-20">
                <Link to="/" className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-sarus-text rounded-full"></div>
                    <span className="font-semibold text-sarus-text tracking-wide">YAXHA</span>
                </Link>
            </nav>

            {/* Stage Header */}
            <div className="w-full text-center mt-24 mb-4 z-10">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Stage 1</h3>
                <h1 className="text-xl font-bold text-gray-800 tracking-tight">IELTS Speech Exam</h1>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 w-full max-w-6xl mx-auto flex flex-col items-center justify-start px-4 relative z-10 block-content">

                {/* Question Box with AI Avatar */}
                <div className={`w-full max-w-4xl bg-gray-100/80 rounded-3xl p-6 md:p-10 shadow-sm backdrop-blur-md mb-8 transition-all duration-500 border-2 flex flex-row items-center gap-6 ${isSpeaking ? 'border-sarus-red/50 shadow-[0_0_30px_rgba(220,38,38,0.2)]' : 'border-transparent'}`}>

                    {/* AI Agent Avatar (No circle, Static) */}
                    <div className="shrink-0 relative w-16 h-16 md:w-20 md:h-20 flex items-center justify-center">
                        {/* Crane Image - Static and clean with bottom fade */}
                        <img
                            src={craneAgent}
                            alt="AI Agent"
                            className="w-[140%] h-[140%] max-w-none object-contain drop-shadow-md"
                            style={{
                                maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)',
                                WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)'
                            }}
                        />
                    </div>

                    {/* Question Text */}
                    <h2 className="text-lg md:text-xl font-medium text-evaluate-text leading-relaxed text-left">
                        "Describe a time when you had to help a friend in a difficult situation. What happened and how did you feel?"
                    </h2>
                </div>

                {/* Status Indicator (Repositioned) */}
                <div className="flex flex-col items-center mb-12">
                    <span className={`text-sarus-desc text-lg font-medium tracking-wide transition-colors duration-300 ${isSpeaking ? 'text-sarus-red' : 'text-gray-500'}`}>
                        {status}
                    </span>
                </div>

                {/* Center Recording Button */}
                <div className="relative group cursor-pointer mb-20" onClick={handleToggle}>
                    {!isSpeaking && (
                        <div className="absolute inset-0 rounded-full bg-sarus-red/10 animate-ping duration-[2s]"></div>
                    )}
                    <div className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${!isSpeaking ? 'bg-sarus-red scale-110 shadow-sarus-red/30' : 'bg-white border-4 border-gray-100'}`}>
                        <div className={`w-10 h-10 md:w-14 md:h-14 rounded-full transition-colors duration-300 ${!isSpeaking ? 'bg-white' : 'bg-sarus-red'}`}></div>
                    </div>
                </div>

            </div>

            {/* Gemini Visualizer Container */}
            <div className="absolute bottom-0 left-0 w-full h-[40vh] z-0 overflow-hidden flex items-end">
                <GeminiVisualizer audioData={audioData} isSpeaking={isSpeaking} />

                {/* Transcription Area Overlaid */}
                <div className="absolute bottom-0 w-full z-10 px-8 pb-12 text-center">
                    <p className="text-sarus-desc text-xl md:text-2xl font-light italic opacity-90 leading-relaxed text-shadow-sm">
                        {transcription}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Evaluation;
