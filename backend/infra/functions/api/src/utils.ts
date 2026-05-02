export function ok(body: unknown) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function err(status: number, message: string) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}
