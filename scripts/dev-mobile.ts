#!/usr/bin/env tsx
/**
 * Development server launcher with mobile testing support
 *
 * Features:
 * - Starts API server (port 5000) and UI server (port 5173)
 * - Detects LAN IP and prints QR code for mobile testing
 * - Auto-configures database (Docker/local/demo mode)
 * - Health checks before returning control
 */

import 'dotenv/config'; // Load .env file
import { spawn, exec, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { networkInterfaces } from 'os';
import { createInterface } from 'readline';

const execAsync = promisify(exec);

// Tunnel result interface
interface TunnelResult {
  url: string | null;
  process: ChildProcess | null;
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function getLanIP(): string | null {
  const nets = networkInterfaces();

  // Try common interface names first (macOS)
  for (const name of ['en0', 'en1']) {
    const iface = nets[name];
    if (iface) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // Fallback: search all interfaces
  for (const name of Object.keys(nets)) {
    const iface = nets[name];
    if (iface) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  return null;
}

async function generateQRCode(url: string, label?: string): Promise<void> {
  try {
    const qrcodeModule = await import('qrcode-terminal');
    const qrcode = qrcodeModule.default || qrcodeModule;
    if (label) {
      log(`\n${label}\n`, colors.cyan);
    } else {
      log('\n📱 Scan this QR code to test on your mobile device:\n', colors.cyan);
    }
    if (typeof qrcode.generate === 'function') {
      qrcode.generate(url, { small: true });
    } else {
      throw new Error('QR code module loaded but generate function not found');
    }
  } catch (error) {
    log(`⚠️  Could not generate QR code: ${error}`, colors.yellow);
    log(`   Manually enter on mobile: ${url}`, colors.yellow);
  }
}

// Check if cloudflared CLI is installed
async function isCloudflaredInstalled(): Promise<boolean> {
  try {
    await execAsync('cloudflared --version');
    return true;
  } catch {
    return false;
  }
}

// Start Cloudflare Quick Tunnel
async function startCloudflaredTunnel(port: number): Promise<TunnelResult> {
  const installed = await isCloudflaredInstalled();

  if (!installed) {
    log('\n⚠️  cloudflared not installed. Tunnel disabled.', colors.yellow);
    log('   Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/', colors.yellow);
    log('   macOS: brew install cloudflared', colors.yellow);
    return { url: null, process: null };
  }

  log('\n🔗 Starting Cloudflare Tunnel...', colors.cyan);

  const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const url = await new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      log('⚠️  Tunnel URL not received within timeout', colors.yellow);
      resolve(null);
    }, 15000);

    tunnelProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });

    tunnelProcess.on('error', (err) => {
      clearTimeout(timeout);
      log(`⚠️  Tunnel error: ${err.message}`, colors.yellow);
      resolve(null);
    });

    tunnelProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  });

  if (url) {
    log(`✓ Tunnel URL: ${url}`, colors.green);
  } else {
    log('⚠️  Failed to start tunnel. Continuing with LAN-only mode.', colors.yellow);
    tunnelProcess.kill();
    return { url: null, process: null };
  }

  return { url, process: tunnelProcess };
}

// Parse CLI arguments for tunnel control
function parseTunnelFlags(): { enabled: boolean; explicit: boolean } {
  const args = process.argv.slice(2);

  if (args.includes('--tunnel')) {
    return { enabled: true, explicit: true };
  }

  if (args.includes('--no-tunnel')) {
    return { enabled: false, explicit: true };
  }

  // Check environment variable
  const envValue = process.env.ENABLE_TUNNEL?.toLowerCase();
  if (envValue === 'true' || envValue === '1') {
    return { enabled: true, explicit: false };
  }

  // Default: tunnel disabled
  return { enabled: false, explicit: false };
}

async function checkHealth(url: string, retries: number = 30): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function setupDatabase(): Promise<boolean> {
  log('\n🗄️  Checking database configuration...', colors.cyan);

  if (process.env.DATABASE_URL) {
    log('✓ DATABASE_URL found', colors.green);
    return true;
  }

  log('⚠️  DATABASE_URL not set', colors.yellow);
  log('\nOptions:', colors.bright);
  log('  1. Start Docker Postgres container (recommended)');
  log('  2. Use existing local Postgres');
  log('  3. Continue without database (demo mode - limited functionality)');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('\nSelect option (1-3): ', resolve);
  });
  rl.close();

  if (answer === '1') {
    log('\n🐳 Starting Docker Postgres container...', colors.cyan);
    log('Run: docker run --name myinventory-dev-db -e POSTGRES_PASSWORD=postgres -p 5433:5432 -d postgres:16', colors.yellow);
    log('Then set: export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/postgres"', colors.yellow);
    log('And run: pnpm db:reset && pnpm db:seed', colors.yellow);
    return false;
  } else if (answer === '2') {
    log('\nSet DATABASE_URL to your local Postgres:', colors.yellow);
    log('  export DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"', colors.yellow);
    log('  pnpm db:reset && pnpm db:seed', colors.yellow);
    return false;
  } else {
    log('\n⚠️  Running in demo mode without database', colors.yellow);
    log('   API endpoints will return stub data', colors.yellow);
    return true;
  }
}

function spawnServer(command: string, args: string[], name: string, color: string, extraEnv: Record<string, string> = {}): ChildProcess {
  log(`\n🚀 Starting ${name}...`, color);

  const proc = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
  });

  proc.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      log(`[${name}] ${output}`, color);
    }
  });

  proc.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('DeprecationWarning')) {
      log(`[${name}] ${output}`, colors.yellow);
    }
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`\n❌ ${name} exited with code ${code}`, colors.red);
      process.exit(1);
    }
  });

  return proc;
}

async function main() {
  log('\n╔════════════════════════════════════════════════════════════╗', colors.bright);
  log('║   MyInventory AI - Mobile Development Server              ║', colors.bright);
  log('╚════════════════════════════════════════════════════════════╝', colors.bright);

  // Parse tunnel flags
  const tunnelConfig = parseTunnelFlags();

  // Check database
  const hasDB = await setupDatabase();

  if (!hasDB && !process.env.DATABASE_URL) {
    log('\n⚠️  Database setup required. Exiting...', colors.red);
    process.exit(1);
  }

  // Detect LAN IP
  const lanIP = getLanIP();
  if (!lanIP) {
    log('\n⚠️  Could not detect LAN IP address', colors.yellow);
    log('   Mobile testing may not work', colors.yellow);
  }

  const API_PORT = '5001'; // Use 5001 to avoid conflict with macOS ControlCenter
  const UI_PORT = 5173;
  const desktopURL = `http://localhost:${UI_PORT}`;
  const mobileURL = lanIP ? `http://${lanIP}:${UI_PORT}` : null;

  // Start Cloudflare Tunnel if enabled
  let tunnelResult: TunnelResult = { url: null, process: null };
  if (tunnelConfig.enabled) {
    tunnelResult = await startCloudflaredTunnel(UI_PORT);
  }

  // Start API server with PORT=5001
  const apiServer = spawnServer('pnpm', ['dev:api'], 'API Server', colors.blue, { PORT: API_PORT });

  // Wait for API server to be ready
  log(`\n⏳ Waiting for API server (port ${API_PORT})...`, colors.cyan);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Start UI server with API_PORT set for proxy configuration
  const uiServer = spawnServer('pnpm', ['dev:ui'], 'UI Server', colors.magenta, { API_PORT });

  // Wait for UI server to be ready
  log('\n⏳ Waiting for UI server (port 5173)...', colors.cyan);
  const uiReady = await checkHealth(desktopURL, 30);

  if (!uiReady) {
    log('\n❌ UI server failed to start', colors.red);
    apiServer.kill();
    uiServer.kill();
    process.exit(1);
  }

  // Check API health
  log('\n⏳ Checking API health...', colors.cyan);
  const apiReady = await checkHealth(`http://localhost:${API_PORT}/api/items`, 10);

  if (!apiReady) {
    log('\n⚠️  API health check failed (this is okay if using demo mode)', colors.yellow);
  }

  // Display success message
  log('\n╔════════════════════════════════════════════════════════════╗', colors.green);
  log('║   ✓ Servers are running and healthy!                      ║', colors.green);
  log('╚════════════════════════════════════════════════════════════╝', colors.green);

  log('\n📍 Testing URLs:', colors.bright);
  log(`   Desktop: ${desktopURL}`, colors.cyan);

  if (mobileURL) {
    log(`   LAN:     ${mobileURL}`, colors.cyan);
  }

  if (tunnelResult.url) {
    log(`   Tunnel:  ${tunnelResult.url}`, colors.cyan);
  }

  // Generate QR codes
  if (mobileURL) {
    await generateQRCode(mobileURL, '📱 Scan for LAN access (same WiFi):');
  }

  if (tunnelResult.url) {
    await generateQRCode(tunnelResult.url, '🌐 Scan for Tunnel access (works anywhere):');
  }

  log('\n💡 Tips:', colors.bright);
  log('   • Desktop: Open browser to http://localhost:5173');
  if (mobileURL && !tunnelResult.url) {
    log('   • Mobile: Scan QR code or enter LAN URL');
    log('   • Both devices must be on the same WiFi network');
  } else if (tunnelResult.url) {
    log('   • Mobile: Scan tunnel QR code (works on cellular data)');
    log('   • LAN access requires same WiFi network');
  }
  log('   • Press Ctrl+C to stop all servers\n');

  // Handle cleanup
  process.on('SIGINT', () => {
    log('\n\n🛑 Stopping servers...', colors.yellow);
    tunnelResult.process?.kill('SIGTERM');
    apiServer.kill();
    uiServer.kill();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, colors.red);
  console.error(error);
  process.exit(1);
});
