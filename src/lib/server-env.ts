const missingEnvMessage = (key: string) => `${key} is not configured`;

export function getServerEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(missingEnvMessage(key));
  return value;
}

export function getOptionalServerEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

export function getServerFlag(key: string): boolean {
  const value = getOptionalServerEnv(key);
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
