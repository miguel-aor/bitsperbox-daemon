#!/usr/bin/env node

import { logger } from './utils/logger.js'
import { getConfig, isConfigured } from './utils/config.js'
import { PrinterManager } from './managers/PrinterManager.js'
import { RealtimeManager } from './managers/RealtimeManager.js'
import { PrintService } from './services/PrintService.js'

const VERSION = '1.0.0'

async function main() {
  // Display banner
  console.log('')
  logger.box('BitsperBox Daemon v' + VERSION, [
    'Hardware bridge for BitsperFoods',
    'Raspberry Pi Print Server',
  ])
  console.log('')

  // Check configuration
  if (!isConfigured()) {
    logger.error('BitsperBox is not configured!')
    logger.info('Run: npm run setup')
    process.exit(1)
  }

  const config = getConfig()
  if (!config) {
    logger.error('Failed to load configuration')
    process.exit(1)
  }

  logger.info(`Restaurant: ${config.restaurantName || config.restaurantId}`)
  logger.info(`Device ID: ${config.deviceId}`)

  // Initialize Printer Manager
  logger.info('Initializing printer...')
  const printerManager = new PrinterManager(config.printer)

  // Detect printers
  const printers = await printerManager.detectPrinters()
  if (printers.length === 0) {
    logger.warn('No USB printers detected')
    logger.info('Make sure the printer is connected and powered on')
  } else {
    logger.success(`Found ${printers.length} printer(s)`)
    printers.forEach(p => {
      logger.info(`  - ${p.vendorName} (${p.devicePath || `${p.vendorId}:${p.productId}`})`)
    })
  }

  // Test printer connection
  if (config.printer) {
    const connected = await printerManager.testConnection()
    if (connected) {
      logger.success('Printer connection OK')
    } else {
      logger.warn('Printer connection failed - will retry on print')
    }
  }

  // Initialize Realtime Manager
  logger.info('Connecting to BitsperFoods cloud...')
  const realtimeManager = new RealtimeManager(config)

  // Initialize Print Service
  const printService = new PrintService(config, printerManager, realtimeManager)

  // Set up callbacks
  realtimeManager.setOrderCallback(async order => {
    await printService.handleNewOrder(order)
  })

  realtimeManager.setPrintJobCallback(async job => {
    await printService.handlePrintJob(job)
  })

  // Connect to Realtime
  const connected = await realtimeManager.connect()
  if (!connected) {
    logger.error('Failed to connect to cloud')
    process.exit(1)
  }

  logger.success('BitsperBox is running!')
  logger.info('Waiting for orders...')
  console.log('')

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log('')
    logger.info(`Received ${signal}, shutting down...`)
    await realtimeManager.disconnect()
    logger.info('Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Keep the process alive
  process.stdin.resume()
}

main().catch(error => {
  logger.error('Fatal error', error)
  process.exit(1)
})
