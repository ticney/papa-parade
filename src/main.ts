import './client/ui/styles/ui.css';
import { createBrowserContentSource } from '@client/assets/browserContentSource';
import { loadContent } from '@content/loadContent';
import { log } from '@shared/log';

// Temporary wiring: story 1.4 moves it into client/boot.ts (the composition root).
async function main(): Promise<void> {
  log.info('boot', 'shell ready');

  const content = await loadContent(createBrowserContentSource());
  if (content.ok) {
    log.info('content', 'content loaded');
    return;
  }

  log.error('content', content.error.message, content.error.problems);
  if (import.meta.env.DEV) {
    const root = document.getElementById('pp-ui');
    if (root === null) {
      log.error('boot', 'missing #pp-ui: cannot show the content error screen');
      return;
    }
    const { showContentError } = await import('@client/app/contentErrorScreen');
    showContentError(root, content.error);
  }
}

void main();
