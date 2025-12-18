#!/usr/bin/env node

/**
 * Script di test per l'API Voice Agent
 * Testa tutti gli endpoint principali
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';

// Colori per output
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

function logSection(title) {
    console.log('\n' + '='.repeat(50));
    log(title, 'cyan');
    console.log('='.repeat(50));
}

async function testEndpoint(name, method, endpoint, body = null, token = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        log(`\nTesting: ${name}`, 'blue');
        log(`${method} ${endpoint}`, 'yellow');

        const response = await fetch(`${API_URL}${endpoint}`, options);
        const data = await response.json();

        if (response.ok) {
            log(`✓ SUCCESS (${response.status})`, 'green');
            console.log(JSON.stringify(data, null, 2));
            return { success: true, data, status: response.status };
        } else {
            log(`✗ FAILED (${response.status})`, 'red');
            console.log(JSON.stringify(data, null, 2));
            return { success: false, data, status: response.status };
        }
    } catch (error) {
        log(`✗ ERROR: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

async function runTests() {
    log('\n🧪 VOICE AGENT API TEST SUITE', 'cyan');
    log(`Testing API at: ${API_URL}\n`, 'yellow');

    const testEmail = `test_${Date.now()}@example.com`;
    const testPassword = 'test123456';
    let authToken = null;
    let userId = null;

    // ============================================
    // 1. HEALTH CHECK
    // ============================================
    logSection('1. Health Check');
    await testEndpoint('Health Check', 'GET', '/api/health');

    // ============================================
    // 2. REGISTRAZIONE
    // ============================================
    logSection('2. User Registration');
    const registerResult = await testEndpoint(
        'Register New User',
        'POST',
        '/api/auth/register',
        {
            email: testEmail,
            password: testPassword,
            name: 'Test User',
            role: 'student'
        }
    );

    if (registerResult.success) {
        authToken = registerResult.data.token;
        userId = registerResult.data.user?.id;
        log(`\n📝 Saved token for subsequent tests`, 'green');
    }

    // ============================================
    // 3. LOGIN
    // ============================================
    logSection('3. User Login');
    const loginResult = await testEndpoint(
        'Login',
        'POST',
        '/api/auth/login',
        {
            email: testEmail,
            password: testPassword
        }
    );

    if (loginResult.success && loginResult.data.token) {
        authToken = loginResult.data.token;
        log(`\n📝 Token updated from login`, 'green');
    }

    if (!authToken) {
        log('\n⚠️ No auth token available, skipping authenticated tests', 'red');
        return;
    }

    // ============================================
    // 4. PROFILO UTENTE
    // ============================================
    logSection('4. User Profile');
    await testEndpoint('Get Profile', 'GET', '/api/user/profile', null, authToken);

    // ============================================
    // 5. UTILIZZO
    // ============================================
    logSection('5. Usage Tracking');
    
    await testEndpoint('Get Usage Stats', 'GET', '/api/user/usage', null, authToken);

    await testEndpoint(
        'Record Usage',
        'POST',
        '/api/user/usage',
        { minutes: 2.5 },
        authToken
    );

    await testEndpoint('Get Updated Usage', 'GET', '/api/user/usage', null, authToken);

    // ============================================
    // 6. CHAT (senza Anthropic API per test)
    // ============================================
    logSection('6. Chat Endpoint');
    log('\n⚠️ Note: This will fail if ANTHROPIC_API_KEY is not set', 'yellow');
    
    await testEndpoint(
        'Send Chat Message',
        'POST',
        '/api/chat',
        {
            message: 'Ciao, questo è un test!',
            conversation_history: []
        },
        authToken
    );

    // ============================================
    // 7. TEST LOGIN ADMIN
    // ============================================
    logSection('7. Admin Login Test');
    const adminLoginResult = await testEndpoint(
        'Admin Login',
        'POST',
        '/api/auth/login',
        {
            email: 'admin@voiceagent.com',
            password: 'admin123'
        }
    );

    let adminToken = null;
    if (adminLoginResult.success) {
        adminToken = adminLoginResult.data.token;

        // ============================================
        // 8. ADMIN ENDPOINTS
        // ============================================
        logSection('8. Admin Endpoints');

        await testEndpoint('List All Users', 'GET', '/api/admin/users', null, adminToken);

        await testEndpoint('Get Stats', 'GET', '/api/admin/stats', null, adminToken);

        if (userId) {
            await testEndpoint(
                'Update User Limit',
                'PUT',
                `/api/admin/users/${userId}`,
                { minutes_limit: 200 },
                adminToken
            );
        }
    } else {
        log('\n⚠️ Admin login failed - default credentials may have been changed', 'yellow');
    }

    // ============================================
    // 9. TEST ERRORI
    // ============================================
    logSection('9. Error Handling Tests');

    await testEndpoint(
        'Login with Wrong Password',
        'POST',
        '/api/auth/login',
        {
            email: testEmail,
            password: 'wrong_password'
        }
    );

    await testEndpoint(
        'Access Protected Route Without Token',
        'GET',
        '/api/user/profile'
    );

    await testEndpoint(
        'Register Duplicate Email',
        'POST',
        '/api/auth/register',
        {
            email: testEmail,
            password: 'anotherpass',
            name: 'Duplicate User'
        }
    );

    // ============================================
    // SUMMARY
    // ============================================
    logSection('Test Suite Completed');
    log('\n✅ All tests executed!', 'green');
    log('\nTest user created:', 'cyan');
    log(`  Email: ${testEmail}`, 'yellow');
    log(`  Password: ${testPassword}`, 'yellow');
    log(`\n⚠️ Remember to check your database and clean up test data if needed`, 'yellow');
}

// Run tests
runTests().catch(error => {
    log(`\n❌ Test suite failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});
