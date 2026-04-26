import { BehaviorSubject, Subject } from 'rxjs';
import { websocketService } from './websocketService.js';

class AudioService {
    constructor() {
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        
        // RxJS State Subjects
        this.isRecording$ = new BehaviorSubject(false);
        this.audioLevels$ = new BehaviorSubject({ low: 0, mid: 0, high: 0 });
        this.microphoneError$ = new Subject();
        this.vadTriggered$ = new Subject(); // Fires when silence threshold completes a turn
        
        // VAD Constants
        this.SILENCE_THRESHOLD = 0.05;
        this.SILENCE_DURATION_MS = 1500;
        this.silenceStart = null;
        this.animationFrameId = null;
        this.hasSpoken = false; // Tracks if the user has actually begun answering
        
        // Control Flags
        this.isPrepActive = false; // Block VAD during 60s cue card prep
        this.isVadActive = true; // Ability to suppress VAD cutoffs entirely during minimum-time stages
    }

    async initMicrophone() {
        if (this.mediaStream) return;
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._setupAudioContext();
        } catch (err) {
            console.error("Mic error:", err);
            this.microphoneError$.next(err.message);
        }
    }

    _setupAudioContext() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        source.connect(this.analyser);
        this.analyser.fftSize = 256;
    }

    setPrepActive(isActive) {
        this.isPrepActive = isActive;
    }

    setVadActive(isActive) {
        this.isVadActive = isActive;
    }

    setVadTimeout(ms) {
        this.SILENCE_DURATION_MS = ms;
    }

    startRecordingTurn() {
        if (!this.mediaStream) return;
        if (this.isRecording$.value) return;
        
        // Ensure the AudioContext is running (browsers suspend it initially)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Tear down any inactive instances
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType: 'audio/webm;codecs=opus' });
        
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && websocketService.isConnected$.value) {
                websocketService.sendBinary(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            if (websocketService.isConnected$.value) {
                setTimeout(() => {
                    websocketService.sendJSON({ text: "COMMIT" });
                    this.vadTriggered$.next(true); 
                }, 50);
            }
        };

        this.silenceStart = null;
        this.hasSpoken = false;
        this.mediaRecorder.start(250);
        this.isRecording$.next(true);

        this._startVADLoop();
    }

    stopRecordingTurn() {
        this.isRecording$.next(false);
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.audioLevels$.next({ low: 0, mid: 0, high: 0 });
    }

    _startVADLoop() {
        const freqData = new Uint8Array(this.analyser.frequencyBinCount);
        const timeData = new Uint8Array(this.analyser.fftSize);
        
        const analyze = () => {
            if (!this.isRecording$.value) return;
            
            // 1. Frequency data for UI Visualizer
            this.analyser.getByteFrequencyData(freqData);
            let lowSum = 0, midSum = 0, highSum = 0;
            for (let i = 0; i < freqData.length; i++) {
                if (i < 30) lowSum += freqData[i];
                else if (i < 80) midSum += freqData[i];
                else highSum += freqData[i];
            }
            this.audioLevels$.next({
                low: (lowSum / 30 / 255),
                mid: (midSum / 50 / 255),
                high: (highSum / 48 / 255)
            });

            // 2. Time-Domain data for strict VAD Silence Tracking
            this.analyser.getByteTimeDomainData(timeData);
            let sumSquares = 0.0;
            for (let i = 0; i < timeData.length; i++) {
                // Normalize 0-255 around baseline 128
                const amplitude = (timeData[i] - 128) / 128.0;
                sumSquares += amplitude * amplitude;
            }
            const rmsVolume = Math.sqrt(sumSquares / timeData.length);

            // VAD Silence Tracking (auto-commit turn if NOT in Prep Phase)
            if (!this.isPrepActive && this.isVadActive) {
                if (rmsVolume > this.SILENCE_THRESHOLD) {
                    this.hasSpoken = true;
                    this.silenceStart = null;
                } else if (this.hasSpoken) {
                    if (!this.silenceStart) {
                        this.silenceStart = Date.now();
                    } else if (Date.now() - this.silenceStart > this.SILENCE_DURATION_MS) {
                        this.stopRecordingTurn();
                        return; // Break loop
                    }
                }
            }

            this.animationFrameId = requestAnimationFrame(analyze);
        };
        analyze();
    }
}

export const audioService = new AudioService();
