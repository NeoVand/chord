import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	// Each test owns its page/audio context; distribute tests across CI runners.
	fullyParallel: true,
	workers: 1,
	reporter: 'list',
	timeout: process.env.CI ? 90_000 : 60_000,
	globalTimeout: process.env.CI ? 10 * 60_000 : undefined,
	use: {
		baseURL: 'http://127.0.0.1:5197',
		viewport: { width: 1440, height: 1000 },
		// Use Playwright's headless shell. Recording continuous screenshots for
		// traces overwhelms software graphics on hosted runners; retain failure
		// screenshots and the accessibility snapshot instead.
		launchOptions: { args: ['--mute-audio'] },
		trace: 'off',
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
