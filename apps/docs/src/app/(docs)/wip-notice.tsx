import { Notice } from "@kushagradhawan/kookie-ui-react";

/** Size 3, so the message sits at the page's body step (3) rather than one below it. The
    Notice sets its own text step from its size, so the message stays plain text.

    Shown on the home page and the installation chapter until the first stable release. */
export function WipNotice() {
  return (
    <Notice tone="warning" size="3">
      Work in progress. Kookie Flow is in active development and has not reached 1.0. The API and these docs can change without notice, so do not rely on it in production yet.
    </Notice>
  );
}

/** The chapters that carry the notice: where someone deciding whether to adopt it lands. */
export const WIP_NOTICE_CHAPTERS = new Set(["start/installation"]);
