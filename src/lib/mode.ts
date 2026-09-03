/** Deployment mode. Same schema and code; mode flips registration,
 * quota enforcement, and platform-admin scope (see arch report §C). */

export type DeploymentMode = "self_hosted" | "hosted";

export function deploymentMode(env: Env): DeploymentMode {
  return env.DEPLOYMENT_MODE === "hosted" ? "hosted" : "self_hosted";
}
