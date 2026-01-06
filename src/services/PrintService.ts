import { logger } from '../utils/logger.js'
import { PrinterManager } from '../managers/PrinterManager.js'
import { RealtimeManager } from '../managers/RealtimeManager.js'
import type { Order, PrintJob, DeviceConfig } from '../types/index.js'

export class PrintService {
  private printerManager: PrinterManager
  private realtimeManager: RealtimeManager
  private config: DeviceConfig
  private processedOrders: Set<string> = new Set()
  private processedJobs: Set<string> = new Set()

  constructor(config: DeviceConfig, printerManager: PrinterManager, realtimeManager: RealtimeManager) {
    this.config = config
    this.printerManager = printerManager
    this.realtimeManager = realtimeManager

    // Clean up processed sets every 5 minutes to prevent memory leak
    setInterval(() => {
      this.cleanupProcessedSets()
    }, 5 * 60 * 1000)
  }

  /**
   * Handle a new order from Realtime
   */
  async handleNewOrder(order: Order): Promise<void> {
    // Skip if already processed
    if (this.processedOrders.has(order.id)) {
      logger.debug(`Order ${order.order_number} already processed, skipping`)
      return
    }

    logger.info(`Processing order #${order.order_number}...`)

    // Try to claim the print job atomically
    const claim = await this.realtimeManager.claimPrintJob('kitchen_order', order.id)

    if (!claim.success) {
      logger.debug(`Order ${order.order_number} claimed by another device`)
      this.processedOrders.add(order.id)
      return
    }

    // Mark as processed
    this.processedOrders.add(order.id)

    try {
      // Fetch ESC/POS data from API
      const escposData = await this.realtimeManager.fetchEscPosData(order.id, 'kitchen')

      if (!escposData) {
        throw new Error('Failed to fetch ESC/POS data')
      }

      // Print
      const success = await this.printerManager.printBase64(escposData)

      if (success) {
        logger.success(`Order #${order.order_number} printed successfully`)
        await this.realtimeManager.completePrintJob(claim.jobId!, true)
      } else {
        throw new Error('Printer returned failure')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to print order #${order.order_number}`, error)
      await this.realtimeManager.completePrintJob(claim.jobId!, false, errorMessage)
      await this.realtimeManager.updatePrinterStatus('error')
    }
  }

  /**
   * Handle a print job from the print_jobs table
   */
  async handlePrintJob(job: PrintJob): Promise<void> {
    // Skip if already processed or not pending
    if (this.processedJobs.has(job.id) || job.status !== 'pending') {
      return
    }

    logger.info(`Processing print job: ${job.job_type}`)

    // Try to claim
    const claim = await this.realtimeManager.claimPrintJob(job.job_type, job.order_id)

    if (!claim.success) {
      logger.debug(`Print job ${job.id} claimed by another device`)
      this.processedJobs.add(job.id)
      return
    }

    this.processedJobs.add(job.id)

    try {
      let escposData: string | null = null

      // If ESC/POS data is provided in the job, use it
      if (job.escpos_data) {
        escposData = job.escpos_data
      } else {
        // Otherwise fetch from API
        const ticketType = job.job_type === 'customer_ticket' ? 'customer' : 'kitchen'
        escposData = await this.realtimeManager.fetchEscPosData(job.order_id, ticketType)
      }

      if (!escposData) {
        throw new Error('No ESC/POS data available')
      }

      const success = await this.printerManager.printBase64(escposData)

      if (success) {
        logger.success(`Print job ${job.job_type} completed`)
        await this.realtimeManager.completePrintJob(claim.jobId!, true)
      } else {
        throw new Error('Printer returned failure')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to process print job ${job.id}`, error)
      await this.realtimeManager.completePrintJob(claim.jobId!, false, errorMessage)
    }
  }

  /**
   * Print a test page
   */
  async printTestPage(): Promise<boolean> {
    return this.printerManager.printTestPage()
  }

  /**
   * Clean up old entries from processed sets
   */
  private cleanupProcessedSets() {
    const maxSize = 100
    if (this.processedOrders.size > maxSize) {
      const entries = Array.from(this.processedOrders)
      this.processedOrders = new Set(entries.slice(-50))
      logger.debug('Cleaned up processed orders set')
    }
    if (this.processedJobs.size > maxSize) {
      const entries = Array.from(this.processedJobs)
      this.processedJobs = new Set(entries.slice(-50))
      logger.debug('Cleaned up processed jobs set')
    }
  }
}

export default PrintService
