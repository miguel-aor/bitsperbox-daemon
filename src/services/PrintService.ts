import { logger } from '../utils/logger.js'
import { PrinterManager } from '../managers/PrinterManager.js'
import { PrinterRegistry } from '../managers/PrinterRegistry.js'
import type {
  DeviceConfig,
  Order,
  StationTicket,
  MultiPrintResult,
  LocalPrintRequest,
  LocalPrintResponse,
  StationTicketsRequest,
  StationTicketsResponse,
  PrinterRole
} from '../types/index.js'

/**
 * PrintService - Servicio de impresión con soporte multi-impresora
 *
 * Soporta dos modos:
 * 1. Legacy mode: Un solo PrinterManager para todo
 * 2. Multi-printer mode: PrinterRegistry con enrutamiento por rol
 */
export class PrintService {
  private printerManager: PrinterManager | null = null
  private printerRegistry: PrinterRegistry | null = null
  private config: DeviceConfig
  private useRegistry: boolean = false

  /**
   * Constructor con PrinterManager (legacy mode)
   */
  constructor(config: DeviceConfig, printerManager: PrinterManager)
  /**
   * Constructor con PrinterRegistry (multi-printer mode)
   */
  constructor(config: DeviceConfig, printerRegistry: PrinterRegistry)
  constructor(config: DeviceConfig, printer: PrinterManager | PrinterRegistry) {
    this.config = config

    if (printer instanceof PrinterRegistry) {
      this.printerRegistry = printer
      this.useRegistry = true
      logger.info('PrintService initialized in multi-printer mode')
    } else {
      this.printerManager = printer
      this.useRegistry = false
      logger.info('PrintService initialized in legacy mode')
    }
  }

  // ============================================
  // Kitchen Printing
  // ============================================

  /**
   * Print a kitchen order (single ticket to kitchen_default)
   */
  async printKitchenOrder(order: Order, escposData: string): Promise<boolean> {
    logger.print(`Printing kitchen order #${order.order_number}...`)

    try {
      let success: boolean

      if (this.useRegistry && this.printerRegistry) {
        const result = await this.printerRegistry.printBase64ByRole('kitchen_default', escposData)
        success = result.success
        if (success) {
          logger.debug(`  → Printed to: ${result.printerName}`)
        }
      } else if (this.printerManager) {
        success = await this.printerManager.printBase64(escposData)
      } else {
        logger.error('No printer configured')
        return false
      }

      if (success) {
        logger.success(`Order #${order.order_number} printed successfully`)
      } else {
        logger.error(`Failed to print order #${order.order_number}`)
      }

      return success
    } catch (error) {
      logger.error(`Error printing order #${order.order_number}`, error)
      return false
    }
  }

  /**
   * Print station tickets (multiple tickets for different kitchen stations)
   * En multi-printer mode, cada estación va a su impresora asignada
   */
  async printStationTickets(orderId: string, tickets: StationTicket[]): Promise<boolean> {
    logger.print(`Printing ${tickets.length} station ticket(s)...`)

    let allSuccess = true

    if (this.useRegistry && this.printerRegistry) {
      // Multi-printer mode: usar printStationTickets del registry
      const results = await this.printerRegistry.printStationTickets(tickets)

      for (const result of results) {
        if (result.success) {
          logger.info(`  ✓ ${result.printerName}`)
        } else {
          logger.error(`  ✗ ${result.printerName}: ${result.error}`)
          allSuccess = false
        }
      }
    } else if (this.printerManager) {
      // Legacy mode: todo a una impresora
      for (const ticket of tickets) {
        logger.info(`  Station: ${ticket.stationName}`)

        try {
          const copies = ticket.printerConfig?.copies || 1

          for (let i = 0; i < copies; i++) {
            const success = await this.printerManager.printBase64(ticket.escposBase64)
            if (!success) {
              logger.error(`Failed to print ticket for station ${ticket.stationName}`)
              allSuccess = false
            }
          }
        } catch (error) {
          logger.error(`Error printing station ${ticket.stationName}`, error)
          allSuccess = false
        }
      }
    } else {
      logger.error('No printer configured')
      return false
    }

    if (allSuccess) {
      logger.success(`All ${tickets.length} station tickets printed`)
    }

    return allSuccess
  }

  /**
   * Print an addition to an existing order
   */
  async printAddition(order: Order, additionGroupId: string, escposData: string): Promise<boolean> {
    logger.print(`Printing addition for order #${order.order_number} (group: ${additionGroupId})...`)

    try {
      let success: boolean

      if (this.useRegistry && this.printerRegistry) {
        const result = await this.printerRegistry.printBase64ByRole('kitchen_default', escposData)
        success = result.success
      } else if (this.printerManager) {
        success = await this.printerManager.printBase64(escposData)
      } else {
        return false
      }

      if (success) {
        logger.success(`Addition for order #${order.order_number} printed`)
      } else {
        logger.error(`Failed to print addition for order #${order.order_number}`)
      }

      return success
    } catch (error) {
      logger.error(`Error printing addition`, error)
      return false
    }
  }

  /**
   * Print addition station tickets (adiciones van a estaciones específicas)
   */
  async printAdditionStationTickets(
    order: Order,
    additionGroupId: string,
    tickets: StationTicket[]
  ): Promise<boolean> {
    logger.print(
      `Printing ${tickets.length} addition ticket(s) for order #${order.order_number}...`
    )

    // Usar el mismo método que station tickets
    return this.printStationTickets(order.id, tickets)
  }

  // ============================================
  // Customer Ticket Printing
  // ============================================

  /**
   * Print a customer ticket
   * En multi-printer mode, va a customer_ticket_printer
   * Si cashDrawerEnabled está activo, abre el cajón automáticamente
   */
  async printCustomerTicket(ticketId: string, orderId: string, escposData: string): Promise<boolean> {
    logger.print(`Printing customer ticket ${ticketId}...`)

    try {
      let success: boolean

      if (this.useRegistry && this.printerRegistry) {
        const result = await this.printerRegistry.printBase64ByRole('customer_ticket', escposData)
        success = result.success
        if (success) {
          logger.debug(`  → Printed to: ${result.printerName}`)
        }
      } else if (this.printerManager) {
        success = await this.printerManager.printBase64(escposData)
      } else {
        return false
      }

      if (success) {
        logger.success(`Customer ticket printed`)

        // Auto-open cash drawer if enabled in assignment
        if (this.useRegistry && this.printerRegistry) {
          const assignment = this.printerRegistry.getAssignment('customer_ticket')
          if (assignment?.cashDrawerEnabled) {
            logger.print(`Opening cash drawer (auto)...`)
            await this.openCashDrawer()
          }
        }
      } else {
        logger.error(`Failed to print customer ticket`)
      }

      return success
    } catch (error) {
      logger.error(`Error printing customer ticket`, error)
      return false
    }
  }

  /**
   * Print customer ticket and optionally open cash drawer
   * @param paymentMethod - Si es 'cash' o 'efectivo', se abre el cajón
   */
  async printCustomerTicketWithDrawer(
    ticketId: string,
    orderId: string,
    escposData: string,
    paymentMethod?: string
  ): Promise<boolean> {
    const success = await this.printCustomerTicket(ticketId, orderId, escposData)

    // Verificar si debemos abrir el cajón
    if (success && this.shouldOpenCashDrawer(paymentMethod)) {
      await this.openCashDrawer()
    }

    return success
  }

  /**
   * Determinar si debemos abrir el cajón de efectivo
   */
  private shouldOpenCashDrawer(paymentMethod?: string): boolean {
    if (!paymentMethod) return false

    const cashMethods = ['cash', 'efectivo', 'contado']
    const method = paymentMethod.toLowerCase()

    // Verificar si el método de pago es efectivo
    if (!cashMethods.some(m => method.includes(m))) {
      return false
    }

    // En multi-printer mode, verificar si está habilitado en la asignación
    if (this.useRegistry && this.printerRegistry) {
      const assignment = this.printerRegistry.getAssignment('customer_ticket')
      return assignment?.cashDrawerEnabled ?? false
    }

    // En legacy mode, siempre abrir para efectivo
    return true
  }

  // ============================================
  // Cash Drawer
  // ============================================

  /**
   * Open cash drawer
   */
  async openCashDrawer(): Promise<boolean> {
    logger.print('Opening cash drawer...')

    try {
      let success: boolean

      if (this.useRegistry && this.printerRegistry) {
        success = await this.printerRegistry.openCashDrawerByRole('customer_ticket')
      } else if (this.printerManager) {
        // ESC/POS comando para abrir cajón
        const cashDrawerCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])
        success = await this.printerManager.print(cashDrawerCommand)
      } else {
        return false
      }

      if (success) {
        logger.success('Cash drawer opened')
      } else {
        logger.error('Failed to open cash drawer')
      }

      return success
    } catch (error) {
      logger.error('Error opening cash drawer', error)
      return false
    }
  }

  // ============================================
  // Fiscal / Reports
  // ============================================

  /**
   * Print a cash report (X or Z report)
   * En multi-printer mode, va a fiscal_receipt_printer
   */
  async printCashReport(reportId: string, reportType: string, escposData: string): Promise<boolean> {
    logger.print(`Printing ${reportType} report...`)

    try {
      let success: boolean

      if (this.useRegistry && this.printerRegistry) {
        // Intentar fiscal primero, fallback a customer_ticket
        let result = await this.printerRegistry.printBase64ByRole('fiscal', escposData)
        if (!result.success) {
          logger.debug('Fiscal printer not available, trying customer_ticket printer')
          result = await this.printerRegistry.printBase64ByRole('customer_ticket', escposData)
        }
        success = result.success
      } else if (this.printerManager) {
        success = await this.printerManager.printBase64(escposData)
      } else {
        return false
      }

      if (success) {
        logger.success(`${reportType} report printed`)
      } else {
        logger.error(`Failed to print ${reportType} report`)
      }

      return success
    } catch (error) {
      logger.error(`Error printing cash report`, error)
      return false
    }
  }

  // ============================================
  // Testing
  // ============================================

  /**
   * Print a test page
   */
  async printTestPage(): Promise<boolean> {
    if (this.useRegistry && this.printerRegistry) {
      // En multi-printer mode, imprimir en la default
      const defaultPrinter = this.printerRegistry.getDefaultPrinter()
      if (defaultPrinter) {
        return defaultPrinter.printTestPage()
      }
      logger.error('No default printer configured')
      return false
    } else if (this.printerManager) {
      return this.printerManager.printTestPage()
    }
    return false
  }

  /**
   * Print test page to specific printer (solo multi-printer mode)
   */
  async printTestPageToPrinter(printerId: string): Promise<boolean> {
    if (!this.useRegistry || !this.printerRegistry) {
      logger.warn('printTestPageToPrinter only available in multi-printer mode')
      return this.printTestPage()
    }

    return this.printerRegistry.printTestPage(printerId)
  }

  // ============================================
  // Status
  // ============================================

  /**
   * Get service status
   */
  getStatus(): {
    mode: 'legacy' | 'multi-printer'
    printers?: number
    assignments?: number
  } {
    if (this.useRegistry && this.printerRegistry) {
      return {
        mode: 'multi-printer',
        printers: this.printerRegistry.getAllPrinters().length,
        assignments: this.printerRegistry.getAssignments().length,
      }
    }

    return {
      mode: 'legacy',
    }
  }

  /**
   * Get printer registry (for direct access if needed)
   */
  getRegistry(): PrinterRegistry | null {
    return this.printerRegistry
  }

  // ============================================
  // Local Print API Methods (Frontend → BitsperBox)
  // ============================================

  /**
   * Print from a local API request (frontend direct print)
   * This is the main entry point for local-first printing
   */
  async printFromRequest(request: LocalPrintRequest): Promise<LocalPrintResponse> {
    const startTime = Date.now()
    logger.print(`[LocalPrint] Received ${request.job_type} job from ${request.metadata.device_id}`)

    try {
      let success = false
      let printerName = 'unknown'

      // Determine the role based on job_type if not specified
      const role: PrinterRole = request.role || this.getDefaultRoleForJobType(request.job_type)

      // Print based on role
      if (this.useRegistry && this.printerRegistry) {
        const copies = request.copies || 1

        for (let i = 0; i < copies; i++) {
          // Use printBase64ByRole with optional stationId
          const result = await this.printerRegistry.printBase64ByRole(
            role,
            request.escpos_base64,
            request.station_id
          )
          success = result.success
          printerName = result.printerName || role

          if (!success) break
        }
      } else if (this.printerManager) {
        // Legacy mode: single printer
        const copies = request.copies || 1
        for (let i = 0; i < copies; i++) {
          success = await this.printerManager.printBase64(request.escpos_base64)
          if (!success) break
        }
        printerName = 'default'
      } else {
        return {
          success: false,
          error: 'No printer configured',
          retryable: false
        }
      }

      // Handle cash drawer if requested
      if (success && request.open_cash_drawer) {
        await this.openCashDrawer()
      }

      const elapsed = Date.now() - startTime
      logger.print(`[LocalPrint] ${success ? 'Success' : 'Failed'} in ${elapsed}ms → ${printerName}`)

      return {
        success,
        printed_at: success ? new Date().toISOString() : undefined,
        printer_name: success ? printerName : undefined,
        error: success ? undefined : 'Print failed',
        retryable: !success
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`[LocalPrint] Error: ${errorMessage}`)

      return {
        success: false,
        error: errorMessage,
        retryable: true
      }
    }
  }

  /**
   * Print station tickets from a local API request
   */
  async printStationTicketsFromRequest(request: StationTicketsRequest): Promise<StationTicketsResponse> {
    logger.print(`[LocalPrint] Printing ${request.tickets.length} station tickets for order ${request.metadata.order_id}`)

    const results: StationTicketsResponse['results'] = []
    let allSuccess = true

    for (const ticket of request.tickets) {
      try {
        let success = false
        let printerName = 'unknown'

        if (this.useRegistry && this.printerRegistry) {
          // Use station role with station_id
          const copies = ticket.copies || 1

          for (let i = 0; i < copies; i++) {
            const result = await this.printerRegistry.printBase64ByRole(
              'station',
              ticket.escpos_base64,
              ticket.station_id
            )
            success = result.success
            printerName = result.printerName || `station-${ticket.station_id}`

            if (!success) break
          }
        } else if (this.printerManager) {
          // Legacy mode: all to single printer
          const copies = ticket.copies || 1
          for (let i = 0; i < copies; i++) {
            success = await this.printerManager.printBase64(ticket.escpos_base64)
            if (!success) break
          }
          printerName = 'default'
        }

        results.push({
          station_id: ticket.station_id,
          station_name: ticket.station_name,
          success,
          printer_name: success ? printerName : undefined,
          error: success ? undefined : 'Print failed'
        })

        if (!success) allSuccess = false
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        results.push({
          station_id: ticket.station_id,
          station_name: ticket.station_name,
          success: false,
          error: errorMessage
        })
        allSuccess = false
      }
    }

    return {
      success: allSuccess,
      results
    }
  }

  /**
   * Open cash drawer from local API request
   */
  async openCashDrawerFromRequest(role?: 'customer_ticket' | 'fiscal'): Promise<boolean> {
    logger.print(`[LocalPrint] Opening cash drawer (role: ${role || 'customer_ticket'})`)

    try {
      if (this.useRegistry && this.printerRegistry) {
        return await this.printerRegistry.openCashDrawerByRole(role || 'customer_ticket')
      } else if (this.printerManager) {
        const cashDrawerCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])
        return await this.printerManager.print(cashDrawerCommand)
      }
      return false
    } catch (error) {
      logger.error('[LocalPrint] Error opening cash drawer:', error)
      return false
    }
  }

  /**
   * Get default printer role for a job type
   */
  private getDefaultRoleForJobType(jobType: LocalPrintRequest['job_type']): PrinterRole {
    switch (jobType) {
      case 'kitchen_order':
      case 'addition':
        return 'kitchen_default'
      case 'customer_ticket':
        return 'customer_ticket'
      case 'cash_report':
        return 'fiscal'
      case 'station_ticket':
        return 'station'
      default:
        return 'kitchen_default'
    }
  }
}

export default PrintService
