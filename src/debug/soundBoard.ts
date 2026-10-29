import type { TestHost } from '@client/app/testHost';
import { createPaneFactory } from './paneFactory.ts';
import type { PaneLike } from './tweakpaneTypes.ts';

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
  'Audio is not running: tap again (a suspended audio resumes on this tap); if it stays silent, touch the game once so the browser starts the audio.';

/**
 * The sound board (story 2.3 AC 14, golden rule: Geo judges the sound): a Tweakpane pane that lists
 * every cue of `feedback.json` with a sound and plays it on a tap through `TestHost.auditionCue`
 * (the cue's `audio` then its `layers`; no ring, vibration or cue report, so nothing warns outside
 * a level). The module never touches the audio engine. « Sons » is the folder's name (the story's
 * wording, like the overlay's section); the other labels are English literals: it is a debug tool,
 * not player UI. The pane is built before anything is mounted, so a build that throws leaves the
 * container as it was and a later attempt does not stack a second pane.
 */
export function createSoundBoard(options: SoundBoardOptions): SoundBoard {
  const { host, container } = options;
  const doc = container.ownerDocument;
  const paneFactory = createPaneFactory(doc);

  const paneHost = doc.createElement('div');
  const status = doc.createElement('div');
  status.className = 'pp-debug-sound-status';
  status.textContent = IDLE_TEXT;

  let pane: PaneLike | undefined;
  try {
    pane = paneFactory.create(paneHost, 'Sons');
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
  } catch (cause) {
    pane?.dispose();
    paneFactory.dispose();
    throw cause;
  }
  const built = pane;
  container.append(paneHost, status);

  return {
    dispose() {
      built.dispose();
      paneFactory.dispose();
      paneHost.remove();
      status.remove();
    },
  };
}
