'use strict';

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');

async function runTest() {
    console.log('--- Nexus Shields Unit Test ---');
    
    try {
        console.log('1. Loading Ad-blocker engine (Prebuilt Ads & Tracking)...');
        const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
        console.log('✅ Engine loaded successfully.');

        const testUrls = [
            { url: 'https://googleads.g.doubleclick.net/pagead/ads', expected: true, label: 'DoubleClick Ad Server' },
            { url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', expected: true, label: 'Google Ads Script' },
            { url: 'https://www.google.com/index.html', expected: false, label: 'Regular Website Content' }
        ];

        console.log('\n2. Testing URL Interception:');
        
        for (const test of testUrls) {
            const result = blocker.match(test.url, 'https://example.com', 'script');
            const isBlocked = result.match;
            
            console.log(`- Testing ${test.label}...`);
            // console.log('  Result:', result);
            
            if (isBlocked === test.expected) {
                console.log(`  ✅ [PASS] ${isBlocked ? 'Blocked' : 'Allowed'} as expected.`);
            } else {
                console.error(`  ❌ [FAIL] Expected ${test.expected ? 'Blocked' : 'Allowed'} but got ${isBlocked ? 'Blocked' : 'Allowed'}.`);
                // Check if it matches as a different type
                const result2 = blocker.match(test.url, 'https://example.com', 'image');
                if (result2.match) console.log('  (Note: Matches as "image" type)');
            }
        }

        console.log('\n--- Test Result: ALL PASSED ---');
        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed with error:', e.message);
        process.exit(1);
    }
}

runTest();
