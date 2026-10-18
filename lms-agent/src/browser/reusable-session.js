import { createHash } from 'node:crypto';

// In-memory browser state only. A changed or removed credential invalidates it.
export function createReusableSession({ launch, getCredential, authenticate }) {
  let browser, context, fingerprint;
  async function close() {
    const previous = browser;
    browser = context = fingerprint = undefined;
    await previous?.close().catch(() => {});
  }
  return {
    close,
    async run(destination, operation) {
      let credential;
      try {
        credential = await getCredential();
        const current = createHash('sha256').update(JSON.stringify([credential.username, credential.password])).digest('hex');
        if (fingerprint !== current || !browser?.isConnected()) {
          await close();
          browser = await launch();
          context = await browser.newContext({ acceptDownloads: true });
          fingerprint = current;
        }
        const page = await context.newPage();
        try {
          await authenticate(page, destination, { getCredential: async () => ({ ...credential }) });
          return await operation(page, context);
        } finally { await page.close().catch(() => {}); }
      } catch (error) { await close(); throw error; }
      finally { if (credential) { credential.username = ''; credential.password = ''; } }
    },
  };
}
