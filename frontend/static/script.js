// Initialize the chatbot
document.addEventListener('DOMContentLoaded', function() {
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatBox = document.getElementById('chatBox');
    const welcomeTime = document.getElementById('welcomeTime');
    
    // Set welcome message time
    welcomeTime.textContent = getCurrentTime();
    
    // Add event listeners
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Focus on input when page loads
    userInput.focus();
});

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    });
}

function sendMessage() {
    const userInput = document.getElementById('userInput');
    const message = userInput.value.trim();
    
    if (!message) {
        return;
    }
    
    // Add user message to chat
    addMessage(message, 'user');
    
    // Clear input and disable send button
    userInput.value = '';
    toggleSendButton(false);
    
    // Show loading message
    const loadingId = addLoadingMessage();
    
    // Send message to backend
    fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: message })
    })
    .then(response => response.json())
    .then(data => {
        // Remove loading message
        removeLoadingMessage(loadingId);
        
        if (data.status === 'success') {
            addMessage(data.response, 'bot');
        } else {
            addMessage(data.error || 'Sorry, something went wrong. Please try again.', 'bot', true);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        removeLoadingMessage(loadingId);
        addMessage('Sorry, I\'m having trouble connecting. Please check your internet connection and try again.', 'bot', true);
    })
    .finally(() => {
        toggleSendButton(true);
        userInput.focus();
    });
}

function addMessage(content, sender, isError = false) {
    const chatBox = document.getElementById('chatBox');
    const messageDiv = document.createElement('div');
    const currentTime = getCurrentTime();
    
    messageDiv.className = `message ${sender}-message${isError ? ' error-message' : ''}`;
    
    const senderName = sender === 'user' ? 'You' : 'Campus Assistant';
    const icon = sender === 'user' ? '🎓' : '🤖';
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <strong>${icon} ${senderName}:</strong> ${content}
        </div>
        <div class="message-time">${currentTime}</div>
    `;
    
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addLoadingMessage() {
    const chatBox = document.getElementById('chatBox');
    const loadingDiv = document.createElement('div');
    const loadingId = 'loading-' + Date.now();
    
    loadingDiv.id = loadingId;
    loadingDiv.className = 'message bot-message';
    loadingDiv.innerHTML = `
        <div class="message-content loading">
            <strong>🤖 Campus Assistant:</strong> <span>Thinking...</span>
        </div>
        <div class="message-time">${getCurrentTime()}</div>
    `;
    
    chatBox.appendChild(loadingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    return loadingId;
}

function removeLoadingMessage(loadingId) {
    const loadingDiv = document.getElementById(loadingId);
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

function toggleSendButton(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    const sendIcon = document.getElementById('sendIcon');
    const loadingIcon = document.getElementById('loadingIcon');
    
    sendBtn.disabled = !enabled;
    
    if (enabled) {
        sendIcon.style.display = 'inline';
        loadingIcon.style.display = 'none';
    } else {
        sendIcon.style.display = 'none';
        loadingIcon.style.display = 'inline';
    }
}

function sendSuggestion(suggestion) {
    const userInput = document.getElementById('userInput');
    userInput.value = suggestion;
    sendMessage();
}

// Add some helpful utility functions
function clearChat() {
    const chatBox = document.getElementById('chatBox');
    const messages = chatBox.querySelectorAll('.message:not(.welcome)');
    messages.forEach(message => message.remove());
}

// Add keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl + L to clear chat (optional feature)
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        if (confirm('Clear chat history?')) {
            clearChat();
        }
    }
    
    // Escape to focus input
    if (e.key === 'Escape') {
        const userInput = document.getElementById('userInput');
        userInput.focus();
        userInput.select();
    }
});

// Add connection status indicator
function checkConnection() {
    fetch('/health')
        .then(response => response.json())
        .then(data => {
            console.log('Connection status:', data.status);
        })
        .catch(error => {
            console.warn('Connection check failed:', error);
        });
}

// Check connection on page load
setTimeout(checkConnection, 2000);