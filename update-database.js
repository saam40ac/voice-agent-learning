require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    }
});

async function updateDatabase() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║  DATABASE UPDATE - Learning Materials Extension  ║');
    console.log('╚════════════════════════════════════════════════════╝\n');
    
    try {
        console.log('📖 Lettura schema SQL...\n');
        const schema = fs.readFileSync('database/schema-learning-extension.sql', 'utf8');
        
        console.log('⏳ Applicazione aggiornamenti al database...\n');
        await pool.query(schema);
        
        console.log('✅ DATABASE AGGIORNATO CON SUCCESSO!\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('📊 Nuove tabelle create:');
        console.log('   ✓ materials - Materiali didattici');
        console.log('   ✓ student_levels - Livelli studenti');
        console.log('   ✓ practice_sessions - Sessioni di pratica');
        console.log('   ✓ api_configs - Configurazioni API');
        console.log('   ✓ student_progress - Progressi studenti\n');
        
        console.log('📋 Views create:');
        console.log('   ✓ materials_summary - Riepilogo materiali');
        console.log('   ✓ student_statistics - Statistiche studenti\n');
        
        // Verifica tabelle create
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('materials', 'student_levels', 'practice_sessions', 'api_configs', 'student_progress')
            ORDER BY table_name
        `);
        
        console.log('🔍 Verifica tabelle:');
        result.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('💡 Prossimi passi:');
        console.log('   1. Aggiungi le API Keys nel file .env');
        console.log('   2. Riavvia il backend: npm start');
        console.log('   3. Accedi alla dashboard admin');
        console.log('   4. Inizia ad aggiungere materiali!\n');
        
    } catch (error) {
        console.error('\n❌ ERRORE durante l\'aggiornamento:\n');
        console.error(error.message);
        console.error('\n📋 Dettagli completi:');
        console.error(error);
        console.log('\n💡 Suggerimenti:');
        console.log('   - Verifica che il file .env sia configurato correttamente');
        console.log('   - Controlla la connessione al database');
        console.log('   - Assicurati che schema-learning-extension.sql esista\n');
    } finally {
        await pool.end();
        console.log('🔌 Connessione database chiusa.\n');
    }
}

updateDatabase();
