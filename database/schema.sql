-- ============================================
-- VOICE AGENT DATABASE SCHEMA
-- PostgreSQL Version
-- ============================================

-- Create database (run this separately as superuser if needed)
-- CREATE DATABASE voiceagent_db;

-- Connect to the database
-- \c voiceagent_db

-- ============================================
-- USERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'student' CHECK (role IN ('admin', 'student')),
    minutes_limit INTEGER DEFAULT 120,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- USAGE TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    minutes_used DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_minutes CHECK (minutes_used >= 0),
    CONSTRAINT unique_user_date UNIQUE(user_id, date)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(date);
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, date);

-- ============================================
-- SUPER ADMIN CREATION
-- ============================================

-- Create a default admin user (change password immediately!)
-- Password: admin123 (hashed with bcrypt)
INSERT INTO users (email, password, name, role, minutes_limit)
VALUES (
    'admin@voiceagent.com',
    '$2a$10$8ZKqMYKGNxGXqZKqGHY5qugqE.s0gYkVXc0KJa1qLfQZ1Q6ZqXQBm',
    'Super Admin',
    'admin',
    999999
)
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- USEFUL QUERIES
-- ============================================

-- Get total users by role
-- SELECT role, COUNT(*) as count FROM users GROUP BY role;

-- Get monthly usage summary
-- SELECT 
--     DATE_TRUNC('month', date) as month,
--     SUM(minutes_used) as total_minutes,
--     COUNT(DISTINCT user_id) as active_users
-- FROM usage
-- GROUP BY DATE_TRUNC('month', date)
-- ORDER BY month DESC;

-- Get top users by usage
-- SELECT 
--     u.name, u.email,
--     SUM(us.minutes_used) as total_minutes
-- FROM users u
-- LEFT JOIN usage us ON u.id = us.user_id
-- GROUP BY u.id, u.name, u.email
-- ORDER BY total_minutes DESC
-- LIMIT 10;

-- Get daily active users
-- SELECT 
--     date,
--     COUNT(DISTINCT user_id) as active_users,
--     SUM(minutes_used) as total_minutes
-- FROM usage
-- WHERE date >= CURRENT_DATE - INTERVAL '30 days'
-- GROUP BY date
-- ORDER BY date DESC;

-- ============================================
-- MAINTENANCE QUERIES
-- ============================================

-- Reset a user's password (generate hash with bcrypt first)
-- UPDATE users SET password = '$2a$10$...' WHERE email = 'user@example.com';

-- Grant admin privileges
-- UPDATE users SET role = 'admin', minutes_limit = 999999 WHERE email = 'user@example.com';

-- Reset monthly usage (careful!)
-- DELETE FROM usage WHERE date < DATE_TRUNC('month', CURRENT_DATE);

-- ============================================
-- VACUUM AND ANALYZE (for performance)
-- ============================================

-- Run periodically for optimal performance
-- VACUUM ANALYZE users;
-- VACUUM ANALYZE usage;
