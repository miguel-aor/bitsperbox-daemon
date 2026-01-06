import chalk from 'chalk'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

class Logger {
  private level: LogLevel = 'info'
  private prefix: string = 'BitsperBox'

  setLevel(level: LogLevel) {
    this.level = level
  }

  setPrefix(prefix: string) {
    this.prefix = prefix
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level]
  }

  private timestamp(): string {
    return new Date().toISOString().replace('T', ' ').split('.')[0]
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const ts = chalk.gray(this.timestamp())
    const prefix = chalk.cyan(`[${this.prefix}]`)
    const metaStr = meta ? chalk.gray(` ${JSON.stringify(meta)}`) : ''

    let levelStr: string
    switch (level) {
      case 'debug':
        levelStr = chalk.gray('DEBUG')
        break
      case 'info':
        levelStr = chalk.blue('INFO ')
        break
      case 'warn':
        levelStr = chalk.yellow('WARN ')
        break
      case 'error':
        levelStr = chalk.red('ERROR')
        break
    }

    return `${ts} ${prefix} ${levelStr} ${message}${metaStr}`
  }

  debug(message: string, meta?: unknown) {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, meta))
    }
  }

  info(message: string, meta?: unknown) {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta))
    }
  }

  warn(message: string, meta?: unknown) {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta))
    }
  }

  error(message: string, meta?: unknown) {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta))
    }
  }

  // Special formatted logs
  success(message: string) {
    console.log(`${chalk.gray(this.timestamp())} ${chalk.cyan(`[${this.prefix}]`)} ${chalk.green('✓')} ${message}`)
  }

  fail(message: string) {
    console.log(`${chalk.gray(this.timestamp())} ${chalk.cyan(`[${this.prefix}]`)} ${chalk.red('✗')} ${message}`)
  }

  print(message: string) {
    console.log(`${chalk.gray(this.timestamp())} ${chalk.cyan(`[${this.prefix}]`)} ${chalk.magenta('🖨')} ${message}`)
  }

  box(title: string, content: string[]) {
    const width = Math.max(title.length, ...content.map(c => c.length)) + 4
    const border = '─'.repeat(width)

    console.log(chalk.cyan(`┌${border}┐`))
    console.log(chalk.cyan(`│ ${chalk.bold(title.padEnd(width - 2))} │`))
    console.log(chalk.cyan(`├${border}┤`))
    content.forEach(line => {
      console.log(chalk.cyan(`│ ${line.padEnd(width - 2)} │`))
    })
    console.log(chalk.cyan(`└${border}┘`))
  }
}

export const logger = new Logger()
export default logger
