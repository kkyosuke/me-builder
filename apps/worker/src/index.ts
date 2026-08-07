import { fetchHandler } from "./handler/fetch";
import { queueHandler } from "./handler/queue";
import { scheduledHandler } from "./handler/scheduled";
export { ConversationCoordinator } from "./conversation-coordinator";

export default {
  fetch: fetchHandler,
  queue: queueHandler,
  scheduled: scheduledHandler,
};
