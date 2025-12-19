require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Creating tts_usage table...');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS tts_usage (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_tts_usage_user_date 
            ON tts_usage (user_id, DATE(created_at));
        `);

        await client.query(`
            INSERT INTO api_configs (config_key, config_value, description)
            VALUES ('tts_daily_limit', '15', 'Daily premium TTS limit per student')
            ON CONFLICT (config_key) DO NOTHING;
        `);

        console.log('✅ Migration completed successfully!');
        
        const result = await client.query(
            "SELECT * FROM api_configs WHERE config_key = 'tts_daily_limit'"
        );
        console.log('TTS Limit:', result.rows[0]);
        
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();