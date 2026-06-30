import { createServer } from "node:http";
import { URL } from "node:url";

// Lazy-load intuit-oauth so this script can be run standalone
const { default: OAuthClient } = await import("intuit-oauth");
const { env } = await import("../src/config/env.js");
const { qboCredentialsRepository } = await import("../src/infrastructure/database/qbo-credentials.repository.js");

const client = new OAuthClient({
  clientId: env.QB_CLIENT_ID,
  clientSecret: env.QB_CLIENT_SECRET,
  environment: env.QB_ENVIRONMENT,
  redirectUri: env.QB_REDIRECT_URI,
});

const authUri = client.authorizeUri({
  scope: [OAuthClient.scopes.Accounting],
  state: crypto.randomUUID(),
});

console.log("\n=== QBO OAuth Setup ===");
console.log("Open this URL in your browser:\n");
console.log(authUri);
console.log("\nWaiting for callback on", env.QB_REDIRECT_URI, "...\n");

// Start a local server to catch the redirect
const redirectUrl = new URL(env.QB_REDIRECT_URI);
const port = Number(redirectUrl.port) || 3000;

await new Promise<void>((resolve, reject) => {
  const server = createServer(async (req, res) => {
    const callbackUrl = `${env.QB_REDIRECT_URI}${req.url}`;
    try {
      const authResponse = await client.createToken(callbackUrl);
      const tokens = authResponse.getJson() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        x_refresh_token_expires_in: number;
      };

      const now = Date.now();
      await qboCredentialsRepository.save({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(now + tokens.expires_in * 1000),
        refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
      });

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Auth complete! You can close this window.</h1>");
      console.log("Tokens saved to database.");
      console.log(`Access token expires: ${new Date(now + tokens.expires_in * 1000).toISOString()}`);
      console.log(`Refresh token expires: ${new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString()}`);
      server.close();
      resolve();
    } catch (err) {
      res.writeHead(500);
      res.end("Auth failed");
      reject(err);
    }
  });
  server.listen(port, () => console.log(`Callback server listening on port ${port}`));
});
