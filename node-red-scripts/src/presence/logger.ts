import * as fs from "fs";
import * as path from "path";

export interface LogEntry {
    timestamp: string;
    topic: string;
    sensorStates: Record<string, string>;
    aggregateState: string;
    flowInfo: any;
    stateTransition: string;
    payload: any;
    delay: number;
    metadata?: any;
}

export class PresenceLogger {
    private logFile: string;
    private haApi: any;

    constructor(logFile: string = "/Volumes/config/node-red-scripts/logs/presence.json") {
        this.logFile = logFile;
        this.ensureLogDirectory();
    }

    private ensureLogDirectory() {
        const dir = path.dirname(this.logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    logToFile(entry: LogEntry) {
        try {
            let logs: LogEntry[] = [];
            if (fs.existsSync(this.logFile)) {
                const content = fs.readFileSync(this.logFile, "utf8");
                if (content) {
                    logs = JSON.parse(content);
                }
            }
            
            logs.push(entry);
            
            // Keep only last 1000 entries
            if (logs.length > 1000) {
                logs = logs.slice(-1000);
            }
            
            fs.writeFileSync(this.logFile, JSON.stringify(logs, null, 2));
        } catch (error) {
            console.error("Failed to write log:", error);
        }
    }

    // Helper for Node-RED function to send to HA
    createHALogPayload(entry: LogEntry, level: "info" | "warning" | "error" = "info") {
        return {
            action: "system_log.write",
            level: level,
            logger: "node_red.presence",
            message: `[${entry.topic}] ${entry.stateTransition} | Aggregate: ${entry.aggregateState} | Delay: ${entry.delay}ms`,
            metadata: {
                ...entry,
                timestamp: new Date().toISOString()
            }
        };
    }

    // Create comprehensive log entry from msg context
    createLogEntry(msg: any): LogEntry {
        return {
            timestamp: new Date().toISOString(),
            topic: msg.topic || msg.data?.entity_id || "unknown",
            sensorStates: msg.presenceStates || {},
            aggregateState: msg.aggregateState || "unknown",
            flowInfo: msg.flowInfo || {},
            stateTransition: msg.debug?.stateTransition || "unknown",
            payload: msg.payload,
            delay: msg.delay || 0,
            metadata: {
                debug: msg.debug,
                inCoolDown: msg.inCoolDown,
                entityCount: msg.entities?.length || 0
            }
        };
    }
}

// Function for use in Node-RED
export function logPresenceEvent(msg: any, context: any) {
    const logger = new PresenceLogger();
    const entry = logger.createLogEntry(msg);
    
    // Log to file
    logger.logToFile(entry);
    
    // Create HA service call
    const haPayload = logger.createHALogPayload(entry);
    
    // You can send this to HA through a service call node
    // or include it in the message for downstream processing
    msg.logPayload = haPayload;
    
    return msg;
}