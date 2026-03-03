import { app, InvocationContext, Timer } from "@azure/functions";
import { cleanupExpiredVms } from "./shared/vmManager.js";

export async function cleanupTimer(_timer: Timer, context: InvocationContext): Promise<void> {
  const result = await cleanupExpiredVms();
  context.log(`Cleanup finished. Deleted ${result.deleted.length} expired VMs.`);
}

app.timer("cleanupExpired", {
  schedule: "0 */10 * * * *",
  runOnStartup: false,
  handler: cleanupTimer
});
