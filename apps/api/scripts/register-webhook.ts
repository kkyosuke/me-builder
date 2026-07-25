import { registerLineWebhook } from "../src/lib/line-webhook";

console.log("[Script] Executing LINE Webhook registration...");
registerLineWebhook().then((result) => {
  if (result.success) {
    console.log("[Script] Registration process completed successfully.");
  } else {
    console.log("[Script] Registration process ended with message:", result.message);
  }
});
