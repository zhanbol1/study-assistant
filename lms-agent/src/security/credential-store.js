import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('../../scripts/credential-manager.ps1', import.meta.url),
);

export async function getLmsCredential() {
  const stdout = await runCredentialHelper('get');
  let credential;
  try {
    credential = JSON.parse(stdout);
  } catch {
    throw new Error('Credential helper returned an invalid response.');
  }

  if (!credential?.username || typeof credential.password !== 'string') {
    throw new Error('The stored LMS credential is incomplete.');
  }

  return credential;
}

function runCredentialHelper(action) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, action],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => reject(new Error('Could not start Windows Credential Manager helper.')));
    child.on('close', (code) => {
      if (code === 4) {
        reject(new Error('No LMS credentials are stored. Run npm run credentials:set first.'));
      } else if (code !== 0) {
        // Do not include helper stderr: defensive protection against secret leakage.
        reject(new Error(`Credential Manager helper failed with exit code ${code}.`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
