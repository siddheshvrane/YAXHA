import React, { useRef, useEffect } from 'react';
import { examineeService } from '../services/examineeService';

// Simple 2D Noise implementation (Pseudo-random)
const noise2D = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
};

// Smoother interpolation
const smoothNoise = (x, y, t) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const f = x - i;
    const g = y - j;

    // 4 corners
    const a = noise2D(i, j + t);
    const b = noise2D(i + 1, j + t);
    const c = noise2D(i, j + 1 + t);
    const d = noise2D(i + 1, j + 1 + t);

    // Cubic interpolation
    const u = f * f * (3 - 2 * f);
    const v = g * g * (3 - 2 * g);

    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};

const GeminiVisualizer = () => {
    const canvasRef = useRef(null);
    const timeRef = useRef(0);
    const audioDataRef = useRef({ low: 0, mid: 0, high: 0 });
    const smoothedAudioRef = useRef({ low: 0, mid: 0, high: 0 }); // For smoothing

    // Subscribe to reactive audio data
    useEffect(() => {
        const sub = examineeService.audioData$.subscribe(data => {
            audioDataRef.current = data;
        });
        return () => sub.unsubscribe();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let animationId;

        const resize = () => {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio;
            canvas.height = canvas.offsetHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };

        window.addEventListener('resize', resize);
        resize();

        const render = () => {
            const width = canvas.offsetWidth;
            const height = canvas.offsetHeight;
            const targetAudio = audioDataRef.current;

            // 1. Audio Smoothing (Lerp) to prevent flickering
            // The lower the factor (0.1), the smoother (and slower) the reaction
            const smoothFactor = 0.1;
            smoothedAudioRef.current = {
                low: smoothedAudioRef.current.low * (1 - smoothFactor) + targetAudio.low * smoothFactor,
                mid: smoothedAudioRef.current.mid * (1 - smoothFactor) + targetAudio.mid * smoothFactor,
                high: smoothedAudioRef.current.high * (1 - smoothFactor) + targetAudio.high * smoothFactor,
            };
            const currentAudio = smoothedAudioRef.current;

            // 2. Speed Control - DRASTICALLY SLOWER
            // Base speed is very low. Audio adds a tiny bit more movement.
            const speed = 0.0005 + (currentAudio.low + currentAudio.high) * 0.001;
            timeRef.current += speed;

            ctx.clearRect(0, 0, width, height);

            // Create gradient
            const gradient = ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, 'rgba(220, 38, 38, 0.8)'); // Red base
            gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.5)'); // Red mid
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Transparent top

            // Draw 30 layers of waves for "liquid" smooth look
            // We use CSS filter: blur() on the container/canvas for performance instead of 30x canvas filters
            for (let layer = 1; layer <= 30; layer++) {
                ctx.beginPath();

                // 3. Amplitude Control - Reduced Height (Gemini Feel is subtle)
                // Base amplitude is 10% of height (User requested "make them shorter").
                const amplitudeBase = height * 0.1;
                // Audio boosts height significantly but relative to screen height to prevent clipping
                const audioAmp = currentAudio.low * (height * 0.4) + currentAudio.mid * (height * 0.2);

                let x = 0;
                let firstY = 0;

                // Spreading 30 layers with ORGANIC DECORRELATION
                // Large prime number offsets ensure layers don't look like clones
                const layerOffset = layer * 435.4;
                // Slight frequency variation per layer (some wider, some tighter)
                const frequency = 0.001 + (layer % 5) * 0.0002;
                // Slight speed variation per layer
                const layerSpeed = timeRef.current * (1 + (layer % 3) * 0.1);

                // Pre-calculate first point
                let noiseX = 0 * frequency + layerOffset;
                let noiseY = layerSpeed + layer * 13.3; // Offset Y significantly too
                let noiseVal = smoothNoise(noiseX, noiseY, timeRef.current * 0.2);

                // Map noise (-1 to 1 mostly) to Y coordinate
                // We want the wave to be at the bottom, so height - value
                firstY = height - (amplitudeBase + noiseVal * (amplitudeBase * 0.6 + audioAmp));

                ctx.moveTo(0, firstY);

                for (x = 40; x <= width + 40; x += 40) {
                    noiseX = x * frequency + layerOffset;
                    noiseY = layerSpeed + layer * 13.3;
                    noiseVal = smoothNoise(noiseX, noiseY, timeRef.current * 0.2);

                    let nextY = height - (amplitudeBase + noiseVal * (amplitudeBase * 0.6 + audioAmp));

                    const midX = (x - 40 + x) / 2;
                    const midY = (firstY + nextY) / 2;

                    ctx.quadraticCurveTo(x - 40, firstY, midX, midY);

                    firstY = nextY;
                }

                ctx.lineTo(width, height);
                ctx.lineTo(0, height);
                ctx.closePath();

                // 4. Colors - Stacking 30 layers
                // Use very low opacity so they blend over each other
                // Bottom layers (near 1) = more transparent
                // Top layers (near 30) = slightly more visible or gradient

                const opacity = 0.01 + (layer / 30) * 0.05; // 0.01 to 0.06
                ctx.fillStyle = `rgba(220, 38, 38, ${opacity})`;

                if (layer > 25) {
                    // Give the top few layers the gradient for some pop
                    // But we need to handle gradient opacity manually or it will be too strong
                    // Actually, let's just stick to solid accumulation for "liquid" look
                    ctx.fillStyle = `rgba(239, 68, 68, ${opacity * 2})`;
                }

                ctx.fill();
            }

            animationId = requestAnimationFrame(render);
        };

        render();

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full absolute bottom-0 left-0 pointer-events-none"
            style={{ filter: 'blur(30px)' }} // GPU Accelerated blur for the whole liquid
        />
    );
};

export default GeminiVisualizer;
