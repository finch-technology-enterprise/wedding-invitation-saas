/**
 * Optional environment additions.
 *
 * `wrangler types` generates Env from wrangler.jsonc, which only knows
 * about bindings a given deployment actually declares. Email is optional
 * — self-hosted instances run without it — so these are declared here
 * rather than forced into every deployer's configuration.
 */

declare global {
  interface Env {
    /**
     * Cloudflare Email Service `send_email` binding. Present only when
     * the deployment declares one; `emailProvider()` checks for it.
     */
    EMAIL?: { send(message: unknown): Promise<{ messageId?: string }> };

    /** Resend API key, used when no EMAIL binding is bound. Secret. */
    RESEND_API_KEY?: string;

    /** Sender address for transactional email. */
    EMAIL_FROM?: string;

    /**
     * Canonical origin for links in emails. Never derived from the Host
     * header, which would let an attacker redirect reset links.
     */
    PUBLIC_BASE_URL?: string;

    /** "true" | "false". Defaults by deployment mode when unset. */
    EMAIL_VERIFICATION_REQUIRED?: string;
  }
}

export {};
