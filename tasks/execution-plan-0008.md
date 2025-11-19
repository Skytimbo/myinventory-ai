# Execution Plan: PRD-0008 - Cloudflare Tunnel Access

## Task 1.0: Implement cloudflared detection and tunnel startup

### Task 1.1: Add cloudflared detection function
- **File**: `scripts/dev-mobile.ts`
- **Action**: Create `isCloudflaredInstalled()` async function
- **Details**:
  - Execute `cloudflared --version` using exec
  - Return boolean based on success/failure
  - Handle command not found gracefully

### Task 1.2: Implement tunnel process spawning
- **File**: `scripts/dev-mobile.ts`
- **Action**: Create `startCloudflaredTunnel(port: number)` function
- **Details**:
  - Spawn `cloudflared tunnel --url http://localhost:${port}`
  - Use stdio: ['ignore', 'pipe', 'pipe'] for output capture
  - Return TunnelResult interface with url and process

### Task 1.3: Parse tunnel URL from stderr output
- **File**: `scripts/dev-mobile.ts`
- **Action**: Add URL extraction logic
- **Details**:
  - Listen to stderr for cloudflared output
  - Match regex: `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/`
  - Resolve promise with URL or null on timeout (15s)

### Task 1.4: Handle tunnel errors gracefully
- **File**: `scripts/dev-mobile.ts`
- **Action**: Add error handling and user feedback
- **Details**:
  - Display installation instructions if not installed
  - Show warning if tunnel fails to start
  - Continue with LAN-only mode on failure

---

## Task 2.0: Integrate tunnel into dev:mobile output

### Task 2.1: Add CLI argument parsing
- **File**: `scripts/dev-mobile.ts`
- **Action**: Parse `--tunnel` and `--no-tunnel` flags
- **Details**:
  - Check process.argv for flags
  - `--tunnel` forces tunnel on
  - `--no-tunnel` forces tunnel off
  - Flags override environment variable

### Task 2.2: Add ENABLE_TUNNEL environment variable support
- **File**: `scripts/dev-mobile.ts`
- **Action**: Check env var for tunnel setting
- **Details**:
  - Read `ENABLE_TUNNEL` from process.env
  - Default to false (tunnel disabled)
  - CLI flags take precedence over env var

### Task 2.3: Display tunnel URL in terminal output
- **File**: `scripts/dev-mobile.ts`
- **Action**: Update success message to include tunnel URL
- **Details**:
  - Add "Tunnel:" line alongside Desktop and LAN URLs
  - Use cyan color for tunnel URL
  - Show warning if tunnel not available

### Task 2.4: Generate QR code for tunnel URL
- **File**: `scripts/dev-mobile.ts`
- **Action**: Add second QR code for tunnel access
- **Details**:
  - Use existing qrcode-terminal package
  - Display below LAN QR code
  - Label as "Scan for Tunnel access (works anywhere)"

### Task 2.5: Update .env.example with ENABLE_TUNNEL
- **File**: `.env.example`
- **Action**: Add documented environment variable
- **Details**:
  - Add `ENABLE_TUNNEL=false` with comment
  - Explain purpose and usage

---

## Task 3.0: Create dev:tunnel script

### Task 3.1: Add dev:tunnel script to package.json
- **File**: `package.json`
- **Action**: Add new script entry
- **Details**:
  - `"dev:tunnel": "tsx scripts/dev-mobile.ts --tunnel"`
  - Place near other dev scripts

### Task 3.2: Implement graceful shutdown for tunnel process
- **File**: `scripts/dev-mobile.ts`
- **Action**: Kill tunnel process on SIGINT/SIGTERM
- **Details**:
  - Add tunnel process to cleanup handler
  - Call `tunnelProcess?.kill('SIGTERM')`
  - Verify no orphaned processes

### Task 3.3: Store tunnel process reference for cleanup
- **File**: `scripts/dev-mobile.ts`
- **Action**: Track tunnel process in parent scope
- **Details**:
  - Declare variable alongside apiServer/uiServer
  - Update on tunnel start
  - Include in shutdown handler

---

## Task 4.0: Create documentation

### Task 4.1: Create cloudflare-tunnel.md documentation file
- **File**: `docs/cloudflare-tunnel.md`
- **Action**: Create new documentation file
- **Details**:
  - Overview and use cases section
  - Benefits over LAN-only testing

### Task 4.2: Document cloudflared installation
- **File**: `docs/cloudflare-tunnel.md`
- **Action**: Add platform-specific installation instructions
- **Details**:
  - macOS: `brew install cloudflared`
  - Windows: winget/chocolatey/direct download
  - Linux: apt/yum/direct download
  - Link to official Cloudflare docs

### Task 4.3: Document usage and configuration
- **File**: `docs/cloudflare-tunnel.md`
- **Action**: Add usage examples
- **Details**:
  - `pnpm dev:tunnel` command
  - `pnpm dev:mobile --tunnel` flag
  - `ENABLE_TUNNEL` environment variable
  - Example terminal output

### Task 4.4: Document Zero Trust authentication setup
- **File**: `docs/cloudflare-tunnel.md`
- **Action**: Add optional auth configuration guide
- **Details**:
  - Cloudflare dashboard navigation
  - Creating access policies
  - Supported identity providers (Google, Apple, GitHub)
  - Link to Cloudflare Zero Trust docs

### Task 4.5: Add troubleshooting section
- **File**: `docs/cloudflare-tunnel.md`
- **Action**: Document common issues and solutions
- **Details**:
  - "cloudflared not found" - installation instructions
  - "Tunnel failed to start" - check internet connection
  - "URL not appearing" - increase timeout
  - "App not loading" - verify Vite server running

---

## Task 5.0: Test and verify

### Task 5.1: Test tunnel startup on macOS
- **Action**: Manual testing
- **Details**:
  - Run `pnpm dev:tunnel`
  - Verify URL appears in terminal
  - Verify QR code displays
  - Test Ctrl+C cleanup

### Task 5.2: Test graceful degradation
- **Action**: Manual testing
- **Details**:
  - Temporarily rename/uninstall cloudflared
  - Run `pnpm dev:mobile --tunnel`
  - Verify warning message appears
  - Verify LAN mode still works

### Task 5.3: Test mobile access over cellular
- **Action**: Manual testing on physical device
- **Details**:
  - Scan tunnel QR code with phone on cellular
  - Verify app loads correctly
  - Upload an image and verify it saves
  - Test API responses

### Task 5.4: Test CLI flag overrides
- **Action**: Manual testing
- **Details**:
  - Set `ENABLE_TUNNEL=true` in .env.local
  - Run `pnpm dev:mobile` - verify tunnel starts
  - Run `pnpm dev:mobile --no-tunnel` - verify tunnel skipped
  - Clear env var, run `pnpm dev:mobile --tunnel` - verify tunnel starts

### Task 5.5: Verify no orphaned processes
- **Action**: Manual testing
- **Details**:
  - Start `pnpm dev:tunnel`
  - Stop with Ctrl+C
  - Run `ps aux | grep cloudflared`
  - Verify no lingering processes

---

## Implementation Order

**Recommended sequence:**
1. Tasks 1.1-1.4 (Core tunnel functionality)
2. Tasks 2.1-2.2 (Flag and env var support)
3. Tasks 3.2-3.3 (Graceful shutdown)
4. Tasks 2.3-2.4 (Output display)
5. Tasks 3.1, 2.5 (Package.json and .env.example)
6. Tasks 4.1-4.5 (Documentation)
7. Tasks 5.1-5.5 (Testing and verification)

## Files to Modify

| File | Tasks |
|------|-------|
| `scripts/dev-mobile.ts` | 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.2, 3.3 |
| `package.json` | 3.1 |
| `.env.example` | 2.5 |
| `docs/cloudflare-tunnel.md` | 4.1, 4.2, 4.3, 4.4, 4.5 (new file) |

## Dependencies

- `qrcode-terminal` - Already installed (used by dev-mobile.ts)
- `cloudflared` - External CLI tool (user must install)

## Success Criteria

- [ ] `pnpm dev:tunnel` starts tunnel and displays URL
- [ ] QR codes work for both LAN and tunnel URLs
- [ ] App loads correctly via tunnel on mobile
- [ ] Graceful fallback when cloudflared not installed
- [ ] No orphaned processes after shutdown
- [ ] Documentation is complete and accurate
