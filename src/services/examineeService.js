import { Subject, BehaviorSubject } from 'rxjs';
import { websocketService } from './websocketService.js';
import { audioService } from './audioService.js';

class ExamineeService {
    constructor() {
        // Core Logic State
        this.status$ = new BehaviorSubject('Wait');
        this.stage$ = new BehaviorSubject('Introduction');
        this.userTranscript$ = new BehaviorSubject('');
        this.isAiSpeaking$ = new BehaviorSubject(false);
        this.examFinished$ = new BehaviorSubject(false);
        this.aiResponse$ = new Subject();
        
        // The UI can bind directly to audio service levels
        this.audioData$ = audioService.audioLevels$;
        
        // Fallback sim for AI visuals
        this.aiSpeechInterval = null;

        // --- Bind Microservices ---
        
        // Dynamically adjust VAD timeout based on Stage
        this.stage$.subscribe(newStage => {
            if (newStage === 'CueCard') audioService.setVadTimeout(5000); // Allow long pauses in Part 2
            else audioService.setVadTimeout(1500); // Fast cutoff in conversational Parts 1 & 3
        });
        
        // 1. When websocket receives data, update state
        websocketService.messageReceived$.subscribe((data) => this._handleServerMessage(data));
        
        // 2. When VAD automatically cuts the mic, tell UI we are thinking
        audioService.vadTriggered$.subscribe(() => {
            if (this.status$.value !== 'Exam Finished') {
                this.setStatus('Thinking...');
            }
        });
    }

    async startExamination() {
        await audioService.initMicrophone();
        websocketService.connect();
        
        // Wait for connection
        const sub = websocketService.isConnected$.subscribe(connected => {
            if (connected) {
                websocketService.sendJSON({ text: "START_EXAM" });
                sub.unsubscribe();
            }
        });
    }

    // Called automatically or manually after AI finishes speaking
    resumeUserTurn() {
        if (this.status$.value === 'Exam Finished') return;
        this.setStatus('Your Turn');
        this.userTranscript$.next("");
        audioService.startRecordingTurn();
    }

    forceStageChange(stageName) {
        websocketService.sendJSON({ text: `STAGE_CHANGE:${stageName}` });
    }

    _handleServerMessage(data) {
        if (data.type === "preview") {
            this.userTranscript$.next(data.text);
        } else if (data.type === "response") {
            this.aiResponse$.next(data);
            // Update stage if it changed
            if (data.stage) this.stage$.next(data.stage);
            
            // Set status to AI turn
            if (data.stage === 'Evaluation') {
                this.setStatus('Exam Finished');
                this.examFinished$.next(true);
            } else {
                this.setStatus('Examiner is speaking...');
            }
            
            // Play Edge-TTS Audio
            if (data.audio) {
                this.playAudioBase64(data.audio);
            }
        } else if (data.type === "error") {
             console.error("Backend Error:", data.text);
             this.setStatus('Error');
        }
    }

    // --- AI Speech logic mapped to Edge-TTS Base64 ---
    playAudioBase64(base64Str) {
        if (!base64Str) return;
        try {
            const audioSrc = `data:audio/mp3;base64,${base64Str}`;
            const audio = new Audio(audioSrc);
            
            audio.onplay = () => {
                this.isAiSpeaking$.next(true);
                this.startAiVisualizerSim();
            };
            
            audio.onended = () => {
                this.isAiSpeaking$.next(false);
                this.stopAiVisualizerSim();
                // When AI is done, automatically start recording unless doing Eval or CueCard Prep
                if (this.stage$.value !== 'Evaluation' && this.stage$.value !== 'CueCard') {
                   setTimeout(() => this.resumeUserTurn(), 300);
                }
            };
            
            audio.onerror = (e) => {
                console.error("Audio playback error", e);
                this.isAiSpeaking$.next(false);
                this.stopAiVisualizerSim();
                if (this.stage$.value !== 'Evaluation' && this.stage$.value !== 'CueCard') {
                   setTimeout(() => this.resumeUserTurn(), 300);
                }
            };
            
            audio.play().catch(e => {
                console.error("Audio auto-play blocked by browser. User must interact.", e);
            });
        } catch (e) {
            console.error("Failed to decode base64 audio", e);
        }
    }

    startAiVisualizerSim() {
        if (this.aiSpeechInterval) clearInterval(this.aiSpeechInterval);
        this.aiSpeechInterval = setInterval(() => {
            // Overwrite audioLevels$ with fake AI waveform
            audioService.audioLevels$.next({
                low: 0.2 + Math.random() * 0.4,
                mid: 0.1 + Math.random() * 0.3,
                high: Math.random() * 0.2
            });
        }, 50);
    }

    stopAiVisualizerSim() {
        if (this.aiSpeechInterval) {
            clearInterval(this.aiSpeechInterval);
            this.aiSpeechInterval = null;
        }
        audioService.audioLevels$.next({ low: 0, mid: 0, high: 0 });
    }

    setStatus(statusStr) {
        this.status$.next(statusStr);
    }
}

export const examineeService = new ExamineeService();
