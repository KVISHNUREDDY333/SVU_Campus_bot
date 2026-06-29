/**
 * auth.js
 * Handles authentication (Login, Register, Password Reset, OTP)
 * Requires apiClient.js to be loaded first.
 */

document.addEventListener("submit", async (e) => {
    
    // ---------------- LOGIN ----------------
    if (e.target.id === 'loginForm') {
        e.preventDefault();
        const msgEl = document.getElementById('loginMessage');
        msgEl.style.color = '#94a3b8';
        msgEl.textContent = 'Verifying credentials...';
        
        try {
            const formData = new URLSearchParams();
            formData.append("username", document.getElementById("login_email").value);
            formData.append("password", document.getElementById("login_password").value);
            
            // Note: Token endpoint usually requires x-www-form-urlencoded
            const res = await fetch(`${API_URL}/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData,
            });
            
            if (res.ok) {
                const data = await res.json();
                saveSession(data);
                msgEl.style.color = '#10b981';
                msgEl.textContent = 'Login Successful!';
                setTimeout(() => document.getElementById('auth-overlay').classList.remove('active'), 800);
            } else {
                const err = await res.json();
                msgEl.style.color = '#ef4444';
                msgEl.textContent = err.detail || 'Login failed';
            }
        } catch(err) { 
            msgEl.style.color = '#ef4444'; 
            msgEl.textContent = 'Server connection error'; 
        }
    }
    
    // ---------------- FORGOT PASSWORD (STEP 1) ----------------
    if (e.target.id === 'step1Form') {
        e.preventDefault();
        window.resetEmail = document.getElementById('reset_email').value;
        const msgEl = document.getElementById('forgotMessage');
        msgEl.style.color = '#94a3b8';
        msgEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending OTP...';
        
        try {
            const { data, error } = await ApiClient.post("/forgot-password", { email: window.resetEmail });
            
            if (!error && data.status === "success") {
                document.getElementById('step1Form').style.display = 'none';
                const step2 = document.getElementById('step2Form');
                step2.classList.remove('hidden', 'hidden-initially');
                step2.style.display = 'block';
                msgEl.textContent = ''; 
            } else {
                msgEl.style.color = '#ef4444';
                msgEl.textContent = error || data?.message || 'Please enter Registered Email.';
            }
        } catch(err) { 
            msgEl.style.color = '#ef4444'; 
            msgEl.textContent = 'Verification error.'; 
        }
    }
    
    // ---------------- FORGOT PASSWORD (STEP 2: VERIFY OTP) ----------------
    if (e.target.id === 'step2Form') {
        e.preventDefault();
        const msgEl = document.getElementById('forgotMessage');
        window.resetOtp = document.getElementById('otp_input').value;
        
        msgEl.style.color = '#94a3b8';
        msgEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verifying...';

        try {
            const { data, error } = await ApiClient.post("/verify-otp", { 
                email: window.resetEmail, 
                otp: window.resetOtp 
            });
            
            if (!error) {
                msgEl.textContent = '';
                const modal = document.getElementById('modalResetPassword');
                if(modal) modal.classList.add('active');
            } else {
                msgEl.style.color = '#ef4444';
                msgEl.textContent = error || 'Verification failed.';
            }
        } catch(err) { 
            msgEl.style.color = '#ef4444'; 
            msgEl.textContent = 'Connection Error.'; 
        }
    }

    // ---------------- NEW PASSWORD SETUP ----------------
    if (e.target.id === 'modalResetForm') {
        e.preventDefault();
        const pass = document.getElementById('modal_new_pass').value;
        const confirm = document.getElementById('modal_confirm_pass').value;
        const msgEl = document.getElementById('modalResetMsg');
        
        if (pass !== confirm) { 
            msgEl.style.color = '#ef4444'; 
            msgEl.textContent = 'Passwords do not match.'; 
            return; 
        }
        
        msgEl.style.color = '#94a3b8';
        msgEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Updating...';
        
        try {
            const { data, error } = await ApiClient.post("/verify-otp-reset", { 
                email: window.resetEmail, 
                otp: window.resetOtp, 
                new_password: pass 
            });
            
            if (!error) {
                msgEl.style.color = '#10b981';
                msgEl.textContent = 'Success! Please login.';
                setTimeout(() => {
                    closeResetModal();
                    document.getElementById('showLogin').click();
                }, 1500);
            } else {
                msgEl.style.color = '#ef4444';
                msgEl.textContent = error || 'Reset failed.';
            }
        } catch(err) { 
            msgEl.style.color = '#ef4444'; 
            msgEl.textContent = 'Server error.'; 
        }
    }

    // ---------------- SIGNUP ----------------
    if (e.target.id === 'signupForm') {
        e.preventDefault();
        const msgEl = document.getElementById('signupMessage');
        msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
        msgEl.style.color = "var(--accent-color)";
        
        try {
            const payload = {
                email: document.getElementById('signup_email').value,
                first_name: document.getElementById('signup_first_name').value,
                last_name: document.getElementById('signup_last_name').value,
                role: 'student',
                password: document.getElementById('passInput').value
            };
            
            const { data, error } = await ApiClient.post("/register", payload);
            
            if (!error) {
                msgEl.innerHTML = '<span style="color:#10b981">Success! Proceeding to login.</span>';
                document.getElementById('signInGhost').click();
                document.getElementById('login_email').value = payload.email;
            } else { 
                msgEl.textContent = error || 'Registration failed';
                msgEl.style.color = "#ef4444";
            }
        } catch(err) { 
            msgEl.textContent = 'Connection Error'; 
            msgEl.style.color = "#ef4444"; 
        }
    }
});

window.closeResetModal = function() {
    const m = document.getElementById('modalResetPassword');
    if(m) {
        m.classList.remove('active');
    }
    document.getElementById('modalResetForm')?.reset();
    if(document.getElementById('modalResetMsg')) document.getElementById('modalResetMsg').textContent = '';
};

window.openAuthOverlay = function(mode="login") {
    const overlay = document.getElementById("auth-overlay");
    if(overlay) overlay.classList.add("active");
    if(window.initAuthUI) window.initAuthUI(); 
    if(mode==="register") document.getElementById("signUpGhost")?.click();
    else document.getElementById("signInGhost")?.click();
};
