require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'voiceagent_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ PostgreSQL connection error:', err);
    } else {
        console.log('✅ PostgreSQL connected successfully at:', res.rows[0].now);
    }
});

// ============================================
// GOOGLE APIS SETUP
// ============================================

let driveClient = null;
let youtubeClient = null;

// Initialize Google Drive API
if (process.env.GOOGLE_API_KEY) {
    driveClient = google.drive({
        version: 'v3',
        auth: process.env.GOOGLE_API_KEY
    });
    console.log('✅ Google Drive API initialized');
}

// Initialize YouTube API
if (process.env.GOOGLE_API_KEY) {
    youtubeClient = google.youtube({
        version: 'v3',
        auth: process.env.GOOGLE_API_KEY
    });
    console.log('✅ YouTube API initialized');
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Token mancante' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT verification error:', err);
        return res.status(401).json({ error: 'Token non valido' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accesso negato: admin richiesto' });
    }
    next();
}

// ============================================
// AUTH ROUTES (unchanged)
// ============================================

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name, role = 'student' } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Email, password e nome richiesti' });
    }

    const client = await pool.connect();
    try {
        const userExists = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Email già registrata' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await client.query(
            `INSERT INTO users (email, password, name, role, minutes_limit, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW()) 
             RETURNING id, email, name, role, minutes_limit`,
            [email.toLowerCase(), hashedPassword, name, role, role === 'admin' ? 999999 : 120]
        );

        const user = result.rows[0];

        // Create student level entry if student
        if (role === 'student') {
            await client.query(
                `INSERT INTO student_levels (user_id, level, created_at) 
                 VALUES ($1, 'A1', NOW())`,
                [user.id]
            );
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Registrazione completata',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                minutes_limit: user.minutes_limit
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Errore durante la registrazione' });
    } finally {
        client.release();
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email e password richiesti' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        await client.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Login effettuato',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                minutes_limit: user.minutes_limit
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Errore durante il login' });
    } finally {
        client.release();
    }
});

// ============================================
// USER ROUTES
// ============================================

app.get('/api/user/profile', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT u.id, u.email, u.name, u.role, u.minutes_limit, u.created_at,
                    sl.level, sl.topics, sl.target_voice, sl.learning_goals
             FROM users u
             LEFT JOIN student_levels sl ON u.id = sl.user_id
             WHERE u.id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.get('/api/user/usage', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [dailyUsage, monthlyUsage, userLimits] = await Promise.all([
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date = $2',
                [req.user.userId, today]
            ),
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date >= $2',
                [req.user.userId, firstDayOfMonth]
            ),
            client.query(
                'SELECT minutes_limit FROM users WHERE id = $1',
                [req.user.userId]
            )
        ]);

        const minutesLimit = userLimits.rows[0]?.minutes_limit || 120;
        const dailyMinutes = parseFloat(dailyUsage.rows[0].total);
        const monthlyMinutes = parseFloat(monthlyUsage.rows[0].total);

        res.json({
            daily_minutes: Math.round(dailyMinutes * 100) / 100,
            monthly_minutes: Math.round(monthlyMinutes * 100) / 100,
            minutes_limit: minutesLimit,
            remaining_minutes: Math.max(0, Math.round((minutesLimit - monthlyMinutes) * 100) / 100)
        });
    } catch (err) {
        console.error('Get usage error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.post('/api/user/usage', authenticate, async (req, res) => {
    const { minutes } = req.body;

    if (typeof minutes !== 'number' || minutes <= 0) {
        return res.status(400).json({ error: 'Minuti non validi' });
    }

    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];

        const existing = await client.query(
            'SELECT id, minutes_used FROM usage WHERE user_id = $1 AND date = $2',
            [req.user.userId, today]
        );

        if (existing.rows.length > 0) {
            await client.query(
                'UPDATE usage SET minutes_used = minutes_used + $1 WHERE id = $2',
                [minutes, existing.rows[0].id]
            );
        } else {
            await client.query(
                'INSERT INTO usage (user_id, date, minutes_used) VALUES ($1, $2, $3)',
                [req.user.userId, today, minutes]
            );
        }

        res.json({ message: 'Utilizzo registrato', minutes_added: minutes });
    } catch (err) {
        console.error('Add usage error:', err);
        res.status(500).json({ error: 'Errore registrazione utilizzo' });
    } finally {
        client.release();
    }
});

// ============================================
// CHAT ENDPOINT - ENHANCED WITH LEARNING MATERIALS
// ============================================

app.post('/api/chat', authenticate, async (req, res) => {
    const { message, conversation_history = [], session_type = 'conversation', level, topic } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Messaggio richiesto' });
    }

    const client = await pool.connect();
    try {
        // Check usage limits
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [monthlyUsage, userLimits, studentLevel] = await Promise.all([
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date >= $2',
                [req.user.userId, firstDayOfMonth]
            ),
            client.query(
                'SELECT minutes_limit FROM users WHERE id = $1',
                [req.user.userId]
            ),
            client.query(
                'SELECT level, topics FROM student_levels WHERE user_id = $1',
                [req.user.userId]
            )
        ]);

        const minutesLimit = userLimits.rows[0]?.minutes_limit || 120;
        const monthlyMinutes = parseFloat(monthlyUsage.rows[0].total);

        if (monthlyMinutes >= minutesLimit) {
            return res.status(429).json({ 
                error: 'Limite mensile raggiunto',
                minutes_used: monthlyMinutes,
                minutes_limit: minutesLimit
            });
        }

        // Get relevant learning materials
        const studentLevelData = studentLevel.rows[0];
        const userLevel = level || studentLevelData?.level || 'A1';
        const userTopic = topic || session_type;

        const materials = await client.query(
            `SELECT title, content, description 
             FROM materials 
             WHERE is_active = true 
             AND (level = $1 OR level IS NULL)
             AND (topic = $2 OR topic IS NULL)
             AND content IS NOT NULL
             LIMIT 5`,
            [userLevel, userTopic]
        );

        // Build enhanced system prompt
        let systemPrompt = `You are an English language teacher assistant. 
Student level: ${userLevel}
Session type: ${session_type}
Topic: ${userTopic}

Your role:
- Help students practice English naturally
- Correct errors gently and explain why
- Adapt difficulty to student level
- Be encouraging and supportive
- Use the learning materials provided as reference

Learning materials available:
${materials.rows.map(m => `- ${m.title}: ${m.description || ''}`).join('\n')}
`;

        if (session_type === 'grammar') {
            systemPrompt += '\nFocus on grammar: explain rules, give examples, and correct mistakes.';
        } else if (session_type === 'pronunciation') {
            systemPrompt += '\nFocus on pronunciation: point out common mistakes, suggest better phrasing.';
        } else if (session_type === 'vocabulary') {
            systemPrompt += '\nFocus on vocabulary: teach new words, synonyms, and usage in context.';
        }

        // Add material content as context
        if (materials.rows.length > 0) {
            systemPrompt += '\n\nRelevant material excerpts:\n';
            materials.rows.forEach(m => {
                if (m.content) {
                    const excerpt = m.content.substring(0, 500);
                    systemPrompt += `\n${m.title}:\n${excerpt}...\n`;
                }
            });
        }

        // Call Anthropic API
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                system: systemPrompt,
                messages: [
                    ...conversation_history,
                    { role: 'user', content: message }
                ]
            })
        });

        if (!anthropicResponse.ok) {
            const errorData = await anthropicResponse.text();
            console.error('Anthropic API error:', errorData);
            return res.status(anthropicResponse.status).json({ 
                error: 'Errore API Anthropic',
                details: errorData
            });
        }

        const data = await anthropicResponse.json();
        const assistantMessage = data.content[0].text;

        // Estimate minutes used
        const wordCount = assistantMessage.split(/\s+/).length;
        const estimatedMinutes = Math.round((wordCount / 150) * 100) / 100;

        // Update usage
        const existing = await client.query(
            'SELECT id, minutes_used FROM usage WHERE user_id = $1 AND date = $2',
            [req.user.userId, today]
        );

        if (existing.rows.length > 0) {
            await client.query(
                'UPDATE usage SET minutes_used = minutes_used + $1 WHERE id = $2',
                [estimatedMinutes, existing.rows[0].id]
            );
        } else {
            await client.query(
                'INSERT INTO usage (user_id, date, minutes_used) VALUES ($1, $2, $3)',
                [req.user.userId, today, estimatedMinutes]
            );
        }

        res.json({
            response: assistantMessage,
            minutes_used: estimatedMinutes,
            level: userLevel,
            materials_used: materials.rows.map(m => m.title)
        });
    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: 'Errore durante la chat' });
    } finally {
        client.release();
    }
});

// ============================================
// TTS SETTINGS MANAGEMENT (Admin)
// ============================================
// Aggiungi questo codice nel server.js dopo l'endpoint /api/tts

// Get TTS settings (Admin only)
app.get('/api/admin/tts-settings', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        // Check if settings exist
        let result = await client.query(
            `SELECT * FROM api_configs WHERE config_key = 'tts_daily_limit'`
        );

        if (result.rows.length === 0) {
            // Create default setting
            await client.query(
                `INSERT INTO api_configs (config_key, config_value, description)
                 VALUES ('tts_daily_limit', '15', 'Daily premium TTS limit per student')
                 RETURNING *`
            );
            result = await client.query(
                `SELECT * FROM api_configs WHERE config_key = 'tts_daily_limit'`
            );
        }

        res.json({
            dailyLimit: parseInt(result.rows[0].config_value),
            description: result.rows[0].description
        });
    } catch (err) {
        console.error('Get TTS settings error:', err);
        res.status(500).json({ error: 'Failed to get TTS settings' });
    } finally {
        client.release();
    }
});

// Update TTS settings (Admin only)
app.put('/api/admin/tts-settings', authenticate, requireAdmin, async (req, res) => {
    const { dailyLimit } = req.body;

    if (!dailyLimit || dailyLimit < 0) {
        return res.status(400).json({ error: 'Invalid daily limit' });
    }

    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO api_configs (config_key, config_value, description)
             VALUES ('tts_daily_limit', $1, 'Daily premium TTS limit per student')
             ON CONFLICT (config_key) 
             DO UPDATE SET config_value = $1, updated_at = NOW()`,
            [dailyLimit.toString()]
        );

        res.json({ 
            success: true, 
            dailyLimit,
            message: 'TTS settings updated successfully' 
        });
    } catch (err) {
        console.error('Update TTS settings error:', err);
        res.status(500).json({ error: 'Failed to update TTS settings' });
    } finally {
        client.release();
    }
});

// Get student's TTS usage for today
app.get('/api/user/tts-usage', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Get daily limit from settings
        const settingsResult = await client.query(
            `SELECT config_value FROM api_configs WHERE config_key = 'tts_daily_limit'`
        );
        const dailyLimit = settingsResult.rows.length > 0 
            ? parseInt(settingsResult.rows[0].config_value) 
            : 15;

        // Get today's usage
        const usageResult = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, today]
        );

        const usedToday = parseInt(usageResult.rows[0].count);
        const remaining = Math.max(0, dailyLimit - usedToday);

        res.json({
            dailyLimit,
            usedToday,
            remaining,
            canUsePremium: remaining > 0
        });
    } catch (err) {
        console.error('Get TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Track TTS usage (chiamata dall'endpoint /api/tts quando genera audio)
async function trackTTSUsage(client, userId) {
    try {
        await client.query(
            `INSERT INTO tts_usage (user_id, created_at) VALUES ($1, NOW())`,
            [userId]
        );
    } catch (err) {
        console.error('Track TTS usage error:', err);
    }
}

// ============================================
// MODIFY EXISTING /api/tts ENDPOINT
// ============================================
// Sostituisci l'endpoint /api/tts esistente con questa versione aggiornata:

app.post('/api/tts', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { text, voiceLang = 'en-US', voiceGender = 'MALE' } = req.body;
        const userId = req.user.id;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Check if user can use premium TTS
        const today = new Date().toISOString().split('T')[0];
        
        // Get daily limit
        const settingsResult = await client.query(
            `SELECT config_value FROM api_configs WHERE config_key = 'tts_daily_limit'`
        );
        const dailyLimit = settingsResult.rows.length > 0 
            ? parseInt(settingsResult.rows[0].config_value) 
            : 15;

        // Get today's usage
        const usageResult = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, today]
        );

        const usedToday = parseInt(usageResult.rows[0].count);

        // If limit exceeded, return error to trigger browser fallback
        if (usedToday >= dailyLimit) {
            return res.status(429).json({ 
                error: 'Daily premium TTS limit reached',
                usedToday,
                dailyLimit,
                fallbackToLocal: true
            });
        }

        // Limita lunghezza testo (max 5000 caratteri)
        const limitedText = text.substring(0, 5000);

        // Voice mapping
        const voiceMap = {
            'en-US': { 
                'MALE': 'en-US-Neural2-J',
                'FEMALE': 'en-US-Neural2-F',
                'NEUTRAL': 'en-US-Neural2-A'
            },
            'en-GB': { 
                'MALE': 'en-GB-Neural2-D',
                'FEMALE': 'en-GB-Neural2-F',
                'NEUTRAL': 'en-GB-Neural2-A'
            },
            'en-AU': { 
                'MALE': 'en-AU-Neural2-D',
                'FEMALE': 'en-AU-Neural2-A',
                'NEUTRAL': 'en-AU-Neural2-B'
            },
            'en-IN': { 
                'MALE': 'en-IN-Neural2-D',
                'FEMALE': 'en-IN-Neural2-A',
                'NEUTRAL': 'en-IN-Neural2-B'
            },
            'en-CA': { 
                'MALE': 'en-US-Neural2-J',
                'FEMALE': 'en-US-Neural2-F',
                'NEUTRAL': 'en-US-Neural2-A'
            }
        };

        const voiceChoice = voiceMap[voiceLang] || voiceMap['en-US'];
        const voiceName = voiceChoice[voiceGender] || voiceChoice['MALE'];

        const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            throw new Error('Google API Key not configured');
        }

        // Call Google Cloud TTS
        const response = await fetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: { text: limitedText },
                    voice: {
                        languageCode: voiceLang,
                        name: voiceName,
                        ssmlGender: voiceGender
                    },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: 0.95,
                        pitch: 0.0,
                        volumeGainDb: 0.0,
                        effectsProfileId: ['headphone-class-device']
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            console.error('TTS API error:', errorData);
            throw new Error(`TTS API error: ${response.statusText}`);
        }

        const data = await response.json();

        // Track usage
        await trackTTSUsage(client, userId);

        res.json({
            audioContent: data.audioContent,
            voiceUsed: voiceName,
            usedToday: usedToday + 1,
            dailyLimit
        });

    } catch (error) {
        console.error('TTS error:', error);
        res.status(500).json({ 
            error: 'Text-to-speech failed',
            fallbackToLocal: true
        });
    } finally {
        client.release();
    }
});


// ============================================
// MATERIALS ROUTES (Admin only)
// ============================================

app.get('/api/admin/materials', authenticate, requireAdmin, async (req, res) => {
    const { level, topic, type } = req.query;
    
    const client = await pool.connect();
    try {
        let query = `
            SELECT m.*, u.name as created_by_name
            FROM materials m
            LEFT JOIN users u ON m.created_by = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (level) {
            query += ` AND level = $${paramCount}`;
            params.push(level);
            paramCount++;
        }

        if (topic) {
            query += ` AND topic = $${paramCount}`;
            params.push(topic);
            paramCount++;
        }

        if (type) {
            query += ` AND type = $${paramCount}`;
            params.push(type);
            paramCount++;
        }

        query += ' ORDER BY created_at DESC';

        const result = await client.query(query, params);
        res.json({ materials: result.rows });
    } catch (err) {
        console.error('Get materials error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.post('/api/admin/materials', authenticate, requireAdmin, async (req, res) => {
    const { title, description, type, url, level, topic } = req.body;

    if (!title || !type || !url) {
        return res.status(400).json({ error: 'Titolo, tipo e URL richiesti' });
    }

    const client = await pool.connect();
    try {
        let content = null;
        let metadata = {};

        // Extract content based on type
        if (type === 'youtube' && youtubeClient) {
            try {
                const videoId = extractYouTubeId(url);
                if (videoId) {
                    // Get video details
                    const videoResponse = await youtubeClient.videos.list({
                        part: 'snippet,contentDetails',
                        id: videoId
                    });

                    if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                        const video = videoResponse.data.items[0];
                        metadata = {
                            duration: video.contentDetails.duration,
                            publishedAt: video.snippet.publishedAt,
                            channelTitle: video.snippet.channelTitle
                        };

                        // Try to get captions
                        try {
                            const captionsResponse = await youtubeClient.captions.list({
                                part: 'snippet',
                                videoId: videoId
                            });

                            if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
                                content = `Video: ${video.snippet.title}\n\n${video.snippet.description}`;
                            }
                        } catch (captionErr) {
                            console.log('Captions not available:', captionErr.message);
                            content = `Video: ${video.snippet.title}\n\n${video.snippet.description}`;
                        }
                    }
                }
            } catch (ytErr) {
                console.error('YouTube API error:', ytErr);
            }
        } else if (type === 'google_drive' && driveClient) {
            try {
                const fileId = extractGoogleDriveId(url);
                if (fileId) {
                    // Get file metadata
                    const fileResponse = await driveClient.files.get({
                        fileId: fileId,
                        fields: 'name,mimeType,size,createdTime'
                    });

                    metadata = {
                        mimeType: fileResponse.data.mimeType,
                        size: fileResponse.data.size,
                        createdTime: fileResponse.data.createdTime
                    };

                    // Try to export as text if it's a Google Doc
                    if (fileResponse.data.mimeType === 'application/vnd.google-apps.document') {
                        try {
                            const exportResponse = await driveClient.files.export({
                                fileId: fileId,
                                mimeType: 'text/plain'
                            });
                            content = exportResponse.data;
                        } catch (exportErr) {
                            console.log('Cannot export file:', exportErr.message);
                        }
                    }
                }
            } catch (driveErr) {
                console.error('Google Drive API error:', driveErr);
            }
        }

        const result = await client.query(
            `INSERT INTO materials (title, description, type, url, level, topic, content, metadata, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             RETURNING *`,
            [title, description, type, url, level, topic, content, JSON.stringify(metadata), req.user.userId]
        );

        res.status(201).json({ 
            message: 'Materiale creato con successo',
            material: result.rows[0]
        });
    } catch (err) {
        console.error('Create material error:', err);
        res.status(500).json({ error: 'Errore creazione materiale' });
    } finally {
        client.release();
    }
});

app.put('/api/admin/materials/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, description, level, topic, is_active } = req.body;

    const client = await pool.connect();
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (title) {
            updates.push(`title = $${paramCount}`);
            values.push(title);
            paramCount++;
        }

        if (description !== undefined) {
            updates.push(`description = $${paramCount}`);
            values.push(description);
            paramCount++;
        }

        if (level) {
            updates.push(`level = $${paramCount}`);
            values.push(level);
            paramCount++;
        }

        if (topic) {
            updates.push(`topic = $${paramCount}`);
            values.push(topic);
            paramCount++;
        }

        if (typeof is_active === 'boolean') {
            updates.push(`is_active = $${paramCount}`);
            values.push(is_active);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);
        
        const query = `UPDATE materials SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        res.json({ message: 'Materiale aggiornato', material: result.rows[0] });
    } catch (err) {
        console.error('Update material error:', err);
        res.status(500).json({ error: 'Errore aggiornamento' });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/materials/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const client = await pool.connect();
    try {
        const result = await client.query('DELETE FROM materials WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        res.json({ message: 'Materiale eliminato' });
    } catch (err) {
        console.error('Delete material error:', err);
        res.status(500).json({ error: 'Errore eliminazione' });
    } finally {
        client.release();
    }
});

// ============================================
// STUDENT LEVEL ROUTES
// ============================================

app.put('/api/user/level', authenticate, async (req, res) => {
    const { level, topics, learning_goals } = req.body;

    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO student_levels (user_id, level, topics, learning_goals, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) 
             DO UPDATE SET level = $2, topics = $3, learning_goals = $4, updated_at = NOW()
             RETURNING *`,
            [req.user.userId, level, topics, learning_goals]
        );

        res.json({ message: 'Livello aggiornato', student_level: result.rows[0] });
    } catch (err) {
        console.error('Update level error:', err);
        res.status(500).json({ error: 'Errore aggiornamento livello' });
    } finally {
        client.release();
    }
});

// ============================================
// ADMIN ROUTES (existing + new)
// ============================================

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                u.id, u.email, u.name, u.role, u.minutes_limit, u.created_at, u.last_login,
                COALESCE(SUM(us.minutes_used), 0) as total_minutes_used,
                sl.level, sl.topics
            FROM users u
            LEFT JOIN usage us ON u.id = us.user_id
            LEFT JOIN student_levels sl ON u.id = sl.user_id
            GROUP BY u.id, sl.level, sl.topics
            ORDER BY u.created_at DESC
        `);

        res.json({ users: result.rows });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.put('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { minutes_limit, role } = req.body;

    const client = await pool.connect();
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (typeof minutes_limit === 'number') {
            updates.push(`minutes_limit = $${paramCount}`);
            values.push(minutes_limit);
            paramCount++;
        }

        if (role && ['admin', 'student'].includes(role)) {
            updates.push(`role = $${paramCount}`);
            values.push(role);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        }

        values.push(id);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        res.json({ message: 'Utente aggiornato', user: result.rows[0] });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Errore aggiornamento' });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM usage WHERE user_id = $1', [id]);
        await client.query('DELETE FROM student_levels WHERE user_id = $1', [id]);
        await client.query('DELETE FROM practice_sessions WHERE user_id = $1', [id]);
        await client.query('DELETE FROM student_progress WHERE user_id = $1', [id]);
        
        const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        await client.query('COMMIT');
        res.json({ message: 'Utente eliminato' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Errore eliminazione' });
    } finally {
        client.release();
    }
});

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [totalUsers, activeToday, minutesToday, minutesMonth, totalMaterials] = await Promise.all([
            client.query("SELECT COUNT(*) as count FROM users WHERE role = 'student'"),
            client.query('SELECT COUNT(DISTINCT user_id) as count FROM usage WHERE date = $1', [today]),
            client.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date = $1', [today]),
            client.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date >= $1', [firstDayOfMonth]),
            client.query('SELECT COUNT(*) as count FROM materials WHERE is_active = true')
        ]);

        res.json({
            total_users: parseInt(totalUsers.rows[0].count),
            active_today: parseInt(activeToday.rows[0].count),
            minutes_today: Math.round(parseFloat(minutesToday.rows[0].total) * 100) / 100,
            minutes_month: Math.round(parseFloat(minutesMonth.rows[0].total) * 100) / 100,
            total_materials: parseInt(totalMaterials.rows[0].count)
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function extractGoogleDriveId(url) {
    const regex = /[-\w]{25,}/;
    const match = url.match(regex);
    return match ? match[0] : null;
}

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Voice Agent API with Learning Materials',
        timestamp: new Date().toISOString(),
        features: {
            google_drive: !!driveClient,
            youtube: !!youtubeClient
        }
    });
});

// Get TTS usage for specific user (Admin only)
app.get('/api/admin/users/:userId/tts-usage', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const result = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, date]
        );

        res.json({
            userId: parseInt(userId),
            date,
            count: parseInt(result.rows[0].count)
        });
    } catch (err) {
        console.error('Get user TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Update user (Admin only)
app.put('/api/admin/users/:userId', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const { name, email, level, password } = req.body;

        let query = 'UPDATE users SET name = $1, email = $2, level = $3';
        let params = [name, email, level];

        if (password) {
            const bcrypt = require('bcrypt');
            const hashedPassword = await bcrypt.hash(password, 10);
            query += ', password = $4';
            params.push(hashedPassword);
        }

        query += ', updated_at = NOW() WHERE id = $' + (params.length + 1) + ' RETURNING *';
        params.push(userId);

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        delete user.password;

        res.json({
            success: true,
            user
        });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Failed to update user' });
    } finally {
        client.release();
    }
});

// ============================================
// NUOVI ENDPOINT PER TTS TRACKING E USER EDIT
// ============================================
// Aggiungi questi endpoint al file server.js PRIMA di app.listen()

// Get TTS usage for specific user on specific date (Admin only)
app.get('/api/admin/users/:userId/tts-usage', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const result = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, date]
        );

        res.json({
            userId: parseInt(userId),
            date,
            count: parseInt(result.rows[0].count)
        });
    } catch (err) {
        console.error('Get user TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Update user (Admin only)
app.put('/api/admin/users/:userId', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const { name, email, role, level, monthly_limit, password } = req.body;

        let query = 'UPDATE users SET name = $1, email = $2, role = $3';
        let params = [name, email, role];
        let paramCount = 3;

        if (level) {
            paramCount++;
            query += `, level = $${paramCount}`;
            params.push(level);
        }

        if (monthly_limit !== undefined) {
            paramCount++;
            query += `, monthly_limit = $${paramCount}`;
            params.push(monthly_limit);
        }

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            paramCount++;
            query += `, password = $${paramCount}`;
            params.push(hashedPassword);
        }

        paramCount++;
        query += `, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
        params.push(userId);

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        delete user.password;

        res.json({
            success: true,
            user
        });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Failed to update user' });
    } finally {
        client.release();
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`🗄️ Database: PostgreSQL`);
    console.log(`📚 Learning Materials: Enabled`);
});
