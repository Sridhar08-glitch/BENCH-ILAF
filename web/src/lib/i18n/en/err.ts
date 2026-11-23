// English texts for errors the app shows itself (messages that come from the API are translated by the API).
export const err = {
  "err.offline": "You appear to be offline. Check your connection and try again.",
  "err.generic": "Something went wrong. Please try again.",
  "err.unreachable": "The service cannot be reached right now. Please try again.",
  "err.sessionExpired": "Your session has expired. Please sign in again.",
  "err.throttled": "Please wait {n, plural, one {# second} other {# seconds}} and try again.",
  "err.throttledNote": "Too many requests. You can try again in {n, plural, one {# second} other {# seconds}}.",
  "err.originRefused": "This request did not come from the app. Reload the page and try again.",
  "err.pendingDeletion": "This company is closed while it is scheduled for deletion.",
} satisfies Record<string, string>;
