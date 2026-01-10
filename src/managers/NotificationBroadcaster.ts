/**
 * NotificationBroadcaster - WebSocket Server for ESP32 Devices
 *
 * Broadcasts notifications from Supabase to connected BitsperWatch devices.
 * Manages device registration, heartbeats, and notification delivery.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

interface ConnectedDevice {
    ws: WebSocket;
    deviceId: string;
    name: string;
    firmware: string;
    connectedAt: Date;
    lastHeartbeat: Date;
    rssi?: number;
    freeHeap?: number;
    uptime?: number;
}

interface NotificationPayload {
    id?: string;
    table: string;
    alert: string;
    message: string;
    priority: string;
    timestamp: number;
}

interface DeviceInfo {
    deviceId: string;
    name: string;
    firmware: string;
    connectedAt: Date;
    lastHeartbeat: Date;
    rssi?: number;
    online: boolean;
}

export class NotificationBroadcaster extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private devices: Map<string, ConnectedDevice> = new Map();
    private port: number;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor(port: number = 3334) {
        super();
        this.port = port;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.wss = new WebSocketServer({ port: this.port });

                this.wss.on('listening', () => {
                    logger.info(`[Broadcaster] WebSocket server started on port ${this.port}`);
                    this.startHeartbeatChecker();
                    resolve();
                });

                this.wss.on('connection', (ws, req) => {
                    const clientIp = req.socket.remoteAddress;
                    logger.info(`[Broadcaster] New connection from ${clientIp}`);
                    this.handleConnection(ws);
                });

                this.wss.on('error', (error) => {
                    logger.error('[Broadcaster] WebSocket server error:', error);
                    reject(error);
                });

            } catch (error) {
                logger.error('[Broadcaster] Failed to start WebSocket server:', error);
                reject(error);
            }
        });
    }

    stop(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Close all connections
        for (const device of this.devices.values()) {
            device.ws.close();
        }
        this.devices.clear();

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        logger.info('[Broadcaster] WebSocket server stopped');
    }

    private handleConnection(ws: WebSocket): void {
        let deviceId: string | null = null;

        // Send welcome message
        this.sendToSocket(ws, {
            type: 'welcome',
            message: 'Connected to BitsperBox',
            timestamp: Date.now()
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                deviceId = this.handleMessage(ws, message, deviceId);
            } catch (error) {
                logger.error('[Broadcaster] Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            if (deviceId && this.devices.has(deviceId)) {
                const device = this.devices.get(deviceId)!;
                logger.info(`[Broadcaster] Device disconnected: ${device.name} (${deviceId})`);
                this.devices.delete(deviceId);
                this.emit('deviceDisconnected', deviceId);
            }
        });

        ws.on('error', (error) => {
            logger.error(`[Broadcaster] WebSocket error for device ${deviceId}:`, error);
        });

        // Set ping interval to keep connection alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                this.sendToSocket(ws, { type: 'ping' });
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);
    }

    private handleMessage(ws: WebSocket, message: any, currentDeviceId: string | null): string | null {
        const msgType = message.type;

        switch (msgType) {
            case 'register':
                return this.handleRegister(ws, message);

            case 'heartbeat':
                this.handleHeartbeat(message);
                break;

            case 'ack':
                this.handleAck(message);
                break;

            case 'pong':
                // Pong response, connection is alive
                break;

            default:
                logger.warn(`[Broadcaster] Unknown message type: ${msgType}`);
        }

        return currentDeviceId || message.device_id || null;
    }

    private handleRegister(ws: WebSocket, message: any): string {
        const deviceId = message.device_id;
        const deviceName = message.name || 'Unknown Device';
        const firmware = message.firmware || 'unknown';

        // Check if device already connected (reconnection)
        if (this.devices.has(deviceId)) {
            const existingDevice = this.devices.get(deviceId)!;
            existingDevice.ws.close();
            this.devices.delete(deviceId);
        }

        // Register new device
        const device: ConnectedDevice = {
            ws,
            deviceId,
            name: deviceName,
            firmware,
            connectedAt: new Date(),
            lastHeartbeat: new Date()
        };

        this.devices.set(deviceId, device);

        logger.info(`[Broadcaster] Device registered: ${deviceName} (${deviceId}) - Firmware: ${firmware}`);

        // Send confirmation
        this.sendToSocket(ws, {
            type: 'registered',
            device_id: deviceId,
            message: 'Successfully registered with BitsperBox'
        });

        this.emit('deviceConnected', {
            deviceId,
            name: deviceName,
            firmware
        });

        return deviceId;
    }

    private handleHeartbeat(message: any): void {
        const deviceId = message.device_id;
        if (this.devices.has(deviceId)) {
            const device = this.devices.get(deviceId)!;
            device.lastHeartbeat = new Date();
            device.uptime = message.uptime;
            device.freeHeap = message.free_heap;
            device.rssi = message.rssi;
        }
    }

    private handleAck(message: any): void {
        const notificationId = message.notification_id;
        const deviceId = message.device_id;
        logger.debug(`[Broadcaster] ACK received for notification ${notificationId} from ${deviceId}`);
        this.emit('notificationAcked', { notificationId, deviceId });
    }

    private startHeartbeatChecker(): void {
        // Check for stale connections every 60 seconds
        this.heartbeatInterval = setInterval(() => {
            const now = new Date();
            const staleThreshold = 90000; // 90 seconds

            for (const [deviceId, device] of this.devices.entries()) {
                const timeSinceHeartbeat = now.getTime() - device.lastHeartbeat.getTime();
                if (timeSinceHeartbeat > staleThreshold) {
                    logger.warn(`[Broadcaster] Device ${device.name} (${deviceId}) is stale, closing connection`);
                    device.ws.close();
                    this.devices.delete(deviceId);
                    this.emit('deviceDisconnected', deviceId);
                }
            }
        }, 60000);
    }

    private sendToSocket(ws: WebSocket, data: any): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * Broadcast notification to all connected devices
     */
    broadcast(notification: NotificationPayload): void {
        const message = {
            type: 'notification',
            ...notification
        };

        const messageStr = JSON.stringify(message);
        let sentCount = 0;

        for (const device of this.devices.values()) {
            if (device.ws.readyState === WebSocket.OPEN) {
                device.ws.send(messageStr);
                sentCount++;
            }
        }

        logger.info(`[Broadcaster] Notification broadcasted to ${sentCount} devices: Table ${notification.table} - ${notification.alert}`);
    }

    /**
     * Send notification to a specific device
     */
    sendToDevice(deviceId: string, notification: NotificationPayload): boolean {
        const device = this.devices.get(deviceId);
        if (!device || device.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        this.sendToSocket(device.ws, {
            type: 'notification',
            ...notification
        });

        logger.info(`[Broadcaster] Notification sent to device ${deviceId}`);
        return true;
    }

    /**
     * Send test notification to all devices
     */
    sendTestNotification(): void {
        this.broadcast({
            id: `test-${Date.now()}`,
            table: 'TEST',
            alert: 'waiter_called',
            message: 'Notificacion de prueba desde BitsperBox',
            priority: 'medium',
            timestamp: Date.now()
        });
    }

    /**
     * Get list of connected devices
     */
    getConnectedDevices(): DeviceInfo[] {
        return Array.from(this.devices.values()).map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            firmware: d.firmware,
            connectedAt: d.connectedAt,
            lastHeartbeat: d.lastHeartbeat,
            rssi: d.rssi,
            online: d.ws.readyState === WebSocket.OPEN
        }));
    }

    /**
     * Get count of connected devices
     */
    getDeviceCount(): number {
        return this.devices.size;
    }

    /**
     * Check if a specific device is connected
     */
    isDeviceConnected(deviceId: string): boolean {
        const device = this.devices.get(deviceId);
        return device !== undefined && device.ws.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const notificationBroadcaster = new NotificationBroadcaster();
