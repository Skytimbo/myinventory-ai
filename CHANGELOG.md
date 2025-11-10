# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Memory Leak**: Fixed Uppy file uploader memory leak by switching from useState to useRef pattern with explicit cleanup (removePlugin, off, close)
- **Image Loading**: Added robust image loading fallbacks with loading skeleton, error placeholder, and retry capability with cache-busting
- **Accessibility**: Image error states now include proper ARIA labels and keyboard-accessible retry buttons

### Performance
- **Search Debouncing**: Implemented 300ms debouncing on search input to reduce redundant queries and improve responsiveness

### Changed
- **API Error Handling**: Standardized backend error responses with consistent `{error, code}` format
- **Error Middleware**: Added production-grade error handling with ApiError class and wrap() helper for async routes
- **Environment-Aware Errors**: Error details now hidden in production, exposed in development for debugging

### Tests
- Added comprehensive server unit tests for error handling (NOT_FOUND, VALIDATION_ERROR, UPSTREAM_AI, UNHANDLED)
- Added client unit tests for ObjectUploader cleanup and search debouncing
- Added E2E tests for image loading fallback scenarios
- Integrated Playwright E2E tests into CI pipeline

### CI/CD
- Added pnpm-only enforcement with preinstall guard script
- Configured CI workflow with separate jobs for server tests, client tests, and E2E tests
- Added Playwright trace upload on E2E test failures
