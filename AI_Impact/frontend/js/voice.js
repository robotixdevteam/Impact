/**
 * AI Impact Kit — Voice Assistant Module
 * Dedicated voice-first view for interacting with the GenAI assistant (Siri-like UI).
 */

// ─── State ────────────────────────────────────────────────────────
let voiceSessionId = localStorage.getItem('aikit_voice_session') || generateVoiceSessionId();
let voiceMediaRecorder = null;
let voiceAudioChunks = [];
let voiceCurrentAudio = null;
let voiceState = 'ready'; // ready, listening, thinking, speaking

function generateVoiceSessionId() {
    const id = 'voice_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('aikit_voice_session', id);
    return id;
}

// ─── UI Updates ──────────────────────────────────────────────────
function updateVoiceState(newState, customStatus = null) {
    voiceState = newState;
    
    const wrapper = document.querySelector('.siri-orb-wrapper');
    const status = document.getElementById('siriStatus');
    
    // Reset wrapper classes
    wrapper.className = 'siri-orb-wrapper ' + newState;
    
    switch (newState) {
        case 'ready':
            status.textContent = customStatus || 'TAP ORB TO WAKE';
            break;
        case 'listening':
            status.textContent = customStatus || 'LISTENING... TAP TO STOP';
            break;
        case 'thinking':
            status.textContent = customStatus || 'THINKING...';
            break;
        case 'speaking':
            status.textContent = customStatus || 'SPEAKING...';
            break;
    }
}

function formatVoiceMessage(text) {
    if (!text) return '';
    // Strip any HTML tags first to prevent injection
    text = text.replace(/<[^>]*>?/gm, '');
    
    // Bold: **text**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--accent-cyan); font-weight: 600;">$1</strong>');
    
    // Inline code: `text`
    text = text.replace(/`(.*?)`/g, '<code style="background:rgba(34,211,238,0.1);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:0.82em;color:#22d3ee;">$1</code>');
    
    // Format list bullets to line breaks with bullet characters
    text = text.replace(/\s*[-•*]\s+\*\*/g, '<br>• **');
    text = text.replace(/\s*[-•*]\s+(\w)/g, '<br>• $1');
    
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    
    // Remove duplicate starting break if any
    if (text.startsWith('<br>')) {
        text = text.substring(4);
    }
    
    return text;
}

function showVoiceMessage(role, text) {
    const userTextEl = document.getElementById('siriUserText');
    const aiTextEl = document.getElementById('siriAiText');
    
    if (role === 'user') {
        userTextEl.textContent = `"${text}"`;
        userTextEl.style.opacity = '1';
        aiTextEl.innerHTML = ''; // Clear AI while thinking
    } else if (role === 'assistant') {
        let formatted = formatVoiceMessage(text);
        aiTextEl.innerHTML = formatted;
    } else {
        // Error state
        aiTextEl.textContent = text;
        aiTextEl.style.color = '#f87171'; // red
    }
}

// ─── Core Logic ──────────────────────────────────────────────────
async function toggleMainVoiceMic() {
    if (voiceState === 'speaking') {
        // Stop playback
        if (voiceCurrentAudio) {
            voiceCurrentAudio.pause();
            voiceCurrentAudio = null;
        }
        updateVoiceState('ready');
        return;
    }
    
    if (voiceState === 'listening') {
        // Stop recording and process
        if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
            voiceMediaRecorder.stop();
        }
        return;
    }
    
    if (voiceState === 'thinking') {
        // Can't interrupt thinking easily without abort controllers, just ignore
        return;
    }
    
    // Start Recording (from 'ready' state)
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceAudioChunks = [];
        
        voiceMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        
        voiceMediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                voiceAudioChunks.push(event.data);
            }
        };

        voiceMediaRecorder.onstop = async () => {
            const audioBlob = new Blob(voiceAudioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(track => track.stop());
            
            await processVoiceInput(audioBlob);
        };

        voiceMediaRecorder.start();
        
        // Clear previous text
        document.getElementById('siriUserText').textContent = '';
        document.getElementById('siriAiText').textContent = '';
        document.getElementById('siriAiText').style.color = ''; // reset error color
        
        updateVoiceState('listening');

    } catch (err) {
        console.error('Microphone access denied or error:', err);
        alert('Could not access microphone. Please check permissions.');
        updateVoiceState('ready', 'MIC ACCESS DENIED');
    }
}

async function processVoiceInput(audioBlob) {
    try {
        updateVoiceState('thinking', 'TRANSCRIBING...');
        
        // 1. Speech-to-Text
        const formData = new FormData();
        formData.append('file', audioBlob, 'voice_input.webm');

        const sttRes = await fetch(`${API_BASE}/api/chat/stt`, {
            method: 'POST',
            body: formData,
        });

        if (!sttRes.ok) throw new Error('Transcription failed');
        const sttData = await sttRes.json();
        
        if (!sttData.text || !sttData.text.trim()) {
            updateVoiceState('ready', 'NO SPEECH DETECTED');
            return;
        }

        const userText = sttData.text;
        showVoiceMessage('user', userText);

        // 2. Chat API (LLM)
        updateVoiceState('thinking', 'THINKING...');
        const chatRes = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userText,
                session_id: voiceSessionId,
            }),
        });

        if (!chatRes.ok) throw new Error('Chat API failed');
        const chatData = await chatRes.json();
        
        const assistantText = chatData.response;
        showVoiceMessage('assistant', assistantText);

        // 3. Text-to-Speech
        updateVoiceState('thinking', 'GENERATING SPEECH...');
        const cleanText = assistantText.replace(/<[^>]*>/g, '').trim();
        
        const ttsRes = await fetch(`${API_BASE}/api/chat/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleanText }),
        });

        if (!ttsRes.ok) throw new Error('TTS Generation failed');

        // Play audio
        const blob = await ttsRes.blob();
        const url = URL.createObjectURL(blob);
        
        voiceCurrentAudio = new Audio(url);
        
        voiceCurrentAudio.onended = () => {
            updateVoiceState('ready');
            voiceCurrentAudio = null;
        };
        
        voiceCurrentAudio.onerror = () => {
            updateVoiceState('ready', 'AUDIO PLAYBACK ERROR');
            voiceCurrentAudio = null;
        };

        updateVoiceState('speaking');
        await voiceCurrentAudio.play();

    } catch (err) {
        console.error('Voice Processing Error:', err);
        updateVoiceState('ready', 'ERROR OCCURRED');
        showVoiceMessage('error', `⚠️ Error: ${err.message}`);
    }
}

// ─── Clear Voice Chat ────────────────────────────────────────────
async function clearVoiceChat() {
    if (voiceCurrentAudio) {
        voiceCurrentAudio.pause();
        voiceCurrentAudio = null;
    }
    
    try {
        await fetch(`${API_BASE}/api/chat/history/${voiceSessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Failed to clear voice history on server:', e);
    }

    document.getElementById('siriUserText').textContent = '';
    document.getElementById('siriAiText').textContent = 'History cleared. Tap orb to start.';
    document.getElementById('siriAiText').style.color = '';
    
    updateVoiceState('ready', 'TAP ORB TO WAKE');
    voiceSessionId = generateVoiceSessionId();
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    updateVoiceState('ready');
});

