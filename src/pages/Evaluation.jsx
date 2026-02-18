import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import GeminiVisualizer from '../components/GeminiVisualizer';
import ErrorOverlay from '../components/ErrorOverlay';
import craneAgent from '../assets/Crane AI Agent.png';
import { examineeService } from '../services/examineeService';

function Evaluation() {
    // --- State ---
    const [stage, setStage] = useState('Introduction'); // Introduction, CueCard, Discussion, Evaluation
    const [status, setStatus] = useState('Wait'); // 'Wait', 'Your Turn', 'Prep', 'Speaking'
    const [isSpeaking, setIsSpeaking] = useState(false); // User is recording
    const [isAiSpeaking, setIsAiSpeaking] = useState(false); // AI is speaking
    const [testStarted, setTestStarted] = useState(false); // User clicked 'Start'
    const [error, setError] = useState(null); // Quota or system errors
    const [cueCardWaiting, setCueCardWaiting] = useState(false); // Transition state for Part 2

    // Content state
    const [aiQuestion, setAiQuestion] = useState("Connecting to IELTS Examiner...");
    const [userTranscript, setUserTranscript] = useState("");

    // Timers for Part 2
    const [prepTimeLeft, setPrepTimeLeft] = useState(60); // 1 minute
    const [speakingSeconds, setSpeakingSeconds] = useState(0); // Count up
    const [isPrepActive, setIsPrepActive] = useState(false);
    const [isRecordTimerActive, setIsRecordTimerActive] = useState(false);

    // Refs
    const websocketRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const dataArrayRef = useRef(null);
    const sourceRef = useRef(null);
    const rafIdRef = useRef(null);

    // --- RxJS Subscriptions ---
    useEffect(() => {
        const subs = [
            examineeService.status$.subscribe(setStatus),
            examineeService.aiResponse$.subscribe(resp => {
                if (resp.type === 'response') {
                    setAiQuestion(resp.text);
                    setStage(resp.stage);
                    if (resp.stage === 'CueCard') startCueCardPhase();
                    else if (resp.stage === 'Evaluation') setStatus('Exam Finished');
                    else setStatus('Your Turn');
                } else if (resp.type === 'error') {
                    setError(resp.text);
                }
            }),
            examineeService.userTranscript$.subscribe(setUserTranscript),
            examineeService.audioData$.subscribe(data => {
                // This component doesn't need to store audioData locally anymore,
                // but it subscribes to ensure the service is active.
                // The GeminiVisualizer will subscribe directly.
            }),
            examineeService.isAiSpeaking$.subscribe(setIsAiSpeaking)
        ];

        return () => subs.forEach(s => s.unsubscribe());
    }, []);

    // --- WebSocket Connection ---
    useEffect(() => {
        let timeoutId;
        const connectWrapper = () => {
            const ws = new WebSocket("ws://localhost:8000/listen");
            websocketRef.current = ws;

            ws.onopen = () => {
                console.log("WebSocket Connected");
                setAiQuestion("Connected. Waiting for Examiner...");
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'preview') {
                        examineeService.updateTranscript(data.text);
                    } else {
                        examineeService.emitResponse(data);
                    }
                } catch (e) {
                    console.error("WS parse error:", e);
                }
            };
            ws.onerror = () => setAiQuestion("Connection Error. Is the backend running?");
        };
        timeoutId = setTimeout(connectWrapper, 100);
        return () => {
            clearTimeout(timeoutId);
            if (websocketRef.current) websocketRef.current.close();
        };
    }, []);

    // --- Part 2 Timers ---

    const startCueCardPhase = () => {
        setCueCardWaiting(true);
    };

    // Effect to trigger Part 2 Prep only after AI stops talking
    useEffect(() => {
        if (stage === 'CueCard' && cueCardWaiting && !isAiSpeaking) {
            setStatus('Prep Time');
            setIsPrepActive(true);
            setPrepTimeLeft(60);
            setCueCardWaiting(false);
        }
    }, [isAiSpeaking, stage, cueCardWaiting]);

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
        if (isRecordTimerActive) {
            interval = setInterval(() => {
                setSpeakingSeconds(prev => prev + 1);
            }, 1000);
        }

        // Hard stop at 3 minutes (180 seconds)
        if (speakingSeconds >= 180) {
            setIsRecordTimerActive(false);
            stopRecordingTurn(true);
        }

        return () => clearInterval(interval);
    }, [isRecordTimerActive, speakingSeconds]);

    // Dynamic Status for Part 2 Speaking
    useEffect(() => {
        if (stage === 'CueCard' && isSpeaking) {
            if (isPrepActive) {
                setStatus(`Preparing... ${prepTimeLeft}s`);
            } else if (speakingSeconds < 120) {
                const mins = Math.floor(speakingSeconds / 60);
                const secs = speakingSeconds % 60;
                setStatus(`Speaking (Min 2:00) - ${mins}:${secs < 10 ? '0' : ''}${secs}`);
            } else {
                const mins = Math.floor(speakingSeconds / 60);
                const secs = speakingSeconds % 60;
                setStatus(`Speaking (Max 3:00) - ${mins}:${secs < 10 ? '0' : ''}${secs} - You can stop now.`);
            }
        }
    }, [speakingSeconds, stage, isSpeaking, isPrepActive, prepTimeLeft]);


    // --- Audio Logic ---

    const startRecordingTurn = async () => {
        if (isSpeaking) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            startAudioAnalysis(stream);

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0 && websocketRef.current?.readyState === WebSocket.OPEN) {
                    websocketRef.current.send(event.data);
                }
            };

            // Synchronization logic: Send COMMIT only AFTER the last chunk is sent
            mediaRecorderRef.current.onstop = () => {
                if (websocketRef.current?.readyState === WebSocket.OPEN) {
                    // Critical: COMMIT must be sent AFTER dataavailable has fired for the last time
                    setTimeout(() => {
                        websocketRef.current.send(JSON.stringify({ text: "COMMIT" }));
                    }, 50);
                }
            };

            mediaRecorderRef.current.start(250);
            setIsSpeaking(true);

            if (stage === 'CueCard') {
                setIsRecordTimerActive(true);
                setSpeakingSeconds(0);
            } else {
                examineeService.setStatus('Recording...');
            }
            examineeService.updateTranscript("");

        } catch (err) {
            console.error("Mic error:", err);
            examineeService.setStatus("Mic Error");
        }
    };

    const stopRecordingTurn = (forceNextStage = false) => {
        if (!isSpeaking && !forceNextStage) return;

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        stopAudioAnalysis();
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        setIsSpeaking(false);
        examineeService.setStatus('Wait');

        // Logic for forced transitions (timers)
        if (forceNextStage && websocketRef.current?.readyState === WebSocket.OPEN) {
            if (stage === 'CueCard') {
                websocketRef.current.send(JSON.stringify({ text: "STAGE_CHANGE:Discussion" }));
            }
        }
    };

    const handleToggle = () => {
        if (stage === 'Evaluation') return;
        if (isPrepActive) return;

        if (isSpeaking) {
            // Part 2 constraints: Cannot stop before 2 minutes
            if (stage === 'CueCard' && speakingSeconds < 120) {
                alert("Please continue speaking. You need to talk for at least 2 minutes for Part 2.");
                return;
            }
            stopRecordingTurn();
        } else {
            startRecordingTurn();
        }
    };

    const handleStartExam = () => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
            setTestStarted(true);
            websocketRef.current.send(JSON.stringify({ text: "START_EXAM" }));
            // Unlock speech synthesis by playing an empty utterance
            examineeService.unlockSpeechSynthesis();
        } else {
            setAiQuestion("Still connecting... please wait.");
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

                // Update service's audio stream
                examineeService.updateAudioData({
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
        examineeService.updateAudioData({ low: 0, mid: 0, high: 0 }); // Reset audio data in service
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
                <div className={`w-full max-w-4xl bg-gray-100/90 rounded-3xl p-8 md:p-12 shadow-sm backdrop-blur-md mb-8 transition-all duration-500 border-2 flex flex-col md:flex-row items-start gap-8 ${isSpeaking ? 'border-sarus-red/50 shadow-[0_0_30px_rgba(220,38,38,0.2)]' : 'border-transparent'}`}>

                    {/* Avatar */}
                    <div className={`shrink-0 relative w-20 h-20 md:w-24 md:h-24 flex items-center justify-center transition-all duration-500 ${isAiSpeaking ? 'scale-110 drop-shadow-[0_0_15px_rgba(220,38,38,0.4)]' : ''}`}>
                        <img src={craneAgent} alt="AI Agent" className="w-[140%] h-[140%] max-w-none object-contain drop-shadow-md"
                            style={{ maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }} />
                        {isAiSpeaking && (
                            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-red-600/10 to-transparent blur-xl -z-10 animate-pulse"></div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 w-full text-left max-h-[30vh] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-gray-300">
                        {stage === 'CueCard' ? (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Your Topic</h3>
                                <div className="text-lg md:text-xl font-medium text-evaluate-text leading-relaxed whitespace-pre-wrap">
                                    {aiQuestion}
                                </div>
                                <div className="flex gap-4 pt-4 border-t border-gray-200 mt-4">
                                    {isPrepActive ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 bg-sarus-red rounded-full animate-ping"></div>
                                            <div className="text-sm font-bold text-sarus-red uppercase tracking-wider">Preparation: {prepTimeLeft}s</div>
                                        </div>
                                    ) : isSpeaking ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
                                            <div className="text-sm font-bold text-red-600 uppercase tracking-wider">
                                                Speaking: {Math.floor(speakingSeconds / 60)}:{(speakingSeconds % 60).toString().padStart(2, '0')}
                                                {speakingSeconds < 120 ? " (Minimum 2:00)" : " (Optional up to 3:00)"}
                                            </div>
                                        </div>
                                    ) : null}
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
                    <span className={`text-sarus-desc text-lg font-medium tracking-wide transition-colors duration-300 mb-6 ${isSpeaking ? 'text-sarus-red' : isAiSpeaking ? 'text-orange-500' : 'text-gray-500'}`}>
                        {isAiSpeaking ? 'Examiner is speaking...' : status}
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
            <div className="absolute bottom-0 left-0 w-full h-[35vh] z-0 overflow-hidden flex flex-col items-center justify-end pointer-events-none">
                <div className="w-full h-full absolute inset-0">
                    <GeminiVisualizer />
                </div>

                <div className="relative w-full z-10 px-8 pb-12 text-center pointer-events-auto">
                    <div className="max-w-4xl mx-auto max-h-[20vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-400">
                        <p className="text-sarus-desc text-lg md:text-xl font-light italic opacity-80 leading-relaxed text-shadow-sm">
                            {userTranscript || (isSpeaking ? "Listening..." : "")}
                        </p>
                    </div>
                </div>
            </div>

            {/* Error Overlay */}
            {error && (
                <ErrorOverlay
                    message={error}
                    onRetry={() => setError(null)}
                />
            )}

            {/* Start Overlay */}
            {!testStarted && !error && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#f8f9fa] transition-all duration-700">
                    <div className="flex flex-col items-center animate-in zoom-in-95 duration-700">
                        <div className="w-32 h-32 md:w-40 md:h-40 mb-10 relative">
                            <img src={craneAgent} alt="AI Agent" className="w-full h-full object-contain drop-shadow-2xl" />
                            <div className="absolute inset-0 bg-red-600/5 blur-3xl rounded-full -z-10 animate-pulse"></div>
                        </div>
                        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4 tracking-tight">Ready to start?</h1>
                        <p className="text-slate-500 mb-12 text-lg">The AI examiner is prepared for your evaluation.</p>
                        <button
                            onClick={handleStartExam}
                            className="bg-red-600 text-white px-12 py-5 rounded-full text-lg font-bold hover:bg-red-700 transition-all shadow-xl hover:shadow-red-600/20 hover:-translate-y-1 active:translate-y-0"
                        >
                            Start Examination
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}

export default Evaluation;
