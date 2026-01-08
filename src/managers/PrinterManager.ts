import { usb, WebUSB, findBySerialNumber } from 'usb'
import { logger } from '../utils/logger.js'
import type { PrinterConfig, BluetoothDevice } from '../types/index.js'
import * as fs from 'fs'
import * as net from 'net'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Common thermal printer vendor IDs
const KNOWN_PRINTER_VENDORS = [
  { vendorId: 0x04b8, name: 'Epson' },
  { vendorId: 0x0519, name: 'Star Micronics' },
  { vendorId: 0x0dd4, name: 'Custom' },
  { vendorId: 0x0fe6, name: 'ICS/Kontron' },
  { vendorId: 0x0483, name: 'STMicroelectronics (Generic)' },
  { vendorId: 0x1fc9, name: 'NXP (Generic)' },
  { vendorId: 0x0416, name: 'Winbond (Generic China)' },
  { vendorId: 0x1a86, name: 'QinHeng (Generic China)' },
  { vendorId: 0x6868, name: 'Generic POS' },
  { vendorId: 0x28e9, name: 'GDMicroelectronics' },
  { vendorId: 0x040a, name: 'Kodak' },
  { vendorId: 0x0456, name: 'Analog Devices' },
  { vendorId: 0x0471, name: 'Philips' },
  { vendorId: 0x20d1, name: 'Simba' },
  { vendorId: 0x0fe6, name: 'Kontron' },
  { vendorId: 0x4348, name: 'WinChipHead (CH340)' },
  { vendorId: 0x1504, name: 'SNBC' },
  { vendorId: 0x0493, name: 'MAG Technology' },
  { vendorId: 0x0fe6, name: 'Citizen' },
  { vendorId: 0x0485, name: 'Nokia' },
]

interface DetectedPrinter {
  vendorId: number
  productId: number
  vendorName: string
  productName?: string
  serialNumber?: string
  devicePath?: string
}

export class PrinterManager {
  private config: PrinterConfig | null = null
  private devicePath: string | null = null
  private isConnected: boolean = false

  constructor(config?: PrinterConfig) {
    if (config) {
      this.config = config
    }
  }

  /**
   * Detect USB printers connected to the system
   */
  async detectPrinters(): Promise<DetectedPrinter[]> {
    const printers: DetectedPrinter[] = []

    try {
      const devices = usb.getDeviceList()

      for (const device of devices) {
        const vendorInfo = KNOWN_PRINTER_VENDORS.find(
          v => v.vendorId === device.deviceDescriptor.idVendor
        )

        if (vendorInfo) {
          try {
            device.open()
            const productName = device.deviceDescriptor.iProduct
              ? await this.getStringDescriptor(device, device.deviceDescriptor.iProduct)
              : undefined

            printers.push({
              vendorId: device.deviceDescriptor.idVendor,
              productId: device.deviceDescriptor.idProduct,
              vendorName: vendorInfo.name,
              productName,
            })
            device.close()
          } catch {
            // Device might be busy or require permissions
            printers.push({
              vendorId: device.deviceDescriptor.idVendor,
              productId: device.deviceDescriptor.idProduct,
              vendorName: vendorInfo.name,
            })
          }
        }
      }

      // Also check for /dev/usb/lp* devices
      const lpDevices = await this.detectLpDevices()
      for (const lp of lpDevices) {
        const existing = printers.find(
          p => lp.vendorId && p.vendorId === lp.vendorId && p.productId === lp.productId
        )
        if (existing) {
          existing.devicePath = lp.devicePath
        } else if (lp.devicePath) {
          printers.push({
            vendorId: lp.vendorId || 0,
            productId: lp.productId || 0,
            vendorName: 'USB Printer',
            devicePath: lp.devicePath,
          })
        }
      }
    } catch (error) {
      logger.error('Error detecting USB printers', error)
    }

    return printers
  }

  private async detectLpDevices(): Promise<Array<{ devicePath: string; vendorId?: number; productId?: number }>> {
    const devices: Array<{ devicePath: string; vendorId?: number; productId?: number }> = []

    try {
      // Check /dev/usb/lp*
      if (fs.existsSync('/dev/usb')) {
        const files = fs.readdirSync('/dev/usb')
        for (const file of files) {
          if (file.startsWith('lp')) {
            devices.push({ devicePath: `/dev/usb/${file}` })
          }
        }
      }

      // Also check direct /dev/lp* (older systems)
      for (let i = 0; i < 4; i++) {
        const path = `/dev/lp${i}`
        if (fs.existsSync(path)) {
          devices.push({ devicePath: path })
        }
      }
    } catch (error) {
      logger.debug('Error detecting lp devices', error)
    }

    return devices
  }

  private getStringDescriptor(device: usb.Device, index: number): Promise<string> {
    return new Promise((resolve, reject) => {
      device.getStringDescriptor(index, (error, data) => {
        if (error) reject(error)
        else resolve(data || '')
      })
    })
  }

  /**
   * Configure printer connection
   */
  setConfig(config: PrinterConfig) {
    this.config = config
    this.isConnected = false
  }

  /**
   * Test printer connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.config) {
      logger.error('No printer configured')
      return false
    }

    try {
      if (this.config.type === 'usb') {
        return await this.testUsbConnection()
      } else if (this.config.type === 'network') {
        return await this.testNetworkConnection()
      } else if (this.config.type === 'bluetooth') {
        return await this.testBluetoothConnection()
      }
      return false
    } catch (error) {
      logger.error('Printer connection test failed', error)
      return false
    }
  }

  private async testUsbConnection(): Promise<boolean> {
    // Try to find device path
    const lpDevices = await this.detectLpDevices()
    if (lpDevices.length > 0) {
      this.devicePath = lpDevices[0].devicePath
      logger.info(`Found printer at ${this.devicePath}`)
      this.isConnected = true
      return true
    }

    // Try USB device directly
    if (this.config?.vendorId && this.config?.productId) {
      const devices = usb.getDeviceList()
      const printer = devices.find(
        d =>
          d.deviceDescriptor.idVendor === this.config!.vendorId &&
          d.deviceDescriptor.idProduct === this.config!.productId
      )
      if (printer) {
        logger.info(`Found USB printer: ${this.config.vendorId}:${this.config.productId}`)
        this.isConnected = true
        return true
      }
    }

    return false
  }

  private async testNetworkConnection(): Promise<boolean> {
    if (!this.config?.ip || !this.config?.port) {
      return false
    }

    return new Promise(resolve => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 3000)

      socket.connect(this.config!.port!, this.config!.ip!, () => {
        clearTimeout(timeout)
        socket.destroy()
        this.isConnected = true
        logger.info(`Connected to network printer at ${this.config!.ip}:${this.config!.port}`)
        resolve(true)
      })

      socket.on('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  /**
   * Print raw ESC/POS data
   */
  async print(data: Buffer): Promise<boolean> {
    if (!this.config) {
      logger.error('No printer configured')
      return false
    }

    try {
      if (this.config.type === 'usb') {
        return await this.printUsb(data)
      } else if (this.config.type === 'network') {
        return await this.printNetwork(data)
      } else if (this.config.type === 'bluetooth') {
        return await this.printBluetooth(data)
      }
      return false
    } catch (error) {
      logger.error('Print failed', error)
      return false
    }
  }

  /**
   * Print base64 encoded ESC/POS data
   */
  async printBase64(base64Data: string): Promise<boolean> {
    const buffer = Buffer.from(base64Data, 'base64')
    return this.print(buffer)
  }

  private async printUsb(data: Buffer): Promise<boolean> {
    // Method 1: Direct file write to /dev/usb/lp*
    if (this.devicePath) {
      try {
        fs.writeFileSync(this.devicePath, data)
        logger.print(`Printed ${data.length} bytes to ${this.devicePath}`)
        return true
      } catch (error) {
        logger.error(`Failed to write to ${this.devicePath}`, error)
      }
    }

    // Method 2: Find and use /dev/usb/lp0
    const lpDevices = await this.detectLpDevices()
    if (lpDevices.length > 0) {
      try {
        fs.writeFileSync(lpDevices[0].devicePath, data)
        logger.print(`Printed ${data.length} bytes to ${lpDevices[0].devicePath}`)
        this.devicePath = lpDevices[0].devicePath
        return true
      } catch (error) {
        logger.error('Failed to print via /dev/usb/lp*', error)
      }
    }

    logger.error('No USB printer device found')
    return false
  }

  private async printNetwork(data: Buffer): Promise<boolean> {
    if (!this.config?.ip || !this.config?.port) {
      logger.error('Network printer IP/port not configured')
      return false
    }

    return new Promise(resolve => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        logger.error('Network print timeout')
        resolve(false)
      }, 10000)

      socket.connect(this.config!.port!, this.config!.ip!, () => {
        socket.write(data, () => {
          clearTimeout(timeout)
          socket.end()
          logger.print(`Printed ${data.length} bytes to ${this.config!.ip}:${this.config!.port}`)
          resolve(true)
        })
      })

      socket.on('error', error => {
        clearTimeout(timeout)
        logger.error('Network print error', error)
        resolve(false)
      })
    })
  }

  /**
   * Print a test page (simplified for maximum compatibility)
   */
  async printTestPage(): Promise<boolean> {
    // Simple ESC/POS commands - compatible with most thermal printers
    const commands = [
      '\x1B\x40',           // ESC @ - Initialize printer
      '\x1B\x61\x01',       // ESC a 1 - Center align
      '\n',
      '*** BITSPERBOX ***\n',
      '===================\n',
      '\x1B\x61\x00',       // ESC a 0 - Left align
      'Printer Test Page\n',
      `Date: ${new Date().toLocaleString()}\n`,
      '-------------------\n',
      'If you can read this,\n',
      'the printer is working!\n',
      '===================\n',
      '\n\n\n',
      '\x1D\x56\x41\x03',   // GS V A 3 - Partial cut (with feed)
    ].join('')

    const testPage = Buffer.from(commands, 'binary')
    return this.print(testPage)
  }

  // ============================================
  // Bluetooth Methods
  // ============================================

  /**
   * Scan for Bluetooth devices (paired and nearby)
   */
  async scanBluetoothDevices(): Promise<BluetoothDevice[]> {
    const devices: BluetoothDevice[] = []

    try {
      // Get paired devices
      const { stdout: pairedOutput } = await execAsync('bluetoothctl devices Paired 2>/dev/null || bluetoothctl devices 2>/dev/null')
      const lines = pairedOutput.trim().split('\n').filter(line => line.startsWith('Device'))

      for (const line of lines) {
        // Format: "Device XX:XX:XX:XX:XX:XX Device Name"
        const match = line.match(/Device ([0-9A-Fa-f:]{17}) (.+)/)
        if (match) {
          devices.push({
            address: match[1],
            name: match[2],
            paired: true,
          })
        }
      }
    } catch (error) {
      logger.error('Error scanning Bluetooth devices', error)
    }

    return devices
  }

  /**
   * Start Bluetooth discovery scan
   */
  async startBluetoothScan(): Promise<BluetoothDevice[]> {
    try {
      // Start scanning for 5 seconds
      await execAsync('timeout 5 bluetoothctl scan on 2>/dev/null || true')

      // Get all discovered devices
      const { stdout } = await execAsync('bluetoothctl devices 2>/dev/null')
      const devices: BluetoothDevice[] = []
      const lines = stdout.trim().split('\n').filter(line => line.startsWith('Device'))

      for (const line of lines) {
        const match = line.match(/Device ([0-9A-Fa-f:]{17}) (.+)/)
        if (match) {
          // Check if paired
          let paired = false
          try {
            const { stdout: infoOutput } = await execAsync(`bluetoothctl info ${match[1]} 2>/dev/null`)
            paired = infoOutput.includes('Paired: yes')
          } catch {
            // Device info not available
          }

          devices.push({
            address: match[1],
            name: match[2],
            paired,
          })
        }
      }

      return devices
    } catch (error) {
      logger.error('Error during Bluetooth scan', error)
      return []
    }
  }

  /**
   * Pair with a Bluetooth device
   */
  async pairBluetoothDevice(address: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Trust the device first
      await execAsync(`bluetoothctl trust ${address}`)

      // Attempt to pair
      const { stdout, stderr } = await execAsync(`bluetoothctl pair ${address}`)

      if (stderr && stderr.includes('Failed')) {
        return { success: false, error: stderr }
      }

      // Bind rfcomm (create serial port)
      try {
        await execAsync(`sudo rfcomm bind 0 ${address} 1 2>/dev/null || rfcomm bind 0 ${address} 1 2>/dev/null`)
      } catch {
        // rfcomm might already be bound or not available
        logger.warn('Could not bind rfcomm - may need manual setup')
      }

      logger.success(`Paired with Bluetooth device: ${address}`)
      return { success: true }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to pair Bluetooth device', error)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Test Bluetooth connection
   */
  private async testBluetoothConnection(): Promise<boolean> {
    if (!this.config?.bluetoothAddress) {
      return false
    }

    try {
      // Check if rfcomm device exists
      const rfcommPath = '/dev/rfcomm0'
      if (fs.existsSync(rfcommPath)) {
        this.devicePath = rfcommPath
        this.isConnected = true
        logger.info(`Bluetooth printer ready at ${rfcommPath}`)
        return true
      }

      // Try to bind rfcomm
      try {
        await execAsync(`sudo rfcomm bind 0 ${this.config.bluetoothAddress} 1 2>/dev/null || rfcomm bind 0 ${this.config.bluetoothAddress} 1 2>/dev/null`)
        if (fs.existsSync(rfcommPath)) {
          this.devicePath = rfcommPath
          this.isConnected = true
          logger.info(`Bluetooth printer bound at ${rfcommPath}`)
          return true
        }
      } catch {
        // rfcomm bind failed
      }

      // Check if device is connected via bluetoothctl
      const { stdout } = await execAsync(`bluetoothctl info ${this.config.bluetoothAddress} 2>/dev/null`)
      if (stdout.includes('Connected: yes')) {
        logger.info('Bluetooth device is connected')
        this.isConnected = true
        return true
      }

      return false
    } catch (error) {
      logger.error('Bluetooth connection test failed', error)
      return false
    }
  }

  /**
   * Print via Bluetooth (rfcomm serial port)
   */
  private async printBluetooth(data: Buffer): Promise<boolean> {
    // Try rfcomm device first
    const rfcommPath = '/dev/rfcomm0'

    if (fs.existsSync(rfcommPath)) {
      try {
        fs.writeFileSync(rfcommPath, data)
        logger.print(`Printed ${data.length} bytes to ${rfcommPath}`)
        return true
      } catch (error) {
        logger.error(`Failed to write to ${rfcommPath}`, error)
      }
    }

    // Try to bind and print
    if (this.config?.bluetoothAddress) {
      try {
        await execAsync(`sudo rfcomm bind 0 ${this.config.bluetoothAddress} 1 2>/dev/null || true`)
        if (fs.existsSync(rfcommPath)) {
          fs.writeFileSync(rfcommPath, data)
          logger.print(`Printed ${data.length} bytes to ${rfcommPath}`)
          return true
        }
      } catch (error) {
        logger.error('Failed to bind rfcomm for printing', error)
      }
    }

    logger.error('No Bluetooth printer device found')
    return false
  }

  /**
   * Test network connection with specific IP and port (for web UI)
   */
  async testNetworkPrinter(ip: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 3000)

      socket.connect(port, ip, () => {
        clearTimeout(timeout)
        socket.destroy()
        logger.info(`Network printer reachable at ${ip}:${port}`)
        resolve(true)
      })

      socket.on('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  getStatus(): { connected: boolean; devicePath: string | null; config: PrinterConfig | null } {
    return {
      connected: this.isConnected,
      devicePath: this.devicePath,
      config: this.config,
    }
  }
}

export default PrinterManager
