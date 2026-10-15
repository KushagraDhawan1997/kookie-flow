import { Notice, Text } from "@kushagradhawan/kookie-ui-react";

/** Shown on the home page and the installation chapter until the first stable release. */
export function WipNotice() {
  return (
    <Notice tone="warning">
      <Text weight="medium">Work in progress.</Text> Kookie Flow is in active development and has not reached 1.0. The API and these docs can change without notice, so do not rely on it in production yet.
    </Notice>
  );
}

/** The chapters that carry the notice: where someone deciding whether to adopt it lands. */
export const WIP_NOTICE_CHAPTERS = new Set(["start/installation"]);
