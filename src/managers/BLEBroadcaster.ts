/**
 * BLEBroadcaster - BLE Server for ESP32 Devices
 *
 * Creates a BLE peripheral that ESP32 devices can connect to.
 * Works alongside WebSocket server for redundant connectivity.
 *
 * Uses bleno library for BLE peripheral functionality on Raspberry Pi.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// BLE UUIDs - must match ESP32 client
const SERVICE_UUID = '4fafc2011fb5459e8fccc5c9c331914b';  // No hyphens for bleno
const NOTIFY_CHAR_UUID = 'beb5483e36e14688b7f5ea07361b26a8';
const REGISTER_CHAR_UUID = 'beb5483e36e14688b7f5ea07361b26a9';

interface BLEDevice {
    deviceId: string;
    name: string;
    connectedAt: Date;
    lastActivity: Date;
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
    connectedAt: Date;
    online: boolean;
    connectionType: 'ble';
}

export class BLEBroadcaster extends EventEmitter {
    private bleno: any = null;
    private notifyCharacteristic: any = null;
    private devices: Map<string, BLEDevice> = new Map();
    private isAdvertising: boolean = false;
    private subscriptions: Set<any> = new Set();
    private blenoLoaded: boolean = false;

    constructor() {
        super();
    }

    async start(): Promise<void> {
        try {
            // Dynamic import of bleno - may not be available on all systems
            // @ts-ignore - bleno is an optional dependency
            const blenoModule = await import('@abandonware/bleno').catch(() => null);

            if (!blenoModule) {
                logger.warn('[BLE] Bleno module not available - BLE support disabled');
                logger.info('[BLE] To enable BLE on Raspberry Pi, run: npm install @abandonware/bleno');
                return;
            }

            this.bleno = blenoModule.default || blenoModule;
            this.blenoLoaded = true;

            logger.info('[BLE] Initializing BLE server...');

            // Set up bleno event handlers
            this.bleno.on('stateChange', (state: string) => {
                logger.info(`[BLE] Adapter state: ${state}`);

                if (state === 'poweredOn') {
                    this.startAdvertising();
                } else {
                    this.stopAdvertising();
                }
            });

            this.bleno.on('advertisingStart', (error: Error | null) => {
                if (error) {
                    logger.error('[BLE] Advertising start error:', error);
                    return;
                }

                logger.info('[BLE] Advertising started');
                this.isAdvertising = true;
                this.setupServices();
            });

            this.bleno.on('accept', (clientAddress: string) => {
                logger.info(`[BLE] Client connected: ${clientAddress}`);
            });

            this.bleno.on('disconnect', (clientAddress: string) => {
                logger.info(`[BLE] Client disconnected: ${clientAddress}`);
                // Note: We can't directly map clientAddress to deviceId without registration
            });

        } catch (error) {
            logger.error('[BLE] Failed to initialize BLE:', error);
            throw error;
        }
    }

    private startAdvertising(): void {
        if (!this.bleno || this.isAdvertising) return;

        logger.info('[BLE] Starting BLE advertising...');

        // Advertise with service UUID
        this.bleno.startAdvertising('BitsperBox', [SERVICE_UUID], (error: Error | null) => {
            if (error) {
                logger.error('[BLE] Failed to start advertising:', error);
            }
        });
    }

    private stopAdvertising(): void {
        if (!this.bleno) return;

        this.bleno.stopAdvertising();
        this.isAdvertising = false;
        logger.info('[BLE] Advertising stopped');
    }

    private setupServices(): void {
        if (!this.bleno) return;

        const Bleno = this.bleno;

        // Create the notification characteristic (for sending notifications to ESP32)
        const NotifyCharacteristic = class extends Bleno.Characteristic {
            broadcaster: BLEBroadcaster;

            constructor(broadcaster: BLEBroadcaster) {
                super({
                    uuid: NOTIFY_CHAR_UUID,
                    properties: ['notify', 'read'],
                    descriptors: [
                        new Bleno.Descriptor({
                            uuid: '2901',
                            value: 'Notifications'
                        })
                    ]
                });
                this.broadcaster = broadcaster;
            }

            onSubscribe(maxValueSize: number, updateValueCallback: any) {
                logger.info('[BLE] Client subscribed to notifications');
                this.broadcaster.subscriptions.add(updateValueCallback);
                this.broadcaster.notifyCharacteristic = updateValueCallback;
            }

            onUnsubscribe() {
                logger.info('[BLE] Client unsubscribed from notifications');
                this.broadcaster.subscriptions.delete(this.broadcaster.notifyCharacteristic);
                this.broadcaster.notifyCharacteristic = null;
            }

            onReadRequest(offset: number, callback: any) {
                // Return a status message
                const status = JSON.stringify({
                    type: 'status',
                    connected: true,
                    devices: this.broadcaster.devices.size
                });
                callback(Bleno.Characteristic.RESULT_SUCCESS, Buffer.from(status));
            }
        };

        // Create the register characteristic (for receiving registration from ESP32)
        const RegisterCharacteristic = class extends Bleno.Characteristic {
            broadcaster: BLEBroadcaster;

            constructor(broadcaster: BLEBroadcaster) {
                super({
                    uuid: REGISTER_CHAR_UUID,
                    properties: ['write', 'writeWithoutResponse'],
                    descriptors: [
                        new Bleno.Descriptor({
                            uuid: '2901',
                            value: 'Device Registration'
                        })
                    ]
                });
                this.broadcaster = broadcaster;
            }

            onWriteRequest(data: Buffer, offset: number, withoutResponse: boolean, callback: any) {
                try {
                    const message = JSON.parse(data.toString());
                    this.broadcaster.handleMessage(message);
                    callback(Bleno.Characteristic.RESULT_SUCCESS);
                } catch (error) {
                    logger.error('[BLE] Error parsing registration:', error);
                    callback(Bleno.Characteristic.RESULT_UNLIKELY_ERROR);
                }
            }
        };

        // Create the service
        const notifyChar = new NotifyCharacteristic(this);
        const registerChar = new RegisterCharacteristic(this);

        const primaryService = new Bleno.PrimaryService({
            uuid: SERVICE_UUID,
            characteristics: [notifyChar, registerChar]
        });

        // Set services
        this.bleno.setServices([primaryService], (error: Error | null) => {
            if (error) {
                logger.error('[BLE] Error setting services:', error);
            } else {
                logger.info('[BLE] BLE services configured');
            }
        });
    }

    private handleMessage(message: any): void {
        const msgType = message.type;

        switch (msgType) {
            case 'register':
                this.handleRegister(message);
                break;

            case 'heartbeat':
                this.handleHeartbeat(message);
                break;

            case 'ack':
                this.handleAck(message);
                break;

            default:
                logger.warn(`[BLE] Unknown message type: ${msgType}`);
        }
    }

    private handleRegister(message: any): void {
        const deviceId = message.device_id;
        const deviceName = message.name || 'Unknown BLE Device';

        const device: BLEDevice = {
            deviceId,
            name: deviceName,
            connectedAt: new Date(),
            lastActivity: new Date()
        };

        this.devices.set(deviceId, device);

        logger.info(`[BLE] Device registered: ${deviceName} (${deviceId})`);

        // Send confirmation via notification
        this.sendToSubscribers({
            type: 'registered',
            device_id: deviceId,
            message: 'Successfully registered with BitsperBox via BLE'
        });

        this.emit('deviceConnected', {
            deviceId,
            name: deviceName,
            connectionType: 'ble'
        });
    }

    private handleHeartbeat(message: any): void {
        const deviceId = message.device_id;
        if (this.devices.has(deviceId)) {
            const device = this.devices.get(deviceId)!;
            device.lastActivity = new Date();
        }
    }

    private handleAck(message: any): void {
        const notificationId = message.notification_id;
        const deviceId = message.device_id;
        logger.debug(`[BLE] ACK received for notification ${notificationId} from ${deviceId}`);
        this.emit('notificationAcked', { notificationId, deviceId });
    }

    private sendToSubscribers(data: any): void {
        if (this.subscriptions.size === 0) {
            return;
        }

        const buffer = Buffer.from(JSON.stringify(data));

        for (const callback of this.subscriptions) {
            try {
                callback(buffer);
            } catch (error) {
                logger.error('[BLE] Error sending to subscriber:', error);
            }
        }
    }

    /**
     * Broadcast notification to all BLE-connected devices
     */
    broadcast(notification: NotificationPayload): void {
        logger.info(`[BLE] Broadcasting to ${this.subscriptions.size} subscribers, blenoLoaded=${this.blenoLoaded}`);

        if (!this.blenoLoaded || this.subscriptions.size === 0) {
            logger.warn(`[BLE] Cannot broadcast: blenoLoaded=${this.blenoLoaded}, subscriptions=${this.subscriptions.size}`);
            return;
        }

        const message = {
            type: 'notification',
            ...notification
        };

        const jsonStr = JSON.stringify(message);
        logger.info(`[BLE] Sending message (${jsonStr.length} bytes): ${jsonStr}`);

        this.sendToSubscribers(message);
        logger.info(`[BLE] Notification broadcasted: Table ${notification.table} - ${notification.alert}`);
    }

    /**
     * Send test notification
     */
    sendTestNotification(): void {
        this.broadcast({
            id: `ble-test-${Date.now()}`,
            table: 'TEST',
            alert: 'waiter_called',
            message: 'Prueba BLE desde BitsperBox',
            priority: 'medium',
            timestamp: Date.now()
        });
    }

    /**
     * Get list of registered BLE devices
     */
    getConnectedDevices(): DeviceInfo[] {
        return Array.from(this.devices.values()).map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            connectedAt: d.connectedAt,
            online: true,  // BLE devices register but we don't track exact connection state
            connectionType: 'ble' as const
        }));
    }

    /**
     * Get count of BLE devices
     */
    getDeviceCount(): number {
        return this.devices.size;
    }

    /**
     * Get count of active BLE subscriptions
     */
    getSubscriptionCount(): number {
        return this.subscriptions.size;
    }

    /**
     * Check if BLE is available and advertising
     */
    isAvailable(): boolean {
        return this.blenoLoaded && this.isAdvertising;
    }

    /**
     * Stop BLE server
     */
    stop(): void {
        if (this.bleno) {
            this.stopAdvertising();
            // Clear devices
            this.devices.clear();
            this.subscriptions.clear();
            logger.info('[BLE] BLE server stopped');
        }
    }
}

// Singleton instance
export const bleBroadcaster = new BLEBroadcaster();
