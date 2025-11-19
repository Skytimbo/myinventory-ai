# Cloudflare Tunnel for Mobile Testing

Cloudflare Tunnel enables secure, public access to your local development server without requiring LAN access, VPN configuration, or firewall changes.

## Overview

### Problem

Traditional mobile testing with `pnpm dev:mobile` requires:
- Mobile device on the same WiFi network
- Network that allows device-to-device communication
- No VPN interference

### Solution

Cloudflare Tunnel creates a secure HTTPS URL (e.g., `https://random-words.trycloudflare.com`) that routes through Cloudflare's edge network to your local server.

### Benefits

- **Works anywhere** - Test from cellular data, remote locations, or restricted networks
- **Secure by default** - HTTPS enabled automatically
- **No configuration** - Quick tunnels work without Cloudflare account
- **Shareable URLs** - Send to remote testers for instant access

---

## Installation

### macOS

```bash
brew install cloudflared
```

### Windows

```powershell
# Using winget
winget install Cloudflare.cloudflared

# Or using chocolatey
choco install cloudflared
```

### Linux (Debian/Ubuntu)

```bash
# Download the latest release
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared.deb
```

### Linux (RHEL/CentOS)

```bash
# Download the latest release
curl -L --output cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm

# Install
sudo rpm -i cloudflared.rpm
```

### Verify Installation

```bash
cloudflared --version
```

For more installation options, see the [official Cloudflare documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

---

## Usage

### Quick Start

```bash
# Start dev server with tunnel enabled
pnpm dev:tunnel
```

This will:
1. Start the API server (port 5001)
2. Start the UI server (port 5173)
3. Create a Cloudflare Tunnel
4. Display both LAN and tunnel URLs with QR codes

### CLI Flags

```bash
# Force tunnel on
pnpm dev:mobile --tunnel

# Force tunnel off (even if ENABLE_TUNNEL=true)
pnpm dev:mobile --no-tunnel
```

### Environment Variable

Add to `.env.local`:

```bash
ENABLE_TUNNEL=true
```

This automatically enables tunnel when running `pnpm dev:mobile`.

**Priority order:**
1. CLI flags (`--tunnel` / `--no-tunnel`)
2. Environment variable (`ENABLE_TUNNEL`)
3. Default (disabled)

---

## Example Output

```
╔════════════════════════════════════════════════════════════╗
║   ✓ Servers are running and healthy!                      ║
╚════════════════════════════════════════════════════════════╝

📍 Testing URLs:
   Desktop: http://localhost:5173
   LAN:     http://192.168.1.100:5173
   Tunnel:  https://example-words.trycloudflare.com

📱 Scan for LAN access (same WiFi):
[QR CODE]

🌐 Scan for Tunnel access (works anywhere):
[QR CODE]

💡 Tips:
   • Desktop: Open browser to http://localhost:5173
   • Mobile: Scan tunnel QR code (works on cellular data)
   • LAN access requires same WiFi network
   • Press Ctrl+C to stop all servers
```

---

## Zero Trust Authentication (Optional)

For secure access, you can add authentication using Cloudflare Zero Trust.

### Prerequisites

1. [Cloudflare account](https://dash.cloudflare.com/sign-up)
2. [Zero Trust subscription](https://dash.cloudflare.com/zero-trust) (free tier available)

### Setup Steps

1. **Create a Cloudflare Tunnel** (not a quick tunnel)
   - Go to Zero Trust dashboard > Access > Tunnels
   - Create a tunnel and install the connector

2. **Configure public hostname**
   - Add a public hostname for your tunnel
   - Point to `http://localhost:5173`

3. **Create Access Application**
   - Go to Access > Applications
   - Create a self-hosted application
   - Select your tunnel's public hostname

4. **Add Identity Providers**
   - Go to Settings > Authentication
   - Add providers: Google, Apple, GitHub, etc.

5. **Configure Access Policy**
   - In your application, add a policy
   - Allow specific emails or domains

### Supported Identity Providers

- Google
- Apple
- GitHub
- Facebook
- LinkedIn
- SAML
- OpenID Connect

For detailed instructions, see the [Cloudflare Zero Trust documentation](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/).

---

## Troubleshooting

### "cloudflared not found"

**Cause:** `cloudflared` CLI is not installed or not in PATH.

**Solution:**
1. Install using the instructions above
2. Verify with `cloudflared --version`
3. If installed but not found, add to PATH:
   ```bash
   # macOS/Linux
   export PATH="$PATH:/usr/local/bin"

   # Or find installation location
   which cloudflared
   ```

### "Tunnel URL not received within timeout"

**Cause:** Tunnel failed to start within 15 seconds.

**Solutions:**
1. Check internet connection
2. Verify firewall allows outbound connections on port 443
3. Try running manually:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
4. Check for errors in cloudflared output

### "Tunnel failed to start"

**Cause:** Various network or configuration issues.

**Solutions:**
1. Check if another cloudflared process is running:
   ```bash
   ps aux | grep cloudflared
   ```
2. Kill any existing processes:
   ```bash
   pkill cloudflared
   ```
3. Verify port 5173 is available:
   ```bash
   lsof -i :5173
   ```

### App not loading via tunnel

**Cause:** UI server not running or port mismatch.

**Solutions:**
1. Verify UI server is running on port 5173
2. Check that API proxy is configured correctly in Vite
3. Try accessing `http://localhost:5173` directly first

### Orphaned cloudflared processes

**Cause:** Dev server didn't shut down cleanly.

**Solution:**
```bash
# Find and kill all cloudflared processes
pkill cloudflared

# Or find specific PID
ps aux | grep cloudflared
kill <PID>
```

### Tunnel works but API calls fail

**Cause:** API server not running or proxy misconfigured.

**Solutions:**
1. Verify API server is running on port 5001
2. Check Vite proxy configuration in `vite.config.ts`
3. Ensure `/api` routes are properly proxied

---

## Limitations

### Quick Tunnels

- **URL changes each session** - New random URL every time you start the tunnel
- **No custom domain** - URLs are always `*.trycloudflare.com`
- **Rate limits** - Cloudflare may rate-limit heavy usage

### Future Improvements

- Named tunnels for persistent URLs
- Custom domain attachment
- Automatic authentication configuration

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Machine                         │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│  │  Vite Dev    │     │  Express     │     │  cloudflared │ │
│  │  Server      │◄────┤  API Server  │     │  tunnel      │ │
│  │  :5173       │     │  :5001       │     │              │ │
│  └──────────────┘     └──────────────┘     └──────┬───────┘ │
│         │                                         │         │
│         └─────────────────┬───────────────────────┘         │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  Cloudflare   │
                    │  Edge Network │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │ Phone   │   │ Remote  │   │ Any     │
         │ (cell)  │   │ Tester  │   │ Device  │
         └─────────┘   └─────────┘   └─────────┘
```

### Data Flow

1. Mobile device requests `https://xxx.trycloudflare.com`
2. Cloudflare routes request to local `cloudflared` process
3. `cloudflared` proxies to `localhost:5173` (Vite)
4. Vite serves static assets or proxies `/api` to `localhost:5001`
5. Response flows back through tunnel to device

---

## Related Documentation

- [PRD-0008: Cloudflare Tunnel Access](../tasks/0008-prd-cloudflare-tunnel-access.md)
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/)
