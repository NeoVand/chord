import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	workers: 1,
	reporter: 'list',
	timeout: process.env.CI ? 90_000 : 60_000,
	globalTimeout: process.env.CI ? 10 * 60_000 : undefined,
	use: {
		baseURL: 'http://127.0.0.1:5197',
		viewport: { width: 1440, height: 1000 },
		// Hosted runners have no physical GPU. Full Chromium plus explicit
		// SwiftShader provides the same WebGL fallback used by unsupported devices.
		channel: process.env.CI ? 'chromium' : undefined,
		launchOptions: { args: ['--mute-audio', ...(process.env.CI ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] : [])] },
		trace: process.env.CI ? 'retain-on-failure' : 'off',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 5197 --strictPort',
		url: 'http://127.0.0.1:5197',
		reuseExistingServer: false,
		timeout: 120_000
	},
	testMatch: '**/*.e2e.ts'
});
