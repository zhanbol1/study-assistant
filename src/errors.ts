export function errorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Could not complete this action. Please try again.";
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}
