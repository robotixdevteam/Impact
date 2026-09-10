/**
 * AI Impact Kit — GenAI Chat Module
 * Handles chat UI, message sending, typing indicators, conversation history,
 * Speech-to-Text (STT) voice input, and Text-to-Speech (TTS) voice output.
 */

// ─── State ────────────────────────────────────────────────────────
let chatSessionId = localStorage.getItem('aikit_chat_session') || generateSessionId();
let isSending = false;
let autoTtsEnabled = localStorage.getItem('aikit_auto_tts') === 'true';

// Voice recording variables
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentPlayingAudio = null;

function generateSessionId() {
    const id = 'chat_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('aikit_chat_session', id);
    return id;
}

// ─── Initialize Voice UI States ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('btnVoiceToggle');
    if (toggleBtn) {
        if (autoTtsEnabled) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '🔊 Voice Output';
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '🔇 Voice Output';
        }
    }
});

// ─── Toggle Auto TTS Voice Output ───────────────────────────────
function toggleVoiceOutput() {
    autoTtsEnabled = !autoTtsEnabled;
    localStorage.setItem('aikit_auto_tts', autoTtsEnabled);

    const btn = document.getElementById('btnVoiceToggle');
    if (btn) {
        if (autoTtsEnabled) {
            btn.classList.add('active');
            btn.textContent = '🔊 Voice Output';
        } else {
            btn.classList.remove('active');
            btn.textContent = '🔇 Voice Output';
            // Stop any speaking audio
            stopSpeaking();
        }
    }
}

// ─── Text to Speech Playback ─────────────────────────────────────
async function speakText(text, btnElement = null) {
    // Clean text: strip HTML and extra tags
    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    if (!cleanText) return;

    // Stop current playing audio if any
    stopSpeaking();

    // Visual feedback on button if supplied
    if (btnElement) {
        btnElement.classList.add('playing');
        btnElement.textContent = '🔊';
    }

    try {
        const res = await fetch(`${API_BASE}/api/chat/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cleanText }),
        });

        if (!res.ok) throw new Error('Failed to generate speech');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        
        currentPlayingAudio = new Audio(url);
        currentPlayingAudio.onended = () => {
            if (btnElement) {
                btnElement.classList.remove('playing');
                btnElement.textContent = '🔊';
            }
            currentPlayingAudio = null;
        };
        currentPlayingAudio.onerror = () => {
            if (btnElement) {
                btnElement.classList.remove('playing');
                btnElement.textContent = '🔊';
            }
            currentPlayingAudio = null;
        };

        await currentPlayingAudio.play();

    } catch (e) {
        console.error('TTS Playback error:', e);
        if (btnElement) {
            btnElement.classList.remove('playing');
            btnElement.textContent = '🔊';
        }
    }
}

function stopSpeaking() {
    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio = null;
    }
    // Remove playing class from all speech buttons
    document.querySelectorAll('.tts-bubble-btn').forEach(btn => {
        btn.classList.remove('playing');
        btn.textContent = '🔊';
    });
}

// ─── Speech to Text Recording ───────────────────────────────────
async function toggleMicRecord() {
    const btn = document.getElementById('btnMic');
    const input = document.getElementById('chatInput');

    if (isRecording) {
        // Stop recording
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isRecording = false;
        btn.classList.remove('recording');
        btn.textContent = '🎤';
        input.placeholder = 'Transcribing voice input...';
    } else {
        // Start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            
            // WebM audio format is natively supported by modern browsers and Whisper accepts it
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                
                // Stop all tracks on the stream to release microphone access
                stream.getTracks().forEach(track => track.stop());

                // Send to Whisper STT Endpoint
                await sendSTT(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
            btn.textContent = '🛑';
            input.placeholder = 'Listening... Click STOP button to finish speaking.';

        } catch (err) {
            console.error('Failed to access microphone:', err);
            alert('Could not access microphone. Please check permissions.');
        }
    }
}

async function sendSTT(audioBlob) {
    const input = document.getElementById('chatInput');
    try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'speech.webm');

        const res = await fetch(`${API_BASE}/api/chat/stt`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error('Speech transcription failed');

        const data = await res.json();
        
        if (data.text && data.text.trim()) {
            input.value = data.text;
            // Send the message immediately for seamless flow
            await sendChat();
        } else {
            input.placeholder = 'Ask about sensor data, UNSDG goals, or speak...';
            alert('No speech detected. Please try speaking again.');
        }
    } catch (e) {
        console.error('STT Error:', e);
        input.placeholder = 'Ask about sensor data, UNSDG goals, or speak...';
        alert('Speech transcription failed: ' + e.message);
    }
}

// ─── Send Message ────────────────────────────────────────────────
async function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || isSending) return;

    isSending = true;
    input.value = '';
    input.placeholder = 'Ask about sensor data, UNSDG goals, or speak...';

    // Stop any ongoing voice output when sending a new message
    stopSpeaking();

    // Add user bubble
    addChatBubble('user', message);

    // Show typing indicator
    showTypingIndicator();

    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: chatSessionId,
            }),
        });

        const data = await res.json();
        removeTypingIndicator();

        // Show tool calls if any
        if (data.tool_calls && data.tool_calls.length > 0) {
            data.tool_calls.forEach(tc => {
                addToolCallCard(tc);
            });
        }

        // Show assistant response
        addChatBubble('assistant', data.response);

        // Auto-TTS if enabled
        if (autoTtsEnabled && data.response) {
            // Find the last assistant bubble's tts button
            const bubbles = document.querySelectorAll('.chat-bubble.assistant');
            const lastBubble = bubbles[bubbles.length - 1];
            const ttsBtn = lastBubble ? lastBubble.querySelector('.tts-bubble-btn') : null;
            speakText(data.response, ttsBtn);
        }

    } catch (e) {
        removeTypingIndicator();
        addChatBubble('assistant', `⚠️ Error: ${e.message}. Make sure the server is running and OpenAI API key is configured.`);
        console.error('Chat error:', e);
    }

    isSending = false;
}

// ─── Add Chat Bubble ─────────────────────────────────────────────
function addChatBubble(role, content) {
    const container = document.getElementById('chatMessages');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    // Basic markdown-like formatting for assistant messages
    if (role === 'assistant') {
        const formatted = formatAssistantMessage(content);
        bubble.innerHTML = formatted;

        // Add TTS Speak button inside the assistant bubble
        const speakBtn = document.createElement('button');
        speakBtn.className = 'tts-bubble-btn';
        speakBtn.textContent = '🔊';
        speakBtn.title = 'Read aloud';
        // Use inline handler or event listener referencing the content
        speakBtn.onclick = (e) => {
            e.stopPropagation();
            if (speakBtn.classList.contains('playing')) {
                stopSpeaking();
            } else {
                speakText(content, speakBtn);
            }
        };
        bubble.appendChild(speakBtn);
    } else {
        bubble.textContent = content;
    }

    container.appendChild(bubble);
    scrollToBottom();
}

function formatAssistantMessage(text) {
    if (!text) return '';
    // Bold: **text**
    text = text.replace(/\*\*(.*?)\*\"/g, '<strong>$1</strong>');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Inline code: `text`
    text = text.replace(/`(.*?)`/g, '<code style="background:rgba(34,211,238,0.1);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:0.82em;color:#22d3ee;">$1</code>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    // Bullet points
    text = text.replace(/• /g, '<br>• ');
    return text;
}

// ─── Tool Call Card ──────────────────────────────────────────────
function addToolCallCard(toolCall) {
    const container = document.getElementById('chatMessages');
    const card = document.createElement('div');
    card.className = 'tool-call-card';

    let resultStr = '';
    if (toolCall.result) {
        if (toolCall.result.sensor) {
            resultStr = `${toolCall.result.sensor}: ${toolCall.result.value} ${toolCall.result.unit || ''}`;
        } else if (toolCall.result.sensors) {
            resultStr = toolCall.result.sensors.map(s => `${s.sensor}: ${s.value} ${s.unit || ''}`).join(' | ');
        } else {
            resultStr = JSON.stringify(toolCall.result).substring(0, 200);
        }
    }

    card.innerHTML = `
        <div class="tool-name">🔧 ${toolCall.tool}(${JSON.stringify(toolCall.arguments)})</div>
        <div class="tool-result">→ ${resultStr}</div>
    `;

    container.appendChild(card);
    scrollToBottom();
}

// ─── Typing Indicator ───────────────────────────────────────────
function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    container.appendChild(indicator);
    scrollToBottom();
}

// ─── Remove Typing Indicator ──────────────────────────────────
function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

// ─── Clear Chat ──────────────────────────────────────────────────
async function clearChat() {
    stopSpeaking();
    try {
        await fetch(`${API_BASE}/api/chat/history/${chatSessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Failed to clear chat history on server:', e);
    }

    const container = document.getElementById('chatMessages');
    container.innerHTML = `
        <div class="chat-bubble assistant">
            👋 Chat cleared! I'm ready for a new conversation. Ask me anything about your sensors!
        </div>
    `;

    // Generate new session
    chatSessionId = generateSessionId();
}

// ─── Scroll to Bottom ────────────────────────────────────────────
function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}
