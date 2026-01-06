#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as readline from 'readline'
import { logger } from './utils/logger.js'
import { saveConfig, getConfig, clearConfig, getConfigPath, isConfigured, savePrinterConfig } from './utils/config.js'
import { PrinterManager } from './managers/PrinterManager.js'
import { createClient } from '@supabase/supabase-js'

const VERSION = '1.0.0'

const program = new Command()

// Helper to prompt user input
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// Helper to prompt yes/no
async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n): `)
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}

program
  .name('bitsperbox')
  .description('BitsperBox - Hardware bridge daemon for BitsperFoods')
  .version(VERSION)

// Setup command
program
  .command('setup')
  .description('Configure BitsperBox for your restaurant')
  .action(async () => {
    console.log('')
    console.log(chalk.cyan.bold('╔════════════════════════════════════════╗'))
    console.log(chalk.cyan.bold('║       BitsperBox Setup Wizard          ║'))
    console.log(chalk.cyan.bold('╚════════════════════════════════════════╝'))
    console.log('')

    // Check if already configured
    if (isConfigured()) {
      const overwrite = await confirm(chalk.yellow('BitsperBox is already configured. Overwrite?'))
      if (!overwrite) {
        console.log('Setup cancelled.')
        process.exit(0)
      }
      clearConfig()
    }

    // Step 1: Supabase URL
    console.log(chalk.blue('\n📡 Step 1: Supabase Connection\n'))
    const supabaseUrl = await prompt('Supabase URL: ')
    if (!supabaseUrl.includes('supabase')) {
      console.log(chalk.red('Invalid Supabase URL'))
      process.exit(1)
    }

    // Step 2: Frontend URL
    console.log(chalk.blue('\n🌐 Step 2: Frontend URL\n'))
    console.log(chalk.gray('La URL donde corre tu frontend de BitsperFoods'))
    console.log(chalk.gray('- Desarrollo: http://192.168.X.X:3000 (IP de tu Mac/PC)'))
    console.log(chalk.gray('- Producción: https://app.bitsperfoods.com'))
    const frontendUrl = await prompt('Frontend URL: ')
    if (!frontendUrl.startsWith('http')) {
      console.log(chalk.red('Invalid URL - must start with http:// or https://'))
      process.exit(1)
    }

    // Step 3: Device Token (or Service Key for now)
    console.log(chalk.blue('\n🔑 Step 3: Authentication\n'))
    console.log(chalk.gray('Get your device token from: Dashboard > Settings > BitsperBox'))
    const supabaseKey = await prompt('Supabase Service Key or Device Token: ')

    // Validate connection
    const spinner = ora('Testing connection...').start()
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      // Test connection with a simple query to menu_pro_settings
      const { data, error } = await supabase.from('menu_pro_settings').select('id, restaurant_id').limit(1)

      if (error) throw error
      spinner.succeed('Connection successful!')
    } catch (error) {
      spinner.fail('Connection failed')
      console.log(chalk.red('Please check your Supabase URL and key'))
      console.log(chalk.gray(String(error)))
      process.exit(1)
    }

    // Step 4: Restaurant ID
    console.log(chalk.blue('\n🍽️  Step 4: Restaurant\n'))
    const restaurantId = await prompt('Restaurant ID: ')

    // Validate restaurant
    const spinner2 = ora('Validating restaurant...').start()
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data, error } = await supabase
        .from('restaurant_profiles')
        .select('id, restaurant_name')
        .eq('id', restaurantId)
        .single()

      if (error || !data) throw new Error('Restaurant not found')
      spinner2.succeed(`Restaurant: ${data.restaurant_name || restaurantId}`)

      // Generate device ID
      const deviceId = `bitsperbox-${Date.now().toString(36)}`

      // Save config
      saveConfig({
        deviceId,
        deviceToken: supabaseKey, // For now, use service key
        restaurantId,
        restaurantName: data.restaurant_name || restaurantId,
        supabaseUrl,
        supabaseKey,
        frontendUrl,
      })

      console.log(chalk.blue('\n🖨️  Step 5: Printer Setup\n'))
      const setupPrinter = await confirm('Would you like to configure a printer now?')

      if (setupPrinter) {
        await setupPrinterWizard()
      }

      console.log('')
      console.log(chalk.green.bold('✅ BitsperBox configured successfully!'))
      console.log('')
      console.log(chalk.gray(`Config saved to: ${getConfigPath()}`))
      console.log(chalk.gray(`Device ID: ${deviceId}`))
      console.log('')
      console.log('To start the daemon, run:')
      console.log(chalk.cyan('  npm start'))
      console.log('')
      console.log('To install as a service (auto-start on boot):')
      console.log(chalk.cyan('  npm run install:service'))
      console.log('')

    } catch (error) {
      spinner2.fail('Restaurant not found')
      process.exit(1)
    }
  })

// Printer setup wizard
async function setupPrinterWizard() {
  const printerManager = new PrinterManager()

  console.log(chalk.gray('Scanning for USB printers...'))
  const printers = await printerManager.detectPrinters()

  if (printers.length === 0) {
    console.log(chalk.yellow('No USB printers detected.'))
    console.log(chalk.gray('Make sure your printer is connected and powered on.'))

    const useNetwork = await confirm('Configure a network printer instead?')
    if (useNetwork) {
      const ip = await prompt('Printer IP address: ')
      const port = await prompt('Printer port (default 9100): ') || '9100'

      savePrinterConfig({
        type: 'network',
        ip,
        port: parseInt(port),
      })

      // Test connection
      printerManager.setConfig({ type: 'network', ip, port: parseInt(port) })
      const connected = await printerManager.testConnection()
      if (connected) {
        console.log(chalk.green('✓ Network printer connected'))
      } else {
        console.log(chalk.yellow('⚠ Could not connect to printer'))
      }
    }
    return
  }

  console.log(`\nFound ${printers.length} printer(s):`)
  printers.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.vendorName} ${p.productName || ''} (${p.devicePath || `${p.vendorId}:${p.productId}`})`)
  })

  const selection = await prompt('\nSelect printer (number): ')
  const index = parseInt(selection) - 1

  if (index < 0 || index >= printers.length) {
    console.log(chalk.yellow('Invalid selection, skipping printer setup'))
    return
  }

  const selected = printers[index]
  savePrinterConfig({
    type: 'usb',
    vendorId: selected.vendorId,
    productId: selected.productId,
  })

  // Test print
  const testPrint = await confirm('Print a test page?')
  if (testPrint) {
    printerManager.setConfig({
      type: 'usb',
      vendorId: selected.vendorId,
      productId: selected.productId,
    })
    const success = await printerManager.printTestPage()
    if (success) {
      console.log(chalk.green('✓ Test page printed'))
    } else {
      console.log(chalk.yellow('⚠ Failed to print test page'))
    }
  }
}

// Status command
program
  .command('status')
  .description('Show BitsperBox status')
  .action(async () => {
    console.log('')
    console.log(chalk.cyan.bold('BitsperBox Status'))
    console.log(chalk.gray('─'.repeat(40)))

    if (!isConfigured()) {
      console.log(chalk.yellow('Not configured'))
      console.log('Run: bitsperbox setup')
      return
    }

    const config = getConfig()
    if (!config) {
      console.log(chalk.red('Configuration error'))
      return
    }

    console.log(`Restaurant: ${chalk.green(config.restaurantName || config.restaurantId)}`)
    console.log(`Device ID:  ${chalk.gray(config.deviceId)}`)
    console.log(`Config:     ${chalk.gray(getConfigPath())}`)

    // Check printer
    console.log('')
    console.log(chalk.cyan('Printer:'))
    if (config.printer) {
      const printerManager = new PrinterManager(config.printer)
      const connected = await printerManager.testConnection()
      if (connected) {
        console.log(`  Status: ${chalk.green('Connected')}`)
        console.log(`  Type:   ${config.printer.type}`)
      } else {
        console.log(`  Status: ${chalk.yellow('Disconnected')}`)
      }
    } else {
      console.log(`  Status: ${chalk.gray('Not configured')}`)
    }

    console.log('')
  })

// Test print command
program
  .command('test-print')
  .description('Print a test page')
  .action(async () => {
    if (!isConfigured()) {
      console.log(chalk.red('Not configured. Run: bitsperbox setup'))
      process.exit(1)
    }

    const config = getConfig()
    if (!config?.printer) {
      console.log(chalk.red('No printer configured'))
      process.exit(1)
    }

    const spinner = ora('Printing test page...').start()
    const printerManager = new PrinterManager(config.printer)
    const success = await printerManager.printTestPage()

    if (success) {
      spinner.succeed('Test page printed!')
    } else {
      spinner.fail('Failed to print')
    }
  })

// Reset command
program
  .command('reset')
  .description('Reset all configuration')
  .action(async () => {
    const confirmed = await confirm(chalk.red('This will delete all configuration. Are you sure?'))
    if (confirmed) {
      clearConfig()
      console.log(chalk.green('Configuration reset'))
    }
  })

// Detect printers command
program
  .command('detect-printers')
  .description('Detect connected USB printers')
  .action(async () => {
    console.log(chalk.cyan('\nScanning for USB printers...\n'))
    const printerManager = new PrinterManager()
    const printers = await printerManager.detectPrinters()

    if (printers.length === 0) {
      console.log(chalk.yellow('No printers detected'))
      console.log(chalk.gray('\nTips:'))
      console.log(chalk.gray('- Make sure the printer is connected via USB'))
      console.log(chalk.gray('- Check that the printer is powered on'))
      console.log(chalk.gray('- Try: sudo usermod -a -G lp $USER (then logout/login)'))
      return
    }

    console.log(`Found ${printers.length} printer(s):\n`)
    printers.forEach((p, i) => {
      console.log(`${chalk.green(i + 1)}. ${chalk.bold(p.vendorName)} ${p.productName || ''}`)
      console.log(`   Vendor ID:  0x${p.vendorId.toString(16).padStart(4, '0')}`)
      console.log(`   Product ID: 0x${p.productId.toString(16).padStart(4, '0')}`)
      if (p.devicePath) {
        console.log(`   Device:     ${p.devicePath}`)
      }
      console.log('')
    })
  })

program.parse()
