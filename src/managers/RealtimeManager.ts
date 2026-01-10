import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import type { DeviceConfig, Order, RealtimePayload } from '../types/index.js'
import { notificationBroadcaster } from './NotificationBroadcaster.js'

// ============================================
// Types for Realtime Events
// ============================================

interface OrderTicket {
  id: string
  order_id: string
  restaurant_id: string
  ticket_type: 'customer' | 'kitchen'
  print_requested_at: string | null
}

interface CashReport {
  id: string
  restaurant_id: string
  report_type: 'x_report' | 'z_report'
  print_requested_at: string | null
}

interface MenuProNotification {
  id: string
  restaurant_id: string
  table_number: string
  type: 'waiter_called' | 'bill_ready' | 'payment_confirmed' | 'order_status' | 'kitchen_update' | 'table_ready'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  title: string
  message: string
  status: 'pending' | 'sent' | 'delivered' | 'read'
  created_at: string
}

interface ClaimResult {
  success: boolean
  job_id?: string
  reason?: string
}

interface StationTicket {
  stationId: string
  stationName: string
  printerConfig: {
    printer_name: string
    copies: number
  }
  escposBase64: string
}

// ============================================
// Callbacks Types
// ============================================

type KitchenOrderCallback = (order: Order, escposData: string) => Promise<void>
type AdditionCallback = (order: Order, additionGroupId: string, escposData: string) => Promise<void>
type CustomerTicketCallback = (ticketId: string, orderId: string, escposData: string) => Promise<void>
type CashReportCallback = (reportId: string, reportType: string, escposData: string) => Promise<void>
type StationTicketsCallback = (orderId: string, tickets: StationTicket[]) => Promise<void>

// ============================================
// RealtimeManager Class
// ============================================

export class RealtimeManager {
  private supabase: SupabaseClient
  private config: DeviceConfig
  private channels: RealtimeChannel[] = []
  private heartbeatInterval: NodeJS.Timeout | null = null
  private pollingInterval: NodeJS.Timeout | null = null
  private _isConnected: boolean = false
  private startTime: Date = new Date()
  private usePolling: boolean = false
  private lastOrderCheck: Date = new Date()
  private processedOrderIds: Set<string> = new Set()
  private ordersProcessed: number = 0
  private lastOrderTime: Date | null = null
  private realtimeStatus: string = 'disconnected'

  // Callbacks
  private onKitchenOrder: KitchenOrderCallback | null = null
  private onAddition: AdditionCallback | null = null
  private onCustomerTicket: CustomerTicketCallback | null = null
  private onCashReport: CashReportCallback | null = null
  private onStationTickets: StationTicketsCallback | null = null

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

  // ============================================
  // Callback Setters
  // ============================================

  setKitchenOrderCallback(callback: KitchenOrderCallback) {
    this.onKitchenOrder = callback
  }

  setAdditionCallback(callback: AdditionCallback) {
    this.onAddition = callback
  }

  setCustomerTicketCallback(callback: CustomerTicketCallback) {
    this.onCustomerTicket = callback
  }

  setCashReportCallback(callback: CashReportCallback) {
    this.onCashReport = callback
  }

  setStationTicketsCallback(callback: StationTicketsCallback) {
    this.onStationTickets = callback
  }

  // ============================================
  // Connection
  // ============================================

  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to Supabase...')

      // First, try Realtime connection
      const realtimeSuccess = await this.tryRealtimeConnection()

      if (!realtimeSuccess) {
        logger.warn('Realtime connection failed, using polling fallback')
        this.usePolling = true
        this.startPolling()
      }

      // Start heartbeat
      this.startHeartbeat()

      this._isConnected = true
      this.realtimeStatus = this.usePolling ? 'polling' : 'SUBSCRIBED'
      return true
    } catch (error) {
      logger.error('Failed to connect to Supabase', error)
      return false
    }
  }

  private async tryRealtimeConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          logger.warn('Realtime subscription timed out after 15s')
          resolve(false)
        }
      }, 15000)

      // 1. Listen for new orders (INSERT on orders)
      const ordersChannel = this.supabase
        .channel(`bitsperbox-orders-${this.config.restaurantId}`)
        .on(
          'postgres_changes' as 'system',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'orders',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          } as any,
          async (payload: RealtimePayload<Order>) => {
            await this.handleNewOrder(payload.new)
          }
        )
        .on(
          'postgres_changes' as 'system',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          } as any,
          async (payload: RealtimePayload<Order>) => {
            await this.handleOrderUpdate(payload.new, payload.old)
          }
        )
        .subscribe((status: string, err: Error | undefined) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to orders channel (Realtime)')
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              this.setupAdditionalChannels()
              resolve(true)
            }
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Orders channel error', err)
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              resolve(false)
            }
          } else if (status === 'TIMED_OUT') {
            logger.warn('Orders channel timed out')
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              resolve(false)
            }
          }
        })
      this.channels.push(ordersChannel)
    })
  }

  private setupAdditionalChannels() {
    // 2. Listen for customer ticket events
    const ticketsChannel = this.supabase
      .channel(`bitsperbox-tickets-${this.config.restaurantId}`)
      .on(
        'postgres_changes' as 'system',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_tickets',
          filter: `restaurant_id=eq.${this.config.restaurantId}`,
        } as any,
        async (payload: RealtimePayload<OrderTicket>) => {
          if (payload.new.ticket_type === 'customer') {
            await this.handleNewCustomerTicket(payload.new)
          }
        }
      )
      .on(
        'postgres_changes' as 'system',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'order_tickets',
          filter: `restaurant_id=eq.${this.config.restaurantId}`,
        } as any,
        async (payload: RealtimePayload<OrderTicket>) => {
          if (
            payload.new.ticket_type === 'customer' &&
            payload.new.print_requested_at &&
            payload.new.print_requested_at !== payload.old?.print_requested_at
          ) {
            await this.handleReprintTicket(payload.new)
          }
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          logger.success('Subscribed to tickets channel')
        }
      })
    this.channels.push(ticketsChannel)

    // 3. Listen for cash report events
    const reportsChannel = this.supabase
      .channel(`bitsperbox-reports-${this.config.restaurantId}`)
      .on(
        'postgres_changes' as 'system',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cash_reports',
          filter: `restaurant_id=eq.${this.config.restaurantId}`,
        } as any,
        async (payload: RealtimePayload<CashReport>) => {
          if (payload.new.print_requested_at) {
            await this.handleNewCashReport(payload.new)
          }
        }
      )
      .on(
        'postgres_changes' as 'system',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'cash_reports',
          filter: `restaurant_id=eq.${this.config.restaurantId}`,
        } as any,
        async (payload: RealtimePayload<CashReport>) => {
          if (
            payload.new.print_requested_at &&
            payload.new.print_requested_at !== payload.old?.print_requested_at
          ) {
            await this.handleReprintReport(payload.new)
          }
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          logger.success('Subscribed to reports channel')
        }
      })
    this.channels.push(reportsChannel)

    // 4. Listen for menu_pro_notifications (for ESP32 devices)
    const notificationsChannel = this.supabase
      .channel(`bitsperbox-notifications-${this.config.restaurantId}`)
      .on(
        'postgres_changes' as 'system',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'menu_pro_notifications',
          filter: `restaurant_id=eq.${this.config.restaurantId}`,
        } as any,
        async (payload: RealtimePayload<MenuProNotification>) => {
          await this.handleMenuProNotification(payload.new)
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          logger.success('Subscribed to menu_pro_notifications channel (for ESP32 devices)')
        }
      })
    this.channels.push(notificationsChannel)
  }

  // ============================================
  // ESP32 Notification Handling
  // ============================================

  private async handleMenuProNotification(notification: MenuProNotification) {
    // Only process types relevant for ESP32 devices
    const espTypes = ['waiter_called', 'bill_ready', 'payment_confirmed']
    if (!espTypes.includes(notification.type)) {
      return
    }

    logger.info(`🔔 Menu Pro notification: ${notification.type} for table ${notification.table_number}`)

    // Broadcast to all connected ESP32 devices
    notificationBroadcaster.broadcast({
      id: notification.id,
      table: notification.table_number,
      alert: notification.type,
      message: notification.message || notification.title,
      priority: notification.priority,
      timestamp: Date.now()
    })
  }

  // ============================================
  // Polling Fallback
  // ============================================

  private startPolling() {
    logger.info('Starting polling mode (checking every 3 seconds)...')
    this.lastOrderCheck = new Date()

    // Poll for new orders every 3 seconds
    this.pollingInterval = setInterval(async () => {
      await this.pollForNewOrders()
    }, 3000)

    // Initial poll
    this.pollForNewOrders()
  }

  private async pollForNewOrders() {
    try {
      const checkTime = new Date(this.lastOrderCheck.getTime() - 5000) // 5 second overlap

      // Get orders created since last check
      const { data: orders, error } = await this.supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', this.config.restaurantId)
        .gte('created_at', checkTime.toISOString())
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('Polling error', error)
        return
      }

      this.lastOrderCheck = new Date()

      if (orders && orders.length > 0) {
        for (const order of orders) {
          // Skip if already processed
          if (this.processedOrderIds.has(order.id)) continue

          this.processedOrderIds.add(order.id)

          // Clean up old processed IDs (keep last 100)
          if (this.processedOrderIds.size > 100) {
            const ids = Array.from(this.processedOrderIds)
            this.processedOrderIds = new Set(ids.slice(-50))
          }

          await this.handleNewOrder(order as Order)
        }
      }
    } catch (error) {
      logger.error('Polling failed', error)
    }
  }

  async disconnect() {
    for (const channel of this.channels) {
      await this.supabase.removeChannel(channel)
    }
    this.channels = []

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    this._isConnected = false
    this.realtimeStatus = 'disconnected'
    logger.info('Disconnected from Supabase')
  }

  // ============================================
  // Event Handlers
  // ============================================

  private async handleNewOrder(order: Order) {
    logger.info(`📦 New order received: #${order.order_number}`)

    // Try to claim the print job
    const claim = await this.claimPrintJob({
      jobType: 'kitchen_order',
      orderId: order.id,
    })

    if (!claim.success) {
      logger.debug(`Order #${order.order_number} already claimed by another device`)
      return
    }

    try {
      // Try station-based printing first
      const stationTickets = await this.fetchStationTickets(order.id)

      if (stationTickets && stationTickets.length > 0) {
        if (this.onStationTickets) {
          await this.onStationTickets(order.id, stationTickets)
        }
      } else {
        // Fallback to single kitchen ticket
        const escposData = await this.fetchEscPosData(order.id, 'kitchen')
        if (escposData && this.onKitchenOrder) {
          await this.onKitchenOrder(order, escposData)
        }
      }

      await this.completePrintJob(claim.job_id!, true)
      this.ordersProcessed++
      this.lastOrderTime = new Date()
    } catch (error) {
      logger.error('Error printing kitchen order', error)
      await this.completePrintJob(claim.job_id!, false, String(error))
    }
  }

  private async handleOrderUpdate(newOrder: Order, oldOrder: Order | null) {
    // Check for additions (items with is_addition=true that weren't there before)
    const newAdditions = (newOrder.items || []).filter(item => item.is_addition)

    if (newAdditions.length === 0) return

    // Group additions by addition_group_id
    const additionGroups = new Map<string, typeof newAdditions>()
    for (const item of newAdditions) {
      const groupId = item.addition_group_id || 'default'
      if (!additionGroups.has(groupId)) {
        additionGroups.set(groupId, [])
      }
      additionGroups.get(groupId)!.push(item)
    }

    // Check if these are NEW additions (not in old order)
    const oldAdditionGroupIds = new Set(
      (oldOrder?.items || [])
        .filter(item => item.is_addition)
        .map(item => item.addition_group_id || 'default')
    )

    for (const [groupId] of additionGroups) {
      if (oldAdditionGroupIds.has(groupId)) continue // Already processed

      logger.info(`➕ Addition detected for order #${newOrder.order_number}, group ${groupId}`)

      const claim = await this.claimPrintJob({
        jobType: 'addition',
        orderId: newOrder.id,
        additionGroupId: groupId,
      })

      if (!claim.success) {
        logger.debug('Addition already claimed by another device')
        continue
      }

      try {
        const escposData = await this.fetchAdditionEscPos(newOrder.id, groupId)
        if (escposData && this.onAddition) {
          await this.onAddition(newOrder, groupId, escposData)
        }
        await this.completePrintJob(claim.job_id!, true)
      } catch (error) {
        logger.error('Error printing addition', error)
        await this.completePrintJob(claim.job_id!, false, String(error))
      }
    }
  }

  private async handleNewCustomerTicket(ticket: OrderTicket) {
    logger.info(`🧾 New customer ticket for order ${ticket.order_id}`)

    const claim = await this.claimPrintJob({
      jobType: 'customer_ticket',
      orderId: ticket.order_id,
      ticketId: ticket.id,
    })

    if (!claim.success) {
      logger.debug('Customer ticket already claimed by another device')
      return
    }

    try {
      const escposData = await this.fetchEscPosData(ticket.order_id, 'customer')
      logger.debug(`Customer ticket escposData: ${escposData ? `${escposData.length} chars` : 'NULL'}`)
      logger.debug(`onCustomerTicket callback: ${this.onCustomerTicket ? 'SET' : 'NOT SET'}`)

      if (escposData && this.onCustomerTicket) {
        await this.onCustomerTicket(ticket.id, ticket.order_id, escposData)
        logger.info(`✓ Customer ticket printed for order ${ticket.order_id}`)
      } else {
        logger.warn(`Customer ticket NOT printed - escposData: ${!!escposData}, callback: ${!!this.onCustomerTicket}`)
      }
      await this.completePrintJob(claim.job_id!, true)
    } catch (error) {
      logger.error('Error printing customer ticket', error)
      await this.completePrintJob(claim.job_id!, false, String(error))
    }
  }

  private async handleReprintTicket(ticket: OrderTicket) {
    logger.info(`🔄 Reprint requested for ticket ${ticket.id}`)
    await this.handleNewCustomerTicket(ticket)
  }

  private async handleNewCashReport(report: CashReport) {
    logger.info(`📊 New cash report: ${report.report_type}`)

    const claim = await this.claimPrintJob({
      jobType: 'cash_report',
      reportId: report.id,
    })

    if (!claim.success) {
      logger.debug('Cash report already claimed by another device')
      return
    }

    try {
      const escposData = await this.fetchReportEscPos(report.id)
      if (escposData && this.onCashReport) {
        await this.onCashReport(report.id, report.report_type, escposData)
      }
      await this.completePrintJob(claim.job_id!, true)
    } catch (error) {
      logger.error('Error printing cash report', error)
      await this.completePrintJob(claim.job_id!, false, String(error))
    }
  }

  private async handleReprintReport(report: CashReport) {
    logger.info(`🔄 Reprint requested for report ${report.id}`)
    await this.handleNewCashReport(report)
  }

  // ============================================
  // Claim System (Atomic)
  // ============================================

  private async claimPrintJob(params: {
    jobType: 'kitchen_order' | 'addition' | 'customer_ticket' | 'cash_report'
    orderId?: string
    ticketId?: string
    reportId?: string
    additionGroupId?: string
  }): Promise<ClaimResult> {
    try {
      const { data, error } = await this.supabase.rpc('claim_print_job', {
        p_restaurant_id: this.config.restaurantId,
        p_job_type: params.jobType,
        p_order_id: params.orderId || null,
        p_ticket_id: params.ticketId || null,
        p_report_id: params.reportId || null,
        p_addition_group_id: params.additionGroupId || null,
        p_device_id: this.config.deviceId,
        p_ttl_seconds: 30,
      })

      if (error) {
        logger.error('Failed to claim print job', error)
        return { success: false }
      }

      return {
        success: data?.success || false,
        job_id: data?.job_id,
        reason: data?.reason,
      }
    } catch (error) {
      logger.error('Error claiming print job', error)
      return { success: false }
    }
  }

  private async completePrintJob(jobId: string, success: boolean, errorMessage?: string): Promise<void> {
    try {
      await this.supabase.rpc('complete_print_job', {
        p_job_id: jobId,
        p_device_id: this.config.deviceId,
        p_success: success,
        p_error_message: errorMessage || null,
      })
    } catch (error) {
      logger.error('Failed to complete print job', error)
    }
  }

  // ============================================
  // API Calls (Frontend)
  // ============================================

  private async fetchEscPosData(
    orderId: string,
    ticketType: 'kitchen' | 'customer' = 'kitchen',
    paperWidth: number = 80
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.config.frontendUrl}/api/dashboard/tickets/generate-escpos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
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

      const result = await response.json() as { escposBase64?: string; data?: string }
      return result.escposBase64 || result.data || null
    } catch (error) {
      logger.error('Failed to fetch ESC/POS data', error)
      return null
    }
  }

  private async fetchStationTickets(orderId: string, paperWidth: number = 80): Promise<StationTicket[] | null> {
    try {
      const response = await fetch(
        `${this.config.frontendUrl}/api/dashboard/tickets/generate-station-tickets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: orderId,
            paper_width: paperWidth,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const result = await response.json() as { tickets?: StationTicket[] }
      return result.tickets || []
    } catch (error) {
      logger.error('Failed to fetch station tickets', error)
      return null
    }
  }

  private async fetchAdditionEscPos(orderId: string, additionGroupId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.config.frontendUrl}/api/dashboard/tickets/generate-escpos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: orderId,
            ticket_type: 'addition',
            addition_group_id: additionGroupId,
            paper_width: 80,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const result = await response.json() as { escposBase64?: string; data?: string }
      return result.escposBase64 || result.data || null
    } catch (error) {
      logger.error('Failed to fetch addition ESC/POS', error)
      return null
    }
  }

  private async fetchReportEscPos(reportId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.config.frontendUrl}/api/dashboard/cash/generate-report-escpos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            report_id: reportId,
            paper_width: 80,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`)
      }

      const result = await response.json() as { escposBase64?: string; data?: string }
      return result.escposBase64 || result.data || null
    } catch (error) {
      logger.error('Failed to fetch report ESC/POS', error)
      return null
    }
  }

  // ============================================
  // Heartbeat
  // ============================================

  private startHeartbeat() {
    this.sendHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 60000)
  }

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
          connection_mode: this.usePolling ? 'polling' : 'realtime',
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

  async updatePrinterStatus(status: 'ready' | 'error' | 'no_paper' | 'disconnected') {
    await this.sendHeartbeat(status)
  }

  // ============================================
  // Status
  // ============================================

  isConnected(): boolean {
    return this._isConnected
  }

  getStatus(): string {
    return this.realtimeStatus
  }

  getLastOrderTime(): Date | null {
    return this.lastOrderTime
  }

  getOrdersProcessed(): number {
    return this.ordersProcessed
  }

  getFullStatus(): { connected: boolean; restaurantId: string; mode: string } {
    return {
      connected: this._isConnected,
      restaurantId: this.config.restaurantId,
      mode: this.usePolling ? 'polling' : 'realtime',
    }
  }

  getSupabaseClient(): SupabaseClient {
    return this.supabase
  }
}

export default RealtimeManager
