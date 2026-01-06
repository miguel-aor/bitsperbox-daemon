import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import type { DeviceConfig, Order, PrintJob, RealtimePayload } from '../types/index.js'

type OrderCallback = (order: Order) => Promise<void>
type PrintJobCallback = (job: PrintJob) => Promise<void>

export class RealtimeManager {
  private supabase: SupabaseClient
  private config: DeviceConfig
  private ordersChannel: RealtimeChannel | null = null
  private printJobsChannel: RealtimeChannel | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private isConnected: boolean = false
  private startTime: Date = new Date()

  // Callbacks
  private onNewOrder: OrderCallback | null = null
  private onPrintJob: PrintJobCallback | null = null

  constructor(config: DeviceConfig) {
    this.config = config
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        persistSession: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  }

  /**
   * Set callback for new orders
   */
  setOrderCallback(callback: OrderCallback) {
    this.onNewOrder = callback
  }

  /**
   * Set callback for print jobs
   */
  setPrintJobCallback(callback: PrintJobCallback) {
    this.onPrintJob = callback
  }

  /**
   * Connect to Supabase Realtime and start listening
   */
  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to Supabase Realtime...')

      // Subscribe to orders table for new orders
      this.ordersChannel = this.supabase
        .channel(`bitsperbox-orders-${this.config.restaurantId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<Order>) => {
            logger.info(`New order received: #${payload.new.order_number}`)
            if (this.onNewOrder) {
              await this.onNewOrder(payload.new)
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to orders channel')
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Orders channel error', err)
          }
        })

      // Subscribe to print_jobs table for explicit print requests
      this.printJobsChannel = this.supabase
        .channel(`bitsperbox-printjobs-${this.config.restaurantId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'print_jobs',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<PrintJob>) => {
            logger.info(`Print job received: ${payload.new.job_type}`)
            if (this.onPrintJob) {
              await this.onPrintJob(payload.new)
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to print jobs channel')
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Print jobs channel error', err)
          }
        })

      // Start heartbeat
      this.startHeartbeat()

      this.isConnected = true
      return true
    } catch (error) {
      logger.error('Failed to connect to Supabase Realtime', error)
      return false
    }
  }

  /**
   * Disconnect from Supabase Realtime
   */
  async disconnect() {
    if (this.ordersChannel) {
      await this.supabase.removeChannel(this.ordersChannel)
      this.ordersChannel = null
    }
    if (this.printJobsChannel) {
      await this.supabase.removeChannel(this.printJobsChannel)
      this.printJobsChannel = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    this.isConnected = false
    logger.info('Disconnected from Supabase Realtime')
  }

  /**
   * Claim a print job atomically
   */
  async claimPrintJob(
    jobType: string,
    orderId: string,
    additionGroupId?: string
  ): Promise<{ success: boolean; jobId?: string }> {
    try {
      const { data, error } = await this.supabase.rpc('claim_print_job', {
        p_device_id: this.config.deviceId,
        p_restaurant_id: this.config.restaurantId,
        p_job_type: jobType,
        p_order_id: orderId,
        p_addition_group_id: additionGroupId || null,
      })

      if (error) {
        logger.error('Failed to claim print job', error)
        return { success: false }
      }

      return { success: data?.success || false, jobId: data?.job_id }
    } catch (error) {
      logger.error('Error claiming print job', error)
      return { success: false }
    }
  }

  /**
   * Mark a print job as completed
   */
  async completePrintJob(jobId: string, success: boolean, errorMessage?: string): Promise<void> {
    try {
      await this.supabase.rpc('complete_print_job', {
        p_job_id: jobId,
        p_success: success,
        p_error_message: errorMessage || null,
      })
    } catch (error) {
      logger.error('Failed to complete print job', error)
    }
  }

  /**
   * Fetch ESC/POS data for an order from the API
   */
  async fetchEscPosData(
    orderId: string,
    ticketType: 'kitchen' | 'customer' = 'kitchen',
    paperWidth: number = 80
  ): Promise<string | null> {
    try {
      // Call the API endpoint to generate ESC/POS
      const response = await fetch(
        `${this.config.supabaseUrl}/functions/v1/generate-escpos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.supabaseKey}`,
          },
          body: JSON.stringify({
            order_id: orderId,
            ticket_type: ticketType,
            paper_width: paperWidth,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const result = await response.json()
      return result.data // base64 encoded ESC/POS
    } catch (error) {
      logger.error('Failed to fetch ESC/POS data', error)
      return null
    }
  }

  /**
   * Start heartbeat to report device status
   */
  private startHeartbeat() {
    // Send initial heartbeat
    this.sendHeartbeat()

    // Then every 60 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 60000)
  }

  /**
   * Send heartbeat to Supabase
   */
  private async sendHeartbeat(printerStatus: string = 'ready') {
    try {
      const uptimeSeconds = Math.floor((Date.now() - this.startTime.getTime()) / 1000)

      await this.supabase.from('device_heartbeats').upsert(
        {
          device_id: this.config.deviceId,
          restaurant_id: this.config.restaurantId,
          status: 'online',
          printer_status: printerStatus,
          version: process.env.npm_package_version || '1.0.0',
          uptime_seconds: uptimeSeconds,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'device_id',
        }
      )

      logger.debug('Heartbeat sent')
    } catch (error) {
      logger.error('Failed to send heartbeat', error)
    }
  }

  /**
   * Update printer status in heartbeat
   */
  async updatePrinterStatus(status: 'ready' | 'error' | 'no_paper' | 'disconnected') {
    await this.sendHeartbeat(status)
  }

  getStatus(): { connected: boolean; restaurantId: string } {
    return {
      connected: this.isConnected,
      restaurantId: this.config.restaurantId,
    }
  }

  getSupabaseClient(): SupabaseClient {
    return this.supabase
  }
}

export default RealtimeManager
