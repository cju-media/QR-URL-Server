const http = require('http');
const { parse } = require('querystring');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = path.join(__dirname, 'urls.json');
const USER = 'TheCathedralFCCLA';
const REPO = 'OW';

let storedData = { program: "None", giving: "None", autoCheckGithub: false, autoGiving: false, lastForcedSunday: "" };

if (fs.existsSync(DATA_FILE)) {
    try {
        const fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        storedData = { ...storedData, ...fileData };
    } catch (e) { console.error("File error"); }
}

const ensureAbsolute = (url) => {
    if (!url || url === "None") return url;
    const cleaned = url.trim().replace(/%+$/, ''); 
    if (!/^https?:\/\//i.test(cleaned)) return 'https://' + cleaned;
    return cleaned;
};

const getJSON = (url) => {
    return new Promise((resolve, reject) => {
        const options = { headers: { 'User-Agent': 'Node-Script' } };
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) reject(new Error(`GitHub Error: ${res.statusCode}`));
                else resolve(JSON.parse(data));
            });
        }).on('error', reject);
    });
};

const getLatestPDFUrl = async () => {
    try {
        const commits = await getJSON(`https://api.github.com/repos/${USER}/${REPO}/commits`);
        const sha = commits[0].sha;
        const files = await getJSON(`https://api.github.com/repos/${USER}/${REPO}/contents/?ref=${sha}`);
        const pdf = files.find(f => f.name.toLowerCase().endsWith('.pdf'));
        if (!pdf) return null;
        const rawUrl = `https://raw.githubusercontent.com/${USER}/${REPO}/${sha}/${encodeURIComponent(pdf.name)}`;
        return `https://docs.google.com/viewer?url=${encodeURIComponent(rawUrl)}&embedded=true`;
    } catch (err) { return null; }
};

const URL_GENERAL_FUNDS = "https://www.fccla.org/give";
const URL_COMMUNITY_GARDENS = "https://host.nxt.blackbaud.com/donor-form/?svcid=tcs&formId=58942e76-ff81-4c77-b722-326e81eb2ea3&envid=p-Pu-hBA3J6UOXabETMuZR_A&zone=usa&utm_source=qr_code";
const URL_FOOD_AT_FIRST = "https://host.nxt.blackbaud.com/donor-form/?svcid=renxt&formId=5d37b6cb-7c40-4c37-ac7a-f1648429468f&envid=p-Pu-hBA3J6UOXabETMuZR_A&zone=usa&utm_source=qr_code";

const getAutoGivingUrl = () => {
    const now = new Date();
    // 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    const dayOfWeek = now.getDay();

    // Calculate days until next Sunday (if today is Sunday, this adds 0 days)
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + daysUntilSunday);

    const week = Math.ceil(nextSunday.getDate() / 7);

    if (week === 1) {
        return URL_FOOD_AT_FIRST;
    } else if (week === 3) {
        return URL_COMMUNITY_GARDENS;
    } else {
        return URL_GENERAL_FUNDS;
    }
};

const getUpcomingGivingUrl = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;

    const upcomingSunday = new Date(now);
    // Add an extra 7 days to get the Sunday *after* the next one
    upcomingSunday.setDate(now.getDate() + daysUntilSunday + 7);

    const week = Math.ceil(upcomingSunday.getDate() / 7);

    if (week === 1) {
        return URL_FOOD_AT_FIRST;
    } else if (week === 3) {
        return URL_COMMUNITY_GARDENS;
    } else {
        return URL_GENERAL_FUNDS;
    }
};

setInterval(async () => {
    let updated = false;
    const now = new Date();

    // Always force to autoGiving on Sunday at 12am
    if (now.getDay() === 0 && storedData.lastForcedSunday !== now.toDateString()) {
        storedData.autoGiving = true;
        storedData.lastForcedSunday = now.toDateString();
        updated = true;
    }

    if (storedData.autoCheckGithub) {
        const newUrl = await getLatestPDFUrl();
        if (newUrl && newUrl !== storedData.program) {
            storedData.program = newUrl;
            updated = true;
        }
    }

    if (storedData.autoGiving) {
        const newGivingUrl = getAutoGivingUrl();
        if (newGivingUrl !== storedData.giving) {
            storedData.giving = newGivingUrl;
            updated = true;
        }
    }

    if (updated) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(storedData, null, 2));
    }
}, 10000);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // --- MAX/MSP RECOVERY OUTPUT ---
    if (url.pathname === '/get') {
        // We set the charset to utf-8 to ensure Max reads the symbols correctly
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        
        // Removed the comma. Using a simple space. 
        // Max [maxurl] prefers raw strings without trailing punctuation.
        const output = `${storedData.program} ${storedData.giving}`;
        
        res.end(output); 
        return;
    }

    if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...storedData, upcomingGiving: getUpcomingGivingUrl() }));
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const formData = parse(body);
            storedData.autoCheckGithub = (formData.useGithub === 'on');
            if (storedData.autoCheckGithub) {
                const gitUrl = await getLatestPDFUrl();
                if (gitUrl) storedData.program = gitUrl;
            } else if (formData.programUrl) {
                storedData.program = ensureAbsolute(formData.programUrl);
            }

            storedData.autoGiving = (formData.useAutoGiving === 'on');
            if (storedData.autoGiving) {
                storedData.giving = getAutoGivingUrl();
            } else if (formData.givingUrl) {
                storedData.giving = ensureAbsolute(formData.givingUrl);
            }

            fs.writeFileSync(DATA_FILE, JSON.stringify(storedData, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(storedData));
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: sans-serif; background: #f0f2f5; display: flex; justify-content: center; padding: 20px; }
                    .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
                    .poll-status { font-size: 0.75em; padding: 4px 10px; border-radius: 20px; font-weight: bold; text-transform: uppercase; display: inline-block; margin-bottom: 15px; }
                    .status-on { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; animation: pulse 2s infinite; }
                    .status-off { background: #e2e3e5; color: #383d41; border: 1px solid #d6d8db; }
                    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
                    input[type="text"] { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
                    button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; margin-top: 10px; }
                    button:disabled { background: #ccc; }
                    .status-section { margin-top: 25px; padding-top: 15px; border-top: 1px solid #eee; font-size: 0.85em; color: #444; }
                    .url-text { color: #0066cc; word-break: break-all; display: block; margin-bottom: 10px; text-decoration: none; font-family: monospace; background: #f8f9fa; padding: 5px; border-radius: 4px; }
                    label { font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div id="mainBadge" class="poll-status ${(storedData.autoCheckGithub || storedData.autoGiving) ? 'status-on' : 'status-off'}">
                        ${(storedData.autoCheckGithub || storedData.autoGiving) ? 'Auto-Polling Active' : 'Manual Mode'}
                    </div>
                    <h2 style="margin:0 0 15px 0">URL Controller</h2>
                    <form id="urlForm">
                        <label>Program URL</label>
                        <input type="text" id="pUrl" placeholder="Enter manual URL...">
                        <div style="margin-bottom:20px;">
                            <input type="checkbox" id="gh" ${storedData.autoCheckGithub ? 'checked' : ''}> 
                            <label for="gh" style="font-weight:normal; font-size:0.9em; cursor:pointer;">Auto-fetch PDF from GitHub (10s)</label>
                        </div>
                        <label>Giving URL</label>
                        <select id="gUrl" style="width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; background: white;">
                            <option value="">-- Manual Override / Unchanged --</option>
                            <option value="${URL_FOOD_AT_FIRST}">Food@First (Week 1)</option>
                            <option value="${URL_COMMUNITY_GARDENS}">Community Gardens (Week 3)</option>
                            <option value="${URL_GENERAL_FUNDS}">General Funds (Week 2, 4, 5)</option>
                        </select>
                        <input type="text" id="gUrlCustom" placeholder="Or manually enter custom giving URL...">
                        <div style="margin-bottom:20px;">
                            <input type="checkbox" id="ag" ${storedData.autoGiving ? 'checked' : ''}>
                            <label for="ag" style="font-weight:normal; font-size:0.9em; cursor:pointer;">Auto-update Giving based on week of the month</label>
                        </div>
                        <button type="submit" id="btn">Update System</button>
                    </form>
                    <div class="status-section">
                        <strong>Current Program:</strong>
                        <a href="${ensureAbsolute(storedData.program)}" target="_blank" id="dispProg" class="url-text">${storedData.program}</a>
                        <strong>Current Giving:</strong>
                        <a href="${ensureAbsolute(storedData.giving)}" target="_blank" id="dispGive" class="url-text">${storedData.giving}</a>
                        <strong>Upcoming Giving:</strong>
                        <a href="${getUpcomingGivingUrl()}" target="_blank" id="dispUpcomingGive" class="url-text">${getUpcomingGivingUrl()}</a>
                    </div>
                </div>
                <script>
                    async function refreshUI() {
                        try {
                            const res = await fetch('/status');
                            const data = await res.json();
                            document.getElementById('dispProg').innerText = data.program;
                            document.getElementById('dispProg').href = data.program;
                            document.getElementById('dispGive').innerText = data.giving;
                            document.getElementById('dispGive').href = data.giving;
                            document.getElementById('dispUpcomingGive').innerText = data.upcomingGiving;
                            document.getElementById('dispUpcomingGive').href = data.upcomingGiving;
                            const badge = document.getElementById('mainBadge');
                            const isAuto = data.autoCheckGithub || data.autoGiving;
                            badge.innerText = isAuto ? 'Auto-Polling Active' : 'Manual Mode';
                            badge.className = 'poll-status ' + (isAuto ? 'status-on' : 'status-off');
                            document.getElementById('ag').checked = data.autoGiving;
                        } catch (e) {}
                    }
                    setInterval(refreshUI, 10000);
                    document.getElementById('urlForm').onsubmit = async (e) => {
                        e.preventDefault();
                        const btn = document.getElementById('btn');
                        btn.disabled = true; btn.innerText = 'Updating...';
                        const bodyParams = new URLSearchParams();
                        if (document.getElementById('gh').checked) bodyParams.append('useGithub', 'on');
                        if (document.getElementById('ag').checked) bodyParams.append('useAutoGiving', 'on');
                        if (document.getElementById('pUrl').value) bodyParams.append('programUrl', document.getElementById('pUrl').value);

                        const customUrl = document.getElementById('gUrlCustom').value;
                        const dropUrl = document.getElementById('gUrl').value;
                        if (customUrl) {
                            bodyParams.append('givingUrl', customUrl);
                        } else if (dropUrl) {
                            bodyParams.append('givingUrl', dropUrl);
                        }

                        try {
                            const response = await fetch('/', { method: 'POST', body: bodyParams });
                            const data = await response.json();
                            refreshUI(); e.target.reset();
                            document.getElementById('gh').checked = data.autoCheckGithub;
                            document.getElementById('ag').checked = data.autoGiving;
                            btn.innerText = 'Updated!';
                            setTimeout(() => { btn.innerText = 'Update System'; btn.disabled = false; }, 1500);
                        } catch (err) { btn.disabled = false; }
                    };
                </script>
            </body>
            </html>
        `);
    }
});

server.listen(3000, '0.0.0.0', () => console.log('Server Active. Output: URL1 URL2'));