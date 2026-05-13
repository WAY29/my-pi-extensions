export function omitNoProxyEnvVars(envVars: string[]): string[] {
  return envVars.filter((envVar) => !envVar.toLowerCase().startsWith("no_proxy="));
}
