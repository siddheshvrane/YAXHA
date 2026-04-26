import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import GeminiVisualizer from '../components/GeminiVisualizer';
import ErrorOverlay from '../components/ErrorOverlay';
import craneAgent from '../assets/Crane AI Agent.png';

// --- Decoupled RxJS Services ---
import { examineeService } from '../services/examineeService';
import { audioService } from '../services/audioService';

function Evaluation() {
    // --- UI State (Synced strictly via RxJS Observables) ---
    const [stage, setStage] = useState('Introduction'); 
    const [status, setStatus] = useState('Wait'); 
    const [isSpeaking, setIsSpeaking] = useState(false); // User recording state
    const [isAiSpeaking, setIsAiSpeaking] = useState(false); 
    const [testStarted, setTestStarted] = useState(false); 
    const [error, setError] = useState(null); 
    
    // Content state
    const [aiQuestion, setAiQuestion] = useState("Connected. Waiting for Examiner...");
    const [userTranscript, setUserTranscript] = useState("");

    // Timers for Part 2
    const [prepTimeLeft, setPrepTimeLeft] = useState(60); 
    const [speakingSeconds, setSpeakingSeconds] = useState(0); 
    const [isPrepActive, setIsPrepActive] = useState(false);
    const [isRecordTimerActive, setIsRecordTimerActive] = useState(false);

    // --- Core RxJS Subscriptions ---
    useEffect(() => {
        const subs = [
            examineeService.status$.subscribe(setStatus),
            examineeService.stage$.subscribe(newStage => {
                setStage(newStage);
            }),
            examineeService.aiResponse$.subscribe(resp => {
                if (resp && resp.type === 'response') setAiQuestion(resp.text);
            }),
            examineeService.userTranscript$.subscribe(setUserTranscript),
            examineeService.isAiSpeaking$.subscribe(setIsAiSpeaking),
            
            // Map Audio service directly to UI
            audioService.isRecording$.subscribe(setIsSpeaking),
            audioService.microphoneError$.subscribe(setError)
        ];
        
        return () => subs.forEach(s => s.unsubscribe());
    }, [isPrepActive, speakingSeconds, prepTimeLeft]);

    // --- Part 2 Cue Card Timer Orchestration ---
    useEffect(() => {
        if (stage === 'CueCard' && !isAiSpeaking && prepTimeLeft === 60 && speakingSeconds === 0 && !isPrepActive && !isRecordTimerActive) {
            // Wait for AI to finish dictating instructions before starting the Prep countdown
            setStatus('Prep Time');
            setIsPrepActive(true);
            audioService.setPrepActive(true);
        }
    }, [stage, isAiSpeaking, prepTimeLeft, speakingSeconds, isPrepActive, isRecordTimerActive]);

    useEffect(() => {
        let interval = null;
        if (isPrepActive && prepTimeLeft > 0) {
            interval = setInterval(() => {
                setPrepTimeLeft(prev => prev - 1);
            }, 1000);
        } else if (isPrepActive && prepTimeLeft === 0) {
            // Prep Finished -> Force Start Recording
            setIsPrepActive(false);
            audioService.setPrepActive(false);
            examineeService.resumeUserTurn(); // Tells service to kick on the mic
            setIsRecordTimerActive(true);
            setStatus('Speaking Time');
        }
        return () => clearInterval(interval);
    }, [isPrepActive, prepTimeLeft]);

    useEffect(() => {
        let interval = null;
        if (isRecordTimerActive && isSpeaking) {
            interval = setInterval(() => {
                setSpeakingSeconds(prev => {
                    const next = prev + 1;
                    
                    if (stage === 'CueCard') {
                        if (next < 120) {
                            audioService.setVadActive(false); // Force keep listening
                        } else {
                            audioService.setVadActive(true); // Allow VAD to cut
                        }
                    }

                    if (next >= 180) { // Hard limit at 3 mins
                        setIsRecordTimerActive(false);
                        audioService.stopRecordingTurn();
                        examineeService.forceStageChange("Discussion"); 
                    }
                    return next;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isRecordTimerActive, speakingSeconds, isSpeaking]);

    // Dynamic Status text for Part 2
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


    // --- Boot ---
    const handleStartExam = async () => {
        setTestStarted(true);
        await examineeService.startExamination();
    };

    const getStageName = () => {
        switch (stage) {
            case 'Introduction': return 'Stage 1: Introduction';
            case 'CueCard': return 'Stage 2: Cue Card';
            case 'Discussion': return 'Stage 3: Discussion';
            case 'Evaluation': return 'Final Evaluation';
            default: return 'IELTS Exam';
        }
    };

    const renderCueCardContent = (text) => {
        if (!text.includes('•')) return <div className="text-lg md:text-xl font-medium">{text}</div>;
        
        const parts = text.split('•');
        const header = parts[0].trim();
        const bullets = parts.slice(1).map((b, i) => (
            <li key={i} className="ml-6 list-disc marker:text-sarus-red mb-2 text-slate-700 font-medium">{b.trim()}</li>
        ));

        return (
            <div className="bg-white border-2 border-slate-200 shadow-lg rounded-2xl p-6 md:p-8 my-4 relative animate-in fade-in slide-in-from-bottom-4 duration-700">
                 <div className="absolute top-0 right-8 -mt-3 bg-white px-3 border border-slate-100 rounded-full shadow-sm text-xs font-bold text-slate-400 uppercase tracking-widest">Candidate Task Card</div>
                 <p className="font-bold text-slate-800 text-xl mb-6">{header.replace(/TOPIC:/i, '').trim()}</p>
                 <ul className="text-base md:text-lg space-y-3">
                     {bullets}
                 </ul>
            </div>
        );
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

                {/* Card */}
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
                                {renderCueCardContent(aiQuestion)}
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

                {/* Interaction String */}
                <div className="flex flex-col items-center mb-8">
                    <span className={`text-sarus-desc text-lg font-medium tracking-wide transition-colors duration-300 mb-6 ${isSpeaking ? 'text-sarus-red' : isAiSpeaking ? 'text-orange-500' : 'text-gray-500'}`}>
                        {isAiSpeaking ? 'Examiner is speaking...' : status}
                    </span>
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

            {error && <ErrorOverlay message={error} onRetry={() => setError(null)} />}

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
