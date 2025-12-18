-- ============================================
-- VOICE AGENT - LANGUAGE LEARNING EXTENSION
-- Schema update for educational materials
-- ============================================

-- ============================================
-- MATERIALS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL CHECK (type IN ('google_drive', 'youtube', 'text', 'url')),
    url TEXT NOT NULL,
    level VARCHAR(10) CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    topic VARCHAR(100) CHECK (topic IN ('grammar', 'conversation', 'vocabulary', 'pronunciation', 'reading', 'writing', 'listening')),
    content TEXT, -- Contenuto estratto/trascrizione
    metadata JSONB, -- Info aggiuntive (durata video, numero pagine, etc)
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_level ON materials(level);
CREATE INDEX IF NOT EXISTS idx_materials_topic ON materials(topic);
CREATE INDEX IF NOT EXISTS idx_materials_type ON materials(type);
CREATE INDEX IF NOT EXISTS idx_materials_active ON materials(is_active);

-- ============================================
-- STUDENT LEVELS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS student_levels (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level VARCHAR(10) NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    topics TEXT[] DEFAULT ARRAY['grammar', 'conversation', 'vocabulary', 'pronunciation'], -- Topics assigned
    target_voice VARCHAR(50) DEFAULT 'en-US', -- Voice preference
    learning_goals TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_student_levels_user ON student_levels(user_id);
CREATE INDEX IF NOT EXISTS idx_student_levels_level ON student_levels(level);

-- ============================================
-- PRACTICE SESSIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS practice_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_type VARCHAR(50) CHECK (session_type IN ('grammar', 'pronunciation', 'conversation', 'vocabulary', 'mixed')),
    level VARCHAR(10),
    topic VARCHAR(100),
    messages_count INTEGER DEFAULT 0,
    corrections JSONB DEFAULT '[]', -- Array di correzioni: [{error: "...", correction: "...", explanation: "..."}]
    score INTEGER CHECK (score >= 0 AND score <= 100), -- Punteggio 0-100
    duration INTEGER, -- Durati in secondi
    materials_used TEXT[], -- IDs dei materiali utilizzati
    feedback TEXT, -- Feedback finale dell'AI
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user ON practice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_type ON practice_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_practice_sessions_date ON practice_sessions(created_at);

-- ============================================
-- API CONFIGURATIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS api_configs (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    is_encrypted BOOLEAN DEFAULT false,
    description TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configs
INSERT INTO api_configs (config_key, config_value, description) VALUES
('google_drive_enabled', 'false', 'Enable Google Drive integration'),
('youtube_enabled', 'false', 'Enable YouTube integration'),
('default_student_level', 'A1', 'Default level for new students'),
('voice_correction_enabled', 'true', 'Enable real-time pronunciation correction')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================
-- STUDENT PROGRESS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS student_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level VARCHAR(10),
    topic VARCHAR(100),
    materials_completed TEXT[], -- IDs materiali completati
    total_practice_time INTEGER DEFAULT 0, -- Minuti totali
    average_score DECIMAL(5,2),
    strengths TEXT[], -- Punti di forza
    weaknesses TEXT[], -- Punti da migliorare
    last_practice TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, level, topic)
);

CREATE INDEX IF NOT EXISTS idx_student_progress_user ON student_progress(user_id);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- View: Materials by level and topic
CREATE OR REPLACE VIEW materials_summary AS
SELECT 
    level,
    topic,
    type,
    COUNT(*) as total_materials,
    SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_materials
FROM materials
GROUP BY level, topic, type
ORDER BY level, topic;

-- View: Student statistics
CREATE OR REPLACE VIEW student_statistics AS
SELECT 
    u.id as user_id,
    u.name,
    u.email,
    sl.level,
    COUNT(ps.id) as total_sessions,
    SUM(ps.duration) as total_practice_seconds,
    AVG(ps.score) as average_score,
    MAX(ps.created_at) as last_practice
FROM users u
LEFT JOIN student_levels sl ON u.id = sl.user_id
LEFT JOIN practice_sessions ps ON u.id = ps.user_id
WHERE u.role = 'student'
GROUP BY u.id, u.name, u.email, sl.level;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_materials_updated_at BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_levels_updated_at BEFORE UPDATE ON student_levels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_progress_updated_at BEFORE UPDATE ON student_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SAMPLE DATA (optional)
-- ============================================

-- Insert sample topics for testing
-- INSERT INTO materials (title, description, type, url, level, topic, created_by) VALUES
-- ('Basic Grammar Rules', 'Introduction to English grammar', 'text', 'https://example.com', 'A1', 'grammar', 1),
-- ('Everyday Conversations', 'Common phrases for daily use', 'youtube', 'https://youtube.com/watch?v=xxx', 'A2', 'conversation', 1);

-- ============================================
-- MAINTENANCE QUERIES
-- ============================================

-- Count materials by level
-- SELECT level, COUNT(*) FROM materials WHERE is_active = true GROUP BY level;

-- Student progress summary
-- SELECT * FROM student_statistics ORDER BY average_score DESC;

-- Most used materials
-- SELECT m.title, m.level, m.topic, COUNT(ps.id) as usage_count
-- FROM materials m
-- LEFT JOIN practice_sessions ps ON m.id::text = ANY(ps.materials_used)
-- GROUP BY m.id, m.title, m.level, m.topic
-- ORDER BY usage_count DESC
-- LIMIT 10;

-- Clean up old practice sessions (older than 1 year)
-- DELETE FROM practice_sessions WHERE created_at < NOW() - INTERVAL '1 year';
