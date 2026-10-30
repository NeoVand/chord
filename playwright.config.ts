import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	workers: 1,
	timeout: 60_000,
	use: {
		baseURL: 'http://127.0.0.1:5197',
		viewport: { width: 1440, height: 1000 },
		launchOptions: { args: ['--mute-audio'] }
	},
	webServer: {
		command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 5197 --strictPort',
		url: 'http://127.0.0.1:5197',
		reuseExistingServer: false,
		timeout: 120_000
	},
	testMatch: '**/*.e2e.ts'
});
