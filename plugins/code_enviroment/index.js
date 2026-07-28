// plugins/my-custom-tts/index.js
module.exports = {
  name: "code-env-conn",          // Unique identifier, used in .env config
  displayName: "Code Enviroment Connector",   // Human-readable name
  version: "1.0.0",               // Semantic version
  type: "cecn",                    // Plugin type
  description: "For connecting to code enviroment and collectivly(wiht other plugins, like smart home and industrial) managing or another processes of code-related things: Github(your PRs, your contribs or maints), Deploy(if something went down or any deploy-issue), more",

  activate(ctx) {
    // Read config from injected ctx.env (NOT process.env)
    const apiKey = ctx.env.CODE_ENV_CONN;
    return {
      async ttsProcessor(text) {
        // Your TTS implementation
        const buffer = await myTTSApi.synthesize(text, { apiKey });
        const duration = calculateDuration(buffer);
        return { buffer, duration };
      }
    };
  }
};