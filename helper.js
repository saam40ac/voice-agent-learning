#!/usr/bin/env node

/**
 * Script Helper per Voice Agent Backend
 * Comandi utili per gestire utenti e database
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'voiceagent_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
});

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function listUsers() {
    try {
        const result = await pool.query(`
            SELECT 
                u.id, u.email, u.name, u.role, u.minutes_limit, 
                u.created_at, u.last_login,
                COALESCE(SUM(us.minutes_used), 0) as total_minutes_used
            FROM users u
            LEFT JOIN usage us ON u.id = us.user_id
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);

        if (result.rows.length === 0) {
            log('\n📭 Nessun utente trovato', 'yellow');
            return;
        }

        log('\n📋 LISTA UTENTI:', 'cyan');
        console.log('\n' + '='.repeat(100));
        
        result.rows.forEach(user => {
            log(`\nID: ${user.id} | ${user.email}`, 'blue');
            log(`   Nome: ${user.name}`);
            log(`   Ruolo: ${user.role === 'admin' ? '👑 Admin' : '🎓 Student'}`);
            log(`   Limite: ${user.minutes_limit} min/mese`);
            log(`   Utilizzo: ${parseFloat(user.total_minutes_used).toFixed(2)} min`);
            log(`   Creato: ${new Date(user.created_at).toLocaleString()}`);
            log(`   Ultimo accesso: ${user.last_login ? new Date(user.last_login).toLocaleString() : 'Mai'}`);
        });
        
        console.log('\n' + '='.repeat(100) + '\n');
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function createUser(email, password, name, role = 'student') {
    try {
        if (!email || !password || !name) {
            log('\n❌ Devi fornire: email, password e nome', 'red');
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const minutesLimit = role === 'admin' ? 999999 : 120;

        const result = await pool.query(
            `INSERT INTO users (email, password, name, role, minutes_limit, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW()) 
             RETURNING id, email, name, role, minutes_limit`,
            [email.toLowerCase(), hashedPassword, name, role, minutesLimit]
        );

        const user = result.rows[0];
        log('\n✅ Utente creato con successo!', 'green');
        log(`   Email: ${user.email}`, 'cyan');
        log(`   Nome: ${user.name}`);
        log(`   Ruolo: ${user.role}`);
        log(`   Limite: ${user.minutes_limit} min/mese\n`);
    } catch (err) {
        if (err.code === '23505') { // Unique violation
            log(`\n❌ Email già registrata: ${email}`, 'red');
        } else {
            log(`\n❌ Errore: ${err.message}`, 'red');
        }
    }
}

async function deleteUser(email) {
    try {
        if (!email) {
            log('\n❌ Devi fornire un\'email', 'red');
            return;
        }

        // Get user first
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        
        if (userResult.rows.length === 0) {
            log(`\n❌ Utente non trovato: ${email}`, 'red');
            return;
        }

        const user = userResult.rows[0];

        // Delete usage records
        await pool.query('DELETE FROM usage WHERE user_id = $1', [user.id]);

        // Delete user
        await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

        log('\n✅ Utente eliminato con successo!', 'green');
        log(`   Email: ${user.email}`, 'cyan');
        log(`   Nome: ${user.name}\n`);
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function promoteToAdmin(email) {
    try {
        if (!email) {
            log('\n❌ Devi fornire un\'email', 'red');
            return;
        }

        const result = await pool.query(
            `UPDATE users SET role = 'admin', minutes_limit = 999999 
             WHERE email = $1 
             RETURNING id, email, name, role, minutes_limit`,
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            log(`\n❌ Utente non trovato: ${email}`, 'red');
            return;
        }

        const user = result.rows[0];
        log('\n✅ Utente promosso ad Admin!', 'green');
        log(`   Email: ${user.email}`, 'cyan');
        log(`   Nome: ${user.name}`);
        log(`   Limite: ${user.minutes_limit} min/mese\n`);
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function changePassword(email, newPassword) {
    try {
        if (!email || !newPassword) {
            log('\n❌ Devi fornire email e nuova password', 'red');
            return;
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const result = await pool.query(
            'UPDATE users SET password = $1 WHERE email = $2 RETURNING email, name',
            [hashedPassword, email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            log(`\n❌ Utente non trovato: ${email}`, 'red');
            return;
        }

        log('\n✅ Password cambiata con successo!', 'green');
        log(`   Email: ${result.rows[0].email}`, 'cyan');
        log(`   Nome: ${result.rows[0].name}\n`);
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function updateLimit(email, minutesLimit) {
    try {
        if (!email || typeof minutesLimit !== 'number') {
            log('\n❌ Devi fornire email e limite in minuti (numero)', 'red');
            return;
        }

        const result = await pool.query(
            'UPDATE users SET minutes_limit = $1 WHERE email = $2 RETURNING email, name, minutes_limit',
            [minutesLimit, email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            log(`\n❌ Utente non trovato: ${email}`, 'red');
            return;
        }

        log('\n✅ Limite aggiornato!', 'green');
        log(`   Email: ${result.rows[0].email}`, 'cyan');
        log(`   Nome: ${result.rows[0].name}`);
        log(`   Nuovo limite: ${result.rows[0].minutes_limit} min/mese\n`);
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function showStats() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [totalUsers, adminUsers, studentUsers, activeToday, minutesToday, minutesMonth] = await Promise.all([
            pool.query("SELECT COUNT(*) as count FROM users"),
            pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'"),
            pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'student'"),
            pool.query('SELECT COUNT(DISTINCT user_id) as count FROM usage WHERE date = $1', [today]),
            pool.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date = $1', [today]),
            pool.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date >= $1', [firstDayOfMonth])
        ]);

        log('\n📊 STATISTICHE GLOBALI:', 'cyan');
        console.log('\n' + '='.repeat(50));
        log(`\n👥 Utenti Totali: ${totalUsers.rows[0].count}`, 'blue');
        log(`   👑 Admin: ${adminUsers.rows[0].count}`);
        log(`   🎓 Studenti: ${studentUsers.rows[0].count}`);
        log(`\n📅 Oggi (${new Date().toLocaleDateString()}):`);
        log(`   Utenti attivi: ${activeToday.rows[0].count}`);
        log(`   Minuti usati: ${parseFloat(minutesToday.rows[0].total).toFixed(2)}`);
        log(`\n📆 Questo mese:`);
        log(`   Minuti totali: ${parseFloat(minutesMonth.rows[0].total).toFixed(2)}`);
        console.log('\n' + '='.repeat(50) + '\n');
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

async function resetMonthlyUsage() {
    try {
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const result = await pool.query(
            'DELETE FROM usage WHERE date < $1 RETURNING *',
            [firstDayOfMonth]
        );

        log(`\n✅ Utilizzo mensile resettato!`, 'green');
        log(`   Record eliminati: ${result.rowCount}\n`, 'cyan');
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    }
}

function showHelp() {
    log('\n🛠️  VOICE AGENT - HELPER SCRIPT', 'cyan');
    console.log('\n' + '='.repeat(60));
    log('\nComandi disponibili:', 'yellow');
    log('\n  list', 'green');
    log('    Mostra tutti gli utenti');
    log('\n  create <email> <password> <nome> [role]', 'green');
    log('    Crea nuovo utente (role: admin o student)');
    log('\n  delete <email>', 'green');
    log('    Elimina utente');
    log('\n  promote <email>', 'green');
    log('    Promuovi utente ad admin');
    log('\n  password <email> <nuova_password>', 'green');
    log('    Cambia password utente');
    log('\n  limit <email> <minuti>', 'green');
    log('    Aggiorna limite mensile utente');
    log('\n  stats', 'green');
    log('    Mostra statistiche globali');
    log('\n  reset-month', 'green');
    log('    Resetta utilizzo mensile (ATTENZIONE!)');
    
    log('\n\nEsempi:', 'yellow');
    log('\n  node helper.js list');
    log('  node helper.js create user@example.com pass123 "Mario Rossi"');
    log('  node helper.js create admin@school.com pass456 "Admin" admin');
    log('  node helper.js promote user@example.com');
    log('  node helper.js password user@example.com newpass123');
    log('  node helper.js limit user@example.com 200');
    log('  node helper.js delete user@example.com');
    log('  node helper.js stats');
    console.log('\n' + '='.repeat(60) + '\n');
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        process.exit(0);
    }

    try {
        switch (command) {
            case 'list':
                await listUsers();
                break;
            case 'create':
                await createUser(args[1], args[2], args[3], args[4] || 'student');
                break;
            case 'delete':
                await deleteUser(args[1]);
                break;
            case 'promote':
                await promoteToAdmin(args[1]);
                break;
            case 'password':
                await changePassword(args[1], args[2]);
                break;
            case 'limit':
                await updateLimit(args[1], parseInt(args[2]));
                break;
            case 'stats':
                await showStats();
                break;
            case 'reset-month':
                log('\n⚠️  ATTENZIONE: Questa operazione eliminerà tutti i dati di utilizzo del mese corrente!', 'red');
                log('Per procedere, esegui: node helper.js reset-month confirm\n', 'yellow');
                if (args[1] === 'confirm') {
                    await resetMonthlyUsage();
                }
                break;
            default:
                log(`\n❌ Comando non riconosciuto: ${command}`, 'red');
                log('Usa: node helper.js help\n', 'yellow');
        }
    } catch (err) {
        log(`\n❌ Errore: ${err.message}`, 'red');
    } finally {
        await pool.end();
    }
}

main();
