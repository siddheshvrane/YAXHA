import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import GeminiVisualizer from '../components/GeminiVisualizer';
import craneAgent from '../assets/Crane AI Agent.png';

function Evaluation() {
    // --- State ---
    const [stage, setStage] = useState('Introduction'); // Introduction, CueCard, Discussion, Evaluation
    const [status, setStatus] = useState('Wait'); // 'Wait', 'Your Turn', 'Prep', 'Speaking'
    const [isSpeaking, setIsSpeaking] = useState(false); // User is recording

    // Content state
    const [aiQuestion, setAiQuestion] = useState("Connecting to IELTS Examiner...");
    const [userTranscript, setUserTranscript] = useState("");

    // Timers for Part 2
    const [prepTimeLeft, setPrepTimeLeft] = useState(60); // 1 minute
    const [recordTimeLeft, setRecordTimeLeft] = useState(120); // 2 minutes
    const [isPrepActive, setIsPrepActive] = useState(false);
    const [isRecordTimerActive, setIsRecordTimerActive] = useState(false);

    // Audio Visualizer State
    const [audioData, setAudioData] = useState({ low: 0, mid: 0, high: 0 });

    // Refs
    const websocketRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const dataArrayRef = useRef(null);
    const sourceRef = useRef(null);
    const rafIdRef = useRef(null);

    // --- WebSocket Connection ---
    useEffect(() => {
        let timeoutId;
        const connectWrapper = () => {
            // Connect to WebSocket
            const ws = new WebSocket("ws://localhost:8000/listen");
            websocketRef.current = ws;

            ws.onopen = () => {
                console.log("WebSocket Connected");
                setAiQuestion("Connected. Waiting for Examiner...");
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'response') {
                        // AI Response (Question or Feedback)
                        setAiQuestion(data.text);
                        setStage(data.stage);

                        // Logic based on Stage
                        if (data.stage === 'CueCard') {
                            startCueCardPhase();
                        } else if (data.stage === 'Evaluation') {
                            setStatus('Exam Finished');
                            setIsSpeaking(false);
                        } else {
                            // Standard Turn: Ready for User
                            setStatus('Your Turn');
                            // Optional: Auto-start recording? keeping it manual for Intro/Discussion is safer for UX.
                        }
                    } else if (data.type === 'preview') {
                        // Live user transcript
                        setUserTranscript(data.text);
                    }
                } catch (e) {
                    console.error("Error parsing WS message:", e);
                    // Fallback for raw text if any
                    setAiQuestion(event.data);
                }
            };

            ws.onerror = (error) => {
                console.error("WebSocket Error:", error);
                setAiQuestion("Connection Error. Is the backend running?");
            };

            ws.onclose = () => {
                console.log("WebSocket Disconnected");
            };
        };

        // Delay connection slightly to avoid Strict Mode double-mount issues
        timeoutId = setTimeout(connectWrapper, 100);

        return () => {
            clearTimeout(timeoutId);
            if (websocketRef.current) {
                websocketRef.current.close();
                websocketRef.current = null;
            }
        };
    }, []);

    // --- Part 2 Timers ---

    const startCueCardPhase = () => {
        setStatus('Prep Time');
        setIsPrepActive(true);
        setPrepTimeLeft(60);
    };

    useEffect(() => {
        let interval = null;
        if (isPrepActive && prepTimeLeft > 0) {
            interval = setInterval(() => {
                setPrepTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (isPrepActive && prepTimeLeft === 0) {
            // Prep Finished -> Start Recording
            setIsPrepActive(false);
            startRecordingTurn(); // Auto start recording
            setIsRecordTimerActive(true);
            setRecordTimeLeft(120);
            setStatus('Speaking Time');
        }
        return () => clearInterval(interval);
    }, [isPrepActive, prepTimeLeft]);

    useEffect(() => {
        let interval = null;
        if (isRecordTimerActive && recordTimeLeft > 0) {
            interval = setInterval(() => {
                setRecordTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (isRecordTimerActive && recordTimeLeft === 0) {
            // Time's up -> Stop Recording and Transition
            setIsRecordTimerActive(false);
            stopRecordingTurn(true); // Force stop and sending stage change
        }
        return () => clearInterval(interval);
    }, [isRecordTimerActive, recordTimeLeft]);


    // --- Audio Logic ---

    const startRecordingTurn = async () => {
        if (isSpeaking) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            // Start Visualizer
            startAudioAnalysis(stream);

            // Start Recorder
            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0 && websocketRef.current?.readyState === WebSocket.OPEN) {
                    // Send binary audio
                    websocketRef.current.send(event.data);
                }
            };

            mediaRecorderRef.current.start(250); // Send chunks frequently
            setIsSpeaking(true);
            setStatus('Recording...');
            setUserTranscript(""); // Clear previous

        } catch (err) {
            console.error("Error accessing mic:", err);
            setStatus("Mic Error");
        }
    };

    const stopRecordingTurn = (forceNextStage = false) => {
        if (!isSpeaking && !forceNextStage) return; // Allow forcing if timer ends

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        // Stop Visualizer
        stopAudioAnalysis();

        // Stop Tracks
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        setIsSpeaking(false);
        setStatus('Wait');

        // Send Commit Signal
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
            if (forceNextStage) {
                // Determine next stage
                if (stage === 'CueCard') {
                    websocketRef.current.send(JSON.stringify({ text: "STAGE_CHANGE:Discussion" })); // Transition to Part 3
                } else {
                    websocketRef.current.send(JSON.stringify({ text: "COMMIT" }));
                }
            } else {
                websocketRef.current.send(JSON.stringify({ text: "COMMIT" }));
            }
        }
    };

    const handleToggle = () => {
        if (stage === 'Evaluation') return;
        if (isPrepActive) return; // Can't start during prep manually (optional, maybe allow skip?)

        if (isSpeaking) {
            stopRecordingTurn();
        } else {
            startRecordingTurn();
        }
    };

    // --- Helpers ---
    const startAudioAnalysis = (stream) => {
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();

        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);

        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);

        const update = () => {
            if (analyserRef.current) {
                analyserRef.current.getByteFrequencyData(dataArrayRef.current);
                // Calculate simple averages for low/mid/high
                const length = dataArrayRef.current.length;
                const lowAvg = dataArrayRef.current.slice(0, Math.floor(length * 0.1)).reduce((a, b) => a + b, 0) / (length * 0.1) || 0;
                const midAvg = dataArrayRef.current.slice(Math.floor(length * 0.1), Math.floor(length * 0.5)).reduce((a, b) => a + b, 0) / (length * 0.4) || 0;
                const highAvg = dataArrayRef.current.slice(Math.floor(length * 0.5)).reduce((a, b) => a + b, 0) / (length * 0.5) || 0;

                setAudioData({
                    low: lowAvg / 255,
                    mid: midAvg / 255,
                    high: highAvg / 255
                });
            }
            rafIdRef.current = requestAnimationFrame(update);
        };
        update();
    };

    const stopAudioAnalysis = () => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        setAudioData({ low: 0, mid: 0, high: 0 });
    };

    // --- Render ---

    // Format Phase Name
    const getStageName = () => {
        switch (stage) {
            case 'Introduction': return 'Stage 1: Introduction';
            case 'CueCard': return 'Stage 2: Cue Card';
            case 'Discussion': return 'Stage 3: Discussion';
            case 'Evaluation': return 'Final Evaluation';
            default: return 'IELTS Exam';
        }
    };

    return (
        <div className="min-h-screen bg-sarus-body flex flex-col items-center justify-between relative overflow-hidden font-sans">

            {/* Header */}
            <nav className="absolute top-0 left-0 w-full p-6 flex justify-between items-center px-8 md:px-12 z-20">
                <Link to="/" className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-sarus-text rounded-full"></div>
                    <span className="font-semibold text-sarus-text tracking-wide">YAXHA</span>
                </Link>
                <div className="text-sm font-semibold text-gray-500 uppercase tracking-widest">{getStageName()}</div>
            </nav>

            {/* Main Content */}
            <div className="flex-1 w-full max-w-6xl mx-auto flex flex-col items-center justify-center px-4 relative z-10 block-content pt-20">

                {/* Question / Response Card */}
                <div className={`w-full max-w-4xl bg-gray-100/90 rounded-3xl p-8 md:p-12 shadow-sm backdrop-blur-md mb-8 transition-all duration-500 border-2 flex flex-col md:flex-row items-center gap-8 ${isSpeaking ? 'border-sarus-red/50 shadow-[0_0_30px_rgba(220,38,38,0.2)]' : 'border-transparent'}`}>

                    {/* Avatar */}
                    <div className="shrink-0 relative w-20 h-20 md:w-24 md:h-24 flex items-center justify-center">
                        <img src={craneAgent} alt="AI Agent" className="w-[140%] h-[140%] max-w-none object-contain drop-shadow-md"
                            style={{ maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 w-full text-left">
                        {stage === 'CueCard' ? (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Your Topic</h3>
                                <div className="text-lg md:text-xl font-medium text-evaluate-text leading-relaxed whitespace-pre-wrap">
                                    {aiQuestion}
                                </div>
                                <div className="flex gap-4 pt-4">
                                    {isPrepActive && <div className="text-sm font-bold text-orange-500 uppercase animate-pulse">Prep Time: {prepTimeLeft}s</div>}
                                    {isRecordTimerActive && <div className="text-sm font-bold text-red-500 uppercase animate-pulse">Speaking Time: {recordTimeLeft}s</div>}
                                </div>
                            </div>
                        ) : (
                            <h2 className="text-lg md:text-xl font-medium text-evaluate-text leading-relaxed whitespace-pre-wrap">
                                {aiQuestion}
                            </h2>
                        )}
                    </div>
                </div>

                {/* Interaction Area */}
                <div className="flex flex-col items-center mb-8">
                    <span className={`text-sarus-desc text-lg font-medium tracking-wide transition-colors duration-300 mb-6 ${isSpeaking ? 'text-sarus-red' : 'text-gray-500'}`}>
                        {status}
                    </span>

                    {/* Record Button */}
                    {stage !== 'Evaluation' && (
                        <div className="relative group cursor-pointer" onClick={handleToggle}>
                            {!isSpeaking && status === 'Your Turn' && (
                                <div className="absolute inset-0 rounded-full bg-sarus-red/10 animate-ping duration-[2s]"></div>
                            )}
                            <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${isSpeaking ? 'bg-white border-4 border-gray-100 scale-100' : 'bg-sarus-red scale-110 shadow-sarus-red/30'}`}>
                                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full transition-colors duration-300 ${isSpeaking ? 'bg-sarus-red animate-pulse' : 'bg-white'}`}></div>
                            </div>
                        </div>
                    )}
                </div>

            </div>

            {/* Visualizer & Transcript */}
            <div className="absolute bottom-0 left-0 w-full h-[30vh] z-0 overflow-hidden flex items-end pointer-events-none">
                <GeminiVisualizer audioData={audioData} isSpeaking={isSpeaking} />

                <div className="absolute bottom-0 w-full z-10 px-8 pb-8 text-center">
                    <p className="text-sarus-desc text-lg md:text-xl font-light italic opacity-80 leading-relaxed text-shadow-sm max-w-4xl mx-auto">
                        {userTranscript || (isSpeaking ? "Listening..." : "")}
                    </p>
                </div>
            </div>

        </div>
    );
}

export default Evaluation;
