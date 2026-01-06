import { logger } from '../utils/logger.js'
import { PrinterManager } from '../managers/PrinterManager.js'
import type { DeviceConfig, Order } from '../types/index.js'

interface StationTicket {
  stationId: string
  stationName: string
  printerConfig: {
    printer_name: string
    copies: number
  }
  escposBase64: string
}

export class PrintService {
  private printerManager: PrinterManager
  private config: DeviceConfig

  constructor(config: DeviceConfig, printerManager: PrinterManager) {
    this.config = config
    this.printerManager = printerManager
  }

  /**
   * Print a kitchen order (single ticket)
   */
  async printKitchenOrder(order: Order, escposData: string): Promise<boolean> {
    logger.print(`Printing kitchen order #${order.order_number}...`)

    try {
      const success = await this.printerManager.printBase64(escposData)

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
   */
  async printStationTickets(orderId: string, tickets: StationTicket[]): Promise<boolean> {
    logger.print(`Printing ${tickets.length} station ticket(s)...`)

    let allSuccess = true

    for (const ticket of tickets) {
      logger.info(`  Station: ${ticket.stationName}`)

      try {
        // Print the number of copies configured
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
      const success = await this.printerManager.printBase64(escposData)

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
   * Print a customer ticket
   */
  async printCustomerTicket(ticketId: string, orderId: string, escposData: string): Promise<boolean> {
    logger.print(`Printing customer ticket ${ticketId}...`)

    try {
      const success = await this.printerManager.printBase64(escposData)

      if (success) {
        logger.success(`Customer ticket printed`)
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
   * Print a cash report (X or Z report)
   */
  async printCashReport(reportId: string, reportType: string, escposData: string): Promise<boolean> {
    logger.print(`Printing ${reportType} report...`)

    try {
      const success = await this.printerManager.printBase64(escposData)

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

  /**
   * Print a test page
   */
  async printTestPage(): Promise<boolean> {
    return this.printerManager.printTestPage()
  }
}

export default PrintService
