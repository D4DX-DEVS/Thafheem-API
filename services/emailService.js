const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// File logger for email events — check logs/email.log in cPanel File Manager
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'email.log');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function emailLog(level, message) {
  const timestamp = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' });
  const line = `[${timestamp}] [${level}] ${message}\n`;
  console[level === 'ERROR' ? 'error' : 'log'](line.trim());
  fs.appendFileSync(LOG_FILE, line);
}

// Email microservice configuration (hosted on DigitalOcean)
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL;
const EMAIL_SERVICE_API_KEY = process.env.EMAIL_SERVICE_API_KEY;

if (EMAIL_SERVICE_URL && EMAIL_SERVICE_API_KEY) {
  emailLog('INFO', `Email service configured — URL: ${EMAIL_SERVICE_URL}`);
} else {
  emailLog('WARN', `Email service not configured — URL: ${EMAIL_SERVICE_URL || '(empty)'}, API_KEY: ${EMAIL_SERVICE_API_KEY ? '(set)' : '(empty)'}`);
}

function httpPost(url, data, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
      },
    };

    const req = transport.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

async function callEmailService(endpoint, data) {
  if (!EMAIL_SERVICE_URL || !EMAIL_SERVICE_API_KEY) return;

  try {
    const url = `${EMAIL_SERVICE_URL}${endpoint}`;
    const result = await httpPost(url, data, EMAIL_SERVICE_API_KEY);

    if (result.status >= 200 && result.status < 300) {
      emailLog('INFO', `✅ Email sent via ${endpoint} — ${data.name} (${data.email})`);
    } else {
      const errMsg = result.data?.error || result.data?.detail || JSON.stringify(result.data);
      emailLog('ERROR', `❌ Email service returned ${result.status} for ${endpoint} — ${errMsg}`);
    }
  } catch (error) {
    emailLog('ERROR', `❌ Email service call failed for ${endpoint} — ${error.message}`);
  }
}

const sendFeedbackNotification = async (data) => {
  await callEmailService('/send-feedback', data);
};

const sendFeatureRequestNotification = async (data) => {
  await callEmailService('/send-feature-request', data);
};

module.exports = {
  sendFeedbackNotification,
  sendFeatureRequestNotification,
};
