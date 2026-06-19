const rootElement = document.getElementById('root');
let currentSection = 'health';

async function fetchHealthStatus() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const healthDataElement = document.getElementById('health-data');
    if (healthDataElement) {
      healthDataElement.textContent = JSON.stringify(data, null, 2);
    }
  } catch (error) {
    console.error('Error fetching health status:', error);
    const healthDataElement = document.getElementById('health-data');
    if (healthDataElement) {
      healthDataElement.textContent = 'Error loading health status.';
    }
  }
}

async function fetchTelegramStatus() {
  try {
    const res = await fetch('/api/telegram/status');
    const data = await res.json();
    const statusElement = document.getElementById('telegram-status');
    const loginFormElement = document.getElementById('telegram-login-form');

    if (statusElement) {
      if (data.isReady) {
        statusElement.textContent = 'Status: Connected';
        loginFormElement.style.display = 'none';
      } else if (data.tempPhone) {
        statusElement.textContent = \`Status: Waiting for OTP for \${data.tempPhone}\`;
        showTelegramLoginForm(true);
      } else {
        statusElement.textContent = 'Status: Not Connected. Please log in.';
        showTelegramLoginForm(false);
      }
    }
  } catch (error) {
    console.error('Error fetching Telegram status:', error);
  }
}

function showTelegramLoginForm(isWaitingForCode) {
  const loginForm = document.getElementById('telegram-login-form');
  if (!loginForm) return;
  const phoneInput = document.getElementById('telegram-phone');
  const codeInput = document.getElementById('telegram-code');
  const passwordInput = document.getElementById('telegram-password');
  const sendBtn = loginForm.querySelector('button[onclick*="sendTelegramCode"]');
  const submitBtn = loginForm.querySelector('button[onclick*="submitTelegramCode"]');

  if (isWaitingForCode) {
    if (phoneInput) phoneInput.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'none';
    if (codeInput) codeInput.style.display = 'block';
    if (passwordInput) passwordInput.style.display = 'block';
    if (submitBtn) submitBtn.style.display = 'block';
  } else {
    if (phoneInput) phoneInput.style.display = 'block';
    if (sendBtn) sendBtn.style.display = 'block';
    if (codeInput) codeInput.style.display = 'none';
    if (passwordInput) passwordInput.style.display = 'none';
    if (submitBtn) submitBtn.style.display = 'none';
  }
}

async function sendTelegramCode() {
  const phoneNumber = document.getElementById('telegram-phone').value;
  const res = await fetch('/api/telegram/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });
  const data = await res.json();
  if (data.success) {
    alert('Code sent!');
    showTelegramLoginForm(true);
  } else {
    alert('Error: ' + data.error);
  }
}

async function submitTelegramCode() {
  const code = document.getElementById('telegram-code').value;
  const password = document.getElementById('telegram-password').value;
  const res = await fetch('/api/telegram/submit-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, password }),
  });
  const data = await res.json();
  if (data.success) {
    alert('Login successful!');
    fetchTelegramStatus();
  } else {
    alert('Error: ' + data.error);
  }
}

async function telegramLogout() {
  const res = await fetch('/api/telegram/logout', { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    alert('Logged out');
    fetchTelegramStatus();
  }
}

async function fetchCookieSites() {
  const res = await fetch('/api/cookies');
  const data = await res.json();
  const sitesDiv = document.getElementById('cookie-sites');
  if (!sitesDiv) return;
  sitesDiv.innerHTML = '';
  data.forEach(s => {
    const d = document.createElement('div');
    d.innerHTML = \`
      <h4>\${s.site}</h4>
      <p>Has Cookies: \${s.has_cookies}</p>
      <button onclick="showCookiePasteForm('\${s.site}')">Paste Cookies</button>
    \`;
    sitesDiv.appendChild(d);
  });
}

function showCookiePasteForm(site) {
  const form = document.getElementById('cookie-paste-form');
  const area = document.getElementById('cookie-textarea');
  area.dataset.site = site;
  form.style.display = 'block';
}

async function submitCookies() {
  const area = document.getElementById('cookie-textarea');
  const site = area.dataset.site;
  const cookies = area.value;
  const res = await fetch('/api/cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site, cookies }),
  });
  const data = await res.json();
  if (data.success) {
    alert('Cookies saved!');
    fetchCookieSites();
  } else {
    alert('Error: ' + data.error);
  }
}

function showSection(id) {
  document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
  const target = document.getElementById(\`\${id}-section\`);
  if (target) target.style.display = 'block';
  
  if (id === 'health') fetchHealthStatus();
  if (id === 'telegram') fetchTelegramStatus();
  if (id === 'cookies') fetchCookieSites();
}

function renderDashboard() {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = \`
    <header>
      <h1>Brief Agent Dashboard</h1>
      <nav>
        <button onclick="showSection('health')">Health</button>
        <button onclick="showSection('telegram')">Telegram</button>
        <button onclick="showSection('cookies')">Cookies</button>
      </nav>
    </header>
    <main>
      <section id="health-section">
        <h2>Health</h2>
        <pre id="health-data">Loading...</pre>
      </section>
      <section id="telegram-section" style="display:none">
        <h2>Telegram</h2>
        <div id="telegram-status"></div>
        <div id="telegram-login-form">
          <input id="telegram-phone" placeholder="Phone (+1234567890)"/>
          <button onclick="sendTelegramCode()">Send Code</button>
          <input id="telegram-code" style="display:none" placeholder="OTP Code"/>
          <input id="telegram-password" type="password" style="display:none" placeholder="2FA Password"/>
          <button id="tg-submit" style="display:none" onclick="submitTelegramCode()">Submit</button>
          <button onclick="telegramLogout()">Logout</button>
        </div>
      </section>
      <section id="cookies-section" style="display:none">
        <h2>Cookies</h2>
        <div id="cookie-sites"></div>
        <div id="cookie-paste-form" style="display:none">
          <textarea id="cookie-textarea" rows="10" placeholder="Paste JSON cookies here"></textarea>
          <button onclick="submitCookies()">Submit</button>
        </div>
      </section>
    </main>
  \`;
  
  window.showSection = showSection;
  window.sendTelegramCode = sendTelegramCode;
  window.submitTelegramCode = submitTelegramCode;
  window.telegramLogout = telegramLogout;
  window.showCookiePasteForm = showCookiePasteForm;
  window.submitCookies = submitCookies;
  
  showSection('health');
}

document.addEventListener('DOMContentLoaded', renderDashboard);
