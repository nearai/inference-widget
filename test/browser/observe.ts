import { test } from '@playwright/test';

// Record the viewer-generated IDs for adversarial message tests without putting them in the URL.
export function observe() {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const uuid = crypto.randomUUID.bind(crypto);
      crypto.randomUUID = () => {
        const id = uuid();
        if (document.documentElement)
          document.documentElement.dataset.requestId = id;
        return id;
      };
      window.addEventListener('message', (event) => {
        if (
          event.data?.version !== 1 ||
          ![
            'NEAR_AI_VERIFICATION_CENTER_READY',
            'NEAR_AI_REQUEST_VERIFICATION_REPORT',
          ].includes(event.data.type)
        )
          return;
        for (const iframe of document.querySelectorAll('iframe')) {
          if (event.source === iframe.contentWindow)
            iframe.dataset.requestId = event.data.requestId;
        }
      });
    });
  });
}
