import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import type { DeviceConfig, Order, RealtimePayload } from '../types/index.js'

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
  private isConnected: boolean = false
  private startTime: Date = new Date()

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
      logger.info('Connecting to Supabase Realtime...')

      // 1. Listen for new orders (INSERT on orders)
      const ordersChannel = this.supabase
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
            await this.handleNewOrder(payload.new)
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<Order>) => {
            await this.handleOrderUpdate(payload.new, payload.old)
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to orders channel')
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Orders channel error', err)
          }
        })
      this.channels.push(ordersChannel)

      // 2. Listen for customer ticket events (INSERT/UPDATE on order_tickets)
      const ticketsChannel = this.supabase
        .channel(`bitsperbox-tickets-${this.config.restaurantId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'order_tickets',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<OrderTicket>) => {
            if (payload.new.ticket_type === 'customer') {
              await this.handleNewCustomerTicket(payload.new)
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'order_tickets',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<OrderTicket>) => {
            // Check if print_requested_at changed (reprint request)
            if (
              payload.new.ticket_type === 'customer' &&
              payload.new.print_requested_at &&
              payload.new.print_requested_at !== payload.old?.print_requested_at
            ) {
              await this.handleReprintTicket(payload.new)
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to tickets channel')
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Tickets channel error', err)
          }
        })
      this.channels.push(ticketsChannel)

      // 3. Listen for cash report events (INSERT/UPDATE on cash_reports)
      const reportsChannel = this.supabase
        .channel(`bitsperbox-reports-${this.config.restaurantId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'cash_reports',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<CashReport>) => {
            if (payload.new.print_requested_at) {
              await this.handleNewCashReport(payload.new)
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'cash_reports',
            filter: `restaurant_id=eq.${this.config.restaurantId}`,
          },
          async (payload: RealtimePayload<CashReport>) => {
            // Check if print_requested_at changed (reprint request)
            if (
              payload.new.print_requested_at &&
              payload.new.print_requested_at !== payload.old?.print_requested_at
            ) {
              await this.handleReprintReport(payload.new)
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.success('Subscribed to reports channel')
          } else if (status === 'CHANNEL_ERROR') {
            logger.error('Reports channel error', err)
          }
        })
      this.channels.push(reportsChannel)

      // Start heartbeat
      this.startHeartbeat()

      this.isConnected = true
      return true
    } catch (error) {
      logger.error('Failed to connect to Supabase Realtime', error)
      return false
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
    this.isConnected = false
    logger.info('Disconnected from Supabase Realtime')
  }

  // ============================================
  // Event Handlers
  // ============================================

  private async handleNewOrder(order: Order) {
    logger.info(`New order received: #${order.order_number}`)

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

    for (const [groupId, items] of additionGroups) {
      if (oldAdditionGroupIds.has(groupId)) continue // Already processed

      logger.info(`Addition detected for order #${newOrder.order_number}, group ${groupId}`)

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
    logger.info(`New customer ticket for order ${ticket.order_id}`)

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
      if (escposData && this.onCustomerTicket) {
        await this.onCustomerTicket(ticket.id, ticket.order_id, escposData)
      }
      await this.completePrintJob(claim.job_id!, true)
    } catch (error) {
      logger.error('Error printing customer ticket', error)
      await this.completePrintJob(claim.job_id!, false, String(error))
    }
  }

  private async handleReprintTicket(ticket: OrderTicket) {
    logger.info(`Reprint requested for ticket ${ticket.id}`)
    // Same logic as new ticket
    await this.handleNewCustomerTicket(ticket)
  }

  private async handleNewCashReport(report: CashReport) {
    logger.info(`New cash report: ${report.report_type}`)

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
    logger.info(`Reprint requested for report ${report.id}`)
    // Same logic as new report
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

      const result = await response.json()
      return result.escposBase64 || result.data
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

      const result = await response.json()
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

      const result = await response.json()
      return result.escposBase64 || result.data
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

      const result = await response.json()
      return result.escposBase64 || result.data
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
