import type { ContentError } from '@content/contentError';
import './contentErrorScreen.css';

// Dev-only screen (loaded by `main.ts` behind `import.meta.env.DEV`, so it is not in any build).
// Plain technical English on purpose: it is not a player string and does not go through `t()`.

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Shows every problem of a content error full screen: file, JSON path and message. */
export function showContentError(root: HTMLElement, error: ContentError): void {
  const screen = element('section', 'pp-content-error');
  screen.setAttribute('role', 'alert');
  screen.append(
    element('h1', 'pp-content-error__title', 'Content error'),
    element(
      'p',
      'pp-content-error__hint',
      'Fix the file(s) below (or run `npm run content:check`); the page reloads on save.',
    ),
  );
  for (const problem of error.problems) {
    const block = element('div', 'pp-content-error__problem');
    const where = element('span', 'pp-content-error__where', problem.file);
    if (problem.jsonPath !== '') {
      where.append(' › ', element('span', 'pp-content-error__path', problem.jsonPath));
    }
    block.append(where, element('span', 'pp-content-error__message', problem.message));
    screen.append(block);
  }
  root.replaceChildren(screen);
}
