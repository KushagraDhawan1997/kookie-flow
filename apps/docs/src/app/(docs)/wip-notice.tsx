import { Notice } from "@kushagradhawan/kookie-ui-react";

/** The Notice sets its own text step from its size, so the message is plain text: a `Text`
    inside would fall back to step 3 and outgrow it.

    Shown on the home page and the installation chapter until the first stable release. */
export function WipNotice() {
  return (
    <Notice tone="warning">
      Work in progress. Kookie Flow is in active development and has not reached 1.0. The API and these docs can change without notice, so do not rely on it in production yet.
    </Notice>
  );
}

/** The chapters that carry the notice: where someone deciding whether to adopt it lands. */
export const WIP_NOTICE_CHAPTERS = new Set(["start/installation"]);
