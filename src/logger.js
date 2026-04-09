export function logInfo(message, extra = undefined) {
  console.log(JSON.stringify({ level: "info", message, extra, time: new Date().toISOString() }));
}

export function logWarn(message, extra = undefined) {
  console.warn(JSON.stringify({ level: "warn", message, extra, time: new Date().toISOString() }));
}

export function logError(message, error) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      time: new Date().toISOString()
    })
  );
}
