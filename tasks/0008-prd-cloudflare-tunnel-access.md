# PRD-0008: Enable Cloudflare Tunnel Access for Mobile Testing

## Document Header

| Field | Value |
|-------|-------|
| Status | Draft |
| Created | 2025-11-19 |
| Last Updated | 2025-11-19 |
| Author | Claude Code |
| Type | Developer Experience / Infrastructure |
| Related PRDs | - |

---

## 1. Overview

### Problem Statement

MyInventory-AI's current mobile testing workflow (`pnpm dev:mobile`) generates a LAN IP address and QR code for device testing. This approach has significant limitations:

1. **Same WiFi Requirement** - Mobile device must be on the same local network as the development machine
2. **Corporate Network Restrictions** - Many enterprise networks block device-to-device communication
3. **VPN Interference** - VPN connections often prevent LAN discovery
4. **Remote Testing Impossible** - Cannot share development URL with remote testers or clients
5. **Cellular Testing** - Cannot test on cellular data without deploying

### Solution Summary

Integrate Cloudflare Tunnel to create a secure, publicly accessible URL for the development server. This enables testing from any device, anywhere in the world, without requiring LAN access or network configuration changes.

---

## 2. Goals

### Primary Goals

1. **Secure Public Access** - Expose `localhost:5173` via Cloudflare Tunnel with HTTPS
2. **Zero Configuration** - Use Cloudflare's free, auto-assigned subdomain (e.g., `*.trycloudflare.com`)
3. **Seamless Integration** - Tunnel starts automatically with `pnpm dev:mobile` or via dedicated script
4. **Device Agnostic** - Works on any device with internet access (mobile, desktop, cellular)

### Secondary Goals

1. **Zero Trust Authentication** - Optional integration with Cloudflare Access for Google/Apple/GitHub authentication
2. **Developer Documentation** - Comprehensive setup guide at `/docs/cloudflare-tunnel.md`
3. **Graceful Degradation** - Falls back to LAN-only mode if `cloudflared` is not installed

### Future Goals (Out of Scope for v1)

1. Attach tunnel to custom domain (`quantaiq.com`)
2. Persistent named tunnels for consistent URLs across sessions

---

## 3. Non-Goals

- **Production Deployment** - This is strictly for development/testing workflows
- **API Port Exposure** - Port 5001 (API server) is not directly exposed; Vite proxy handles `/api` routes
- **Router/Firewall Changes** - No network configuration modifications required
- **Cloudflare Account Requirement** - Quick tunnels work without authentication
- **Performance Optimization** - Tunnel latency is acceptable for testing purposes

---

## 4. User Stories

### US-1: Developer Testing on Cellular

**As a** mobile developer,
**I want** to test the app on my phone using cellular data,
**So that** I can verify real-world network conditions without WiFi.

**Acceptance Criteria:**
- [ ] Tunnel URL displayed in terminal after `pnpm dev:mobile`
- [ ] QR code generated for tunnel URL
- [ ] App loads correctly on phone over cellular
- [ ] API calls work through the tunnel

### US-2: Remote Tester Access

**As a** developer sharing work with a remote tester,
**I want** to provide a public URL for my development server,
**So that** they can test without being on my local network.

**Acceptance Criteria:**
- [ ] Tunnel URL can be copied and shared
- [ ] URL works from any internet-connected device
- [ ] No additional authentication required (for basic testing)

### US-3: Corporate Network Testing

**As a** developer on a corporate network,
**I want** to test on my phone despite network restrictions,
**So that** I can iterate quickly without workarounds.

**Acceptance Criteria:**
- [ ] Tunnel bypasses corporate firewall restrictions
- [ ] No IT tickets or network changes required
- [ ] Works even when LAN IP detection fails

### US-4: Secure Authenticated Testing

**As a** developer sharing work with clients,
**I want** to require authentication to access the tunnel,
**So that** my development server is not publicly exposed.

**Acceptance Criteria:**
- [ ] Zero Trust authentication configurable via Cloudflare dashboard
- [ ] Support for Google, Apple, and GitHub identity providers
- [ ] Clear documentation on setup process

---

## 5. Functional Requirements

### FR-1: Cloudflared Installation Detection

The system must detect whether `cloudflared` CLI is installed on the developer's machine.

**Implementation:**
```typescript
async function isCloudflaredInstalled(): Promise<boolean> {
  try {
    await execAsync('cloudflared --version');
    return true;
  } catch {
    return false;
  }
}
```

**Acceptance:** If not installed, display installation instructions and continue with LAN-only mode.

### FR-2: Quick Tunnel Startup

Start a Cloudflare Quick Tunnel pointing to `localhost:5173`.

**Implementation:**
```typescript
const tunnelProcess = spawn('cloudflared', [
  'tunnel', '--url', 'http://localhost:5173'
], { stdio: ['ignore', 'pipe', 'pipe'] });
```

**Acceptance:** Tunnel process starts within 5 seconds and outputs a public URL.

### FR-3: Tunnel URL Extraction

Parse the tunnel URL from `cloudflared` output.

**Implementation:**
```typescript
// cloudflared outputs: "Your quick tunnel has been created! Visit it at: https://xxx.trycloudflare.com"
const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
```

**Acceptance:** URL is correctly extracted and stored for display/QR generation.

### FR-4: Dual QR Code Display

Display both LAN URL and Tunnel URL with their respective QR codes.

**Output Example:**
```
╔════════════════════════════════════════════════════════════╗
║   ✓ Servers are running and healthy!                      ║
╚════════════════════════════════════════════════════════════╝

📍 Testing URLs:
   Desktop: http://localhost:5173
   LAN:     http://192.168.1.100:5173
   Tunnel:  https://random-words.trycloudflare.com

📱 Scan for LAN access:
[QR CODE]

🌐 Scan for Tunnel access (works anywhere):
[QR CODE]
```

**Acceptance:** Both QR codes are visible and scannable.

### FR-5: Package.json Script

Add a dedicated `dev:tunnel` script for tunnel-only mode.

**Implementation:**
```json
{
  "scripts": {
    "dev:tunnel": "tsx scripts/dev-mobile.ts --tunnel"
  }
}
```

**Acceptance:** `pnpm dev:tunnel` starts servers with tunnel enabled by default.

### FR-6: Flag-Controlled Auto-Start

Control tunnel startup via environment variable or CLI flag.

**Environment Variable:**
```bash
# .env.local
ENABLE_TUNNEL=true
```

**CLI Flag:**
```bash
pnpm dev:mobile --tunnel
pnpm dev:mobile --no-tunnel
```

**Acceptance:**
- `pnpm dev:mobile` checks `ENABLE_TUNNEL` env var
- CLI flags override env var setting
- Default behavior: tunnel disabled (LAN-only)

### FR-7: Graceful Shutdown

Properly terminate tunnel process when dev server stops.

**Implementation:**
```typescript
process.on('SIGINT', () => {
  tunnelProcess?.kill('SIGTERM');
  apiServer?.kill('SIGTERM');
  uiServer?.kill('SIGTERM');
  process.exit(0);
});
```

**Acceptance:** No orphaned `cloudflared` processes after Ctrl+C.

### FR-8: Documentation

Create comprehensive documentation at `/docs/cloudflare-tunnel.md`.

**Contents:**
1. Overview and use cases
2. Installing `cloudflared` (macOS/Windows/Linux)
3. Running with tunnel (`pnpm dev:tunnel`)
4. Configuring Zero Trust authentication
5. Troubleshooting common issues
6. Future: Custom domain setup

**Acceptance:** Developer can set up tunnel from scratch using only the documentation.

---

## 6. Non-Functional Requirements

### NFR-1: Performance

- Tunnel startup must add < 5 seconds to `dev:mobile` command
- URL extraction must complete within 10 seconds

### NFR-2: Reliability

- Graceful fallback to LAN-only if tunnel fails
- Clear error messages for common issues (not installed, network errors)

### NFR-3: Security

- HTTPS enforced via Cloudflare
- No direct exposure of port 5001
- Optional Zero Trust authentication

### NFR-4: Compatibility

- Works on macOS, Windows, and Linux
- Compatible with existing dev workflow
- No interference with local development server

---

## 7. Constraints

1. **No Cloudflare Account Required** - Quick tunnels work without authentication
2. **No Router Configuration** - Solution must work without firewall changes
3. **No Persistent URLs** - Quick tunnel URLs change each session (acceptable for dev)
4. **Rate Limits** - Cloudflare may rate-limit quick tunnels (mitigated by named tunnels in future)

---

## 8. Design Considerations

### Architecture

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
2. Cloudflare routes to local `cloudflared` process
3. `cloudflared` proxies to `localhost:5173`
4. Vite serves static assets or proxies `/api` to `localhost:5001`
5. Response flows back through tunnel to device

### File Changes

| File | Action |
|------|--------|
| `scripts/dev-mobile.ts` | Add tunnel startup, URL extraction, dual QR display |
| `package.json` | Add `dev:tunnel` script |
| `docs/cloudflare-tunnel.md` | Create new documentation file |
| `.env.example` | Add `ENABLE_TUNNEL` variable |

---

## 9. Technical Approach

### Phase 1: Core Implementation

1. Add `cloudflared` detection function
2. Implement tunnel process spawning
3. Parse tunnel URL from stderr output
4. Display tunnel URL in terminal output
5. Generate QR code for tunnel URL

### Phase 2: Integration

1. Add `--tunnel` and `--no-tunnel` CLI flags
2. Add `ENABLE_TUNNEL` environment variable support
3. Update terminal output to show both LAN and tunnel URLs
4. Implement graceful shutdown

### Phase 3: Documentation & Polish

1. Create `/docs/cloudflare-tunnel.md`
2. Add installation instructions for all platforms
3. Document Zero Trust setup process
4. Add troubleshooting section

### Code Example: Tunnel Integration

```typescript
// scripts/dev-mobile.ts

interface TunnelResult {
  url: string | null;
  process: ChildProcess | null;
}

async function startCloudflaredTunnel(port: number): Promise<TunnelResult> {
  const installed = await isCloudflaredInstalled();

  if (!installed) {
    console.log(colors.yellow('\n⚠️  cloudflared not installed. Tunnel disabled.'));
    console.log(colors.dim('   Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
    return { url: null, process: null };
  }

  console.log(colors.cyan('\n🔗 Starting Cloudflare Tunnel...'));

  const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const url = await new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);

    tunnelProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });

    tunnelProcess.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });

  if (url) {
    console.log(colors.green(`✓ Tunnel URL: ${url}`));
  } else {
    console.log(colors.yellow('⚠️  Failed to start tunnel'));
  }

  return { url, process: tunnelProcess };
}
```

---

## 10. Success Metrics

### Functional Criteria

- [ ] `cloudflared` detection works on macOS/Windows/Linux
- [ ] Quick tunnel starts and provides public URL
- [ ] QR code displays for tunnel URL
- [ ] App loads correctly via tunnel
- [ ] API calls work through tunnel
- [ ] Graceful fallback when `cloudflared` not installed

### Technical Criteria

- [ ] Tunnel startup adds < 5s to dev:mobile
- [ ] URL extraction completes within 10s
- [ ] No orphaned processes after shutdown
- [ ] `--tunnel` flag works correctly
- [ ] `ENABLE_TUNNEL` env var works correctly

### UX Criteria

- [ ] Clear installation instructions when not installed
- [ ] Both LAN and tunnel URLs displayed
- [ ] Easy to copy tunnel URL
- [ ] Documentation is comprehensive and accurate

---

## 11. Acceptance Tests

### AT-1: Basic Tunnel Functionality

1. Run `pnpm dev:tunnel`
2. Wait for tunnel URL to appear
3. Scan QR code with phone on cellular data
4. Verify app loads correctly
5. Upload an image and verify it saves
6. Stop server with Ctrl+C
7. Verify no orphaned processes

### AT-2: Graceful Degradation

1. Uninstall or rename `cloudflared`
2. Run `pnpm dev:mobile --tunnel`
3. Verify warning message appears
4. Verify LAN URL still works
5. Reinstall `cloudflared`

### AT-3: Flag Overrides

1. Set `ENABLE_TUNNEL=true` in `.env.local`
2. Run `pnpm dev:mobile` - verify tunnel starts
3. Run `pnpm dev:mobile --no-tunnel` - verify tunnel skipped
4. Run `pnpm dev:mobile --tunnel` without env var - verify tunnel starts

---

## 12. Open Questions & Decisions

### Q1: Should tunnel be enabled by default in dev:mobile?

**Decision:** No, disabled by default.

**Rationale:**
- LAN mode is faster and sufficient for most local testing
- Tunnel requires additional setup (`cloudflared` installation)
- Users can enable via flag or env var when needed

### Q2: Should we support named tunnels for persistent URLs?

**Decision:** Out of scope for v1.

**Rationale:**
- Quick tunnels cover primary use cases
- Named tunnels require Cloudflare account
- Can be added in future PRD if needed

### Q3: How to handle multiple developers sharing URLs?

**Decision:** Document as known limitation.

**Rationale:**
- Quick tunnel URLs change each session
- Named tunnels or deployment URLs needed for persistent sharing
- Acceptable for development workflow

---

## 13. Out-of-Scope

1. Production deployment via Cloudflare
2. Custom domain attachment (future PRD)
3. Named/persistent tunnels
4. Load balancing or multi-instance support
5. Automatic `cloudflared` installation
6. CI/CD integration

---

## 14. Tasks

### High-Level Tasks

1. **Task 1.0: Implement cloudflared detection and tunnel startup**
   - Add detection function
   - Implement tunnel spawning
   - Parse URL from output
   - Handle errors gracefully

2. **Task 2.0: Integrate tunnel into dev:mobile output**
   - Display tunnel URL in terminal
   - Generate QR code for tunnel URL
   - Add CLI flags (--tunnel, --no-tunnel)
   - Add ENABLE_TUNNEL env var support

3. **Task 3.0: Create dev:tunnel script**
   - Add script to package.json
   - Default to tunnel enabled
   - Implement graceful shutdown

4. **Task 4.0: Create documentation**
   - Create /docs/cloudflare-tunnel.md
   - Installation instructions (macOS/Windows/Linux)
   - Zero Trust authentication guide
   - Troubleshooting section

5. **Task 5.0: Test and verify**
   - Test on macOS
   - Test on mobile (iOS/Android)
   - Test cellular data access
   - Document edge cases

**Ready for high-level task approval.**
