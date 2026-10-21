/**
 * The pre-paint half of the work-in-progress notice's dismissal — the appearance script's
 * treatment (appearance-script.ts), for the same reason: the server cannot know what this
 * visitor dismissed, so without it a dismissed notice renders, paints, and then vanishes when
 * React reads storage, moving the whole frame up a strip.
 *
 * The stored value is the notice's VERSION, not a boolean, so a changed message shows again
 * once rather than staying dismissed forever. Bump it when the words change.
 */
export const WIP_NOTICE_KEY = "kflow-wip-notice";
export const WIP_NOTICE_VERSION = "1";
export const WIP_NOTICE_ATTR = "data-wip-dismissed";

export const wipNoticeScript = `(function () {
  try {
    if (localStorage.getItem(${JSON.stringify(WIP_NOTICE_KEY)}) === ${JSON.stringify(WIP_NOTICE_VERSION)})
      document.documentElement.setAttribute(${JSON.stringify(WIP_NOTICE_ATTR)}, "");
  } catch (err) {}
})();`;
