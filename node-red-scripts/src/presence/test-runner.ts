#!/usr/bin/env node
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DEBOUNCE_TIME_MS, TEST_WAIT_MS } from './utils';

// Load .env from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HA_TOKEN = process.env.HA_TOKEN!;
const HA_URL = 'http://homeassistant.local:8123';

interface TestConfig {
    motionSensors: string[];
    lights: string[];
    coolDownSeconds: number;
    topic?: string;
}

interface TestResult {
    test: string;
    passed: boolean;
    message: string;
    details?: any;
}

class PresenceTestRunner {
    private results: TestResult[] = [];

    constructor(private config: TestConfig) {}

    private async callService(domain: string, service: string, data: any) {
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

    private async getState(entityId: string): Promise<Hass.State> {
        const response = await fetch(`${HA_URL}/api/states/${entityId}`, {
            headers: {
                'Authorization': `Bearer ${HA_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Get state failed: ${response.statusText}`);
        }

        return response.json() as Promise<Hass.State>;
    }

    private async setTestState(entityId: string, state: string, attributes: any = {}) {
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

    private async wait(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async verifyLights(expectedState: string, testName: string): Promise<boolean> {
        let allMatch = true;
        const states: Record<string, string> = {};

        for (const light of this.config.lights) {
            const state = await this.getState(light);
            states[light] = state.state;
            if (state.state !== expectedState) {
                allMatch = false;
            }
        }

        const result = {
            test: testName,
            passed: allMatch,
            message: allMatch
                ? `✅ All lights are ${expectedState}`
                : `❌ Light state mismatch. Expected ${expectedState}`,
            details: states
        };

        this.results.push(result);
        console.log(`  ${result.message}`);
        if (!allMatch) {
            console.log(`    States: ${JSON.stringify(states)}`);
        }

        return allMatch;
    }

    private async resetAllSensors() {
        console.log('  Resetting all sensors to off...');
        for (const sensor of this.config.motionSensors) {
            await this.setTestState(sensor, 'off');
        }
        await this.wait(TEST_WAIT_MS);
    }

    private async queryInfluxDB(query: string): Promise<any> {
        const influxUser = process.env.INFLUXDB_USERNAME || "homeassistant";
        const influxPass = process.env.INFLUXDB_PASSWORD;
        if (!influxPass) {
            throw new Error("INFLUXDB_PASSWORD not set in .env");
        }
        const response = await fetch(
            `http://homeassistant.local:8086/query?` +
            `db=nodered&` +
            `u=${influxUser}&` +
            `p=${influxPass}&` +
            `q=${encodeURIComponent(query)}`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`InfluxDB query failed: ${response.statusText}`);
        }

        return response.json();
    }

    async runTest1_BasicCooldown() {
        console.log('\n📋 Test 1: Basic Cooldown Window');
        console.log('─'.repeat(40));

        await this.resetAllSensors();

        // Trigger motion
        console.log('  1. Triggering motion...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test1_Step1');

        // Clear motion, enter cooldown
        console.log('  2. Motion cleared, entering cooldown...');
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test1_Step2_Cooldown');

        // Wait for cooldown to expire
        console.log(`  3. Waiting ${this.config.coolDownSeconds}s for cooldown...`);
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
        await this.verifyLights('off', 'Test1_Step3_Expired');
    }

    async runTest2_CooldownCancellation() {
        console.log('\n📋 Test 2: Cooldown Cancellation');
        console.log('─'.repeat(40));

        await this.wait(3000); // Wait for any previous test effects to clear
        await this.resetAllSensors();

        // Trigger motion
        console.log('  1. Triggering motion...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test2_Step1');

        // Clear motion, enter cooldown
        console.log('  2. Motion cleared, entering cooldown...');
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test2_Step2_Cooldown');

        // Re-trigger during cooldown
        console.log('  3. Re-triggering motion during cooldown...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test2_Step3_Retriggered');

        // Wait past original cooldown time
        console.log(`  4. Waiting ${this.config.coolDownSeconds + 2}s past original cooldown...`);
        await this.wait((this.config.coolDownSeconds + 2) * 1000);
        await this.verifyLights('on', 'Test2_Step4_StillOn');

        // Clear motion again
        console.log('  5. Clearing motion again...');
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
        await this.verifyLights('off', 'Test2_Step5_FinalOff');
    }

    async runTest3_MultipleSensors() {
        console.log('\n📋 Test 3: Multiple Sensor Aggregation');
        console.log('─'.repeat(40));

        if (this.config.motionSensors.length < 2) {
            console.log('  ⚠️  Skipping: Requires at least 2 sensors');
            return;
        }

        await this.resetAllSensors();

        // First sensor on
        console.log('  1. First sensor on...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test3_Step1');

        // Second sensor on
        console.log('  2. Second sensor on...');
        await this.setTestState(this.config.motionSensors[1], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test3_Step2');

        // First sensor off (second still on)
        console.log('  3. First sensor off (second still on)...');
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test3_Step3_PartialOn');

        // Second sensor off
        console.log('  4. Second sensor off (entering cooldown)...');
        await this.setTestState(this.config.motionSensors[1], 'off');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test3_Step4_Cooldown');

        // Wait for cooldown
        console.log(`  5. Waiting ${this.config.coolDownSeconds}s for cooldown...`);
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
        await this.verifyLights('off', 'Test3_Step5_Off');
    }

    async runTest4_RapidStateChanges() {
        console.log('\n📋 Test 4: Rapid State Changes');
        console.log('─'.repeat(40));

        await this.resetAllSensors();

        console.log('  Sending rapid on/off signals...');
        for (let i = 0; i < 5; i++) {
            await this.setTestState(this.config.motionSensors[0], i % 2 === 0 ? 'on' : 'off');
            await this.wait(500);
        }

        // End on 'on' state
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test4_RapidChanges');

        // Clean up
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
    }

    async runTest5_ResetPathway() {
        console.log('\n📋 Test 5: Reset Pathway');
        console.log('─'.repeat(40));

        await this.resetAllSensors();

        // Trigger motion
        console.log('  1. Triggering motion...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test5_Step1');

        // Send reset signal
        console.log('  2. Sending reset signal...');
        await this.setTestState(this.config.motionSensors[0], 'reset');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('off', 'Test5_Step2_Reset');

        // Try another reset (should be debounced)
        console.log('  3. Sending another reset (should be debounced)...');
        await this.setTestState(this.config.motionSensors[0], 'reset');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('off', 'Test5_Step3_Debounced');

        // Wait for debounce period then try again
        console.log(`  4. Waiting ${DEBOUNCE_TIME_MS}ms for debounce period...`);
        await this.wait(DEBOUNCE_TIME_MS);

        // Trigger motion again
        console.log('  5. Triggering motion again...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test5_Step5_On');

        // Clean up
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
    }

    async runTest6_CooldownInsideWindow() {
        console.log('\n📋 Test 6: Edge Case - Motion During Late Cooldown');
        console.log('─'.repeat(40));

        await this.resetAllSensors();

        // Trigger motion
        console.log('  1. Triggering motion...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test6_Step1');

        // Clear motion, enter cooldown
        console.log('  2. Motion cleared, entering cooldown...');
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(TEST_WAIT_MS);
        await this.verifyLights('on', 'Test6_Step2_Cooldown');

        // Wait until just before cooldown expires
        const waitTime = Math.max(1, this.config.coolDownSeconds - 1);
        console.log(`  3. Waiting ${waitTime}s (just before cooldown expires)...`);
        await this.wait(waitTime * 1000);

        // Re-trigger motion just before cooldown expires
        console.log('  4. Re-triggering motion just before expiry...');
        await this.setTestState(this.config.motionSensors[0], 'on');
        await this.wait(3000);
        await this.verifyLights('on', 'Test6_Step4_RetriggeredLate');

        // Clean up
        await this.setTestState(this.config.motionSensors[0], 'off');
        await this.wait(this.config.coolDownSeconds * 1000 + TEST_WAIT_MS);
    }

    async checkInfluxLogs() {
        console.log('\n📊 Checking InfluxDB Logs');
        console.log('─'.repeat(40));

        const topic = this.config.topic || 'test';
        const query = `SELECT presence_state, action, cool_down_cancelled, state_transition
                      FROM presence_events
                      WHERE topic = '${topic}'
                      ORDER BY time DESC
                      LIMIT 10`;

        try {
            const result = await this.queryInfluxDB(query);
            if (result.results && result.results[0].series) {
                console.log('  Recent presence events:');
                const series = result.results[0].series[0];
                const columns = series.columns;
                const values = series.values;

                values.slice(0, 5).forEach((row: any[]) => {
                    const event: any = {};
                    columns.forEach((col: string, idx: number) => {
                        event[col] = row[idx];
                    });
                    console.log(`    ${event.state_transition}: ${event.action !== 'none' ? '→ action' : 'no action'}`);
                });
            }
        } catch (error) {
            console.log('  ⚠️  Could not query InfluxDB:', error);
        }
    }

    async runAllTests() {
        console.log('\n🧪 PRESENCE DETECTION TEST SUITE');
        console.log('═'.repeat(40));
        console.log(`Config: ${JSON.stringify(this.config, null, 2)}`);

        try {
            await this.runTest1_BasicCooldown();
            await this.runTest2_CooldownCancellation();
            await this.runTest3_MultipleSensors();
            await this.runTest4_RapidStateChanges();
            await this.runTest5_ResetPathway();
            await this.runTest6_CooldownInsideWindow();
            await this.checkInfluxLogs();

            // Summary
            console.log('\n📈 TEST SUMMARY');
            console.log('═'.repeat(40));

            const passed = this.results.filter(r => r.passed).length;
            const failed = this.results.filter(r => !r.passed).length;

            console.log(`  Total: ${this.results.length} checks`);
            console.log(`  Passed: ${passed} ✅`);
            console.log(`  Failed: ${failed} ❌`);

            if (failed > 0) {
                console.log('\n  Failed tests:');
                this.results.filter(r => !r.passed).forEach(r => {
                    console.log(`    - ${r.test}: ${r.message}`);
                    if (r.details) {
                        console.log(`      Details: ${JSON.stringify(r.details)}`);
                    }
                });
            }

            return failed === 0;

        } catch (error) {
            console.error('\n❌ Test suite failed:', error);
            return false;
        }
    }
}

// Guest bathroom configuration
const GUEST_BATHROOM_CONFIG: TestConfig = {
    motionSensors: ['binary_sensor.guest_bathroom_motion_sensor'],
    lights: [
        'light.guest_bathroom_light'
    ],
    coolDownSeconds: 7,
    topic: 'guest_bathroom'
};

// Downstairs bathroom configuration
const DOWNSTAIRS_BATHROOM_CONFIG: TestConfig = {
    motionSensors: [
        'binary_sensor.downstairs_bathroom_motion_sensor_2',
        'binary_sensor.downstairs_bathroom_motion_sensor_occupancy'
    ],
    lights: ['light.downstairs_bathroom_chili_pepper_lights'],
    coolDownSeconds: 7,
    topic: 'downstairs_bathroom'
};

// Laundry room configuration
const LAUNDRY_ROOM_CONFIG: TestConfig = {
    motionSensors: ['binary_sensor.laundry_room_motion_sensor_occupancy'],
    lights: ['light.laundry_room_light'],
    coolDownSeconds: 7,
    topic: 'laundry_room'
};

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const testRoom = args[0] || 'guest';

    let config: TestConfig;

    switch (testRoom) {
        case 'downstairs':
            config = DOWNSTAIRS_BATHROOM_CONFIG;
            console.log('Testing: Downstairs Bathroom');
            break;
        case 'laundry':
            config = LAUNDRY_ROOM_CONFIG;
            console.log('Testing: Laundry Room');
            break;
        case 'guest':
        default:
            config = GUEST_BATHROOM_CONFIG;
            console.log('Testing: Guest Bathroom');
            break;
    }

    const runner = new PresenceTestRunner(config);
    const success = await runner.runAllTests();

    process.exit(success ? 0 : 1);
}

// Run if executed directly
main().catch(console.error);

export { PresenceTestRunner, GUEST_BATHROOM_CONFIG, DOWNSTAIRS_BATHROOM_CONFIG, LAUNDRY_ROOM_CONFIG };