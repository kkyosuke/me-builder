import { fetchHandler } from "./handler/fetch";
import { queueHandler } from "./handler/queue";

export default {
  fetch: fetchHandler,
  queue: queueHandler,
};
