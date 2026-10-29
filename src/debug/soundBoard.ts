import type { TestHost } from '@client/app/testHost';
import { createPaneFactory } from './paneFactory.ts';

export interface SoundBoardOptions {
  readonly host: TestHost;
  /** Where the pane is mounted (a section of the overlay). */
  readonly container: HTMLElement;
}

export interface SoundBoard {
  dispose(): void;
}

const IDLE_TEXT = 'Tap a cue to hear it (its sound and layers only: no ring, no vibration).';
const NOT_RUNNING_TEXT =
  'Audio is not running: touch the game once so the browser starts the audio, then tap again.';

/**
 * The sound board (story 2.3 AC 14, golden rule: Geo judges the sound): a Tweakpane pane that lists
 * every cue of `feedback.json` with a sound and plays it on a tap through `TestHost.auditionCue`
 * (the cue's `audio` then its `layers`; no ring, vibration or cue report, so nothing warns outside
 * a level). The module never touches the audio engine. The labels are English literals: it is a
 * debug tool, not player UI.
 */
export function createSoundBoard(options: SoundBoardOptions): SoundBoard {
  const { host, container } = options;
  const doc = container.ownerDocument;
  const paneFactory = createPaneFactory(doc);

  const paneHost = doc.createElement('div');
  const status = doc.createElement('div');
  status.className = 'pp-debug-sound-status';
  status.textContent = IDLE_TEXT;
  container.append(paneHost, status);

  const pane = paneFactory.create(paneHost, 'Sons');
  const cues = Object.entries(host.content.feedback.cues)
    .filter(([, cue]) => cue.audio !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [id, cue] of cues) {
    const layerCount = cue.layers?.length ?? 0;
    const button = pane.addButton({ title: layerCount > 0 ? `${id} +${layerCount}` : id });
    button.on('click', () => {
      status.textContent = host.auditionCue(id) ? `played ${id}` : NOT_RUNNING_TEXT;
    });
  }

  return {
    dispose() {
      pane.dispose();
      paneFactory.dispose();
      paneHost.remove();
      status.remove();
    },
  };
}
