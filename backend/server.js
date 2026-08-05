// backend/server.js - Complete with All Features
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// FILE UPLOAD SETUP
// ============================================
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============================================
// CONFIGURATION
// ============================================
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet1";
const MAX_EMAILS_PER_DAY = parseInt(process.env.MAX_EMAILS_PER_DAY) || 50;
const DELAY_BETWEEN_EMAILS = parseInt(process.env.DELAY_BETWEEN_EMAILS) || 30000;

// ============================================
// LOGGING
// ============================================
function log(message, type = "INFO") {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

// ============================================
// GOOGLE SHEETS CLIENT
// ============================================
/* async function getGoogleSheetsClient() {
    try {
        if (!fs.existsSync("credentials.json")) {
            throw new Error("credentials.json not found!");
        }

        const credentials = JSON.parse(
            fs.readFileSync("credentials.json", "utf8")
        );

        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        return google.sheets({ version: "v4", auth });
    } catch (error) {
        log(`Failed to setup Google Sheets: ${error.message}`, "ERROR");
        throw error;
    }
}  */


    async function getGoogleSheetsClient() {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) {
            throw new Error("GOOGLE_CREDENTIALS environment variable missing!");
        }

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                "https://www.googleapis.com/auth/spreadsheets"
            ],
        });

        return google.sheets({
            version: "v4",
            auth
        });

    } catch (error) {
        log(`Failed to setup Google Sheets: ${error.message}`, "ERROR");
        throw error;
    }
}




// ============================================
// READ FROM GOOGLE SHEETS
// ============================================
async function readFromGoogleSheets(sheets, sheetName = SHEET_NAME) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:H`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return [];
        }

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                obj[header.toLowerCase().trim()] = row[index] || "";
            });
            return obj;
        });

        return data;
    } catch (error) {
        log(`Error reading Google Sheets: ${error.message}`, "ERROR");
        throw error;
    }
}

// ============================================
// UPDATE SHEET - DIRECT CELL UPDATE
// ============================================
async function updateSheetRow(sheets, email, updates, sheetName = SHEET_NAME) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const rows = response.data.values;
        let rowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === email) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex === -1) {
            log(`Email ${email} not found in sheet`, "WARNING");
            return false;
        }

        const columnMap = { 
            status: 'E', 
            dateSent: 'F', 
            response: 'G', 
            notes: 'H' 
        };

        for (const [key, value] of Object.entries(updates)) {
            if (columnMap[key]) {
                const cellValue = (value === undefined || value === null) ? '' : String(value);
                
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheetName}!${columnMap[key]}${rowIndex}`,
                    valueInputOption: "RAW",
                    resource: { 
                        values: [[cellValue]] 
                    },
                });
            }
        }

        log(`Updated row for ${email} in ${sheetName}`, "SUCCESS");
        return true;
    } catch (error) {
        log(`Error updating sheet: ${error.message}`, "ERROR");
        return false;
    }
}

// ============================================
// APPEND NEW ROW TO SHEET
// ============================================
async function appendSheetRow(sheets, rowData, sheetName = SHEET_NAME) {
    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:H`,
            valueInputOption: "RAW",
            resource: {
                values: [rowData]
            },
        });
        log(`Added new row to sheet ${sheetName}`, "SUCCESS");
        return true;
    } catch (error) {
        log(`Error appending row: ${error.message}`, "ERROR");
        return false;
    }
}

// ============================================
// GET TODAY'S DATE
// ============================================
function getToday() {
    return new Date().toISOString().split('T')[0];
}

// ============================================
// GET TODAY'S SENT COUNT
// ============================================
async function getTodaySentCount(sheets, sheetName = SHEET_NAME) {
    try {
        const data = await readFromGoogleSheets(sheets, sheetName);
        const today = getToday();
        
        const todaySent = data.filter(row => {
            const status = row.status?.toLowerCase() || '';
            const dateSent = row.dateSent || '';
            return status === 'sent' && dateSent.includes(today);
        });
        
        return todaySent.length;
    } catch (error) {
        log(`Error counting today's sent: ${error.message}`, "ERROR");
        return 0;
    }
}

// ============================================
// GET REMAINING EMAILS
// ============================================
async function getRemainingEmails(sheets, sheetName = SHEET_NAME) {
    try {
        const todaySent = await getTodaySentCount(sheets, sheetName);
        return Math.max(0, MAX_EMAILS_PER_DAY - todaySent);
    } catch (error) {
        log(`Error getting remaining: ${error.message}`, "ERROR");
        return MAX_EMAILS_PER_DAY;
    }
}

// ============================================
// EMAIL TRANSPORTER
// ============================================
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ============================================
// EMAIL TEMPLATE
// ============================================
function generateEmailHTML(data) {
    const firstName = data.firstname || data.firstName || "Hiring Team";
    const company = data.company || "your company";
    const jobTitle = data.jobtitle || data.jobTitle || "Software Developer";

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&display=swap');
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Inter', Arial, sans-serif; background: #f0f4ff; padding: 40px 20px; }
            .container { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 28px; box-shadow: 0 30px 80px rgba(0,0,0,0.12); overflow: hidden; }
            .header { position: relative; padding: 50px 45px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #f5576c 75%, #4facfe 100%); color: white; overflow: hidden; }
            .header h1 { font-size: 38px; font-weight: 900; margin-bottom: 6px; letter-spacing: -1px; }
            .header .subtitle { font-size: 20px; font-weight: 300; opacity: 0.95; margin-bottom: 15px; }
            .company-tag { display: inline-flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.15); padding: 10px 24px; border-radius: 50px; font-size: 15px; font-weight: 600; border: 1px solid rgba(255,255,255,0.15); }
            .body-content { padding: 40px 45px 35px; color: #1e293b; }
            .greeting { font-size: 20px; font-weight: 700; margin-bottom: 15px; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .skills-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; background: #f8fafc; padding: 25px 30px; border-radius: 12px; margin: 20px 0; }
            .skills-grid-item { font-size: 14px; color: #334155; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
            .skills-grid-item::before { content: '▸'; color: #667eea; font-weight: 700; }
            .links-section { background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 12px; padding: 25px 30px; margin: 25px 0; color: white; }
            .links-section a { color: #fbbc04; text-decoration: none; font-weight: 600; }
            .cta-section { background: linear-gradient(135deg, #e8f5e9, #c8e6c9); border-radius: 12px; padding: 20px 25px; margin: 25px 0; border-left: 4px solid #34a853; }
            .signature { margin-top: 30px; padding-top: 25px; border-top: 2px solid #e8edf4; }
            .signature .name { font-size: 20px; font-weight: 800; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .footer { background: #f8fafc; padding: 20px 45px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e8edf4; }
            .footer a { color: #667eea; text-decoration: none; }
            @media (max-width: 600px) { .header { padding: 35px 25px 30px; } .header h1 { font-size: 28px; } .body-content { padding: 25px 20px; } .skills-grid { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${jobTitle}</h1>
                <div class="subtitle">Flutter & Full-Stack Developer</div>
                <div class="company-tag">❤️ Interested in <strong>${company}</strong></div>
            </div>
            <div class="body-content">
                <div class="greeting">👋 Dear ${firstName},</div>
                <p style="margin-bottom: 20px;">I hope you're having a great day! I'm <strong>Gulam Mahdi Hasan</strong>, a passionate Software Engineer specializing in <strong>Flutter & Full-Stack Development</strong> with a B.Sc. in Computer Science & Engineering from United International University (UIU).</p>
                <p style="margin-bottom: 20px;">I'm reaching out to explore <strong>remote or project-based opportunities</strong> at <strong>${company}</strong>. I'm confident that my skills and experience can bring value to your team.</p>
                <div class="skills-grid">
                    <div class="skills-grid-item">Flutter & Dart (Expert)</div>
                    <div class="skills-grid-item">React.js & Next.js</div>
                    <div class="skills-grid-item">Node.js & Express.js</div>
                    <div class="skills-grid-item">TypeScript & JavaScript</div>
                    <div class="skills-grid-item">MongoDB & Firebase</div>
                    <div class="skills-grid-item">PostgreSQL & REST APIs</div>
                    <div class="skills-grid-item">Authentication Systems</div>
                    <div class="skills-grid-item">Payment Integrations</div>
                    <div class="skills-grid-item">Real-time Communication</div>
                    <div class="skills-grid-item">AWS & Cloud Services</div>
                    <div class="skills-grid-item">Docker & CI/CD</div>
                    <div class="skills-grid-item">Performance Optimization</div>
                </div>
                <div class="links-section">
                    <div style="font-weight: 700; font-size: 16px; margin-bottom: 12px;">🔗 Connect With Me</div>
                    <div style="padding: 4px 0;">🌐 <strong>Portfolio:</strong> <a href="https://contactmahdihasan.vercel.app">contactmahdihasan.vercel.app</a></div>
                    <div style="padding: 4px 0;">🐙 <strong>GitHub:</strong> <a href="https://github.com/contacthasan09">github.com/contacthasan09</a></div>
                    <div style="padding: 4px 0;">💼 <strong>LinkedIn:</strong> <a href="https://linkedin.com/in/your-profile">linkedin.com/in/your-profile</a></div>
                </div>
                <div class="cta-section">
                    <p style="font-weight: 600;">📌 Why Work With Me?</p>
                    <ul style="margin: 10px 0 0 20px; font-size: 14px;">
                        <li>✅ 3+ years of production-ready development experience</li>
                        <li>✅ Cross-platform expertise (Android, iOS, Web)</li>
                        <li>✅ End-to-end project delivery</li>
                        <li>✅ Independent & collaborative work style</li>
                    </ul>
                </div>
                <p style="margin: 20px 0;"><strong>📎 My CV is attached</strong> for your review. I'd love to discuss how I can contribute to your team at <strong>${company}</strong>.</p>
                <p style="margin: 15px 0;">Are you available for a brief call or video meeting this week? I'm flexible and happy to work around your schedule.</p>
                <p style="margin: 15px 0;">Thank you for your time and consideration. I look forward to hearing from you!</p>
                <div class="signature">
                    <div class="name">Gulam Mahdi Hasan</div>
                    <div style="font-size: 15px; color: #475569;">Software Engineer | Flutter & Full-Stack Developer</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 15px 25px; margin-top: 10px; font-size: 14px; color: #475569;">
                        <span>📱 +880 1234 567890</span>
                        <span>✉️ ${process.env.EMAIL_USER}</span>
                        <span>📍 Dhaka, Bangladesh</span>
                    </div>
                </div>
            </div>
            <div class="footer">
                <p>This email is sent as part of a job application to ${company}.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

// ============================================
// SEND EMAIL FUNCTION
// ============================================
async function sendEmail(data) {
    const emailHTML = generateEmailHTML(data);

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: data.email,
        subject: `🚀 ${data.jobTitle} | ${data.company} - Gulam Mahdi Hasan`,
        html: emailHTML,
        attachments: []
    };

    const resumePaths = [
        "attachments/resume.pdf",
        "attachments/Hasan's CV-Resume.pdf",
        "attachments/Hasan_CV_Resume.pdf",
        "attachments/Hasan CV-Resume.pdf",
        "../attachments/resume.pdf"
    ];

    for (const path of resumePaths) {
        if (fs.existsSync(path)) {
            mailOptions.attachments.push({
                filename: "Hasan_CV_Resume.pdf",
                path: path,
            });
            break;
        }
    }

    return transporter.sendMail(mailOptions);
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is running!" });
});

// ============================================
// GET ALL SHEETS (SHOW ALL SHEETS IN DROPDOWN)
// ============================================
app.get("/api/sheets", async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const response = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
        });
        
        const sheetNames = response.data.sheets.map(sheet => sheet.properties.title);
        
        log(`Found ${sheetNames.length} sheets: ${sheetNames.join(', ')}`, "INFO");
        
        res.json({ 
            success: true, 
            sheets: sheetNames 
        });
    } catch (error) {
        log(`Error getting sheets: ${error.message}`, "ERROR");
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// READ DATA FROM SPECIFIC SHEET
// ============================================
app.get("/api/sheet-data/:sheetName", async (req, res) => {
    try {
        const { sheetName } = req.params;
        const sheets = await getGoogleSheetsClient();
        const data = await readFromGoogleSheets(sheets, sheetName);
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        res.json({ success: true, headers: headers, data: data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// GET PENDING APPLICATIONS
// ============================================
app.get("/api/pending-applications", async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const data = await readFromGoogleSheets(sheets);
        const pending = data.filter(row => row.status?.toLowerCase() === "pending");
        const remaining = await getRemainingEmails(sheets);
        res.json({ success: true, applications: pending, remaining: remaining, total: data.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// ADD NEW ROW TO SHEET
// ============================================
app.post("/api/add-row", async (req, res) => {
    try {
        const { email, firstName, company, jobTitle, status, sheetName } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: "Email is required" 
            });
        }

        const sheets = await getGoogleSheetsClient();
        const targetSheet = sheetName || SHEET_NAME;
        
        const sheetData = await readFromGoogleSheets(sheets, targetSheet);
        const existingRow = sheetData.find(row => row.email === email);
        
        if (existingRow) {
            return res.status(400).json({
                success: false,
                message: `Email ${email} already exists in sheet "${targetSheet}"`
            });
        }

        const now = new Date();
        const timestamp = now.toISOString();
        
        const newRow = [
            email,
            firstName || "",
            company || "",
            jobTitle || "",
            status || "Pending",
            "",
            "",
            `Added from UI at ${timestamp}`
        ];
        
        const result = await appendSheetRow(sheets, newRow, targetSheet);
        
        if (result) {
            const updatedData = await readFromGoogleSheets(sheets, targetSheet);
            
            res.json({
                success: true,
                message: `Row added successfully to "${targetSheet}"`,
                data: {
                    email: email,
                    firstName: firstName,
                    company: company,
                    jobTitle: jobTitle,
                    status: status || "Pending"
                },
                totalRecords: updatedData.length
            });
        } else {
            res.status(500).json({
                success: false,
                message: "Failed to add row to sheet"
            });
        }
    } catch (error) {
        console.error('Error adding row:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// SEND ALL PENDING EMAILS
// ============================================
app.post("/api/send-all", async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const data = await readFromGoogleSheets(sheets);
        const pending = data.filter(row => row.status?.toLowerCase() === "pending");

        if (pending.length === 0) {
            return res.json({ success: false, message: "No pending applications found" });
        }

        const today = getToday();
        const todaySent = data.filter(row => {
            const status = row.status?.toLowerCase() || '';
            const dateSent = row.dateSent || '';
            return status === 'sent' && dateSent.includes(today);
        }).length;
        
        const remaining = Math.max(0, MAX_EMAILS_PER_DAY - todaySent);
        const maxToSend = Math.min(pending.length, remaining);

        if (maxToSend === 0) {
            return res.json({ 
                success: false, 
                message: `Daily limit reached (${MAX_EMAILS_PER_DAY}). Try again tomorrow.` 
            });
        }

        let sentCount = 0;
        let failedCount = 0;
        const results = [];

        for (let i = 0; i < maxToSend; i++) {
            const record = pending[i];
            try {
                await sendEmail(record);
                sentCount++;
                
                const now = new Date();
                const dateTimeSent = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
                
                await updateSheetRow(sheets, record.email, {
                    status: 'Sent',
                    dateSent: dateTimeSent,
                    response: `Sent to ${record.email}`,
                    notes: `Delivered at ${dateTimeSent}`
                });
                
                results.push({ email: record.email, company: record.company, status: "success" });
                
                if (i < maxToSend - 1) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_EMAILS));
                }
            } catch (error) {
                failedCount++;
                results.push({ email: record.email, company: record.company, status: "failed", error: error.message });
                await updateSheetRow(sheets, record.email, {
                    status: 'Failed',
                    notes: `Error: ${error.message}`
                });
            }
        }

        const updatedData = await readFromGoogleSheets(sheets);
        const updatedTodaySent = updatedData.filter(row => {
            const status = row.status?.toLowerCase() || '';
            const dateSent = row.dateSent || '';
            return status === 'sent' && dateSent.includes(today);
        }).length;
        
        const updatedRemaining = Math.max(0, MAX_EMAILS_PER_DAY - updatedTodaySent);

        res.json({
            success: true,
            message: "Emails sent successfully",
            sent: sentCount,
            failed: failedCount,
            results: results,
            remaining: updatedRemaining,
            todaySent: updatedTodaySent,
            dailyLimit: MAX_EMAILS_PER_DAY
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// SEND SINGLE EMAIL
// ============================================
app.post("/api/send-single", async (req, res) => {
    try {
        const { email, firstName, company, jobTitle, sheetName } = req.body;
        
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const sheets = await getGoogleSheetsClient();
        const targetSheet = sheetName || SHEET_NAME;
        
        const remaining = await getRemainingEmails(sheets, targetSheet);
        if (remaining <= 0) {
            return res.status(429).json({
                success: false,
                message: `Daily limit reached (${MAX_EMAILS_PER_DAY}). Try again tomorrow.`
            });
        }

        const data = {
            email: email,
            firstName: firstName || "Hiring Team",
            company: company || "your company",
            jobTitle: jobTitle || "Software Developer"
        };

        await sendEmail(data);
        
        const now = new Date();
        const dateTimeSent = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
        
        const sheetData = await readFromGoogleSheets(sheets, targetSheet);
        const existingRow = sheetData.find(row => row.email === email);
        
        if (existingRow) {
            await updateSheetRow(sheets, email, {
                status: 'Sent',
                dateSent: dateTimeSent,
                response: `Sent to ${email}`,
                notes: `Manually sent at ${dateTimeSent}`
            }, targetSheet);
        } else {
            const newRow = [
                email,
                firstName || "",
                company || "",
                jobTitle || "",
                "Sent",
                dateTimeSent,
                `Sent to ${email}`,
                `Manually sent at ${dateTimeSent}`
            ];
            await appendSheetRow(sheets, newRow, targetSheet);
        }

        const updatedRemaining = await getRemainingEmails(sheets, targetSheet);
        const updatedData = await readFromGoogleSheets(sheets, targetSheet);

        res.json({
            success: true,
            message: `Email sent to ${email}`,
            data: {
                email: email,
                firstName: firstName,
                company: company,
                jobTitle: jobTitle,
                status: "Sent",
                dateSent: dateTimeSent,
                notes: `Manually sent at ${dateTimeSent}`
            },
            remaining: updatedRemaining,
            totalRecords: updatedData.length
        });
    } catch (error) {
        console.error('Error in send-single:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// UPDATE STATUS
// ============================================
app.post("/api/update-status", async (req, res) => {
    try {
        const { email, status, notes, sheetName } = req.body;
        
        if (!email || !status) {
            return res.status(400).json({ success: false, message: "Email and status are required" });
        }

        const sheets = await getGoogleSheetsClient();
        const now = new Date();
        const dateTimeSent = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
        
        let updates = {};
        
        if (status.toLowerCase() === 'pending') {
            updates = {
                status: 'Pending',
                dateSent: '',
                notes: notes || `Status changed to Pending manually at ${dateTimeSent}`
            };
        } else if (status.toLowerCase() === 'sent') {
            updates = {
                status: 'Sent',
                dateSent: dateTimeSent,
                notes: notes || `Sent manually at ${dateTimeSent}`
            };
        } else if (status.toLowerCase() === 'failed') {
            updates = {
                status: 'Failed',
                notes: notes || `Failed manually at ${dateTimeSent}`
            };
        }
        
        const result = await updateSheetRow(sheets, email, updates, sheetName || SHEET_NAME);

        if (result) {
            res.json({
                success: true,
                message: `Status updated to ${status} for ${email}`,
                data: {
                    email: email,
                    status: status,
                    dateSent: updates.dateSent || '',
                    notes: updates.notes || ''
                }
            });
        } else {
            res.json({
                success: false,
                message: `Failed to update status for ${email}`
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// GET STATS
// ============================================
app.get("/api/stats", async (req, res) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const data = await readFromGoogleSheets(sheets);
        
        const today = getToday();
        
        const todaySent = data.filter(row => {
            const status = row.status?.toLowerCase() || '';
            const dateSent = row.dateSent || '';
            return status === 'sent' && dateSent.includes(today);
        }).length;
        
        const totalSent = data.filter(r => r.status?.toLowerCase() === "sent").length;
        const remaining = Math.max(0, MAX_EMAILS_PER_DAY - todaySent);

        const stats = {
            total: data.length,
            pending: data.filter(r => r.status?.toLowerCase() === "pending").length,
            sent: totalSent,
            todaySent: todaySent,
            failed: data.filter(r => r.status?.toLowerCase() === "failed").length,
            remaining: remaining,
            dailyLimit: MAX_EMAILS_PER_DAY,
            dateToday: today
        };

        log(`Stats: Remaining: ${stats.remaining}, Today Sent: ${stats.todaySent}`, "INFO");

        res.json({ success: true, stats: stats });
    } catch (error) {
        log(`Error getting stats: ${error.message}`, "ERROR");
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// UPLOAD RESUME
// ============================================
app.post("/api/upload-resume", upload.single("resume"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const tempPath = req.file.path;
        const targetPath = "attachments/resume.pdf";

        if (!fs.existsSync("attachments")) {
            fs.mkdirSync("attachments");
        }

        fs.copyFileSync(tempPath, targetPath);
        fs.unlinkSync(tempPath);

        res.json({ success: true, message: "Resume uploaded successfully", path: targetPath });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints:`);
    console.log(`   GET  /api/stats`);
    console.log(`   GET  /api/sheets`);
    console.log(`   GET  /api/sheet-data/:sheetName`);
    console.log(`   GET  /api/pending-applications`);
    console.log(`   POST /api/add-row`);
    console.log(`   POST /api/send-all`);
    console.log(`   POST /api/send-single`);
    console.log(`   POST /api/update-status`);
    console.log(`   POST /api/upload-resume`);
    console.log(`   GET  /api/health\n`);
});