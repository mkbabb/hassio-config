#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HA_TOKEN = process.env.HA_TOKEN!;
const HA_URL = 'http://homeassistant.local:8123';

// Test configuration for downstairs bathroom
const TEST_CONFIG = {
    motionSensors: [
        'binary_sensor.downstairs_bathroom_motion_sensor_2',
        'binary_sensor.downstairs_bathroom_motion_sensor_occupancy'
    ],
    lights: ['light.downstairs_bathroom_chili_pepper_lights'],
    coolDownSeconds: 7,
    maxCoolDownSeconds: 10
};

async function callService(domain: string, service: string, data: any) {
    const response = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${HA_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Service call failed: ${response.statusText} - ${text}`);
    }
    
    return response.json();
}

async function getState(entityId: string) {
    const response = await fetch(`${HA_URL}/api/states/${entityId}`, {
        headers: {
            'Authorization': `Bearer ${HA_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Get state failed: ${response.statusText}`);
    }
    
    return response.json();
}

async function setTestState(entityId: string, state: string, attributes: any = {}) {
    const response = await fetch(`${HA_URL}/api/states/${entityId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${HA_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            state: state,
            attributes: attributes
        })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Set state failed: ${response.statusText} - ${text}`);
    }
    
    return response.json();
}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyLight(expectedState: string): Promise<boolean> {
    const state = await getState(TEST_CONFIG.lights[0]);
    const actual = state.state;
    const match = actual === expectedState;
    console.log(`  Light state: Expected ${expectedState}, Got ${actual} ${match ? '✅' : '❌'}`);
    return match;
}

async function runCooldownTest() {
    console.log('🧪 Testing Cooldown Window Behavior');
    console.log('====================================');
    console.log(`Sensors: ${TEST_CONFIG.motionSensors.join(', ')}`);
    console.log(`Light: ${TEST_CONFIG.lights[0]}`);
    console.log(`Cooldown: ${TEST_CONFIG.coolDownSeconds}s`);
    console.log('');
    
    try {
        // Reset all sensors to off
        console.log('📋 Test 1: Basic Cooldown');
        console.log('Resetting sensors to off...');
        for (const sensor of TEST_CONFIG.motionSensors) {
            await setTestState(sensor, 'off');
        }
        await wait(2000);
        
        // Test 1: Basic on/off with cooldown
        console.log('\n1. Triggering motion...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(2000);
        await verifyLight('on');
        
        console.log('2. Motion cleared, entering cooldown...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(2000);
        await verifyLight('on'); // Should stay on during cooldown
        
        console.log(`3. Waiting ${TEST_CONFIG.coolDownSeconds}s for cooldown to expire...`);
        await wait(TEST_CONFIG.coolDownSeconds * 1000 + 1000);
        await verifyLight('off');
        
        // Test 2: Cooldown cancellation
        console.log('\n📋 Test 2: Cooldown Cancellation');
        console.log('1. Triggering motion...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(2000);
        await verifyLight('on');
        
        console.log('2. Motion cleared, entering cooldown...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(2000);
        await verifyLight('on');
        
        console.log('3. Motion detected during cooldown (should cancel)...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(2000);
        await verifyLight('on');
        
        console.log(`4. Waiting ${TEST_CONFIG.coolDownSeconds + 2}s past original cooldown time...`);
        await wait((TEST_CONFIG.coolDownSeconds + 2) * 1000);
        await verifyLight('on'); // Should still be on since cooldown was cancelled
        
        console.log('5. Motion cleared again...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(TEST_CONFIG.coolDownSeconds * 1000 + 1000);
        await verifyLight('off');
        
        // Test 3: Multiple sensors
        console.log('\n📋 Test 3: Multiple Sensor Aggregation');
        console.log('1. First sensor on...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(1000);
        
        console.log('2. Second sensor on...');
        await setTestState(TEST_CONFIG.motionSensors[1], 'on');
        await wait(1000);
        await verifyLight('on');
        
        console.log('3. First sensor off (second still on)...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(2000);
        await verifyLight('on'); // Should stay on
        
        console.log('4. Second sensor off (entering cooldown)...');
        await setTestState(TEST_CONFIG.motionSensors[1], 'off');
        await wait(2000);
        await verifyLight('on'); // In cooldown
        
        console.log(`5. Waiting ${TEST_CONFIG.coolDownSeconds}s for cooldown...`);
        await wait(TEST_CONFIG.coolDownSeconds * 1000 + 1000);
        await verifyLight('off');
        
        // Test 4: Rapid state changes
        console.log('\n📋 Test 4: Rapid State Changes (Debouncing)');
        console.log('Sending rapid on/off signals...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(500);
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(500);
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(500);
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await wait(500);
        await setTestState(TEST_CONFIG.motionSensors[0], 'on');
        await wait(2000);
        await verifyLight('on');
        
        console.log('Final cleanup...');
        await setTestState(TEST_CONFIG.motionSensors[0], 'off');
        await setTestState(TEST_CONFIG.motionSensors[1], 'off');
        
        console.log('\n✅ All tests completed!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test when executed directly
runCooldownTest().catch(console.error);

export { runCooldownTest };