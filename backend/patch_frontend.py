import re

with open("../src/pages/Evaluation.jsx", "r") as f:
    code = f.read()

# 1. Add new Refs for VAD
code = code.replace("const rafIdRef = useRef(null);",
"""const rafIdRef = useRef(null);
    
    // VAD Refs
    const isUserSpeakingRef = useRef(false);
    const silenceStartRef = useRef(null);""")

# 2. Fix the RxJS response handler to not set "Your Turn" immediately
rxjs_old = "else setStatus('Your Turn');"
rxjs_new = "// Status handled by Audio onended to prevent race conditions"
code = code.replace(rxjs_old, rxjs_new)

# 3. Completely replace Audio Logic block
audio_logic_start = code.find("// --- Audio Logic ---")
render_start = code.find("// --- Render ---")

audio_logic_new = """// --- VAD & Audio Logic ---

    const initializeMicrophone = async () => {
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

            mediaRecorderRef.current.onstop = () => {
                if (websocketRef.current?.readyState === WebSocket.OPEN) {
                    setTimeout(() => {
                        websocketRef.current.send(JSON.stringify({ text: "COMMIT" }));
                        examineeService.setStatus("Thinking...");
                    }, 50);
                }
            };
        } catch (err) {
            console.error("Mic error:", err);
            examineeService.setStatus("Mic Error");
        }
    };

    const triggerVADCommit = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            setIsSpeaking(false);
            if (stage === 'CueCard') setIsRecordTimerActive(false);
            mediaRecorderRef.current.stop(); 
        }
    };

    const restartRecordingTurn = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "inactive") {
            mediaRecorderRef.current.start(250);
            setIsSpeaking(false); 
            examineeService.setStatus('Your Turn');
            examineeService.updateTranscript("");
            if (stage === 'CueCard') {
                setIsRecordTimerActive(true);
                setSpeakingSeconds(0);
            }
        }
    };

    // Auto-resume recording when AI finishes
    useEffect(() => {
        if (!isAiSpeaking && testStarted && status !== 'Exam Finished' && status !== 'Wait' && status !== 'Thinking...') {
            setTimeout(() => {
                if (stage === 'CueCard' && isPrepActive) return;
                if (mediaRecorderRef.current?.state === "inactive") {
                     restartRecordingTurn();
                }
            }, 300);
        } else if (isAiSpeaking && mediaRecorderRef.current?.state === "recording") {
            // Failsafe: if we are somehow recording while AI speaks, pause or stop it manually
            // But we rely on VAD triggering the stop naturally before AI speaks
        }
    }, [isAiSpeaking, testStarted, stage, isPrepActive, status]);

    const handleStartExam = async () => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
            setTestStarted(true);
            await initializeMicrophone();
            websocketRef.current.send(JSON.stringify({ text: "START_EXAM" }));
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
                const length = dataArrayRef.current.length;
                const lowAvg = dataArrayRef.current.slice(0, Math.floor(length * 0.1)).reduce((a, b) => a + b, 0) / (length * 0.1) || 0;
                const midAvg = dataArrayRef.current.slice(Math.floor(length * 0.1), Math.floor(length * 0.5)).reduce((a, b) => a + b, 0) / (length * 0.4) || 0;
                const highAvg = dataArrayRef.current.slice(Math.floor(length * 0.5)).reduce((a, b) => a + b, 0) / (length * 0.5) || 0;

                examineeService.updateAudioData({
                    low: lowAvg / 255,
                    mid: midAvg / 255,
                    high: highAvg / 255
                });
                
                // Continuous VAD Silence Detection
                const volume = (lowAvg + midAvg + highAvg) / (3 * 255);
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                    if (volume > 0.05) { // Active speaking threshold
                        if (!isUserSpeakingRef.current) {
                            isUserSpeakingRef.current = true;
                            setIsSpeaking(true);
                            examineeService.setStatus('Recording...');
                        }
                        silenceStartRef.current = null;
                    } else if (isUserSpeakingRef.current) {
                        if (!silenceStartRef.current) {
                            silenceStartRef.current = Date.now();
                        } else if (Date.now() - silenceStartRef.current > 1500) { // 1.5s silence trigger
                            if (stage === 'CueCard' && speakingSeconds < 120) {
                                // Must talk for 2 mins in Part 2! Keep listening
                                silenceStartRef.current = null;
                            } else {
                                isUserSpeakingRef.current = false;
                                silenceStartRef.current = null;
                                triggerVADCommit();
                            }
                        }
                    }
                }
            }
            rafIdRef.current = requestAnimationFrame(update);
        };
        update();
    };

    const stopAudioAnalysis = () => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        examineeService.updateAudioData({ low: 0, mid: 0, high: 0 });
    };

    """

code = code[:audio_logic_start] + audio_logic_new + code[render_start:]

# 4. Remove the massive manual Record Button from the UI since it's hands-free
record_button_start = code.find("{/* Record Button */}")
if record_button_start != -1:
    record_button_end = code.find("</div>", code.find("</div>", code.find("</div>", record_button_start) + 1) + 1) + 6
    code = code[:record_button_start] + code[record_button_end:]

with open("../src/pages/Evaluation.jsx", "w") as f:
    f.write(code)

print("Evaluation.jsx successfully patched for VAD!")
