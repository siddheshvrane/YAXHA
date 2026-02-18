import { Subject, BehaviorSubject } from 'rxjs';

/**
 * Service to handle reactive communication between IELTS components.
 * This decouples the UI from the underlying WebSocket/Audio logic.
 */
class ExamineeService {
    constructor() {
        // Observables for state
        this.status$ = new BehaviorSubject('Wait');
        this.stage$ = new BehaviorSubject('Introduction');
        this.aiResponse$ = new Subject(); // { text: string, type: 'response' | 'error' }
        this.userTranscript$ = new BehaviorSubject('');
        this.audioData$ = new BehaviorSubject({ low: 0, mid: 0, high: 0 });
        this.isAiSpeaking$ = new BehaviorSubject(false);
        this.isUserRecording$ = new BehaviorSubject(false);

        // Signals
        this.controlSignal$ = new Subject(); // 'START_EXAM', 'COMMIT', etc.

        // Shared Speech Synth
        this.synth = window.speechSynthesis;
        this.aiSpeechInterval = null;

        // Prime voices immediately for better reactivity
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.synth.getVoices();
        }
    }

    emitResponse(response) {
        this.aiResponse$.next(response);
        // Automatic reactive speech
        if (response && response.type === 'response' && response.text) {
            this.speak(response.text);
        }
    }

    setStatus(status) {
        this.status$.next(status);
        if (status === 'Recording...') this.isUserRecording$.next(true);
        else if (status === 'Wait' || status === 'Your Turn') this.isUserRecording$.next(false);
    }

    setStage(stage) {
        this.stage$.next(stage);
    }

    updateTranscript(text) {
        this.userTranscript$.next(text);
    }

    updateAudioData(data) {
        this.audioData$.next(data);
    }

    sendSignal(signal) {
        this.controlSignal$.next(signal);
    }

    // --- AI Speech logic moved to Service ---
    sanitizeTTS(text) {
        if (!text) return "";
        return text
            .replace(/\*/g, "") // Remove asterisks (bold/italic)
            .replace(/#/g, "")  // Remove hashes
            .replace(/-/g, " ") // Replace dashes with spaces for flow
            .replace(/\s+/g, " ") // Collapse multiple spaces
            .replace(/[^\x00-\x7F]/g, "") // Remove non-ASCII (emojis, special chars)
            .trim();
    }

    speak(text) {
        if (!this.synth) return;

        // Stabilize: Cancel and wait a tiny bit to stop previous "harsh" buffers
        this.synth.cancel();

        const cleanText = this.sanitizeTTS(text);
        if (!cleanText) return;

        const utterance = new SpeechSynthesisUtterance(cleanText);

        const setVoice = () => {
            const voices = this.synth.getVoices();
            if (voices.length > 0) {
                const preferredVoice = voices.find(v => v.lang.includes('en-GB') || v.name.includes('Google UK English')) ||
                    voices.find(v => v.lang.includes('en-US')) ||
                    voices[0];
                if (preferredVoice) utterance.voice = preferredVoice;

                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                utterance.volume = 0.9; // Slightly lower than max to prevent clipping/harshness

                utterance.onstart = () => {
                    this.isAiSpeaking$.next(true);
                    this.startAiVisualizerSim();
                };

                utterance.onend = () => {
                    this.isAiSpeaking$.next(false);
                    this.stopAiVisualizerSim();
                };

                utterance.onerror = () => {
                    this.isAiSpeaking$.next(false);
                    this.stopAiVisualizerSim();
                };

                // Use a tiny timeout to ensure the previous synth.cancel() has fully cleared the hardware buffer
                setTimeout(() => {
                    this.synth.speak(utterance);
                }, 100);
            } else {
                setTimeout(setVoice, 100);
            }
        };
        setVoice();
    }

    unlockSpeechSynthesis() {
        if (this.synth) {
            const dummy = new SpeechSynthesisUtterance("");
            this.synth.speak(dummy);
        }
    }

    startAiVisualizerSim() {
        if (this.aiSpeechInterval) clearInterval(this.aiSpeechInterval);
        this.aiSpeechInterval = setInterval(() => {
            this.updateAudioData({
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
        // Only reset if not user recording
        if (!this.isUserRecording$.value) {
            this.updateAudioData({ low: 0, mid: 0, high: 0 });
        }
    }
}

export const examineeService = new ExamineeService();
