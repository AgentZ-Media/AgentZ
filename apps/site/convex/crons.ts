import { cronJobs } from "convex/server";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;

// Sent emails carry reset and verification links. Their links expire after a
// day at most, so the component's copies go after two days.
export const cleanupEmails = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, { olderThan: 2 * DAY_MS });
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupAbandonedEmails, { olderThan: 7 * DAY_MS });
  },
});

const crons = cronJobs();
crons.interval("remove sent emails", { hours: 1 }, internal.crons.cleanupEmails);
crons.interval("remove expired app sign-in codes", { hours: 1 }, internal.appLink.cleanup);
crons.interval("sum up the website counters", { hours: 1 }, internal.stats.refresh);
export default crons;
