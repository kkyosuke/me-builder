export default {
  fetch() {
    return new Response("Preview infrastructure cleanup in progress", { status: 503 });
  },
  queue() {
    // Cloudflare validates the previously registered consumer while publishing
    // the unbound version. The handler can be removed with the Worker itself.
  },
};

export class ConversationCoordinator {}
export class AccountData {}
export class CompatibilityData {}
