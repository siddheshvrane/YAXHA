/**
 * Transcribes audio blob using Local Whisper Backend
 * @param {Blob} audioBlob - The audio file to transcribe
 * @returns {Promise<string>} - The transcribed text
 */
export const transcribeAudio = async (audioBlob) => {
    try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        const response = await fetch("http://localhost:8000/transcribe", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error transcribing audio:", error);
        return "Error: Could not transcribe audio. Ensure the backend server is running.";
    }
};
