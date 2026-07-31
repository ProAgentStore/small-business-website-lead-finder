export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		console.log("small-business-website-lead-finder cron fired:", event.cron);
	},
	async fetch() {
		return new Response("small-business-website-lead-finder cron worker", { status: 200 });
	},
};

interface Env {}
